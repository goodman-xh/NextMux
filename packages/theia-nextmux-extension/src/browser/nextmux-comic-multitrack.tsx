import * as React from '@theia/core/shared/react';
import { platformShortcutText } from './nextmux-shortcut-text';
import { getComicAssetDurationFrames } from '@nextmux/comic-core/media-timing';
import {
    evaluateComicCompositionProperty, splitComicCompositionClip, trimComicCompositionClip, resizeComicCompositionClip, setComicCompositionFade,
    type ComicComposition, type ComicCompositionClip, type ComicCompositionTrack,
    type ComicCompositionProperty, type ComicCompositionEasing
} from '@nextmux/comic-core/composition';
import type { ComicCutAsset, ComicCutAssetGroup } from './nextmux-comic-cut';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { formatEditorTime, type ComicEditorController } from './nextmux-comic-editor';
import { comicCutText, type ComicCutTextKey } from './nextmux-comic-cut-text';
import { comicCutLayoutText } from './nextmux-comic-cut-layout-text';
import { comicStudioText } from './nextmux-comic-studio-text';
import { ComicMultitrackPlayer, type ComicMultitrackAsset, type ComicMultitrackPlayerProps } from './nextmux-comic-multitrack-player';
import { comicMultitrackText, type ComicMultitrackTextKey } from './nextmux-comic-multitrack-text';
import {ComicVisualPanel,comicVisualPropertyLabel} from './nextmux-comic-visual-panel';
import {comicVisualProperties,comicVisualPropertyRange} from '@nextmux/comic-core/visual-effects';
export type { ComicMultitrackAsset } from './nextmux-comic-multitrack-player';

export interface ComicMultitrackProps {
    readonly composition: ComicComposition;
    readonly assets: readonly ComicCutAsset[];
    readonly mediaAssets: readonly ComicMultitrackAsset[];
    readonly groups?: readonly ComicCutAssetGroup[];
    readonly fps: number;
    readonly projectCanvas: ComicMultitrackPlayerProps['projectCanvas'];
    readonly locale: NextMuxDesktopLocale;
    readonly busy: boolean;
    readonly importing: boolean;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly exportLabel: string;
    readonly exportDisabled: boolean;
    readonly onCommit: (composition: ComicComposition) => Promise<boolean>;
    readonly onInsertAsset: (assetId: string, trackId: string | undefined, fromFrame: number) => Promise<boolean | void> | void;
    readonly onImportFiles: (files: readonly File[], trackId?: string, fromFrame?: number) => Promise<unknown> | void;
    readonly actions: { pickFiles(): void; undo(): void; redo(): void; exportVideo(): void };
    readonly onBack?: () => void;
    readonly backLabel?: string;
    readonly onClose?: () => void;
    readonly closeLabel?: string;
    readonly projectTitle?: string;
    readonly projectPath?: string;
    readonly onOpenFolder?: () => void;
    readonly player?: Omit<ComicMultitrackPlayerProps, 'composition' | 'mediaAssets' | 'fps' | 'projectCanvas' | 'locale' | 'onTick'>;
}
interface State {
    selected: readonly string[]; trackId?: string; frame: number; zoom: number; snap: boolean;
    draft?: ComicComposition; pending: boolean; error?: boolean; property: ComicCompositionProperty;
    trackHeight: number; filter: 'all' | 'video' | 'image' | 'audio'; search: string; keys: boolean; scrollLeft: number; scrollTop: number; viewportWidth: number;
    /** The unlocked track under a library or file drag, highlighted as the drop target. */
    dropTrackId?: string;
}
interface Drag {
    id: string; ids: readonly string[]; x: number; y: number; edge?: 'start' | 'end'; pointerId: number;
    base: ComicComposition; preview?: ComicComposition; moved?: boolean;
}
const ASSET_MIME = 'application/x-nextmux-comic-asset';
const properties: readonly ComicCompositionProperty[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];
const easings: readonly ComicCompositionEasing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'];
const uid = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;
const compatible = (track: ComicCompositionTrack, clip: ComicCompositionClip): boolean => track.kind === (clip.kind === 'audio' ? 'audio' : clip.kind === 'text' ? 'text' : 'video');

