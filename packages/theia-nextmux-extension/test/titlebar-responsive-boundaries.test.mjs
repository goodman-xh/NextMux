import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let method;
const visit = node => {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'computeTitlebarLayout') method = node.getText(ast);
    ts.forEachChild(node, visit);
};
visit(ast);
assert.ok(method);
const emitted = ts.transpileModule(`class Widget { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const styles = ['nextmux.css', 'nextmux-desktop-production.css'].map(name =>
    readFileSync(new URL('../src/browser/style/' + name, import.meta.url), 'utf8')).join('\n');

function layout(width, windows) {
    const Widget = new Function('document', `${emitted}\nreturn Widget;`)({
        body: { classList: { contains: name => name === 'windows' && windows } }, getElementById() { return null; }
    });
    // Exercise the actual first-render fallback before measured widths are available.
    return Object.assign(new Widget(), { node: { querySelector() {} }, contextPanelCollapsed: true,
        cachedPrimaryNavWidth: 248, cachedPrimaryNavIconWidth: 108, cachedWorkspaceControlsWidth: 136,
        activeSection: 'coding', workContextOpen: false }).computeTitlebarLayout(width);
}

test('titlebar CSS follows actual fit decisions on both sides of text/icon/hidden boundaries', { timeout: 30000 }, async t => {
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => void request.abort());
    // The 600px Mac case used to be hidden by an unrelated max-width:620px rule,
    // despite ample separation between its compact navigation and both control groups.
    for (const [windows, width, expected] of [
        [false, 638, 'text'], [false, 636, 'icon'], [false, 620, 'icon'], [false, 600, 'icon'],
        [false, 494, 'icon'], [false, 492, 'hidden'],
        [true, 842, 'text'], [true, 840, 'icon'], [true, 694, 'icon'], [true, 692, 'hidden'], [true, 600, 'hidden']
    ]) {
        const decision = layout(width, windows);
        assert.equal(decision.crowded ? 'hidden' : decision.compact ? 'icon' : 'text', expected);
        await page.setViewport({ width, height: 600 });
        const state = decision.crowded ? 'is-titlebar-crowded' : decision.compact ? 'is-titlebar-compact' : '';
        await page.setContent(`<style>${styles}</style><style>
            html,body{margin:0;width:100%;height:100%;font:14px system-ui}
            .nmx-shell{display:block!important;width:100%;height:100%;--nmx-titlebar-left:0px;--nmx-titlebar-right:0px}
            .nmx-titlebar-primary-nav i{display:block;width:16px;height:16px}
            .nmx-titlebar-actions{left:${windows ? 0 : 78}px!important;width:${windows ? 112 : 104}px}
        </style><body class="${windows ? 'windows' : 'mac'}"><div class="nmx-shell nmx-theme-dark is-context-collapsed ${state}">
            <div class="nmx-titlebar-actions"></div>
            <nav class="nmx-titlebar-primary-nav">${['模型中心', '编程', '漫剧'].map(label => `<button><i></i><span>${label}</span></button>`).join('')}</nav>
            <header class="nmx-coding-topbar"><div class="nmx-workspace-controls">${['浏览器', '智能体', '终端', '右侧面板'].map(label => `<button aria-label="${label}"><i></i></button>`).join('')}</div></header>
        </div></body>`);
        const actual = await page.evaluate(() => {
            const nav = document.querySelector('.nmx-titlebar-primary-nav');
            const actions = document.querySelector('.nmx-titlebar-actions');
            const controls = document.querySelector('.nmx-workspace-controls');
            return { navVisible: getComputedStyle(nav).display !== 'none', controlsVisible: getComputedStyle(controls).display !== 'none',
                labelsVisible: getComputedStyle(nav.querySelector('span')).display !== 'none',
                navLeft: nav.getBoundingClientRect().left, navRight: nav.getBoundingClientRect().right,
                actionsRight: actions.getBoundingClientRect().right, controlsLeft: controls.getBoundingClientRect().left };
        });
        const label = `${windows ? 'Windows' : 'Mac'} ${width}: ${JSON.stringify(actual)}`;
        assert.equal(actual.navVisible, expected !== 'hidden', label);
        assert.equal(actual.controlsVisible, expected !== 'hidden', label);
        if (expected !== 'hidden') {
            assert.equal(actual.labelsVisible, expected === 'text', label);
            assert.ok(actual.navLeft > actual.actionsRight && actual.navRight < actual.controlsLeft, label);
        }
    }
});
