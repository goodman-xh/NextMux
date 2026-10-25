/** Finite observation of one already accepted original task. Never selects, fetches or persists a URL. */
import { createHash } from 'node:crypto';
import type { MediaJob } from '@nextmux/media-core';
import { mediaTaskId, mediaTaskState, readField, type MediaApiTemplate } from '@nextmux/model-runtime/media-template';

export const ORIGINAL_ASSET_LINK_DIAGNOSTIC_PREFIX = '[NextMux:original-asset-link-metadata]';
export const ORIGINAL_ASSET_LINK_DIAGNOSTIC_MAX_BYTES = 12 * 1024;
const LINK_KEYS = ['video_url', 'videoUrl', 'image_url', 'imageUrl', 'audio_url', 'audioUrl', 'music_url', 'musicUrl', 'url', 'file_url', 'download_url', 'uri', 'video', 'videos', 'image', 'images', 'audio', 'music', 'output', 'outputs', 'result', 'results', 'urls', 'data'] as const;
const CONTROL_KEYS = new Set(['status_url', 'statusurl', 'response_url', 'responseurl', 'poll_url', 'pollurl', 'cancel_url', 'cancelurl', 'result_url', 'resulturl', 'request_url', 'requesturl', 'logs_url', 'logsurl', 'get', 'cancel', 'stream']);
const LIMITS = { depth: 6, arrayItems: 20, objectKeys: 40, nodes: 256, candidates: 32, urlCharacters: 8192 } as const;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

interface OriginalAcceptedLinkContext {
    readonly jobId: string;
    readonly attempt: number;
    readonly templateSha256: string;
    readonly scopeSha256: string;
    readonly taskId: string;
    readonly payloadHash: string;
    readonly inputSha256: string;
}
interface LinkMetadata {
    readonly fieldPath: string;
    readonly scheme: 'http' | 'https';
    readonly hostSha256: string;
    readonly urlSha256: string;
    readonly hasUserinfo: boolean;
    readonly hasFragment: boolean;
}
function ownValue(value: unknown, key: string): unknown {
    if (!value || typeof value !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
}
function scopeFingerprint(job: MediaJob): string {
    return hash(JSON.stringify([job.status, job.kind, job.cost.billing, job.failure?.code, job.failure?.retryable,
        Boolean(job.output), Boolean(job.checkpoint), job.cancelRequestedAt, job.restoredHistoryOnly, job.maxAttempts]));
}

/** The existing caller's accepted-recovery predicate is authoritative; this adds no new recovery eligibility. */
export function captureOriginalAcceptedLinkContext(
    job: MediaJob, template: MediaApiTemplate, acceptedOriginalRecovery: boolean
): OriginalAcceptedLinkContext | undefined {
    try {
        if (!acceptedOriginalRecovery || !job.remoteTask?.taskId) return undefined;
        return { jobId: job.id, taskId: job.remoteTask.taskId, payloadHash: job.payloadHash, attempt: job.attempt,
            templateSha256: hash(JSON.stringify(template)), scopeSha256: scopeFingerprint(job), inputSha256: hash(JSON.stringify(job.input)) };
    } catch { return undefined; }
}

function projectKnownLinks(payload: unknown, resultRoot: unknown): unknown {
    const rows: LinkMetadata[] = [];
    const topology = { objects: 0, arrays: 0, strings: 0, scalars: 0, nodes: 0, unknownKeysSkipped: 0,
        controlKeysSkipped: 0, invalidLinkStrings: 0, accessorFieldsSkipped: 0, boundHits: 0 };
    const active = new Set<object>();
    const visit = (value: unknown, fieldPath: string, depth: number): void => {
        if (depth > LIMITS.depth || topology.nodes >= LIMITS.nodes) { topology.boundHits++; return; }
        topology.nodes++;
        if (typeof value === 'string') {
            topology.strings++;
            if (!/^https?:\/\/\S+$/i.test(value.trim())) return;
            if (value.length > LIMITS.urlCharacters || rows.length >= LIMITS.candidates) { topology.boundHits++; return; }
            let url: URL;
            try { url = new URL(value.trim()); } catch { topology.invalidLinkStrings++; return; }
            if (!url.hostname || !['http:', 'https:'].includes(url.protocol)) { topology.invalidLinkStrings++; return; }
            rows.push({ fieldPath, scheme: url.protocol === 'https:' ? 'https' : 'http', hostSha256: hash(url.hostname.toLowerCase()),
                urlSha256: hash(url.href), hasUserinfo: Boolean(url.username || url.password), hasFragment: Boolean(url.hash) });
            return;
        }
        if (!value || typeof value !== 'object') { topology.scalars++; return; }
        if (active.has(value)) { topology.boundHits++; return; }
        active.add(value);
        if (Array.isArray(value)) {
            topology.arrays++;
            if (value.length > LIMITS.arrayItems) topology.boundHits++;
            for (let index = 0; index < Math.min(value.length, LIMITS.arrayItems); index++) visit(ownValue(value, String(index)), `${fieldPath}[${index}]`, depth + 1);
        } else {
            topology.objects++;
            const keys = Object.getOwnPropertyNames(value);
            if (keys.length > LIMITS.objectKeys) topology.boundHits++;
            for (const key of keys.slice(0, LIMITS.objectKeys)) {
                if (CONTROL_KEYS.has(key.toLowerCase())) topology.controlKeysSkipped++;
                else if (!(LINK_KEYS as readonly string[]).includes(key)) topology.unknownKeysSkipped++;
            }
            for (const key of LINK_KEYS) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor) continue;
                if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) { topology.accessorFieldsSkipped++; continue; }
                visit(descriptor.value, `${fieldPath}.${key}`, depth + 1);
            }
        }
        active.delete(value);
    };
    visit(resultRoot, '$configuredResult', 0);
    visit(payload, '$fallback', 0);
    return { schema: 1, scope: 'accepted_original_completed_GET_known_link_metadata_only', rows, topology,
        uniqueCandidateCount: new Set(rows.map(row => row.urlSha256)).size,
        httpsCandidateCount: new Set(rows.filter(row => row.scheme === 'https').map(row => row.urlSha256)).size,
        boundedAllowlistedTraversalComplete: topology.boundHits === 0 && topology.accessorFieldsSkipped === 0,
        arbitraryParserFallbackFullyInspected: topology.unknownKeysSkipped === 0 && topology.boundHits === 0
            && topology.accessorFieldsSkipped === 0 && topology.invalidLinkStrings === 0,
        rawUrlsPathsQueriesPromptsPayloadCredentialsStored: false, candidatesAuthorizeNetworkOrSelection: false };
}

