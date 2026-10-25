import type { PlatformWallet } from '../common/nextmux-platform-protocol';

type Wallet = Pick<PlatformWallet, 'currency' | 'availableMicros' | 'reservedMicros' | 'usageDebtMicros' | 'usageInFlightMicros' | 'netBalanceMicros' | 'updatedAt'>;
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const validWallet = (wallet: Wallet | undefined): wallet is Wallet => Boolean(wallet
    && nonnegative(wallet.availableMicros) && nonnegative(wallet.reservedMicros)
    && nonnegative(wallet.usageDebtMicros) && nonnegative(wallet.usageInFlightMicros)
    && nonnegative(wallet.updatedAt)
    && (wallet.netBalanceMicros === undefined || Number.isSafeInteger(wallet.netBalanceMicros)));

/** Clearing an old notice is not admission or a retry. Require a fresh,
 * same-currency recovery; uncertain balances leave the notice in place. */
export function shouldClearBalanceNotice(input: {
    readonly insufficient: boolean;
    readonly failedAt?: number;
    readonly currency?: string;
    readonly before: readonly Wallet[];
    readonly after: readonly Wallet[];
    readonly requiredMicros?: number;
}): boolean {
    if (!input.insufficient || !nonnegative(input.failedAt) || !input.failedAt
        || !/^[A-Z]{3}$/.test(input.currency || '')) return false;
    const prior = input.before.filter(wallet => wallet.currency === input.currency);
    const current = input.after.filter(wallet => wallet.currency === input.currency);
    if (prior.length !== 1 || current.length !== 1 || !validWallet(prior[0]) || !validWallet(current[0])) return false;
    const before = prior[0], after = current[0];
    const net = after.netBalanceMicros ?? after.availableMicros + after.reservedMicros - after.usageDebtMicros! - after.usageInFlightMicros!;
    if (after.updatedAt < input.failedAt || after.updatedAt <= before.updatedAt
        || after.availableMicros <= before.availableMicros || after.availableMicros <= 0
        || after.usageDebtMicros !== 0 || after.usageInFlightMicros !== 0 || net <= 0) return false;
    if (input.requiredMicros !== undefined) return nonnegative(input.requiredMicros) && after.availableMicros >= input.requiredMicros;
    // A legacy failure at an already-positive balance may mean a larger
    // quote was unaffordable. Without its amount, a top-up alone cannot prove
    // that specific condition has cleared.
    return before.availableMicros === 0 || before.availableMicros + before.reservedMicros - before.usageDebtMicros! - before.usageInFlightMicros! <= 0;
}
