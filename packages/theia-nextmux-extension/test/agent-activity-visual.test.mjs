import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import activity from '../lib/browser/nextmux-agent-activity.js';
import { projectConversationStream } from '../lib/browser/nextmux-conversation-stream-model.js';
import { ConversationStream } from '../lib/browser/nextmux-conversation-stream.js';
import { runningTaskText } from '../lib/browser/nextmux-running-task-locale.js';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';
import { agentChildText } from '../lib/browser/nextmux-agent-child-locale.js';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const markdown = core('markdown-it')({ html: false });
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

test('production activity rows stay frameless across themes while details and restore remain wired', { timeout: 30000 }, async t => {
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methods = ['renderAgentActivity', 'renderAgentChildLinks', 'agentChildStatusIcon', 'agentChildStatusLabel'].map(name => {
        const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
        assert.ok(method, `production method ${name}`);
        return method.getText(file);
    });
    const dependencies = { ...activity, React, runningTaskText, localizeDesktopSurface, agentChildText, projectConversationStream, ConversationStream };
    const Fixture = new Function(...Object.keys(dependencies), ts.transpile(`class Fixture { ${methods.join('\n')} }; return Fixture;`, {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React
    }))(...Object.values(dependencies));
    const fixture = Object.assign(new Fixture(), { desktopLocale: 'zh-CN', handleAssistantContentClick() {}, openToolFileActivity() {},
        renderAgentCommandTerminal: () => null, renderSteeringActivity: () => null, resolvedDesktopTheme: () => 'dark',
        // Theia's Markdown component fills its host after mount. The fixture
        // supplies that same markdown-it output so CSS measures real blocks.
        renderAssistantResponse: value => React.createElement('div', { className: 'nmx-assistant-markdown',
            dangerouslySetInnerHTML: { __html: markdown.render(value) } }) });
    const at = index => `2026-09-23T00:00:${String(index).padStart(2, '0')}.000Z`;
    const events = [
        { type: 'provider_reasoning', turn: 1, itemId: 'thought', visibility: 'visible', status: 'complete',
            content: '先检查文件版本，再核对恢复记录与当前文件是否一致。', at: at(0) },
        { type: 'provider_reasoning', turn: 1, itemId: 'private', visibility: 'hidden', status: 'complete',
            content: 'HIDDEN_REASONING_MUST_NOT_RENDER', at: at(0) },
        { type: 'assistant_progress', turn: 1, origin: 'model', content: '我会核对当前改动与测试结果。\n\n正文保持展开，操作细节按需查看。', at: at(0) },
        { type: 'tool_completed', callId: 'read', toolName: 'workspace.read', ok: true, summary: {
            title: '已读取文件', details: [], resource: { kind: 'file', action: 'read', path: '/project/src/main.ts' }
        }, at: at(1) },
        { type: 'tool_completed', callId: 'check', toolName: 'workspace.inspect', ok: true, summary: {
            title: '工作区检查', checkpointId: 'fixture-checkpoint', details: ['已核对项目目录和文件修改记录。', '未发现未保存的修改。']
        }, at: at(2) },
        { type: 'tool_completed', callId: 'agent', toolName: 'agent.delegate', ok: true, summary: {
            title: '已调用子智能体', details: ['界面检查已完成。']
        }, at: at(3) },
        { type: 'tool_completed', callId: 'browser', toolName: 'mcp.playwright.browser_snapshot', ok: true, summary: {
            title: 'MCP：playwright / browser_snapshot', details: ['返回 1 个内容块']
        }, at: at(3) },
        { type: 'context_compaction_started', turn: 1, segment: 1, at: at(3) },
        { type: 'context_compaction_completed', turn: 1, segment: 1, messagesBefore: 64, messagesAfter: 20, at: at(4) },
        { type: 'model_phase', phase: 'thinking', turn: 2, at: at(5) }
    ];
    const markup = renderToStaticMarkup(fixture.renderAgentActivity(events, true, false, 'visual-fixture'));
    const children = renderToStaticMarkup(fixture.renderAgentChildLinks([{ childRunId: 'child-a', task: '检查恢复与分支', status: 'completed', events: [], eventCount: 42 }]));
    assert.doesNotMatch(markup, /HIDDEN_REASONING_MUST_NOT_RENDER/);
    // Visible reasoning is a collapsed status row: shimmering while it streams, settled afterwards.
    const staleThinking = [{ type: 'provider_reasoning', turn: 1, itemId: 'thought', visibility: 'visible', status: 'streaming', content: '真实可见思考', at: at(0) }];
    const live = renderToStaticMarkup(fixture.renderAgentActivity(staleThinking, true));
    const settled = renderToStaticMarkup(fixture.renderAgentActivity(staleThinking, true, false, 'settled', 'complete'));
    assert.match(live, /data-activity-kind="reasoning"[\s\S]*nmx-stream-shimmer[\s\S]*正在思考/);
    assert.doesNotMatch(settled, /nmx-stream-shimmer|is-streaming|nmx-stream-caret/);
    assert.match(settled, /已思考/);
    assert.equal((markup.match(/data-activity-kind="context-compaction"/g) || []).length, 1);
    assert.doesNotMatch(markup, /正在自动压缩上下文/);
    assert.match(markup, /上下文已自动压缩/);
    const restored = [];
    fixture.restoreCheckpoint = id => restored.push(id);
    const stream = fixture.renderAgentActivity(events, true);
    stream.props.onRestore('fixture-checkpoint');
    assert.deepEqual(restored, ['fixture-checkpoint']);
    assert.match(markup, /class="nmx-stream-action nmx-file-activity-restore"[^>]*aria-label="恢复"/);
    // The actual renderer and stylesheet order are used.
    const [desktopCss, productionCss, streamCss, iconCss, iconFont] = await Promise.all([
        readFile(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/browser/style/nextmux-conversation-stream.css', import.meta.url), 'utf8'),
        readFile(core.resolve('@vscode/codicons/dist/codicon.css'), 'utf8'),
        readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))
    ]);
    const html = `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/codicon.css'><link rel='stylesheet' href='/nextmux.css'><link rel='stylesheet' href='/production.css'><link rel='stylesheet' href='/stream.css'><style>
html,body,.nmx-desktop-widget{margin:0;width:100%;height:100%;font:14px system-ui}
.fixture-workspace{grid-column:1/-1;padding:48px 20px}.fixture-transcript{width:100%;max-width:710px;margin:auto}
</style></head><body><div class='nmx-desktop-widget'><div class='nmx-shell nmx-theme-dark'><main class='nmx-workspace fixture-workspace'><div class='fixture-transcript'><div class='nmx-agent-message'>${children}${markup}</div></div></main></div></div></body></html>`;
    const server = createServer((request, response) => {
        const entry = request.url === '/nextmux.css' ? ['text/css', desktopCss]
            : request.url === '/production.css' ? ['text/css', productionCss]
                : request.url === '/stream.css' ? ['text/css', streamCss]
                    : request.url === '/codicon.css' ? ['text/css', iconCss]
                        : request.url?.startsWith('/codicon.ttf') ? ['font/ttf', iconFont] : ['text/html', html];
        response.writeHead(200, { 'content-type': entry[0], 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'" });
        response.end(entry[1]);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (new URL(request.url()).origin === origin) void request.continue();
        else { errors.push(`Unexpected external request: ${new URL(request.url()).origin}`); void request.abort(); }
    });
    for (const theme of ['dark', 'light']) {
        for (const width of [1100, 390]) {
            await page.setViewport({ width, height: 650 });
            await page.goto(origin, { waitUntil: 'load' });
            await page.$eval('.nmx-shell', (shell, value) => { shell.className = `nmx-shell nmx-theme-${value}`; }, theme);
            const styles = await page.$$eval('.nmx-stream-row', rows => rows.map(row => {
                const style = getComputedStyle(row);
                return { kind: row.dataset.activityKind, borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(style[`border${side}Width`])),
                    background: style.backgroundColor, overflow: row.scrollWidth - row.clientWidth,
                    iconColor: getComputedStyle(row.querySelector('.nmx-stream-icon')).color,
                    height: row.querySelector('.nmx-stream-trigger').getBoundingClientRect().height };
            }));
            assert.deepEqual(styles.map(row => row.kind), ['reasoning', 'file-read', 'workspace', 'agent', 'browser', 'context-compaction', 'model-thinking']);
            for (const row of styles) {
                assert.deepEqual(row.borders, [0, 0, 0, 0], `${theme} ${width}px ${row.kind}: an ordinary status must not acquire a full-width frame`);
                assert.equal(row.background, 'rgba(0, 0, 0, 0)', `${theme} ${row.kind}: ordinary rows retain the transcript background`);
                assert.ok(row.overflow <= 1, `${theme} ${width}px ${row.kind}: row overflows`);
                assert.ok(row.height <= 28, `${theme} ${width}px ${row.kind}: one-line status row`);
            }
            assert.equal(new Set(styles.map(row => row.iconColor)).size, 1, `${theme}: normal status icons share a neutral theme color`);
            const rhythm = await page.evaluate(() => {
                const prose = document.querySelector('.nmx-stream-text .nmx-assistant-markdown');
                const restore = document.querySelector('.nmx-file-activity-restore');
                const child = document.querySelector('.nmx-agent-child-link');
                const browserRow = document.querySelector('[data-activity-tool="mcp.playwright.browser_snapshot"]');
                return { prose: getComputedStyle(prose).fontSize,
                    proseMargin: getComputedStyle(prose.querySelector('p')).marginBottom, proseLast: prose.querySelector('p') === prose.lastElementChild,
                    proseCollapsed: !!prose.closest('details,.nmx-collapsible-message'),
                    restoreBorder: getComputedStyle(restore).borderWidth, restoreBackground: getComputedStyle(restore).backgroundColor,
                    childText: child.textContent, childTitle: child.title, childHeight: child.getBoundingClientRect().height,
                    childWidth: child.scrollWidth - child.clientWidth, browserTitle: browserRow.textContent,
                    details: document.querySelectorAll('.nmx-stream-collapse').length,
                    expanders: [...document.querySelectorAll('button.nmx-stream-trigger[aria-expanded]')].map(node => node.getAttribute('aria-expanded')) };
            });
            assert.equal(rhythm.prose, '15px');
            // Markdown rhythm (Primer): 10px between blocks, no trailing gap after the last block.
            assert.equal(rhythm.proseMargin, rhythm.proseLast ? '0px' : '10px'); assert.equal(rhythm.proseCollapsed, false);
            assert.equal(rhythm.restoreBorder, '0px'); assert.equal(rhythm.restoreBackground, 'rgba(0, 0, 0, 0)');
            assert.match(rhythm.childText, /已完成/); assert.doesNotMatch(rhythm.childText, /42/);
            assert.match(rhythm.childTitle, /42/); assert.ok(rhythm.childHeight <= 30); assert.ok(rhythm.childWidth <= 1);
            assert.match(rhythm.browserTitle, /已读取页面/);
            assert.doesNotMatch(rhythm.browserTitle, /MCP[:：]|browser_snapshot|playwright/);
            assert.equal(rhythm.details, 0, `${theme}: details stay collapsed until requested`);
            assert.ok(rhythm.expanders.length >= 3 && rhythm.expanders.every(value => value === 'false'));
            if (width === 1100) await page.screenshot({ path: `/tmp/nm-activity-${theme}-collapsed.png` });
        }
    }
    assert.deepEqual(errors, []);
});
