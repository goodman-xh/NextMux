import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { conversationDisplayTitle } from '../lib/browser/nextmux-conversation-domain-locale.js';

// Real navigation/dismissal methods from the production widget. Only host
// services are replaced; no RPC, storage or rendering runs in this harness.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['closeNavigationSurface', 'completeNavigationSurface', 'dismissTopSurface', 'hasDismissibleSurface',
    'hasTransientNavigationSurface', 'sameNavigationLocation', 'handleSurfaceEscape',
    'rememberNavigation', 'navigateBack', 'navigateForward', 'applyNavigationSnapshot', 'applyNavigationSurface', 'clearNavigationSurfaces',
    'navigationSurface', 'navigationSnapshot', 'navigationSnapshotKey', 'navigationSurfaceKey',
    'canNavigateBack', 'canNavigateForward', 'commandNavigateBack', 'commandNavigateForward', 'runNavigationCommand',
    'openSettingsPanel', 'toggleSettingsPanel', 'commandOpenSettings', 'selectModelCenterView', 'selectModelCapabilityFilter', 'selectBillingTab',
    'openCodingSession', 'selectCodingPanel',
    'openComicHomeKind', 'openComicStudio', 'newComicChat', 'openComicChat', 'activateComicChatFolder', 'addComicChatFolder',
    'openComicLibraryProject', 'selectComicWorkspaceRoot', 'closeComicProject',
    'loadComicProject', 'resetComicSelection', 'syncComicSelection', 'comicWorkspaceRequestCurrent', 'restoreComicNavigationDesk',
    'comicEpisodes', 'comicScenesForActiveEpisode', 'activeComicEpisode', 'openComicDesk', 'openComicDeskEpisode', 'minimizeComicDesk',
    'isWorkContextSectionActive', 'comicContextWorkspaceRoot',
    'toggleCodingSessionMenu', 'beginCodingSessionRename', 'setComposerPrompt', 'setPermissionMode', 'toggleCodingPopover', 'noteBrowserDrawerDismissed'];
const methods = names.map(name => {
    const member = widget.members.find(node => (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && node.name.getText(file) === name);
    assert.ok(member, name);
    return member.getText(file);
});
const dependencies = { conversationDisplayTitle, normalizeDesktopSettingsPanel: value => value, window: { setTimeout() {}, clearTimeout() {} },
    normalizeAgentChildScrollStates: value => value || {}, desktopFailureMessage: () => '', requestAnimationFrame() {}, Element: class Element {},
    comicProjectKindOf: value => value || 'novel', comicKindText: (_locale, kind) => kind, modelFailureText: (_locale, error) => String(error),
    URI: { fromFilePath: path => path }, EMPTY_COMIC_STATE: { exists: false }, EMPTY_MEDIA_STATE: { jobs: [] } };
const Harness = new Function(...Object.keys(dependencies), ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, {
    target: ts.ScriptTarget.ES2022
}))(...Object.values(dependencies));

