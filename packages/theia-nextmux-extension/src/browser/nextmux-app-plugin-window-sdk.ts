import type {
    AppPluginOverlayItem,
    AppPluginParamValue,
    AppPluginUiBundleResult,
    AppPluginUiConfig
} from '../common/nextmux-app-plugins';
import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Security iron rule: plugin UIs run exclusively inside a null-origin sandboxed iframe
 * without `allow-same-origin`, `allow-popups`, or `allow-top-navigation`.
 */
export const APP_PLUGIN_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-modals' as const;

export const APP_PLUGIN_WINDOW_CHANNEL = 'nextmux-plugin-ui' as const;
/**
 * In the desktop app plugin pages are served from this scheme (apps/desktop/plugin-ui-scheme.cjs): a srcdoc page
 * inherits the app page's policy, which refuses inline scripts, the bridge's included. A page from the scheme is a
 * navigated document with the policy below as its own (VS Code's webviews load from vscode-webview:// the same way).
 */
export const APP_PLUGIN_UI_SCHEME = 'nextmux-plugin-ui' as const;
const APP_PLUGIN_UI_DOCUMENT_URL_RE = /^nextmux-plugin-ui:\/\/[0-9a-f]{32}\/$/;
/** Only a URL the desktop app handed out for a registered page is ever put in a plugin frame's src. */
export function isAppPluginUiDocumentUrl(value: unknown): value is string {
    return typeof value === 'string' && APP_PLUGIN_UI_DOCUMENT_URL_RE.test(value);
}
export const PLUGIN_WINDOW_VIEWPORT_MARGIN = 8;
export const PLUGIN_WINDOW_DEFAULT_WIDTH = 440;
export const PLUGIN_WINDOW_DEFAULT_HEIGHT = 520;
export const PLUGIN_WINDOW_MIN_WIDTH = 240;
export const PLUGIN_WINDOW_MIN_HEIGHT = 180;
export const PLUGIN_WINDOW_SUBMODAL_DEFAULT_WIDTH = 460;
export const PLUGIN_WINDOW_SUBMODAL_DEFAULT_HEIGHT = 340;

const MAX_STRING_LEN = 2000;
const MAX_HTML_LEN = 512_000;
const MAX_OVERLAY_ITEMS = 48;
const MAX_PARAMS_KEYS = 64;
const MAX_JSON_DEPTH = 6;
/** Whole-message budget for one untrusted JSON value: every value counts as a node, every key and string as characters. */
const MAX_JSON_NODES = 8192;
const MAX_JSON_CHARS = 1_048_576;
/** The host's MCP call accepts integer timeouts of 500–60000 ms (anything else falls back to its 15 s default). */
const MCP_TIMEOUT_MIN_MS = 500;
const MCP_TIMEOUT_MAX_MS = 60_000;
const SAFE_ID_RE = /^[a-zA-Z0-9._:/-]{1,120}$/;
const SAFE_COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|[a-zA-Z]{3,20})$/;
const RESERVED_HOST_TAB_FIELDS = new Set(['conversationId', 'tabId', 'pid', 'windowId', 'pluginId', 'runId']);
const FORBIDDEN_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type PluginWindowResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface AppPluginWindowRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface AppPluginWindowViewport {
    readonly width: number;
    readonly height: number;
}

export interface AppPluginTabActionRequest {
    readonly pluginId?: string;
    readonly runId?: string;
    readonly conversationId?: string;
    readonly tabId?: string;
    readonly pid?: number;
    readonly windowId?: number;
    readonly action: string;
    readonly [extra: string]: unknown;
}

export interface AppPluginTabActionResult {
    readonly ok: boolean;
    readonly error?: string;
    readonly result?: unknown;
}

/** Local intersection type for Track 2A's IPC method without touching `styles.d.ts`. */
export type NextMuxDesktopBridgeWithTabAction = NonNullable<Window['nextmuxDesktop']> & {
    runAppPluginTabAction?(request: AppPluginTabActionRequest): Promise<AppPluginTabActionResult>;
};

export interface AppPluginWindowSubModalSpec {
    readonly title: string;
    readonly html?: string;
    readonly text?: string;
    readonly width: number;
    readonly height: number;
}

export type AppPluginWindowInboundMessage =
    | { readonly kind: 'ready'; readonly requestId?: string }
    | { readonly kind: 'requestState'; readonly requestId?: string }
    | { readonly kind: 'escape'; readonly requestId?: string }
    | { readonly kind: 'openModal'; readonly requestId?: string; readonly modal: AppPluginWindowSubModalSpec }
    | { readonly kind: 'closeModal'; readonly requestId?: string }
    | { readonly kind: 'setTabOverlay'; readonly requestId?: string; readonly items?: readonly AppPluginOverlayItem[] | null; readonly visible?: boolean }
    | { readonly kind: 'tabAction'; readonly requestId?: string; readonly action: string; readonly payload: Readonly<Record<string, unknown>> }
    | { readonly kind: 'mcpCall'; readonly requestId?: string; readonly serverId?: string; readonly tool: string; readonly arguments?: Readonly<Record<string, unknown>>; readonly timeoutMs?: number }
    | { readonly kind: 'command'; readonly requestId?: string; readonly command: { readonly action?: 'pause' | 'resume' | 'stop' | 'start'; readonly goal?: string; readonly overlay?: boolean } }
    | { readonly kind: 'configure'; readonly requestId?: string; readonly params: Readonly<Record<string, AppPluginParamValue>> }
    | { readonly kind: 'pickParamFile'; readonly requestId?: string; readonly paramId: string; readonly label?: string };

