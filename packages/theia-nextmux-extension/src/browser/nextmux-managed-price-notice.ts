import type { ManagedPriceUpdate } from '@nextmux/agent-runtime';
import { readManagedPriceUpdate } from '../common/nextmux-managed-price-update';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { formatRoutePriceChangedDetail, formatRoutePriceChangedNotice } from './nextmux-route-price-text';

export const MANAGED_PRICE_NOTICES_KEY = 'nextmux.desktop.managedPriceNotices.v1';

export interface OwnedManagedPriceNotice {
    readonly sessionId: string;
    readonly runId: string;
    readonly pricingUpdate: ManagedPriceUpdate;
}

export interface ManagedPriceNoticeItem extends OwnedManagedPriceNotice {
    readonly message: string;
    readonly detail?: string;
}

/** Localize at render time so an existing notice follows a language switch. */
export function managedPriceNoticeItem(locale: NextMuxDesktopLocale, notice: OwnedManagedPriceNotice | undefined): ManagedPriceNoticeItem | undefined {
    return notice ? { ...notice, message: formatRoutePriceChangedNotice(locale),
        detail: formatRoutePriceChangedDetail(locale, notice.pricingUpdate) || undefined } : undefined;
}

interface PriceObservation {
    readonly sessionId: string;
    readonly offeringId: string;
    readonly signature: string;
    readonly observedAt: number;
    readonly lastReceiptId: string;
    readonly usageMultiplierBps: number | null;
    readonly notice?: OwnedManagedPriceNotice;
}

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function identifier(value: unknown, maximum = 512): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value);
}

/** Public execution metadata only; never retain arbitrary fields from a transport event. */
export const normalizeManagedPriceUpdate = readManagedPriceUpdate;

/** Compare the actual customer rates, not audit quote IDs or a displayed multiplier. */
export function managedPriceRateSignature(update: ManagedPriceUpdate): string {
    return JSON.stringify([update.currency, [...update.rates]
        .sort((a, b) => a.metric.localeCompare(b.metric))
        .map(rate => [rate.metric, rate.unitSize, rate.customerAmountMicros])]);
}

export function normalizeOwnedManagedPriceNotice(value: unknown): OwnedManagedPriceNotice | undefined {
    if (!record(value) || !identifier(value.sessionId) || !identifier(value.runId)) return undefined;
    const pricingUpdate = normalizeManagedPriceUpdate(value.pricingUpdate);
    return pricingUpdate ? { sessionId: value.sessionId, runId: value.runId, pricingUpdate } : undefined;
}

/** The poll's verified run and owning conversation, never the currently visible conversation. */
export function ownedManagedPriceEvent(value: unknown, sessionId: string, runId: string): OwnedManagedPriceNotice | undefined {
    if (!record(value) || value.type !== 'model_price_changed' || value.runId !== runId
        || value.sessionId !== undefined && value.sessionId !== sessionId) return undefined;
    return normalizeOwnedManagedPriceNotice({ sessionId, runId, pricingUpdate: value.pricingUpdate });
}

export function managedPriceNotificationId(notice: OwnedManagedPriceNotice): string {
    return `managed-price:${notice.sessionId}:${notice.pricingUpdate.id}`;
}

/** Retains one effective rate and dismiss state per conversation/offering across run restarts. */
export class ManagedPriceNoticeStore {
    protected readonly observations = new Map<string, PriceObservation>();

    protected key(sessionId: string, offeringId: string): string { return JSON.stringify([sessionId, offeringId]); }

