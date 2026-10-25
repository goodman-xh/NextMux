import { DesktopDomainError } from './nextmux-domain-errors';
import type { ManagedGatewayRoute, ModelSwitchPolicy } from './nextmux-platform-protocol';

export function modelSwitchRouteKey(route: ManagedGatewayRoute): string {
    return route.mode === 'automatic' ? `auto:${route.registryModelId}` : `fixed:${route.offeringId}`;
}

/** Non-secret policy is cloned on every boundary; the CF gateway revalidates it. */
export function validateModelSwitchPolicy(value: unknown, route: ManagedGatewayRoute): ModelSwitchPolicy {
    const scope = route.mode === 'automatic' || (value as ModelSwitchPolicy | undefined)?.mode === 'same_model_relays'
        ? 'eligible_marketplace' : 'selected_merchant';
    if (value === undefined) return { version: 1, revision: 0, mode: 'same_model', fallbackRegistryModelIds: [], merchantScope: scope };
    const policy = value as ModelSwitchPolicy;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)
        || Object.keys(policy).some(key => !['version', 'revision', 'mode', 'fallbackRegistryModelIds', 'merchantScope', 'maxRequestChargeMicros'].includes(key))
        || policy.version !== 1 || !Number.isSafeInteger(policy.revision) || policy.revision < 0
        || !['same_model', 'single_route', 'same_model_relays', 'allowlisted_models'].includes(policy.mode) || policy.merchantScope !== scope
        || !Array.isArray(policy.fallbackRegistryModelIds) || policy.fallbackRegistryModelIds.length > 3
        || policy.fallbackRegistryModelIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9._:/-]{1,100}$/.test(id))
        || new Set(policy.fallbackRegistryModelIds).size !== policy.fallbackRegistryModelIds.length
        || policy.mode !== 'allowlisted_models' && policy.fallbackRegistryModelIds.length > 0
        || route.mode === 'automatic' && policy.fallbackRegistryModelIds.includes(route.registryModelId)
        || policy.maxRequestChargeMicros !== undefined && (!Number.isSafeInteger(policy.maxRequestChargeMicros) || policy.maxRequestChargeMicros < 0)) {
        throw new DesktopDomainError('MODEL_SWITCH_POLICY_INVALID', 'The model switching settings are invalid.');
    }
    return { version: 1, revision: policy.revision, mode: policy.mode, fallbackRegistryModelIds: [...policy.fallbackRegistryModelIds], merchantScope: scope,
        ...(policy.maxRequestChargeMicros === undefined ? {} : { maxRequestChargeMicros: policy.maxRequestChargeMicros }) };
}

/**
 * Normalize persisted/UI state at a model-call boundary.
 *
 * A policy is deliberately strict when it is being saved or updated, but a
 * desktop may outlive a Worker rollout (or contain a policy written by an
 * older build).  Letting that stale, non-secret setting abort an otherwise
 * valid model request produces MODEL_SWITCH_POLICY_INVALID and no response.
 * Falling back to the safe fixed/single-route policy disables failover for
 * this request without changing the user's route or inventing permissions;
 * the next settings read can then repair the persisted value.
 */
export function normalizeModelSwitchPolicyForDispatch(value: unknown, route: ManagedGatewayRoute): ModelSwitchPolicy {
    try { return validateModelSwitchPolicy(value, route); }
    catch {
        const fallback = validateModelSwitchPolicy(undefined, route);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
        const maxRequestChargeMicros = (value as Partial<ModelSwitchPolicy>).maxRequestChargeMicros;
        return validateModelSwitchPolicy({
            ...fallback,
            ...(maxRequestChargeMicros === undefined ? {} : { maxRequestChargeMicros })
        }, route);
    }
}

/** Decimal USD parsing avoids floating-point rounding into a higher authorization. */
export function modelSwitchUsdMicros(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const match = /^(\d{1,9})(?:\.(\d{0,6}))?$/.exec(value.trim());
    if (!match) throw new DesktopDomainError('USD_PRECISION_INVALID', 'Enter a USD amount with at most six decimal places.', { maximumDecimals: 6 });
    const result = Number(match[1]) * 1_000_000 + Number((match[2] || '').padEnd(6, '0'));
    if (!Number.isSafeInteger(result)) throw new DesktopDomainError('USD_AMOUNT_TOO_LARGE', 'The USD amount exceeds the supported limit.');
    return result;
}
