import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const importer = require('../lib/node/nextmux-conversation-import.js');

const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';

async function fixture(t) {
    const home = await mkdtemp(join(tmpdir(), 'nm-import-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    return { home, environment: { platform: 'darwin', home, env: {} } };
}

test('each tool is looked for in its standard place on macOS and Windows, honouring overrides', () => {
    const mac = { platform: 'darwin', home: '/Users/ada', env: { CLAUDE_CONFIG_DIR: '/Volumes/D/claude', CODEX_HOME: '/Volumes/D/codex' } };
    assert.deepEqual(importer.defaultImportRoots('claude-code', mac), ['/Volumes/D/claude/projects', '/Users/ada/.claude/projects']);
    assert.deepEqual(importer.defaultImportRoots('codex', mac), ['/Volumes/D/codex', '/Users/ada/.codex']);
    assert.deepEqual(importer.defaultImportRoots('cursor', mac), ['/Users/ada/Library/Application Support/Cursor/User']);
    assert.deepEqual(importer.defaultImportRoots('claude-cowork', mac), ['/Users/ada/Library/Application Support/Claude/local-agent-mode-sessions']);
    const windows = { platform: 'win32', home: 'C:\\Users\\ada', env: { USERPROFILE: 'D:\\Users\\ada', APPDATA: 'D:\\Users\\ada\\AppData\\Roaming' } };
    assert.ok(importer.defaultImportRoots('claude-code', windows)[0].startsWith('D:'));
    assert.match(importer.defaultImportRoots('cursor', windows)[0], /AppData.Roaming.Cursor.User$/);
});

test('injected context and interruption markers are not requests', () => {
    assert.equal(importer.isInjectedContext('<environment_context>\n<cwd>/x</cwd>\n</environment_context>'), true);
    assert.equal(importer.isInjectedContext('<recommended_plugins>…</recommended_plugins>'), true);
    assert.equal(importer.isInjectedContext('[Request interrupted by user for tool use]'), true);
    assert.equal(importer.isInjectedContext('Fix <b>this</b> please'), false);
    assert.equal(importer.isInjectedContext('<b>bold</b> is broken'), false);
});

test('Claude Code sessions become turns with their project, title and tool counts; sub-agents and meta lines are skipped', async t => {
    const { home, environment } = await fixture(t);
    const project = join(home, '.claude', 'projects', '-work-app');
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'sess-1.jsonl'), jsonl([
        { type: 'custom-title', customTitle: 'Fix login', sessionId: 'sess-1' },
        { type: 'user', cwd: '/work/app', timestamp: '2026-09-01T10:00:00Z', message: { role: 'user', content: 'Login redirects to a blank page' } },
        { type: 'assistant', timestamp: '2026-09-01T10:00:05Z', message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Looking at the router.' }, { type: 'tool_use', name: 'Read' }] } },
        { type: 'user', timestamp: '2026-09-01T10:00:06Z', message: { content: [{ type: 'tool_result', content: 'file' }] } },
        { type: 'assistant', isSidechain: true, timestamp: '2026-09-01T10:00:07Z', message: { content: [{ type: 'text', text: 'sub-agent chatter' }] } },
        { type: 'user', isMeta: true, message: { content: 'Caveat meta' } },
        { type: 'assistant', timestamp: '2026-09-01T10:01:00Z', message: { content: [{ type: 'text', text: 'Fixed the redirect.' }] } },
        { type: 'user', timestamp: '2026-09-01T10:02:00Z', message: { content: '<command-name>/compact</command-name><command-args></command-args>' } },
        { type: 'user', timestamp: '2026-09-01T10:02:01Z', message: { content: '<local-command-stdout>done</local-command-stdout>' } }
    ]));
    const { conversations, roots } = await importer.scanImportSource('claude-code', [], environment);
    assert.equal(roots[0].found, true);
    assert.equal(conversations.length, 1);
    assert.deepEqual({ title: conversations[0].title, workspacePath: conversations[0].workspacePath }, { title: 'Fix login', workspacePath: '/work/app' });
    const record = await importer.convertImportedConversation(conversations[0], conversations[0].sessionId, 1);
    assert.equal(record.turns.length, 2);
    assert.equal(record.turns[0].prompt, 'Login redirects to a blank page');
    assert.equal(record.turns[0].response, 'Looking at the router.\n\nFixed the redirect.');
    assert.equal(record.turns[0].importedToolCalls, 1);
    assert.equal(record.turns[1].prompt, '/compact');
    assert.equal(record.workspacePath, '/work/app');
    assert.deepEqual(record.importedFrom, { source: 'claude-code', externalId: 'sess-1', importedAt: 1 });
    assert.match(record.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "imported ids are UUID-shaped so private workspaces and goals accept them");
});

test('Codex rollouts skip developer and injected context, use the thread index title and include archived sessions', async t => {
    const { home, environment } = await fixture(t);
    const day = join(home, '.codex', 'sessions', '2026', '09', '12');
    await mkdir(day, { recursive: true });
    await mkdir(join(home, '.codex', 'archived_sessions'), { recursive: true });
    const rollout = id => jsonl([
        { timestamp: '2026-09-12T08:00:00Z', type: 'session_meta', payload: { id, cwd: '/work/api', timestamp: '2026-09-12T08:00:00Z' } },
        { timestamp: '2026-09-12T08:00:00Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'rules' }] } },
        { timestamp: '2026-09-12T08:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n<cwd>/work/api</cwd>\n</environment_context>' }] } },
        { timestamp: '2026-09-12T08:00:02Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Add rate limiting' }] } },
        { timestamp: '2026-09-12T08:00:03Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}' } },
        { timestamp: '2026-09-12T08:00:04Z', type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(1000) } },
        { timestamp: '2026-09-12T08:00:05Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Added a token bucket.' }] } },
        { timestamp: '2026-09-12T08:00:06Z', type: 'event_msg', payload: { type: 'token_count' } }
    ]);
    await writeFile(join(day, 'rollout-2026-09-12T08-00-00-aaa.jsonl'), rollout('thread-a'));
    await writeFile(join(home, '.codex', 'archived_sessions', 'rollout-old-bbb.jsonl'), rollout('thread-b'));
    await writeFile(join(home, '.codex', 'session_index.jsonl'), jsonl([{ id: 'thread-a', thread_name: 'Rate limits' }]));
    const { conversations } = await importer.scanImportSource('codex', [], environment);
    assert.deepEqual(conversations.map(item => item.title).sort(), ['Add rate limiting', 'Rate limits']);
    const record = await importer.convertImportedConversation(conversations.find(item => item.externalId === 'thread-a'), 'import-codex-x', 1);
    assert.deepEqual(record.turns.map(turn => [turn.prompt, turn.response, turn.importedToolCalls]), [['Add rate limiting', 'Added a token bucket.', 1]]);
    assert.equal(record.workspacePath, '/work/api');
});

