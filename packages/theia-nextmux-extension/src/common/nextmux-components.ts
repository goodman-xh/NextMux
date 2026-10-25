import type { DomainMessage } from './nextmux-domain-errors';

/**
 * Open-source tools NextMux downloads after installation instead of shipping them in the
 * installer (Settings → Downloads): FFmpeg for comic editing and export, an offline speech
 * recogniser (sherpa-onnx with SenseVoice or Whisper) for subtitles, and the Chromium build the
 * browser-automation MCP uses when no Chrome or Edge is installed. ComfyUI is listed for its
 * status only (it is a separate application). Coding tools stay in the installer.
 */

export type DesktopComponentId = 'ffmpeg' | 'speech-engine' | 'speech-sensevoice' | 'speech-whisper' | 'voice-engine' | 'voice-kokoro' | 'mcp-chromium' | 'comfyui';

/** In download order: the natural voice comes after the tools the comic needs to work at all. */
export const DESKTOP_COMPONENT_IDS: readonly DesktopComponentId[] = ['ffmpeg', 'speech-engine', 'speech-sensevoice', 'speech-whisper', 'voice-engine', 'voice-kokoro', 'mcp-chromium'];

/**
 * Natural voices for spoken replies, synthesised on this computer (Kokoro v1.1 through sherpa-onnx): a few
 * picked from the model's Chinese and English speakers. `speaker` is the model's speaker id.
 */
export interface DesktopVoice {
    readonly id: 'zh-female-natural' | 'zh-female-bright' | 'zh-male-steady' | 'zh-male-clear' | 'en-female';
    readonly speaker: number;
    readonly language: 'zh' | 'en';
    readonly gender: 'female' | 'male';
}

export const DESKTOP_VOICES: readonly DesktopVoice[] = [
    { id: 'zh-female-natural', speaker: 45, language: 'zh', gender: 'female' },
    { id: 'zh-female-bright', speaker: 20, language: 'zh', gender: 'female' },
    { id: 'zh-male-steady', speaker: 58, language: 'zh', gender: 'male' },
    { id: 'zh-male-clear', speaker: 80, language: 'zh', gender: 'male' },
    { id: 'en-female', speaker: 0, language: 'en', gender: 'female' },
];

/** The language a local voice speaks for a UI language (the model speaks Chinese and English). */
export function desktopVoiceLanguage(locale: string): 'zh' | 'en' | undefined {
    const base = locale.toLowerCase().split('-')[0];
    return base === 'zh' ? 'zh' : base === 'en' ? 'en' : undefined;
}

/** The voice a reply is spoken in: the chosen one when it speaks the language, else the language's female voice. */
export function desktopVoiceFor(locale: string, chosen?: string): DesktopVoice | undefined {
    const language = desktopVoiceLanguage(locale);
    if (!language) return undefined;
    return DESKTOP_VOICES.find(voice => voice.id === chosen && voice.language === language) ?? DESKTOP_VOICES.find(voice => voice.language === language);
}

export type DesktopComponentStatus = 'ready' | 'missing' | 'queued' | 'downloading' | 'installing' | 'failed' | 'unsupported' | 'external';

export interface DesktopComponentState {
    readonly id: DesktopComponentId;
    readonly status: DesktopComponentStatus;
    /** Where the working copy comes from. */
    readonly source?: 'downloaded' | 'bundled' | 'system' | 'configured';
    readonly version: string;
    /** Approximate download size in bytes (0 when not applicable). */
    readonly downloadBytes: number;
    readonly receivedBytes?: number;
    readonly installedBytes?: number;
    /** Short technical reason for `failed` / `unsupported`. */
    readonly error?: string;
    /** Structured reason; UI renders this in the selected language. */
    readonly domainError?: DomainMessage;
    readonly license: string;
    readonly homepage: string;
    /** Downloaded in the background after installation when automatic downloads are on. */
    readonly recommended: boolean;
    /** Can be removed to free disk space (only downloaded copies). */
    readonly removable: boolean;
}

export interface DesktopComponentsState {
    readonly components: readonly DesktopComponentState[];
    readonly autoDownload: boolean;
    /** The chosen natural voice (DesktopVoice id); the language's female voice when none was chosen. */
    readonly voice?: DesktopVoice['id'];
    /** Folder the downloads live in, for “show in folder”. */
    readonly directory: string;
}

/** Recogniser model for a UI language: SenseVoice for Chinese, English, Japanese and Korean; Whisper otherwise. */
export function speechModelForLocale(locale: string): 'speech-sensevoice' | 'speech-whisper' {
    const base = locale.toLowerCase().split('-')[0];
    return ['zh', 'en', 'ja', 'ko', 'yue'].includes(base) ? 'speech-sensevoice' : 'speech-whisper';
}
