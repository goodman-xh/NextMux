/**
 * A relay offering's price, as users see it when they hover a model: the model's official price, the multiplier the
 * merchant applies (or none, when the merchant set its own price), and what the relay charges — every billed
 * dimension (input, output, cache read/write, images, seconds, characters, requests). Shared by the composer model
 * menu, the comic step pickers and the model center so one model reads the same everywhere.
 */
import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { OfferingPriceDimensions, PlatformOffering } from '../common/nextmux-platform-protocol';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';
import { mediaTierInputRates, mediaTierLabel, normalizeOfferingMediaTiers, type OfferingMediaTierQuality } from '../common/nextmux-media-price-tiers';
import { offeringIsOwnPriced, offeringMultiplierBps } from '../common/nextmux-media-cost-estimator';

type Unit = 'mtok' | 'image' | 'second' | 'mchar' | 'request';
type Metric = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'imageOutput' | 'image' | 'video' | 'videoInputImage' | 'speech' | 'audio' | 'request';

/** Display order; the field is the per-unit micros on `price` / `officialPrice`. */
export const OFFERING_PRICE_FIELDS: readonly (readonly [Metric, keyof OfferingPriceDimensions, Unit])[] = [
    ['input', 'inputPerMillionMicros', 'mtok'],
    ['output', 'outputPerMillionMicros', 'mtok'],
    ['cacheRead', 'cachedInputPerMillionMicros', 'mtok'],
    ['cacheWrite', 'cacheWritePerMillionMicros', 'mtok'],
    ['imageOutput', 'imageOutputPerMillionMicros', 'mtok'],
    ['image', 'imageEachMicros', 'image'],
    ['video', 'videoSecondMicros', 'second'],
    ['videoInputImage', 'videoInputImageEachMicros', 'image'],
    ['speech', 'audioPerMillionCharactersMicros', 'mchar'],
    ['audio', 'audioSecondMicros', 'second'],
    ['request', 'requestEachMicros', 'request'],
];

