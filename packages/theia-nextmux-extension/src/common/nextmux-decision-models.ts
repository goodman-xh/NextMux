import { parseDecisionEndpointRoles, parseDecisionEndpointTariff, type ModelContract, type ModelDecisionEndpointRole, type ModelDecisionEndpointTariff } from '@nextmux/model-runtime/model-contract';
import type { DiscoveredOfficialModel } from '@nextmux/model-runtime';
import { isDecisionOnlyModel } from '@nextmux/model-runtime/model-task-capabilities';

/** Task classification is independent of the provider's executable protocol. */
export function isDecisionModel(id: string, outputModalities?: readonly string[]): boolean {
    return isDecisionOnlyModel({ id, outputModalities });
}

/** Build once per connection list, instead of scanning the full catalog for every discovered model. */
interface PublishedDecisionRole { readonly role: ModelDecisionEndpointRole; readonly language: boolean; readonly tariff?: ModelDecisionEndpointTariff; }
export function publishedDecisionRoleIndex(catalog: readonly (ModelContract & { readonly canonicalModel: string; readonly output?: readonly string[]; readonly kind?: string })[]): ReadonlyMap<string, PublishedDecisionRole> {
    const roles = new Map<string, PublishedDecisionRole>();
    for (const row of catalog) for (const role of parseDecisionEndpointRoles(row.decisionEndpointRoles)) {
        if (role.canonicalModel !== row.canonicalModel) continue;
        const tariff = parseDecisionEndpointTariff(row.decisionEndpointTariff);
        const value = { role, language: row.kind === 'llm' || row.taskCategories?.includes('language') === true || row.output?.includes('text') === true,
            ...(tariff?.canonicalModel === role.canonicalModel && tariff.sourceHash === role.sourceHash ? { tariff } : {}) };
        roles.set(role.canonicalModel, value); roles.set(role.upstreamModelId, value);
    }
    return roles;
}
/** A public author declaration augments display purpose only; a relay must prove its own endpoint separately. */
export function withPublishedDecisionRole<T extends DiscoveredOfficialModel>(model: T, roles: ReadonlyMap<string, PublishedDecisionRole>): T {
    const published = roles.get(model.id);
    if (!published) return model;
    const { role, language, tariff } = published;
    return { ...model, decisionEndpointRoles: [role], decisionEndpointTariff: tariff,
        taskCategories: [...new Set([...(model.taskCategories || []), ...(language ? ['language'] : []), 'decision'])],
        capabilityDeclarations: { ...(model.capabilityDeclarations || {}), decision: { support: 'supported', source: 'provider_metadata', scope: 'model' } } };
}
