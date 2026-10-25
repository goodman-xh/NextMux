import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AgentToolRegistry, BuiltinAgentBackend } from '@nextmux/agent-runtime';

import { DESKTOP_AGENT_MODEL_TIMEOUT_MS, readDesktopAgentBackendConfiguration } from '../lib/node/nextmux-agent-backend-config.js';

test('desktop root and delegated model attempts use the explicit thirty-minute deadline', () => {
    assert.equal(DESKTOP_AGENT_MODEL_TIMEOUT_MS, 0, "an online model is never cut off by a clock");
    const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    assert.match(source, /new AgentDelegationRuntime\(\{[\s\S]*?modelTimeoutMs: DESKTOP_AGENT_MODEL_TIMEOUT_MS/);
    assert.match(source, /new BuiltinAgentBackend\(\{[\s\S]*?modelTimeoutMs: DESKTOP_AGENT_MODEL_TIMEOUT_MS/);
});

test('agent backend configuration stays builtin unless ACP is explicitly selected', () => {
    const config = readDesktopAgentBackendConfiguration({
        NEXTMUX_AGENT_ACP_COMMAND: 'opencode',
        NEXTMUX_AGENT_ACP_ARGS_JSON: '["acp"]'
    });
    assert.equal(config.preferredBackendId, 'builtin');
    assert.equal(config.selectedBackendOwnsModelSelection, false);
    assert.equal(config.allowFallback, false);
    assert.equal(config.acpBackends[0]?.options.command, 'opencode');
    assert.deepEqual(config.acpBackends[0]?.options.args, ['acp']);
});

test('default desktop selection names the registered builtin backend', () => {
    const config = readDesktopAgentBackendConfiguration({});
    const backend = new BuiltinAgentBackend({
        model: { complete: async () => ({ content: 'ok' }) },
        tools: new AgentToolRegistry()
    });
    assert.equal(config.preferredBackendId, backend.id);
});

test('ACP selection requires explicit model ownership and keeps fallback opt-in', () => {
    assert.throws(() => readDesktopAgentBackendConfiguration({
        NEXTMUX_AGENT_BACKEND: 'acp',
        NEXTMUX_AGENT_ACP_COMMAND: 'goose'
    }), /OWNS_MODEL/);

    const config = readDesktopAgentBackendConfiguration({
        NEXTMUX_AGENT_BACKEND: 'acp',
        NEXTMUX_AGENT_ACP_COMMAND: 'goose',
        NEXTMUX_AGENT_ACP_ARGS_JSON: '["acp"]',
        NEXTMUX_AGENT_ACP_OWNS_MODEL: '1',
        NEXTMUX_AGENT_BACKEND_ALLOW_FALLBACK: '1'
    });
    assert.equal(config.preferredBackendId, 'acp:external');
    assert.equal(config.selectedBackendOwnsModelSelection, true);
    assert.equal(config.allowFallback, true);
});

test('ACP configuration rejects shell-shaped arguments and malformed environment names', () => {
    assert.throws(() => readDesktopAgentBackendConfiguration({
        NEXTMUX_AGENT_ACP_COMMAND: 'agent',
        NEXTMUX_AGENT_ACP_ARGS_JSON: '["ok\\nwhoami"]'
    }), /bounded string arguments/);
    assert.throws(() => readDesktopAgentBackendConfiguration({
        NEXTMUX_AGENT_ACP_COMMAND: 'agent',
        NEXTMUX_AGENT_ACP_INHERIT_ENV: 'PATH,API-KEY'
    }), /invalid environment variable/);
});

test('multiple ACP engines are parsed as stable deterministic candidates', () => {
    const config = readDesktopAgentBackendConfiguration({
        NEXTMUX_AGENT_BACKEND: 'acp:goose',
        NEXTMUX_AGENT_BACKEND_ALLOW_FALLBACK: '1',
        NEXTMUX_AGENT_ACP_BACKENDS_JSON: JSON.stringify([
            {
                id: 'opencode', command: 'opencode', args: ['acp'], priority: 70,
                ownsModelSelection: true, inheritEnvironment: ['PATH']
            },
            {
                id: 'goose', command: 'goose', args: ['acp'], priority: 90,
                ownsModelSelection: true, inheritEnvironment: ['PATH', 'HOME']
            }
        ])
    });
    assert.equal(config.preferredBackendId, 'acp:goose');
    assert.equal(config.selectedBackendOwnsModelSelection, true);
    assert.deepEqual(config.acpBackends.map(candidate => ({
        id: candidate.options.id,
        command: candidate.options.command,
        priority: candidate.priority
    })), [
        { id: 'acp:opencode', command: 'opencode', priority: 70 },
        { id: 'acp:goose', command: 'goose', priority: 90 }
    ]);
});

test('multiple ACP engine registry rejects ambiguity, duplicates, and unowned models', () => {
    const valid = { id: 'goose', command: 'goose', args: ['acp'], ownsModelSelection: true };
    assert.throws(() => readDesktopAgentBackendConfiguration({
        NEXTMUX_AGENT_ACP_COMMAND: 'legacy-agent',
        NEXTMUX_AGENT_ACP_BACKENDS_JSON: JSON.stringify([valid])
    }), /cannot be combined/i);
    assert.throws(() => readDesktopAgentBackendConfiguration({
        NEXTMUX_AGENT_ACP_BACKENDS_JSON: JSON.stringify([valid, valid])
    }), /duplicate/i);
    assert.throws(() => readDesktopAgentBackendConfiguration({
        NEXTMUX_AGENT_BACKEND: 'acp:goose',
        NEXTMUX_AGENT_ACP_BACKENDS_JSON: JSON.stringify([{ ...valid, ownsModelSelection: false }])
    }), /ownsModelSelection/i);
});
