import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { AgentToolRegistry } from '@nextmux/agent-runtime';
import { drawioUrl, registerDeveloperTools } from '../lib/node/nextmux-developer-tools.js';
import { normalizeSafeBrowserUrl } from '../lib/browser/nextmux-browser-url.js';
import { activityToolVisual } from '../lib/browser/nextmux-conversation-stream-model.js';

const call = (registry, name, args, permission = 'read_only') =>
  registry.execute({ id: `call-${name}-${Math.random().toString(16).slice(2)}`, name, arguments: args }, permission, { runId: 'developer-tools-test' });

function decodeDrawio(url) {
  const parsed = new URL(url);
  const payload = JSON.parse(decodeURIComponent(parsed.hash.replace(/^#create=/, '')));
  return { parsed, payload, content: decodeURIComponent(inflateRawSync(Buffer.from(payload.data, 'base64')).toString('utf8')) };
}

test('draw.io links carry the diagram only in the fragment, compressed like @drawio/mcp', () => {
  const mermaid = 'flowchart TD\n  A[开始] --> B{检查}\n  B -->|通过| C[发布]';
  const { parsed, payload, content } = decodeDrawio(drawioUrl('mermaid', mermaid));
  assert.equal(parsed.origin, 'https://app.diagrams.net');
  assert.equal(parsed.pathname, '/');
  assert.deepEqual(Object.fromEntries(parsed.searchParams), { grid: '0', pv: '0', border: '10', edit: '_blank' });
  assert.equal(payload.type, 'mermaid');
  assert.equal(payload.compressed, true);
  assert.equal(content, mermaid);
  assert.equal(new URL(drawioUrl('xml', '<mxfile/>', { dark: true })).searchParams.get('dark'), '1');
});

test('the in-app browser accepts long draw.io editor links but keeps the 2,000 character limit elsewhere', () => {
  const big = Array.from({ length: 400 }, (_, index) => `  N${index}[节点 ${index} ${Math.random().toString(36).slice(2)}] --> N${index + 1}`).join('\n');
  const url = drawioUrl('mermaid', `flowchart LR\n${big}`);
  assert.ok(url.length > 2_000);
  assert.equal(normalizeSafeBrowserUrl(url), url);
  assert.equal(normalizeSafeBrowserUrl(`https://app.diagrams.net/?q=${'x'.repeat(2_100)}`), undefined, 'long query without a fragment');
  assert.equal(normalizeSafeBrowserUrl(`https://app.diagrams.net.evil.test/#${'x'.repeat(2_100)}`), undefined);
  assert.equal(normalizeSafeBrowserUrl(`https://example.test/#${'x'.repeat(2_100)}`), undefined);
});

test('docs.search asks Context7 without a key and returns compact matches', async () => {
  const requests = [];
  const registry = new AgentToolRegistry();
  registerDeveloperTools(registry, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), headers: init.headers });
      return new Response(JSON.stringify({ results: [
        { id: '/vercel/next.js', title: 'Next.js', description: 'The React framework', trustScore: 10, totalSnippets: 3000, versions: ['v15.1.0', 7] },
        { id: 'not-a-library-id', title: 'Broken' }
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const descriptors = registry.descriptors('read_only').map(tool => tool.name);
  assert.ok(['docs.search', 'docs.fetch', 'diagram.open'].every(name => descriptors.includes(name)), 'available in every permission mode');
  const result = await call(registry, 'docs.search', { libraryName: 'next.js', query: 'middleware redirects' });
  assert.equal(result.ok, true);
  const url = new URL(requests[0].url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://context7.com/api/v2/libs/search');
  assert.equal(url.searchParams.get('libraryName'), 'next.js');
  assert.equal(url.searchParams.get('query'), 'middleware redirects');
  assert.equal(requests[0].headers['X-Context7-Source'], 'nextmux');
  assert.ok(!Object.keys(requests[0].headers).some(name => /authorization/i.test(name)), 'no key is sent');
  assert.deepEqual(result.output.results, [{ id: '/vercel/next.js', title: 'Next.js', description: 'The React framework', trustScore: 10, snippets: 3000, versions: ['v15.1.0'] }]);
});

test('docs.fetch returns bounded text and names rate limits clearly', async () => {
  let status = 200;
  const registry = new AgentToolRegistry();
  registerDeveloperTools(registry, {
    fetch: async url => status === 200
      ? new Response(`# ${new URL(url).searchParams.get('libraryId')}\n${'x'.repeat(40_000)}`, { status })
      : new Response('slow down', { status })
  });
  const ok = await call(registry, 'docs.fetch', { libraryId: '/vercel/next.js', query: 'middleware' });
  assert.equal(ok.ok, true);
  assert.match(ok.output, /^# \/vercel\/next\.js/);
  assert.ok(ok.output.length < 30_100);
  assert.match(ok.output, /truncated/);
  status = 429;
  const limited = await call(registry, 'docs.fetch', { libraryId: '/vercel/next.js', query: 'middleware' });
  assert.equal(limited.ok, false);
  assert.equal(limited.error.code, 'DOCS_RATE_LIMITED');
  const invalid = await call(registry, 'docs.fetch', { libraryId: 'next.js', query: 'middleware' });
  assert.equal(invalid.ok, false);
});

test('diagram.open opens the editor in the conversation browser and falls back to the link', async () => {
  const opened = [];
  let browserAvailable = true;
  const registry = new AgentToolRegistry();
  registerDeveloperTools(registry, {
    fetch: async () => { throw new Error('no network in this test'); },
    openInBrowser: async url => { opened.push(url); return browserAvailable; }
  });
  const shown = await call(registry, 'diagram.open', { kind: 'mermaid', content: 'sequenceDiagram\n  A->>B: 你好' });
  assert.equal(shown.ok, true);
  assert.equal(shown.output.opened, true);
  assert.equal(decodeDrawio(opened[0]).content, 'sequenceDiagram\n  A->>B: 你好');
  browserAvailable = false;
  const fallback = await call(registry, 'diagram.open', { kind: 'csv', content: '## label: %name%\nname\nA' });
  assert.equal(fallback.output.opened, false);
  assert.match(fallback.output.url, /^https:\/\/app\.diagrams\.net\/\?/);
});

test('conversation rows show docs and diagram tools with their own verbs and icons', () => {
  assert.deepEqual(activityToolVisual('docs.search'), { kind: 'search', icon: 'book' });
  assert.deepEqual(activityToolVisual('docs.fetch'), { kind: 'read', icon: 'book' });
  assert.deepEqual(activityToolVisual('diagram.open'), { kind: 'create', icon: 'type-hierarchy' });
  assert.deepEqual(activityToolVisual('github.read'), { kind: 'read', icon: 'github' });
  assert.deepEqual(activityToolVisual('github.write'), { kind: 'tool', icon: 'github' });
});

test('docs.fetch converts HTML documentation to Markdown unless raw is true', async () => {
  const htmlDoc = '<!doctype html><html><body><h1>Middleware</h1><p>Use <code>NextResponse.redirect()</code>.</p></body></html>';
  const registry = new AgentToolRegistry();
  registerDeveloperTools(registry, {
    fetch: async () => new Response(htmlDoc, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  });
  const md = await call(registry, 'docs.fetch', { libraryId: '/vercel/next.js', query: 'middleware' });
  assert.equal(md.ok, true);
  assert.match(md.output, /^# Middleware/m);
  assert.match(md.output, /`NextResponse\.redirect\(\)`/);
  assert.doesNotMatch(md.output, /<html>|<body>|<h1>/);

  const raw = await call(registry, 'docs.fetch', { libraryId: '/vercel/next.js', query: 'middleware', raw: true });
  assert.equal(raw.ok, true);
  assert.match(raw.output, /<h1>Middleware<\/h1>/);
});
