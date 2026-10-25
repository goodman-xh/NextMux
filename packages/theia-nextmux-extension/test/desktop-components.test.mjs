import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { DesktopComponents } = await import('../lib/node/nextmux-components.js');
const { speechModelForLocale } = await import('../lib/common/nextmux-components.js');

test('every desktop system has a pinned FFmpeg and speech recogniser build', () => {
    for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['win32', 'arm64'], ['win32', 'ia32'], ['linux', 'x64'], ['linux', 'arm64']]) {
        const components = new DesktopComponents({ root: '/tmp/none', fetchImpl: fetch, platform, arch, browsersRoot: '/tmp/none/b', systemBrowsers: [] });
        for (const id of ['ffmpeg', 'speech-engine', 'speech-sensevoice', 'speech-whisper']) {
            const spec = components.spec(id);
            assert.ok(spec, `${id} on ${platform}-${arch}`);
            for (const artifact of spec.artifacts) {
                assert.match(artifact.urls[0], /^https:\/\/(registry\.npmjs\.org|github\.com)\//);
                assert.ok(artifact.algorithm === 'sha256' ? /^[a-f0-9]{64}$/.test(artifact.digest) : artifact.digest.length > 80, `${id} digest on ${platform}-${arch}`);
            }
        }
        // Windows builds carry their own C++ runtime (MT), so no Visual C++ Redistributable is needed.
        if (platform === 'win32') assert.match(components.spec('speech-engine').artifacts[0].fileName, /-MT-Release-no-tts\.tar\.bz2$/);
    }
    assert.equal(speechModelForLocale('zh-CN'), 'speech-sensevoice');
    assert.equal(speechModelForLocale('en'), 'speech-sensevoice');
    assert.equal(speechModelForLocale('ko'), 'speech-sensevoice');
    assert.equal(speechModelForLocale('es'), 'speech-whisper');
    assert.equal(speechModelForLocale('ar'), 'speech-whisper');
});

/** A component whose single artifact is a small .tgz holding package/ffmpeg. */
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'nm-components-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = join(root, 'source');
    await mkdir(join(source, 'package'), { recursive: true });
    await writeFile(join(source, 'package', 'ffmpeg'), '#!/bin/sh\necho ffmpeg\n');
    await writeFile(join(source, 'package', 'README.md'), 'extra');
    const archive = join(root, 'ffmpeg.tgz');
    execFileSync('tar', ['-czf', archive, '-C', source, 'package']);
    const bytes = await readFile(archive);
    const digest = createHash('sha512').update(bytes).digest('base64');
    return { root, bytes, digest };
}

class TestComponents extends DesktopComponents {
    constructor(options, artifact) { super(options); this.artifact = artifact; }
    spec(id) {
        const real = super.spec(id);
        return id === 'ffmpeg' ? { ...real, version: 'test', artifacts: [this.artifact] } : real;
    }
}

async function settle(components, id) {
    // A deadline, not a count: under the full parallel suite a retry with back-off can take several seconds.
    for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
        const state = await components.state({ preferredSpeech: 'speech-sensevoice' });
        const component = state.components.find(item => item.id === id);
        if (component.status === 'ready' || component.status === 'failed') return component;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('download did not settle');
}

test('a download is checked against its digest, unpacked and installed; a bad copy falls back to the mirror', async t => {
    const { root, bytes, digest } = await fixture(t);
    const requested = [];
    const fetchImpl = async url => { requested.push(url); return new Response(url.includes('mirror') ? bytes : Buffer.from('tampered'), { status: 200 }); };
    const components = new TestComponents({ root: join(root, 'components'), fetchImpl, browsersRoot: join(root, 'browsers'), systemBrowsers: [] },
        { fileName: 'ffmpeg.tgz', urls: ['https://primary.test/ffmpeg.tgz', 'https://mirror.test/ffmpeg.tgz'], algorithm: 'sha512', digest, archive: 'tar', bytes: bytes.length });
    components.download('ffmpeg');
    const component = await settle(components, 'ffmpeg');
    assert.equal(component.status, 'ready', component.error);
    assert.equal(component.source, 'downloaded');
    assert.deepEqual(requested, ['https://primary.test/ffmpeg.tgz', 'https://mirror.test/ffmpeg.tgz']);
    const path = await components.ffmpegPath();
    assert.ok(path && path.endsWith(join('ffmpeg', 'test', 'ffmpeg')));
    assert.equal((await stat(path)).mode & 0o111, 0o111, 'the tool is executable');
    // Only the tool is kept; nothing is left in staging or downloads.
    assert.deepEqual((await readdir(join(root, 'components', 'ffmpeg', 'test'))).sort(), ['.installed.json', 'ffmpeg']);
    assert.deepEqual(await readdir(join(root, 'components', '.staging')), []);
    await components.remove('ffmpeg');
    assert.equal(await components.ffmpegPath(), undefined);
});

