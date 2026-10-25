import type { ManagedGatewayRoute, ModelSwitchPolicy } from '../common/nextmux-platform-protocol';
import { modelSwitchRouteKey, validateModelSwitchPolicy } from '../common/nextmux-model-switch-policy';

/** Saves authorization by primary route, never rewrites a conversation's model. */
export class ModelSwitchSettings {
    private values: Record<string, unknown> = {};
    constructor(raw: string | null) {
        try {
            const parsed = JSON.parse(raw || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                for (const [key, value] of Object.entries(parsed).slice(-100)) {
                    const route: ManagedGatewayRoute | undefined = key.startsWith('auto:') ? { mode: 'automatic', registryModelId: key.slice(5) }
                        : key.startsWith('fixed:') ? { mode: 'fixed', offeringId: key.slice(6) } : undefined;
                    try { if (route) this.values[key] = validateModelSwitchPolicy(value, route); } catch { /* Drop unknown fields, never reserialize credentials. */ }
                }
            }
        } catch { /* Invalid settings fail closed. */ }
    }
    get(route: ManagedGatewayRoute): ModelSwitchPolicy {
        try { return validateModelSwitchPolicy(this.values[modelSwitchRouteKey(route)], route); }
        catch { return validateModelSwitchPolicy(undefined, route); }
    }
    set(route: ManagedGatewayRoute, value: ModelSwitchPolicy): string {
        const policy = validateModelSwitchPolicy(value, route);
        const key = modelSwitchRouteKey(route);
        this.values = Object.fromEntries([...Object.entries(this.values).filter(([id]) => id !== key).slice(-99), [key, policy]]);
        return JSON.stringify(this.values);
    }
}
