import { mediaMessage } from "./error-metadata.js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { MediaRuntimeError } from "./runtime.js";
import type { MediaSubtitleCueInput } from "./types.js";

/** Times must come from the recognizer, never from text length or a script. */
export interface TimedTranscriptSegment {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly speakerName?: string;
}

export interface TimedTranscriber {
  readonly id: string;
  readonly localOnly: boolean;
  transcribe(request: { readonly audioPath: string; readonly locale?: string; readonly signal?: AbortSignal }): Promise<{
    readonly segments: readonly TimedTranscriptSegment[];
    readonly language?: string;
    readonly providerRequestId?: string;
  }>;
}

export type MediaToolRunner = (executable: string, args: readonly string[], signal?: AbortSignal) => Promise<void>;

/** Runs only an explicitly supplied local executable, with no command shell. */
export const runMediaTranscriptionTool: MediaToolRunner = async (executable, args, signal) => {
  if (signal?.aborted) throw new MediaRuntimeError("CANCELLED", mediaMessage("media.transcription_was_cancelled"), false);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(executable, [...args], { windowsHide: true, shell: false, stdio: ["ignore", "ignore", "ignore"] });
    let stopped = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => { signal?.removeEventListener("abort", abort); if (killTimer) clearTimeout(killTimer); };
    const abort = (): void => {
      if (stopped) return;
      child.kill();
      killTimer = setTimeout(() => { if (!stopped) child.kill("SIGKILL"); }, 2_000);
      killTimer.unref();
    };
    signal?.addEventListener("abort", abort, { once: true });
    // An abort may occur between the first check and registering the listener.
    if (signal?.aborted) abort();
    child.once("error", () => {
      stopped = true; cleanup();
      rejectPromise(new MediaRuntimeError(signal?.aborted ? "CANCELLED" : "ASR_TOOL_UNAVAILABLE", signal?.aborted ? mediaMessage("media.transcription_was_cancelled") : mediaMessage("media.local_transcription_unavailable"), false));
    });
    child.once("exit", code => {
      stopped = true; cleanup();
      if (signal?.aborted) rejectPromise(new MediaRuntimeError("CANCELLED", mediaMessage("media.transcription_was_cancelled"), false));
      else if (code !== 0) rejectPromise(new MediaRuntimeError("ASR_TOOL_FAILED", mediaMessage("media.audio_extraction_or_local_transcription_failed"), false));
      else resolvePromise();
    });
  });
};

export function timedTranscriptToSubtitleCues(
  segments: readonly TimedTranscriptSegment[], frameRate: 24 | 25 | 30, sourceDurationMs: number,
): readonly MediaSubtitleCueInput[] {
  if (![24, 25, 30].includes(frameRate) || !Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0
      || !Array.isArray(segments) || segments.length < 1 || segments.length > 10_000) {
    throw new MediaRuntimeError("INVALID_TRANSCRIPT", mediaMessage("media.no_timed_subtitles_are_available"), false);
  }
  let previousStart = -1;
  return segments.map(segment => {
    const text = typeof segment.text === "string" ? segment.text.replaceAll("\0", "").trim() : "";
    if (!text || text.length > 4_000 || !Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs)
        || segment.startMs < 0 || segment.endMs <= segment.startMs || segment.endMs > sourceDurationMs
        || segment.startMs < previousStart) {
      throw new MediaRuntimeError("INVALID_TRANSCRIPT_TIMESTAMPS", mediaMessage("media.transcription_has_no_valid_timestamps_estimated_subtitles_were_not_created"), false);
    }
    previousStart = segment.startMs;
    const startFrame = Math.floor(segment.startMs * frameRate / 1_000);
    const endFrame = Math.ceil(segment.endMs * frameRate / 1_000);
    if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)) {
      throw new MediaRuntimeError("INVALID_TRANSCRIPT_TIMESTAMPS", mediaMessage("media.subtitle_timestamps_exceed_the_supported_range"), false);
    }
    return { text, startFrame, durationFrames: endFrame - startFrame,
      ...(segment.speakerName?.trim() ? { speakerName: segment.speakerName.trim().slice(0, 120) } : {}) };
  });
}

/**
 * Extract first audio stream to Whisper's documented 16 kHz mono s16 WAV input.
 * A caller must explicitly select a timed recognizer; microphone dictation is
 * not a file transcription engine. Cloud upload additionally requires consent
 * for that exact recognizer. A failed local run never silently falls back.
 */
