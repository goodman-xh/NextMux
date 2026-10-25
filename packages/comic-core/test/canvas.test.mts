import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CanvasError, applyCanvasCommand, compileCanvasGenerationRequest, createCanvasDocument, createCanvasHistory, createGenerationSnapshot,
  executeCanvasCommand, expandCanvasGroup, isCanvasGenerationStale, migrateCanvasDocument,
  parseCanvasDocument, redoCanvasCommand, resolveCanvasInputs, serializeCanvasDocument,
  undoCanvasCommand, validateCanvasDocument, validateCanvasEdge,
} from "../lib/canvas.js";
import type { CanvasAssetVersion, CanvasDocument, CanvasEdge, CanvasGenerationMode, CanvasImageGenNode, CanvasNode, GenerationSnapshot, ResolvedCanvasInput } from "../lib/canvas.js";

const now = "2026-09-30T10:00:00.000Z";
const geometry = { position: { x: 100, y: 200 }, size: { width: 280, height: 280 } };
function version(id: string, kind: "image" | "video" | "audio" = "image", extra: Partial<CanvasAssetVersion> = {}): CanvasAssetVersion {
  return { id, assetId: `asset-${id}`, kind, uri: `nextmux.media/${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`, createdAt: now, metadata: { ...(kind !== "image" ? { durationMs: 2500 } : {}), width: 1920, height: 1080, mimeType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/wav" }, ...extra };
}
function image(id: string, versions: readonly CanvasAssetVersion[] = [version(`${id}-1`)], currentVersionId: string | undefined = versions[0]?.id): CanvasNode {
  return { id, kind: "image", title: id, ...geometry, payload: { versions, ...(currentVersionId ? { currentVersionId } : {}) } };
}
function generated(id: string, mode: "textToImage" | "imageToImage" = "imageToImage"): CanvasImageGenNode {
  return { id, kind: "imageGen", title: id, ...geometry, payload: { mode, modelId: "image-model", prompt: "人物转身", parameters: { aspectRatio: "16:9", resolution: "2K" }, versions: [] } };
}
function canvas(nodes: readonly CanvasNode[] = [], edges: readonly CanvasEdge[] = []): CanvasDocument {
  return { ...createCanvasDocument({ id: "canvas-1", projectId: "project-1", now }), nodes, edges };
}
function edge(id: string, source: string, target: string, role: CanvasEdge["role"] = "referenceImage", order = 0): CanvasEdge {
  return { id, sourceNodeId: source, sourcePort: "output", targetNodeId: target, targetPort: role, role, order, binding: "followCurrent" };
}
const codes = (issues: readonly { code: string }[]) => issues.map(issue => issue.code);
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value) ?? "null";

test("canvas JSON validates all node kinds, unit metadata and composition ranges", () => {
  const nodes: CanvasNode[] = [
    { id: "text", kind: "text", title: "文字", ...geometry, payload: { text: "雨夜" } },
    image("image"),
    { id: "video", kind: "video", title: "视频", ...geometry, payload: { versions: [version("video-1", "video")], currentVersionId: "video-1" } },
    { id: "audio", kind: "audio", title: "声音", ...geometry, payload: { versions: [version("audio-1", "audio")] } },
    generated("imageGen", "textToImage"),
    { id: "videoGen", kind: "videoGen", title: "生成视频", ...geometry, payload: { modelId: "video-model", mode: "textToVideo", prompt: "雨", parameters: { durationSeconds: 4 }, versions: [] } },
    { id: "frame", kind: "frameExtract", title: "取帧", ...geometry, payload: { selection: { kind: "time", timeMs: 500 }, versions: [] } },
    { id: "composition", kind: "composition", title: "合成", ...geometry, payload: { versions: [], parameters: {}, clips: [{ id: "clip", assetVersionId: "video-1", trackId: "picture", startMs: 0, inMs: 0, outMs: 2500, volume: 1, muted: false }] } },
    { id: "character", kind: "character", title: "角色", ...geometry, payload: { characterId: "character-1", versions: [] } },
    { id: "group-node", kind: "group", title: "场景", ...geometry, payload: { groupId: "group-1" } },
  ];
  const document = { ...canvas(nodes), groups: [{ id: "group-1", title: "场景", nodeIds: ["image", "video"] }] };
  assert.deepEqual(validateCanvasDocument(document), []);
  assert.deepEqual(parseCanvasDocument(serializeCanvasDocument(document)), document);
  assert.equal(nodes.length, 10);
  const bad = structuredClone(document) as any;
  bad.nodes[2].payload.versions[0].metadata.durationMs = -1000;
  bad.nodes[7].payload.clips[0].outMs = -1;
  assert.ok(codes(validateCanvasDocument(bad)).includes("METADATA_UNIT"));
  assert.ok(codes(validateCanvasDocument(bad)).includes("COMPOSITION_CLIP"));
});

test("canvas runtime rejects transient URLs, credentials, invalid JSON, modes, versions and unknown schema", () => {
  const doc = canvas([generated("image", "textToImage")]);
  const bad = structuredClone(doc) as any;
  bad.settings.apiKey = "private";
  bad.nodes[0].payload.parameters.preview = "blob:local-preview";
  bad.nodes[0].payload.mode = "textToVideo";
  bad.nodes[0].payload.currentVersionId = "missing";
  assert.deepEqual(new Set(codes(validateCanvasDocument(bad))), new Set(["SECRET", "TRANSIENT_URL", "GENERATION_MODE", "CURRENT_VERSION"]));
  assert.throws(() => migrateCanvasDocument({ ...doc, schemaVersion: 12 }), (error: unknown) => error instanceof CanvasError && error.code === "UNSUPPORTED_SCHEMA");
  assert.throws(() => parseCanvasDocument("not json"), (error: unknown) => error instanceof CanvasError && error.code === "INVALID_JSON");
  for (const value of [null, false, [], 0, {}, { ...doc, edges: [null, {}, []] }, { ...doc, nodes: [null] }]) assert.ok(validateCanvasDocument(value).length);
  const circular = { ...doc, settings: {} } as any;
  circular.settings.self = circular;
  assert.ok(codes(validateCanvasDocument(circular)).includes("NOT_JSON"));
});

test("canvas JSON rejects blob URL schemes in every letter case and URL-normalized ASCII whitespace", () => {
  for (const uri of ["blob:preview", "BLOB:preview", "BlOb:preview", " BLOB:preview", "\tblob:preview", "Bl\nOb:preview", "\u0000\u001fBl\tO\rb:\npreview\u0000"]) {
    assert.equal(new URL(uri).protocol, "blob:");
    const document = canvas([image("image", [version("image-1", "image", { uri })])]);
    assert.ok(codes(validateCanvasDocument(document)).includes("TRANSIENT_URL"), uri);
    assert.throws(() => serializeCanvasDocument(document), (error: unknown) => error instanceof CanvasError && error.code === "INVALID_DOCUMENT");
  }
  assert.deepEqual(validateCanvasDocument({ ...canvas(), settings: { notes: " b l o b: is a label", unicodeSpace: "\u00a0blob:label" } }), []);
});

test("canvas JSON rejects password, cookie and refresh token credential aliases", () => {
  for (const key of ["password", "PASSWORD", "cookie", "Cookie", "refreshToken", "refresh_token", "refresh-token"]) {
    const document = { ...canvas(), settings: { modelConnection: { [key]: "private-credential" } } };
    assert.ok(codes(validateCanvasDocument(document)).includes("SECRET"), key);
    assert.throws(() => serializeCanvasDocument(document), (error: unknown) => error instanceof CanvasError && error.code === "INVALID_DOCUMENT");
  }
  assert.deepEqual(validateCanvasDocument({ ...canvas(), settings: { cookiePolicy: "disabled", tokenBudget: 0 } }), []);
});

test("legacy migration preserves stable identities and converts explicitly named milliseconds", () => {
  const legacy: any = {
    schemaVersion: 0, id: "canvas-old", projectId: "project-1", name: "旧画布",
    nodes: [{ id: "gen", kind: "videoGen", data: { modelId: "video-model", mode: "textToVideo", prompt: "镜头", parameters: { durationMs: 6000 } } }],
  };
  const result = migrateCanvasDocument(legacy);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.title, "旧画布");
  assert.equal((result.nodes[0] as any).payload.parameters.durationSeconds, 6);
  assert.equal("durationMs" in (result.nodes[0] as any).payload.parameters, false);
  assert.equal(legacy.schemaVersion, 0);
  assert.equal(legacy.nodes[0].data.parameters.durationMs, 6000);
  assert.deepEqual(migrateCanvasDocument(result), result);
  const assets = migrateCanvasDocument({ ...legacy, nodes: [{ id: "asset", kind: "imageAsset", payload: { versions: [version("v")] } }] });
  assert.equal(assets.nodes[0].kind, "image");
});

