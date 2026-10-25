import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { projectConversationStream } from '../lib/browser/nextmux-conversation-stream-model.js';
import { isVisibleAssistantProgress, isRuntimeToolNarration } from '../lib/browser/nextmux-agent-activity.js';
import { filesChangedLabel } from '../lib/browser/nextmux-files-changed-label.js';
import { goalFileBody, goalFileObjective, isGoalFilePath } from '../lib/browser/nextmux-goal-file-format.js';
import { goalScheduleText } from '../lib/browser/nextmux-goal-schedule-locale.js';
import { localizedRuntimeToolTitle } from '../lib/browser/nextmux-runtime-title-locale.js';
import { markdownMath, texToUnicode } from '../lib/browser/nextmux-markdown-math.js';

// Conversation-core audit (2026-09-24, real app + real model): regressions for
// the defects found while driving the desktop app with a live relay.
const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const markdownit = core('@theia/core/shared/markdown-it');
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const at = n => `2026-09-24T00:00:${String(n).padStart(2, '0')}.000Z`;
const CJK = /[\u3400-\u9fff]/u;

test('runtime tool narration and fixed Chinese tool titles never reach a non-Chinese stream', () => {
    const events = [
        { type: 'model_started', turn: 1, at: at(0) },
        { type: 'assistant_progress', turn: 1, content: '接下来将修改 a.txt、修改 b.txt。', origin: 'runtime', at: at(1) },
        { type: 'tool_started', turn: 1, callId: 'list', toolName: 'workspace.list_files', summary: { title: '查看项目文件' }, at: at(2) },
        { type: 'tool_completed', turn: 1, callId: 'list', toolName: 'workspace.list_files', ok: true, status: 'succeeded',
            summary: { title: '列出 2 个工作区条目', details: ['file · a.txt', 'file · b.txt'] }, durationMs: 3, at: at(3) },
        { type: 'tool_started', turn: 1, callId: 'agent', toolName: 'agent.delegate', summary: { title: 'List all files and report back' }, at: at(4) },
        { type: 'tool_completed', turn: 1, callId: 'agent', toolName: 'agent.delegate', ok: true, status: 'succeeded',
            summary: { title: '子任务已完成', details: ['Two files.'] }, durationMs: 9, at: at(5) },
        { type: 'tool_completed', turn: 1, callId: 'memory', toolName: 'project_design.read', ok: true, status: 'succeeded',
            summary: { title: '读取项目设计规范' }, durationMs: 1, at: at(6) }
    ];
    // Japanese legitimately uses kanji; every other non-Chinese locale must show no Han characters.
    for (const locale of locales.filter(locale => !locale.startsWith('zh') && locale !== 'ja')) {
        const projection = projectConversationStream({ locale, events, running: false, terminalState: 'complete' });
        const visible = projection.items.flatMap(item => item.kind === 'text' ? [item.text] : item.kind === 'row' ? [item.title, item.target, item.meta] : [])
            .filter(Boolean).join(' | ');
        assert.doesNotMatch(visible, CJK, `${locale}: ${visible}`);
        const [list, agent] = projection.items.filter(item => item.kind === 'row');
        assert.match(list.meta, /2/, `${locale}: the listed entry count survives as a localized meta`);
        assert.equal(agent.target, 'List all files and report back', `${locale}: a finished sub-agent keeps its task as the target`);
    }
    assert.equal(projectConversationStream({ locale: 'en', events, running: false, terminalState: 'complete' })
        .items.filter(item => item.kind === 'row')[0].meta, '2 items');
    assert.equal(localizedRuntimeToolTitle('en', '读取项目设计规范'), 'Read project design notes');
    assert.equal(localizedRuntimeToolTitle('zh-CN', '读取项目设计规范'), '读取项目设计规范');
    assert.equal(localizedRuntimeToolTitle('en', 'Custom title'), undefined);
    for (const locale of locales) assert.ok(localizedRuntimeToolTitle(locale, '创建本机对话')?.trim(), locale);
    assert.equal(isRuntimeToolNarration('接下来将运行 ls -la、读取 README.md。'), true);
    assert.equal(isVisibleAssistantProgress({ content: '接下来将调用工具。', origin: 'runtime' }), false);
    assert.equal(isVisibleAssistantProgress({ content: 'I will list the files now.', origin: 'model' }), true);
});

