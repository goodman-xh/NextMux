/**
 * Browser-safe: the creative choices a novel adaptation follows, and how each one is put to the AI.
 *
 * Every choice is a preset id or the user's own words. "default" means: follow what the text itself
 * implies — the model decides and writes its decision into the style bible, so every shot, portrait
 * and episode still share one look.
 */

import type { ComicAdaptSettings } from "./types.js";

export type ComicSettingKey = "perspective" | "style" | "look" | "costume" | "lighting" | "pacing" | "sound";
export const COMIC_SETTING_KEYS: readonly ComicSettingKey[] = ["perspective", "style", "look", "costume", "lighting", "pacing", "sound"];

/** Preset ids per setting, in menu order; each has an English instruction for the model. */
export const COMIC_SETTING_PRESETS: { readonly [K in ComicSettingKey]: Readonly<Record<string, string>> } = {
  perspective: {
    default: "Keep the narrative point of view of the original text.",
    first: "First person: the protagonist tells the story in voice-over (\"I …\"); favour shots from their point of view and over their shoulder.",
    third: "Third person: an objective camera, no narrator; the story is carried by action and dialogue.",
    narrator: "An off-screen storyteller narrates between the dialogue, like a documentary or a storybook read aloud.",
    multi: "Multiple viewpoints: alternate between the main characters' perspectives from scene to scene.",
  },
  style: {
    default: "Derive the visual style from the text itself: its era, place, genre and tone.",
    guofeng: "Classical Chinese aesthetic: traditional architecture, silk, lacquer and ink tones, elegant composition.",
    ink: "Chinese ink-wash painting: rice-paper texture, flowing brush strokes, restrained palette with accents of colour.",
    xianxia: "Chinese fantasy (xianxia): floating mountains, clouds, flowing robes, ethereal glowing light.",
    tech: "Sleek high-tech: clean lines, glass and brushed metal, cool blue-white light, minimal interfaces.",
    future: "Futuristic world: advanced architecture, holograms, maglev transport, optimistic clean design.",
    cyberpunk: "Cyberpunk: dense neon-lit megacity at night, rain-slick streets, magenta and cyan contrast.",
    wasteland: "Post-apocalyptic wasteland: rust, dust storms, scavenged gear, ruined structures, bleached desaturated palette.",
    anime: "Japanese anime: clean line art, cel shading, expressive eyes, painted backgrounds.",
    donghua: "Modern Chinese 3D animation (donghua): polished stylised 3D, dramatic lighting, rich costumes.",
    comic: "American comic book: bold ink outlines, halftone shading, dynamic angles, saturated colour.",
    animation3d: "Stylised 3D animated feature film: soft global illumination, appealing shapes, warm colour.",
    film: "Photorealistic live-action cinema: 35 mm film look, natural skin texture, cinematic colour grading.",
    oil: "Oil painting: visible brush strokes, rich impasto texture, classical composition.",
    watercolor: "Watercolour illustration: soft washes, paper grain, gentle bleeding edges.",
  },
  look: {
    default: "Render the characters to suit the chosen style.",
    live: "Real human actors: photorealistic people, natural skin, real hair and fabric.",
    realistic: "Hyper-realistic CG digital humans: near-photographic faces with a subtle rendered polish.",
    anime: "Anime characters: stylised faces, large expressive eyes, clean line art.",
    cartoon3d: "Stylised 3D cartoon characters: rounded shapes, expressive features.",
    chibi: "Chibi characters: big heads, small bodies, cute simplified features.",
  },
  costume: {
    default: "Dress everyone for the era, place and social position the story implies.",
    hanfu: "Traditional Chinese period costume (hanfu): layered robes, sashes, hairpins, historically inspired.",
    republic: "Republic-of-China era (1912–1949): qipao, changshan, student uniforms, Western suits and hats.",
    modern: "Contemporary everyday clothing.",
    office: "Modern business attire: suits, shirts, office wear.",
    school: "School uniforms and campus casual wear.",
    scifi: "Futuristic sci-fi suits, armour and utility gear.",
    fantasy: "Fantasy costume: embroidered robes, armour, jewellery and ornaments.",
  },
  lighting: {
    default: "Light each scene to fit its mood and time of day.",
    natural: "Soft natural daylight, realistic exposure.",
    cinematic: "Cinematic lighting: motivated key light, rim light, shallow depth of field.",
    golden: "Warm golden-hour light, long soft shadows.",
    cold: "Cool overcast light, blue-grey tones, quiet melancholy.",
    night: "Night scenes lit by neon signs, street lamps and practical lights.",
    lowkey: "Low-key chiaroscuro: deep shadows, pools of light, high contrast.",
    dreamy: "Dreamy soft glow: bloom, haze, pastel highlights.",
  },
  pacing: {
    default: "Pace the story the way the text does.",
    slow: "Contemplative pacing: longer shots, lingering pauses, room for atmosphere.",
    normal: "Balanced pacing: clear beats, steady rhythm.",
    fast: "Fast short-drama pacing: a hook in the first three seconds, quick cuts, strong conflict, a cliffhanger at the end of every episode.",
  },
  sound: {
    default: "Characters speak their lines; ambience and sound effects match the picture; music stays low under dialogue.",
    narration: "A narrator's voice-over carries the story; characters speak only a few key lines.",
    silent: "No speech at all: tell the story through picture, music and sound effects.",
  },
};

