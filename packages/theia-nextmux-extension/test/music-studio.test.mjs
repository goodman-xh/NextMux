import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defaultMusicSettings, musicCoverPrompt, musicLyricsInstructions, musicSongPrompt, musicText } from '../lib/browser/nextmux-music-studio.js';

const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');

test('the song prompt follows the sound settings and never asks for vocals on an instrumental', () => {
    const song = musicSongPrompt(defaultMusicSettings({ genre: 'folk', mood: 'warm', length: 'clip', style: 'acoustic guitar, harmonica' }), '灯塔来信');
    assert.match(song, /^A 30-second /);
    assert.doesNotMatch(song, /灯塔来信|Title:/);
    assert.match(song, /acoustic guitar, harmonica/);
    const instrumental = musicSongPrompt(defaultMusicSettings({ instrumental: true, vocals: 'female', language: 'zh' }));
    assert.match(instrumental, /instrumental piece/);
    assert.doesNotMatch(instrumental, /Sung by/);
});

test('the cover prompt leaves out section tags and asks for no text', () => {
    const cover = musicCoverPrompt(defaultMusicSettings({ lyrics: '[Verse]\n海风吹过灯塔\n[Chorus]\n等你回来' }), 'Lighthouse', '1:1');
    assert.match(cover, /海风吹过灯塔 \/ 等你回来/);
    assert.doesNotMatch(cover, /\[Verse\]|\[Chorus\]/);
    assert.match(cover, /No text/);
    assert.match(cover, /1:1 frame/);
});

test('AI 写词 saves through comic.write_lyrics and keeps the current lyrics as a starting point', () => {
    const brief = musicLyricsInstructions({ theme: '夜班电台', settings: defaultMusicSettings({ length: 'full' }), title: '', appLanguage: 'Chinese', current: '[Verse]\n旧歌词' });
    assert.match(brief, /comic\.write_lyrics/);
    assert.match(brief, /Language: Chinese/);
    assert.match(brief, /旧歌词/);
});

test('every music string exists in every shipped locale', () => {
    for (const locale of LOCALES) {
        for (const key of ['createTitle', 'lyrics', 'songTitle', 'outputTitle', 'audioButton', 'videoButton', 'needSong']) {
            const value = musicText(locale, key);
            assert.ok(value && value !== key, `${locale}.${key}`);
            if (locale !== 'zh-CN' && locale !== 'zh-TW' && locale !== 'ja') assert.doesNotMatch(value, /[\p{Script=Han}]/u, `${locale}.${key}`);
        }
    }
});

test('a music project picks its models in the AI 模型 panel and exports from its last step', () => {
    // Models: the song and cover use the step choice (never a picker of their own).
    assert.match(widget, /protected async musicGenerate\(\)[\s\S]*?this\.comicStepMediaRoute\('music'\)/);
    assert.match(widget, /protected async musicGenerateCover\(\)[\s\S]*?this\.comicStepMediaRoute\('image'\)/);
    assert.match(widget, /if \(kind === 'music'\) return \[\['lyrics', 'stepLyrics'\], \['song', 'stepSong'\], \['mv', 'stepGenerate'\], \['output', 'stepOutput'\]\];/);
    // The header has no second export button for a song.
    assert.match(widget, /\{project && !music && !deskHome && view !== 'timeline' && <button className='nmx-studio-export'/);
    // A finished take becomes the chosen version.
    assert.match(widget, /this\.syncComicSelection\(\);\n\s+this\.reconcileMusicSong\(\);/);
});
