import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import * as tls from 'node:tls';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentToolRegistry } from '@nextmux/agent-runtime';
import { readPublicWebPage, registerPublicWebReaderTool } from '../lib/node/nextmux-public-web-reader.js';

const publicIp = '93.184.216.34';
const lookupImpl = async () => [{ address: publicIp, family: 4 }];
const resolveNetworkRoute = async () => ({ kind: 'direct' });
const html = (body, extra = {}) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...extra } });
const mockOptions = fetchImpl => ({ lookupImpl, resolveNetworkRoute, fetchImpl });

test('HTML parser extracts entities/title and omits nested script/style/nav/hidden content', async () => {
    let request;
    const page = await readPublicWebPage({ url: 'https://reader.example.com/article#heading', ...mockOptions(async (url, init) => {
        request = { url, init };
        return html('<!doctype html><html><head><title>Public &amp; Reliable</title><style>secret style</style><script>secret head script</script></head><body><nav><b>secret nav</b></nav><main><h1>Source &amp; evidence</h1><p>Useful <strong>facts</strong>.</p><script>ignore <fake>bad</fake></script><div hidden>hidden contents</div><div aria-hidden="true"><p>nested hidden</p></div><p>After hidden</p><div style="display: none">hidden style</div></main></body></html>');
    }) });
    assert.equal(page.source, 'public_http');
    assert.equal(page.sourceContentIsUntrusted, true);
    assert.equal(page.title, 'Public & Reliable');
    assert.match(page.content, /Source & evidence/);
    assert.match(page.content, /Useful facts\./);
    assert.match(page.content, /After hidden/);
    assert.doesNotMatch(page.content, /secret|ignore|hidden contents|nested hidden|hidden style|fake/);
    assert.equal(page.url, 'https://reader.example.com/article');
    assert.equal(request.url, page.url);
    assert.equal(request.init.redirect, 'manual');
    assert.equal(request.init.credentials, 'omit');
    assert.equal(request.init.referrerPolicy, 'no-referrer');
    assert.deepEqual(Object.keys(request.init.headers).sort(), ['accept', 'user-agent']);
    assert.equal(page.truncated, false);
});

test('public URL and DNS checks reject private/reserved/mapped/mixed targets before dispatch', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return html('never'); };
    for (const url of ['file:///tmp/source', 'https://name:key@reader.example.com', 'http://localhost/', 'http://private.internal/', 'http://private.local/', 'http://127.1/', 'http://0x7f000001/', 'http://2130706433/', 'http://10.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[64:ff9b::a00:1]/', 'http://192.0.2.5/', 'https://reader.example.com/' + 'x'.repeat(2048)]) {
        await assert.rejects(readPublicWebPage({ url, ...mockOptions(fetchImpl) }), error => ['INVALID_INPUT', 'PUBLIC_URL_REQUIRED'].includes(error.code), url);
    }
    for (const addresses of [[], [{ address: '192.168.1.2', family: 4 }], [{ address: '169.254.169.254', family: 4 }], [{ address: '100.64.1.1', family: 4 }], [{ address: '2001:db8::1', family: 6 }], [{ address: publicIp, family: 4 }, { address: '::1', family: 6 }], [{ address: publicIp, family: 6 }]]) {
        await assert.rejects(readPublicWebPage({ url: 'https://reader.example.com/', ...mockOptions(fetchImpl), lookupImpl: async () => addresses }), { code: 'PUBLIC_DNS_REQUIRED' });
    }
    assert.equal(calls, 0);
});

