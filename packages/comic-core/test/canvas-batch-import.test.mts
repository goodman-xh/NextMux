import assert from "node:assert/strict";
import test from "node:test";
import { CanvasError, applyCanvasCommand, createCanvasDocument, resolveCanvasInputs, validateCanvasDocument } from "../lib/canvas.js";
import type { CanvasAssetVersion, CanvasDocument, CanvasNode } from "../lib/canvas.js";
import {
  CANVAS_BATCH_MAX_NODES, CANVAS_BATCH_MAX_REFERENCES, applyBatchPromptImport, compileBatchPromptImport,
  createBatchPromptImportState, formatBatchPromptName, layoutBatchPromptPositions, moveBatchPromptImportEntry,
  orderBatchPromptImport, prepareBatchPromptReferences, previewBatchPromptImport, renameBatchPromptImportEntry,
  restoreBatchPromptImportNames, splitBatchPrompts, updateBatchPromptImportSource,
} from "../lib/canvas-batch-import.js";
import type { BatchPromptImportOptions, BatchPromptReference } from "../lib/canvas-batch-import.js";

const now = "2026-09-30T12:00:00.000Z";
function version(id: string, kind: "image" | "video" | "audio" = "image", extra: Partial<CanvasAssetVersion> = {}): CanvasAssetVersion {
  return { id, assetId: `asset-${id}`, kind, uri: `nextmux.media/${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`, createdAt: now, metadata: kind === "audio" ? { durationMs: 1500 } : { width: 640, height: 360, ...(kind === "video" ? { durationMs: 1500 } : {}) }, ...extra };
}
function reference(id: string, name: string = id, kind: "image" | "video" | "audio" = "image"): BatchPromptReference {
  return { id, name, version: version(id, kind) };
}
function canvas(nodes: readonly CanvasNode[] = []): CanvasDocument {
  return { ...createCanvasDocument({ id: "canvas", projectId: "project", now }), nodes };
}
const imageOptions: BatchPromptImportOptions = { kind: "image", modelId: "image-model", parameters: { resolution: "2K", quality: "high", count: 2, aspectRatio: "16:9" } };
const codes = (issues: readonly { code: string }[]): string[] => issues.map(issue => issue.code);

test("split modes preserve paragraph lines and use a literal separator, with exactly the first 200 previews", () => {
  const text = "\r\n 第一行\r\n段内第二行\r\n \t\r\n\r\n 第二段\r\n\u3000\r\n第三段 \r\n";
  assert.deepEqual(splitBatchPrompts(text).prompts, ["第一行\n段内第二行", "第二段", "第三段"]);
  assert.deepEqual(splitBatchPrompts(text, { kind: "lines" }).prompts, ["第一行", "段内第二行", "第二段", "第三段"]);
  assert.deepEqual(splitBatchPrompts(" 一.* 二.* .*三.*", { kind: "separator", separator: ".*" }).prompts, ["一", "二", "三"]);
  assert.throws(() => splitBatchPrompts("a", { kind: "separator", separator: "" }), (error: unknown) => error instanceof CanvasError && error.code === "BATCH_SEPARATOR");
  const many = splitBatchPrompts(Array.from({ length: 205 }, (_, index) => `提示${index}`).join("\n"), { kind: "lines" });
  assert.equal(many.prompts.length, CANVAS_BATCH_MAX_NODES);
  assert.equal(many.prompts.at(-1), "提示199");
  assert.equal(many.totalCount, 205);
  assert.equal(many.omittedCount, 5);
  const preview = previewBatchPromptImport(createBatchPromptImportState(Array.from({ length: 201 }, (_, index) => String(index)).join("\n"), { kind: "lines" }), imageOptions);
  assert.equal(preview.canImport, true);
  assert.ok(codes(preview.issues).includes("BATCH_TRUNCATED"));
});

