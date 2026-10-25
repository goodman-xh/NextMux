import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createComicProject, applyComicCommand, parseComicProject, serializeComicProject } from '@nextmux/comic-core';
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['setComicShotDraft', 'saveComicShot']); const methods = [];
function visit(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); }
visit(ast); assert.equal(methods.length, names.size);
const dependency = path => JSON.stringify(new URL(path, import.meta.url).href);
const compiled = ts.transpileModule(`
import { parseComicShotBeats } from ${dependency('../lib/browser/nextmux-comic-shot-fields.js')};
import { comicShotFieldText } from ${dependency('../lib/browser/nextmux-comic-studio-text.js')};
export class Harness { ${methods.join('\n')} }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { Harness } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
function fixture() {
    const h = new Harness(); let project = createComicProject();
    const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
    project = applyComicCommand(project, { type: 'shot.update', expectedRevision: project.revision, sceneId, shotId,
        patch: { cameraAngle: 'low', lens: { focalLength: 'telephoto', depthOfField: 'shallow' }, transition: 'dissolve' } });
    Object.assign(h, { desktopLocale: 'en', comicSceneDirty: false, comicStyleBibleDirty: false,
        comicProject: () => project, activeComicScene: () => project.scenes[0], activeComicShot: () => project.scenes[0].shots[0], update() {},
        comicShotDraft: { title: project.scenes[0].shots[0].title, description: '', durationSeconds: '4', volume: '1', fadeInSeconds: '0', fadeOutSeconds: '0',
            cameraAngle: 'low', lensFocalLength: 'telephoto', lensDepthOfField: 'shallow', transition: 'dissolve', transitionIn: 'dissolve', transitionOut: 'cut',
            beatsText: '', dialogueTone: '', dialogueText: '', speakerCharacterId: '', continuousTakeId: '', shotSize: 'medium', cameraMotion: 'static', visualPrompt: '', negativePrompt: '' },
        commitComicCommand: async command => { h.submitted = JSON.parse(JSON.stringify(command)); project = applyComicCommand(project, h.submitted); return { project }; }
    }); return h;
}
test('Automatic selectors send explicit null across RPC and actually clear persisted grammar', async () => {
    const h = fixture(); h.setComicShotDraft({ cameraAngle: '', lensFocalLength: '', transition: '' });
    assert.equal(h.comicShotDraft.lensDepthOfField, ''); assert.equal(h.comicShotDraft.transitionIn, 'cut');
    await h.saveComicShot();
    assert.equal(h.submitted.patch.cameraAngle, null); assert.equal(h.submitted.patch.lens, null); assert.equal(h.submitted.patch.transition, null);
    const saved = parseComicProject(serializeComicProject(h.comicProject())).project.scenes[0].shots[0];
    assert.equal(saved.cameraAngle, undefined); assert.equal(saved.lens, undefined); assert.equal(saved.transition, undefined);
});
test('either lens selector can return the optional lens to Automatic', async () => {
    const h = fixture(); h.setComicShotDraft({ lensDepthOfField: '' }); await h.saveComicShot();
    assert.equal(h.comicShotDraft.lensFocalLength, ''); assert.equal(h.activeComicShot().lens, undefined);
    h.setComicShotDraft({ lensFocalLength: 'wide' }); await h.saveComicShot();
    assert.deepEqual(h.activeComicShot().lens, { focalLength: 'wide', depthOfField: 'deep' });
});
test('new and legacy incoming transition controls stay synchronized and preserve manual choice', async () => {
    const h = fixture(); h.setComicShotDraft({ transition: 'cut' }); await h.saveComicShot();
    assert.equal(h.activeComicShot().transition, 'cut'); assert.equal(h.comicShotDraft.transitionIn, 'cut');
    h.setComicShotDraft({ transitionIn: 'fade' }); await h.saveComicShot();
    assert.equal(h.comicShotDraft.transition, 'fade'); assert.equal(h.activeComicShot().transition, 'fade');
});