function fixture(overrides = {}) {
    const state = new Harness();
    Object.assign(state, {
        node: { isConnected: true }, id: 'test-widget', applicationShell: { currentWidget: { id: 'test-widget' } },
        activeSection: 'coding', codingPanel: 'thread', activeWorkspaceRoot: '/project', globalCodingDraft: true, draftWorkspaceRoot: '',
        activeCodingSessionId: '', activeScheduledTaskId: '', settingsPanel: 'profile', billingTab: 'usage',
        modelCenterView: 'all', modelCapabilityFilter: 'all', comicView: 'script', activeComicSceneId: '', activeComicShotId: '',
        codingSessions: [{ id: 'a', title: 'Alpha', workspacePath: '/project', turns: [] }, { id: 'b', title: 'Beta', workspacePath: '/project', turns: [] }],
        scheduledTasks: [], workspaceOptions: [{ path: '/project' }], navigationBackStack: [], navigationForwardStack: [], navigationRestoreGeneration: 0,
        codingPopover: '', codingSearchOpen: false, codingSearchQuery: '', codingSessionMenuId: '', codingSessionRenameId: '',
        codingSessionRenameValue: '', codingSessionDeleteId: '', accountMenuOpen: false, walletTopupSheetOpen: false,
        conversationWindowMenuOpen: false, projectMenuPath: '', projectDeletePath: '', pendingTurnEdit: undefined, turnCopyMenuId: '',
        fullAccessConfirmationOpen: false, fullAccessConfirmationTarget: 'current', pendingRelaySwitch: undefined,
        scheduleDialogOpen: false, comicCreateSheetOpen: false, comicCharacterSheetOpen: false, comicExportSheetOpen: false,
        mediaSheetOpen: false, selectedOffering: undefined, activeCheckpointDiff: undefined, officialProviderSheet: undefined,
        workContextOpen: false, workContextMode: 'file', contextFilePreview: undefined, permissionMode: 'workspace_write',
        defaultPermissionMode: 'full_access', agentStage: 'idle', activeAgentRunId: '', prompt: '', updates: 0, persisted: 0,
        activeCodingSession() { return this.codingSessions.find(item => item.id === this.activeCodingSessionId); },
        currentCodingSessionViewState() {
            return { workContextOpen: this.workContextOpen, workContextMode: this.workContextMode,
                ...(this.contextFilePreview?.uri ? { contextFileUri: this.contextFilePreview.uri } : {}) };
        },
        async restoreCodingViewState(viewState) {
            this.workContextOpen = Boolean(viewState?.workContextOpen);
            this.workContextMode = viewState?.workContextMode || 'browser';
            this.contextFilePreview = viewState?.contextFileUri ? { uri: viewState.contextFileUri } : undefined;
        },
        detachContextEditorRecovery: () => true, selectWorkspaceRoot() {}, syncActiveTerminal() {}, syncActiveBrowser() {},
        constrainPaneSizes() {}, persistDesktopRestoreState() {}, persistActiveCodingSessionState() { this.persisted++; },
        workContextIsOverlay: () => false, setWorkContextExpanded() {},
        closeWorkContextDrawer() { this.workContextOpen = false; },
        closeContextFilePreview() { this.contextFilePreview = undefined; }, resetWalletTopupSurface() { this.walletTopupSheetOpen = false; },
        clearOfficialProviderSurface() { this.officialProviderSheet = undefined; }, closeModelEffortPickerImmediately() {},
        dismissComposerPicker() { this.codingPopover = ''; }, loadSelectedMerchantCatalog() {}, focusModelPickerFirstOption() {},
        focusTurnEditor() {}, expandedCodingProjects: new Set(), relayOptions: () => [], platformCatalog: { offerings: [] },
        officialModels: { providers: [] }, scheduleGlobalConversationSearch() {}, turnEditSubmitting: false,
        stopVoiceInput() {}, stopMicrophoneCapture() {}, globalModels: [], communitySkills: { refreshedAt: 1 },
        loadModelCenterMerchantCount() {}, loadGlobalModels() {}, loadOwnApiUsage() {}, loadPrivacySettings() {},
        codingSessionNavigationGeneration: 0, tiledCodingSessionIds: new Set(), removedCodingSessionIds: new Set(),
        captureContextEditorRecovery() {}, cancelContextFileListScrollRestore() {}, disconnectInactiveConversationTabs() {},
        workspaceRootIsOpen: path => path === '/project', leaveCouncilRoleSubConversationToConversation() {},
        flushComposerDraft() {}, restoreComposerDraft() {}, restoreCodingSourceSelection() {},
        sessionPermissionMode: session => session.permissionMode || 'workspace_write',
        syncActiveRelay() {}, syncModelRoute() {}, loadContextFiles() {}, restoreCodingSessionState: async () => {},
        activeComicWorkspaceRoot: '', comicWorkspaceRoot: '', mediaWorkspaceRoot: '', comicHomeKind: 'novel', comicStage: 'idle',
        comicHasDirtyDraft: () => false, comicUsesDesk: () => false, comicProject() {},
        comicWorkspaceOptions: [], comicUi: { surface: 'studio', editor: false, target: '', expanded: new Set(), chats: new Map() },
        comicChatUi() { return this.comicUi; }, comicChatFolderName: path => path.split('/').at(-1),
        persistComicChatUi() {}, persistComicWorkspaceSelection() {}, setComicPrompt(value) { this.comicPrompt = value; },
        resetComicSelection() {}, loadComicExportState() {}, loadComicLibrary() {}, loadComicChatList() {}, focusComicChatComposer() {},
        async loadComicProject() { this.comicWorkspaceRoot = this.activeComicWorkspaceRoot; },
        loadMediaState() { this.mediaWorkspaceRoot = this.activeComicWorkspaceRoot; },
        platformService: { async readComicChat(root, id) { return { id, title: `${root}/${id}`, turns: [] }; } },
        codingSearchRequestToken: 0, projectDeleteBusy: false, update() { this.updates++; }
    }, overrides);
    return state;
}

function productionJsxCallback(state, methodName, selector, attributeName) {
    const member = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === methodName);
    let expression;
    const visit = node => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const attributes = node.attributes.properties;
            const className = attributes.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === 'className');
            if (node.tagName.getText(file) === selector || className?.initializer?.text === selector) {
                expression = attributes.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === attributeName)?.initializer?.expression;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(member);
    assert.ok(expression, `${methodName}: ${selector}.${attributeName}`);
    return new Function(ts.transpile(`return (${expression.getText(file)});`, { target: ts.ScriptTarget.ES2022 })).call(state);
}

test('closing a conversation menu or dialog never closes the open drawer instead', () => {
    const state = fixture({ workContextOpen: true, workContextMode: 'browser', activeCodingSessionId: 'a' });
    state.toggleCodingSessionMenu('b');
    assert.equal(state.codingSessionMenuId, 'b');
    state.toggleCodingSessionMenu('b');
    assert.equal(state.codingSessionMenuId, '', 'the second click on the same "..." closes its menu');
    assert.equal(state.workContextOpen, true, 'the browser drawer stays open');

    state.toggleCodingSessionMenu('b');
    state.rememberNavigation(); state.codingSessionMenuId = ''; state.codingSessionDeleteId = 'b';
    state.closeNavigationSurface();
    assert.equal(state.codingSessionDeleteId, '', 'Cancel closes the delete dialog');
    assert.equal(state.codingSessionMenuId, '', 'Cancel does not reopen the row menu');
    assert.equal(state.workContextOpen, true, 'Cancel does not close the drawer');
    assert.deepEqual(state.navigationBackStack, [], 'a closed dialog leaves no stale "reopen menu" history');
    state.closeNavigationSurface();
    assert.equal(state.workContextOpen, false, 'with no transient surface left, the drawer closes as before');
});

test('cancelling rename in a new unsent conversation keeps the typed draft', () => {
    const state = fixture({ activeCodingSessionId: '' });
    state.prompt = 'unsent draft';
    state.toggleCodingSessionMenu('a');
    state.beginCodingSessionRename('a');
    assert.equal(state.codingSessionRenameId, 'a');
    state.closeNavigationSurface();
    assert.equal(state.codingSessionRenameId, '');
    assert.equal(state.codingSessionMenuId, '');
    assert.equal(state.prompt, 'unsent draft');
});

