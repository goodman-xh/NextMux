import { randomUUID } from 'node:crypto';
import { WebSocket as UndiciWebSocket } from 'undici';

export interface ManagedSessionWebSocket {
    readonly readyState: number;
    addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: any) => void): void;
    removeEventListener?(type: 'open' | 'message' | 'error' | 'close', listener: (event: any) => void): void;
    send(data: string): void;
    close(code?: number, reason?: string): void;
}

export type ManagedSessionWebSocketConstructor = new (url: string, options?: { readonly headers?: Record<string, string> }) => ManagedSessionWebSocket;

export interface ManagedSessionPoolOptions {
    readonly baseUrl: string;
    readonly deviceId: () => Promise<string>;
    readonly deviceRoute?: () => Promise<string | undefined>;
    readonly connectTimeoutMs?: number;
    readonly maxReconnects?: number;
    /**
     * How long a disconnected session may keep trying to rebind its active
     * tasks. A reconnect must not turn a transient network outage into a
     * second inference request, but a small fixed attempt count is too short
     * for long-running sessions on mobile networks or sleep/wake.
     */
    readonly reconnectGraceMs?: number;
    /** Keep the server-side lease alive while the socket is idle. */
    readonly heartbeatMs?: number;
    readonly WebSocket?: ManagedSessionWebSocketConstructor;
}

/**
 * A managed task has no product lifetime deadline.  A disconnected desktop
 * keeps attempting to rebind the same task until it is cancelled or the
 * server returns an authoritative terminal/recovery result.  Operators and
 * bounded tests can still pass a finite `reconnectGraceMs` explicitly.
 */
export const DEFAULT_RECONNECT_GRACE_MS = Number.POSITIVE_INFINITY;

export class ManagedSessionUnavailable extends Error {
    readonly beforeDispatch = true;
    constructor(message = 'Managed session handshake unavailable') {
        super(message);
        this.name = 'ManagedSessionUnavailable';
    }
}

/**
 * The bounded shard pool has no pre-dispatch capacity left.  This is kept
 * distinct from a handshake failure so callers cannot silently fall back to
 * a second inference transport and accidentally bypass the shard limit.
 */
export class ManagedSessionCapacityError extends ManagedSessionUnavailable {
    readonly code = 'MANAGED_SESSION_CAPACITY';
    constructor(message = 'Managed session capacity is full; retry after an active task completes') {
        super(message);
        this.name = 'ManagedSessionCapacityError';
    }
}

interface PendingTask {
    readonly taskId: string;
    readonly idempotencyKey: string;
    readonly body: unknown;
    controller: ReadableStreamDefaultController<Uint8Array>;
    readonly signal?: AbortSignal;
    sequence: number;
    dispatched: boolean;
    closed: boolean;
    replayEnabled?: boolean;
    abort?: () => void;
}

function websocketUrl(baseUrl: string, sessionId: string): string {
    const url = new URL('/api/gateway/session', baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('session', sessionId);
    return url.toString();
}

function eventData(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof ArrayBuffer) return new TextDecoder().decode(value);
    if (ArrayBuffer.isView(value)) return new TextDecoder().decode(value as Uint8Array);
    return String(value || '');
}

