import type { PlatformOffering } from '../common/nextmux-platform-protocol';
import { estimateManagedVideoPriceMicros, managedVideoInputImagePriceMicros } from '../common/nextmux-managed-video-price';
import type { NextMuxDesktopLocale } from './nextmux-locale';

const text = {
    'zh-CN': { unknown: '价格待确认', second: '秒', image: '张输入图', units: '每秒视频 + 每张输入图', estimate: '预估 {total}（视频 {video} + {count} 张输入图 {images}）' },
    'zh-TW': { unknown: '價格待確認', second: '秒', image: '張輸入圖', units: '每秒影片 + 每張輸入圖', estimate: '預估 {total}（影片 {video} + {count} 張輸入圖 {images}）' },
    en: { unknown: 'Price pending', second: 'second', image: 'input image', units: 'Per video second + per input image', estimate: 'Estimated {total} (video {video} + {count} input images {images})' },
    ja: { unknown: '価格確認待ち', second: '秒', image: '入力画像', units: '動画1秒 + 入力画像1枚', estimate: '概算 {total}（動画 {video} + 入力画像{count}枚 {images}）' },
    ko: { unknown: '가격 확인 대기', second: '초', image: '입력 이미지', units: '동영상 1초 + 입력 이미지 1장', estimate: '예상 {total} (동영상 {video} + 입력 이미지 {count}장 {images})' },
    es: { unknown: 'Precio pendiente', second: 'segundo', image: 'imagen de entrada', units: 'Por segundo de vídeo + por imagen de entrada', estimate: 'Estimado {total} (vídeo {video} + {count} imágenes de entrada {images})' },
    fr: { unknown: 'Prix en attente', second: 'seconde', image: 'image d’entrée', units: 'Par seconde de vidéo + par image d’entrée', estimate: 'Estimation {total} (vidéo {video} + {count} images d’entrée {images})' },
    de: { unknown: 'Preis ausstehend', second: 'Sekunde', image: 'Eingabebild', units: 'Pro Videosekunde + pro Eingabebild', estimate: 'Geschätzt {total} (Video {video} + {count} Eingabebilder {images})' },
    'pt-BR': { unknown: 'Preço pendente', second: 'segundo', image: 'imagem de entrada', units: 'Por segundo de vídeo + por imagem de entrada', estimate: 'Estimativa {total} (vídeo {video} + {count} imagens de entrada {images})' },
    ru: { unknown: 'Цена уточняется', second: 'секунда', image: 'входное изображение', units: 'За секунду видео + за входное изображение', estimate: 'Примерно {total} (видео {video} + {count} входных изображений {images})' },
    ar: { unknown: 'السعر قيد التأكيد', second: 'ثانية', image: 'صورة إدخال', units: 'لكل ثانية فيديو + لكل صورة إدخال', estimate: 'التقدير {total} (فيديو {video} + {count} صور إدخال {images})' },
    hi: { unknown: 'कीमत की पुष्टि बाकी', second: 'सेकंड', image: 'इनपुट चित्र', units: 'प्रति वीडियो सेकंड + प्रति इनपुट चित्र', estimate: 'अनुमानित {total} (वीडियो {video} + {count} इनपुट चित्र {images})' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

const copy = (locale: string): typeof text[NextMuxDesktopLocale] => text[locale as NextMuxDesktopLocale] ?? text.en;
const amount = (locale: string, micros: number, currency: string): string => new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 6
}).format(micros / 1_000_000);

export function videoPriceUnitText(locale: string): string { return copy(locale).units; }

/** Keep the per-second and per-input-image prices visible in model pickers and confirmations. */
export function formatManagedVideoPrice(locale: string, price: PlatformOffering['price']): string {
    const each = managedVideoInputImagePriceMicros(price), t = copy(locale);
    if (estimateManagedVideoPriceMicros(price, 1) === undefined || each === undefined) return t.unknown;
    const seconds = `${amount(locale, price.videoSecondMicros!, price.currency)} / ${t.second}`;
    return each > 0 ? `${seconds} + ${amount(locale, each, price.currency)} / ${t.image}` : seconds;
}

export function formatManagedVideoEstimate(locale: string, price: PlatformOffering['price'], durationSeconds: number | undefined, inputImages = 0): string {
    const total = estimateManagedVideoPriceMicros(price, durationSeconds, inputImages), each = managedVideoInputImagePriceMicros(price);
    if (total === undefined || each === undefined) return copy(locale).unknown;
    if (!inputImages || !each) return amount(locale, total, price.currency);
    const values = { total: amount(locale, total, price.currency), video: amount(locale, Math.ceil(price.videoSecondMicros! * durationSeconds!), price.currency),
        count: new Intl.NumberFormat(locale).format(inputImages), images: amount(locale, each * inputImages, price.currency) };
    return Object.entries(values).reduce<string>((out, [key, value]) => out.replaceAll(`{${key}}`, value), copy(locale).estimate);
}
