import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { AgentRunner, AgentToolRegistry } from '@nextmux/agent-runtime';

const require = createRequire(import.meta.url);
const wakeup = require('../lib/browser/nextmux-turn-wakeup-status.js');

const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

test('12 locales provide non-empty wakeup labels and tooltips, with zh-CN matching exact user copy', () => {
    assert.equal(wakeup.turnWakeupText('zh-CN', 'label'), '后台任务完成会自动继续该对话');
    for (const locale of LOCALES) {
        for (const key of [
            'label',
            'timerTooltip',
            'timerWithReasonTooltip',
            'backgroundTaskTooltip',
            'scheduledPlanTooltip',
            'goalTooltip',
            'autoResumeTooltip',
            'queuedFollowUpTooltip'
        ]) {
            const text = wakeup.turnWakeupText(locale, key, { time: '18:40', reason: 'Quota reset' });
            assert.ok(text && text.trim().length > 0, `missing ${key} in ${locale}`);
            assert.doesNotMatch(text, /\{time\}|\{reason\}/, `unreplaced placeholder in ${locale}:${key}`);
        }
    }
});

test('resolveTurnWakeupStatus returns undefined for running turns, non-latest turns, or idle settled turns', () => {
    const base = {
        locale: 'zh-CN',
        sessionId: 'session-1',
        turnId: 'turn-1',
        stage: 'complete',
        isLatestTurn: true,
        now: 1_700_000_000_000
    };
    assert.equal(wakeup.resolveTurnWakeupStatus(base), undefined);
    assert.equal(
        wakeup.resolveTurnWakeupStatus({
            ...base,
            stage: 'running',
            sessionWakeupTimer: { wakeAt: base.now + 60_000, prompt: 'continue' }
        }),
        undefined
    );
    assert.equal(
        wakeup.resolveTurnWakeupStatus({
            ...base,
            isLatestTurn: false,
            sessionWakeupTimer: { wakeAt: base.now + 60_000, prompt: 'continue' }
        }),
        undefined
    );
});

test('resolveTurnWakeupStatus resolves timer, background_task, auto_resume, goal, queued_followup, and scheduled_plan', () => {
    const now = new Date('2026-10-22T18:00:00+09:00').getTime();
    const wakeAt = new Date('2026-10-22T18:40:00+09:00').getTime();

    const timerStatus = wakeup.resolveTurnWakeupStatus({
        locale: 'zh-CN',
        sessionId: 'session-1',
        turnId: 'turn-1',
        stage: 'complete',
        isLatestTurn: true,
        now,
        sessionWakeupTimer: { wakeAt, prompt: 'Resume review', reason: '等待额度重置' }
    });
    assert.equal(timerStatus?.kind, 'timer');
    assert.equal(timerStatus?.label, '后台任务完成会自动继续该对话');
    assert.ok(timerStatus?.detail);
    assert.match(timerStatus?.tooltip || '', /等待额度重置/);

    const bgChildStatus = wakeup.resolveTurnWakeupStatus({
        locale: 'zh-CN',
        sessionId: 'session-1',
        turnId: 'turn-1',
        stage: 'complete',
        isLatestTurn: true,
        now,
        childAgents: [{ childRunId: 'child-1', status: 'running' }]
    });
    assert.equal(bgChildStatus?.kind, 'background_task');
    assert.equal(bgChildStatus?.label, '后台任务完成会自动继续该对话');

    const bgProcessStatus = wakeup.resolveTurnWakeupStatus({
        locale: 'zh-CN',
        sessionId: 'session-1',
        turnId: 'turn-1',
        stage: 'complete',
        isLatestTurn: true,
        now,
        events: [{ type: 'tool_completed', callId: 'call-proc-1', toolName: 'process.start', ok: true }]
    });
    assert.equal(bgProcessStatus?.kind, 'background_task');

    const exitedProcessStatus = wakeup.resolveTurnWakeupStatus({
        locale: 'zh-CN',
        sessionId: 'session-1',
        turnId: 'turn-1',
        stage: 'complete',
        isLatestTurn: true,
        now,
        events: [
            { type: 'tool_completed', callId: 'call-proc-1', toolName: 'process.start', ok: true },
            { type: 'tool_process_exited', callId: 'call-proc-1', toolName: 'process.start' }
        ]
    });
    assert.equal(exitedProcessStatus, undefined);

    const autoResumeStatus = wakeup.resolveTurnWakeupStatus({
        locale: 'zh-CN',
        sessionId: 'session-1',
        turnId: 'turn-1',
        stage: 'paused',
        isLatestTurn: true,
        now,
        autoResuming: true
    });
    assert.equal(autoResumeStatus?.kind, 'auto_resume');
    assert.equal(autoResumeStatus?.label, '后台任务完成会自动继续该对话');

    const goalStatus = wakeup.resolveTurnWakeupStatus({
        locale: 'zh-CN',
        sessionId: 'session-1',
        turnId: 'turn-1',
        stage: 'complete',
        isLatestTurn: true,
        now,
        goalContinuing: true
    });
    assert.equal(goalStatus?.kind, 'goal');
    assert.equal(goalStatus?.label, '后台任务完成会自动继续该对话');

    const queueStatus = wakeup.resolveTurnWakeupStatus({
        locale: 'zh-CN',
        sessionId: 'session-1',
        turnId: 'turn-1',
        stage: 'complete',
        isLatestTurn: true,
        now,
        queuedFollowUpCount: 2
    });
    assert.equal(queueStatus?.kind, 'queued_followup');
    assert.equal(queueStatus?.label, '后台任务完成会自动继续该对话');

    const planStatus = wakeup.resolveTurnWakeupStatus({
        locale: 'zh-CN',
        sessionId: 'session-1',
        turnId: 'turn-1',
        stage: 'complete',
        isLatestTurn: true,
        now,
        scheduledTasks: [
            {
                id: 'plan-1',
                enabled: true,
                sessionId: 'session-1',
                cadence: 'daily',
                runAt: '19:30',
                title: 'Daily verification'
            }
        ]
    });
    assert.equal(planStatus?.kind, 'scheduled_plan');
    assert.equal(planStatus?.label, '后台任务完成会自动继续该对话');
    assert.ok(planStatus?.detail);
});

