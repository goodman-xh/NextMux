import assert from "node:assert/strict";
import test from "node:test";
import {
  detectOllama, discoverOfficialModelCatalog, discoverOfficialModels, estimateOllamaPromptTokens,
  getOllamaModelMetadata, ollamaContextLimit, parseOllamaModelMetadata, selectOllamaContextTokens,
} from "../lib/index.js";

const connection = {
  providerId: "ollama" as const, protocol: "openai_chat_completions" as const,
  baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", allowInsecure: true,
};

function mockOllama() {
  let activeShows = 0, maximumShows = 0;
  const requests: string[] = [], shows: string[] = [];
  const models = [
    { name: "coder:latest", digest: "sha256:coder1" },
    { name: "vision:latest", digest: "sha256:vision1" },
    { name: "plain:latest", digest: "sha256:plain1" },
    { name: "embed:latest", digest: "sha256:embed1" },
    ...Array.from({ length: 8 }, (_, index) => ({ name: `extra${index}:latest`, digest: `sha256:extra${index}` })),
  ];
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push(path);
    assert.equal((init?.headers as Record<string, string>).authorization, undefined);
    if (path === "/api/version") return Response.json({ version: "0.18.0" });
    if (path === "/api/tags") return Response.json({ models });
    if (path === "/api/show") {
      assert.equal(init?.method, "POST");
      const { model, verbose } = JSON.parse(String(init?.body));
      assert.equal(verbose, false);
      shows.push(model);
      activeShows += 1; maximumShows = Math.max(maximumShows, activeShows);
      // Yield to other workers to assert the actual in-flight request bound.
      await new Promise(resolve => setTimeout(resolve, 2));
      activeShows -= 1;
      return Response.json({
        capabilities: model.startsWith("embed") ? ["embedding"] : model.startsWith("vision") ? ["completion", "vision", "tools"] : model.startsWith("plain") ? ["completion"] : ["completion", "tools", "thinking"],
        model_info: { "general.architecture": "qwen3", "qwen3.context_length": models[0].digest === "sha256:coder2" ? 65_536 : 131_072, "clip.vision.context_length": 256 },
        details: { parameter_size: "8.2B", quantization_level: "Q4_K_M" },
        thinking: { values: [false, "low", "medium", "high"], default: "medium" },
      });
    }
    assert.fail(`Unexpected endpoint ${path}`);
  };
  return { fetchImpl, requests, shows, models, maximumShows: () => maximumShows };
}

test("Ollama discovery uses native version/tags/show, detects tools and vision, and reports server counts", async () => {
  const server = mockOllama();
  const catalog = await discoverOfficialModelCatalog({ ...connection, providerSettings: { ollamaContextTokens: 32_768 }, fetchImpl: server.fetchImpl });
  assert.deepEqual(catalog.ollamaStatus, { version: "0.18.0", modelCount: 12, toolsModelCount: 10 });
  assert.equal(server.maximumShows(), 4);
  assert.equal(server.shows.length, 12);
  const thinkingControls = catalog.catalogModels.find(model => model.id === "coder:latest")?.reasoningControls;
  assert.deepEqual(thinkingControls?.find(control => control.type === "effort")?.values, ["low", "medium", "high"]);
  assert.deepEqual(thinkingControls?.find(control => control.type === "on-off")?.values, [false]);
  const coder = catalog.catalogModels.find(model => model.id === "coder:latest")!;
  assert.equal(coder.contextTokens, 32_768);
  assert.equal(coder.maxContextTokens, 131_072);
  assert.equal(coder.toolsSupported, true);
  assert.equal(coder.parameterSize, "8.2B");
  assert.equal(coder.quantizationLevel, "Q4_K_M");
  assert.equal(coder.digest, "sha256:coder1");
  assert.deepEqual(coder.reasoningEfforts, ["low", "medium", "high"]);
  assert.deepEqual(catalog.catalogModels.find(model => model.id === "vision:latest")?.inputModalities, ["text", "image"]);
  assert.equal(catalog.catalogModels.find(model => model.id === "plain:latest")?.toolsSupported, false);
  assert.deepEqual(catalog.interfaceUnsupportedModels.map(model => model.id), ["embed:latest"]);
  const chatModels = await discoverOfficialModels({ ...connection, fetchImpl: server.fetchImpl });
  assert.equal(chatModels.some(model => model.id === "embed:latest"), false);
  assert.equal(chatModels.find(model => model.id === "coder:latest")?.toolsSupported, true);
  assert.equal(server.shows.length, 12, "repeated discovery reuses metadata by model digest");
});

test("digest changes invalidate metadata and refresh the named transport cache", async () => {
  const server = mockOllama();
  await discoverOfficialModelCatalog({ ...connection, fetchImpl: server.fetchImpl });
  server.models[0].digest = "sha256:coder2";
  const catalog = await discoverOfficialModelCatalog({ ...connection, fetchImpl: server.fetchImpl });
  assert.equal(server.shows.length, 13);
  assert.equal(catalog.catalogModels.find(model => model.id === "coder:latest")?.maxContextTokens, 65_536);
  const metadata = await getOllamaModelMetadata({ ...connection, model: "coder:latest", fetchImpl: server.fetchImpl });
  assert.equal(metadata.maxContextTokens, 65_536);
  assert.equal(server.shows.length, 13);
});

