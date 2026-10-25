'use strict';

// Skill plugins (技能插件), format v1 — docs/SKILL_PLUGIN_DEVELOPMENT.md is the specification.
//
// A plugin is data, never code: plugin.json plus a few PNG files. This module holds everything that reads that
// data: the manifest check, the small expression language of reflexes / events / stop conditions, perception on a
// window's raw pixels (bars, pixel checks, template search, change), the text the decision model reads, its
// questions and answers, and replay tests. It has no Node, Electron, network or file-system APIs.
// ZIP decoding belongs to each environment's app-plugin-zip adapter.
//
// The plugin marketplace checks uploads with the same rules: apps/cloudflare-platform/src/app-plugin-core.cjs is a
// byte-identical copy of this module, and a platform test fails when either file differs. Change both.
// Keep Node ZIP APIs out of both copies; Workers run without nodejs_compat.

const { RE2JS } = require('re2js');

// Compile and match with the same linear-time engine at install and runtime.
const patterns = new Map();
function pluginPattern(pattern) {
  let compiled = patterns.get(pattern);
  if (!compiled) {
    compiled = RE2JS.compile(pattern);
    if (patterns.size >= 256) patterns.delete(patterns.keys().next().value);
    patterns.set(pattern, compiled);
  }
  return compiled;
}

const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const KEY_NAMES = new Set([
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''), '`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/',
  'space', 'enter', 'return', 'tab', 'backspace', 'escape', 'esc', 'delete', 'home', 'end', 'pageup', 'pagedown',
  'left', 'right', 'up', 'down', ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
  'cmd', 'ctrl', 'alt', 'shift', 'primary'
]);
const MODIFIERS = new Set(['cmd', 'ctrl', 'alt', 'shift', 'primary']);
const LIMITS = Object.freeze({
  packageBytes: 100 * 1024 * 1024, fileBytes: 512 * 1024, templates: 32, examples: 16, tests: 32, files: 96,
  signals: 32, actions: 48, steps: 12, actionMs: 5000, reflexes: 16, decisions: 8, events: 16, choiceOptions: 32,
  levels: 10, params: 16, expression: 300, knowledge: 2000, stateTemplate: 2000
});
const ID = /^[a-z0-9_]{1,32}$/;
// The only files a plugin may contain: plugin.json, README.md, icon.png, PNG images and JSON replay tests.
const FILE = /^(?:plugin\.json|README\.md|icon\.png|(?:templates|examples)\/[a-z0-9][a-z0-9._-]{0,80}\.png|tests\/[a-z0-9][a-z0-9._-]{0,80}\.json)$/;
const allowedFile = name => typeof name === 'string' && FILE.test(name);

// ---------------------------------------------------------------------------------------------------------------
// Manifest

class ManifestErrors {
  constructor() { this.list = []; this.diagnostics = []; }
  add(path, message, diagnostic) {
    if (this.list.length >= 60) return;
    this.list.push(`${path}: ${message}`);
    this.diagnostics.push({ code: diagnostic?.code || 'plugin.invalid', path, params: diagnostic?.params || {} });
  }
}

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const fraction = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const rectOk = rect => Array.isArray(rect) && rect.length === 4 && rect.every(fraction) && rect[2] > 0 && rect[3] > 0
  && rect[0] + rect[2] <= 1.0001 && rect[1] + rect[3] <= 1.0001;
const colorOk = value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

/** { "zh-CN": "…", "en": "…" } (or one plain string): at least en or zh-CN, each at most `max` characters. */
function localizedText(value, max, path, errors) {
  if (typeof value === 'string') {
    if (!text(value, max)) errors.add(path, `must be 1–${max} characters`, { code: 'plugin.length', params: { min: 1, max } });
    return { en: value.trim() };
  }
  if (!isObject(value)) { errors.add(path, 'must be text or { "zh-CN": …, "en": … }', { code: 'plugin.expected', params: { expected: "string | {\"zh-CN\": \"…\", \"en\": \"…\"}" } }); return {}; }
  const result = {};
  for (const [locale, item] of Object.entries(value)) {
    if (!LOCALES.includes(locale)) { errors.add(`${path}.${locale}`, 'unknown language', { code: 'plugin.language', params: {} }); continue; }
    if (!text(item, max)) { errors.add(`${path}.${locale}`, `must be 1–${max} characters`, { code: 'plugin.length', params: { min: 1, max } }); continue; }
    result[locale] = item.trim();
  }
  if (!result.en && !result['zh-CN']) errors.add(path, 'needs at least "en" or "zh-CN"', { code: 'plugin.expected', params: { expected: "en | zh-CN" } });
  return result;
}

/** The text for a language, falling back to English, then Chinese, then any. */
function localize(value, locale) {
  if (typeof value === 'string') return value;
  if (!isObject(value)) return '';
  return value[locale] || (String(locale).startsWith('zh') && (value['zh-CN'] || value['zh-TW'])) || value.en || value['zh-CN'] || Object.values(value)[0] || '';
}

/** Model projection never chooses a UI translation. Plain strings are plugin-authored external content. */
function modelText(value) {
  return typeof value === 'string' ? value : isObject(value) && typeof value.en === 'string' ? value.en : '';
}

function modelSummary(manifest) {
  const summary = manifestSummary(manifest, 'en');
  return { ...summary, name: modelText(manifest.name) || manifest.id, description: modelText(manifest.description),
    goals: { default: manifest.goals.default, examples: manifest.goals.default ? [manifest.goals.default] : [] },
    params: (manifest.params || []).map(param => ({ id: param.id, type: param.type, label: modelText(param.label) || param.id, default: param.default })),
    actions: Object.values(manifest.actions).map(action => ({ id: action.id, label: modelText(action.label) || action.id })),
    events: manifest.events.map(event => ({ id: event.id, message: modelText(event.message) || `Plugin event: ${event.id}`, pause: event.pause, stop: event.stop })) };
}

const semver = value => typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?$/.test(value);

function compareVersions(a, b) {
  const parse = value => String(value).split('-')[0].split('.').map(Number);
  const [x, y] = [parse(a), parse(b)];
  for (let index = 0; index < 3; index++) if ((x[index] || 0) !== (y[index] || 0)) return (x[index] || 0) - (y[index] || 0);
  return String(a).includes('-') === String(b).includes('-') ? 0 : String(a).includes('-') ? -1 : 1;
}

/**
 * Checks plugin.json and returns it normalized (defaults filled in, expressions compiled), or the list of problems.
 * `files` is the set of file names in the package; images and tests must be among them.
 */
