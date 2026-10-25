/**
 * 漫剧对话 (the conversation mode, 高级) — conversations in a folder the user picked, like a coding project. The
 * folder holds a `chat` comic project: `nextmux.comic.json`, the media in `nextmux.media/` and one JSON file per
 * conversation in `nextmux.chats/`, so everything a conversation makes stays with the folder and lands in its
 * material library. Conversations started without a folder live in the app's own folder (`.chats` in the comic
 * library, listed under 最近). The four kinds (简单模式) are separate projects; only materials and 人物库 are shared.
 *
 * Generations run on the durable media queue like storyboard shots. A chat job is addressed by a reserved
 * scene/shot pair (`scene-chat-…` / `shot-turn-…`); real project IDs are `scene-<uuid>` / `shot-<uuid>`, whose
 * hex digits can never spell “chat” or “turn”. The backend recognises the pair, checks the request against the
 * model instead of a shot, and files the result as a project asset without touching any shot.
 */

import { normalizeRelayFeedbackRequestIds } from './nextmux-relay-feedback';

export const COMIC_CHAT_DIRECTORY = 'nextmux.chats';
export const COMIC_CHAT_SCHEMA_VERSION = 1 as const;

export type ComicChatMode = 'agent' | 'image' | 'video' | 'music' | 'speech';
export type ComicChatMediaKind = Exclude<ComicChatMode, 'agent'>;
export const COMIC_CHAT_MODES: readonly ComicChatMode[] = ['agent', 'image', 'video', 'music', 'speech'];
export const COMIC_CHAT_MEDIA_KINDS: readonly ComicChatMediaKind[] = ['image', 'video', 'music', 'speech'];

export type ComicChatAspect = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
export const COMIC_CHAT_ASPECTS: readonly ComicChatAspect[] = ['16:9', '9:16', '1:1', '4:3', '3:4'];
/** Video models film landscape, portrait and square only. */
export const COMIC_CHAT_VIDEO_ASPECTS: readonly ComicChatAspect[] = ['16:9', '9:16', '1:1'];

/** Same frame sizes as a new project's canvas (plus upright 3:4 for character sheets and posters). */
const SIZES: Readonly<Record<ComicChatAspect, readonly [number, number]>> = {
    '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '3:4': [1080, 1440]
};

export function comicChatSize(aspect: ComicChatAspect): { readonly width: number; readonly height: number } {
    const [width, height] = SIZES[aspect] || SIZES['16:9'];
    return { width, height };
}

/** The aspect ratio of an allowed chat frame size, or undefined for any other size. */
export function comicChatAspectOf(width: number, height: number): ComicChatAspect | undefined {
    return COMIC_CHAT_ASPECTS.find(aspect => SIZES[aspect][0] === width && SIZES[aspect][1] === height);
}

export interface ComicChatParams {
    readonly aspect?: ComicChatAspect;
    /** Pictures per request (1–4). */
    readonly count?: number;
    /** Video clip or music length in seconds. */
    readonly seconds?: number;
    /** Music: no vocals. */
    readonly instrumental?: boolean;
    /** Speech: the voice ID of the chosen model. */
    readonly voice?: string;
    /** Video: ask a model that makes sound for its own sound. */
    readonly sound?: boolean;
}

/** A generation the agent suggests; nothing runs (or is charged) until the user presses 生成. */
export interface ComicChatProposal {
    readonly id: string;
    readonly kind: ComicChatMediaKind;
    readonly title: string;
    readonly prompt: string;
    readonly aspect?: ComicChatAspect;
    readonly seconds?: number;
    /** Set once the user started it: the media jobs it made. */
    readonly jobIds?: readonly string[];
}

export interface ComicChatModel {
    /** ComicStepCandidate key (source + route). */
    readonly key: string;
    readonly routeId: string;
    readonly model: string;
    readonly label: string;
    readonly source: string;
}

