import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { totalCopy } from './nextmux-copy-fallback';

/**
 * The file drawer tab's right-click menu: copy the name or path, show the file in Finder / Explorer, attach it to
 * the message, find, replace, close. Find and replace are the editor's own (⌘F and ⌥⌘F on macOS, where ⌘H hides
 * the app; Ctrl+F and Ctrl+H on Windows).
 */
type Key = 'copyName' | 'copyPath' | 'revealMac' | 'revealWindows' | 'attach' | 'find' | 'replace' | 'close' | 'copied';

const copy: Record<NextMuxDesktopLocale, Record<Key, string>> = {
    'zh-CN': { copyName: '复制文件名', copyPath: '复制文件路径', revealMac: '在 Finder 中显示', revealWindows: '在文件夹中显示', attach: '附加到对话框', find: '查找', replace: '替换', close: '关闭文件', copied: '已复制' },
    'zh-TW': { copyName: '複製檔名', copyPath: '複製檔案路徑', revealMac: '在 Finder 中顯示', revealWindows: '在資料夾中顯示', attach: '附加到對話框', find: '尋找', replace: '取代', close: '關閉檔案', copied: '已複製' },
    en: { copyName: 'Copy file name', copyPath: 'Copy file path', revealMac: 'Reveal in Finder', revealWindows: 'Show in folder', attach: 'Attach to message', find: 'Find', replace: 'Replace', close: 'Close file', copied: 'Copied' },
    ja: { copyName: 'ファイル名をコピー', copyPath: 'ファイルパスをコピー', revealMac: 'Finder で表示', revealWindows: 'フォルダーで表示', attach: 'メッセージに添付', find: '検索', replace: '置換', close: 'ファイルを閉じる', copied: 'コピーしました' },
    ko: { copyName: '파일 이름 복사', copyPath: '파일 경로 복사', revealMac: 'Finder에서 보기', revealWindows: '폴더에서 보기', attach: '메시지에 첨부', find: '찾기', replace: '바꾸기', close: '파일 닫기', copied: '복사됨' },
    es: { copyName: 'Copiar nombre del archivo', copyPath: 'Copiar ruta del archivo', revealMac: 'Mostrar en Finder', revealWindows: 'Mostrar en la carpeta', attach: 'Adjuntar al mensaje', find: 'Buscar', replace: 'Reemplazar', close: 'Cerrar archivo', copied: 'Copiado' },
    fr: { copyName: 'Copier le nom du fichier', copyPath: 'Copier le chemin du fichier', revealMac: 'Afficher dans le Finder', revealWindows: 'Afficher dans le dossier', attach: 'Joindre au message', find: 'Rechercher', replace: 'Remplacer', close: 'Fermer le fichier', copied: 'Copié' },
    de: { copyName: 'Dateinamen kopieren', copyPath: 'Dateipfad kopieren', revealMac: 'Im Finder zeigen', revealWindows: 'Im Ordner anzeigen', attach: 'An Nachricht anhängen', find: 'Suchen', replace: 'Ersetzen', close: 'Datei schließen', copied: 'Kopiert' },
    'pt-BR': { copyName: 'Copiar nome do arquivo', copyPath: 'Copiar caminho do arquivo', revealMac: 'Mostrar no Finder', revealWindows: 'Mostrar na pasta', attach: 'Anexar à mensagem', find: 'Localizar', replace: 'Substituir', close: 'Fechar arquivo', copied: 'Copiado' },
    ru: { copyName: 'Копировать имя файла', copyPath: 'Копировать путь к файлу', revealMac: 'Показать в Finder', revealWindows: 'Показать в папке', attach: 'Прикрепить к сообщению', find: 'Найти', replace: 'Заменить', close: 'Закрыть файл', copied: 'Скопировано' },
    ar: { copyName: 'نسخ اسم الملف', copyPath: 'نسخ مسار الملف', revealMac: 'إظهار في Finder', revealWindows: 'إظهار في المجلد', attach: 'إرفاق بالرسالة', find: 'بحث', replace: 'استبدال', close: 'إغلاق الملف', copied: 'تم النسخ' },
    hi: { copyName: 'फ़ाइल का नाम कॉपी करें', copyPath: 'फ़ाइल पथ कॉपी करें', revealMac: 'Finder में दिखाएँ', revealWindows: 'फ़ोल्डर में दिखाएँ', attach: 'संदेश में संलग्न करें', find: 'खोजें', replace: 'बदलें', close: 'फ़ाइल बंद करें', copied: 'कॉपी हो गया' }
};

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function fileTabMenuText(locale: NextMuxDesktopLocale, key: Key): string {
    return totalCopy(locale, key, language => copy[language][key]);
}

export interface FileTabMenuActions {
    readonly onCopyName: () => void;
    readonly onCopyPath: () => void;
    readonly onReveal: () => void;
    readonly onAttach: () => void;
    readonly onFind?: () => void;
    readonly onReplace?: () => void;
    readonly onClose: () => void;
    readonly onDismiss: () => void;
}

export function FileTabMenu(props: FileTabMenuActions & { readonly locale: NextMuxDesktopLocale; readonly mac: boolean; readonly x: number; readonly y: number }): React.ReactElement {
    const t = (key: Key): string => fileTabMenuText(props.locale, key);
    const menu = React.useRef<HTMLDivElement>(null);
    const [position, setPosition] = React.useState({ left: props.x, top: props.y });
    React.useLayoutEffect(() => {
        const element = menu.current;
        if (!element) return;
        // Kept inside the window, like a system context menu.
        const rect = element.getBoundingClientRect();
        setPosition({ left: Math.max(8, Math.min(props.x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(props.y, window.innerHeight - rect.height - 8)) });
        element.querySelector<HTMLButtonElement>('button')?.focus();
    }, [props.x, props.y]);
    const run = (action: () => void) => (): void => { props.onDismiss(); action(); };
    const item = (label: string, action: () => void, shortcut?: string): React.ReactElement =>
        <button type='button' role='menuitem' onClick={run(action)}><span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>;
    return <>
        <div className='nmx-file-tab-menu-backdrop' onMouseDown={props.onDismiss} onContextMenu={event => { event.preventDefault(); props.onDismiss(); }}></div>
        <div ref={menu} className='nmx-file-tab-menu' role='menu' style={position}
            onKeyDown={event => {
                if (event.key === 'Escape') { event.preventDefault(); props.onDismiss(); return; }
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                event.preventDefault();
                const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') || [])];
                const index = items.indexOf(document.activeElement as HTMLButtonElement);
                items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            }}>
            {item(t('copyName'), props.onCopyName)}
            {item(t('copyPath'), props.onCopyPath)}
            {item(t(props.mac ? 'revealMac' : 'revealWindows'), props.onReveal)}
            {item(t('attach'), props.onAttach)}
            {(props.onFind || props.onReplace) && <hr />}
            {props.onFind && item(t('find'), props.onFind, props.mac ? '⌘F' : 'Ctrl+F')}
            {props.onReplace && item(t('replace'), props.onReplace, props.mac ? '⌥⌘F' : 'Ctrl+H')}
            <hr />
            {item(t('close'), props.onClose)}
        </div>
    </>;
}
