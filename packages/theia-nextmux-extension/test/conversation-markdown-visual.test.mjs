import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Real-Chromium render of production reply Markdown inside the production
// conversation stream: markdown-it + DOMPurify + Monaco Monarch tokens, the
// production stylesheets, light/dark, en/zh-CN/ar and narrow/wide.
const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const { build } = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url))('esbuild');
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const shots = '/tmp/nm-markdown';

async function serve(t) {
    const bundle = await build({ entryPoints: [fileURLToPath(new URL('conversation-markdown-fixture.tsx', import.meta.url))], bundle: true, write: false,
        platform: 'browser', format: 'iife', jsx: 'transform', logLevel: 'silent', loader: { '.json': 'json', '.css': 'empty', '.ttf': 'empty' },
        alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client') } });
    const css = (await Promise.all(['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-conversation-stream.css', 'nextmux-markdown.css']
        .map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')))).join('\n');
    const [iconCss, iconFont] = await Promise.all([readFile(core.resolve('@vscode/codicons/dist/codicon.css'), 'utf8'), readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))]);
    const html = `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/codicon.css'><link rel='stylesheet' href='/app.css'><style>
html,body,.nmx-desktop-widget{margin:0;width:100%;min-height:100%;font:14px system-ui}
.nmx-shell{min-height:100vh;display:block!important}
.fixture-workspace{display:block!important;padding:28px 16px 40px;box-sizing:border-box}
.fixture-transcript{width:100%;max-width:710px;margin:auto;overflow:visible!important;height:auto!important}
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
    // Favicons and remote images are never fetched in the test.
    page.on('request', request => { if (request.url().startsWith(origin)) void request.continue(); else void request.abort(); });
    return page;
}

const settle = page => page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined)));
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
});

test('reply Markdown: literal text, typographic scale, highlighted code with copy, tables, task lists and links', { timeout: 180000 }, async t => {
    await mkdir(shots, { recursive: true });
    const origin = await serve(t);
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await openPage(browser, origin);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const locale of ['en', 'zh-CN']) for (const theme of ['dark', 'light']) for (const width of [1100, 390]) {
        const label = `${locale} ${theme} ${width}px`;
        await page.setViewport({ width, height: 1400 });
        await page.goto(`${origin}/?locale=${locale}&theme=${theme}`, { waitUntil: 'load' });
        await page.waitForSelector('.nmx-gateway-content .nmx-md-code');
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        const view = await page.evaluate(() => {
            const root = document.querySelector('.nmx-gateway-content');
            const size = selector => { const node = root.querySelector(selector); return node ? parseFloat(getComputedStyle(node).fontSize) : 0; };
            const blocks = [...root.querySelectorAll('.nmx-md-code')];
            return {
                text: root.textContent,
                user: document.querySelector('.nmx-user-markdown').textContent,
                injected: root.querySelectorAll('script, i.codicon-pwd, [onerror]').length + document.querySelectorAll('.nmx-user-markdown i.codicon').length,
                sizes: { body: size('p'), h1: size('h1'), h2: size('h2'), h3: size('h3') },
                codes: blocks.map(block => ({ lang: block.querySelector('.nmx-md-code-lang').textContent, tokens: block.querySelectorAll('[class^="nmx-tok-"]').length,
                    radius: parseFloat(getComputedStyle(block).borderTopLeftRadius), direction: getComputedStyle(block).direction,
                    overflow: getComputedStyle(block.querySelector('pre')).overflowX })),
                keyword: root.querySelector('.nmx-md-code .nmx-tok-keyword') ? getComputedStyle(root.querySelector('.nmx-md-code .nmx-tok-keyword')).color : '',
                plain: getComputedStyle(root.querySelector('.nmx-md-code code')).color,
                tasks: [...root.querySelectorAll('.nmx-md-task-box')].map(box => ({ checked: box.checked, disabled: box.disabled })),
                table: (() => { const frame = root.querySelector('.nmx-md-table'); return frame ? { radius: parseFloat(getComputedStyle(frame).borderTopLeftRadius),
                    scrolls: frame.scrollWidth > frame.clientWidth + 1, frameOverflow: frame.getBoundingClientRect().right - root.getBoundingClientRect().right,
                    zebra: getComputedStyle(frame.querySelector('tbody tr:nth-child(2) td')).backgroundColor } : undefined; })(),
                links: [...root.querySelectorAll('a')].map(anchor => ({ text: [...anchor.childNodes].filter(node => !node.classList?.contains('nmx-site-icon')).map(node => node.textContent).join('').trim(),
                    icon: Boolean(anchor.querySelector('.nmx-site-icon')) })),
                lineHeight: parseFloat(getComputedStyle(root.querySelector('p')).lineHeight) / parseFloat(getComputedStyle(root.querySelector('p')).fontSize),
                pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
            };
        });
        assert.deepEqual(errors, [], label);
        assert.equal(view.injected, 0, `${label}: no script, no $(icon) codicons`);
        assert.match(view.user, /Vec<u8>[\s\S]*Promise<void> \$\(pwd\)/, `${label}: sent prompts keep generics and $(…) literally`);
        assert.match(view.text, /Promise<void>/, `${label}: prose keeps generics`);
        assert.match(view.text, /\$\(pwd\)/, `${label}: prose keeps $(…)`);
        const scale = [view.sizes.h1, view.sizes.h2, view.sizes.h3, view.sizes.body].filter(Boolean);
        assert.ok(scale.length >= 3 && scale.every((size, index) => index === 0 || size < scale[index - 1]), `${label}: heading scale ${JSON.stringify(view.sizes)}`);
        assert.equal(view.sizes.body, 15, label);
        assert.ok(view.lineHeight >= 1.5 && view.lineHeight <= 1.7, `${label}: body line height`);
        const expectedLangs = locale === 'en' ? ['TypeScript', 'Shell', 'Diff'] : ['Python'];
        assert.deepEqual(view.codes.map(code => code.lang), expectedLangs, label);
        for (const code of view.codes) {
            assert.ok(code.tokens > 0, `${label}: ${code.lang} is highlighted`);
            assert.ok(code.radius >= 10, `${label}: rounded code block`);
            assert.equal(code.direction, 'ltr', label);
            assert.equal(code.overflow, 'auto', `${label}: long lines scroll inside the block`);
        }
        assert.notEqual(view.keyword, view.plain, `${label}: keywords are coloured`);
        assert.deepEqual(view.tasks, [{ checked: true, disabled: true }, { checked: false, disabled: true }], `${label}: task list`);
        assert.ok(view.table && view.table.radius >= 8, `${label}: rounded table frame`);
        assert.ok(view.table.frameOverflow <= 1, `${label}: table frame stays in the column`);
        assert.notEqual(view.table.zebra, 'rgba(0, 0, 0, 0)', `${label}: zebra rows`);
        if (width === 390 && locale === 'en') assert.ok(view.table.scrolls, `${label}: a wide table scrolls inside its frame`);
        assert.ok(view.pageOverflow <= 0, `${label}: no horizontal page scroll`);
        if (locale === 'en') {
            assert.match(view.text, /<script>alert\(1\)<\/script>/, `${label}: HTML is shown as text`);
            assert.match(view.text, /a:\/b 8\) :\) remain plain\. 🚀/, `${label}: no emoji shortcuts, named emoji still work`);
            assert.ok(view.links.some(link => link.text === 'the docs' && link.icon), `${label}: authored link keeps its label and gains a site icon`);
            assert.ok(view.links.some(link => link.text === 'npm' && link.icon), `${label}: bare URL shows the site name`);
        } else {
            assert.match(view.text, /中文软换行不会插入多余空格/, `${label}: a soft break between CJK characters adds no space`);
            assert.ok(view.links.some(link => link.text === 'http://127.0.0.1:8080/health' && !link.icon), `${label}: local address stays raw`);
        }
        await page.screenshot({ path: `${shots}/markdown-${locale}-${theme}-${width}.png`, fullPage: true });

        // Copy button copies the exact source and flips to “Copied”.
        await page.click('.nmx-md-code-copy');
        await page.waitForSelector('.nmx-md-code-copy.is-copied');
        const copied = await page.evaluate(() => ({ text: window.copied.at(-1),
            label: getComputedStyle(document.querySelector('.nmx-md-code-copy.is-copied .nmx-md-code-copy-label'), '::after').content }));
        assert.equal(copied.text, locale === 'en'
            ? 'export async function resume(run: Run): Promise<Result | undefined> {\n    const checkpoint = run.checkpoint; // saved on every tool call\n    if (!checkpoint) return undefined;\n    return replay(checkpoint, { attempts: 3, label: "resume" });\n}'
            : 'def resume(run):\n    checkpoint = run.checkpoint  # 每次工具调用都会保存\n    if checkpoint is None:\n        return None\n    return replay(checkpoint, attempts=3)', label);
        assert.equal(copied.label, locale === 'en' ? '"Copied"' : '"已复制"', label);
        if (width === 1100) await page.screenshot({ path: `${shots}/markdown-${locale}-${theme}-copied.png`, clip: await page.$eval('.nmx-md-code', node => {
            const box = node.getBoundingClientRect(); return { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 }; }) });
    }
});

test('a streamed reply lays out exactly like the finished document and completion does not move it', { timeout: 120000 }, async t => {
    const origin = await serve(t);
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await openPage(browser, origin);
    // Block positions relative to the turn, so the stream → response hand-off is measured in place.
    const geometry = () => page.evaluate(() => {
        const message = document.querySelector('.nmx-agent-message');
        const top = message.getBoundingClientRect().top;
        const blocks = [...message.querySelectorAll(':is(.nmx-stream-text, .nmx-gateway-content) :is(h1, h2, h3, h4, p, pre, table, hr, blockquote, li)')];
        return blocks.map(node => Math.round((node.getBoundingClientRect().top - top) * 10) / 10);
    });
    for (const [locale, tools] of [['en', false], ['zh-CN', false], ['en', true]]) {
        await page.setViewport({ width: 900, height: 1400 });
        await page.goto(`${origin}/?locale=${locale}&theme=dark${tools ? '&tools=1' : ''}`, { waitUntil: 'load' });
        await page.waitForSelector('.nmx-gateway-content .nmx-md-code');
        await settle(page);
        const sample = await page.evaluate(() => window.fixture.sample);

        // Stream the reply in: no block ever paints empty.
        await page.evaluate(() => window.fixture.set({ live: true, text: '' }));
        for (let length = 40; length < sample.length; length += 97) {
            await page.evaluate(text => window.fixture.set({ text }), sample.slice(0, length));
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
            const empty = await page.evaluate(() => [...document.querySelectorAll('.nmx-stream-text > .nmx-assistant-markdown')].filter(node => !node.childElementCount).length);
            assert.equal(empty, 0, `${locale}: no block paints empty while streaming (${length})`);
        }
        await page.evaluate(text => window.fixture.set({ text }), sample);
        await settle(page);
        const live = await geometry();
        const wrappers = await page.$$eval('.nmx-stream-text > .nmx-assistant-markdown', nodes => nodes.length);
        assert.ok(wrappers > 5, `${locale}: the live reply is rendered as cached blocks (${wrappers})`);

        // The block split lays out exactly like one document.
        await page.evaluate(() => window.fixture.set({ single: true }));
        await settle(page);
        if (!tools) assert.deepEqual(await geometry(), live, `${locale}: block-split layout equals the single-document layout`);
        await page.evaluate(() => window.fixture.set({ single: false }));
        await settle(page);

        // Completion hands the text to the turn response in the same frame, at the same place.
        const frames = await page.evaluate(() => new Promise(resolve => {
            const seen = [];
            window.fixture.set({ live: false });
            let count = 0;
            const tick = () => {
                const response = document.querySelector('.nmx-agent-message.is-complete .nmx-gateway-content > .nmx-assistant-markdown');
                if (response) seen.push(response.childElementCount);
                if (++count < 8) requestAnimationFrame(tick); else resolve(seen);
            };
            requestAnimationFrame(tick);
        }));
        assert.ok(frames.length && frames.every(count => count > 0), `${locale}: the finished response never paints empty (${frames})`);
        await settle(page);
        assert.deepEqual(await geometry(), live, `${locale}${tools ? ' after a tool row' : ''}: completion does not move the reply`);
    }
});

test('RTL replies: Arabic blocks run right-to-left, code and English blocks stay left-to-right', { timeout: 60000 }, async t => {
    const origin = await serve(t);
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await openPage(browser, origin);
    for (const theme of ['light', 'dark']) {
        await page.setViewport({ width: 390, height: 1200 });
        await page.goto(`${origin}/?locale=ar&theme=${theme}`, { waitUntil: 'load' });
        await page.waitForSelector('.nmx-gateway-content .nmx-md-code');
        await settle(page);
        const view = await page.evaluate(() => {
            const paragraphs = [...document.querySelectorAll('.nmx-gateway-content p')];
            return { arabic: getComputedStyle(paragraphs[0]).direction, english: getComputedStyle(paragraphs.at(-1)).direction,
                list: getComputedStyle(document.querySelector('.nmx-gateway-content ol')).direction,
                code: getComputedStyle(document.querySelector('.nmx-gateway-content .nmx-md-code')).direction,
                pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        assert.deepEqual(view, { arabic: 'rtl', english: 'ltr', list: 'rtl', code: 'ltr', pageOverflow: 0 }, theme);
        await page.screenshot({ path: `${shots}/markdown-ar-${theme}-390.png`, fullPage: true });
    }
});
