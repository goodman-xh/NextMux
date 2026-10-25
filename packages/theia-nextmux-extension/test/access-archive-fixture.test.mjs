import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAccessArchiveFixture } from './access-archive-fixture-state.mjs';

const change = (action, tools) => ({ serverName: 'fixture-mcp', fingerprint: 'fixture-server-v1', action, tools });
async function start(fixture) {
    await fixture.service.reviewMcpAccess('fixture-mcp');
    return fixture.service.changeMcpAccess(change('start'));
}

test('fixture starts with zero grants, grants one supported tool and revokes without restarting any service', async () => {
    const fixture = createAccessArchiveFixture();
    await assert.rejects(fixture.service.changeMcpAccess(change('start')), /REVIEW_REQUIRED/);
    const [server] = await start(fixture);
    assert.equal(server.running, true);
    assert.equal(server.tools.filter(tool => tool.approved).length, 0);
    await fixture.service.changeMcpAccess(change('tools', [{ name: 'read_sample', fingerprint: 'read-v1' }]));
    assert.deepEqual(fixture.snapshot().servers[0].tools.filter(tool => tool.approved).map(tool => tool.name), ['read_sample']);
    await assert.rejects(fixture.service.changeMcpAccess(change('tools', [{ name: 'unsupported_sample', fingerprint: 'unsupported-v1' }])), /BAD_TOOL/);
    await fixture.service.changeMcpAccess(change('revoke'));
    assert.equal(fixture.snapshot().servers[0].running, false);
    assert.equal(fixture.snapshot().servers[0].tools.filter(tool => tool.approved).length, 0);
});

test('fixture can hold a request, report late failure and prevent externally revoked grants returning', async () => {
    const fixture = createAccessArchiveFixture(); await start(fixture);
    fixture.setHold(true);
    const failed = fixture.service.changeMcpAccess(change('tools', [{ name: 'read_sample', fingerprint: 'read-v1' }]));
    assert.equal(fixture.snapshot().pending, 'tools');
    fixture.settleHeld(false); await assert.rejects(failed, /LATE_FAILURE/);
    assert.equal(fixture.snapshot().servers[0].tools.filter(tool => tool.approved).length, 0);
    fixture.setHold(true);
    const stale = fixture.service.changeMcpAccess(change('tools', [{ name: 'read_sample', fingerprint: 'read-v1' }]));
    fixture.externalRevoke(); fixture.settleHeld(true);
    await assert.rejects(stale, /STALE_OPERATION/);
    assert.equal(fixture.snapshot().servers[0].approved, false);
});

test('fixture invalidates good preview before failing a new selection and refuses old import', async () => {
    const fixture = createAccessArchiveFixture();
    const preview = await fixture.service.previewConversationArchive(await fixture.chooseFile('open'));
    fixture.setChoice('bad'); fixture.setHold(true);
    const pending = fixture.service.previewConversationArchive(await fixture.chooseFile('open'));
    assert.equal(fixture.snapshot().previewId, undefined);
    fixture.settleHeld(true); await assert.rejects(pending, /INVALID_ARCHIVE/);
    await assert.rejects(fixture.service.importConversationArchive(preview.previewId, 'skip'), /PREVIEW_EXPIRED/);
    fixture.setChoice('good');
    const next = await fixture.service.previewConversationArchive(await fixture.chooseFile('open'));
    assert.notEqual(next.previewId, preview.previewId);
    assert.deepEqual(await fixture.service.importConversationArchive(next.previewId, 'copy'), { imported: 15, skipped: 1 });
    await assert.rejects(fixture.service.importConversationArchive(next.previewId, 'copy'), /PREVIEW_EXPIRED/);
});

test('fixture cancellation leaves selected receipt untouched and export can remain busy until released', async () => {
    const fixture = createAccessArchiveFixture();
    const preview = await fixture.service.previewConversationArchive('fixture://archive/good');
    fixture.setChoice('cancel'); assert.equal(await fixture.chooseFile('open'), undefined);
    assert.equal(fixture.snapshot().previewId, preview.previewId);
    fixture.setHold(true);
    const exported = fixture.service.exportConversationArchive('fixture://archive/export', ['a']);
    assert.equal(fixture.snapshot().pending, 'export'); fixture.settleHeld(true);
    assert.deepEqual(await exported, { conversations: 1, attachments: 2 });
});

test('fixture uses real component sources, both production stylesheets and no service connection', async () => {
    const component = await readFile(new URL('access-archive-fixture.tsx', import.meta.url), 'utf8');
    const server = await readFile(new URL('serve-access-archive-fixture.mjs', import.meta.url), 'utf8');
    const backend = await readFile(new URL('access-archive-fixture-state.mjs', import.meta.url), 'utf8');
    assert.match(component, /src\/browser\/nextmux-mcp-access-panel/);
    assert.match(component, /src\/browser\/nextmux-conversation-archive-panel/);
    assert.match(server, /nextmux\.css/); assert.match(server, /nextmux-desktop-production\.css/);
    assert.match(server, /connect-src 'none'/);
    assert.doesNotMatch(backend, /\b(?:fetch|require|import|spawn|exec|readFile|writeFile)\s*\(/);
});