export interface ComicChatTurn {
    readonly id: string;
    readonly mode: ComicChatMode;
    readonly prompt: string;
    /** The skill card that prepared this request, if any. */
    readonly skill?: string;
    /** A message sent in a media mode that was not a description ("1", "你好"): answered as conversation instead. */
    readonly from?: ComicChatMediaKind;
    /** Project asset IDs used as references (first frame, reference pictures). */
    readonly references: readonly string[];
    readonly params: ComicChatParams;
    readonly model?: ComicChatModel;
    /** Media jobs started by this turn (direct modes) — their results are project assets. */
    readonly jobIds: readonly string[];
    /** The agent's reasoning/thinking trace (<think>…</think>), if any. */
    readonly thinking?: string;
    /** Elapsed reasoning duration in milliseconds, if recorded. */
    readonly thinkingDurationMs?: number;
    /** The agent's answer (agent mode), shown as text. */
    readonly reply?: string;
    readonly proposals?: readonly ComicChatProposal[];
    /** The user's thumbs up or down on the reply (LobeChat #17); the next request is told so it can keep or change its style. */
    readonly feedback?: 'up' | 'down';
    /** Managed gateway request IDs used by this agent reply, enabling backend quality rating submission. */
    readonly relayRequestIds?: readonly string[];
    /** Why the turn stopped before any job was queued. */
    readonly error?: string;
    readonly createdAt: string;
}

export interface ComicChat {
    readonly schemaVersion: typeof COMIC_CHAT_SCHEMA_VERSION;
    readonly id: string;
    readonly projectId: string;
    readonly title: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly turns: readonly ComicChatTurn[];
}

export interface ComicChatSummary {
    readonly id: string;
    readonly title: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly turnCount: number;
    /** Every media job the conversation started: its generated materials are the assets made by these jobs. */
    readonly jobIds: readonly string[];
    /** Assets it sent as references (uploaded or picked pictures), also its materials. */
    readonly references: readonly string[];
}

/** The app's folder for conversations started without one (inside the comic library, hidden from the four kinds). */
export const COMIC_CHAT_DEFAULT_FOLDER = '.chats';

/** A folder in the conversation list. */
export interface ComicChatFolder {
    readonly path: string;
    /** The folder's name, as the list shows it. */
    readonly name: string;
    /**
     * chat — a conversation folder; comic — a project of the four kinds (opened there instead: the modes stay
     * apart); missing — moved, renamed or deleted since it was added.
     */
    readonly status: 'chat' | 'comic' | 'missing';
    readonly projectKind?: string;
    readonly title?: string;
    /** The app's folder for conversations without a folder of their own. */
    readonly managed?: boolean;
}

/** One material (a ready project asset) for the material lists, from any project. */
export interface ComicMaterialAsset {
    readonly id: string;
    readonly kind: 'image' | 'video' | 'audio' | 'music' | 'effect';
    /** Project-relative file (nextmux.media/…). */
    readonly uri: string;
    readonly title: string;
    readonly source: 'generated' | 'imported';
    readonly jobId?: string;
    readonly prompt?: string;
    readonly durationMs?: number;
    readonly width?: number;
    readonly height?: number;
    readonly sha256?: string;
    readonly createdAt: string;
    /** In the folder's 素材库 (added from a conversation with 右键 → 加入素材库). */
    readonly library?: boolean;
}

/** The materials of one project, for 全部素材 (every conversation folder and every project of the four kinds). */
export interface ComicMaterialProject {
    readonly path: string;
    readonly name: string;
    readonly projectKind: string;
    readonly managed?: boolean;
    readonly assets: readonly ComicMaterialAsset[];
}

export const COMIC_MATERIAL_LIMITS = { projects: 200, assetsPerProject: 500, library: 2_000 } as const;

/** A folder's 素材库: the materials the user kept (right-click → 加入素材库), newest first, beside its conversations. */
export const COMIC_MATERIAL_LIBRARY_FILE = 'library.json';

export const COMIC_CHAT_LIMITS = {
    title: 120,
    turns: 400,
    /** What the user writes in one turn: the composer's limit (speech has its own, shorter one). */
    prompt: 200_000,
    /** A prompt the assistant proposes for one picture, clip or track. */
    proposalPrompt: 12_000,
    reply: 40_000,
    proposals: 16,
    jobsPerTurn: 8,
    references: 6,
    chats: 400,
    fileBytes: 4 * 1024 * 1024
} as const;

