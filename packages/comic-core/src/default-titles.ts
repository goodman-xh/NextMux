import type { ComicDefaultTitle, ComicProject } from "./types.js";

type TitleWords = readonly [string, string, string, string, string, string];
/** Browser-safe defaults. Tokens are stored separately from authored titles. */
const TITLES: Readonly<Record<string, TitleWords>> = {
  "zh-CN": ["未命名漫剧", "第 {n} 集", "场景 {n}", "镜头 {n}", "{title}（副本）", "{title}（后半段）"],
  "zh-TW": ["未命名漫劇", "第 {n} 集", "場景 {n}", "鏡頭 {n}", "{title}（副本）", "{title}（後半段）"],
  en: ["Untitled comic", "Episode {n}", "Scene {n}", "Shot {n}", "{title} (copy)", "{title} (second part)"],
  ja: ["無題のコミック", "第 {n} 話", "シーン {n}", "ショット {n}", "{title}（コピー）", "{title}（後半）"],
  ko: ["제목 없는 만화", "에피소드 {n}", "장면 {n}", "샷 {n}", "{title} (사본)", "{title} (후반부)"],
  es: ["Cómic sin título", "Episodio {n}", "Escena {n}", "Plano {n}", "{title} (copia)", "{title} (segunda parte)"],
  fr: ["Bande dessinée sans titre", "Épisode {n}", "Scène {n}", "Plan {n}", "{title} (copie)", "{title} (seconde partie)"],
  de: ["Unbenannter Comic", "Folge {n}", "Szene {n}", "Einstellung {n}", "{title} (Kopie)", "{title} (zweiter Teil)"],
  "pt-BR": ["Quadrinho sem título", "Episódio {n}", "Cena {n}", "Plano {n}", "{title} (cópia)", "{title} (segunda parte)"],
  ru: ["Комикс без названия", "Эпизод {n}", "Сцена {n}", "Кадр {n}", "{title} (копия)", "{title} (вторая часть)"],
  ar: ["قصة مصورة بلا عنوان", "الحلقة {n}", "المشهد {n}", "اللقطة {n}", "{title} (نسخة)", "{title} (الجزء الثاني)"],
  hi: ["बिना शीर्षक की कॉमिक", "एपिसोड {n}", "दृश्य {n}", "शॉट {n}", "{title} (प्रतिलिपि)", "{title} (दूसरा भाग)"],
};

export function comicDefaultLocale(locale = "zh-CN"): string {
  const canonical = locale.replace(/_/g, "-");
  if (/^zh-(?:tw|hk|hant)/i.test(canonical)) return "zh-TW";
  if (/^zh(?:-|$)/i.test(canonical)) return "zh-CN";
  if (/^pt(?:-|$)/i.test(canonical)) return "pt-BR";
  const language = canonical.split("-")[0]!.toLowerCase();
  return TITLES[language] ? language : "en";
}

export function comicDefaultTitle(provenance: ComicDefaultTitle, locale = provenance.locale): string {
  const words = TITLES[comicDefaultLocale(locale)]!;
  const index = ["project", "episode", "scene", "shot", "copy", "split"].indexOf(provenance.kind);
  const base = provenance.baseDefault ? comicDefaultTitle(provenance.baseDefault, locale) : provenance.baseTitle || "";
  const pattern = words[index] || words[0];
  // Reserve room for the complete translated suffix and never split a surrogate pair.
  const room = 120 - pattern.replace("{title}", "").replace("{n}", String(provenance.index || 1)).length;
  const title = base.slice(0, Math.max(0, room)).replace(/[\uD800-\uDBFF]$/u, "");
  return pattern.replace("{n}", String(provenance.index || 1)).replace("{title}", title);
}

export function comicTitleWithDefault(kind: ComicDefaultTitle["kind"], locale = "zh-CN", index?: number): {
  readonly title: string; readonly titleDefault: ComicDefaultTitle;
} {
  const titleDefault: ComicDefaultTitle = { kind, locale: comicDefaultLocale(locale), ...(index === undefined ? {} : { index }) };
  return { title: comicDefaultTitle(titleDefault), titleDefault };
}

/** A read-only display projection; authored text and project revisions are preserved. */
export function localizeComicProjectDefaults(project: ComicProject, locale: string): ComicProject {
  const localize = <T extends { readonly title: string; readonly titleDefault?: ComicDefaultTitle }>(item: T): T => {
    // Also guard older clients which renamed a default title without clearing its provenance.
    if (!item.titleDefault || item.title !== comicDefaultTitle(item.titleDefault)) return item;
    const titleDefault = { ...item.titleDefault, locale: comicDefaultLocale(locale) };
    return { ...item, title: comicDefaultTitle(titleDefault), titleDefault };
  };
  return { ...localize(project), defaultTitleLocale: comicDefaultLocale(locale),
    ...(project.episodes ? { episodes: project.episodes.map(localize) } : {}),
    scenes: project.scenes.map(scene => ({ ...localize(scene), shots: scene.shots.map(localize) })),
  };
}
