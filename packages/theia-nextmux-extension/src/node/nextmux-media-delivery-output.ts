import type { AgentOutputPart } from '@nextmux/agent-runtime';
import { readAgentOutputAsset } from './nextmux-agent-output-assets';

/** Rehydrate only at the network boundary; checkpoints/events retain local digest references. */
export async function localManagedOutputMessages<T extends { readonly outputParts?: readonly AgentOutputPart[] }>(
    dataRoot: string, ownerId: string, messages: readonly T[]
): Promise<T[]> {
    const assets = new Map<string, Promise<string>>();
    let total = 0;
    return Promise.all(messages.map(async message => {
        if (!message.outputParts?.some(part => part.type !== 'text')) return message;
        const outputParts = await Promise.all(message.outputParts.map(async part => {
            if (part.type === 'text') return part;
            const key = `${part.asset.sha256}:${part.asset.mimeType}:${part.asset.sizeBytes}`;
            let saved = assets.get(key);
            if (!saved) {
                total += part.asset.sizeBytes;
                if (total > 32 * 1024 * 1024) throw new Error('MANAGED_OUTPUT_HISTORY_TOO_LARGE');
                saved = readAgentOutputAsset(dataRoot, ownerId, part.asset).then(asset => asset.dataBase64);
                assets.set(key, saved);
            }
            return { ...part, dataBase64: await saved };
        }));
        return { ...message, outputParts };
    }));
}