const text = {
    'zh-CN': { textOutput: '文本输出', textThinkingOutput: '文本/思考输出', tierTokenAddon: '另计 Token', pricePending: '价格待确认', songUnit: '首', tierInputAddon: '另计提示词输入', imageInput: '图片输入', tierTitle: '分档价格', tierColumn: '档位', qualityLow: '低质量', qualityMedium: '中质量', qualityHigh: '高质量', qualityStandard: '标准', qualityHd: '高清', audioOn: '有声', audioOff: '无声', defaultTier: '默认', billedTier: '实际计费', fixedTierNote: '该接口不传视频分辨率：每个视频都按 {tier} 生成和计费。', tierPrompt: "输入 Token（含缓存）", tierMaximum: "最高档价格；分档信息暂不可用", videoInputImage: '视频输入图', official: '官方报价', multiplier: '当前倍率', none: '无', relay: '中转商报价', own: '中转商自定价格，不受倍率影响', input: '输入', output: '输出', cacheRead: '缓存读取', cacheWrite: '缓存写入', imageOutput: '图片输出', image: '图片', video: '视频', speech: '语音合成', audio: '音频', request: '按次', mtok: '百万 Token', mchar: '百万字符', second: '秒', requestUnit: '次', imageUnit: '张', variant: '另一个报价', ownTag: '自定义价格', averageMultiplier: '平均倍率', expandPrices: '展开报价详情', collapsePrices: '收起报价详情', priceTitle: '模型报价已调整', priceBody: '你正在使用的 {model}，中转商已调整报价。为避免资金损失，请查看新价格。', priceInline: '你现在使用的模型，中转商已调整报价，为避免资金损失，请查看新价格' },
    'zh-TW': { textOutput: '文字輸出', textThinkingOutput: '文字/思考輸出', tierTokenAddon: '另計 Token', pricePending: '價格待確認', songUnit: '首', tierInputAddon: '另計提示詞輸入', imageInput: '圖片輸入', tierTitle: '分檔價格', tierColumn: '檔位', qualityLow: '低品質', qualityMedium: '中品質', qualityHigh: '高品質', qualityStandard: '標準', qualityHd: '高清', audioOn: '有聲', audioOff: '無聲', defaultTier: '預設', billedTier: '實際計費', fixedTierNote: '此介面不傳影片解析度：每個影片都按 {tier} 產生並計費。', tierPrompt: "輸入 Token（含快取）", tierMaximum: "最高檔價格；分檔資訊暫不可用", videoInputImage: '影片輸入圖', official: '官方報價', multiplier: '目前倍率', none: '無', relay: '中轉商報價', own: '中轉商自訂價格，不受倍率影響', input: '輸入', output: '輸出', cacheRead: '快取讀取', cacheWrite: '快取寫入', imageOutput: '圖片輸出', image: '圖片', video: '影片', speech: '語音合成', audio: '音訊', request: '按次', mtok: '百萬 Token', mchar: '百萬字元', second: '秒', requestUnit: '次', imageUnit: '張', variant: '另一個報價', ownTag: '自訂價格', averageMultiplier: '平均倍率', expandPrices: '展開報價詳情', collapsePrices: '收起報價詳情', priceTitle: '模型報價已調整', priceBody: '你正在使用的 {model}，中轉商已調整報價。為避免資金損失，請查看新價格。', priceInline: '你現在使用的模型，中轉商已調整報價，為避免資金損失，請查看新價格' },
    en: { textOutput: 'Text output', textThinkingOutput: 'Text/thinking output', tierTokenAddon: 'Plus tokens', pricePending: 'Price pending', songUnit: 'song', tierInputAddon: 'Plus prompt input', imageInput: 'Image input', tierTitle: 'Price tiers', tierColumn: 'Tier', qualityLow: 'Low', qualityMedium: 'Medium', qualityHigh: 'High', qualityStandard: 'Standard', qualityHd: 'HD', audioOn: 'With audio', audioOff: 'No audio', defaultTier: 'Default', billedTier: 'Billed', fixedTierNote: 'This API sends no video resolution: every video is made and billed at {tier}.', tierPrompt: "Input tokens (including cache)", tierMaximum: "Highest tier price; tier details unavailable", videoInputImage: 'Video input image', official: 'Official price', multiplier: 'Multiplier', none: 'None', relay: 'Relay price', own: 'Set by the relay; the multiplier does not apply', input: 'Input', output: 'Output', cacheRead: 'Cache read', cacheWrite: 'Cache write', imageOutput: 'Image output', image: 'Image', video: 'Video', speech: 'Speech', audio: 'Audio', request: 'Request', mtok: '1M tokens', mchar: '1M characters', second: 'second', requestUnit: 'request', imageUnit: 'image', variant: 'Another price', ownTag: 'Own price', averageMultiplier: 'Avg. multiplier', expandPrices: 'Show price details', collapsePrices: 'Hide price details', priceTitle: 'Model price changed', priceBody: 'The relay changed the price of {model}, which you are using. To avoid unexpected charges, review the new price.', priceInline: 'The relay changed the price of the model you are using. To avoid unexpected charges, review the new price' },
    ja: { textOutput: 'テキスト出力', textThinkingOutput: 'テキスト/思考出力', tierTokenAddon: 'トークンは別途', pricePending: '価格未確定', songUnit: '曲', tierInputAddon: 'プロンプト入力は別途', imageInput: '画像入力', tierTitle: '料金帯', tierColumn: '帯', qualityLow: '低品質', qualityMedium: '中品質', qualityHigh: '高品質', qualityStandard: '標準', qualityHd: 'HD', audioOn: '音声あり', audioOff: '音声なし', defaultTier: '既定', billedTier: '課金対象', fixedTierNote: 'この API は動画解像度を送信しません。すべての動画が {tier} で生成・課金されます。', tierPrompt: "入力トークン（キャッシュ含む）", tierMaximum: "最高帯の料金（帯別の詳細は未提供）", videoInputImage: '動画入力画像', official: '公式価格', multiplier: '現在の倍率', none: 'なし', relay: 'リレー価格', own: 'リレーの独自価格（倍率は適用されません）', input: '入力', output: '出力', cacheRead: 'キャッシュ読み取り', cacheWrite: 'キャッシュ書き込み', imageOutput: '画像出力', image: '画像', video: '動画', speech: '音声合成', audio: '音声', request: 'リクエスト', mtok: '100万トークン', mchar: '100万文字', second: '秒', requestUnit: '回', imageUnit: '枚', variant: '別の価格', ownTag: '独自価格', averageMultiplier: '平均倍率', expandPrices: '価格詳細を表示', collapsePrices: '価格詳細を隠す', priceTitle: 'モデル価格が変更されました', priceBody: '使用中の {model} の価格がリレーによって変更されました。予期しない費用を避けるため、新しい価格を確認してください。', priceInline: '使用中のモデルの価格が変更されました。予期しない費用を避けるため、新しい価格を確認してください' },
    ko: { textOutput: '텍스트 출력', textThinkingOutput: '텍스트/사고 출력', tierTokenAddon: '토큰 별도', pricePending: '가격 확인 중', songUnit: '곡', tierInputAddon: '프롬프트 입력 별도', imageInput: '이미지 입력', tierTitle: '가격 구간', tierColumn: '구간', qualityLow: '낮음', qualityMedium: '보통', qualityHigh: '높음', qualityStandard: '표준', qualityHd: 'HD', audioOn: '오디오 포함', audioOff: '오디오 없음', defaultTier: '기본', billedTier: '실제 과금', fixedTierNote: '이 API는 동영상 해상도를 보내지 않습니다. 모든 동영상은 {tier}(으)로 생성·과금됩니다.', tierPrompt: "입력 토큰 (캐시 포함)", tierMaximum: "최고 구간 요금; 구간 정보 없음", videoInputImage: '동영상 입력 이미지', official: '공식 가격', multiplier: '현재 배율', none: '없음', relay: '릴레이 가격', own: '릴레이가 직접 정한 가격(배율 미적용)', input: '입력', output: '출력', cacheRead: '캐시 읽기', cacheWrite: '캐시 쓰기', imageOutput: '이미지 출력', image: '이미지', video: '동영상', speech: '음성 합성', audio: '오디오', request: '요청', mtok: '100만 토큰', mchar: '100만 자', second: '초', requestUnit: '회', imageUnit: '장', variant: '다른 가격', ownTag: '직접 설정 가격', averageMultiplier: '평균 배율', expandPrices: '요금 상세 펼치기', collapsePrices: '요금 상세 접기', priceTitle: '모델 가격이 변경됨', priceBody: '사용 중인 {model}의 가격을 릴레이가 변경했습니다. 예상치 못한 비용을 막으려면 새 가격을 확인하세요.', priceInline: '사용 중인 모델의 가격이 변경되었습니다. 예상치 못한 비용을 막으려면 새 가격을 확인하세요' },
    es: { textOutput: 'Salida de texto', textThinkingOutput: 'Salida de texto/razonamiento', tierTokenAddon: 'Más tokens', pricePending: 'Precio pendiente', songUnit: 'canción', tierInputAddon: 'Más entrada de prompt', imageInput: 'Entrada de imagen', tierTitle: 'Niveles de precio', tierColumn: 'Nivel', qualityLow: 'Baja', qualityMedium: 'Media', qualityHigh: 'Alta', qualityStandard: 'Estándar', qualityHd: 'HD', audioOn: 'Con audio', audioOff: 'Sin audio', defaultTier: 'Predeterminado', billedTier: 'Facturado', fixedTierNote: 'Esta API no envía la resolución del vídeo: cada vídeo se genera y se cobra en {tier}.', tierPrompt: "Tokens de entrada (incluida caché)", tierMaximum: "Precio del nivel más alto; detalles no disponibles", videoInputImage: 'Imagen de entrada de vídeo', official: 'Precio oficial', multiplier: 'Multiplicador', none: 'Ninguno', relay: 'Precio del relay', own: 'Fijado por el relay; el multiplicador no se aplica', input: 'Entrada', output: 'Salida', cacheRead: 'Lectura de caché', cacheWrite: 'Escritura de caché', imageOutput: 'Salida de imagen', image: 'Imagen', video: 'Vídeo', speech: 'Voz', audio: 'Audio', request: 'Solicitud', mtok: '1 M tokens', mchar: '1 M caracteres', second: 'segundo', requestUnit: 'solicitud', imageUnit: 'imagen', variant: 'Otro precio', ownTag: 'Precio propio', averageMultiplier: 'Multiplicador medio', expandPrices: 'Mostrar detalles de precio', collapsePrices: 'Ocultar detalles de precio', priceTitle: 'Cambió el precio del modelo', priceBody: 'El relay cambió el precio de {model}, que estás usando. Para evitar cargos inesperados, revisa el nuevo precio.', priceInline: 'El relay cambió el precio del modelo que usas. Para evitar cargos inesperados, revisa el nuevo precio' },
    fr: { textOutput: 'Sortie texte', textThinkingOutput: 'Sortie texte/réflexion', tierTokenAddon: 'Plus les jetons', pricePending: 'Prix à confirmer', songUnit: 'morceau', tierInputAddon: 'Plus l’entrée du prompt', imageInput: 'Entrée image', tierTitle: 'Paliers de prix', tierColumn: 'Palier', qualityLow: 'Basse', qualityMedium: 'Moyenne', qualityHigh: 'Haute', qualityStandard: 'Standard', qualityHd: 'HD', audioOn: 'Avec audio', audioOff: 'Sans audio', defaultTier: 'Par défaut', billedTier: 'Facturé', fixedTierNote: 'Cette API n’envoie pas la résolution vidéo : chaque vidéo est générée et facturée en {tier}.', tierPrompt: "Tokens d’entrée (cache inclus)", tierMaximum: "Prix du palier le plus élevé ; détails indisponibles", videoInputImage: 'Image d’entrée vidéo', official: 'Prix officiel', multiplier: 'Multiplicateur', none: 'Aucun', relay: 'Prix du relais', own: 'Fixé par le relais ; sans multiplicateur', input: 'Entrée', output: 'Sortie', cacheRead: 'Lecture du cache', cacheWrite: 'Écriture du cache', imageOutput: 'Sortie image', image: 'Image', video: 'Vidéo', speech: 'Voix', audio: 'Audio', request: 'Requête', mtok: '1 M jetons', mchar: '1 M caractères', second: 'seconde', requestUnit: 'requête', imageUnit: 'image', variant: 'Autre prix', ownTag: 'Prix propre', averageMultiplier: 'Multiplicateur moyen', expandPrices: 'Afficher le détail des prix', collapsePrices: 'Masquer le détail des prix', priceTitle: 'Prix du modèle modifié', priceBody: 'Le relais a modifié le prix de {model}, que vous utilisez. Pour éviter des frais inattendus, vérifiez le nouveau prix.', priceInline: 'Le relais a modifié le prix du modèle que vous utilisez. Pour éviter des frais inattendus, vérifiez le nouveau prix' },
    de: { textOutput: 'Textausgabe', textThinkingOutput: 'Text-/Denkausgabe', tierTokenAddon: 'Zuzüglich Tokens', pricePending: 'Preis ausstehend', songUnit: 'Song', tierInputAddon: 'Zuzüglich Prompt-Eingabe', imageInput: 'Bildeingabe', tierTitle: 'Preisstufen', tierColumn: 'Stufe', qualityLow: 'Niedrig', qualityMedium: 'Mittel', qualityHigh: 'Hoch', qualityStandard: 'Standard', qualityHd: 'HD', audioOn: 'Mit Audio', audioOff: 'Ohne Audio', defaultTier: 'Standard', billedTier: 'Abgerechnet', fixedTierNote: 'Diese API übermittelt keine Videoauflösung: Jedes Video wird in {tier} erzeugt und abgerechnet.', tierPrompt: "Eingabetokens (einschließlich Cache)", tierMaximum: "Preis der höchsten Stufe; Details nicht verfügbar", videoInputImage: 'Video-Eingabebild', official: 'Offizieller Preis', multiplier: 'Multiplikator', none: 'Keiner', relay: 'Relay-Preis', own: 'Vom Relay festgelegt; kein Multiplikator', input: 'Eingabe', output: 'Ausgabe', cacheRead: 'Cache-Lesen', cacheWrite: 'Cache-Schreiben', imageOutput: 'Bildausgabe', image: 'Bild', video: 'Video', speech: 'Sprache', audio: 'Audio', request: 'Anfrage', mtok: '1 Mio. Tokens', mchar: '1 Mio. Zeichen', second: 'Sekunde', requestUnit: 'Anfrage', imageUnit: 'Bild', variant: 'Anderer Preis', ownTag: 'Eigener Preis', averageMultiplier: 'Ø Multiplikator', expandPrices: 'Preisdetails anzeigen', collapsePrices: 'Preisdetails ausblenden', priceTitle: 'Modellpreis geändert', priceBody: 'Das Relay hat den Preis von {model}, das Sie verwenden, geändert. Prüfen Sie den neuen Preis, um unerwartete Kosten zu vermeiden.', priceInline: 'Das Relay hat den Preis Ihres Modells geändert. Prüfen Sie den neuen Preis, um unerwartete Kosten zu vermeiden' },
    'pt-BR': { textOutput: 'Saída de texto', textThinkingOutput: 'Saída de texto/raciocínio', tierTokenAddon: 'Mais tokens', pricePending: 'Preço pendente', songUnit: 'música', tierInputAddon: 'Mais entrada do prompt', imageInput: 'Entrada de imagem', tierTitle: 'Faixas de preço', tierColumn: 'Faixa', qualityLow: 'Baixa', qualityMedium: 'Média', qualityHigh: 'Alta', qualityStandard: 'Padrão', qualityHd: 'HD', audioOn: 'Com áudio', audioOff: 'Sem áudio', defaultTier: 'Padrão', billedTier: 'Cobrado', fixedTierNote: 'Esta API não envia a resolução do vídeo: cada vídeo é gerado e cobrado em {tier}.', tierPrompt: "Tokens de entrada (incluindo cache)", tierMaximum: "Preço da faixa mais alta; detalhes indisponíveis", videoInputImage: 'Imagem de entrada de vídeo', official: 'Preço oficial', multiplier: 'Multiplicador', none: 'Nenhum', relay: 'Preço do relay', own: 'Definido pelo relay; sem multiplicador', input: 'Entrada', output: 'Saída', cacheRead: 'Leitura de cache', cacheWrite: 'Gravação de cache', imageOutput: 'Saída de imagem', image: 'Imagem', video: 'Vídeo', speech: 'Fala', audio: 'Áudio', request: 'Solicitação', mtok: '1 mi tokens', mchar: '1 mi caracteres', second: 'segundo', requestUnit: 'solicitação', imageUnit: 'imagem', variant: 'Outro preço', ownTag: 'Preço próprio', averageMultiplier: 'Multiplicador médio', expandPrices: 'Mostrar detalhes de preço', collapsePrices: 'Ocultar detalhes de preço', priceTitle: 'Preço do modelo alterado', priceBody: 'O relay alterou o preço de {model}, que você está usando. Para evitar cobranças inesperadas, revise o novo preço.', priceInline: 'O relay alterou o preço do modelo que você usa. Para evitar cobranças inesperadas, revise o novo preço' },
    ru: { textOutput: 'Текстовый вывод', textThinkingOutput: 'Вывод текста/рассуждений', tierTokenAddon: 'Плюс токены', pricePending: 'Цена уточняется', songUnit: 'трек', tierInputAddon: 'Плюс ввод промпта', imageInput: 'Ввод изображений', tierTitle: 'Ценовые уровни', tierColumn: 'Уровень', qualityLow: 'Низкое', qualityMedium: 'Среднее', qualityHigh: 'Высокое', qualityStandard: 'Стандарт', qualityHd: 'HD', audioOn: 'Со звуком', audioOff: 'Без звука', defaultTier: 'По умолчанию', billedTier: 'Тарифицируется', fixedTierNote: 'Этот API не передаёт разрешение видео: каждое видео создаётся и тарифицируется в {tier}.', tierPrompt: "Входные токены (включая кэш)", tierMaximum: "Цена наивысшего уровня; подробности недоступны", videoInputImage: 'Входное изображение видео', official: 'Официальная цена', multiplier: 'Множитель', none: 'Нет', relay: 'Цена релея', own: 'Цена релея; множитель не применяется', input: 'Вход', output: 'Выход', cacheRead: 'Чтение кэша', cacheWrite: 'Запись в кэш', imageOutput: 'Вывод изображений', image: 'Изображение', video: 'Видео', speech: 'Речь', audio: 'Аудио', request: 'Запрос', mtok: '1 млн токенов', mchar: '1 млн символов', second: 'секунда', requestUnit: 'запрос', imageUnit: 'изображение', variant: 'Другая цена', ownTag: 'Своя цена', averageMultiplier: 'Средний множитель', expandPrices: 'Показать детали цены', collapsePrices: 'Скрыть детали цены', priceTitle: 'Цена модели изменена', priceBody: 'Релей изменил цену модели {model}, которой вы пользуетесь. Чтобы избежать неожиданных расходов, проверьте новую цену.', priceInline: 'Релей изменил цену используемой модели. Чтобы избежать неожиданных расходов, проверьте новую цену' },
    ar: { textOutput: 'إخراج النص', textThinkingOutput: 'إخراج النص/التفكير', tierTokenAddon: 'إضافة الرموز', pricePending: 'السعر قيد التأكيد', songUnit: 'مقطع', tierInputAddon: 'إضافة إلى إدخال الموجّه', imageInput: 'إدخال الصور', tierTitle: 'شرائح الأسعار', tierColumn: 'الشريحة', qualityLow: 'منخفضة', qualityMedium: 'متوسطة', qualityHigh: 'عالية', qualityStandard: 'قياسية', qualityHd: 'HD', audioOn: 'مع صوت', audioOff: 'بدون صوت', defaultTier: 'افتراضي', billedTier: 'المحتسب', fixedTierNote: 'لا ترسل واجهة API هذه دقة الفيديو: يُنشأ كل فيديو ويُحتسب بدقة {tier}.', tierPrompt: "رموز الإدخال (بما فيها المخزنة مؤقتاً)", tierMaximum: "سعر أعلى شريحة؛ تفاصيل الشرائح غير متاحة", videoInputImage: 'صورة إدخال الفيديو', official: 'السعر الرسمي', multiplier: 'المضاعِف الحالي', none: 'لا يوجد', relay: 'سعر المُرحِّل', own: 'سعر حدّده المُرحِّل؛ لا يُطبَّق المضاعِف', input: 'الإدخال', output: 'الإخراج', cacheRead: 'قراءة ذاكرة التخزين المؤقت', cacheWrite: 'الكتابة إلى ذاكرة التخزين المؤقت', imageOutput: 'إخراج الصور', image: 'صورة', video: 'فيديو', speech: 'الكلام', audio: 'الصوت', request: 'طلب', mtok: 'مليون رمز', mchar: 'مليون حرف', second: 'ثانية', requestUnit: 'طلب', imageUnit: 'صورة', variant: 'سعر آخر', ownTag: 'سعر خاص', averageMultiplier: 'متوسط المضاعف', expandPrices: 'إظهار تفاصيل السعر', collapsePrices: 'إخفاء تفاصيل السعر', priceTitle: 'تغيّر سعر النموذج', priceBody: 'غيّر المُرحِّل سعر {model} الذي تستخدمه. لتجنّب رسوم غير متوقعة، راجع السعر الجديد.', priceInline: 'غيّر المُرحِّل سعر النموذج الذي تستخدمه. لتجنّب رسوم غير متوقعة، راجع السعر الجديد' },
    hi: { textOutput: 'टेक्स्ट आउटपुट', textThinkingOutput: 'टेक्स्ट/चिंतन आउटपुट', tierTokenAddon: 'टोकन अतिरिक्त', pricePending: 'कीमत तय होनी है', songUnit: 'गीत', tierInputAddon: 'प्रॉम्प्ट इनपुट अतिरिक्त', imageInput: 'चित्र इनपुट', tierTitle: 'मूल्य स्तर', tierColumn: 'स्तर', qualityLow: 'निम्न', qualityMedium: 'मध्यम', qualityHigh: 'उच्च', qualityStandard: 'मानक', qualityHd: 'HD', audioOn: 'ऑडियो सहित', audioOff: 'बिना ऑडियो', defaultTier: 'डिफ़ॉल्ट', billedTier: 'लागू दर', fixedTierNote: 'यह API वीडियो रिज़ॉल्यूशन नहीं भेजता: हर वीडियो {tier} में बनता और शुल्कित होता है।', tierPrompt: "इनपुट टोकन (कैश सहित)", tierMaximum: "उच्चतम स्तर की कीमत; स्तर विवरण उपलब्ध नहीं", videoInputImage: 'वीडियो इनपुट चित्र', official: 'आधिकारिक कीमत', multiplier: 'मौजूदा गुणक', none: 'कोई नहीं', relay: 'रिले कीमत', own: 'रिले द्वारा तय कीमत; गुणक लागू नहीं', input: 'इनपुट', output: 'आउटपुट', cacheRead: 'कैश रीड', cacheWrite: 'कैश राइट', imageOutput: 'छवि आउटपुट', image: 'छवि', video: 'वीडियो', speech: 'वाणी', audio: 'ऑडियो', request: 'अनुरोध', mtok: '10 लाख टोकन', mchar: '10 लाख अक्षर', second: 'सेकंड', requestUnit: 'अनुरोध', imageUnit: 'छवि', variant: 'दूसरी कीमत', ownTag: 'अपनी कीमत', averageMultiplier: 'औसत गुणक', expandPrices: 'कीमत विवरण दिखाएँ', collapsePrices: 'कीमत विवरण छिपाएँ', priceTitle: 'मॉडल की कीमत बदली', priceBody: 'आप जिस {model} का इस्तेमाल कर रहे हैं, रिले ने उसकी कीमत बदल दी है। अनचाहे खर्च से बचने के लिए नई कीमत देखें।', priceInline: 'आप जिस मॉडल का इस्तेमाल कर रहे हैं, उसकी कीमत बदल गई है। अनचाहे खर्च से बचने के लिए नई कीमत देखें' },
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

const multiplierShortText: Readonly<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '倍率', 'zh-TW': '倍率', en: 'Rate', ja: '倍率', ko: '배율',
    es: 'Tasa', fr: 'Taux', de: 'Faktor', 'pt-BR': 'Taxa', ru: 'Коэф.', ar: 'المعامل', hi: 'गुणक'
};

