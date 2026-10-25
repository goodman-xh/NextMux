export interface BillingReceiptMedia {
    readonly kind: 'image' | 'speech' | 'music' | 'sound_effect';
    readonly requestId: string;
    readonly downloadPath?: string;
    readonly transfer?: 'stream-v2';
    readonly contentRetained?: false;
    readonly partId?: string;
    readonly mimeType: string;
    readonly extension: 'png' | 'jpg' | 'webp' | 'gif' | 'mp3' | 'wav' | 'ogg' | 'flac';
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly expiresAt: number;
    readonly provider: string;
    readonly model: string;
}

export interface BillingReceiptRecovery {
    readonly requestId: string;
    readonly status: 'recovered' | 'pending' | 'review' | 'expired';
    readonly retryAfterMs?: number;
    readonly result?: {
        readonly model: string;
        readonly content: string;
        readonly citations?: readonly import('@nextmux/agent-runtime').ModelCitation[];
        readonly toolCallCount: number;
        readonly currency: string;
        readonly chargedMicros: number;
        readonly media?: BillingReceiptMedia;
    };
}
