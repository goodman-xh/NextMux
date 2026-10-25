import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { totalCopy } from './nextmux-copy-fallback';
import { fileTabMenuText } from './nextmux-file-tab-menu';
import { conversationLinkTargetKind } from './nextmux-link-opening';

type FileAction = 'openFile' | 'copyPath' | 'sendPath';
export type ChatContextAction = 'copyLink' | 'copyText' | 'sendText' | 'sendLink' | 'openBuiltin' | 'openSystem' | FileAction;
type Key = Exclude<ChatContextAction, FileAction> | 'menu' | 'copySelection' | 'sendSelection';
const copy: Record<NextMuxDesktopLocale, Record<Key, string>> = {
    'zh-CN': { copyLink: '复制链接', copyText: '复制文本', sendText: '发送文本到输入框', sendLink: '发送链接到输入框', openBuiltin: '内置浏览器打开', openSystem: '系统浏览器打开', copySelection: '复制', sendSelection: '发送到输入框', menu: '聊天内容操作' },
    'zh-TW': { copyLink: '複製連結', copyText: '複製文字', sendText: '傳送文字到輸入框', sendLink: '傳送連結到輸入框', openBuiltin: '使用內建瀏覽器開啟', openSystem: '使用系統瀏覽器開啟', copySelection: '複製', sendSelection: '傳送到輸入框', menu: '聊天內容操作' },
    en: { copyLink: 'Copy link', copyText: 'Copy text', sendText: 'Send text to input', sendLink: 'Send link to input', openBuiltin: 'Open in built-in browser', openSystem: 'Open in system browser', copySelection: 'Copy', sendSelection: 'Send to input', menu: 'Chat content actions' },
    ja: { copyLink: 'リンクをコピー', copyText: 'テキストをコピー', sendText: 'テキストを入力欄に追加', sendLink: 'リンクを入力欄に追加', openBuiltin: '内蔵ブラウザーで開く', openSystem: 'システムブラウザーで開く', copySelection: 'コピー', sendSelection: '入力欄に追加', menu: 'チャット内容の操作' },
    ko: { copyLink: '링크 복사', copyText: '텍스트 복사', sendText: '텍스트를 입력창에 추가', sendLink: '링크를 입력창에 추가', openBuiltin: '내장 브라우저에서 열기', openSystem: '시스템 브라우저에서 열기', copySelection: '복사', sendSelection: '입력창에 추가', menu: '채팅 내용 작업' },
    es: { copyLink: 'Copiar enlace', copyText: 'Copiar texto', sendText: 'Añadir texto a la entrada', sendLink: 'Añadir enlace a la entrada', openBuiltin: 'Abrir en navegador integrado', openSystem: 'Abrir en navegador del sistema', copySelection: 'Copiar', sendSelection: 'Añadir a la entrada', menu: 'Acciones del contenido del chat' },
    fr: { copyLink: 'Copier le lien', copyText: 'Copier le texte', sendText: 'Ajouter le texte à la saisie', sendLink: 'Ajouter le lien à la saisie', openBuiltin: 'Ouvrir dans le navigateur intégré', openSystem: 'Ouvrir dans le navigateur système', copySelection: 'Copier', sendSelection: 'Ajouter à la saisie', menu: 'Actions du contenu du chat' },
    de: { copyLink: 'Link kopieren', copyText: 'Text kopieren', sendText: 'Text zur Eingabe hinzufügen', sendLink: 'Link zur Eingabe hinzufügen', openBuiltin: 'Im integrierten Browser öffnen', openSystem: 'Im Systembrowser öffnen', copySelection: 'Kopieren', sendSelection: 'Zur Eingabe hinzufügen', menu: 'Aktionen für Chatinhalt' },
    'pt-BR': { copyLink: 'Copiar link', copyText: 'Copiar texto', sendText: 'Adicionar texto à entrada', sendLink: 'Adicionar link à entrada', openBuiltin: 'Abrir no navegador integrado', openSystem: 'Abrir no navegador do sistema', copySelection: 'Copiar', sendSelection: 'Adicionar à entrada', menu: 'Ações do conteúdo do chat' },
    ru: { copyLink: 'Копировать ссылку', copyText: 'Копировать текст', sendText: 'Добавить текст в поле ввода', sendLink: 'Добавить ссылку в поле ввода', openBuiltin: 'Открыть во встроенном браузере', openSystem: 'Открыть в системном браузере', copySelection: 'Копировать', sendSelection: 'Добавить в поле ввода', menu: 'Действия с текстом чата' },
    ar: { copyLink: 'نسخ الرابط', copyText: 'نسخ النص', sendText: 'إضافة النص إلى حقل الإدخال', sendLink: 'إضافة الرابط إلى حقل الإدخال', openBuiltin: 'فتح في المتصفح المدمج', openSystem: 'فتح في متصفح النظام', copySelection: 'نسخ', sendSelection: 'إضافة إلى حقل الإدخال', menu: 'إجراءات محتوى المحادثة' },
    hi: { copyLink: 'लिंक कॉपी करें', copyText: 'टेक्स्ट कॉपी करें', sendText: 'टेक्स्ट इनपुट में जोड़ें', sendLink: 'लिंक इनपुट में जोड़ें', openBuiltin: 'अंतर्निहित ब्राउज़र में खोलें', openSystem: 'सिस्टम ब्राउज़र में खोलें', copySelection: 'कॉपी करें', sendSelection: 'इनपुट में जोड़ें', menu: 'चैट सामग्री की कार्रवाइयाँ' }
};
const fileCopy: Record<NextMuxDesktopLocale, { openFile: string; sendPath: string }> = {
    'zh-CN': { openFile: '在文件抽屉中打开', sendPath: '发送文件路径到输入框' },
    'zh-TW': { openFile: '在檔案抽屜中開啟', sendPath: '傳送檔案路徑到輸入框' },
    en: { openFile: 'Open in file drawer', sendPath: 'Send file path to input' },
    ja: { openFile: 'ファイルドロワーで開く', sendPath: 'ファイルパスを入力欄に追加' },
    ko: { openFile: '파일 서랍에서 열기', sendPath: '파일 경로를 입력창에 추가' },
    es: { openFile: 'Abrir en el panel de archivos', sendPath: 'Añadir ruta del archivo a la entrada' },
    fr: { openFile: 'Ouvrir dans le panneau de fichiers', sendPath: 'Ajouter le chemin du fichier à la saisie' },
    de: { openFile: 'In der Dateiablage öffnen', sendPath: 'Dateipfad zur Eingabe hinzufügen' },
    'pt-BR': { openFile: 'Abrir no painel de arquivos', sendPath: 'Adicionar caminho do arquivo à entrada' },
    ru: { openFile: 'Открыть в панели файлов', sendPath: 'Добавить путь к файлу в поле ввода' },
    ar: { openFile: 'فتح في لوحة الملفات', sendPath: 'إضافة مسار الملف إلى حقل الإدخال' },
    hi: { openFile: 'फ़ाइल ड्रॉअर में खोलें', sendPath: 'फ़ाइल पथ इनपुट में जोड़ें' }
};
export function chatContextText(locale: NextMuxDesktopLocale, key: Key | FileAction): string {
    if (key === 'copyPath') return fileTabMenuText(locale, 'copyPath');
    if (key === 'openFile' || key === 'sendPath') return totalCopy(locale, key, language => fileCopy[language][key]);
    return totalCopy(locale, key, language => copy[language][key]);
}

