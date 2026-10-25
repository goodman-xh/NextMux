import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
const ui = require('../lib/browser/nextmux-composer-attachments.js');
const instructions = require('../lib/node/nextmux-agent-instructions.js');

test('every common format gets its own labelled icon and folders render as folders', () => {
    const cases = { 'report.pdf': ['pdf', 'PDF'], 'a.docx': ['document', 'DOCX'], 'b.xlsx': ['spreadsheet', 'XLSX'], 'c.pptx': ['presentation', 'PPTX'],
        'main.ts': ['code', 'TS'], 'app.py': ['code', 'PY'], 'x.cpp': ['code', 'C++'], 'Program.cs': ['code', 'C#'], 'Dockerfile': ['code', 'DOCK'],
        'notes.md': ['text', 'MD'], 'a.zip': ['archive', 'ZIP'], 'v.mov': ['video', 'MOV'], 's.flac': ['audio', 'FLAC'], 'photo.jpeg': ['image', 'JPG'],
        'types.d.ts': ['code', 'D.TS'], '.env.local': ['data', 'ENV'], 'unknown.qqq': ['binary', 'QQQ'] };
    for (const [name, [family, label]] of Object.entries(cases)) {
        const info = ui.fileTypeInfo(name);
        assert.equal(info.family, family, name); assert.equal(info.label, label, name);
    }
    assert.equal(ui.fileTypeInfo('src.folder.md').family, 'folder');
    assert.equal(ui.attachmentDisplayName('src.folder.md'), 'src/');
    const labels = new Set(['a.pdf', 'a.docx', 'a.ts', 'a.py', 'a.go', 'a.rs'].map(name => ui.fileTypeInfo(name).color));
    assert.ok(labels.size >= 5, 'different formats use different colours');
});

test('chip truncates visually but keeps the full name and reason in the tooltip', () => {
    const name = 'a-very-long-quarterly-financial-report-final-v12.pdf';
    const markup = renderToStaticMarkup(React.createElement(ui.AttachmentChip, { name, kind: 'file', mimeType: 'application/pdf', meta: '2.0 MB', locale: 'en', state: 'unsupported', hint: 'Why', onRemove() {} }));
    assert.match(markup, new RegExp(`title="${name}\\nWhy"`));
    assert.match(markup, /nmx-attachment-chip is-unsupported/); assert.match(markup, /aria-label="Remove"/); assert.match(markup, /<svg class="nmx-file-type-icon is-pdf"/);
    const image = renderToStaticMarkup(React.createElement(ui.AttachmentChip, { name: 'a.png', kind: 'image', thumbnail: 'data:image/png;base64,AA==', locale: 'zh-CN', onPreview() {} }));
    assert.match(image, /<img src="data:image\/png;base64,AA=="/); assert.match(image, /nmx-attachment-preview/);
});

test('anchors follow edits before them and stay put for edits after them', () => {
    const anchors = new Map([['a', 5], ['b', 11]]);
    const inserted = ui.rebaseTextAnchors(anchors, 'hello world', 'XXhello world');
    assert.deepEqual([...inserted], [['a', 7], ['b', 13]]);
    const after = ui.rebaseTextAnchors(anchors, 'hello world', 'hello world!!');
    assert.deepEqual([...after], [['a', 5], ['b', 11]]);
    const deleted = ui.rebaseTextAnchors(new Map([['a', 5]]), 'hello world', 'hd');
    assert.equal(deleted.get('a'), 1);
    const typedAtAnchor = ui.rebaseTextAnchors(new Map([['a', 5]]), 'hello', 'hello there');
    assert.equal(typedAtAnchor.get('a'), 5, 'text typed after the drop point comes after the file');
});

test('markers are placed at their anchors in drop order and never fuse with words', () => {
    const value = ui.placeAnchorMarkers('compare this and that', [
        { offset: 12, marker: '[Attached file 1: a.pdf]' },
        { offset: 12, marker: '[Attached file 2: b.pdf]' },
        { offset: 21, marker: '[Attached folder 3: src/]' }
    ]);
    assert.equal(value, 'compare this [Attached file 1: a.pdf] [Attached file 2: b.pdf] and that [Attached folder 3: src/]');
    assert.equal(ui.attachmentAnchorMarker('src.folder.md', 'text', 3), '[Attached folder 3: src/]');
    const path = ui.folderPathInsertion('look at please', 8, 'packages/app/');
    assert.equal(path.text, 'look at packages/app/ please');
    assert.equal(ui.folderPathInsertion('open', 4, '/Users/me/My Folder/').text, 'open `/Users/me/My Folder/` ');
});

function directory(name, children) {
    return { name, isFile: false, isDirectory: true, createReader() {
        let done = false;
        return { readEntries(ok) { const batch = done ? [] : children; done = true; setTimeout(() => ok(batch), 0); } };
    } };
}
function file(name, content) {
    return { name, isFile: true, isDirectory: false, file(ok) { ok(new File([content], name)); } };
}

