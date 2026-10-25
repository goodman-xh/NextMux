import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { editorRecoveryErrorKey, editorRecoveryText } from './nextmux-editor-recovery-locale';

export interface EditorRecoveryPanelEntry {
    readonly key: string;
    readonly name: string;
    readonly path?: string;
    readonly status: 'memory' | 'saving' | 'saved' | 'error';
    readonly error?: string;
    /** Opaque revision identity only; never file contents. */
    readonly version?: string;
}
export interface NextMuxEditorRecoveryPanelProps {
    readonly locale: NextMuxDesktopLocale;
    readonly entries: readonly EditorRecoveryPanelEntry[];
    readonly busy?: boolean;
    readonly onOpen: (key: string) => void | Promise<void>;
    readonly onRetry: () => void | Promise<void>;
    readonly onDiscard: (key: string, version?: string) => void | Promise<void>;
}

function revealConfirmation(node: HTMLDivElement | null): void {
    node?.scrollIntoView({ block: 'nearest' });
}

/** Presentation only: opening a copy never means writing its original file. */
export function NextMuxEditorRecoveryPanel(props: NextMuxEditorRecoveryPanelProps): React.ReactElement {
    const [confirmation, setConfirmation] = React.useState<{ key: string; version?: string }>();
    const [working, setWorking] = React.useState(false);
    const [failed, setFailed] = React.useState(false);
    const operation = React.useRef(false);
    const mounted = React.useRef(true);
    const latest = React.useRef(props);
    latest.current = props;
    // The store permits 32 durable copies; another window can fill that quota
    // while this window still has 32 unsaved local copies needing attention.
    const entries = props.entries.slice(0, 64);
    const disabled = Boolean(props.busy || working);
    const t = (key: Parameters<typeof editorRecoveryText>[1]): string => editorRecoveryText(props.locale, key);
    React.useEffect(() => () => { mounted.current = false; }, []);
    React.useEffect(() => {
        if (confirmation && !props.entries.some(entry => entry.key === confirmation.key && entry.version === confirmation.version)) {
            setConfirmation(undefined);
        }
    }, [props.entries, confirmation]);
    const perform = async (action: () => void | Promise<void>): Promise<void> => {
        if (latest.current.busy || operation.current) return;
        operation.current = true;
        setWorking(true); setFailed(false);
        try { await action(); if (mounted.current) setConfirmation(undefined); }
        catch { if (mounted.current) setFailed(true); }
        finally { operation.current = false; if (mounted.current) setWorking(false); }
    };
    return <section className='nmx-editor-recovery' aria-busy={disabled} dir={props.locale === 'ar' ? 'rtl' : undefined}>
        <header><strong>{t('title')}</strong>{entries.some(entry => entry.status === 'error' || entry.status === 'memory') &&
            <button type='button' disabled={disabled} onClick={() => { void perform(props.onRetry); }}>{t('retry')}</button>}</header>
        {/* The privacy toggle directly above already explains recovery copies. */}
        {!entries.length ? <p>{t('empty')}</p> : <ul>{entries.map(entry => <li key={entry.key} data-recovery-key={entry.key}>
            <div><strong title={entry.name} data-nmx-literal>{entry.name}</strong>{entry.path && <bdi dir='ltr' title={entry.path} data-nmx-literal>{entry.path}</bdi>}
                <small role='status'>{t(entry.status === 'error' ? editorRecoveryErrorKey(entry.error) : entry.status)}</small></div>
            {confirmation?.key === entry.key ? <div className='nmx-editor-recovery-confirm' ref={revealConfirmation}>
                <p>{t('confirmDiscard')}</p><nav>
                    <button type='button' disabled={disabled} onClick={() => setConfirmation(undefined)}>{t('cancel')}</button>
                    <button type='button' className='is-danger' disabled={disabled} onClick={() => {
                        const current = latest.current.entries.find(item => item.key === confirmation.key);
                        if (!current || current.version !== confirmation.version) { setConfirmation(undefined); return; }
                        void perform(() => latest.current.onDiscard(confirmation.key, confirmation.version));
                    }}>{t('discard')}</button>
                </nav>
            </div> : <nav>
                <button type='button' disabled={disabled || entry.status === 'saving'} onClick={() => { void perform(() => props.onOpen(entry.key)); }}>{t('open')}</button>
                <button type='button' disabled={disabled || entry.status === 'saving'} onClick={() => { setFailed(false); setConfirmation({ key: entry.key, version: entry.version }); }}>{t('discard')}</button>
            </nav>}
        </li>)}</ul>}
        {failed && <p role='alert'>{t('failed')}</p>}
    </section>;
}
