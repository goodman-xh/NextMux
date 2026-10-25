import assert from "node:assert/strict";
import test from "node:test";

import { createAiSdkModelClient } from "../lib/index.js";

function sseResponse(events: readonly unknown[]): Response {
  return new Response(
    `${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("Azure OpenAI uses the official Responses transport and deployment-safe auth", async () => {
  let capturedUrl = "";
  let capturedHeaders: Headers | undefined;
  let capturedBody: any;
  const client = createAiSdkModelClient({
    providerId: "azure_openai",
    protocol: "openai_responses",
    baseUrl: "https://resource.openai.azure.com/openai/v1",
    providerSettings: { apiVersion: "2024-10-21" },
    apiKey: "azure-secret",
    model: "coding-deployment",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body));
      return sseResponse([
        { type: "response.created", response: { id: "azure-response", created_at: 1, model: "coding-deployment", service_tier: null } },
        { type: "response.in_progress", response: { id: "azure-response", created_at: 1, model: "coding-deployment", service_tier: null } },
        { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "azure-message", phase: "final_answer" } },
        { type: "response.output_text.delta", item_id: "azure-message", output_index: 0, delta: "Azure is ready" },
        { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "azure-message", phase: "final_answer" } },
        { type: "response.completed", response: { usage: { input_tokens: 4, input_tokens_details: null, output_tokens: 3, output_tokens_details: { reasoning_tokens: 0 } }, service_tier: "default" } },
      ]);
    },
  });

  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.equal(capturedUrl, "https://resource.openai.azure.com/openai/v1/responses");
  assert.equal(capturedHeaders?.get("api-key"), "azure-secret");
  assert.equal(capturedHeaders?.get("authorization"), null);
  assert.equal(capturedBody.model, "coding-deployment");
  assert.equal(capturedBody.stream, true);
  assert.equal(result.content, "Azure is ready");
  assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 3 });
});

test("Google Vertex uses the official publisher endpoint and API-key header", async () => {
  let capturedUrl = "";
  let capturedHeaders: Headers | undefined;
  let capturedBody: any;
  const client = createAiSdkModelClient({
    providerId: "vertex",
    protocol: "gemini_generate_content",
    baseUrl: "https://aiplatform.googleapis.com/v1/publishers/google",
    providerSettings: { project: "demo-project", location: "us-central1" },
    apiKey: "vertex-secret",
    model: "gemini-2.5-flash",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body));
      return sseResponse([{
        candidates: [{
          content: { role: "model", parts: [{ text: "Vertex is ready" }] },
          finishReason: "STOP",
          index: 0,
        }],
        usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 3, totalTokenCount: 9 },
      }]);
    },
  });

  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.equal(capturedUrl, "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
  assert.equal(capturedHeaders?.get("x-goog-api-key"), "vertex-secret");
  assert.equal(capturedHeaders?.get("authorization"), null);
  assert.equal(capturedBody.contents[0].parts[0].text, "hello");
  assert.equal(result.content, "Vertex is ready");
  assert.deepEqual(result.usage, { inputTokens: 6, outputTokens: 3 });
});

test("Amazon Bedrock uses Converse streaming and maps reasoning effort without Chat Completions", async () => {
  let capturedUrl = "";
  let capturedHeaders: Headers | undefined;
  let capturedBody: any;
  const client = createAiSdkModelClient({
    providerId: "bedrock",
    reasoningControls: [{type:"effort",parameter:"additionalModelRequestFields.reasoningConfig.maxReasoningEffort",values:["low","medium","high"],mapping:{xhigh:"high"},support:"supported",source:"provider_metadata",scope:"route"}],
    // Bedrock is represented by the existing protocol union for routing, but
    // must still use its provider-native Converse transport.
    protocol: "openai_chat_completions",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    providerSettings: { region: "us-east-1" },
    apiKey: "bedrock-bearer",
    model: "us.amazon.nova-2-lite-v1:0",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ message: "probe rejection" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await assert.rejects(
    client.complete({ messages: [{ role: "user", content: "hello" }], tools: [], reasoningEffort: "xhigh" }),
  );
  assert.equal(capturedUrl, "https://bedrock-runtime.us-east-1.amazonaws.com/model/us.amazon.nova-2-lite-v1%3A0/converse-stream");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer bedrock-bearer");
  assert.equal(capturedBody.messages[0].content[0].text, "hello");
  assert.deepEqual(capturedBody.additionalModelRequestFields.reasoningConfig, {
    type: "enabled",
    maxReasoningEffort: "high",
  });
  assert.equal(capturedUrl.includes("chat/completions"), false);
});

test("provider-native environment credential mode delegates secret lookup to each maintained SDK", async () => {
  const previousAzureKey = process.env.AZURE_API_KEY;
  const previousVertexKey = process.env.GOOGLE_VERTEX_API_KEY;
  const previousBedrockKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
  try {
    process.env.AZURE_API_KEY = "azure-environment-secret";
    let azureHeaders: Headers | undefined;
    const azure = createAiSdkModelClient({
      providerId: "azure_openai",
      protocol: "openai_responses",
      baseUrl: "https://resource.openai.azure.com/openai/v1",
      providerSettings: { credentialSource: "environment" },
      apiKey: "",
      model: "coding-deployment",
      fetchImpl: async (_input, init) => {
        azureHeaders = new Headers(init?.headers);
        return sseResponse([
          { type: "response.created", response: { id: "azure-env", created_at: 1, model: "coding-deployment", service_tier: null } },
          { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "azure-env-message", phase: "final_answer" } },
          { type: "response.output_text.delta", item_id: "azure-env-message", output_index: 0, delta: "ok" },
          { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "azure-env-message", phase: "final_answer" } },
          { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 }, service_tier: "default" } },
        ]);
      },
    });
    await azure.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
    assert.equal(azureHeaders?.get("api-key"), "azure-environment-secret");

    process.env.GOOGLE_VERTEX_API_KEY = "vertex-environment-secret";
    let vertexHeaders: Headers | undefined;
    const vertex = createAiSdkModelClient({
      providerId: "vertex",
      protocol: "gemini_generate_content",
      baseUrl: "https://aiplatform.googleapis.com/v1/publishers/google",
      providerSettings: { credentialSource: "environment" },
      apiKey: "",
      model: "gemini-2.5-flash",
      fetchImpl: async (_input, init) => {
        vertexHeaders = new Headers(init?.headers);
        return sseResponse([{ candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP", index: 0 }] }]);
      },
    });
    await vertex.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
    assert.equal(vertexHeaders?.get("x-goog-api-key"), "vertex-environment-secret");

    process.env.AWS_BEARER_TOKEN_BEDROCK = "bedrock-environment-secret";
    let bedrockHeaders: Headers | undefined;
    const bedrock = createAiSdkModelClient({
      providerId: "bedrock",
    reasoningControls: [{type:"effort",parameter:"additionalModelRequestFields.reasoningConfig.maxReasoningEffort",values:["low","medium","high"],mapping:{xhigh:"high"},support:"supported",source:"provider_metadata",scope:"route"}],
      protocol: "openai_chat_completions",
      baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
      providerSettings: { credentialSource: "environment", region: "us-east-1" },
      apiKey: "",
      model: "us.amazon.nova-2-lite-v1:0",
      fetchImpl: async (_input, init) => {
        bedrockHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({ message: "expected probe rejection" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await assert.rejects(bedrock.complete({ messages: [{ role: "user", content: "hello" }], tools: [] }));
    assert.equal(bedrockHeaders?.get("authorization"), "Bearer bedrock-environment-secret");
  } finally {
    if (previousAzureKey === undefined) delete process.env.AZURE_API_KEY;
    else process.env.AZURE_API_KEY = previousAzureKey;
    if (previousVertexKey === undefined) delete process.env.GOOGLE_VERTEX_API_KEY;
    else process.env.GOOGLE_VERTEX_API_KEY = previousVertexKey;
    if (previousBedrockKey === undefined) delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    else process.env.AWS_BEARER_TOKEN_BEDROCK = previousBedrockKey;
  }
});
