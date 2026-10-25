import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// The comic media/export polls (every 5 s) and the site poll (every 4 s) used to re-render the whole
// page on every answer, timeline included. Run the production methods: an unchanged answer is silent.
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['loadMediaState', 'hydrateMediaRuntimeDrafts', 'loadComicExportState', 'loadSiteState']);
const methods = [];
(function visit(node) {
    if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, visit);
})(ast);
assert.equal(methods.length, names.size);
const compiled = ts.transpileModule(`
import { modelFailureText } from ${JSON.stringify(new URL('../lib/browser/nextmux-model-errors.js', import.meta.url).href)};
const EMPTY_COMIC_EXPORT_STATE = { exports: [] };
const mediaRuntimeText = () => 'failed';
export class Harness { ${methods.join('\n')} }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { Harness } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const runtime = { ffmpeg: { source: 'bundled' }, comfyUi: { configured: false, available: false } };
function fixture() {
    const h = new Harness();
    let media = { jobs: [{ id: 'a', status: 'succeeded' }], runtime };
    let exports = { exports: [{ id: 'e', status: 'completed' }] };
    let site = { processes: [] };
    Object.assign(h, {
        updates: 0, update() { this.updates++; },
        activeComicWorkspaceRoot: '/comic', activeWorkspaceRoot: '/code', mediaLoadSequence: 0, comicExportLoadSequence: 0,
        mediaState: { jobs: [], runtime }, mediaWorkspaceRoot: '', comicExportState: { exports: [] }, comicExportWorkspaceRoot: '',
        siteState: { processes: [] }, siteStateWorkspace: '', siteStateLoading: false, notifiedComicExportIds: new Set(),
        syncSiteBrowsers() {}, addNotification() {},
        platformService: {
            getMediaWorkspaceState: async () => structuredClone(media),
            getComicExportWorkspaceState: async () => structuredClone(exports),
            getWorkspaceSiteState: async () => structuredClone(site)
        },
        set: { media: value => { media = value; }, exports: value => { exports = value; }, site: value => { site = value; } }
    });
    return h;
}

test('an unchanged poll answer does not re-render; a changed one or a running job does', async () => {
    const h = fixture();
    await h.loadMediaState(true, true);
    assert.equal(h.updates, 1, 'the first answer for this project renders');
    await h.loadMediaState(true, true);
    assert.equal(h.updates, 1, 'the same answer again is silent');
    h.set.media({ jobs: [{ id: 'a', status: 'succeeded' }, { id: 'b', status: 'failed' }], runtime });
    await h.loadMediaState(true, true);
    assert.equal(h.updates, 2);
    assert.equal(h.mediaState.jobs.length, 2);
    h.set.media({ jobs: [{ id: 'c', status: 'running' }], runtime });
    await h.loadMediaState(true, true);
    await h.loadMediaState(true, true);
    assert.equal(h.updates, 4, 'a running job keeps refreshing its progress');
    await h.loadMediaState(true);
    assert.equal(h.updates, 5, 'other callers still always render');
});

test('export and site polls render only on change or while an export runs', async () => {
    const h = fixture();
    await h.loadComicExportState(true, true);
    await h.loadComicExportState(true, true);
    assert.equal(h.updates, 1);
    h.set.exports({ exports: [], active: { id: 'x', status: 'running' } });
    await h.loadComicExportState(true, true);
    await h.loadComicExportState(true, true);
    assert.equal(h.updates, 3);
    h.updates = 0;
    await h.loadSiteState(true, true);
    await h.loadSiteState(true, true);
    assert.equal(h.updates, 1);
    h.set.site({ processes: [{ id: 'p', urls: ['http://localhost:3000'], script: 'dev' }] });
    await h.loadSiteState(true, true);
    assert.equal(h.updates, 2);
    assert.equal(h.siteStateLoading, false);
});
