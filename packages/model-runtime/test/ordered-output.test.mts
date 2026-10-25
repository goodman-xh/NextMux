import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedModelOutputFetch, createAiSdkModelClient, createOfficialModelClient,
  createPreferredOfficialModelClient, MODEL_OUTPUT_MAX_AUDIO_BYTES, MODEL_OUTPUT_MAX_IMAGE_BYTES,
  MODEL_OUTPUT_MAX_MEDIA_BYTES, MODEL_OUTPUT_MAX_PARTS, MODEL_OUTPUT_MAX_TEXT_BYTES,
  MODEL_OUTPUT_MAX_WIRE_BYTES, OfficialModelError, OrderedModelOutput,
} from "../lib/index.js";
import type { OfficialModelClientOptions, OfficialModelEvent, OfficialModelOutputPart } from "../lib/index.js";
import { smallImages } from "./fixtures/output-images.mts";

const image = smallImages.png;
const wav = Buffer.alloc(44);
wav.write("RIFF"); wav.writeUInt32LE(36, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
const audio = wav.toString("base64");
const imagePart = { inlineData: { mimeType: "image/png", data: image } };
const audioPart = { inlineData: { mimeType: "audio/wav", data: audio } };
const textParts = ["BEFORE\n", "BETWEEN\n", "AFTER\n[Source](https://example.test/source)\n\n| Item | Value |\n|---|---|\n| A | 1 |"];
const mixed = [{ text: textParts[0] }, imagePart, { text: textParts[1] }, imagePart, audioPart, { text: textParts[2] }];
const request = { messages: [{ role: "user" as const, content: "Return the requested answer" }], tools: [] };
const usage = { inputTokens: 10, outputTokens: 20 };
const base: OfficialModelClientOptions = { providerId: "gemini", protocol: "gemini_generate_content",
  baseUrl: "https://gemini.example.test/v1beta", apiKey: "fixture-not-a-real-credential", model: "fixture-mixed-output" };
const originalFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error("External fetch is forbidden in ordered-output tests"); }; });
test.after(() => { globalThis.fetch = originalFetch; });

