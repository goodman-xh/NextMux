import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { formatModelError, MODEL_ERROR_LOCALES } from '@nextmux/model-runtime/errors';
import { runningTaskText } from '../lib/browser/nextmux-running-task-locale.js';
import {
    modelFailure,
    modelFailureText,
    modelFailureSource,
    formatScenarioModelError,
    formatScenarioModelErrorText
} from '../lib/browser/nextmux-model-errors.js';
import { conversationErrorText } from '../lib/browser/nextmux-conversation-stream-model.js';
import { canonicalRuntimeFinal } from '../lib/browser/nextmux-agent-outcome-locale.js';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');

test('scenario-differentiated model errors never misdirect non-own_api failures to My API', () => {
    const networkFailure = { code: 'PLATFORM_OFFLINE', message: 'fetch failed ECONNREFUSED' };

    const unselectedRelay = formatScenarioModelError('zh-CN', networkFailure, {
        hasSelectedRelay: false,
        hasSelectedRoute: false
    });
    assert.equal(unselectedRelay.text, '请先选择中转商或自有 API。');
    assert.equal(unselectedRelay.action, 'switch_relay');
    assert.equal(unselectedRelay.actionLabel, '选择中转商');
    assert.equal(unselectedRelay.retryable, false);

    const unselectedModel = formatScenarioModelError('zh-CN', networkFailure, {
        hasSelectedRelay: true,
        hasSelectedRoute: false
    });
    assert.equal(unselectedModel.text, '请先选择模型。');
    assert.equal(unselectedModel.action, 'switch_model');
    assert.equal(unselectedModel.actionLabel, '选择模型');
    assert.equal(unselectedModel.retryable, false);

    const unavailableModel = formatScenarioModelError('zh-CN', runningTaskText('zh-CN', 'modelUnavailable'));
    assert.equal(unavailableModel.text, '当前模型不可用，请切换模型。');
    assert.equal(unavailableModel.action, 'switch_model');
    assert.equal(unavailableModel.actionLabel, '切换模型');

    const genericNetwork = formatScenarioModelError('zh-CN', networkFailure);
    assert.equal(genericNetwork.text, '无法连接模型服务。 请检查网络连接后重试。');
    assert.equal(genericNetwork.action, 'retry');
    assert.equal(genericNetwork.actionLabel, '重试');
    assert.doesNotMatch(genericNetwork.text, /我的 API/);

    const relayNetwork = formatScenarioModelError('zh-CN', networkFailure, { source: 'relay' });
    assert.equal(relayNetwork.text, '无法连接模型服务。 请检查网络或切换中转商。');
    assert.equal(relayNetwork.action, 'retry');
    assert.doesNotMatch(relayNetwork.text, /我的 API/);

    const ownApiThread = formatScenarioModelError('zh-CN', networkFailure, { source: 'own_api', surface: 'thread' });
    assert.equal(ownApiThread.text, '无法连接模型服务。 请检查网络或“我的 API”接口地址。');
    assert.equal(ownApiThread.action, 'settings');
    assert.equal(ownApiThread.actionLabel, '打开我的 API');

    const ownApiCard = modelFailure('zh-CN', networkFailure, { source: 'own_api', surface: 'my_api_card' });
    assert.equal(ownApiCard.text, '无法连接模型服务。');
    assert.equal(modelFailureText('zh-CN', networkFailure, { source: 'own_api' }), '无法连接模型服务。');
    assert.equal(formatScenarioModelErrorText('zh-CN', networkFailure, { source: 'own_api' }), '无法连接模型服务。 请检查网络或“我的 API”接口地址。');

    const localNetwork = formatScenarioModelError('zh-CN', networkFailure, { source: 'local' });
    assert.equal(localNetwork.text, '无法连接模型服务。 请确认本地模型服务已启动。');
    assert.equal(localNetwork.action, 'settings');

    for (const locale of MODEL_ERROR_LOCALES) {
        const generic = formatModelError(networkFailure, locale);
        const relay = formatModelError(networkFailure, locale, { source: 'relay' });
        const own = formatModelError(networkFailure, locale, { source: 'own_api' });
        const local = formatModelError(networkFailure, locale, { source: 'local' });
        assert.equal(generic.action, 'retry', locale);
        assert.equal(relay.action, 'retry', locale);
        assert.equal(own.action, 'settings', locale);
        assert.equal(local.action, 'settings', locale);
        assert.notEqual(generic.text, own.text, locale);
        assert.notEqual(relay.text, own.text, locale);
    }
});

