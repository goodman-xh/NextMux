import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Real-Chromium render of the production conversation stream components with
// the production stylesheets, in light/dark, zh-CN/en and narrow/wide.
const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const { build } = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url))('esbuild');
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const shots = '/tmp/nm-stream';

async function serve(t) {
    const bundle = await build({ entryPoints: [fileURLToPath(new URL('conversation-stream-fixture.tsx', import.meta.url))], bundle: true, write: false,
        platform: 'browser', format: 'iife', jsx: 'transform', logLevel: 'silent', loader: { '.json': 'json' },
        alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client'), 'markdown-it': core.resolve('markdown-it') } });
    const css = (await Promise.all(['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-conversation-stream.css']
        .map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')))).join('\n');
    const [iconCss, iconFont] = await Promise.all([readFile(core.resolve('@vscode/codicons/dist/codicon.css'), 'utf8'), readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))]);
    const html = `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/codicon.css'><link rel='stylesheet' href='/app.css'><style>
html,body,.nmx-desktop-widget{margin:0;width:100%;min-height:100%;font:14px system-ui}
.nmx-shell{min-height:100vh;display:block!important}
.fixture-workspace{display:block!important;padding:28px 16px 40px;box-sizing:border-box}
.fixture-transcript{width:100%;max-width:710px;margin:auto;overflow:visible!important;height:auto!important}
.fixture-sidebar{display:flex;align-items:center;gap:8px;margin:0 0 18px;color:var(--nmx-subtle);font-size:13px}
.fixture-terminal{margin:0;padding:8px 10px;border-radius:8px;background:rgba(127,127,127,.12);font:12px ui-monospace,monospace;white-space:pre-wrap}
.fixture-balance{margin-top:16px}
</style></head><body><div id='fixture'></div><script src='/fixture.js'></script></body></html>`;
    const server = createServer((request, response) => {
        const path = new URL(request.url, 'http://127.0.0.1').pathname;
        const entry = path === '/fixture.js' ? ['text/javascript', bundle.outputFiles[0].contents] : path === '/app.css' ? ['text/css', css]
            : path === '/codicon.css' ? ['text/css', iconCss] : path.startsWith('/codicon.ttf') ? ['font/ttf', iconFont] : ['text/html', html];
        response.writeHead(200, { 'content-type': entry[0] }); response.end(entry[1]);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

async function openPage(browser, origin) {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => { if (request.url().startsWith(origin)) void request.continue(); else void request.abort(); });
    return page;
}

// Finite animations only: running rows keep an infinite shimmer by design.
const settle = page => page.evaluate(async () => {
    await Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined)));
    // Let React commit the state changes scheduled by animationend handlers.
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
});

test('conversation stream renders ordered one-line status rows, readable browser steps and full body text', { timeout: 120000 }, async t => {
    await mkdir(shots, { recursive: true });
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const origin = await serve(t);
    const page = await openPage(browser, origin);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const expected = {
        en: { browser: ['Opened example.com', 'Clicked “Sign in”', 'Typed into Email'], edited: 'Edited', ran: 'Ran', compacted: 'Context compacted',
            compacting: 'Compacting context', thought: 'Thought', resumed: 'Resumed', approval: 'Approved', paused: 'Paused', error: 'The model request timed out. Wait a moment and try again.' },
        'zh-CN': { browser: ['已打开 example.com', '已点击“登录”', '已填写 Email'], edited: '已编辑', ran: '已运行', compacted: '上下文已自动压缩',
            compacting: '正在自动压缩上下文', thought: '已思考', resumed: '已继续', approval: '已授权', paused: '已暂停', error: '模型请求超时。 请稍后重试。' }
    };
    for (const locale of ['en', 'zh-CN']) for (const theme of ['dark', 'light']) for (const width of [1100, 390]) {
        const label = `${locale} ${theme} ${width}px`;
        await page.setViewport({ width, height: 1300 });
        await page.goto(`${origin}/?locale=${locale}&theme=${theme}`, { waitUntil: 'load' });
        await page.waitForSelector('.nmx-stream-row');
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        const view = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.nmx-stream-row')].map(row => {
                const trigger = row.querySelector('.nmx-stream-trigger');
                return { kind: row.dataset.activityKind, text: trigger.textContent.replace(/\s+/g, ' ').trim(),
                    height: trigger.getBoundingClientRect().height, overflow: row.scrollWidth - row.clientWidth,
                    color: getComputedStyle(row.querySelector('.nmx-stream-title')).color };
            });
            const prose = [...document.querySelectorAll('.nmx-stream-text')].map(node => ({ text: node.textContent.trim(),
                size: getComputedStyle(node).fontSize, lineHeight: parseFloat(getComputedStyle(node).lineHeight) / parseFloat(getComputedStyle(node).fontSize),
                color: getComputedStyle(node).color, collapsed: Boolean(node.closest('details,.nmx-collapsible-message')) }));
            const bubble = document.querySelector('.nmx-user-message'), turn = document.querySelector('.nmx-task-turn');
            return { rows, prose, bubbleWidth: bubble.getBoundingClientRect().width, turnWidth: turn.getBoundingClientRect().width,
                actions: [...bubble.querySelectorAll('.nmx-user-message-actions > button')].map(button => button.dataset.messageAction),
                notice: document.querySelector('.nmx-stream-notice')?.textContent.trim(),
                diffstat: document.querySelector('[data-activity-kind="file-updated"] .nmx-stream-diffstat')?.textContent,
                pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                text: document.querySelector('.nmx-stream').textContent };
        });
        const copy = expected[locale];
        assert.deepEqual(view.rows.map(row => row.kind), ['reasoning', 'file-read', 'file-updated', 'command', 'browser', 'browser', 'browser',
            'agent', 'permission', 'context-compaction', 'resumed', 'paused'], label);
        for (const phrase of copy.browser) assert.ok(view.rows.some(row => row.text.startsWith(phrase)), `${label}: ${phrase} in ${JSON.stringify(view.rows.map(row => row.text))}`);
        assert.doesNotMatch(view.text, /浏览器[:：]|browser_|MCP[:：]|\bclick\b|\bfill\b|\bselect\b/, `${label}: no raw browser action names`);
        assert.ok(view.rows.find(row => row.kind === 'file-updated').text.startsWith(copy.edited), label);
        assert.ok(view.rows.find(row => row.kind === 'command').text.includes('npm test'), label);
        assert.ok(view.rows.find(row => row.kind === 'context-compaction').text.startsWith(copy.compacted), label);
        assert.ok(view.rows.find(row => row.kind === 'reasoning').text.startsWith(copy.thought), label);
        assert.ok(view.rows.find(row => row.kind === 'resumed').text.startsWith(copy.resumed), label);
        assert.equal(view.rows.find(row => row.kind === 'permission').text, `${copy.approval} git push origin main`, `${label}: approval resolves in place`);
        assert.equal(view.diffstat, '+3−1', label);
        for (const row of view.rows) {
            assert.ok(row.height <= 28, `${label}: ${row.kind} stays one line (${row.height}px)`);
            assert.ok(row.overflow <= 1, `${label}: ${row.kind} does not overflow`);
        }
        assert.equal(new Set(view.rows.filter(row => row.kind !== 'paused').map(row => row.color)).size, 1, `${label}: status rows share one muted color`);
        assert.equal(view.prose.length, 2, label);
        for (const prose of view.prose) {
            assert.equal(prose.size, '15px', label);
            assert.ok(prose.lineHeight >= 1.5 && prose.lineHeight <= 1.7, `${label}: normal body line height`);
            assert.equal(prose.collapsed, false, `${label}: body text is never collapsed`);
            assert.notEqual(prose.color, view.rows[0].color, `${label}: body text is not muted like a status row`);
        }
        assert.ok(view.bubbleWidth < view.turnWidth * 0.6, `${label}: a short prompt bubble follows its content`);
        assert.deepEqual(view.actions, ['copy', 'edit'], `${label}: only Copy and Edit under a user message`);
        assert.equal(view.notice, copy.error, `${label}: raw error text is replaced by one localized sentence`);
        assert.equal(await page.$eval('.nmx-stream-notice', node => node.getAttribute('role')), 'status', `${label}: a historical failure does not raise an alert`);
        assert.ok(view.pageOverflow <= 0, `${label}: no horizontal page scroll`);
        await page.screenshot({ path: `${shots}/stream-${locale}-${theme}-${width}.png`, fullPage: true });

        // Expanding a row animates its height, then returns to auto.
        const edit = '[data-activity-kind="file-updated"] .nmx-stream-trigger';
        await page.click(edit);
        const mid = await page.evaluate(async () => {
            await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 60)));
            const region = document.querySelector('[data-activity-kind="file-updated"] .nmx-stream-collapse');
            return { height: region.getBoundingClientRect().height, full: region.scrollHeight,
                animations: region.getAnimations().length, expanded: document.querySelector('[data-activity-kind="file-updated"] .nmx-stream-trigger').getAttribute('aria-expanded') };
        });
        assert.equal(mid.expanded, 'true', label);
        assert.ok(mid.animations >= 1 && mid.height > 0 && mid.height < mid.full, `${label}: details grow with a height transition (${JSON.stringify(mid)})`);
        await settle(page);
        const open = await page.$eval('[data-activity-kind="file-updated"] .nmx-stream-collapse', node => ({ height: node.style.height, lines: node.querySelectorAll('.is-add').length }));
        assert.equal(open.height, '', `${label}: settled details return to auto height`);
        assert.equal(open.lines, 3, label);
        if (width === 1100) await page.screenshot({ path: `${shots}/stream-${locale}-${theme}-expanded.png`, fullPage: true });
        // Observe the actual WAAPI cancellation boundary, before React can
        // unmount. Checking only the final DOM misses a one-frame full-height
        // flash when a forwards-filled closing animation is cancelled.
        await page.evaluate(() => {
            window.__streamCloseCancellation = [];
            const cancel = Animation.prototype.cancel;
            window.__restoreStreamAnimationCancel = () => { Animation.prototype.cancel = cancel; };
            Animation.prototype.cancel = function (...args) {
                const target = this.effect?.target;
                const closing = target?.classList?.contains('nmx-stream-collapse')
                    && this.effect.getKeyframes().at(-1)?.height === '0px';
                const before = closing ? target.getBoundingClientRect().height : undefined;
                const result = cancel.apply(this, args);
                if (closing) window.__streamCloseCancellation.push({ before, after: target.getBoundingClientRect().height });
                return result;
            };
        });
        await page.click(edit);
        await settle(page);
        const cancellation = await page.evaluate(() => {
            window.__restoreStreamAnimationCancel();
            return window.__streamCloseCancellation;
        });
        assert.equal(cancellation.length, 1, `${label}: one completed close animation`);
        assert.ok(cancellation.every(sample => sample.before <= 1 && sample.after <= 1),
            `${label}: closing stays closed before React unmount (${JSON.stringify(cancellation)})`);
        assert.equal(await page.$('[data-activity-kind="file-updated"] .nmx-stream-collapse'), null, `${label}: collapsed details unmount after the transition`);

        if (width !== 1100) continue;
        // Compacting → compacted cross-fades in place.
        await page.evaluate(() => window.fixture.set({ compacting: true }));
        await settle(page);
        assert.equal(await page.$eval('[data-activity-kind="context-compaction"] .nmx-stream-title', node => node.textContent), copy.compacting, label);
        // Freeze the 200ms cross-fade on its first committed frame so a loaded machine cannot race it.
        const swap = await page.evaluate(async () => {
            window.fixture.set({ compacting: false });
            for (let attempt = 0; attempt < 50; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 0));
                const node = document.querySelector('[data-activity-kind="context-compaction"] .nmx-stream-swap');
                if (!node?.querySelector('.nmx-stream-swap-in')) continue;
                const animations = node.getAnimations({ subtree: true });
                animations.forEach(animation => animation.pause());
                const result = { out: node.querySelector('.nmx-stream-swap-out')?.textContent, in: node.querySelector('.nmx-stream-swap-in')?.textContent,
                    fading: animations.length };
                animations.forEach(animation => animation.play());
                return result;
            }
            return undefined;
        });
        assert.ok(swap?.fading >= 2, `${label}: both labels animate (${JSON.stringify(swap)})`);
        delete swap.fading;
        assert.deepEqual(swap, { out: copy.compacting, in: copy.compacted }, `${label}: status label cross-fades`);
        await settle(page);
        assert.equal(await page.$('.nmx-stream-swap-out'), null, label);

        // Streaming appends re-render only the live tail block.
        await page.evaluate(() => window.fixture.set({ live: true, streamText: 'First paragraph.\n\nSecond' }));
        await settle(page);
        const before = await page.evaluate(() => window.__markdownRenders);
        for (const suffix of [' paragraph', ' keeps', ' streaming.']) {
            await page.evaluate(value => window.fixture.set({ streamText: `First paragraph.\n\nSecond${value}` }), suffix);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        }
        const after = await page.evaluate(() => window.__markdownRenders);
        assert.equal(after - before, 3, `${label}: each append re-renders only the live tail block, never the settled one (${after - before})`);
        assert.equal(await page.$$eval('.nmx-stream-text.is-streaming .nmx-assistant-markdown', nodes => nodes.length), 2, label);
        await page.screenshot({ path: `${shots}/stream-${locale}-${theme}-live.png`, fullPage: true });
        await page.evaluate(() => window.fixture.set({ live: false }));

        // Unread dot fades out before it unmounts.
        await page.evaluate(() => window.fixture.set({ dotVisible: false }));
        assert.match(await page.$eval('.nmx-session-terminal-dot', node => node.className), /nmx-presence-exit/, label);
        await settle(page);
        assert.equal(await page.$('.nmx-session-terminal-dot'), null, label);

        // Branch dialog: overlay covers the whole app, dialog fades and scales in.
        await page.evaluate(() => window.fixture.openDialog());
        const dialog = await page.evaluate(() => {
            const backdrop = document.querySelector('.nmx-branch-backdrop').getBoundingClientRect();
            const node = document.querySelector('.nmx-branch-dialog');
            return { backdrop: [backdrop.left, backdrop.top, backdrop.width, backdrop.height], animation: getComputedStyle(node).animationName,
                position: getComputedStyle(document.querySelector('.nmx-branch-backdrop')).position, buttons: node.querySelectorAll('footer > button').length };
        });
        assert.deepEqual(dialog.backdrop, [0, 0, width, 1300], `${label}: overlay covers the app`);
        assert.equal(dialog.position, 'fixed');
        assert.equal(dialog.animation, 'nmx-dialog-in');
        assert.equal(dialog.buttons, 3);
        await settle(page);
        await page.screenshot({ path: `${shots}/branch-dialog-${locale}-${theme}.png` });
    }
    assert.deepEqual(errors, []);
});

