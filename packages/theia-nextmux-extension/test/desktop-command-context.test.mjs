import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScriptModule(relativePath) {
    const fileUrl = new URL(relativePath, import.meta.url);
    const source = await import('node:fs/promises').then(fs => fs.readFile(fileUrl, 'utf8'));
    const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const { desktopContextCommandEnabled } = await loadTypeScriptModule('../src/browser/nextmux-desktop-command-context.ts');

const base = {
    section: 'coding', codingPanel: 'thread', hasConversation: true, hasWorkspace: true,
    filePreviewOpen: false, fileDirty: false, fileSaving: false
};

test('conversation commands are disabled outside the coding thread', () => {
    for (const command of ['saveFile', 'findConversation', 'terminal', 'browser']) {
        assert.equal(desktopContextCommandEnabled(command, { ...base, section: 'settings' }), false);
    }
});

test('save is enabled only for a dirty, writable preview that is not saving', () => {
    assert.equal(desktopContextCommandEnabled('saveFile', base), false);
    assert.equal(desktopContextCommandEnabled('saveFile', { ...base, filePreviewOpen: true, fileDirty: true }), true);
    assert.equal(desktopContextCommandEnabled('saveFile', { ...base, filePreviewOpen: true, fileDirty: true, fileSaving: true }), false);
});

test('terminal requires a workspace while browser and find only require a conversation', () => {
    assert.equal(desktopContextCommandEnabled('terminal', { ...base, hasWorkspace: false }), false);
    assert.equal(desktopContextCommandEnabled('browser', { ...base, hasWorkspace: false }), true);
    assert.equal(desktopContextCommandEnabled('findConversation', { ...base, hasWorkspace: false }), true);
    assert.equal(desktopContextCommandEnabled('findConversation', { ...base, visualTabOpen: true }), false);
});
