import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Copy for the media budget: what the canvas and the comic desk say before they start paid work (a cost summary)
 * and when the NextMux balance cannot cover it.
 */
type Key = 'shortfall' | 'shortfallHeld' | 'shortfallPlatform' | 'topUp' | 'pendingShots' | 'setPlates' | 'openingFrames' | 'clips'
    | 'startFrame' | 'video' | 'picture' | 'translation' | 'times' | 'seconds' | 'total' | 'available' | 'short' | 'reused' | 'ownApi' | 'note';

const en: Readonly<Record<Key, string>> = {
    shortfall: 'Not enough balance: this needs about {needed}, and {available} is available.',
    shortfallHeld: 'Not enough balance: this needs about {needed}, and {available} is left after {held} set aside for work in progress.',
    shortfallPlatform: 'Your NextMux balance is too low to start this. Add funds and try again.',
    topUp: 'Add funds', pendingShots: '{n} shots to film', setPlates: 'Set plates', openingFrames: 'Opening frames', clips: 'Clips',
    startFrame: 'Opening frame', video: 'Video', picture: 'Picture', translation: 'Prompt translation', times: '× {n}', seconds: '{n} s',
    total: 'Estimated total', available: 'Available balance', short: '{amount} short', reused: 'Reused', ownApi: 'Billed by your own API',
    note: 'An estimate: each request is charged for what it actually uses.'
};