test('reduced motion expands details immediately without animations', { timeout: 60000 }, async t => {
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const origin = await serve(t);
    const page = await openPage(browser, origin);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setViewport({ width: 900, height: 1200 });
    await page.goto(`${origin}/?locale=en&theme=dark`, { waitUntil: 'load' });
    await page.waitForSelector('.nmx-stream-row');
    await page.click('[data-activity-kind="command"] .nmx-stream-trigger');
    const state = await page.$eval('[data-activity-kind="command"] .nmx-stream-collapse', node => ({ animations: node.getAnimations().length, text: node.textContent }));
    assert.equal(state.animations, 0);
    assert.match(state.text, /npm test -- --grep resume[\s\S]*resume replays checkpoint/);
    // An expanded terminal follows a light/dark switch (the row memo compares the theme).
    assert.equal(await page.$eval('[data-activity-kind="command"] .fixture-terminal', node => node.dataset.theme), 'dark');
    await page.evaluate(() => window.fixture.set({ appTheme: 'light' }));
    await page.waitForFunction(() => document.querySelector('[data-activity-kind="command"] .fixture-terminal')?.dataset.theme === 'light', { timeout: 5000 });
    await page.evaluate(() => window.fixture.set({ appTheme: 'dark' }));
    const mouse = await page.$eval('[data-activity-kind="command"] .nmx-stream-trigger', node => getComputedStyle(node).outlineStyle);
    assert.equal(mouse, 'none', 'a mouse click leaves no focus frame');
    // Keyboard: rows are reachable with Tab, show a visible focus ring and toggle with Enter.
    await page.evaluate(() => document.activeElement?.blur());
    let focused;
    for (let index = 0; index < 30; index++) {
        await page.keyboard.press('Tab');
        focused = await page.evaluate(() => {
            const node = document.activeElement;
            return node?.matches('.nmx-stream-trigger[aria-expanded]') ? { kind: node.closest('.nmx-stream-row').dataset.activityKind,
                visible: node.matches(':focus-visible'), outline: parseFloat(getComputedStyle(node).outlineWidth), expanded: node.getAttribute('aria-expanded') } : undefined;
        });
        if (focused) break;
    }
    assert.ok(focused && focused.visible && focused.outline >= 1, `keyboard focus ring: ${JSON.stringify(focused)}`);
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval(`[data-activity-kind="${focused.kind}"] .nmx-stream-trigger`, node => node.getAttribute('aria-expanded')),
        focused.expanded === 'true' ? 'false' : 'true', 'Enter toggles the focused row');
});

