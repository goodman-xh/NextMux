import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const en = {
    settingTitle: 'Open web links', settingBody: 'Choose where links in conversations open.', defaultBrowser: 'Built-in browser (default)',
    systemBrowser: 'System browser', builtinBrowser: 'Built-in browser', dialogTitle: 'Open this link?',
    dialogBody: 'Choose where to open this web link.', remember: 'Remember my choice', cancel: 'Cancel',
    blockedTitle: 'Link was not opened', blockedBody: 'This link type is not supported or is unsafe.'
};

type LinkOpeningTextKey = keyof typeof en;
type Translation = Partial<Record<LinkOpeningTextKey, string>>;

const translations: Record<NextMuxDesktopLocale, Translation> = {
    en,
    'zh-CN': { settingTitle: '网页链接打开方式', settingBody: '选择对话中的网页链接使用哪个浏览器打开。', defaultBrowser: '默认使用内置浏览器', systemBrowser: '使用系统浏览器', builtinBrowser: '使用内置浏览器', dialogTitle: '打开这个链接？', dialogBody: '请选择网页链接的打开方式。', remember: '记住我的选择', cancel: '取消', blockedTitle: '链接未打开', blockedBody: '该链接类型不受支持或存在安全风险。' },
    'zh-TW': { settingTitle: '網頁連結開啟方式', settingBody: '選擇對話中的網頁連結使用哪個瀏覽器開啟。', defaultBrowser: '預設使用內建瀏覽器', systemBrowser: '使用系統瀏覽器', builtinBrowser: '使用內建瀏覽器', dialogTitle: '開啟此連結？', dialogBody: '請選擇網頁連結的開啟方式。', remember: '記住我的選擇', cancel: '取消', blockedTitle: '連結未開啟', blockedBody: '此連結類型不受支援或不安全。' },
    ja: { settingTitle: 'Web リンクの開き方', settingBody: '会話内のリンクを開くブラウザーを選択します。', defaultBrowser: 'デフォルトで内蔵ブラウザー', systemBrowser: 'システムブラウザー', builtinBrowser: '内蔵ブラウザー', dialogTitle: 'このリンクを開きますか？', dialogBody: 'リンクを開く場所を選択してください。', remember: '選択を記憶', cancel: 'キャンセル', blockedTitle: 'リンクを開けませんでした', blockedBody: '未対応または安全でないリンクです。' },
    ko: { settingTitle: '웹 링크 열기', settingBody: '대화 링크를 열 브라우저를 선택합니다.', defaultBrowser: '기본값: 내장 브라우저', systemBrowser: '시스템 브라우저', builtinBrowser: '내장 브라우저', dialogTitle: '이 링크를 여시겠습니까?', dialogBody: '링크를 열 위치를 선택하세요.', remember: '선택 기억', cancel: '취소', blockedTitle: '링크를 열지 못했습니다', blockedBody: '지원하지 않거나 안전하지 않은 링크입니다.' },
    es: { settingTitle: 'Abrir enlaces web', settingBody: 'Elige dónde abrir los enlaces de las conversaciones.', defaultBrowser: 'Navegador integrado (predeterminado)', systemBrowser: 'Navegador del sistema', builtinBrowser: 'Navegador integrado', dialogTitle: '¿Abrir este enlace?', dialogBody: 'Elige dónde abrir este enlace web.', remember: 'Recordar mi elección', cancel: 'Cancelar', blockedTitle: 'No se abrió el enlace', blockedBody: 'El tipo de enlace no es compatible o no es seguro.' },
    fr: { settingTitle: 'Ouvrir les liens web', settingBody: 'Choisissez où ouvrir les liens des conversations.', defaultBrowser: 'Navigateur intégré (par défaut)', systemBrowser: 'Navigateur système', builtinBrowser: 'Navigateur intégré', dialogTitle: 'Ouvrir ce lien ?', dialogBody: 'Choisissez où ouvrir ce lien web.', remember: 'Mémoriser mon choix', cancel: 'Annuler', blockedTitle: 'Lien non ouvert', blockedBody: 'Ce type de lien est non pris en charge ou dangereux.' },
    de: { settingTitle: 'Weblinks öffnen', settingBody: 'Wählen Sie den Browser für Links in Unterhaltungen.', defaultBrowser: 'Integrierter Browser (Standard)', systemBrowser: 'Systembrowser', builtinBrowser: 'Integrierter Browser', dialogTitle: 'Diesen Link öffnen?', dialogBody: 'Wählen Sie, wo dieser Weblink geöffnet wird.', remember: 'Auswahl merken', cancel: 'Abbrechen', blockedTitle: 'Link nicht geöffnet', blockedBody: 'Dieser Linktyp wird nicht unterstützt oder ist unsicher.' },
    'pt-BR': { settingTitle: 'Abrir links da web', settingBody: 'Escolha onde abrir links das conversas.', defaultBrowser: 'Navegador integrado (padrão)', systemBrowser: 'Navegador do sistema', builtinBrowser: 'Navegador integrado', dialogTitle: 'Abrir este link?', dialogBody: 'Escolha onde abrir este link da web.', remember: 'Lembrar minha escolha', cancel: 'Cancelar', blockedTitle: 'Link não aberto', blockedBody: 'Este tipo de link não é compatível ou não é seguro.' },
    ru: { settingTitle: 'Открытие веб-ссылок', settingBody: 'Выберите браузер для ссылок в диалогах.', defaultBrowser: 'Встроенный браузер (по умолчанию)', systemBrowser: 'Системный браузер', builtinBrowser: 'Встроенный браузер', dialogTitle: 'Открыть ссылку?', dialogBody: 'Выберите, где открыть веб-ссылку.', remember: 'Запомнить выбор', cancel: 'Отмена', blockedTitle: 'Ссылка не открыта', blockedBody: 'Тип ссылки не поддерживается или небезопасен.' },
    ar: { settingTitle: 'فتح روابط الويب', settingBody: 'اختر المتصفح لفتح روابط المحادثات.', defaultBrowser: 'المتصفح المدمج (افتراضي)', systemBrowser: 'متصفح النظام', builtinBrowser: 'المتصفح المدمج', dialogTitle: 'فتح هذا الرابط؟', dialogBody: 'اختر مكان فتح رابط الويب.', remember: 'تذكر اختياري', cancel: 'إلغاء', blockedTitle: 'لم يُفتح الرابط', blockedBody: 'نوع الرابط غير مدعوم أو غير آمن.' },
    hi: { settingTitle: 'वेब लिंक खोलें', settingBody: 'चुनें कि बातचीत के लिंक कहाँ खुलें।', defaultBrowser: 'डिफ़ॉल्ट: अंतर्निहित ब्राउज़र', systemBrowser: 'सिस्टम ब्राउज़र', builtinBrowser: 'अंतर्निहित ब्राउज़र', dialogTitle: 'यह लिंक खोलें?', dialogBody: 'वेब लिंक खोलने का स्थान चुनें।', remember: 'मेरी पसंद याद रखें', cancel: 'रद्द करें', blockedTitle: 'लिंक नहीं खुला', blockedBody: 'यह लिंक प्रकार समर्थित या सुरक्षित नहीं है।' }
};

function uncheckedLinkOpeningText(locale: NextMuxDesktopLocale, key: LinkOpeningTextKey): string {
    return translations[locale]?.[key] || en[key];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function linkOpeningText(locale: Parameters<typeof uncheckedLinkOpeningText>[0], key: Parameters<typeof uncheckedLinkOpeningText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedLinkOpeningText>>): string {
    return totalCopy(locale, key, language => uncheckedLinkOpeningText(language, key, ...rest));
}
