import { readFile, stat } from 'node:fs/promises';
import { MediaRuntimeError, mediaMessage, type TimedTranscriber, type TimedTranscriptSegment } from '@nextmux/media-core';
import { readBoundedMediaBody } from './nextmux-recovered-media';
import type { UpstreamPrivacyPreference } from '../common/nextmux-upstream-privacy-preference';

/** File transcription uses the same device session and quote as managed media. */
export function createManagedTranscriber(options: {
    readonly endpoint: string;
    readonly deviceId: string;
    readonly requestId: string;
    readonly model: string;
    readonly route: Readonly<Record<string, string | boolean | number | UpstreamPrivacyPreference>>;
    readonly fetchImpl: typeof fetch;
    readonly responseError: (response: Response, payload: Record<string, any>) => Error;
    readonly withCapacity?: (identity: unknown, submit: () => Promise<{response: Response; payload: Record<string, any>}>, signal?: AbortSignal) => Promise<{response: Response; payload: Record<string, any>}>;
    readonly transportError: (cause: unknown, responseReceived: boolean) => Error;
}): TimedTranscriber {
    return { id: 'managed:transcription', localOnly: false, async transcribe(request) {
        if (request.signal?.aborted) throw new MediaRuntimeError('CANCELLED', mediaMessage('media.transcription_was_cancelled'), false);
        const size = (await stat(request.audioPath)).size;
        if (size <= 44 || size > 25 * 1024 * 1024) throw new MediaRuntimeError('ASR_AUDIO_SIZE', mediaMessage('media.audio_track_is_empty_or_exceeds_the_transcription_size_limit'), false);
        const bytes = await readFile(request.audioPath);
        const language = request.locale?.split(/[-_]/)[0]?.toLowerCase();
        // Identity is hashed by the metadata journal; audio bytes never enter it.
        const identity = { model: options.model, route: options.route, language, audioBase64: bytes.toString('base64') };
        const submit = async () => {
            // Build only after capacity recovery has restored any proven old
            // privacy fields; otherwise the journal and multipart would differ.
            const body = new FormData();
            body.set('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'audio.wav');
            body.set('model', options.model);
            body.set('response_format', 'verbose_json');
            body.append('timestamp_granularities[]', 'segment');
            if (language && /^[a-z]{2,3}$/.test(language)) body.set('language', language);
            for (const [key, value] of Object.entries(identity.route)) body.set(key,
                key === 'privacyPreference' && typeof value === 'object' ? JSON.stringify(value) : String(value));
            let response: Response;
        try {
            response = await options.fetchImpl(options.endpoint, {
                method: 'POST', body, redirect: 'error', signal: request.signal,
                headers: { accept: 'application/json', 'x-nextmux-device-id': options.deviceId, 'idempotency-key': options.requestId }
            });
        } catch (error) { throw options.transportError(error, false); }
        let payload: Record<string, any> = {};
        try { payload = JSON.parse(Buffer.from(await readBoundedMediaBody(response, 2 * 1024 * 1024)).toString('utf8')); }
        catch (error) { if (response.ok) throw options.transportError(error, true); }
        if (!response.ok) throw options.responseError(response, payload || {});
            return { response, payload };
        };
        const { response, payload } = await (options.withCapacity ? options.withCapacity(identity, submit, request.signal) : submit());
        if (!payload || !Array.isArray(payload.segments) || !payload.segments.length || payload.segments.length > 10_000) {
            throw new MediaRuntimeError('INVALID_TRANSCRIPT_TIMESTAMPS', mediaMessage('media.transcription_has_no_valid_timestamps_estimated_subtitles_were_not_created'), false);
        }
        const segments: TimedTranscriptSegment[] = payload.segments.map((segment: Record<string, unknown>) => {
            if (!segment || typeof segment.text !== 'string' || typeof segment.start !== 'number' || typeof segment.end !== 'number'
                || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start) {
                throw new MediaRuntimeError('INVALID_TRANSCRIPT_TIMESTAMPS', mediaMessage('media.transcription_has_no_valid_timestamps_estimated_subtitles_were_not_created'), false);
            }
            return { text: segment.text, startMs: segment.start * 1000, endMs: segment.end * 1000 };
        });
        return { segments, ...(typeof payload.language === 'string' ? { language: payload.language } : {}),
            ...(response.headers.get('x-nextmux-request-id') ? { providerRequestId: response.headers.get('x-nextmux-request-id')! } : {}) };
    } };
}
