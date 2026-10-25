import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { normalizeMediaTemplate } from '@nextmux/model-runtime/media-template';
import { MediaTemplateAdvanced, MediaTemplateAudioFields, mediaTemplateProblem } from '../lib/browser/nextmux-media-template-fields.js';
import { MUSIC_TEMPLATE_LABELS, musicTemplateText } from '../lib/browser/nextmux-music-template-locale.js';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const upload = { path: '{base}/files', format: 'multipart', fileField: 'file', body: '{}', headers: {}, idField: 'data.id', expiresInSeconds: 3600 };
const escape = text => renderToStaticMarkup(React.createElement(React.Fragment, null, text));

function render(locale, template, disabled = false) {
    return renderToStaticMarkup(React.createElement(MediaTemplateAdvanced, { locale, disabled, template, apiType: { value: 'generation', onChange() {} }, onTemplate() {} }));
}

test('music template editor renders both audio inputs and upload fields in all twelve locales', () => {
    const template = normalizeMediaTemplate({ kind: 'music', vocalReference: { mode: 'upload', upload }, referenceSong: { mode: 'upload', upload } });
    for (const [index, locale] of locales.entries()) {
        for (const [key, translations] of Object.entries(MUSIC_TEMPLATE_LABELS)) {
            assert.equal(translations.length, 12, key);
            assert.ok(translations[index].trim(), `${locale}:${key}`);
            assert.equal(musicTemplateText(locale, key), translations[index]);
            if (!['en', 'zh-CN', 'zh-TW', 'ja'].includes(locale)) assert.doesNotMatch(translations[index], /\p{Script=Han}/u, `${locale}:${key}`);
        }
        const html = render(locale, template);
        for (const key of ['music', 'generationApi', 'vocalReference', 'referenceSong', 'disabled', 'url', 'base64', 'upload', 'uploadPath', 'uploadFormat', 'fileField', 'uploadBody', 'uploadHeaders', 'idField', 'expires', 'expiryHint', 'musicVariables', 'uploadVariables', 'bodyHint', 'variablesHint']) {
            assert.ok(html.includes(escape(musicTemplateText(locale, key))), `${locale}:${key}`);
        }
        assert.match(html, /data-music-input="vocalReference"/);
        assert.match(html, /data-music-input="referenceSong"/);
        assert.match(html, /\{\{audio_base64\}\}/);
        assert.match(html, /\{\{vocal_reference\}\}/);
        assert.match(html, /\{\{reference_song\}\}/);
        assert.equal(html.includes('dir="rtl"'), locale === 'ar');
    }
});

test('new music templates leave reference support unconfigured; image and video templates hide it', () => {
    const music = render('en', normalizeMediaTemplate({ kind: 'music' }));
    assert.match(music, /data-music-input="vocalReference"/);
    assert.match(music, /data-music-input="referenceSong"/);
    assert.equal([...music.matchAll(/<option value="" selected="">Not configured<\/option>/g)].length, 2);
    assert.doesNotMatch(music, /Upload address/);
    for (const kind of ['video', 'image']) assert.doesNotMatch(render('en', normalizeMediaTemplate({ kind })), /data-music-input=/);
});

function descendants(node) {
    if (!React.isValidElement(node)) return [];
    return [node, ...React.Children.toArray(node.props.children).flatMap(descendants)];
}

