#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { conversationText } from '../packages/theia-nextmux-extension/lib/browser/nextmux-conversation-locale.js';
import { normalizeDesktopLocale } from '../packages/theia-nextmux-extension/lib/browser/nextmux-locale.js';
import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';
import { waitForExactBranchComposerRoute } from './desktop-branch-readiness.mjs';
import {
    ensureExactOfficialQaRoute,
    officialQaRouteConfig,
    removeExactOfficialQaRoute
} from './desktop-official-qa-route.mjs';
import {
    assertExactAgentRunRpc,
    assertDisposableDesktopE2E,
    installWebSocketJsonRpcCapture,
    readCapturedJsonRpcFrames,
    readConversationSessionIds,
    throwPrimaryOrCleanupErrors,
    uniqueNewResourceId,
    uninstallWebSocketJsonRpcCapture
} from './desktop-e2e-state.mjs';

assertDisposableDesktopE2E();

const port = process.env.NEXTMUX_CDP_PORT || '9222';
const qaConfig = officialQaRouteConfig();
const runId = randomUUID();
const rpcCaptureKey = `__nmxConversationBranchRpc_${runId.replace(/-/g, '_')}`;
const { socket, call, evaluate } = await connectToNextMuxWorkbench(port);

const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));
const expect = (condition, label, value) => {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(value)}`);
};
const storedSessionsExpression = `(() => {
    const stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}');
    return Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
})()`;

async function waitFor(expression, label, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await evaluate(expression);
        if (value) return value;
        await pause(120);
    }
    throw new Error(`Timed out: ${label}`);
}

async function waitForNode(probe, label, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await probe();
        if (value) return value;
        await pause(150);
    }
    throw new Error(`Timed out: ${label}`);
}

async function reload() {
    await reloadDesktopDocument({ call, evaluate });
    await waitFor(`document.readyState === 'complete' && Boolean(document.querySelector('.nmx-desktop-widget'))`, 'desktop reload', 20_000);
    await pause(650);
}

async function click(selector) {
    await waitFor(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node || node.disabled) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    })()`, selector);
    await evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        node.scrollIntoView({ block: 'center', inline: 'nearest' });
        node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1 }));
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
        node.click();
    })()`);
    await pause(220);
}

async function setTextarea(selector, value) {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, selector);
    await evaluate(`(() => {
        const textarea = document.querySelector(${JSON.stringify(selector)});
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(textarea, ${JSON.stringify(value)});
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await pause(180);
}

async function beginSocketCapture() {
    await installWebSocketJsonRpcCapture(evaluate, rpcCaptureKey);
}

async function capturedAgentRequest(marker, route) {
    return waitForNode(async () => {
        const frames = await readCapturedJsonRpcFrames(evaluate, rpcCaptureKey);
        try {
            return assertExactAgentRunRpc(frames, route, { marker });
        } catch {
            return undefined;
        }
    }, `captured structured model request ${marker}`, 20_000);
}

async function activateSession(sessionId, anchorTurnId) {
    await evaluate(`(() => {
        const sessions = ${storedSessionsExpression};
        const session = sessions.find(candidate => candidate.id === ${JSON.stringify(sessionId)});
        if (!session) throw new Error('missing fixture session');
        session.viewState = {
            ...(session.viewState || {}),
            threadWasAtBottom: false,
            threadScrollTop: 0,
            threadAnchorTurnId: ${JSON.stringify(anchorTurnId)},
            threadAnchorOffset: 0
        };
        localStorage.setItem('nextmux.desktop.codingSessions.v1', JSON.stringify({ version: 2, complete: false, sessions }));
        const state = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}');
        localStorage.setItem('nextmux.desktop.restoreState.v1', JSON.stringify({
            ...state,
            version: 1,
            section: 'coding',
            workspace: session.workspacePath || '',
            codingPanel: 'thread',
            activeCodingSessionId: session.id,
            newConversation: false
        }));
        sessionStorage.clear();
    })()`);
}

const sourceSessionId = `nmx-branch-source-${runId}`;
const userBranchSourceId = `nmx-user-branch-source-${runId}`;
// Projectless workspaces are backend capabilities and therefore use the exact
// production conversation-ID contract rather than a test-only prefixed ID.
const projectlessSourceId = randomUUID();
const turnIds = Array.from({ length: 100 }, (_, index) => `nmx-branch-turn-${runId}-${index + 1}`);
const userMessageIds = turnIds.map(() => randomUUID());
const assistantMessageIds = turnIds.map(() => randomUUID());
const userBranchTurnIds = [1, 2, 3].map(index => `nmx-user-branch-turn-${runId}-${index}`);
const userBranchMessageIds = userBranchTurnIds.map(() => ({ user: randomUUID(), assistant: randomUUID() }));
const projectlessTurnIds = [1, 2].map(index => `nmx-projectless-turn-${runId}-${index}`);
const projectlessMessageIds = projectlessTurnIds.map(() => ({ user: randomUUID(), assistant: randomUUID() }));
const rollbackPreviewCheckpointId = `checkpoint-${randomUUID()}`;
const rollbackPreviewRelativePath = 'rollback-preview.txt';
const keep88Marker = `NM_BRANCH_KEEP_88_${runId}`;
const keep89Marker = `NM_BRANCH_KEEP_89_${runId}`;
const forbiddenTailMarker = `NM_BRANCH_FORBIDDEN_90_100_${runId}`;
const branchProbe = `NM_BRANCH_CONTEXT_PROBE_${runId}`;
// Keep the real tool run alive long enough to exercise the disabled branch
// action without depending on renderer speed or CI scheduling jitter.
const branchProbePrompt = `${branchProbe} 生命周期真实回归，调用 process.run 执行 setTimeout(()=>console.log('${branchProbe}'),6000)`;
const editedPrompt = `NM_BRANCH_EDITED_90_${runId}`;
const userBranchPromptMarker = `NM_USER_BRANCH_PROMPT_${runId}`;
const userBranchForbiddenResponseMarker = `NM_USER_BRANCH_FORBIDDEN_RESPONSE_${runId}`;
const userBranchProbe = `NM_USER_BRANCH_CONTEXT_PROBE_${runId}`;
const userBranchDraftMarker = `NM_USER_BRANCH_DRAFT_${runId}`;
const userBranchQueueMarker = `NM_USER_BRANCH_QUEUE_${runId}`;
const projectAttachmentId = `nmx-project-attachment-${randomUUID()}`;
const projectlessAttachmentId = `nmx-projectless-attachment-${randomUUID()}`;
const dataRoot = await realpath(resolve(process.env.NEXTMUX_DESKTOP_STATE_DIR || (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'NextMux')
    : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support', 'NextMux')
        : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'NextMux'))));
const conversationHistoryRoot = join(dataRoot, 'conversation-history-v1');

