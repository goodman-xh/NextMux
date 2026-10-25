#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fixtureEntry } from '../packages/theia-nextmux-extension/test/helpers/work-context-layout-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const extension = createRequire(new URL('../packages/theia-nextmux-extension/package.json', import.meta.url));
const core = createRequire(extension.resolve('@theia/core/package.json'));
const bundle = await desktop('esbuild').build({ stdin: { contents: fixtureEntry, sourcefile: 'fixture.tsx', loader: 'tsx', resolveDir: root },
  bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent',
  alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client') } });
const styles = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name =>
  readFile(new URL(`../packages/theia-nextmux-extension/src/browser/style/${name}`, import.meta.url))));
const html = `<!doctype html><html><head><meta charset="utf-8"><title>NextMux isolated pane layout</title>
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/production.css"><link rel="stylesheet" href="/codicon.css">
<style>html,body{margin:0;font:14px system-ui;background:#292929}*{box-sizing:border-box}
.fixture-shell.nmx-shell{display:block!important;min-width:0!important;width:100%;height:100vh}
.nmx-work-context{position:relative!important;inset:auto!important;width:var(--fixture-width,297px);height:680px;margin:12px}
.nmx-work-context.is-editor-maximized{width:min(900px,calc(100vw - 24px))}
.fixture-editor{flex:1;width:100%;min-width:0;resize:none;color:inherit;background:transparent;padding:12px}
.fixture-controls{position:fixed;bottom:4px;right:4px;display:flex;gap:6px;color:white;background:#333;padding:8px}
</style></head><body><div class="nmx-desktop-widget" id="nextmux.desktop.widget"><div id="fixture"></div></div>
<script src="/fixture.js"></script></body></html>`;
const values = { '/': ['text/html', html], '/fixture.js': ['text/javascript', bundle.outputFiles[0].contents],
  '/style.css': ['text/css', styles[0]], '/production.css': ['text/css', styles[1]],
  '/codicon.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))],
  '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))] };
const server = createServer((request, response) => {
  const route = new URL(request.url, 'http://127.0.0.1').pathname;
  const value = request.method === 'GET' ? values[route] : undefined;
  response.writeHead(value ? 200 : 404, { 'content-type': value?.[0] || 'text/plain', 'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; font-src 'self'; img-src 'none'" });
  response.end(value?.[1] || 'Not found');
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, scope: 'synthetic rendering only; no RPC or user data' })));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.closeAllConnections(); server.close(); });
