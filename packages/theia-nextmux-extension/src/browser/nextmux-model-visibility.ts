import { createModelVisibilityCatalog, legacyModelVisibilityIdentity, ModelVisibilityCatalog, modelVisibilityCategoryOrder, resolveModelVisibilityId } from './nextmux-model-visibility-identity';
export { createModelVisibilityCatalog, modelVisibilityIdentity, resolveModelVisibilityId, modelVisibilityCategories, modelVisibilityCategoryOrder } from './nextmux-model-visibility-identity';
export type { ModelVisibilityCatalog, ModelVisibilityCatalogEntry, ModelVisibilityCategory, ModelVisibilityMetadata } from './nextmux-model-visibility-identity';

/** Display preferences never remove a saved route, schedule or conversation. */
export const MODEL_VISIBILITY_KEY = 'nextmux.desktop.modelVisibility.v1';
export type ModelVisibilityGroup = 'language' | 'media';
interface ModelVisibilitySelection {
    readonly defaults: Readonly<Record<ModelVisibilityGroup, readonly string[]>>;
    readonly overrides: Readonly<Record<string, boolean>>;
}
export interface ModelVisibilityPreferences extends ModelVisibilitySelection {
    readonly version: 3;
    /** Set only after the first complete public catalog. */
    readonly catalogInitialized: boolean;
    /** Retain removed IDs too, so a reappearing model does not reset a choice. */
    readonly knownModelIds: readonly string[];
    /** Additive membership snapshot; explicit overrides remain authoritative across classification updates. */
    readonly knownModelGroups?: Readonly<Record<string, readonly ModelVisibilityGroup[]>>;
    /** Original v1 data is retained even when its lossy IDs were ambiguous. */
    readonly legacy?: ModelVisibilitySelection;
    /** An initialized v2 record already applied its unambiguous v1 choices. */
    readonly legacyMigrated?: boolean;
}
const emptyCatalog = createModelVisibilityCatalog([]);

export function newModelVisibilityPreferences(catalog?: ModelVisibilityCatalog): ModelVisibilityPreferences {
    const preferences: ModelVisibilityPreferences = { version: 3, catalogInitialized: false, knownModelIds: [],
        defaults: { language: [], media: [] }, overrides: {} };
    return catalog ? migrateModelVisibilityPreferences(preferences, catalog) : preferences;
}

function validIdentity(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 600
        && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
function cleanSelection(value: unknown, legacy: boolean): ModelVisibilitySelection | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const selection = value as ModelVisibilitySelection;
    if (!Array.isArray(selection.defaults?.language) || !Array.isArray(selection.defaults?.media)
        || !selection.overrides || typeof selection.overrides !== 'object' || Array.isArray(selection.overrides)) return undefined;
    const valid = (id: unknown): id is string => validIdentity(id) && (!legacy || /^[a-z0-9]{1,300}$/.test(id));
    const clean = (ids: readonly unknown[]): string[] => [...new Set(ids.filter(valid))].slice(0, 100000);
    return { defaults: { language: clean(selection.defaults.language), media: clean(selection.defaults.media) },
        overrides: Object.fromEntries(Object.entries(selection.overrides).filter(([key, enabled]) => {
            const separator = key.indexOf(':');
            return ['language', 'media'].includes(key.slice(0, separator)) && valid(key.slice(separator + 1)) && typeof enabled === 'boolean';
        }).slice(0, 200000)) };
}

