/**
 * Browser-safe: what a written shot plan still lacks before pictures and clips are paid for.
 *
 * Mainstream short-drama pipelines (ViMax's script enhancer, Jellyfish's frame agents, the "action
 * milestone" practice) all check the same things before generation: every shot has a picture and an
 * action, a long shot is broken into checkable beats that cover it, every spoken line carries a
 * performance direction, and the lines fit the time they are spoken in. A plan missing these renders
 * as a flat, over-stuffed clip whatever the video model.
 */

import type { ComicAdaptation } from "./adaptation.js";

export interface ComicShotPlanIssue {
  readonly episode: number;
  /** 1-based positions: tool messages stay in English, so they point at shots rather than quote their titles. */
  readonly scene: number;
  readonly shot: number;
  readonly problem: "no_picture" | "no_action" | "no_beats" | "beats_short" | "line_without_direction" | "lines_too_long";
}

export interface ComicShotPlanReviewOptions {
  /** A silent work has no lines to direct. */
  readonly silent?: boolean;
}

/** Speech that fits a stretch of screen time: about 4.5 CJK characters or 3 words a second, with room to breathe. */
function speechSeconds(text: string): number {
  const cjk = (text.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
  const words = text.replace(/[぀-ヿ㐀-鿿가-힯]/g, " ").split(/\s+/).filter(word => /\p{L}|\p{N}/u.test(word)).length;
  return cjk / 4.5 + words / 3;
}

export function comicShotPlanIssues(adaptation: ComicAdaptation, options: ComicShotPlanReviewOptions = {}): ComicShotPlanIssue[] {
  const issues: ComicShotPlanIssue[] = [];
  for (const episode of adaptation.episodes) {
    episode.scenes.forEach((scene, sceneIndex) => {
      scene.shots.forEach((shot, index) => {
        const where = { episode: episode.number, scene: sceneIndex + 1, shot: index + 1 };
        if (!shot.visualPrompt.trim()) issues.push({ ...where, problem: "no_picture" });
        if (!shot.action.trim()) issues.push({ ...where, problem: "no_action" });
        const beats = (shot.beats || []).filter(beat => beat.action.trim());
        if (shot.durationSeconds >= 5 && beats.length < 2) issues.push({ ...where, problem: "no_beats" });
        else if (beats.length) {
          const covered = Math.max(...beats.map(beat => beat.endSeconds)) - Math.min(...beats.map(beat => beat.startSeconds));
          if (covered < shot.durationSeconds * 0.7) issues.push({ ...where, problem: "beats_short" });
        }
        const lines = shot.dialogue || [];
        if (!options.silent && lines.some(line => line.text.trim() && !line.tone?.trim())) issues.push({ ...where, problem: "line_without_direction" });
        if (lines.length && lines.reduce((sum, line) => sum + speechSeconds(line.text), 0) > shot.durationSeconds + 0.5) issues.push({ ...where, problem: "lines_too_long" });
      });
    });
  }
  return issues;
}

const PROBLEM_TEXT: Readonly<Record<ComicShotPlanIssue["problem"], string>> = {
  no_picture: "visualPrompt is empty",
  no_action: "action is empty",
  no_beats: "a shot of 5 seconds or more needs at least two timed beats — the checkable steps of its action, in order",
  beats_short: "the beats cover less than the shot; they must run from its start to its end",
  line_without_direction: "a spoken line has no tone — write how it is said: voice, facial expression and gesture (e.g. \"whispering, leaning in\")",
  lines_too_long: "the lines do not fit the shot (about 4 Chinese characters or 2.5 words a second); lengthen the shot, split it, or shorten only filler — never cut a key line",
};

/** The correction the storyboard tool returns, so the model fixes exactly these shots. */
export function comicShotPlanCorrection(issues: readonly ComicShotPlanIssue[]): string {
  const listed = issues.slice(0, 16).map(issue => `- episode ${issue.episode}, scene ${issue.scene}, shot ${issue.shot}: ${PROBLEM_TEXT[issue.problem]}`);
  return [
    `The storyboard is not ready to film: ${issues.length} problem${issues.length === 1 ? "" : "s"}.`,
    ...listed,
    ...(issues.length > listed.length ? [`- and ${issues.length - listed.length} more of the same kinds`] : []),
    "Fix these shots (keep the rest as they are) and call the tool again with the whole episode.",
  ].join("\n");
}
