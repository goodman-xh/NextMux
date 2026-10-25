import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { parseNextMuxSkill, serializeNextMuxSkill, SKILL_LIMITS } from '../lib/common/nextmux-skill-format.js';
import { registerAppTools } from '../lib/node/nextmux-app-tools.js';
import { readVerifiedAgentSkill } from '../lib/node/nextmux-skill-snapshot.js';
import { SkillLoadErrors } from '../lib/browser/nextmux-installed-skills.js';

const require = createRequire(import.meta.url);
const { parseSkillFile } = require('@theia/ai-core/lib/common/skill');
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
const digest = body => createHash('sha256').update(body).digest('hex');
const fields = { name: 'audit-skill', description: 'Normal description', instructions: 'Read the code.' };
async function toolsFixture(t, register = registerAppTools) {
    const skillsRoot = await fs.mkdtemp(join(tmpdir(), 'nextmux-skill-format-'));
    t.after(() => fs.rm(skillsRoot, { force: true, recursive: true }));
    const tools = new Map();
    register({ register: (descriptor, handler) => tools.set(descriptor.name, { descriptor, handler }) }, { skillsRoot, otherSkillRoots: [] });
    return { skillsRoot, tools, create: tools.get('nextmux.skills.create').handler };
}

for (const description of ['Review: inspect code', 'true', 'false', 'null', '123', '"quoted" # literal', "Don't lose: punctuation", 'Line one\nLine two']) {
    test(`creator round-trips YAML string through the actual parser, list and host: ${JSON.stringify(description)}`, async t => {
        const f = await toolsFixture(t);
        const result = await f.create({ ...fields, description }, {});
        assert.equal(result.modelOutput.created, true);
        const body = await fs.readFile(result.modelOutput.location, 'utf8');
        assert.equal(parseSkillFile(body).metadata.description, description);
        const host = await readVerifiedAgentSkill({ name: fields.name, sourcePath: result.modelOutput.location, sourceSha256: digest(body) }, [f.skillsRoot]);
        assert.equal(host.description, description);
        assert.equal(host.instructions, fields.instructions);
        const listed = await f.tools.get('nextmux.skills.list').handler({}, {});
        assert.equal(listed.modelOutput.skills[0].description, description);
    });
}

test('creation and execution share body and UTF-8 byte limits; failed creation leaves no folder', async t => {
    const f = await toolsFixture(t);
    assert.equal(f.tools.get('nextmux.skills.create').descriptor.inputSchema.properties.instructions.maxLength, SKILL_LIMITS.instructions);
    for (const value of [
        { ...fields, instructions: 'x'.repeat(SKILL_LIMITS.instructions + 1) },
        { ...fields, instructions: '中'.repeat(SKILL_LIMITS.instructions + 1) },
        { ...fields, instructions: ' ' },
        { ...fields, description: ' ' },
        { ...fields, description: 'x'.repeat(1025) },
        { ...fields, instructions: '\0' }
    ]) {
        await assert.rejects(f.create(value, {}));
        assert.deepEqual(await fs.readdir(f.skillsRoot), []);
    }
    const result = await f.create({ ...fields, instructions: '中'.repeat(SKILL_LIMITS.instructions) }, {});
    const body = await fs.readFile(result.modelOutput.location, 'utf8');
    assert.equal(parseNextMuxSkill(body).instructions.length, SKILL_LIMITS.instructions);
    assert.equal((await readVerifiedAgentSkill({ name: fields.name, sourcePath: result.modelOutput.location, sourceSha256: digest(body) }, [f.skillsRoot])).instructions.length, SKILL_LIMITS.instructions);
});

test('creator checks written bytes through the real host loader and rolls back failed read-back', async t => {
    const sourceUrl = new URL('../src/node/nextmux-app-tools.ts', import.meta.url);
    const nativeRequire = createRequire(new URL('../lib/node/nextmux-app-tools.js', import.meta.url));
    const module = { exports: {} };
    let writes = 0;
    const code = ts.transpileModule(readFileSync(sourceUrl, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('require', 'module', 'exports', code)(id => id === 'node:fs/promises'
        ? { ...fs, writeFile: async (path, _body, options) => { writes++; await fs.writeFile(path, 'corrupted after serialization', options); } }
        : nativeRequire(id), module, module.exports);
    const f = await toolsFixture(t, module.exports.registerAppTools);
    await assert.rejects(f.create(fields, {}), { code: 'SKILL_SOURCE_CHANGED' });
    assert.equal(writes, 1);
    assert.deepEqual(await fs.readdir(f.skillsRoot), []);
});

test('shared parser validates tool policy and preserves safe serializer metadata', () => {
    const body = serializeNextMuxSkill(fields);
    assert.deepEqual(parseSkillFile(body).metadata, { name: fields.name, description: fields.description });
    assert.throws(() => parseNextMuxSkill(body.replace('---\nRead', 'allowedTools: ["test.*"]\n---\nRead')), { code: 'INVALID_TOOL_POLICY' });
    assert.throws(() => parseNextMuxSkill(body.replace('---\nRead', 'allowedTools: &tools [*tools]\nallowed-tools: *tools\n---\nRead')), { code: 'INVALID_TOOL_POLICY' });
});

test('Settings renders skipped Skills in every locale and exposes repair actions without hiding valid tasks', () => {
    const errors = [{ name: '<broken>', location: '/global/broken/SKILL.md', code: 'INVALID_SKILLS' }];
    let opened, retried = false;
    const props = { locale: 'zh-CN', errors, onOpen: path => { opened = path; }, onRetry: () => { retried = true; } };
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const html = renderToStaticMarkup(React.createElement(SkillLoadErrors, { ...props, locale }));
        assert.match(html, /role="alert"/);
        assert.match(html, /&lt;broken&gt;/);
        assert.match(html, /INVALID_SKILLS/);
        assert.doesNotMatch(html, /undefined/);
    }
    const walk = element => !element || typeof element !== 'object' ? [] : [element, ...React.Children.toArray(element.props?.children).flatMap(walk)];
    const buttons = walk(SkillLoadErrors(props)).filter(element => element.type === 'button');
    buttons[0].props.onClick(); buttons[1].props.onClick();
    assert.equal(opened, errors[0].location); assert.equal(retried, true);
    assert.equal(SkillLoadErrors({ ...props, errors: [] }), null);
});
