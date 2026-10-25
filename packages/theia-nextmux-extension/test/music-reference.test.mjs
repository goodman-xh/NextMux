import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { normalizeMediaTemplate } from '@nextmux/model-runtime/media-template';
import { defaultMusicSettings, musicSongPrompt } from '../lib/browser/nextmux-music-studio.js';
import { MUSIC_REFERENCE_LABELS, MusicReferenceFields, musicReferenceProblem, musicReferenceSupport, musicReferenceText } from '../lib/browser/nextmux-music-reference.js';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');

const template = normalizeMediaTemplate({ kind: 'music', vocalReference: { mode: 'base64' }, referenceSong: { mode: 'url' },
    submit: { body: '{"vocal":"{{vocal_reference}}","song":"{{reference_song}}"}' } });
const yes = { vocalReference: true, cover: true };
const asset = { id: 'asset-00000001', status: 'ready', kind: 'music', mimeType: 'audio/wav', uri: 'nextmux.media/imports/voice.wav', durationMs: 15_000 };
const voice = defaultMusicSettings({ vocalSource: 'my_voice', vocalReferenceAssetId: asset.id, vocalReferenceConsent: true });

test('only an executable declared template enables singing or cover, never a model name or unrelated protocol', () => {
    assert.deepEqual(musicReferenceSupport('async_media_template', template), yes);
    assert.deepEqual(musicReferenceSupport('minimax_music', template), { vocalReference: false, cover: false });
    assert.deepEqual(musicReferenceSupport('async_media_template', normalizeMediaTemplate({ kind: 'music' })), { vocalReference: false, cover: false });
    assert.deepEqual(musicReferenceSupport('async_media_template', { ...template, submit: { ...template.submit, body: '{}' } }), { vocalReference: false, cover: false });
    assert.equal(musicReferenceSupport('async_media_template', template, { capabilityDeclarations: {
        vocal_reference: { support: 'unsupported', source: 'provider_metadata', scope: 'model' }
    } }).vocalReference, false);
});

test('song controls reject missing consent, unavailable assets, short or unmeasured vocals and incompatible modes', () => {
    assert.equal(musicReferenceProblem(voice, yes, [asset]), undefined);
    assert.equal(musicReferenceProblem({ ...voice, vocalReferenceConsent: false }, yes, [asset]), 'needConsent');
    assert.equal(musicReferenceProblem(voice, yes, [{ ...asset, durationMs: 14_999 }]), 'duration');
    assert.equal(musicReferenceProblem(voice, yes, [{ ...asset, durationMs: undefined }]), 'unknownDuration');
    assert.equal(musicReferenceProblem(voice, yes, [{ ...asset, mimeType: 'audio/ogg' }]), 'format');
    assert.equal(musicReferenceProblem(voice, yes, []), 'needVoice');
    assert.equal(musicReferenceProblem({ ...voice, instrumental: true }, yes, [asset]), 'incompatible');
    assert.equal(musicReferenceProblem(voice, { ...yes, vocalReference: false }, [asset]), 'unsupported');
    assert.equal(musicReferenceProblem(defaultMusicSettings({ mode: 'cover' }), yes, []), 'needSong');
    assert.equal(musicReferenceProblem(defaultMusicSettings({ mode: 'cover', referenceSongAssetId: asset.id }), yes, [{ ...asset, durationMs: 10_000 }]), undefined);
});

test('reference controls render only available choices and bind authorization to the sample', () => {
    const render = (settings, support) => renderToStaticMarkup(React.createElement(MusicReferenceFields, {
        locale: 'zh-CN', settings, support, assets: [asset], disabled: false, onSettings() {}, onImport() {}
    }));
    assert.doesNotMatch(render(defaultMusicSettings(), { vocalReference: false, cover: false }), /select|checkbox/);
    const changedModel = render(voice, { vocalReference: false, cover: false });
    assert.doesNotMatch(changedModel, /select|checkbox/);
    assert.match(changedModel, /恢复默认模式/);
    const markup = render(voice, yes);
    assert.match(markup, /演唱声音/);
    assert.match(markup, /我的声音/);
    assert.match(markup, /type="checkbox"[^>]*checked/);
    const cover = render(defaultMusicSettings({ mode: 'cover', referenceSongAssetId: asset.id }), yes);
    assert.match(cover, /上传歌曲/);
    assert.doesNotMatch(cover, /type="checkbox"|演唱声音/);
});

test('reference voice overrides the generic singer preset and cover prompt requests restyling', () => {
    const prompt = musicSongPrompt({ ...voice, vocals: 'female' });
    assert.match(prompt, /supplied vocal reference/);
    assert.doesNotMatch(prompt, /female lead vocalist/);
    assert.match(musicSongPrompt(defaultMusicSettings({ mode: 'cover' })), /Restyle the supplied reference song/);
});

test('reference labels cover all twelve shipped locales without fallback', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        for (const key of Object.keys(MUSIC_REFERENCE_LABELS)) {
            const text = musicReferenceText(locale, key);
            assert.ok(text && text !== key, `${locale}.${key}`);
            if (!['zh-CN', 'zh-TW', 'ja'].includes(locale)) assert.doesNotMatch(text, /[\p{Script=Han}]/u);
        }
    }
});
