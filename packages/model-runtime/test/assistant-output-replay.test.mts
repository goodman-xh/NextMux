import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createOfficialModelClient, createPreferredOfficialModelClient, createAiSdkModelClient, OfficialModelError } from "../lib/index.js";
import { smallImages } from "./fixtures/output-images.mts";
import { ASSISTANT_REPLAY_MAX_REQUEST_BYTES, assistantReplayFetch } from "../lib/assistant-output-replay.js";

const png = Buffer.from(smallImages.png!, "base64");
const wav = Buffer.alloc(44);
wav.write("RIFF"); wav.writeUInt32LE(36, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
const asset = (bytes: Buffer, mimeType: string) => ({ sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, mimeType });
const image = { type: "image", asset: asset(png, "image/png") };
const audio = { type: "audio", asset: asset(wav, "audio/wav") };
const refs = [{ type: "text", text: "A" }, image, { type: "text", text: "B" }, image, audio, { type: "text", text: "C" }];
const tool = { name: "fixture_tool", description: "Offline fixture", requiredPermission: "read_only" as const,
  source: "builtin" as const, inputSchema: { type: "object", properties: {} } };
const initial = { messages: [{ role: "user" as const, content: "Fixture" }], tools: [tool] };
const originalFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error("External fetch forbidden"); }; });
test.after(() => { globalThis.fetch = originalFetch; });

