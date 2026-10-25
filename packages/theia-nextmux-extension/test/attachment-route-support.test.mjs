import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { routeSupportsModelAttachment as supports } from '../lib/common/nextmux-attachment-support.js';

const file = (mimeType = 'application/octet-stream', name = 'attachment.bin') => ({ kind: 'file', name, mimeType, dataBase64: 'AQID' });
const managed = (input = [], capabilities = []) => ({ kind: 'managed_gateway', offering: { input, capabilities } });
const evidence = (capability, support = 'supported', confidence = 'verified') => ({ capability, support, confidence, source: 'live_probe', observedAt: '2026-09-22T00:00:00Z' });
const official = (patch = {}) => ({ kind: 'official_connection', connection: {
    status: 'verified', model: 'selected', protocol: 'openai_chat_completions', providerId: 'custom_openai', capabilityEvidence: [], discoveredModels: [], ...patch
} });
const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

test('the actual composer delegates to the shared attachment capability check', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let method;
    function visit(node) {
        if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'routeSupportsAttachment') method = node.getText(ast);
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(method);
    const Harness = new Function('routeSupportsModelAttachment', `${ts.transpile(`class Harness { ${method} }`, { target: ts.ScriptTarget.ES2022 })};return Harness;`)(supports);
    assert.equal(new Harness().routeSupportsAttachment({ attachment: file(docx) }, official()), false);
    assert.equal(new Harness().routeSupportsAttachment({ attachment: file('application/pdf') }, official({ capabilityEvidence: [evidence('input:pdf')] })), true);
});

test('generation verification, unknown modalities and model-name guesses never prove file support', () => {
    assert.equal(supports(file(docx), official({ capabilityEvidence: [evidence('model:generatable')] })), false);
    assert.equal(supports(file('application/pdf'), official()), false);
    assert.equal(supports(file('application/pdf'), official({ capabilityEvidence: [evidence('input:pdf', 'supported', 'inferred')] })), false);
    assert.equal(supports(file(docx), managed()), false);
});

test('managed input declarations are exact names, never substring matches or output capabilities', () => {
    for (const value of ['no-files', 'profile', 'document-editing', 'audio-output', 'video-generation']) {
        assert.equal(supports(file(docx), managed([], [value])), false, value);
    }
    assert.equal(supports(file(docx), managed(['files'])), true);
    assert.equal(supports(file('audio/wav'), managed([], ['audio-output'])), false);
    assert.equal(supports(file('audio/wav'), managed(['audio'])), true);
    assert.equal(supports(file('image/avif'), managed(['files'])), false);
});

test('only the selected model metadata is used and verified rejection takes priority', () => {
    const models = [{ id: 'other', inputModalities: ['image', 'file'] }, { id: 'selected', inputModalities: ['text'] }];
    assert.equal(supports(file('application/pdf'), official({ discoveredModels: models })), false);
    models[1].inputModalities.push('file');
    assert.equal(supports(file('application/pdf'), official({ discoveredModels: models })), true);
    assert.equal(supports(file('application/pdf'), official({ discoveredModels: models, capabilityEvidence: [evidence('input:pdf', 'unsupported')] })), false);
});

test('native non-PDF bytes require exact MIME support and a compatible installed transport', () => {
    const metadata = [{ id: 'selected', inputModalities: ['file'], inputMimeTypes: [docx] }];
    for (const protocol of ['openai_responses', 'gemini_generate_content']) {
        assert.equal(supports(file(docx), official({ protocol, discoveredModels: metadata })), true);
        assert.equal(supports(file('application/pdf'), official({ protocol, discoveredModels: metadata })), false);
    }
    for (const protocol of ['cohere_chat', 'anthropic_messages', 'openai_chat_completions']) {
        assert.equal(supports(file(docx), official({ protocol, discoveredModels: metadata })), false, protocol);
    }
    assert.equal(supports(file(docx), official({ protocol: 'openai_responses', discoveredModels: [{ id: 'selected', inputModalities: ['file'] }] })), false);
});

test('audio/video input is limited by both model evidence and transport format', () => {
    const capabilities = [evidence('input:audio'), evidence('input:video')];
    assert.equal(supports(file('audio/wav'), official({ capabilityEvidence: capabilities })), true);
    assert.equal(supports(file('audio/flac'), official({ capabilityEvidence: capabilities })), false);
    assert.equal(supports(file('video/mp4'), official({ capabilityEvidence: capabilities })), false);
    assert.equal(supports(file('video/mp4'), official({ protocol: 'gemini_generate_content', capabilityEvidence: capabilities })), true);
});

test('Cohere never claims binary files; supported text conversion remains available', () => {
    const route = official({ protocol: 'cohere_chat', discoveredModels: [{ id: 'selected', inputModalities: ['file'] }] });
    assert.equal(supports(file('application/pdf'), route), false);
    assert.equal(supports(file('text/markdown'), route), true);
    assert.equal(supports({ kind: 'text', name: 'README.md', content: 'Hello' }, route), true);
    assert.equal(supports(file('text/plain')), false);
});

test('explicit native false declarations override stale image/PDF positive evidence', () => {
    const unsupported = { support: 'unsupported', source: 'provider_metadata', scope: 'route' };
    for (const [kind, mimeType] of [['image', 'image/png'], ['pdf', 'application/pdf']]) {
        const route = official({ protocol: 'anthropic_messages', capabilityEvidence: [evidence(`input:${kind}`)],
            discoveredModels: [{ id: 'selected', inputModalities: [kind], capabilityDeclarations: { [`input:${kind}`]: unsupported } }] });
        assert.equal(supports(file(mimeType), route), false);
        const relay = managed([kind]);
        relay.offering.routeCapabilityDeclarations = { [`input:${kind}`]: unsupported };
        assert.equal(supports(file(mimeType), relay), false);
    }
});