/** Called only beside the existing original-task preflight; all observation failures are ignored. */
export function observeOriginalAcceptedLinkMetadata(
    payload: unknown, job: MediaJob, template: MediaApiTemplate, captured: OriginalAcceptedLinkContext | undefined,
    emit: (prefix: string, serializedMetadata: string) => void
): void {
    try {
        if (!captured || captured.jobId !== job.id || captured.taskId !== job.remoteTask?.taskId || captured.attempt !== job.attempt
            || captured.payloadHash !== job.payloadHash || captured.inputSha256 !== hash(JSON.stringify(job.input))
            || captured.scopeSha256 !== scopeFingerprint(job) || captured.templateSha256 !== hash(JSON.stringify(template))
            || template.poll.method !== 'GET'
            || mediaTaskState(payload, template) !== 'completed' || mediaTaskId(payload, template) !== captured.taskId) return;
        let serialized = JSON.stringify(projectKnownLinks(payload, template.resultField ? readField(payload, template.resultField) : payload));
        if (Buffer.byteLength(ORIGINAL_ASSET_LINK_DIAGNOSTIC_PREFIX + ' ' + serialized + '\n', 'utf8') > ORIGINAL_ASSET_LINK_DIAGNOSTIC_MAX_BYTES) {
            serialized = '{"schema":1,"scope":"accepted_original_completed_GET_known_link_metadata_only","metadataOmitted":true,"reason":"byte_cap"}';
        }
        emit(ORIGINAL_ASSET_LINK_DIAGNOSTIC_PREFIX, serialized);
    } catch { /* Diagnostics cannot hide an auth/TLS/asset failure or alter the recovery. */ }
}
