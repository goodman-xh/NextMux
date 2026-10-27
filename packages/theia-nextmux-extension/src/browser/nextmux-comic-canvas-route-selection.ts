import type { CanvasModelChoice, CanvasModelFamily, CanvasModelRoute } from './nextmux-comic-canvas';

export type CanvasApiSourceKind = 'relay' | 'own';
export interface CanvasRouteConnection {
    readonly key: string;
    readonly kind: CanvasApiSourceKind;
    readonly label: string;
    readonly available: boolean;
    readonly routes: readonly CanvasModelRoute[];
}

export function canvasRouteSourceKind(route: CanvasModelChoice): CanvasApiSourceKind {
    return route.routeKind ?? (route.key.startsWith('official:') ? 'own' : 'relay');
}
/** Stable identity comes from the merchant or own connection, never a display name or model alias. */
export function canvasRouteSourceKey(route: CanvasModelChoice): string {
    return route.sourceKey || (canvasRouteSourceKind(route) === 'own'
        ? `own:${route.connectionId || route.key}` : `relay:${route.source || route.key}`);
}
export function canvasRouteConnections(families: readonly CanvasModelFamily[], kind: CanvasApiSourceKind): readonly CanvasRouteConnection[] {
    const groups = new Map<string, { key: string; kind: CanvasApiSourceKind; label: string; available: boolean; routes: CanvasModelRoute[] }>();
    for (const family of families) for (const route of family.routes) {
        if (canvasRouteSourceKind(route) !== kind) continue;
        const key = canvasRouteSourceKey(route), group = groups.get(key) ?? { key, kind, label: route.sourceLabel || route.source, available: false, routes: [] };
        if (!group.routes.some(item => item.key === route.key && item.modelId === route.modelId)) group.routes.push(route);
        group.available ||= route.available;
        groups.set(key, group);
    }
    const values = [...groups.values()];
    return values.map(group => ({ ...group, label: values.some(other => other.key !== group.key && other.label === group.label)
        ? `${group.label} · ${group.key.replace(/^[^:]+:/, '')}` : group.label }));
}
export function canvasConnectionFamilies(families: readonly CanvasModelFamily[], sourceKey: string): readonly CanvasModelFamily[] {
    return families.flatMap(family => {
        const routes = family.routes.filter(route => canvasRouteSourceKey(route) === sourceKey);
        return routes.length ? [{ ...family, routes, available: routes.some(route => route.available), reason: routes.find(route => route.reason)?.reason }] : [];
    });
}
/** Explicit source/model changes may choose only among the supplied connection's real, available routes. */
export function canvasPreferredRoute(routes: readonly CanvasModelRoute[], previous?: CanvasModelChoice): CanvasModelRoute | undefined {
    return routes.find(route => route.available && route.key === previous?.key && route.modelId === previous?.modelId)
        ?? routes.find(route => route.available && route.modelId === previous?.modelId)
        ?? routes.find(route => route.available);
}
