import assert from 'node:assert/strict';
import test from 'node:test';
import { comicCutLanes } from '../lib/browser/nextmux-comic-cut.js';

const clip = (shotId, start, duration, audio) => ({ shotId, sceneId: 'scene', title: shotId, start, duration, index: 0, audio });

test('music placed over several shots is one bar that ends where the file ends', () => {
    // A 6.03 s piece over three 3 s shots: it starts at 0, 3 and 6 s into the file.
    const music = (start, length) => [{ key: `music:m:${start}`, assetId: 'm', role: 'music', url: 'x', start, length, title: 'music' }];
    const lanes = comicCutLanes([clip('a', 0, 3, music(0, 6.03)), clip('b', 3, 3, music(3, 3.03)), clip('c', 6, 3, music(6, 0.03))]);
    assert.equal(lanes.music.length, 1);
    assert.deepEqual(lanes.music[0].shotIds, ['a', 'b', 'c']);
    assert.ok(Math.abs(lanes.music[0].duration - 6.03) < 1e-9, `ends with the file, not the last shot: ${lanes.music[0].duration}`);
});

test('a sound of unknown length lasts its shot; one that already ended is not drawn', () => {
    const voice = [{ key: 'audio:v', assetId: 'v', role: 'audio', url: 'x', start: 0 }];
    const ended = [{ key: 'effect:e', assetId: 'e', role: 'effect', url: 'x', start: 5, length: 0 }];
    const lanes = comicCutLanes([clip('a', 0, 4, [...voice, ...ended])]);
    assert.equal(lanes.audio[0].duration, 4);
    assert.equal(lanes.effect.length, 0);
    // A short voice line stops early; the next shot's line is a separate bar.
    const short = comicCutLanes([clip('a', 0, 4, [{ ...voice[0], length: 1.5 }]), clip('b', 4, 4, [{ ...voice[0], key: 'audio:w', assetId: 'w', length: 2 }])]);
    assert.deepEqual(short.audio.map(item => [item.start, item.duration]), [[0, 1.5], [4, 2]]);
});
