import { applyComicCommand } from "./core.js";
import type { ComicAdaptSettings, ComicCameraMotion, ComicCommand, ComicDialogueCueDraft, ComicEpisodeScript, ComicIdFactory, ComicProject, ComicShotSize, ComicCameraAngle, ComicLens, ComicShotBeat, ComicTransition } from "./types.js";
import { fitShotDurations } from "./adaptation-settings.js";
import { CAMERA_MOTIONS, ComicCoreError, MAX_EPISODE_SCRIPTS, MAX_EPISODE_SCRIPT_CHARACTERS, SHOT_SIZES, boundedText, record, shotGrammar, episodeScripts } from "./validation.js";

/**
 * Novel → video storyboard adaptation.
 *
 * The AI returns one structured adaptation (characters, episodes, scenes and
 * shots written for video generation); this module validates it and turns it
 * into ordinary comic commands, so the result is an ordinary, editable,
 * versioned storyboard. Nothing here calls a model.
 */

export const COMIC_ADAPTATION_LIMITS = Object.freeze({
  characters: 40,
  episodes: 24,
  scenesPerEpisode: 40,
  shotsPerScene: 40,
  totalShots: 600,
  dialoguePerShot: 8,
});

export interface ComicAdaptationCharacter {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly role?: string;
  /** Face, age, build, hair: the stable identity every shot repeats. */
  readonly appearance: string;
  /** Default outfit and signature props. */
  readonly costume?: string;
  /** Timbre, age, pace, accent for voice-over. */
  readonly voice?: string;
  readonly personality?: string;
}

export interface ComicAdaptationDialogue {
  readonly speaker: string;
  readonly text: string;
  readonly tone?: string;
}

export interface ComicAdaptationShot {
  readonly title: string;
  readonly durationSeconds: number;
  readonly shotSize?: ComicShotSize;
  readonly cameraMotion?: ComicCameraMotion;
  readonly cameraAngle?: ComicCameraAngle;
  readonly lens?: ComicLens;
  readonly transition?: ComicTransition;
  readonly beats?: readonly ComicShotBeat[];
  readonly searchTerms?: readonly string[];
  readonly continuousTakeId?: string;
  /** Names of the characters on screen. */
  readonly characters?: readonly string[];
  /** What happens, in the novel's language, for the storyboard reader. */
  readonly action: string;
  /** Self-contained prompt for the video model (subject, setting, light, lens, motion, mood). */
  readonly visualPrompt: string;
  readonly negativePrompt?: string;
  readonly dialogue?: readonly ComicAdaptationDialogue[];
  /** Ambience, effects and music cues. */
  readonly sound?: string;
  readonly mood?: string;
}

export interface ComicAdaptationScene {
  readonly title: string;
  readonly summary?: string;
  readonly location?: string;
  readonly timeOfDay?: string;
  readonly shots: readonly ComicAdaptationShot[];
}

export interface ComicAdaptationEpisode {
  readonly number: number;
  readonly title?: string;
  readonly scenes: readonly ComicAdaptationScene[];
}

export interface ComicAdaptation {
  readonly title?: string;
  /** Art style, palette, era, rendering: repeated in every shot for consistency. */
  readonly styleBible?: string;
  readonly characters: readonly ComicAdaptationCharacter[];
  readonly episodes: readonly ComicAdaptationEpisode[];
}

export interface ApplyComicAdaptationOptions {
  /**
   * `replace` removes the existing scenes first; `episode` replaces only the scenes of the episodes
   * given and keeps episode order; characters are merged by name either way.
   */
  readonly mode: "replace" | "append" | "episode";
  /** Fit each episode's shots to the video model's clip lengths and the episode's target length. */
  readonly fitDurations?: { readonly clipSeconds: readonly number[]; readonly episodeSeconds?: number };
  readonly now?: string;
  readonly locale?: string;
  readonly idFactory?: ComicIdFactory;
}

export interface ComicAdaptationResult {
  readonly project: ComicProject;
  readonly characters: number;
  readonly episodes: number;
  readonly scenes: number;
  readonly shots: number;
  readonly durationSeconds: number;
}

