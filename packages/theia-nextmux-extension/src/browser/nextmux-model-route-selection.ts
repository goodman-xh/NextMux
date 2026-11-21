import { declaredReasoningEfforts } from '../common/nextmux-model-controls';
import { groupModelsByName, modelNameGroupKey } from '../common/nextmux-model-name';
import type { ModelContract } from '@nextmux/model-runtime';
import type { AgentReasoningEffort } from '@nextmux/agent-runtime';
import { effectiveModelCapabilityEvidence, modelCapabilityHasVerifiedSupport } from '@nextmux/model-runtime/capabilities';
import type { ModelCapabilityEvidence } from '@nextmux/model-runtime';

export interface SelectableModelRoute {
    readonly id: string;
    readonly modelId: string;
    /** False when the model is catalog-visible but lacks a verified generation probe. */
    readonly selectable?: boolean;
}

export type ModelReasoningEffort = AgentReasoningEffort;

export interface ModelPickerCandidate {
    readonly id: string;
    readonly identity: string;
}

export function partitionModelPickerCandidates<T extends ModelPickerCandidate>(
    candidates: readonly T[],
    selectableModelIds: ReadonlySet<string>,
    groupSnapshots = false,
    preferredModelId?: string
): { readonly selectable: readonly T[]; readonly unavailable: readonly T[] } {
    // Verify each exact route before collapsing display snapshots. A verified
    // snapshot cannot make an unverified floating ID executable. Callers opt in
    // after filtering visibility/search. Keep the selected exact entry when supplied.
    const identity = (candidate: T): string => groupSnapshots ? modelNameGroupKey(candidate.identity) : candidate.identity;
    const uniqueByIdentity = (values: readonly T[]): readonly T[] => groupSnapshots
        ? groupModelsByName(values, value => value.identity, values.find(value => value.id === preferredModelId))
        : [...new Map(values.map(value => [value.identity, value] as const)).values()];
    const selectable = uniqueByIdentity(candidates.filter(candidate => selectableModelIds.has(candidate.id)));
    const selectableIdentities = new Set(selectable.map(identity));
    const unavailable = uniqueByIdentity(candidates.filter(candidate => !selectableModelIds.has(candidate.id)
        && !selectableIdentities.has(identity(candidate))));
    return { selectable, unavailable };
}

export type ModelRouteCapabilityState = 'verified' | 'unverified' | 'unsupported' | 'unknown';
export type ModelRouteUnavailableReason =
    | 'generation_unverified'
    | 'generation_unsupported'
    | 'tools_unverified'
    | 'tools_unsupported';

function routeCapabilityState(
    evidence: readonly ModelCapabilityEvidence[],
    capability: 'model:generatable' | 'tools'
): ModelRouteCapabilityState {
    const effective = effectiveModelCapabilityEvidence(evidence, capability);
    if (!effective || effective.support === 'unknown') return 'unknown';
    if (effective.support === 'unsupported') return 'unsupported';
    return effective.confidence === 'verified' ? 'verified' : 'unverified';
}

export function modelRouteCapabilityGate(
    evidence: readonly ModelCapabilityEvidence[],
    requireTools: boolean
): {
    readonly generation: ModelRouteCapabilityState;
    readonly tools: ModelRouteCapabilityState;
    readonly selectable: boolean;
    readonly reason?: ModelRouteUnavailableReason;
} {
    const generation = routeCapabilityState(evidence, 'model:generatable');
    const tools = routeCapabilityState(evidence, 'tools');
    if (generation !== 'verified') {
        return {
            generation,
            tools,
            selectable: false,
            reason: generation === 'unsupported' ? 'generation_unsupported' : 'generation_unverified'
        };
    }
    if (requireTools && tools !== 'verified') {
        return {
            generation,
            tools,
            selectable: false,
            reason: tools === 'unsupported' ? 'tools_unsupported' : 'tools_unverified'
        };
    }
    return { generation, tools, selectable: true };
}

export function isVerifiedModelRoute(
    evidence: readonly ModelCapabilityEvidence[],
    requireTools = false
): boolean {
    return requireTools
        ? modelRouteCapabilityGate(evidence, true).selectable
        : modelCapabilityHasVerifiedSupport(evidence, 'model:generatable');
}

/**
 * What is still unproven about a model of the user's own API that a tool-using picker offers: nothing answered yet
 * ('untested': saved (Save makes no model call), or its API's list could not be read or left it out), no check of its
 * tool calls ('tools_unverified'), or an earlier check it answered without the tool call ('tools_failed'). It orders the
 * picker (proven first) and is kept as diagnostics; the row shows no warning, since nothing in the app tests models.
 */
export type OwnApiRouteHint = 'untested' | 'tools_unverified' | 'tools_failed';

