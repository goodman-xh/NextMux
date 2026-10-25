import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { createWhisperCppTranscriber, parseWhisperCppTranscript, runMediaTranscriptionTool,
  timedTranscriptToSubtitleCues, transcribeMediaToSubtitleCues } from "../lib/transcription.js";

test("timed transcripts preserve recognizer timings and reject text-only or fabricated bounds", () => {
  const segments = parseWhisperCppTranscript({ transcription: [{ text: "  hello  ", offsets: { from: 250, to: 750 } }] });
  assert.deepEqual(timedTranscriptToSubtitleCues(segments, 24, 1_000), [{ text: "hello", startFrame: 6, durationFrames: 12 }]);
  assert.throws(() => parseWhisperCppTranscript({ transcription: [{ text: "no timestamps" }] }), { code: "INVALID_TRANSCRIPT_TIMESTAMPS" });
  assert.throws(() => timedTranscriptToSubtitleCues([{ text: "bad", startMs: 0, endMs: 1_001 }], 24, 1_000), { code: "INVALID_TRANSCRIPT_TIMESTAMPS" });
});

test("FFmpeg extraction passes local mono 16k WAV to a timed transcriber and cleans the temporary audio", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-asr-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.wav");
  const requireDesktop = createRequire(new URL("../../theia-nextmux-extension/package.json", import.meta.url));
  const ffmpeg = process.env.NEXTMUX_TEST_FFMPEG || (() => { try { return requireDesktop("@ffmpeg-installer/ffmpeg").path as string; } catch { return undefined; } })();
  if (!ffmpeg) { t.skip("bundled FFmpeg test binary unavailable"); return; }
  try { await access(ffmpeg); } catch { t.skip("local FFmpeg test binary unavailable"); return; }
  await runMediaTranscriptionTool(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=1000:duration=1", source]);
  let extracted = "";
  const result = await transcribeMediaToSubtitleCues({ sourcePath: source, sourceDurationMs: 1_000, frameRate: 25, ffmpegPath: ffmpeg,
    transcriber: { id: "offline-test", localOnly: true, async transcribe({ audioPath }) {
      extracted = audioPath;
      const wav = await readFile(audioPath);
      assert.equal(wav.toString("ascii", 0, 4), "RIFF");
      assert.equal(wav.readUInt16LE(22), 1);
      assert.equal(wav.readUInt32LE(24), 16_000);
      return { segments: [{ text: "真实时间", startMs: 200, endMs: 800 }] };
    } },
  });
  assert.deepEqual(result.cues, [{ text: "真实时间", startFrame: 5, durationFrames: 15 }]);
  assert.equal(result.localOnly, true);
  await assert.rejects(access(extracted));
});

