import assert from 'node:assert/strict';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const read = content => NextMuxPlatformServiceImpl.prototype.communitySkillMetadata.call({}, content, 'skills/academy-guide/SKILL.md');

test('community skill listings read YAML block scalars instead of showing the indicator', () => {
    assert.deepEqual(read('---\nname: academy-guide\ndescription: >\n  Guides learners\n  through the academy.\n---\nbody'),
        { name: 'academy-guide', description: 'Guides learners through the academy.' });
    assert.equal(read('---\r\nname: x\r\ndescription: |-\r\n  line one\r\n  line two\r\n---\r\nbody').description, 'line one line two');
    assert.equal(read('---\nname: y\ndescription: "quoted: text"\n---\n').description, 'quoted: text');
});

test('malformed YAML still yields the folded text, and missing fields fall back to the folder name', () => {
    assert.equal(read('---\nname: z\ndescription: >\n  broken: [yaml\n  more\nother: [\n---\n').description, 'broken: [yaml more');
    const fallback = read('no frontmatter');
    assert.equal(fallback.name, 'academy-guide');
    assert.equal(fallback.description, 'academy-guide Skill from the community catalog.');
    assert.equal(fallback.descriptionMessage.code, 'SKILL_DEFAULT_DESCRIPTION');
    assert.deepEqual(fallback.descriptionMessage.params, { name: 'academy-guide' });
});
