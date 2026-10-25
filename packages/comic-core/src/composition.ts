import type { ComicCanvas, ComicProject } from './types.js';
import { ComicCoreError } from './validation.js';
import { getComicAssetDurationFrames, getComicMediaDurationFrames } from './media-timing.js';
import { getComicDissolveOverlaps, resolveComicShotFades, resolveComicShotTransitions } from './pipeline.js';

import { validateComicVisualEffects, validateComicVisualMasks, comicVisualPropertyBase, comicVisualPropertyRange, type ComicVisualProperty, type ComicVisualEffect, type ComicVisualMask } from './visual-effects.js';

export type ComicCompositionProperty = ComicVisualProperty | 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';
export type ComicCompositionEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
export interface ComicCompositionKeyframe {
  readonly property: ComicCompositionProperty;
  /** Clip-local frame. The duration endpoint is legal, although not rendered. */
  readonly frame: number;
  readonly value: number;
  /** Interpolation FROM this key to the next key for this property. */
  readonly easing: ComicCompositionEasing;
  /** A cropped interval of the original easing curve, retained on trim/split. */
  readonly easingStart?: number;
  readonly easingEnd?: number;
}
export interface ComicCompositionTransform {
  /** Pixel offsets from the output canvas centre; clockwise rotation in degrees. */
  readonly x?: number; readonly y?: number; readonly scale?: number; readonly rotation?: number; readonly opacity?: number;
}
export interface ComicCompositionTextStyle {
  readonly fontSize?: number; readonly color?: string; readonly backgroundColor?: string;
  readonly align?: 'left' | 'center' | 'right'; readonly bold?: boolean;
}
/** Fades use an immutable original window so cutting inside a fade never restarts it. */
export interface ComicCompositionEnvelope {
  readonly durationFrames: number; readonly offsetFrames: number;
  readonly fadeInFrames?: number; readonly fadeOutFrames?: number;
  readonly audioFadeInFrames?: number; readonly audioFadeOutFrames?: number;
  readonly dissolveInFrames?: number; readonly dissolveOutFrames?: number;
  /** Original-window anchors. Resetting one fade after a trim does not reset the others. */
  readonly fadeInStartFrame?: number; readonly fadeOutEndFrame?: number;
  readonly audioFadeInStartFrame?: number; readonly audioFadeOutEndFrame?: number;
}
export interface ComicCompositionTrack {
  readonly id: string; readonly title: string; readonly kind: 'video' | 'audio' | 'text';
  readonly locked?: boolean; readonly hidden?: boolean; readonly muted?: boolean; readonly solo?: boolean; readonly volume?: number;
}
export interface ComicCompositionClip {
  readonly id: string; readonly trackId: string; readonly title?: string;
  /** empty+missing represents missing LEGACY picture, never an intentional black gap. */
  readonly kind: 'video' | 'image' | 'audio' | 'text' | 'empty';
  readonly from: number; readonly durationFrames: number; readonly sourceStartFrames: number;
  readonly assetId?: string; readonly text?: string; readonly textStyle?: ComicCompositionTextStyle;
  readonly purpose?: 'subtitle' | 'title'; readonly captionSourceClipId?: string;
  readonly missing?: boolean; readonly legacyShotId?: string;
  /** Legacy shots fade their full opaque black-backed canvas, before a dissolve. */
  readonly legacyFadeToBlack?: boolean;
  /** contain by default. Images, video and text share the same transform space. */
  readonly fit?: 'contain' | 'cover'; readonly transform?: ComicCompositionTransform;
  readonly volume?: number; readonly nativeAudio?: boolean;
  readonly fadeInFrames?: number; readonly fadeOutFrames?: number;
  readonly audioFadeInFrames?: number; readonly audioFadeOutFrames?: number;
  readonly envelope?: ComicCompositionEnvelope;
  readonly effects?: readonly ComicVisualEffect[]; readonly masks?: readonly ComicVisualMask[];
  readonly keyframes?: readonly ComicCompositionKeyframe[];
}
export interface ComicComposition {
  readonly schemaVersion: 1;
  /** Paint order: bottom to top. Within a track, clips paint in array order. */
  readonly tracks: readonly ComicCompositionTrack[];
  readonly clips: readonly ComicCompositionClip[];
}
export interface ComicCompositionValue {
  readonly x: number; readonly y: number; readonly scale: number; readonly rotation: number;
  /** Includes visual fades; volume includes audio fades, but NOT track volume. */
  readonly opacity: number; readonly volume: number;
  /** Legacy visual fade multiplies RGB, keeping black letterboxing opaque. New clips return 1. */
  readonly brightness: number;
}
export interface ComicCompositionSample extends ComicCompositionValue {
  readonly clip: ComicCompositionClip; readonly track: ComicCompositionTrack;
  readonly localFrame: number; readonly sourceFrame: number;
  /** Track/kind permission only; not opacity/volume at this instant. */
  readonly visible: boolean; readonly audible: boolean;
}
export type ComicCompositionContext = Pick<ComicProject, 'assets' | 'frameRate' | 'canvas'>;
export type ComicCompositionOperation =
  | { readonly type: 'replace'; readonly composition: ComicComposition }
  | { readonly type: 'track.add'; readonly track: ComicCompositionTrack; readonly index?: number }
  | { readonly type: 'track.update'; readonly trackId: string; readonly patch: Partial<Omit<ComicCompositionTrack, 'id' | 'kind'>> }
  | { readonly type: 'track.move'; readonly trackId: string; readonly index: number }
  | { readonly type: 'track.remove'; readonly trackId: string }
  | { readonly type: 'clip.add'; readonly clip: ComicCompositionClip }
  | { readonly type: 'clip.update'; readonly clipId: string; readonly patch: Partial<Omit<ComicCompositionClip, 'id' | 'trackId' | 'kind'>> }
  | { readonly type: 'clip.move'; readonly clipId: string; readonly trackId?: string; readonly from: number }
  | { readonly type: 'clip.remove'; readonly clipId: string }
  | { readonly type: 'clip.split'; readonly clipId: string; readonly atFrame: number; readonly rightId: string }
  | { readonly type: 'clip.duplicate'; readonly clipId: string; readonly id: string; readonly from?: number; readonly trackId?: string }
  | { readonly type: 'clip.trim'; readonly clipId: string; readonly startFrame: number; readonly endFrame: number }
  | { readonly type: 'keyframe.set'; readonly clipId: string; readonly keyframe: ComicCompositionKeyframe }
  | { readonly type: 'keyframe.remove'; readonly clipId: string; readonly property: ComicCompositionProperty; readonly frame: number };

