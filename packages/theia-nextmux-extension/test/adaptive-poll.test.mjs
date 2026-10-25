import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { AdaptivePoll } from '../lib/browser/nextmux-adaptive-poll.js';

// REQUIREMENTS §4.3 / §12-1: idle renderer work is bounded. The tool bridge
// no longer runs a 180 ms interval for the lifetime of every window.
function harness(state) {
    const timers = new Map();
    let next = 1;
    const poll = new AdaptivePoll({ activeMs: 180, idleMs: 2_000, hiddenMs: 5_000,
        isActive: () => state.active, isHidden: () => state.hidden,
        run: async () => { state.runs++; if (state.fail) throw new Error('rpc'); return state.found; },
        timers: { set: (callback, ms) => { const id = next++; timers.set(id, { callback, ms }); return id; }, clear: id => timers.delete(id) } });
    const fire = async () => {
        assert.equal(timers.size, 1, 'exactly one pending timeout, never an interval');
        const [[id, timer]] = timers;
        timers.delete(id);
        timer.callback();
        await new Promise(resolve => setImmediate(resolve));
        return timer.ms;
    };
    return { poll, timers, fire };
}

test('idle polling backs off to the idle ceiling and runs fast only while work exists', async () => {
    const state = { active: false, hidden: false, found: false, runs: 0 };
    const { poll, timers, fire } = harness(state);
    poll.start();
    assert.equal(await fire(), 0);
    const idleDelays = [];
    for (let index = 0; index < 6; index++) idleDelays.push(await fire());
    assert.deepEqual(idleDelays, [360, 720, 1_440, 2_000, 2_000, 2_000]);
    state.found = true;
    assert.equal(await fire(), 2_000);
    assert.equal(poll.currentDelay, 180, 'found work returns to the fast cadence');
    state.found = false; state.hidden = true;
    for (let index = 0; index < 5; index++) await fire();
    assert.equal(poll.currentDelay, 5_000, 'hidden documents use the slower ceiling');
    poll.dispose();
    assert.equal(timers.size, 0, 'dispose leaves no live timer');
});

test('wake pulls a slow idle poll forward only when activity starts, and a failing RPC cannot tighten the loop', async () => {
    const state = { active: false, hidden: false, found: false, runs: 0 };
    const { poll, timers, fire } = harness(state);
    poll.start();
    for (let index = 0; index < 6; index++) await fire();
    assert.equal(poll.currentDelay, 2_000);
    poll.wake();
    assert.equal(poll.currentDelay, 2_000, 'wake is a no-op while idle');
    state.active = true;
    poll.wake();
    assert.equal(poll.currentDelay, 180);
    assert.equal(timers.size, 1);
    state.active = false; state.fail = true;
    for (let index = 0; index < 6; index++) await fire();
    assert.equal(poll.currentDelay, 2_000, 'errors back off exactly like idle');
    poll.dispose();
    poll.wake(); poll.start();
    assert.equal(timers.size, 0);
});

