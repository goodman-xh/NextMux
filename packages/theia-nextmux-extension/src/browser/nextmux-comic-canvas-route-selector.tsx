import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import type { CanvasModelChoice, CanvasModelFamily, CanvasModelRoute } from './nextmux-comic-canvas';
import { canvasText } from './nextmux-comic-canvas-text';
import { canvasRouteText } from './nextmux-comic-canvas-route-text';
import { canvasConnectionFamilies, canvasPreferredRoute, canvasRouteConnections, canvasRouteSourceKey, canvasRouteSourceKind, type CanvasApiSourceKind, type CanvasRouteConnection } from './nextmux-comic-canvas-route-selection';
import { depositVerifiedHintText } from './nextmux-deposit-verified';
import type { NextMuxDesktopLocale } from './nextmux-locale';

export function useCanvasRouteSelection(families: readonly CanvasModelFamily[], route: CanvasModelChoice | undefined, onSelect: (choice: CanvasModelChoice) => void) {
    const [scope, setScope] = React.useState(() => ({ kind: route ? canvasRouteSourceKind(route) : 'relay' as CanvasApiSourceKind, key: route ? canvasRouteSourceKey(route) : '' }));
    const remembered = React.useRef(new Map<CanvasApiSourceKind, string>());
    const rememberedRoutes = React.useRef(new Map<string, CanvasModelChoice>());
    React.useEffect(() => {
        if (!route) return;
        const kind = canvasRouteSourceKind(route), key = canvasRouteSourceKey(route);
        setScope({ kind, key }); remembered.current.set(kind, key); rememberedRoutes.current.set(key, route);
    }, [route?.key, route?.modelId, route?.sourceKey, route?.routeKind]);
    const connections = canvasRouteConnections(families, scope.kind);
    const connection = connections.find(item => item.key === scope.key);
    const models = connection ? canvasConnectionFamilies(families, connection.key) : [];
    const family = route ? models.find(item => item.routes.some(choice => choice.key === route.key && choice.modelId === route.modelId)) : undefined;
    const selected = family?.routes.find(choice => choice.key === route?.key && choice.modelId === route?.modelId);
    const select = (choice: CanvasModelRoute | undefined): void => {
        if (!choice?.available) return;
        rememberedRoutes.current.set(canvasRouteSourceKey(choice), choice);
        if (choice.key !== route?.key || choice.modelId !== route?.modelId) onSelect(choice);
    };
    const pickConnection = (kind: CanvasApiSourceKind, key: string): void => {
        const candidate = canvasRouteConnections(families, kind).find(item => item.key === key);
        const choice = candidate && canvasPreferredRoute(candidate.routes, rememberedRoutes.current.get(key) ?? route);
        // A visual-only source change would leave the old document route active for
        // context-menu or batch generation. Change scope only with a real binding.
        if (!candidate || !choice) return;
        select(choice);
        setScope({ kind, key: candidate.key });
        remembered.current.set(kind, key);
    };
    return { ...scope, connections, connection, models, family, selected, blocked: !selected?.available,
        sourceAvailable: (kind: CanvasApiSourceKind) => canvasRouteConnections(families, kind).some(item => item.available),
        pickKind(kind: CanvasApiSourceKind) {
            const options = canvasRouteConnections(families, kind).filter(item => item.available);
            const next = options.find(item => item.key === remembered.current.get(kind))
                ?? options.find(item => item.routes.some(choice => choice.available && choice.modelId === route?.modelId))
                ?? options[0];
            pickConnection(kind, next?.key ?? '');
        },
        pickConnection: (key: string) => pickConnection(scope.kind, key),
        pickModel(id: string) { select(canvasPreferredRoute(models.find(item => item.id === id)?.routes ?? [], route)); },
        pickVariant(key: string) { select(family?.routes.find(item => item.key === key)); }
    };
}

/** Where a canvas list is drawn: the open dialog the field is in (it covers the page), else the board. Both hold the canvas palette. */
const canvasListHost = (element: Element): HTMLElement | null => element.closest<HTMLElement>('.nmx-board-modal-layer') ?? element.closest<HTMLElement>('.nmx-board');

/**
 * The relay (or own API) field. The select stays the control: its value, its name, typing a name to jump to it. Its list
 * is drawn here instead of by the system, which paints every row alike, so a relay holding the platform's security
 * deposit reads in the deposit rainbow in the field and in the list, and its hint (SurfaceTooltips reads data-help)
 * shows the seal and name, the store's public number, its introduction and the deposit line. Away from a board, where
 * there is nowhere to draw the list, the system's own list opens as before.
 */
