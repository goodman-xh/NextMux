import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const { build } = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url))('esbuild');
const bundle = await build({ entryPoints: [fileURLToPath(new URL('project-memory-fixture.tsx', import.meta.url))], bundle: true, write: false, outdir: '/virtual', platform: 'browser', format: 'iife', alias: { react: coreRequire.resolve('react'), 'react-dom/client': coreRequire.resolve('react-dom/client') }, logLevel: 'silent' });
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).contents, css = bundle.outputFiles.find(file => file.path.endsWith('.css')).contents;
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Project memory review</title><link rel="stylesheet" href="/style.css"><style>html,body{margin:0;font:13px system-ui;--theia-foreground:#242628;--theia-editor-background:#fff;--theia-panel-border:#d9dadd;--theia-input-background:#f7f8fa;--theia-input-foreground:#222;--theia-list-hoverBackground:#eff1f4;--theia-list-activeSelectionBackground:#e3edfc;--theia-list-activeSelectionForeground:#153961;--theia-button-background:#2760a4;--theia-button-foreground:#fff;--theia-focusBorder:#2760a4}#status{position:fixed;bottom:4px;left:4px;z-index:2000}</style></head><body><div id="fixture"></div><output id="status"></output><script src="/fixture.js"></script></body></html>';
const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const body = path === '/' ? html : path === '/fixture.js' ? script : path === '/style.css' ? css : '';
    response.writeHead(body ? 200 : 404, { 'content-type': path === '/fixture.js' ? 'text/javascript' : path === '/style.css' ? 'text/css' : 'text/html', 'cache-control': 'no-store' }); response.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(`Project memory fixture: http://127.0.0.1:${server.address().port}/`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
