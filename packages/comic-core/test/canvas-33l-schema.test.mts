import assert from "node:assert/strict";
import test from "node:test";
import { PIN_COLORS, applyCanvasCommand, createCanvasDocument, migrateCanvasDocument, parseCanvasDocument, serializeCanvasDocument, validateCanvasDocument } from "../lib/canvas.js";
import type { CanvasDocument, CanvasGroupNode, CanvasNode } from "../lib/canvas.js";

const now = "2026-09-30T10:00:00.000Z";
const later = "2026-09-30T11:00:00.000Z";
const node = (id: string): CanvasNode => ({ id, kind: "text", title: id, position: { x: 10, y: 20 }, size: { width: 100, height: 100 }, payload: { text: id } });
const board = (nodes: readonly CanvasNode[] = []): CanvasDocument => ({ ...createCanvasDocument({ id: "board", projectId: "project", now }), nodes });
const groupNode = (id: string, groupId: string): CanvasGroupNode => ({ ...node(id), kind: "group", payload: { groupId } });

test("every supported pin color persists on every node kind and malformed pins are refused", () => {
  const canvas = board([{ ...node("text"), pinnedColors: [...PIN_COLORS] }]);
  assert.deepEqual(parseCanvasDocument(serializeCanvasDocument(canvas)), canvas);
  assert.equal(PIN_COLORS.length, 12);
  for (const pinnedColors of [["red", "red"], ["amber"], "red", null, [3]]) {
    assert.ok(validateCanvasDocument({ ...canvas, nodes: [{ ...node("text"), pinnedColors }] }).some(issue => issue.code === "PIN_COLORS"));
  }
  const next = applyCanvasCommand(canvas, { type: "node.setPins", nodeId: "text", pinnedColors: ["blue", "grey"] }, { now: later });
  assert.deepEqual(next.nodes[0].pinnedColors, ["blue", "grey"]);
  assert.deepEqual(canvas.nodes[0].pinnedColors, PIN_COLORS);
  assert.deepEqual(applyCanvasCommand(next, { type: "node.setPins", nodeId: "text", pinnedColors: [] }).nodes[0].pinnedColors, []);
  assert.throws(() => applyCanvasCommand(next, { type: "node.setPins", nodeId: "text", pinnedColors: ["red", "red"] }), /unique supported colors/);
});

test("legacy migration deduplicates recognized pins and fills stable node creation timestamps", () => {
  const legacy = { ...board(), schemaVersion: 0, nodes: [{ ...node("text"), pinnedColors: ["red", "blue", "red", "unknown"] }] };
  const migrated = migrateCanvasDocument(legacy);
  assert.deepEqual(migrated.nodes[0].pinnedColors, ["red", "blue"]);
  assert.equal(migrated.nodes[0].createdAt, now);
  assert.deepEqual(legacy.nodes[0].pinnedColors, ["red", "blue", "red", "unknown"]);
  assert.equal(migrateCanvasDocument(board([node("old-v1")])).nodes[0].createdAt, undefined);
  assert.ok(validateCanvasDocument(board([{ ...node("invalid-time"), createdAt: "later" }])).some(issue => issue.path === "nodes.0.createdAt"));
});

test("node.add and group.create stamp missing creation time without overwriting supplied time", () => {
  const first = applyCanvasCommand(board(), { type: "node.add", node: node("first") }, { now: later });
  assert.equal(first.nodes[0].createdAt, later);
  const second = applyCanvasCommand(first, { type: "node.add", node: { ...node("second"), createdAt: now } }, { now: later });
  assert.equal(second.nodes[1].createdAt, now);
  const grouped = applyCanvasCommand(second, { type: "group.create", group: { id: "group", title: "Group", nodeIds: ["first"] }, node: groupNode("group-node", "group") }, { now: later });
  assert.equal(grouped.nodes.find(candidate => candidate.id === "group-node")?.createdAt, later);
});

