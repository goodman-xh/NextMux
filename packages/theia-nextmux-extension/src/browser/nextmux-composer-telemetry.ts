import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * The quiet line under the message box (LobeChat #10): how fast the last reply was written and how many tokens this
 * conversation has used, from the usage each reply reported (never an estimate from its characters).
 */
export interface TelemetryTurn {
    readonly stage?: string;
    /** Written as "<input> 输入 · <output> 输出" when a run reports its usage. */
    readonly usageLabel?: string;
    readonly events?: readonly {
        readonly type: string;
        readonly outcome?: string;
        readonly durationMs?: number;
        readonly outputTokens?: number;
        readonly generationDurationMs?: number;
    }[];
}

export interface ConversationTelemetry {
    readonly totalTokens: number;
    /** Peak output tokens per second observed across the conversation's model generations; absent when too short to tell. */
    readonly tokensPerSecond?: number;
}

const USAGE = /^(\d+) 输入 · (\d+) 输出$/;

export function conversationTelemetry(turns: readonly TelemetryTurn[]): ConversationTelemetry | undefined {
    let totalTokens = 0, counted = 0, peakTokensPerSecond: number | undefined;
    const considerSpeed = (candidate: number): void => {
        if (!Number.isFinite(candidate) || candidate <= 0) return;
        if (peakTokensPerSecond === undefined || candidate > peakTokensPerSecond) {
            peakTokensPerSecond = candidate;
        }
    };
    for (let index = turns.length - 1; index >= 0; index -= 1) {
        const turn = turns[index];
        const usage = USAGE.exec(turn.usageLabel || '');
        let generatingMs = 0;
        let attemptOutputTokens = 0;
        for (const event of turn.events || []) {
            if (event.type !== 'model_attempt_completed' || event.outcome !== 'succeeded') continue;
            const durationMs = Number(event.durationMs);
            if (Number.isFinite(durationMs) && durationMs > 0) {
                generatingMs += durationMs;
            }
            const eventOutput = Number(event.outputTokens);
            if (Number.isFinite(eventOutput) && eventOutput > 0) {
                attemptOutputTokens += eventOutput;
                if (eventOutput >= 16) {
                    if (Number.isFinite(durationMs) && durationMs >= 400) {
                        considerSpeed(eventOutput / (durationMs / 1000));
                    }
                    const genDurationMs = Number(event.generationDurationMs);
                    if (Number.isFinite(genDurationMs) && genDurationMs >= 400) {
                        considerSpeed(eventOutput / (genDurationMs / 1000));
                    }
                }
            }
        }
        if (usage) {
            const input = Number(usage[1]), output = Number(usage[2]);
            totalTokens += input + output;
            counted += 1;
            if (attemptOutputTokens === 0 && output >= 16 && generatingMs >= 400) {
                considerSpeed(output / (generatingMs / 1000));
            }
        } else if (attemptOutputTokens > 0) {
            totalTokens += attemptOutputTokens;
            counted += 1;
        }
    }
    return counted ? { totalTokens, ...(peakTokensPerSecond !== undefined ? { tokensPerSecond: peakTokensPerSecond } : {}) } : undefined;
}

type Key = 'speed' | 'total' | 'title';

const en: Readonly<Record<Key, string>> = {
    speed: '{value} tok/s', total: 'This conversation: {value} tokens',
    title: 'From the usage the model service reported: the peak generation speed in this conversation, and the tokens of every reply in this conversation.'
};

const copy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    en,
    'zh-CN': { speed: '{value} tok/s', total: '本对话 {value} Token', title: '来自模型服务上报的用量：本对话生成时的最高速度，以及本对话所有回复的 Token 总数。' },
    'zh-TW': { speed: '{value} tok/s', total: '本對話 {value} Token', title: '來自模型服務回報的用量：本對話生成時的最高速度，以及本對話所有回覆的 Token 總數。' },
    ja: { speed: '{value} tok/s', total: 'この会話 {value} トークン', title: 'モデルサービスが報告した使用量より：この会話での最大生成速度と、この会話のすべての返信のトークン合計。' },
    ko: { speed: '{value} tok/s', total: '이 대화 {value} 토큰', title: '모델 서비스가 보고한 사용량 기준: 이 대화의 최고 생성 속도와 이 대화 모든 답변의 토큰 합계입니다.' },
    es: { speed: '{value} tok/s', total: 'Esta conversación: {value} tokens', title: 'Según el uso informado por el servicio del modelo: la velocidad máxima de generación en esta conversación y los tokens de todas las respuestas de esta conversación.' },
    fr: { speed: '{value} tok/s', total: 'Cette conversation : {value} jetons', title: 'D’après l’usage déclaré par le service du modèle : la vitesse maximale de génération dans cette conversation et les jetons de toutes les réponses de cette conversation.' },
    de: { speed: '{value} tok/s', total: 'Diese Unterhaltung: {value} Token', title: 'Laut der vom Modelldienst gemeldeten Nutzung: die höchste Generierungsgeschwindigkeit in dieser Unterhaltung und die Token aller Antworten dieser Unterhaltung.' },
    'pt-BR': { speed: '{value} tok/s', total: 'Esta conversa: {value} tokens', title: 'Pelo uso informado pelo serviço do modelo: a velocidade máxima de geração nesta conversa e os tokens de todas as respostas desta conversa.' },
    ru: { speed: '{value} ток/с', total: 'Этот разговор: {value} токенов', title: 'По данным сервиса модели: максимальная скорость генерации в этом разговоре и токены всех ответов этого разговора.' },
    ar: { speed: '{value} رمز/ث', total: 'هذه المحادثة: {value} رمز', title: 'وفق الاستخدام الذي أبلغت عنه خدمة النموذج: أقصى سرعة للتوليد في هذه المحادثة، ورموز كل الردود في هذه المحادثة.' },
    hi: { speed: '{value} टोकन/से', total: 'यह बातचीत: {value} टोकन', title: 'मॉडल सेवा द्वारा बताए उपयोग से: इस बातचीत में जनरेशन की अधिकतम गति, और इस बातचीत के सभी जवाबों के टोकन।' }
};

