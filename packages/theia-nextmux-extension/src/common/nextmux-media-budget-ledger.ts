import { walletNetBalanceMicros } from './nextmux-money-format';
import type { PlatformWallet } from './nextmux-platform-protocol';

export type SpendableWalletLike = Partial<Pick<PlatformWallet, 'currency' | 'availableMicros' | 'reservedMicros' | 'usageDebtMicros' | 'usageInFlightMicros' | 'netBalanceMicros'>>;

/**
 * What the gateway would let a new paid request reserve from this wallet snapshot, in USD micros: nothing while usage
 * debt is owed or the net balance is not positive, else the available balance capped by the net balance.
 */
export function computeWalletSpendableMicros(wallet: SpendableWalletLike | undefined): number {
    if (!wallet) return 0;
    if (typeof wallet.usageDebtMicros === 'number' && wallet.usageDebtMicros > 0) return 0;
    const available = typeof wallet.availableMicros === 'number' && Number.isFinite(wallet.availableMicros) ? Math.floor(wallet.availableMicros) : 0;
    if (available <= 0) return 0;
    const net = typeof wallet.netBalanceMicros === 'number' && Number.isFinite(wallet.netBalanceMicros) ? wallet.netBalanceMicros
        : wallet.reservedMicros !== undefined || wallet.usageInFlightMicros !== undefined
            ? walletNetBalanceMicros({ availableMicros: available, reservedMicros: wallet.reservedMicros ?? 0, usageDebtMicros: 0, usageInFlightMicros: wallet.usageInFlightMicros ?? 0 })
            : undefined;
    if (net !== undefined && net <= 0) return 0;
    return net === undefined ? available : Math.min(available, Math.floor(net));
}

export interface LocalMediaBudgetReservation {
    readonly id: string;
    readonly amountMicros: number;
    readonly createdAt: number;
    /** When the gateway took the request over: from then on its own hold (or charge) stands for this amount. */
    readonly heldSince?: number;
}

export interface LocalMediaBudgetReserveResult {
    readonly ok: boolean;
    /** Spendable balance left for this request once the other reservations are counted. */
    readonly availableBeforeMicros: number;
    readonly availableAfterMicros: number;
    readonly reservedTotalMicros: number;
    /** What the other reservations keep back: work the cached wallet does not show yet. */
    readonly otherReservedMicros: number;
    readonly requiredMicros: number;
    readonly shortageMicros: number;
}

/**
 * Spending the cached wallet does not show yet, so rapid clicks, canvas batches and the desk's parallel lanes cannot
 * all spend the same balance before the platform answers. A reservation covers one request (or one workflow) from
 * the moment it is decided until a wallet snapshot reflects it:
 * - it is released at once when nothing was spent (refused, cancelled before the gateway, failed locally);
 * - once the gateway holds or charges it (`markServerHeld`), it stays until a snapshot fetched after that point
 *   arrives (`reconcileWalletBalance`) — then the wallet counts it and the reservation would count it twice.
 * Only the desktop's view is guarded: the gateway prices, holds and refuses every request itself.
 */
export class LocalMediaBudgetLedger {
    private readonly reservations = new Map<string, LocalMediaBudgetReservation>();

    /** Reservations older than this are dropped, so a lost release cannot block spending for good. */
    constructor(private readonly ttlMs = 30 * 60_000) {}

    private prune(now: number): void {
        for (const [key, entry] of this.reservations) if (now - entry.createdAt >= this.ttlMs) this.reservations.delete(key);
    }

    totalReservedMicros(now = Date.now()): number {
        this.prune(now);
        let sum = 0;
        for (const entry of this.reservations.values()) sum += entry.amountMicros;
        return sum;
    }

    availableMicros(walletSpendableMicros: number, now = Date.now()): number {
        return Math.max(0, spendable(walletSpendableMicros) - this.totalReservedMicros(now));
    }

    get(id: string, now = Date.now()): LocalMediaBudgetReservation | undefined {
        this.prune(now);
        return this.reservations.get(id);
    }

    activeReservations(now = Date.now()): readonly LocalMediaBudgetReservation[] {
        this.prune(now);
        return [...this.reservations.values()];
    }

