import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import test from 'node:test';
import { fetch, Agent } from 'undici';
import { startProxyResolverHost } from '../lib/electron-main/nextmux-proxy-resolver-host.js';
import { electronProxyResolver, LIVE_UPSTREAM_TIMEOUTS, parseProxyResolution, preferredProxyChoice, SystemProxyDispatcher, trustSystemCertificates } from '../lib/node/nextmux-system-proxy.js';
import { readFileSync } from 'node:fs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

test('Chromium/PAC proxy results map to undici routes', () => {
    assert.deepEqual(preferredProxyChoice('PROXY proxy.corp.example:8080; DIRECT'), { kind: 'http', host: 'proxy.corp.example', port: 8080 });
    assert.deepEqual(preferredProxyChoice('HTTPS secure.example:443'), { kind: 'https', host: 'secure.example', port: 443 });
    assert.deepEqual(preferredProxyChoice('SOCKS5 127.0.0.1:1080'), { kind: 'socks5', host: '127.0.0.1', port: 1080 });
    assert.deepEqual(preferredProxyChoice('SOCKS4 old.example:1080; PROXY next.example:3128'), { kind: 'http', host: 'next.example', port: 3128 }, 'unsupported SOCKS4 falls through');
    assert.deepEqual(preferredProxyChoice('DIRECT'), { kind: 'direct' });
    assert.deepEqual(preferredProxyChoice(''), { kind: 'direct' });
    assert.deepEqual(preferredProxyChoice('PROXY no-port'), { kind: 'direct' });
    assert.deepEqual(parseProxyResolution('PROXY [::1]:8080').at(0), { kind: 'http', host: '[::1]', port: 8080 });
});

test('the Electron resolver host answers only the per-launch token', async t => {
    const seen = [];
    const host = await startProxyResolverHost(async url => { seen.push(url); return url.includes('pac') ? 'PROXY pac-proxy.example:8080' : 'DIRECT'; });
    t.after(() => host.close());
    const resolve = electronProxyResolver({ NEXTMUX_PROXY_RESOLVER_PATH: host.path, NEXTMUX_PROXY_RESOLVER_TOKEN: host.token });
    assert.equal(await resolve('https://pac.example/'), 'PROXY pac-proxy.example:8080');
    assert.equal(await resolve('https://direct.example/'), 'DIRECT');
    const intruder = electronProxyResolver({ NEXTMUX_PROXY_RESOLVER_PATH: host.path, NEXTMUX_PROXY_RESOLVER_TOKEN: 'wrong' });
    assert.equal(await intruder('https://pac.example/'), undefined);
    assert.equal(electronProxyResolver({}), undefined, 'outside Electron there is no resolver');
    assert.deepEqual(seen, ['https://pac.example/', 'https://direct.example/']);
});