export type OfferingPriceTextKey = keyof typeof text.en | 'multiplierShort';
function uncheckedOfferingPriceText(locale: NextMuxDesktopLocale, key: OfferingPriceTextKey, values: Record<string, string> = {}): string {
    const raw = key === 'multiplierShort' ? (multiplierShortText[locale] || multiplierShortText.en) : (text[locale] || text.en)[key];
    return Object.entries(values).reduce<string>((out, [name, value]) => out.replaceAll(`{${name}}`, value), raw);
}

const unitText = (locale: NextMuxDesktopLocale, unit: Unit): string =>
    offeringPriceText(locale, unit === 'mtok' ? 'mtok' : unit === 'mchar' ? 'mchar' : unit === 'second' ? 'second' : unit === 'image' ? 'imageUnit' : 'requestUnit');

/** US$ with at least two decimals and up to six (per-token-rates are often below a cent). */
export function formatPriceMicros(locale: NextMuxDesktopLocale, micros: number, currency = 'USD'): string {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micros / 1_000_000)
        .replace(/^\$/, 'US$');
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// One definition for the price card and the media cost estimates (common/nextmux-media-cost-estimator).
export { offeringIsOwnPriced, offeringMultiplierBps };

/** The card's multiplier, as in the relay drawer: at most two decimals (display only; billing keeps every basis point). */
function offeringMultiplierText(locale: NextMuxDesktopLocale, bps: number): string {
    const format = (multiplier: number): string => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(multiplier);
    return bps > 0 && bps < 50 ? `<${format(0.01)}` : format(bps / 10_000);
}

