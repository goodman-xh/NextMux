/**
 * Reading a reply aloud with the downloaded voice (Settings → Downloads): the words to speak, the pieces they are
 * synthesized in, and the button's and notices' words (Cherry Studio #11 / LobeChat #13).
 */
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { DesktopComponentsState } from '../common/nextmux-components';

export type ReadAloudTextKey = 'readAloud' | 'preparing' | 'stop' | 'title' | 'voiceNotReady' | 'voiceUnsupported' | 'failed';

const en: Readonly<Record<ReadAloudTextKey, string>> = {
    readAloud: 'Read aloud', preparing: 'Preparing voice…', stop: 'Stop reading', title: 'Read aloud',
    voiceNotReady: 'The voice is not downloaded yet. Open Settings → Downloads to see its progress.',
    voiceUnsupported: 'Reading aloud is not available in this language yet.', failed: 'This reply could not be read aloud. Try again.'
};

const translations: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<ReadAloudTextKey, string>>>> = {
    en,
    'zh-CN': { readAloud: '朗读', preparing: '正在准备语音…', stop: '停止朗读', title: '朗读',
        voiceNotReady: '语音组件尚未下载完成，请前往 设置 → 下载 查看语音组件下载进度。', voiceUnsupported: '当前语言暂不支持朗读。', failed: '这条回复无法朗读，请稍后再试。' },
    'zh-TW': { readAloud: '朗讀', preparing: '正在準備語音…', stop: '停止朗讀', title: '朗讀',
        voiceNotReady: '語音元件尚未下載完成，請前往 設定 → 下載 查看語音元件下載進度。', voiceUnsupported: '目前語言暫不支援朗讀。', failed: '這則回覆無法朗讀，請稍後再試。' },
    ja: { readAloud: '読み上げ', preparing: '音声を準備中…', stop: '読み上げを停止', title: '読み上げ',
        voiceNotReady: '音声コンポーネントのダウンロードが完了していません。設定 → ダウンロード で進行状況を確認してください。', voiceUnsupported: 'この言語ではまだ読み上げできません。', failed: 'この返信を読み上げられませんでした。もう一度お試しください。' },
    ko: { readAloud: '소리 내어 읽기', preparing: '음성을 준비하는 중…', stop: '읽기 중지', title: '소리 내어 읽기',
        voiceNotReady: '음성 구성 요소가 아직 다운로드되지 않았습니다. 설정 → 다운로드에서 진행 상황을 확인하세요.', voiceUnsupported: '이 언어에서는 아직 읽어 줄 수 없습니다.', failed: '이 답변을 읽어 줄 수 없습니다. 다시 시도해 주세요.' },
    es: { readAloud: 'Leer en voz alta', preparing: 'Preparando la voz…', stop: 'Dejar de leer', title: 'Leer en voz alta',
        voiceNotReady: 'La voz aún no se ha descargado. Abre Ajustes → Descargas para ver el progreso.', voiceUnsupported: 'La lectura en voz alta aún no está disponible en este idioma.', failed: 'No se pudo leer esta respuesta. Inténtalo de nuevo.' },
    fr: { readAloud: 'Lire à voix haute', preparing: 'Préparation de la voix…', stop: 'Arrêter la lecture', title: 'Lire à voix haute',
        voiceNotReady: 'La voix n’est pas encore téléchargée. Ouvrez Réglages → Téléchargements pour suivre la progression.', voiceUnsupported: 'La lecture à voix haute n’est pas encore disponible dans cette langue.', failed: 'Cette réponse n’a pas pu être lue. Réessayez.' },
    de: { readAloud: 'Vorlesen', preparing: 'Stimme wird vorbereitet…', stop: 'Vorlesen beenden', title: 'Vorlesen',
        voiceNotReady: 'Die Stimme ist noch nicht heruntergeladen. Öffne Einstellungen → Downloads, um den Fortschritt zu sehen.', voiceUnsupported: 'Vorlesen ist in dieser Sprache noch nicht verfügbar.', failed: 'Diese Antwort konnte nicht vorgelesen werden. Versuche es erneut.' },
    'pt-BR': { readAloud: 'Ler em voz alta', preparing: 'Preparando a voz…', stop: 'Parar leitura', title: 'Ler em voz alta',
        voiceNotReady: 'A voz ainda não foi baixada. Abra Configurações → Downloads para ver o progresso.', voiceUnsupported: 'A leitura em voz alta ainda não está disponível neste idioma.', failed: 'Não foi possível ler esta resposta. Tente novamente.' },
    ru: { readAloud: 'Прочитать вслух', preparing: 'Подготовка голоса…', stop: 'Остановить чтение', title: 'Прочитать вслух',
        voiceNotReady: 'Голос ещё не загружен. Откройте Настройки → Загрузки, чтобы увидеть прогресс.', voiceUnsupported: 'Чтение вслух пока недоступно на этом языке.', failed: 'Не удалось прочитать этот ответ. Попробуйте ещё раз.' },
    ar: { readAloud: 'قراءة بصوت عالٍ', preparing: 'جارٍ تجهيز الصوت…', stop: 'إيقاف القراءة', title: 'قراءة بصوت عالٍ',
        voiceNotReady: 'لم يكتمل تنزيل الصوت بعد. افتح الإعدادات ← التنزيلات لمتابعة التقدم.', voiceUnsupported: 'القراءة بصوت عالٍ غير متاحة بهذه اللغة بعد.', failed: 'تعذّرت قراءة هذا الرد. حاول مرة أخرى.' },
    hi: { readAloud: 'पढ़कर सुनाएँ', preparing: 'आवाज़ तैयार हो रही है…', stop: 'पढ़ना रोकें', title: 'पढ़कर सुनाएँ',
        voiceNotReady: 'आवाज़ अभी डाउनलोड नहीं हुई है। प्रगति देखने के लिए सेटिंग्स → डाउनलोड खोलें।', voiceUnsupported: 'इस भाषा में पढ़कर सुनाना अभी उपलब्ध नहीं है।', failed: 'यह उत्तर पढ़कर नहीं सुनाया जा सका। फिर कोशिश करें।' }
};

