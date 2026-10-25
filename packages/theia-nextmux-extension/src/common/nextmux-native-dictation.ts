export type NativeDictationStatus = 'ready' | 'permission-required' | 'permission-denied' | 'language-unavailable' | 'platform-unavailable' | 'helper-unavailable';
export interface NativeDictationCapability {
    readonly status: NativeDictationStatus;
    readonly engine: 'macos-speech' | 'windows-system-speech' | 'none';
    readonly localOnly: true;
    readonly defaultDeviceOnly: true;
}
export type NativeDictationEvent = { readonly sessionId: string } & (
    { readonly type: 'listening' }
    /** Measured intensity from the same native recognition input, finite 0..1, at most 10 Hz. */
    | { readonly type: 'level'; readonly value: number }
    /** Whole-session cumulative text: committed utterances plus the current
     * replaceable utterance. A final utterance does not end the microphone. */
    | { readonly type: 'transcript'; readonly text: string; readonly final: boolean }
    | { readonly type: 'end'; readonly reason: string }
);
export interface NativeDictationBridge {
    getSpeechCapability(locale: string): Promise<NativeDictationCapability>;
    startSpeech(request: { readonly sessionId: string; readonly locale: string; readonly deviceId?: string }): Promise<boolean>;
    finishSpeech(sessionId: string): Promise<boolean>;
    cancelSpeech(sessionId: string): Promise<boolean>;
    onSpeechEvent(callback: (event: NativeDictationEvent) => void): () => void;
}