export type AppPluginWindowParseResult =
    | { readonly ok: true; readonly message: AppPluginWindowInboundMessage }
    | { readonly ok: false; readonly error: string };

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

interface JsonBudget { nodes: number; chars: number }

/**
 * Clones untrusted JSON payloads while stripping prototype-pollution keys and bounding recursion depth, per-container
 * width, and the message's total size (the cleaned value is forwarded over IPC, so one oversized `tabAction` or
 * `mcpCall` must be refused here instead of stalling the main process).
 */
function sanitizePlainJsonValue(
    value: unknown,
    depth = 0,
    budget: JsonBudget = { nodes: 0, chars: 0 }
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
    if (depth > MAX_JSON_DEPTH || ++budget.nodes > MAX_JSON_NODES) return { ok: false };
    if (value === null || typeof value === 'boolean') return { ok: true, value };
    if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value } : { ok: false };
    if (typeof value === 'string') {
        budget.chars += value.length;
        return value.length <= 16_000 && budget.chars <= MAX_JSON_CHARS ? { ok: true, value } : { ok: false };
    }
    if (Array.isArray(value)) {
        if (value.length > 256) return { ok: false };
        const items: unknown[] = [];
        for (const entry of value) {
            const cleaned = sanitizePlainJsonValue(entry, depth + 1, budget);
            if (!cleaned.ok) return { ok: false };
            items.push(cleaned.value);
        }
        return { ok: true, value: items };
    }
    if (isPlainRecord(value)) {
        const entries = Object.entries(value);
        if (entries.length > 128) return { ok: false };
        const out: Record<string, unknown> = {};
        for (const [key, entry] of entries) {
            if (FORBIDDEN_PROTO_KEYS.has(key) || key.length > 120) continue;
            budget.chars += key.length;
            if (budget.chars > MAX_JSON_CHARS) return { ok: false };
            const cleaned = sanitizePlainJsonValue(entry, depth + 1, budget);
            if (!cleaned.ok) return { ok: false };
            out[key] = cleaned.value;
        }
        return { ok: true, value: out };
    }
    return { ok: false };
}

/** Clamps a floating plugin window rectangle within safe minimum dimensions and viewport edges. */
export function clampPluginWindowRect(
    rect: AppPluginWindowRect,
    viewport: AppPluginWindowViewport,
    bounds?: { readonly minWidth?: number; readonly minHeight?: number }
): AppPluginWindowRect {
    const vw = Math.max(240, Math.round(Number.isFinite(viewport.width) ? viewport.width : 1280));
    const vh = Math.max(200, Math.round(Number.isFinite(viewport.height) ? viewport.height : 800));
    const margin = Math.min(PLUGIN_WINDOW_VIEWPORT_MARGIN, Math.floor(Math.min(vw, vh) / 16));
    const maxW = Math.max(200, vw - margin * 2);
    const maxH = Math.max(160, vh - margin * 2);
    const minW = Math.min(maxW, Math.max(PLUGIN_WINDOW_MIN_WIDTH, Math.round(bounds?.minWidth ?? PLUGIN_WINDOW_MIN_WIDTH)));
    const minH = Math.min(maxH, Math.max(PLUGIN_WINDOW_MIN_HEIGHT, Math.round(bounds?.minHeight ?? PLUGIN_WINDOW_MIN_HEIGHT)));
    const width = Math.round(clamp(rect.width, minW, maxW));
    const height = Math.round(clamp(rect.height, minH, maxH));
    const maxX = Math.max(margin, vw - width - margin);
    const maxY = Math.max(margin, vh - height - margin);
    const x = Math.round(clamp(rect.x, margin, maxX));
    const y = Math.round(clamp(rect.y, margin, maxY));
    return { x, y, width, height };
}

/** Computes initial centered-right floating window bounds respecting `manifest.ui` preferences. */
export function initialPluginWindowRect(
    viewport: AppPluginWindowViewport,
    ui?: AppPluginUiConfig | null,
    saved?: Partial<AppPluginWindowRect> | null
): AppPluginWindowRect {
    const rawW = saved?.width ?? ui?.width ?? PLUGIN_WINDOW_DEFAULT_WIDTH;
    const rawH = saved?.height ?? ui?.height ?? PLUGIN_WINDOW_DEFAULT_HEIGHT;
    const bounds = { minWidth: ui?.minWidth, minHeight: ui?.minHeight };
    const provisional = clampPluginWindowRect({ x: 0, y: 0, width: rawW, height: rawH }, viewport, bounds);
    const defaultX = Math.max(PLUGIN_WINDOW_VIEWPORT_MARGIN, viewport.width - provisional.width - 28);
    const defaultY = Math.max(PLUGIN_WINDOW_VIEWPORT_MARGIN, Math.round((viewport.height - provisional.height) * 0.35));
    return clampPluginWindowRect({
        x: saved?.x ?? defaultX,
        y: saved?.y ?? defaultY,
        width: provisional.width,
        height: provisional.height
    }, viewport, bounds);
}

