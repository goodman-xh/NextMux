import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { EnvHttpProxyAgent } from 'undici';
import { withLoopbackProxyBypass } from '../lib/node/nextmux-network-proxy.js';

test('Windows wildcard proxy settings cannot capture NextMux loopback services', async t => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('local-ok');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const dispatcher = new EnvHttpProxyAgent({
    // Nothing listens here. The request can pass only when loopback is direct.
    httpProxy: 'http://127.0.0.1:1',
    httpsProxy: 'http://127.0.0.1:1',
    noProxy: withLoopbackProxyBypass('localhost;127.*;<local>'),
  });
  t.after(() => dispatcher.close());

  const response = await fetch(`http://127.0.0.1:${address.port}/health`, { dispatcher });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'local-ok');
});

test('loopback bypass is deterministic and preserves user entries', () => {
  assert.equal(
    withLoopbackProxyBypass('*.internal,example.test'),
    '*.internal,example.test,localhost,127.0.0.1,[::1]',
  );
  assert.equal(withLoopbackProxyBypass('*'), '*');
});
