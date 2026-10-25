import assert from 'node:assert/strict';
import test from 'node:test';
const model = await import('../lib/common/nextmux-thread-notes-model.js');
const { appendThreadNoteText, computeThreadNoteDigest, createThreadNoteState, hasThreadNoteContent, mergeThreadNoteUpdate, parseMarkdownNoteWithImages, resolveThreadNotePromptSync, serializeNoteToMarkdown, stripConversationNoteBlocksFromText } = model;
const SAMPLE_IMG_1 = {
    id: 'thread-note-img:1',
    name: 'architecture.png',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    createdAt: 1000
};
const SAMPLE_IMG_2 = {
    id: 'thread-note-img:2',
    name: 'wireframe.png',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    createdAt: 2000
};
test('computeThreadNoteDigest is deterministic and changes immediately when text or images change', () => {
    assert.equal(computeThreadNoteDigest('', []), '');
    assert.equal(computeThreadNoteDigest('1. ', []), '', 'untouched list marker is treated as empty');
    assert.equal(hasThreadNoteContent('1. \n2. '), false);
    assert.equal(hasThreadNoteContent('1. Keep API backward compatible'), true);
    const d1 = computeThreadNoteDigest('1. Keep API backward compatible', [SAMPLE_IMG_1]);
    const d2 = computeThreadNoteDigest('1. Keep API backward compatible\r\n', [SAMPLE_IMG_1]);
    assert.ok(d1.length >= 16);
    assert.equal(d1, d2, 'normalized CRLF/trailing space produces identical digest');
    const dTextChanged = computeThreadNoteDigest('1. Keep API backward compatible\n2. Use strict types', [SAMPLE_IMG_1]);
    assert.notEqual(d1, dTextChanged, 'text modification changes digest');
    const dImgChanged = computeThreadNoteDigest('1. Keep API backward compatible', [SAMPLE_IMG_1, SAMPLE_IMG_2]);
    assert.notEqual(d1, dImgChanged, 'adding an image changes digest');
});
test('resolveThreadNotePromptSync enforces capability-gating, delta-sync, and stripConversationNoteBlocksFromText', () => {
    const notePath = '/Users/me/.nextmux/data/notes/conversations/conv-1.md';
    // 1. Unchecked (modelReadable: false) -> disabled, nextDeliveredDigest === undefined
    const uncheckedState = createThreadNoteState({
        text: '1. Secret note item',
        images: [SAMPLE_IMG_1],
        modelReadable: false
    });
    const dDisabled = resolveThreadNotePromptSync(uncheckedState, undefined, [], notePath);
    assert.equal(dDisabled.action, 'disabled');
    assert.equal(dDisabled.nextDeliveredDigest, undefined);
    assert.equal(dDisabled.promptBlock, undefined);
    assert.equal(dDisabled.newImages.length, 0);
    // Historical <conversation_note> blocks are stripped when unchecked
    const historicalPrompt = 'User question\n\n<conversation_note status="initial" digest="abc" path="/tmp/x.md">\n1. Secret note item\n</conversation_note>\n\nFollow-up';
    const stripped = stripConversationNoteBlocksFromText(historicalPrompt);
    assert.ok(!stripped.includes('<conversation_note'));
    assert.ok(!stripped.includes('Secret note item'));
    assert.equal(stripped, 'User question\n\nFollow-up');
    // 2. Checked (modelReadable: true) first time -> inject_initial
    const checkedState = mergeThreadNoteUpdate(uncheckedState, { modelReadable: true });
    const dInitial = resolveThreadNotePromptSync(checkedState, dDisabled.nextDeliveredDigest, dDisabled.nextDeliveredImageIds, notePath);
    assert.equal(dInitial.action, 'inject_initial');
    assert.equal(dInitial.nextDeliveredDigest, checkedState.digest);
    assert.ok(dInitial.promptBlock?.includes('<conversation_note status="initial"'));
    assert.ok(dInitial.promptBlock?.includes('1. Secret note item'));
    assert.deepEqual(dInitial.newImages, [SAMPLE_IMG_1]);
    // 3. Subsequent turn with NO change (digest === lastDeliveredDigest) -> unchanged (zero redundant re-read)
    const dUnchanged = resolveThreadNotePromptSync(checkedState, dInitial.nextDeliveredDigest, dInitial.nextDeliveredImageIds, notePath);
    assert.equal(dUnchanged.action, 'unchanged');
    assert.equal(dUnchanged.nextDeliveredDigest, checkedState.digest);
    assert.equal(dUnchanged.promptBlock, undefined);
    assert.equal(dUnchanged.newImages.length, 0);
    // 4. Subsequent turn AFTER note text & image change -> inject_updated with only newly added image
    const updatedState = mergeThreadNoteUpdate(checkedState, {
        mode: 'append',
        text: 'Second note item',
        images: [SAMPLE_IMG_2]
    });
    assert.equal(updatedState.text, '1. Secret note item\n2. Second note item');
    assert.equal(updatedState.images.length, 2);
    const dUpdated = resolveThreadNotePromptSync(updatedState, dUnchanged.nextDeliveredDigest, dUnchanged.nextDeliveredImageIds, notePath);
    assert.equal(dUpdated.action, 'inject_updated');
    assert.equal(dUpdated.nextDeliveredDigest, updatedState.digest);
    assert.ok(dUpdated.promptBlock?.includes('<conversation_note status="updated"'));
    assert.ok(dUpdated.promptBlock?.includes('2. Second note item'));
    assert.deepEqual(dUpdated.newImages, [SAMPLE_IMG_2], 'only newly added image is re-sent as attachment');
    // 5. Unchecked again -> disabled and resets nextDeliveredDigest = undefined
    const uncheckedAgain = mergeThreadNoteUpdate(updatedState, { modelReadable: false });
    const dDisabledAgain = resolveThreadNotePromptSync(uncheckedAgain, dUpdated.nextDeliveredDigest, dUpdated.nextDeliveredImageIds, notePath);
    assert.equal(dDisabledAgain.action, 'disabled');
    assert.equal(dDisabledAgain.nextDeliveredDigest, undefined);
    assert.equal(dDisabledAgain.promptBlock, undefined);
});
test('unchecking and re-checking modelReadable with identical note content ALWAYS triggers inject_initial (both across turns and within the same turn gap)', () => {
    const initial = createThreadNoteState({
        text: '1. Keep this exact content',
        images: [SAMPLE_IMG_1],
        modelReadable: true
    });
    // Turn 1: initial check -> inject_initial
    const turn1 = resolveThreadNotePromptSync(initial, undefined);
    assert.equal(turn1.action, 'inject_initial');
    // Turn 2: unchanged -> unchanged
    const turn2 = resolveThreadNotePromptSync(initial, turn1.nextDeliveredDigest, turn1.nextDeliveredImageIds);
    assert.equal(turn2.action, 'unchanged');
    // Scenario A: User unchecks and re-checks BEFORE sending Turn 3 (no intermediate disabled turn!)
    const toggledOff = mergeThreadNoteUpdate(initial, { modelReadable: false });
    const toggledBackOn = mergeThreadNoteUpdate(toggledOff, { modelReadable: true });
    assert.equal(toggledBackOn.digest, initial.digest, 'content digest is identical');
    assert.ok((toggledBackOn.readableCycleId ?? 0) > (initial.readableCycleId ?? 0), 'readableCycleId incremented on false -> true');
    // Even when passing turn2.nextDeliveredDigest directly, Turn 3 MUST be inject_initial!
    const turn3 = resolveThreadNotePromptSync(toggledBackOn, turn2.nextDeliveredDigest, turn2.nextDeliveredImageIds);
    assert.equal(turn3.action, 'inject_initial');
    assert.ok(turn3.promptBlock?.includes('<conversation_note status="initial"'));
    assert.deepEqual(turn3.newImages, [SAMPLE_IMG_1]);
    // Turn 4: subsequent turn without changes -> unchanged again
    const turn4 = resolveThreadNotePromptSync(toggledBackOn, turn3.nextDeliveredDigest, turn3.nextDeliveredImageIds);
    assert.equal(turn4.action, 'unchanged');
    // Scenario B: User unchecks, sends a turn while unchecked, then re-checks with identical content
    const offAgain = mergeThreadNoteUpdate(toggledBackOn, { modelReadable: false });
    const turn5Disabled = resolveThreadNotePromptSync(offAgain, turn4.nextDeliveredDigest, turn4.nextDeliveredImageIds);
    assert.equal(turn5Disabled.action, 'disabled');
    assert.equal(turn5Disabled.nextDeliveredDigest, undefined);
    const onAgain = mergeThreadNoteUpdate(offAgain, { modelReadable: true });
    const turn6ReEnabled = resolveThreadNotePromptSync(onAgain, turn5Disabled.nextDeliveredDigest, turn5Disabled.nextDeliveredImageIds);
    assert.equal(turn6ReEnabled.action, 'inject_initial');
    assert.ok(turn6ReEnabled.promptBlock?.includes('<conversation_note status="initial"'));
    assert.deepEqual(turn6ReEnabled.newImages, [SAMPLE_IMG_1]);
});
test('mergeThreadNoteUpdate and appendThreadNoteText default to append and continue numbered lists cleanly', () => {
    assert.equal(appendThreadNoteText('1. First item\n2. Second item', 'Third item'), '1. First item\n2. Second item\n3. Third item');
    assert.equal(appendThreadNoteText('1. First item', '1. Second item'), '1. First item\n2. Second item');
    const s0 = createThreadNoteState({ text: '1. Alpha', images: [SAMPLE_IMG_1], modelReadable: false });
    const s1 = mergeThreadNoteUpdate(s0, { text: 'Beta', images: [SAMPLE_IMG_2] });
    assert.equal(s1.text, '1. Alpha\n2. Beta');
    assert.deepEqual(s1.images.map(i => i.id), [SAMPLE_IMG_1.id, SAMPLE_IMG_2.id]);
    const sReplaced = mergeThreadNoteUpdate(s1, { mode: 'replace', text: '1. Fresh start', images: [] });
    assert.equal(sReplaced.text, '1. Fresh start');
    assert.equal(sReplaced.images.length, 0);
});
test('serializeNoteToMarkdown and parseMarkdownNoteWithImages round-trip text and images cleanly', () => {
    const state = createThreadNoteState({
        text: '1. API endpoint: /v1/notes\n2. Verify thumbnail zoom',
        images: [SAMPLE_IMG_1, { ...SAMPLE_IMG_2, filePath: '/tmp/wireframe.png' }],
        modelReadable: true
    });
    const markdown = serializeNoteToMarkdown(state);
    assert.match(markdown, /1\. API endpoint: \/v1\/notes/);
    assert.match(markdown, /!\[architecture\.png\]\(data:image\/png;base64,/);
    assert.match(markdown, /!\[wireframe\.png\]\(\/tmp\/wireframe\.png\)/);
    const parsed = parseMarkdownNoteWithImages(markdown);
    assert.equal(parsed.text, '1. API endpoint: /v1/notes\n2. Verify thumbnail zoom');
    assert.equal(parsed.imageRefs.length, 2);
    assert.equal(parsed.imageRefs[1], '/tmp/wireframe.png');
});
test('nextmux.notes.write defaults to append and nextmux.notes.read enforces modelReadable gating', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const ts = (await import('typescript')).default;
    const req = createRequire(import.meta.url);
    const appToolsSrc = readFileSync(new URL('../src/node/nextmux-app-tools.ts', import.meta.url), 'utf8');
    const transpiled = ts.transpileModule(appToolsSrc, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const appTools = {};
    const customRequire = (id) => {
        if (id === '../common/nextmux-skill-format')
            return req('../lib/common/nextmux-skill-format.js');
        if (id === './nextmux-skill-snapshot')
            return req('../lib/node/nextmux-skill-snapshot.js');
        return req(id);
    };
    Function('exports', 'require', transpiled)(appTools, customRequire);
    const tools = new Map();
    const registry = {
        register: (descriptor, handler) => {
            tools.set(descriptor.name, { descriptor, handler });
        }
    };
    const writes = [];
    let readable = false;
    appTools.registerAppTools(registry, {
        skillsRoot: '/tmp/skills',
        otherSkillRoots: [],
        installSkillFromUrl: async () => ({ id: 'x', installed: true }),
        addMcpServer: async () => ({ ok: true }),
        listMcpServers: async () => ({ ok: true, data: [] }),
        writeConversationNote: async (input) => {
            writes.push(input);
            return { ok: true, data: { updated: true, ...input } };
        },
        readConversationNote: async () => {
            if (!readable) {
                return { ok: false };
            }
            return { ok: true, data: { text: '1. Saved item', images: [] } };
        }
    });
    assert.equal(tools.get('nextmux.notes.write')?.descriptor.requiredPermission, 'read_only');
    assert.equal(tools.get('nextmux.notes.read')?.descriptor.requiredPermission, 'read_only');
    // Default mode is 'append'
    await tools.get('nextmux.notes.write').handler({ text: 'Remember this item', images: [{ path: '/tmp/a.png', name: 'a.png' }] }, {});
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0], {
        mode: 'append',
        text: 'Remember this item',
        images: [{ path: '/tmp/a.png', name: 'a.png' }]
    });
    // Reading while modelReadable is false throws NOTE_READ_DISABLED
    await assert.rejects(() => tools.get('nextmux.notes.read').handler({}, {}), /turned off "Model can read"/);
    // Reading while modelReadable is true succeeds
    readable = true;
    const readRes = await tools.get('nextmux.notes.read').handler({}, {});
    assert.equal(readRes.modelOutput.text, '1. Saved item');
    // Instructions include sticky note & AGENTS.md rules while keeping default English output ASCII-clean
    const englishInstructions = appTools.nextmuxAppInstructions('/tmp/skills');
    assert.match(englishInstructions, /nextmux\.notes\.write/);
    assert.match(englishInstructions, /appends by default/);
    assert.match(englishInstructions, /mode "replace" only when the user asks/);
    assert.match(englishInstructions, /AGENTS\.md/);
    assert.doesNotMatch(englishInstructions, /[㐀-鿿]/);
    // The user's own names arrive as UI labels from the window (see the Round 9 test below), never hard-coded per language.
    const zhInstructions = appTools.nextmuxAppInstructions('/tmp/skills', { language: 'Simplified Chinese', agentsFloat: 'AGENTS.md · 项目长期指令' });
    assert.match(zhInstructions, /the project instructions \(AGENTS\.md\) panel is “AGENTS\.md · 项目长期指令”/);
});
test('nextmux-thread-notes.tsx exports localized AGENTS.md title and localStorage state helpers', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const ts = (await import('typescript')).default;
    const req = createRequire(import.meta.url);
    const notesSrc = readFileSync(new URL('../src/browser/nextmux-thread-notes.tsx', import.meta.url), 'utf8');
    const transpiled = ts.transpileModule(notesSrc, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
    }).outputText;
    const storage = new Map();
    const dispatched = [];
    const prevWindow = globalThis.window;
    const prevCustomEvent = globalThis.CustomEvent;
    try {
        globalThis.CustomEvent = class FakeCustomEvent {
            type;
            detail;
            constructor(type, init) {
                this.type = type;
                this.detail = init?.detail;
            }
        };
        globalThis.window = {
            localStorage: {
                getItem: (k) => storage.get(k) ?? null,
                setItem: (k, v) => storage.set(k, String(v)),
                removeItem: (k) => storage.delete(k)
            },
            dispatchEvent: (ev) => {
                dispatched.push({ type: ev.type, detail: ev.detail });
                return true;
            }
        };
        const threadNotes = {};
        const customRequire = (id) => {
            if (id === '../common/nextmux-thread-notes-model')
                return model;
            if (id === '../common/nextmux-agent-instructions')
                return { AGENT_INSTRUCTIONS_MAX_CHARACTERS: 12000 };
            if (id === '@theia/core/shared/react')
                return req('react');
            return req(id);
        };
        Function('exports', 'require', transpiled)(threadNotes, customRequire);
        assert.equal(threadNotes.threadProjectAgentsTitle('zh-CN'), 'AGENTS.md · 项目长期指令');
        assert.equal(threadNotes.threadProjectAgentsTitle('en'), 'AGENTS.md · Project instructions');
        assert.equal(threadNotes.hasThreadNotes('conv-a'), false);
        // Write initial note + image (default append)
        const s1 = threadNotes.writeConversationThreadNoteState('conv-a', {
            text: '1. First note',
            images: [SAMPLE_IMG_1],
            modelReadable: true
        });
        assert.equal(s1.text, '1. First note');
        assert.equal(s1.images.length, 1);
        assert.equal(s1.modelReadable, true);
        assert.equal(s1.readableCycleId, 1);
        assert.equal(threadNotes.hasThreadNotes('conv-a'), true);
        assert.equal(dispatched.at(-1)?.type, 'nextmux:thread-note-updated');
        // Append second note line + second image without overwriting first
        const s2 = threadNotes.writeConversationThreadNoteState('conv-a', {
            text: 'Second note',
            images: [SAMPLE_IMG_2]
        });
        assert.equal(s2.text, '1. First note\n2. Second note');
        assert.equal(s2.images.length, 2);
        // Uncheck and re-check increments readableCycleId
        const s3 = threadNotes.writeConversationThreadNoteState('conv-a', { modelReadable: false });
        assert.equal(s3.modelReadable, false);
        const s4 = threadNotes.writeConversationThreadNoteState('conv-a', { modelReadable: true });
        assert.equal(s4.modelReadable, true);
        assert.equal(s4.readableCycleId, 2);
        // Forget cleans up both text and meta
        threadNotes.forgetConversationNote('conv-a');
        assert.equal(threadNotes.hasThreadNotes('conv-a'), false);
    }
    finally {
        if (prevWindow === undefined)
            delete globalThis.window;
        else
            globalThis.window = prevWindow;
        if (prevCustomEvent === undefined)
            delete globalThis.CustomEvent;
        else
            globalThis.CustomEvent = prevCustomEvent;
    }
});