/** Moves a plugin window by `(deltaX, deltaY)` while keeping all edges inside viewport bounds. */
export function dragPluginWindowRect(
    startRect: AppPluginWindowRect,
    deltaX: number,
    deltaY: number,
    viewport: AppPluginWindowViewport,
    bounds?: { readonly minWidth?: number; readonly minHeight?: number }
): AppPluginWindowRect {
    return clampPluginWindowRect({
        ...startRect,
        x: startRect.x + (Number.isFinite(deltaX) ? deltaX : 0),
        y: startRect.y + (Number.isFinite(deltaY) ? deltaY : 0)
    }, viewport, bounds);
}

/** Resizes a plugin window from an 8-direction edge/corner handle with anchor preservation and viewport clamping. */
export function resizePluginWindowRect(
    startRect: AppPluginWindowRect,
    edge: PluginWindowResizeEdge,
    deltaX: number,
    deltaY: number,
    viewport: AppPluginWindowViewport,
    bounds?: { readonly minWidth?: number; readonly minHeight?: number }
): AppPluginWindowRect {
    const dx = Number.isFinite(deltaX) ? deltaX : 0;
    const dy = Number.isFinite(deltaY) ? deltaY : 0;
    const vw = Math.max(240, Math.round(viewport.width || 1280));
    const vh = Math.max(200, Math.round(viewport.height || 800));
    const margin = Math.min(PLUGIN_WINDOW_VIEWPORT_MARGIN, Math.floor(Math.min(vw, vh) / 16));
    const minW = Math.min(vw - margin * 2, Math.max(PLUGIN_WINDOW_MIN_WIDTH, Math.round(bounds?.minWidth ?? PLUGIN_WINDOW_MIN_WIDTH)));
    const minH = Math.min(vh - margin * 2, Math.max(PLUGIN_WINDOW_MIN_HEIGHT, Math.round(bounds?.minHeight ?? PLUGIN_WINDOW_MIN_HEIGHT)));

    let left = startRect.x;
    let top = startRect.y;
    let right = startRect.x + startRect.width;
    let bottom = startRect.y + startRect.height;

    if (edge.includes('w')) left = clamp(startRect.x + dx, margin, right - minW);
    if (edge.includes('e')) right = clamp(startRect.x + startRect.width + dx, left + minW, vw - margin);
    if (edge.includes('n')) top = clamp(startRect.y + dy, margin, bottom - minH);
    if (edge.includes('s')) bottom = clamp(startRect.y + startRect.height + dy, top + minH, vh - margin);

    return clampPluginWindowRect({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
    }, viewport, bounds);
}

/**
 * Verifies that an incoming `MessageEvent` comes strictly from the active sandboxed iframe window
 * and carries a null/opaque origin (never another frame or an injected origin).
 */
export function isValidPluginIframeEventSource(
    event: Pick<MessageEvent, 'source' | 'origin'> | null | undefined,
    expectedWindow: Window | null | undefined
): boolean {
    if (!event || !expectedWindow) return false;
    if (event.source !== expectedWindow) return false;
    return event.origin === 'null' || event.origin === '';
}

function normalizeNormalizedRect(raw: unknown): readonly [number, number, number, number] | null {
    if (!Array.isArray(raw) || raw.length < 4) return null;
    const nums = raw.slice(0, 4).map(Number);
    if (nums.some(n => !Number.isFinite(n))) return null;
    const x = clamp(nums[0], 0, 1);
    const y = clamp(nums[1], 0, 1);
    const w = clamp(nums[2], 0, 1 - x);
    const h = clamp(nums[3], 0, 1 - y);
    return [x, y, w, h];
}

function normalizeOverlayItem(raw: unknown, index: number): AppPluginOverlayItem | null {
    if (!isPlainRecord(raw)) return null;
    const idRaw = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim()
        : typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : `item-${index + 1}`;
    const id = idRaw.slice(0, 120);
    const rawType = typeof raw.type === 'string' ? raw.type.trim() : '';
    const type: AppPluginOverlayItem['type'] =
        rawType === 'bar' || rawType === 'pixel' || rawType === 'template' || rawType === 'change' || rawType === 'text'
            ? rawType
            : 'text';

    let rect = normalizeNormalizedRect(raw.rect);
    if (!rect && typeof raw.x === 'number' && typeof raw.y === 'number') {
        const w = typeof raw.width === 'number' && Number.isFinite(raw.width) ? raw.width : 0.12;
        const h = typeof raw.height === 'number' && Number.isFinite(raw.height) ? raw.height : 0.05;
        rect = normalizeNormalizedRect([raw.x, raw.y, w, h]);
    }
    const rects = Array.isArray(raw.rects)
        ? raw.rects.slice(0, 16).map(normalizeNormalizedRect).filter((r): r is readonly [number, number, number, number] => Boolean(r))
        : undefined;
    const points = Array.isArray(raw.points)
        ? raw.points.slice(0, 24).flatMap(entry => {
            if (!Array.isArray(entry) || entry.length < 2) return [];
            const px = Number(entry[0]);
            const py = Number(entry[1]);
            if (!Number.isFinite(px) || !Number.isFinite(py)) return [];
            const color = typeof entry[2] === 'string' && SAFE_COLOR_RE.test(entry[2].trim()) ? entry[2].trim() : '#ffffff';
            return [[clamp(px, 0, 1), clamp(py, 0, 1), color] as const];
        })
        : null;
    if (!rect && (!rects || !rects.length) && (!points || !points.length)) return null;

    let value: unknown = null;
    if (raw.value !== undefined) {
        const cleaned = sanitizePlainJsonValue(raw.value);
        if (!cleaned.ok) return null;
        value = cleaned.value;
    } else if (typeof raw.text === 'string') {
        value = raw.text.slice(0, 160);
    }

    return {
        id,
        type,
        rect,
        ...(rects?.length ? { rects } : {}),
        points,
        ...(typeof raw.active === 'boolean' ? { active: raw.active } : { active: true }),
        ...(typeof raw.variants === 'number' && Number.isFinite(raw.variants) && raw.variants > 0 ? { variants: Math.min(64, Math.round(raw.variants)) } : {}),
        value
    };
}

