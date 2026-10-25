import {
    MIN_COUNCIL_SLOTS, normalizeAgentCouncilConfigRoles, normalizeAgentCouncilRoleId,
    validateAgentCouncilConfig, type AgentCouncilValidationError
} from '@nextmux/agent-runtime/council';
import type { DesktopAgentCouncilConfig, DesktopAgentCouncilSlot } from './nextmux-platform-protocol';

export type DesktopCouncilValidationError = AgentCouncilValidationError | 'slot_route_required';
export function validateDesktopCouncilConfig(input: unknown): { valid: boolean; error?: DesktopCouncilValidationError } {
    const validation = validateAgentCouncilConfig(input);
    if (!validation.valid) return validation;
    const config = input as DesktopAgentCouncilConfig;
    if (config.slots.some(slot => {
        const route = slot.route;
        return !route || (route.kind === 'official_connection'
            ? typeof route.connectionId !== 'string' || !route.connectionId.trim() || typeof route.model !== 'string' || !route.model.trim()
            : route.kind !== 'managed_gateway' || !route.route || (route.route.mode === 'fixed'
                ? typeof route.route.offeringId !== 'string' || !route.route.offeringId.trim()
                : route.route.mode !== 'automatic' || typeof route.route.registryModelId !== 'string' || !route.route.registryModelId.trim()));
    })) return { valid: false, error: 'slot_route_required' };
    return { valid: true };
}

/** A repair draft only. Never activate it until explicit save resolves and validates every route. */
export function councilConfigRepairDraft(input: unknown): DesktopAgentCouncilConfig {
    const migrated = normalizeAgentCouncilConfigRoles(input);
    const raw = migrated && typeof migrated === 'object' && !Array.isArray(migrated) ? migrated as Record<string, unknown> : {};
    const string = (value: unknown): string => typeof value === 'string' ? value : '';
    const ids = new Set<string>();
    const entries = Array.isArray(raw.slots) ? raw.slots : [];
    const slots: DesktopAgentCouncilSlot[] = Array.from({ length: Math.max(MIN_COUNCIL_SLOTS, entries.length) }, (_, index) => {
        const entry = entries[index];
        const slot = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
        let slotId = string(slot.slotId);
        if (!slotId.trim() || ids.has(slotId)) {
            slotId = `recovered-slot-${index + 1}`;
            while (ids.has(slotId) || entries.some(item => item?.slotId === slotId)) slotId += '-new';
        }
        ids.add(slotId);
        return {
            slotId, modelId: string(slot.modelId), modelLabel: string(slot.modelLabel), label: string(slot.label),
            routeId: string(slot.routeId), relayKey: string(slot.relayKey),
            roles: Array.isArray(slot.roles) ? [...new Set(slot.roles.flatMap(role => {
                const normalized = normalizeAgentCouncilRoleId(role); return normalized ? [normalized] : [];
            }))] : [],
            // Only the editor sees this placeholder; save reconstructs the route from the selected provider.
            route: (slot.route && typeof slot.route === 'object' ? slot.route : { kind: 'official_connection', connectionId: '' }) as DesktopAgentCouncilSlot['route']
        };
    });
    return {
        enabled: true, revision: typeof raw.revision === 'number' && Number.isFinite(raw.revision) ? raw.revision : 0,
        sourceKey: string(raw.sourceKey), sourceLabel: string(raw.sourceLabel), relayKey: string(raw.relayKey),
        relayLabel: string(raw.relayLabel), slots
    };
}
