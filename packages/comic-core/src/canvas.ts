import { isCompactCanvasCapabilityVersion, sameCanvasCapabilityVersion } from "./canvas-capabilities.js";
import { normalizeScene, normalizeWorld, validateScene } from "./director-scene.js";
import type { SceneDocument, SceneVector3, WorldDocument } from "./director-scene.js";
import { assertCanvasContinuityInputs, isCanvasShotContinuity, type CanvasShotContinuity } from "./canvas-continuity.js";
import { validateCanvasSequenceLinks, type CanvasSequenceLink } from "./canvas-sequence.js";
/** Plain JSON canvas contract. Asset lengths and timeline positions use milliseconds. */
export const CANVAS_SCHEMA_VERSION = 1 as const;
export const CANVAS_FILE = "nextmux.canvas.json";
export type CanvasGenerationMode = "textToImage" | "imageToImage" | "textToVideo" | "imageToVideo" | "firstLastFrame" | "referenceToVideo" | "videoEdit" | "videoExtend";
export type CanvasInputRole = "prompt" | "firstFrame" | "lastFrame" | "referenceImage" | "referenceVideo" | "referenceAudio" | "compositionVideo" | "compositionAudio" | "character";
export type CanvasMediaKind = "image" | "video" | "audio";
export type CanvasNodeKind = "text" | CanvasMediaKind | "imageGen" | "videoGen" | "frameExtract" | "composition" | "group" | "character" | "sceneComposer" | "world";
export const PIN_COLORS = ["red", "orange", "yellow", "lime", "green", "teal", "cyan", "blue", "indigo", "purple", "pink", "grey"] as const;
export type PinColor = typeof PIN_COLORS[number];
export interface CanvasPoint { readonly x: number; readonly y: number }
export interface CanvasSize { readonly width: number; readonly height: number }
export interface CanvasMediaMetadata {
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly sha256?: string;
  readonly frameRate?: number;
  readonly hasAudio?: boolean;
  readonly streamStartMs?: number;
}
export interface CanvasAssetProvenance {
    readonly sourceVersionId?: string;
    readonly sourceNodeId?: string;
    /** Locally extracted direct frames retain the exact source asset; backend proof is authoritative. */
    readonly sourceAssetId?: string;
    readonly sourceUri?: string;
    readonly sourceSha256?: string;
  readonly actualTimeMs?: number;
  readonly frameSelection?: CanvasFrameSelection;
  readonly jobId?: string;
  readonly taskId?: string;
  readonly operation?: string;
  readonly directorCapture?: {
    readonly captureId: string; readonly scene: SceneDocument; readonly world?: WorldDocument;
    readonly camera: { readonly id?: string; readonly position: SceneVector3; readonly rotation: SceneVector3; readonly lookAt?: SceneVector3; readonly fov: number };
    readonly frame: number; readonly endFrame?: number;
    readonly sceneSha256: string; readonly dataSha256: string; readonly requestSha256?: string;
  };
  /** 标记修图: the source picture with the user's visible marks, rendered on the user's machine. */
  readonly annotation?: { readonly markId: string; readonly dataSha256: string; readonly requestSha256: string };
}
export interface CanvasAssetVersion {
  readonly id: string;
  readonly assetId: string;
  readonly kind: CanvasMediaKind;
  readonly uri: string;
  readonly createdAt: string;
  readonly metadata?: CanvasMediaMetadata;
  readonly snapshot?: GenerationSnapshot;
  readonly provenance?: CanvasAssetProvenance;
  readonly status?: "ready" | "uploading" | "missing";
}
export interface CanvasDirectInput {
  readonly id: string;
  readonly role: CanvasInputRole;
  readonly order: number;
  readonly version: CanvasAssetVersion;
}
export interface CanvasResultPayload {
  readonly versions: readonly CanvasAssetVersion[];
  readonly currentVersionId?: string;
  readonly inputs?: readonly CanvasDirectInput[];
}
/** Records an editor capability decision; the final adapter-normalized values live in snapshot.parameters. */
export interface CanvasGenerationOptionDecision {
  readonly schemaVersion: 1;
  readonly modelId: string;
  readonly capabilityVersion: string;
  readonly requested: { readonly mode: CanvasGenerationMode; readonly parameters: Readonly<Record<string, unknown>> };
  readonly effective: { readonly mode: CanvasGenerationMode; readonly parameters: Readonly<Record<string, unknown>> };
  readonly adjustments: readonly { readonly code: 'MODE_RESET' | 'PARAMETER_RESET'; readonly path: string }[];
}
export interface CanvasGenerationPayload extends CanvasResultPayload {
  readonly continuity?: CanvasShotContinuity;
  readonly mode: CanvasGenerationMode;
  readonly modelId: string;
  readonly prompt: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly optionDecision?: CanvasGenerationOptionDecision;
  readonly job?: { readonly id: string; readonly status: string; readonly error?: string; readonly idempotencyKey?: string; readonly taskId?: string };
  readonly jobs?: readonly CanvasGenerationJob[];
}
export interface CanvasGenerationJob {
  readonly idempotencyKey: string;
  readonly jobId?: string;
  readonly snapshot: GenerationSnapshot;
  readonly status: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly createdAt: string;
  readonly updatedAt: string;
}
export type CanvasFrameSelection = { readonly kind: "first" | "last" } | { readonly kind: "time"; readonly timeMs: number };
export interface CanvasCompositionClip {
  readonly id: string;
  readonly assetVersionId: string;
  readonly trackId: string;
  readonly startMs: number;
  readonly inMs: number;
  readonly outMs: number;
  readonly volume: number;
  readonly muted: boolean;
}
export interface CanvasNodeBase {
  readonly id: string;
  readonly title: string;
  readonly position: CanvasPoint;
  readonly size: CanvasSize;
  readonly createdAt?: string;
  readonly pinnedColors?: readonly PinColor[];
  /** Provenance is independent of display labels, and survives a re-adaptation. */
  readonly origin?: { readonly sceneId?: string; readonly shotId?: string; readonly characterId?: string; readonly role?: string };
  readonly orphaned?: boolean;
}
type CanvasNodeOf<K extends CanvasNodeKind, P> = CanvasNodeBase & { readonly kind: K; readonly payload: P };
export type CanvasTextNode = CanvasNodeOf<"text", { readonly text: string }>;
export type CanvasAssetNode = CanvasNodeOf<CanvasMediaKind, CanvasResultPayload>;
export type CanvasImageGenNode = CanvasNodeOf<"imageGen", CanvasGenerationPayload & { readonly mode: "textToImage" | "imageToImage" }>;
export type CanvasVideoGenNode = CanvasNodeOf<"videoGen", CanvasGenerationPayload & { readonly mode: Exclude<CanvasGenerationMode, "textToImage" | "imageToImage"> }>;
export type CanvasFrameExtractNode = CanvasNodeOf<"frameExtract", CanvasResultPayload & { readonly selection: CanvasFrameSelection }>;
export type CanvasCompositionNode = CanvasNodeOf<"composition", CanvasResultPayload & { readonly clips: readonly CanvasCompositionClip[]; readonly parameters: Readonly<Record<string, unknown>> }>;
export type CanvasGroupNode = CanvasNodeOf<"group", { readonly groupId: string }>;
export type CanvasCharacterNode = CanvasNodeOf<"character", CanvasResultPayload & { readonly characterId: string; readonly description?: string; readonly appearance?: string }>;
export type CanvasSceneComposerNode = CanvasNodeOf<"sceneComposer", CanvasResultPayload & { readonly scene: SceneDocument }>;
export type CanvasWorldNode = CanvasNodeOf<"world", CanvasResultPayload & { readonly world: WorldDocument }>;
export type CanvasNode = CanvasTextNode | CanvasAssetNode | CanvasImageGenNode | CanvasVideoGenNode | CanvasFrameExtractNode | CanvasCompositionNode | CanvasGroupNode | CanvasCharacterNode | CanvasSceneComposerNode | CanvasWorldNode;
export interface CanvasEdge {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly sourcePort: string;
  readonly targetNodeId: string;
  readonly targetPort: string;
  readonly role: CanvasInputRole;
  readonly order: number;
  readonly binding: "followCurrent" | "pinnedVersion";
  readonly pinnedVersionId?: string;
}
/** Members are ordered; positions always stay in world coordinates, including nested groups. */
export interface CanvasGroup {
  readonly id: string;
  readonly title: string;
  readonly nodeIds: readonly string[];
  readonly parentGroupId?: string;
}
export interface CanvasDocument {
  readonly schemaVersion: typeof CANVAS_SCHEMA_VERSION;
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly viewport: CanvasPoint & { readonly zoom: number };
  readonly settings: Readonly<Record<string, unknown>>;
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  /** Playback ordering, independent of model input dependencies; absent in legacy canvases. */
  readonly sequenceLinks?: readonly CanvasSequenceLink[];
  readonly groups: readonly CanvasGroup[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface ResolvedCanvasInput {
  readonly role: CanvasInputRole;
  readonly order: number;
  readonly sourceNodeId?: string;
  readonly edgeId?: string;
  readonly inputId?: string;
  readonly versionId: string;
  readonly assetId: string;
  readonly kind: CanvasMediaKind | "text" | "character";
  readonly uri: string;
  readonly metadata?: CanvasMediaMetadata;
  readonly characterId?: string;
  readonly text?: string;
}
export type CanvasMissingInputReason = "sourceMissing" | "noResult" | "noCurrentVersion" | "versionMissing" | "uploading" | "missingFile" | "incompatibleType" | "requiredInput";
export interface CanvasMissingInput {
  readonly role: CanvasInputRole;
  readonly reason: CanvasMissingInputReason;
  readonly sourceNodeId?: string;
  readonly edgeId?: string;
  readonly inputId?: string;
  readonly versionId?: string;
}
export interface CanvasInputResolution {
  readonly inputs: readonly ResolvedCanvasInput[];
  readonly missing: readonly CanvasMissingInput[];
  readonly prompt: string;
  readonly inputFingerprint: string;
}
export interface GenerationSnapshot {
  readonly continuity?: CanvasShotContinuity;
  readonly modelId: string;
  readonly capabilityVersion: string;
  readonly mode: CanvasGenerationMode;
  readonly prompt: string;
  readonly resolvedInputs: readonly ResolvedCanvasInput[];
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly optionDecision?: CanvasGenerationOptionDecision;
  readonly inputFingerprint: string;
}
export type ResolvedCanvasMediaInput<K extends CanvasMediaKind = CanvasMediaKind> = ResolvedCanvasInput & { readonly kind: K };
export interface CanvasReferenceInputs {
  readonly images: readonly ResolvedCanvasMediaInput<"image">[];
  readonly videos: readonly ResolvedCanvasMediaInput<"video">[];
  readonly audios: readonly ResolvedCanvasMediaInput<"audio">[];
}
interface CanvasGenerationRequestBase {
  readonly modelId: string;
  readonly capabilityVersion: string;
  readonly prompt: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly inputFingerprint: string;
  readonly identityInputs: readonly ResolvedCanvasInput[];
  readonly referenceImages: readonly ResolvedCanvasMediaInput<"image">[];
}
/** Mutually exclusive request modes put mandatory inputs in the TypeScript contract. */
export type CanvasGenerationRequest = CanvasGenerationRequestBase & (
  | { readonly mode: "textToImage"; readonly firstFrame?: never; readonly lastFrame?: never; readonly references?: never; readonly sourceVideo?: never }
  | { readonly mode: "imageToImage"; readonly referenceImages: readonly [ResolvedCanvasMediaInput<"image">, ...ResolvedCanvasMediaInput<"image">[]]; readonly firstFrame?: never; readonly lastFrame?: never; readonly sourceVideo?: never }
  | { readonly mode: "textToVideo"; readonly firstFrame?: never; readonly lastFrame?: never; readonly references?: never; readonly sourceVideo?: never }
  | { readonly mode: "imageToVideo"; readonly firstFrame: ResolvedCanvasMediaInput<"image">; readonly referenceAudio: readonly ResolvedCanvasMediaInput<"audio">[]; readonly lastFrame?: never; readonly references?: never; readonly sourceVideo?: never }
  | { readonly mode: "firstLastFrame"; readonly firstFrame: ResolvedCanvasMediaInput<"image">; readonly lastFrame: ResolvedCanvasMediaInput<"image">; readonly referenceAudio: readonly ResolvedCanvasMediaInput<"audio">[]; readonly references?: never; readonly sourceVideo?: never }
  | { readonly mode: "referenceToVideo"; readonly references: CanvasReferenceInputs; readonly firstFrame?: never; readonly lastFrame?: never; readonly sourceVideo?: never }
  | { readonly mode: "videoEdit"; readonly sourceVideo: ResolvedCanvasMediaInput<"video">; readonly references: CanvasReferenceInputs; readonly firstFrame?: never; readonly lastFrame?: never }
  | { readonly mode: "videoExtend"; readonly sourceVideo: ResolvedCanvasMediaInput<"video">; readonly references: CanvasReferenceInputs; readonly firstFrame?: never; readonly lastFrame?: never }
);
export interface CanvasValidationIssue { readonly code: string; readonly path: string; readonly message: string }
export interface CanvasInputResolverOptions { readonly fileExists?: (uri: string, version: CanvasAssetVersion) => boolean }
export interface CanvasEdgeValidationOptions { readonly roleLimits?: Readonly<Partial<Record<CanvasInputRole, number>>> }
export type CanvasCommand =
  | { readonly type: "node.add"; readonly node: CanvasNode }
  | { readonly type: "node.move"; readonly nodeId: string; readonly position: CanvasPoint }
  | { readonly type: "node.resize"; readonly nodeId: string; readonly size: CanvasSize }
  | { readonly type: "node.setPins"; readonly nodeId: string; readonly pinnedColors: readonly PinColor[] }
  | { readonly type: "node.delete"; readonly nodeIds: readonly string[] }
  | { readonly type: "edge.connect"; readonly edge: CanvasEdge }
  | { readonly type: "edge.disconnect"; readonly edgeId: string }
  | { readonly type: "sequence.connect"; readonly link: CanvasSequenceLink }
  | { readonly type: "sequence.disconnect"; readonly linkId: string }
  | { readonly type: "group.create"; readonly group: CanvasGroup; readonly node?: CanvasGroupNode }
  | { readonly type: "group.ungroup"; readonly groupId: string }
  | { readonly type: "group.setMembers"; readonly groupId: string; readonly nodeIds: readonly string[] }
  | { readonly type: "node.setParameters"; readonly nodeId: string; readonly parameters: Readonly<Record<string, unknown>>; readonly mode?: CanvasGenerationMode; readonly modelId?: string; readonly prompt?: string; readonly optionDecision?: CanvasGenerationOptionDecision }
  | { readonly type: "node.selectVersion"; readonly nodeId: string; readonly versionId: string }
  | { readonly type: "node.addVersion"; readonly nodeId: string; readonly version: CanvasAssetVersion; readonly select?: boolean }
  | { readonly type: "node.setScene"; readonly nodeId: string; readonly scene: SceneDocument }
  | { readonly type: "node.setWorld"; readonly nodeId: string; readonly world: WorldDocument }
  | { readonly type: "viewport.set"; readonly viewport: CanvasDocument["viewport"] };
export interface CanvasCommandOptions { readonly now?: string; readonly expectedRevision?: number; readonly roleLimits?: CanvasEdgeValidationOptions["roleLimits"] }
export interface CanvasHistory { readonly present: CanvasDocument; readonly past: readonly CanvasDocument[]; readonly future: readonly CanvasDocument[] }

export class CanvasError extends Error {
  readonly code: string;
  readonly issues: readonly CanvasValidationIssue[];
  constructor(code: string, message: string, issues: readonly CanvasValidationIssue[] = []) {
    super(message);
    this.name = "CanvasError";
    this.code = code;
    this.issues = issues;
  }
}
const NODE_KINDS: readonly string[] = ["text", "image", "video", "audio", "imageGen", "videoGen", "frameExtract", "composition", "group", "character", "sceneComposer", "world"];
const ROLES: readonly CanvasInputRole[] = ["prompt", "firstFrame", "lastFrame", "referenceImage", "referenceVideo", "referenceAudio", "compositionVideo", "compositionAudio", "character"];
const MODES: readonly CanvasGenerationMode[] = ["textToImage", "imageToImage", "textToVideo", "imageToVideo", "firstLastFrame", "referenceToVideo", "videoEdit", "videoExtend"];
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isTimestamp = (value: unknown): value is string => isString(value) && Number.isFinite(Date.parse(value));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function validOptionDecision(value: unknown, modelId: unknown, mode: unknown, parameters?: unknown): boolean {
  if (!isObject(value) || value.schemaVersion !== 1 || !isString(value.modelId) || value.modelId !== modelId || !isString(value.capabilityVersion)
    || !isObject(value.requested) || !MODES.includes(value.requested.mode as CanvasGenerationMode) || !isObject(value.requested.parameters)
    || !isObject(value.effective) || value.effective.mode !== mode || !isObject(value.effective.parameters)
    || !Array.isArray(value.adjustments) || value.adjustments.some(item => !isObject(item) || !['MODE_RESET', 'PARAMETER_RESET'].includes(String(item.code)) || !isString(item.path))) return false;
  return parameters === undefined || canonical(value.effective.parameters) === canonical(parameters);
}
/** Deterministic browser-safe SHA-256; the fingerprint identifies inputs, never authenticates them. */
function fingerprint(value: unknown): string {
  const bytes = new TextEncoder().encode(canonical(value));
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(length);
  buffer.set(bytes); buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(length - 4, (bytes.length * 8) >>> 0);
  const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotate = (word: number, count: number): number => word >>> count | word << 32 - count;
  const words = new Uint32Array(64);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15], b = words[i - 2];
      words[i] = words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ a >>> 3) + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ b >>> 10);
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let i = 0; i < 64; i++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + constants[i] + words[i]) >>> 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c)) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0; d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    [a,b,c,d,e,f,g,h].forEach((word, index) => { hash[index] = (hash[index] + word) >>> 0; });
  }
  return hash.map(word => word.toString(16).padStart(8, "0")).join("");
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function outputKind(node: CanvasNode): CanvasMediaKind | "text" | "character" | "group" {
  switch (node.kind) {
    case "imageGen": case "frameExtract": return "image";
    case "videoGen": case "composition": return "video";
    case "sceneComposer": case "world": return node.payload.versions.find(v => v.id === node.payload.currentVersionId)?.kind ?? "image";
    default: return node.kind;
  }
}
function roleKind(role: CanvasInputRole): CanvasMediaKind | "text" | "character" {
  switch (role) {
    case "prompt": return "text";
    case "character": return "character";
    case "firstFrame": case "lastFrame": case "referenceImage": return "image";
    case "referenceVideo": case "compositionVideo": return "video";
    case "referenceAudio": case "compositionAudio": return "audio";
  }
}
function roleAllowed(node: CanvasNode, role: CanvasInputRole): boolean {
  if (node.kind === "sceneComposer" || node.kind === "world") return role === "referenceImage";
  if (node.kind === "frameExtract") return role === "referenceVideo";
  if (node.kind === "composition") return role === "compositionVideo" || role === "compositionAudio";
  if (node.kind !== "imageGen" && node.kind !== "videoGen") return false;
  if (role === "prompt" || role === "character") return true;
  switch (node.payload.mode) {
    case "textToImage": case "textToVideo": return role === "referenceImage";
    case "imageToImage": return role === "referenceImage";
    case "imageToVideo": return role === "firstFrame" || role === "referenceImage" || role === "referenceAudio";
    case "firstLastFrame": return role === "firstFrame" || role === "lastFrame" || role === "referenceImage" || role === "referenceAudio";
    case "referenceToVideo": case "videoEdit": case "videoExtend": return role === "referenceImage" || role === "referenceVideo" || role === "referenceAudio";
  }
}
function compatibleSource(node: CanvasNode, role: CanvasInputRole, edge?: CanvasEdge): boolean {
  if (node.kind === "sceneComposer" || node.kind === "world") {
    const pinned = edge?.binding === "pinnedVersion" ? node.payload.versions.find(version => version.id === edge.pinnedVersionId) : undefined;
    if (pinned) return pinned.kind === roleKind(role);
    // Following edges describe the node's possible outputs. A temporary selected-kind
    // mismatch is reported by input resolution, without making the saved graph invalid.
    return ["referenceImage", "firstFrame", "lastFrame", "referenceVideo", "compositionVideo"].includes(role);
  }
  return outputKind(node) === roleKind(role) || node.kind === "character" && role === "referenceImage";
}

