import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { agentOutcomeText } from '../lib/browser/nextmux-agent-outcome-locale.js';
import { NextMuxEditorRecoveryPanel } from '../lib/browser/nextmux-editor-recovery-panel.js';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

async function resumeFixture() {
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let resume;
    function visit(node) {
        if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
            ts.isJsxAttribute(attribute) && attribute.name.text === 'className'
            && attribute.initializer && ts.isStringLiteral(attribute.initializer)
            && attribute.initializer.text === 'nmx-inline-actions nmx-agent-resume')) resume = node.getText(file);
        ts.forEachChild(node, visit);
    }
    visit(file);
    assert.ok(resume, 'use the actual resume control including its production disabled expression');
    return new Function('React', 'agentOutcomeText', ts.transpile(`return class Fixture {
        desktopLocale = 'zh-CN'; activeCodingSessionId = 'conversation'; activeAgentRunId = ''; agentStage = 'idle';
        relayFeedbackSubmittingVotes = new Set();
        conversationHistoryReady() { return true; } resumePausedTurn() {}
        render() { const route = { id: 'route' }, codingSession = { id: 'conversation' }, turn = { id: 'turn' }; return ${resume}; }
    }`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React })) (React, agentOutcomeText);
}

test('production resume and editor recovery controls stay readable in light and dark themes', { timeout: 30000 }, async t => {
    const Fixture = await resumeFixture();
    const css = (await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name =>
        readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')))).join('\n');
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 700 });
    await page.setRequestInterception(true);
    page.on('request', request => void request.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const sample = selector => page.$eval(selector, node => {
        const rgba = text => text.match(/[\d.]+/g).map(Number);
        const style = getComputedStyle(node);
        const foreground = rgba(style.color), background = rgba(style.backgroundColor);
        const luminance = value => value.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
            .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const a = luminance(foreground), b = luminance(background);
        return { color: style.color, background: style.backgroundColor, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
            disabled: node.disabled, cursor: style.cursor, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height };
    });
    const palettes = {};
    for (const theme of ['light', 'dark']) {
        for (const disabled of [false, true]) {
            const fixture = new Fixture();
            fixture.activeAgentRunId = disabled ? 'active-run' : '';
            const markup = renderToStaticMarkup(React.createElement('div', { id: 'nextmux.desktop.widget', className: 'nmx-desktop-widget' },
                React.createElement('div', { className: `nmx-shell nmx-theme-${theme}` },
                    React.createElement('main', { className: 'nmx-workspace', style: { gridColumn: '1 / -1', padding: 32 } },
                        fixture.render(), React.createElement(NextMuxEditorRecoveryPanel, { locale: 'zh-CN', busy: disabled,
                            entries: [{ key: 'draft', name: '恢复草稿', status: 'error' }], onOpen() {}, onRetry() {}, onDiscard() {} })))));
            await page.setContent(`<html><head><style>${css}</style><style>html,body,.nmx-desktop-widget{margin:0;height:100%;width:100%}</style></head><body>${markup}</body></html>`);
            await page.mouse.move(0, 0);
            const selector = '.nmx-agent-resume > button';
            assert.equal(await page.$eval(selector, node => node.textContent), '继续任务');
            const normal = await sample(selector);
            assert.equal(normal.disabled, disabled);
            assert.ok(normal.contrast >= 4.5, `${theme} ${disabled ? 'disabled' : 'default'}: ${JSON.stringify(normal)}`);
            await page.hover(selector);
            await new Promise(resolve => setTimeout(resolve, 140));
            const hover = await sample(selector);
            assert.ok(hover.contrast >= 4.5, `${theme} hover: ${JSON.stringify(hover)}`);
            assert.equal(hover.width, normal.width); assert.equal(hover.height, normal.height);
            if (disabled) assert.equal(hover.background, normal.background, 'disabled controls do not acquire an enabled hover state');
            else { assert.notEqual(hover.background, normal.background); palettes[theme] = normal; }
            for (const recovery of ['.nmx-editor-recovery header button', '.nmx-editor-recovery nav button']) {
                const colors = await sample(recovery);
                assert.equal(colors.disabled, disabled);
                assert.ok(colors.contrast >= 4.5, `${theme} editor recovery: ${JSON.stringify(colors)}`);
            }
            if (!disabled) await page.screenshot({ path: `/tmp/nm-resume-${theme}.png` });
        }
    }
    assert.notEqual(palettes.light.background, palettes.dark.background);
    assert.deepEqual(errors, []);
});