export const DEFAULT_COMIC_ADAPT_SETTINGS: ComicAdaptSettings = Object.freeze({
  episodes: 1,
  episodeSeconds: 60,
  perspective: "default",
  style: "default",
  look: "default",
  costume: "default",
  lighting: "default",
  pacing: "default",
  sound: "default",
});

/** The preset id, or undefined when the value is the user's own words. */
export function comicSettingPreset(key: ComicSettingKey, value: string): string | undefined {
  const id = (value || "default").trim();
  return Object.prototype.hasOwnProperty.call(COMIC_SETTING_PRESETS[key], id) ? id : undefined;
}

const HEADINGS: Readonly<Record<ComicSettingKey, string>> = {
  perspective: "Point of view",
  style: "Visual style",
  look: "Character rendering",
  costume: "Costume",
  lighting: "Lighting",
  pacing: "Pacing",
  sound: "Sound",
};

/** One line per setting, for the adaptation brief. The user's own words are quoted as given. */
export function comicSettingsBrief(settings: ComicAdaptSettings): string {
  return COMIC_SETTING_KEYS.map(key => {
    const value = (settings[key] || "default").trim();
    const preset = comicSettingPreset(key, value);
    const line = preset ? COMIC_SETTING_PRESETS[key][preset] : `As the user asked: "${value.replace(/["\n\r]+/g, " ").slice(0, 500)}"`;
    return `- ${HEADINGS[key]}: ${line}`;
  }).join("\n");
}

/** Normalise untrusted settings (e.g. from the UI) without throwing. */
export function normalizeComicAdaptSettings(value: Partial<ComicAdaptSettings> | undefined): ComicAdaptSettings {
  const whole = (input: unknown, fallback: number, min: number, max: number): number =>
    typeof input === "number" && Number.isFinite(input) ? Math.min(max, Math.max(min, Math.round(input))) : fallback;
  const text = (input: unknown): string => typeof input === "string" && input.trim() ? input.trim().slice(0, 500) : "default";
  return {
    episodes: whole(value?.episodes, 1, 1, 100),
    episodeSeconds: whole(value?.episodeSeconds, 60, 10, 1_800),
    perspective: text(value?.perspective),
    style: text(value?.style),
    look: text(value?.look),
    costume: text(value?.costume),
    lighting: text(value?.lighting),
    pacing: text(value?.pacing),
    sound: text(value?.sound),
    ...(Array.isArray(value?.clipSeconds) && value!.clipSeconds.length
      ? { clipSeconds: [...new Set(value!.clipSeconds.filter(item => Number.isInteger(item) && item >= 1 && item <= 120))].sort((a, b) => a - b).slice(0, 60) }
      : {}),
  };
}

/**
 * Shot lengths for one episode: no shot longer than the longest clip the model makes, and together
 * close to the episode's target. The clip itself is requested at an allowed length that covers the
 * shot; the timeline plays the shot's own length, so the rest stays available for trimming.
 */
export function fitShotDurations(durations: readonly number[], clipSeconds: readonly number[] = [], targetSeconds?: number): number[] {
  const allowed = [...clipSeconds].filter(value => value > 0).sort((a, b) => a - b);
  const longest = allowed.length ? allowed[allowed.length - 1] : 20;
  const shortest = Math.min(2, longest);
  const clamp = (value: number): number => Math.min(longest, Math.max(shortest, Math.round(value)));
  let fitted = durations.map(value => clamp(Number.isFinite(value) && value > 0 ? value : 6));
  if (!targetSeconds || !fitted.length) return fitted;
  const total = (): number => fitted.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total() - targetSeconds) > targetSeconds * 0.1) {
    const scale = targetSeconds / total();
    fitted = fitted.map(value => clamp(value * scale));
  }
  // Settle the remainder a second at a time on the shots with the most room.
  for (let guard = 0; guard < 1_000 && Math.abs(total() - targetSeconds) >= 1; guard++) {
    const longer = total() < targetSeconds;
    const candidates = fitted.map((value, index) => ({ value, index })).filter(item => longer ? item.value < longest : item.value > shortest);
    if (!candidates.length) break;
    const pick = candidates.sort((left, right) => longer ? left.value - right.value : right.value - left.value)[0];
    fitted[pick.index] += longer ? 1 : -1;
  }
  return fitted;
}