/** Expand nested group members in explicit member order, with each leaf occurring once. */
export function expandCanvasGroup(canvas: CanvasDocument, groupId: string): readonly CanvasNode[] {
  const groups = new Map(canvas.groups.map(group => [group.id, group]));
  const nodes = new Map(canvas.nodes.map(node => [node.id, node]));
  const leaves: CanvasNode[] = [];
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) throw new CanvasError("GROUP_CYCLE", "Canvas groups cannot contain themselves");
    const group = groups.get(id);
    if (!group) throw new CanvasError("GROUP_MISSING", `Canvas group ${id} does not exist`);
    active.add(id);
    for (const nodeId of group.nodeIds) {
      const node = nodes.get(nodeId);
      if (!node) throw new CanvasError("NODE_MISSING", `Group member ${nodeId} does not exist`);
      if (node.kind === "group") visit(node.payload.groupId);
      else if (!visited.has(node.id)) { visited.add(node.id); leaves.push(node); }
    }
    // Parent membership is sufficient even when a group node is not listed as a member.
    for (const child of canvas.groups.filter(candidate => candidate.parentGroupId === id)) visit(child.id);
    active.delete(id);
  };
  visit(groupId);
  return leaves;
}
function edgeSources(canvas: CanvasDocument, edge: CanvasEdge): readonly CanvasNode[] {
  const source = canvas.nodes.find(node => node.id === edge.sourceNodeId);
  if (!source) return [];
  return source.kind === "group" ? expandCanvasGroup(canvas, source.payload.groupId) : [source];
}