/** Independent clips, not shot-linked sound lanes. Every completed gesture is one persisted undo step. */
export class ComicMultitrack extends React.Component<ComicMultitrackProps, State> {
    protected controller?: ComicEditorController;
    protected root: HTMLElement | null = null;
    protected scroller: HTMLDivElement | null = null;
    protected ruler: HTMLDivElement | null = null;
    protected scrub?: { pointerId: number; clientX: number; offset: number };
    protected drag?: Drag;
    protected keyDrag?: { clip: ComicCompositionClip; property: ComicCompositionProperty; frame: number; x: number; pointerId: number; base: ComicComposition; preview?: ComicComposition };
    protected resize?: { y: number; height: number };
    protected mounted = false;
    protected saving = false;
    protected lastTimelineTick = 0;
    protected trackLayoutCache?: { value: ComicComposition; rows: { track: ComicCompositionTrack; offset: number; height: number; clips: { clip: ComicCompositionClip; lane: number }[] }[] };
    constructor(props: ComicMultitrackProps) {
        super(props);
        this.state = { selected: [], frame: 0, zoom: 48, snap: true, pending: false, property: 'x', trackHeight: 240, filter: 'all', search: '', keys: false, scrollLeft: 0, scrollTop: 0, viewportWidth: 1400 };
    }
    protected scrollerObserver?: ResizeObserver;
    protected syncViewportWidth = (): void => {
        if (!this.mounted || !this.scroller) return;
        const width = this.scroller.clientWidth;
        if (width > 0 && width !== this.state.viewportWidth) this.setState({ viewportWidth: width });
    };
    protected handleDocumentPointerDown = (event: PointerEvent): void => {
        if (!this.state.keys) return;
        const target = event.target as Element | null;
        if (target?.closest?.('.nmx-mt-shortcuts, [data-nmx-mt-keys]')) return;
        this.setState({ keys: false });
    };
    /** Escape closes the shortcut sheet even when focus is outside the editor (inside it, `key` handles it first). */
    protected handleWindowKeyDown = (event: KeyboardEvent): void => {
        if (!this.state.keys || event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        this.setState({ keys: false });
    };
    /** Wheel listeners must be non-passive: React's onWheel cannot cancel the native vertical scroll. */
    protected bindScroller = (element: HTMLDivElement | null): void => {
        if (this.scroller === element) return;
        this.scroller?.removeEventListener('wheel', this.wheel);
        this.scroller = element;
        element?.addEventListener('wheel', this.wheel, { passive: false });
    };
    protected wheelTarget?: number;
    protected wheelFrame = 0;
    protected stopWheelScroll(): void {
        if (this.wheelFrame) cancelAnimationFrame(this.wheelFrame);
        this.wheelFrame = 0; this.wheelTarget = undefined;
    }
    /** Ctrl/⌘ + wheel zooms around the pointer; Shift + wheel scrolls tracks; any other wheel moves the timeline left/right. */
    protected wheel = (event: WheelEvent): void => {
        const element = this.scroller;
        if (!element || event.defaultPrevented) return;
        const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? element.clientWidth : 1;
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            const before = this.state.zoom, zoom = Math.max(8, Math.min(240, before * Math.exp(-event.deltaY * unit * .005)));
            if (zoom === before) return;
            const ruler = this.ruler?.getBoundingClientRect(), offset = ruler ? Math.max(0, event.clientX - ruler.left) : 0;
            this.stopWheelScroll();
            this.setState({ zoom }, () => { if (this.scroller) this.scroller.scrollLeft += offset * (zoom / before - 1); });
            return;
        }
        const dx = event.deltaX * unit, dy = event.deltaY * unit;
        if (event.shiftKey) {
            // Chromium turns Shift + wheel into deltaX; either axis scrolls the tracks vertically here.
            const delta = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
            if (!delta || element.scrollHeight <= element.clientHeight) return;
            event.preventDefault(); this.stopWheelScroll(); element.scrollTop += delta;
            return;
        }
        const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        if (!delta) return;
        event.preventDefault();
        const max = Math.max(0, element.scrollWidth - element.clientWidth);
        const target = Math.max(0, Math.min(max, (this.wheelTarget ?? element.scrollLeft) + delta));
        // Trackpads report many small deltas: follow them 1:1. Wheel notches glide to their target.
        if (Math.abs(delta) < 50 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            this.stopWheelScroll(); element.scrollLeft = target; return;
        }
        this.wheelTarget = target;
        if (!this.wheelFrame) this.wheelFrame = requestAnimationFrame(this.wheelStep);
    };
    protected wheelStep = (): void => {
        this.wheelFrame = 0;
        const element = this.scroller, target = this.wheelTarget;
        if (!this.mounted || !element || target === undefined) { this.wheelTarget = undefined; return; }
        const distance = target - element.scrollLeft;
        if (Math.abs(distance) < 1) { element.scrollLeft = target; this.wheelTarget = undefined; return; }
        const before = element.scrollLeft;
        element.scrollLeft = before + Math.sign(distance) * Math.max(1, Math.abs(distance) * .28);
        // Clamped at an edge or taken over by the scrollbar: stop instead of fighting it.
        if (element.scrollLeft === before) { this.wheelTarget = undefined; return; }
        this.wheelFrame = requestAnimationFrame(this.wheelStep);
    };
    override componentDidMount(): void {
        this.mounted = true;
        this.syncViewportWidth();
        window.addEventListener('resize', this.syncViewportWidth);
        if (typeof ResizeObserver !== 'undefined' && this.scroller) {
            this.scrollerObserver = new ResizeObserver(() => this.syncViewportWidth());
            this.scrollerObserver.observe(this.scroller);
        }
        window.addEventListener('blur', this.finishScrub);
        window.addEventListener('keydown', this.handleWindowKeyDown);
        document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    }
    override componentWillUnmount(): void {
        this.mounted = false;
        window.removeEventListener('resize', this.syncViewportWidth);
        this.scrollerObserver?.disconnect();
        this.scrollerObserver = undefined;
        window.removeEventListener('blur', this.finishScrub);
        window.removeEventListener('keydown', this.handleWindowKeyDown);
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
        this.stopWheelScroll();
        this.finishScrub();
        this.controller?.pause();
    }
    override componentDidUpdate(previous: ComicMultitrackProps, previousState: State): void {
        if (this.scrub && previousState.zoom !== this.state.zoom) this.scrubTo(this.scrub.clientX);
        if (previous.composition !== this.props.composition && (this.drag || this.keyDrag)) { this.drag = undefined; this.keyDrag = undefined; this.setState({ draft: undefined }); }
        if (previous.composition !== this.props.composition) {
            const selected = this.state.selected.filter(id => this.props.composition.clips.some(clip => clip.id === id));
            if (selected.length !== this.state.selected.length) this.setState({ selected });
            const clip=selected.length===1?this.props.composition.clips.find(c=>c.id===selected[0]):undefined;
            if(this.state.property.includes(':')&&!comicVisualProperties(clip??{}).includes(this.state.property as never))this.setState({property:clip?.kind==='audio'?'volume':'x'});
        }
    }
    protected t(key: ComicMultitrackTextKey): string { return comicMultitrackText(this.props.locale, key); }
    protected cut(key: ComicCutTextKey): string { return comicCutText(this.props.locale, key); }
    protected value(): ComicComposition { return this.state.draft || this.props.composition; }
    protected blocked(): boolean { return this.props.busy || this.props.importing || this.saving || this.state.pending; }
    protected editable(clip: ComicCompositionClip, composition = this.value()): boolean { return !composition.tracks.find(track => track.id === clip.trackId)?.locked; }
    protected pixels(): number { return this.state.zoom / this.props.fps; }
    protected duration(): number { return this.value().clips.reduce((end, clip) => Math.max(end, clip.from + clip.durationFrames), 0); }
    protected selected(): ComicCompositionClip | undefined { return this.state.selected.length === 1 ? this.value().clips.find(clip => clip.id === this.state.selected[0]) : undefined; }
    protected async commit(next: ComicComposition): Promise<boolean> {
        if (this.blocked()) return false;
        this.saving = true; this.controller?.pause(); this.setState({ draft: next, pending: true, error: false });
        let saved = false;
        try { saved = await this.props.onCommit(next); } catch { saved = false; }
        this.saving = false; if (this.mounted) this.setState({ draft: undefined, pending: false, error: !saved });
        return saved;
    }
    protected patchClip(id: string, patch: Partial<ComicCompositionClip>): void {
        const value = this.value(), clip = value.clips.find(item => item.id === id);
        if (!clip || !this.editable(clip)) return;
        void this.commit({ ...value, clips: value.clips.map(item => item.id === id ? { ...item, ...patch } : item) });
    }
    protected patchTrack(id: string, patch: Partial<ComicCompositionTrack>): void {
        const value = this.value(); void this.commit({ ...value, tracks: value.tracks.map(track => track.id === id ? { ...track, ...patch } : track) });
    }
    protected async addTrack(kind: ComicCompositionTrack['kind']): Promise<string | undefined> {
        const value = this.value(), id = uid('track'), title = `${this.t(kind)} ${value.tracks.filter(track => track.kind === kind).length + 1}`;
        if(!await this.commit({ ...value, tracks: [...value.tracks, { id, kind, title }] }))return undefined;
        if(this.mounted)this.setState({trackId:id,selected:[]});return id;
    }
    protected moveTrack(id: string, delta: number): void {
        const value = this.value(), tracks = [...value.tracks], index = tracks.findIndex(track => track.id === id), next = index + delta;
        if (index < 0 || next < 0 || next >= tracks.length || tracks[index].locked) return;
        const [track] = tracks.splice(index, 1); tracks.splice(next, 0, track); void this.commit({ ...value, tracks });
    }
    protected removeTrack(id: string): void {
        const value = this.value(); if (value.tracks.find(track => track.id === id)?.locked) return;
        void this.commit({ ...value, tracks: value.tracks.filter(track => track.id !== id), clips: value.clips.filter(clip => clip.trackId !== id) });
    }
    protected async addText(): Promise<void> {
        const value = this.value(), existing = value.tracks.find(track => track.kind === 'text' && !track.locked), trackId = existing?.id || uid('track'), id = uid('clip');
        const next: ComicComposition = { ...value, tracks: existing ? value.tracks : [...value.tracks, { id: trackId, title: this.t('text'), kind: 'text' }],
            clips: [...value.clips, { id, trackId, kind: 'text', purpose: 'title', text: this.t('text'), from: this.state.frame, durationFrames: Math.round(this.props.fps * 3), sourceStartFrames: 0, textStyle: { fontSize: 56, color: '#ffffff', align: 'center' } }] };
        if (await this.commit(next)) this.setState({ selected: [id], trackId });
    }
    protected async insert(asset: ComicCutAsset, trackId?: string, frame = this.state.frame): Promise<void> {
        if (this.blocked()) return;
        const kind = asset.kind === 'video' || asset.kind === 'image' ? 'video' : 'audio';
        if (trackId && !this.value().tracks.some(item => item.id === trackId && item.kind === kind && !item.locked)) return;
        const track = this.value().tracks.find(item => item.id === trackId && item.kind === kind && !item.locked)
            || this.value().tracks.find(item => item.id === this.state.trackId && item.kind === kind && !item.locked)
            || this.value().tracks.find(item => item.kind === kind && !item.locked);
        this.saving = true; this.setState({ pending: true, error: false });
        try { const result = await this.props.onInsertAsset(asset.id, track?.id, Math.max(0, Math.round(frame))); this.saving = false; if (this.mounted) this.setState({ pending: false, error: result === false }); }
        catch { this.saving = false; if (this.mounted) this.setState({ pending: false, error: true }); }
    }
    protected select(id: string, extend = false): readonly string[] {
        const selected = extend ? this.state.selected.includes(id) ? this.state.selected.filter(item => item !== id) : [...this.state.selected, id] : [id];
        const clip=this.value().clips.find(item=>item.id===id);
        this.setState({ selected, trackId: clip?.trackId,property:clip?.kind==='audio'?'volume':this.state.property.includes(':')&&!comicVisualProperties(clip??{}).includes(this.state.property as never)?'x':this.state.property==='volume'&&clip?.kind!=='video'?'x':this.state.property }); return selected;
    }
    protected remove(): void {
        const value = this.value(), ids = new Set(this.state.selected.filter(id => { const clip = value.clips.find(item => item.id === id); return clip && this.editable(clip); }));
        if (!ids.size) return;
        void this.commit({ ...value, clips: value.clips.filter(clip => !ids.has(clip.id)) });
    }
    protected duplicate(): void {
        const value = this.value(), selected = value.clips.filter(clip => this.state.selected.includes(clip.id) && this.editable(clip));
        if (!selected.length) return;
        const start = Math.min(...selected.map(clip => clip.from)), end = Math.max(...selected.map(clip => clip.from + clip.durationFrames));
        const copies = selected.map(clip => ({ ...clip, id: uid('clip'), from: clip.from + end - start }));
        void this.commit({ ...value, clips: [...value.clips, ...copies] }).then(saved => { if (saved) this.setState({ selected: copies.map(clip => clip.id) }); });
    }
    protected split(): void {
        const value = this.value(); let changed = false;
        const clips = value.clips.flatMap(clip => {
            const frame = Math.round((this.controller?.state().seconds ?? this.state.frame/this.props.fps)*this.props.fps) - clip.from;
            if (!this.state.selected.includes(clip.id) || !this.editable(clip) || frame < 1 || frame >= clip.durationFrames) return [clip];
            changed = true; return [...splitComicCompositionClip(clip, frame, uid('clip'))];
        });
        if (changed) void this.commit({ ...value, clips });
    }
    protected seek(frame: number): void { const next = Math.max(0, Math.round(frame)); this.controller?.seek(next / this.props.fps, true); this.setState({ frame: next }); }
    /** Scrubbing changes only playback position; it never creates a composition or an undo step. */
    protected beginScrub(event: React.PointerEvent<HTMLElement>, handle = false): void {
        if (event.button !== 0 || !event.isPrimary || this.scrub || this.drag || this.keyDrag || !this.ruler || !this.root) return;
        event.preventDefault(); event.stopPropagation();
        if (event.currentTarget.tabIndex >= 0) event.currentTarget.focus({ preventScroll: true });
        this.controller?.pause();
        const offset = handle ? event.clientX - this.ruler.getBoundingClientRect().left - this.state.frame * this.pixels() : 0;
        this.scrub = { pointerId: event.pointerId, clientX: event.clientX, offset };
        this.root.setPointerCapture(event.pointerId);
        this.scrubTo(event.clientX);
    }
    protected scrubTo(clientX: number): void {
        if (!this.scrub || !this.ruler) return;
        this.scrub.clientX = clientX;
        // The live ruler rect already includes horizontal scrolling; pixels() includes the current zoom.
        const frame = Math.max(0, Math.min(this.duration(), Math.round((clientX - this.ruler.getBoundingClientRect().left - this.scrub.offset) / this.pixels())));
        if (frame !== this.state.frame) this.seek(frame);
    }
    protected finishScrub = (): void => {
        const pointerId = this.scrub?.pointerId; this.scrub = undefined;
        if (pointerId !== undefined && this.root?.hasPointerCapture(pointerId)) this.root.releasePointerCapture(pointerId);
    };
    protected snap(from: number, duration: number, base: ComicComposition, ids: readonly string[]): number {
        if (!this.state.snap) return from;
        const points = [0, this.state.frame, ...base.clips.filter(clip => !ids.includes(clip.id)).flatMap(clip => [clip.from, clip.from + clip.durationFrames])];
        let best = from, distance = 7 / this.pixels();
        for (const point of points) for (const edge of [from, from + duration]) if (Math.abs(point - edge) < distance) { distance = Math.abs(point - edge); best = from + point - edge; }
        return Math.max(0, best);
    }
    protected begin(event: React.PointerEvent<HTMLElement>, clip: ComicCompositionClip, edge?: 'start' | 'end'): void {
        if (event.button !== 0 || this.blocked() || this.scrub) return;
        event.stopPropagation();
        const ids = event.shiftKey || event.metaKey || event.ctrlKey ? this.select(clip.id, true) : this.state.selected.includes(clip.id) ? this.state.selected : this.select(clip.id);
        if (!this.editable(clip) || !ids.includes(clip.id)) return;
        this.controller?.pause(); this.root?.setPointerCapture(event.pointerId);
        this.drag = { id: clip.id, ids: edge ? [clip.id] : ids, x: event.clientX, y: event.clientY, edge, pointerId: event.pointerId, base: this.value() };
    }
    protected sourceLimit(clip: ComicCompositionClip): number {
        if (clip.kind !== 'video' && clip.kind !== 'audio') return Infinity;
        const asset = this.props.mediaAssets.find(item => item.id === clip.assetId);
        const limit = asset ? getComicAssetDurationFrames({ ...asset, uri: asset.url || '', status: 'ready', createdAt: '', updatedAt: '' }, this.props.fps) : undefined;
        return limit ?? clip.sourceStartFrames + clip.durationFrames;
    }
    protected move = (event: React.PointerEvent<HTMLElement>): void => {
        if (this.scrub?.pointerId === event.pointerId) { event.preventDefault(); this.scrubTo(event.clientX); return; }
        const keyDrag=this.keyDrag;
        if(keyDrag&&keyDrag.pointerId===event.pointerId&&!this.blocked()){
            const frame=Math.max(0,Math.min(keyDrag.clip.durationFrames,keyDrag.frame+Math.round((event.clientX-keyDrag.x)/this.pixels())));
            if(frame===keyDrag.frame&&!keyDrag.preview)return;
            const selected=keyDrag.clip.keyframes!.find(key=>key.property===keyDrag.property&&key.frame===keyDrag.frame)!;
            const clip={...keyDrag.clip,keyframes:[...keyDrag.clip.keyframes!.filter(key=>key!==selected&&!(key.property===selected.property&&key.frame===frame)),{...selected,frame}]};
            keyDrag.preview={...keyDrag.base,clips:keyDrag.base.clips.map(item=>item.id===clip.id?clip:item)};this.setState({draft:keyDrag.preview});return;
        }
        const drag = this.drag; if (!drag || drag.pointerId !== event.pointerId || this.blocked()) return;
        if (!drag.moved && Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 3) return;
        drag.moved = true;
        const clip = drag.base.clips.find(item => item.id === drag.id)!;
        let delta = Math.round((event.clientX - drag.x) / this.pixels());
        let next: ComicComposition;
        if (drag.edge) {
            let edited = clip;
            if (drag.edge === 'start') {
                delta = Math.max(-Math.min(clip.from, clip.sourceStartFrames), Math.min(clip.durationFrames - 1, delta));
                edited = resizeComicCompositionClip(clip, delta, clip.durationFrames);
            } else {
                const duration = Math.max(1, Math.min(this.sourceLimit(clip) - clip.sourceStartFrames, clip.durationFrames + delta));
                edited = resizeComicCompositionClip(clip, 0, duration);
            }
            next = { ...drag.base, clips: drag.base.clips.map(item => item.id === clip.id ? edited : item) };
        } else {
            const movable = drag.base.clips.filter(item => drag.ids.includes(item.id) && this.editable(item, drag.base));
            delta = this.snap(clip.from + delta, clip.durationFrames, drag.base, drag.ids) - clip.from;
            delta = Math.max(-Math.min(...movable.map(item => item.from)), delta);
            const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId;
            const target = drag.base.tracks.find(track => track.id === hit && !track.locked && compatible(track, clip));
            const moveTrack = target && movable.every(item => item.trackId === clip.trackId && compatible(target, item));
            next = { ...drag.base, clips: drag.base.clips.map(item => movable.includes(item) ? { ...item, from: item.from + delta, trackId: moveTrack ? target.id : item.trackId } : item) };
        }
        drag.preview = next; this.setState({ draft: next });
    };
    protected end = (event: React.PointerEvent<HTMLElement>): void => {
        if (this.scrub?.pointerId === event.pointerId) { this.scrubTo(event.clientX); this.finishScrub(); return; }
        if(this.keyDrag?.pointerId===event.pointerId){const next=this.keyDrag.preview;this.keyDrag=undefined;if(this.root?.hasPointerCapture(event.pointerId))this.root.releasePointerCapture(event.pointerId);if(next)void this.commit(next);return;}
        const drag = this.drag; if (!drag || drag.pointerId !== event.pointerId) return;
        this.drag = undefined; if (this.root?.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
        if (drag.preview) void this.commit(drag.preview); else this.setState({ draft: undefined });
    };
    protected local(clip: ComicCompositionClip): number { return Math.max(0, Math.min(clip.durationFrames, this.state.frame - clip.from)); }
    protected setProperty(clip: ComicCompositionClip, property: ComicCompositionProperty, value: number, key = false): void {
        if (!Number.isFinite(value)) return;
        const [visualKind,visualId,visualParam]=property.split(':');const curve=clip.effects?.find(e=>e.id===visualId&&e.type==='gpu-curves'),channel=/^(master|red|green|blue)(Shadow|Highlight)[XY]$/.exec(visualParam??'')?.[1];
        const curvePatch=visualKind==='effect'&&curve&&channel&&curve.params[`${channel}Points`]?{effects:clip.effects!.map(e=>e===curve?{...e,params:{...e.params,[`${channel}Points`]:''}}:e)}:{};
        if(curvePatch.effects)clip={...clip,...curvePatch};
        const safe = property === 'opacity' ? Math.max(0, Math.min(1, value)) : property === 'volume' ? Math.max(0, Math.min(4, value)) : property === 'scale' ? Math.max(.01, Math.min(100, value)) : value;
        if (key || clip.keyframes?.some(item => item.property === property)) {
            const frame = this.local(clip), existing = clip.keyframes?.find(item => item.property === property && item.frame === frame);
            this.patchClip(clip.id, { ...curvePatch,keyframes: [...(clip.keyframes || []).filter(item => item.property !== property || item.frame !== frame), { property, frame, value: safe, easing: existing?.easing || 'linear' }] });
        } else if(property.startsWith('effect:')||property.startsWith('mask:')){const [kind,id,param]=property.split(':');const range=comicVisualPropertyRange(clip,property),v=range?Math.max(range[0],Math.min(range[1],safe)):safe;this.patchClip(clip.id,kind==='effect'?{effects:clip.effects!.map(e=>e.id===id?{...e,params:{...e.params,[param]:v}}:e)}:{masks:clip.masks!.map(m=>{if(m.id!==id)return m;const point=/^point\.(\d+)\.(x|y|inX|inY|outX|outY)$/.exec(param);return point?{...m,points:m.points?.map((p,i)=>i===Number(point[1])?{...p,[point[2]]:v}:p)}:{...m,[param]:v};})});}
        else this.patchClip(clip.id, property === 'volume' ? { volume: safe } : { transform: { ...clip.transform, [property]: safe } });
    }
    protected toggleKey(clip: ComicCompositionClip, property: ComicCompositionProperty): void {
        const frame = this.local(clip), exists = clip.keyframes?.some(item => item.property === property && item.frame === frame);
        this.setState({ property });
        if (exists) this.patchClip(clip.id, { keyframes: clip.keyframes!.filter(item => item.property !== property || item.frame !== frame) });
        else this.setProperty(clip, property, evaluateComicCompositionProperty(clip, property, frame), true);
    }
    protected key = (event: React.KeyboardEvent<HTMLElement>): void => {
        if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') || event.nativeEvent.isComposing) return;
        const key = event.key.toLowerCase(), mod = event.metaKey || event.ctrlKey;
        // Escape closes the innermost layer only: scrubbing, then the shortcut sheet or selection, and only then the
        // editor window around it (its backdrop listens for Escape too).
        if (key === 'escape' && this.scrub) { event.preventDefault(); event.stopPropagation(); this.finishScrub(); return; }
        if (key === 'escape') {
            if (this.state.keys || this.state.selected.length) { event.preventDefault(); event.stopPropagation(); this.setState({ keys: false, selected: [] }); }
            return;
        }
        if (this.state.keys) return;
        if (event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) { if (this.controller?.state().playing) this.controller.pause(); else this.controller?.play(); } return; }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); this.seek(this.state.frame + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? this.props.fps : 1)); return; }
        if (key === 'home' || key === 'end') { event.preventDefault(); this.seek(key === 'home' ? 0 : this.duration()); return; }
        if (mod && key === 'a') { event.preventDefault(); this.setState({ selected: this.value().clips.map(clip => clip.id) }); return; }
        if (mod && key === 'e') { event.preventDefault(); if (!this.props.exportDisabled) this.props.actions.exportVideo(); return; }
        if (['=', '+', '-', '_'].includes(key)) { event.preventDefault(); this.setState({ zoom: Math.max(8, Math.min(240, this.state.zoom * (key === '-' || key === '_' ? .8 : 1.25))) }); return; }
        if (key === '\\' || !mod && event.shiftKey && key === 'z') { event.preventDefault(); this.fit(); return; }
        if (this.blocked() || event.repeat) return;
        if (mod && (key === 'z' || key === 'y')) { event.preventDefault(); if (event.shiftKey || key === 'y') { if (this.props.canRedo) this.props.actions.redo(); } else if (this.props.canUndo) this.props.actions.undo(); return; }
        if (key === 'delete' || key === 'backspace') { event.preventDefault(); this.remove(); }
        if (mod && key === 'd') { event.preventDefault(); this.duplicate(); }
        if (!mod && key === 's' || mod && key === 'b') { event.preventDefault(); this.split(); }
        if (!mod && (key === 'q' || key === 'w')) {
            event.preventDefault(); const clip = this.selected(), at = clip ? this.state.frame - clip.from : 0;
            if (clip && this.editable(clip) && at > 0 && at < clip.durationFrames) this.patchClip(clip.id, trimComicCompositionClip(clip, key === 'q' ? at : 0, key === 'w' ? at : clip.durationFrames));
        }
        if (!mod && key === 'k') this.controller?.pause();
        if (!mod && key === 'j') this.seek(this.state.frame - this.props.fps);
        if (!mod && key === 'l') { if (this.controller?.state().playing) this.controller.setSpeed(Math.min(4, this.controller.state().speed * 2)); else this.controller?.play(); }
    };
    protected fit(): void { if (this.scroller && this.duration()) this.setState({ zoom: Math.max(8, Math.min(240, (this.scroller.clientWidth - 240) / (this.duration() / this.props.fps))) }); }
    protected tool(icon: string, title: string, onClick: () => void, disabled = false, active = false): React.ReactNode {
        return <button type='button' title={title} aria-label={title} disabled={disabled || this.blocked()} aria-pressed={active || undefined} onClick={onClick}><i className={`codicon codicon-${icon}`} /></button>;
    }
    protected renderToolbar(): React.ReactNode {
        const backTitle = this.props.backLabel || this.cut('openStoryboard');
        const closeTitle = this.props.closeLabel || comicCutLayoutText(this.props.locale, 'dismiss');
        const title = this.props.projectTitle, importLabel = this.cut(this.props.importing ? 'importing' : 'import');
        // Three zones: the folder name sits in the true center and shrinks before it can cover Back or Close.
        return <header className='nmx-mt-toolbar'>
            <div className='nmx-mt-toolbar-start'>
                {this.props.onBack && <button type='button' className='nmx-mt-back' title={backTitle} aria-label={backTitle} onClick={this.props.onBack}><i className='codicon codicon-arrow-left' /></button>}
                <button type='button' className='nmx-mt-labelled' title={importLabel} aria-label={importLabel} disabled={this.blocked()} onClick={this.props.actions.pickFiles}><i className='codicon codicon-cloud-upload' /><span className='nmx-mt-label'>{importLabel}</span></button>
                <span className='nmx-mt-divider' />
                {this.tool('discard', this.cut('undo'), this.props.actions.undo, !this.props.canUndo)}{this.tool('redo', this.cut('redo'), this.props.actions.redo, !this.props.canRedo)}
                <span className='nmx-mt-divider' />{this.tool('split-horizontal', this.cut('split'), () => this.split(), !this.state.selected.length)}
                {this.tool('copy', this.cut('duplicate'), () => this.duplicate(), !this.state.selected.length)}{this.tool('trash', this.cut('delete'), () => this.remove(), !this.state.selected.length)}
                {this.tool('magnet', this.t('snap'), () => this.setState({ snap: !this.state.snap }), false, this.state.snap)}
            </div>
            <div className='nmx-mt-toolbar-center'>
                {title && (this.props.onOpenFolder
                    ? <button type='button' className='nmx-mt-folder-title' title={this.props.projectPath || title} aria-label={title} onClick={this.props.onOpenFolder}>
                        <i className='codicon codicon-folder-opened' aria-hidden='true' />
                        <span data-nmx-literal>{title}</span>
                        <i className='codicon codicon-link-external nmx-mt-folder-go' aria-hidden='true' />
                    </button>
                    : <span className='nmx-mt-folder-title is-static' title={this.props.projectPath || title}>
                        <i className='codicon codicon-folder' aria-hidden='true' /><span data-nmx-literal>{title}</span>
                    </span>)}
            </div>
            <div className='nmx-mt-toolbar-end'>
                <button type='button' data-nmx-mt-keys='true' title={this.cut('keys')} aria-label={this.cut('keys')} disabled={this.blocked()} aria-pressed={this.state.keys || undefined} aria-expanded={this.state.keys} onClick={() => this.setState({ keys: !this.state.keys })}><i className='codicon codicon-keyboard' /></button>
                {this.tool('zoom-out', this.cut('zoomOut'), () => this.setState({ zoom: Math.max(8, this.state.zoom * .8) }))}
                {this.tool('zoom-in', this.cut('zoomIn'), () => this.setState({ zoom: Math.min(240, this.state.zoom * 1.25) }))}
                {this.tool('screen-full', this.cut('fitWidth'), () => this.fit())}
                <span className='nmx-mt-divider' />
                <button type='button' className='nmx-mt-export nmx-mt-labelled' data-help={this.cut('export')} aria-label={this.props.exportLabel} disabled={this.props.exportDisabled || this.blocked()} onClick={this.props.actions.exportVideo}><i className='codicon codicon-export' /><span className='nmx-mt-label'>{this.props.exportLabel}</span></button>
                {this.props.onClose && <button type='button' className='nmx-mt-close' title={closeTitle} aria-label={closeTitle} onClick={this.props.onClose}><i className='codicon codicon-close' /></button>}
            </div>
        </header>;
    }
    protected matchesAsset(asset: ComicCutAsset): boolean {
        if (this.state.filter !== 'all' && (this.state.filter === 'audio' ? ['video', 'image'].includes(asset.kind) : asset.kind !== this.state.filter)) return false;
        const query = this.state.search.trim().toLowerCase();
        if (!query) return true;
        return asset.title.toLowerCase().includes(query) || Boolean(asset.origin && asset.origin.toLowerCase().includes(query));
    }
    protected renderAsset(asset: ComicCutAsset): React.ReactNode {
        if (!this.matchesAsset(asset)) return null;
        return <button type='button' className={`nmx-mt-asset${asset.used ? ' is-used' : ''}`} key={asset.id} draggable={!this.blocked()} disabled={this.blocked()} title={`${asset.title}${asset.origin ? ` (${asset.origin})` : ''} · ${this.cut('addToTimeline')}`}
            onDragStart={event => { event.dataTransfer.setData(ASSET_MIME, asset.id); event.dataTransfer.effectAllowed = 'copy'; }}
            onDragEnd={() => { if (this.state.dropTrackId) this.setState({ dropTrackId: undefined }); }} onDoubleClick={() => void this.insert(asset)}
            onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();if(!event.repeat&&!this.blocked())void this.insert(asset);}}}>
            <span className='nmx-mt-asset-thumb'>
                {asset.url && asset.kind === 'image' ? <img src={asset.url} alt='' /> : asset.url && asset.kind === 'video' ? <video src={asset.url} muted preload='metadata' /> : <i className={`codicon codicon-${asset.kind === 'image' ? 'file-media' : asset.kind === 'video' ? 'device-camera-video' : 'music'}`} />}
                {asset.durationMs && asset.durationMs > 0 && asset.kind !== 'image' ? <span className='nmx-mt-asset-duration'>{formatEditorTime(asset.durationMs / 1000)}</span> : null}
                {asset.used ? <span className='nmx-mt-asset-used'>{this.cut('used')}</span> : null}
            </span>
            <span className='nmx-mt-asset-title'>{asset.title}</span>
            {asset.origin ? <span className='nmx-mt-asset-origin' title={asset.origin}>{asset.origin}</span> : null}
            <span className='nmx-mt-asset-add' role='button' title={this.cut('addToTimeline')} aria-label={this.cut('addToTimeline')} onClick={event => { event.stopPropagation(); void this.insert(asset); }}>+</span>
        </button>;
    }
    protected renderBin(): React.ReactNode {
        const searchLabel = this.t('searchMaterials');
        const dismissLabel = comicCutLayoutText(this.props.locale, 'dismiss');
        return <aside className='nmx-mt-bin'>
            <strong>{this.cut('media')}</strong>
            <div className='nmx-mt-bin-tabs'>{(['all','video','image','audio'] as const).map(filter => <button type='button' key={filter} aria-pressed={this.state.filter === filter} onClick={() => this.setState({ filter })}>{this.cut(filter)}</button>)}</div>
            <div className='nmx-mt-bin-search'>
                <i className='codicon codicon-search' aria-hidden='true' />
                <input type='search' value={this.state.search} placeholder={searchLabel} aria-label={searchLabel} onChange={event => this.setState({ search: event.currentTarget.value })} />
                {this.state.search && <button type='button' className='nmx-mt-bin-search-clear' title={dismissLabel} aria-label={dismissLabel} onClick={() => this.setState({ search: '' })}><i className='codicon codicon-close' aria-hidden='true' /></button>}
            </div>
            <div className='nmx-mt-library'>{this.props.groups?.length ? this.props.groups.map(group => {
                const filtered = group.assets.filter(asset => this.matchesAsset(asset));
                return <section key={group.key} className={`nmx-mt-group-section${group.open ? ' is-open' : ''}`}>
                    <button type='button' className='nmx-mt-group' title={group.title} aria-label={group.title} aria-expanded={group.open} onClick={group.onToggle}>
                        <i className={`codicon codicon-chevron-${group.open ? 'down' : 'right'} nmx-mt-group-chevron`} aria-hidden='true' />
                        <i className={`codicon codicon-${group.key === 'project' ? 'folder-library' : 'library'} nmx-mt-group-icon`} aria-hidden='true' />
                        <span className='nmx-mt-group-title'>{group.title}</span>
                        <span className='nmx-mt-group-count'>{group.loading ? '…' : filtered.length}</span>
                    </button>
                    {group.open && <div className='nmx-mt-assets'>{filtered.map(asset => this.renderAsset(asset))}{!filtered.length && <small className='nmx-mt-group-empty'>{group.loading ? '…' : (this.state.search.trim() ? this.t('noneMatch') : (group.empty || this.t('noneInProject')))}</small>}</div>}
                </section>;
            }) : (() => {
                const filtered = this.props.assets.filter(asset => this.matchesAsset(asset));
                return <div className='nmx-mt-assets'>{filtered.map(asset => this.renderAsset(asset))}{!filtered.length && this.state.search.trim() && <small className='nmx-mt-group-empty'>{this.t('noneMatch')}</small>}</div>;
            })()}</div>
            <button type='button' className='nmx-mt-import' disabled={this.blocked()} onClick={this.props.actions.pickFiles}>{this.cut('import')}</button>
        </aside>;
    }
    protected renderInspector(): React.ReactNode {
        const clip = this.selected(); if (!clip) return this.state.selected.length > 1 ? <aside className='nmx-mt-inspector'><strong>{this.t('selected')} ({this.state.selected.length})</strong></aside> : null;
        const disabled = this.blocked() || !this.editable(clip);
        const numeric = (label: string, value: number, commit: (value: number) => void, min = 0, step = 1): React.ReactNode => <label className='nmx-mt-field'><span>{label}</span><input key={`${clip.id}:${label}:${value}`} type='number' defaultValue={Number(value.toFixed(4))} min={min} step={step} disabled={disabled} onBlur={event => { const next = Number(event.currentTarget.value); if (Number.isFinite(next) && Math.abs(next-value)>1e-6) commit(next); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
        const baseProperties=properties.filter(property=>clip.kind==='audio'?property==='volume':property!=='volume'||clip.kind==='video');
        const keyProperties=[...baseProperties,...comicVisualProperties(clip)];
        const label=(property:ComicCompositionProperty):string=>property.includes(':')?comicVisualPropertyLabel(this.props.locale,clip,property):this.t(property as ComicMultitrackTextKey);
        const externalText=clip.kind==='text'&&clip.assetId&&clip.text===undefined, cues=this.props.player?.subtitleCues?.[clip.assetId||'']||[];
        return <aside className='nmx-mt-inspector'><strong>{this.cut('clip')}</strong>
            <label className='nmx-mt-field'><span>{this.cut('name')}</span><input key={`${clip.id}:${clip.title}`} defaultValue={clip.title || ''} disabled={disabled} onBlur={event => { if (event.currentTarget.value !== (clip.title || '')) this.patchClip(clip.id, { title: event.currentTarget.value }); }} /></label>
            {numeric(this.cut('playhead'), clip.from / this.props.fps, value => this.patchClip(clip.id, { from: Math.max(0, Math.round(value * this.props.fps)) }), 0, 1/this.props.fps)}
            {numeric(this.cut('duration'), clip.durationFrames / this.props.fps, value => { const frames = Math.max(1, Math.min(this.sourceLimit(clip)-clip.sourceStartFrames, Math.round(value*this.props.fps))); this.patchClip(clip.id, resizeComicCompositionClip(clip,0,frames)); }, 1/this.props.fps, 1/this.props.fps)}
            {clip.kind === 'text' && <>{externalText?<><textarea aria-label={this.t('text')} readOnly value={cues.filter(cue=>clip.sourceStartFrames+this.local(clip)>=cue.startFrame&&clip.sourceStartFrames+this.local(clip)<cue.startFrame+cue.durationFrames).map(cue=>cue.text).join('\n')} />
                {cues.length?<button type='button' aria-label={this.t('editCaptions')} disabled={disabled} onClick={()=>this.editCaptions(clip)}>{this.t('editCaptions')}</button>:<small>{comicStudioText(this.props.locale,'recognizeNone')}</small>}</>
                :<textarea key={`${clip.id}:${clip.text}`} defaultValue={clip.text || ''} disabled={disabled} aria-label={this.t('text')} onBlur={event => { if (event.currentTarget.value !== (clip.text || '')) this.patchClip(clip.id, { text: event.currentTarget.value }); }} />}
                {numeric(this.t('fontSize'),clip.textStyle?.fontSize || 56, value => this.patchClip(clip.id,{textStyle:{...clip.textStyle,fontSize:Math.max(8,Math.round(value))}}),8)}
                <label className='nmx-mt-field'><span>{this.t('color')}</span><input type='color' value={clip.textStyle?.color || '#ffffff'} disabled={disabled} onChange={event => this.patchClip(clip.id,{textStyle:{...clip.textStyle,color:event.currentTarget.value}})} /></label></>}
            {clip.kind !== 'audio' && clip.kind !== 'text' && <label className='nmx-mt-field'><span>{this.cut('fit')}</span><select aria-label={this.cut('fit')} value={clip.fit || 'contain'} disabled={disabled} onChange={event => this.patchClip(clip.id,{fit:event.currentTarget.value as 'contain'|'cover'})}><option value='contain'>{this.cut('fitContain')}</option><option value='cover'>{this.cut('fitCover')}</option></select></label>}
            {clip.kind==='video'&&<><label className='nmx-mt-field'><span>{this.t('nativeAudio')}</span><input type='checkbox' checked={clip.nativeAudio!==false} disabled={disabled} onChange={event=>this.patchClip(clip.id,{nativeAudio:event.currentTarget.checked})}/></label><button type='button' aria-label={this.t('detachAudio')} disabled={disabled||!clip.assetId} onClick={()=>this.detachAudio(clip)}>{this.t('detachAudio')}</button></>}
            {(['fadeInFrames','fadeOutFrames','audioFadeInFrames','audioFadeOutFrames'] as const).filter(property=>clip.kind==='audio'?property.startsWith('audio'):clip.kind==='video'||!property.startsWith('audio')).map(property=>numeric(`${this.t(property.startsWith('audio')?'audio':'video')} · ${this.cut(property.includes('In')?'fadeIn':'fadeOut')}`,(clip.envelope?.[property]??clip[property]??0)/this.props.fps,seconds=>this.patchClip(clip.id,setComicCompositionFade(clip,property,Math.max(0,Math.min(clip.durationFrames,Math.round(seconds*this.props.fps))))),0,1/this.props.fps))}
            {baseProperties.map(property => <div className='nmx-mt-property' key={property}>
                {numeric(label(property), evaluateComicCompositionProperty(clip, property, this.local(clip)), value => this.setProperty(clip, property, value), property === 'x' || property === 'y' || property === 'rotation' ? -100000 : 0, ['scale','opacity','volume'].includes(property) ? .05 : 1)}
                <button type='button' disabled={disabled} title={this.t('toggleKey')} aria-label={`${label(property)} · ${this.t('toggleKey')}`} aria-pressed={Boolean(clip.keyframes?.some(key => key.property===property && key.frame===this.local(clip)))} onClick={() => this.toggleKey(clip,property)}>◆</button>
            </div>)}
            {clip.kind!=='audio'&&clip.kind!=='empty'&&<ComicVisualPanel canvas={this.props.projectCanvas} clip={clip} frame={this.local(clip)} locale={this.props.locale} disabled={disabled} patch={patch=>this.patchClip(clip.id,patch)} keyframe={property=>this.toggleKey(clip,property)} numeric={(property,value)=>this.setProperty(clip,property,value)}/>}
            <div className='nmx-mt-key-heading'><strong>{this.t('keyframes')}</strong><select aria-label={this.t('keyframes')} value={this.state.property} onChange={event=>this.setState({property:event.currentTarget.value as ComicCompositionProperty})}>{keyProperties.map(property=><option key={property} value={property}>{label(property)}</option>)}</select></div>
            <div className='nmx-mt-key-list'>{(clip.keyframes||[]).filter(key=>key.property===this.state.property).sort((a,b)=>a.frame-b.frame).map(key=><div className='nmx-mt-key-row' key={`${key.property}:${key.frame}`}>
                <button type='button' title={this.cut('playhead')} onClick={()=>this.seek(clip.from+key.frame)}>◆</button>
                <input type='number' aria-label={this.t('frame')} defaultValue={key.frame} min={0} max={clip.durationFrames} disabled={disabled} onBlur={event=>{const frame=Math.max(0,Math.min(clip.durationFrames,Math.round(Number(event.currentTarget.value))));if(Number.isFinite(frame)&&frame!==key.frame)this.patchClip(clip.id,{keyframes:[...(clip.keyframes||[]).filter(item=>item!==key && !(item.property===key.property&&item.frame===frame)),{...key,frame}]});}} />
                <select aria-label={this.t('keyframes')} value={key.easing} disabled={disabled} onChange={event=>this.patchClip(clip.id,{keyframes:(clip.keyframes||[]).map(item=>item===key?{...item,easing:event.currentTarget.value as ComicCompositionEasing,easingStart:undefined,easingEnd:undefined}:item)})}>{easings.map(easing=><option key={easing} value={easing}>{this.t(easing)}</option>)}</select>
                <button type='button' disabled={disabled} aria-label={this.cut('delete')} title={this.cut('delete')} data-nmx-tip={this.cut('delete')} onClick={()=>this.patchClip(clip.id,{keyframes:clip.keyframes!.filter(item=>item!==key)})}>×</button>
            </div>)}</div>
        </aside>;
    }
    protected editCaptions(clip:ComicCompositionClip):void{
        const cues=this.props.player?.subtitleCues?.[clip.assetId||'']||[];
        const copies=cues.flatMap(cue=>{const start=Math.max(0,cue.startFrame-clip.sourceStartFrames),end=Math.min(clip.durationFrames,cue.startFrame+cue.durationFrames-clip.sourceStartFrames);if(end<=start)return[];return[{...trimComicCompositionClip(clip,start,end),id:uid('caption'),assetId:undefined,sourceStartFrames:0,text:cue.text,purpose:'subtitle' as const}];});
        if(!copies.length)return;const value=this.value();void this.commit({...value,clips:value.clips.flatMap(item=>item.id===clip.id?copies:[item])}).then(saved=>{if(saved)this.setState({selected:[copies[0].id]});});
    }
    protected detachAudio(clip:ComicCompositionClip):void{
        if(!clip.assetId||!this.editable(clip))return;const value=this.value(),id=uid('audio'),trackId=uid('track'),sourceTrack=value.tracks.find(track=>track.id===clip.trackId);
        const audio:ComicCompositionClip={...clip,id,trackId,kind:'audio',effects:undefined,masks:undefined,transform:undefined,legacyFadeToBlack:undefined,nativeAudio:undefined,keyframes:clip.keyframes?.filter(key=>key.property==='volume')};
        void this.commit({...value,tracks:[...value.tracks,{id:trackId,title:this.t('audio'),kind:'audio',volume:sourceTrack?.volume,muted:clip.nativeAudio===false||sourceTrack?.muted,solo:sourceTrack?.solo}],clips:[...value.clips.map(item=>item.id===clip.id?{...item,nativeAudio:false}:item),audio]}).then(saved=>{if(saved)this.setState({selected:[id],trackId,property:'volume'});});
    }
    protected drop = (event: React.DragEvent<HTMLElement>, track: ComicCompositionTrack): void => {
        event.preventDefault(); event.stopPropagation(); if (this.state.dropTrackId) this.setState({ dropTrackId: undefined });
        if (this.blocked() || track.locked) return;
        const rect = event.currentTarget.getBoundingClientRect(), frame = Math.max(0,Math.round((event.clientX-rect.left)/this.pixels()));
        if (event.dataTransfer.files.length) { void this.props.onImportFiles([...event.dataTransfer.files],track.id,frame); return; }
        const id=event.dataTransfer.getData(ASSET_MIME), asset=[...this.props.assets,...(this.props.groups||[]).flatMap(group=>group.assets)].find(item=>item.id===id);
        if (asset) void this.insert(asset,track.id,frame);
    };
    protected trackTitle(track: ComicCompositionTrack): string {
        const legacy: Record<string, readonly [string, ComicCutTextKey]> = { 'legacy-picture':['Video','trackVideo'], 'legacy-voice':['Voice','trackVoice'], 'legacy-music':['Music','trackMusic'], 'legacy-effect':['Effects','trackEffect'], 'legacy-subtitle':['Subtitles','trackSubtitle'] };
        const entry=legacy[track.id]; return entry && track.title===entry[0] ? this.cut(entry[1]) : track.title;
    }
    protected trackLayouts(): NonNullable<ComicMultitrack['trackLayoutCache']>['rows'] {
        const value=this.value(); if(this.trackLayoutCache?.value===value)return this.trackLayoutCache.rows;
        const groups=new Map<string,ComicCompositionClip[]>(); for(const clip of value.clips){const list=groups.get(clip.trackId)||[];list.push(clip);groups.set(clip.trackId,list);}
        let offset=34;
        const rows=[...value.tracks].reverse().map(track=>{
            type Slot={end:number;lane:number};const active:Slot[]=[],free:number[]=[];let lanes=0;
            const push=(slot:Slot):void=>{let i=active.length;active.push(slot);while(i>0){const parent=(i-1)>>1;if(active[parent].end<=slot.end)break;active[i]=active[parent];i=parent;}active[i]=slot;};
            const pop=():Slot=>{const first=active[0],last=active.pop()!;if(active.length){let i=0;active[0]=last;while(i*2+1<active.length){let child=i*2+1;if(child+1<active.length&&active[child+1].end<active[child].end)child++;if(active[child].end>=last.end)break;active[i]=active[child];i=child;}active[i]=last;}return first;};
            const clips=(groups.get(track.id)||[]).sort((a,b)=>a.from-b.from).map(clip=>{while(active.length&&active[0].end<=clip.from)free.push(pop().lane);const lane=free.pop()??lanes++;push({lane,end:clip.from+clip.durationFrames});return{clip,lane};});
            const height=Math.max(66,lanes*54+12),row={track,offset,height,clips};offset+=height;return row;
        });
        this.trackLayoutCache={value,rows};return rows;
    }
    protected renderTimeline(): React.ReactNode {
        const value=this.value(), width=Math.max(640,(this.duration()+this.props.fps*5)*this.pixels()), step=Math.max(1,Math.ceil(55/this.state.zoom));
        const left=Math.max(0,this.state.scrollLeft-300), right=this.state.scrollLeft+this.state.viewportWidth+300, firstTick=Math.floor(left/this.state.zoom/step), lastTick=Math.ceil(right/this.state.zoom/step);
        return <div className='nmx-mt-timeline' style={{height:this.state.trackHeight}} ref={this.bindScroller} onScroll={event=>{this.setState({scrollLeft:event.currentTarget.scrollLeft,scrollTop:event.currentTarget.scrollTop,viewportWidth:event.currentTarget.clientWidth});if(this.scrub)this.scrubTo(this.scrub.clientX);}}>
            <div className='nmx-mt-ruler-row'><div className='nmx-mt-track-label'><select aria-label={this.t('addTrack')} value='' disabled={this.blocked()} onChange={event=>{if(event.currentTarget.value)void this.addTrack(event.currentTarget.value as ComicCompositionTrack['kind']);}}><option value=''>{this.t('addTrack')}</option>{(['video','audio','text'] as const).map(kind=><option key={kind} value={kind}>{this.t(kind)}</option>)}</select><button type='button' disabled={this.blocked()} title={this.t('addText')} onClick={()=>void this.addText()}>T+</button></div>
                <div className='nmx-mt-ruler' ref={element=>{this.ruler=element;}} style={{width}} onPointerDown={event=>this.beginScrub(event)}>{Array.from({length:Math.min(200,lastTick-firstTick+1)},(_,i)=><span key={i+firstTick} style={{left:(i+firstTick)*step*this.state.zoom}}>{formatEditorTime((i+firstTick)*step)}</span>)}<div className='nmx-mt-playhead nmx-mt-playhead-handle' style={{left:this.state.frame*this.pixels()}}
                    role='slider' tabIndex={0} aria-label={this.cut('playhead')} aria-orientation='horizontal' aria-valuemin={0} aria-valuemax={this.duration()} aria-valuenow={this.state.frame} aria-valuetext={formatEditorTime(this.state.frame/this.props.fps)} onPointerDown={event=>this.beginScrub(event,true)} /></div></div>
            {this.trackLayouts().map(({track,height,offset,clips},index)=><div className={`nmx-mt-track is-${track.kind}${track.locked?' is-locked':''}${track.hidden?' is-hidden':''}${this.state.dropTrackId===track.id?' is-drop-target':''}`} key={track.id} data-track-id={track.id} style={{height}}>
                <div className='nmx-mt-track-label' onClick={()=>this.setState({trackId:track.id})}><input key={`${track.id}:${track.title}`} aria-label={this.t('rename')} defaultValue={this.trackTitle(track)} disabled={this.blocked()||track.locked} onBlur={event=>{if(event.currentTarget.value.trim()&&event.currentTarget.value!==this.trackTitle(track))this.patchTrack(track.id,{title:event.currentTarget.value.trim()});}} />
                    <div>{this.tool('arrow-up',this.t('up'),()=>this.moveTrack(track.id,1),index===0||track.locked)}{this.tool('arrow-down',this.t('down'),()=>this.moveTrack(track.id,-1),index===value.tracks.length-1||track.locked)}
                    {this.tool(track.muted?'mute':'unmute',this.t(track.muted?'unmute':'mute'),()=>this.patchTrack(track.id,{muted:!track.muted}),false,track.muted)}
                    {track.kind!=='audio'&&this.tool(track.hidden?'eye-closed':'eye',this.t(track.hidden?'show':'hide'),()=>this.patchTrack(track.id,{hidden:!track.hidden}),false,track.hidden)}
                    {this.tool(track.locked?'lock':'unlock',this.t(track.locked?'unlock':'lock'),()=>this.patchTrack(track.id,{locked:!track.locked}),false,track.locked)}
                    <button type='button' title={this.t(track.solo?'unsolo':'solo')} aria-label={this.t(track.solo?'unsolo':'solo')} aria-pressed={Boolean(track.solo)} disabled={this.blocked()} onClick={()=>this.patchTrack(track.id,{solo:!track.solo})}>S</button>
                    {this.tool('trash',this.t('deleteTrack'),()=>this.removeTrack(track.id),track.locked)}</div>
                </div><div className='nmx-mt-track-content' style={{width,height:height-1}} onDragOver={event=>{if(!track.locked&&!this.blocked()){event.preventDefault();event.dataTransfer.dropEffect='copy';if(this.state.dropTrackId!==track.id)this.setState({dropTrackId:track.id});}}}
                    onDragLeave={event=>{if(this.state.dropTrackId===track.id&&!event.currentTarget.contains(event.relatedTarget as Node|null))this.setState({dropTrackId:undefined});}} onDrop={event=>this.drop(event,track)} onPointerDown={event=>{if(event.target===event.currentTarget){this.setState({selected:[],trackId:track.id});const rect=event.currentTarget.getBoundingClientRect();this.seek((event.clientX-rect.left)/this.pixels());}}}>
                    {clips.filter(({clip,lane})=>((clip.from+clip.durationFrames)*this.pixels()>=left&&clip.from*this.pixels()<=right&&offset+lane*54+66>=this.state.scrollTop-100&&offset+lane*54<=this.state.scrollTop+this.state.trackHeight+100||Boolean(this.drag?.ids.includes(clip.id)))).map(({clip,lane})=><div key={clip.id} className={`nmx-mt-clip is-${clip.kind}${this.state.selected.includes(clip.id)?' is-selected':''}`} data-clip-id={clip.id} role='button' tabIndex={0} aria-label={clip.title||clip.text||this.cut('clip')} aria-pressed={this.state.selected.includes(clip.id)} style={{top:7+lane*54,left:clip.from*this.pixels(),width:Math.max(4,clip.durationFrames*this.pixels())}}
                        onPointerDown={event=>this.begin(event,clip)} onPointerMove={this.move} onPointerUp={this.end} onPointerCancel={()=>{this.drag=undefined;this.setState({draft:undefined});}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();this.select(clip.id,event.shiftKey);}}}>
                        <span className='nmx-mt-trim is-start' onPointerDown={event=>this.begin(event,clip,'start')} onPointerMove={this.move} onPointerUp={this.end} />
                        <strong>{clip.title||clip.text||this.props.mediaAssets.find(asset=>asset.id===clip.assetId)?.title||this.cut('clip')}</strong>
                        <span className='nmx-mt-clip-duration'>{(clip.durationFrames/this.props.fps).toFixed(1)}s</span>
                        {this.state.selected.includes(clip.id)&&(clip.keyframes||[]).filter(key=>key.property===this.state.property).map(key=><button type='button' className='nmx-mt-key-diamond' key={`${key.property}:${key.frame}`} title={`${key.property.includes(':')?comicVisualPropertyLabel(this.props.locale,clip,key.property):this.t(key.property as ComicMultitrackTextKey)} · ${key.frame}`} style={{left:key.frame*this.pixels()}} onPointerDown={event=>{event.stopPropagation();if(event.button!==0||this.scrub||this.blocked()||!this.editable(clip))return;this.seek(clip.from+key.frame);this.root?.setPointerCapture(event.pointerId);this.keyDrag={clip,property:key.property,frame:key.frame,x:event.clientX,pointerId:event.pointerId,base:this.value()};}} onClick={event=>{event.stopPropagation();this.seek(clip.from+key.frame);}}>◆</button>)}
                        <span className='nmx-mt-trim is-end' onPointerDown={event=>this.begin(event,clip,'end')} onPointerMove={this.move} onPointerUp={this.end} />
                    </div>)}<div className='nmx-mt-playhead' style={{left:this.state.frame*this.pixels()}} aria-hidden='true' onPointerDown={event=>this.beginScrub(event,true)} /></div>
            </div>)}
        </div>;
    }
    override render(): React.ReactNode {
        const shortcut = platformShortcutText;
        return <section className='nmx-mt' ref={element=>{this.root=element;}} tabIndex={-1} onKeyDown={this.key} onPointerMove={this.move} onPointerUp={this.end} onPointerCancel={event=>{if(this.scrub?.pointerId===event.pointerId)this.finishScrub();else{this.drag=undefined;this.keyDrag=undefined;this.setState({draft:undefined});}}} onLostPointerCapture={event=>{if(this.scrub?.pointerId===event.pointerId)this.finishScrub();}} onFocusCapture={event=>{if((event.target as HTMLElement).closest('input,textarea,select'))this.controller?.pause();}} onPointerDownCapture={event=>{if(!(event.target as HTMLElement).closest('input,textarea,select,button,[role="separator"],[role="slider"]'))event.currentTarget.focus({preventScroll:true});}}
            onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={event=>{if(event.dataTransfer.files.length&&!this.blocked()){event.preventDefault();void this.props.onImportFiles([...event.dataTransfer.files]);}}}>
            {this.renderToolbar()}{this.state.error&&<div className='nmx-mt-error' role='alert'>{this.t('saveFailed')}<button type='button' aria-label={comicCutLayoutText(this.props.locale,'dismiss')} title={comicCutLayoutText(this.props.locale,'dismiss')} data-nmx-tip={comicCutLayoutText(this.props.locale,'dismiss')} onClick={()=>this.setState({error:false})}>×</button></div>}
            {this.state.keys&&<div className='nmx-mt-shortcuts' role='dialog' aria-label={this.cut('keys')}><strong className='nmx-mt-shortcuts-title'>{this.cut('keys')}</strong><button type='button' aria-label={comicCutLayoutText(this.props.locale,'dismiss')} title={comicCutLayoutText(this.props.locale,'dismiss')} data-nmx-tip={comicCutLayoutText(this.props.locale,'dismiss')} onClick={()=>this.setState({keys:false})}><i className='codicon codicon-close' aria-hidden='true' /></button>{this.cut('keyActions').split('|').slice(1).map((label,i)=><div key={i}><span>{shortcut(label)}</span><kbd>{shortcut(['Space','J / K / L','← / →','Home / End','S','Q / W','⌘D','Delete','⌘Z','⇧⌘Z','= / −','\\','⌘E'][i])}</kbd></div>)}</div>}
            <div className={`nmx-mt-main${this.state.selected.length?' has-selection':''}`}>{this.renderBin()}<ComicMultitrackPlayer {...this.props.player} composition={this.value()} mediaAssets={this.props.mediaAssets} fps={this.props.fps} projectCanvas={this.props.projectCanvas} locale={this.props.locale}
                onController={controller=>{this.controller=controller;this.props.player?.onController?.(controller);}} onTick={seconds=>{const frame=Math.round(seconds*this.props.fps),now=performance.now();if(frame!==this.state.frame&&(!this.controller?.state().playing||now-this.lastTimelineTick>=50)){this.lastTimelineTick=now;this.setState({frame});}}} />{this.renderInspector()}</div>
            <div className='nmx-mt-resizer' role='separator' tabIndex={0} aria-orientation='horizontal' aria-label={comicCutLayoutText(this.props.locale,'timelineSize')} aria-valuenow={this.state.trackHeight} aria-valuemin={130} aria-valuemax={Math.max(130,(this.root?.clientHeight||700)-220)}
                onKeyDown={event=>{if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();this.setState({trackHeight:Math.max(130,Math.min((this.root?.clientHeight||700)-220,event.key==='Home'?130:event.key==='End'?10000:this.state.trackHeight+(event.key==='ArrowUp'?24:-24)))});}}}
                onDoubleClick={()=>this.setState({trackHeight:240})} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);this.resize={y:event.clientY,height:this.state.trackHeight};}}
                onPointerMove={event=>{if(this.resize)this.setState({trackHeight:Math.max(130,Math.min((this.root?.clientHeight||700)-220,this.resize.height+this.resize.y-event.clientY))});}} onPointerUp={()=>{this.resize=undefined;}} onPointerCancel={()=>{this.resize=undefined;}} />
            {this.renderTimeline()}
        </section>;
    }
}