function payload(parts: readonly unknown[], known = true): unknown {
  return { candidates: [{ index: 0, content: { role: "model", parts }, finishReason: "STOP" }],
    ...(known ? { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 } } : {}) };
}
function response(input: unknown, body: unknown): Response {
  return String(input).includes(":streamGenerateContent")
    ? new Response(`data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
    : new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
function options(parts: readonly unknown[], accepted = true, known = true) {
  let dispatches = 0;
  return { value: { ...base, ...(accepted ? { acceptOrderedOutput: true as const } : {}), fetchImpl: async (input: RequestInfo | URL) => {
    assert.equal(new URL(String(input)).hostname, "gemini.example.test"); dispatches++;
    return response(input, payload(parts, known));
  } }, dispatched: () => dispatches };
}
function outputFailure(code: string, known = true): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof OfficialModelError);
    assert.equal(error.code, code); assert.equal(error.retrySafe, false); assert.equal(error.retryable, false);
    assert.equal(error.stage, "decode"); assert.equal(error.usageKnown, known);
    assert.deepEqual(error.usage, known ? usage : undefined);
    assert.equal(JSON.stringify(error.toJSON()).includes(image), false);
    return true;
  };
}
function kinds(parts: readonly OfficialModelOutputPart[] | undefined) { return parts?.map(part => part.type); }

for (const [name, make] of [["preferred SDK", createPreferredOfficialModelClient], ["legacy", createOfficialModelClient]] as const) {
  test(`${name} keeps ordered text, two identical images, audio, link and table without raw generic events`, async () => {
    const fixture = options(mixed); const events: OfficialModelEvent[] = [];
    const result = await make(fixture.value).complete({ ...request, onModelEvent: event => { events.push(event); } });
    assert.deepEqual(kinds(result.outputParts), ["text", "image", "text", "image", "audio", "text"]);
    assert.deepEqual(result.outputParts?.filter(part => part.type === "text").map(part => part.text), textParts);
    assert.equal(result.outputParts?.[1]?.type, "image");
    assert.deepEqual(result.outputParts?.[1], result.outputParts?.[3], "same bytes retain both positions");
    assert.deepEqual(result.usage, usage); assert.notEqual(result.usageKnown, false);
    assert.match(result.content ?? "", /\[Source\]\(https:\/\/example\.test\/source\)/);
    assert.match(result.content ?? "", /\| Item \| Value \|/);
    assert.equal(fixture.dispatched(), 1);
    assert.equal(events.filter(event => event.type === "response.completed").length, 1);
    for (const value of [events, result.providerState]) {
      const serialized = JSON.stringify(value) ?? "";
      assert.equal(serialized.includes(image), false); assert.equal(serialized.includes(audio), false);
    }
  });
  test(`${name} accepts media-only output only with explicit consumer opt-in`, async () => {
    const fixture = options([imagePart, audioPart]);
    const result = await make(fixture.value).complete(request);
    assert.equal(result.content, ""); assert.deepEqual(kinds(result.outputParts), ["image", "audio"]);
    assert.equal(result.providerState, undefined, "no empty private context is fabricated for media-only output");
    assert.equal(fixture.dispatched(), 1);
  });
  for (const known of [true, false]) {
    test(`${name} refuses silent media loss without opt-in; usage ${known ? "known" : "unknown"}; no retry`, async () => {
      const fixture = options(mixed, false, known); const events: OfficialModelEvent[] = [];
      await assert.rejects(make(fixture.value).complete({ ...request, onModelEvent: event => { events.push(event); } }), outputFailure("UNSUPPORTED_OUTPUT", known));
      assert.equal(fixture.dispatched(), 1); assert.equal(events.some(event => event.type === "response.completed"), false);
      assert.equal(events.at(-1)?.type, "response.failed");
      assert.equal(JSON.stringify(events).includes(image), false);
    });
  }
  test(`${name} excludes private reasoning-file bytes/signatures from visible output and generic events`, async () => {
    const fixture = options([{ ...imagePart, thought: true, thoughtSignature: "private-signature-sentinel" }, { text: "Public answer" }]);
    const events: OfficialModelEvent[] = [];
    const result = await make(fixture.value).complete({ ...request, onModelEvent: event => { events.push(event); } });
    assert.deepEqual(result.outputParts, [{ type: "text", text: "Public answer" }]);
    const publicFields = JSON.stringify({ outputParts: result.outputParts, content: result.content, events });
    assert.equal(publicFields.includes(image), false); assert.equal(publicFields.includes("private-signature-sentinel"), false);
    if (name === "legacy") {
      assert.equal((JSON.stringify(result.providerState) ?? "").includes(image), true, "old private thought state remains intact, not promoted to public output");
    } else assert.equal((JSON.stringify(result.providerState) ?? "").includes(image), false);
  });
  test(`${name} rejects signed visible media without dropping or exposing the required private signature`, async () => {
    const fixture = options([{ text: "Partial" }, { ...imagePart, thoughtSignature: "private-signature-sentinel" }]);
    const events: OfficialModelEvent[] = [];
    await assert.rejects(make(fixture.value).complete({ ...request, onModelEvent: event => { events.push(event); } }), outputFailure("UNSUPPORTED_OUTPUT"));
    assert.equal(fixture.dispatched(), 1); assert.equal(JSON.stringify(events).includes("private-signature-sentinel"), false);
  });
  for (const [mimeType, data, code] of [["image/svg+xml", image, "UNSUPPORTED_OUTPUT"], ["audio/L16;codec=pcm;rate=24000", audio, "UNSUPPORTED_OUTPUT"],
    ["image/png", "%%%", "INVALID_OUTPUT"], ["image/png", Buffer.from("not a PNG").toString("base64"), "INVALID_OUTPUT"]]) {
    test(`${name} refuses ${mimeType} invalid/unsupported output, retains usage and never retries`, async () => {
      const fixture = options([{ text: "not the complete answer" }, { inlineData: { mimeType, data } }]);
      await assert.rejects(make(fixture.value).complete(request), outputFailure(code!));
      assert.equal(fixture.dispatched(), 1);
    });
  }
  test(`${name} rejects unsupported fileData URLs without fetching them`, async () => {
    const fixture = options([{ text: "Partial" }, { fileData: { mimeType: "image/png", fileUri: "https://do-not-fetch.example.test/image.png" } }]);
    await assert.rejects(make(fixture.value).complete(request), outputFailure("UNSUPPORTED_OUTPUT"));
    assert.equal(fixture.dispatched(), 1);
  });
}

test("all public constructors reject unproved opt-in before auth, environment credentials or dispatch", () => {
  let dispatches = 0;
  for (const make of [createOfficialModelClient, createPreferredOfficialModelClient, createAiSdkModelClient]) {
    for (const provider of [{ protocol: "openai_chat_completions", providerId: "openrouter" }, { protocol: "anthropic_messages", providerId: "bedrock" },
      { protocol: "gemini_generate_content", providerId: "vertex" }, { protocol: "cohere_chat", providerId: "cohere" }, { protocol: "openai_responses", providerId: "openai" }] as const) {
      assert.throws(() => make({ ...base, ...provider, apiKey: "", acceptOrderedOutput: true,
        providerSettings: { credentialSource: "environment" }, fetchImpl: async () => { dispatches++; throw new Error("forbidden"); } }),
      (error: unknown) => error instanceof OfficialModelError && error.code === "UNSUPPORTED_CAPABILITY" && error.retrySafe);
    }
    assert.throws(() => make({ ...base, acceptOrderedOutput: "yes" } as unknown as OfficialModelClientOptions),
      (error: unknown) => error instanceof OfficialModelError && error.code === "INVALID_REQUEST");
  }
  assert.equal(dispatches, 0);
});

test("collector merges only contiguous text deltas and never deduplicates media", () => {
  const output = new OrderedModelOutput(true);
  output.text("a", "one"); output.text("a", " two"); output.media("image/png", () => image);
  output.text("a", "three"); output.text("b", "four"); output.media("image/png", () => image);
  const parts = output.finish(usage, true);
  assert.deepEqual(kinds(parts), ["text", "image", "text", "text", "image"]);
  assert.deepEqual(parts?.filter(part => part.type === "text").map(part => part.text), ["one two", "three", "four"]);
});

test("unaccepted consumer never reads generated-file base64 getter", () => {
  const output = new OrderedModelOutput(false);
  output.media("image/png", () => { assert.fail("must not decode unused media"); });
  assert.throws(() => output.finish(usage, true), outputFailure("UNSUPPORTED_OUTPUT"));
});

test("collector enforces 64 parts, 16 media and text UTF-8 bound without partial-success truncation", () => {
  const parts = new OrderedModelOutput(true);
  for (let index = 0; index < MODEL_OUTPUT_MAX_PARTS; index++) parts.text(String(index), "x");
  assert.equal(parts.finish(usage, true)?.length, MODEL_OUTPUT_MAX_PARTS);
  parts.text("extra", "x"); assert.throws(() => parts.finish(usage, true), outputFailure("OUTPUT_TOO_LARGE"));
  const media = new OrderedModelOutput(true);
  for (let index = 0; index < 16; index++) media.media("image/png", () => image);
  assert.equal(media.finish(usage, true)?.length, 16);
  media.media("image/png", () => { assert.fail("17th media is rejected before byte access"); });
  assert.throws(() => media.finish(usage, true), outputFailure("OUTPUT_TOO_LARGE"));
  const text = new OrderedModelOutput(true);
  text.text("a", "x".repeat(MODEL_OUTPUT_MAX_TEXT_BYTES)); assert.equal(text.finish(usage, true)?.length, 1);
  text.text("a", "中"); assert.throws(() => text.finish(usage, true), outputFailure("OUTPUT_TOO_LARGE"));
});

test("collector rejects over-limit image/audio and cumulative media before unsafe decoding", () => {
  for (const [mime, max] of [["image/png", MODEL_OUTPUT_MAX_IMAGE_BYTES], ["audio/wav", MODEL_OUTPUT_MAX_AUDIO_BYTES]] as const) {
    const output = new OrderedModelOutput(true);
    output.media(mime, () => "A".repeat(4 * Math.ceil(max / 3) + 4));
    assert.throws(() => output.finish(usage, true), outputFailure("OUTPUT_TOO_LARGE"));
  }
  const bytes = Buffer.alloc(8 * 1024 * 1024); Buffer.from(image, "base64").copy(bytes);
  const encoded = bytes.toString("base64"); const output = new OrderedModelOutput(true);
  for (let index = 0; index < MODEL_OUTPUT_MAX_MEDIA_BYTES / bytes.length; index++) output.media("image/png", () => encoded);
  assert.equal(output.finish(usage, true)?.length, 4);
  output.media("image/png", () => image);
  assert.throws(() => output.finish(usage, true), outputFailure("OUTPUT_TOO_LARGE"));
});

test("collector validates canonical base64 and rejects excessive image dimensions", () => {
  for (const value of ["Zg=", "Zg====", "Zh==", " Zg==", "Z=g="]) {
    const output = new OrderedModelOutput(true); output.media("image/png", () => value);
    assert.throws(() => output.finish(usage, true), outputFailure("INVALID_OUTPUT"));
  }
  const huge = Buffer.from(image, "base64"); huge.writeUInt32BE(16_385, 16);
  const output = new OrderedModelOutput(true); output.media("image/png", () => huge.toString("base64"));
  assert.throws(() => output.finish(usage, true), outputFailure("INVALID_OUTPUT"));
});

test("pre-parser wire bound cancels oversized content-length before body is consumed", async () => {
  let cancelled = 0; let dispatched = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const bounded = boundedModelOutputFetch(async () => { dispatched++; return new Response(stream, { headers: { "content-length": String(MODEL_OUTPUT_MAX_WIRE_BYTES + 1) } }); });
  await assert.rejects(bounded.fetch("https://fixture.example.test"), outputFailure("OUTPUT_TOO_LARGE", false));
  assert.equal(cancelled, 1); assert.equal(dispatched, 1); assert.equal(bounded.failure()?.code, "OUTPUT_TOO_LARGE");
});

test("pre-parser wire bound counts streaming bytes and propagates reader cancellation with no second fetch", async () => {
  let cancelled = 0; let dispatched = 0; let produced = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const bounded = boundedModelOutputFetch(async () => { dispatched++; return new Response(new ReadableStream<Uint8Array>({
    pull(controller) { produced++; controller.enqueue(chunk); }, cancel() { cancelled++; }
  })); });
  const wrapped = await bounded.fetch("https://fixture.example.test"); const reader = wrapped.body!.getReader(); let consumed = 0;
  await assert.rejects(async () => { while (true) { const part = await reader.read(); if (part.done) break; consumed += part.value.byteLength; } }, outputFailure("OUTPUT_TOO_LARGE", false));
  assert.equal(consumed, MODEL_OUTPUT_MAX_WIRE_BYTES); assert.ok(produced <= 51); assert.equal(cancelled, 1); assert.equal(dispatched, 1);
  let cleanCancelled = 0;
  const clean = boundedModelOutputFetch(async () => new Response(new ReadableStream<Uint8Array>({ cancel() { cleanCancelled++; } })));
  await (await clean.fetch("https://fixture.example.test")).body!.cancel(); assert.equal(cleanCancelled, 1);
});

test("SDK parser error wrapping preserves output cap classification and never replays", async () => {
  let dispatched = 0; const events: OfficialModelEvent[] = [];
  await assert.rejects(createPreferredOfficialModelClient({ ...base, acceptOrderedOutput: true,
    fetchImpl: async () => { dispatched++; return new Response("not read", { headers: { "content-length": String(MODEL_OUTPUT_MAX_WIRE_BYTES + 1) } }); }
  }).complete({ ...request, onModelEvent: event => { events.push(event); } }), outputFailure("OUTPUT_TOO_LARGE", false));
  assert.equal(dispatched, 1); assert.equal(events.some(event => event.type === "response.completed"), false);
});

test("failed-output usage accepts only genuine safe nonnegative integer counts", () => {
  for (const counts of [{ inputTokens: -1, outputTokens: 1 }, { inputTokens: 1.1, outputTokens: 2 },
    { inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 2 }, { inputTokens: 1, outputTokens: Infinity }]) {
    const error = new OfficialModelError("INVALID_OUTPUT", "fixed", { usage: counts, usageKnown: true });
    assert.equal(error.usageKnown, false); assert.equal(error.usage, undefined);
  }
});

test("legacy keeps its pre-existing 2 MiB JSON response bound", async () => {
  let dispatched = 0;
  await assert.rejects(createOfficialModelClient({ ...base, acceptOrderedOutput: true,
    fetchImpl: async () => { dispatched++; return new Response(" ".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } }); }
  }).complete(request), (error: unknown) => error instanceof OfficialModelError && error.code === "RESPONSE_TOO_LARGE" && !error.retrySafe);
  assert.equal(dispatched, 1);
});

test("actual Gemini consumers preserve text-only compatibility without an opt-in property", async () => {
  for (const make of [createPreferredOfficialModelClient, createOfficialModelClient]) {
    const fixture = options([{ text: "Plain answer" }], false);
    const result = await make(fixture.value).complete(request);
    assert.equal(result.content, "Plain answer"); assert.equal(result.outputParts, undefined);
    assert.equal(fixture.dispatched(), 1);
  }
});

test("legacy empty and excessive candidate parts preserve known usage on decode failure", async () => {
  for (const [parts, code] of [[[], "INVALID_RESPONSE"], [Array.from({ length: 65 }, () => ({ text: "x" })), "OUTPUT_TOO_LARGE"]] as const) {
    const fixture = options(parts);
    await assert.rejects(createOfficialModelClient(fixture.value).complete(request), outputFailure(code));
    assert.equal(fixture.dispatched(), 1);
  }
});

test("Gemini cancellation after visible media starts never completes, retries or emits bytes", async () => {
  const controller = new AbortController(); const events: OfficialModelEvent[] = []; let dispatched = 0; let cancelled = 0;
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(payload([imagePart, { text: "Partial" }], false))}\n\n`);
  const client = createPreferredOfficialModelClient({ ...base, acceptOrderedOutput: true, fetchImpl: async (_input, init) => {
    dispatched++;
    return new Response(new ReadableStream<Uint8Array>({ start(stream) {
      stream.enqueue(encoded);
      init?.signal?.addEventListener("abort", () => { cancelled++; stream.error(new DOMException("Aborted", "AbortError")); }, { once: true });
    } }), { headers: { "content-type": "text/event-stream" } });
  } });
  await assert.rejects(client.complete({ ...request, signal: controller.signal, onTextDelta() { controller.abort(); },
    onModelEvent(event) { events.push(event); } }),
  (error: unknown) => error instanceof OfficialModelError && error.code === "CANCELLED" && !error.retrySafe);
  assert.equal(dispatched, 1); assert.equal(cancelled, 1); assert.equal(events.some(event => event.type === "response.completed"), false);
  assert.equal(JSON.stringify(events).includes(image), false);
});