test('the live "Calling a tool" row does not split a sentence that keeps streaming', () => {
    const delta = (text, n) => ({ type: 'assistant_delta', turn: 1, delta: text, at: at(n) });
    const events = [{ type: 'model_started', turn: 1, at: at(0) }, delta('I will delegate one task and summarize it in a', 1),
        { type: 'model_phase', turn: 1, phase: 'tool_calling', at: at(2) }, delta(' single sentence.', 3)];
    const live = projectConversationStream({ locale: 'en', events, running: true });
    assert.deepEqual(live.items.map(item => item.kind === 'row' ? item.activity : item.kind), ['text', 'model-tool_calling']);
    assert.equal(live.items[0].text, 'I will delegate one task and summarize it in a single sentence.');
});

test('"N files changed" uses the plural rules of each language', () => {
    assert.equal(filesChangedLabel('en', 1), '1 file changed');
    assert.equal(filesChangedLabel('en', 2), '2 files changed');
    assert.equal(filesChangedLabel('ru', 1), '1 файл изменён');
    assert.equal(filesChangedLabel('ru', 5), '5 файлов изменено');
    assert.equal(filesChangedLabel('fr', 1), '1 fichier modifié');
    assert.equal(filesChangedLabel('zh-CN', 1), '1 个文件已修改');
    for (const locale of locales) for (const count of [0, 1, 2, 3, 11]) assert.match(filesChangedLabel(locale, count), /\S/, locale);
});

test('goal file: localized heading, legacy files still read, goal-bar copy in every locale', () => {
    const objective = 'Create a.txt containing A\n\n## Details\nKeep it short.';
    for (const locale of locales) {
        const body = goalFileBody(locale, objective);
        assert.equal(goalFileObjective(body), objective, locale);
        if (!locale.startsWith('zh') && locale !== 'ja') assert.doesNotMatch(body, CJK, `${locale}: no Chinese scaffolding in the file`);
        for (const key of ['activeGoal', 'pausedGoal', 'completedGoal', 'openGoal', 'deleteGoal', 'goal', 'cancelGoal', 'goalFileSaveFailed', 'goalFileInvalid']) {
            assert.ok(goalScheduleText(locale, key)?.trim(), `${locale}.${key}`);
            if (!locale.startsWith('zh') && !['ja'].includes(locale)) assert.doesNotMatch(goalScheduleText(locale, key), /：/, `${locale}.${key}`);
        }
    }
    assert.equal(goalFileObjective('\n# 持续目标\n\n## 提示词\nLegacy target\n'), 'Legacy target');
    assert.equal(goalFileObjective('\n# My own heading\nkeep'), '# My own heading\nkeep', 'a user heading is part of the objective');
    assert.equal(isGoalFilePath('/w/.nextmux/goals/001c2b9f-0520-4324-8e26-e1d51bb8e487.md'), true);
    assert.equal(isGoalFilePath('C:\\w\\.nextmux\\goals\\001c2b9f-0520-4324-8e26-e1d51bb8e487.md'), true);
    assert.equal(isGoalFilePath('/w/notes.md'), false);
});

test('math: $$ / \\[ blocks and \\( / $ inline render as readable Unicode, prose dollars stay prose', () => {
    const md = markdownit({ html: false }).use(markdownMath);
    const html = md.render('Energy $E=mc^2$ and \\(a_1 + b^{2}\\).\n\n$$\n\\frac{a}{b} \\le \\sqrt{x+1}\n$$\n\n\\[ \\sum_{i=1}^{n} x_i \\]\n\nIt costs $5 and $10; set $HOME/$USER.');
    const text = value => value.replace(/<\/?i>/g, '');
    assert.match(html, /<span class="nmx-md-math-inline" role="math"[^>]*title="E=mc\^2"[^>]*><i>E<\/i>=<i>mc<\/i>²<\/span>/, 'variables are italic');
    assert.match(text(html), /<span class="nmx-md-math-inline"[^>]*>a₁ \+ b²<\/span>/);
    assert.match(text(html), /<div class="nmx-md-math" role="math"[^>]*>a\/b ≤ √\(x\+1\)<\/div>/);
    assert.match(text(html), /<div class="nmx-md-math"[^>]*>∑ᵢ₌₁ⁿ xᵢ<\/div>/);
    assert.match(md.render('$\\sin x$'), />sin <i>x<\/i></, 'function names stay upright');
    assert.match(html, /It costs \$5 and \$10; set \$HOME\/\$USER\./, 'currency and shell variables are not math');
    assert.doesNotMatch(md.render('`$x^2$` stays code'), /nmx-md-math/, 'code spans win');
    assert.equal(texToUnicode('\\alpha \\to \\infty, x^{-1}, \\mathbb{R}'), 'α → ∞, x⁻¹, ℝ');
    assert.equal(texToUnicode('\\begin{cases} x + y = 1 \\\\ x - y = 0 \\end{cases}'), '{ x + y = 1; x - y = 0');
    assert.equal(texToUnicode('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'), '(a, b; c, d)');
    assert.equal(texToUnicode('\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}'), '[1, 0; 0, 1]');
    assert.equal(texToUnicode('\\begin{aligned} f(x) &= x^2 \\\\ g(x) &= \\sqrt[3]{x} \\end{aligned}'), 'f(x) = x²; g(x) = ∛x');
    assert.equal(texToUnicode('\\binom{n}{k} \\equiv 1 \\pmod{p}, \\mathcal{O}(n \\log n)'), 'C(n, k) ≡ 1 (mod p), 𝒪(n log n)');
    assert.match(md.render('<b>$x$</b>'), /&lt;b&gt;/, 'raw HTML stays escaped');
    assert.match(md.render('$<img src=x onerror=alert(1)>$'), /&lt;img/, 'math content is escaped');
});

