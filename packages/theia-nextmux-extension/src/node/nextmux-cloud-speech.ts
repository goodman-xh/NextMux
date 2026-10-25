import type { CloudSpeechRequest, CloudSpeechResult, CloudSpeechSettings, CloudSpeechSettingsState } from '../common/nextmux-speech-input';

export class CloudSpeechError extends Error {
    constructor(readonly code: string) { super(code); this.name = 'CloudSpeechError'; }
}

/**
 * Fail-closed compatibility for old renderer/RPC clients. System dictation does
 * not use a model account. Existing speech settings and audit files are left
 * untouched; even a previously enabled setting can never authorize an upload.
 */
export class CloudSpeechService {
    constructor(_legacyDependencies?: unknown) {}
    async state(): Promise<CloudSpeechSettingsState> { return { cloudEnabled: false, accounts: [] }; }
    async configure(value: CloudSpeechSettings): Promise<CloudSpeechSettingsState> {
        if (value?.cloudEnabled !== false) throw new CloudSpeechError('SPEECH_SYSTEM_DICTATION_ONLY');
        return this.state();
    }
    async transcribe(_request: CloudSpeechRequest): Promise<CloudSpeechResult> {
        throw new CloudSpeechError('SPEECH_SYSTEM_DICTATION_ONLY');
    }
    cancel(_requestId: string, _ownerId: string): void {}
    cancelAll(): void {}
}