test('cancelling the full-access confirmation keeps the drawer and the previous permission', () => {
    const state = fixture({ workContextOpen: true, activeCodingSessionId: 'a', permissionMode: 'read_only' });
    state.toggleCodingPopover('permission');
    state.completeNavigationSurface(); state.setPermissionMode('full_access');
    assert.equal(state.fullAccessConfirmationOpen, true);
    state.closeNavigationSurface();
    assert.equal(state.fullAccessConfirmationOpen, false);
    assert.equal(state.permissionMode, 'read_only');
    assert.equal(state.workContextOpen, true);
});

test('Escape dismisses the top popover, menu or dialog and leaves the drawer and IME composition alone', () => {
    const state = fixture({ workContextOpen: true, activeCodingSessionId: 'a' });
    const escape = (extra = {}) => {
        const event = { key: 'Escape', defaultPrevented: false, isComposing: false, prevented: 0,
            preventDefault() { this.defaultPrevented = true; this.prevented++; }, ...extra };
        state.handleSurfaceEscape(event);
        return event;
    };
    assert.equal(escape().prevented, 0, 'with only the drawer open, Escape is left to the focused editor, terminal or page');
    assert.equal(state.workContextOpen, true);
    for (const open of [
        () => state.toggleCodingSessionMenu('b'),
        () => state.toggleCodingPopover('permission'),
        () => state.toggleCodingPopover('attachments'),
        () => state.beginCodingSessionRename('b'),
        () => { state.rememberNavigation(); state.codingSessionDeleteId = 'b'; },
        () => state.setPermissionMode('full_access')
    ]) {
        open();
        assert.equal(state.hasTransientNavigationSurface(), true);
        assert.equal(escape({ isComposing: true }).prevented, 0, 'an IME candidate window owns Escape');
        assert.equal(escape({ defaultPrevented: true }).prevented, 0, 'an inner handler that consumed Escape wins');
        assert.equal(state.hasTransientNavigationSurface(), true);
        assert.equal(escape().prevented, 1);
        assert.equal(state.hasTransientNavigationSurface(), false);
        assert.equal(state.workContextOpen, true);
    }
});

for (const openSettings of ['openSettingsPanel', 'toggleSettingsPanel']) {
    test(`${openSettings}: one Back leaves settings even while the hidden coding drawer has a file preview`, () => {
        const preview = { uri: 'file:///project/README.md' };
        const state = fixture({ workContextOpen: true, contextFilePreview: preview });
        state[openSettings]('profile');
        assert.equal(state.activeSection, 'settings');
        assert.equal(state.navigationBackStack.length, 1);
        assert.equal(state.canNavigateBack(), true);

        state.navigateBack();
        assert.equal(state.activeSection, 'coding', 'the first Back restores the page immediately');
        assert.equal(state.workContextOpen, true, 'page history has priority over the drawer');
        assert.deepEqual(state.contextFilePreview, preview, 'page navigation does not silently close the hidden preview');
        assert.equal(state.navigationBackStack.length, 0);
        assert.equal(state.canNavigateForward(), true);

        state.navigateForward();
        assert.equal(state.activeSection, 'settings');
        assert.equal(state.settingsPanel, 'profile');
        assert.equal(state.workContextOpen, true);
        assert.deepEqual(state.contextFilePreview, preview);
        assert.equal(state.canNavigateForward(), false);
    });
}

test('settings subpanels form a reversible history and selecting the current panel adds no frame', () => {
    const state = fixture({ workContextOpen: true });
    for (const panel of ['profile', 'skills', 'plugins']) state.openSettingsPanel(panel);
    assert.deepEqual(state.navigationBackStack.map(snapshot => [snapshot.section, snapshot.settingsPanel]), [
        ['coding', 'profile'], ['settings', 'profile'], ['settings', 'skills']
    ]);
    state.openSettingsPanel('plugins');
    assert.equal(state.navigationBackStack.length, 3, 'reselecting a panel is not a navigation');
    for (const panel of ['skills', 'profile']) {
        state.navigateBack();
        assert.equal(state.activeSection, 'settings');
        assert.equal(state.settingsPanel, panel);
    }
    state.navigateBack();
    assert.equal(state.activeSection, 'coding');
    assert.equal(state.workContextOpen, true);
    for (const panel of ['profile', 'skills', 'plugins']) {
        state.navigateForward();
        assert.equal(state.activeSection, 'settings');
        assert.equal(state.settingsPanel, panel);
    }
    assert.equal(state.canNavigateForward(), false);
});

test('model center view and capability filter changes can all be traversed back to coding and forward', () => {
    const state = fixture({ workContextOpen: true });
    state.selectModelCenterView('all');
    state.selectModelCenterView('official');
    state.selectModelCapabilityFilter('coding');
    state.selectModelCapabilityFilter('image');
    assert.equal(state.navigationBackStack.length, 4);
    state.selectModelCenterView('capability');
    state.selectModelCapabilityFilter('image');
    assert.equal(state.navigationBackStack.length, 4, 'unchanged views and filters do not duplicate history');

    const assertLocation = (section, view, filter) => {
        assert.equal(state.activeSection, section);
        assert.equal(state.modelCenterView, view);
        assert.equal(state.modelCapabilityFilter, filter);
        assert.equal(state.workContextOpen, true);
    };
    for (const location of [
        ['models', 'capability', 'coding'], ['models', 'official', 'all'], ['models', 'all', 'all'], ['coding', 'all', 'all']
    ]) {
        state.navigateBack();
        assertLocation(...location);
    }
    for (const location of [
        ['models', 'all', 'all'], ['models', 'official', 'all'], ['models', 'capability', 'coding'], ['models', 'capability', 'image']
    ]) {
        state.navigateForward();
        assertLocation(...location);
    }
    assert.equal(state.canNavigateForward(), false);
});

