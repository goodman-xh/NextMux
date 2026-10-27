import * as React from '@theia/core/shared/react';
import type { NextMuxPlatformService } from '../common/nextmux-platform-protocol';
import type { ProjectMemoryDocument, ProjectMemoryEntry, ProjectMemorySource, ProjectKnowledgeSnapshot } from '../common/nextmux-project-memory';
import { projectMemoryReviewText } from '../common/nextmux-project-memory';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { projectMemoryText, projectMemoryErrorKey, type ProjectMemoryTextKey } from './nextmux-project-memory-locale';
import '../../src/browser/style/nextmux-project-memory.css';

type MemoryApi = Pick<NextMuxPlatformService, 'getProjectKnowledge' | 'saveProjectMemory' | 'removeProjectMemory' | 'adoptProjectExperience'>;
export interface ProjectMemoryPanelProps {
    readonly workspaceRoot: string;
    readonly locale: NextMuxDesktopLocale;
    readonly api: MemoryApi;
    readonly onClose: () => void;
    readonly onOpenFile: (relativePath: string) => void;
    readonly onOpenDesign: () => Promise<void>;
}

/** A small editor attached to the existing project menu, never a new workspace page. */
export function ProjectMemoryPanel(props: ProjectMemoryPanelProps): React.ReactElement {
    const t = (key: ProjectMemoryTextKey, values?: Record<string, string>): string => projectMemoryText(props.locale, key, values);
    const panel = React.useRef<HTMLElement>(null);
    const defaultSource = `user: ${t('userRecord')}`;
    const previousDefaultSource = React.useRef(defaultSource);
    const [snapshot, setSnapshot] = React.useState<ProjectKnowledgeSnapshot>();
    const [selected, setSelected] = React.useState('');
    const [kind, setKind] = React.useState<'fact' | 'experience'>('fact');
    const [title, setTitle] = React.useState('');
    const [content, setContent] = React.useState('');
    const [sources, setSources] = React.useState(defaultSource);
    const [verification, setVerification] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<ProjectMemoryTextKey>();
    const [deleteReview, setDeleteReview] = React.useState(false);
    const mounted = React.useRef(true);
    const entry = snapshot?.memory.entries.find(item => item.id === selected);
    const sourceText = (item: ProjectMemoryEntry): string => item.sources.map(source => `${source.kind}: ${source.reference}`).join('\n');
    const dirty = entry ? kind !== entry.kind || title !== entry.title || content !== entry.content || sources !== sourceText(entry) : Boolean(title || content);
    const select = (item?: ProjectMemoryEntry): void => {
        setSelected(item?.id || ''); setKind(item?.kind || 'fact'); setTitle(item?.title || ''); setContent(item?.content || '');
        setSources(item ? sourceText(item) : defaultSource); setVerification(''); setDeleteReview(false); setError(undefined);
    };
    React.useEffect(() => {
        mounted.current = true;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        panel.current?.querySelector<HTMLElement>('button')?.focus();
        void props.api.getProjectKnowledge(props.workspaceRoot).then(value => { if (mounted.current) setSnapshot(value); }, reason => {
            if (mounted.current) setError(projectMemoryErrorKey(reason, 'loadFailed'));
        });
        return () => { mounted.current = false; previous?.focus(); };
    }, [props.workspaceRoot, props.api]);
    React.useEffect(() => {
        const previous = previousDefaultSource.current;
        setSources(current => !selected && current === previous ? defaultSource : current);
        previousDefaultSource.current = defaultSource;
    }, [defaultSource, selected]);
    const apply = (memory: ProjectMemoryDocument): void => setSnapshot(current => current ? { ...current, memory } : { memory, memoryPath: '.nextmux/project-memory.json' });
    const action = async (operation: () => Promise<void>): Promise<void> => {
        if (busy) return;
        setBusy(true); setError(undefined);
        try { await operation(); } catch (reason) { if (mounted.current) setError(projectMemoryErrorKey(reason)); }
        finally { if (mounted.current) setBusy(false); }
    };
    const save = (): void => { void action(async () => {
        if (!snapshot) return;
        const references: ProjectMemorySource[] = sources.split('\n').filter(line => line.trim()).map(line => {
            const match = /^(user|conversation|file|tool):\s*(.+)$/.exec(line);
            return { kind: match ? match[1] as ProjectMemorySource['kind'] : 'user', reference: match ? match[2] : line.trim() };
        });
        const memory = await props.api.saveProjectMemory(props.workspaceRoot, { ...(selected ? { id: selected } : {}), kind, title, content, sources: references }, snapshot.memory.revision);
        if (!mounted.current) return;
        apply(memory); select(memory.entries.find(item => item.id === selected) || memory.entries[memory.entries.length - 1]);
    }); };
    return <div className='nmx-project-memory-backdrop' dir={props.locale === 'ar' ? 'rtl' : undefined} data-nmx-literal onMouseDown={event => event.stopPropagation()}>
        <section ref={panel} className='nmx-project-memory-panel' role='dialog' aria-modal='true' aria-labelledby='nmx-project-memory-title' onKeyDown={event => {
            if (event.key === 'Escape' && !busy) { event.stopPropagation(); if (dirty) setError('unsaved'); else props.onClose(); }
            if (event.key === 'Tab') {
                const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select') || [])];
                if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1]?.focus(); }
                if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0]?.focus(); }
            }
        }}>
            <header><div><h2 id='nmx-project-memory-title'>{t('title')}</h2><p title={props.workspaceRoot}>{props.workspaceRoot.split(/[\\/]/).filter(Boolean).pop()}</p></div>
                <button aria-label={t('close')} disabled={busy} onClick={() => dirty ? setError('unsaved') : props.onClose()}><i className='codicon codicon-close' /></button></header>
            <div className='nmx-project-memory-intro'>{t('intro')}</div>
            <nav aria-label={t('files')}><button disabled={busy || dirty} onClick={() => void action(props.onOpenDesign)}><i className='codicon codicon-symbol-color' />{t(snapshot?.design ? 'editDesign' : 'createDesign')}</button>
                <button disabled={!snapshot?.memory.revision || busy || dirty} onClick={() => props.onOpenFile('.nextmux/project-memory.json')}>{t('openMemory')}</button>
                <button disabled={busy || dirty} onClick={() => void action(async () => { const next = await props.api.getProjectKnowledge(props.workspaceRoot); if (mounted.current) { setSnapshot(next); select(next.memory.entries.find(item => item.id === selected)); } })}>{t('refresh')}</button></nav>
            {error && <p className='nmx-project-memory-error' role='alert'>{t(error)}</p>}
            <div className='nmx-project-memory-body'>
                <aside aria-label={t('entries')}><button className='nmx-project-memory-add' disabled={busy || dirty} onClick={() => select()}>＋ {t('new')}</button>
                    {snapshot?.memory.entries.map(item => <button key={item.id} disabled={busy || dirty} aria-pressed={item.id === selected} className={item.id === selected ? 'is-selected' : ''} onClick={() => select(item)}><strong>{item.title}</strong><small>{t(item.kind === 'fact' ? 'fact' : item.adoption ? 'adopted' : 'pending')} · v{item.revision}</small></button>)}
                    {snapshot && !snapshot.memory.entries.length && <p>{t('empty')}</p>}
                    {!snapshot && !error && <p>{t('loading')}</p>}
                </aside>
                <div className='nmx-project-memory-editor'>
                    <label>{t('kind')}<select value={kind} disabled={busy} onChange={event => setKind(event.currentTarget.value as 'fact' | 'experience')}><option value='fact'>{t('fact')}</option><option value='experience'>{t('pending')}</option></select></label>
                    <label>{t('titleLabel')}<input dir='auto' maxLength={160} value={title} disabled={busy} onChange={event => setTitle(event.currentTarget.value)} /></label>
                    <label>{t('content')}<textarea dir='auto' rows={7} maxLength={6000} value={content} disabled={busy} placeholder={t('contentPlaceholder')} onChange={event => setContent(event.currentTarget.value)} /></label>
                    <label>{t('sources')}<textarea dir='ltr' rows={2} maxLength={6000} value={sources} disabled={busy} onChange={event => setSources(event.currentTarget.value)} /></label>
                    <small>{t('sourceHelp')}</small>
                    {entry && <small>{t('version', { version: String(entry.revision), date: new Date(entry.updatedAt).toLocaleString(props.locale) })}</small>}
                    <div className='nmx-project-memory-actions'><button className='is-primary' disabled={busy || !snapshot || !title.trim() || !content.trim() || !sources.trim() || !dirty} onClick={save}>{t('save')}</button>
                        {dirty && <button disabled={busy} onClick={() => select(entry)}>{t('discard')}</button>}
                        {entry && <button disabled={busy || dirty} onClick={() => {
                            if (!deleteReview) { setDeleteReview(true); return; }
                            void action(async () => { const memory = await props.api.removeProjectMemory(props.workspaceRoot, entry.id, snapshot!.memory.revision); if (mounted.current) { apply(memory); select(); } });
                        }}>{t(deleteReview ? 'confirmDelete' : 'delete')}</button>}</div>
                    {entry?.adoption && <div className='nmx-project-memory-adoption'><strong>{t('adoptedTitle')}</strong><p>{t('separate')}</p><button disabled={busy || dirty} onClick={() => props.onOpenFile(entry.adoption!.skillPath)}>{t('openSkill')}</button></div>}
                    {entry?.kind === 'experience' && !entry.adoption && <div className='nmx-project-memory-adoption'><strong>{t('adoptTitle')}</strong><p>{t('adoptHint')}</p>
                        <label>{t('verification')}<textarea dir='auto' rows={2} value={verification} maxLength={2000} disabled={busy || dirty} placeholder={t('verificationPlaceholder')} onChange={event => setVerification(event.currentTarget.value)} /></label>
                        <button disabled={busy || dirty || !verification.trim()} onClick={() => void action(async () => {
                            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(projectMemoryReviewText(entry)));
                            const expectedSourceSha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
                            const memory = await props.api.adoptProjectExperience(props.workspaceRoot, entry.id, snapshot!.memory.revision, verification, expectedSourceSha256);
                            if (mounted.current) { apply(memory); select(memory.entries.find(item => item.id === entry.id)); }
                        })}>{t('confirmAdopt')}</button></div>}
                </div>
            </div>
        </section>
    </div>;
}
