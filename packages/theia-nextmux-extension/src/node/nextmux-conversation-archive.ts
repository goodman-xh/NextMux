import { conversationDomainError, type ConversationDomainReason } from '../common/nextmux-conversation-domain-errors';
import type { DomainMessage } from '../common/nextmux-domain-errors';
import { createHash, randomUUID } from 'crypto';
import { constants } from 'fs';
import { link, lstat, mkdir, open, realpath, rmdir, unlink } from 'fs/promises';
import { basename, dirname, extname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
    CONVERSATION_ARCHIVE_FORMAT, CONVERSATION_ARCHIVE_VERSION, CONVERSATION_ARCHIVE_MAX_BYTES,
    CONVERSATION_ARCHIVE_ATTACHMENT_MAX_BYTES, CONVERSATION_ARCHIVE_ATTACHMENTS_MAX_BYTES,
    CONVERSATION_ARCHIVE_MAX_ATTACHMENTS, CONVERSATION_ARCHIVE_PROJECT_VERSION, CONVERSATION_ARCHIVE_MAX_PROJECTS,
    CONVERSATION_ARCHIVE_OUTPUT_ASSET_VERSION, CONVERSATION_ARCHIVE_MAX_CONVERSATIONS
} from '../common/nextmux-conversation-archive';
import type { ArchiveAttachmentSource, ConversationArchiveExportOptions, ConversationArchiveExportResult, ConversationArchiveImportResult, ConversationArchivePreview, ConversationArchiveProject, ConversationArchiveProjectBinding } from '../common/nextmux-conversation-archive';
import { ConversationStore, conversationArchiveCopyId, conversationIdsDigest } from './nextmux-conversation-store';
import { normalizeModelCitations } from '@nextmux/agent-runtime/citations';
import { safeAgentMessageParams } from '@nextmux/agent-runtime';
import { legacyRuntimeFinalMessage, normalizeRuntimeFinalMessage as runtimeFinalMessage } from '@nextmux/agent-runtime/semantic-messages';
import { normalizeArchivedChildResults } from '../common/nextmux-citation-display';
import { captureArchiveDirectoryBinding, verifyArchiveDirectoryBinding, ArchiveProjectBindingError } from './nextmux-archive-project-bindings';
import type { ArchiveDirectoryBinding } from './nextmux-archive-project-bindings';
import { normalizeAgentOutputParts } from '@nextmux/agent-runtime/output-parts';
import type { AgentOutputAsset, AgentOutputPart } from '@nextmux/agent-runtime';
import type { OfficialModelOutputPart } from '@nextmux/model-runtime';

type RecordValue = Record<string, unknown>;
interface ArchiveFile { readonly path: string; readonly sha256: string; readonly size: number; readonly dataBase64: string; }
interface ArchiveDocument {
    readonly format: typeof CONVERSATION_ARCHIVE_FORMAT;
    readonly version: 1 | 2 | 3;
    readonly minimumReaderVersion: 1 | 2 | 3;
    readonly createdAt: number;
    readonly contentSha256: string;
    readonly conversations: readonly RecordValue[];
    readonly files: readonly ArchiveFile[];
    readonly warnings: readonly string[];
    readonly projects?: readonly ConversationArchiveProject[];
}
interface PreviewReceipt {
    readonly path: string; readonly sha256: string; readonly idsDigest: string; readonly expiresAt: number;
    readonly bindings?: ReadonlyMap<string, ArchiveDirectoryBinding>;
}
export interface ConversationArchiveOptions {
    readonly store: ConversationStore;
    readonly attachmentRoot: string;
    readonly additionalExportSessions?: () => Promise<readonly RecordValue[]>;
    readonly outputAssetDataRoot?: (ownerId: string) => string;
    /** The host must authorize this reference against its existing controlled attachment cache. */
    readonly readAttachment: (session: Readonly<RecordValue>, attachment: ArchiveAttachmentSource) => Promise<Uint8Array>;
}

export class ConversationArchiveError extends Error {
    readonly domainError: DomainMessage;
    readonly data: { readonly domainError: DomainMessage };
    constructor(readonly code: 'ARCHIVE_INVALID' | 'ARCHIVE_TOO_LARGE' | 'ARCHIVE_UNSAFE' | 'ARCHIVE_VERSION' | 'ARCHIVE_CHANGED' | 'ARCHIVE_PREVIEW_EXPIRED' | 'ARCHIVE_PREVIEW_BUSY' | 'ARCHIVE_ATTACHMENT_MISSING' | 'ARCHIVE_DESTINATION_EXISTS', reason: ConversationDomainReason) {
        const message = conversationDomainError(reason);
        super(message.fallbackEnglish);
        this.domainError = message; this.data = { domainError: message }; this.name = 'ConversationArchiveError';
    }
}

