/**
 * Skill plugins (技能插件): the calls to fast decision models and to vision models, made by the backend because the
 * keys and the platform credential live here. The main process runs the plugin and asks through the page
 * (app-plugins.cjs → widget → this module), so no key ever reaches it.
 *
 * Decision sources (the same named-question format everywhere, see app-plugin-core.cjs buildQuestions):
 *  - "nextmux": a relay merchant's decision model through the NextMux platform, POST /v1/decisions, billed to the
 *    user's NextMux balance per input token.
 *  - "connection": one of the user's own API connections that lists decision models (output modality "decisions");
 *    POST <its origin>/api/alpha/decisions, the Decisions API convention, with the connection's key.
 *  - "local": a server on this computer: a decision server (POST <endpoint>/v1/systemone, OpenJev …), Ollama
 *    (POST /api/chat) or an OpenAI-compatible chat server (POST /v1/chat/completions). Chat models answer the same
 *    questions as JSON constrained by a schema, and the answer is read like a decision server's.
 * Vision descriptions (plugins that need to see and whose decision model cannot): a model-runtime supported vision model on
 * an own API connection, or Ollama / a local OpenAI-compatible server, asked for one short sentence.
 */
import { randomUUID } from 'crypto';
import { createOfficialModelClient, createPreferredOfficialModelClient, invokeNativeDecision, modelProviderAdaptersFor,
    type DiscoveredOfficialModel, type OfficialModelClientOptions, type OfficialModelTurn, type OfficialModelUsage } from '@nextmux/model-runtime';
import { decisionTransportForModel, invokeTevDecision, isTevDecisionModel, tevDecisionRequest, openAIDecisionsUrl } from '@nextmux/model-runtime/decision-adapter';
import { classifyModelError, type ModelErrorContext } from '@nextmux/model-runtime/errors';
import type {
    AppPluginConnectionChoice, AppPluginDecisionRequest, AppPluginDecisionResult, AppPluginDescribeRequest, AppPluginDescribeResult, AppPluginLocalProtocol,
    AppPluginLocalServer, AppPluginModelChoices, AppPluginRelayModel, AppPluginServerProbe, AppPluginPricing as AppPluginTokenPrices
} from '../common/nextmux-app-plugins';
import { isDecisionTaskModel, isDecisionOnlyModel } from '@nextmux/model-runtime/model-task-capabilities';
import { parseDecisionEndpointTariff } from '@nextmux/model-runtime/model-contract';
import type { UpstreamPrivacyPreference } from '../common/nextmux-upstream-privacy-preference';

/** An own API connection as the plugin backend sees it: never its key (read with connectionKey when a call is made). */
export interface AppPluginConnection {
    readonly id: string;
    readonly label: string;
    readonly providerName: string;
    readonly providerId?: string;
    readonly protocol: string;
    readonly baseUrl: string;
    readonly models: readonly (AppPluginTokenPrices & Omit<Partial<DiscoveredOfficialModel>, 'id'> & { readonly id: string })[];
    readonly providerSettings?: OfficialModelClientOptions['providerSettings'];
}

export interface AppPluginDecisionHost {
    /** Stable per backend connection; cancellation cannot affect another renderer's requests. */
    readonly requestScope?: object;
    readonly baseUrl: string;
    deviceId(): Promise<string>;
    /** Applies to managed calls only; own and local connections keep their policies. */
    privacyPreference?(): Promise<UpstreamPrivacyPreference>;
    /** Network fetch (the app's proxy settings) for the platform and own API connections. */
    fetch: typeof fetch;
    /** The user's own API connections (from Settings → 自有 API). */
    connections(): Promise<readonly AppPluginConnection[]>;
    /** A connection's key from the system keychain; undefined for keyless (local) connections. */
    connectionKey(id: string): Promise<string | undefined>;
    /** Plain fetch for servers on this computer (a proxy must never see them). */
    localFetch?: typeof fetch;
}

const TIMEOUT_MS = 10_000;
/** A chat model on this computer may still be loading into memory on the first question. */
const LOCAL_CHAT_TIMEOUT_MS = 30_000;
const MAX_STATE_BYTES = 64 * 1024;
const MAX_IMAGE_CHARS = 2_800_000;
/** Where local model servers usually listen: probed when the model dialog opens. */
const KNOWN_LOCAL_SERVERS = ['http://127.0.0.1:11434', 'http://127.0.0.1:8080', 'http://127.0.0.1:1234'] as const;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const MODEL_ID = /^[~A-Za-z0-9][\w.:/~@-]{0,159}$/;