test('each redirect is revalidated/resolved/routed; private redirect dispatch is blocked', async () => {
    const lookups = [], routes = [], calls = [];
    const options = {
        lookupImpl: async host => { lookups.push(host); return [{ address: publicIp, family: 4 }]; },
        resolveNetworkRoute: async url => { routes.push(url.hostname); return { kind: 'direct' }; },
        fetchImpl: async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://second.example.com/read', 'set-cookie': 'secret=not-forwarded' } }) : html('<p>Redirected source</p>'); }
    };
    const page = await readPublicWebPage({ ...options, url: 'https://first.example.com/start' });
    assert.deepEqual(lookups, ['first.example.com', 'second.example.com']);
    assert.deepEqual(routes, lookups);
    assert.equal(page.finalUrl, 'https://second.example.com/read');
    assert.equal(page.redirects, 1);
    assert.equal(calls[1].init.headers.cookie, undefined);
    let dispatches = 0;
    await assert.rejects(readPublicWebPage({ url: 'https://first.example.com/', ...mockOptions(async () => { dispatches++; return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }); }) }), { code: 'PUBLIC_URL_REQUIRED' });
    assert.equal(dispatches, 1);
    let resolves = 0;
    await assert.rejects(readPublicWebPage({ url: 'https://first.example.com/', ...mockOptions(async () => new Response(null, { status: 302, headers: { location: 'https://rebinding.example.com/' } })), lookupImpl: async () => [{ address: ++resolves === 1 ? publicIp : '10.1.1.1', family: 4 }] }), { code: 'PUBLIC_DNS_REQUIRED' });
    assert.equal(resolves, 2);
});

test('redirect cycles/limit, binary responses and body limits are bounded', async () => {
    await assert.rejects(readPublicWebPage({ url: 'https://reader.example.com/', ...mockOptions(async () => new Response(null, { status: 301, headers: { location: '/' } })) }), { code: 'PUBLIC_REDIRECT_LOOP' });
    let redirects = 0;
    await assert.rejects(readPublicWebPage({ url: 'https://reader.example.com/', ...mockOptions(async () => new Response(null, { status: 302, headers: { location: `/step${++redirects}` } })) }), { code: 'PUBLIC_REDIRECT_LIMIT' });
    assert.equal(redirects, 6);
    await assert.rejects(readPublicWebPage({ url: 'https://reader.example.com/', ...mockOptions(async () => new Response('PDF', { headers: { 'content-type': 'application/pdf' } })) }), { code: 'PUBLIC_CONTENT_TYPE_UNSUPPORTED' });
    await assert.rejects(readPublicWebPage({ url: 'https://reader.example.com/', ...mockOptions(async () => html('small', { 'content-length': String(2 * 1024 * 1024 + 1) })) }), { code: 'PUBLIC_RESPONSE_TOO_LARGE' });
    let cancelled = false;
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(512 * 1024)); }, cancel() { cancelled = true; } });
    await assert.rejects(readPublicWebPage({ url: 'https://reader.example.com/', ...mockOptions(async () => new Response(stream, { headers: { 'content-type': 'text/plain' } })) }), { code: 'PUBLIC_RESPONSE_TOO_LARGE' });
    assert.equal(cancelled, true);
    const page = await readPublicWebPage({ url: 'https://reader.example.com/', ...mockOptions(async () => html(`<p>${'x'.repeat(30_000)}</p>`)) });
    assert.ok(page.content.length <= 20_000);
    assert.equal(page.truncated, true);
});

test('unsupported configured proxy never falls back to direct; cancellation stops before network', async () => {
    let calls = 0;
    const common = { url: 'https://reader.example.com/', ...mockOptions(async () => { calls++; return html('never'); }) };
    await assert.rejects(readPublicWebPage({ ...common, resolveNetworkRoute: async () => ({ kind: 'unsupported', reason: 'socks5' }) }), { code: 'PUBLIC_PROXY_UNSUPPORTED' });
    await assert.rejects(readPublicWebPage({ ...common, resolveNetworkRoute: async () => ({ kind: 'http_proxy', uri: 'socks5://localhost:1080' }) }), { code: 'PUBLIC_PROXY_UNSUPPORTED' });
    await assert.rejects(readPublicWebPage({ ...common, resolveNetworkRoute: async () => ({ kind: 'malformed_route' }) }), { code: 'PUBLIC_PROXY_UNSUPPORTED' });
    await assert.rejects(readPublicWebPage({ ...common, resolveNetworkRoute: async () => { throw new Error('proxy-secret'); } }), error => error.code === 'PUBLIC_NETWORK_ROUTE_FAILED' && !error.message.includes('proxy-secret'));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(readPublicWebPage({ ...common, signal: controller.signal }), { code: 'CANCELLED' });
    const pending = new AbortController();
    const read = readPublicWebPage({ ...common, signal: pending.signal, lookupImpl: () => new Promise(() => {}) });
    pending.abort();
    await assert.rejects(read, { code: 'CANCELLED' });
    assert.equal(calls, 0);
});