/** Model output is lenient on shape (null, numbers, over-long text are normalised) but strict on required content. */
function text(value: unknown, field: string, maximum: number, required = false): string {
  const candidate = value === null || value === undefined ? "" : typeof value === "number" ? String(value) : value;
  if (typeof candidate !== "string") throw new ComicCoreError("INVALID_PROJECT", `${field} must be text`, "comic.invalid_project.must_be_text", { field });
  const clean = candidate.replace(/\0/g, "").trim();
  return boundedText(clean.length > maximum ? clean.slice(0, maximum).trimEnd() : clean, field, maximum, { required });
}

function list(value: unknown, field: string, maximum: number): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ComicCoreError("INVALID_PROJECT", `${field} must be a list`, "comic.invalid_project.must_be_a_list", { field });
  if (value.length > maximum) throw new ComicCoreError("PROJECT_TOO_LARGE", `${field} can contain at most ${maximum} items`, "comic.project_too_large.can_contain_at_most_items", { field, maximum });
  return value;
}

function parseCharacters(root: Record<string, unknown>): ComicAdaptationCharacter[] {
  return list(root.characters, "adaptation.characters", COMIC_ADAPTATION_LIMITS.characters).map((entry, index) => {
    const item = record(entry, `adaptation.characters[${index}]`);
    return {
      name: text(item.name, `characters[${index}].name`, 120, true),
      ...(item.aliases === undefined ? {} : { aliases: list(item.aliases, `characters[${index}].aliases`, 40).map(alias => text(alias, "character.alias", 120, true)) }),
      role: text(item.role, `characters[${index}].role`, 200),
      appearance: text(item.appearance, `characters[${index}].appearance`, 4_000),
      costume: text(item.costume, `characters[${index}].costume`, 2_000),
      voice: text(item.voice, `characters[${index}].voice`, 500),
      personality: text(item.personality, `characters[${index}].personality`, 1_000),
    };
  });
}