const defaultRequestScope = {};
const requestScopes = new WeakMap<object, { active: Map<string, AbortController>; cancelled: Map<string, number>; disposed: boolean }>();
function requests(scope = defaultRequestScope) {
    let state = requestScopes.get(scope);
    if (!state) { state = { active: new Map(), cancelled: new Map(), disposed: false }; requestScopes.set(scope, state); }
    return state;
}
export function cancelAppPluginRequest(requestId: string, scope = defaultRequestScope): void {
    if (typeof requestId !== 'string' || !requestId || requestId.length > 200) return;
    const state = requests(scope);
    state.active.get(requestId)?.abort(new DOMException('Plugin request cancelled', 'AbortError'));
    // A stop can overtake the request while the renderer/backend bridge is busy.
    state.cancelled.set(requestId, Date.now());
    for (const [id, at] of state.cancelled) if (state.cancelled.size > 1024 || Date.now() - at > 60_000) state.cancelled.delete(id);
}
export function disposeAppPluginRequests(scope: object): void {
    const state = requests(scope);
    state.disposed = true;
    for (const controller of state.active.values()) controller.abort(new DOMException('Plugin owner disconnected', 'AbortError'));
    state.cancelled.clear();
}
function pluginRequest(host: AppPluginDecisionHost, request: { requestId?: string; deadlineAt?: number }, timeout: number) {
    const state = requests(host.requestScope), controller = new AbortController();
    for (const [requestId, at] of state.cancelled) if (Date.now() - at > 60_000) state.cancelled.delete(requestId);
    const id = typeof request.requestId === 'string' && request.requestId.length > 0 && request.requestId.length <= 200 ? request.requestId : randomUUID();
    const remaining = typeof request.deadlineAt === 'number' && Number.isFinite(request.deadlineAt) ? request.deadlineAt - Date.now() : timeout;
    const duration = Math.max(0, Math.min(timeout, remaining));
    const deadlineAt = Date.now() + duration;
    if (state.disposed || id && state.cancelled.has(id)) controller.abort(new DOMException('Plugin request cancelled', 'AbortError'));
    if (id) { state.active.get(id)?.abort(); state.active.set(id, controller); }
    const expire = () => controller.abort(new DOMException('Plugin request deadline exceeded', 'TimeoutError'));
    const checkDeadline = () => { if (Date.now() >= deadlineAt) expire(); };
    const timer = setTimeout(expire, duration);
    timer.unref?.();
    if (!duration) expire();
    return { signal: controller.signal, checkDeadline,
        fetch(fetcher: typeof fetch, input: Parameters<typeof fetch>[0], init: RequestInit) {
            checkDeadline();
            controller.signal.throwIfAborted();
            return fetcher(input, { ...init, signal: controller.signal });
        },
        finish() { clearTimeout(timer); if (id && state.active.get(id) === controller) state.active.delete(id); } };
}
const price = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const tokens = (value: unknown): value is number => price(value) && Number.isSafeInteger(value);
function tokenPrices(model: AppPluginTokenPrices | undefined): AppPluginTokenPrices {
    return Object.fromEntries(['inputPricePerMillion', 'outputPricePerMillion', 'cachedInputPricePerMillion', 'cacheWritePricePerMillion']
        .flatMap(key => { const value = model?.[key as keyof AppPluginTokenPrices]; return price(value) ? [[key, value]] : []; }));
}
/** Missing prices/usage remain unknown; never guess a free request or a cache discount. */
function pluginCost(payload: unknown, local: boolean, pricing: AppPluginTokenPrices | undefined, decision = false, nativeOwnDecision = false): { costUsd?: number; costStatus: 'known' | 'unknown' } {
    if (local) return { costUsd: 0, costStatus: 'known' };
    const record = isObject(payload) ? payload : {};
    const nextmux = isObject(record.nextmux) ? record.nextmux : {};
    const usage = isObject(record.usage) ? record.usage : isObject(nextmux.usage) ? nextmux.usage : {};
    if (nativeOwnDecision) {
        const input = usage.input_tokens ?? usage.inputTokens;
        // Decisions bills total input, including cached tokens, at its separate endpoint rate.
        return tokens(input) && input <= 32768 && price(pricing?.inputPricePerMillion)
            ? { costUsd: input * pricing.inputPricePerMillion / 1_000_000, costStatus: 'known' }
            : { costStatus: 'unknown' };
    }
    if (price(nextmux.charged_micros)) return { costUsd: nextmux.charged_micros / 1_000_000, costStatus: 'known' };
    if (price(usage.cost)) return { costUsd: usage.cost, costStatus: 'known' };
    if (!pricing || !Object.values(tokenPrices(pricing)).length) return { costStatus: 'unknown' };
    const input = usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens;
    const output = usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? (decision ? 0 : undefined);
    const details = isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : isObject(usage.input_tokens_details) ? usage.input_tokens_details : {};
    const cached = details.cached_tokens ?? usage.cache_read_input_tokens ?? usage.cached_input_tokens ?? 0;
    const written = details.cache_write_tokens ?? usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? 0;
    if (!tokens(input) || !tokens(output) || !tokens(cached) || !tokens(written)) return { costStatus: 'unknown' };
    // OpenAI totals include cache tokens; Anthropic-style usage reports fresh input separately.
    const fresh = usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined ? input : input - cached - written;
    if (fresh < 0) return { costStatus: 'unknown' };
    const dimensions = [[fresh, pricing?.inputPricePerMillion], [output, pricing?.outputPricePerMillion],
        [cached, pricing?.cachedInputPricePerMillion], [written, pricing?.cacheWritePricePerMillion]] as const;
    if (dimensions.some(([count, rate]) => count > 0 && !price(rate))) return { costStatus: 'unknown' };
    const costUsd = dimensions.reduce((total, [count, rate]) => total + count * (rate || 0), 0) / 1_000_000;
    return Number.isFinite(costUsd) ? { costUsd, costStatus: 'known' } : { costStatus: 'unknown' };
}
function ownDecisionPrices(model: AppPluginConnection['models'][number], connection: AppPluginConnection): AppPluginTokenPrices {
    const transport = decisionTransportForModel(model, connection.protocol, { baseUrl: connection.baseUrl, declaration: model.decisionEndpointSupport });
    if (transport !== 'openai_decisions') return tokenPrices(model);
    const tariff = parseDecisionEndpointTariff(model.decisionEndpointTariff);
    const url = new URL(connection.baseUrl);
    // Public author prices do not prove a relay's own endpoint selling price.
    if (url.protocol !== 'https:' || url.hostname !== 'api.openai.com' || !tariff || tariff.upstreamModelId !== model.id.replace(/^openai\//, '')) return {};
    return { inputPricePerMillion: tariff.rates.input_token.amountMicros / 1_000_000, outputPricePerMillion: 0 };
}
/** Only the new native endpoint's accounting envelopes; answers and quantities stay intact. */
function nativeDecisionReceipt(payload: unknown): unknown {
    const amounts = new Set(['cost', 'cost_details', 'upstreamCostMicros', 'upstream_cost', 'total_cost',
        'costUsd', 'upstreamInferenceCostUsd', 'reportedCostUsd', '__exactCostUsd']);
    const envelopes = new Set(['usage', 'usage_metadata', 'usageMetadata', 'billed_units', 'nextmux', 'message', 'response', 'delta', 'data']);
    const clean = (value: unknown, depth: number): unknown => !isObject(value) ? value
        : Object.fromEntries(Object.keys(value).filter(key => !amounts.has(key)).map(key => [key,
            depth < 4 && envelopes.has(key) ? clean(value[key], depth + 1) : value[key]]));
    return clean(payload, 0);
}
function cancelledResult(signal: AbortSignal, kind: 'decision' | 'vision') {
    return { ok: false as const, error: `${kind}_${signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled'}` };
}

/** Only this computer: http(s)://127.0.0.1|localhost|[::1][:port]. */
export function localEndpoint(value: unknown): string | undefined {
    try {
        const url = new URL(String(value || ''));
        if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) return undefined;
        return `${url.protocol}//${url.host}`;
    } catch { return undefined; }
}

/** The Decisions API of a provider, from its API base (…/api/v1, …/v1 or the origin): <origin>/api/alpha/decisions. */
export function decisionsUrl(baseUrl: string): string | undefined {
    try {
        const url = new URL(baseUrl);
        if (url.protocol !== 'https:' && !localEndpoint(baseUrl)) return undefined;
        const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/(?:v1|alpha)(?:\/.*)?$/i, '').replace(/\/v1(?:\/.*)?$/i, '').replace(/\/api$/i, '');
        url.pathname = `${path}/api/alpha/decisions`.replace(/\/+/g, '/');
        url.search = ''; url.hash = '';
        return url.toString();
    } catch { return undefined; }
}