function validateManifest(raw, { files = new Set() } = {}) {
  const errors = new ManifestErrors();
  if (!isObject(raw)) return { ok: false, errors: ['plugin.json: must be a JSON object'], diagnostics: [{ code: 'plugin.expected', path: 'plugin.json', params: { expected: '{}' } }] };
  if (raw.schema !== 'nextmux.app-plugin/1') errors.add('schema', 'must be "nextmux.app-plugin/1"', { code: 'plugin.expected', params: { expected: "nextmux.app-plugin/1" } });
  if (typeof raw.id !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9-]+$/.test(raw.id) || raw.id.length > 100) errors.add('id', 'must be a lower-case reverse-domain name such as com.example.my-plugin', { code: 'plugin.expected', params: { expected: "com.example.my-plugin" } });
  if (!semver(raw.version)) errors.add('version', 'must be a version such as 1.0.0', { code: 'plugin.expected', params: { expected: "1.0.0" } });
  const manifest = { schema: 'nextmux.app-plugin/1', id: String(raw.id || ''), version: String(raw.version || '') };
  manifest.name = localizedText(raw.name, 60, 'name', errors);
  manifest.description = localizedText(raw.description, 400, 'description', errors);
  if (!isObject(raw.author) || !text(raw.author.name, 60)) errors.add('author.name', 'is required (1–60 characters)', { code: 'plugin.expected', params: { expected: "1 ≤ length ≤ 60" } });
  if (raw.author?.url !== undefined && !(typeof raw.author.url === 'string' && /^https:\/\/[^\s]{3,300}$/.test(raw.author.url))) errors.add('author.url', 'must be an https:// link', { code: 'plugin.expected', params: { expected: "https://…" } });
  manifest.author = { name: String(raw.author?.name || '').trim(), ...(raw.author?.url ? { url: raw.author.url } : {}) };
  if (raw.license !== undefined && !text(raw.license, 40)) errors.add('license', 'must be 1–40 characters', { code: 'plugin.length', params: { min: 1, max: 40 } });
  if (raw.homepage !== undefined && !(typeof raw.homepage === 'string' && /^https:\/\/[^\s]{3,300}$/.test(raw.homepage))) errors.add('homepage', 'must be an https:// link', { code: 'plugin.expected', params: { expected: "https://…" } });
  if (raw.risk !== undefined && !(Array.isArray(raw.risk) && raw.risk.every(item => item === 'account-ban'))) errors.add('risk', 'may only contain "account-ban"', { code: 'plugin.expected', params: { expected: "[\"account-ban\"]" } });
  if (raw.minNextMux !== undefined && !semver(raw.minNextMux)) errors.add('minNextMux', 'must be a version', { code: 'plugin.expected', params: { expected: "1.0.0" } });
  Object.assign(manifest, { license: raw.license || '', homepage: raw.homepage || '', risk: Array.isArray(raw.risk) ? [...new Set(raw.risk)] : [], minNextMux: raw.minNextMux || '' });

  // Which app windows the plugin can run on.
  manifest.apps = [];
  if (!Array.isArray(raw.apps) || raw.apps.length < 1 || raw.apps.length > 8) errors.add('apps', 'needs 1–8 entries', { code: 'plugin.count', params: { min: 1, max: 8 } });
  for (const [index, app] of (Array.isArray(raw.apps) ? raw.apps : []).slice(0, 8).entries()) {
    const path = `apps[${index}]`;
    if (!isObject(app) || !['macos', 'windows'].includes(app.platform)) { errors.add(`${path}.platform`, 'must be "macos" or "windows"', { code: 'plugin.expected', params: { expected: "macos | windows" } }); continue; }
    if (app.platform === 'macos' && !(typeof app.bundleId === 'string' && /^[A-Za-z0-9.-]{3,160}$/.test(app.bundleId))) errors.add(`${path}.bundleId`, 'is required on macOS', { code: 'plugin.expected', params: { expected: "bundleId (macOS)" } });
    // Matching metadata only: executable paths are never executed or used to launch an app.
    if (app.platform === 'windows' && !(text(app.program, 260) && /^[^*?"<>|\u0000-\u001f\u007f]+$/.test(app.program))) errors.add(`${path}.program`, 'is required on Windows (a program name or executable path, 1–260 characters)', { code: 'plugin.expected', params: { expected: 'program name | executable path; 1 ≤ length ≤ 260; no control characters' } });
    if (app.title !== undefined) {
      try { if (typeof app.title !== 'string' || app.title.length > 200) throw new Error(); pluginPattern(app.title); }
      catch { errors.add(`${path}.title`, 'must be an RE2-compatible regular expression (≤ 200 characters)', { code: 'plugin.expected', params: { expected: "RE2; length ≤ 200" } }); }
    }
    for (const field of ['titleIncludes', 'name']) if (app[field] !== undefined && !text(app[field], 200)) errors.add(`${path}.${field}`, 'must be 1–200 characters', { code: 'plugin.length', params: { min: 1, max: 200 } });
    manifest.apps.push({ platform: app.platform, ...(app.bundleId ? { bundleId: app.bundleId } : {}), ...(typeof app.program === 'string' ? { program: app.program.trim().replace(/\.exe$/i, '') } : {}), ...(app.title ? { title: app.title } : {}),
      ...(typeof app.titleIncludes === 'string' ? { titleIncludes: app.titleIncludes.trim() } : {}), ...(typeof app.name === 'string' ? { name: app.name.trim() } : {}) });
  }
  if (raw.display !== undefined) {
    if (!isObject(raw.display) || !integer(raw.display.width, 320, 7680) || !integer(raw.display.height, 240, 4320)) errors.add('display', 'needs width 320–7680 and height 240–4320', { code: 'plugin.expected', params: { expected: "320 ≤ width ≤ 7680; 240 ≤ height ≤ 4320" } });
    else if (raw.display.note !== undefined && !text(raw.display.note, 120)) errors.add('display.note', 'must be 1–120 characters', { code: 'plugin.length', params: { min: 1, max: 120 } });
    manifest.display = isObject(raw.display) ? { width: raw.display.width, height: raw.display.height, ...(raw.display.note ? { note: raw.display.note } : {}) } : undefined;
  }

  // User-configurable parameters (numbers, toggles, text, select options, local .txt/.md files).
  manifest.params = [];
  const paramTypes = new Map();
  if (raw.params !== undefined && !Array.isArray(raw.params) && !isObject(raw.params)) {
    errors.add('params', 'must be an array or object of parameter definitions', { code: 'plugin.expected', params: { expected: '[] | {}' } });
  }
  const rawParams = Array.isArray(raw.params)
    ? raw.params
    : isObject(raw.params)
      ? Object.entries(raw.params).map(([id, item]) => (isObject(item) ? { id, ...item } : { id }))
      : [];
  if (rawParams.length > LIMITS.params) errors.add('params', `up to ${LIMITS.params} parameters`, { code: 'plugin.maximum', params: { max: LIMITS.params } });
  for (const [index, param] of rawParams.slice(0, LIMITS.params).entries()) {
    const path = `params[${index}]`;
    if (!isObject(param) || !ID.test(param.id || '')) { errors.add(path, 'needs an id of a-z, 0-9 and _', { code: 'plugin.expected', params: { expected: '/^[a-z0-9_]{1,32}$/' } }); continue; }
    if (paramTypes.has(param.id)) { errors.add(path, `duplicate param id ${param.id}`, { code: 'plugin.duplicate', params: { value: param.id } }); continue; }
    const type = param.type || 'string';
    if (!['boolean', 'number', 'string', 'select', 'file', 'path', 'directory'].includes(type)) {
      errors.add(`${path}.type`, 'must be boolean, number, string, select, file, path or directory', { code: 'plugin.expected', params: { expected: 'boolean | number | string | select | file | path | directory' } });
      continue;
    }
    const label = param.label === undefined ? { en: param.id } : localizedText(param.label, 60, `${path}.label`, errors);
    const description = param.description === undefined ? undefined : localizedText(param.description, 200, `${path}.description`, errors);
    const entry = { id: param.id, type, label, ...(description ? { description } : {}) };
    if (type === 'boolean') {
      entry.default = Boolean(param.default);
    } else if (type === 'number') {
      const min = typeof param.min === 'number' && Number.isFinite(param.min) ? param.min : 0;
      const max = typeof param.max === 'number' && Number.isFinite(param.max) ? param.max : 86400;
      const step = typeof param.step === 'number' && param.step > 0 ? param.step : 1;
      const def = typeof param.default === 'number' && Number.isFinite(param.default) ? Math.min(max, Math.max(min, param.default)) : min;
      Object.assign(entry, { min, max, step, default: def });
    } else if (type === 'select') {
      const options = Array.isArray(param.options)
        ? param.options.slice(0, 16).map(opt => typeof opt === 'string'
          ? { value: opt, label: { en: opt } }
          : { value: String(opt?.value || ''), label: opt?.label ? localizedText(opt.label, 60, `${path}.options`, errors) : { en: String(opt?.value || '') } }).filter(opt => opt.value)
        : [];
      entry.options = options;
      entry.default = typeof param.default === 'string' ? param.default : (options[0]?.value || '');
    } else if (type === 'file') {
      const accept = Array.isArray(param.accept) ? param.accept.filter(ext => typeof ext === 'string' && /^\.[a-z0-9]{1,10}$/i.test(ext)).map(ext => ext.toLowerCase()) : ['.txt', '.md'];
      entry.accept = accept.length ? accept : ['.txt', '.md'];
      entry.default = '';
    } else if (type === 'path' || type === 'directory') {
      if (param.default === undefined || param.default === null || param.default === '') {
        entry.default = '';
      } else if (typeof param.default !== 'string') {
        errors.add(`${path}.default`, 'must be null, empty, or an absolute directory path', { code: 'plugin.expected', params: { expected: 'absolute directory path' } });
        entry.default = '';
      } else if (param.default.length > 4096) {
        errors.add(`${path}.default`, 'must be 1–4096 characters', { code: 'plugin.length', params: { min: 1, max: 4096 } });
        entry.default = '';
      } else {
        const normalizedDefault = normalizePathParam(param.default);
        if (!normalizedDefault) {
          errors.add(`${path}.default`, 'must be an absolute directory path without NUL', { code: 'plugin.expected', params: { expected: 'absolute directory path' } });
          entry.default = '';
        } else {
          entry.default = normalizedDefault;
        }
      }
    } else {
      entry.default = typeof param.default === 'string' ? param.default.slice(0, 500) : '';
    }
    paramTypes.set(param.id, type);
    manifest.params.push(entry);
  }

  // Input: allowed keys and click areas.
  const input = isObject(raw.input) ? raw.input : {};
  const modes = Array.isArray(input.modes) ? input.modes : ['foreground'];
  if (!modes.length || !modes.every(mode => ['background', 'foreground', 'vm'].includes(mode))) errors.add('input.modes', 'may contain background, foreground, vm', { code: 'plugin.expected', params: { expected: "background | foreground | vm" } });
  const keys = Array.isArray(input.keys) ? input.keys.map(key => String(key).toLowerCase()) : [];
  if (keys.length > 48 || keys.some(key => !KEY_NAMES.has(key))) errors.add('input.keys', `must be up to 48 of the listed key names (unknown: ${keys.filter(key => !KEY_NAMES.has(key)).slice(0, 5).join(', ') || 'none'})`, { code: 'plugin.keys', params: { max: 48, value: keys.filter(key => !KEY_NAMES.has(key)).slice(0, 5).join(', ') } });
  const pointer = [];
  for (const [index, region] of (Array.isArray(input.pointer) ? input.pointer : []).entries()) {
    if (index >= 16) { errors.add('input.pointer', 'up to 16 click areas', { code: 'plugin.expected', params: { expected: "input.pointer.length ≤ 16" } }); break; }
    if (!isObject(region) || !ID.test(region.id || '') || !rectOk(region.rect)) { errors.add(`input.pointer[${index}]`, 'needs an id and a rect [x, y, width, height] of fractions', { code: 'plugin.expected', params: { expected: "{id, rect: [x, y, width, height]}; 0 ≤ x,y,width,height ≤ 1" } }); continue; }
    pointer.push({ id: region.id, rect: region.rect });
  }
  if (input.maxActionsPerMinute !== undefined && !integer(input.maxActionsPerMinute, 1, 600)) errors.add('input.maxActionsPerMinute', 'must be 1–600', { code: 'plugin.range', params: { min: 1, max: 600 } });
  manifest.input = { modes: [...new Set(modes)], keys: [...new Set(keys)], pointer, maxActionsPerMinute: input.maxActionsPerMinute || 120 };

  // Perception.
  const perception = isObject(raw.perception) ? raw.perception : {};
  if (perception.tickMs !== undefined && !integer(perception.tickMs, 50, 5000)) errors.add('perception.tickMs', 'must be 50–5000', { code: 'plugin.range', params: { min: 50, max: 5000 } });
  if (raw.loop !== undefined && !isObject(raw.loop)) errors.add('loop', 'must be an object', { code: 'plugin.expected', params: { expected: '{}' } });
  if (raw.loop?.tickMs !== undefined && !Number.isFinite(raw.loop.tickMs)) errors.add('loop.tickMs', 'must be a finite number', { code: 'plugin.expected', params: { expected: 'finite number' } });
  // loop.tickMs is an alias; there remains one capture/reflex scheduler.
  const tickMs = raw.loop?.tickMs === undefined ? perception.tickMs ?? 250 : Math.max(50, Math.min(5000, Math.round(raw.loop.tickMs)));
  if (perception.vision !== undefined && !['none', 'optional', 'required'].includes(perception.vision)) errors.add('perception.vision', 'must be none, optional or required', { code: 'plugin.expected', params: { expected: "none | optional | required" } });
  if (perception.visionHints !== undefined && !text(perception.visionHints, 600)) errors.add('perception.visionHints', 'must be 1–600 characters', { code: 'plugin.length', params: { min: 1, max: 600 } });
  if (perception.visionEveryMs !== undefined && !integer(perception.visionEveryMs, 1000, 60000)) errors.add('perception.visionEveryMs', 'must be 1000–60000', { code: 'plugin.range', params: { min: 1000, max: 60000 } });
  const examples = Array.isArray(perception.examples) ? perception.examples : [];
  for (const file of examples) if (!files.has(file) || !/^examples\/[a-z0-9._-]+\.png$/.test(file)) errors.add('perception.examples', `missing or not a PNG in examples/: ${file}`, { code: 'plugin.missing_file', params: { file: String(file) } });
  const signals = [];
  const signalTypes = new Map();
  for (const [index, signal] of (Array.isArray(perception.signals) ? perception.signals : []).entries()) {
    const path = `perception.signals[${index}]`;
    if (index >= LIMITS.signals) { errors.add('perception.signals', `up to ${LIMITS.signals}`, { code: 'plugin.maximum', params: { max: LIMITS.signals } }); break; }
    if (!isObject(signal) || !ID.test(signal.id || '')) { errors.add(path, 'needs an id of a-z, 0-9 and _', { code: 'plugin.expected', params: { expected: "/^[a-z0-9_]{1,32}$/" } }); continue; }
    if (signalTypes.has(signal.id)) { errors.add(path, `duplicate id ${signal.id}`, { code: 'plugin.duplicate', params: { value: signal.id } }); continue; }
    const normalized = { id: signal.id, type: signal.type };
    switch (signal.type) {
      case 'bar':
        if (!rectOk(signal.rect) || !colorOk(signal.color)) errors.add(path, 'bar needs rect and color #rrggbb', { code: 'plugin.expected', params: { expected: "{rect: [x,y,width,height], color: \"#rrggbb\"}" } });
        if (signal.direction !== undefined && !['ltr', 'rtl', 'btt', 'ttb'].includes(signal.direction)) errors.add(`${path}.direction`, 'must be ltr, rtl, btt or ttb', { code: 'plugin.expected', params: { expected: "ltr | rtl | btt | ttb" } });
        Object.assign(normalized, { rect: signal.rect, color: signal.color, tolerance: integer(signal.tolerance, 0, 255) ? signal.tolerance : 48, direction: signal.direction || 'ltr' });
        break;
      case 'pixel':
        if (!Array.isArray(signal.points) || !signal.points.length || signal.points.length > 16
          || !signal.points.every(point => Array.isArray(point) && point.length === 3 && fraction(point[0]) && fraction(point[1]) && colorOk(point[2]))) errors.add(path, 'pixel needs 1–16 points [x, y, "#rrggbb"]', { code: 'plugin.expected', params: { expected: "points: [[x,y,\"#rrggbb\"]]; 1 ≤ length ≤ 16" } });
        Object.assign(normalized, { points: signal.points, tolerance: integer(signal.tolerance, 0, 255) ? signal.tolerance : 24 });
        break;
      case 'template':
        if (typeof signal.image !== 'string' || !/^templates\/[a-z0-9._-]+\.png$/.test(signal.image) || !files.has(signal.image)) errors.add(`${path}.image`, 'must name a PNG in templates/ that is in the package', { code: 'plugin.expected', params: { expected: "templates/*.png" } });
        if (!rectOk(signal.rect)) errors.add(`${path}.rect`, 'must be a rect of fractions', { code: 'plugin.expected', params: { expected: "[x,y,width,height]; 0 ≤ x,y,width,height ≤ 1; width,height > 0; x+width,y+height ≤ 1" } });
        if (signal.threshold !== undefined && !(typeof signal.threshold === 'number' && signal.threshold >= 0.5 && signal.threshold <= 0.99)) errors.add(`${path}.threshold`, 'must be 0.5–0.99', { code: 'plugin.range', params: { min: 0.5, max: 0.99 } });
        if (signal.max !== undefined && !integer(signal.max, 1, 20)) errors.add(`${path}.max`, 'must be 1–20', { code: 'plugin.range', params: { min: 1, max: 20 } });
        if (!raw.display) errors.add(path, 'template signals need "display" (the game window size the template was cut from)', { code: 'plugin.expected', params: { expected: "display: {width,height}" } });
        Object.assign(normalized, { image: signal.image, rect: signal.rect, threshold: signal.threshold ?? 0.82, max: signal.max ?? 5 });
        break;
      case 'change':
        if (!rectOk(signal.rect)) errors.add(path, 'change needs rect', { code: 'plugin.expected', params: { expected: "rect: [x,y,width,height]" } });
        Object.assign(normalized, { rect: signal.rect, threshold: typeof signal.threshold === 'number' && signal.threshold >= 0 && signal.threshold <= 1 ? signal.threshold : 0.02 });
        break;
      case 'text':
        if (!rectOk(signal.rect)) errors.add(path, 'text needs rect', { code: 'plugin.expected', params: { expected: "rect: [x,y,width,height]" } });
        if (signal.pattern !== undefined) { try { if (typeof signal.pattern !== 'string' || signal.pattern.length > 200) throw new Error(); pluginPattern(signal.pattern); } catch { errors.add(`${path}.pattern`, 'must be an RE2-compatible regular expression', { code: 'plugin.expected', params: { expected: "RE2" } }); } }
        if (signal.requireBox !== undefined && typeof signal.requireBox !== 'boolean') errors.add(`${path}.requireBox`, 'must be boolean', { code: 'plugin.expected', params: { expected: 'boolean' } });
        if (signal.match !== undefined && !text(signal.match, 100)) errors.add(`${path}.match`, 'must be 1–100 characters', { code: 'plugin.length', params: { min: 1, max: 100 } });
        if (signal.mode !== undefined && !['text', 'number', 'progress', 'remaining', 'elapsed', 'duration'].includes(signal.mode)) errors.add(`${path}.mode`, 'must be text, number, progress, remaining, elapsed or duration', { code: 'plugin.expected', params: { expected: 'text | number | progress | remaining | elapsed | duration' } });
        if (signal.languages !== undefined && !(Array.isArray(signal.languages) && signal.languages.length <= 4 && signal.languages.every(item => /^[A-Za-z-]{2,12}$/.test(item)))) errors.add(`${path}.languages`, 'up to 4 language codes', { code: 'plugin.expected', params: { expected: "languages.length ≤ 4; BCP 47" } });
        Object.assign(normalized, {
          rect: signal.rect,
          ...(signal.pattern ? { pattern: signal.pattern } : {}),
          ...(signal.match ? { match: signal.match.trim() } : {}),
          ...(signal.requireBox === true ? { requireBox: true } : {}),
          ...(signal.mode ? { mode: signal.mode } : {}),
          number: signal.number === true || signal.mode === 'number',
          languages: signal.languages || ['zh-Hans', 'en-US'],
          everyMs: integer(signal.everyMs, 250, 60000) ? signal.everyMs : 1000
        });
        break;
      default:
        errors.add(`${path}.type`, 'must be bar, pixel, template, change or text', { code: 'plugin.expected', params: { expected: "bar | pixel | template | change | text" } });
        continue;
    }
    signalTypes.set(signal.id, signal.type);
    signals.push(normalized);
  }
  manifest.perception = { tickMs, vision: perception.vision || 'none', visionHints: perception.visionHints || '', visionEveryMs: perception.visionEveryMs || 3000, examples, signals };
  manifest.loop = { tickMs };
  if (manifest.perception.vision !== 'none' && !signals.length && !manifest.perception.visionHints) {
    // Vision alone is allowed; it only needs hints about what to look for.
    errors.add('perception.visionHints', 'is required when a plugin reads the screen only with a vision model', { code: 'plugin.expected', params: { expected: "visionHints (perception.signals.length = 0)" } });
  }

  // Actions.
  manifest.actions = {};
  const actionEntries = isObject(raw.actions) ? Object.entries(raw.actions) : [];
  if (!actionEntries.length || actionEntries.length > LIMITS.actions) errors.add('actions', `needs 1–${LIMITS.actions} actions`, { code: 'plugin.count', params: { min: 1, max: LIMITS.actions } });
  const pointSignalIds = new Set(signals.filter(signal => signal.type === 'template' || (signal.type === 'text' && signal.match)).map(signal => signal.id));
  const inPointer = point => pointer.some(({ rect }) => point[0] >= rect[0] && point[0] <= rect[0] + rect[2] && point[1] >= rect[1] && point[1] <= rect[1] + rect[3]);
  const checkPoint = (point, path) => {
    if (typeof point === 'string' && /^signal:[a-z0-9_]{1,32}$/.test(point) && pointSignalIds.has(point.slice(7)) && pointer.length) return;
    if (Array.isArray(point) && point.length === 2 && point.every(fraction) && inPointer(point)) return;
    errors.add(path, 'needs [x,y] inside input.pointer or signal:<template/text id>', { code: 'plugin.expected', params: { expected: '[x,y] ∈ input.pointer.rect | signal:<template.id>' } });
  };
  for (const [id, action] of actionEntries.slice(0, LIMITS.actions)) {
    const path = `actions.${id}`;
    if (!ID.test(id)) { errors.add(path, 'action names use a-z, 0-9 and _', { code: 'plugin.expected', params: { expected: "/^[a-z0-9_]{1,32}$/" } }); continue; }
    if (!isObject(action)) { errors.add(path, 'must be an object', { code: 'plugin.expected', params: { expected: "{}" } }); continue; }
    const label = action.label === undefined ? { en: id } : localizedText(action.label, 40, `${path}.label`, errors);
    if (action.describe !== undefined && !text(action.describe, 200)) errors.add(`${path}.describe`, 'must be 1–200 characters', { code: 'plugin.length', params: { min: 1, max: 200 } });
    if (action.cooldownMs !== undefined && !integer(action.cooldownMs, 0, 600000)) errors.add(`${path}.cooldownMs`, 'must be 0–600000', { code: 'plugin.range', params: { min: 0, max: 600000 } });
    const steps = [];
    let duration = 0;
    const actionSteps = Array.isArray(action.steps) ? action.steps : action.type ? [action] : [];
    if (!actionSteps.length || actionSteps.length > LIMITS.steps) errors.add(`${path}.steps`, `needs 1–${LIMITS.steps} steps`, { code: 'plugin.count', params: { min: 1, max: LIMITS.steps } });
    for (const [index, rawStep] of actionSteps.slice(0, LIMITS.steps).entries()) {
      const stepPath = `${path}.steps[${index}]`;
      if (isObject(rawStep) && rawStep.chord !== undefined && rawStep.keys !== undefined) errors.add(stepPath, 'use chord or keys, not both', { code: 'plugin.expected', params: { expected: 'chord | keys' } });
      const step = isObject(rawStep) && rawStep.chord !== undefined ? { ...rawStep, keys: rawStep.chord } : rawStep;
      const kinds = ['key', 'keys', 'click', 'drag', 'wait', 'move', 'text', 'scroll'].filter(kind => isObject(step) && step[kind] !== undefined);
      if (kinds.length !== 1) { errors.add(stepPath, 'needs exactly one of key, keys, chord, click, drag, wait, move, text, scroll', { code: 'plugin.expected', params: { expected: "key | keys | chord | click | drag | wait | move | text | scroll; count = 1" } }); continue; }
      if (step.type !== undefined && !['key', 'chord', 'aim_and_cast', 'move', 'text', 'scroll'].includes(step.type)) errors.add(`${stepPath}.type`, 'unknown action type', { code: 'plugin.expected', params: { expected: 'key | chord | aim_and_cast | move | text | scroll' } });
      if (['key', 'chord', 'move', 'text', 'scroll'].includes(step.type) && kinds[0] !== (step.type === 'chord' ? 'keys' : step.type)) errors.add(stepPath, 'type must match its operation', { code: 'plugin.expected', params: { expected: step.type } });
      const aimed = step.area !== undefined || step.fromDecision !== undefined;
      if (step.type === 'aim_and_cast' && (!aimed || !['key', 'keys'].includes(kinds[0]))) errors.add(stepPath, 'aim_and_cast needs a key/chord and area/fromDecision', { code: 'plugin.expected', params: { expected: '{key | chord, area | fromDecision}' } });
      if (aimed && !['key', 'keys'].includes(kinds[0])) errors.add(stepPath, 'pointer targets are only supported by key/chord', { code: 'plugin.expected', params: { expected: 'key | chord' } });
      if (step.area !== undefined && !pointer.some(item => item.id === step.area)) errors.add(`${stepPath}.area`, 'must name an input.pointer area', { code: 'plugin.expected', params: { expected: 'input.pointer.id' } });
      if (step.fromDecision !== undefined && (typeof step.fromDecision !== 'string' || !ID.test(step.fromDecision))) errors.add(`${stepPath}.fromDecision`, 'must name a choice decision with targets', { code: 'plugin.expected', params: { expected: 'decisions.id' } });
      const target = { ...(step.area !== undefined ? { area: step.area } : {}), ...(step.fromDecision !== undefined ? { fromDecision: step.fromDecision } : {}) };
      const hold = step.holdMs;
      if (hold !== undefined && !integer(hold, 0, 3000)) errors.add(`${stepPath}.holdMs`, 'must be 0–3000', { code: 'plugin.range', params: { min: 0, max: 3000 } });
      const modifiers = Array.isArray(step.modifiers) ? step.modifiers.map(item => String(item).toLowerCase()) : [];
      if (step.modifiers !== undefined && (!Array.isArray(step.modifiers) || !['key', 'keys'].includes(kinds[0]) || modifiers.length > 3 || modifiers.some(item => !MODIFIERS.has(item) || !keys.includes(item)))) errors.add(`${stepPath}.modifiers`, 'must be cmd/ctrl/alt/shift/primary listed in input.keys for a key action', { code: 'plugin.expected', params: { expected: 'cmd | ctrl | alt | shift | primary; ∈ input.keys' } });
      switch (kinds[0]) {
        case 'key': {
          const key = String(step.key).toLowerCase();
          if (!keys.includes(key)) errors.add(stepPath, `key "${step.key}" is not in input.keys`, { code: 'plugin.key', params: { value: String(step.key) } });
          steps.push({ key, modifiers, ...target, ...(hold !== undefined ? { holdMs: hold } : {}) }); duration += hold ?? 0;
          break;
        }
        case 'keys': {
          const list = Array.isArray(step.keys) ? step.keys.map(item => String(item).toLowerCase()) : [];
          if (list.length < 2 || list.length > 4 || list.some(item => !keys.includes(item))) errors.add(stepPath, 'keys needs 2–4 names from input.keys', { code: 'plugin.expected', params: { expected: "2 ≤ keys.length ≤ 4; keys ⊆ input.keys" } });
          steps.push({ keys: list, ...(modifiers.length ? { modifiers } : {}), ...target, ...(hold !== undefined ? { holdMs: hold } : {}) }); duration += hold ?? 0;
          break;
        }
        case 'move':
          checkPoint(step.move, `${stepPath}.move`);
          steps.push({ move: step.move });
          break;
        case 'click': {
          const button = step.button === undefined ? 'left' : step.button;
          const count = step.count === undefined ? 1 : step.count;
          if (!['left', 'right', 'middle'].includes(button) || ![1, 2].includes(count)) errors.add(stepPath, 'button must be left/right/middle and count 1 or 2', { code: 'plugin.expected', params: { expected: "button: left | right | middle; count: 1 | 2" } });
          if (typeof step.click === 'string') {
            const match = /^signal:([a-z0-9_]{1,32})$/.exec(step.click);
            if (!match || !pointSignalIds.has(match[1])) errors.add(stepPath, 'click "signal:<id>" must name a template or matched text signal', { code: 'plugin.expected', params: { expected: "signal:<template.id>" } });
            else if (!pointer.length) errors.add(stepPath, 'clicks need input.pointer areas', { code: 'plugin.expected', params: { expected: "input.pointer.length ≥ 1" } });
            steps.push({ click: step.click, button, count });
          } else if (Array.isArray(step.click) && step.click.length === 2 && step.click.every(fraction)) {
            if (!inPointer(step.click)) errors.add(stepPath, 'the click point must lie inside an input.pointer area', { code: 'plugin.expected', params: { expected: "[x,y] ∈ input.pointer.rect" } });
            steps.push({ click: step.click, button, count });
          } else errors.add(stepPath, 'click must be [x, y] fractions or "signal:<template id>"', { code: 'plugin.expected', params: { expected: "[x,y], 0 ≤ x,y ≤ 1 | signal:<template.id>" } });
          duration += 60 * count;
          break;
        }
        case 'drag': {
          const points = step.drag;
          const ms = step.durationMs === undefined ? 300 : step.durationMs;
          if (!Array.isArray(points) || points.length !== 2 || !points.every(point => Array.isArray(point) && point.length === 2 && point.every(fraction)) || !points.every(inPointer)) errors.add(stepPath, 'drag needs [[x, y], [x, y]] inside input.pointer areas', { code: 'plugin.expected', params: { expected: "[[x,y],[x,y]] ∈ input.pointer.rect" } });
          if (!integer(ms, 50, 2000)) errors.add(`${stepPath}.durationMs`, 'must be 50–2000', { code: 'plugin.range', params: { min: 50, max: 2000 } });
          steps.push({ drag: points, durationMs: ms }); duration += ms;
          break;
        }
        case 'text': {
          if (!text(step.text, 500)) errors.add(`${stepPath}.text`, 'must be 1–500 characters (or {{line:<param_id>}} / {{param:<param_id>}})', { code: 'plugin.length', params: { min: 1, max: 500 } });
          const rawStepText = String(step.text || '');
          const checkedStepParams = new Set();
          for (const match of rawStepText.matchAll(/\{\{\s*(line|param):([a-z0-9_]{1,32})\s*\}\}/g)) {
            const [, refKind, refId] = match;
            const refKey = `${refKind}:${refId}`;
            if (checkedStepParams.has(refKey)) continue;
            checkedStepParams.add(refKey);
            if (!paramTypes.has(refId)) {
              errors.add(`${stepPath}.text`, `unknown param "${refId}"`, { code: 'plugin.placeholder', params: { value: refId } });
            } else if (refKind === 'line' && paramTypes.get(refId) !== 'file') {
              errors.add(`${stepPath}.text`, `param "${refId}" must be of type "file" for {{line:${refId}}}`, { code: 'plugin.expected', params: { expected: 'file' } });
            }
          }
          if (step.at !== undefined) checkPoint(step.at, `${stepPath}.at`);
          if (step.submitAt !== undefined) checkPoint(step.submitAt, `${stepPath}.submitAt`);
          steps.push({
            text: String(step.text || ''),
            ...(step.at !== undefined ? { at: step.at } : {}),
            ...(step.submit === true ? { submit: true } : {}),
            ...(step.submitAt !== undefined ? { submitAt: step.submitAt } : {}),
            ...(step.clear === true ? { clear: true } : {})
          });
          duration += 120;
          break;
        }
        case 'scroll': {
          checkPoint(step.scroll, `${stepPath}.scroll`);
          const direction = step.direction === undefined ? 'down' : step.direction;
          const amount = step.amount === undefined ? 3 : step.amount;
          if (!['down', 'up', 'left', 'right'].includes(direction)) errors.add(`${stepPath}.direction`, 'must be down, up, left or right', { code: 'plugin.expected', params: { expected: 'down | up | left | right' } });
          if (!integer(amount, 1, 20)) errors.add(`${stepPath}.amount`, 'must be 1–20', { code: 'plugin.range', params: { min: 1, max: 20 } });
          steps.push({ scroll: step.scroll, direction, amount });
          duration += 80;
          break;
        }
        case 'wait':
          if (!integer(step.wait, 0, 2000)) errors.add(stepPath, 'wait must be 0–2000 ms', { code: 'plugin.expected', params: { expected: "0 ≤ wait ≤ 2000 ms" } });
          steps.push({ wait: step.wait }); duration += Number(step.wait) || 0;
          break;
      }
    }
    if (duration > LIMITS.actionMs) errors.add(path, `takes ${duration} ms; an action may take at most ${LIMITS.actionMs} ms`, { code: 'plugin.duration', params: { actual: duration, max: LIMITS.actionMs } });
    manifest.actions[id] = { id, label, describe: action.describe || '', steps, cooldownMs: action.cooldownMs || 0 };
  }
  const actionIds = new Set(Object.keys(manifest.actions));
  const compile = (source, path) => {
    try { return compileExpression(source, { signals: signalTypes, actions: actionIds, params: paramTypes }); }
    catch (error) { errors.add(path, error.message, error.diagnostic); return undefined; }
  };

  // Reflexes, decisions, events, limits.
  manifest.reflexes = [];
  for (const [index, reflex] of (Array.isArray(raw.reflexes) ? raw.reflexes : []).entries()) {
    if (index >= LIMITS.reflexes) { errors.add('reflexes', `up to ${LIMITS.reflexes}`, { code: 'plugin.maximum', params: { max: LIMITS.reflexes } }); break; }
    const path = `reflexes[${index}]`;
    if (!isObject(reflex) || !actionIds.has(reflex.do)) { errors.add(path, 'needs "when" and "do" (an action name)', { code: 'plugin.expected', params: { expected: "{when, do: actions.id}" } }); continue; }
    if (reflex.priority !== undefined && !integer(reflex.priority, -100, 100)) errors.add(`${path}.priority`, 'must be -100–100', { code: 'plugin.range', params: { min: -100, max: 100 } });
    const when = compile(reflex.when, `${path}.when`);
    if (when) manifest.reflexes.push({ when: reflex.when, do: reflex.do, priority: reflex.priority || 0, compiled: when });
  }
  manifest.reflexes.sort((a, b) => b.priority - a.priority);
  manifest.decisions = [];
  const decisionIds = new Set();
  for (const [index, decision] of (Array.isArray(raw.decisions) ? raw.decisions : []).entries()) {
    if (index >= LIMITS.decisions) { errors.add('decisions', `up to ${LIMITS.decisions}`, { code: 'plugin.maximum', params: { max: LIMITS.decisions } }); break; }
    const path = `decisions[${index}]`;
    if (!isObject(decision) || !ID.test(decision.id || '') || decisionIds.has(decision.id)) { errors.add(path, 'needs a unique id', { code: 'plugin.unique', params: {} }); continue; }
    decisionIds.add(decision.id);
    if (!['choice', 'yesno', 'score'].includes(decision.type)) { errors.add(`${path}.type`, 'must be choice, yesno or score', { code: 'plugin.expected', params: { expected: "choice | yesno | score" } }); continue; }
    if (!text(decision.question, 500)) errors.add(`${path}.question`, 'must be 1–500 characters', { code: 'plugin.length', params: { min: 1, max: 500 } });
    if (decision.everyMs !== undefined && !integer(decision.everyMs, 200, 10000)) errors.add(`${path}.everyMs`, 'must be 200–10000', { code: 'plugin.range', params: { min: 200, max: 10000 } });
    const normalized = { id: decision.id, type: decision.type, question: String(decision.question || '').trim(), everyMs: decision.everyMs || (decision.type === 'choice' ? 500 : 3000) };
    if (decision.type === 'choice') {
      const options = Array.isArray(decision.options) ? decision.options : [];
      if (options.length < 2 || options.length > LIMITS.choiceOptions || options.some(option => !actionIds.has(option)) || new Set(options).size !== options.length) errors.add(`${path}.options`, `needs 2–${LIMITS.choiceOptions} different action names`, { code: 'plugin.unique_count', params: { min: 2, max: LIMITS.choiceOptions } });
      if (decision.fallback !== undefined && !actionIds.has(decision.fallback)) errors.add(`${path}.fallback`, 'must be an action name', { code: 'plugin.expected', params: { expected: "actions.id" } });
      if (decision.minConfidence !== undefined && !fraction(decision.minConfidence)) errors.add(`${path}.minConfidence`, 'must be 0–1', { code: 'plugin.range', params: { min: 0, max: 1 } });
      Object.assign(normalized, { options, fallback: decision.fallback || '', minConfidence: decision.minConfidence ?? 0.3 });
      if (decision.targets !== undefined) {
        if (!isObject(decision.targets)) errors.add(`${path}.targets`, 'must map choice action ids to points', { code: 'plugin.expected', params: { expected: '{actionId: [x,y] | signal:<template.id>}' } });
        else {
          normalized.targets = {};
          for (const [choice, point] of Object.entries(decision.targets)) {
            if (!options.includes(choice)) errors.add(`${path}.targets.${choice}`, 'must name an option', { code: 'plugin.expected', params: { expected: '∈ options' } });
            checkPoint(point, `${path}.targets.${choice}`);
            normalized.targets[choice] = point;
          }
        }
      }
    } else if (decision.type === 'yesno') {
      if (decision.report !== undefined && !fraction(decision.report)) errors.add(`${path}.report`, 'must be a probability 0–1', { code: 'plugin.expected', params: { expected: "0 ≤ probability ≤ 1" } });
      Object.assign(normalized, { ...(decision.report !== undefined ? { report: decision.report } : {}) });
    } else {
      const levels = Array.isArray(decision.levels) ? decision.levels : [];
      if (levels.length < 2 || levels.length > LIMITS.levels || levels.some(level => !ID.test(level)) || new Set(levels).size !== levels.length) errors.add(`${path}.levels`, `needs 2–${LIMITS.levels} different names (a-z, 0-9, _)`, { code: 'plugin.unique_count', params: { min: 2, max: LIMITS.levels } });
      if (decision.report !== undefined && !levels.includes(decision.report)) errors.add(`${path}.report`, 'must be one of the levels', { code: 'plugin.expected', params: { expected: "∈ levels" } });
      Object.assign(normalized, { levels, ...(decision.report !== undefined ? { report: decision.report } : {}) });
    }
    manifest.decisions.push(normalized);
  }
  for (const [id, action] of Object.entries(manifest.actions)) for (const [index, step] of action.steps.entries()) {
    if (step.fromDecision !== undefined && !manifest.decisions.some(decision => decision.id === step.fromDecision && decision.type === 'choice' && Object.keys(decision.targets || {}).length)) {
      errors.add(`actions.${id}.steps[${index}].fromDecision`, 'must name a choice decision with targets', { code: 'plugin.expected', params: { expected: 'choice decision with targets' } });
    }
  }
  if (!manifest.decisions.length && !manifest.reflexes.length) errors.add('decisions', 'a plugin needs at least one decision or reflex', { code: 'plugin.expected', params: { expected: "decisions.length + reflexes.length ≥ 1" } });
  const state = isObject(raw.state) ? raw.state : {};
  if (state.template !== undefined && !text(state.template, LIMITS.stateTemplate)) errors.add('state.template', `must be 1–${LIMITS.stateTemplate} characters`, { code: 'plugin.length', params: { min: 1, max: LIMITS.stateTemplate } });
  if (state.maxTokens !== undefined && !integer(state.maxTokens, 100, 8000)) errors.add('state.maxTokens', 'must be 100–8000', { code: 'plugin.range', params: { min: 100, max: 8000 } });
  if (typeof state.template === 'string') {
    for (const [, name, sep, field] of state.template.matchAll(/\{\{\s*([a-z0-9_]+)(?:([.:])([a-z0-9_]+))?%?\s*\}\}/g)) {
      if (name === 'history' && (!field || (sep === ':' && /^\d+$/.test(field)))) continue;
      if (name === 'param') {
        if (!field || !paramTypes.has(field)) errors.add('state.template', `unknown param placeholder {{param${sep || '.'}${field || ''}}}`, { code: 'plugin.placeholder', params: { value: `param${sep || '.'}${field || ''}` } });
        continue;
      }
      if (!['goal', 'knowledge', 'vision', 'history'].includes(name) && !signalTypes.has(name) && !paramTypes.has(name)) errors.add('state.template', `unknown placeholder {{${name}}}`, { code: 'plugin.placeholder', params: { value: name } });
      if (field && (sep !== '.' || !['found', 'count', 'x', 'y'].includes(field))) errors.add('state.template', `unknown field ${sep || '.'}${field}`, { code: 'plugin.field', params: { value: field } });
    }
  }
  manifest.state = { template: state.template || '', maxTokens: state.maxTokens || 1200 };
  manifest.knowledge = raw.knowledge === undefined ? {} : localizedText(raw.knowledge, LIMITS.knowledge, 'knowledge', errors);
  manifest.events = [];
  const eventIds = new Set();
  for (const [index, event] of (Array.isArray(raw.events) ? raw.events : []).entries()) {
    if (index >= LIMITS.events) { errors.add('events', `up to ${LIMITS.events}`, { code: 'plugin.maximum', params: { max: LIMITS.events } }); break; }
    const path = `events[${index}]`;
    if (!isObject(event) || !ID.test(event.id || '') || eventIds.has(event.id)) { errors.add(path, 'needs a unique id', { code: 'plugin.unique', params: {} }); continue; }
    eventIds.add(event.id);
    const message = localizedText(event.message, 200, `${path}.message`, errors);
    const when = compile(event.when, `${path}.when`);
    if (when) manifest.events.push({ id: event.id, when: event.when, message, pause: event.pause === true, stop: event.stop === true, compiled: when });
  }
  const goals = isObject(raw.goals) ? raw.goals : {};
  if (goals.default !== undefined && !text(goals.default, 200)) errors.add('goals.default', 'must be 1–200 characters', { code: 'plugin.length', params: { min: 1, max: 200 } });
  if (goals.examples !== undefined && !(Array.isArray(goals.examples) && goals.examples.length <= 8 && goals.examples.every(item => text(item, 100)))) errors.add('goals.examples', 'up to 8 examples of 1–100 characters', { code: 'plugin.expected', params: { expected: "examples.length ≤ 8; 1 ≤ length ≤ 100" } });
  manifest.goals = { default: goals.default || '', examples: Array.isArray(goals.examples) ? goals.examples : [] };
  const presets = raw.presets ?? (Array.isArray(raw.goals) ? raw.goals : []);
  manifest.presets = [];
  if (!Array.isArray(presets) || presets.length > 16) errors.add('presets', 'must be an array of up to 16 goals', { code: 'plugin.maximum', params: { max: 16 } });
  const presetIds = new Set();
  for (const [index, value] of (Array.isArray(presets) ? presets : []).slice(0, 16).entries()) {
    const preset = typeof value === 'string' ? { label: value.slice(0, 80), goal: value } : value;
    const path = `presets[${index}]`;
    if (!isObject(preset)) { errors.add(path, 'must be a string or goal object', { code: 'plugin.expected', params: { expected: 'string | {label, goal}' } }); continue; }
    const id = preset.id ?? `preset_${index + 1}`;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || presetIds.has(id)) errors.add(`${path}.id`, 'must be a unique id', { code: 'plugin.unique', params: {} });
    presetIds.add(id);
    if (!text(preset.label, 80)) errors.add(`${path}.label`, 'must be 1–80 characters', { code: 'plugin.length', params: { min: 1, max: 80 } });
    if (!text(preset.goal, 400)) errors.add(`${path}.goal`, 'must be 1–400 characters', { code: 'plugin.length', params: { min: 1, max: 400 } });
    if (preset.description !== undefined && !text(preset.description, 400)) errors.add(`${path}.description`, 'must be 1–400 characters', { code: 'plugin.length', params: { min: 1, max: 400 } });
    manifest.presets.push({ id, label: String(preset.label || '').trim(), goal: String(preset.goal || '').trim(), description: String(preset.description || '').trim() });
  }
  const limits = isObject(raw.limits) ? raw.limits : {};
  if (limits.maxRunMinutes !== undefined && !integer(limits.maxRunMinutes, 1, 1440)) errors.add('limits.maxRunMinutes', 'must be 1–1440', { code: 'plugin.range', params: { min: 1, max: 1440 } });
  manifest.limits = { maxRunMinutes: limits.maxRunMinutes || 120, ...(limits.stopWhen ? { stopWhen: limits.stopWhen } : {}) };
  if (limits.stopWhen !== undefined) manifest.limits.compiledStop = compile(limits.stopWhen, 'limits.stopWhen');
  // Replay tests named in the package.
  manifest.tests = [...files].filter(file => /^tests\/[a-z0-9._-]+\.json$/.test(file)).slice(0, LIMITS.tests);
  if (errors.list.length) return { ok: false, errors: errors.list, diagnostics: errors.diagnostics };
  return { ok: true, manifest };
}

/** The manifest as it can travel over IPC and JSON: compiled expressions dropped (they are rebuilt from the text). */
function publicManifest(manifest) {
  return JSON.parse(JSON.stringify(manifest, (key, value) => key === 'compiled' || key === 'compiledStop' ? undefined : value));
}

/** What an install confirmation shows: who made it, which app, which keys and clicks, which model it needs. */
function manifestSummary(manifest, locale = 'en') {
  return {
    id: manifest.id, version: manifest.version, name: localize(manifest.name, locale), description: localize(manifest.description, locale),
    author: manifest.author, license: manifest.license, homepage: manifest.homepage, risk: manifest.risk,
    apps: manifest.apps, keys: manifest.input.keys, pointer: manifest.input.pointer.length > 0, modes: manifest.input.modes,
    vision: manifest.perception.vision, goals: manifest.goals, presets: manifest.presets, maxRunMinutes: manifest.limits.maxRunMinutes,
    params: (manifest.params || []).map(param => ({
      id: param.id, type: param.type, label: localize(param.label, locale),
      ...(param.description ? { description: localize(param.description, locale) } : {}),
      default: param.default,
      ...(param.min !== undefined ? { min: param.min, max: param.max, step: param.step } : {}),
      ...(param.options ? { options: param.options.map(opt => ({ value: opt.value, label: localize(opt.label, locale) })) } : {}),
      ...(param.accept ? { accept: param.accept } : {})
    })),
    actions: Object.values(manifest.actions).map(action => ({ id: action.id, label: localize(action.label, locale) })),
    decisions: manifest.decisions.map(decision => ({ id: decision.id, type: decision.type, question: decision.question,
      ...(decision.type === 'choice' ? { optionCount: decision.options.length, minConfidence: decision.minConfidence } : {}) })),
    reflexes: manifest.reflexes.map(reflex => ({ when: reflex.when, do: reflex.do })),
    events: manifest.events.map(event => ({ id: event.id, message: localize(event.message, locale), pause: event.pause, stop: event.stop }))
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Expressions: numbers, booleans, signals (hp, slime.found), < <= > >= == !=, and / or / not, parentheses and
// held(condition, ms), since("action"), count("action", ms). Parsed here, never evaluated as code.

function diagnosticError(message, diagnostic) { return Object.assign(new Error(message), { diagnostic }); }

function tokenize(source) {
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?)|"([^"\\]{0,64})"|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+){0,2})|(<=|>=|==|!=|<|>|\(|\)|,|\+|-|\*|\/))/y;
  let index = 0;
  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) throw diagnosticError(`cannot read "${source.slice(index, index + 12)}"`, { code: 'plugin.expression_token', params: { value: source.slice(index, index + 12) } });
    index = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ kind: 'number', value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ kind: 'string', value: match[2] });
    else if (match[3] !== undefined) tokens.push({ kind: 'name', value: match[3] });
    else tokens.push({ kind: 'op', value: match[4] });
  }
  return tokens;
}

