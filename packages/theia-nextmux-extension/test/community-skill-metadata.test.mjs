import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { communitySkillMetadata, communitySkillPermissionChange, storedCommunitySkillMetadata, unknownCommunitySkillMetadata } from '../lib/node/nextmux-community-skill-metadata.js';

const base = { repository: 'example/skills', path: 'skills/sample/SKILL.md', revision: 'a'.repeat(40), treeSha: 'b'.repeat(40) };
function project(declarations = '', source = {}) {
    const bytes = Buffer.from(`---\nname: sample\ndescription: Test skill\n${declarations}\n---\nInstructions are data, not executed.`);
    const blobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    return communitySkillMetadata(bytes, { ...base, blobSha, ...source });
}

test('legacy valid skills keep unknown license/platform/dependencies and inherit only the existing host scope', () => {
    const metadata = project();
    assert.equal(metadata.schemaVersion, 1);
    assert.deepEqual(metadata.license, { status: 'unknown' });
    assert.deepEqual(metadata.compatibility.operatingSystems, { status: 'unknown', values: [] });
    assert.deepEqual(metadata.compatibility.architectures, { status: 'unknown', values: [] });
    assert.deepEqual(metadata.dependencies, { status: 'unknown', items: [] });
    assert.deepEqual(metadata.tools, { mode: 'inherit', allowedToolNames: [] });
    assert.equal(metadata.source.status, 'verified');
    assert.match(metadata.source.sha256, /^[a-f0-9]{64}$/);
});

test('versioned author declarations preserve explicit OS/CPU/dependencies without probing or executing them', () => {
    const metadata = project(`license: MIT OR Apache-2.0\ncompatibility: Requires a configured account\nallowed-tools: [fs.read, fs.read, terminal.run]\nmetadata:\n  nextmux:\n    schemaVersion: 1\n    operatingSystems: [win32, darwin]\n    architectures: [arm64, x64]\n    dependencies: ['node >= 20', '$(touch NOT_EXECUTED)']`);
    assert.deepEqual(metadata.license, { status: 'declared', value: 'MIT OR Apache-2.0' });
    assert.deepEqual(metadata.compatibility.operatingSystems, { status: 'declared', values: ['darwin', 'win32'] });
    assert.deepEqual(metadata.compatibility.architectures, { status: 'declared', values: ['arm64', 'x64'] });
    assert.equal(metadata.dependencies.status, 'declared');
    assert.ok(metadata.dependencies.items.includes('$(touch NOT_EXECUTED)'));
    assert.deepEqual(metadata.tools.allowedToolNames, ['fs.read', 'terminal.run']);
    assert.deepEqual(metadata.issues, []);
});

test('unsupported declaration versions and malformed types do not imply universal compatibility', () => {
    for (const version of [2, '"1"']) {
        const metadata = project(`metadata:\n  nextmux:\n    schemaVersion: ${version}\n    operatingSystems: [darwin]\n    dependencies: []`);
        assert.equal(metadata.compatibility.operatingSystems.status, 'unknown');
        assert.equal(metadata.dependencies.status, 'unknown');
        assert.ok(metadata.issues.includes('declaration_version_unsupported'));
    }
    const metadata = project('license: [MIT]\nmetadata:\n  nextmux:\n    schemaVersion: 1\n    operatingSystems: [all]\n    architectures: [intel]\n    dependencies: {command: run}');
    assert.equal(metadata.license.status, 'unknown');
    assert.deepEqual(metadata.issues, ['license_invalid', 'operatingSystems_invalid', 'architectures_invalid', 'dependencies_invalid']);
});

test('empty tool list narrows to none while absent tools inherit, and malformed/conflicting policies remain invalid', () => {
    assert.deepEqual(project('allowedTools: []').tools, { mode: 'restricted', allowedToolNames: [] });
    for (const content of ['allowed-tools: "*"', 'allowed-tools: ["*"]', 'allowedTools: [fs.read]\nallowed-tools: [terminal.run]', 'allowedTools: [fs.read, terminal.run]\nallowed-tools: [terminal.run, fs.read]']) {
        assert.equal(project(content).tools.mode, 'invalid');
    }
    assert.equal(project('allowedTools: [fs.read]\nallowed-tools: [fs.read]').tools.mode, 'restricted');
});