test('a whole-page deadline bounds stalled headers/body and releases the reader for fallback', async () => {
    const common = { url: 'https://reader.example.com/', timeoutMs: 30, lookupImpl, resolveNetworkRoute };
    let requestSignal;
    await assert.rejects(readPublicWebPage({ ...common, fetchImpl: async (_url, init) => {
        requestSignal = init.signal;
        return new Promise(() => {});
    } }), { code: 'PUBLIC_READ_TIMEOUT' });
    assert.equal(requestSignal.aborted, true);
    let bodyCancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('source prefix')); }, cancel() { bodyCancelled = true; } });
    await assert.rejects(readPublicWebPage({ ...common, fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/plain' } }) }), { code: 'PUBLIC_READ_TIMEOUT' });
    assert.equal(bodyCancelled, true);
    await assert.rejects(readPublicWebPage({ ...common, lookupImpl: () => new Promise(() => {}), fetchImpl: async () => html('never') }), { code: 'PUBLIC_READ_TIMEOUT' });
    const completed = await readPublicWebPage({ ...common, fetchImpl: async () => html('<p>Next source works</p>') });
    assert.equal(completed.content, 'Next source works');
});

async function listen(server) {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return server.address().port;
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }

test('real HTTP/HTTPS CONNECT pins validated IP while preserving source Host, TLS SNI/cert validation and proxy auth isolation', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'nextmux-public-reader-test-'));
    const originalCa = tls.getCACertificates('default');
    const keyPath = join(temp, 'key.pem'), certPath = join(temp, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=reader-source.example.com', '-addext', 'subjectAltName=DNS:reader-source.example.com,DNS:localhost'], { stdio: 'ignore' });
    const key = await readFile(keyPath), cert = await readFile(certPath, 'utf8');
    tls.setDefaultCACertificates([...originalCa, cert]);
    const sourceRequests = [], serverNames = [], sockets = new Set();
    const sourceHandler = (req, res) => { sourceRequests.push(req.headers); res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Real source</title><p>Verified source content</p>'); };
    const source = createHttpsServer({ key, cert }, sourceHandler);
    const plainSource = createHttpServer(sourceHandler);
    source.on('secureConnection', socket => serverNames.push(socket.servername));
    source.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    const sourcePort = await listen(source);
    const plainSourcePort = await listen(plainSource);
    const connectRecords = [];
    try {
        for (const protocol of ['http', 'https']) {
            const proxy = protocol === 'https' ? createHttpsServer({ key, cert }) : createHttpServer();
            proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
            proxy.on('connect', (req, client, head) => {
                connectRecords.push({ protocol, authority: req.url, headers: req.headers });
                const target = connect(req.url.endsWith(':80') ? plainSourcePort : sourcePort, '127.0.0.1', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) target.write(head); client.pipe(target); target.pipe(client); });
                sockets.add(target); target.on('close', () => sockets.delete(target));
                target.on('error', () => client.destroy()); client.on('error', () => target.destroy());
            });
            const proxyPort = await listen(proxy);
            const resolveNetworkRoute = async () => ({ kind: 'http_proxy', uri: `${protocol}://proxy-user:proxy-secret@localhost:${proxyPort}` });
            try {
                for (const sourceProtocol of ['http', 'https']) {
                    const page = await readPublicWebPage({ url: `${sourceProtocol}://reader-source.example.com/page`, lookupImpl, resolveNetworkRoute });
                    assert.equal(page.title, 'Real source');
                    assert.match(page.content, /Verified source content/);
                }
                await assert.rejects(readPublicWebPage({ url: 'https://wrong-source.example.com/page', lookupImpl, resolveNetworkRoute }), { code: 'PUBLIC_NETWORK_FAILED' });
            } finally { for (const socket of sockets) socket.destroy(); await close(proxy); }
        }
        assert.equal(sourceRequests.length, 4);
        for (const headers of sourceRequests) {
            assert.equal(headers.host, 'reader-source.example.com');
            assert.equal(headers['proxy-authorization'], undefined);
            assert.equal(headers.authorization, undefined);
            assert.equal(headers.cookie, undefined);
        }
        assert.deepEqual(serverNames, ['reader-source.example.com', 'reader-source.example.com']);
        assert.equal(connectRecords.length, 6);
        for (const record of connectRecords) {
            assert.ok([`${publicIp}:443`, `${publicIp}:80`].includes(record.authority));
            assert.equal(record.headers.host, record.authority);
            assert.match(record.headers['proxy-authorization'], /^Basic /);
        }
    } finally {
        for (const socket of sockets) socket.destroy();
        await close(source);
        await close(plainSource);
        tls.setDefaultCACertificates(originalCa);
        await rm(temp, { recursive: true, force: true });
    }
});