/** Validate untrusted model output into a bounded adaptation. */
export function parseComicAdaptation(value: unknown): ComicAdaptation {
  const root = record(value, "adaptation");
  const characters = parseCharacters(root);
  let totalShots = 0;
  const episodes = list(root.episodes, "adaptation.episodes", COMIC_ADAPTATION_LIMITS.episodes).map((entry, episodeIndex) => {
    const episode = record(entry, `adaptation.episodes[${episodeIndex}]`);
    const number = Number.isInteger(episode.number) && Number(episode.number) >= 1 && Number(episode.number) <= 1000 ? Number(episode.number) : episodeIndex + 1;
    const scenes = list(episode.scenes, `episodes[${episodeIndex}].scenes`, COMIC_ADAPTATION_LIMITS.scenesPerEpisode).map((sceneEntry, sceneIndex) => {
      const scene = record(sceneEntry, `episodes[${episodeIndex}].scenes[${sceneIndex}]`);
      const shots = list(scene.shots, `scene.shots`, COMIC_ADAPTATION_LIMITS.shotsPerScene).map((shotEntry, shotIndex) => {
        const path = `episodes[${episodeIndex}].scenes[${sceneIndex}].shots[${shotIndex}]`;
        const shot = record(shotEntry, path);
        totalShots += 1;
        if (totalShots > COMIC_ADAPTATION_LIMITS.totalShots) {
          throw new ComicCoreError("PROJECT_TOO_LARGE", `An adaptation can contain at most ${COMIC_ADAPTATION_LIMITS.totalShots} shots`, "comic.project_too_large.an_adaptation_can_contain_at_most_shots", { maximum: COMIC_ADAPTATION_LIMITS.totalShots });
        }
        const duration = Number(shot.durationSeconds);
        const sourceDuration = Number.isFinite(duration) ? Math.max(1, duration) : 6;
        const durationSeconds = Math.min(20, sourceDuration);
        const grammar = shotGrammar(shot, sourceDuration);
        return {
          title: text(shot.title, `${path}.title`, 120),
          ...grammar,
          ...(grammar.beats && sourceDuration !== durationSeconds ? { beats: grammar.beats.map(beat => ({
            ...beat,
            startSeconds: Math.min(durationSeconds, Math.max(0, beat.startSeconds * durationSeconds / sourceDuration)),
            endSeconds: Math.min(durationSeconds, Math.max(0.05, beat.endSeconds * durationSeconds / sourceDuration)),
          })) } : {}),
          durationSeconds,
          shotSize: (SHOT_SIZES as readonly string[]).includes(String(shot.shotSize)) ? shot.shotSize as ComicShotSize : "medium",
          cameraMotion: (CAMERA_MOTIONS as readonly string[]).includes(String(shot.cameraMotion)) ? shot.cameraMotion as ComicCameraMotion : "static",
          characters: list(shot.characters, `${path}.characters`, 12).map((name, index) => text(name, `${path}.characters[${index}]`, 120)).filter(Boolean),
          action: text(shot.action, `${path}.action`, 4_000),
          visualPrompt: text(shot.visualPrompt, `${path}.visualPrompt`, 8_000, true),
          negativePrompt: text(shot.negativePrompt, `${path}.negativePrompt`, 2_000),
          dialogue: list(shot.dialogue, `${path}.dialogue`, COMIC_ADAPTATION_LIMITS.dialoguePerShot).map((lineEntry, lineIndex) => {
            const line = record(lineEntry, `${path}.dialogue[${lineIndex}]`);
            return { ...(line.tone === undefined ? {} : { tone: text(line.tone, `${path}.dialogue[${lineIndex}].tone`, 500) }), speaker: text(line.speaker, `${path}.dialogue[${lineIndex}].speaker`, 120), text: text(line.text, `${path}.dialogue[${lineIndex}].text`, 1_000, true) };
          }),
          sound: text(shot.sound, `${path}.sound`, 1_000),
          mood: text(shot.mood, `${path}.mood`, 300),
        };
      });
      return {
        title: text(scene.title, `episodes[${episodeIndex}].scenes[${sceneIndex}].title`, 120),
        summary: text(scene.summary, "scene.summary", 4_000),
        location: text(scene.location, "scene.location", 200),
        timeOfDay: text(scene.timeOfDay, "scene.timeOfDay", 80),
        shots,
      };
    });
    return { number, title: text(episode.title, `episodes[${episodeIndex}].title`, 120), scenes };
  });
  if (!episodes.some(episode => episode.scenes.some(scene => scene.shots.length))) {
    throw new ComicCoreError("INVALID_PROJECT", "The adaptation has no shots", "comic.invalid_project.the_adaptation_has_no_shots", {});
  }
  return {
    title: text(root.title, "adaptation.title", 120),
    styleBible: text(root.styleBible, "adaptation.styleBible", 4_000),
    characters,
    episodes,
  };
}

function characterAppearance(character: ComicAdaptationCharacter): string {
  const labels = characterSheetLabels(`${character.appearance} ${character.costume || ""} ${character.personality || ""}`);
  return [character.appearance, character.costume ? `${labels.costume}${character.costume}` : "", character.personality ? `${labels.personality}${character.personality}` : ""]
    .filter(Boolean).join("\n").slice(0, 8_000);
}