test('production widget uses the adaptive bridge poll instead of a fixed interval', async () => {
    const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const bridge = widget.slice(widget.indexOf('protected startBrowserToolBridge(): void'), widget.indexOf('protected async handleComputerToolRequest('));
    assert.doesNotMatch(bridge, /setInterval\(/);
    assert.match(bridge, /const cadence = \{ activeMs: 180, idleMs: 2_000, hiddenMs: 5_000, runTimeoutMs: 10_000,/);
    assert.match(widget, /this\.browserToolPoll\?\.wake\(\);\n\s+this\.computerToolPoll\?\.wake\(\);/);
    // Run end releases both native automation owners for that conversation.
    assert.equal(widget.match(/releaseComputerSession\?\.\((session\.id|finishedSessionId)\)/g)?.length, 2);
    assert.equal(widget.match(/releaseBrowserAutomation\?\.\((session\.id|finishedSessionId)\)/g)?.length, 2);
    // Runs are per conversation: the finished conversation's own run decides the release.
    assert.match(widget, /run\.agentStage !== 'running' \|\| run\.activeAgentSessionId !== finishedSessionId/);
    const preload = await readFile(new URL('../../../apps/desktop/nextmux-electron-preload.cjs', import.meta.url), 'utf8');
    assert.match(preload, /releaseBrowserAutomation: conversationId => ipcRenderer\.invoke\('nextmux:browser:release', conversationId\)/);
});

test('a run that never settles is abandoned after runTimeoutMs and the loop keeps its cadence', async () => {
    const timers = new Map();
    let next = 1, runs = 0;
    const poll = new AdaptivePoll({ activeMs: 180, idleMs: 2_000, runTimeoutMs: 10_000, isActive: () => true,
        run: () => { runs++; return new Promise(() => undefined); },
        timers: { set: (callback, ms) => { const id = next++; timers.set(id, { callback, ms }); return id; }, clear: id => timers.delete(id) } });
    const fire = async ms => { const [[id, timer]] = [...timers].filter(([, item]) => item.ms === ms); timers.delete(id); timer.callback(); await new Promise(resolve => setImmediate(resolve)); };
    poll.start();
    await fire(0);
    assert.equal(runs, 1);
    await fire(10_000);
    assert.equal(poll.currentDelay, 180, 'a stuck run no longer blocks scheduling');
    await fire(180);
    assert.equal(runs, 2);
    poll.dispose();
});

test('production bridge: a stuck computer RPC cannot starve browser polling; active runs renew native leases', { timeout: 10000 }, async t => {
    const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const methods = new Map();
    const visit = node => { if (ts.isMethodDeclaration(node)) methods.set(node.name.getText(ast), node.getText(ast)); ts.forEachChild(node, visit); };
    visit(ast);
    const names = ['browserToolBridgeActive', 'automationActiveConversationIds', 'renewAutomationLeases', 'startBrowserToolBridge'];
    const code = ts.transpile(`class Harness { ${names.map(name => methods.get(name)).join('\n')} }`, { target: ts.ScriptTarget.ES2022 });
    const renewals = [], calls = { computer: 0, browser: 0 };
    const fakeWindow = { nextmuxDesktop: { performComputerAction() {}, cancelComputerAction: async () => true,
        renewAutomationLeases: async ids => { renewals.push(ids); return true; } } };
    const { conversationAgentRunActive, createConversationAgentRun } = await import('../lib/browser/nextmux-conversation-agent-run.js');
    const Harness = new Function('AdaptivePoll', 'window', 'document', 'conversationAgentRunActive', `${code}; return Harness;`)(AdaptivePoll, fakeWindow, { visibilityState: 'visible' }, conversationAgentRunActive);
    // Runs are per conversation: conversation-a has one running.
    const run = Object.assign(createConversationAgentRun('conversation-a'), { agentStage: 'running' });
    const harness = Object.assign(new Harness(), {
        node: { isConnected: true }, conversationAgentRuns: new Map([['conversation-a', run]]), runningScheduledTaskIds: new Set(),
        scheduledAgentRuns: new Map(), agentChildContinuationStates: new Map(), computerToolRequestsInFlight: new Map(),
        browserToolRequestsInFlight: new Set(), browserToolConversationQueues: new Map(), automationLeaseRenewedAt: 0, disposables: [],
        toDispose: { push(value) { harness.disposables.push(value); } },
        platformService: { getComputerToolRequests: () => { calls.computer++; return new Promise(() => undefined); },
            getBrowserToolRequests: async () => { calls.browser++; return []; } }
    });
    harness.startBrowserToolBridge();
    t.after(() => harness.disposables.forEach(item => item.dispose()));
    await new Promise(resolve => setTimeout(resolve, 1_000));
    assert.equal(calls.computer, 1, 'the computer loop is waiting on its stuck RPC');
    assert.ok(calls.browser >= 4, `browser loop keeps its 180 ms cadence (${calls.browser} polls)`);
    assert.deepEqual(renewals, [['conversation-a']], 'leases renewed once per minute for the active conversation');
});