/** Resolve only protocols with a proved model-runtime transport. OpenRouter uses its compatible transport. */
function modelProtocol(protocol: string): OfficialModelClientOptions['protocol'] | undefined {
    const normalized = protocol === 'openrouter' || protocol === 'openai' || protocol === 'ollama' ? 'openai_chat_completions' : protocol;
    return modelProviderAdaptersFor(normalized as OfficialModelClientOptions['protocol'], ['vision']).length
        ? normalized as OfficialModelClientOptions['protocol'] : undefined;
}
function chatDecisionUrl(baseUrl: string, protocol: string): string | undefined {
    try {
        const url = new URL(baseUrl);
        if (url.username || url.password || url.protocol !== 'https:' && !localEndpoint(baseUrl)) return undefined;
        let path = url.pathname.replace(/\/+$/, '').replace(/\/(?:models|chat\/completions)$/, '');
        if (!path || path === '/') path = protocol === 'openrouter' ? '/api/v1' : '/v1';
        url.pathname = `${path}/chat/completions`; url.search = ''; url.hash = '';
        return url.toString();
    } catch { return undefined; }
}

function imageAttachments(images: readonly string[]) {
    return images.map((image, index) => ({ kind: 'image' as const, name: `frame-${index + 1}`,
        mimeType: image.slice(5, image.indexOf(';')) as 'image/png' | 'image/jpeg' | 'image/webp', dataBase64: image.slice(image.indexOf(',') + 1) }));
}

/** Shared runtime adapters own provider URLs, image encoding, response decoding, and capacity admission. */
async function pluginModelTurn(options: OfficialModelClientOptions, input: { text: string; images: readonly string[]; instructions?: string; schema?: Record<string, unknown>; maxOutputTokens: number },
    signal: AbortSignal): Promise<OfficialModelTurn> {
    // Native non-streaming adapters keep short plugin calls inexpensive; Responses requires the SDK transport.
    const client = options.protocol === 'openai_responses' || ['azure_openai', 'vertex', 'bedrock'].includes(options.providerId || '')
        ? createPreferredOfficialModelClient(options) : createOfficialModelClient(options);
    return client.complete({ instructions: input.instructions, messages: [{ role: 'user', content: input.text, attachments: imageAttachments(input.images) }],
        tools: [], ...(input.schema ? { outputSchema: { name: 'decisions', schema: input.schema } } : {}), maxOutputTokens: input.maxOutputTokens, signal });
}

/** Some shared adapters return text parts without a top-level content string. */
function pluginTurnText(turn: OfficialModelTurn): string {
    return turn.content ?? turn.outputParts?.flatMap(part => part.type === 'text' ? [part.text] : []).join('') ?? '';
}

const reads = (model: AppPluginConnection['models'][number], kind: string) => {
    const declared = model.capabilityDeclarations?.[`input:${kind}`];
    if (declared && declared.source !== 'model_heuristic' && declared.scope !== 'transport' && declared.support !== 'unknown') return declared.support === 'supported';
    return (model.inputModalities || []).some(value => value.toLowerCase() === kind);
};

