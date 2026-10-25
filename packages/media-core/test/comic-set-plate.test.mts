import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { enqueueRequest, mediaInput, MediaJobStore } from "../lib/index.js";

const input = {
  connectionId: "official-00000000-0000-4000-8000-000000000001", model: "mock-image",
  prompt: "Empty station set, blue and amber light, no people", width: 1920, height: 1080,
};

test("set plate identity survives image normalization and restart so completion can attach the scene reference", async t => {
  const request = { kind: "image" as const, idempotencyKey: "scene-set-plate-0001",
    projectId: "project-00000001", sceneId: "scene-00000001", shotId: "shot-00000001",
    input: { ...input, comicSetPlate: true, characterReferenceUris: ["nextmux.media/style.png"] },
    cost: { billing: "free" as const, description: "Mock only" } };
  const normalized = enqueueRequest(request);
  assert.equal((normalized.input as { comicSetPlate?: boolean }).comicSetPlate, true);
  assert.equal((mediaInput("image", input) as { comicSetPlate?: boolean }).comicSetPlate, undefined);
  assert.equal((mediaInput("image", { ...input, comicSetPlate: false }) as { comicSetPlate?: boolean }).comicSetPlate, undefined);
  assert.equal((mediaInput("image", { ...input, comicSetPlate: "true" }) as { comicSetPlate?: boolean }).comicSetPlate, undefined,
    "untyped truthy values must not cause a picture to replace a scene reference");
  const root = await mkdtemp(join(tmpdir(), "comic-set-plate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await MediaJobStore.create({ root });
  const first = await store.enqueue(request);
  const reopened = await MediaJobStore.create({ root });
  const [saved] = await reopened.list();
  assert.equal(saved?.id, first.id);
  assert.equal(saved?.sceneId, request.sceneId);
  assert.equal((saved?.input as { comicSetPlate?: boolean }).comicSetPlate, true);
  assert.deepEqual((saved?.input as { characterReferenceUris?: readonly string[] }).characterReferenceUris, ["nextmux.media/style.png"]);
});