/**
 * The official price per dimension. Older platform versions do not send `officialPrice`; for a multiplier offering it
 * is then the user price divided by the multiplier (exact up to rounding), and unknown for a merchant-set price.
 */
export function offeringOfficialPrice(offering: Pick<PlatformOffering, 'price' | 'multiplierBps' | 'keyPrice' | 'officialPrice'>): Partial<Record<keyof OfferingPriceDimensions, unknown>> | null {
    if (offering.officialPrice !== undefined) return offering.officialPrice;
    const bps = offeringMultiplierBps(offering);
    if (bps === null || bps <= 0) return null;
    return Object.fromEntries(OFFERING_PRICE_FIELDS.map(([, field]) => {
        const value = offering.price?.[field];
        return [field, finite(value) ? Math.round(value * 10_000 / bps) : null];
    }));
}

/** Two offerings of one model with the same signature bill identically (mode, multiplier and every rate). */
export function offeringPriceSignature(offering: Pick<PlatformOffering, 'price' | 'multiplierBps' | 'keyPrice'>): string {
    const rates = OFFERING_PRICE_FIELDS.map(([, field]) => { const value = offering.price?.[field]; return finite(value) ? value : '-'; });
    // The flat rates are only the default tier: two merchants can match there and still bill other tiers differently.
    const tiers = normalizeOfferingMediaTiers((offering.price as typeof offering.price & { readonly mediaTiers?: unknown } | undefined)?.mediaTiers);
    const tierRates = !tiers ? '-' : [tiers.tiers.map(tier => `${tier.id}=${tier.customerMicros}`).join(','),
        (tiers.tokenRates || []).map(rate => `${rate.metric}=${rate.customerMicros ?? '-'}`).join(',')].join(';');
    return [offeringIsOwnPriced(offering) ? 'direct' : `x${offeringMultiplierBps(offering) ?? '-'}`, offering.price?.currency || 'USD', ...rates, tierRates].join('|');
}