export const COMIC_COMPOSITION_LIMITS = { tracks: 128, clips: 10_000, keyframesPerClip: 2048, keyframes: 100_000, frame: 10_000_000 } as const;
const properties: readonly ComicCompositionProperty[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];
const easingNames: readonly ComicCompositionEasing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'];
const compiledCurves = new WeakMap<readonly ComicCompositionKeyframe[], ReadonlyMap<ComicCompositionProperty, readonly ComicCompositionKeyframe[]>>();
const trackIndexes = new WeakMap<readonly ComicCompositionTrack[], { readonly solo: boolean; readonly tracks: ReadonlyMap<string, { readonly track: ComicCompositionTrack; readonly index: number }> }>();
function indexedTracks(composition: ComicComposition) {
  let value = trackIndexes.get(composition.tracks);
  if (!value) { value = { solo: composition.tracks.some(track => track.solo), tracks: new Map(composition.tracks.map((track, index) => [track.id, { track, index }])) }; trackIndexes.set(composition.tracks, value); }
  return value;
}
const clamp = (n: number, a: number, b: number): number => Math.min(b, Math.max(a, n));
function fail(message: string, code = 'INVALID_COMPOSITION'): never {
  if (code === 'TRACK_LOCKED') throw new ComicCoreError(code, message, 'comic.composition.track_locked', {});
  if (code === 'INVALID_MEDIA_RANGE') throw new ComicCoreError(code, message, 'comic.invalid_project.media_source_range_exceeds_the_available_source_duration', {});
  throw new ComicCoreError(code, message, 'comic.composition.invalid', {});
}
function ease(type: ComicCompositionEasing, t: number): number {
  return type === 'hold' ? (t >= 1 ? 1 : 0) : type === 'easeIn' ? t * t : type === 'easeOut' ? 1 - (1 - t) ** 2
    : type === 'easeInOut' ? t * t * (3 - 2 * t) : t;
}
function propertyBase(clip: ComicCompositionClip, property: ComicCompositionProperty): number {
  if(property.startsWith('effect:')||property.startsWith('mask:'))return comicVisualPropertyBase(clip,property);
  return property === 'volume' ? clip.volume ?? 1 : clip.transform?.[property as keyof ComicCompositionTransform] ?? (property === 'scale' || property === 'opacity' ? 1 : 0);
}
function propertyValue(clip: ComicCompositionClip, property: ComicCompositionProperty, frame: number): number {
  let groups = clip.keyframes ? compiledCurves.get(clip.keyframes) : undefined;
  if (clip.keyframes && !groups) {
    const compiled = new Map<ComicCompositionProperty, ComicCompositionKeyframe[]>();
    for (const key of clip.keyframes) { const curve = compiled.get(key.property) ?? []; curve.push(key); compiled.set(key.property, curve); }
    for (const curve of compiled.values()) curve.sort((a, b) => a.frame - b.frame);
    groups = compiled; compiledCurves.set(clip.keyframes, groups);
  }
  const keys = groups?.get(property);
  if (!keys?.length) return propertyBase(clip, property);
  if (frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;
  let low = 1, high = keys.length - 1;
  while (low < high) { const middle = (low + high) >>> 1; if (keys[middle].frame <= frame) low = middle + 1; else high = middle; }
  {
    const a = keys[low - 1], b = keys[low];
    const start = a.easingStart ?? 0, end = a.easingEnd ?? 1, u = clamp((frame - a.frame) / (b.frame - a.frame), 0, 1);
    if (a.easing === 'hold') return a.value;
    const denominator = ease(a.easing, end) - ease(a.easing, start);
    const progress = clamp(denominator > 1e-12 ? (ease(a.easing, start + (end - start) * u) - ease(a.easing, start)) / denominator : u, 0, 1);
    const raw = a.value + (b.value - a.value) * progress;
    const visualRange = comicVisualPropertyRange(clip, String(property));
    if (visualRange) return clamp(raw, visualRange[0], visualRange[1]);
    return clamp(
      raw,
      property === 'scale' ? 0.001 : property === 'opacity' || property === 'volume' ? 0 : -100_000,
      property === 'scale' ? 100 : property === 'opacity' ? 1 : property === 'volume' ? 4 : 100_000,
    );
  }
}
/** Authored property before fade/track gain, for inspector and keyframe insertion. */
export function evaluateComicCompositionProperty(clip: ComicCompositionClip, property: ComicCompositionProperty, localFrame: number): number {
  return propertyValue(clip, property, clamp(localFrame, 0, clip.durationFrames));
}
function fade(frame: number, duration: number, incoming = 0, outgoing = 0, incomingStart = 0, outgoingEnd = duration): number {
  return clamp(Math.min(incoming ? (frame - incomingStart) / incoming : 1, outgoing ? (outgoingEnd - frame) / outgoing : 1), 0, 1);
}
export function evaluateComicCompositionClip(clip: ComicCompositionClip, localFrame: number): ComicCompositionValue {
  const t = clamp(localFrame, 0, clip.durationFrames), e = clip.envelope;
  const originalFrame = t + (e?.offsetFrames ?? 0), duration = e?.durationFrames ?? clip.durationFrames;
  const visualFade = fade(originalFrame, duration, e?.fadeInFrames ?? clip.fadeInFrames, e?.fadeOutFrames ?? clip.fadeOutFrames, e?.fadeInStartFrame, e?.fadeOutEndFrame);
  const audioFade = fade(originalFrame, duration, e?.audioFadeInFrames ?? clip.audioFadeInFrames, e?.audioFadeOutFrames ?? clip.audioFadeOutFrames, e?.audioFadeInStartFrame, e?.audioFadeOutEndFrame);
  // Alpha-over: only the incoming picture fades; fading the outgoing one would dim it twice.
  const dissolveVisual = fade(originalFrame, duration, e?.dissolveInFrames, 0);
  const dissolveAudio = fade(originalFrame, duration, e?.dissolveInFrames, e?.dissolveOutFrames);
  return { x: propertyValue(clip, 'x', t), y: propertyValue(clip, 'y', t), scale: propertyValue(clip, 'scale', t), rotation: propertyValue(clip, 'rotation', t),
    opacity: clamp(propertyValue(clip, 'opacity', t) * (clip.legacyFadeToBlack ? 1 : visualFade) * dissolveVisual, 0, 1),
    brightness: clip.legacyFadeToBlack ? visualFade : 1, volume: propertyValue(clip, 'volume', t) * audioFade * dissolveAudio };
}
export function comicCompositionDurationFrames(composition: ComicComposition): number {
  return composition.clips.reduce((end, clip) => Math.max(end, clip.from + clip.durationFrames), 0);
}
/** O(1) after one track index, independent of the playhead or instantaneous fades. */
export function comicCompositionClipPermissions(composition: ComicComposition, clip: ComicCompositionClip): { readonly visible: boolean; readonly audible: boolean } {
  const { solo, tracks } = indexedTracks(composition), track = tracks.get(clip.trackId)?.track, enabled = !!track && (!solo || !!track.solo);
  return { visible: enabled && !track!.hidden && clip.kind !== 'audio', audible: enabled && !track!.muted && (clip.kind === 'audio' || clip.kind === 'video' && clip.nativeAudio !== false) };
}
export function sampleComicComposition(composition: ComicComposition, timelineFrame: number): readonly ComicCompositionSample[] {
  const { tracks } = indexedTracks(composition);
  return composition.clips.filter(clip => timelineFrame >= clip.from && timelineFrame < clip.from + clip.durationFrames)
    .map(clip => {
      const track = tracks.get(clip.trackId)?.track;
      if (!track) return undefined;
      const localFrame = timelineFrame - clip.from;
      return { clip, track, localFrame, sourceFrame: clip.sourceStartFrames + localFrame, ...evaluateComicCompositionClip(clip, localFrame),
        ...comicCompositionClipPermissions(composition, clip) };
    }).filter((sample): sample is ComicCompositionSample => !!sample)
    .sort((a, b) => tracks.get(a.track.id)!.index - tracks.get(b.track.id)!.index);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function number(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) fail(`${label} is outside its permitted range`);
  return value;
}
function text(value: unknown, label: string, max = 160, empty = false): string {
  if (typeof value !== 'string' || value.includes('\0') || value.length > max || !empty && !value.trim()) fail(`${label} is invalid`);
  return value;
}
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') fail(`${label} must be a boolean`); return value; }
function list(value: unknown, label: string, max: number): readonly unknown[] { if (!Array.isArray(value) || value.length > max) fail(`${label} exceeds its limit`); return value; }
function unique(ids: readonly string[], label: string): void { if (new Set(ids).size !== ids.length) fail(`${label} contains duplicate ids`); }
function valueNumber(value: unknown, property: ComicCompositionProperty): number {
  return number(value, property, property === 'scale' ? .001 : property === 'opacity' || property === 'volume' ? 0 : -100_000,
    property === 'scale' ? 100 : property === 'opacity' ? 1 : property === 'volume' ? 4 : 100_000);
}
/** Canonical disk/edit validation. No capability or metadata is inferred from a filename. */
export function validateComicComposition(value: unknown, context: ComicCompositionContext): ComicComposition {
  const item = object(value, 'composition');
  if (item.schemaVersion !== 1) fail('Unsupported composition version');
  const tracks = list(item.tracks, 'tracks', COMIC_COMPOSITION_LIMITS.tracks).map((entry): ComicCompositionTrack => {
    const track = object(entry, 'track');
    if (!['video', 'audio', 'text'].includes(String(track.kind))) fail('Unknown track kind');
    const flags: Partial<Record<'locked' | 'hidden' | 'muted' | 'solo', boolean>> = {};
    for (const key of ['locked', 'hidden', 'muted', 'solo'] as const) if (track[key] !== undefined) flags[key] = bool(track[key], key);
    return { id: text(track.id, 'track.id'), title: text(track.title, 'track.title', 200, true), kind: track.kind as ComicCompositionTrack['kind'], ...flags,
      ...(track.volume === undefined ? {} : { volume: valueNumber(track.volume, 'volume') }) };
  });
  unique(tracks.map(track => track.id), 'tracks');
  const tracksById = new Map(tracks.map(track => [track.id, track])), assets = new Map(context.assets.map(asset => [asset.id, asset]));
  let keyCount = 0;
  const clips = list(item.clips, 'clips', COMIC_COMPOSITION_LIMITS.clips).map((entry): ComicCompositionClip => {
    const c = object(entry, 'clip'), id = text(c.id, 'clip.id'), trackId = text(c.trackId, 'clip.trackId'), track = tracksById.get(trackId);
    if (!track) fail('Clip references an unknown track', 'INVALID_REFERENCE');
    if (!['video', 'image', 'audio', 'text', 'empty'].includes(String(c.kind))) fail('Unknown clip kind');
    const kind = c.kind as ComicCompositionClip['kind'];
    if ((kind === 'audio' ? 'audio' : kind === 'text' ? 'text' : 'video') !== track.kind) fail('Clip kind does not match its track');
    const from = number(c.from, 'clip.from', 0, COMIC_COMPOSITION_LIMITS.frame, true);
    const durationFrames = number(c.durationFrames, 'clip.durationFrames', 1, COMIC_COMPOSITION_LIMITS.frame - from, true);
    const sourceStartFrames = number(c.sourceStartFrames, 'clip.sourceStartFrames', 0, COMIC_COMPOSITION_LIMITS.frame, true);
    const assetId = c.assetId === undefined ? undefined : text(c.assetId, 'clip.assetId'), asset = assetId ? assets.get(assetId) : undefined;
    if (assetId && !asset) fail(`Clip asset does not exist: ${assetId}`, 'INVALID_REFERENCE');
    const assetKinds = kind === 'audio' ? ['audio', 'music', 'effect', 'video'] : kind === 'text' ? ['subtitle', 'video'] : [kind];
    if (asset && !assetKinds.includes(asset.kind)) fail('Clip references the wrong media kind', 'INVALID_REFERENCE');
    if ((kind === 'video' || kind === 'image' || kind === 'audio') && !assetId) fail('Media clip requires an asset', 'INVALID_REFERENCE');
    if (kind === 'text' && !assetId && (typeof c.text !== 'string' || !c.text.trim())) fail('Text clip requires text or a subtitle asset');
    if (kind === 'empty' && (c.missing !== true || !c.legacyShotId)) fail('Empty clips are only for missing legacy picture');
    if ((kind === 'image' || kind === 'empty' || kind === 'text' && !assetId) && sourceStartFrames !== 0) fail('Untimed sources must start at zero');
    const sourceFrames = asset && (kind === 'video' || kind === 'audio' || kind === 'text' && asset.kind === 'video') ? getComicAssetDurationFrames(asset, context.frameRate) : undefined;
    if (sourceFrames !== undefined && sourceStartFrames + durationFrames > sourceFrames) fail('Clip exceeds its source media duration', 'INVALID_MEDIA_RANGE');
    const transform: Partial<Record<Exclude<ComicCompositionProperty, 'volume'>, number>> = {};
    if (c.transform !== undefined) {
      const raw = object(c.transform, 'transform');
      for (const property of properties) if (property !== 'volume' && raw[property] !== undefined) transform[property] = valueNumber(raw[property], property);
    }
    const fades: Partial<Record<'fadeInFrames' | 'fadeOutFrames' | 'audioFadeInFrames' | 'audioFadeOutFrames', number>> = {};
    for (const property of ['fadeInFrames', 'fadeOutFrames', 'audioFadeInFrames', 'audioFadeOutFrames'] as const)
      if (c[property] !== undefined) fades[property] = number(c[property], property, 0, durationFrames, true);
    let envelope: ComicCompositionEnvelope | undefined;
    if (c.envelope !== undefined) {
      const raw = object(c.envelope, 'envelope'), length = number(raw.durationFrames, 'envelope.durationFrames', 1, COMIC_COMPOSITION_LIMITS.frame, true);
      const offset = number(raw.offsetFrames, 'envelope.offsetFrames', 0, length, true);
      if (offset + durationFrames > length) fail('Clip is outside its animation envelope');
      const values: Record<string, number> = {};
      for (const key of ['fadeInFrames', 'fadeOutFrames', 'audioFadeInFrames', 'audioFadeOutFrames', 'dissolveInFrames', 'dissolveOutFrames',
        'fadeInStartFrame', 'fadeOutEndFrame', 'audioFadeInStartFrame', 'audioFadeOutEndFrame'])
        if (raw[key] !== undefined) values[key] = number(raw[key], `envelope.${key}`, 0, length, true);
      envelope = { durationFrames: length, offsetFrames: offset, ...values };
    }
    let textStyle: ComicCompositionTextStyle | undefined;
    if (c.textStyle !== undefined) {
      const style = object(c.textStyle, 'textStyle');
      const color = (value: unknown): string => { if (typeof value !== 'string' || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) fail('Text colors must be hexadecimal RGB or RGBA'); return value; };
      if (style.align !== undefined && !['left', 'center', 'right'].includes(String(style.align))) fail('Invalid text alignment');
      textStyle = { ...(style.fontSize === undefined ? {} : { fontSize: number(style.fontSize, 'fontSize', 1, 2048) }),
        ...(style.color === undefined ? {} : { color: color(style.color) }), ...(style.backgroundColor === undefined ? {} : { backgroundColor: color(style.backgroundColor) }),
        ...(style.align === undefined ? {} : { align: style.align as ComicCompositionTextStyle['align'] }), ...(style.bold === undefined ? {} : { bold: bool(style.bold, 'bold') }) };
    }
    let effects: readonly ComicVisualEffect[] | undefined, masks: readonly ComicVisualMask[] | undefined;
    try { effects=c.effects===undefined?undefined:validateComicVisualEffects(c.effects);masks=c.masks===undefined?undefined:validateComicVisualMasks(c.masks); } catch(error) { fail(error instanceof Error?error.message:'Invalid visual processing'); }
    if(kind==='audio'&&(effects?.length||masks?.length))fail('Audio clips cannot have visual effects');
    const visualClip={effects,masks};
    let keyframes: ComicCompositionKeyframe[] | undefined;
    if (c.keyframes !== undefined) {
      keyframes = list(c.keyframes, 'keyframes', COMIC_COMPOSITION_LIMITS.keyframesPerClip).map(entry => {
        const key = object(entry, 'keyframe');
        if ((!properties.includes(key.property as ComicCompositionProperty) && !comicVisualPropertyRange(visualClip,String(key.property))) || !easingNames.includes(key.easing as ComicCompositionEasing)) fail('Invalid keyframe property or easing');
        const property = key.property as ComicCompositionProperty, easing = key.easing as ComicCompositionEasing;
        const a = key.easingStart === undefined ? 0 : number(key.easingStart, 'easingStart', 0, 1), b = key.easingEnd === undefined ? 1 : number(key.easingEnd, 'easingEnd', 0, 1);
        if (a >= b) fail('Keyframe easing interval must be increasing');
        return { property, easing, frame: number(key.frame, 'keyframe.frame', 0, durationFrames, true), value: comicVisualPropertyRange(visualClip,property) ? number(key.value,property,...comicVisualPropertyRange(visualClip,property)!) : valueNumber(key.value, property),
          ...(key.easingStart === undefined ? {} : { easingStart: a }), ...(key.easingEnd === undefined ? {} : { easingEnd: b }) };
      }).sort((a, b) => properties.indexOf(a.property) - properties.indexOf(b.property) || a.frame - b.frame);
      unique(keyframes.map(key => `${key.property}:${key.frame}`), 'keyframes');
      keyCount += keyframes.length;
      if (keyCount > COMIC_COMPOSITION_LIMITS.keyframes) fail('Composition contains too many keyframes');
    }
    if (c.fit !== undefined && c.fit !== 'contain' && c.fit !== 'cover') fail('Unknown media fit');
    if (c.purpose !== undefined && c.purpose !== 'subtitle' && c.purpose !== 'title') fail('Unknown text purpose');
    return { id, trackId, kind, from, durationFrames, sourceStartFrames, ...fades, ...(effects?{effects}:{}), ...(masks?{masks}:{}),
      ...(assetId === undefined ? {} : { assetId }), ...(c.title === undefined ? {} : { title: text(c.title, 'clip.title', 200, true) }),
      ...(c.text === undefined ? {} : { text: text(c.text, 'clip.text', 20_000, true) }), ...(textStyle ? { textStyle } : {}),
      ...(c.purpose === undefined ? {} : { purpose: c.purpose as ComicCompositionClip['purpose'] }),
      ...(c.captionSourceClipId === undefined ? {} : { captionSourceClipId: text(c.captionSourceClipId, 'captionSourceClipId') }),
      ...(c.legacyShotId === undefined ? {} : { legacyShotId: text(c.legacyShotId, 'legacyShotId') }),
      ...(c.legacyFadeToBlack === undefined ? {} : { legacyFadeToBlack: bool(c.legacyFadeToBlack, 'legacyFadeToBlack') }),
      ...(c.missing === undefined ? {} : { missing: bool(c.missing, 'missing') }), ...(c.fit === undefined ? {} : { fit: c.fit as ComicCompositionClip['fit'] }),
      ...(c.transform === undefined ? {} : { transform }), ...(c.volume === undefined ? {} : { volume: valueNumber(c.volume, 'volume') }),
      ...(c.nativeAudio === undefined ? {} : { nativeAudio: bool(c.nativeAudio, 'nativeAudio') }), ...(envelope ? { envelope } : {}), ...(keyframes ? { keyframes } : {}) };
  });
  unique(clips.map(clip => clip.id), 'clips');
  return { schemaVersion: 1, tracks, clips };
}

/** Retain the original easing interval, not just the endpoint values, when cutting a curve. */
function slicedKeyframes(clip: ComicCompositionClip, start: number, end: number): readonly ComicCompositionKeyframe[] | undefined {
  if (!clip.keyframes?.length) return clip.keyframes;
  const output: ComicCompositionKeyframe[] = [];
  for (const property of new Set(clip.keyframes.map(key=>key.property))) {
    const keys = clip.keyframes.filter(key => key.property === property).sort((a, b) => a.frame - b.frame);
    if (!keys.length) continue;
    const boundaries = [...new Set([start, ...keys.filter(key => key.frame > start && key.frame < end).map(key => key.frame), end])];
    for (let i = 0; i < boundaries.length; i++) {
      const position = boundaries[i], next = boundaries[i + 1];
      const segment = keys.findIndex((key, index) => key.frame <= position && !!keys[index + 1] && keys[index + 1].frame > position);
      const a = segment >= 0 ? keys[segment] : undefined, b = segment >= 0 ? keys[segment + 1] : undefined;
      let interval: { easingStart?: number; easingEnd?: number } = {};
      if (a && b && next !== undefined) {
        const oldStart = a.easingStart ?? 0, oldEnd = a.easingEnd ?? 1;
        const easingStart = clamp(oldStart + (oldEnd - oldStart) * (position - a.frame) / (b.frame - a.frame), 0, 1);
        const easingEnd = clamp(oldStart + (oldEnd - oldStart) * (next - a.frame) / (b.frame - a.frame), 0, 1);
        if (easingEnd > easingStart) {
          interval = { easingStart, easingEnd };
        }
      }
      output.push({ property, frame: position - start, value: propertyValue(clip, property, position), easing: a?.easing ?? 'linear', ...interval });
    }
  }
  return output;
}
export function trimComicCompositionClip(clip: ComicCompositionClip, startFrame: number, endFrame: number): ComicCompositionClip {
  number(startFrame, 'trim start', 0, clip.durationFrames - 1, true);
  number(endFrame, 'trim end', startFrame + 1, clip.durationFrames, true);
  return resizeComicCompositionClip(clip, startFrame, endFrame);
}
/** Extending holds the boundary animation value; known source bounds are checked by the reducer. */
export function resizeComicCompositionClip(clip: ComicCompositionClip, startFrame: number, endFrame: number): ComicCompositionClip {
  const timed = clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'text' && !!clip.assetId;
  number(startFrame, 'resize start', -Math.min(clip.from, timed ? clip.sourceStartFrames : COMIC_COMPOSITION_LIMITS.frame), clip.durationFrames - 1, true);
  number(endFrame, 'resize end', Math.max(0, startFrame) + 1, COMIC_COMPOSITION_LIMITS.frame - clip.from, true);
  const envelope = clip.envelope ?? { durationFrames: clip.durationFrames, offsetFrames: 0,
    fadeInFrames: clip.fadeInFrames ?? 0, fadeOutFrames: clip.fadeOutFrames ?? 0,
    audioFadeInFrames: clip.audioFadeInFrames ?? 0, audioFadeOutFrames: clip.audioFadeOutFrames ?? 0 };
  const { fadeInFrames: _in, fadeOutFrames: _out, audioFadeInFrames: _ain, audioFadeOutFrames: _aout, ...base } = clip;
  const offset = envelope.offsetFrames + startFrame, extraHead = Math.max(0, -offset), extraTail = Math.max(0, envelope.offsetFrames + endFrame - envelope.durationFrames);
  const anchors: Partial<Record<'fadeInStartFrame' | 'audioFadeInStartFrame' | 'fadeOutEndFrame' | 'audioFadeOutEndFrame', number>> = {};
  for (const key of ['fadeInStartFrame', 'audioFadeInStartFrame', 'fadeOutEndFrame', 'audioFadeOutEndFrame'] as const) {
    const anchor = envelope[key]; if (anchor === undefined) continue;
    const incoming = key === 'fadeInStartFrame' || key === 'audioFadeInStartFrame';
    anchors[key] = (incoming && startFrame < 0 && anchor === envelope.offsetFrames ? offset
      : !incoming && endFrame > clip.durationFrames && anchor === envelope.offsetFrames + clip.durationFrames ? envelope.offsetFrames + endFrame : anchor) + extraHead;
  }
  return { ...base, from: clip.from + startFrame, durationFrames: endFrame - startFrame,
    sourceStartFrames: clip.sourceStartFrames + (timed ? startFrame : 0),
    envelope: { ...envelope, ...anchors, offsetFrames: Math.max(0, offset), durationFrames: envelope.durationFrames + extraHead + extraTail },
    ...(clip.keyframes ? { keyframes: slicedKeyframes(clip, startFrame, endFrame) } : {}) };
}
export function setComicCompositionFade(clip: ComicCompositionClip, property: 'fadeInFrames' | 'fadeOutFrames' | 'audioFadeInFrames' | 'audioFadeOutFrames', frames: number): ComicCompositionClip {
  number(frames, 'fade frames', 0, clip.durationFrames, true);
  const envelope = clip.envelope ?? { durationFrames: clip.durationFrames, offsetFrames: 0,
    fadeInFrames: clip.fadeInFrames ?? 0, fadeOutFrames: clip.fadeOutFrames ?? 0,
    audioFadeInFrames: clip.audioFadeInFrames ?? 0, audioFadeOutFrames: clip.audioFadeOutFrames ?? 0 };
  const anchor = property === 'fadeInFrames' ? 'fadeInStartFrame' : property === 'fadeOutFrames' ? 'fadeOutEndFrame'
    : property === 'audioFadeInFrames' ? 'audioFadeInStartFrame' : 'audioFadeOutEndFrame';
  return { ...clip, envelope: { ...envelope, [property]: frames,
    [anchor]: property === 'fadeInFrames' || property === 'audioFadeInFrames' ? envelope.offsetFrames : envelope.offsetFrames + clip.durationFrames } };
}

const textLayouts = new Map<string, string>();
/** Shared conservative line breaks; neither preview nor export may wrap these lines again. */
export function comicCompositionTextLines(value: string, fontSize: number, canvasWidth: number): string {
  const cacheKey = `${fontSize}:${canvasWidth}:${value}`, cached = textLayouts.get(cacheKey);
  if (cached !== undefined) return cached;
  const size = Math.max(1, Number.isFinite(fontSize) ? fontSize : 56), width = Math.max(1, canvasWidth - 16);
  // Segmenter preserves emoji ZWJ sequences and combining accents at a line boundary.
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(text: string): Iterable<{ segment: string }> } }).Segmenter;
  const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : undefined;
  const advance = (grapheme: string): number => /^\s+$/.test(grapheme) ? .4 * size
    : /^[ilI.,'`!|:;]$/.test(grapheme) ? .4 * size : /^[a-z0-9\-()[\]{}]$/i.test(grapheme) && !/^[MWmw]$/.test(grapheme) ? .75 * size
      : /[\u{10000}-\u{10ffff}]/u.test(grapheme) ? 2 * size : size;
  const output: string[] = [];
  for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
    const glyphs = segmenter ? [...segmenter.segment(paragraph)].map(item => item.segment) : Array.from(paragraph);
    let line: string[] = [], used = 0;
    for (const glyph of glyphs) {
      const length = advance(glyph);
      if (line.length && used + length > width) {
        let space = -1; for (let i = line.length - 1; i >= 0; i--) if (/^\s$/.test(line[i])) { space = i; break; }
        if (space > 0 && space >= line.length / 2) {
          output.push(line.slice(0, space).join('')); line = line.slice(space + 1); used = line.reduce((sum, char) => sum + advance(char), 0);
        } else { output.push(line.join('')); line = []; used = 0; }
        if (line.length && used + length > width) { output.push(line.join('')); line = []; used = 0; }
      }
      line.push(glyph); used += length;
    }
    output.push(line.join(''));
  }
  const result = output.join('\n'); textLayouts.set(cacheKey, result);
  if (textLayouts.size > 128) textLayouts.delete(textLayouts.keys().next().value!);
  return result;
}
export function splitComicCompositionClip(clip: ComicCompositionClip, atFrame: number, rightId: string): readonly [ComicCompositionClip, ComicCompositionClip] {
  number(atFrame, 'split frame', 1, clip.durationFrames - 1, true); text(rightId, 'split id');
  if (rightId === clip.id) fail('Split requires a distinct right clip id');
  return [trimComicCompositionClip(clip, 0, atFrame), { ...trimComicCompositionClip(clip, atFrame, clip.durationFrames), id: rightId }];
}

