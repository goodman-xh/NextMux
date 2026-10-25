import assert from "node:assert/strict";
import test from "node:test";
import { applyModelRequestContract, parseModelContract, discoverOfficialModels, createOfficialModelClient, createAiSdkModelClient, type ModelReasoningControl } from "../lib/index.js";

const declaration = (parameter: string, overrides: Partial<ModelReasoningControl> = {}): ModelReasoningControl => ({ type: "effort", parameter,
  values: ["low", "high"], support: "supported", source: "provider_metadata", scope: "route", ...overrides });
const request = { messages: [{ role: "user" as const, content: "hello" }], tools: [], maxOutputTokens: 4096 };
function response(protocol: string, model: string): Response {
  return Response.json(protocol === "anthropic_messages" ? { model, content: [{type:"text",text:"ok"}],usage:{input_tokens:1,output_tokens:1} }
    : protocol === "gemini_generate_content" ? { modelVersion:model,candidates:[{content:{role:"model",parts:[{text:"ok"}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1} }
    : protocol === "cohere_chat" ? { id:"cohere-1",message:{content:[{type:"text",text:"ok"}]},usage:{tokens:{input_tokens:1,output_tokens:1}} }
    : {model,choices:[{message:{role:"assistant",content:"ok"}}],usage:{prompt_tokens:1,completion_tokens:1}});
}
async function capture(protocol: any, controls: readonly ModelReasoningControl[], extraRequest: any = {}, extraOptions: any = {}): Promise<any> {
  let captured: any;
  const options = { protocol, model:"future-model-no-name-inference",baseUrl:"https://provider.test/v1",apiKey:"fixture",reasoningControls:controls,...extraOptions };
  const client = createOfficialModelClient({...options,fetchImpl:async (_url,init) => {captured=JSON.parse(String(init?.body)); return response(protocol,options.model);}});
  await client.complete({...request,...extraRequest});
  return captured;
}

test("M008 OpenRouter unifies reasoning for every declared family without effort enums", async () => {
  for (const model of ["anthropic/claude-future","google/gemini-future","qwen/new","zhipu/glm-new","openai/gpt-6-sol"]) {
    const contract = parseModelContract({supported_parameters:["reasoning","include_reasoning"]},{protocol:"openrouter",scope:"route"});
    const body = await capture("openai_chat_completions",contract.reasoningControls!,{reasoningEffort:"high"},{...contract,providerId:"openrouter",model,baseUrl:"https://router-relay.test/api/v1"});
    assert.deepEqual(body.reasoning,{effort:"high"}); assert.equal(body.reasoning_effort,undefined);
    const budget = await capture("openai_chat_completions",contract.reasoningControls!,{reasoningEffort:"high",reasoningBudgetTokens:2000,reasoningExclude:true},{...contract,providerId:"openrouter",model,baseUrl:"https://router-relay.test/api/v1"});
    assert.deepEqual(budget.reasoning,{max_tokens:2000,exclude:true});
  }
});

test("M008 SDK Chat uses the same normalized OpenRouter controls", async () => {
  let body: any;
  const contract=parseModelContract({supported_parameters:["reasoning"]},{protocol:"openrouter",scope:"route"});
  const client=createAiSdkModelClient({providerId:"openrouter",protocol:"openai_chat_completions",baseUrl:"https://openrouter.ai/api/v1",apiKey:"fixture",model:"vendor/future",...contract,
    fetchImpl:async (_url,init)=> {body=JSON.parse(String(init?.body));return new Response('data: {"id":"1","model":"vendor/future","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n',{headers:{"content-type":"text/event-stream"}});}});
  await client.complete({...request,reasoningEffort:"minimal"});assert.deepEqual(body.reasoning,{effort:"minimal"});assert.equal(body.reasoning_effort,undefined);
});

test("M008 only official OpenAI origin receives max_completion_tokens for reasoning families", async () => {
  for (const model of ["o3","o4-mini","gpt-5.4","gpt-6-sol"]) {
    const official=await capture("openai_chat_completions",[],{}, {model,baseUrl:"https://api.openai.com/v1"});
    assert.equal(official.max_completion_tokens,4096);assert.equal(official.max_tokens,undefined);
    const relay=await capture("openai_chat_completions",[],{}, {model,providerId:"openai",baseUrl:"https://compatible.test/v1"});
    assert.equal(relay.max_tokens,4096);assert.equal(relay.max_completion_tokens,undefined);
  }
});

test("M008 Cohere consumes effort only via declared native budget mapping", async () => {
  const body=await capture("cohere_chat",[declaration("thinking.token_budget",{mapping:{low:1024,high:8192},min:1})],{reasoningEffort:"high"});
  assert.deepEqual(body.thinking,{type:"enabled",token_budget:4095});assert.equal(body.thinking.effort,undefined);
});

test("M008 Anthropic adaptive and enabled budget remain separate from output effort", async () => {
  const controls=[declaration("output_config.effort"),declaration("thinking.type",{type:"adaptive",values:["adaptive","enabled","disabled"]}),declaration("thinking.budget_tokens",{type:"budget",min:1024})];
  const adaptive=await capture("anthropic_messages",controls,{reasoningEffort:"high",reasoningMode:"adaptive",reasoningBudgetTokens:2000});
  assert.deepEqual(adaptive.thinking,{type:"adaptive"});assert.deepEqual(adaptive.output_config,{effort:"high"});
  const enabled=await capture("anthropic_messages",controls,{reasoningMode:"enabled",reasoningBudgetTokens:3000});assert.deepEqual(enabled.thinking,{type:"enabled",budget_tokens:3000});
  const off=await capture("anthropic_messages",controls,{reasoningEnabled:false,reasoningBudgetTokens:3000});assert.deepEqual(off.thinking,{type:"disabled"});
});

test("M008 Gemini follows declared level or budget, including provider automatic -1", async () => {
  const level=await capture("gemini_generate_content",[declaration("generationConfig.thinkingConfig.thinkingLevel",{mapping:{xhigh:"high"}})],{reasoningEffort:"xhigh"});assert.equal(level.generationConfig.thinkingConfig.thinkingLevel,"high");
  const budget=await capture("gemini_generate_content",[declaration("generationConfig.thinkingConfig.thinkingBudget",{type:"budget",min:-1})],{reasoningBudgetTokens:-1});assert.equal(budget.generationConfig.thinkingConfig.thinkingBudget,-1);
});

test("M008 native DeepSeek Qwen GLM switches use declaration and omit unsupported effort", async () => {
  for (const providerId of ["deepseek","qwen","zhipu"]) {
    const parameter=providerId==="qwen"?"enable_thinking":"thinking.type";
    const controls=[declaration(parameter,{type:"on-off",values:parameter==="enable_thinking"?[true,false]:["enabled","disabled"]}),...(providerId==="qwen"?[declaration("thinking_budget",{type:"budget",min:1})]:[])];
    const body=await capture("openai_chat_completions",controls,{reasoningEnabled:true,reasoningBudgetTokens:1500,reasoningEffort:"xhigh"},{providerId});
    assert.equal(body.reasoning_effort,undefined);
    if (providerId==="qwen") {assert.equal(body.enable_thinking,true);assert.equal(body.thinking_budget,1500);} else assert.deepEqual(body.thinking,{type:"enabled"});
  }
  const hidden=await capture("openai_chat_completions",[declaration("reasoning_effort")],{reasoningEffort:"xhigh"});assert.equal(hidden.reasoning_effort,undefined);
});

test("M009 native Anthropic model metadata retains max_tokens and explicit false", async () => {
  const [model]=await discoverOfficialModels({protocol:"anthropic_messages",baseUrl:"https://api.anthropic.test/v1",apiKey:"fixture",fetchImpl:async()=>Response.json({data:[{id:"new-claude",max_input_tokens:1_000_000,max_tokens:128_000,
    capabilities:{effort:{supported:true,low:{supported:true},max:{supported:true},high:{supported:false}},thinking:{supported:true,types:{adaptive:{supported:true},enabled:{supported:false}}},image_input:{supported:false},pdf_input:{supported:true},structured_outputs:{supported:true}}}]})});
  assert.equal(model.inputTokens,1_000_000);assert.equal(model.maximumOutputTokens,128_000);assert.deepEqual(model.reasoningEfforts,["low","max"]);
  assert.equal(model.capabilityDeclarations?.["input:image"].support,"unsupported");assert.equal(model.capabilityDeclarations?.["input:pdf"].support,"supported");assert.equal(model.capabilityDeclarations?.structured_output.support,"supported");
  assert.deepEqual(model.reasoningControls?.find(control=>control.parameter==="thinking.type")?.values,["adaptive"]);assert.deepEqual(model.inputModalities,["text","pdf"]);
});

test("DeepSeek models metadata retains documented effort levels, default, limits and modalities", async () => {
  // https://api-docs.deepseek.com/api/list-models/
  const item = { id: "deepseek-flash", object: "model", owned_by: "deepseek", name: "DeepSeek-V4.1-Flash",
    context_window: 1_048_576, max_output_tokens: 393_216, input_modalities: ["text", "image"], output_modalities: ["text"],
    effort: { supported_levels: ["low", "high", "max"], default_level: "high" },
    api_capabilities: { anthropic_messages: { system_prompt_update: "in-history" } } };
  const [model] = await discoverOfficialModels({ protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com", apiKey: "fixture",
    fetchImpl: async () => Response.json({ object: "list", data: [item] }) });
  assert.deepEqual(model.reasoningEfforts, ["low", "high", "max"]);
  assert.deepEqual(model.reasoningControls?.find(control => control.type === "effort"), {
    type: "effort", parameter: "reasoning_effort", values: ["low", "high", "max"], default: "high",
    support: "supported", source: "provider_metadata", scope: "route",
  });
  assert.equal(model.contextTokens, 1_048_576);
  assert.equal(model.maximumOutputTokens, 393_216);
  assert.deepEqual(model.inputModalities, ["text", "image"]);
  assert.equal(model.capabilityDeclarations?.["input:image"]?.support, "supported");
  const invalidDefault = parseModelContract({ effort: { supported_levels: ["low", "high"], default_level: "none" } }, { protocol: "openai", scope: "route" });
  assert.equal(invalidDefault.reasoningControls?.[0]?.default, undefined);
});

test("M017 bounded model contracts preserve source scope limits and unknown without inventing transport capability",()=> {
  const contract=parseModelContract({supported_parameters:["tools","reasoning","structured_outputs","web_search","parallel_tool_calls"],reasoning_efforts:["minimal","low","high","xhigh"],streaming:false,modality_limits:{image:{max_width:8192,max_count:6},audio:{max_seconds:600}},capabilityDeclarations:{prompt_caching:{support:"unsupported",source:"merchant_declaration",scope:"route"}}},{protocol:"openrouter",scope:"model"});
  assert.equal(contract.capabilityDeclarations?.tools.scope,"model");assert.equal(contract.capabilityDeclarations?.streaming.support,"unsupported");assert.equal(contract.capabilityDeclarations?.["input:pdf"].support,"unknown");assert.equal(contract.capabilityDeclarations?.web_search.support,"supported");assert.equal(contract.capabilityDeclarations?.parallel_tool_calls.support,"supported");assert.equal(contract.capabilityDeclarations?.prompt_caching.source,"merchant_declaration");
  assert.deepEqual(contract.modalityLimits,{image:{max_width:8192,max_count:6},audio:{max_seconds:600}});
  const body=applyModelRequestContract({reasoning_effort:"raw"},{protocol:"openai",model:"future",baseUrl:"https://provider.test",reasoningControls:[declaration("reasoning_effort",{scope:"transport"})]},{reasoningEffort:"high"});assert.equal(body.reasoning_effort,undefined);
});


test("declared off and explicit budget cannot produce conflicting reasoning knobs", () => {
  const contract = parseModelContract({ supported_parameters: ["reasoning"] }, { protocol: "openrouter", scope: "route" });
  const off = applyModelRequestContract({}, { protocol: "openrouter", baseUrl: "https://relay.test", model: "future", ...contract }, { reasoningEnabled: false, reasoningEffort: "high", reasoningBudgetTokens: 1024 });
  assert.deepEqual(off.reasoning, { enabled: false });
  const gemini = applyModelRequestContract({}, { protocol: "gemini", baseUrl: "https://provider.test", model: "future", reasoningControls: [declaration("generationConfig.thinkingConfig.thinkingLevel"), declaration("generationConfig.thinkingConfig.thinkingBudget", { type: "budget", min: -1 })] }, { reasoningEffort: "high", reasoningBudgetTokens: 0 });
  assert.deepEqual(gemini.generationConfig.thinkingConfig, { thinkingBudget: 0 });
});


test("parameter-name declarations expose native switches and budgets without name heuristics", () => {
  const contract = parseModelContract({ supported_parameters: ["enable_thinking", "thinking_budget", "thinking.type", "thinking.token_budget", "generationConfig.thinkingConfig.thinkingBudget"] }, { protocol: "openai", scope: "route" });
  assert.deepEqual(contract.reasoningControls?.find(control => control.parameter === "enable_thinking")?.values, [true, false]);
  assert.deepEqual(contract.reasoningControls?.find(control => control.parameter === "thinking.type")?.values, ["enabled", "disabled"]);
  for (const parameter of ["thinking_budget", "thinking.token_budget", "generationConfig.thinkingConfig.thinkingBudget"]) assert.equal(contract.reasoningControls?.find(control => control.parameter === parameter)?.support, "supported");
});

test("explicit media unsupported rejects both native and SDK requests before transport dispatch", async () => {
  for (const factory of [createOfficialModelClient, createAiSdkModelClient]) {
    let called = false;
    const client = factory({ protocol: "anthropic_messages", baseUrl: "https://anthropic.test/v1", apiKey: "fixture", model: "claude-future", capabilityDeclarations: { "input:image": { support: "unsupported", source: "provider_metadata", scope: "route" } }, fetchImpl: async () => { called = true; return response("anthropic_messages", "claude-future"); } });
    await assert.rejects(client.complete({ tools: [], messages: [{ role: "user", content: "inspect", attachments: [{ kind: "image", name: "image.png", mimeType: "image/png", dataBase64: "aGVsbG8=" }] }] }), { code: "UNSUPPORTED_CAPABILITY" });
    assert.equal(called, false);
  }
});


test("OpenRouter native reasoning metadata retains mandatory/default/max_tokens and null effort semantics", () => {
  const contract = parseModelContract({ reasoning: { supported_efforts: ["none", "minimal", "high", "max"], default_effort: "high", default_enabled: true, mandatory: true, supports_max_tokens: false } }, { protocol: "openrouter", scope: "route" });
  const effort = contract.reasoningControls?.find(control => control.type === "effort");
  assert.deepEqual(effort?.values, ["minimal", "high", "max"]); assert.equal(effort?.mandatory, true); assert.equal(effort?.default, "high");
  assert.deepEqual(contract.reasoningControls?.find(control => control.parameter === "reasoning.enabled")?.values, [true]);
  assert.equal(contract.reasoningControls?.find(control => control.type === "budget")?.support, "unsupported");
  const body = applyModelRequestContract({}, { protocol: "openrouter", model: "future", baseUrl: "https://relay.test", ...contract }, { reasoningEffort: "none", reasoningEnabled: false, reasoningBudgetTokens: 9999 });
  assert.equal(body.reasoning?.effort, undefined); assert.notEqual(body.reasoning?.enabled, false); assert.equal(body.reasoning?.max_tokens, undefined);
  const all = parseModelContract({ reasoning: { supported_efforts: null } }, { protocol: "openrouter", scope: "route" });
  assert.ok(all.reasoningControls?.find(control => control.type === "effort")?.values?.includes("max"));
  const offDefault = parseModelContract({ reasoning: { supported_efforts: null, default_effort: "none", default_enabled: false } }, { protocol: "openrouter", scope: "route" });
  const enabled = applyModelRequestContract({}, { protocol: "openrouter", model: "future", baseUrl: "https://relay.test", ...offDefault }, { reasoningEnabled: true });
  assert.deepEqual(enabled.reasoning, { enabled: true });
  const explicitEffort = applyModelRequestContract({}, { protocol: "openrouter", model: "future", baseUrl: "https://relay.test", ...offDefault }, { reasoningEffort: "high" });
  assert.deepEqual(explicitEffort.reasoning, { effort: "high" });
  const omitted = parseModelContract({ reasoning: { default_enabled: true } }, { protocol: "openrouter", scope: "route" });
  assert.equal(omitted.reasoningControls?.find(control => control.type === "effort")?.support, "unsupported");
});


test("saved declared efforts are normalized while heuristic controls cannot authorize wire options", () => {
  const saved = parseModelContract({ reasoningEfforts: ["minimal", "high"] }, { protocol: "openai_chat_completions", scope: "route" });
  assert.deepEqual(saved.reasoningControls?.[0].values, ["minimal", "high"]);
  const inferred = applyModelRequestContract({}, { protocol: "openrouter", model: "future", baseUrl: "https://relay.test", capabilityDeclarations: { reasoning: { support: "supported", source: "model_heuristic", scope: "route" } } }, { reasoningEffort: "high" });
  assert.equal(inferred.reasoning, undefined);
  const body = applyModelRequestContract({}, { protocol: "openai", model: "future", baseUrl: "https://provider.test", reasoningControls: [declaration("reasoning_effort", { source: "model_heuristic" })] }, { reasoningEffort: "high" });
  assert.equal(body.reasoning_effort, undefined);
});
