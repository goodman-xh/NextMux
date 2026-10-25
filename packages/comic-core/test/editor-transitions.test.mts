import assert from "node:assert/strict";
import test from "node:test";
import { getComicDissolveOverlaps, resolveComicShotFades, resolveComicShotTransitions } from "../lib/pipeline.js";

test("authored cuts override automatic episode fades and scene dissolves", () => {
  for (const acrossScenes of [false, true]) {
    assert.deepEqual(resolveComicShotTransitions({ transition: "cut", transitionIn: "cut", transitionOut: "cut", transitionOutExplicit: true },
      { firstInEpisode: true, lastInEpisode: true, acrossScenes }), { transitionIn: "cut", transitionOut: "cut" });
  }
  assert.deepEqual(resolveComicShotTransitions({ transitionIn: "cut", transitionOut: "cut" },
    { firstInEpisode: true, lastInEpisode: true, acrossScenes: true }), { transitionIn: "cut", transitionOut: "cut" },
    "saved cuts do not require legacy explicit markers to stay cuts");
  assert.deepEqual(resolveComicShotTransitions({}, { firstInEpisode: true, lastInEpisode: true, acrossScenes: false }),
    { transitionIn: "fade", transitionOut: "fade" });
  assert.equal(resolveComicShotTransitions({ transition: "cut", transitionIn: "dissolve" },
    { firstInEpisode: false, lastInEpisode: false, acrossScenes: true }).transitionIn, "cut");
});

test("short middle shots share the incoming and outgoing dissolve budget", () => {
  const shots = [24, 10, 24, 1, 24].map((durationFrames, index) => ({ shotId: String(index), durationFrames,
    transitionIn: "dissolve" as const, transitionOut: "cut" as const }));
  assert.deepEqual([...getComicDissolveOverlaps(shots, 24)], [["1", 8], ["2", 1]]);
});

test("automatic fade ranges are frame aligned and fit very short shots", () => {
  assert.deepEqual(resolveComicShotFades({ durationFrames: 1, transitionIn: "fade", transitionOut: "fade" }, 24),
    { fadeInFrames: 1, fadeOutFrames: 0 });
  assert.deepEqual(resolveComicShotFades({ durationFrames: 24, transitionIn: "fade", transitionOut: "fade" }, 24),
    { fadeInFrames: 3, fadeOutFrames: 3 });
  assert.deepEqual(resolveComicShotFades({ durationFrames: 24, fadeInFrames: 18, fadeOutFrames: 6 }, 24),
    { fadeInFrames: 18, fadeOutFrames: 6 });
  assert.deepEqual(resolveComicShotFades({ durationFrames: 24, transitionIn: "fade", transitionOut: "fade", fadeInFrames: 0, fadeOutFrames: 0 }, 24),
    { fadeInFrames: 0, fadeOutFrames: 0 }, "explicit zero fade durations stay disabled");
  assert.deepEqual(resolveComicShotFades({ durationFrames: 24, transitionIn: "fade", transitionOut: "fade", fadeInFrames: 1, fadeOutFrames: 2 }, 24),
    { fadeInFrames: 1, fadeOutFrames: 2 }, "short authored fades are not enlarged to an automatic default");
});

test("random dissolve chains leave a frame of every shot and positive total duration", () => {
  let seed = 33;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (const rate of [24, 25, 30]) {
    for (let round = 0; round < 200; round += 1) {
      const shots = Array.from({ length: 1 + random() % 30 }, (_, index) => ({ shotId: String(index),
        durationFrames: 1 + random() % 40, transitionIn: random() % 2 ? "dissolve" as const : "cut" as const }));
      const overlaps = getComicDissolveOverlaps(shots, rate);
      shots.forEach((shot, index) => {
        const incoming = overlaps.get(shot.shotId) ?? 0;
        const outgoing = overlaps.get(shots[index + 1]?.shotId ?? "") ?? 0;
        assert.ok(incoming + outgoing < shot.durationFrames);
        assert.ok(Number.isInteger(incoming));
      });
      const total = shots.reduce((sum, shot) => sum + shot.durationFrames, 0)
        - [...overlaps.values()].reduce((sum, frames) => sum + frames, 0);
      assert.ok(total >= shots.length);
    }
  }
});
