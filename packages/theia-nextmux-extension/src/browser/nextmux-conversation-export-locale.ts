import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { ConversationExportLabels } from '../common/nextmux-cherry-lobechat-helpers';

/** The message menu's keep / leave-out / export entries (Cherry Studio #8/#9) and the exported document's own words. */
export type ConversationExportTextKey = 'pin' | 'unpin' | 'exclude' | 'include' | 'exportMarkdown' | 'exportHtml' | 'exportTitle' | 'exported' | 'exportFailed';

interface ConversationExportCopy extends Readonly<Record<ConversationExportTextKey, string>> {
    readonly document: ConversationExportLabels;
}

const en: ConversationExportCopy = {
    pin: 'Always keep in context', unpin: 'Stop always keeping', exclude: 'Leave out of context', include: 'Include in context again',
    exportMarkdown: 'Export conversation (.md)', exportHtml: 'Export conversation (.html)', exportTitle: 'Export conversation',
    exported: 'Conversation exported', exportFailed: 'The conversation could not be exported',
    document: { untitled: 'Conversation', turn: 'Turn {n}', user: 'You', assistant: 'Assistant', pinned: 'Always kept in context', excluded: 'Left out of context', lang: 'en' }
};

const translations: Readonly<Record<NextMuxDesktopLocale, ConversationExportCopy>> = {
    en,
    'zh-CN': { pin: '重点保留（始终带入上下文）', unpin: '取消重点保留', exclude: '本轮不带入上下文', include: '恢复带入上下文',
        exportMarkdown: '导出对话（.md）', exportHtml: '导出对话（.html）', exportTitle: '导出对话', exported: '对话已导出', exportFailed: '无法导出对话',
        document: { untitled: '对话记录', turn: '第 {n} 轮', user: '用户', assistant: '助手', pinned: '重点保留', excluded: '已从上下文排除', lang: 'zh-CN' } },
    'zh-TW': { pin: '重點保留（一律帶入上下文）', unpin: '取消重點保留', exclude: '本輪不帶入上下文', include: '恢復帶入上下文',
        exportMarkdown: '匯出對話（.md）', exportHtml: '匯出對話（.html）', exportTitle: '匯出對話', exported: '對話已匯出', exportFailed: '無法匯出對話',
        document: { untitled: '對話記錄', turn: '第 {n} 輪', user: '使用者', assistant: '助理', pinned: '重點保留', excluded: '已從上下文排除', lang: 'zh-TW' } },
    ja: { pin: '常にコンテキストに残す', unpin: '常に残すのをやめる', exclude: 'コンテキストから外す', include: 'コンテキストに戻す',
        exportMarkdown: '会話をエクスポート（.md）', exportHtml: '会話をエクスポート（.html）', exportTitle: '会話をエクスポート', exported: '会話をエクスポートしました', exportFailed: '会話をエクスポートできませんでした',
        document: { untitled: '会話', turn: '{n} 往復目', user: 'あなた', assistant: 'アシスタント', pinned: '常にコンテキストに残す', excluded: 'コンテキストから除外', lang: 'ja' } },
    ko: { pin: '항상 컨텍스트에 유지', unpin: '항상 유지 해제', exclude: '컨텍스트에서 제외', include: '컨텍스트에 다시 포함',
        exportMarkdown: '대화 내보내기(.md)', exportHtml: '대화 내보내기(.html)', exportTitle: '대화 내보내기', exported: '대화를 내보냈습니다', exportFailed: '대화를 내보내지 못했습니다',
        document: { untitled: '대화', turn: '{n}번째 턴', user: '사용자', assistant: '어시스턴트', pinned: '항상 컨텍스트에 유지', excluded: '컨텍스트에서 제외됨', lang: 'ko' } },
    es: { pin: 'Mantener siempre en el contexto', unpin: 'Dejar de mantener siempre', exclude: 'Dejar fuera del contexto', include: 'Volver a incluir en el contexto',
        exportMarkdown: 'Exportar conversación (.md)', exportHtml: 'Exportar conversación (.html)', exportTitle: 'Exportar conversación', exported: 'Conversación exportada', exportFailed: 'No se pudo exportar la conversación',
        document: { untitled: 'Conversación', turn: 'Turno {n}', user: 'Tú', assistant: 'Asistente', pinned: 'Siempre en el contexto', excluded: 'Fuera del contexto', lang: 'es' } },
    fr: { pin: 'Toujours garder dans le contexte', unpin: 'Ne plus toujours garder', exclude: 'Exclure du contexte', include: 'Réintégrer au contexte',
        exportMarkdown: 'Exporter la conversation (.md)', exportHtml: 'Exporter la conversation (.html)', exportTitle: 'Exporter la conversation', exported: 'Conversation exportée', exportFailed: 'La conversation n’a pas pu être exportée',
        document: { untitled: 'Conversation', turn: 'Tour {n}', user: 'Vous', assistant: 'Assistant', pinned: 'Toujours dans le contexte', excluded: 'Exclu du contexte', lang: 'fr' } },
    de: { pin: 'Immer im Kontext behalten', unpin: 'Nicht mehr immer behalten', exclude: 'Aus dem Kontext lassen', include: 'Wieder in den Kontext aufnehmen',
        exportMarkdown: 'Unterhaltung exportieren (.md)', exportHtml: 'Unterhaltung exportieren (.html)', exportTitle: 'Unterhaltung exportieren', exported: 'Unterhaltung exportiert', exportFailed: 'Die Unterhaltung konnte nicht exportiert werden',
        document: { untitled: 'Unterhaltung', turn: 'Runde {n}', user: 'Du', assistant: 'Assistent', pinned: 'Immer im Kontext', excluded: 'Nicht im Kontext', lang: 'de' } },
    'pt-BR': { pin: 'Manter sempre no contexto', unpin: 'Deixar de manter sempre', exclude: 'Deixar fora do contexto', include: 'Incluir de novo no contexto',
        exportMarkdown: 'Exportar conversa (.md)', exportHtml: 'Exportar conversa (.html)', exportTitle: 'Exportar conversa', exported: 'Conversa exportada', exportFailed: 'Não foi possível exportar a conversa',
        document: { untitled: 'Conversa', turn: 'Turno {n}', user: 'Você', assistant: 'Assistente', pinned: 'Sempre no contexto', excluded: 'Fora do contexto', lang: 'pt-BR' } },
    ru: { pin: 'Всегда держать в контексте', unpin: 'Больше не держать всегда', exclude: 'Не включать в контекст', include: 'Снова включать в контекст',
        exportMarkdown: 'Экспорт разговора (.md)', exportHtml: 'Экспорт разговора (.html)', exportTitle: 'Экспорт разговора', exported: 'Разговор экспортирован', exportFailed: 'Не удалось экспортировать разговор',
        document: { untitled: 'Разговор', turn: 'Ход {n}', user: 'Вы', assistant: 'Ассистент', pinned: 'Всегда в контексте', excluded: 'Не в контексте', lang: 'ru' } },
    ar: { pin: 'إبقاء دائم في السياق', unpin: 'إيقاف الإبقاء الدائم', exclude: 'استبعاد من السياق', include: 'إعادة إلى السياق',
        exportMarkdown: 'تصدير المحادثة (.md)', exportHtml: 'تصدير المحادثة (.html)', exportTitle: 'تصدير المحادثة', exported: 'تم تصدير المحادثة', exportFailed: 'تعذّر تصدير المحادثة',
        document: { untitled: 'محادثة', turn: 'الدور {n}', user: 'أنت', assistant: 'المساعد', pinned: 'دائم في السياق', excluded: 'مستبعد من السياق', lang: 'ar' } },
    hi: { pin: 'हमेशा संदर्भ में रखें', unpin: 'हमेशा रखना बंद करें', exclude: 'संदर्भ से बाहर रखें', include: 'फिर से संदर्भ में शामिल करें',
        exportMarkdown: 'बातचीत निर्यात करें (.md)', exportHtml: 'बातचीत निर्यात करें (.html)', exportTitle: 'बातचीत निर्यात करें', exported: 'बातचीत निर्यात हुई', exportFailed: 'बातचीत निर्यात नहीं हो सकी',
        document: { untitled: 'बातचीत', turn: 'चरण {n}', user: 'आप', assistant: 'सहायक', pinned: 'हमेशा संदर्भ में', excluded: 'संदर्भ से बाहर', lang: 'hi' } }
};

export function conversationExportText(locale: NextMuxDesktopLocale, key: ConversationExportTextKey): string {
    return (translations[locale] || en)[key] || en[key];
}

export function conversationExportLabels(locale: NextMuxDesktopLocale): ConversationExportLabels {
    return (translations[locale] || en).document;
}

export const conversationExportLocales = Object.keys(translations) as readonly NextMuxDesktopLocale[];
