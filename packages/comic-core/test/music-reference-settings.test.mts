import assert from 'node:assert/strict';
import test from 'node:test';
import { applyComicCommand, createComicProject, musicSettings, parseComicProject, serializeComicProject } from '../lib/index.js';

test('voice and cover selections and sample-specific consent survive a project reopen', () => {
  const settings = musicSettings({ lyrics: '[Verse]\nA song', mode: 'generate', vocalSource: 'my_voice',
    vocalReferenceAssetId: 'asset-00000001', vocalReferenceConsent: true, referenceSongAssetId: 'asset-00000002' }, 'music');
  const project = createComicProject({ title: 'Voice', projectKind: 'music', starter: 'empty' });
  const updated = applyComicCommand(project, { type: 'project.update', expectedRevision: project.revision, patch: { music: settings } });
  const reopened = parseComicProject(serializeComicProject(updated)).project;
  assert.deepEqual(reopened.music, settings);
  const cover = applyComicCommand(reopened, { type: 'project.update', expectedRevision: reopened.revision,
    patch: { music: { ...settings, mode: 'cover', vocalSource: 'default' } } });
  assert.equal(parseComicProject(serializeComicProject(cover)).project.music?.mode, 'cover');
  assert.equal(musicSettings({ lyrics: '' }, 'music').vocalReferenceConsent, undefined);
});

test('project settings reject invalid modes, asset references and non-boolean consent', () => {
  for (const patch of [{ mode: 'clone' }, { vocalSource: 'singer' }, { vocalReferenceConsent: 'true' },
    { vocalReferenceAssetId: '../sample.wav' }, { referenceSongAssetId: '/tmp/song.mp3' }]) {
    assert.throws(() => musicSettings({ lyrics: '', ...patch }, 'music'));
  }
});