/** Validate a connection against the graph, mode semantics and optional model role limits. */
export function validateCanvasEdge(canvas: CanvasDocument, edge: CanvasEdge, options: CanvasEdgeValidationOptions = {}): readonly CanvasValidationIssue[] {
  const issues: CanvasValidationIssue[] = [];
  const add = (code: string, message: string): void => { issues.push({ code, path: `edges.${edge.id}`, message }); };
  if (!isString(edge.id) || !isString(edge.sourceNodeId) || !isString(edge.targetNodeId) || !isString(edge.sourcePort) || !isString(edge.targetPort) || !ROLES.includes(edge.role) || !Number.isSafeInteger(edge.order) || edge.order < 0 || !["followCurrent", "pinnedVersion"].includes(edge.binding)) {
    add("INVALID_EDGE", "A connection needs identifiers, valid ports, an input role, order and binding");
    return issues;
  }
  if (edge.binding === "pinnedVersion" && !isString(edge.pinnedVersionId)) add("PIN_REQUIRED", "A pinned connection needs a version id");
  if (edge.binding === "followCurrent" && edge.pinnedVersionId !== undefined) add("PIN_CONFLICT", "A following connection cannot retain a pinned version");
  const source = canvas.nodes.find(node => node.id === edge.sourceNodeId);
  const target = canvas.nodes.find(node => node.id === edge.targetNodeId);
  if (!source || !target) { add("NODE_MISSING", "Connection endpoints must exist"); return issues; }
  if (source.id === target.id) add("SELF_LOOP", "A node cannot connect to itself");
  const pinnedSourceVersion = edge.binding === "pinnedVersion" && (source.kind === "sceneComposer" || source.kind === "world") ? source.payload.versions.find(version => version.id === edge.pinnedVersionId) : undefined;
  const kind = pinnedSourceVersion?.kind ?? outputKind(source);
  if (edge.binding === "pinnedVersion" && (source.kind === "text" || edge.role === "character")) add("PIN_UNSUPPORTED", "Identity and text inputs are frozen in generation snapshots; only media edges pin asset versions");
  if (!["output", kind, ...(kind === "group" ? ["media"] : []), ...(["sceneComposer", "world"].includes(source.kind) ? pinnedSourceVersion ? ["media"] : ["image", "video", "media"] : []), ...(kind === "character" && edge.role === "referenceImage" ? ["image"] : [])].includes(edge.sourcePort)) add("SOURCE_PORT", "The source port does not match its output type");
  if (edge.targetPort !== edge.role && edge.targetPort !== "input") add("TARGET_PORT", "The target port must match the input role");
  const captureSource = source.kind === "sceneComposer" || source.kind === "world";
  const captureProvenance = captureSource && (target.kind === "image" && edge.role === "referenceImage" || target.kind === "video" && edge.role === "referenceVideo");
  if (!roleAllowed(target, edge.role) && !captureProvenance) add("MODE_ROLE", "The target mode cannot accept this input role");
  let sources: readonly CanvasNode[] = [];
  try { sources = edgeSources(canvas, edge); }
  catch (error) { add("GROUP_INVALID", error instanceof Error ? error.message : "Invalid group"); }
  if (source.kind === "group" && sources.length === 0) add("GROUP_EMPTY", "An input group must contain assets");
  if (source.kind === "group" && sources.length > 1 && edge.binding === "pinnedVersion") add("PIN_GROUP", "Pin individual group assets so each input has an explicit version id");
  if (sources.some(node => !compatibleSource(node, edge.role, edge))) add("ROLE_TYPE", "Every expanded source must match the input role");
  if (sources.some(node => node.id === target.id)) add("SELF_LOOP", "A group cannot feed one of its own members");
  const others = canvas.edges.filter(candidate => candidate.id !== edge.id);
  if (others.some(candidate => candidate.sourceNodeId === edge.sourceNodeId && candidate.targetNodeId === edge.targetNodeId && candidate.role === edge.role)) add("DUPLICATE_EDGE", "This source is already connected to this role");
  const count = others.filter(candidate => candidate.targetNodeId === target.id && candidate.role === edge.role).reduce((total, candidate) => {
    try { return total + edgeSources(canvas, candidate).length; } catch { return total; }
  }, 0) + sources.length + ("inputs" in target.payload ? target.payload.inputs?.filter(input => input.role === edge.role).length ?? 0 : 0);
  const limit = options.roleLimits?.[edge.role] ?? ((edge.role === "firstFrame" || edge.role === "lastFrame" || target.kind === "frameExtract") ? 1 : undefined);
  if (limit !== undefined && count > limit) add("ROLE_LIMIT", `Input role ${edge.role} accepts at most ${limit} source(s)`);
  const adjacency = new Map<string, Set<string>>();
  for (const candidate of [...others, edge]) {
    let members: readonly CanvasNode[] = [];
    try { members = edgeSources(canvas, candidate); } catch { continue; }
    for (const node of members) {
      const targets = adjacency.get(node.id) ?? new Set<string>();
      targets.add(candidate.targetNodeId);
      adjacency.set(node.id, targets);
    }
  }
  const reachable = (start: string, wanted: string, seen: Set<string>): boolean => {
    if (start === wanted) return true;
    if (seen.has(start)) return false;
    seen.add(start);
    return [...(adjacency.get(start) ?? [])].some(next => reachable(next, wanted, seen));
  };
  if (sources.some(node => reachable(target.id, node.id, new Set()))) add("CYCLE", "This connection introduces a dependency cycle");
  return issues;
}