export function parseModelVisibilityPreferences(raw: string | null, legacyDisabled?: Partial<Record<ModelVisibilityGroup, string | null>>, catalog?: ModelVisibilityCatalog): ModelVisibilityPreferences {
    try {
        const value = JSON.parse(raw || 'null');
        if (value?.version === 3 || value?.version === 2) {
            const selection = cleanSelection(value, false);
            if (selection && (value.version === 2 || Array.isArray(value.knownModelIds))) {
                const legacy = cleanSelection(value.legacy, true);
                const preferences: ModelVisibilityPreferences = { ...selection, version: 3,
                    // v2 has no known-ID snapshot: defer its union migration until the complete catalog arrives.
                    catalogInitialized: value.version === 3 && value.catalogInitialized === true,
                    knownModelIds: value.version === 3 ? [...new Set<string>(value.knownModelIds.filter(validIdentity))].slice(0, 100000) : [],
                    ...(value.knownModelGroups && typeof value.knownModelGroups === 'object' && !Array.isArray(value.knownModelGroups) ? { knownModelGroups: Object.fromEntries(Object.entries(value.knownModelGroups).filter(([id, groups]) => validIdentity(id) && Array.isArray(groups)).map(([id, groups]) => [id, [...new Set((groups as unknown[]).filter(group => group === 'language' || group === 'media'))]]).slice(0, 100000)) } : {}),
                    ...(legacy ? { legacy, ...(value.legacyMigrated === true || value.catalogInitialized === true ? { legacyMigrated: true } : {}) } : {}) };
                return catalog ? migrateModelVisibilityPreferences(preferences, catalog) : preferences;
            }
        }
        if (value?.version === 1) {
            const legacy = cleanSelection(value, true);
            if (legacy) {
                const preferences: ModelVisibilityPreferences = { version: 3, catalogInitialized: false, knownModelIds: [],
                    defaults: { language: [], media: [] }, overrides: {}, legacy };
                return catalog ? migrateModelVisibilityPreferences(preferences, catalog) : preferences;
            }
        }
    } catch { /* An invalid display preference must not affect saved model routes. */ }
    let preferences = newModelVisibilityPreferences();
    // Pre-v1 explicit hides kept the original route ID, so retain it exactly.
    for (const group of ['language', 'media'] as const) {
        try {
            const ids = JSON.parse(legacyDisabled?.[group] || 'null');
            if (Array.isArray(ids)) preferences = setModelsVisible(preferences,
                ids.filter(validIdentity), group, false, catalog);
        } catch { /* Invalid legacy display settings cannot affect a saved route. */ }
    }
    return catalog ? migrateModelVisibilityPreferences(preferences, catalog) : preferences;
}

/** Initialize each category in server order, then enable only genuinely new catalog IDs on refresh. */
export function migrateModelVisibilityPreferences(preferences: ModelVisibilityPreferences, catalog: ModelVisibilityCatalog): ModelVisibilityPreferences {
    if (catalog.canonicalIds.size === 0) return preferences;
    if (preferences.catalogInitialized) {
        const known = new Set(preferences.knownModelIds.flatMap(id => [id, resolveModelVisibilityId(id, catalog)]));
        const added = [...catalog.canonicalIds].filter(id => !known.has(id));
        const defaults = { language: new Set(preferences.defaults.language), media: new Set(preferences.defaults.media) };
        const priorDefaults = resolvedSelection(preferences, catalog).defaults;
        const memberships: Record<string, readonly ModelVisibilityGroup[]> = { ...preferences.knownModelGroups };
        let changed = added.length > 0 || !preferences.knownModelGroups;
        if (preferences.defaults.language.length === 20 && catalog.categories.language.length >= 40) {
            for (const category of modelVisibilityCategoryOrder) {
                const group = category === 'language' ? 'language' : 'media';
                for (const id of catalog.categories[category].slice(0, 40)) {
                    if (!defaults[group].has(id)) {
                        defaults[group].add(id);
                        changed = true;
                    }
                }
            }
        }
        for (const id of catalog.canonicalIds) {
            const current = [...new Set((catalog.modelCategories.get(id) || []).map(category => category === 'language' ? 'language' as const : 'media' as const))];
            const selectedGroups = (['language', 'media'] as const).filter(group => priorDefaults[group].has(id));
            const previous = memberships[id] || (known.has(id)
                ? selectedGroups.length ? selectedGroups : [...new Set((catalog.legacyModelCategories.get(id) || []).map(category => category === 'language' ? 'language' as const : 'media' as const))] : []);
            for (const group of current) if (!previous.includes(group)) { defaults[group].add(id); changed = true; }
            if (!memberships[id]) changed = true;
            memberships[id] = [...new Set([...previous, ...current])];
        }
        if (!changed) return preferences;
        return { ...preferences, defaults: { language: [...defaults.language], media: [...defaults.media] }, knownModelGroups: memberships,
            knownModelIds: [...new Set([...preferences.knownModelIds, ...added])] };
    }
    const defaults = { language: new Set<string>(), media: new Set<string>() };
    for (const group of ['language', 'media'] as const) {
        // Preserve every previous default, even when temporarily absent from the catalog.
        for (const id of preferences.defaults[group]) defaults[group].add(resolveModelVisibilityId(id, catalog));
        for (const id of (!preferences.legacyMigrated && preferences.legacy?.defaults[group]) || []) {
            const canonical = catalog.legacyAliases.get(id);
            if (canonical) defaults[group].add(canonical);
        }
    }
    for (const category of modelVisibilityCategoryOrder) {
        const group = category === 'language' ? 'language' : 'media';
        for (const id of catalog.categories[category].slice(0, 40)) defaults[group].add(id);
    }
    const overrides: Record<string, boolean> = {};
    for (const [key, visible] of Object.entries(!preferences.legacyMigrated && preferences.legacy?.overrides || {})) {
        const separator = key.indexOf(':');
        const canonical = catalog.legacyAliases.get(key.slice(separator + 1));
        if (canonical) overrides[`${key.slice(0, separator)}:${canonical}`] = visible;
    }
    // Exact choices made since v1 was loaded take precedence over its migration.
    return { ...preferences, defaults: { language: [...defaults.language], media: [...defaults.media] },
        overrides: { ...overrides, ...resolvedSelection(preferences, catalog).overrides },
        knownModelIds: [...catalog.canonicalIds], knownModelGroups: Object.fromEntries([...catalog.modelCategories].map(([id, categories]) => [id, [...new Set(categories.map(category => category === 'language' ? 'language' : 'media'))]])), catalogInitialized: true, ...(preferences.legacy ? { legacyMigrated: true } : {}) };
}