test('when every copy fails its digest nothing is installed and the reason is shown', async t => {
    const { root, bytes, digest } = await fixture(t);
    const components = new TestComponents({ root: join(root, 'components'), fetchImpl: async () => new Response(Buffer.from('tampered')), browsersRoot: join(root, 'browsers'), systemBrowsers: [] },
        { fileName: 'ffmpeg.tgz', urls: ['https://primary.test/a.tgz', 'https://mirror.test/a.tgz'], algorithm: 'sha512', digest, archive: 'tar', bytes: bytes.length });
    components.download('ffmpeg');
    const component = await settle(components, 'ffmpeg');
    assert.equal(component.status, 'failed');
    assert.equal(component.domainError.code, 'COMPONENT_CHECKSUM_MISMATCH');
    assert.match(component.domainError.fallbackEnglish, /checksum/);
    assert.equal(await components.ffmpegPath(), undefined);
    // Retrying after a failure queues again.
    components.download('ffmpeg');
    assert.equal((await components.state({ preferredSpeech: 'speech-sensevoice' })).components.find(item => item.id === 'ffmpeg').status !== 'ready', true);
    // Let the retry finish before the temporary folder is removed (it was still writing into it).
    assert.equal((await settle(components, 'ffmpeg')).status, 'failed');
});

test('automatic downloads can be switched off and the setting persists', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nm-components-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const components = new DesktopComponents({ root, fetchImpl: fetch, browsersRoot: join(root, 'browsers'), systemBrowsers: [] });
    assert.equal(await components.autoDownloadEnabled(), true);
    await components.setAutoDownload(false);
    assert.equal(await new DesktopComponents({ root, fetchImpl: fetch, browsersRoot: join(root, 'browsers'), systemBrowsers: [] }).autoDownloadEnabled(), false);
    const state = await components.state({ preferredSpeech: 'speech-whisper' });
    assert.equal(state.components.find(item => item.id === 'speech-whisper').recommended, true);
    assert.equal(state.components.find(item => item.id === 'speech-sensevoice').recommended, false);
    assert.equal(state.components.some(item => item.id === 'comfyui'), false);
});

test('cancelling a queued download and immediately re-downloading preserves the new job state', async t => {
    const { root, bytes, digest } = await fixture(t);
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    const fetchImpl = async url => {
        if (url.includes('silero_vad') || url.includes('sherpa')) await firstGate;
        return new Response(bytes, { status: 200 });
    };
    const components = new TestComponents({ root: join(root, 'components'), fetchImpl, browsersRoot: join(root, 'browsers'), systemBrowsers: [] },
        { fileName: 'ffmpeg.tgz', urls: ['https://primary.test/ffmpeg.tgz'], algorithm: 'sha512', digest, archive: 'tar', bytes: bytes.length });
    // Queue speech-engine first so it occupies the queue, then queue ffmpeg, cancel ffmpeg while queued, and re-queue ffmpeg.
    components.download('speech-engine');
    components.download('ffmpeg');
    components.cancel('ffmpeg');
    components.download('ffmpeg');
    const beforeRelease = await components.state({ preferredSpeech: 'speech-sensevoice' });
    assert.equal(beforeRelease.components.find(item => item.id === 'ffmpeg').status, 'queued');
    components.cancel('speech-engine');
    releaseFirst();
    const settled = await settle(components, 'ffmpeg');
    assert.equal(settled.status, 'ready');
});

