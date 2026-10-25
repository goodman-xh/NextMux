import assert from "node:assert/strict";
import test from "node:test";
import { createAiSdkModelClient, createOfficialModelClient } from "../lib/index.js";
import type { OfficialModelClientOptions } from "../lib/index.js";

const tool = { name: "workspace.read_file", description: "Read a file", inputSchema: { type: "object", properties: { path: { type: "string" } } },
  requiredPermission: "read_only", source: "builtin" } as const;
const prompt = { role: "user", content: "Inspect this file and retain the findings." } as const;

// Exercise actual provider serialization using local synthetic responses. No network or model usage.
for (const [label, make] of [["SDK", createAiSdkModelClient], ["legacy", createOfficialModelClient]] as const) {
  for (const change of ["same", "model", "endpoint", "unscoped", ...(label === "SDK" ? ["provider" as const] : [])] as const) {
    test(`${label} ${change}: continuation retains public history and scopes provider-private state`, async () => {
      const bodies: any[] = [];
      const options: OfficialModelClientOptions = {
        providerId: "gemini", protocol: "gemini_generate_content", baseUrl: "https://first.example.test/v1beta",
        apiKey: "synthetic-key", model: "gemini-test", fetchImpl: async (input, init) => {
          const body = JSON.parse(String(init?.body)); bodies.push(body);
          if (body.messages) return new Response(`data: ${JSON.stringify({ id: "next-response", model: "next-model",
            choices: [{ index: 0, delta: { role: "assistant", content: "Finished" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } });
          const parts = bodies.length === 1 ? [
            { text: "Preserved analysis", thought: true, thoughtSignature: "private-analysis-signature" },
            { text: "Visible finding" },
            { functionCall: { id: "read-one", name: body.tools[0].functionDeclarations[0].name, args: { path: "sample.txt" } },
              thoughtSignature: "private-tool-signature" }
          ] : [{ text: "Finished" }];
          const payload = { candidates: [{ index: 0, content: { role: "model", parts }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 } };
          return String(input).includes(":streamGenerateContent")
            ? new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream" } })
            : Response.json(payload);
        }
      };
      const first = await make(options).complete({ messages: [prompt], tools: [tool] });
      assert.equal(first.content, "Visible finding");
      const content = first.content || "";
      const state = structuredClone(first.providerState) as any;
      if (change === "unscoped") { delete state.providerScope; delete state.replayScope; delete state.scope; }
      const messages = [prompt, { role: "assistant", content, toolCalls: first.toolCalls, providerState: state },
        { role: "tool", toolCallId: "read-one", content: "File content and test evidence" },
        { role: "user", content: "Continue with these findings." }] as const;
      const original = JSON.stringify(messages);
      const next = make({ ...options, ...(change === "model" ? { model: "gemini-second" } : {}),
        ...(change === "endpoint" ? { baseUrl: "https://second.example.test/v1beta" } : {}),
        ...(change === "provider" ? { providerId: "custom_openai", protocol: "openai_chat_completions", model: "next-model",
          baseUrl: "https://compatible.example.test/v1" } as const : {}) });
      await next.complete({ messages, tools: [tool] });
      const body = bodies[1], serialized = JSON.stringify(body);
      for (const text of [prompt.content, content, "File content and test evidence", "Continue with these findings."]) {
        assert.ok(serialized.includes(text), text);
      }
      assert.match(serialized, /Preserved analysis/);
      if (change === "provider") {
        const calls = body.messages.flatMap((message: any) => message.tool_calls || []);
        const results = body.messages.filter((message: any) => message.role === "tool");
        assert.equal(calls.length, 1); assert.equal(results.length, 1);
        assert.equal(calls[0].id, results[0].tool_call_id);
        assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: "sample.txt" });
      } else {
        const calls = body.contents.flatMap((message: any) => message.parts).filter((part: any) => part.functionCall);
        const results = body.contents.flatMap((message: any) => message.parts).filter((part: any) => part.functionResponse);
        assert.equal(calls.length, 1); assert.equal(results.length, 1);
        assert.equal(calls[0].functionCall.name, results[0].functionResponse.name);
        assert.deepEqual(calls[0].functionCall.args, { path: "sample.txt" });
      }
      if (change === "same") {
        assert.match(serialized, /private-analysis-signature/); assert.match(serialized, /private-tool-signature/);
      } else {
        assert.doesNotMatch(serialized, /private-analysis-signature|private-tool-signature/);
      }
      assert.equal(JSON.stringify(messages), original, "normalization must not mutate the persisted checkpoint");
    });
  }
}
