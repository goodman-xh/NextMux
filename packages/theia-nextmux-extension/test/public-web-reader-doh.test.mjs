import test from 'node:test';
import assert from 'node:assert/strict';
import { isIP, connect } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as tls from 'node:tls';
import ipaddr from 'ipaddr.js';
import { allBenchmarkDnsAddresses, trustedDohAddresses } from '../lib/node/nextmux-public-dns.js';
import { readPublicWebPage } from '../lib/node/nextmux-public-web-reader.js';

const hostname = 'reader.example.com';
const sourceUrl = `https://${hostname}/article`;
const fakeLookup = async () => [{ address: '198.18.0.7', family: 4 }];
const direct = async () => ({ kind: 'direct' });
const publicV4 = '93.184.216.34';
const publicV6 = '2606:4700:4700::1111';
const isPublic = value => isIP(value) && ipaddr.process(value).range() === 'unicast';
const answer = (type, addresses = type === 1 ? [publicV4] : [], name = hostname) => ({ Status: 0, TC: false, CD: false,
    Question: [{ name: `${name}.`, type }], Answer: addresses.map(data => ({ name: `${name}.`, type, TTL: 60, data })) });
const dnsResponse = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/dns-json' } });
const html = () => new Response('<title>Verified page</title><p>Public text</p>', { headers: { 'content-type': 'text/html' } });
const queries = [];
function fetchAnswers(overrides = {}) {
    return async (url, init) => {
        const parsed = new URL(url);
        if (parsed.hostname !== 'cloudflare-dns.com') return html();
        queries.push({ url: parsed, init });
        const type = Number(parsed.searchParams.get('type'));
        return dnsResponse(overrides[type] ?? answer(type, undefined, parsed.searchParams.get('name')));
    };
}

test('only complete valid IPv4 benchmark DNS results qualify for fallback', () => {
    assert.equal(allBenchmarkDnsAddresses([{ address: '198.18.0.0', family: 4 }, { address: '198.19.255.255', family: 4 }]), true);
    for (const addresses of [[], [{ address: '198.17.0.1', family: 4 }], [{ address: '198.20.0.1', family: 4 }],
        [{ address: '198.18.999.1', family: 4 }], [{ address: '198.18.0.1', family: 6 }],
        [{ address: '::ffff:198.18.0.1', family: 6 }], [{ address: '198.18.0.1', family: 4 }, { address: '10.0.0.1', family: 4 }],
        [{ address: '198.18.0.1', family: 4 }, { address: publicV4, family: 4 }], Array(65).fill({ address: '198.18.0.1', family: 4 })]) {
        assert.equal(allBenchmarkDnsAddresses(addresses), false);
    }
});

test('trusted answers bind exact question, type, owner and a bounded CNAME chain', () => {
    const chained = { ...answer(1), Answer: [
        { name: 'final.example.com.', type: 1, TTL: 10, data: publicV4 },
        { name: `${hostname}.`, type: 5, TTL: 10, data: 'alias.example.com.' },
        { name: 'alias.example.com.', type: 5, TTL: 10, data: 'final.example.com.' }
    ] };
    assert.deepEqual(trustedDohAddresses(chained, hostname, 1, isPublic), [{ address: publicV4, family: 4 }]);
    assert.deepEqual(trustedDohAddresses(answer(28, [publicV6]), hostname, 28, isPublic), [{ address: publicV6, family: 6 }]);
    assert.deepEqual(trustedDohAddresses({ ...answer(28), Answer: undefined }, hostname, 28, isPublic), []);
    const bad = [
        { ...answer(1), Question: [{ name: 'other.example.com.', type: 1 }] },
        { ...answer(1), Question: [{ name: `${hostname}.`, type: 28 }] },
        { ...answer(1), TC: true }, { ...answer(1), CD: true }, { ...answer(1), Status: 3 },
        answer(1, [publicV4, '10.0.0.1']), answer(1, ['198.18.0.1']), answer(28, ['::ffff:127.0.0.1']),
        answer(1, ['not-an-address']), answer(1, [publicV6]),
        { ...answer(1), Answer: [{ name: 'other.example.com.', type: 1, TTL: 10, data: publicV4 }] },
        { ...answer(1), Answer: [{ name: `${hostname}.`, type: 5, TTL: 10, data: hostname }] },
        { ...answer(1), Answer: [{ name: `${hostname}.`, type: 5, TTL: 10, data: 'alias.example.com.' }, { name: 'alias.example.com.', type: 5, TTL: 10, data: hostname }] },
        { ...answer(1), Answer: [{ name: `${hostname}.`, type: 5, TTL: 10, data: 'private.internal.' }] },
        { ...answer(1), Answer: [{ name: `${hostname}.`, type: 5, TTL: 10, data: 'bad..example.com.' }] },
        { ...answer(1), Answer: [{ name: `${hostname}.`, type: 99, TTL: 10, data: publicV4 }] },
        { ...answer(1), Answer: [{ name: `${hostname}.`, type: 1, TTL: -1, data: publicV4 }] }
    ];
    for (const value of bad) assert.throws(() => trustedDohAddresses(value, hostname, 1, isPublic), { code: 'PUBLIC_DNS_REQUIRED' });
});

