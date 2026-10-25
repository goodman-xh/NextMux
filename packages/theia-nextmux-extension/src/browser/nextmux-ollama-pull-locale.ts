import type { NextMuxDesktopLocale } from './nextmux-locale';

/** The action on a reply whose Ollama server lacks the model (LobeChat #13): download it, its progress, and what next. */
type Key = 'pull' | 'pulling' | 'pullingStep' | 'pulled' | 'pullAgain' | 'failed';

const en: Readonly<Record<Key, string>> = {
    pull: 'Download {model}', pulling: 'Downloading {model} · {percent}', pullingStep: 'Downloading {model} · {step}',
    pulled: '{model} is ready · Send again', pullAgain: 'Download {model} again', failed: 'The download failed: {error}'
};

const copy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    en,
    'zh-CN': { pull: '下载 {model}', pulling: '正在下载 {model} · {percent}', pullingStep: '正在下载 {model} · {step}', pulled: '{model} 已下载 · 重新发送', pullAgain: '重新下载 {model}', failed: '下载失败：{error}' },
    'zh-TW': { pull: '下載 {model}', pulling: '正在下載 {model} · {percent}', pullingStep: '正在下載 {model} · {step}', pulled: '{model} 已下載 · 重新傳送', pullAgain: '重新下載 {model}', failed: '下載失敗：{error}' },
    ja: { pull: '{model} をダウンロード', pulling: '{model} をダウンロード中 · {percent}', pullingStep: '{model} をダウンロード中 · {step}', pulled: '{model} の準備ができました · もう一度送信', pullAgain: '{model} をもう一度ダウンロード', failed: 'ダウンロードに失敗しました：{error}' },
    ko: { pull: '{model} 다운로드', pulling: '{model} 다운로드 중 · {percent}', pullingStep: '{model} 다운로드 중 · {step}', pulled: '{model} 준비 완료 · 다시 보내기', pullAgain: '{model} 다시 다운로드', failed: '다운로드 실패: {error}' },
    es: { pull: 'Descargar {model}', pulling: 'Descargando {model} · {percent}', pullingStep: 'Descargando {model} · {step}', pulled: '{model} está listo · Enviar de nuevo', pullAgain: 'Descargar {model} otra vez', failed: 'La descarga falló: {error}' },
    fr: { pull: 'Télécharger {model}', pulling: 'Téléchargement de {model} · {percent}', pullingStep: 'Téléchargement de {model} · {step}', pulled: '{model} est prêt · Renvoyer', pullAgain: 'Télécharger {model} à nouveau', failed: 'Le téléchargement a échoué : {error}' },
    de: { pull: '{model} herunterladen', pulling: '{model} wird heruntergeladen · {percent}', pullingStep: '{model} wird heruntergeladen · {step}', pulled: '{model} ist bereit · Erneut senden', pullAgain: '{model} erneut herunterladen', failed: 'Download fehlgeschlagen: {error}' },
    'pt-BR': { pull: 'Baixar {model}', pulling: 'Baixando {model} · {percent}', pullingStep: 'Baixando {model} · {step}', pulled: '{model} está pronto · Enviar de novo', pullAgain: 'Baixar {model} de novo', failed: 'O download falhou: {error}' },
    ru: { pull: 'Скачать {model}', pulling: 'Скачивание {model} · {percent}', pullingStep: 'Скачивание {model} · {step}', pulled: '{model} готова · Отправить снова', pullAgain: 'Скачать {model} заново', failed: 'Не удалось скачать: {error}' },
    ar: { pull: 'تنزيل {model}', pulling: 'جارٍ تنزيل {model} · {percent}', pullingStep: 'جارٍ تنزيل {model} · {step}', pulled: '{model} جاهز · إرسال مجددًا', pullAgain: 'تنزيل {model} مجددًا', failed: 'فشل التنزيل: {error}' },
    hi: { pull: '{model} डाउनलोड करें', pulling: '{model} डाउनलोड हो रहा है · {percent}', pullingStep: '{model} डाउनलोड हो रहा है · {step}', pulled: '{model} तैयार है · फिर से भेजें', pullAgain: '{model} फिर से डाउनलोड करें', failed: 'डाउनलोड विफल: {error}' }
};

export function ollamaPullText(locale: NextMuxDesktopLocale, key: Key, values: Readonly<Record<string, string | number>> = {}): string {
    const template = (copy[locale] || en)[key] || en[key];
    return template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}

export const ollamaPullLocales = Object.keys(copy) as readonly NextMuxDesktopLocale[];