test('conversationErrorText and renderModelFailureAction differentiate unselected relay, unselected model, and network sources', async () => {
    assert.equal(
        conversationErrorText('zh-CN', { code: 'PLATFORM_OFFLINE' }, { hasSelectedRelay: false, hasSelectedRoute: false }),
        '请先选择中转商或自有 API。'
    );
    assert.equal(
        conversationErrorText('zh-CN', { code: 'PLATFORM_OFFLINE' }, { hasSelectedRelay: true, hasSelectedRoute: false }),
        '请先选择模型。'
    );
    assert.equal(
        conversationErrorText('zh-CN', runningTaskText('zh-CN', 'modelUnavailable')),
        '当前模型不可用，请切换模型。'
    );
    assert.equal(
        conversationErrorText('zh-CN', { code: 'PLATFORM_OFFLINE' }),
        '无法连接模型服务。 请检查网络连接后重试。'
    );
    assert.equal(
        conversationErrorText('zh-CN', { code: 'PLATFORM_OFFLINE' }, { source: 'relay' }),
        '无法连接模型服务。 请检查网络或切换中转商。'
    );
    assert.equal(
        conversationErrorText('zh-CN', { code: 'PLATFORM_OFFLINE' }, { source: 'own_api' }),
        '无法连接模型服务。 请检查网络或“我的 API”接口地址。'
    );

    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const renderActionMethod = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'renderModelFailureAction');
    const submitPromptMethod = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'submitPrompt');
    const stopMethod = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'stopConversationAgentRun');
    assert.ok(renderActionMethod && submitPromptMethod && stopMethod);

    const ActionHarness = new Function(
        'React', 'modelFailure', 'relayText',
        ts.transpile(`class ActionHarness { ${renderActionMethod.getText(ast)} }; return ActionHarness;`, {
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.React
        })
    )(React, modelFailure, (_locale, key) => key);

    const calls = [];
    const instance = Object.assign(new ActionHarness(), {
        desktopLocale: 'zh-CN',
        agentStage: 'idle',
        activeAgentRunId: '',
        mediaStage: 'idle',
        activeSection: 'coding',
        selectModelCenterView: view => calls.push(`center:${view}`),
        openMyApis: () => calls.push('my_apis'),
        openWalletTopup: () => calls.push('top_up'),
        openComicModelSetup: () => calls.push('comic_setup'),
        toggleComposerRelayPicker: () => calls.push('relay_picker'),
        toggleCodingPopover: popover => calls.push(`popover:${popover}`)
    });

    const relayAction = instance.renderModelFailureAction(
        { code: 'PLATFORM_OFFLINE' },
        undefined,
        undefined,
        { hasSelectedRelay: false, hasSelectedRoute: false }
    );
    assert.ok(React.isValidElement(relayAction));
    assert.equal(relayAction.props.children, '选择中转商');
    relayAction.props.onClick();
    assert.deepEqual(calls.splice(0), ['relay_picker']);

    const modelAction = instance.renderModelFailureAction(
        { code: 'PLATFORM_OFFLINE' },
        undefined,
        undefined,
        { hasSelectedRelay: true, hasSelectedRoute: false }
    );
    assert.ok(React.isValidElement(modelAction));
    assert.equal(modelAction.props.children, '选择模型');
    modelAction.props.onClick();
    assert.deepEqual(calls.splice(0), ['popover:routes']);

    const genericRetryAction = instance.renderModelFailureAction(
        { code: 'PLATFORM_OFFLINE' },
        () => calls.push('retried'),
        undefined
    );
    assert.ok(React.isValidElement(genericRetryAction));
    assert.equal(genericRetryAction.props.children, '重试');
    genericRetryAction.props.onClick();
    assert.deepEqual(calls.splice(0), ['retried']);

    const ownApiAction = instance.renderModelFailureAction(
        { code: 'PLATFORM_OFFLINE' },
        undefined,
        'own_api'
    );
    assert.ok(React.isValidElement(ownApiAction));
    assert.equal(ownApiAction.props.children, '打开我的 API');
    ownApiAction.props.onClick();
    assert.deepEqual(calls.splice(0), ['center:official', 'my_apis']);

    assert.equal(instance.renderModelFailureAction(undefined, undefined, undefined, { hasSelectedRelay: false }), undefined);
    assert.equal(modelFailureSource(undefined), undefined);

    const SubmitHarness = new Function(
        'runningTaskText',
        ts.transpile(`class SubmitHarness { ${submitPromptMethod.getText(ast)} }; return SubmitHarness;`, {
            target: ts.ScriptTarget.ES2022
        })
    )(runningTaskText);

    const submitInstance = Object.assign(new SubmitHarness(), {
        applicationExitPreparing: false,
        goalComposerActive: true,
        goalComposerSessionId: 's1',
        activeCodingSessionId: 's1',
        prompt: 'build feature',
        desktopLocale: 'zh-CN',
        activeRelayKey: '',
        activeModelRouteId: '',
        modelPickerRelayOpen: false,
        codingPopover: '',
        attachmentError: '',
        activeModelRoute: () => undefined,
        update() {}
    });
    assert.equal(await submitInstance.submitPrompt('coding'), false);
    assert.equal(submitInstance.attachmentError, '请先选择中转商或自有 API。');
    assert.equal(submitInstance.modelPickerRelayOpen, true);
    assert.equal(submitInstance.codingPopover, 'routes');
    // The notice carries its own picker action, bound to this exact text.
    assert.deepEqual(submitInstance.attachmentErrorAction, { text: '请先选择中转商或自有 API。', kind: 'relay' });

    submitInstance.activeRelayKey = 'official:openai';
    assert.equal(await submitInstance.submitPrompt('coding'), false);
    assert.equal(submitInstance.attachmentError, '请先选择模型。');
    assert.equal(submitInstance.modelPickerRelayOpen, false);
    assert.deepEqual(submitInstance.attachmentErrorAction, { text: '请先选择模型。', kind: 'model' });

    submitInstance.activeModelRouteId = 'official:openai:gpt-5';
    assert.equal(await submitInstance.submitPrompt('coding'), false);
    assert.equal(submitInstance.attachmentError, '当前模型不可用，请切换模型。');
    assert.equal(submitInstance.modelPickerRelayOpen, false);
});

