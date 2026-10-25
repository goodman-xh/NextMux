import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverOfficialModelCatalog,
  discoverOfficialModels,
  OfficialModelError,
} from "../lib/index.js";

test("discovers and bounds OpenAI-compatible models without a billable generation", async () => {
  let method = "";
  let url = "";
  const models = await discoverOfficialModels({
    protocol: "openai_chat_completions",
    baseUrl: "https://compatible.example.test/v1",
    apiKey: "sk-test-model-discovery-key",
    fetchImpl: async (input, init) => {
      method = init?.method || "";
      url = String(input);
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer sk-test-model-discovery-key");
      return Response.json({ data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }] });
    },
  });

  assert.equal(method, "GET");
  assert.equal(url, "https://compatible.example.test/v1/models");
  assert.deepEqual(models, [{ id: "model-a", label: "model-a" }, { id: "model-b", label: "model-b" }]);
});

test("discovery retains declared token prices for BYOK budgets without inventing missing or extra dimensions", async () => {
  const models = await discoverOfficialModels({ protocol: "openai_chat_completions", baseUrl: "https://compatible.example.test/v1", apiKey: "fixture",
    fetchImpl: async () => Response.json({ data: [
      { id: "priced", pricing: { prompt: "0.000002", completion: "0.000008", input_cache_read: "0.0000005", input_cache_write: "0.000003", request: "0" } },
      { id: "missing", pricing: { prompt: null, completion: "", input_cache_read: -1 } },
      { id: "extra-charge", pricing: { prompt: "0.000002", request: "0.01" } },
      { id: "other-currency", pricing: { prompt: "0.000002", currency: "EUR" } }
    ] }) });
  const priced = models.find(model => model.id === "priced");
  assert.equal(priced?.inputPricePerMillion, 2); assert.equal(priced?.outputPricePerMillion, 8);
  assert.equal(priced?.cachedInputPricePerMillion, 0.5); assert.equal(priced?.cacheWritePricePerMillion, 3);
  for (const model of models.filter(model => model.id !== "priced")) {
    assert.equal(model.inputPricePerMillion, undefined); assert.equal(model.outputPricePerMillion, undefined);
  }
});

test("discovery retains only explicitly declared reasoning-effort enum values", async () => {
  const rows = [
    { id: "gpt-5.5", supported_parameters: ["reasoning", "reasoning_effort"] },
    { id: "plain", reasoning: true },
    { id: "explicit-array", reasoning_efforts: ["high", "low", "low", "ultra"] },
    { id: "explicit-options", reasoning_options: { effort: { enum: ["medium", "high"] } } },
    { id: "explicit-parameter", supported_parameters: { reasoning_effort: { enum: ["low", "xhigh"] } } },
    { id: "explicit-descriptor", supported_parameters: [{ name: "reasoning.effort", enum: ["medium", "high"] }] },
    { id: "invalid", reasoning_options: [true, "HIGH", "auto", 1], reasoning_efforts: "low" },
    { id: "openrouter-listing", reasoning: { mandatory: false, supported_efforts: ["max", "xhigh", "high", "none"], default_effort: "high" } },
  ];
  const options = { protocol: "openai_chat_completions" as const, baseUrl: "https://compatible.example.test/v1", apiKey: "synthetic-key",
    fetchImpl: async () => Response.json({ data: rows }) };
  for (const models of [(await discoverOfficialModelCatalog(options)).catalogModels, await discoverOfficialModels(options)]) {
    const efforts = (id: string) => models.find(model => model.id === id)?.reasoningEfforts;
    assert.equal(efforts("gpt-5.5"), undefined, "generic reasoning support is not an advertised effort enum");
    assert.equal(efforts("plain"), undefined);
    assert.equal(efforts("invalid"), undefined);
    assert.deepEqual(efforts("explicit-array"), ["low", "high"]);
    assert.deepEqual(efforts("explicit-options"), ["medium", "high"]);
    assert.deepEqual(efforts("explicit-parameter"), ["low", "xhigh"]);
    assert.deepEqual(efforts("explicit-descriptor"), ["medium", "high"]);
    assert.deepEqual(efforts("openrouter-listing"), ["none", "high", "xhigh", "max"]);
  }
});