function frameBytes(value: unknown): Uint8Array {
    return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function hasByokField(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return ['apiKey', 'api_key', 'authorization', 'providerKey', 'credential', 'baseUrl', 'endpointUrl', 'upstreamUrl']
        .some(key => Object.prototype.hasOwnProperty.call(value, key));
}

const PRE_DISPATCH_SESSION_ERRORS = new Set([
    'session_frame_invalid', 'session_frame_type_invalid', 'session_task_invalid',
    'session_idempotency_required', 'session_body_invalid', 'session_body_too_large',
    'session_byok_forbidden', 'session_task_limit', 'session_not_initialized',
    'session_state_unavailable'
]);

/** The server-side GatewaySession fan-out guard. Keep the client assignment
 * below the same bound so a shard is never intentionally sent a seventeenth
 * active task. */
export const MAX_MANAGED_SESSION_TASKS = 16;
/** The session frame limit is smaller than the gateway's HTTP body limit. */
export const MAX_MANAGED_SESSION_FRAME_BYTES = 256 * 1024;

/**
 * One authenticated hibernatable gateway session shared by many logical
 * requests. It carries no provider credentials or response body state beyond
 * the bounded stream currently delivered to each caller.
 */
export class ManagedGatewaySessionPool {
    readonly sessionId = randomUUID();
    private readonly baseUrl: string;
    private readonly deviceId: () => Promise<string>;
    private readonly deviceRoute?: () => Promise<string | undefined>;
    private readonly connectTimeoutMs: number;
    private readonly maxReconnects: number;
    private readonly reconnectGraceMs: number;
    private readonly heartbeatMs: number;
    private readonly WebSocketCtor: ManagedSessionWebSocketConstructor;
    private socket: ManagedSessionWebSocket | undefined;
    private connecting: Promise<void> | undefined;
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private reconnectStableTimer: ReturnType<typeof setTimeout> | undefined;
    private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    private ackTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly pendingAcks = new Map<string, number>();
    private reconnectAttempts = 0;
    private reconnectStartedAt: number | undefined;
    private closing = false;
    private readonly tasks = new Map<string, PendingTask>();

    constructor(options: ManagedSessionPoolOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.deviceId = options.deviceId;
        this.deviceRoute = options.deviceRoute;
        this.connectTimeoutMs = Number.isSafeInteger(options.connectTimeoutMs) && (options.connectTimeoutMs as number) > 0
            ? options.connectTimeoutMs as number : 8_000;
        // A caller may still provide a finite cap for a bounded test or an
        // explicitly short-lived client. The production default is unbounded:
        // long tasks must survive ordinary Wi-Fi/VPN/sleep interruptions
        // without resending inference.
        const requestedMaxReconnects = Number(options.maxReconnects);
        this.maxReconnects = options.maxReconnects === undefined || requestedMaxReconnects === Number.POSITIVE_INFINITY
            ? Number.POSITIVE_INFINITY
            : Number.isSafeInteger(requestedMaxReconnects) && requestedMaxReconnects >= 0
                ? requestedMaxReconnects : 3;
        const requestedGraceMs = Number(options.reconnectGraceMs);
        this.reconnectGraceMs = options.reconnectGraceMs === undefined || requestedGraceMs === Number.POSITIVE_INFINITY
            ? DEFAULT_RECONNECT_GRACE_MS
            : Number.isSafeInteger(requestedGraceMs) && requestedGraceMs > 0
                ? requestedGraceMs : DEFAULT_RECONNECT_GRACE_MS;
        const requestedHeartbeatMs = Number.isSafeInteger(options.heartbeatMs) && (options.heartbeatMs as number) > 0
            ? options.heartbeatMs as number : 30_000;
        // The server lease is 90 seconds. Keep a margin even if a caller
        // supplies an overly large value so active-session metrics cannot
        // silently expire between heartbeats.
        this.heartbeatMs = Math.min(60_000, requestedHeartbeatMs);
        this.WebSocketCtor = options.WebSocket || UndiciWebSocket as unknown as ManagedSessionWebSocketConstructor;
    }

    get inFlightCount(): number { return this.tasks.size; }
    get hasCapacity(): boolean { return this.tasks.size < MAX_MANAGED_SESSION_TASKS && !this.closing; }
    get isOpen(): boolean { return this.socket?.readyState === 1; }

    async openStream(body: unknown, idempotencyKey: string, signal?: AbortSignal): Promise<Response> {
        if (hasByokField(body)) throw new ManagedSessionUnavailable('BYOK requests must remain local');
        const content = body as { contentTransfer?: unknown; acceptOrderedOutput?: unknown } | undefined;
        if (content?.contentTransfer === 'stream-v2' && content.acceptOrderedOutput === true) throw new ManagedSessionUnavailable('Ordered media requires the bounded HTTP stream');
        if (signal?.aborted) throw new ManagedSessionUnavailable('Managed session request cancelled before dispatch');
        const taskId = randomUUID();
        const startFrame = { type: 'start', taskId, idempotencyKey, body, delivery: 'ack-v1' };
        const serializedStartFrame = JSON.stringify(startFrame);
        // Screenshots and long tool histories can exceed the WebSocket frame
        // limit while remaining valid HTTP requests. Select the existing HTTP
        // transport before sending anything, preserving the idempotency key.
        // Never infer safe replay from a rejection after a frame was sent.
        if (Buffer.byteLength(serializedStartFrame, 'utf8') > MAX_MANAGED_SESSION_FRAME_BYTES) {
            throw new ManagedSessionUnavailable('Managed request requires the HTTP body transport');
        }
        let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
        const stream = new ReadableStream<Uint8Array>({ start: controller => { controllerRef = controller; } });
        const task: PendingTask = { taskId, idempotencyKey, body, signal, sequence: 0, dispatched: false, closed: false, abort: undefined, controller: undefined as unknown as ReadableStreamDefaultController<Uint8Array> };
        // The stream constructor runs synchronously, so the controller exists
        // before the first frame can be sent.
        task.controller = controllerRef!;
        this.tasks.set(taskId, task);
        try {
            await this.ensureConnected();
            if (signal?.aborted) throw new ManagedSessionUnavailable('Managed session request cancelled before dispatch');
            this.send(startFrame, serializedStartFrame);
            task.dispatched = true;
            task.abort = () => {
                if (!task.closed && this.isOpen && signal?.reason !== 'client_shutdown') this.send({ type: 'cancel', taskId });
                this.failTask(task, 'CANCELLED', '任务已取消', false);
            };
            signal?.addEventListener('abort', task.abort, { once: true });
            return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
        } catch (error) {
            this.tasks.delete(taskId);
            try { task.controller.error(error); } catch { /* stream already closed */ }
            if (error instanceof ManagedSessionUnavailable) throw error;
            throw new ManagedSessionUnavailable('Managed session handshake unavailable');
        }
    }

    close(): void {
        this.closing = true;
        if (this.ackTimer) clearTimeout(this.ackTimer);
        this.ackTimer = undefined;
        this.pendingAcks.clear();
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        this.clearReconnectStableTimer();
        this.stopHeartbeat();
        const socket = this.socket;
        this.socket = undefined;
        try { socket?.close(1000, 'client_shutdown'); } catch { /* already closed */ }
        for (const task of this.tasks.values()) this.failTask(task, 'BILLING_TRANSPORT_UNKNOWN', '平台连接已关闭，原请求待核对；不要重复发送', true);
    }

    private async ensureConnected(): Promise<void> {
        if (this.isOpen) return;
        if (this.connecting) return this.connecting;
        const reconnecting = Boolean(this.socket) || this.reconnectAttempts > 0;
        this.connecting = this.connect(reconnecting).finally(() => { this.connecting = undefined; });
        return this.connecting;
    }

    private connect(reconnecting: boolean): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            let settled = false;
            let timeout: ReturnType<typeof setTimeout> | undefined;
            const finish = (error?: Error): void => {
                if (settled) return;
                settled = true;
                if (timeout) clearTimeout(timeout);
                error ? reject(error) : resolve();
            };
            let socket: ManagedSessionWebSocket;
            try {
                const deviceId = await this.deviceId();
                const deviceRoute = await this.deviceRoute?.();
                socket = new this.WebSocketCtor(websocketUrl(this.baseUrl, this.sessionId), {
                    headers: { 'x-nextmux-device-id': deviceId, 'x-nextmux-session-id': this.sessionId,
                        ...(deviceRoute ? { 'x-nextmux-device-route': deviceRoute } : {}) }
                });
            } catch (error) {
                finish(error instanceof Error ? error : new Error('WebSocket construction failed'));
                return;
            }
            this.socket = socket;
            timeout = setTimeout(() => {
                try { socket.close(1000, 'connect_timeout'); } catch { /* noop */ }
                finish(new ManagedSessionUnavailable('Managed session handshake timed out'));
            }, this.connectTimeoutMs);
            socket.addEventListener('open', () => {
                if (this.socket !== socket || this.closing) return;
                if (!reconnecting) {
                    this.reconnectAttempts = 0;
                    this.reconnectStartedAt = undefined;
                } else {
                    // Do not reset the outage window merely because a
                    // handshake succeeded: a socket that immediately closes
                    // again must not create an unbounded rapid reconnect
                    // loop. Reset the window only after a stable heartbeat
                    // interval has elapsed.
                    this.armReconnectStableTimer();
                }
                this.startHeartbeat();
                finish();
                if (reconnecting) {
                    for (const task of this.tasks.values()) {
                        if (task.dispatched && !task.closed) {
                            this.send({ type: 'resume', taskId: task.taskId, sequence: task.sequence });
                        }
                    }
                }
            });
            socket.addEventListener('message', event => {
                if (this.socket === socket && !this.closing) this.onMessage(eventData(event?.data));
            });
            socket.addEventListener('error', () => { /* close carries the bounded retry */ });
            socket.addEventListener('close', () => {
                // A stale socket can report close after a reconnect has already
                // installed a newer socket. Do not tear down the newer
                // connection or schedule a second reconnect in that case.
                const current = this.socket === socket;
                if (current) {
                    this.stopHeartbeat();
                    this.clearReconnectStableTimer();
                    this.socket = undefined;
                    if (this.tasks.size && this.reconnectStartedAt === undefined) this.reconnectStartedAt = Date.now();
                }
                finish(new ManagedSessionUnavailable('Managed session closed before handshake'));
                if (current && !this.closing) this.scheduleReconnect();
            });
        });
    }

    private send(value: unknown, serialized?: string): void {
        if (!this.isOpen) throw new ManagedSessionUnavailable('Managed session is not open');
        this.socket!.send(serialized ?? JSON.stringify(value));
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (!this.isOpen || this.closing) return;
            try { this.send({ type: 'ping' }); } catch { /* close handler schedules reconnect */ }
        }, this.heartbeatMs);
        // A heartbeat is transport maintenance, not application work; it
        // must not keep a headless Node process alive during shutdown/tests.
        (this.heartbeatTimer as unknown as { unref?: () => void }).unref?.();
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
    }

    private clearReconnectStableTimer(): void {
        if (this.reconnectStableTimer) clearTimeout(this.reconnectStableTimer);
        this.reconnectStableTimer = undefined;
    }

    private armReconnectStableTimer(): void {
        this.clearReconnectStableTimer();
        const stableMs = Math.min(60_000, Math.max(1_000, this.heartbeatMs * 2));
        this.reconnectStableTimer = setTimeout(() => {
            this.reconnectStableTimer = undefined;
            if (this.isOpen && !this.closing) {
                this.reconnectAttempts = 0;
                this.reconnectStartedAt = undefined;
            }
        }, stableMs);
        (this.reconnectStableTimer as unknown as { unref?: () => void }).unref?.();
    }

    private resetReconnectStateIfIdle(): void {
        if (this.tasks.size) return;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        this.clearReconnectStableTimer();
        this.reconnectAttempts = 0;
        this.reconnectStartedAt = undefined;
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer || !this.tasks.size || this.closing) return;
        const startedAt = this.reconnectStartedAt ?? (this.reconnectStartedAt = Date.now());
        const elapsed = Math.max(0, Date.now() - startedAt);
        if (elapsed >= this.reconnectGraceMs || this.reconnectAttempts >= this.maxReconnects) {
            if (this.tasks.size) {
                for (const task of this.tasks.values()) this.failTask(task, 'BILLING_TRANSPORT_UNKNOWN', '平台连接中断，原请求结果待核对；不要重复发送', true);
            }
            return;
        }
        const delay = Math.min(30_000, 100 * 2 ** this.reconnectAttempts++, Math.max(0, this.reconnectGraceMs - elapsed));
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            // A task may have completed while the backoff timer was pending.
            // Do not reopen an idle authenticated socket just because an old
            // generation closed.
            if (!this.tasks.size || this.closing) return;
            void this.ensureConnected().catch(() => this.scheduleReconnect());
        }, delay);
    }

    private onMessage(raw: string): void {
        let value: any;
        try { value = JSON.parse(raw); } catch { return; }
        if (value?.type === 'session.error') {
            const taskId = String(value.taskId || '');
            if (taskId) {
                const task = this.tasks.get(taskId);
                if (task && !task.closed) {
                    const accepted = !PRE_DISPATCH_SESSION_ERRORS.has(String(value.code || ''));
                    this.failTask(task, String(value.code || 'BILLING_TRANSPORT_UNKNOWN'), accepted ? '平台会话失败，原请求结果待核对；不要重复发送' : '平台任务数已满，请稍后重试', accepted,
                        accepted ? { requestId: value.requestId, recoveryMode: 'billing_review' } : {});
                }
            } else {
                for (const task of this.tasks.values()) this.failTask(task, String(value.code || 'BILLING_TRANSPORT_UNKNOWN'), '平台会话失败，原请求结果待核对；不要重复发送', true);
            }
            return;
        }
        if (value?.type === 'session.resume') {
            const task = this.tasks.get(String(value.taskId || ''));
            if (!task || task.closed) return;
            // A live rebind means the same Durable Object still owns the
            // provider controller and has attached it to this socket. Keep the
            // stream open only when no sequence was missed; any gap remains a
            // billing-safe recovery case rather than an unsafe replay.
            const lastSequence = Number(value.lastSequence);
            if (value.delivery === 'ack-v1' && value.recoveryContract?.replayable === true
                && value.replayFrom === task.sequence + 1 && Number.isSafeInteger(lastSequence) && lastSequence >= task.sequence) {
                task.replayEnabled = true;
                return;
            }
            if (value.running === true && value.live === true
                && Number.isSafeInteger(lastSequence) && lastSequence === task.sequence) return;
            this.failTask(task, 'BILLING_TRANSPORT_UNKNOWN', '平台连接中断，原请求结果待核对；不要重复发送', true, {
                requestId: value.requestId, taskId: task.taskId, lastSequence: value.lastSequence,
                idempotencyKey: task.idempotencyKey, recoveryMode: 'billing_review', acceptanceUnknown: true,
                ...(value.recoveryContract && typeof value.recoveryContract === 'object'
                    ? { recoveryContract: value.recoveryContract } : {})
            });
            return;
        }
        if (value?.type === 'session.accepted' && value.duplicate === true) {
            const task = this.tasks.get(String(value.taskId || ''));
            if (task && !task.closed) {
                this.failTask(task, 'BILLING_TRANSPORT_UNKNOWN', '平台已接收此请求，请在用量账单中恢复结果；不要重复发送', true, {
                    taskId: task.taskId, idempotencyKey: task.idempotencyKey, recoveryMode: 'billing_review',
                    acceptanceUnknown: true
                });
            }
            return;
        }
        if (value?.type !== 'session.event') return;
        const task = this.tasks.get(String(value.taskId || ''));
        if (!task || task.closed) return;
        const sequence = Number(value.sequence);
        if (!Number.isSafeInteger(sequence) || sequence <= task.sequence) return;
        if (sequence !== task.sequence + 1) {
            this.failTask(task, 'BILLING_TRANSPORT_UNKNOWN', '模型流式响应缺少事件，原请求结果待核对；不要重复发送', true, { taskId: task.taskId, lastSequence: task.sequence, recoveryMode: 'billing_review' });
            return;
        }
        task.sequence = sequence;
        if (value.delivery === 'ack-v1') task.replayEnabled = true;
        const event = value.event && typeof value.event === 'object' ? value.event : {};
        const envelope = { ...event, streamId: value.sessionId || this.sessionId, taskId: task.taskId, sequence };
        try { task.controller.enqueue(frameBytes(envelope)); } catch { this.failTask(task, 'BILLING_TRANSPORT_UNKNOWN', '平台连接中断，原请求结果待核对；不要重复发送', true); return; }
        // Receipts acknowledge transport delivery, not durable conversation
        // storage. The desktop's normal local journal still owns persistence.
        // Batch them to avoid a billable inbound WS frame for every token.
        if (task.replayEnabled) this.queueAcknowledgement(task);
        // Only the platform's own terminal frames end the stream: `completed` (the billed result), `error`, and the
        // session-level marker that always follows either. `response.completed` is the provider's event and arrives
        // before billing settles; closing on it dropped the result frame, so every session request looked unfinished
        // and fell into billing recovery.
        if (['completed', 'gateway.completed', 'session.completed', 'error', 'gateway.failed', 'session.failed', 'session.cancelled', 'session.canceled'].includes(String(event.type))) {
            this.flushAcknowledgements();
            this.finishTask(task);
        }
    }

    private queueAcknowledgement(task: PendingTask): void {
        this.pendingAcks.set(task.taskId, task.sequence);
        if (!this.ackTimer) {
            this.ackTimer = setTimeout(() => this.flushAcknowledgements(), 500);
            this.ackTimer.unref?.();
        }
    }

    private flushAcknowledgements(): void {
        if (this.ackTimer) clearTimeout(this.ackTimer);
        this.ackTimer = undefined;
        for (const [taskId, sequence] of this.pendingAcks) {
            if (!this.isOpen) break;
            try { this.send({ type: 'ack', taskId, sequence }); this.pendingAcks.delete(taskId); } catch { break; }
        }
        // A reconnect carries the highest consumed sequence in its resume
        // frame; stale receipts need no separate retry timer.
        this.pendingAcks.clear();
    }

    private finishTask(task: PendingTask): void {
        if (task.closed) return;
        task.closed = true;
        task.signal?.removeEventListener('abort', task.abort!);
        this.tasks.delete(task.taskId);
        this.resetReconnectStateIfIdle();
        try { task.controller.close(); } catch { /* already closed */ }
    }

    private failTask(task: PendingTask, code: string, message: string, accepted: boolean, details: Record<string, unknown> = {}): void {
        if (task.closed) return;
        task.closed = true;
        task.signal?.removeEventListener('abort', task.abort!);
        this.tasks.delete(task.taskId);
        this.resetReconnectStateIfIdle();
        try {
            task.controller.enqueue(frameBytes({ type: 'error', streamId: this.sessionId, taskId: task.taskId, sequence: task.sequence + 1,
                error: { code, message, ...(accepted ? { providerAccepted: true, acceptanceUnknown: true } : {}), ...details } }));
            task.controller.close();
        } catch { /* caller already cancelled */ }
    }
}

