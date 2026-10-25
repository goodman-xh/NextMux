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

const { editingCommandEnabled } = await loadTypeScriptModule('../src/browser/nextmux-desktop-editing-context.ts');

const commands = ['undo', 'redo', 'cut', 'copy', 'paste'];

test('editing commands require an editable or selectable target', () => {
    for (const command of commands) {
        assert.equal(editingCommandEnabled(command, { target: 'none' }), false, `${command} must be disabled without a target`);
        assert.equal(editingCommandEnabled(command, { target: 'native', editable: false, hasSelection: true }), command === 'copy', `${command} must respect a read-only native target`);
        assert.equal(editingCommandEnabled(command, { target: 'native', editable: false, hasSelection: false }), false, `${command} must be disabled on an uneditable empty target`);
    }
});

test('editable native targets enable mutation commands while selection enables copy and cut', () => {
    for (const command of ['undo', 'redo', 'paste']) {
        assert.equal(editingCommandEnabled(command, { target: 'native', editable: true, hasSelection: false }), true, `${command} should be enabled for an editable target`);
    }
    assert.equal(editingCommandEnabled('copy', { target: 'native', editable: true, hasSelection: true }), true);
    assert.equal(editingCommandEnabled('cut', { target: 'native', editable: true, hasSelection: true }), true);
    assert.equal(editingCommandEnabled('copy', { target: 'native', editable: true, hasSelection: false }), false);
    assert.equal(editingCommandEnabled('cut', { target: 'native', editable: true, hasSelection: false }), false);
});

test('selection-only surfaces expose copy but never clipboard mutation commands', () => {
    assert.equal(editingCommandEnabled('copy', { target: 'selection', hasSelection: true }), true);
    for (const command of ['undo', 'redo', 'cut', 'paste']) {
        assert.equal(editingCommandEnabled(command, { target: 'selection', hasSelection: true }), false, `${command} must not mutate rendered selections`);
    }
});

test('menu hover rules keep disabled commands visually disabled in both themes', async () => {
    const fs = await import('node:fs/promises');
    const style = await fs.readFile(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    assert.match(style, /\.lm-Menu-item:hover:not\(\.lm-mod-disabled\)[\s\S]*?background:\s*var\(--nmx-menu-hover\)/);
    assert.match(style, /\.lm-Menu-item\.lm-mod-disabled:hover[\s\S]*?background:\s*transparent/);
    assert.match(style, /body:has\(#nextmux\\\.desktop\\\.widget:not\(\.lm-mod-hidden\) \.nmx-theme-light\)[\s\S]*?--nmx-menu-hover:\s*#e8e4e1/);
    assert.match(style, /body:has\(#nextmux\\\.desktop\\\.widget:not\(\.lm-mod-hidden\)\)[\s\S]*?--nmx-menu-hover:\s*#343033/);
});
