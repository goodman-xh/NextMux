import { execFile, type ChildProcess, type ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { decodeXmlEntities, DocumentTextError, extensionOf, extractDocumentText, type ExtractedDocument } from './nextmux-document-text';

const utf8 = new TextDecoder('utf-8');
const latin1 = new TextDecoder('latin1');

export interface InspectedImageInfo {
    readonly format: 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'svg' | 'unknown';
    readonly width?: number;
    readonly height?: number;
    readonly bitDepth?: number;
    readonly colorType?: string;
    readonly metadata: Record<string, string>;
}

const PNG_COLOR_TYPES: Record<number, string> = {
    0: 'Grayscale',
    2: 'RGB',
    3: 'Indexed',
    4: 'Grayscale+Alpha',
    6: 'RGBA'
};

export function inspectImageBytes(bytes: Uint8Array, mimeType = ''): InspectedImageInfo {
    const metadata: Record<string, string> = {};
    if (bytes.length < 4) {
        return { format: 'unknown', metadata };
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        bytes.length >= 24 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
    ) {
        let width: number | undefined;
        let height: number | undefined;
        let bitDepth: number | undefined;
        let colorType: string | undefined;
        let offset = 8;
        while (offset + 12 <= bytes.length) {
            const length = view.getUint32(offset, false);
            const type = latin1.decode(bytes.subarray(offset + 4, offset + 8));
            const dataStart = offset + 8;
            const dataEnd = dataStart + length;
            if (dataEnd > bytes.length) break;
            const chunk = bytes.subarray(dataStart, dataEnd);
            if (type === 'IHDR' && chunk.length >= 10) {
                const chunkView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
                width = chunkView.getUint32(0, false);
                height = chunkView.getUint32(4, false);
                bitDepth = chunk[8];
                colorType = PNG_COLOR_TYPES[chunk[9]] ?? `Type ${chunk[9]}`;
            } else if (type === 'tEXt') {
                const nul = chunk.indexOf(0);
                if (nul > 0) {
                    const key = latin1.decode(chunk.subarray(0, nul)).trim();
                    const val = utf8.decode(chunk.subarray(nul + 1)).trim();
                    if (key && val) metadata[key] = val;
                }
            } else if (type === 'iTXt') {
                const nul = chunk.indexOf(0);
                if (nul > 0 && nul + 3 <= chunk.length) {
                    const key = latin1.decode(chunk.subarray(0, nul)).trim();
                    const compFlag = chunk[nul + 1];
                    if (compFlag === 0) {
                        let cursor = nul + 3;
                        const langEnd = chunk.indexOf(0, cursor);
                        if (langEnd >= 0) {
                            cursor = langEnd + 1;
                            const transEnd = chunk.indexOf(0, cursor);
                            if (transEnd >= 0) {
                                const val = utf8.decode(chunk.subarray(transEnd + 1)).trim();
                                if (key && val) metadata[key] = val;
                            }
                        }
                    }
                }
            } else if (type === 'IEND') {
                break;
            }
            offset = dataEnd + 4;
        }
        return { format: 'png', width, height, bitDepth, colorType, metadata };
    }

    // JPEG: FF D8 FF
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        let width: number | undefined;
        let height: number | undefined;
        let bitDepth: number | undefined;
        let colorType: string | undefined;
        let offset = 2;
        while (offset + 4 <= bytes.length) {
            if (bytes[offset] !== 0xff) {
                offset += 1;
                continue;
            }
            while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
            if (offset >= bytes.length) break;
            const marker = bytes[offset];
            offset += 1;
            if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
            if (marker === 0xd9 || marker === 0xda) break;
            if (offset + 2 > bytes.length) break;
            const segLength = view.getUint16(offset, false);
            if (segLength < 2 || offset + segLength > bytes.length) break;
            if (marker >= 0xc0 && marker <= 0xc3 && segLength >= 8) {
                bitDepth = bytes[offset + 2];
                height = view.getUint16(offset + 3, false);
                width = view.getUint16(offset + 5, false);
                const components = bytes[offset + 7];
                colorType = components === 1 ? 'Grayscale' : components === 3 ? 'YCbCr/RGB' : components === 4 ? 'CMYK' : `${components}-channel`;
            } else if (marker === 0xfe && segLength > 2) {
                const comment = utf8.decode(bytes.subarray(offset + 2, offset + segLength)).replace(/\0/g, '').trim();
                if (comment) metadata.Comment = comment;
            }
            offset += segLength;
        }
        return { format: 'jpeg', width, height, bitDepth, colorType, metadata };
    }

    // GIF: GIF87a / GIF89a
    if (
        bytes.length >= 10 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38
    ) {
        const width = view.getUint16(6, true);
        const height = view.getUint16(8, true);
        return { format: 'gif', width, height, colorType: 'Indexed', metadata };
    }

    // WebP: RIFF....WEBP
    if (
        bytes.length >= 16 &&
        latin1.decode(bytes.subarray(0, 4)) === 'RIFF' &&
        latin1.decode(bytes.subarray(8, 12)) === 'WEBP'
    ) {
        const chunkType = latin1.decode(bytes.subarray(12, 16));
        let width: number | undefined;
        let height: number | undefined;
        if (chunkType === 'VP8 ' && bytes.length >= 30) {
            width = view.getUint16(26, true) & 0x3fff;
            height = view.getUint16(28, true) & 0x3fff;
        } else if (chunkType === 'VP8L' && bytes.length >= 25) {
            const bits = view.getUint32(21, true);
            width = (bits & 0x3fff) + 1;
            height = ((bits >> 14) & 0x3fff) + 1;
        } else if (chunkType === 'VP8X' && bytes.length >= 30) {
            width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
            height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        }
        return { format: 'webp', width, height, metadata };
    }

    // BMP: 'BM'
    if (bytes.length >= 30 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
        const width = Math.abs(view.getInt32(18, true));
        const height = Math.abs(view.getInt32(22, true));
        const bitDepth = view.getUint16(28, true);
        return { format: 'bmp', width, height, bitDepth, metadata };
    }

    if (mimeType === 'image/svg+xml' || /<svg\b/i.test(utf8.decode(bytes.subarray(0, 512)))) {
        return { format: 'svg', metadata };
    }

    return { format: 'unknown', metadata };
}