function CanvasConnectionField({ locale, label, selection }: {
    readonly locale: string; readonly label: string; readonly selection: ReturnType<typeof useCanvasRouteSelection>;
}): React.ReactElement {
    const r = (key: Parameters<typeof canvasRouteText>[1]): string => canvasRouteText(locale, key);
    const id = React.useId();
    const select = React.useRef<HTMLSelectElement>(null), list = React.useRef<HTMLDivElement>(null);
    const [host, setHost] = React.useState<HTMLElement>();
    const [place, setPlace] = React.useState<React.CSSProperties>();
    const [active, setActive] = React.useState('');
    const options = selection.connections, chosen = selection.connection;
    const hint = (item: CanvasRouteConnection | undefined): string | undefined => item?.depositVerified
        ? depositVerifiedHintText(locale as NextMuxDesktopLocale, { ...item, name: item.label }) : undefined;
    const close = (refocus = true): void => {
        setHost(undefined); setPlace(undefined);
        if (refocus) select.current?.focus({ preventScroll: true });
    };
    const open = (): boolean => {
        const target = select.current && options.length ? canvasListHost(select.current) : null;
        if (!target) return false;
        setActive(chosen?.available ? chosen.key : options.find(item => item.available)?.key ?? '');
        setHost(target);
        return true;
    };
    const choose = (item: CanvasRouteConnection | undefined): void => {
        if (!item?.available) return;
        close();
        if (item.key !== chosen?.key) selection.pickConnection(item.key);
    };
    const move = (step: 1 | -1 | 'first' | 'last'): void => {
        const enabled = options.filter(item => item.available);
        if (!enabled.length) return;
        const at = enabled.findIndex(item => item.key === active);
        setActive(enabled[step === 'first' ? 0 : step === 'last' ? enabled.length - 1
            : at < 0 ? (step > 0 ? 0 : enabled.length - 1) : Math.max(0, Math.min(enabled.length - 1, at + step))].key);
    };
    // Under the field, above it when the host has no room below, never wider or taller than the host.
    React.useLayoutEffect(() => {
        const field = select.current?.closest<HTMLElement>('.nmx-board-field'), body = list.current;
        if (!host || !field || !body) return;
        const anchor = field.getBoundingClientRect(), box = host.getBoundingClientRect();
        const left = anchor.left - box.left - host.clientLeft + host.scrollLeft, top = anchor.top - box.top - host.clientTop + host.scrollTop;
        const below = anchor.bottom + 4 + body.offsetHeight <= box.bottom - 8 || anchor.top - 4 - body.offsetHeight < box.top + 8;
        setPlace({ left: Math.max(8, Math.min(left, host.clientWidth - body.offsetWidth - 8)), top: below ? top + anchor.height + 4 : top - body.offsetHeight - 4, minWidth: anchor.width });
        body.focus({ preventScroll: true });
    }, [host, options.length]);
    React.useEffect(() => {
        if (!host) return;
        // Anything that moves the field (a pan, a zoom, a resize) or leaves it (a press elsewhere) puts the list away.
        const away = (event: Event): void => { if (!(event.target instanceof Node) || !list.current?.contains(event.target) && !select.current?.contains(event.target)) close(false); };
        const gone = (): void => close(false);
        document.addEventListener('pointerdown', away, true); document.addEventListener('wheel', away, true);
        window.addEventListener('resize', gone); window.addEventListener('blur', gone);
        return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('wheel', away, true);
            window.removeEventListener('resize', gone); window.removeEventListener('blur', gone); };
    }, [host]);
    React.useEffect(() => { if (host && active) list.current?.querySelector<HTMLElement>('.is-active')?.scrollIntoView({ block: 'nearest' }); }, [host, active]);
    const verified = chosen?.depositVerified === true;
    const help = verified ? { 'data-help': hint(chosen), 'data-deposit-verified': 'true' } : {};
    return <label className={`nmx-board-field is-connection${verified ? ' is-deposit-verified' : ''}`} {...help}
        title={verified ? undefined : [label, chosen?.label].filter(Boolean).join(' · ')}
        onMouseDown={event => {
            // The press that would open the system's list opens (or closes) this one, anywhere in the field.
            if (event.button !== 0 || !select.current || select.current.disabled || !canvasListHost(select.current)) return;
            event.preventDefault();
            select.current.focus({ preventScroll: true });
            if (host) close(); else open();
        }}>
        <select ref={select} className={verified ? 'is-deposit-verified' : undefined} aria-label={label} aria-haspopup='listbox' aria-expanded={Boolean(host)} aria-controls={host ? id : undefined}
            {...help} value={chosen?.key ?? ''} onChange={event => selection.pickConnection(event.currentTarget.value)}
            onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || host) return;
                if ((event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'F4') && open()) event.preventDefault();
            }}>
            {!chosen && <option value=''>{selection.key ? r('unavailable') : options.length ? r('choose') : r('none')}</option>}
            {options.map(item => <option key={item.key} value={item.key} disabled={!item.available}>{item.label}{item.available ? '' : ` · ${r('unavailable')}`}</option>)}
        </select>
        {host && createPortal(<div ref={list} id={id} className='nmx-board-select-list nodrag nopan nowheel' role='listbox' tabIndex={-1} aria-label={label} data-canvas-keyboard-exclude
            aria-activedescendant={active ? `${id}-${options.findIndex(item => item.key === active)}` : undefined} style={place ?? { visibility: 'hidden', left: 0, top: 0 }}
            onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
            onBlur={event => { if (event.relatedTarget !== select.current && !event.currentTarget.contains(event.relatedTarget as Node | null)) close(false); }}
            onKeyDown={event => {
                event.stopPropagation();
                if (event.key === 'Tab') { close(); return; }
                if (event.key === 'Escape') close();
                else if (event.key === 'ArrowDown') move(1);
                else if (event.key === 'ArrowUp') move(-1);
                else if (event.key === 'Home') move('first');
                else if (event.key === 'End') move('last');
                else if (event.key === 'Enter' || event.key === ' ') choose(options.find(item => item.key === active));
                else return;
                event.preventDefault();
            }}>
            {options.map((item, index) => <div key={item.key} id={`${id}-${index}`} role='option' aria-selected={item.key === chosen?.key} aria-disabled={!item.available || undefined}
                className={item.key === active ? 'is-active' : undefined} {...(item.depositVerified ? { 'data-help': hint(item), 'data-deposit-verified': 'true' } : {})}
                onMouseEnter={() => { if (item.available) setActive(item.key); }} onClick={() => choose(item)}>
                <span className={item.depositVerified ? 'is-deposit-verified' : undefined} data-nmx-literal>{item.label}</span>
                {!item.available && <small>{r('unavailable')}</small>}
                {item.key === chosen?.key && <i className='codicon codicon-check' aria-hidden='true' />}
            </div>)}
        </div>, host)}
    </label>;
}

