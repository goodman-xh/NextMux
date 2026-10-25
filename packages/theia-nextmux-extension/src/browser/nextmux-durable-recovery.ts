import type { DesktopAgentDurableRecoveryResult, DesktopAgentDurableRetryRequest } from '../common/nextmux-platform-protocol';

export type DurableRetrySelection = Pick<DesktopAgentDurableRetryRequest, 'operationId' | 'expectedRevision' | 'headRevision'> & {
    readonly resumeCheckpointId: string;
};

/** Read-only inspection never grants retry consent. Only the explicit dialog action does. */
export function durableRecoveryDecision(result: DesktopAgentDurableRecoveryResult):
    { readonly kind: 'continue' } | { readonly kind: 'unavailable' } | { readonly kind: 'confirm'; readonly retry: DurableRetrySelection } {
    if (result.status === 'none' && result.operations.length === 0) return { kind: 'continue' };
    const operation = result.operations.length === 1 ? result.operations[0] : undefined;
    if (result.status !== 'blocked' || !operation?.retrySupported || operation.reason !== 'result_unknown'
        || operation.operationKind !== 'delegated_model' || !result.resumeCheckpointId
        || !Number.isSafeInteger(result.headRevision) || result.headRevision! < 1
        || !Number.isSafeInteger(operation.revision) || operation.revision < 1
        || !/^op-[a-f0-9-]{36}$/.test(operation.operationId)) return { kind: 'unavailable' };
    return { kind: 'confirm', retry: { operationId: operation.operationId, expectedRevision: operation.revision,
        headRevision: result.headRevision!, resumeCheckpointId: result.resumeCheckpointId } };
}
