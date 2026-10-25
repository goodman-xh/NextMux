import test from 'node:test';
import assert from 'node:assert/strict';
import { directorCatalogueText, DIRECTOR_CATALOGUE_LOCALES } from '../lib/browser/nextmux-comic-director-catalogue-text.js';
import { SCENE_POSES, SCENE_PROPS, SCENE_CAMERAS, SCENE_TEMPLATES, SCENE_BODY_TYPES, SCENE_JOINT_GROUPS } from '@nextmux/comic-core/director-catalogue';

test('every director catalogue, joint and axis has a name in all 12 locales', () => {
  const groups = { pose: SCENE_POSES, prop: SCENE_PROPS, camera: SCENE_CAMERAS, template: SCENE_TEMPLATES, body: SCENE_BODY_TYPES,
    joint: SCENE_JOINT_GROUPS.flatMap(g => g.joints.map(j => ({ id: j.key }))), axis: ['bend', 'turn', 'tilt', 'nod', 'raise', 'straddle'].map(id => ({ id })) };
  assert.equal(DIRECTOR_CATALOGUE_LOCALES.length, 12);
  for (const locale of DIRECTOR_CATALOGUE_LOCALES) for (const [category, items] of Object.entries(groups)) for (const { id } of items) {
    const text = directorCatalogueText(locale, category, id); assert.ok(text.trim()); assert.notEqual(text, id, `${locale}/${category}/${id}`);
    if (!['zh-CN', 'zh-TW', 'ja'].includes(locale)) assert.equal(/[\u4e00-\u9fff]/u.test(text), false, `${locale}/${category}/${id}`);
  }
  assert.equal(directorCatalogueText('unknown', 'pose', 'walk'), 'Walk');
});