/** Runtime boundary for files and RPC input. Returns diagnostics instead of throwing. */
export function validateCanvasDocument(value: unknown): readonly CanvasValidationIssue[] {
  const issues: CanvasValidationIssue[] = [];
  const add = (code: string, path: string, message: string): void => { issues.push({ code, path, message }); };
  if (!isObject(value)) return [{ code: "INVALID_DOCUMENT", path: "", message: "Canvas must be an object" }];
  const seen = new Set<object>();
  const json = (item: unknown, path: string): void => {
    // URL parsing trims leading C0/space and ignores TAB/LF/CR inside the scheme.
    if (typeof item === "string" && /^[\u0000-\u0020]*b[\t\n\r]*l[\t\n\r]*o[\t\n\r]*b[\t\n\r]*:/iu.test(item)) add("TRANSIENT_URL", path, "A canvas cannot persist temporary blob URLs");
    else if (typeof item === "number" && !Number.isFinite(item) || typeof item === "bigint" || typeof item === "symbol" || typeof item === "function") add("NOT_JSON", path, "Canvas values must be finite JSON values");
    if (item && typeof item === "object") {
      if (seen.has(item)) { add("NOT_JSON", path, "Canvas values cannot contain circular references"); return; }
      if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) add("NOT_JSON", path, "Canvas values must be plain JSON objects");
      seen.add(item);
      for (const [key, child] of Object.entries(item)) {
        if (/^(api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|cookie|authorization|credentials)$/i.test(key)) add("SECRET", `${path}.${key}`, "Model credentials belong in the settings vault");
        json(child, `${path}.${key}`);
      }
      seen.delete(item);
    }
  };
  json(value, "");
  if (value.schemaVersion !== CANVAS_SCHEMA_VERSION) add("SCHEMA_VERSION", "schemaVersion", "Unsupported canvas schema version");
  for (const key of ["id", "projectId", "title"]) if (!isString(value[key])) add("REQUIRED", key, `Canvas ${key} is required`);
  for (const key of ["createdAt", "updatedAt"]) if (!isTimestamp(value[key])) add("TIMESTAMP", key, `Canvas ${key} must be an ISO timestamp`);
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) add("REVISION", "revision", "Revision must be a nonnegative integer");
  if (!isObject(value.viewport) || !isFiniteNumber(value.viewport.x) || !isFiniteNumber(value.viewport.y) || !isFiniteNumber(value.viewport.zoom) || value.viewport.zoom <= 0) add("VIEWPORT", "viewport", "Viewport needs finite coordinates and a positive zoom");
  if (!isObject(value.settings)) add("SETTINGS", "settings", "Canvas settings must be an object");
  for (const key of ["nodes", "edges", "groups"]) if (!Array.isArray(value[key])) add("ARRAY", key, `${key} must be an array`);
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.groups)) return issues;
  const nodeIds = new Set<string>();
  const groupIds = new Set<string>();
  const edgeIds = new Set<string>();
  const validNodes: CanvasNode[] = [];
  const checkVersions = (payload: Record<string, unknown>, path: string, expectedKind: CanvasMediaKind | readonly CanvasMediaKind[]): void => {
    if (!Array.isArray(payload.versions)) { add("VERSIONS", `${path}.versions`, "Result nodes need a versions array"); return; }
    const ids = new Set<string>();
    for (const [index, version] of payload.versions.entries()) {
      const vp = `${path}.versions.${index}`;
      if (!isObject(version)) { add("VERSION", vp, "Asset version must be an object"); continue; }
      if (!isString(version.id) || ids.has(version.id)) add("VERSION_ID", `${vp}.id`, "Version ids must be nonempty and unique within a node");
      else ids.add(version.id);
      if (!isString(version.assetId)) add("ASSET_ID", `${vp}.assetId`, "An asset version needs a stable asset id");
      if (!(Array.isArray(expectedKind) ? expectedKind.includes(version.kind as CanvasMediaKind) : version.kind === expectedKind)) add("VERSION_KIND", `${vp}.kind`, "Asset version type must match the node's output");
      if (typeof version.uri !== "string" || (!version.uri && version.status !== "uploading" && version.status !== "missing")) add("ASSET_URI", `${vp}.uri`, "A ready asset needs a persistent URI");
      if (!isTimestamp(version.createdAt)) add("TIMESTAMP", `${vp}.createdAt`, "Version creation time must be an ISO timestamp");
      if (version.status !== undefined && !["ready", "uploading", "missing"].includes(String(version.status))) add("ASSET_STATUS", `${vp}.status`, "Unknown asset availability");
      if (version.metadata !== undefined) {
        if (!isObject(version.metadata)) add("METADATA", `${vp}.metadata`, "Metadata must be an object");
        else {
          for (const key of ["durationMs", "width", "height", "byteLength", "frameRate", "streamStartMs"]) {
            const number = version.metadata[key];
            if (number !== undefined && (!isFiniteNumber(number) || (key === "streamStartMs" ? false : number < 0) || (["width", "height", "frameRate"].includes(key) && number <= 0))) add("METADATA_UNIT", `${vp}.metadata.${key}`, "Media measurements must be finite and use their declared units");
          }
          for (const key of ["mimeType", "sha256"]) if (version.metadata[key] !== undefined && typeof version.metadata[key] !== "string") add("METADATA_TYPE", `${vp}.metadata.${key}`, "Media format and hash metadata must be strings");
          if (version.metadata.hasAudio !== undefined && typeof version.metadata.hasAudio !== "boolean") add("METADATA_TYPE", `${vp}.metadata.hasAudio`, "Media audio availability must be boolean");
        }
      }
      if (version.provenance !== undefined && (!isObject(version.provenance) || version.provenance.actualTimeMs !== undefined && (!isFiniteNumber(version.provenance.actualTimeMs) || version.provenance.actualTimeMs < 0))) add("PROVENANCE", `${vp}.provenance`, "Frame provenance needs a nonnegative actual time in milliseconds");
      if (isObject(version.provenance) && version.provenance.directorCapture !== undefined) {
        const capture = version.provenance.directorCapture;
        const vector = (v: unknown) => isObject(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z);
        if (!isObject(capture) || !isString(capture.captureId) || validateScene(capture.scene).length || !isObject(capture.camera) || !vector(capture.camera.position) || !vector(capture.camera.rotation) || capture.camera.lookAt !== undefined && !vector(capture.camera.lookAt) || !isFiniteNumber(capture.camera.fov) || capture.camera.fov < 10 || capture.camera.fov > 120 || !Number.isInteger(capture.frame) || Number(capture.frame) < 0 || capture.endFrame !== undefined && (!Number.isInteger(capture.endFrame) || Number(capture.endFrame) < Number(capture.frame)) || ![capture.sceneSha256, capture.dataSha256, ...(capture.requestSha256 !== undefined ? [capture.requestSha256] : [])].every(v => typeof v === "string" && /^[a-f\d]{64}$/i.test(v))) add("DIRECTOR_PROVENANCE", `${vp}.provenance.directorCapture`, "Director captures must retain a valid scene, camera, frame and content hashes");
        if (isObject(capture) && capture.world !== undefined) try { normalizeWorld(capture.world); } catch { add("DIRECTOR_WORLD_PROVENANCE", `${vp}.provenance.directorCapture.world`, "World captures must retain a valid world document"); }
      }
      if (isObject(version.provenance) && version.provenance.annotation !== undefined) {
        const marks = version.provenance.annotation;
        if (!isObject(marks) || !isString(marks.markId) || ![marks.dataSha256, marks.requestSha256].every(v => typeof v === "string" && /^[a-f\d]{64}$/i.test(v))) add("ANNOTATION_PROVENANCE", `${vp}.provenance.annotation`, "Marked images must retain their mark identifier and content hashes");
      }
      if (version.snapshot !== undefined) checkSnapshot(version.snapshot, `${vp}.snapshot`);
    }
    if (payload.currentVersionId !== undefined && (!isString(payload.currentVersionId) || !ids.has(payload.currentVersionId))) add("CURRENT_VERSION", `${path}.currentVersionId`, "Selected output must name an existing version");
  };
  const checkSnapshot = (snapshot: unknown, path: string): void => {
    if (!isObject(snapshot) || !isString(snapshot.modelId) || !isString(snapshot.capabilityVersion) || !MODES.includes(snapshot.mode as CanvasGenerationMode) || typeof snapshot.prompt !== "string" || !Array.isArray(snapshot.resolvedInputs) || !isObject(snapshot.parameters) || !isString(snapshot.inputFingerprint)) add("SNAPSHOT", path, "A generation snapshot must contain its model, capability, mode, prompt, inputs, parameters and fingerprint");
    else for (const [index, input] of snapshot.resolvedInputs.entries()) {
      if (!isObject(input) || !ROLES.includes(input.role as CanvasInputRole) || !isString(input.versionId) || !isString(input.assetId) || !["image", "video", "audio", "text", "character"].includes(String(input.kind)) || typeof input.uri !== "string" || !Number.isSafeInteger(input.order) || Number(input.order) < 0) add("SNAPSHOT_INPUT", `${path}.resolvedInputs.${index}`, "Historical inputs must identify fixed asset versions");
    }
    if (isObject(snapshot) && snapshot.optionDecision !== undefined && !validOptionDecision(snapshot.optionDecision, snapshot.modelId, snapshot.mode)) add("OPTION_DECISION", `${path}.optionDecision`, "Parameter decision must retain its requested and effective model settings");
    if (isObject(snapshot) && snapshot.continuity !== undefined) {
      try { assertCanvasContinuityInputs(snapshot.continuity as CanvasShotContinuity, snapshot.resolvedInputs as ResolvedCanvasInput[], String(snapshot.mode)); }
      catch { add("CONTINUITY", `${path}.continuity`, "Continuation snapshot must retain its approved media input"); }
    }
  };
  for (const [index, candidate] of value.nodes.entries()) {
    const path = `nodes.${index}`;
    if (!isObject(candidate)) { add("NODE", path, "Node must be an object"); continue; }
    if (!isString(candidate.id) || nodeIds.has(candidate.id)) add("NODE_ID", `${path}.id`, "Node ids must be nonempty and unique");
    else nodeIds.add(candidate.id);
    if (typeof candidate.title !== "string") add("TITLE", `${path}.title`, "Node title must be a string");
    if (!NODE_KINDS.includes(String(candidate.kind))) { add("NODE_KIND", `${path}.kind`, "Unknown node kind"); continue; }
    if (!isObject(candidate.position) || !isFiniteNumber(candidate.position.x) || !isFiniteNumber(candidate.position.y)) add("POSITION", `${path}.position`, "Node position must contain finite coordinates");
    if (!isObject(candidate.size) || !isFiniteNumber(candidate.size.width) || candidate.size.width <= 0 || !isFiniteNumber(candidate.size.height) || candidate.size.height <= 0) add("SIZE", `${path}.size`, "Node dimensions must be positive");
    if (candidate.createdAt !== undefined && !isTimestamp(candidate.createdAt)) add("TIMESTAMP", `${path}.createdAt`, "Node creation time must be an ISO timestamp");
    if (candidate.pinnedColors !== undefined && (!Array.isArray(candidate.pinnedColors) || candidate.pinnedColors.some(color => !(PIN_COLORS as readonly unknown[]).includes(color)) || new Set(candidate.pinnedColors).size !== candidate.pinnedColors.length)) add("PIN_COLORS", `${path}.pinnedColors`, "Pins must be a list of unique supported colors");
    if (!isObject(candidate.payload)) { add("PAYLOAD", `${path}.payload`, "Node needs a payload"); continue; }
    if (candidate.orphaned !== undefined && typeof candidate.orphaned !== "boolean") add("ORPHAN", `${path}.orphaned`, "Orphan marker must be boolean");
    const payload = candidate.payload, pp = `${path}.payload`;
    if (candidate.kind === "text") {
      if (typeof payload.text !== "string") add("TEXT", `${pp}.text`, "Text node needs text");
    } else if (candidate.kind === "group") {
      if (!isString(payload.groupId)) add("GROUP_ID", `${pp}.groupId`, "Group node needs a group id");
    } else {
      checkVersions(payload, pp, candidate.kind === "sceneComposer" || candidate.kind === "world" ? ["image", "video"] : outputKind(candidate as unknown as CanvasNode) === "character" ? "image" : outputKind(candidate as unknown as CanvasNode) as CanvasMediaKind);
      if (candidate.kind === "sceneComposer") {
        if (!isObject(payload.scene) || payload.scene.schemaVersion !== 2) add("SCENE", `${pp}.scene`, "Director node needs a versioned scene document");
        else for (const issue of validateScene(payload.scene)) add(`SCENE_${issue.code}`, `${pp}.scene.${issue.path}`, issue.message);
      }
      if (candidate.kind === "world") {
        try { if (!isObject(payload.world) || payload.world.schemaVersion !== 1) throw new Error("World node needs a versioned world document"); normalizeWorld(payload.world); }
        catch (e) { add("WORLD", `${pp}.world`, e instanceof Error ? e.message : "Invalid world"); }
      }
      if (payload.inputs !== undefined) {
        if (!Array.isArray(payload.inputs)) add("INPUTS", `${pp}.inputs`, "Direct inputs must be an array");
        else {
          const inputIds = new Set<string>();
          for (const [inputIndex, input] of payload.inputs.entries()) {
            const ip = `${pp}.inputs.${inputIndex}`;
            if (!isObject(input) || !isString(input.id) || inputIds.has(input.id) || !ROLES.includes(input.role as CanvasInputRole) || !Number.isSafeInteger(input.order) || Number(input.order) < 0) { add("DIRECT_INPUT", ip, "Direct imports need a unique id, role and order"); continue; }
            inputIds.add(input.id);
            if (!roleAllowed(candidate as unknown as CanvasNode, input.role as CanvasInputRole)) add("MODE_ROLE", ip, "Direct input role is not accepted by this mode");
            const kind = roleKind(input.role as CanvasInputRole);
            if (kind === "text" || kind === "character") add("DIRECT_TYPE", ip, "Direct imports must be media asset versions");
            else checkVersions({ versions: [input.version] }, ip, kind);
          }
        }
      }
      if (candidate.kind === "imageGen" || candidate.kind === "videoGen") {
        if (!MODES.includes(payload.mode as CanvasGenerationMode) || (candidate.kind === "imageGen") !== ["textToImage", "imageToImage"].includes(String(payload.mode))) add("GENERATION_MODE", `${pp}.mode`, "Generation mode must match the node kind");
        if (!isString(payload.modelId) || typeof payload.prompt !== "string" || !isObject(payload.parameters)) add("GENERATION", pp, "Generation payload needs model, prompt and parameter object");
        if (payload.optionDecision !== undefined && !validOptionDecision(payload.optionDecision, payload.modelId, payload.mode, payload.parameters)) add("OPTION_DECISION", `${pp}.optionDecision`, "Parameter decision does not match the generation node");
        if (payload.continuity !== undefined && (candidate.kind !== "videoGen" || !isCanvasShotContinuity(payload.continuity))) add("CONTINUITY", `${pp}.continuity`, "Continuation must identify an approved source version and ending state");
        if (payload.jobs !== undefined) {
          if (!Array.isArray(payload.jobs)) add("JOBS", `${pp}.jobs`, "Job history must be an array");
          else for (const [jobIndex, job] of payload.jobs.entries()) {
            const jp = `${pp}.jobs.${jobIndex}`;
            if (!isObject(job) || !isString(job.idempotencyKey) || !isString(job.status) || !isTimestamp(job.createdAt) || !isTimestamp(job.updatedAt)) add("JOB", jp, "Generation job must retain identity, state and timestamps");
            else checkSnapshot(job.snapshot, `${jp}.snapshot`);
          }
        }
      }
      if (candidate.kind === "character" && (!isString(payload.characterId) || payload.description !== undefined && typeof payload.description !== "string" || payload.appearance !== undefined && typeof payload.appearance !== "string")) add("CHARACTER", pp, "Character nodes bind to a stable project character id");
      if (candidate.kind === "frameExtract" && (!isObject(payload.selection) || !["first", "last", "time"].includes(String(payload.selection.kind)) || payload.selection.kind === "time" && (!isFiniteNumber(payload.selection.timeMs) || payload.selection.timeMs < 0))) add("FRAME_SELECTION", `${pp}.selection`, "Frame selection is first, last, or a nonnegative timeMs");
      if (candidate.kind === "composition") {
        if (!Array.isArray(payload.clips) || !isObject(payload.parameters)) add("COMPOSITION", pp, "Composition needs explicit clips and output parameters");
        else {
          const clipIds = new Set<string>();
          for (const [clipIndex, clip] of payload.clips.entries()) {
            if (!isObject(clip) || !isString(clip.id) || clipIds.has(clip.id) || !isString(clip.assetVersionId) || !isString(clip.trackId) || !isFiniteNumber(clip.startMs) || clip.startMs < 0 || !isFiniteNumber(clip.inMs) || clip.inMs < 0 || !isFiniteNumber(clip.outMs) || clip.outMs <= clip.inMs || !isFiniteNumber(clip.volume) || clip.volume < 0 || typeof clip.muted !== "boolean") add("COMPOSITION_CLIP", `${pp}.clips.${clipIndex}`, "Clips need stable versions and valid millisecond timeline ranges");
            else clipIds.add(clip.id);
          }
        }
      }
    }
    validNodes.push(candidate as unknown as CanvasNode);
  }
  for (const [index, group] of value.groups.entries()) {
    const path = `groups.${index}`;
    if (!isObject(group) || !isString(group.id) || groupIds.has(group.id) || typeof group.title !== "string" || !Array.isArray(group.nodeIds) || group.nodeIds.some(id => !isString(id) || !nodeIds.has(id)) || new Set(group.nodeIds).size !== group.nodeIds.length) { add("GROUP", path, "Groups need unique ids and ordered existing members"); continue; }
    groupIds.add(group.id);
  }
  const graphSafe = validNodes.length === value.nodes.length && !issues.some(issue => ["NODE", "NODE_KIND", "PAYLOAD", "GENERATION_MODE", "GROUP", "INPUTS", "DIRECT_INPUT"].includes(issue.code));
  if (graphSafe) {
    const canvas = { ...value, edges: value.edges.filter(isObject) } as unknown as CanvasDocument;
    issues.push(...validateCanvasSequenceLinks(canvas, value.sequenceLinks));
    for (const group of canvas.groups) {
      if (group.parentGroupId !== undefined && !groupIds.has(group.parentGroupId)) add("GROUP_PARENT", `groups.${group.id}`, "Parent group must exist");
      try { expandCanvasGroup(canvas, group.id); } catch (error) { add("GROUP_CYCLE", `groups.${group.id}`, error instanceof Error ? error.message : "Invalid group hierarchy"); }
    }
    for (const node of canvas.nodes) if (node.kind === "group" && !groupIds.has(node.payload.groupId)) add("GROUP_MISSING", `nodes.${node.id}`, "Group node must identify an existing group");
    const memberships = new Map<string, string>();
    for (const group of canvas.groups) for (const id of group.nodeIds) {
      if (memberships.has(id)) add("GROUP_MEMBERSHIP", `groups.${group.id}`, "Each node has at most one immediate parent group");
      memberships.set(id, group.id);
    }
    for (const [index, edge] of (value.edges as unknown[]).entries()) {
      if (!isObject(edge)) { add("EDGE", `edges.${index}`, "Edge must be an object"); continue; }
      if (edgeIds.has(String(edge.id))) add("EDGE_ID", `edges.${index}.id`, "Edge ids must be unique");
      edgeIds.add(String(edge.id));
      issues.push(...validateCanvasEdge(canvas, edge as unknown as CanvasEdge));
    }
  }
  return issues;
}

