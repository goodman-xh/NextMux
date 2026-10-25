import {comicClipHasVisualProcessing,comicVisualPropertyBase,comicVisualOutputSize} from '@nextmux/comic-core/visual-effects';
import {renderComicVisualFrames} from './nextmux-comic-visual-export';
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComicProject } from '@nextmux/comic-core';
import { comicCompositionDurationFrames, comicCompositionClipPermissions, comicCompositionTextLines, type ComicComposition, type ComicCompositionClip,
    type ComicCompositionProperty, type ComicCompositionKeyframe } from '@nextmux/comic-core/composition';
import { readComicSubtitleCues } from './nextmux-comic-subtitle-reader';
import { resolveComicFontMetrics } from './nextmux-comic-font-metrics';

export interface ComicCompositionExportHost {
    readonly ffmpeg: string; readonly temporaryRoot: string; readonly signal: AbortSignal;
    readonly quality: 'draft' | 'balanced' | 'high';
    resolveAsset(asset: ComicProject['assets'][number], title: string): Promise<string>;
    probe(path: string, kind: 'image' | 'video' | 'music'): Promise<{ durationMs?: number; width?: number; height?: number; streamStartMs?: number }>;
    hasAudio(path: string): Promise<boolean>;
    run(args: readonly string[], timeout: number): Promise<void>;
    verify(path: string, frames: number): Promise<void>;
    progress(fraction: number): Promise<void>;
    fail(code: string, detail: string): never;
}
interface PreparedClip {
    readonly clip: ComicCompositionClip; readonly from: number; readonly end: number;
    readonly visible: boolean; readonly audible: boolean; readonly trackVolume: number;
    readonly path?: string; readonly text?: string; readonly width?: number; readonly height?: number;
    readonly origin?: number; readonly audioOrigin?: number;
}
export interface ComicCompositionExportPlan {
    readonly composition: ComicComposition; readonly durationFrames: number; readonly clips: readonly PreparedClip[];
    readonly subtitles: readonly { readonly from: number; readonly durationFrames: number; readonly text: string }[];
}
const number = (value: number): string => Number(value.toFixed(10)).toString();
const bounded = (expression: string, minimum: number, maximum: number): string => `min(${maximum},max(${minimum},${expression}))`;
const filterPath = (value: string): string => value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\''");
const assText = (value: string): string => value.replace(/\\/g, '＼').replace(/{/g, '｛').replace(/}/g, '｝')
    .replace(/\r\n?|\n/g, '\\N').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const assColor = (value: string): string => {
    const hex = value.slice(1), alpha = hex.length === 8 ? 255 - parseInt(hex.slice(6), 16) : 0;
    return `&H${alpha.toString(16).padStart(2, '0')}${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
};
/** Transparent full-canvas text plane, using the same explicit line layout as preview. */
function compositionTextAss(text: string, clip: ComicCompositionClip, width: number, height: number, seconds: number, emToAss: number): string {
    const style = clip.textStyle, size = style?.fontSize ?? 56;
    const font = process.platform === 'darwin' ? 'PingFang SC' : process.platform === 'win32' ? 'Microsoft YaHei' : 'Noto Sans CJK SC';
    const align = style?.align === 'left' ? 4 : style?.align === 'right' ? 6 : 5;
    const x = align === 4 ? 0 : align === 6 ? width : width / 2;
    const background = style?.backgroundColor ? assColor(style.backgroundColor) : '&HFF000000';
    const lines = comicCompositionTextLines(text, size, width).split('\n');
    const end = `${Math.floor((seconds + 1) / 3600)}:${String(Math.floor((seconds + 1) / 60) % 60).padStart(2, '0')}:${((seconds + 1) % 60).toFixed(2).padStart(5, '0')}`;
    // ASS supports system CJK fallback and bold on the bundled FFmpeg builds without fontconfig.
    return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n`
        + 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
        + `Style: Default,${font},${number(size * emToAss)},${assColor(style?.color || '#ffffff')},&H00FFFFFF,${background},${background},${style?.bold ? -1 : 0},0,0,0,100,100,0,0,${style?.backgroundColor ? 3 : 1},0,0,${align},0,0,0,1\n\n[Events]\n`
        + 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
        // One positioned event per line keeps CSS's 1.2em line spacing. Letting ASS
        // choose multiline leading would reintroduce font-specific REAL_DIM spacing.
        + lines.map((line, index) => `Dialogue: 0,0:00:00.00,${end},Default,,0,0,0,,{\\an${align}\\q2\\pos(${x},${number(height / 2 + (index - (lines.length - 1) / 2) * size * 1.2)})}${assText(line)}`).join('\n') + '\n';
}
function easing(type: ComicCompositionKeyframe['easing'], value: number): number {
    return type === 'easeIn' ? value * value : type === 'easeOut' ? 1 - (1 - value) ** 2
        : type === 'easeInOut' ? value * value * (3 - 2 * value) : value;
}
function easingExpression(type: ComicCompositionKeyframe['easing'], value: string): string {
    return type === 'easeIn' ? `pow(${value},2)` : type === 'easeOut' ? `(1-pow(1-(${value}),2))`
        : type === 'easeInOut' ? `(pow(${value},2)*(3-2*(${value})))` : value;
}
/** Same local-frame interpolation and cropped easing intervals as the shared preview evaluator. */
export function comicCompositionPropertyExpression(clip: ComicCompositionClip, property: ComicCompositionProperty | 'brightness', frame: string,
    range: { from: number; end: number } = { from: 0, end: clip.durationFrames }): string {
    const f = bounded(frame, 0, clip.durationFrames);
    let keys = (clip.keyframes ?? []).filter(key => key.property === property).sort((a, b) => a.frame - b.frame);
    if (keys.length) {
        let first = 0;
        for (let index = 0; index < keys.length && keys[index].frame <= range.from; index++) first = index;
        const last = keys.findIndex(key => key.frame >= range.end);
        keys = keys.slice(first, last < 0 ? undefined : last + 1);
    }
    let value = number(property === 'brightness' ? 1 : property === 'volume' ? clip.volume ?? 1 : (property.includes(':')?comicVisualPropertyBase(clip,property):clip.transform?.[property as keyof NonNullable<ComicCompositionClip['transform']>]) ?? (property === 'scale' || property === 'opacity' ? 1 : 0));
    if (keys.length) {
        value = number(keys.at(-1)!.value);
        for (let index = keys.length - 1; index > 0; index--) {
            const a = keys[index - 1], b = keys[index], start = a.easingStart ?? 0, end = a.easingEnd ?? 1;
            const u = `((${f}-${a.frame})/${b.frame - a.frame})`, denominator = easing(a.easing, end) - easing(a.easing, start);
            const eased = denominator > 1e-12 ? `((${easingExpression(a.easing, `(${number(start)}+${number(end - start)}*${u})`)}-${number(easing(a.easing, start))})/${number(denominator)})` : u;
            const interval = a.easing === 'hold' ? number(a.value) : `(${number(a.value)}+${number(b.value - a.value)}*${eased})`;
            value = `if(lt(${f},${b.frame}),${interval},${value})`;
        }
        value = `if(lte(${f},${keys[0].frame}),${number(keys[0].value)},${value})`;
    }
    if (property === 'opacity' || property === 'volume' || property === 'brightness') {
        const envelope = clip.envelope, duration = envelope?.durationFrames ?? clip.durationFrames;
        const original = `(${f}+${envelope?.offsetFrames ?? 0})`;
        const fade = (incoming = 0, outgoing = 0, incomingStart = 0, outgoingEnd = duration): string => bounded(`min(${incoming ? `(${original}-${incomingStart})/${incoming}` : '1'},${outgoing ? `(${outgoingEnd}-${original})/${outgoing}` : '1'})`, 0, 1);
        const ordinary = property !== 'volume'
            ? fade(envelope?.fadeInFrames ?? clip.fadeInFrames, envelope?.fadeOutFrames ?? clip.fadeOutFrames, envelope?.fadeInStartFrame, envelope?.fadeOutEndFrame)
            : fade(envelope?.audioFadeInFrames ?? clip.audioFadeInFrames, envelope?.audioFadeOutFrames ?? clip.audioFadeOutFrames, envelope?.audioFadeInStartFrame, envelope?.audioFadeOutEndFrame);
        if (property === 'brightness') return clip.legacyFadeToBlack ? ordinary : '1';
        value = `(${value}*${property === 'opacity' && clip.legacyFadeToBlack ? '1' : ordinary}*${fade(envelope?.dissolveInFrames, property === 'volume' ? envelope?.dissolveOutFrames : 0)})`;
        if (property === 'opacity') value = bounded(value, 0, 1);
    }
    return value;
}