test('the composer notice shows its picker action only for its own text and hides once a model is usable', () => {
    const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const notice = /\{this\.attachmentError && !\(this\.attachmentErrorAction\?\.text === this\.attachmentError && this\.activeModelRoute\(\)\)[\s\S]*?<\/div>\}/.exec(widgetSource)?.[0] || '';
    assert.ok(notice, 'composer notice markup');
    assert.match(notice, /this\.attachmentErrorAction\?\.text === this\.attachmentError && <button type='button' className='nmx-attachment-error-action'/);
    assert.match(notice, /this\.modelPickerRelayOpen = this\.attachmentErrorAction\?\.kind === 'relay';\s*this\.codingPopover = 'routes';/);
    assert.match(notice, /'selectRelayAction'[\s\S]*'switchModelAction' : 'selectModelAction'/);
    assert.equal(runningTaskText('en', 'selectRelayAction'), 'Select relay');
    assert.equal(runningTaskText('en', 'selectModelAction'), 'Select model');
});

test('cancelled turns preserve partial streamed response, outputParts, and route/usage/billing metadata', async () => {
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const stopMethod = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'stopConversationAgentRun');
    assert.ok(stopMethod);

    const StopHarness = new Function(
        'mergeAgentEventPollSnapshot', 'appendAgentActivityEvents', 'canonicalRuntimeFinal', 'desktopFailureMessage',
        ts.transpile(`class StopHarness { ${stopMethod.getText(ast)} }; return StopHarness;`, {
            target: ts.ScriptTarget.ES2022
        })
    )(
        (existing, cursor, settled) => ({ events: [...existing, ...(settled.events || [])], cursor: settled.nextCursor ?? cursor }),
        (a, b) => [...(a || []), ...(b || [])],
        canonicalRuntimeFinal,
        (_locale, err) => String(err)
    );

    const patches = [];
    const stopInstance = Object.assign(new StopHarness(), {
        desktopLocale: 'zh-CN',
        activeCodingSessionId: 'session-1',
        codingSessions: [{
            id: 'session-1',
            turns: [{
                id: 'turn-1',
                stage: 'running',
                response: '',
                outputParts: [{ kind: 'text', text: 'Earlier partial chunk' }],
                outputAssetOwnerId: 'owner-1'
            }]
        }],
        conversationAgentRun: () => ({
            activeAgentRunId: 'run-1',
            activeAgentTurnId: 'turn-1',
            liveAgentEvents: [{ type: 'assistant_delta', turn: 1, delta: 'Partial streamed answer', at: '2026-10-22T00:00:00.000Z' }],
            liveAgentChildren: [],
            agentEventCursor: 1
        }),
        platformService: {
            cancelAgentRun: async () => {},
            getAgentRunSnapshot: async () => ({
                status: 'cancelled',
                nextCursor: 2,
                events: [],
                result: {
                    stopReason: 'cancel_requested',
                    finalMessage: { kind: 'cancelled', reason: 'cancel_requested' },
                    finalText: 'Partial streamed answer before stop',
                    outputParts: [{ kind: 'text', text: 'Partial streamed answer before stop' }],
                    outputAssetOwnerId: 'owner-settled',
                    route: { kind: 'official_connection', model: 'gpt-5', modelFamily: 'gpt-5', providerName: 'OpenAI' },
                    usage: { inputTokens: 120, outputTokens: 45 },
                    billing: { kind: 'own_api' },
                    events: []
                }
            })
        },
        agentBillingLabel: () => '自有 API',
        syncConversationAgentView() {},
        updateCodingTurn(sessionId, turnId, patch) {
            patches.push({ sessionId, turnId, patch });
        },
        async flushConversationHistory() {},
        requestFollowUpQueueDrain() {},
        update() {}
    });

    await stopInstance.stopConversationAgentRun('session-1', true);
    assert.equal(patches.length, 2);
    const settledPatch = patches[1].patch;
    assert.equal(settledPatch.stage, 'cancelled');
    assert.equal(settledPatch.response, 'Partial streamed answer before stop');
    assert.deepEqual(settledPatch.outputParts, [{ kind: 'text', text: 'Partial streamed answer before stop' }]);
    assert.equal(settledPatch.outputAssetOwnerId, 'owner-settled');
    assert.equal(settledPatch.routeLabel, 'gpt-5 · OpenAI');
    assert.equal(settledPatch.usageLabel, '120 输入 · 45 输出');
    assert.equal(settledPatch.billingLabel, '自有 API');
});
