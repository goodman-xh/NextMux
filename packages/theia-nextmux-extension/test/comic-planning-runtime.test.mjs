import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createComicProject, normalizeComicAdaptSettings } from '@nextmux/comic-core';

// Exercise the RPC implementations with an in-memory revisioned store and a mocked model runner.
const source = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set(['planComicText', 'getComicTextModelLimits', 'saveComicScriptsPlan', 'saveComicStoryboardPlan']);
const methods = [];
(function visit(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); })(ast);
assert.equal(methods.length, names.size);
const core = new URL('../../comic-core/lib/index.js', import.meta.url).href;
const code = ts.transpileModule(`import { ComicCoreError, parseComicScripts, parseComicAdaptation, applyComicScripts, applyComicAdaptation } from ${JSON.stringify(core)};
class PlatformRequestError extends Error { constructor(code,message) { super(message); this.code=code; } }
export class Harness { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { Harness } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const route = { kind: 'official_connection', connectionId: 'text', model: 'small' };
function fixture() {
  const h = new Harness();
  let project = { ...createComicProject({ title: 'Story', locale: 'en' }), adaptSettings: normalizeComicAdaptSettings({ episodes: 1, episodeSeconds: 8 }) };
  const commits = [];
  Object.assign(h, { validateWorkspaceRootInput() {}, async comicProjectStore() { return {
    read: async () => ({ project }), commitPrepared: async (revision, next) => { assert.equal(revision, project.revision); commits.push(next); project = next; return { project }; }
  }; }, async syncComicProductionDocument() {}, async withComicProduction(_root,state) { return state; }, async retryOnComicRevision(run) { return run(); } });
  return { h, commits, current: () => project };
}
const scripts = { title: 'Generated', styleBible: 'ink', characters: [{ name: 'Ari', aliases: ['Old Ari'], appearance: 'grey hair' }], episodes: [{ number: 1, title: 'Arrival', script: 'River · day\nAri: Home.', sourceRange: { start: 0, end: 180000 }, outline: 'Arrival', ending: 'At the river' }] };

test('pure planner RPC forwards model route, attachments and output cap through the metered JSON-only runner', async () => {
  const h = new Harness(); let submitted;
  h.runAgent = async request => { submitted = request; return { status: 'completed', finalText: '{"motion":"One blink."}' }; };
  const attachments = [{ id: 'picture', kind: 'image' }];
  assert.equal(await h.planComicText({ route, workspaceRoot: '/comic', prompt: 'Describe motion', attachments, maximumOutputTokens: 1024 }), '{"motion":"One blink."}');
  assert.equal(submitted.toolScope, 'comic-json'); assert.equal(submitted.permissionMode, 'read_only');
  assert.equal(submitted.route, route); assert.equal(submitted.attachments, attachments); assert.equal(submitted.comicMaximumOutputTokens, 1024);
  h.runAgent = async () => ({ status: 'failed', finalText: 'provider stopped' });
  await assert.rejects(h.planComicText({ route, workspaceRoot: '/comic', prompt: 'Plan' }), /provider stopped/);
});

test('model capacity is obtained from the resolved connection and trusted backend metadata', async () => {
  const h = new Harness(); const connection = { id: 'text', model: 'small' }; let ensured = false;
  h.ensureContextMetadata = async () => { ensured = true; };
  h.readOfficialConnectionIndex = async () => [connection];
  h.contextLimitsForRequest = (request, actual) => { assert.ok(ensured); assert.equal(actual, connection); assert.equal(request.route, route); return { contextWindowTokens: 4096 }; };
  assert.deepEqual(await h.getComicTextModelLimits(route), { contextWindowTokens: 4096 });
});

test('all scripts commit atomically with source provenance; count and revision errors leave the project untouched', async () => {
  const { h, commits, current } = fixture();
  await assert.rejects(h.saveComicScriptsPlan({ workspaceRoot: '/comic', expectedRevision: 999, scripts, mode: 'replace' }), /project changed/);
  await assert.rejects(h.saveComicScriptsPlan({ workspaceRoot: '/comic', expectedRevision: current().revision, scripts: { ...scripts, episodes: [...scripts.episodes, { ...scripts.episodes[0], number: 2 }] }, mode: 'replace' }), /episode count/);
  assert.equal(commits.length, 0);
  const saved = await h.saveComicScriptsPlan({ workspaceRoot: '/comic', expectedRevision: current().revision, scripts, mode: 'replace' });
  assert.equal(commits.length, 1); assert.equal(saved.project.episodes[0].sourceRange.end, 180000); assert.deepEqual(saved.project.characters[0].aliases, ['Old Ari']);
});

test('shot planning rejects a stale screenplay and preserves the series bible/cast', async () => {
  const { h, commits, current } = fixture();
  await h.saveComicScriptsPlan({ workspaceRoot: '/comic', expectedRevision: current().revision, scripts, mode: 'replace' });
  const adaptation = { title: 'Ignore', styleBible: 'wrong', characters: [{ name: 'Extra', appearance: 'new' }], episodes: [{ number: 1, scenes: [{ title: 'River', shots: [{ title: 'Arrival', visualPrompt: 'Ari arrives', durationSeconds: 8, cameraAngle: 'low', cameraMotion: 'orbit', dialogue: [{ speaker: 'Old Ari', text: 'Home.', tone: 'warm' }] }] }] }] };
  await assert.rejects(h.saveComicStoryboardPlan({ workspaceRoot: '/comic', episodeNumber: 1, expectedScript: 'old version', adaptation }), /script changed/);
  assert.equal(commits.length, 1);
  const saved = await h.saveComicStoryboardPlan({ workspaceRoot: '/comic', episodeNumber: 1, expectedScript: scripts.episodes[0].script, adaptation });
  assert.equal(saved.project.styleBible, 'ink'); assert.equal(saved.project.characters.length, 1);
  assert.equal(saved.project.scenes[0].shots[0].dialogueCues[0].tone, 'warm');
  assert.equal(commits.length, 2);
});