export interface ManagedSessionShardPoolOptions extends ManagedSessionPoolOptions {
    /** Maximum number of authenticated sessions this desktop may open. */
    readonly maxShards?: number;
}

/**
 * Bounded client-side fan-out for long-running managed tasks.
 *
 * One WebSocket remains the normal path. A second session is opened only when
 * all existing sessions have reached the server's 16-task active bound. Each
 * task is assigned exactly once before dispatch and remains owned by that
 * shard for its entire lifetime; reconnect logic stays inside the underlying
 * pool, so it sends resume frames rather than a second start. BYOK never
 * enters any shard.
 */
export class ManagedGatewaySessionShardPool {
    private readonly options: ManagedSessionPoolOptions;
    private readonly maxShards: number;
    private readonly shards: ManagedGatewaySessionPool[] = [];
    private closing = false;

    constructor(options: ManagedSessionShardPoolOptions) {
        const requested = Number(options.maxShards);
        this.maxShards = Number.isSafeInteger(requested) && requested >= 1 && requested <= 32 ? requested : 8;
        // The extra maxShards field is consumed by this wrapper only; passing
        // the same object to each underlying pool preserves all transport
        // options without duplicating or exposing credentials.
        this.options = options;
    }

    get inFlightCount(): number { return this.shards.reduce((total, shard) => total + shard.inFlightCount, 0); }
    get isOpen(): boolean { return this.shards.some(shard => shard.isOpen); }
    get shardCount(): number { return this.shards.length; }
    get shardInFlightCounts(): readonly number[] { return this.shards.map(shard => shard.inFlightCount); }
    get capacity(): number { return this.shards.reduce((total, shard) => total + (shard.hasCapacity ? MAX_MANAGED_SESSION_TASKS - shard.inFlightCount : 0), 0) + Math.max(0, this.maxShards - this.shards.length) * MAX_MANAGED_SESSION_TASKS; }