test('billing tabs remain local state and do not add history frames', () => {
    const state = fixture({ activeSection: 'settings', settingsPanel: 'billing' });
    state.selectBillingTab('topups');
    assert.equal(state.billingTab, 'topups');
    assert.deepEqual(state.navigationBackStack, []);
});

test('opening a different conversation preserves the drawer and Back restores the previous conversation first', async () => {
    const preview = { uri: 'file:///project/README.md' };
    const state = fixture({ activeCodingSessionId: 'a', globalCodingDraft: false, workContextOpen: true, contextFilePreview: preview });
    await state.openCodingSession('b');
    assert.equal(state.activeCodingSessionId, 'b');
    assert.equal(state.navigationBackStack.length, 1);
    state.navigateBack();
    assert.equal(state.activeCodingSessionId, 'a');
    assert.equal(state.workContextOpen, true);
    assert.deepEqual(state.contextFilePreview, preview);
    state.navigateForward();
    assert.equal(state.activeCodingSessionId, 'b');
    assert.equal(state.workContextOpen, true);
});

test('coding panel history is restored before dismissing a drawer left open by the thread', () => {
    const state = fixture({ workContextOpen: true });
    state.selectCodingPanel('scheduled');
    assert.equal(state.codingPanel, 'scheduled');
    state.navigateBack();
    assert.equal(state.codingPanel, 'thread');
    assert.equal(state.workContextOpen, true);
    state.navigateForward();
    assert.equal(state.codingPanel, 'scheduled');
    assert.equal(state.workContextOpen, true);
});

test('Back skips duplicate current snapshots in a single action', () => {
    const state = fixture();
    state.openSettingsPanel('profile');
    const current = state.navigationSnapshot();
    state.navigationBackStack.push(current, { ...current }, current);
    state.navigateBack();
    assert.equal(state.activeSection, 'coding');
    assert.equal(state.navigationBackStack.length, 0);
    assert.equal(state.navigationForwardStack.length, 1, 'skipped frames do not pollute Forward');
    state.navigateForward();
    assert.equal(state.activeSection, 'settings');
});

test('Forward skips duplicate current snapshots in a single action', () => {
    const state = fixture();
    state.openSettingsPanel('profile');
    state.navigateBack();
    const current = state.navigationSnapshot();
    state.navigationForwardStack.push(current, { ...current });
    state.navigateForward();
    assert.equal(state.activeSection, 'settings');
    assert.equal(state.navigationForwardStack.length, 0);
    assert.equal(state.navigationBackStack.length, 1, 'only the real departing location is recorded');
});

test('duplicate-only stacks are drained without creating history in the opposite direction', () => {
    for (const direction of ['back', 'forward']) {
        const state = fixture();
        const stack = direction === 'back' ? 'navigationBackStack' : 'navigationForwardStack';
        state[stack] = [state.navigationSnapshot(), state.navigationSnapshot()];
        state[direction === 'back' ? 'navigateBack' : 'navigateForward']();
        assert.deepEqual(state.navigationBackStack, []);
        assert.deepEqual(state.navigationForwardStack, []);
        assert.equal(state.canNavigateBack(), false);
        assert.equal(state.canNavigateForward(), false);
    }
});

test('a surface change at the same location is a real Back and Forward destination', () => {
    const state = fixture({ workContextOpen: true });
    state.toggleCodingSessionMenu('a');
    state.navigateBack();
    assert.equal(state.codingSessionMenuId, '');
    assert.equal(state.workContextOpen, true);
    assert.equal(state.navigationForwardStack.length, 1);
    state.navigateForward();
    assert.equal(state.codingSessionMenuId, 'a');
    assert.equal(state.workContextOpen, true);
});

test('toggling the settings gear consumes the return frame and leaves a useful Forward destination', () => {
    const state = fixture();
    state.toggleSettingsPanel('profile');
    state.toggleSettingsPanel('profile');
    assert.equal(state.activeSection, 'coding');
    assert.equal(state.navigationBackStack.length, 0, 'the restored coding snapshot must not remain on Back');
    assert.equal(state.canNavigateBack(), false);
    assert.equal(state.canNavigateForward(), true);
    state.navigateForward();
    assert.equal(state.activeSection, 'settings');
    state.navigateBack();
    assert.equal(state.activeSection, 'coding');
    assert.equal(state.navigationBackStack.length, 0);
});

test('without history Back dismisses only the visible thread drawer, not a drawer hidden by another page or panel', () => {
    for (const [activeSection, codingPanel] of [['models', 'thread'], ['comic', 'thread'], ['coding', 'scheduled']]) {
        const preview = { uri: 'file:///project/README.md' };
        const state = fixture({ activeSection, codingPanel, workContextOpen: true, contextFilePreview: preview });
        assert.equal(state.canNavigateBack(), false, `${activeSection}/${codingPanel} has no visible return destination`);
        state.navigateBack();
        assert.equal(state.workContextOpen, true);
        assert.equal(state.contextFilePreview, preview);
        assert.equal(state.canNavigateForward(), false);
    }

    const state = fixture({ workContextOpen: true, contextFilePreview: { uri: 'file:///project/README.md' } });
    assert.equal(state.canNavigateBack(), true);
    state.navigateBack();
    assert.equal(state.contextFilePreview, undefined);
    assert.equal(state.workContextOpen, true);
    assert.equal(state.canNavigateForward(), true, 'Forward can restore the file preview from viewState');
    state.navigateBack();
    assert.equal(state.workContextOpen, false);
    assert.equal(state.canNavigateBack(), false);
    assert.equal(state.canNavigateForward(), true);
    state.navigateForward();
    assert.equal(state.workContextOpen, true);
    assert.equal(state.contextFilePreview, undefined);
    state.navigateForward();
    assert.deepEqual(state.contextFilePreview, { uri: 'file:///project/README.md' });
    assert.equal(state.canNavigateForward(), false);
});