function assertUnlocked(previous: ComicComposition, next: ComicComposition): void {
  for (const track of previous.tracks) if (track.locked) {
    const candidate = next.tracks.find(item => item.id === track.id);
    const oldClips = previous.clips.filter(clip => clip.trackId === track.id), nextClips = next.clips.filter(clip => clip.trackId === track.id);
    if (!candidate || JSON.stringify(oldClips) !== JSON.stringify(nextClips))
      fail('Unlock the track before editing its clips or position', 'TRACK_LOCKED');
    // Unlocking is permitted, but cannot smuggle clip changes through the same replace.
    if (track.id !== candidate.id || track.kind !== candidate.kind || track.title !== candidate.title) fail('Unlock the track before editing it', 'TRACK_LOCKED');
  }
}
export function applyComicCompositionOperation(composition: ComicComposition, operation: ComicCompositionOperation, context: ComicCompositionContext): ComicComposition {
  const previous = validateComicComposition(composition, context), op = object(operation, 'composition operation') as unknown as ComicCompositionOperation;
  let tracks = [...previous.tracks], clips = [...previous.clips];
  const clipIndex = (id: string): number => { const i = clips.findIndex(clip => clip.id === id); if (i < 0) fail('Clip does not exist', 'INVALID_REFERENCE'); return i; };
  const trackIndex = (id: string): number => { const i = tracks.findIndex(track => track.id === id); if (i < 0) fail('Track does not exist', 'INVALID_REFERENCE'); return i; };
  switch (op.type) {
    case 'replace': { const next = validateComicComposition(op.composition, context); assertUnlocked(previous, next); return next; }
    case 'track.add': tracks.splice(op.index === undefined ? tracks.length : number(op.index, 'track index', 0, tracks.length, true), 0, op.track); break;
    case 'track.update': { const i = trackIndex(op.trackId); tracks[i] = { ...tracks[i], ...object(op.patch, 'track patch'), id: tracks[i].id, kind: tracks[i].kind }; break; }
    case 'track.move': { const i = trackIndex(op.trackId), destination = number(op.index, 'track index', 0, tracks.length - 1, true); if (tracks[i].locked) fail('Unlock the track before moving it', 'TRACK_LOCKED'); tracks.splice(destination, 0, tracks.splice(i, 1)[0]); break; }
    case 'track.remove': { trackIndex(op.trackId); tracks = tracks.filter(track => track.id !== op.trackId); clips = clips.filter(clip => clip.trackId !== op.trackId); break; }
    case 'clip.add': clips.push(op.clip); break;
    case 'clip.update': { const i = clipIndex(op.clipId); clips[i] = { ...clips[i], ...object(op.patch, 'clip patch'), id: clips[i].id, trackId: clips[i].trackId, kind: clips[i].kind }; break; }
    case 'clip.move': { const i = clipIndex(op.clipId); clips[i] = { ...clips[i], from: op.from, ...(op.trackId === undefined ? {} : { trackId: op.trackId }) }; break; }
    case 'clip.remove': clips.splice(clipIndex(op.clipId), 1); break;
    case 'clip.split': { const i = clipIndex(op.clipId); clips.splice(i, 1, ...splitComicCompositionClip(clips[i], op.atFrame, op.rightId)); break; }
    case 'clip.duplicate': { const c = clips[clipIndex(op.clipId)]; clips.push({ ...structuredClone(c), id: op.id, from: op.from ?? c.from + c.durationFrames, trackId: op.trackId ?? c.trackId }); break; }
    case 'clip.trim': { const i = clipIndex(op.clipId); clips[i] = resizeComicCompositionClip(clips[i], op.startFrame, op.endFrame); break; }
    case 'keyframe.set': { const i = clipIndex(op.clipId), key = op.keyframe; object(key, 'keyframe'); clips[i] = { ...clips[i], keyframes: [...(clips[i].keyframes ?? []).filter(old => old.property !== key.property || old.frame !== key.frame), key] }; break; }
    case 'keyframe.remove': { const i = clipIndex(op.clipId); clips[i] = { ...clips[i], keyframes: (clips[i].keyframes ?? []).filter(key => key.property !== op.property || key.frame !== op.frame) }; break; }
    default: fail('Unknown composition operation', 'INVALID_COMMAND');
  }
  const next = validateComicComposition({ schemaVersion: 1, tracks, clips }, context); assertUnlocked(previous, next); return next;
}