test('Cursor chats are read from a private copy of state.vscdb, with the workspace folder', async t => {
    const { home, environment } = await fixture(t);
    const user = join(home, 'Library', 'Application Support', 'Cursor', 'User');
    await mkdir(join(user, 'globalStorage'), { recursive: true });
    await mkdir(join(user, 'workspaceStorage', 'ws1'), { recursive: true });
    await writeFile(join(user, 'workspaceStorage', 'ws1', 'workspace.json'), JSON.stringify({ folder: 'file:///work/web%20app' }));
    const db = new DatabaseSync(join(user, 'globalStorage', 'state.vscdb'));
    db.exec('CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB); CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, value TEXT)');
    const put = db.prepare('INSERT INTO cursorDiskKV(key,value) VALUES(?,?)');
    put.run('composerData:comp-0001', JSON.stringify({ name: 'Dark mode', createdAt: 1000, lastUpdatedAt: 2000,
        fullConversationHeadersOnly: [{ bubbleId: 'b1', type: 1 }, { bubbleId: 'b2', type: 2 }] }));
    put.run('bubbleId:comp-0001:b1', JSON.stringify({ type: 1, text: 'Add a dark mode toggle', createdAt: '2026-09-01T00:00:00Z' }));
    put.run('bubbleId:comp-0001:b2', JSON.stringify({ type: 2, text: 'Added it to the header.', toolFormerData: { name: 'edit' }, createdAt: '2026-09-01T00:00:03Z' }));
    put.run('composerData:comp-0002', JSON.stringify({ name: 'Empty draft', fullConversationHeadersOnly: [] }));
    db.prepare('INSERT INTO composerHeaders(composerId,workspaceId,isSubagent) VALUES(?,?,0)').run('comp-0001', 'ws1');
    db.prepare('INSERT INTO composerHeaders(composerId,workspaceId,isSubagent) VALUES(?,?,0)').run('comp-0002', 'ws1');
    db.close();
    const { conversations } = await importer.scanImportSource('cursor', [], environment);
    assert.equal(conversations.length, 1, 'empty drafts are not offered');
    assert.deepEqual({ title: conversations[0].title, workspacePath: conversations[0].workspacePath }, { title: 'Dark mode', workspacePath: '/work/web app' });
    const record = await importer.convertImportedConversation(conversations[0], 'import-cursor-x', 1);
    assert.deepEqual(record.turns.map(turn => [turn.prompt, turn.response, turn.importedToolCalls]), [['Add a dark mode toggle', 'Added it to the header.', 1]]);
});

test('extra folders are scanned too, and a missing tool is reported as not found rather than an error', async t => {
    const { home, environment } = await fixture(t);
    const moved = join(home, 'D-drive', 'claude-projects');
    await mkdir(join(moved, '-x'), { recursive: true });
    await writeFile(join(moved, '-x', 'moved.jsonl'), jsonl([{ type: 'user', cwd: '/x', message: { content: 'Hello from another disk' } }]));
    const result = await importer.scanImportSource('claude-code', [moved], environment);
    assert.deepEqual(result.roots.map(root => [root.found, root.custom]), [[false, false], [true, true]]);
    assert.equal(result.conversations[0].title, 'Hello from another disk');
    assert.deepEqual((await importer.scanImportSource('cursor', [], environment)).conversations, []);
});

test('a conversation with no usable messages is refused whole instead of imported empty', async () => {
    await assert.rejects(importer.convertImportedConversation({ source: 'claude-code', externalId: 'e', sessionId: 's', title: 't', workspacePath: '', createdAt: 1, updatedAt: 1, bytes: 1,
        locator: new URL('../package.json', import.meta.url).pathname }, 'import-claude-code-x'), { code: 'NO_MESSAGES' });
});
