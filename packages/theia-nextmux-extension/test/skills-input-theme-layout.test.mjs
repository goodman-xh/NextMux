import assert from 'node:assert/strict';
import { communitySkillListText } from '../lib/browser/nextmux-community-skill-locale.js';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

async function productionMarkup() {
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const nodes = new Map();
    function visit(node) {
        if (ts.isJsxElement(node)) {
            const value = node.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(file) === 'className')?.initializer;
            if (value && ts.isStringLiteral(value) && ['nmx-community-skills-toolbar', 'nmx-skill-install-link'].includes(value.text)) nodes.set(value.text, node.getText(file));
        }
        ts.forEachChild(node, visit);
    }
    visit(file); assert.equal(nodes.size, 2);
    const code = `class Fixture {
        desktopLocale = 'en'; communitySkillQuery = ''; communitySkillSource = 'all'; communitySkills = { sources: [] };
        communitySkillsLoading = false; communitySkillUrl = ''; communitySkillActionId = '';
        update() {} loadCommunitySkills() {} installCommunitySkillFromUrl() {}
        render() { return <>${[...nodes.values()].join('')}</>; }
    }; return new Fixture().render();`;
    return new Function('React', 'ImeInput', 'ImeTextarea', 'communitySkillListText', ts.transpile(code, { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 }))(React, 'input', 'textarea', communitySkillListText);
}

test('production Skills search and install fields keep readable icons and usable input space in both themes', { timeout: 30000 }, async t => {
    const markup = await productionMarkup();
    const css = (await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name =>
        readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')))).join('\n');
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setRequestInterception(true); page.on('request', request => void request.abort());
    const samples = [];
    for (const theme of ['light', 'dark']) for (const width of [980, 1369]) {
        await page.setViewport({ width, height: 800 });
        const html = renderToStaticMarkup(React.createElement('div', { id: 'nextmux.desktop.widget', className: 'nmx-desktop-widget' },
            React.createElement('div', { className: `nmx-shell nmx-theme-${theme}` },
                React.createElement('div', { className: 'nmx-settings-page' },
                    React.createElement('section', { className: 'nmx-settings-panel nmx-skills-settings' }, markup)))));
        await page.setContent(`<style>${css}</style><style>html,body{margin:0}.nmx-shell{display:block}.nmx-settings-page{display:block;box-sizing:border-box;width:calc(100% - 276px);margin-left:276px;padding:20px}</style>${html}`);
        for (const selector of ['.nmx-community-skills-toolbar > label', '.nmx-skill-install-link > label']) {
            const result = await page.$eval(selector, label => {
                const icon = label.querySelector('i'), input = label.querySelector('input');
                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
                const ctx = canvas.getContext('2d');
                const rgb = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
                const luminance = value => value.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
                    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
                const contrast = (node, pseudo) => {
                    const fg = rgb(getComputedStyle(node, pseudo).color); let bg = [255, 255, 255, 255];
                    for (let parent = node; parent; parent = parent.parentElement) {
                        const color = rgb(getComputedStyle(parent).backgroundColor);
                        if (color[3] === 255) { bg = color; break; }
                    }
                    const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
                };
                const outer = label.getBoundingClientRect(), field = input.getBoundingClientRect();
                return { iconContrast: contrast(icon), textContrast: contrast(input), placeholderContrast: contrast(input, '::placeholder'),
                    inputInset: field.left - outer.left, inputWidth: field.width, labelWidth: outer.width,
                    inputRight: field.right, labelRight: outer.right };
            });
            samples.push({ theme, width, selector, ...result });
        }
    }
    t.diagnostic(JSON.stringify(samples));
    for (const sample of samples) {
        const context = `${sample.theme}/${sample.width}/${sample.selector}`;
        assert.ok(sample.iconContrast >= 3, `${context}: icon contrast ${sample.iconContrast}`);
        assert.ok(sample.textContrast >= 4.5, `${context}: input contrast ${sample.textContrast}`);
        assert.ok(sample.placeholderContrast >= 4.5, `${context}: placeholder contrast ${sample.placeholderContrast}`);
        assert.ok(sample.inputInset <= 60, `${context}: input inset ${sample.inputInset}`);
        assert.ok(sample.inputWidth >= sample.labelWidth - 90, `${context}: input width ${sample.inputWidth}/${sample.labelWidth}`);
        assert.ok(sample.inputRight <= sample.labelRight, `${context}: input must remain inside the field`);
    }
});