const privacyWarning = 'conversation_text_and_attachments_may_contain_secrets';
const runtimeWarning = 'runtime_credentials_workspaces_permissions_and_pending_queue_not_imported';
const projectWarning = 'project_labels_are_display_only_local_binding_requires_confirmation';
const attachmentFilePattern = /^attachments\/([a-f0-9]{64})\.([a-z0-9]{1,12})$/;
const outputAssetFilePattern = /^output-assets\/([a-f0-9]{64})\.(png|jpg|webp|gif|wav|mp3|ogg|flac)$/;
const outputAssetFormats = {
    'image/png': { type: 'image', extension: 'png' },
    'image/jpeg': { type: 'image', extension: 'jpg' },
    'image/webp': { type: 'image', extension: 'webp' },
    'image/gif': { type: 'image', extension: 'gif' },
    'audio/wav': { type: 'audio', extension: 'wav' },
    'audio/mpeg': { type: 'audio', extension: 'mp3' },
    'audio/ogg': { type: 'audio', extension: 'ogg' },
    'audio/flac': { type: 'audio', extension: 'flac' }
} as const;
const protectedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const previewLifetime = 15 * 60 * 1_000;
function object(value: unknown): value is RecordValue { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function invalid(reason: ConversationDomainReason): never { throw new ConversationArchiveError('ARCHIVE_INVALID', reason); }
function hash(bytes: string | Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function outputOwner(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') invalid('archive_output_owner_invalid');
    const normalized = value.trim();
    if (!normalized || normalized.length > 300 || /[\0\r\n]/.test(normalized)) invalid('archive_output_owner_invalid');
    return normalized;
}
function outputAssetPath(asset: AgentOutputAsset, type: 'image' | 'audio'): string {
    const format = outputAssetFormats[asset.mimeType as keyof typeof outputAssetFormats];
    if (!format || format.type !== type || !/^[a-f0-9]{64}$/.test(asset.sha256)) invalid('archive_output_format_invalid');
    return `output-assets/${asset.sha256}.${format.extension}`;
}
function outputStoragePath(dataRoot: string, ownerId: string, asset: AgentOutputAsset, type: 'image' | 'audio'): string {
    const format = outputAssetFormats[asset.mimeType as keyof typeof outputAssetFormats];
    if (!format || format.type !== type) invalid('archive_output_format_invalid');
    return join(resolve(dataRoot), 'agent-output-assets-v1', hash(outputOwner(ownerId)!), `${asset.sha256}.${format.extension}`);
}
function outputParts(value: unknown): readonly AgentOutputPart[] | undefined {
    if (value === undefined) return undefined;
    try {
        const normalized = normalizeAgentOutputParts(value);
        return normalized?.length ? normalized : undefined;
    } catch {
        invalid('archive_output_parts_invalid');
    }
}
function text(value: unknown, maximum = 2 * 1024 * 1024): string {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) invalid('archive_text_invalid');
    return value;
}
function id(value: unknown, maximum = 240): string {
    const result = text(value, maximum);
    if (!result || /[\\/\x00-\x1f]/.test(result) || result.includes('..') || protectedKeys.has(result)) invalid('archive_identity_invalid');
    return result;
}
function timestamp(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) invalid('archive_time_invalid');
    return Number(value);
}
function list(value: unknown, maximum: number): readonly unknown[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > maximum) invalid('archive_list_limit');
    return value;
}
function pickText(value: RecordValue, keys: readonly string[], maximum = 2 * 1024 * 1024): RecordValue {
    return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, text(value[key], maximum)]));
}
function frozenId(value: unknown): string {
    const source = text(value, 500);
    return /^archive-[a-f0-9]{32}$/.test(source) ? source : `archive-${hash(source).slice(0, 32)}`;
}
function contentHash(conversations: readonly unknown[], files: readonly ArchiveFile[], projects?: readonly ConversationArchiveProject[]): string {
    return hash(JSON.stringify({ conversations, files: files.map(({ dataBase64: _bytes, ...file }) => file), ...(projects ? { projects } : {}) }));
}

function projectLabel(value: unknown): string {
    const label = text(value, 160).trim();
    if (!label || /^[a-z]:/i.test(label) || /[\\/\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(label)) invalid('archive_project_label_invalid');
    return label;
}
function projectRef(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) invalid('archive_project_id_invalid');
    return value;
}
function archiveProjects(value: unknown): readonly ConversationArchiveProject[] {
    const refs = new Set<string>();
    return list(value, CONVERSATION_ARCHIVE_MAX_PROJECTS).map(item => {
        if (!object(item) || Object.keys(item).some(key => !['ref', 'label'].includes(key))) invalid('archive_project_fields_invalid');
        const ref = projectRef(item.ref);
        if (refs.has(ref)) invalid('archive_project_id_duplicate');
        refs.add(ref);
        return { ref, label: projectLabel(item.label) };
    });
}

function exportProjects(options: ConversationArchiveExportOptions | undefined, requested: ReadonlySet<string>): {
    readonly projects: readonly ConversationArchiveProject[]; readonly bySession: ReadonlyMap<string, string>;
} {
    if (options !== undefined && (!object(options) || Object.keys(options).some(key => key !== 'projects'))) invalid('archive_project_export_invalid');
    const bySession = new Map<string, string>();
    const projects = list(options?.projects, CONVERSATION_ARCHIVE_MAX_PROJECTS).map(value => {
        if (!object(value) || Object.keys(value).some(key => !['label', 'sessionIds'].includes(key))) invalid('archive_project_group_invalid');
        const ref = randomUUID(), label = projectLabel(value.label);
        const sessions = list(value.sessionIds, CONVERSATION_ARCHIVE_MAX_CONVERSATIONS);
        if (!sessions.length) invalid('archive_project_conversation_missing');
        for (const candidate of sessions) {
            const sessionId = id(candidate);
            if (!requested.has(sessionId) || bySession.has(sessionId)) invalid('archive_project_selection_invalid');
            bySession.set(sessionId, ref);
        }
        return { ref, label };
    });
    return { projects, bySession };
}

/** Preserve stable diagnostics without granting retry/resume authority to imported history. */
function archivedFailure(value: unknown): RecordValue | undefined {
    if (!object(value) || typeof value.code !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value.code)) return undefined;
    const kinds = ['model_timeout', 'rate_limited', 'model_unavailable', 'model_auth', 'tool_failed', 'waiting_user', 'failed'];
    return { code: value.code, kind: kinds.includes(String(value.kind)) ? value.kind : 'failed',
        message: `Task failed (${value.code}).`, retryable: false, resumable: false };
}

function steering(value: unknown): RecordValue {
    if (!object(value)) invalid('archive_steering_invalid');
    return { id: id(value.id), content: text(value.content), createdAt: text(value.createdAt, 100),
        ...(value.status === 'accepted' || value.status === 'applied' || value.status === 'requeued' ? { status: value.status } : {}),
        ...pickText(value, ['appliedAt'], 100) };
}

