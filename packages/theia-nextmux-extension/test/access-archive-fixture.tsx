import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { McpAccessPanel } from '../src/browser/nextmux-mcp-access-panel';
import { ConversationArchivePanel } from '../src/browser/nextmux-conversation-archive-panel';
import { BillingReceiptPanel } from '../src/browser/nextmux-billing-receipt-panel';
import type { NextMuxDesktopLocale } from '../src/browser/nextmux-locale';
import type { NextMuxPlatformService } from '../src/common/nextmux-platform-protocol';
import { createAccessArchiveFixture } from './access-archive-fixture-state.mjs';

const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt-BR', 'ru', 'ar', 'hi'] as const;
const params = new URLSearchParams(location.search);
const initialLocale = locales.find(value => value === params.get('lang')) || 'zh-CN';
const requestedWidth = Number(params.get('width'));

function Fixture(): React.ReactElement {
    const [, update] = React.useReducer(value => value + 1, 0);
    const [backend] = React.useState(() => createAccessArchiveFixture(update));
    const [locale, setLocale] = React.useState<NextMuxDesktopLocale>(initialLocale);
    const [disabled, setDisabled] = React.useState(false);
    const [historyEnabled, setHistoryEnabled] = React.useState(true);
    const [metrics, setMetrics] = React.useState('');
    const snapshot = backend.snapshot();
    const service = backend.service as unknown as NextMuxPlatformService;
    const width = Number.isFinite(requestedWidth) && requestedWidth >= 280 ? Math.min(requestedWidth, 1280) : 1100;
    const measureLayout = (): void => setMetrics(JSON.stringify({
        viewport: innerWidth, document: document.documentElement.scrollWidth,
        panels: [...document.querySelectorAll('.nmx-mcp-access,.nmx-conversation-archive')].map(element => ({
            width: Math.round(element.getBoundingClientRect().width), busy: element.getAttribute('aria-busy')
        })),
        previewVisible: Boolean(document.querySelector('.nmx-archive-preview'))
    }));
    return <main className='fixture nmx-desktop-widget' dir={locale === 'ar' ? 'rtl' : 'ltr'} style={{ maxWidth: width }}>
        <nav aria-label='Fixture controls'>
            <select aria-label='Locale' value={locale} onChange={event => setLocale(event.currentTarget.value as NextMuxDesktopLocale)}>{locales.map(value => <option key={value}>{value}</option>)}</select>
            <label>Next archive <select aria-label='Next archive' value={snapshot.choice} onChange={event => backend.setChoice(event.currentTarget.value)}><option value='good'>Good synthetic archive</option><option value='bad'>Bad synthetic archive</option><option value='cancel'>Cancel picker</option></select></label>
            <label><input type='checkbox' checked={snapshot.holdNext} onChange={event => backend.setHold(event.currentTarget.checked)} />Hold next RPC</label>
            <button disabled={!snapshot.pending} onClick={() => backend.settleHeld(true)}>Resolve held RPC</button>
            <button disabled={!snapshot.pending} onClick={() => backend.settleHeld(false)}>Fail held RPC</button>
            <button onClick={() => backend.externalRevoke()}>External revoke (then Refresh)</button>
            <label><input type='checkbox' checked={disabled} onChange={event => setDisabled(event.currentTarget.checked)} />Running task</label>
            <label><input type='checkbox' checked={historyEnabled} onChange={event => setHistoryEnabled(event.currentTarget.checked)} />Local history</label>
            <button onClick={measureLayout}>Measure layout</button>
            <select aria-label='Receipt result' value={snapshot.recovery} onChange={event => backend.setRecovery(event.currentTarget.value)}>{['recovered', 'pending', 'review', 'expired', 'media'].map(value => <option key={value}>{value}</option>)}</select>
        </nav>
        <p>Isolated QA · actual source components and production CSS · synthetic RPC only · no files, keys, processes or external services</p>
        <output aria-label='Fixture state'>{JSON.stringify({ counts: snapshot.counts, pending: snapshot.pending || 'none', servers: snapshot.servers.map(server => ({ name: server.name, running: server.running, approved: server.approved, tools: server.tools.filter(tool => tool.approved).map(tool => tool.name) })), previewId: snapshot.previewId || 'none' })}</output>
        <output aria-label='Layout metrics'>{metrics}</output>
        <div className='fixture-stage nmx-shell nmx-theme-light'>
            <section className='nmx-settings-panel'><McpAccessPanel locale={locale} service={service} addServer={backend.addServer} onChange={update} /></section>
            <section className='nmx-settings-panel nmx-local-data-settings'><ConversationArchivePanel locale={locale} service={service} disabled={disabled} historyEnabled={historyEnabled} sessionIds={['a', 'b', 'c']} selectedSessionId='a'
                chooseFile={backend.chooseFile} beforeOperation={async () => {}} afterImport={async () => { update(); }} /></section>
            <section className='nmx-settings-panel'><BillingReceiptPanel locale={locale} service={service} ownerId='fixture-owner' openSavedFile={backend.openSavedFile} usage={[]} afterRecovery={async () => { update(); }} /></section>
        </div>
    </main>;
}
createRoot(document.getElementById('fixture')!).render(<Fixture />);