test("group.setMembers moves members, reparents child groups and preserves world coordinates and wires", () => {
  const canvas: CanvasDocument = { ...board([node("a"), node("b"), groupNode("inner-node", "inner"), groupNode("left-node", "left"), groupNode("right-node", "right")]), groups: [
    { id: "inner", title: "Inner", nodeIds: ["b"], parentGroupId: "left" },
    { id: "left", title: "Left", nodeIds: ["a", "inner-node"] },
    { id: "right", title: "Right", nodeIds: [] },
  ] };
  const next = applyCanvasCommand(canvas, { type: "group.setMembers", groupId: "right", nodeIds: ["a", "inner-node"] });
  assert.deepEqual(next.groups.find(candidate => candidate.id === "left")?.nodeIds, []);
  assert.deepEqual(next.groups.find(candidate => candidate.id === "right")?.nodeIds, ["a", "inner-node"]);
  assert.equal(next.groups.find(candidate => candidate.id === "inner")?.parentGroupId, "right");
  assert.deepEqual(next.nodes, canvas.nodes);
  assert.deepEqual(next.edges, canvas.edges);
  const released = applyCanvasCommand(next, { type: "group.setMembers", groupId: "right", nodeIds: ["a"] });
  assert.equal(released.groups.find(candidate => candidate.id === "inner")?.parentGroupId, undefined);
  assert.throws(() => applyCanvasCommand(next, { type: "group.setMembers", groupId: "inner", nodeIds: ["right-node"] }), /cannot contain themselves/);
  assert.throws(() => applyCanvasCommand(next, { type: "group.setMembers", groupId: "right", nodeIds: ["missing"] }), /does not exist/);
});

test("group.setMembers releases parent-only child groups", () => {
  const canvas: CanvasDocument = { ...board([node("a"), groupNode("child-node", "child"), groupNode("parent-node", "parent")]), groups: [
    { id: "child", title: "Child", nodeIds: ["a"], parentGroupId: "parent" },
    { id: "parent", title: "Parent", nodeIds: [] },
  ] };
  const next = applyCanvasCommand(canvas, { type: "group.setMembers", groupId: "parent", nodeIds: [] });
  assert.equal(next.groups.find(candidate => candidate.id === "child")?.parentGroupId, undefined);
  assert.deepEqual(next.nodes, canvas.nodes);
});

test("group.setMembers preserves parent-only children with no group node", () => {
  const canvas: CanvasDocument = { ...board([node("a"), node("b"), groupNode("parent-node", "parent")]), groups: [
    { id: "child", title: "Child without card", nodeIds: ["a"], parentGroupId: "parent" },
    { id: "parent", title: "Parent", nodeIds: [] },
  ] };
  const next = applyCanvasCommand(canvas, { type: "group.setMembers", groupId: "parent", nodeIds: ["b"] });
  assert.equal(next.groups.find(candidate => candidate.id === "child")?.parentGroupId, "parent");
  assert.deepEqual(next.groups.find(candidate => candidate.id === "child")?.nodeIds, ["a"]);
});

test("media metadata scalar types are validated for results and direct input references", () => {
  const version = { id: "version", assetId: "asset", kind: "image" as const, uri: "media/image.png", createdAt: now };
  const image: CanvasNode = { ...node("image"), kind: "image", payload: { versions: [{ ...version, metadata: { mimeType: "image/png", sha256: "hash", hasAudio: false } }] } };
  assert.deepEqual(validateCanvasDocument(board([image])), []);
  for (const [key, invalid] of [["mimeType", 123], ["sha256", { taskId: "old-run" }], ["hasAudio", "yes"], ["mimeType", null], ["sha256", []], ["hasAudio", 0]] as const) {
    const media = { ...version, metadata: { [key]: invalid } };
    const result = { ...image, payload: { versions: [media] } };
    assert.ok(validateCanvasDocument(board([result as unknown as CanvasNode])).some(issue => issue.code === "METADATA_TYPE" && issue.path.endsWith(`metadata.${key}`)));
    const generated = { ...node("generated"), kind: "imageGen", payload: { mode: "imageToImage", modelId: "image-model", prompt: "paint", parameters: {}, versions: [], inputs: [{ id: "input", role: "referenceImage", order: 0, version: media }] } };
    assert.ok(validateCanvasDocument(board([generated as unknown as CanvasNode])).some(issue => issue.code === "METADATA_TYPE"));
  }
});
