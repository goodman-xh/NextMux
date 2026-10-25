import { mediaMessage } from "./error-metadata.js";
import type { MediaSubtitleCueInput } from "./types.js";
import { MediaCoreError } from "./validation.js";

export function formatSrtTimestamp(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 24 * 60 * 60 * 1000) {
    throw new MediaCoreError("INVALID_SUBTITLE_TIME", mediaMessage("media.subtitle_timestamp_is_outside_the_24_hour_limit"));
  }
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const seconds = Math.floor(milliseconds / 1_000) % 60;
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function validateCues(cues: readonly MediaSubtitleCueInput[], maximum: number): void {
  if (!Array.isArray(cues) || cues.length < 1 || cues.length > maximum) {
    throw new MediaCoreError("INVALID_SUBTITLE", mediaMessage("media.subtitle_export_needs_1_to_field_cues", { maximum: maximum }));
  }
}

export function renderSrt(cues: readonly MediaSubtitleCueInput[], frameRate: 24 | 25 | 30, maximum = 100): string {
  validateCues(cues, maximum);
  return `${cues.map((cue, index) => {
    const start = Math.round(cue.startFrame * 1_000 / frameRate);
    const end = Math.max(start + 1, Math.round((cue.startFrame + cue.durationFrames) * 1_000 / frameRate));
    // Only the line itself: a subtitle never shows who speaks (the picture does).
    const text = cue.text.replaceAll("\0", "").replace(/\r\n?/g, "\n").trim();
    return `${index + 1}\n${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}\n${text}`;
  }).join("\n\n")}\n`;
}

function cueRows(cues: readonly MediaSubtitleCueInput[], frameRate: 24 | 25 | 30, maximum = 100): readonly {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}[] {
  validateCues(cues, maximum);
  return cues.map(cue => {
    const start = Math.round(cue.startFrame * 1_000 / frameRate);
    const end = Math.max(start + 1, Math.round((cue.startFrame + cue.durationFrames) * 1_000 / frameRate));
    return {
      start,
      end,
      text: cue.text.replaceAll("\0", "").replace(/\r\n?/g, "\n").trim(),
    };
  });
}

export function renderVtt(cues: readonly MediaSubtitleCueInput[], frameRate: 24 | 25 | 30, maximum = 100): string {
  const rows = cueRows(cues, frameRate, maximum);
  const timestamp = (milliseconds: number): string => formatSrtTimestamp(milliseconds).replace(",", ".");
  return `WEBVTT\n\n${rows.map((row, index) => `${index + 1}\n${timestamp(row.start)} --> ${timestamp(row.end)}\n${row.text}`).join("\n\n")}\n`;
}

export function renderAss(cues: readonly MediaSubtitleCueInput[], frameRate: 24 | 25 | 30, maximum = 100): string {
  const rows = cueRows(cues, frameRate, maximum);
  const timestamp = (milliseconds: number): string => {
    const centiseconds = Math.floor(milliseconds / 10);
    const hours = Math.floor(centiseconds / 360000) % 100;
    const minutes = Math.floor(centiseconds / 6000) % 60;
    const seconds = Math.floor(centiseconds / 100) % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
  };
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft YaHei,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,40,40,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${rows.map(row => `Dialogue: 0,${timestamp(row.start)},${timestamp(row.end)},Default,,0,0,0,,${row.text.replace(/\r?\n/g, "\\N")}`).join("\n")}\n`;
}

export function renderSubtitle(cues: readonly MediaSubtitleCueInput[], frameRate: 24 | 25 | 30, format: "srt" | "vtt" | "ass" = "srt", maximum = 100): string {
  if (format === "vtt") return renderVtt(cues, frameRate, maximum);
  if (format === "ass") return renderAss(cues, frameRate, maximum);
  return renderSrt(cues, frameRate, maximum);
}