/** Only display data survives; no commands, checkpoint handles or provider state become authority. */
function event(value: unknown, warnings: Set<string>): RecordValue | undefined {
    if (!object(value)) invalid('archive_event_invalid');
    const at = text(value.at, 100);
    const type = text(value.type, 100);
    if (type === 'model_completed') return { type, at, turn: Number.isSafeInteger(value.turn) && Number(value.turn) >= 0 ? value.turn : 0,
        toolCallCount: Number.isSafeInteger(value.toolCallCount) && Number(value.toolCallCount) >= 0 ? value.toolCallCount : 0,
        ...(normalizeModelCitations(value.citations).length ? { citations: normalizeModelCitations(value.citations) } : {}) };
    if (type === 'user_input_requested') {
        if (!object(value.question)) invalid('archive_question_invalid');
        const q = value.question;
        return { type, at, question: { questionId: frozenId(q.questionId), runId: frozenId(q.runId), taskId: frozenId(q.taskId),
            prompt: text(q.prompt, 4_000), allowFreeText: q.kind !== "permission",
            ...(q.kind === "permission" && object(q.approval) ? { kind: "permission", approval: { toolName: text(q.approval.toolName, 180), scope: text(q.approval.scope, 80), target: text(q.approval.target, 24_000), ...pickText(q.approval, ["detail"], 8_192) } } : {}), createdAt: text(q.createdAt, 100), expiresAt: text(q.expiresAt, 100),
            options: list(q.options, 6).map(option => {
                if (!object(option)) invalid('archive_question_options_invalid');
                return { id: id(option.id, 200), label: text(option.label, 500), ...pickText(option, ['description'], 1_000) };
            }) } };
    }
    if (type === 'user_input_resolved') {
        if (!['answered', 'cancelled', 'expired'].includes(String(value.status))) invalid('archive_question_result_invalid');
        return { type, at, questionId: frozenId(value.questionId), runId: frozenId(value.runId), taskId: frozenId(value.taskId), status: value.status,
            ...(value.status === 'answered' && object(value.answer) ? { answer: pickText(value.answer, ['optionId', 'optionLabel', 'text'], 10_000) } : {}) };
    }
    if (type === 'steering_accepted' || type === 'steering_applied') return { type, at, message: steering(value.message), turn: 0 };
    if (type === 'provider_reasoning' && value.visibility !== 'visible') { warnings.add('hidden_reasoning_omitted'); return undefined; }
    if (['assistant_progress', 'assistant_delta', 'provider_reasoning', 'tool_output', 'tool_process_started'].includes(type)) {
        return { type: 'assistant_progress', at, turn: 0, origin: value.origin === 'runtime' ? 'runtime' : 'model', content: text(value.content ?? value.delta ?? value.chunk ?? value.commandLine) };
    }
    if (type === 'tool_started' || type === 'tool_completed') {
        const summary = object(value.summary) ? value.summary : {};
        const details = list(summary.details, 100).map(detail => text(detail));
        return { type, at, callId: frozenId(value.callId), toolName: text(value.toolName, 500), source: 'archive', ok: value.ok === true,
            durationMs: Number.isFinite(value.durationMs) ? Math.max(0, Number(value.durationMs)) : 0,
            summary: { title: text(summary.title, 2_000), details,
                ...(typeof summary.kind === 'string' && /^[a-z][a-z0-9_.]{0,199}$/.test(summary.kind) ? { kind: summary.kind } : {}),
                ...(safeAgentMessageParams(summary.params) ? { params: safeAgentMessageParams(summary.params) } : {}) } };
    }
    if (type === 'plan_updated') {
        return { type, at, source: 'model', steps: list(value.steps, 100).map(step => {
            if (!object(step)) invalid('archive_plan_invalid');
            return { id: id(step.id), title: text(step.title), status: ['pending', 'in_progress', 'completed'].includes(String(step.status)) ? step.status : 'pending' };
        }) };
    }
    // Timing/routing/process lifecycle events have no portable execution state.
    warnings.add('runtime_activity_metadata_omitted');
    return undefined;
}

function attachmentMetadata(value: unknown): ArchiveAttachmentSource {
    if (!object(value) || !['text', 'image', 'file'].includes(String(value.kind))) invalid('archive_attachment_reference_invalid');
    const name = text(value.name, 240);
    if (!name || /[\\/\x00-\x1f]/.test(name)) invalid('archive_attachment_name_invalid');
    const result = { id: id(value.id, 100), name, kind: value.kind as ArchiveAttachmentSource['kind'], uri: text(value.uri, 32_768),
        ...pickText(value, ['mimeType'], 127), ...pickText(value, ['inlineReference'], 500),
        ...pickText(value, ['workspaceRelativePath'], 1_024),
        ...(value.size !== undefined ? { size: timestamp(value.size) } : {}) };
    return result as ArchiveAttachmentSource;
}

async function portableAttachments(
    raw: unknown, pasted: unknown, convert: (reference: ArchiveAttachmentSource) => Promise<RecordValue>
): Promise<{ readonly attachments: readonly RecordValue[]; readonly pastedTextReferences?: string }> {
    const attachments: RecordValue[] = [];
    const byId = new Map<string, RecordValue>();
    for (const value of list(raw, 100)) {
        const source = attachmentMetadata(value);
        if (byId.has(source.id)) invalid('archive_attachment_id_duplicate');
        const attachment = await convert(source);
        attachments.push(attachment); byId.set(source.id, attachment);
    }
    const pastedReferences = [];
    if (pasted !== undefined && pasted !== '') {
        let parsed: unknown;
        try { parsed = JSON.parse(text(pasted, 40_000)); } catch { invalid('archive_pasted_text_corrupt'); }
        for (const reference of list(parsed, 20)) {
            if (!object(reference) || !object(reference.attachment)) invalid('archive_pasted_text_invalid');
            const referenceId = id(reference.id, 100);
            let attachment = byId.get(referenceId);
            if (!attachment) {
                attachment = await convert(attachmentMetadata({ ...reference.attachment, id: referenceId, name: reference.name, kind: 'text', mimeType: 'text/plain' }));
                attachments.push(attachment); byId.set(referenceId, attachment);
            }
            const ordinal = timestamp(reference.ordinal);
            if (ordinal < 1 || !String(reference.name).endsWith('.txt') || reference.name !== attachment.name) invalid('archive_pasted_text_mismatch');
            pastedReferences.push({ id: referenceId, ordinal, name: attachment.name, marker: text(reference.marker, 500), modelReference: text(reference.modelReference, 500),
                attachment: { uri: attachment.uri, size: attachment.size } });
        }
    }
    return { attachments, ...(pastedReferences.length ? { pastedTextReferences: JSON.stringify(pastedReferences) } : {}) };
}

interface PortableOutputParts {
    readonly outputParts: readonly AgentOutputPart[];
    readonly outputAssetOwnerId?: string;
}

type ConvertOutputParts = (
    parts: readonly AgentOutputPart[], sourceOwnerId: string | undefined
) => Promise<PortableOutputParts>;

