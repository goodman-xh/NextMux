import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Settings → Models → “Enable anonymous models”: unlisted/… models follow one switch in every picker.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methods = new Map();
const visit = node => { if (ts.isMethodDeclaration(node)) methods.set(node.name.getText(ast), node.getText(ast)); ts.forEachChild(node, visit); };
visit(ast);
const code = ts.transpile(`class Harness { ${['isModelVisible', 'setAnonymousModelsEnabled', 'restoreAnonymousModelsPreference'].map(name => methods.get(name)).join('\n')} }`, { target: ts.ScriptTarget.ES2022 });
const storage = new Map();
const window = { localStorage: { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) ?? null } };
// Decision models (Jev) never appear in model pickers; the real rule is used (src/common/nextmux-decision-models.ts).
const { isDecisionModel } = await import('../lib/common/nextmux-decision-models.js');
const { createModelVisibilityCatalog, resolveModelVisibilityId } = await import('../lib/browser/nextmux-model-visibility.js');
const Harness = new Function('modelVisible', 'window', 'isDecisionModel', 'resolveModelVisibilityId', `${code}; return Harness;`)(() => true, window, isDecisionModel, resolveModelVisibilityId);

test('anonymous models are enabled initially and an explicit off remains off after restore', () => {
    const widget = Object.assign(new Harness(), { update() {}, modelVisibility: {}, modelVisibilityCatalog: createModelVisibilityCatalog([
        { canonicalModel: 'openai/gpt-5.1', provider: 'openai', kind: 'llm' }
    ]) });
    widget.restoreAnonymousModelsPreference(null);
    assert.equal(widget.isModelVisible('unlisted/model-0a1b2c3d4e'), true);
    assert.equal(widget.isModelVisible('openai/gpt-5.1'), true, 'catalogued models keep their own visibility');
    widget.setAnonymousModelsEnabled(true);
    assert.equal(widget.isModelVisible('unlisted/model-0a1b2c3d4e'), true);
    assert.equal(widget.isModelVisible(' Unlisted/model-ff ', 'image'), true, 'media pickers follow the same switch');
    assert.equal(storage.get('nextmux.desktop.anonymousModels.v1'), '1');
    widget.setAnonymousModelsEnabled(false);
    assert.equal(widget.isModelVisible('unlisted/model-0a1b2c3d4e'), false);
    widget.restoreAnonymousModelsPreference(storage.get('nextmux.desktop.anonymousModels.v1'));
    assert.equal(widget.isModelVisible('unlisted/model-0a1b2c3d4e'), false, 'reopening preserves the explicitly saved off');
    widget.restoreAnonymousModelsPreference('1');
    assert.equal(widget.isModelVisible('unlisted/model-0a1b2c3d4e'), true, 'another window can explicitly enable it');
    widget.restoreAnonymousModelsPreference('0');
    assert.equal(widget.isModelVisible('unlisted/model-0a1b2c3d4e'), false, 'another window can explicitly disable it');
});

test('the switch sits under the model list and the public model directory never lists anonymous models', () => {
    // The switch (now named "preview models", localized in all 12 languages) sits right under the model list.
    assert.match(source, /onChange=\{\(ids, group, enabled\) => this\.setVisibleModels\(ids, group, enabled\)\} \/>\s*<AnonymousModelsToggle enabled=\{Boolean\(this\.anonymousModelsEnabled\)\}[\s\S]*?label=\{modelVisibilityCopy\(this\.desktopLocale\)\[16\]\}/);
    assert.match(methods.get('settingsModelOptions'), /!\/\^unlisted\\\/\/i\.test\(model\.canonicalModel\)/);
});
