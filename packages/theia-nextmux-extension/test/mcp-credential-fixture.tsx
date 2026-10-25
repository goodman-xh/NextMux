import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { McpAccessPanel } from '../src/browser/nextmux-mcp-access-panel';
import type { McpServerAccess } from '../src/common/nextmux-mcp-access';
import type { NextMuxPlatformService } from '../src/common/nextmux-platform-protocol';
import type { NextMuxDesktopLocale } from '../src/browser/nextmux-locale';
import type { MCPFrontendNotificationService } from '@theia/ai-mcp/lib/common/mcp-server-manager';

const initial: McpServerAccess[] = ['fixture-one', 'fixture-two'].map(name => ({ name, fingerprint: 'a'.repeat(64), local: false, credentialEditable: true, connection: 'https://fixture.invalid', details: '{"endpoint":"https://fixture.invalid/long-mcp-endpoint-name-to-test-small-windows"}', approved: false, running: false, needsReview: false, diagnostic: 'authorization', tools: [] }));
initial.push({ name: 'playwright', fingerprint: 'b'.repeat(64), local: true, connection: 'Local process', details: '{"args":2}', approved: true, running: false, needsReview: false, tools: [],
    diagnostic: 'connection', status: 'Errored', failure: { stage: 'connection', code: 'process_exit', exitCode: 43, detail: 'Fixture process closed [redacted]' } });
initial.push({ name: 'filesystem', fingerprint: 'c'.repeat(64), local: true, connection: 'Local process', details: '{"args":1}', approved: true, running: true, needsReview: false, diagnostic: 'ready', tools: [
    { name: 'read_file', description: 'Read a file in the allowed directory.', fingerprint: 'read-v1', supported: true, approved: true },
    { name: 'list_directory', description: 'List directory entries.', fingerprint: 'list-v1', supported: true, approved: false },
    { name: 'unsupported', description: 'Unsupported schema sample.', fingerprint: 'unsupported-v1', supported: false, approved: false }
] });
function Fixture(): React.ReactElement {
    const [width, setWidth] = React.useState(960), [locale, setLocale] = React.useState<NextMuxDesktopLocale>('en');
    const [failure, setFailure] = React.useState(true), [calls, setCalls] = React.useState(0), [geometry, setGeometry] = React.useState('');
    const [actions, setActions] = React.useState<string[]>([]);
    const state = React.useRef(initial);
    const listeners = React.useRef(new Set<() => void>());
    const notifications = React.useMemo(() => ({ onDidUpdateMCPServers: (listener: () => void) => { listeners.current.add(listener); return { dispose: () => listeners.current.delete(listener) }; } }) as MCPFrontendNotificationService, []);
    const service = React.useMemo(() => ({ getMcpAccess: async () => state.current,
        changeMcpAccess: async (change: { serverName: string; action: string; tools?: { name: string }[] }) => {
            setActions(previous => [...previous, `${change.serverName}:${change.action}`]);
            if (change.action === 'start' && change.serverName === 'fixture-fails') {
                state.current = state.current.map(server => server.name !== change.serverName ? server : { ...server, approved: false, running: false,
                    status: 'Errored', diagnostic: 'connection', failure: { stage: 'startup', code: 'protocol', detail: 'Synthetic handshake failure' } });
                throw new Error('synthetic connection failure');
            }
            state.current = state.current.map(server => server.name !== change.serverName ? server : change.action === 'tools'
                ? { ...server, diagnostic: change.tools?.length ? 'ready' : 'tools', tools: server.tools.map(tool => ({ ...tool, approved: tool.supported && Boolean(change.tools?.some(item => item.name === tool.name)) })) }
                : { ...server, failure: undefined, approved: change.action !== 'revoke', running: change.action !== 'revoke', status: change.action === 'revoke' ? 'Not Running' : 'Running',
                    tools: change.action === 'start' && server.name === 'fixture-added' ? initial[3].tools.map(tool => ({ ...tool, approved: false })) : server.tools,
                    diagnostic: change.action === 'revoke' ? 'authorization' : server.name === 'fixture-added' ? 'tools' : 'empty' });
            return state.current;
        }
    }) as NextMuxPlatformService, []);
    return <><nav><select aria-label='Width' value={width} onChange={event => setWidth(Number(event.currentTarget.value))}>{[960, 360, 320].map(n => <option key={n}>{n}</option>)}</select>
        <select aria-label='Locale' value={locale} onChange={event => setLocale(event.currentTarget.value as NextMuxDesktopLocale)}>{['en', 'ar', 'de', 'zh-CN'].map(value => <option key={value}>{value}</option>)}</select>
        <label><input type='checkbox' checked={failure} onChange={event => setFailure(event.currentTarget.checked)} />Simulate failure</label>
        <button data-external-revoke onClick={() => { state.current = state.current.map(server => ({ ...server, fingerprint: crypto.randomUUID(), approved: false, running: false, tools: [] })); for (const listener of listeners.current) listener(); }}>Mock external revoke</button>
        <button onClick={() => { const panel = document.querySelector('.nmx-mcp-access'), editor = document.querySelector('.nmx-mcp-credential-editor'); setGeometry(JSON.stringify({ panelWidth: panel?.getBoundingClientRect().width, scrollWidth: panel?.scrollWidth, editorHeight: editor?.getBoundingClientRect().height, editorScrollHeight: editor?.scrollHeight, passwordEmpty: !document.querySelector<HTMLInputElement>('input[type="password"]')?.value })); }}>Measure</button></nav>
        <output>Mock credential calls: {calls}; no real server or credential store.</output><output>{geometry}</output><output data-access-actions>{actions.join(', ')}</output>
        <main style={{ width, maxWidth: '100%' }}><McpAccessPanel locale={locale} service={service} notifications={notifications} onChange={() => {}} addServer={async (name, configuration) => {
            setActions(previous => [...previous, `add:${name}:${JSON.stringify(configuration)}`]);
            state.current = [...state.current, { name, fingerprint: crypto.randomUUID(), local: 'command' in configuration, connection: 'Fixture', details: '{}', approved: false, running: false, needsReview: false, diagnostic: 'authorization', tools: [] }];
        }} credentialConfigurable={() => true}
            changeCredential={async change => { setCalls(value => value + 1); await new Promise(resolve => window.setTimeout(resolve, 700)); if (failure) throw new Error('synthetic save failure');
                state.current = state.current.map(server => server.name === change.serverName ? { ...server, fingerprint: crypto.randomUUID(), credential: change.action === 'clear' ? undefined : { id: crypto.randomUUID(), revision: crypto.randomUUID(), kind: change.kind! } } : server); return state.current; }} /></main>
    </>;
}
createRoot(document.getElementById('fixture')!).render(<Fixture />);