function legacyImageKeyframes(motion: string, duration: number, canvas: ComicCanvas): readonly ComicCompositionKeyframe[] | undefined {
  const end = Math.max(1, duration - 1);
  const pair = (property: ComicCompositionProperty, a: number, b: number): ComicCompositionKeyframe[] =>
    [{ property, frame: 0, value: a, easing: 'linear' }, { property, frame: end, value: b, easing: 'linear' }];
  switch (motion) {
    case 'push_in': return pair('scale', 1, 1.12);
    case 'pull_out': return pair('scale', 1.12, 1);
    case 'pan_left': return [...pair('scale', 1.12, 1.12), ...pair('x', -canvas.width * .06, canvas.width * .06)];
    case 'pan_right': return [...pair('scale', 1.12, 1.12), ...pair('x', canvas.width * .06, -canvas.width * .06)];
    case 'tilt_up': return [...pair('scale', 1.12, 1.12), ...pair('y', -canvas.height * .06, canvas.height * .06)];
    case 'tilt_down': return [...pair('scale', 1.12, 1.12), ...pair('y', canvas.height * .06, -canvas.height * .06)];
    default: return undefined;
  }
}
/** Read-only, deterministic migration. No source storyboard, file or revision is changed. */
export function resolveComicComposition(project: ComicProject): ComicComposition {
  if (project.composition) return project.composition;
  const tracks: ComicCompositionTrack[] = [
    { id: 'legacy-picture', title: 'Video', kind: 'video' },
    { id: 'legacy-voice', title: 'Voice', kind: 'audio' },
    { id: 'legacy-music', title: 'Music', kind: 'audio' },
    { id: 'legacy-effect', title: 'Effects', kind: 'audio' },
    { id: 'legacy-subtitle', title: 'Subtitles', kind: 'text' },
  ];
  const clips: ComicCompositionClip[] = [], assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const ordered = project.scenes.flatMap(scene => scene.shots.map(shot => ({ scene, shot })));
  const episodeOf = (scene: ComicProject['scenes'][number]): number => scene.episodeNumber ?? 1;
  const transitions = ordered.map(({ scene, shot }, index) => ({ shotId: shot.id, durationFrames: shot.durationFrames,
    episodeNumber: episodeOf(scene),
    ...resolveComicShotTransitions(shot, { firstInEpisode: index === 0 || episodeOf(ordered[index - 1].scene) !== episodeOf(scene),
      lastInEpisode: index === ordered.length - 1 || episodeOf(ordered[index + 1].scene) !== episodeOf(scene),
      acrossScenes: index > 0 && ordered[index - 1].scene.id !== scene.id }) }));
  const overlaps = new Map<string, number>();
  for (const episodeNumber of new Set(transitions.map(t => t.episodeNumber))) {
    for (const [id, frames] of getComicDissolveOverlaps(transitions.filter(t => t.episodeNumber === episodeNumber), project.frameRate)) {
      overlaps.set(id, frames);
    }
  }
  let cursor = 0;
  for (let index = 0; index < ordered.length; index++) {
    const { shot } = ordered[index], incoming = overlaps.get(shot.id) ?? 0;
    const outgoing = index + 1 < ordered.length ? overlaps.get(ordered[index + 1].shot.id) ?? 0 : 0;
    cursor -= incoming;
    const fades = resolveComicShotFades({ ...shot, ...transitions[index] }, project.frameRate);
    const envelope: ComicCompositionEnvelope = { durationFrames: shot.durationFrames, offsetFrames: 0, ...fades,
      audioFadeInFrames: fades.fadeInFrames, audioFadeOutFrames: fades.fadeOutFrames, dissolveInFrames: incoming, dissolveOutFrames: outgoing };
    const video = shot.videoAssetId && assets.get(shot.videoAssetId), image = shot.visualAssetId && assets.get(shot.visualAssetId);
    // A linked but missing video remains a missing video, never silently replaced by an older still.
    const visual = video || image, kind = video ? 'video' : image ? 'image' : 'empty';
    const pictureId = `legacy-${shot.id}-picture`, keyframes = kind === 'image' ? legacyImageKeyframes(shot.cameraMotion, shot.durationFrames, project.canvas) : undefined;
    clips.push({ id: pictureId, trackId: 'legacy-picture', kind, title: shot.title, legacyShotId: shot.id, legacyFadeToBlack: true,
      from: cursor, durationFrames: shot.durationFrames, sourceStartFrames: visual && kind === 'video' ? shot.mediaSourceStartFrames?.[visual.id] ?? 0 : 0,
      ...(visual ? { assetId: visual.id } : { missing: true }), fit: shot.mediaFit ?? 'contain', volume: shot.volume,
      nativeAudio: !shot.audioAssetId, envelope, ...(keyframes ? { keyframes } : {}) });
    const audio = [
      ...(shot.audioAssetId ? [{ id: shot.audioAssetId, trackId: 'legacy-voice' }] : []),
      ...(shot.musicAssetIds ?? []).map(id => ({ id, trackId: 'legacy-music' })),
      ...(shot.effectAssetIds ?? []).map(id => ({ id, trackId: 'legacy-effect' })),
    ];
    for (const [audioIndex, media] of audio.entries()) {
      const durationFrames = getComicMediaDurationFrames(project, shot, media.id);
      if (durationFrames <= 0) continue;
      clips.push({ id: `legacy-${shot.id}-audio-${audioIndex}`, trackId: media.trackId, kind: 'audio', title: assets.get(media.id)?.model ?? shot.title,
        legacyShotId: shot.id, assetId: media.id, from: cursor, durationFrames, sourceStartFrames: shot.mediaSourceStartFrames?.[media.id] ?? 0,
        volume: shot.volume, envelope });
    }
    const short = Math.min(project.canvas.width, project.canvas.height);
    const textStyle: ComicCompositionTextStyle = { fontSize: Math.max(12, short * .04), color: '#ffffff', align: 'center' };
    const transform: ComicCompositionTransform = { y: project.canvas.height / 2 - short * .065 };
    for (const cue of shot.dialogueCues) clips.push({ id: `legacy-${shot.id}-${cue.id}`, trackId: 'legacy-subtitle', kind: 'text', purpose: 'subtitle',
      captionSourceClipId: pictureId, legacyShotId: shot.id, text: cue.text, textStyle, transform,
      from: cursor + cue.startFrame, durationFrames: cue.durationFrames, sourceStartFrames: 0 });
    if (shot.subtitleAssetId) clips.push({ id: `legacy-${shot.id}-subtitle`, trackId: 'legacy-subtitle', kind: 'text', purpose: 'subtitle',
      captionSourceClipId: pictureId, legacyShotId: shot.id, assetId: shot.subtitleAssetId, textStyle, transform,
      from: cursor, durationFrames: getComicMediaDurationFrames(project, shot, shot.subtitleAssetId), sourceStartFrames: shot.mediaSourceStartFrames?.[shot.subtitleAssetId] ?? 0 });
    else if (video && !shot.dialogueCues.length) clips.push({ id: `legacy-${shot.id}-embedded-subtitle`, trackId: 'legacy-subtitle', kind: 'text', purpose: 'subtitle',
      captionSourceClipId: pictureId, legacyShotId: shot.id, assetId: video.id, textStyle, transform,
      from: cursor, durationFrames: shot.durationFrames, sourceStartFrames: shot.mediaSourceStartFrames?.[video.id] ?? 0 });
    cursor += shot.durationFrames;
  }
  const usedTracks = new Set(clips.map(clip => clip.trackId));
  return { schemaVersion: 1, tracks: clips.length ? tracks.filter(track => usedTracks.has(track.id)) : [tracks[0]], clips };
}
