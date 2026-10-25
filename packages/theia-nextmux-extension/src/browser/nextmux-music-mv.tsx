import { MediaDiagnostic } from './nextmux-media-diagnostics';
import * as React from '@theia/core/shared/react';
import type { ComicMusicLyricLine, ComicMusicMvSegment, ComicMusicMvSettings } from '@nextmux/comic-core';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { ImeTextarea } from './nextmux-ime-field';
import { musicMvText, MusicMvTextKey } from './nextmux-music-mv-locale';
export { musicMvText } from './nextmux-music-mv-locale';

export interface MusicMvVisual extends ComicMusicMvSegment {
    readonly url?: string;
    readonly running?: boolean;
    readonly error?: string;
    readonly errorDetail?: string;
}
export interface MusicMvViewProps {
    readonly locale: NextMuxDesktopLocale;
    readonly songUrl?: string;
    readonly coverUrl?: string;
    readonly ratio: string;
    readonly durationMs: number;
    readonly alignment: ComicMusicMvSettings['alignment'];
    readonly lines: readonly ComicMusicLyricLine[];
    readonly segments: readonly MusicMvVisual[];
    readonly videoModel: React.ReactNode;
    /** The singer photo shared by every performance shot (rendered by the widget). */
    readonly singerPortrait?: React.ReactNode;
    readonly modelName: string;
    readonly estimateForSegments: (ids: readonly string[]) => string;
    /** Includes route, model, quote and segment inputs; changed inputs invalidate an open confirmation. */
    readonly confirmationKey: string;
    readonly canGenerate: boolean;
    readonly blockedReason?: string;
    readonly busy?: boolean;
    readonly aligning?: boolean;
    readonly error?: string;
    readonly errorDetail?: string;
    readonly onAlign: () => void;
    readonly onTap: (lineId: string, timeMs: number) => void;
    readonly onNudge: (lineId: string, deltaMs: number) => void;
    readonly onSegmentPrompt: (id: string, prompt: string) => void;
    readonly onSegmentSource: (id: string, source: ComicMusicMvSegment['source']) => void;
    readonly onImport: (id: string, source: 'upload-image' | 'upload-video') => void;
    readonly onGenerate: (ids: readonly string[], confirmationKey: string) => void;
    readonly onRebuild: () => void;
    readonly onDuration?: (durationMs: number) => void;
    readonly onNext: () => void;
}

/** End boundaries are exclusive, so a cut switches visuals and subtitles on the same audio clock. */
export function musicMvActiveIndex(items: readonly { startMs: number; endMs: number }[], timeMs: number): number {
    return items.findIndex(item => timeMs >= item.startMs && timeMs < item.endMs);
}
export function musicMvVideoTime(timeMs: number, startMs: number, durationSeconds: number): number {
    const position = Math.max(0, (timeMs - startMs) / 1_000);
    return Number.isFinite(durationSeconds) && durationSeconds > 0 ? position % durationSeconds : position;
}
/** A held space key or IME composition must never consume more lyric lines. */
export function musicMvAcceptsTap(key: string, repeat: boolean, composing: boolean, editing: boolean): boolean {
    return (key === ' ' || key === 'Spacebar') && !repeat && !composing && !editing;
}
const clock = (ms: number): string => {
    const tenths = Math.max(0, Math.round(ms / 100));
    return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
};

function VisualPrompt(props: { readonly value: string; readonly label: string; readonly disabled: boolean; readonly onCommit: (value: string) => void }): React.ReactElement {
    const [value, setValue] = React.useState(props.value);
    React.useEffect(() => setValue(props.value), [props.value]);
    return <label className='nmx-music-field'><span>{props.label}</span>
        <ImeTextarea rows={3} maxLength={2_000} value={value} disabled={props.disabled} onChange={event => setValue(event.currentTarget.value)}
            onBlur={() => { if (value.trim() !== props.value.trim()) props.onCommit(value.trim()); }} /></label>;
}

