import { createHash } from 'crypto';
import { normalizeNativeWebResearchDeclaration, type NativeWebResearchDeclaration } from '@nextmux/model-runtime/native-web-research';
import type { ToolExecutionContext } from '@nextmux/agent-runtime';
import type { ManagedGatewayRoute, ModelSwitchPolicy, PlatformOffering } from '../common/nextmux-platform-protocol';

/** Invalid optional capability metadata must not remove an otherwise usable model. */
export function normalizeManagedWebResearch(value: unknown): PlatformOffering['nativeWebResearch'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    const declaration = normalizeNativeWebResearchDeclaration({ version: 1, profile: raw.profile,
        search: raw.search, fetch: raw.fetch, source: raw.source });
    if (!declaration || !['provider_metadata', 'live_probe', 'merchant_declaration'].includes(declaration.source)
        || typeof raw.boundedSearch !== 'boolean') return undefined;
    const proved = declaration.source !== 'merchant_declaration';
    return { profile: declaration.profile, source: declaration.source as 'provider_metadata' | 'live_probe' | 'merchant_declaration',
        search: proved && raw.boundedSearch ? declaration.search : declaration.search === 'unsupported' ? 'unsupported' : 'unknown',
        fetch: proved ? declaration.fetch : declaration.fetch === 'unsupported' ? 'unsupported' : 'unknown',
        boundedSearch: proved && raw.boundedSearch,
        ...(raw.searchEngine === 'parallel' && ['basic', 'turbo'].includes(String(raw.searchMode))
            ? { searchEngine: 'parallel' as const, searchMode: raw.searchMode as 'basic' | 'turbo' } : {}),
        ...(typeof raw.reasonCode === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(raw.reasonCode) ? { reasonCode: raw.reasonCode } : {}) };
}

/** Server still chooses the credential; the client only decides which tools can be offered. */
export function managedWebResearchCapabilities(offerings: readonly PlatformOffering[], route: ManagedGatewayRoute,
    policy: ModelSwitchPolicy): { search: boolean; fetch: boolean; declaration?: NativeWebResearchDeclaration; searchMode?: 'basic' | 'turbo' } {
    const selected = route.mode === 'fixed' ? offerings.find(item => item.id === route.offeringId) : undefined;
    const candidates = offerings.filter(item => {
        if (item.available === false || item.status !== 'active') return false;
        if (route.mode === 'automatic') return item.registryModelId === route.registryModelId;
        if (policy.mode === 'single_route') return item.id === route.offeringId;
        if (!selected || item.registryModelId !== selected.registryModelId) return item.id === route.offeringId;
        return policy.merchantScope === 'eligible_marketplace' || item.merchantId === selected.merchantId;
    }).map(item => normalizeManagedWebResearch(item.nativeWebResearch)).filter(item => item !== undefined);
    const searchable = candidates.find(item => item.search === 'supported');
    const fetchable = candidates.find(item => item.fetch === 'supported');
    const descriptor = searchable || fetchable;
    return { search: Boolean(searchable), fetch: Boolean(fetchable), ...(searchable?.searchMode ? { searchMode: searchable.searchMode } : {}), ...(descriptor ? {
        declaration: { version: 1, profile: descriptor.profile, search: searchable ? 'supported' : 'unknown',
            fetch: fetchable ? 'supported' : 'unknown', source: descriptor.source }
    } : {}) };
}

/** Recovery reuses the original paid operation; a later model batch may intentionally research again. */
export function managedWebResearchRequestKey(context: Pick<ToolExecutionContext, 'executionScopeId' | 'executionId' | 'runId'>,
    operation: 'search' | 'fetch', input: unknown): string {
    // Tool input has already passed the strict schema. Sort object keys so a provider's
    // serialization order cannot change a saved financial request identity.
    const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => [key, stable(entry)])) : value;
    const digest = createHash('sha256').update(JSON.stringify([context.executionScopeId || context.runId,
        context.executionId || context.runId, operation, stable(input)])).digest('hex');
    return `desktop-web-${digest}`;
}