/**
 * Whether a tool-using picker (Coding, Council, the AI Console) offers a model of the user's own API, and what about it
 * is unproven. A platform relay needs verified generation and tools (modelRouteCapabilityGate). An own API is the user's
 * own choice and the backend runs any model it saved or listed (isDiscoveredInvocationAllowed), so, as VS Code's BYOK
 * models, Continue and Open WebUI list a configured model and show its failure when used, a model saved untested or
 * whose tool check failed (its save said it can still be used) is offered with what is unproven, after proven ones,
 * instead of leaving an empty list. Only evidence that a request cannot work keeps one out: the API or its list says the
 * model does not generate (embeddings, an unsupported interface), or its provider declares no tool support, so a request
 * with tools is refused (Ollama answers "does not support tools"); the backend refuses those too.
 */
export function ownApiRouteAdmission(evidence: readonly ModelCapabilityEvidence[]): {
    readonly selectable: boolean;
    readonly hint?: OwnApiRouteHint;
    readonly reason?: ModelRouteUnavailableReason;
} {
    const gate = modelRouteCapabilityGate(evidence, true);
    if (gate.selectable) return { selectable: true };
    if (gate.generation === 'unsupported') return { selectable: false, reason: 'generation_unsupported' };
    if (gate.tools === 'unsupported') {
        // Only a live check the model answered counts as "failed": a provider's declaration is a refusal.
        return effectiveModelCapabilityEvidence(evidence, 'tools')?.source === 'live_probe'
            ? { selectable: true, hint: 'tools_failed' }
            : { selectable: false, reason: 'tools_unsupported' };
    }
    return { selectable: true, hint: gate.generation === 'verified' ? 'tools_unverified' : 'untested' };
}

/** Proven models first, then those whose tools are unchecked, then untested ones, then those whose tool check failed. */
export function ownApiRouteHintRank(hint: OwnApiRouteHint | undefined): number {
    return hint === undefined ? 0 : hint === 'tools_unverified' ? 1 : hint === 'untested' ? 2 : 3;
}

export function reasoningEffortLevelsForModel(input: ModelContract & {
    readonly reasoningSupported: boolean;
    readonly providerId: string;
    readonly model: string;
    readonly reasoningEfforts?: readonly AgentReasoningEffort[];
}): readonly ModelReasoningEffort[] {
    return input.reasoningSupported ? declaredReasoningEfforts(input) : [];
}

export interface ModelRouteSelectionInput {
    readonly routes: readonly SelectableModelRoute[];
    /** A conversation owns its route. Global model preferences must never override it. */
    readonly sessionRouteId?: string;
    /** Stable model identity used to repair a route when a connection is replaced. */
    readonly sessionModelId?: string;
    readonly selectedModelId?: string;
    readonly preferredRouteId?: string;
    readonly activeRouteId?: string;
    readonly fallbackRouteId?: string;
    readonly selectFallback?: boolean;
    /** A missing route is not evidence of removal until its owning catalog settles. */
    readonly catalogLoading?: boolean;
}

export interface ModelRelaySelectionInput {
    readonly availableRelayKeys: readonly string[];
    readonly sessionRelayKey?: string;
    readonly activeRelayKey?: string;
    readonly fallbackRelayKey?: string;
    /** True while the catalog that owns the conversation relay is still loading. */
    readonly sessionRelayLoading?: boolean;
    /** Same protection for a draft/global direct relay without a conversation. */
    readonly activeRelayLoading?: boolean;
    /** A source-first picker never manufactures a selection from catalog order. */
    readonly selectFallback?: boolean;
}

export interface ModelRelaySelection {
    readonly relayKey: string;
    /**
     * A direct route is never replaced by a marketplace route implicitly.
     * Pending means its owner could not be read yet; unavailable means the
     * catalog settled without it and the user must choose the replacement.
     */
    readonly status: 'ready' | 'pending' | 'unavailable';
}

export interface OfficialRelayConnectionReference {
    readonly connectionId: string;
    readonly providerId: string;
    readonly modelIds?: readonly string[];
}

export function officialConnectionRelayKey(connectionId: string): string {
    return `official:${connectionId}`;
}

export interface ManagedRelayRouteReference {
    readonly merchantId: string;
    readonly providerName: string;
    readonly routeId: string;
}

export function managedRelayKey(merchantId: string): string {
    return `managed:${merchantId.trim()}`;
}

/** Migrate a legacy provider-name key only when its merchant owner is unambiguous. */
export function migrateManagedRelayKey(input: {
    readonly relayKey?: string;
    readonly routes: readonly ManagedRelayRouteReference[];
    readonly preferredRouteId?: string;
}): string {
    const relayKey = input.relayKey || '';
    if (!relayKey.startsWith('managed:')) return relayKey;
    const legacyOrMerchantId = relayKey.slice('managed:'.length);
    if (input.routes.some(route => route.merchantId === legacyOrMerchantId)) return managedRelayKey(legacyOrMerchantId);
    const legacyMatches = input.routes.filter(route => route.providerName === legacyOrMerchantId);
    const preferred = legacyMatches.find(route => route.routeId === input.preferredRouteId);
    const merchantIds = [...new Set(legacyMatches.map(route => route.merchantId))];
    if (preferred) return managedRelayKey(preferred.merchantId);
    return merchantIds.length === 1 ? managedRelayKey(merchantIds[0]) : relayKey;
}