function normalizeAssetKey(rawPath: string): string {
    return rawPath.trim().split(/[?#]/, 1)[0].replace(/^\.\//, '').replace(/\\/g, '/');
}

function lookupPluginAsset(assets: Readonly<Record<string, string>> | undefined, ref: string): string | undefined {
    if (!assets) return undefined;
    const clean = normalizeAssetKey(ref);
    if (!clean || clean.includes('..') || clean.startsWith('/')) return undefined;
    return assets[clean] ?? assets[`ui/${clean}`] ?? assets[`assets/${clean}`];
}

const isDataUrl = (value: string): boolean => /^data:/i.test(value);

const hexValue = (byte: number): number => byte >= 0x30 && byte <= 0x39 ? byte - 0x30
    : byte >= 0x41 && byte <= 0x46 ? byte - 0x37 : byte >= 0x61 && byte <= 0x66 ? byte - 0x57 : -1;

/**
 * The text a `data:` URL carries (Fetch Standard "data: URL processor": base64 or percent-encoded bytes), decoded with
 * its charset (UTF-8 when it names none or one this browser does not know). Undefined when it is not a valid data: URL.
 */
function decodeDataUrlText(value: string): { readonly mime: string; readonly text: string } | undefined {
    const comma = value.indexOf(',');
    if (!isDataUrl(value) || comma < 0) return undefined;
    const params = value.slice(5, comma).split(';').map(part => part.trim());
    const base64 = params.length > 1 && params[params.length - 1].toLowerCase() === 'base64';
    if (base64) params.pop();
    const mime = (params[0] || 'text/plain').toLowerCase();
    const charset = params.slice(1).map(part => /^charset=(.+)$/i.exec(part)?.[1]?.replace(/^"|"$/g, '')).find(Boolean) || 'utf-8';
    try {
        // Percent-decoding first (base64 bodies may be percent-encoded too), on the URL's own bytes.
        const raw = new TextEncoder().encode(value.slice(comma + 1));
        let bytes: Uint8Array = new Uint8Array(raw.length);
        let length = 0;
        for (let i = 0; i < raw.length; i++) {
            const high = raw[i] === 0x25 && i + 2 < raw.length ? hexValue(raw[i + 1]) : -1;
            const low = high >= 0 ? hexValue(raw[i + 2]) : -1;
            if (low >= 0) { bytes[length++] = high * 16 + low; i += 2; } else bytes[length++] = raw[i];
        }
        bytes = bytes.subarray(0, length);
        if (base64) {
            let ascii = '';
            for (let i = 0; i < bytes.length; i += 0x8000) ascii += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            const binary = atob(ascii.replace(/[\t\n\f\r ]+/g, ''));
            bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        }
        let decoder: TextDecoder;
        try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder('utf-8'); }
        return { mime, text: decoder.decode(bytes) };
    } catch {
        return undefined;
    }
}

/** Validates and parses untrusted `postMessage` frames emitted by a sandboxed plugin UI iframe. */
export function parsePluginWindowPostMessage(
    rawData: unknown,
    assets?: Readonly<Record<string, string>>
): AppPluginWindowParseResult {
    if (!isPlainRecord(rawData)) return { ok: false, error: 'plugin_ui_message_not_object' };
    if (rawData.channel !== undefined && rawData.channel !== APP_PLUGIN_WINDOW_CHANNEL && rawData.channel !== 'nextmux.plugin-ui') {
        return { ok: false, error: 'plugin_ui_channel_mismatch' };
    }
    const type = typeof rawData.type === 'string' ? rawData.type.trim() : '';
    if (!type || type.length > 64) return { ok: false, error: 'plugin_ui_invalid_type' };
    const requestId = typeof rawData.id === 'string' && rawData.id.trim() && rawData.id.length <= 128
        ? rawData.id.trim()
        : typeof rawData.requestId === 'string' && rawData.requestId.trim() && rawData.requestId.length <= 128
            ? rawData.requestId.trim()
            : undefined;
    const payload = rawData.payload === undefined ? rawData
        : isPlainRecord(rawData.payload) ? rawData.payload : undefined;
    if (!payload) return { ok: false, error: 'plugin_ui_invalid_payload' };

    if (type === 'ready') return { ok: true, message: { kind: 'ready', requestId } };
    if (type === 'requestState') return { ok: true, message: { kind: 'requestState', requestId } };
    if (type === 'escape') return { ok: true, message: { kind: 'escape', requestId } };
    if (type === 'closeModal') return { ok: true, message: { kind: 'closeModal', requestId } };

    if (type === 'openModal') {
        const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 120) : '';
        // Markup cut at an arbitrary character breaks scripts and tags in ways the plugin cannot see: an oversized
        // document is refused with a named error instead.
        let html = typeof payload.html === 'string' ? payload.html : undefined;
        if (!html && typeof payload.entry === 'string') {
            const asset = lookupPluginAsset(assets, payload.entry);
            if (typeof asset !== 'string') return { ok: false, error: 'plugin_ui_modal_entry_not_found' };
            if (isDataUrl(asset)) {
                // Bundled files arrive as data: URLs (apps/desktop/app-plugins.cjs bundlePluginUi): the modal shows the
                // page they encode, never the URL's text. A URL too long to hold an allowed page is not decoded at all
                // (UTF-8 has at least one UTF-16 unit per three bytes, base64 or percent-encoding a byte takes ≤ 3 chars).
                if (asset.length > MAX_HTML_LEN * 9 + 1024) return { ok: false, error: 'plugin_ui_modal_too_large' };
                const decoded = decodeDataUrlText(asset);
                if (!decoded) return { ok: false, error: 'plugin_ui_modal_entry_invalid' };
                if (decoded.mime !== 'text/html') return { ok: false, error: 'plugin_ui_modal_entry_not_html' };
                html = decoded.text.replace(/^\uFEFF/, '');
            } else {
                html = asset;
            }
            if (!html) return { ok: false, error: 'plugin_ui_modal_empty' };
        }
        if (html && html.length > MAX_HTML_LEN) return { ok: false, error: 'plugin_ui_modal_too_large' };
        const text = typeof payload.text === 'string' ? payload.text.slice(0, MAX_STRING_LEN)
            : typeof payload.body === 'string' ? payload.body.slice(0, MAX_STRING_LEN) : undefined;
        if (!html && !text) return { ok: false, error: 'plugin_ui_modal_empty' };
        const width = Math.round(clamp(Number(payload.width ?? PLUGIN_WINDOW_SUBMODAL_DEFAULT_WIDTH), 240, 1100));
        const height = Math.round(clamp(Number(payload.height ?? PLUGIN_WINDOW_SUBMODAL_DEFAULT_HEIGHT), 180, 860));
        return { ok: true, message: { kind: 'openModal', requestId, modal: { title, html, text, width, height } } };
    }

    if (type === 'setTabOverlay') {
        const visible = typeof payload.visible === 'boolean' ? payload.visible : undefined;
        if (payload.items === null) {
            return { ok: true, message: { kind: 'setTabOverlay', requestId, items: null, visible } };
        }
        if (payload.items === undefined) {
            if (visible === undefined) return { ok: false, error: 'plugin_ui_overlay_items_invalid' };
            return { ok: true, message: { kind: 'setTabOverlay', requestId, items: undefined, visible } };
        }
        if (!Array.isArray(payload.items)) return { ok: false, error: 'plugin_ui_overlay_items_invalid' };
        const items: AppPluginOverlayItem[] = [];
        for (let i = 0; i < Math.min(payload.items.length, MAX_OVERLAY_ITEMS); i++) {
            const normalized = normalizeOverlayItem(payload.items[i], i);
            if (!normalized) return { ok: false, error: 'plugin_ui_overlay_item_invalid' };
            items.push(normalized);
        }
        return { ok: true, message: { kind: 'setTabOverlay', requestId, items, visible } };
    }

    if (type === 'tabAction') {
        const action = typeof payload.action === 'string' ? payload.action.trim() : '';
        if (!action || !SAFE_ID_RE.test(action)) return { ok: false, error: 'plugin_ui_tab_action_invalid' };
        const bodySource = isPlainRecord(payload.params) ? payload.params : payload;
        const cleaned = sanitizePlainJsonValue(bodySource);
        if (!cleaned.ok || !isPlainRecord(cleaned.value)) return { ok: false, error: 'plugin_ui_tab_action_payload_invalid' };
        const sanitizedPayload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(cleaned.value)) {
            if (RESERVED_HOST_TAB_FIELDS.has(k) || k === 'type' || k === 'channel' || k === 'id' || k === 'requestId' || k === 'action' || k === 'payload' || k === 'params') continue;
            sanitizedPayload[k] = v;
        }
        return { ok: true, message: { kind: 'tabAction', requestId, action, payload: sanitizedPayload } };
    }

    if (type === 'mcpCall') {
        const tool = typeof payload.tool === 'string' && payload.tool.trim() ? payload.tool.trim()
            : typeof payload.method === 'string' && payload.method.trim() ? payload.method.trim() : '';
        if (!tool || !SAFE_ID_RE.test(tool)) return { ok: false, error: 'plugin_ui_mcp_tool_invalid' };
        const serverId = typeof payload.serverId === 'string' && payload.serverId.trim()
            ? (SAFE_ID_RE.test(payload.serverId.trim()) ? payload.serverId.trim() : undefined)
            : undefined;
        if (payload.serverId !== undefined && !serverId) return { ok: false, error: 'plugin_ui_mcp_server_invalid' };
        let args: Record<string, unknown> | undefined;
        if (payload.arguments !== undefined) {
            const cleaned = sanitizePlainJsonValue(payload.arguments);
            if (!cleaned.ok || !isPlainRecord(cleaned.value)) return { ok: false, error: 'plugin_ui_mcp_args_invalid' };
            args = cleaned.value;
        }
        const timeoutMs = payload.timeoutMs === undefined ? undefined
            : Math.round(clamp(Number(payload.timeoutMs), MCP_TIMEOUT_MIN_MS, MCP_TIMEOUT_MAX_MS));
        return { ok: true, message: { kind: 'mcpCall', requestId, serverId, tool, arguments: args, timeoutMs } };
    }

    if (type === 'command') {
        const actionRaw = typeof payload.action === 'string' ? payload.action.trim() : undefined;
        const action = actionRaw === 'pause' || actionRaw === 'resume' || actionRaw === 'stop' || actionRaw === 'start'
            ? actionRaw
            : payload.pause === true ? 'pause' : payload.resume === true ? 'resume' : payload.stop === true ? 'stop' : undefined;
        const goal = typeof payload.goal === 'string' ? payload.goal.trim().slice(0, 400) : undefined;
        const overlay = typeof payload.overlay === 'boolean' ? payload.overlay : undefined;
        if (!action && goal === undefined && overlay === undefined) {
            return { ok: false, error: 'plugin_ui_command_empty' };
        }
        return { ok: true, message: { kind: 'command', requestId, command: { ...(action ? { action } : {}), ...(goal !== undefined ? { goal } : {}), ...(overlay !== undefined ? { overlay } : {}) } } };
    }

    if (type === 'configure') {
        const rawParams = isPlainRecord(payload.params) ? payload.params : undefined;
        if (!rawParams) return { ok: false, error: 'plugin_ui_configure_invalid' };
        const entries = Object.entries(rawParams);
        if (entries.length > MAX_PARAMS_KEYS) return { ok: false, error: 'plugin_ui_configure_too_many' };
        const params: Record<string, AppPluginParamValue> = {};
        for (const [k, v] of entries) {
            if (FORBIDDEN_PROTO_KEYS.has(k) || !SAFE_ID_RE.test(k)) return { ok: false, error: 'plugin_ui_configure_key_invalid' };
            const cleaned = sanitizePlainJsonValue(v);
            if (!cleaned.ok) return { ok: false, error: 'plugin_ui_configure_value_invalid' };
            params[k] = cleaned.value as AppPluginParamValue;
        }
        return { ok: true, message: { kind: 'configure', requestId, params } };
    }

    if (type === 'pickParamFile') {
        const paramId = typeof payload.paramId === 'string' ? payload.paramId.trim() : '';
        if (!paramId || !SAFE_ID_RE.test(paramId)) return { ok: false, error: 'plugin_ui_param_id_invalid' };
        const label = typeof payload.label === 'string' ? payload.label.trim().slice(0, 120) : undefined;
        return { ok: true, message: { kind: 'pickParamFile', requestId, paramId, label } };
    }

    return { ok: false, error: 'plugin_ui_unsupported_type' };
}

