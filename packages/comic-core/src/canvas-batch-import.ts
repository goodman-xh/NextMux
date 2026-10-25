import { CanvasError, validateCanvasDocument } from "./canvas.js";
import type {
  CanvasAssetNode, CanvasAssetVersion, CanvasDocument, CanvasEdge, CanvasGenerationMode,
  CanvasImageGenNode, CanvasInputRole, CanvasMediaKind, CanvasNode, CanvasPoint, CanvasSize, CanvasVideoGenNode,
} from "./canvas.js";

/** These are editing limits, not media-job timeouts or limits on online models. */
export const CANVAS_BATCH_MAX_NODES = 200;
export const CANVAS_BATCH_MAX_REFERENCES = 30;
export type BatchPromptSplitRule =
  | { readonly kind: "paragraphs" }
  | { readonly kind: "lines" }
  | { readonly kind: "separator"; readonly separator: string };
export interface BatchPromptSplitResult {
  readonly prompts: readonly string[];
  readonly totalCount: number;
  readonly omittedCount: number;
}
export interface BatchPromptEntry {
  /** Stable while sorting or renaming this source. Re-splitting creates a fresh source order. */
  readonly id: string;
  readonly sourceIndex: number;
  readonly text: string;
  readonly manualName?: string;
}
export interface BatchPromptImportState {
  readonly sourceText: string;
  readonly splitRule: BatchPromptSplitRule;
  readonly entries: readonly BatchPromptEntry[];
  readonly totalCount: number;
  readonly omittedCount: number;
}
export interface BatchPromptNaming {
  readonly prefix: string;
  readonly suffix: string;
  readonly template: string;
  readonly start: number;
  readonly step: number;
  readonly padding: number;
}
export interface BatchPromptLayout {
  readonly direction: "rowFirst" | "columnFirst";
  /** Number of columns for either direction; column-first fills the calculated rows first. */
  readonly perRow: number;
  readonly horizontalSpacing: number;
  readonly verticalSpacing: number;
  readonly origin: CanvasPoint;
  readonly nodeSize: CanvasSize;
}
export interface BatchPromptReference {
  readonly id: string;
  readonly name: string;
  readonly version: CanvasAssetVersion;
  /** If present, the reference becomes an edge pinned to this existing node's version. */
  readonly sourceNodeId?: string;
}
export interface PreparedBatchPromptReference extends BatchPromptReference {
  readonly originalName: string;
}
export interface BatchPromptImportIssue {
  readonly code: string;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly entryId?: string;
  readonly referenceId?: string;
}
export interface BatchPromptReferencePreparation {
  readonly references: readonly PreparedBatchPromptReference[];
  readonly issues: readonly BatchPromptImportIssue[];
}
export interface BatchPromptReferenceMatch {
  readonly name: string;
  readonly referenceId: string;
  readonly start: number;
  readonly end: number;
  readonly label: string;
}
export interface BatchPromptReferenceMapping {
  readonly referenceId: string;
  readonly name: string;
  readonly versionId: string;
  readonly kind: CanvasMediaKind;
  readonly role: Extract<CanvasInputRole, "referenceImage" | "referenceVideo" | "referenceAudio">;
  readonly order: number;
  readonly label: string;
}
export interface BatchPromptImportOptions {
  readonly kind: "image" | "video";
  /** Pass the selected model, or the node's actual default model when the catalog is unavailable. */
  readonly modelId: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly headPrompt?: string;
  readonly tailPrompt?: string;
  readonly naming?: Partial<BatchPromptNaming>;
  readonly layout?: Partial<BatchPromptLayout>;
  readonly references?: readonly BatchPromptReference[];
  /** All chosen materials are references by default; mentioned attaches only explicit @ references. */
  readonly referenceSelection?: "all" | "mentioned";
  /** Catalog order, used when image aspectRatio=auto has no reference in this particular node. */
  readonly fixedAspectRatios?: readonly string[];
  readonly idPrefix?: string;
}
export interface BatchPromptImportPreviewEntry {
  readonly id: string;
  readonly sourceIndex: number;
  readonly text: string;
  readonly name: string;
  readonly manualName: boolean;
  readonly prompt: string;
  readonly promptParts: { readonly head: string; readonly body: string; readonly tail: string };
  readonly position: CanvasPoint;
  readonly mode: CanvasGenerationMode;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly referenceMappings: readonly BatchPromptReferenceMapping[];
  readonly referenceMatches: readonly BatchPromptReferenceMatch[];
  readonly mappingText: string;
  readonly unmatchedNames: readonly string[];
  readonly unmatchedCount: number;
}
export interface BatchPromptImportPreview {
  readonly entries: readonly BatchPromptImportPreviewEntry[];
  readonly references: readonly PreparedBatchPromptReference[];
  readonly issues: readonly BatchPromptImportIssue[];
  readonly totalCount: number;
  readonly omittedCount: number;
  readonly unmatchedNames: readonly string[];
  readonly unmatchedCount: number;
  readonly canImport: boolean;
}
export interface BatchPromptImportPlan {
  readonly canvasId: string;
  readonly projectId: string;
  readonly baseRevision: number;
  readonly preview: BatchPromptImportPreview;
  readonly nodes: readonly (CanvasImageGenNode | CanvasVideoGenNode)[];
  readonly referenceNodes: readonly CanvasAssetNode[];
  readonly edges: readonly CanvasEdge[];
  /** This plan contains only document edits and never a submission or media-job request. */
  readonly submitsJobs: false;
}

