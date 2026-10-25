import { DesktopDomainError, domainMessageFromError, type DomainMessage } from '../common/nextmux-domain-errors';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createWriteStream, statSync } from 'fs';
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { SherpaOnnxModel } from '@nextmux/media-core';
import { DESKTOP_COMPONENT_IDS, DESKTOP_VOICES, type DesktopComponentId, type DesktopComponentState, type DesktopComponentsState, type DesktopVoice } from '../common/nextmux-components';

/**
 * Downloads for Settings → Downloads (see common/nextmux-components.ts). Every artifact is pinned
 * to a version and a SHA-256/512 digest taken from its publisher (npm integrity, GitHub release
 * digests) and is verified before anything is unpacked; a mirror is only tried with the same
 * digest. One download runs at a time; the install is written to a staging folder and renamed
 * into place, so an interrupted download never leaves a half-installed tool.
 */

interface Artifact {
    readonly fileName: string;
    readonly urls: readonly string[];
    readonly algorithm: 'sha256' | 'sha512';
    /** hex for sha256, base64 for sha512 (npm integrity). */
    readonly digest: string;
    readonly archive: 'tar' | 'zip' | 'file';
    readonly bytes: number;
}

interface ComponentSpec {
    readonly id: Exclude<DesktopComponentId, 'mcp-chromium' | 'comfyui'>;
    readonly version: string;
    readonly license: string;
    readonly homepage: string;
    readonly artifacts: readonly Artifact[];
    /** Relative paths that must exist once installed. */
    readonly required: readonly string[];
    /** Tidies the unpacked files (keeps only what NextMux runs). */
    readonly finish?: (directory: string) => Promise<void>;
}

const SHERPA_VERSION = '1.13.8';
const GITHUB = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

const npm = (name: string, version: string, integrity: string, bytes: number): Artifact => {
    const tail = `${name.split('/')[1]}-${version}.tgz`;
    return { fileName: tail, urls: [`https://registry.npmjs.org/${name}/-/${tail}`, `https://registry.npmmirror.com/${name}/-/${tail}`],
        algorithm: 'sha512', digest: integrity.replace(/^sha512-/, ''), archive: 'tar', bytes };
};

/** FFmpeg builds (GPL) published by @ffmpeg-installer on npm; Windows ARM64 from BtbN's FFmpeg-Builds. */
const FFMPEG: Readonly<Record<string, { readonly version: string; readonly artifact: Artifact }>> = {
    'darwin-arm64': { version: '4.1.5', artifact: npm('@ffmpeg-installer/darwin-arm64', '4.1.5', 'sha512-hYqTiP63mXz7wSQfuqfFwfLOfwwFChUedeCVKkBtl/cliaTM7/ePI9bVzfZ2c+dWu3TqCwLDRWNSJ5pqZl8otA==', 36_767_761) },
    'darwin-x64': { version: '4.1.0', artifact: npm('@ffmpeg-installer/darwin-x64', '4.1.0', 'sha512-Z4EyG3cIFjdhlY8wI9aLUXuH8nVt7E9SlMVZtWvSPnm2sm37/yC2CwjUzyCQbJbySnef1tQwGG2Sx+uWhd9IAw==', 70_991_058) },
    'win32-x64': { version: '4.1.0', artifact: npm('@ffmpeg-installer/win32-x64', '4.1.0', 'sha512-Drt5u2vzDnIONf4ZEkKtFlbvwj6rI3kxw1Ck9fpudmtgaZIHD4ucsWB2lCZBXRxJgXR+2IMSti+4rtM4C4rXgg==', 64_459_466) },
    'win32-ia32': { version: '4.1.0', artifact: npm('@ffmpeg-installer/win32-ia32', '4.1.0', 'sha512-FV2D7RlaZv/lrtdhaQ4oETwoFUsUjlUiasiZLDxhEUPdNDWcH1OU9K1xTvqz+OXLdsmYelUDuBS/zkMOTtlUAw==', 48_801_484) },
    'win32-arm64': { version: 'N-126342-gf88b741dbf', artifact: { fileName: 'ffmpeg-winarm64-gpl.zip',
        urls: ['https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-N-126342-gf88b741dbf-winarm64-gpl.zip'],
        algorithm: 'sha256', digest: '7ba67fd79d1b858cd1cf7058f1303813e2817171da987bdf49b4d94bdafc15cc', archive: 'zip', bytes: 116_376_495 } },
    'linux-x64': { version: '4.1.0', artifact: npm('@ffmpeg-installer/linux-x64', '4.1.0', 'sha512-Y5BWhGLU/WpQjOArNIgXD3z5mxxdV8c41C+U15nsE5yF8tVcdCGet5zPs5Zy3Ta6bU7haGpIzryutqCGQA/W8A==', 68_175_506) },
    'linux-arm64': { version: '4.1.4', artifact: npm('@ffmpeg-installer/linux-arm64', '4.1.4', 'sha512-dljEqAOD0oIM6O6DxBW9US/FkvqvQwgJ2lGHOwHDDwu/pX8+V0YsDL1xqHbj1DMX/+nP9rxw7G7gcUvGspSoKg==', 32_809_101) },
    'linux-ia32': { version: '4.1.0', artifact: npm('@ffmpeg-installer/linux-ia32', '4.1.0', 'sha512-0LWyFQnPf+Ij9GQGD034hS6A90URNu9HCtQ5cTqo5MxOEc7Rd8gLXrJvn++UmxhU0J5RyRE9KRYstdCVUjkNOQ==', 42_987_233) },
    'linux-arm': { version: '4.1.3', artifact: npm('@ffmpeg-installer/linux-arm', '4.1.3', 'sha512-NDf5V6l8AfzZ8WzUGZ5mV8O/xMzRag2ETR6+TlGIsMHp81agx51cqpPItXPib/nAZYmo55Bl2L6/WOMI3A5YRg==', 25_535_438) },
};