const escapeHtml = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeInlineStyle = (value: string): string => value.replace(/<\/style/gi, '<\\/style');
const escapeInlineScript = (value: string): string => value.replace(/<\/script/gi, '<\\/script');

function buildSdkBootstrapScript(theme: 'dark' | 'light', locale: NextMuxDesktopLocale): string {
    const payload = JSON.stringify({ theme, locale, channel: APP_PLUGIN_WINDOW_CHANNEL })
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
    return `<script>
(function(){
  var cfg = ${payload};
  document.documentElement.dataset.nmxTheme = cfg.theme;
  document.documentElement.lang = cfg.locale;
  var pending = Object.create(null);
  var listeners = [];
  var latestState = { theme: cfg.theme, locale: cfg.locale };
  var seq = 0;
  // timeoutMs: how long a reply may take (0 = wait for as long as it takes, e.g. an OS file dialog).
  function send(type, payload, expectReply, timeoutMs){
    var id = expectReply ? ('nmx_' + (++seq) + '_' + Date.now()) : undefined;
    var msg = { channel: cfg.channel, type: type, payload: payload || {} };
    if (id) msg.id = id;
    if (!expectReply) {
      try { window.parent.postMessage(msg, '*'); } catch (_) {}
      return Promise.resolve({ ok: true });
    }
    var waitMs = typeof timeoutMs === 'number' ? timeoutMs : 30000;
    return new Promise(function(resolve, reject){
      var timer = waitMs > 0 ? setTimeout(function(){
        delete pending[id];
        reject(new Error('plugin_ui_timeout'));
      }, waitMs) : 0;
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      try { window.parent.postMessage(msg, '*'); } catch (err) {
        clearTimeout(timer);
        delete pending[id];
        reject(err);
      }
    });
  }
  window.addEventListener('message', function(ev){
    if (ev.source !== window.parent) return;
    var data = ev.data;
    if (!data || typeof data !== 'object' || data.channel !== cfg.channel) return;
    if (data.type === 'response' && data.id && pending[data.id]) {
      var entry = pending[data.id];
      delete pending[data.id];
      clearTimeout(entry.timer);
      if (data.ok) entry.resolve(data.result);
      else entry.reject(new Error(data.error || 'plugin_ui_error'));
      return;
    }
    if (data.type === 'sync' && data.payload && typeof data.payload === 'object') {
      latestState = data.payload;
      if (data.payload.theme === 'light' || data.payload.theme === 'dark') {
        document.documentElement.dataset.nmxTheme = data.payload.theme;
      }
      if (typeof data.payload.locale === 'string') {
        document.documentElement.lang = data.payload.locale;
      }
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](latestState); } catch (_) {}
      }
    }
  });
  // Escape the host cannot see (the key went to this frame): handed to the host, which closes the top-most plugin
  // surface (never stops the run). Decided after the event has finished dispatching, so a plugin listener registered
  // later on window that consumes the key with preventDefault() still keeps it; a held key's repeats never cascade.
  window.addEventListener('keydown', function(ev){
    if (ev.key !== 'Escape' || ev.isComposing || ev.keyCode === 229 || ev.repeat) return;
    setTimeout(function(){
      if (!ev.defaultPrevented) send('escape', {}, false);
    }, 0);
  });
  var api = {
    getState: function(){ return latestState; },
    requestState: function(){ return send('requestState', {}, true); },
    onSync: function(fn){
      if (typeof fn === 'function') listeners.push(fn);
      return function(){ listeners = listeners.filter(function(item){ return item !== fn; }); };
    },
    openModal: function(opts){ return send('openModal', opts, true); },
    closeModal: function(){ return send('closeModal', {}, true); },
    setTabOverlay: function(items, visible){
      var payload = Array.isArray(items) || items === null
        ? { items: items, visible: visible }
        : (items && typeof items === 'object' ? items : (typeof visible === 'boolean' ? { visible: visible } : {}));
      return send('setTabOverlay', payload, true);
    },
    // Tab actions may launch or attach the target app first.
    tabAction: function(action, params){ return send('tabAction', typeof action === 'string' ? { action: action, params: params || {} } : action, true, 120000); },
    // The reply waits for the host's own MCP timeout (500–60000 ms, 15 s by default) plus transport slack.
    mcpCall: function(req){
      var ms = req && typeof req.timeoutMs === 'number' && isFinite(req.timeoutMs) ? Math.min(${MCP_TIMEOUT_MAX_MS}, Math.max(${MCP_TIMEOUT_MIN_MS}, req.timeoutMs)) : 15000;
      return send('mcpCall', req, true, Math.max(30000, ms + 15000));
    },
    // Starting a run can wait on the user (start confirmation, system permission prompts): no deadline then.
    command: function(cmd){ return send('command', cmd, true, cmd && cmd.action === 'start' ? 0 : 120000); },
    configure: function(params){ return send('configure', { params: params }, true); },
    // The OS file dialog stays open for as long as the user needs.
    pickParamFile: function(paramId, label){ return send('pickParamFile', { paramId: paramId, label: label }, true, 0); }
  };
  try {
    if (!window.NextMuxPluginUI) window.NextMuxPluginUI = api;
    if (!window.nextmuxPlugin) window.nextmuxPlugin = api;
  } catch (_) {}
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ send('ready', {}, false); });
  } else {
    send('ready', {}, false);
  }
})();
<\/script>`;
}

