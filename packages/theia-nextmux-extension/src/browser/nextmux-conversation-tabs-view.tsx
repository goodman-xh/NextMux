import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { CONVERSATION_TAB_ID, selectTabWindow, tabWindowItemLabel, tabWindows, type ConversationVisualTab } from './nextmux-conversation-tabs';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';
import { ConversationWindowInputQueue } from './nextmux-window-input-queue';
import { goalScheduleText } from './nextmux-goal-schedule-locale';
import { SurfaceTooltips } from './nextmux-surface-tooltips';
import { bridgeLiveVideo, liveBridgeShown, nudgeLiveVideoBridge } from './nextmux-live-frame-bridge';

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
    | 'terminateBubble' | 'terminateTitle' | 'terminateBody' | 'terminateConfirm' | 'terminateCancel' | 'terminateFailed'
    | 'schedules' | 'scheduleSummary' | 'scheduleDelete' | 'scheduleDeleteConfirm'
    | 'realtimeTitle' | 'realtimeReopen' | 'realtimeBody' | 'realtimeConfirm' | 'realtimeUnavailable';

const windowCatalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<WindowTextKey, string>>>> = {
    'zh-CN': { live: '实时', lastFrame: '最近画面', onlyInTab: '只在标签', alsoOnDesktop: '也在桌面', placement: '窗口显示位置',
        inTabHint: '窗口在后台运行，不占用你的桌面', switchToWindow: '切到此窗口', moveFailed: '窗口没能移动，请稍后再试',
        mouse: '键鼠', mouseHint: '打开后可以在标签内点击、滚动和打字；关闭时标签内仅由 AI 和插件操作，桌面上的窗口始终可以直接操作。', mouseOff: '键鼠已关闭：打开“键鼠”后才能在标签内操作这个窗口', inputBlocked: '「{app}」正由 AI 操作：在它的标签里打开“键鼠”后，你就可以在标签内操作。', sound: '声音', soundHint: '关闭时这个应用保持静音', soundFailed: '没能切换声音：需要“屏幕与系统录音”权限', switchOn: '已开', switchOff: '已关', soundOff: '已静音',
        alreadyOpen: '「{app}」已在这个标签中打开', aiSoundOn: 'AI 打开了声音', aiSoundOff: 'AI 关闭了声音', aiInputOn: 'AI 打开了键鼠', aiInputOff: 'AI 关闭了键鼠', aiToTab: 'AI 把窗口移回标签', aiToDesktop: 'AI 让窗口也显示在桌面',
        waiting: '等待画面', parkForeground: 'Windows 上 AI 只能操作显示在桌面上的窗口，所以这个窗口会留在桌面', parkUwp: '这个应用不接受后台操作，窗口需要留在桌面', parkMinimized: '窗口已最小化：先还原它，AI 才能看到并操作', parkMissing: '找不到这个窗口，它可能已关闭', lockUnavailable: '桌面上的窗口始终可以直接操作',
        reopenApp: "重新打开", reopenRunningTitle: "该应用已经在运行中，是否关闭重新打开？", reopenRunningBody: "关闭当前正在运行的「{app}」并重新打开到当前标签中。", reopenRunningConfirm: "关闭并重新打开", reopenFailed: "未能重新打开应用，请稍后再试",
        dismissNotice: "关闭通知", windowOwned: "该应用窗口已在另一段对话中打开，请先在原对话关闭标签。", controlHint: "按Esc可以退出插件控制(请先关闭键鼠)", escStopped: "已按 Esc 退出桌面控制：本轮 AI 不再操作电脑窗口，会改用其他方式继续。", resumeControl: "恢复控制",
        terminateBubble: '点我关闭进程', terminateTitle: '结束「{app}」进程？', terminateBody: '将关闭「{app}」窗口并结束其运行进程，未保存的内容可能会丢失。', terminateConfirm: '结束进程', terminateCancel: '取消', terminateFailed: '未能结束进程，请稍后再试',
        schedules: '计划任务', scheduleSummary: '{count} 个计划 · {on} 个已启用', scheduleDelete: '删除计划', scheduleDeleteConfirm: '再点一次删除计划',
        realtimeTitle: '「{app}」在后台会暂停画面', realtimeReopen: '以实时模式重新打开', realtimeBody: '浏览器和 Electron 类应用在窗口被隐藏时会停止绘制，这个标签的画面可能会卡住。以实时模式重新打开即可保持画面实时。', realtimeConfirm: '「{app}」会先关闭再重新打开，其中未保存的内容可能会丢失。', realtimeUnavailable: '这个应用无法以实时模式打开。选择「也在桌面」可保持画面实时。' },
    'zh-TW': { live: '即時', lastFrame: '最近畫面', onlyInTab: '只在分頁', alsoOnDesktop: '也在桌面', placement: '視窗顯示位置',
        inTabHint: '視窗在背景執行，不佔用你的桌面', switchToWindow: '切到此視窗', moveFailed: '視窗無法移動，請稍後再試',
        mouse: '鍵鼠', mouseHint: '開啟後可以在分頁內點按、捲動和打字；關閉時分頁內僅由 AI 和外掛操作，桌面上的視窗始終可以直接操作。', mouseOff: '鍵鼠已關閉：開啟「鍵鼠」後才能在分頁內操作這個視窗', inputBlocked: '「{app}」正由 AI 操作：在它的分頁裡開啟「鍵鼠」後，你就能在分頁內操作。', sound: '聲音', soundHint: '關閉時這個 App 保持靜音', soundFailed: '無法切換聲音：需要「螢幕與系統錄音」權限', switchOn: '已開', switchOff: '已關', soundOff: '已靜音',
        alreadyOpen: '「{app}」已在這個分頁中開啟', aiSoundOn: 'AI 開啟了聲音', aiSoundOff: 'AI 關閉了聲音', aiInputOn: 'AI 開啟了鍵鼠', aiInputOff: 'AI 關閉了鍵鼠', aiToTab: 'AI 把視窗移回分頁', aiToDesktop: 'AI 讓視窗也顯示在桌面',
        waiting: '等待畫面', parkForeground: 'Windows 上 AI 只能操作顯示在桌面上的視窗，所以這個視窗會留在桌面', parkUwp: '這個 App 不接受背景操作，視窗需要留在桌面', parkMinimized: '視窗已最小化：先還原它，AI 才能看到並操作', parkMissing: '找不到這個視窗，它可能已關閉', lockUnavailable: '桌面上的視窗始終可以直接操作',
        reopenApp: "重新開啟", reopenRunningTitle: "此 App 已在執行中，是否關閉並重新開啟？", reopenRunningBody: "關閉目前正在執行的「{app}」，並在目前分頁中重新開啟。", reopenRunningConfirm: "關閉並重新開啟", reopenFailed: "無法重新開啟 App，請稍後再試",
        dismissNotice: "關閉通知", windowOwned: "此應用程式視窗已在另一段對話中開啟，請先在原對話關閉分頁。", controlHint: "按Esc可以退出外掛控制(請先關閉鍵鼠)", escStopped: "已按 Esc 結束桌面控制：本輪 AI 不再操作電腦視窗，會改用其他方式繼續。", resumeControl: "恢復控制",
        terminateBubble: '點我關閉處理程序', terminateTitle: '結束「{app}」處理程序？', terminateBody: '將關閉「{app}」視窗並結束其執行中的處理程序，未儲存的內容可能會遺失。', terminateConfirm: '結束處理程序', terminateCancel: '取消', terminateFailed: '無法結束處理程序，請稍後再試',
        schedules: '排程任務', scheduleSummary: '{count} 個排程 · {on} 個已啟用', scheduleDelete: '刪除排程', scheduleDeleteConfirm: '再按一次刪除排程',
        realtimeTitle: '「{app}」在背景會暫停畫面', realtimeReopen: '以即時模式重新開啟', realtimeBody: '瀏覽器和 Electron 類 App 在視窗被隱藏時會停止繪製，這個分頁的畫面可能會卡住。以即時模式重新開啟即可保持畫面即時。', realtimeConfirm: '「{app}」會先關閉再重新開啟，其中未儲存的內容可能會遺失。', realtimeUnavailable: '這個 App 無法以即時模式開啟。選擇「也在桌面」可保持畫面即時。' },
    en: { live: 'Live', lastFrame: 'Last frame', onlyInTab: 'Tab only', alsoOnDesktop: 'Also on desktop', placement: 'Where the window shows',
        inTabHint: 'Runs in the background, off your desktop', switchToWindow: 'Switch to window', moveFailed: 'Couldn’t move the window. Try again.',
        mouse: 'Keyboard & mouse', mouseHint: 'Turn on to click, scroll and type inside this tab. When off, only the AI and plugins control the tab; windows on the desktop can always be used directly.', mouseOff: 'Keyboard & mouse is off. Turn it on to use this window inside the tab.', inputBlocked: '“{app}” is controlled by the AI. Turn on “Keyboard & mouse” in its tab to use it inside the tab.', sound: 'Sound', soundHint: 'When off, this app stays muted', soundFailed: 'Couldn’t change the sound. NextMux needs the Screen & System Audio Recording permission.', switchOn: 'On', switchOff: 'Off', soundOff: 'Muted',
        alreadyOpen: '“{app}” is already open in this tab', aiSoundOn: 'The AI turned the sound on', aiSoundOff: 'The AI muted the sound', aiInputOn: 'The AI turned keyboard & mouse on', aiInputOff: 'The AI turned keyboard & mouse off', aiToTab: 'The AI moved the window back into the tab', aiToDesktop: 'The AI also showed the window on the desktop',
        waiting: 'Waiting for the picture', parkForeground: 'On Windows the AI can only work in windows shown on the desktop, so this window stays there', parkUwp: 'This app does not accept input in the background, so its window stays on the desktop', parkMinimized: 'The window is minimized: restore it so the AI can see and use it', parkMissing: 'This window can no longer be found; it may have closed', lockUnavailable: 'Windows on the desktop can always be used directly',
        reopenApp: "Reopen", reopenRunningTitle: "This app is already running. Close and reopen it?", reopenRunningBody: "Close the running “{app}” and reopen it in this tab.", reopenRunningConfirm: "Close and reopen", reopenFailed: "Couldn’t reopen the app. Try again.",
        dismissNotice: "Dismiss notification", windowOwned: "This app window is open in another conversation. Close its tab there first.", controlHint: "Press Esc to exit plugin control (turn off input first)", escStopped: "You pressed Esc to end desktop control: for the rest of this turn the AI won’t operate windows and continues another way.", resumeControl: "Resume control",
        terminateBubble: 'Click to end process', terminateTitle: 'End “{app}” process?', terminateBody: 'This will close the “{app}” window and terminate its running process. Unsaved changes may be lost.', terminateConfirm: 'End process', terminateCancel: 'Cancel', terminateFailed: 'Couldn’t end the process. Try again.',
        schedules: 'Scheduled tasks', scheduleSummary: '{count} scheduled · {on} on', scheduleDelete: 'Delete schedule', scheduleDeleteConfirm: 'Click again to delete',
        realtimeTitle: '{app} stops updating in the background', realtimeReopen: 'Reopen in real-time mode', realtimeBody: 'Browsers and Electron apps stop drawing while their window is hidden, so this tab may freeze. Reopen it in real-time mode to keep the picture live.', realtimeConfirm: '{app} will close and open again. Unsaved changes in it may be lost.', realtimeUnavailable: 'This app can’t be opened in real-time mode. Choose “Also on desktop” to keep the picture live.' },
    ja: { live: 'ライブ', lastFrame: '最新の画面', onlyInTab: 'タブのみ', alsoOnDesktop: 'デスクトップにも', placement: 'ウィンドウの表示場所',
        inTabHint: 'バックグラウンドで動作し、デスクトップには表示されません', switchToWindow: 'このウィンドウへ切り替え', moveFailed: 'ウィンドウを移動できませんでした。もう一度お試しください。',
        mouse: 'キー・マウス', mouseHint: 'オンにすると、このタブ内でクリック・スクロール・入力ができます。オフの間はタブ内では AI とプラグインだけが操作し、デスクトップ上のウィンドウは常に直接操作できます。', mouseOff: 'キー・マウスはオフです。オンにするとこのタブ内でウィンドウを操作できます。', inputBlocked: '「{app}」は AI が操作中です。タブで「キー・マウス」をオンにするとタブ内で操作できます。', sound: 'サウンド', soundHint: 'オフの間、このアプリは消音されます', soundFailed: 'サウンドを切り替えられませんでした。「画面とシステムオーディオの録音」の許可が必要です。', switchOn: 'オン', switchOff: 'オフ', soundOff: '消音中',
        alreadyOpen: '「{app}」はこのタブで開いています', aiSoundOn: 'AI がサウンドをオンにしました', aiSoundOff: 'AI がサウンドを消音しました', aiInputOn: 'AI がキー・マウスをオンにしました', aiInputOff: 'AI がキー・マウスをオフにしました', aiToTab: 'AI がウィンドウをタブに戻しました', aiToDesktop: 'AI がウィンドウをデスクトップにも表示しました',
        waiting: '画面を待っています', parkForeground: 'Windows では AI はデスクトップに表示されたウィンドウしか操作できないため、このウィンドウはデスクトップに残ります', parkUwp: 'このアプリはバックグラウンドでの操作を受け付けないため、ウィンドウはデスクトップに残ります', parkMinimized: 'ウィンドウが最小化されています。元に戻すと AI が表示・操作できます', parkMissing: 'このウィンドウが見つかりません。閉じられた可能性があります', lockUnavailable: 'デスクトップ上のウィンドウは常に直接操作できます',
        reopenApp: "再度開く", reopenRunningTitle: "このアプリは実行中です。閉じて開き直しますか？", reopenRunningBody: "実行中の「{app}」を閉じて、このタブで開き直します。", reopenRunningConfirm: "閉じて開き直す", reopenFailed: "アプリを開き直せませんでした。もう一度お試しください。",
        dismissNotice: "通知を閉じる", windowOwned: "このアプリのウィンドウは別の会話で開いています。先にそちらのタブを閉じてください。", controlHint: "Escでプラグイン制御を終了(先に操作をオフにしてください)", escStopped: "Esc でデスクトップ操作を終了しました。このターンの間、AI はウィンドウを操作せず別の方法で続けます。", resumeControl: "操作を再開",
        terminateBubble: 'クリックでプロセス終了', terminateTitle: '「{app}」のプロセスを終了しますか？', terminateBody: '「{app}」のウィンドウを閉じて実行中のプロセスを終了します。保存されていない内容は失われる可能性があります。', terminateConfirm: 'プロセスを終了', terminateCancel: 'キャンセル', terminateFailed: 'プロセスを終了できませんでした。もう一度お試しください。',
        schedules: 'スケジュール', scheduleSummary: '{count} 件 · 有効 {on} 件', scheduleDelete: 'スケジュールを削除', scheduleDeleteConfirm: 'もう一度押すと削除',
        realtimeTitle: '「{app}」はバックグラウンドで画面の更新を止めます', realtimeReopen: 'リアルタイムモードで開き直す', realtimeBody: 'ブラウザーや Electron 系のアプリは、ウィンドウが隠れていると描画を止めるため、このタブの画面が止まることがあります。リアルタイムモードで開き直すと、画面が常に更新されます。', realtimeConfirm: '「{app}」はいったん終了してから開き直します。保存していない変更は失われることがあります。', realtimeUnavailable: 'このアプリはリアルタイムモードで開けません。「デスクトップにも」を選ぶと画面が常に更新されます。' },
    ko: { live: '실시간', lastFrame: '최근 화면', onlyInTab: '탭에만', alsoOnDesktop: '데스크톱에도', placement: '창 표시 위치',
        inTabHint: '백그라운드에서 실행되며 데스크톱에 표시되지 않습니다', switchToWindow: '이 창으로 전환', moveFailed: '창을 옮기지 못했습니다. 다시 시도하세요.',
        mouse: '키보드·마우스', mouseHint: '켜면 이 탭 안에서 클릭·스크롤·입력할 수 있습니다. 꺼져 있으면 탭 안에서는 AI와 플러그인만 조작하며, 데스크톱에 있는 창은 언제나 직접 조작할 수 있습니다.', mouseOff: '키보드·마우스가 꺼져 있습니다. 켜야 탭 안에서 이 창을 조작할 수 있습니다.', inputBlocked: '“{app}”은(는) AI가 조작 중입니다. 탭에서 ‘키보드·마우스’를 켜면 탭 안에서 조작할 수 있습니다.', sound: '소리', soundHint: '꺼져 있으면 이 앱은 음소거됩니다', soundFailed: '소리를 전환하지 못했습니다. ‘화면 및 시스템 오디오 녹음’ 권한이 필요합니다.', switchOn: '켜짐', switchOff: '꺼짐', soundOff: '음소거',
        alreadyOpen: '“{app}”은(는) 이미 이 탭에 열려 있습니다', aiSoundOn: 'AI가 소리를 켰습니다', aiSoundOff: 'AI가 소리를 껐습니다', aiInputOn: 'AI가 키보드·마우스를 켰습니다', aiInputOff: 'AI가 키보드·마우스를 껐습니다', aiToTab: 'AI가 창을 탭으로 되돌렸습니다', aiToDesktop: 'AI가 창을 데스크톱에도 표시했습니다',
        waiting: '화면을 기다리는 중', parkForeground: 'Windows에서는 AI가 데스크톱에 표시된 창만 조작할 수 있어 이 창은 데스크톱에 남습니다', parkUwp: '이 앱은 백그라운드 입력을 받지 않아 창이 데스크톱에 남아야 합니다', parkMinimized: '창이 최소화되었습니다. 복원해야 AI가 보고 조작할 수 있습니다', parkMissing: '이 창을 찾을 수 없습니다. 닫혔을 수 있습니다', lockUnavailable: '데스크톱에 있는 창은 언제나 직접 조작할 수 있습니다',
        reopenApp: "다시 열기", reopenRunningTitle: "이 앱이 이미 실행 중입니다. 닫고 다시 열까요?", reopenRunningBody: "실행 중인 “{app}”을(를) 닫고 현재 탭에서 다시 엽니다.", reopenRunningConfirm: "닫고 다시 열기", reopenFailed: "앱을 다시 열지 못했습니다. 다시 시도하세요.",
        dismissNotice: "알림 닫기", windowOwned: "이 앱 창은 다른 대화에서 열려 있습니다. 먼저 해당 탭을 닫으세요.", controlHint: "Esc로 플러그인 제어 종료(먼저 입력을 꺼주세요)", escStopped: "Esc로 데스크톱 제어를 종료했습니다. 이번 턴 동안 AI는 창을 조작하지 않고 다른 방법으로 계속합니다.", resumeControl: "제어 재개",
        terminateBubble: '클릭하여 프로세스 종료', terminateTitle: '“{app}” 프로세스를 종료할까요?', terminateBody: '“{app}” 창을 닫고 실행 중인 프로세스를 종료합니다. 저장하지 않은 내용은 사라질 수 있습니다.', terminateConfirm: '프로세스 종료', terminateCancel: '취소', terminateFailed: '프로세스를 종료하지 못했습니다. 다시 시도하세요.',
        schedules: '예약 작업', scheduleSummary: '{count}개 예약 · {on}개 사용 중', scheduleDelete: '예약 삭제', scheduleDeleteConfirm: '한 번 더 누르면 삭제',
        realtimeTitle: '{app} 앱은 백그라운드에서 화면 갱신을 멈춥니다', realtimeReopen: '실시간 모드로 다시 열기', realtimeBody: '브라우저와 Electron 기반 앱은 창이 가려지면 그리기를 멈추므로 이 탭의 화면이 멈출 수 있습니다. 실시간 모드로 다시 열면 화면이 계속 갱신됩니다.', realtimeConfirm: '{app} 앱이 종료된 후 다시 열립니다. 저장하지 않은 변경 사항은 사라질 수 있습니다.', realtimeUnavailable: '이 앱은 실시간 모드로 열 수 없습니다. ‘데스크톱에도’를 선택하면 화면이 계속 갱신됩니다.' },
    es: { live: 'En vivo', lastFrame: 'Última imagen', onlyInTab: 'Solo en la pestaña', alsoOnDesktop: 'También en el escritorio', placement: 'Dónde se muestra la ventana',
        inTabHint: 'Se ejecuta en segundo plano, fuera de tu escritorio', switchToWindow: 'Ir a la ventana', moveFailed: 'No se pudo mover la ventana. Inténtalo de nuevo.',
        mouse: 'Teclado y ratón', mouseHint: 'Actívalo para hacer clic, desplazarte y escribir dentro de esta pestaña. Desactivado, solo la IA y los plugins controlan la pestaña; las ventanas en el escritorio siempre se pueden usar directamente.', mouseOff: 'Teclado y ratón está desactivado. Actívalo para usar esta ventana en la pestaña.', inputBlocked: 'La IA controla «{app}». Activa «Teclado y ratón» en su pestaña para usarla allí.', sound: 'Sonido', soundHint: 'Mientras está desactivado, esta app permanece en silencio', soundFailed: 'No se pudo cambiar el sonido. NextMux necesita el permiso de grabación de pantalla y audio del sistema.', switchOn: 'Sí', switchOff: 'No', soundOff: 'Silencio',
        alreadyOpen: '«{app}» ya está abierta en esta pestaña', aiSoundOn: 'La IA activó el sonido', aiSoundOff: 'La IA silenció el sonido', aiInputOn: 'La IA activó teclado y ratón', aiInputOff: 'La IA desactivó teclado y ratón', aiToTab: 'La IA devolvió la ventana a la pestaña', aiToDesktop: 'La IA mostró la ventana también en el escritorio',
        waiting: 'Esperando la imagen', parkForeground: 'En Windows la IA solo puede usar ventanas visibles en el escritorio, así que esta ventana se queda allí', parkUwp: 'Esta app no acepta acciones en segundo plano, así que su ventana se queda en el escritorio', parkMinimized: 'La ventana está minimizada: restáurala para que la IA pueda verla y usarla', parkMissing: 'No se encuentra esta ventana; puede que se haya cerrado', lockUnavailable: 'Las ventanas en el escritorio siempre se pueden usar directamente',
        reopenApp: "Volver a abrir", reopenRunningTitle: "Esta app ya está en ejecución. ¿Cerrarla y volver a abrirla?", reopenRunningBody: "Cierra «{app}» y vuelve a abrirla en esta pestaña.", reopenRunningConfirm: "Cerrar y volver a abrir", reopenFailed: "No se pudo volver a abrir la app. Inténtalo de nuevo.",
        dismissNotice: "Cerrar notificación", windowOwned: "Esta ventana está abierta en otra conversación. Cierra primero su pestaña.", controlHint: "Pulsa Esc para salir del control del plugin (desactiva antes teclado y ratón)", escStopped: "Pulsaste Esc para salir del control del escritorio: durante el resto de este turno la IA no manejará ventanas y seguirá de otra forma.", resumeControl: "Reanudar control",
        terminateBubble: 'Haz clic para cerrar el proceso', terminateTitle: '¿Finalizar el proceso de «{app}»?', terminateBody: 'Se cerrará la ventana de «{app}» y finalizará su proceso en ejecución. Los cambios no guardados podrían perderse.', terminateConfirm: 'Finalizar proceso', terminateCancel: 'Cancelar', terminateFailed: 'No se pudo finalizar el proceso. Inténtalo de nuevo.',
        schedules: 'Tareas programadas', scheduleSummary: '{count} programadas · {on} activas', scheduleDelete: 'Eliminar programación', scheduleDeleteConfirm: 'Pulsa otra vez para eliminar',
        realtimeTitle: '{app} pausa su imagen en segundo plano', realtimeReopen: 'Reabrir en tiempo real', realtimeBody: 'Los navegadores y las apps de Electron dejan de dibujar cuando su ventana está oculta, así que esta pestaña puede congelarse. Vuelve a abrir la app en tiempo real para mantener la imagen en vivo.', realtimeConfirm: '{app} se cerrará y volverá a abrirse. Los cambios sin guardar podrían perderse.', realtimeUnavailable: 'Esta app no se puede abrir en tiempo real. Elige «También en el escritorio» para mantener la imagen en vivo.' },
    fr: { live: 'En direct', lastFrame: 'Dernière image', onlyInTab: 'Onglet seul', alsoOnDesktop: 'Aussi sur le bureau', placement: 'Affichage de la fenêtre',
        inTabHint: 'S’exécute en arrière-plan, hors de votre bureau', switchToWindow: 'Aller à la fenêtre', moveFailed: 'Impossible de déplacer la fenêtre. Réessayez.',
        mouse: 'Clavier et souris', mouseHint: 'Activez-le pour cliquer, faire défiler et taper dans cet onglet. Désactivé, seuls l’IA et les plugins contrôlent l’onglet ; les fenêtres sur le bureau restent toujours utilisables directement.', mouseOff: 'Clavier et souris est désactivé. Activez-le pour utiliser cette fenêtre dans l’onglet.', inputBlocked: 'L’IA contrôle « {app} ». Activez « Clavier et souris » dans son onglet pour l’utiliser.', sound: 'Son', soundHint: 'Désactivé, cette app reste muette', soundFailed: 'Impossible de changer le son. NextMux a besoin de l’autorisation d’enregistrement de l’écran et de l’audio système.', switchOn: 'Oui', switchOff: 'Non', soundOff: 'Muet',
        alreadyOpen: '« {app} » est déjà ouverte dans cet onglet', aiSoundOn: 'L’IA a activé le son', aiSoundOff: 'L’IA a coupé le son', aiInputOn: 'L’IA a activé clavier et souris', aiInputOff: 'L’IA a désactivé clavier et souris', aiToTab: 'L’IA a remis la fenêtre dans l’onglet', aiToDesktop: 'L’IA a aussi affiché la fenêtre sur le bureau',
        waiting: 'En attente de l’image', parkForeground: 'Sous Windows, l’IA ne peut utiliser que les fenêtres affichées sur le bureau : cette fenêtre y reste', parkUwp: 'Cette app n’accepte pas d’actions en arrière-plan : sa fenêtre reste sur le bureau', parkMinimized: 'La fenêtre est réduite : restaurez-la pour que l’IA puisse la voir et l’utiliser', parkMissing: 'Cette fenêtre est introuvable ; elle a peut-être été fermée', lockUnavailable: 'Les fenêtres sur le bureau restent toujours utilisables directement',
        reopenApp: "Rouvrir", reopenRunningTitle: "Cette app est déjà en cours d’exécution. La fermer et la rouvrir ?", reopenRunningBody: "Fermez « {app} » et rouvrez-la dans cet onglet.", reopenRunningConfirm: "Fermer et rouvrir", reopenFailed: "Impossible de rouvrir l’app. Réessayez.",
        dismissNotice: "Fermer la notification", windowOwned: "Cette fenêtre est ouverte dans une autre conversation. Fermez d’abord son onglet.", controlHint: "Appuyez sur Échap pour quitter le contrôle du plugin (désactivez d’abord clavier/souris)", escStopped: "Vous avez appuyé sur Échap pour quitter le contrôle du bureau : pour le reste de ce tour, l’IA ne manipule plus les fenêtres et continue autrement.", resumeControl: "Reprendre le contrôle",
        terminateBubble: 'Cliquer pour arrêter le processus', terminateTitle: 'Arrêter le processus de « {app} » ?', terminateBody: 'La fenêtre de « {app} » sera fermée et son processus en cours sera arrêté. Les modifications non enregistrées peuvent être perdues.', terminateConfirm: 'Arrêter le processus', terminateCancel: 'Annuler', terminateFailed: 'Impossible d’arrêter le processus. Réessayez.',
        schedules: 'Tâches planifiées', scheduleSummary: '{count} planifiées · {on} actives', scheduleDelete: 'Supprimer la planification', scheduleDeleteConfirm: 'Cliquez encore pour supprimer',
        realtimeTitle: '{app} fige son image en arrière-plan', realtimeReopen: 'Rouvrir en temps réel', realtimeBody: 'Les navigateurs et les apps Electron cessent de s’actualiser quand leur fenêtre est masquée : cet onglet peut se figer. Rouvrez l’app en temps réel pour garder l’image en direct.', realtimeConfirm: '{app} va se fermer puis se rouvrir. Les modifications non enregistrées risquent d’être perdues.', realtimeUnavailable: 'Cette app ne peut pas s’ouvrir en temps réel. Choisissez « Aussi sur le bureau » pour garder l’image en direct.' },
    de: { live: 'Live', lastFrame: 'Letztes Bild', onlyInTab: 'Nur im Tab', alsoOnDesktop: 'Auch auf dem Desktop', placement: 'Wo das Fenster erscheint',
        inTabHint: 'Läuft im Hintergrund, nicht auf Ihrem Desktop', switchToWindow: 'Zum Fenster wechseln', moveFailed: 'Das Fenster ließ sich nicht verschieben. Bitte erneut versuchen.',
        mouse: 'Tastatur & Maus', mouseHint: 'Einschalten, um in diesem Tab zu klicken, zu scrollen und zu tippen. Aus: Im Tab steuern nur die KI und Plugins; Fenster auf dem Desktop lassen sich immer direkt bedienen.', mouseOff: 'Tastatur & Maus ist aus. Schalten Sie es ein, um das Fenster im Tab zu bedienen.', inputBlocked: 'Die KI steuert „{app}“. Schalten Sie in seinem Tab „Tastatur & Maus“ ein, um es im Tab zu bedienen.', sound: 'Ton', soundHint: 'Aus: Diese App bleibt stumm', soundFailed: 'Der Ton ließ sich nicht umschalten. NextMux benötigt die Berechtigung für Bildschirm- und Systemaudioaufnahme.', switchOn: 'An', switchOff: 'Aus', soundOff: 'Stumm',
        alreadyOpen: '„{app}“ ist in diesem Tab bereits geöffnet', aiSoundOn: 'Die KI hat den Ton eingeschaltet', aiSoundOff: 'Die KI hat den Ton stummgeschaltet', aiInputOn: 'Die KI hat Tastatur & Maus eingeschaltet', aiInputOff: 'Die KI hat Tastatur & Maus ausgeschaltet', aiToTab: 'Die KI hat das Fenster zurück in den Tab gelegt', aiToDesktop: 'Die KI zeigt das Fenster auch auf dem Desktop',
        waiting: 'Warte auf das Bild', parkForeground: 'Unter Windows kann die KI nur Fenster auf dem Desktop bedienen, daher bleibt dieses Fenster dort', parkUwp: 'Diese App nimmt keine Eingaben im Hintergrund an, daher bleibt ihr Fenster auf dem Desktop', parkMinimized: 'Das Fenster ist minimiert: Stellen Sie es wieder her, damit die KI es sehen und bedienen kann', parkMissing: 'Dieses Fenster wurde nicht gefunden; es wurde möglicherweise geschlossen', lockUnavailable: 'Fenster auf dem Desktop lassen sich immer direkt bedienen',
        reopenApp: "Erneut öffnen", reopenRunningTitle: "Diese App läuft bereits. Schließen und erneut öffnen?", reopenRunningBody: "Die laufende App „{app}“ schließen und in diesem Tab erneut öffnen.", reopenRunningConfirm: "Schließen und erneut öffnen", reopenFailed: "Die App ließ sich nicht erneut öffnen. Bitte erneut versuchen.",
        dismissNotice: "Hinweis schließen", windowOwned: "Dieses App-Fenster ist in einer anderen Unterhaltung geöffnet. Schließen Sie dort zuerst den Tab.", controlHint: "Esc beendet die Plugin-Steuerung (zuerst Eingabe ausschalten)", escStopped: "Mit Esc wurde die Desktopsteuerung beendet: Für den Rest dieses Zugs bedient die KI keine Fenster und macht anders weiter.", resumeControl: "Steuerung fortsetzen",
        terminateBubble: 'Klicken, um Prozess zu beenden', terminateTitle: 'Prozess von „{app}“ beenden?', terminateBody: 'Das Fenster von „{app}“ wird geschlossen und der laufende Prozess beendet. Ungespeicherte Inhalte können verloren gehen.', terminateConfirm: 'Prozess beenden', terminateCancel: 'Abbrechen', terminateFailed: 'Der Prozess konnte nicht beendet werden. Bitte erneut versuchen.',
        schedules: 'Geplante Aufgaben', scheduleSummary: '{count} geplant · {on} aktiv', scheduleDelete: 'Planung löschen', scheduleDeleteConfirm: 'Zum Löschen erneut klicken',
        realtimeTitle: '{app} aktualisiert sich im Hintergrund nicht', realtimeReopen: 'Im Echtzeitmodus neu öffnen', realtimeBody: 'Browser und Electron-Apps zeichnen nicht weiter, solange ihr Fenster verborgen ist – dieser Tab kann daher einfrieren. Öffnen Sie die App im Echtzeitmodus neu, damit das Bild live bleibt.', realtimeConfirm: '{app} wird geschlossen und neu geöffnet. Nicht gespeicherte Änderungen können verloren gehen.', realtimeUnavailable: 'Diese App lässt sich nicht im Echtzeitmodus öffnen. Wählen Sie „Auch auf dem Desktop“, damit das Bild live bleibt.' },
    'pt-BR': { live: 'Ao vivo', lastFrame: 'Última imagem', onlyInTab: 'Só na aba', alsoOnDesktop: 'Também na área de trabalho', placement: 'Onde a janela aparece',
        inTabHint: 'Roda em segundo plano, fora da sua área de trabalho', switchToWindow: 'Ir para a janela', moveFailed: 'Não foi possível mover a janela. Tente de novo.',
        mouse: 'Teclado e mouse', mouseHint: 'Ative para clicar, rolar e digitar nesta aba. Desativado, só a IA e os plugins controlam a aba; janelas na área de trabalho sempre podem ser usadas diretamente.', mouseOff: 'Teclado e mouse está desativado. Ative para usar esta janela na aba.', inputBlocked: 'A IA está controlando “{app}”. Ative “Teclado e mouse” na aba dele para usar na aba.', sound: 'Som', soundHint: 'Desativado, este app fica sem som', soundFailed: 'Não foi possível mudar o som. O NextMux precisa da permissão de gravação de tela e áudio do sistema.', switchOn: 'Ativo', switchOff: 'Inativo', soundOff: 'Mudo',
        alreadyOpen: '“{app}” já está aberto nesta aba', aiSoundOn: 'A IA ligou o som', aiSoundOff: 'A IA silenciou o som', aiInputOn: 'A IA ativou teclado e mouse', aiInputOff: 'A IA desativou teclado e mouse', aiToTab: 'A IA devolveu a janela à aba', aiToDesktop: 'A IA também mostrou a janela na área de trabalho',
        waiting: 'Aguardando a imagem', parkForeground: 'No Windows a IA só consegue usar janelas visíveis na área de trabalho, então esta janela fica lá', parkUwp: 'Este app não aceita ações em segundo plano, então a janela fica na área de trabalho', parkMinimized: 'A janela está minimizada: restaure-a para que a IA possa vê-la e usá-la', parkMissing: 'Esta janela não foi encontrada; ela pode ter sido fechada', lockUnavailable: 'Janelas na área de trabalho sempre podem ser usadas diretamente',
        reopenApp: "Reabrir", reopenRunningTitle: "Este app já está em execução. Fechar e reabrir?", reopenRunningBody: "Feche “{app}” e abra-o novamente nesta aba.", reopenRunningConfirm: "Fechar e reabrir", reopenFailed: "Não foi possível reabrir o app. Tente novamente.",
        dismissNotice: "Fechar notificação", windowOwned: "Esta janela está aberta em outra conversa. Feche a aba lá primeiro.", controlHint: "Pressione Esc para sair do controle do plugin (desative antes teclado e mouse)", escStopped: "Você pressionou Esc para sair do controle da área de trabalho: no restante deste turno a IA não opera janelas e continua de outra forma.", resumeControl: "Retomar controle",
        terminateBubble: 'Clique para encerrar o processo', terminateTitle: 'Encerrar o processo de “{app}”?', terminateBody: 'A janela de “{app}” será fechada e o processo em execução será encerrado. Alterações não salvas podem ser perdidas.', terminateConfirm: 'Encerrar processo', terminateCancel: 'Cancelar', terminateFailed: 'Não foi possível encerrar o processo. Tente de novo.',
        schedules: 'Tarefas agendadas', scheduleSummary: '{count} agendadas · {on} ativas', scheduleDelete: 'Excluir agendamento', scheduleDeleteConfirm: 'Clique de novo para excluir',
        realtimeTitle: 'O {app} pausa a imagem em segundo plano', realtimeReopen: 'Reabrir em tempo real', realtimeBody: 'Navegadores e apps Electron param de desenhar quando a janela fica oculta, então esta aba pode congelar. Reabra o app em tempo real para manter a imagem ao vivo.', realtimeConfirm: 'O {app} será fechado e aberto de novo. Alterações não salvas podem ser perdidas.', realtimeUnavailable: 'Este app não pode ser aberto em tempo real. Escolha “Também na área de trabalho” para manter a imagem ao vivo.' },
    ru: { live: 'В эфире', lastFrame: 'Последний кадр', onlyInTab: 'Только во вкладке', alsoOnDesktop: 'И на рабочем столе', placement: 'Где показывать окно',
        inTabHint: 'Работает в фоне и не занимает рабочий стол', switchToWindow: 'Перейти к окну', moveFailed: 'Не удалось переместить окно. Попробуйте ещё раз.',
        mouse: 'Клавиатура и мышь', mouseHint: 'Включите, чтобы нажимать, прокручивать и печатать внутри этой вкладки. Когда выключено, во вкладке управляют только ИИ и плагины, а окном на рабочем столе всегда можно пользоваться напрямую.', mouseOff: 'Клавиатура и мышь выключены. Включите, чтобы управлять окном во вкладке.', inputBlocked: '«{app}» управляет ИИ. Включите «Клавиатура и мышь» в его вкладке, чтобы работать во вкладке.', sound: 'Звук', soundHint: 'Когда выключено, приложение без звука', soundFailed: 'Не удалось переключить звук. NextMux нужно разрешение на запись экрана и системного звука.', switchOn: 'Вкл', switchOff: 'Выкл', soundOff: 'Без звука',
        alreadyOpen: '«{app}» уже открыто в этой вкладке', aiSoundOn: 'ИИ включил звук', aiSoundOff: 'ИИ выключил звук', aiInputOn: 'ИИ включил клавиатуру и мышь', aiInputOff: 'ИИ выключил клавиатуру и мышь', aiToTab: 'ИИ вернул окно во вкладку', aiToDesktop: 'ИИ показал окно и на рабочем столе',
        waiting: 'Ожидание изображения', parkForeground: 'В Windows ИИ может работать только с окнами на рабочем столе, поэтому это окно остаётся там', parkUwp: 'Это приложение не принимает ввод в фоне, поэтому окно остаётся на рабочем столе', parkMinimized: 'Окно свёрнуто: разверните его, чтобы ИИ мог его видеть и управлять им', parkMissing: 'Окно не найдено; возможно, оно закрыто', lockUnavailable: 'Окном на рабочем столе всегда можно пользоваться напрямую',
        reopenApp: "Открыть снова", reopenRunningTitle: "Приложение уже запущено. Закрыть и открыть снова?", reopenRunningBody: "Закройте работающее приложение «{app}» и откройте его снова в этой вкладке.", reopenRunningConfirm: "Закрыть и открыть снова", reopenFailed: "Не удалось открыть приложение снова. Повторите попытку.",
        dismissNotice: "Закрыть уведомление", windowOwned: "Это окно открыто в другой беседе. Сначала закройте его вкладку там.", controlHint: "Нажмите Esc для выхода из управления плагином (сначала выключите ввод)", escStopped: "Вы нажали Esc и завершили управление рабочим столом: до конца этого хода ИИ не управляет окнами и продолжает другим способом.", resumeControl: "Возобновить управление",
        terminateBubble: 'Нажмите, чтобы завершить процесс', terminateTitle: 'Завершить процесс «{app}»?', terminateBody: 'Окно «{app}» будет закрыто, а его запущенный процесс завершён. Несохранённые данные могут быть потеряны.', terminateConfirm: 'Завершить процесс', terminateCancel: 'Отмена', terminateFailed: 'Не удалось завершить процесс. Попробуйте ещё раз.',
        schedules: 'Задачи по расписанию', scheduleSummary: 'Всего {count} · включено {on}', scheduleDelete: 'Удалить расписание', scheduleDeleteConfirm: 'Нажмите ещё раз, чтобы удалить',
        realtimeTitle: '«{app}» в фоне перестаёт обновлять изображение', realtimeReopen: 'Открыть заново в реальном времени', realtimeBody: 'Браузеры и приложения на Electron перестают отрисовывать окно, когда оно скрыто, поэтому изображение во вкладке может застыть. Откройте приложение заново в режиме реального времени, чтобы картинка оставалась живой.', realtimeConfirm: '«{app}» закроется и откроется снова. Несохранённые изменения могут пропасть.', realtimeUnavailable: 'Это приложение нельзя открыть в режиме реального времени. Выберите «И на рабочем столе», чтобы картинка оставалась живой.' },
    ar: { live: 'مباشر', lastFrame: 'آخر لقطة', onlyInTab: 'في علامة التبويب فقط', alsoOnDesktop: 'وعلى سطح المكتب أيضًا', placement: 'مكان عرض النافذة',
        inTabHint: 'تعمل في الخلفية بعيدًا عن سطح مكتبك', switchToWindow: 'الانتقال إلى النافذة', moveFailed: 'تعذّر نقل النافذة. حاول مرة أخرى.',
        mouse: 'لوحة المفاتيح والفأرة', mouseHint: 'فعّلها للنقر والتمرير والكتابة داخل علامة التبويب هذه. عند الإيقاف يتحكم الذكاء الاصطناعي والإضافات فقط داخل علامة التبويب، بينما يمكن دائمًا استخدام النافذة مباشرةً على سطح المكتب.', mouseOff: 'لوحة المفاتيح والفأرة متوقفة. فعّلها لاستخدام هذه النافذة داخل علامة التبويب.', inputBlocked: 'يتحكم الذكاء الاصطناعي في «{app}». فعّل «لوحة المفاتيح والفأرة» في علامة تبويبه لاستخدامه هناك.', sound: 'الصوت', soundHint: 'عند إيقافه يبقى هذا التطبيق صامتًا', soundFailed: 'تعذّر تبديل الصوت. يحتاج NextMux إلى إذن تسجيل الشاشة وصوت النظام.', switchOn: 'مفعّل', switchOff: 'متوقف', soundOff: 'مكتوم',
        alreadyOpen: '«{app}» مفتوح بالفعل في علامة التبويب هذه', aiSoundOn: 'شغّل الذكاء الاصطناعي الصوت', aiSoundOff: 'كتم الذكاء الاصطناعي الصوت', aiInputOn: 'فعّل الذكاء الاصطناعي لوحة المفاتيح والفأرة', aiInputOff: 'أوقف الذكاء الاصطناعي لوحة المفاتيح والفأرة', aiToTab: 'أعاد الذكاء الاصطناعي النافذة إلى علامة التبويب', aiToDesktop: 'أظهر الذكاء الاصطناعي النافذة على سطح المكتب أيضًا',
        waiting: 'بانتظار الصورة', parkForeground: 'في Windows يمكن للذكاء الاصطناعي العمل فقط في النوافذ الظاهرة على سطح المكتب، لذا تبقى هذه النافذة هناك', parkUwp: 'لا يقبل هذا التطبيق الإدخال في الخلفية، لذا تبقى نافذته على سطح المكتب', parkMinimized: 'النافذة مصغّرة: استعدها ليتمكن الذكاء الاصطناعي من رؤيتها واستخدامها', parkMissing: 'تعذّر العثور على هذه النافذة؛ ربما أُغلقت', lockUnavailable: 'يمكن دائمًا استخدام النافذة مباشرةً على سطح المكتب',
        reopenApp: "إعادة الفتح", reopenRunningTitle: "هذا التطبيق يعمل بالفعل. هل تريد إغلاقه وإعادة فتحه؟", reopenRunningBody: "أغلق التطبيق «{app}» الجاري تشغيله وأعد فتحه في علامة التبويب الحالية.", reopenRunningConfirm: "إغلاق وإعادة فتح", reopenFailed: "تعذرت إعادة فتح التطبيق. حاول مجددًا.",
        dismissNotice: "إغلاق الإشعار", windowOwned: "نافذة هذا التطبيق مفتوحة في محادثة أخرى. أغلق علامة تبويبها هناك أولاً.", controlHint: "اضغط Esc للخروج من تحكم الإضافة (أوقف الإدخال أولاً)", escStopped: "ضغطت Esc لإنهاء التحكم في سطح المكتب: لبقية هذا الدور لن يشغّل الذكاء الاصطناعي النوافذ وسيتابع بطريقة أخرى.", resumeControl: "استئناف التحكم",
        terminateBubble: 'انقر لإنهاء العملية', terminateTitle: 'إنهاء عملية «{app}»؟', terminateBody: 'سيتم إغلاق نافذة «{app}» وإنهاء عمليتها قيد التشغيل. قد تُفقد التغييرات غير المحفوظة.', terminateConfirm: 'إنهاء العملية', terminateCancel: 'إلغاء', terminateFailed: 'تعذّر إنهاء العملية. حاول مرة أخرى.',
        schedules: 'المهام المجدولة', scheduleSummary: '{count} مجدولة · {on} مفعّلة', scheduleDelete: 'حذف الجدولة', scheduleDeleteConfirm: 'اضغط مرة أخرى للحذف',
        realtimeTitle: 'يوقف {app} تحديث صورته في الخلفية', realtimeReopen: 'إعادة الفتح في الوضع الفوري', realtimeBody: 'تتوقف المتصفحات وتطبيقات Electron عن الرسم عندما تكون نافذتها مخفية، لذا قد تتجمد هذه العلامة. أعد فتح التطبيق في الوضع الفوري لتبقى الصورة مباشرة.', realtimeConfirm: 'سيُغلق {app} ثم يُفتح من جديد. قد تضيع التغييرات غير المحفوظة فيه.', realtimeUnavailable: 'لا يمكن فتح هذا التطبيق في الوضع الفوري. اختر «وعلى سطح المكتب أيضًا» لتبقى الصورة مباشرة.' },
    hi: { live: 'लाइव', lastFrame: 'अंतिम फ़्रेम', onlyInTab: 'सिर्फ़ टैब में', alsoOnDesktop: 'डेस्कटॉप पर भी', placement: 'विंडो कहाँ दिखे',
        inTabHint: 'बैकग्राउंड में चलती है, आपके डेस्कटॉप पर नहीं', switchToWindow: 'विंडो पर जाएँ', moveFailed: 'विंडो को हटाया नहीं जा सका। फिर से कोशिश करें।',
        mouse: 'कीबोर्ड-माउस', mouseHint: 'चालू करने पर इस टैब के अंदर क्लिक, स्क्रॉल और टाइप कर सकते हैं। बंद रहने पर टैब के अंदर सिर्फ़ AI और प्लगइन चलाते हैं; डेस्कटॉप पर विंडो को हमेशा सीधे चलाया जा सकता है।', mouseOff: 'कीबोर्ड-माउस बंद है। टैब के अंदर इस विंडो को चलाने के लिए इसे चालू करें।', inputBlocked: '“{app}” को AI चला रहा है। टैब में चलाने के लिए उसके टैब में “कीबोर्ड-माउस” चालू करें।', sound: 'ध्वनि', soundHint: 'बंद रहने पर यह ऐप म्यूट रहता है', soundFailed: 'ध्वनि नहीं बदली जा सकी। NextMux को स्क्रीन और सिस्टम ऑडियो रिकॉर्डिंग की अनुमति चाहिए।', switchOn: 'चालू', switchOff: 'बंद', soundOff: 'म्यूट',
        alreadyOpen: '“{app}” इस टैब में पहले से खुला है', aiSoundOn: 'AI ने ध्वनि चालू की', aiSoundOff: 'AI ने ध्वनि म्यूट की', aiInputOn: 'AI ने कीबोर्ड-माउस चालू किया', aiInputOff: 'AI ने कीबोर्ड-माउस बंद किया', aiToTab: 'AI ने विंडो को टैब में वापस रखा', aiToDesktop: 'AI ने विंडो को डेस्कटॉप पर भी दिखाया',
        waiting: 'तस्वीर का इंतज़ार', parkForeground: 'Windows पर AI सिर्फ़ डेस्कटॉप पर दिख रही विंडो चला सकता है, इसलिए यह विंडो वहीं रहती है', parkUwp: 'यह ऐप बैकग्राउंड में इनपुट नहीं लेता, इसलिए इसकी विंडो डेस्कटॉप पर रहती है', parkMinimized: 'विंडो छोटी (मिनिमाइज़) है: AI को दिखाने और चलाने के लिए इसे वापस खोलें', parkMissing: 'यह विंडो नहीं मिली; शायद बंद हो गई है', lockUnavailable: 'डेस्कटॉप पर विंडो को हमेशा सीधे चलाया जा सकता है',
        reopenApp: "फिर से खोलें", reopenRunningTitle: "यह ऐप पहले से चल रहा है। क्या इसे बंद करके फिर से खोलें?", reopenRunningBody: "चल रहे “{app}” को बंद करके मौजूदा टैब में फिर से खोलें।", reopenRunningConfirm: "बंद करके फिर से खोलें", reopenFailed: "ऐप फिर से नहीं खुल सका। दोबारा कोशिश करें.",
        dismissNotice: "सूचना बंद करें", windowOwned: "यह ऐप विंडो दूसरी बातचीत में खुली है। पहले वहाँ उसका टैब बंद करें।", controlHint: "प्लगइन नियंत्रण से बाहर निकलने के लिए Esc दबाएँ (पहले कीबोर्ड-माउस बंद करें)", escStopped: "आपने डेस्कटॉप नियंत्रण समाप्त करने के लिए Esc दबाया: इस बारी के बाकी हिस्से में AI विंडो नहीं चलाएगा और दूसरे तरीके से जारी रखेगा।", resumeControl: "नियंत्रण फिर शुरू करें",
        terminateBubble: 'प्रोसेस बंद करने के लिए क्लिक करें', terminateTitle: '“{app}” प्रोसेस समाप्त करें?', terminateBody: 'यह “{app}” विंडो को बंद कर देगा और इसके चल रहे प्रोसेस को समाप्त कर देगा। बिना सहेजे गए बदलाव खो सकते हैं।', terminateConfirm: 'प्रोसेस समाप्त करें', terminateCancel: 'रद्द करें', terminateFailed: 'प्रोसेस समाप्त नहीं किया जा सका। फिर से कोशिश करें।',
        schedules: 'शेड्यूल किए गए कार्य', scheduleSummary: '{count} शेड्यूल · {on} चालू', scheduleDelete: 'शेड्यूल हटाएँ', scheduleDeleteConfirm: 'हटाने के लिए फिर से क्लिक करें',
        realtimeTitle: '{app} बैकग्राउंड में अपनी तस्वीर रोक देता है', realtimeReopen: 'रियल-टाइम मोड में फिर खोलें', realtimeBody: 'ब्राउज़र और Electron ऐप विंडो छिपी होने पर ड्रॉ करना बंद कर देते हैं, इसलिए यह टैब रुक सकता है। तस्वीर लाइव रखने के लिए ऐप को रियल-टाइम मोड में फिर से खोलें।', realtimeConfirm: '{app} बंद होकर फिर खुलेगा। उसमें बिना सहेजे बदलाव खो सकते हैं।', realtimeUnavailable: 'यह ऐप रियल-टाइम मोड में नहीं खुल सकता। तस्वीर लाइव रखने के लिए “डेस्कटॉप पर भी” चुनें।' }
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

export type ConversationPointerModifier = 'cmd' | 'ctrl' | 'alt' | 'shift';

export type ConversationWindowPointer = {
    readonly kind: 'click' | 'doubleClick' | 'scroll' | 'move';
    /** Fractions of the window (0–1), so the tab's scaling never matters. */
    readonly x: number;
    readonly y: number;
    readonly direction?: 'up' | 'down' | 'left' | 'right';
    readonly amount?: number;
    readonly button?: 'left' | 'right' | 'middle';
    readonly modifiers?: readonly ConversationPointerModifier[];
    /** Windows: both clicks of a double-click in one input call. */
    readonly whole?: boolean;
} | {
    readonly kind: 'drag';
    /** Fractions of the window (0–1). */
    readonly from: { readonly x: number; readonly y: number };
    readonly to: { readonly x: number; readonly y: number };
    readonly durationMs?: number;
    readonly button?: 'left' | 'right' | 'middle';
    readonly modifiers?: readonly ConversationPointerModifier[];
};

export function pointerModifiers(
    event: Pick<React.MouseEvent | React.PointerEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
): ConversationPointerModifier[] {
    const mods: ConversationPointerModifier[] = [];
    if (event.metaKey) mods.push('cmd');
    if (event.ctrlKey) mods.push('ctrl');
    if (event.altKey) mods.push('alt');
    if (event.shiftKey) mods.push('shift');
    return mods;
}

/** One picture of a tab's window: base64 `data`, or the image `bytes` when asked for binary. */
export interface ConversationWindowSnapshot {
    readonly data?: string;
    readonly bytes?: Uint8Array;
    readonly mimeType: string;
    readonly width: number;
    readonly height: number;
}

/**
 * Whether this NextMux window is on screen (not minimised or hidden), as the main process sees it: its windows run with
 * background throttling off, and then Chromium keeps the page "visible" while the window is minimised or in the tray
 * (Electron's Page Visibility rule). One subscription serves every tab view.
 */
let windowShownNow = true;
let stopWatchingWindowShown: (() => void) | undefined;
const windowShownListeners = new Set<() => void>();
export function isWindowShown(): boolean { return windowShownNow; }
export function watchWindowShown(listener: () => void): () => void {
    windowShownListeners.add(listener);
    if (windowShownListeners.size === 1 && typeof window !== 'undefined') {
        const desktop = (window as Window & { nextmuxDesktop?: {
            getWindowFocusState?(): Promise<{ readonly shown?: boolean } | undefined>;
            onWindowFocusChange?(callback: (state: { readonly shown?: boolean }) => void): () => void;
        } }).nextmuxDesktop;
        const apply = (state: { readonly shown?: boolean } | undefined): void => {
            if (typeof state?.shown !== 'boolean' || state.shown === windowShownNow) return;
            windowShownNow = state.shown;
            for (const each of [...windowShownListeners]) each();
        };
        stopWatchingWindowShown = desktop?.onWindowFocusChange?.(apply);
        void desktop?.getWindowFocusState?.().then(apply, () => undefined);
    }
    return () => {
        windowShownListeners.delete(listener);
        if (!windowShownListeners.size) { stopWatchingWindowShown?.(); stopWatchingWindowShown = undefined; }
    };
}

/**
 * How a tab asks for its live picture. Starts run one at a time: `shown` puts the tab on show first, and a start whose
 * view is no longer `current` (its tab closed or switched past while it waited) is skipped.
 */
export interface ConversationWindowStartOptions {
    readonly preferSnapshot?: boolean;
    readonly shown?: () => boolean;
    readonly current?: () => boolean;
}
/** What a tab can do with the app window it shows (this computer's windows only). */
export interface ConversationWindowControls {
    /** The window can live in the tab only, off the user's screens (macOS). */
    readonly canPark: boolean;
    /** The tab's mouse switch can reach the window. */
    readonly canPoint: boolean;
    /** The tab's sound switch can mute the app. */
    readonly canMute: boolean;
    /** Start the live view: the window's own capture stream, where the window is and whether its sound is on. */
    readonly start: (options?: ConversationWindowStartOptions) => Promise<{ readonly stream?: MediaStream; readonly placement?: ConversationWindowPlacement; readonly sound?: boolean; readonly snapshotStream?: boolean }>;
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
    readonly state?: { readonly placement?: ConversationWindowPlacement; readonly sound?: boolean; readonly userInput: boolean; readonly parkReason?: string;
        /** Windows: a Chromium-family window that stops drawing while hidden; parked windows follow desktop switches; the tab-behind experiment's place. */
        readonly selfThrottles?: boolean; readonly desktopFollow?: boolean; readonly tether?: 'behind' | 'corner' };
    /** False when this computer cannot keep the user's own input away from the window on the desktop (Windows without the input hook). */
    readonly canLock?: boolean;
    readonly subscribe?: (listener: () => void) => () => void;
    /** Typing from the tab while the 键鼠 switch is on: text (IME output included), or one key with modifiers. */
    readonly keys?: (input: { readonly text?: string; readonly key?: string; readonly modifiers?: readonly string[] }) => Promise<boolean>;
    /** Close the window and terminate its running process on user confirmation. */
    readonly terminateProcess?: () => Promise<boolean>;
    /**
     * A fresh picture of the window from the system's window capture (no side effects), at most `maxSize` px wide or high:
     * base64 `data`, or JPEG `bytes` with `binary`. A failure the app side named comes back as `{ error }`.
     */
    readonly snapshot?: (maxSize?: number, options?: { readonly binary?: boolean }) => Promise<ConversationWindowSnapshot | { readonly error: string } | undefined>;
}

const SPECIAL_KEYS: Readonly<Record<string, string>> = {
    Enter: 'enter', Backspace: 'backspace', Tab: 'tab', Escape: 'escape', Delete: 'delete', Insert: 'insert', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `f${index + 1}`]))
};
const CODE_KEYS: Readonly<Record<string, string>> = {
    Space: 'space', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
    NumpadEnter: 'enter', NumpadDecimal: '.', NumpadAdd: '=', NumpadSubtract: '-', NumpadMultiply: '8', NumpadDivide: '/'
};
/** A key press in the tab as the helper's key name and modifiers; undefined when it is plain text (sent as typed text). */
export function keyChord(event: Pick<React.KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): { key: string; modifiers: string[] } | undefined {
    const modifiers = [event.metaKey && 'cmd', event.ctrlKey && 'ctrl', event.altKey && 'alt'].filter((value): value is string => Boolean(value));
    const code = event.code || '';
    const special = SPECIAL_KEYS[event.key] || (code === 'NumpadEnter' ? 'enter' : undefined);
    if (!special && !modifiers.length) return undefined;
    const byCode = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase()
        : /^Digit\d$/.test(code) ? code.slice(5)
        : /^Numpad\d$/.test(code) ? code.slice(6)
        : CODE_KEYS[code];
    const fallback = modifiers.length && typeof event.key === 'string' && event.key.length === 1 && /^[a-z0-9`\-=\[\]\\;',./]$/i.test(event.key)
        ? event.key.toLowerCase()
        : undefined;
    const key = special || byCode || fallback;
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

const INTERIOR_GRID_FRACTIONS = [0.2, 0.35, 0.5, 0.65, 0.8] as const;

/**
 * Checks a 5×5 interior grid (`[0.2..0.8]²`) of RGBA pixels: returns true ONLY when all 25 interior sample points
 * are transparent (`alpha < 8`) or pure `0,0,0` black (`r + g + b === 0`), so legitimate dark-themed apps with any
 * non-zero UI pixel are never misclassified as failed captures.
 */
export function isBlankOrPureBlackSample(pixels: ArrayLike<number>, width: number, height: number): boolean {
    if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return true;
    for (const fy of INTERIOR_GRID_FRACTIONS) {
        const py = Math.min(height - 1, Math.max(0, Math.floor(fy * height)));
        for (const fx of INTERIOR_GRID_FRACTIONS) {
            const px = Math.min(width - 1, Math.max(0, Math.floor(fx * width)));
            const idx = (py * width + px) * 4;
            const a = pixels[idx + 3] ?? 0;
            const sum = (pixels[idx] ?? 0) + (pixels[idx + 1] ?? 0) + (pixels[idx + 2] ?? 0);
            if (a >= 8 && sum > 0) return false;
        }
    }
    return true;
}

export function isBlankOrPureBlackVideoFrame(video: HTMLVideoElement): boolean {
    if (!video.videoWidth || !video.videoHeight) return true;
    const sampleW = Math.max(16, Math.min(128, video.videoWidth));
    const sampleH = Math.max(16, Math.min(128, video.videoHeight));
    try {
        const canvas = document.createElement('canvas');
        canvas.width = sampleW;
        canvas.height = sampleH;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return false;
        context.drawImage(video, 0, 0, sampleW, sampleH);
        const data = context.getImageData(0, 0, sampleW, sampleH).data;
        return isBlankOrPureBlackSample(data, sampleW, sampleH);
    } catch {
        return false;
    }
}

/**
 * Mid-session frame stalls. A window capture can stop delivering frames while the window keeps changing (the app
 * moved to another macOS Space or Windows virtual desktop, or the capture pipeline stalled), and the tab would show a
 * frozen picture. A still window delivers no frames either, so a quiet stream alone proves nothing: after a quiet
 * spell the watchdog compares two fresh snapshots of the window (the system's own window capture) and the frame on
 * screen. Only a window that changes between the snapshots, or one that no longer looks like the picture, counts as
 * a stall; the tab then restarts its capture with backoff, and falls back to the window's own snapshots when the
 * capture keeps freezing.
 */
export const LIVE_FRAME_STALL_MS = 4_000;
export const LIVE_FRAME_RECHECK_MAX_MS = 30_000;
/** A frame this recent is the window as it is now: tabs.screenshot may read it instead of capturing again. */
export const LIVE_FRAME_FRESH_MS = 1_500;
const FINGERPRINT_COLUMNS = 16, FINGERPRINT_ROWS = 9;

const liveVideoFrameTimes = new WeakMap<object, number>();
/** Milliseconds since this live picture last presented a new frame; undefined when no frame was seen. */
export function liveVideoFrameAgeMs(video: object | null | undefined, now = Date.now()): number | undefined {
    // While window snapshots stand in for it (the capture stalled or repeats an old frame), the video is not the window now.
    if (typeof liveBridgeShown === 'function' && liveBridgeShown(video)) return undefined;
    const at = video ? liveVideoFrameTimes.get(video) : undefined;
    return at === undefined ? undefined : Math.max(0, now - at);
}

/** A 16×9 grayscale miniature of a picture: enough to tell a changed window from an unchanged one. */
export function frameFingerprint(source: CanvasImageSource, width: number, height: number): Uint8Array | undefined {
    if (!(width > 0) || !(height > 0) || typeof document === 'undefined') return undefined;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = FINGERPRINT_COLUMNS;
        canvas.height = FINGERPRINT_ROWS;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return undefined;
        context.drawImage(source, 0, 0, width, height, 0, 0, FINGERPRINT_COLUMNS, FINGERPRINT_ROWS);
        const data = context.getImageData(0, 0, FINGERPRINT_COLUMNS, FINGERPRINT_ROWS).data;
        const cells = new Uint8Array(FINGERPRINT_COLUMNS * FINGERPRINT_ROWS);
        for (let index = 0; index < cells.length; index++) {
            cells[index] = Math.round(0.299 * data[index * 4] + 0.587 * data[index * 4 + 1] + 0.114 * data[index * 4 + 2]);
        }
        return cells;
    } catch { return undefined; }
}

/** The fingerprint of a window snapshot (image bytes, or base64 from a host without binary snapshots). */
export async function snapshotFingerprint(shot: { readonly data?: string; readonly bytes?: Uint8Array; readonly mimeType?: string; readonly error?: string } | undefined): Promise<Uint8Array | undefined> {
    if (!(shot?.bytes && shot.bytes.byteLength > 0) && !shot?.data || typeof createImageBitmap !== 'function') return undefined;
    try {
        const bytes = shot.bytes && shot.bytes.byteLength > 0 ? shot.bytes
            : typeof atob === 'function' ? Uint8Array.from(atob(shot.data!), character => character.charCodeAt(0)) : undefined;
        if (!bytes) return undefined;
        const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: shot.mimeType || 'image/jpeg' }));
        try { return frameFingerprint(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
    } catch { return undefined; }
}

/** Mean and largest per-cell difference of two fingerprints (0–255). */
export function fingerprintDifference(a: Uint8Array, b: Uint8Array): { readonly mean: number; readonly max: number } {
    if (a.length !== b.length || !a.length) return { mean: 255, max: 255 };
    let total = 0, max = 0;
    for (let index = 0; index < a.length; index++) {
        const delta = Math.abs(a[index] - b[index]);
        total += delta;
        if (delta > max) max = delta;
    }
    return { mean: total / a.length, max };
}

/** Two snapshots of a still window differ by little more than a blinking caret; a changing one by much more. */
export function windowIsChanging(first: Uint8Array, second: Uint8Array): boolean {
    const difference = fingerprintDifference(first, second);
    return difference.mean > 2 || difference.max > 24;
}

/** The picture on screen and the window now are different screens (generous: two capture paths never match exactly). */
export function pictureIsOutdated(shown: Uint8Array, window: Uint8Array): boolean {
    const difference = fingerprintDifference(shown, window);
    return difference.mean > 28 && difference.max > 96;
}

export interface LiveFrameWatchOptions {
    /** The window as it is now, as a fingerprint (a small system snapshot); undefined when it cannot be captured. */
    readonly windowFingerprint: () => Promise<Uint8Array | undefined>;
    /** The frame the tab shows now, as a fingerprint. */
    readonly shownFingerprint: () => Uint8Array | undefined;
    /** The capture stopped while the window changed: restart it (the watchdog stops itself). */
    readonly onStall: () => void;
    readonly now?: () => number;
    readonly delay?: (ms: number) => Promise<void>;
    readonly setInterval?: (callback: () => void, ms: number) => unknown;
    readonly clearInterval?: (handle: unknown) => void;
}

/** Watches one live picture until the returned function is called (see LIVE_FRAME_STALL_MS above). */
export function watchLiveVideoFrames(video: HTMLVideoElement, options: LiveFrameWatchOptions): () => void {
    const now = options.now ?? Date.now;
    const delay = options.delay ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const every = options.setInterval ?? ((callback: () => void, ms: number) => setInterval(callback, ms));
    const cancel = options.clearInterval ?? (handle => clearInterval(handle as ReturnType<typeof setInterval>));
    let stopped = false, checking = false, quietFor = LIVE_FRAME_STALL_MS;
    let lastFrame = now(), lastCheck = 0, frameHandle: number | undefined, presented = -1;
    const frame = (): void => {
        lastFrame = now();
        liveVideoFrameTimes.set(video, lastFrame);
        quietFor = LIVE_FRAME_STALL_MS;
    };
    const presentedFrames = (): number => {
        const quality = typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : undefined;
        return quality ? quality.totalVideoFrames : (video as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount ?? -1;
    };
    const frameCallbacks = typeof video.requestVideoFrameCallback === 'function';
    const onVideoFrame = (): void => {
        if (stopped) return;
        frame();
        frameHandle = video.requestVideoFrameCallback(onVideoFrame);
    };
    if (frameCallbacks) frameHandle = video.requestVideoFrameCallback(onVideoFrame);
    else presented = presentedFrames();
    // The first decoded frame is on screen when the watch starts (the tab reveals the picture on loadeddata).
    frame();
    const check = async (): Promise<void> => {
        checking = true;
        try {
            const since = lastFrame;
            const first = await options.windowFingerprint();
            if (stopped || !first || lastFrame !== since) return;
            await delay(900);
            if (stopped || lastFrame !== since) return;
            const second = await options.windowFingerprint();
            if (stopped || !second || lastFrame !== since) return;
            const shown = options.shownFingerprint();
            if (windowIsChanging(first, second) || shown && pictureIsOutdated(shown, second)) {
                stopped = true;
                options.onStall();
                return;
            }
            // A still window: look again after a longer quiet spell.
            quietFor = Math.min(LIVE_FRAME_RECHECK_MAX_MS, quietFor * 2);
        } finally {
            checking = false;
            lastCheck = now();
        }
    };
    const timer = every(() => {
        if (stopped) return;
        if (!frameCallbacks) {
            const count = presentedFrames();
            if (count !== presented) { presented = count; frame(); }
            else if (count === -1 && video.readyState >= 2 && !video.paused && !video.ended && video.videoWidth > 0) { frame(); }
        }
        if (checking || now() - Math.max(lastFrame, lastCheck) < quietFor) return;
        void check().catch(() => undefined);
    }, 1_000);
    return () => {
        stopped = true;
        cancel(timer);
        if (frameHandle !== undefined && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(frameHandle);
    };
}

/** Per window (its controls object): recent stall recoveries and until when the tab keeps to window snapshots. */
const liveStallRecoveries = new WeakMap<object, { attempts: number; lastAt: number; snapshotsUntil: number }>();
/** After this many stalls within LIVE_STALL_RESET_MS the tab uses window snapshots for LIVE_SNAPSHOT_HOLD_MS. */
const LIVE_STALL_ATTEMPTS = 3, LIVE_STALL_RESET_MS = 120_000, LIVE_SNAPSHOT_HOLD_MS = 300_000;

/** How long to wait before restarting a stalled capture: at once, then 2 s, 4 s … (30 s at most). */
export function liveStallRestartDelay(owner: object, now = Date.now()): number {
    const record = liveStallRecoveries.get(owner) ?? { attempts: 0, lastAt: 0, snapshotsUntil: 0 };
    if (now - record.lastAt > LIVE_STALL_RESET_MS) record.attempts = 0;
    const wait = record.attempts === 0 ? 0 : Math.min(30_000, 1_000 * 2 ** record.attempts);
    record.attempts += 1;
    record.lastAt = now;
    if (record.attempts >= LIVE_STALL_ATTEMPTS) record.snapshotsUntil = now + LIVE_SNAPSHOT_HOLD_MS;
    liveStallRecoveries.set(owner, record);
    return wait;
}

/** Whether this window's capture froze repeatedly, so its tab shows the window's own snapshots for now. */
export function liveStallPrefersSnapshots(owner: object | undefined, now = Date.now()): boolean {
    const record = owner ? liveStallRecoveries.get(owner) : undefined;
    return Boolean(record && record.snapshotsUntil > now);
}

/** Where a pointer event falls on the video's picture (object-fit: contain), as fractions of the window. */
export function pictureFraction(video: HTMLVideoElement, clientX: number, clientY: number, clamp = false): { x: number; y: number } | undefined {
    const rect = video.getBoundingClientRect();
    if (!video.videoWidth || !video.videoHeight || !rect.width || !rect.height) return undefined;
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const width = video.videoWidth * scale, height = video.videoHeight * scale;
    const x = (clientX - rect.left - (rect.width - width) / 2) / width;
    const y = (clientY - rect.top - (rect.height - height) / 2) / height;
    if (clamp) {
        return {
            x: Math.max(0, Math.min(1, x)),
            y: Math.max(0, Math.min(1, y))
        };
    }
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined;
}

/** What a skill plugin adds to its tab: a header control, its status bar and its readings over the picture. */
export interface ConversationTabPluginParts {
    readonly headerControls?: React.ReactNode;
    readonly headerExtra?: React.ReactNode;
    readonly bar?: React.ReactNode;
    /** The open AI Console (AppPluginChatPanel): a dialog moved by its title bar and resized from every side. */
    readonly floatingChat?: React.ReactNode;
    readonly overlay?: React.ReactNode;
    readonly running?: boolean;
    readonly onStop?: () => void;
    /** Plugin studio: pick areas (drag) and points with their colour (click) on the live picture, as plugin.json values. */
    readonly studio?: { readonly labels: Readonly<Record<'studio' | 'studioHint' | 'copy' | 'copied' | 'close' | 'studioArea' | 'studioPoint', string>>; onClose(): void };
    /** The AI Console lives on the picture, never in the header: open as floatingChat, closed as a launcher on an edge. */
    readonly chatOpen?: boolean;
    readonly onToggleChat?: () => void;
    /** A reply is still arriving: the closed launcher pulses, so it is not missed. */
    readonly chatStreaming?: boolean;
    /** The launcher's name (its tooltip and accessible label). */
    readonly chatLabel?: string;
}

export const PLUGIN_CHAT_SIZE_STORAGE_KEY = 'nextmux.desktop.pluginChatSize.v1';
/** The open console's place and size in the picture: { x, y, width, height } in pixels from the picture's top left. */
export const PLUGIN_CHAT_RECT_STORAGE_KEY = 'nextmux.desktop.pluginChatRect.v1';
/** Where the closed console's launcher rests: an edge of the picture and how far along it (0…1). */
export const PLUGIN_CHAT_DOCK_STORAGE_KEY = 'nextmux.desktop.pluginChatDock.v1';
export const PLUGIN_CHAT_DEFAULT_SIZE = { width: 340, height: 380 } as const;
export const PLUGIN_CHAT_MIN_WIDTH = 280;
export const PLUGIN_CHAT_MIN_HEIGHT = 240;
/** The console keeps this far from every edge of the picture (the 20px of slack clampPluginChatOverlaySize leaves). */
export const PLUGIN_CHAT_EDGE_MARGIN = 10;
export const PLUGIN_CHAT_DOCK_SIZE = 42;
export const PLUGIN_CHAT_DOCK_INSET = 10;
/** Moved further than this, a press on the launcher is a drag rather than a click. */
export const PLUGIN_CHAT_DRAG_THRESHOLD = 5;

export type PluginChatDockEdge = 'left' | 'right' | 'top' | 'bottom';
export interface PluginChatDock { readonly edge: PluginChatDockEdge; readonly offsetRatio: number }
export interface PluginChatRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export type PluginChatResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const PLUGIN_CHAT_DOCK_DEFAULT: PluginChatDock = { edge: 'right', offsetRatio: 0.5 };
interface PluginChatArea { readonly width: number; readonly height: number }

export function clampPluginChatOverlaySize(
    desired: { readonly width: number; readonly height: number },
    container?: { readonly width: number; readonly height: number }
): { width: number; height: number } {
    const rawW = Number.isFinite(desired.width) ? Math.round(desired.width) : PLUGIN_CHAT_DEFAULT_SIZE.width;
    const rawH = Number.isFinite(desired.height) ? Math.round(desired.height) : PLUGIN_CHAT_DEFAULT_SIZE.height;
    if (!container || !(container.width > 0) || !(container.height > 0)) {
        return {
            width: Math.max(PLUGIN_CHAT_MIN_WIDTH, Math.min(960, rawW)),
            height: Math.max(PLUGIN_CHAT_MIN_HEIGHT, Math.min(900, rawH))
        };
    }
    // Inside the picture with PLUGIN_CHAT_EDGE_MARGIN on each side, however small the picture: in one under 240 × 200 the
    // console shrinks below its usual minimum (its messages scroll) rather than spilling past the edge.
    const availW = Math.max(1, Math.floor(container.width - 2 * PLUGIN_CHAT_EDGE_MARGIN));
    const availH = Math.max(1, Math.floor(container.height - 2 * PLUGIN_CHAT_EDGE_MARGIN));
    return {
        width: Math.max(Math.min(PLUGIN_CHAT_MIN_WIDTH, availW), Math.min(rawW, availW)),
        height: Math.max(Math.min(PLUGIN_CHAT_MIN_HEIGHT, availH), Math.min(rawH, availH))
    };
}

/** The open console in the picture: its size first (clampPluginChatOverlaySize), then its place, a margin from every edge. */
export function clampPluginChatRect(rect: { readonly x?: number; readonly y?: number; readonly width: number; readonly height: number },
    container: PluginChatArea, margin = PLUGIN_CHAT_EDGE_MARGIN): PluginChatRect {
    const size = clampPluginChatOverlaySize(rect, container);
    const maxX = Math.max(margin, Math.floor(container.width - size.width - margin));
    const maxY = Math.max(margin, Math.floor(container.height - size.height - margin));
    const x = typeof rect.x === 'number' && Number.isFinite(rect.x) ? Math.round(rect.x) : maxX;
    const y = typeof rect.y === 'number' && Number.isFinite(rect.y) ? Math.round(rect.y) : margin;
    return { x: Math.min(maxX, Math.max(margin, x)), y: Math.min(maxY, Math.max(margin, y)), ...size };
}

/** A resize from a side or a corner: only the dragged edges move, each stopping at the picture's margin and the minimum size. */
export function resizePluginChatRect(start: PluginChatRect, edge: PluginChatResizeEdge, dx: number, dy: number,
    container: PluginChatArea, margin = PLUGIN_CHAT_EDGE_MARGIN): PluginChatRect {
    const from = clampPluginChatRect(start, container, margin);
    const maxRight = Math.max(from.x + from.width, container.width - margin);
    const maxBottom = Math.max(from.y + from.height, container.height - margin);
    const minWidth = Math.min(PLUGIN_CHAT_MIN_WIDTH, maxRight - margin), minHeight = Math.min(PLUGIN_CHAT_MIN_HEIGHT, maxBottom - margin);
    const moveX = Number.isFinite(dx) ? dx : 0, moveY = Number.isFinite(dy) ? dy : 0;
    let left = from.x, top = from.y, right = from.x + from.width, bottom = from.y + from.height;
    if (edge.includes('w')) left = Math.min(right - minWidth, Math.max(margin, left + moveX));
    if (edge.includes('e')) right = Math.max(left + minWidth, Math.min(maxRight, right + moveX));
    if (edge.includes('n')) top = Math.min(bottom - minHeight, Math.max(margin, top + moveY));
    if (edge.includes('s')) bottom = Math.max(top + minHeight, Math.min(maxBottom, bottom + moveY));
    return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}

const pluginChatDockRatio = (value: number): number => Math.round(Math.min(0.92, Math.max(0.08, value)) * 1000) / 1000;

/** Where a released launcher goes: the edge nearest its centre, at the same point along that edge (kept off the corners). */
export function nearestPluginChatDockEdge(center: { readonly x: number; readonly y: number }, container: PluginChatArea): PluginChatDock {
    const width = Math.max(1, container.width), height = Math.max(1, container.height);
    const x = Math.min(width, Math.max(0, Number.isFinite(center.x) ? center.x : width));
    const y = Math.min(height, Math.max(0, Number.isFinite(center.y) ? center.y : height / 2));
    const distances: readonly (readonly [PluginChatDockEdge, number])[] = [['right', width - x], ['left', x], ['bottom', height - y], ['top', y]];
    const [edge] = distances.reduce((best, candidate) => candidate[1] < best[1] ? candidate : best);
    return { edge, offsetRatio: pluginChatDockRatio(edge === 'left' || edge === 'right' ? y / height : x / width) };
}

/** A stored launcher place, or the default (the right edge, halfway down) for anything missing or malformed. */
export function parsePluginChatDock(value: unknown): PluginChatDock {
    const saved = value && typeof value === 'object' ? value as { readonly edge?: unknown; readonly offsetRatio?: unknown } : undefined;
    const edge = saved && (['left', 'right', 'top', 'bottom'] as const).find(item => item === saved.edge);
    return edge && typeof saved.offsetRatio === 'number' && Number.isFinite(saved.offsetRatio)
        ? { edge, offsetRatio: pluginChatDockRatio(saved.offsetRatio) } : PLUGIN_CHAT_DOCK_DEFAULT;
}

/** The launcher's resting place (pixels from the picture's top left): flush to its edge and wholly inside the picture. */
export function pluginChatDockPosition(dock: PluginChatDock, container: PluginChatArea): { readonly left: number; readonly top: number } {
    const size = PLUGIN_CHAT_DOCK_SIZE, inset = PLUGIN_CHAT_DOCK_INSET;
    const far = (length: number): number => Math.max(inset, Math.round(length - size - inset));
    const along = (length: number): number => Math.min(far(length), Math.max(inset, Math.round(dock.offsetRatio * length - size / 2)));
    switch (dock.edge) {
        case 'left': return { left: inset, top: along(container.height) };
        case 'top': return { left: along(container.width), top: inset };
        case 'bottom': return { left: along(container.width), top: far(container.height) };
        default: return { left: far(container.width), top: along(container.height) };
    }
}

/** Where the console opens: its last place once the user moved or resized it, else beside its launcher on the launcher's edge. */
export function pluginChatOpenRect(saved: { readonly x?: number; readonly y?: number; readonly width: number; readonly height: number },
    dock: PluginChatDock, container: PluginChatArea): PluginChatRect {
    if (typeof saved.x === 'number' && Number.isFinite(saved.x) && typeof saved.y === 'number' && Number.isFinite(saved.y)) return clampPluginChatRect(saved, container);
    const size = clampPluginChatOverlaySize(saved, container), icon = pluginChatDockPosition(dock, container), margin = PLUGIN_CHAT_EDGE_MARGIN;
    return clampPluginChatRect({
        ...size,
        x: dock.edge === 'left' ? margin : dock.edge === 'right' ? container.width - size.width - margin : icon.left + PLUGIN_CHAT_DOCK_SIZE / 2 - size.width / 2,
        y: dock.edge === 'top' ? margin : dock.edge === 'bottom' ? container.height - size.height - margin : icon.top + PLUGIN_CHAT_DOCK_SIZE / 2 - size.height / 2
    }, container);
}

function readPluginChatStorage(key: string): unknown {
    try {
        const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(key) : undefined;
        return raw ? JSON.parse(raw) : undefined;
    } catch {
        return undefined;
    }
}

function writePluginChatStorage(key: string, value: unknown): void {
    try { window.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* private storage or quota */ }
}

/** The saved console: its size (all that older builds kept) and, once the user moved or resized it, its place. */
function readStoredPluginChatRect(): { readonly x?: number; readonly y?: number; readonly width: number; readonly height: number } {
    const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    const saved = (readPluginChatStorage(PLUGIN_CHAT_RECT_STORAGE_KEY) ?? readPluginChatStorage(PLUGIN_CHAT_SIZE_STORAGE_KEY)) as Record<string, unknown> | undefined;
    const size = clampPluginChatOverlaySize({ width: finite(saved?.width) ?? PLUGIN_CHAT_DEFAULT_SIZE.width, height: finite(saved?.height) ?? PLUGIN_CHAT_DEFAULT_SIZE.height });
    const x = finite(saved?.x), y = finite(saved?.y);
    return x !== undefined && y !== undefined ? { ...size, x, y } : size;
}

function readStoredPluginChatDock(): PluginChatDock {
    return parsePluginChatDock(readPluginChatStorage(PLUGIN_CHAT_DOCK_STORAGE_KEY));
}

function storePluginChatDock(dock: PluginChatDock): void {
    writePluginChatStorage(PLUGIN_CHAT_DOCK_STORAGE_KEY, dock);
}

export type ConversationTabGlyphName = 'input' | 'input-off' | 'sound' | 'sound-off' | 'in-tab' | 'on-desktop' | 'schedule' | 'trash' | 'console' | 'market';

/**
 * The tab bar's and the AI Console launcher's own icons, drawn for this UI on a 24-unit grid with round 1.7 strokes in
 * currentColor. An "off" icon is the same drawing cut by a slash, with a clear gap where the slash crosses it.
 */
export function ConversationTabGlyph({ name, size = 18 }: { readonly name: ConversationTabGlyphName; readonly size?: number }): React.ReactElement {
    const cut = `nmx-glyph-cut-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const slashed = name === 'input-off' || name === 'sound-off';
    const speaker = <path d='M3.6 9.6v4.8c0 .6.5 1.1 1.1 1.1h2.9l4.2 3.6c.6.5 1.5.1 1.5-.7V5.6c0-.8-.9-1.2-1.5-.7L7.6 8.5H4.7c-.6 0-1.1.5-1.1 1.1z' />;
    const drawing = name === 'input' || name === 'input-off' ? <>
        <rect x='1.9' y='8.6' width='13.2' height='9.2' rx='2.4' />
        <path d='M5.2 11.9h.01M8.5 11.9h.01M11.8 11.9h.01M6.4 14.7h5.2' />
        <rect x='17.3' y='5.6' width='4.9' height='9.6' rx='2.45' />
        <path d='M19.75 8v1.6' />
    </> : name === 'sound' ? <>{speaker}<path d='M16.2 9.2a4 4 0 0 1 0 5.6M18.9 6.6a7.7 7.7 0 0 1 0 10.8' /></>
        : name === 'sound-off' ? <>{speaker}<path d='M16.4 9.4a3.7 3.7 0 0 1 .6 2.6' /></>
        : name === 'in-tab' ? <>
            <path d='M2.8 8V17.6a2.2 2.2 0 0 0 2.2 2.2h14a2.2 2.2 0 0 0 2.2-2.2V9.4a2.2 2.2 0 0 0-2.2-2.2h-7.3l-1.5-2.4H5a2.2 2.2 0 0 0-2.2 2.2z' />
            <rect x='6.6' y='10.6' width='10.8' height='5.8' rx='1.3' fill='currentColor' stroke='none' />
        </> : name === 'on-desktop' ? <>
            <rect x='2.6' y='3.6' width='18.8' height='12.8' rx='2.2' />
            <path d='M9 20.2h6M12 16.4v3.8' />
            <rect x='5.8' y='6.6' width='8.4' height='5.6' rx='1.1' fill='currentColor' stroke='none' />
        </> : name === 'schedule' ? <>
            <circle cx='12' cy='12.6' r='8' />
            <path d='M12 8.6v4.2l2.8 1.8M4.6 4.4 2.8 6.2M19.4 4.4l1.8 1.8' />
        </> : name === 'trash' ? <path d='M4.6 7h14.8M9.6 7V5.3c0-.6.5-1.1 1.1-1.1h2.6c.6 0 1.1.5 1.1 1.1V7M6.6 7l.8 11.4c.1 1 .9 1.8 1.9 1.8h5.4c1 0 1.8-.8 1.9-1.8L17.4 7M10.2 10.8v5.6M13.8 10.8v5.6' />
        : name === 'console' ? <>
            <path d='M6.8 4h10.4A2.8 2.8 0 0 1 20 6.8v7.4a2.8 2.8 0 0 1-2.8 2.8h-5.6l-4.1 3.1c-.4.3-1 0-1-.5V17h.3A2.8 2.8 0 0 1 4 14.2V6.8A2.8 2.8 0 0 1 6.8 4z' />
            <path d='M12 6.9l1.1 2.4 2.4 1.1-2.4 1.1L12 13.9l-1.1-2.4-2.4-1.1 2.4-1.1z' fill='currentColor' strokeWidth='.8' />
        </> : <path d='M4.2 6.8h3.2a.4.4 0 0 0 .4-.5 2.6 2.6 0 1 1 5.2 0 .4.4 0 0 0 .4.5h3.3a1.5 1.5 0 0 1 1.5 1.5v3.2a.4.4 0 0 0 .5.4 2.6 2.6 0 1 1 0 5.2.4.4 0 0 0-.5.4v1.3a1.5 1.5 0 0 1-1.5 1.5H4.2a1.5 1.5 0 0 1-1.5-1.5V8.3a1.5 1.5 0 0 1 1.5-1.5z' />;
    return <svg className={`nmx-tab-glyph is-${name}`} width={size} height={size} viewBox='0 0 24 24' aria-hidden='true' focusable='false'
        fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round'>
        {slashed ? <>
            <defs><mask id={cut} maskUnits='userSpaceOnUse'><rect width='24' height='24' fill='#fff' /><path d='M3.4 3.4l17.2 17.2' stroke='#000' strokeWidth='5' /></mask></defs>
            <g mask={`url(#${cut})`} opacity='.78'>{drawing}</g>
            <path d='M3.4 3.4l17.2 17.2' />
        </> : drawing}
    </svg>;
}

const PLUGIN_CHAT_RESIZE_EDGES: readonly PluginChatResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
/** A press on the console's title bar moves it, unless it lands on one of the bar's own controls. */
const PLUGIN_CHAT_DRAG_IGNORE = 'button, a, input, textarea, select, label, summary, [role="button"], [role="switch"], [contenteditable="true"]';

/**
 * The open AI Console over the picture: dragged by its title bar it stays exactly where it is let go (inside the picture,
 * PLUGIN_CHAT_EDGE_MARGIN from each edge); every side and corner resizes it. Place and size are kept for the next time.
 */
function FloatingPluginChatOverlay(props: {
    readonly containerSize?: { readonly width: number; readonly height: number };
    readonly dock: PluginChatDock;
    readonly children: React.ReactNode;
}): React.ReactElement {
    const root = React.useRef<HTMLDivElement>(null);
    const [saved, setSaved] = React.useState(() => readStoredPluginChatRect());
    const [gestureKind, setGestureKind] = React.useState<'dragging' | 'resizing'>();
    const gesture = React.useRef<{ readonly kind: 'move' | PluginChatResizeEdge; readonly pointerId: number; readonly startX: number; readonly startY: number;
        readonly rect: PluginChatRect; latest: PluginChatRect }>();
    const container = props.containerSize && props.containerSize.width > 0 && props.containerSize.height > 0 ? props.containerSize : undefined;
    const rect = container ? pluginChatOpenRect(saved, props.dock, container) : undefined;
    const size = rect || clampPluginChatOverlaySize(saved);
    const stopBubble = (event: React.SyntheticEvent): void => { event.stopPropagation(); };
    const begin = (kind: 'move' | PluginChatResizeEdge, event: React.PointerEvent<HTMLElement>): void => {
        if (!rect || !root.current) return;
        event.preventDefault();
        gesture.current = { kind, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect, latest: rect };
        setGestureKind(kind === 'move' ? 'dragging' : 'resizing');
        // The console itself takes the pointer, so one handler follows every gesture, even outside the picture.
        try { root.current.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    };
    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
        event.stopPropagation();
        const target = event.target as Element | null;
        if (event.button !== 0 || typeof target?.closest !== 'function' || !target.closest('.nmx-plugin-chat-header') || target.closest(PLUGIN_CHAT_DRAG_IGNORE)) return;
        begin('move', event);
    };
    const follow = (event: React.PointerEvent<HTMLDivElement>): void => {
        event.stopPropagation();
        const active = gesture.current;
        if (!active || active.pointerId !== event.pointerId || !container) return;
        event.preventDefault();
        const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
        active.latest = active.kind === 'move'
            ? clampPluginChatRect({ ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy }, container)
            : resizePluginChatRect(active.rect, active.kind, dx, dy, container);
        setSaved(active.latest);
    };
    const finish = (event: React.PointerEvent<HTMLDivElement>): void => {
        event.stopPropagation();
        const active = gesture.current;
        if (!active || active.pointerId !== event.pointerId) return;
        gesture.current = undefined;
        setGestureKind(undefined);
        try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* released */ }
        // A press that moved nothing (a plain click on the title) saves no place, so it keeps opening beside its launcher.
        const { latest, rect } = active;
        if (latest.x === rect.x && latest.y === rect.y && latest.width === rect.width && latest.height === rect.height) return;
        // It stays where it was let go: no snapping while open.
        setSaved(latest);
        writePluginChatStorage(PLUGIN_CHAT_RECT_STORAGE_KEY, latest);
        writePluginChatStorage(PLUGIN_CHAT_SIZE_STORAGE_KEY, { width: latest.width, height: latest.height });
    };
    const style: React.CSSProperties = rect
        ? { left: `${rect.x}px`, top: `${rect.y}px`, right: 'auto', bottom: 'auto', width: `${rect.width}px`, height: `${rect.height}px` }
        : { width: `${size.width}px`, height: `${size.height}px` };
    return (
        <div ref={root} className={`nmx-plugin-chat-overlay${gestureKind ? ` is-${gestureKind}` : ''}`} style={style}
            onPointerDown={onPointerDown} onPointerMove={follow} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
            onMouseDown={stopBubble} onClick={stopBubble} onDoubleClick={stopBubble} onAuxClick={stopBubble} onContextMenu={stopBubble} onWheel={stopBubble}>
            {PLUGIN_CHAT_RESIZE_EDGES.map(edge => <div key={edge} className={`nmx-plugin-chat-resize is-${edge}`} aria-hidden='true'
                onPointerDown={event => { event.stopPropagation(); if (event.button === 0) begin(edge, event); }} />)}
            <div className='nmx-plugin-chat-overlay-body'>
                {props.children}
            </div>
        </div>
    );
}

