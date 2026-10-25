import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { formatModelError, formatPlatformMediaError, PLATFORM_MEDIA_MESSAGES, PLATFORM_MEDIA_REASONS } from '@nextmux/model-runtime/errors';
import { ComicCoreError } from '@nextmux/comic-core';
import { MediaCoreError, MediaRuntimeError } from '@nextmux/media-core';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { exportMessage, mediaMessage, mediaMessageText, validMediaMessage, comicExportMessageText } from '../lib/common/nextmux-media-messages.js';
import { modelFailure, modelFailureText } from '../lib/browser/nextmux-model-errors.js';
import { MEDIA_AUDIT_TEXT_ROWS, mediaAuditText } from '../lib/browser/nextmux-media-audit-locale.js';
const locales = ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt-BR','ru','ar','hi'];
const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react');
const { renderToStaticMarkup } = coreRequire('react-dom/server');
const { StreamNotice } = require('../lib/browser/nextmux-conversation-stream.js');
const { ComicExportWarnings } = require('../lib/browser/nextmux-media-diagnostics.js');

for (const locale of locales) test(`WP3 complete catalog and explicit UI copy: ${locale}`, () => {
    for (const [key, row] of Object.entries(PLATFORM_MEDIA_MESSAGES)) {
        assert.equal(row.length, 12, key);
        assert.ok(row[locales.indexOf(locale)]?.trim(), key);
        assert.equal(typeof formatPlatformMediaError(`platform_media.${key}`, {}, locale), 'string');
    }
    for (const key of Object.keys(PLATFORM_MEDIA_REASONS)) {
        const info = mediaMessage(key, { title: '用户のタイトル', provider: 'Provider', limit: 5, unit: 'MB', current: 2, total: 3 });
        const text = formatModelError(info, locale).text;
        assert.equal(text, mediaMessageText(info, locale), key);
        assert.ok(!text.includes('{field}'), key);
    }
    for (const [key, row] of Object.entries(MEDIA_AUDIT_TEXT_ROWS)) {
        assert.equal(row.length, 12, key);
        assert.ok(mediaAuditText(locale, key).trim(), key);
    }
});

test('WP3 RPC retains distinct reasons and parameters instead of matching diagnostic prose', async () => {
    const service = new NextMuxPlatformServiceImpl();
    const reject = async input => {
        try { await service.saveMediaRuntime(input); assert.fail('expected invalid runtime'); }
        catch (error) { return error; }
    };
    const shape = await reject({});
    const path = await reject({ ffmpegPath: 'relative/ffmpeg', comfyUiBaseUrl: '', comfyUiWorkflowPath: '' });
    assert.equal(shape.code, 'INVALID_FFMPEG_PATH');
    assert.equal(path.code, shape.code);
    assert.notEqual(path.messageKey, shape.messageKey);
    assert.equal(path.data.readableError.messageKey, 'platform_media.ffmpeg_path_absolute');
    assert.equal(path.domain, 'media');
    assert.match(path.message, /absolute local path/);
    const rpc = { code: path.code, message: 'DIAGNOSTIC CHANGED', data: JSON.parse(JSON.stringify(path.data)) };
    for (const locale of locales) assert.equal(modelFailureText(locale, rpc), modelFailureText(locale, path));
});

test('WP3 core reasons survive platform wrappers and durable worker failures', () => {
    const service = new NextMuxPlatformServiceImpl();
    const media = new MediaRuntimeError('SAME_CODE', mediaMessage('asset_not_file', { title: '我的镜头' }), false);
    const wrapped = service.mediaRequestError(media);
    assert.equal(wrapped.data.readableError.messageKey, media.messageKey);
    assert.deepEqual(wrapped.data.readableError.params, { title: '我的镜头' });
    const failure = service.mediaFailure(wrapped);
    for (const locale of locales) assert.equal(modelFailureText(locale, failure), modelFailureText(locale, media));
    const comic = new ComicCoreError('PROJECT_NOT_FOUND', 'original diagnostic');
    const core = service.comicRequestError(comic);
    assert.equal(core.readableError.domain, 'comic');
    assert.equal(core.readableError.messageKey, comic.messageKey);
});