function fixture(make: typeof createOfficialModelClient, extra: Record<string, unknown> = {}, callArgs: Record<string, unknown> = {}) {
  const bodies: any[] = [];
  const resolutions: any[] = [];
  const options: any = {
    providerId: "gemini", protocol: "gemini_generate_content", baseUrl: "https://gemini.fixture.invalid/v1beta",
    model: "gemini-test", apiKey: "synthetic-not-a-credential", acceptOrderedOutput: true,
    resolveAssistantOutputAsset: async (request: any) => {
      resolutions.push(request);
      if (request.asset.sha256 === image.asset.sha256) return png;
      if (request.asset.sha256 === audio.asset.sha256) return wav;
      throw new Error("Not authorized");
    },
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(new URL(String(input)).hostname, "gemini.fixture.invalid");
      const body = JSON.parse(String(init?.body)); bodies.push(body);
      const parts = bodies.length === 1 && body.contents?.length === 1 ? [
        { text: "A" }, { inlineData: { mimeType: "image/png", data: png.toString("base64") }, thought: false },
        { text: "PRIVATE", thought: true, thoughtSignature: "synthetic-private-thought-signature" },
        { text: "B" }, { inlineData: { mimeType: "image/png", data: png.toString("base64") }, thought: false },
        { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") }, thought: false }, { text: "C" },
        { functionCall: { id: "fixture-call", name: body.tools[0].functionDeclarations[0].name, args: callArgs }, thoughtSignature: "synthetic-tool-signature" },
      ] : [{ text: "Done" }];
      const payload = { candidates: [{ index: 0, content: { role: "model", parts }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 8 } };
      return String(input).includes(":streamGenerateContent")
        ? new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream" } })
        : new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
    }, ...extra,
  };
  return { client: make(options), bodies, resolutions, options };
}

function request(outputParts: unknown = refs): any {
  return { messages: [{ role: "user", content: "Fixture" }, { role: "assistant", content: "ABC", outputParts }, { role: "user", content: "Continue" }], tools: [] };
}

for (const [label, make] of [["SDK", createPreferredOfficialModelClient], ["legacy", createOfficialModelClient]] as const) {
  test(`${label} replays exact assistant media positions through real provider mapping and preserves tool signatures`, async () => {
    const f = fixture(make);
    const first = await f.client.complete(initial);
    await f.client.complete({ messages: [...initial.messages, { role: "assistant", content: first.content || "", toolCalls: first.toolCalls,
      providerState: first.providerState, outputParts: refs }, { role: "tool", toolCallId: "fixture-call", content: "tool result" }], tools: [tool] } as any);
    assert.equal(f.bodies.length, 2);
    const parts = f.bodies[1].contents[1].parts;
    const visible = parts.filter((part: any) => !part.thought && !part.functionCall);
    assert.deepEqual(visible.map((part: any) => part.text ?? part.inlineData?.mimeType), ["A", "image/png", "B", "image/png", "audio/wav", "C"]);
    assert.equal(visible[1].inlineData.data, png.toString("base64"));
    assert.equal(visible[3].inlineData.data, png.toString("base64"));
    assert.equal(visible[4].inlineData.data, wav.toString("base64"));
    assert.equal(parts.find((part: any) => part.functionCall).thoughtSignature, "synthetic-tool-signature");
    assert.equal(parts.find((part: any) => part.thought).thoughtSignature, "synthetic-private-thought-signature");
    assert.equal(f.resolutions.length, 3, "duplicate image positions require independent host authorization");
    assert.deepEqual(f.resolutions.map(value => [value.messageIndex, value.partIndex]), [[1, 1], [1, 3], [1, 4]]);
  });

  test(`${label} refuses a missing resolver before POST instead of silently sending text only`, async () => {
    const f = fixture(make, { resolveAssistantOutputAsset: undefined });
    await assert.rejects(f.client.complete(request()), (error: unknown) => error instanceof OfficialModelError && error.retryable === false);
    assert.equal(f.bodies.length, 0);
  });

  test(`${label} missing or unauthorized assets fail before POST without raw host errors`, async () => {
    const f = fixture(make, { resolveAssistantOutputAsset: async () => { throw new Error("PRIVATE /secret/path sentinel"); } });
    await assert.rejects(f.client.complete(request()), (error: unknown) => {
      assert.ok(error instanceof OfficialModelError);
      assert.equal(error.stage, "validation"); assert.equal(error.retrySafe, true); assert.equal(error.retryable, false);
      assert.doesNotMatch(JSON.stringify(error.toJSON()), /PRIVATE|secret\/path/); return true;
    });
    assert.equal(f.bodies.length, 0);
  });

  test(`${label} refuses changed bytes before POST`, async () => {
    const f = fixture(make, { resolveAssistantOutputAsset: async () => Buffer.alloc(png.length) });
    await assert.rejects(f.client.complete(request()), (error: unknown) => error instanceof OfficialModelError && error.retrySafe);
    assert.equal(f.bodies.length, 0);
  });

  test(`${label} cancellation while a host read is pending stops promptly and never dispatches its late result`, async () => {
    const controller = new AbortController();
    let release!: (bytes: Uint8Array) => void, entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture(make, { resolveAssistantOutputAsset: () => { entered(); return new Promise(resolve => { release = resolve; }); } });
    const promise = f.client.complete({ ...request(), signal: controller.signal });
    await reading; controller.abort();
    const outcome = await Promise.race([promise.then(() => "success", error => error), new Promise(resolve => setTimeout(() => resolve("hung"), 100))]);
    release(png);
    assert.ok(outcome instanceof OfficialModelError, "abort must not wait indefinitely for the host reader");
    assert.equal(outcome.code, "CANCELLED");
    await assert.rejects(promise); assert.equal(f.bodies.length, 0);
  });

  test(`${label} snapshots references before awaiting authorization; subsequent input changes cannot alter the request`, async () => {
    const input = request(JSON.parse(JSON.stringify(refs)));
    const f = fixture(make, { resolveAssistantOutputAsset: async ({ asset: item }: any) => {
      input.messages[1].outputParts[0].text = "MUTATED";
      input.messages[1].outputParts[3].asset.sha256 = "0".repeat(64);
      input.messages[1].content = "MUTATED";
      return item.mimeType === "image/png" ? png : wav;
    } });
    await f.client.complete(input);
    const parts = f.bodies[0].contents[1].parts;
    assert.equal(parts[0].text, "A"); assert.equal(parts[3].inlineData.data, png.toString("base64"));
    assert.equal(JSON.stringify(f.bodies).includes("MUTATED"), false);
  });

  test(`${label} pure media replay needs no fabricated text or private provider state`, async () => {
    const f = fixture(make);
    await f.client.complete(request([image, audio]));
    assert.deepEqual(f.bodies[0].contents[1].parts.map((part: any) => part.inlineData?.mimeType), ["image/png", "audio/wav"]);
  });

  test(`${label} a new route cannot reuse the old mixed response's private state`, async () => {
    const f = fixture(make); const first = await f.client.complete(initial);
    const other = fixture(make, { model: "other-model" });
    const next = request(); next.messages[1].providerState = first.providerState; next.messages[1].toolCalls = first.toolCalls;
    await assert.rejects(other.client.complete(next), (error: unknown) => error instanceof OfficialModelError && error.retrySafe);
    assert.equal(other.bodies.length, 0);
    assert.equal(other.resolutions.length, 0);
  });

  test(`${label} caller mutation of client options cannot validate another route against the original endpoint`, async () => {
    const source = fixture(make, { model: "other-model" }); const first = await source.client.complete(initial);
    const target = fixture(make);
    target.options.model = "other-model";
    const next = request(); next.messages[1].providerState = first.providerState; next.messages[1].toolCalls = first.toolCalls;
    await assert.rejects(target.client.complete(next), (error: unknown) => error instanceof OfficialModelError && error.retrySafe);
    assert.equal(target.bodies.length, 0); assert.equal(target.resolutions.length, 0);
  });

  test(`${label} changing an authorized image or tool call still cannot reuse a mismatched private template`, async () => {
    const f = fixture(make); const first = await f.client.complete(initial);
    for (const change of ["caption", "media", "tool", "scope"]) {
      const other = fixture(make);
      const next = request(JSON.parse(JSON.stringify(refs)));
      next.messages[1].providerState = JSON.parse(JSON.stringify(first.providerState));
      next.messages[1].toolCalls = JSON.parse(JSON.stringify(first.toolCalls));
      if (change === "caption") next.messages[1].outputParts[0].text = "Changed";
      if (change === "media") next.messages[1].outputParts[1] = audio;
      if (change === "tool") next.messages[1].toolCalls[0].arguments = { changed: true };
      if (change === "scope") { next.messages[1].providerState.scope = "0".repeat(64); next.messages[1].providerState.replayScope = "0".repeat(64); }
      await assert.rejects(other.client.complete(next), (error: unknown) => error instanceof OfficialModelError && error.retrySafe);
      assert.equal(other.bodies.length, 0); assert.equal(other.resolutions.length, 0);
    }
  });

  test(`${label} dropping references cannot silently downgrade a v2 private replay state to text`, async () => {
    const f = fixture(make); const first = await f.client.complete(initial);
    const other = fixture(make);
    const next = request(); delete next.messages[1].outputParts;
    next.messages[1].providerState = first.providerState; next.messages[1].toolCalls = first.toolCalls;
    await assert.rejects(other.client.complete(next), (error: unknown) => error instanceof OfficialModelError && error.retrySafe);
    assert.equal(other.bodies.length, 0); assert.equal(other.resolutions.length, 0);
  });

  test(`${label} authorization is per position even when two slots have the identical hash`, async () => {
    let reads = 0;
    const f = fixture(make, { resolveAssistantOutputAsset: async ({ partIndex }: any) => {
      reads++; if (partIndex === 3) throw new Error("Not authorized at this position"); return png;
    } });
    await assert.rejects(f.client.complete(request()), (error: unknown) => error instanceof OfficialModelError && error.retrySafe);
    assert.equal(reads, 2); assert.equal(f.bodies.length, 0);
  });

  test(`${label} malformed references, raw bytes and paths are rejected before the host resolver`, async () => {
    for (const outputParts of [[{ ...image, dataBase64: png.toString("base64") }], [{ ...image, asset: { ...image.asset, path: "/private/secret" } }],
      [{ ...image, asset: { ...image.asset, sha256: "https://invalid.test/file" } }], [{ ...audio, asset: image.asset }],
      [{ ...image, asset: { ...image.asset, sizeBytes: 0 } }], [{ ...image, asset: { ...image.asset, sizeBytes: Number.MAX_SAFE_INTEGER } }]]) {
      const f = fixture(make);
      await assert.rejects(f.client.complete(request(outputParts)), (error: unknown) => error instanceof OfficialModelError && error.retrySafe);
      assert.equal(f.bodies.length, 0); assert.equal(f.resolutions.length, 0);
    }
  });

  test(`${label} only authorized binary replay can exceed the old 4 MiB JSON ceiling`, async () => {
    const large = Buffer.alloc(4 * 1024 * 1024); wav.copy(large);
    const largeRef = { type: "audio", asset: asset(large, "audio/wav") };
    const f = fixture(make, { resolveAssistantOutputAsset: async () => large });
    await f.client.complete(request([largeRef]));
    const encoded = JSON.stringify(f.bodies[0]);
    assert.ok(Buffer.byteLength(encoded) > 4 * 1024 * 1024);
    assert.ok(Buffer.byteLength(encoded) < ASSISTANT_REPLAY_MAX_REQUEST_BYTES);
    const old = fixture(make);
    await assert.rejects(old.client.complete({ messages: [{ role: "user", content: "x".repeat(4 * 1024 * 1024) }], tools: [] }),
      (error: unknown) => error instanceof OfficialModelError && error.code === "REQUEST_TOO_LARGE");
    assert.equal(old.bodies.length, 0);
  });

  test(`${label} total media accounting spans messages and counts repeated positions before reads`, async () => {
    const huge = { type: "audio", asset: { ...audio.asset, sizeBytes: 24 * 1024 * 1024 } };
    const f = fixture(make);
    const input = request([huge]); input.messages.push({ role: "assistant", content: "", outputParts: [huge] });
    await assert.rejects(f.client.complete(input), (error: unknown) => error instanceof OfficialModelError && error.code === "REQUEST_TOO_LARGE" && error.retrySafe);
    assert.equal(f.resolutions.length, 0); assert.equal(f.bodies.length, 0);
    const metadata = fixture(make);
    await assert.rejects(metadata.client.complete({ ...request(), instructions: "x".repeat(4 * 1024 * 1024) }),
      (error: unknown) => error instanceof OfficialModelError && error.code === "REQUEST_TOO_LARGE" && error.retrySafe);
    assert.equal(metadata.resolutions.length, 0); assert.equal(metadata.bodies.length, 0);
  });

  test(`${label} local replay failure does not erase prior observed usage or perform a new generation`, async () => {
    const f = fixture(make); const first = await f.client.complete(initial);
    const unavailable = fixture(make, { resolveAssistantOutputAsset: async () => { throw new Error("missing"); } });
    const next = request(); next.messages[1].providerState = first.providerState; next.messages[1].toolCalls = first.toolCalls;
    await assert.rejects(unavailable.client.complete(next), (error: unknown) => {
      assert.ok(error instanceof OfficialModelError); assert.equal(error.usageKnown, true);
      assert.deepEqual(error.usage, { inputTokens: 0, outputTokens: 0 }); assert.equal(error.retrySafe, true); return true;
    });
    assert.deepEqual(first.usage, { inputTokens: 3, outputTokens: 5 });
    assert.equal(f.bodies.length, 1); assert.equal(unavailable.bodies.length, 0);
  });

  test(`${label} a dispatched replay failure is not mislabeled as free or retried on another adapter`, async () => {
    let posts = 0;
    const f = fixture(make, { fetchImpl: async () => { posts++; return new Response("{}", { status: 503, headers: { "content-type": "application/json" } }); } });
    await assert.rejects(f.client.complete(request()), (error: unknown) => {
      assert.ok(error instanceof OfficialModelError); assert.equal(error.retrySafe, false);
      assert.notEqual(error.usageKnown, true); return true;
    });
    assert.equal(posts, 1); assert.equal(f.resolutions.length, 3);
  });
}

test("legacy private template args compare JSON structure, not object key insertion order", async () => {
  const source = fixture(createOfficialModelClient, {}, { first: 1, nested: { a: 2, b: [3, 4] } });
  const first = await source.client.complete(initial), target = fixture(createOfficialModelClient);
  const next = request(); next.tools = [tool]; next.messages[1].toolCalls = first.toolCalls;
  next.messages[1].providerState = structuredClone(first.providerState);
  const call = next.messages[1].providerState.entries.find((entry: any) => entry.part?.functionCall).part.functionCall;
  call.args = { nested: { b: [3, 4], a: 2 }, first: 1 };
  await target.client.complete(next);
  assert.equal(target.bodies.length, 1); assert.equal(target.resolutions.length, 3);
  assert.deepEqual(target.bodies[0].contents[1].parts.find((part: any) => part.functionCall).functionCall.args, call.args);
});

test("legacy private text and media slots cannot diverge from public parts before host reads", async () => {
  const source = fixture(createOfficialModelClient), first = await source.client.complete(initial);
  for (const change of ["text", "slot", "remove", "duplicate"]) {
    const target = fixture(createOfficialModelClient), next = request();
    next.tools = [tool]; next.messages[1].toolCalls = first.toolCalls; next.messages[1].providerState = structuredClone(first.providerState);
    const entries = next.messages[1].providerState.entries;
    if (change === "text") entries.find((entry: any) => entry.part?.text === "A").part.text = "Changed private text";
    else {
      const index = entries.findIndex((entry: any) => entry.kind === "media");
      if (change === "slot") entries[index].index++;
      else if (change === "remove") entries.splice(index, 1);
      else entries.push(structuredClone(entries[index]));
    }
    await assert.rejects(target.client.complete(next), (error: unknown) => error instanceof OfficialModelError && error.retrySafe);
    assert.equal(target.resolutions.length, 0); assert.equal(target.bodies.length, 0);
  }
});

test("the final SDK replay wire guard rejects oversized JSON and non-JSON transport shapes before fetch", async () => {
  let posts = 0;
  const wrapped = assistantReplayFetch(async () => { posts++; return new Response("{}"); }, ASSISTANT_REPLAY_MAX_REQUEST_BYTES);
  await assert.rejects(wrapped("https://gemini.fixture.invalid/", { method: "POST", body: "x".repeat(ASSISTANT_REPLAY_MAX_REQUEST_BYTES + 1) }),
    (error: unknown) => error instanceof OfficialModelError && error.code === "REQUEST_TOO_LARGE" && error.retrySafe);
  await assert.rejects(wrapped("https://gemini.fixture.invalid/", { method: "POST", body: new Blob(["{}"]) }), OfficialModelError);
  assert.equal(posts, 0);
});

test("all public clients reject assistant references on unproved protocols before host reads or POST", async () => {
  for (const make of [createOfficialModelClient, createAiSdkModelClient, createPreferredOfficialModelClient]) {
    let posts = 0, reads = 0;
    const client = make({ providerId: "openai", protocol: "openai_chat_completions", model: "fixture", apiKey: "synthetic-not-a-credential",
      baseUrl: "https://gemini.fixture.invalid/v1", resolveAssistantOutputAsset: async () => { reads++; return png; },
      fetchImpl: async () => { posts++; return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Wrong success" } }] })); },
    } as any);
    await assert.rejects(client.complete(request()), (error: unknown) => error instanceof OfficialModelError && error.code === "UNSUPPORTED_CAPABILITY");
    assert.equal(posts, 0); assert.equal(reads, 0);
  }
});