export async function prepareComicCompositionExport(project: ComicProject, composition: ComicComposition,
    subtitleMode: string, host: ComicCompositionExportHost): Promise<ComicCompositionExportPlan> {
    const durationFrames = comicCompositionDurationFrames(composition), assets = new Map(project.assets.map(asset => [asset.id, asset]));
    const paths = new Map<string, Promise<string>>(), measurements = new Map<string, ReturnType<ComicCompositionExportHost['probe']>>();
    const subtitleReads = new Map<string, ReturnType<typeof readComicSubtitleCues>>();
    let subtitleCount = 0;
    const clips: PreparedClip[] = [], subtitles: { from: number; durationFrames: number; text: string }[] = [];
    const measure = (path: string, kind: 'image' | 'video' | 'music') => {
        const key = `${kind}:${path}`;
        let pending = measurements.get(key);
        if (!pending) { pending = host.probe(path, kind); measurements.set(key, pending); }
        return pending;
    };
    for (const track of composition.tracks) for (const clip of composition.clips.filter(item => item.trackId === track.id)) {
        if (host.signal.aborted) host.fail('CANCELLED', 'Export cancelled.');
        const sample = comicCompositionClipPermissions(composition, clip);
        const isSubtitle = clip.kind === 'text' && clip.purpose === 'subtitle';
        const visible = sample.visible && (!isSubtitle || subtitleMode === 'burned');
        const audible = sample.audible;
        const needSubtitle = isSubtitle && sample.visible && subtitleMode !== 'none';
        if (!visible && !audible && !needSubtitle) continue;
        if (clip.missing || clip.kind === 'empty') host.fail('COMIC_EXPORT_VISUAL_MISSING', `${clip.title || clip.id}: a visible source is missing.`);
        const base = { clip, from: clip.from, end: clip.from + clip.durationFrames, visible, audible, trackVolume: track.volume ?? 1 };
        let path: string | undefined, asset: ComicProject['assets'][number] | undefined;
        if (clip.assetId) {
            asset = assets.get(clip.assetId);
            if (!asset) host.fail('COMIC_EXPORT_ASSET_INVALID', `${clip.title || clip.id}: asset is missing.`);
            let pending = paths.get(asset.id);
            if (!pending) { pending = host.resolveAsset(asset, clip.title || clip.id); paths.set(asset.id, pending); }
            path = await pending;
        }
        if (clip.kind === 'text') {
            if (path) {
                if (asset!.kind !== 'subtitle' && asset!.kind !== 'video') host.fail('COMIC_EXPORT_ASSET_INVALID', 'Text source must contain subtitles.');
                let pending = subtitleReads.get(path);
                if (!pending) {
                    const origin = asset!.kind === 'video' ? (await measure(path, 'video')).streamStartMs ?? 0 : 0;
                    pending = readComicSubtitleCues(host.ffmpeg, path, project.frameRate, host.signal, origin, asset!.kind === 'video');
                    subtitleReads.set(path, pending);
                }
                for (const cue of await pending) {
                    const start = Math.max(clip.sourceStartFrames, cue.startFrame), end = Math.min(clip.sourceStartFrames + clip.durationFrames, cue.startFrame + cue.durationFrames);
                    if (end <= start) continue;
                    if (++subtitleCount > 20_000) host.fail('COMIC_EXPORT_SUBTITLES_TOO_LARGE', 'Subtitle cue limit exceeded.');
                    const from = clip.from + start - clip.sourceStartFrames;
                    clips.push({ ...base, from, end: from + end - start, text: cue.text });
                    if (needSubtitle) subtitles.push({ from, durationFrames: end - start, text: cue.text });
                }
            } else if (clip.text?.trim()) {
                if (++subtitleCount > 20_000) host.fail('COMIC_EXPORT_SUBTITLES_TOO_LARGE', 'Subtitle cue limit exceeded.');
                clips.push({ ...base, text: clip.text });
                if (needSubtitle) subtitles.push({ from: clip.from, durationFrames: clip.durationFrames, text: clip.text });
            }
            continue;
        }
        if (!path || !asset) host.fail('COMIC_EXPORT_ASSET_INVALID', `${clip.title || clip.id}: media is missing.`);
        if (clip.kind === 'image' && asset.kind !== 'image' || clip.kind === 'video' && asset.kind !== 'video'
            || clip.kind === 'audio' && !['audio', 'music', 'effect', 'video'].includes(asset.kind)) host.fail('COMIC_EXPORT_ASSET_INVALID', 'Clip and source media types differ.');
        // Detached audio from a video retains that video's logical zero, just as browser
        // seeking does. An AAC track's encoder preroll is not a new source in-point.
        const probe = await measure(path, asset.kind === 'video' ? 'video' : clip.kind === 'audio' ? 'music' : 'image');
        if (clip.kind !== 'image' && (!probe.durationMs || (clip.sourceStartFrames + clip.durationFrames) * 1000 / project.frameRate > probe.durationMs + 1))
            host.fail('COMIC_EXPORT_SOURCE_RANGE_INVALID', `${clip.title || clip.id}: interval exceeds its actual source media.`);
        if (visible && (!probe.width || !probe.height)) host.fail('COMIC_EXPORT_ASSET_INVALID', 'Cannot measure the source picture.');
        let hasAudio = audible;
        let audioOrigin = probe.streamStartMs ?? 0;
        if (asset.kind === 'video' && audible) {
            hasAudio = await host.hasAudio(path);
            if (!hasAudio && clip.kind === 'audio') host.fail('COMIC_EXPORT_AUDIO_MISSING', `${clip.title || clip.id}: source video has no audio stream.`);
            if (hasAudio) audioOrigin = (await measure(path, 'music')).streamStartMs ?? 0;
        }
        clips.push({ ...base, path, audible: hasAudio, width: probe.width, height: probe.height, origin: (probe.streamStartMs ?? 0) / 1000, audioOrigin: audioOrigin / 1000 });
    }
    return { composition, durationFrames, clips, subtitles: subtitles.sort((a, b) => a.from - b.from) };
}

