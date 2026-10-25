import type {
  ComicVoiceCommand,
  ComicVoiceCommandContext,
  ComicVoiceCommandResult,
} from "./pipeline.js";

export interface ComicPlaybackState {
  readonly episodeNumber: number;
  readonly currentSeconds: number;
  readonly durationSeconds: number;
  readonly playing: boolean;
  readonly speed: number;
}

export interface ComicVoiceSession {
  readonly id: string;
  readonly state: "idle" | "listening" | "thinking" | "speaking";
  readonly transcript: string;
  readonly interrupted: boolean;
  readonly lastCommand?: ComicVoiceCommand;
  readonly updatedAt: string;
}

export interface ComicVoiceSessionControllerOptions {
  readonly id?: string;
  readonly now?: () => string;
}

/**
 * Provider-neutral realtime voice state. Audio capture, STT and TTS remain
 * outside comic-core; this controller owns the interruption and transcript
 * lifecycle so browser, native and remote transports behave identically.
 */
export class ComicVoiceSessionController {
  private readonly id: string;
  private readonly now: () => string;
  private value: ComicVoiceSession;

  constructor(options: ComicVoiceSessionControllerOptions = {}) {
    this.id = options.id || `comic-voice-${cryptoRandomId()}`;
    this.now = options.now || (() => new Date().toISOString());
    this.value = this.snapshotValue("idle");
  }

  get session(): ComicVoiceSession {
    return this.value;
  }

  startListening(): ComicVoiceSession {
    this.value = this.snapshotValue("listening", { transcript: "", interrupted: false });
    return this.value;
  }

  appendTranscript(text: string): ComicVoiceSession {
    const transcript = text.replace(/[\u0000\r]/g, "").slice(0, 8_000);
    this.value = this.snapshotValue("listening", { transcript });
    return this.value;
  }

  beginThinking(): ComicVoiceSession {
    this.value = this.snapshotValue("thinking");
    return this.value;
  }

  acceptCommand(command: ComicVoiceCommand): ComicVoiceSession {
    this.value = this.snapshotValue("thinking", { lastCommand: command });
    return this.value;
  }

  beginSpeaking(): ComicVoiceSession {
    this.value = this.snapshotValue("speaking");
    return this.value;
  }

  /** Interrupting speech immediately returns ownership to the microphone. */
  interrupt(): ComicVoiceSession {
    this.value = this.snapshotValue("listening", { interrupted: true });
    return this.value;
  }

  stop(): ComicVoiceSession {
    this.value = this.snapshotValue("idle", { transcript: "", interrupted: false });
    return this.value;
  }