test('the surface translator never rewrites editor, terminal or literal content', { timeout: 60000 }, async t => {
    const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
    const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const { outputFiles } = await desktop('esbuild').build({
        entryPoints: [fileURLToPath(new URL('../src/browser/nextmux-surface-walk.ts', import.meta.url))],
        bundle: true, write: false, format: 'iife', globalName: 'surfaceWalk', platform: 'browser'
    });
    await page.setContent(`<main><button>目标</button><div class="monaco-editor"><div class="view-line"><span># 持续目标</span></div></div>
        <div class="xterm"><div class="xterm-rows"><div>目标</div></div></div><p data-nmx-literal><span>目标</span></p><small>打开目标</small></main>`);
    await page.addScriptTag({ content: outputFiles[0].text });
    const visited = await page.evaluate(() => {
        const texts = [];
        window.surfaceWalk.forEachSurfaceTextNode(document.querySelector('main'), node => { if (node.data.trim()) texts.push(node.data); });
        return { texts, literal: window.surfaceWalk.isSurfaceLiteral(document.querySelector('.view-line span')) };
    });
    assert.deepEqual(visited.texts, ['目标', '打开目标']);
    assert.equal(visited.literal, true);
});

test('auto-follow sticks to the bottom when content grows; only a user scroll leaves it', async () => {
    const { readFileSync } = await import('node:fs');
    const ts = (await import('typescript')).default;
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const members = ['notifyThreadContentChanged', 'threadUserScrolledRecently', 'noteThreadUserScrollIntent', 'onThreadAtBottomStateChange']
        .map(name => widget.members.find(node => node.name?.getText(file) === name).getText(file)).join('\n');
    const Harness = new Function('window', ts.transpile(`class Harness { ${members} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(
        { addEventListener() {}, removeEventListener() {} });
    const make = () => {
        const calls = { autoscroll: 0, follow: 0 };
        const view = Object.assign(new Harness(), {
            activeCodingSessionId: 's', activeSection: 'coding', codingPanel: 'thread', threadBottomFollowActive: false, threadAwayFromBottom: false,
            threadUnseenUpdates: 0, threadScrollRestoreActive: false, threadUserScrollIntentAt: 0, threadPointerScrolling: false,
            // A 900 px code block just arrived: geometrically far from the bottom.
            node: { querySelector: () => ({ scrollHeight: 2_000, scrollTop: 500, clientHeight: 600 }) },
            threadVirtuosoRef: { current: { autoscrollToBottom: () => { calls.autoscroll++; } } },
            scheduleThreadBottomFollow: () => { calls.follow++; }, setActiveThreadMarker: () => false, latestThreadTurnId: () => 't', update() {}
        });
        return { view, calls };
    };
    const grown = make();
    grown.view.notifyThreadContentChanged('s');
    assert.equal(grown.view.threadAwayFromBottom, false, 'growth alone keeps following');
    assert.deepEqual(grown.calls, { autoscroll: 1, follow: 1 });
    grown.view.onThreadAtBottomStateChange(false);
    assert.equal(grown.view.threadAwayFromBottom, false);
    assert.equal(grown.calls.follow, 2, 'Virtuoso reporting "not at bottom" after growth re-follows');
    const scrolled = make();
    scrolled.view.noteThreadUserScrollIntent();
    scrolled.view.notifyThreadContentChanged('s');
    assert.equal(scrolled.view.threadAwayFromBottom, true, 'a user scroll leaves the bottom');
    assert.equal(scrolled.view.threadUnseenUpdates, 1, 'new output is announced by the jump-to-bottom dot');
    assert.deepEqual(scrolled.calls, { autoscroll: 0, follow: 0 });
});