/**
 * Vision through JavaScript for Automation. `/usr/bin/osascript` ships with every Mac, so recognition needs no developer
 * tools (running `/usr/bin/swiftc` without them opens the system's "install developer tools" dialog), no build step and
 * no helper binary on disk. The picture's path arrives as an argument, never as script source.
 */
const MACOS_VISION_SCRIPT = `ObjC.import('Foundation');
ObjC.import('Vision');
function recognize(url, languages) {
    try {
        const request = $.VNRecognizeTextRequest.alloc.init;
        request.recognitionLevel = 0; // VNRequestTextRecognitionLevelAccurate
        request.usesLanguageCorrection = true;
        request.recognitionLanguages = $(languages);
        const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $({}));
        if (!handler.performRequestsError($([request]), null)) return undefined;
        const results = request.results;
        const lines = [];
        for (let i = 0; i < results.count; i++) {
            const candidates = results.objectAtIndex(i).topCandidates(1);
            if (candidates.count) lines.push(candidates.objectAtIndex(0).string.js);
        }
        return lines;
    } catch (error) {
        return undefined;
    }
}
function run(argv) {
    const url = $.NSURL.fileURLWithPath(argv[0]);
    // Japanese and Korean need macOS 13; an older system may refuse a request that lists them.
    const lines = recognize(url, ['zh-Hans', 'zh-Hant', 'en-US', 'ja-JP', 'ko-KR']) || recognize(url, ['zh-Hans', 'zh-Hant', 'en-US']) || [];
    return lines.join('\\n');
}`;

/**
 * Windows.Media.Ocr through Windows PowerShell 5.1. The picture's path is passed in the environment, never as script
 * source, and the text comes back as Base64 of its UTF-8 bytes so the console code page cannot garble it.
 * Exit 3: no OCR language is installed; exit 4: the picture could not be decoded.
 */
