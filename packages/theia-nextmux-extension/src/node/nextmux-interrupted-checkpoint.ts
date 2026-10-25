import { normalizeAgentRunVerification } from '@nextmux/agent-runtime/run-verification';
import type { AgentRunCheckpoint, AgentRunEvent, AgentCheckpointDiff } from '@nextmux/agent-runtime';

interface InterruptedCheckpointRuntime {
    finalizeProcessCheckpoints(): Promise<void>;
    getCreatedCheckpointIds(): readonly string[];
    getCheckpointDiff(checkpointId: string): Promise<AgentCheckpointDiff>;
}

/** Collect side effects of unpolled commands before persisting a retry state.
 * Runtime completion events prove which changes the runner already observed;
 * local command snapshots also cover a command interrupted before its result.
 */
export async function finalizeInterruptedAgentCheckpoint(
    checkpoint: AgentRunCheckpoint,
    events: readonly AgentRunEvent[],
    runtime: InterruptedCheckpointRuntime
): Promise<AgentRunCheckpoint> {
    const observed = new Set(agentRunFileCheckpointIds(checkpoint.recoveredFileCheckpointIds, [], events));
    // A retry checkpoint can already contain completed tool results from an
    // earlier attempt that are no longer present in this attempt's event list.
    for (const message of checkpoint.messages) {
        if (message.role !== 'tool') continue;
        try {
            const output = JSON.parse(message.content)?.output;
            if (typeof output?.checkpointId === 'string') observed.add(output.checkpointId);
            if (Array.isArray(output?.checkpointIds)) for (const id of output.checkpointIds) {
                if (typeof id === 'string') observed.add(id);
            }
        } catch { /* malformed legacy output is not evidence of an observed change */ }
    }
    await runtime.finalizeProcessCheckpoints();
    const unseen = runtime.getCreatedCheckpointIds().filter(id => !observed.has(id));
    if (!unseen.length) return checkpoint;
    const changes = await Promise.all(unseen.map(id => runtime.getCheckpointDiff(id)));
    const verification = normalizeAgentRunVerification({
        ...(checkpoint.verification || { status: 'unverified', checks: [] }),
        revision: (checkpoint.verification?.revision || 0) + 1,
        changedPaths: [...new Set([...(checkpoint.verification?.changedPaths || []), ...changes.map(change => change.path)])]
    });
    return { ...checkpoint, verification, verificationPrompted: false,
        recoveredFileCheckpointIds: [...new Set([...(checkpoint.recoveredFileCheckpointIds || []), ...unseen])] };
}

/** Receipt union shared by interruption recovery and the final desktop result. */
export function agentRunFileCheckpointIds(
    recovered: readonly string[] | undefined,
    current: readonly string[],
    events: readonly AgentRunEvent[]
): string[] {
    return [...new Set([...(recovered || []), ...current, ...events.flatMap(event => event.type === 'tool_completed'
        ? [...(event.summary.checkpointIds || []), ...(event.summary.checkpointId ? [event.summary.checkpointId] : [])] : [])])];
}
