import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSceneDocument, createSceneObject, normalizeScene, normalizeWorld, createSceneHistory, commitSceneHistory, undoSceneHistory, redoSceneHistory, groupSceneObjects, ungroupSceneObjects, copySceneObjects, deleteSceneObjects, sceneWorldMatrix, sceneEase, scenePlaybackFrame, sampleScene, captureSceneKeyframe, setSceneKeyframe, mirrorScenePosture, isProjectMediaUri } from "../lib/director-scene.js";
import { SCENE_POSES, SCENE_PROPS, SCENE_CAMERAS, SCENE_TEMPLATES, SCENE_BODY_TYPES, SCENE_JOINT_GROUPS, JOINT_RANGES, scenePosePosture, templateScene, sceneFromTemplate, createSceneCharacter, createSceneCrowd, sceneBodyDimensions, clampScenePosture } from "../lib/director-catalogue.js";
import { createCanvasDocument, validateCanvasDocument, validateCanvasEdge, resolveCanvasInputs, applyCanvasCommand } from "../lib/canvas.js";
import type { SceneDocument, SceneObject } from "../lib/director-scene.js";
import type { CanvasDocument, CanvasNode, CanvasAssetVersion, CanvasEdge } from "../lib/canvas.js";

const scene = (objects: readonly SceneObject[]): SceneDocument => normalizeScene({ ...createSceneDocument(), objects });
const closeMatrix = (a: readonly number[], b: readonly number[]) => a.forEach((value, i) => assert.ok(Math.abs(value - b[i]!) < 1e-7, `matrix[${i}]: ${value} != ${b[i]}`));
test("normalization fills defaults and rejects malformed transforms, IDs, parent graphs and keys", () => {
  assert.equal(normalizeScene({}).schemaVersion, 2);
  assert.equal(normalizeScene({}).duration, 120);
  const a = createSceneObject("prop", "a");
  for (const input of [null, [], { schemaVersion: 9 }, { objects: [a, a] }, { objects: [{ ...a, position: { x: Infinity, y: 0, z: 0 } }] }, { objects: [{ ...a, scale: { x: 1, y: NaN, z: 1 } }] }, { objects: [{ ...a, parentId: "missing" }] }, { objects: [{ ...a, kind: "group", parentId: "a" }] }, { objects: [createSceneObject("group", "g", { parentId: "h" }), createSceneObject("group", "h", { parentId: "g" })] }, { fps: 29 }, { fps: "24" }, { duration: 1.5 }, { keys: [{ id: "k", objectId: "none", frame: 0 }] }, { groundOpacity: -1 }, { objects: [{ ...a, modelUri: "data:model/gltf-binary;base64,AAAA" }] }]) assert.throws(() => normalizeScene(input));
  const b = createSceneObject("light", "zero", { intensity: 0, distance: 0, lookAt: { x: 0, y: 0, z: 0 } });
  const out = scene([b]).objects[0]!;
  assert.equal(out.intensity, 0); assert.equal(out.distance, 0); assert.deepEqual(out.lookAt, { x: 0, y: 0, z: 0 });
});
test("objects-only history is immutable, no-op-aware and bounded at 40", () => {
  let h = createSceneHistory([createSceneObject("prop", "a")]);
  for (let n = 1; n <= 50; n++) h = commitSceneHistory(h, [createSceneObject("prop", "a", { position: { x: n, y: 0, z: 0 } })]);
  assert.equal(h.past.length, 40);
  assert.equal(commitSceneHistory(h, h.present), h);
  const undone = undoSceneHistory(h); assert.equal(undone.present[0]!.position.x, 49);
  assert.equal(redoSceneHistory(undone).present[0]!.position.x, 50);
  assert.equal(commitSceneHistory(undone, []).future.length, 0);
  assert.equal("keys" in h, false);
});
test("group/ungroup preserve full matrices through nested rotated nonuniform parents", () => {
  const original = scene([createSceneObject("group", "parent", { position: { x: 2, y: 3, z: 4 }, rotation: { x: 20, y: 35, z: 5 }, scale: { x: 2, y: 3, z: 0.7 } }), createSceneObject("prop", "a", { parentId: "parent", position: { x: 2, y: 1, z: -2 }, rotation: { x: 30, y: 10, z: 45 } }), createSceneObject("prop", "b", { position: { x: -3, y: 0, z: 2 } })]);
  const worlds = new Map(original.objects.map(o => [o.id, sceneWorldMatrix(original.objects, o.id)]));
  const grouped = groupSceneObjects(original, ["parent", "a", "b"], "new-group");
  assert.equal(grouped.objects.find(o => o.id === "a")!.parentId, "parent");
  for (const id of ["parent", "a", "b"]) closeMatrix(sceneWorldMatrix(grouped.objects, id), worlds.get(id)!);
  const released = ungroupSceneObjects(grouped, ["new-group", "parent"]);
  for (const id of ["a", "b"]) closeMatrix(sceneWorldMatrix(released.objects, id), worlds.get(id)!);
  assert.ok(released.objects.find(o => o.id === "a")!.matrix, "Shear must retain an affine override");
});
test("reparent preserves camera orientation and light target coordinates", () => {
  const original = scene([createSceneObject("group", "g", { position: { x: 2, y: 3, z: 4 }, rotation: { x: 20, y: 35, z: 5 } }), createSceneObject("camera", "camera", { parentId: "g", position: { x: 0, y: 2, z: 3 }, lookAt: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 10 } }), createSceneObject("light", "light", { parentId: "g", lookAt: { x: 0, y: 0, z: 0 } })]);
  const world = sceneWorldMatrix(original.objects, "camera");
  const result = ungroupSceneObjects(original, ["g"]);
  closeMatrix(sceneWorldMatrix(result.objects, "camera"), world);
  assert.equal(result.objects.find(o => o.id === "camera")!.matrix, undefined, "A rigid camera transform should remain editable as lookAt plus rotation offsets");
  assert.deepEqual(result.objects.find(o => o.id === "light")!.lookAt, { x: 2, y: 3, z: 4 });
});
test("ungroup and detach retain affine transforms beneath a zero-scale ancestor", () => {
  const original = scene([createSceneObject("group", "zero", { position: { x: 5, y: 0, z: 0 }, scale: { x: 0, y: 0, z: 0 } }), createSceneObject("group", "inner", { parentId: "zero", position: { x: 2, y: 3, z: 4 } }), createSceneObject("prop", "child", { parentId: "inner", position: { x: 1, y: 0, z: 0 } }), createSceneObject("camera", "camera", { parentId: "inner", position: { x: 0, y: 2, z: 3 }, lookAt: { x: 0, y: 1, z: 0 } })]);
  const worlds = new Map(["child", "camera"].map(id => [id, sceneWorldMatrix(original.objects, id)]));
  const result = ungroupSceneObjects(original, ["inner"]);
  assert.deepEqual(result.objects.find(o => o.id === "child")!.position, { x: 3, y: 3, z: 4 });
  for (const id of ["child", "camera"]) closeMatrix(sceneWorldMatrix(result.objects, id), worlds.get(id)!);
  const detached = ungroupSceneObjects(result, ["child", "camera"]);
  for (const id of ["child", "camera"]) { assert.equal(detached.objects.find(o => o.id === id)!.parentId, undefined); closeMatrix(sceneWorldMatrix(detached.objects, id), worlds.get(id)!); }
});
test("copy remaps descendants and animated keys; delete clears the full subtree and keys", () => {
  let s = scene([createSceneObject("group", "g"), createSceneObject("prop", "a", { parentId: "g", position: { x: 1, y: 2, z: 3 } })]);
  s = setSceneKeyframe(s, captureSceneKeyframe(s.objects[1]!, 12, "key"));
  const copied = copySceneObjects(s, ["g", "a"], id => `copy-${id}`);
  assert.equal(copied.scene.objects.find(o => o.id === "copy-a")!.parentId, "copy-g");
  assert.equal(copied.scene.objects.find(o => o.id === "copy-a")!.position.x, 1);
  assert.equal(copied.scene.objects.find(o => o.id === "copy-g")!.position.x, 0.6);
  assert.equal(copied.scene.keys.find(k => k.id === "copy-key")!.objectId, "copy-a");
  assert.throws(() => copySceneObjects(s, ["g"], () => "duplicate"));
  const deleted = deleteSceneObjects(copied.scene, ["g"]);
  assert.deepEqual(deleted.objects.map(o => o.id), ["copy-g", "copy-a"]);
  assert.deepEqual(deleted.keys.map(k => k.id), ["copy-key"]);
});
test("all eight curves have defined endpoints and sampling interpolates posture, camera and transforms", () => {
  for (const c of ["linear", "custom", "montage", "hero", "bullet", "cut", "easeIn", "easeOut"] as const) {
    assert.equal(sceneEase(0, c), 0); assert.equal(sceneEase(1, c), 1);
    let previous = 0; for (let i = 0; i <= 100; i++) { const value = sceneEase(i / 100, c, 2); assert.ok(value >= previous && value <= 1); previous = value; }
  }
  assert.equal(sceneEase(0.5, "hero"), 0.5); assert.equal(sceneEase(0.5, "custom", 2), 0.25); assert.equal(sceneEase(0.49, "montage"), 0.375); assert.equal(sceneEase(0.99, "cut"), 0);
  assert.equal(sceneEase(0.5, "bullet"), 0.5); assert.equal(sceneEase(0.25, "easeIn"), 0.5); assert.equal(sceneEase(0.5, "easeOut"), 0.25);
  const a = createSceneObject("camera", "a", { fov: 20, posture: { head: { turn: 0 } } });
  const b = { ...a, position: { x: 10, y: 20, z: 30 }, fov: 100, lookAt: { x: 10, y: 5, z: 0 }, posture: { head: { turn: 60 } } };
  const s = { ...scene([a]), keys: [captureSceneKeyframe(a, 0, "start"), captureSceneKeyframe(b, 100, "end")] };
  const sampled = sampleScene(s, 50)[0]!;
  assert.equal(sampled.position.x, 5); assert.equal(sampled.fov, 60); assert.equal(sampled.lookAt!.x, 5); assert.equal(sampled.posture!.head!.turn, 30);
  assert.equal(sampleScene(s, -20)[0]!.position.x, 0); assert.equal(sampleScene(s, 200)[0]!.position.x, 10);
  const replaced = setSceneKeyframe(s, { ...s.keys[0]!, id: "new-start" }); assert.equal(replaced.keys.length, 2);
});
test("once, loop and pingpong use real duration boundaries", () => {
  assert.deepEqual(scenePlaybackFrame(120, 120, "once"), { frame: 120, finished: true });
  assert.deepEqual(scenePlaybackFrame(125, 120, "loop"), { frame: 5, finished: false });
  assert.deepEqual(scenePlaybackFrame(130, 120, "pingpong"), { frame: 110, finished: false });
  assert.deepEqual(scenePlaybackFrame(250, 120, "pingpong"), { frame: 10, finished: false });
});
test("§26 catalogues are complete, contain valid references and create all 20 templates", () => {
  const golden = JSON.parse(readFileSync(new URL("./fixtures/director-catalogue-spec26.json", import.meta.url), "utf8"));
  const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
  for (const [name, values] of Object.entries({ poses: SCENE_POSES, assets: SCENE_PROPS, cameras: SCENE_CAMERAS, scenes: SCENE_TEMPLATES, bodyTypes: SCENE_BODY_TYPES, jointDefs: SCENE_JOINT_GROUPS })) {
    assert.equal(values.length, golden[name].count); assert.equal(createHash("sha256").update(canonical(values)).digest("hex"), golden[name].sha256, `Exact §26 ${name} snapshot`);
  }
  assert.equal(SCENE_POSES.length, 28); assert.equal(SCENE_PROPS.length, 35); assert.equal(SCENE_CAMERAS.length, 16); assert.equal(SCENE_TEMPLATES.length, 20); assert.equal(SCENE_BODY_TYPES.length, 7);
  assert.deepEqual(SCENE_POSES.map(p => p.id), ["stand", "tpose", "walk", "run", "jump", "kick", "throw", "push", "sit", "squat", "kneel", "kneel2", "lie", "wave", "point", "hands_up", "celebrate", "bow", "present", "akimbo", "cross_arms", "think", "lean", "stretch", "phone", "photo", "fight", "dance"]);
  for (const collection of [SCENE_POSES, SCENE_PROPS, SCENE_CAMERAS, SCENE_TEMPLATES, SCENE_BODY_TYPES]) assert.equal(new Set(collection.map(i => i.id)).size, collection.length);
  for (const t of SCENE_TEMPLATES) { const created = templateScene(t.id); assert.equal(created.objects.length, t.characters.length + t.props.length + t.cameras.length); assert.equal(normalizeScene(created).keys.length, 0); }
  assert.deepEqual(SCENE_CAMERAS.find(c => c.id === "pov_eye")!.position, { x: 0, y: 1.6, z: 0 });
  assert.equal(JOINT_RANGES.l_elbow!.bend![1], 160); assert.equal(JOINT_RANGES.body!.bend![0], -45);
  assert.equal(clampScenePosture({ l_elbow: { bend: 200 } }).l_elbow!.bend, 160);
  assert.equal(scenePosePosture("lie").body!.bend, SCENE_POSES.find(p => p.id === "lie")!.posture.body!.bend, "Preset values must remain exact, even outside the manual slider range");
  for (const p of SCENE_POSES) assert.deepEqual(mirrorScenePosture(mirrorScenePosture(p.posture)), p.posture);
  const mirrored = mirrorScenePosture({ head: { turn: 15, tilt: 10 }, l_arm: { raise: 30 }, r_arm: { raise: 5 } });
  assert.equal(mirrored.head!.turn, -15); assert.equal(mirrored.r_arm!.raise, 30);
  assert.equal(createSceneCrowd(id => id).length, 15); assert.equal(sceneBodyDimensions("group5").count, 5);
  assert.deepEqual(createSceneCharacter("mirrored", "mannequin", "wave", { mirror: true }).posture, scenePosePosture("wave"));
  assert.deepEqual(sceneFromTemplate(SCENE_TEMPLATES[1]), templateScene(SCENE_TEMPLATES[1]!.id));
  assert.throws(() => sceneFromTemplate({ characters: [null] }));
  assert.throws(() => sceneFromTemplate({ characters: [{ offset: { x: Infinity, z: 0 }, pose: "stand", role: "a" }] }));
});
const now = "2026-10-01T10:00:00.000Z";
const version = (id: string, kind: "image" | "video"): CanvasAssetVersion => ({ id, assetId: id, kind, uri: `nextmux.media/${id}.${kind === "image" ? "png" : "mp4"}`, createdAt: now });
const geometry = { position: { x: 0, y: 0 }, size: { width: 320, height: 280 } };
test("canvas director/world nodes validate, save and output mixed image/video references", () => {
  const nodes: CanvasNode[] = [{ id: "stage", kind: "sceneComposer", title: "stage", ...geometry, payload: { scene: createSceneDocument(), versions: [version("photo", "image"), version("clip", "video")], currentVersionId: "photo" } }, { id: "world", kind: "world", title: "world", ...geometry, payload: { world: normalizeWorld({}), versions: [] } }, { id: "image-gen", kind: "imageGen", title: "generated", ...geometry, payload: { mode: "imageToImage", modelId: "model", prompt: "", parameters: {}, versions: [] } }, { id: "capture", kind: "image", title: "photo", ...geometry, payload: { versions: [version("captured", "image")] } }];
  let canvas: CanvasDocument = { ...createCanvasDocument({ id: "canvas", projectId: "project", now }), nodes };
  assert.deepEqual(validateCanvasDocument(canvas), []);
  const edge: CanvasEdge = { id: "reference", sourceNodeId: "stage", sourcePort: "output", targetNodeId: "image-gen", targetPort: "referenceImage", role: "referenceImage", order: 0, binding: "followCurrent" };
  assert.deepEqual(validateCanvasEdge(canvas, edge), []); canvas = { ...canvas, edges: [edge] };
  assert.equal(resolveCanvasInputs(canvas, "image-gen").inputs[0]!.versionId, "photo");
  const captureEdge: CanvasEdge = { ...edge, id: "capture-source", targetNodeId: "capture" }; assert.deepEqual(validateCanvasEdge(canvas, captureEdge), []);
  const updated = applyCanvasCommand(canvas, { type: "node.setScene", nodeId: "stage", scene: { ...createSceneDocument(), duration: 240 } });
  assert.equal((updated.nodes[0] as any).payload.scene.duration, 240);
  const worldUpdated = applyCanvasCommand(updated, { type: "node.setWorld", nodeId: "world", world: normalizeWorld({ kind: "model", uri: "nextmux.media/world.glb", format: "glb" }) });
  assert.equal((worldUpdated.nodes[1] as any).payload.world.uri, "nextmux.media/world.glb");
  const overlay = normalizeWorld({ kind: "panorama", uri: "nextmux.media/sky.png", scene: templateScene("talking_head") });
  assert.equal(overlay.scene!.objects.length, templateScene("talking_head").objects.length);
  const videoCanvas = applyCanvasCommand(canvas, { type: "node.selectVersion", nodeId: "stage", versionId: "clip" });
  assert.equal(resolveCanvasInputs(videoCanvas, "image-gen").missing[0]!.reason, "incompatibleType");
  const bad = structuredClone(canvas) as any; bad.nodes[0].payload.scene.objects = [createSceneObject("prop", "a"), createSceneObject("prop", "a")]; assert.ok(validateCanvasDocument(bad).some(i => i.code === "SCENE_OBJECT_ID"));
  bad.nodes[0].payload.scene = createSceneDocument(); bad.nodes[0].payload.versions[0].kind = "audio"; assert.ok(validateCanvasDocument(bad).some(i => i.code === "VERSION_KIND"));
});
test("world and model sources use durable project media, never traversal, transient or data URLs", () => {
  for (const uri of ["../world.glb", "/tmp/world.glb", "blob:tmp", "data:model/gltf-binary;base64,AA", "https://example.com/world.glb", "nextmux.media/%2e%2e/world.glb", "nextmux.media/%00evil.glb", "nextmux.media/evil%5cworld.glb"]) { assert.equal(isProjectMediaUri(uri), false, uri); assert.throws(() => normalizeWorld({ kind: "model", uri })); }
  assert.equal(isProjectMediaUri("nextmux.media/world.glb"), true);
  assert.equal(normalizeWorld({ kind: "splat", uri: "nextmux.media/world.spz", format: "spz" }).kind, "splat");
  assert.throws(() => normalizeWorld({ kind: "splat", uri: "nextmux.media/world.mp4", format: "glb" }));
});
test("mixed scene/world captures preserve pinned kinds while following image references can recover", () => {
  for (const kind of ["sceneComposer", "world"] as const) {
    const photo = version("photo", "image"), clip = version("clip", "video");
    const source: CanvasNode = kind === "sceneComposer"
      ? { id: "source", kind, title: kind, ...geometry, payload: { scene: createSceneDocument(), versions: [photo], currentVersionId: photo.id } }
      : { id: "source", kind, title: kind, ...geometry, payload: { world: normalizeWorld({}), versions: [photo], currentVersionId: photo.id } };
    const photoOutput: CanvasNode = { id: "photo-output", kind: "image", title: "photo", ...geometry, payload: { versions: [photo], currentVersionId: photo.id } };
    const gen: CanvasNode = { id: "gen", kind: "imageGen", title: "gen", ...geometry, payload: { mode: "imageToImage", modelId: "model", prompt: "reference", parameters: {}, versions: [] } };
    const captureEdge: CanvasEdge = { id: "photo-edge", sourceNodeId: "source", sourcePort: "output", targetNodeId: photoOutput.id, targetPort: "referenceImage", role: "referenceImage", order: 0, binding: "pinnedVersion", pinnedVersionId: photo.id };
    const following: CanvasEdge = { ...captureEdge, id: "follow", targetNodeId: gen.id, binding: "followCurrent", pinnedVersionId: undefined };
    let doc: CanvasDocument = { ...createCanvasDocument({ id: "canvas", projectId: "project", now }), nodes: [source, photoOutput, gen], edges: [captureEdge, following] };
    assert.deepEqual(validateCanvasDocument(doc), []);
    doc = applyCanvasCommand(doc, { type: "node.addVersion", nodeId: source.id, version: clip, select: true });
    doc = applyCanvasCommand(doc, { type: "node.add", node: { id: "clip-output", kind: "video", title: "clip", ...geometry, payload: { versions: [clip], currentVersionId: clip.id } } });
    const clipEdge: CanvasEdge = { ...captureEdge, id: "clip-edge", targetNodeId: "clip-output", targetPort: "referenceVideo", role: "referenceVideo", pinnedVersionId: clip.id };
    doc = applyCanvasCommand(doc, { type: "edge.connect", edge: clipEdge });
    assert.deepEqual(validateCanvasDocument(doc), [], `${kind}: selecting video keeps the graph valid`);
    assert.equal(resolveCanvasInputs(doc, photoOutput.id).inputs[0]!.versionId, photo.id);
    assert.equal(resolveCanvasInputs(doc, "clip-output").inputs[0]!.versionId, clip.id);
    assert.ok(resolveCanvasInputs(doc, gen.id).missing.some(m => m.reason === "incompatibleType" && m.versionId === clip.id));
    assert.equal(doc.edges.find(e => e.id === following.id)!.binding, "followCurrent");
    assert.ok(validateCanvasEdge(doc, { ...following, binding: "pinnedVersion", pinnedVersionId: clip.id }).some(i => i.code === "ROLE_TYPE"));
    assert.ok(validateCanvasEdge(doc, { ...captureEdge, sourcePort: "video" }).some(i => i.code === "SOURCE_PORT"));
    doc = applyCanvasCommand(doc, { type: "node.selectVersion", nodeId: source.id, versionId: photo.id });
    assert.deepEqual(validateCanvasDocument(doc), []);
    assert.equal(resolveCanvasInputs(doc, gen.id).inputs[0]!.versionId, photo.id);
    assert.equal(resolveCanvasInputs(doc, "clip-output").inputs[0]!.versionId, clip.id);
  }
});