    restore(value: unknown): void {
        if (!Array.isArray(value)) return;
        for (const item of value) {
            if (!record(item) || !identifier(item.sessionId) || !identifier(item.offeringId)
                || typeof item.signature !== 'string' || item.signature.length > 20_000
                || typeof item.observedAt !== 'number' || !Number.isSafeInteger(item.observedAt) || item.observedAt < 0
                || !identifier(item.lastReceiptId, 1_025)) continue;
            const storedNotice = normalizeOwnedManagedPriceNotice(item.notice);
            if (storedNotice && (storedNotice.sessionId !== item.sessionId || storedNotice.pricingUpdate.offeringId !== item.offeringId)) continue;
            // Older versions announced a first observed price. Recover their baseline,
            // but never resurrect that initial-price banner as a merchant adjustment.
            const notice = Object.hasOwn(item, 'usageMultiplierBps') ? storedNotice : undefined;
            const multiplier = Object.hasOwn(item, 'usageMultiplierBps') ? item.usageMultiplierBps : storedNotice?.pricingUpdate.usageMultiplierBps;
            const usageMultiplierBps = typeof multiplier === 'number' && Number.isSafeInteger(multiplier) && multiplier >= 0 ? multiplier : null;
            const key = this.key(item.sessionId, item.offeringId);
            const previous = this.observations.get(key);
            if (previous && previous.observedAt >= item.observedAt) continue;
            this.observations.set(key, { sessionId: item.sessionId, offeringId: item.offeringId,
                signature: item.signature, observedAt: item.observedAt, lastReceiptId: item.lastReceiptId, usageMultiplierBps,
                ...(notice ? { notice } : {}) });
        }
    }

    serialize(): readonly PriceObservation[] { return [...this.observations.values()]; }

    observe(notice: OwnedManagedPriceNotice): { readonly changed: boolean; readonly notice?: OwnedManagedPriceNotice } {
        const update = notice.pricingUpdate;
        const key = this.key(notice.sessionId, update.offeringId);
        const previous = this.observations.get(key);
        if (previous && (update.at < previous.observedAt || update.id === previous.lastReceiptId)) return { changed: false };
        const signature = managedPriceRateSignature(update);
        const nextMultiplier = update.usageMultiplierBps;
        const previousMultiplier = previous?.usageMultiplierBps;
        const serverPreviousMultiplier = update.previousUsageMultiplierBps;
        const validMultiplier = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
        const locallyChanged = Boolean(previous) && (
            validMultiplier(previousMultiplier) && previousMultiplier !== nextMultiplier
            || previous!.signature !== signature && previousMultiplier !== nextMultiplier);
        // An explicit previous server multiplier proves prior usage even before this
        // window has a baseline. A quote ID alone, or first use at 2×, proves no change.
        const serverChanged = validMultiplier(serverPreviousMultiplier) && validMultiplier(nextMultiplier)
            && serverPreviousMultiplier !== nextMultiplier;
        // Do not replay an old quote transition on subsequent equal-multiplier receipts.
        const multiplierChanged = locallyChanged || serverChanged && (!previous || previousMultiplier !== nextMultiplier);
        const previousUsageMultiplierBps = serverChanged ? serverPreviousMultiplier
            : validMultiplier(previousMultiplier) ? previousMultiplier : undefined;
        const changedNotice = multiplierChanged ? { ...notice, pricingUpdate: { ...update,
            ...(previousUsageMultiplierBps !== undefined ? { previousUsageMultiplierBps } : {}) } } : undefined;
        this.observations.set(key, { sessionId: notice.sessionId, offeringId: update.offeringId,
            signature, observedAt: update.at, lastReceiptId: update.id, usageMultiplierBps: nextMultiplier,
            ...(changedNotice || previous?.notice ? { notice: changedNotice || previous?.notice } : {}) });
        return { changed: true, ...(changedNotice ? { notice: changedNotice } : {}) };
    }

    current(sessionId: string, offeringId?: string): OwnedManagedPriceNotice | undefined {
        return [...this.observations.values()].filter(item => item.sessionId === sessionId && item.notice && (offeringId === undefined || item.offeringId === offeringId))
            .sort((a, b) => b.observedAt - a.observedAt)[0]?.notice;
    }

    dismiss(sessionId: string, receiptId: string): boolean {
        for (const [key, item] of this.observations) {
            if (item.sessionId !== sessionId || item.notice?.pricingUpdate.id !== receiptId) continue;
            const { notice: _notice, ...remaining } = item;
            this.observations.set(key, remaining);
            return true;
        }
        return false;
    }
}