test('a natural voice is downloaded after the other tools, only where it speaks the language, and is chosen once', async t => {
    const { DESKTOP_COMPONENT_IDS, DESKTOP_VOICES, desktopVoiceFor, desktopVoiceLanguage } = await import('../lib/common/nextmux-components.js');
    const order = DESKTOP_COMPONENT_IDS.indexOf.bind(DESKTOP_COMPONENT_IDS);
    assert.ok(order('voice-engine') > order('speech-whisper') && order('voice-kokoro') > order('voice-engine'), 'queued after the comic tools');
    for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['win32', 'arm64'], ['win32', 'ia32'], ['linux', 'x64'], ['linux', 'arm64']]) {
        const components = new DesktopComponents({ root: '/tmp/none', fetchImpl: fetch, platform, arch, browsersRoot: '/tmp/none/b', systemBrowsers: [] });
        const engine = components.spec('voice-engine');
        assert.match(engine.required[0], /\/bin\/sherpa-onnx-offline-tts(\.exe)?$/, `${platform}-${arch}`);
        assert.doesNotMatch(engine.artifacts[0].fileName, /no-tts/, 'the build with speech synthesis');
        assert.match(engine.artifacts[0].digest, /^[a-f0-9]{64}$/);
    }
    const root = await mkdtemp(join(tmpdir(), 'nm-voice-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const components = new DesktopComponents({ root, fetchImpl: fetch, platform: 'darwin', arch: 'arm64', browsersRoot: join(root, 'b'), systemBrowsers: [] });
    const chinese = await components.state({ preferredSpeech: 'speech-sensevoice', voice: true });
    assert.equal(chinese.components.find(item => item.id === 'voice-kokoro').recommended, true);
    const spanish = await components.state({ preferredSpeech: 'speech-whisper', voice: false });
    assert.equal(spanish.components.find(item => item.id === 'voice-kokoro').recommended, false, 'the voices speak Chinese and English only');
    assert.equal(await components.voiceTool(), undefined, 'not installed: replies fall back to a system voice');
    await components.setAutoDownload(false);
    await components.setVoice('zh-male-steady');
    const saved = await components.state({ preferredSpeech: 'speech-sensevoice', voice: true });
    assert.equal(saved.voice, 'zh-male-steady');
    assert.equal(saved.autoDownload, false, 'choosing a voice keeps the other settings');
    await assert.rejects(components.setVoice('robot'));
    assert.equal(desktopVoiceLanguage('zh-TW'), 'zh');
    assert.equal(desktopVoiceLanguage('ja'), undefined);
    assert.equal(desktopVoiceFor('zh-CN').id, 'zh-female-natural', 'a female voice by default');
    assert.equal(desktopVoiceFor('en').id, 'en-female');
    assert.equal(desktopVoiceFor('en', 'zh-male-steady').id, 'en-female', 'a Chinese voice does not read English');
    assert.equal(DESKTOP_VOICES.filter(voice => voice.gender === 'female').length >= 2, true);

    const { readAloudReadiness, pickSystemSpeechVoice } = await import('../lib/browser/nextmux-read-aloud.js');
    assert.equal(readAloudReadiness(undefined, true), 'ready', 'OS built-in read aloud is ready without downloading Kokoro');
    assert.equal(readAloudReadiness(undefined, false), 'unsupported');
    const mockVoices = [
        { name: 'Albert', lang: 'en-US', localService: true, default: false, voiceURI: 'albert' },
        { name: 'Samantha', lang: 'en-US', localService: true, default: true, voiceURI: 'samantha' },
        { name: 'Tingting', lang: 'zh-CN', localService: true, default: true, voiceURI: 'tingting' },
        { name: 'Microsoft Yunxi Online (Natural)', lang: 'zh-CN', localService: false, default: false, voiceURI: 'yunxi' }
    ];
    assert.equal(pickSystemSpeechVoice(mockVoices, 'en')?.name, 'Samantha');
    assert.equal(pickSystemSpeechVoice(mockVoices, 'zh-CN')?.name, 'Tingting');
    assert.equal(pickSystemSpeechVoice(mockVoices, 'zh-CN', 'zh-male-steady')?.name, 'Microsoft Yunxi Online (Natural)');
});