test('task.schedule_wakeup built-in tool executes in AgentRunner and round-trips through extractScheduledWakeupFromEvents', async () => {
    const registry = new AgentToolRegistry();
    let step = 0;
    // A host that never re-runs the conversation does not offer the tool: its timer would never fire.
    await new AgentRunner({ tools: registry, permissionMode: 'read_only', model: { async complete(request) {
        assert.ok(!request.tools?.some(tool => tool.name === 'task.schedule_wakeup'), 'no wakeup tool without the host opt-in');
        return { content: 'done' };
    } } }).run({ prompt: 'Wait 3 minutes and then continue.', runId: 'run-wakeup-test-000' });
    const runner = new AgentRunner({
        tools: registry,
        permissionMode: 'read_only',
        conversationWakeups: true,
        model: {
            async complete(request) {
                step += 1;
                assert.ok(
                    request.tools?.some(tool => tool.name === 'task.schedule_wakeup'),
                    'task.schedule_wakeup must be exposed to the model'
                );
                if (step === 1) {
                    return {
                        content: 'Scheduling a timer for quota reset.',
                        toolCalls: [
                            {
                                id: 'call-wakeup-1',
                                name: 'task.schedule_wakeup',
                                arguments: {
                                    delaySeconds: 180,
                                    prompt: 'Continue the pending verification after quota reset',
                                    reason: 'Quota reset at 18:40'
                                }
                            }
                        ],
                        usage: { inputTokens: 20, outputTokens: 15 }
                    };
                }
                return {
                    content: 'Timer armed; this conversation will automatically continue when the timer fires.',
                    usage: { inputTokens: 30, outputTokens: 15 }
                };
            }
        }
    });

    const result = await runner.run({ prompt: 'Wait 3 minutes and then continue.', runId: 'run-wakeup-test-001' });
    assert.equal(result.status, 'completed');
    const extracted = wakeup.extractScheduledWakeupFromEvents(result.events);
    assert.ok(extracted, 'scheduled wakeup event must be extractable from run events');
    assert.equal(extracted.delaySeconds, 180);
    assert.equal(extracted.prompt, 'Continue the pending verification after quota reset');
    assert.equal(extracted.reason, 'Quota reset at 18:40');

    const base = { locale: 'zh-CN', sessionId: 'session-1', turnId: 'turn-1', stage: 'complete', isLatestTurn: true, events: result.events };
    // Only an armed timer for this turn is promised; a wakeup merely recorded in the events (restart, stop) is not.
    assert.equal(wakeup.resolveTurnWakeupStatus(base), undefined);
    assert.equal(wakeup.resolveTurnWakeupStatus({ ...base, sessionWakeupTimer: { ...extracted, turnId: 'turn-0' } }), undefined);
    const status = wakeup.resolveTurnWakeupStatus({ ...base, sessionWakeupTimer: { ...extracted, turnId: 'turn-1' } });
    assert.equal(status?.kind, 'timer');
    assert.equal(status?.label, '后台任务完成会自动继续该对话');
});

