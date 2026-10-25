import type { AgentMessageAttachment } from '@nextmux/agent-runtime';
import { effectiveModelCapabilityEvidence, isPlainTextAttachmentMime } from '@nextmux/model-runtime/capabilities';
import type { ModelCapability, ModelCapabilityEvidence } from '@nextmux/model-runtime/capabilities';
import type { ModelContract } from '@nextmux/model-runtime';

interface AttachmentRoute {
    readonly kind: 'managed_gateway' | 'official_connection';
    readonly offering?: ModelContract & { readonly input: readonly string[]; readonly capabilities: readonly string[];
        readonly routeCapabilityDeclarations?: ModelContract['capabilityDeclarations']; readonly modelCapabilityDeclarations?: ModelContract['capabilityDeclarations'] };
    readonly connection?: {
        readonly protocol: string;
        readonly providerId: string;
        readonly model: string;
        readonly capabilityEvidence: readonly ModelCapabilityEvidence[];
        readonly discoveredModels?: readonly (ModelContract & {
            readonly id: string;
            readonly inputModalities?: readonly string[];
            readonly inputMimeTypes?: readonly string[];
        })[];
    };
}

/** Model input support and the installed adapter's encoding must both agree. */
export function routeSupportsModelAttachment(attachment: AgentMessageAttachment, route?: AttachmentRoute): boolean {
    if (!route) return false;
    if (attachment.kind === 'text') return true;
    const mime = attachment.mimeType.toLowerCase().split(';', 1)[0].trim();
    const input = attachment.kind === 'image' || mime.startsWith('image/') ? 'image'
        : mime === 'application/pdf' ? 'pdf'
        : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'file';
    const recognizedImage = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime);
    if (route.kind === 'managed_gateway') {
        const offering = route.offering;
        if (!offering) return false;
        if ([offering.routeCapabilityDeclarations, offering.modelCapabilityDeclarations, offering.capabilityDeclarations]
            .some(declarations => declarations?.[`input:${input}`]?.support === 'unsupported')) return false;
        // Match complete capability names. "no-files", "audio-output" and
        // "image-generation" must never become input capability evidence.
        const declared = new Set([...offering.input, ...offering.capabilities].map(value => value.toLowerCase().trim()));
        const has = (...values: string[]) => values.some(value => declared.has(value));
        // Like Open WebUI and Cherry Studio, images go to the model unless the
        // listing says it is text-only: an offering with no declared inputs
        // is unknown, not "unsupported".
        if (input === 'image') return (recognizedImage && (has('image', 'vision', 'input:image') || !offering.input.length)) || has(mime);
        if (input === 'pdf') return has('pdf', 'input:pdf', 'file', 'files', mime);
        if (input === 'audio' || input === 'video') return has(input, `input:${input}`, `${input}_input`, `${input}input`, mime);
        return has(mime, 'file', 'files');
    }
    const connection = route.connection;
    if (!connection) return false;
    const { protocol } = connection;
    const model = connection.discoveredModels?.find(item => item.id === connection.model);
    if (model?.capabilityDeclarations?.[`input:${input}`]?.support === 'unsupported') return false;
    const modalities = Array.isArray(model?.inputModalities) ? model.inputModalities : undefined;
    const mimeTypes = Array.isArray(model?.inputMimeTypes) ? model.inputMimeTypes : undefined;
    const evidence = input === 'file' ? undefined : effectiveModelCapabilityEvidence(connection.capabilityEvidence, `input:${input}` as ModelCapability);
    const explicitEvidence = evidence && ['verified', 'declared'].includes(evidence.confidence);
    if (explicitEvidence && evidence.support === 'unsupported') return false;
    // Cohere text files are decoded and validated locally by the transport.
    // They are plain text, not native binary documents.
    if (protocol === 'cohere_chat' && attachment.kind === 'file' && isPlainTextAttachmentMime(mime)) return true;
    // An explicit allowlist is a ceiling, even if a broad modality exists.
    if (mimeTypes && !mimeTypes.includes(mime)) return false;
    // No evidence either way (a direct connection whose provider publishes no
    // modality list) is treated as capable for images, the common case for
    // current chat models; an explicit modality list or "unsupported"
    // evidence still wins.
    const imageUnknown = input === 'image' && !mimeTypes && !modalities && !explicitEvidence;
    const declared = mimeTypes?.includes(mime)
        || (input !== 'file' && modalities?.some(value => value === input || (input === 'pdf' && value === 'file')))
        || (explicitEvidence && evidence.support === 'supported')
        || imageUnknown;
    if (!declared) return false;
    if (input === 'image') return (recognizedImage && ['openai_responses', 'openai_chat_completions', 'anthropic_messages', 'gemini_generate_content', 'cohere_chat'].includes(protocol))
        || (protocol === 'gemini_generate_content' && mime === 'image/bmp');
    if (input === 'pdf') return ['openai_responses', 'openai_chat_completions', 'anthropic_messages', 'gemini_generate_content'].includes(protocol);
    if (input === 'audio') return protocol === 'gemini_generate_content'
        || (protocol === 'openai_chat_completions' && ['audio/wav', 'audio/mp3', 'audio/mpeg'].includes(mime));
    if (input === 'video') return protocol === 'gemini_generate_content';
    // "file" alone may mean PDF only. Other binary formats need an exact
    // MIME declaration as well as a transport that preserves native bytes.
    return Boolean(mimeTypes?.includes(mime)) && ['openai_responses', 'gemini_generate_content'].includes(protocol);
}

/** How an attachment reaches the model on a route. */
export type AttachmentDelivery = 'native' | 'extract' | 'describe';

/** Formats the desktop host turns into text (see node/nextmux-document-text.ts). */
const EXTRACTABLE = /\.(pdf|docx|docm|dotx|xlsx|xlsm|xltx|pptx|pptm|ppsx|odt|ods|odp|ott|epub|rtf|zip|doc|xls|ppt|pages|numbers|key|html?|xhtml|eml|ipynb|svg)$/i;

/**
 * Open-source chat clients (Open WebUI, Cherry Studio, LibreChat) never make
 * the user pick a model per file type: documents are read by the app and sent
 * as text, and images on text-only models fall back to local OCR + metadata
 * extraction. Text-like files that were too large to inline are decoded and
 * truncated the same way.
 */
export function attachmentDelivery(attachment: AgentMessageAttachment, route?: AttachmentRoute): AttachmentDelivery {
    if (attachment.kind === 'text') return 'native';
    if (routeSupportsModelAttachment(attachment, route)) return 'native';
    const mime = attachment.mimeType.toLowerCase().split(';', 1)[0].trim();
    if (attachment.kind === 'image' || mime.startsWith('image/')) return 'extract';
    if (EXTRACTABLE.test(attachment.name) || mime === 'application/pdf' || mime === 'message/rfc822' || mime === 'application/x-ipynb+json'
        || mime.startsWith('text/') || isPlainTextAttachmentMime(mime)
        || /json|xml|yaml|toml|csv|javascript|typescript|sql|x-sh|markdown/.test(mime)) return 'extract';
    return 'describe';
}
