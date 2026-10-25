import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { productionStylesheets } from './coding-sidebar-fixture-harness.mjs';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const moduleUrl = new URL('../src/browser/nextmux-composer-attachments.tsx', import.meta.url);
const shotDir = process.env.NMX_VISUAL_SHOTS;

// The production attachment chip, drop overlays and text-drop caret, mounted
// with every production stylesheet in both themes.
const entry = `import * as React from 'react'; import { createRoot } from 'react-dom/client';
import { AttachmentChip, ComposerDropOverlay, TextDropIndicator } from './nextmux-composer-attachments';
const params = new URLSearchParams(location.search);
const theme = params.get('theme') || 'dark', mode = params.get('mode') || 'chips';
const png = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff7a9a"/><stop offset="1" stop-color="#6c8cff"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/></svg>');
const files = [
  { name: '产品截图.png', kind: 'image', thumbnail: png, meta: '7.7 KB' },
  { name: '季度财务报告-2026年第三季度-最终修订版本-v12.pdf', kind: 'file', mimeType: 'application/pdf', meta: '2.4 MB' },
  { name: 'main.ts', kind: 'text', meta: '53 B', anchored: true, hint: '位于“请对比这个实现”之后' },
  { name: 'analysis.py', kind: 'text', meta: '15 B' },
  { name: 'budget.xlsx', kind: 'file', mimeType: 'application/vnd.ms-excel', meta: '88 KB' },
  { name: 'pitch.pptx', kind: 'file', mimeType: 'application/vnd.ms-powerpoint', meta: '4.1 MB' },
  { name: 'src.folder.md', kind: 'text', meta: '42 KB' },
  { name: 'voice.m4a', kind: 'file', mimeType: 'audio/mp4', meta: '1.2 MB', state: 'unsupported', hint: '当前模型不支持此格式' },
  { name: 'archive.zip', kind: 'file', mimeType: 'application/zip', meta: '12 MB', state: 'pending' }
];
function App() {
  return <div className={'nmx-shell nmx-theme-' + theme} style={{ display: 'block', height: '100%', padding: 28, background: 'var(--nmx-bg)', position: 'relative' }}>
    <div className='nmx-coding-stage' style={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
      {mode === 'thread' && <ComposerDropOverlay locale='zh-CN' variant='thread' />}
      <div className='nmx-composer-dock' style={{ width: 740 }}><div className='nmx-composer-wrap' style={{ width: '100%' }}>
        <div className={'nmx-composer' + (mode === 'composer' ? ' is-dragging is-drop-composer' : '') + (mode === 'text' ? ' is-dragging is-drop-text' : '')}>
          {mode === 'composer' && <ComposerDropOverlay locale='zh-CN' />}
          <div className='nmx-composer-assets'><div className='nmx-attachment-chips'>{files.map(file => <AttachmentChip key={file.name} locale='zh-CN' onRemove={() => {}} onPreview={file.kind === 'image' ? () => {} : undefined} {...file} />)}</div></div>
          <div className='nmx-composer-input' style={{ position: 'relative' }}>
            {mode === 'text' && <TextDropIndicator locale='zh-CN' caret={{ offset: 8, left: 118, top: 6, height: 20 }} />}
            <textarea defaultValue={mode === 'text' ? '请对比这个实现和旧版本的差异' : ''} placeholder='发送消息或描述任务' style={{ width: '100%', minHeight: 64 }} />
          </div>
        </div>
      </div></div>
    </div>
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);`;

async function start() {
  const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', resolveDir: dirname(fileURLToPath(moduleUrl)), sourcefile: 'attachments-fixture.tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent', loader: { '.css': 'empty' },
    alias: { react: core.resolve('react'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
  const css = await productionStylesheets();
  const assets = {
    '/fixture.js': ['text/javascript', outputFiles[0].contents],
    '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))], '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
    '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/icons.css'>${['nextmux-model-center.css', ...css].map(name => `<link rel='stylesheet' href='/${name}'>`).join('')}
<style>html,body,.nmx-desktop-widget,#root{margin:0;width:100%;height:100%}*{box-sizing:border-box}</style></head><body><div class='nmx-desktop-widget'><div id='root'></div></div><script src='/fixture.js'></script></body></html>`]
  };
  for (const name of ['nextmux-model-center.css', ...css]) assets['/' + name] = ['text/css', await readFile(new URL(`../src/browser/style/${name}`, import.meta.url))];
  for (const font of ['latin', 'latin-ext']) assets[`/fonts/nunito/nunito-${font}-wght-normal.woff2`] = ['font/woff2', await readFile(new URL(`../src/browser/style/fonts/nunito/nunito-${font}-wght-normal.woff2`, import.meta.url))];
  const server = createServer((request, response) => {
    const asset = assets[new URL(request.url, 'http://fixture').pathname];
    if (!asset) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': asset[0] }).end(asset[1]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

test('attachment chips, drop overlays and the text caret render cleanly in both themes', { timeout: 90_000 }, async t => {
  const { server, url } = await start(); t.after(() => server.close());
  const puppeteer = (await import(platform.resolve('puppeteer'))).default;
  const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 520, deviceScaleFactor: 2 });
  for (const theme of ['dark', 'light']) {
    for (const mode of ['chips', 'composer', 'text', 'thread']) {
      await page.goto(`${url}?theme=${theme}&mode=${mode}`);
      await page.waitForSelector('.nmx-attachment-chip');
      await new Promise(resolve => setTimeout(resolve, 500));
      if (shotDir) await page.screenshot({ path: `${shotDir}/attachments-${theme}-${mode}.png` });
      const metrics = await page.$$eval('.nmx-attachment-chip', chips => chips.map(chip => {
        const name = chip.querySelector('.nmx-attachment-text > b'), style = getComputedStyle(chip);
        return { title: chip.title, width: chip.getBoundingClientRect().width, clipped: name.scrollWidth > name.clientWidth, bg: style.backgroundColor, icon: Boolean(chip.querySelector('svg.nmx-file-type-icon, img')) };
      }));
      assert.ok(metrics.every(item => item.icon), 'every chip has a type icon or thumbnail');
      assert.ok(metrics.every(item => item.width <= 225), 'chips never grow past their maximum width');
      const long = metrics.find(item => item.title.startsWith('季度财务报告'));
      assert.equal(long.clipped, true, 'long names are truncated in place'); assert.match(long.title, /v12\.pdf$/, 'the tooltip keeps the full name');
      assert.equal(new Set(metrics.map(item => item.bg)).size <= 3, true);
      if (mode === 'text') assert.ok(await page.$('.nmx-text-drop-indicator .nmx-text-drop-label'));
      if (mode === 'thread') {
        const box = await page.$eval('.nmx-thread-drop-overlay', element => { const r = element.getBoundingClientRect(), s = getComputedStyle(element); return { w: r.width, h: r.height, position: s.position, inset: s.inset, width: s.width, maxWidth: s.maxWidth }; });
        if (process.env.NMX_DEBUG) console.log(JSON.stringify(box));
        assert.ok(box.w > 700, 'the conversation overlay covers the conversation area');
      }
      if (mode === 'composer') assert.ok(await page.$('.nmx-composer-drop-overlay'));
      const font = await page.$eval('.nmx-attachment-text > b', element => getComputedStyle(element).fontFamily);
      assert.match(font, /NextMux Rounded/);
    }
  }
});