test('benchmark DNS invokes exactly two fixed, credential-free queries then reads the original public URL', async () => {
    queries.length = 0;
    const routes = [], requests = [];
    const mocked = fetchAnswers();
    const page = await readPublicWebPage({ url: sourceUrl, lookupImpl: fakeLookup,
        resolveNetworkRoute: async url => { routes.push(url.href); return { kind: 'direct' }; },
        fetchImpl: async (url, init) => { requests.push(url); return mocked(url, init); } });
    assert.equal(page.content, 'Public text');
    assert.equal(page.finalUrl, sourceUrl);
    assert.equal(queries.length, 2);
    assert.deepEqual(queries.map(q => q.url.searchParams.get('type')).sort(), ['1', '28']);
    assert.equal(routes.length, 3);
    assert.deepEqual(routes.slice(0, 2).sort(), queries.map(query => query.url.href).sort());
    assert.equal(routes[2], sourceUrl);
    assert.equal(requests.filter(url => url === sourceUrl).length, 1);
    for (const { url, init } of queries) {
        assert.equal(url.origin, 'https://cloudflare-dns.com');
        assert.equal(url.pathname, '/dns-query');
        assert.equal(url.searchParams.get('name'), hostname);
        assert.equal(url.searchParams.get('cd'), 'false');
        assert.equal(init.redirect, 'error');
        assert.equal(init.credentials, 'omit');
        assert.equal(init.referrerPolicy, 'no-referrer');
        assert.deepEqual(Object.keys(init.headers).sort(), ['accept', 'user-agent']);
    }
});

test('literal, private, malformed and mixed system DNS never call DoH', async () => {
    let requests = 0;
    const fetchImpl = async () => { requests++; return html(); };
    for (const url of ['https://198.18.0.7/', 'https://[::ffff:198.18.0.7]/', 'https://localhost/']) {
        await assert.rejects(readPublicWebPage({ url, lookupImpl: fakeLookup, resolveNetworkRoute: direct, fetchImpl }), { code: 'PUBLIC_URL_REQUIRED' });
    }
    for (const addresses of [[{ address: '10.0.0.1', family: 4 }], [{ address: '198.18.0.1', family: 4 }, { address: publicV4, family: 4 }],
        [{ address: '198.18.0.1', family: 4 }, { address: '192.168.1.2', family: 4 }], [{ address: '198.18.0.1', family: 6 }], []]) {
        await assert.rejects(readPublicWebPage({ url: sourceUrl, lookupImpl: async () => addresses, resolveNetworkRoute: direct, fetchImpl }), { code: 'PUBLIC_DNS_REQUIRED' });
    }
    assert.equal(requests, 0);
});

test('private/forged/unusable answers from either family reject before the page and both queries finish', async () => {
    for (const overrides of [{ 28: answer(28, ['fd00::1']) }, { 1: answer(1, [], 'wrong.example.com') }, { 1: answer(1, []) },
        { 1: { ...answer(1), Answer: [{ name: `${hostname}.`, type: 5, TTL: 10, data: hostname }] } }]) {
        let pages = 0, completed = 0;
        const mocked = fetchAnswers(overrides);
        await assert.rejects(readPublicWebPage({ url: sourceUrl, lookupImpl: fakeLookup, resolveNetworkRoute: direct,
            fetchImpl: async (url, init) => { if (new URL(url).hostname !== 'cloudflare-dns.com') pages++; const result = await mocked(url, init); completed++; return result; } }), { code: 'PUBLIC_DNS_REQUIRED' });
        assert.equal(pages, 0);
        assert.equal(completed, 2);
    }
});