function buildThemeBaseStyle(theme: 'dark' | 'light'): string {
    const isLight = theme === 'light';
    return `<style data-nmx-host-theme>
:root, :root[data-nmx-theme="dark"] {
  color-scheme: dark;
  --nmx-ui-bg: #171617;
  --nmx-ui-surface: #201e20;
  --nmx-ui-border: rgba(255,255,255,0.12);
  --nmx-ui-fg: #f2eff2;
  --nmx-ui-muted: #aba4ab;
  --nmx-ui-accent: #f2eff2;
}
:root[data-nmx-theme="light"] {
  color-scheme: light;
  --nmx-ui-bg: #ffffff;
  --nmx-ui-surface: #f5f3f5;
  --nmx-ui-border: rgba(17,24,39,0.12);
  --nmx-ui-fg: #181718;
  --nmx-ui-muted: #5b555b;
  --nmx-ui-accent: #181718;
}
html, body {
  margin: 0;
  padding: 0;
  background: ${isLight ? 'var(--nmx-ui-bg, #ffffff)' : 'var(--nmx-ui-bg, #171617)'};
  color: ${isLight ? 'var(--nmx-ui-fg, #181718)' : 'var(--nmx-ui-fg, #f2eff2)'};
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
</style>`;
}

/**
 * The host policy for every plugin document. `connect-src 'none'` is deliberate (see docs/SKILL_PLUGIN_DEVELOPMENT
 * §3.19.2): plugin UIs reach the network only through declared MCP servers, so the tab snapshots a plugin can request
 * cannot be sent anywhere from the frame. A plugin's own CSP meta can only narrow this (policies intersect).
 */
