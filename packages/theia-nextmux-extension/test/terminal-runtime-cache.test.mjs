import assert from 'node:assert/strict';
import test from 'node:test';

import { ResilientTerminalRuntimeCache } from '../lib/node/nextmux-terminal-runtime-cache.js';

const runtime = (overrides = {}) => ({
    platform: 'windows',
    architecture: 'x64',
    hostArchitecture: 'x64',
    osRelease: '10.0.26100',
    supportStatus: 'supported',
    wslStatus: 'setup_required',
    wslDistributions: [],
    detectedAt: 1,
    shellKind: 'powershell',
    shellPath: 'C:\\PowerShell\\pwsh.exe',
    label: 'PowerShell',
    defaultProfileId: 'powershell',
    profiles: [{
        id: 'powershell', shellKind: 'powershell', shellPath: 'C:\\PowerShell\\pwsh.exe',
        shellArgs: ['-NoLogo'], label: 'PowerShell', source: 'path'
    }],
    ...overrides
});

const transientUnavailable = () => runtime({
    supportStatus: 'unsupported',
    supportReason: 'terminal_profile_unavailable',
    shellKind: 'unknown',
    shellPath: '',
    label: 'Terminal unavailable',
    defaultProfileId: '',
    profiles: []
});

test('concurrent callers await one terminal discovery instead of observing an unfinished runtime', async () => {
    let resolveDiscovery;
    let calls = 0;
    const cache = new ResilientTerminalRuntimeCache({
        resolve: () => {
            calls += 1;
            return new Promise(resolve => { resolveDiscovery = resolve; });
        },
        fallback: transientUnavailable,
        retryDelayMs: 0
    });

    const first = cache.get();
    const second = cache.get();
    assert.equal(calls, 1);
    resolveDiscovery(runtime());
    assert.equal((await first).supportStatus, 'supported');
    assert.equal(await second, await first);
});

test('a transient no-profile result is retried once before the UI reports terminal unsupported', async () => {
    let calls = 0;
    const cache = new ResilientTerminalRuntimeCache({
        resolve: async () => ++calls === 1 ? transientUnavailable() : runtime(),
        fallback: transientUnavailable,
        retryDelayMs: 0
    });

    assert.equal((await cache.get()).supportStatus, 'supported');
    assert.equal(calls, 2);
});

test('hard operating-system and architecture failures are cached without wasteful retries', async () => {
    let calls = 0;
    const hardFailure = runtime({
        supportStatus: 'unsupported', supportReason: 'unsupported_architecture', profiles: [], defaultProfileId: ''
    });
    const cache = new ResilientTerminalRuntimeCache({
        resolve: async () => { calls += 1; return hardFailure; },
        fallback: transientUnavailable,
        retryDelayMs: 0
    });

    assert.equal((await cache.get()).supportReason, 'unsupported_architecture');
    assert.equal((await cache.get()).supportReason, 'unsupported_architecture');
    assert.equal(calls, 1);
});

test('a repeated transient result expires and can recover without restarting NextMux', async () => {
    let calls = 0;
    let now = 100;
    const cache = new ResilientTerminalRuntimeCache({
        resolve: async () => {
            calls += 1;
            return calls <= 2 ? transientUnavailable() : runtime();
        },
        fallback: transientUnavailable,
        retryDelayMs: 0,
        transientTtlMs: 50,
        now: () => now
    });

    assert.equal((await cache.get()).supportStatus, 'unsupported');
    assert.equal(calls, 2, 'one request performs exactly one bounded retry');
    assert.equal((await cache.get()).supportStatus, 'unsupported');
    assert.equal(calls, 2, 'transient result is briefly coalesced to prevent probe storms');
    now += 51;
    assert.equal((await cache.get()).supportStatus, 'supported');
    assert.equal(calls, 3);
});

test('an explicit refresh bypasses a cached runtime while preserving in-flight isolation', async () => {
    let calls = 0;
    const cache = new ResilientTerminalRuntimeCache({
        resolve: async () => runtime({ detectedAt: ++calls }),
        fallback: transientUnavailable,
        retryDelayMs: 0
    });

    assert.equal((await cache.get()).detectedAt, 1);
    assert.equal((await cache.get()).detectedAt, 1);
    assert.equal((await cache.get(true)).detectedAt, 2);
});