async function portableSession(
    value: unknown,
    warnings: Set<string>,
    convert: (reference: ArchiveAttachmentSource) => Promise<RecordValue>,
    convertOutput?: ConvertOutputParts
): Promise<RecordValue> {
    if (!object(value)) invalid('archive_session_invalid');
    const turns = [];
    const turnIds = new Set<string>();
    for (const candidate of list(value.turns, 100_000)) {
        if (!object(candidate)) invalid('archive_message_invalid');
        const turnId = id(candidate.id, 200);
        if (turnIds.has(turnId)) invalid('archive_message_id_duplicate');
        turnIds.add(turnId);
        const events = list(candidate.events, 10_000).map(item => event(item, warnings)).filter(item => item !== undefined);
        // Preserve human-readable diffs/child results, without live restore/child-run handles.
        for (const change of list(candidate.changes, 1_000)) {
            if (!object(change)) invalid('archive_diff_invalid');
            events.push({ type: 'assistant_progress', at: text(change.createdAt, 100), turn: 0, origin: 'model',
                content: `${text(change.path, 32_768)}\n${text(change.patch || change.afterContent || change.beforeContent)}` });
        }
        const archivedChildResults = [...normalizeArchivedChildResults(list(candidate.archivedChildResults, 32))];
        for (const child of list(candidate.childAgents, 100)) {
            if (!object(child)) invalid('archive_child_history_invalid');
            const result = object(child.result) ? child.result : {};
            events.push({ type: 'assistant_progress', at: '', turn: 0, origin: runtimeFinalMessage(result.finalMessage) ? 'runtime' : 'model', content: `${text(child.task)}\n${text(result.finalText || child.finalText)}` });
            const citations = normalizeModelCitations(result.citations);
            if (citations.length && candidate.branchUserOnly !== true) {
                if (typeof child.childRunId !== 'string' || !child.childRunId || typeof result.finalText !== 'string') {
                    warnings.add('child_citation_identity_missing');
                } else {
                    const childId = frozenId(JSON.stringify([turnId, text(child.childRunId, 200)]));
                    if (!archivedChildResults.some(item => item.childId === childId)) archivedChildResults.push({
                        childId, task: text(child.task), finalText: text(result.finalText), citations
                    });
                }
            }
        }
        if (archivedChildResults.length > 32) invalid('archive_child_citation_limit');
        const attachments = await portableAttachments(candidate.attachments, candidate.pastedTextReferences, convert);
        const normalizedOutput = candidate.branchUserOnly === true ? undefined : outputParts(candidate.outputParts);
        const portableOutput = normalizedOutput
            ? await (convertOutput || (() => invalid('archive_output_version')))(normalizedOutput, outputOwner(candidate.outputAssetOwnerId))
            : undefined;
        const stage = ['complete', 'error', 'cancelled'].includes(String(candidate.stage)) ? candidate.stage : 'cancelled';
        const finalMessage = runtimeFinalMessage(candidate.finalMessage)
            ?? legacyRuntimeFinalMessage(text(candidate.response), candidate.stopReason);
        const stopReason = runtimeFinalMessage({ origin: 'runtime', stopReason: candidate.stopReason })?.stopReason;
        const failure = archivedFailure(candidate.failure);
        turns.push({ id: turnId, ...pickText(candidate, ['userMessageId', 'assistantMessageId'], 240),
            prompt: text(candidate.prompt), response: text(candidate.response), error: text(candidate.error), stage,
            ...(portableOutput || {}),
            ...(candidate.branchUserOnly !== true && finalMessage ? { finalMessage } : {}),
            ...(candidate.branchUserOnly !== true && stopReason ? { stopReason } : {}),
            ...(candidate.branchUserOnly !== true && failure ? { failure } : {}),
            ...(candidate.branchUserOnly !== true && normalizeModelCitations(candidate.citations).length
                ? { citations: normalizeModelCitations(candidate.citations) } : {}),
            ...(candidate.branchUserOnly !== true && archivedChildResults.length
                ? { archivedChildResults: normalizeArchivedChildResults(archivedChildResults) } : {}),
            createdAt: timestamp(candidate.createdAt), ...(candidate.completedAt !== undefined ? { completedAt: timestamp(candidate.completedAt) } : {}),
            permissionMode: 'read_only', routeLabel: text(candidate.routeLabel, 500),
            ...pickText(candidate, ['executionLabel', 'usageLabel', 'billingLabel'], 2_000),
            ...(Number.isSafeInteger(candidate.importedToolCalls) && Number(candidate.importedToolCalls) >= 0 ? { importedToolCalls: candidate.importedToolCalls } : {}),
            ...(candidate.branchUserOnly === true ? { branchUserOnly: true } : {}),
            ...(candidate.modelPrompt !== undefined ? { modelPrompt: text(candidate.modelPrompt) } : {}),
            ...attachments, events, steeringMessages: list(candidate.steeringMessages, 1_000).map(steering) });
    }
    const draft = await portableAttachments(value.draftAttachments, value.draftPastedTextReferences, convert);
    if (list(value.followUpQueue, 100).length) warnings.add('unsent_queue_omitted');
    // Archive imports intentionally have no live child handles; do not rebind unsent text to another execution.
    if (Array.isArray(value.agentChildDrafts) && value.agentChildDrafts.length) warnings.add('unsent_child_drafts_omitted');
    return { id: id(value.id), title: text(value.title, 1_000), workspacePath: '', ownedWorkspace: true,
        ...(value.titleOrigin === 'default' || value.titleOrigin === 'draft' || value.titleOrigin === 'recoveredDraft' ? { titleOrigin: value.titleOrigin } : {}),
        pinned: value.pinned === true, permissionMode: 'read_only', turns, draftPrompt: text(value.draftPrompt), draftAttachments: draft.attachments,
        ...(draft.pastedTextReferences ? { draftPastedTextReferences: draft.pastedTextReferences } : {}),
        createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt) };
}

async function readRegularFile(path: string, maximum: number): Promise<Buffer> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new ConversationArchiveError('ARCHIVE_UNSAFE', 'archive_file_unsafe');
    if (info.size > maximum) throw new ConversationArchiveError('ARCHIVE_TOO_LARGE', 'archive_file_limit');
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw new ConversationArchiveError('ARCHIVE_CHANGED', 'archive_file_changed');
        const bytes = Buffer.alloc(opened.size);
        let offset = 0;
        while (offset < bytes.length) {
            const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (!bytesRead) throw new ConversationArchiveError('ARCHIVE_CHANGED', 'archive_file_changed');
            offset += bytesRead;
        }
        if ((await handle.stat()).size !== bytes.length) throw new ConversationArchiveError('ARCHIVE_CHANGED', 'archive_file_changed');
        return bytes;
    } finally { await handle.close(); }
}

function validateJsonShape(value: unknown): void {
    const stack = [{ value, depth: 0 }];
    let nodes = 0;
    while (stack.length) {
        const item = stack.pop()!;
        if (++nodes > 2_000_000 || item.depth > 32) invalid('archive_structure_limit');
        if (item.value && typeof item.value === 'object') {
            for (const [key, child] of Object.entries(item.value)) {
                if (protectedKeys.has(key)) invalid('archive_protected_field');
                stack.push({ value: child, depth: item.depth + 1 });
            }
        }
    }
}

