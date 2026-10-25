import assert from 'node:assert/strict';
import test from 'node:test';
import { comicChatLooksConversational } from '../lib/browser/nextmux-comic-chat-intent.js';
import { normalizeComicChat } from '../lib/common/nextmux-comic-chat.js';

test('a media-mode message that is not a description is answered as conversation (round 33: "1" started a video)', () => {
    for (const prompt of ['1', ' 12 ', '?', '？？', '你好', '您好！', 'hi', 'Thanks!', '好的', '嗯', '怎么用', '你能做什么？', 'what can you do', 'ok', '猫'])
        assert.equal(comicChatLooksConversational(prompt, false), true, prompt);
    for (const prompt of ['一只橘猫在窗台上晒太阳', '海边灯塔，暴风雨夜，镜头缓慢推近', 'a red fox running through snow', '欢快', '赛博朋克城市夜景'])
        assert.equal(comicChatLooksConversational(prompt, false), false, prompt);
    assert.equal(comicChatLooksConversational('1', true), false, 'a reference picture with a short instruction is a real request');
});

test('a diverted turn keeps the mode the user was in; other turns cannot claim it', () => {
    const base = { schemaVersion: 1, id: 'chat-0f0e3c9a-6b1e-4d7a-9f6e-2a1b3c4d5e6f', projectId: 'project-qa-r33-lighthouse', title: 't', createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z' };
    const turn = (extra) => ({ id: 'turn-0f0e3c9a-6b1e-4d7a-9f6e-2a1b3c4d5e6f', prompt: '1', references: [], params: {}, jobIds: [], createdAt: '2026-09-30T00:00:00.000Z', ...extra });
    assert.equal(normalizeComicChat({ ...base, turns: [turn({ mode: 'agent', from: 'video' })] }).turns[0].from, 'video');
    assert.equal(normalizeComicChat({ ...base, turns: [turn({ mode: 'video', from: 'image' })] }).turns[0].from, undefined);
    assert.equal(normalizeComicChat({ ...base, turns: [turn({ mode: 'agent', from: 'agent' })] }).turns[0].from, undefined);
});
