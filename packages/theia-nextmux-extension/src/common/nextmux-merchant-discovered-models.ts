import type { PlatformMerchantDiscoveredModel, PlatformMerchantDiscoveredModelsPage } from './nextmux-platform-protocol';
import { MODEL_TASK_CATEGORIES, type ModelTaskCategory } from '@nextmux/model-runtime/model-task-capabilities';
import { normalizeModelCapacity } from './nextmux-context-budget';
import { normalizePublicPriceDetails } from './nextmux-public-price-details';
import { normalizePublicMerchantDirectory, normalizePublicMerchantStoreProfile } from './nextmux-public-merchants';

export function validDiscoveredModelCursor(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 160 && !/[\u0000-\u0020\u007f]/u.test(value);
}

/** Whitelist public cache metadata, including slash-delimited model cursors. */
export function normalizeMerchantDiscoveredModels(value: unknown, merchantId: string, after = ''): PlatformMerchantDiscoveredModelsPage {
    const page = value as PlatformMerchantDiscoveredModelsPage | null;
    const invalid = (): never => { throw new Error('MERCHANT_DISCOVERED_MODELS_INVALID'); };
    if (!page || page.merchantId !== merchantId || !Array.isArray(page.models) || page.models.length > 100
        || !['ready', 'pending', 'unavailable'].includes(page.state)
        || typeof page.measuredAt !== 'string' || !Number.isFinite(Date.parse(page.measuredAt))
        || page.reason !== undefined && !['no_active_endpoint', 'no_available_key', 'discovery_pending', 'discovery_failed', 'no_models'].includes(page.reason)
        || page.nextCursor !== undefined && (!validDiscoveredModelCursor(page.nextCursor) || page.nextCursor <= after)) return invalid();
    const seen = new Set<string>();
    const list = (input: unknown): string[] => {
        // The platform aggregates one model's listings across the merchant's APIs, so a popular model can carry many.
        if (!Array.isArray(input) || input.length > 512 || input.some(item => typeof item !== 'string' || item.length > 100)) return invalid();
        return [...input];
    };
    const models = page.models.map(model => {
        if (!model || !validDiscoveredModelCursor(model.id) || !model.id || model.id <= after || seen.has(model.id)
            || typeof model.displayName !== 'string' || model.displayName.length > 512
            || model.canonicalModel !== undefined && (!validDiscoveredModelCursor(model.canonicalModel) || !model.canonicalModel)
            || !Number.isFinite(model.discoveredAt) || model.discoveredAt < 0
            || model.multiplierBps !== null && (!Number.isSafeInteger(model.multiplierBps) || model.multiplierBps < 100 || model.multiplierBps > 1_000_000)) return invalid();
        seen.add(model.id);
        // Past the page's identity and order checks, one model the desktop cannot read is left out on its own; the
        // healthy models of the page stay (audit A04-03).
        try {
        if (model.execution && (!['executable', 'unavailable'].includes(model.execution.state) || model.execution.reason !== undefined && !['official_model_retired', 'route_unavailable', 'not_published'].includes(model.execution.reason))) return invalid();
        if (model.pricing !== undefined && (!Array.isArray(model.pricing) || model.pricing.length > 512)) return invalid();
        const pricing = model.pricing?.map((row: NonNullable<PlatformMerchantDiscoveredModel['pricing']>[number]) => {
            if (row.listingId !== undefined && (typeof row.listingId !== 'string' || row.listingId.length > 100)) return invalid();
            return { ...normalizePublicPriceDetails(row), ...(row.listingId ? { listingId: row.listingId } : {}) };
        });
        const fidelity = model.fidelity && typeof model.fidelity.index === 'number' && model.fidelity.index >= 0 && model.fidelity.index <= 100
            && Number.isSafeInteger(model.fidelity.sampleCount) && model.fidelity.sampleCount > 0 && ['low', 'medium', 'high', 'very_high'].includes(model.fidelity.confidence)
            ? { index: model.fidelity.index, sampleCount: model.fidelity.sampleCount, confidence: model.fidelity.confidence } : undefined;
        // Preserve display purpose without copying transport/authorization metadata.
        // Keep bounded future kinds so the classifier can conservatively show "other".
        const kind = typeof model.kind === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(model.kind) ? model.kind : undefined;
        const taskCategories = Array.isArray(model.taskCategories) ? [...new Set<ModelTaskCategory>(model.taskCategories.slice(0, 32)
            .filter((task: unknown): task is ModelTaskCategory => typeof task === 'string' && MODEL_TASK_CATEGORIES.includes(task as ModelTaskCategory)))] : [];
        return { id: model.id, displayName: model.displayName, ...(model.canonicalModel ? { canonicalModel: model.canonicalModel } : {}), ...(fidelity ? { fidelity } : {}),
            ...(kind ? { kind } : {}), ...(taskCategories.length ? { taskCategories } : {}),
            ...normalizeModelCapacity(model), input: list(model.input), output: list(model.output), capabilities: list(model.capabilities),
            discoveredAt: model.discoveredAt, multiplierBps: model.multiplierBps, listingIds: list(model.listingIds),
            ...(model.categories ? { categories: list(model.categories) } : {}), ...(pricing ? { pricing } : {}),
            ...(model.execution ? { execution: { state: model.execution.state, ...(model.execution.reason ? { reason: model.execution.reason } : {}), ...(model.execution.listingIds ? { listingIds: list(model.execution.listingIds) } : {}) } } : {}) };
        } catch { return undefined; }
    });
    // A scanned page can contain only duplicate aliases or retired models.
    // Its advancing scan cursor still leads to later visible rows.
    if (page.nextCursor && page.models.length && page.nextCursor !== page.models.at(-1)?.id) return invalid();
    if (page.stats && (!Number.isSafeInteger(page.stats.discoveredCount) || page.stats.discoveredCount < models.length
        || !Number.isSafeInteger(page.stats.executableCount) || page.stats.executableCount < 0)
        || page.catalogMeasuredAt !== undefined && !Number.isFinite(Date.parse(page.catalogMeasuredAt))) return invalid();
    if (page.merchant && page.merchant.id !== merchantId) return invalid();
    const merchant = page.merchant ? normalizePublicMerchantDirectory({ merchants: [page.merchant], measuredAt: page.measuredAt }).merchants[0] : undefined;
    return { merchantId, models: models.filter((model): model is NonNullable<typeof model> => Boolean(model)), state: page.state, measuredAt: page.measuredAt,
        ...normalizePublicMerchantStoreProfile(page), ...(merchant ? { merchant } : {}),
        ...(page.reason ? { reason: page.reason } : {}), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        ...(page.stats ? { stats: { ...page.stats } } : {}), ...(page.catalogMeasuredAt ? { catalogMeasuredAt: page.catalogMeasuredAt } : {}) };
}
