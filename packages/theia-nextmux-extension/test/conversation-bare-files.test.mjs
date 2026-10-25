import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const sourceDir = fileURLToPath(new URL('../src/browser/', import.meta.url));
const { outputFiles } = await desktop('esbuild').build({
    stdin: { contents: `export * from './nextmux-conversation-media'; export * from './nextmux-conversation-file-target';`, resolveDir: sourceDir },
    bundle: true, write: false, platform: 'node', format: 'esm'
});
const { isValidLocalFileLinkCandidate: valid, normalizeLocalFileLinkTarget: normalize,
    findLocalFileLinkCandidatesInText: find, conversationMediaKind: kind,
    conversationTurnFileEvidence: evidence, resolveConversationFileTarget: resolve } =
    await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const completed = (toolName, summary, rest = {}) => ({ type: 'tool_completed', callId: toolName, ok: true, toolName, summary, ...rest });

test('every requested data/document/media/code extension accepts a bare filename', () => {
    const extensions = 'sqlite db sqlite3 csv tsv json jsonl md markdown txt log pdf doc docx xls xlsx ppt pptx png jpg jpeg webp svg gif bmp avif ico wav mp3 ogg m4a aac flac mp4 webm mov mkv py ts tsx js jsx mjs cjs html htm css scss less sql yaml yml toml xml ini env sh bat ps1 zip tar gz 7z rs go java c cpp h hpp cs rb php vue svelte'.split(' ');
    for (const extension of extensions) {
        assert.equal(valid(`report.${extension}`), true, extension);
        assert.equal(normalize(`REPORT.${extension.toUpperCase()}`), `REPORT.${extension.toUpperCase()}`);
    }
    assert.equal(valid('.env'), true);
    assert.equal(normalize('report.md:42:3'), 'report.md#L42');
    assert.equal(normalize('src/app.ts:42'), 'src/app.ts#L42');
    for (const extension of 'png jpg jpeg webp svg gif bmp avif ico'.split(' ')) assert.equal(kind(`promo.${extension}`), 'image');
    assert.equal(kind('tasks.sqlite'), 'file');
});

test('domains, runtime names, versions, URLs, commands and emails stay ordinary text', () => {
    const tokens = ['node.js', 'next.js', 'vue.js', 'react.js', 'three.js', 'chart.js', 'd3.js', 'express.js', 'nw.js', 'electron.js',
        'v1.2.3', '1.2.3', 'https://example.test/promo.png', 'npm install app.js', 'user@report.pdf',
        ...'com org net io dev ai app cn co edu gov uk de jp fr'.split(' ').map(extension => `example.${extension}`)];
    for (const token of tokens) assert.equal(valid(token), false, token);
    assert.deepEqual(find(tokens.filter(token => !token.includes(' ')).join(' ')), []);
    assert.equal(valid('src/node.js'), true, 'a real qualified path is not a runtime token');
});

test('standalone lines, list items, table cells and quoted or whitespace-bounded names retain exact offsets', () => {
    const text = 'tasks.sqlite\n- tasks.json\n1. tasks.csv\n| promo.png | promo-edited.png |\n"promo.jpg" “promo.webp” `task-chart.png`\nlogo.svg intro.wav demo.gif report.md report.pdf report.docx analysis.xlsx presentation.pptx test_results.json artifacts_manifest.json\n.env';
    const expected = ['tasks.sqlite', 'tasks.json', 'tasks.csv', 'promo.png', 'promo-edited.png', 'promo.jpg', 'promo.webp', 'task-chart.png',
        'logo.svg', 'intro.wav', 'demo.gif', 'report.md', 'report.pdf', 'report.docx', 'analysis.xlsx', 'presentation.pptx', 'test_results.json', 'artifacts_manifest.json', '.env'];
    const candidates = find(text);
    assert.deepEqual(candidates.map(candidate => candidate.target), expected);
    for (const candidate of candidates) assert.equal(text.slice(candidate.start, candidate.end), candidate.target);
    assert.deepEqual(find('--output=artifacts/promo.png').map(candidate => candidate.target), ['artifacts/promo.png']);
    assert.deepEqual(find('"C:\\Users\\John Smith\\promo.png"').map(candidate => candidate.target), ['C:\\Users\\John Smith\\promo.png']);
});

