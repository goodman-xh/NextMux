import type { AgentModelMessage, AgentToolDescriptor } from '@nextmux/agent-runtime';
import { messagesWithToolImages } from '@nextmux/model-runtime';

/** Match the gateway's context estimate (estimateGatewayContextTokens), including its normalized wire fields: about
 * three bytes a token plus message and tool framing. The gateway fits requests to models and keys with it; its billing
 * hold still counts bytes. This is a capacity estimate; provider-reported usage still controls billing.
 */
export interface ManagedGatewayTokenEstimateProfile {
    readonly provider?: string;
    readonly providerId?: string;
    readonly protocol?: string;
    readonly imageTokens?: number;
}

export function estimateManagedGatewayInputTokens(
    instructions: string | undefined,
    messages: readonly AgentModelMessage[],
    tools: readonly AgentToolDescriptor[],
    profile?: ManagedGatewayTokenEstimateProfile
): number {
    try {
        const imageTokenAllowance = profile?.imageTokens && profile.imageTokens > 0 ? Math.ceil(profile.imageTokens) : 2048;
        let mediaTokens = 0;
        const input = messagesWithToolImages(messages).map(({ message }) => ({
            role: message.role,
            content: message.content,
            toolCalls: message.role === 'assistant' && message.toolCalls?.length ? message.toolCalls.map(call => ({
                id: String(call.id), name: String(call.name), arguments: call.arguments ?? {}
            })) : undefined,
            toolCallId: message.role === 'tool' ? String(message.toolCallId || '') : undefined,
            providerState: message.providerState,
            outputParts: message.outputParts?.map(part => {
                if (part.type === 'text') return { type: 'text', text: part.text };
                mediaTokens += part.type === 'image' ? imageTokenAllowance : Math.ceil(part.asset.sizeBytes / 4);
                return { type: part.type, asset: { sha256: part.asset.sha256, mimeType: part.asset.mimeType, sizeBytes: part.asset.sizeBytes } };
            }),
            attachments: message.attachments?.length ? message.attachments.map(attachment => {
                const name = attachment.name.trim();
                if (attachment.kind === 'text') return { kind: 'text', name, content: attachment.content };
                mediaTokens += attachment.kind === 'image' ? imageTokenAllowance : Math.ceil(attachment.dataBase64.length * 3 / 16);
                return { kind: attachment.kind, name };
            }) : undefined,
        }));
        const textBytes = new TextEncoder().encode(JSON.stringify({
            instructions: instructions?.trim() || '', input,
            tools: tools.map(tool => ({ name: tool.name, description: String(tool.description || '').trim().slice(0, 2000), inputSchema: tool.inputSchema ?? {} }))
        })).byteLength;
        return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.ceil(textBytes / 3) + input.length * 4 + tools.length * 8 + mediaTokens));
    } catch {
        // Invalid non-serializable host data cannot bypass an admission check.
        return Number.MAX_SAFE_INTEGER;
    }
}
