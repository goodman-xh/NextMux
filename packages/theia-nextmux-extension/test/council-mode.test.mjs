import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import {
    AGENT_COUNCIL_ROLES,
    MIN_COUNCIL_SLOTS,
    MAX_COUNCIL_SLOTS,
    validateAgentCouncilConfig,
    resolveAgentCouncilSlot,
    computeChildInvocationKey,
    buildCouncilLeadInstructions,
    buildCouncilSpecialistInstructions
} from '@nextmux/agent-runtime';
import {
    CouncilSubConversationVisibilityController,
    createDefaultCouncilDraftSlots,
    toggleCouncilSlotRole,
    councilDraftHasGeneralist
} from '../lib/browser/nextmux-council-mode-view.js';
import {
    councilModeText,
    councilRoleLabel
} from '../lib/browser/nextmux-council-mode-locale.js';
import {
    createConversationHistoryMirror,
    readConversationHistoryMirror
} from '../lib/browser/nextmux-conversation-history.js';

const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const councilViewSource = readFileSync(new URL('../src/browser/nextmux-council-mode-view.tsx', import.meta.url), 'utf8');
const councilPopoverSource = readFileSync(new URL('../src/browser/nextmux-council-popover.tsx', import.meta.url), 'utf8');
const attachmentsCss = readFileSync(new URL('../src/browser/style/nextmux-composer-attachments.css', import.meta.url), 'utf8');

test('validateAgentCouncilConfig enforces minimum 3 slots, model selection, role selection, and globally unique lead', () => {
    assert.equal(MIN_COUNCIL_SLOTS, 3);
    assert.equal(MAX_COUNCIL_SLOTS, 8);
    assert.ok(AGENT_COUNCIL_ROLES.includes('lead'));
    assert.ok(AGENT_COUNCIL_ROLES.includes('generalist'));

    // Too few slots (< 3)
    assert.deepEqual(
        validateAgentCouncilConfig({
            enabled: true,
            slots: [
                { slotId: 'slot-1', modelId: 'gpt-5.4', roles: ['lead'] },
                { slotId: 'slot-2', modelId: 'claude-4.5-sonnet', roles: ['frontend'] }
            ]
        }),
        { valid: false, error: 'min_slots' }
    );

    // Missing modelId
    assert.deepEqual(
        validateAgentCouncilConfig({
            enabled: true,
            slots: [
                { slotId: 'slot-1', modelId: 'gpt-5.4', roles: ['lead'] },
                { slotId: 'slot-2', modelId: '', roles: ['frontend'] },
                { slotId: 'slot-3', modelId: 'deepseek-v3', roles: ['generalist'] }
            ]
        }),
        { valid: false, error: 'slot_model_required' }
    );

    // Missing roles on a slot
    assert.deepEqual(
        validateAgentCouncilConfig({
            enabled: true,
            slots: [
                { slotId: 'slot-1', modelId: 'gpt-5.4', roles: ['lead'] },
                { slotId: 'slot-2', modelId: 'claude-4.5-sonnet', roles: [] },
                { slotId: 'slot-3', modelId: 'deepseek-v3', roles: ['generalist'] }
            ]
        }),
        { valid: false, error: 'slot_roles_required' }
    );

    // Missing lead role across all slots
    assert.deepEqual(
        validateAgentCouncilConfig({
            enabled: true,
            slots: [
                { slotId: 'slot-1', modelId: 'gpt-5.4', roles: ['planning'] },
                { slotId: 'slot-2', modelId: 'claude-4.5-sonnet', roles: ['frontend'] },
                { slotId: 'slot-3', modelId: 'deepseek-v3', roles: ['generalist'] }
            ]
        }),
        { valid: false, error: 'lead_required' }
    );

    // Multiple leads across slots
    assert.deepEqual(
        validateAgentCouncilConfig({
            enabled: true,
            slots: [
                { slotId: 'slot-1', modelId: 'gpt-5.4', roles: ['lead'] },
                { slotId: 'slot-2', modelId: 'claude-4.5-sonnet', roles: ['lead', 'frontend'] },
                { slotId: 'slot-3', modelId: 'deepseek-v3', roles: ['generalist'] }
            ]
        }),
        { valid: false, error: 'multiple_leads' }
    );

    // Valid 3-slot config (even if same model is selected in multiple slots)
    assert.deepEqual(
        validateAgentCouncilConfig({
            enabled: true,
            slots: [
                { slotId: 'slot-1', modelId: 'gpt-5.4', roles: ['lead', 'planning'] },
                { slotId: 'slot-2', modelId: 'gpt-5.4', roles: ['frontend'] },
                { slotId: 'slot-3', modelId: 'deepseek-v3', roles: ['backend', 'generalist'] }
            ]
        }),
        { valid: true }
    );
});