/** Apply a validated adaptation to a project in memory; the caller commits it once. */
export function applyComicAdaptation(project: ComicProject, adaptation: ComicAdaptation, options: ApplyComicAdaptationOptions): ComicAdaptationResult {
  let next = project;
  const run = (command: Omit<ComicCommand, "expectedRevision">): ComicProject => {
    next = applyComicCommand(next, { ...command, expectedRevision: next.revision } as ComicCommand, {
      ...(options.now ? { now: options.now } : {}),
      ...(options.locale ? { locale: options.locale } : {}),
      ...(options.idFactory ? { idFactory: options.idFactory } : {}),
    });
    return next;
  };
  const patch: { title?: string; styleBible?: string } = {};
  // The adaptation names an untitled project; a title the user chose is kept.
  if (adaptation.title && (project.titleDefault || ["", "未命名漫剧", "Untitled comic"].includes(project.title.trim()))) patch.title = adaptation.title;
  if (adaptation.styleBible) patch.styleBible = adaptation.styleBible;
  if (Object.keys(patch).length) run({ type: "project.update", patch } as Omit<ComicCommand, "expectedRevision">);

  const characterIds = mergeCharacters(() => next, run, adaptation.characters);

  if (options.mode === "replace") {
    for (const scene of [...next.scenes]) run({ type: "scene.delete", sceneId: scene.id } as Omit<ComicCommand, "expectedRevision">);
  }
  const replaced = new Set(options.mode === "episode" ? adaptation.episodes.map(episode => episode.number) : []);
  for (const scene of [...next.scenes]) {
    if (replaced.has(scene.episodeNumber ?? 1)) run({ type: "scene.delete", sceneId: scene.id } as Omit<ComicCommand, "expectedRevision">);
  }

  let scenes = 0, shots = 0, durationSeconds = 0;
  for (const original of adaptation.episodes) {
    let episode = original;
    if (options.fitDurations) {
      const lengths = fitShotDurations(original.scenes.flatMap(scene => scene.shots.map(shot => shot.durationSeconds)),
        options.fitDurations.clipSeconds, options.fitDurations.episodeSeconds);
      let next = 0;
      episode = { ...original, scenes: original.scenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => {
        const durationSeconds = lengths[next++];
        return { ...shot, durationSeconds, ...(shot.beats ? { beats: shot.beats.map(beat => ({
          ...beat,
          startSeconds: Math.min(durationSeconds, Math.max(0, beat.startSeconds * durationSeconds / shot.durationSeconds)),
          endSeconds: Math.min(durationSeconds, Math.max(0.05, beat.endSeconds * durationSeconds / shot.durationSeconds)),
        })) } : {}) };
      }) })) };
    }
    let epScenes = 0;
    for (const scene of episode.scenes) {
      if (!scene.shots.length) continue;
      // An episode made again goes back to its place: after the last scene of an earlier episode.
      const after = options.mode === "episode"
        ? [...next.scenes].reverse().find(item => (item.episodeNumber ?? 1) <= episode.number)?.id ?? null
        : undefined;
      run({ type: "scene.add", ...(after === undefined ? {} : { afterSceneId: after }), scene: {
        episodeNumber: episode.number,
        ...(scene.title ? { title: scene.title } : {}),
        summary: [episode.title && epScenes === 0 ? `Episode ${episode.number}: ${episode.title}` : "", scene.summary || ""].filter(Boolean).join("\n").slice(0, 4_000),
        location: scene.location || "",
        timeOfDay: scene.timeOfDay || "",
      } } as Omit<ComicCommand, "expectedRevision">);
      scenes += 1;
      epScenes += 1;
      const added = after === undefined ? next.scenes[next.scenes.length - 1]
        : next.scenes[after === null ? 0 : next.scenes.findIndex(item => item.id === after) + 1];
      // A new scene may start with a placeholder shot; the adaptation replaces it.
      const placeholders = added.shots.map(shot => shot.id);
      for (const shot of scene.shots) {
        const onScreen = (shot.characters || []).map(name => next.characters.find(item => item.id === characterIds.get(name.trim().toLowerCase())))
          .filter((item): item is NonNullable<typeof item> => Boolean(item));
        // Identity text is repeated verbatim in every prompt: that is what keeps a character recognisable across shots.
        const identity = onScreen.map(item => `${item.name}: ${item.appearance.replace(/\s+/g, " ")}`).join("; ");
        const visualPrompt = [shot.visualPrompt, identity ? `Characters — ${identity}` : "", next.styleBible ? `Style — ${next.styleBible.replace(/\s+/g, " ")}` : ""]
          .filter(Boolean).join("\n").slice(0, 20_000);
        const description = [shot.action, shot.mood ? `Mood: ${shot.mood}` : "", shot.sound ? `Sound: ${shot.sound}` : "",
          onScreen.length ? `Characters: ${onScreen.map(item => item.name).join(", ")}` : ""].filter(Boolean).join("\n").slice(0, 4_000);
        run({ type: "shot.add", sceneId: added.id, shot: {
          ...(shot.title ? { title: shot.title } : {}),
          ...shotGrammar(shot, shot.durationSeconds),
          description,
          durationFrames: Math.max(1, Math.round(shot.durationSeconds * next.frameRate)),
          shotSize: shot.shotSize || "medium",
          cameraMotion: shot.cameraMotion || "static",
          visualPrompt,
          negativePrompt: shot.negativePrompt || "",
        }, cues: timedDialogue(shot.dialogue || [], Math.max(1, Math.round(shot.durationSeconds * next.frameRate)), next.frameRate).map(({ line, startFrame, durationFrames }) => {
          const speakerCharacterId = characterIds.get(line.speaker.trim().toLowerCase());
          return { ...(line.tone ? { tone: line.tone } : {}), text: speakerCharacterId || !line.speaker ? line.text : `${line.speaker}：${line.text}`, ...(speakerCharacterId ? { speakerCharacterId } : {}), startFrame, durationFrames };
        }) } as Omit<ComicCommand, "expectedRevision">);
        shots += 1;
        durationSeconds += shot.durationSeconds;
      }
      for (const shotId of placeholders) {
        if (next.scenes.find(item => item.id === added.id)!.shots.length > 1) run({ type: "shot.delete", sceneId: added.id, shotId } as Omit<ComicCommand, "expectedRevision">);
      }
    }
  }
  return { project: next, characters: adaptation.characters.length, episodes: adaptation.episodes.length, scenes, shots, durationSeconds };
}