/**
 * The closed AI Console: a launcher resting on an edge of the picture. Dragged, it follows the pointer anywhere in the
 * picture and, let go, glides to the nearest edge; clicked (moved no more than PLUGIN_CHAT_DRAG_THRESHOLD), it opens
 * the console. Arrow keys move it to another edge.
 */
function PluginChatDockLauncher(props: {
    readonly containerSize: PluginChatArea; readonly dock: PluginChatDock; readonly label: string; readonly streaming?: boolean;
    onDock(dock: PluginChatDock): void; onOpen(): void;
}): React.ReactElement {
    const [dragAt, setDragAt] = React.useState<{ readonly left: number; readonly top: number }>();
    const press = React.useRef<{ readonly pointerId: number; readonly startX: number; readonly startY: number; readonly left: number; readonly top: number;
        moved: boolean; at?: { left: number; top: number } }>();
    const swallowClickUntil = React.useRef(0);
    const rest = pluginChatDockPosition(props.dock, props.containerSize);
    const place = dragAt || rest;
    const within = (left: number, top: number): { left: number; top: number } => ({
        left: Math.round(Math.min(Math.max(0, props.containerSize.width - PLUGIN_CHAT_DOCK_SIZE), Math.max(0, left))),
        top: Math.round(Math.min(Math.max(0, props.containerSize.height - PLUGIN_CHAT_DOCK_SIZE), Math.max(0, top)))
    });
    const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        if (event.button !== 0) return;
        press.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rest.left, top: rest.top, moved: false };
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    };
    const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        const active = press.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
        if (!active.moved && Math.hypot(dx, dy) <= PLUGIN_CHAT_DRAG_THRESHOLD) return;
        active.moved = true;
        active.at = within(active.left + dx, active.top + dy);
        setDragAt(active.at);
    };
    const onPointerEnd = (event: React.PointerEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        const active = press.current;
        if (!active || active.pointerId !== event.pointerId) return;
        press.current = undefined;
        try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* released */ }
        setDragAt(undefined);
        if (!active.moved || !active.at) return;
        // A drag ends here; the click the browser sends after it must not open the console.
        swallowClickUntil.current = Date.now() + 400;
        props.onDock(nearestPluginChatDockEdge({ x: active.at.left + PLUGIN_CHAT_DOCK_SIZE / 2, y: active.at.top + PLUGIN_CHAT_DOCK_SIZE / 2 }, props.containerSize));
    };
    const onClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        if (Date.now() < swallowClickUntil.current) { swallowClickUntil.current = 0; return; }
        props.onOpen();
    };
    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
        const edge = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' } as const)[event.key as 'ArrowLeft'];
        if (!edge || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        if (edge !== props.dock.edge) props.onDock({ edge, offsetRatio: props.dock.offsetRatio });
    };
    return <button type='button' className={`nmx-plugin-chat-dock-icon${dragAt ? ' is-dragging' : ''}${props.streaming ? ' is-streaming' : ''}`}
        data-edge={props.dock.edge} aria-label={props.label} title={props.label} aria-haspopup='dialog'
        style={{ left: `${place.left}px`, top: `${place.top}px` }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd}
        onMouseDown={event => event.stopPropagation()} onClick={onClick} onKeyDown={onKeyDown}>
        <i className='nmx-plugin-chat-dock-pill' aria-hidden='true'></i>
        <ConversationTabGlyph name='console' size={22} />
        {props.streaming && <i className='nmx-plugin-chat-dock-pulse' aria-hidden='true'></i>}
    </button>;
}

