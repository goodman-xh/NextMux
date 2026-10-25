import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_CAPABILITY_KEYS, MODEL_PRIMARY_CATEGORIES, modelCapabilityBadges, modelPrimaryCategory } from "../lib/model-taxonomy.js";
import { MODEL_TASK_CATEGORIES, modelTaskCategories } from "../lib/model-task-capabilities.js";

// The same rows the web taxonomy is held to (apps/cloudflare-platform/web/test/taxonomy.test.mjs): desktop and web agree.
const rows = {
  claude: { modelId: "claude-sonnet-4-5", kind: "llm", category: "coding", input: ["text", "image"], output: ["text"], capabilities: ["tools", "reasoning", "vision", "web_search", "structured_output"] },
  hunyuan3d: { modelId: "hunyuan-3d-2", kind: "3d", category: "3d", input: ["text", "image"], output: ["text"], capabilities: ["tools", "3d"] },
  gptImage: { modelId: "gpt-image-1", canonicalModel: "openai/gpt-image-1", kind: "image", category: "image", input: ["text", "image"], output: ["image"], capabilities: ["image_generation", "image_editing"] },
  geminiImage: { modelId: "gemini-2.5-flash-image", category: "image", input: ["text", "image"], output: ["image", "text"] },
  veo: { modelId: "veo-3.1-fast", kind: "video", category: "video", input: ["text", "image"], output: ["video", "audio"], capabilities: ["video_generation", "video_native_audio"] },
  tts: { modelId: "tts-1-hd", kind: "speech", category: "audio", output: ["speech"] },
  suno: { modelId: "suno-v4", kind: "music", category: "audio", output: ["audio"], capabilities: ["music_generation", "vocal_reference"] },
  sfx: { modelId: "eleven-sound-effects", category: "audio", output: ["sound_effect"] },
  whisper: { modelId: "whisper-1", kind: "transcription", category: "audio", output: ["transcription"] },
  embedding: { modelId: "text-embedding-3-large", kind: "embedding", category: "embedding", output: ["embeddings"] },
  rerank: { modelId: "bge-reranker-v2-m3", kind: "rerank", category: "embedding", output: ["rerank"] },
  decision: { modelId: "jev-1.13", canonicalModel: "typesafe/jev-1.13", category: "decision", output: ["decisions"] },
};

test("every row has exactly one of the eleven categories, always one of its shared-classifier tasks", () => {
  const expected = { claude: "language", hunyuan3d: "3d", gptImage: "image", geminiImage: "image", veo: "video", tts: "speech", suno: "music", sfx: "sound_effect",
    whisper: "transcription", embedding: "embedding", rerank: "rerank", decision: "decision" };
  for (const [name, row] of Object.entries(rows)) {
    const primary = modelPrimaryCategory(row);
    assert.equal(primary, expected[name as keyof typeof expected], name);
    assert.ok(modelTaskCategories(row).includes(primary), `${name}: ${primary} ∉ ${modelTaskCategories(row)}`);
  }
  assert.deepEqual([...MODEL_PRIMARY_CATEGORIES], MODEL_TASK_CATEGORIES.filter(task => !["moderation", "other"].includes(task)));
});

test("spellings, bare kinds and names decide rows that declare nothing else; the kind always wins", () => {
  assert.deepEqual(["chat", "video_generation", "audio_speech", "audio_music", "audio_sfx", "asr", "text_ranking", "decisions", "coding"].map(word => modelPrimaryCategory({ modelType: word })),
    ["language", "video", "speech", "music", "sound_effect", "transcription", "rerank", "decision", "language"]);
  assert.equal(modelPrimaryCategory("audio"), "speech");
  assert.equal(modelPrimaryCategory("llm"), "language");
  assert.equal(modelPrimaryCategory({ category: "audio", modelId: "suno-v4" }), "music");
  assert.deepEqual(["gpt-image-1-all", "dall-e-3", "sora-2", "wan-2.2-t2v", "whisper-large-v3", "tts-1", "text-embedding-3-small", "rerank-english-v3", "qwen3-max"]
    .map(id => modelPrimaryCategory({ modelId: id })), ["image", "image", "video", "video", "transcription", "speech", "embedding", "rerank", "language"]);
  // Alibaba Wan names video by its mode suffix and pictures by t2i/i2i; ElevenLabs model IDs start with "eleven_", and its
  // sound-effect model ("eleven_text_to_sound_v2") must not fall into the voice rule.
  assert.deepEqual(["wan2.1-t2v-turbo", "wanx2.1-i2v-plus", "wan2.5-i2v-preview", "wan2.2-kf2v-flash", "wanx2.1-t2i-turbo", "wan2.2-t2i-plus",
    "eleven_multilingual_v2", "eleven_v3", "eleven-sound-effects", "eleven_text_to_sound_v2", "wan-chat", "qwen3-max"].map(id => modelPrimaryCategory(id)),
  ["video", "video", "video", "video", "image", "image", "speech", "speech", "sound_effect", "sound_effect", "language", "language"]);
  assert.equal(modelPrimaryCategory({ modelId: "some-chat", output: ["image", "text"] }), "image");
  assert.equal(modelPrimaryCategory({ kind: "video", modelId: "tts-named-video" }), "video");
  // Moderation and "other" are not primary categories: the rest of the row decides.
  assert.equal(modelPrimaryCategory({ kind: "moderation", modelId: "omni-moderation-latest", output: ["text"] }), "language");
});

test("badges never repeat the category and follow what the model takes and makes", () => {
  assert.deepEqual(modelCapabilityBadges(rows.claude), ["tools", "reasoning", "vision", "web_search", "structured_output"]);
  assert.deepEqual(modelCapabilityBadges(rows.gptImage), ["image_editing"], "a picture model that takes a picture edits it");
  assert.deepEqual(modelCapabilityBadges(rows.veo), ["text_to_video", "image_to_video", "video_native_audio"]);
  assert.deepEqual(modelCapabilityBadges(rows.suno), ["vocal_reference"]);
  assert.deepEqual(modelCapabilityBadges({ modelId: "kling-v2", output: ["video"], capabilities: ["image_to_video", "reference_to_video"] }), ["image_to_video", "reference_to_video"]);
  // Desktop spellings: "coding" is tool use, "input:image" is vision; flags on form rows count.
  assert.deepEqual(modelCapabilityBadges({ id: "m", output: ["text"], capabilities: ["coding", "thinking", "input:image", "json_schema"] }), ["tools", "reasoning", "vision", "structured_output"]);
  assert.deepEqual(modelCapabilityBadges({ id: "m", tools: true, vision: true }), ["tools", "vision"]);
  for (const badges of Object.values(rows).map(row => modelCapabilityBadges(row))) assert.ok(badges.every(key => MODEL_CAPABILITY_KEYS.includes(key)));
});
