import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const { build } = desktopRequire('esbuild');
const bundle = () => build({ entryPoints: [fileURLToPath(new URL('conversation-archive-fixture.tsx', import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'iife',
    alias: { 'react-dom/client': coreRequire.resolve('react-dom/client') }, logLevel: 'silent' });
await bundle();
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Isolated Conversation Archive Fixture</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/production.css"><style>
html,body{margin:0;min-height:100%;font:14px system-ui;background:#181818;color:#eeecee;color-scheme:dark}*{box-sizing:border-box}
html[data-fixture-theme=light],html[data-fixture-theme=light] body{background:#f7f5f2;color:#272427;color-scheme:light}
.fixture{padding:16px;max-width:1100px;margin:auto;--theia-panel-border:#413d40;--theia-widget-border:#413d40;--theia-descriptionForeground:#b1adb1;--theia-foreground:#eeecee;--theia-input-background:#292628;--theia-input-foreground:#eeecee;--theia-input-border:#413d40;--theia-editorWidget-background:#211f20;--theia-button-background:#ca3b68;--theia-button-foreground:#fff;--theia-focusBorder:#a9a2a7}
.fixture[data-fixture-theme=light]{--nmx-bg:#f7f5f2;--nmx-text:#272427;--theia-panel-border:#d8d2d5;--theia-widget-border:#d8d2d5;--theia-descriptionForeground:#625c61;--theia-foreground:#272427;--theia-input-background:#fff;--theia-input-foreground:#272427;--theia-input-border:#d8d2d5;--theia-editorWidget-background:#f2efec;--theia-button-background:#2c282b;--theia-button-foreground:#fff;--theia-focusBorder:#595257}
.fixture>nav{display:flex;flex-wrap:wrap;gap:8px}.fixture>p{overflow-wrap:anywhere}.fixture>output{display:block;overflow-wrap:anywhere;font-size:12px;margin:12px 0}
.fixture select{font:inherit}.fixture .is-error{color:#ef8989;overflow-wrap:anywhere}.fixture[data-fixture-theme=light] .is-error{color:#963942}
</style></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>`;
const hostHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Archive QA — isolated container</title><style>body{font:14px system-ui;margin:12px;background:#eee}button{padding:8px;margin:4px}output{display:block;margin:8px;max-width:960px;overflow-wrap:anywhere}iframe{display:block;border:0;background:white;width:960px;height:680px}</style></head><body><button id="wide">960px container</button><button id="narrow">360px container</button><button id="measure">Measure layout</button><output id="metrics">No measurement yet</output><iframe title="Archive component fixture" src="/"></iframe><script src="/host.js"></script></body></html>`;
const hostScript = `const frame=document.querySelector('iframe');document.querySelector('#wide').onclick=()=>frame.style.width='960px';document.querySelector('#narrow').onclick=()=>frame.style.width='360px';document.querySelector('#measure').onclick=()=>{const d=frame.contentDocument,p=d.querySelector('.nmx-conversation-archive'),list=d.querySelector('.nmx-archive-conversations');document.querySelector('#metrics').textContent=JSON.stringify({viewport:frame.contentWindow.innerWidth,pageWidth:d.documentElement.scrollWidth,panelWidth:p?.getBoundingClientRect().width,direction:d.querySelector('main')?.dir,listHeight:list?.clientHeight,listScroll:list?.scrollHeight,buttons:[...p.querySelectorAll('button')].map(b=>({text:b.textContent,disabled:b.disabled,width:Math.round(b.getBoundingClientRect().width)}))});};`;
const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const body = path === '/' ? html : path === '/host' ? hostHtml : path === '/host.js' ? hostScript : path === '/fixture.js' ? (await bundle()).outputFiles[0].contents
        : path === '/style.css' ? await readFile(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8')
        : path === '/production.css' ? await readFile(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url), 'utf8') : '';
    response.writeHead(body ? 200 : 404, { 'content-type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html',
        'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'" });
    response.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(`Isolated archive fixture: http://127.0.0.1:${server.address().port}/`);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