/** Exclusive publication; exFAT fallback never overwrites an existing destination. */
export async function publishConversationArchiveFile(
    temporary: string, target: string, bytes: Uint8Array,
    linkFile: typeof link = link, openFile: typeof open = open
): Promise<void> {
    try { await linkFile(temporary, target); return; }
    catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') throw new ConversationArchiveError('ARCHIVE_DESTINATION_EXISTS', 'archive_destination_exists');
        if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS'].includes(code || '')) throw error;
    }
    let handle;
    try { handle = await openFile(target, 'wx', 0o600); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ConversationArchiveError('ARCHIVE_DESTINATION_EXISTS', 'archive_destination_exists');
        throw error;
    }
    let created;
    try { created = await handle.stat(); await handle.writeFile(bytes); await handle.sync(); }
    catch (error) {
        // Only remove our own failed output, not a file moved into its name meanwhile.
        await handle.close().catch(() => undefined);
        const current = await lstat(target).catch(() => undefined);
        if (created && current?.isFile() && !current.isSymbolicLink() && current.dev === created.dev && current.ino === created.ino) {
            await unlink(target).catch(() => undefined);
        }
        throw error;
    } finally { await handle.close(); }
}

export class ConversationArchiveService {
    private readonly previews = new Map<string, PreviewReceipt>();
    private readonly busyPreviews = new Set<string>();
    constructor(private readonly options: ConversationArchiveOptions) {}

    private outputAssetDataRoot(): string {
        return dirname(resolve(this.options.attachmentRoot));
    }

    async exportFile(destinationPath: string, sessionIds?: readonly string[], exportOptions?: ConversationArchiveExportOptions): Promise<ConversationArchiveExportResult> {
        const all = [...await this.options.store.snapshot(), ...await this.options.additionalExportSessions?.() || []];
        const requested = sessionIds === undefined ? new Set(all.map(session => String(session.id))) : new Set(sessionIds.map(value => id(value)));
        if (sessionIds && requested.size !== sessionIds.length || [...requested].some(value => !all.some(session => session.id === value))) invalid('archive_export_selection_invalid');
        if (!requested.size) invalid('archive_export_empty');
        const grouping = exportProjects(exportOptions, requested);
        const warnings = new Set([privacyWarning, runtimeWarning]);
        if (grouping.projects.length) warnings.add(projectWarning);
        const files = new Map<string, ArchiveFile>();
        let binaryBytes = 0;
        let usesOutputParts = false;
        const addFile = (path: string, bytes: Buffer): void => {
            const sha256 = hash(bytes);
            const existing = files.get(path);
            if (existing) {
                if (existing.sha256 !== sha256 || existing.size !== bytes.length) invalid('archive_resource_hash_conflict');
                return;
            }
            binaryBytes += bytes.length;
            if (binaryBytes > CONVERSATION_ARCHIVE_ATTACHMENTS_MAX_BYTES || files.size >= CONVERSATION_ARCHIVE_MAX_ATTACHMENTS) {
                throw new ConversationArchiveError('ARCHIVE_TOO_LARGE', 'archive_resources_limit');
            }
            files.set(path, { path, sha256, size: bytes.length, dataBase64: bytes.toString('base64') });
        };
        const conversations = [];
        for (const session of all.filter(item => requested.has(String(item.id)))) {
            const portable = await portableSession(session, warnings, async reference => {
                let url: URL;
                try { url = new URL(reference.uri); } catch { throw new ConversationArchiveError('ARCHIVE_ATTACHMENT_MISSING', 'archive_attachment_uri_missing'); }
                if (url.protocol !== 'file:' || url.hostname) throw new ConversationArchiveError('ARCHIVE_UNSAFE', 'archive_attachment_uncontrolled');
                const info = await lstat(fileURLToPath(url)).catch((error: NodeJS.ErrnoException) => {
                    if (error?.code === 'ENOENT') return undefined;
                    throw new ConversationArchiveError('ARCHIVE_ATTACHMENT_MISSING', 'archive_attachment_missing');
                });
                if (info && (!info.isFile() || info.isSymbolicLink() || info.size > CONVERSATION_ARCHIVE_ATTACHMENT_MAX_BYTES)) {
                    throw new ConversationArchiveError('ARCHIVE_UNSAFE', 'archive_attachment_unsafe_or_large');
                }
                let bytes: Buffer;
                try {
                    bytes = Buffer.from(await this.options.readAttachment(session, reference));
                } catch (error) {
                    const code = (error as NodeJS.ErrnoException)?.code;
                    if (code === 'ENOENT' || code === 'ATTACHMENT_READ_UNAVAILABLE') {
                        throw new ConversationArchiveError('ARCHIVE_ATTACHMENT_MISSING', 'archive_attachment_missing');
                    }
                    throw error;
                }
                if (bytes.length > CONVERSATION_ARCHIVE_ATTACHMENT_MAX_BYTES) throw new ConversationArchiveError('ARCHIVE_UNSAFE', 'archive_attachment_unsafe_or_large');
                if ((info && bytes.length !== info.size) || (reference.size !== undefined && reference.size !== bytes.length)) throw new ConversationArchiveError('ARCHIVE_CHANGED', 'archive_attachment_metadata_mismatch');
                const sha256 = hash(bytes);
                const suffix = extname(reference.name).slice(1).toLowerCase();
                const extension = /^[a-z0-9]{1,12}$/.test(suffix) ? suffix : 'bin';
                const path = `attachments/${sha256}.${extension}`;
                addFile(path, bytes);
                const { uri: _uri, workspaceRelativePath: _binding, ...metadata } = reference;
                return { ...metadata, size: bytes.length, uri: path };
            }, async (parts, sourceOwnerId) => {
                usesOutputParts = true;
                const media = parts.filter((part): part is Extract<AgentOutputPart, { readonly type: 'image' | 'audio' }> => part.type !== 'text');
                if (media.length && !sourceOwnerId) {
                    throw new ConversationArchiveError('ARCHIVE_ATTACHMENT_MISSING', 'archive_output_owner_missing');
                }
                if (media.length) {
                    const { readAgentOutputAsset } = await import('./nextmux-agent-output-assets.js');
                    for (const part of media) {
                        let loaded;
                        try {
                            loaded = await readAgentOutputAsset(this.options.outputAssetDataRoot?.(sourceOwnerId!) || this.outputAssetDataRoot(), sourceOwnerId!, part.asset);
                        } catch {
                            throw new ConversationArchiveError('ARCHIVE_ATTACHMENT_MISSING', 'archive_output_missing');
                        }
                        if (loaded.sha256 !== part.asset.sha256 || loaded.mimeType !== part.asset.mimeType
                            || loaded.sizeBytes !== part.asset.sizeBytes) invalid('archive_output_metadata_mismatch');
                        const bytes = Buffer.from(loaded.dataBase64, 'base64');
                        addFile(outputAssetPath(part.asset, part.type), bytes);
                    }
                }
                // Local owner/run identifiers are deliberately not exported. Import assigns the new conversation id.
                return { outputParts: parts };
            });
            const ref = grouping.bySession.get(String(session.id));
            conversations.push({ ...portable, ...(ref ? { projectRef: ref } : {}) });
        }
        const projects = grouping.projects.length ? grouping.projects : undefined;
        const version = usesOutputParts ? CONVERSATION_ARCHIVE_OUTPUT_ASSET_VERSION
            : projects ? CONVERSATION_ARCHIVE_PROJECT_VERSION : CONVERSATION_ARCHIVE_VERSION;
        const document: ArchiveDocument = { format: CONVERSATION_ARCHIVE_FORMAT, version, minimumReaderVersion: version,
            createdAt: Date.now(), contentSha256: contentHash(conversations, [...files.values()], projects), conversations, files: [...files.values()], warnings: [...warnings],
            ...(projects ? { projects } : {}) };
        const bytes = Buffer.from(JSON.stringify(document));
        if (bytes.length > CONVERSATION_ARCHIVE_MAX_BYTES) throw new ConversationArchiveError('ARCHIVE_TOO_LARGE', 'archive_archive_limit');
        const requestedTarget = resolve(destinationPath);
        if ((await lstat(dirname(requestedTarget))).isSymbolicLink()) throw new ConversationArchiveError('ARCHIVE_UNSAFE', 'archive_export_directory_symlink');
        const parent = await realpath(dirname(requestedTarget));
        const target = join(parent, basename(requestedTarget));
        const temporary = join(parent, `.nextmux-archive-${randomUUID()}.tmp`);
        const handle = await open(temporary, 'wx', 0o600);
        try {
            await handle.writeFile(bytes); await handle.sync(); await handle.close();
            // Atomic where hard links are supported; bounded exclusive write on exFAT.
            await publishConversationArchiveFile(temporary, target, bytes);
        } finally { await handle.close().catch(() => undefined); await unlink(temporary).catch(() => undefined); }
        return { path: target, sha256: hash(bytes), bytes: bytes.length, conversations: conversations.length, attachments: files.size, warnings: [...warnings] };
    }