    async openStream(body: unknown, idempotencyKey: string, signal?: AbortSignal): Promise<Response> {
        if (this.closing) throw new ManagedSessionUnavailable('Managed session pool is closed');
        if (hasByokField(body)) throw new ManagedSessionUnavailable('BYOK requests must remain local');
        const content = body as { contentTransfer?: unknown; acceptOrderedOutput?: unknown } | undefined;
        if (content?.contentTransfer === 'stream-v2' && content.acceptOrderedOutput === true) throw new ManagedSessionUnavailable('Ordered media requires the bounded HTTP stream');
        if (signal?.aborted) throw new ManagedSessionUnavailable('Managed session request cancelled before dispatch');
        let shard = this.shards.find(candidate => candidate.hasCapacity);
        if (!shard && this.shards.length < this.maxShards) {
            shard = new ManagedGatewaySessionPool(this.options);
            this.shards.push(shard);
        }
        if (!shard) throw new ManagedSessionCapacityError();
        // The selected pool creates the immutable task ID and binds it to this
        // shard before its first await. Concurrent callers therefore observe
        // the updated count and allocate the seventeenth task to a new shard.
        return shard.openStream(body, idempotencyKey, signal);
    }

    close(): void {
        this.closing = true;
        for (const shard of this.shards) shard.close();
    }
}