test('without history Back closes a transient menu before the visible drawer', () => {
    const state = fixture({ workContextOpen: true, codingSessionMenuId: 'a' });
    assert.equal(state.canNavigateBack(), true);
    state.navigateBack();
    assert.equal(state.codingSessionMenuId, '');
    assert.equal(state.workContextOpen, true);
});

test('public navigation commands use the same history path and activate the widget when needed', async () => {
    const state = fixture();
    state.openSettingsPanel('profile');
    let releaseActivation;
    const activations = [];
    state.applicationShell = { currentWidget: { id: 'another-widget' }, activateWidget(id) {
        activations.push(id);
        return new Promise(resolve => { releaseActivation = () => { this.currentWidget = { id }; resolve(); }; });
    } };
    assert.equal(state.commandNavigateBack(), undefined);
    assert.deepEqual(activations, ['test-widget']);
    assert.equal(state.activeSection, 'settings', 'activation completes before navigating');
    releaseActivation();
    await Promise.resolve();
    assert.equal(state.activeSection, 'coding');
    assert.equal(state.commandNavigateForward(), undefined);
    assert.equal(state.activeSection, 'settings');
    assert.deepEqual(activations, ['test-widget']);
});

test('pending turn edits do not intercept a real page destination on Back', () => {
    const state = fixture();
    state.openSettingsPanel('profile');
    state.pendingTurnEdit = { turnId: 'turn-a' };
    state.dismissTurnEditConfirmation = () => assert.fail('valid page history must be traversed before local fallback');
    state.navigateBack();
    assert.equal(state.activeSection, 'coding');
    assert.equal(state.pendingTurnEdit, undefined);
});

test('reselecting the current settings panel clears a transient surface without adding duplicate history', () => {
    const state = fixture();
    state.openSettingsPanel('profile');
    state.accountMenuOpen = true;
    state.openSettingsPanel('profile');
    assert.equal(state.accountMenuOpen, false);
    assert.equal(state.navigationBackStack.length, 1);
    state.navigateBack();
    assert.equal(state.activeSection, 'coding');
});

test('Comic Home, Studio and conversations retain distinct roots and destinations through Back and Forward', async () => {
    const state = fixture();
    const location = () => state.activeSection === 'comic' ? {
        section: 'comic', root: state.activeComicWorkspaceRoot, kind: state.comicHomeKind,
        surface: state.comicUi.surface, chatId: state.comicUi.chatId, target: state.comicUi.target, editor: state.comicUi.editor
    } : { section: state.activeSection };
    const expected = [location()];
    const visit = async operation => {
        const previousLength = state.navigationBackStack.length;
        await operation();
        assert.equal(state.navigationBackStack.length, previousLength + 1, 'each destination change records one frame');
        expected.push(location());
        await operation();
        assert.equal(state.navigationBackStack.length, previousLength + 1, 'reselecting the same destination does not record a frame');
    };
    await visit(() => state.openComicHomeKind('novel'));
    await visit(() => state.openComicStudio('/comic-a', 'A'));
    await visit(() => state.openComicChat('/comic-a', 'chat-a'));
    await visit(() => state.openComicChat('/comic-a', 'chat-b'));
    await visit(() => state.newComicChat('/comic-a'));
    await visit(() => state.newComicChat('/comic-b'));
    await visit(() => state.openComicStudio('/comic-b', 'B'));
    await visit(() => state.openComicHomeKind('image'));
    await visit(() => state.openComicHomeKind('music'));

    for (let index = expected.length - 2; index >= 0; index--) {
        state.navigateBack();
        assert.deepEqual(location(), expected[index], `Back restores destination ${index}`);
    }
    assert.equal(state.canNavigateBack(), false);
    for (let index = 1; index < expected.length; index++) {
        state.navigateForward();
        assert.deepEqual(location(), expected[index], `Forward restores destination ${index}`);
    }
    assert.equal(state.canNavigateForward(), false);
});

test('comic editor state is a distinct destination when returning to the same Home kind', () => {
    const state = fixture({ activeSection: 'comic' });
    state.comicUi.editor = true;
    state.openComicHomeKind('novel');
    assert.equal(state.comicUi.editor, false);
    assert.equal(state.navigationBackStack.length, 1);
    state.navigateBack();
    assert.equal(state.comicUi.editor, true);
    state.navigateForward();
    assert.equal(state.comicUi.editor, false);
});

test('blocked comic project changes leave the current destination and history intact', async () => {
    const state = fixture({ activeSection: 'comic', activeComicWorkspaceRoot: '/comic-a', comicStage: 'running' });
    const current = state.navigationSnapshot();
    state.newComicChat('/comic-b');
    await state.openComicChat('/comic-b', 'chat-b');
    state.openComicStudio('/comic-b', 'B');
    state.openComicHomeKind('image');
    assert.deepEqual(state.navigationSnapshot(), current);
    assert.deepEqual(state.navigationBackStack, []);
});

