import type { SpeechRecognitionEngineAdapter, SpeechRecognitionSession, SpeechRecognitionStartOptions } from './nextmux-microphone-policy';

/** Older callers must fail closed and release capture, never upload a recording. */
export class CloudSpeechEngine implements SpeechRecognitionEngineAdapter {
    readonly id = 'disabled-cloud-transcription';
    readonly execution = 'cloud' as const;
    constructor(_legacyOptions?: unknown) {}
    async readiness(): Promise<'unsupported'> { return 'unsupported'; }
    async start(options: SpeechRecognitionStartOptions): Promise<SpeechRecognitionSession> {
        for (const track of options.stream.getTracks()) {
            try { track.stop(); } catch { /* Release the remaining tracks too. */ }
        }
        throw new Error('SPEECH_SYSTEM_DICTATION_ONLY');
    }
}