test("manual names travel through reverse, restore, drag and move; source or split changes clear stale order and names", () => {
  let state = createBatchPromptImportState("甲\n乙\n丙", { kind: "lines" });
  state = renameBatchPromptImportEntry(state, "prompt-2", "专用名称");
  const original = structuredClone(state);
  state = orderBatchPromptImport(state, "reverse");
  assert.deepEqual(state.entries.map(entry => entry.text), ["丙", "乙", "甲"]);
  assert.equal(state.entries[1].manualName, "专用名称");
  state = orderBatchPromptImport(state, ["prompt-2", "prompt-3", "prompt-1"]);
  assert.equal(state.entries[0].manualName, "专用名称");
  state = moveBatchPromptImportEntry(state, "prompt-2", 2);
  assert.equal(state.entries[2].manualName, "专用名称");
  assert.deepEqual(orderBatchPromptImport(state, "restore"), original);
  assert.equal(restoreBatchPromptImportNames(state, ["prompt-2"]).entries[2].manualName, undefined);
  assert.equal(renameBatchPromptImportEntry(state, "prompt-2", undefined).entries[2].manualName, undefined);
  assert.deepEqual(restoreBatchPromptImportNames(state).entries.map(entry => entry.manualName), [undefined, undefined, undefined]);
  assert.deepEqual(updateBatchPromptImportSource(state, state.sourceText).entries, state.entries);
  const resplit = updateBatchPromptImportSource(state, state.sourceText, { kind: "separator", separator: "\n" });
  assert.deepEqual(resplit.entries.map(entry => entry.text), ["甲", "乙", "丙"]);
  assert.ok(resplit.entries.every(entry => entry.manualName === undefined));
  const edited = updateBatchPromptImportSource(state, "新的甲\n新的乙", { kind: "lines" });
  assert.deepEqual(edited.entries.map(entry => entry.text), ["新的甲", "新的乙"]);
  assert.throws(() => orderBatchPromptImport(state, ["prompt-1", "prompt-1", "prompt-3"]), /exactly once/);
  assert.throws(() => moveBatchPromptImportEntry(state, "missing", 0), /does not exist/);
  assert.throws(() => renameBatchPromptImportEntry(state, "missing", "name"), /does not exist/);
  assert.throws(() => restoreBatchPromptImportNames(state, ["missing"]), /missing entry/);
});

test("names use actual preview order, padding, step and 24 Unicode characters, and validate every numbering boundary", () => {
  const long = "😀".repeat(25);
  assert.equal(formatBatchPromptName(long, 1, { prefix: "P", suffix: "S", template: "{prefix}-{index}-{suffix}-{prompt}", start: 0, step: 3, padding: 4 }), `P-0003-S-${"😀".repeat(24)}`);
  assert.equal(formatBatchPromptName("内容", 0, { start: 0, padding: 0 }), "镜头0");
  assert.equal(formatBatchPromptName("内容", 1, { start: 999999, step: 9999, padding: 8 }), "镜头01009998");
  assert.equal(formatBatchPromptName("{index}正文", 0, { prefix: "{suffix}", template: "{prefix}{prompt}{index}" }), "{suffix}{index}正文01");
  for (const naming of [{ start: -1 }, { start: 1000000 }, { start: 1.5 }, { step: 0 }, { step: 10000 }, { padding: -1 }, { padding: 9 }]) assert.throws(() => formatBatchPromptName("正文", 0, naming), /must be an integer/);
  const reversed = orderBatchPromptImport(createBatchPromptImportState("甲\n乙", { kind: "lines" }), "reverse");
  const preview = previewBatchPromptImport(reversed, { ...imageOptions, naming: { template: "{prompt}-{index}", start: 10, step: 10 } });
  assert.deepEqual(preview.entries.map(entry => entry.name), ["乙-10", "甲-20"]);
  const empty = renameBatchPromptImportEntry(reversed, "prompt-1", "  ");
  assert.equal(previewBatchPromptImport(empty, imageOptions).canImport, false);
  assert.throws(() => compileBatchPromptImport(canvas(), empty, imageOptions), /names cannot be empty/);
  assert.equal(previewBatchPromptImport(reversed, { ...imageOptions, naming: { template: "" } }).canImport, false);
});