export const DEFAULT_BATCH_PROMPT_NAMING: Readonly<BatchPromptNaming> = Object.freeze({
  prefix: "镜头", suffix: "", template: "{prefix}{index}{suffix}", start: 1, step: 1, padding: 2,
});
export const DEFAULT_BATCH_PROMPT_LAYOUT: Readonly<BatchPromptLayout> = Object.freeze({
  direction: "rowFirst", perRow: 5, horizontalSpacing: 120, verticalSpacing: 70,
  origin: Object.freeze({ x: 0, y: 0 }), nodeSize: Object.freeze({ width: 360, height: 280 }),
});

function clone<T>(value: T): T { return structuredClone(value); }
function integer(value: number, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new CanvasError("BATCH_OPTION", `${field} must be an integer from ${min} to ${max}`);
}
function requireRule(rule: BatchPromptSplitRule): void {
  if (!["paragraphs", "lines", "separator"].includes(rule.kind)) throw new CanvasError("BATCH_SPLIT_RULE", "Unknown prompt split rule");
  if (rule.kind === "separator" && !rule.separator.length) throw new CanvasError("BATCH_SEPARATOR", "A custom separator cannot be empty");
}
function requireState(state: BatchPromptImportState): void {
  if (state.entries.length > CANVAS_BATCH_MAX_NODES) throw new CanvasError("BATCH_NODE_LIMIT", `A batch accepts at most ${CANVAS_BATCH_MAX_NODES} generation nodes`);
  const ids = new Set<string>(), indices = new Set<number>();
  for (const entry of state.entries) {
    if (!entry.id || ids.has(entry.id) || !Number.isSafeInteger(entry.sourceIndex) || entry.sourceIndex < 0 || indices.has(entry.sourceIndex) || typeof entry.text !== "string" || !entry.text.trim()) {
      throw new CanvasError("BATCH_STATE", "Batch entries need unique identities, source indices and nonempty text");
    }
    ids.add(entry.id); indices.add(entry.sourceIndex);
  }
}
function namingOf(options: Partial<BatchPromptNaming> = {}): BatchPromptNaming {
  const result = { ...DEFAULT_BATCH_PROMPT_NAMING, ...options };
  integer(result.start, 0, 999999, "start"); integer(result.step, 1, 9999, "step"); integer(result.padding, 0, 8, "padding");
  for (const key of ["prefix", "suffix", "template"] as const) if (typeof result[key] !== "string") throw new CanvasError("BATCH_OPTION", `${key} must be text`);
  return result;
}
function layoutOf(options: Partial<BatchPromptLayout> = {}): BatchPromptLayout {
  const result = { ...DEFAULT_BATCH_PROMPT_LAYOUT, ...options };
  if (!["rowFirst", "columnFirst"].includes(result.direction)) throw new CanvasError("BATCH_OPTION", "Layout direction must be rowFirst or columnFirst");
  integer(result.perRow, 1, 20, "perRow");
  integer(result.horizontalSpacing, 0, 2000, "horizontalSpacing"); integer(result.verticalSpacing, 0, 2000, "verticalSpacing");
  if (!Number.isFinite(result.origin.x) || !Number.isFinite(result.origin.y)) throw new CanvasError("BATCH_OPTION", "Layout origin must contain finite coordinates");
  if (!Number.isFinite(result.nodeSize.width) || !Number.isFinite(result.nodeSize.height) || result.nodeSize.width <= 0 || result.nodeSize.height <= 0) throw new CanvasError("BATCH_OPTION", "Node dimensions must be positive and finite");
  return clone(result);
}