test('toggleCouncilSlotRole keeps lead mutually exclusive while allowing multi-role assignment and generalist detection', () => {
    const models = [
        { modelId: 'm1', label: 'Model 1', routeId: 'r1' },
        { modelId: 'm2', label: 'Model 2', routeId: 'r2' },
        { modelId: 'm3', label: 'Model 3', routeId: 'r3' }
    ];
    let slots = createDefaultCouncilDraftSlots(models);
    assert.equal(slots.length, 3);
    assert.ok(slots[0].roles.includes('lead'));
    assert.equal(councilDraftHasGeneralist(slots), true);

    // Assigning 'lead' to slot-2 automatically removes 'lead' from slot-1
    slots = toggleCouncilSlotRole(slots, 'slot-2', 'lead');
    assert.equal(slots[0].roles.includes('lead'), false);
    assert.equal(slots[1].roles.includes('lead'), true);

    // Removing 'generalist' from slot-3 triggers generalist warning state
    slots = toggleCouncilSlotRole(slots, 'slot-3', 'generalist');
    assert.equal(councilDraftHasGeneralist(slots), false);
});

test('resolveAgentCouncilSlot routes by role match, generalist fallback, and deterministic non-lead fallback', () => {
    const slotsWithGeneralist = [
        { slotId: 'slot-1', modelId: 'gpt-5.4', modelLabel: 'GPT-5.4', roles: ['lead', 'planning'] },
        { slotId: 'slot-2', modelId: 'claude-4.5', modelLabel: 'Claude 4.5', roles: ['frontend'] },
        { slotId: 'slot-3', modelId: 'deepseek-v3', modelLabel: 'DeepSeek V3', roles: ['backend', 'generalist'] }
    ];

    const feDecision = resolveAgentCouncilSlot(slotsWithGeneralist, 'frontend', undefined, 0);
    assert.equal(feDecision?.slotId, 'slot-2');
    assert.equal(feDecision?.routeSource, 'role_match');

    // 'security' is not explicitly assigned -> falls back to 'generalist' (slot-3)
    const secDecision = resolveAgentCouncilSlot(slotsWithGeneralist, 'security', undefined, 0);
    assert.equal(secDecision?.slotId, 'slot-3');
    assert.equal(secDecision?.routeSource, 'generalist_fallback');

    // Without 'generalist', unassigned role falls back deterministically to non-lead slots
    const slotsWithoutGeneralist = [
        { slotId: 'slot-1', modelId: 'gpt-5.4', modelLabel: 'GPT-5.4', roles: ['lead'] },
        { slotId: 'slot-2', modelId: 'claude-4.5', modelLabel: 'Claude 4.5', roles: ['frontend'] },
        { slotId: 'slot-3', modelId: 'deepseek-v3', modelLabel: 'DeepSeek V3', roles: ['backend'] }
    ];
    const qaDecision0 = resolveAgentCouncilSlot(slotsWithoutGeneralist, 'qa', undefined, 0);
    const qaDecision1 = resolveAgentCouncilSlot(slotsWithoutGeneralist, 'qa', undefined, 1);
    assert.equal(qaDecision0?.routeSource, 'random_fallback');
    assert.equal(qaDecision0?.slotId, 'slot-2');
    assert.equal(qaDecision1?.slotId, 'slot-3');

    // Prompts include role boundaries and acceptance criteria. Subagents stay disabled unless explicitly allowed:
    // no options, {} and { disableSubagents: true } carry the rule; { disableSubagents: false } carries no subagent rule.
    const leadPrompt = buildCouncilLeadInstructions(slotsWithGeneralist);
    assert.ok(leadPrompt.includes('臭皮匠模式'));
    assert.ok(leadPrompt.includes('GPT-5.4'));
    assert.ok(leadPrompt.includes('Subagents Disabled (已关闭子智能体)'));
    assert.ok(buildCouncilLeadInstructions(slotsWithGeneralist, {}).includes('Subagents Disabled (已关闭子智能体)'));

    const leadPromptNoSubagents = buildCouncilLeadInstructions(slotsWithGeneralist, { disableSubagents: true });
    assert.ok(leadPromptNoSubagents.includes('Subagents Disabled (已关闭子智能体)'));

    const leadPromptSubagentsAllowed = buildCouncilLeadInstructions(slotsWithGeneralist, { disableSubagents: false });
    assert.ok(!leadPromptSubagentsAllowed.includes('Subagents Disabled'));
    assert.doesNotMatch(leadPromptSubagentsAllowed, /subagent|子智能体|子代理/i, 'allowing subagents writes no subagent rule at all');
    assert.ok(leadPromptSubagentsAllowed.includes('GPT-5.4') && leadPromptSubagentsAllowed.includes('agent.delegate'));

    const specPrompt = buildCouncilSpecialistInstructions(feDecision, ['Pass all unit tests', 'Keep light/dark contrast']);
    assert.ok(specPrompt.includes('前端与设计'));
    assert.ok(specPrompt.includes('Pass all unit tests'));
    assert.ok(specPrompt.includes('Subagents Disabled (已关闭子智能体)'));
    assert.ok(!specPrompt.includes('slots above'), 'a specialist sees no slot roster, so its rule names none');

    const specPromptNoSubagents = buildCouncilSpecialistInstructions(feDecision, ['Pass all unit tests'], { disableSubagents: true });
    assert.ok(specPromptNoSubagents.includes('Subagents Disabled (已关闭子智能体)'));

    const specPromptSubagentsAllowed = buildCouncilSpecialistInstructions(feDecision, ['Pass all unit tests'], { disableSubagents: false });
    assert.ok(!specPromptSubagentsAllowed.includes('Subagents Disabled'));
    assert.doesNotMatch(specPromptSubagentsAllowed, /subagent|子智能体|子代理/i);
    assert.ok(specPromptSubagentsAllowed.includes('Pass all unit tests'));

    // Every layer keeps the default-on contract: the desktop always sends the checkbox state in Council Mode, and the
    // host turns an omitted flag into the rule (only an explicit false drops it).
    assert.ok(widgetSource.includes('{ councilConfig: activeCouncilConfig, disableSubagents: Boolean(this.councilDisableSubagents) }'));
    assert.equal((serviceSource.match(/disableSubagents: request\.disableSubagents !== false/g) || []).length, 3);
    assert.ok(!serviceSource.includes('Boolean(request.disableSubagents)'));

    // Completed-call identities preserve literal text: collapsing these spaces changes the requested UI.
    const keyA = computeChildInvocationKey({
        parentRunId: 'run-1',
        configRevision: 2,
        role: 'frontend',
        slotId: 'slot-2',
        task: 'Render the label "a  b"',
        permissionMode: 'workspace_write'
    });
    const keyB = computeChildInvocationKey({
        parentRunId: 'run-1',
        configRevision: 2,
        role: 'frontend',
        slotId: 'slot-2',
        task: 'Render the label "a b"',
        permissionMode: 'workspace_write'
    });
    assert.notEqual(keyA, keyB);
    assert.equal(keyA, computeChildInvocationKey({
        parentRunId: 'run-1', configRevision: 2, role: 'frontend', slotId: 'slot-2',
        task: 'Render the label "a  b"', permissionMode: 'workspace_write'
    }), 'only the exact same request reuses its completed-call identity');
});

