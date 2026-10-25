import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const { build } = desktopRequire('esbuild');
const bundle = () => build({ entryPoints: [fileURLToPath(new URL('agent-question-fixture.tsx', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife',
  alias: { 'react-dom/client': coreRequire.resolve('react-dom/client') }, logLevel: 'silent' });
await bundle();
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Isolated Agent Question Fixture</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/production.css"><style>
html,body,#fixture{margin:0;width:100%;height:100%;font:14px system-ui;background:#f7f7f7;color:#202020}
.fixture{height:100%;box-sizing:border-box;padding:12px;display:flex;flex-direction:column;gap:8px;--nmx-panel:#fff;--nmx-panel-2:#f2f2f2;--nmx-border:#ccc;--nmx-text:#202020;--nmx-muted:#666}
.fixture>nav{display:flex;flex-wrap:wrap;gap:6px}.fixture>p{margin:0}.fixture>output{display:block;max-height:64px;overflow:auto;overflow-wrap:anywhere;font-size:12px}
.fixture-stage{position:relative;min-height:0;flex:1;width:100%;display:block;background:transparent}.fixture-stage>.nmx-task-thread{height:100%;box-sizing:border-box;overflow:auto}
.fixture-stage>.nmx-composer-wrap{position:absolute;box-sizing:border-box;width:calc(100% - 16px);max-width:900px;margin:0;transform:translateX(-50%);left:50%;bottom:8px;top:auto;min-height:0}
.fixture-stage>.nmx-composer-wrap>.nmx-composer{box-sizing:border-box;height:130px;min-height:130px;padding:8px;background:#fff}
.fixture .nmx-composer>textarea{box-sizing:border-box;width:100%;height:72px;resize:none}.fixture .nmx-composer>div{height:32px;justify-content:space-between}
</style></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const body = path === '/' ? html : path === '/fixture.js' ? (await bundle()).outputFiles[0].contents
    : path === '/style.css' ? await readFile(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8')
      : path === '/production.css' ? await readFile(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url), 'utf8') : '';
  response.writeHead(body ? 200 : 404, { 'content-type': path === '/fixture.js' ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html',
    'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'" });
  response.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(`Isolated question fixture: http://127.0.0.1:${server.address().port}/`);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