interface ResolvedSelection {
    readonly defaults: Readonly<Record<ModelVisibilityGroup, ReadonlySet<string>>>;
    readonly overrides: Readonly<Record<string, boolean>>;
}
// Immutable preferences and catalog snapshots let picker reads reuse resolved sets.
const selectionCache = new WeakMap<ModelVisibilityCatalog, WeakMap<ModelVisibilityPreferences, ResolvedSelection>>();
function resolvedSelection(preferences: ModelVisibilityPreferences, catalog: ModelVisibilityCatalog): ResolvedSelection {
    let catalogCache = selectionCache.get(catalog);
    if (!catalogCache) { catalogCache = new WeakMap(); selectionCache.set(catalog, catalogCache); }
    const cached = catalogCache.get(preferences);
    if (cached) return cached;
    const overrides: Record<string, boolean> = {};
    for (const [key, visible] of Object.entries(preferences.overrides)) {
        const separator = key.indexOf(':');
        const canonical = resolveModelVisibilityId(key.slice(separator + 1), catalog);
        const resolvedKey = `${key.slice(0, separator)}:${canonical}`;
        // Exact canonical choices win; otherwise retain a hide when aliases conflict.
        overrides[resolvedKey] = Object.hasOwn(preferences.overrides, resolvedKey)
            ? preferences.overrides[resolvedKey] : overrides[resolvedKey] === false ? false : visible;
    }
    const selection = { defaults: {
        language: new Set(preferences.defaults.language.map(id => resolveModelVisibilityId(id, catalog))),
        media: new Set(preferences.defaults.media.map(id => resolveModelVisibilityId(id, catalog)))
    }, overrides };
    catalogCache.set(preferences, selection);
    return selection;
}

export function isModelVisible(preferences: ModelVisibilityPreferences, id: string, group: ModelVisibilityGroup, catalog?: ModelVisibilityCatalog): boolean {
    const index = catalog || emptyCatalog;
    const identity = resolveModelVisibilityId(id, index);
    const selection = resolvedSelection(preferences, index);
    const override = selection.overrides[`${group}:${identity}`];
    if (typeof override === 'boolean') return override;
    // Custom own-API IDs cannot have a checkbox in the public directory.
    if (!index.canonicalIds.has(identity)) return true;
    // v1 choices remain useful while its complete-catalog migration is pending.
    if (!preferences.catalogInitialized && !preferences.legacyMigrated && preferences.legacy) {
        const legacyId = legacyModelVisibilityIdentity(identity);
        if (index.legacyAliases.get(legacyId) === identity) {
            const legacyOverride = preferences.legacy.overrides[`${group}:${legacyId}`];
            if (typeof legacyOverride === 'boolean') return legacyOverride;
            if (preferences.legacy.defaults[group].includes(legacyId)) return true;
        }
    }
    return selection.defaults[group].has(identity);
}

export function setModelsVisible(preferences: ModelVisibilityPreferences, ids: readonly string[], group: ModelVisibilityGroup, visible: boolean, catalog?: ModelVisibilityCatalog): ModelVisibilityPreferences {
    const index = catalog || emptyCatalog;
    return { ...preferences, overrides: { ...preferences.overrides,
        ...Object.fromEntries(ids.filter(validIdentity).map(id => resolveModelVisibilityId(id, index)).map(id => [`${group}:${id}`, visible])) } };
}

/** The user's explicit choice for a model, if any. Not being in the default set is not a choice. */
export function modelVisibilityOverride(preferences: ModelVisibilityPreferences, id: string, group: ModelVisibilityGroup, catalog?: ModelVisibilityCatalog): boolean | undefined {
    const index = catalog || emptyCatalog;
    const override = resolvedSelection(preferences, index).overrides[`${group}:${resolveModelVisibilityId(id, index)}`];
    return typeof override === 'boolean' ? override : undefined;
}
