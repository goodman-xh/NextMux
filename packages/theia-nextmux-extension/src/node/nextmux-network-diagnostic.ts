/** Transport facts only: never persist SDK messages, URLs, headers, bodies or stacks. */
export type PlatformTransportStage = 'prepare_headers' | 'session_open' | 'http_dispatch' | 'response_read';

const networkCodes = new Set([
    'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
    'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_ABORTED'
]);
const errorNames = new Set(['Error', 'TypeError', 'AbortError', 'TimeoutError', 'AggregateError']);

export function platformTransportDiagnostic(error: unknown, stage: PlatformTransportStage): string {
    const facts = [`transport_stage=${stage}`];
    const seen = new Set<object>();
    let current = error;
    for (let depth = 0; depth < 4 && current && typeof current === 'object' && !seen.has(current); depth++) {
        seen.add(current);
        const record = current as { name?: unknown; code?: unknown; cause?: unknown };
        try {
            if (typeof record.name === 'string' && errorNames.has(record.name)) facts.push(`error_type=${record.name}`);
            if (typeof record.code === 'string' && networkCodes.has(record.code)) facts.push(`network_code=${record.code}`);
            current = record.cause;
        } catch { break; }
    }
    return [...new Set(facts)].join('; ');
}