test('CouncilSubConversationVisibilityController enforces 10s conditional disappearance and view lock rules', async () => {
    let updates = 0;
    const controller = new CouncilSubConversationVisibilityController(
        () => { updates += 1; },
        { disappearMs: 40, animationMs: 15 }
    );

    const makeChild = (id, status) => ({
        childRunId: id,
        parentRunId: 'root-1',
        rootRunId: 'root-1',
        depth: 1,
        task: `Task ${id}`,
        role: 'frontend',
        slotId: 'slot-2',
        status,
        events: [],
        firstEventIndex: 0,
        nextEventIndex: 0,
        startedAt: 1000,
        updatedAt: 1000,
        taskContext: {
            version: 1,
            workspaceRoot: '/tmp',
            goal: `Task ${id}`,
            constraints: [],
            relevantPaths: [],
            recentOperations: [],
            parentRunId: 'root-1',
            rootRunId: 'root-1',
            depth: 1,
            permissionMode: 'workspace_write',
            allowedToolNames: [],
            selectedMemory: []
        }
    });

    // Case 1: Unviewed child starts running, then finishes -> disappears after disappearMs + animationMs
    controller.syncChildren([makeChild('child-unviewed', 'running')]);
    assert.equal(controller.isVisibleInSidebar('child-unviewed'), true);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(controller.getPhase('child-unviewed'), 'visible');

    // Completes while user never clicked into it
    controller.syncChildren([makeChild('child-unviewed', 'completed')]);
    assert.equal(controller.getPhase('child-unviewed'), 'timer_running');
    assert.equal(controller.isVisibleInSidebar('child-unviewed'), true);

    await new Promise(resolve => setTimeout(resolve, 75));
    assert.equal(controller.getPhase('child-unviewed'), 'archived');
    assert.equal(controller.isVisibleInSidebar('child-unviewed'), false);

    // Case 2: Viewed child ('child-viewed') is locked and NEVER disappears while viewed
    controller.syncChildren([makeChild('child-viewed', 'running')]);
    controller.selectChild('child-viewed');
    assert.equal(controller.getPhase('child-viewed'), 'locked');

    // Completes while user is viewing it (or while user switches to models/comic/settings without calling leaveToConversation)
    controller.syncChildren([makeChild('child-viewed', 'completed')]);
    assert.equal(controller.getPhase('child-viewed'), 'locked');
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(controller.getPhase('child-viewed'), 'locked');
    assert.equal(controller.isVisibleInSidebar('child-viewed'), true);

    // Case 3: User switches to another conversation -> starts silent timer; re-selecting before expiry cancels timer
    controller.leaveToConversation();
    assert.equal(controller.getPhase('child-viewed'), 'timer_running');
    await new Promise(resolve => setTimeout(resolve, 15));
    controller.selectChild('child-viewed');
    assert.equal(controller.getPhase('child-viewed'), 'locked');
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.equal(controller.isVisibleInSidebar('child-viewed'), true);

    // Finally leaves to another conversation and lets timer finish -> disappears smoothly
    controller.leaveToConversation();
    assert.equal(controller.getPhase('child-viewed'), 'timer_running');
    await new Promise(resolve => setTimeout(resolve, 75));
    assert.equal(controller.getPhase('child-viewed'), 'archived');
    assert.equal(controller.isVisibleInSidebar('child-viewed'), false);
    assert.ok(updates > 0);
    controller.dispose();
});

