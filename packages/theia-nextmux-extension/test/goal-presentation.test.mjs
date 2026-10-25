import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { goalTurnPresentation } from '../lib/browser/nextmux-goal-presentation.js';
import { createConversationHistoryMirror, readConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';

const initial = text => `执行持续目标：${text}\n完成后请验证结果；若尚未完成继续处理，完成时在最后一行输出 [GOAL_COMPLETE]。`;
const resume = text => `继续执行持续目标：${text}\n检查已有结果并继续未完成部分；完成时在最后一行输出 [GOAL_COMPLETE]。`;
const automatic = (values = {}) => ({ prompt: initial('Read the current file.'), response: 'Verified current bytes.\n[GOAL_COMPLETE]', goalPresentationOrigin: 'automatic-v1', ...values });
const delta = text => ({ type: 'assistant_delta', turn: 1, delta: text, at: '2026-09-23T00:00:00Z' });

for (const envelope of [initial, resume]) test(`automatic ${envelope.name} shows and copies only the public prompt and response without altering execution data`, () => {
    const raw = Object.freeze(automatic({ prompt: envelope('第一行\n第二行') }));
    const before = JSON.stringify(raw), visible = goalTurnPresentation(raw);
    assert.equal(visible.prompt, '第一行\n第二行');
    assert.equal(visible.response, 'Verified current bytes.');
    assert.equal(JSON.stringify(raw), before);
    assert.match(raw.response, /\[GOAL_COMPLETE\]$/, 'the completion detector still reads its original marker');
});

test('ordinary user turns, approximate legacy wrappers and explicit marker tasks preserve their authored output', () => {
    for (const input of [
        automatic({ goalPresentationOrigin: 'user' }),
        automatic({ goalPresentationOrigin: undefined, prompt: initial('goal') + '\nextra user text' }),
        automatic({ goalPresentationOrigin: undefined, prompt: 'Explain [GOAL_COMPLETE].' }),
        automatic({ prompt: initial('Write [GOAL_COMPLETE] exactly as a demonstration.') }),
        automatic({ prompt: initial('Explain the GOAL_COMPLETE protocol.') }),
        automatic({ prompt: 'A damaged automatic prompt' })
    ]) assert.equal(goalTurnPresentation(input).response, input.response);
    assert.equal(goalTurnPresentation(automatic({ goalPresentationOrigin: 'user' })).prompt, initial('Read the current file.'));
});

test('exact legacy envelopes remain displayable after the goal is deleted and history is reopened', () => {
    for (const origin of [undefined, 'automatic-v1', 'user']) {
        const input = automatic({ id: 'turn', createdAt: 1, stage: 'complete', error: '', goalPresentationOrigin: origin });
        const saved = createConversationHistoryMirror([{ id: 'session', updatedAt: 2, turns: [input] }]);
        const restored = readConversationHistoryMirror(JSON.stringify(saved)).sessions[0].turns[0];
        assert.equal(restored.goalPresentationOrigin, origin);
        assert.equal(restored.prompt, input.prompt); assert.equal(restored.response, input.response);
        assert.equal(goalTurnPresentation(restored).response, origin === 'user' ? input.response : 'Verified current bytes.');
    }
    const saved = createConversationHistoryMirror([{ id: 'session', updatedAt: 2, turns: [automatic({ id: 'turn', goalPresentationOrigin: 'invalid' })] }]);
    assert.equal(saved.sessions[0].turns[0].goalPresentationOrigin, 'user');
});

for (const response of [
    'A marker [GOAL_COMPLETE] in a sentence.',
    'Example:\n[GOAL_COMPLETE]\nThere is more output.',
    '> [GOAL_COMPLETE]',
    '> Quoted protocol example\n[GOAL_COMPLETE]',
    '    [GOAL_COMPLETE]',
    '```text\n[GOAL_COMPLETE]',
    '~~~\n[GOAL_COMPLETE]',
    '```text\n[GOAL_COMPLETE]\n```',
    'The literal token is `[GOAL_COMPLETE]`.',
]) test(`preserves authored marker context ${JSON.stringify(response)}`, () => {
    assert.equal(goalTurnPresentation(automatic({ response })).response, response);
});

test('only the last bare marker is removed, including CRLF and harmless trailing whitespace', () => {
    const raw = 'Example:\n[GOAL_COMPLETE]\nThe example is done.\r\n[GOAL_COMPLETE]  \r\n';
    assert.equal(goalTurnPresentation(automatic({ response: raw })).response, 'Example:\n[GOAL_COMPLETE]\nThe example is done.');
    assert.equal(goalTurnPresentation(automatic({ response: '[GOAL_COMPLETE]' })).response, '');
});

test('ordered output projects split footer text without reordering or changing media assets', () => {
    const image = Object.freeze({ type: 'image', asset: { sha256: 'a'.repeat(64), mimeType: 'image/png', sizeBytes: 100 } });
    const parts = Object.freeze([image, Object.freeze({ type: 'text', text: 'Result\n[GOAL_' }), Object.freeze({ type: 'text', text: 'COMPLETE]' })]);
    const output = goalTurnPresentation(automatic({ outputParts: parts }));
    assert.equal(output.outputParts[0], image);
    assert.equal(output.outputParts.filter(p => p.type === 'text').map(p => p.text).join(''), 'Result');
    assert.equal(parts[1].text, 'Result\n[GOAL_');
    for (const separated of [[parts[1], image, parts[2]], [{ type: 'text', text: '[GOAL_COMPLETE]' }, image]]) {
        const response = separated.filter(part => part.type === 'text').map(part => part.text).join('');
        const shown = goalTurnPresentation(automatic({ response, outputParts: separated, events: [delta(response)] }));
        assert.equal(shown.outputParts, separated); assert.equal(shown.response, response);
        assert.equal(shown.events[0].delta, response);
    }
});

test('stream projection recomputes from immutable deltas so later genuine text is never lost', () => {
    const events = Object.freeze([Object.freeze(delta('Answer\n[GOAL_')), Object.freeze(delta('COMPLETE]'))]);
    assert.equal(goalTurnPresentation(automatic({ events })).events.map(e => e.delta).join(''), 'Answer');
    const continued = [...events, delta('\nMore actual task output.')];
    assert.equal(goalTurnPresentation(automatic({ events: continued })).events, continued);
    assert.equal(events.map(e => e.delta).join(''), 'Answer\n[GOAL_COMPLETE]');
    const code = [delta('```\n'), delta('[GOAL_COMPLETE]')];
    assert.equal(goalTurnPresentation(automatic({ events: code })).events, code);
});

test('tool, steering and model boundaries retain earlier marker text and every failure receipt', () => {
    const error = { type: 'model_attempt_completed', outcome: 'failed', failure: { code: 'NETWORK_ERROR' }, at: 'now' };
    const prior = delta('Earlier\n[GOAL_COMPLETE]');
    const events = [prior, { type: 'tool_started', callId: 'read', toolName: 'workspace.read_file' }, { type: 'model_started', turn: 2 }, delta('Last\n[GOAL_COMPLETE]'), error];
    const shown = goalTurnPresentation(automatic({ events })).events;
    assert.equal(shown[0], prior); assert.equal(shown.at(-1), error); assert.equal(shown[3].delta, 'Last');
});

test('new ordinary turn construction explicitly prevents legacy inference for user-authored protocol text', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxDesktopWidget');
    const method = widget.members.find(n => n.name?.getText(file) === 'createCodingTurn').getText(file);
    const Harness = new Function('serializePastedTextReferences', 'optionalKeyPriceQuoteId', ts.transpile(`class Harness { ${method} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(() => '[]', () => undefined);
    const turn = new Harness().createCodingTurn('session', initial('goal'), 'read_only', 'route', 'route');
    assert.equal(turn.goalPresentationOrigin, 'user');
    assert.equal(goalTurnPresentation({ ...turn, response: '[GOAL_COMPLETE]' }).response, '[GOAL_COMPLETE]');
});

test('the actual dispatch block marks only automatic goal work and preserves raw execution fields', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let dispatch;
    function visit(node) {
        if (ts.isIfStatement(node) && node.expression.getText(file) === 'codingSession && codingTurn'
            && node.getText(file).includes('queuedExecution?.task.automaticGoal')) dispatch = node.getText(file);
        ts.forEachChild(node, visit);
    }
    visit(file); assert.ok(dispatch);
    const execute = new Function('queuedExecution', 'initialTurn', ts.transpile(`
        let codingTurn = initialTurn; const codingSession = { id: 'session' }, submittedRelaySource = 'off', runReasoningSettings = {};
        ${dispatch}; return codingTurn;`, { target: ts.ScriptTarget.ES2022 }));
    for (const automaticGoal of [true, false]) {
        const updates = [];
        const raw = { id: 'turn', prompt: initial('goal'), response: 'response', goalPresentationOrigin: 'user' };
        const turn = execute.call({ updateCodingTurn: (...values) => updates.push(values) }, { task: { automaticGoal } }, raw);
        assert.equal(turn.goalPresentationOrigin, automaticGoal ? 'automatic-v1' : 'user');
        assert.equal(updates[0][2].goalPresentationOrigin, turn.goalPresentationOrigin);
        assert.equal(turn.prompt, raw.prompt); assert.equal(turn.response, raw.response);
        assert.equal(raw.goalPresentationOrigin, 'user');
    }
});

test('production render and clipboard bindings use the same projection for legacy goals and ordered media', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
    const React = core('react'), { renderToStaticMarkup } = core('react-dom/server');
    const { assistantOutputPresentation } = await import('../lib/browser/nextmux-assistant-output.js');
    const { appendAgentActivityEvents } = await import('../lib/browser/nextmux-agent-activity.js');
    const { runtimeFinalText } = await import('../lib/browser/nextmux-agent-outcome-locale.js');
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxDesktopWidget');
    const method = name => widget.members.find(n => n.name?.getText(file) === name).getText(file);
    const names = ['recordedActivityEvents', 'originalRawResponse', 'publicTurn', 'activityEvents', 'rawResponse', 'response', 'responseParts', 'assistantCopyText'];
    const values = new Map(); let copyUser, renderUser;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(file))) values.set(node.name.getText(file), node.initializer.getText(file));
        if (ts.isCallExpression(node) && node.arguments[0]?.getText(file) === 'publicTurn.prompt') {
            if (node.expression.getText(file) === 'this.copyToClipboard') copyUser = node.getText(file);
            if (node.expression.getText(file) === 'this.renderUserMessage') renderUser = node.getText(file);
        }
        ts.forEachChild(node, visit);
    }
    visit(widget.members.find(n => n.name?.getText(file) === 'renderCodingWorkbench'));
    assert.equal(values.size, names.length); assert.ok(copyUser); assert.ok(renderUser);
    const dependencies = { React, goalTurnPresentation, assistantOutputPresentation, appendAgentActivityEvents, runtimeFinalText,
        localizeDesktopSurface: (_locale, text) => text, conversationText: () => 'copied', conversationMessageId: turn => turn.id,
        withoutReplayedContextNote: (await import('../lib/browser/nextmux-conversation-branch.js')).withoutReplayedContextNote };
    const Harness = new Function(...Object.keys(dependencies), ts.transpile(`class Harness {
        ${method('assistantMessageCopyText')}
        ${method('renderAssistantOutput')}
        render(turn) {
            const live = false, liveResult = undefined, stage = 'complete', displayError = '';
            ${names.map(name => `const ${name} = ${values.get(name)};`).join('\n')}
            ${copyUser}; this.copyToClipboard(assistantCopyText);
            return <>{${renderUser}}{this.renderAssistantOutput(response, responseParts, 'session', turn.id)}</>;
        }
    }; return Harness;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }))(...Object.values(dependencies));
    const copies = [], view = Object.assign(new Harness(), { desktopLocale: 'en', liveAgentEvents: [],
        renderAssistantResponse: text => React.createElement('p', null, text), renderUserMessage: text => React.createElement('p', null, text),
        copyToClipboard: text => copies.push(text), completedAgentSummary: () => { throw Error('must not synthesize over a control-only response'); },
        agentOutputAssetKey: () => 'image', agentOutputAssetUrls: new Map([['image', { dataUrl: 'data:image/png;base64,AA==' }]]), agentOutputAssetErrors: new Set() });
    const turn = automatic({ id: 'turn', goalPresentationOrigin: undefined, outputParts: [
        { type: 'image', asset: { sha256: 'a'.repeat(64), mimeType: 'image/png', sizeBytes: 100 } },
        { type: 'text', text: 'Verified current bytes.\n[GOAL_COMPLETE]' }
    ] });
    const html = renderToStaticMarkup(view.render(turn));
    assert.match(html, /<img/); assert.match(html, /Verified current bytes/); assert.doesNotMatch(html, /GOAL_COMPLETE|完成后请验证/);
    assert.deepEqual(copies, ['Read the current file.', 'Verified current bytes.']);
    assert.match(turn.outputParts[1].text, /GOAL_COMPLETE/);
    assert.doesNotMatch(renderToStaticMarkup(view.render(automatic({ id: 'control-only', response: '[GOAL_COMPLETE]' }))), /GOAL_COMPLETE/);
});


