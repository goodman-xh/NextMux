import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyModelError, formatModelError, MODEL_ERROR_KINDS, MODEL_ERROR_LOCALES } from '../lib/errors.js';
import type { ModelErrorContext, ModelErrorKind } from '../lib/errors.js';
import { normalizeOfficialModelError, postJson, OfficialModelError, discoverOfficialModelCatalog, createAiSdkModelClient, boundedSecret } from '../lib/index.js';

test('initialization uncertainty has its own explanation and never offers a paid retry', () => {
  for (const code of ['request_initialization_pending', 'BILLING_INITIALIZATION_PENDING']) {
    const failure = { code, status: 503, acceptanceUnknown: true, recoveryMode: 'billing_review' };
    const readable = classifyModelError(failure, { source: 'relay' });
    assert.equal(readable.kind, 'request_initialization_pending');
    for (const locale of MODEL_ERROR_LOCALES) {
      const formatted = formatModelError(readable, locale);
      assert.equal(formatted.action, 'none');
      assert.equal(formatted.retryable, false);
      assert.ok(formatted.text.length > 20);
    }
    const chinese = formatModelError(readable, 'zh-CN');
    assert.match(chinese.text, /无法确认平台是否已接收/);
    assert.match(chinese.text, /不代表已经扣费/);
    assert.doesNotMatch(chinese.text, /查看账单或联系支持/);
  }
  assert.equal(classifyModelError({ code: 'BILLING_TRANSPORT_UNKNOWN', acceptanceUnknown: true }).kind, 'billing_review_required');
});