/**
 * A shot's lines one after another, in the order written, each about as long as it takes to say
 * (≈4.5 CJK characters or 2.6 words a second), spread over the shot and squeezed when they do not fit.
 * Without times every line started at frame 0: the order then fell to random ids, so the video model was
 * told to speak the lines in the wrong order and the subtitles showed all of them for the whole shot.
 */
export function timedDialogue<T extends { readonly text: string }>(lines: readonly T[], durationFrames: number, frameRate: number): { readonly line: T; readonly startFrame: number; readonly durationFrames: number }[] {
  if (!lines.length) return [];
  // One line: when in the shot it is said is the video model's choice, so its subtitle spans the shot.
  if (lines.length === 1) return [{ line: lines[0]!, startFrame: 0, durationFrames: Math.max(1, durationFrames) }];
  const total = Math.max(1, durationFrames) / frameRate;
  const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g;
  const spoken = lines.map(line => Math.max(0.8, (line.text.match(cjk) || []).length / 4.5
    + line.text.replace(cjk, " ").split(/\s+/).filter(word => /\w/.test(word)).length / 2.6));
  const lead = Math.min(0.5, total * 0.05), tail = Math.min(0.3, total * 0.03), gap = 0.25;
  const room = Math.max(0.1, total - lead - tail - gap * (lines.length - 1));
  const need = spoken.reduce((sum, value) => sum + value, 0);
  const scale = need > room ? room / need : 1;
  // Spare time goes evenly between the lines (and before the first), so a short exchange in a long shot is not all at the start.
  const spare = (room - need * scale) / (lines.length + 1);
  const last = Math.max(0, durationFrames - 1);
  let at = lead + spare;
  return lines.map((line, index) => {
    const startFrame = Math.min(last, Math.round(at * frameRate));
    const length = Math.max(1, Math.min(durationFrames - startFrame, Math.round(spoken[index] * scale * frameRate)));
    at += spoken[index] * scale + gap + spare;
    return { line, startFrame, durationFrames: length };
  });
}

/**
 * Shots made before lines were timed: two or more lines that all span the whole shot. Returns each such
 * shot's lines back in the order its episode script has them, timed one after another (for shot.update).
 */
