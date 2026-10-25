import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { ComicCanvasStore } from '../lib/node/nextmux-canvas-store.js';
import { ComicCanvasRegistryStore } from '../lib/node/nextmux-canvas-registry-store.js';
import { createCanvasDocument } from '@nextmux/comic-core';

test('comics live in their own library, one folder per comic, never in a coding project', async t => {
    const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-library-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    class TestPlatformService extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return join(root, 'state'); }
        comicLibraryRoot() { return join(root, 'NextMux Comics'); }
    }
    const service = new TestPlatformService();
    assert.deepEqual(await service.listComicLibrary(), { root: join(root, 'NextMux Comics'), projects: [], folders: [] }, 'a missing library has neither projects nor organizer folders');
    const first = await service.createComicLibraryProject({ title: '雨夜/归人', aspectRatio: '9:16' });
    assert.equal(first.path, join(root, 'NextMux Comics', '雨夜 归人'), 'unsafe characters never reach the folder name');
    assert.equal(first.state.project.canvas.aspectRatio, '9:16');
    assert.equal(first.state.project.canvas.height, 1920);
    const second = await service.createComicLibraryProject({ title: '雨夜/归人' });
    assert.equal(second.path, join(root, 'NextMux Comics', '雨夜 归人 2'), 'same titles get their own folder');
    assert.ok(existsSync(join(second.path, 'nextmux.comic.json')));
    const listed = await service.listComicLibrary();
    assert.equal(listed.projects.length, 2);
    assert.deepEqual(listed.projects.map(item => item.title).sort(), ['雨夜/归人', '雨夜/归人']);
    assert.ok(listed.projects.every(item => item.shotCount === 0 && item.aspectRatio));
});

test('comics opened from folders outside the library are listed with it; other folders are not', async t => {
    const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-library-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    class TestPlatformService extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return join(root, 'state'); }
        comicLibraryRoot() { return join(root, 'NextMux Comics'); }
    }
    const service = new TestPlatformService();
    const outside = join(root, 'Old comic');
    mkdirSync(outside);
    await service.createComicProject({ workspaceRoot: outside, title: '旧漫剧', canvas: { aspectRatio: '16:9', width: 1920, height: 1080 }, frameRate: 24, starter: 'empty', projectKind: 'topic' });
    const empty = join(root, 'Empty folder');
    mkdirSync(empty);
    const listed = await service.listComicLibrary([outside, empty, 'relative/path', outside]);
    assert.deepEqual(listed.projects.map(item => [item.title, item.projectKind]), [['旧漫剧', 'topic']], 'listed once, under its kind; folders without a comic are skipped');
});

