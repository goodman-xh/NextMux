import * as React from 'react';
import { normalizeModelCitations } from '@nextmux/agent-runtime/citations';
import type { ModelCitation } from '@nextmux/agent-runtime';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { normalizeArchivedChildResults } from '../common/nextmux-citation-display';
import { shouldDisplayRawUrl } from './nextmux-markdown';
import { totalCopy } from './nextmux-copy-fallback';

const labels: Record<NextMuxDesktopLocale, readonly [string, string]> = {
    'zh-CN': ['来源', '打开来源'], 'zh-TW': ['來源', '開啟來源'], en: ['Sources', 'Open source'],
    ja: ['出典', '出典を開く'], ko: ['출처', '출처 열기'], es: ['Fuentes', 'Abrir fuente'],
    fr: ['Sources', 'Ouvrir la source'], de: ['Quellen', 'Quelle öffnen'], 'pt-BR': ['Fontes', 'Abrir fonte'],
    ru: ['Источники', 'Открыть источник'], ar: ['المصادر', 'فتح المصدر'], hi: ['स्रोत', 'स्रोत खोलें']
};
export const citationText = (locale: NextMuxDesktopLocale, key: 'sources' | 'open'): string => totalCopy(locale, key, language => labels[language][key === 'sources' ? 0 : 1]);

const childLabels: Record<NextMuxDesktopLocale, readonly [string, string]> = {
    'zh-CN': ['归档子任务来源', '仅显示摘要'], 'zh-TW': ['封存子任務來源', '僅顯示摘要'], en: ['Archived subtask sources', 'Excerpt only'],
    ja: ['保存済みサブタスクの出典', '抜粋のみ'], ko: ['보관된 하위 작업 출처', '발췌만 표시'], es: ['Fuentes de subtareas archivadas', 'Solo un extracto'],
    fr: ['Sources des sous-tâches archivées', 'Extrait uniquement'], de: ['Quellen archivierter Unteraufgaben', 'Nur Auszug'], 'pt-BR': ['Fontes de subtarefas arquivadas', 'Somente trecho'],
    ru: ['Источники архивных подзадач', 'Только фрагмент'], ar: ['مصادر المهام الفرعية المؤرشفة', 'مقتطف فقط'], hi: ['संग्रहीत उपकार्य के स्रोत', 'केवल अंश']
};

export function ArchivedChildCitations({ locale, results, onOpen }: { readonly locale: NextMuxDesktopLocale; readonly results: unknown; readonly onOpen?: (url: string) => void }): React.ReactElement | null {
    const children = normalizeArchivedChildResults(results);
    if (!children.length) return null;
    return <details className='nmx-archived-child-citations' data-nmx-literal dir={locale === 'ar' ? 'rtl' : undefined}>
        <summary>{childLabels[locale][0]} · {children.length}</summary>
        <div>{children.map(child => <details key={child.childId}>
            <summary><bdi dir='auto'>{child.task.slice(0, 160)}{child.task.length > 160 ? '…' : ''}</bdi></summary>
            <pre>{child.finalText}</pre>{child.truncated && <small>{childLabels[locale][1]}</small>}
            <CitationList locale={locale} citations={child.citations} onOpen={onOpen} />
        </details>)}</div>
    </details>;
}

/** A present live result replaces, never inherits, the prior answer's sources. */
export function answerCitations(turn: { readonly branchUserOnly?: boolean; readonly citations?: unknown }, liveResult?: { readonly citations?: unknown }): readonly ModelCitation[] {
    return turn.branchUserOnly ? [] : normalizeModelCitations(liveResult === undefined ? turn.citations : liveResult.citations);
}

export interface CitationListProps {
    readonly locale: NextMuxDesktopLocale;
    readonly citations: unknown;
    readonly onOpen?: (url: string) => void;
}

/** Explicit URL/title display only: no metadata fetch, raw HTML, provider state or automatic navigation. */
export function CitationList({ locale, citations, onOpen }: CitationListProps): React.ReactElement | null {
    const sources = normalizeModelCitations(citations);
    if (!sources.length) return null;
    return <section className='nmx-answer-citations' data-nmx-literal dir={locale === 'ar' ? 'rtl' : undefined} aria-label={citationText(locale, 'sources')}>
        <header><i className='codicon codicon-link' aria-hidden='true'></i><span>{citationText(locale, 'sources')}</span><small>{sources.length}</small></header>
        <ol>{sources.map(source => {
            const raw = shouldDisplayRawUrl(source.url);
            const title = raw ? undefined : source.title;
            return <li key={source.url}>
                <a href={source.url} target='_blank' rel='noopener noreferrer' referrerPolicy='no-referrer' title={source.url}
                    aria-label={`${citationText(locale, 'open')}: ${title || source.url}`}
                    onClick={onOpen ? event => { event.preventDefault(); onOpen(source.url); } : undefined}>
                    {title && <bdi className='nmx-citation-title' dir='auto'>{title}</bdi>}
                    <bdi className='nmx-citation-url' dir='ltr'>{source.url}</bdi>
                </a>
            </li>;
        })}</ol>
    </section>;
}