test("row-first and column-first share a per-row column limit and exact gaps at 1–20 and 0–2000 boundaries", () => {
  const geometry = { perRow: 2, horizontalSpacing: 10, verticalSpacing: 20, origin: { x: 50, y: 100 }, nodeSize: { width: 100, height: 80 } };
  assert.deepEqual(layoutBatchPromptPositions(5, geometry), [
    { x: 50, y: 100 }, { x: 160, y: 100 }, { x: 50, y: 200 }, { x: 160, y: 200 }, { x: 50, y: 300 },
  ]);
  assert.deepEqual(layoutBatchPromptPositions(5, { ...geometry, direction: "columnFirst" }), [
    { x: 50, y: 100 }, { x: 50, y: 200 }, { x: 50, y: 300 }, { x: 160, y: 100 }, { x: 160, y: 200 },
  ]);
  assert.deepEqual(layoutBatchPromptPositions(0), []);
  assert.equal(layoutBatchPromptPositions(200, { perRow: 20, horizontalSpacing: 2000, verticalSpacing: 0 }).length, 200);
  assert.deepEqual(layoutBatchPromptPositions(2, { ...geometry, perRow: 1, horizontalSpacing: 0, verticalSpacing: 0 }), [{ x: 50, y: 100 }, { x: 50, y: 180 }]);
  for (const layout of [{ perRow: 0 }, { perRow: 21 }, { perRow: 2.5 }, { horizontalSpacing: -1 }, { verticalSpacing: 2001 }, { verticalSpacing: 1.2 }]) assert.throws(() => layoutBatchPromptPositions(1, layout), /must be an integer/);
  assert.throws(() => layoutBatchPromptPositions(201), /must be an integer/);
  assert.throws(() => layoutBatchPromptPositions(1, { nodeSize: { width: 0, height: 20 } }), /positive/);
});

test("references deduplicate materials, rename duplicate names, skip wrong kinds and keep the first 30", () => {
  const a = reference("a", "角色"), b = reference("b", "角色");
  const refs = prepareBatchPromptReferences([a, b, { ...a, id: "duplicate" }, reference("v", "视频", "video"), ...Array.from({ length: 31 }, (_, index) => reference(`extra-${index}`))], "image");
  assert.equal(refs.references.length, CANVAS_BATCH_MAX_REFERENCES);
  assert.deepEqual(refs.references.slice(0, 2).map(ref => ref.name), ["角色", "角色 (2)"]);
  assert.ok(codes(refs.issues).includes("REFERENCE_RENAMED"));
  assert.ok(codes(refs.issues).includes("REFERENCE_DUPLICATE_SKIPPED"));
  assert.ok(codes(refs.issues).includes("REFERENCE_KIND_SKIPPED"));
  assert.ok(codes(refs.issues).includes("REFERENCE_LIMIT_SKIPPED"));
  assert.equal(a.name, "角色");
  assert.equal(prepareBatchPromptReferences([reference("i"), reference("v", "video", "video"), reference("a", "audio", "audio")], "video").references.length, 3);
});

test("@ matching uses longest exact names without a space, rewrites known mentions, and retains unmatched text and names", () => {
  const refs = [reference("short", "林"), reference("long", "林澈"), reference("space", "Red coat")];
  const state = createBatchPromptImportState("@林澈转身，@林回头，@Red coat enters; @不存在，@不存在。");
  const preview = previewBatchPromptImport(state, { ...imageOptions, references: refs, headPrompt: "背景 @林澈", tailPrompt: "结束 @未知" });
  assert.equal(preview.canImport, true);
  assert.equal(preview.entries[0].prompt, "背景 图2\n\n图2转身，图1回头，图3 enters; @不存在，@不存在。\n\n结束 @未知");
  assert.equal(preview.entries[0].mappingText, "图1 = 林\n图2 = 林澈\n图3 = Red coat");
  assert.equal(preview.entries[0].referenceMatches.length, 4);
  assert.equal(preview.unmatchedCount, 3);
  assert.deepEqual(preview.unmatchedNames, ["不存在", "未知"]);
  assert.ok(codes(preview.issues).includes("REFERENCE_UNMATCHED"));
  assert.deepEqual(preview.entries[0].promptParts, { head: "背景 @林澈", body: state.entries[0].text, tail: "结束 @未知" });
  const mentioned = previewBatchPromptImport(createBatchPromptImportState("@林澈转身"), { ...imageOptions, references: refs, referenceSelection: "mentioned" });
  assert.equal(mentioned.entries[0].prompt, "图1转身");
  assert.deepEqual(mentioned.entries[0].referenceMappings.map(mapping => mapping.referenceId), ["long"]);
});

