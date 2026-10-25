import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const { build } = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url))('esbuild');
const bundle = await build({ entryPoints: [fileURLToPath(new URL('mcp-credential-fixture.tsx', import.meta.url))], bundle: true, write: false, platform: 'browser', format: 'iife', alias: { react: coreRequire.resolve('react'), 'react-dom/client': coreRequire.resolve('react-dom/client') }, logLevel: 'silent' });
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP credential fixture</title><link rel="stylesheet" href="/style.css"><style>html,body{margin:0;background:#171717;color:#ddd;font:13px system-ui;--theia-widget-border:#555;--theia-input-background:#252525;--theia-input-foreground:#eee;--theia-button-background:#665278;--theia-button-foreground:#fff;--theia-errorForeground:#ff9999}#fixture{padding:12px;box-sizing:border-box;width:100%;overflow-wrap:anywhere}#fixture>nav{display:flex;flex-wrap:wrap;gap:8px}main{box-sizing:border-box;margin-top:12px}output{display:block;margin-block:8px;overflow-wrap:anywhere}button:disabled{opacity:.5}</style></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>';
const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const body = path === '/' ? html : path === '/fixture.js' ? bundle.outputFiles[0].contents : path === '/style.css' ? await readFile(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url)) : '';
    response.writeHead(body ? 200 : 404, { 'content-type': path === '/fixture.js' ? 'text/javascript' : path === '/style.css' ? 'text/css' : 'text/html', 'cache-control': 'no-store' }); response.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(`MCP fixture: http://127.0.0.1:${server.address().port}/`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
