import * as React from 'react';
import type { McpCredentialChange, McpCredentialReference, McpServerAccess } from '../common/nextmux-mcp-access';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { mcpCredentialText as text } from './nextmux-mcp-credential-locale';

export function McpCredentialEditor({ server, locale, busy, onSave, onCancel }: {
    readonly server: McpServerAccess; readonly locale: NextMuxDesktopLocale; readonly busy: boolean;
    readonly onSave: (change: McpCredentialChange) => Promise<boolean>; readonly onCancel: () => void;
}): React.ReactElement {
    const [kind, setKind] = React.useState<McpCredentialReference['kind'] | 'none'>(server.credential?.kind || 'none');
    const [value, setValue] = React.useState('');
    const [invalid, setInvalid] = React.useState(false);
    const [failed, setFailed] = React.useState(false);
    const inFlight = React.useRef(false);
    return <form className='nmx-mcp-credential-editor' noValidate dir={locale === 'ar' ? 'rtl' : undefined} data-nmx-literal
        onSubmit={event => {
            event.preventDefault();
            if (busy || inFlight.current || server.credentialEditable !== true) return;
            const submitted = value;
            setValue('');
            if (kind !== 'none' && (!submitted || submitted.length > 8192 || /[^\x21-\x7e]/.test(submitted))) { setInvalid(true); return; }
            setInvalid(false); setFailed(false); inFlight.current = true;
            const change: McpCredentialChange = { serverName: server.name, fingerprint: server.fingerprint,
                ...(kind === 'none' ? { action: 'clear' } : { action: 'set', kind, value: submitted }) };
            void onSave(change).catch(() => setFailed(true)).finally(() => { inFlight.current = false; });
        }}>
        <label>{text(locale, 'authentication')}<select disabled={busy} value={kind} onChange={event => { setValue(''); setInvalid(false); setKind(event.currentTarget.value as typeof kind); }}>
            <option value='none'>{text(locale, 'none')}</option><option value='bearer'>Bearer</option><option value='x-api-key'>x-api-key</option><option value='api-key'>api-key</option>
        </select></label>
        {kind !== 'none' && <label>{text(locale, 'secret')}<input type='password' value={value} disabled={busy} maxLength={8192} autoComplete='new-password' spellCheck={false} autoCapitalize='none' dir='ltr'
            onChange={event => { setValue(event.currentTarget.value); setInvalid(false); }} /></label>}
        <p className='nmx-settings-note'>{text(locale, 'boundary')}</p>
        {invalid && <p role='alert'>{text(locale, 'invalid')}</p>}
        {failed && <p role='alert'>{text(locale, 'failed')}</p>}
        <div className='nmx-settings-actions'><button type='submit' disabled={busy || (kind !== 'none' && !value)}>{text(locale, busy ? 'saving' : 'save')}</button>
            <button type='button' disabled={busy} onClick={() => { setValue(''); onCancel(); }}>{text(locale, 'cancel')}</button></div>
    </form>;
}
