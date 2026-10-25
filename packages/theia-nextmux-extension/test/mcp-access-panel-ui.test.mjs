import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mcpStatus, parseMcpArguments, McpFailureDetails } = require('../lib/browser/nextmux-mcp-access-panel.js');
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react');
const { renderToStaticMarkup } = coreRequire('react-dom/server');

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'src', 'browser', 'nextmux-mcp-access-panel.tsx'), 'utf8');
const styles = await readFile(join(here, '..', 'src', 'browser', 'style', 'nextmux-desktop-production.css'), 'utf8');

test('MCP panel offers restart for an approved service that is no longer running', () => {
    assert.match(source, /const restart = server\.approved && !server\.running/);
    assert.match(source, /const action = pending \? 'revoke' : restart \|\| !server\.approved \? 'start' : 'revoke'/);
    assert.match(source, /重新启动/);
});

test('MCP panel does not expose the approval fingerprint and keeps tools behind a disclosure', () => {
    assert.doesNotMatch(source, /server\.fingerprint\.slice\(/);
    assert.match(source, /<details className='nmx-mcp-tools'/);
    assert.match(source, /mcpDetailsText\(props\.locale, server\)/);
});

test('MCP panel styles keep status and tool controls compact and scoped', () => {
    assert.match(styles, /\.nmx-mcp-status-ready/);
    assert.match(styles, /\.nmx-mcp-tools > summary/);
    assert.match(styles, /@media \(max-width: 640px\)/);
});

test('MCP status never equates a running process with usable tools', () => {
    const base = { running: true, approved: true };
    assert.equal(mcpStatus('zh-CN', base).tone, 'working');
    assert.equal(mcpStatus('zh-CN', { ...base, diagnostic: 'tools' }).tone, 'working');
    assert.equal(mcpStatus('zh-CN', { ...base, diagnostic: 'empty' }).tone, 'idle');
    assert.equal(mcpStatus('zh-CN', { ...base, diagnostic: 'ready' }).tone, 'ready');
    assert.notEqual(mcpStatus('zh-CN', { ...base, approved: false, diagnostic: 'ready' }).tone, 'ready');
    assert.equal(mcpStatus('zh-CN', { ...base, diagnostic: 'connection', failure: { stage: 'tools', code: 'timeout' } }).tone, 'error');
    assert.match(mcpStatus('zh-CN', { ...base, diagnostic: 'connection', failure: { stage: 'tools', code: 'timeout' } }).label, /工具.*超时/);
});

test('MCP form accepts pasted JSON arguments and line arguments without shell splitting', () => {
    assert.deepEqual(parseMcpArguments('-y\n@playwright/mcp@0.0.80\n'), ['-y', '@playwright/mcp@0.0.80']);
    assert.deepEqual(parseMcpArguments('["--project", "a folder", "  keep  ", ""]'), ['--project', 'a folder', '  keep  ', '']);
    assert.deepEqual(parseMcpArguments('--name=a folder\r\n--value=$VALUE'), ['--name=a folder', '--value=$VALUE']);
    assert.throws(() => parseMcpArguments('[42]'), /MCP_CONFIG_INVALID/);
    assert.throws(() => parseMcpArguments('["unterminated]'));
});

test('MCP diagnostics disclose exact stage, exit evidence and escaped detail only when expanded', () => {
    const html = renderToStaticMarkup(React.createElement(McpFailureDetails, { locale: 'zh-CN', failure: {
        stage: 'connection', code: 'process_exit', exitCode: 43, signal: 'SIGTERM', detail: '<script>fixture</script> [redacted]'
    } }));
    assert.match(html, /<details class="nmx-mcp-diagnostic"><summary>诊断信息/);
    assert.match(html, /<dt>阶段<\/dt><dd>连接/);
    assert.match(html, /process_exit/);
    assert.match(html, /<dd>43<\/dd>/);
    assert.match(html, /SIGTERM/);
    assert.match(html, /&lt;script&gt;fixture&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>| open=/);
    const noExit = renderToStaticMarkup(React.createElement(McpFailureDetails, { locale: 'en', failure: { stage: 'tools', code: 'timeout' } }));
    assert.match(noExit, /Tool discovery/);
    assert.doesNotMatch(noExit, /Exit code|Signal|<pre>/);
});

test('Windows MCP child environment includes standard user tool directories (uvx/cargo/npm) and panel avoids duplicate labels', () => {
    const { mcpChildEnvironment } = require('../lib/node/nextmux-mcp-launch.js');
    const { isMerchantApiDeletedFailure, agentOutcomeText } = require('../lib/browser/nextmux-agent-outcome-locale.js');
    const env = mcpChildEnvironment({}, 'win32', {
        USERPROFILE: 'C:\\Users\\Alice',
        APPDATA: 'C:\\Users\\Alice\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
        Path: 'C:\\Windows\\System32'
    });
    assert.match(env.PATH, /C:\\Users\\Alice\\\.local\\bin/);
    assert.match(env.PATH, /C:\\Users\\Alice\\\.cargo\\bin/);
    assert.match(env.PATH, /C:\\Users\\Alice\\AppData\\Roaming\\npm/);
    assert.match(source, /editableConfig && 'serverUrl' in editableConfig \? editableConfig\.serverUrl : server\.connection/);
    assert.match(source, /hidden=\{credentialServer === server\.name\}/);
    assert.equal(isMerchantApiDeletedFailure({ code: 'MERCHANT_API_DELETED' }), true);
    assert.equal(isMerchantApiDeletedFailure('offering_deleted'), true);
    assert.equal(agentOutcomeText('zh-CN', 'merchant_api_deleted'), '当前商家 API 已被删除，对话已停止，请切换模型');
});

test('smart MCP auto-recognition parses JSON configs, CLI commands, and remote URLs with zero-error launcher normalization', () => {
    const { parseMcpAutoRecognizedInput } = require('../lib/browser/nextmux-mcp-form-validation.js');
    const { parseMcpEnvironment } = require('../lib/browser/nextmux-mcp-access-panel.js');
    const { normalizeMcpUvxArgs, resolveMcpLauncherSync } = require('../lib/node/nextmux-mcp-launch.js');

    const fromJson = parseMcpAutoRecognizedInput(JSON.stringify({
        mcpServers: {
            'brave-search': {
                command: 'npx',
                args: ['@modelcontextprotocol/server-brave-search'],
                env: { BRAVE_API_KEY: 'bs-123' }
            }
        }
    }));
    assert.deepEqual(fromJson, {
        name: 'brave-search',
        local: true,
        address: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
        env: { BRAVE_API_KEY: 'bs-123' }
    });

    const fromCli = parseMcpAutoRecognizedInput('env GITHUB_PERSONAL_ACCESS_TOKEN=ghp_abc uvx markitdown-mcp');
    assert.deepEqual(fromCli, {
        name: 'markitdown-mcp',
        local: true,
        address: 'uvx',
        args: ['markitdown-mcp'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc' }
    });

    const fromUrl = parseMcpAutoRecognizedInput('https://mcp.netdata.cloud/mcp?api_key=nd_secret_123');
    assert.deepEqual(fromUrl, {
        name: 'netdata',
        local: false,
        address: 'https://mcp.netdata.cloud/mcp',
        args: [],
        authKind: 'x-api-key',
        authToken: 'nd_secret_123'
    });

    assert.deepEqual(parseMcpEnvironment('API_KEY=123; SECOND_VAR=abc'), { API_KEY: '123', SECOND_VAR: 'abc' });
    assert.deepEqual(normalizeMcpUvxArgs(['markitdown-mcp@latest', '--port', '8080']), ['markitdown-mcp', '--port', '8080']);
    const npxResolved = resolveMcpLauncherSync('npx', ['@acme/mcp'], { PATH: '/usr/bin' }, 'darwin');
    assert.deepEqual(npxResolved, { command: 'npx', args: ['-y', '@acme/mcp'] });
});