    async previewFile(sourcePath: string): Promise<ConversationArchivePreview> {
        const path = resolve(sourcePath);
        const { document, bytes, sha256 } = await this.readArchive(path);
        const existing = await this.options.store.snapshot();
        const ids = new Set(existing.map(session => String(session.id)));
        for (const [key, receipt] of this.previews) if (receipt.expiresAt < Date.now()) this.previews.delete(key);
        if (this.previews.size >= 8) this.previews.delete(this.previews.keys().next().value!);
        const previewId = randomUUID();
        this.previews.set(previewId, { path, sha256, idsDigest: conversationIdsDigest([...ids]), expiresAt: Date.now() + previewLifetime });
        return this.projectPreview(previewId, document, bytes, sha256, ids);
    }

    /** A replaced mapping invalidates the old confirmation; raw paths are never accepted at import. */
    async prepareBindings(previewId: string, bindings: readonly ConversationArchiveProjectBinding[]): Promise<ConversationArchivePreview> {
        const receipt = this.requirePreview(previewId);
        this.previews.delete(previewId);
        const { document, bytes, sha256 } = await this.readArchive(receipt.path);
        if (sha256 !== receipt.sha256) throw new ConversationArchiveError('ARCHIVE_CHANGED', 'archive_preview_archive_changed');
        const existing = await this.options.store.snapshot();
        const ids = new Set(existing.map(session => String(session.id)));
        if (conversationIdsDigest([...ids]) !== receipt.idsDigest) throw new ConversationArchiveError('ARCHIVE_CHANGED', 'archive_preview_list_changed');
        const known = new Set(document.projects?.map(project => project.ref));
        const chosen = new Map<string, ArchiveDirectoryBinding>();
        const seen = new Set<string>();
        if (!Array.isArray(bindings)) invalid('archive_bindings_list_invalid');
        // Validate the entire request before inspecting any explicitly chosen directory.
        const validated = list(bindings, CONVERSATION_ARCHIVE_MAX_PROJECTS).map(value => {
            if (!object(value) || Object.keys(value).some(key => !['projectRef', 'directoryUri'].includes(key))) invalid('archive_binding_options_invalid');
            const ref = projectRef(value.projectRef);
            if (!known.has(ref) || seen.has(ref) || value.directoryUri !== null && typeof value.directoryUri !== 'string') invalid('archive_binding_project_invalid');
            seen.add(ref);
            return { ref, uri: value.directoryUri as string | null };
        });
        for (const value of validated) if (value.uri !== null) chosen.set(value.ref, await captureArchiveDirectoryBinding(value.uri));
        const nextId = randomUUID();
        this.previews.set(nextId, { ...receipt, bindings: chosen });
        return this.projectPreview(nextId, document, bytes, sha256, ids, chosen);
    }

    private requirePreview(previewId: string): PreviewReceipt {
        const receipt = this.previews.get(previewId);
        if (!receipt || receipt.expiresAt < Date.now()) throw new ConversationArchiveError('ARCHIVE_PREVIEW_EXPIRED', 'archive_preview_expired');
        if (this.busyPreviews.has(previewId)) throw new ConversationArchiveError('ARCHIVE_PREVIEW_BUSY', 'archive_preview_busy');
        return receipt;
    }

    private projectPreview(
        previewId: string, document: ArchiveDocument, bytes: number, sha256: string, ids: ReadonlySet<string>,
        bindings?: ReadonlyMap<string, ArchiveDirectoryBinding>
    ): ConversationArchivePreview {
        return { previewId, sha256, bytes, attachments: document.files.length, attachmentBytes: document.files.reduce((total, file) => total + file.size, 0),
            ...(document.projects ? { projects: document.projects.map(project => {
                const binding = bindings?.get(project.ref);
                return { ...project, conversations: document.conversations.filter(session => session.projectRef === project.ref).length,
                    binding: binding ? { kind: 'local_directory' as const, directoryUri: binding.directoryUri, directoryPath: binding.directoryPath }
                        : { kind: 'owned_workspace' as const } };
            }) } : {}),
            warnings: document.warnings, conversations: document.conversations.map(session => {
                const copyId = conversationArchiveCopyId(sha256, String(session.id));
                return { id: String(session.id), title: String(session.title), ...(session.titleOrigin === 'default' || session.titleOrigin === 'draft' || session.titleOrigin === 'recoveredDraft' ? { titleOrigin: session.titleOrigin as 'default' | 'draft' | 'recoveredDraft' } : {}), turns: (session.turns as unknown[]).length,
                    attachments: (session.turns as RecordValue[]).reduce((count, turn) => count + (turn.attachments as unknown[]).length, (session.draftAttachments as unknown[]).length),
                    conflict: ids.has(String(session.id)), copyId, copyConflict: ids.has(copyId),
                    ...(session.projectRef ? { projectRef: String(session.projectRef) } : {}) };
            }) };
    }

