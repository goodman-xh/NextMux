/**
 * Async media APIs described by a template: submit a task, poll it, read the file link.
 *
 * Relays and providers all follow "submit → poll → result", but differ in six things: the submit
 * and poll addresses, how the key is sent, the request body's field names, where the task id /
 * state / file link sit in the answers, and whether pictures go as links or base64. A template
 * records those six things; the presets below cover the common formats (速创, OpenAI videos,
 * 阿里百炼, 火山方舟, 硅基流动, fal.ai, Replicate and the usual relay /video/create shape), and a
 * merchant or user can adjust any field under 高级.
 *
 * The platform keeps a JavaScript twin (apps/cloudflare-platform/src/media-api-template.js); both
 * are tested against the same preset behaviour.
 */

export type MediaTemplateAuth = string;
export type MediaTemplateImages = 'link' | 'data_url' | 'base64' | 'none';
/** Audio delivery is independent for the singing voice and the song being restyled. */
export interface MediaTemplateAudioUpload {
  readonly method: 'POST';
  readonly path: string;
  readonly format: 'multipart' | 'json';
  readonly fileField: string;
  /** Extra multipart fields, or a JSON request body. Audio placeholders are available in both. */
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly idField: string;
  /** Omit for provider ids with no documented expiry; otherwise bound retry reuse. */
  readonly expiresInSeconds?: number;
}
export interface MediaTemplateAudioInput {
  readonly mode: 'url' | 'base64' | 'upload';
  readonly upload?: MediaTemplateAudioUpload;
}
export interface MediaTemplateAudioSource {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly filename: string;
  readonly url?: string;
}
export interface MediaTemplateAudioResult {
  readonly value: string;
  readonly uploadedId?: string;
  /** Unix milliseconds, suitable for storing alongside the uploaded id. */
  readonly expiresAt?: number;
}
export interface MediaTemplateAudioContext {
  readonly link: (source: MediaTemplateAudioSource) => Promise<string>;
  readonly upload: (upload: MediaTemplateAudioUpload, source: MediaTemplateAudioSource, body: Record<string, unknown>) => Promise<unknown>;
  /** The caller must scope this cache to the account, model, upload template and source bytes. */
  readonly cachedUpload?: { readonly id: string; readonly expiresAt?: number };
  readonly now?: number;
}
export interface MediaApiTemplate {
  readonly preset: string;
  readonly kind: 'video' | 'image' | 'music';
  readonly submit: { readonly method: 'POST'; readonly path: string; readonly body: string; readonly headers: Readonly<Record<string, string>> };
  readonly poll: { readonly method: 'GET' | 'POST'; readonly path: string; readonly body: string };
  /** Only declared provider cancellation endpoints are called; omitting it means unsupported. */
  readonly cancel?: { readonly method: 'POST' | 'PUT' | 'DELETE'; readonly path: string; readonly body: string };
  readonly downloadPath: string;
  readonly pollUrlField: string;
  readonly resultUrlField: string;
  readonly idField: string;
  readonly statusField: string;
  readonly doneValues: readonly string[];
  readonly failedValues: readonly string[];
  readonly resultField: string;
  readonly errorField: string;
  readonly auth: MediaTemplateAuth;
  readonly images: MediaTemplateImages;
  readonly seconds: readonly number[];
  readonly maxReferences: number;
  /** '' or a ratio such as '16:9' the reference pictures are padded to. */
  readonly referenceAspect: string;
  readonly vocalReference?: MediaTemplateAudioInput;
  readonly referenceSong?: MediaTemplateAudioInput;
}
export interface MediaTemplateRequest {
  readonly model: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly seconds?: number;
  readonly width?: number;
  readonly height?: number;
  readonly firstFrame?: string;
  readonly lastFrame?: string;
  readonly references?: readonly string[];
  readonly id?: string;
  readonly title?: string;
  readonly lyrics?: string;
  readonly genre?: string;
  readonly mood?: string;
  readonly instrumental?: boolean;
  readonly mode?: 'generate' | 'cover';
  /** Values already prepared by mediaTemplateAudio: a URL, base64 or uploaded id. */
  readonly vocalReference?: string;
  readonly referenceSong?: string;
}
type Json = any;

const SUBMIT_BODY = {
  relay: '{"model":"{{model}}","prompt":"{{prompt}}","images":"{{images}}","aspect_ratio":"{{aspect_ratio}}","duration":"{{seconds}}"}',
};

