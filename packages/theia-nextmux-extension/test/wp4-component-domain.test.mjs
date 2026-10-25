import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { componentDomainMessage } from '../lib/browser/nextmux-component-domain-locale.js';
import { DesktopDomainError, domainMessageFromError } from '../lib/common/nextmux-domain-errors.js';
import { readAgentInstructionFile, writeAgentInstructionFile } from '../lib/node/nextmux-agent-instructions.js';
import { extractDocumentText } from '../lib/node/nextmux-document-text.js';
import { resolveAgentWorkspaces } from '../lib/node/nextmux-agent-workspaces.js';
import { DesktopComponents } from '../lib/node/nextmux-components.js';

const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const source = await readFile(new URL('../src/browser/nextmux-component-domain-locale.ts', import.meta.url), 'utf8');
const codes = [...source.matchAll(/^    "([A-Z_]+)": \{/gm)].map(match => match[1]);
const params = { platform: 'linux-example', file: 'ffmpeg.exe', status: 503, exitCode: 12, maxKB: 256, maxCharacters: 8000,
    path: '/user/project', maxCount: 32, profile: 'WSL', format: 'PDF', maxMB: 64, method: 99 };

test('component, terminal, attachment and instruction reasons have complete 12-language projections', () => {
    assert.ok(codes.length >= 76);
    for (const code of codes) {
        const message = { code, params, fallbackEnglish: 'RAW_DIAGNOSTIC', technicalDetails: 'PRIVATE_DIAGNOSTIC' };
        const english = componentDomainMessage('en', message);
        for (const locale of locales) {
            const text = componentDomainMessage(locale, message);
            assert.ok(text?.trim(), `${locale}.${code}`);
            assert.doesNotMatch(text, /RAW_DIAGNOSTIC|PRIVATE_DIAGNOSTIC|\{\w+\}/, `${locale}.${code}`);
            if (!['zh-CN', 'zh-TW', 'ja'].includes(locale)) assert.doesNotMatch(text, /\p{Script=Han}/u, `${locale}.${code}`);
            if (locale !== 'en' && code !== 'DOMAIN_DETAILS') assert.notEqual(text, english, `${locale}.${code} must not fall back to English`);
        }
    }
    assert.equal(componentDomainMessage('fr', { code: 'UNKNOWN_DOMAIN_CODE', fallbackEnglish: 'private prose' }), undefined);
    for (const locale of locales) assert.ok(componentDomainMessage(locale, { code: 'WORKSPACE_UNAVAILABLE', fallbackEnglish: '', params: { path: '/用户/自定义 {status}' } }).includes('/用户/自定义 {status}'));
});

test('download panel renders translated reasons and confines old and new diagnostics to details', () => {
    const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
    const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
    const { DownloadsPanel } = require('../lib/browser/nextmux-downloads-panel.js');
    for (const locale of locales) {
        for (const structured of [true, false]) {
            const domainError = { code: 'COMPONENT_DOWNLOAD_HTTP', fallbackEnglish: 'PRIVATE_NETWORK_DETAIL', technicalDetails: 'PRIVATE_NETWORK_DETAIL', params: { status: 503 } };
            const component = { id: 'ffmpeg', status: 'failed', version: 'test', downloadBytes: 1, license: 'MIT', homepage: '', recommended: false, removable: false,
                error: 'PRIVATE_NETWORK_DETAIL', ...(structured ? { domainError } : {}) };
            const html = renderToStaticMarkup(React.createElement(DownloadsPanel, { locale, state: { components: [component], autoDownload: false, directory: '/tmp' }, formatSize: String }));
            const details = html.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0];
            assert.ok(details?.includes('PRIVATE_NETWORK_DETAIL'));
            assert.ok(!html.replace(details, '').includes('PRIVATE_NETWORK_DETAIL'));
            if (structured) assert.ok(html.includes(componentDomainMessage(locale, domainError)));
        }
    }
});

test('download failures retain precise HTTP and transport causes through component status', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nmx-wp4-components-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const kind of ['http', 'transport']) {
        const components = new DesktopComponents({ root: join(root, kind), browsersRoot: join(root, 'browsers'), platform: 'darwin', arch: 'arm64', systemBrowsers: [],
            fetchImpl: async () => { if (kind === 'transport') throw new Error('PRIVATE_NETWORK_DETAIL'); return new Response('', { status: 503 }); } });
        components.download('ffmpeg'); await components.queue;
        const component = (await components.state({ preferredSpeech: 'speech-sensevoice' })).components.find(row => row.id === 'ffmpeg');
        assert.equal(component.status, 'failed');
        assert.equal(component.domainError.code, kind === 'http' ? 'COMPONENT_DOWNLOAD_HTTP' : 'COMPONENT_DOWNLOAD_FAILED');
        if (kind === 'http') assert.equal(component.domainError.params.status, 503);
        else assert.equal(component.domainError.technicalDetails, 'PRIVATE_NETWORK_DETAIL');
        assert.doesNotMatch(componentDomainMessage('en', component.domainError), /PRIVATE_NETWORK_DETAIL|model/i);
    }
});

