import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ConversationArchivePanel } from '../src/browser/nextmux-conversation-archive-panel';
import type { NextMuxDesktopLocale } from '../src/browser/nextmux-locale';
import type { NextMuxPlatformService } from '../src/common/nextmux-platform-protocol';

/** Real component, fixture-only RPCs: no files, credentials, network or running desktop state. */
function Fixture(): React.ReactElement {
    const [locale, setLocale] = React.useState<NextMuxDesktopLocale>('zh-CN');
    const [theme, setTheme] = React.useState<'dark' | 'light'>('dark');
    React.useEffect(() => { document.documentElement.dataset.fixtureTheme = theme; }, [theme]);
    const [disabled, setDisabled] = React.useState(false);
    const [historyEnabled, setHistoryEnabled] = React.useState(true);
    const [fail, setFail] = React.useState(false);
    const [refreshFail, setRefreshFail] = React.useState(false);
    const [, update] = React.useReducer(value => value + 1, 0);
    const controls = React.useRef({ fail: false, refreshFail: false }); controls.current = { fail, refreshFail };
    const counts = React.useRef({ before: 0, picker: 0, preview: 0, export: 0, import: 0, refresh: 0, binding: 0, directory: 0, lastPolicy: '', labeledExport: false, lastPreview: '' });
    const currentPreview = React.useRef<Record<string, any>>();
    const mark = (kind: 'before' | 'picker' | 'preview' | 'export' | 'import' | 'refresh' | 'binding' | 'directory'): void => { counts.current[kind]++; update(); };
    const delay = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 1_200)); if (controls.current.fail) throw new Error('SIMULATED_FAILURE — 原始文件未修改；يمكن إعادة المحاولة。'); };
    const [service] = React.useState(() => ({
        exportConversationArchive: async (_uri: string, _ids: string[], options?: { projects?: unknown[] }) => { mark('export'); counts.current.labeledExport = Boolean(options?.projects?.length); await delay(); return { conversations: 3, attachments: 2 }; },
        previewConversationArchive: async () => { mark('preview'); await delay(); const preview = { previewId: crypto.randomUUID(), sha256: 'fixture-sha', bytes: 12345, attachments: 2, attachmentBytes: 50,
            projects: [{ ref: 'first-project', label: 'LongProjectNameWithoutSpaces'.repeat(5), conversations: 8, binding: { kind: 'owned_workspace' } }, { ref: 'other-project', label: 'مشروع محفوظ — zweites Projekt', conversations: 8, binding: { kind: 'owned_workspace' } }],
            warnings: ['conversation_text_and_attachments_may_contain_secrets', 'runtime_credentials_workspaces_permissions_and_pending_queue_not_imported'],
            conversations: Array.from({ length: 16 }, (_, index) => ({ id: `fixture-${index}`, projectRef: index < 8 ? 'first-project' : 'other-project', title: index === 0 ? '长会话名称 LongConversationWithoutSpaces'.repeat(8) : `محادثة محفوظة ${index} — Gesprächsübertragungsprüfung`, turns: 10, attachments: 1, conflict: index < 2, copyId: `copy-${index}`, copyConflict: index === 1 })) }; currentPreview.current = preview; return preview; },
        prepareConversationArchiveBindings: async (id: string, bindings: { projectRef: string; directoryUri: string | null }[]) => { mark('binding'); const previous = currentPreview.current; currentPreview.current = undefined; await delay(); if (!previous || id !== previous.previewId) throw new Error('STALE_PREVIEW');
            const next = { ...previous, previewId: crypto.randomUUID(), projects: previous.projects.map((project: any) => { const uri = bindings.find(binding => binding.projectRef === project.ref)?.directoryUri; return { ...project, binding: uri ? { kind: 'local_directory', directoryUri: uri, directoryPath: `/local/${'long-explicit-directory-'.repeat(14)}` } : { kind: 'owned_workspace' } }; }) }; currentPreview.current = next; return next; },
        importConversationArchive: async (id: string, policy: string) => { mark('import'); counts.current.lastPolicy = policy; counts.current.lastPreview = id; if (id !== currentPreview.current?.previewId) throw new Error('STALE_PREVIEW'); currentPreview.current = undefined; await delay(); return { imported: policy === 'copy' ? 15 : 14, skipped: policy === 'copy' ? 1 : 2 }; }
    }) as unknown as NextMuxPlatformService);
    return <main className={`fixture nmx-desktop-widget${theme === 'light' ? ' nmx-theme-light' : ''}`} data-fixture-theme={theme} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <nav aria-label='Fixture controls'>
            <select aria-label='Locale' value={locale} onChange={event => setLocale(event.currentTarget.value as NextMuxDesktopLocale)}>{['zh-CN', 'en', 'de', 'ar'].map(value => <option key={value}>{value}</option>)}</select>
            <select aria-label='Fixture theme' value={theme} onChange={event => setTheme(event.currentTarget.value as 'dark' | 'light')}><option value='dark'>Dark fixture</option><option value='light'>Light fixture</option></select>
            <label><input type='checkbox' checked={fail} onChange={event => setFail(event.currentTarget.checked)} />Simulate RPC failure</label>
            <label><input data-refresh-failure type='checkbox' checked={refreshFail} onChange={event => setRefreshFail(event.currentTarget.checked)} />Simulate refresh failure</label>
            <label><input type='checkbox' checked={disabled} onChange={event => setDisabled(event.currentTarget.checked)} />Running task</label>
            <label><input type='checkbox' checked={historyEnabled} onChange={event => setHistoryEnabled(event.currentTarget.checked)} />Local history</label>
        </nav>
        <p>Isolated archive component · mock RPC only · no external requests or filesystem changes</p>
        <output aria-label='Fixture counters'>{JSON.stringify(counts.current)}</output>
        <ConversationArchivePanel locale={locale} service={service} disabled={disabled} historyEnabled={historyEnabled} sessionIds={['a', 'b', 'c']} selectedSessionId='a'
            projectGroups={[{ id: 'a', sessionIds: ['a', 'b'], titles: ['First conversation', 'Second conversation'] }, { id: 'c', sessionIds: ['c'], titles: ['Other project conversation'] }]}
            chooseFile={async kind => { mark('picker'); return `file:///fixture/${kind}.nmxarchive`; }}
            chooseDirectory={async () => { mark('directory'); return 'file:///local/explicitly-picked'; }}
            beforeOperation={async () => { mark('before'); }} afterImport={async () => { mark('refresh'); if (controls.current.refreshFail) throw new Error('REFRESH_FAILED'); }} />
    </main>;
}
createRoot(document.getElementById('fixture')!).render(<Fixture />);