export function CanvasRouteSelector({ locale, selection }: { readonly locale: string; readonly selection: ReturnType<typeof useCanvasRouteSelection> }): React.ReactElement {
    const t = (key: Parameters<typeof canvasText>[1]): string => canvasText(locale, key);
    const r = (key: Parameters<typeof canvasRouteText>[1]): string => canvasRouteText(locale, key);
    const connectionLabel = r(selection.kind === 'relay' ? 'merchant' : 'connection');
    const variantLabel = (choice: CanvasModelRoute): string => {
        const same = selection.family?.routes.filter(item => item.label === choice.label) ?? [];
        return `${choice.label || choice.modelId}${same.length > 1 ? ` · ${choice.modelId}${same.filter(item => item.modelId === choice.modelId).length > 1 ? ` · ${choice.key}` : ''}` : ''}${choice.reason ? ` · ${choice.reason}` : ''}`;
    };
    return <>
        <div className='nmx-board-route-source-row'>
        <label className='nmx-board-field is-api-source' title={r('source')}>
            <select aria-label={r('source')} value={selection.kind} onChange={event => selection.pickKind(event.currentTarget.value as CanvasApiSourceKind)}>
                <option value='relay' disabled={!selection.sourceAvailable('relay')}>{r('relay')}{selection.sourceAvailable('relay') ? '' : ` · ${r('none')}`}</option>
                <option value='own' disabled={!selection.sourceAvailable('own')}>{r('own')}{selection.sourceAvailable('own') ? '' : ` · ${r('none')}`}</option>
            </select>
        </label>
        <CanvasConnectionField locale={locale} label={connectionLabel} selection={selection} />
        </div>
        <label className='nmx-board-field is-model' title={[t('model'), selection.family?.name].filter(Boolean).join(' · ')}>
            <i className='codicon codicon-sparkle' aria-hidden='true'/>
            <select aria-label={t('model')} value={selection.family?.id ?? ''} onChange={event => selection.pickModel(event.currentTarget.value)}>
                {!selection.family && <option value=''>{t('noModel')}</option>}
                {selection.models.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.name}{!item.available && item.reason ? ` · ${item.reason}` : ''}</option>)}
            </select>
        </label>
        {selection.family && selection.family.routes.length > 1 && <label className='nmx-board-field is-route-variant' title={[t('modelRoute'), selection.selected && variantLabel(selection.selected)].filter(Boolean).join(' · ')}>
            <select aria-label={t('modelRoute')} value={selection.selected?.key ?? ''} onChange={event => selection.pickVariant(event.currentTarget.value)}>
                {selection.family.routes.map(choice => <option key={choice.key} value={choice.key} disabled={!choice.available}>{variantLabel(choice)}</option>)}
            </select>
        </label>}
    </>;
}
