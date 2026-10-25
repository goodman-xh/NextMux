#!/usr/bin/env node

import { join } from 'node:path';
import { ConversationStore } from '../packages/theia-nextmux-extension/lib/node/nextmux-conversation-store.js';
import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const fixtureId = `nmx-permission-e2e-${Date.now()}`;
const fixtureTitle = `NM permission E2E ${Date.now()}`;
const fixtureTurnId = `${fixtureId}-turn`;
const requestedWorkspacePath = process.env.NEXTMUX_E2E_WORKSPACE || '';
const desktopStateDirectory = process.env.NEXTMUX_DESKTOP_STATE_DIR || '';
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const { socket, call, evaluate } = await connectToNextMuxWorkbench(cdpPort);

async function waitFor(expression, label, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
        value = await evaluate(expression);
        if (value) return value;
        await wait(120);
    }
    throw new Error(`Timed out: ${label}; last value: ${JSON.stringify(value)}`);
}

async function clickExpression(expression, label) {
    await waitFor(`(() => {
        const node = (${expression});
        if (!(node instanceof HTMLElement) || node.matches(':disabled')) return null;
        node.scrollIntoView({ block: 'center', inline: 'nearest' });
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    })()`, label);
    await evaluate(`(() => {
        const node = (${expression});
        if (!(node instanceof HTMLElement) || node.matches(':disabled')) return false;
        node.click();
        return true;
    })()`);
    await wait(220);
}

async function reload(label) {
    await reloadDesktopDocument({ call, evaluate });
    await waitFor(`document.readyState === 'complete' && Boolean(document.querySelector('.nmx-desktop-widget'))`, label, 30_000);
    await wait(650);
}