function compileExpression(source, { signals, actions, params = new Map() }) {
  if (typeof source !== 'string' || !source.trim()) throw diagnosticError('must be an expression such as hp < 0.3', { code: 'plugin.expected', params: { expected: 'hp < 0.3' } });
  if (source.length > LIMITS.expression) throw diagnosticError(`is longer than ${LIMITS.expression} characters`, { code: 'plugin.length', params: { min: 1, max: LIMITS.expression } });
  const tokens = tokenize(source);
  let position = 0;
  let nodes = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const expect = value => { const token = take(); if (!token || token.value !== value) throw diagnosticError(`expected "${value}"`, { code: 'plugin.expected', params: { expected: value } }); };
  const node = value => { if (++nodes > 64) throw diagnosticError('is too complex', { code: 'plugin.expression_complex', params: { max: 64 } }); return { ...value, key: `${source}#${nodes}` }; };
  const parseOr = () => {
    let left = parseAnd();
    while (peek()?.kind === 'name' && peek().value === 'or') { take(); left = node({ type: 'or', left, right: parseAnd() }); }
    return left;
  };
  const parseAnd = () => {
    let left = parseNot();
    while (peek()?.kind === 'name' && peek().value === 'and') { take(); left = node({ type: 'and', left, right: parseNot() }); }
    return left;
  };
  const parseNot = () => {
    if (peek()?.kind === 'name' && peek().value === 'not') { take(); return node({ type: 'not', value: parseNot() }); }
    return parseComparison();
  };
  const parseComparison = () => {
    const left = parseSum();
    const token = peek();
    if (token?.kind === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(token.value)) {
      take();
      return node({ type: 'compare', op: token.value, left, right: parseSum() });
    }
    return left;
  };
  // "coin.x < basket.x - 0.05": addition, subtraction, multiplication and division of readings and numbers.
  const parseSum = () => {
    let left = parseProduct();
    while (peek()?.kind === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = take().value;
      left = node({ type: 'sum', op, left, right: parseProduct() });
    }
    return left;
  };
  const parseProduct = () => {
    let left = parsePrimary();
    while (peek()?.kind === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = take().value;
      left = node({ type: 'product', op, left, right: parsePrimary() });
    }
    return left;
  };
  const actionArgument = () => {
    const token = take();
    if (token?.kind !== 'string' || !actions.has(token.value)) throw diagnosticError(`"${token?.value ?? ''}" is not an action name`, { code: 'plugin.expression_action', params: { value: token?.value ?? '' } });
    return token.value;
  };
  const numberArgument = (min, max) => {
    const token = take();
    if (token?.kind === 'name' && token.value.startsWith('param.')) {
      const parts = token.value.split('.');
      const paramId = parts[1], paramField = parts[2] || '';
      if (!params.has(paramId)) throw diagnosticError(`"${token.value}" is not a declared param`, { code: 'plugin.expression_param', params: { value: token.value } });
      if (parts.length > 3 || (paramField && paramField !== 'count')) throw diagnosticError(`"${token.value}": only .count is supported on params`, { code: 'plugin.expected', params: { expected: 'param.<id> | param.<id>.count' } });
      return node({ type: 'param', name: paramId, field: paramField });
    }
    if (token?.kind !== 'number' || token.value < min || token.value > max) throw diagnosticError(`expected a number ${min}–${max}`, { code: 'plugin.range', params: { min, max } });
    return token.value;
  };
  const parsePrimary = () => {
    const token = take();
    if (!token) throw diagnosticError('ends too early', { code: 'plugin.expression_early', params: {} });
    if (token.kind === 'number') return node({ type: 'value', value: token.value });
    if (token.kind === 'string') return node({ type: 'value', value: token.value });
    if (token.kind === 'op' && token.value === '(') { const inner = parseOr(); expect(')'); return inner; }
    if (token.kind !== 'name') throw diagnosticError(`unexpected "${token.value}"`, { code: 'plugin.expression_token', params: { value: token.value } });
    if (token.value === 'true' || token.value === 'false') return node({ type: 'value', value: token.value === 'true' });
    if (peek()?.value === '(' && ['held', 'since', 'count'].includes(token.value)) {
      take();
      let result;
      if (token.value === 'held') { const condition = parseOr(); expect(','); result = node({ type: 'held', condition, ms: numberArgument(0, 3_600_000) }); }
      else if (token.value === 'since') result = node({ type: 'since', action: actionArgument() });
      else { const action = actionArgument(); expect(','); result = node({ type: 'count', action, ms: numberArgument(1, 3_600_000) }); }
      expect(')');
      return result;
    }
    if (token.value.startsWith('param.')) {
      const parts = token.value.split('.');
      const paramId = parts[1], paramField = parts[2] || '';
      if (!params.has(paramId)) throw diagnosticError(`"${token.value}" is not a declared param`, { code: 'plugin.expression_param', params: { value: token.value } });
      if (parts.length > 3 || (paramField && paramField !== 'count')) throw diagnosticError(`"${token.value}": only .count is supported on params`, { code: 'plugin.expected', params: { expected: 'param.<id> | param.<id>.count' } });
      return node({ type: 'param', name: paramId, field: paramField });
    }
    const [name, field] = token.value.split('.');
    if (!signals.has(name)) throw diagnosticError(`"${name}" is not a signal`, { code: 'plugin.expression_signal', params: { value: name } });
    if (field && !(['template', 'text'].includes(signals.get(name)) && ['found', 'count', 'x', 'y'].includes(field))) throw diagnosticError(`"${token.value}": only template or matched text signals have .found .count .x .y`, { code: 'plugin.expected', params: { expected: 'template.found | template.count | template.x | template.y' } });
    return node({ type: 'signal', name, field: field || '' });
  };
  const tree = parseOr();
  if (position !== tokens.length) throw diagnosticError(`unexpected "${tokens[position].value}"`, { code: 'plugin.expression_token', params: { value: tokens[position].value } });
  return tree;
}