test("failure after finish keeps observed numeric usage even when the event sink rejects", async () => {
  const fixture = options(mixed); const events: OfficialModelEvent[] = [];
  await assert.rejects(createPreferredOfficialModelClient(fixture.value).complete({ ...request, onModelEvent(event) {
    if (event.type === "usage") throw new Error("fixture observer unavailable");
    events.push(event);
  } }), (error: unknown) => {
    assert.ok(error instanceof OfficialModelError); assert.equal(error.usageKnown, true); assert.deepEqual(error.usage, usage);
    assert.equal(error.retrySafe, false); return true;
  });
  assert.equal(fixture.dispatched(), 1); assert.equal(events.some(event => event.type === "response.completed"), false);
});

test("visible media followed by malformed stream cannot become a partial successful answer", async () => {
  let dispatched = 0; const events: OfficialModelEvent[] = [];
  const client = createPreferredOfficialModelClient({ ...base, acceptOrderedOutput: true, fetchImpl: async () => {
    dispatched++;
    return new Response(`data: ${JSON.stringify(payload([imagePart, { text: "Partial" }], false))}\n\ndata: {invalid json}\n\n`,
      { headers: { "content-type": "text/event-stream" } });
  } });
  await assert.rejects(client.complete({ ...request, onModelEvent(event) { events.push(event); } }),
    (error: unknown) => error instanceof OfficialModelError && !error.retrySafe);
  assert.equal(dispatched, 1); assert.equal(events.some(event => event.type === "response.completed"), false);
  assert.equal(JSON.stringify(events).includes(image), false);
});

