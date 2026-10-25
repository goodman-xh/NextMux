import assert from "node:assert/strict";
import test from "node:test";
import media from "../lib/index.js";
const { requestOpenRouterImage, mediaInput } = media as unknown as typeof import("../src/index.ts");

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("character pictures ride along with image and video jobs, at most four", () => {
  const image = mediaInput("image", { connectionId: "official-00000000-0000-4000-8000-000000000001", model: "m", prompt: "a girl", width: 1080, height: 1920,
    characterReferenceUris: ["nextmux.media/imports/a.png", "nextmux.media/imports/a.png"] });
  assert.deepEqual((image as { characterReferenceUris?: string[] }).characterReferenceUris, ["nextmux.media/imports/a.png"]);
  assert.throws(() => mediaInput("image", { connectionId: "official-00000000-0000-4000-8000-000000000001", model: "m", prompt: "a", width: 512, height: 512,
    characterReferenceUris: ["a.png", "b.png", "c.png", "d.png", "e.png"] }));
  assert.throws(() => mediaInput("video", { connectionId: "official-00000000-0000-4000-8000-000000000001", model: "m", prompt: "a", durationSeconds: 5, width: 512, height: 512,
    characterReferenceUris: ["../outside.png"] }));
});

test("OpenRouter image requests carry the character pictures as input references", async () => {
  let sent: any;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ data: [{ b64_json: png }] });
  };
  await requestOpenRouterImage({ endpoint: new URL("https://openrouter.ai/api/v1/images"), apiKey: "k", model: "google/gemini-2.5-flash-image", idempotencyKey: "i",
    prompt: "Lin walks home", width: 1080, height: 1920, references: [`data:image/png;base64,${png}`], fetchImpl: fetchImpl as typeof fetch });
  assert.equal(sent.aspect_ratio, "9:16");
  assert.equal(sent.input_references.length, 1, "every admitted picture is sent");
  assert.equal(sent.input_references[0].type, "image_url");
  assert.match(sent.prompt, /same face/);
});