type PriceLike = Partial<Record<keyof OfferingPriceDimensions, unknown>> | null | undefined;

export const OFFERING_PRICE_SECTIONS_STORAGE_KEY = 'nextmux.desktop.priceSections.v1';
type PriceSection = 'official' | 'user';
let sharedOfferingPriceSections: Record<PriceSection, boolean> | undefined;

export function offeringPriceSectionExpanded(section: PriceSection): boolean {
    if (!sharedOfferingPriceSections) {
        let saved: Partial<Record<PriceSection, boolean>> | undefined;
        try { saved = JSON.parse(window.localStorage.getItem(OFFERING_PRICE_SECTIONS_STORAGE_KEY) || 'null'); } catch { /* Private storage: retain this session's choices. */ }
        sharedOfferingPriceSections = { official: saved?.official === true, user: saved?.user === true };
    }
    return sharedOfferingPriceSections[section];
}

export function setOfferingPriceSectionExpanded(section: PriceSection, expanded: boolean): void {
    offeringPriceSectionExpanded(section);
    sharedOfferingPriceSections = { ...sharedOfferingPriceSections!, [section]: expanded };
    try { window.localStorage.setItem(OFFERING_PRICE_SECTIONS_STORAGE_KEY, JSON.stringify(sharedOfferingPriceSections)); } catch { /* Memory still remembers. */ }
}

export function isOfferingPriceExpanded(): boolean {
    return offeringPriceSectionExpanded('official') || offeringPriceSectionExpanded('user');
}

export function setOfferingPriceExpanded(expanded: boolean): void {
    setOfferingPriceSectionExpanded('official', expanded);
    setOfferingPriceSectionExpanded('user', expanded);
}

/** A measured viewport rectangle (DOMRect's fields). */
export interface PriceOverlayBox {
    readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number;
}

/**
 * Where the pulled-out price drawer (C) goes. Horizontally: beside the model detail drawer (B), over the model list
 * (A), at most as wide as A. Vertically: level with B's top, lowered just enough that C's bottom reaches the price
 * trigger bar at the bottom of B, so the pointer moving straight across from that bar lands in C and never on A's
 * rows below a short C. Always inside the viewport; content taller than the room scrolls in C.
 */
export function placePriceOverlayDrawer(input: {
    readonly viewportWidth: number; readonly viewportHeight: number;
    readonly picker?: PriceOverlayBox; readonly detail?: PriceOverlayBox; readonly trigger?: PriceOverlayBox;
    /** B sits left of its list (no list measured): C opens on B's right. */
    readonly detailOnLeft?: boolean;
    /** C's content height; 0 before C has rendered. */
    readonly contentHeight: number;
}): { readonly left: number; readonly top: number; readonly width: number; readonly maxHeight: number; readonly side: 'left' | 'right' } {
    const edge = 8, gap = 7, minimumHeight = 120;
    const { viewportWidth, viewportHeight, picker, detail, trigger } = input;
    const pickerBox = picker && picker.width > 0 ? picker : undefined;
    const detailBox = detail && detail.width > 0 ? detail : undefined;
    const maxViewportWidth = Math.max(120, viewportWidth - edge * 2);
    let width = Math.min(240, maxViewportWidth);
    if (pickerBox) {
        const rawWidth = pickerBox.width > 232
            ? Math.max(216, Math.min(Math.round(pickerBox.width - 24), Math.floor(pickerBox.width - 16)))
            : Math.max(120, Math.floor(pickerBox.width - 12));
        width = Math.min(rawWidth, maxViewportWidth);
    } else if (detailBox) {
        const rawWidth = detailBox.width > 232
            ? Math.max(216, Math.round(detailBox.width - 24))
            : Math.max(120, Math.floor(detailBox.width - 12));
        width = Math.min(rawWidth, maxViewportWidth);
    }
    let left = edge;
    if (detailBox) {
        if (pickerBox) {
            left = detailBox.left >= pickerBox.left
                ? Math.max(edge, detailBox.left - gap - width)
                : Math.min(viewportWidth - edge - width, detailBox.right + gap);
        } else {
            left = input.detailOnLeft
                ? Math.min(viewportWidth - edge - width, detailBox.right + gap)
                : Math.max(edge, detailBox.left - gap - width);
        }
    } else if (pickerBox) {
        left = pickerBox.left;
    }
    left = Math.max(edge, Math.min(left, viewportWidth - edge - width));
    const height = input.contentHeight > 0 ? input.contentHeight : minimumHeight;
    const levelTop = detailBox && detailBox.height > 0 ? detailBox.top : (pickerBox?.top ?? edge);
    const bar = trigger && trigger.height > 0 ? trigger : undefined;
    const top = Math.max(edge, Math.min(bar ? Math.max(levelTop, bar.bottom - height) : levelTop, viewportHeight - edge - height));
    return { left, top, width, maxHeight: Math.max(minimumHeight, viewportHeight - top - edge), side: detailBox && left > detailBox.left ? 'right' : 'left' };
}

export interface OfferingPriceCardProps {
    readonly locale: NextMuxDesktopLocale;
    readonly offering: PlatformOffering;
    readonly className?: string;
    /** The quote headings are toggles. Side by side the quotes are read row against row, so they open and close together. */
    readonly collapsible?: boolean;
    /**
     * In the hovered model detail drawer (Column 2), render a compact trigger bar at the bottom instead of an inline
     * price table; hovering or focusing that bar pulls out a secondary price drawer (.nmx-model-price-overlay-drawer)
     * directly over the model picker drawer (Column 1) with the exact same left and width.
     */
    readonly pullOutDrawer?: boolean;
    readonly hideMultiplier?: boolean;
    /** An own API pays the official price: that quote alone, in one column, with no multiplier and no relay price. */
    readonly officialOnly?: boolean;
}