const numeric = value => typeof value === 'boolean' ? (value ? 1 : 0) : typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : NaN;
const truthy = value => typeof value === 'number' ? value !== 0 && !Number.isNaN(value) : Boolean(value);

/** The value of a signal as an expression sees it: a bare template signal means "found". */
function signalValue(signals, name, field) {
  const value = signals?.[name];
  if (value && typeof value === 'object') return field ? value[field] : value.found;
  return field ? undefined : value;
}

const isPathParamType = type => type === 'path' || type === 'directory';
function normalizePathParam(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) return null;
  if (value.startsWith('/')) {
    const parts = [];
    for (const part of value.split(/\/+/)) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return '/' + parts.join('/');
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    const sep = value.includes('\\') ? '\\' : '/';
    const parts = [];
    for (const part of value.slice(2).split(/[\\/]+/)) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return value.slice(0, 2) + sep + parts.join(sep);
  }
  const unc = /^\\\\([^\\/\0]+)\\([^\\/\0]+)(?:[\\/](.*))?$/.exec(value);
  if (unc) {
    const parts = [];
    for (const part of (unc[3] || '').split(/[\\/]+/)) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return `\\\\${unc[1]}\\${unc[2]}${parts.length ? `\\${parts.join('\\')}` : ''}`;
  }
  return null;
}