test("edges enforce role and ports, self loops, dependency cycles and mode limits", () => {
  const a = generated("a"), b = generated("b");
  const doc = canvas([a, b, image("asset")]);
  assert.ok(codes(validateCanvasEdge(doc, edge("self", "a", "a"))).includes("SELF_LOOP"));
  const one = applyCanvasCommand(doc, { type: "edge.connect", edge: edge("ab", "a", "b") });
  assert.ok(codes(validateCanvasEdge(one, edge("ba", "b", "a"))).includes("CYCLE"));
  assert.throws(() => applyCanvasCommand(one, { type: "edge.connect", edge: edge("ba", "b", "a") }), /cycle/);
  assert.ok(codes(validateCanvasEdge(doc, { ...edge("bad", "asset", "b"), sourcePort: "video" })).includes("SOURCE_PORT"));
  assert.ok(codes(validateCanvasEdge(doc, { ...edge("bad", "asset", "b"), targetPort: "lastFrame" })).includes("TARGET_PORT"));
  assert.ok(codes(validateCanvasEdge(doc, edge("bad", "asset", "b", "referenceVideo"))).includes("ROLE_TYPE"));
  assert.ok(codes(validateCanvasEdge(doc, edge("bad", "asset", "b", "firstFrame"))).includes("MODE_ROLE"));
  assert.ok(codes(validateCanvasEdge(one, edge("second", "asset", "b"), { roleLimits: { referenceImage: 1 } })).includes("ROLE_LIMIT"));
  assert.ok(codes(validateCanvasEdge(one, edge("duplicate", "a", "b"))).includes("DUPLICATE_EDGE"));
  assert.ok(codes(validateCanvasEdge(doc, { ...edge("pin", "asset", "b"), binding: "pinnedVersion" })).includes("PIN_REQUIRED"));
  assert.ok(codes(validateCanvasEdge(doc, { ...edge("pin", "asset", "b"), pinnedVersionId: "asset-1" })).includes("PIN_CONFLICT"));
});