export interface ChatContextTarget { readonly text: string; readonly href?: string; readonly fileTarget?: string; readonly filePath?: string; readonly fileTurnId?: string; }
export interface ChatMenuBounds { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; }
export const CHAT_MESSAGE_SELECTOR = '.nmx-user-markdown, .nmx-assistant-markdown, .nmx-user-message, .nmx-agent-message, .nmx-comic-chat-ask, .nmx-comic-chat-answer, .nmx-agent-child-detail > header, .nmx-agent-child-result, .nmx-stream, .nmx-turn-change-review';

/** Only a file item, text link, or the actual selected text under the mouse owns this menu. */
export function chatContextTarget(target: Element, body: HTMLElement, x: number, y: number, selection: Selection | null): ChatContextTarget | undefined {
    if (!body.contains(target) || !target.closest(CHAT_MESSAGE_SELECTOR)
        || target.closest('input,textarea,[contenteditable]:not([contenteditable="false"]),.monaco-editor,button:not([data-nmx-file-target]),img,video,audio,.nmx-comic-chat-media')) return undefined;
    const fileElement = target.closest<HTMLElement>('[data-nmx-file-target]');
    if (fileElement && body.contains(fileElement)) {
        const fileTarget = fileElement.dataset.nmxFileTarget?.trim();
        const text = fileElement.dataset.nmxLabel || fileElement.innerText?.trim() || fileElement.textContent?.trim() || fileTarget || '';
        if (fileTarget && text) {
            return { fileTarget, filePath: fileElement.dataset.nmxPath || fileTarget, text };
        }
    }
    const link = target.closest<HTMLAnchorElement>('a[href],a[data-href]');
    if (link && body.contains(link)) {
        const href = link.getAttribute('data-href') || link.getAttribute('href');
        const text = link.dataset.nmxLabel || link.innerText?.trim() || link.textContent?.trim() || '';
        if (href && href !== '#' && text) {
            const kind = conversationLinkTargetKind(href);
            if (kind === 'file') return { fileTarget: href, filePath: link.dataset.nmxPath || href, text };
            if (kind === 'web') return { href, text };
            return { text };
        }
    }
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1 || !selection.anchorNode || !selection.focusNode
        || !body.contains(selection.anchorNode) || !body.contains(selection.focusNode)) return undefined;
    const range = selection.getRangeAt(0), text = selection.toString();
    if (!text.trim() || ![...range.getClientRects()].some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) return undefined;
    return { text };
}