    /** Reserve (or re-size) `id` when the balance the other reservations leave covers it; synchronous, before any await. */
    tryReserve(id: string, requiredMicros: number, walletSpendableMicros: number, now = Date.now()): LocalMediaBudgetReserveResult {
        this.prune(now);
        const required = typeof requiredMicros === 'number' && Number.isFinite(requiredMicros) ? Math.max(0, Math.ceil(requiredMicros)) : 0;
        const balance = spendable(walletSpendableMicros);
        let otherReservedMicros = 0;
        for (const [key, entry] of this.reservations) if (key !== id) otherReservedMicros += entry.amountMicros;
        const availableBeforeMicros = Math.max(0, balance - otherReservedMicros);
        if ((required > 0 && balance <= 0) || required > availableBeforeMicros) {
            return { ok: false, availableBeforeMicros, availableAfterMicros: availableBeforeMicros, otherReservedMicros,
                reservedTotalMicros: otherReservedMicros + (this.reservations.get(id)?.amountMicros ?? 0), requiredMicros: required,
                shortageMicros: Math.max(1, required - availableBeforeMicros) };
        }
        this.reservations.set(id, { id, amountMicros: required, createdAt: now });
        return { ok: true, availableBeforeMicros, availableAfterMicros: Math.max(0, balance - otherReservedMicros - required), otherReservedMicros,
            reservedTotalMicros: otherReservedMicros + required, requiredMicros: required, shortageMicros: 0 };
    }

    /**
     * Hand `amountMicros` of `fromId` (never more than it holds) to `toId` — the job a click became, or the step a
     * workflow starts — without checking again: the money was already set aside. What stays under `fromId` is still
     * to come, or, with `restSpentAt`, already spent (a start frame, a prompt translation) and kept until a snapshot
     * after that moment shows it.
     */
    move(fromId: string, toId: string, amountMicros: number, options: { readonly restSpentAt?: number; readonly now?: number } = {}): void {
        const now = options.now ?? Date.now();
        this.prune(now);
        const entry = this.reservations.get(fromId);
        if (!entry || fromId === toId) return;
        const moved = Math.min(entry.amountMicros, Number.isFinite(amountMicros) ? Math.max(0, Math.ceil(amountMicros)) : entry.amountMicros);
        this.reservations.delete(fromId);
        if (moved > 0) this.reservations.set(toId, { id: toId, amountMicros: moved, createdAt: now });
        const rest = entry.amountMicros - moved;
        if (rest > 0) this.reservations.set(fromId, { ...entry, amountMicros: rest, ...(options.restSpentAt !== undefined ? { heldSince: options.restSpentAt } : {}) });
    }

    /** The gateway now holds (or has charged) this request itself; kept until a snapshot fetched after `at` arrives. */
    markServerHeld(id: string, at = Date.now()): void {
        const entry = this.reservations.get(id);
        if (entry && entry.heldSince === undefined) this.reservations.set(id, { ...entry, heldSince: at });
    }

    isServerHeld(id: string): boolean {
        return this.reservations.get(id)?.heldSince !== undefined;
    }

    /** Nothing was spent: free it now. */
    release(id: string): boolean {
        return this.reservations.delete(id);
    }

    /** Free a reservation the gateway never received; one it holds or charged waits for the next wallet snapshot. */
    releaseIfPending(id: string): boolean {
        return this.reservations.get(id)?.heldSince === undefined ? this.reservations.delete(id) : false;
    }

    /**
     * A wallet snapshot fetched at `observedAt` already reflects every hold and charge the gateway made before then:
     * drop the reservations those replaced. Returns the spendable balance left after the reservations still open.
     */
    reconcileWalletBalance(walletSpendableMicros: number, observedAt = Date.now(), now = Date.now()): number {
        for (const [key, entry] of this.reservations) if (entry.heldSince !== undefined && entry.heldSince <= observedAt) this.reservations.delete(key);
        return this.availableMicros(walletSpendableMicros, now);
    }

    clear(): void {
        this.reservations.clear();
    }
}

function spendable(value: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