test("Gemini discovery keeps explicitly unsupported entries visible with interface evidence", async () => {
  const models = await discoverOfficialModels({
    protocol: "gemini_generate_content",
    baseUrl: "https://generativelanguage.example.test/v1beta",
    apiKey: "AIza-test-model-discovery-key",
    fetchImpl: async (input, init) => {
      assert.match(String(input), /\/v1beta\/models\?pageSize=512$/);
      assert.equal((init?.headers as Record<string, string>)["x-goog-api-key"], "AIza-test-model-discovery-key");
      return Response.json({ models: [
        { name: "models/gemini-chat", displayName: "Gemini Chat", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-only", supportedGenerationMethods: ["embedContent"] },
      ] });
    },
  });

  assert.deepEqual(models, [
    {
      id: "embedding-only",
      label: "embedding-only",
      interfaceSupport: "unsupported",
      interfaceSupportSource: "provider_metadata",
    },
    {
      id: "gemini-chat",
      label: "Gemini Chat",
      interfaceSupport: "supported",
      interfaceSupportSource: "provider_metadata",
    },
  ]);
});

test("catalog discovery separates listed models from models declared for this generation interface", async () => {
  const urls: string[] = [];
  const catalog = await discoverOfficialModelCatalog({
    protocol: "gemini_generate_content",
    baseUrl: "https://generativelanguage.example.test/v1beta",
    apiKey: "AIza-test-model-discovery-key",
    fetchImpl: async input => {
      const url = String(input);
      urls.push(url);
      if (urls.length === 1) {
        return Response.json({
          models: [
            { name: "models/gemini-chat", displayName: "Gemini Chat", supportedGenerationMethods: ["generateContent"] },
            { name: "models/embedding-only", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
          ],
          nextPageToken: "next-page",
        });
      }
      return Response.json({ models: [
        { name: "models/metadata-missing", displayName: "Metadata Missing" },
      ] });
    },
  });

  assert.deepEqual(urls, [
    "https://generativelanguage.example.test/v1beta/models?pageSize=512",
    "https://generativelanguage.example.test/v1beta/models?pageSize=512&pageToken=next-page",
  ]);
  assert.deepEqual(catalog.catalogModels.map(model => model.id), [
    "embedding-only", "gemini-chat", "metadata-missing",
  ]);
  assert.deepEqual(catalog.interfaceSupportedModels.map(model => model.id), ["gemini-chat"]);
  assert.deepEqual(catalog.interfaceUnsupportedModels.map(model => model.id), ["embedding-only"]);
  assert.deepEqual(catalog.interfaceUnverifiedModels.map(model => model.id), ["metadata-missing"]);
  assert.equal(catalog.catalogModels.find(model => model.id === "gemini-chat")?.interfaceSupportSource, "provider_metadata");
  assert.equal(catalog.catalogModels.find(model => model.id === "metadata-missing")?.interfaceSupportSource, "models_endpoint");
});

test("an OpenAI-compatible catalog never promotes directory visibility to verified generation support", async () => {
  const catalog = await discoverOfficialModelCatalog({
    protocol: "openai_chat_completions",
    baseUrl: "https://compatible.example.test/v1",
    apiKey: "sk-test-model-discovery-key",
    fetchImpl: async () => Response.json({ data: [{ id: "catalog-model" }] }),
  });

  assert.deepEqual(catalog.interfaceSupportedModels, []);
  assert.deepEqual(catalog.interfaceUnverifiedModels.map(model => model.id), ["catalog-model"]);
});

test("catalog discovery separates listed models from models declared for this generation interface", async () => {
  const urls: string[] = [];
  const catalog = await discoverOfficialModelCatalog({
    protocol: "gemini_generate_content",
    baseUrl: "https://generativelanguage.example.test/v1beta",
    apiKey: "AIza-test-model-discovery-key",
    fetchImpl: async input => {
      const url = String(input);
      urls.push(url);
      if (urls.length === 1) {
        return Response.json({
          models: [
            { name: "models/gemini-chat", displayName: "Gemini Chat", supportedGenerationMethods: ["generateContent"] },
            { name: "models/embedding-only", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
          ],
          nextPageToken: "next-page",
        });
      }
      return Response.json({ models: [
        { name: "models/metadata-missing", displayName: "Metadata Missing" },
      ] });
    },
  });

  assert.deepEqual(urls, [
    "https://generativelanguage.example.test/v1beta/models?pageSize=512",
    "https://generativelanguage.example.test/v1beta/models?pageSize=512&pageToken=next-page",
  ]);
  assert.deepEqual(catalog.catalogModels.map(model => model.id), [
    "embedding-only", "gemini-chat", "metadata-missing",
  ]);
  assert.deepEqual(catalog.interfaceSupportedModels.map(model => model.id), ["gemini-chat"]);
  assert.deepEqual(catalog.interfaceUnsupportedModels.map(model => model.id), ["embedding-only"]);
  assert.deepEqual(catalog.interfaceUnverifiedModels.map(model => model.id), ["metadata-missing"]);
  assert.equal(catalog.catalogModels.find(model => model.id === "gemini-chat")?.interfaceSupportSource, "provider_metadata");
  assert.equal(catalog.catalogModels.find(model => model.id === "metadata-missing")?.interfaceSupportSource, "models_endpoint");
});

test("an OpenAI-compatible catalog never promotes directory visibility to verified generation support", async () => {
  const catalog = await discoverOfficialModelCatalog({
    protocol: "openai_chat_completions",
    baseUrl: "https://compatible.example.test/v1",
    apiKey: "sk-test-model-discovery-key",
    fetchImpl: async () => Response.json({ data: [{ id: "catalog-model" }] }),
  });

  assert.deepEqual(catalog.interfaceSupportedModels, []);
  assert.deepEqual(catalog.interfaceUnverifiedModels.map(model => model.id), ["catalog-model"]);
});

test("directory HTTP failures retain status even when the upstream body is not JSON", async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    let calls = 0;
    await assert.rejects(discoverOfficialModels({
      protocol: 'openai_chat_completions', baseUrl: 'https://synthetic.example/v1', apiKey: 'synthetic-key',
      fetchImpl: async () => { calls++; return new Response('private gateway diagnostic', { status }); }
    }), (error: any) => {
      assert.equal(error.httpStatus, status);
      assert.doesNotMatch(String(error.message), /private gateway diagnostic/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("discovery does not retry or leak upstream response bodies", async () => {
  let calls = 0;
  await assert.rejects(discoverOfficialModels({
    protocol: "anthropic_messages",
    baseUrl: "https://api.example.test/v1",
    apiKey: "sk-ant-test-model-discovery-key",
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ secret: "must not surface" }, { status: 401 });
    },
  }), (error: unknown) => error instanceof OfficialModelError
    && error.code === "AUTH_FAILED" && !error.message.includes("must not surface"));
  assert.equal(calls, 1);
});


test("actual BYOK discovery preserves route context and output limits through compatibility wrapper", async () => {
  const models = await discoverOfficialModels({ protocol: "openai_chat_completions", baseUrl: "https://compatible.example.test/v1", apiKey: "fixture",
    fetchImpl: async () => Response.json({ data: [
      { id: "deepseek/v4-pro", context_length: 1000000, top_provider: { context_length: 128000, max_completion_tokens: 16000 } },
      { id: "nested-limits", context_length: 128000, limits: { max_completion_tokens: 32000 }, max_output_tokens: 64000 },
      { id: "unknown", context_length: "1000000", max_output_tokens: -1 }
    ] }) });
  assert.deepEqual(models[0], { id: "deepseek/v4-pro", label: "deepseek/v4-pro", contextTokens: 128000, maximumOutputTokens: 16000 });
  assert.deepEqual(models[1], { id: "nested-limits", label: "nested-limits", contextTokens: 128000, maximumOutputTokens: 32000 });
  assert.deepEqual(models[2], { id: "unknown", label: "unknown" });
});

test("Gemini BYOK metadata preserves independent input/output limits rather than inventing a joint window", async () => {
  const models = await discoverOfficialModels({ protocol: "gemini_generate_content", baseUrl: "https://generativelanguage.example.test/v1beta", apiKey: "fixture",
    fetchImpl: async () => Response.json({ models: [{ name: "models/gemini-test", inputTokenLimit: 1000000, outputTokenLimit: 64000,
      supportedGenerationMethods: ["generateContent"] }] }) });
  assert.equal(models[0]?.inputTokens, 1000000); assert.equal(models[0]?.maximumOutputTokens, 64000);
  assert.equal(models[0]?.contextTokens, undefined);
});

test("OpenRouter discovery asks for every output type and keeps more than 512 models", async () => {
  const urls: string[] = [];
  const data = Array.from({ length: 640 }, (_, index) => ({ id: `vendor/model-${index}`, name: `Model ${index}`,
    architecture: { input_modalities: ["text"], output_modalities: [index % 3 === 0 ? "video" : index % 3 === 1 ? "image" : "text"] } }));
  const models = await discoverOfficialModels({
    protocol: "openai_chat_completions",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "sk-or-test-model-discovery-key",
    fetchImpl: async input => { urls.push(String(input)); return Response.json({ data }); },
  });
  assert.equal(new URL(urls[0]).searchParams.get("output_modalities"), "all");
  assert.equal(models.length, 640);
  // Other hosts are unchanged.
  const other: string[] = [];
  await discoverOfficialModels({ protocol: "openai_chat_completions", baseUrl: "https://compatible.example.test/v1", apiKey: "sk-test-model-discovery-key",
    fetchImpl: async input => { other.push(String(input)); return Response.json({ data }); } });
  assert.equal(new URL(other[0]).searchParams.has("output_modalities"), false);
});

test("OpenRouter discovery shows readable names and marks batch-only variants unusable (round 31 live run)", async () => {
  const data = [
    { id: "openai/gpt-5.6-terra", name: "OpenAI: GPT-5.6 Terra" },
    { id: "anthropic/claude-haiku-4.5:batch", name: "Anthropic: Claude Haiku 4.5 (batch)" },
  ];
  const models = await discoverOfficialModels({ protocol: "openai_chat_completions", baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "sk-or-test-model-discovery-key", fetchImpl: async () => Response.json({ data }) });
  const byId = new Map(models.map(model => [model.id, model]));
  assert.equal(byId.get("openai/gpt-5.6-terra")?.label, "OpenAI: GPT-5.6 Terra");
  assert.notEqual(byId.get("openai/gpt-5.6-terra")?.interfaceSupport, "unsupported");
  assert.equal(byId.get("anthropic/claude-haiku-4.5:batch")?.interfaceSupport, "unsupported");
  // A generic OpenAI-compatible host keeps using the id as the label.
  const other = await discoverOfficialModels({ protocol: "openai_chat_completions", baseUrl: "https://compatible.example.test/v1",
    apiKey: "sk-test-model-discovery-key", fetchImpl: async () => Response.json({ data }) });
  assert.equal(other.find(model => model.id === "openai/gpt-5.6-terra")?.label, "openai/gpt-5.6-terra");
  assert.notEqual(other.find(model => model.id === "anthropic/claude-haiku-4.5:batch")?.interfaceSupport, "unsupported");
});


test("normal model discovery retains normalized task and endpoint roles without replacing chat output or prices", async () => {
  const role = { protocol: "openai_decisions", endpoint: "/v1/decisions", role: "decision", canonicalModel: "openai/gpt-6-luna",
    upstreamModelId: "gpt-6-luna", sourceUrl: "https://developers.openai.com/api/docs/guides/decisions.md", sourceHash: "a".repeat(64),
    source: "provider_metadata", scope: "model", tariffRole: "openai_decisions" };
  const tariff = { ...role, kind: "openai_decisions_input_only_v1", currency: "USD",
    rates: { input_token: { unitSize: 1000000, amountMicros: 100000 }, output_token: { unitSize: 1000000, amountMicros: 0 }, cached_input_token: { unitSize: 1000000, amountMicros: 0 }, cache_write_token: { unitSize: 1000000, amountMicros: 0 } },
    requiredDimensions: ["input_token"], documentedPremiums: ["regional_processing", "long_context"], applicability: { regionalProcessing: false, maximumPlatformInputTokens: 32768 }, pricingStatement: "Official dedicated endpoint price" };
  const model = { id: "gpt-6-luna", output_modalities: ["text"], taskCategories: ["language", "decision"], decisionEndpointTariff: tariff,
    decisionEndpointRoles: [role], capabilityDeclarations: { decision: { support: "supported", source: "provider_metadata", scope: "model" } },
    pricing: { prompt: ".0000003", completion: ".000001" } };
  const rows = await discoverOfficialModels({ protocol: "openai_chat_completions", baseUrl: "https://api.openai.com/v1", apiKey: "fixture",
    fetchImpl: async () => Response.json({ data: [model] }) });
  assert.deepEqual(rows[0]?.taskCategories, ["language", "decision"]);
  assert.deepEqual(rows[0]?.decisionEndpointRoles, [role]);
  assert.deepEqual(rows[0]?.decisionEndpointTariff, tariff);
  assert.deepEqual(rows[0]?.outputModalities, ["text"]);
  assert.equal(rows[0]?.inputPricePerMillion, .3); assert.equal(rows[0]?.outputPricePerMillion, 1);
});


test("a relay's explicit Decisions endpoint is retained separately from official role identity", async () => {
  const raw = { id: "gpt-6-luna", supported_endpoints: ["/v1/decisions"] };
  const models = await discoverOfficialModels({ protocol: "openai_chat_completions", baseUrl: "https://generic-relay.example.test/v1", apiKey: "fixture",
    fetchImpl: async () => Response.json({ data: [raw] }) });
  assert.deepEqual(models[0]?.decisionEndpointSupport, { protocol: "openai_decisions", endpoint: "/v1/decisions", support: "supported", source: "provider_metadata", scope: "route" });
  assert.equal(models[0]?.decisionEndpointRoles, undefined);
});
