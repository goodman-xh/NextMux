import {comicVisualErrorText} from './nextmux-comic-visual-errors';
import {comicVisualOutputSize} from '@nextmux/comic-core/visual-effects';
import {ComicVisualRenderer,comicClipHasVisualProcessing} from '@nextmux/comic-core/visual-renderer';
import * as React from '@theia/core/shared/react';
import { sampleComicComposition, comicCompositionTextLines, evaluateComicCompositionClip, comicCompositionClipPermissions, type ComicComposition, type ComicCompositionSample } from '@nextmux/comic-core/composition';
import type { ComicCutAsset } from './nextmux-comic-cut';
import { formatEditorTime, type ComicEditorController, type ComicEditorPlaybackError, type ComicEditorState } from './nextmux-comic-editor';
import { comicStudioText } from './nextmux-comic-studio-text';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { comicCutLayoutText } from './nextmux-comic-cut-layout-text';
import { comicMultitrackText } from './nextmux-comic-multitrack-text';

export interface ComicMultitrackAsset extends ComicCutAsset { readonly streamStartMs?: number; }
export interface ComicMultitrackPlayerProps {
    readonly composition: ComicComposition;
    readonly mediaAssets: readonly ComicMultitrackAsset[];
    readonly fps: number;
    readonly projectCanvas: { readonly width: number; readonly height: number; readonly aspectRatio?: string };
    readonly locale: NextMuxDesktopLocale;
    readonly initialSeek?: { readonly seconds: number; readonly hold?: boolean };
    readonly onController?: (controller: ComicEditorController | undefined) => void;
    readonly onStateChange?: (state: ComicEditorState) => void;
    readonly onTick?: (seconds: number) => void;
    readonly onPlaybackError?: (error: ComicEditorPlaybackError) => void;
    readonly subtitlesVisible?: boolean;
    readonly onToggleSubtitles?: () => void;
    readonly onRecognize?: () => void;
    readonly recognition?: { readonly done: number; readonly total: number };
    readonly subtitleCues?: Readonly<Record<string, readonly { readonly startFrame: number; readonly durationFrames: number; readonly text: string }[]>>;
}
interface State { seconds: number; playing: boolean; speed: number; scale: number; expanded: boolean; error?: string; }
interface MediaEntry { element: HTMLMediaElement; url: string; attempt?: object; failed?: boolean; }
/** One monotonic transport drives every layer and independent sound. No video element owns the clock. */
export class ComicMultitrackPlayer extends React.Component<ComicMultitrackPlayerProps, State> {
    protected live = { seconds: 0, playing: false, speed: 1 };
    protected readonly media = new Map<string, MediaEntry>();
    protected readonly mediaRefs = new Map<string, { url: string; ref: (element: HTMLMediaElement | null) => void }>();
    protected readonly gains = new WeakMap<HTMLMediaElement, GainNode>();
    protected audioContext?: AudioContext;
    protected stage: HTMLDivElement | null = null;
    protected shell: HTMLDialogElement | null = null;
    protected expandButton: HTMLButtonElement | null = null;
    protected observer?: ResizeObserver;
    protected clock?: number;
    protected generation = 0;
    protected disposed = false;
    protected amplificationWarning = false;
    protected visualCanvas:HTMLCanvasElement|null=null; protected visualRenderer?:ComicVisualRenderer; protected readonly images=new Map<string,HTMLImageElement>(); protected visualPending=false;protected visualAgain=false;protected visualRevision=0;protected visualError?:string;
    protected lastTime = 0;
    protected controller: ComicEditorController = {
        play: () => this.play(), pause: () => this.pause(), seek: (seconds, hold) => this.seek(seconds, hold),
        nudge: delta => this.seek(this.live.seconds + delta, true), setSpeed: speed => this.setSpeed(speed), state: () => this.snapshot()
    };
    constructor(props: ComicMultitrackPlayerProps) {
        super(props);
        this.state = { ...this.live, scale: 1, expanded: false };
    }
    protected duration(): number { return Math.max(0, ...this.props.composition.clips.map(clip => clip.from + clip.durationFrames)) / this.props.fps; }
    protected snapshot(): ComicEditorState { return { ...this.live, duration: this.duration() }; }
    protected sample() {
        const frame = Math.max(0, Math.min(Math.max(0, Math.ceil(this.duration() * this.props.fps) - 1), this.live.seconds * this.props.fps));
        return sampleComicComposition(this.props.composition, frame);
    }
    protected upcoming(): readonly ComicCompositionSample[] {
        const frame=this.live.seconds*this.props.fps,composition=this.props.composition;
        const tracks=new Map(composition.tracks.map(track=>[track.id,track]));
        return composition.clips.filter(clip=>{
            if(clip.from<=frame||clip.from>frame+this.props.fps||clip.kind!=='video'&&clip.kind!=='audio')return false;
            const permission=comicCompositionClipPermissions(composition,clip);return permission.visible||permission.audible;
        }).sort((a,b)=>a.from-b.from).slice(0,4).flatMap(clip=>{
            const track=tracks.get(clip.trackId);return track?[{clip,track,localFrame:0,sourceFrame:clip.sourceStartFrames,...evaluateComicCompositionClip(clip,0),visible:false,audible:false}]:[];
        });
    }
    protected renderSamples(): readonly ComicCompositionSample[] {
        const tracks=new Map(this.props.composition.tracks.map((track,index)=>[track.id,index])),clips=new Map(this.props.composition.clips.map((clip,index)=>[clip.id,index]));
        return [...this.sample(),...this.upcoming()].sort((a,b)=>(tracks.get(a.track.id)!-tracks.get(b.track.id)!)||(clips.get(a.clip.id)!-clips.get(b.clip.id)!));
    }
    override componentDidMount(): void {
        this.observer = new ResizeObserver(() => this.measure());
        if (this.stage) this.observer.observe(this.stage);
        this.measure(); this.props.onController?.(this.controller);
        if (this.props.initialSeek) this.seek(this.props.initialSeek.seconds, this.props.initialSeek.hold);
        else this.publish();
    }
    override componentDidUpdate(previous: ComicMultitrackPlayerProps): void {
        if (previous.initialSeek !== this.props.initialSeek && this.props.initialSeek) this.seek(this.props.initialSeek.seconds, this.props.initialSeek.hold);
        if (previous.composition !== this.props.composition) {
            this.visualRevision++;
            const visualError=this.visualError;this.visualError=undefined;if(visualError&&this.state.error===visualError)this.setState({error:undefined});
            if(!this.processing()||this.visualRenderer?.hasFailed()){this.visualRenderer?.destroy();this.visualRenderer=undefined;}
            if (this.live.seconds > this.duration()) this.seek(this.duration(), true);
            this.sync(true);
            const oldDuration = previous.composition.clips.reduce((end, clip) => Math.max(end, clip.from + clip.durationFrames), 0) / previous.fps;
            if (oldDuration !== this.duration()) this.publish();
        } else if (previous.mediaAssets !== this.props.mediaAssets && (previous.mediaAssets.length !== this.props.mediaAssets.length
            || previous.mediaAssets.some((asset, index) => { const next = this.props.mediaAssets[index]; return asset.id !== next.id || asset.url !== next.url || asset.streamStartMs !== next.streamStartMs; }))) {
            this.sync(true);
        }
        if (previous.projectCanvas.width !== this.props.projectCanvas.width || previous.projectCanvas.height !== this.props.projectCanvas.height) this.measure();
    }
    override componentWillUnmount(): void {
        this.disposed = true; this.stopClock(); this.observer?.disconnect();
        for (const entry of this.media.values()) this.release(entry);
        this.visualRenderer?.destroy();this.images.clear();this.media.clear(); void this.audioContext?.close().catch(() => undefined); this.props.onController?.(undefined);
    }
    protected publish(): void { if (!this.disposed) this.props.onStateChange?.(this.snapshot()); }
    protected measure(): void {
        if (!this.stage || this.disposed) return;
        const { width, height } = this.props.projectCanvas;
        const scale = Math.max(.001, Math.min(this.stage.clientWidth / Math.max(1, width), this.stage.clientHeight / Math.max(1, height)));
        if (Math.abs(scale - this.state.scale) > .00001) this.setState({ scale });
    }
    protected stop(entry: MediaEntry): void { entry.attempt = undefined; entry.element.pause(); }
    protected release(entry:MediaEntry):void{
        this.stop(entry);
        try{entry.element.removeAttribute('src');entry.element.load();}catch{/* A detached native element may already have released its resource. */}
    }
    protected stopClock(): void { ++this.generation; if (this.clock !== undefined) cancelAnimationFrame(this.clock); this.clock = undefined; }
    protected startClock(): void {
        this.stopClock(); const generation = this.generation; this.lastTime = performance.now();
        const tick = (): void => {
            if (this.disposed || generation !== this.generation || !this.live.playing) return;
            this.clock = undefined;
            const now = performance.now(), delta = Math.max(0, now - this.lastTime) / 1000; this.lastTime = Math.max(now, this.lastTime);
            this.live.seconds = Math.min(this.duration(), Math.max(0, this.live.seconds + delta * this.live.speed));
            if (this.live.seconds >= this.duration()) { this.live.playing = false; this.stopClock(); }
            this.sync(); this.setState({ ...this.live }); this.props.onTick?.(this.live.seconds); this.publish();
            if (!this.disposed && this.live.playing && generation === this.generation) this.clock = requestAnimationFrame(tick);
        };
        this.clock = requestAnimationFrame(tick);
    }
    protected play(): void {
        if(this.visualError)return;
        if (this.disposed || this.live.playing || !this.duration()) return;
        for (const entry of this.media.values()) if (entry.failed || entry.element.error) { entry.failed = false; entry.element.load(); }
        if (this.live.seconds >= this.duration()) this.live.seconds = 0;
        this.live.playing = true; this.setState({ ...this.live, error: undefined }); this.sync(true); this.startClock(); this.publish();
    }
    protected pause(): void {
        this.live.playing = false; this.stopClock(); this.sync();
        if (!this.disposed) { this.setState({ ...this.live }); this.props.onTick?.(this.live.seconds); this.publish(); }
    }
    protected seek(seconds: number, hold = false): void {
        if (this.disposed) return;
        if (hold) this.live.playing = false;
        this.live.seconds = Math.max(0, Math.min(this.duration(), Number.isFinite(seconds) ? seconds : 0));
        this.stopClock(); for (const entry of this.media.values()) this.stop(entry);
        this.setState({ ...this.live }, () => this.sync(true));
        if (this.live.playing) this.startClock(); this.props.onTick?.(this.live.seconds); this.publish();
    }
    protected setSpeed(speed: number): void {
        if (!Number.isFinite(speed)) return;
        this.live.speed = Math.max(.25, Math.min(4, speed)); this.setState({ speed: this.live.speed });
        this.sync(); if (this.live.playing) this.startClock(); this.publish();
    }
    protected fail(id: string, entry: MediaEntry, reason?: unknown): void {
        if (this.disposed || this.media.get(id) !== entry || entry.failed) return;
        const active = this.sample().find(item => item.clip.id === id && (item.visible || item.audible));
        if (!active) return;
        const name = reason && typeof reason === 'object' && 'name' in reason ? String(reason.name) : 'MediaError';
        if (name === 'AbortError' || entry.element.error?.code === 1) return;
        entry.failed = true; this.stop(entry);
        if (active.clip.kind === 'video') this.pause();
        this.setState({ error: comicCutLayoutText(this.props.locale, active.clip.kind === 'video' ? 'videoPlaybackError' : 'audioPlaybackError') });
        this.props.onPlaybackError?.({ kind: active.clip.kind === 'video' ? 'video' : 'audio', shotId: id, name: ['NotAllowedError', 'NotSupportedError', 'SecurityError'].includes(name) ? name : 'MediaError', code: entry.element.error?.code });
    }
    protected start(id: string, entry: MediaEntry): void {
        if (entry.failed || entry.attempt || !entry.element.paused || entry.element.seeking || entry.element.readyState < 2 || !this.live.playing) return;
        const attempt = {}; entry.attempt = attempt;
        try {
            const result = entry.element.play();
            void Promise.resolve(result).then(() => { if (entry.attempt === attempt) entry.attempt = undefined; }, error => {
                if (entry.attempt !== attempt || this.disposed || !this.live.playing) return;
                entry.attempt = undefined; this.fail(id, entry, error);
            });
        } catch (error) { if (entry.attempt === attempt) { entry.attempt = undefined; this.fail(id, entry, error); } }
    }
    protected gain(entry: MediaEntry, volume: number): void {
        const element = entry.element, safe = Math.max(0, Math.min(16, volume));
        try {
            let gain = this.gains.get(element);
            // Local files and same-origin media can be amplified without tainting Web Audio.
            const url = new URL(entry.url, location.href), originSafe = url.protocol === 'file:' || url.protocol === 'blob:' || url.origin === location.origin;
            if (safe > 1 && originSafe && window.AudioContext && !gain) {
                this.audioContext ??= new AudioContext(); gain = this.audioContext.createGain();
                this.audioContext.createMediaElementSource(element).connect(gain); gain.connect(this.audioContext.destination); this.gains.set(element, gain);
            }
            if (gain) { element.volume = 1; gain.gain.value = safe; if (this.live.playing && this.audioContext?.state === 'suspended') void this.audioContext.resume().catch(() => undefined); }
            else { element.volume = Math.min(1, safe); if(safe>1)this.warnAmplification(); }
        } catch { element.volume = Math.min(1, safe); if(safe>1)this.warnAmplification(); }
    }
    protected warnAmplification(): void {
        if(this.amplificationWarning||this.disposed)return;this.amplificationWarning=true;
        this.setState({error:comicMultitrackText(this.props.locale,'amplification')});
    }
    protected processing():boolean{return this.props.composition.clips.some(comicClipHasVisualProcessing);}
    protected visualFailure(error:unknown):void{const message=comicVisualErrorText(this.props.locale,error);this.visualError=message;this.visualAgain=false;this.pause();this.setState({error:message});}
    protected paintVisual():void{
        if(this.disposed||!this.visualCanvas||!this.processing()||this.visualError)return;
        if(this.visualRenderer?.hasFailed()){this.visualFailure(this.visualRenderer.failureReason());return;}
        if(this.visualPending){this.visualAgain=true;return;}this.visualPending=true;this.visualAgain=false;
        const revision=this.visualRevision,{width,height}=comicVisualOutputSize(this.props.projectCanvas.width,this.props.projectCanvas.height);
        try{if(!this.visualRenderer||this.visualRenderer.width!==width||this.visualRenderer.height!==height){this.visualRenderer?.destroy();this.visualRenderer=new ComicVisualRenderer(width,height);}}catch(error){this.visualPending=false;this.visualFailure(error);return;}
        const renderer=this.visualRenderer,frame=Math.max(0,Math.min(Math.max(0,Math.ceil(this.duration()*this.props.fps)-1),Math.floor(this.live.seconds*this.props.fps+1e-8))),samples=sampleComicComposition(this.props.composition,frame).filter(sample=>sample.visible&&(sample.clip.purpose!=='subtitle'||this.props.subtitlesVisible!==false));
        void (async()=>{renderer.begin();for(const sample of samples){const clip=sample.clip;let source:CanvasImageSource|undefined;
            if(clip.kind==='video'){const media=this.media.get(clip.id)?.element;if(!media||media.readyState<2||media.seeking){return;}source=media as HTMLVideoElement;}
            else if(clip.kind==='image'){const image=this.images.get(clip.id);if(!image?.complete||!image.naturalWidth)return;source=image;}
            const text=clip.text??(this.props.subtitleCues?.[clip.assetId||'']||[]).filter(cue=>sample.sourceFrame>=cue.startFrame&&sample.sourceFrame<cue.startFrame+cue.durationFrames).map(cue=>cue.text).join('\n');
            await renderer.add(clip,sample.localFrame,this.props.fps,source,text);
        }if(!this.disposed&&revision===this.visualRevision&&this.visualCanvas){const ctx=this.visualCanvas.getContext('2d')!;ctx.clearRect(0,0,width,height);ctx.drawImage(renderer.canvas(),0,0);}})().catch(error=>{if(!this.disposed&&revision===this.visualRevision&&renderer===this.visualRenderer){this.visualFailure(error);}}).finally(()=>{this.visualPending=false;if(this.visualAgain&&!this.disposed)requestAnimationFrame(()=>this.paintVisual());});
    }
    protected sync(force = false): void {
        if (this.disposed) return;
        const active = new Map(this.sample().map(item => [item.clip.id, item]));
        const upcoming = new Map(this.upcoming().map(item=>[item.clip.id,item]));
        const assets = new Map(this.props.mediaAssets.map(item => [item.id, item]));
        for (const [id, entry] of this.media) {
            const item = active.get(id);
            if (!item || !item.visible && !item.audible) {
                this.stop(entry);entry.element.muted=true;
                const next=upcoming.get(id),asset=assets.get(next?.clip.assetId||'');
                if(next&&entry.element.readyState>0&&!entry.element.seeking){
                    const target=next.sourceFrame/this.props.fps+(asset?.streamStartMs||0)/1000;
                    if(Math.abs(entry.element.currentTime-target)>.001)try{entry.element.currentTime=target;}catch{/* Retry when metadata becomes seekable. */}
                }
                continue;
            }
            const asset = assets.get(item.clip.assetId || '');
            const target = Math.max(0, item.sourceFrame / this.props.fps + (asset?.streamStartMs || 0) / 1000);
            const element = entry.element;
            element.playbackRate = this.live.speed; element.muted = !item.audible;
            this.gain(entry, item.audible ? item.volume * (item.track.volume ?? 1) : 0);
            if (element.error) { this.fail(id, entry); continue; }
            if (element.readyState > 0 && !element.seeking && Math.abs(element.currentTime - target) > (force || !this.live.playing ? .001 : .15)) {
                this.stop(entry);
                try { element.currentTime = Math.min(Number.isFinite(element.duration) ? Math.max(0, element.duration - .001) : target, target); } catch { /* Metadata will retry this exact target. */ }
            }
            if (this.live.playing) this.start(id, entry); else this.stop(entry);
        }
        this.paintVisual();
    }
    protected attach(id: string, url: string, element: HTMLMediaElement | null): void {
        const previous = this.media.get(id);
        if (previous?.element === element && previous.url === url) return;
        if (previous) this.stop(previous);
        if (!element) {
            this.media.delete(id);
            if(previous)queueMicrotask(()=>{if(this.media.get(id)?.element!==previous.element)this.release(previous);});
            return;
        }
        this.media.set(id, { element, url }); this.sync(true);
    }
    protected mediaRef(id: string, url: string): (element: HTMLMediaElement | null) => void {
        let cached = this.mediaRefs.get(id);
        if (!cached || cached.url !== url) { cached = { url, ref: element => this.attach(id, url, element) }; this.mediaRefs.set(id, cached); }
        return cached.ref;
    }
    protected visualCanvasRef = (element: HTMLCanvasElement | null): void => {
        this.visualCanvas = element;
        if (element) this.paintVisual();
    };
    protected expand = (): void => {
        if (!this.shell) return;
        if(this.visualError){const previous=this.visualError;this.visualRenderer?.destroy();this.visualRenderer=undefined;this.visualError=undefined;if(this.state.error===previous)this.setState({error:undefined});}
        if (this.state.expanded) { this.shell.close(); this.shell.show(); this.setState({ expanded: false }, () => { this.measure(); this.expandButton?.focus(); }); }
        else { this.shell.close(); this.shell.showModal(); this.setState({ expanded: true }, () => { this.measure(); this.shell?.querySelector<HTMLButtonElement>('.nmx-mt-preview-close')?.focus(); }); }
    };
    override render(): React.ReactNode {
        const processing=this.processing();
        const { width, height } = processing?comicVisualOutputSize(this.props.projectCanvas.width,this.props.projectCanvas.height):this.props.projectCanvas, assets = new Map(this.props.mediaAssets.map(asset => [asset.id, asset]));
        const fontFamily = /Mac|iPhone|iPad/.test(navigator.platform) ? 'PingFang SC, sans-serif' : /Win/.test(navigator.platform) ? 'Microsoft YaHei, sans-serif' : 'Noto Sans CJK SC, sans-serif';
        const samples = this.renderSamples(), t = (key: Parameters<typeof comicCutLayoutText>[1]): string => comicCutLayoutText(this.props.locale, key);
        return <div className='nmx-mt-player'>
            {this.state.error && <div className='nmx-mt-error' role='alert'>{this.state.error}<button type='button' onClick={() => this.setState({ error: undefined })} aria-label={t('dismiss')}>×</button></div>}
            <dialog className={`nmx-mt-preview-shell${this.state.expanded ? ' is-expanded' : ''}`} open ref={element => { this.shell = element; }}
                onCancel={event => { event.preventDefault(); this.expand(); }} onClick={event => { if ((event.target === event.currentTarget || event.target === this.stage) && this.state.expanded) this.expand(); }}>
                {this.state.expanded && <button type='button' className='nmx-mt-preview-close' onClick={this.expand} aria-label={t('closePreview')}>×</button>}
                <div className='nmx-mt-stage' ref={element => { this.stage = element; }} aria-label={t('preview')}>
                    <div className='nmx-mt-output' style={{ width, height, transform: `translate(-50%, -50%) scale(${this.state.scale})` }}>
                        {processing&&<canvas width={width} height={height} aria-label={t('preview')} ref={this.visualCanvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',zIndex:1000,pointerEvents:'none'}}/>}
                        {samples.map((item, index) => {
                            const { clip } = item, asset = assets.get(clip.assetId || ''), url = asset?.url;
                            const visible = item.visible && (clip.purpose !== 'subtitle' || this.props.subtitlesVisible !== false);
                            const style: React.CSSProperties = { zIndex: index, opacity: visible && !processing ? item.opacity : 0, transform: `translate(${item.x}px, ${item.y}px) rotate(${item.rotation}deg) scale(${item.scale})`, justifyContent: clip.textStyle?.align === 'left' ? 'flex-start' : clip.textStyle?.align === 'right' ? 'flex-end' : 'center', ...(clip.legacyFadeToBlack ? {background:'#000',filter:`brightness(${item.brightness ?? 1})`} : {}) };
                            const loaded = (): void => this.sync(true), error = (event:React.SyntheticEvent<HTMLMediaElement>): void => { const entry = this.media.get(clip.id); if (entry?.element===event.currentTarget) this.fail(clip.id, entry); };
                            if (clip.kind === 'audio') return url ? <audio key={clip.id} data-clip-id={clip.id} src={url} ref={this.mediaRef(clip.id, url)} preload='auto' onLoadedMetadata={loaded} onLoadedData={loaded} onSeeked={() => this.sync()} onError={error} /> : null;
                            return <div key={clip.id} className={`nmx-mt-layer is-${clip.kind}`} data-clip-id={clip.id} style={style}>
                                {clip.kind === 'video' && url ? <video src={url} ref={this.mediaRef(clip.id, url)} playsInline preload='auto' style={{ objectFit: clip.fit || 'contain' }} onLoadedMetadata={loaded} onLoadedData={loaded} onSeeked={() => this.sync()} onError={error} />
                                    : clip.kind === 'image' && url ? <img src={url} alt={clip.title || ''} onLoad={()=>this.paintVisual()} ref={image=>{if(image){this.images.set(clip.id,image);if(image.complete&&image.naturalWidth)this.paintVisual();}else this.images.delete(clip.id);}} style={{ objectFit: clip.fit || 'contain' }} />
                                        : clip.kind === 'text' ? <span className='nmx-mt-text' style={{ fontFamily, fontSize: clip.textStyle?.fontSize || 56, fontWeight: clip.textStyle?.bold ? 700 : 400, color: clip.textStyle?.color || '#ffffff', backgroundColor: clip.textStyle?.backgroundColor || 'transparent', textAlign: clip.textStyle?.align || 'center' }}>{comicCompositionTextLines(clip.text ?? (this.props.subtitleCues?.[clip.assetId || ''] || []).filter(cue => item.sourceFrame >= cue.startFrame && item.sourceFrame < cue.startFrame + cue.durationFrames).map(cue => cue.text).join('\n'),clip.textStyle?.fontSize||56,width)}</span>
                                            : <span className='nmx-mt-missing'>{comicMultitrackText(this.props.locale, 'missing')}</span>}
                            </div>;
                        })}
                    </div>
                    {!this.props.composition.clips.length && <p className='nmx-mt-empty'>{comicMultitrackText(this.props.locale, 'empty')}</p>}
                </div>
            </dialog>
            <div className='nmx-mt-transport'>
                <button type='button' onClick={() => this.seek(0, true)} title={comicStudioText(this.props.locale, 'restart')} aria-label={comicStudioText(this.props.locale, 'restart')}>|◀</button>
                <button type='button' className='nmx-mt-play' onClick={() => this.live.playing ? this.pause() : this.play()} aria-label={comicStudioText(this.props.locale, this.live.playing ? 'pause' : 'play')} disabled={!this.duration()}><i className={`codicon codicon-debug-${this.live.playing ? 'pause' : 'start'}`} /></button>
                <button type='button' onClick={() => this.seek(this.live.seconds - 1 / this.props.fps, true)} title={comicMultitrackText(this.props.locale,'previousFrame')} aria-label={comicMultitrackText(this.props.locale,'previousFrame')}>‹</button><button type='button' onClick={() => this.seek(this.live.seconds + 1 / this.props.fps, true)} title={comicMultitrackText(this.props.locale,'nextFrame')} aria-label={comicMultitrackText(this.props.locale,'nextFrame')}>›</button>
                <span data-nmx-literal>{formatEditorTime(this.state.seconds)} / {formatEditorTime(this.duration())}</span>
                <input type='range' min={0} max={Math.max(this.duration(), .001)} step={1 / this.props.fps} value={this.state.seconds} aria-label={t('preview')} onChange={event => this.seek(Number(event.currentTarget.value), true)} />
                <select value={this.state.speed} aria-label={comicStudioText(this.props.locale,'speed')} onChange={event => this.setSpeed(Number(event.currentTarget.value))}>{[.25,.5,1,1.5,2,4].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select>
                {this.props.onToggleSubtitles && <button type='button' aria-pressed={this.props.subtitlesVisible !== false} onClick={this.props.onToggleSubtitles} title={comicMultitrackText(this.props.locale, this.props.subtitlesVisible !== false ? 'hideSubtitles' : 'showSubtitles')}>CC</button>}
                {this.props.onRecognize && <button type='button' data-nmx-mt-recognize='true' onClick={this.props.onRecognize} title={this.props.recognition ? comicMultitrackText(this.props.locale,'stopRecognition') : comicStudioText(this.props.locale, 'recognizeSubtitles')} aria-label={this.props.recognition ? comicMultitrackText(this.props.locale,'stopRecognition') : comicStudioText(this.props.locale, 'recognizeSubtitles')}><i className={`codicon codicon-${this.props.recognition ? 'debug-stop' : 'whole-word'}`} /></button>}
                <button type='button' ref={element => { this.expandButton = element; }} onClick={this.expand} aria-label={t('expandPreview')} title={t('expandPreview')}><i className='codicon codicon-screen-full' /></button>
            </div>
        </div>;
    }
}