test('12 supported locales provide translations for all 8 current roles', () => {
    const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    assert.equal(AGENT_COUNCIL_ROLES.length, 8);
    assert.equal(councilRoleLabel('zh-CN', 'planning'), '方案与调研');
    assert.equal(councilRoleLabel('zh-CN', 'delivery'), '构建与交付');
    assert.equal(councilModeText('zh-CN', 'modeName'), '臭皮匠模式');
    assert.equal(councilModeText('zh-CN', 'menuDescription'), '组合至少 3 个模型按岗位协同完成任务');
    assert.equal(councilModeText('zh-CN', 'addModelSlot'), '新增岗位');
    assert.equal(councilModeText('zh-CN', 'disabledComposerNotice'), '请先关闭臭皮匠模式');
    assert.equal(councilModeText('zh-CN', 'closeConfirmTitle'), '关闭臭皮匠模式？');
    assert.equal(councilModeText('zh-CN', 'preventSubagents'), '阻止模型创建子代理');

    for (const locale of locales) {
        assert.ok(councilModeText(locale, 'modeName').length > 0, `missing modeName for ${locale}`);
        assert.ok(councilModeText(locale, 'generalistWarning').length > 0, `missing generalistWarning for ${locale}`);
        assert.ok(councilModeText(locale, 'preventSubagents').length > 0, `missing preventSubagents for ${locale}`);
        assert.ok(!councilModeText(locale, 'addModelSlot').trim().startsWith('+'), `addModelSlot must not have duplicate '+' prefix for ${locale}`);
        for (const role of AGENT_COUNCIL_ROLES) {
            assert.ok(councilRoleLabel(locale, role).length > 0, `missing role ${role} for ${locale}`);
        }
    }
});

test('conversation history mirror preserves councilConfig, pendingCouncilConfig, and child role metadata', () => {
    const session = {
        id: 'session-council-1',
        workspacePath: '/tmp/project',
        title: 'Council session',
        createdAt: 1000,
        updatedAt: 2000,
        councilConfig: {
            enabled: true,
            revision: 1,
            sourceKey: 'managed:m1',
            sourceLabel: 'Merchant 1',
            slots: [{ slotId: 'slot-1', modelId: 'gpt-5.4', modelLabel: 'GPT-5.4', roles: ['lead'], route: { kind: 'official_connection', connectionId: 'c1' } }]
        },
        pendingCouncilConfig: {
            enabled: true,
            revision: 2,
            sourceKey: 'managed:m1',
            sourceLabel: 'Merchant 1',
            slots: []
        },
        turns: [{
            id: 'turn-1',
            prompt: 'Hello council',
            response: 'Done',
            stage: 'complete',
            createdAt: 1500,
            completedAt: 1900,
            childAgents: [{
                childRunId: 'child-1',
                parentRunId: 'root-1',
                rootRunId: 'root-1',
                depth: 1,
                task: 'Implement UI',
                role: 'frontend',
                slotId: 'slot-2',
                acceptanceCriteria: ['Render modal cleanly'],
                status: 'completed',
                events: [],
                firstEventIndex: 0,
                nextEventIndex: 0,
                startedAt: 1600,
                updatedAt: 1800,
                taskContext: {
                    version: 1,
                    workspaceRoot: '/tmp/project',
                    goal: 'Implement UI',
                    constraints: [],
                    relevantPaths: [],
                    recentOperations: [],
                    parentRunId: 'root-1',
                    rootRunId: 'root-1',
                    depth: 1,
                    permissionMode: 'workspace_write',
                    allowedToolNames: [],
                    selectedMemory: []
                }
            }]
        }]
    };

    const mirror = createConversationHistoryMirror([session]);
    const restored = readConversationHistoryMirror(JSON.stringify(mirror));
    assert.equal(restored.sessions.length, 1);
    const restoredSession = restored.sessions[0];
    assert.equal(restoredSession.councilConfig.revision, 1);
    assert.equal(restoredSession.pendingCouncilConfig.revision, 2);
    assert.equal(restoredSession.turns[0].childAgents[0].role, 'frontend');
    assert.equal(restoredSession.turns[0].childAgents[0].slotId, 'slot-2');
    assert.deepEqual(restoredSession.turns[0].childAgents[0].acceptanceCriteria, ['Render modal cleanly']);
});