test("uploading and missing references block confirmation, while unmatched names and unsupported materials permit import", () => {
  const state = createBatchPromptImportState("测试 @unmatched");
  const uploading = { ...reference("upload"), version: version("upload", "image", { status: "uploading", uri: "" }) };
  const waiting = previewBatchPromptImport(state, { ...imageOptions, references: [uploading] });
  assert.equal(waiting.canImport, false);
  assert.ok(codes(waiting.issues).includes("REFERENCE_UPLOADING"));
  assert.throws(() => compileBatchPromptImport(canvas(), state, { ...imageOptions, references: [uploading] }), /Finish uploading/);
  const missing = previewBatchPromptImport(state, { ...imageOptions, references: [{ ...reference("missing"), version: version("missing", "image", { status: "missing" }) }] });
  assert.equal(missing.canImport, false);
  assert.ok(codes(missing.issues).includes("REFERENCE_UNAVAILABLE"));
  assert.equal(previewBatchPromptImport(state, { ...imageOptions, references: [reference("v", "视频", "video")] }).canImport, true);
  assert.equal(previewBatchPromptImport(state, { ...imageOptions, modelId: " " }).canImport, false);
  assert.equal(previewBatchPromptImport(createBatchPromptImportState(" \n "), imageOptions).canImport, false);
});

test("automatic image aspect ratios fall back per node only when there is no selected reference", () => {
  const parameters = { aspectRatio: "auto", count: 4 };
  const options = { ...imageOptions, parameters, fixedAspectRatios: ["auto", "3:2", "1:1"] };
  const preview = previewBatchPromptImport(createBatchPromptImportState("文本"), options);
  assert.equal(preview.entries[0].parameters.aspectRatio, "3:2");
  assert.equal(parameters.aspectRatio, "auto");
  assert.equal(preview.entries[0].parameters.count, 4);
  assert.equal(previewBatchPromptImport(createBatchPromptImportState("文本"), { ...options, references: [reference("i")] }).entries[0].parameters.aspectRatio, "auto");
  const perNode = previewBatchPromptImport(createBatchPromptImportState("@角色\n无引用", { kind: "lines" }), { ...options, referenceSelection: "mentioned", references: [reference("i", "角色")] });
  assert.deepEqual(perNode.entries.map(entry => [entry.mode, entry.parameters.aspectRatio]), [["imageToImage", "auto"], ["textToImage", "3:2"]]);
  assert.equal(previewBatchPromptImport(createBatchPromptImportState("文本"), { ...options, fixedAspectRatios: [] }).canImport, false);
});