export function untimedDialogueFixes(project: ComicProject): { readonly sceneId: string; readonly shotId: string; readonly cues: ComicDialogueCueDraft[] }[] {
  const fixes: { readonly sceneId: string; readonly shotId: string; readonly cues: ComicDialogueCueDraft[] }[] = [];
  for (const scene of project.scenes) {
    const script = project.episodes?.find(episode => episode.number === (scene.episodeNumber ?? 1))?.script || "";
    for (const shot of scene.shots) {
      const cues = shot.dialogueCues;
      if (cues.length < 2 || !cues.every(cue => cue.startFrame === 0 && cue.durationFrames >= shot.durationFrames - 1)) continue;
      const place = (text: string): number => {
        const probe = text.replace(/^[^：:]{1,40}[：:]/, "").trim().slice(0, 12);
        const at = probe ? script.indexOf(probe) : -1;
        return at < 0 ? Number.MAX_SAFE_INTEGER : at;
      };
      const ordered = cues.map((cue, index) => ({ cue, index }))
        .sort((left, right) => place(left.cue.text) - place(right.cue.text) || left.index - right.index).map(item => item.cue);
      fixes.push({ sceneId: scene.id, shotId: shot.id, cues: timedDialogue(ordered, shot.durationFrames, project.frameRate).map(({ line, startFrame, durationFrames }) => ({
        id: line.id, text: line.text, startFrame, durationFrames,
        ...(line.speakerCharacterId ? { speakerCharacterId: line.speakerCharacterId } : {}),
        ...(line.continuationOfCueId ? { continuationOfCueId: line.continuationOfCueId } : {}),
        ...(line.tone ? { tone: line.tone } : {}),
      })) });
    }
  }
  return fixes;
}

/** Characters merged by name into the project; returns name → character id. */
function mergeCharacters(
  current: () => ComicProject,
  run: (command: Omit<ComicCommand, "expectedRevision">) => ComicProject,
  characters: readonly ComicAdaptationCharacter[],
): Map<string, string> {
  const characterIds = new Map<string, string>();
  for (const character of current().characters) {
    for (const name of [character.name, ...(character.aliases || [])]) characterIds.set(name.trim().toLowerCase(), character.id);
  }
  for (const character of characters) {
    const key = character.name.trim().toLowerCase();
    const existing = [character.name, ...(character.aliases || [])].map(name => characterIds.get(name.trim().toLowerCase())).find(Boolean);
    const fields = {
      ...(character.aliases?.length ? { aliases: character.aliases } : {}),
      description: (character.role || "").slice(0, 4_000),
      appearance: characterAppearance(character),
      voice: (character.voice || "").slice(0, 500),
    };
    if (existing) {
      // A character reused from the library keeps its own appearance; only empty fields are filled.
      const saved = current().characters.find(item => item.id === existing)!;
      const fill = Object.fromEntries(Object.entries(fields).filter(([name, value]) => value && !(saved as unknown as Record<string, string>)[name]));
      const aliases = [...new Set([...(saved.aliases || []), ...(character.aliases || []), ...(saved.name !== character.name ? [character.name] : [])])];
      if (aliases.length) { (fill as Record<string, unknown>).aliases = aliases; for (const alias of aliases) characterIds.set(alias.trim().toLowerCase(), existing); }
      characterIds.set(key, existing);
      if (Object.keys(fill).length) run({ type: "character.update", characterId: existing, patch: fill } as Omit<ComicCommand, "expectedRevision">);
    } else {
      run({ type: "character.add", character: { name: character.name, ...fields } } as Omit<ComicCommand, "expectedRevision">);
      const all = current().characters;
      for (const name of [character.name, ...(character.aliases || [])]) characterIds.set(name.trim().toLowerCase(), all[all.length - 1].id);
    }
  }
  return characterIds;
}

/** The first half of an adaptation: the series bible and one script per episode (no shots yet). */
export interface ComicScripts {
  readonly title?: string;
  readonly styleBible?: string;
  readonly characters: readonly ComicAdaptationCharacter[];
  readonly episodes: readonly ComicEpisodeScript[];
}

