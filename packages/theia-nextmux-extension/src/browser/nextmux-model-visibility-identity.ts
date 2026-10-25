import { modelTaskCategories, type ModelTaskMetadata } from '@nextmux/model-runtime/model-task-capabilities';

/**
 * Public base-model IDs belong to the original author. Serving providers and
 * local connection names are aliases only when the public catalog says so.
 * See models.dev's base_model contract: https://github.com/anomalyco/models.dev
 */
export type ModelVisibilityCategory = 'language' | '3d' | 'image' | 'video' | 'speech' | 'music' | 'soundEffect' | 'transcription';
export const modelVisibilityCategoryOrder: readonly ModelVisibilityCategory[] = ['language', '3d', 'image', 'video', 'speech', 'music', 'soundEffect', 'transcription'];

export interface ModelVisibilityMetadata extends ModelTaskMetadata {}

/** Discovery categories can overlap; execution still checks the selected route's adapter and declarations. */
export function modelVisibilityCategories(model: ModelVisibilityMetadata): readonly ModelVisibilityCategory[] {
    return modelTaskCategories(model).flatMap(task => task === 'sound_effect' ? ['soundEffect' as const]
        : modelVisibilityCategoryOrder.includes(task as ModelVisibilityCategory) ? [task as ModelVisibilityCategory] : []);
}

/** v3 originally stored IDs, not membership. This is only the bridge for that old single-kind snapshot. */
function legacyVisibilityCategories(model: ModelVisibilityMetadata): readonly ModelVisibilityCategory[] {
    const kind = model.kind?.toLowerCase();
    if (kind === 'llm') return ['language'];
    if (kind === '3d') return ['3d'];
    if (kind === 'image' || kind === 'video' || kind === 'music' || kind === 'transcription' || kind === 'speech') return [kind];
    if (kind === 'audio' || kind === 'sound_effect') return Array.isArray(model.capabilities) && model.capabilities.some(value => /^(sound_effect_generation|text_to_sound_effect)$/.test(String(value).replace(/[ -]/g, '_'))) ? ['soundEffect'] : [];
    return kind ? [] : modelVisibilityCategories(model);
}

export interface ModelVisibilityCatalogEntry extends ModelVisibilityMetadata {
    readonly canonicalModel: string;
    readonly provider: string;
    readonly aliases?: readonly string[];
    readonly recommendedGroups?: readonly ('language' | 'media')[];
}

export interface ModelVisibilityCatalog {
    readonly canonicalIds: ReadonlySet<string>;
    /** Each list retains the server order, including models beyond its first 20. */
    readonly categories: Readonly<Record<ModelVisibilityCategory, readonly string[]>>;
    readonly modelCategories: ReadonlyMap<string, readonly ModelVisibilityCategory[]>;
    readonly legacyModelCategories: ReadonlyMap<string, readonly ModelVisibilityCategory[]>;
    readonly recommendations: Readonly<Record<'language' | 'media', readonly string[]>>;
    readonly exactAliases: ReadonlyMap<string, string | null>;
    readonly routeAliases: ReadonlyMap<string, string | null>;
    /** Used solely for the one-time migration of the old lossy preferences. */
    readonly legacyAliases: ReadonlyMap<string, string | null>;
}

/** Identity deliberately retains the author, punctuation, version and case. */
export function modelVisibilityIdentity(id: string): string {
    return id.trim();
}

function routeSpelling(id: string): string {
    return id.trim().replace(/^~/, '').replace(/^models\//i, '').toLowerCase().replace(/\s+/g, '-');
}

export function legacyModelVisibilityIdentity(id: string): string {
    return (id.trim().toLowerCase().split('/').pop() || '').replace(/[^a-z0-9]/g, '');
}

export function createModelVisibilityCatalog(entries: readonly ModelVisibilityCatalogEntry[]): ModelVisibilityCatalog {
    const canonicalIds = new Set<string>();
    const categories: Record<ModelVisibilityCategory, Set<string>> = {
        language: new Set(), '3d': new Set(), image: new Set(), video: new Set(), speech: new Set(), music: new Set(), soundEffect: new Set(), transcription: new Set()
    };
    const modelCategories = new Map<string, readonly ModelVisibilityCategory[]>();
    const legacyModelCategories = new Map<string, readonly ModelVisibilityCategory[]>();
    const recommendations = { language: new Set<string>(), media: new Set<string>() };
    const exactAliases = new Map<string, string | null>();
    const routeAliases = new Map<string, string | null>();
    const legacyAliases = new Map<string, string | null>();
    const add = (index: Map<string, string | null>, alias: string, canonical: string): void => {
        if (!alias) return;
        const previous = index.get(alias);
        index.set(alias, previous === undefined || previous === canonical ? canonical : null);
    };
    for (const entry of entries) {
        const canonical = modelVisibilityIdentity(entry.canonicalModel);
        // A public identity must identify an author, not an API deployment.
        if (!canonical.includes('/') || canonical.startsWith('/') || canonical.endsWith('/')) continue;
        canonicalIds.add(canonical);
        const entryCategories = [...new Set([...(modelCategories.get(canonical) || []), ...modelVisibilityCategories(entry)])];
        modelCategories.set(canonical, entryCategories);
        legacyModelCategories.set(canonical, [...new Set([...(legacyModelCategories.get(canonical) || []), ...legacyVisibilityCategories(entry)])]);
        for (const category of entryCategories) categories[category].add(canonical);
        for (const group of entry.recommendedGroups || []) {
            if (group === 'language' || group === 'media') recommendations[group].add(canonical);
        }
        const model = canonical.slice(canonical.indexOf('/') + 1);
        const publicAliases = (entry.aliases || []).flatMap(alias => {
            // A public author-qualified alias also documents its exact API
            // model spelling. Its unqualified form must still be unique.
            const separator = alias.indexOf('/');
            return separator > 0 ? [alias, alias.slice(separator + 1)] : [alias];
        });
        for (const value of [canonical, model, ...publicAliases]) {
            const alias = modelVisibilityIdentity(value);
            add(exactAliases, alias, canonical);
            add(routeAliases, routeSpelling(alias), canonical);
            add(legacyAliases, legacyModelVisibilityIdentity(alias), canonical);
        }
    }
    return { canonicalIds, categories: { language: [...categories.language], '3d': [...categories['3d']], image: [...categories.image], video: [...categories.video],
        speech: [...categories.speech], music: [...categories.music], soundEffect: [...categories.soundEffect], transcription: [...categories.transcription] },
        modelCategories, legacyModelCategories, recommendations: { language: [...recommendations.language], media: [...recommendations.media] }, exactAliases, routeAliases, legacyAliases };
}

/**
 * Match exact public IDs first, then unique public aliases. An unknown author
 * prefix is never removed to make an unrelated model match a familiar name.
 */
export function resolveModelVisibilityId(id: string, catalog?: ModelVisibilityCatalog): string {
    const identity = modelVisibilityIdentity(id);
    if (!catalog || catalog.canonicalIds.has(identity)) return identity;
    if (catalog.exactAliases.has(identity)) return catalog.exactAliases.get(identity) || identity;
    return catalog.routeAliases.get(routeSpelling(identity)) || identity;
}