async function readDurableSession(sessionId) {
    try {
        const manifest = JSON.parse(await readFile(join(conversationHistoryRoot, 'manifest-v1.json'), 'utf8'));
        const entry = manifest.sessions?.find(candidate => candidate.id === sessionId);
        if (!entry?.file) return undefined;
        const session = JSON.parse(await readFile(join(conversationHistoryRoot, entry.file), 'utf8'));
        return { entry, session };
    } catch (error) {
        if (error?.code === 'ENOENT') return undefined;
        throw error;
    }
}

async function waitForDurableSession(sessionId, predicate, label, timeout = 25_000) {
    return waitForNode(async () => {
        const durable = await readDurableSession(sessionId);
        return durable && predicate(durable.session) ? durable : undefined;
    }, label, timeout);
}

async function deleteFixtureSession(sessionId) {
    const durable = sessionId ? await readDurableSession(sessionId) : undefined;
    if (!durable) return;
    await activateSession(sessionId, '');
    await reload();
    await evaluate(`[...document.querySelectorAll('.nmx-project-row[aria-expanded="false"]')]
        .forEach(button => button.click())`);
    await pause(300);
    await evaluate(`[...document.querySelectorAll('.nmx-project-conversation-toggle[aria-expanded="false"]')]
        .forEach(button => button.click())`);
    await pause(300);
    await waitFor(`(() => {
        const state = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}');
        const rows = [...document.querySelectorAll('.nmx-session-row[data-session-id]')];
        return state.activeCodingSessionId === ${JSON.stringify(sessionId)}
            && rows.some(row => row.getAttribute('data-session-id') === ${JSON.stringify(sessionId)} && row.classList.contains('is-current'));
    })()`, `exact fixture row data-session-id=${sessionId}`);
    await evaluate(`(() => {
        const row = [...document.querySelectorAll('.nmx-session-row[data-session-id]')]
            .find(candidate => candidate.getAttribute('data-session-id') === ${JSON.stringify(sessionId)} && candidate.classList.contains('is-current'));
        if (!row) throw new Error('exact fixture session row is unavailable');
        const button = row.querySelector('.nmx-session-more');
        if (!(button instanceof HTMLButtonElement)) throw new Error('exact fixture session menu is unavailable');
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1 }));
        button.click();
    })()`);
    await waitFor(`Boolean([...document.querySelectorAll('.nmx-session-row[data-session-id]')]
        .find(row => row.getAttribute('data-session-id') === ${JSON.stringify(sessionId)})?.querySelector('.nmx-session-menu .is-danger'))`, `exact fixture menu ${sessionId}`);
    await evaluate(`([...document.querySelectorAll('.nmx-session-row[data-session-id]')]
        .find(row => row.getAttribute('data-session-id') === ${JSON.stringify(sessionId)})?.querySelector('.nmx-session-menu .is-danger'))?.click()`);
    await waitFor(`Boolean(document.querySelector('.nmx-thread-dialog footer .is-danger'))`, `fixture delete dialog ${sessionId}`);
    await click('.nmx-thread-dialog footer .is-danger');
    await waitForNode(async () => !(await readDurableSession(sessionId)), `fixture persistence removal ${sessionId}`);
}

const projectlessSourceRoot = join(dataRoot, 'conversation-workspaces', projectlessSourceId);
const cleanupRoots = new Set([projectlessSourceRoot]);
const cleanupCheckpointRoots = new Set();
const agentStateRoot = resolve(process.env.NEXTMUX_AGENT_STATE_DIR || dataRoot);
const checkpointRoot = workspaceRoot => join(agentStateRoot, 'agent-checkpoints', createHash('sha256').update(resolve(workspaceRoot)).digest('hex'));
cleanupCheckpointRoots.add(checkpointRoot(projectlessSourceRoot));

let storageSnapshot;
let passed = false;
let qaRoute;
let branchId = '';
let userBranchId = '';
let projectlessBranchId = '';
let beforeSessionIds = [];
let sessionBaselineCaptured = false;
const evidence = {};
let primaryError;
const cleanupErrors = [];
let cdpConnected = false;

