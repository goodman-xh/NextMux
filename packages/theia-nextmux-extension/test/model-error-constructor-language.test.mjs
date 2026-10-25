import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { OfficialModelError, validatedLocalModelBaseUrl } from '@nextmux/model-runtime';
import { MediaRuntimeError, MediaCoreError } from '@nextmux/media-core';
import { formatModelError, MODEL_ERROR_LOCALES } from '@nextmux/model-runtime/errors';
import { mediaMessage } from '../lib/common/nextmux-media-messages.js';

const root = new URL('../src/', import.meta.url);
const records = [];
const sources = new Map();
async function scan(folder) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, item.name);
        if (item.isDirectory()) await scan(path);
        else if (/\.tsx?$/.test(item.name)) {
            const text = await readFile(path, 'utf8');
            const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
            sources.set(path, ast);
            function visit(node) {
                if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ['OfficialModelError', 'MediaRuntimeError', 'MediaCoreError'].includes(node.expression.text)) {
                    records.push({ ast, node, type: node.expression.text, message: node.arguments?.[1], text: node.getText(ast) });
                }
                ts.forEachChild(node, visit);
            }
            visit(ast);
        }
    }
}
await scan(root.pathname);

function instantiate(record) {
    const response = { usage: { inputTokens: 11, outputTokens: 22 }, usageKnown: true };
    const runtime = { ffmpeg: { message: 'FFmpeg 原始诊断 / local details' } };
    const values = { OfficialModelError, MediaRuntimeError, MediaCoreError, mediaMessage, response, runtime,
        request: new Request('http://localhost:11434/disallowed'), name: '用户供应商 {limit}' };
    const code = ts.transpileModule(`return (${record.text});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(values), code)(...Object.values(values));
}

test('every extension model/media/core exception constructor keeps fixed diagnostic scaffolding English', () => {
    assert.ok(records.length >= 40, 'scan every extension source file, not a hand-picked subset');
    for (const record of records) {
        assert.ok(record.message, record.text);
        function visit(node) {
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
                assert.doesNotMatch(node.text, /\p{Script=Han}/u, `${record.ast.fileName}: ${record.text}`);
            }
            ts.forEachChild(node, visit);
        }
        visit(record.message);
        if (record.type !== 'OfficialModelError') {
            assert.equal(ts.isStringLiteral(record.message) || ts.isNoSubstitutionTemplateLiteral(record.message), false, 'media business errors require explicit message metadata');
            if (ts.isPropertyAccessExpression(record.message)) {
                assert.equal(record.message.getText(record.ast), 'error.message');
                assert.equal(record.node.arguments?.[4]?.getText(record.ast), 'error', 'the only provider pass-through must retain its typed cause');
            }
        }
    }
});

test('extension OfficialModelError constructors preserve English messages, usage and stable params', () => {
    const official = records.filter(record => record.type === 'OfficialModelError');
    assert.equal(official.length, 5);
    for (const record of official) {
        const error = instantiate(record);
        assert.ok(error instanceof OfficialModelError);
        assert.doesNotMatch(error.message, /\p{Script=Han}/u);
        assert.ok(error.messageKey.startsWith('model.'));
        assert.deepEqual(error.data.params, error.params);
        if (error.code === 'CANCELLED' || error.code === 'EVENT_DELIVERY_FAILED') {
            assert.equal(error.params.automaticRetry, false);
            assert.equal(error.retrySafe, false);
            assert.deepEqual(error.usage, { inputTokens: 11, outputTokens: 22 });
        }
        if (error.code === 'CONNECTION_FAILED') {
            assert.equal(error.readableError.kind, 'network');
            if (record.text.includes('provider: name')) assert.equal(error.params.provider, '用户供应商 {limit}', 'provider names remain authored data');
        }
        for (const locale of MODEL_ERROR_LOCALES) {
            const result = formatModelError({ code: error.code, message: error.message, data: error.data }, locale);
            assert.equal(result.domain, 'model');
            assert.ok(result.text);
            if (locale !== 'en') assert.notEqual(result.text, formatModelError(error, 'en').text);
        }
    }
});

test('remaining transcription, FFmpeg and restored-history failures carry distinct localizable domain identities', () => {
    const selected = records.filter(record => record.type !== 'OfficialModelError' &&
        (record.text.includes("operation: 'transcription'") || record.text.includes("provider: 'FFmpeg'") || record.text.includes("'FFMPEG_UNAVAILABLE'") || record.text.includes("'JOB_HISTORY_ONLY'")));
    assert.equal(selected.length, 4);
    const expectedKeys = new Set(['platform_media.media_cancelled', 'platform_media.output_invalid', 'platform_media.ffmpeg_unavailable', 'media.restored_media_history_cannot_start_a_new_generation']);
    for (const record of selected) {
        const error = instantiate(record);
        assert.ok(expectedKeys.delete(error.messageKey), error.messageKey);
        assert.doesNotMatch(error.message, /\p{Script=Han}/u);
        if (error.code === 'FFMPEG_UNAVAILABLE') assert.match(error.readableError.detail, /FFmpeg 原始诊断/);
        for (const locale of MODEL_ERROR_LOCALES) {
            const result = formatModelError(JSON.parse(JSON.stringify({ code: error.code, message: error.message, data: { readableError: error.readableError } })), locale, { source: 'own_api' });
            assert.equal(result.domain, 'media');
            assert.equal(result.action, 'none');
            assert.equal(result.messageKey, error.messageKey);
            assert.ok(!result.text.includes('原始诊断'));
            if (locale !== 'en') assert.notEqual(result.text, formatModelError(error, 'en').text);
        }
    }
    assert.equal(expectedKeys.size, 0);
});

test('the real local transport guard rejects unsupported endpoints with English structured diagnostics before network access', async () => {
    const ast = [...sources.values()].find(source => source.fileName.endsWith('/nextmux-local-model-transport.ts'));
    const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'LocalModelTransport');
    const code = ts.transpileModule(`${klass.getText(ast).replace('export ', '')}; return LocalModelTransport;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const Transport = new Function('OfficialModelError', 'validatedLocalModelBaseUrl', 'Agent', code)(OfficialModelError, validatedLocalModelBaseUrl, class { constructor() { assert.fail('network dispatcher must not be created'); } });
    await assert.rejects(new Transport().fetch('http://localhost:11434/not-allowed'), error => {
        assert.equal(error.code, 'LOCAL_MODEL_URL_REQUIRED');
        assert.equal(error.message, 'The local model endpoint is not allowed');
        assert.deepEqual(error.params, { reason: 'endpoint_not_allowed', method: 'GET' });
        return true;
    });
});