test("first and last slots are explicit and individually single input", () => {
  const video: CanvasNode = { id: "target", kind: "videoGen", title: "首尾", ...geometry, payload: { mode: "firstLastFrame", modelId: "video", prompt: "渐变", parameters: {}, versions: [] } };
  const nodes = [image("first"), image("last"), image("extra"), video];
  const doc = canvas(nodes, [edge("last", "last", "target", "lastFrame", 0), edge("first", "first", "target", "firstFrame", 1)]);
  assert.deepEqual(validateCanvasDocument(doc), []);
  const resolved = resolveCanvasInputs(doc, "target");
  assert.deepEqual(resolved.inputs.map(input => [input.role, input.versionId]), [["lastFrame", "last-1"], ["firstFrame", "first-1"]]);
  assert.ok(codes(validateCanvasEdge(doc, edge("extra", "extra", "target", "firstFrame"))).includes("ROLE_LIMIT"));
  const wrongMode = { ...doc, nodes: nodes.map(node => node.id === "target" ? { ...video, payload: { ...video.payload, mode: "imageToVideo" } } : node) } as CanvasDocument;
  assert.ok(codes(validateCanvasDocument(wrongMode)).includes("MODE_ROLE"));
});

test("resolver orders connected and imported assets and follows only unpinned versions", () => {
  const source = image("source", [version("v1"), version("v2")], "v2");
  const second = image("second");
  const target = { ...generated("gen"), payload: { ...generated("gen").payload, inputs: [{ id: "import-2", role: "referenceImage" as const, order: 2, version: version("d2") }, { id: "import-1", role: "referenceImage" as const, order: 1, version: version("d1") }] } };
  const doc = canvas([source, second, target], [edge("second", "second", "gen", "referenceImage", 1), edge("source", "source", "gen", "referenceImage", 0)]);
  assert.deepEqual(resolveCanvasInputs(doc, "gen").inputs.map(input => input.versionId), ["v2", "second-1", "d1", "d2"]);
  const pinned = { ...doc, edges: doc.edges.map(e => e.id === "source" ? { ...e, binding: "pinnedVersion" as const, pinnedVersionId: "v1" } : e) };
  assert.equal(resolveCanvasInputs(pinned, "gen").inputs[0].versionId, "v1");
  const changed = applyCanvasCommand(doc, { type: "node.selectVersion", nodeId: "source", versionId: "v1" });
  assert.equal(resolveCanvasInputs(changed, "gen").inputs[0].versionId, "v1");
  assert.equal(resolveCanvasInputs(pinned, "gen").inputs[0].versionId, "v1");
  assert.notEqual(resolveCanvasInputs(doc, "gen").inputFingerprint, resolveCanvasInputs(changed, "gen").inputFingerprint);
});