function paramValue(params, name, field) {
  const raw = params?.[name];
  if (field === 'count') {
    if (Array.isArray(raw)) return raw.length;
    if (raw && typeof raw === 'object' && typeof raw.count === 'number') return raw.count;
    if (typeof raw === 'string') return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).length;
    return 0;
  }
  if (raw && typeof raw === 'object' && 'value' in raw) return raw.value;
  if (raw && typeof raw === 'object' && typeof raw.path === 'string') return raw.path;
  return raw;
}

/**
 * Evaluates a compiled expression. `context`: { signals, params, now, held: Map (state for held()), since(action) → ms,
 * count(action, ms) → n }.
 */
function evaluate(tree, context) {
  switch (tree.type) {
    case 'value': return tree.value;
    case 'signal': return signalValue(context.signals, tree.name, tree.field);
    case 'param': return paramValue(context.params, tree.name, tree.field);
    case 'not': return !truthy(evaluate(tree.value, context));
    case 'and': return truthy(evaluate(tree.left, context)) && truthy(evaluate(tree.right, context));
    case 'or': return truthy(evaluate(tree.left, context)) || truthy(evaluate(tree.right, context));
    case 'sum': {
      const left = numeric(evaluate(tree.left, context)), right = numeric(evaluate(tree.right, context));
      return tree.op === '+' ? left + right : left - right;
    }
    case 'product': {
      const left = numeric(evaluate(tree.left, context)), right = numeric(evaluate(tree.right, context));
      return tree.op === '*' ? left * right : (right === 0 ? NaN : left / right);
    }
    case 'compare': {
      const rawLeft = evaluate(tree.left, context), rawRight = evaluate(tree.right, context);
      const left = numeric(rawLeft), right = numeric(rawRight);
      if (Number.isNaN(left) || Number.isNaN(right)) {
        if (tree.op === '==') return String(rawLeft ?? '') === String(rawRight ?? '');
        if (tree.op === '!=') return String(rawLeft ?? '') !== String(rawRight ?? '');
        return false;
      }
      switch (tree.op) {
        case '<': return left < right; case '<=': return left <= right; case '>': return left > right;
        case '>=': return left >= right; case '==': return left === right; default: return left !== right;
      }
    }
    case 'held': {
      const on = truthy(evaluate(tree.condition, context));
      const state = context.held;
      let ms = tree.ms;
      if (typeof tree.ms === 'object') {
        const rawVal = Math.max(0, numeric(evaluate(tree.ms, context)) || 0);
        ms = rawVal > 0 && rawVal < 1000 ? rawVal * 1000 : rawVal;
      }
      if (!on) { state?.delete(tree.key); return false; }
      if (!state?.has(tree.key)) state?.set(tree.key, context.now);
      return context.now - (state?.get(tree.key) ?? context.now) >= ms;
    }
    case 'since': return context.since(tree.action);
    case 'count': {
      let ms = tree.ms;
      if (typeof tree.ms === 'object') {
        const rawVal = Math.max(1, numeric(evaluate(tree.ms, context)) || 1000);
        ms = rawVal < 1000 ? rawVal * 1000 : rawVal;
      }
      return context.count(tree.action, ms);
    }
    default: return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Perception on a frame: { width, height, stride, data } with 32-bit BGRA pixels (the display helper's and
// Electron's bitmap layout).

const parseColor = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const pixelAt = (frame, x, y) => {
  const offset = Math.min(frame.height - 1, Math.max(0, y)) * frame.stride + Math.min(frame.width - 1, Math.max(0, x)) * 4;
  return [frame.data[offset + 2], frame.data[offset + 1], frame.data[offset]];
};
// Colour distance: the largest difference of the three channels (what "tolerance" means in the specification).
const near = (rgb, color, tolerance) => Math.abs(rgb[0] - color[0]) <= tolerance && Math.abs(rgb[1] - color[1]) <= tolerance && Math.abs(rgb[2] - color[2]) <= tolerance;
const toPixels = (frame, rect) => {
  const x = Math.floor(rect[0] * frame.width), y = Math.floor(rect[1] * frame.height);
  return { x, y, width: Math.max(1, Math.min(frame.width - x, Math.round(rect[2] * frame.width))), height: Math.max(1, Math.min(frame.height - y, Math.round(rect[3] * frame.height))) };
};

function readBar(frame, signal) {
  const color = parseColor(signal.color);
  const box = toPixels(frame, signal.rect);
  const horizontal = signal.direction === 'ltr' || signal.direction === 'rtl';
  const length = horizontal ? box.width : box.height;
  const across = horizontal ? box.height : box.width;
  // Three lines through the bar; the middle result ignores a line crossed by text or an icon.
  const fills = [0.25, 0.5, 0.75].map(position => {
    const offset = Math.min(across - 1, Math.floor(across * position));
    let matched = 0;
    for (let step = 0; step < length; step++) {
      const [x, y] = horizontal ? [box.x + step, box.y + offset] : [box.x + offset, box.y + step];
      if (near(pixelAt(frame, x, y), color, signal.tolerance)) matched++;
    }
    return length ? matched / length : 0;
  }).sort((a, b) => a - b);
  return Math.round(fills[1] * 1000) / 1000;
}

function readPixels(frame, signal) {
  return signal.points.every(([x, y, hex]) => near(pixelAt(frame, Math.round(x * (frame.width - 1)), Math.round(y * (frame.height - 1))), parseColor(hex), signal.tolerance));
}

/** Grey levels of a frame area, shrunk by `scale` (box average). */
function greyArea(frame, box, scale) {
  const width = Math.max(1, Math.floor(box.width / scale)), height = Math.max(1, Math.floor(box.height / scale));
  const grey = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      let sum = 0, samples = 0;
      for (let dy = 0; dy < scale; dy++) {
        const y = box.y + row * scale + dy;
        if (y >= frame.height) break;
        let offset = y * frame.stride + (box.x + column * scale) * 4;
        for (let dx = 0; dx < scale; dx++, offset += 4) {
          if (box.x + column * scale + dx >= frame.width) break;
          sum += (frame.data[offset + 2] * 77 + frame.data[offset + 1] * 150 + frame.data[offset] * 29) >> 8;
          samples++;
        }
      }
      grey[row * width + column] = samples ? Math.round(sum / samples) : 0;
    }
  }
  return { width, height, grey };
}

/** A template image (BGRA, as cut from the game at display size) resized to the frame's scale, then shrunk. */
function prepareTemplate(template, frame, display, scale, baseFactor = frame.width / display.width) {
  const factor = baseFactor / scale;
  const width = Math.max(4, Math.round(template.width * factor)), height = Math.max(4, Math.round(template.height * factor));
  const grey = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const x0 = Math.floor(column / factor), y0 = Math.floor(row / factor);
      const x1 = Math.max(x0 + 1, Math.floor((column + 1) / factor)), y1 = Math.max(y0 + 1, Math.floor((row + 1) / factor));
      let sum = 0, samples = 0, opaque = 0;
      for (let y = y0; y < Math.min(y1, template.height); y++) {
        for (let x = x0; x < Math.min(x1, template.width); x++) {
          const offset = y * template.stride + x * 4;
          sum += (template.data[offset + 2] * 77 + template.data[offset + 1] * 150 + template.data[offset] * 29) >> 8;
          if (template.data[offset + 3] >= 128) opaque++;
          samples++;
        }
      }
      grey[row * width + column] = samples ? Math.round(sum / samples) : 0;
      mask[row * width + column] = samples && opaque * 2 >= samples ? 1 : 0;
    }
  }
  return { width, height, grey, mask, count: mask.reduce((total, value) => total + value, 0) };
}