function validDecision(request: AppPluginDecisionRequest): string | undefined {
    if (!isObject(request) || !isObject(request.model) || typeof request.model.model !== 'string' || !MODEL_ID.test(request.model.model)) return 'decision_model_required';
    if (typeof request.state !== 'string' || Buffer.byteLength(request.state) > MAX_STATE_BYTES) return 'decision_state_invalid';
    if (!isObject(request.questions)) return 'decision_questions_invalid';
    const names = Object.keys(request.questions);
    if (!names.length || names.length > 16 || names.some(name => !/^[\w.-]{1,80}$/.test(name))) return 'decision_questions_invalid';
    if (request.images !== undefined && (!Array.isArray(request.images) || request.images.length > 8
        || request.images.some(image => typeof image !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,/.test(image) || image.length > MAX_IMAGE_CHARS))) return 'decision_images_invalid';
    return undefined;
}

async function readJson(response: Response): Promise<unknown> {
    let text: string;
    if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let total = 0;
        try {
            while (true) {
                const part = await reader.read();
                if (part.done) break;
                total += part.value.byteLength;
                if (total > 2_000_000) throw Object.assign(new Error('decision_response_too_large'), { code: 'decision_response_too_large' });
                chunks.push(Buffer.from(part.value));
            }
        } finally {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
        }
        text = Buffer.concat(chunks, total).toString('utf8');
    } else {
        text = await response.text();
    }
    if (text.length > 2_000_000) throw Object.assign(new Error('decision_response_too_large'), { code: 'decision_response_too_large' });
    try { return JSON.parse(text); } catch { return text; }
}

function failure(status: number, payload: unknown): string {
    const code = isObject(payload) ? (isObject(payload.error) ? payload.error.code ?? payload.error.message : payload.code ?? payload.error) : undefined;
    const text = typeof code === 'string' || typeof code === 'number' ? String(code).slice(0, 80) : '';
    return status === 401 || status === 403 ? `decision_unauthorized${text ? `: ${text}` : ''}` : status === 402 ? 'decision_balance' : status === 429 ? 'decision_rate_limited' : `decision_http_${status}${text ? `: ${text}` : ''}`;
}

/** Decisions: https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request
 * Local System One: https://github.com/razorback16/openjev#api (including text errors and FastAPI detail lists).
 * These fields are presentation only; callers keep the same retry/acceptance decisions. */
function readableFailure(value: unknown, source: 'nextmux' | 'connection' | 'local', response?: Response, provider?: string) {
    const context: ModelErrorContext = { source: source === 'nextmux' ? 'relay' : source === 'local' ? 'local' : 'own_api', provider };
    return classifyModelError(response ? { status: response.status, body: value, headers: { 'retry-after': response.headers.get('retry-after') } } : value, context);
}

/** A JSON schema for the answers, and the prompt, so a chat model answers the questions a decision server would. */
export function chatDecisionRequest(state: string, questions: Readonly<Record<string, unknown>>): { readonly system: string; readonly user: string; readonly schema: Record<string, unknown> } {
    const properties: Record<string, unknown> = {};
    const lines: string[] = [];
    for (const [id, raw] of Object.entries(questions)) {
        const question = isObject(raw) ? raw : {};
        const instructions = typeof question.instructions === 'string' ? question.instructions.slice(0, 600) : '';
        if (question.type === 'noul') {
            properties[id] = { type: 'object', additionalProperties: false, required: ['yes'], properties: { yes: { type: 'number', minimum: 0, maximum: 1 } } };
            lines.push(`- "${id}": ${instructions} Answer {"yes": probability from 0 to 1}.`);
            continue;
        }
        const criteria = isObject(question.criteria) ? Object.entries(question.criteria).filter(([key]) => /^[\w.-]{1,80}$/.test(key)).slice(0, 32) : [];
        properties[id] = { type: 'object', additionalProperties: false, required: ['choice', 'confidence'],
            properties: { choice: { type: 'string', enum: criteria.map(([key]) => key) }, confidence: { type: 'number', minimum: 0, maximum: 1 } } };
        lines.push(`- "${id}": ${instructions} Options: ${criteria.map(([key, label]) => `"${key}" (${String(label).slice(0, 240)})`).join('; ')}. Answer {"choice": one option, "confidence": 0 to 1}.`);
    }
    return {
        system: 'You decide the next action of a program that plays or operates an app for the user. Read the state, answer every question, and reply with JSON only.',
        user: `State:\n${state}\n\nQuestions:\n${lines.join('\n')}`,
        schema: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties }
    };
}

/** A chat model's JSON reply as decision answers ({ answers: { id: { choice, confidence } | { noul } } }). */
export function chatDecisionAnswers(content: string | undefined, questions: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
    if (content === undefined) return undefined;
    const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch {
        const match = /\{[\s\S]*\}/.exec(text);
        try { parsed = match ? JSON.parse(match[0]) : undefined; } catch { parsed = undefined; }
    }
    if (!isObject(parsed)) return undefined;
    const answers: Record<string, unknown> = {};
    for (const [id, raw] of Object.entries(questions)) {
        const node = parsed[id];
        const question = isObject(raw) ? raw : {};
        if (question.type === 'noul') {
            const yes = isObject(node) ? node.yes : typeof node === 'number' || typeof node === 'boolean' ? node : undefined;
            const value = typeof yes === 'boolean' ? (yes ? 1 : 0) : typeof yes === 'number' ? yes : undefined;
            if (value !== undefined) answers[id] = { noul: Math.max(0, Math.min(1, value)) };
            continue;
        }
        const choice = isObject(node) ? node.choice : typeof node === 'string' ? node : undefined;
        if (typeof choice !== 'string' || !isObject(question.criteria) || !(choice in question.criteria)) continue;
        const confidence = isObject(node) && typeof node.confidence === 'number' ? node.confidence : 0.5;
        answers[id] = { choice, confidence: Math.max(0, Math.min(1, confidence)) };
    }
    return { answers };
}

