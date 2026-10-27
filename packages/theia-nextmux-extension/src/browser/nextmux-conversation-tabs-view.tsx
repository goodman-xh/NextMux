import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { CONVERSATION_TAB_ID, selectTabWindow, tabWindowItemLabel, tabWindows, type ConversationVisualTab } from './nextmux-conversation-tabs';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';
import { ConversationWindowInputQueue } from './nextmux-window-input-queue';

type TabsTextKey = 'strip' | 'conversation' | 'closeConversation' | 'closeTab' | 'connecting' | 'connected' | 'disconnected' | 'error'
    | 'desktopEmpty' | 'desktopHint' | 'remoteDesktop' | 'localDesktop' | 'virtualMachine';

const catalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<TabsTextKey, string>>>> = {
    'zh-CN': { strip: '对话标签', conversation: '对话', closeConversation: '关闭对话', closeTab: '关闭标签', connecting: '连接中', connected: '已连接', disconnected: '已断开', error: '连接失败',
        desktopEmpty: '等待桌面画面', desktopHint: 'AI 连接桌面后，画面会显示在这里，AI 的每一步操作都在这个标签里进行。', remoteDesktop: '远程桌面', localDesktop: '本机桌面', virtualMachine: '虚拟机' },
    'zh-TW': { strip: '對話分頁', conversation: '對話', closeConversation: '關閉對話', closeTab: '關閉分頁', connecting: '連線中', connected: '已連線', disconnected: '已中斷', error: '連線失敗',
        desktopEmpty: '等待桌面畫面', desktopHint: 'AI 連線桌面後，畫面會顯示在這裡，AI 的每一步操作都在這個分頁中進行。', remoteDesktop: '遠端桌面', localDesktop: '本機桌面', virtualMachine: '虛擬機' },
    en: { strip: 'Conversation tabs', conversation: 'Conversation', closeConversation: 'Close conversation', closeTab: 'Close tab', connecting: 'Connecting', connected: 'Connected', disconnected: 'Disconnected', error: 'Connection failed',
        desktopEmpty: 'Waiting for the desktop', desktopHint: 'When the AI connects to a desktop, its screen appears here and every action the AI takes happens in this tab.', remoteDesktop: 'Remote desktop', localDesktop: 'This computer', virtualMachine: 'Virtual machine' },
    ja: { strip: '会話タブ', conversation: '会話', closeConversation: '会話を閉じる', closeTab: 'タブを閉じる', connecting: '接続中', connected: '接続済み', disconnected: '切断', error: '接続に失敗しました',
        desktopEmpty: 'デスクトップを待っています', desktopHint: 'AI がデスクトップに接続すると、ここに画面が表示され、AI の操作はすべてこのタブで行われます。', remoteDesktop: 'リモートデスクトップ', localDesktop: 'このコンピューター', virtualMachine: '仮想マシン' },
    ko: { strip: '대화 탭', conversation: '대화', closeConversation: '대화 닫기', closeTab: '탭 닫기', connecting: '연결 중', connected: '연결됨', disconnected: '연결 끊김', error: '연결 실패',
        desktopEmpty: '데스크톱을 기다리는 중', desktopHint: 'AI가 데스크톱에 연결하면 화면이 여기에 표시되고, AI의 모든 작업이 이 탭에서 진행됩니다.', remoteDesktop: '원격 데스크톱', localDesktop: '이 컴퓨터', virtualMachine: '가상 머신' },
    es: { strip: 'Pestañas de la conversación', conversation: 'Conversación', closeConversation: 'Cerrar conversación', closeTab: 'Cerrar pestaña', connecting: 'Conectando', connected: 'Conectado', disconnected: 'Desconectado', error: 'Error de conexión',
        desktopEmpty: 'Esperando el escritorio', desktopHint: 'Cuando la IA se conecte a un escritorio, su pantalla aparecerá aquí y cada acción de la IA ocurrirá en esta pestaña.', remoteDesktop: 'Escritorio remoto', localDesktop: 'Este equipo', virtualMachine: 'Máquina virtual' },
    fr: { strip: 'Onglets de la conversation', conversation: 'Conversation', closeConversation: 'Fermer la conversation', closeTab: 'Fermer l’onglet', connecting: 'Connexion', connected: 'Connecté', disconnected: 'Déconnecté', error: 'Échec de la connexion',
        desktopEmpty: 'En attente du bureau', desktopHint: 'Quand l’IA se connecte à un bureau, son écran s’affiche ici et chaque action de l’IA se déroule dans cet onglet.', remoteDesktop: 'Bureau à distance', localDesktop: 'Cet ordinateur', virtualMachine: 'Machine virtuelle' },
    de: { strip: 'Unterhaltungs-Tabs', conversation: 'Unterhaltung', closeConversation: 'Unterhaltung schließen', closeTab: 'Tab schließen', connecting: 'Verbinde', connected: 'Verbunden', disconnected: 'Getrennt', error: 'Verbindung fehlgeschlagen',
        desktopEmpty: 'Warte auf den Desktop', desktopHint: 'Sobald die KI sich mit einem Desktop verbindet, erscheint sein Bildschirm hier, und jede Aktion der KI findet in diesem Tab statt.', remoteDesktop: 'Remotedesktop', localDesktop: 'Dieser Computer', virtualMachine: 'Virtuelle Maschine' },
    'pt-BR': { strip: 'Abas da conversa', conversation: 'Conversa', closeConversation: 'Fechar conversa', closeTab: 'Fechar aba', connecting: 'Conectando', connected: 'Conectado', disconnected: 'Desconectado', error: 'Falha na conexão',
        desktopEmpty: 'Aguardando a área de trabalho', desktopHint: 'Quando a IA se conectar a uma área de trabalho, a tela aparece aqui e cada ação da IA acontece nesta aba.', remoteDesktop: 'Área de trabalho remota', localDesktop: 'Este computador', virtualMachine: 'Máquina virtual' },
    ru: { strip: 'Вкладки беседы', conversation: 'Беседа', closeConversation: 'Закрыть беседу', closeTab: 'Закрыть вкладку', connecting: 'Подключение', connected: 'Подключено', disconnected: 'Отключено', error: 'Ошибка подключения',
        desktopEmpty: 'Ожидание рабочего стола', desktopHint: 'Когда ИИ подключится к рабочему столу, его экран появится здесь, и все действия ИИ будут выполняться в этой вкладке.', remoteDesktop: 'Удалённый рабочий стол', localDesktop: 'Этот компьютер', virtualMachine: 'Виртуальная машина' },
    ar: { strip: 'علامات تبويب المحادثة', conversation: 'المحادثة', closeConversation: 'إغلاق المحادثة', closeTab: 'إغلاق علامة التبويب', connecting: 'جارٍ الاتصال', connected: 'متصل', disconnected: 'غير متصل', error: 'فشل الاتصال',
        desktopEmpty: 'بانتظار سطح المكتب', desktopHint: 'عندما يتصل الذكاء الاصطناعي بسطح مكتب تظهر شاشته هنا، وتجري كل إجراءاته في علامة التبويب هذه.', remoteDesktop: 'سطح مكتب بعيد', localDesktop: 'هذا الكمبيوتر', virtualMachine: 'جهاز افتراضي' },
    hi: { strip: 'बातचीत टैब', conversation: 'बातचीत', closeConversation: 'बातचीत बंद करें', closeTab: 'टैब बंद करें', connecting: 'कनेक्ट हो रहा है', connected: 'कनेक्टेड', disconnected: 'डिस्कनेक्टेड', error: 'कनेक्शन विफल',
        desktopEmpty: 'डेस्कटॉप की प्रतीक्षा', desktopHint: 'जब AI किसी डेस्कटॉप से जुड़ता है तो उसकी स्क्रीन यहाँ दिखती है और AI की हर कार्रवाई इसी टैब में होती है।', remoteDesktop: 'रिमोट डेस्कटॉप', localDesktop: 'यह कंप्यूटर', virtualMachine: 'वर्चुअल मशीन' }
};

function uncheckedConversationTabsText(locale: NextMuxDesktopLocale, key: TabsTextKey): string {
    return catalog[locale]?.[key] || catalog.en[key];
}

function tabIcon(tab: ConversationVisualTab): string {
    if (tab.kind === 'virtual-machine') return 'vm';
    return tab.platform === 'windows' ? 'window' : tab.platform === 'macos' ? 'device-desktop' : 'remote-explorer';
}

export interface ConversationTabStripProps {
    readonly locale: NextMuxDesktopLocale;
    readonly title: string;
    readonly running: boolean;
    readonly tabs: readonly ConversationVisualTab[];
    readonly activeId: string;
    readonly onSelect: (id: string) => void;
    readonly onClose: (id: string) => void;
    /** A tab dropped outside NextMux's window: it leaves the strip for a window of its own at that screen point. */
    readonly onDetach?: (id: string, point: { readonly x: number; readonly y: number }) => void;
    /** A torn-off tab dragged back onto the strip: merge it again, as with browser tabs. */
    readonly onReattach?: (payload: { readonly conversationId: string; readonly tabId: string }) => void;
    /** Right-click context menu for the conversation's own tab (or all tabs when allowAllTabContextMenu is true in tiled windows). */
    readonly onConversationContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
    /** When true (in a tiled conversation window), every tab in the strip supports the right-click context menu. */
    readonly allowAllTabContextMenu?: boolean;
}

export const TAB_DRAG_TYPE = 'application/x-nextmux-tab';

