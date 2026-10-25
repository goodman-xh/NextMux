import { classifyModelError } from '@nextmux/model-runtime/errors';
import { discoverOfficialModelCatalog, isInvokableDiscoveredModel, OfficialModelError, officialProviderPreset } from '@nextmux/model-runtime';
import type { DiscoverOfficialModelsOptions } from '@nextmux/model-runtime';
import type { OfficialModelConnection, OfficialModelDiscoveryFailure } from '../common/nextmux-platform-protocol';

const failures: readonly OfficialModelDiscoveryFailure[] = ['credentials_missing', 'authentication_failed', 'permission_denied',
    'endpoint_unsupported', 'rate_limited', 'timeout', 'network_error', 'invalid_response'];

export function isOfficialModelDiscoveryFailure(value: unknown): value is OfficialModelDiscoveryFailure {
    return typeof value === 'string' && failures.includes(value as OfficialModelDiscoveryFailure);
}

type DiscoveryResult = Pick<OfficialModelConnection, 'discoveredModels' | 'modelDiscoveryStatus' | 'modelDiscoveryFailure' | 'modelDiscoveryError' | 'ollamaStatus'>;
type DiscoveryCache = DiscoveryResult & Pick<OfficialModelConnection, 'lastModelDiscoveryAt' | 'lastSuccessfulModelDiscoveryAt'>;

/** A replaced Ollama tag must earn its own live tool proof, even when its name is unchanged. */
export function officialModelValidationMatchesDiscovery(
    previous: Pick<OfficialModelConnection, 'model' | 'discoveredModels'>,
    models: OfficialModelConnection['discoveredModels']
): boolean {
    const before = previous.discoveredModels.find(model => model.id === previous.model);
    const after = models.find(model => model.id === previous.model);
    return before?.digest === after?.digest && after?.toolsSupported !== false
        && !(after?.capabilities && !isInvokableDiscoveredModel(after));
}

/** Retain an identity-matched last-good catalog only for transient failures. */
export function mergeOfficialDiscoveryCache(previous: DiscoveryCache | undefined, result: DiscoveryResult, attemptedAt: string): DiscoveryCache {
    const succeeded = result.modelDiscoveryStatus === 'verified' || result.modelDiscoveryStatus === 'catalog_discovered';
    const transient = ['rate_limited', 'timeout', 'network_error', 'invalid_response'].includes(result.modelDiscoveryFailure || '');
    const keep = !succeeded && transient && previous;
    return {
        ...result,
        modelDiscoveryError: result.modelDiscoveryError,
        ollamaStatus: keep ? previous.ollamaStatus : result.ollamaStatus,
        discoveredModels: keep ? previous.discoveredModels : result.discoveredModels.map(model => {
            const oldModel = previous?.discoveredModels.find(candidate => candidate.id === model.id);
            const validation = oldModel?.digest === model.digest ? oldModel?.validation : undefined;
            return validation?.toolCalling && model.toolsSupported !== false && isInvokableDiscoveredModel(model) && model.interfaceSupport !== 'unsupported'
                ? { ...model, validation } : model;
        }),
        lastModelDiscoveryAt: attemptedAt,
        lastSuccessfulModelDiscoveryAt: succeeded ? attemptedAt : keep
            ? previous.lastSuccessfulModelDiscoveryAt || (['verified', 'catalog_discovered'].includes(previous.modelDiscoveryStatus)
                ? previous.lastModelDiscoveryAt : undefined)
            : undefined
    };
}

export function isDiscoveredInvocationAllowed(connection: Pick<OfficialModelConnection, 'model' | 'providerId' | 'discoveredModels'>, model: string): boolean {
    const key = model.toLocaleLowerCase();
    const entry = connection.discoveredModels.find(candidate => candidate.id.toLocaleLowerCase() === key);
    if (entry?.toolsSupported === false || entry?.capabilities && !isInvokableDiscoveredModel(entry)) return false;
    return key === connection.model.toLocaleLowerCase() || (connection.providerId !== 'azure_openai' && connection.providerId !== 'bedrock'
        && connection.discoveredModels.some(candidate => isInvokableDiscoveredModel(candidate) && candidate.id.toLocaleLowerCase() === key));
}

/** Directory reads never validate inference or change the user's deployment name. */
export async function discoverConnectionModels(options: DiscoverOfficialModelsOptions): Promise<DiscoveryResult> {
    if (options.providerId && officialProviderPreset(options.providerId)?.modelDiscovery === 'unsupported') {
        return { discoveredModels: [], modelDiscoveryStatus: 'unsupported', modelDiscoveryFailure: 'endpoint_unsupported' };
    }
    try {
        const catalog = await discoverOfficialModelCatalog(options);
        const discoveredModels = catalog.catalogModels.map(({ interfaceSupport, interfaceSupportSource, ...model }) =>
            interfaceSupport === 'unknown' ? model : { ...model, interfaceSupport, interfaceSupportSource });
        const catalogOnly = options.providerId === 'azure_openai' || options.providerId === 'bedrock';
        return { discoveredModels, modelDiscoveryStatus: catalogOnly ? 'catalog_discovered' : 'verified',
            ...(catalog.ollamaStatus ? { ollamaStatus: catalog.ollamaStatus } : {}) };
    } catch (error) {
        let failure: OfficialModelDiscoveryFailure = 'network_error';
        if (error instanceof OfficialModelError) {
            if (error.code === 'DISCOVERY_CREDENTIALS_MISSING' || error.code === 'INVALID_API_KEY') failure = 'credentials_missing';
            else if (error.httpStatus === 401) failure = 'authentication_failed';
            else if (error.httpStatus === 403) failure = 'permission_denied';
            else if (error.httpStatus === 404 || ['INVALID_BASE_URL', 'INSECURE_BASE_URL', 'PRIVATE_BASE_URL', 'DISCOVERY_UNSUPPORTED'].includes(error.code)
                || error.code === 'MODEL_NOT_FOUND' || error.code === 'REQUEST_REJECTED') failure = 'endpoint_unsupported';
            else if (error.httpStatus === 429 || error.category === 'rate_limit') failure = 'rate_limited';
            else if (error.category === 'timeout') failure = 'timeout';
            else if (error.category === 'invalid_response') failure = 'invalid_response';
        }
        const classified = classifyModelError(error, { provider: options.providerId, source: options.providerId === 'ollama' || /^(?:http[s]?:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(options.baseUrl) ? 'local' : 'own_api' });
        // Directory errors are saved with the connection. Keep only bounded,
        // structured facts; an upstream response body may contain private data.
        const modelDiscoveryError = {
            kind: classified.kind,
            detail: '',
            ...(classified.httpStatus === undefined ? {} : { httpStatus: classified.httpStatus }),
            ...(classified.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: classified.retryAfterSeconds }),
            ...(classified.source === undefined ? {} : { source: classified.source })
        };
        return { discoveredModels: [], modelDiscoveryStatus: failure === 'endpoint_unsupported' ? 'unsupported' : 'failed',
            modelDiscoveryFailure: failure, modelDiscoveryError };
    }
}
