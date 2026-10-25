import type { PlatformWallet } from './nextmux-platform-protocol';

/** Reservations are still the user's funds; never display them as spent. */
export function walletNetBalanceMicros(wallet: Pick<PlatformWallet, 'availableMicros' | 'reservedMicros' | 'usageDebtMicros' | 'usageInFlightMicros' | 'netBalanceMicros'>): number {
    if (Number.isSafeInteger(wallet.netBalanceMicros)) return wallet.netBalanceMicros!;
    const micros = (value: number | undefined): number => Number.isSafeInteger(value) && value! >= 0 ? value! : 0;
    return micros(wallet.availableMicros) + micros(wallet.reservedMicros) - micros(wallet.usageDebtMicros) - micros(wallet.usageInFlightMicros);
}

/**
 * A wallet balance, rounded down to the currency's smallest unit: $4.996 shows as $4.99, never
 * $5.00, so the balance on screen is never more than what can actually be spent.
 */
export function formatBalanceMicros(locale: string, currency: string, micros: number): string {
    const value = Number.isFinite(micros) ? Math.trunc(micros) : 0;
    try {
        const digits = Math.min(6, new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2);
        const step = 10 ** (6 - digits);
        const floored = Math.floor(value / step) * step;
        return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(floored / 1_000_000);
    } catch {
        return `${currency} ${(Math.floor(value / 10_000) / 100).toFixed(2)}`;
    }
}