test('a completed model media receipt prevents premature text-only footer hiding before final result hydration', () => {
    const response = 'Answer\n[GOAL_COMPLETE]';
    const parts = [{ type: 'text', text: response }, { type: 'image', asset: { sha256: 'a'.repeat(64), mimeType: 'image/png', sizeBytes: 100 } }];
    const events = [delta(response), { type: 'model_completed', turn: 1, toolCallCount: 0, outputParts: parts }];
    const visible = goalTurnPresentation(automatic({ response, events }));
    assert.equal(visible.response, response); assert.equal(visible.events, events); assert.equal(visible.outputParts, undefined);
    const newTurn = [...events, { type: 'model_started', turn: 2 }, delta('Done\n[GOAL_COMPLETE]')];
    assert.equal(goalTurnPresentation(automatic({ response: 'Done\n[GOAL_COMPLETE]', events: newTurn })).response, 'Done');
});

test('actual timeline titles and accessibility labels use public goal text without changing history', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
    const React = core('react'), { renderToStaticMarkup } = core('react-dom/server');
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxDesktopWidget');
    const method = widget.members.find(n => n.name?.getText(file) === 'renderThreadNavigator').getText(file);
    const Virtuoso = props => React.createElement('div', null, props.data.map((turn, index) => React.cloneElement(props.itemContent(index, turn), { key: turn.id })));
    const Harness = new Function('React', 'Virtuoso', 'goalTurnPresentation', 'localizeDesktopSurface', ts.transpile(`class Harness { ${method} }; return Harness;`, {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React
    }))(React, Virtuoso, goalTurnPresentation, (_locale, value) => value);
    const view = Object.assign(new Harness(), { codingSessionTitle: value => value, desktopLocale: 'zh-CN' });
    const turn = automatic({ id: 'goal', stage: 'complete' }), saved = JSON.stringify(turn);
    // The rail appears from two turns on; a single turn has nowhere to jump.
    assert.equal(renderToStaticMarkup(view.renderThreadNavigator([turn]) ?? null), '');
    const earlier = automatic({ id: 'earlier', stage: 'complete' });
    const html = renderToStaticMarkup(view.renderThreadNavigator([earlier, turn]));
    // The bar's text is its accessible name; hovering shows it beside the bar (no native tooltip over it).
    assert.match(html, /aria-label="[^"]*Read the current file\."/);
    assert.doesNotMatch(html, / title="/);
    assert.doesNotMatch(html, /GOAL_COMPLETE|完成后请验证|执行持续目标/);
    assert.equal(JSON.stringify(turn), saved);
    assert.match(renderToStaticMarkup(view.renderThreadNavigator([earlier, { ...turn, goalPresentationOrigin: 'user' }])), /GOAL_COMPLETE/);
});


