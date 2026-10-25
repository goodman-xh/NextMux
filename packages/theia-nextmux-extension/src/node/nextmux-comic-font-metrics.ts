import { spawn } from 'node:child_process';
import { open, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ComicFontMetrics { readonly family: string; readonly postscriptName: string; readonly emToAss: number }
const cache = new Map<string, ComicFontMetrics>();
const filterPath = (value: string): string => value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\''");

/** Read only SFNT directory/metrics/name tables, never the entire (often 75 MB) TTC. */
export async function readComicFontEmRatio(path: string, requestedIndex: number, postscriptName: string): Promise<number> {
    const file = await open(path, 'r');
    try {
        const size = (await file.stat()).size;
        const read = async (offset: number, length: number): Promise<Buffer> => {
            if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || length > 1024 * 1024 || offset + length > size)
                throw new Error('Invalid font metrics table.');
            const bytes = Buffer.alloc(length), result = await file.read(bytes, 0, length, offset);
            if (result.bytesRead !== length) throw new Error('Incomplete font metrics table.');
            return bytes;
        };
        const header = await read(0, 12);
        let offsets = [0];
        if (header.toString('ascii', 0, 4) === 'ttcf') {
            const count = header.readUInt32BE(8);
            if (count < 1 || count > 256) throw new Error('Unsupported font collection.');
            const table = await read(12, count * 4);
            offsets = Array.from({ length: count }, (_, index) => table.readUInt32BE(index * 4));
        }
        const indices = requestedIndex >= 0 && requestedIndex < offsets.length ? [requestedIndex] : offsets.map((_, i) => i);
        for (const index of indices) {
            const face = await read(offsets[index], 12), count = face.readUInt16BE(4);
            if (count < 1 || count > 256) throw new Error('Unsupported font table directory.');
            const directory = await read(offsets[index] + 12, count * 16), tables = new Map<string, { offset: number; length: number }>();
            for (let i = 0; i < count; i++) tables.set(directory.toString('ascii', i * 16, i * 16 + 4),
                { offset: directory.readUInt32BE(i * 16 + 8), length: directory.readUInt32BE(i * 16 + 12) });
            const table = async (name: string): Promise<Buffer | undefined> => { const t = tables.get(name); return t ? read(t.offset, t.length) : undefined; };
            if (requestedIndex < 0 || indices.length > 1) {
                const names = await table('name');
                if (!names || names.length < 6) continue;
                let matches = false;
                for (let i = 0; i < names.readUInt16BE(2); i++) {
                    const at = 6 + i * 12;
                    if (at + 12 > names.length) throw new Error('Invalid font name records.');
                    if (names.readUInt16BE(at + 6) !== 6) continue;
                    const start = names.readUInt16BE(4) + names.readUInt16BE(at + 10), length = names.readUInt16BE(at + 8);
                    if (start + length > names.length) throw new Error('Invalid font name text.');
                    const bytes = Buffer.from(names.subarray(start, start + length)), platform = names.readUInt16BE(at);
                    const name = platform === 0 || platform === 3 ? bytes.swap16().toString('utf16le') : bytes.toString('utf8');
                    if (name === postscriptName) matches = true;
                }
                if (!matches) continue;
            }
            const head = await table('head'), os2 = await table('OS/2'), hhea = await table('hhea');
            if (!head || head.length < 20) throw new Error('Font has no em metrics.');
            const units = head.readUInt16BE(18);
            // libass set_font_metrics intentionally mimics GDI, then uses REAL_DIM.
            // CSS instead requests the font's em square. Their exact conversion is
            // (WinAscent + WinDescent) / unitsPerEm, not a platform-wide guessed factor.
            let realHeight = os2 && os2.length >= 78 ? os2.readInt16BE(74) + os2.readInt16BE(76) : 0;
            if (!realHeight && os2 && os2.length >= 74 && (os2.readUInt16BE(62) & 128)) realHeight = os2.readInt16BE(68) - os2.readInt16BE(70);
            if (!realHeight && hhea && hhea.length >= 8) realHeight = hhea.readInt16BE(4) - hhea.readInt16BE(6);
            if (!realHeight && os2 && os2.length >= 74) realHeight = os2.readInt16BE(68) - os2.readInt16BE(70);
            if (units <= 0 || realHeight <= 0 || realHeight / units < .25 || realHeight / units > 5) throw new Error('Unsupported font em metrics.');
            return realHeight / units;
        }
        throw new Error('The selected font face was not found in its collection.');
    } finally { await file.close(); }
}

