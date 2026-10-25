import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = require('puppeteer');
const url = new URL(process.argv[2] || '');
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/') throw new Error('Only the isolated localhost fixture is permitted');
const directory = await mkdtemp(join(tmpdir(), 'nextmux-archive-project-ui-'));
const browser = await puppeteer.launch({ headless: true });
const measurements = [], screenshots = [];
let dialogs = 0, externalRequests = 0;
const themes = process.argv[3] === '--themes';
const previewOnly = process.argv[3] === '--narrow-preview';
try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => { if (new URL(request.url()).origin === url.origin) void request.continue(); else { externalRequests++; void request.abort(); } });
    page.on('dialog', dialog => { dialogs++; void dialog.dismiss(); });
    const waitIdle = async () => { await page.waitForSelector('.nmx-conversation-archive[aria-busy="false"]'); };
    const choose = async () => { await page.click('.nmx-conversation-archive > .nmx-settings-actions button:nth-child(3)'); await page.waitForSelector('.nmx-archive-bindings'); await waitIdle(); };
    for (const theme of themes ? ['dark', 'light'] : ['dark']) for (const width of previewOnly ? [320] : themes ? [960, 320] : [960, 360, 320]) for (const locale of previewOnly ? ['zh-CN'] : themes ? ['zh-CN', 'ar'] : ['en', 'ar', 'de', 'zh-CN']) {
        await page.setViewport({ width, height: 720 }); await page.goto(url.href, { waitUntil: 'networkidle0' });
        await page.select('select[aria-label="Locale"]', locale);
        await page.select('select[aria-label="Fixture theme"]', theme);
        await page.click('.nmx-archive-export-projects summary');
        assert.equal(await page.$eval('.nmx-archive-opt-in input', input => input.checked), false);
        await page.click('.nmx-archive-opt-in input');
        await choose(); await page.click('.nmx-archive-bindings article button'); await page.waitForSelector('.nmx-archive-bindings bdi'); await waitIdle();
        const measured = await page.evaluate(() => { const panel = document.querySelector('.nmx-conversation-archive'); return { theme: document.querySelector('main').dataset.fixtureTheme, pageWidth: document.documentElement.scrollWidth, panelWidth: panel.getBoundingClientRect().width, scrollWidth: panel.scrollWidth, surfaceColor: getComputedStyle(document.querySelector('main')).backgroundColor, inputColor: getComputedStyle(panel.querySelector('.nmx-archive-project-label input')).backgroundColor, textColor: getComputedStyle(document.querySelector('main')).color, lists: [...panel.querySelectorAll('.nmx-archive-project-list')].map(list => ({ height: list.getBoundingClientRect().height, scrollHeight: list.scrollHeight })), controls: [...panel.querySelectorAll('button')].every(button => button.getBoundingClientRect().width <= panel.getBoundingClientRect().width) }; });
        assert.ok(measured.pageWidth <= width && measured.scrollWidth <= measured.panelWidth + 1 && measured.controls, `${width}/${locale}: overflow`);
        assert.equal(measured.theme, theme);
        // Final product theme rules may refine fixture tokens; require consistent
        // light/dark surfaces rather than freezing one intermediate RGB value.
        for (const color of [measured.surfaceColor, measured.inputColor]) {
            const channels = color.match(/\d+/g).slice(0, 3).map(Number);
            assert.ok(channels.every(value => theme === 'dark' ? value < 80 : value > 200), `${theme}: mixed surface ${color}`);
        }
        assert.ok(measured.lists.every(list => list.height <= 300)); measurements.push({ viewport: width, locale, ...measured });
        if (previewOnly) {
            await page.$eval('.nmx-archive-conversations', list => list.scrollIntoView({ block: 'center' }));
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const proof = await page.$eval('.nmx-archive-conversations', list => { const title = list.querySelector('li span'); const bounds = title.getBoundingClientRect(), clip = list.getBoundingClientRect(); return { textLength: title.textContent.length, color: getComputedStyle(title).color, opacity: getComputedStyle(title).opacity, display: getComputedStyle(title).display, visibleHeight: Math.min(bounds.bottom, clip.bottom) - Math.max(bounds.top, clip.top) }; });
            assert.ok(proof.textLength > 0 && proof.opacity === '1' && proof.display !== 'none' && proof.visibleHeight > 0);
            measurements.push({ previewProof: proof });
            const path = join(directory, 'archive-dark-320-zh-CN-preview.png'); await page.screenshot({ path }); screenshots.push(path);
        }
        if (themes || (width === 960 && locale === 'en') || (width === 360 && locale === 'de') || (width === 320 && ['ar', 'zh-CN'].includes(locale))) {
            const path = join(directory, `archive-${theme}-${width}-${locale}.png`); await page.screenshot({ path, fullPage: true }); screenshots.push(path);
        }
    }
    await page.setViewport({ width: 960, height: 720 }); await page.goto(url.href, { waitUntil: 'networkidle0' }); await page.select('select[aria-label="Locale"]', 'en');
    await page.click('.nmx-conversation-archive > .nmx-settings-actions button:nth-child(2)'); await waitIdle();
    const counters = async () => JSON.parse(await page.$eval('output', output => output.textContent));
    assert.equal((await counters()).labeledExport, false);
    await page.click('.nmx-archive-export-projects summary'); await page.click('.nmx-archive-opt-in input');
    await page.click('.nmx-conversation-archive > .nmx-settings-actions button:nth-child(2)'); await waitIdle(); assert.equal((await counters()).labeledExport, true);
    await choose(); await page.click('.nmx-archive-bindings article button'); await page.waitForSelector('.nmx-archive-bindings bdi'); await waitIdle();
    await page.click('.nmx-archive-bindings article button:nth-child(2)'); await page.waitForFunction(() => !document.querySelector('.nmx-archive-bindings bdi') && document.querySelector('.nmx-archive-bindings')); await waitIdle();
    assert.equal((await counters()).binding, 2);
    await page.select('.nmx-archive-policy select', 'copy'); await page.click('[data-refresh-failure]');
    await page.click('.nmx-archive-preview > .nmx-settings-actions .is-primary', { clickCount: 2 }); await waitIdle();
    assert.equal((await counters()).import, 1); assert.equal((await counters()).lastPolicy, 'copy');
    assert.equal(await page.$('.nmx-archive-preview'), null);
    assert.match(await page.$eval('.nmx-conversation-archive [role="alert"]', element => element.textContent), /do not import again/);
    await page.click('[data-refresh-failure]'); await choose();
    await page.click('.fixture>nav label:first-of-type input');
    await page.click('.nmx-archive-bindings article button'); await waitIdle();
    assert.equal(await page.$('.nmx-archive-preview'), null); assert.match(await page.$eval('.nmx-conversation-archive [role="alert"]', element => element.textContent), /failed/);
    assert.equal(dialogs, 0); assert.equal(externalRequests, 0);
    const report = { scope: 'isolated real archive component and production CSS, not Electron app or native picker', measurements, interactions: ['labels default off', 'default v1 export', 'explicit labeled export', 'choose local binding', 'reset owned binding', 'copy policy', 'double import only once', 'post-commit refresh warning no reimport', 'failed binding removes old preview'], dialogs, externalRequests, screenshots };
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); }
