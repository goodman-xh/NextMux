/** Portable director scene. Positions use metres, rotations and joint values use degrees,
 * and timeline positions use integer frames. This module has no renderer dependency. */
export const SCENE_SCHEMA_VERSION = 2 as const;
export type SceneObjectKind = "character" | "prop" | "camera" | "light" | "model" | "group";
export interface SceneVector { readonly x: number; readonly y: number; readonly z: number }
export type SceneVector3 = SceneVector;
export type ScenePosture = Readonly<Record<string, Readonly<Record<string, number>>>>;
export type SceneCurve = "linear" | "custom" | "montage" | "hero" | "bullet" | "cut" | "easeIn" | "easeOut";
export type ScenePlayMode = "once" | "loop" | "pingpong";
export type SceneAspectRatio = "16:9" | "9:16" | "4:3" | "3:4" | "1:1" | "21:9";
export interface SceneTransform {
  readonly position: SceneVector;
  readonly rotation: SceneVector;
  readonly scale: SceneVector;
  /** Column-major affine override, retained when reparenting produces shear. */
  readonly matrix?: readonly number[];
}
export interface SceneObject extends SceneTransform {
  readonly id: string; readonly kind: SceneObjectKind; readonly label: string;
  readonly visible: boolean; readonly locked: boolean; readonly parentId?: string;
  readonly color?: string; readonly bodyType?: string; readonly pose?: string;
  readonly posture?: ScenePosture; readonly mirror?: boolean;
  readonly assetId?: string; readonly imageUri?: string; readonly modelUri?: string;
  readonly lookAt?: SceneVector; readonly fov?: number;
  readonly lightType?: "point" | "spot" | "directional";
  readonly intensity?: number; readonly distance?: number; readonly angle?: number;
  readonly castShadow?: boolean;
}
export interface SceneKeyframe extends SceneTransform {
  readonly id: string; readonly objectId: string; readonly frame: number;
  readonly lookAt?: SceneVector; readonly fov?: number; readonly posture?: ScenePosture;
}
export interface SceneDocument {
  readonly schemaVersion: typeof SCENE_SCHEMA_VERSION;
  readonly objects: readonly SceneObject[]; readonly keys: readonly SceneKeyframe[];
  readonly duration: number; readonly fps: number; readonly playMode: ScenePlayMode;
  readonly curve: SceneCurve; readonly customCurve: number; readonly aspectRatio: SceneAspectRatio;
  readonly skyColor: string; readonly panoramaUri?: string;
  readonly groundHeight: number; readonly groundOpacity: number; readonly showGrid: boolean;
  readonly showLabels: boolean; readonly labelFontSize: number; readonly showBaseMarker: boolean;
}
export interface WorldDocument {
  readonly schemaVersion: 1; readonly kind: "empty" | "panorama" | "model" | "splat";
  readonly uri?: string; readonly format?: "glb" | "gltf" | "spz" | "ply";
  readonly scene?: SceneDocument;
  readonly camera: { readonly position: SceneVector; readonly lookAt: SceneVector; readonly fov: number };
  readonly aspectRatio: SceneAspectRatio;
}
export interface SceneValidationIssue { readonly code: string; readonly path: string; readonly message: string }
export class SceneError extends Error {
  readonly code: string; readonly issues: readonly SceneValidationIssue[];
  constructor(code: string, message: string, issues: readonly SceneValidationIssue[] = []) {
    super(message); this.name = "SceneError"; this.code = code; this.issues = issues;
  }
}
export const SCENE_CURVES: readonly SceneCurve[] = ["linear", "custom", "montage", "hero", "bullet", "cut", "easeIn", "easeOut"];
export const SCENE_PLAY_MODES: readonly ScenePlayMode[] = ["once", "loop", "pingpong"];
export const SCENE_ASPECT_RATIOS: readonly SceneAspectRatio[] = ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"];
const kinds: readonly SceneObjectKind[] = ["character", "prop", "camera", "light", "model", "group"];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const zero = (): SceneVector => ({ x: 0, y: 0, z: 0 });
const one = (): SceneVector => ({ x: 1, y: 1, z: 1 });

export function createSceneObject(kind: SceneObjectKind, id: string, patch: Partial<SceneObject> = {}): SceneObject {
  return { id, kind, label: kind, position: zero(), rotation: zero(), scale: one(), visible: true, locked: false,
    ...(kind === "character" ? { bodyType: "mannequin", pose: "stand", mirror: false, posture: {} } : {}),
    ...(kind === "camera" ? { lookAt: { x: 0, y: 1.2, z: 0 }, fov: 50 } : {}),
    ...(kind === "light" ? { lightType: "point" as const, intensity: 1, distance: 0, angle: 45, castShadow: true } : {}),
    ...patch };
}
export function createSceneDocument(): SceneDocument {
  return { schemaVersion: 2, objects: [], keys: [], duration: 120, fps: 24, playMode: "once", curve: "linear", customCurve: 1,
    aspectRatio: "16:9", skyColor: "#202838", groundHeight: 0, groundOpacity: 1, showGrid: true, showLabels: true, labelFontSize: 24, showBaseMarker: true };
}