test("resolver distinguishes unavailable output, no selection, upload, missing version and missing file", () => {
  const target = generated("gen");
  const cases: [CanvasNode, CanvasEdge, string, ((uri: string) => boolean)?][] = [
    [image("source", []), edge("e", "source", "gen"), "noResult"],
    [image("source", [version("v")], undefined), edge("e", "source", "gen"), "noCurrentVersion"],
    [image("source", [version("v", "image", { status: "uploading", uri: "" })]), edge("e", "source", "gen"), "uploading"],
    [image("source", [version("v")]), { ...edge("e", "source", "gen"), binding: "pinnedVersion", pinnedVersionId: "lost" }, "versionMissing"],
    [image("source", [version("v", "image", { status: "missing", uri: "" })]), edge("e", "source", "gen"), "missingFile"],
    [image("source", [version("v")]), edge("e", "source", "gen"), "missingFile", () => false],
  ];
  for (const [source, incoming, expected, fileExists] of cases) {
    // Explicit undefined in this helper's default parameter would select the first version.
    const actualSource = expected === "noCurrentVersion" ? { ...source, payload: { versions: (source as any).payload.versions } } as CanvasNode : source;
    const doc = canvas([actualSource, target], [incoming]);
    assert.equal(resolveCanvasInputs(doc, "gen", { fileExists }).missing[0].reason, expected);
    assert.throws(() => createGenerationSnapshot(doc, "gen", { capabilityVersion: "1", fileExists }), (error: unknown) => error instanceof CanvasError && error.code === "MISSING_INPUT");
  }
});