export const MEDIA_TEMPLATE_PRESETS: Readonly<Record<string, Json>> = Object.freeze({
  wuyin: {
    label: '速创 API', kind: 'video',
    submit: { method: 'POST', path: '{base}/{model}', body: '{"prompt":"{{prompt}}","firstFrameUrl":"{{first_frame}}","lastFrameUrl":"{{last_frame}}","urls":"{{references}}","aspectRatio":"{{aspect_ratio}}","size":"{{resolution}}"}' },
    poll: { method: 'GET', path: '{base}/detail?id={id}' },
    idField: 'data.id', statusField: 'data.status', doneValues: ['2'], failedValues: ['3'],
    resultField: 'data.result', errorField: 'data.message,debug',
    auth: 'raw', images: 'link', seconds: [8], maxReferences: 3, referenceAspect: '16:9',
  },
  openai: {
    label: 'OpenAI 视频（/v1/videos）', kind: 'video',
    submit: { method: 'POST', path: '{base}/videos', body: '{"model":"{{model}}","prompt":"{{prompt}}","seconds":"{{seconds_text}}","size":"{{size}}"}' },
    poll: { method: 'GET', path: '{base}/videos/{id}' },
    downloadPath: '{base}/videos/{id}/content',
    idField: 'id', statusField: 'status', doneValues: ['completed'], failedValues: ['failed', 'cancelled'],
    resultField: '', errorField: 'error.message',
    auth: 'bearer', images: 'none', seconds: [4, 8, 12], maxReferences: 0,
  },
  dashscope: {
    label: '阿里云百炼（万相）', kind: 'video',
    submit: { method: 'POST', path: '{base}/services/aigc/video-generation/video-synthesis', headers: { 'X-DashScope-Async': 'enable' },
      body: '{"model":"{{model}}","input":{"prompt":"{{prompt}}","negative_prompt":"{{negative_prompt}}","img_url":"{{first_frame}}"},"parameters":{"resolution":"{{resolution_upper}}","duration":"{{seconds}}"}}' },
    poll: { method: 'GET', path: '{base}/tasks/{id}' },
    idField: 'output.task_id', statusField: 'output.task_status', doneValues: ['SUCCEEDED'], failedValues: ['FAILED', 'CANCELED', 'UNKNOWN'],
    resultField: 'output', errorField: 'output.message,message',
    auth: 'bearer', images: 'link', seconds: [5, 10], maxReferences: 0,
  },
  ark: {
    label: '火山方舟（Seedance）', kind: 'video',
    submit: { method: 'POST', path: '{base}/contents/generations/tasks',
      body: '{"model":"{{model}}","content":[{"type":"text","text":"{{prompt}} --ratio {{aspect_ratio}} --duration {{seconds}} --resolution {{resolution}}"},{"type":"image_url","image_url":{"url":"{{first_frame}}"},"role":"first_frame"},{"type":"image_url","image_url":{"url":"{{last_frame}}"},"role":"last_frame"}]}' },
    poll: { method: 'GET', path: '{base}/contents/generations/tasks/{id}' },
    cancel: { method: 'DELETE', path: '{base}/contents/generations/tasks/{id}' },
    idField: 'id', statusField: 'status', doneValues: ['succeeded'], failedValues: ['failed', 'cancelled', 'expired'],
    resultField: 'content', errorField: 'error.message',
    auth: 'bearer', images: 'data_url', seconds: [5, 10], maxReferences: 0,
  },
  siliconflow: {
    label: '硅基流动', kind: 'video',
    submit: { method: 'POST', path: '{base}/video/submit', body: '{"model":"{{model}}","prompt":"{{prompt}}","negative_prompt":"{{negative_prompt}}","image_size":"{{size}}","image":"{{first_frame}}"}' },
    poll: { method: 'POST', path: '{base}/video/status', body: '{"requestId":"{{id}}"}' },
    idField: 'requestId', statusField: 'status', doneValues: ['Succeed'], failedValues: ['Failed'],
    resultField: 'results', errorField: 'reason,message',
    auth: 'bearer', images: 'data_url', seconds: [], maxReferences: 0,
  },
  fal: {
    label: 'fal.ai 队列', kind: 'video',
    submit: { method: 'POST', path: '{base}/{model}', body: '{"prompt":"{{prompt}}","negative_prompt":"{{negative_prompt}}","image_url":"{{first_frame}}","end_image_url":"{{last_frame}}","aspect_ratio":"{{aspect_ratio}}","duration":"{{seconds_text}}"}' },
    poll: { method: 'GET', path: '{base}/{model}/requests/{id}/status' },
    cancel: { method: 'PUT', path: '{base}/{model}/requests/{id}/cancel' },
    pollUrlField: 'status_url', resultUrlField: 'response_url',
    idField: 'request_id', statusField: 'status', doneValues: ['COMPLETED'], failedValues: ['FAILED', 'ERROR'],
    resultField: '', errorField: 'error,detail',
    auth: 'key', images: 'data_url', seconds: [], maxReferences: 0,
  },
  replicate: {
    label: 'Replicate', kind: 'video',
    submit: { method: 'POST', path: '{base}/models/{model}/predictions', body: '{"input":{"prompt":"{{prompt}}","negative_prompt":"{{negative_prompt}}","image":"{{first_frame}}","aspect_ratio":"{{aspect_ratio}}","duration":"{{seconds}}"}}' },
    poll: { method: 'GET', path: '{base}/predictions/{id}' },
    cancel: { method: 'POST', path: '{base}/predictions/{id}/cancel' },
    pollUrlField: 'urls.get',
    idField: 'id', statusField: 'status', doneValues: ['succeeded'], failedValues: ['failed', 'canceled'],
    resultField: 'output', errorField: 'error',
    auth: 'bearer', images: 'data_url', seconds: [], maxReferences: 0,
  },
  relay: {
    label: '通用中转（/video/create）', kind: 'video',
    submit: { method: 'POST', path: '{base}/video/create', body: SUBMIT_BODY.relay },
    poll: { method: 'GET', path: '{base}/video/query?id={id}' },
    idField: 'id,task_id,data.id,data.task_id', statusField: 'status,data.status,state,data.state',
    doneValues: ['completed', 'succeeded', 'success', 'succeed', 'done', 'finished'], failedValues: ['failed', 'failure', 'error', 'cancelled', 'canceled'],
    resultField: '', errorField: 'error.message,message,msg,error',
    auth: 'bearer', images: 'link', seconds: [], maxReferences: 3,
  },
});