/** One strip per conversation: the conversation's own tab first, then tabs the AI opened. */
export function ConversationTabStrip(props: ConversationTabStripProps): React.ReactElement {
    const { locale } = props;
    const items = [{ id: CONVERSATION_TAB_ID, title: props.title, hint: props.title, icon: props.running ? 'loading codicon-modifier-spin' : 'comment-discussion', status: undefined as ConversationVisualTab['status'] | undefined },
        ...props.tabs.map(tab => ({ id: tab.id, title: tab.title, hint: `${tab.title}\n${tab.target} · ${conversationTabsText(locale, tab.status)}`, icon: tabIcon(tab), status: tab.status }))];
    const move = (event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const index = items.findIndex(item => item.id === props.activeId);
        const rtl = event.currentTarget.closest('[dir="rtl"]') !== null;
        const step = (event.key === 'ArrowRight') !== rtl ? 1 : -1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + step + items.length) % items.length;
        event.preventDefault();
        props.onSelect(items[next].id);
        (event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next])?.focus();
    };
    // With many tabs the strip scrolls sideways; a mouse wheel moves it left and right.
    const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
        const strip = event.currentTarget;
        if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        strip.scrollLeft += event.deltaY * (strip.closest('[dir="rtl"]') ? -1 : 1);
    };
    const [dropping, setDropping] = React.useState(false);
    const strip = React.useRef<HTMLDivElement>(null);
    // An overflowing strip trades its bottom padding for the scrollbar track (see the stylesheet).
    React.useLayoutEffect(() => {
        const element = strip.current;
        if (!element) return undefined;
        const measure = (): void => { element.classList.toggle('is-overflowing', element.scrollWidth > element.clientWidth + 1); };
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
        observer?.observe(element);
        // The trailing spacer narrows as titles grow, so it also reports an overflow the strip's own size does not show.
        const spacer = element.querySelector<HTMLElement>(':scope > .nmx-conversation-tabs-drag-spacer');
        if (spacer) observer?.observe(spacer);
        return () => observer?.disconnect();
    }, [items.length]);
    // The selected tab is always in view, also when the AI opens one past the edge.
    React.useEffect(() => {
        strip.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [props.activeId, props.tabs.length]);
    const carriesTab = (event: React.DragEvent): boolean => Boolean(props.onReattach) && event.dataTransfer.types.includes(TAB_DRAG_TYPE);
    return <div ref={strip} className={`nmx-conversation-tabs${dropping ? ' is-drop-target' : ''}`} role='tablist' aria-label={conversationTabsText(locale, 'strip')} onKeyDown={move} onWheel={onWheel}
        onDragOver={event => { if (!carriesTab(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropping(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
        onDrop={event => {
            setDropping(false);
            if (!carriesTab(event)) return;
            event.preventDefault();
            try {
                const payload = JSON.parse(event.dataTransfer.getData(TAB_DRAG_TYPE)) as { conversationId?: unknown; tabId?: unknown };
                if (typeof payload.conversationId === 'string' && typeof payload.tabId === 'string') props.onReattach!({ conversationId: payload.conversationId, tabId: payload.tabId });
            } catch { /* not a NextMux tab */ }
        }}>
        {items.map(item => {
            const active = item.id === props.activeId;
            const closeLabel = item.id === CONVERSATION_TAB_ID ? conversationTabsText(locale, 'closeConversation') : conversationTabsText(locale, 'closeTab');
            const detachable = item.id !== CONVERSATION_TAB_ID && Boolean(props.onDetach);
            return <div key={item.id} className={`nmx-conversation-tab${active ? ' is-active' : ''}${item.status ? ` is-${item.status}` : ''}`} title={item.hint}
                data-tab-kind={item.id === CONVERSATION_TAB_ID ? 'conversation' : 'visual'}
                draggable={detachable}
                onContextMenu={(item.id === CONVERSATION_TAB_ID || props.allowAllTabContextMenu) && props.onConversationContextMenu ? event => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onConversationContextMenu!(event);
                } : undefined}
                onDragStart={detachable ? event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.title); } : undefined}
                onDragEnd={detachable ? event => {
                    // Dropped outside NextMux's window (nothing took it): tear the tab off into a window of its own there.
                    const outside = event.screenX < window.screenX || event.screenY < window.screenY
                        || event.screenX > window.screenX + window.outerWidth || event.screenY > window.screenY + window.outerHeight;
                    if (outside && event.dataTransfer.dropEffect === 'none') props.onDetach!(item.id, { x: event.screenX, y: event.screenY });
                } : undefined}>
                <button type='button' role='tab' aria-selected={active} tabIndex={active ? 0 : -1} onClick={() => props.onSelect(item.id)}
                    onAuxClick={event => { if (event.button === 1) { event.preventDefault(); props.onClose(item.id); } }}>
                    <i className={`codicon codicon-${item.icon}`} aria-hidden='true'></i>
                    <span data-nmx-literal>{item.title}</span>
                    {item.status && <i className='nmx-conversation-tab-status' aria-label={conversationTabsText(locale, item.status)}></i>}
                </button>
                <button type='button' className='nmx-conversation-tab-close' aria-label={`${closeLabel} · ${item.title}`} title={closeLabel} tabIndex={-1}
                    onClick={event => { event.stopPropagation(); props.onClose(item.id); }}><i className='codicon codicon-close' aria-hidden='true'></i></button>
            </div>;
        })}
        {/* The empty rest of the row. In a detached window, where the strip is the title bar, it drags the window
            while every tab, close button and the scrollbar stay clickable. */}
        <div className='nmx-conversation-tabs-drag-spacer' aria-hidden='true' />
    </div>;
}

type WindowTextKey = 'live' | 'lastFrame' | 'onlyInTab' | 'alsoOnDesktop' | 'placement' | 'inTabHint' | 'switchToWindow' | 'moveFailed'
    | 'mouse' | 'mouseHint' | 'mouseOff' | 'inputBlocked' | 'sound' | 'soundHint' | 'soundFailed' | 'switchOn' | 'switchOff' | 'soundOff'
    | 'waiting' | 'alreadyOpen' | 'aiSoundOn' | 'aiSoundOff' | 'aiInputOn' | 'aiInputOff' | 'aiToTab' | 'aiToDesktop'
    | 'parkForeground' | 'parkUwp' | 'parkMinimized' | 'parkMissing' | 'lockUnavailable'
    | 'reopenApp' | 'reopenRunningTitle' | 'reopenRunningBody' | 'reopenRunningConfirm' | 'reopenFailed'
    | 'windowOwned' | 'controlHint' | 'dismissNotice' | 'escStopped' | 'resumeControl'
    | 'terminateBubble' | 'terminateTitle' | 'terminateBody' | 'terminateConfirm' | 'terminateCancel' | 'terminateFailed';

const windowCatalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<WindowTextKey, string>>>> = {
    'zh-CN': { live: '实时', lastFrame: '最近画面', onlyInTab: '只在标签', alsoOnDesktop: '也在桌面', placement: '窗口显示位置',
        inTabHint: '窗口在后台运行，不占用你的桌面', switchToWindow: '切到此窗口', moveFailed: '窗口没能移动，请稍后再试',
        mouse: '键鼠', mouseHint: '打开后可以在标签内点击、滚动和打字；关闭时标签内仅由 AI 和插件操作，桌面上的窗口始终可以直接操作。', mouseOff: '键鼠已关闭：打开“键鼠”后才能在标签内操作这个窗口', inputBlocked: '「{app}」正由 AI 操作：在它的标签里打开“键鼠”后，你就可以在标签内操作。', sound: '声音', soundHint: '关闭时这个应用保持静音', soundFailed: '没能切换声音：需要“屏幕与系统录音”权限', switchOn: '已开', switchOff: '已关', soundOff: '已静音',
        alreadyOpen: '「{app}」已在这个标签中打开', aiSoundOn: 'AI 打开了声音', aiSoundOff: 'AI 关闭了声音', aiInputOn: 'AI 打开了键鼠', aiInputOff: 'AI 关闭了键鼠', aiToTab: 'AI 把窗口移回标签', aiToDesktop: 'AI 让窗口也显示在桌面',
        waiting: '等待画面', parkForeground: 'Windows 上 AI 只能操作显示在桌面上的窗口，所以这个窗口会留在桌面', parkUwp: '这个应用不接受后台操作，窗口需要留在桌面', parkMinimized: '窗口已最小化：先还原它，AI 才能看到并操作', parkMissing: '找不到这个窗口，它可能已关闭', lockUnavailable: '桌面上的窗口始终可以直接操作',
        reopenApp: "重新打开", reopenRunningTitle: "该应用已经在运行中，是否关闭重新打开？", reopenRunningBody: "关闭当前正在运行的「{app}」并重新打开到当前标签中。", reopenRunningConfirm: "关闭并重新打开", reopenFailed: "未能重新打开应用，请稍后再试",
        dismissNotice: "关闭通知", windowOwned: "该应用窗口已在另一段对话中打开，请先在原对话关闭标签。", controlHint: "按 Esc 可以退出控制", escStopped: "已按 Esc 退出桌面控制：本轮 AI 不再操作电脑窗口，会改用其他方式继续。", resumeControl: "恢复控制",
        terminateBubble: '点我关闭进程', terminateTitle: '结束「{app}」进程？', terminateBody: '将关闭「{app}」窗口并结束其运行进程，未保存的内容可能会丢失。', terminateConfirm: '结束进程', terminateCancel: '取消', terminateFailed: '未能结束进程，请稍后再试' },
    'zh-TW': { live: '即時', lastFrame: '最近畫面', onlyInTab: '只在分頁', alsoOnDesktop: '也在桌面', placement: '視窗顯示位置',
        inTabHint: '視窗在背景執行，不佔用你的桌面', switchToWindow: '切到此視窗', moveFailed: '視窗無法移動，請稍後再試',
        mouse: '鍵鼠', mouseHint: '開啟後可以在分頁內點按、捲動和打字；關閉時分頁內僅由 AI 和外掛操作，桌面上的視窗始終可以直接操作。', mouseOff: '鍵鼠已關閉：開啟「鍵鼠」後才能在分頁內操作這個視窗', inputBlocked: '「{app}」正由 AI 操作：在它的分頁裡開啟「鍵鼠」後，你就能在分頁內操作。', sound: '聲音', soundHint: '關閉時這個 App 保持靜音', soundFailed: '無法切換聲音：需要「螢幕與系統錄音」權限', switchOn: '已開', switchOff: '已關', soundOff: '已靜音',
        alreadyOpen: '「{app}」已在這個分頁中開啟', aiSoundOn: 'AI 開啟了聲音', aiSoundOff: 'AI 關閉了聲音', aiInputOn: 'AI 開啟了鍵鼠', aiInputOff: 'AI 關閉了鍵鼠', aiToTab: 'AI 把視窗移回分頁', aiToDesktop: 'AI 讓視窗也顯示在桌面',
        waiting: '等待畫面', parkForeground: 'Windows 上 AI 只能操作顯示在桌面上的視窗，所以這個視窗會留在桌面', parkUwp: '這個 App 不接受背景操作，視窗需要留在桌面', parkMinimized: '視窗已最小化：先還原它，AI 才能看到並操作', parkMissing: '找不到這個視窗，它可能已關閉', lockUnavailable: '桌面上的視窗始終可以直接操作',
        reopenApp: "重新開啟", reopenRunningTitle: "此 App 已在執行中，是否關閉並重新開啟？", reopenRunningBody: "關閉目前正在執行的「{app}」，並在目前分頁中重新開啟。", reopenRunningConfirm: "關閉並重新開啟", reopenFailed: "無法重新開啟 App，請稍後再試",
        dismissNotice: "關閉通知", windowOwned: "此應用程式視窗已在另一段對話中開啟，請先在原對話關閉分頁。", controlHint: "按 Esc 可以退出控制", escStopped: "已按 Esc 結束桌面控制：本輪 AI 不再操作電腦視窗，會改用其他方式繼續。", resumeControl: "恢復控制",
        terminateBubble: '點我關閉處理程序', terminateTitle: '結束「{app}」處理程序？', terminateBody: '將關閉「{app}」視窗並結束其執行中的處理程序，未儲存的內容可能會遺失。', terminateConfirm: '結束處理程序', terminateCancel: '取消', terminateFailed: '無法結束處理程序，請稍後再試' },
    en: { live: 'Live', lastFrame: 'Last frame', onlyInTab: 'Tab only', alsoOnDesktop: 'Also on desktop', placement: 'Where the window shows',
        inTabHint: 'Runs in the background, off your desktop', switchToWindow: 'Switch to window', moveFailed: 'Couldn’t move the window. Try again.',
        mouse: 'Keyboard & mouse', mouseHint: 'Turn on to click, scroll and type inside this tab. When off, only the AI and plugins control the tab; windows on the desktop can always be used directly.', mouseOff: 'Keyboard & mouse is off. Turn it on to use this window inside the tab.', inputBlocked: '“{app}” is controlled by the AI. Turn on “Keyboard & mouse” in its tab to use it inside the tab.', sound: 'Sound', soundHint: 'When off, this app stays muted', soundFailed: 'Couldn’t change the sound. NextMux needs the Screen & System Audio Recording permission.', switchOn: 'On', switchOff: 'Off', soundOff: 'Muted',
        alreadyOpen: '“{app}” is already open in this tab', aiSoundOn: 'The AI turned the sound on', aiSoundOff: 'The AI muted the sound', aiInputOn: 'The AI turned keyboard & mouse on', aiInputOff: 'The AI turned keyboard & mouse off', aiToTab: 'The AI moved the window back into the tab', aiToDesktop: 'The AI also showed the window on the desktop',
        waiting: 'Waiting for the picture', parkForeground: 'On Windows the AI can only work in windows shown on the desktop, so this window stays there', parkUwp: 'This app does not accept input in the background, so its window stays on the desktop', parkMinimized: 'The window is minimized: restore it so the AI can see and use it', parkMissing: 'This window can no longer be found; it may have closed', lockUnavailable: 'Windows on the desktop can always be used directly',
        reopenApp: "Reopen", reopenRunningTitle: "This app is already running. Close and reopen it?", reopenRunningBody: "Close the running “{app}” and reopen it in this tab.", reopenRunningConfirm: "Close and reopen", reopenFailed: "Couldn’t reopen the app. Try again.",
        dismissNotice: "Dismiss notification", windowOwned: "This app window is open in another conversation. Close its tab there first.", controlHint: "Press Esc to exit control", escStopped: "You pressed Esc to end desktop control: for the rest of this turn the AI won’t operate windows and continues another way.", resumeControl: "Resume control",
        terminateBubble: 'Click to end process', terminateTitle: 'End “{app}” process?', terminateBody: 'This will close the “{app}” window and terminate its running process. Unsaved changes may be lost.', terminateConfirm: 'End process', terminateCancel: 'Cancel', terminateFailed: 'Couldn’t end the process. Try again.' },
    ja: { live: 'ライブ', lastFrame: '最新の画面', onlyInTab: 'タブのみ', alsoOnDesktop: 'デスクトップにも', placement: 'ウィンドウの表示場所',
        inTabHint: 'バックグラウンドで動作し、デスクトップには表示されません', switchToWindow: 'このウィンドウへ切り替え', moveFailed: 'ウィンドウを移動できませんでした。もう一度お試しください。',
        mouse: 'キー・マウス', mouseHint: 'オンにすると、このタブ内でクリック・スクロール・入力ができます。オフの間はタブ内では AI とプラグインだけが操作し、デスクトップ上のウィンドウは常に直接操作できます。', mouseOff: 'キー・マウスはオフです。オンにするとこのタブ内でウィンドウを操作できます。', inputBlocked: '「{app}」は AI が操作中です。タブで「キー・マウス」をオンにするとタブ内で操作できます。', sound: 'サウンド', soundHint: 'オフの間、このアプリは消音されます', soundFailed: 'サウンドを切り替えられませんでした。「画面とシステムオーディオの録音」の許可が必要です。', switchOn: 'オン', switchOff: 'オフ', soundOff: '消音中',
        alreadyOpen: '「{app}」はこのタブで開いています', aiSoundOn: 'AI がサウンドをオンにしました', aiSoundOff: 'AI がサウンドを消音しました', aiInputOn: 'AI がキー・マウスをオンにしました', aiInputOff: 'AI がキー・マウスをオフにしました', aiToTab: 'AI がウィンドウをタブに戻しました', aiToDesktop: 'AI がウィンドウをデスクトップにも表示しました',
        waiting: '画面を待っています', parkForeground: 'Windows では AI はデスクトップに表示されたウィンドウしか操作できないため、このウィンドウはデスクトップに残ります', parkUwp: 'このアプリはバックグラウンドでの操作を受け付けないため、ウィンドウはデスクトップに残ります', parkMinimized: 'ウィンドウが最小化されています。元に戻すと AI が表示・操作できます', parkMissing: 'このウィンドウが見つかりません。閉じられた可能性があります', lockUnavailable: 'デスクトップ上のウィンドウは常に直接操作できます',
        reopenApp: "再度開く", reopenRunningTitle: "このアプリは実行中です。閉じて開き直しますか？", reopenRunningBody: "実行中の「{app}」を閉じて、このタブで開き直します。", reopenRunningConfirm: "閉じて開き直す", reopenFailed: "アプリを開き直せませんでした。もう一度お試しください。",
        dismissNotice: "通知を閉じる", windowOwned: "このアプリのウィンドウは別の会話で開いています。先にそちらのタブを閉じてください。", controlHint: "Esc キーで操作を終了", escStopped: "Esc でデスクトップ操作を終了しました。このターンの間、AI はウィンドウを操作せず別の方法で続けます。", resumeControl: "操作を再開",
        terminateBubble: 'クリックでプロセス終了', terminateTitle: '「{app}」のプロセスを終了しますか？', terminateBody: '「{app}」のウィンドウを閉じて実行中のプロセスを終了します。保存されていない内容は失われる可能性があります。', terminateConfirm: 'プロセスを終了', terminateCancel: 'キャンセル', terminateFailed: 'プロセスを終了できませんでした。もう一度お試しください。' },
    ko: { live: '실시간', lastFrame: '최근 화면', onlyInTab: '탭에만', alsoOnDesktop: '데스크톱에도', placement: '창 표시 위치',
        inTabHint: '백그라운드에서 실행되며 데스크톱에 표시되지 않습니다', switchToWindow: '이 창으로 전환', moveFailed: '창을 옮기지 못했습니다. 다시 시도하세요.',
        mouse: '키보드·마우스', mouseHint: '켜면 이 탭 안에서 클릭·스크롤·입력할 수 있습니다. 꺼져 있으면 탭 안에서는 AI와 플러그인만 조작하며, 데스크톱에 있는 창은 언제나 직접 조작할 수 있습니다.', mouseOff: '키보드·마우스가 꺼져 있습니다. 켜야 탭 안에서 이 창을 조작할 수 있습니다.', inputBlocked: '“{app}”은(는) AI가 조작 중입니다. 탭에서 ‘키보드·마우스’를 켜면 탭 안에서 조작할 수 있습니다.', sound: '소리', soundHint: '꺼져 있으면 이 앱은 음소거됩니다', soundFailed: '소리를 전환하지 못했습니다. ‘화면 및 시스템 오디오 녹음’ 권한이 필요합니다.', switchOn: '켜짐', switchOff: '꺼짐', soundOff: '음소거',
        alreadyOpen: '“{app}”은(는) 이미 이 탭에 열려 있습니다', aiSoundOn: 'AI가 소리를 켰습니다', aiSoundOff: 'AI가 소리를 껐습니다', aiInputOn: 'AI가 키보드·마우스를 켰습니다', aiInputOff: 'AI가 키보드·마우스를 껐습니다', aiToTab: 'AI가 창을 탭으로 되돌렸습니다', aiToDesktop: 'AI가 창을 데스크톱에도 표시했습니다',
        waiting: '화면을 기다리는 중', parkForeground: 'Windows에서는 AI가 데스크톱에 표시된 창만 조작할 수 있어 이 창은 데스크톱에 남습니다', parkUwp: '이 앱은 백그라운드 입력을 받지 않아 창이 데스크톱에 남아야 합니다', parkMinimized: '창이 최소화되었습니다. 복원해야 AI가 보고 조작할 수 있습니다', parkMissing: '이 창을 찾을 수 없습니다. 닫혔을 수 있습니다', lockUnavailable: '데스크톱에 있는 창은 언제나 직접 조작할 수 있습니다',
        reopenApp: "다시 열기", reopenRunningTitle: "이 앱이 이미 실행 중입니다. 닫고 다시 열까요?", reopenRunningBody: "실행 중인 “{app}”을(를) 닫고 현재 탭에서 다시 엽니다.", reopenRunningConfirm: "닫고 다시 열기", reopenFailed: "앱을 다시 열지 못했습니다. 다시 시도하세요.",
        dismissNotice: "알림 닫기", windowOwned: "이 앱 창은 다른 대화에서 열려 있습니다. 먼저 해당 탭을 닫으세요.", controlHint: "Esc 키를 눌러 제어 종료", escStopped: "Esc로 데스크톱 제어를 종료했습니다. 이번 턴 동안 AI는 창을 조작하지 않고 다른 방법으로 계속합니다.", resumeControl: "제어 재개",
        terminateBubble: '클릭하여 프로세스 종료', terminateTitle: '“{app}” 프로세스를 종료할까요?', terminateBody: '“{app}” 창을 닫고 실행 중인 프로세스를 종료합니다. 저장하지 않은 내용은 사라질 수 있습니다.', terminateConfirm: '프로세스 종료', terminateCancel: '취소', terminateFailed: '프로세스를 종료하지 못했습니다. 다시 시도하세요.' },
    es: { live: 'En vivo', lastFrame: 'Última imagen', onlyInTab: 'Solo en la pestaña', alsoOnDesktop: 'También en el escritorio', placement: 'Dónde se muestra la ventana',
        inTabHint: 'Se ejecuta en segundo plano, fuera de tu escritorio', switchToWindow: 'Ir a la ventana', moveFailed: 'No se pudo mover la ventana. Inténtalo de nuevo.',
        mouse: 'Teclado y ratón', mouseHint: 'Actívalo para hacer clic, desplazarte y escribir dentro de esta pestaña. Desactivado, solo la IA y los plugins controlan la pestaña; las ventanas en el escritorio siempre se pueden usar directamente.', mouseOff: 'Teclado y ratón está desactivado. Actívalo para usar esta ventana en la pestaña.', inputBlocked: 'La IA controla «{app}». Activa «Teclado y ratón» en su pestaña para usarla allí.', sound: 'Sonido', soundHint: 'Mientras está desactivado, esta app permanece en silencio', soundFailed: 'No se pudo cambiar el sonido. NextMux necesita el permiso de grabación de pantalla y audio del sistema.', switchOn: 'Sí', switchOff: 'No', soundOff: 'Silencio',
        alreadyOpen: '«{app}» ya está abierta en esta pestaña', aiSoundOn: 'La IA activó el sonido', aiSoundOff: 'La IA silenció el sonido', aiInputOn: 'La IA activó teclado y ratón', aiInputOff: 'La IA desactivó teclado y ratón', aiToTab: 'La IA devolvió la ventana a la pestaña', aiToDesktop: 'La IA mostró la ventana también en el escritorio',
        waiting: 'Esperando la imagen', parkForeground: 'En Windows la IA solo puede usar ventanas visibles en el escritorio, así que esta ventana se queda allí', parkUwp: 'Esta app no acepta acciones en segundo plano, así que su ventana se queda en el escritorio', parkMinimized: 'La ventana está minimizada: restáurala para que la IA pueda verla y usarla', parkMissing: 'No se encuentra esta ventana; puede que se haya cerrado', lockUnavailable: 'Las ventanas en el escritorio siempre se pueden usar directamente',
        reopenApp: "Volver a abrir", reopenRunningTitle: "Esta app ya está en ejecución. ¿Cerrarla y volver a abrirla?", reopenRunningBody: "Cierra «{app}» y vuelve a abrirla en esta pestaña.", reopenRunningConfirm: "Cerrar y volver a abrir", reopenFailed: "No se pudo volver a abrir la app. Inténtalo de nuevo.",
        dismissNotice: "Cerrar notificación", windowOwned: "Esta ventana está abierta en otra conversación. Cierra primero su pestaña.", controlHint: "Pulsa Esc para salir del control", escStopped: "Pulsaste Esc para salir del control del escritorio: durante el resto de este turno la IA no manejará ventanas y seguirá de otra forma.", resumeControl: "Reanudar control",
        terminateBubble: 'Haz clic para cerrar el proceso', terminateTitle: '¿Finalizar el proceso de «{app}»?', terminateBody: 'Se cerrará la ventana de «{app}» y finalizará su proceso en ejecución. Los cambios no guardados podrían perderse.', terminateConfirm: 'Finalizar proceso', terminateCancel: 'Cancelar', terminateFailed: 'No se pudo finalizar el proceso. Inténtalo de nuevo.' },
    fr: { live: 'En direct', lastFrame: 'Dernière image', onlyInTab: 'Onglet seul', alsoOnDesktop: 'Aussi sur le bureau', placement: 'Affichage de la fenêtre',
        inTabHint: 'S’exécute en arrière-plan, hors de votre bureau', switchToWindow: 'Aller à la fenêtre', moveFailed: 'Impossible de déplacer la fenêtre. Réessayez.',
        mouse: 'Clavier et souris', mouseHint: 'Activez-le pour cliquer, faire défiler et taper dans cet onglet. Désactivé, seuls l’IA et les plugins contrôlent l’onglet ; les fenêtres sur le bureau restent toujours utilisables directement.', mouseOff: 'Clavier et souris est désactivé. Activez-le pour utiliser cette fenêtre dans l’onglet.', inputBlocked: 'L’IA contrôle « {app} ». Activez « Clavier et souris » dans son onglet pour l’utiliser.', sound: 'Son', soundHint: 'Désactivé, cette app reste muette', soundFailed: 'Impossible de changer le son. NextMux a besoin de l’autorisation d’enregistrement de l’écran et de l’audio système.', switchOn: 'Oui', switchOff: 'Non', soundOff: 'Muet',
        alreadyOpen: '« {app} » est déjà ouverte dans cet onglet', aiSoundOn: 'L’IA a activé le son', aiSoundOff: 'L’IA a coupé le son', aiInputOn: 'L’IA a activé clavier et souris', aiInputOff: 'L’IA a désactivé clavier et souris', aiToTab: 'L’IA a remis la fenêtre dans l’onglet', aiToDesktop: 'L’IA a aussi affiché la fenêtre sur le bureau',
        waiting: 'En attente de l’image', parkForeground: 'Sous Windows, l’IA ne peut utiliser que les fenêtres affichées sur le bureau : cette fenêtre y reste', parkUwp: 'Cette app n’accepte pas d’actions en arrière-plan : sa fenêtre reste sur le bureau', parkMinimized: 'La fenêtre est réduite : restaurez-la pour que l’IA puisse la voir et l’utiliser', parkMissing: 'Cette fenêtre est introuvable ; elle a peut-être été fermée', lockUnavailable: 'Les fenêtres sur le bureau restent toujours utilisables directement',
        reopenApp: "Rouvrir", reopenRunningTitle: "Cette app est déjà en cours d’exécution. La fermer et la rouvrir ?", reopenRunningBody: "Fermez « {app} » et rouvrez-la dans cet onglet.", reopenRunningConfirm: "Fermer et rouvrir", reopenFailed: "Impossible de rouvrir l’app. Réessayez.",
        dismissNotice: "Fermer la notification", windowOwned: "Cette fenêtre est ouverte dans une autre conversation. Fermez d’abord son onglet.", controlHint: "Appuyez sur Échap pour quitter le contrôle", escStopped: "Vous avez appuyé sur Échap pour quitter le contrôle du bureau : pour le reste de ce tour, l’IA ne manipule plus les fenêtres et continue autrement.", resumeControl: "Reprendre le contrôle",
        terminateBubble: 'Cliquer pour arrêter le processus', terminateTitle: 'Arrêter le processus de « {app} » ?', terminateBody: 'La fenêtre de « {app} » sera fermée et son processus en cours sera arrêté. Les modifications non enregistrées peuvent être perdues.', terminateConfirm: 'Arrêter le processus', terminateCancel: 'Annuler', terminateFailed: 'Impossible d’arrêter le processus. Réessayez.' },
    de: { live: 'Live', lastFrame: 'Letztes Bild', onlyInTab: 'Nur im Tab', alsoOnDesktop: 'Auch auf dem Desktop', placement: 'Wo das Fenster erscheint',
        inTabHint: 'Läuft im Hintergrund, nicht auf Ihrem Desktop', switchToWindow: 'Zum Fenster wechseln', moveFailed: 'Das Fenster ließ sich nicht verschieben. Bitte erneut versuchen.',
        mouse: 'Tastatur & Maus', mouseHint: 'Einschalten, um in diesem Tab zu klicken, zu scrollen und zu tippen. Aus: Im Tab steuern nur die KI und Plugins; Fenster auf dem Desktop lassen sich immer direkt bedienen.', mouseOff: 'Tastatur & Maus ist aus. Schalten Sie es ein, um das Fenster im Tab zu bedienen.', inputBlocked: 'Die KI steuert „{app}“. Schalten Sie in seinem Tab „Tastatur & Maus“ ein, um es im Tab zu bedienen.', sound: 'Ton', soundHint: 'Aus: Diese App bleibt stumm', soundFailed: 'Der Ton ließ sich nicht umschalten. NextMux benötigt die Berechtigung für Bildschirm- und Systemaudioaufnahme.', switchOn: 'An', switchOff: 'Aus', soundOff: 'Stumm',
        alreadyOpen: '„{app}“ ist in diesem Tab bereits geöffnet', aiSoundOn: 'Die KI hat den Ton eingeschaltet', aiSoundOff: 'Die KI hat den Ton stummgeschaltet', aiInputOn: 'Die KI hat Tastatur & Maus eingeschaltet', aiInputOff: 'Die KI hat Tastatur & Maus ausgeschaltet', aiToTab: 'Die KI hat das Fenster zurück in den Tab gelegt', aiToDesktop: 'Die KI zeigt das Fenster auch auf dem Desktop',
        waiting: 'Warte auf das Bild', parkForeground: 'Unter Windows kann die KI nur Fenster auf dem Desktop bedienen, daher bleibt dieses Fenster dort', parkUwp: 'Diese App nimmt keine Eingaben im Hintergrund an, daher bleibt ihr Fenster auf dem Desktop', parkMinimized: 'Das Fenster ist minimiert: Stellen Sie es wieder her, damit die KI es sehen und bedienen kann', parkMissing: 'Dieses Fenster wurde nicht gefunden; es wurde möglicherweise geschlossen', lockUnavailable: 'Fenster auf dem Desktop lassen sich immer direkt bedienen',
        reopenApp: "Erneut öffnen", reopenRunningTitle: "Diese App läuft bereits. Schließen und erneut öffnen?", reopenRunningBody: "Die laufende App „{app}“ schließen und in diesem Tab erneut öffnen.", reopenRunningConfirm: "Schließen und erneut öffnen", reopenFailed: "Die App ließ sich nicht erneut öffnen. Bitte erneut versuchen.",
        dismissNotice: "Hinweis schließen", windowOwned: "Dieses App-Fenster ist in einer anderen Unterhaltung geöffnet. Schließen Sie dort zuerst den Tab.", controlHint: "Esc drücken, um die Steuerung zu beenden", escStopped: "Mit Esc wurde die Desktopsteuerung beendet: Für den Rest dieses Zugs bedient die KI keine Fenster und macht anders weiter.", resumeControl: "Steuerung fortsetzen",
        terminateBubble: 'Klicken, um Prozess zu beenden', terminateTitle: 'Prozess von „{app}“ beenden?', terminateBody: 'Das Fenster von „{app}“ wird geschlossen und der laufende Prozess beendet. Ungespeicherte Inhalte können verloren gehen.', terminateConfirm: 'Prozess beenden', terminateCancel: 'Abbrechen', terminateFailed: 'Der Prozess konnte nicht beendet werden. Bitte erneut versuchen.' },
    'pt-BR': { live: 'Ao vivo', lastFrame: 'Última imagem', onlyInTab: 'Só na aba', alsoOnDesktop: 'Também na área de trabalho', placement: 'Onde a janela aparece',
        inTabHint: 'Roda em segundo plano, fora da sua área de trabalho', switchToWindow: 'Ir para a janela', moveFailed: 'Não foi possível mover a janela. Tente de novo.',
        mouse: 'Teclado e mouse', mouseHint: 'Ative para clicar, rolar e digitar nesta aba. Desativado, só a IA e os plugins controlam a aba; janelas na área de trabalho sempre podem ser usadas diretamente.', mouseOff: 'Teclado e mouse está desativado. Ative para usar esta janela na aba.', inputBlocked: 'A IA está controlando “{app}”. Ative “Teclado e mouse” na aba dele para usar na aba.', sound: 'Som', soundHint: 'Desativado, este app fica sem som', soundFailed: 'Não foi possível mudar o som. O NextMux precisa da permissão de gravação de tela e áudio do sistema.', switchOn: 'Ativo', switchOff: 'Inativo', soundOff: 'Mudo',
        alreadyOpen: '“{app}” já está aberto nesta aba', aiSoundOn: 'A IA ligou o som', aiSoundOff: 'A IA silenciou o som', aiInputOn: 'A IA ativou teclado e mouse', aiInputOff: 'A IA desativou teclado e mouse', aiToTab: 'A IA devolveu a janela à aba', aiToDesktop: 'A IA também mostrou a janela na área de trabalho',
        waiting: 'Aguardando a imagem', parkForeground: 'No Windows a IA só consegue usar janelas visíveis na área de trabalho, então esta janela fica lá', parkUwp: 'Este app não aceita ações em segundo plano, então a janela fica na área de trabalho', parkMinimized: 'A janela está minimizada: restaure-a para que a IA possa vê-la e usá-la', parkMissing: 'Esta janela não foi encontrada; ela pode ter sido fechada', lockUnavailable: 'Janelas na área de trabalho sempre podem ser usadas diretamente',
        reopenApp: "Reabrir", reopenRunningTitle: "Este app já está em execução. Fechar e reabrir?", reopenRunningBody: "Feche “{app}” e abra-o novamente nesta aba.", reopenRunningConfirm: "Fechar e reabrir", reopenFailed: "Não foi possível reabrir o app. Tente novamente.",
        dismissNotice: "Fechar notificação", windowOwned: "Esta janela está aberta em outra conversa. Feche a aba lá primeiro.", controlHint: "Pressione Esc para sair do controle", escStopped: "Você pressionou Esc para sair do controle da área de trabalho: no restante deste turno a IA não opera janelas e continua de outra forma.", resumeControl: "Retomar controle",
        terminateBubble: 'Clique para encerrar o processo', terminateTitle: 'Encerrar o processo de “{app}”?', terminateBody: 'A janela de “{app}” será fechada e o processo em execução será encerrado. Alterações não salvas podem ser perdidas.', terminateConfirm: 'Encerrar processo', terminateCancel: 'Cancelar', terminateFailed: 'Não foi possível encerrar o processo. Tente de novo.' },
    ru: { live: 'В эфире', lastFrame: 'Последний кадр', onlyInTab: 'Только во вкладке', alsoOnDesktop: 'И на рабочем столе', placement: 'Где показывать окно',
        inTabHint: 'Работает в фоне и не занимает рабочий стол', switchToWindow: 'Перейти к окну', moveFailed: 'Не удалось переместить окно. Попробуйте ещё раз.',
        mouse: 'Клавиатура и мышь', mouseHint: 'Включите, чтобы нажимать, прокручивать и печатать внутри этой вкладки. Когда выключено, во вкладке управляют только ИИ и плагины, а окном на рабочем столе всегда можно пользоваться напрямую.', mouseOff: 'Клавиатура и мышь выключены. Включите, чтобы управлять окном во вкладке.', inputBlocked: '«{app}» управляет ИИ. Включите «Клавиатура и мышь» в его вкладке, чтобы работать во вкладке.', sound: 'Звук', soundHint: 'Когда выключено, приложение без звука', soundFailed: 'Не удалось переключить звук. NextMux нужно разрешение на запись экрана и системного звука.', switchOn: 'Вкл', switchOff: 'Выкл', soundOff: 'Без звука',
        alreadyOpen: '«{app}» уже открыто в этой вкладке', aiSoundOn: 'ИИ включил звук', aiSoundOff: 'ИИ выключил звук', aiInputOn: 'ИИ включил клавиатуру и мышь', aiInputOff: 'ИИ выключил клавиатуру и мышь', aiToTab: 'ИИ вернул окно во вкладку', aiToDesktop: 'ИИ показал окно и на рабочем столе',
        waiting: 'Ожидание изображения', parkForeground: 'В Windows ИИ может работать только с окнами на рабочем столе, поэтому это окно остаётся там', parkUwp: 'Это приложение не принимает ввод в фоне, поэтому окно остаётся на рабочем столе', parkMinimized: 'Окно свёрнуто: разверните его, чтобы ИИ мог его видеть и управлять им', parkMissing: 'Окно не найдено; возможно, оно закрыто', lockUnavailable: 'Окном на рабочем столе всегда можно пользоваться напрямую',
        reopenApp: "Открыть снова", reopenRunningTitle: "Приложение уже запущено. Закрыть и открыть снова?", reopenRunningBody: "Закройте работающее приложение «{app}» и откройте его снова в этой вкладке.", reopenRunningConfirm: "Закрыть и открыть снова", reopenFailed: "Не удалось открыть приложение снова. Повторите попытку.",
        dismissNotice: "Закрыть уведомление", windowOwned: "Это окно открыто в другой беседе. Сначала закройте его вкладку там.", controlHint: "Нажмите Esc, чтобы завершить управление", escStopped: "Вы нажали Esc и завершили управление рабочим столом: до конца этого хода ИИ не управляет окнами и продолжает другим способом.", resumeControl: "Возобновить управление",
        terminateBubble: 'Нажмите, чтобы завершить процесс', terminateTitle: 'Завершить процесс «{app}»?', terminateBody: 'Окно «{app}» будет закрыто, а его запущенный процесс завершён. Несохранённые данные могут быть потеряны.', terminateConfirm: 'Завершить процесс', terminateCancel: 'Отмена', terminateFailed: 'Не удалось завершить процесс. Попробуйте ещё раз.' },
    ar: { live: 'مباشر', lastFrame: 'آخر لقطة', onlyInTab: 'في علامة التبويب فقط', alsoOnDesktop: 'وعلى سطح المكتب أيضًا', placement: 'مكان عرض النافذة',
        inTabHint: 'تعمل في الخلفية بعيدًا عن سطح مكتبك', switchToWindow: 'الانتقال إلى النافذة', moveFailed: 'تعذّر نقل النافذة. حاول مرة أخرى.',
        mouse: 'لوحة المفاتيح والفأرة', mouseHint: 'فعّلها للنقر والتمرير والكتابة داخل علامة التبويب هذه. عند الإيقاف يتحكم الذكاء الاصطناعي والإضافات فقط داخل علامة التبويب، بينما يمكن دائمًا استخدام النافذة مباشرةً على سطح المكتب.', mouseOff: 'لوحة المفاتيح والفأرة متوقفة. فعّلها لاستخدام هذه النافذة داخل علامة التبويب.', inputBlocked: 'يتحكم الذكاء الاصطناعي في «{app}». فعّل «لوحة المفاتيح والفأرة» في علامة تبويبه لاستخدامه هناك.', sound: 'الصوت', soundHint: 'عند إيقافه يبقى هذا التطبيق صامتًا', soundFailed: 'تعذّر تبديل الصوت. يحتاج NextMux إلى إذن تسجيل الشاشة وصوت النظام.', switchOn: 'مفعّل', switchOff: 'متوقف', soundOff: 'مكتوم',
        alreadyOpen: '«{app}» مفتوح بالفعل في علامة التبويب هذه', aiSoundOn: 'شغّل الذكاء الاصطناعي الصوت', aiSoundOff: 'كتم الذكاء الاصطناعي الصوت', aiInputOn: 'فعّل الذكاء الاصطناعي لوحة المفاتيح والفأرة', aiInputOff: 'أوقف الذكاء الاصطناعي لوحة المفاتيح والفأرة', aiToTab: 'أعاد الذكاء الاصطناعي النافذة إلى علامة التبويب', aiToDesktop: 'أظهر الذكاء الاصطناعي النافذة على سطح المكتب أيضًا',
        waiting: 'بانتظار الصورة', parkForeground: 'في Windows يمكن للذكاء الاصطناعي العمل فقط في النوافذ الظاهرة على سطح المكتب، لذا تبقى هذه النافذة هناك', parkUwp: 'لا يقبل هذا التطبيق الإدخال في الخلفية، لذا تبقى نافذته على سطح المكتب', parkMinimized: 'النافذة مصغّرة: استعدها ليتمكن الذكاء الاصطناعي من رؤيتها واستخدامها', parkMissing: 'تعذّر العثور على هذه النافذة؛ ربما أُغلقت', lockUnavailable: 'يمكن دائمًا استخدام النافذة مباشرةً على سطح المكتب',
        reopenApp: "إعادة الفتح", reopenRunningTitle: "هذا التطبيق يعمل بالفعل. هل تريد إغلاقه وإعادة فتحه؟", reopenRunningBody: "أغلق التطبيق «{app}» الجاري تشغيله وأعد فتحه في علامة التبويب الحالية.", reopenRunningConfirm: "إغلاق وإعادة فتح", reopenFailed: "تعذرت إعادة فتح التطبيق. حاول مجددًا.",
        dismissNotice: "إغلاق الإشعار", windowOwned: "نافذة هذا التطبيق مفتوحة في محادثة أخرى. أغلق علامة تبويبها هناك أولاً.", controlHint: "اضغط Esc للخروج من التحكم", escStopped: "ضغطت Esc لإنهاء التحكم في سطح المكتب: لبقية هذا الدور لن يشغّل الذكاء الاصطناعي النوافذ وسيتابع بطريقة أخرى.", resumeControl: "استئناف التحكم",
        terminateBubble: 'انقر لإنهاء العملية', terminateTitle: 'إنهاء عملية «{app}»؟', terminateBody: 'سيتم إغلاق نافذة «{app}» وإنهاء عمليتها قيد التشغيل. قد تُفقد التغييرات غير المحفوظة.', terminateConfirm: 'إنهاء العملية', terminateCancel: 'إلغاء', terminateFailed: 'تعذّر إنهاء العملية. حاول مرة أخرى.' },
    hi: { live: 'लाइव', lastFrame: 'अंतिम फ़्रेम', onlyInTab: 'सिर्फ़ टैब में', alsoOnDesktop: 'डेस्कटॉप पर भी', placement: 'विंडो कहाँ दिखे',
        inTabHint: 'बैकग्राउंड में चलती है, आपके डेस्कटॉप पर नहीं', switchToWindow: 'विंडो पर जाएँ', moveFailed: 'विंडो को हटाया नहीं जा सका। फिर से कोशिश करें।',
        mouse: 'कीबोर्ड-माउस', mouseHint: 'चालू करने पर इस टैब के अंदर क्लिक, स्क्रॉल और टाइप कर सकते हैं। बंद रहने पर टैब के अंदर सिर्फ़ AI और प्लगइन चलाते हैं; डेस्कटॉप पर विंडो को हमेशा सीधे चलाया जा सकता है।', mouseOff: 'कीबोर्ड-माउस बंद है। टैब के अंदर इस विंडो को चलाने के लिए इसे चालू करें।', inputBlocked: '“{app}” को AI चला रहा है। टैब में चलाने के लिए उसके टैब में “कीबोर्ड-माउस” चालू करें।', sound: 'ध्वनि', soundHint: 'बंद रहने पर यह ऐप म्यूट रहता है', soundFailed: 'ध्वनि नहीं बदली जा सकी। NextMux को स्क्रीन और सिस्टम ऑडियो रिकॉर्डिंग की अनुमति चाहिए।', switchOn: 'चालू', switchOff: 'बंद', soundOff: 'म्यूट',
        alreadyOpen: '“{app}” इस टैब में पहले से खुला है', aiSoundOn: 'AI ने ध्वनि चालू की', aiSoundOff: 'AI ने ध्वनि म्यूट की', aiInputOn: 'AI ने कीबोर्ड-माउस चालू किया', aiInputOff: 'AI ने कीबोर्ड-माउस बंद किया', aiToTab: 'AI ने विंडो को टैब में वापस रखा', aiToDesktop: 'AI ने विंडो को डेस्कटॉप पर भी दिखाया',
        waiting: 'तस्वीर का इंतज़ार', parkForeground: 'Windows पर AI सिर्फ़ डेस्कटॉप पर दिख रही विंडो चला सकता है, इसलिए यह विंडो वहीं रहती है', parkUwp: 'यह ऐप बैकग्राउंड में इनपुट नहीं लेता, इसलिए इसकी विंडो डेस्कटॉप पर रहती है', parkMinimized: 'विंडो छोटी (मिनिमाइज़) है: AI को दिखाने और चलाने के लिए इसे वापस खोलें', parkMissing: 'यह विंडो नहीं मिली; शायद बंद हो गई है', lockUnavailable: 'डेस्कटॉप पर विंडो को हमेशा सीधे चलाया जा सकता है',
        reopenApp: "फिर से खोलें", reopenRunningTitle: "यह ऐप पहले से चल रहा है। क्या इसे बंद करके फिर से खोलें?", reopenRunningBody: "चल रहे “{app}” को बंद करके मौजूदा टैब में फिर से खोलें।", reopenRunningConfirm: "बंद करके फिर से खोलें", reopenFailed: "ऐप फिर से नहीं खुल सका। दोबारा कोशिश करें.",
        dismissNotice: "सूचना बंद करें", windowOwned: "यह ऐप विंडो दूसरी बातचीत में खुली है। पहले वहाँ उसका टैब बंद करें।", controlHint: "नियंत्रण से बाहर निकलने के लिए Esc दबाएँ", escStopped: "आपने डेस्कटॉप नियंत्रण समाप्त करने के लिए Esc दबाया: इस बारी के बाकी हिस्से में AI विंडो नहीं चलाएगा और दूसरे तरीके से जारी रखेगा।", resumeControl: "नियंत्रण फिर शुरू करें",
        terminateBubble: 'प्रोसेस बंद करने के लिए क्लिक करें', terminateTitle: '“{app}” प्रोसेस समाप्त करें?', terminateBody: 'यह “{app}” विंडो को बंद कर देगा और इसके चल रहे प्रोसेस को समाप्त कर देगा। बिना सहेजे गए बदलाव खो सकते हैं।', terminateConfirm: 'प्रोसेस समाप्त करें', terminateCancel: 'रद्द करें', terminateFailed: 'प्रोसेस समाप्त नहीं किया जा सका। फिर से कोशिश करें।' }
};

/** A window's reason (apps/desktop computer-window-view on Windows) → its explanation. */
const PARK_REASON_TEXT: Readonly<Record<string, WindowTextKey>> = {
    foreground_input_required: 'parkForeground', background_input_unsupported: 'parkUwp', window_minimized: 'parkMinimized', window_not_found: 'parkMissing'
};

function uncheckedConversationWindowText(locale: NextMuxDesktopLocale, key: WindowTextKey, values: Readonly<Record<string, string>> = {}): string {
    return (windowCatalog[locale]?.[key] || windowCatalog.en[key]).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}
export type { WindowTextKey as ConversationWindowTextKey };

export type ConversationWindowPlacement = 'tab' | 'desktop';

/** What this computer can do with app windows in tabs (apps/desktop/computer-window-view.cjs). */
export interface ComputerViewCapability {
    readonly live: boolean;
    readonly park: boolean;
    readonly pointer?: boolean;
    readonly sound?: boolean;
    /** Windows: the user's keyboard & mouse can be kept away from a tab's window on the desktop. */
    readonly lock?: boolean;
    readonly keyHold?: boolean;
    readonly chords?: boolean;
    readonly ocr?: boolean;
    readonly ocrLanguages?: readonly string[];
    readonly parkReason?: string;
    readonly preference: ConversationWindowPlacement;
}

export type ConversationWindowPointer = {
    readonly kind: 'click' | 'doubleClick' | 'scroll';
    /** Fractions of the window (0–1), so the tab's scaling never matters. */
    readonly x: number;
    readonly y: number;
    readonly direction?: 'up' | 'down' | 'left' | 'right';
    readonly amount?: number;
    readonly button?: 'left' | 'right';
    /** Windows: both clicks of a double-click in one input call. */
    readonly whole?: boolean;
} | {
    readonly kind: 'drag';
    /** Fractions of the window (0–1). Left button only. */
    readonly from: { readonly x: number; readonly y: number };
    readonly to: { readonly x: number; readonly y: number };
    readonly durationMs?: number;
};

/** What a tab can do with the app window it shows (this computer's windows only). */
export interface ConversationWindowControls {
    /** The window can live in the tab only, off the user's screens (macOS). */
    readonly canPark: boolean;
    /** The tab's mouse switch can reach the window. */
    readonly canPoint: boolean;
    /** The tab's sound switch can mute the app. */
    readonly canMute: boolean;
    /** Start the live view: the window's own capture stream, where the window is and whether its sound is on. */
    readonly start: () => Promise<{ readonly stream?: MediaStream; readonly placement?: ConversationWindowPlacement; readonly sound?: boolean }>;
    /** Move the window to the tab only, or onto the desktop in front. Resolves to where it is afterwards. */
    readonly place: (placement: ConversationWindowPlacement) => Promise<ConversationWindowPlacement | undefined>;
    readonly pointer: (input: ConversationWindowPointer) => Promise<boolean>;
    /** Resolves to the sound state afterwards, or undefined when it could not change. */
    readonly setSound: (on: boolean) => Promise<boolean | undefined>;
    readonly setVisible?: (visible: boolean) => Promise<void>;
    /** The tab's 键鼠 switch, told to the app side: off, the window ignores the user's own clicks and typing on the desktop too. */
    readonly setUserInput?: (on: boolean) => Promise<void>;
    /**
     * The switches as they are now, shared by the tab's header and the AI's tabs.set: when either changes one, the
     * other sees it (subscribe returns the unsubscribe function).
     */
    readonly state?: { readonly placement?: ConversationWindowPlacement; readonly sound?: boolean; readonly userInput: boolean; readonly parkReason?: string };
    /** False when this computer cannot keep the user's own input away from the window on the desktop (Windows without the input hook). */
    readonly canLock?: boolean;
    readonly subscribe?: (listener: () => void) => () => void;
    /** Typing from the tab while the 键鼠 switch is on: text (IME output included), or one key with modifiers. */
    readonly keys?: (input: { readonly text?: string; readonly key?: string; readonly modifiers?: readonly string[] }) => Promise<boolean>;
    /** Close the window and terminate its running process on user confirmation. */
    readonly terminateProcess?: () => Promise<boolean>;
}

const SPECIAL_KEYS: Readonly<Record<string, string>> = {
    Enter: 'enter', Backspace: 'backspace', Tab: 'tab', Escape: 'escape', Delete: 'delete', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `f${index + 1}`]))
};
/** A key press in the tab as the helper's key name and modifiers; undefined when it is plain text (sent as typed text). */
function keyChord(event: React.KeyboardEvent): { key: string; modifiers: string[] } | undefined {
    const modifiers = [event.metaKey && 'cmd', event.ctrlKey && 'ctrl', event.altKey && 'alt'].filter((value): value is string => Boolean(value));
    const special = SPECIAL_KEYS[event.key];
    if (!special && !modifiers.length) return undefined;
    const code = event.code;
    const key = special || (/^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : /^Digit\d$/.test(code) ? code.slice(5)
        : { Space: 'space', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`' }[code]);
    if (!key) return undefined;
    return { key, modifiers: event.shiftKey ? [...modifiers, 'shift'] : modifiers };
}


/**
 * A captured window's own corner radius, in video pixels. macOS and Windows 11 windows have rounded corners; the
 * capture leaves the area outside them transparent, which a video shows as black. Walking the top-left diagonal
 * to the first non-black pixel gives the radius (d = r·(1 − 1/√2)), so any OS version and scale is measured, not guessed.
 * 0 when the corner is not black (square windows, or content reaching the corner).
 */
function captureCornerRadius(video: HTMLVideoElement): number {
    const size = Math.min(96, video.videoWidth, video.videoHeight);
    if (size < 16) return 0;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return 0;
        context.drawImage(video, 0, 0, size, size, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        const dark = (x: number, y: number): boolean => { const i = (y * size + x) * 4; return pixels[i + 3] < 16 || pixels[i] + pixels[i + 1] + pixels[i + 2] < 24; };
        if (!dark(0, 0)) return 0;
        let edge = 0;
        while (edge < size && dark(edge, edge)) edge++;
        // Black all along the diagonal is dark content reaching the corner, not a transparent rounded corner.
        return edge >= size ? 0 : Math.round(edge / (1 - Math.SQRT1_2));
    } catch { return 0; }
}

/** Where a pointer event falls on the video's picture (object-fit: contain), as fractions of the window. */
function pictureFraction(video: HTMLVideoElement, clientX: number, clientY: number): { x: number; y: number } | undefined {
    const rect = video.getBoundingClientRect();
    if (!video.videoWidth || !video.videoHeight || !rect.width || !rect.height) return undefined;
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const width = video.videoWidth * scale, height = video.videoHeight * scale;
    const x = (clientX - rect.left - (rect.width - width) / 2) / width;
    const y = (clientY - rect.top - (rect.height - height) / 2) / height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined;
}

/**
 * The body of an AI-opened tab: the live window (else its last frame, else a waiting state) under a slim toolbar.
 * The tab strip already names the tab, so the body does not repeat it.
 */
/** What a skill plugin adds to its tab: a header control, its status bar and its readings over the picture. */
export interface ConversationTabPluginParts {
    readonly headerExtra?: React.ReactNode;
    readonly bar?: React.ReactNode;
    readonly overlay?: React.ReactNode;
    /** Plugin studio: pick areas (drag) and points with their colour (click) on the live picture, as plugin.json values. */
    readonly studio?: { readonly labels: Readonly<Record<'studio' | 'studioHint' | 'copy' | 'copied' | 'close' | 'studioArea' | 'studioPoint', string>>; onClose(): void };
}

const round4 = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;

/** The studio layer over the picture: a dragged box becomes a rect, a click a point with the colour under it. */
function PluginStudio(props: { readonly video: React.RefObject<HTMLVideoElement | null>; readonly box: { left: number; top: number; width: number; height: number };
    readonly studio: NonNullable<ConversationTabPluginParts['studio']> }): React.ReactElement {
    const { labels } = props.studio;
    const [drag, setDrag] = React.useState<{ x0: number; y0: number; x1: number; y1: number }>();
    const [picked, setPicked] = React.useState<{ kind: 'studioArea' | 'studioPoint'; json: string; swatch?: string }>();
    const [copied, setCopied] = React.useState(false);
    const at = (event: React.PointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: round4((event.clientX - rect.left) / rect.width), y: round4((event.clientY - rect.top) / rect.height) };
    };
    const colour = (x: number, y: number): string | undefined => {
        const video = props.video.current;
        if (!video?.videoWidth) return undefined;
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return undefined;
        context.drawImage(video, Math.min(video.videoWidth - 1, Math.floor(x * video.videoWidth)), Math.min(video.videoHeight - 1, Math.floor(y * video.videoHeight)), 1, 1, 0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`;
    };
    const finish = (event: React.PointerEvent<HTMLDivElement>): void => {
        if (!drag) return;
        const end = at(event);
        const x = Math.min(drag.x0, end.x), y = Math.min(drag.y0, end.y), width = Math.abs(end.x - drag.x0), height = Math.abs(end.y - drag.y0);
        setDrag(undefined);
        setCopied(false);
        if (width > 0.004 || height > 0.004) setPicked({ kind: 'studioArea', json: `"rect": [${round4(x)}, ${round4(y)}, ${round4(width)}, ${round4(height)}]` });
        else {
            const swatch = colour(end.x, end.y);
            setPicked({ kind: 'studioPoint', json: `[${end.x}, ${end.y}, "${swatch || '#000000'}"]`, swatch });
        }
    };
    const shown = drag && { left: `${Math.min(drag.x0, drag.x1) * 100}%`, top: `${Math.min(drag.y0, drag.y1) * 100}%`, width: `${Math.abs(drag.x1 - drag.x0) * 100}%`, height: `${Math.abs(drag.y1 - drag.y0) * 100}%` };
    return <>
        <div className='nmx-plugin-studio' style={props.box}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); const start = at(event); setDrag({ x0: start.x, y0: start.y, x1: start.x, y1: start.y }); }}
            onPointerMove={event => { if (drag) { const point = at(event); setDrag({ ...drag, x1: point.x, y1: point.y }); } }}
            onPointerUp={finish}>
            {shown && <div className='nmx-plugin-studio-box' style={shown}></div>}
        </div>
        <div className='nmx-plugin-studio-panel' role='dialog' aria-label={labels.studio}>
            <header><strong>{labels.studio}</strong><button type='button' aria-label={labels.close} title={labels.close} onClick={props.studio.onClose}>×</button></header>
            {picked ? <div className='nmx-plugin-studio-result'>
                <span>{labels[picked.kind]}{picked.swatch && <i style={{ background: picked.swatch }} aria-hidden='true'></i>}</span>
                <code data-nmx-literal>{picked.json}</code>
                <button type='button' onClick={() => void navigator.clipboard?.writeText(picked.json).then(() => setCopied(true), () => undefined)}>{copied ? labels.copied : labels.copy}</button>
            </div> : <p>{labels.studioHint}</p>}
        </div>
    </>;
}