const CHAT_ID = /^chat-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TURN_ID = /^turn-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROPOSAL_ID = /^proposal-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JOB_ID = /^media-job-[A-Za-z0-9-]{8,100}$/;
const ASSET_ID = /^asset-[A-Za-z0-9-]{8,100}$/;

export function isComicChatId(value: unknown): value is string {
    return typeof value === 'string' && CHAT_ID.test(value);
}

export function comicChatFileName(chatId: string): string {
    if (!isComicChatId(chatId)) throw new Error('COMIC_CHAT_ID_INVALID');
    return `${chatId}.json`;
}

/** The media queue address of a chat generation. */
export function comicChatJobTarget(chatId: string, turnId: string): { readonly sceneId: string; readonly shotId: string } {
    if (!isComicChatId(chatId) || !TURN_ID.test(turnId)) throw new Error('COMIC_CHAT_TARGET_INVALID');
    return { sceneId: `scene-${chatId}`, shotId: `shot-${turnId}` };
}

/** The conversation and turn a media job belongs to, or undefined for a storyboard job. */
export function comicChatJobOrigin(sceneId: string, shotId: string): { readonly chatId: string; readonly turnId: string } | undefined {
    if (typeof sceneId !== 'string' || typeof shotId !== 'string' || !sceneId.startsWith('scene-chat-') || !shotId.startsWith('shot-turn-')) return undefined;
    const chatId = sceneId.slice('scene-'.length);
    const turnId = shotId.slice('shot-'.length);
    return isComicChatId(chatId) && TURN_ID.test(turnId) ? { chatId, turnId } : undefined;
}

function text(value: unknown, maximum: number, field: string, required = false): string {
    if (value === undefined && !required) return '';
    if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) throw new Error(`COMIC_CHAT_${field.toUpperCase()}_INVALID`);
    return value;
}

function time(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) throw new Error(`COMIC_CHAT_${field.toUpperCase()}_INVALID`);
    return value;
}

function ids(value: unknown, pattern: RegExp, maximum: number, field: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > maximum || value.some(item => typeof item !== 'string' || !pattern.test(item))) throw new Error(`COMIC_CHAT_${field.toUpperCase()}_INVALID`);
    return [...new Set(value as string[])];
}

function params(value: unknown): ComicChatParams {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('COMIC_CHAT_PARAMS_INVALID');
    const item = value as Record<string, unknown>;
    const out: { -readonly [K in keyof ComicChatParams]: ComicChatParams[K] } = {};
    if (item.aspect !== undefined) {
        if (!COMIC_CHAT_ASPECTS.includes(item.aspect as ComicChatAspect)) throw new Error('COMIC_CHAT_PARAMS_INVALID');
        out.aspect = item.aspect as ComicChatAspect;
    }
    if (item.count !== undefined) {
        if (!Number.isInteger(item.count) || (item.count as number) < 1 || (item.count as number) > 4) throw new Error('COMIC_CHAT_PARAMS_INVALID');
        out.count = item.count as number;
    }
    if (item.seconds !== undefined) {
        if (!Number.isInteger(item.seconds) || (item.seconds as number) < 1 || (item.seconds as number) > 300) throw new Error('COMIC_CHAT_PARAMS_INVALID');
        out.seconds = item.seconds as number;
    }
    if (item.instrumental !== undefined) {
        if (typeof item.instrumental !== 'boolean') throw new Error('COMIC_CHAT_PARAMS_INVALID');
        out.instrumental = item.instrumental;
    }
    if (item.sound !== undefined) {
        if (typeof item.sound !== 'boolean') throw new Error('COMIC_CHAT_PARAMS_INVALID');
        out.sound = item.sound;
    }
    if (item.voice !== undefined) out.voice = text(item.voice, 120, 'params');
    return out;
}

