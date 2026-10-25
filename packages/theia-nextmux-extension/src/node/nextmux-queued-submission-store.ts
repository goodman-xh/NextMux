import { createHash, randomUUID } from 'crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'fs/promises';
import { join } from 'path';
import type { DesktopAgentRunStartResult, DesktopQueuedSubmissionStatus } from '../common/nextmux-platform-protocol';
import type { AgentRunEvent } from '@nextmux/agent-runtime';

/** A transport's explicit rejection, before it accepted a model request. */
export function queuedModelRequestWasRejected(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as Record<string, unknown>;
    const code = typeof value.code === 'string' ? value.code.toUpperCase() : '';
    if (value.partial === true || value.providerAccepted === true || value.acceptanceUnknown === true
        || value.usageKnown !== undefined || value.visibleOutputStarted === true || value.toolCallStarted === true
        || value.reasoningStarted === true || code.startsWith('BILLING_')
        || String(value.recoveryMode || '').startsWith('billing_')) return false;
    if (value.stage !== undefined && value.stage !== 'validation' && value.stage !== 'response') return false;
    // PlatformRequestError sets this only when it has paid/unknown evidence.
    // OfficialModelError also defaults it to false for non-retryable 4xx errors.
    const status = Number(value.httpStatus ?? value.status);
    // A proved local admission refusal is not paid/unknown evidence or permission to replay.
    if (code === 'WALLET_REQUEST_BUDGET_UNAVAILABLE') return status === 409
        && value.providerAccepted === false && value.localPolicy === true;
    if (value.stage === undefined && value.retrySafe === false) return false;
    if (['CONNECTION_NOT_FOUND', 'API_KEY_MISSING', 'API_KEY_REQUIRED', 'INVALID_API_KEY', 'MODEL_NOT_DISCOVERED',
        'INVALID_MODEL_ROUTE', 'NO_AVAILABLE_ROUTE', 'NO_AVAILABLE_MODEL', 'ROUTE_UNAVAILABLE', 'ROUTE_PRIVACY_UNAVAILABLE'].includes(code)) return true;
    if (['WALLET_BALANCE_INSUFFICIENT', 'INSUFFICIENT_BALANCE'].includes(code)) return status === 402;
    // The managed gateway maps upstream 401/403/404 refusals to 502 and
    // upstream insufficient balance to 503. These exact codes retain that proof.
    if (['UPSTREAM_CREDENTIAL_INVALID', 'UPSTREAM_MODEL_UNSUPPORTED', 'UPSTREAM_REJECTED'].includes(code)
        && value.stage === undefined) return status === 502;
    if (code === 'UPSTREAM_BALANCE_UNAVAILABLE' && value.stage === undefined) return status === 503;
    if (['AUTH_FAILED', 'MODEL_AUTH', 'UPSTREAM_CREDENTIAL_INVALID'].includes(code)) return status === 401 || status === 403;
    return ['MODEL_NOT_FOUND', 'MODEL_UNAVAILABLE', 'REQUEST_REJECTED', 'UPSTREAM_MODEL_UNSUPPORTED'].includes(code)
        && (status === 400 || status === 404);
}

/** Missing/evicted history is never proof that a previous attempt was free. */
export function queuedRunHasNoAcceptedWork(snapshot: { readonly firstEventIndex: number; readonly events: readonly AgentRunEvent[] }): boolean {
    return snapshot.firstEventIndex === 0 && snapshot.events.every(event =>
        event.type === 'backend_selected' && event.backendId === 'builtin' && event.attempt === 1
        || event.type === 'model_started' && event.turn === 1
        || event.type === 'model_phase' && event.turn === 1 && event.phase === 'failed'
        || event.type === 'model_attempt_completed' && event.turn === 1 && event.attempt === 1 && event.outcome === 'failed');
}