test('requests follow PROXY, SOCKS5 and DIRECT results per origin, cached, with a fallback when resolution fails', async t => {
    const target = createHttpServer((request, response) => response.end(`ok ${request.url}`));
    const targetPort = await listen(target); t.after(() => target.close());
    const tunnel = (socket, head) => { const upstream = connect(targetPort, '127.0.0.1', () => { upstream.write(head); socket.pipe(upstream).pipe(socket); }); upstream.on('error', () => socket.destroy()); };
    // HTTP CONNECT proxy (what a PAC `PROXY host:port` result points to).
    const connects = [];
    const httpProxy = createHttpServer((_request, response) => { response.statusCode = 405; response.end(); });
    httpProxy.on('connect', (request, socket, head) => { connects.push(request.url); socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); tunnel(socket, head); });
    const httpProxyPort = await listen(httpProxy); t.after(() => httpProxy.close());
    // Minimal SOCKS5 proxy (no auth, CONNECT, domain or IPv4 address).
    const socksTargets = [];
    const socks = createNetServer(socket => {
        socket.once('data', () => {
            socket.write(Buffer.from([5, 0]));
            socket.once('data', request => {
                const type = request[3];
                const host = type === 3 ? request.subarray(5, 5 + request[4]).toString() : [...request.subarray(4, 8)].join('.');
                const port = request.readUInt16BE(request.length - 2);
                socksTargets.push(`${host}:${port}`);
                socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
                tunnel(socket, Buffer.alloc(0));
            });
        });
    });
    const socksPort = await listen(socks); t.after(() => socks.close());
    const lookups = [];
    const results = { 'http://via-pac.nextmux.test/': `PROXY 127.0.0.1:${httpProxyPort}; DIRECT`, 'http://via-socks.nextmux.test/': `SOCKS5 127.0.0.1:${socksPort}` };
    let fallbackUsed = 0;
    const fallback = new Agent({ connect: (options, callback) => { fallbackUsed++; const socket = connect(targetPort, '127.0.0.1', () => callback(null, socket)); socket.on('error', error => callback(error, null)); } });
    const dispatcher = new SystemProxyDispatcher(async url => { lookups.push(url); return url.includes('broken') ? undefined : results[url] ?? 'DIRECT'; }, fallback);
    t.after(() => Promise.all([dispatcher.close(), fallback.close()]));

    assert.equal(await (await fetch('http://via-pac.nextmux.test/a', { dispatcher })).text(), 'ok /a');
    assert.equal(await (await fetch('http://via-pac.nextmux.test/b', { dispatcher })).text(), 'ok /b');
    assert.deepEqual(connects.slice(0, 1), ['via-pac.nextmux.test:80'], 'PAC PROXY result tunnels through the proxy');
    assert.equal(lookups.filter(url => url === 'http://via-pac.nextmux.test/').length, 1, 'origin route is cached');
    assert.equal(await (await fetch('http://via-socks.nextmux.test/c', { dispatcher })).text(), 'ok /c');
    assert.deepEqual(socksTargets, ['via-socks.nextmux.test:80'], 'SOCKS5 result goes through the SOCKS proxy');
    const before = { connects: connects.length, socks: socksTargets.length };
    assert.equal(await (await fetch(`http://127.0.0.1:${targetPort}/local`, { dispatcher })).text(), 'ok /local');
    assert.deepEqual({ connects: connects.length, socks: socksTargets.length }, before, 'loopback is always direct');
    assert.ok(!lookups.some(url => url.includes('127.0.0.1')), 'loopback is never sent to the resolver');
    assert.equal(await (await fetch('http://broken.nextmux.test/d', { dispatcher })).text(), 'ok /d');
    assert.equal(fallbackUsed, 1, 'a failed resolution uses the environment/OS fallback instead of failing');
    assert.deepEqual(await dispatcher.choiceFor('https://direct.nextmux.test'), { kind: 'direct' });
});

test('waiting on an online upstream has no clock on any route (undici would cut it off after 300 s)', async t => {
    assert.deepEqual(LIVE_UPSTREAM_TIMEOUTS, { headersTimeout: 0, bodyTimeout: 0 });
    const seen = [];
    class Recording extends SystemProxyDispatcher {
        dispatcherFor(choice) { return { dispatch: (options, handler) => { seen.push([choice.kind, options.headersTimeout, options.bodyTimeout]); handler.onError?.(new Error('recorded')); return true; } }; }
    }
    const dispatcher = new Recording(async url => url.includes('socks') ? 'SOCKS5 127.0.0.1:1080' : 'DIRECT', new Agent());
    for (const origin of ['http://direct.fixture.invalid', 'http://socks.fixture.invalid']) {
        dispatcher.dispatch({ origin, path: '/', method: 'GET' }, { onError() {} });
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(seen, [['direct', 0, 0], ['socks5', 0, 0]], 'every route, including SOCKS5 pools that ignore constructor options');
    const configured = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    assert.match(configured, /new EnvHttpProxyAgent\(\{[\s\S]*?\.\.\.LIVE_UPSTREAM_TIMEOUTS[\s\S]*?\}\)\s*: new Agent\(LIVE_UPSTREAM_TIMEOUTS\)/);
    assert.match(readFileSync(new URL('../src/node/nextmux-local-model-transport.ts', import.meta.url), 'utf8'), /new Agent\(\{[^}]*\.\.\.LIVE_UPSTREAM_TIMEOUTS/, 'a local model that is still loading is waited for');
});

test('system CA certificates are added when the runtime supports it, and skipped safely otherwise', () => {
    assert.equal(trustSystemCertificates({}), false, 'older runtimes are feature-detected');
    let installed;
    const api = { getCACertificates: type => type === 'system' ? ['CORP', 'ROOT'] : ['ROOT', 'BUNDLED'], setDefaultCACertificates: list => { installed = list; } };
    assert.equal(trustSystemCertificates(api), true);
    assert.deepEqual(installed, ['ROOT', 'BUNDLED', 'CORP'], 'default roots are kept, system roots added once');
    assert.equal(trustSystemCertificates({ getCACertificates: () => { throw new Error('no store'); }, setDefaultCACertificates: () => { throw new Error('unreachable'); } }), false);
});