/**
 * Migrates the former provider-scoped relay key to a connection-scoped key.
 * A persisted route is authoritative because it records the connection the
 * user actually selected. Without one, retaining the first saved connection
 * preserves the deterministic behavior of legacy installations.
 */
export function migrateOfficialRelayKey(input: {
    readonly relayKey?: string;
    readonly connections: readonly OfficialRelayConnectionReference[];
    readonly preferredRouteId?: string;
    readonly preferredModelId?: string;
}): string {
    const relayKey = input.relayKey || '';
    if (!relayKey.startsWith('official:')) return relayKey;
    const legacyOrConnectionId = relayKey.slice('official:'.length);
    const exact = input.connections.find(connection => connection.connectionId === legacyOrConnectionId);
    if (exact) return officialConnectionRelayKey(exact.connectionId);
    const legacyMatches = input.connections.filter(connection => connection.providerId === legacyOrConnectionId);
    if (!legacyMatches.length) return relayKey;
    const preferredRouteId = input.preferredRouteId;
    const preferred = preferredRouteId
        ? legacyMatches.find(connection => {
            const routePrefix = officialConnectionRelayKey(connection.connectionId);
            return preferredRouteId === routePrefix || preferredRouteId.startsWith(`${routePrefix}:`);
        })
        : undefined;
    const preferredModelId = input.preferredModelId;
    const modelOwner = !preferred && preferredModelId
        ? legacyMatches.find(connection => connection.modelIds?.includes(preferredModelId))
        : undefined;
    return officialConnectionRelayKey((preferred || modelOwner || legacyMatches[0]).connectionId);
}

export function resolveModelRelay(input: ModelRelaySelectionInput): ModelRelaySelection {
    const available = new Set(input.availableRelayKeys);
    if (input.sessionRelayKey && available.has(input.sessionRelayKey)) {
        return { relayKey: input.sessionRelayKey, status: 'ready' };
    }
    if (input.sessionRelayKey && input.sessionRelayLoading) {
        return { relayKey: input.sessionRelayKey, status: 'pending' };
    }
    if (input.sessionRelayKey) {
        return { relayKey: input.sessionRelayKey, status: 'unavailable' };
    }
    if (input.activeRelayKey && available.has(input.activeRelayKey)) {
        return { relayKey: input.activeRelayKey, status: 'ready' };
    }
    if (input.activeRelayKey && input.activeRelayLoading) {
        return { relayKey: input.activeRelayKey, status: 'pending' };
    }
    if (input.activeRelayKey?.startsWith('official:') || input.activeRelayKey && input.selectFallback === false) {
        return { relayKey: input.activeRelayKey, status: 'unavailable' };
    }
    if (input.selectFallback === false) return { relayKey: '', status: 'ready' };
    const fallback = input.fallbackRelayKey && available.has(input.fallbackRelayKey)
        ? input.fallbackRelayKey : input.availableRelayKeys[0] || '';
    return { relayKey: fallback, status: 'ready' };
}

/** Resolves a route without allowing app-global preferences to erase a conversation selection. */
export function resolveModelRouteId(input: ModelRouteSelectionInput): string {
    const routes = input.routes.filter(route => route.selectable !== false);
    const byId = new Map(routes.map(route => [route.id, route]));
    if (input.sessionRouteId && byId.has(input.sessionRouteId)) return input.sessionRouteId;
    // A saved managed API is an exact user selection. Catalog refresh must
    // not replace it even with the same model; authorized failover belongs
    // to the gateway and preserves this primary identity.
    if (input.sessionRouteId?.startsWith('managed:fixed:')) return input.sessionRouteId;
    if (input.sessionModelId) {
        const sessionModel = routes.find(route => route.modelId === input.sessionModelId);
        if (sessionModel) return sessionModel.id;
        if (!input.sessionRouteId) return '';
    }
    if (input.sessionRouteId) return input.sessionRouteId;
    const draftFixedRoute = [input.preferredRouteId, input.activeRouteId].find(id => id?.startsWith('managed:fixed:'));
    if (draftFixedRoute) return draftFixedRoute;
    if (input.selectedModelId) {
        const selected = routes.find(route => route.modelId === input.selectedModelId);
        if (selected) return selected.id;
    }
    if (input.preferredRouteId && byId.has(input.preferredRouteId)) return input.preferredRouteId;
    if (input.activeRouteId && byId.has(input.activeRouteId)) return input.activeRouteId;
    if (input.selectFallback !== false && input.fallbackRouteId && byId.has(input.fallbackRouteId)) return input.fallbackRouteId;
    return input.selectFallback === false ? '' : routes[0]?.id || '';
}