/** Flip near edges, then constrain both dimensions to the visible message area. */
export function chatMenuPosition(x: number, y: number, width: number, height: number, bounds: ChatMenuBounds) {
    const leftEdge = bounds.left + 4, topEdge = bounds.top + 4;
    const maxWidth = Math.max(0, bounds.right - bounds.left - 8), maxHeight = Math.max(0, bounds.bottom - bounds.top - 8);
    const actualWidth = Math.min(width, maxWidth), actualHeight = Math.min(height, maxHeight);
    return { left: Math.max(leftEdge, Math.min(x + actualWidth > bounds.right - 4 ? x - actualWidth : x, bounds.right - actualWidth - 4)),
        top: Math.max(topEdge, Math.min(y + actualHeight > bounds.bottom - 4 ? y - actualHeight : y, bounds.bottom - actualHeight - 4)), maxWidth, maxHeight };
}

export function chatContextAppendText(value: string, text: string): string {
    return `${value}${value && !value.endsWith('\n') ? '\n' : ''}${text}`;
}

/** Use Chromium's native edit transaction so the addition and prior typing remain undoable. */
export function appendChatContextToInput(input: HTMLTextAreaElement, text: string, owns: () => boolean): boolean {
    if (!text || input.disabled || input.readOnly || !input.isConnected || !owns()) return false;
    const before = input.value, next = chatContextAppendText(before, text);
    if (input.maxLength >= 0 && next.length > input.maxLength) return false;
    input.focus({ preventScroll: true });
    if (!owns()) return false;
    input.setSelectionRange(before.length, before.length);
    input.ownerDocument.execCommand('insertText', false, next.slice(before.length));
    return owns() && input.value === next;
}

export function ChatContextMenu(props: { readonly locale: NextMuxDesktopLocale; readonly target: ChatContextTarget;
    readonly x: number; readonly y: number; readonly getBounds: () => ChatMenuBounds | undefined;
    readonly canAppend: (text: string) => boolean; readonly onAction: (action: ChatContextAction) => void; readonly onDismiss: () => void }): React.ReactElement | null {
    const menu = React.useRef<HTMLDivElement>(null);
    const [position, setPosition] = React.useState<ReturnType<typeof chatMenuPosition>>();
    React.useLayoutEffect(() => {
        const place = (): void => {
            const bounds = props.getBounds(), element = menu.current;
            if (!bounds || bounds.bottom - bounds.top <= 12 || bounds.right - bounds.left <= 12) { props.onDismiss(); return; }
            const rect = element?.getBoundingClientRect();
            setPosition(chatMenuPosition(props.x, props.y, rect?.width || 240, element?.scrollHeight || 220, bounds));
        };
        place();
        const outside = (event: Event): void => { if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) props.onDismiss(); };
        window.addEventListener('resize', place); window.addEventListener('pointerdown', outside, true); window.addEventListener('scroll', outside, true);
        return () => { window.removeEventListener('resize', place); window.removeEventListener('pointerdown', outside, true); window.removeEventListener('scroll', outside, true); };
    }, [props.x, props.y, props.getBounds]);
    React.useLayoutEffect(() => {
        if (position) menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    }, [Boolean(position)]);
    const actions: ChatContextAction[] = props.target.fileTarget ? ['openFile','copyPath','copyText','sendText','sendPath']
        : props.target.href ? ['copyLink','copyText','sendText','sendLink','openBuiltin','openSystem'] : ['copyText','sendText'];
    return <div ref={menu} className='nmx-file-tab-menu nmx-chat-context-menu' role='menu' aria-label={chatContextText(props.locale, 'menu')}
        style={{ ...position, left: position?.left ?? props.x, top: position?.top ?? props.y, boxSizing: 'border-box', minWidth: 0, width: 'max-content', overflowY: 'auto', overflowX: 'hidden', visibility: position ? 'visible' : 'hidden' }}
        onMouseDown={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
        onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); props.onDismiss(); return; }
            if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
            event.preventDefault();
            const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        }}>
        {actions.map(action => <button key={action} type='button' role='menuitem' data-chat-context-action={action}
            disabled={(action === 'sendText' || action === 'sendLink' || action === 'sendPath')
                && !props.canAppend(action === 'sendPath' ? props.target.filePath! : action === 'sendLink' ? props.target.href! : props.target.text)}
            style={{ flexShrink: 0, height: 'auto', minHeight: 28, maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'anywhere' }}
            onClick={() => { props.onDismiss(); props.onAction(action); }}><span>{chatContextText(props.locale, !props.target.href && !props.target.fileTarget && action === 'copyText' ? 'copySelection'
                : !props.target.href && !props.target.fileTarget && action === 'sendText' ? 'sendSelection' : action)}</span></button>)}
    </div>;
}
