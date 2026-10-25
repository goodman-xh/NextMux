import type { OfficialProviderProtocol, OfficialProviderSettings } from './presets.js';

export function isOfficialMediaProtocol(protocol: string): boolean {
  return ['elevenlabs_music', 'elevenlabs_sound_effect', 'minimax_music', 'async_media_template'].includes(protocol);
}

/** Music models served over chat completions with audio output. */
const CHAT_MUSIC_MODEL = /(?:^|[/_-])lyria(?:$|[._-])/i;

/** Browser-safe, explicit capability mapping for first-party media presets. */
export function officialMediaCapabilities(
  protocol: OfficialProviderProtocol,
  modelId: string,
  settings?: OfficialProviderSettings,
): readonly ('music_generation' | 'vocal_reference' | 'cover' | 'sound_effect_generation' | 'text_to_video' | 'image_to_video' | 'reference_to_video' | 'native_audio' | 'first_last_frame' | 'image_generation')[] {
  // 自定义生成接口: what its template sends decides what it can do.
  if (protocol === 'async_media_template') {
    const template = settings?.mediaTemplate;
    if (!template || !modelId.trim()) return [];
    if (template.kind === 'image') return ['image_generation'];
    const body = template.submit.body;
    if (template.kind === 'music') return ['music_generation',
      ...(template.vocalReference && /\{\{vocal_reference\}\}/.test(body) ? ['vocal_reference' as const] : []),
      ...(template.referenceSong && /\{\{reference_song\}\}/.test(body) ? ['cover' as const] : [])];
    return ['text_to_video',
      ...(template.images !== 'none' && /\{\{(first_frame|image|images|images_csv)\}\}/.test(body) ? ['image_to_video' as const] : []),
      ...(template.images !== 'none' && template.maxReferences > 0 && /\{\{(references|reference|images|references_csv|images_csv)\}\}/.test(body) ? ['reference_to_video' as const] : []),
      ...(template.images !== 'none' && /\{\{first_frame\}\}/.test(body) && /\{\{last_frame\}\}/.test(body) ? ['first_last_frame' as const] : []),
      // The format turns sound on ("generate_audio": "true", "sound": "on" …): the model speaks the lines itself.
      ...(/"(?:generate_audio|with_audio|enable_audio|audio|sound)"\s*:\s*"?(?:true|on|1|yes)"?/i.test(body) ? ['native_audio' as const] : [])];
  }
  if (protocol === 'elevenlabs_music' && ['music_v1', 'music_v2', 'music_v2_5'].includes(modelId)) return ['music_generation'];
  if (protocol === 'elevenlabs_sound_effect' && modelId === 'eleven_text_to_sound_v2') return ['sound_effect_generation'];
  if (protocol === 'minimax_music' && ['music-3.0', 'music-2.6'].includes(modelId)) return ['music_generation'];
  // Chat completions that answer with audio (OpenRouter's Lyria, relays passing it through).
  if (protocol === 'openai_chat_completions' && CHAT_MUSIC_MODEL.test(modelId)) return ['music_generation'];
  return [];
}
