import assert from 'node:assert/strict';
import test from 'node:test';

import { applyComicCommand, createComicProject, serializeComicProject } from '../lib/index.js';

// Audit 36-14: shot edits must never leave fades longer than the shot.
function withFades() {
  const project = createComicProject();
  const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
  return { sceneId, shotId, project: applyComicCommand(project, { type: 'shot.update', expectedRevision: project.revision, sceneId, shotId, patch: { durationFrames: 100, fadeInFrames: 40, fadeOutFrames: 40 } }) };
}

test('a split keeps the fade-in on the left part and the fade-out on the right part', () => {
  const { project, sceneId, shotId } = withFades();
  const split = applyComicCommand(project, { type: 'shot.split', expectedRevision: project.revision, sceneId, shotId, splitAtFrame: 30 });
  const [left, right] = split.scenes[0].shots;
  assert.deepEqual([left.durationFrames, left.fadeInFrames, left.fadeOutFrames], [30, 30, 0]);
  assert.deepEqual([right.durationFrames, right.fadeInFrames, right.fadeOutFrames], [70, 0, 40]);
  assert.doesNotThrow(() => serializeComicProject(split));
});

test('shortening a shot shrinks the fades it keeps; explicit fades that do not fit are refused', () => {
  const { project, sceneId, shotId } = withFades();
  const shorter = applyComicCommand(project, { type: 'shot.update', expectedRevision: project.revision, sceneId, shotId, patch: { durationFrames: 50 } });
  const shot = shorter.scenes[0].shots[0];
  assert.ok(shot.fadeInFrames + shot.fadeOutFrames <= 50);
  assert.deepEqual([shot.fadeInFrames, shot.fadeOutFrames], [40, 10]);
  assert.doesNotThrow(() => serializeComicProject(shorter));
  assert.throws(() => applyComicCommand(project, { type: 'shot.update', expectedRevision: project.revision, sceneId, shotId, patch: { durationFrames: 50, fadeInFrames: 40, fadeOutFrames: 40 } }), /fade/);
});