function model(value: unknown): ComicChatModel | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('COMIC_CHAT_MODEL_INVALID');
    const item = value as Record<string, unknown>;
    return { key: text(item.key, 600, 'model', true), routeId: text(item.routeId, 400, 'model', true), model: text(item.model, 300, 'model', true),
        label: text(item.label, 300, 'model'), source: text(item.source, 300, 'model') };
}

function proposal(value: unknown): ComicChatProposal {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('COMIC_CHAT_PROPOSAL_INVALID');
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !PROPOSAL_ID.test(item.id) || !COMIC_CHAT_MEDIA_KINDS.includes(item.kind as ComicChatMediaKind)) throw new Error('COMIC_CHAT_PROPOSAL_INVALID');
    const settings = params({ aspect: item.aspect, seconds: item.seconds });
    const jobIds = ids(item.jobIds, JOB_ID, COMIC_CHAT_LIMITS.jobsPerTurn, 'proposal');
    return { id: item.id, kind: item.kind as ComicChatMediaKind, title: text(item.title, 200, 'proposal'), prompt: text(item.prompt, COMIC_CHAT_LIMITS.proposalPrompt, 'proposal', true),
        ...(settings.aspect ? { aspect: settings.aspect } : {}), ...(settings.seconds ? { seconds: settings.seconds } : {}), ...(jobIds.length ? { jobIds } : {}) };
}

function turn(value: unknown): ComicChatTurn {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('COMIC_CHAT_TURN_INVALID');
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !TURN_ID.test(item.id) || !COMIC_CHAT_MODES.includes(item.mode as ComicChatMode)) throw new Error('COMIC_CHAT_TURN_INVALID');
    const proposals = item.proposals === undefined ? [] : Array.isArray(item.proposals) && item.proposals.length <= COMIC_CHAT_LIMITS.proposals
        ? item.proposals.map(proposal) : (() => { throw new Error('COMIC_CHAT_PROPOSAL_INVALID'); })();
    const skill = text(item.skill, 60, 'skill');
    const thinking = text(item.thinking, COMIC_CHAT_LIMITS.reply, 'thinking');
    const thinkingDurationMs = typeof item.thinkingDurationMs === 'number' && Number.isFinite(item.thinkingDurationMs) && item.thinkingDurationMs >= 0
        ? Math.min(86_400_000, Math.round(item.thinkingDurationMs))
        : undefined;
    const reply = text(item.reply, COMIC_CHAT_LIMITS.reply, 'reply');
    const error = text(item.error, 2_000, 'error');
    const chosen = model(item.model);
    const from = item.mode === 'agent' && COMIC_CHAT_MODES.includes(item.from as ComicChatMode) && item.from !== 'agent' ? item.from as ComicChatMediaKind : undefined;
    const relayRequestIds = item.mode === 'agent' ? normalizeRelayFeedbackRequestIds(item.relayRequestIds) : [];
    return {
        id: item.id, mode: item.mode as ComicChatMode, prompt: text(item.prompt, COMIC_CHAT_LIMITS.prompt, 'prompt', true),
        ...(skill ? { skill } : {}),
        ...(from ? { from } : {}),
        references: ids(item.references, ASSET_ID, COMIC_CHAT_LIMITS.references, 'references'),
        params: params(item.params),
        ...(chosen ? { model: chosen } : {}),
        jobIds: ids(item.jobIds, JOB_ID, COMIC_CHAT_LIMITS.jobsPerTurn, 'jobs'),
        ...(thinking ? { thinking } : {}),
        ...(thinkingDurationMs !== undefined ? { thinkingDurationMs } : {}),
        ...(reply ? { reply } : {}),
        ...(proposals.length ? { proposals } : {}),
        ...(item.mode === 'agent' && (item.feedback === 'up' || item.feedback === 'down') ? { feedback: item.feedback } : {}),
        ...(relayRequestIds.length ? { relayRequestIds } : {}),
        ...(error ? { error } : {}),
        createdAt: time(item.createdAt, 'createdAt')
    };
}