for (const direction of ['back', 'forward']) {
    test(`${direction}: a rejected editor recovery leaves both history stacks intact for retry`, () => {
        const state = fixture();
        state.openSettingsPanel('profile');
        if (direction === 'forward') state.navigateBack();
        const before = state.navigationSnapshot();
        const back = [...state.navigationBackStack], forward = [...state.navigationForwardStack];
        state.detachContextEditorRecovery = () => false;
        state[direction === 'back' ? 'navigateBack' : 'navigateForward']();
        assert.deepEqual(state.navigationSnapshot(), before);
        assert.deepEqual(state.navigationBackStack, back, 'a blocked transition must not consume Back history');
        assert.deepEqual(state.navigationForwardStack, forward, 'a blocked transition must not consume Forward history');
        state.detachContextEditorRecovery = () => true;
        state[direction === 'back' ? 'navigateBack' : 'navigateForward']();
        assert.equal(state.activeSection, direction === 'back' ? 'coding' : 'settings');
    });
}

test('the settings gear preserves its fallback destination when editor recovery temporarily refuses navigation', () => {
    const state = fixture();
    state.toggleSettingsPanel('profile');
    state.navigationBackStack = [];
    const previous = state.settingsReturnSnapshot;
    state.detachContextEditorRecovery = () => false;
    state.toggleSettingsPanel('profile');
    assert.equal(state.activeSection, 'settings');
    assert.deepEqual(state.settingsReturnSnapshot, previous);
    assert.deepEqual(state.navigationForwardStack, []);
    state.detachContextEditorRecovery = () => true;
    state.toggleSettingsPanel('profile');
    assert.equal(state.activeSection, 'coding');
});

test('the settings gear uses its return destination after skipping a stack consisting only of current-page duplicates', () => {
    const state = fixture();
    state.toggleSettingsPanel('profile');
    state.navigationBackStack = [state.navigationSnapshot(), state.navigationSnapshot()];
    state.toggleSettingsPanel('profile');
    assert.equal(state.activeSection, 'coding');
    assert.equal(state.navigationBackStack.length, 0);
    assert.equal(state.navigationForwardStack.length, 1);
    state.navigateForward();
    assert.equal(state.activeSection, 'settings');
});

function loadedComicFixture(usesDesk = false) {
    const projectState = root => ({ exists: true, project: { id: root, scenes: [
        { id: `${root}-first-scene`, shots: [{ id: `${root}-first-shot` }] },
        { id: `${root}-second-scene`, shots: [{ id: `${root}-second-shot` }] }
    ] }, production: { episodes: [
        { id: `${root}-first`, sceneIds: [`${root}-first-scene`] },
        { id: `${root}-second`, sceneIds: [`${root}-second-scene`] }
    ] } });
    const loads = [];
    const state = fixture({ activeSection: 'comic', activeComicWorkspaceRoot: '/comic-a', comicWorkspaceRoot: '/comic-a',
        activeComicEpisodeId: '/comic-a-second', activeComicSceneId: '/comic-a-second-scene', activeComicShotId: '/comic-a-second-shot',
        comicView: 'storyboard', comicState: projectState('/comic-a'), comicLoadSequence: 0,
        comicTimelineSequence: 0, comicCutOperation: 0, comicLibraryLoaded: true,
        resetComicSelection: Harness.prototype.resetComicSelection,
        loadComicProject(...args) { const load = Harness.prototype.loadComicProject.apply(this, args); loads.push(load); return load; },
        comicProject() { return this.comicState.project; }, comicTimelineDocument() {},
        comicHasDirtyDraft: () => false, comicLandingView: () => 'script', comicUsesDesk: () => usesDesk,
        releaseComicVisualPreview() {}, refreshComicPlayback() {}, reconcileMusicSong() {},
        hydrateComicEditor() {}, checkComicEditorReady() {}, scheduleComicLibraryRefresh() {},
        startComicDeskTimer() {}, refreshComicCharacterLibrary() {}, deskVideoFacts() {},
        fileService: { watch: () => ({ dispose() {} }) }, platformService: { getComicProject: async root => projectState(root) }
    });
    return { state, loads, projectState };
}

test('comic history restores the selected episode and shot after the destination project actually finishes loading', async () => {
    const { state, loads } = loadedComicFixture();
    state.comicUi.editor = true;
    state.openComicStudio('/comic-b', 'B');
    await loads.at(-1);
    assert.equal(state.comicWorkspaceRoot, '/comic-b');
    state.navigateBack();
    await loads.at(-1);
    assert.equal(state.comicWorkspaceRoot, '/comic-a');
    assert.equal(state.comicView, 'storyboard', 'the project default landing view cannot replace history');
    assert.equal(state.activeComicEpisodeId, '/comic-a-second');
    assert.equal(state.activeComicSceneId, '/comic-a-second-scene');
    assert.equal(state.activeComicShotId, '/comic-a-second-shot');
    assert.equal(state.comicUi.editor, true);
});

test('comic history restores the project production desk and selected episode after an asynchronous project load', async () => {
    const { state, loads } = loadedComicFixture(true);
    state.openComicDesk('edit');
    state.comicDesk.focusEpisode = 1;
    state.comicDesk.focusClip = 2;
    state.openComicStudio('/comic-b', 'B');
    await loads.at(-1);
    assert.equal(state.comicDesk.projectId, '/comic-b');
    state.navigateBack();
    await loads.at(-1);
    assert.equal(state.comicWorkspaceRoot, '/comic-a');
    assert.equal(state.comicDesk.projectId, '/comic-a');
    assert.equal(state.comicDesk.visible, true);
    assert.equal(state.comicDesk.step, 'edit');
    assert.equal(state.comicDesk.focusEpisode, 1);
    assert.equal(state.comicDesk.focusClip, 2);
});