test("resolver blocks absent mode requirements and keeps video/audio references typed", () => {
  const video: CanvasNode = { id: "target", kind: "videoGen", title: "参考", ...geometry, payload: { mode: "referenceToVideo", modelId: "video", prompt: "镜头", parameters: {}, versions: [] } };
  assert.equal(resolveCanvasInputs(canvas([video]), "target").missing[0].reason, "requiredInput");
  const v: CanvasNode = { id: "v", kind: "video", title: "视频", ...geometry, payload: { versions: [version("video-ref", "video")], currentVersionId: "video-ref" } };
  const a: CanvasNode = { id: "a", kind: "audio", title: "音频", ...geometry, payload: { versions: [version("audio-ref", "audio")], currentVersionId: "audio-ref" } };
  const doc = canvas([video, v, a], [edge("v", "v", "target", "referenceVideo"), edge("a", "a", "target", "referenceAudio", 1)]);
  assert.deepEqual(resolveCanvasInputs(doc, "target").inputs.map(input => [input.role, input.kind]), [["referenceVideo", "video"], ["referenceAudio", "audio"]]);
  assert.deepEqual(resolveCanvasInputs(doc, "target").missing, []);
  const empty = generated("empty", "textToImage");
  assert.equal(resolveCanvasInputs(canvas([{ ...empty, payload: { ...empty.payload, prompt: "" } }]), "empty").missing[0].role, "prompt");
});

test("group input expansion is stable, typed, nested and part of cycle and limit validation", () => {
  const group: CanvasNode = { id: "group", kind: "group", title: "素材", ...geometry, payload: { groupId: "g" } };
  const nested: CanvasNode = { id: "nested", kind: "group", title: "子组", ...geometry, payload: { groupId: "nested-g" } };
  const doc: CanvasDocument = { ...canvas([image("one"), image("two"), group, nested, generated("target")], [edge("group-edge", "group", "target")]), groups: [{ id: "g", title: "素材", nodeIds: ["two", "nested"] }, { id: "nested-g", title: "子组", nodeIds: ["one"], parentGroupId: "g" }] };
  assert.deepEqual(validateCanvasDocument(doc), []);
  assert.deepEqual(expandCanvasGroup(doc, "g").map(node => node.id), ["two", "one"]);
  assert.deepEqual(resolveCanvasInputs(doc, "target").inputs.map(input => input.versionId), ["two-1", "one-1"]);
  assert.ok(codes(validateCanvasEdge({ ...doc, edges: [] }, edge("g", "group", "target"), { roleLimits: { referenceImage: 1 } })).includes("ROLE_LIMIT"));
  assert.ok(codes(validateCanvasEdge({ ...doc, edges: [] }, { ...edge("g", "group", "target"), binding: "pinnedVersion", pinnedVersionId: "one-1" })).includes("PIN_GROUP"));
  const mixed = { ...doc, nodes: doc.nodes.map(node => node.id === "one" ? { id: "one", kind: "audio", title: "audio", ...geometry, payload: { versions: [] } } : node) } as CanvasDocument;
  assert.ok(codes(validateCanvasDocument(mixed)).includes("ROLE_TYPE"));
  const selfMember = { ...doc, groups: [{ ...doc.groups[0], nodeIds: ["target"] }, doc.groups[1]] };
  assert.ok(codes(validateCanvasDocument(selfMember)).includes("SELF_LOOP"));
  const cyclicGroups = { ...doc, groups: [{ ...doc.groups[0], parentGroupId: "nested-g" }, doc.groups[1]] };
  assert.ok(codes(validateCanvasDocument(cyclicGroups)).includes("GROUP_CYCLE"));
});

test("a character's first portrait consumes identity text; downstream requests attach selected visual per request", () => {
  const character: CanvasNode = { id: "identity", kind: "character", title: "李明", ...geometry, payload: { characterId: "character-1", description: "侦探", appearance: "短发，蓝色外套", versions: [] } };
  const portrait = generated("portrait", "textToImage");
  const first = canvas([character, portrait], [{ ...edge("identity", "identity", "portrait", "character"), sourcePort: "character" }]);
  const snapshot = createGenerationSnapshot(first, "portrait", { capabilityVersion: "1" });
  assert.equal(snapshot.resolvedInputs[0].kind, "character");
  assert.match(snapshot.prompt, /李明\n侦探\n短发/);
  const selected = { ...character, payload: { ...character.payload, versions: [version("portrait-1"), version("portrait-2")], currentVersionId: "portrait-2" } } as CanvasNode;
  const scene = canvas([selected, generated("shot")], [{ ...edge("reference", "identity", "shot"), sourcePort: "image" }]);
  const input = resolveCanvasInputs(scene, "shot").inputs[0];
  assert.equal(input.kind, "image");
  assert.equal(input.versionId, "portrait-2");
  assert.equal(input.characterId, "character-1");
});