test("legacy cancellation in the real text callback keeps usage and never announces completion", async () => {
  const fixture = options(mixed); const events: OfficialModelEvent[] = []; const controller = new AbortController();
  await assert.rejects(createOfficialModelClient(fixture.value).complete({ ...request, signal: controller.signal,
    onTextDelta() { controller.abort(); }, onModelEvent(event) { events.push(event); } }), (error: unknown) => {
    assert.ok(error instanceof OfficialModelError); assert.equal(error.code, "CANCELLED");
    assert.equal(error.usageKnown, true); assert.deepEqual(error.usage, usage); assert.equal(error.retrySafe, false); return true;
  });
  assert.equal(fixture.dispatched(), 1); assert.equal(events.some(event => event.type === "response.completed"), false);
  assert.equal(events.at(-1)?.type, "response.failed");
});

test("legacy usage observer failure preserves the completed HTTP attempt's known usage", async () => {
  const fixture = options(mixed); const events: OfficialModelEvent[] = [];
  await assert.rejects(createOfficialModelClient(fixture.value).complete({ ...request, onModelEvent(event) {
    if (event.type === "usage") throw new Error("fixture observer unavailable");
    events.push(event);
  } }), (error: unknown) => {
    assert.ok(error instanceof OfficialModelError); assert.equal(error.usageKnown, true); assert.deepEqual(error.usage, usage);
    assert.equal(error.retrySafe, false); return true;
  });
  assert.equal(fixture.dispatched(), 1); assert.equal(events.some(event => event.type === "response.completed"), false);
});

