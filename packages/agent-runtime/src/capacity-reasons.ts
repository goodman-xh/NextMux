/** Configured platform admission limits, never inferred provider quotas. */
export type CapacityWaitReason = 'concurrency' | 'rpm' | 'tpm' | 'daily_tokens';
const capacityReasons: readonly CapacityWaitReason[] = ['concurrency', 'rpm', 'tpm', 'daily_tokens'];
export function normalizedCapacityReasons(value: unknown): readonly CapacityWaitReason[] {
    if (!Array.isArray(value) || value.length > 4) return [];
    return capacityReasons.filter(reason => value.includes(reason));
}
export function capacityReasonMetadata(value: unknown): { readonly capacityReasons?: readonly CapacityWaitReason[] } {
    const reasons = normalizedCapacityReasons(value);
    return reasons.length ? { capacityReasons: reasons } : {};
}