/** Ask the same libass/font provider used by export for its actual face, then cache only tiny metrics. */
export async function resolveComicFontMetrics(ffmpeg: string, family: string, bold: boolean, temporaryRoot: string, signal: AbortSignal): Promise<ComicFontMetrics> {
    const key = `${ffmpeg}\0${family}\0${bold}`, known = cache.get(key);
    if (signal.aborted) throw new Error('Font measurement cancelled.');
    if (known) return known;
    const path = join(temporaryRoot, `composition-font-${randomUUID()}.ass`);
    await writeFile(path, `[Script Info]\nScriptType: v4.00+\nPlayResX: 32\nPlayResY: 32\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, Bold\nStyle: Default,${family},12,&H00FFFFFF,${bold ? -1 : 0}\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,A\n`, { flag: 'wx', mode: 0o600 });
    const log = await new Promise<string>((resolve, reject) => {
        const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'verbose', '-f', 'lavfi', '-i', 'color=c=black:s=32x32:r=1:d=1',
            '-vf', `ass=filename='${filterPath(path)}'`, '-frames:v', '1', '-f', 'null', '-'], { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '', settled = false;
        const finish = (error?: Error): void => {
            if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
            if (error) { child.kill('SIGKILL'); reject(error); } else resolve(stderr);
        };
        const abort = (): void => finish(new Error('Font measurement cancelled.'));
        const timer = setTimeout(() => finish(new Error('Font measurement timed out.')), 15_000);
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); if (stderr.length > 128 * 1024) finish(new Error('Font measurement log exceeded its limit.')); });
        child.once('error', finish); child.once('close', code => finish(code === 0 ? undefined : new Error('Cannot resolve the export font.')));
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
    const selected = /fontselect: .*? -> (.+), (-?\d+), ([^\r\n]+)(?:\r?\n|$)/u.exec(log);
    let ratio: number | undefined;
    if (selected && isAbsolute(selected[1])) {
        try { ratio = await readComicFontEmRatio(selected[1], Number(selected[2]), selected[3].trim()); }
        catch { /* Optional sizing metadata must not prevent an otherwise working FFmpeg font from rendering. */ }
    }
    else if (selected) {
        // DirectWrite can return a memory-backed face name rather than a file path.
        // Check only standard files for the one configured family, never scan disks.
        const candidates = process.platform === 'win32' && family === 'Microsoft YaHei'
            ? [join(process.env.WINDIR || 'C:\\Windows', 'Fonts', bold ? 'msyhbd.ttc' : 'msyh.ttc')]
            : process.platform === 'linux' && family === 'Noto Sans CJK SC'
                ? ['/usr/share/fonts/opentype/noto', '/usr/share/fonts/truetype/noto', '/usr/share/fonts/noto-cjk', '/usr/share/fonts/google-noto-cjk']
                    .map(directory => join(directory, `NotoSansCJK-${bold ? 'Bold' : 'Regular'}.ttc`)) : [];
        for (const candidate of candidates) {
            try { ratio = await readComicFontEmRatio(candidate, -1, selected[3].trim()); break; } catch { /* This standard file is absent or does not contain the selected face. */ }
        }
    }
    if (signal.aborted) throw new Error('Font measurement cancelled.');
    if (ratio === undefined) {
        // Preserve the preexisting renderer on providers that expose no readable
        // metrics. Do not guess a multiplier or break every export on that system.
        console.warn(`[NextMux comic export] ${family}: font provider exposes no verifiable em metrics; retaining legacy ASS sizing.`);
    }
    const metrics = { family, postscriptName: selected?.[3].trim() || family, emToAss: ratio ?? 1 };
    cache.set(key, metrics);
    if (cache.size > 16) cache.delete(cache.keys().next().value!);
    return metrics;
}
