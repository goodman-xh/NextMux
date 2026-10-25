import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { classifyModelError, formatModelError, MODEL_ERROR_LOCALES } from '@nextmux/model-runtime/errors';
import { modelFailure, modelFailureText, modelFailureSource } from '../lib/browser/nextmux-model-errors.js';
import { conversationErrorText, conversationErrorDetail } from '../lib/browser/nextmux-conversation-stream-model.js';
import { normalizeDesktopFailure } from '../lib/browser/nextmux-agent-outcome-locale.js';
import { officialDiscoverySummary } from '../lib/browser/nextmux-official-discovery.js';
import { appPluginError, appPluginText } from '../lib/browser/nextmux-app-plugins-locale.js';
import { runningTaskText } from '../lib/browser/nextmux-running-task-locale.js';
import { comicKindText } from '../lib/browser/nextmux-comic-kinds.js';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const { comicVisualExportErrorText } = loadCurrentSource(new URL('../src/browser/nextmux-comic-visual-errors.ts', import.meta.url));

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['validateExistingOfficialConnection', 'officialConnectionRequestIsCurrent', 'refreshOfficialConnectionModels', 'discoverLocalDraftModels',
    'submitRunningDirection', 'applyQueuedFollowUpAsDirection', 'runComicAdaptationPrompt', 'deskDrawPortrait',
    'classifyComicVoiceFallback', 'queueMediaJob', 'updateMediaJob', 'mediaAcceptedHttpsAssetRecovery', 'loadMediaState', 'startComicExport', 'handleAppPluginMessage', 'renderModelFailureAction'];
const methods = names.map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast));
methods.push(...widget.members.filter(node => ['comicErrorState', 'comicError', 'comicErrorDetail'].includes(node.name?.getText(ast))).map(node => node.getText(ast)));
const answered = [];
const dependencies = { COMIC_VOICE_INTENT_THRESHOLD: 0.7, React, modelFailure, modelFailureText, modelFailureSource, appPluginError, appPluginText, runningTaskText, comicVisualExportErrorText,
    comicKindText, officialDiscoverySummary, activeRunBelongsToSession: (active, id) => active === id,
    optionalKeyPriceQuoteId: value => value, mediaRuntimeText: (_locale, key) => key,
    localizeDesktopSurface: (_locale, text) => text, requestAnimationFrame() {},
    window: { nextmuxDesktop: { answerAppPlugin: async (...args) => answered.push(args) } } };
