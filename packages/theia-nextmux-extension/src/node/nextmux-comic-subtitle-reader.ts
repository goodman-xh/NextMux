import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

export interface ComicSubtitleCue { readonly text: string; readonly startFrame: number; readonly durationFrames: number }
export function parseComicSubtitleSrt(text: string, frameRate: number, streamStartMs = 0): readonly ComicSubtitleCue[] {
    const time = (value: string): number => {
        const m = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
        return m ? (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4]) - streamStartMs : NaN;
    };
    const cues: ComicSubtitleCue[] = [];
    for (const block of text.trim().split(/\r?\n\s*\r?\n/u)) {
        const lines = block.split(/\r?\n/u), index = lines.findIndex(line => line.includes('-->'));
        if (index < 0) continue;
        const [start, end] = lines[index].split('-->').map(value => time(value.trim().split(/\s+/u)[0]));
        const content = lines.slice(index + 1).join('\n').replace(/<[^>]+>/gu, '').trim();
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= 0 || !content) continue;
        const startFrame = Math.max(0, Math.round(start * frameRate / 1000));
        const endFrame = Math.max(startFrame + 1, Math.round(end * frameRate / 1000));
        if (content.length > 20_000 || cues.length >= 20_000) throw new Error('Subtitle cue limit exceeded.');
        cues.push({ text: content, startFrame, durationFrames: endFrame - startFrame });
    }
    return cues;
}

/** Complete, bounded subtitle reads for both preview and export; never silently keep only the tail. */
export async function readComicSubtitleCues(ffmpeg: string, pathname: string, frameRate: number, signal: AbortSignal,
    streamStartMs = 0, allowMissingStream = false): Promise<readonly ComicSubtitleCue[]> {
    if (signal.aborted) throw new Error('Subtitle extraction cancelled.');
    const text = await new Promise<string>((resolve, reject) => {
        const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-copyts', '-i', pathname,
            '-map', '0:s:0', '-c:s', 'srt', '-f', 'srt', 'pipe:1'], { cwd: dirname(pathname), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks: Buffer[] = []; let bytes = 0, stderr = '', settled = false;
        const finish = (error?: Error): void => {
            if (settled) return; settled = true;
            clearTimeout(timer); signal.removeEventListener('abort', abort);
            if (error) { child.kill('SIGKILL'); reject(error); } else resolve(Buffer.concat(chunks).toString('utf8'));
        };
        const abort = (): void => finish(new Error('Subtitle extraction cancelled.'));
        const timer = setTimeout(() => finish(new Error('Subtitle extraction timed out.')), 60_000);
        signal.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 16 * 1024 * 1024) finish(new Error('Subtitle text exceeds 16 MiB.'));
            else chunks.push(chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000); });
        child.once('error', finish);
        child.once('close', code => finish(code === 0 || allowMissingStream && /Stream map ['"]0:s:0['"] matches no streams\./u.test(stderr)
            ? undefined : new Error(stderr || 'Cannot read subtitle source.')));
        if (signal.aborted) abort();
    });
    return parseComicSubtitleSrt(text, frameRate, streamStartMs);
}