test("absolute ASR source timestamps seek the intended audio after a nonzero media origin; legacy offsets remain compatible", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-asr-origin-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requireDesktop = createRequire(new URL("../../theia-nextmux-extension/package.json", import.meta.url));
  const ffmpeg = process.env.NEXTMUX_TEST_FFMPEG || (() => { try { return requireDesktop("@ffmpeg-installer/ffmpeg").path as string; } catch { return undefined; } })();
  if (!ffmpeg) { t.skip("bundled FFmpeg test binary unavailable"); return; }
  try { await access(ffmpeg); } catch { t.skip("local FFmpeg test binary unavailable"); return; }
  const sourcePath = join(root, "source.mka");
  await runMediaTranscriptionTool(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=16000",
    "-f", "lavfi", "-i", "sine=frequency=880:duration=1:sample_rate=16000",
    "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[out]", "-map", "[out]", "-c:a", "pcm_s16le",
    "-output_ts_offset", "5", sourcePath]);
  const frequencies: number[] = [];
  const calls: string[][] = [];
  const extract = async (sourceStartMs: number, sourceStartIsTimestamp?: boolean) => transcribeMediaToSubtitleCues({
    sourcePath, sourceDurationMs: 400, sourceStartMs, sourceStartIsTimestamp, frameRate: 25, ffmpegPath: ffmpeg,
    runTool: async (executable, args, signal) => { calls.push([...args]); await runMediaTranscriptionTool(executable, args, signal); },
    transcriber: { id: "offline-origin-test", localOnly: true, async transcribe({ audioPath }) {
      const wav = await readFile(audioPath);
      let dataStart = -1, dataLength = 0;
      for (let offset = 12; offset + 8 <= wav.length;) {
        const length = wav.readUInt32LE(offset + 4);
        if (wav.toString("ascii", offset, offset + 4) === "data") { dataStart = offset + 8; dataLength = Math.min(length, wav.length - dataStart); break; }
        offset += 8 + length + length % 2;
      }
      assert.ok(dataStart >= 0 && dataLength >= 3200, "ASR receives real extracted audio rather than an empty seek result");
      const samples = Math.min(3200, Math.floor(dataLength / 2));
      let crossings = 0;
      for (let index = 1; index < samples; index++) if (wav.readInt16LE(dataStart + (index - 1) * 2) <= 0 && wav.readInt16LE(dataStart + index * 2) > 0) crossings++;
      frequencies.push(crossings * 16000 / samples);
      return { segments: [{ text: "selected tone", startMs: 0, endMs: 200 }] };
    } },
  });
  await extract(6_000, true);
  await extract(1_000);
  assert.ok(frequencies.every(frequency => Math.abs(frequency - 880) < 15), `both absolute timestamp and legacy offset select the second tone: ${frequencies}`);
  assert.equal(calls[0]![calls[0]!.indexOf("-seek_timestamp") + 1], "1");
  assert.ok(calls[0]!.indexOf("-ss") < calls[0]!.indexOf("-i"), "absolute timestamp seeking must be an input option");
  assert.equal(calls[1]!.includes("-seek_timestamp"), false);
  assert.ok(calls[1]!.indexOf("-ss") > calls[1]!.indexOf("-i"), "existing offset callers keep their output-seek semantics");
});

test("cloud transcript extraction requires consent for that exact provider before any work", async () => {
  let called = false;
  const options = { sourcePath: "/unused", sourceDurationMs: 1000, frameRate: 24 as const, ffmpegPath: "/unused",
    transcriber: { id: "paid-asr", localOnly: false, async transcribe() { called = true; return { segments: [] }; } },
    runTool: async () => { called = true; },
  };
  await assert.rejects(transcribeMediaToSubtitleCues(options), { code: "ASR_COST_CONFIRMATION_REQUIRED" });
  await assert.rejects(transcribeMediaToSubtitleCues({ ...options, cloudConsent: { transcriberId: "different-provider", confirmed: true } }), { code: "ASR_COST_CONFIRMATION_REQUIRED" });
  assert.equal(called, false);
});

test("whisper.cpp adapter uses documented JSON output flags and millisecond offsets", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-whisper-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executablePath = join(root, "whisper-cli"); const modelPath = join(root, "model.bin");
  await writeFile(executablePath, "fixture"); await writeFile(modelPath, "fixture");
  let outputFile = "";
  const adapter = createWhisperCppTranscriber({ executablePath, modelPath, runTool: async (executable, args) => {
    assert.equal(executable, executablePath);
    assert.ok(args.includes("-oj")); assert.equal(args[args.indexOf("-l") + 1], "zh");
    assert.equal(args[args.indexOf("-t") + 1], "2");
    outputFile = `${args[args.indexOf("-of") + 1]}.json`;
    await writeFile(outputFile, JSON.stringify({ transcription: [{ text: "你好", offsets: { from: 100, to: 300 } }] }));
  } });
  const result = await adapter.transcribe({ audioPath: join(root, "audio.wav"), locale: "zh-CN" });
  assert.deepEqual(result.segments, [{ text: "你好", startMs: 100, endMs: 300 }]);
  assert.equal(adapter.localOnly, true);
  await assert.rejects(access(outputFile));
});