for (const blockedBy of ['saving', 'dirty draft']) {
    test(`comic history blocked by ${blockedBy} remains available after the operation completes`, async () => {
        const { state, loads } = loadedComicFixture();
        state.openComicStudio('/comic-b', 'B');
        await loads.at(-1);
        const current = state.navigationSnapshot();
        const back = [...state.navigationBackStack];
        state.comicStage = blockedBy === 'saving' ? 'saving' : 'idle';
        state.comicHasDirtyDraft = () => blockedBy === 'dirty draft';
        state.navigateBack();
        assert.deepEqual(state.navigationSnapshot(), current);
        assert.deepEqual(state.navigationBackStack, back);
        assert.deepEqual(state.navigationForwardStack, []);
        state.comicStage = 'idle';
        state.comicHasDirtyDraft = () => false;
        state.navigateBack();
        await loads.at(-1);
        assert.equal(state.comicWorkspaceRoot, '/comic-a');
    });
}

test('a delayed project load cannot reopen its historical production desk after navigation to a new chat', async () => {
    const { state, loads, projectState } = loadedComicFixture(true);
    state.openComicDesk('edit');
    state.openComicStudio('/comic-b', 'B');
    await loads.at(-1);
    let resolveProject;
    state.platformService.getComicProject = () => new Promise(resolve => { resolveProject = resolve; });
    state.navigateBack();
    const pendingLoad = loads.at(-1);
    assert.equal(state.activeComicWorkspaceRoot, '/comic-a');
    state.newComicChat('/comic-a');
    assert.equal(state.comicUi.surface, 'chat');
    resolveProject(projectState('/comic-a'));
    await pendingLoad;
    assert.equal(state.comicWorkspaceRoot, '/comic-a');
    assert.equal(state.comicUi.surface, 'chat');
    assert.notEqual(state.comicDesk?.workspaceRoot, '/comic-a', 'the stale restore must not reopen A’s desk over the newer chat');
});

test('the rendered Comic Home project card opens Studio through one reversible history transition', () => {
    const state = fixture({ activeSection: 'comic' });
    productionJsxCallback(state, 'renderComicWelcome', 'ComicHomeCategories', 'onOpen')({ path: '/comic-a', title: 'A' });
    assert.equal(state.activeComicWorkspaceRoot, '/comic-a');
    assert.equal(state.navigationBackStack.length, 1);
    state.navigateBack();
    assert.equal(state.activeComicWorkspaceRoot, '');
    state.navigateForward();
    assert.equal(state.activeComicWorkspaceRoot, '/comic-a');
});

for (const [method, selector] of [['renderComicWelcome', 'nmx-comic-ghost-cta'], ['renderComicWorkbench', 'nmx-studio-close']]) {
    test(`${selector}: the rendered return-to-library action preserves the home category and records history`, () => {
        const state = fixture({ activeSection: 'comic', activeComicWorkspaceRoot: '/comic-a', comicWorkspaceRoot: '/comic-a', comicHomeKind: 'music' });
        productionJsxCallback(state, method, selector, 'onClick')();
        assert.equal(state.activeComicWorkspaceRoot, '');
        assert.equal(state.comicHomeKind, 'music');
        assert.equal(state.navigationBackStack.length, 1);
        state.navigateBack();
        assert.equal(state.activeComicWorkspaceRoot, '/comic-a');
        state.navigateForward();
        assert.equal(state.activeComicWorkspaceRoot, '');
    });
}

test('adding an existing comic project records the original root once and respects a busy project', async () => {
    for (const comicStage of ['idle', 'saving']) {
        const state = fixture({ activeSection: 'comic', activeComicWorkspaceRoot: '/comic-a', comicWorkspaceRoot: '/comic-a', comicStage,
            addNotification() {}, comicChatT: key => key,
            platformService: { async openComicChatFolder() { return { status: 'comic', path: '/comic-b', title: 'B', name: 'B', projectKind: 'novel' }; } }
        });
        await state.addComicChatFolder('/comic-b', true);
        if (comicStage === 'saving') {
            assert.equal(state.activeComicWorkspaceRoot, '/comic-a');
            assert.deepEqual(state.navigationBackStack, []);
        } else {
            assert.equal(state.activeComicWorkspaceRoot, '/comic-b');
            assert.equal(state.navigationBackStack.length, 1);
            state.navigateBack();
            assert.equal(state.activeComicWorkspaceRoot, '/comic-a');
        }
    }
});

test('reopening the same project card restores its hidden desk and Back/Forward preserve that visibility', () => {
    const { state } = loadedComicFixture(true);
    state.openComicDesk('edit');
    state.comicDesk.visible = false;
    const open = productionJsxCallback(state, 'renderComicWelcome', 'ComicHomeCategories', 'onOpen');
    open({ path: '/comic-a', title: 'A' });
    assert.equal(state.comicDesk.visible, true);
    assert.equal(state.navigationBackStack.length, 1);
    open({ path: '/comic-a', title: 'A' });
    assert.equal(state.navigationBackStack.length, 1, 'an already visible desk creates no extra frame');
    state.navigateBack();
    assert.equal(state.comicDesk.visible, false);
    state.navigateForward();
    assert.equal(state.comicDesk.visible, true);
    assert.equal(state.comicDesk.step, 'edit');
});

