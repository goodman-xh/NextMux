import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Round 31: fixes for the 2026-09-29 read-only audit (audits/2026-09-29). Each test states the behaviour the
// audit found broken and would fail on the old code.
const require = createRequire(import.meta.url);
const { NextMuxPlatformServiceImpl } = require('../lib/node/nextmux-platform-service.js');
const importer = require('../lib/node/nextmux-conversation-import.js');
const { scrubSecretValues } = await import('../../agent-runtime/lib/workspace-tools.js');
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('A07-01/02: an update of an imported conversation never loses NextMux work, and undo restores instead of deleting', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nmx-import-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const home = join(root, 'home');
    const project = join(home, '.claude', 'projects', 'project-a');
    await mkdir(project, { recursive: true });
    const original = importer.scanImportSource;
    importer.scanImportSource = (source, roots) => original(source, roots, { platform: 'darwin', home, env: {} });
    t.after(() => { importer.scanImportSource = original; });
    class Service extends NextMuxPlatformServiceImpl { nextmuxDataRoot() { return join(root, 'data'); } }
    const service = new Service();
    t.after(() => service.disposeConnectionResources());
    const rows = [
        { type: 'user', sessionId: 's1', timestamp: '2026-09-01T00:00:00Z', message: { content: 'first prompt' } },
        { type: 'assistant', timestamp: '2026-09-01T00:00:01Z', message: { content: [{ type: 'text', text: 'first reply' }] } }
    ];
    const publish = () => writeFile(join(project, 's1.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const history = async () => (await service.loadConversationHistory()).sessions;

    await publish();
    const first = await service.importConversations({ source: 'claude-code' });
    assert.equal(first.imported, 1);
    const id = first.sessionIds[0];

    // Updated at the source without local work: messages refresh, a title set in NextMux stays, undo goes back.
    const [imported] = await history();
    await service.patchConversationHistory({ upserts: [{ ...imported, title: 'renamed here', modelId: 'kept-model' }], removedSessionIds: [] });
    rows.push({ type: 'user', timestamp: '2026-09-02T00:00:00Z', message: { content: 'second prompt' } },
        { type: 'assistant', timestamp: '2026-09-02T00:00:01Z', message: { content: [{ type: 'text', text: 'second reply' }] } });
    await publish();
    const refreshed = await service.importConversations({ source: 'claude-code' });
    assert.equal(refreshed.updated, 1);
    let [after] = await history();
    assert.equal(after.turns.length, 2);
    assert.equal(after.title, 'renamed here');
    assert.equal(after.modelId, 'kept-model');
    const undone = await service.removeImportedConversations(refreshed.sessionIds, true);
    assert.deepEqual(undone.restored, [id], 'undoing an update restores the earlier version');
    [after] = await history();
    assert.equal(after.id, id);
    assert.equal(after.turns.length, 1, 'back to before the update, not deleted');

    // Continued in NextMux: the source's newer version arrives as its own conversation; the local one is untouched.
    const [current] = await history();
    await service.patchConversationHistory({ upserts: [{ ...current, turns: [...current.turns,
        { id: 'local-turn', prompt: 'LOCAL', response: 'local reply', stage: 'complete', createdAt: Date.now(), completedAt: Date.now(), events: [], changes: [] }] }], removedSessionIds: [] });
    rows.push({ type: 'user', timestamp: '2026-09-03T00:00:00Z', message: { content: 'third prompt' } },
        { type: 'assistant', timestamp: '2026-09-03T00:00:01Z', message: { content: [{ type: 'text', text: 'third reply' }] } });
    await publish();
    const next = await service.importConversations({ source: 'claude-code' });
    assert.equal(next.imported, 1);
    assert.equal(next.updated, 0);
    const all = await history();
    assert.equal(all.length, 2);
    const local = all.find(session => session.id === id);
    assert.ok(local.turns.some(turn => turn.id === 'local-turn'), 'the local continuation survives');
    // Undo of this batch removes only what it added.
    await service.removeImportedConversations(next.sessionIds, true);
    assert.deepEqual((await history()).map(session => session.id), [id]);
});

test('A13-01: two exports finishing into one folder under one name keep both films', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nmx-export-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const service = new NextMuxPlatformServiceImpl();
    const films = [];
    for (const name of ['a', 'b']) {
        const dir = join(root, name);
        await mkdir(dir);
        await writeFile(join(dir, 'film.mp4'), `film ${name}`);
        films.push(join(dir, 'film.mp4'));
    }
    const out = join(root, 'Movies');
    const saved = await Promise.all(films.map(mp4 => service.saveComicExportToDirectory(out, '雨夜', { mp4 })));
    assert.deepEqual(saved.map(item => item.savedPath).sort(), [join(out, '雨夜 2.mp4'), join(out, '雨夜.mp4')]);
    const contents = await Promise.all((await readdir(out)).map(file => readFile(join(out, file), 'utf8')));
    assert.deepEqual(contents.sort(), ['film a', 'film b']);
});

test('A09-01: credentials the host puts into a command environment never reach the model or logs', () => {
    const token = 'gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    assert.equal(scrubSecretValues(`GH_TOKEN=${token}\nPATH=/bin`, [token]), 'GH_TOKEN=•••\nPATH=/bin');
    // Cut by chunk boundaries: head at the end of one chunk, tail at the start of the next, a middle part alone.
    assert.equal(scrubSecretValues(`GH_TOKEN=${token.slice(0, 20)}`, [token]), 'GH_TOKEN=•••');
    assert.equal(scrubSecretValues(`${token.slice(20)}\nnext`, [token]), '•••\nnext');
    assert.equal(scrubSecretValues(token.slice(8, 30), [token]), '•••');
    assert.equal(scrubSecretValues('ordinary output', [token]), 'ordinary output');
});

test('source guards for the round 31 fixes', async () => {
    const service = await read('../src/node/nextmux-platform-service.ts');
    const widget = await read('../src/browser/nextmux-desktop-widget.tsx');
    const library = await read('../src/browser/nextmux-comic-character-library.tsx');
    // A12-001: the library list carries the whole appearance, and a rename does not send it.
    assert.match(service, /appearance: bundle\.character\.appearance\.slice\(0, 8_000\)/);
    assert.match(library, /edit\.appearance\.trim\(\) !== \(entry\.appearance \|\| ''\)\.trim\(\) \? \{ appearance/);
    // A14-01/02: a local copy that cannot be checked does not start; a market install asks for the current price.
    assert.match(widget, /return this\.appPluginVerifiedFree\(pluginId, plugin\.fingerprint\) \? \{\} : \{ error: 'license_unavailable' \};/);
    assert.match(widget, /const current = await this\.platformService\.appPluginLicense\(plugin\.id\);/);
    // A13-02: an unanswered paid submission is not sent again by itself.
    assert.match(service, /throw new MediaRuntimeError\('MEDIA_SUBMISSION_UNKNOWN', mediaMessage\('submission_unknown'\), false\);/);
    // A22-04/05: the media key goes only to the API's own address and is scrubbed from errors.
    assert.match(service, /if \(url\.origin === apiOrigin\) for \(const \[key, content\] of auth\.query\)/);
    assert.match(service, /throw scrubCredentialValues\(error, secrets\)/);
    // A22-06: after a permission wait the action runs within the main process's own limit.
    assert.match(widget, /request = \{ \.\.\.request, expiresAt: Math\.min\(request\.expiresAt, Date\.now\(\) \+ 170_000\) \};/);
    // Catalog: one unreadable offering never empties the list.
    assert.match(service, /function normalizeCatalogOfferings\(/);
});