/**
 * sherpa-onnx (Apache-2.0) command-line builds, GitHub release v1.13.8. The macOS builds need macOS 11+
 * (below the app's own minimum); Windows 10 1803+ unpacks them with its built-in tar.
 */
const SHERPA: Readonly<Record<string, { readonly folder: string; readonly digest: string; readonly bytes: number }>> = {
    'darwin-arm64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-osx-arm64-shared-no-tts`, digest: '91b96512c4fa1960f8a9ed5360a6c8dda53a4b5015d0590244f14086a234557a', bytes: 18_252_168 },
    'darwin-x64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-osx-x64-shared-no-tts`, digest: '03fd4cffd98b239d74b9253c270ff637661adb4d51a5a6c9e1f7486e48306db3', bytes: 20_646_120 },
    // Windows: the MT builds carry the C++ runtime inside, so no Visual C++ Redistributable is needed.
    'win32-x64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-win-x64-shared-MT-Release-no-tts`, digest: '4b0a94f7b5c606b1b64a19a831c2127559e4b3d34e195465ebc7be73d9ed4783', bytes: 23_271_851 },
    'win32-arm64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-win-arm64-shared-MT-Release-no-tts`, digest: '29a864324e658bef2a8b83bd3e12adae8b415a5a232d83902030e8c6efa37dbc', bytes: 21_872_501 },
    'win32-ia32': { folder: `sherpa-onnx-v${SHERPA_VERSION}-win-x86-shared-MT-Release-no-tts`, digest: '3b25da29441b20b1b967ef1cac7834258b23c5c1baa8f26a1269debd384b79b5', bytes: 19_795_683 },
    'linux-x64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-linux-x64-shared-no-tts`, digest: 'd0f96c8b65c6cd0974fada22737e337de81bc8cd2abbec2e39caf358b1eec5fc', bytes: 24_802_494 },
    'linux-arm64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-linux-aarch64-shared-cpu`, digest: '4e3734f82bc1379fd91f219f5869c7e9d03b7a4f7561907d8abca4849c51a789', bytes: 28_091_778 },
};