const Harness = new Function(...Object.keys(dependencies), ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`,
    { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }))(...Object.values(dependencies));
const auth = { error: { code: 'invalid_api_key', message: 'The API key is invalid.' }, status: 401 };
const quota = { error: { code: 'insufficient_quota', message: 'Insufficient credits' }, status: 429 };
const limited = { error: { code: 429, message: 'Rate limit exceeded', metadata: { provider_name: 'OpenRouter' } }, headers: { 'retry-after': '17' } };
const rpcError = (value, source = 'own_api') => Object.assign(new Error('Model request failed'), {
    data: { readableError: classifyModelError(value, { source }) }
});
const fail = value => async () => { throw value; };
const connection = { id: 'fixture-connection', providerId: 'openai', label: 'Fixture', model: 'fixture-model', baseUrl: 'https://example.invalid/v1', discoveredModels: [] };
function fixture(service = {}) {
    const notices = [];
    return Object.assign(new Harness(), { desktopLocale: 'zh-CN', update() {}, platformService: service, notices,
        addNotification: (...args) => notices.push(args), officialConnectionStage: 'idle', officialConnectionError: '',
        officialConnectionRequestToken: 0, isDisposed: false,
        verifyEnabledOfficialModels() {}, refreshOfficialModelsAfterMutation: async () => {},
        activeComicWorkspaceRoot: '/fixture', comicLoadSequence: 1, mediaLoadSequence: 0, mediaStage: 'idle', agentStage: 'idle',
        comicProject: () => ({ id: 'project', title: 'Fixture' }), comicHasDirtyDraft: () => false,
        comicWorkspaceRequestCurrent: () => true, comicExternalChange: false,
        ct: (_key, values) => values?.error || '', loadComicLibrary() {}, activeAgentRunId: '' });
}

test('conversation retains structured reasons, retry history and details after failure normalization', () => {
    const original = rpcError(limited);
    const normalized = normalizeDesktopFailure('zh-CN', original);
    assert.equal(normalized.readableError.kind, 'rate_limited');
    const shown = conversationErrorText('zh-CN', normalized, { retryCount: 2, relaySwitchCount: 1 });
    assert.match(shown, /17/);
    assert.match(shown, /2/);
    assert.match(shown, /1/);
    assert.match(conversationErrorDetail('zh-CN', normalized), /Rate limit exceeded/);
    assert.notEqual(conversationErrorText('zh-CN', quota, { source: 'own_api' }), conversationErrorText('zh-CN', { code: 'insufficient_balance' }, { source: 'relay' }));
});

test('own API connection checks, model discovery and local discovery show mapped errors', async () => {
    for (const [method, rpc, source, args] of [
        ['validateExistingOfficialConnection', 'saveOfficialModelConnection', 'own_api', [connection]],
        ['refreshOfficialConnectionModels', 'refreshOfficialModelDiscovery', 'own_api', [connection]],
        ['discoverLocalDraftModels', 'discoverLocalModels', 'local', []]
    ]) {
        const error = rpcError(source === 'local' ? { code: 'ECONNREFUSED', message: 'Connection refused' } : auth, source);
        const h = fixture({ [rpc]: fail(error) });
        h.officialProviderSheet = { id: 'ollama' }; h.officialDraft = { baseUrl: 'http://localhost:11434/v1' };
        await h[method](...args);
        assert.equal(h.officialConnectionError, modelFailure('zh-CN', error, { source }).text, method);
        assert.equal(h.officialConnectionStage, 'idle');
    }
    assert.equal(officialDiscoverySummary('ja', { ...connection, modelDiscoveryError: classifyModelError(auth, { source: 'own_api' }) }), formatModelError(auth, 'ja', { source: 'own_api' }).text);
});

test('steer and queued follow-up failures keep the draft and explain the actual provider issue', async () => {
    const error = rpcError(limited);
    const h = fixture({ sendAgentRunMessage: fail(error) });
    // A steer now enqueues first and the send path reports the provider failure; keep the same RPC error.
    h.submitRunningMessage = fail(error);
    const task = { id: 'follow', prompt: 'keep this direction', attachments: [] };
    Object.assign(h, { conversationHistoryReady: () => true, activeCodingSession: () => ({ id: 'session' }),
        prompt: 'keep this direction', runningDirectionBlocker: () => '', activeAgentRunId: 'run', activeAgentSessionId: 'session',
        activeAgentTurnId: 'turn', activeCodingSessionId: 'session', agentQuestions: { visible: () => false },
        codingSessions: [{ id: 'session', followUpQueue: [task] }], setQueuedFollowUpTaskError: (_session, _task, text) => { h.queueError = text; } });
    assert.equal(await h.submitRunningDirection(), false);
    assert.equal(h.attachmentError, modelFailure('zh-CN', error).text);
    assert.equal(h.prompt, 'keep this direction');
    await h.applyQueuedFollowUpAsDirection('session', 'follow');
    assert.equal(h.queueError, h.attachmentError);
});

test('script, cast, media creation/retry/polling, voice and export catches share readable errors', async () => {
    const error = rpcError(quota);
    const expected = modelFailure('zh-CN', error).text;
    const script = fixture(); script.runComicTextAgent = fail(error);
    await script.runComicAdaptationPrompt('/fixture', 'fixture brief');
    assert.equal(script.comicAdaptation.message, expected);
    const cast = fixture({ generateComicCharacterPortrait: fail(error) });
    cast.comicDesk = { workspaceRoot: '/fixture', drawing: new Set(), portraitErrors: new Map() };
    cast.comicStepMediaRoute = () => ({ id: 'fixture', kind: 'official', model: 'fixture' });
    await cast.deskDrawPortrait('character');
    assert.equal(cast.comicDesk.portraitErrors.get('character'), expected);
    for (const kind of ['image', 'video', 'speech', 'music']) {
        let enqueueAttempts = 0;
        const h = fixture({ enqueueMediaJob: async () => { enqueueAttempts += 1; throw error; } });
        Object.assign(h, { mediaDraft: { kind }, activeComicScene: () => ({ id: 'scene' }), activeComicShot: () => ({ id: 'shot' }),
            mediaRequestInput: () => ({ prompt: 'fixture' }), mediaDraftReady: () => true,
            comicMediaRoute: () => ({ kind: 'official' }),
            comicPrepareMediaInput: async (_kind, input) => input });
        await h.queueMediaJob(); assert.equal(h.mediaError, expected, kind);
        assert.equal(enqueueAttempts, 1, `${kind} reaches the failing RPC after media input preparation`);
    }
    const poll = fixture({ getMediaWorkspaceState: fail(error), retryMediaJob: fail(error) });
    await poll.loadMediaState(); assert.equal(poll.mediaError, expected);
    await poll.updateMediaJob({ id: 'job' }, 'retry'); assert.equal(poll.mediaError, expected);
    const output = fixture({ startComicExport: fail(error) });
    Object.assign(output, { comicExportStage: 'idle', comicExportState: {}, comicExportDraft: { fileName: 'fixture' } });
    assert.equal(await output.startComicExport(), false); assert.equal(output.comicExportError, expected);
});

test('plugin decisions and vision retain metadata for the runtime and display a localized notice', async () => {
    for (const [type, rpc] of [['decide', 'decideAppPlugin'], ['describe', 'describeAppPluginFrame']]) {
        const readableError = classifyModelError(auth, { source: 'own_api' });
        const result = { ok: false, error: 'decision_failed', readableError };
        const h = fixture({ [rpc]: async () => result });
        await h.handleAppPluginMessage({ type, requestId: type, model: {}, images: [] });
        assert.equal(h.notices[0][2], formatModelError(readableError, 'zh-CN').text);
        assert.equal(answered.at(-1)[1], result, 'provider metadata is not replaced with localized prose on the runtime path');
    }
});

test('existing notice actions open the relevant surface and retry only through the supplied handler', () => {
    const h = fixture(); const calls = [];
    Object.assign(h, { mediaStage: 'idle', selectModelCenterView: () => calls.push('settings'), openWalletTopup: () => calls.push('top_up'),
        openMyApis: () => calls.push('my_apis'),
        toggleComposerRelayPicker: () => calls.push('switch_relay'), toggleCodingPopover: () => calls.push('switch_model') });
    for (const value of [rpcError(auth), rpcError({ code: 'insufficient_balance' }, 'relay'), rpcError(limited)]) {
        const action = h.renderModelFailureAction(value, () => calls.push('retry'));
        assert.ok(React.isValidElement(action)); assert.equal(action.props.disabled, false);
        action.props.onClick();
    }
    assert.deepEqual(calls, ['settings', 'my_apis', 'top_up', 'retry']);
    assert.equal(h.renderModelFailureAction(rpcError(limited)), undefined, 'an unsafe or unavailable retry handler is never invented');
    assert.equal(modelFailureText('zh-CN', new Error('工程文件无法保存')), '操作未能完成，请查看详情。');
});

test('a reopened plugin run shows the preserved decision/vision error and details in the run bar', async () => {
    const viewSource = await readFile(new URL('../src/browser/nextmux-app-plugins-view.tsx', import.meta.url), 'utf8');
    const viewAst = ts.createSourceFile('view.tsx', viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const bar = viewAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AppPluginRunBar');
    const View = new Function('React', 'modelFailure', 'appPluginError', 't', 'appPluginReason', 'formatDuration', 'formatUsd',
        ts.transpile(`${bar.getText(viewAst).replace('export ', '')}; return AppPluginRunBar;`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }))(
            React, modelFailure, appPluginError, appPluginText, () => '', () => '1s', () => '$0');
    const readableError = classifyModelError(quota, { source: 'own_api' });
    const node = View({ locale: 'zh-CN', run: { error: 'vision_failed', readableError, name: 'Fixture', elapsedMs: 0, startedAt: 0, costUsd: 0 }, now: 0 });
    const error = node.props.children.find(child => child?.props?.className === 'nmx-plugin-muted is-error');
    assert.equal(error.props.children, formatModelError(readableError, 'zh-CN').text);
    assert.match(error.props.title, /Insufficient credits/);
});

test('legacy run categories never replace a more specific preserved provider failure', () => {
    const readableError = classifyModelError(quota, { source: 'own_api' });
    const wrapped = { code: 'MODEL_CALL_FAILED', message: 'Rate limited', kind: 'rate_limited', readableError };
    assert.equal(conversationErrorText('zh-CN', wrapped), formatModelError(readableError, 'zh-CN').text);
    const normalized = normalizeDesktopFailure('zh-CN', wrapped);
    assert.equal(normalized.readableError.kind, 'provider_quota_exhausted');
});

test('unknown model failures stay localized while untyped local errors use operation fallback in all twelve locales', () => {
    const message = 'An unusual issue occurred.';
    const readableError = classifyModelError(message);
    assert.equal(readableError.kind, 'unknown');
    const localMessages = ['工程文件无法保存', '目前媒體工作不能暫停', 'Media job is not owned by this worker', 'Le fichier ne peut pas être enregistré.', 'Invalid request parameter for local export'];
    for (const locale of MODEL_ERROR_LOCALES) {
        for (const value of [readableError, { message, readableError }, Object.assign(new Error(message), { data: { readableError } })]) {
            assert.equal(modelFailureText(locale, value), formatModelError(value, locale).text, locale);
        }
        for (const source of ['own_api', 'relay', 'local']) {
            assert.equal(modelFailureText(locale, new Error(message), { source }), formatModelError(message, locale, { source }).text, `${locale}/${source}`);
        }
        for (const raw of localMessages) {
            const failure = modelFailure(locale, Object.assign(new Error(raw), { code: 'JOB_NOT_PAUSABLE' }));
            assert.equal(failure.domain, 'operation');
            assert.equal(failure.text, formatModelError({ domain: 'operation', message: raw }, locale).text);
            assert.notEqual(failure.text, raw, `${locale} never guesses the language from its script`);
            assert.ok(failure.detail.includes(raw));
            assert.equal(failure.action, 'none');
        }
    }
    assert.equal(modelFailureText('en', new Error('Project file could not be saved.')), 'The operation could not be completed. See details for more information.');
    assert.equal(modelFailureText('zh-CN', new Error('工程文件无法保存')), '操作未能完成，请查看详情。');
    assert.equal(modelFailureText('ja', new Error('工程文件无法保存')), '操作を完了できませんでした。詳細を確認してください。');
    assert.equal(modelFailureText('zh-CN', new Error('工程文件无法保存'), { source: 'own_api' }), formatModelError('工程文件无法保存', 'zh-CN', { source: 'own_api' }).text);
});


test('a failed comic voice decision explains the model issue while preserving the transcript fallback', async () => {
    const error = rpcError(auth);
    const h = fixture({ classifyComicVoiceIntent: fail(error) });
    h.setComicPrompt = text => { h.prompt = text; };
    await h.classifyComicVoiceFallback('再往前一点');
    assert.equal(h.prompt, '再往前一点');
    assert.equal(h.comicError, modelFailure('zh-CN', error).text);
});

test('shared formatter keeps concurrent desktop domain metadata without overriding explicit media identities', async () => {
    const { DesktopDomainError } = await import('../lib/common/nextmux-domain-errors.js');
    const { desktopDomainErrorText } = await import('../lib/browser/nextmux-domain-error-locale.js');
    const value = new DesktopDomainError('DESKTOP_OPERATION_FAILED', 'A local operation failed', { field: 'project' }, 'Preserved local diagnostic');
    for (const locale of MODEL_ERROR_LOCALES) {
        const result = modelFailure(locale, value);
        assert.equal(result.text, desktopDomainErrorText(locale, value));
        assert.equal(result.action, 'none');
        assert.equal(result.domain, 'operation');
        assert.match(result.detail, /Preserved local diagnostic/);
        const explicit = { ...value, domain: 'media', messageKey: 'unknown.explicit.media', params: {}, detail: 'Media diagnostic' };
        assert.equal(modelFailure(locale, explicit).text, formatModelError(explicit, locale).text);
        assert.equal(modelFailure(locale, explicit).domain, 'media');
    }
});