/**
 * Finds a template in an area: similarity = 1 − mean grey difference over the template's opaque pixels, computed on
 * a shrunk copy (templates of about 12+ pixels) with an early stop once a position cannot reach the threshold.
 * Also supports multi-scale matching when window size or aspect ratio differs from `display` while UI icons stay fixed-pixel.
 */
/** Pixel comparisons one frame may spend on all its template signals together (runs on the main process). */
const TEMPLATE_WORK_PER_FRAME = 24_000_000;

function findTemplateAtFactor(frame, box, signal, template, display, baseFactor, maxWork, hayCache) {
  const shortSide = Math.min(template.width, template.height) * baseFactor;
  let scale = Math.max(1, Math.min(4, Math.floor(shortSide / 12)));
  let needle = prepareTemplate(template, frame, display, scale, baseFactor);
  let hay = hayCache.get(scale) || (hayCache.set(scale, greyArea(frame, box, scale)), hayCache.get(scale));
  const work = () => Math.max(0, hay.width - needle.width + 1) * Math.max(0, hay.height - needle.height + 1) * needle.count;
  while (work() > maxWork && scale < 32 && needle.width > 4 && needle.height > 4) {
    scale *= 2;
    needle = prepareTemplate(template, frame, display, scale, baseFactor);
    hay = hayCache.get(scale) || (hayCache.set(scale, greyArea(frame, box, scale)), hayCache.get(scale));
  }
  if (!needle.count || needle.width > hay.width || needle.height > hay.height || work() > maxWork) return [];
  const budget = (1 - signal.threshold) * 255 * needle.count;
  let scores = [];
  for (let y = 0; y <= hay.height - needle.height; y++) {
    for (let x = 0; x <= hay.width - needle.width; x++) {
      let sum = 0;
      for (let row = 0; row < needle.height && sum <= budget; row++) {
        const hayRow = (y + row) * hay.width + x, needleRow = row * needle.width;
        for (let column = 0; column < needle.width; column++) {
          if (needle.mask[needleRow + column]) sum += Math.abs(hay.grey[hayRow + column] - needle.grey[needleRow + column]);
        }
      }
      if (sum <= budget) scores.push({ x, y, score: 1 - sum / (255 * needle.count), scale, width: needle.width, height: needle.height });
      if (scores.length > 8_192) { scores.sort((a, b) => b.score - a.score); scores = scores.slice(0, 2_048); }
    }
  }
  return scores;
}