export async function transcribeMediaToSubtitleCues(options: {
  readonly sourcePath: string;
  readonly sourceDurationMs: number;
  readonly sourceStartMs?: number;
  /** Absolute media-clock timestamp rather than an offset from the container's start. */
  readonly sourceStartIsTimestamp?: boolean;
  readonly frameRate: 24 | 25 | 30;
  readonly ffmpegPath: string;
  readonly transcriber: TimedTranscriber;
  readonly cloudConsent?: { readonly transcriberId: string; readonly confirmed: true };
  readonly locale?: string;
  readonly signal?: AbortSignal;
  readonly temporaryRoot?: string;
  readonly maximumAudioBytes?: number;
  readonly runTool?: MediaToolRunner;
}): Promise<{ readonly cues: readonly MediaSubtitleCueInput[]; readonly engine: string; readonly localOnly: boolean; readonly language?: string; readonly providerRequestId?: string }> {
  if (options.signal?.aborted) throw new MediaRuntimeError("CANCELLED", mediaMessage("media.transcription_was_cancelled"), false);
  if (!options.transcriber.localOnly && !(options.cloudConsent?.confirmed === true && options.cloudConsent.transcriberId === options.transcriber.id)) {
    throw new MediaRuntimeError("ASR_COST_CONFIRMATION_REQUIRED", mediaMessage("media.confirm_the_cost_before_cloud_transcription"), false);
  }
  if (!isAbsolute(options.sourcePath) || !Number.isFinite(options.sourceDurationMs) || options.sourceDurationMs <= 0) {
    throw new MediaRuntimeError("INVALID_MEDIA_SOURCE", mediaMessage("media.transcription_requires_a_local_media_file_and_valid_duration"), false);
  }
  const sourceStartMs = options.sourceStartMs ?? 0;
  if (!Number.isFinite(sourceStartMs) || sourceStartMs < 0) throw new MediaRuntimeError("INVALID_MEDIA_SOURCE", mediaMessage("media.transcription_source_start_time_is_invalid"), false);
  const sourcePath = await realpath(options.sourcePath);
  if (!(await stat(sourcePath)).isFile()) throw new MediaRuntimeError("INVALID_MEDIA_SOURCE", mediaMessage("media.transcription_source_file_is_unavailable"), false);
  const maximum = options.maximumAudioBytes ?? 512 * 1024 * 1024;
  if (!Number.isSafeInteger(maximum) || maximum < 1_024 || maximum > 2 * 1024 * 1024 * 1024) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.audio_track_size_limit_is_invalid"), false);
  }
  const temporary = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), "nextmux-asr-"));
  const audioPath = join(temporary, "audio.wav");
  try {
    await (options.runTool ?? runMediaTranscriptionTool)(options.ffmpegPath, [
      "-hide_banner", "-nostdin", "-loglevel", "error",
      ...(options.sourceStartIsTimestamp === true ? ["-seek_timestamp", "1", "-ss", String(sourceStartMs / 1_000)] : []),
      "-i", sourcePath,
      ...(options.sourceStartIsTimestamp === true ? [] : ["-ss", String(sourceStartMs / 1_000)]),
      "-t", String(options.sourceDurationMs / 1_000),
      "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
      "-fs", String(maximum), "-f", "wav", audioPath,
    ], options.signal);
    if (options.signal?.aborted) throw new MediaRuntimeError("CANCELLED", mediaMessage("media.transcription_was_cancelled"), false);
    const audioSize = (await stat(audioPath)).size;
    // FFmpeg -fs bounds disk use. Never send or transcribe a truncated result.
    if (audioSize <= 44 || audioSize >= maximum) throw new MediaRuntimeError("ASR_AUDIO_SIZE", mediaMessage("media.audio_track_is_empty_or_exceeds_the_transcription_size_limit"), false);
    const transcript = await options.transcriber.transcribe({ audioPath, locale: options.locale, signal: options.signal });
    if (options.signal?.aborted) throw new MediaRuntimeError("CANCELLED", mediaMessage("media.transcription_was_cancelled"), false);
    return { cues: timedTranscriptToSubtitleCues(transcript.segments, options.frameRate, options.sourceDurationMs),
      engine: options.transcriber.id, localOnly: options.transcriber.localOnly,
      ...(transcript.language ? { language: transcript.language } : {}),
      ...(transcript.providerRequestId ? { providerRequestId: transcript.providerRequestId } : {}) };
  } catch (error) {
    if (options.signal?.aborted && (error as { code?: string })?.code !== "BILLING_TRANSPORT_UNKNOWN")
      throw new MediaRuntimeError("CANCELLED", mediaMessage("media.transcription_was_cancelled"), false);
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** whisper.cpp's documented JSON contains millisecond offsets, not seconds. */
export function parseWhisperCppTranscript(value: unknown): readonly TimedTranscriptSegment[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { transcription?: unknown }).transcription)) {
    throw new MediaRuntimeError("INVALID_TRANSCRIPT", mediaMessage("media.local_transcription_returned_no_timed_subtitles"), false);
  }
  return (value as { transcription: readonly Record<string, unknown>[] }).transcription.map(segment => {
    if (!segment || typeof segment !== "object") throw new MediaRuntimeError("INVALID_TRANSCRIPT", mediaMessage("media.local_transcription_returned_an_invalid_subtitle_segment"), false);
    const offsets = segment.offsets as { from?: unknown; to?: unknown } | undefined;
    if (typeof segment.text !== "string" || typeof offsets?.from !== "number" || typeof offsets.to !== "number") {
      throw new MediaRuntimeError("INVALID_TRANSCRIPT_TIMESTAMPS", mediaMessage("media.local_transcription_returned_no_timestamps"), false);
    }
    return { text: segment.text, startMs: offsets.from, endMs: offsets.to };
  });
}