test("cancelled transcription never launches extraction or uploads audio", async () => {
  const controller = new AbortController(); controller.abort();
  let called = false;
  await assert.rejects(transcribeMediaToSubtitleCues({ sourcePath: "/unused", sourceDurationMs: 1_000, frameRate: 24,
    ffmpegPath: "/unused", signal: controller.signal, runTool: async () => { called = true; },
    transcriber: { id: "local", localOnly: true, async transcribe() { called = true; return { segments: [] }; } },
  }), { code: "CANCELLED" });
  assert.equal(called, false);
});

test("a cancelled paid upload keeps an unknown billing outcome visible", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-paid-asr-abort-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, "source.wav");
  await writeFile(sourcePath, Buffer.alloc(128, 1));
  const controller = new AbortController();
  const billing = Object.assign(new Error("Review the original charge"), { code: "BILLING_TRANSPORT_UNKNOWN" });
  await assert.rejects(transcribeMediaToSubtitleCues({ sourcePath, sourceDurationMs: 1_000, frameRate: 24,
    ffmpegPath: "/fixture/ffmpeg", signal: controller.signal,
    cloudConsent: { transcriberId: "managed:transcription", confirmed: true },
    runTool: async (_executable, args) => { await writeFile(args.at(-1)!, Buffer.alloc(128, 1)); },
    transcriber: { id: "managed:transcription", localOnly: false, async transcribe() {
      controller.abort();
      throw billing;
    } },
  }), error => error === billing);
});

test("sherpa-onnx segments become timed transcript lines; model arguments follow the model and language", async () => {
  const { parseSherpaOnnxSegments, createSherpaOnnxTranscriber } = await import("../lib/index.js");
  assert.deepEqual(parseSherpaOnnxSegments("Started\n0.742 -- 5.568: <|zh|><|NEUTRAL|>开放时间早上九点至下午五点\n6.000 -- 6.000: empty\nnoise\n7.1 -- 9.25:  Hello   world \n"), [
    { text: "开放时间早上九点至下午五点", startMs: 742, endMs: 5568 },
    { text: "Hello world", startMs: 7100, endMs: 9250 },
  ]);
  const dir = await mkdtemp(join(tmpdir(), "nm-sherpa-"));
  try {
    const file = (name: string) => join(dir, name);
    for (const name of ["asr", "vad.onnx", "model.onnx", "tokens.txt", "enc.onnx", "dec.onnx"]) await writeFile(file(name), "x");
    const calls: string[][] = [];
    const capture = async (_executable: string, args: readonly string[]) => { calls.push([...args]); return "0.5 -- 1.5: hola\n"; };
    const senseVoice = createSherpaOnnxTranscriber({ executablePath: file("asr"), vadModelPath: file("vad.onnx"), capture,
      model: { kind: "sense_voice", modelPath: file("model.onnx"), tokensPath: file("tokens.txt") } });
    assert.deepEqual((await senseVoice.transcribe({ audioPath: "/tmp/a.wav", locale: "zh-CN" })).segments, [{ text: "hola", startMs: 500, endMs: 1500 }]);
    assert.ok(calls[0].includes("--sense-voice-language=zh") && calls[0].includes("--sense-voice-use-itn=1") && calls[0].at(-1) === "/tmp/a.wav");
    const whisper = createSherpaOnnxTranscriber({ executablePath: file("asr"), vadModelPath: file("vad.onnx"), capture,
      model: { kind: "whisper", encoderPath: file("enc.onnx"), decoderPath: file("dec.onnx"), tokensPath: file("tokens.txt") } });
    await whisper.transcribe({ audioPath: "/tmp/b.wav", locale: "es" });
    assert.ok(calls[1].includes("--whisper-language=es") && calls[1].includes("--whisper-task=transcribe"));
    await assert.rejects(createSherpaOnnxTranscriber({ executablePath: file("missing"), vadModelPath: file("vad.onnx"), capture,
      model: { kind: "sense_voice", modelPath: file("model.onnx"), tokensPath: file("tokens.txt") } }).transcribe({ audioPath: "/tmp/a.wav" }), { code: "ASR_TOOL_UNAVAILABLE", messageKey: "media.local_transcription_components_or_language_model_are_unavailable" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