export function comicCompositionSubtitle(plan: ComicCompositionExportPlan, format: 'srt' | 'vtt' | 'ass', fps: number): string {
    if (!plan.subtitles.length) return '';
    const stamp = (frame: number, ass = false): string => {
        const ms = Math.round(frame * 1000 / fps), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
        return ass ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.floor(ms % 1000 / 10)).padStart(2, '0')}`
            : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${format === 'vtt' ? '.' : ','}${String(ms % 1000).padStart(3, '0')}`;
    };
    if (format === 'ass') return '[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\n'
        + 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
        + `Style: Default,${process.platform === 'darwin' ? 'PingFang SC' : process.platform === 'win32' ? 'Microsoft YaHei' : 'Noto Sans CJK SC'},48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,40,40,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
        + plan.subtitles.map(row => `Dialogue: 0,${stamp(row.from, true)},${stamp(row.from + row.durationFrames, true)},Default,,0,0,0,,${assText(row.text)}`).join('\n') + '\n';
    return `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${plan.subtitles.map((row, index) => `${index + 1}\n${stamp(row.from)} --> ${stamp(row.from + row.durationFrames)}\n${row.text}`).join('\n\n')}\n`;
}

/** Render only simultaneously active inputs. Sequential clips do not hold thousands of file descriptors. */
export async function renderComicCompositionExport(project: ComicProject, plan: ComicCompositionExportPlan, output: string,
    host: ComicCompositionExportHost): Promise<void> {
    const fps = project.frameRate, {width,height}=comicVisualOutputSize(project.canvas.width,project.canvas.height);
    const boundaries = new Set([0, plan.durationFrames]);
    for (const entry of plan.clips) {
        boundaries.add(entry.from); boundaries.add(entry.end);
        // Bound FFmpeg expression depth for heavily animated clips without sampling away keyframes.
        const keys = [...new Set((entry.clip.keyframes ?? []).map(key => key.frame))].sort((a, b) => a - b);
        for (let index = 32; index < keys.length; index += 32) boundaries.add(entry.clip.from + keys[index]);
    }
    const points = [...boundaries].filter(frame => frame >= 0 && frame <= plan.durationFrames).sort((a, b) => a - b);
    const segments: { path: string; frames: number }[] = [];
    for (let index = 0; index + 1 < points.length; index++) {
        if (host.signal.aborted) host.fail('CANCELLED', 'Export cancelled.');
        const from = points[index], frames = points[index + 1] - from, seconds = frames / fps;
        if (!frames) continue;
        const inputs: string[] = ['-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${seconds.toFixed(9)}`];
        const filters: string[] = ['[0:v]setpts=PTS-STARTPTS,format=yuv420p[base0]'];
        const active = plan.clips.filter(entry => entry.from <= from && entry.end > from && (entry.visible || entry.audible));
        const processing=active.some(entry=>entry.visible&&comicClipHasVisualProcessing(entry.clip));
        let input = 1, picture = 'base0'; const sounds: string[] = [];
        for (const [layer, entry] of active.entries()) {
            const clip = entry.clip, offset = from - clip.from, range = { from: offset, end: offset + frames };
            const f = `(N+${offset})`, sourceSeconds = (clip.sourceStartFrames + offset) / fps + (entry.origin ?? 0);
            if (clip.kind === 'text') {
                inputs.push('-f', 'lavfi', '-i', `color=c=black@0:s=${width}x${height}:r=${fps}:d=${seconds.toFixed(9)},format=rgba`);
            } else if (clip.kind === 'image') inputs.push('-loop', '1', '-framerate', String(fps), '-i', entry.path!);
            else inputs.push('-seek_timestamp', '1', '-ss', sourceSeconds.toFixed(9), '-i', entry.path!);
            if (entry.visible && !processing) {
                const chain = [`[${input}:v]setpts=PTS-STARTPTS,fps=${fps},trim=end_frame=${frames},format=rgba`];
                if (clip.kind === 'text') {
                    const textFile = join(host.temporaryRoot, `composition-text-${index}-${layer}.ass`);
                    const font = process.platform === 'darwin' ? 'PingFang SC' : process.platform === 'win32' ? 'Microsoft YaHei' : 'Noto Sans CJK SC';
                    const metrics = await resolveComicFontMetrics(host.ffmpeg, font, !!clip.textStyle?.bold, host.temporaryRoot, host.signal);
                    await writeFile(textFile, compositionTextAss(entry.text || '', clip, width, height, seconds, metrics.emToAss), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
                    chain.push(`ass=filename='${filterPath(textFile)}':alpha=1`);
                } else chain.push(clip.fit === 'cover'
                    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
                    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${clip.legacyFadeToBlack ? 'black' : 'black@0'}`);
                const x = comicCompositionPropertyExpression(clip, 'x', f, range), y = comicCompositionPropertyExpression(clip, 'y', f, range);
                const scale = comicCompositionPropertyExpression(clip, 'scale', f, range), rotation = `(${comicCompositionPropertyExpression(clip, 'rotation', f, range)}*PI/180)`;
                const opacity = comicCompositionPropertyExpression(clip, 'opacity', f, range);
                const brightness = comicCompositionPropertyExpression(clip, 'brightness', f, range);
                const transformed = (clip.keyframes ?? []).some(key => ['x', 'y', 'scale', 'rotation'].includes(key.property))
                    || (clip.transform?.x ?? 0) !== 0 || (clip.transform?.y ?? 0) !== 0 || (clip.transform?.scale ?? 1) !== 1 || (clip.transform?.rotation ?? 0) !== 0;
                if (transformed) {
                    // Inverse-map onto a fixed output canvas. Large zoom/rotation never allocates
                    // an enormous offscreen image, and out-of-source pixels remain transparent.
                    const dx = `(X-W/2-(${x}))`, dy = `(Y-H/2-(${y}))`;
                    const sx = `((cos(${rotation})*${dx}+sin(${rotation})*${dy})/(${scale})+W/2)`;
                    const sy = `((-sin(${rotation})*${dx}+cos(${rotation})*${dy})/(${scale})+H/2)`;
                    chain.push(`geq=r='r(${sx},${sy})*(${brightness})':g='g(${sx},${sy})*(${brightness})':b='b(${sx},${sy})*(${brightness})':a='if(between(${sx},0,W-1)*between(${sy},0,H-1),alpha(${sx},${sy})*(${opacity}),0)'`);
                } else if ((clip.transform?.opacity ?? 1) !== 1 || clip.keyframes?.some(key => key.property === 'opacity') || clip.fadeInFrames || clip.fadeOutFrames || clip.envelope) {
                    chain.push(`geq=r='r(X,Y)*(${brightness})':g='g(X,Y)*(${brightness})':b='b(X,Y)*(${brightness})':a='alpha(X,Y)*(${opacity})'`);
                }
                filters.push(`${chain.join(',')}[layer${layer}]`);
                filters.push(`[${picture}][layer${layer}]overlay=0:0:shortest=1:format=auto[base${layer + 1}]`);
                picture = `base${layer + 1}`;
            }
            if (entry.audible) {
                const delay = Math.max(0, (entry.audioOrigin ?? 0) - sourceSeconds);
                const volume = `(${comicCompositionPropertyExpression(clip, 'volume', `(t*${fps}+${offset})`, range)}*${number(entry.trackVolume)})`;
                const label = `sound${layer}`;
                filters.push(`[${input}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,`
                    + (delay ? `adelay=${(delay * 1000).toFixed(6)}|${(delay * 1000).toFixed(6)},` : '')
                    + `apad,atrim=duration=${seconds.toFixed(9)},asetpts=PTS-STARTPTS,aeval=exprs='val(0)*${volume}|val(1)*${volume}'[${label}]`);
                sounds.push(`[${label}]`);
            }
            input++;
        }
        if (!sounds.length) filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${seconds.toFixed(9)}[audio]`);
        else filters.push(sounds.length === 1 ? `${sounds[0]}anull[audio]` : `${sounds.join('')}amix=inputs=${sounds.length}:duration=longest:normalize=0:dropout_transition=0[audio]`);
        const graph = join(host.temporaryRoot, `composition-graph-${index}.txt`), segment = join(host.temporaryRoot, `composition-segment-${index}.mp4`);
        await writeFile(graph, filters.join(';\n'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await host.run(['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex_script', graph, '-map', `[${picture}]`, '-map', '[audio]',
            '-t', seconds.toFixed(9), '-r', String(fps), '-c:v', 'libx264', '-preset', host.quality === 'high' ? 'slow' : 'veryfast',
            '-crf', host.quality === 'draft' ? '28' : host.quality === 'high' ? '18' : '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
            '-b:a', host.quality === 'draft' ? '128k' : '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', segment], Math.min(6 * 60 * 60_000, Math.max(10 * 60_000, Math.ceil(seconds * 60_000))));
        let finalSegment=segment;
        if(processing){const visual=join(host.temporaryRoot,`composition-visual-${index}.mp4`),muxed=join(host.temporaryRoot,`composition-effects-${index}.mp4`);
            try{await renderComicVisualFrames({ffmpeg:host.ffmpeg,temporaryRoot:host.temporaryRoot,signal:host.signal,quality:host.quality,width,height,fps,from,frames,layers:active.filter(entry=>entry.visible),output:visual,onProgress:done=>host.progress((from+done)/plan.durationFrames)});}
            catch(error){host.fail(host.signal.aborted?'CANCELLED':'COMIC_EXPORT_VISUAL_PROCESSING_FAILED',error instanceof Error?error.message:String(error));}
            await host.verify(visual,frames);await host.run(['-hide_banner','-loglevel','error','-y','-i',visual,'-i',segment,'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',muxed],Math.max(60000,Math.ceil(seconds*3000)));finalSegment=muxed;
        }
        await host.verify(finalSegment, frames);
        segments.push({ path: finalSegment, frames });
        await host.progress(points[index + 1] / plan.durationFrames);
    }
    if (segments.length === 1) { await copyFile(segments[0].path, output, 1); return; }
    const concat = join(host.temporaryRoot, 'composition-concat.txt');
    await writeFile(concat, segments.map(segment => `file '${segment.path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'\nduration ${(segment.frames / fps).toFixed(9)}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    await host.run(['-hide_banner', '-loglevel', 'error', '-y', '-copyts', '-f', 'concat', '-safe', '0', '-i', concat,
        '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', output], Math.min(6 * 60 * 60_000, Math.max(60_000, Math.ceil(plan.durationFrames / fps * 3000))));
}
