import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const { build } = desktopRequire('esbuild');
const bundle = () => build({ entryPoints: [fileURLToPath(new URL('access-archive-fixture.tsx', import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'iife',
    alias: { 'react-dom/client': coreRequire.resolve('react-dom/client') }, logLevel: 'silent' });
await bundle();
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Isolated MCP Access + Archive QA</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/production.css"><style>
html,body{margin:0;min-height:100%;font:14px system-ui;background:#f7f7f7;color:#202020}*{box-sizing:border-box}
.fixture{padding:12px;width:100%;margin:auto;--theia-panel-border:#ccc;--theia-widget-border:#ccc;--theia-descriptionForeground:#666;--theia-foreground:#202020;--theia-input-background:#fff;--theia-input-foreground:#202020;--theia-input-border:#bbb;--theia-errorForeground:#a00000}
.fixture>nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.fixture>nav label{min-width:0;display:flex;gap:5px;align-items:center}.fixture>nav select{max-width:100%;min-width:0}
.fixture>p,.fixture>output{overflow-wrap:anywhere}.fixture>output{display:block;font-size:12px;margin:12px 0}.fixture-stage.nmx-shell{display:block;height:auto}
.fixture>nav button,.fixture>nav select{font:inherit}.fixture>nav button{padding:8px;border:1px solid #aaa;border-radius:6px;color:#202020;background:#fff;white-space:normal}.fixture>nav button:disabled{opacity:.5}
</style></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer(async (request, response) => {
    try {
        const path = new URL(request.url, 'http://127.0.0.1').pathname;
        const body = path === '/' ? html : path === '/fixture.js' ? (await bundle()).outputFiles[0].contents
            : path === '/style.css' ? await readFile(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8')
            : path === '/production.css' ? await readFile(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url), 'utf8') : '';
        response.writeHead(body ? 200 : 404, { 'content-type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html',
            'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'" });
        response.end(body);
    } catch { response.writeHead(500); response.end('Fixture build failed.'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(`Isolated MCP + archive fixture: http://127.0.0.1:${server.address().port}/`);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