/** The same sherpa-onnx release with speech synthesis (for the natural voice), digests from the GitHub release. */
const SHERPA_TTS: Readonly<Record<string, { readonly folder: string; readonly digest: string; readonly bytes: number }>> = {
    'darwin-arm64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-osx-arm64-shared`, digest: 'b10e5c7e2c30ea03de9c442655d14860d9edc475c6251d58a8f5f06e913a1d56', bytes: 20_314_448 },
    'darwin-x64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-osx-x64-shared`, digest: '54aad64acee9d2d596535a6080d6f22602a720af5460e1d50461b1e1b06bee40', bytes: 22_846_038 },
    'win32-x64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-win-x64-shared-MT-Release`, digest: '6dffdc715a4465b989446a6105265d2cb345e7101591a17d35534b6758f6e8df', bytes: 24_805_859 },
    'win32-arm64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-win-arm64-shared-MT-Release`, digest: '455ea18dc44aea188b4f7976037dea3d77e3f8d7afe0760f34244a7a0db53c4c', bytes: 23_341_583 },
    'win32-ia32': { folder: `sherpa-onnx-v${SHERPA_VERSION}-win-x86-shared-MT-Release`, digest: '78bac9926a7fb77042171d60db53aad71e813deb2d04e9853937d7ac357e01f2', bytes: 21_105_780 },
    'linux-x64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-linux-x64-shared`, digest: 'c0bdb7907d3a74bba1d55d22bf4d9fa75586cf1530614ebe88a27b9118e015c4', bytes: 28_156_791 },
    'linux-arm64': { folder: `sherpa-onnx-v${SHERPA_VERSION}-linux-aarch64-shared-cpu`, digest: '4e3734f82bc1379fd91f219f5869c7e9d03b7a4f7561907d8abca4849c51a789', bytes: 28_091_778 },
};
const TTS_TOOL = 'sherpa-onnx-offline-tts';
/** Kokoro-82M v1.1 (Apache-2.0): about 100 Chinese voices and a few English ones. The full-precision model, faster than int8 on CPUs. */
const KOKORO_FOLDER = 'kokoro-multi-lang-v1_1';

const SENSEVOICE_FOLDER = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09';
const WHISPER_FOLDER = 'sherpa-onnx-whisper-base';
const ASR_TOOL = 'sherpa-onnx-vad-with-offline-asr';

export interface DesktopComponentsOptions {
    readonly root: string;
    readonly fetchImpl: typeof fetch;
    readonly platform?: NodeJS.Platform;
    readonly arch?: string;
    /** resources/mcp-runtime of a packaged app (browser-automation Chromium). */
    readonly mcpRuntimeRoot?: string;
    /** Where the MCP launcher keeps a downloaded Chromium. */
    readonly browsersRoot: string;
    /** Overrides for tests: which Chrome-family browsers exist. */
    readonly systemBrowsers?: readonly string[];
}

interface Job {
    status: 'queued' | 'downloading' | 'installing' | 'failed';
    received: number;
    total: number;
    error?: string;
    domainError?: DomainMessage;
    controller: AbortController;
}

export class DesktopComponents {
    protected readonly platform: NodeJS.Platform;
    protected readonly arch: string;
    protected readonly jobs = new Map<DesktopComponentId, Job>();
    protected queue: Promise<void> = Promise.resolve();

    constructor(protected readonly options: DesktopComponentsOptions) {
        this.platform = options.platform ?? process.platform;
        this.arch = options.arch ?? process.arch;
    }

    protected get key(): string { return `${this.platform}-${this.arch}`; }