    async importPreview(previewId: string, conflictPolicy: 'skip' | 'copy'): Promise<ConversationArchiveImportResult> {
        const receipt = this.requirePreview(previewId);
        if (!['skip', 'copy'].includes(conflictPolicy)) invalid('archive_conflict_policy_invalid');
        this.busyPreviews.add(previewId);
        const created: string[] = [];
        const createdOutputFiles = new Set<string>();
        const createdOutputDirectories = new Set<string>();
        const boundDirectories = new Set<string>();
        try {
            const { document, sha256 } = await this.readArchive(receipt.path);
            if (sha256 !== receipt.sha256) throw new ConversationArchiveError('ARCHIVE_CHANGED', 'archive_preview_archive_changed');
            const result = await this.options.store.insertArchiveSessions(document.conversations,
                { archiveSha256: sha256, conflictPolicy, expectedIdsDigest: receipt.idsDigest }, async selected => {
                    if (receipt.expiresAt < Date.now()) throw new ConversationArchiveError('ARCHIVE_PREVIEW_EXPIRED', 'archive_preview_expired');
                    const projects = new Map(document.projects?.map(project => [project.ref, project]));
                    const selectedBindings = new Map<string, ArchiveDirectoryBinding>();
                    for (const session of selected) {
                        const ref = String(session.projectRef ?? '');
                        const binding = receipt.bindings?.get(ref);
                        if (binding) selectedBindings.set(ref, binding);
                    }
                    for (const binding of selectedBindings.values()) await verifyArchiveDirectoryBinding(binding);
                    const root = resolve(this.options.attachmentRoot);
                    await mkdir(dirname(root), { recursive: true, mode: 0o700 });
                    if ((await lstat(dirname(root))).isSymbolicLink()) throw new ConversationArchiveError('ARCHIVE_UNSAFE', 'archive_attachment_ancestor_symlink');
                    await mkdir(root, { recursive: true, mode: 0o700 });
                    if ((await lstat(root)).isSymbolicLink() || !(await lstat(root)).isDirectory()) throw new ConversationArchiveError('ARCHIVE_UNSAFE', 'archive_attachment_directory_symlink');
                    const blobs = new Map(document.files.map(file => [file.path, file]));
                    const installed = new Map<string, string>();
                    const result = [];
                    for (const session of selected) {
                        const portable = await portableSession(session, new Set(), async reference => {
                            const file = blobs.get(reference.uri)!;
                            let target = installed.get(file.path);
                            if (!target) {
                                const extension = attachmentFilePattern.exec(file.path)![2];
                                target = join(root, `${file.sha256}-${randomUUID()}.${extension}`);
                                const handle = await open(target, 'wx', 0o600);
                                created.push(target);
                                try { await handle.writeFile(Buffer.from(file.dataBase64, 'base64')); await handle.sync(); } finally { await handle.close(); }
                                installed.set(file.path, target);
                            }
                            return { ...reference, uri: pathToFileURL(target).toString(), size: file.size };
                        }, async parts => {
                            const ownerId = outputOwner(String(session.id))!;
                            const raw: OfficialModelOutputPart[] = parts.map(part => {
                                if (part.type === 'text') return { type: 'text', text: part.text };
                                const file = blobs.get(outputAssetPath(part.asset, part.type));
                                if (!file || file.sha256 !== part.asset.sha256 || file.size !== part.asset.sizeBytes) {
                                    invalid('archive_output_manifest_mismatch');
                                }
                                return { type: part.type, mimeType: part.asset.mimeType,
                                    sizeBytes: file.size, dataBase64: file.dataBase64 } as OfficialModelOutputPart;
                            });
                            const media = parts.filter((part): part is Extract<AgentOutputPart, { readonly type: 'image' | 'audio' }> => part.type !== 'text');
                            if (!media.length) return { outputParts: parts };
                            const dataRoot = this.outputAssetDataRoot();
                            const targets = media.map(part => outputStoragePath(dataRoot, ownerId, part.asset, part.type));
                            const absent = new Set<string>();
                            for (const target of targets) {
                                try {
                                    const info = await lstat(target);
                                    if (!info.isFile() || info.isSymbolicLink()) throw new ConversationArchiveError('ARCHIVE_UNSAFE', 'archive_output_directory_unsafe');
                                } catch (error) {
                                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') absent.add(target);
                                    else throw error;
                                }
                            }
                            const ownerDirectory = targets.length ? dirname(targets[0]) : undefined;
                            let ownerDirectoryExisted = true;
                            if (ownerDirectory) {
                                try { await lstat(ownerDirectory); }
                                catch (error) {
                                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') ownerDirectoryExisted = false;
                                    else throw error;
                                }
                            }
                            let persisted: readonly AgentOutputPart[];
                            try {
                                const { persistAgentOutputParts } = await import('./nextmux-agent-output-assets.js');
                                persisted = await persistAgentOutputParts(dataRoot, ownerId, raw);
                            } finally {
                                for (const target of absent) {
                                    const info = await lstat(target).catch(() => undefined);
                                    if (info?.isFile() && !info.isSymbolicLink()) createdOutputFiles.add(target);
                                }
                                if (ownerDirectory && !ownerDirectoryExisted) createdOutputDirectories.add(ownerDirectory);
                            }
                            if (JSON.stringify(persisted) !== JSON.stringify(parts)) invalid('archive_output_install_mismatch');
                            return { outputParts: persisted, ...(media.length ? { outputAssetOwnerId: ownerId } : {}) };
                        });
                        const project = projects.get(String(session.projectRef ?? ''));
                        const binding = project && selectedBindings.get(project.ref);
                        if (binding) boundDirectories.add(binding.directoryUri);
                        result.push({ ...portable,
                            ...(project ? { archiveProject: { sourceSha256: sha256, ref: project.ref, label: project.label } } : {}),
                            ...(binding ? { workspacePath: binding.directoryPath, ownedWorkspace: false } : {}) });
                    }
                    // Recheck after attachment preparation, immediately before the existing manifest commit.
                    for (const binding of selectedBindings.values()) await verifyArchiveDirectoryBinding(binding);
                    return result;
                });
            this.previews.delete(previewId);
            return { ...result, ...(boundDirectories.size ? { boundDirectories: [...boundDirectories] } : {}) };
        } catch (error) {
            if (error instanceof ArchiveProjectBindingError) this.previews.delete(previewId);
            await Promise.all([...created, ...createdOutputFiles].map(path => unlink(path).catch(() => undefined)));
            await Promise.all([...createdOutputDirectories].map(path => rmdir(path).catch(() => undefined)));
            throw error;
        } finally { this.busyPreviews.delete(previewId); }
    }