test("snapshots are frozen independent values with a SHA-256 fingerprint and stale detection", () => {
  const source = image("source", [version("v1"), version("v2")], "v1");
  const text: CanvasNode = { id: "text", kind: "text", title: "文字", ...geometry, payload: { text: "在桥上" } };
  const doc = canvas([source, text, generated("gen")], [edge("image", "source", "gen"), edge("prompt", "text", "gen", "prompt", 1)]);
  const snapshot = createGenerationSnapshot(doc, "gen", { capabilityVersion: "cap-1" });
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.resolvedInputs[0].metadata));
  assert.equal(snapshot.prompt, "人物转身\n\n在桥上");
  assert.equal(snapshot.inputFingerprint.length, 64);
  const { inputFingerprint, ...data } = snapshot;
  assert.equal(inputFingerprint, createHash("sha256").update(canonical(data)).digest("hex"));
  assert.equal(isCanvasGenerationStale(doc, "gen", snapshot), false);
  const changed = applyCanvasCommand(doc, { type: "node.selectVersion", nodeId: "source", versionId: "v2" });
  assert.equal(snapshot.resolvedInputs[0].versionId, "v1");
  assert.equal(isCanvasGenerationStale(changed, "gen", snapshot), true);
  const moved = applyCanvasCommand(doc, { type: "node.move", nodeId: "source", position: { x: 800, y: 300 } });
  assert.equal(isCanvasGenerationStale(moved, "gen", snapshot), false);
  (doc.nodes.find(node => node.id === "gen") as any).payload.parameters.resolution = "4K";
  assert.equal(snapshot.parameters.resolution, "2K");
});

test("pure commands support geometry, versions, parameters, connections and strict revisions", () => {
  const initial = canvas([image("source"), generated("gen")]);
  let doc = applyCanvasCommand(initial, { type: "node.move", nodeId: "source", position: { x: 50, y: 60 } }, { expectedRevision: 0, now });
  doc = applyCanvasCommand(doc, { type: "node.resize", nodeId: "source", size: { width: 400, height: 200 } });
  doc = applyCanvasCommand(doc, { type: "edge.connect", edge: edge("e", "source", "gen") });
  doc = applyCanvasCommand(doc, { type: "node.setParameters", nodeId: "gen", parameters: { resolution: "4K" }, prompt: "新提示" });
  doc = applyCanvasCommand(doc, { type: "node.addVersion", nodeId: "gen", version: version("result"), select: true });
  assert.equal(doc.revision, 5);
  assert.equal((doc.nodes[1] as any).payload.currentVersionId, "result");
  assert.equal(initial.nodes[0].position.x, 100);
  assert.deepEqual((initial.nodes[1] as any).payload.versions, []);
  assert.throws(() => applyCanvasCommand(doc, { type: "node.move", nodeId: "source", position: { x: 1, y: 2 } }, { expectedRevision: 0 }), (error: unknown) => error instanceof CanvasError && error.code === "REVISION_CONFLICT");
  assert.throws(() => applyCanvasCommand(doc, { type: "node.selectVersion", nodeId: "gen", versionId: "missing" }), /does not exist/);
  const disconnected = applyCanvasCommand(doc, { type: "edge.disconnect", edgeId: "e" });
  assert.equal(disconnected.edges.length, 0);
  const removed = applyCanvasCommand(doc, { type: "node.delete", nodeIds: ["source"] });
  assert.equal(removed.edges.length, 0);
  assert.equal(removed.nodes.length, 1);
});