test('desktop widget renders .nmx-turn-wakeup-status on the left of TurnDuration, time, thumbs-up, thumbs-down, and more', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
    const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');

    const turnMenu = source.match(/\{stage !== 'running' && <div className='nmx-turn-copy'>[\s\S]*?<\/div>\}/)?.[0] || '';
    assert.ok(turnMenu, 'settled .nmx-turn-copy footer must exist');

    const wakeupIndex = turnMenu.indexOf('nmx-turn-wakeup-status');
    const durationIndex = turnMenu.indexOf('<TurnDuration');
    const timeIndex = turnMenu.indexOf('<time>');
    const upIndex = turnMenu.indexOf("data-relay-feedback='up'");
    const downIndex = turnMenu.indexOf("data-relay-feedback='down'");
    const moreIndex = turnMenu.indexOf("data-message-action='more'");

    assert.ok(
        wakeupIndex > 0 && wakeupIndex < durationIndex && durationIndex < timeIndex && timeIndex < upIndex && upIndex < downIndex && downIndex < moreIndex,
        'wakeup status badge must appear on the left of TurnDuration, time, thumbs-up, thumbs-down, and more'
    );
    assert.match(source, /scheduleConversationWakeup\(/);
    assert.match(source, /scheduleTurnWakeupFromEvents\(/);
    assert.match(style, /\.nmx-turn-wakeup-status\s*\{/);
    assert.match(style, /\.nmx-turn-wakeup-dot\s*\{[\s\S]*?animation:\s*nmx-turn-wakeup-pulse/);
    assert.match(style, /@keyframes\s+nmx-turn-wakeup-pulse/);
});

test('NextMuxDesktopWidget scheduleTurnWakeupFromEvents arms timer and wakes conversation when timer fires', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widgetClass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const clearMethod = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'clearConversationWakeup');
    const scheduleMethod = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'scheduleConversationWakeup');
    const fromEventsMethod = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'scheduleTurnWakeupFromEvents');
    assert.ok(clearMethod && scheduleMethod && fromEventsMethod);

    const timers = new Map();
    let nextTimerId = 1;
    const enqueued = [];
    const drained = [];
    const windowMock = {
        setTimeout: (fn, delay) => {
            const id = nextTimerId++;
            timers.set(id, { fn, delay });
            return id;
        },
        clearTimeout: id => {
            timers.delete(id);
        }
    };
    const Harness = new Function(
        'extractScheduledWakeupFromEvents',
        'window',
        ts.transpile(
            `class Harness {
                ${clearMethod.getText(file)}
                ${scheduleMethod.getText(file)}
                ${fromEventsMethod.getText(file)}
            }; return Harness;`,
            { target: ts.ScriptTarget.ES2022 }
        )
    )(wakeup.extractScheduledWakeupFromEvents, windowMock);

    const turn = {
        id: 'turn-1',
        stage: 'complete',
        events: [
            {
                type: 'tool_completed',
                callId: 'c1',
                toolName: 'task.schedule_wakeup',
                ok: true,
                summary: {
                    params: {
                        delaySeconds: 60,
                        wakeAt: Date.now() + 60_000,
                        prompt: 'Wake up and continue task',
                        reason: 'Wait 1 minute'
                    }
                }
            }
        ]
    };
    const session = { id: 'session-1', turns: [turn] };
    const widget = Object.assign(new Harness(), {
        isDisposed: false,
        applicationExitPreparing: false,
        conversationWakeupTimers: new Map(),
        codingSessions: [session],
        conversationHistoryReady: () => true,
        conversationHasActiveRun: () => false,
        enqueueFollowUpTask: (sessionId, workbench, prompt) => {
            enqueued.push({ sessionId, workbench, prompt });
            return true;
        },
        requestFollowUpQueueDrain: sessionId => {
            drained.push(sessionId);
        },
        update: () => {}
    });

    widget.scheduleTurnWakeupFromEvents('session-1', turn);
    assert.equal(widget.conversationWakeupTimers.size, 1);
    assert.equal(timers.size, 1);

    const statusWhileWaiting = wakeup.resolveTurnWakeupStatus({
        locale: 'zh-CN',
        sessionId: 'session-1',
        turnId: 'turn-1',
        stage: 'complete',
        isLatestTurn: true,
        sessionWakeupTimer: widget.conversationWakeupTimers.get('session-1')
    });
    assert.equal(statusWhileWaiting?.kind, 'timer');
    assert.equal(statusWhileWaiting?.label, '后台任务完成会自动继续该对话');

    // Fire the timer
    const [{ fn }] = timers.values();
    // History still loading when the timer fires: the wakeup is re-armed briefly, not dropped.
    let historyReady = false;
    widget.conversationHistoryReady = () => historyReady;
    timers.clear(); fn();
    assert.equal(widget.conversationWakeupTimers.get('session-1')?.turnId, 'turn-1');
    assert.deepEqual(enqueued, []);
    const [{ fn: retry, delay }] = timers.values();
    assert.equal(delay, 2_000);
    historyReady = true;
    retry();
    assert.equal(widget.conversationWakeupTimers.size, 0);
    assert.deepEqual(enqueued, [{ sessionId: 'session-1', workbench: 'coding', prompt: 'Wake up and continue task' }]);
    assert.deepEqual(drained, ['session-1']);
});