/** One decision: the named questions answered by the chosen model. */
export async function decideAppPlugin(host: AppPluginDecisionHost, request: AppPluginDecisionRequest): Promise<AppPluginDecisionResult> {
    const invalid = validDecision(request);
    if (invalid) return { ok: false, error: invalid };
    const started = Date.now();
    const pending = pluginRequest(host, request, request.model.source === 'local' && request.model.protocol && request.model.protocol !== 'systemone' ? LOCAL_CHAT_TIMEOUT_MS : TIMEOUT_MS);
    let pricing: AppPluginTokenPrices | undefined = request.model.source === 'nextmux' ? request.model : undefined;
    let provider: string | undefined;
    let errorSource = request.model.source;
    let nativeOwnDecision = false;
    const body = { model: request.model.model, state: request.state, questions: request.questions };
    const images = request.model.images && request.images?.length ? request.images : [];
    try {
        pending.signal.throwIfAborted();
        let result: { response: Response; payload: unknown };
        if (request.model.source === 'nextmux') {
            if (images.length) return { ok: false, error: 'decision_images_unsupported' };
            if (isTevDecisionModel(body.model)) tevDecisionRequest(body.model, body.state, body.questions);
            result = await invokeNativeDecision({ ...body, protocol: 'nextmux_decisions', endpoint: `${host.baseUrl}/v1/decisions`, signal: pending.signal,
                ...(host.privacyPreference ? { privacyPreference: await host.privacyPreference() } : {}),
                fetchImpl: (url, init) => pending.fetch(host.fetch, url, init || {}),
                headers: { 'content-type': 'application/json', accept: 'application/json', 'x-nextmux-device-id': await host.deviceId(),
                    'idempotency-key': `plugin-${randomUUID()}`, ...(request.model.offeringId ? { 'x-nextmux-offering-id': request.model.offeringId } : {}) }
            });
        } else if (request.model.source === 'connection') {
            const connection = (await host.connections()).find(item => item.id === request.model.connectionId);
            if (!connection) return { ok: false, error: 'connection_missing' };
            provider = connection.providerId;
            pricing = connection.models.find(model => model.id === request.model.model);
            if (localEndpoint(connection.baseUrl)) errorSource = 'local';
            const metadata = connection.models.find(model => model.id === request.model.model);
            const transport = metadata && decisionTransportForModel(metadata, connection.protocol, { baseUrl: connection.baseUrl,
                declaration: metadata.decisionEndpointSupport });
            nativeOwnDecision = transport === 'openai_decisions';
            if (metadata) pricing = ownDecisionPrices(metadata, connection);
            const url = transport === 'tev1_chat' ? chatDecisionUrl(connection.baseUrl, connection.protocol)
                : transport === 'openrouter_decisions' ? decisionsUrl(connection.baseUrl)
                : transport === 'openai_decisions' ? openAIDecisionsUrl(connection.baseUrl) : undefined;
            if (!url) return { ok: false, error: 'decision_protocol_unsupported' };
            const key = await host.connectionKey(connection.id);
            const fetcher = localEndpoint(connection.baseUrl) ? host.localFetch || fetch : host.fetch;
            const invocation = { ...body, endpoint: url, signal: pending.signal, images,
                fetchImpl: ((input, init) => pending.fetch(fetcher, input, init || {})) as typeof fetch,
                headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), 'x-title': 'NextMux' } };
            result = transport === 'tev1_chat' ? await invokeTevDecision({ ...invocation, chatProtocol: connection.protocol })
                : await invokeNativeDecision({ ...invocation, protocol: transport === 'openai_decisions' ? 'openai_decisions' : 'openrouter_decisions' });
        } else if (request.model.source === 'local') {
            const endpoint = localEndpoint(request.model.endpoint);
            if (!endpoint) return { ok: false, error: 'local_endpoint_invalid' };
            const local = host.localFetch || fetch;
            const protocol: AppPluginLocalProtocol = request.model.protocol || 'systemone';
            if (isTevDecisionModel(body.model) && protocol !== 'systemone') {
                result = await invokeTevDecision({ ...body, endpoint: `${endpoint}/v1/chat/completions`, chatProtocol: 'openai', images,
                    signal: pending.signal, fetchImpl: (url, init) => pending.fetch(local, url, init || {}) });
            } else if (protocol === 'systemone') {
                result = await invokeNativeDecision({ ...body, protocol: 'systemone', endpoint: `${endpoint}/v1/systemone`, signal: pending.signal,
                    fetchImpl: (url, init) => pending.fetch(local, url, init || {}), images
                });
            } else {
                const prompt = chatDecisionRequest(request.state, request.questions);
                const turn = await pluginModelTurn({ protocol: 'openai_chat_completions', providerId: protocol === 'ollama' ? 'ollama' : undefined,
                    baseUrl: `${endpoint}/v1`, apiKey: 'local', model: request.model.model, allowInsecure: true, timeoutMs: 0,
                    fetchImpl: (url, init) => pending.fetch(local, url, init || {}) },
                    { text: prompt.user, instructions: prompt.system, schema: prompt.schema, images, maxOutputTokens: 256 }, pending.signal);
                pending.checkDeadline();
                if (pending.signal.aborted) return { ...cancelledResult(pending.signal, 'decision'), ...pluginCost(undefined, true, pricing), latencyMs: Date.now() - started };
                const answers = chatDecisionAnswers(pluginTurnText(turn), request.questions);
                return answers ? { ok: true, payload: answers, latencyMs: Date.now() - started, costUsd: 0, costStatus: 'known' }
                    : { ok: false, error: 'decision_answer_unreadable', costUsd: 0, costStatus: 'known',
                        readableError: readableFailure({ code: 'TOOL_CALL_PARSE_FAILED', message: 'The decision model returned invalid JSON answers.' }, errorSource), latencyMs: Date.now() - started };
            }
        } else return { ok: false, error: 'decision_source_invalid' };
        const { response } = result;
        const payload = nativeOwnDecision ? nativeDecisionReceipt(result.payload) : result.payload;
        const cost = pluginCost(payload, request.model.source === 'local', pricing, true, nativeOwnDecision);
        pending.checkDeadline();
        if (pending.signal.aborted) return { ...cancelledResult(pending.signal, 'decision'), ...cost, latencyMs: Date.now() - started };
        if (!response.ok || isObject(payload) && payload.error) return { ok: false, error: failure(response.status, payload),
            ...cost, readableError: readableFailure(payload, errorSource, response, provider), latencyMs: Date.now() - started };
        return { ok: true, payload, latencyMs: Date.now() - started, ...cost };
    } catch (error) {
        if (pending.signal.aborted) return { ...cancelledResult(pending.signal, 'decision'), ...pluginCost(undefined, request.model.source === 'local', pricing), latencyMs: Date.now() - started };
        const name = (error as { name?: string }).name;
        return { ok: false, error: name === 'TimeoutError' || name === 'AbortError' ? 'decision_timeout'
            : ['decision_choice_only', 'decision_images_unsupported', 'decision_protocol_unsupported'].includes(String((error as { code?: string }).code)) ? String((error as { code?: string }).code) : 'decision_network',
            ...pluginCost(undefined, request.model.source === 'local', pricing),
            readableError: readableFailure(name === 'TimeoutError' || name === 'AbortError' ? { code: 'TIMEOUT', message: error instanceof Error ? error.message : 'Request deadline exceeded' } : error, errorSource, undefined, provider), latencyMs: Date.now() - started };
    } finally { pending.finish(); }
}

