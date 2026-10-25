import assert from "node:assert/strict";
import test from "node:test";
import { enqueueRequest, mediaInput } from "../lib/index.js";

const input = {
  connectionId: "official-00000000-0000-4000-8000-000000000001", model: "sora-2",
  prompt: "A lone singer walks through the rain; no text on screen", durationSeconds: 12, width: 1920, height: 1080,
};

test("translated MV video input preserves its authored source prompt without replacing the provider prompt", () => {
  const source = "歌手独自走过雨中的街道，不要屏幕文字";
  const normalized = enqueueRequest({ kind: "video", idempotencyKey: "translated-mv-0001", projectId: "project-00000001",
    sceneId: "scene-00000001", shotId: "shot-00000001", cost: { billing: "provider_billed", description: "Offline test" },
    input: { ...input, musicMvSegmentId: "segment_1", musicMvSourcePrompt: source } });
  assert.equal((normalized.input as { musicMvSourcePrompt?: string }).musicMvSourcePrompt, source);
  assert.equal((normalized.input as { prompt: string }).prompt, input.prompt);
  assert.equal((mediaInput("video", { ...input, musicMvSegmentId: "segment_1" }) as { musicMvSourcePrompt?: string }).musicMvSourcePrompt, undefined);
});

test("MV source prompt requires segment ownership and remains bounded untrusted text", () => {
  assert.throws(() => mediaInput("video", { ...input, musicMvSourcePrompt: "original" }), /segment identity/);
  for (const source of ["x".repeat(6_001), "", "\0unsafe", 17, null]) {
    assert.throws(() => mediaInput("video", { ...input, musicMvSegmentId: "segment_1", musicMvSourcePrompt: source }));
  }
  assert.equal((mediaInput("video", { ...input, musicMvSegmentId: "segment_1", musicMvSourcePrompt: "字".repeat(6_000) }) as { musicMvSourcePrompt: string }).musicMvSourcePrompt.length, 6_000);
});