function requireDocument(value: unknown): CanvasDocument {
  const issues = validateCanvasDocument(value);
  if (issues.length) throw new CanvasError("INVALID_DOCUMENT", issues[0].message, issues);
  return value as CanvasDocument;
}
export function createCanvasDocument(options: { readonly id: string; readonly projectId: string; readonly title?: string; readonly now?: string; readonly settings?: Readonly<Record<string, unknown>> }): CanvasDocument {
  const now = options.now ?? "1970-01-01T00:00:00.000Z";
  return requireDocument({ schemaVersion: CANVAS_SCHEMA_VERSION, id: options.id, projectId: options.projectId, title: options.title ?? "画布", viewport: { x: 0, y: 0, zoom: 1 }, settings: clone(options.settings ?? {}), nodes: [], edges: [], groups: [], revision: 0, createdAt: now, updatedAt: now });
}

/** Version 0 used `name`, optional geometry/defaults, asset node suffixes and durationMs params. */
export function migrateCanvasDocument(value: unknown): CanvasDocument {
  if (!isObject(value)) throw new CanvasError("INVALID_DOCUMENT", "Canvas must be an object");
  if (value.schemaVersion === CANVAS_SCHEMA_VERSION) return clone(requireDocument(value));
  if (value.schemaVersion !== undefined && value.schemaVersion !== 0) throw new CanvasError("UNSUPPORTED_SCHEMA", "This canvas schema is newer than this application");
  const migrated = clone(value);
  migrated.schemaVersion = CANVAS_SCHEMA_VERSION;
  migrated.title ??= migrated.name ?? "画布";
  delete migrated.name;
  migrated.viewport ??= { x: 0, y: 0, zoom: 1 };
  migrated.settings ??= {};
  migrated.nodes ??= []; migrated.edges ??= []; migrated.groups ??= []; migrated.revision ??= 0;
  migrated.createdAt ??= "1970-01-01T00:00:00.000Z";
  migrated.updatedAt ??= migrated.createdAt;
  if (Array.isArray(migrated.nodes)) for (const candidate of migrated.nodes) if (isObject(candidate)) {
    if (["imageAsset", "videoAsset", "audioAsset"].includes(String(candidate.kind))) candidate.kind = String(candidate.kind).replace("Asset", "");
    candidate.title ??= candidate.kind;
    candidate.position ??= { x: 0, y: 0 };
    candidate.size ??= { width: 280, height: 280 };
    candidate.createdAt ??= migrated.createdAt;
    if (Array.isArray(candidate.pinnedColors)) candidate.pinnedColors = [...new Set(candidate.pinnedColors.filter(color => (PIN_COLORS as readonly unknown[]).includes(color)))];
    if (candidate.payload === undefined && isObject(candidate.data)) { candidate.payload = candidate.data; delete candidate.data; }
    if (isObject(candidate.payload)) {
      const payload = candidate.payload;
      if (!["text", "group"].includes(String(candidate.kind))) payload.versions ??= [];
      if (isObject(payload.parameters) && payload.parameters.durationMs !== undefined) {
        if (!isFiniteNumber(payload.parameters.durationMs)) throw new CanvasError("INVALID_DOCUMENT", "Legacy durationMs must be finite");
        payload.parameters.durationSeconds ??= payload.parameters.durationMs / 1000;
        delete payload.parameters.durationMs;
      }
    }
  }
  if (Array.isArray(migrated.edges)) for (const edge of migrated.edges) if (isObject(edge)) {
    if (edge.pinnedVersionId === undefined && edge.pinnedAssetVersionId !== undefined) { edge.pinnedVersionId = edge.pinnedAssetVersionId; delete edge.pinnedAssetVersionId; }
    edge.binding ??= "followCurrent"; edge.order ??= 0;
  }
  return requireDocument(migrated);
}
export function parseCanvasDocument(json: string): CanvasDocument {
  try { return migrateCanvasDocument(JSON.parse(json)); }
  catch (error) { if (error instanceof CanvasError) throw error; throw new CanvasError("INVALID_JSON", "Canvas file is not valid JSON"); }
}
export function serializeCanvasDocument(canvas: CanvasDocument): string { requireDocument(canvas); return `${JSON.stringify(canvas, null, 2)}\n`; }