const LIVE_BUBBLE_STORAGE_KEY = 'nextmux.desktop.appTabLiveHint.v1';
let liveBubbleFallback = { entries: 0, lastEntry: -4, apps: {} as Record<string, number> };
export function resetLiveBubbleCounterForTest(): void {
    liveBubbleFallback = { entries: 0, lastEntry: -4, apps: {} };
}
/** Claim before showing: remounts and restarts share the five-entry and daily limits. */
export function claimAppTabLiveHint(app: string, storage?: Pick<Storage, 'getItem' | 'setItem'>, now = Date.now()): boolean {
    let state = liveBubbleFallback;
    try {
        const saved = JSON.parse(storage?.getItem(LIVE_BUBBLE_STORAGE_KEY) || 'null');
        if (saved && Number.isSafeInteger(saved.entries) && saved.entries >= 0 && Number.isSafeInteger(saved.lastEntry)
            && saved.apps && typeof saved.apps === 'object' && !Array.isArray(saved.apps)) state = saved;
    } catch { /* denied or malformed storage: use the session record */ }
    const key = app.trim().toLowerCase();
    const entries = state.entries + 1;
    const last = state.apps[key];
    const show = Boolean(key) && entries - state.lastEntry >= 5 && (!Number.isFinite(last) || now - last >= 86_400_000);
    state = { entries, lastEntry: show ? entries : state.lastEntry, apps: { ...state.apps, ...(show ? { [key]: now } : {}) } };
    liveBubbleFallback = state;
    try { storage?.setItem(LIVE_BUBBLE_STORAGE_KEY, JSON.stringify(state)); } catch { /* session fallback */ }
    return show;
}

