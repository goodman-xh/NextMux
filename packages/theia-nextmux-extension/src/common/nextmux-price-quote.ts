import { DesktopDomainError } from './nextmux-domain-errors';
/** Opaque authorization for a displayed price group, never a provider credential. */
export function optionalKeyPriceQuoteId(value: unknown): string | undefined {
    return typeof value === 'string' && /^kq1_[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export function requireValidKeyPriceQuoteId(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    const quote = optionalKeyPriceQuoteId(value);
    if (!quote) throw new DesktopDomainError('PRICE_QUOTE_INVALID', 'The price authorization is invalid. Review the current price and authorize it again.');
    return quote;
}

/** Rebinding to a catalog object must retain the task's authorization, even if absent. */
export function bindPriceQuote<T extends { readonly kind: string }>(route: T | undefined, quote: unknown): T | undefined {
    return route?.kind === 'managed_gateway' ? { ...route, keyPriceQuoteId: optionalKeyPriceQuoteId(quote) } : route;
}

export function isPriceAuthorizationError(code: string): boolean {
    return ['PRICE_QUOTE_CHANGED', 'PRICE_AUTHORIZATION_REQUIRED', 'PRICE_QUOTE_INVALID'].includes(code.toUpperCase());
}

export function priceAuthorizationErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const value = error as { code?: unknown; failure?: { code?: unknown }; message?: unknown };
    const code = value.failure?.code || value.code;
    if (typeof code === 'string' && isPriceAuthorizationError(code)) return code.toUpperCase();
    // RPC error serialization may retain only the explicitly tagged message.
    return typeof value.message === 'string' ? value.message.match(/\[(PRICE_QUOTE_CHANGED|PRICE_AUTHORIZATION_REQUIRED|PRICE_QUOTE_INVALID)\]/)?.[1] : undefined;
}
