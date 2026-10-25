import test from 'node:test';
import assert from 'node:assert/strict';
import { publicWebFallbackRoute, publicWebSystemRoute } from '../lib/node/nextmux-public-web-route.js';

test('public reading follows environment HTTPS/HTTP proxy and preserves credentials only in proxy URI', () => {
    const config = { httpProxy: 'http://user:secret@proxy.test:8080', httpsProxy: 'https://proxy.test:8443' };
    assert.deepEqual(publicWebFallbackRoute(new URL('https://public.test/a'), config), { kind: 'http_proxy', uri: config.httpsProxy });
    assert.deepEqual(publicWebFallbackRoute(new URL('http://public.test/a'), config), { kind: 'http_proxy', uri: config.httpProxy });
    assert.deepEqual(publicWebFallbackRoute(new URL('https://public.test'), { httpProxy: config.httpProxy }), { kind: 'http_proxy', uri: config.httpProxy });
});

test('public reading honors exact/suffix/port NO_PROXY and never assumes unsupported proxy is direct', () => {
    const config = { httpsProxy: 'http://proxy.test:8080', noProxy: 'example.com:443,*.bypass.test' };
    for (const url of ['https://example.com', 'https://sub.example.com', 'https://sub.bypass.test'])
        assert.deepEqual(publicWebFallbackRoute(new URL(url), config), { kind: 'direct' });
    for (const url of ['https://notexample.com', 'https://example.com:444'])
        assert.equal(publicWebFallbackRoute(new URL(url), config).kind, 'http_proxy');
    assert.deepEqual(publicWebFallbackRoute(new URL('https://public.test'), { ...config, noProxy: '*' }), { kind: 'direct' });
    for (const uri of ['socks5://proxy.test:1080', 'broken'])
        assert.equal(publicWebFallbackRoute(new URL('https://public.test'), { httpsProxy: uri }).kind, 'unsupported');
});

test('PAC selected destination preserves HTTPS and IPv6 proxy while SOCKS requires browser fallback', () => {
    assert.deepEqual(publicWebSystemRoute({ kind: 'https', host: '::1', port: 8080 }), { kind: 'http_proxy', uri: 'https://[::1]:8080' });
    assert.equal(publicWebSystemRoute({ kind: 'socks5', host: 'localhost', port: 1080 }).kind, 'unsupported');
    assert.deepEqual(publicWebSystemRoute({ kind: 'direct' }), { kind: 'direct' });
});