/** The platform's relay decision models, with every merchant that sells each one. */
async function relayDecisionModels(host: AppPluginDecisionHost, errors: string[]): Promise<AppPluginRelayModel[]> {
    try {
        const response = await host.fetch(`${host.baseUrl}/v1/decision-models`, {
            headers: { accept: 'application/json', 'x-nextmux-device-id': await host.deviceId() }, signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        const payload = await readJson(response);
        if (!response.ok) { errors.push(`nextmux: ${failure(response.status, payload)}`); return []; }
        if (!isObject(payload) || !Array.isArray(payload.data)) return [];
        const models: AppPluginRelayModel[] = [];
        for (const item of payload.data.slice(0, 50)) {
            if (!isObject(item) || typeof item.id !== 'string' || !MODEL_ID.test(item.id)) continue;
            const routes = (Array.isArray(item.routes) ? item.routes.filter(isObject) : []).flatMap(route => {
                const price = Number(route.input_price_per_million_tokens);
                return typeof route.id === 'string' && Number.isFinite(price) ? [{ offeringId: route.id, merchant: typeof route.merchant_name === 'string' ? route.merchant_name.slice(0, 80) : '', inputPricePerMillion: price }] : [];
            }).sort((a, b) => a.inputPricePerMillion - b.inputPricePerMillion);
            if (!routes.length) continue;
            // The executable remote protocols are text-only, even when a model directory advertises image inputs.
            models.push({ model: item.id, label: typeof item.display_name === 'string' ? item.display_name.slice(0, 120) : item.id, routes,
                ...(typeof item.context_length === 'number' ? { contextTokens: item.context_length } : {}), images: false });
        }
        return models;
    } catch { errors.push('nextmux: decision_network'); return []; }
}

/** Own API connections: their decision models (output "decisions") and the chat models that read pictures. */
function connectionChoices(connections: readonly AppPluginConnection[], errors: string[], excluded: NonNullable<AppPluginModelChoices['excluded']>[number][]): AppPluginConnectionChoice[] {
    return connections.map(connection => {
        const label = (model: AppPluginConnection['models'][number]) => (model.label || model.id).slice(0, 120);
        const decisionModels = connection.models.filter(model => MODEL_ID.test(model.id) && isDecisionTaskModel(model)).slice(0, 50);
        const decisions = decisionModels.filter(model => decisionTransportForModel(model, connection.protocol, { baseUrl: connection.baseUrl,
            declaration: model.decisionEndpointSupport }))
            .map(model => ({ model: model.id, label: label(model), images: false, ...ownDecisionPrices(model, connection) }));
        const visionModels = connection.models.filter(model => MODEL_ID.test(model.id) && reads(model, 'image')
            && (model.outputModalities || ['text']).some(value => value.toLowerCase() === 'text') && !isDecisionOnlyModel(model)).slice(0, 80)
            .map(model => ({ model: model.id, label: label(model), ...tokenPrices(model) }));
        const vision = modelProtocol(connection.protocol) ? visionModels : [];
        if (decisionModels.length > decisions.length) {
            errors.push(`${connection.id}: decision_protocol_unsupported (${connection.protocol})`);
            excluded.push({ connectionId: connection.id, label: connection.label || connection.providerName, protocol: connection.protocol, kind: 'decision', reason: 'unsupported_transport' });
        }
        if (visionModels.length && !vision.length) {
            errors.push(`${connection.id}: vision_protocol_unsupported (${connection.protocol})`);
            excluded.push({ connectionId: connection.id, label: connection.label || connection.providerName, protocol: connection.protocol, kind: 'vision', reason: 'unsupported_transport' });
        }
        return { connectionId: connection.id, label: connection.label || connection.providerName, provider: connection.providerName, decisions, vision };
    }).filter(choice => choice.decisions.length || choice.vision.length);
}

/** Everything a plugin can use, grouped by where it runs: relays on the platform, own API connections, this computer. */
export async function appPluginModelChoices(host: AppPluginDecisionHost, query?: { readonly connectionId?: string }): Promise<AppPluginModelChoices> {
    const errors: string[] = [];
    const excluded: NonNullable<AppPluginModelChoices['excluded']>[number][] = [];
    if (query?.connectionId !== undefined) {
        const connections = await host.connections();
        return { relays: [], local: [], connections: connectionChoices(connections.filter(connection => connection.id === query.connectionId), errors, excluded), errors, ...(excluded.length ? { excluded } : {}) };
    }
    const [relays, connections, local] = await Promise.all([
        relayDecisionModels(host, errors),
        host.connections().then(connections => connectionChoices(connections, errors, excluded)).catch(() => { errors.push('connections: unreadable'); return [] as AppPluginConnectionChoice[]; }),
        Promise.all(KNOWN_LOCAL_SERVERS.map(endpoint => probeAppPluginServer(host, endpoint, 1_500)))
            .then(probes => probes.flatMap(probe => probe.ok && probe.server && probe.server.models.length ? [probe.server] : []))
    ]);
    return { relays, connections, local, errors, ...(excluded.length ? { excluded } : {}) };
}

/** Ollama's models, with the ones that read pictures marked (from /api/show capabilities). */
async function ollamaModels(fetcher: typeof fetch, base: string, timeout: number): Promise<AppPluginLocalServer['models'] | undefined> {
    const response = await fetcher(`${base}/api/tags`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeout) }).catch(() => undefined);
    if (!response?.ok) return undefined;
    const payload = await readJson(response).catch(() => undefined);
    if (!isObject(payload) || !Array.isArray(payload.models)) return undefined;
    const names = payload.models.filter(isObject).map(item => String(item.name ?? item.model ?? '')).filter(name => MODEL_ID.test(name)).slice(0, 40);
    return Promise.all(names.map(async model => {
        try {
            const shown = await fetcher(`${base}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(timeout) });
            const info = shown.ok ? await readJson(shown) : undefined;
            const capabilities = isObject(info) && Array.isArray(info.capabilities) ? info.capabilities.map(String) : [];
            return capabilities.includes('embedding') && !capabilities.includes('completion') ? undefined : { model, ...(capabilities.includes('vision') ? { images: true } : {}) };
        } catch { return { model }; }
    })).then(list => list.filter((item): item is { model: string; images?: true } => Boolean(item)));
}

/** What a model server on this computer is (Ollama, a decision server, an OpenAI-compatible chat server) and its models. */
export async function probeAppPluginServer(host: AppPluginDecisionHost, endpoint: string, timeout = 5_000): Promise<AppPluginServerProbe> {
    const base = localEndpoint(endpoint);
    if (!base) return { ok: false, error: 'local_endpoint_invalid' };
    const fetcher = host.localFetch || fetch;
    try {
        const ollama = await ollamaModels(fetcher, base, timeout);
        if (ollama) return { ok: true, server: { endpoint: base, protocol: 'ollama', name: 'Ollama', models: ollama } };
        const response = await fetcher(`${base}/v1/models`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
        const payload = await readJson(response);
        if (!response.ok) return { ok: false, error: `http_${response.status}` };
        const list = isObject(payload) && Array.isArray(payload.data) ? payload.data : isObject(payload) && Array.isArray(payload.models) ? payload.models : [];
        // A server that says which models take pictures (input_modalities, modalities, capabilities.vision or an
        // images flag, as LM Studio and vLLM do) keeps that, so a vision model can be chosen (audit A14-05).
        const seesImages = (item: unknown): boolean => {
            if (!isObject(item)) return false;
            const modalities = [item.input_modalities, item.modalities, isObject(item.architecture) ? item.architecture.input_modalities : undefined]
                .flatMap(value => Array.isArray(value) ? value : []).map(value => String(value).toLowerCase());
            const capabilities = isObject(item.capabilities) ? item.capabilities : undefined;
            return modalities.includes('image') || item.images === true || item.vision === true
                || capabilities?.vision === true || Array.isArray(item.capabilities) && item.capabilities.some(value => String(value).toLowerCase() === 'vision');
        };
        const entries = list.map(item => ({ id: isObject(item) ? String(item.id ?? item.name ?? '') : typeof item === 'string' ? item : '', images: seesImages(item) }))
            .filter(entry => MODEL_ID.test(entry.id)).slice(0, 50);
        const models = entries.map(entry => entry.id);
        // A decision server answers POST /v1/systemone; an empty body costs nothing and is rejected with 400/422, where
        // a chat-only server has no such route (404/405).
        const systemone = await fetcher(`${base}/v1/systemone`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(timeout) })
            .then(result => result.status !== 404 && result.status !== 405, () => false);
        const protocol: AppPluginLocalProtocol = systemone ? 'systemone' : 'openai';
        const name = systemone ? (models.some(id => /openjev/i.test(id)) ? 'OpenJev' : base) : new URL(base).port === '1234' ? 'LM Studio' : base;
        return { ok: true, server: { endpoint: base, protocol, name, models: entries.map(entry => ({ model: entry.id,
            ...(entry.images || systemone && /openjev/i.test(entry.id) ? { images: true } : {}) })) } };
    } catch { return { ok: false, error: 'local_server_unreachable' }; }
}

/** One sentence about the screen, for plugins that need to see when their decision model cannot. */
export async function describeAppPluginFrame(host: AppPluginDecisionHost, request: AppPluginDescribeRequest): Promise<AppPluginDescribeResult> {
    if (!isObject(request) || !isObject(request.vision) || typeof request.vision.model !== 'string' || !MODEL_ID.test(request.vision.model)) return { ok: false, error: 'vision_model_required' };
    if (typeof request.image !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,/.test(request.image) || request.image.length > MAX_IMAGE_CHARS) return { ok: false, error: 'vision_image_invalid' };
    const hints = typeof request.hints === 'string' ? request.hints.slice(0, 600) : '';
    const instruction = `Describe this game or app screen in one or two short sentences for an agent that decides the next key press. Mention positions (left/right/top/bottom) of what matters.${hints ? ` What matters: ${hints}` : ''}`;
    const started = Date.now();
    const pending = pluginRequest(host, request, request.vision.source === 'local' ? LOCAL_CHAT_TIMEOUT_MS : 20_000);
    let pricing: AppPluginTokenPrices | undefined;
    let provider: string | undefined;
    let errorSource = request.vision.source;
    let cost = pluginCost(undefined, request.vision.source === 'local', pricing);
    try {
        pending.signal.throwIfAborted();
        let options: OfficialModelClientOptions;
        let fetcher: typeof fetch;
        if (request.vision.source === 'connection') {
            const connection = (await host.connections()).find(item => item.id === request.vision.connectionId);
            if (!connection) return { ok: false, error: 'connection_missing' };
            provider = connection.providerId;
            const model = connection.models.find(model => model.id === request.vision.model);
            pricing = model;
            if (localEndpoint(connection.baseUrl)) errorSource = 'local';
            const protocol = modelProtocol(connection.protocol);
            if (!protocol) return { ok: false, error: 'vision_protocol_unsupported' };
            const key = await host.connectionKey(connection.id);
            fetcher = localEndpoint(connection.baseUrl) ? host.localFetch || fetch : host.fetch;
            options = { protocol, providerId: (connection.protocol === 'openrouter' ? 'openrouter' : connection.providerId) as OfficialModelClientOptions['providerId'],
                providerSettings: connection.providerSettings, baseUrl: connection.baseUrl, apiKey: key || (localEndpoint(connection.baseUrl) ? 'local' : ''), model: request.vision.model,
                ...(model ? { reasoningControls: model.reasoningControls, capabilityDeclarations: model.capabilityDeclarations, modalityLimits: model.modalityLimits } : {}), allowInsecure: Boolean(localEndpoint(connection.baseUrl)) };
        } else if (request.vision.source === 'local') {
            const endpoint = localEndpoint(request.vision.endpoint);
            if (!endpoint) return { ok: false, error: 'local_endpoint_invalid' };
            fetcher = host.localFetch || fetch;
            options = { protocol: 'openai_chat_completions', providerId: request.vision.protocol === 'ollama' ? 'ollama' : undefined,
                baseUrl: `${endpoint}/v1`, apiKey: 'local', model: request.vision.model, allowInsecure: true };
        } else return { ok: false, error: 'vision_source_invalid' };
        const turn = await pluginModelTurn({ ...options, timeoutMs: 0, fetchImpl: async (url, init) => {
            const response = await pending.fetch(fetcher, url, init || {});
            // Keep provider-reported charges even when a late reply arrives after cancellation.
            if (response.headers.get('content-type')?.includes('json')) {
                const payload = await readJson(response.clone()).catch(() => undefined);
                cost = pluginCost(payload, request.vision.source === 'local', pricing);
            }
            return response;
        } }, { text: instruction, images: [request.image], maxOutputTokens: 120 }, pending.signal);
        if (cost.costStatus === 'unknown' && turn.usageKnown !== false) {
            const usage: OfficialModelUsage | undefined = turn.usage;
            cost = pluginCost({ usage: { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
                cached_input_tokens: usage?.cachedInputTokens, cache_write_tokens: usage?.cacheWriteTokens } }, request.vision.source === 'local', pricing);
        }
        pending.checkDeadline();
        if (pending.signal.aborted) return { ...cancelledResult(pending.signal, 'vision'), ...cost, latencyMs: Date.now() - started };
        const text = pluginTurnText(turn).trim().slice(0, 600);
        return { ok: Boolean(text), text, latencyMs: Date.now() - started, ...cost, ...(text ? {} : { error: 'vision_empty' }) };
    } catch (error) {
        if (pending.signal.aborted) return { ...cancelledResult(pending.signal, 'vision'), ...cost, latencyMs: Date.now() - started };
        const name = (error as { name?: string }).name;
        return { ok: false, error: name === 'TimeoutError' || name === 'AbortError' ? 'vision_timeout' : 'vision_network',
            ...cost,
            readableError: readableFailure(name === 'TimeoutError' || name === 'AbortError' ? { code: 'TIMEOUT', message: error instanceof Error ? error.message : 'Request deadline exceeded' } : error, errorSource, undefined, provider) };
    } finally { pending.finish(); }
}