/** Blank lines separate paragraphs; normal line breaks inside a paragraph are retained. */
export function splitBatchPrompts(sourceText: string, rule: BatchPromptSplitRule = { kind: "paragraphs" }): BatchPromptSplitResult {
  requireRule(rule);
  const normalized = sourceText.replace(/\r\n?/g, "\n");
  const parts = rule.kind === "separator" ? normalized.split(rule.separator.replace(/\r\n?/g, "\n"))
    : rule.kind === "lines" ? normalized.split("\n") : normalized.split(/\n[^\S\n]*\n(?:[^\S\n]*\n)*/);
  const prompts = parts.map(part => part.trim()).filter(Boolean);
  return { prompts: prompts.slice(0, CANVAS_BATCH_MAX_NODES), totalCount: prompts.length, omittedCount: Math.max(0, prompts.length - CANVAS_BATCH_MAX_NODES) };
}
export function createBatchPromptImportState(sourceText: string, splitRule: BatchPromptSplitRule = { kind: "paragraphs" }): BatchPromptImportState {
  const split = splitBatchPrompts(sourceText, splitRule);
  return {
    sourceText, splitRule: clone(splitRule), totalCount: split.totalCount, omittedCount: split.omittedCount,
    entries: split.prompts.map((text, sourceIndex) => ({ id: `prompt-${sourceIndex + 1}`, sourceIndex, text })),
  };
}
/** A source/split change discards stale manual ordering and names instead of attaching them to new text. */
export function updateBatchPromptImportSource(state: BatchPromptImportState, sourceText: string, splitRule: BatchPromptSplitRule = state.splitRule): BatchPromptImportState {
  requireRule(splitRule);
  if (sourceText === state.sourceText && JSON.stringify(splitRule) === JSON.stringify(state.splitRule)) return clone(state);
  return createBatchPromptImportState(sourceText, splitRule);
}
export function orderBatchPromptImport(state: BatchPromptImportState, order: "reverse" | "restore" | readonly string[]): BatchPromptImportState {
  requireState(state);
  let entries: BatchPromptEntry[];
  if (order === "reverse") entries = [...state.entries].reverse();
  else if (order === "restore") entries = [...state.entries].sort((a, b) => a.sourceIndex - b.sourceIndex);
  else {
    const byId = new Map(state.entries.map(entry => [entry.id, entry]));
    if (order.length !== state.entries.length || new Set(order).size !== order.length || order.some(id => !byId.has(id))) throw new CanvasError("BATCH_ORDER", "An order must include every entry id exactly once");
    entries = order.map(id => byId.get(id)!);
  }
  return clone({ ...state, entries });
}
export function moveBatchPromptImportEntry(state: BatchPromptImportState, entryId: string, targetIndex: number): BatchPromptImportState {
  requireState(state);
  integer(targetIndex, 0, state.entries.length - 1, "targetIndex");
  const entries = [...state.entries], index = entries.findIndex(entry => entry.id === entryId);
  if (index < 0) throw new CanvasError("BATCH_ENTRY_MISSING", `Batch entry ${entryId} does not exist`);
  entries.splice(targetIndex, 0, ...entries.splice(index, 1));
  return clone({ ...state, entries });
}
/** Undefined restores the automatic name. An empty manual name is kept for preview validation. */
export function renameBatchPromptImportEntry(state: BatchPromptImportState, entryId: string, name: string | undefined): BatchPromptImportState {
  requireState(state);
  if (!state.entries.some(entry => entry.id === entryId)) throw new CanvasError("BATCH_ENTRY_MISSING", `Batch entry ${entryId} does not exist`);
  return clone({ ...state, entries: state.entries.map(entry => {
    if (entry.id !== entryId) return entry;
    const { manualName: _old, ...rest } = entry;
    return name === undefined ? rest : { ...rest, manualName: name };
  }) });
}
export function restoreBatchPromptImportNames(state: BatchPromptImportState, entryIds?: readonly string[]): BatchPromptImportState {
  requireState(state);
  if (entryIds?.some(id => !state.entries.some(entry => entry.id === id))) throw new CanvasError("BATCH_ENTRY_MISSING", "Cannot restore the name of a missing entry");
  const ids = entryIds ? new Set(entryIds) : undefined;
  return clone({ ...state, entries: state.entries.map(entry => {
    if (ids && !ids.has(entry.id)) return entry;
    const { manualName: _old, ...rest } = entry; return rest;
  }) });
}
export function formatBatchPromptName(bodyPrompt: string, position: number, options: Partial<BatchPromptNaming> = {}): string {
  const naming = namingOf(options);
  integer(position, 0, CANVAS_BATCH_MAX_NODES - 1, "position");
  const values = {
    prefix: naming.prefix, suffix: naming.suffix,
    index: String(naming.start + position * naming.step).padStart(naming.padding, "0"),
    prompt: Array.from(bodyPrompt).slice(0, 24).join(""),
  };
  return naming.template.replace(/\{(prefix|index|suffix|prompt)\}/g, (_all, key: keyof typeof values) => values[key]);
}
export function layoutBatchPromptPositions(count: number, options: Partial<BatchPromptLayout> = {}): readonly CanvasPoint[] {
  integer(count, 0, CANVAS_BATCH_MAX_NODES, "count");
  const layout = layoutOf(options), rows = Math.ceil(count / layout.perRow);
  return Array.from({ length: count }, (_unused, index) => {
    const column = layout.direction === "rowFirst" ? index % layout.perRow : Math.floor(index / rows);
    const row = layout.direction === "rowFirst" ? Math.floor(index / layout.perRow) : index % rows;
    return {
      x: layout.origin.x + column * (layout.nodeSize.width + layout.horizontalSpacing),
      y: layout.origin.y + row * (layout.nodeSize.height + layout.verticalSpacing),
    };
  });
}