/** Validate untrusted model output for comic.write_scripts. */
export function parseComicScripts(value: unknown): ComicScripts {
  const root = record(value, "scripts");
  const seen = new Set<number>();
  const episodes = list(root.episodes, "scripts.episodes", MAX_EPISODE_SCRIPTS).map((entry, index) => {
    const episode = record(entry, `scripts.episodes[${index}]`);
    let number = Number.isInteger(episode.number) && Number(episode.number) >= 1 && Number(episode.number) <= 1000 ? Number(episode.number) : index + 1;
    while (seen.has(number)) number += 1;
    seen.add(number);
    return {
      ...(episode.sourceRange === undefined && episode.outline === undefined && episode.ending === undefined ? {} : episodeScripts([{ ...episode, number, title: typeof episode.title === "string" ? episode.title : "", script: typeof episode.script === "string" ? episode.script : "" }], "scripts.episodes")[0]),
      number,
      title: text(episode.title, `scripts.episodes[${index}].title`, 120),
      script: boundedText(episode.script, `scripts.episodes[${index}].script`, MAX_EPISODE_SCRIPT_CHARACTERS, { required: true }),
    };
  });
  if (!episodes.length) throw new ComicCoreError("INVALID_PROJECT", "The adaptation has no episode scripts", "comic.invalid_project.the_adaptation_has_no_episode_scripts", {});
  return {
    title: text(root.title, "scripts.title", 120),
    styleBible: text(root.styleBible, "scripts.styleBible", 4_000),
    characters: parseCharacters(root),
    episodes: [...episodes].sort((left, right) => left.number - right.number),
  };
}

/**
 * Apply the bible and episode scripts.
 *   replace (default) — the scripts become the whole series. Shots of an episode that no longer exists are
 *                       removed (they would otherwise be filmed and fall into episode 1); the other episodes
 *                       keep their shots until each is storyboarded again.
 *   append            — a sequel: the existing episodes, their shots and clips stay exactly as they are and
 *                       the new scripts are numbered on from the last episode.
 */
export function applyComicScripts(project: ComicProject, scripts: ComicScripts, options: Pick<ApplyComicAdaptationOptions, "now" | "idFactory" | "locale"> & { readonly adaptSettings?: ComicAdaptSettings; readonly mode?: "replace" | "append" } = {}): ComicProject {
  let next = project;
  const run = (command: Omit<ComicCommand, "expectedRevision">): ComicProject => {
    next = applyComicCommand(next, { ...command, expectedRevision: next.revision } as ComicCommand, {
      ...(options.now ? { now: options.now } : {}),
      ...(options.locale ? { locale: options.locale } : {}),
      ...(options.idFactory ? { idFactory: options.idFactory } : {}),
    });
    return next;
  };
  const append = options.mode === "append";
  const existing = project.episodes || [];
  const after = existing.reduce((last, episode) => Math.max(last, episode.number), 0);
  const episodes = append
    ? [...existing, ...scripts.episodes.map((episode, index) => ({ ...episode, number: after + index + 1 }))]
    : scripts.episodes;
  if (episodes.length > MAX_EPISODE_SCRIPTS) throw new ComicCoreError("PROJECT_TOO_LARGE", `A comic can have at most ${MAX_EPISODE_SCRIPTS} episodes`, "comic.project_too_large.a_comic_can_have_at_most_episodes", { maximum: MAX_EPISODE_SCRIPTS });
  const patch: { title?: string; styleBible?: string; episodes: readonly ComicEpisodeScript[]; adaptSettings?: ComicAdaptSettings } = { episodes };
  if (scripts.title && (project.titleDefault || ["", "未命名漫剧", "Untitled comic"].includes(project.title.trim()))) patch.title = scripts.title;
  // A sequel keeps the look the filmed episodes were made with.
  if (scripts.styleBible && !(append && project.styleBible.trim())) patch.styleBible = scripts.styleBible;
  if (options.adaptSettings) patch.adaptSettings = options.adaptSettings;
  run({ type: "project.update", patch } as Omit<ComicCommand, "expectedRevision">);
  if (!append) {
    const numbers = new Set(episodes.map(episode => episode.number));
    for (const scene of next.scenes.filter(item => item.episodeNumber !== undefined && !numbers.has(item.episodeNumber))) {
      run({ type: "scene.delete", sceneId: scene.id } as Omit<ComicCommand, "expectedRevision">);
    }
  }
  mergeCharacters(() => next, run, scripts.characters);
  return next;
}

export { comicAdaptationInstructions } from "./adaptation-brief.js";
import { characterSheetLabels } from "./adaptation-brief.js";
export type { ComicAdaptationInstructionOptions } from "./adaptation-brief.js";