    private async readArchive(path: string): Promise<{ readonly document: ArchiveDocument; readonly bytes: number; readonly sha256: string }> {
        const bytes = await readRegularFile(path, CONVERSATION_ARCHIVE_MAX_BYTES);
        if (bytes[0] !== 123) invalid('archive_format_unsupported');
        let parsed: unknown;
        try { parsed = JSON.parse(bytes.toString('utf8')); } catch { invalid('archive_json_corrupt'); }
        validateJsonShape(parsed);
        if (!object(parsed) || parsed.format !== CONVERSATION_ARCHIVE_FORMAT) invalid('archive_format_invalid');
        if (parsed.version !== CONVERSATION_ARCHIVE_VERSION && parsed.version !== CONVERSATION_ARCHIVE_PROJECT_VERSION
            && parsed.version !== CONVERSATION_ARCHIVE_OUTPUT_ASSET_VERSION
            || parsed.version !== parsed.minimumReaderVersion) throw new ConversationArchiveError('ARCHIVE_VERSION', 'archive_version_unsupported');
        const version = parsed.version as 1 | 2 | 3;
        if (version >= 2 && Object.keys(parsed).some(key => !['format', 'version', 'minimumReaderVersion', 'createdAt', 'contentSha256', 'conversations', 'files', 'warnings', 'projects'].includes(key))) invalid('archive_fields_unknown');
        if (version === 1 && parsed.projects !== undefined) invalid('archive_legacy_bindings_invalid');
        const projects = version >= 2 && parsed.projects !== undefined ? archiveProjects(parsed.projects) : undefined;
        if (version === 2 && !projects?.length) invalid('archive_project_labels_missing');
        if (version === 3 && parsed.projects !== undefined && !projects?.length) invalid('archive_project_labels_missing');
        timestamp(parsed.createdAt);
        const files = new Map<string, ArchiveFile>();
        let total = 0;
        for (const value of list(parsed.files, CONVERSATION_ARCHIVE_MAX_ATTACHMENTS)) {
            if (!object(value) || typeof value.path !== 'string') invalid('archive_resource_path_invalid');
            const attachmentMatch = attachmentFilePattern.exec(value.path);
            const outputMatch = version === 3 ? outputAssetFilePattern.exec(value.path) : undefined;
            if ((!attachmentMatch && !outputMatch) || (attachmentMatch || outputMatch)![1] !== value.sha256
                || files.has(value.path)) invalid('archive_resource_path_invalid');
            const size = timestamp(value.size);
            if (size > CONVERSATION_ARCHIVE_ATTACHMENT_MAX_BYTES || (total += size) > CONVERSATION_ARCHIVE_ATTACHMENTS_MAX_BYTES) throw new ConversationArchiveError('ARCHIVE_TOO_LARGE', 'archive_resource_limit');
            if (typeof value.dataBase64 !== 'string' || value.dataBase64.length !== Math.ceil(size / 3) * 4
                || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.dataBase64)) invalid('archive_resource_encoding_invalid');
            const decoded = Buffer.from(value.dataBase64, 'base64');
            if (decoded.length !== size || hash(decoded) !== value.sha256 || decoded.toString('base64') !== value.dataBase64) invalid('archive_resource_integrity_failed');
            files.set(value.path, { path: value.path, sha256: String(value.sha256), size, dataBase64: value.dataBase64 });
        }
        if (!Array.isArray(parsed.conversations) || contentHash(parsed.conversations, [...files.values()], projects) !== parsed.contentSha256) invalid('archive_content_integrity_failed');
        const knownWarnings = new Set([privacyWarning, runtimeWarning, projectWarning, 'hidden_reasoning_omitted', 'runtime_activity_metadata_omitted', 'unsent_queue_omitted', 'unsent_child_drafts_omitted']);
        const warnings = new Set([privacyWarning, runtimeWarning, ...list(parsed.warnings, 20).map(warning => text(warning, 200)).filter(warning => knownWarnings.has(warning))]);
        if (projects) warnings.add(projectWarning);
        const conversations = [];
        const ids = new Set<string>();
        const referenced = new Set<string>();
        const referencedProjects = new Set<string>();
        const projectRefs = new Set(projects?.map(project => project.ref));
        let sawOutputParts = false;
        for (const value of list(parsed.conversations, CONVERSATION_ARCHIVE_MAX_CONVERSATIONS)) {
            if (object(value)) for (const rawTurn of list(value.turns, 100_000)) {
                if (object(rawTurn) && (rawTurn.outputAssetOwnerId !== undefined
                    || version !== 3 && rawTurn.outputParts !== undefined)) {
                    invalid('archive_output_local_owner_invalid');
                }
            }
            const session = await portableSession(value, warnings, async reference => {
                const file = files.get(reference.uri);
                if (!attachmentFilePattern.test(reference.uri) || !file || reference.workspaceRelativePath !== undefined || reference.size !== file.size) invalid('archive_attachment_manifest_mismatch');
                referenced.add(file.path);
                return { ...reference, size: file.size };
            }, async (parts, sourceOwnerId) => {
                if (version !== 3 || sourceOwnerId !== undefined) invalid('archive_output_owner_version_invalid');
                sawOutputParts = true;
                for (const part of parts) {
                    if (part.type === 'text') continue;
                    const file = files.get(outputAssetPath(part.asset, part.type));
                    if (!file || file.size !== part.asset.sizeBytes) invalid('archive_output_manifest_mismatch');
                    referenced.add(file.path);
                }
                return { outputParts: parts };
            });
            if (object(value) && value.projectRef !== undefined) {
                const ref = projectRef(value.projectRef);
                if (version === 1 || !projectRefs.has(ref)) invalid('archive_project_reference_unknown');
                session.projectRef = ref;
                referencedProjects.add(ref);
            }
            if (ids.has(String(session.id))) invalid('archive_session_id_duplicate');
            ids.add(String(session.id)); conversations.push(session);
        }
        if (!conversations.length || referenced.size !== files.size || referencedProjects.size !== projectRefs.size
            || version === 3 && !sawOutputParts) invalid('archive_archive_inconsistent');
        return { bytes: bytes.length, sha256: hash(bytes), document: { format: CONVERSATION_ARCHIVE_FORMAT, version, minimumReaderVersion: version,
            createdAt: Number(parsed.createdAt), contentSha256: String(parsed.contentSha256), files: [...files.values()], conversations, warnings: [...warnings],
            ...(projects ? { projects } : {}) } };
    }
}