// ── Round 9: sync robustness, storage limits, model-facing language and the AGENTS.md header ──
const { createRequire: createRequireR9 } = await import('node:module');
const { readFileSync: readFileSyncR9 } = await import('node:fs');
const tsR9 = (await import('typescript')).default;
const requireR9 = createRequireR9(import.meta.url);
const coreR9 = createRequireR9(requireR9.resolve('@theia/core/package.json'));
const ReactR9 = coreR9('react');
const { renderToStaticMarkup: renderR9 } = coreR9('react-dom/server');

function loadAppToolsR9() {
    const source = readFileSyncR9(new URL('../src/node/nextmux-app-tools.ts', import.meta.url), 'utf8');
    const output = tsR9.transpileModule(source, { compilerOptions: { target: tsR9.ScriptTarget.ES2022, module: tsR9.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    Function('exports', 'require', output)(exports, id => id === '../common/nextmux-skill-format' ? requireR9('../lib/common/nextmux-skill-format.js')
        : id === './nextmux-skill-snapshot' ? requireR9('../lib/node/nextmux-skill-snapshot.js') : requireR9(id));
    return exports;
}

function loadThreadNotesR9() {
    const source = readFileSyncR9(new URL('../src/browser/nextmux-thread-notes.tsx', import.meta.url), 'utf8');
    const output = tsR9.transpileModule(source, { compilerOptions: { target: tsR9.ScriptTarget.ES2022, module: tsR9.ModuleKind.CommonJS, jsx: tsR9.JsxEmit.React } }).outputText;
    const exports = {};
    Function('exports', 'require', output)(exports, id => id === '../common/nextmux-thread-notes-model' ? model
        : id === '../common/nextmux-agent-instructions' ? requireR9('../lib/common/nextmux-agent-instructions.js')
            : id === '@theia/core/shared/react' ? ReactR9 : requireR9(id));
    return exports;
}

test('digests stay fast for many large pasted images and still change with the image', () => {
    const big = `data:image/png;base64,${'A'.repeat(4_000_000)}`;
    const images = Array.from({ length: 12 }, (_, i) => ({ id: `thread-note-img:${i}`, name: `shot-${i}.png`, mimeType: 'image/png', dataUrl: big, createdAt: i }));
    const started = performance.now();
    const digest = computeThreadNoteDigest('1. Review the screenshots', images);
    assert.ok(performance.now() - started < 250, 'twelve 4 MB images are fingerprinted, not hashed byte by byte');
    assert.equal(digest.length, 32);
    assert.notEqual(computeThreadNoteDigest('1. Review the screenshots', [{ ...images[0], id: 'thread-note-img:other' }, ...images.slice(1)]), digest);
    assert.notEqual(computeThreadNoteDigest('1. Review the screenshots', [{ ...images[0], dataUrl: `${big.slice(0, -1)}B` }, ...images.slice(1)]), digest, 'the payload tail is part of the fingerprint');
});

test('note text can quote the block tag without closing the block, and no file path is invented', () => {
    const state = createThreadNoteState({ text: '1. Literal </conversation_note> and <conversation_note status="x"> in my note', modelReadable: true });
    const block = resolveThreadNotePromptSync({ state, scope: 'conv-escape' }).promptBlock;
    assert.equal(block.match(/<\/conversation_note>/g).length, 1, 'only the real closing tag remains');
    assert.match(block, /^<conversation_note status="initial" digest="[0-9a-f]{32}">\n/, 'no path attribute without a real file');
    assert.equal(stripConversationNoteBlocksFromText(`Question\n\n${block}\n\nFollow-up`), 'Question\n\nFollow-up');
    const withImage = resolveThreadNotePromptSync({ state: createThreadNoteState({ text: '1. See image', images: [SAMPLE_IMG_1], modelReadable: true }), scope: 'conv-img' }).promptBlock;
    assert.match(withImage, /- architecture\.png\n<\/conversation_note>$/, 'pasted images are listed by name, not as links to nowhere');
});

test('two conversations with identical notes keep their own re-check cycles', () => {
    const base = createThreadNoteState({ text: '1. Same note in two conversations', modelReadable: true });
    const a = mergeThreadNoteUpdate(mergeThreadNoteUpdate(base, { modelReadable: false }), { modelReadable: true });
    assert.equal(a.readableCycleId, 2);
    const firstA = resolveThreadNotePromptSync({ state: a, scope: 'conv-a' });
    const firstB = resolveThreadNotePromptSync({ state: base, scope: 'conv-b' });
    assert.equal(firstA.action, 'inject_initial');
    assert.equal(firstB.action, 'inject_initial');
    // Digest-only callers: conversation B's cycle must not make A look re-enabled again.
    assert.equal(resolveThreadNotePromptSync({ state: a, scope: 'conv-a', lastDeliveredDigest: firstA.nextDeliveredDigest }).action, 'unchanged');
    assert.equal(resolveThreadNotePromptSync({ state: base, scope: 'conv-b', lastDeliveredDigest: firstB.nextDeliveredDigest }).action, 'unchanged');
});

test('model-facing note tools are English-only; the user\'s own label names reach the model through UI labels', async () => {
    const appTools = loadAppToolsR9();
    const registered = new Map();
    appTools.registerAppTools({ register: (descriptor, handler) => registered.set(descriptor.name, { descriptor, handler }) }, {
        skillsRoot: '/tmp/skills', otherSkillRoots: [], installSkillFromUrl: async () => ({}), addMcpServer: async () => ({ ok: true }), listMcpServers: async () => ({ ok: true, data: [] }),
        readConversationNote: async () => ({ ok: true, data: { text: '1. Note', images: [
            { id: 'thread-note-img:1', name: 'architecture.png', mimeType: 'image/png', dataUrl: SAMPLE_IMG_1.dataUrl },
            { id: 'thread-note-img:2', name: 'legacy.bmp', mimeType: 'image/bmp', dataUrl: 'data:image/bmp;base64,Qk0=' }
        ], digest: 'd', updatedAt: 1 } })
    });
    for (const name of ['nextmux.notes.write', 'nextmux.notes.read']) assert.doesNotMatch(JSON.stringify(registered.get(name).descriptor), /\p{Script=Han}/u, name);
    const read = await registered.get('nextmux.notes.read').handler({}, {});
    assert.equal(read.attachments.length, 1, 'accepted image types come back as images');
    assert.equal(read.attachments[0].mimeType, 'image/png');
    assert.doesNotMatch(JSON.stringify(read.modelOutput), /base64/, 'image data is not sent as JSON text');
    assert.deepEqual(read.modelOutput.images.map(image => image.attached), [true, false]);
    const zh = appTools.nextmuxAppInstructions('/tmp/skills', appTools.sanitizeAgentUiLabels({ language: 'Simplified Chinese', notesConversation: '便签 · 本对话可见', notesReadable: '模型可读取' }));
    assert.match(zh, /the sticky note for this conversation is “便签 · 本对话可见”/);
    assert.match(zh, /the sticky note's "Model can read" checkbox is “模型可读取”/);
    const english = appTools.nextmuxAppInstructions('/tmp/skills');
    assert.doesNotMatch(english, /\p{Script=Han}/u, 'without labels the instructions carry no localized text');
});

test('a full note storage changes nothing and says so', () => {
    const storage = new Map();
    const previousWindow = globalThis.window, previousEvent = globalThis.CustomEvent;
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
    globalThis.window = { dispatchEvent() {}, localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => { if (String(value).length > 600) throw new Error('QuotaExceededError'); storage.set(key, String(value)); },
        removeItem: key => storage.delete(key)
    } };
    try {
        const notes = loadThreadNotesR9();
        notes.writeConversationThreadNoteState('conv-full', { text: '1. Kept', modelReadable: true });
        const before = [...storage.entries()];
        const large = { ...SAMPLE_IMG_1, id: 'thread-note-img:large', dataUrl: `data:image/png;base64,${'A'.repeat(2_000)}` };
        assert.throws(() => notes.writeConversationThreadNoteState('conv-full', { text: 'More', images: [large] }), /NOTE_STORAGE_FULL/);
        assert.deepEqual([...storage.entries()], before, 'neither the text nor the "Model can read" flag changed');
        assert.equal(notes.readConversationThreadNoteState('conv-full').modelReadable, true);
    } finally {
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
        if (previousEvent === undefined) delete globalThis.CustomEvent; else globalThis.CustomEvent = previousEvent;
    }
});

test('the AGENTS.md panel names the file, badges what it is and says what it does', () => {
    const notes = loadThreadNotesR9();
    const html = renderR9(ReactR9.createElement(notes.ThreadProjectAgentsFloat, {
        locale: 'zh-CN', workspaceRoot: '/work/nextmux', api: { getAgentInstructions: async () => ({}), saveAgentInstructions: async () => ({}) }
    }));
    assert.match(html, /<b class="nmx-thread-agents-name">AGENTS\.md<\/b><span class="nmx-thread-agents-badge">项目长期指令<\/span>/);
    assert.match(html, /<span class="nmx-thread-note-hint">本项目所有对话每次都会自动读取的长期规范/);
    assert.match(html, /title="AGENTS\.md · 项目长期指令"/);
    assert.doesNotMatch(html, /nmx-thread-note-agents-actions/, 'no conflict actions until a save conflicts');
});
