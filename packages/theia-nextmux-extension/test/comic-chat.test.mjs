import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import {
    comicChatJobOrigin, comicChatJobTarget, comicChatTitleFrom, extractComicChatThinking, normalizeComicChat, parseComicChatProposals, comicChatAspectOf, comicChatSize
} from '../lib/common/nextmux-comic-chat.js';

const CHAT = 'chat-0f8e7d6c-5b4a-4321-9876-0123456789ab';
const TURN = 'turn-1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const now = '2026-09-29T08:00:00.000Z';
let counter = 0;
const proposalId = () => `proposal-00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

function chat(projectId, turns = []) {
    return { schemaVersion: 1, id: CHAT, projectId, title: '老屋开场', createdAt: now, updatedAt: now, turns };
}

test('chat jobs use a reserved address that storyboard IDs can never take', () => {
    const target = comicChatJobTarget(CHAT, TURN);
    assert.deepEqual(target, { sceneId: `scene-${CHAT}`, shotId: `shot-${TURN}` });
    assert.match(target.sceneId, /^scene-[A-Za-z0-9][A-Za-z0-9-]{7,95}$/, 'media-core accepts the scene ID');
    assert.match(target.shotId, /^shot-[A-Za-z0-9][A-Za-z0-9-]{7,95}$/, 'media-core accepts the shot ID');
    assert.deepEqual(comicChatJobOrigin(target.sceneId, target.shotId), { chatId: CHAT, turnId: TURN });
    // Real IDs are scene-<uuid>: hex digits never spell “chat” / “turn”.
    assert.equal(comicChatJobOrigin('scene-0f8e7d6c-5b4a-4321-9876-0123456789ab', 'shot-1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d'), undefined);
    assert.equal(comicChatJobOrigin(`scene-${CHAT}`, 'shot-1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d'), undefined);
    assert.throws(() => comicChatJobTarget('chat-x', TURN));
});

test('a thumbs up or down on an agent reply is kept along with managed relayRequestIds; anything else is dropped', () => {
    const agent = { id: TURN, mode: 'agent', prompt: '分镜怎么改', references: [], params: {}, jobIds: [], reply: '先拉近景', createdAt: now };
    assert.equal(normalizeComicChat(chat('project-12345678', [{ ...agent, feedback: 'up' }])).turns[0].feedback, 'up');
    assert.equal(normalizeComicChat(chat('project-12345678', [{ ...agent, feedback: 'down' }])).turns[0].feedback, 'down');
    assert.equal(normalizeComicChat(chat('project-12345678', [{ ...agent, feedback: 'meh' }])).turns[0].feedback, undefined);
    assert.deepEqual(normalizeComicChat(chat('project-12345678', [{ ...agent, relayRequestIds: ['req-1', 'req-2', 'req-1', '../bad'] }])).turns[0].relayRequestIds, ['req-1', 'req-2']);
    // A generation turn has no reply to rate.
    assert.equal(normalizeComicChat(chat('project-12345678', [{ ...agent, mode: 'image', reply: undefined, params: { aspect: '1:1', count: 1 }, feedback: 'up', relayRequestIds: ['req-1'] }])).turns[0].feedback, undefined);
    assert.equal(normalizeComicChat(chat('project-12345678', [{ ...agent, mode: 'image', reply: undefined, params: { aspect: '1:1', count: 1 }, feedback: 'up', relayRequestIds: ['req-1'] }])).turns[0].relayRequestIds, undefined);
});

test('chat frame sizes match new project canvases (plus upright 3:4)', () => {
    assert.deepEqual(comicChatSize('16:9'), { width: 1920, height: 1080 });
    assert.deepEqual(comicChatSize('3:4'), { width: 1080, height: 1440 });
    assert.equal(comicChatAspectOf(1080, 1920), '9:16');
    assert.equal(comicChatAspectOf(1000, 1000), undefined);
});

test('a conversation is checked field by field and loses unknown fields', () => {
    const value = chat('project-12345678', [{ id: TURN, mode: 'image', prompt: '屋顶上的橘猫', references: [], params: { aspect: '1:1', count: 2 }, jobIds: [],
        thinking: '构思橘猫角度', thinkingDurationMs: 4250.4,
        createdAt: now, extra: 'dropped', model: { key: 'managed:m::r', routeId: 'r', model: 'img', label: 'Img', source: 'Relay' } }]);
    const normalized = normalizeComicChat(value);
    assert.equal(normalized.turns[0].extra, undefined);
    assert.equal(normalized.turns[0].thinking, '构思橘猫角度');
    assert.equal(normalized.turns[0].thinkingDurationMs, 4250);
    assert.deepEqual(normalized.turns[0].params, { aspect: '1:1', count: 2 });
    assert.throws(() => normalizeComicChat({ ...value, id: 'chat-1' }), /COMIC_CHAT_INVALID/);
    assert.throws(() => normalizeComicChat(chat('project-12345678', [{ ...value.turns[0], params: { count: 9 } }])), /PARAMS/);
    assert.throws(() => normalizeComicChat(chat('project-12345678', [{ ...value.turns[0], mode: 'dance' }])), /TURN/);
    assert.throws(() => normalizeComicChat(chat('project-12345678', [{ ...value.turns[0], jobIds: ['../../etc'] }])), /JOBS/);
    assert.throws(() => normalizeComicChat(chat('project-12345678', [value.turns[0], value.turns[0]])), /TURNS/, 'turn IDs are unique');
});

test('agent suggestions come from one fenced block; a broken block suggests nothing', () => {
    const reply = '我拆成了两个镜头。\n```nextmux-generate\n[{"kind":"image","title":"老屋","prompt":"破败老屋，晨光","aspect":"16:9"},{"kind":"video","prompt":"推镜","seconds":6.4},{"kind":"hologram","prompt":"x"},{"kind":"voice","prompt":"旁白"}]\n```\n可以先出图。';
    const parsed = parseComicChatProposals(reply, proposalId);
    assert.equal(parsed.text, '我拆成了两个镜头。\n\n可以先出图。');
    assert.deepEqual(parsed.proposals.map(item => [item.kind, item.aspect, item.seconds]), [['image', '16:9', undefined], ['video', undefined, 6], ['speech', undefined, undefined]]);
    assert.match(parsed.proposals[0].id, /^proposal-/);
    assert.deepEqual(parseComicChatProposals('```nextmux-generate\n{oops\n```', proposalId).proposals, []);
    assert.equal(parseComicChatProposals('只是聊天', proposalId).text, '只是聊天');

    // Reasoning models with <think> blocks (including draft fences inside <think>), trailing commas and 3:4 video aspect normalization.
    const reasoned = '<think>草稿：\n```nextmux-generate\n[{"kind":"image","prompt":"草稿不应被匹配"}]\n```\n再想一下。</think>\n这是正式分镜建议：\n```nextmux-generate\n[\n  {"kind":"video","title":"竖屏特写","prompt":"雨夜推镜\n霓虹闪烁","aspect":"3:4","seconds":5,}\n]\n```';
    const parsedReasoned = parseComicChatProposals(reasoned, proposalId);
    assert.equal(parsedReasoned.text, '这是正式分镜建议：');
    assert.match(parsedReasoned.thinking || '', /草稿/);
    assert.equal(parsedReasoned.proposals.length, 1);
    assert.equal(parsedReasoned.proposals[0].kind, 'video');
    assert.equal(parsedReasoned.proposals[0].aspect, '9:16', '3:4 video proposal normalizes to 9:16');
    assert.equal(parsedReasoned.proposals[0].prompt, '雨夜推镜\n霓虹闪烁');

    // Unopened </think> prefix from prompt-template reasoning gateways and unclosed trailing nextmux-generate fence during streaming.
    const unopened = extractComicChatThinking('先构思角色站位与灯光。</think>\n正式回复内容。\n```nextmux-generate\n[{"kind":"image","prompt":"未闭合流式块"');
    assert.equal(unopened.thinking, '先构思角色站位与灯光。');
    assert.equal(unopened.text, '正式回复内容。');
});

test('a conversation title is the first line of the first request', () => {
    assert.equal(comicChatTitleFrom('\n  做一只橘猫在屋顶看烟花的视频\n第二行'), '做一只橘猫在屋顶看烟花的视频');
    assert.equal(Array.from(comicChatTitleFrom('一'.repeat(60))).length, 29);
});

async function fixture(t) {
    const base = await mkdtemp(join(tmpdir(), 'nextmux-comic-chat-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const workspaceRoot = join(base, 'project');
    await mkdir(workspaceRoot);
    class Fixture extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return join(base, 'profile'); }
        async getMediaRuntimeState() {
            return { ffmpeg: { available: false, source: 'missing', message: '' }, comfyUi: { configured: false, available: false, source: 'missing', message: '' } };
        }
    }
    const service = new Fixture();
    const state = await service.createComicProject({ workspaceRoot, title: 'Chat test', starter: 'empty', frameRate: 24,
        canvas: { aspectRatio: '16:9', width: 1920, height: 1080 } });
    return { base, workspaceRoot, service, project: state.project };
}

test('conversations are saved in the project folder, listed newest first, and belong to that project', async t => {
    const { base, workspaceRoot, service, project } = await fixture(t);
    assert.deepEqual(await service.listComicChats(workspaceRoot), [], 'no folder until the first save');
    const saved = await service.saveComicChat(workspaceRoot, chat(project.id, [{ id: TURN, mode: 'agent', prompt: '帮我设计开场', references: [], params: {}, jobIds: [], createdAt: now }]));
    assert.equal(saved.turnCount, 1);
    const folder = join(workspaceRoot, 'nextmux.chats');
    assert.deepEqual(await readdir(folder), [`${CHAT}.json`], 'no temporary file is left behind');
    assert.equal((await stat(join(folder, `${CHAT}.json`))).mode & 0o777, 0o600);
    const second = 'chat-11111111-2222-4333-8444-555555555555';
    await service.saveComicChat(workspaceRoot, { ...chat(project.id), id: second, title: '第二个', updatedAt: '2026-09-29T09:00:00.000Z' });
    assert.deepEqual((await service.listComicChats(workspaceRoot)).map(item => item.id), [second, CHAT]);
    assert.equal((await service.readComicChat(workspaceRoot, CHAT)).turns[0].prompt, '帮我设计开场');

    await assert.rejects(service.saveComicChat(workspaceRoot, chat('project-00000000-other')), /project|工程|changed/i, 'another project’s conversation is refused');
    await assert.rejects(service.saveComicChat(workspaceRoot, { ...chat(project.id), turns: 'x' }), /对话内容无效/);
    await assert.rejects(service.readComicChat(workspaceRoot, '../nextmux.comic'), /对话不存在/);
    // A foreign file in the folder is ignored, not trusted.
    await writeFile(join(folder, 'chat-99999999-9999-4999-8999-999999999999.json'), JSON.stringify({ ...chat('project-someone-else'), id: 'chat-99999999-9999-4999-8999-999999999999' }));
    assert.equal((await service.listComicChats(workspaceRoot)).length, 2);

    const plain = join(base, 'plain');
    await mkdir(plain);
    await assert.rejects(service.listComicChats(plain), /project|工程|不存在|missing/i, 'only a comic project folder holds conversations');
});

test('a symlinked conversation folder is refused', async t => {
    const { base, workspaceRoot, service, project } = await fixture(t);
    const elsewhere = join(base, 'elsewhere');
    await mkdir(elsewhere);
    await symlink(elsewhere, join(workspaceRoot, 'nextmux.chats'));
    await assert.rejects(service.saveComicChat(workspaceRoot, chat(project.id)), /对话文件夹不可用/);
});

test('chat generations are checked against the model, not a shot', async t => {
    const { workspaceRoot, service, project } = await fixture(t);
    const target = comicChatJobTarget(CHAT, TURN);
    const job = (kind, input, billing = 'platform_billed') => ({ idempotencyKey: `k-${Math.random()}`, kind, projectId: project.id, ...target, input,
        cost: { billing, description: 'test' } });
    const image = { connectionId: 'managed:relay-a', model: 'relay/image', prompt: '橘猫', width: 1920, height: 1080 };
    await service.validateMediaJobAgainstProject(workspaceRoot, job('image', image));
    await assert.rejects(service.validateMediaJobAgainstProject(workspaceRoot, job('image', { ...image, width: 1000, height: 1000 })), error => error.code === 'INVALID_MEDIA_REQUEST');
    await assert.rejects(service.validateMediaJobAgainstProject(workspaceRoot, job('image', image, 'provider_billed')), error => error.code === 'COST_CONFIRMATION_REQUIRED');
    await assert.rejects(service.validateMediaJobAgainstProject(workspaceRoot, job('image', { ...image, characterReferenceUris: ['nextmux.media/missing.png'] })),
        error => error.code === 'MEDIA_REFERENCE_MISSING');

    const video = { connectionId: 'managed:relay-a', model: 'google/veo-3.1', prompt: '推镜', width: 1920, height: 1080, durationSeconds: 8 };
    await service.validateMediaJobAgainstProject(workspaceRoot, job('video', video));
    await assert.rejects(service.validateMediaJobAgainstProject(workspaceRoot, job('video', { ...video, durationSeconds: 7 })), error => error.code === 'STALE_MEDIA_REQUEST');
    await assert.rejects(service.validateMediaJobAgainstProject(workspaceRoot, job('video', { ...video, width: 1440, height: 1080 })), error => error.code === 'INVALID_MEDIA_REQUEST',
        '4:3 is for pictures only');

    const music = { connectionId: 'managed:relay-a', model: 'relay/music', prompt: '温暖的钢琴', durationSeconds: 30, format: 'mp3', instrumental: true };
    await service.validateMediaJobAgainstProject(workspaceRoot, job('music', music));
    await assert.rejects(service.validateMediaJobAgainstProject(workspaceRoot, job('music', { ...music, mode: 'cover' })), error => error.code === 'MUSIC_CAPABILITY_UNSUPPORTED');
    await assert.rejects(service.validateMediaJobAgainstProject(workspaceRoot, job('subtitle', { frameRate: 24, cues: [] }, 'free')), error => error.code === 'INVALID_MEDIA_REQUEST');

    // A storyboard address still needs its shot.
    await assert.rejects(service.validateMediaJobAgainstProject(workspaceRoot, { ...job('image', image), sceneId: 'scene-0f8e7d6c-5b4a-4321-9876-0123456789ab', shotId: 'shot-1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d' }),
        error => error.code === 'SHOT_NOT_FOUND');
});

test('a finished chat generation joins the material library without touching any shot', async t => {
    const { workspaceRoot, service, project } = await fixture(t);
    const jobId = 'media-job-5d8e3f7a-1b2c-4d3e-8f9a-0b1c2d3e4f5a';
    const output = { assetId: `asset-${jobId.slice('media-job-'.length)}`, assetKind: 'image', relativeUri: `nextmux.media/${jobId}.png`, mimeType: 'image/png',
        byteLength: 10, sha256: 'a'.repeat(64), provider: 'Relay', model: 'relay/image', prompt: '橘猫' };
    const job = { id: jobId, kind: 'image', projectId: project.id, ...comicChatJobTarget(CHAT, TURN) };
    const before = JSON.stringify(project.scenes);
    await service.attachMediaCheckpoint(workspaceRoot, job, output);
    await service.attachMediaCheckpoint(workspaceRoot, job, output);
    const after = (await service.getComicProject(workspaceRoot)).project;
    assert.deepEqual(after.assets.filter(asset => asset.id === output.assetId).map(asset => [asset.kind, asset.source, asset.jobId]), [['image', 'generated', jobId]], 'imported once');
    assert.equal(JSON.stringify(after.scenes), before);
    await assert.rejects(service.attachMediaCheckpoint(workspaceRoot, job, { ...output, sha256: 'b'.repeat(64) }), error => error.code === 'STALE_MEDIA_REQUEST');
});

async function libraryFixture(t) {
    const base = await mkdtemp(join(tmpdir(), 'nextmux-comic-folders-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const library = join(base, 'library');
    class Fixture extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return join(base, 'profile'); }
        comicLibraryRoot() { return library; }
        async getMediaRuntimeState() {
            return { ffmpeg: { available: false, source: 'missing', message: '' }, comfyUi: { configured: false, available: false, source: 'missing', message: '' } };
        }
        bundledFfmpegPath() { return undefined; }
    }
    return { base, library, service: new Fixture() };
}

test('对话模式: a picked folder becomes a conversation folder; a project of the four kinds and the library are left alone', async t => {
    const { base, library, service } = await libraryFixture(t);
    const folder = join(base, '城市夜雨短片');
    await mkdir(folder);
    await writeFile(join(folder, 'notes.txt'), 'the user’s own file');
    const opened = await service.openComicChatFolder(folder, 'zh-CN');
    assert.deepEqual([opened.status, opened.name, opened.projectKind, opened.managed], ['chat', '城市夜雨短片', 'chat', undefined]);
    assert.equal((await service.getComicProject(folder)).project.projectKind, 'chat');
    assert.deepEqual((await service.openComicChatFolder(folder)).status, 'chat', 'opening it again keeps it');
    assert.ok((await readdir(folder)).includes('notes.txt'), 'nothing of the user’s is touched');

    // A 小说转漫剧 project is reported, not turned into a conversation folder.
    const novel = join(base, 'novel');
    await mkdir(novel);
    await service.createComicProject({ workspaceRoot: novel, title: '故乡', starter: 'empty', frameRate: 24, canvas: { aspectRatio: '16:9', width: 1920, height: 1080 } });
    const comic = await service.openComicChatFolder(novel);
    assert.deepEqual([comic.status, comic.projectKind, comic.title], ['comic', 'novel', '故乡']);
    assert.equal((await service.getComicProject(novel)).project.projectKind, undefined);

    await mkdir(library, { recursive: true });
    await assert.rejects(service.openComicChatFolder(library), error => error.code === 'COMIC_CHAT_FOLDER_LIBRARY');
    await mkdir(join(library, 'inside'));
    await assert.rejects(service.openComicChatFolder(join(library, 'inside')), error => error.code === 'COMIC_CHAT_FOLDER_LIBRARY');
    await assert.rejects(service.openComicChatFolder('relative/path'), error => error.code === 'COMIC_CHAT_FOLDER_INVALID');
    await assert.rejects(service.openComicChatFolder(join(folder, 'notes.txt')), error => error.code === 'COMIC_CHAT_FOLDER_INVALID');

    // Without a folder: the app's own folder in the library, hidden from the four kinds.
    const managed = await service.openComicChatFolder();
    assert.deepEqual([managed.status, managed.managed, managed.path], ['chat', true, join(library, '.chats')]);
    const listed = await service.listComicLibrary([folder, novel]);
    assert.deepEqual(listed.projects.map(item => item.path), [novel], 'conversation folders never show under the four kinds');

    const missing = join(base, 'moved-away');
    assert.deepEqual((await service.comicChatFolders([folder, missing, managed.path])).map(item => [item.name, item.status, Boolean(item.managed)]),
        [['城市夜雨短片', 'chat', false], ['moved-away', 'missing', false], ['', 'chat', true]]);
});

test('全部素材 lists the ready pictures, clips and sounds of each project, named for the edit', async t => {
    const { base, service } = await libraryFixture(t);
    const folder = join(base, 'folder');
    await mkdir(folder);
    await service.openComicChatFolder(folder);
    const jobId = 'media-job-5d8e3f7a-1b2c-4d3e-8f9a-0b1c2d3e4f5a';
    const project = (await service.getComicProject(folder)).project;
    await service.attachMediaCheckpoint(folder, { id: jobId, kind: 'image', projectId: project.id, ...comicChatJobTarget(CHAT, TURN) }, {
        assetId: `asset-${jobId.slice('media-job-'.length)}`, assetKind: 'image', relativeUri: `nextmux.media/${jobId}.png`, mimeType: 'image/png',
        byteLength: 10, sha256: 'a'.repeat(64), provider: 'Relay', model: 'relay/image', prompt: '雨夜街口，霓虹倒影' });
    const [materials] = await service.listComicMaterials([folder, join(base, 'not-a-project')]);
    assert.equal(materials.projectKind, 'chat');
    assert.equal(materials.name, 'folder');
    assert.deepEqual(materials.assets.map(asset => [asset.kind, asset.title, asset.jobId, asset.uri]), [['image', '雨夜街口，霓虹倒影', jobId, `nextmux.media/${jobId}.png`]]);
});

test('a conversation summary names the jobs and pictures that make up its materials', async t => {
    const { workspaceRoot, service, project } = await fixture(t);
    const job = 'media-job-11111111-2222-4333-8444-555555555555', proposed = 'media-job-66666666-7777-4888-9999-000000000000';
    const summary = await service.saveComicChat(workspaceRoot, chat(project.id, [{ id: TURN, mode: 'agent', prompt: '开场', references: ['asset-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'], params: {},
        jobIds: [job], reply: '好', proposals: [{ id: proposalId(), kind: 'image', title: '开场', prompt: '雨夜', jobIds: [proposed] }], createdAt: now }]));
    assert.deepEqual([summary.jobIds, summary.references], [[job, proposed], ['asset-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee']]);
});

test('素材库 keeps what the user adds (newest first), per folder, only existing materials, and flags them in 全部素材', async t => {
    const { base, service } = await libraryFixture(t);
    const folder = join(base, 'folder');
    await mkdir(folder);
    await service.openComicChatFolder(folder);
    const project = (await service.getComicProject(folder)).project;
    const ids = [];
    for (const [index, prompt] of ['晨雾里的渡口', '穿红雨衣的女孩'].entries()) {
        const jobId = `media-job-5d8e3f7a-1b2c-4d3e-8f9a-0b1c2d3e4f5${index}`;
        await service.attachMediaCheckpoint(folder, { id: jobId, kind: 'image', projectId: project.id, ...comicChatJobTarget(CHAT, TURN) }, {
            assetId: `asset-${jobId.slice('media-job-'.length)}`, assetKind: 'image', relativeUri: `nextmux.media/${jobId}.png`, mimeType: 'image/png',
            byteLength: 10, sha256: String(index).repeat(64), provider: 'Relay', model: 'relay/image', prompt });
        ids.push(`asset-${jobId.slice('media-job-'.length)}`);
    }
    assert.deepEqual(await service.comicMaterialLibrary(folder), [], 'empty until something is kept');
    assert.deepEqual(await service.updateComicMaterialLibrary(folder, { add: [ids[0]] }), [ids[0]]);
    // Several quick adds (the fly-in animations of two tiles) are applied one after another, none lost.
    await Promise.all([service.updateComicMaterialLibrary(folder, { add: [ids[1]] }), service.updateComicMaterialLibrary(folder, { add: ['asset-unknown'] })]);
    assert.deepEqual(await service.comicMaterialLibrary(folder), [ids[1], ids[0]], 'newest first; unknown IDs are ignored');
    assert.deepEqual(await service.updateComicMaterialLibrary(folder, { add: [ids[0]] }), [ids[0], ids[1]], 'adding again moves it to the front');
    const [listed] = await service.listComicMaterials([folder]);
    assert.deepEqual(listed.assets.map(asset => asset.library === true), [true, true]);
    assert.deepEqual(await service.updateComicMaterialLibrary(folder, { remove: [ids[0]] }), [ids[1]]);
    // A library file copied in from another project is not this folder's.
    const other = join(base, 'other');
    await mkdir(other);
    await service.openComicChatFolder(other);
    await mkdir(join(other, 'nextmux.chats'), { recursive: true });
    await writeFile(join(other, 'nextmux.chats', 'library.json'), await (await import('node:fs/promises')).readFile(join(folder, 'nextmux.chats', 'library.json')));
    assert.deepEqual(await service.comicMaterialLibrary(other), []);
});

test('制作台 renders collapsible thinking disclosure when reasoning trace is present and auto-collapses when complete', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const core = createRequire(require.resolve('@theia/core/package.json'));
    const React = core('react');
    const { renderToStaticMarkup } = core('react-dom/server');
    const { ComicDesk } = require('../lib/browser/nextmux-comic-desk.js');
    const baseProps = {
        locale: 'zh-CN', step: 'canvas', projectTitle: 'Test', reachable: new Set(['canvas', 'edit']),
        episodes: [], focusEpisode: 0, focusClip: 0, cards: [], focusCard: 0, library: [],
        stopped: false, shooting: false, paused: false, splitting: false, adapting: false, canShoot: false,
        onStep() {}, onFocusEpisode() {}, onFocusClip() {}, onFocusCard() {}, onScriptChange() {},
        onRegenerateScripts() {}, onScriptsNext() {}, onStartNow() {}, onStop() {}, onBind() {},
        onUpload() {}, onRedraw() {}, onRetrySplit() {}, onShoot() {}, onPause() {}, onResume() {},
        onRegenerateClip() {}, onReshootEpisode() {}, onRetryFailed() {}, onMinimize() {}
    };
    const withoutThinking = renderToStaticMarkup(React.createElement(ComicDesk, baseProps));
    assert.equal(withoutThinking.includes('nmx-desk-thinking'), false);

    const streamingHtml = renderToStaticMarkup(React.createElement(ComicDesk, {
        ...baseProps, adapting: true, thinking: '正在拆解第一幕与人物关系', thinkingStreaming: true, thinkingDurationMs: 3400
    }));
    assert.equal(streamingHtml.includes('nmx-desk-thinking'), true);
    assert.equal(streamingHtml.includes('open=""'), true);
    assert.equal(streamingHtml.includes('正在构思…'), true);
    assert.equal(streamingHtml.includes('3.4 秒'), true);
    assert.equal(streamingHtml.includes('正在拆解第一幕与人物关系'), true);

    const finishedHtml = renderToStaticMarkup(React.createElement(ComicDesk, {
        ...baseProps, adapting: false, thinking: '已完成分镜拆解', thinkingStreaming: false, thinkingDurationMs: 5200
    }));
    assert.equal(finishedHtml.includes('nmx-desk-thinking'), true);
    assert.equal(finishedHtml.includes('open=""'), false);
    assert.equal(finishedHtml.includes('思考过程'), true);
    assert.equal(finishedHtml.includes('5.2 秒'), true);
});