// Real provider wire shapes; examples contain no live credentials or user content.
// Primary documentation for each provider is catalogued in docs/MODEL_ERROR_CATALOG.md.
const fixtures: Array<[string, unknown, ModelErrorKind, ModelErrorContext?]> = [
  ['OpenAI chat quota (not generic 429)', { status: 429, error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota', param: null } }, 'provider_quota_exhausted'],
  ['OpenAI Responses stream', { type: 'response.failed', response: { status: 'failed', error: { code: 'context_length_exceeded', message: 'Input exceeds context length' } } }, 'context_too_long'],
  ['OpenAI images', { error: { type: 'image_generation_user_error', code: 'content_policy_violation', message: 'The request was rejected by our safety system.' } }, 'content_refused'],
  ['OpenAI audio', { status: 400, error: { code: 'unsupported_file_format', message: 'Unsupported file format', param: 'file' } }, 'unsupported_file'],
  ['Anthropic', { status: 529, type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' }, request_id: 'req_example' }, 'overloaded'],
  ['Gemini', { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '8s' }] } }, 'rate_limited'],
  ['Vertex', { error: { code: 403, message: 'Permission denied on resource', status: 'PERMISSION_DENIED' } }, 'permission_denied'],
  ['Azure OpenAI', { status: 404, error: { code: 'DeploymentNotFound', message: 'The API deployment for this resource does not exist.' } }, 'model_not_found'],
  ['Azure content filter', { status: 400, error: { code: 'content_filter', innererror: { code: 'ResponsibleAIPolicyViolation' }, message: 'The response was filtered.' } }, 'content_refused'],
  ['AWS Bedrock', { name: 'ThrottlingException', message: 'Too many requests', $metadata: { httpStatusCode: 429 } }, 'rate_limited'],
  ['OpenRouter metadata/raw', { error: { code: 502, message: 'Provider returned error', metadata: { provider_name: 'Anthropic', raw: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' } } }, 'overloaded'],
  ['OpenRouter moderation', { error: { code: 403, message: 'Input rejected', metadata: { error_type: 'content_policy_violation', moderation_reasons: ['safety'], flagged_input: 'private input must not be shown' } } }, 'content_refused'],
  ['OpenRouter Responses canonical type', { status: 'failed', error_type: 'authentication', error: { code: 'server_error', message: 'Invalid credentials' } }, 'auth_invalid'],
  ['DeepSeek', { status: 402, error: { code: 'insufficient_balance', message: 'Insufficient Balance', type: 'unknown_error', param: null } }, 'provider_quota_exhausted', { source: 'own_api' }],
  ['DashScope/Qwen', { code: 'Arrearage', message: 'Access denied, please check your account balance.', request_id: 'request-example' }, 'provider_quota_exhausted'],
  ['DashScope moderation', { code: 'DataInspectionFailed', message: 'Input data may contain inappropriate content.' }, 'content_refused'],
  ['Zhipu GLM numeric quota', { status: 429, error: { code: '1113', message: 'Account quota exceeded' } }, 'provider_quota_exhausted', { provider: 'zhipu' }],
  ['Moonshot/Kimi', { status: 429, error: { type: 'exceeded_current_quota_error', message: 'Quota exceeded' } }, 'provider_quota_exhausted'],
  ['MiniMax', { base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }, 'provider_quota_exhausted'],
  ['xAI', { code: 'not-found', error: 'Model not found' }, 'model_not_found'],
  ['Mistral', { status: 422, object: 'error', type: 'invalid_request_error', code: 'validation_error', message: 'Invalid parameter', param: 'temperature' }, 'invalid_request'],
  ['Cohere', { status: 498, message: 'Invalid Token' }, 'auth_invalid', { provider: 'cohere' }],
  ['Groq', { status: 498, error: { message: 'Flex tier capacity exceeded', type: 'capacity_exceeded' } }, 'overloaded', { provider: 'groq' }],
  ['Together', { status: 400, error: { type: 'invalid_request_error', code: 'context_length_exceeded', message: 'Input token length exceeds the context window' } }, 'context_too_long'],
  ['Fireworks', { status: 429, error: { message: 'Rate limit exceeded', code: 'rate_limit_exceeded', type: 'error' } }, 'rate_limited'],
  ['SiliconFlow', { code: 20003, message: 'insufficient account balance' }, 'provider_quota_exhausted'],
  ['Volcengine Ark/Doubao', { error: { code: 'InvalidParameter', message: 'The parameter `temperature` is invalid.', param: 'temperature', type: 'BadRequest' }, request_id: 'request-example' }, 'invalid_request'],
  ['Baidu Qianfan', { error_code: 110, error_msg: 'Access token invalid or no longer valid', id: 'example' }, 'auth_invalid', { provider: 'qianfan' }],
  ['Tencent Hunyuan', { Response: { Error: { Code: 'RequestLimitExceeded', Message: 'Request limit exceeded' }, RequestId: 'example' } }, 'rate_limited'],
  ['Ollama', { error: 'model "example" not found, try pulling it first' }, 'model_not_found', { source: 'local' }],
  ['LM Studio', { error: { message: 'No models loaded. Please load a model.', type: 'invalid_request_error', code: 'model_not_found' } }, 'model_not_found', { source: 'local' }],
  ['llama.cpp', { error: { code: 400, message: 'the request exceeds the available context size', type: 'exceed_context_size_error' } }, 'context_too_long', { source: 'local' }],
  ['one-api', { error: { message: '无可用渠道', type: 'one_api_error', code: 'no_available_channel' } }, 'relay_unavailable', { source: 'relay' }],
  ['new-api', { error: { message: 'token quota is not enough', type: 'new_api_error', code: 'insufficient_quota' } }, 'provider_quota_exhausted', { source: 'own_api' }],
  ['LiteLLM', { status: 400, error: { message: 'Budget exceeded', type: 'budget_exceeded', code: '400', param: null } }, 'provider_quota_exhausted'],
  ['OpenRouter images', { error: { code: 400, message: 'Unsupported image format', metadata: { error_type: 'unsupported_image_format' } } }, 'unsupported_file'],
  ['OpenRouter video', { id: 'job-example', status: 'failed', error: { code: 502, message: 'Provider unavailable', metadata: { error_type: 'provider_unavailable' } } }, 'provider_error'],
  ['Google Veo', { name: 'operations/example', done: true, error: { code: 8, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } }, 'rate_limited'],
  ['Kling', { code: 1301, message: 'Content policy violation', data: { task_status: 'failed', task_status_msg: 'Sensitive content' } }, 'content_refused', { provider: 'kling' }],
  ['MiniMax Hailuo', { task_id: 'example', status: 'Fail', base_resp: { status_code: 1027, status_msg: 'Output failed content safety check' } }, 'content_refused'],
  ['Seedance/Jimeng', { id: 'example', status: 'failed', error: { code: 'OutputVideoSensitiveContentDetected', message: 'Output video violated content policy' } }, 'content_refused'],
  ['ElevenLabs', { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota' } }, 'provider_quota_exhausted'],
  ['Suno-style third-party async', { code: 200, msg: 'success', data: { status: 'SENSITIVE_WORD_ERROR', errorCode: 'SENSITIVE_WORD_ERROR', errorMessage: 'Input contains sensitive words' } }, 'content_refused'],
  ['速创 async template', { code: 200, msg: 'success', data: { id: 'example', status: 3, message: '内容审核未通过' }, debug: ['safety check failed'] }, 'content_refused'],
  ['Decisions Jev OpenRouter', { error: { code: 524, message: 'Processing deadline exceeded' } }, 'timeout'],
  ['Local /v1/systemone', { status: 422, detail: [{ loc: ['body', 'questions', 0, 'question'], msg: 'Field required', type: 'missing' }] }, 'invalid_request', { source: 'local' }],
  ['NextMux wallet', { error: { code: 'insufficient_balance', message: 'Insufficient balance' } }, 'balance_insufficient', { source: 'relay' }],
  ['NextMux relay route', { error: { code: 'upstream_capacity_exhausted', message: 'No route available' } }, 'relay_unavailable', { source: 'relay' }],
  ['NextMux rate', { error: { code: 'gateway_rate_limited', message: 'Rate limited', retryAfterSeconds: 4 } }, 'rate_limited', { source: 'relay' }],
  ['NextMux billing review', { error: { code: 'billing_review_required' } }, 'billing_review_required', { source: 'relay' }],
  // Per-minute token quotas mention input tokens and a limit, but they are rate limits, not context overflow.
  ['Gemini free-tier input token quota', { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 250000' } }, 'rate_limited'],
  ['OpenAI TPM', { status: 429, error: { code: 'rate_limit_exceeded', type: 'tokens', message: 'Rate limit reached for gpt-5 on input tokens per min (TPM): Limit 30000, Used 29000, Requested 4000.' } }, 'rate_limited'],
  ['Anthropic input tokens per minute', { status: 429, type: 'error', error: { type: 'rate_limit_error', message: 'This request would exceed the rate limit for your organization of 40,000 input tokens per minute.' } }, 'rate_limited'],
  // Context overflow wordings that LiteLLM also maps to ContextWindowExceededError.
  ['Anthropic prompt too long', { status: 400, type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 208000 tokens > 200000 maximum' } }, 'context_too_long'],
  ['Bedrock input too long', { name: 'ValidationException', message: 'Input is too long for requested model.', $metadata: { httpStatusCode: 400 } }, 'context_too_long'],
  ['Gemini input token count', { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).' } }, 'context_too_long'],
  ['Moonshot token limit', { status: 400, error: { type: 'invalid_request_error', message: 'Invalid request: Your request exceeded model token limit: 8192' } }, 'context_too_long'],
  ['DashScope input length range', { code: 'InvalidParameter', message: 'Range of input length should be [1, 30720]' }, 'context_too_long'],
  ['vLLM', { status: 400, object: 'error', message: "This model's maximum context length is 32768 tokens. However, you requested 40000 tokens. Please reduce the length of the messages.", type: 'BadRequestError' }, 'context_too_long', { source: 'own_api' }],
  ['one-api English quota', { status: 403, error: { message: 'user quota is not enough', type: 'one_api_error', code: 'insufficient_user_quota' } }, 'provider_quota_exhausted', { source: 'own_api' }],
];

for (const [provider, value, expected, context] of fixtures) {
  test(`readable error fixture: ${provider}`, () => {
    const result = classifyModelError(value, context);
    assert.equal(result.kind, expected, result.detail);
    assert.ok(result.detail);
    assert.ok(formatModelError(value, 'zh-CN', context).text);
  });
}

test('all 25 error kinds have readable text and localized actions in all 12 desktop locales', () => {
  assert.equal(MODEL_ERROR_LOCALES.length, 12);
  for (const locale of MODEL_ERROR_LOCALES) for (const kind of MODEL_ERROR_KINDS) {
    const value = formatModelError({ kind, detail: 'Provider diagnostic' }, locale);
    assert.equal(value.kind, kind);
    assert.ok(value.text.length > 12, `${locale}/${kind}`);
    assert.doesNotMatch(value.text, /undefined|null|\{(?:count|parameter|reason|seconds)\}/);
    if (value.action !== 'none') assert.ok(value.actionLabel, `${locale}/${kind} action`);
    if (locale !== 'en') assert.notEqual(value.text, formatModelError({ kind, detail: 'Provider diagnostic' }, 'en').text);
  }
});

test('retry-after, parameter, moderation reasons and retry history survive wrapping', () => {
  const rate = formatModelError({ data: { readableError: { kind: 'rate_limited', detail: 'Rate limit exceeded', retryAfterSeconds: 7, retryCount: 2, relaySwitchCount: 1 } } }, 'zh-CN');
  assert.match(rate.text, /请等待 7 秒后重试/);
  assert.match(rate.text, /已自动重试 2 次/);
  assert.match(rate.text, /已自动切换中转 1 次/);
  assert.equal(classifyModelError({ status: 429, headers: new Headers({ 'retry-after': '5' }) }).retryAfterSeconds, 5);
  assert.equal(classifyModelError({ error: { details: [{ retryDelay: '3.5s' }] } }).retryAfterSeconds, 4);
  assert.equal(classifyModelError(fixtures.find(item => item[0] === 'Local /v1/systemone')![1]).parameter, 'body.questions.0.question');
  const content = formatModelError({ error: { code: 'content_policy_violation', message: 'The provider blocked this image.' } }, 'en');
  assert.match(content.text, /Provider’s reason: The provider blocked this image/);
});

test('source changes guidance and never sends relay users to replace merchant credentials', () => {
  const direct = formatModelError({ status: 401 }, 'zh-CN', { source: 'own_api' });
  assert.equal(direct.text, 'API 密钥无效或已过期。 请打开“模型中心 → 我的 API”检查并更换密钥。');
  const relay = formatModelError({ status: 401 }, 'zh-CN', { source: 'relay' });
  assert.equal(relay.action, 'switch_relay');
  assert.doesNotMatch(relay.text, /更换密钥|充值/);
  const upstreamQuota = formatModelError({ code: 'upstream_balance_unavailable', error: { code: 'insufficient_balance' } }, 'zh-CN', { source: 'relay' });
  assert.equal(upstreamQuota.action, 'switch_relay');
  assert.equal(formatModelError({ code: 'WALLET_BALANCE_INSUFFICIENT' }, 'en').action, 'top_up');
  const metadata = formatModelError({ data: { readableError: { kind: 'network', source: 'local', detail: 'ECONNREFUSED' } } }, 'zh-CN', { source: 'relay' });
  assert.equal(metadata.source, 'local');
  assert.match(metadata.text, /确认本地模型服务已启动/);
});

test('managed network failures retain relay guidance through RPC metadata in every locale', () => {
  const failure = {
    code: 'PLATFORM_OFFLINE',
    message: 'Model request failed',
    retrySafe: false,
    data: { readableError: { kind: 'network', code: 'PLATFORM_OFFLINE', source: 'relay', detail: '模型服务未连接 PLATFORM_OFFLINE' } },
  };
  const readable = classifyModelError(failure, { source: 'own_api' });
  assert.equal(readable.kind, 'network');
  assert.equal(readable.source, 'relay');
  assert.equal(readable.code, 'PLATFORM_OFFLINE');
  assert.match(readable.detail, /PLATFORM_OFFLINE/);
  for (const locale of MODEL_ERROR_LOCALES) {
    const relay = formatModelError(failure, locale, { source: 'own_api' });
    const own = formatModelError({ code: 'PLATFORM_OFFLINE' }, locale, { source: 'own_api' });
    const local = formatModelError({ code: 'PLATFORM_OFFLINE' }, locale, { source: 'local' });
    const generic = formatModelError({ code: 'PLATFORM_OFFLINE' }, locale);
    assert.equal(relay.kind, 'network', locale);
    assert.equal(relay.source, 'relay', locale);
    assert.equal(relay.action, 'retry', locale);
    assert.equal(relay.actionLabel, formatModelError({ kind: 'timeout' }, locale).actionLabel, locale);
    assert.notEqual(relay.text, own.text, locale);
    assert.notEqual(relay.text, local.text, locale);
    assert.notEqual(generic.text, own.text, locale);
    assert.equal(generic.action, 'retry', locale);
    assert.equal(own.action, 'settings', locale);
    assert.equal(local.action, 'settings', locale);
    if (locale !== 'en') assert.notEqual(relay.text, formatModelError(failure, 'en').text, locale);
  }
  assert.equal(formatModelError({ code: 'PLATFORM_OFFLINE' }, 'zh-CN').text, '无法连接模型服务。 请检查网络连接后重试。');
  assert.equal(formatModelError(failure, 'zh-CN').text, '无法连接模型服务。 请检查网络或切换中转商。');
  assert.equal(formatModelError({ code: 'PLATFORM_OFFLINE' }, 'zh-CN', { source: 'own_api' }).text,
    '无法连接模型服务。 请检查网络或“我的 API”接口地址。');
  assert.equal(formatModelError({ code: 'PLATFORM_OFFLINE' }, 'zh-CN', { source: 'local' }).text,
    '无法连接模型服务。 请确认本地模型服务已启动。');
});

test('relay network context never overrides an uncertain paid outcome with a retry', () => {
  for (const locale of MODEL_ERROR_LOCALES) {
    for (const evidence of [{ acceptanceUnknown: true }, { recoveryMode: 'billing_only' }]) {
      const failure = formatModelError({ code: 'PLATFORM_OFFLINE', ...evidence }, locale, { source: 'relay' });
      assert.equal(failure.kind, 'billing_review_required', locale);
      assert.equal(failure.action, 'none', locale);
      assert.equal(failure.retryable, false, locale);
    }
  }
});

test('billing outcome uncertainty offers no retry in every locale', () => {
  for (const value of [{ acceptanceUnknown: true, code: 'provider_error' }, { recoveryMode: 'billing_only' }, { code: 'billing_finalization_pending' }, { code: 'UPSTREAM_TRANSPORT_UNKNOWN' }]) {
    for (const locale of MODEL_ERROR_LOCALES) {
      const error = formatModelError(value, locale);
      assert.equal(error.kind, 'billing_review_required');
      assert.equal(error.action, 'none');
      assert.equal(error.retryable, false);
    }
  }
});

test('numeric codes are scoped to vendor envelopes and do not create false HTTP status', () => {
  assert.equal(classifyModelError({ base_resp: { status_code: 1001, status_msg: 'Request failed' } }).kind, 'timeout');
  assert.equal(classifyModelError({ error: { code: '1001' } }, { provider: 'zhipu' }).kind, 'auth_missing');
  assert.equal(classifyModelError({ error: { code: '1001' } }).kind, 'unknown');
  assert.equal(classifyModelError({ error_code: 336004 }, { provider: 'qianfan' }).kind, 'permission_denied');
  assert.equal(classifyModelError({ error_code: 336004 }, { provider: 'qianfan' }).httpStatus, undefined);
  assert.equal(classifyModelError({ error_code: 110 }, { provider: 'ernie' }).kind, 'auth_invalid');
  assert.throws(() => boundedSecret(''), (error: any) => error.readableError.kind === 'auth_missing');
});

test('details retain provider prose and redact credentials while excluding request content', () => {
  const secret = ['not', 'a', 'real', 'credential'].join('-');
  const value = {
    name: 'AI_APICallError', status: 400,
    requestBodyValues: { prompt: 'PRIVATE REQUEST CONTENT' },
    responseBody: JSON.stringify({ error: { code: 'invalid_api_key', message: `Credential failed. Authorization: Bearer ${secret}`, request_body: 'PRIVATE REQUEST CONTENT' } }),
    stack: 'PRIVATE STACK', headers: { authorization: secret },
  };
  const result = classifyModelError(value);
  assert.equal(result.kind, 'auth_invalid');
  assert.match(result.detail, /Credential failed/);
  assert.match(result.detail, /REDACTED/);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE REQUEST CONTENT|PRIVATE STACK/);
  const cyclic: any = { message: 'fetch failed' };
  cyclic.cause = cyclic;
  assert.equal(classifyModelError(cyclic).kind, 'network');
});

test('stream cuts, tool parse errors, aborts and timeouts remain distinguishable', () => {
  assert.equal(classifyModelError(new Error('premature close of response stream')).kind, 'stream_interrupted');
  assert.equal(classifyModelError({ code: 'INVALID_TOOL_CALL', message: 'Malformed tool arguments' }).kind, 'tool_call_invalid');
  // The gateway refusing the request's own tool list is not a model answer that failed to parse.
  assert.equal(classifyModelError({ code: 'tools_invalid', status: 400, message: 'Tools are invalid' }, { source: 'relay' }).kind, 'invalid_request');
  assert.equal(classifyModelError(new DOMException('cancelled', 'AbortError')).kind, 'cancelled');
  const timedOut = normalizeOfficialModelError(new DOMException('aborted', 'AbortError'), { timedOut: true });
  assert.equal(timedOut.readableError.kind, 'timeout');
});

test('HTTP transport keeps provider reason without changing established retry policy', async () => {
  await assert.rejects(postJson({ endpoint: new URL('https://example.invalid/v1/chat/completions'), headers: {}, body: {}, timeoutMs: 1_000,
    fetchImpl: async () => Response.json({ error: { code: 'insufficient_quota', message: 'Quota exhausted; add credits at the provider.' } }, { status: 429 }),
  }), (error: any) => {
    assert.equal(error instanceof OfficialModelError, true);
    assert.equal(error.code, 'RATE_LIMITED');
    assert.equal(error.retryable, true);
    assert.equal(error.retrySafe, false);
    assert.equal(error.toJSON().readableError.kind, 'provider_quota_exhausted');
    assert.match(error.toJSON().readableError.detail, /add credits at the provider/);
    assert.equal(error.data.readableError.kind, 'provider_quota_exhausted');
    return true;
  });
});

test('HTTP 200 provider error envelopes remain readable failures', async () => {
  await assert.rejects(postJson({ endpoint: new URL('https://example.invalid/v1/chat/completions'), headers: {}, body: {}, timeoutMs: 1_000,
    fetchImpl: async () => Response.json({ error: { code: 403, message: 'Content safety blocked', metadata: { error_type: 'content_policy_violation' } } }),
  }), (error: any) => error.readableError.kind === 'content_refused');
});

test('model discovery retains useful provider error instead of discarding the body', async () => {
  await assert.rejects(discoverOfficialModelCatalog({ baseUrl: 'https://example.invalid/v1', apiKey: 'placeholder', protocol: 'openai_chat_completions',
    fetchImpl: async () => Response.json({ error: { code: 'insufficient_quota', message: 'The account has no quota left.' } }, { status: 429 }),
  }), (error: any) => error.readableError.kind === 'provider_quota_exhausted' && error.readableError.detail.includes('no quota left'));
});

test('preserved presentation metadata beats legacy failure kind, gateway status and UI route fallback', () => {
  const original = classifyModelError({ status: 429, error: { code: 'insufficient_quota', message: 'Provider quota exhausted' } }, { source: 'own_api', retryCount: 2 });
  const result = classifyModelError({ kind: 'rate_limited', httpStatus: 503, retryCount: 0, readableError: original }, { source: 'relay' });
  assert.equal(result.kind, 'provider_quota_exhausted');
  assert.equal(result.source, 'own_api');
  assert.equal(result.httpStatus, 429);
  assert.equal(result.retryCount, 2);
  const again = classifyModelError({ data: { readableError: result }, message: 'Provider quota exhausted' });
  assert.equal(again.detail.split('\n').filter(line => line === 'Provider quota exhausted').length, 1);
});

test('typed billing causes beat generic forbidden/auth wrappers and HTTP rate-limit codes', () => {
  for (const status of [401, 403, 429]) {
    assert.equal(classifyModelError({ status, error: { code: 'AccessDenied.Arrearage', message: 'Forbidden' } }).kind, 'provider_quota_exhausted');
    assert.equal(classifyModelError({ status, error: { code: 'budget_exceeded', type: 'authentication_error', message: 'Unauthorized' } }).kind, 'provider_quota_exhausted');
    assert.equal(classifyModelError({ status, base_resp: { status_code: 1008, status_msg: 'Request failed' } }).kind, 'provider_quota_exhausted');
  }
  assert.equal(classifyModelError({ status_code: 429, error: { code: 1001 } }, { provider: 'zhipu' }).kind, 'auth_missing');
  assert.equal(classifyModelError({ status_code: 429, error: { code: 1001 } }).kind, 'unknown');
});

test('upstream metadata balance and moderation stay distinct from the NextMux wallet', () => {
  const raw = { error: { code: 402, message: 'Provider failed', metadata: { provider_name: 'DeepSeek', raw: '{"error":{"code":"insufficient_balance","message":"Insufficient Balance"}}' } } };
  assert.equal(formatModelError(raw, 'en', { source: 'relay' }).action, 'switch_relay');
  assert.notEqual(classifyModelError(raw, { source: 'relay' }).kind, 'balance_insufficient');
  const refusal = classifyModelError({ error: { code: 403, metadata: { error_type: 'content_policy_violation', reasons: ['Video contains prohibited content'] } } });
  assert.match(refusal.providerReason!, /Video contains prohibited content/);
});

test('output finish reasons do not misclassify invalid max_tokens parameters', () => {
  assert.equal(classifyModelError({ status: 400, error: { type: 'invalid_request_error', param: 'max_tokens', message: 'max_tokens must be positive' } }).kind, 'invalid_request');
  assert.equal(classifyModelError({ candidates: [{ finishReason: 'MAX_TOKENS' }] }).kind, 'output_too_long');
  assert.equal(classifyModelError({ choices: [{ finish_reason: 'length' }] }).kind, 'output_too_long');
  assert.equal(classifyModelError({ detail: { status: 'text_too_long' } }).kind, 'context_too_long');
  assert.equal(classifyModelError({ detail: { status: 'unsupported_model' } }).kind, 'model_not_supported_here');
  assert.equal(classifyModelError({ detail: { status: 'invalid_audio_format' } }).kind, 'unsupported_file');
});

test('opaque numeric provider codes survive real SDK and discovery error normalization', async () => {
  const client = createAiSdkModelClient({ providerId: 'zhipu', protocol: 'openai_chat_completions', baseUrl: 'https://example.invalid/v1', apiKey: 'placeholder', model: 'fixture-model',
    fetchImpl: async () => Response.json({ error: { code: '1113', message: 'Request failed' } }, { status: 429 }),
  });
  await assert.rejects(client.complete({ messages: [{ role: 'user', content: 'fixture' }], tools: [] }), (error: any) => {
    assert.equal(error.readableError.kind, 'provider_quota_exhausted');
    assert.equal(error.code, 'RATE_LIMITED');
    return true;
  });
  await assert.rejects(discoverOfficialModelCatalog({ providerId: 'zhipu', protocol: 'openai_chat_completions', baseUrl: 'https://example.invalid/v1', apiKey: 'placeholder',
    fetchImpl: async () => Response.json({ error: { code: '1113', message: 'Request failed' } }, { status: 429 }),
  }), (error: any) => error.readableError.kind === 'provider_quota_exhausted');
});

test('plain-text gateway failures preserve details and HTTP status in discovery and generation', async () => {
  const fetchImpl: typeof fetch = async () => new Response('upstream maintenance in progress', { status: 503 });
  const check = (error: any): boolean => {
    assert.equal(error.readableError.kind, 'provider_error');
    assert.equal(error.httpStatus, 503);
    assert.match(error.readableError.detail, /upstream maintenance in progress/);
    return true;
  };
  await assert.rejects(postJson({ endpoint: new URL('https://example.invalid/v1/chat/completions'), headers: {}, body: {}, timeoutMs: 1_000, fetchImpl }), check);
  await assert.rejects(discoverOfficialModelCatalog({ baseUrl: 'https://example.invalid/v1', apiKey: 'placeholder', protocol: 'openai_chat_completions', fetchImpl }), check);
});

test('a local field error that mentions a limit is not read as throttling', () => {
  const error = classifyModelError({ code: 'INVALID_MEDIA_REQUEST', message: 'limit must be an integer from 1 to 500' }, { source: 'local' });
  assert.notEqual(error.kind, 'rate_limited');
  assert.equal(classifyModelError({ code: 'RequestLimitExceeded', message: 'Request limit exceeded' }).kind, 'rate_limited');
});

test('a content refusal keeps paths, stacks, JSON and URLs out of the shown reason (B20-02)', () => {
  const raw = 'Blocked by safety filter while reading /Users/someone/project/secret.txt see https://example.invalid/policy?id=1 {"trace":"abc"}\n    at handler (/srv/app/index.js:10:5)';
  const formatted = formatModelError({ code: 'content_policy_violation', message: raw }, 'en');
  assert.equal(formatted.kind, 'content_refused');
  assert.ok(formatted.providerReason);
  assert.doesNotMatch(formatted.providerReason!, /\/Users|https?:|\{|at handler/);
  assert.match(formatted.providerReason!, /Blocked by safety filter/);
  assert.doesNotMatch(formatted.text, /\/Users|\/srv|https?:|trace/);
  assert.match(formatted.detail, /\/srv\/app\/index\.js/);
});

test('an offline platform connection is a network failure (B20-06)', () => {
  assert.equal(classifyModelError({ code: 'PLATFORM_OFFLINE', message: '模型服务未连接' }).kind, 'network');
  assert.equal(classifyModelError({ code: 'PLATFORM_OFFLINE', message: 'offline' }).kind, 'network');
});

test('unlinked desktop relay failures classify as sign-in required with concise localized guidance', () => {
  const envelope = {
    code: 'DEVICE_LINK_REQUIRED',
    reason: 'Link this desktop to your NextMux account',
    readableError: {
      kind: 'auth_invalid',
      detail: 'Link this desktop to your NextMux account device_link_required 401',
      code: 'device_link_required',
      source: 'relay',
    },
  };
  const classified = classifyModelError(envelope, { source: 'relay' });
  assert.equal(classified.kind, 'auth_invalid');
  assert.equal(classified.code?.toLowerCase(), 'device_link_required');

  const zhCN = formatModelError(envelope, 'zh-CN', { source: 'relay' });
  assert.equal(zhCN.text, '请先登录账号，或切换至“我的 API”。');
  assert.equal(zhCN.action, 'settings');
  assert.equal(zhCN.retryable, false);

  const zhTW = formatModelError(envelope, 'zh-TW', { source: 'relay' });
  assert.equal(zhTW.text, '請先登入帳號，或切換至「我的 API」。');

  const en = formatModelError(envelope, 'en', { source: 'relay' });
  assert.equal(en.text, 'Please sign in first, or switch to My API.');
  assert.equal(en.action, 'settings');

  // Even without an explicit code, prose like "Link this desktop to your NextMux account" or "device_auth_required" matches.
  const proseOnly = formatModelError({ reason: 'Link this desktop to your NextMux account' }, 'zh-CN', { source: 'relay' });
  assert.equal(proseOnly.kind, 'auth_invalid');
  assert.equal(proseOnly.text, '请先登录账号，或切换至“我的 API”。');
  assert.equal(proseOnly.action, 'settings');
});
