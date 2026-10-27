import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * The context ring beside the model picker (LobeChat #9): its label, the breakdown and the compaction footnote.
 * Compaction is a one-shot action (like /compact), so the footnote is either the idle hint (click to compact) or
 * the 550 ms in-progress status. There is no pending, queued or cancel wording.
 */
export type ContextRingTextKey = 'label' | 'title' | 'instructions' | 'history' | 'draft' | 'remaining'
    | 'compactHint' | 'compacting' | 'compacted';

const en: Readonly<Record<ContextRingTextKey, string>> = {
    label: 'Context {percent}%',
    title: 'Context used: {percent}% · {used} / {window} tokens',
    instructions: 'Instructions', history: 'Conversation ({turns} turns)', draft: 'Your message', remaining: 'Free',
    compactHint: 'Click to compact context',
    compacting: 'Compacting context…', compacted: 'Context compacted'
};

const translations: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<ContextRingTextKey, string>>>> = {
    en,
    'zh-CN': { label: '上下文 {percent}%', title: '上下文已使用 {percent}% · {used} / {window} tokens', instructions: '系统指令', history: '对话记录（{turns} 轮）', draft: '当前输入', remaining: '剩余',
        compactHint: '点击压缩上下文', compacting: '正在压缩上下文…', compacted: '已压缩上下文' },
    'zh-TW': { label: '上下文 {percent}%', title: '上下文已使用 {percent}% · {used} / {window} tokens', instructions: '系統指令', history: '對話記錄（{turns} 輪）', draft: '目前輸入', remaining: '剩餘',
        compactHint: '點擊壓縮上下文', compacting: '正在壓縮上下文…', compacted: '已壓縮上下文' },
    ja: { label: 'コンテキスト {percent}%', title: 'コンテキスト使用量 {percent}% · {used} / {window} トークン', instructions: 'システム指示', history: '会話（{turns} 往復）', draft: '入力中', remaining: '残り',
        compactHint: 'クリックでコンテキストを圧縮', compacting: 'コンテキストを圧縮中…', compacted: 'コンテキストを圧縮しました' },
    ko: { label: '컨텍스트 {percent}%', title: '컨텍스트 사용량 {percent}% · {used} / {window} 토큰', instructions: '시스템 지시', history: '대화 ({turns}턴)', draft: '입력 중', remaining: '남음',
        compactHint: '클릭하여 컨텍스트 압축', compacting: '컨텍스트 압축 중…', compacted: '컨텍스트를 압축했습니다' },
    es: { label: 'Contexto {percent}%', title: 'Contexto en uso: {percent}% · {used} / {window} tokens', instructions: 'Instrucciones', history: 'Conversación ({turns} turnos)', draft: 'Tu mensaje', remaining: 'Libre',
        compactHint: 'Haz clic para compactar el contexto', compacting: 'Compactando el contexto…', compacted: 'Contexto compactado' },
    fr: { label: 'Contexte {percent} %', title: 'Contexte utilisé : {percent} % · {used} / {window} jetons', instructions: 'Instructions', history: 'Conversation ({turns} tours)', draft: 'Votre message', remaining: 'Libre',
        compactHint: 'Cliquez pour compacter le contexte', compacting: 'Compactage du contexte…', compacted: 'Contexte compacté' },
    de: { label: 'Kontext {percent} %', title: 'Kontext belegt: {percent} % · {used} / {window} Tokens', instructions: 'Anweisungen', history: 'Unterhaltung ({turns} Runden)', draft: 'Deine Nachricht', remaining: 'Frei',
        compactHint: 'Klicken, um den Kontext zu komprimieren', compacting: 'Kontext wird komprimiert…', compacted: 'Kontext komprimiert' },
    'pt-BR': { label: 'Contexto {percent}%', title: 'Contexto em uso: {percent}% · {used} / {window} tokens', instructions: 'Instruções', history: 'Conversa ({turns} turnos)', draft: 'Sua mensagem', remaining: 'Livre',
        compactHint: 'Clique para compactar o contexto', compacting: 'Compactando o contexto…', compacted: 'Contexto compactado' },
    ru: { label: 'Контекст {percent}%', title: 'Занято контекста: {percent}% · {used} / {window} токенов', instructions: 'Инструкции', history: 'Разговор ({turns} ходов)', draft: 'Ваше сообщение', remaining: 'Свободно',
        compactHint: 'Нажмите, чтобы сжать контекст', compacting: 'Сжатие контекста…', compacted: 'Контекст сжат' },
    ar: { label: 'السياق {percent}%', title: 'السياق المستخدم: {percent}% · {used} / {window} رمز', instructions: 'التعليمات', history: 'المحادثة ({turns} أدوار)', draft: 'رسالتك', remaining: 'متاح',
        compactHint: 'انقر لضغط السياق', compacting: 'جارٍ ضغط السياق…', compacted: 'تم ضغط السياق' },
    hi: { label: 'संदर्भ {percent}%', title: 'संदर्भ उपयोग: {percent}% · {used} / {window} टोकन', instructions: 'निर्देश', history: 'बातचीत ({turns} चरण)', draft: 'आपका संदेश', remaining: 'ख़ाली',
        compactHint: 'संदर्भ संक्षिप्त करने के लिए क्लिक करें', compacting: 'संदर्भ संक्षिप्त हो रहा है…', compacted: 'संदर्भ संक्षिप्त हुआ' }
};

export function contextRingText(locale: NextMuxDesktopLocale, key: ContextRingTextKey, values: Readonly<Record<string, string | number>> = {}): string {
    // Only a missing key falls back to English.
    const template = (translations[locale] || en)[key] ?? en[key];
    return template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}

export const contextRingLocales = Object.keys(translations) as readonly NextMuxDesktopLocale[];