function findTemplate(frame, signal, template, display, maxWork = TEMPLATE_WORK_PER_FRAME) {
  const box = toPixels(frame, signal.rect);
  const hayCache = new Map();
  const wRatio = frame.width / display.width;
  const hRatio = frame.height / display.height;
  const factors = [wRatio];
  for (const candidate of [1.0, hRatio, (wRatio + 1.0) / 2]) {
    if (candidate > 0.25 && candidate < 4.0 && factors.every(existing => Math.abs(existing - candidate) / existing > 0.08)) {
      factors.push(candidate);
    }
  }
  let allScores = findTemplateAtFactor(frame, box, signal, template, display, factors[0], maxWork, hayCache);
  const topScore = allScores.reduce((best, item) => Math.max(best, item.score), 0);
  if (factors.length > 1 && topScore < Math.max(0.9, signal.threshold + 0.06)) {
    const subBudget = Math.max(1_000_000, Math.floor(maxWork / factors.length));
    for (const factor of factors.slice(1)) {
      const more = findTemplateAtFactor(frame, box, signal, template, display, factor, subBudget, hayCache);
      if (more.length) allScores = allScores.concat(more);
    }
  }
  const result = { found: false, count: 0, x: -1, y: -1, items: [] };
  if (!allScores.length) return result;
  allScores.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const candidate of allScores) {
    if (kept.length >= signal.max) break;
    const cx = box.x + (candidate.x + candidate.width / 2) * candidate.scale;
    const cy = box.y + (candidate.y + candidate.height / 2) * candidate.scale;
    const minDistX = candidate.width * candidate.scale * 0.6;
    const minDistY = candidate.height * candidate.scale * 0.6;
    if (kept.some(item => Math.abs(item.cx - cx) < minDistX && Math.abs(item.cy - cy) < minDistY)) continue;
    kept.push({ ...candidate, cx, cy });
  }
  result.items = kept.map(item => ({
    x: Math.round((item.cx / frame.width) * 1000) / 1000,
    y: Math.round((item.cy / frame.height) * 1000) / 1000,
    score: Math.round(item.score * 1000) / 1000
  }));
  result.count = result.items.length;
  result.found = result.count > 0;
  if (result.found) { result.x = result.items[0].x; result.y = result.items[0].y; }
  return result;
}

/** How much an area changed since the last frame, 0–1 (a 48×48 grey grid). */
function readChange(frame, signal, previous) {
  const box = toPixels(frame, signal.rect);
  const grid = new Uint8Array(48 * 48);
  for (let row = 0; row < 48; row++) for (let column = 0; column < 48; column++) {
    const [r, g, b] = pixelAt(frame, box.x + Math.floor(column * box.width / 48), box.y + Math.floor(row * box.height / 48));
    grid[row * 48 + column] = (r * 77 + g * 150 + b * 29) >> 8;
  }
  let difference = 0;
  if (previous && previous.length === grid.length) for (let index = 0; index < grid.length; index++) difference += Math.abs(grid[index] - previous[index]);
  return { value: previous ? Math.round(difference / (grid.length * 255) * 1000) / 1000 : 1, grid };
}

function parseClockSeconds(part) {
  const pieces = String(part || '').trim().split(':').map(Number);
  if (pieces.some(n => !Number.isFinite(n) || n < 0)) return null;
  if (pieces.length === 2) return pieces[0] * 60 + pieces[1];
  if (pieces.length === 3) return pieces[0] * 3600 + pieces[1] * 60 + pieces[2];
  return null;
}

function parseMediaTimestamp(raw) {
  const cleaned = String(raw || '')
    .replace(/：/g, ':')
    .replace(/\s*:\s*/g, ':')
    .replace(/:(\d)\s+(\d)\b/g, ':$1$2')
    .replace(/\b(\d)\s+(\d):/g, '$1$2:');
  const match = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:\/|\||I|l|\s)\s*(\d{1,2}:\d{2}(?::\d{2})?)/.exec(cleaned);
  if (!match) return null;
  const current = parseClockSeconds(match[1]);
  const total = parseClockSeconds(match[2]);
  if (current === null || total === null || total <= 0 || current > total + 2) return null;
  const clamped = Math.min(current, total);
  return {
    current: clamped,
    total,
    remaining: Math.max(0, total - clamped),
    progress: Math.round((clamped / total) * 1000) / 1000
  };
}

/** A text signal's value from the recognized text: the pattern's first group, as a number, media timestamp, or located match. */
function readText(signal, raw, boxes) {
  const fullText = String(raw || '').trim();
  if (signal.match) {
    const compact = value => String(value || '').toLowerCase().replace(/\s+/g, '');
    const needles = String(signal.match).split('|').map(compact).filter(Boolean);
    const matchesNeedle = value => {
      const c = compact(value);
      return Boolean(c) && needles.some(needle => c.includes(needle));
    };
    const hits = [];
    const located = item => fraction(item?.x) && fraction(item?.y) && (!signal.requireBox || !signal.rect
      || item.x >= signal.rect[0] && item.x <= signal.rect[0] + signal.rect[2] && item.y >= signal.rect[1] && item.y <= signal.rect[1] + signal.rect[3]);
    if (Array.isArray(boxes)) {
      for (const item of boxes) {
        const itemText = String(item?.text || '').trim();
        if (!itemText || !matchesNeedle(itemText)) continue;
        if (signal.pattern && !pluginPattern(signal.pattern).exec(itemText)) continue;
        if (located(item)) {
          hits.push({
            x: Math.round(item.x * 1000) / 1000,
            y: Math.round(item.y * 1000) / 1000,
            text: itemText.slice(0, 120),
            len: compact(itemText).length
          });
        }
      }
      // Also support Windows Media.Ocr word-level boxes where CJK characters are emitted as individual adjacent words.
      for (let i = 0; i < boxes.length; i++) {
        const first = boxes[i];
        if (!located(first)) continue;
        const firstCompact = compact(first.text);
        if (!firstCompact || firstCompact.length > 4) continue;
        let combined = firstCompact;
        let sumX = first.x, sumY = first.y, count = 1;
        for (let j = i + 1; j < Math.min(boxes.length, i + 12); j++) {
          const next = boxes[j];
          if (!located(next)) break;
          if (Math.abs(next.y - first.y) > 0.035) break;
          const nextCompact = compact(next.text);
          if (!nextCompact || nextCompact.length > 4) break;
          combined += nextCompact;
          sumX += next.x;
          sumY += next.y;
          count++;
          if (needles.some(needle => combined === needle) && (!signal.pattern || pluginPattern(signal.pattern).exec(combined))) {
            hits.push({
              x: Math.round((sumX / count) * 1000) / 1000,
              y: Math.round((sumY / count) * 1000) / 1000,
              text: combined.slice(0, 120),
              len: combined.length
            });
            break;
          }
        }
      }
      hits.sort((a, b) => a.len - b.len);
    }
    if (!signal.requireBox && !hits.length && matchesNeedle(fullText) && (!signal.pattern || pluginPattern(signal.pattern).exec(fullText))) {
      const rect = Array.isArray(signal.rect) && signal.rect.length === 4 ? signal.rect : [0, 0, 1, 1];
      hits.push({
        x: Math.round((rect[0] + rect[2] / 2) * 1000) / 1000,
        y: Math.round((rect[1] + rect[3] / 2) * 1000) / 1000,
        text: fullText.slice(0, 120)
      });
    }
    const cleanHits = hits.map(({ x, y, text: t }) => ({ x, y, text: t }));
    return {
      found: cleanHits.length > 0,
      count: cleanHits.length,
      x: cleanHits[0]?.x ?? -1,
      y: cleanHits[0]?.y ?? -1,
      text: cleanHits[0]?.text ?? '',
      items: cleanHits.slice(0, 10)
    };
  }
  if (signal.mode === 'progress' || signal.mode === 'remaining' || signal.mode === 'elapsed' || signal.mode === 'duration') {
    const media = parseMediaTimestamp(fullText);
    if (!media) return null;
    return signal.mode === 'progress' ? media.progress : signal.mode === 'remaining' ? media.remaining : signal.mode === 'elapsed' ? media.current : media.total;
  }
  let value = fullText;
  if (signal.pattern) {
    const match = pluginPattern(signal.pattern).exec(value);
    value = match ? (match[1] ?? match[0]) : '';
  }
  if (signal.number) { const number = Number(value.replace(/[,\s]/g, '')); return Number.isFinite(number) && value !== '' ? number : null; }
  return value.slice(0, 200);
}

/**
 * Reads every non-text signal of a frame. `memory` keeps what needs the previous frame (change grids);
 * `templates` maps image names to decoded BGRA images. Text signals are filled in by the caller (OCR is async).
 */