test('unsupported proxy cannot bypass to direct and failed DNS never exposes transport details', async () => {
    let requests = 0;
    const common = { url: sourceUrl, lookupImpl: fakeLookup, fetchImpl: async () => { requests++; throw new Error('proxy-credential-secret'); } };
    await assert.rejects(readPublicWebPage({ ...common, resolveNetworkRoute: async () => ({ kind: 'unsupported', reason: 'socks' }) }), { code: 'PUBLIC_PROXY_UNSUPPORTED' });
    assert.equal(requests, 0);
    await assert.rejects(readPublicWebPage({ ...common, resolveNetworkRoute: direct }), error => error.code === 'PUBLIC_DNS_FAILED' && !error.message.includes('proxy-credential-secret'));
    assert.equal(requests, 2);
});

test('proxy routing sees each complete DNS query URL, including query-dependent restrictions', async () => {
    const routed = [], requested = [];
    await assert.rejects(readPublicWebPage({ url: sourceUrl, lookupImpl: fakeLookup,
        resolveNetworkRoute: async url => { routed.push(url.href); return url.searchParams.get('type') === '28' ? { kind: 'unsupported' } : { kind: 'direct' }; },
        fetchImpl: async url => { requested.push(url); return dnsResponse(answer(1)); }
    }), { code: 'PUBLIC_PROXY_UNSUPPORTED' });
    assert.equal(routed.length, 2);
    assert.ok(routed.every(url => new URL(url).searchParams.get('name') === hostname));
    assert.equal(requested.length, 1);
    assert.equal(new URL(requested[0]).searchParams.get('type'), '1');
});

test('DNS responses have a 16KiB streaming limit, reject redirects/types and cancel oversized bodies', async () => {
    let cancelled = 0;
    await assert.rejects(readPublicWebPage({ url: sourceUrl, lookupImpl: fakeLookup, resolveNetworkRoute: direct, fetchImpl: async () => {
        const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); }, cancel() { cancelled++; } });
        return new Response(body, { headers: { 'content-type': 'application/dns-json' } });
    } }), { code: 'PUBLIC_DNS_FAILED' });
    assert.equal(cancelled, 2);
    for (const response of [() => new Response(null, { status: 302, headers: { location: 'https://untrusted.example.com/' } }),
        () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
        () => new Response('{bad-json', { headers: { 'content-type': 'application/dns-json' } }),
        () => new Response('{}', { headers: { 'content-type': 'application/dns-json', 'content-length': String(16 * 1024 + 1) } })]) {
        await assert.rejects(readPublicWebPage({ url: sourceUrl, lookupImpl: fakeLookup, resolveNetworkRoute: direct, fetchImpl: async () => response() }), { code: 'PUBLIC_DNS_FAILED' });
    }
});

test('parent cancellation and whole-page timeout stop both DNS reads and cancel bodies', async () => {
    const controller = new AbortController();
    let started = 0, cancelled = 0;
    const pending = readPublicWebPage({ url: sourceUrl, lookupImpl: fakeLookup, resolveNetworkRoute: direct, signal: controller.signal,
        fetchImpl: async () => { if (++started === 2) queueMicrotask(() => controller.abort()); return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'application/dns-json' } }); } });
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.equal(started, 2);
    assert.equal(cancelled, 2);
    const signals = [];
    await assert.rejects(readPublicWebPage({ url: sourceUrl, timeoutMs: 30, lookupImpl: fakeLookup, resolveNetworkRoute: direct,
        fetchImpl: async (_url, init) => { signals.push(init.signal); return new Promise(() => {}); } }), { code: 'PUBLIC_READ_TIMEOUT' });
    assert.equal(signals.length, 2);
    assert.ok(signals.every(signal => signal.aborted));
});

test('the independent four-second DNS deadline bounds stalled queries within the page deadline', async () => {
    const signals = [], start = Date.now();
    await assert.rejects(readPublicWebPage({ url: sourceUrl, lookupImpl: fakeLookup, resolveNetworkRoute: direct,
        fetchImpl: async (_url, init) => { signals.push(init.signal); return new Promise(() => {}); } }), { code: 'PUBLIC_DNS_FAILED' });
    assert.ok(Date.now() - start >= 3500 && Date.now() - start < 8000);
    assert.equal(signals.length, 2);
    assert.ok(signals.every(signal => signal.aborted));
});