  private snapshotValue(
    state: ComicVoiceSession["state"],
    patch: Partial<Pick<ComicVoiceSession, "transcript" | "interrupted" | "lastCommand">> = {},
  ): ComicVoiceSession {
    return {
      id: this.id,
      state,
      transcript: patch.transcript ?? this.value?.transcript ?? "",
      interrupted: patch.interrupted ?? this.value?.interrupted ?? false,
      ...(patch.lastCommand || this.value?.lastCommand
        ? { lastCommand: patch.lastCommand || this.value.lastCommand }
        : {}),
      updatedAt: this.now(),
    };
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** Apply only local playback commands; no network/media generation is needed. */
export function applyComicPlaybackCommand(
  state: ComicPlaybackState,
  command: Extract<ComicVoiceCommand, {
    readonly type: "play" | "pause" | "seek_episode" | "seek_time" | "rewind" | "forward" | "change_speed"
  }>,
): ComicPlaybackState {
  const clamp = (seconds: number): number => Math.max(0, Math.min(state.durationSeconds, seconds));
  switch (command.type) {
    case "play": return { ...state, playing: true };
    case "pause": return { ...state, playing: false };
    case "seek_episode": return { ...state, episodeNumber: command.episodeNumber, currentSeconds: 0, playing: true };
    case "seek_time": return {
      ...state,
      ...(command.episodeNumber === undefined ? {} : { episodeNumber: command.episodeNumber }),
      currentSeconds: clamp(command.seconds),
      playing: !command.hold,
    };
    case "rewind": return { ...state, currentSeconds: clamp(state.currentSeconds - command.seconds), playing: true };
    case "forward": return { ...state, currentSeconds: clamp(state.currentSeconds + command.seconds), playing: true };
    case "change_speed": return { ...state, speed: command.speed };
  }
}

function numberValue(value: string): number | undefined {
  const arabic = Number(value);
  if (Number.isSafeInteger(arabic) && arabic >= 0) return arabic;
  const digits: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  if (value.length === 1 && digits[value] !== undefined) return digits[value];
  if (value === "十") return 10;
  if (value.startsWith("十") && digits[value.slice(1)] !== undefined) return 10 + digits[value.slice(1)];
  const tens = value.match(/^([一二两三四五六七八九])十([一二三四五六七八九])?$/);
  if (tens) return (digits[tens[1]] ?? 0) * 10 + (tens[2] ? digits[tens[2]] : 0);
  return undefined;
}

function secondsValue(value: string): number | undefined {
  const match = value.match(/(\d+(?:\.\d+)?)\s*(?:秒|seconds?|secs?)/iu);
  if (match) return Number(match[1]);
  const chinese = value.match(/([零一二两三四五六七八九十]+)\s*秒/u);
  return chinese ? numberValue(chinese[1]) : undefined;
}

function timeValue(value: string): number | undefined {
  // Speech recognition commonly inserts "的"/"第" before a time unit:
  // "第二集的第五分三十秒" and "第 2 集的 5 分 30 秒" must remain local
  // playback commands, not become paid media jobs.
  const normalized = value.trim().replace(/^的\s*/u, "").replace(/^第\s*/u, "");
  const clock = normalized.match(/(?:(\d+|[零一二两三四五六七八九十]+)\s*(?:分|minutes?|mins?))?\s*(?:(\d+(?:\.\d+)?|[零一二两三四五六七八九十]+)\s*(?:秒|seconds?|secs?))?/iu);
  if (!clock || (!clock[1] && !clock[2])) return undefined;
  const minutes = clock[1] ? numberValue(clock[1]) : 0;
  const seconds = clock[2]
    ? (/^\d+(?:\.\d+)?$/.test(clock[2]) ? Number(clock[2]) : numberValue(clock[2]))
    : 0;
  if (minutes === undefined || seconds === undefined) return undefined;
  return minutes * 60 + seconds;
}

function timeRangeValue(value: string): { readonly startSeconds: number; readonly endSeconds: number } | undefined {
  const range = value.match(/(?:从|from)\s*(.+?)\s*(?:到|至|to)\s*(.+?)(?=\s*(?:修改|改成|替换|这一段|这段|$))/iu);
  if (!range) return undefined;
  const startSeconds = timeValue(range[1]);
  const endSeconds = timeValue(range[2]);
  if (startSeconds === undefined || endSeconds === undefined || endSeconds <= startSeconds) return undefined;
  return { startSeconds, endSeconds };
}

/**
 * Converts common Chinese voice commands into typed actions. Speech-to-text
 * and the realtime audio transport stay outside comic-core; this parser is
 * deterministic and therefore safe to use for playback controls.
 */
export function parseComicVoiceCommand(text: string): ComicVoiceCommand | undefined {
  const value = text.trim().replace(/[。！!？?，,]+$/g, "");
  if (!value) return undefined;
  if (/^(播放|继续播放|继续|开始播放|play|resume|continue)$/iu.test(value)) return { type: "play" };
  if (/^(暂停|停|停下|停一下|停止|停止播放|暂停播放|pause|stop)$/iu.test(value)) return { type: "pause" };
  if (/^(回到开头|从头播放|从头开始|重新播放|重播|restart|from the (?:start|beginning))$/iu.test(value)) {
    return { type: "seek_time", seconds: 0 };
  }

  // "停留在 12 秒" / "定格在第 5 秒": jump there and hold the frame.
  const hold = value.match(/^(?:停留在|停在|定格在|定格到|停到)\s*(?:第\s*([0-9一二两三四五六七八九十]+)\s*集\s*的?)?\s*(.+)$/u);
  if (hold) {
    const seconds = timeValue(hold[2]);
    if (seconds !== undefined) {
      const episodeNumber = hold[1] ? numberValue(hold[1]) : undefined;
      return { type: "seek_time", ...(episodeNumber ? { episodeNumber } : {}), seconds, hold: true };
    }
  }

  // "快进到 30 秒" / "后退到 10 秒" name an absolute position, unlike "快进 5 秒".
  const absolute = value.match(/^(?:快进|前进|后退|倒退|回退|倒回|回|往前|往后)\s*(?:到|至)\s*(?:第\s*([0-9一二两三四五六七八九十]+)\s*集\s*的?)?\s*(.*)$/u);
  if (absolute) {
    const episodeNumber = absolute[1] ? numberValue(absolute[1]) : undefined;
    const seconds = absolute[2] ? timeValue(absolute[2]) : undefined;
    if (seconds !== undefined) return { type: "seek_time", ...(episodeNumber ? { episodeNumber } : {}), seconds };
    if (episodeNumber && !absolute[2]?.trim()) return { type: "seek_episode", episodeNumber };
  }

  const englishSeek = value.match(/^(?:go\s*to|jump\s*to|seek\s*to)\s+(.+)$/iu);
  if (englishSeek) {
    const target = englishSeek[1].trim();
    const explicitEpisode = target.match(/^episode\s+(\d+)(?:\s+(.+))?$/iu);
    const episodeNumber = explicitEpisode ? Number(explicitEpisode[1]) : undefined;
    const remainder = explicitEpisode?.[2] || target;
    const seconds = timeValue(remainder);
    if (seconds !== undefined) {
      return { type: "seek_time", ...(episodeNumber === undefined ? {} : { episodeNumber }), seconds };
    }
    if (episodeNumber !== undefined && !explicitEpisode?.[2]) {
      return { type: "seek_episode", episodeNumber };
    }
  }

  const englishEpisode = value.match(/^(?:play|open|switch\s+to)\s+episode\s+(\d+)$/iu);
  if (englishEpisode) return { type: "seek_episode", episodeNumber: Number(englishEpisode[1]) };

  const englishShot = value.match(/^(?:go\s*to|jump\s*to|seek\s*to)\s+(?:episode\s+(\d+)\s+)?shot\s+(\d+)$/iu);
  if (englishShot) {
    return {
      type: "locate_shot",
      ...(englishShot[1] ? { episodeNumber: Number(englishShot[1]) } : {}),
      shotNumber: Number(englishShot[2]),
    };
  }
  const shot = value.match(/(?:定位到|定位|跳到|跳转到|进入|打开)(?:第\s*([0-9一二两三四五六七八九十]+)\s*集)?\s*的?\s*(?:第\s*([0-9一二两三四五六七八九十]+)\s*(?:个)?\s*镜头|镜头\s*([0-9一二两三四五六七八九十]+))/u);
  if (shot) {
    const shotNumber = numberValue(shot[2] || shot[3] || "");
    if (shotNumber && shotNumber > 0) {
      const episodeNumber = shot[1] ? numberValue(shot[1]) : undefined;
      return { type: "locate_shot", ...(episodeNumber ? { episodeNumber } : {}), shotNumber };
    }
  }

  const seek = value.match(/(?:播放|跳到|跳转到|定位到|进入)(?:第\s*([0-9一二两三四五六七八九十]+)\s*集)?\s*(.*)/u);
  if (seek) {
    const seconds = timeValue(seek[2]);
    if (seconds !== undefined) {
      const episodeNumber = seek[1] ? numberValue(seek[1]) : undefined;
      return { type: "seek_time", ...(episodeNumber ? { episodeNumber } : {}), seconds };
    }
  }

  const episode = value.match(/(?:播放|跳到|跳转到|切到|打开)?\s*(?:第\s*)?([0-9一二两三四五六七八九十]+)\s*集/u);
  if (episode) {
    const episodeNumber = numberValue(episode[1]);
    if (episodeNumber && /播放|跳到|跳转到|切到|打开/.test(value)) return { type: "seek_episode", episodeNumber };
  }

  const delta = secondsValue(value);
  if (delta !== undefined && /后退|倒退|回退|倒回|往前|rewind|back/iu.test(value)) return { type: "rewind", seconds: delta };
  if (delta !== undefined && /快进|前进|向后|往后|forward|skip/iu.test(value)) return { type: "forward", seconds: delta };

  const speed = value.match(/(?:速度|倍速)\s*(\d+(?:\.\d+)?)\s*倍?/);
  if (speed) {
    const parsed = Number(speed[1]);
    if (parsed >= 0.25 && parsed <= 4) return { type: "change_speed", speed: parsed };
  }

  const subtitle = value.match(/(?:把|将)?(?:这段|当前|这一段)?字幕(?:改成|修改为|换成)(.+)$/);
  if (subtitle?.[1]?.trim()) return { type: "edit_subtitle", text: subtitle[1].trim() };
  const regenerateAudio = /重新配音|重新生成声音|重做配音/.test(value);
  if (regenerateAudio) return { type: "regenerate_audio" };
  if (/重新渲染|重新合成|重新导出|重做成片|重新生成成片/.test(value)) {
    return { type: "rerender_timeline" };
  }
  const regenerateShot = /(?:重新生成|重做)(?:这个|当前)?镜头|(?:这个|当前)镜头(?:重新生成|重做)/.test(value);
  if (regenerateShot) return { type: "regenerate_shot", instruction: value };
  if (/修改画面|改一下画面|人物.*换|背景.*换/.test(value)
    || /(人物|角色|形象|发型|头发|脸|衣服|服装|造型|背景|场景|天空|光线|灯光|颜色|色调|画风|表情|动作|道具)[^。]*?(改|换|变|深|浅|亮|暗|酷|炫|加|减|多|少|一点|一些|大|小)/u.test(value)) {
    return { type: "edit_frame", instruction: value };
  }
  if (/^(?:make|change|turn|give)\b.*\b(?:background|sky|light(?:ing)?|colou?rs?|hair|face|costume|outfit|clothes|character|scene|mood|style)\b/iu.test(value)) {
    return { type: "edit_frame", instruction: value };
  }
  if (/修改片段|这一段.*改|这段.*改/.test(value)) {
    const range = timeRangeValue(value);
    return { type: "edit_segment", instruction: value, ...(range || {}) };
  }
  return undefined;
}

export function classifyComicVoiceCommand(
  command: ComicVoiceCommand,
  _context: ComicVoiceCommandContext,
): ComicVoiceCommandResult {
  switch (command.type) {
    case "play":
    case "pause":
    case "seek_episode":
    case "seek_time":
    case "locate_shot":
    case "rewind":
    case "forward":
    case "change_speed":
      return { kind: "playback", command, applied: true };
    case "edit_subtitle":
    case "edit_frame":
    case "edit_segment":
    case "regenerate_shot":
    case "regenerate_audio":
    case "rerender_timeline":
      return { kind: "media_job", command, jobId: "pending-confirmation", requiresConfirmation: true };
  }
}
