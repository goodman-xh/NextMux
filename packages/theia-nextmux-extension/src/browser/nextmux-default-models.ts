import type {
    ComicStepDefault,
    ComicStepDefaultKind,
    ComicStepDefaultStep,
    PlatformOffering
} from '../common/nextmux-platform-protocol';
import { managedRelayKey } from './nextmux-model-route-selection';

/**
 * Pure 4-surface platform default model resolution helpers:
 * 1. Coding (`coding` × `coding`)
 * 2. Comic chat (`comic_chat` × `text|image|video|speech|music`, fallback `novel`)
 * 3. Infinite canvas (`canvas` × `text|image|video`, fallback active comic kind)
 * 4. Comic 4-tab studio (`novel|image|topic|music` × step)
 *
 * Explicit user selections and the user's own API (BYOK / local) always win.
 */

export function normalizeDefaultModelId(value: string): string {
    return value.trim().replace(/^~/, '').replace(/^models\//i, '').toLocaleLowerCase().replace(/\s+/g, '-');
}

export function resolvePlatformDefaultForKind(
    defaults: readonly ComicStepDefault[] | undefined,
    primaryKind: ComicStepDefaultKind,
    step: ComicStepDefaultStep | string,
    fallbackKind?: ComicStepDefaultKind
): ComicStepDefault | undefined {
    const list = defaults || [];
    const primary = list.find(item => item.kind === primaryKind && item.step === step);
    if (primary) return primary;
    if (fallbackKind && fallbackKind !== primaryKind) {
        return list.find(item => item.kind === fallbackKind && item.step === step);
    }
    return undefined;
}

export interface CodingPlatformDefaultInput {
    readonly defaults: readonly ComicStepDefault[] | undefined;
    readonly offerings: readonly PlatformOffering[];
    /** True when the user already has an explicit, saved, session, council, or BYOK/local coding choice. */
    readonly hasExplicitSelection: boolean;
    /** False while the preferred merchant's catalog snapshot is still loading so we do not prematurely pick another relay. */
    readonly allowCrossMerchantFallback?: boolean;
    readonly offeringMerchantId?: (offering: PlatformOffering) => string;
    readonly normalizeModel?: (model: string) => string;
}

export interface CodingPlatformDefaultResolution {
    readonly relayKey: string;
    readonly routeId: string;
    readonly modelId: string;
    readonly merchantId: string;
    readonly offering: PlatformOffering;
    readonly matchedPreferredMerchant: boolean;
}

function offeringMatchesModel(
    offering: PlatformOffering,
    targetModel: string,
    normalize: (model: string) => string
): boolean {
    if (!targetModel) return false;
    const primary = typeof offering.canonicalModel === 'string' && offering.canonicalModel.trim()
        ? offering.canonicalModel
        : offering.providerModelCode || offering.registryModelId || '';
    return Boolean(primary && normalize(primary) === targetModel);
}

function isEligibleCodingOffering(offering: PlatformOffering): boolean {
    return offering.status === 'active'
        && offering.available !== false
        && offering.codingAvailability?.available !== false;
}

/**
 * Resolves the platform default Coding model ONLY when the user has not explicitly
 * configured/selected a Coding model or provider (and has no active BYOK/local coding choice).
 * Exact `merchantId + canonicalModel` matches first; falls back to `canonicalModel` across
 * healthy Coding relays when the preferred merchant is temporarily absent.
 */
export function resolveCodingPlatformDefault(
    input: CodingPlatformDefaultInput
): CodingPlatformDefaultResolution | undefined {
    if (input.hasExplicitSelection) return undefined;
    const entry = resolvePlatformDefaultForKind(input.defaults, 'coding', 'coding');
    if (!entry || !entry.merchantId || !entry.canonicalModel) return undefined;
    const normalize = input.normalizeModel ?? normalizeDefaultModelId;
    const merchantOf = input.offeringMerchantId ?? ((offering: PlatformOffering) => String(offering.merchantId || '').trim());
    const targetModel = normalize(entry.canonicalModel);
    if (!targetModel) return undefined;
    const eligible = (input.offerings || []).filter(isEligibleCodingOffering);
    const byScoreDesc = (left: PlatformOffering, right: PlatformOffering): number =>
        (Number(right.routeScore) || 0) - (Number(left.routeScore) || 0);

    const exact = eligible
        .filter(offering => merchantOf(offering) === entry.merchantId && offeringMatchesModel(offering, targetModel, normalize))
        .sort(byScoreDesc)[0];
    if (exact) {
        const merchantId = merchantOf(exact) || entry.merchantId;
        return {
            relayKey: managedRelayKey(merchantId),
            routeId: `managed:fixed:${exact.id}`,
            modelId: normalize(exact.canonicalModel || entry.canonicalModel),
            merchantId,
            offering: exact,
            matchedPreferredMerchant: true
        };
    }

    if (input.allowCrossMerchantFallback === false) return undefined;

    const fallback = eligible
        .filter(offering => Boolean(merchantOf(offering)) && offeringMatchesModel(offering, targetModel, normalize))
        .sort(byScoreDesc)[0];
    if (!fallback) return undefined;
    const merchantId = merchantOf(fallback);
    return {
        relayKey: managedRelayKey(merchantId),
        routeId: `managed:fixed:${fallback.id}`,
        modelId: normalize(fallback.canonicalModel || entry.canonicalModel),
        merchantId,
        offering: fallback,
        matchedPreferredMerchant: false
    };
}

/**
 * Determines the initial `recommended` toggle for Comic Chat:
 * - Honors an explicitly stored boolean (`'nextmux.desktop.comicChatRecommended.v1'`).
 * - When unset (first launch) and the user has NOT manually chosen a comic-chat model, relay, or pinned mode, defaults to `true`.
 * - When unset but the user already has a manually saved model/relay choice, defaults to `false`.
 */
export function resolveComicChatRecommendedInitial(input: {
    readonly storedRecommended: unknown;
    readonly storedModels?: Readonly<Record<string, string>>;
    readonly storedRelay?: string;
    readonly storedPinned?: readonly string[];
}): boolean {
    if (typeof input.storedRecommended === 'boolean') return input.storedRecommended;
    const hasRelay = typeof input.storedRelay === 'string' && input.storedRelay.trim().length > 0;
    const hasModels = Boolean(input.storedModels && Object.keys(input.storedModels).length > 0);
    const hasPinned = Boolean(input.storedPinned && input.storedPinned.length > 0);
    return !(hasRelay || hasModels || hasPinned);
}

export interface CanvasChoiceLike {
    readonly key: string;
    readonly modelId: string;
    readonly routeKind?: 'relay' | 'own';
    readonly sourceKey?: string;
}

/**
 * Matches a canvas platform default (`kind === 'canvas'`, fallback to active comic kind)
 * against available canvas choices without overriding explicit user choices or the user's own API.
 */
export function resolveCanvasPlatformDefaultChoice<T extends CanvasChoiceLike>(input: {
    readonly defaults: readonly ComicStepDefault[] | undefined;
    readonly step: 'image' | 'video';
    readonly fallbackKind?: ComicStepDefaultKind;
    readonly choices: readonly T[];
    readonly canonicalModelOf?: (choice: T) => string | undefined;
    readonly normalizeModel?: (model: string) => string;
}): T | undefined {
    const entry = resolvePlatformDefaultForKind(input.defaults, 'canvas', input.step, input.fallbackKind);
    if (!entry || !entry.merchantId || !entry.canonicalModel) return undefined;
    const normalize = input.normalizeModel ?? normalizeDefaultModelId;
    const targetModel = normalize(entry.canonicalModel);
    const targetSourceKey = managedRelayKey(entry.merchantId);
    const matchesChoiceModel = (choice: T): boolean => {
        const canonical = input.canonicalModelOf?.(choice);
        if (canonical && normalize(canonical) === targetModel) return true;
        return normalize(choice.modelId) === targetModel;
    };
    const exact = input.choices.find(choice => choice.sourceKey === targetSourceKey && matchesChoiceModel(choice));
    if (exact) return exact;
    return input.choices.find(choice => choice.routeKind !== 'own' && matchesChoiceModel(choice));
}

/**
 * Returns unique merchant IDs referenced by platform defaults whose models are not yet
 * covered by the currently loaded platform offerings or merchant snapshots.
 */
export function missingPlatformDefaultMerchantIds(input: {
    readonly defaults: readonly ComicStepDefault[] | undefined;
    readonly platformOfferings: readonly PlatformOffering[];
    readonly loadedMerchantIds: ReadonlySet<string>;
    readonly removedMerchantIds?: ReadonlySet<string>;
    readonly offeringMerchantId?: (offering: PlatformOffering) => string;
    readonly normalizeModel?: (model: string) => string;
}): readonly string[] {
    const defaults = input.defaults || [];
    if (!defaults.length) return [];
    const merchantOf = input.offeringMerchantId ?? ((offering: PlatformOffering) => String(offering.merchantId || '').trim());
    const normalize = input.normalizeModel ?? normalizeDefaultModelId;
    const missing = new Set<string>();
    for (const item of defaults) {
        const merchantId = String(item.merchantId || '').trim();
        if (!merchantId) continue;
        if (input.loadedMerchantIds.has(merchantId) || input.removedMerchantIds?.has(merchantId)) continue;
        const target = normalize(item.canonicalModel);
        const alreadyInCatalog = input.platformOfferings.some(offering =>
            offering.status === 'active'
            && offering.available !== false
            && merchantOf(offering) === merchantId
            && offeringMatchesModel(offering, target, normalize)
        );
        if (!alreadyInCatalog) missing.add(merchantId);
    }
    return [...missing];
}