test('a later redirect keeps DNS revalidation and refuses private rebinding without DoH', async () => {
    let lookups = 0, pages = 0, dns = 0;
    await assert.rejects(readPublicWebPage({ url: sourceUrl, resolveNetworkRoute: direct,
        lookupImpl: async () => ++lookups === 1 ? fakeLookup() : [{ address: '10.1.1.1', family: 4 }],
        fetchImpl: async url => {
            const parsed = new URL(url);
            if (parsed.hostname === 'cloudflare-dns.com') { dns++; return dnsResponse(answer(Number(parsed.searchParams.get('type')))); }
            pages++; return new Response(null, { status: 302, headers: { location: 'https://redirect.example.com/' } });
        } }), { code: 'PUBLIC_DNS_REQUIRED' });
    assert.equal(lookups, 2); assert.equal(pages, 1); assert.equal(dns, 2);
});

async function listen(server) {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return server.address().port;
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }

test('real proxy CONNECT pins fixed DoH bootstrap and verified source IP with normal Host/SNI/TLS and isolated auth', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'nextmux-public-doh-test-'));
    const originalCa = tls.getCACertificates('default');
    const keyPath = join(temp, 'key.pem'), certPath = join(temp, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=cloudflare-dns.com', '-addext', 'subjectAltName=DNS:cloudflare-dns.com,DNS:reader.example.com,DNS:localhost'], { stdio: 'ignore' });
    const key = await readFile(keyPath), cert = await readFile(certPath, 'utf8');
    tls.setDefaultCACertificates([...originalCa, cert]);
    const requests = [], serverNames = [], connections = [], sockets = new Set();
    const source = createHttpsServer({ key, cert }, (req, res) => {
        requests.push({ host: req.headers.host, headers: req.headers });
        if (req.headers.host === 'cloudflare-dns.com') {
            const query = new URL(req.url, 'https://cloudflare-dns.com');
            res.writeHead(200, { 'content-type': 'application/dns-json' }); res.end(JSON.stringify(answer(Number(query.searchParams.get('type')))));
        } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<p>Public text through proxy</p>'); }
    });
    source.on('secureConnection', socket => serverNames.push(socket.servername));
    source.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    const sourcePort = await listen(source);
    const proxy = createHttpServer();
    proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    proxy.on('connect', (req, client, head) => {
        connections.push({ authority: req.url, host: req.headers.host, auth: req.headers['proxy-authorization'] });
        const target = connect(sourcePort, '127.0.0.1', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) target.write(head); client.pipe(target); target.pipe(client); });
        sockets.add(target); target.on('close', () => sockets.delete(target));
        target.on('error', () => client.destroy()); client.on('error', () => target.destroy());
    });
    const proxyPort = await listen(proxy);
    const resolveNetworkRoute = async () => ({ kind: 'http_proxy', uri: `http://test-user:test-secret@localhost:${proxyPort}` });
    try {
        const page = await readPublicWebPage({ url: sourceUrl, lookupImpl: fakeLookup, resolveNetworkRoute });
        assert.equal(page.content, 'Public text through proxy');
        assert.ok(connections.some(entry => entry.authority === '1.1.1.1:443'));
        assert.ok(connections.some(entry => entry.authority === `${publicV4}:443`));
        assert.ok(connections.every(entry => entry.host === entry.authority && /^Basic /.test(entry.auth)));
        assert.equal(requests.filter(entry => entry.host === 'cloudflare-dns.com').length, 2);
        assert.equal(requests.filter(entry => entry.host === hostname).length, 1);
        for (const { headers } of requests) {
            assert.equal(headers['proxy-authorization'], undefined); assert.equal(headers.authorization, undefined); assert.equal(headers.cookie, undefined);
        }
        assert.ok(serverNames.includes('cloudflare-dns.com')); assert.ok(serverNames.includes(hostname));
        await assert.rejects(readPublicWebPage({ url: 'https://wrong.example.com/', lookupImpl: fakeLookup, resolveNetworkRoute }), { code: 'PUBLIC_DNS_REQUIRED' });
        // Removing the test CA makes the fixed resolver certificate untrusted:
        // the DNS request must fail before any origin page is requested.
        tls.setDefaultCACertificates(originalCa);
        const before = requests.length;
        await assert.rejects(readPublicWebPage({ url: sourceUrl, lookupImpl: fakeLookup, resolveNetworkRoute }), { code: 'PUBLIC_DNS_FAILED' });
        assert.equal(requests.length, before);
    } finally {
        for (const socket of sockets) socket.destroy();
        await close(proxy); await close(source);
        tls.setDefaultCACertificates(originalCa);
        await rm(temp, { recursive: true, force: true });
    }
});