/** A conversation read from disk or sent by the window: shape, sizes and IDs checked, unknown fields dropped. */
export function normalizeComicChat(value: unknown): ComicChat {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('COMIC_CHAT_INVALID');
    const item = value as Record<string, unknown>;
    if (item.schemaVersion !== COMIC_CHAT_SCHEMA_VERSION || !isComicChatId(item.id)) throw new Error('COMIC_CHAT_INVALID');
    if (typeof item.projectId !== 'string' || !/^project-[A-Za-z0-9-]{8,100}$/.test(item.projectId)) throw new Error('COMIC_CHAT_PROJECT_INVALID');
    if (!Array.isArray(item.turns) || item.turns.length > COMIC_CHAT_LIMITS.turns) throw new Error('COMIC_CHAT_TURNS_INVALID');
    const turns = item.turns.map(turn);
    if (new Set(turns.map(entry => entry.id)).size !== turns.length) throw new Error('COMIC_CHAT_TURNS_INVALID');
    return {
        schemaVersion: COMIC_CHAT_SCHEMA_VERSION, id: item.id, projectId: item.projectId,
        title: text(item.title, COMIC_CHAT_LIMITS.title, 'title').trim(),
        createdAt: time(item.createdAt, 'createdAt'), updatedAt: time(item.updatedAt, 'updatedAt'), turns
    };
}

export function comicChatSummary(chat: ComicChat): ComicChatSummary {
    const jobIds = new Set<string>(), references = new Set<string>();
    for (const turn of chat.turns) {
        for (const id of turn.jobIds) jobIds.add(id);
        for (const proposal of turn.proposals || []) for (const id of proposal.jobIds || []) jobIds.add(id);
        for (const id of turn.references) references.add(id);
    }
    return { id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, turnCount: chat.turns.length,
        jobIds: [...jobIds], references: [...references] };
}

/** A conversation's title from its first request: the first line, trimmed to a readable length. */
export function comicChatTitleFrom(prompt: string): string {
    const line = prompt.replace(/```[\s\S]*?```/g, ' ').split(/\r?\n/).map(part => part.trim()).find(Boolean) || '';
    const plain = line.replace(/\s+/g, ' ');
    const characters = Array.from(plain);
    return characters.length > 28 ? `${characters.slice(0, 28).join('')}…` : plain;
}

/**
 * Extracts `<think>…</think>` / `<thinking>…</thinking>` blocks (including unopened leading `</think>` prefixes
 * from vLLM/Ollama/OpenAI-compatible prompt templates, unclosed trailing `<think>` blocks, and unclosed trailing
 * `nextmux-generate` fences during streaming) so reasoning traces and raw proposal JSON never pollute visible prose.
 */
export function extractComicChatThinking(raw: string): { readonly text: string; readonly thinking?: string } {
    if (!raw) return { text: '' };
    const thoughts: string[] = [];
    let cleaned = raw.replace(/<(?:think|thinking)\b[^>]*>([\s\S]*?)<\/(?:think|thinking)\s*>/gi, (_match, inner: string) => {
        const trimmed = inner.trim();
        if (trimmed) thoughts.push(trimmed);
        return '';
    });
    const unopenedMatch = /^([\s\S]*?)<\/(?:think|thinking)\s*>/i.exec(cleaned);
    if (unopenedMatch) {
        const prefix = unopenedMatch[1].trim();
        if (prefix) thoughts.push(prefix);
        cleaned = cleaned.slice(unopenedMatch[0].length);
    }
    const openMatch = /<(?:think|thinking)\b[^>]*>([\s\S]*)$/i.exec(cleaned);
    if (openMatch) {
        const trailing = openMatch[1].trim();
        if (trailing) thoughts.push(trailing);
        cleaned = cleaned.slice(0, openMatch.index);
    }
    const unclosedFence = /```nextmux-generate[ \t]*(?:\r?\n(?![\s\S]*?```)[\s\S]*)?$/i.exec(cleaned);
    if (unclosedFence) {
        cleaned = cleaned.slice(0, unclosedFence.index);
    }
    const thinking = thoughts.join('\n\n').trim();
    return {
        text: cleaned.trim(),
        ...(thinking ? { thinking: thinking.slice(0, COMIC_CHAT_LIMITS.reply) } : {})
    };
}