/** A plan a tab's header lists: the widget decides which belong to the conversation and words their time. */
export interface ConversationTabScheduledTask {
    readonly id: string;
    readonly title: string;
    /** When it runs, as the scheduled page words it ("每天 09:00", a date and time …). */
    readonly when: string;
    readonly enabled: boolean;
    /** A one-time plan that already ran: switching it on again needs a new time, set on the scheduled page. */
    readonly locked?: boolean;
}

/**
 * The header's plans: a clock with their count, and on hover (or focus, or a click that pins it) a drawer listing each
 * plan with an on/off switch and a delete button. The drawer opens beneath the clock, and a bridge over the gap keeps
 * it open while the pointer travels down to it. It is a disclosure, not a dialog: open, it never pauses the keys and
 * clicks the tab passes to its app (hasOpenOverlayOrModal). Deleting takes two clicks, as on the scheduled page: the
 * first arms the button for a few seconds.
 */
function TabScheduleControl(props: {
    readonly locale: NextMuxDesktopLocale; readonly tasks: readonly ConversationTabScheduledTask[];
    onToggle?(taskId: string): void; onDelete?(taskId: string): void;
}): React.ReactElement | null {
    const { locale, tasks } = props;
    const [open, setOpen] = React.useState(false);
    // A switch flips at once; the plan's saved state takes over when it arrives (or after a few seconds, if it never does).
    const [flipped, setFlipped] = React.useState<Readonly<Record<string, boolean>>>({});
    const root = React.useRef<HTMLDivElement>(null);
    const trigger = React.useRef<HTMLButtonElement>(null);
    const pinned = React.useRef(false);
    const [armed, setArmed] = React.useState('');
    // Escape hands the focus back to the clock without opening the drawer again.
    const quietFocus = React.useRef(false);
    const closeTimer = React.useRef<ReturnType<typeof setTimeout>>();
    const drawerId = `nmx-visual-tab-schedule-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const cancelClose = (): void => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = undefined; } };
    const show = (): void => { cancelClose(); setOpen(true); };
    const close = (): void => { cancelClose(); pinned.current = false; setOpen(false); };
    // Hover opens after a short intent delay, so sweeping across the header to 键鼠 or sound does not flash the drawer;
    // leaving closes after a grace, so the pointer can cross the gap into it.
    const showSoon = (): void => {
        cancelClose();
        if (open) return;
        closeTimer.current = setTimeout(() => { closeTimer.current = undefined; setOpen(true); }, 120);
    };
    const closeSoon = (): void => {
        cancelClose();
        if (pinned.current || !open) return;
        closeTimer.current = setTimeout(() => { closeTimer.current = undefined; setOpen(false); }, 180);
    };
    React.useEffect(() => cancelClose, []);
    // An armed delete disarms after 4 seconds, and whenever the drawer closes.
    React.useEffect(() => {
        if (!armed) return undefined;
        if (!open) { setArmed(''); return undefined; }
        const timer = setTimeout(() => setArmed(''), 4000);
        return () => clearTimeout(timer);
    }, [armed, open]);
    React.useEffect(() => {
        setFlipped(current => {
            const kept = Object.entries(current).filter(([id, enabled]) => tasks.some(task => task.id === id && task.enabled !== enabled));
            return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
        });
    }, [tasks]);
    React.useEffect(() => {
        if (!Object.keys(flipped).length) return undefined;
        const timer = setTimeout(() => setFlipped({}), 4000);
        return () => clearTimeout(timer);
    }, [flipped]);
    React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event: PointerEvent): void => { if (!root.current?.contains(event.target as Node | null)) close(); };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') return;
            // Only an Escape meant for the drawer: one opened by a hover leaves the app's, the console's and pickers' Escape alone.
            const inside = Boolean(root.current?.contains(document.activeElement));
            if (!inside && !pinned.current) return;
            event.preventDefault();
            event.stopPropagation();
            close();
            quietFocus.current = true;
            trigger.current?.focus({ preventScroll: true });
            quietFocus.current = false;
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open]);
    if (!tasks.length) return null;
    const enabledOf = (task: ConversationTabScheduledTask): boolean => flipped[task.id] ?? task.enabled;
    const active = tasks.filter(enabledOf).length;
    const title = conversationWindowText(locale, 'schedules');
    const summary = conversationWindowText(locale, 'scheduleSummary', { count: String(tasks.length), on: String(active) });
    const deleteLabel = conversationWindowText(locale, 'scheduleDelete');
    const confirmLabel = conversationWindowText(locale, 'scheduleDeleteConfirm');
    return <div ref={root} className={`nmx-visual-tab-schedule${open ? ' is-open' : ''}${active ? ' has-active' : ''}`}
        onMouseEnter={showSoon} onMouseLeave={closeSoon} onFocus={() => { if (!quietFocus.current) show(); }}
        onBlur={event => {
            const next = event.relatedTarget as Node | null;
            // Focus moving inside, or dropped by a click on the drawer's own text, keeps it open.
            if (next ? event.currentTarget.contains(next) : event.currentTarget.matches?.(':hover')) return;
            close();
        }}>
        <button ref={trigger} type='button' className='nmx-visual-tab-icon-btn nmx-visual-tab-schedule-trigger'
            aria-expanded={open} aria-controls={open ? drawerId : undefined} aria-label={`${title} · ${summary}`}
            onClick={() => { if (open && pinned.current) close(); else { pinned.current = true; show(); } }}>
            <ConversationTabGlyph name='schedule' />
            <b className='nmx-visual-tab-schedule-count'>{tasks.length > 99 ? '99+' : tasks.length}</b>
        </button>
        {open && <div id={drawerId} className='nmx-visual-tab-schedule-drawer' role='group' aria-label={title}>
            <div className='nmx-visual-tab-schedule-head'>
                <strong>{title}</strong>
                <small>{summary}</small>
            </div>
            <ul className='nmx-visual-tab-schedule-list'>
                {tasks.map(task => {
                    const enabled = enabledOf(task);
                    const toggleLabel = goalScheduleText(locale, enabled ? 'disable' : 'enable');
                    return <li key={task.id} className={`nmx-visual-tab-schedule-item${enabled ? ' is-enabled' : ''}`}>
                        <div className='nmx-visual-tab-schedule-text'>
                            <strong data-nmx-literal title={task.title}>{task.title}</strong>
                            <small data-nmx-literal title={task.when}>{task.when}</small>
                        </div>
                        <button type='button' role='switch' aria-checked={enabled} className='nmx-apple-switch'
                            aria-label={`${toggleLabel} · ${task.title}`} title={task.locked ? goalScheduleText(locale, 'onceHint') : toggleLabel}
                            disabled={task.locked || !props.onToggle}
                            onClick={() => {
                                // One change at a time: a second click before the plan is saved would race the first.
                                if (task.id in flipped) return;
                                setFlipped(current => ({ ...current, [task.id]: !enabled }));
                                props.onToggle?.(task.id);
                            }}>
                            <i className='nmx-apple-switch-thumb' aria-hidden='true'></i>
                        </button>
                        {props.onDelete && (() => {
                            const isArmed = armed === task.id;
                            const label = isArmed ? confirmLabel : deleteLabel;
                            return <button type='button' className={`nmx-visual-tab-schedule-delete${isArmed ? ' is-armed' : ''}`}
                                aria-label={`${label} · ${task.title}`} title={label}
                                onClick={() => {
                                    if (!isArmed) { setArmed(task.id); return; }
                                    setArmed('');
                                    props.onDelete?.(task.id);
                                }}>
                                <ConversationTabGlyph name='trash' size={16} />
                            </button>;
                        })()}
                    </li>;
                })}
            </ul>
        </div>}
    </div>;
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

export function ConversationVisualTabView(props: { readonly locale: NextMuxDesktopLocale; readonly tab: ConversationVisualTab; readonly active?: boolean; readonly controls?: ConversationWindowControls;
    readonly plugin?: ConversationTabPluginParts; readonly announcement?: { readonly id: number; readonly text: string };
    readonly onSelectWindow?: (pid: number, windowId: number) => void;
    readonly onReopenApp?: (mode: 'check_or_open' | 'restart') => Promise<'opened' | 'running' | 'failed'>;
    /** The conversation's plans, listed by the clock in front of 键鼠 (hidden while there are none). */
    readonly scheduledTasks?: readonly ConversationTabScheduledTask[];
    readonly onToggleScheduledTask?: (taskId: string) => void;
    readonly onDeleteScheduledTask?: (taskId: string) => void }): React.ReactElement {
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

export function hasOpenPluginWindowSurface(): boolean {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return false;
    const nodes = document.querySelectorAll('.nmx-plugin-window-dialog, .nmx-plugin-subwindow-backdrop');
    for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i] as HTMLElement;
        if (el.hidden || el.getAttribute?.('aria-hidden') === 'true') continue;
        if (typeof el.closest === 'function' && el.closest('[hidden], [aria-hidden="true"]')) continue;
        if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) continue;
        if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            try {
                const computed = window.getComputedStyle(el);
                if (computed.display === 'none' || computed.visibility === 'hidden') continue;
            } catch { /* minimal test DOM */ }
        }
        return true;
    }
    return false;
}

export function hasOpenOverlayOrModal(sectionEl?: HTMLElement | null, localOverlayOpen = false): boolean {
    if (localOverlayOpen) return true;
    if (typeof document === 'undefined') return false;
    const overlaySelector = [
        '[aria-modal="true"]',
        '[role="dialog"]',
        '[role="alertdialog"]',
        '[role="menu"]',
        '.nmx-modal-backdrop',
        '.nmx-dialog-backdrop',
        '.nmx-sheet-backdrop',
        '.nmx-plugin-hub',
        '.nmx-plugin-hub-backdrop',
        '.nmx-plugin-modal-backdrop',
        '.nmx-plugin-subwindow-backdrop',
        '.nmx-model-picker-portal',
        '.nmx-composer-popover',
        '.nmx-popover',
        '.nmx-dropdown',
        '.nmx-overlay',
        '.lm-Menu',
        '.p-Menu',
        '.dialogOverlay',
        '.monaco-menu-container',
        '.quick-input-widget'
    ].join(', ');
    const isVisibleNode = (node: Element): boolean => {
        const el = node as HTMLElement;
        if (el.hidden || el.getAttribute?.('aria-hidden') === 'true') return false;
        if (el.classList?.contains?.('nmx-plugin-window-dialog') && el.getAttribute?.('aria-modal') !== 'true') return false;
        if (typeof el.closest === 'function' && el.closest('[hidden], [aria-hidden="true"]')) return false;
        const style = el.style;
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            try {
                const computed = window.getComputedStyle(el);
                if (computed.display === 'none' || computed.visibility === 'hidden') return false;
            } catch { /* minimal test DOM */ }
        }
        return true;
    };
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.closest === 'function') {
        const activeOverlay = active.closest(`${overlaySelector}, [role="listbox"]`);
        if (activeOverlay && (!sectionEl || typeof sectionEl.contains !== 'function' || !sectionEl.contains(activeOverlay)
            || activeOverlay.matches?.(overlaySelector) || activeOverlay.classList?.contains('nmx-visual-tab-window-menu'))) {
            if (isVisibleNode(activeOverlay)) return true;
        }
    }
    if (typeof document.querySelectorAll === 'function') {
        const candidates = document.querySelectorAll(overlaySelector);
        for (let i = 0; i < candidates.length; i += 1) {
            if (isVisibleNode(candidates[i])) return true;
        }
        const listboxes = document.querySelectorAll('[role="listbox"]');
        for (let i = 0; i < listboxes.length; i += 1) {
            const lb = listboxes[i];
            if (lb.classList?.contains('nmx-cast-rail-list') || lb.classList?.contains('nmx-comic-setup-sources')) continue;
            if (isVisibleNode(lb)) return true;
        }
    }
    return false;
}

/**
 * "Reopen in real-time mode" (Windows): browsers and Electron, CEF and WebView2 apps stop drawing while their window is
 * hidden, so a tab-only window of one that NextMux could not start with its realtime switches may freeze. The prompt
 * shows once per tab session, after the tab's first live frame; dismissing it keeps it away for that app for 30 days.
 */
export const REALTIME_PROMPT_STORAGE_KEY = 'nextmux.realtimePrompt.v1';
const REALTIME_PROMPT_QUIET_MS = 30 * 24 * 60 * 60 * 1000, REALTIME_PROMPT_MAX_APPS = 200;
let realtimePromptMemo: Record<string, number> | undefined;
function realtimePromptRecords(now = Date.now()): Record<string, number> {
    if (realtimePromptMemo) return realtimePromptMemo;
    const records: Record<string, number> = {};
    try {
        const saved = JSON.parse(typeof localStorage === 'undefined' ? 'null' : localStorage.getItem(REALTIME_PROMPT_STORAGE_KEY) || 'null');
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
            for (const [app, at] of Object.entries(saved)) if (typeof at === 'number' && now - at < REALTIME_PROMPT_QUIET_MS && at <= now + 60_000) records[app] = at;
        }
    } catch { /* nothing dismissed */ }
    return realtimePromptMemo = records;
}
/** Whether the user dismissed the realtime prompt for this app in the last 30 days. */
export function realtimePromptDismissed(app: string, now = Date.now()): boolean {
    const at = app ? realtimePromptRecords(now)[app] : undefined;
    return at !== undefined && now - at < REALTIME_PROMPT_QUIET_MS;
}
/** Keeps the prompt away from this app for 30 days (the 200 most recent apps are remembered). */
export function dismissRealtimePrompt(app: string, now = Date.now()): void {
    if (!app) return;
    const entries = Object.entries({ ...realtimePromptRecords(now), [app]: now }).filter(([, at]) => now - at < REALTIME_PROMPT_QUIET_MS)
        .sort((left, right) => right[1] - left[1]).slice(0, REALTIME_PROMPT_MAX_APPS);
    realtimePromptMemo = Object.fromEntries(entries);
    try { localStorage.setItem(REALTIME_PROMPT_STORAGE_KEY, JSON.stringify(realtimePromptMemo)); } catch { /* this session only */ }
}
/** Tabs (by id) whose prompt was answered in this app session (dismissed, shown on the desktop or reopened), and tabs that were live once. */
const realtimePromptAnswered = new Set<string>();
const realtimePromptLiveTabs = new Set<string>();
/** Forget what this session remembered (tests). */
export function resetRealtimePromptSession(): void { realtimePromptAnswered.clear(); realtimePromptLiveTabs.clear(); realtimePromptMemo = undefined; }
export function answerRealtimePrompt(tabId: string): void { if (tabId) realtimePromptAnswered.add(tabId); }

/**
 * When the realtime prompt shows (see REALTIME_PROMPT_STORAGE_KEY above). Only on the open result's word that NextMux
 * did not start the app in real-time mode: a window known only by its class (a tab reattached after a restart) may
 * well be real-time already, and the user's own switches (NEXTMUX_REALTIME_LAUNCH=0, an excluded program) are respected.
 */
export function realtimePromptVisible(input: {
    readonly tabId: string; readonly app: string; readonly windows: boolean; readonly placement?: ConversationWindowPlacement;
    readonly selfThrottles?: boolean; readonly realtimeLaunch?: boolean; readonly realtimeLaunchReason?: string; readonly tether?: string; readonly live: boolean;
    /** Something else owns the tab right now (plugin control, a reopen in progress). */
    readonly busy?: boolean; readonly now?: number
}): boolean {
    if (input.live && input.tabId) realtimePromptLiveTabs.add(input.tabId);
    return input.windows && input.placement === 'tab' && input.selfThrottles === true && input.realtimeLaunch === false
        && input.realtimeLaunchReason !== 'disabled' && input.realtimeLaunchReason !== 'excluded'
        && input.tether !== 'behind' && !input.busy && realtimePromptLiveTabs.has(input.tabId)
        && !realtimePromptAnswered.has(input.tabId) && !realtimePromptDismissed(input.app, input.now);
}

/**
 * The prompt itself: an infobar between the tab's header and its picture (as Chromium's infobars and VS Code's editor
 * banners), so it never covers the app's own controls. Reopening asks once more, inline, because the app closes first;
 * Esc steps back, then dismisses, unless the tab's keyboard switch sends keys to the app.
 */
function RealtimeLaunchPrompt(props: { readonly locale: NextMuxDesktopLocale; readonly app: string; readonly relaunchable: boolean;
    readonly keyboardCapture: boolean; readonly busy: boolean;
    readonly onReopen: () => void; readonly onShowOnDesktop: () => void; readonly onDismiss: () => void }): React.ReactElement {
    const { locale } = props;
    const [confirming, setConfirming] = React.useState(false);
    const titleId = `nmx-visual-tab-realtime-${React.useId().replace(/[^\w-]/g, '')}`;
    const confirmRef = React.useRef<HTMLButtonElement>(null);
    const reopenRef = React.useRef<HTMLButtonElement>(null);
    const stepped = React.useRef(false);
    // The confirming step replaces the button that was pressed: the focus moves with it (and back when stepping back).
    React.useEffect(() => {
        if (confirming) { stepped.current = true; confirmRef.current?.focus({ preventScroll: true }); }
        else if (stepped.current) { stepped.current = false; reopenRef.current?.focus({ preventScroll: true }); }
    }, [confirming]);
    const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
        if (event.key !== 'Escape' || props.keyboardCapture || event.defaultPrevented || event.nativeEvent?.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (confirming) setConfirming(false); else props.onDismiss();
    };
    // Clicks inside the bar stay in it: nothing reaches the tab around it.
    const keep = (event: React.SyntheticEvent): void => event.stopPropagation();
    return <section className='nmx-visual-tab-realtime' role='status' aria-live='polite' aria-labelledby={titleId} onKeyDown={onKeyDown}
        onPointerDown={keep} onMouseDown={keep} onClick={keep} onDoubleClick={keep} onContextMenu={keep} onWheel={keep}>
        <i className='codicon codicon-pulse' aria-hidden='true'></i>
        <div className='nmx-visual-tab-realtime-copy'>
            <strong id={titleId} data-nmx-literal>{conversationWindowText(locale, 'realtimeTitle', { app: props.app })}</strong>
            {confirming
                ? <span className='is-warning' data-nmx-literal>{conversationWindowText(locale, 'realtimeConfirm', { app: props.app })}</span>
                : <span>{conversationWindowText(locale, props.relaunchable ? 'realtimeBody' : 'realtimeUnavailable')}</span>}
        </div>
        <div className='nmx-visual-tab-realtime-actions'>
            {props.relaunchable && !confirming && <button ref={reopenRef} type='button' className='is-primary' disabled={props.busy}
                onClick={() => setConfirming(true)}>{conversationWindowText(locale, 'realtimeReopen')}</button>}
            {props.relaunchable && confirming && <button ref={confirmRef} type='button' className='is-primary' disabled={props.busy}
                onClick={() => { setConfirming(false); stepped.current = false; props.onReopen(); }}>{conversationWindowText(locale, 'reopenRunningConfirm')}</button>}
            {confirming
                ? <button type='button' disabled={props.busy} onClick={() => setConfirming(false)}>{conversationWindowText(locale, 'terminateCancel')}</button>
                : <button type='button' disabled={props.busy} onClick={props.onShowOnDesktop}>{conversationWindowText(locale, 'alsoOnDesktop')}</button>}
        </div>
        <button type='button' className='nmx-visual-tab-realtime-close' aria-label={conversationWindowText(locale, 'dismissNotice')} title={conversationWindowText(locale, 'dismissNotice')}
            onClick={props.onDismiss}><i className='codicon codicon-close' aria-hidden='true'></i></button>
    </section>;
}

/**
 * The body of an AI-opened tab: the live window (else its last frame, else a waiting state) under a slim toolbar.
 * The tab strip already names the tab, so the body does not repeat it.
 */
function LiveTabView(props: { readonly locale: NextMuxDesktopLocale; readonly tab: ConversationVisualTab; readonly active?: boolean; readonly controls?: ConversationWindowControls;
    readonly plugin?: ConversationTabPluginParts; readonly announcement?: { readonly id: number; readonly text: string };
    readonly onSelectWindow?: (pid: number, windowId: number) => void;
    readonly onReopenApp?: (mode: 'check_or_open' | 'restart') => Promise<'opened' | 'running' | 'failed'>;
    readonly scheduledTasks?: readonly ConversationTabScheduledTask[];
    readonly onToggleScheduledTask?: (taskId: string) => void;
    readonly onDeleteScheduledTask?: (taskId: string) => void }): React.ReactElement {
    const { locale, tab, controls } = props;
    // False while the tab is kept warm behind the conversation or another tab (renderCodingWorkbench): it keeps its
    // picture, but shows nothing, takes no input and holds none of the page's keys or focus.
    const tabActive = props.active !== false;
    const kind = tab.kind === 'virtual-machine' ? 'virtualMachine' : tab.kind === 'local-desktop' ? 'localDesktop' : 'remoteDesktop';
    const sectionRef = React.useRef<HTMLElement>(null);
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
        // Its key and focus traps are document-wide: a parked tab's dialog waits, open, until the tab is on show again.
        if (!reopenModalOpen || !tabActive) return undefined;
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
    }, [reopenModalOpen, tabActive]);

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
            const next = { left: box.left - outer.left + (box.width - width) / 2, top: box.top - outer.top + (box.height - height) / 2, width, height };
            setPictureBox(prev => prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height ? prev : next);
        };
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        observer.observe(container);
        // 'resize' fires when the stream's own size changes (the captured window was resized) while the element keeps
        // its box: without it the readings would stay drawn over the old letterbox until the tab itself resized.
        element.addEventListener('loadedmetadata', measure);
        element.addEventListener('resize', measure);
        measure();
        return () => { observer.disconnect(); element.removeEventListener('loadedmetadata', measure); element.removeEventListener('resize', measure); };
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
    const snapshotStreamRef = React.useRef(false);
    // The capture runs while NextMux is on screen, for a parked tab too; the picture's checks (health, stall watchdog,
    // snapshot bridge), the keyboard and the window's "seen" state (setVisible, which also decides its sound) follow
    // whether this tab is the one on show. Nobody sees the picture while NextMux is minimised or hidden (the main process
    // says so, watchWindowShown; the page itself stays "visible" with background throttling off): the capture stops then,
    // and starts again when the window shows, the tab on show first, so an open tab costs nothing in the background.
    const [pageVisible, setPageVisible] = React.useState(() => document.visibilityState !== 'hidden');
    const [windowShown, setWindowShown] = React.useState(() => typeof isWindowShown !== 'function' || isWindowShown());
    React.useEffect(() => {
        const update = (): void => setPageVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', update);
        const stopWindow = typeof watchWindowShown === 'function' ? watchWindowShown(() => setWindowShown(isWindowShown())) : undefined;
        return () => { document.removeEventListener('visibilitychange', update); stopWindow?.(); };
    }, []);
    const docVisible = pageVisible && windowShown;
    const visible = docVisible && tabActive;
    const visibleRef = React.useRef(visible);
    visibleRef.current = visible;
    const returnHealthRef = React.useRef<(() => void) | undefined>(undefined);
    React.useEffect(() => {
        if (sectionRef.current) (sectionRef.current as HTMLElement & { inert?: boolean }).inert = !tabActive;
    }, [tabActive]);
    React.useEffect(() => {
        const target = latest.current;
        void target?.setVisible?.(visible);
        if (visible) {
            const element = video.current;
            if (element?.srcObject && element.paused) void element.play().catch(() => undefined);
            // The snapshot bridge is created again for the tab on show and looks at the window then (its effect below).
            returnHealthRef.current?.();
        }
        return () => { void target?.setVisible?.(false); };
    }, [streamKey, visible]);
    React.useEffect(() => {
        setLive(false);
        snapshotStreamRef.current = false;
        returnHealthRef.current = undefined;
        if (!streamKey || !docVisible) return undefined;
        let stream: MediaStream | undefined;
        let disposed = false;
        let fallbackUsed = false;
        let usingSnapshotStream = false;
        let attached = false;
        let attachStartedAt = 0;
        let blackTicks = 0;
        // How long after a capture is attached (or its tab shows again) the tab itself looks for an all-black picture.
        const blackWatchMs = 4_000;
        // A black picture whose window is black too (a terminal, a film's dark scene, a loading screen) is right: checked
        // once per attach or return, with the window's own snapshot.
        let blackChecked = false;
        let blackChecking = false;
        let healthTimer: ReturnType<typeof setInterval> | undefined;
        let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
        let activeLoadedListener: (() => void) | undefined;
        const element = video.current;
        let measuredWidth = 0, measuredHeight = 0, measuredScale = 0;
        const clearAttachHandlers = (): void => {
            if (activeLoadedListener && element) {
                element.removeEventListener('loadeddata', activeLoadedListener);
                activeLoadedListener = undefined;
            }
            if (recoveryTimer) {
                clearTimeout(recoveryTimer);
                recoveryTimer = undefined;
            }
        };
        const measure = (): void => {
            if (!element?.videoWidth || !element.videoHeight) return;
            const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent);
            const scale = snapshotStreamRef.current || (placementRef.current === 'tab' && isMac)
                ? 1
                : Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
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

        let attachStream: (preferSnapshot: boolean) => void;
        const triggerSnapshotFallback = (): void => {
            if (disposed || usingSnapshotStream || fallbackUsed) return;
            fallbackUsed = true;
            blackTicks = 0;
            clearAttachHandlers();
            attachStream(true);
        };
        const checkActiveHealth = (): void => {
            if (disposed || !visibleRef.current || !element || !attached || !stream) return;
            const tracks = stream.getVideoTracks?.() || [];
            const hasLiveTrack = tracks.length > 0 && tracks.some(track => track.readyState !== 'ended');
            if (!hasLiveTrack) {
                if (!usingSnapshotStream && !fallbackUsed) {
                    triggerSnapshotFallback();
                } else if (!recoveryTimer && latest.current) {
                    const delay = typeof liveStallRestartDelay === 'function' ? liveStallRestartDelay(latest.current) : 1_000;
                    recoveryTimer = setTimeout(() => {
                        recoveryTimer = undefined;
                        if (!disposed) bumpStreamGeneration();
                    }, delay);
                }
                return;
            }
            if (element.srcObject !== stream) element.srcObject = stream;
            if (element.paused) void element.play().catch(() => undefined);
            if (element.readyState < 2) {
                if (!usingSnapshotStream && !fallbackUsed && attachStartedAt > 0 && Date.now() - attachStartedAt >= 1500) {
                    triggerSnapshotFallback();
                }
                return;
            }
            reveal();
            if (usingSnapshotStream || fallbackUsed) { blackTicks = 0; return; }
            if (typeof liveBridgeShown === 'function' && liveBridgeShown(element)) { blackTicks = 0; return; }
            // A capture that starts (or comes back into view) black gives way to snapshots. Past that, the snapshot bridge
            // watches the picture: reading a frame back from the GPU every tick for good would cost, and a film's black
            // scene must not switch a working capture to snapshots.
            if (blackChecked || blackChecking || Date.now() - attachStartedAt > blackWatchMs) { blackTicks = 0; return; }
            if (typeof isBlankOrPureBlackVideoFrame === 'function' && isBlankOrPureBlackVideoFrame(element)) {
                blackTicks += 1;
                if (blackTicks < 2) return;
                // Snapshots stand in only when the window shows what the picture does not (and the system can picture it at
                // all). A working capture of a terminal or a film's dark scene is black where the window is, with the same
                // title bar: the two pictures are compared, not the window with black.
                blackChecking = true;
                const checkedStream = stream;
                void Promise.resolve(latest.current?.snapshot?.(256, { binary: true })).catch(() => undefined)
                    .then(shot => typeof snapshotFingerprint === 'function' ? snapshotFingerprint(shot) : undefined)
                    .then(windowCells => {
                        blackChecking = false;
                        blackTicks = 0;
                        if (disposed || stream !== checkedStream) return;
                        blackChecked = true;
                        // The picture as it is now: a capture that came to life while the snapshot was taken keeps going.
                        if (!windowCells || typeof isBlankOrPureBlackVideoFrame === 'function' && !isBlankOrPureBlackVideoFrame(element)) return;
                        const shownCells = (typeof frameFingerprint === 'function' ? frameFingerprint(element, element.videoWidth, element.videoHeight) : undefined)
                            ?? new Uint8Array(windowCells.length);
                        // Apart somewhere by more than the noise between two pictures of one window (windowIsChanging's allowance).
                        if (windowCells.some((cell, index) => Math.abs(cell - (shownCells[index] ?? 0)) > 24)) triggerSnapshotFallback();
                    });
            } else {
                blackTicks = 0;
            }
        };
        returnHealthRef.current = () => {
            if (disposed) return;
            blackTicks = 0;
            blackChecked = false;
            attachStartedAt = Date.now();
            checkActiveHealth();
        };
        if (typeof setInterval === 'function') {
            healthTimer = setInterval(checkActiveHealth, 450);
        }

        attachStream = (preferSnapshot: boolean): void => {
            usingSnapshotStream = preferSnapshot;
            attached = false;
            blackTicks = 0;
            if (!preferSnapshot) snapshotStreamRef.current = false;
            void latest.current?.start({ ...(preferSnapshot ? { preferSnapshot: true } : {}), shown: () => visibleRef.current, current: () => !disposed }).then(result => {
                if (disposed) { result?.stream?.getTracks().forEach(track => track.stop()); return; }
                usingSnapshotStream = Boolean(result?.snapshotStream || preferSnapshot);
                snapshotStreamRef.current = usingSnapshotStream;
                if (result?.placement) { placementRef.current = result.placement; setPlacement(result.placement); }
                if (result?.sound !== undefined) setSound(result.sound);
                const nextStream = result?.stream;
                if (!nextStream || !element) {
                    if (!preferSnapshot && !fallbackUsed) triggerSnapshotFallback();
                    return;
                }
                clearAttachHandlers();
                const previousStream = stream;
                stream = nextStream;
                attached = true;
                attachStartedAt = Date.now();
                blackChecked = false;
                element.srcObject = nextStream;
                if (previousStream && previousStream !== nextStream) {
                    previousStream.getTracks().forEach(track => track.stop());
                }
                const onReady = (): void => {
                    if (disposed || stream !== nextStream) return;
                    activeLoadedListener = undefined;
                    reveal();
                };
                if (element.readyState >= 2) {
                    onReady();
                } else {
                    activeLoadedListener = onReady;
                    element.addEventListener('loadeddata', onReady, { once: true });
                }
                void element.play().catch(() => undefined);
                // The app closed the window (or WGC revoked the source): try snapshot fallback once, else fall back to last frame.
                nextStream.getVideoTracks()[0]?.addEventListener('ended', () => {
                    if (disposed || stream !== nextStream) return;
                    if (!usingSnapshotStream && !fallbackUsed) {
                        triggerSnapshotFallback();
                    } else {
                        setLive(false);
                    }
                });
            }).catch(() => {
                if (!disposed && !preferSnapshot && !fallbackUsed) {
                    fallbackUsed = true;
                    clearAttachHandlers();
                    attachStream(true);
                }
            });
        };
        // A capture that froze repeatedly this session gives way to the window's own snapshots for a while.
        const preferSnapshots = typeof liveStallPrefersSnapshots === 'function' && Boolean(latest.current) && liveStallPrefersSnapshots(latest.current);
        if (preferSnapshots) fallbackUsed = true;
        attachStream(preferSnapshots);
        return () => {
            disposed = true;
            returnHealthRef.current = undefined;
            if (healthTimer) clearInterval(healthTimer);
            clearAttachHandlers();
            element?.removeEventListener('resize', measure);
            stream?.getTracks().forEach(track => track.stop());
            if (element) element.srcObject = null;
        };
    }, [streamKey, generation, docVisible]);
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
    const generationBumpRef = React.useRef(0);
    const bumpStreamGeneration = (): void => {
        generationBumpRef.current += 1;
        setGeneration(generationBumpRef.current);
    };
    const move = (next: ConversationWindowPlacement): void => {
        if (moving || !latest.current) return;
        const genBefore = generationBumpRef.current;
        setMoving(true); setNotice(undefined);
        void latest.current.place(next).then(result => {
            if (result) {
                const changed = result !== placementRef.current;
                placementRef.current = result;
                setPlacement(result);
                if (changed || generationBumpRef.current === genBefore) {
                    bumpStreamGeneration();
                }
            } else setNotice('moveFailed');
        }, () => setNotice('moveFailed')).finally(() => setMoving(false));
    };
    const [windowMenuOpen, setWindowMenuOpen] = React.useState(false);
    const [terminateModalOpen, setTerminateModalOpen] = React.useState(false);
    const localOverlayOpen = windowMenuOpen || terminateModalOpen || reopenModalOpen || Boolean(props.plugin?.studio);
    const overlayOpenRef = React.useRef(localOverlayOpen);
    overlayOpenRef.current = localOverlayOpen;
    const toggleMouse = (on: boolean): void => {
        setMouse(on);
        void latest.current?.setUserInput?.(on);
        // Typing goes to the app right after the user turns the switch on. Only then (and on a click in the picture): a
        // restarted capture or the AI's tabs.set never takes the focus from the user's message box.
        if (on) requestAnimationFrame(() => {
            const active = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
            const inPluginChat = Boolean(active?.closest?.('.nmx-plugin-chat-overlay, .nmx-plugin-chat-panel'));
            if (latest.current?.keys && !inPluginChat && !hasOpenOverlayOrModal(sectionRef.current, overlayOpenRef.current)) {
                keyboard.current?.focus({ preventScroll: true });
            }
        });
        if (!on) {
            resetHoverMove();
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
        // The realtime prompt reads selfThrottles and tether straight from the state: draw again when they arrive.
        setRealtimeFacts(`${state.selfThrottles === true}:${state.tether || ''}`);
        setParkReason(state.parkReason);
        setMouse(state.userInput);
        if (!state.userInput) {
            resetHoverMove();
            inputQueue.current.cancel();
            if (pendingText.current.timer) { clearTimeout(pendingText.current.timer); pendingText.current.timer = undefined; }
            pendingText.current.text = ''; pendingText.current.target = undefined;
            keyboard.current?.blur();
        }
        if (state.sound !== undefined) setSound(state.sound);
        if (state.placement && state.placement !== placementRef.current) {
            placementRef.current = state.placement;
            setPlacement(state.placement);
            bumpStreamGeneration();
        }
    }), [controls]);
    const toggleSound = (on: boolean): void => {
        void latest.current?.setSound(on).then(result => {
            if (result === undefined) setNotice('soundFailed'); else setSound(result);
        }, () => setNotice('soundFailed'));
    };
    // Typing: a hidden text field takes the keys while the picture is focused, so input methods (Chinese, Japanese …)
    // compose as usual; finished text goes to the app in short batches, shortcuts and special keys one by one.
    const keyboard = React.useRef<HTMLTextAreaElement>(null);
    const inputQueue = React.useRef(new ConversationWindowInputQueue());
    const handledKeyEvents = React.useRef(new WeakSet<object>());
    const hoverMove = React.useRef<{ x: number; y: number; lastAt: number; inFlight: boolean; pending?: { x: number; y: number }; timer?: ReturnType<typeof setTimeout> }>({
        x: -1, y: -1, lastAt: 0, inFlight: false
    });
    const resetHoverMove = (): void => {
        if (hoverMove.current.timer) { clearTimeout(hoverMove.current.timer); hoverMove.current.timer = undefined; }
        hoverMove.current.pending = undefined;
    };
    const isOverlayBlockingInput = (): boolean => typeof hasOpenOverlayOrModal === 'function' && typeof sectionRef !== 'undefined'
        ? hasOpenOverlayOrModal(sectionRef.current, typeof overlayOpenRef !== 'undefined' ? overlayOpenRef.current : false)
        : false;
    const notifyMouseOff = (): void => {
        if (typeof setNotice === 'function') setNotice('mouseOff');
    };
    const extractMods = (event: { readonly metaKey?: boolean; readonly ctrlKey?: boolean; readonly altKey?: boolean; readonly shiftKey?: boolean }): ConversationPointerModifier[] => {
        if (typeof pointerModifiers === 'function') return pointerModifiers(event as Pick<React.MouseEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>);
        const mods: ConversationPointerModifier[] = [];
        if (event.metaKey) mods.push('cmd');
        if (event.ctrlKey) mods.push('ctrl');
        if (event.altKey) mods.push('alt');
        if (event.shiftKey) mods.push('shift');
        return mods;
    };
    // A batch belongs to the window it was typed for: switching tabs before it is sent never redirects it.
    const pendingText = React.useRef<{ text: string; timer?: ReturnType<typeof setTimeout>; generation?: number; target?: ConversationWindowControls }>({ text: '' });
    const nudgeLivePicture = (ok: unknown): void => {
        if (ok && typeof nudgeLiveVideoBridge === 'function') nudgeLiveVideoBridge(video.current);
    };
    const drainPendingText = (): void => {
        const pending = pendingText.current;
        if (pending.timer) { clearTimeout(pending.timer); pending.timer = undefined; }
        if (!pending.text) return;
        const batch = pending.text, target = pending.target, generation = pending.generation;
        pending.text = ''; pending.target = undefined;
        if (!target?.keys) return;
        void inputQueue.current.text(batch, text => target.keys!({ text }).then(ok => { nudgeLivePicture(ok); return ok; }), generation);
    };
    const flushPendingText = (): void => {
        drainPendingText();
    };
    React.useEffect(() => () => {
        resetHoverMove();
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
    const onKeyboardDown = (event: React.KeyboardEvent<HTMLElement>): void => {
        const rawNative = event.nativeEvent as unknown as object | undefined;
        if (rawNative && typeof rawNative === 'object' && handledKeyEvents.current.has(rawNative)) return;
        if (event.defaultPrevented || event.nativeEvent?.isComposing || event.keyCode === 229) return;
        if (isOverlayBlockingInput()) return;
        const chord = keyChord(event);
        if (!chord) return;
        if (rawNative && typeof rawNative === 'object') handledKeyEvents.current.add(rawNative);
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent?.stopImmediatePropagation?.();
        flushPendingText();
        drainWheel();
        const target = latest.current;
        if (target?.keys) void inputQueue.current.enqueue(() => target.keys!({ key: chord.key, ...(chord.modifiers.length ? { modifiers: chord.modifiers } : {}) }).then(ok => { nudgeLivePicture(ok); return ok; }));
    };
    const onKeyboardInput = (event: React.FormEvent<HTMLTextAreaElement>): void => {
        if ((event.nativeEvent as InputEvent).isComposing) return;
        if (isOverlayBlockingInput()) return;
        sendText(event.currentTarget.value);
        event.currentTarget.value = '';
    };
    const onKeyboardCompositionEnd = (event: React.CompositionEvent<HTMLTextAreaElement>): void => {
        if (isOverlayBlockingInput()) return;
        sendText(event.currentTarget.value || event.data);
        event.currentTarget.value = '';
    };
    // Scrolls add up over a short while so a trackpad flick is one request, not dozens.
    const wheel = React.useRef<{ deltaX: number; deltaY: number; x: number; y: number; timer?: ReturnType<typeof setTimeout>; generation?: number; target?: ConversationWindowControls }>({ deltaX: 0, deltaY: 0, x: 0, y: 0 });
    React.useEffect(() => () => {
        resetHoverMove();
        hoverMove.current.x = -1;
        hoverMove.current.y = -1;
        hoverMove.current.lastAt = 0;
        if (wheel.current.timer) clearTimeout(wheel.current.timer);
        wheel.current = { deltaX: 0, deltaY: 0, x: 0, y: 0 };
    }, [streamKey]);
    const drainWheel = (): void => {
        const pending = wheel.current;
        if (pending.timer) { clearTimeout(pending.timer); pending.timer = undefined; }
        const deltaX = pending.deltaX, deltaY = pending.deltaY, target = pending.target, x = pending.x, y = pending.y, gen = pending.generation;
        pending.deltaX = 0; pending.deltaY = 0; pending.target = undefined;
        if (!target) return;
        if (Math.abs(deltaY) >= 4) {
            const amountY = Math.min(10, Math.max(1, Math.round(Math.abs(deltaY) / 40)));
            void inputQueue.current.enqueue(() => target.pointer({ kind: 'scroll', x, y, direction: deltaY > 0 ? 'down' : 'up', amount: amountY }).then(ok => { nudgeLivePicture(ok); return ok; }), gen);
        }
        if (Math.abs(deltaX) >= 4) {
            const amountX = Math.min(10, Math.max(1, Math.round(Math.abs(deltaX) / 40)));
            void inputQueue.current.enqueue(() => target.pointer({ kind: 'scroll', x, y, direction: deltaX > 0 ? 'right' : 'left', amount: amountX }).then(ok => { nudgeLivePicture(ok); return ok; }), gen);
        }
    };
    const onWheel = (event: React.WheelEvent<HTMLVideoElement>): void => {
        if (!mouse || !video.current) return;
        const at = pictureFraction(video.current, event.clientX, event.clientY);
        if (!at) return;
        resetHoverMove();
        flushPendingText();
        const pending = wheel.current;
        if (pending.generation !== inputQueue.current.currentGeneration) { pending.deltaX = 0; pending.deltaY = 0; }
        pending.generation = inputQueue.current.currentGeneration;
        const rawDeltaX = Number.isFinite(event.deltaX) ? event.deltaX : 0;
        const rawDeltaY = Number.isFinite(event.deltaY) ? event.deltaY : 0;
        if (event.shiftKey && rawDeltaX === 0 && rawDeltaY !== 0) {
            pending.deltaX += rawDeltaY;
        } else {
            pending.deltaX += rawDeltaX;
            pending.deltaY += rawDeltaY;
        }
        pending.x = at.x; pending.y = at.y; pending.target = latest.current;
        if (pending.timer) return;
        pending.timer = setTimeout(drainWheel, 24);
    };
    const dragStart = React.useRef<{ x: number; y: number; clientX: number; clientY: number; pointerId: number; button: 'left' | 'middle' | 'right' } | undefined>(undefined);
    const suppressPointerButtons = React.useRef<{ click: boolean; context: boolean; aux: boolean }>({ click: false, context: false, aux: false });
    const flushHoverMove = (): void => {
        const state = hoverMove.current;
        if (state.timer) { clearTimeout(state.timer); state.timer = undefined; }
        if (state.inFlight || !state.pending) return;
        const target = latest.current;
        const next = state.pending;
        state.pending = undefined;
        if (!target) return;
        const now = Date.now();
        const elapsed = now - state.lastAt;
        if (elapsed < 32) {
            state.pending = next;
            state.timer = setTimeout(flushHoverMove, 32 - elapsed);
            return;
        }
        state.x = next.x;
        state.y = next.y;
        state.lastAt = now;
        state.inFlight = true;
        void Promise.resolve(target.pointer({ kind: 'move', x: next.x, y: next.y })).catch(() => false).then(ok => {
            if (ok && typeof nudgeLiveVideoBridge === 'function') nudgeLiveVideoBridge(video.current);
        }).finally(() => {
            state.inFlight = false;
            if (state.pending) flushHoverMove();
        });
    };
    const onPointerMove = (event: React.PointerEvent<HTMLVideoElement>): void => {
        if ((typeof live !== 'undefined' && !live) || !mouse || !video.current) return;
        if (dragStart.current && ((event.buttons ?? 0) & 7) !== 0) return;
        const at = pictureFraction(video.current, event.clientX, event.clientY);
        if (!at) return;
        const state = hoverMove.current;
        const refX = state.pending ? state.pending.x : state.x;
        const refY = state.pending ? state.pending.y : state.y;
        if (refX >= 0 && Math.hypot(at.x - refX, at.y - refY) < 0.002) return;
        state.pending = at;
        flushHoverMove();
    };
    const onPointerDown = (event: React.PointerEvent<HTMLVideoElement>): void => {
        const btn = event.button ?? 0;
        if (!mouse || (btn !== 0 && btn !== 1 && btn !== 2) || !video.current) return;
        const at = pictureFraction(video.current, event.clientX, event.clientY);
        if (!at) return;
        suppressPointerButtons.current = { click: false, context: false, aux: false };
        resetHoverMove();
        if (latest.current?.keys) keyboard.current?.focus({ preventScroll: true });
        dragStart.current = {
            x: at.x,
            y: at.y,
            clientX: event.clientX,
            clientY: event.clientY,
            pointerId: event.pointerId,
            button: btn === 2 ? 'right' : btn === 1 ? 'middle' : 'left'
        };
        // A drag released outside the picture still ends here.
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    };
    const finishPointerDrag = (event: React.PointerEvent<HTMLVideoElement>, cancelled: boolean): void => {
        const start = dragStart.current;
        dragStart.current = undefined;
        try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* released */ }
        if (cancelled) resetHoverMove();
        if (!start || start.pointerId !== event.pointerId || !mouse || !video.current) return;
        if (cancelled && event.clientX === 0 && event.clientY === 0) return;
        if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 8) return;
        const to = pictureFraction(video.current, event.clientX, event.clientY, true);
        if (!to) return;
        suppressPointerButtons.current = {
            click: start.button === 'left',
            context: start.button === 'right',
            aux: start.button === 'middle'
        };
        resetHoverMove();
        flushPendingText();
        drainWheel();
        if (latest.current?.keys) keyboard.current?.focus({ preventScroll: true });
        const mods = extractMods(event);
        const target = latest.current;
        if (target) {
            void inputQueue.current.enqueue(() => target.pointer({
                kind: 'drag',
                from: { x: start.x, y: start.y },
                to,
                durationMs: 250,
                ...(start.button !== 'left' ? { button: start.button } : {}),
                ...(mods.length ? { modifiers: mods } : {})
            }).then(ok => { nudgeLivePicture(ok); return ok; }));
        }
    };
    const onPointerUp = (event: React.PointerEvent<HTMLVideoElement>): void => finishPointerDrag(event, false);
    const onPointerCancel = (event: React.PointerEvent<HTMLVideoElement>): void => finishPointerDrag(event, true);
    const onMouseDown = (event: React.MouseEvent<HTMLVideoElement>): void => {
        if (event.button === 1) event.preventDefault();
    };
    const onClick = (event: React.MouseEvent<HTMLVideoElement>): void => {
        if (suppressPointerButtons.current.click) { suppressPointerButtons.current.click = false; return; }
        if (!video.current) return;
        if (!mouse) { notifyMouseOff(); return; }
        resetHoverMove();
        flushPendingText();
        drainWheel();
        if (latest.current?.keys) keyboard.current?.focus({ preventScroll: true });
        const at = pictureFraction(video.current, event.clientX, event.clientY);
        const mods = extractMods(event);
        // On Windows, restore:true returns focus to NextMux after a single click; pass whole:true on detail===2 so double-click is atomic.
        const target = latest.current, double = event.detail === 2;
        if (at && target) {
            void inputQueue.current.enqueue(() => target.pointer({
                kind: double ? 'doubleClick' : 'click',
                ...(double ? { whole: true } : {}),
                ...(mods.length ? { modifiers: mods } : {}),
                ...at
            }).then(ok => { nudgeLivePicture(ok); return ok; }));
        }
    };
    const onAuxClick = (event: React.MouseEvent<HTMLVideoElement>): void => {
        if (event.button !== 1 || !video.current) return;
        event.preventDefault();
        if (suppressPointerButtons.current.aux) { suppressPointerButtons.current.aux = false; return; }
        if (!mouse) { notifyMouseOff(); return; }
        resetHoverMove();
        flushPendingText();
        drainWheel();
        if (latest.current?.keys) keyboard.current?.focus({ preventScroll: true });
        const at = pictureFraction(video.current, event.clientX, event.clientY);
        const mods = extractMods(event);
        const target = latest.current;
        if (at && target) {
            void inputQueue.current.enqueue(() => target.pointer({
                kind: 'click',
                button: 'middle',
                ...(mods.length ? { modifiers: mods } : {}),
                ...at
            }).then(ok => { nudgeLivePicture(ok); return ok; }));
        }
    };
    const onContextMenu = (event: React.MouseEvent<HTMLVideoElement>): void => {
        if (!video.current) return;
        event.preventDefault();
        if (suppressPointerButtons.current.context) { suppressPointerButtons.current.context = false; return; }
        if (!mouse) { notifyMouseOff(); return; }
        resetHoverMove();
        flushPendingText();
        drainWheel();
        if (latest.current?.keys) keyboard.current?.focus({ preventScroll: true });
        const at = pictureFraction(video.current, event.clientX, event.clientY);
        const mods = extractMods(event);
        const target = latest.current;
        if (at && target) {
            void inputQueue.current.enqueue(() => target.pointer({
                kind: 'click',
                button: 'right',
                ...(mods.length ? { modifiers: mods } : {}),
                ...at
            }).then(ok => { nudgeLivePicture(ok); return ok; }));
        }
    };
    const statusText = live ? conversationWindowText(locale, 'live')
        : `${tab.frameUrl && streamKey ? `${conversationWindowText(locale, 'lastFrame')} · ` : ''}${conversationTabsText(locale, tab.status)}`;
    const windows = tab.windows?.length ? tab.windows : tabWindows(tab);
    const activeWindow = windows.find(item => tab.windowRef && item.pid === tab.windowRef.pid && item.windowId === tab.windowRef.windowId) || windows[windows.length - 1];
    const windowMenuRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (!windowMenuOpen) return undefined;
        const onDocMouseDown = (event: MouseEvent): void => {
            if (windowMenuRef.current && !windowMenuRef.current.contains(event.target as Node | null)) setWindowMenuOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') setWindowMenuOpen(false);
        };
        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [windowMenuOpen]);
    React.useEffect(() => { if (!tabActive) setWindowMenuOpen(false); }, [tabActive]);
    const canTerminate = Boolean(streamKey && (live || tab.status === 'connected') && typeof controls?.terminateProcess === 'function');
    const [liveBubbleState, setLiveBubbleState] = React.useState<'hidden' | 'visible' | 'fading'>('hidden');
    const [terminating, setTerminating] = React.useState(false);
    React.useEffect(() => {
        if (!canTerminate) {
            setLiveBubbleState('hidden');
            setTerminateModalOpen(false);
            return undefined;
        }
        // The one-time hint waits for the tab to be on show (a tab kept warm behind the conversation would spend it unseen).
        if (!tabActive) {
            setLiveBubbleState('hidden');
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
    }, [canTerminate, tab.id, tabActive]);
    React.useEffect(() => {
        if (!terminateModalOpen || !tabActive) return undefined;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape' && !terminating) setTerminateModalOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [terminateModalOpen, terminating, tabActive]);
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
    const pluginWindowSurfaceOpen = (): boolean => {
        if (typeof hasOpenPluginWindowSurface === 'function') return hasOpenPluginWindowSurface();
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return false;
        const nodes = document.querySelectorAll('.nmx-plugin-window-dialog, .nmx-plugin-subwindow-backdrop');
        for (let i = 0; i < nodes.length; i += 1) {
            const el = nodes[i] as HTMLElement;
            if (!el.hidden && el.getAttribute?.('aria-hidden') !== 'true' && !el.closest?.('[hidden], [aria-hidden="true"]') && el.style?.display !== 'none' && el.style?.visibility !== 'hidden') return true;
        }
        return false;
    };
    const pluginEscActive = Boolean(props.plugin?.running && typeof props.plugin.onStop === 'function');
    const pluginStopRef = React.useRef(props.plugin?.onStop);
    pluginStopRef.current = props.plugin?.onStop;
    React.useEffect(() => {
        if (!visible || mouse || !pluginEscActive || localOverlayOpen) return undefined;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.defaultPrevented || event.isComposing) return;
            // A held Escape that just closed the plugin's window or modal must not go on to stop the run: only a fresh
            // press stops it (the first keydown of a held key is never a repeat, so a deliberate stop still works).
            if (event.repeat) return;
            if (hasOpenOverlayOrModal(sectionRef.current, localOverlayOpen) || pluginWindowSurfaceOpen()) return;
            const targetNode = event.target as HTMLElement | null;
            if (targetNode?.closest?.('.nmx-plugin-chat-overlay, .nmx-plugin-chat-panel, .nmx-plugin-window-dialog, .nmx-plugin-subwindow-dialog')) return;
            const isTextInput = targetNode?.tagName === 'INPUT' && !['checkbox', 'radio'].includes(((targetNode as HTMLInputElement).type || 'text').toLowerCase());
            if (targetNode && (isTextInput || targetNode.tagName === 'TEXTAREA' || targetNode.tagName === 'SELECT' || targetNode.isContentEditable)) return;
            event.preventDefault();
            event.stopPropagation();
            pluginStopRef.current?.();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [visible, mouse, pluginEscActive, localOverlayOpen]);
    React.useEffect(() => {
        if (!visible || !live || !mouse || localOverlayOpen) return undefined;
        const isPluginChatNode = (node: HTMLElement | null): boolean => Boolean(node?.closest?.('.nmx-plugin-chat-overlay, .nmx-plugin-chat-panel'));
        const isTextEntryNode = (node: HTMLElement | null): boolean => {
            if (!node) return false;
            if (isPluginChatNode(node)) return true;
            const tag = node.tagName;
            if (tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable) return true;
            if (tag === 'INPUT') {
                const inputType = ((node as HTMLInputElement).type || 'text').toLowerCase();
                return inputType !== 'checkbox' && inputType !== 'radio';
            }
            return false;
        };
        const active = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
        // The plans drawer is no overlay (it never pauses 键鼠), but a capture restart must not pull the focus out of it either.
        if (!hasOpenOverlayOrModal(sectionRef.current, localOverlayOpen) && !isTextEntryNode(active) && !active?.closest?.('.nmx-visual-tab-schedule')
            && latest.current?.keys) {
            keyboard.current?.focus({ preventScroll: true });
        }
        const onWindowKeyDownCapture = (event: KeyboardEvent): void => {
            if (!keyboard.current || document.activeElement !== keyboard.current) return;
            if ((event.target as HTMLElement | null)?.closest?.('.nmx-plugin-chat-overlay, .nmx-plugin-chat-panel, .nmx-plugin-window-dialog, .nmx-plugin-subwindow-dialog')) return;
            if (hasOpenOverlayOrModal(sectionRef.current, localOverlayOpen)) return;
            if (event.key === 'Escape' && pluginWindowSurfaceOpen()) return;
            if (event.isComposing || event.keyCode === 229) return;
            const target = latest.current;
            if (!target?.keys) return;
            const chord = keyChord(event);
            if (!chord) return;
            handledKeyEvents.current.add(event);
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            flushPendingText();
            drainWheel();
            void inputQueue.current.enqueue(() => target.keys!({ key: chord.key, ...(chord.modifiers.length ? { modifiers: chord.modifiers } : {}) }));
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (handledKeyEvents.current.has(event)) return;
            if (event.key !== 'Escape' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.defaultPrevented || event.isComposing) return;
            if (hasOpenOverlayOrModal(sectionRef.current, localOverlayOpen) || pluginWindowSurfaceOpen()) return;
            const targetNode = event.target as HTMLElement | null;
            if (targetNode === keyboard.current || isTextEntryNode(targetNode)) return;
            const target = latest.current;
            if (!target?.keys) return;
            handledKeyEvents.current.add(event);
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            keyboard.current?.focus({ preventScroll: true });
            flushPendingText();
            drainWheel();
            void inputQueue.current.enqueue(() => target.keys!({ key: 'escape' }));
        };
        if (typeof window !== 'undefined') window.addEventListener('keydown', onWindowKeyDownCapture, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            if (typeof window !== 'undefined') window.removeEventListener('keydown', onWindowKeyDownCapture, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [visible, live, mouse, localOverlayOpen]);
    // Mid-session frame-stall watchdog (watchLiveVideoFrames): a picture that stops while its window keeps changing
    // restarts the capture (at once, then with backoff); a capture that keeps freezing gives way to window snapshots.
    // In front of it, the snapshot bridge (nextmux-live-frame-bridge.ts) keeps the picture moving within 600 ms of a
    // stall or a repeated frame by drawing the window's own snapshots over the video until real frames come back; a
    // bridge that has to keep going for 4 s restarts the capture the same way (once per stall, with the same backoff).
    React.useEffect(() => {
        const element = video.current, owner = latest.current;
        if (!live || !visible || !element || !owner?.snapshot || typeof watchLiveVideoFrames !== 'function') return undefined;
        let restart: ReturnType<typeof setTimeout> | undefined;
        const stop = watchLiveVideoFrames(element, {
            windowFingerprint: async () => snapshotFingerprint(await owner.snapshot!(256, { binary: true }).catch(() => undefined)),
            shownFingerprint: () => frameFingerprint(element, element.videoWidth, element.videoHeight),
            onStall: () => { restart = setTimeout(bumpStreamGeneration, liveStallRestartDelay(owner)); }
        });
        // A picture made of snapshots already (snapshotWindowStream) has nothing to bridge.
        const canvas = screen.current?.querySelector?.('canvas.nmx-visual-tab-bridge') as HTMLCanvasElement | null | undefined;
        const stopBridge = canvas && !snapshotStreamRef.current && typeof bridgeLiveVideo === 'function' ? bridgeLiveVideo(element, canvas, {
            snapshot: async maxSize => {
                const shot = await owner.snapshot!(maxSize, { binary: true }).catch(() => undefined);
                return !shot ? undefined : 'error' in shot ? { ok: false, error: shot.error } : { ok: true, ...shot };
            },
            maxSize: () => {
                const box = screen.current?.getBoundingClientRect?.();
                const scale = Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
                return box && (box.width > 0 || box.height > 0) ? Math.round(Math.min(2048, Math.max(1280, Math.max(box.width, box.height) * scale))) : 1280;
            },
            onLongStall: () => {
                if (restart) return;
                stop();
                restart = setTimeout(bumpStreamGeneration, liveStallRestartDelay(owner));
            },
            // The black-frame fallback can switch this stream to snapshots without a new effect run.
            enabled: () => !snapshotStreamRef.current
        }) : undefined;
        // Shown again (or freshly attached): the window may have changed while nobody looked, so a still picture gets a
        // prompt look at the window itself instead of waiting for the slow probe.
        if (stopBridge && typeof nudgeLiveVideoBridge === 'function') nudgeLiveVideoBridge(element);
        return () => { stop(); stopBridge?.(); if (restart) clearTimeout(restart); };
    }, [live, visible, streamKey, generation]);
    // The closed AI Console's launcher: which edge of the picture it rests on (shared by every tab, kept across restarts).
    const [chatDock, setChatDock] = React.useState<PluginChatDock>(() => typeof readStoredPluginChatDock === 'function' ? readStoredPluginChatDock() : { edge: 'right', offsetRatio: 0.5 });
    const dockChat = (dock: PluginChatDock): void => {
        setChatDock(dock);
        if (typeof storePluginChatDock === 'function') storePluginChatDock(dock);
    };
    // The realtime prompt (Windows): what the open result said about this window, and what the app side says now.
    const [, setRealtimeFacts] = React.useState('');
    const realtimeWindow = windows.find(item => tab.windowRef && item.pid === tab.windowRef.pid && item.windowId === tab.windowRef.windowId);
    const realtimeFacts = realtimeWindow && typeof realtimeWindow.realtimeLaunch === 'boolean' ? realtimeWindow
        : windows.find(item => tab.windowRef && item.pid === tab.windowRef.pid && typeof item.realtimeLaunch === 'boolean') || realtimeWindow;
    const realtimeApp = (tab.appId || tab.title || tab.target || '').trim().toLowerCase();
    const realtimeShown = typeof realtimePromptVisible === 'function' && Boolean(streamKey) && realtimePromptVisible({
        tabId: tab.id, app: realtimeApp, windows: tab.platform === 'windows', placement,
        selfThrottles: realtimeFacts?.selfThrottles === true || controls?.state?.selfThrottles === true,
        realtimeLaunch: realtimeFacts?.realtimeLaunch, realtimeLaunchReason: realtimeFacts?.realtimeLaunchReason,
        tether: controls?.state?.tether, live, busy: pluginEscActive || reopening
    });
    // Answered: the bar closes. Keyboard focus inside it moves to the tab's placement switch instead of falling to the page.
    const answerRealtime = (focus: 'pressed' | 'desktop' = 'pressed'): void => {
        const active = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
        if (active?.closest?.('.nmx-visual-tab-realtime')) {
            // The placement buttons are disabled while the window moves: wait for them (up to a second).
            const land = (attempt: number): void => {
                const target = sectionRef.current?.querySelector?.(focus === 'desktop' ? '.nmx-visual-tab-place-btn.is-desktop'
                    : '.nmx-visual-tab-place-btn[aria-pressed="true"]') as HTMLButtonElement | null;
                if (target && !target.disabled) target.focus({ preventScroll: true });
                else if (attempt < 20) setTimeout(() => land(attempt + 1), 50);
            };
            requestAnimationFrame(() => land(0));
        }
        if (typeof answerRealtimePrompt === 'function') answerRealtimePrompt(tab.id);
        setRealtimeFacts(`answered:${Date.now()}`);
    };
    const onSectionKeyDownCapture = (event: React.KeyboardEvent<HTMLElement>): void => {
        if (!live || !mouse || !latest.current?.keys) return;
        if (hasOpenOverlayOrModal(sectionRef.current, localOverlayOpen)) return;
        if (event.key === 'Escape' && pluginWindowSurfaceOpen()) return;
        const targetNode = event.target as HTMLElement | null;
        if (targetNode === keyboard.current) return;
        if (targetNode?.closest?.('.nmx-app-plugin-bar, .nmx-plugin-runbar, .nmx-plugin-chat-panel, .nmx-plugin-chat-overlay, .nmx-visual-tab-plugin-controls, .nmx-plugin-window-dialog, .nmx-plugin-subwindow-dialog, .nmx-visual-tab-windows, .nmx-visual-tab-terminate-modal, .nmx-visual-tab-schedule-drawer')) return;
        const tag = targetNode?.tagName;
        const isTextInput = tag === 'INPUT' && !['checkbox', 'radio'].includes(((targetNode as HTMLInputElement).type || 'text').toLowerCase());
        if (isTextInput || tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'BUTTON' && event.key !== 'Escape') || targetNode?.isContentEditable) return;
        keyboard.current?.focus({ preventScroll: true });
        const chord = keyChord(event);
        if (chord) {
            onKeyboardDown(event);
        } else if (!event.metaKey && !event.ctrlKey && !event.altKey && typeof event.key === 'string' && event.key.length === 1 && !event.nativeEvent?.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent?.stopImmediatePropagation?.();
            sendText(event.key);
        }
    };
    const appDisplayName = tab.title || tab.target;
    // Several tabs can be mounted at once (kept warm): each dialog labels itself by its own ids.
    const dialogIds = `nmx-visual-tab-${(typeof React.useId === 'function' ? React.useId() : tab.id).replace(/[^\w-]/g, '')}`;
    const glyph = (name: ConversationTabGlyphName, size?: number): React.ReactNode => typeof ConversationTabGlyph === 'function' ? <ConversationTabGlyph name={name} size={size} /> : null;
    return <section ref={sectionRef} className={`nmx-visual-tab is-${tab.status}${live ? ' is-live' : ''}${mouse ? ' is-pointer' : ''}${tabActive ? '' : ' is-parked'}`}
        aria-label={tab.title} aria-hidden={!tabActive || undefined} onKeyDownCapture={onSectionKeyDownCapture}>
        <header className='nmx-visual-tab-bar'>
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
            {/* The conversation's plans sit right before 键鼠: a clock and their count, the list in a drawer on hover. */}
            {typeof TabScheduleControl === 'function' && props.scheduledTasks?.length ? <TabScheduleControl locale={locale} tasks={props.scheduledTasks}
                onToggle={props.onToggleScheduledTask} onDelete={props.onDeleteScheduledTask} /> : null}
            {streamKey && controls?.canPoint && <button type='button' role='switch' aria-checked={mouse}
                className={`nmx-visual-tab-icon-btn nmx-visual-tab-switch is-input ${mouse ? 'is-on' : 'is-off'}`}
                aria-label={`${conversationWindowText(locale, 'mouse')} · ${conversationWindowText(locale, mouse ? 'switchOn' : 'switchOff')}`}
                title={`${conversationWindowText(locale, 'mouse')} · ${conversationWindowText(locale, mouse ? 'switchOn' : 'switchOff')}\n${conversationWindowText(locale, 'mouseHint')}`}
                onClick={() => toggleMouse(!mouse)}>
                {glyph(mouse ? 'input' : 'input-off')}
            </button>}
            {streamKey && controls?.canMute && sound !== undefined && <button type='button' role='switch' aria-checked={sound}
                className={`nmx-visual-tab-icon-btn nmx-visual-tab-switch is-sound ${sound ? 'is-on' : 'is-off'}`}
                aria-label={`${conversationWindowText(locale, 'sound')} · ${conversationWindowText(locale, sound ? 'switchOn' : 'soundOff')}`}
                title={`${conversationWindowText(locale, 'sound')} · ${conversationWindowText(locale, sound ? 'switchOn' : 'soundOff')}\n${conversationWindowText(locale, 'soundHint')}`}
                onClick={() => toggleSound(!sound)}>
                {glyph(sound ? 'sound' : 'sound-off')}
            </button>}
            {streamKey && controls?.canPark && placement && <div className='nmx-visual-tab-place' role='group' aria-label={conversationWindowText(locale, 'placement')}>
                {(['tab', 'desktop'] as const).map(value => {
                    const label = conversationWindowText(locale, value === 'tab' ? 'onlyInTab' : 'alsoOnDesktop');
                    return <button key={value} type='button' className={`nmx-visual-tab-place-btn is-${value}`} aria-pressed={placement === value} disabled={moving}
                        aria-label={label} title={value === 'tab' ? `${label}\n${conversationWindowText(locale, 'inTabHint')}` : label}
                        onClick={() => { if (placement !== value) move(value); }}>
                        {glyph(value === 'tab' ? 'in-tab' : 'on-desktop', 17)}
                    </button>;
                })}
            </div>}
            {/* Windows keeps the window on the desktop: clicking "tab only" explains why, and "also on desktop" brings the window to the front. */}
            {streamKey && controls && !controls.canPark && <div className='nmx-visual-tab-place' role='group' aria-label={conversationWindowText(locale, 'placement')}>
                <button type='button' className='nmx-visual-tab-place-btn is-tab' aria-pressed='false' aria-disabled='true'
                    aria-label={conversationWindowText(locale, 'onlyInTab')} title={conversationWindowText(locale, PARK_REASON_TEXT[parkReason || ''] || 'parkForeground')}
                    onClick={() => setNotice(PARK_REASON_TEXT[parkReason || ''] || 'parkForeground')}>
                    {glyph('in-tab', 17)}
                </button>
                <button type='button' className='nmx-visual-tab-place-btn is-desktop' aria-pressed='true' disabled={moving}
                    aria-label={conversationWindowText(locale, 'alsoOnDesktop')} title={`${conversationWindowText(locale, 'alsoOnDesktop')} · ${conversationWindowText(locale, 'switchToWindow')}`}
                    onClick={() => move('desktop')}>
                    {glyph('on-desktop', 17)}
                </button>
            </div>}
            {props.plugin?.headerControls}
            {props.plugin?.headerExtra}
        </header>
        {props.plugin?.bar}
        {realtimeShown && typeof RealtimeLaunchPrompt === 'function' && <RealtimeLaunchPrompt locale={locale} app={appDisplayName}
            relaunchable={realtimeFacts?.realtimeRelaunchAvailable === true && Boolean(props.onReopenApp)} keyboardCapture={mouse} busy={reopening}
            onReopen={() => { answerRealtime(); reopenApp('restart'); }}
            onShowOnDesktop={() => { answerRealtime('desktop'); move('desktop'); }}
            onDismiss={() => { if (typeof dismissRealtimePrompt === 'function') dismissRealtimePrompt(realtimeApp); answerRealtime(); }} />}
        <div className='nmx-visual-tab-screen' ref={screen}>
            <video ref={video} muted playsInline aria-label={tab.title} aria-hidden={!live} className={live ? 'is-ready' : undefined} data-window-key={streamKey || undefined}
                style={pictureStyle} onMouseDown={onMouseDown} onClick={onClick} onAuxClick={onAuxClick} onContextMenu={onContextMenu}
                onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel} onPointerLeave={resetHoverMove} onWheel={onWheel}></video>
            {/* The snapshot bridge's picture, over the video in the same box; pointer input still goes to the video. */}
            <canvas className='nmx-visual-tab-bridge' aria-hidden='true' hidden style={pictureStyle}></canvas>
            {!live && (tab.frameUrl
                ? <img src={tab.frameUrl} alt={tab.title} draggable={false} />
                : <div className='nmx-visual-tab-empty'>
                    <i className={`codicon codicon-${tab.status === 'connecting' ? 'loading codicon-modifier-spin' : 'device-desktop'}`} aria-hidden='true'></i>
                    {/* An app window's tab waits for its own picture; the desktop wording is for remote/VM desktops. */}
                    <strong>{tab.windowRef ? conversationWindowText(locale, 'waiting') : conversationTabsText(locale, 'desktopEmpty')}</strong>
                    {!tab.windowRef && <p>{conversationTabsText(locale, 'desktopHint')}</p>}
                </div>)}
            {live && mouse && controls?.keys && <textarea ref={keyboard} className='nmx-visual-tab-keys' aria-label={conversationWindowText(locale, 'mouse')} tabIndex={-1}
                autoCapitalize='off' autoCorrect='off' spellCheck={false} onKeyDownCapture={onKeyboardDown} onKeyDown={onKeyboardDown} onInput={onKeyboardInput} onCompositionEnd={onKeyboardCompositionEnd}></textarea>}
            {live && !realtimeShown && (pluginEscActive || (!mouse && placement === 'tab')) && <p className='nmx-visual-tab-note'><i className='codicon codicon-eye-closed' aria-hidden='true'></i>{conversationWindowText(locale, pluginEscActive ? 'controlHint' : 'inTabHint')}</p>}
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
            {props.plugin?.floatingChat && <FloatingPluginChatOverlay containerSize={screenSize} dock={chatDock}>{props.plugin.floatingChat}</FloatingPluginChatOverlay>}
            {/* Closed, the AI Console waits as a launcher on an edge of the picture (never in the header). */}
            {!props.plugin?.floatingChat && !props.plugin?.chatOpen && props.plugin?.onToggleChat && !props.plugin.studio && screenSize
                && typeof PluginChatDockLauncher === 'function' && <PluginChatDockLauncher containerSize={screenSize} dock={chatDock}
                    label={props.plugin.chatLabel || 'AI Console'} streaming={props.plugin.chatStreaming} onDock={dockChat} onOpen={props.plugin.onToggleChat} />}
        </div>
        {reopenModalOpen && <div className='nmx-visual-tab-terminate-modal-backdrop' role='presentation'
            onClick={() => { if (!reopenBusy.current) setReopenModalOpen(false); }}>
            <div className='nmx-visual-tab-terminate-modal' role='dialog' aria-modal='true' tabIndex={-1} ref={reopenDialog}
                aria-labelledby={`${dialogIds}-reopen-title`} aria-describedby={`${dialogIds}-reopen-body`}
                onClick={event => event.stopPropagation()}>
                <div className='nmx-visual-tab-terminate-modal-head'>
                    <span className='nmx-visual-tab-terminate-icon' aria-hidden='true'><i className='codicon codicon-warning'></i></span>
                    <div className='nmx-visual-tab-terminate-copy'>
                        <strong id={`${dialogIds}-reopen-title`}>{conversationWindowText(locale, 'reopenRunningTitle')}</strong>
                        <p id={`${dialogIds}-reopen-body`}>{conversationWindowText(locale, 'reopenRunningBody', { app: appDisplayName })}</p>
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
                aria-labelledby={`${dialogIds}-terminate-title`}
                onClick={event => event.stopPropagation()}>
                <div className='nmx-visual-tab-terminate-modal-head'>
                    <span className='nmx-visual-tab-terminate-icon' aria-hidden='true'>
                        <i className='codicon codicon-warning' aria-hidden='true'></i>
                    </span>
                    <div className='nmx-visual-tab-terminate-copy'>
                        <strong id={`${dialogIds}-terminate-title`}>
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
        {/* The header's icon controls (the plans clock has its own drawer) and the console launcher explain themselves on hover. */}
        {/* Document-wide, like every SurfaceTooltips: only the tab on show has one, or each tab kept warm would add its own bubble. */}
        {tabActive && typeof SurfaceTooltips === 'function' && <SurfaceTooltips scope='.nmx-visual-tab-bar > :not(.nmx-visual-tab-schedule), .nmx-plugin-chat-dock-icon' />}
    </section>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function conversationTabsText(locale: Parameters<typeof uncheckedConversationTabsText>[0], key: Parameters<typeof uncheckedConversationTabsText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedConversationTabsText>>): string {
    return totalCopy(locale, key, language => uncheckedConversationTabsText(language, key, ...rest));
}
export function conversationWindowText(locale: Parameters<typeof uncheckedConversationWindowText>[0], key: Parameters<typeof uncheckedConversationWindowText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedConversationWindowText>>): string {
    return totalCopy(locale, key, language => uncheckedConversationWindowText(language, key, ...rest));
}
