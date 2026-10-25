import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';

/** How long one AI reply took: counts up every second while it runs, then stays at the final time. */

const text = {
    en: { took: 'This reply took {time}', running: 'Running for {time}' },
    'zh-CN': { took: '本轮用时 {time}', running: '已运行 {time}' },
    'zh-TW': { took: '本輪用時 {time}', running: '已執行 {time}' },
    ja: { took: 'この応答の所要時間 {time}', running: '実行時間 {time}' },
    ko: { took: '이번 응답 소요 시간 {time}', running: '실행 시간 {time}' },
    es: { took: 'Esta respuesta tardó {time}', running: 'En ejecución desde hace {time}' },
    fr: { took: 'Cette réponse a pris {time}', running: 'En cours depuis {time}' },
    de: { took: 'Diese Antwort dauerte {time}', running: 'Läuft seit {time}' },
    'pt-BR': { took: 'Esta resposta levou {time}', running: 'Em execução há {time}' },
    ru: { took: 'Этот ответ занял {time}', running: 'Выполняется {time}' },
    ar: { took: 'استغرق هذا الرد {time}', running: 'قيد التشغيل منذ {time}' },
    hi: { took: 'इस जवाब में {time} लगा', running: '{time} से चल रहा है' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

/** 0:07, 1:23, 1:02:03 — fixed-width digits so the counter does not jitter. */
export function formatTurnDuration(milliseconds: number): string {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const seconds = total % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** A spoken-style duration for tooltips and screen readers, e.g. “1 分 23 秒” / “1 min, 23 sec”. */
export function describeTurnDuration(locale: NextMuxDesktopLocale, milliseconds: number): string {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const parts = { hours: Math.floor(total / 3600), minutes: Math.floor(total % 3600 / 60), seconds: total % 60 };
    const DurationFormat = (Intl as unknown as { DurationFormat?: new (locale: string, options: object) => { format(value: object): string } }).DurationFormat;
    if (DurationFormat) {
        try { return new DurationFormat(locale, { style: 'short' }).format(parts); } catch { /* fall through */ }
    }
    return formatTurnDuration(milliseconds);
}

export function turnDurationLabel(locale: NextMuxDesktopLocale, kind: 'took' | 'running', milliseconds: number): string {
    return (text[locale] || text.en)[kind].replace('{time}', describeTurnDuration(locale, milliseconds));
}

/**
 * The reply timer's icon: a four-point spark. While the model is thinking it turns and breathes and two small
 * sparks twinkle beside it (the "thinking" spark of Claude and Gemini); when the reply is done it stands still.
 */
export function ThinkingSpark(props: { readonly running: boolean; readonly size?: number }): React.ReactElement {
    const size = props.size ?? 14;
    return <svg className={`nmx-thinking-spark${props.running ? ' is-running' : ''}`} viewBox='0 0 24 24' width={size} height={size} aria-hidden='true'>
        <path className='nmx-thinking-spark-core' d='M12 2.5 C12.9 8.4 15.6 11.1 21.5 12 C15.6 12.9 12.9 15.6 12 21.5 C11.1 15.6 8.4 12.9 2.5 12 C8.4 11.1 11.1 8.4 12 2.5 Z'></path>
        <circle className='nmx-thinking-spark-twinkle' cx='19.2' cy='4.8' r='1.6'></circle>
        <circle className='nmx-thinking-spark-twinkle is-second' cx='4.6' cy='19.4' r='1.3'></circle>
    </svg>;
}

export function TurnDuration(props: { readonly locale: NextMuxDesktopLocale; readonly startedAt: number; readonly endedAt?: number }): React.ReactElement | null {
    const running = props.endedAt === undefined;
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        if (!running) return undefined;
        setNow(Date.now());
        // Align ticks to the start time so the seconds change exactly on the boundary.
        let timer: number | undefined;
        const tick = () => {
            setNow(Date.now());
            timer = window.setTimeout(tick, 1000 - ((Date.now() - props.startedAt) % 1000) + 5);
        };
        timer = window.setTimeout(tick, 1000 - ((Date.now() - props.startedAt) % 1000) + 5);
        return () => { if (timer !== undefined) window.clearTimeout(timer); };
    }, [running, props.startedAt]);
    if (!Number.isFinite(props.startedAt) || props.startedAt <= 0) return null;
    const elapsed = (running ? now : props.endedAt!) - props.startedAt;
    if (!running && (!Number.isFinite(elapsed) || elapsed < 0)) return null;
    const label = turnDurationLabel(props.locale, running ? 'running' : 'took', elapsed);
    return <span className={`nmx-turn-duration${running ? ' is-running' : ''}`} title={label} aria-label={label} role={running ? 'timer' : undefined}>
        <ThinkingSpark running={running} /><span data-nmx-literal>{formatTurnDuration(elapsed)}</span>
    </span>;
}