test("plans produce real generation/asset nodes and ordered pinned edges, without results or jobs, and apply as one revision", () => {
  const state = createBatchPromptImportState("@人物抬头\n@人物转身", { kind: "lines" }), initial = canvas(), referenceInput = reference("person", "人物");
  const plan = compileBatchPromptImport(initial, state, { ...imageOptions, references: [referenceInput], idPrefix: "import" });
  assert.equal(plan.submitsJobs, false);
  assert.equal(plan.nodes.length, 2);
  assert.equal(plan.referenceNodes.length, 1);
  assert.equal(plan.edges.length, 2);
  assert.ok(plan.nodes.every(node => node.kind === "imageGen" && node.payload.mode === "imageToImage"));
  assert.ok(plan.nodes.every(node => node.payload.versions.length === 0 && !node.payload.job && !node.payload.jobs));
  assert.deepEqual(plan.nodes[0].payload.parameters, imageOptions.parameters);
  assert.ok(plan.edges.every(edge => edge.role === "referenceImage" && edge.binding === "pinnedVersion" && edge.pinnedVersionId === "person"));
  const imported = applyBatchPromptImport(initial, plan, { now, expectedRevision: 0 });
  assert.equal(imported.revision, 1);
  assert.equal(initial.revision, 0);
  assert.equal(initial.nodes.length, 0);
  assert.deepEqual(validateCanvasDocument(imported), []);
  assert.equal(resolveCanvasInputs(imported, plan.nodes[0].id).inputs[0].versionId, "person");
  assert.equal(resolveCanvasInputs(imported, plan.nodes[0].id).prompt, "图1抬头");
  assert.throws(() => applyBatchPromptImport(imported, plan), (error: unknown) => error instanceof CanvasError && error.code === "REVISION_CONFLICT");
  assert.throws(() => applyBatchPromptImport({ ...initial, id: "other" }, plan), /different canvas/);
  assert.throws(() => applyBatchPromptImport(initial, plan, { expectedRevision: 2 }), /changed/);
  const planAgain = compileBatchPromptImport(imported, state, { ...imageOptions, references: [referenceInput], idPrefix: "import" });
  assert.ok(planAgain.nodes.every(node => !imported.nodes.some(existing => existing.id === node.id)));
  assert.ok(planAgain.edges.every(edge => !imported.edges.some(existing => existing.id === edge.id)));
  (referenceInput.version as any).uri = "changed";
  assert.equal(plan.referenceNodes[0].payload.versions[0].uri, "nextmux.media/person.png");
});

test("current-canvas references reuse the source node and remain pinned after a source version changes", () => {
  const first = version("v1"), second = version("v2");
  const source: CanvasNode = { id: "source", title: "人物", kind: "image", position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, payload: { versions: [first, second], currentVersionId: "v1" } };
  const initial = canvas([source]), options = { ...imageOptions, references: [{ id: "person", name: "人物", version: first, sourceNodeId: "source" }] };
  const state = createBatchPromptImportState("@人物微笑"), plan = compileBatchPromptImport(initial, state, options);
  assert.equal(plan.referenceNodes.length, 0);
  assert.equal(plan.edges[0].sourceNodeId, "source");
  const imported = applyBatchPromptImport(initial, plan, { now });
  const selected = applyCanvasCommand(imported, { type: "node.selectVersion", nodeId: "source", versionId: "v2" }, { now });
  assert.equal(resolveCanvasInputs(selected, plan.nodes[0].id).inputs[0].versionId, "v1");
  assert.throws(() => compileBatchPromptImport(initial, state, { ...options, references: [{ ...options.references[0], sourceNodeId: "missing" }] }), /matching version/);
  assert.throws(() => compileBatchPromptImport(initial, state, { ...options, references: [{ ...options.references[0], version: { ...first, uri: "different" } }] }), /matching version/);
});