const copy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    en,
    'zh-CN': {
        shortfall: '余额不足：本次预计需要 {needed}，当前可用 {available}。',
        shortfallHeld: '余额不足：本次预计需要 {needed}，已为进行中的任务预留 {held}，剩余可用 {available}。',
        shortfallPlatform: 'NextMux 余额不足，无法开始。请充值后再试。',
        topUp: '充值', pendingShots: '待拍摄 {n} 个镜头', setPlates: '场景定妆', openingFrames: '首帧', clips: '视频片段',
        startFrame: '首帧', video: '视频', picture: '图片', translation: '提示词翻译', times: '× {n}', seconds: '{n} 秒',
        total: '预计合计', available: '可用余额', short: '还差 {amount}', reused: '复用已有', ownApi: '由你的自有 API 计费',
        note: '以上为预估，每次请求按实际用量扣费。'
    },
    'zh-TW': {
        shortfall: '餘額不足：本次預計需要 {needed}，目前可用 {available}。',
        shortfallHeld: '餘額不足：本次預計需要 {needed}，已為進行中的任務預留 {held}，剩餘可用 {available}。',
        shortfallPlatform: 'NextMux 餘額不足，無法開始。請儲值後再試。',
        topUp: '儲值', pendingShots: '待拍攝 {n} 個鏡頭', setPlates: '場景定妝', openingFrames: '首幀', clips: '影片片段',
        startFrame: '首幀', video: '影片', picture: '圖片', translation: '提示詞翻譯', times: '× {n}', seconds: '{n} 秒',
        total: '預計合計', available: '可用餘額', short: '還差 {amount}', reused: '沿用既有', ownApi: '由你的自有 API 計費',
        note: '以上為預估，每次請求依實際用量扣費。'
    },
    ja: {
        shortfall: '残高が不足しています：今回の見込みは {needed}、利用可能額は {available} です。',
        shortfallHeld: '残高が不足しています：今回の見込みは {needed}。進行中のタスク用に {held} を確保しているため、残りは {available} です。',
        shortfallPlatform: 'NextMux の残高が不足しているため開始できません。チャージしてからもう一度お試しください。',
        topUp: 'チャージ', pendingShots: '撮影待ち {n} カット', setPlates: '背景プレート', openingFrames: '開始フレーム', clips: '動画クリップ',
        startFrame: '開始フレーム', video: '動画', picture: '画像', translation: 'プロンプト翻訳', times: '× {n}', seconds: '{n} 秒',
        total: '見込み合計', available: '利用可能残高', short: '{amount} 不足', reused: '既存を再利用', ownApi: 'ご自身の API で課金',
        note: '見込み額です。各リクエストは実際の使用量で課金されます。'
    },
    ko: {
        shortfall: '잔액이 부족합니다: 예상 비용은 {needed}이고 사용 가능한 금액은 {available}입니다.',
        shortfallHeld: '잔액이 부족합니다: 예상 비용은 {needed}이며, 진행 중인 작업에 {held}를 확보해 두어 남은 금액은 {available}입니다.',
        shortfallPlatform: 'NextMux 잔액이 부족해 시작할 수 없습니다. 충전한 뒤 다시 시도하세요.',
        topUp: '충전', pendingShots: '촬영 대기 {n}컷', setPlates: '배경 플레이트', openingFrames: '시작 프레임', clips: '동영상 클립',
        startFrame: '시작 프레임', video: '동영상', picture: '이미지', translation: '프롬프트 번역', times: '× {n}', seconds: '{n}초',
        total: '예상 합계', available: '사용 가능 잔액', short: '{amount} 부족', reused: '기존 항목 재사용', ownApi: '내 API로 과금',
        note: '예상 금액입니다. 각 요청은 실제 사용량만큼 과금됩니다.'
    },
    es: {
        shortfall: 'Saldo insuficiente: esto requiere unos {needed} y hay {available} disponibles.',
        shortfallHeld: 'Saldo insuficiente: esto requiere unos {needed} y quedan {available} tras reservar {held} para el trabajo en curso.',
        shortfallPlatform: 'Tu saldo de NextMux no alcanza para empezar. Añade fondos e inténtalo de nuevo.',
        topUp: 'Añadir fondos', pendingShots: '{n} planos por rodar', setPlates: 'Fondos de escena', openingFrames: 'Fotogramas iniciales', clips: 'Clips',
        startFrame: 'Fotograma inicial', video: 'Vídeo', picture: 'Imagen', translation: 'Traducción del prompt', times: '× {n}', seconds: '{n} s',
        total: 'Total estimado', available: 'Saldo disponible', short: 'Faltan {amount}', reused: 'Reutilizado', ownApi: 'Lo cobra tu propia API',
        note: 'Es una estimación: cada solicitud se cobra según su uso real.'
    },
    fr: {
        shortfall: 'Solde insuffisant : cela nécessite environ {needed}, et {available} est disponible.',
        shortfallHeld: 'Solde insuffisant : cela nécessite environ {needed}, et il reste {available} après {held} réservés pour les tâches en cours.',
        shortfallPlatform: 'Votre solde NextMux est trop bas pour commencer. Ajoutez des fonds et réessayez.',
        topUp: 'Ajouter des fonds', pendingShots: '{n} plans à tourner', setPlates: 'Décors', openingFrames: 'Premières images', clips: 'Clips',
        startFrame: 'Première image', video: 'Vidéo', picture: 'Image', translation: 'Traduction du prompt', times: '× {n}', seconds: '{n} s',
        total: 'Total estimé', available: 'Solde disponible', short: 'Il manque {amount}', reused: 'Réutilisée', ownApi: 'Facturé par votre propre API',
        note: 'Estimation : chaque requête est facturée selon son usage réel.'
    },
    de: {
        shortfall: 'Guthaben reicht nicht: Benötigt werden etwa {needed}, verfügbar sind {available}.',
        shortfallHeld: 'Guthaben reicht nicht: Benötigt werden etwa {needed}; nach {held} Reserve für laufende Aufgaben bleiben {available}.',
        shortfallPlatform: 'Ihr NextMux-Guthaben reicht nicht, um zu starten. Laden Sie Guthaben auf und versuchen Sie es erneut.',
        topUp: 'Guthaben aufladen', pendingShots: '{n} Einstellungen zu drehen', setPlates: 'Szenenhintergründe', openingFrames: 'Startbilder', clips: 'Clips',
        startFrame: 'Startbild', video: 'Video', picture: 'Bild', translation: 'Prompt-Übersetzung', times: '× {n}', seconds: '{n} s',
        total: 'Geschätzte Summe', available: 'Verfügbares Guthaben', short: 'Es fehlen {amount}', reused: 'Wiederverwendet', ownApi: 'Über Ihre eigene API abgerechnet',
        note: 'Eine Schätzung: Jede Anfrage wird nach tatsächlicher Nutzung abgerechnet.'
    },
    'pt-BR': {
        shortfall: 'Saldo insuficiente: isto precisa de cerca de {needed}, e há {available} disponíveis.',
        shortfallHeld: 'Saldo insuficiente: isto precisa de cerca de {needed}, e restam {available} após reservar {held} para o trabalho em andamento.',
        shortfallPlatform: 'Seu saldo NextMux não é suficiente para começar. Adicione fundos e tente novamente.',
        topUp: 'Adicionar fundos', pendingShots: '{n} planos para filmar', setPlates: 'Cenários', openingFrames: 'Quadros iniciais', clips: 'Clipes',
        startFrame: 'Quadro inicial', video: 'Vídeo', picture: 'Imagem', translation: 'Tradução do prompt', times: '× {n}', seconds: '{n} s',
        total: 'Total estimado', available: 'Saldo disponível', short: 'Faltam {amount}', reused: 'Reaproveitado', ownApi: 'Cobrado pela sua própria API',
        note: 'Estimativa: cada solicitação é cobrada pelo uso real.'
    },
    ru: {
        shortfall: 'Недостаточно средств: нужно около {needed}, доступно {available}.',
        shortfallHeld: 'Недостаточно средств: нужно около {needed}; после резерва {held} для текущих задач доступно {available}.',
        shortfallPlatform: 'Баланса NextMux недостаточно, чтобы начать. Пополните баланс и попробуйте снова.',
        topUp: 'Пополнить', pendingShots: 'Осталось снять планов: {n}', setPlates: 'Фоны сцен', openingFrames: 'Первые кадры', clips: 'Клипы',
        startFrame: 'Первый кадр', video: 'Видео', picture: 'Изображение', translation: 'Перевод промпта', times: '× {n}', seconds: '{n} с',
        total: 'Итого по оценке', available: 'Доступный баланс', short: 'Не хватает {amount}', reused: 'Использован готовый', ownApi: 'Оплачивается вашим API',
        note: 'Это оценка: каждый запрос оплачивается по фактическому использованию.'
    },
    ar: {
        shortfall: 'الرصيد غير كافٍ: يحتاج هذا إلى نحو {needed}، والمتاح {available}.',
        shortfallHeld: 'الرصيد غير كافٍ: يحتاج هذا إلى نحو {needed}، ويتبقى {available} بعد حجز {held} للمهام الجارية.',
        shortfallPlatform: 'رصيد NextMux لا يكفي للبدء. اشحن الرصيد ثم حاول مرة أخرى.',
        topUp: 'شحن الرصيد', pendingShots: '{n} لقطات بانتظار التصوير', setPlates: 'خلفيات المشاهد', openingFrames: 'الإطارات الأولى', clips: 'المقاطع',
        startFrame: 'الإطار الأول', video: 'فيديو', picture: 'صورة', translation: 'ترجمة الموجّه', times: '× {n}', seconds: '{n} ث',
        total: 'الإجمالي التقديري', available: 'الرصيد المتاح', short: 'ينقص {amount}', reused: 'مُعاد استخدامه', ownApi: 'تحاسبه واجهتك البرمجية الخاصة',
        note: 'هذا تقدير: تُحتسب كل عملية حسب الاستخدام الفعلي.'
    },
    hi: {
        shortfall: 'बैलेंस कम है: इसके लिए लगभग {needed} चाहिए, और {available} उपलब्ध है।',
        shortfallHeld: 'बैलेंस कम है: इसके लिए लगभग {needed} चाहिए; चल रहे कामों के लिए {held} अलग रखने के बाद {available} बचा है।',
        shortfallPlatform: 'NextMux बैलेंस शुरू करने के लिए कम है। राशि जोड़ें और फिर से कोशिश करें।',
        topUp: 'राशि जोड़ें', pendingShots: 'शूट करने को {n} शॉट', setPlates: 'दृश्य पृष्ठभूमि', openingFrames: 'शुरुआती फ़्रेम', clips: 'क्लिप',
        startFrame: 'शुरुआती फ़्रेम', video: 'वीडियो', picture: 'चित्र', translation: 'प्रॉम्प्ट अनुवाद', times: '× {n}', seconds: '{n} से.',
        total: 'अनुमानित कुल', available: 'उपलब्ध बैलेंस', short: '{amount} कम', reused: 'पहले वाला उपयोग', ownApi: 'आपकी अपनी API से बिल',
        note: 'यह अनुमान है: हर अनुरोध का शुल्क असल उपयोग के हिसाब से लगता है।'
    }
};

export function mediaBudgetText(locale: NextMuxDesktopLocale, key: Key, values: Readonly<Record<string, string | number>> = {}): string {
    const template = (copy[locale] || en)[key] || en[key];
    return template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}

export const mediaBudgetLocales = Object.keys(copy) as readonly NextMuxDesktopLocale[];