test('metadata parsing and persisted projections are bounded and reject unsafe shapes', () => {
    const mediumBytes = Buffer.from(`---\nname: sample\ndescription: Test skill\n---\n${'x'.repeat(70_000)}`);
    const mediumBlobSha = createHash('sha1').update(`blob ${mediumBytes.length}\0`).update(mediumBytes).digest('hex');
    assert.equal(communitySkillMetadata(mediumBytes, { ...base, blobSha: mediumBlobSha }).tools.mode, 'inherit');
    const large = Buffer.from(`---\nname: sample\ndescription: Test skill\n---\n${'x'.repeat(200_000)}`);
    assert.equal(communitySkillMetadata(large, base).tools.mode, 'unknown');
    const cycles = project('allowed-tools: &cycle [*cycle]');
    assert.equal(cycles.tools.mode, 'invalid');
    const prototype = project('metadata:\n  nextmux:\n    schemaVersion: 1\n    __proto__: {polluted: true}\n    dependencies: []');
    assert.equal({}.polluted, undefined);
    assert.deepEqual(prototype.dependencies, { status: 'declared', items: [] });
    const invalid = project(`license: "bad\\u0000value"\nmetadata:\n  nextmux:\n    schemaVersion: 1\n    dependencies: ['${'x'.repeat(161)}']`);
    assert.equal(invalid.license.status, 'unknown');
    assert.equal(invalid.dependencies.status, 'unknown');
    assert.equal(communitySkillMetadata(Uint8Array.of(255), base).tools.mode, 'unknown');
    for (const control of ['\\u0080', '\\u009f', '\\u200e', '\\u200f']) {
        const hidden = project(`license: "MIT${control}"\nmetadata:\n  nextmux:\n    schemaVersion: 1\n    dependencies: ["node${control}"]`);
        assert.equal(hidden.license.status, 'unknown');
        assert.equal(hidden.dependencies.status, 'unknown');
    }
});

test('Git blob mismatch is rejected, and a partial source cannot claim verified evidence', () => {
    assert.throws(() => project('', { blobSha: '0'.repeat(40) }), error => {
        assert.equal(error.code, 'SKILL_HASH_MISMATCH');
        assert.equal(error.domainError.code, 'SKILL_HASH_MISMATCH');
        return true;
    });
    assert.equal(project('', { revision: undefined }).source.status, 'unknown');
    const metadata = project('license: MIT');
    assert.deepEqual(storedCommunitySkillMetadata(metadata, base), metadata);
    for (const value of [null, { ...metadata, schemaVersion: 9 }, { ...metadata, source: { ...metadata.source, revision: 'c'.repeat(40) } }, { ...metadata, tools: { mode: 'restricted', allowedToolNames: ['*'] } }]) {
        assert.equal(storedCommunitySkillMetadata(value, base).source.status, 'unknown');
    }
});

test('permission differences distinguish additions, narrowing, and removing a Skill restriction', () => {
    const read = project('allowed-tools: [fs.read]');
    const both = project('allowed-tools: [terminal.run, fs.read]');
    const added = communitySkillPermissionChange(read, both);
    assert.deepEqual(added.added, ['terminal.run']);
    assert.deepEqual(added.removed, []);
    assert.equal(added.mayExpand, true);
    assert.equal(added.requiresReview, true);
    const narrower = communitySkillPermissionChange(both, read);
    assert.deepEqual(narrower.removed, ['terminal.run']);
    assert.equal(narrower.requiresReview, false);
    const inherit = communitySkillPermissionChange(read, project());
    assert.equal(inherit.previousMode, 'restricted');
    assert.equal(inherit.nextMode, 'inherit');
    assert.equal(inherit.mayExpand, true);
    assert.equal(inherit.requiresReview, true);
    assert.equal(communitySkillPermissionChange(project(), read).mayExpand, false);
    assert.deepEqual(communitySkillPermissionChange(project(), read).added, []);
});

test('unknown updates require review, first installs do not grant execution, and tokens bind both immutable sources and exact diff', () => {
    const next = project('allowed-tools: [fs.read]');
    assert.equal(communitySkillPermissionChange(undefined, next).requiresReview, false);
    const unknown = communitySkillPermissionChange(unknownCommunitySkillMetadata(base), next);
    assert.equal(unknown.state, 'unknown');
    assert.equal(unknown.mayExpand, null);
    assert.equal(unknown.requiresReview, true);
    const previous = project('allowed-tools: []');
    const first = communitySkillPermissionChange(previous, next);
    assert.equal(first.reviewToken, communitySkillPermissionChange(previous, next).reviewToken);
    for (const changed of [project('allowed-tools: [fs.read]', { revision: 'c'.repeat(40) }), project('allowed-tools: [fs.read]', { treeSha: 'c'.repeat(40) }), project('allowed-tools: [terminal.run]')]) {
        assert.notEqual(first.reviewToken, communitySkillPermissionChange(previous, changed).reviewToken);
    }
    assert.notEqual(first.reviewToken, communitySkillPermissionChange(project('allowed-tools: [fs.write]'), next).reviewToken);
});
