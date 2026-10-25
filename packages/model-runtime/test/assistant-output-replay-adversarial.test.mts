import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createOfficialModelClient, createPreferredOfficialModelClient, OfficialModelError } from "../lib/index.js";
import { smallImages } from "./fixtures/output-images.mts";

// Real installed adapters; the only transport is this in-memory synthetic fetch.
const bytes = Buffer.from(smallImages.png!, "base64");
const image = { type: "image", asset: { sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: "image/png", sizeBytes: bytes.length } };
const parts = [{ type: "text", text: "Caption" }, image];
const tool = { name: "fixture_tool", description: "Offline fixture", requiredPermission: "read_only" as const,
  source: "builtin" as const, inputSchema: { type: "object", properties: { mode: { type: "string" } } } };
const firstRequest = { messages: [{ role: "user" as const, content: "Fixture" }], tools: [tool] };
const savedFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error("External fetch forbidden"); }; });
test.after(() => { globalThis.fetch = savedFetch; });

function fixture(make: typeof createOfficialModelClient, extra: Record<string, unknown> = {}, omitToolId = false, privatePart?: unknown) {
  const bodies: any[] = [], reads: any[] = [];
  const options: any = {
    providerId: "gemini", protocol: "gemini_generate_content", baseUrl: "https://replay-audit.fixture.invalid/v1beta",
    model: "fixture-model", apiKey: "synthetic-not-a-credential", acceptOrderedOutput: true,
    resolveAssistantOutputAsset: async (request: any) => { reads.push(request); return bytes; },
    fetchImpl: async (url: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(new URL(String(url)).hostname, "replay-audit.fixture.invalid");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)); bodies.push(body);
      const output = body.contents.length === 1 ? [{ text: "Caption" },
        { inlineData: { mimeType: "image/png", data: bytes.toString("base64") } },
        { functionCall: { ...(omitToolId ? {} : { id: "fixture-call" }), name: body.tools[0].functionDeclarations[0].name, args: { mode: "original" } }, thoughtSignature: "synthetic-tool-signature" },
        ...(privatePart === undefined ? [] : [privatePart])]
        : [{ text: "Done" }];
      const payload = { candidates: [{ index: 0, content: { role: "model", parts: output }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 } };
      return String(url).includes(":streamGenerateContent")
        ? new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream" } })
        : new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
    }, ...extra,
  };
  return { client: make(options), bodies, reads };
}

function continuation(first?: any): any {
  return { messages: [...firstRequest.messages, { role: "assistant", content: "Caption", outputParts: structuredClone(parts),
    ...(first ? { providerState: structuredClone(first.providerState), toolCalls: structuredClone(first.toolCalls) } : {}) },
    ...(first ? [{ role: "tool", toolCallId: first.toolCalls[0].id, content: "Original tool result" }] : [{ role: "user", content: "Continue" }])], tools: [tool] };
}

for (const alteration of ["arguments", "id", "name", "remove", "extra", "duplicate"] as const) {
  test(`legacy v2 rejects ${alteration} in the private tool template despite unchanged public tool hash`, async () => {
    const source = fixture(createOfficialModelClient), first = await source.client.complete(firstRequest);
    const target = fixture(createOfficialModelClient), input = continuation(first);
    const entries = input.messages[1].providerState.entries;
    const entry = entries.find((value: any) => value.part?.functionCall);
    assert.ok(entry, "fixture must obtain a real provider-generated v2 tool slot");
    if (alteration === "arguments") entry.part.functionCall.args = { mode: "changed-only-in-private-state" };
    else if (alteration === "id") entry.part.functionCall.id = "changed-only-in-private-state";
    else if (alteration === "name") entry.part.functionCall.name = "unrelated_tool";
    else if (alteration === "remove") entries.splice(entries.indexOf(entry), 1);
    else if (alteration === "extra") entries.push({ kind: "provider", part: { functionCall: { id: "extra-call", name: "unrelated_tool", args: {} } } });
    else entries.push(structuredClone(entry));
    await assert.rejects(target.client.complete(input), (error: unknown) => error instanceof OfficialModelError && error.retrySafe === true);
    assert.equal(target.bodies.length, 0, "inconsistent history must not dispatch another generation");
    assert.equal(target.reads.length, 0, "invalid private template must be rejected before host asset reads");
    assert.deepEqual(first.usage, { inputTokens: 1, outputTokens: 2 }, "previous paid usage is unchanged");
  });
}

test("legacy v2 preserves a legitimate provider tool without an id and its exact arguments/signature", async () => {
  const source = fixture(createOfficialModelClient, {}, true), first = await source.client.complete(firstRequest);
  assert.ok(first.toolCalls?.[0].id, "the public parser creates a local identity for an id-less provider call");
  const target = fixture(createOfficialModelClient);
  await target.client.complete(continuation(first));
  assert.equal(target.bodies.length, 1); assert.equal(target.reads.length, 1);
  const callPart = target.bodies[0].contents[1].parts.find((value: any) => value.functionCall);
  assert.deepEqual(callPart.functionCall.args, first.toolCalls[0].arguments);
  assert.equal(callPart.functionCall.name, "fixture_tool");
  assert.equal(callPart.thoughtSignature, "synthetic-tool-signature");
});

