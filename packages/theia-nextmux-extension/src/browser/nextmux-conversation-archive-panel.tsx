import { conversationErrorPresentation, conversationDetailsLabel, conversationDisplayTitle } from './nextmux-conversation-domain-locale';
import * as React from 'react';
import type { ConversationArchiveImportResult, ConversationArchivePreview } from '../common/nextmux-conversation-archive';
import type { NextMuxPlatformService } from '../common/nextmux-platform-protocol';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { archiveText, archiveWarningText } from './nextmux-conversation-archive-locale';
import { archiveProjectExportOptions, ArchiveUiProjectGroup } from './nextmux-archive-project-ui';
import { archiveProjectText } from './nextmux-archive-project-locale';

export interface ConversationArchivePanelProps {
    readonly locale: NextMuxDesktopLocale;
    readonly service: NextMuxPlatformService;
    readonly disabled: boolean;
    readonly historyEnabled: boolean;
    readonly sessionIds: readonly string[];
    readonly selectedSessionId?: string;
    readonly projectGroups?: readonly ArchiveUiProjectGroup[];
    readonly chooseFile: (kind: 'open' | 'save') => Promise<string | undefined>;
    readonly chooseDirectory?: () => Promise<string | undefined>;
    readonly beforeOperation: () => Promise<void>;
    readonly afterImport: (result: ConversationArchiveImportResult) => Promise<void>;
}