interface Receipt {
    readonly version: 1;
    readonly conversationId: string;
    readonly requestId: string;
    readonly fingerprint: string;
    readonly status: DesktopQueuedSubmissionStatus;
}

/** Local acceptance receipts contain identities and hashes, never prompts or credentials.
 * Reservations survive restart and are never replayed merely because an ACK was lost.
 */
export class QueuedSubmissionStore {
    constructor(private readonly directory: string) {}

    private async path(conversationId: string, requestId: string): Promise<string> {
        if (!conversationId || conversationId.length > 200 || !/^[a-zA-Z0-9._:-]{8,180}$/.test(requestId)) {
            throw new Error('AGENT_SUBMISSION_ID_INVALID');
        }
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const metadata = await lstat(this.directory);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('AGENT_SUBMISSION_STORE_UNSAFE');
        const key = createHash('sha256').update(`${conversationId}\0${requestId}`).digest('hex');
        return join(this.directory, `${key}.json`);
    }

    private async read(path: string): Promise<Receipt | undefined> {
        const metadata = await lstat(path).catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw error;
        });
        if (!metadata) return undefined;
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4096) throw new Error('AGENT_SUBMISSION_RECEIPT_UNSAFE');
        const record: Receipt = JSON.parse(await readFile(path, 'utf8'));
        if (record.version !== 1 || !record.fingerprint || !record.conversationId || !record.requestId
            || !['pending', 'accepted', 'rejected'].includes(record.status?.state)
            || record.status.state === 'accepted' && !record.status.runId) throw new Error('AGENT_SUBMISSION_RECEIPT_INVALID');
        return record;
    }

    async lookup(conversationId: string, requestId: string): Promise<DesktopQueuedSubmissionStatus> {
        const record = await this.read(await this.path(conversationId, requestId));
        if (record && (record.conversationId !== conversationId || record.requestId !== requestId)) throw new Error('AGENT_SUBMISSION_OWNER_MISMATCH');
        // Absence is not proof of rejection: the original RPC might still be in flight.
        return record?.status || { state: 'unknown' };
    }

    private async commit(path: string, record: Receipt): Promise<void> {
        const temporary = `${path}.tmp-${randomUUID()}`;
        try {
            const file = await open(temporary, 'wx', 0o600);
            try { await file.writeFile(JSON.stringify(record)); await file.sync(); }
            finally { await file.close(); }
            await rename(temporary, path);
        } finally { await unlink(temporary).catch(() => undefined); }
    }

    async dispatch(
        conversationId: string,
        requestId: string,
        request: unknown,
        start: (accept: (result: DesktopAgentRunStartResult) => Promise<void>) => Promise<DesktopAgentRunStartResult>
    ): Promise<DesktopAgentRunStartResult> {
        const path = await this.path(conversationId, requestId);
        const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
        const record: Receipt = { version: 1, conversationId, requestId, fingerprint, status: { state: 'pending' } };
        // Exclusive reservation works across RPC connections/processes. A crash
        // during this write leaves an unknown receipt, which also fails closed.
        let reservation;
        try { reservation = await open(path, 'wx', 0o600); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const existing = await this.read(path);
            if (existing?.fingerprint !== fingerprint) throw new Error('AGENT_SUBMISSION_CONFLICT');
            if (existing.status.state === 'accepted') return { runId: existing.status.runId };
            throw new Error(existing.status.state === 'rejected' ? 'AGENT_SUBMISSION_REJECTED' : 'AGENT_SUBMISSION_PENDING');
        }
        try { await reservation.writeFile(JSON.stringify(record)); await reservation.sync(); }
        finally { await reservation.close(); }
        let accepted = false;
        try {
            return await start(async result => {
                await this.commit(path, { ...record, status: { state: 'accepted', runId: result.runId } });
                accepted = true;
            });
        } catch (error) {
            if (!accepted) await this.commit(path, { ...record, status: { state: 'rejected' } }).catch(() => undefined);
            throw error;
        }
    }
}
