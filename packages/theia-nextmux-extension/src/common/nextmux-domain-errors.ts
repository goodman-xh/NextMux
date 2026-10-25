/** Language-independent desktop messages survive RPC and persisted status snapshots. */
export interface DomainMessage {
    readonly code: string;
    readonly params?: Readonly<Record<string, string | number | boolean>>;
    /** Canonical built-in text for logs and model-facing consumers, never a UI fallback. */
    readonly fallbackEnglish: string;
    readonly technicalDetails?: string;
}

export class DesktopDomainError extends Error {
    readonly domainError: DomainMessage;
    readonly data: { readonly domainError: DomainMessage };
    constructor(readonly code: string, fallbackEnglish: string,
        params?: DomainMessage['params'], technicalDetails?: string) {
        super(fallbackEnglish);
        this.name = 'DesktopDomainError';
        this.domainError = { code, fallbackEnglish, ...(params ? { params } : {}), ...(technicalDetails ? { technicalDetails } : {}) };
        this.data = { domainError: this.domainError };
    }
}

export function domainMessageFromError(value: unknown): DomainMessage | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : undefined;
    const candidate = record.domainError ?? data?.domainError;
    if (!candidate || typeof candidate !== 'object') return undefined;
    const message = candidate as DomainMessage;
    if (typeof message.code !== 'string' || !/^[A-Z][A-Z0-9_.-]{1,127}$/.test(message.code)
        || typeof message.fallbackEnglish !== 'string') return undefined;
    const params: Record<string, string | number | boolean> = {};
    if (message.params && typeof message.params === 'object') {
        for (const [key, item] of Object.entries(message.params)) {
            if (typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) params[key] = item;
        }
    }
    return { code: message.code, fallbackEnglish: message.fallbackEnglish, params,
        ...(typeof message.technicalDetails === 'string' ? { technicalDetails: message.technicalDetails } : {}) };
}
