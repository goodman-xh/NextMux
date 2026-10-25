import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Exercise the current source methods without touching a running app or user data.
const widgetText = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const widgetFile = ts.createSourceFile('widget.tsx', widgetText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = widgetFile.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = name => widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === name).getText(widgetFile);
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
let highlight;
function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(widgetFile) === 'renderSearchHighlightText') highlight = node.initializer.getText(widgetFile);
    ts.forEachChild(node, visit);
}
visit(widgetClass);
assert.ok(highlight);
const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
const render = new Function('React', 'query', transpile(`return (${highlight});`));
const highlights = (query, value) => {
    const nodes = render(React, query)(value);
    return { nodes, marks: Array.isArray(nodes) ? nodes.filter(node => typeof node === 'object').map(node => node.children.join('')) : [] };
};

const searchText = await readFile(new URL('../src/node/nextmux-conversation-search.ts', import.meta.url), 'utf8');
const searchFile = ts.createSourceFile('search.ts', searchText, ts.ScriptTarget.Latest, true);
const searchNames = ['text', 'compactSnippet', 'conversationMessageSearchTexts', 'searchConversationHistoryRecords'];
const searchSource = searchFile.statements.filter(node => ts.isFunctionDeclaration(node) && searchNames.includes(node.name?.text))
    .map(node => node.getText(searchFile).replace(/^export /, '')).join('\n');
const activityLimit = searchFile.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(searchFile) === 'CONVERSATION_ACTIVITY_TEXT_LIMIT')).getText(searchFile).replace(/^export /, '');
const search = new Function(transpile(`${activityLimit}\n${searchSource}\nreturn searchConversationHistoryRecords;`))();

test('global search highlights separated AND terms in an actual backend match', () => {
    const query = 'Alpha beta';
    const result = search([{ id: 'c', title: 'Example', workspacePath: '/fixture', createdAt: 1, updatedAt: 2,
        messages: [{ id: 'm', turnId: 't', prompt: '', response: 'ALPHA appears first. The second term is beta.', error: '', createdAt: 1 }] }], { query });
    assert.equal(result.matches.length, 1);
    assert.deepEqual(highlights(query, result.matches[0].snippet).marks, ['ALPHA', 'beta']);
});

test('global search merges overlapping terms without duplicating text', () => {
    const result = highlights('foo foobar foo', 'foobar foo');
    assert.deepEqual(result.marks, ['foobar', 'foo']);
    assert.equal(result.nodes.map(node => typeof node === 'string' ? node : node.children.join('')).join(''), 'foobar foo');
});

test('global search handles punctuation literally, repeated matches, spaces, and no match', () => {
    assert.deepEqual(highlights(' C++ \t [ok] ', 'C++ then [ok], C++').marks, ['C++', '[ok]', 'C++']);
    assert.deepEqual(highlights('', 'unchanged').marks, []);
    assert.deepEqual(highlights('missing', 'unchanged').nodes, 'unchanged');
});

class FixtureElement {
    constructor(inComposer) { this.inComposer = inComposer; }
    closest(selector) { return selector.startsWith('.nmx-composer-wrap') ? (this.inComposer ? this : null) : (!this.inComposer ? this : null); }
}
const windowStub = { setTimeout: () => 1, clearTimeout: () => {}, nextmuxDesktop: undefined };
const URI = { fromFilePath: path => ({ path }) };
const FolderFixture = new Function('window', 'Element', 'URI', 'composerAttachmentUiText', 'buildFolderSnapshot', 'FOLDER_SNAPSHOT_SUFFIX',
    transpile(`return class Fixture {
        ${method('handleComposerDrop')}
        ${method('addComposerFolders')}
    };`))(windowStub, FixtureElement, URI, (_locale, key) => key, async entry => ({ name: entry.name, fileCount: 1, content: 'folder contents' }), '.folder.md');

async function drop({ inComposer = true, unstarted = true, mode = 'composer', offset } = {}) {
    const fixture = new FolderFixture();
    Object.assign(fixture, {
        applicationExitPreparing: false, globalCodingDraft: true, activeCodingSessionId: '', draftWorkspaceRoot: '', prompt: '',
        composerDropMode: mode, composerDropCaret: offset === undefined ? undefined : { offset },
        bindings: [], imported: [], paths: [], pending: [], attachments: [],
        appControlAvailable: () => false, update: () => {}, canDropFolderAsProject: () => unstarted,
        composerFilesFromTransfer: () => [], addNotification: () => {},
        useDraftWorkspaceFolder: async function (uri, requireUnstarted) { this.bindings.push({ path: uri.path, requireUnstarted }); return true; },
        activeCodingSession: () => ({ id: 'draft', workspacePath: '' }), codingSessionWorkspaceRoot: () => '',
        attachmentMimeType: () => 'text/plain', textAttachmentExtension: () => true,
        runOwnedAttachmentImport: async function (_session, execute) { await execute(async (name, bytes) => { this.imported.push({ name, content: new TextDecoder().decode(bytes) }); return true; }, () => true); }
    });
    const add = fixture.addComposerFolders.bind(fixture);
    fixture.addComposerFolders = (...args) => { const pending = add(...args); fixture.pending.push(pending); return pending; };
    // The source folder snapshot filename constant remains a harmless fixture dependency.
    const file = { path: '/fixture/docs' };
    const entry = { name: 'docs', isDirectory: true };
    fixture.handleComposerDrop({ preventDefault() {}, stopPropagation() {}, target: new FixtureElement(inComposer),
        dataTransfer: { files: [file], items: [{ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => entry }] } });
    await Promise.all(fixture.pending);
    return fixture;
}

test('empty global composer folder drop stays an attachment and does not bind the project', async () => {
    const fixture = await drop();
    assert.deepEqual(fixture.bindings, []);
    assert.deepEqual(fixture.imported, [{ name: 'docs.folder.md', content: 'folder contents' }]);
});
test('only an unstarted conversation body folder drop binds its project', async () => {
    const fixture = await drop({ inComposer: false, mode: 'thread' });
    assert.deepEqual(fixture.bindings, [{ path: '/fixture/docs', requireUnstarted: true }]);
    assert.deepEqual(fixture.imported, []);
});
test('a started conversation body folder drop remains an attachment', async () => {
    const fixture = await drop({ inComposer: false, mode: 'thread', unstarted: false });
    assert.deepEqual(fixture.bindings, []);
    assert.equal(fixture.imported.length, 1);
});
test('composer target wins even if a previous drag-over left thread mode', async () => {
    const fixture = await drop({ inComposer: true, mode: 'thread' });
    assert.deepEqual(fixture.bindings, []);
    assert.equal(fixture.imported.length, 1);
});