export function ConversationVisualTabView(props: { readonly locale: NextMuxDesktopLocale; readonly tab: ConversationVisualTab; readonly controls?: ConversationWindowControls;
    readonly plugin?: ConversationTabPluginParts; readonly announcement?: { readonly id: number; readonly text: string };
    readonly onSelectWindow?: (pid: number, windowId: number) => void;
    readonly onReopenApp?: (mode: 'check_or_open' | 'restart') => Promise<'opened' | 'running' | 'failed'> }): React.ReactElement {
    const [selectedWindow, setSelectedWindow] = typeof React.useState === 'function'
        ? React.useState<{ readonly tabId: string; readonly pid: number; readonly windowId: number }>()
        : [undefined, () => undefined];
    const effectiveTab = props.onSelectWindow || !selectedWindow || selectedWindow.tabId !== props.tab.id
        ? props.tab
        : selectTabWindow(props.tab, selectedWindow.pid, selectedWindow.windowId);
    const handleSelectWindow = (pid: number, windowId: number): void => {
        if (props.onSelectWindow) props.onSelectWindow(pid, windowId);
        else setSelectedWindow({ tabId: props.tab.id, pid, windowId });
    };
    const owner = `${effectiveTab.id}:${effectiveTab.windowRef?.pid ?? ''}:${effectiveTab.windowRef?.windowId ?? ''}`;
    return <LiveTabView key={owner} {...props} tab={effectiveTab} onSelectWindow={handleSelectWindow} />;
}