/** Caller supplies bundled whisper.cpp and its local model; no downloads occur. */
export function createWhisperCppTranscriber(options: {
  readonly executablePath: string; readonly modelPath: string; readonly threads?: number; readonly runTool?: MediaToolRunner;
}): TimedTranscriber {
  return { id: "whisper.cpp", localOnly: true, async transcribe(request) {
    if (!isAbsolute(options.executablePath) || !isAbsolute(options.modelPath)) throw new MediaRuntimeError("ASR_TOOL_UNAVAILABLE", mediaMessage("media.local_transcription_components_are_not_configured"), false);
    for (const file of [options.executablePath, options.modelPath]) {
      if (!(await stat(file).catch(() => undefined))?.isFile()) throw new MediaRuntimeError("ASR_TOOL_UNAVAILABLE", mediaMessage("media.local_transcription_components_or_language_model_are_unavailable"), false);
    }
    const language = request.locale?.split(/[-_]/)[0].toLowerCase() || "auto";
    if (!/^[a-z]{2,3}$/.test(language) && language !== "auto") throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.transcription_language_is_invalid"), false);
    const threads = Number.isSafeInteger(options.threads) && options.threads! >= 1 && options.threads! <= 8 ? options.threads! : 2;
    const temporary = await mkdtemp(join(tmpdir(), "nextmux-whisper-"));
    const outputPrefix = join(temporary, "transcript");
    try {
      await (options.runTool ?? runMediaTranscriptionTool)(options.executablePath, [
        "-m", options.modelPath, "-f", request.audioPath, "-l", language, "-t", String(threads), "-oj", "-of", outputPrefix, "-np",
      ], request.signal);
      const filename = `${outputPrefix}.json`;
      if ((await stat(filename)).size > 8 * 1024 * 1024) throw new MediaRuntimeError("INVALID_TRANSCRIPT", mediaMessage("media.transcription_result_exceeds_the_size_limit"), false);
      let payload: unknown;
      try { payload = JSON.parse(await readFile(filename, "utf8")); } catch { throw new MediaRuntimeError("INVALID_TRANSCRIPT", mediaMessage("media.local_transcription_returned_an_invalid_result"), false); }
      const segments = parseWhisperCppTranscript(payload);
      return { segments };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  } };
}

export type MediaToolCapture = (executable: string, args: readonly string[], signal?: AbortSignal) => Promise<string>;

/** Like {@link runMediaTranscriptionTool}, but returns standard output (at most 4 MB). */
export const captureMediaTranscriptionTool: MediaToolCapture = async (executable, args, signal) => {
  if (signal?.aborted) throw new MediaRuntimeError("CANCELLED", mediaMessage("media.transcription_was_cancelled"), false);
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(executable, [...args], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stopped = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => { signal?.removeEventListener("abort", abort); if (killTimer) clearTimeout(killTimer); };
    const abort = (): void => {
      if (stopped) return;
      child.kill();
      killTimer = setTimeout(() => { if (!stopped) child.kill("SIGKILL"); }, 2_000);
      killTimer.unref();
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) { abort(); return; }
      chunks.push(chunk);
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.once("error", () => {
      stopped = true; cleanup();
      rejectPromise(new MediaRuntimeError(signal?.aborted ? "CANCELLED" : "ASR_TOOL_UNAVAILABLE", signal?.aborted ? mediaMessage("media.transcription_was_cancelled") : mediaMessage("media.local_transcription_unavailable"), false));
    });
    child.once("close", code => {
      stopped = true; cleanup();
      if (signal?.aborted) rejectPromise(new MediaRuntimeError("CANCELLED", mediaMessage("media.transcription_was_cancelled"), false));
      else if (size > 4 * 1024 * 1024) rejectPromise(new MediaRuntimeError("INVALID_TRANSCRIPT", mediaMessage("media.transcription_result_exceeds_the_size_limit"), false));
      else if (code !== 0) rejectPromise(new MediaRuntimeError("ASR_TOOL_FAILED", mediaMessage("media.local_transcription_failed"), false));
      else resolvePromise(Buffer.concat(chunks).toString("utf8"));
    });
  });
};