    protected spec(id: DesktopComponentId): ComponentSpec | undefined {
        const exe = this.platform === 'win32' ? '.exe' : '';
        if (id === 'ffmpeg') {
            const entry = FFMPEG[this.key];
            return entry && { id, version: entry.version, license: 'GPL-3.0 / LGPL-2.1', homepage: 'https://ffmpeg.org', artifacts: [entry.artifact], required: [`ffmpeg${exe}`],
                finish: async directory => {
                    const found = await findFile(directory, `ffmpeg${exe}`);
                    if (!found) throw new DesktopDomainError('COMPONENT_FFMPEG_MISSING', 'The downloaded package does not contain FFmpeg');
                    const target = join(directory, `ffmpeg${exe}`);
                    if (found !== target) await rename(found, target);
                    for (const entry of await readdir(directory)) if (entry !== `ffmpeg${exe}`) await rm(join(directory, entry), { recursive: true, force: true });
                    if (this.platform !== 'win32') await chmod(target, 0o755);
                } };
        }
        if (id === 'speech-engine') {
            const entry = SHERPA[this.key];
            return entry && { id, version: SHERPA_VERSION, license: 'Apache-2.0 (sherpa-onnx), MIT (Silero VAD)', homepage: 'https://github.com/k2-fsa/sherpa-onnx',
                artifacts: [
                    { fileName: `${entry.folder}.tar.bz2`, urls: [`${GITHUB}/v${SHERPA_VERSION}/${entry.folder}.tar.bz2`], algorithm: 'sha256', digest: entry.digest, archive: 'tar', bytes: entry.bytes },
                    { fileName: 'silero_vad.onnx', urls: [`${GITHUB}/asr-models/silero_vad.onnx`], algorithm: 'sha256', digest: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6', archive: 'file', bytes: 643_854 },
                ],
                required: [`${entry.folder}/bin/${ASR_TOOL}${exe}`, 'silero_vad.onnx'],
                finish: async directory => {
                    // Keep the one tool NextMux runs and its libraries; drop the other ~30 programs.
                    const bin = join(directory, entry.folder, 'bin');
                    for (const name of await readdir(bin)) {
                        if (name === `${ASR_TOOL}${exe}` || /\.(dll|dylib|so(\.\d+)*)$/i.test(name)) continue;
                        await rm(join(bin, name), { force: true });
                    }
                    for (const extra of ['include', 'share']) await rm(join(directory, entry.folder, extra), { recursive: true, force: true });
                    if (this.platform !== 'win32') await chmod(join(bin, ASR_TOOL), 0o755);
                } };
        }
        if (id === 'voice-engine') {
            const entry = SHERPA_TTS[this.key];
            return entry && { id, version: SHERPA_VERSION, license: 'Apache-2.0 (sherpa-onnx)', homepage: 'https://github.com/k2-fsa/sherpa-onnx',
                artifacts: [{ fileName: `${entry.folder}.tar.bz2`, urls: [`${GITHUB}/v${SHERPA_VERSION}/${entry.folder}.tar.bz2`], algorithm: 'sha256', digest: entry.digest, archive: 'tar', bytes: entry.bytes }],
                required: [`${entry.folder}/bin/${TTS_TOOL}${exe}`],
                finish: async directory => {
                    // Keep the speech synthesiser and its libraries only.
                    const bin = join(directory, entry.folder, 'bin');
                    for (const name of await readdir(bin)) {
                        if (name === `${TTS_TOOL}${exe}` || /\.(dll|dylib|so(\.\d+)*)$/i.test(name)) continue;
                        await rm(join(bin, name), { force: true });
                    }
                    for (const extra of ['include', 'share']) await rm(join(directory, entry.folder, extra), { recursive: true, force: true });
                    if (this.platform !== 'win32') await chmod(join(bin, TTS_TOOL), 0o755);
                } };
        }
        if (id === 'voice-kokoro') {
            return { id, version: 'v1.1', license: 'Apache-2.0 (Kokoro-82M)', homepage: 'https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh',
                artifacts: [{ fileName: `${KOKORO_FOLDER}.tar.bz2`, urls: [`${GITHUB}/tts-models/${KOKORO_FOLDER}.tar.bz2`], algorithm: 'sha256',
                    digest: 'a3f4c73d043860e3fd2e5b06f36795eb81de0fc8e8de6df703245edddd87dbad', archive: 'tar', bytes: 364_816_464 }],
                required: [`${KOKORO_FOLDER}/model.onnx`, `${KOKORO_FOLDER}/voices.bin`, `${KOKORO_FOLDER}/tokens.txt`, `${KOKORO_FOLDER}/lexicon-zh.txt`, `${KOKORO_FOLDER}/lexicon-us-en.txt`] };
        }
        if (id === 'speech-sensevoice') {
            return { id, version: '2025-09-09', license: 'FunASR Model License (SenseVoice)', homepage: 'https://github.com/FunAudioLLM/SenseVoice',
                artifacts: [{ fileName: `${SENSEVOICE_FOLDER}.tar.bz2`, urls: [`${GITHUB}/asr-models/${SENSEVOICE_FOLDER}.tar.bz2`], algorithm: 'sha256',
                    digest: '7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63', archive: 'tar', bytes: 165_783_878 }],
                required: [`${SENSEVOICE_FOLDER}/model.int8.onnx`, `${SENSEVOICE_FOLDER}/tokens.txt`],
                finish: async directory => { await rm(join(directory, SENSEVOICE_FOLDER, 'test_wavs'), { recursive: true, force: true }); } };
        }
        if (id === 'speech-whisper') {
            return { id, version: 'base', license: 'MIT (OpenAI Whisper)', homepage: 'https://github.com/openai/whisper',
                artifacts: [{ fileName: `${WHISPER_FOLDER}.tar.bz2`, urls: [`${GITHUB}/asr-models/${WHISPER_FOLDER}.tar.bz2`], algorithm: 'sha256',
                    digest: '911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de', archive: 'tar', bytes: 207_557_382 }],
                required: [`${WHISPER_FOLDER}/base-encoder.int8.onnx`, `${WHISPER_FOLDER}/base-decoder.int8.onnx`, `${WHISPER_FOLDER}/base-tokens.txt`],
                finish: async directory => {
                    // Only the int8 models run; the full-precision copies and samples are dropped.
                    await rm(join(directory, WHISPER_FOLDER, 'test_wavs'), { recursive: true, force: true });
                    for (const name of ['base-encoder.onnx', 'base-decoder.onnx']) await rm(join(directory, WHISPER_FOLDER, name), { force: true });
                } };
        }
        return undefined;
    }

    protected installDirectory(spec: ComponentSpec): string {
        return join(this.options.root, spec.id, spec.version);
    }

    protected async installed(spec: ComponentSpec): Promise<boolean> {
        const directory = this.installDirectory(spec);
        if (!(await stat(join(directory, '.installed.json')).catch(() => undefined))?.isFile()) return false;
        for (const file of spec.required) if (!(await stat(join(directory, file)).catch(() => undefined))?.isFile()) return false;
        return true;
    }

    /** Installed FFmpeg, if downloaded. */
    async ffmpegPath(): Promise<string | undefined> {
        const spec = this.spec('ffmpeg');
        return spec && await this.installed(spec) ? join(this.installDirectory(spec), spec.required[0]) : undefined;
    }

    /** The recogniser and the best installed model for a language (the requested kind first). */
    async speech(preferred: 'speech-sensevoice' | 'speech-whisper'): Promise<{ readonly executablePath: string; readonly vadModelPath: string; readonly model: SherpaOnnxModel } | undefined> {
        const engine = this.spec('speech-engine');
        if (!engine || !await this.installed(engine)) return undefined;
        const base = this.installDirectory(engine);
        for (const id of preferred === 'speech-sensevoice' ? ['speech-sensevoice', 'speech-whisper'] as const : ['speech-whisper', 'speech-sensevoice'] as const) {
            const spec = this.spec(id)!;
            if (!await this.installed(spec)) continue;
            const directory = this.installDirectory(spec);
            const model: SherpaOnnxModel = id === 'speech-sensevoice'
                ? { kind: 'sense_voice', modelPath: join(directory, spec.required[0]), tokensPath: join(directory, spec.required[1]) }
                : { kind: 'whisper', encoderPath: join(directory, spec.required[0]), decoderPath: join(directory, spec.required[1]), tokensPath: join(directory, spec.required[2]) };
            return { executablePath: join(base, engine.required[0]), vadModelPath: join(base, engine.required[1]), model };
        }
        return undefined;
    }

    protected async settings(): Promise<{ autoDownload: boolean; voice?: DesktopVoice['id'] }> {
        try {
            const value = JSON.parse(await readFile(join(this.options.root, 'settings.json'), 'utf8')) as { autoDownload?: unknown; voice?: unknown };
            const voice = DESKTOP_VOICES.find(item => item.id === value.voice)?.id;
            return { autoDownload: value.autoDownload !== false, ...(voice ? { voice } : {}) };
        } catch { return { autoDownload: true }; }
    }

    protected async saveSettings(patch: { readonly autoDownload?: boolean; readonly voice?: DesktopVoice['id'] }): Promise<void> {
        await mkdir(this.options.root, { recursive: true });
        await writeFile(join(this.options.root, 'settings.json'), JSON.stringify({ ...(await this.settings()), ...patch }));
    }

    async setAutoDownload(enabled: boolean): Promise<void> {
        await this.saveSettings({ autoDownload: Boolean(enabled) });
    }

    async setVoice(voice: DesktopVoice['id']): Promise<void> {
        if (!DESKTOP_VOICES.some(item => item.id === voice)) throw new DesktopDomainError('COMPONENT_UNKNOWN_VOICE', 'The selected voice is unavailable');
        await this.saveSettings({ voice });
    }

    async chosenVoice(): Promise<DesktopVoice['id'] | undefined> {
        return (await this.settings()).voice;
    }

    /** The speech synthesiser and the Kokoro model folder, once both are installed. */
    async voiceTool(): Promise<{ readonly executablePath: string; readonly modelDirectory: string } | undefined> {
        const engine = this.spec('voice-engine');
        const model = this.spec('voice-kokoro');
        if (!engine || !model || !await this.installed(engine) || !await this.installed(model)) return undefined;
        return { executablePath: join(this.installDirectory(engine), engine.required[0]), modelDirectory: join(this.installDirectory(model), KOKORO_FOLDER) };
    }

    async autoDownloadEnabled(): Promise<boolean> {
        return (await this.settings()).autoDownload;
    }

    protected systemBrowser(): string | undefined {
        const home = homedir();
        const candidates = this.options.systemBrowsers ?? (this.platform === 'darwin' ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ] : this.platform === 'win32'
            ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((value): value is string => Boolean(value)).flatMap(base => [
                join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
                join(base, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')])
            : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']);
        return candidates.find(candidate => { try { return statSync(candidate).isFile(); } catch { return false; } });
    }

    protected async chromiumDownloaded(): Promise<boolean> {
        const entries = await readdir(this.options.browsersRoot).catch(() => [] as string[]);
        return entries.some(name => /^chromium-\d+/.test(name));
    }

    protected playwrightCli(): string | undefined {
        return this.options.mcpRuntimeRoot ? join(this.options.mcpRuntimeRoot, 'runtimes', 'playwright', 'package', 'node_modules', 'playwright-core', 'cli.js') : undefined;
    }

    /** Everything for the Downloads page; FFmpeg and ComfyUI states come from the media runtime. */
    async state(extra: {
        readonly ffmpeg?: { readonly available: boolean; readonly source?: string };
        readonly comfyUi?: { readonly configured: boolean; readonly available: boolean };
        readonly preferredSpeech: 'speech-sensevoice' | 'speech-whisper';
        /** The UI language has a natural local voice (Chinese, English): it is recommended then. */
        readonly voice?: boolean;
    }): Promise<DesktopComponentsState> {
        const components: DesktopComponentState[] = [];
        for (const id of DESKTOP_COMPONENT_IDS) {
            const job = this.jobs.get(id);
            const progress = job ? { status: job.status, receivedBytes: job.received, ...(job.error ? { error: job.error } : {}), ...(job.domainError ? { domainError: job.domainError } : {}) } : undefined;
            if (id === 'mcp-chromium') {
                const system = this.systemBrowser();
                const downloaded = await this.chromiumDownloaded();
                components.push({ id, version: 'Playwright Chromium', downloadBytes: 170_000_000, license: 'BSD-3-Clause (Chromium)', homepage: 'https://playwright.dev',
                    recommended: false, removable: downloaded && !system,
                    ...(system ? { status: 'ready' as const, source: 'system' as const } : downloaded ? { status: 'ready' as const, source: 'downloaded' as const }
                        : progress ?? (this.playwrightCli() ? { status: 'missing' as const } : { status: 'unsupported' as const, domainError: { code: 'COMPONENT_BROWSER_RUNTIME_MISSING', fallbackEnglish: 'This build does not include the browser automation runtime' } })) });
                continue;
            }
            if (id === 'comfyui') {
                components.push({ id, version: '', downloadBytes: 0, license: 'GPL-3.0', homepage: 'https://www.comfy.org', recommended: false, removable: false,
                    status: extra.comfyUi?.available ? 'ready' : 'external', ...(extra.comfyUi?.configured ? { source: 'configured' as const } : {}) });
                continue;
            }
            const spec = this.spec(id);
            if (!spec) { components.push({ id, version: '', downloadBytes: 0, license: '', homepage: '', recommended: false, removable: false, status: 'unsupported', domainError: { code: 'COMPONENT_UNSUPPORTED', fallbackEnglish: 'No component build is available for this system', params: { platform: this.key } } }); continue; }
            const installed = await this.installed(spec);
            const bytes = spec.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
            const recommended = id === 'ffmpeg' || id === 'speech-engine' || id === extra.preferredSpeech || (Boolean(extra.voice) && (id === 'voice-engine' || id === 'voice-kokoro'));
            if (id === 'ffmpeg' && !installed && extra.ffmpeg?.available && extra.ffmpeg.source && extra.ffmpeg.source !== 'downloaded') {
                const source = extra.ffmpeg.source === 'bundled' ? 'bundled' as const : extra.ffmpeg.source === 'path' ? 'system' as const : 'configured' as const;
                components.push({ id, version: spec.version, downloadBytes: bytes, license: spec.license, homepage: spec.homepage, recommended, removable: false, status: 'ready', source });
                continue;
            }
            components.push({ id, version: spec.version, downloadBytes: bytes, license: spec.license, homepage: spec.homepage, recommended, removable: installed,
                ...(installed ? { status: 'ready' as const, source: 'downloaded' as const, installedBytes: await folderSize(this.installDirectory(spec)) } : progress ?? { status: 'missing' as const }) });
        }
        const settings = await this.settings();
        return { components, autoDownload: settings.autoDownload, ...(settings.voice ? { voice: settings.voice } : {}), directory: this.options.root };
    }

    /** Queues a download (no-op when installed or already queued). */
    download(id: DesktopComponentId): void {
        if (this.jobs.has(id) && this.jobs.get(id)!.status !== 'failed') return;
        const job: Job = { status: 'queued', received: 0, total: 0, controller: new AbortController() };
        this.jobs.set(id, job);
        this.queue = this.queue.then(() => this.run(id, job)).catch(() => undefined);
    }

    cancel(id: DesktopComponentId): void {
        const job = this.jobs.get(id);
        if (!job) return;
        job.controller.abort();
        if (job.status === 'queued') this.jobs.delete(id);
    }

    async remove(id: DesktopComponentId): Promise<void> {
        this.cancel(id);
        if (id === 'mcp-chromium') { await rm(this.options.browsersRoot, { recursive: true, force: true }); return; }
        const spec = this.spec(id);
        if (spec) await rm(join(this.options.root, spec.id), { recursive: true, force: true });
    }

    protected async run(id: DesktopComponentId, job: Job): Promise<void> {
        const clearJob = (): void => {
            if (this.jobs.get(id) === job) this.jobs.delete(id);
        };
        if (job.controller.signal.aborted) { clearJob(); return; }
        try {
            if (id === 'mcp-chromium') { job.status = 'downloading'; await this.installChromium(job.controller.signal); clearJob(); return; }
            const spec = this.spec(id);
            if (!spec) throw new DesktopDomainError('COMPONENT_UNSUPPORTED', 'No component build is available for this system', { platform: this.key });
            if (await this.installed(spec)) { clearJob(); return; }
            job.status = 'downloading';
            job.total = spec.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
            const staging = join(this.options.root, '.staging', `${spec.id}-${Date.now()}`);
            const downloads = join(this.options.root, '.downloads');
            await mkdir(staging, { recursive: true });
            await mkdir(downloads, { recursive: true });
            try {
                let before = 0;
                for (const artifact of spec.artifacts) {
                    const file = join(downloads, artifact.fileName);
                    await this.fetchVerified(artifact, file, received => { job.received = before + received; }, job.controller.signal);
                    before += artifact.bytes;
                    job.status = 'installing';
                    if (artifact.archive === 'file') await rename(file, join(staging, artifact.fileName));
                    else { await this.extract(file, staging, job.controller.signal); await rm(file, { force: true }); }
                    job.status = 'downloading';
                }
                job.status = 'installing';
                await spec.finish?.(staging);
                for (const required of spec.required) {
                    if (!(await stat(join(staging, required)).catch(() => undefined))?.isFile()) throw new DesktopDomainError('COMPONENT_REQUIRED_FILE_MISSING', `The installation is missing ${basename(required)}`, { file: basename(required) });
                }
                await writeFile(join(staging, '.installed.json'), JSON.stringify({ id: spec.id, version: spec.version, installedAt: new Date().toISOString() }));
                const target = this.installDirectory(spec);
                // Older versions of the same component are replaced.
                await rm(join(this.options.root, spec.id), { recursive: true, force: true });
                await mkdir(dirname(target), { recursive: true });
                await rename(staging, target);
                clearJob();
            } finally {
                await rm(staging, { recursive: true, force: true }).catch(() => undefined);
            }
        } catch (error) {
            if (job.controller.signal.aborted) { clearJob(); return; }
            job.status = 'failed';
            job.domainError = domainMessageFromError(error) ?? { code: 'COMPONENT_INSTALL_FAILED', fallbackEnglish: 'The component could not be installed', technicalDetails: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) };
            job.error = job.domainError.technicalDetails || job.domainError.fallbackEnglish;
        }
    }

    protected async fetchVerified(artifact: Artifact, target: string, onProgress: (received: number) => void, signal: AbortSignal): Promise<void> {
        let last: unknown;
        for (const url of artifact.urls) {
            if (signal.aborted) throw signal.reason;
            const partial = `${target}.part`;
            try {
                const response = await this.options.fetchImpl(url, { signal, redirect: 'follow', headers: { 'user-agent': 'NextMux-Desktop' } });
                if (!response.ok || !response.body) throw new DesktopDomainError('COMPONENT_DOWNLOAD_HTTP', `Download failed with HTTP ${response.status}`, { status: response.status });
                const hash = createHash(artifact.algorithm);
                let received = 0;
                const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
                    hash.update(chunk); received += chunk.length; onProgress(received);
                    if (received > artifact.bytes * 3 + 10_000_000) callback(new DesktopDomainError('COMPONENT_DOWNLOAD_TOO_LARGE', 'The download exceeds its expected size'));
                    else callback(null, chunk);
                } });
                await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), meter, createWriteStream(partial));
                const digest = hash.digest(artifact.algorithm === 'sha512' ? 'base64' : 'hex');
                if (digest !== artifact.digest) throw new DesktopDomainError('COMPONENT_CHECKSUM_MISMATCH', 'The downloaded file does not match the publisher checksum');
                await rename(partial, target);
                return;
            } catch (error) {
                last = error;
                await rm(partial, { force: true }).catch(() => undefined);
                if (signal.aborted) throw error;
            }
        }
        throw domainMessageFromError(last) ? last : new DesktopDomainError('COMPONENT_DOWNLOAD_FAILED', 'The component could not be downloaded', undefined, last instanceof Error ? last.message : undefined);
    }

    /** The system's own tar unpacks .tgz, .tar.bz2 and (bsdtar on macOS/Windows) .zip. */
    protected extract(archive: string, into: string, signal: AbortSignal): Promise<void> {
        const tar = this.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
            : this.platform === 'darwin' ? '/usr/bin/tar' : 'tar';
        return new Promise((resolvePromise, rejectPromise) => {
            const child = spawn(tar, ['-xf', archive, '-C', into], { windowsHide: true, shell: false, stdio: 'ignore', signal });
            child.once('error', error => rejectPromise(new DesktopDomainError('COMPONENT_EXTRACT_START_FAILED', 'The archive extractor could not start', undefined, error.message)));
            child.once('exit', code => code === 0 ? resolvePromise() : rejectPromise(new DesktopDomainError('COMPONENT_EXTRACT_FAILED', `Archive extraction failed (${code})`, { exitCode: code ?? '—' })));
        });
    }

    protected installChromium(signal: AbortSignal): Promise<void> {
        const cli = this.playwrightCli();
        if (!cli) return Promise.reject(new DesktopDomainError('COMPONENT_BROWSER_RUNTIME_MISSING', 'This build does not include the browser automation runtime'));
        return new Promise((resolvePromise, rejectPromise) => {
            const child = spawn(process.execPath, [cli, 'install', 'chromium', '--no-shell'], { windowsHide: true, shell: false, stdio: 'ignore', signal,
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: this.options.browsersRoot } });
            child.once('error', error => rejectPromise(new DesktopDomainError('COMPONENT_CHROMIUM_START_FAILED', 'The Chromium installer could not start', undefined, error.message)));
            child.once('exit', code => code === 0 ? resolvePromise() : rejectPromise(new DesktopDomainError('COMPONENT_CHROMIUM_FAILED', `Chromium download failed (${code})`, { exitCode: code ?? '—' })));
        });
    }
}

async function findFile(directory: string, name: string): Promise<string | undefined> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) { const found = await findFile(path, name); if (found) return found; }
        else if (entry.name.toLowerCase() === name.toLowerCase()) return path;
    }
    return undefined;
}

async function folderSize(directory: string): Promise<number> {
    let total = 0;
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        const path = join(directory, entry.name);
        total += entry.isDirectory() ? await folderSize(path) : (await stat(path).catch(() => undefined))?.size ?? 0;
    }
    return total;
}