/** Normalize chosen references once, skipping duplicates/unsupported kinds with explicit notices. */
export function prepareBatchPromptReferences(references: readonly BatchPromptReference[], kind: "image" | "video"): BatchPromptReferencePreparation {
  const accepted: PreparedBatchPromptReference[] = [], issues: BatchPromptImportIssue[] = [];
  const ids = new Set<string>(), assetIds = new Set<string>(), names = new Set<string>();
  const issue = (reference: BatchPromptReference, code: string, message: string, severity: "warning" | "error" = "warning"): void => { issues.push({ code, message, severity, referenceId: reference.id }); };
  for (const reference of references) {
    if (!reference.id.trim() || !reference.name.trim()) { issue(reference, "REFERENCE_NAME", "Reference ids and names cannot be empty", "error"); continue; }
    if (!["image", "video", "audio"].includes(reference.version.kind) || kind === "image" && reference.version.kind !== "image") { issue(reference, "REFERENCE_KIND_SKIPPED", "This media type cannot be used by this batch and was skipped"); continue; }
    if (ids.has(reference.id) || assetIds.has(reference.version.assetId)) { issue(reference, "REFERENCE_DUPLICATE_SKIPPED", "The same reference material cannot be added twice"); continue; }
    if (accepted.length >= CANVAS_BATCH_MAX_REFERENCES) { issue(reference, "REFERENCE_LIMIT_SKIPPED", `Only the first ${CANVAS_BATCH_MAX_REFERENCES} distinct references are kept`); continue; }
    ids.add(reference.id); assetIds.add(reference.version.assetId);
    const originalName = reference.name.trim(); let name = originalName, suffix = 2;
    while (names.has(name)) name = `${originalName} (${suffix++})`;
    names.add(name);
    if (name !== originalName) issue(reference, "REFERENCE_RENAMED", `Duplicate reference name renamed to ${name}`);
    if (reference.version.status === "uploading") issue(reference, "REFERENCE_UPLOADING", "Finish uploading or remove this material before importing", "error");
    else if (reference.version.status === "missing" || !reference.version.uri.trim()) issue(reference, "REFERENCE_UNAVAILABLE", "Replace or remove this unavailable reference before importing", "error");
    accepted.push({ ...clone(reference), name, originalName });
  }
  return { references: accepted, issues };
}
interface Mention { readonly name: string; readonly start: number; readonly end: number; readonly referenceId?: string }
function scanMentions(prompt: string, references: readonly PreparedBatchPromptReference[]): readonly Mention[] {
  const names = [...references].sort((a, b) => b.name.length - a.name.length), mentions: Mention[] = [];
  for (let cursor = 0; cursor < prompt.length; cursor++) {
    if (prompt[cursor] !== "@") continue;
    const reference = names.find(candidate => prompt.startsWith(candidate.name, cursor + 1));
    if (reference) {
      const end = cursor + 1 + reference.name.length;
      mentions.push({ name: reference.name, referenceId: reference.id, start: cursor, end }); cursor = end - 1;
    } else {
      const token = prompt.slice(cursor + 1).match(/^[^\s@,，.。!?！？;；:：()\[\]{}<>“”"'、]+/)?.[0];
      if (token) { const end = cursor + 1 + token.length; mentions.push({ name: token, start: cursor, end }); cursor = end - 1; }
    }
  }
  return mentions;
}
function mappingsOf(references: readonly PreparedBatchPromptReference[]): readonly BatchPromptReferenceMapping[] {
  const counts = { image: 0, video: 0, audio: 0 }, labels = { image: "图", video: "视频", audio: "音频" };
  const roles = { image: "referenceImage", video: "referenceVideo", audio: "referenceAudio" } as const;
  return references.map((reference, order) => ({
    referenceId: reference.id, name: reference.name, versionId: reference.version.id, kind: reference.version.kind,
    role: roles[reference.version.kind], order, label: `${labels[reference.version.kind]}${++counts[reference.version.kind]}`,
  }));
}

/** Preview uses the exact text, numbering, mode, parameters and references later added to the canvas. */
export function previewBatchPromptImport(state: BatchPromptImportState, options: BatchPromptImportOptions): BatchPromptImportPreview {
  requireState(state);
  const naming = namingOf(options.naming), positions = layoutBatchPromptPositions(state.entries.length, options.layout);
  if (!["image", "video"].includes(options.kind)) throw new CanvasError("BATCH_OPTION", "Batch kind must be image or video");
  if (options.referenceSelection !== undefined && !["all", "mentioned"].includes(options.referenceSelection)) throw new CanvasError("BATCH_OPTION", "Unknown reference selection rule");
  const prepared = prepareBatchPromptReferences(options.references ?? [], options.kind), issues = [...prepared.issues];
  if (!options.modelId.trim()) issues.push({ code: "MODEL_REQUIRED", severity: "error", message: "Choose a model or provide the node's default model" });
  if (!state.entries.length) issues.push({ code: "BATCH_EMPTY", severity: "error", message: "Enter at least one nonempty prompt" });
  if (state.omittedCount) issues.push({ code: "BATCH_TRUNCATED", severity: "warning", message: `Preview includes the first ${CANVAS_BATCH_MAX_NODES} prompts; import the remaining ${state.omittedCount} in another batch` });
  const head = (options.headPrompt ?? "").trim(), tail = (options.tailPrompt ?? "").trim();
  const entries = state.entries.map((entry, index): BatchPromptImportPreviewEntry => {
    const name = entry.manualName ?? formatBatchPromptName(entry.text, index, naming);
    if (!name.trim()) issues.push({ code: "NODE_NAME_EMPTY", severity: "error", entryId: entry.id, message: "Node names cannot be empty" });
    const originalPrompt = [head, entry.text, tail].filter(Boolean).join("\n\n"), mentions = scanMentions(originalPrompt, prepared.references);
    const mentioned = new Set(mentions.flatMap(mention => mention.referenceId ? [mention.referenceId] : []));
    const references = options.referenceSelection === "mentioned" ? prepared.references.filter(reference => mentioned.has(reference.id)) : prepared.references;
    const mappings = mappingsOf(references), byId = new Map(mappings.map(mapping => [mapping.referenceId, mapping]));
    const matches: BatchPromptReferenceMatch[] = [], unmatched = mentions.filter(mention => !mention.referenceId);
    let prompt = "", cursor = 0;
    for (const mention of mentions) {
      const mapping = mention.referenceId ? byId.get(mention.referenceId) : undefined;
      prompt += originalPrompt.slice(cursor, mention.start) + (mapping?.label ?? originalPrompt.slice(mention.start, mention.end));
      if (mapping) matches.push({ name: mention.name, referenceId: mapping.referenceId, start: mention.start, end: mention.end, label: mapping.label });
      cursor = mention.end;
    }
    prompt += originalPrompt.slice(cursor);
    if (unmatched.length) issues.push({ code: "REFERENCE_UNMATCHED", severity: "warning", entryId: entry.id, message: `Unmatched references kept as text: ${[...new Set(unmatched.map(mention => mention.name))].join(", ")}` });
    const parameters: Record<string, unknown> = clone(options.parameters ?? {});
    if (options.kind === "image" && parameters.aspectRatio === "auto" && references.length === 0) {
      const ratio = (options.fixedAspectRatios ?? ["1:1"]).find(candidate => candidate.trim() && candidate !== "auto");
      if (ratio) { parameters.aspectRatio = ratio; issues.push({ code: "ASPECT_RATIO_FIXED", severity: "warning", entryId: entry.id, message: `No reference is available for auto aspect ratio; using ${ratio}` }); }
      else issues.push({ code: "ASPECT_RATIO_REQUIRED", severity: "error", entryId: entry.id, message: "Provide a fixed aspect ratio when auto has no reference" });
    }
    return {
      id: entry.id, sourceIndex: entry.sourceIndex, text: entry.text, name, manualName: entry.manualName !== undefined,
      prompt, promptParts: { head, body: entry.text, tail }, position: positions[index],
      mode: options.kind === "image" ? references.length ? "imageToImage" : "textToImage" : references.length ? "referenceToVideo" : "textToVideo",
      parameters, referenceMappings: mappings, referenceMatches: matches,
      mappingText: mappings.map(mapping => `${mapping.label} = ${mapping.name}`).join("\n"),
      unmatchedNames: [...new Set(unmatched.map(mention => mention.name))], unmatchedCount: unmatched.length,
    };
  });
  return {
    entries, references: prepared.references, issues, totalCount: state.totalCount, omittedCount: state.omittedCount,
    unmatchedNames: [...new Set(entries.flatMap(entry => entry.unmatchedNames))],
    unmatchedCount: entries.reduce((sum, entry) => sum + entry.unmatchedCount, 0), canImport: !issues.some(issue => issue.severity === "error"),
  };
}

/** Compile a pure, reviewable document edit. External materials are real asset nodes; all edges pin versions. */
export function compileBatchPromptImport(canvas: CanvasDocument, state: BatchPromptImportState, options: BatchPromptImportOptions): BatchPromptImportPlan {
  const canvasIssues = validateCanvasDocument(canvas);
  if (canvasIssues.length) throw new CanvasError("INVALID_DOCUMENT", canvasIssues[0].message, canvasIssues);
  const preview = previewBatchPromptImport(state, options);
  if (!preview.canImport) throw new CanvasError("BATCH_IMPORT_INVALID", preview.issues.filter(issue => issue.severity === "error").map(issue => issue.message).join("; "));
  const layout = layoutOf(options.layout), prefix = options.idPrefix?.trim() || `batch-${canvas.revision + 1}`;
  const nodeIds = new Set(canvas.nodes.map(node => node.id)), edgeIds = new Set(canvas.edges.map(edge => edge.id));
  const allocate = (base: string, ids: Set<string>): string => { let id = base, suffix = 2; while (ids.has(id)) id = `${base}-${suffix++}`; ids.add(id); return id; };
  const usedReferenceIds = new Set(preview.entries.flatMap(entry => entry.referenceMappings.map(mapping => mapping.referenceId)));
  const referenceNodes: CanvasAssetNode[] = [], sources = new Map<string, string>();
  for (const reference of preview.references.filter(candidate => usedReferenceIds.has(candidate.id))) {
    if (reference.sourceNodeId) {
      const source = canvas.nodes.find(node => node.id === reference.sourceNodeId);
      const version = source && "versions" in source.payload ? source.payload.versions.find(candidate => candidate.id === reference.version.id) : undefined;
      if (!version || version.assetId !== reference.version.assetId || version.kind !== reference.version.kind || version.uri !== reference.version.uri) throw new CanvasError("BATCH_REFERENCE_SOURCE", `Reference ${reference.name} does not identify a matching version in its source node`);
      if (version.status === "uploading" || version.status === "missing") throw new CanvasError("BATCH_REFERENCE_SOURCE", `Reference ${reference.name}'s source version is unavailable`);
      sources.set(reference.id, reference.sourceNodeId);
    } else {
      const id = allocate(`${prefix}-reference-${referenceNodes.length + 1}`, nodeIds);
      referenceNodes.push({ id, kind: reference.version.kind, title: reference.name,
        position: { x: layout.origin.x - layout.nodeSize.width - layout.horizontalSpacing, y: layout.origin.y + referenceNodes.length * (layout.nodeSize.height + layout.verticalSpacing) },
        size: clone(layout.nodeSize), payload: { versions: [clone(reference.version)], currentVersionId: reference.version.id },
      });
      sources.set(reference.id, id);
    }
  }
  const nodes: (CanvasImageGenNode | CanvasVideoGenNode)[] = [], edges: CanvasEdge[] = [];
  for (const entry of preview.entries) {
    const id = allocate(`${prefix}-node-${entry.sourceIndex + 1}`, nodeIds), payload = {
      modelId: options.modelId.trim(), prompt: entry.prompt, parameters: clone(entry.parameters), versions: [],
    };
    const geometry = { id, title: entry.name, position: clone(entry.position), size: clone(layout.nodeSize) };
    if (options.kind === "image") nodes.push({ ...geometry, kind: "imageGen", payload: { ...payload, mode: entry.mode as "textToImage" | "imageToImage" } });
    else nodes.push({ ...geometry, kind: "videoGen", payload: { ...payload, mode: entry.mode as "textToVideo" | "referenceToVideo" } });
    for (const mapping of entry.referenceMappings) edges.push({
      id: allocate(`${id}-reference-${mapping.order + 1}`, edgeIds), sourceNodeId: sources.get(mapping.referenceId)!, sourcePort: "output",
      targetNodeId: id, targetPort: mapping.role, role: mapping.role, order: mapping.order, binding: "pinnedVersion", pinnedVersionId: mapping.versionId,
    });
  }
  const plan: BatchPromptImportPlan = { canvasId: canvas.id, projectId: canvas.projectId, baseRevision: canvas.revision, preview, nodes, referenceNodes, edges, submitsJobs: false };
  const issues = validateCanvasDocument({ ...canvas, nodes: [...canvas.nodes, ...referenceNodes, ...nodes], edges: [...canvas.edges, ...edges] });
  if (issues.length) throw new CanvasError("BATCH_IMPORT_INVALID", issues[0].message, issues);
  return clone(plan);
}

/** Append the entire batch atomically as one edit. Applying the same plan again fails its revision check. */
export function applyBatchPromptImport(canvas: CanvasDocument, plan: BatchPromptImportPlan, options: { readonly now?: string; readonly expectedRevision?: number } = {}): CanvasDocument {
  if (plan.canvasId !== canvas.id || plan.projectId !== canvas.projectId) throw new CanvasError("BATCH_CANVAS_MISMATCH", "Import plan belongs to a different canvas");
  if (canvas.revision !== plan.baseRevision || options.expectedRevision !== undefined && canvas.revision !== options.expectedRevision) throw new CanvasError("REVISION_CONFLICT", "Canvas changed after this batch was compiled; refresh the preview");
  if (plan.submitsJobs !== false || plan.nodes.some(node => node.payload.job || node.payload.jobs?.length || node.payload.versions.length)) throw new CanvasError("BATCH_JOB_STATE", "Batch import only accepts fresh generation nodes without job or result state");
  if (!plan.nodes.length || plan.nodes.length > CANVAS_BATCH_MAX_NODES) throw new CanvasError("BATCH_NODE_LIMIT", "Batch must contain from 1 to 200 generation nodes");
  const references = new Set(plan.edges.filter(edge => ["referenceImage", "referenceVideo", "referenceAudio"].includes(edge.role))
    .map(edge => JSON.stringify([edge.sourceNodeId, edge.pinnedVersionId])));
  if (plan.referenceNodes.length > CANVAS_BATCH_MAX_REFERENCES || references.size > CANVAS_BATCH_MAX_REFERENCES) throw new CanvasError("BATCH_REFERENCE_LIMIT", "A batch accepts at most 30 reference materials");
  const result: CanvasDocument = clone({ ...canvas,
    nodes: [...canvas.nodes, ...plan.referenceNodes, ...plan.nodes], edges: [...canvas.edges, ...plan.edges],
    revision: canvas.revision + 1, updatedAt: options.now ?? new Date().toISOString(),
  });
  const issues = validateCanvasDocument(result);
  if (issues.length) throw new CanvasError("BATCH_IMPORT_INVALID", issues[0].message, issues);
  return result;
}