/** Normalization fills omitted defaults; malformed supplied values are rejected, never silently repaired. */
export function normalizeScene(input: unknown): SceneDocument {
  const issues: SceneValidationIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  if (!record(input)) throw new SceneError("INVALID_SCENE", "Scene must be a JSON object");
  if (input.objects === undefined && ["characters", "cameras", "props"].some(k => input[k] !== undefined)) throw new SceneError("TEMPLATE_SCENE", "Use the template converter for characters/cameras/props scene JSON");
  if (input.schemaVersion !== undefined && input.schemaVersion !== 2) add("SCHEMA", "schemaVersion", "Unsupported scene schema");
  const vector = (v: unknown, path: string, fallback: SceneVector): SceneVector => {
    if (v === undefined) return fallback;
    if (!record(v) || !finite(v.x) || !finite(v.y) || !finite(v.z)) { add("VECTOR", path, "Coordinates must be finite numbers"); return fallback; }
    return { x: v.x, y: v.y, z: v.z };
  };
  const number = (v: unknown, path: string, fallback: number, min = -Infinity, max = Infinity, integer = false): number => {
    if (v === undefined) return fallback;
    if (!finite(v) || v < min || v > max || integer && !Number.isInteger(v)) { add("NUMBER", path, "Number is outside the permitted finite range"); return fallback; }
    return v;
  };
  const bool = (v: unknown, path: string, fallback: boolean): boolean => {
    if (v === undefined) return fallback;
    if (typeof v !== "boolean") { add("BOOLEAN", path, "Expected a boolean"); return fallback; } return v;
  };
  const posture = (v: unknown, path: string): ScenePosture | undefined => {
    if (v === undefined) return undefined;
    if (!record(v)) { add("POSTURE", path, "Posture must contain joint objects"); return undefined; }
    const out: Record<string, Record<string, number>> = {};
    for (const [joint, axes] of Object.entries(v)) {
      if (!record(axes)) { add("POSTURE", `${path}.${joint}`, "Joint must contain numeric angles"); continue; }
      out[joint] = {};
      for (const [axis, value] of Object.entries(axes)) {
        if (!finite(value)) add("POSTURE", `${path}.${joint}.${axis}`, "Joint angles must be finite");
        else out[joint]![axis] = value;
      }
    } return out;
  };
  const transform = (v: Record<string, unknown>, path: string): SceneTransform => {
    let matrix: readonly number[] | undefined;
    if (v.matrix !== undefined) {
      if (!Array.isArray(v.matrix) || v.matrix.length !== 16 || !v.matrix.every(finite) || v.matrix[3] !== 0 || v.matrix[7] !== 0 || v.matrix[11] !== 0 || v.matrix[15] !== 1) add("MATRIX", `${path}.matrix`, "Matrix must be a finite column-major affine matrix");
      else matrix = [...v.matrix];
    }
    return { position: vector(v.position, `${path}.position`, zero()), rotation: vector(v.rotation, `${path}.rotation`, zero()), scale: vector(v.scale, `${path}.scale`, one()), ...(matrix ? { matrix } : {}) };
  };
  const uri = (v: unknown, path: string, localModel = false): string | undefined => {
    if (v === undefined || v === "") return undefined;
    if (!nonempty(v) || /^(?:blob|data):/i.test(v.trim()) || localModel && !isProjectMediaUri(v)) { add("MEDIA_URI", path, "Persistent media must use a durable URI; models must be project-relative"); return undefined; } return v;
  };
  const objects: SceneObject[] = [], ids = new Set<string>();
  if (input.objects !== undefined && !Array.isArray(input.objects)) add("OBJECTS", "objects", "Objects must be an array");
  for (const [i, v] of (Array.isArray(input.objects) ? input.objects : []).entries()) {
    const p = `objects.${i}`;
    if (!record(v)) { add("OBJECT", p, "Scene object must be an object"); continue; }
    if (!nonempty(v.id) || ids.has(String(v.id))) { add("OBJECT_ID", `${p}.id`, "Object ids must be nonempty and unique"); continue; }
    ids.add(v.id);
    if (!kinds.includes(v.kind as SceneObjectKind)) { add("OBJECT_KIND", `${p}.kind`, "Unknown scene object kind"); continue; }
    if (v.label !== undefined && typeof v.label !== "string") add("LABEL", `${p}.label`, "Label must be a string");
    const out: Record<string, unknown> = { ...createSceneObject(v.kind as SceneObjectKind, v.id), ...transform(v, p), label: typeof v.label === "string" ? v.label : String(v.kind), visible: bool(v.visible, `${p}.visible`, true), locked: bool(v.locked, `${p}.locked`, false) };
    for (const k of ["parentId", "bodyType", "pose", "assetId"]) if (v[k] !== undefined) {
      if (!nonempty(v[k])) add("STRING", `${p}.${k}`, "Expected a nonempty identifier"); else out[k] = v[k];
    }
    if (v.color !== undefined) {
      if (typeof v.color !== "string" || !/^#[\da-f]{6}$/i.test(v.color)) add("COLOR", `${p}.color`, "Color must use six hexadecimal digits"); else out.color = v.color;
    }
    if (v.lookAt !== undefined) out.lookAt = vector(v.lookAt, `${p}.lookAt`, zero());
    if (v.fov !== undefined) out.fov = number(v.fov, `${p}.fov`, 50, 10, 120);
    if (v.posture !== undefined) out.posture = posture(v.posture, `${p}.posture`);
    if (v.mirror !== undefined) out.mirror = bool(v.mirror, `${p}.mirror`, false);
    for (const k of ["imageUri", "modelUri"] as const) { const u = uri(v[k] ?? v[k === "imageUri" ? "imageUrl" : "modelUrl"], `${p}.${k}`, k === "modelUri"); if (u) out[k] = u; }
    if (v.modelDataUrl !== undefined) add("MEDIA_URI", `${p}.modelDataUrl`, "Import the model into project media before saving its scene URI");
    if (v.lightType !== undefined) { if (!["point", "spot", "directional"].includes(String(v.lightType))) add("LIGHT_TYPE", `${p}.lightType`, "Unknown light type"); else out.lightType = v.lightType; }
    for (const [k, max] of [["intensity", 100000], ["distance", 100000], ["angle", 90]] as const) if (v[k] !== undefined) out[k] = number(v[k], `${p}.${k}`, k === "angle" ? 45 : 0, 0, max);
    if (v.castShadow !== undefined) out.castShadow = bool(v.castShadow, `${p}.castShadow`, true);
    objects.push(out as unknown as SceneObject);
  }
  const byId = new Map(objects.map(o => [o.id, o]));
  for (const o of objects) {
    if (o.parentId && byId.get(o.parentId)?.kind !== "group") add("PARENT", `objects.${o.id}.parentId`, "Parent must identify an existing group");
    const seen = new Set([o.id]); let p = o.parentId;
    while (p && byId.has(p)) { if (seen.has(p)) { add("PARENT_CYCLE", `objects.${o.id}.parentId`, "Parent graph must be acyclic"); break; } seen.add(p); p = byId.get(p)!.parentId; }
  }
  const base = createSceneDocument();
  if (input.fps !== undefined && !finite(input.fps)) add("NUMBER", "fps", "Frame rate must be a finite number");
  const duration = number(input.duration, "duration", base.duration, 1, 18000, true);
  const keys: SceneKeyframe[] = [], keyIds = new Set<string>(), slots = new Set<string>();
  if (input.keys !== undefined && !Array.isArray(input.keys)) add("KEYS", "keys", "Keys must be an array");
  for (const [i, v] of (Array.isArray(input.keys) ? input.keys : []).entries()) {
    const p = `keys.${i}`;
    if (!record(v) || !nonempty(v.id) || keyIds.has(String(v.id)) || !nonempty(v.objectId) || !byId.has(String(v.objectId))) { add("KEY", p, "Keyframes need unique ids and an existing object"); continue; }
    const frame = number(v.frame, `${p}.frame`, 0, 0, duration, true), slot = `${v.objectId}:${frame}`;
    if (slots.has(slot)) add("KEY_SLOT", p, "An object can have one keyframe per frame");
    keyIds.add(v.id); slots.add(slot);
    keys.push({ id: v.id, objectId: v.objectId, frame, ...transform(v, p), ...(v.lookAt !== undefined ? { lookAt: vector(v.lookAt, `${p}.lookAt`, zero()) } : {}), ...(v.fov !== undefined ? { fov: number(v.fov, `${p}.fov`, 50, 10, 120) } : {}), ...(v.posture !== undefined ? { posture: posture(v.posture, `${p}.posture`) } : {}) });
  }
  const choice = <T extends string>(v: unknown, values: readonly T[], fallback: T, path: string): T => {
    if (v === undefined) return fallback;
    if (!values.includes(v as T)) { add("CHOICE", path, "Unknown setting value"); return fallback; } return v as T;
  };
  if (input.skyColor !== undefined && (typeof input.skyColor !== "string" || !/^#[\da-f]{6}$/i.test(input.skyColor))) add("COLOR", "skyColor", "Sky color must use six hexadecimal digits");
  const panoramaUri = uri(input.panoramaUri ?? input.panoramaUrl, "panoramaUri");
  const out: SceneDocument = { ...base, objects, keys: keys.sort((a, b) => a.frame - b.frame || a.objectId.localeCompare(b.objectId)), duration,
    fps: Number(choice(input.fps === undefined ? undefined : String(input.fps), ["12", "24", "25", "30", "60"], String(base.fps), "fps")),
    playMode: choice(input.playMode, SCENE_PLAY_MODES, base.playMode, "playMode"), curve: choice(input.curve, SCENE_CURVES, base.curve, "curve"), customCurve: number(input.customCurve, "customCurve", 1, 0.1, 5),
    aspectRatio: choice(input.aspectRatio, SCENE_ASPECT_RATIOS, base.aspectRatio, "aspectRatio"), skyColor: typeof input.skyColor === "string" ? input.skyColor : base.skyColor,
    ...(panoramaUri ? { panoramaUri } : {}), groundHeight: number(input.groundHeight, "groundHeight", 0), groundOpacity: number(input.groundOpacity, "groundOpacity", 1, 0, 1),
    showGrid: bool(input.showGrid, "showGrid", true), showLabels: bool(input.showLabels, "showLabels", true), labelFontSize: number(input.labelFontSize, "labelFontSize", 24, 8, 128), showBaseMarker: bool(input.showBaseMarker, "showBaseMarker", true) };
  if (issues.length) throw new SceneError("INVALID_SCENE", "Scene validation failed", issues);
  return out;
}
export function validateScene(input: unknown): readonly SceneValidationIssue[] {
  try { normalizeScene(input); return []; } catch (e) { return e instanceof SceneError ? e.issues.length ? e.issues : [{ code: e.code, path: "", message: e.message }] : [{ code: "INVALID_SCENE", path: "", message: "Invalid scene" }]; }
}
export function isProjectMediaUri(uri: string): boolean {
  if (!uri || /[\\\u0000-\u001f?#]/.test(uri) || uri.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(uri)) return false;
  try { const decoded = decodeURIComponent(uri); return !/[\\\u0000-\u001f?#]/.test(decoded) && !decoded.split("/").some(s => s === ".." || s === "." || s === "") && !/^[a-z][a-z\d+.-]*:/i.test(decoded); } catch { return false; }
}
export function normalizeWorld(input: unknown): WorldDocument {
  if (!record(input) || input.schemaVersion !== undefined && input.schemaVersion !== 1) throw new SceneError("INVALID_WORLD", "World must use schema 1");
  if (input.camera !== undefined && !record(input.camera)) throw new SceneError("INVALID_WORLD", "World camera must be an object");
  const camera = record(input.camera) ? input.camera : {};
  const checked = normalizeScene({ objects: [createSceneObject("camera", "world-camera", { position: camera.position as SceneVector | undefined ?? { x: 0, y: 1.6, z: 5 }, lookAt: camera.lookAt as SceneVector | undefined ?? { x: 0, y: 1.2, z: 0 }, fov: camera.fov as number | undefined ?? 50 })], aspectRatio: input.aspectRatio });
  const kind = input.kind ?? "empty";
  if (!["empty", "panorama", "model", "splat"].includes(String(kind))) throw new SceneError("INVALID_WORLD", "Unknown world kind");
  if (kind !== "empty" && (!nonempty(input.uri) || !isProjectMediaUri(input.uri)) || input.uri !== undefined && (!nonempty(input.uri) || !isProjectMediaUri(input.uri))) throw new SceneError("INVALID_WORLD", "World source must identify a project-relative media file");
  if (input.format !== undefined && !["glb", "gltf", "spz", "ply"].includes(String(input.format))) throw new SceneError("INVALID_WORLD", "Unknown world media format");
  if (kind === "model" && input.format !== undefined && !["glb", "gltf"].includes(String(input.format)) || kind === "splat" && input.format !== undefined && !["spz", "ply"].includes(String(input.format))) throw new SceneError("INVALID_WORLD", "World format must match its viewer kind");
  const c = checked.objects[0]!;
  return { schemaVersion: 1, kind: kind as WorldDocument["kind"], ...(kind !== "empty" ? { uri: input.uri as string } : {}), ...(input.format ? { format: input.format as WorldDocument["format"] } : {}), ...(input.scene !== undefined ? { scene: normalizeScene(input.scene) } : {}), camera: { position: c.position, lookAt: c.lookAt!, fov: c.fov! }, aspectRatio: checked.aspectRatio };
}

export interface SceneHistory { readonly past: readonly (readonly SceneObject[])[]; readonly present: readonly SceneObject[]; readonly future: readonly (readonly SceneObject[])[] }
export function createSceneHistory(objects: readonly SceneObject[]): SceneHistory { return { past: [], present: clone(objects), future: [] }; }
export function commitSceneHistory(history: SceneHistory, objects: readonly SceneObject[]): SceneHistory {
  if (JSON.stringify(history.present) === JSON.stringify(objects)) return history;
  return { past: [...history.past, clone(history.present)].slice(-40), present: clone(objects), future: [] };
}
export function undoSceneHistory(history: SceneHistory): SceneHistory {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: clone(history.past[history.past.length - 1]!), future: [clone(history.present), ...history.future].slice(0, 40) };
}
export function redoSceneHistory(history: SceneHistory): SceneHistory {
  if (!history.future.length) return history;
  return { past: [...history.past, clone(history.present)].slice(-40), present: clone(history.future[0]!), future: history.future.slice(1) };
}

export function sceneEase(t: number, curve: SceneCurve, custom = 1): number {
  const n = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  switch (curve) {
    case "custom": return n ** Math.max(0.1, Math.min(5, Number.isFinite(custom) ? custom : 1));
    case "montage": return n === 1 ? 1 : Math.floor(n * 8) / 8;
    case "hero": return n * n * (3 - 2 * n);
    case "bullet": return n < 0.3 ? n * 1.5 : n < 0.7 ? 0.45 + (n - 0.3) * 0.25 : 0.55 + (n - 0.7) * 1.5;
    case "cut": return n < 1 ? 0 : 1;
    case "easeIn": return Math.sqrt(n);
    case "easeOut": return n * n;
    default: return n;
  }
}
export function scenePlaybackFrame(elapsedFrames: number, duration: number, playMode: ScenePlayMode): { readonly frame: number; readonly finished: boolean } {
  const d = Math.max(1, Number.isFinite(duration) ? duration : 1), t = Math.max(0, Number.isFinite(elapsedFrames) ? elapsedFrames : 0);
  if (playMode === "loop") return { frame: t % d, finished: false };
  if (playMode === "pingpong") { const f = t % (2 * d); return { frame: f <= d ? f : 2 * d - f, finished: false }; }
  return { frame: Math.min(t, d), finished: t >= d };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpVector = (a: SceneVector, b: SceneVector, t: number): SceneVector => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
function lerpPosture(a: ScenePosture, b: ScenePosture, t: number): ScenePosture {
  const out: Record<string, Record<string, number>> = {};
  for (const joint of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[joint] = {};
    for (const axis of new Set([...Object.keys(a[joint] ?? {}), ...Object.keys(b[joint] ?? {})])) out[joint]![axis] = lerp(a[joint]?.[axis] ?? 0, b[joint]?.[axis] ?? 0, t);
  } return out;
}
export function sampleScene(scene: SceneDocument, frame: number): readonly SceneObject[] {
  const f = Math.max(0, Math.min(scene.duration, Number.isFinite(frame) ? frame : 0));
  const tracks = new Map<string, SceneKeyframe[]>();
  for (const key of scene.keys) { const track = tracks.get(key.objectId) ?? []; track.push(key); tracks.set(key.objectId, track); }
  for (const track of tracks.values()) track.sort((a, b) => a.frame - b.frame);
  return scene.objects.map(o => {
    const track = tracks.get(o.id); if (!track?.length) return o;
    const a = [...track].reverse().find(k => k.frame <= f) ?? track[0]!, b = track.find(k => k.frame >= f) ?? track[track.length - 1]!;
    const t = sceneEase(a.frame === b.frame ? 0 : (f - a.frame) / (b.frame - a.frame), scene.curve, scene.customCurve);
    const { matrix: _oldMatrix, ...base } = o;
    const result: SceneObject = { ...base, position: lerpVector(a.position, b.position, t), rotation: lerpVector(a.rotation, b.rotation, t), scale: lerpVector(a.scale, b.scale, t),
      ...(a.lookAt || b.lookAt ? { lookAt: lerpVector(a.lookAt ?? o.lookAt ?? zero(), b.lookAt ?? o.lookAt ?? zero(), t) } : {}),
      ...(a.fov !== undefined || b.fov !== undefined ? { fov: lerp(a.fov ?? o.fov ?? 50, b.fov ?? o.fov ?? 50, t) } : {}),
      ...(a.posture || b.posture ? { posture: lerpPosture(a.posture ?? o.posture ?? {}, b.posture ?? o.posture ?? {}, t) } : {}),
      ...(a.matrix || b.matrix ? { matrix: (a.matrix ?? sceneTransformMatrix(a)).map((v, i) => lerp(v, (b.matrix ?? sceneTransformMatrix(b))[i]!, t)) } : {}) };
    return result;
  });
}
export function captureSceneKeyframe(object: SceneObject, frame: number, id: string): SceneKeyframe {
  return clone({ id, objectId: object.id, frame: Math.round(frame), position: object.position, rotation: object.rotation, scale: object.scale,
    ...(object.matrix ? { matrix: object.matrix } : {}), ...(object.lookAt ? { lookAt: object.lookAt } : {}), ...(object.fov !== undefined ? { fov: object.fov } : {}), ...(object.posture ? { posture: object.posture } : {}) });
}
export function setSceneKeyframe(scene: SceneDocument, key: SceneKeyframe): SceneDocument { return normalizeScene({ ...scene, keys: [...scene.keys.filter(k => k.objectId !== key.objectId || k.frame !== key.frame), key] }); }
export function deleteSceneObjects(scene: SceneDocument, objectIds: readonly string[]): SceneDocument {
  const ids = descendants(scene.objects, objectIds);
  return { ...scene, objects: scene.objects.filter(o => !ids.has(o.id)), keys: scene.keys.filter(k => !ids.has(k.objectId)) };
}
function descendants(objects: readonly SceneObject[], rootIds: readonly string[]): Set<string> {
  const ids = new Set(rootIds); let grew = true;
  while (grew) { grew = false; for (const o of objects) if (o.parentId && ids.has(o.parentId) && !ids.has(o.id)) { ids.add(o.id); grew = true; } }
  return ids;
}

export function mirrorScenePosture(posture: ScenePosture): ScenePosture {
  const result: Record<string, Record<string, number>> = {};
  for (const [joint, axes] of Object.entries(posture)) {
    const target = joint.startsWith("l_") ? `r_${joint.slice(2)}` : joint.startsWith("r_") ? `l_${joint.slice(2)}` : joint;
    result[target] = { ...axes };
    if (["body", "torso", "head"].includes(joint)) for (const axis of ["turn", "tilt"]) if (axes[axis] !== undefined) result[target]![axis] = -axes[axis]!;
  } return result;
}

/** Matrix arithmetic uses the same column-major XYZ convention as Three.js. */
export function sceneTransformMatrix(t: SceneTransform): readonly number[] {
  if (t.matrix) return [...t.matrix];
  const x = t.rotation.x * Math.PI / 180, y = t.rotation.y * Math.PI / 180, z = t.rotation.z * Math.PI / 180;
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  return [c * e * t.scale.x, (a * f + b * e * d) * t.scale.x, (b * f - a * e * d) * t.scale.x, 0,
    -c * f * t.scale.y, (a * e - b * f * d) * t.scale.y, (b * e + a * f * d) * t.scale.y, 0,
    d * t.scale.z, -b * c * t.scale.z, a * c * t.scale.z, 0, t.position.x, t.position.y, t.position.z, 1];
}
const identity = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return out;
}
function invert(m: readonly number[]): number[] {
  const rows = Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => c < 4 ? m[c * 4 + r]! : +(c - 4 === r)));
  for (let c = 0; c < 4; c++) {
    let pivot = c; for (let r = c + 1; r < 4; r++) if (Math.abs(rows[r]![c]!) > Math.abs(rows[pivot]![c]!)) pivot = r;
    if (Math.abs(rows[pivot]![c]!) < 1e-12) throw new SceneError("SINGULAR_TRANSFORM", "A zero-scale parent cannot preserve world transforms");
    [rows[c], rows[pivot]] = [rows[pivot]!, rows[c]!]; const d = rows[c]![c]!;
    for (let k = 0; k < 8; k++) rows[c]![k]! /= d;
    for (let r = 0; r < 4; r++) if (r !== c) { const factor = rows[r]![c]!; for (let k = 0; k < 8; k++) rows[r]![k]! -= factor * rows[c]![k]!; }
  } return Array.from({ length: 16 }, (_, i) => rows[i % 4]![4 + Math.floor(i / 4)]!);
}
export function sceneWorldMatrix(objects: readonly SceneObject[], objectId: string): readonly number[] {
  const byId = new Map(objects.map(o => [o.id, o])); const seen = new Set<string>();
  const visit = (id: string): readonly number[] => {
    if (seen.has(id)) throw new SceneError("PARENT_CYCLE", "Parent graph must be acyclic");
    const o = byId.get(id); if (!o) throw new SceneError("OBJECT_MISSING", "Object does not exist");
    seen.add(id); const local = sceneObjectMatrix(o); const result = o.parentId ? multiply(visit(o.parentId), local) : local; seen.delete(id); return result;
  }; return visit(objectId);
}
function sceneObjectMatrix(o: SceneObject): readonly number[] {
  if (o.matrix || o.kind !== "camera" || !o.lookAt) return sceneTransformMatrix(o);
  const normalize = (v: SceneVector): SceneVector => { const length = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / length, y: v.y / length, z: v.z / length }; };
  let z = normalize({ x: o.position.x - o.lookAt.x, y: o.position.y - o.lookAt.y, z: o.position.z - o.lookAt.z });
  if (z.x === 0 && z.y === 0 && z.z === 0) z = { x: 0, y: 0, z: 1 };
  let x = normalize({ x: z.z, y: 0, z: -z.x });
  if (x.x === 0 && x.z === 0) { z = normalize({ ...z, z: z.z + 0.0001 }); x = normalize({ x: z.z, y: 0, z: -z.x }); }
  const y = { x: z.y * x.z - z.z * x.y, y: z.z * x.x - z.x * x.z, z: z.x * x.y - z.y * x.x };
  const basis = [x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, o.position.x, o.position.y, o.position.z, 1];
  return multiply(basis, sceneTransformMatrix({ ...o, position: zero() }));
}
function matrixPoint(matrix: readonly number[], point: SceneVector): SceneVector {
  return { x: matrix[0]! * point.x + matrix[4]! * point.y + matrix[8]! * point.z + matrix[12]!, y: matrix[1]! * point.x + matrix[5]! * point.y + matrix[9]! * point.z + matrix[13]!, z: matrix[2]! * point.x + matrix[6]! * point.y + matrix[10]! * point.z + matrix[14]! };
}
/** Keep camera inspector rotations as offsets from lookAt, rather than duplicating its base orientation. */
function cameraTransform(matrix: readonly number[], lookAt: SceneVector | undefined): SceneTransform {
  const world = decompose(matrix); if (!lookAt) return { ...world, matrix };
  const basis = sceneObjectMatrix(createSceneObject("camera", "basis", { position: world.position, lookAt, rotation: zero(), scale: one() }));
  const { matrix: _offsetMatrix, ...offset } = decompose(multiply(invert(basis), matrix));
  const transform: SceneTransform = { ...offset, position: world.position };
  const reconstructed = sceneObjectMatrix(createSceneObject("camera", "candidate", { ...transform, lookAt }));
  return reconstructed.some((v, i) => Math.abs(v - matrix[i]!) > 1e-8) ? { ...transform, matrix } : transform;
}
/** For ancestor reparenting, multiply the intervening local chain. This also works
 * beneath zero-scale ancestors, whose world matrices cannot be inverted. */
function coordinateFrameMatrix(objects: readonly SceneObject[], sourceId: string | undefined, targetId: string | undefined): readonly number[] {
  if (sourceId === targetId) return identity();
  if (!targetId) return sourceId ? sceneWorldMatrix(objects, sourceId) : identity();
  const byId = new Map(objects.map(o => [o.id, o]));
  let id = sourceId, chain = identity(); const seen = new Set<string>();
  while (id) {
    if (id === targetId) return chain;
    if (seen.has(id)) throw new SceneError("PARENT_CYCLE", "Parent graph must be acyclic");
    seen.add(id); const object = byId.get(id); if (!object) throw new SceneError("OBJECT_MISSING", "Object does not exist");
    chain = multiply(sceneObjectMatrix(object), chain); id = object.parentId;
  }
  return multiply(invert(sceneWorldMatrix(objects, targetId)), sourceId ? sceneWorldMatrix(objects, sourceId) : identity());
}
function decompose(m: readonly number[]): SceneTransform {
  let sx = Math.hypot(m[0]!, m[1]!, m[2]!); const sy = Math.hypot(m[4]!, m[5]!, m[6]!), sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  const det = m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) + m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!);
  if (det < 0) sx = -sx;
  const r13 = sz ? m[8]! / sz : 0, ry = Math.asin(Math.max(-1, Math.min(1, r13)));
  const rx = Math.abs(r13) < 0.9999999 ? Math.atan2(sz ? -m[9]! / sz : 0, sz ? m[10]! / sz : 1) : Math.atan2(sy ? m[6]! / sy : 0, sy ? m[5]! / sy : 1);
  const rz = Math.abs(r13) < 0.9999999 ? Math.atan2(sy ? -m[4]! / sy : 0, sx ? m[0]! / sx : 1) : 0;
  const t: SceneTransform = { position: { x: m[12]!, y: m[13]!, z: m[14]! }, rotation: { x: rx * 180 / Math.PI, y: ry * 180 / Math.PI, z: rz * 180 / Math.PI }, scale: { x: sx, y: sy, z: sz } };
  return sceneTransformMatrix(t).some((v, i) => Math.abs(v - m[i]!) > 1e-8) ? { ...t, matrix: [...m] } : t;
}
function reparent(scene: SceneDocument, objectId: string, parentId: string | undefined): SceneDocument {
  const object = scene.objects.find(o => o.id === objectId); if (!object) throw new SceneError("OBJECT_MISSING", "Object does not exist");
  const frameTransform = coordinateFrameMatrix(scene.objects, object.parentId, parentId);
  const { parentId: _oldParent, matrix: _oldMatrix, ...base } = object;
  const local = multiply(frameTransform, sceneObjectMatrix(object));
  const lookAt = object.lookAt ? matrixPoint(frameTransform, object.lookAt) : undefined;
  const replacement: SceneObject = { ...base, ...(object.kind === "camera" ? cameraTransform(local, lookAt) : decompose(local)), ...(lookAt ? { lookAt } : {}), ...(parentId ? { parentId } : {}) };
  const keys = scene.keys.map(k => {
    if (k.objectId !== objectId) return k;
    const sampled = sampleScene(scene, k.frame), keyFrameTransform = coordinateFrameMatrix(sampled, object.parentId, parentId);
    const { matrix: _keyMatrix, ...keyBase } = k;
    const localKey = multiply(keyFrameTransform, sceneObjectMatrix(sampled.find(o => o.id === objectId)!));
    const keyLookAt = k.lookAt ? matrixPoint(keyFrameTransform, k.lookAt) : undefined;
    return { ...keyBase, ...(object.kind === "camera" ? cameraTransform(localKey, keyLookAt) : decompose(localKey)), ...(keyLookAt ? { lookAt: keyLookAt } : {}) };
  });
  return { ...scene, objects: scene.objects.map(o => o.id === objectId ? replacement : o), keys };
}
export function groupSceneObjects(scene: SceneDocument, objectIds: readonly string[], groupId: string, label = "group"): SceneDocument {
  if (scene.objects.some(o => o.id === groupId)) throw new SceneError("OBJECT_ID", "Group id must be unique");
  const selected = new Set(objectIds), roots = scene.objects.filter(o => selected.has(o.id) && !hasSelectedAncestor(scene.objects, o, selected));
  if (!roots.length) return scene;
  const positions = roots.map(o => sceneWorldMatrix(scene.objects, o.id));
  const center = { x: positions.reduce((n, m) => n + m[12]!, 0) / roots.length, y: positions.reduce((n, m) => n + m[13]!, 0) / roots.length, z: positions.reduce((n, m) => n + m[14]!, 0) / roots.length };
  let result: SceneDocument = { ...scene, objects: [...scene.objects, createSceneObject("group", groupId, { label, position: center })] };
  for (const o of roots) result = reparent(result, o.id, groupId);
  return normalizeScene(result);
}
function hasSelectedAncestor(objects: readonly SceneObject[], object: SceneObject, selected: Set<string>): boolean {
  const byId = new Map(objects.map(o => [o.id, o])); let p = object.parentId;
  while (p) { if (selected.has(p)) return true; p = byId.get(p)?.parentId; } return false;
}
export function ungroupSceneObjects(scene: SceneDocument, objectIds: readonly string[]): SceneDocument {
  let result = scene;
  for (const id of objectIds) {
    const o = result.objects.find(item => item.id === id); if (!o) continue;
    if (o.kind === "group") {
      for (const child of result.objects.filter(item => item.parentId === id)) result = reparent(result, child.id, o.parentId);
      result = deleteSceneObjects(result, [id]);
    } else if (o.parentId) result = reparent(result, id, undefined);
  } return normalizeScene(result);
}
export function copySceneObjects(scene: SceneDocument, objectIds: readonly string[], makeId: (oldId: string) => string, offset = 0.6): { readonly scene: SceneDocument; readonly objectIds: readonly string[] } {
  const ids = descendants(scene.objects, objectIds), mapping = new Map<string, string>();
  for (const id of ids) if (scene.objects.some(o => o.id === id)) mapping.set(id, makeId(id));
  if (new Set(mapping.values()).size !== mapping.size || [...mapping.values()].some(id => scene.objects.some(o => o.id === id))) throw new SceneError("OBJECT_ID", "Copied ids must be unique");
  const copied = scene.objects.filter(o => mapping.has(o.id)).map(o => {
    const root = !o.parentId || !mapping.has(o.parentId); const p = root ? { ...o.position, x: o.position.x + offset } : o.position;
    const matrix = o.matrix ? o.matrix.map((v, i) => root && i === 12 ? v + offset : v) : undefined;
    return clone({ ...o, id: mapping.get(o.id)!, position: p, ...(o.lookAt && root ? { lookAt: { ...o.lookAt, x: o.lookAt.x + offset } } : {}), ...(o.parentId ? { parentId: mapping.get(o.parentId) ?? o.parentId } : {}), ...(matrix ? { matrix } : {}) });
  });
  const keys = scene.keys.filter(k => mapping.has(k.objectId)).map(k => {
    const o = scene.objects.find(item => item.id === k.objectId)!; const root = !o.parentId || !mapping.has(o.parentId);
    return clone({ ...k, id: makeId(k.id), objectId: mapping.get(k.objectId)!, position: root ? { ...k.position, x: k.position.x + offset } : k.position, ...(k.lookAt && root ? { lookAt: { ...k.lookAt, x: k.lookAt.x + offset } } : {}), ...(k.matrix ? { matrix: k.matrix.map((v, i) => root && i === 12 ? v + offset : v) } : {}) });
  });
  return { scene: normalizeScene({ ...scene, objects: [...scene.objects, ...copied], keys: [...scene.keys, ...keys] }), objectIds: objectIds.map(id => mapping.get(id)).filter((id): id is string => !!id) };
}