test('damaged historical ordered descriptors preserve recoverable text and the renderer fallback', () => {
    for (const outputParts of [[null], [{ type: 'text', text: null }], { type: 'text' }, [{ type: 'unknown' }]]) {
        const input = automatic({ outputParts });
        const visible = goalTurnPresentation(input);
        assert.equal(visible.response, input.response); assert.equal(visible.outputParts, outputParts);
    }
});

test('a completed reply ending with the marker hides it even when the runtime verification continues the turn', () => {
    // Real journal shape: the model finishes with the marker (no tool calls), then
    // the runtime's change verification starts another model request in the same turn.
    const events = [delta('Created a.txt.\n\n'), delta('[GOAL_COMPLETE]'), { type: 'model_completed', turn: 8, toolCallCount: 0, at: 'now' },
        { type: 'model_started', turn: 9 }, delta('Verification found no configured checks.')];
    const shown = goalTurnPresentation(automatic({ events, response: 'Verification found no configured checks.' })).events;
    assert.equal(shown.filter(event => event.type === 'assistant_delta').map(event => event.delta).join(''),
        'Created a.txt.\nVerification found no configured checks.');
    // A reply that wrote the marker and then called tools was not finished: the text stays.
    const withTools = [delta('Done?\n[GOAL_COMPLETE]'), { type: 'model_completed', turn: 1, toolCallCount: 1, at: 'now' },
        { type: 'tool_started', callId: 'a', toolName: 'workspace.read_file' }, { type: 'model_started', turn: 2 }, delta('Last')];
    assert.equal(goalTurnPresentation(automatic({ events: withTools, response: 'Last' })).events[0].delta, 'Done?\n[GOAL_COMPLETE]');
});