test('turn changes, image/audio/video tools, attachments and artifacts contribute bare-file evidence', () => {
    const root = 'c:/Users/test/work';
    const turn = {
        workspaceRoot: root,
        changes: [{ path: 'output/tasks.sqlite' }, { path: 'report.pdf', externalTarget: 'C:/Users/test/reports/report.pdf' }],
        attachments: [{ name: 'promo.png', workspaceRelativePath: 'artifacts/promo.png' }, { name: 'logo.svg', uri: 'file:///C:/Users/test/work/assets/logo.svg' }],
        artifacts: [{ path: 'artifacts/analysis.xlsx' }, 'tasks.csv'],
        events: [
            ...['workspace.write_file', 'workspace.apply_patch', 'workspace.read_file', 'media.inspect', 'media.Understand', 'media.transcribe',
                'media.generate_image', 'media.edit_image', 'media.generate_video', 'media.generate_audio'].map((toolName, index) =>
                completed(toolName, { resource: { kind: 'file', path: `${root}/output/tool-${index}.png` } })),
            completed('workspace.list_files', { details: ['output/tasks.json', 'artifacts/presentation.pptx'] })
        ]
    };
    const all = evidence(turn);
    for (const basename of ['tasks.sqlite', 'promo.png', 'logo.svg', 'report.pdf', 'analysis.xlsx', 'tasks.csv', 'tasks.json', 'presentation.pptx']) assert.ok(all.basenames.has(basename), basename);
    assert.deepEqual(evidence('tasks.sqlite', turn), { status: 'matched', path: `${root}/output/tasks.sqlite` });
    assert.deepEqual(evidence('PROMO.PNG', turn), { status: 'matched', path: `${root}/artifacts/promo.png` });
    assert.deepEqual(evidence('report.pdf', turn), { status: 'matched', path: 'C:/Users/test/reports/report.pdf' });
    assert.equal(all.relativePaths.has('report.pdf'), false, 'external display name does not manufacture a workspace file');
    assert.equal(resolve('promo.png', root, { evidence: all, allowBareWorkspaceFallback: false }).path, `${root}/artifacts/promo.png`);
    for (let index = 0; index < 10; index++) assert.ok(all.basenames.has(`tool-${index}.png`));
});

test('process and terminal argv/stdout references resolve within the workspace and never grant outside paths', () => {
    const root = '/project';
    const turn = { workspaceRoot: root, events: [
        { type: 'tool_started', toolName: 'process.run', callId: 'process.run', arguments: { command: 'python', args: ['scripts/build.py', '--out=output/tasks.sqlite'] } },
        completed('process.run', { commandLine: 'python scripts/build.py --out=output/tasks.sqlite', details: ['Created output/test_results.json'] }, { output: { stdout: 'Saved artifacts/report.pdf\n/outside/secret.pdf' } }),
        { type: 'tool_output', toolName: 'terminal.run', callId: 'terminal', chunk: 'artifacts/promo.png\n/project/audio/intro.wav\n/outside/leak.png' },
        completed('terminal.run', {}, { args: ['--output=output/demo.gif'], stdout: 'output/artifacts_manifest.json' })
    ] };
    for (const [name, relative] of [['tasks.sqlite', 'output/tasks.sqlite'], ['test_results.json', 'output/test_results.json'],
        ['report.pdf', 'artifacts/report.pdf'], ['promo.png', 'artifacts/promo.png'], ['intro.wav', 'audio/intro.wav'],
        ['demo.gif', 'output/demo.gif'], ['artifacts_manifest.json', 'output/artifacts_manifest.json']]) {
        assert.deepEqual(evidence(name, turn), { status: 'matched', path: `${root}/${relative}` }, name);
    }
    for (const name of ['secret.pdf', 'leak.png']) assert.deepEqual(evidence(name, turn), { status: 'none' });
});

test('workspace bare fallback is a candidate, explicit disabling needs evidence, and duplicates use recent evidence', () => {
    assert.equal(resolve('tasks.sqlite', '/project').path, '/project/tasks.sqlite');
    assert.equal(resolve('tasks.sqlite', '/project', { allowBareWorkspaceFallback: true }).path, '/project/tasks.sqlite');
    assert.equal(resolve('tasks.sqlite', '/project', { allowBareWorkspaceFallback: false }), undefined);
    assert.equal(resolve('tasks.sqlite', ''), undefined);
    const turn = { workspaceRoot: '/project', changes: [{ path: 'a/promo.png' }, { path: 'b/promo.png' }] };
    assert.deepEqual(evidence('promo.png', turn), { status: 'matched', path: '/project/b/promo.png' });
    assert.equal(resolve('promo.png', '/project', { evidence: evidence(turn) }).path, '/project/b/promo.png');
    assert.deepEqual(evidence('../a/promo.png', turn), { status: 'none' });
});

test('rooted native relative evidence keeps literal percent signs instead of inventing a decoded sibling', () => {
    for (const path of ['/project/literal%20name.ts', 'literal%20name.ts']) {
        const turn = { workspaceRoot: '/project', changes: [{ path }] };
        assert.deepEqual(evidence('literal%2520name.ts', turn), { status: 'matched', path: '/project/literal%20name.ts' });
        assert.deepEqual(evidence('literal%20name.ts', turn), { status: 'none' });
    }
});