function perceive(frame, manifest, templates, memory = {}) {
  const signals = {};
  const templateSignals = manifest.perception.signals.filter(signal => signal.type === 'template').length;
  const perTemplateWork = Math.floor(TEMPLATE_WORK_PER_FRAME / Math.max(1, templateSignals));
  for (const signal of manifest.perception.signals) {
    try {
      if (signal.type === 'bar') signals[signal.id] = readBar(frame, signal);
      else if (signal.type === 'pixel') signals[signal.id] = readPixels(frame, signal);
      else if (signal.type === 'template') {
        const image = templates.get(signal.image);
        signals[signal.id] = image && manifest.display ? findTemplate(frame, signal, image, manifest.display, perTemplateWork) : { found: false, count: 0, x: -1, y: -1, items: [] };
      } else if (signal.type === 'change') {
        const change = readChange(frame, signal, memory[signal.id]);
        memory[signal.id] = change.grid;
        signals[signal.id] = change.value;
      }
    } catch { signals[signal.id] = null; }
  }
  return signals;
}

// ---------------------------------------------------------------------------------------------------------------
// What the decision model reads, its questions and its answers.

const round = value => Math.round(value * 100) / 100;
function formatSignal(value, percent) {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return percent ? `${Math.round(value * 100)}%` : String(round(value));
  if (typeof value === 'object') return value.found ? `${value.count} found (nearest at x ${round(value.x)}, y ${round(value.y)})` : 'none';
  return `"${String(value).slice(0, 120)}"`;
}

/** Rough token count: CJK characters count one each, other text one per four characters. */
function estimateTokens(value) {
  const cjk = (String(value).match(/[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/g) || []).length;
  return cjk + Math.ceil((String(value).length - cjk) / 4);
}

function renderHistory(history, count) {
  const now = Date.now();
  return history.slice(-count).reverse().map(item => `${item.action} (${((now - item.at) / 1000).toFixed(1)} s ago${item.by === 'reflex' ? ', reflex' : ''})`).join(', ') || 'none yet';
}

/** The state text (spec 3.10): the plugin's template or the default layout, cut to state.maxTokens. */
function renderState(manifest, { goal = '', signals = {}, params = {}, history = [], vision = '', locale = 'en' }) {
  let knowledge = modelText(manifest.knowledge);
  const paramDefs = new Map((manifest.params || []).map(param => [param.id, param]));
  const signalLines = manifest.perception.signals.map(signal => `${signal.id} ${formatSignal(signals[signal.id], signal.type === 'bar')}`).join(', ');
  const paramLines = (manifest.params || []).map(param => {
    if (param.type === 'file') return `${param.id}=${paramValue(params, param.id, 'count')} lines`;
    if (isPathParamType(param.type)) {
      const raw = param.id in params ? paramValue(params, param.id, '') : param.default;
      return `${param.id}=${typeof raw === 'string' ? raw : ''}`;
    }
    const val = paramValue(params, param.id, '');
    return `${param.id}=${formatSignal(val, false)}`;
  }).join(', ');
  const fill = template => template.replace(/\{\{\s*([a-z0-9_]+)(?:\.([a-z0-9_]+))?(%)?(?::([a-z0-9_]+)(%)?)?\s*\}\}/g, (all, name, field, percent, count, countPercent) => {
    const pct = Boolean(percent || countPercent);
    if (name === 'goal') return goal || manifest.goals.default || '';
    if (name === 'knowledge') return knowledge;
    if (name === 'vision') return vision || 'not available';
    if (name === 'history') return renderHistory(history, Math.min(20, Number(count) || 5));
    if (name === 'param' && (field || count)) {
      const id = field || count;
      const def = paramDefs.get(id);
      const val = id in params ? paramValue(params, id, '') : def?.default;
      return isPathParamType(def?.type) ? (typeof val === 'string' ? val : '') : formatSignal(val, pct);
    }
    if ((name in params || paramDefs.has(name)) && !(name in signals)) {
      const def = paramDefs.get(name);
      const val = field || name in params ? paramValue(params, name, field || '') : def?.default;
      return !field && isPathParamType(def?.type) ? (typeof val === 'string' ? val : '') : formatSignal(val, pct);
    }
    const value = signals[name];
    if (field) return formatSignal(value && typeof value === 'object' ? value[field] : undefined, false);
    return formatSignal(value, pct);
  });
  const build = () => manifest.state.template ? fill(manifest.state.template.replace(/\{\{\s*history\s*\}\}/g, '{{history:5}}'))
    : [`Goal (from the user, via the assistant): ${goal || manifest.goals.default || 'not given'}`,
      ...(knowledge ? [`Game notes (from the plugin): ${knowledge}`] : []),
      ...(paramLines ? [`Parameters: ${paramLines}`] : []),
      `Screen now: ${signalLines || 'no readings'}`,
      ...(vision ? [`Screen description: ${vision}`] : []),
      `Last actions: ${renderHistory(history, 5)}`].join('\n');
  let state = build();
  // Too long: the plugin's notes shrink first, then the end is cut.
  while (estimateTokens(state) > manifest.state.maxTokens && knowledge.length > 40) { knowledge = knowledge.slice(0, Math.floor(knowledge.length * 0.7)); state = build(); }
  while (estimateTokens(state) > manifest.state.maxTokens && state.length > 80) state = state.slice(0, Math.floor(state.length * 0.9));
  return state;
}

/**
 * The questions for the decisions due now, in the named-question form OpenRouter's Decisions API and the TypeSafe
 * System One API (OpenJev and others) take. Choices list the actions with their labels; scores are asked as a
 * choice among the ordered levels.
 */
function buildQuestions(manifest, decisions, locale = 'en') {
  const questions = {};
  for (const decision of decisions) {
    if (decision.type === 'choice') {
      questions[decision.id] = { type: 'choice', instructions: decision.question,
        criteria: Object.fromEntries(decision.options.map(id => {
          const action = manifest.actions[id];
          const label = modelText(action.label) || id;
          return [id, `${label}${action.describe ? ` — ${action.describe}` : ''}`.slice(0, 240)];
        })) };
    } else if (decision.type === 'yesno') {
      questions[decision.id] = { type: 'noul', instructions: decision.question };
    } else {
      questions[decision.id] = { type: 'choice', instructions: `${decision.question} Levels from lowest to highest: ${decision.levels.join(' < ')}.`,
        criteria: Object.fromEntries(decision.levels.map(level => [level, level])) };
    }
  }
  return questions;
}

/** The answers, whatever the wrapping ({ answers: { id: … } }, { decisions: … }, or the questions at the top). */
function readAnswers(payload, decisions) {
  const root = isObject(payload) ? payload : {};
  const pool = [root.answers, root.decisions, root.results, root.data, root].filter(isObject);
  const answers = {};
  for (const decision of decisions) {
    const node = pool.map(item => item[decision.id]).find(isObject);
    if (!node) continue;
    const probabilities = isObject(node.probabilities) ? Object.fromEntries(Object.entries(node.probabilities).filter(([, value]) => typeof value === 'number')) : {};
    if (decision.type === 'yesno') {
      const yes = typeof node.noul === 'number' ? node.noul : typeof node.probability === 'number' ? node.probability
        : typeof probabilities.yes === 'number' ? probabilities.yes : typeof node.answer === 'boolean' ? (node.answer ? 1 : 0) : undefined;
      if (yes !== undefined) answers[decision.id] = { type: 'yesno', yes: Math.max(0, Math.min(1, yes)) };
      continue;
    }
    const allowed = decision.type === 'choice' ? decision.options : decision.levels;
    const choice = typeof node.choice === 'string' && allowed.includes(node.choice) ? node.choice
      : Object.entries(probabilities).filter(([key]) => allowed.includes(key)).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!choice) continue;
    const confidence = typeof node.confidence === 'number' ? node.confidence : typeof probabilities[choice] === 'number' ? probabilities[choice] : 0;
    answers[decision.id] = { type: decision.type, choice, confidence: Math.max(0, Math.min(1, confidence)), probabilities };
  }
  return answers;
}

// ---------------------------------------------------------------------------------------------------------------
// Replay tests (tests/*.json): a saved frame, the expected readings and the reflex that should fire.

function checkReplay(manifest, test, signals, context = {}) {
  const failures = [];
  const diagnostics = [];
  const expect = isObject(test?.expect) ? test.expect : {};
  for (const [key, wanted] of Object.entries(isObject(expect.signals) ? expect.signals : {})) {
    const [name, field] = key.split('.');
    const value = signalValue(signals, name, field || (typeof signals[name] === 'object' && signals[name] !== null && typeof wanted === 'boolean' ? 'found' : ''));
    const actual = typeof value === 'object' && value !== null ? value.found : value;
    const ok = Array.isArray(wanted) && wanted.length === 2 ? typeof actual === 'number' && actual >= wanted[0] && actual <= wanted[1] : actual === wanted;
    if (!ok) { failures.push(`${key}: expected ${JSON.stringify(wanted)}, read ${JSON.stringify(actual)}`); diagnostics.push({ code: 'plugin.replay', path: key, params: { expected: JSON.stringify(wanted), actual: JSON.stringify(actual) ?? 'undefined' } }); }
  }
  if (expect.reflex !== undefined) {
    const now = Date.now();
    const fired = manifest.reflexes.find(reflex => truthy(evaluate(reflex.compiled, { signals, now, held: new Map(), since: () => Infinity, count: () => 0, ...context })))?.do || null;
    if (fired !== expect.reflex) { failures.push(`reflex: expected ${JSON.stringify(expect.reflex)}, got ${JSON.stringify(fired)}`); diagnostics.push({ code: 'plugin.replay', path: 'reflex', params: { expected: JSON.stringify(expect.reflex), actual: JSON.stringify(fired) } }); }
  }
  return { name: typeof test?.name === 'string' ? test.name.slice(0, 120) : 'test', ok: failures.length === 0, failures, diagnostics, defaultName: typeof test?.name !== 'string' };
}

// ---------------------------------------------------------------------------------------------------------------
// Content fingerprint: what a plugin does, whatever it is called. The marketplace records it for every approved
// version, so a paid plugin loaded from a file under another id, name or wording is still recognised. Display text,
// picture file names and compiled expressions are left out; screen regions, colours, rules, keys and the template
// pictures themselves are what count. Each side hashes these inputs with its own SHA-256.

const FINGERPRINT_SKIP = new Set(['compiled', 'image', 'label', 'describe', 'question', 'message', 'name', 'title']);
function fingerprintText(value) {
  if (Array.isArray(value)) return `[${value.map(fingerprintText).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(key => !FINGERPRINT_SKIP.has(key) && value[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${fingerprintText(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** The inputs of a validated plugin's content fingerprint: its behaviour as canonical text and its template pictures. */
function contentFingerprintInputs(manifest, files) {
  const behavior = fingerprintText({ perception: manifest.perception, reflexes: manifest.reflexes, actions: manifest.actions,
    decisions: manifest.decisions, events: manifest.events, input: manifest.input });
  const paths = [...new Set(((manifest.perception && manifest.perception.signals) || []).filter(signal => signal.type === 'template' && signal.image).map(signal => signal.image))];
  return { behavior, images: paths.map(path => files.get(path)).filter(Boolean) };
}

// ---------------------------------------------------------------------------------------------------------------
// Pure rules only: package adapters own environment-specific ZIP and PNG decoding.

module.exports = { modelText, modelSummary, isPathParamType, normalizePathParam,
  pluginPattern, LOCALES, KEY_NAMES, LIMITS, allowedFile, validateManifest, publicManifest, manifestSummary, localize, compareVersions,
  compileExpression, evaluate, truthy, perceive, findTemplate, readBar, readPixels, readChange, readText, parseMediaTimestamp,
  renderState, estimateTokens, buildQuestions, readAnswers, checkReplay, contentFingerprintInputs
};
