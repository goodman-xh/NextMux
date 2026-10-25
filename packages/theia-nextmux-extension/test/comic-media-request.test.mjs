import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Execute the production request/eligibility methods without mounting Theia.
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methodNames = new Set(['mediaRequestInput', 'mediaDraftReady', 'comicVideoEditSelection']);
const methods = [];
function visit(node) {
    if (ts.isMethodDeclaration(node) && methodNames.has(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, visit);
}
visit(ast);
const compiled = ts.transpileModule(`export class Harness { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const { Harness } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture(patch = {}) {
    const widget = new Harness();
    widget.mediaDraft = {
        kind: 'video', connectionId: 'route-test', model: 'video-test', prompt: 'Change the background',
        negativePrompt: '', sourceVideoUri: 'assets/original.mp4',
        editFrameSeconds: '', editStartSeconds: '1', editEndSeconds: '3', costConfirmed: true,
        ...patch
    };
    widget.comicProject = () => ({ frameRate: 24, canvas: { width: 1920, height: 1080 } });
    widget.activeComicShot = () => ({ durationFrames: 120 });
    // The step's chosen route (own API "route-test"), as the step model picker resolves it.
    widget.comicMediaRoute = (_kind, routeId) => routeId === 'route-test'
        ? { id: 'route-test', kind: 'official', label: 'video-test', providerName: 'Own API', model: 'video-test', connection: { id: 'route-test' } } : undefined;
    widget.comicAsset = () => undefined;
    widget.comicShotReferenceUris = () => [];
    return widget;
}

test('segment intent keeps its range, but cannot charge an unsupported editing route', () => {
    const widget = fixture();
    assert.equal(widget.mediaDraftReady(), false, 'unsupported native edits must not be submitted');
    const input = widget.mediaRequestInput('video');
    assert.equal(input.editFrameSeconds, undefined);
    assert.equal(input.editStartSeconds, 1);
    assert.equal(input.editEndSeconds, 3);
    assert.equal(input.durationSeconds, 2);
    assert.equal(input.sourceVideoUri, 'assets/original.mp4');
});

test('explicit frame zero is valid but an empty frame field is not zero', () => {
    const widget = fixture({ editFrameSeconds: '0', editStartSeconds: '', editEndSeconds: '' });
    assert.equal(widget.mediaDraftReady(), false, 'unsupported native edits must not be submitted');
    assert.equal(widget.mediaRequestInput('video').editFrameSeconds, 0);
});

test('invalid or ambiguous edits cannot become full-shot generation requests', () => {
    const invalid = [
        { editStartSeconds: '', editEndSeconds: '' },
        { editStartSeconds: '', editEndSeconds: '3' },
        { editStartSeconds: '3', editEndSeconds: '2' },
        { editStartSeconds: '1', editEndSeconds: '6' },
        { editStartSeconds: 'NaN', editEndSeconds: '3' },
        { editFrameSeconds: '0' },
        { editFrameSeconds: '5', editStartSeconds: '', editEndSeconds: '' },
        { sourceVideoUri: undefined }
    ];
    for (const patch of invalid) {
        const widget = fixture(patch);
        assert.equal(widget.mediaDraftReady(), false, JSON.stringify(patch));
        assert.equal(widget.mediaRequestInput('video'), undefined, JSON.stringify(patch));
    }
});

test('ordinary generation still works when no edit was requested', () => {
    const widget = fixture({ sourceVideoUri: undefined, editFrameSeconds: '', editStartSeconds: '', editEndSeconds: '' });
    assert.equal(widget.mediaDraftReady(), true);
    assert.equal(widget.mediaRequestInput('video').sourceVideoUri, undefined);
});