/** Addresses that belong to a preset, for automatic recognition of a pasted address. */
export function mediaTemplatePresetForUrl(value: unknown): string | undefined {
  let host = '';
  try { host = new URL(String(value || '')).hostname.toLowerCase(); } catch { return undefined; }
  if (host === 'api.wuyinkeji.com') return 'wuyin';
  if (host === 'dashscope.aliyuncs.com' || host === 'dashscope-intl.aliyuncs.com') return 'dashscope';
  if (/^ark\.[a-z0-9-]+\.volces\.com$/.test(host) || host.endsWith('.byteplusapi.com')) return 'ark';
  if (host === 'api.siliconflow.cn' || host === 'api.siliconflow.com') return 'siliconflow';
  if (host === 'queue.fal.run' || host === 'fal.run') return 'fal';
  if (host === 'api.replicate.com') return 'replicate';
  if (host === 'api.openai.com') return 'openai';
  return undefined;
}

/** Presets for APIs that only take generation tasks (no chat): their address alone says which format. */
export const GENERATION_ONLY_PRESETS: readonly string[] = Object.freeze(['wuyin', 'fal', 'replicate']);

export function generationPresetForUrl(value: unknown): string | undefined {
  const preset = mediaTemplatePresetForUrl(value);
  return preset && GENERATION_ONLY_PRESETS.includes(preset) ? preset : undefined;
}

const AUTH_STYLES = /^(?:bearer|raw|key|header:[A-Za-z0-9-]{1,64}|query:[A-Za-z0-9_.-]{1,64})$/;
const FIELD = /^[A-Za-z0-9_.[\]-]{0,120}$/;
const DENIED_HEADERS = new Set(['host', 'content-length', 'authorization', 'cookie', 'connection', 'transfer-encoding', 'proxy-authorization']);

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length <= max && !/[\r\n\0]/.test(value) ? value.trim() : undefined;
}
function fields(value: unknown): string[] {
  return String(value ?? '').split(/[,，]/).map(item => item.trim()).filter(Boolean);
}
/** One entry of a length list: a number, or a range such as "4-30" (at most 120 values). */
function secondsItem(item: unknown): number[] {
  const range = /^\s*(\d{1,3})\s*[-~–—至到]\s*(\d{1,3})\s*$/.exec(String(item));
  if (!range) return [Number(item)];
  const [from, to] = [Number(range[1]), Number(range[2])].sort((left, right) => left - right);
  return Array.from({ length: Math.min(120, to - from + 1) }, (_, index) => from + index);
}
function values(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(list.map(item => String(item).trim()).filter(Boolean))].slice(0, 12).filter(item => item.length <= 40);
}