export const APP_PLUGIN_UI_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'unsafe-inline' blob: data:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';";
/**
 * The page carries the policy itself too, so a srcdoc page (outside the desktop app) is held to it as well. The desktop
 * app sends the identical policy as the response header of every page it serves (apps/desktop/plugin-ui-scheme.cjs
 * PLUGIN_UI_CONTENT_SECURITY_POLICY; apps/desktop/test/plugin-ui-scheme.test.mjs keeps the two the same).
 */
const HOST_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${APP_PLUGIN_UI_CONTENT_SECURITY_POLICY}">`;
/** DNS prefetching is outside CSP (a `dns-prefetch` link to an attacker's subdomain leaks data); once off it stays off. */
const HOST_DNS_PREFETCH_META = '<meta http-equiv="x-dns-prefetch-control" content="off">';

/**
 * Bundles plugin HTML + declared local static assets into a strict CSP-hardened page (served from the
 * nextmux-plugin-ui: scheme in the desktop app, srcdoc elsewhere) with theme/locale variables and the `NextMuxPluginUI`
 * postMessage SDK.
 *
 * The host document head is written first and the plugin's markup follows it verbatim. Nothing in the plugin's
 * markup is searched for a `<head>` to inject into: a scanner disagreeing with the browser's tokenizer even once
 * (a `<head>` inside a comment, `<title>`, `<textarea>`, `<noscript>`, `<template>`, an attribute, or after a
 * `<script>` that already ran) would leave the policy inert. Because the host's `<head>` is open when the plugin's
 * markup starts, the HTML parser (HTML Standard, "in head" insertion mode) ignores the plugin's own DOCTYPE and
 * `<head>` tags, merges its `<html>` attributes onto the root (the host's `lang` and `data-nmx-theme` stay), keeps
 * its head elements in this head, and opens `<body>` at its first body content. So the CSP meta is always the
 * first policy-bearing element of the document and takes effect before any plugin script or style can load.
 * VS Code's webview host likewise always emits `<!DOCTYPE html>` and prepends its own head content
 * (src/vs/workbench/contrib/webview/browser/pre/index.html, toContentHtml).
 */