const WINDOWS_OCR_SCRIPT = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]',
    '$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]',
    '$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]',
    'function Await($op, [Type]$t) { $m = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod })[0].MakeGenericMethod($t); $m.Invoke($null, @($op)).GetAwaiter().GetResult() }',
    '$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
    // A profile language without OCR support can still use any recognizer language that is installed.
    'if ($null -eq $engine) { $language = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Select-Object -First 1; if ($null -ne $language) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language) } }',
    'if ($null -eq $engine) { exit 3 }',
    'try { $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:NEXTMUX_OCR_IMAGE)) ([Windows.Storage.StorageFile]); $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream]); $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder]); $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap]) } catch { exit 4 }',
    '$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])',
    '$text = @($result.Lines | ForEach-Object { $_.Text }) -join "`n"',
    '[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))'
].join('; ');

export interface RecognizerOutput {
    readonly stdout: string;
    /** The process exit code; undefined when it could not start, was killed or ran out of time. */
    readonly exitCode?: number;
}

/**
 * Runs one recognizer process under a hard deadline. execFile's own timeout kills the process, but its callback still
 * waits for the process to exit, which one stuck in the kernel (for example on an unresponsive network volume) may never
 * do; the deadline settles regardless and drops the pipes.
 */
export function runBoundedRecognizer(file: string, args: readonly string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<RecognizerOutput> {
    return new Promise(resolve => {
        let settled = false;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const settle = (output: RecognizerOutput): void => {
            if (settled) return;
            settled = true;
            if (deadline) clearTimeout(deadline);
            resolve(output);
        };
        const options: ExecFileOptionsWithStringEncoding = {
            encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, windowsHide: true, ...(env ? { env } : {})
        };
        let child: ChildProcess;
        try {
            child = execFile(file, [...args], options, (error, stdout) => settle(error
                ? { stdout: '', ...(typeof error.code === 'number' ? { exitCode: error.code } : {}) }
                : { stdout, exitCode: 0 }));
        } catch {
            settle({ stdout: '' });
            return;
        }
        deadline = setTimeout(() => {
            child.kill('SIGKILL');
            child.stdout?.destroy();
            child.stderr?.destroy();
            settle({ stdout: '' });
        }, timeoutMs + 1_000);
        deadline.unref?.();
    });
}

/** Recognitions run two at a time: each loads the system's text recognizer, and a long history can ask for many at once. */
const OCR_CONCURRENCY = 2;
let ocrRunning = 0;
const ocrQueue: Array<() => void> = [];

async function withOcrSlot<T>(work: () => Promise<T>): Promise<T> {
    if (ocrRunning < OCR_CONCURRENCY) ocrRunning += 1;
    else await new Promise<void>(resolve => ocrQueue.push(resolve)); // a finishing recognition hands its slot over
    try {
        return await work();
    } finally {
        const next = ocrQueue.shift();
        if (next) next(); else ocrRunning -= 1;
    }
}

/** A Windows installation without any OCR language is not asked again for this long. */
const WINDOWS_OCR_RETRY_MS = 10 * 60_000;
let windowsOcrMissingAt: number | undefined;

/** Whether this computer can recognize text in pictures: macOS Vision, or Windows with an OCR language installed. */
export function localImageOcrAvailable(): boolean {
    if (process.platform === 'darwin') return true;
    return process.platform === 'win32' && (windowsOcrMissingAt === undefined || Date.now() - windowsOcrMissingAt >= WINDOWS_OCR_RETRY_MS);
}

/**
 * Text the operating system recognizes in the picture at `imagePath`; '' when it finds none, cannot read the picture,
 * is unavailable or runs out of time. Each recognition is bounded by `timeoutMs` once it starts.
 */
export async function runLocalImageOcr(imagePath: string, timeoutMs = 5_000): Promise<string> {
    if (!localImageOcrAvailable()) return '';
    const budgetMs = Math.min(15_000, Math.max(500, timeoutMs));
    return withOcrSlot(async () => {
        if (process.platform === 'darwin') {
            const { stdout } = await runBoundedRecognizer('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MACOS_VISION_SCRIPT, imagePath], budgetMs);
            return stdout.trim();
        }
        // An absolute path: a bare powershell.exe goes through the program search path, which another program can shadow.
        const configuredRoot = process.env.SystemRoot;
        const systemRoot = configuredRoot && win32.isAbsolute(configuredRoot) ? configuredRoot : 'C:\\Windows';
        const powershell = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const { stdout, exitCode } = await runBoundedRecognizer(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_OCR_SCRIPT],
            budgetMs, { ...process.env, NEXTMUX_OCR_IMAGE: imagePath });
        if (exitCode === 3) windowsOcrMissingAt = Date.now();
        if (exitCode !== 0) return '';
        windowsOcrMissingAt = undefined;
        const encoded = stdout.trim();
        return /^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ? Buffer.from(encoded, 'base64').toString('utf8').trim() : '';
    });
}

function formatByteSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Embedded metadata is context, not the picture's text: an XMP packet or a generator's settings can run to many kilobytes. */
const METADATA_ENTRY_LIMIT = 16;
const METADATA_VALUE_LIMIT = 1_000;

export interface ImageFallbackOptions {
    readonly timeoutMs?: number;
    readonly runOcr?: (imagePath: string) => Promise<string>;
}

export async function extractImageOcrMarkdown(
    name: string,
    bytes: Uint8Array,
    mimeType = '',
    options?: ImageFallbackOptions
): Promise<ExtractedDocument> {
    const ext = extensionOf(name);
    if (ext === 'svg' || mimeType === 'image/svg+xml') {
        return extractDocumentText(name, bytes, mimeType || 'image/svg+xml');
    }

    const info = inspectImageBytes(bytes, mimeType);
    if (info.format === 'svg') {
        return extractDocumentText(name, bytes, 'image/svg+xml');
    }

    if (!options?.runOcr && !localImageOcrAvailable()) {
        throw new DocumentTextError('empty', 'This computer cannot recognize text in images', 'DOCUMENT_IMAGE_NO_TEXT');
    }
    let ocrText = '';
    const tempExt = /^[a-z0-9]{1,10}$/.test(ext) ? ext : info.format !== 'unknown' ? info.format : 'img';
    const tempPath = join(tmpdir(), `nextmux-img-ocr-${randomUUID()}.${tempExt}`);
    try {
        await writeFile(tempPath, bytes, { mode: 0o600 });
        const runner = options?.runOcr ?? (path => runLocalImageOcr(path, options?.timeoutMs ?? 5_000));
        ocrText = (await runner(tempPath)).trim();
    } catch {
        ocrText = '';
    } finally {
        await rm(tempPath, { force: true }).catch(() => undefined);
    }
    // Failed or empty OCR is not extracted text: the caller then describes the image instead of claiming its text.
    if (!ocrText) throw new DocumentTextError('empty', 'No text was recognized in the image', 'DOCUMENT_IMAGE_NO_TEXT');

    const formatLabel = info.format !== 'unknown' ? info.format.toUpperCase() : (ext ? ext.toUpperCase() : 'IMAGE');
    const lines: string[] = [
        `## Image Attachment: ${decodeXmlEntities(name || 'image')}`,
        `- **Format**: ${formatLabel}${mimeType ? ` (\`${mimeType}\`)` : ''}`,
        `- **File Size**: ${formatByteSize(bytes.byteLength)}`
    ];
    if (info.width && info.height) {
        lines.push(`- **Dimensions**: ${info.width} × ${info.height} px`);
    }
    if (info.colorType || info.bitDepth) {
        const colorParts = [info.colorType, info.bitDepth ? `${info.bitDepth}-bit` : ''].filter(Boolean).join(', ');
        lines.push(`- **Color Profile**: ${colorParts}`);
    }
    const metaEntries = Object.entries(info.metadata).slice(0, METADATA_ENTRY_LIMIT);
    if (metaEntries.length) {
        lines.push('### Embedded Metadata');
        for (const [key, val] of metaEntries) {
            const flat = val.replace(/\s+/g, ' ');
            lines.push(`- **${key}**: ${flat.length > METADATA_VALUE_LIMIT ? `${flat.slice(0, METADATA_VALUE_LIMIT)}…` : flat}`);
        }
    }
    lines.push('### Extracted Text (OCR)');
    lines.push(ocrText);

    return {
        method: 'image_ocr',
        text: lines.join('\n'),
        truncated: false,
        note: 'Image inspected and OCR-extracted locally because the selected model does not accept native image input'
    };
}
