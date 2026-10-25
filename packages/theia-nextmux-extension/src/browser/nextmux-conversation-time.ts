import type { NextMuxDesktopLocale } from './nextmux-locale';

type ConversationTimeKind = 'started' | 'latest';

const labels: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<ConversationTimeKind, string>>>> = {
    en: { started: 'Conversation started', latest: 'Latest message' },
    'zh-CN': { started: '对话开始于', latest: '最近一条于' },
    'zh-TW': { started: '對話開始於', latest: '最近一則於' },
    ja: { started: '会話開始', latest: '最新メッセージ' },
    ko: { started: '대화 시작', latest: '최근 메시지' },
    es: { started: 'Conversación iniciada', latest: 'Último mensaje' },
    fr: { started: 'Conversation commencée', latest: 'Dernier message' },
    de: { started: 'Unterhaltung begonnen', latest: 'Letzte Nachricht' },
    'pt-BR': { started: 'Conversa iniciada', latest: 'Mensagem mais recente' },
    ru: { started: 'Диалог начат', latest: 'Последнее сообщение' },
    ar: { started: 'بدأت المحادثة', latest: 'أحدث رسالة' },
    hi: { started: 'बातचीत शुरू हुई', latest: 'नवीनतम संदेश' }
};

export function formatConversationTime(locale: NextMuxDesktopLocale, value: number, now = Date.now()): string {
    const elapsed = Math.max(0, now - value);
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (elapsed < 60_000) {
        if (locale === 'zh-CN') return '刚刚';
        if (locale === 'zh-TW') return '剛剛';
        return relative.format(0, 'second');
    }
    if (elapsed < 3_600_000) return relative.format(-Math.floor(elapsed / 60_000), 'minute');
    if (elapsed < 24 * 3_600_000) return relative.format(-Math.floor(elapsed / 3_600_000), 'hour');
    if (elapsed < 48 * 3_600_000) return relative.format(-1, 'day');
    const date = new Date(value);
    return new Intl.DateTimeFormat(locale, {
        ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' as const } : {}),
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
}

export function conversationTimeLabel(
    locale: NextMuxDesktopLocale,
    kind: ConversationTimeKind,
    value: number,
    now = Date.now()
): string {
    return `${labels[locale][kind]}: ${formatConversationTime(locale, value, now)}`;
}
