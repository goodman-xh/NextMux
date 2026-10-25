/** Legacy RPC shapes are retained only so old clients receive a safe rejection. */
export interface CloudSpeechSettings {
    readonly cloudEnabled: boolean;
    readonly connectionId?: string;
}
export interface CloudSpeechSettingsState extends CloudSpeechSettings {
    readonly accounts: readonly { readonly id: string; readonly label: string }[];
}
export interface CloudSpeechRequest {
    readonly requestId: string;
    readonly ownerId: string;
    readonly connectionId: string;
    readonly createdAt: number;
    readonly durationMs: number;
    readonly mimeType: 'audio/webm' | 'audio/mp4' | 'audio/wav';
    readonly dataBase64: string;
    readonly locale?: string;
}
export interface CloudSpeechResult {
    readonly requestId: string;
    readonly ownerId: string;
    readonly text: string;
    readonly replayed: boolean;
}