/** Explicit, bounded file transfer; archive contents never become tool permissions. */
export function ConversationArchivePanel(props: ConversationArchivePanelProps): React.ReactElement {
    const [busy, setBusy] = React.useState(false);
    const [preview, setPreview] = React.useState<ConversationArchivePreview>();
    const [policy, setPolicy] = React.useState<'skip' | 'copy'>('skip');
    const [message, setMessage] = React.useState<{ key: 'failed' | 'exported' | 'imported'; values?: Readonly<Record<string, string | number>>; failure?: unknown }>();
    const [error, setError] = React.useState(false);
    const [refreshWarning, setRefreshWarning] = React.useState<ConversationArchiveImportResult>();
    const operation = React.useRef(false);
    const t = (key: Parameters<typeof archiveText>[1], values?: Readonly<Record<string, string | number>>): string => archiveText(props.locale, key, values);
    const pt = (key: Parameters<typeof archiveProjectText>[1], values?: Readonly<Record<string, string | number>>): string => archiveProjectText(props.locale, key, values);
    const groups = props.projectGroups || [];
    const groupLabel = (group: ArchiveUiProjectGroup, index: number): string => group.label ?? pt('defaultLabel', { number: index + 1 });
    const disabled = busy || props.disabled || !props.historyEnabled;
    const perform = async (action: () => Promise<void>): Promise<void> => {
        if (operation.current || props.disabled || !props.historyEnabled) return;
        operation.current = true;
        setBusy(true); setMessage(undefined); setRefreshWarning(undefined); setError(false);
        try { await props.beforeOperation(); await action(); }
        catch (failure) { setError(true); setMessage({ key: 'failed', failure }); }
        finally { operation.current = false; setBusy(false); }
    };
    const exportFile = (ids?: readonly string[]): void => {
        void perform(async () => {
            const options = groups.length > 0
                ? archiveProjectExportOptions(groups, ids || props.sessionIds, Object.fromEntries(groups.map((group, index) => [group.id, groupLabel(group, index)])))
                : undefined;
            const uri = await props.chooseFile('save');
            if (!uri) return;
            await props.beforeOperation();
            const result = await props.service.exportConversationArchive(uri, ids, options);
            setMessage({ key: 'exported', values: { conversations: result.conversations, attachments: result.attachments } });
        });
    };
    const chooseArchive = (): void => {
        void perform(async () => {
            const uri = await props.chooseFile('open');
            if (!uri) return;
            // A failed new selection must not leave the previous archive importable.
            setPreview(undefined);
            setPreview(await props.service.previewConversationArchive(uri));
            setPolicy('skip');
        });
    };
    const bindProject = (projectRef: string, useOwned: boolean): void => {
        const current = preview;
        if (!current?.projects) return;
        void perform(async () => {
            const directoryUri = useOwned ? null : await props.chooseDirectory?.();
            if (directoryUri === undefined) return;
            // Every prepare consumes the old receipt, including failed directory checks.
            setPreview(undefined);
            const bindings = current.projects!.map(project => ({ projectRef: project.ref,
                directoryUri: project.ref === projectRef ? directoryUri : project.binding.kind === 'local_directory' ? project.binding.directoryUri : null }));
            setPreview(await props.service.prepareConversationArchiveBindings(current.previewId, bindings));
        });
    };
    const importFile = (): void => {
        if (!preview) return;
        void perform(async () => {
            // An import failure may invalidate its bindings; never reuse an old confirmation.
            setPreview(undefined);
            const result = await props.service.importConversationArchive(preview.previewId, policy);
            setMessage({ key: 'imported', values: { imported: result.imported, skipped: result.skipped } });
            try { await props.afterImport(result); }
            catch { setRefreshWarning(result); }
        });
    };
    const failure = message?.key === 'failed' ? conversationErrorPresentation(props.locale, message.failure, 'archive_failed') : undefined;
    const conflicts = preview?.conversations.filter(item => item.conflict).length || 0;
    return <section className='nmx-conversation-archive' aria-busy={busy} dir={props.locale === 'ar' ? 'rtl' : undefined}>
        <header className='nmx-archive-header'>
            <h3><i className='codicon codicon-archive' aria-hidden='true'></i>{t('title')}</h3>
            <p>{t('description')}</p>
        </header>
        {!props.historyEnabled ? <p className='nmx-archive-state'>{t('historyDisabled')}</p> : props.disabled && <p className='nmx-archive-state'>{t('busyHint')}</p>}
        <div className='nmx-archive-cards'>
            <article className='nmx-archive-card'>
                <h4><i className='codicon codicon-cloud-upload' aria-hidden='true'></i>{pt('exportTitle')}</h4>
                <div className='nmx-settings-actions'>
                    <button disabled={disabled || !props.sessionIds.length} onClick={() => exportFile()}>{t('exportAll')}</button>
                </div>
            </article>
            <article className='nmx-archive-card'>
                <h4><i className='codicon codicon-cloud-download' aria-hidden='true'></i>{pt('importTitle')}</h4>
                <p>{pt('importHint')}</p>
                <div className='nmx-settings-actions'>
                    <button disabled={disabled} onClick={chooseArchive}>{t('chooseArchive')}</button>
                </div>
            </article>
        </div>
        <p className='nmx-archive-privacy'><i className='codicon codicon-shield' aria-hidden='true'></i>{t('privacy')}</p>
        {preview && <div className='nmx-archive-preview'>
            <strong>{t('previewTitle')}</strong>
            <p>{t('previewSummary', { conversations: preview.conversations.length, attachments: preview.attachments, bytes: `${(preview.bytes / 1024 / 1024).toFixed(1)} MB` })}</p>
            <ul className='nmx-archive-conversations'>{preview.conversations.map(item => <li key={item.id}>
                <span data-nmx-literal>{conversationDisplayTitle(props.locale, item)}</span>
                {item.conflict && <small>{t(item.copyConflict ? 'copyExists' : 'existing')}</small>}
            </li>)}</ul>
            {!!preview.projects?.length && <section className='nmx-archive-bindings'>
                <strong>{pt('bindings')}</strong><p>{pt('bindingBoundary')}</p>
                <div className='nmx-archive-project-list'>{preview.projects.map(project => <article key={project.ref}>
                    <strong data-nmx-literal>{project.label}</strong><small>{pt('conversations', { count: project.conversations })}</small>
                    {project.binding.kind === 'local_directory' ? <bdi dir='ltr' data-nmx-literal>{project.binding.directoryPath}</bdi> : <span>{pt('owned')}</span>}
                    <div className='nmx-settings-actions'><button disabled={disabled || !props.chooseDirectory} onClick={() => bindProject(project.ref, false)}>{pt('choose')}</button>
                        {project.binding.kind === 'local_directory' && <button disabled={disabled} onClick={() => bindProject(project.ref, true)}>{pt('reset')}</button>}</div>
                </article>)}</div>
            </section>}
            {preview.warnings.length > 0 && <details><summary>{t('warnings')}</summary><ul>{preview.warnings.map((warning, index) => <li key={index} data-nmx-literal>{archiveWarningText(props.locale, warning)}</li>)}</ul></details>}
            {conflicts > 0 && <label className='nmx-archive-policy'>{t('conflicts', { count: conflicts })}
                <select disabled={disabled} value={policy} onChange={event => setPolicy(event.currentTarget.value as 'skip' | 'copy')}>
                    <option value='skip'>{t('skipConflicts')}</option><option value='copy'>{t('copyConflicts')}</option>
                </select>
            </label>}
            <div className='nmx-settings-actions'><button disabled={busy} onClick={() => setPreview(undefined)}>{t('cancel')}</button><button className='is-primary' disabled={disabled} onClick={importFile}>{t(busy ? 'importing' : 'importNow')}</button></div>
        </div>}
        {message && <div className={`nmx-network-message ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'} data-nmx-literal>{failure?.summary || t(message.key, message.values)}{failure?.details && <details><summary>{conversationDetailsLabel(props.locale)}</summary><pre data-nmx-literal>{failure.details}</pre></details>}</div>}
        {refreshWarning && <p role='alert'>{pt('importedRefreshFailed', { imported: refreshWarning.imported, skipped: refreshWarning.skipped })}</p>}
    </section>;
}
