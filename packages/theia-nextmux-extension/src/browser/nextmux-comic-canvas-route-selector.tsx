import * as React from '@theia/core/shared/react';
import type { CanvasModelChoice, CanvasModelFamily, CanvasModelRoute } from './nextmux-comic-canvas';
import { canvasText } from './nextmux-comic-canvas-text';
import { canvasRouteText } from './nextmux-comic-canvas-route-text';
import { canvasConnectionFamilies, canvasPreferredRoute, canvasRouteConnections, canvasRouteSourceKey, canvasRouteSourceKind, type CanvasApiSourceKind } from './nextmux-comic-canvas-route-selection';

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
        <label className='nmx-board-field is-connection' title={[connectionLabel, selection.connection?.label].filter(Boolean).join(' · ')}>
            <select aria-label={connectionLabel} value={selection.connection?.key ?? ''} onChange={event => selection.pickConnection(event.currentTarget.value)}>
                {!selection.connection && <option value=''>{selection.key ? r('unavailable') : selection.connections.length ? r('choose') : r('none')}</option>}
                {selection.connections.map(item => <option key={item.key} value={item.key} disabled={!item.available}>{item.label}{item.available ? '' : ` · ${r('unavailable')}`}</option>)}
            </select>
        </label>
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