for (const [label, privatePart] of [
  ["private inline bytes", { thought: true, inlineData: { mimeType: "image/png", data: bytes.toString("base64") } }],
  ["private file URL", { thought: true, fileData: { mimeType: "image/png", fileUri: "https://unapproved.fixture.invalid/asset" } }],
  ["unknown URL part", { thought: true, url: "https://unapproved.fixture.invalid/asset" }],
] as const) {
  test(`legacy v2 rejects inserted ${label} before host reads or POST`, async () => {
    const source = fixture(createOfficialModelClient), first = await source.client.complete(firstRequest);
    const target = fixture(createOfficialModelClient), input = continuation(first);
    input.messages[1].providerState.entries.push({ kind: "provider", part: structuredClone(privatePart) });
    await assert.rejects(target.client.complete(input), (error: unknown) => error instanceof OfficialModelError && error.retrySafe === true);
    assert.equal(target.bodies.length, 0); assert.equal(target.reads.length, 0);
  });

  test(`legacy refuses newly returned media plus ${label} while retaining the first call's usage`, async () => {
    const target = fixture(createOfficialModelClient, {}, false, privatePart);
    const events: string[] = [];
    await assert.rejects(target.client.complete({ ...firstRequest, onModelEvent: event => { events.push(event.type); } }), (error: unknown) => {
      assert.ok(error instanceof OfficialModelError); assert.equal(error.usageKnown, true);
      assert.deepEqual(error.usage, { inputTokens: 1, outputTokens: 2 }); assert.equal(error.retrySafe, false); return true;
    });
    assert.equal(target.bodies.length, 1); assert.equal(target.reads.length, 0);
    assert.equal(events.filter(type => type === "response.failed").length, 1);
    assert.equal(events.includes("response.completed"), false);
  });
}

for (const [label, make, other] of [["SDK", createPreferredOfficialModelClient, createOfficialModelClient],
  ["legacy", createOfficialModelClient, createPreferredOfficialModelClient]] as const) {
  test(`${label} rejects the other adapter's genuine private template before any host read or POST`, async () => {
    const source = fixture(other), first = await source.client.complete(firstRequest);
    const target = fixture(make);
    await assert.rejects(target.client.complete(continuation(first)), (error: unknown) => error instanceof OfficialModelError && error.retrySafe === true);
    assert.equal(target.reads.length, 0); assert.equal(target.bodies.length, 0);
  });

  test(`${label} re-authorizes the same hash in a different assistant message and stops on denial`, async () => {
    const positions: number[][] = [];
    const target = fixture(make, { resolveAssistantOutputAsset: async (request: any) => {
      assert.equal(Object.isFrozen(request.asset), true);
      positions.push([request.messageIndex, request.partIndex]);
      if (request.messageIndex === 3) throw new Error("Synthetic other-owner denial");
      return bytes;
    } });
    const input = continuation(); input.messages.push({ role: "assistant", content: "", outputParts: [structuredClone(image)] });
    await assert.rejects(target.client.complete(input), (error: unknown) => error instanceof OfficialModelError && error.code === "ASSISTANT_OUTPUT_UNAVAILABLE");
    assert.deepEqual(positions, [[1, 1], [3, 0]]); assert.equal(target.bodies.length, 0);
  });

  test(`${label} aborting inside an authorized resolver prevents later reads and POST`, async () => {
    const controller = new AbortController(); let reads = 0;
    const target = fixture(make, { resolveAssistantOutputAsset: async () => { reads++; controller.abort(); return bytes; } });
    const input = continuation(); input.signal = controller.signal; input.messages[1].outputParts.push(structuredClone(image));
    await assert.rejects(target.client.complete(input), (error: unknown) => {
      assert.ok(error instanceof OfficialModelError); assert.equal(error.code, "CANCELLED");
      assert.equal(error.usageKnown, true); assert.deepEqual(error.usage, { inputTokens: 0, outputTokens: 0 }); return true;
    });
    assert.equal(reads, 1); assert.equal(target.bodies.length, 0);
  });

  test(`${label} a noncooperating host read meets the local deadline and cannot dispatch a late result`, { timeout: 4000 }, async () => {
    let release!: (value: Uint8Array) => void;
    const target = fixture(make, { timeoutMs: 1000, resolveAssistantOutputAsset: () => new Promise<Uint8Array>(resolve => { release = resolve; }) });
    const pending = target.client.complete(continuation());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([pending.then(() => undefined, error => error), new Promise(resolve => { timer = setTimeout(() => resolve("deadline missed"), 2500); })]);
      assert.ok(outcome instanceof OfficialModelError); assert.equal(outcome.code, "TIMEOUT");
      release(bytes); await assert.rejects(pending); await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(target.bodies.length, 0);
    } finally { if (timer) clearTimeout(timer); release?.(bytes); }
  });
}