test("loopback OpenAI-compatible connections are detected without requiring an Ollama preset", async () => {
  const server = mockOllama();
  const catalog = await discoverOfficialModelCatalog({ ...connection, providerId: "custom_openai", fetchImpl: server.fetchImpl });
  assert.equal(catalog.ollamaStatus?.version, "0.18.0");
  assert.equal(catalog.catalogModels.find(model => model.id === "vision:latest")?.toolsSupported, true);
});

test("native endpoint absence falls back to /v1/models without a fake credential", async () => {
  for (const baseUrl of [connection.baseUrl, connection.baseUrl.replace(/\/v1$/, "")]) {
    for (const missing of ["/api/version", "/api/tags"]) {
      const requested: string[] = [];
      const models = await discoverOfficialModels({ ...connection, baseUrl, fetchImpl: async (input, init) => {
        const path = new URL(String(input)).pathname; requested.push(path);
        assert.equal((init?.headers as Record<string, string>).authorization, undefined);
        if (path === missing) return new Response("Not found", { status: 404 });
        if (path === "/api/version") return Response.json({ version: "0.18.0" });
        assert.equal(path, "/v1/models");
        return Response.json({ data: [{ id: "compatible-model" }] });
      } });
      assert.deepEqual(models, [{ id: "compatible-model", label: "compatible-model" }]);
      assert.equal(requested.at(-1), "/v1/models");
    }
  }
});

test("non-Ollama loopback version responses and remote APIs preserve compatibility", async () => {
  assert.equal(await detectOllama({ ...connection, fetchImpl: async () => Response.json({ version: "not-ollama" }) }), undefined);
  let calls = 0;
  assert.equal(await detectOllama({ baseUrl: "https://example.test/v1", fetchImpl: async () => { calls++; return Response.json({ version: "0.18.0" }); } }), undefined);
  assert.equal(calls, 0);
});

test("metadata is explicit, bounded, and independent of Modelfile's small num_ctx default", () => {
  assert.deepEqual(parseOllamaModelMetadata({ parameters: "num_ctx 4096", model_info: { "general.architecture": "llama", "llama.context_length": 131_072, "clip.vision.context_length": 512 }, capabilities: ["completion", "tools", "unknown"], thinking: { values: [true, false], default: true } }), {
    capabilities: ["tools", "completion"], maxContextTokens: 131_072, thinkingValues: [true, false], thinkingDefault: true,
  });
  assert.deepEqual(parseOllamaModelMetadata({ model_info: { "llama.context_length": "131072", "fake.context_length": -1 }, details: { parameter_size: "malformed\nvalue" } }), {});
});

test("Ollama num_ctx rounds request demand to a power of two and honors model/user ceilings", () => {
  assert.equal(selectOllamaContextTokens({ maxContextTokens: 131_072, promptTokens: 1_000, maxOutputTokens: 2_000 }), 16_384);
  assert.equal(selectOllamaContextTokens({ maxContextTokens: 131_072, promptTokens: 25_000, maxOutputTokens: 8_000 }), 65_536);
  assert.equal(selectOllamaContextTokens({ maxContextTokens: 131_072, userContextTokens: 32_768, promptTokens: 25_000, maxOutputTokens: 8_000 }), 32_768);
  assert.equal(selectOllamaContextTokens({ maxContextTokens: 8_192, promptTokens: 1_000, maxOutputTokens: 1_000 }), 8_192);
  assert.equal(selectOllamaContextTokens({ maxContextTokens: 30_000, promptTokens: 20_000, maxOutputTokens: 8_000 }), 30_000);
  assert.equal(selectOllamaContextTokens({ maxContextTokens: 131_072, userContextTokens: 8_192, promptTokens: 1_000 }), 8_192);
  assert.equal(ollamaContextLimit({ maxContextTokens: 131_072, userContextTokens: 65_536 }), 65_536);
  assert.equal(ollamaContextLimit({}), 16_384);
  assert.equal(ollamaContextLimit({ userContextTokens: 65_536 }), 65_536);
});

test("context estimation budgets tool schemas, multilingual instructions, history and image tokens", () => {
  const base = { instructions: "请检查代码", messages: [{ role: "user" as const, content: "Read the image" }], tools: [] };
  const small = estimateOllamaPromptTokens(base);
  const withTools = estimateOllamaPromptTokens({ ...base, tools: [{ name: "read_file", description: "Reads source", inputSchema: { type: "object", properties: { path: { type: "string", description: "x".repeat(60_000) } } }, source: "builtin", requiredPermission: "read_only" }] });
  assert.ok(withTools > small + 20_000);
  const withImage = (dataBase64: string) => estimateOllamaPromptTokens({ ...base, messages: [{ ...base.messages[0], attachments: [{ kind: "image", name: "diagram", mimeType: "image/png", dataBase64 }] }] });
  assert.ok(withImage("ZmFrZQ==") >= small + 8_192);
  assert.equal(withImage("ZmFrZQ=="), withImage("a".repeat(4_000_000)), "binary size is not the image token cost");
});

test("cancelled native discovery never falls through to the compatible endpoint", async () => {
  const controller = new AbortController(); controller.abort();
  let requests = 0;
  await assert.rejects(discoverOfficialModelCatalog({ ...connection, signal: controller.signal, fetchImpl: async () => { requests++; return Response.json({}); } }), (error: any) => error.code === "CANCELLED");
  assert.equal(requests, 0);
});
