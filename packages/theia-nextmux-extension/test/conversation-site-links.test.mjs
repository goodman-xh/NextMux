import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import ts from 'typescript';
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

test('rendered site links preserve destinations and titles, fail back cleanly, and do not touch code', async t => {
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => request.abort());
    await page.setContent('<main><p>https://www.baidu.com</p><p id="local">http://127.0.0.1:8787/health，继续</p><a href="https://github.com/a/b"><strong>项目文档</strong></a><a href="file:///x">x</a><code><a href="https://example.com">https://example.com</a> https://www.baidu.com</code><p id="punctuation">查看 https://example.org/a_(b)?x=1&amp;y=2，以及结尾。</p><p id="adjacent">查看 https://example.com中文后缀</p></main>');
    const { outputFiles } = await desktop('esbuild').build({
        entryPoints: [fileURLToPath(new URL('../src/browser/nextmux-markdown.ts', import.meta.url))],
        bundle: true, write: false, format: 'iife', globalName: 'siteLinks', platform: 'browser'
    });
    await page.addScriptTag({ content: outputFiles[0].text });
    const result = await page.evaluate(() => {
        const main = document.querySelector('main');
        window.siteLinks.decorateConversationLinks(main);
        window.siteLinks.decorateConversationLinks(main);
        const anchors = [...main.querySelectorAll('a')].slice(0, 4);
        const icon = anchors[0].querySelector('img');
        const imageUrl = icon.src;
        icon.dispatchEvent(new Event('error'));
        let clicked;
        main.onclick = event => { event.preventDefault(); clicked = event.target.closest('a').getAttribute('href'); };
        anchors[0].querySelector('span').click();
        return {
            labels: anchors.map(a => a.textContent), hrefs: anchors.map(a => a.getAttribute('href')),
            icons: anchors.map(a => a.querySelectorAll('.nmx-site-icon').length),
            bold: main.querySelector('a strong').textContent,
            failedImages: anchors[0].querySelectorAll('img').length, imageUrl, clicked,
            punctuationHref: main.querySelector('#punctuation a').getAttribute('href'),
            localLabel: main.querySelector('#local a').textContent,
            localIcon: main.querySelector('#local a').querySelectorAll('.nmx-site-icon').length,
            localText: main.querySelector('#local').textContent,
            codeLinks: main.querySelector('code').querySelectorAll('a').length,
            adjacentHref: main.querySelector('#adjacent a').getAttribute('href'),
            adjacentText: main.querySelector('#adjacent').textContent,
            fallbackIcons: [anchors[0], anchors[2]].map(a => a.querySelector('.nmx-site-icon').classList.contains('is-fallback'))
        };
    });
    assert.deepEqual(result.labels, ['百度', 'http://127.0.0.1:8787/health', '项目文档', 'x'], 'the fallback icon is CSS-drawn, never a copied emoji glyph');
    assert.deepEqual(result.fallbackIcons, [true, true]);
    assert.deepEqual(result.icons, [1, 0, 1, 0]);
    assert.equal(result.bold, '项目文档');
    assert.equal(result.failedImages, 0);
    assert.equal(result.imageUrl, 'https://www.baidu.com/favicon.ico');
    assert.equal(result.clicked, result.hrefs[0]);
    assert.equal(result.punctuationHref, 'https://example.org/a_(b)?x=1&y=2');
    assert.equal(result.localLabel, 'http://127.0.0.1:8787/health');
    assert.equal(result.localIcon, 0);
    assert.equal(result.localText, 'http://127.0.0.1:8787/health，继续');
    assert.equal(result.codeLinks, 1);
    assert.equal(result.adjacentHref, 'https://example.com');
    assert.equal(result.adjacentText, '查看 example.com中文后缀');
});

test('composer link overlay clears with the prompt and stays single after a render', async t => {
    const sourceUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);
    const parsed = ts.createSourceFile('widget.tsx', await readFile(sourceUrl, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methods = ['renderComposerMarkdownOverlay', 'syncComposerMarkdownOverlay', 'setComposerPrompt', 'composerInputOwner', 'composerInputKey', 'ownsComposerInput']
        .map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name).getText(parsed)).join('\n');
    const { outputFiles } = await desktop('esbuild').build({ stdin: {
        contents: `import * as React from 'react'; import { createRoot } from 'react-dom/client';
import { composerMarkdownSegments } from './nextmux-markdown';
import { ComposerInputScope } from './nextmux-composer-input-scope';
class Fixture {
    prompt = ''; node = document.querySelector('main');
    composerInputScope = new ComposerInputScope(); composerTextareaRef = React.createRef(); composerMarkdownOverlayRef = { current: null };
    ${methods}
    render() { root.render(<div className='nmx-composer'><div className='nmx-composer-input'>
        {this.renderComposerMarkdownOverlay()}<textarea key={this.composerInputKey()} data-composer-input-scope={this.composerInputKey()} ref={this.composerTextareaRef} defaultValue={this.prompt}/>
    </div></div>); }
}
const root = createRoot(document.querySelector('main')); window.fixture = new Fixture(); window.fixture.render();`,
        loader: 'tsx', resolveDir: dirname(fileURLToPath(sourceUrl))
    }, bundle: true, write: false, platform: 'browser', format: 'iife',
        alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client') } });
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<main></main>');
    await page.addScriptTag({ content: outputFiles[0].text });
    await page.waitForSelector('textarea');
    await page.evaluate(() => { window.fixture.setComposerPrompt('[标题](https://example.com)'); window.fixture.render(); });
    await page.waitForSelector('.nmx-composer-inline-link');
    assert.equal(await page.$eval('.nmx-composer-markdown-overlay', el => el.textContent), '标题');
    await page.evaluate(() => { window.fixture.setComposerPrompt(''); window.fixture.render(); });
    await page.waitForFunction(() => document.querySelector('.nmx-composer-markdown-overlay').textContent === '');
    assert.equal(await page.$eval('textarea', el => el.value), '');
    assert.equal(await page.$eval('.nmx-composer-input', el => el.classList.contains('has-markdown-links')), false);
    await page.evaluate(() => { window.fixture.setComposerPrompt('[新标题](https://example.com)'); window.fixture.render(); });
    await page.waitForFunction(() => document.querySelector('.nmx-composer-markdown-overlay').textContent === '新标题');
    assert.equal(await page.$$eval('.nmx-composer-inline-link', els => els.length), 1);
});