test('desktop widget and stylesheet wire attachment menu entry, custom model/role dropdowns, toolbar toggle, below-composer notice, sidebar sub-conversations, and role stage', () => {
    // 1. Attachment "+" menu entry right below openGoalComposer using distinct CouncilModeGlyph (not codicon-organization)
    const goalIdx = widgetSource.lastIndexOf('this.openGoalComposer()');
    const councilMenuIdx = widgetSource.indexOf("data-council-menu-item='true'");
    assert.ok(goalIdx > 0 && councilMenuIdx > goalIdx && councilMenuIdx - goalIdx < 600,
        'Council Mode entry must appear directly below Goal in the composer "+" attachment menu');
    const councilMenuSlice = widgetSource.slice(councilMenuIdx, councilMenuIdx + 240);
    assert.ok(councilMenuSlice.includes('<CouncilModeGlyph'), 'Council menu item must use dedicated CouncilModeGlyph');
    assert.ok(!councilMenuSlice.includes('codicon-organization'), 'Council menu item must not reuse codicon-organization');
    assert.ok(councilViewSource.includes('export const CouncilModeGlyph'));

    // 2 & 3. Custom model picker dropdown (no native <select>) + mutual exclusion & outside-click dismissal
    assert.ok(!councilViewSource.includes('<select'), 'CouncilConfigModal must use custom model dropdown instead of native <select>');
    assert.ok(councilViewSource.includes('nmx-council-model-trigger'));
    assert.ok(councilViewSource.includes('<CouncilPopover'));
    assert.ok(councilPopoverSource.includes('data-council-model-dropdown'));
    assert.ok(councilViewSource.includes('data-council-model-option'));
    assert.ok(councilViewSource.includes('openModelPickerSlotId'));
    assert.ok(councilViewSource.includes('dismissOpenDropdowns'));
    assert.ok(widgetSource.includes('onDismissDropdowns'));

    // 4. Upward popover positioning and unclipped modal body so dropdowns never overlap modal footer
    assert.ok(attachmentsCss.includes('.nmx-shell .nmx-council-role-dropdown.is-drop-up'));
    assert.ok(attachmentsCss.includes('.nmx-shell .nmx-council-model-dropdown.is-drop-up'));
    assert.ok(attachmentsCss.includes('.nmx-shell .nmx-council-slot-row.is-picker-open'));

    // 5. Active Council Mode toggle button sits between "+" button and incognito toggle (no top composer banner)
    assert.ok(!widgetSource.includes('nmx-council-composer-banner'), 'Top composer banner must be removed');
    const addBtnIdx = widgetSource.indexOf("this.toggleCodingPopover('attachments')");
    const councilToggleIdx = widgetSource.indexOf('this.renderCouncilToggle(codingSession)');
    const incognitoToggleIdx = widgetSource.indexOf('this.renderIncognitoToggle(codingSession)');
    assert.ok(addBtnIdx > 0 && councilToggleIdx > addBtnIdx && incognitoToggleIdx > councilToggleIdx,
        'Council toggle must sit between the "+" button and the incognito toggle button');
    assert.ok(widgetSource.includes("data-council-toggle='true'"));
    assert.ok(attachmentsCss.includes('.nmx-shell .nmx-composer .nmx-council-toggle.is-active'));

    // 6. Composer relay and model buttons lock when Council Mode is active and show notice in .nmx-composer-below
    assert.ok(widgetSource.includes('is-council-locked'));
    assert.ok(widgetSource.includes("this.councilBelowNotice = councilModeText(this.desktopLocale, 'disabledComposerNotice')"));
    assert.ok(widgetSource.includes("data-council-below-notice='true'"));
    assert.ok(attachmentsCss.includes('.nmx-shell .nmx-composer-below .nmx-council-below-notice'));

    // Sidebar sub-conversations and read-only role stage
    assert.ok(widgetSource.includes('<CouncilSidebarSubConversations'));
    assert.ok(widgetSource.includes('<CouncilRoleConversationStage'));
    assert.ok(councilViewSource.includes('nmx-sub-conversation-connector'));
    assert.ok(attachmentsCss.includes('.nmx-shell .nmx-council-modal'));
    assert.ok(attachmentsCss.includes('.nmx-shell .nmx-sub-conversation-row'));
    assert.ok(attachmentsCss.includes('.nmx-shell .nmx-role-conversation-view'));
    assert.ok(widgetSource.includes('syncCouncilLeadSlotWithRoute'));

    // 7. Left-side relay list is always expanded inline (no collapsible trigger) and wheel-scrollable
    assert.ok(!councilViewSource.includes('nmx-council-relay-trigger'), 'Relay drawer must be expanded inline without a collapsible trigger button');
    assert.ok(councilViewSource.includes("data-council-relay-drawer='true'"));
    assert.ok(attachmentsCss.includes('.nmx-shell .nmx-council-source-list .nmx-relay-options'));

    // 8. Footer left-side "prevent model from creating subagents" checkbox + compact 640x460 modal + model hover callbacks
    assert.ok(councilViewSource.includes("data-council-prevent-subagents='true'"));
    assert.ok(councilViewSource.includes('checked={props.disableSubagents ?? true}'));
    assert.ok(widgetSource.includes("window.localStorage?.getItem('nextmux.desktop.council.disableSubagents.v1') !== 'false'"));
    assert.ok(councilViewSource.includes('onToggleDisableSubagents'));
    assert.ok(councilViewSource.includes('onModelOptionPointerEnter'));
    assert.ok(councilViewSource.includes('onModelOptionPointerLeave'));
    assert.ok(councilViewSource.includes('renderModelOptionHoverPortal'));
    assert.ok(councilPopoverSource.includes('.nmx-model-effort-portal'));
    assert.ok(attachmentsCss.includes('width: min(640px, calc(100vw - 32px));'));
    assert.ok(attachmentsCss.includes('height: min(460px, calc(100dvh - 48px));'));
    assert.ok(attachmentsCss.includes('.nmx-shell .nmx-council-prevent-subagents'));
});

// ---- Council sidebar rows: the lead stays in the main conversation, roles appear at once, history never haunts ----
const councilCore = createRequire(createRequire(import.meta.url).resolve('@theia/core/package.json'));
const CouncilReact = councilCore('react');
const { renderToStaticMarkup: renderCouncilMarkup } = councilCore('react-dom/server');
const {
    collectSessionCouncilRoleChildren,
    isCouncilPendingRoleChild,
    COUNCIL_PENDING_ROLE_PREFIX,
    CouncilSidebarSubConversations,
    CouncilRoleConversationStage
} = await import('../lib/browser/nextmux-council-mode-view.js');
const { conversationAgentRunActive, createConversationAgentRun } = await import('../lib/browser/nextmux-conversation-agent-run.js');