test('WP3 export progress, warnings and user titles survive reload and locale changes', async () => {
    class Service extends NextMuxPlatformServiceImpl { async persistComicExport() {} }
    const service = new Service();
    const date = '2026-09-28T00:00:00.000Z';
    const warning = mediaMessage('save_warning', { path: '/tmp/用户 {current}/film' }, 'raw failure');
    const state = { id: 'comic-export-00000000-0000-0000-0000-000000000000', projectId: 'project', projectRevision: 1, projectTitle: '私の作品', status: 'rendering', quality: 'draft', subtitleMode: 'none', progress: 10, completedShots: 1, totalShots: 3, ...exportMessage('export_rendering', { current: 2, total: 3 }), warnings: [mediaMessageText(warning)], warningInfos: [warning], cancelRequested: false, cancellable: true, startedAt: date, updatedAt: date };
    const roundTrip = service.storedComicExport(JSON.parse(JSON.stringify(state)));
    assert.ok(roundTrip);
    assert.equal(roundTrip.projectTitle, state.projectTitle);
    assert.equal(roundTrip.warningInfos[0].params.path, warning.params.path);
    assert.equal(comicExportMessageText(roundTrip, 'es'), 'Procesando plano 2 / 3');
    assert.match(mediaMessageText(warning, 'ja'), /\/tmp\/用户 \{current\}\/film/);
    assert.equal(roundTrip.warningInfos[0].detail, 'raw failure');
    const legacy = { ...state, message: 'untranslated legacy progress', messageInfo: undefined };
    assert.ok(!comicExportMessageText(legacy, 'fr').includes('untranslated'));
    assert.equal(validMediaMessage({ ...warning, params: { path: {} } }), false);
    assert.equal(service.storedComicExport({ ...state, warningInfos: [{ ...warning, params: [] }] }), undefined);
});

test('WP3 asset fallback records localized warning identity separately from raw cause', async () => {
    class Service extends NextMuxPlatformServiceImpl {
        async comicExportAssetPath() { throw new Error('供应商诊断 原文'); }
    }
    const service = new Service();
    const project = { frameRate: 24, projectKind: 'novel', assets: [{ id: 'v', kind: 'video' }], scenes: [{ id: 'scene', title: '用户场景', shots: [{ id: 'shot', title: 'User title', durationFrames: 24, videoAssetId: 'v', dialogueCues: [] }] }] };
    const result = await service.prepareComicExportSources('/tmp', project, { allowPlaceholders: true, verifyAssetIntegrity: false }, 'ffmpeg', new AbortController().signal);
    assert.deepEqual(result.warningInfos.map(v => v.messageKey), ['platform_media.video_unavailable', 'platform_media.placeholder']);
    assert.equal(result.warningInfos[0].params.title, '用户场景 / User title');
    assert.equal(result.warningInfos[0].detail, '供应商诊断 原文');
    assert.ok(!mediaMessageText(result.warningInfos[0], 'es').includes('供应商诊断'));
});

test('WP5 error cards retain localized reasons while raw diagnostics stay out of markup', () => {
    for (const locale of locales) {
        const markup = renderToStaticMarkup(React.createElement(StreamNotice, { locale, tone: 'error', text: 'localized summary', detail: 'raw diagnostic' }));
        assert.ok(markup.includes('localized summary'));
        assert.ok(!markup.includes('<details>') && !markup.includes('raw diagnostic'));
        assert.ok(!markup.includes('title="raw diagnostic"'));
        const warning = renderToStaticMarkup(React.createElement(ComicExportWarnings, { locale, state: { warnings: ['legacy raw warning'] } }));
        assert.ok(!warning.includes('legacy raw warning'));
        assert.ok(!warning.includes('<pre'));
    }
});

test('WP3 known user-facing catches and literal/a11y surfaces are explicitly localized', async () => {
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(source, /musicMvWrites = write.catch\(error => \{ this.musicMvError = modelFailureText/);
    assert.match(source, /musicMvFailure = modelFailure\(this.desktopLocale, error\)/);
    assert.ok(!/comicExportError = error instanceof Error|mediaError = error instanceof Error/.test(source));
    for (const text of ["alt='上一版本画面'", "alt='当前版本画面'", '<label>Voice ID', '>重新生成（新任务）</button>']) assert.ok(!source.includes(text), text);
    assert.match(source, /mediaAuditText\(this.desktopLocale, 'shotImage', \{ title: shot.title \}\)/);
});


test('WP3 unknown semantic keys cannot select inherited object properties', () => {
    for (const suffix of ['toString', 'constructor', '__proto__', 'does_not_exist']) {
        assert.equal(formatPlatformMediaError(`platform_media.${suffix}`, {}, 'ja'), undefined);
        assert.doesNotThrow(() => formatModelError({ domain: 'media', messageKey: `platform_media.${suffix}`, detail: 'raw' }, 'es'));
    }
});

test('WP3 speech protocol copy is localized while the OpenAI brand is preserved', () => {
    for (const locale of locales) {
        const text = mediaMessageText(mediaMessage('speech_protocol_unsupported'), locale);
        assert.match(text, /OpenAI/);
        if (locale !== 'en') assert.ok(!text.includes('OpenAI-compatible speech API'));
    }
});


test('WP3 unknown worker failures use media copy and preserve the raw cause only in details', () => {
    const failure = new NextMuxPlatformServiceImpl().mediaFailure(new Error('local unrecoverable raw error'));
    for (const locale of locales) {
        const rendered = modelFailure(locale, failure);
        assert.equal(rendered.domain, 'media');
        assert.equal(rendered.text, mediaMessageText(mediaMessage('media_operation_failed'), locale));
        assert.match(rendered.detail, /local unrecoverable raw error/);
    }
});