/** `sherpa-onnx-vad-with-offline-asr` prints one speech segment per line: `0.742 -- 5.568: text`. */
export function parseSherpaOnnxSegments(output: string): readonly TimedTranscriptSegment[] {
  const segments: TimedTranscriptSegment[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+(?:\.\d+)?)\s+--\s+(\d+(?:\.\d+)?)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const text = match[3].replace(/<\|[^|>]{1,40}\|>/g, "").replace(/\s+/g, " ").trim();
    const startMs = Math.round(Number(match[1]) * 1000);
    const endMs = Math.round(Number(match[2]) * 1000);
    if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    segments.push({ text: text.slice(0, 1_000), startMs, endMs });
    if (segments.length >= 2_000) break;
  }
  return segments;
}

export type SherpaOnnxModel =
  /** SenseVoice (zh, en, ja, ko, yue). */
  | { readonly kind: "sense_voice"; readonly modelPath: string; readonly tokensPath: string }
  /** Whisper (multilingual). */
  | { readonly kind: "whisper"; readonly encoderPath: string; readonly decoderPath: string; readonly tokensPath: string };

/**
 * Offline recognition with sherpa-onnx (Apache-2.0): Silero VAD cuts the audio into short speech
 * segments (at most ~8 s, the length of a subtitle line) and the chosen model transcribes each.
 */
export function createSherpaOnnxTranscriber(options: {
  readonly executablePath: string; readonly vadModelPath: string; readonly model: SherpaOnnxModel; readonly threads?: number; readonly capture?: MediaToolCapture;
}): TimedTranscriber {
  return { id: "sherpa-onnx", localOnly: true, async transcribe(request) {
    const files = [options.executablePath, options.vadModelPath, options.model.tokensPath,
      ...(options.model.kind === "sense_voice" ? [options.model.modelPath] : [options.model.encoderPath, options.model.decoderPath])];
    for (const file of files) {
      if (!isAbsolute(file) || !(await stat(file).catch(() => undefined))?.isFile()) throw new MediaRuntimeError("ASR_TOOL_UNAVAILABLE", mediaMessage("media.local_transcription_components_or_language_model_are_unavailable"), false);
    }
    const language = request.locale?.split(/[-_]/)[0].toLowerCase() || "";
    if (language && !/^[a-z]{2,3}$/.test(language)) throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.transcription_language_is_invalid"), false);
    const threads = Number.isSafeInteger(options.threads) && options.threads! >= 1 && options.threads! <= 8 ? options.threads! : 2;
    const model = options.model;
    const modelArgs = model.kind === "sense_voice"
      ? [`--sense-voice-model=${model.modelPath}`, "--sense-voice-use-itn=1",
        `--sense-voice-language=${["zh", "en", "ja", "ko", "yue"].includes(language) ? language : "auto"}`]
      : [`--whisper-encoder=${model.encoderPath}`, `--whisper-decoder=${model.decoderPath}`, "--whisper-task=transcribe",
        ...(language ? [`--whisper-language=${language === "jp" ? "ja" : language}`] : [])];
    const output = await (options.capture ?? captureMediaTranscriptionTool)(options.executablePath, [
      `--silero-vad-model=${options.vadModelPath}`, "--silero-vad-max-speech-duration=8", "--silero-vad-min-silence-duration=0.35",
      `--tokens=${model.tokensPath}`, ...modelArgs, `--num-threads=${threads}`, request.audioPath,
    ], request.signal);
    return { segments: parseSherpaOnnxSegments(output) };
  } };
}
