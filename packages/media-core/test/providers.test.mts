import assert from "node:assert/strict";
import test from "node:test";

import { planMediaExecution } from "../lib/index.js";

const adapter = (capabilities: readonly any[]) => ({
  id: "provider-a",
  profile: {
    providerId: "provider-a", modelId: "video-a", protocol: "async-video",
    updatedAt: "2026-09-12T00:00:00.000Z", capabilities
  },
});

const base = {
  connectionId: "official-00000000-0000-0000-0000-000000000000",
  model: "video-a", prompt: "镜头", durationSeconds: 4, width: 1920, height: 1080,
};

test("media planning blocks unknown capabilities instead of guessing", () => {
  const plan = planMediaExecution({ kind: "video", input: base }, [adapter([])] as any);
  assert.equal(plan.status, "blocked");
  assert.equal(plan.capability, "text_to_video");
});

test("media planning selects a verified direct capability", () => {
  const plan = planMediaExecution({
    kind: "video", input: base,
  }, [adapter([{ capability: "text_to_video", status: "supported", source: "live_probe" }])] as any);
  assert.equal(plan.status, "direct");
  assert.equal(plan.providerId, "provider-a");
});

test("segment edits fall back to first/last-frame regeneration", () => {
  const plan = planMediaExecution({
    kind: "video",
    input: { ...base, sourceVideoUri: "nextmux.media/source.mp4", editStartSeconds: 1, editEndSeconds: 2 },
  }, [adapter([{ capability: "first_last_frame", status: "supported", source: "provider_metadata" }])] as any);
  assert.equal(plan.status, "fallback");
  assert.equal(plan.fallbackCapability, "first_last_frame");
});

test("single-frame edits select frame_edit and fall back to reference video", () => {
  const direct = planMediaExecution({
    kind: "video",
    input: {
      ...base,
      sourceVideoUri: "nextmux.media/source.mp4",
      editFrameSeconds: 2.25,
    },
  }, [adapter([{ capability: "frame_edit", status: "supported", source: "live_probe" }])] as any);
  assert.equal(direct.status, "direct");
  assert.equal(direct.capability, "frame_edit");
  const fallback = planMediaExecution({
    kind: "video",
    input: {
      ...base,
      sourceVideoUri: "nextmux.media/source.mp4",
      editFrameSeconds: 2.25,
    },
  }, [adapter([{ capability: "reference_to_video", status: "supported", source: "provider_metadata" }])] as any);
  assert.equal(fallback.status, "fallback");
  assert.equal(fallback.fallbackCapability, "reference_to_video");
});

test("music planning requires an explicitly verified music capability", () => {
  const input = { ...base, prompt: "悬疑背景音乐", format: "mp3" as const };
  const blocked = planMediaExecution({ kind: "music", input }, [adapter([])] as any);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.capability, "music_generation");
  const direct = planMediaExecution({ kind: "music", input }, [adapter([
    { capability: "music_generation", status: "supported", source: "live_probe" }
  ])] as any);
  assert.equal(direct.status, "direct");
});