/** Price card: 官方报价 | 倍率 | 中转商报价 side by side in three columns, one row per billed dimension. */
export function OfferingPriceCard(props: OfferingPriceCardProps): React.ReactElement {
    const { locale, offering, collapsible, pullOutDrawer, officialOnly } = props;
    const readExpanded = (): Record<PriceSection, boolean> => ({ official: offeringPriceSectionExpanded('official'), user: offeringPriceSectionExpanded('user') });
    const [expanded, setExpanded] = React.useState(readExpanded);
    const sectionId = React.useId();
    const triggerRef = React.useRef<HTMLDivElement>(null);
    const overlayRef = React.useRef<HTMLElement>(null);
    const closeTimerRef = React.useRef<number>();
    const [pullOutOpen, setPullOutOpen] = React.useState(false);
    const [overlayRect, setOverlayRect] = React.useState<{
        readonly left: number;
        readonly top: number;
        readonly width: number;
        readonly maxHeight: number;
        readonly zIndex: number;
        readonly side: 'left' | 'right';
    }>();
    const cancelPullOutClose = React.useCallback((): void => {
        if (closeTimerRef.current !== undefined) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = undefined;
        }
    }, []);
    const measureOverlayRect = React.useCallback((): void => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        const pickerCandidates = Array.from(
            document.querySelectorAll<HTMLElement>(
                '.nmx-model-picker-popover, .nmx-council-model-dropdown, [data-comic-model-panel], .nmx-comic-setup'
            )
        ).filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);
        let pickerEl: HTMLElement | undefined;
        let highestPickerZ = -Infinity;
        for (const candidate of pickerCandidates) {
            const z = Number.parseInt(window.getComputedStyle(candidate).zIndex, 10) || 0;
            if (z >= highestPickerZ) {
                highestPickerZ = z;
                pickerEl = candidate;
            }
        }
        const detailEl = triggerRef.current?.closest<HTMLElement>('.nmx-model-effort-menu:not(.nmx-model-price-overlay-drawer)');
        const { left, top, width, maxHeight, side } = placePriceOverlayDrawer({
            viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
            picker: pickerEl?.getBoundingClientRect(), detail: detailEl?.getBoundingClientRect(), trigger: triggerRef.current?.getBoundingClientRect(),
            detailOnLeft: Boolean(detailEl?.classList.contains('is-left')), contentHeight: overlayRef.current?.scrollHeight || 0
        });
        const detailZ = detailEl ? (Number.parseInt(window.getComputedStyle(detailEl).zIndex, 10) || 0) : 0;
        const zIndex = Math.max(2210, detailZ + 10);
        setOverlayRect(prev => prev
            && Math.abs(prev.left - left) < 1
            && Math.abs(prev.top - top) < 1
            && Math.abs(prev.width - width) < 1
            && Math.abs(prev.maxHeight - maxHeight) < 1
            && prev.zIndex === zIndex
            && prev.side === side
            ? prev
            : { left, top, width, maxHeight, zIndex, side });
    }, []);
    const openPullOut = React.useCallback((): void => {
        cancelPullOutClose();
        measureOverlayRect();
        setPullOutOpen(true);
    }, [cancelPullOutClose, measureOverlayRect]);
    const schedulePullOutClose = React.useCallback((): void => {
        cancelPullOutClose();
        closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = undefined;
            setPullOutOpen(false);
        }, 160);
    }, [cancelPullOutClose]);
    React.useEffect(() => () => cancelPullOutClose(), [cancelPullOutClose]);
    React.useEffect(() => {
        if (collapsible) setExpanded(readExpanded());
    }, [collapsible, offering.id, offering.keyPriceQuoteId]);
    React.useEffect(() => {
        if (pullOutDrawer) {
            cancelPullOutClose();
            setPullOutOpen(false);
        }
    }, [pullOutDrawer, offering.id, cancelPullOutClose]);
    const useLayoutEffectSafe = typeof window !== 'undefined' && React.useLayoutEffect ? React.useLayoutEffect : React.useEffect;
    useLayoutEffectSafe(() => {
        if (!pullOutDrawer || !pullOutOpen) return;
        measureOverlayRect();
        if (typeof window === 'undefined') return;
        const onResize = (): void => measureOverlayRect();
        window.addEventListener('resize', onResize);
        const observer = typeof ResizeObserver !== 'undefined' && overlayRef.current
            ? new ResizeObserver(() => measureOverlayRect())
            : undefined;
        if (observer && overlayRef.current) {
            observer.observe(overlayRef.current);
        }
        return () => {
            window.removeEventListener('resize', onResize);
            observer?.disconnect();
        };
    }, [pullOutDrawer, pullOutOpen, offering.id, offering.keyPriceQuoteId, measureOverlayRect]);
    const open = !collapsible || expanded.official || expanded.user;
    const official: PriceLike = offeringOfficialPrice(offering);
    const user = offering.price as PriceLike;
    const bps = offeringMultiplierBps(offering);
    if (pullOutDrawer) {
        const rateBadge: string | undefined = undefined;
        const summaryLabel = officialOnly
            ? offeringPriceText(locale, 'official')
            : bps !== null
                ? `${offeringPriceText(locale, 'relay')} ${offeringMultiplierText(locale, bps)}x`
                : `${offeringPriceText(locale, 'relay')} · ${offeringPriceText(locale, 'ownTag')}`;
        const portalHost = triggerRef.current?.closest('.nmx-model-effort-portal') || (typeof document !== 'undefined' ? document.body : null);
        return <div ref={triggerRef}
            className={`nmx-offering-price is-pullout-trigger${props.className ? ` ${props.className}` : ''}${officialOnly ? ' is-official-only' : ''}${pullOutOpen ? ' is-open' : ''}`}
            data-price-mode={bps === null ? 'direct' : 'multiplier'}
            onPointerEnter={openPullOut}
            onPointerLeave={schedulePullOutClose}>
            <button type='button'
                className={`nmx-model-price-drawer-trigger${pullOutOpen ? ' is-active' : ''}`}
                aria-expanded={pullOutOpen}
                aria-haspopup='dialog'
                onFocus={openPullOut}
                onBlur={schedulePullOutClose}
                onClick={event => {
                    event.stopPropagation();
                    if (pullOutOpen) {
                        cancelPullOutClose();
                        setPullOutOpen(false);
                    } else {
                        openPullOut();
                    }
                }}>
                <span className='nmx-model-price-drawer-trigger-lead'>
                    <span className='nmx-price-section-badge' aria-hidden='true'><i className='codicon codicon-tag' /></span>
                    <span className='nmx-model-price-drawer-trigger-title'>{summaryLabel}</span>
                </span>
                <span className='nmx-model-price-drawer-trigger-trail'>
                    {rateBadge && <strong className='nmx-model-price-drawer-trigger-rate' dir='ltr'>{rateBadge}</strong>}
                    <span className='nmx-price-section-chevron' aria-hidden='true'><i className={`codicon codicon-chevron-${overlayRect?.side === 'right' ? 'right' : 'left'}`} /></span>
                </span>
            </button>
            {pullOutOpen && overlayRect && portalHost && ReactDOM.createPortal(
                <section ref={overlayRef}
                    className={`nmx-model-effort-menu nmx-model-evidence-menu nmx-model-price-overlay-drawer is-${overlayRect.side}`}
                    data-compact={overlayRect.width < 216 || undefined}
                    aria-label={summaryLabel}
                    style={{
                        position: 'fixed',
                        top: `${overlayRect.top}px`,
                        left: `${overlayRect.left}px`,
                        width: `${overlayRect.width}px`,
                        maxHeight: `${overlayRect.maxHeight}px`,
                        zIndex: overlayRect.zIndex
                    }}
                    onPointerEnter={cancelPullOutClose}
                    onPointerLeave={schedulePullOutClose}
                    onFocus={cancelPullOutClose}
                    onBlur={schedulePullOutClose}>
                    <OfferingPriceCard locale={locale} offering={offering} officialOnly={officialOnly} />
                </section>,
                portalHost
            )}
        </div>;
    }
    const currency = offering.price?.currency || 'USD';
    // Multi-tier image/video prices (quality × size, resolution × audio); invalid data is not shown.
    const mediaTiers = normalizeOfferingMediaTiers((offering.price as typeof offering.price & { readonly mediaTiers?: unknown } | undefined)?.mediaTiers);
    const tierHasOfficial = Boolean(mediaTiers?.tiers.some(tier => tier.officialMicros !== null));
    // Official image sheets bill the text prompt per input token on top of the per-image tier.
    const tierInputRates = mediaTiers?.kind === 'image' ? mediaTierInputRates({ price: offering.price, officialPrice: offering.officialPrice,
        mediaTiers, multiplierBps: bps, direct: offeringIsOwnPriced(offering) }) : undefined;
    // An own API pays the official token fees; a relay its own.
    const addonRates = officialOnly ? tierInputRates?.official : tierInputRates;
    const addonVisible = Boolean(addonRates && [addonRates.promptPerMillionMicros, addonRates.cachedPromptPerMillionMicros,
        addonRates.imageInputPerMillionMicros, addonRates.textOutputPerMillionMicros].some(value => value !== undefined));
    // The output label follows what the official sheet bills: text, or text and thinking (Gemini).
    const tierOutputLabel = offeringPriceText(locale, tierInputRates?.textOutputModality === 'text_thinking' ? 'textThinkingOutput' : 'textOutput');
    // A video API format that sends no resolution bills every request at one tier (Veo's 720p default on the Gemini format).
    const fixedTier = mediaTiers?.requestTier === 'fixed' ? mediaTiers.tiers.find(tier => tier.id === mediaTiers.billedTierId) : undefined;
    const markedTierId = fixedTier?.id ?? mediaTiers?.defaultTierId;
    // One tier still says what a picture is made at (only 1K, say) and carries its token fees; a bare flat price does not.
    const singleTier = mediaTiers?.tiers.length === 1 ? mediaTiers.tiers[0] : undefined;
    // Official-only tiers need official tier prices; a table of relay prices alone is not that API's price.
    const showTiers = Boolean(mediaTiers && (!officialOnly || tierHasOfficial) && (mediaTiers.tiers.length > 1 || addonVisible || fixedTier
        || singleTier && (singleTier.quality || singleTier.size || singleTier.resolution)));
    const tierAddonTitle = !officialOnly && tierInputRates && mediaTiers ? (() => {
        const officialRates = tierInputRates.official;
        const parts = [
            officialRates.promptPerMillionMicros === undefined ? '' : `${offeringPriceText(locale, 'input')} ${formatPriceMicros(locale, officialRates.promptPerMillionMicros, mediaTiers.currency)}`,
            officialRates.cachedPromptPerMillionMicros === undefined ? '' : `${offeringPriceText(locale, 'cacheRead')} ${formatPriceMicros(locale, officialRates.cachedPromptPerMillionMicros, mediaTiers.currency)}`,
            officialRates.textOutputPerMillionMicros === undefined ? '' : `${tierOutputLabel} ${formatPriceMicros(locale, officialRates.textOutputPerMillionMicros, mediaTiers.currency)}`
        ].filter(Boolean);
        return parts.length ? `${offeringPriceText(locale, 'official')} ${parts.join(' · ')} / ${unitText(locale, 'mtok')}` : undefined;
    })() : undefined;
    const qualityKey: Record<OfferingMediaTierQuality, OfferingPriceTextKey> = { low: 'qualityLow', medium: 'qualityMedium', high: 'qualityHigh', standard: 'qualityStandard', hd: 'qualityHd' };
    const tierLabelText = { quality: (quality: OfferingMediaTierQuality) => offeringPriceText(locale, qualityKey[quality]), audio: (withAudio: boolean) => offeringPriceText(locale, withAudio ? 'audioOn' : 'audioOff') };
    // Every dimension either side prices (an own API: the official sheet), so a missing official rate reads "-" instead of disappearing.
    const rows = OFFERING_PRICE_FIELDS.filter(([, field]) => finite(official?.[field]) || !officialOnly && finite(user?.[field]));
    // Notes span the columns once, under them, so the rows of the two quotes stay level.
    const notes = [bps === null && !officialOnly ? offeringPriceText(locale, 'own') : undefined].filter((note): note is string => Boolean(note));
    const audiences: readonly PriceSection[] = officialOnly ? ['official'] : ['official', 'user'];
    const bodyIds = audiences.map(audience => `${sectionId}-${audience}`).join(' ');
    const toggle = (event: React.MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        setOfferingPriceExpanded(!open);
        setExpanded(readExpanded());
    };
    const block = (audience: PriceSection, source: PriceLike): React.ReactNode => {
        const heading = <>
            <span className='nmx-price-section-badge' aria-hidden='true'><i className={`codicon codicon-${audience === 'official' ? 'workspace-trusted' : 'arrow-swap'}`} /></span>
            <span className='nmx-price-section-title'>{offeringPriceText(locale, audience === 'official' ? 'official' : 'relay')}</span>
        </>;
        return <section className='nmx-offering-price-block nmx-price-section' data-price-audience={audience}>
            {collapsible ? <button type='button' className='nmx-price-section-toggle' aria-expanded={open} aria-controls={open ? bodyIds : undefined} onClick={toggle}>
                {heading}<span className='nmx-price-section-chevron' aria-hidden='true'><i className='codicon codicon-chevron-down' /></span></button>
                : <h4 className='nmx-price-section-heading'>{heading}</h4>}
            {open && <div className='nmx-price-section-body' id={`${sectionId}-${audience}`}>
                <dl>{rows.map(([metric, field, unit]) => {
                    const value = source?.[field];
                    return <div key={metric}><dt>{offeringPriceText(locale, metric)}</dt>
                        <dd dir='ltr'>{finite(value) ? formatPriceMicros(locale, value, currency) : 'US$-'}<small> / {unitText(locale, unit)}</small></dd></div>;
                })}</dl>
            </div>}
        </section>;
    };
    return <div className={`nmx-offering-price${props.className ? ` ${props.className}` : ''}${officialOnly ? ' is-official-only' : ''}${collapsible ? ` is-collapsible ${open ? 'is-expanded' : 'is-collapsed'}` : ''}`} data-price-mode={bps === null ? 'direct' : 'multiplier'}>
        <div className={`nmx-offering-price-columns${officialOnly ? ' is-single' : ''}`}>
            {block('official', official)}
            {!officialOnly && <div className='nmx-offering-price-multiplier nmx-offering-price-multiplier-column' data-price-audience='multiplier'>
                <span className='nmx-offering-price-multiplier-label'>{offeringPriceText(locale, 'multiplierShort')}</span>
                <strong className='nmx-offering-price-multiplier-value' dir='ltr'>{bps === null ? offeringPriceText(locale, 'none') : `${offeringMultiplierText(locale, bps)}x`}</strong>
            </div>}
            {!officialOnly && block('user', user)}
        </div>
        {open && notes.length > 0 && <div className='nmx-offering-price-notes'>{notes.map(note => <p key={note} className='nmx-offering-price-note'>{note}</p>)}</div>}
        {mediaTiers && showTiers && <section className='nmx-offering-price-block nmx-media-tiers' data-media-tier-kind={mediaTiers.kind}>
            <h4>{offeringPriceText(locale, 'tierTitle')}<small> / {unitText(locale, mediaTiers.unit)}</small></h4>
            <table className='nmx-media-tier-table'>
                <thead><tr><th scope='col'>{offeringPriceText(locale, 'tierColumn')}</th>
                    {tierHasOfficial && <th scope='col'>{offeringPriceText(locale, 'official')}</th>}
                    {!officialOnly && <th scope='col'>{offeringPriceText(locale, 'relay')}</th>}</tr></thead>
                <tbody>{mediaTiers.tiers.map(tier => <tr key={tier.id} className={tier.id === markedTierId ? 'is-default' : undefined}>
                    <th scope='row'><span data-nmx-literal>{mediaTierLabel(tier, tierLabelText)}</span>
                        {tier.id === markedTierId && <em>{offeringPriceText(locale, fixedTier ? 'billedTier' : 'defaultTier')}</em>}</th>
                    {tierHasOfficial && <td dir='ltr'>{tier.officialMicros === null ? '—' : formatPriceMicros(locale, tier.officialMicros, mediaTiers.currency)}</td>}
                    {!officialOnly && <td dir='ltr'>{formatPriceMicros(locale, tier.customerMicros, mediaTiers.currency)}</td>}
                </tr>)}</tbody>
            </table>
            {fixedTier && <p className='nmx-media-tier-note'>{offeringPriceText(locale, 'fixedTierNote', { tier: mediaTierLabel(fixedTier, tierLabelText) })}</p>}
            {addonRates && addonVisible && <p className='nmx-media-tier-addon' title={tierAddonTitle}>
                <span>{offeringPriceText(locale, addonRates.promptPerMillionMicros !== undefined ? 'tierInputAddon' : 'tierTokenAddon')}</span>
                {addonRates.promptPerMillionMicros !== undefined && <>
                    <b dir='ltr'>+{formatPriceMicros(locale, addonRates.promptPerMillionMicros, mediaTiers.currency)}</b>
                    <small>/ {unitText(locale, 'mtok')}</small>
                </>}
                {addonRates.cachedPromptPerMillionMicros !== undefined && <em>{offeringPriceText(locale, 'cacheRead')} <b dir='ltr'>{formatPriceMicros(locale, addonRates.cachedPromptPerMillionMicros, mediaTiers.currency)}</b></em>}
                {addonRates.imageInputPerMillionMicros !== undefined && <em>{offeringPriceText(locale, 'imageInput')} <b dir='ltr'>{formatPriceMicros(locale, addonRates.imageInputPerMillionMicros, mediaTiers.currency)}</b></em>}
                {addonRates.textOutputPerMillionMicros !== undefined && <em className='is-output'>{tierOutputLabel} <b dir='ltr'>{formatPriceMicros(locale, addonRates.textOutputPerMillionMicros, mediaTiers.currency)}</b>
                    {addonRates.promptPerMillionMicros === undefined && <small> / {unitText(locale, 'mtok')}</small>}</em>}
            </p>}
        </section>}
    </div>;
}