test('universal tool registration is read-only and returns public source provenance without internal model usage', async () => {
    const registry = new AgentToolRegistry();
    registerPublicWebReaderTool(registry, mockOptions(async () => html('<title>Public source</title><p>Text evidence</p>')));
    const descriptors = registry.descriptors('read_only');
    const descriptor = descriptors.find(item => item.name === 'web.read_page');
    assert.equal(descriptor.requiredPermission, 'read_only');
    assert.equal(descriptor.executionKind, 'read');
    assert.equal(descriptor.concurrencySafe, true);
    const result = await registry.execute({ id: 'read', name: 'web.read_page', arguments: { url: 'https://reader.example.com/' } }, 'read_only', { runId: 'read-test', permissionMode: 'read_only' });
    assert.equal(result.ok, true);
    assert.equal(result.output.source, 'public_http');
    assert.equal(result.output.status, 'ok');
    assert.equal(result.output.sources[0].url, 'https://reader.example.com/');
    assert.equal(result.usage, undefined);
});

test('HTML to structured Markdown preserves headings, fenced code blocks, inline code, lists, tables and links, plus JSON/XML/YAML/CSV content types', async () => {
    const richHtml = [
        '<!doctype html><html><head><title>API Guide</title></head><body>',
        '<h1>Overview</h1>',
        '<p>Use <code>fetchData()</code> from the <a href="https://docs.example.com/sdk">SDK docs</a>.</p>',
        '<h2>Example</h2>',
        '<pre><code class="language-ts">const res = await fetchData();\nconsole.log(res);</code></pre>',
        '<ul><li>First step</li><li>Second step</li></ul>',
        '<table><tr><th>Field</th><th>Type</th></tr><tr><td>id</td><td>string</td></tr></table>',
        '<footer>Copyright 2026</footer>',
        '</body></html>'
    ].join('');
    const page = await readPublicWebPage({ url: 'https://reader.example.com/guide', ...mockOptions(async () => html(richHtml)) });
    assert.equal(page.title, 'API Guide');
    assert.match(page.content, /^# Overview/m);
    assert.match(page.content, /`fetchData\(\)`/);
    assert.match(page.content, /\[SDK docs\]\(https:\/\/docs\.example\.com\/sdk\)/);
    assert.match(page.content, /^## Example/m);
    assert.match(page.content, /```ts\nconst res = await fetchData\(\);\nconsole\.log\(res\);\n```/);
    assert.match(page.content, /^- First step\n- Second step/m);
    assert.match(page.content, /\| Field \| Type \|\n\| --- \| --- \|\n\| id \| string \|/);
    assert.doesNotMatch(page.content, /Copyright 2026/);

    const jsonPage = await readPublicWebPage({
        url: 'https://reader.example.com/data.json',
        ...mockOptions(async () => new Response('{"status":"ok","items":[1,2]}', { headers: { 'content-type': 'application/json; charset=utf-8' } }))
    });
    assert.equal(jsonPage.contentType, 'application/json');
    assert.match(jsonPage.content, /"status": "ok"/);

    for (const [mime, body] of [
        ['application/xml', '<root><item>val</item></root>'],
        ['text/yaml', 'name: nextmux\nversion: 1'],
        ['text/csv', 'id,name\n1,Alice']
    ]) {
        const res = await readPublicWebPage({
            url: 'https://reader.example.com/data',
            ...mockOptions(async () => new Response(body, { headers: { 'content-type': mime } }))
        });
        assert.equal(res.contentType, mime);
        assert.equal(res.content, body);
    }
});