try {
    cdpConnected = true;
    await call('Page.enable');
    await call('Emulation.setFocusEmulationEnabled', { enabled: true });

    storageSnapshot = await evaluate(`(() => ({
        local: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
        session: Object.fromEntries(Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)]))
    }))()`);
    beforeSessionIds = await readConversationSessionIds(evaluate);
    sessionBaselineCaptured = true;

    const route = qaRoute = await ensureExactOfficialQaRoute({ evaluate, config: qaConfig });
    const workspace = await evaluate(`(() => {
        const visibleWorkspace = document.querySelector('.nmx-project-row[title]')?.getAttribute('title') || '';
        if (visibleWorkspace) return visibleWorkspace;
        const sessions = ${storedSessionsExpression};
        return sessions.find(session => session.workspacePath)?.workspacePath || '';
    })()`);
    expect(workspace, 'workspace is available for project branch fixture', workspace);

    const attachmentBytes = Buffer.from(`projectless branch attachment ${Date.now()}\n`, 'utf8');
    const attachmentName = `${createHash('sha256').update(attachmentBytes).digest('hex')}.txt`;
    const projectlessAttachmentRelativePath = ['.nextmux', 'conversation-attachments', attachmentName].join('/');
    const projectlessAttachmentPath = join(projectlessSourceRoot, ...projectlessAttachmentRelativePath.split('/'));
    await mkdir(join(projectlessSourceRoot, '.nextmux', 'conversation-attachments'), { recursive: true });
    await writeFile(projectlessAttachmentPath, attachmentBytes);
    const sourceCheckpointRoot = checkpointRoot(projectlessSourceRoot);
    const checkpointSentinel = join(sourceCheckpointRoot, 'branch-independence.txt');
    await mkdir(sourceCheckpointRoot, { recursive: true });
    await writeFile(checkpointSentinel, 'source-checkpoint', 'utf8');
    const rollbackBefore = Buffer.from('before rollback preview\n', 'utf8');
    const rollbackAfter = Buffer.from('after rollback preview\n', 'utf8');
    const rollbackCheckpointDirectory = join(sourceCheckpointRoot, rollbackPreviewCheckpointId);
    await mkdir(rollbackCheckpointDirectory, { recursive: true });
    await writeFile(join(projectlessSourceRoot, rollbackPreviewRelativePath), rollbackAfter);
    await writeFile(join(rollbackCheckpointDirectory, 'before.bin'), rollbackBefore);
    await writeFile(join(rollbackCheckpointDirectory, 'after.bin'), rollbackAfter);
    await writeFile(join(rollbackCheckpointDirectory, 'manifest.json'), JSON.stringify({
        version: 1,
        id: rollbackPreviewCheckpointId,
        workspaceRoot: projectlessSourceRoot,
        relativePath: rollbackPreviewRelativePath,
        existed: true,
        beforeSha256: createHash('sha256').update(rollbackBefore).digest('hex'),
        afterSha256: createHash('sha256').update(rollbackAfter).digest('hex'),
        beforeMode: 0o644,
        createdAt: new Date().toISOString()
    }), 'utf8');

    const now = Date.now();
    const turn = (id, index) => {
        const marker = index === 88 ? keep88Marker : index === 89 ? keep89Marker : index >= 90 ? forbiddenTailMarker : '';
        return {
            id,
            userMessageId: userMessageIds[index - 1],
            assistantMessageId: assistantMessageIds[index - 1],
            prompt: `Original prompt ${index}${marker ? ` ${marker}` : ''}`,
            response: `Original response ${index}${marker ? ` ${marker}` : ''}`,
            error: '',
            stage: 'complete',
            createdAt: now - (101 - index) * 2_000,
            completedAt: now - (101 - index) * 2_000 + 500,
            permissionMode: 'workspace_write',
            routeLabel: 'GPT 5.6 Sol',
            executionLabel: '',
            usageLabel: '',
            ...(index === 88 ? { attachments: [{
                id: projectAttachmentId,
                uri: pathToFileURL(join(workspace, 'README.md')).toString(),
                size: 1,
                name: 'README.md',
                kind: 'text'
            }] } : {})
        };
    };
    const projectFixture = {
        id: sourceSessionId,
        workspacePath: workspace,
        title: `NM branch E2E ${sourceSessionId}`,
        turns: turnIds.map((id, index) => turn(id, index + 1)),
        pinned: false,
        routeId: route.routeId,
        relayKey: route.relayKey,
        modelId: route.modelId,
        reasoningEffort: 'low',
        // The running-state assertion below uses a real process.run call,
        // which is intentionally available only with full-access permission.
        permissionMode: 'full_access',
        followUpQueue: [],
        viewState: { threadWasAtBottom: false, threadScrollTop: 0, threadAnchorTurnId: turnIds[87], threadAnchorOffset: 0 },
        createdAt: now - 300_000,
        updatedAt: now
    };
    const userDraftReference = {
        id: `nmx-user-branch-draft-${runId}`,
        ordinal: 1,
        name: `user-branch-draft-${runId}.txt`,
        marker: `[Pasted text #1: user-branch-draft-${runId}.txt]`,
        modelReference: `[Pasted text #1: user-branch-draft-${runId}.txt]`,
        attachment: {
            uri: pathToFileURL(join(workspace, 'README.md')).toString(),
            size: 1
        }
    };
    const userBranchFixture = {
        id: userBranchSourceId,
        workspacePath: workspace,
        title: `NM user-message branch E2E ${userBranchSourceId}`,
        turns: userBranchTurnIds.map((id, index) => ({
            id,
            userMessageId: userBranchMessageIds[index].user,
            assistantMessageId: userBranchMessageIds[index].assistant,
            prompt: index === 1 ? `Target user prompt ${userBranchPromptMarker}` : `User branch prompt ${index + 1}`,
            response: index === 1 ? `Target assistant response ${userBranchForbiddenResponseMarker}` : `User branch response ${index + 1}`,
            error: '',
            stage: 'complete',
            createdAt: now - (4 - index) * 2_000,
            completedAt: now - (4 - index) * 2_000 + 500,
            permissionMode: 'workspace_write',
            routeLabel: 'GPT 5.6 Sol',
            executionLabel: '',
            usageLabel: ''
        })),
        pinned: false,
        routeId: route.routeId,
        relayKey: route.relayKey,
        modelId: route.modelId,
        reasoningEffort: 'low',
        permissionMode: 'workspace_write',
        draftPrompt: `${userBranchDraftMarker} ${userDraftReference.marker}`,
        draftPastedTextReferences: JSON.stringify([userDraftReference]),
        followUpQueue: [{
            id: `nmx-user-branch-queue-${runId}`,
            sessionId: userBranchSourceId,
            prompt: userBranchQueueMarker,
            source: 'user',
            workbench: 'coding',
            routeId: route.routeId,
            relayKey: route.relayKey,
            modelLabel: 'GPT 5.6 Sol',
            reasoningEffort: 'low',
            permissionMode: 'workspace_write',
            attachments: [],
            createdAt: now - 1_000
        }],
        viewState: { threadWasAtBottom: false, threadScrollTop: 0, threadAnchorTurnId: userBranchTurnIds[1], threadAnchorOffset: 0 },
        createdAt: now - 40_000,
        updatedAt: now - 5_000
    };
    const projectlessFixture = {
        id: projectlessSourceId,
        workspacePath: '',
        title: `NM projectless branch E2E ${projectlessSourceId}`,
        turns: [1, 2].map(index => ({
            id: projectlessTurnIds[index - 1],
            userMessageId: projectlessMessageIds[index - 1].user,
            assistantMessageId: projectlessMessageIds[index - 1].assistant,
            prompt: `Projectless prompt ${index}`,
            response: `Projectless response ${index}`,
            error: '',
            stage: 'complete',
            createdAt: now - (3 - index) * 2_000,
            completedAt: now - (3 - index) * 2_000 + 500,
            permissionMode: 'workspace_write',
            routeLabel: 'GPT 5.6 Sol',
            executionLabel: '',
            usageLabel: '',
            ...(index === 2 ? { changes: [{
                checkpointId: rollbackPreviewCheckpointId,
                path: rollbackPreviewRelativePath,
                kind: 'modified',
                binary: false,
                additions: 1,
                deletions: 1,
                patch: '-before rollback preview\n+after rollback preview',
                truncated: false,
                createdAt: new Date(now).toISOString()
            }] } : {}),
            ...(index === 2 ? { attachments: [{
                id: projectlessAttachmentId,
                uri: pathToFileURL(projectlessAttachmentPath).toString(),
                size: attachmentBytes.byteLength,
                name: attachmentName,
                kind: 'text',
                workspaceRelativePath: projectlessAttachmentRelativePath
            }] } : {})
        })),
        pinned: false,
        routeId: route.routeId,
        relayKey: route.relayKey,
        modelId: route.modelId,
        reasoningEffort: 'low',
        permissionMode: 'workspace_write',
        followUpQueue: [],
        viewState: { threadWasAtBottom: false, threadScrollTop: 0, threadAnchorTurnId: projectlessTurnIds[1], threadAnchorOffset: 0 },
        createdAt: now - 20_000,
        updatedAt: now - 10_000
    };

    await evaluate(`(() => {
        localStorage.setItem('nextmux.desktop.codingSessions.v1', JSON.stringify({
            version: 2, complete: false, sessions: [${JSON.stringify(projectFixture)}, ${JSON.stringify(userBranchFixture)}, ${JSON.stringify(projectlessFixture)}]
        }));
        localStorage.setItem('nextmux.desktop.restoreState.v1', JSON.stringify({
            version: 1, section: 'coding', workspace: ${JSON.stringify(workspace)}, codingPanel: 'thread',
            activeCodingSessionId: ${JSON.stringify(sourceSessionId)}, newConversation: false,
            settingsPanel: 'profile', billingTab: 'usage', modelCenterView: 'all',
            modelCapabilityFilter: 'all', comicView: 'storyboard'
        }));
        sessionStorage.clear();
    })()`);
    await reload();
    const durableFixture = await waitForDurableSession(
        sourceSessionId,
        session => session.turns?.length === 100 && session.turns[87]?.id === turnIds[87],
        '100-turn source fixture persisted'
    );
    await waitForDurableSession(
        userBranchSourceId,
        session => session.turns?.length === 3 && session.turns[1]?.id === userBranchTurnIds[1],
        'user-message branch fixture persisted'
    );
    await waitForDurableSession(
        projectlessSourceId,
        session => session.turns?.length === 2 && session.turns[1]?.id === projectlessTurnIds[1],
        'projectless fixture persisted'
    );
    await waitForExactBranchComposerRoute({ evaluate, route, sessionId: sourceSessionId });

    const target88 = `.nmx-task-turn[data-turn-id="${turnIds[87]}"]`;
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(target88)}))`, 'turn 88 restored by virtualized anchor', 20_000);

    const selectedLocale = normalizeDesktopLocale(await evaluate(
        `document.querySelector('.nmx-desktop-widget')?.getAttribute('lang') || navigator.language`
    ));
    const expectedCreateBranch = conversationText(selectedLocale, 'createBranch');
    const expectedBranchTitle = `${projectFixture.title} · ${conversationText(selectedLocale, 'branchSuffix')}`;

    await click(`${target88} .nmx-user-message-actions > button[aria-expanded]`);
    evidence.userMenuLabel = await evaluate(`document.querySelector(${JSON.stringify(`${target88} .nmx-user-message-actions .nmx-message-branch span`)})?.textContent?.trim()`);
    expect(evidence.userMenuLabel === expectedCreateBranch, 'user message branch action is localized', evidence);
    await click('.nmx-coding-topbar');
    await waitFor(`!document.querySelector('.nmx-message-menu')`, 'user message menu closes outside');

    await click(`${target88} .nmx-turn-copy > button[aria-expanded]`);
    evidence.assistantMenuLabel = await evaluate(`document.querySelector(${JSON.stringify(`${target88} .nmx-turn-copy .nmx-message-branch span`)})?.textContent?.trim()`);
    expect(evidence.assistantMenuLabel === expectedCreateBranch, 'assistant message branch action is localized', evidence);
    await click(`${target88} .nmx-turn-copy .nmx-message-branch`);
    branchId = await waitFor(`(() => {
        const sessions = ${storedSessionsExpression};
        return sessions.find(session => session.id !== ${JSON.stringify(sourceSessionId)}
            && session.title === ${JSON.stringify(expectedBranchTitle)}
            && session.turns.at(-1)?.id === ${JSON.stringify(turnIds[87])})?.id || '';
    })()`, 'point-in-time branch is created', 20_000);

    const durableSourceAfterBranch = await waitForDurableSession(
        sourceSessionId,
        session => session.turns?.length === 100,
        'source remains durably unchanged after branch'
    );
    const durableBranch = await waitForDurableSession(
        branchId,
        session => session.turns?.length === 88 && session.turns[87]?.id === turnIds[87],
        'branch prefix persisted independently'
    );
    evidence.branch = await evaluate(`(() => {
        const state = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}');
        return {
            activeId: state.activeCodingSessionId,
            menuOpen: Boolean(document.querySelector('.nmx-message-menu')),
            warningOpen: Boolean(document.querySelector('.nmx-turn-edit-dialog'))
        };
    })()`);
    Object.assign(evidence.branch, {
        sourceTurns: durableSourceAfterBranch.session.turns.length,
        sourceTurnIds: durableSourceAfterBranch.session.turns.map(turn => turn.id),
        branchId: durableBranch.session.id,
        branchTurns: durableBranch.session.turns.length,
        branchTurnIds: durableBranch.session.turns.map(turn => turn.id),
        sourceAttachmentIds: durableSourceAfterBranch.session.turns[87]?.attachments?.map(item => item.id),
        branchAttachmentIds: durableBranch.session.turns[87]?.attachments?.map(item => item.id),
        sourceQueueLength: durableSourceAfterBranch.session.followUpQueue?.length || 0,
        branchQueueLength: durableBranch.session.followUpQueue?.length || 0,
        sourceRouteId: durableSourceAfterBranch.session.routeId,
        branchRouteId: durableBranch.session.routeId,
        sourcePersistenceFile: durableSourceAfterBranch.entry.file,
        branchPersistenceFile: durableBranch.entry.file,
        sourceConversationId: durableBranch.session.sourceConversationId,
        sourceMessageId: durableBranch.session.sourceMessageId,
        sourcePersistenceUnchanged: durableSourceAfterBranch.entry.sha256 === durableFixture.entry.sha256
    });
    expect(branchId !== sourceSessionId, 'branch gets a different conversation ID', evidence.branch);
    expect(evidence.branch.sourceTurns === 100, 'branch does not mutate source conversation', evidence.branch);
    expect(evidence.branch.branchTurns === 88, 'reply 88 branch includes exactly turns 1-88', evidence.branch);
    expect(JSON.stringify(evidence.branch.branchTurnIds) === JSON.stringify(turnIds.slice(0, 88)),
        'inherited message IDs remain stable and turns 89-100 are excluded', evidence.branch);
    expect(JSON.stringify(evidence.branch.sourceAttachmentIds) === JSON.stringify(evidence.branch.branchAttachmentIds),
        'project attachment IDs remain stable', evidence.branch);
    expect(evidence.branch.sourceQueueLength === 0 && evidence.branch.branchQueueLength === 0,
        'branch owns an independent empty follow-up queue', evidence.branch);
    expect(evidence.branch.sourceRouteId === route.routeId && evidence.branch.branchRouteId === route.routeId,
        'branch inherits the selected model route', evidence.branch);
    expect(evidence.branch.sourceConversationId === sourceSessionId
        && evidence.branch.sourceMessageId === assistantMessageIds[87],
    'assistant branch persists its exact source conversation and message IDs', evidence.branch);
    expect(evidence.branch.sourcePersistenceFile !== evidence.branch.branchPersistenceFile
        && evidence.branch.sourcePersistenceUnchanged,
    'source and branch have independent durable records', evidence.branch);
    expect(evidence.branch.activeId === branchId, 'new point-in-time branch becomes active', evidence.branch);
    expect(!evidence.branch.menuOpen && !evidence.branch.warningOpen,
        'branch closes its menu and does not reuse destructive edit warnings', evidence.branch);

    await beginSocketCapture();
    await waitForExactBranchComposerRoute({ evaluate, route, sessionId: branchId });
    await setTextarea('.nmx-composer textarea', branchProbePrompt);
    await click('.nmx-composer .nmx-send-button');
    const runningTurnId = await waitFor(`(() => {
        const branch = ${storedSessionsExpression}.find(session => session.id === ${JSON.stringify(branchId)});
        return branch?.turns.at(-1)?.stage === 'running' ? branch.turns.at(-1).id : '';
    })()`, 'real branch context probe starts running');
    const runningTurn = `.nmx-task-turn[data-turn-id="${runningTurnId}"]`;
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(runningTurn)}))`, 'running turn is visible');
    await click(`#nmx-message-menu-trigger-${runningTurnId}-user`);
    evidence.runningMenu = await waitFor(`(() => {
        const branch = ${storedSessionsExpression}.find(session => session.id === ${JSON.stringify(branchId)});
        const trigger = document.querySelector(${JSON.stringify(`#nmx-message-menu-trigger-${runningTurnId}-user`)});
        const button = document.querySelector(${JSON.stringify(`#nmx-message-menu-${runningTurnId}-user .nmx-message-branch[data-message-role="user"]`)});
        if (!button) return null;
        const turn = branch?.turns.find(turn => turn.id === ${JSON.stringify(runningTurnId)});
        return {
            disabled: button.disabled === true,
            expanded: trigger?.getAttribute('aria-expanded'),
            storedStage: turn?.stage || '',
            error: turn?.error || '',
            failure: turn?.failure || null,
            agentActivityVisible: Boolean(document.querySelector(${JSON.stringify(`${runningTurn} .nmx-agent-message.is-running`)}))
        };
    })()`, 'running message branch action is rendered');
    evidence.runningDisabled = evidence.runningMenu.disabled;
    expect(evidence.runningDisabled && evidence.runningMenu.storedStage === 'running',
        'message branch is disabled during a real running task', evidence.runningMenu);
    await click('.nmx-coding-topbar');
    await waitFor(`!document.querySelector('.nmx-message-menu')`, 'running menu closes outside');
    const branchRpc = await capturedAgentRequest(branchProbe, route);
    const branchRequest = branchRpc.request;
    const serializedBranchRequest = JSON.stringify(branchRequest);
    await waitFor(`(() => {
        const branch = ${storedSessionsExpression}.find(session => session.id === ${JSON.stringify(branchId)});
        return branch?.turns.at(-1)?.prompt === ${JSON.stringify(branchProbePrompt)} && branch.turns.at(-1)?.stage === 'complete';
    })()`, 'branch context probe completes', 40_000);
    const durableBranchAfterProbe = await waitForDurableSession(
        branchId,
        session => session.turns?.length === 89 && session.turns.at(-1)?.prompt === branchProbePrompt
            && session.turns.at(-1)?.stage === 'complete',
        'branch future turn persisted independently',
        45_000
    );
    const durableSourceBeforeEdit = await waitForDurableSession(
        sourceSessionId,
        session => session.turns?.length === 100,
        'source remains unchanged after branch continuation'
    );
    const branchFutureTurnId = durableBranchAfterProbe.session.turns.at(-1).id;
    evidence.branchFuture = {
        id: branchFutureTurnId,
        sourceContainsId: durableSourceBeforeEdit.session.turns.some(turn => turn.id === branchFutureTurnId),
        collidesWithSourceTail: turnIds.slice(88).includes(branchFutureTurnId),
        branchReasoningEffort: durableBranchAfterProbe.session.reasoningEffort,
        sourceReasoningEffort: durableSourceBeforeEdit.session.reasoningEffort,
        branchRouteId: durableBranchAfterProbe.session.routeId,
        sourceRouteId: durableSourceBeforeEdit.session.routeId,
        branchQueueLength: durableBranchAfterProbe.session.followUpQueue?.length || 0,
        sourceQueueLength: durableSourceBeforeEdit.session.followUpQueue?.length || 0
    };
    expect(!evidence.branchFuture.sourceContainsId && !evidence.branchFuture.collidesWithSourceTail,
        'every post-branch turn ID is new and disjoint from the source tail', evidence.branchFuture);
    expect(evidence.branchFuture.branchReasoningEffort === evidence.branchFuture.sourceReasoningEffort
        && evidence.branchFuture.branchRouteId === evidence.branchFuture.sourceRouteId,
    'branch inherits route preferences without mutating the source record', evidence.branchFuture);
    expect(evidence.branchFuture.branchQueueLength === 0 && evidence.branchFuture.sourceQueueLength === 0,
        'branch continuation does not share queue state', evidence.branchFuture);
    evidence.branchContext = {
        method: branchRpc.method,
        route: branchRequest.route,
        hasTarget: serializedBranchRequest.includes(keep88Marker),
        hasTurn89: serializedBranchRequest.includes(keep89Marker),
        hasOldTail: serializedBranchRequest.includes(forbiddenTailMarker),
        hasExactConnection: branchRequest.route?.kind === 'official_connection'
            && branchRequest.route.connectionId === route.connectionId
            && branchRequest.route.model === route.providerModelId
    };
    expect(branchRequest.reasoningEffort === 'low',
        'a capability-verified compatible route preserves the branch selected reasoning effort', branchRequest);
    expect(evidence.branchContext.hasTarget && !evidence.branchContext.hasTurn89 && !evidence.branchContext.hasOldTail
        && evidence.branchContext.hasExactConnection,
    'branch request uses the exact connection and sees reply 88 but no marker from turns 89-100', evidence.branchContext);

    await activateSession(sourceSessionId, turnIds[89]);
    await reload();
    const target90 = `.nmx-task-turn[data-turn-id="${turnIds[89]}"]`;
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(target90)}))`, 'turn 90 restored by virtualized anchor', 20_000);
    await click(`${target90} .nmx-user-message-actions > button[data-message-action="edit"]`);
    await setTextarea(`${target90} .nmx-user-message-editor textarea`, editedPrompt);
    await click(`${target90} .nmx-user-message-editor footer button.is-primary`);
    await waitFor(`Boolean(document.querySelector('.nmx-turn-edit-dialog'))`, 'edit confirmation opens');
    evidence.replaceWarning = await evaluate(`document.querySelector('.nmx-turn-edit-warning')?.textContent?.trim()`);
    expect(evidence.replaceWarning === conversationText(selectedLocale, 'replaceWarning'),
        'destructive warning belongs only to the edit-without-branch path', evidence.replaceWarning);

    await beginSocketCapture();
    await click('.nmx-turn-edit-dialog footer > button.is-danger-subtle');
    const editRpc = await capturedAgentRequest(editedPrompt, route);
    const editRequest = editRpc.request;
    const serializedEditRequest = JSON.stringify(editRequest);
    await waitFor(`(() => {
        const source = ${storedSessionsExpression}.find(session => session.id === ${JSON.stringify(sourceSessionId)});
        return source?.turns.at(-1)?.prompt === ${JSON.stringify(editedPrompt)}
            && source.turns.at(-1)?.stage === 'complete';
    })()`, 'edited replacement completes', 40_000);
    const durableSourceAfterEdit = await waitForDurableSession(
        sourceSessionId,
        session => session.turns?.length === 90 && session.turns.at(-1)?.prompt === editedPrompt
            && session.turns.at(-1)?.stage === 'complete',
        'edited source truncation persisted',
        45_000
    );
    const durableBranchAfterSourceEdit = await waitForDurableSession(
        branchId,
        session => session.turns?.length === 89 && session.turns.at(-1)?.id === branchFutureTurnId,
        'branch remains unchanged after source edit'
    );
    evidence.replace = await evaluate(`(() => {
        const state = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}');
        return {
            activeId: state.activeCodingSessionId
        };
    })()`);
    Object.assign(evidence.replace, {
        sourceTurns: durableSourceAfterEdit.session.turns.length,
        retainedIds: durableSourceAfterEdit.session.turns.slice(0, 89).map(turn => turn.id),
        replacementId: durableSourceAfterEdit.session.turns[89]?.id,
        replacementPrompt: durableSourceAfterEdit.session.turns[89]?.prompt,
        oldTailPresent: durableSourceAfterEdit.session.turns.some(turn => turn.prompt.includes(forbiddenTailMarker)),
        branchTurns: durableBranchAfterSourceEdit.session.turns.length,
        branchFutureTurnId: durableBranchAfterSourceEdit.session.turns.at(-1)?.id,
        sourcePersistenceFile: durableSourceAfterEdit.entry.file,
        branchPersistenceFile: durableBranchAfterSourceEdit.entry.file,
        sourceQueueLength: durableSourceAfterEdit.session.followUpQueue?.length || 0,
        branchQueueLength: durableBranchAfterSourceEdit.session.followUpQueue?.length || 0
    });
    evidence.replaceContext = {
        method: editRpc.method,
        route: editRequest.route,
        hasRetained89: serializedEditRequest.includes(keep89Marker),
        hasOldTail: serializedEditRequest.includes(forbiddenTailMarker),
        hasEditedPrompt: serializedEditRequest.includes(editedPrompt),
        hasExactConnection: editRequest.route?.kind === 'official_connection'
            && editRequest.route.connectionId === route.connectionId
            && editRequest.route.model === route.providerModelId
    };
    expect(evidence.replace.sourceTurns === 90 && evidence.replace.replacementPrompt === editedPrompt,
        'source is permanently truncated and edited prompt becomes the new turn 90', evidence.replace);
    expect(JSON.stringify(evidence.replace.retainedIds) === JSON.stringify(turnIds.slice(0, 89)),
        'turns 1-89 and their IDs remain stable after replacement', evidence.replace);
    expect(evidence.replace.replacementId !== turnIds[89]
        && evidence.replace.replacementId !== branchFutureTurnId
        && !evidence.replace.oldTailPresent,
    'old turn 90 and turns 91-100 are removed and the replacement ID is branch-disjoint', evidence.replace);
    expect(evidence.replace.activeId === sourceSessionId && evidence.replace.branchTurns === 89,
        'replace stays on source while earlier branch remains independent', evidence.replace);
    expect(evidence.replace.branchFutureTurnId === branchFutureTurnId
        && evidence.replace.sourcePersistenceFile !== evidence.replace.branchPersistenceFile
        && evidence.replace.sourceQueueLength === 0 && evidence.replace.branchQueueLength === 0,
    'source edit leaves branch turns, queue and persistence record independent', evidence.replace);
    expect(evidence.replaceContext.hasRetained89 && evidence.replaceContext.hasEditedPrompt && !evidence.replaceContext.hasOldTail
        && evidence.replaceContext.hasExactConnection,
    'replacement request uses the exact connection and model context is turns 1-89 plus edited prompt only', evidence.replaceContext);

    await activateSession(userBranchSourceId, userBranchTurnIds[1]);
    await reload();
    const userBranchTarget = `.nmx-task-turn[data-turn-id="${userBranchTurnIds[1]}"]`;
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(userBranchTarget)}))`, 'user-message branch target restored');
    await click(`${userBranchTarget} .nmx-user-message-actions > button[aria-expanded]`);
    await click(`${userBranchTarget} .nmx-user-message-actions .nmx-message-branch`);
    try {
        userBranchId = await waitFor(`(() => {
            const sessions = ${storedSessionsExpression};
            return sessions.find(session => session.id !== ${JSON.stringify(userBranchSourceId)}
                && session.title === ${JSON.stringify(`${userBranchFixture.title} · ${conversationText(selectedLocale, 'branchSuffix')}`)}
                && session.turns.length === 2
                && session.turns[1]?.id === ${JSON.stringify(userBranchTurnIds[1])}
                && session.turns[1]?.branchUserOnly === true)?.id || '';
        })()`, 'user-message point-in-time branch is created', 20_000);
    } catch (error) {
        const diagnostics = await evaluate(`(() => ({
            activeSessionId: JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}').activeCodingSessionId || '',
            sessions: ${storedSessionsExpression}
                .filter(session => session.id === ${JSON.stringify(userBranchSourceId)}
                    || session.title.includes('NM user-message branch E2E'))
                .map(session => ({
                    id: session.id,
                    title: session.title,
                    turns: session.turns.map(turn => ({
                        id: turn.id,
                        stage: turn.stage,
                        response: turn.response,
                        branchUserOnly: turn.branchUserOnly === true
                    })),
                    queueLength: session.followUpQueue?.length || 0,
                    draftPrompt: session.draftPrompt || ''
                })),
            targetPresent: Boolean(document.querySelector(${JSON.stringify(userBranchTarget)})),
            menuText: document.querySelector(${JSON.stringify(`${userBranchTarget} .nmx-message-menu`)})?.textContent?.trim() || '',
            branchActionDisabled: document.querySelector(${JSON.stringify(`${userBranchTarget} .nmx-message-branch`)})?.disabled,
            notifications: JSON.parse(localStorage.getItem('nextmux.desktop.notifications.v1') || '[]').slice(0, 5)
        }))()`);
        throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`);
    }
    const durableUserSource = await waitForDurableSession(
        userBranchSourceId,
        session => session.turns?.length === 3 && session.followUpQueue?.length === 1
            && session.draftPrompt?.includes(userBranchDraftMarker),
        'user-message source state remains unchanged'
    );
    const durableUserBranch = await waitForDurableSession(
        userBranchId,
        session => session.turns?.length === 2 && session.turns[1]?.branchUserOnly === true
            && session.turns[1]?.response === '' && !session.draftPrompt
            && !session.draftPastedTextReferences && (session.followUpQueue?.length || 0) === 0,
        'user-message branch owns clean continuation state'
    );
    evidence.userBranch = {
        sourceId: durableUserSource.session.id,
        branchId: durableUserBranch.session.id,
        sourceTurns: durableUserSource.session.turns.length,
        branchTurns: durableUserBranch.session.turns.length,
        targetIdStable: durableUserBranch.session.turns[1]?.id === userBranchTurnIds[1],
        promptRetained: durableUserBranch.session.turns[1]?.prompt.includes(userBranchPromptMarker),
        responseRemoved: durableUserBranch.session.turns[1]?.response === '',
        branchUserOnly: durableUserBranch.session.turns[1]?.branchUserOnly === true,
        sourceConversationId: durableUserBranch.session.sourceConversationId,
        sourceMessageId: durableUserBranch.session.sourceMessageId,
        sourceQueueLength: durableUserSource.session.followUpQueue?.length || 0,
        branchQueueLength: durableUserBranch.session.followUpQueue?.length || 0,
        sourceDraftRetained: durableUserSource.session.draftPrompt?.includes(userBranchDraftMarker),
        sourcePastedTextRetained: durableUserSource.session.draftPastedTextReferences?.includes(userDraftReference.id),
        branchDraftCleared: !durableUserBranch.session.draftPrompt && !durableUserBranch.session.draftPastedTextReferences
    };
    expect(userBranchId !== userBranchSourceId && evidence.userBranch.sourceTurns === 3
        && evidence.userBranch.branchTurns === 2 && evidence.userBranch.targetIdStable
        && evidence.userBranch.promptRetained && evidence.userBranch.responseRemoved && evidence.userBranch.branchUserOnly,
    'branching from a user message keeps that prompt and excludes its assistant reply', evidence.userBranch);
    expect(evidence.userBranch.sourceQueueLength === 1 && evidence.userBranch.branchQueueLength === 0
        && evidence.userBranch.sourceDraftRetained && evidence.userBranch.sourcePastedTextRetained
        && evidence.userBranch.branchDraftCleared,
    'source draft, pasted-text reference and queue stay owned by the source while the branch starts clean', evidence.userBranch);
    expect(evidence.userBranch.sourceConversationId === userBranchSourceId
        && evidence.userBranch.sourceMessageId === userBranchMessageIds[1].user,
    'user branch persists its exact source conversation and message IDs', evidence.userBranch);

    await beginSocketCapture();
    await waitForExactBranchComposerRoute({ evaluate, route, sessionId: userBranchId });
    await setTextarea('.nmx-composer textarea', userBranchProbe);
    await click('.nmx-composer .nmx-send-button');
    const userBranchRpc = await capturedAgentRequest(userBranchProbe, route);
    const serializedUserBranchRequest = JSON.stringify(userBranchRpc.request);
    await waitFor(`(() => {
        const branch = ${storedSessionsExpression}.find(session => session.id === ${JSON.stringify(userBranchId)});
        return branch?.turns.at(-1)?.prompt === ${JSON.stringify(userBranchProbe)} && branch.turns.at(-1)?.stage === 'complete';
    })()`, 'user-message branch continuation completes', 40_000);
    evidence.userBranchContext = {
        hasTargetPrompt: serializedUserBranchRequest.includes(userBranchPromptMarker),
        hasTargetResponse: serializedUserBranchRequest.includes(userBranchForbiddenResponseMarker),
        hasSourceTail: serializedUserBranchRequest.includes('User branch prompt 3'),
        hasProbe: serializedUserBranchRequest.includes(userBranchProbe)
    };
    expect(evidence.userBranchContext.hasTargetPrompt && !evidence.userBranchContext.hasTargetResponse
        && !evidence.userBranchContext.hasSourceTail && evidence.userBranchContext.hasProbe,
    'user-message branch model context stops exactly after the selected user prompt', evidence.userBranchContext);

    await activateSession(projectlessSourceId, projectlessTurnIds[1]);
    await reload();
    const projectlessTarget = `.nmx-task-turn[data-turn-id="${projectlessTurnIds[1]}"]`;
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(projectlessTarget)}))`, 'projectless attachment turn');
    await click(`${projectlessTarget} .nmx-user-message-actions > button[data-message-action="edit"]`);
    await click(`${projectlessTarget} .nmx-user-message-editor footer button.is-primary`);
    await waitFor(`Boolean(document.querySelector('.nmx-turn-edit-dialog'))`, 'projectless edit confirmation');
    evidence.rollbackPreview = await evaluate(`(() => ({
        checkedByDefault: document.querySelector('.nmx-turn-edit-restore input')?.checked === true,
        previewVisibleByDefault: Boolean(document.querySelector('.nmx-turn-edit-diff-preview'))
    }))()`);
    await click('.nmx-turn-edit-restore input');
    const rollbackPreviewState = await waitFor(`(() => {
        const path = document.querySelector('.nmx-turn-edit-diff-preview code')?.textContent || '';
        const error = document.querySelector('.nmx-turn-edit-error')?.textContent?.trim() || '';
        return path || error ? { path, error } : null;
    })()`, 'real checkpoint diff preview');
    expect(rollbackPreviewState.path === rollbackPreviewRelativePath,
        'real checkpoint diff preview resolves the exact source file', rollbackPreviewState);
    Object.assign(evidence.rollbackPreview, await evaluate(`(() => ({
        path: document.querySelector('.nmx-turn-edit-diff-preview code')?.textContent || '',
        count: document.querySelectorAll('.nmx-turn-edit-diff-preview > div').length,
        replaceDisabled: document.querySelector('.nmx-turn-edit-dialog footer > button.is-danger-subtle')?.disabled === true,
        branchDisabled: document.querySelector('.nmx-turn-edit-dialog footer > button.is-primary')?.disabled === true
    }))()`));
    expect(!evidence.rollbackPreview.checkedByDefault && !evidence.rollbackPreview.previewVisibleByDefault
        && evidence.rollbackPreview.path === rollbackPreviewRelativePath && evidence.rollbackPreview.count === 1
        && !evidence.rollbackPreview.replaceDisabled && !evidence.rollbackPreview.branchDisabled,
    'rollback stays opt-in and gates execution on a real checkpoint diff preview', evidence.rollbackPreview);
    await click('.nmx-turn-edit-dialog footer > button:last-child');
    await click(`${projectlessTarget} .nmx-user-message-editor footer > button:first-child`);
    await click(`${projectlessTarget} .nmx-turn-copy > button[aria-expanded]`);
    await click(`${projectlessTarget} .nmx-turn-copy .nmx-message-branch`);
    try {
        projectlessBranchId = await waitFor(`(() => {
            const sessions = ${storedSessionsExpression};
            return sessions.find(session => session.id !== ${JSON.stringify(projectlessSourceId)}
                && session.title.startsWith(${JSON.stringify(`${projectlessFixture.title} ·`)})
                && session.turns.at(-1)?.id === ${JSON.stringify(projectlessTurnIds[1])})?.id || '';
        })()`, 'projectless attachment branch', 20_000);
    } catch (error) {
        const diagnostics = await evaluate(`(() => ({
            sessions: ${storedSessionsExpression}.filter(session => session.title.includes('NM projectless branch E2E'))
                .map(session => ({ id: session.id, title: session.title, turns: session.turns.map(turn => turn.id) })),
            notifications: JSON.parse(localStorage.getItem('nextmux.desktop.notifications.v1') || '[]').slice(0, 5),
            menu: document.querySelector('.nmx-message-menu')?.textContent?.trim() || ''
        }))()`);
        throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`);
    }
    const projectlessBranchRoot = join(dataRoot, 'conversation-workspaces', projectlessBranchId);
    cleanupRoots.add(projectlessBranchRoot);
    cleanupCheckpointRoots.add(checkpointRoot(projectlessBranchRoot));
    const durableProjectlessSource = await waitForDurableSession(
        projectlessSourceId,
        session => session.turns?.length === 2,
        'projectless source remains persisted'
    );
    const durableProjectlessBranch = await waitForDurableSession(
        projectlessBranchId,
        session => session.turns?.length === 2 && session.turns[1]?.id === projectlessTurnIds[1],
        'projectless branch persisted independently'
    );
    evidence.projectless = await evaluate(`(() => {
        const state = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}');
        return {
            activeId: state.activeCodingSessionId,
            menuOpen: Boolean(document.querySelector('.nmx-message-menu'))
        };
    })()`);
    const sourceAttachment = durableProjectlessSource.session.turns[1]?.attachments?.[0];
    const branchAttachment = durableProjectlessBranch.session.turns[1]?.attachments?.[0];
    const branchCheckpointSentinel = join(checkpointRoot(projectlessBranchRoot), 'branch-independence.txt');
    const copiedCheckpoint = await waitForNode(async () => {
        try {
            return await readFile(branchCheckpointSentinel, 'utf8');
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
            return '';
        }
    }, 'projectless checkpoint fork');
    await writeFile(branchCheckpointSentinel, 'branch-checkpoint', 'utf8');
    const sourceCheckpointAfterBranchMutation = await readFile(checkpointSentinel, 'utf8');
    Object.assign(evidence.projectless, {
        sourceId: durableProjectlessSource.session.id,
        branchId: durableProjectlessBranch.session.id,
        sourceAttachmentId: sourceAttachment?.id,
        branchAttachmentId: branchAttachment?.id,
        sourceUri: sourceAttachment?.uri,
        branchUri: branchAttachment?.uri,
        sourceRelativePath: sourceAttachment?.workspaceRelativePath,
        branchRelativePath: branchAttachment?.workspaceRelativePath,
        sourcePersistenceFile: durableProjectlessSource.entry.file,
        branchPersistenceFile: durableProjectlessBranch.entry.file,
        sourceConversationId: durableProjectlessBranch.session.sourceConversationId,
        sourceMessageId: durableProjectlessBranch.session.sourceMessageId,
        checkpointCopied: copiedCheckpoint,
        sourceCheckpointAfterBranchMutation
    });
    expect(evidence.projectless.sourceAttachmentId === projectlessAttachmentId
        && evidence.projectless.branchAttachmentId === projectlessAttachmentId,
    'projectless attachment ID remains stable', evidence.projectless);
    expect(evidence.projectless.sourceUri.includes(projectlessSourceId)
        && evidence.projectless.branchUri.includes(projectlessBranchId)
        && evidence.projectless.sourceRelativePath === evidence.projectless.branchRelativePath,
    'projectless attachment URI is rebased into the copied private workspace', evidence.projectless);
    expect(evidence.projectless.checkpointCopied === 'source-checkpoint'
        && evidence.projectless.sourceCheckpointAfterBranchMutation === 'source-checkpoint'
        && evidence.projectless.sourcePersistenceFile !== evidence.projectless.branchPersistenceFile,
    'projectless checkpoint and persistence records are copied into independent branch scopes', evidence.projectless);
    expect(evidence.projectless.sourceConversationId === projectlessSourceId
        && evidence.projectless.sourceMessageId === projectlessMessageIds[1].assistant,
    'projectless branch persists its exact source conversation and message IDs', evidence.projectless);
    expect(evidence.projectless.activeId === projectlessBranchId && !evidence.projectless.menuOpen,
        'projectless branch activates and closes its menu', evidence.projectless);

    evidence.locale = selectedLocale;
    passed = true;
} catch (error) {
    primaryError = error;
} finally {
    let running = false;
    if (cdpConnected) {
        try {
            running = await evaluate(`Boolean(document.querySelector('.nmx-stop-glyph'))`);
        } catch (error) {
            cleanupErrors.push(error);
        }
    }
    if (running) {
        await evaluate(`document.querySelector('.nmx-stop-button, .nmx-send-button')?.click()`).catch(error => cleanupErrors.push(error));
        await waitFor(`!document.querySelector('.nmx-stop-glyph')`, 'stopped failed branch task', 15_000).catch(error => cleanupErrors.push(error));
    }
    if (cdpConnected) await uninstallWebSocketJsonRpcCapture(evaluate, rpcCaptureKey).catch(error => cleanupErrors.push(error));
    if (cdpConnected) await evaluate(`document.querySelector('.nmx-dialog-backdrop header button')?.click()`).catch(error => cleanupErrors.push(error));
    const cleanupSessionIds = [projectlessBranchId, projectlessSourceId, userBranchId, userBranchSourceId, branchId, sourceSessionId].filter(Boolean);
    if (cdpConnected && sessionBaselineCaptured && (!projectlessBranchId || !userBranchId || !branchId)) {
        try {
            const currentSessionIds = await readConversationSessionIds(evaluate);
            const uniqueUncapturedId = uniqueNewResourceId(
                [...beforeSessionIds, ...cleanupSessionIds],
                currentSessionIds,
                'uncaptured branch conversation'
            );
            if (uniqueUncapturedId) cleanupSessionIds.unshift(uniqueUncapturedId);
        } catch (error) {
            cleanupErrors.push(error);
        }
    }
    for (const sessionId of cdpConnected ? [...new Set(cleanupSessionIds)] : []) {
        if (!sessionId) continue;
        await deleteFixtureSession(sessionId).catch(error => cleanupErrors.push(
            new Error(`Failed to remove fixture session ${sessionId}: ${error.message}`, { cause: error })
        ));
    }
    if (cdpConnected && qaRoute) await removeExactOfficialQaRoute({ evaluate, route: qaRoute }).catch(error => cleanupErrors.push(error));
    if (cdpConnected && storageSnapshot) {
        await evaluate(`(() => {
            localStorage.clear();
            for (const [key, value] of Object.entries(${JSON.stringify(storageSnapshot.local)})) localStorage.setItem(key, value);
            sessionStorage.clear();
            for (const [key, value] of Object.entries(${JSON.stringify(storageSnapshot.session)})) sessionStorage.setItem(key, value);
        })()`).catch(error => cleanupErrors.push(error));
        await reload().catch(error => cleanupErrors.push(error));
    }
    for (const path of [...cleanupRoots, ...cleanupCheckpointRoots]) {
        await rm(path, { recursive: true, force: true }).catch(error => cleanupErrors.push(
            new Error(`Failed to remove fixture path ${path}: ${error.message}`, { cause: error })
        ));
    }
    if (socket) {
        try { socket.close(); } catch (error) { cleanupErrors.push(error); }
    }
}

throwPrimaryOrCleanupErrors(primaryError, cleanupErrors, 'Conversation branch E2E');
console.log(JSON.stringify({ passed, evidence }, undefined, 2));