test("video imports accept typed image/video/audio references with one shared material node per reference", () => {
  const refs = [reference("picture", "人物"), reference("motion", "动作", "video"), reference("sound", "声音", "audio")];
  const options: BatchPromptImportOptions = { kind: "video", modelId: "video-model", parameters: { durationSeconds: 6, resolution: "1080p", aspectRatio: "16:9", generateAudio: true }, references: refs };
  const plan = compileBatchPromptImport(canvas(), createBatchPromptImportState("@人物按@动作运动，@声音同步\n第二段", { kind: "lines" }), options);
  assert.equal(plan.referenceNodes.length, 3);
  assert.equal(plan.nodes.length, 2);
  assert.equal(plan.edges.length, 6);
  assert.ok(plan.nodes.every(node => node.kind === "videoGen" && node.payload.mode === "referenceToVideo"));
  assert.equal(plan.nodes[0].payload.prompt, "图1按视频1运动，音频1同步");
  assert.deepEqual(plan.edges.slice(0, 3).map(edge => [edge.role, edge.order]), [["referenceImage", 0], ["referenceVideo", 1], ["referenceAudio", 2]]);
  const imported = applyBatchPromptImport(canvas(), plan, { now });
  assert.deepEqual(resolveCanvasInputs(imported, plan.nodes[0].id).inputs.map(input => input.kind), ["image", "video", "audio"]);
  assert.deepEqual(validateCanvasDocument(imported), []);
  const noReferences = compileBatchPromptImport(canvas(), createBatchPromptImportState("雨夜"), { ...options, references: [] });
  assert.equal(noReferences.nodes[0].payload.mode, "textToVideo");
  assert.deepEqual(noReferences.edges, []);
});

test("atomic application rejects injected job/results and invalid persistent asset data", () => {
  const initial = canvas(), state = createBatchPromptImportState("提示"), plan = compileBatchPromptImport(initial, state, imageOptions);
  const withJob = structuredClone(plan) as any;
  withJob.nodes[0].payload.job = { id: "paid-job", status: "running" };
  assert.throws(() => applyBatchPromptImport(initial, withJob), /without job or result state/);
  const withResult = structuredClone(plan) as any;
  withResult.nodes[0].payload.versions = [version("old-result")];
  assert.throws(() => applyBatchPromptImport(initial, withResult), /without job or result state/);
  assert.throws(() => compileBatchPromptImport(initial, state, { ...imageOptions, references: [{ ...reference("blob"), version: version("blob", "image", { uri: "blob:temporary" }) }] }), (error: unknown) => error instanceof CanvasError && error.issues.some(issue => issue.code === "TRANSIENT_URL"));
  assert.throws(() => compileBatchPromptImport(initial, state, { ...imageOptions, parameters: { apiKey: "do-not-store" } }), (error: unknown) => error instanceof CanvasError && error.issues.some(issue => issue.code === "SECRET"));
  assert.equal(initial.nodes.length, 0);
});

test("atomic application enforces the 30-reference limit on externally supplied plans", () => {
  const initial = canvas(), state = createBatchPromptImportState("提示");
  const plan = compileBatchPromptImport(initial, state, { ...imageOptions,
    references: Array.from({ length: CANVAS_BATCH_MAX_REFERENCES }, (_, index) => reference(`ref-${index}`)),
  });
  const extra = reference("overflow");
  const injected = { ...plan,
    referenceNodes: [...plan.referenceNodes, { id: "extra-reference", kind: "image" as const, title: extra.name,
      position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, payload: { versions: [extra.version], currentVersionId: extra.version.id } }],
    edges: [...plan.edges, { ...plan.edges[0], id: "extra-reference-edge", sourceNodeId: "extra-reference",
      order: CANVAS_BATCH_MAX_REFERENCES, pinnedVersionId: extra.version.id }],
  };
  assert.deepEqual(validateCanvasDocument({ ...initial, nodes: [...injected.referenceNodes, ...injected.nodes], edges: injected.edges }), []);
  assert.throws(() => applyBatchPromptImport(initial, injected, { now }),
    (error: unknown) => error instanceof CanvasError && error.code === "BATCH_REFERENCE_LIMIT");
  // Existing canvas sources are subject to the same limit, without adding reference nodes.
  const sources = [...injected.referenceNodes];
  assert.throws(() => applyBatchPromptImport(canvas(sources), { ...injected, referenceNodes: [] }, { now }),
    (error: unknown) => error instanceof CanvasError && error.code === "BATCH_REFERENCE_LIMIT");
  assert.equal(applyBatchPromptImport(initial, plan, { now }).nodes.length, CANVAS_BATCH_MAX_REFERENCES + 1);
  assert.equal(initial.nodes.length, 0);
});
