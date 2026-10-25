import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

/** Packet-copy timing measures one selected stream rather than the longest stream in its container. */
export class ComicMediaPacketTiming {
    protected pending = '';
    protected timeBase = 0;
    protected firstPts = Infinity;
    protected lastPts = -Infinity;
    protected secondLastPts = -Infinity;
    protected finalDuration = 0;
    protected knownDuration = 0;
    protected frames = 0;

    append(value: string): void {
        const lines = `${this.pending}${value}`.split(/\r?\n/u);
        this.pending = lines.pop()?.slice(-2_048) || '';
        for (const line of lines) this.line(line);
    }

    protected line(line: string): void {
        const base = /^#tb 0:\s*(\d+)\/(\d+)/u.exec(line);
        if (base) {
            this.timeBase = Number(base[1]) / Number(base[2]);
            return;
        }
        // framecrc rows are stream, DTS, PTS, duration, size, checksum.
        const row = /^\s*0,\s*(-?\d+),\s*(-?\d+),\s*(\d+),/u.exec(line);
        if (!row) return;
        const pts = Number(row[2]), duration = Number(row[3]);
        if (!Number.isSafeInteger(pts) || !Number.isSafeInteger(duration)) return;
        this.frames += 1;
        this.firstPts = Math.min(this.firstPts, pts);
        if (duration > 0) this.knownDuration = duration;
        if (pts > this.lastPts) {
            this.secondLastPts = this.lastPts;
            this.lastPts = pts;
            this.finalDuration = duration;
        } else if (pts < this.lastPts && pts > this.secondLastPts) this.secondLastPts = pts;
    }

    result(playableStartSeconds?: number): { readonly durationMs: number; readonly frames: number; readonly streamStartMs: number } | undefined {
        if (this.pending) { this.line(this.pending); this.pending = ''; }
        if (!this.frames || !Number.isFinite(this.timeBase) || this.timeBase <= 0) return undefined;
        // Some containers omit packet duration. Infer the terminal interval from a known
        // duration or the last two presentation timestamps, never from a longer audio stream.
        const duration = this.finalDuration || this.knownDuration || this.lastPts - this.secondLastPts;
        if (!Number.isFinite(duration) || duration <= 0) return undefined;
        // The probe keeps absolute input timestamps. A positive origin is separate from
        // source capacity; negative preroll must not extend the playable source interval.
        const startSeconds = playableStartSeconds ?? Math.max(0, this.firstPts) * this.timeBase;
        // The asset schema stores whole milliseconds. Round upward so a complete 30 fps
        // frame (e.g. 4 frames = 133.333 ms) is not lost when core floors back to frames.
        const durationMs = Math.ceil(((this.lastPts + duration) * this.timeBase - startSeconds) * 1000 - 1e-7);
        const streamStartMs = Math.max(0, Math.floor(startSeconds * 1000 + 1e-7));
        return durationMs > 0 && durationMs <= 24 * 60 * 60_000 ? { durationMs, frames: this.frames, streamStartMs } : undefined;
    }
}

/** Constant-memory packet inventory; audio decodes its first frame to respect playable preroll. */
export function probeComicMediaPackets(ffmpeg: string, pathname: string, kind: 'video' | 'audio', signal?: AbortSignal, timeoutMs = 15_000): Promise<{
    readonly durationMs: number; readonly frames: number; readonly streamStartMs: number;
} | undefined> {
    if (signal?.aborted) return Promise.resolve(undefined);
    return new Promise(resolveProbe => {
        const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-copyts', '-i', pathname,
            '-map', kind === 'video' ? '0:v:0' : '0:a:0', kind === 'video' ? '-c:v' : '-c:a', 'copy',
            kind === 'video' ? '-an' : '-vn', '-sn', '-dn', '-f', 'framecrc', 'pipe:1'],
        { cwd: dirname(pathname), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
        const timing = new ComicMediaPacketTiming();
        let settled = false;
        let expired = false;
        const finish = (value: ReturnType<ComicMediaPacketTiming['result']>): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            resolveProbe(value);
        };
        const abort = (): void => { child.kill('SIGKILL'); finish(undefined); };
        const timer = setTimeout(() => { expired = true; abort(); }, timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout?.on('data', chunk => timing.append(String(chunk)));
        child.once('error', () => finish(undefined));
        child.once('close', async code => {
            if (code !== 0 || expired || signal?.aborted) return finish(undefined);
            clearTimeout(timer);
            // Only the first audio frame is decoded. This respects skip_samples/codec
            // preroll without decoding the entire file just to find its playable origin.
            const start = kind === 'audio' ? await probeComicFirstAudioFrameSeconds(ffmpeg, pathname, signal) : undefined;
            finish(kind === 'audio' && start === undefined ? undefined : timing.result(start));
        });
        if (signal?.aborted) abort();
    });
}

function probeComicFirstAudioFrameSeconds(ffmpeg: string, pathname: string, signal?: AbortSignal): Promise<number | undefined> {
    if (signal?.aborted) return Promise.resolve(undefined);
    return new Promise(resolveStart => {
        const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'info', '-copyts', '-i', pathname,
            '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', 'ashowinfo', '-frames:a', '1', '-f', 'null', '-'],
        { cwd: dirname(pathname), windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
        let pending = '', start: number | undefined, settled = false;
        const finish = (value: number | undefined): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            resolveStart(value);
        };
        const abort = (): void => { child.kill('SIGKILL'); finish(undefined); };
        const timer = setTimeout(abort, 15_000);
        signal?.addEventListener('abort', abort, { once: true });
        child.stderr?.on('data', chunk => {
            pending = `${pending}${String(chunk)}`.slice(-16_384);
            if (start === undefined) {
                const match = /ashowinfo[^\n]*?\bpts_time:([\d.e+-]+)/u.exec(pending);
                if (match && Number.isFinite(Number(match[1]))) start = Math.max(0, Number(match[1]));
            }
        });
        child.once('error', () => finish(undefined));
        child.once('close', code => finish(code === 0 && !signal?.aborted ? start : undefined));
        if (signal?.aborted) abort();
    });
}

export function probeComicVideoPackets(ffmpeg: string, pathname: string, signal?: AbortSignal, timeoutMs?: number): ReturnType<typeof probeComicMediaPackets> {
    return probeComicMediaPackets(ffmpeg, pathname, 'video', signal, timeoutMs);
}