/** Canonical fields carry their own English diagnostic labels; UI uses params.field only. */
function mediaTemplateFieldLabel(field: string): string {
  const labels: Readonly<Record<string, string>> = { 'vocalReference.upload.idField': 'vocalReference upload id field', 'referenceSong.upload.idField': 'referenceSong upload id field', downloadPath: 'download path', pollUrlField: 'poll URL field', resultUrlField: 'result URL field', idField: 'task id field', statusField: 'status field', resultField: 'result field', errorField: 'error field' };
  return labels[field] ?? field.replace(/\./g, ' ');
}

export interface MediaTemplateValidationError extends Error {
  readonly code: 'media_template_invalid';
  readonly domain: 'operation';
  readonly messageKey: 'media_template.invalid';
  readonly params: { readonly field: string; readonly reason: string; readonly max?: number };
}
function mediaTemplateError(message: string, field: string, reason: string, max?: number): MediaTemplateValidationError {
  return Object.assign(new Error(message), {
    code: 'media_template_invalid' as const, domain: 'operation' as const, messageKey: 'media_template.invalid' as const,
    params: { field, reason, ...(max === undefined ? {} : { max }) },
  });
}

/**
 * A template from a preset id and/or edited fields. Invalid input throws (code media_template_invalid)
 * with the offending field named, so a form can say what to fix.
 */