test('RTL and CJK locales keep one-line rows at narrow width', { timeout: 60000 }, async t => {
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const origin = await serve(t);
    const page = await openPage(browser, origin);
    for (const locale of ['ar', 'ja', 'ru', 'hi']) {
        await page.setViewport({ width: 390, height: 1200 });
        await page.goto(`${origin}/?locale=${locale}&theme=light`, { waitUntil: 'load' });
        await page.waitForSelector('.nmx-stream-row');
        await settle(page);
        const view = await page.evaluate(() => ({
            rows: [...document.querySelectorAll('.nmx-stream-row')].map(row => ({ height: row.querySelector('.nmx-stream-trigger').getBoundingClientRect().height,
                overflow: row.scrollWidth - row.clientWidth, text: row.textContent })),
            dir: getComputedStyle(document.querySelector('.nmx-stream')).direction,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
        assert.equal(view.dir, locale === 'ar' ? 'rtl' : 'ltr', locale);
        for (const row of view.rows) {
            assert.ok(row.height <= 28 && row.overflow <= 1, `${locale}: ${row.text}`);
            assert.doesNotMatch(row.text, /\{[qt]\}|browser_|\bclick\b/, locale);
        }
        assert.ok(view.pageOverflow <= 0, locale);
        await page.screenshot({ path: `${shots}/stream-${locale}-light-390.png`, fullPage: true });
    }
});