function parseLenientProposalJson(raw: string): unknown {
    const trimmed = raw.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        let repaired = '';
        let inString = false;
        let escaped = false;
        for (let i = 0; i < trimmed.length; i++) {
            const ch = trimmed[i];
            if (inString) {
                if (escaped) { repaired += ch; escaped = false; continue; }
                if (ch === '\\') { repaired += ch; escaped = true; continue; }
                if (ch === '"') { inString = false; repaired += ch; continue; }
                if (ch === '\n') { repaired += '\\n'; continue; }
                if (ch === '\r') { repaired += '\\r'; continue; }
                if (ch === '\t') { repaired += '\\t'; continue; }
                repaired += ch;
            } else {
                if (ch === '"') { inString = true; repaired += ch; continue; }
                if (ch === ',') {
                    let j = i + 1;
                    while (j < trimmed.length && /\s/.test(trimmed[j])) j++;
                    if (trimmed[j] === '}' || trimmed[j] === ']') continue;
                }
                repaired += ch;
            }
        }
        return JSON.parse(repaired);
    }
}

/**
 * Agent replies end with the generations they suggest, one fenced block:
 *
 * ```nextmux-generate
 * [{ "kind": "image", "title": "老屋开场", "prompt": "…", "aspect": "16:9" }]
 * ```
 *
 * Returns the reply without the block and the suggestions it held (kinds, sizes and lengths checked; at most
 * 16). A missing or malformed block leaves the text as it is and suggests nothing.
 */
export function parseComicChatProposals(reply: string, newId: () => string): { readonly text: string; readonly thinking?: string; readonly proposals: readonly ComicChatProposal[] } {
    const extracted = extractComicChatThinking(reply);
    const cleanReply = extracted.text;
    const matches = [...cleanReply.matchAll(/```nextmux-generate[ \t]*\r?\n([\s\S]*?)```/gi)];
    const match = matches.at(-1);
    if (!match || match.index === undefined) {
        return { text: cleanReply, ...(extracted.thinking ? { thinking: extracted.thinking } : {}), proposals: [] };
    }
    const rest = `${cleanReply.slice(0, match.index)}${cleanReply.slice(match.index + match[0].length)}`.trim();
    let parsed: unknown;
    try {
        parsed = parseLenientProposalJson(match[1]);
    } catch {
        return { text: rest || cleanReply, ...(extracted.thinking ? { thinking: extracted.thinking } : {}), proposals: [] };
    }
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items) ? (parsed as { items: unknown[] }).items : [];
    const proposals: ComicChatProposal[] = [];
    for (const entry of list) {
        if (proposals.length >= COMIC_CHAT_LIMITS.proposals || !entry || typeof entry !== 'object') continue;
        const item = entry as Record<string, unknown>;
        const kind = item.kind === 'voice' ? 'speech' : item.kind;
        const prompt = typeof item.prompt === 'string' ? item.prompt.trim().slice(0, COMIC_CHAT_LIMITS.proposalPrompt) : '';
        if (!COMIC_CHAT_MEDIA_KINDS.includes(kind as ComicChatMediaKind) || !prompt) continue;
        let aspect = COMIC_CHAT_ASPECTS.includes(item.aspect as ComicChatAspect) ? item.aspect as ComicChatAspect : undefined;
        if (kind === 'video' && aspect && !COMIC_CHAT_VIDEO_ASPECTS.includes(aspect)) {
            aspect = aspect === '3:4' ? '9:16' : '16:9';
        }
        const seconds = typeof item.seconds === 'number' && Number.isFinite(item.seconds) ? Math.max(1, Math.min(300, Math.round(item.seconds))) : undefined;
        const title = typeof item.title === 'string' ? Array.from(item.title.trim()).slice(0, 60).join('') : '';
        proposals.push({ id: newId(), kind: kind as ComicChatMediaKind, title, prompt, ...(aspect ? { aspect } : {}), ...(seconds ? { seconds } : {}) });
    }
    return { text: rest, ...(extracted.thinking ? { thinking: extracted.thinking } : {}), proposals };
}