test("SDK private-state bounds are validated before a mixed response can announce success", async () => {
  const fixture = options([imagePart, { text: "x".repeat(1_600_000), thought: true }, { text: "Visible answer" }]);
  const events: OfficialModelEvent[] = [];
  await assert.rejects(createPreferredOfficialModelClient(fixture.value).complete({ ...request, onModelEvent(event) { events.push(event); } }),
    outputFailure("INVALID_RESPONSE"));
  assert.equal(fixture.dispatched(), 1); assert.equal(events.some(event => event.type === "response.completed"), false);
  assert.equal(events.at(-1)?.type, "response.failed");
});

for (const [name, make] of [["SDK", createPreferredOfficialModelClient], ["legacy", createOfficialModelClient]] as const) {
  test(`${name} completion delivery failure cannot reverse the validated upstream outcome or replay it`, async () => {
    for (const known of [true, false]) {
      const fixture = options(mixed, true, known); const events: OfficialModelEvent[] = [];
      await assert.rejects(make(fixture.value).complete({ ...request, onModelEvent(event) { events.push(event); }, onProviderEvent(event) {
        if (event.type === "response.completed") throw new Error("private observer failure must not escape");
      } }), (error: unknown) => {
        assert.ok(error instanceof OfficialModelError); assert.equal(error.code, "EVENT_DELIVERY_FAILED");
        assert.equal(error.usageKnown, known); assert.deepEqual(error.usage, known ? usage : undefined);
        assert.equal(error.retrySafe, false); assert.equal(error.retryable, false);
        assert.equal(error.message.includes("private observer"), false); return true;
      });
      assert.equal(fixture.dispatched(), 1); assert.equal(events.filter(event => event.type === "response.completed").length, 1);
      assert.equal(events.some(event => event.type === "response.failed"), false);
    }
  });
  test(`${name} cancellation from the final usage observer still precedes the completion boundary`, async () => {
    const fixture = options(mixed); const events: OfficialModelEvent[] = []; const controller = new AbortController();
    await assert.rejects(make(fixture.value).complete({ ...request, signal: controller.signal, onModelEvent(event) {
      events.push(event); if (event.type === "usage") controller.abort();
    } }), (error: unknown) => error instanceof OfficialModelError && error.code === "CANCELLED" && error.usageKnown === true && !error.retrySafe);
    assert.equal(fixture.dispatched(), 1); assert.equal(events.some(event => event.type === "response.completed"), false);
  });
}
