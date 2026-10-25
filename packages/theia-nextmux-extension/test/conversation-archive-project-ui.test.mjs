import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ConversationArchivePanel } from '../lib/browser/nextmux-conversation-archive-panel.js';
import { archiveProjectText } from '../lib/browser/nextmux-archive-project-locale.js';
import { archiveUiProjectGroups, archiveProjectExportOptions, normalizeArchivedProjectLabel } from '../lib/browser/nextmux-archive-project-ui.js';
const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
const walk = element => !element || typeof element !== 'object' ? [] : [element, ...React.Children.toArray(element.props?.children).flatMap(walk)];
const button = (tree, label) => walk(tree).find(item => item.type === 'button' && item.props.children === label);
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
const group = { id: 'a', sessionIds: ['a', 'b'], titles: ['First conversation', 'Second conversation'] };
const preview = { previewId: 'preview-original', sha256: 'a'.repeat(64), bytes: 10, attachments: 0, attachmentBytes: 0, warnings: [], conversations: [{ id: 'a', title: 'Example', conflict: true, copyConflict: false, projectRef: 'first' }],
    projects: [{ ref: 'first', label: 'First project', conversations: 1, binding: { kind: 'owned_workspace' } }, { ref: 'second', label: 'Other project', conversations: 1, binding: { kind: 'local_directory', directoryUri: 'file:///local/other', directoryPath: '/local/other' } }] };
const base = { locale: 'en', service: {}, disabled: false, historyEnabled: true, sessionIds: ['a', 'b'], selectedSessionId: 'a', projectGroups: [group], chooseFile: async () => 'file:///archive.nmxarchive', chooseDirectory: async () => 'file:///local/picked', beforeOperation: async () => {}, afterImport: async () => {} };
// Isolated hook/handler contract harness, not a mounted React lifecycle test.
function harness(initial, initialPreview) {
    let current = initial, index = 0; const slots = initialPreview ? [false, initialPreview] : [];
    return { setProps(value) { current = value; }, render() {
        const pointer = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher, previous = pointer.current; index = 0;
        pointer.current = { useState(value) { const at = index++; if (!(at in slots)) slots[at] = typeof value === 'function' ? value() : value; return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }]; }, useRef(value) { const at = index++; if (!(at in slots)) slots[at] = { current: value }; return slots[at]; } };
        try { return ConversationArchivePanel(current); } finally { pointer.current = previous; }
    } };
}

test('portable display groups derive safe folder basenames without exposing full Windows, POSIX or private workspace paths', () => {
    const sessions = [{ id: 'a', title: 'A', workspacePath: 'C:\\Users\\Fixture\\33' }, { id: 'b', title: 'B', workspacePath: 'C:\\Users\\Fixture\\33' }, { id: 'c', title: 'C', workspacePath: '/local/project' }, { id: 'd', title: 'D', workspacePath: '/private/conversation', ownedWorkspace: true }];
    const groups = archiveUiProjectGroups(sessions); assert.equal(groups.length, 2); assert.deepEqual(groups[0].sessionIds, ['a', 'b']);
    assert.equal(groups[0].label, '33'); assert.equal(groups[1].label, 'project'); assert.doesNotMatch(JSON.stringify(groups), /Users|local|private|workspacePath/);
    const reference = { sourceSha256: 'a'.repeat(64), ref: '11111111-1111-4111-8111-111111111111', label: 'Same name' };
    const separate = archiveUiProjectGroups([sessions[0], { ...sessions[0], id: 'e', archiveProject: reference }, { ...sessions[0], id: 'f', archiveProject: { ...reference, sourceSha256: 'b'.repeat(64) } }]);
    assert.equal(separate.length, 3); assert.equal(separate[1].label, separate[2].label);
    assert.deepEqual(normalizeArchivedProjectLabel({ ...reference, path: '/not-authority', permissions: 'full_access' }), reference);
    assert.equal(normalizeArchivedProjectLabel({ ...reference, label: 'C:\\old\\project' }), undefined);
});

test('explicit project export filters to selected sessions and rejects unsafe names without a partial guess', () => {
    assert.deepEqual(archiveProjectExportOptions([group], ['b'], { a: 'Review name' }), { projects: [{ label: 'Review name', sessionIds: ['b'] }] });
    for (const label of ['', 'C:\\old', '/absolute', '../relative', 'invisible\u202e', 'x'.repeat(161)]) assert.throws(() => archiveProjectExportOptions([group], ['a'], { a: label }), error => error.code === 'ARCHIVE_PROJECT_LABEL_INVALID' && error.domainError?.params.reason === 'archive_project_label_invalid');
    assert.deepEqual(archiveProjectExportOptions([group], ['unknown'], {}), { projects: [] });
    const many = Array.from({ length: 129 }, (_, i) => ({ id: String(i), sessionIds: [String(i)], titles: ['User title'] }));
    assert.throws(() => archiveProjectExportOptions(many, many.map(g => g.id), Object.fromEntries(many.map(g => [g.id, 'User name']))),
        error => error.code === 'ARCHIVE_PROJECT_LIMIT' && error.domainError?.params.reason === 'archive_project_group_limit' && error.domainError.params.limit === 128);
});

