import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
    DESKTOP_RESTORE_STATE_KEY,
    normalizeDesktopSettingsPanel,
    refreshPendingDesktopRestoreState,
    parseDesktopReloadState,
    parseDesktopRestoreState
} from '../lib/browser/nextmux-desktop-restore-state.js';

test('durable desktop restore state is versioned and strictly normalized', () => {
    assert.equal(DESKTOP_RESTORE_STATE_KEY, 'nextmux.desktop.restoreState.v1');
    assert.deepEqual(parseDesktopRestoreState(JSON.stringify({
        version: 1,
        section: 'settings',
        workspace: 'C:\\workspace',
        codingPanel: 'thread',
        activeCodingSessionId: 'conversation-1',
        newConversation: false,
        settingsPanel: 'system',
        billingTab: 'movements',
        modelCenterView: 'capability',
        modelCapabilityFilter: 'video',
        comicView: 'timeline'
    })), {
        version: 1,
        section: 'settings',
        workspace: 'C:\\workspace',
        codingPanel: 'thread',
        activeCodingSessionId: 'conversation-1',
        newConversation: false,
        settingsPanel: 'system',
        billingTab: 'movements',
        modelCenterView: 'capability',
        modelCapabilityFilter: 'video',
        comicView: 'timeline'
    });
    assert.equal(parseDesktopRestoreState('{broken'), undefined);
    assert.equal(parseDesktopRestoreState({ version: 2 }), undefined);
});

test('retired model, media and proxy settings return to the account page (which holds appearance) on restart, locale reload, history and direct navigation', () => {
    for (const panel of ['official', 'managed', 'routing', 'media', 'general', 'network']) {
        assert.equal(normalizeDesktopSettingsPanel(panel), 'profile');
    }
    for (const panel of ['audio', 'voice']) {
        assert.equal(normalizeDesktopSettingsPanel(panel), 'system');
    }
    for (const panel of ['profile', 'billing', 'models', 'system', 'skills', 'mcp', 'permissions', 'privacy', 'data', 'updates']) {
        assert.equal(normalizeDesktopSettingsPanel(panel), panel);
    }
    for (const retired of ['official', 'managed', 'routing', 'media', 'general', 'network']) {
        const saved = { version: 1, section: 'settings', settingsPanel: retired, workspace: '/work', activeCodingSessionId: 'retained-session', newConversation: false };
        for (const state of [parseDesktopRestoreState(saved), parseDesktopReloadState(saved)]) {
            assert.equal(state.settingsPanel, 'profile');
            assert.equal(state.section, 'settings');
            assert.equal(state.workspace, '/work');
            assert.equal(state.activeCodingSessionId, 'retained-session');
        }
    }
    const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
    assert.match(source, /this\.settingsPanel = normalizeDesktopSettingsPanel\(saved\.settingsPanel\)/);
    assert.match(source, /const targetSettingsPanel = normalizeDesktopSettingsPanel\(snapshot\.settingsPanel\)/);
    assert.match(source, /const targetPanel = normalizeDesktopSettingsPanel\(panel\)/);
});

test('one-shot locale reload state wins without losing the explicit new-conversation state', () => {
    const existing = parseDesktopReloadState({
        section: 'coding',
        workspaceRoot: 'C:\\workspace',
        codingPanel: 'thread',
        codingSessionId: 'conversation-2',
        settingsPanel: 'profile'
    });
    assert.equal(existing?.activeCodingSessionId, 'conversation-2');
    assert.equal(existing?.newConversation, false);

    const draft = parseDesktopReloadState({
        section: 'coding',
        workspaceRoot: 'C:\\workspace',
        codingPanel: 'thread',
        codingSessionId: '',
        newConversation: true
    });
    assert.equal(draft?.activeCodingSessionId, '');
    assert.equal(draft?.newConversation, true);
});

test('model-center records views are durable and unknown views remain bounded', () => {
    const usage = parseDesktopRestoreState({
        version: 1, section: 'models', workspace: '', codingPanel: 'thread', activeCodingSessionId: '',
        newConversation: true, settingsPanel: 'profile', billingTab: 'usage', modelCenterView: 'usage',
        modelCapabilityFilter: 'all', comicView: 'storyboard'
    });
    assert.equal(usage?.modelCenterView, 'usage');
    assert.equal(parseDesktopRestoreState({ ...usage, modelCenterView: 'favorites' })?.modelCenterView, 'favorites');
    for (const retired of ['relays', 'verification']) assert.equal(parseDesktopRestoreState({ ...usage, modelCenterView: retired })?.modelCenterView, 'all');
    assert.equal(parseDesktopRestoreState({ ...usage, modelCenterView: 'private-admin-view' })?.modelCenterView, 'all');
});

test('an interaction during startup supersedes stale pending navigation without dropping restore data', () => {
    const pending = parseDesktopRestoreState({
        version: 1,
        section: 'coding',
        workspace: 'C:\\workspace',
        codingPanel: 'thread',
        activeCodingSessionId: 'conversation-2',
        newConversation: false,
        settingsPanel: 'profile',
        billingTab: 'usage',
        modelCenterView: 'all',
        modelCapabilityFilter: 'all',
        comicView: 'storyboard'
    });
    const interacted = parseDesktopRestoreState({
        ...pending,
        section: 'models',
        modelCenterView: 'official'
    });
    assert.ok(pending);
    assert.ok(interacted);
    assert.equal(refreshPendingDesktopRestoreState(pending, interacted)?.section, 'models');
    assert.equal(refreshPendingDesktopRestoreState(pending, interacted)?.modelCenterView, 'official');
    assert.equal(refreshPendingDesktopRestoreState(pending, interacted)?.activeCodingSessionId, 'conversation-2');
    assert.equal(refreshPendingDesktopRestoreState(undefined, interacted), undefined);
});

test('widget persists navigation only and delegates terminal and scroll restoration to session view state', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
    const selectSectionSource = source.slice(
        source.indexOf('protected selectSection('),
        source.indexOf('protected selectModelCenterView(')
    );
    assert.match(source, /loadDesktopRestoreState\(\)[\s\S]*?sessionStorage[\s\S]*?localStorage/);
    assert.match(source, /restoreDesktopRestoreState[\s\S]*?codingSessions\.find\(item => item\.id === saved\.activeCodingSessionId\)/);
    assert.match(source, /restoreDesktopRestoreState[\s\S]*?workspaceRootIsOpen\(saved\.workspace\)/);
    assert.match(source, /restoreDesktopRestoreState[\s\S]*?restoreCodingSessionState\(savedSession\)/);
    assert.match(selectSectionSource, /if \(section === this\.activeSection\) \{[\s\S]*?persistDesktopRestoreState\(\)[\s\S]*?return;/);
    assert.match(source, /startNewCodingTask[\s\S]*?persistDesktopRestoreState\(\)/);
    assert.match(source, /openCodingSession[\s\S]*?persistDesktopRestoreState\(\)/);
});
