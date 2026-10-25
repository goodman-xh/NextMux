import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
function sourceModule(name) {
    const result = desktopRequire('esbuild').buildSync({ entryPoints: [fileURLToPath(new URL(`../src/browser/${name}.ts`, import.meta.url))],
        bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' });
    const module = { exports: {} };
    Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
    return module.exports;
}
const queue = sourceModule('nextmux-agent-task-queue'), questions = sourceModule('nextmux-agent-question');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'scheduleAutomaticResume');
const drainInitializers = [];
function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'followUpDrainTargets') drainInitializers.push(node.initializer.getText(file));
    ts.forEachChild(node, visit);
}
visit(file); assert.equal(drainInitializers.length, 1);

function fixture(reason) {
    const timers = [], resumes = [], patches = [];
    const turn = { id: 'turn-a', stage: 'paused', resumeCheckpointId: 'owned-checkpoint', stopReason: reason };
    const session = { id: 'session-a', turns: [turn], followUpQueue: [] };
    const bindings = { ...queue, ...questions, agentPauseBlocksAutomaticDispatch: queue.agentPauseBlocksAutomaticDispatch,
        userQueuedPrompts: value => value, autoResumeDecision: () => ({ action: 'resume', nextAttempt: 1 }), autoResumeDelayMs: () => 1,
        NextMuxDesktopWidget: { AUTO_RESUME_LIMIT: 3 }, window: { setTimeout: action => timers.push(action) } };
    const Widget = new Function(...Object.keys(bindings), ts.transpile(`class Harness { ${method.getText(file)} }; return Harness;`,
        { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
    const widget = Object.assign(new Widget(), { applicationExitPreparing: false, conversationHistoryReady: () => true,
        // No other run owns this conversation in these fixtures.
        conversationHasActiveRun: () => false,
        automaticResumeTurnIds: new Set(), codingSessions: [session], conversationWindows: [], node: { isConnected: true }, agentStage: 'paused',
        activeAgentRunId: '', activeCodingSessionId: session.id, activeThreadTurnId: turn.id,
        updateCodingTurn: (...args) => patches.push(args), resumePausedTurn: (...args) => resumes.push(args),
        agentPollGeneration: 1, agentResult: { stopReason: reason }, directFollowUpDrainTaskIds: new Map() });
    return { widget, turn, session, timers, resumes, patches };
}

test('actual widget never schedules automatic continuation for a media-compaction pause', () => {
    const f = fixture('media_context_compaction_required');
    f.widget.scheduleAutomaticResume(f.session.id, f.turn.id);
    assert.equal(f.timers.length, 0); assert.equal(f.widget.automaticResumeTurnIds.size, 0);
});

test('a previously armed actual timer rechecks a later media pause without changing attempts or dispatching', () => {
    const f = fixture('turn_limit_reached');
    f.widget.scheduleAutomaticResume(f.session.id, f.turn.id); assert.equal(f.timers.length, 1);
    f.turn.stopReason = 'media_context_compaction_required'; f.timers[0]();
    assert.equal(f.resumes.length, 0); assert.equal(f.patches.length, 0); assert.equal(f.widget.automaticResumeTurnIds.size, 0);
});

test('the real completion-finally expression preserves paused queues but retains another explicitly armed task', () => {
    const bindings = { followUpDrainSessionIds: queue.followUpDrainSessionIds,
        questionPausePreservesQueue: questions.questionPausePreservesQueue,
        agentPauseBlocksAutomaticDispatch: queue.agentPauseBlocksAutomaticDispatch };
    const drain = new Function('generation', 'finishedSessionId', 'run', ...Object.keys(bindings), `return ${drainInitializers[0]};`);
    for (const reason of ['media_context_compaction_required', 'pause_requested', 'user_input_cancelled', 'user_input_expired', 'output_truncated']) {
        const f = fixture(reason); f.widget.directFollowUpDrainTaskIds.set('other-explicit-task', true);
        assert.deepEqual(drain.call(f.widget, 1, f.session.id, f.widget, ...Object.values(bindings)), ['other-explicit-task'], reason);
    }
    const f = fixture('completed');
    assert.deepEqual(drain.call(f.widget, 1, f.session.id, f.widget, ...Object.values(bindings)), [f.session.id]);
});

test('ordinary turn-limit continuation and explicit manual checkpoint continuation remain available', () => {
    const f = fixture('turn_limit_reached');
    f.widget.scheduleAutomaticResume(f.session.id, f.turn.id); f.timers[0]();
    assert.deepEqual(f.resumes, [[f.session.id, f.turn.id, false]]); assert.equal(f.patches.length, 1);
    assert.equal(queue.agentManualResumeStrategy(f.turn), 'continue');
    assert.equal(queue.agentManualResumeStrategy({ ...f.turn, stopReason: 'media_context_compaction_required' }), 'continue',
        'after switching to a larger-context model (or trimming media) Continue can proceed; on the same model the runtime pauses again before sending anything');
    assert.equal(queue.agentManualResumeStrategy({ ...f.turn, resumeCheckpointId: undefined, stopReason: 'media_context_compaction_required' }), undefined,
        'without a checkpoint there is nothing to continue');
});

test('output truncation requires explicit continuation and never rearms automatic resume', () => {
    const f = fixture('output_truncated');
    f.widget.scheduleAutomaticResume(f.session.id, f.turn.id);
    assert.equal(f.timers.length, 0);
    assert.equal(queue.agentManualResumeStrategy(f.turn), 'continue');
});

test('media compaction is explained in every locale instead of claiming that a guaranteed-to-fail continuation is ready', () => {
    const locale = sourceModule('nextmux-agent-outcome-locale');
    const summary = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'ensureAgentFinalSummary');
    const Widget = new Function('agentOutcomeText', 'runtimeFinalText', ts.transpile(`class Harness { ${summary.getText(file)} }; return Harness;`,
        { target: ts.ScriptTarget.ES2022 }))(locale.agentOutcomeText, locale.runtimeFinalText);
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const widget = Object.assign(new Widget(), { desktopLocale: language });
        const title = locale.agentOutcomeText(language, 'mediaContextPaused');
        const body = locale.agentOutcomeText(language, 'mediaContextBody');
        assert.ok(title?.trim() && body?.trim()); assert.notEqual(title, locale.agentOutcomeText(language, 'paused'));
        assert.equal(widget.ensureAgentFinalSummary({ stopReason: 'media_context_compaction_required', finalMessage: { origin: 'runtime', stopReason: 'media_context_compaction_required' }, finalText: 'raw runtime diagnostic' }), body);
    }
});
