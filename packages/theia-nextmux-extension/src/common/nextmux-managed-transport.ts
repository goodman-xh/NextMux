/**
 * Managed gateway transport contract.
 *
 * A provider stream is a single inference response.  An SSE/NDJSON response
 * cannot safely be reused for a second prompt, so the request transport is
 * deliberately represented separately from a multiplexed WebSocket session.
 * This keeps the client from silently turning one logical request into a
 * shared stream (which would mix task IDs, sequences, and billing receipts).
 */

export type ManagedTransportMode =
    | 'byok-local'
    | 'request-ndjson'
    | 'websocket-multiplex';

export interface ManagedTransportAdvertisement {
    readonly version: 1;
    readonly mode: ManagedTransportMode;
    /** True only when one connection can carry multiple independent tasks. */
    readonly multiplex: boolean;
    /** A server-issued session identifier is required for multiplexing. */
    readonly sessionId?: string;
    /** Maximum number of in-flight logical tasks on the session. */
    readonly maxInflight?: number;
}

const SESSION_ID = /^[A-Za-z0-9._:-]{8,160}$/;

export function requestNdjsonTransport(): ManagedTransportAdvertisement {
    return { version: 1, mode: 'request-ndjson', multiplex: false };
}

export function byokLocalTransport(): ManagedTransportAdvertisement {
    return { version: 1, mode: 'byok-local', multiplex: false };
}

export function websocketMultiplexTransport(input: {
    readonly sessionId: string;
    readonly maxInflight?: number;
}): ManagedTransportAdvertisement {
    if (!SESSION_ID.test(input.sessionId)) throw new Error('managed_transport_session_invalid');
    const maxInflight = input.maxInflight === undefined ? undefined : Number(input.maxInflight);
    if (maxInflight !== undefined && (!Number.isSafeInteger(maxInflight) || maxInflight < 1 || maxInflight > 1024)) {
        throw new Error('managed_transport_inflight_invalid');
    }
    return { version: 1, mode: 'websocket-multiplex', multiplex: true, sessionId: input.sessionId, ...(maxInflight === undefined ? {} : { maxInflight }) };
}

/** Parse the server response header without trusting arbitrary values. */
export function parseManagedTransportHeader(value: string | null | undefined): ManagedTransportAdvertisement {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'websocket-multiplex-v1') {
        // A WebSocket session id is intentionally not inferred from a header.
        // The endpoint must return it in an authenticated session handshake.
        return requestNdjsonTransport();
    }
    return requestNdjsonTransport();
}

/**
 * Validate a negotiated transport before dispatching a logical task.
 * BYOK never enters this function in production; keeping the rejection here
 * prevents accidental routing of user-owned keys through the managed gateway.
 */
export function assertManagedTransport(transport: ManagedTransportAdvertisement): void {
    if (!transport || transport.version !== 1) throw new Error('managed_transport_version_invalid');
    if (transport.mode === 'byok-local') throw new Error('managed_transport_byok_not_allowed');
    if (transport.mode === 'request-ndjson' && transport.multiplex) throw new Error('managed_transport_contract_invalid');
    if (transport.mode === 'websocket-multiplex') {
        if (!transport.multiplex || !transport.sessionId || !SESSION_ID.test(transport.sessionId)) throw new Error('managed_transport_session_invalid');
    }
}

/**
 * Only a negotiated WebSocket session may carry more than one logical task.
 * This predicate is used by tests and future session pooling code; it is not
 * inferred from a provider's `text/event-stream` content type.
 */
export function canReuseManagedConnection(transport: ManagedTransportAdvertisement): boolean {
    assertManagedTransport(transport);
    return transport.mode === 'websocket-multiplex' && transport.multiplex === true;
}