test("group moving carries descendants; resizing and ungrouping preserve world positions", () => {
  const group: CanvasNode = { id: "group", kind: "group", title: "组", ...geometry, payload: { groupId: "g" } };
  const initial = canvas([image("one"), image("two")]);
  const grouped = applyCanvasCommand(initial, { type: "group.create", group: { id: "g", title: "组", nodeIds: ["one", "two"] }, node: group });
  const moved = applyCanvasCommand(grouped, { type: "node.move", nodeId: "group", position: { x: 140, y: 250 } });
  assert.deepEqual(moved.nodes.find(node => node.id === "one")!.position, { x: 140, y: 250 });
  const resized = applyCanvasCommand(moved, { type: "node.resize", nodeId: "group", size: { width: 900, height: 900 } });
  assert.deepEqual(resized.nodes.find(node => node.id === "one")!.position, { x: 140, y: 250 });
  const ungrouped = applyCanvasCommand(resized, { type: "group.ungroup", groupId: "g" });
  assert.equal(ungrouped.groups.length, 0);
  assert.equal(ungrouped.nodes.length, 2);
  assert.deepEqual(ungrouped.nodes[0].position, { x: 140, y: 250 });
  const deleted = applyCanvasCommand(grouped, { type: "node.delete", nodeIds: ["group"] });
  assert.equal(deleted.groups.length, 0);
  assert.equal(deleted.nodes.length, 0);
});

test("undo and redo restore content with monotonic save revisions and branch after undo", () => {
  const initial = canvas([image("source")]);
  let history = createCanvasHistory(initial);
  history = executeCanvasCommand(history, { type: "node.move", nodeId: "source", position: { x: 20, y: 30 } });
  assert.equal(history.present.revision, 1);
  history = undoCanvasCommand(history);
  assert.equal(history.present.nodes[0].position.x, 100);
  assert.equal(history.present.revision, 2);
  history = redoCanvasCommand(history);
  assert.equal(history.present.nodes[0].position.x, 20);
  assert.equal(history.present.revision, 3);
  history = undoCanvasCommand(history);
  history = executeCanvasCommand(history, { type: "node.resize", nodeId: "source", size: { width: 100, height: 100 } });
  assert.equal(history.future.length, 0);
  assert.equal(history.present.revision, 5);
  assert.equal(redoCanvasCommand(history), history);
});

test("ungrouping preserves expanded edge input order and reparenting nests group membership", () => {
  const group: CanvasNode = { id: "group", kind: "group", title: "组", ...geometry, payload: { groupId: "g" } };
  const target = generated("target");
  const doc: CanvasDocument = { ...canvas([image("a"), image("b"), group, target], [edge("group-edge", "group", "target")]), groups: [{ id: "g", title: "组", nodeIds: ["b", "a"] }] };
  const before = resolveCanvasInputs(doc, "target");
  const ungrouped = applyCanvasCommand(doc, { type: "group.ungroup", groupId: "g" });
  assert.deepEqual(resolveCanvasInputs(ungrouped, "target").inputs.map(input => input.versionId), before.inputs.map(input => input.versionId));
  const parent: CanvasNode = { id: "parent", kind: "group", title: "父组", ...geometry, payload: { groupId: "parent-g" } };
  const nested = applyCanvasCommand(doc, { type: "group.create", group: { id: "parent-g", title: "父组", nodeIds: ["group"] }, node: parent });
  assert.equal(nested.groups.find(candidate => candidate.id === "g")?.parentGroupId, "parent-g");
  assert.deepEqual(expandCanvasGroup(nested, "parent-g").map(node => node.id), ["b", "a"]);
});

