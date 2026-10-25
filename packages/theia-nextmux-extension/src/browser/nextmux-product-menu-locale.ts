import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const en = {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    help: 'Help',
    save: 'Save',
    preferences: 'Preferences',
    terminal: 'Terminal',
    closeWindow: 'Close Window',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    checkUpdates: 'Check for Updates',
    website: 'NextMux Website',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    fullScreen: 'Toggle Full Screen',
    newConversation: 'New Conversation'
} as const;

export type ProductMenuTextKey = keyof typeof en;
type ProductMenuCatalog = Readonly<Record<ProductMenuTextKey, string>>;

const translations: Readonly<Record<NextMuxDesktopLocale, ProductMenuCatalog>> = {
    en,
    'zh-CN': {
        file: '文件', edit: '编辑', view: '视图', help: '帮助', save: '保存', preferences: '首选项', terminal: '终端',
        closeWindow: '关闭窗口', undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
        checkUpdates: '检查更新', website: 'NextMux 官网', window: '窗口', minimize: '最小化', zoom: '缩放', fullScreen: '切换全屏', newConversation: '新建对话'
    },
    'zh-TW': {
        file: '檔案', edit: '編輯', view: '檢視', help: '說明', save: '儲存', preferences: '偏好設定', terminal: '終端機',
        closeWindow: '關閉視窗', undo: '復原', redo: '重做', cut: '剪下', copy: '複製', paste: '貼上', selectAll: '全選',
        checkUpdates: '檢查更新', website: 'NextMux 官網', window: '視窗', minimize: '最小化', zoom: '縮放', fullScreen: '切換全螢幕', newConversation: '新增對話'
    },
    ja: {
        file: 'ファイル', edit: '編集', view: '表示', help: 'ヘルプ', save: '保存', preferences: '設定', terminal: 'ターミナル',
        closeWindow: 'ウィンドウを閉じる', undo: '元に戻す', redo: 'やり直す', cut: '切り取り', copy: 'コピー', paste: '貼り付け', selectAll: 'すべて選択',
        checkUpdates: '更新を確認', website: 'NextMux 公式サイト', window: 'ウインドウ', minimize: 'しまう', zoom: '拡大/縮小', fullScreen: 'フルスクリーンの切り替え', newConversation: '新しい会話'
    },
    ko: {
        file: '파일', edit: '편집', view: '보기', help: '도움말', save: '저장', preferences: '설정', terminal: '터미널',
        closeWindow: '창 닫기', undo: '실행 취소', redo: '다시 실행', cut: '잘라내기', copy: '복사', paste: '붙여넣기', selectAll: '모두 선택',
        checkUpdates: '업데이트 확인', website: 'NextMux 웹사이트', window: '윈도우', minimize: '최소화', zoom: '확대/축소', fullScreen: '전체 화면 전환', newConversation: '새 대화'
    },
    es: {
        file: 'Archivo', edit: 'Editar', view: 'Ver', help: 'Ayuda', save: 'Guardar', preferences: 'Preferencias', terminal: 'Terminal',
        closeWindow: 'Cerrar ventana', undo: 'Deshacer', redo: 'Rehacer', cut: 'Cortar', copy: 'Copiar', paste: 'Pegar', selectAll: 'Seleccionar todo',
        checkUpdates: 'Buscar actualizaciones', website: 'Sitio web de NextMux', window: 'Ventana', minimize: 'Minimizar', zoom: 'Zoom', fullScreen: 'Alternar pantalla completa', newConversation: 'Nueva conversación'
    },
    fr: {
        file: 'Fichier', edit: 'Édition', view: 'Affichage', help: 'Aide', save: 'Enregistrer', preferences: 'Préférences', terminal: 'Terminal',
        closeWindow: 'Fermer la fenêtre', undo: 'Annuler', redo: 'Rétablir', cut: 'Couper', copy: 'Copier', paste: 'Coller', selectAll: 'Tout sélectionner',
        checkUpdates: 'Rechercher des mises à jour', website: 'Site de NextMux', window: 'Fenêtre', minimize: 'Réduire', zoom: 'Zoom', fullScreen: 'Basculer en plein écran', newConversation: 'Nouvelle conversation'
    },
    de: {
        file: 'Datei', edit: 'Bearbeiten', view: 'Ansicht', help: 'Hilfe', save: 'Speichern', preferences: 'Einstellungen', terminal: 'Terminal',
        closeWindow: 'Fenster schließen', undo: 'Rückgängig', redo: 'Wiederholen', cut: 'Ausschneiden', copy: 'Kopieren', paste: 'Einfügen', selectAll: 'Alles auswählen',
        checkUpdates: 'Nach Updates suchen', website: 'NextMux-Website', window: 'Fenster', minimize: 'Im Dock ablegen', zoom: 'Zoomen', fullScreen: 'Vollbild umschalten', newConversation: 'Neue Unterhaltung'
    },
    'pt-BR': {
        file: 'Arquivo', edit: 'Editar', view: 'Exibir', help: 'Ajuda', save: 'Salvar', preferences: 'Preferências', terminal: 'Terminal',
        closeWindow: 'Fechar janela', undo: 'Desfazer', redo: 'Refazer', cut: 'Recortar', copy: 'Copiar', paste: 'Colar', selectAll: 'Selecionar tudo',
        checkUpdates: 'Verificar atualizações', website: 'Site do NextMux', window: 'Janela', minimize: 'Minimizar', zoom: 'Zoom', fullScreen: 'Alternar tela cheia', newConversation: 'Nova conversa'
    },
    ru: {
        file: 'Файл', edit: 'Правка', view: 'Вид', help: 'Справка', save: 'Сохранить', preferences: 'Настройки', terminal: 'Терминал',
        closeWindow: 'Закрыть окно', undo: 'Отменить', redo: 'Повторить', cut: 'Вырезать', copy: 'Копировать', paste: 'Вставить', selectAll: 'Выбрать всё',
        checkUpdates: 'Проверить обновления', website: 'Сайт NextMux', window: 'Окно', minimize: 'Свернуть', zoom: 'Изменить масштаб', fullScreen: 'Полноэкранный режим', newConversation: 'Новый диалог'
    },
    ar: {
        file: 'ملف', edit: 'تحرير', view: 'عرض', help: 'مساعدة', save: 'حفظ', preferences: 'التفضيلات', terminal: 'الطرفية',
        closeWindow: 'إغلاق النافذة', undo: 'تراجع', redo: 'إعادة', cut: 'قص', copy: 'نسخ', paste: 'لصق', selectAll: 'تحديد الكل',
        checkUpdates: 'التحقق من التحديثات', website: 'موقع NextMux', window: 'نافذة', minimize: 'تصغير', zoom: 'تكبير/تصغير', fullScreen: 'تبديل ملء الشاشة', newConversation: 'محادثة جديدة'
    },
    hi: {
        file: 'फ़ाइल', edit: 'संपादन', view: 'दृश्य', help: 'सहायता', save: 'सहेजें', preferences: 'प्राथमिकताएँ', terminal: 'टर्मिनल',
        closeWindow: 'विंडो बंद करें', undo: 'पूर्ववत करें', redo: 'फिर से करें', cut: 'काटें', copy: 'कॉपी करें', paste: 'चिपकाएँ', selectAll: 'सब चुनें',
        checkUpdates: 'अपडेट जाँचें', website: 'NextMux वेबसाइट', window: 'विंडो', minimize: 'छोटा करें', zoom: 'ज़ूम', fullScreen: 'पूर्ण स्क्रीन टॉगल करें', newConversation: 'नई बातचीत'
    }
};

function uncheckedProductMenuText(locale: NextMuxDesktopLocale, key: ProductMenuTextKey): string {
    return translations[locale][key];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function productMenuText(locale: Parameters<typeof uncheckedProductMenuText>[0], key: Parameters<typeof uncheckedProductMenuText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedProductMenuText>>): string {
    return totalCopy(locale, key, language => uncheckedProductMenuText(language, key, ...rest));
}