test('folder snapshot lists the tree, reads text, skips vendored folders, binaries and secrets', async () => {
    const root = directory('app', [
        file('README.md', '# App\nhello'),
        file('.env', 'SECRET=1'),
        file('logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0])),
        directory('node_modules', [file('x.js', 'nope')]),
        directory('src', [file('main.ts', 'console.log("```");\n')])
    ]);
    const snapshot = await ui.buildFolderSnapshot(root, { workspaceRelativePath: 'packages/app' });
    assert.equal(snapshot.fileCount, 4);
    assert.match(snapshot.content, /^# Folder: app\/\nProject path: packages\/app\//);
    assert.match(snapshot.content, /## Structure\napp\/\n  src\/\n    main\.ts\n  \.env\n  logo\.png\n  README\.md/);
    assert.match(snapshot.content, /\(skipped: node_modules\/\)/);
    assert.match(snapshot.content, /### README\.md\n```md\n# App\nhello\n```/);
    assert.match(snapshot.content, /### src\/main\.ts\n````ts\n/, 'fence is longer than any backtick run in the file');
    assert.doesNotMatch(snapshot.content, /SECRET=1/);
    assert.doesNotMatch(snapshot.content, /### logo\.png/);
    const tight = await ui.buildFolderSnapshot(directory('big', Array.from({ length: 30 }, (_, index) => file(`f${index}.txt`, 'x'.repeat(5000)))), { maxCharacters: 20_000 });
    assert.ok(tight.content.length <= 21_000); assert.match(tight.content, /Contents not included/);
});

test('AGENTS.md instructions compose within the runner limit and saves detect conflicts', async t => {
    const base = 'BASE';
    assert.equal(instructions.composeAgentInstructions(base, '', ''), base);
    const composed = instructions.composeAgentInstructions(base, 'Reply in Chinese', 'Use pnpm');
    assert.match(composed, /## User instructions \(AGENTS\.md\)[\s\S]*### Personal \(every project\)\nReply in Chinese[\s\S]*### This project[\s\S]*\nUse pnpm/);
    const huge = instructions.composeAgentInstructions('B'.repeat(3500), 'p'.repeat(20_000), 'q'.repeat(20_000));
    // The runner's own instruction limit (it moved from a fixed 20 000 to agent-runtime's AGENT_INSTRUCTIONS_LIMIT).
    const { AGENT_INSTRUCTIONS_LIMIT } = require('@nextmux/agent-runtime');
    assert.ok(huge.length <= AGENT_INSTRUCTIONS_LIMIT, `${huge.length} > ${AGENT_INSTRUCTIONS_LIMIT}`); assert.match(huge, /truncated/);
    const dir = await mkdtemp(join(tmpdir(), 'nmx-agents-')); t.after(() => rm(dir, { recursive: true, force: true }));
    const path = instructions.agentInstructionPath(dir);
    const empty = await instructions.readAgentInstructionFile(path, 'project');
    assert.equal(empty.exists, false);
    const saved = await instructions.writeAgentInstructionFile(path, 'project', '# Rules\r\n- pnpm', empty.sha256);
    assert.equal(await readFile(path, 'utf8'), '# Rules\n- pnpm\n'); assert.equal(saved.exists, true);
    await assert.rejects(instructions.writeAgentInstructionFile(path, 'project', 'other', empty.sha256), error => error.code === 'AGENT_INSTRUCTIONS_CHANGED');
    await instructions.writeAgentInstructionFile(path, 'project', '   ', saved.sha256);
    await assert.rejects(stat(path), error => error.code === 'ENOENT', 'clearing the text removes the file');
});

test('a project with only another tool’s instruction file is offered for import and still steers runs', async t => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'nm-instructions-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    assert.deepEqual(await instructions.readOtherInstructionFiles(directory), []);
    await writeFile(join(directory, 'CLAUDE.md'), '# Rules\r\n- Use pnpm\r\n');
    await mkdir(join(directory, '.github'));
    await writeFile(join(directory, '.github', 'copilot-instructions.md'), 'Prefer small diffs');
    await writeFile(join(directory, '.cursorrules'), '   ');
    const found = await instructions.readOtherInstructionFiles(directory);
    assert.deepEqual(found.map(item => [item.name, item.content]), [['CLAUDE.md', '# Rules\n- Use pnpm\n'], ['.github/copilot-instructions.md', 'Prefer small diffs']]);
    // Importing never touches CLAUDE.md: saving creates AGENTS.md next to it.
    const empty = await instructions.readAgentInstructionFile(join(directory, 'AGENTS.md'), 'project');
    await instructions.writeAgentInstructionFile(join(directory, 'AGENTS.md'), 'project', found[0].content, empty.sha256);
    const { readFile } = await import('node:fs/promises');
    assert.equal(await readFile(join(directory, 'CLAUDE.md'), 'utf8'), '# Rules\r\n- Use pnpm\r\n');
});
