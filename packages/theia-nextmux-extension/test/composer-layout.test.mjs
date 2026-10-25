import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const element = React.createElement;

test('production composer and transcript share the conversation center with drawers and detached windows', { timeout: 30000 }, async t => {
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    // Keep the fixture on the real ownership structure: the dock centers a
    // relative composer inside the same coding stage as the virtual transcript.
    assert.match(source, /className=\{`nmx-coding-stage\$\{/);
    // The dock owns the composer; only the computer-permission notice (floating above it) may come first.
    assert.match(source, /className='nmx-composer-dock'>\s*(?:\{this\.computerPermissionWait[\s\S]{0,700}?\/>\}\s*)?<div className=\{`nmx-composer-wrap/);
    const css = (await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name =>
        readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')))).join('\n');
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setRequestInterception(true);
    page.on('request', request => void request.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const cases = [
        { width: 1330, sidebar: 266, drawer: 664 },
        { width: 1100, sidebar: 266, drawer: 400 },
        { width: 1330, sidebar: 266, drawer: 0 },
        { width: 1100, sidebar: 0, drawer: 660 },
        { width: 1900, sidebar: 266, drawer: 450 },
        { width: 760, sidebar: 0, drawer: 0 },
        { width: 620, sidebar: 0, drawer: 0, detached: true },
        { width: 1330, sidebar: 0, drawer: 0, detached: true }
    ];
    for (const theme of ['dark', 'light']) for (const config of cases) {
        await page.setViewport({ width: config.width, height: 768 });
        const classes = ['nmx-shell', `nmx-theme-${theme}`, config.drawer && 'is-work-context-open',
            !config.sidebar && 'is-context-collapsed', config.detached && 'is-detached-conversation'].filter(Boolean).join(' ');
        const markup = renderToStaticMarkup(element('div', { id: 'nextmux.desktop.widget', className: 'nmx-desktop-widget' },
            element('div', { className: classes, style: { '--nmx-context-panel-width': `${config.sidebar}px`, '--nmx-work-context-width': `${config.drawer}px` } },
                config.sidebar ? element('aside', { className: 'nmx-context-panel' }) : null,
                element('section', { className: 'nmx-workspace' },
                    element('header', { className: 'nmx-workspace-topbar nmx-coding-topbar' }),
                    element('div', { className: 'nmx-coding-stage' },
                        element('div', { className: 'nmx-task-view' }, element('section', { className: 'nmx-task-turn is-first is-last' },
                            element('div', { className: 'nmx-agent-message' }, element('div', null, '这是保持居中的对话正文。')))),
                        element('div', { className: 'nmx-composer-dock' }, element('div', { className: 'nmx-composer-wrap is-rows-1' },
                            element('div', { className: 'nmx-composer' },
                                element('div', { className: 'nmx-composer-input' }, element('textarea', { placeholder: '随时输入' })),
                                element('div', null,
                                    element('button', { className: 'nmx-composer-tool' }, '+'),
                                    element('button', { className: 'nmx-permission-button' }, element('span', null, '工作区写入')),
                                    element('span', { className: 'nmx-composer-spacer' }),
                                    element('button', { className: 'nmx-composer-relay-button' }, element('span', null, '自有 API')),
                                    element('button', { className: 'nmx-route-button' }, element('span', null, 'Model')),
                                    element('button', { className: 'nmx-mic-button' }, '◌'),
                                    element('button', { className: 'nmx-send-button' }, '↑'))))))),
                config.drawer ? element('aside', { className: 'nmx-work-context' }) : null)));
        await page.setContent(`<html><head><style>${css}</style><style>html,body,.nmx-desktop-widget{margin:0;height:100%;width:100%}</style></head><body>${markup}</body></html>`);
        await page.evaluate(() => { for (const animation of document.getAnimations()) animation.finish(); });
        const geometry = await page.evaluate(() => {
            const box = selector => {
                const node = document.querySelector(selector); if (!node) return undefined;
                const rect = node.getBoundingClientRect();
                return { left: rect.left, right: rect.right, width: rect.width, center: (rect.left + rect.right) / 2 };
            };
            return { workspace: box('.nmx-workspace'), body: box('.nmx-task-turn'), composer: box('.nmx-composer'),
                wrap: box('.nmx-composer-wrap'), drawer: box('.nmx-work-context'), send: box('.nmx-send-button') };
        });
        const label = JSON.stringify({ theme, ...config, geometry });
        assert.ok(Math.abs(geometry.body.center - geometry.workspace.center) < 1, `body center: ${label}`);
        assert.ok(Math.abs(geometry.composer.center - geometry.body.center) < 1, `composer center: ${label}`);
        assert.ok(geometry.composer.left >= geometry.workspace.left && geometry.composer.right <= geometry.workspace.right, `bounded composer: ${label}`);
        assert.ok(geometry.send.left >= geometry.composer.left && geometry.send.right <= geometry.composer.right, `reachable send: ${label}`);
        assert.ok(geometry.body.width <= 710 && geometry.composer.width <= 730, `keep design maximums: ${label}`);
        if (geometry.drawer) assert.ok(geometry.composer.right <= geometry.drawer.left, `drawer cannot cover composer: ${label}`);
        if (config.width === 1330 && config.drawer) {
            t.diagnostic(label);
            await page.screenshot({ path: `/tmp/nm-composer-centered-${theme}.png` });
        }
    }
    assert.deepEqual(errors, []);
});