test('library counts selected videos across open and closed canvases without duplicating shared assets or old versions', async t => {
    const root = mkdtempSync(join(tmpdir(), 'nextmux-library-canvases-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    class TestPlatformService extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return join(root, 'state'); }
        comicLibraryRoot() { return join(root, 'library'); }
    }
    const service = new TestPlatformService();
    const created = await service.createComicLibraryProject({ title: '自由画布工程' });
    const { path, state: { project } } = created;
    const now = '2026-10-04T00:00:00.000Z';
    const version = (id, status = 'ready') => ({ id: `version-${id}`, assetId: `asset-${id}`, kind: 'video',
        uri: `nextmux.media/${id}.mp4`, status, createdAt: now, metadata: { durationMs: 5000 } });
    const node = (id, versions, current = versions.at(-1)?.id) => ({ id: `node-${id}`, kind: 'videoGen', title: id,
        position: { x: 0, y: 0 }, size: { width: 320, height: 240 }, payload: { mode: 'textToVideo', modelId: 'test-model',
            prompt: 'A video', parameters: {}, versions, ...(current ? { currentVersionId: current } : {}) } });
    const mainStore = new ComicCanvasStore(path);
    const main = await mainStore.save({ ...createCanvasDocument({ id: 'canvas-library-main', projectId: project.id, now }),
        nodes: [node('current', [version('old'), version('current')]), node('pending', [])] }, 0, project.id);
    const originalMain = readFileSync(join(path, 'nextmux.canvas.json'), 'utf8');
    const originalProject = readFileSync(join(path, 'nextmux.comic.json'), 'utf8');
    let summary = (await service.listComicLibrary()).projects[0];
    assert.deepEqual([summary.shotCount, summary.generatedShotCount, summary.durationSeconds, summary.stage], [2, 1, 5, 'progress']);
    assert.equal(existsSync(join(path, 'nextmux.canvases.json')), false, 'home inspection does not initialize the registry');
    const registry = new ComicCanvasRegistryStore(path);
    const entry = (await registry.create(project.id, { title: '共享素材', mainCanvas: main.canvas })).canvases.at(-1);
    const freeStore = new ComicCanvasStore(path, entry.id), free = (await freeStore.read()).canvas;
    await freeStore.save({ ...free, nodes: [node('shared', [version('current')]), node('free', [version('free')]),
        node('missing', [version('previous-ready'), version('missing', 'missing')]), node('uploading', [version('uploading', 'uploading')])] }, free.revision, project.id);
    await registry.setOpen(project.id, entry.id, false);
    const originalRegistry = readFileSync(join(path, 'nextmux.canvases.json'), 'utf8');
    summary = (await service.listComicLibrary()).projects[0];
    assert.deepEqual([summary.shotCount, summary.generatedShotCount, summary.durationSeconds, summary.stage], [5, 2, 10, 'progress']);
    assert.equal(readFileSync(join(path, 'nextmux.canvas.json'), 'utf8'), originalMain);
    assert.equal(readFileSync(join(path, 'nextmux.comic.json'), 'utf8'), originalProject);
    assert.equal(readFileSync(join(path, 'nextmux.canvases.json'), 'utf8'), originalRegistry);
    await registry.prepareDelete(project.id, entry.id);
    summary = (await service.listComicLibrary()).projects[0];
    assert.deepEqual([summary.shotCount, summary.generatedShotCount], [2, 1], 'a retired canvas is excluded even before native Trash finishes');
    const currentMain = (await mainStore.read()).canvas;
    await mainStore.save({ ...currentMain, nodes: currentMain.nodes.filter(item => item.id !== 'node-pending') }, currentMain.revision, project.id);
    summary = (await service.listComicLibrary()).projects[0];
    assert.deepEqual([summary.shotCount, summary.generatedShotCount, summary.stage], [1, 1, 'done']);
});

test('unopened legacy storyboards retain their shot counts and do not acquire canvas files', async t => {
    const root = mkdtempSync(join(tmpdir(), 'nextmux-library-legacy-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    class TestPlatformService extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return join(root, 'state'); }
        comicLibraryRoot() { return join(root, 'library'); }
    }
    const service = new TestPlatformService();
    const created = await service.createComicLibraryProject({ title: '旧分镜', starter: 'storyboard' });
    const summary = (await service.listComicLibrary()).projects[0];
    assert.equal(summary.shotCount, created.state.project.scenes.flatMap(scene => scene.shots).length);
    assert.equal(summary.generatedShotCount, 0);
    assert.equal(existsSync(join(created.path, 'nextmux.canvas.json')), false);
    assert.equal(existsSync(join(created.path, 'nextmux.canvases.json')), false);
});

test('createComicLibraryProject honors custom parentDirectory, avoids folder collisions, and lists custom-location projects on Home', async t => {
    const root = mkdtempSync(join(tmpdir(), 'nextmux-library-custom-dir-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    class TestPlatformService extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return join(root, 'state'); }
        comicLibraryRoot() { return join(root, 'NextMux Comics'); }
    }
    const service = new TestPlatformService();
    const customParent = join(root, 'CustomProjects');
    const first = await service.createComicLibraryProject({ title: '山海志', parentDirectory: customParent, projectKind: 'novel' });
    const second = await service.createComicLibraryProject({ title: '山海志', parentDirectory: customParent, projectKind: 'image' });
    assert.equal(first.path, join(customParent, '山海志'));
    assert.equal(second.path, join(customParent, '山海志 2'));
    const listed = await service.listComicLibrary();
    assert.deepEqual(listed.projects.map(item => item.path).sort(), [first.path, second.path].sort());
});

test('ComicHomeCategories omits new-folder bar and Creation Sheets render location preview, library picker, and image textPicker', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const React = require('react');
    const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
    const {
        ComicHomeCategories,
        ComicImageCreateSheet,
        ComicTopicCreateSheet,
        previewComicProjectFolderPath
    } = await import('../lib/browser/nextmux-comic-kinds.js');
    const { MusicCreateSheet } = await import('../lib/browser/nextmux-music-studio.js');
    const { comicHomeText } = await import('../lib/browser/nextmux-comic-home-text.js');

    for (const locale of ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt-BR', 'ar', 'hi']) {
        assert.ok(comicHomeText(locale, 'openFolder').length > 0, `openFolder exists in ${locale}`);
    }

    assert.equal(
        previewComicProjectFolderPath('/Users/me/NextMux Comics', '星河', '未命名', ['/Users/me/NextMux Comics/星河']),
        '/Users/me/NextMux Comics/星河 2'
    );

    const homeHtml = renderToStaticMarkup(React.createElement(ComicHomeCategories, {
        locale: 'zh-CN',
        kind: 'novel',
        status: 'all',
        projects: [{
            path: '/Users/me/NextMux Comics/星河',
            title: '星河',
            updatedAt: '2026-10-20T00:00:00.000Z',
            aspectRatio: '16:9',
            shotCount: 2,
            generatedShotCount: 1,
            characterCount: 1,
            durationSeconds: 10,
            projectKind: 'novel',
            stage: 'progress'
        }],
        onKind() {},
        onStatus() {},
        onOpen() {},
        onCreate() {},
        onRename() {},
        onDuplicate() {},
        onOpenFolder() {},
        onDelete() {}
    }));
    assert.doesNotMatch(homeHtml, /新建文件夹/, 'New Folder button is removed under the 4 tabs');

    const imageSheetHtml = renderToStaticMarkup(React.createElement(ComicImageCreateSheet, {
        locale: 'zh-CN',
        busy: false,
        defaultDirectory: '/Users/me/NextMux Comics',
        existingProjectPaths: ['/Users/me/NextMux Comics/未命名图片转视频'],
        libraryItems: [{ id: 'lib-1', name: 'hero.png', path: '/lib/hero.png', kind: 'image', thumbUrl: 'file:///lib/hero.png' }],
        textPicker: React.createElement('div', { className: 'test-vision-picker' }, 'Vision Model'),
        videoPicker: React.createElement('div', { className: 'test-video-picker' }, 'Video Model'),
        onCancel() {},
        onCreate() {}
    }));
    assert.match(imageSheetHtml, /本地上传/);
    assert.match(imageSheetHtml, /从素材库挑选/);
    assert.match(imageSheetHtml, /选择文件夹/);
    assert.match(imageSheetHtml, /test-vision-picker/, 'ComicImageCreateSheet renders text/vision model picker');

    const topicSheetHtml = renderToStaticMarkup(React.createElement(ComicTopicCreateSheet, {
        locale: 'zh-CN',
        busy: false,
        defaultDirectory: '/Users/me/NextMux Comics',
        libraryItems: [{ id: 'lib-1', name: 'ref.png', path: '/lib/ref.png', kind: 'image' }],
        textPicker: React.createElement('div', null, 'Text'),
        imagePicker: React.createElement('div', null, 'Image'),
        videoPicker: React.createElement('div', null, 'Video'),
        voicePicker: React.createElement('div', null, 'Voice'),
        musicPicker: React.createElement('div', null, 'Music'),
        onCancel() {},
        onCreate() {}
    }));
    assert.match(topicSheetHtml, /本地上传/);
    assert.match(topicSheetHtml, /从素材库挑选/);
    assert.match(topicSheetHtml, /选择文件夹/);

    const musicSheetHtml = renderToStaticMarkup(React.createElement(MusicCreateSheet, {
        locale: 'zh-CN',
        busy: false,
        defaultDirectory: '/Users/me/NextMux Comics',
        libraryItems: [{ id: 'lib-1', name: 'cover.png', path: '/lib/cover.png', kind: 'image' }],
        onCancel() {},
        onCreate() {}
    }));
    assert.match(musicSheetHtml, /本地上传/);
    assert.match(musicSheetHtml, /从素材库挑选/);
    assert.match(musicSheetHtml, /选择文件夹/);
});