export function composerTelemetryText(locale: NextMuxDesktopLocale, key: Key, value?: number): string {
    const template = (copy[locale] || en)[key] || en[key];
    if (value === undefined) return template;
    const formatted = new Intl.NumberFormat(locale, key === 'speed' ? { maximumFractionDigits: value < 100 ? 1 : 0 } : { maximumFractionDigits: 0 }).format(value);
    return template.replace('{value}', formatted);
}

export const composerTelemetryLocales = Object.keys(copy) as readonly NextMuxDesktopLocale[];

/** The empty message box's placeholder while it offers the follow-up the last reply suggested (LobeChat #16). */
const followUpCopy: Readonly<Record<NextMuxDesktopLocale, string>> = {
    en: '{text}   ⇥ Tab to use', 'zh-CN': '{text}   ⇥ 按 Tab 使用', 'zh-TW': '{text}   ⇥ 按 Tab 使用', ja: '{text}   ⇥ Tab で入力', ko: '{text}   ⇥ Tab으로 입력',
    es: '{text}   ⇥ Tab para usarlo', fr: '{text}   ⇥ Tab pour l’utiliser', de: '{text}   ⇥ Tab zum Übernehmen', 'pt-BR': '{text}   ⇥ Tab para usar',
    ru: '{text}   ⇥ Tab — вставить', ar: '{text}   ⇥ Tab للاستخدام', hi: '{text}   ⇥ उपयोग के लिए Tab'
};

export function followUpPlaceholder(locale: NextMuxDesktopLocale, text: string): string {
    return (followUpCopy[locale] || followUpCopy.en).replace('{text}', text);
}
