import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const read = relativePath => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
const widget = read('../src/browser/nextmux-desktop-widget.tsx');
const workspaceSave = read('../src/browser/nextmux-workspace-configuration-save.ts');
const frontendModule = read('../src/browser/nextmux-frontend-module.ts');
const contribution = read('../src/browser/nextmux-desktop-contribution.ts');
const desktopPackage = JSON.parse(read('../../../apps/desktop/package.json'));

test('stock Theia exit and workspace-trust prompts are suppressed by product policy', () => {
    assert.equal(
        desktopPackage.theia.frontend.config.preferences['application.confirmExit'],
        'never'
    );
    assert.match(frontendModule, /schema\.registerOverride\(WORKSPACE_TRUST_ENABLED, undefined, false\)/);
    assert.doesNotMatch(widget, /UntitledWorkspaceExitDialog/);
    // Cmd+Q has an explicit product requirement for a confirmation when a
    // local conversation is running. Keep that one prompt; stock Theia and
    // unrelated renderer prompts remain covered by the surrounding checks.
    assert.equal((widget.match(/window\.(?:alert|confirm|prompt)\s*\(/g) || []).length, 1);
    assert.match(widget, /confirmApplicationExit\(\): boolean\s*\{\s*return window\.confirm\(closePersistenceText/);
    assert.match(workspaceSave, /workspaceService\.isUntitledWorkspace\(workspace\.resource\)/);
    assert.match(workspaceSave, /roots\.length === 0/);
    assert.match(workspaceSave, /resolve\('NextMux\.auto\.theia-workspace'\)/);
    assert.match(workspaceSave, /workspaceService\.save\(stableWorkspace\)/);
    assert.match(widget, /await (?:wait\()?(?:this\.)?workspaceConfigurationSaver\.flush\(\)/);
});

test('stock workbench shortcuts cannot expose irrelevant Theia surfaces', () => {
    assert.match(contribution, /event\.key === 'F1'/);
    assert.match(contribution, /plainPrimary && key === 'p'/);
    assert.match(contribution, /stockWorkspaceShortcut[\s\S]*?key === 'w'[\s\S]*?key === 'r'/);
    assert.match(contribution, /stockViewShortcut[\s\S]*?\['e', 'g', 'd', 'x', 'm', 'y', 'h'\]/);
    assert.match(contribution, /event\.preventDefault\(\);\s*event\.stopImmediatePropagation\(\);/);
    assert.match(contribution, /addEventListener\('keydown', this\.handleProductWorkbenchShortcut, true\)/);
    assert.match(contribution, /removeEventListener\('keydown', this\.handleProductWorkbenchShortcut, true\)/);
});

test('common shortcuts route to existing product surfaces instead of stock Theia UI', () => {
    assert.match(contribution, /plainPrimary && key === ',' \? 'settings'/);
    assert.match(contribution, /shiftedPrimary && key === 'f' \? 'search'/);
    assert.match(contribution, /plainPrimary && key === 'o' \? 'openFolder'/);
    assert.match(contribution, /productAction === 'settings'[\s\S]*?commandOpenSettings\(\)/);
    assert.match(contribution, /productAction === 'search'[\s\S]*?commandFindAllConversations\(\)/);
    assert.match(contribution, /else widget\.commandOpenFolder\(\)/);
});

test('stock welcome surface is not shipped and startup always restores NextMux', () => {
    const dependencies = { ...desktopPackage.dependencies, ...desktopPackage.devDependencies };
    assert.equal(dependencies['@theia/getting-started'], undefined);
    assert.match(contribution, /initializeLayout\(\): Promise<void>[\s\S]*?openView\(\{ activate: false, reveal: true \}\)/);
    assert.match(contribution, /restoreWorkbenchAfterStartup[\s\S]*?openView\(\{ activate: false, reveal: true \}\)/);
});

test('native file pickers remain only for explicit file operations', () => {
    assert.ok((widget.match(/fileDialogService\.showOpenDialog\(/g) || []).length >= 2);
    const source = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const savePickerOwners = [];
    const visit = (node, owner) => {
        if (ts.isMethodDeclaration(node)) owner = node.name.getText(source);
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'this.fileDialogService.showSaveDialog') savePickerOwners.push(owner);
        ts.forEachChild(node, child => visit(child, owner));
    };
    visit(source);
    // saveComicChatMedia: 漫剧对话 → 右键 “保存到…” on a picture, clip or sound.
    // downloadComicCanvasItems: explicit canvas export after the naming dialog; single media or ZIP.
    // exportCodingSessionConversation: the message menu's “导出 Markdown / HTML”.
    // saveArtifactImage: the artifact preview's save button (PNG or SVG).
    assert.deepEqual(savePickerOwners.sort(), ['chooseConversationArchiveFile', 'downloadComicCanvasItems', 'exportCodingSessionConversation', 'exportDesktopDiagnostics',
        'musicExportAudio', 'saveArtifactImage', 'saveComicChatMedia', 'saveContextEditorRecoveryAsNewFile']);
    assert.match(widget, /chooseConversationArchiveFile\(kind: 'open' \| 'save'\)/);
    const archivePicker = widget.slice(widget.indexOf('protected async chooseConversationArchiveDirectory'), widget.indexOf('protected async finishConversationArchiveImport'));
    assert.match(archivePicker, /canSelectFiles: false, canSelectFolders: true, canSelectMany: false/);
    assert.doesNotMatch(archivePicker, /addRoot\(|draftWorkspaceRoot\s*=/);
    assert.match(widget, /filters = \{ 'NextMux archive': \['nmxarchive'\] \}/);
    assert.match(widget, /selectAttachments\('file'\)/);
    // The comic header's “…” menu (kinds, models, project file, reload) was removed: each has a direct entry.
    assert.doesNotMatch(widget, /nmx-studio-project-menu|openComicProjectFile/);
});

test('necessary confirmations remain inside the NextMux workbench', () => {
    assert.match(widget, /renderFullAccessConfirmation\(\)[\s\S]*?nmx-permission-sheet[\s\S]*?role='dialog'/);
    assert.match(widget, /renderOfferingSheet\(offering:[\s\S]*?nmx-purchase-sheet[\s\S]*?role='dialog'/);
    assert.match(widget, /aria-label='删除对话'/);
    assert.match(widget, /nmx-link-opening-dialog'[\s\S]*?role='dialog'/);
    // Saving/restoring a file is now the explicit action; its previous
    // overwrite confirmation was removed from the product requirement.
    assert.doesNotMatch(widget, /nmx-file-save-confirm/);
    assert.match(widget, /protected requestContextFileSave\([\s\S]*?this\.pendingFileSave = [\s\S]*?void this\.writeContextFile\(false\)/);
});

test('relay drawer closes by outside click and has no redundant close control', () => {
    const relayPopover = widget.slice(
        widget.indexOf('protected renderRelayPopover('),
        widget.indexOf('protected renderContextAccountDock()')
    );
    assert.doesNotMatch(relayPopover, /aria-label=['\"]关闭['\"]/);
    assert.match(widget, /!target\.closest\([^)]*\.nmx-composer-relay-button/);
    assert.doesNotMatch(widget, /nmx-workspace-topbar-navigation|nmx-topbar-relay-anchor/);
    assert.match(widget, /data-relay-trigger='composer'/);
    assert.doesNotMatch(widget, /data-relay-trigger='titlebar'/);
});