test('editing a reference upload produces a persistable request and rejects incomplete or malformed edits', () => {
    let value;
    const tree = () => MediaTemplateAudioFields({ locale: 'en', disabled: false, input: 'vocalReference', value, onChange: next => { value = next; } });
    const control = label => {
        const row = descendants(tree()).find(node => node.type === 'label' && node.props.children[0]?.props.children[0] === musicTemplateText('en', label));
        assert.ok(row, label);
        return row.props.children[1];
    };
    const change = (label, next) => control(label).props.onChange({ currentTarget: { value: next } });
    change('vocalReference', 'upload');
    assert.ok(mediaTemplateProblem('en', { kind: 'music', vocalReference: value }));
    change('uploadPath', '{base}/audio/upload');
    change('fileField', 'sample');
    change('idField', 'data.vocal_id');
    change('uploadBody', '{"purpose":"voice","name":"{{filename}}"}');
    change('uploadHeaders', '{"X-Version":"2"}');
    change('expires', '7200');
    const persisted = JSON.parse(JSON.stringify(normalizeMediaTemplate({ kind: 'music', vocalReference: value })));
    assert.equal(persisted.vocalReference.upload.path, '{base}/audio/upload');
    assert.equal(persisted.vocalReference.upload.fileField, 'sample');
    assert.equal(persisted.vocalReference.upload.idField, 'data.vocal_id');
    assert.deepEqual(persisted.vocalReference.upload.headers, { 'X-Version': '2' });
    assert.equal(persisted.vocalReference.upload.expiresInSeconds, 7200);
    change('uploadHeaders', '{bad');
    assert.match(mediaTemplateProblem('en', { kind: 'music', vocalReference: value }), /Vocal reference/);
    assert.ok(descendants(tree()).some(node => node.props.role === 'alert'));
    change('uploadHeaders', '{}');
    assert.equal(mediaTemplateProblem('en', { kind: 'music', vocalReference: value }), undefined);
    change('expires', '');
    assert.equal(normalizeMediaTemplate({ kind: 'music', vocalReference: value }).vocalReference.upload.expiresInSeconds, undefined);
    change('vocalReference', 'base64');
    assert.deepEqual(normalizeMediaTemplate({ kind: 'music', vocalReference: value }).vocalReference, { mode: 'base64' });
    change('vocalReference', 'url');
    assert.deepEqual(normalizeMediaTemplate({ kind: 'music', vocalReference: value }).vocalReference, { mode: 'url' });
    change('vocalReference', '');
    assert.equal(value, undefined);
    assert.equal(normalizeMediaTemplate({ kind: 'music', vocalReference: value }).vocalReference, undefined);
});

test('disabled connection editor disables every audio delivery and upload control', () => {
    const tree = MediaTemplateAudioFields({ locale: 'en', disabled: true, input: 'referenceSong', value: { mode: 'upload', upload }, onChange() {} });
    const controls = descendants(tree).filter(node => node.type === 'input' || node.type === 'select' || node.props.onChange);
    assert.ok(controls.length >= 8);
    assert.ok(controls.every(node => node.props.disabled === true));
});

test('template field validation uses stable parameters even when the diagnostic prose changes language', () => {
    const engine = require('@nextmux/model-runtime/media-template');
    const original = engine.normalizeMediaTemplate;
    try {
        for (const locale of locales) {
            const expected = mediaTemplateProblem(locale, { kind: 'music', vocalReference: { mode: 'invalid' } });
            for (const message of ['poll path is invalid', '字段错误', 'Erreur de validation', '']) {
                engine.normalizeMediaTemplate = () => { throw Object.assign(new Error(message), {
                    code: 'media_template_invalid', messageKey: 'media_template.invalid', params: { field: 'vocalReference.upload.path', reason: 'invalid_path' }
                }); };
                assert.equal(mediaTemplateProblem(locale, {}), expected, `${locale}: parameters override unrelated diagnostic prose`);
            }
            engine.normalizeMediaTemplate = original;
        }
        engine.normalizeMediaTemplate = () => { throw new Error('vocalReference upload path is invalid'); };
        for (const locale of locales) assert.ok(!mediaTemplateProblem(locale, {}).includes(musicTemplateText(locale, 'vocalReference')), `${locale}: untyped prose cannot select a field`);
    } finally { engine.normalizeMediaTemplate = original; }
});

test('media template fixed field labels render in every locale from structured errors', () => {
    const engine = require('@nextmux/model-runtime/media-template');
    const original = engine.normalizeMediaTemplate;
    try {
        for (const locale of locales) for (const field of ['submit.path', 'poll.path', 'downloadPath', 'submit.body', 'poll.body', 'idField', 'statusField', 'resultField', 'errorField', 'pollUrlField', 'resultUrlField', 'headers', 'auth', 'images', 'kind', 'method', 'referenceAspect']) {
            engine.normalizeMediaTemplate = () => { throw Object.assign(new Error('unrelated diagnostic'), { code: 'media_template_invalid', params: { field } }); };
            const text = mediaTemplateProblem(locale, {});
            assert.ok(text.includes('：'), `${locale}/${field}`);
            assert.ok(!text.includes('unrelated diagnostic'));
            if (!['zh-CN', 'zh-TW', 'ja'].includes(locale)) assert.doesNotMatch(text, /\p{Script=Han}/u, `${locale}/${field}`);
        }
    } finally { engine.normalizeMediaTemplate = original; }
});