export function normalizeMediaTemplate(input: unknown): MediaApiTemplate {
  const source: Json = input && typeof input === 'object' ? input : {};
  const preset = typeof source.preset === 'string' && Object.prototype.hasOwnProperty.call(MEDIA_TEMPLATE_PRESETS, source.preset) ? source.preset : 'relay';
  const base = MEDIA_TEMPLATE_PRESETS[preset];
  const pick = (key: string, fallback: unknown): Json => source[key] === undefined ? fallback : source[key];
  const path = (value: unknown, name: string): string => {
    const result = text(value, 1000);
    if (!result || !(/^\{base\}/.test(result) || /^https:\/\//i.test(result))) throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} must start with {base} or https://`, name, 'invalid_path');
    return result;
  };
  const body = (value: unknown, name: string, required: boolean): string => {
    if (value === undefined || value === '') { if (required) throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} is required`, name, 'required'); return ''; }
    if (typeof value !== 'string' || value.length > 8000) throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} is too long`, name, 'too_long', 8000);
    try { const parsed = JSON.parse(value); if (!parsed || typeof parsed !== 'object') throw new Error(); } catch { throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} must be a JSON object`, name, 'invalid_json_object'); }
    return value;
  };
  const method = (value: unknown, allowed: readonly string[], name = 'method'): Json => { const upper = String(value || '').toUpperCase(); if (!allowed.includes(upper)) throw mediaTemplateError(`method must be ${allowed.join(' or ')}`, name, 'invalid_method'); return upper; };
  const field = (value: unknown, name: string, allowEmpty = true): string => {
    const result = String(value ?? '');
    if (result.length > 400 || !fields(result).every(item => FIELD.test(item)) || (!allowEmpty && !fields(result).length)) throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} is not a field path`, name, 'invalid_field_path');
    return fields(result).join(',');
  };
  const headers = (value: unknown): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [name, content] of Object.entries(value && typeof value === 'object' ? value : {}).slice(0, 20)) {
      if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || DENIED_HEADERS.has(name.toLowerCase())) throw mediaTemplateError(`header ${mediaTemplateFieldLabel(name)} is not allowed`, 'headers', 'header_not_allowed');
      const clean = text(String(content), 500);
      if (clean === undefined) throw mediaTemplateError(`header ${mediaTemplateFieldLabel(name)} has an invalid value`, 'headers', 'invalid_header_value');
      result[name] = clean;
    }
    return result;
  };
  const submit = { ...base.submit, ...(source.submit || {}) };
  const poll = { ...base.poll, ...(source.poll || {}) };
  const auth = String(pick('auth', base.auth));
  if (!AUTH_STYLES.test(auth)) throw mediaTemplateError('auth must be bearer, raw, key, header:Name or query:name', 'auth', 'invalid_auth');
  const images = String(pick('images', base.images));
  if (!['link', 'data_url', 'base64', 'none'].includes(images)) throw mediaTemplateError('images must be link, data_url, base64 or none', 'images', 'invalid_images');
  const kind = String(pick('kind', base.kind));
  if (!['video', 'image', 'music'].includes(kind)) throw mediaTemplateError('kind must be video, image or music', 'kind', 'invalid_kind');
  const audioInput = (value: Json, name: string): MediaTemplateAudioInput | undefined => {
    if (value === undefined || value === null) return undefined;
    if (kind !== 'music') throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} requires music kind`, name, 'requires_music');
    if (!value || typeof value !== 'object' || !['url', 'base64', 'upload'].includes(value.mode)) throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} mode must be url, base64 or upload`, name, 'invalid_mode');
    if (value.mode !== 'upload') return { mode: value.mode };
    const upload = value.upload;
    if (!upload || typeof upload !== 'object') throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} upload request is required`, name, 'upload_required');
    const format = upload.format ?? 'multipart';
    if (!['multipart', 'json'].includes(format)) throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} upload format must be multipart or json`, name, 'invalid_upload_format');
    const fileField = String(upload.fileField ?? 'file');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(fileField) || ['__proto__', 'constructor', 'prototype'].includes(fileField)) throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} upload file field is invalid`, name, 'invalid_upload_field');
    const uploadBody = body(upload.body ?? '{}', `${name}.upload.body`, true);
    if (Array.isArray(JSON.parse(uploadBody))) throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} upload body must be a JSON object`, name, 'invalid_upload_body');
    const expiresInSeconds = upload.expiresInSeconds === undefined ? undefined : Number(upload.expiresInSeconds);
    if (expiresInSeconds !== undefined && (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 31536000)) throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} upload expiry must be 1–31536000 seconds`, name, 'invalid_expiry', 31536000);
    return { mode: 'upload', upload: {
      method: method(upload.method ?? 'POST', ['POST'], `${name}.upload.method`), path: path(upload.path, `${name}.upload.path`),
      format, fileField, body: uploadBody, headers: (() => {
        if (upload.headers !== undefined && (!upload.headers || typeof upload.headers !== 'object' || Array.isArray(upload.headers))) throw mediaTemplateError(`${mediaTemplateFieldLabel(name)} upload headers must be a JSON object`, name, 'invalid_upload_headers');
        return headers(upload.headers);
      })(),
      idField: field(upload.idField, `${name}.upload.idField`, false),
      ...(expiresInSeconds === undefined ? {} : { expiresInSeconds }),
    } };
  };
  const vocalReference = audioInput(source.vocalReference, 'vocalReference');
  const referenceSong = audioInput(source.referenceSong, 'referenceSong');
  const cancelValue = pick('cancel', base.cancel);
  let cancel: MediaApiTemplate['cancel'];
  if (cancelValue !== undefined && cancelValue !== null) {
    if (!cancelValue || typeof cancelValue !== 'object' || Array.isArray(cancelValue)) throw mediaTemplateError('cancel request must be a JSON object', 'cancel', 'invalid_json_object');
    const cancelBody = body(cancelValue.body, 'cancel.body', false);
    if (cancelBody && Array.isArray(JSON.parse(cancelBody))) throw mediaTemplateError('cancel body must be a JSON object', 'cancel.body', 'invalid_json_object');
    cancel = { method: method(cancelValue.method, ['POST', 'PUT', 'DELETE'], 'cancel.method'), path: path(cancelValue.path, 'cancel.path'), body: cancelBody };
  }
  // Every length the API makes (Wan 3.0: 4–30 s), written as a list and/or ranges: "5, 10" or "4-30".
  const listed: unknown[] = Array.isArray(pick('seconds', base.seconds)) ? pick('seconds', base.seconds) : fields(pick('seconds', base.seconds));
  const seconds = [...new Set(listed.flatMap(secondsItem).filter(value => Number.isInteger(value) && value >= 1 && value <= 120))].sort((left, right) => left - right);
  const maxReferences = Math.max(0, Math.min(16, Math.trunc(Number(pick('maxReferences', base.maxReferences)) || 0)));
  // Some APIs want reference pictures in one shape (速创: 16:9); they are padded with white to it.
  const referenceAspect = String(pick('referenceAspect', base.referenceAspect) || '');
  if (referenceAspect && !['16:9', '9:16', '1:1', '4:3', '3:4'].includes(referenceAspect)) throw mediaTemplateError('reference shape must be 16:9, 9:16, 1:1, 4:3 or 3:4', 'referenceAspect', 'invalid_aspect');
  const optionalPath = (value: unknown, name: string): string => value ? path(value, name) : '';
  return {
    preset, kind: kind as MediaApiTemplate['kind'],
    submit: { method: method(submit.method, ['POST']), path: path(submit.path, 'submit.path'), body: body(submit.body, 'submit.body', true), headers: headers(submit.headers) },
    poll: { method: method(poll.method, ['GET', 'POST']), path: path(poll.path, 'poll.path'), body: body(poll.body, 'poll.body', false) },
    ...(cancel ? { cancel } : {}),
    downloadPath: optionalPath(pick('downloadPath', base.downloadPath), 'downloadPath'),
    pollUrlField: field(pick('pollUrlField', base.pollUrlField), 'pollUrlField'),
    resultUrlField: field(pick('resultUrlField', base.resultUrlField), 'resultUrlField'),
    idField: field(pick('idField', base.idField), 'idField', false),
    statusField: field(pick('statusField', base.statusField), 'statusField', false),
    doneValues: values(pick('doneValues', base.doneValues)),
    failedValues: values(pick('failedValues', base.failedValues)),
    resultField: field(pick('resultField', base.resultField), 'resultField'),
    errorField: field(pick('errorField', base.errorField), 'errorField'),
    auth, images: images as MediaTemplateImages, seconds, maxReferences, referenceAspect,
    ...(vocalReference ? { vocalReference } : {}),
    ...(referenceSong ? { referenceSong } : {}),
  };
}

/** Reads `a.b[0].c`; the first of several comma-separated paths that has a value. */
export function readField(payload: Json, paths: string): Json {
  for (const path of fields(paths)) {
    let current: Json = payload;
    for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
      if (current === null || current === undefined) break;
      current = current[part];
    }
    if (current !== undefined && current !== null && current !== '') return current;
  }
  return fields(paths).length ? undefined : payload;
}

/** A path template with {base}, {model} and {id} filled in (the model keeps its slashes, e.g. fal-ai/veo3). */
export function fillMediaPath(template: string, { base, model = '', id = '' }: { readonly base: string; readonly model?: string; readonly id?: string }): string {
  const root = String(base || '').replace(/\/+$/, '');
  return String(template)
    .replaceAll('{base}', root)
    .replaceAll('{model}', String(model).split('/').map(encodeURIComponent).join('/'))
    .replaceAll('{id}', encodeURIComponent(String(id)));
}

const MISSING = Symbol('missing');

/**
 * The JSON body from its template. "{{name}}" as a whole value keeps the value's type (number,
 * list); inside a longer text it is written in. A field whose value is missing is left out, and a
 * list item that needs a missing value is dropped (火山方舟's first-frame item without a picture).
 */
export function renderMediaBody(template: string, variables: Record<string, unknown>): Json {
  // Each step answers its value and whether a placeholder under it had no value.
  const resolve = (value: Json): { value: Json; missing: boolean; dynamic: boolean } => {
    if (typeof value === 'string') {
      const whole = /^\{\{([a-z_][a-z0-9_]*)\}\}$/.exec(value);
      if (whole) {
        const found = variables[whole[1]];
        const missing = found === undefined || found === null || found === '' || (Array.isArray(found) && !found.length);
        return { value: missing ? MISSING : found, missing, dynamic: true };
      }
      const dynamic = /\{\{([a-z_][a-z0-9_]*)\}\}/.test(value);
      return { value: value.replace(/\{\{([a-z_][a-z0-9_]*)\}\}/g, (_: string, name: string) => variables[name] === undefined || variables[name] === null ? '' : String(variables[name]))
        .replace(/\s+--[a-z_]+\s+(?=--|$)/g, ' ').trim(), missing: false, dynamic };
    }
    if (Array.isArray(value)) return { value: value.map(resolve).filter(item => !item.missing && item.value !== MISSING).map(item => item.value), missing: false, dynamic: true };
    if (value && typeof value === 'object') {
      const result: Record<string, Json> = {};
      let missingAny = false, dynamicKept = 0, totalKept = 0;
      for (const [key, item] of Object.entries(value)) {
        const resolved = resolve(item);
        if (resolved.missing) missingAny = true;
        if (resolved.value !== MISSING) {
          result[key] = resolved.value;
          totalKept++;
          if (resolved.dynamic) dynamicKept++;
        }
      }
      const missing = missingAny && dynamicKept === 0;
      if (missing && totalKept === 0) return { value: MISSING, missing: true, dynamic: true };
      return { value: result, missing, dynamic: dynamicKept > 0 || missingAny };
    }
    return { value, missing: false, dynamic: false };
  };
  if (!template) return undefined;
  const resolved = resolve(JSON.parse(template)).value;
  return resolved === MISSING ? {} : resolved;
}

/** The values a body template can use, from a video, picture or music request. */
export function mediaTemplateVariables(request: MediaTemplateRequest): Record<string, unknown> {
  const width = Number(request.width) || 1280;
  const height = Number(request.height) || 720;
  const ratio = width / height;
  const aspect = ratio < 0.84 ? '9:16' : ratio > 1.2 ? '16:9' : '1:1';
  const long = Math.max(width, height);
  const resolution = long >= 3000 ? '4k' : long >= 1900 ? '1080p' : long >= 1200 ? '720p' : '480p';
  const references = request.references || [];
  return {
    model: request.model,
    prompt: request.prompt,
    negative_prompt: request.negativePrompt || undefined,
    seconds: request.seconds || undefined,
    seconds_text: request.seconds ? String(request.seconds) : undefined,
    aspect_ratio: aspect,
    width, height,
    size: `${width}x${height}`,
    size_star: `${width}*${height}`,
    resolution,
    resolution_upper: resolution.toUpperCase(),
    first_frame: request.firstFrame || undefined,
    last_frame: request.lastFrame || undefined,
    references: references.length ? references : undefined,
    reference: references[0],
    images: request.firstFrame ? [request.firstFrame, ...references] : references.length ? references : undefined,
    // Some APIs (速创 Wan / MiniMax / omni) take several pictures as one comma-joined string.
    references_csv: references.length ? references.join(',') : undefined,
    images_csv: request.firstFrame || references.length ? [request.firstFrame, ...references].filter(Boolean).join(',') : undefined,
    image: request.firstFrame || references[0],
    id: request.id,
    title: request.title || undefined,
    lyrics: request.lyrics || undefined,
    genre: request.genre || undefined,
    mood: request.mood || undefined,
    instrumental: request.instrumental,
    music_mode: request.mode,
    vocal_reference: request.vocalReference || undefined,
    reference_song: request.referenceSong || undefined,
  };
}

/** How the key travels: headers to add and query parameters to set. */
export function mediaTemplateAuth(auth: string, key: string): { readonly headers: Record<string, string>; readonly query: readonly (readonly [string, string])[] } {
  if (auth === 'raw') return { headers: { authorization: key }, query: [] };
  if (auth === 'key') return { headers: { authorization: `Key ${key}` }, query: [] };
  if (auth.startsWith('header:')) return { headers: { [auth.slice(7)]: key }, query: [] };
  if (auth.startsWith('query:')) return { headers: {}, query: [[auth.slice(6), key]] };
  return { headers: { authorization: `Bearer ${key}` }, query: [] };
}

export function mediaTaskState(payload: Json, template: MediaApiTemplate): 'completed' | 'failed' | 'running' {
  const status = String(readField(payload, template.statusField) ?? '').trim().toLowerCase();
  if (status && template.doneValues.some(value => value.toLowerCase() === status)) return 'completed';
  if (status && template.failedValues.some(value => value.toLowerCase() === status)) return 'failed';
  return 'running';
}

export function mediaTaskId(payload: Json, template: MediaApiTemplate): string {
  const value = readField(payload, template.idField);
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, 300) : '';
}

export function mediaTaskError(payload: Json, template: MediaApiTemplate): string {
  const value = template.errorField ? readField(payload, template.errorField) : undefined;
  if (typeof value === 'string') return value.slice(0, 300);
  if (value && typeof value === 'object') return JSON.stringify(value).slice(0, 300);
  return '';
}

const LINK_KEYS = ['video_url', 'videoUrl', 'image_url', 'imageUrl', 'audio_url', 'audioUrl', 'music_url', 'musicUrl', 'url', 'file_url', 'download_url', 'uri', 'video', 'videos', 'image', 'images', 'audio', 'music', 'output', 'outputs', 'result', 'results', 'urls', 'data'];

// Queue-control URLs name JSON/status/cancellation endpoints, never generated media.
const CONTROL_LINK_KEYS = new Set(['status_url', 'statusurl', 'response_url', 'responseurl', 'poll_url', 'pollurl', 'cancel_url', 'cancelurl', 'result_url', 'resulturl', 'request_url', 'requesturl', 'logs_url', 'logsurl', 'get', 'cancel', 'stream']);

/** The first http(s) file link at or under a value (known link keys first). */
export function findMediaLink(value: Json, depth = 0): string {
  if (depth > 6) return '';
  if (typeof value === 'string') return /^https?:\/\/\S+$/i.test(value.trim()) ? value.trim() : '';
  if (Array.isArray(value)) { for (const item of value.slice(0, 20)) { const found = findMediaLink(item, depth + 1); if (found) return found; } return ''; }
  if (value && typeof value === 'object') {
    for (const key of LINK_KEYS) { if (key in value) { const found = findMediaLink(value[key], depth + 1); if (found) return found; } }
    for (const [key, item] of Object.entries(value).slice(0, 40)) { if (!LINK_KEYS.includes(key) && !CONTROL_LINK_KEYS.has(key.toLowerCase())) { const found = findMediaLink(item, depth + 1); if (found) return found; } }
  }
  return '';
}

export function mediaResultLink(payload: Json, template: MediaApiTemplate): string {
  return findMediaLink(template.resultField ? readField(payload, template.resultField) : payload);
}

/** The picture as the template wants it: a link (hosted by the caller), a data URL or bare base64. */
export async function mediaTemplateImage(image: { readonly mimeType: string; readonly dataBase64: string; readonly url?: string } | undefined, template: MediaApiTemplate, link: (image: { readonly mimeType: string; readonly dataBase64: string }) => Promise<string>): Promise<string | undefined> {
  if (!image) return undefined;
  if (template.images === 'link') return image.url || await link(image);
  if (template.images === 'base64') return image.dataBase64;
  return `data:${image.mimeType};base64,${image.dataBase64}`;
}

/** Prepare an audio reference without selecting a provider or owning its HTTP/authentication. */
export async function mediaTemplateAudio(source: MediaTemplateAudioSource, input: MediaTemplateAudioInput | undefined, context: MediaTemplateAudioContext): Promise<MediaTemplateAudioResult> {
  if (!input) throw Object.assign(new Error('The music template does not support this audio reference'), { code: 'media_template_audio_unsupported' });
  if (input.mode === 'url') {
    const value = source.url || await context.link(source);
    if (!/^https?:\/\/\S+$/i.test(value)) throw mediaTemplateError('audio reference must be an HTTP(S) URL', 'audioReference', 'invalid_url');
    return { value };
  }
  const now = context.now ?? Date.now();
  const cached = context.cachedUpload;
  if (input.mode === 'upload' && cached?.id && (cached.expiresAt === undefined || cached.expiresAt > now)) {
    return { value: cached.id, uploadedId: cached.id, ...(cached.expiresAt === undefined ? {} : { expiresAt: cached.expiresAt }) };
  }
  const base64 = (): string => {
    let binary = '';
    for (let index = 0; index < source.bytes.length; index += 32768) binary += String.fromCharCode(...source.bytes.subarray(index, index + 32768));
    return btoa(binary);
  };
  if (input.mode === 'base64') return { value: base64() };
  const upload = input.upload;
  if (input.mode !== 'upload' || !upload) throw mediaTemplateError('audio reference upload request is required', 'audioReference', 'upload_required');
  // Multipart normally sends the bytes as a file, avoiding a second full copy in base64.
  const encoded = upload.format === 'json' || upload.body.includes('{{audio_base64}}') ? base64() : undefined;
  const body = renderMediaBody(upload.body, { audio_base64: encoded, audio_url: source.url, filename: source.filename, mime_type: source.mimeType }) as Record<string, unknown>;
  if (upload.format === 'json' && !upload.body.includes('{{audio_base64}}')) body[upload.fileField] = encoded;
  const response = await context.upload(upload, source, body);
  const value = readField(response, upload.idField);
  if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim() || String(value).length > 512 || /[\u0000-\u001f]/.test(String(value))) throw mediaTemplateError('audio upload response is missing its id or has an invalid id', 'audioReference', 'invalid_upload_id');
  const id = String(value).trim();
  return { value: id, uploadedId: id, ...(upload.expiresInSeconds === undefined ? {} : { expiresAt: now + upload.expiresInSeconds * 1000 }) };
}

/** "4-30" or "5, 10" → the lengths (1–120 s). */
export function parseMediaSeconds(text: string): number[] {
  return [...new Set(fields(text).flatMap(secondsItem).filter(value => Number.isInteger(value) && value >= 1 && value <= 120))].sort((left, right) => left - right);
}

/** The lengths as a person writes them: runs of three or more become ranges ("4-30"), the rest a list. */
export function formatMediaSeconds(seconds: readonly number[]): string {
  const sorted = [...new Set(seconds)].sort((left, right) => left - right);
  const parts: string[] = [];
  for (let index = 0; index < sorted.length;) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    if (end - index >= 2) parts.push(`${sorted[index]}-${sorted[end]}`);
    else for (let item = index; item <= end; item++) parts.push(String(sorted[item]));
    index = end + 1;
  }
  return parts.join(', ');
}