test("pinned edges reject unversioned text and identity inputs", () => {
  const text: CanvasNode = { id: "t", kind: "text", title: "文字", ...geometry, payload: { text: "词" } };
  const doc = canvas([text, generated("target", "textToImage")]);
  assert.ok(codes(validateCanvasEdge(doc, { ...edge("p", "t", "target", "prompt"), binding: "pinnedVersion", pinnedVersionId: "made-up" })).includes("PIN_UNSUPPORTED"));
});

test("generation request union enforces eight exclusive modes and required typed inputs", () => {
  const input = (role: ResolvedCanvasInput["role"], kind: "image" | "video" | "audio", order = 0): ResolvedCanvasInput => ({ role, kind, order, versionId: `version-${role}`, assetId: `asset-${role}`, uri: `nextmux.media/${role}.bin` });
  const snapshot = (mode: CanvasGenerationMode, resolvedInputs: readonly ResolvedCanvasInput[]): GenerationSnapshot => ({ mode, modelId: "model", capabilityVersion: "1", prompt: "动作", parameters: {}, resolvedInputs, inputFingerprint: "test" });
  for (const mode of ["textToImage", "textToVideo"] as const) assert.equal(compileCanvasGenerationRequest(snapshot(mode, [])).mode, mode);
  const first = input("firstFrame", "image"), last = input("lastFrame", "image", 1);
  const image = input("referenceImage", "image"), video = input("referenceVideo", "video"), audio = input("referenceAudio", "audio");
  const requests = [
    snapshot("imageToImage", [image]), snapshot("imageToVideo", [first]), snapshot("firstLastFrame", [last, first]),
    snapshot("referenceToVideo", [audio]), snapshot("videoEdit", [video, image]), snapshot("videoExtend", [video]),
  ];
  for (const value of requests) { const request = compileCanvasGenerationRequest(value); assert.equal(request.mode, value.mode); assert.ok(Object.isFrozen(request)); }
  const pair = compileCanvasGenerationRequest(snapshot("firstLastFrame", [last, first]));
  assert.equal(pair.mode === "firstLastFrame" && pair.firstFrame.versionId, "version-firstFrame");
  const edit = compileCanvasGenerationRequest(snapshot("videoEdit", [video, { ...video, versionId: "second-video", order: 1 }]));
  assert.equal(edit.mode === "videoEdit" && edit.sourceVideo.versionId, "version-referenceVideo");
  assert.equal(edit.mode === "videoEdit" && edit.references.videos[0].versionId, "second-video");
  for (const mode of ["imageToImage", "imageToVideo", "firstLastFrame", "referenceToVideo", "videoEdit", "videoExtend"] as const) assert.throws(() => compileCanvasGenerationRequest(snapshot(mode, [])), (error: unknown) => error instanceof CanvasError && error.code === "MISSING_INPUT");
  assert.equal(compileCanvasGenerationRequest(snapshot("textToVideo", [image])).mode, "textToVideo");
  assert.equal(compileCanvasGenerationRequest(snapshot("imageToVideo", [first, image])).mode, "imageToVideo");
  for (const mode of ["textToImage", "textToVideo", "imageToVideo", "firstLastFrame"] as const) {
    const frames = mode === "firstLastFrame" ? [first, last] : mode === "imageToVideo" ? [first] : [];
    const characterImage = { ...image, role: "character" as const, order: 3 };
    const compiled = compileCanvasGenerationRequest(snapshot(mode, [...frames, image, characterImage]));
    assert.deepEqual(compiled.referenceImages, [image, characterImage]);
  }
  assert.throws(() => compileCanvasGenerationRequest(snapshot("textToVideo", [video])), /kind and role/);
  assert.throws(() => compileCanvasGenerationRequest(snapshot("imageToVideo", [first, last])), /kind and role/);
  assert.throws(() => compileCanvasGenerationRequest(snapshot("imageToVideo", [input("firstFrame", "video")])), /kind and role/);
  assert.throws(() => compileCanvasGenerationRequest(snapshot("firstLastFrame", [first, first, last])), /each accept one/);
});