test('all twelve locales render only Export and Import and automatically preserve project groups by default', async () => {
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const html = renderToStaticMarkup(React.createElement(ConversationArchivePanel, { ...base, locale }));
        assert.ok(!html.includes(archiveProjectText(locale, 'include'))); assert.doesNotMatch(html, /type="checkbox"|C:\\/);
        if (locale === 'ar') assert.match(html, /dir="rtl"/);
    }
    const calls = []; const h = harness({ ...base, service: { exportConversationArchive: async (...args) => { calls.push(args); return { conversations: 2, attachments: 0 }; } } });
    button(h.render(), 'Export').props.onClick(); await flush();
    assert.deepEqual(calls[0][2], { projects: [{ label: 'Project 1', sessionIds: ['a', 'b'] }] });
});

test('binding replaces all mappings, consumes the old preview before awaiting, and only exposes the returned new receipt', async () => {
    const calls = []; let resolve;
    const h = harness({ ...base, service: { prepareConversationArchiveBindings: (...args) => { calls.push(args); return new Promise(ok => { resolve = ok; }); } } }, preview);
    button(h.render(), 'Choose local folder').props.onClick(); await flush();
    assert.equal(button(h.render(), 'Import now'), undefined); assert.deepEqual(calls[0], ['preview-original', [{ projectRef: 'first', directoryUri: 'file:///local/picked' }, { projectRef: 'second', directoryUri: 'file:///local/other' }]]);
    resolve({ ...preview, previewId: 'preview-new', projects: [{ ...preview.projects[0], binding: { kind: 'local_directory', directoryUri: 'file:///local/picked', directoryPath: '/local/picked' } }, preview.projects[1]] }); await flush();
    button(h.render(), 'Use private workspace').props.onClick(); await flush(); assert.equal(calls[1][0], 'preview-new'); assert.equal(calls[1][1][0].directoryUri, null);
    resolve({ ...preview, previewId: 'preview-owned' }); await flush(); assert.ok(button(h.render(), 'Import now'));
});

test('a cancelled folder picker preserves preview, but bad new binding or failed import never leaves stale confirmation', async () => {
    let calls = 0; const cancel = harness({ ...base, chooseDirectory: async () => undefined, service: { prepareConversationArchiveBindings: async () => { calls++; return preview; } } }, preview);
    button(cancel.render(), 'Choose local folder').props.onClick(); await flush(); assert.equal(calls, 0); assert.ok(button(cancel.render(), 'Import now'));
    const bad = harness({ ...base, service: { prepareConversationArchiveBindings: async () => { throw new Error('ARCHIVE_BINDING_CHANGED'); } } }, preview);
    button(bad.render(), 'Choose local folder').props.onClick(); await flush(); assert.equal(button(bad.render(), 'Import now'), undefined); assert.ok(walk(bad.render()).some(item => item.props?.role === 'alert'));
    const failedImport = harness({ ...base, service: { importConversationArchive: async () => { throw new Error('ARCHIVE_BINDING_CHANGED'); } } }, preview);
    button(failedImport.render(), 'Import now').props.onClick(); await flush(); assert.equal(button(failedImport.render(), 'Import now'), undefined);
});

test('double import commits once and a post-commit refresh failure reports the import as completed, not retryable', async () => {
    let resolve, calls = 0, refreshed; const result = { imported: 1, skipped: 0, idMap: {}, conversations: 1, boundDirectories: ['file:///local/picked'] };
    const h = harness({ ...base, service: { importConversationArchive: async () => { calls++; return new Promise(ok => { resolve = ok; }); } }, afterImport: async value => { refreshed = value; throw new Error('UI refresh failed'); } }, preview);
    const submit = button(h.render(), 'Import now'); submit.props.onClick(); submit.props.onClick(); await flush(); assert.equal(calls, 1);
    resolve(result); await flush(); assert.deepEqual(refreshed, result);
    assert.equal(button(h.render(), 'Import now'), undefined);
    const text = JSON.stringify(h.render()); assert.match(text, /Imported/); assert.match(text, /do not import again/); assert.doesNotMatch(text, /Conversation transfer failed/);
});

test('actual widget adds only committed local directories, then refreshes roots, restores history and hydrates owned paths', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const picker = source.slice(source.indexOf('protected async chooseConversationArchiveDirectory'), source.indexOf('protected async finishConversationArchiveImport'));
    assert.doesNotMatch(picker, /addRoot\(|draftWorkspaceRoot\s*=|chooseDraftWorkspace/);
    const finished = source.slice(source.indexOf('protected async finishConversationArchiveImport'), source.indexOf('protected async loadOfficialModels'));
    assert.match(finished, /result.boundDirectories/);
    assert.ok(finished.indexOf('addRoot(additions)') < finished.indexOf('refreshWorkspaceRoots()'));
    assert.ok(finished.indexOf('refreshWorkspaceRoots()') < finished.indexOf('restoreDurableCodingSessions()'));
    assert.ok(finished.indexOf('restoreDurableCodingSessions()') < finished.indexOf('hydrateOwnedCodingSessionWorkspaces()'));
    assert.match(source, /archiveProject: normalizeArchivedProjectLabel\(session.archiveProject\)/);
    const css = readFileSync(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-archive-project-list \{[^}]*max-height: min\(300px, 40vh\);[^}]*overflow: auto/);
    assert.match(css, /\.nmx-archive-project-label, \.nmx-archive-bindings article[^}]*minmax\(0, 1fr\)/);
});