test('instruction and workspace validations preserve legacy error codes plus exact RPC reasons', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nmx-wp4-instructions-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'AGENTS.md'), userText = '用户自己编写的正文\nKeep my prose exactly.\n';
    const empty = await readAgentInstructionFile(path, 'project');
    await writeAgentInstructionFile(path, 'project', userText, empty.sha256);
    assert.equal(await readFile(path, 'utf8'), userText);
    await assert.rejects(writeAgentInstructionFile(path, 'project', '\0', empty.sha256), error => {
        assert.equal(error.code, 'AGENT_INSTRUCTIONS_INVALID');
        assert.equal(domainMessageFromError(JSON.parse(JSON.stringify({ code: error.code, data: error.data }))).code, 'AGENT_INSTRUCTIONS_TEXT_REQUIRED');
        return true;
    });
    await assert.rejects(writeAgentInstructionFile(path, 'project', 'replacement', empty.sha256), error => error.domainError.code === 'AGENT_INSTRUCTIONS_CHANGED');
    await writeFile(path, Buffer.alloc(256 * 1024 + 1));
    await assert.rejects(readAgentInstructionFile(path, 'project'), error => error.domainError.code === 'AGENT_INSTRUCTIONS_TOO_LARGE' && error.domainError.params.maxKB === 256);
    await assert.rejects(resolveAgentWorkspaces(root, [{ id: 'x', path: 'relative', permissionMode: 'read_only' }], 'read_only'), error => {
        assert.equal(error.code, 'INVALID_WORKSPACE_BINDINGS');
        assert.equal(error.domainError.code, 'WORKSPACE_ABSOLUTE_REQUIRED');
        return true;
    });
});

test('document format failures preserve parser classification and structured UI format parameters', () => {
    assert.throws(() => extractDocumentText('sample.pdf', new Uint8Array([1, 2, 3])), error => {
        assert.equal(error.code, 'invalid');
        assert.equal(error.domainError.code, 'DOCUMENT_FORMAT_INVALID');
        assert.equal(error.domainError.params.format, 'PDF');
        for (const locale of locales) assert.match(componentDomainMessage(locale, error.domainError), /PDF/);
        return true;
    });
    const error = new DesktopDomainError('DOCUMENT_PDF_NO_TEXT', 'English diagnostic');
    const roundtrip = domainMessageFromError(JSON.parse(JSON.stringify(error)));
    assert.equal(roundtrip.code, error.domainError.code);
    assert.equal(roundtrip.fallbackEnglish, error.domainError.fallbackEnglish);
});

test('failed terminal probes and command failures reach UI as localized status without raw diagnostics', async () => {
    const { resolveTerminalProfiles } = await import('../lib/node/nextmux-terminal-profile-resolver.js');
    const { terminalSurfaceText } = await import('../lib/browser/nextmux-terminal-locale.js');
    const { agentCommandEntries, agentCommandTranscript } = await import('../lib/browser/nextmux-agent-command-log.js');
    const runtime = await resolveTerminalProfiles({ platform: 'win32', architecture: 'x64', hostArchitecture: 'x64', osRelease: '10.0.26100',
        env: { SystemRoot: 'C:\\Windows', COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }, wslDistributions: ['Ubuntu'],
        findExecutables: async () => [], existingExecutable: async candidate => /(?:cmd|wsl)\.exe$/.test(candidate) ? candidate : undefined,
        validateProfile: async () => { throw new DesktopDomainError('TERMINAL_PROBE_TIMEOUT', 'RAW_PROBE_PRIVATE'); } });
    assert.equal(runtime.supportStatus, 'unsupported');
    assert.equal(runtime.wslStatus, 'probe_failed');
    assert.doesNotMatch(JSON.stringify(runtime), /RAW_PROBE_PRIVATE/);
    const entries = agentCommandEntries('turn', [
        { type: 'tool_process_started', at: '', callId: 'call', toolName: 'process.run', commandLine: 'echo unchanged', processId: 'p', interactive: false },
        { type: 'tool_process_exited', at: '', callId: 'call', toolName: 'process.run', processId: 'p', exitCode: 1, signal: null, failure: 'RAW_PROCESS_PRIVATE' }
    ], false);
    assert.equal(entries[0].state, 'failed');
    assert.doesNotMatch(JSON.stringify(entries), /RAW_PROCESS_PRIVATE/);
    for (const locale of locales) {
        assert.ok(terminalSurfaceText(locale, 'wslProbeFailed'));
        assert.doesNotMatch(agentCommandTranscript(locale, entries), /RAW_PROCESS_PRIVATE/);
        assert.equal(componentDomainMessage(locale, { code: 'TERMINAL_RUNTIME_UNSUPPORTED', fallbackEnglish: 'RAW_PROBE_PRIVATE' }), terminalSurfaceText(locale, 'unsupportedRuntime'));
    }
});
