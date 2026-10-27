import type { NextMuxDesktopLocale } from './nextmux-locale';

const copy: Readonly<Record<NextMuxDesktopLocale, readonly [string, string, string]>> = {
    en: ['Speech to text', 'Upload this audio and charge my balance at the displayed rate', 'Choose local recognition or a relay for speech to text. Relays charge per use.'],
    'zh-CN': ['语音转文字', '上传此音频，并按显示的单价从余额扣费', '语音转文字可选本机识别或中转商。中转商按需扣费。'],
    'zh-TW': ['語音轉文字', '上傳此音訊，並按顯示的單價從餘額扣款', '語音轉文字可選本機辨識或中轉商。中轉商按需扣費。'],
    ja: ['文字起こし', 'この音声をアップロードし、表示料金で残高から支払う', '文字起こしはローカル認識または中継業者を選べます。中継業者は使った分だけ課金されます。'],
    ko: ['음성 인식', '이 오디오를 업로드하고 표시된 요금으로 잔액에서 결제', '음성 인식은 로컬 또는 중계사를 선택할 수 있습니다. 중계사는 사용한 만큼 과금됩니다.'],
    es: ['Voz a texto', 'Subir este audio y cobrar mi saldo a la tarifa indicada', 'Elige reconocimiento local o un proveedor. Los proveedores cobran por uso.'],
    fr: ['Parole en texte', 'Envoyer cet audio et débiter mon solde au tarif affiché', 'Choisissez la reconnaissance locale ou un fournisseur. Les fournisseurs facturent à l’usage.'],
    de: ['Sprache zu Text', 'Diese Audiodatei hochladen und zum angezeigten Tarif vom Guthaben bezahlen', 'Lokale Erkennung oder Anbieter wählen. Anbieter rechnen nach Nutzung ab.'],
    'pt-BR': ['Fala para texto', 'Enviar este áudio e cobrar do meu saldo pela tarifa exibida', 'Escolha reconhecimento local ou um fornecedor. Fornecedores cobram por uso.'],
    ru: ['Речь в текст', 'Загрузить это аудио и оплатить с баланса по указанному тарифу', 'Выберите локальное распознавание или поставщика. Поставщики списывают оплату по факту использования.'],
    ar: ['تحويل الكلام إلى نص', 'رفع هذا الصوت وخصم التكلفة من رصيدي بالسعر المعروض', 'اختر التعرف المحلي أو مزوّدًا. يخصم المزوّد التكلفة حسب الاستخدام.'],
    hi: ['स्पीच-टू-टेक्स्ट', 'यह ऑडियो अपलोड करें और दिखाई गई दर पर मेरे बैलेंस से भुगतान करें', 'स्थानीय पहचान या रिले चुनें। रिले उपयोग के अनुसार शुल्क लेता है।']
};

export function transcriptionText(locale: NextMuxDesktopLocale, key: 'label' | 'consent' | 'hint'): string {
    return (copy[locale] || copy.en)[key === 'label' ? 0 : key === 'consent' ? 1 : 2];
}
