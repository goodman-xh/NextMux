import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Body of a project-local goal file (`.nextmux/goals/<id>.md`).
 *
 * The file is `---` metadata followed by one heading in the reader's language
 * and the objective as plain Markdown, so opening it shows the goal the way the
 * user wrote it. Files written before this format used two fixed Chinese
 * headings (`# 持续目标` / `## 提示词`); those are still read.
 */
const HEADINGS: Readonly<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '目标', 'zh-TW': '目標', en: 'Goal', ja: '目標', ko: '목표', es: 'Objetivo', fr: 'Objectif',
    de: 'Ziel', 'pt-BR': 'Meta', ru: 'Цель', ar: 'الهدف', hi: 'लक्ष्य'
};
const KNOWN_HEADINGS = new Set([...Object.values(HEADINGS), '持续目标']);
const GOAL_FILE_PATH = /(?:^|[\\/])\.nextmux[\\/]goals[\\/][0-9a-f-]{36}\.md$/i;

export function isGoalFilePath(path: string | undefined): boolean {
    return typeof path === 'string' && GOAL_FILE_PATH.test(path);
}

/** Markdown after the metadata block. */
export function goalFileBody(locale: NextMuxDesktopLocale, objective: string): string {
    return `# ${HEADINGS[locale] || HEADINGS.en}\n\n${objective}\n`;
}

/** The objective from the Markdown after the metadata block (current and legacy layouts). */
export function goalFileObjective(body: string): string {
    const text = body.replace(/\r\n?/g, '\n');
    const lines = text.replace(/^\n+/, '').split('\n');
    const heading = /^#\s+(.+?)\s*#*\s*$/.exec(lines[0] || '');
    if (heading && KNOWN_HEADINGS.has(heading[1].trim())) lines.shift();
    // The legacy layout puts “## 提示词” right under the heading. A “## 提示词” section further down is part of the
    // objective the user wrote, never a place to cut it (audit A11-02).
    const first = lines.findIndex(line => line.trim());
    if (first >= 0 && lines[first].trim() === '## 提示词') return lines.slice(first + 1).join('\n').trim();
    return lines.join('\n').trim();
}