const roleChild = (id, role, status, extra = {}) => ({
    childRunId: id, parentRunId: 'root', rootRunId: 'root', depth: 1, task: `Task ${id}`, role, status,
    events: [], firstEventIndex: 0, nextEventIndex: 0, startedAt: extra.startedAt ?? 1000, updatedAt: 1000,
    taskContext: { version: 1, workspaceRoot: '/w', goal: `Task ${id}`, constraints: [], relevantPaths: [], recentOperations: [],
        depth: 1, permissionMode: 'workspace_write', allowedToolNames: [], selectedMemory: [] }, ...extra
});
const councilRoster = [
    { slotId: 'lead-slot', modelId: 'opus', modelLabel: 'Opus', roles: ['lead'] },
    { slotId: 'ui-slot', modelId: 'gemini', modelLabel: 'Gemini', roles: ['backend', 'frontend'] },
    { slotId: 'qa-slot', modelId: 'gpt', modelLabel: 'GPT', roles: ['qa'] },
    { slotId: 'odd-slot', modelId: 'ds', modelLabel: 'DeepSeek', roles: ['generalist'] }
];
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

test('first sight of a finished child archives it at once; only a live run or the user earns the countdown', async () => {
    const controller = new CouncilSubConversationVisibilityController(() => {}, { disappearMs: 40, animationMs: 10 });
    controller.syncChildren([roleChild('old-done', 'frontend', 'completed'), roleChild('old-stopped', 'qa', 'interrupted')]);
    assert.equal(controller.getPhase('old-done'), 'archived', 'history is not given a 10 s countdown on startup');
    assert.equal(controller.isVisibleInSidebar('old-stopped'), false);
    controller.syncChildren([{ ...roleChild('fast', 'qa', 'completed'), councilLive: true }]);
    assert.equal(controller.getPhase('fast'), 'timer_running', 'a child of the run in progress that finished between syncs still gets its countdown');
    controller.selectChild('picked');
    controller.syncChildren([roleChild('picked', 'review', 'completed')]);
    assert.equal(controller.getPhase('picked'), 'locked', 'the child the user opened stays while viewed');
    await tick(70);
    assert.equal(controller.getPhase('fast'), 'archived');
    controller.dispose();
});

test('a pending role row hands its phase and the view to the delegated child without a second entrance', async () => {
    const controller = new CouncilSubConversationVisibilityController(() => {}, { disappearMs: 40, animationMs: 10, enterAnimationMs: 5 });
    const pending = { ...roleChild(`${COUNCIL_PENDING_ROLE_PREFIX}s:t:frontend`, 'frontend', 'running'), councilPending: true, councilLive: true };
    controller.syncChildren([pending]);
    await tick(15);
    assert.equal(controller.getPhase(pending.childRunId), 'visible');
    controller.selectChild(pending.childRunId);
    controller.adoptEntry(pending.childRunId, 'real-frontend');
    assert.equal(controller.getActiveChildId(), 'real-frontend', 'the open role view follows the dispatch');
    assert.equal(controller.getPhase('real-frontend'), 'locked');
    controller.leaveToConversation();
    controller.syncChildren([{ ...roleChild('real-frontend', 'frontend', 'running'), councilLive: true }]);
    assert.notEqual(controller.getPhase('real-frontend'), 'entering', 'no entering animation replay');
    assert.equal(controller.isVisibleInSidebar('real-frontend'), true);
    controller.syncChildren([{ ...roleChild('real-frontend', 'frontend', 'completed'), councilLive: true }]);
    assert.equal(controller.getPhase('real-frontend'), 'timer_running');
    controller.dispose();
});

