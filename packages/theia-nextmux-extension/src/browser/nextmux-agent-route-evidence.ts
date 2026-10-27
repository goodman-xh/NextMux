import type { NextMuxDesktopLocale } from './nextmux-locale';

const switchedText: Readonly<Record<NextMuxDesktopLocale, string>> = {
    en: 'Route switched {count}',
    'zh-CN': '已无缝切换线路 {count} 次',
    'zh-TW': '已無縫切換線路 {count} 次',
    ja: 'ルートを {count} 回切り替えました',
    ko: '경로 전환 {count}회',
    es: 'Ruta cambiada {count} veces',
    fr: 'Route changée {count} fois',
    de: 'Route {count}-mal gewechselt',
    'pt-BR': 'Rota alterada {count} vezes',
    ru: 'Маршрут переключён {count} раз',
    ar: 'تم تبديل المسار {count} مرة',
    hi: 'रूट {count} बार बदला गया'
};

export interface AgentRouteEvidencePresentation {
    readonly title: string;
    readonly route: string;
    readonly count: number;
}

/** A compact, durable receipt shown only when a completed turn really switched. */
export function agentRouteEvidencePresentation(
    locale: NextMuxDesktopLocale,
    routeLabel: string,
    failoverCount: number | undefined
): AgentRouteEvidencePresentation | undefined {
    const count = Number.isSafeInteger(failoverCount) ? Math.max(0, Math.min(99, Number(failoverCount))) : 0;
    if (count < 1) return undefined;
    const route = routeLabel.replace(/^\s*[⇄↻]+\s*/u, '').replace(/\s+/g, ' ').trim().slice(0, 180);
    return {
        title: switchedText[locale].replace('{count}', String(count)),
        route,
        count
    };
}