/** Resolve connected inputs before direct imports. Every historical/media identity is explicit. */
export function resolveCanvasInputs(canvas: CanvasDocument, nodeId: string, options: CanvasInputResolverOptions = {}): CanvasInputResolution {
  requireDocument(canvas);
  const target = canvas.nodes.find(node => node.id === nodeId);
  if (!target) throw new CanvasError("NODE_MISSING", `Canvas node ${nodeId} does not exist`);
  const inputs: ResolvedCanvasInput[] = [];
  const missing: CanvasMissingInput[] = [];
  const addVersion = (version: CanvasAssetVersion, identity: Omit<ResolvedCanvasInput, "versionId" | "assetId" | "kind" | "uri">): void => {
    const unavailable = (reason: CanvasMissingInputReason): void => { missing.push({ role: identity.role, reason, ...(identity.sourceNodeId ? { sourceNodeId: identity.sourceNodeId } : {}), ...(identity.edgeId ? { edgeId: identity.edgeId } : {}), ...(identity.inputId ? { inputId: identity.inputId } : {}), versionId: version.id }); };
    if (version.status === "uploading") { unavailable("uploading"); return; }
    if (version.status === "missing" || !version.uri || options.fileExists && !options.fileExists(version.uri, version)) { unavailable("missingFile"); return; }
    if (version.kind !== roleKind(identity.role)) { unavailable("incompatibleType"); return; }
    inputs.push({ ...identity, versionId: version.id, assetId: version.assetId, kind: version.kind, uri: version.uri, ...(version.metadata ? { metadata: clone(version.metadata) } : {}) });
  };
  const edges = canvas.edges.filter(edge => edge.targetNodeId === nodeId).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  for (const edge of edges) {
    const sources = edgeSources(canvas, edge);
    if (!sources.length) { missing.push({ role: edge.role, reason: "sourceMissing", sourceNodeId: edge.sourceNodeId, edgeId: edge.id }); continue; }
    for (const source of sources) {
      const identity = { role: edge.role, order: inputs.length + missing.length, sourceNodeId: source.id, edgeId: edge.id };
      if (source.kind === "text") {
        if (!source.payload.text.trim()) { missing.push({ ...identity, reason: "noResult" }); continue; }
        const versionId = `text-${fingerprint(source.payload.text)}`;
        inputs.push({ ...identity, versionId, assetId: source.id, kind: "text", uri: "", text: source.payload.text });
        continue;
      }
      if (source.kind === "character" && edge.role === "character") {
        const text = [source.title, source.payload.description, source.payload.appearance].filter(Boolean).join("\n");
        inputs.push({ ...identity, versionId: `character-${fingerprint({ characterId: source.payload.characterId, text })}`, assetId: source.payload.characterId, kind: "character", uri: "", characterId: source.payload.characterId, text });
        continue;
      }
      if (!("versions" in source.payload)) { missing.push({ ...identity, reason: "incompatibleType" }); continue; }
      const payload = source.payload;
      if (payload.versions.length === 0) { missing.push({ ...identity, reason: edge.binding === "pinnedVersion" ? "versionMissing" : "noResult", ...(edge.pinnedVersionId ? { versionId: edge.pinnedVersionId } : {}) }); continue; }
      const selectedId = edge.binding === "pinnedVersion" ? edge.pinnedVersionId : payload.currentVersionId;
      if (!selectedId) { missing.push({ ...identity, reason: "noCurrentVersion" }); continue; }
      const version = payload.versions.find(candidate => candidate.id === selectedId);
      if (!version) { missing.push({ ...identity, reason: "versionMissing", versionId: selectedId }); continue; }
      addVersion(version, { ...identity, ...(source.kind === "character" ? { characterId: source.payload.characterId } : {}) });
    }
  }
  const directInputs = "inputs" in target.payload ? [...(target.payload.inputs ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) : [];
  for (const input of directInputs) addVersion(input.version, { role: input.role, order: inputs.length + missing.length, inputId: input.id });
  const prompt = [target.kind === "imageGen" || target.kind === "videoGen" ? target.payload.prompt : "", ...inputs.filter(input => input.kind === "text" || input.kind === "character").map(input => input.text)].filter(value => value?.trim()).join("\n\n");
  const requireRole = (role: CanvasInputRole): void => {
    if (!inputs.some(input => input.role === role) && !missing.some(input => input.role === role)) missing.push({ role, reason: "requiredInput" });
  };
  if (target.kind === "imageGen" || target.kind === "videoGen") {
    if (!prompt.trim()) requireRole("prompt");
    switch (target.payload.mode) {
      case "imageToImage": requireRole("referenceImage"); break;
      case "imageToVideo": requireRole("firstFrame"); break;
      case "firstLastFrame": requireRole("firstFrame"); requireRole("lastFrame"); break;
      case "videoEdit": case "videoExtend": requireRole("referenceVideo"); break;
      case "referenceToVideo":
        if (!inputs.some(input => ["referenceImage", "referenceVideo", "referenceAudio"].includes(input.role)) && !missing.some(input => ["referenceImage", "referenceVideo", "referenceAudio"].includes(input.role))) requireRole("referenceImage");
        break;
    }
  }
  if (target.kind === "frameExtract") requireRole("referenceVideo");
  if (target.kind === "composition") requireRole("compositionVideo");
  return { inputs, missing, prompt, inputFingerprint: fingerprint({ inputs, prompt }) };
}

/** A frozen JSON copy never follows a later source version or parameter edit. */
export function createGenerationSnapshot(canvas: CanvasDocument, nodeId: string, options: CanvasInputResolverOptions & { readonly capabilityVersion: string }): GenerationSnapshot {
  const node = canvas.nodes.find(candidate => candidate.id === nodeId);
  if (!node || node.kind !== "imageGen" && node.kind !== "videoGen") throw new CanvasError("GENERATION_NODE_REQUIRED", "Only generation nodes have generation snapshots");
  if (!isString(options.capabilityVersion)) throw new CanvasError("CAPABILITY_REQUIRED", "Generation snapshots need the model capability version");
  if (node.payload.optionDecision !== undefined && !validOptionDecision(node.payload.optionDecision, node.payload.modelId, node.payload.mode, node.payload.parameters)) throw new CanvasError("OPTION_DECISION_INVALID", "Parameter decision does not match the generation node");
  const resolved = resolveCanvasInputs(canvas, nodeId, options);
  if (resolved.missing.length) throw new CanvasError("MISSING_INPUT", `Generation inputs are unavailable: ${resolved.missing.map(input => `${input.role}: ${input.reason}`).join(", ")}`);
  if (node.payload.continuity) assertCanvasContinuityInputs(node.payload.continuity, resolved.inputs, node.payload.mode);
  const snapshot = {
    modelId: node.payload.modelId, capabilityVersion: options.capabilityVersion, mode: node.payload.mode,
    prompt: resolved.prompt, resolvedInputs: clone(resolved.inputs), parameters: clone(node.payload.parameters),
    ...(node.payload.optionDecision ? { optionDecision: clone(isCompactCanvasCapabilityVersion(options.capabilityVersion)
      && sameCanvasCapabilityVersion(node.payload.optionDecision.capabilityVersion, options.capabilityVersion)
      ? { ...node.payload.optionDecision, capabilityVersion: options.capabilityVersion } : node.payload.optionDecision) } : {}),
    ...(node.payload.continuity ? { continuity: clone(node.payload.continuity) } : {}),
  };
  return freeze({ ...snapshot, inputFingerprint: fingerprint(snapshot) });
}
/** Submit-layer mode validation independent of a mutable canvas and provider capability catalog. */
export function compileCanvasGenerationRequest(snapshot: GenerationSnapshot): CanvasGenerationRequest {
  if (!isObject(snapshot) || !isString(snapshot.modelId) || !isString(snapshot.capabilityVersion) || !MODES.includes(snapshot.mode) || !isString(snapshot.prompt) || !isObject(snapshot.parameters) || !Array.isArray(snapshot.resolvedInputs) || !isString(snapshot.inputFingerprint)) throw new CanvasError("INVALID_SNAPSHOT", "Generation request needs a complete frozen snapshot");
  if (snapshot.optionDecision !== undefined && !validOptionDecision(snapshot.optionDecision, snapshot.modelId, snapshot.mode)) throw new CanvasError("OPTION_DECISION_INVALID", "Snapshot parameter decision is invalid");
  const modeRoles: Record<CanvasGenerationMode, readonly CanvasInputRole[]> = {
    textToImage: ["prompt", "character", "referenceImage"], imageToImage: ["prompt", "character", "referenceImage"],
    textToVideo: ["prompt", "character", "referenceImage"], imageToVideo: ["prompt", "character", "firstFrame", "referenceImage", "referenceAudio"],
    firstLastFrame: ["prompt", "character", "firstFrame", "lastFrame", "referenceImage", "referenceAudio"],
    referenceToVideo: ["prompt", "character", "referenceImage", "referenceVideo", "referenceAudio"],
    videoEdit: ["prompt", "character", "referenceImage", "referenceVideo", "referenceAudio"],
    videoExtend: ["prompt", "character", "referenceImage", "referenceVideo", "referenceAudio"],
  };
  for (const candidate of snapshot.resolvedInputs) {
    if (!isObject(candidate)) throw new CanvasError("INVALID_INPUT_ROLE", "Snapshot inputs must be objects");
    const input = candidate as unknown as ResolvedCanvasInput;
    if (!ROLES.includes(input.role) || !modeRoles[snapshot.mode].includes(input.role) || input.kind !== roleKind(input.role) && !(input.role === "character" && input.kind === "image") || !isString(input.versionId) || !isString(input.assetId) || !Number.isSafeInteger(input.order) || input.order < 0 || typeof input.uri !== "string" || (["image", "video", "audio"].includes(input.kind) && !input.uri)) throw new CanvasError("INVALID_INPUT_ROLE", "Snapshot input kind and role must match the selected mode");
  }
  if (snapshot.continuity) assertCanvasContinuityInputs(snapshot.continuity, snapshot.resolvedInputs, snapshot.mode);
  const inputs = clone(snapshot.resolvedInputs);
  const media = <K extends CanvasMediaKind>(role: CanvasInputRole, kind: K): ResolvedCanvasMediaInput<K>[] => inputs.filter((input): input is ResolvedCanvasMediaInput<K> => input.role === role && input.kind === kind);
  const firstFrames = media("firstFrame", "image"), lastFrames = media("lastFrame", "image");
  if (firstFrames.length > 1 || lastFrames.length > 1) throw new CanvasError("INPUT_LIMIT", "First and last frame each accept one image");
  const first = (): ResolvedCanvasMediaInput<"image"> => { if (!firstFrames[0]) throw new CanvasError("MISSING_INPUT", "This mode needs a first frame"); return firstFrames[0]; };
  const last = (): ResolvedCanvasMediaInput<"image"> => { if (!lastFrames[0]) throw new CanvasError("MISSING_INPUT", "This mode needs a last frame"); return lastFrames[0]; };
  const referenceImages = inputs.filter((input): input is ResolvedCanvasMediaInput<"image"> => input.kind === "image" && (input.role === "referenceImage" || input.role === "character"));
  const references = { images: referenceImages, videos: media("referenceVideo", "video"), audios: media("referenceAudio", "audio") };
  const base = { modelId: snapshot.modelId, capabilityVersion: snapshot.capabilityVersion, prompt: snapshot.prompt, parameters: clone(snapshot.parameters), inputFingerprint: snapshot.inputFingerprint, identityInputs: inputs.filter(input => input.kind === "text" || input.kind === "character"), referenceImages };
  let request: CanvasGenerationRequest;
  switch (snapshot.mode) {
    case "textToImage": case "textToVideo": request = { ...base, mode: snapshot.mode }; break;
    case "imageToImage":
      if (!references.images.length) throw new CanvasError("MISSING_INPUT", "Image-to-image needs an image reference");
      request = { ...base, mode: snapshot.mode, referenceImages: references.images as [ResolvedCanvasMediaInput<"image">, ...ResolvedCanvasMediaInput<"image">[]] }; break;
    case "imageToVideo": request = { ...base, mode: snapshot.mode, firstFrame: first(), referenceAudio: references.audios }; break;
    case "firstLastFrame": request = { ...base, mode: snapshot.mode, firstFrame: first(), lastFrame: last(), referenceAudio: references.audios }; break;
    case "referenceToVideo":
      if (!references.images.length && !references.videos.length && !references.audios.length) throw new CanvasError("MISSING_INPUT", "Reference video generation needs at least one media reference");
      request = { ...base, mode: snapshot.mode, references }; break;
    case "videoEdit": case "videoExtend":
      if (!references.videos[0]) throw new CanvasError("MISSING_INPUT", "Video editing and extension need a source video");
      request = { ...base, mode: snapshot.mode, sourceVideo: references.videos[0], references: { ...references, videos: references.videos.slice(1) } }; break;
  }
  return freeze(request);
}
export function isCanvasGenerationStale(canvas: CanvasDocument, nodeId: string, snapshot: GenerationSnapshot, options: CanvasInputResolverOptions = {}): boolean {
  try { return createGenerationSnapshot(canvas, nodeId, { ...options, capabilityVersion: snapshot.capabilityVersion }).inputFingerprint !== snapshot.inputFingerprint; }
  catch (error) { if (error instanceof CanvasError) return true; throw error; }
}

/** One pure edit is one revision; none of these commands submit a media job. */
export function applyCanvasCommand(canvas: CanvasDocument, command: CanvasCommand, options: CanvasCommandOptions = {}): CanvasDocument {
  requireDocument(canvas);
  if (options.expectedRevision !== undefined && options.expectedRevision !== canvas.revision) throw new CanvasError("REVISION_CONFLICT", `Canvas revision ${canvas.revision} differs from ${options.expectedRevision}`);
  if (!isObject(command) || typeof command.type !== "string") throw new CanvasError("INVALID_COMMAND", "A canvas command needs a type");
  const result = clone(canvas);
  let nodes = [...result.nodes], edges = [...result.edges], groups = [...result.groups], sequenceLinks = [...(result.sequenceLinks ?? [])];
  const find = (id: string): CanvasNode => {
    const node = nodes.find(candidate => candidate.id === id);
    if (!node) throw new CanvasError("NODE_MISSING", `Canvas node ${id} does not exist`);
    return node;
  };
  const update = (node: CanvasNode): void => { nodes = nodes.map(candidate => candidate.id === node.id ? node : candidate); };
  switch (command.type) {
    case "node.add":
      if (nodes.some(node => node.id === command.node.id)) throw new CanvasError("NODE_EXISTS", "Canvas node id is already present");
      nodes.push(clone({ ...command.node, createdAt: command.node.createdAt ?? options.now ?? canvas.updatedAt })); break;
    case "node.move": {
      const node = find(command.nodeId);
      if (node.kind === "group") {
        const dx = command.position.x - node.position.x, dy = command.position.y - node.position.y;
        for (const member of expandCanvasGroup(result, node.payload.groupId)) update({ ...find(member.id), position: { x: member.position.x + dx, y: member.position.y + dy } });
        const descendantGroups = new Set<string>();
        const descendants = (groupId: string): void => {
          if (descendantGroups.has(groupId)) return;
          descendantGroups.add(groupId);
          const group = groups.find(candidate => candidate.id === groupId);
          for (const id of group?.nodeIds ?? []) { const member = find(id); if (member.kind === "group") descendants(member.payload.groupId); }
          groups.filter(candidate => candidate.parentGroupId === groupId).forEach(child => descendants(child.id));
        };
        descendants(node.payload.groupId);
        nodes = nodes.map(member => member.kind === "group" && member.id !== node.id && descendantGroups.has(member.payload.groupId) ? { ...member, position: { x: member.position.x + dx, y: member.position.y + dy } } : member);
      }
      update({ ...node, position: clone(command.position) }); break;
    }
    case "node.resize": update({ ...find(command.nodeId), size: clone(command.size) }); break;
    case "node.setPins": update({ ...find(command.nodeId), pinnedColors: clone(command.pinnedColors) }); break;
    case "node.delete": {
      if (!Array.isArray(command.nodeIds) || command.nodeIds.length === 0) throw new CanvasError("INVALID_COMMAND", "Deletion needs node ids");
      const deleted = new Set(command.nodeIds);
      const deletedGroups = new Set<string>();
      const removeGroup = (groupId: string): void => {
        if (deletedGroups.has(groupId)) return;
        deletedGroups.add(groupId);
        const group = groups.find(candidate => candidate.id === groupId);
        for (const id of group?.nodeIds ?? []) { deleted.add(id); const member = find(id); if (member.kind === "group") removeGroup(member.payload.groupId); }
        groups.filter(candidate => candidate.parentGroupId === groupId).forEach(child => removeGroup(child.id));
        nodes.filter(node => node.kind === "group" && node.payload.groupId === groupId).forEach(node => deleted.add(node.id));
      };
      command.nodeIds.forEach(id => { const node = find(id); if (node.kind === "group") removeGroup(node.payload.groupId); });
      nodes = nodes.filter(node => !deleted.has(node.id));
      edges = edges.filter(edge => !deleted.has(edge.sourceNodeId) && !deleted.has(edge.targetNodeId));
      sequenceLinks = sequenceLinks.filter(link => !deleted.has(link.sourceNodeId) && !deleted.has(link.targetNodeId));
      groups = groups.filter(group => !deletedGroups.has(group.id)).map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !deleted.has(id)) }));
      break;
    }
    case "edge.connect": {
      if (edges.some(edge => edge.id === command.edge.id)) throw new CanvasError("EDGE_EXISTS", "Canvas edge id is already present");
      const issues = validateCanvasEdge({ ...result, nodes, edges, groups }, command.edge, options);
      if (issues.length) throw new CanvasError("INVALID_EDGE", issues[0].message, issues);
      edges.push(clone(command.edge)); break;
    }
    case "edge.disconnect":
      if (!edges.some(edge => edge.id === command.edgeId)) throw new CanvasError("EDGE_MISSING", "Canvas edge does not exist");
      edges = edges.filter(edge => edge.id !== command.edgeId); break;
    case "sequence.connect": {
      const links = [...sequenceLinks, clone(command.link)];
      const issues = validateCanvasSequenceLinks({ nodes }, links);
      if (issues.length) throw new CanvasError(issues[0].code, issues[0].message, issues);
      sequenceLinks = links; break;
    }
    case "sequence.disconnect":
      if (!sequenceLinks.some(link => link.id === command.linkId)) throw new CanvasError('SEQUENCE_LINK_MISSING', 'Playback sequence link does not exist');
      sequenceLinks = sequenceLinks.filter(link => link.id !== command.linkId); break;
    case "group.create": {
      if (groups.some(group => group.id === command.group.id)) throw new CanvasError("GROUP_EXISTS", "Group id is already present");
      command.group.nodeIds.forEach(find);
      const movedGroupIds = new Set(command.group.nodeIds.map(find).filter(node => node.kind === "group").map(node => node.payload.groupId));
      groups = groups.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !command.group.nodeIds.includes(id)), ...(movedGroupIds.has(group.id) ? { parentGroupId: command.group.id } : {}) }));
      groups.push(clone(command.group));
      if (command.node) {
        if (nodes.some(node => node.id === command.node!.id) || command.node.payload.groupId !== command.group.id) throw new CanvasError("INVALID_GROUP", "Group node must have a unique id and bind the new group");
        nodes.push(clone({ ...command.node, createdAt: command.node.createdAt ?? options.now ?? canvas.updatedAt }));
        if (command.group.parentGroupId) groups = groups.map(parent => parent.id === command.group.parentGroupId ? { ...parent, nodeIds: [...parent.nodeIds, command.node!.id] } : parent);
      }
      break;
    }
    case "group.setMembers": {
      if (!groups.some(group => group.id === command.groupId)) throw new CanvasError("GROUP_MISSING", "Canvas group does not exist");
      if (!Array.isArray(command.nodeIds)) throw new CanvasError("INVALID_COMMAND", "Group membership needs node ids");
      const members = new Set(command.nodeIds);
      const movedGroupIds = new Set(command.nodeIds.map(find).filter(node => node.kind === "group").map(node => node.payload.groupId));
      groups = groups.map(group => {
        const { parentGroupId, ...rest } = group;
        const hasGroupNode = nodes.some(node => node.kind === "group" && node.payload.groupId === group.id);
        const parent = movedGroupIds.has(group.id) ? command.groupId : parentGroupId === command.groupId && hasGroupNode ? undefined : parentGroupId;
        return { ...rest, nodeIds: group.id === command.groupId ? clone(command.nodeIds) : group.nodeIds.filter(id => !members.has(id)), ...(parent ? { parentGroupId: parent } : {}) };
      });
      break;
    }
    case "group.ungroup": {
      const group = groups.find(candidate => candidate.id === command.groupId);
      if (!group) throw new CanvasError("GROUP_MISSING", "Canvas group does not exist");
      const groupNodes = new Set(nodes.filter(node => node.kind === "group" && node.payload.groupId === group.id).map(node => node.id));
      // Replace aggregate edges with ordered leaf edges so ungrouping keeps the same inputs.
      const expanded = expandCanvasGroup(result, group.id);
      const rewrittenEdges: CanvasEdge[] = [];
      const targetOrder = new Map<string, number>();
      const seenPairRole = new Set<string>();
      const usedEdgeIds = new Set<string>();
      const roleCounts = new Map<string, number>();
      for (const node of nodes) {
        if ("inputs" in node.payload && Array.isArray(node.payload.inputs)) {
          for (const input of node.payload.inputs) {
            const key = `${node.id}:${input.role}`;
            roleCounts.set(key, (roleCounts.get(key) ?? 0) + 1);
          }
        }
      }
      for (const edge of [...edges].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
        if (groupNodes.has(edge.targetNodeId)) continue;
        const target = nodes.find(node => node.id === edge.targetNodeId);
        const roleLimit = options.roleLimits?.[edge.role] ?? ((edge.role === "firstFrame" || edge.role === "lastFrame" || target?.kind === "frameExtract") ? 1 : undefined);
        const sources = groupNodes.has(edge.sourceNodeId) ? expanded : undefined;
        const addEdge = (candidate: CanvasEdge, sourceNode?: CanvasNode): void => {
          const pairKey = `${candidate.sourceNodeId}:${candidate.targetNodeId}:${candidate.role}`;
          if (seenPairRole.has(pairKey)) return;
          const roleKey = `${candidate.targetNodeId}:${candidate.role}`;
          const currentRoleCount = roleCounts.get(roleKey) ?? 0;
          const addedSources = sourceNode && sourceNode.kind !== "group" ? 1 : (() => { try { return edgeSources(result, candidate).length; } catch { return 1; } })();
          if (roleLimit !== undefined && currentRoleCount + addedSources > roleLimit) return;
          let normalized = candidate;
          if (normalized.binding === "pinnedVersion" && (sourceNode?.kind === "text" || normalized.role === "character")) {
            const { pinnedVersionId: _pinnedVersionId, ...rest } = normalized;
            normalized = { ...rest, binding: "followCurrent" };
          }
          let edgeId = normalized.id;
          let suffix = 2;
          while (usedEdgeIds.has(edgeId)) {
            edgeId = `${normalized.id}:${suffix++}`;
          }
          usedEdgeIds.add(edgeId);
          seenPairRole.add(pairKey);
          roleCounts.set(roleKey, currentRoleCount + addedSources);
          const order = targetOrder.get(normalized.targetNodeId) ?? 0;
          rewrittenEdges.push({ ...normalized, id: edgeId, order });
          targetOrder.set(normalized.targetNodeId, order + 1);
        };
        if (!sources) addEdge(edge, nodes.find(node => node.id === edge.sourceNodeId));
        else sources.forEach(source => addEdge({ ...edge, id: `${edge.id}:${source.id}`, sourceNodeId: source.id, sourcePort: "output" }, source));
      }
      groups = groups.filter(candidate => candidate.id !== group.id).map(candidate => ({ ...candidate,
        nodeIds: candidate.nodeIds.flatMap(id => groupNodes.has(id) ? [...group.nodeIds] : [id]),
        ...(candidate.parentGroupId === group.id ? { parentGroupId: group.parentGroupId } : {}),
      }));
      if (group.parentGroupId) groups = groups.map(candidate => candidate.id === group.parentGroupId ? { ...candidate, nodeIds: [...new Set([...candidate.nodeIds, ...group.nodeIds])] } : candidate);
      nodes = nodes.filter(node => !groupNodes.has(node.id));
      edges = rewrittenEdges;
      break;
    }
    case "node.setParameters": {
      const node = find(command.nodeId);
      if (node.kind !== "imageGen" && node.kind !== "videoGen" && node.kind !== "composition") throw new CanvasError("PARAMETERS_UNSUPPORTED", "This node has no generation or output parameters");
      const payload = { ...node.payload, parameters: clone(command.parameters), ...(command.mode !== undefined ? { mode: command.mode } : {}), ...(command.modelId !== undefined ? { modelId: command.modelId } : {}), ...(command.prompt !== undefined ? { prompt: command.prompt } : {}) };
      if (node.kind === 'imageGen' || node.kind === 'videoGen') {
        const generation = payload as CanvasGenerationPayload & { optionDecision?: CanvasGenerationOptionDecision };
        if (command.optionDecision !== undefined) generation.optionDecision = clone(command.optionDecision);
        else if (generation.optionDecision && !validOptionDecision(generation.optionDecision, generation.modelId, generation.mode, generation.parameters)) delete generation.optionDecision;
      }
      update({ ...node, payload } as CanvasNode); break;
    }
    case "node.selectVersion": {
      const node = find(command.nodeId);
      if (!("versions" in node.payload) || !node.payload.versions.some(version => version.id === command.versionId)) throw new CanvasError("VERSION_MISSING", "Selected asset version does not exist");
      update({ ...node, payload: { ...node.payload, currentVersionId: command.versionId } } as CanvasNode); break;
    }
    case "node.setScene": {
      const node = find(command.nodeId); if (node.kind !== "sceneComposer") throw new CanvasError("SCENE_UNSUPPORTED", "This node has no director scene");
      update({ ...node, payload: { ...node.payload, scene: normalizeScene(command.scene) } }); break;
    }
    case "node.setWorld": {
      const node = find(command.nodeId); if (node.kind !== "world") throw new CanvasError("WORLD_UNSUPPORTED", "This node has no world view");
      update({ ...node, payload: { ...node.payload, world: normalizeWorld(command.world) } }); break;
    }
    case "node.addVersion": {
      const node = find(command.nodeId);
      if (!("versions" in node.payload)) throw new CanvasError("VERSION_UNSUPPORTED", "This node cannot contain media output");
      if (node.payload.versions.some(version => version.id === command.version.id)) throw new CanvasError("VERSION_EXISTS", "Asset version id is already present");
      update({ ...node, payload: { ...node.payload, versions: [...node.payload.versions, clone(command.version)], ...(command.select ? { currentVersionId: command.version.id } : {}) } } as CanvasNode); break;
    }
    case "viewport.set": break;
    default: throw new CanvasError("INVALID_COMMAND", "Unknown canvas command");
  }
  return requireDocument({ ...result, nodes, edges, groups, ...(result.sequenceLinks !== undefined || sequenceLinks.length ? { sequenceLinks } : {}), ...(command.type === "viewport.set" ? { viewport: clone(command.viewport) } : {}), revision: canvas.revision + 1, updatedAt: options.now ?? canvas.updatedAt });
}
export function createCanvasHistory(canvas: CanvasDocument): CanvasHistory { return { present: clone(requireDocument(canvas)), past: [], future: [] }; }
export function executeCanvasCommand(history: CanvasHistory, command: CanvasCommand, options: CanvasCommandOptions = {}): CanvasHistory {
  return { present: applyCanvasCommand(history.present, command, options), past: [...history.past, clone(history.present)], future: [] };
}
function restoredCanvas(history: CanvasHistory, canvas: CanvasDocument, options: CanvasCommandOptions): CanvasDocument {
  if (options.expectedRevision !== undefined && options.expectedRevision !== history.present.revision) throw new CanvasError("REVISION_CONFLICT", "Canvas history revision differs from the expected revision");
  return requireDocument({ ...clone(canvas), revision: history.present.revision + 1, updatedAt: options.now ?? history.present.updatedAt });
}
export function undoCanvasCommand(history: CanvasHistory, options: CanvasCommandOptions = {}): CanvasHistory {
  if (!history.past.length) return history;
  return { present: restoredCanvas(history, history.past[history.past.length - 1], options), past: history.past.slice(0, -1), future: [clone(history.present), ...history.future] };
}
export function redoCanvasCommand(history: CanvasHistory, options: CanvasCommandOptions = {}): CanvasHistory {
  if (!history.future.length) return history;
  return { present: restoredCanvas(history, history.future[0], options), past: [...history.past, clone(history.present)], future: history.future.slice(1) };
}