test('a running Council turn shows every configured non-lead role at once and binds each dispatch into its row', () => {
    const turns = [
        { id: 'older', prompt: 'Earlier', stage: 'complete', createdAt: 1, childAgents: [roleChild('old-running', 'frontend', 'running'), roleChild('lead-child', 'lead', 'completed')] },
        { id: 'turn-2', prompt: '  修复登录页\n样式  ', stage: 'running', createdAt: 50, childAgents: [] }
    ];
    const start = collectSessionCouncilRoleChildren({ sessionId: 's1', turns, running: true, runningTurnId: 'turn-2', councilSlots: councilRoster, liveChildren: [] });
    assert.deepEqual(start.children.map(child => child.role), ['frontend', 'frontend', 'backend', 'qa', 'generalist'],
        'history first, then the roster in working order; the lead never has a row');
    const [history, ...pending] = start.children;
    assert.equal(history.status, 'interrupted', 'an earlier turn cannot still be running');
    assert.ok(pending.every(child => isCouncilPendingRoleChild(child) && child.status === 'running' && child.councilLive));
    assert.equal(pending[0].task, '修复登录页 样式', 'pending rows read as the request in progress');
    assert.equal(pending[0].childRunId, `${COUNCIL_PENDING_ROLE_PREFIX}s1:turn-2:frontend`);
    assert.equal(pending[1].slotId, 'ui-slot');
    assert.equal(pending[1].taskContext.modelId, 'Gemini');

    const live = [
        roleChild('c-backend', 'backend', 'running', { slotId: 'ui-slot', startedAt: 60 }),
        roleChild('c-review', 'review', 'running', { slotId: 'odd-slot', startedAt: 70 }),
        roleChild('c-frontend-2', 'frontend', 'running', { slotId: 'ui-slot', startedAt: 90 }),
        roleChild('c-frontend', 'frontend', 'completed', { slotId: 'ui-slot', startedAt: 80 }),
        roleChild('c-lead', 'lead', 'running', { startedAt: 65 })
    ];
    const bound = collectSessionCouncilRoleChildren({ sessionId: 's1', turns, running: true, runningTurnId: 'turn-2', councilSlots: councilRoster, liveChildren: live });
    assert.deepEqual(bound.children.map(child => child.childRunId), ['old-running', 'c-frontend', 'c-backend',
        `${COUNCIL_PENDING_ROLE_PREFIX}s1:turn-2:qa`, 'c-review', 'c-frontend-2'],
        'each dispatch takes its role row (a generalist covering 审查 takes the generalist row); a second 前端 dispatch is its own row');
    assert.equal(new Set(bound.children.map(child => child.childRunId)).size, bound.children.length, 'no duplicate rows');
    assert.deepEqual([...bound.bindings], [
        [`${COUNCIL_PENDING_ROLE_PREFIX}s1:turn-2:frontend`, 'c-frontend'],
        [`${COUNCIL_PENDING_ROLE_PREFIX}s1:turn-2:backend`, 'c-backend'],
        [`${COUNCIL_PENDING_ROLE_PREFIX}s1:turn-2:generalist`, 'c-review']
    ]);
    assert.ok(bound.children.filter(child => !isCouncilPendingRoleChild(child) && child.childRunId !== 'old-running').every(child => child.councilLive));
});

test('once nothing runs, every saved role child is settled history and the sidebar paints none of it', () => {
    const turns = [{ id: 'preview', prompt: 'Preview', stage: 'complete', createdAt: 1, childAgents: [
        roleChild('stale-running', 'frontend', 'running'), roleChild('done', 'qa', 'completed'), roleChild('the-lead', 'lead', 'running')] }];
    const restored = collectSessionCouncilRoleChildren({ sessionId: 'preview-session', turns, running: false, councilSlots: councilRoster,
        liveChildren: [roleChild('stale-running', 'frontend', 'running')] });
    assert.deepEqual(restored.children.map(child => [child.childRunId, child.status]), [['stale-running', 'interrupted'], ['done', 'completed']]);
    assert.ok(!restored.children.some(child => isCouncilPendingRoleChild(child) || child.councilLive));
    const controller = new CouncilSubConversationVisibilityController(() => {});
    const markup = renderCouncilMarkup(CouncilReact.createElement(CouncilSidebarSubConversations, { locale: 'zh-CN', sessionId: 'preview-session',
        childrenSnapshots: restored.children, activeChildId: '', visibilityController: controller, onSelectChild: () => {} }));
    assert.equal(markup, '', 'zero ghost role rows on startup, not even for the first paint');
    controller.dispose();
});

test('a pending row and its role view say they wait for the lead instead of showing a running spinner', () => {
    const { children } = collectSessionCouncilRoleChildren({ sessionId: 's1', turns: [{ id: 't', prompt: 'Ship it', stage: 'running', createdAt: 5 }],
        running: true, councilSlots: councilRoster });
    const controller = new CouncilSubConversationVisibilityController(() => {});
    const sidebar = renderCouncilMarkup(CouncilReact.createElement(CouncilSidebarSubConversations, { locale: 'zh-CN', sessionId: 's1',
        childrenSnapshots: children, activeChildId: '', visibilityController: controller, onSelectChild: () => {}, rolesForChild: child => [child.role] }));
    assert.equal((sidebar.match(/data-sub-conversation-pending="true"/g) || []).length, 4);
    assert.equal((sidebar.match(/codicon-clock nmx-sub-conversation-status is-pending/g) || []).length, 4);
    assert.doesNotMatch(sidebar, /codicon-loading/, 'nothing is drawn as running before it runs');
    assert.match(sidebar, /title="前端与设计 · 等待负责人分派任务"/);
    assert.match(sidebar, />Ship it</);
    const stage = renderCouncilMarkup(CouncilReact.createElement(CouncilRoleConversationStage, { locale: 'zh-CN', child: children[0], statusLabel: '运行中',
        onBackToLead: () => {}, renderActivity: () => { throw new Error('a pending role has no activity to render'); }, renderOutput: () => null }));
    assert.match(stage, /<p class="nmx-role-awaiting" role="status"><i class="codicon codicon-clock" aria-hidden="true"><\/i><span>等待负责人分派任务<\/span><\/p>/);
    assert.match(stage, /nmx-team-identity-status is-pending">等待负责人分派任务</);
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const text = councilModeText(locale, 'roleAwaitingDispatch');
        assert.ok(text && (locale === 'en' || text !== councilModeText('en', 'roleAwaitingDispatch')), `${locale} awaiting copy`);
    }
    controller.dispose();
});