export function readAloudText(locale: NextMuxDesktopLocale, key: ReadAloudTextKey): string {
    return (translations[locale] || en)[key] || en[key];
}

export const readAloudLocales = Object.keys(translations) as readonly NextMuxDesktopLocale[];

/** The longest reply read in full (about an hour of speech); a longer one is read up to here. */
export const READ_ALOUD_MAX_CHARS = 20_000;
/** One synthesis request: short enough to start speaking within seconds and well inside the voice tool's time limit. */
export const READ_ALOUD_CHUNK_CHARS = 360;

/**
 * The words of a Markdown reply as they should be spoken: code blocks, tables' rules, link targets, images, HTML tags
 * and Markdown markers are left out; headings, list items and paragraphs become sentences.
 */
export function speechTextFromMarkdown(markdown: string): string {
    return String(markdown || '')
        .replace(/^([ \t]{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\2[`~]*[ \t]*(?=\n|$)|$)/gm, '\n')
        .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
        .replace(/`([^`\n]+)`/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/gm, '$1\n')
        .replace(/^\s*>\s?/gm, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
        .replace(/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '')
        .replace(/\|/g, ' ')
        .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
        .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?=[^*\w]|$)/g, '$1$2')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim()
        .slice(0, READ_ALOUD_MAX_CHARS);
}

/**
 * The pieces a text is synthesized in, in reading order: whole sentences gathered up to `maxChars`; a sentence
 * longer than that is cut at a comma or, failing that, at a space or a character boundary.
 */
export function speechChunks(text: string, maxChars = READ_ALOUD_CHUNK_CHARS): string[] {
    // A sentence ends at CJK or Latin end punctuation (a period only before a space, so 3.14 stays whole) or a line.
    const sentences = String(text || '').split(/(?<=[。！？!?；;…]["'”’）)]?|\.(?=\s)|\n)/);
    const chunks: string[] = [];
    let current = '';
    const push = (piece: string): void => {
        const value = piece.trim();
        if (value) chunks.push(value);
    };
    for (const raw of sentences) {
        const sentence = raw.replace(/\n/g, ' ');
        if (!sentence.trim()) continue;
        if ((current + sentence).length <= maxChars) { current += sentence; continue; }
        push(current);
        current = '';
        let rest = sentence;
        while (rest.length > maxChars) {
            const window = rest.slice(0, maxChars);
            const cut = Math.max(window.lastIndexOf('，'), window.lastIndexOf(','), window.lastIndexOf('、'), window.lastIndexOf(' '));
            const at = cut > maxChars / 3 ? cut + 1 : maxChars;
            push(rest.slice(0, at));
            rest = rest.slice(at);
        }
        current = rest;
    }
    push(current);
    return chunks;
}

/**
 * Whether the voice can speak now or does not speak the language.
 * Uses the operating system's built-in speech synthesis on macOS and Windows across all CPU architectures and OS versions,
 * so it never requires downloading a local voice engine or Kokoro model.
 */
export function readAloudReadiness(_state?: DesktopComponentsState, voiceForLanguage = true): 'ready' | 'notReady' | 'unsupported' {
    return voiceForLanguage ? 'ready' : 'unsupported';
}

const NOVELTY_VOICE_NAMES = new Set([
    'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'fred',
    'good news', 'jester', 'junior', 'kathy', 'organ', 'ralph', 'superstar',
    'trinoids', 'whisper', 'wobble', 'zarvox'
]);

const PREFERRED_VOICE_PATTERNS = [
    // macOS natural/system voices
    'tingting', 'ting-ting', 'meijia', 'mei-jia', 'sinji', 'sin-ji',
    'samantha', 'ava', 'allison', 'alex', 'kyoko', 'otoja', 'yuna',
    'premium', 'enhanced', 'siri', '优化', '高级',
    // Windows SAPI / OneCore / Neural voices
    'xiaoxiao', 'yunxi', 'yaoyao', 'huihui', 'hanhan', 'kangkang', 'zhiwei', 'yating',
    'aria', 'jenny', 'guy', 'zira', 'david', 'haruka', 'ayumi', 'ichiro', 'heami',
    'natural', 'online'
];

const MALE_VOICE_HINTS = ['yunxi', 'kangkang', 'zhiwei', 'danny', 'david', 'guy', 'alex', 'ichiro', 'male', '男'];
const FEMALE_VOICE_HINTS = ['xiaoxiao', 'yaoyao', 'huihui', 'hanhan', 'yating', 'tingting', 'ting-ting', 'meijia', 'mei-jia', 'sinji', 'sin-ji', 'samantha', 'ava', 'zira', 'aria', 'jenny', 'kyoko', 'yuna', 'female', '女'];

/**
 * Selects the best built-in OS voice (`SpeechSynthesisVoice`) for `locale` across macOS and Windows.
 */
export function pickSystemSpeechVoice(
    voices: readonly SpeechSynthesisVoice[],
    locale: string,
    preferredVoiceId?: string
): SpeechSynthesisVoice | undefined {
    if (!Array.isArray(voices) || voices.length === 0) return undefined;
    const normalizedLocale = String(locale || 'zh-CN').replace('_', '-').toLowerCase();
    const baseLang = normalizedLocale.split('-')[0] || 'zh';
    const wantMale = typeof preferredVoiceId === 'string' && preferredVoiceId.includes('male') && !preferredVoiceId.includes('female');
    const wantFemale = typeof preferredVoiceId === 'string' && preferredVoiceId.includes('female');

    const candidates = voices.filter(voice => {
        const lang = String(voice?.lang || '').replace('_', '-').toLowerCase();
        return lang === normalizedLocale || lang.startsWith(`${baseLang}-`) || lang === baseLang;
    });
    if (candidates.length === 0) return undefined;

    let bestVoice = candidates[0];
    let bestScore = -Infinity;

    for (const voice of candidates) {
        const nameLower = String(voice.name || '').toLowerCase();
        const langLower = String(voice.lang || '').replace('_', '-').toLowerCase();
        let score = 0;

        if (NOVELTY_VOICE_NAMES.has(nameLower)) {
            score -= 200;
        }
        if (langLower === normalizedLocale) {
            score += 40;
        } else if (normalizedLocale === 'zh-cn' && (langLower.includes('cn') || langLower.includes('hans'))) {
            score += 35;
        } else if (normalizedLocale === 'zh-tw' && (langLower.includes('tw') || langLower.includes('hk') || langLower.includes('hant'))) {
            score += 35;
        }
        if (voice.localService) {
            score += 10;
        }
        if (voice.default) {
            score += 8;
        }
        for (const pattern of PREFERRED_VOICE_PATTERNS) {
            if (nameLower.includes(pattern)) {
                score += 20;
                break;
            }
        }
        if (wantMale && MALE_VOICE_HINTS.some(hint => nameLower.includes(hint))) {
            score += 25;
        } else if (wantFemale && FEMALE_VOICE_HINTS.some(hint => nameLower.includes(hint))) {
            score += 15;
        }

        if (score > bestScore) {
            bestScore = score;
            bestVoice = voice;
        }
    }

    return bestVoice;
}

/**
 * Speaks a single chunk using the browser/OS Web Speech API (`window.speechSynthesis`).
 * Resolves `true` when spoken (or cancelled), or `false` if unavailable/failed so caller can fall back to native OS WAV synthesis.
 */
export async function speakChunkWithSystemSpeech(
    text: string,
    locale: string,
    options?: {
        readonly preferredVoiceId?: string;
        readonly onStart?: () => void;
        readonly registerCancel?: (cancel: () => void) => void;
    }
): Promise<boolean> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
        return false;
    }
    const clean = String(text || '').trim();
    if (!clean) return true;

    const synth = window.speechSynthesis;
    let voices = synth.getVoices();
    if (!voices || voices.length === 0) {
        voices = await new Promise<SpeechSynthesisVoice[]>(resolve => {
            let settled = false;
            const finish = (): void => {
                if (settled) return;
                settled = true;
                synth.removeEventListener?.('voiceschanged', onVoicesChanged);
                resolve(synth.getVoices() || []);
            };
            const onVoicesChanged = (): void => finish();
            synth.addEventListener?.('voiceschanged', onVoicesChanged);
            setTimeout(finish, 400);
        });
    }

    return new Promise<boolean>(resolve => {
        let settled = false;
        let started = false;
        let cancelled = false;
        const finish = (ok: boolean): void => {
            if (settled) return;
            settled = true;
            resolve(ok);
        };

        try {
            const utterance = new SpeechSynthesisUtterance(clean);
            utterance.lang = locale === 'zh-TW' ? 'zh-TW' : locale === 'zh-CN' ? 'zh-CN' : locale;
            utterance.rate = 1;
            const chosenVoice = pickSystemSpeechVoice(voices, locale, options?.preferredVoiceId);
            if (chosenVoice) {
                utterance.voice = chosenVoice;
                if (chosenVoice.lang) utterance.lang = chosenVoice.lang;
            }
            options?.registerCancel?.(() => {
                cancelled = true;
                try { synth.cancel(); } catch { /* ignore */ }
                finish(true);
            });
            utterance.onstart = () => {
                if (!started) {
                    started = true;
                    options?.onStart?.();
                }
            };
            utterance.onend = () => {
                if (!started && !cancelled) {
                    started = true;
                    options?.onStart?.();
                }
                finish(true);
            };
            utterance.onerror = () => {
                finish(cancelled);
            };
            synth.speak(utterance);
        } catch {
            finish(false);
        }
    });
}