/** 平均倍率 of a merchant: the mean multiplier of its multiplier-priced offerings (model × API); undefined when none. */
export function averageMultiplierBps(values: readonly (number | null | undefined)[]): number | undefined {
    const priced = values.filter(finite);
    return priced.length ? Math.round(priced.reduce((sum, value) => sum + value, 0) / priced.length) : undefined;
}

/**
 * Shows the price card beside `children` while it is hovered or focused. The card lives in a portal on
 * document.body, so scrolling lists and dialogs never clip it; it opens to the right, or to the left near the edge.
 */
export function OfferingPriceHover(props: {
    readonly locale: NextMuxDesktopLocale; readonly offering?: PlatformOffering; readonly themeClass?: string; readonly children: React.ReactElement;
}): React.ReactElement {
    const [anchor, setAnchor] = React.useState<DOMRect>();
    const card = React.useRef<HTMLDivElement>(null);
    const [size, setSize] = React.useState<{ width: number; height: number }>();
    React.useLayoutEffect(() => {
        if (!anchor || !card.current) return;
        const rect = card.current.getBoundingClientRect();
        if (!size || Math.abs(size.width - rect.width) > 1 || Math.abs(size.height - rect.height) > 1) setSize({ width: rect.width, height: rect.height });
    }, [anchor, size]);
    if (!props.offering) return props.children;
    const child = props.children as React.ReactElement<{ onPointerEnter?: (event: React.PointerEvent<HTMLElement>) => void; onPointerLeave?: (event: React.PointerEvent<HTMLElement>) => void;
        onFocus?: (event: React.FocusEvent<HTMLElement>) => void; onBlur?: (event: React.FocusEvent<HTMLElement>) => void }>;
    const open = (target: HTMLElement): void => setAnchor(target.getBoundingClientRect());
    const trigger = React.cloneElement(child, {
        onPointerEnter: event => { child.props.onPointerEnter?.(event); open(event.currentTarget); },
        onPointerLeave: event => { child.props.onPointerLeave?.(event); setAnchor(undefined); },
        onFocus: event => { child.props.onFocus?.(event); open(event.currentTarget); },
        onBlur: event => { child.props.onBlur?.(event); setAnchor(undefined); },
    });
    if (!anchor) return trigger;
    const width = size?.width ?? 280, height = size?.height ?? 240, gap = 8;
    const rtl = props.locale === 'ar';
    const fitsRight = anchor.right + gap + width <= window.innerWidth - 8;
    const fitsLeft = anchor.left - gap - width >= 8;
    const left = (rtl ? !fitsLeft && fitsRight : fitsRight || !fitsLeft) ? Math.min(anchor.right + gap, window.innerWidth - width - 8) : Math.max(8, anchor.left - gap - width);
    const top = Math.max(8, Math.min(anchor.top, window.innerHeight - height - 8));
    return <>{trigger}{ReactDOM.createPortal(<div ref={card} className={`nmx-offering-price-pop${props.themeClass ? ` ${props.themeClass}` : ''}`} role='tooltip'
        dir={rtl ? 'rtl' : 'ltr'} lang={props.locale} style={{ left: `${left}px`, top: `${top}px`, visibility: size ? 'visible' : 'hidden' }}>
        <OfferingPriceCard locale={props.locale} offering={props.offering} />
    </div>, document.body)}</>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function offeringPriceText(locale: Parameters<typeof uncheckedOfferingPriceText>[0], key: Parameters<typeof uncheckedOfferingPriceText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedOfferingPriceText>>): string {
    return totalCopy(locale, key, language => uncheckedOfferingPriceText(language, key, ...rest));
}