function assert(condition, label, value) {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(value)}`);
}

let storageSnapshot;
let fixtureSeeded = false;
let fixtureDeleted = false;
let report;

async function readStorage() {
    return evaluate(`(() => ({
        local: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
        session: Object.fromEntries(Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)]))
    }))()`);
}

async function restoreStorage() {
    if (!storageSnapshot) return;
    await evaluate(`(() => {
        const local = ${JSON.stringify(storageSnapshot.local)};
        const session = ${JSON.stringify(storageSnapshot.session)};
        localStorage.clear();
        sessionStorage.clear();
        for (const [key, value] of Object.entries(local)) localStorage.setItem(key, value);
        for (const [key, value] of Object.entries(session)) sessionStorage.setItem(key, value);
    })()`);
}

async function removeFixtureThroughDom() {
    await evaluate(`document.querySelector('.nmx-permission-sheet > header > button')?.click()`);
    await evaluate(`document.querySelector('[data-desktop-section="coding"]')?.click()`);
    await waitFor(`Boolean(document.querySelector('.nmx-context-actions'))`, 'coding context actions during cleanup', 8_000);
    const row = await evaluate(`(() => [...document.querySelectorAll('.nmx-session-row')].find(node =>
        node.querySelector('.nmx-session-open span')?.textContent === ${JSON.stringify(fixtureTitle)}
    )?.className || '')()`);
    if (!row) return false;
    await clickExpression(`(() => [...document.querySelectorAll('.nmx-session-row')].find(node =>
        node.querySelector('.nmx-session-open span')?.textContent === ${JSON.stringify(fixtureTitle)}
    )?.querySelector('.nmx-session-more'))()`, 'fixture conversation menu');
    await clickExpression(`(() => [...document.querySelectorAll('.nmx-session-row')].find(node =>
        node.querySelector('.nmx-session-open span')?.textContent === ${JSON.stringify(fixtureTitle)}
    )?.querySelector('.nmx-session-menu .is-danger'))()`, 'fixture conversation delete action');
    const deleteOutcome = await waitFor(`(() => {
        const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
        const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
        if (!sessions.some(session => session.id === ${JSON.stringify(fixtureId)})) return 'deleted';
        return document.querySelector('.nmx-thread-dialog') ? 'confirm' : '';
    })()`, 'fixture delete outcome', 5_000);
    // Deleting a non-current row is intentionally immediate; deleting the
    // active row asks for confirmation. Cleanup accepts both real product
    // paths instead of assuming that every row must open the modal.
    if (deleteOutcome === 'confirm') {
        await clickExpression(`document.querySelector('.nmx-thread-dialog footer .is-danger')`, 'confirm fixture deletion');
    }
    await waitFor(`(() => {
        const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
        const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
        return !sessions.some(session => session.id === ${JSON.stringify(fixtureId)});
    })()`, 'fixture removal from renderer persistence', 12_000);
    // Conversation persistence is debounced before it reaches the durable local backend.
    // Do not reload the renderer until the delete patch has had time to commit.
    await wait(2_000);
    fixtureDeleted = true;
    return true;
}

try {
    await Promise.all([call('Runtime.enable'), call('Page.enable')]);
    await call('Page.bringToFront');
    storageSnapshot = await readStorage();

    const seed = await evaluate(`(() => {
        const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
        const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
        const workspacePath = ${JSON.stringify(requestedWorkspacePath)}
            || sessions.find(session => session.workspacePath)?.workspacePath
            || JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}').workspace
            || '';
        if (!workspacePath) return { workspacePath: '', seeded: false };
        const now = Date.now();
        const fixture = {
            id: ${JSON.stringify(fixtureId)},
            workspacePath,
            title: ${JSON.stringify(fixtureTitle)},
            turns: [{
                id: ${JSON.stringify(fixtureTurnId)},
                prompt: 'Permission persistence fixture',
                response: 'Permission persistence fixture response',
                error: '',
                stage: 'complete',
                createdAt: now - 1000,
                completedAt: now - 500,
                permissionMode: 'workspace_write',
                routeLabel: 'E2E fixture',
                executionLabel: '',
                usageLabel: ''
            }],
            pinned: false,
            routeId: '',
            relayKey: '',
            reasoningEffort: 'medium',
            permissionMode: 'workspace_write',
            createdAt: now - 2000,
            updatedAt: now
        };
        const existing = sessions.filter(session => session.id !== ${JSON.stringify(fixtureId)});
        localStorage.setItem('nextmux.desktop.codingSessions.v1', JSON.stringify({
            version: 2,
            complete: false,
            sessions: [fixture, ...existing]
        }));
        localStorage.setItem('nextmux.desktop.restoreState.v1', JSON.stringify({
            version: 1,
            section: 'coding',
            workspace: workspacePath,
            codingPanel: 'thread',
            activeCodingSessionId: ${JSON.stringify(fixtureId)},
            newConversation: false,
            settingsPanel: 'profile',
            billingTab: 'usage',
            modelCenterView: 'all',
            modelCapabilityFilter: 'all',
            comicView: 'storyboard'
        }));
        return { workspacePath, seeded: true };
    })()`);
    assert(seed.seeded, 'an existing workspace is required for the isolated fixture', seed);
    assert(Boolean(desktopStateDirectory), 'the E2E runner must expose its isolated desktop state directory', desktopStateDirectory);
    const fixtureRecord = {
        id: fixtureId,
        workspacePath: seed.workspacePath,
        title: fixtureTitle,
        turns: [{
            id: fixtureTurnId,
            prompt: 'Permission persistence fixture',
            response: 'Permission persistence fixture response',
            error: '',
            stage: 'complete',
            createdAt: Date.now() - 1000,
            completedAt: Date.now() - 500,
            permissionMode: 'workspace_write',
            routeLabel: 'E2E fixture',
            executionLabel: '',
            usageLabel: ''
        }],
        pinned: false,
        routeId: '',
        relayKey: '',
        reasoningEffort: 'medium',
        permissionMode: 'workspace_write',
        createdAt: Date.now() - 2000,
        updatedAt: Date.now()
    };
    // Seed the authoritative store as well as the startup mirror. This avoids
    // an old renderer debounce overwriting a localStorage-only fixture and
    // exercises the same durable reload path used by distributed builds.
    const conversationStore = new ConversationStore(join(desktopStateDirectory, 'conversation-history-v1'));
    await conversationStore.patch([fixtureRecord], []);
    fixtureSeeded = true;
    console.log(JSON.stringify({ phase: 'fixture-seeded', fixtureId, workspacePath: seed.workspacePath }));

    await reload('fixture reload');
    await evaluate(`document.querySelector('[data-desktop-section="coding"]')?.click()`);
    await waitFor(`Boolean(document.querySelector('.nmx-context-actions'))`, 'coding surface after fixture reload', 12_000);
    const seedDiagnostics = await evaluate(`(() => {
        const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
        const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
        return {
            mirrorFixture: sessions.find(session => session.id === ${JSON.stringify(fixtureId)}) || null,
            renderedTitles: [...document.querySelectorAll('.nmx-session-row .nmx-session-open span')].map(node => node.textContent),
            projectStates: [...document.querySelectorAll('.nmx-project-row')].map(node => ({
                title: node.textContent?.trim() || '', expanded: node.getAttribute('aria-expanded')
            }))
        };
    })()`);
    const durableDiagnostics = await conversationStore.load();
    console.log(JSON.stringify({ phase: 'fixture-reload-diagnostics', seedDiagnostics,
        durableFixture: durableDiagnostics.sessions.find(session => session.id === fixtureId) || null }));
    // A prior locale/navigation E2E may leave a one-shot navigation snapshot
    // that intentionally wins over the ordinary restore state. Locate the
    // durable fixture by identity and open it through the real conversation UI
    // instead of coupling this permission test to that unrelated navigation.
    await waitFor(`(() => [...document.querySelectorAll('.nmx-session-row')].some(node =>
        node.querySelector('.nmx-session-open span')?.textContent === ${JSON.stringify(fixtureTitle)}
    ))()`, 'seeded existing conversation row', 30_000);
    await clickExpression(`(() => [...document.querySelectorAll('.nmx-session-row')].find(node =>
        node.querySelector('.nmx-session-open span')?.textContent === ${JSON.stringify(fixtureTitle)}
    )?.querySelector('.nmx-session-open'))()`, 'open seeded existing conversation');
    await waitFor(`document.querySelector('.nmx-session-row.is-current .nmx-session-open span')?.textContent === ${JSON.stringify(fixtureTitle)}`, 'seeded existing conversation selected', 12_000);
    const initial = await evaluate(`(() => {
        const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
        const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
        const session = sessions.find(item => item.id === ${JSON.stringify(fixtureId)});
        return {
            title: session?.title,
            permissionMode: session?.permissionMode,
            button: document.querySelector('.nmx-permission-button')?.textContent?.trim() || ''
        };
    })()`);
    assert(initial.permissionMode === 'workspace_write', 'fixture starts with workspace-write permission', initial);

    await clickExpression(`document.querySelector('.nmx-permission-button')`, 'current conversation permission control');
    await waitFor(`Boolean(document.querySelector('.nmx-permission-popover'))`, 'current conversation permission menu');
    await clickExpression(`document.querySelector('.nmx-permission-popover button:nth-of-type(3)')`, 'full-access conversation option');
    await waitFor(`Boolean(document.querySelector('.nmx-permission-sheet'))`, 'full-access confirmation sheet');
    await clickExpression(`document.querySelector('.nmx-permission-sheet .nmx-primary-button')`, 'confirm full access for conversation');
    const selected = await waitFor(`(() => {
        const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
        const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
        const session = sessions.find(item => item.id === ${JSON.stringify(fixtureId)});
        return session?.permissionMode === 'full_access' && /完全访问|Full access/i.test(document.querySelector('.nmx-permission-button')?.textContent || '')
            ? { permissionMode: session.permissionMode, button: document.querySelector('.nmx-permission-button').textContent.trim() }
            : null;
    })()`, 'full-access conversation persistence', 12_000);
    console.log(JSON.stringify({ phase: 'conversation-permission-persisted', selected }));

    await reload('permission persistence reload');
    const reloadDiagnostics = await evaluate(`(() => {
        const current = document.querySelector('.nmx-session-row.is-current .nmx-session-open span')?.textContent || '';
        const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
        const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
        const session = sessions.find(item => item.id === ${JSON.stringify(fixtureId)});
        return { current, session: session ? { id: session.id, permissionMode: session.permissionMode, updatedAt: session.updatedAt } : null,
            button: document.querySelector('.nmx-permission-button')?.textContent?.trim() || '' };
    })()`);
    console.log(JSON.stringify({ phase: 'permission-reload-diagnostics', reloadDiagnostics }));
    const reloaded = await waitFor(`(() => {
        const current = document.querySelector('.nmx-session-row.is-current .nmx-session-open span')?.textContent || '';
        const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
        const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
        const session = sessions.find(item => item.id === ${JSON.stringify(fixtureId)});
        const button = document.querySelector('.nmx-permission-button')?.textContent || '';
        return current === ${JSON.stringify(fixtureTitle)} && session?.permissionMode === 'full_access' && /完全访问|Full access/i.test(button)
            ? { current, permissionMode: session.permissionMode, button: button.trim() }
            : null;
    })()`, 'full-access permission after app reload', 30_000);
    console.log(JSON.stringify({ phase: 'conversation-permission-restored', reloaded }));

    await clickExpression(`document.querySelector('.nmx-account-trigger')`, 'settings account control');
    await waitFor(`Boolean(document.querySelector('.nmx-settings-nav'))`, 'settings navigation');
    await clickExpression(`document.querySelector('[data-settings-panel="permissions"]')`, 'permissions settings page');
    await waitFor(`Boolean(document.querySelector('.nmx-permission-options'))`, 'default permissions settings');
    await clickExpression(`document.querySelector('.nmx-permission-options button:nth-child(1)')`, 'change default permission to read-only');
    const changedDefault = await waitFor(`(() => {
        const selected = document.querySelector('.nmx-permission-options button.is-selected');
        return localStorage.getItem('nextmux.desktop.defaultPermissionMode.v1') === 'read_only'
            && selected === document.querySelector('.nmx-permission-options button:nth-child(1)')
            ? { defaultPermissionMode: localStorage.getItem('nextmux.desktop.defaultPermissionMode.v1'), selected: selected.textContent.trim() }
            : null;
    })()`, 'default permission persistence', 8_000);
    const existingAfterDefaultChange = await evaluate(`(() => {
        const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
        const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
        return sessions.find(session => session.id === ${JSON.stringify(fixtureId)})?.permissionMode;
    })()`);
    assert(existingAfterDefaultChange === 'full_access', 'changing default leaves existing conversation permission unchanged', existingAfterDefaultChange);
    console.log(JSON.stringify({ phase: 'default-permission-changed', changedDefault, existingPermissionMode: existingAfterDefaultChange }));

    await clickExpression(`document.querySelector('[data-desktop-section="coding"]')`, 'return to coding after default change');
    await waitFor(`Boolean(document.querySelector('.nmx-context-actions'))`, 'coding surface after default change');
    const existingUiAfterDefaultChange = await waitFor(`/完全访问|Full access/i.test(document.querySelector('.nmx-permission-button')?.textContent || '')`, 'existing conversation remains full access in UI', 8_000);
    await clickExpression(`document.querySelector('.nmx-context-actions button:first-child')`, 'new conversation action');
    const newConversation = await waitFor(`/只读|Read only/i.test(document.querySelector('.nmx-permission-button')?.textContent || '')`, 'new conversation receives changed default permission', 8_000);
    const storedExistingWhileNew = await evaluate(`(() => {
        const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
        const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
        return sessions.find(session => session.id === ${JSON.stringify(fixtureId)})?.permissionMode;
    })()`);
    assert(storedExistingWhileNew === 'full_access', 'new conversation draft does not mutate existing conversation persistence', storedExistingWhileNew);
    report = {
        fixtureId,
        conversationFullAccessBeforeReload: selected,
        conversationFullAccessAfterReload: reloaded,
        defaultPermissionChanged: changedDefault,
        existingUiAfterDefaultChange,
        newConversation,
        existingPermissionWhileNewConversation: storedExistingWhileNew,
        pass: reloaded.permissionMode === 'full_access'
            && changedDefault.defaultPermissionMode === 'read_only'
            && existingUiAfterDefaultChange
            && newConversation
            && storedExistingWhileNew === 'full_access'
    };
    assert(report.pass, 'permission persistence E2E failed', report);
    console.log(JSON.stringify({ phase: 'permission-contract-passed', report }, null, 2));
} finally {
    try {
        if (fixtureSeeded && !fixtureDeleted) await removeFixtureThroughDom();
    } catch (error) {
        console.error(`Fixture DOM cleanup failed: ${error instanceof Error ? error.message : error}`);
    }
    try {
        await restoreStorage();
        await reload('restore original application state');
    } catch (error) {
        console.error(`Original application state restore failed: ${error instanceof Error ? error.message : error}`);
    }
    socket.close();
}