/** Presentation only: media, recognition, queueing and durable project changes belong to the widget. */
export function MusicMvView(props: MusicMvViewProps): React.ReactElement {
    const t = (key: MusicMvTextKey, values?: Readonly<Record<string, string | number>>): string => musicMvText(props.locale, key, values);
    const audio = React.useRef<HTMLAudioElement>(null);
    const video = React.useRef<HTMLVideoElement>(null);
    const panel = React.useRef<HTMLElement>(null);
    const [timeMs, setTimeMs] = React.useState(0);
    const [playing, setPlaying] = React.useState(false);
    const [tapIndex, setTapIndex] = React.useState<number | undefined>();
    const [tapComplete, setTapComplete] = React.useState(false);
    const [playbackError, setPlaybackError] = React.useState(false);
    const [pending, setPending] = React.useState<{ ids: readonly string[]; key: string; estimate: string; model: string } | undefined>();
    const [rebuild, setRebuild] = React.useState(false);
    const disabled = !!props.busy || !!props.aligning;
    const activeLineIndex = musicMvActiveIndex(props.lines, timeMs);
    const activeLine = props.lines[activeLineIndex];
    const activeSegment = props.segments[musicMvActiveIndex(props.segments, timeMs)];
    const aiIds = props.segments.filter(segment => segment.source === 'ai-video' && !segment.running).map(segment => segment.id);
    const lyricIdentity = props.lines.map(line => `${line.id}:${line.text}`).join('\n');

    React.useEffect(() => {
        setTimeMs(0); setPlaying(false); setTapIndex(undefined); setTapComplete(false); setPlaybackError(false);
    }, [props.songUrl, lyricIdentity]);
    React.useEffect(() => { setPending(undefined); }, [props.confirmationKey]);
    React.useEffect(() => {
        if (!playing) return;
        let request = 0;
        let last = 0;
        const tick = (now: number): void => {
            if (now - last >= 40) { setTimeMs((audio.current?.currentTime || 0) * 1_000); last = now; }
            request = requestAnimationFrame(tick);
        };
        request = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(request);
    }, [playing]);

    const syncVideo = (): void => {
        const node = video.current;
        if (!node || !activeSegment || !node.readyState) return;
        const position = musicMvVideoTime(timeMs, activeSegment.startMs, node.duration);
        if (Math.abs(node.currentTime - position) > .15) node.currentTime = position;
        node.playbackRate = audio.current?.playbackRate || 1;
        if (playing && node.paused) void node.play().catch(() => setPlaybackError(true));
        else if (!playing && !node.paused) node.pause();
    };
    React.useEffect(syncVideo, [timeMs, playing, activeSegment?.id, activeSegment?.url]);

    const seekLine = (index: number): void => {
        const line = props.lines[index];
        if (!line || !audio.current) return;
        audio.current.currentTime = Math.max(0, line.startMs / 1_000);
        setTimeMs(line.startMs);
        if (tapIndex !== undefined) setTapIndex(index);
        panel.current?.focus();
    };
    const toggleTap = (): void => {
        if (tapIndex !== undefined) { setTapIndex(undefined); return; }
        if (!audio.current || !props.lines.length) return;
        audio.current.currentTime = 0;
        setTimeMs(0); setTapIndex(0); setTapComplete(false); setPlaybackError(false);
        panel.current?.focus();
        void audio.current.play().catch(() => { setPlaybackError(true); setTapIndex(undefined); });
    };
    const tap = (event: React.KeyboardEvent<HTMLElement>): void => {
        if (tapIndex === undefined || disabled || audio.current?.paused) return;
        const target = event.target as HTMLElement;
        const editing = !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
        if (!musicMvAcceptsTap(event.key, event.repeat, event.nativeEvent.isComposing, editing)) return;
        event.preventDefault(); event.stopPropagation();
        const line = props.lines[tapIndex];
        if (!line) return;
        props.onTap(line.id, Math.min(props.durationMs, Math.max(0, Math.round((audio.current?.currentTime || 0) * 1_000))));
        if (tapIndex + 1 >= props.lines.length) { setTapIndex(undefined); setTapComplete(true); }
        else setTapIndex(tapIndex + 1);
    };
    const requestGenerate = (ids: readonly string[]): void => {
        if (!ids.length || !props.canGenerate || disabled) return;
        setRebuild(false);
        setPending({ ids: [...ids], key: props.confirmationKey, estimate: props.estimateForSegments(ids), model: props.modelName });
    };
    const confirmGenerate = (): void => {
        if (!pending || pending.key !== props.confirmationKey || !props.canGenerate || disabled) return;
        const confirmed = pending; setPending(undefined);
        props.onGenerate(confirmed.ids, confirmed.key);
    };
    const sourceLabel = (source: ComicMusicMvSegment['source']): string => t(source === 'ai-video' ? 'aiVideo' : source === 'upload-image' ? 'uploadImage' : 'uploadVideo');

    return <section className='nmx-music-mv' ref={panel} tabIndex={-1} onKeyDown={tap} aria-label={t('title')}>
        <div className='nmx-music-mv-heading'><div><h2>{t('title')}</h2><p>{t('lead')}</p></div>
            <button type='button' className='nmx-primary-button' disabled={!props.songUrl || disabled} onClick={props.onNext}>{t('next')}<i className='codicon codicon-arrow-right' aria-hidden='true' /></button></div>
        {!props.songUrl && <p className='nmx-music-note'>{t('needSong')}</p>}
        {props.error && <><p className='nmx-agent-inline-error' role='alert' data-nmx-literal>{props.error}</p><MediaDiagnostic locale={props.locale} detail={props.errorDetail} /></>}
        <div className='nmx-music-mv-workbench'>
            <div className='nmx-music-card nmx-music-mv-preview'>
                <header><h3>{t('preview')}</h3><small data-nmx-literal>{clock(timeMs)} / {clock(props.durationMs)}</small></header>
                <div className='nmx-music-mv-frame' data-aspect-ratio={props.ratio}>
                    {activeSegment?.url ? activeSegment.source === 'upload-image'
                        ? <img src={activeSegment.url} alt='' />
                        : <video key={`${activeSegment.id}:${activeSegment.url}`} ref={video} src={activeSegment.url} muted loop playsInline preload='auto' onLoadedMetadata={syncVideo} onError={() => setPlaybackError(true)} />
                        : props.coverUrl ? <img src={props.coverUrl} alt='' />
                            : <span className='nmx-music-mv-placeholder'><i className='codicon codicon-device-camera-video' aria-hidden='true' />{t('noVisuals')}</span>}
                    {activeSegment && <span className='nmx-music-mv-frame-index' data-nmx-literal>{t('segment', { n: props.segments.indexOf(activeSegment) + 1 })}</span>}
                    {activeLine && <span className='nmx-music-mv-subtitle' data-nmx-literal>{activeLine.text}</span>}
                </div>
                <audio ref={audio} controls src={props.songUrl} preload='metadata' aria-label={t('preview')} controlsList='nodownload noplaybackrate'
                    onTimeUpdate={event => setTimeMs(event.currentTarget.currentTime * 1_000)}
                    onSeeked={event => setTimeMs(event.currentTarget.currentTime * 1_000)}
                    onPlay={() => { setPlaying(true); setPlaybackError(false); }} onPause={() => setPlaying(false)}
                    onEnded={() => { setPlaying(false); setTapIndex(undefined); }} onError={() => setPlaybackError(true)}
                    onLoadedMetadata={event => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0) props.onDuration?.(Math.round(duration * 1_000)); }} />
                {playbackError && <p className='nmx-agent-inline-error' role='alert'>{t('playbackError')}</p>}
                <p className='nmx-music-note'>{t('clipLoopHint')}</p>
            </div>
            <div className='nmx-music-card nmx-music-mv-alignment'>
                <header><h3>{t('alignment')}</h3><span className={`nmx-music-mv-badge is-${props.alignment}`}>{t(props.alignment)}</span></header>
                <div className='nmx-music-mv-tools'>
                    <button type='button' className='nmx-secondary-button' disabled={!props.songUrl || disabled} onClick={props.onAlign}>
                        <i className={`codicon codicon-${props.aligning ? 'loading codicon-modifier-spin' : 'mic'}`} aria-hidden='true' />{t(props.aligning ? 'aligning' : 'autoAlign')}</button>
                    <button type='button' className={`nmx-secondary-button ${tapIndex !== undefined ? 'is-active' : ''}`} disabled={!props.songUrl || disabled || !props.lines.length} onClick={toggleTap} aria-pressed={tapIndex !== undefined}>
                        <i className='codicon codicon-pulse' aria-hidden='true' />{t(tapIndex === undefined ? 'tapStart' : 'tapStop')}</button>
                </div>
                {props.lines.some(line => (line.alignment || props.alignment) === 'estimated') && <p className='nmx-music-note is-warn'>{t('estimateNote')}</p>}
                {tapIndex !== undefined && <div className='nmx-music-progress' role='status'><kbd>Space</kbd><span>{t('tapHint')}<strong data-nmx-literal>{t('tapNext', { text: props.lines[tapIndex]?.text || '' })}</strong></span></div>}
                {tapComplete && <p className='nmx-music-note is-done' role='status'>{t('tapComplete')}</p>}
                {props.lines.length === 0 ? <p className='nmx-music-note'>{t('noLyrics')}</p> : <ol className='nmx-music-mv-lines'>
                    {props.lines.map((line, index) => <li key={line.id} className={`${index === activeLineIndex ? 'is-current' : ''} ${index === tapIndex ? 'is-tap-next' : ''}`} aria-current={index === activeLineIndex ? 'true' : undefined}>
                        <button type='button' className='nmx-music-mv-line' onClick={() => seekLine(index)} disabled={!props.songUrl}>
                            <span data-nmx-literal>{line.text}</span><small><span data-nmx-literal>{clock(line.startMs)} – {clock(line.endMs)}</span><em>{t(line.alignment || props.alignment)}</em></small></button>
                        <span className='nmx-music-mv-nudge'><button type='button' disabled={disabled} aria-label={`${line.text}: ${t('earlier')}`} title={t('earlier')} onClick={() => props.onNudge(line.id, -100)}>−0.1</button>
                            <button type='button' disabled={disabled} aria-label={`${line.text}: ${t('later')}`} title={t('later')} onClick={() => props.onNudge(line.id, 100)}>+0.1</button></span>
                    </li>)}
                </ol>}
            </div>
        </div>
        <div className='nmx-music-card nmx-music-mv-sections'>
            <header><div><h3>{t('segments')}</h3><p>{t('segmentsLead')}</p></div>
                <button type='button' className='nmx-secondary-button' disabled={!props.songUrl || disabled || props.segments.some(segment => segment.running)} onClick={() => { setPending(undefined); setRebuild(true); }}>{t('rebuild')}</button></header>
            {props.videoModel}
            {props.singerPortrait}
            <div className='nmx-music-mv-generation'><small data-nmx-literal>{t('count')}: {aiIds.length} · {props.estimateForSegments(aiIds)}</small>
                <button type='button' className='nmx-primary-button' disabled={!props.songUrl || disabled || !props.canGenerate || aiIds.length === 0} onClick={() => requestGenerate(aiIds)} title={props.blockedReason}>
                    <i className='codicon codicon-sparkle' aria-hidden='true' />{t('generateAll')}</button></div>
            {props.blockedReason && <p className='nmx-music-note is-warn' data-nmx-literal>{props.blockedReason}</p>}
            {pending && <div className='nmx-music-mv-confirm' role='alertdialog' aria-label={t('confirmTitle')}>
                <h3>{t('confirmTitle')}</h3><p>{t('confirmLead')}</p><dl><div><dt>{t('model')}</dt><dd data-nmx-literal>{pending.model}</dd></div>
                    <div><dt>{t('count')}</dt><dd data-nmx-literal>{pending.ids.length}</dd></div><div><dt>{t('estimate')}</dt><dd data-nmx-literal>{pending.estimate}</dd></div></dl>
                <div className='nmx-music-actions'><button type='button' className='nmx-secondary-button' onClick={() => setPending(undefined)}>{t('cancel')}</button>
                    <button type='button' className='nmx-primary-button' disabled={disabled || !props.canGenerate || pending.key !== props.confirmationKey} onClick={confirmGenerate}>{t('confirm')}</button></div>
            </div>}
            {rebuild && <div className='nmx-music-mv-confirm' role='alertdialog' aria-label={t('rebuild')}><h3>{t('rebuild')}</h3><p>{t('rebuildLead')}</p>
                <div className='nmx-music-actions'><button type='button' className='nmx-secondary-button' onClick={() => setRebuild(false)}>{t('cancel')}</button>
                    <button type='button' className='nmx-primary-button' disabled={disabled} onClick={() => { setRebuild(false); props.onRebuild(); }}>{t('rebuild')}</button></div></div>}
            <div className='nmx-music-mv-grid'>{props.segments.map((segment, index) => <article key={segment.id} className='nmx-music-mv-segment'>
                <header><strong data-nmx-literal>{t('segment', { n: index + 1 })}</strong><small data-nmx-literal>{t('seconds', { n: ((segment.endMs - segment.startMs) / 1_000).toFixed(1) })}</small></header>
                <div className='nmx-music-mv-thumbnail'>{segment.url ? segment.source === 'upload-image' ? <img src={segment.url} alt='' /> : <video src={segment.url} muted preload='metadata' playsInline />
                    : <i className={`codicon codicon-${segment.source === 'upload-image' ? 'file-media' : 'device-camera-video'}`} aria-hidden='true' />}
                    <span className={`nmx-music-mv-badge ${segment.running ? 'is-generating' : segment.url ? 'is-ready' : ''}`}>{t(segment.running ? 'running' : segment.url ? 'ready' : 'missing')}</span></div>
                <small className='nmx-music-mv-range' data-nmx-literal>{clock(segment.startMs)} – {clock(segment.endMs)}</small>
                <label className='nmx-music-field'><span>{t('source')}</span><select value={segment.source} disabled={disabled || segment.running} onChange={event => props.onSegmentSource(segment.id, event.currentTarget.value as ComicMusicMvSegment['source'])}>
                    {(['ai-video', 'upload-image', 'upload-video'] as const).map(source => <option key={source} value={source}>{sourceLabel(source)}</option>)}</select></label>
                <VisualPrompt value={segment.prompt} label={t('prompt')} disabled={disabled || !!segment.running} onCommit={prompt => props.onSegmentPrompt(segment.id, prompt)} />
                {segment.error && <p className='nmx-agent-inline-error' role='alert' data-nmx-literal>{segment.error}</p>}
                <footer>{segment.source === 'ai-video'
                    ? <button type='button' className='nmx-secondary-button' disabled={disabled || segment.running || !props.canGenerate} title={props.blockedReason} onClick={() => requestGenerate([segment.id])}><i className='codicon codicon-sparkle' aria-hidden='true' />{t(segment.url ? 'regenerate' : 'generate')}</button>
                    : <button type='button' className='nmx-secondary-button' disabled={disabled || segment.running} onClick={() => props.onImport(segment.id, segment.source === 'upload-image' ? 'upload-image' : 'upload-video')}><i className='codicon codicon-cloud-upload' aria-hidden='true' />{t(segment.url ? 'replace' : 'upload')}</button>}</footer>
            </article>)}</div>
        </div>
    </section>;
}
