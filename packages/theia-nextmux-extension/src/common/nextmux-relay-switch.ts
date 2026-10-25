import type { ManagedGatewayRoute, ModelSwitchPolicy } from './nextmux-platform-protocol';

/** Per-conversation intent. Explicit defaults seed only newly created conversations. */
export type AutomaticRelaySource = 'off' | 'user' | 'auto_best';

export function automaticRelaySource(value: unknown, legacyRelayKey: unknown = ''): AutomaticRelaySource {
    return value === 'user' || value === 'auto_best' || value === 'off'
        ? value : typeof legacyRelayKey === 'string' && (legacyRelayKey === 'auto' || legacyRelayKey.startsWith('managed:auto:')) ? 'auto_best' : 'off';
}

export function relaySourceSelected(source: AutomaticRelaySource, relayKey: string): AutomaticRelaySource {
    if (source === 'user') return source;
    return relayKey === 'auto' ? 'auto_best' : 'off';
}

/** A fresh immutable authorization for this dispatch; old cross-model lists stay historical. */
export function sameModelRelayPolicy(route: ManagedGatewayRoute, source: AutomaticRelaySource,
    previous?: Pick<ModelSwitchPolicy, 'revision' | 'maxRequestChargeMicros'>): ModelSwitchPolicy {
    const enabled = source !== 'off';
    // Fixed routes used `same_model` before the relay-switch extension was
    // introduced.  It already means one fixed offering with no cross-merchant
    // fallbacks, so keep that wire shape when switching is off.  Besides being
    // semantically exact, this lets a desktop updated ahead of the Worker keep
    // sending instead of receiving SWITCH_POLICY_INVALID during a rolling
    // deployment. Automatic routes still need the explicit single-route mode
    // when the user has turned switching off.
    const mode: ModelSwitchPolicy['mode'] = enabled ? 'same_model_relays'
        : route.mode === 'fixed' ? 'same_model' : 'single_route';
    // `previous` ultimately comes from persistence.  Callers normally pass a
    // validated snapshot, but keep this constructor total so an old/corrupt
    // value can never manufacture an invalid request and block the composer.
    const revision = Number.isSafeInteger(previous?.revision) && Number(previous?.revision) >= 0
        ? Number(previous?.revision) : 0;
    const maxRequestChargeMicros = Number.isSafeInteger(previous?.maxRequestChargeMicros)
        && Number(previous?.maxRequestChargeMicros) >= 0 ? Number(previous?.maxRequestChargeMicros) : undefined;
    return { version: 1, revision,
        mode, fallbackRegistryModelIds: [],
        merchantScope: route.mode === 'automatic' || enabled ? 'eligible_marketplace' : 'selected_merchant',
        ...(maxRequestChargeMicros === undefined ? {} : { maxRequestChargeMicros }) };
}