test('minimizing and reopening the production desk or switching its episodes participates in Back/Forward history', () => {
    const { state } = loadedComicFixture(true);
    state.openComicDesk('canvas');
    assert.equal(state.comicDesk.visible, true);
    assert.equal(state.comicDesk.focusEpisode, 0);
    state.minimizeComicDesk();
    assert.equal(state.comicDesk.visible, false);
    assert.equal(state.canNavigateBack(), true);
    state.navigateBack();
    assert.equal(state.comicDesk.visible, true);
    assert.equal(state.comicDesk.step, 'canvas');
    state.openComicDeskEpisode(1, 'edit');
    assert.equal(state.comicDesk.step, 'edit');
    assert.equal(state.comicDesk.focusEpisode, 1);
    state.navigateBack();
    assert.equal(state.comicDesk.step, 'canvas');
    assert.equal(state.comicDesk.focusEpisode, 0);
});

test('Comic Chat supports the right-hand file drawer and resolves the active chat folder root', () => {
    const state = fixture({ activeSection: 'comic', activeComicWorkspaceRoot: '/comic-a', comicWorkspaceRoot: '/comic-a' });
    assert.equal(state.isWorkContextSectionActive(), false, 'studio surface does not enable the coding/chat work context drawer');
    state.newComicChat('/comic-b');
    assert.equal(state.comicUi.surface, 'chat');
    assert.equal(state.isWorkContextSectionActive(), true, 'chat surface enables the file drawer');
    assert.equal(state.comicContextWorkspaceRoot(), '/comic-b');
    state.comicUi.editor = true;
    assert.equal(state.isWorkContextSectionActive(), false, 'opening the FreeCut editor hides the chat work context drawer');
});


for (const open of ['openSettingsPanel', 'toggleSettingsPanel']) test(`${open} preserves the selected conversation, draft and collapsed sidebar in both directions`, () => {
    const state = fixture({ activeCodingSessionId: 'a', globalCodingDraft: false, prompt: 'unsent A', contextPanelCollapsed: true,
        workContextOpen: true, contextFilePreview: { uri: 'file:///project/a.ts' } });
    state[open]('profile'); state.openSettingsPanel('privacy'); state.navigateBack(); state.navigateBack();
    assert.equal(state.activeSection, 'coding'); assert.equal(state.activeCodingSessionId, 'a');
    assert.equal(state.prompt, 'unsent A'); assert.equal(state.contextPanelCollapsed, true); assert.equal(state.workContextOpen, true);
    state.navigateForward(); state.navigateForward(); assert.equal(state.settingsPanel, 'privacy');
    assert.equal(state.contextPanelCollapsed, true);
});

test('a restored settings page with empty history returns to its conversation and Forward restores the panel', () => {
    const state = fixture({ activeSection: 'settings', settingsPanel: 'profile', activeCodingSessionId: 'a', globalCodingDraft: false,
        prompt: 'kept draft', contextPanelCollapsed: true, workContextOpen: true });
    assert.equal(state.canNavigateBack(), true); state.navigateBack();
    assert.equal(state.activeSection, 'coding'); assert.equal(state.activeCodingSessionId, 'a'); assert.equal(state.prompt, 'kept draft');
    assert.equal(state.contextPanelCollapsed, true); assert.equal(state.workContextOpen, true);
    state.navigateForward(); assert.equal(state.activeSection, 'settings'); assert.equal(state.settingsPanel, 'profile');
});

test('command and account-menu settings entries return to the same collapsed conversation', () => {
 for (const entry of ['command', 'account']) {
  const state=fixture({activeCodingSessionId:'a',globalCodingDraft:false,prompt:'draft A',contextPanelCollapsed:true,workContextOpen:true});
  if(entry==='account'){state.rememberNavigation();state.accountMenuOpen=true;state.openSettingsPanel('profile');}else state.commandOpenSettings();
  state.navigateBack();assert.equal(state.activeSection,'coding');assert.equal(state.activeCodingSessionId,'a');assert.equal(state.prompt,'draft A');assert.equal(state.contextPanelCollapsed,true);
  state.navigateForward();assert.equal(state.settingsPanel,'profile');assert.equal(state.activeSection,'settings');
 }
});

test('Back and Escape dismiss goal editor and close confirmation before page navigation', () => {
 const state=fixture({activeCodingSessionId:'a'});state.openSettingsPanel('profile');
 state.goalDrawer={sessionId:'a'};state.closeGoalDrawer=()=>{state.goalDrawer=undefined;};
 state.navigateBack();assert.equal(state.goalDrawer,undefined);assert.equal(state.activeSection,'settings');
 state.goalCloseConfirmation={sessionId:'a'};state.closeGoalConfirmation=()=>{state.goalCloseConfirmation=undefined;};
 const event={key:'Escape',preventDefault(){this.defaultPrevented=true;}};state.handleSurfaceEscape(event);
 assert.equal(state.goalCloseConfirmation,undefined);assert.equal(event.defaultPrevented,true);assert.equal(state.activeSection,'settings');
});

test('settings history restores the goal drawer for the same conversation and original goal', () => {
 const state=fixture({activeCodingSessionId:'a',goalDrawer:{sessionId:'a',goalId:'g'}});state.codingSessions[0].goal={id:'g'};
 state.closeGoalDrawer=()=>{state.goalDrawer=undefined;};state.openGoalDialog=()=>{state.goalDrawer={sessionId:'a',goalId:'g'};};
 state.openSettingsPanel('profile');assert.equal(state.goalDrawer,undefined);state.navigateBack();
 assert.equal(state.activeSection,'coding');assert.equal(state.goalDrawer.goalId,'g');state.navigateForward();
 assert.equal(state.activeSection,'settings');assert.equal(state.goalDrawer,undefined);
});