export function preparePluginUiHtml(
    bundle: Pick<AppPluginUiBundleResult, 'html' | 'assets'>,
    options: { readonly theme: 'dark' | 'light'; readonly locale: NextMuxDesktopLocale }
): string {
    const assets = bundle.assets;
    // A leading byte-order mark would be body text that opens <body> before the plugin's own head elements.
    let html = String(bundle.html || '').replace(/^\uFEFF/, '');

    if (assets) {
        // Bundled files arrive as data: URLs (apps/desktop/app-plugins.cjs bundlePluginUi). A stylesheet or script that
        // is one stays a link / script element that loads it (the policy allows data: for both), keeping its
        // attributes: defer, async, type="module", media. Pasted into <style>/<script> the URL's text would be the code.
        const hrefAttr = /(^|\s)href\s*=\s*(["'])([^"']+)\2/i;
        const srcAttr = /(^|\s)src\s*=\s*(["'])([^"']+)\2/i;
        html = html.replace(/<link\b([^>]*\brel=["']stylesheet["'][^>]*)>/gi, (full, attrs: string) => {
            const hrefMatch = hrefAttr.exec(attrs);
            if (!hrefMatch || isDataUrl(hrefMatch[3])) return full;
            const css = lookupPluginAsset(assets, hrefMatch[3]);
            if (typeof css !== 'string') return full;
            if (isDataUrl(css)) return `<link${attrs.replace(hrefAttr, (_m, lead: string) => `${lead}href="${escapeHtml(css)}"`)}>`;
            return `<style>${escapeInlineStyle(css)}</style>`;
        });
        html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (full, attrs: string) => {
            const srcMatch = srcAttr.exec(attrs);
            if (!srcMatch || isDataUrl(srcMatch[3])) return full;
            const js = lookupPluginAsset(assets, srcMatch[3]);
            if (typeof js !== 'string') return full;
            if (isDataUrl(js)) return `<script${attrs.replace(srcAttr, (_m, lead: string) => `${lead}src="${escapeHtml(js)}"`)}><\/script>`;
            const isModule = /\btype=["']module["']/i.test(attrs);
            return `<script${isModule ? ' type="module"' : ''}>${escapeInlineScript(js)}<\/script>`;
        });
        html = html.replace(/(<(?:img|source|video|audio)\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (full, prefix: string, src: string, suffix: string) => {
            if (/^data:|^blob:/i.test(src)) return full;
            const assetVal = lookupPluginAsset(assets, src);
            return typeof assetVal === 'string' && /^data:/i.test(assetVal) ? `${prefix}${escapeHtml(assetVal)}${suffix}` : full;
        });
    }

    const theme = options.theme === 'light' ? 'light' : 'dark';
    return `<!doctype html><html data-nmx-theme="${theme}" lang="${escapeHtml(String(options.locale))}"><head><meta charset="utf-8">`
        + `${HOST_CSP_META}${HOST_DNS_PREFETCH_META}\n${buildThemeBaseStyle(theme)}\n${buildSdkBootstrapScript(theme, options.locale)}\n`
        + html;
}

/** Wraps secondary `openModal` content inside a sandboxed HTML document with strict CSP isolation. */
export function buildPluginWindowSubModalHtml(
    spec: AppPluginWindowSubModalSpec,
    assets: Readonly<Record<string, string>> | undefined,
    options: { readonly theme: 'dark' | 'light'; readonly locale: NextMuxDesktopLocale }
): string {
    const rawHtml = spec.html
        ? spec.html
        : `<main style="padding:16px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;">${escapeHtml(spec.text || '')}</main>`;
    return preparePluginUiHtml({ html: rawHtml, assets }, options);
}