function LiveTabView(props: { readonly locale: NextMuxDesktopLocale; readonly tab: ConversationVisualTab; readonly controls?: ConversationWindowControls;
    readonly plugin?: ConversationTabPluginParts; readonly announcement?: { readonly id: number; readonly text: string };
    readonly onSelectWindow?: (pid: number, windowId: number) => void;
    readonly onReopenApp?: (mode: 'check_or_open' | 'restart') => Promise<'opened' | 'running' | 'failed'> }): React.ReactElement {
    const { locale, tab, controls } = props;
    const kind = tab.kind === 'virtual-machine' ? 'virtualMachine' : tab.kind === 'local-desktop' ? 'localDesktop' : 'remoteDesktop';
    const video = React.useRef<HTMLVideoElement>(null);
    const latest = React.useRef(controls);
    latest.current = controls;
    const [live, setLive] = React.useState(false);
    const [placement, setPlacement] = React.useState<ConversationWindowPlacement | undefined>(() => controls?.state?.placement);
    const [sound, setSound] = React.useState<boolean | undefined>(() => controls?.state?.sound);
    const [moving, setMoving] = React.useState(false);
    const [notice, setNotice] = React.useState<WindowTextKey>();
    const [reopening, setReopening] = React.useState(false);
    const [reopenModalOpen, setReopenModalOpen] = React.useState(false);
    const reopenDialog = React.useRef<HTMLDivElement>(null);
    const reopenBusy = React.useRef(false);
    const reopenMounted = React.useRef(true);
    React.useEffect(() => { reopenMounted.current = true; return () => { reopenMounted.current = false; }; }, []);
    const reopenApp = (mode: 'check_or_open' | 'restart'): void => {
        if (reopenBusy.current || !props.onReopenApp) return;
        reopenBusy.current = true;
        setReopening(true);
        setNotice(undefined);
        void props.onReopenApp(mode).then(result => {
            reopenBusy.current = false;
            if (!reopenMounted.current) return;
            setReopening(false);
            setReopenModalOpen(result === 'running');
            if (result === 'failed') setNotice('reopenFailed');
        }).catch(() => {
            reopenBusy.current = false;
            if (!reopenMounted.current) return;
            setReopening(false);
            setReopenModalOpen(false);
            setNotice('reopenFailed');
        });
    };
    const handleReopenClick = (): void => reopenApp('check_or_open');
    React.useEffect(() => {
        if (!reopenModalOpen) return undefined;
        const previous = document.activeElement as HTMLElement | null;
        const dialog = reopenDialog.current;
        const focusable = (): HTMLElement[] => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') || []);
        (focusable()[0] || dialog)?.focus({ preventScroll: true });
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopImmediatePropagation();
                if (!reopenBusy.current) setReopenModalOpen(false);
            } else if (event.key === 'Tab') {
                const items = focusable(), first = items[0], last = items[items.length - 1];
                if (!first) { event.preventDefault(); dialog?.focus(); }
                else if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
                    event.preventDefault(); last.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
                    event.preventDefault(); first.focus();
                }
            }
        };
        const onFocus = (event: FocusEvent): void => {
            if (!dialog?.contains(event.target as Node | null)) (focusable()[0] || dialog)?.focus({ preventScroll: true });
        };
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('focusin', onFocus);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('focusin', onFocus);
            if (previous?.isConnected) previous.focus({ preventScroll: true });
        };
    }, [reopenModalOpen]);

    // A move restarts the capture, so the view follows the window across displays.
    const [generation, setGeneration] = React.useState(0);
    const streamKey = controls && tab.windowRef ? `${tab.windowRef.pid}:${tab.windowRef.windowId}` : '';
    // The 键鼠 switch lives with the window's controls (off until the user or the AI turns it on; never saved).
    const [mouse, setMouse] = React.useState(() => Boolean(controls?.state?.userInput));
    // Why the window cannot live only in the tab on this computer (Windows), shown on the disabled choice.
    const [parkReason, setParkReason] = React.useState(controls?.state?.parkReason);
    React.useEffect(() => {
        setMouse(Boolean(latest.current?.state?.userInput));
        setSound(latest.current?.state?.sound);
        if (latest.current?.state?.placement) setPlacement(latest.current.state.placement);
    }, [streamKey]);
    // Where the window's picture sits inside the video element (letterboxed): a plugin's readings are drawn there.
    const screen = React.useRef<HTMLDivElement>(null);
    const [pictureBox, setPictureBox] = React.useState<{ left: number; top: number; width: number; height: number }>();
    const wantsOverlay = Boolean(props.plugin?.overlay || props.plugin?.studio);
    React.useEffect(() => {
        const element = video.current, container = screen.current;
        if (!wantsOverlay || !live || !element || !container) return undefined;
        const measure = (): void => {
            if (!element.videoWidth || !element.videoHeight) return;
            const box = element.getBoundingClientRect(), outer = container.getBoundingClientRect();
            const scale = Math.min(box.width / element.videoWidth, box.height / element.videoHeight);
            const width = element.videoWidth * scale, height = element.videoHeight * scale;
            setPictureBox({ left: box.left - outer.left + (box.width - width) / 2, top: box.top - outer.top + (box.height - height) / 2, width, height });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        element.addEventListener('loadedmetadata', measure);
        measure();
        return () => { observer.disconnect(); element.removeEventListener('loadedmetadata', measure); };
    }, [wantsOverlay, live]);
    // The window's size on screen (points): a capture on a Retina display has twice the pixels of the same window
    // parked off-screen, so the picture is shown at the window's own size, never at its pixel count, and scaled
    // down (never up) to fit the tab.
    const [natural, setNatural] = React.useState<{ width: number; height: number }>();
    // The window's rounded corners, in the window's own points (see captureCornerRadius), clipped so no black shows.
    const [cornerRadius, setCornerRadius] = React.useState(0);
    // The picture's box is fitted exactly (never letterboxed inside the element), so the clip follows its corners.
    const [screenSize, setScreenSize] = React.useState<{ width: number; height: number }>();
    React.useEffect(() => {
        const box = screen.current;
        if (!box) return undefined;
        const observer = new ResizeObserver(() => {
            const width = box.clientWidth, height = box.clientHeight;
            setScreenSize(prev => prev && prev.width === width && prev.height === height ? prev : { width, height });
        });
        observer.observe(box);
        return () => observer.disconnect();
    }, []);
    const fit = natural && screenSize ? Math.min(1, screenSize.width / natural.width, screenSize.height / natural.height) : 1;
    const pictureStyle: React.CSSProperties | undefined = natural ? { width: natural.width * fit, height: natural.height * fit,
        ...(cornerRadius ? { borderRadius: cornerRadius * fit } : {}) } : undefined;
    const placementRef = React.useRef(placement);
    placementRef.current = placement;
    // Nobody sees the picture while NextMux is minimised or fully covered (Chromium reports that as hidden): the
    // capture stops then, and starts again when the window shows, so an open tab costs nothing in the background.
    const [visible, setVisible] = React.useState(() => document.visibilityState !== 'hidden');
    React.useEffect(() => {
        const update = (): void => setVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', update);
        return () => document.removeEventListener('visibilitychange', update);
    }, []);
    React.useEffect(() => {
        const target = latest.current;
        void target?.setVisible?.(visible);
        return () => { void target?.setVisible?.(false); };
    }, [streamKey, visible]);
    React.useEffect(() => {
        setLive(false);
        if (!streamKey || !visible) return undefined;
        let stream: MediaStream | undefined;
        let disposed = false;
        const element = video.current;
        let measuredWidth = 0, measuredHeight = 0, measuredScale = 0;
        const measure = (): void => {
            if (!element?.videoWidth || !element.videoHeight) return;
            const scale = placementRef.current === 'tab' ? 1 : Math.max(1, window.devicePixelRatio || 1);
            const width = element.videoWidth / scale, height = element.videoHeight / scale;
            setNatural(prev => prev && prev.width === width && prev.height === height ? prev : { width, height });
            if (element.videoWidth !== measuredWidth || element.videoHeight !== measuredHeight || scale !== measuredScale) {
                measuredWidth = element.videoWidth; measuredHeight = element.videoHeight; measuredScale = scale;
                setCornerRadius(Math.min(32, captureCornerRadius(element) / scale));
            }
        };
        // Shown once the first frame is decoded, so the last frame never gives way to an empty or resizing box.
        const reveal = (): void => { if (!disposed) { measure(); setLive(true); } };
        element?.addEventListener('resize', measure);
        void latest.current?.start().then(result => {
            if (disposed) { result.stream?.getTracks().forEach(track => track.stop()); return; }
            if (result.placement) { placementRef.current = result.placement; setPlacement(result.placement); }
            if (result.sound !== undefined) setSound(result.sound);
            stream = result.stream;
            if (!stream || !element) return;
            element.srcObject = stream;
            if (element.readyState >= 2) reveal(); else element.addEventListener('loadeddata', reveal, { once: true });
            void element.play().catch(() => undefined);
            // The app closed the window: fall back to the last frame.
            stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (!disposed) setLive(false); });
        }).catch(() => undefined);
        return () => {
            disposed = true;
            element?.removeEventListener('resize', measure);
            element?.removeEventListener('loadeddata', reveal);
            stream?.getTracks().forEach(track => track.stop());
            if (element) element.srcObject = null;
        };
    }, [streamKey, generation, visible]);
    // What the AI just did to this tab ("already open", "muted the sound" …), for a few seconds.
    const [announced, setAnnounced] = React.useState<string>();
    // Each source owns its fade state so an older announcement cannot fade a newer notice.
    const [announcedFading, setAnnouncedFading] = React.useState(false);
    const [noticeFading, setNoticeFading] = React.useState(false);
    const toastFading = notice ? noticeFading : announcedFading;
    React.useEffect(() => {
        if (!props.announcement || Date.now() - props.announcement.id >= 3000) return undefined;
        setAnnounced(props.announcement.text);
        setAnnouncedFading(false);
        const fadeTimer = setTimeout(() => setAnnouncedFading(true), 2700);
        const removeTimer = setTimeout(() => { setAnnounced(undefined); setAnnouncedFading(false); }, 3000);
        return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
    }, [props.announcement?.id]);
    React.useEffect(() => {
        if (!notice) return undefined;
        setNoticeFading(false);
        const fadeTimer = setTimeout(() => setNoticeFading(true), 2700);
        const removeTimer = setTimeout(() => { setNotice(undefined); setNoticeFading(false); }, 3000);
        return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
    }, [notice]);
    const dismissToast = (): void => {
        setNoticeFading(false); setAnnouncedFading(false); setNotice(undefined); setAnnounced(undefined);
    };
    const move = (next: ConversationWindowPlacement): void => {
        if (moving || !latest.current) return;
        setMoving(true); setNotice(undefined);
        void latest.current.place(next).then(result => {
            if (result) {
                setPlacement(result);
                if (result !== placementRef.current) {
                    placementRef.current = result;
                    setGeneration(value => value + 1);
                }
            } else setNotice('moveFailed');
        }, () => setNotice('moveFailed')).finally(() => setMoving(false));
    };
    const toggleMouse = (on: boolean): void => {
        setMouse(on);
        void latest.current?.setUserInput?.(on);
        // Typing goes to the app right after the user turns the switch on. Only then (and on a click in the picture): a
        // restarted capture or the AI's tabs.set never takes the focus from the user's message box.
        if (on) requestAnimationFrame(() => { if (latest.current?.keys) keyboard.current?.focus({ preventScroll: true }); });
        if (!on) {
            inputQueue.current.cancel();
            if (pendingText.current.timer) { clearTimeout(pendingText.current.timer); pendingText.current.timer = undefined; }
            pendingText.current.text = '';
            keyboard.current?.blur();
        }
    };
    // The AI may change the switches too (tabs.set): follow them, and restart the capture when the window moved.
    React.useEffect(() => controls?.subscribe?.(() => {
        const state = latest.current?.state;
        if (!state) return;
        setParkReason(state.parkReason);
        setMouse(state.userInput);
        if (!state.userInput) {
            inputQueue.current.cancel();
            if (pendingText.current.timer) { clearTimeout(pendingText.current.timer); pendingText.current.timer = undefined; }
            pendingText.current.text = ''; pendingText.current.target = undefined;
            keyboard.current?.blur();
        }
        if (state.sound !== undefined) setSound(state.sound);
        if (state.placement && state.placement !== placementRef.current) { placementRef.current = state.placement; setPlacement(state.placement); setGeneration(value => value + 1); }
    }), [controls]);
    // Typing: a hidden text field takes the keys while the picture is focused, so input methods (Chinese, Japanese …)
    // compose as usual; finished text goes to the app in short batches, shortcuts and special keys one by one.
    const keyboard = React.useRef<HTMLTextAreaElement>(null);
    const inputQueue = React.useRef(new ConversationWindowInputQueue());
    // A batch belongs to the window it was typed for: switching tabs before it is sent never redirects it.
    const pendingText = React.useRef<{ text: string; timer?: ReturnType<typeof setTimeout>; generation?: number; target?: ConversationWindowControls }>({ text: '' });
    const drainPendingText = (): void => {
        const pending = pendingText.current;
        if (pending.timer) { clearTimeout(pending.timer); pending.timer = undefined; }
        if (!pending.text) return;
        const batch = pending.text, target = pending.target, generation = pending.generation;
        pending.text = ''; pending.target = undefined;
        if (!target?.keys) return;
        void inputQueue.current.text(batch, text => target.keys!({ text }), generation);
    };
    const flushPendingText = (): void => {
        drainPendingText();
    };
    React.useEffect(() => () => {
        inputQueue.current.cancel();
        if (pendingText.current.timer) { clearTimeout(pendingText.current.timer); pendingText.current.timer = undefined; }
        pendingText.current.text = '';
    }, []);
    const sendText = (text: string): void => {
        if (!text) return;
        drainWheel();
        const pending = pendingText.current;
        if (pending.generation !== inputQueue.current.currentGeneration) pending.text = '';
        if (pending.text && pending.target !== latest.current) flushPendingText();
        pending.target = latest.current;
        pending.generation = inputQueue.current.currentGeneration;
        pending.text += text;
        if (pending.timer) return;
        pending.timer = setTimeout(drainPendingText, 8);
    };
    const onKeyboardDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        const chord = keyChord(event);
        if (!chord) return;
        event.preventDefault();
        event.stopPropagation();
        flushPendingText();
        drainWheel();
        const target = latest.current;
        if (target?.keys) void inputQueue.current.enqueue(() => target.keys!({ key: chord.key, ...(chord.modifiers.length ? { modifiers: chord.modifiers } : {}) }));
    };
    const onKeyboardInput = (event: React.FormEvent<HTMLTextAreaElement>): void => {
        if ((event.nativeEvent as InputEvent).isComposing) return;
        sendText(event.currentTarget.value);
        event.currentTarget.value = '';
    };
    const onKeyboardCompositionEnd = (event: React.CompositionEvent<HTMLTextAreaElement>): void => {
        sendText(event.currentTarget.value || event.data);
        event.currentTarget.value = '';
    };
    const toggleSound = (on: boolean): void => {
        void latest.current?.setSound(on).then(result => {
            if (result === undefined) setNotice('soundFailed'); else setSound(result);
        }, () => setNotice('soundFailed'));
    };
    // Scrolls add up over a short while so a trackpad flick is one request, not dozens.
    const wheel = React.useRef<{ delta: number; x: number; y: number; timer?: ReturnType<typeof setTimeout>; generation?: number; target?: ConversationWindowControls }>({ delta: 0, x: 0, y: 0 });
    React.useEffect(() => () => { if (wheel.current.timer) clearTimeout(wheel.current.timer); wheel.current = { delta: 0, x: 0, y: 0 }; }, [streamKey]);
    const drainWheel = (): void => {
        const pending = wheel.current;
        if (pending.timer) { clearTimeout(pending.timer); pending.timer = undefined; }
        const delta = pending.delta, target = pending.target, x = pending.x, y = pending.y;
        pending.delta = 0; pending.target = undefined;
        if (Math.abs(delta) < 4 || !target) return;
        void inputQueue.current.enqueue(() => target.pointer({ kind: 'scroll', x, y, direction: delta > 0 ? 'down' : 'up', amount: Math.min(10, Math.max(1, Math.round(Math.abs(delta) / 40))) }), pending.generation);
    };
    const onWheel = (event: React.WheelEvent<HTMLVideoElement>): void => {
        if (!mouse || !video.current) return;
        const at = pictureFraction(video.current, event.clientX, event.clientY);
        if (!at) return;
        flushPendingText();
        const pending = wheel.current;
        if (pending.generation !== inputQueue.current.currentGeneration) pending.delta = 0;
        pending.generation = inputQueue.current.currentGeneration;
        pending.delta += event.deltaY; pending.x = at.x; pending.y = at.y; pending.target = latest.current;
        if (pending.timer) return;
        pending.timer = setTimeout(drainWheel, 24);
    };
    const dragStart = React.useRef<{ x: number; y: number; clientX: number; clientY: number; pointerId: number } | undefined>(undefined);
    const suppressClick = React.useRef(false);
    const onPointerDown = (event: React.PointerEvent<HTMLVideoElement>): void => {
        if (!mouse || event.button !== 0 || !video.current) return;
        const at = pictureFraction(video.current, event.clientX, event.clientY);
        if (!at) return;
        dragStart.current = { x: at.x, y: at.y, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId };
        // A drag released outside the picture still ends here.
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    };
    const onPointerUp = (event: React.PointerEvent<HTMLVideoElement>): void => {
        const start = dragStart.current;
        dragStart.current = undefined;
        try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* released */ }
        if (!start || start.pointerId !== event.pointerId || !mouse || !video.current) return;
        if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 8) return;
        const to = pictureFraction(video.current, event.clientX, event.clientY);
        if (!to) return;
        suppressClick.current = true;
        flushPendingText();
        drainWheel();
        if (latest.current?.keys) keyboard.current?.focus({ preventScroll: true });
        const target = latest.current;
        if (target) void inputQueue.current.enqueue(() => target.pointer({ kind: 'drag', from: { x: start.x, y: start.y }, to, durationMs: 250 }));
    };
    const onClick = (event: React.MouseEvent<HTMLVideoElement>): void => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        if (!video.current) return;
        if (!mouse) { setNotice('mouseOff'); return; }
        flushPendingText();
        drainWheel();
        if (latest.current?.keys) keyboard.current?.focus({ preventScroll: true });
        const at = pictureFraction(video.current, event.clientX, event.clientY);
        // On Windows, restore:true returns focus to NextMux after a single click; pass whole:true on detail===2 so double-click is atomic.
        const target = latest.current, double = event.detail === 2;
        if (at && target) void inputQueue.current.enqueue(() => target.pointer({ kind: double ? 'doubleClick' : 'click', ...(double ? { whole: true } : {}), ...at }));
    };
    const onContextMenu = (event: React.MouseEvent<HTMLVideoElement>): void => {
        if (!video.current) return;
        event.preventDefault();
        if (!mouse) { setNotice('mouseOff'); return; }
        flushPendingText();
        drainWheel();
        if (latest.current?.keys) keyboard.current?.focus({ preventScroll: true });
        const at = pictureFraction(video.current, event.clientX, event.clientY);
        const target = latest.current;
        if (at && target) void inputQueue.current.enqueue(() => target.pointer({ kind: 'click', button: 'right', ...at }));
    };
    const statusText = live ? conversationWindowText(locale, 'live')
        : `${tab.frameUrl && streamKey ? `${conversationWindowText(locale, 'lastFrame')} · ` : ''}${conversationTabsText(locale, tab.status)}`;
    const windows = tab.windows?.length ? tab.windows : tabWindows(tab);
    const activeWindow = windows.find(item => tab.windowRef && item.pid === tab.windowRef.pid && item.windowId === tab.windowRef.windowId) || windows[windows.length - 1];
    const [windowMenuOpen, setWindowMenuOpen] = React.useState(false);
    const windowMenuRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (!windowMenuOpen) return undefined;
        const onMouseDown = (event: MouseEvent): void => {
            if (windowMenuRef.current && !windowMenuRef.current.contains(event.target as Node | null)) setWindowMenuOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') setWindowMenuOpen(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [windowMenuOpen]);
    const canTerminate = Boolean(streamKey && (live || tab.status === 'connected') && typeof controls?.terminateProcess === 'function');
    const [liveBubbleState, setLiveBubbleState] = React.useState<'hidden' | 'visible' | 'fading'>('hidden');
    const [terminateModalOpen, setTerminateModalOpen] = React.useState(false);
    const [terminating, setTerminating] = React.useState(false);
    React.useEffect(() => {
        if (!canTerminate) {
            setLiveBubbleState('hidden');
            setTerminateModalOpen(false);
            return undefined;
        }
        let storage: Storage | undefined;
        try { storage = window.localStorage; } catch { /* private storage */ }
        if (!claimAppTabLiveHint(tab.appId || tab.programs?.[0] || tab.title, storage)) {
            setLiveBubbleState('hidden');
            return undefined;
        }
        setLiveBubbleState('visible');
        const fadeTimer = setTimeout(() => setLiveBubbleState(current => current === 'visible' ? 'fading' : current), 3000);
        const hideTimer = setTimeout(() => setLiveBubbleState('hidden'), 3320);
        return () => {
            clearTimeout(fadeTimer);
            clearTimeout(hideTimer);
        };
    }, [canTerminate, tab.id]);
    React.useEffect(() => {
        if (!terminateModalOpen) return undefined;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape' && !terminating) setTerminateModalOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [terminateModalOpen, terminating]);
    const openTerminateModal = (): void => {
        if (!canTerminate) return;
        setLiveBubbleState('hidden');
        setWindowMenuOpen(false);
        setTerminateModalOpen(true);
    };
    const confirmTerminateProcess = (): void => {
        if (terminating || !latest.current?.terminateProcess) return;
        setTerminating(true);
        setNotice(undefined);
        void latest.current.terminateProcess().then(ok => {
            setTerminateModalOpen(false);
            if (!ok) setNotice('terminateFailed');
        }, () => {
            setTerminateModalOpen(false);
            setNotice('terminateFailed');
        }).finally(() => setTerminating(false));
    };
    const appDisplayName = tab.title || tab.target;
    return <section className={`nmx-visual-tab is-${tab.status}${live ? ' is-live' : ''}${mouse ? ' is-pointer' : ''}`} aria-label={tab.title}>
        <header>
            <button type='button' className={`${live ? 'nmx-visual-tab-live' : `is-${tab.status}`}${canTerminate ? ' nmx-visual-tab-live is-interactive' : ''}`}
                title={`${conversationTabsText(locale, kind)} · ${tab.target}${canTerminate ? ` · ${conversationWindowText(locale, 'terminateBubble')}` : ''}`}
                disabled={!canTerminate} onClick={openTerminateModal}>
                {(live || canTerminate) && <i aria-hidden='true'></i>}{statusText}
            </button>
            {!live && tab.status === 'disconnected' && tab.kind === 'local-desktop' && props.onReopenApp && <button
                type='button' className='nmx-visual-tab-reopen nmx-visual-tab-reopen-link' disabled={reopening} onClick={handleReopenClick}>
                {conversationWindowText(locale, 'reopenApp')}
            </button>}
            {activeWindow && <div className={`nmx-visual-tab-windows${windowMenuOpen ? ' is-open' : ''}`} ref={windowMenuRef}>
                <button type='button' className='nmx-visual-tab-window-trigger' aria-haspopup='listbox' aria-expanded={windowMenuOpen}
                    title={`${conversationWindowText(locale, 'switchToWindow')} · ${tabWindowItemLabel(activeWindow)}`}
                    onClick={() => setWindowMenuOpen(open => !open)}>
                    <i className='codicon codicon-window' aria-hidden='true'></i>
                    <span className='nmx-visual-tab-window-label' data-nmx-literal>{tabWindowItemLabel(activeWindow)}</span>
                    {windows.length > 1 && <small className='nmx-visual-tab-window-count'>{windows.length}</small>}
                    <i className={`codicon codicon-chevron-${windowMenuOpen ? 'up' : 'down'}`} aria-hidden='true'></i>
                </button>
                {windowMenuOpen && <div className='nmx-visual-tab-window-menu' role='listbox' aria-label={conversationWindowText(locale, 'switchToWindow')}>
                    {windows.map(item => {
                        const isActive = item.pid === activeWindow.pid && item.windowId === activeWindow.windowId;
                        const label = tabWindowItemLabel(item);
                        return <button key={`${item.pid}:${item.windowId}`} type='button' role='option' aria-selected={isActive}
                            className={`nmx-visual-tab-window-option${isActive ? ' is-active' : ''}`}
                            title={label} disabled={item.alive === false} aria-disabled={item.alive === false}
                            onClick={() => {
                                setWindowMenuOpen(false);
                                if (!isActive && item.alive !== false) props.onSelectWindow?.(item.pid, item.windowId);
                            }}>
                            <i className={`codicon codicon-${isActive ? 'check' : 'window'}`} aria-hidden='true'></i>
                            <span className='nmx-visual-tab-window-option-title' data-nmx-literal>{label}</span>
                        </button>;
                    })}
                </div>}
            </div>}
            {canTerminate && liveBubbleState !== 'hidden' && <span
                className={`nmx-visual-tab-live-bubble${liveBubbleState === 'fading' ? ' is-fading-out' : ''}`}
                role='status'
                onClick={event => {
                    event.stopPropagation();
                    openTerminateModal();
                }}>
                {conversationWindowText(locale, 'terminateBubble')}
            </span>}
            {streamKey && controls?.canPoint && <label className={`nmx-visual-tab-switch ${mouse ? 'is-on' : 'is-off'}`}
                data-state={conversationWindowText(locale, mouse ? 'switchOn' : 'switchOff')} title={conversationWindowText(locale, 'mouseHint')}>
                <input type='checkbox' checked={mouse} onChange={event => toggleMouse(event.currentTarget.checked)} />
                <i className='codicon codicon-keyboard' aria-hidden='true'></i>{conversationWindowText(locale, 'mouse')}
            </label>}
            {streamKey && controls?.canMute && sound !== undefined && <label className={`nmx-visual-tab-switch is-sound ${sound ? 'is-on' : 'is-off'}`}
                data-state={conversationWindowText(locale, sound ? 'switchOn' : 'soundOff')} title={conversationWindowText(locale, 'soundHint')}>
                <input type='checkbox' checked={sound} onChange={event => toggleSound(event.currentTarget.checked)} />
                <i className={`codicon codicon-${sound ? 'unmute' : 'mute'}`} aria-hidden='true'></i>{conversationWindowText(locale, 'sound')}
            </label>}
            {streamKey && controls?.canPark && placement && <div className='nmx-visual-tab-place' role='group' aria-label={conversationWindowText(locale, 'placement')}>
                {(['tab', 'desktop'] as const).map(value => <button key={value} type='button' aria-pressed={placement === value} disabled={moving}
                    onClick={() => { if (placement !== value) move(value); }}>
                    <i className={`codicon codicon-${value === 'tab' ? 'window' : 'screen-normal'}`} aria-hidden='true'></i>
                    {conversationWindowText(locale, value === 'tab' ? 'onlyInTab' : 'alsoOnDesktop')}
                </button>)}
            </div>}
            {/* Windows keeps the window on the desktop: clicking "tab only" explains why, and "also on desktop" brings the window to the front. */}
            {streamKey && controls && !controls.canPark && <div className='nmx-visual-tab-place' role='group' aria-label={conversationWindowText(locale, 'placement')}>
                <button type='button' aria-pressed='false' aria-disabled='true' title={conversationWindowText(locale, PARK_REASON_TEXT[parkReason || ''] || 'parkForeground')}
                    onClick={() => setNotice(PARK_REASON_TEXT[parkReason || ''] || 'parkForeground')}>
                    <i className='codicon codicon-window' aria-hidden='true'></i>{conversationWindowText(locale, 'onlyInTab')}
                </button>
                <button type='button' aria-pressed='true' disabled={moving} title={conversationWindowText(locale, 'switchToWindow')} onClick={() => move('desktop')}>
                    <i className='codicon codicon-screen-normal' aria-hidden='true'></i>{conversationWindowText(locale, 'alsoOnDesktop')}
                </button>
            </div>}
            {props.plugin?.headerExtra}
        </header>
        {props.plugin?.bar}
        <div className='nmx-visual-tab-screen' ref={screen}>
            <video ref={video} muted playsInline aria-label={tab.title} aria-hidden={!live} className={live ? 'is-ready' : undefined} data-window-key={streamKey || undefined}
                style={pictureStyle} onClick={onClick} onContextMenu={onContextMenu} onPointerDown={onPointerDown} onPointerUp={onPointerUp}
                onPointerCancel={() => { dragStart.current = undefined; }} onWheel={onWheel}></video>
            {!live && (tab.frameUrl
                ? <img src={tab.frameUrl} alt={tab.title} draggable={false} />
                : <div className='nmx-visual-tab-empty'>
                    <i className={`codicon codicon-${tab.status === 'connecting' ? 'loading codicon-modifier-spin' : 'device-desktop'}`} aria-hidden='true'></i>
                    {/* An app window's tab waits for its own picture; the desktop wording is for remote/VM desktops. */}
                    <strong>{tab.windowRef ? conversationWindowText(locale, 'waiting') : conversationTabsText(locale, 'desktopEmpty')}</strong>
                    {!tab.windowRef && <p>{conversationTabsText(locale, 'desktopHint')}</p>}
                </div>)}
            {live && mouse && controls?.keys && <textarea ref={keyboard} className='nmx-visual-tab-keys' aria-label={conversationWindowText(locale, 'mouse')} tabIndex={-1}
                autoCapitalize='off' autoCorrect='off' spellCheck={false} onKeyDown={onKeyboardDown} onInput={onKeyboardInput} onCompositionEnd={onKeyboardCompositionEnd}></textarea>}
            {live && (mouse || placement === 'tab') && <p className='nmx-visual-tab-note'><i className='codicon codicon-eye-closed' aria-hidden='true'></i>{conversationWindowText(locale, mouse ? 'controlHint' : 'inTabHint')}</p>}
            {(notice || announced) && <div
                className={`nmx-visual-tab-toast ${notice ? 'is-error' : 'is-info'}${toastFading ? ' is-fading-out is-leaving' : ''}`}
                role='status'
                aria-live='polite'
                onClick={event => {
                    event.stopPropagation();
                    dismissToast();
                }}>
                {notice
                    ? <span className='nmx-visual-tab-error'>{conversationWindowText(locale, notice)}</span>
                    : <span className='nmx-visual-tab-info'><i className='codicon codicon-sparkle' aria-hidden='true'></i>{announced}</span>}
                <button
                    type='button'
                    className='nmx-visual-tab-toast-close'
                    aria-label={conversationWindowText(locale, 'dismissNotice')}
                    onClick={event => {
                        event.stopPropagation();
                        dismissToast();
                    }}>
                    <i className='codicon codicon-close' aria-hidden='true'></i>
                </button>
            </div>}
            {live && props.plugin?.overlay && pictureBox && <div className='nmx-visual-tab-overlay' style={pictureBox}>{props.plugin.overlay}</div>}
            {live && props.plugin?.studio && pictureBox && <PluginStudio video={video} box={pictureBox} studio={props.plugin.studio} />}
        </div>
        {reopenModalOpen && <div className='nmx-visual-tab-terminate-modal-backdrop' role='presentation'
            onClick={() => { if (!reopenBusy.current) setReopenModalOpen(false); }}>
            <div className='nmx-visual-tab-terminate-modal' role='dialog' aria-modal='true' tabIndex={-1} ref={reopenDialog}
                aria-labelledby='nmx-visual-tab-reopen-title' aria-describedby='nmx-visual-tab-reopen-body'
                onClick={event => event.stopPropagation()}>
                <div className='nmx-visual-tab-terminate-modal-head'>
                    <span className='nmx-visual-tab-terminate-icon' aria-hidden='true'><i className='codicon codicon-warning'></i></span>
                    <div className='nmx-visual-tab-terminate-copy'>
                        <strong id='nmx-visual-tab-reopen-title'>{conversationWindowText(locale, 'reopenRunningTitle')}</strong>
                        <p id='nmx-visual-tab-reopen-body'>{conversationWindowText(locale, 'reopenRunningBody', { app: appDisplayName })}</p>
                    </div>
                </div>
                <div className='nmx-visual-tab-terminate-actions'>
                    <button type='button' className='nmx-visual-tab-terminate-cancel' disabled={reopening}
                        onClick={() => setReopenModalOpen(false)}>{conversationWindowText(locale, 'terminateCancel')}</button>
                    <button type='button' className='nmx-visual-tab-terminate-confirm' disabled={reopening}
                        onClick={() => reopenApp('restart')}>{conversationWindowText(locale, 'reopenRunningConfirm')}</button>
                </div>
            </div>
        </div>}
        {terminateModalOpen && <div className='nmx-visual-tab-terminate-modal-backdrop' role='presentation'
            onClick={() => { if (!terminating) setTerminateModalOpen(false); }}>
            <div className='nmx-visual-tab-terminate-modal' role='dialog' aria-modal='true'
                aria-labelledby='nmx-visual-tab-terminate-title'
                onClick={event => event.stopPropagation()}>
                <div className='nmx-visual-tab-terminate-modal-head'>
                    <span className='nmx-visual-tab-terminate-icon' aria-hidden='true'>
                        <i className='codicon codicon-warning' aria-hidden='true'></i>
                    </span>
                    <div className='nmx-visual-tab-terminate-copy'>
                        <strong id='nmx-visual-tab-terminate-title'>
                            {conversationWindowText(locale, 'terminateTitle', { app: appDisplayName })}
                        </strong>
                        <p>{conversationWindowText(locale, 'terminateBody', { app: appDisplayName })}</p>
                    </div>
                </div>
                <div className='nmx-visual-tab-terminate-actions'>
                    <button type='button' className='nmx-visual-tab-terminate-cancel' disabled={terminating}
                        onClick={() => setTerminateModalOpen(false)}>
                        {conversationWindowText(locale, 'terminateCancel')}
                    </button>
                    <button type='button' className='nmx-visual-tab-terminate-confirm' disabled={terminating}
                        onClick={confirmTerminateProcess}>
                        {conversationWindowText(locale, 'terminateConfirm')}
                    </button>
                </div>
            </div>
        </div>}
    </section>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function conversationTabsText(locale: Parameters<typeof uncheckedConversationTabsText>[0], key: Parameters<typeof uncheckedConversationTabsText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedConversationTabsText>>): string {
    return totalCopy(locale, key, language => uncheckedConversationTabsText(language, key, ...rest));
}
export function conversationWindowText(locale: Parameters<typeof uncheckedConversationWindowText>[0], key: Parameters<typeof uncheckedConversationWindowText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedConversationWindowText>>): string {
    return totalCopy(locale, key, language => uncheckedConversationWindowText(language, key, ...rest));
}
