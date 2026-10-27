import type { PlatformOffering } from '../common/nextmux-platform-protocol';
import type { AutomaticRelaySource } from '../common/nextmux-relay-switch';

export interface RetainedManagedSelection {
    readonly ownerId: string;
    readonly sessionId: string;
    readonly routeId: string;
    readonly relayKey: string;
    readonly modelId: string;
    readonly registryModelId: string;
    readonly offering: PlatformOffering;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const normalizedModel = (value: string): string => value.trim().replace(/^~/, '').replace(/^models\//i, '').toLocaleLowerCase().replace(/\s+/g, '-');
/** A retained selection is routing identity, never evidence that a withdrawn
 * API is currently usable. Only explicit same-model switching can dispatch
 * that original ID for the server to assess eligible alternatives. */
export function retainedManagedDispatchRoute(input: {
    readonly ownerId: string; readonly sessionId: string; readonly routeId: string; readonly relayKey: string;
    readonly modelId: string; readonly automaticRelaySource: AutomaticRelaySource;
    readonly retained?: RetainedManagedSelection;
}): { readonly id: string; readonly kind: 'managed_gateway'; readonly automatic: false; readonly registryModelId: string;
    readonly canonicalModel: string; readonly offering: PlatformOffering } | undefined {
    const retained = input.retained, fixedId = /^managed:fixed:(.+)$/.exec(input.routeId)?.[1];
    if (!retained || !input.ownerId || !input.sessionId || input.automaticRelaySource === 'off'
        || !['user', 'auto_best'].includes(input.automaticRelaySource) || !fixedId || !uuid.test(fixedId)
        || retained.ownerId !== input.ownerId || retained.sessionId !== input.sessionId || retained.routeId !== input.routeId
        || retained.relayKey !== input.relayKey || !input.relayKey.startsWith('managed:')
        || retained.offering.id !== fixedId || retained.offering.merchantId !== input.relayKey.slice('managed:'.length)
        || !retained.registryModelId || retained.registryModelId !== retained.offering.registryModelId
        || !input.modelId || normalizedModel(retained.modelId) !== normalizedModel(input.modelId)
        || normalizedModel(retained.offering.canonicalModel) !== normalizedModel(input.modelId)) return undefined;
    return { id: input.routeId, kind: 'managed_gateway', automatic: false, registryModelId: retained.registryModelId,
        canonicalModel: retained.offering.canonicalModel, offering: retained.offering };
}