test('the actual widget seeds role rows only for a run it drives, settles saved children and records the run roster', () => {
    const file = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const nodes = []; const visit = node => { nodes.push(node); ts.forEachChild(node, visit); }; visit(file);
    const method = name => nodes.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file);
    const settleSource = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'settleSavedAgentChildren').getText(file);
    const Harness = new Function('collectSessionCouncilRoleChildren', 'COUNCIL_PENDING_ROLE_PREFIX', 'conversationAgentRunActive', ts.transpile(
        `${settleSource}\nclass Harness { ${['sessionCouncilRoleChildren', 'councilRunRoster', 'activeCouncilRoleChild', 'isCodingSessionRunning', 'sessionCouncilKey']
            .map(method).join('\n')} }; return { Harness, settleSavedAgentChildren };`, { target: ts.ScriptTarget.ES2022 }))(
        collectSessionCouncilRoleChildren, COUNCIL_PENDING_ROLE_PREFIX, conversationAgentRunActive);
    const saved = [roleChild('saved-running', 'frontend', 'running'), roleChild('saved-done', 'qa', 'completed')];
    assert.deepEqual(Harness.settleSavedAgentChildren(saved).map(child => child.status), ['interrupted', 'completed']);
    const session = { id: 'c1', turns: [{ id: 't1', prompt: 'Build the page', stage: 'running', createdAt: 1, childAgents: saved }] };
    const widget = Object.assign(new Harness.Harness(), {
        codingSessions: [session], conversationAgentRuns: new Map(), activeAgentSessionId: '', liveAgentChildren: [], agentStage: 'idle',
        activeAgentTurnId: '', activeCodingSessionId: 'c1', activeCouncilChildId: '', councilRunRosters: new Map(),
        councilConfigsBySession: new Map([['c1', { enabled: true, slots: councilRoster }]]), ensureCouncilConfigsLoaded() {},
        councilVisibilityController: new CouncilSubConversationVisibilityController(() => {}), activeCodingSession() { return session; }
    });
    // Startup: the saved stage says running, but no run of this renderer exists, so nothing is live and nothing is seeded.
    const restored = widget.sessionCouncilRoleChildren(session);
    assert.ok(restored.every(child => !isCouncilPendingRoleChild(child) && child.status !== 'running'));
    widget.councilVisibilityController.syncChildren(restored);
    assert.deepEqual(widget.councilVisibilityController.visibleItems(restored), [], 'zero ghost rows after a restart');
    // The run starts in this renderer: every configured specialist appears in the same render, before any dispatch.
    const run = Object.assign(createConversationAgentRun('c1'), { agentStage: 'running', activeAgentRunId: 'run-1', activeAgentTurnId: 't1' });
    widget.conversationAgentRuns.set('c1', run);
    widget.councilRunRosters.set('c1', councilRoster);
    session.turns[0].childAgents = [];
    const seeded = widget.sessionCouncilRoleChildren(session);
    assert.deepEqual(seeded.map(child => child.role), ['frontend', 'backend', 'qa', 'generalist']);
    widget.councilRunRosters.set('c1', []);
    assert.deepEqual(widget.sessionCouncilRoleChildren(session), [], 'a single-model run seeds nothing, even with Council enabled meanwhile');
    widget.councilRunRosters.set('c1', councilRoster);
    widget.activeCouncilChildId = seeded[1].childRunId;
    run.liveAgentChildren = [roleChild('real-backend', 'backend', 'running', { slotId: 'ui-slot' })];
    assert.equal(widget.activeCouncilRoleChild(session)?.childRunId, 'real-backend', 'the open pending view becomes the dispatched child');
    assert.equal(widget.activeCouncilChildId, 'real-backend');
    // The run ends without dispatching qa: a view left on that pending row returns to the main conversation.
    widget.activeCouncilChildId = `${COUNCIL_PENDING_ROLE_PREFIX}c1:t1:qa`;
    run.agentStage = 'complete'; run.activeAgentRunId = ''; session.turns[0].stage = 'complete';
    assert.equal(widget.activeCouncilRoleChild(session), undefined);
    assert.equal(widget.activeCouncilChildId, '');
    assert.match(widgetSource, /this\.councilRunRosters\?\.set\(codingSession\.id, startRequest\.councilConfig\?\.slots \?\? \[\]\);/);
    assert.match(widgetSource, /return settled\.stage === 'running' \? settled : \{ \.\.\.settled, childAgents: settleSavedAgentChildren\(settled\.childAgents\) \};/);
    widget.councilVisibilityController.dispose();
});

test('the lead is told to dispatch its configured specialists first, in dependency order', () => {
    const lead = buildCouncilLeadInstructions(councilRoster);
    assert.match(lead, /Dispatch First \(开局先派发\)/);
    assert.match(lead, /configured: `backend`, `frontend`, `qa`, `generalist`/);
    assert.match(lead, /before long reading, analysis, or synthesis/);
    assert.match(lead, /run one after another in the order you issue them/);
    assert.ok(!/configured: [^)]*`lead`/.test(lead), 'the lead is not a specialist to dispatch');
    assert.match(lead, /You alone answer in the main conversation; specialists work in their own role sub-conversations/);
});
