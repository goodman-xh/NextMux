import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * 应用操控: the user picks up to five apps under the composer, from a searchable list inside the app. Each picked app
 * opens in a tab of the conversation at once; its icon sits at the top left of the input, and the next message starts
 * with one marker line per app that the agent reads as "use these apps" (nextmuxTabInstructions). Tabs stay one app each.
 */
export interface ComposerApp {
    /** The name the user sees (计算器, 微信). */
    readonly name: string;
    /** Bundle id on macOS (com.apple.calculator), program name on Windows (WeChat): what tabs.open_app matches exactly. */
    readonly id: string;
    /** data: URL of the app's icon, empty when the system gave none. */
    readonly icon: string;
}

/** How many apps one message can carry: its marker lines, the composer's chips and the picker's limit. */
export const MAX_COMPOSER_APPS = 5;

/** A row of the in-app picker: an installed app, and whether it has a window open right now. */
export interface AppControlPickerApp extends ComposerApp {
    readonly running?: boolean;
}

export type AppControlTextKey = 'placeholder' | 'placeholderMany' | 'button' | 'pickTitle' | 'remove' | 'unavailable' | 'selected' | 'needsFullAccess' | 'switchFullAccess'
    | 'closeTitle' | 'closeBody' | 'closeQuit' | 'closeDesktop'
    | 'searchPlaceholder' | 'browseOther' | 'selectedCount' | 'limitReached' | 'loadingApps' | 'emptyApps' | 'runningBadge' | 'close'
    | 'opening' | 'alreadyInTab' | 'alreadyOpenInOs' | 'openFailed'
    | 'windowNotReady' | 'noOpenWindow' | 'ambiguous' | 'notFound' | 'ownedElsewhere' | 'tabsElsewhere'
    | 'componentsMissing' | 'systemTooOld' | 'systemUnsupported' | 'permissionNeeded' | 'listFailed' | 'retry' | 'describeFailed';

const appControlCatalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<AppControlTextKey, string>>>> = {
    'zh-CN': { placeholder: '输入要在「{name}」里完成的操作', button: '应用操控', pickTitle: '选择要操控的应用', remove: '移除应用', unavailable: '这个版本不能选择应用', selected: '这条消息使用的应用', needsFullAccess: '操控应用需要“完全访问”', switchFullAccess: '改为完全访问',
        closeTitle: '关闭标签或退出 NextMux 时', closeBody: '只影响 NextMux 为标签打开的应用；你原本就开着的应用总是放回桌面。应用会正常退出，有未保存的内容会先问你。', closeQuit: '退出标签里的应用', closeDesktop: '把应用放回桌面',
        placeholderMany: '输入要在这 {count} 个应用里完成的操作', searchPlaceholder: '搜索应用...', browseOther: '浏览其他应用…', selectedCount: '已选 {count}/{max}', limitReached: '最多同时选择 {max} 个应用', loadingApps: '正在加载应用列表…', emptyApps: '未找到匹配的应用', runningBadge: '运行中', close: '关闭',
        opening: '正在打开…', alreadyInTab: '该应用已经打开在标签内了', alreadyOpenInOs: '该应用已在电脑中打开，请先关闭再做选择', openFailed: '无法在标签中打开「{name}」',
        windowNotReady: '「{name}」已启动，但窗口还没出现，请稍后再选一次', noOpenWindow: '「{name}」正在运行，但没有打开的窗口。请先在它里面打开一个窗口，再选一次', ambiguous: '找到多个「{name}」，请用“浏览其他应用…”选择具体的一个',
        notFound: '在这台电脑上找不到「{name}」', ownedElsewhere: '「{name}」的窗口已在另一个对话的标签中', tabsElsewhere: '这个对话的标签在另一个 NextMux 窗口里打开',
        componentsMissing: '这份 NextMux 缺少应用操控组件，请重新安装 NextMux', systemTooOld: '应用操控需要 macOS 13 或更高版本', systemUnsupported: '这台电脑的系统不支持应用操控',
        permissionNeeded: '需要在系统设置中允许 NextMux 使用「{items}」', listFailed: '应用列表加载失败', retry: '重试', describeFailed: '无法读取这个应用' },
    'zh-TW': { placeholder: '輸入要在「{name}」裡完成的操作', button: '應用操控', pickTitle: '選擇要操控的 App', remove: '移除 App', unavailable: '這個版本不能選擇 App', selected: '這則訊息使用的 App', needsFullAccess: '操控 App 需要「完整存取」', switchFullAccess: '改為完整存取',
        closeTitle: '關閉分頁或結束 NextMux 時', closeBody: '只影響 NextMux 為分頁開啟的 App；你原本就開著的 App 一律放回桌面。App 會正常結束，有未儲存的內容會先問你。', closeQuit: '結束分頁裡的 App', closeDesktop: '把 App 放回桌面',
        placeholderMany: '輸入要在這 {count} 個 App 裡完成的操作', searchPlaceholder: '搜尋 App...', browseOther: '瀏覽其他 App…', selectedCount: '已選 {count}/{max}', limitReached: '最多同時選擇 {max} 個 App', loadingApps: '正在載入 App 列表…', emptyApps: '找不到符合的 App', runningBadge: '執行中', close: '關閉',
        opening: '正在開啟…', alreadyInTab: '這個 App 已經在分頁中開啟了', alreadyOpenInOs: '這個 App 已在電腦上開啟，請先關閉再選擇', openFailed: '無法在分頁中開啟「{name}」',
        windowNotReady: '「{name}」已啟動，但視窗還沒出現，請稍後再選一次', noOpenWindow: '「{name}」正在執行，但沒有開啟的視窗。請先在它裡面開啟一個視窗，再選一次', ambiguous: '找到多個「{name}」，請用「瀏覽其他 App…」選擇確切的一個',
        notFound: '在這台電腦上找不到「{name}」', ownedElsewhere: '「{name}」的視窗已在另一個對話的分頁中', tabsElsewhere: '這個對話的分頁在另一個 NextMux 視窗中開啟',
        componentsMissing: '這份 NextMux 缺少 App 操控元件，請重新安裝 NextMux', systemTooOld: 'App 操控需要 macOS 13 或更新版本', systemUnsupported: '這台電腦的系統不支援 App 操控',
        permissionNeeded: '需要在系統設定中允許 NextMux 使用「{items}」', listFailed: 'App 列表載入失敗', retry: '重試', describeFailed: '無法讀取這個 App' },
    en: { placeholder: 'Describe what to do in {name}', button: 'App control', pickTitle: 'Choose an app to control', remove: 'Remove app', unavailable: 'This version can’t pick apps', selected: 'App for this message', needsFullAccess: 'Controlling apps needs Full access', switchFullAccess: 'Switch to Full access',
        closeTitle: 'When a tab closes or NextMux quits', closeBody: 'Applies only to apps NextMux opened for a tab; apps you already had open always go back to your desktop. Apps quit the normal way and ask first if something is unsaved.', closeQuit: 'Quit the apps in tabs', closeDesktop: 'Put the apps back on the desktop',
        placeholderMany: 'Describe what to do in these {count} apps', searchPlaceholder: 'Search applications...', browseOther: 'Browse other apps…', selectedCount: '{count}/{max} selected', limitReached: 'You can select up to {max} apps at a time.', loadingApps: 'Loading applications…', emptyApps: 'No matching applications', runningBadge: 'Running', close: 'Close',
        opening: 'Opening…', alreadyInTab: 'This app is already open in a tab.', alreadyOpenInOs: 'This app is already open on your computer. Please close it first before selecting.', openFailed: 'Couldn’t open {name} in a tab',
        windowNotReady: '{name} started, but its window hasn’t appeared yet. Try again in a moment.', noOpenWindow: '{name} is running but has no open window. Open one of its windows, then try again.', ambiguous: 'More than one {name} is installed. Choose the exact one with “Browse other apps…”.',
        notFound: 'Couldn’t find {name} on this computer.', ownedElsewhere: '{name}’s window is already in another conversation’s tab.', tabsElsewhere: 'This conversation’s tabs are open in another NextMux window.',
        componentsMissing: 'This copy of NextMux is missing its app control components. Reinstall NextMux to fix it.', systemTooOld: 'App control needs macOS 13 or later.', systemUnsupported: 'App control isn’t supported on this system.',
        permissionNeeded: 'Allow NextMux to use {items} in System Settings.', listFailed: 'Couldn’t load your apps', retry: 'Try again', describeFailed: 'Couldn’t read this app' },
    ja: { placeholder: '「{name}」で行う操作を入力', button: 'アプリ操作', pickTitle: '操作するアプリを選択', remove: 'アプリを外す', unavailable: 'このバージョンではアプリを選べません', selected: 'このメッセージで使うアプリ', needsFullAccess: 'アプリの操作には「フルアクセス」が必要です', switchFullAccess: 'フルアクセスにする',
        closeTitle: 'タブを閉じたとき・NextMux を終了したとき', closeBody: 'NextMux がタブ用に開いたアプリだけが対象です。もともと開いていたアプリは常にデスクトップに戻ります。アプリは通常どおり終了し、未保存の内容があれば先に確認します。', closeQuit: 'タブのアプリを終了', closeDesktop: 'アプリをデスクトップに戻す',
        placeholderMany: 'この {count} 個のアプリで行う操作を入力', searchPlaceholder: 'アプリを検索...', browseOther: 'ほかのアプリを選ぶ…', selectedCount: '{count}/{max} 個を選択中', limitReached: '同時に選べるアプリは {max} 個までです', loadingApps: 'アプリを読み込み中…', emptyApps: '一致するアプリがありません', runningBadge: '実行中', close: '閉じる',
        opening: '開いています…', alreadyInTab: 'このアプリはすでにタブで開いています', alreadyOpenInOs: 'このアプリはすでにパソコンで開いています。いったん閉じてから選び直してください', openFailed: '「{name}」をタブで開けませんでした',
        windowNotReady: '「{name}」は起動しましたが、ウィンドウがまだ表示されていません。少し待ってからもう一度選んでください', noOpenWindow: '「{name}」は実行中ですが、開いているウィンドウがありません。ウィンドウを 1 つ開いてから、もう一度選んでください', ambiguous: '「{name}」が複数見つかりました。「ほかのアプリを選ぶ…」で使うものを選んでください',
        notFound: 'このパソコンに「{name}」が見つかりません', ownedElsewhere: '「{name}」のウィンドウは別の会話のタブで使われています', tabsElsewhere: 'この会話のタブは別の NextMux ウィンドウで開いています',
        componentsMissing: 'この NextMux にはアプリ操作のコンポーネントがありません。NextMux を再インストールしてください', systemTooOld: 'アプリ操作には macOS 13 以降が必要です', systemUnsupported: 'このシステムではアプリ操作を利用できません',
        permissionNeeded: 'システム設定で NextMux に「{items}」を許可してください', listFailed: 'アプリの一覧を読み込めませんでした', retry: '再試行', describeFailed: 'このアプリを読み込めませんでした' },
    ko: { placeholder: '{name}에서 할 작업을 입력하세요', button: '앱 제어', pickTitle: '제어할 앱 선택', remove: '앱 제거', unavailable: '이 버전에서는 앱을 선택할 수 없습니다', selected: '이 메시지에 사용할 앱', needsFullAccess: '앱을 제어하려면 ‘전체 액세스’가 필요합니다', switchFullAccess: '전체 액세스로 전환',
        closeTitle: '탭을 닫거나 NextMux를 종료할 때', closeBody: 'NextMux가 탭용으로 연 앱에만 적용됩니다. 원래 열려 있던 앱은 항상 데스크톱으로 돌아갑니다. 앱은 정상적으로 종료되며 저장하지 않은 내용이 있으면 먼저 묻습니다.', closeQuit: '탭의 앱 종료', closeDesktop: '앱을 데스크톱으로 되돌리기',
        placeholderMany: '이 앱 {count}개에서 할 작업을 입력하세요', searchPlaceholder: '앱 검색...', browseOther: '다른 앱 찾아보기…', selectedCount: '{count}/{max}개 선택됨', limitReached: '앱은 한 번에 {max}개까지 선택할 수 있습니다', loadingApps: '앱 목록을 불러오는 중…', emptyApps: '일치하는 앱이 없습니다', runningBadge: '실행 중', close: '닫기',
        opening: '여는 중…', alreadyInTab: '이 앱은 이미 탭에 열려 있습니다', alreadyOpenInOs: '이 앱은 이미 컴퓨터에서 열려 있습니다. 먼저 닫은 뒤 다시 선택하세요', openFailed: '{name} 앱을 탭에서 열 수 없습니다',
        windowNotReady: '{name} 앱이 실행되었지만 아직 창이 나타나지 않았습니다. 잠시 후 다시 선택하세요', noOpenWindow: '{name} 앱이 실행 중이지만 열린 창이 없습니다. 창을 하나 연 다음 다시 선택하세요', ambiguous: '{name} 앱이 여러 개 있습니다. ‘다른 앱 찾아보기…’에서 정확한 앱을 선택하세요',
        notFound: '이 컴퓨터에서 {name} 앱을 찾을 수 없습니다', ownedElsewhere: '{name} 앱의 창은 이미 다른 대화의 탭에 있습니다', tabsElsewhere: '이 대화의 탭은 다른 NextMux 창에서 열려 있습니다',
        componentsMissing: '이 NextMux에는 앱 제어 구성 요소가 없습니다. NextMux를 다시 설치하세요', systemTooOld: '앱 제어에는 macOS 13 이상이 필요합니다', systemUnsupported: '이 시스템에서는 앱 제어를 사용할 수 없습니다',
        permissionNeeded: '시스템 설정에서 NextMux에 「{items}」 권한을 허용하세요', listFailed: '앱 목록을 불러오지 못했습니다', retry: '다시 시도', describeFailed: '이 앱을 읽을 수 없습니다' },
    es: { placeholder: 'Describe qué hacer en {name}', button: 'Control de apps', pickTitle: 'Elige la app que quieres controlar', remove: 'Quitar app', unavailable: 'Esta versión no permite elegir apps', selected: 'App para este mensaje', needsFullAccess: 'Para controlar apps hace falta Acceso completo', switchFullAccess: 'Cambiar a Acceso completo',
        closeTitle: 'Al cerrar una pestaña o salir de NextMux', closeBody: 'Solo afecta a las apps que NextMux abrió para una pestaña; las que ya tenías abiertas siempre vuelven al escritorio. Las apps se cierran de forma normal y preguntan antes si hay algo sin guardar.', closeQuit: 'Cerrar las apps de las pestañas', closeDesktop: 'Devolver las apps al escritorio',
        placeholderMany: 'Describe qué hacer en estas {count} apps', searchPlaceholder: 'Buscar aplicaciones...', browseOther: 'Buscar otras apps…', selectedCount: '{count}/{max} seleccionadas', limitReached: 'Puedes seleccionar hasta {max} apps a la vez.', loadingApps: 'Cargando aplicaciones…', emptyApps: 'No hay aplicaciones que coincidan', runningBadge: 'En ejecución', close: 'Cerrar',
        opening: 'Abriendo…', alreadyInTab: 'Esta app ya está abierta en una pestaña.', alreadyOpenInOs: 'Esta app ya está abierta en tu ordenador. Ciérrala antes de seleccionarla.', openFailed: 'No se pudo abrir {name} en una pestaña',
        windowNotReady: '{name} se abrió, pero su ventana aún no aparece. Vuelve a intentarlo en un momento.', noOpenWindow: '{name} está abierta, pero no tiene ninguna ventana. Abre una de sus ventanas y vuelve a intentarlo.', ambiguous: 'Hay más de una app {name}. Elige la correcta con «Buscar otras apps…».',
        notFound: 'No se encontró {name} en este ordenador.', ownedElsewhere: 'La ventana de {name} ya está en una pestaña de otra conversación.', tabsElsewhere: 'Las pestañas de esta conversación están abiertas en otra ventana de NextMux.',
        componentsMissing: 'A esta copia de NextMux le faltan los componentes de control de apps. Reinstala NextMux para solucionarlo.', systemTooOld: 'El control de apps requiere macOS 13 o posterior.', systemUnsupported: 'El control de apps no es compatible con este sistema.',
        permissionNeeded: 'Permite a NextMux usar {items} en Ajustes del Sistema.', listFailed: 'No se pudieron cargar tus apps', retry: 'Reintentar', describeFailed: 'No se pudo leer esta app' },
    fr: { placeholder: 'Décrivez ce qu’il faut faire dans {name}', button: 'Contrôle d’app', pickTitle: 'Choisir l’app à contrôler', remove: 'Retirer l’app', unavailable: 'Cette version ne permet pas de choisir une app', selected: 'App pour ce message', needsFullAccess: 'Le contrôle des apps nécessite l’Accès complet', switchFullAccess: 'Passer en Accès complet',
        closeTitle: 'À la fermeture d’un onglet ou de NextMux', closeBody: 'Concerne seulement les apps que NextMux a ouvertes pour un onglet ; celles que vous aviez déjà ouvertes reviennent toujours sur le bureau. Les apps quittent normalement et demandent d’abord s’il reste des modifications.', closeQuit: 'Quitter les apps des onglets', closeDesktop: 'Remettre les apps sur le bureau',
        placeholderMany: 'Décrivez ce qu’il faut faire dans ces {count} apps', searchPlaceholder: 'Rechercher des applications...', browseOther: 'Parcourir d’autres apps…', selectedCount: '{count}/{max} sélectionnées', limitReached: 'Vous pouvez sélectionner jusqu’à {max} apps à la fois.', loadingApps: 'Chargement des applications…', emptyApps: 'Aucune application correspondante', runningBadge: 'En cours', close: 'Fermer',
        opening: 'Ouverture…', alreadyInTab: 'Cette app est déjà ouverte dans un onglet.', alreadyOpenInOs: 'Cette app est déjà ouverte sur votre ordinateur. Fermez-la avant de la sélectionner.', openFailed: 'Impossible d’ouvrir {name} dans un onglet',
        windowNotReady: '{name} a démarré, mais sa fenêtre n’est pas encore apparue. Réessayez dans un instant.', noOpenWindow: '{name} est ouvert mais n’a aucune fenêtre. Ouvrez-en une, puis réessayez.', ambiguous: 'Plusieurs apps {name} sont installées. Choisissez la bonne avec « Parcourir d’autres apps… ».',
        notFound: '{name} est introuvable sur cet ordinateur.', ownedElsewhere: 'La fenêtre de {name} est déjà dans l’onglet d’une autre conversation.', tabsElsewhere: 'Les onglets de cette conversation sont ouverts dans une autre fenêtre NextMux.',
        componentsMissing: 'Il manque à cette copie de NextMux ses composants de contrôle d’app. Réinstallez NextMux pour corriger cela.', systemTooOld: 'Le contrôle d’app nécessite macOS 13 ou une version ultérieure.', systemUnsupported: 'Le contrôle d’app n’est pas pris en charge sur ce système.',
        permissionNeeded: 'Autorisez NextMux à utiliser {items} dans les Réglages Système.', listFailed: 'Impossible de charger vos apps', retry: 'Réessayer', describeFailed: 'Impossible de lire cette app' },
    de: { placeholder: 'Beschreiben Sie, was in {name} passieren soll', button: 'App-Steuerung', pickTitle: 'App zum Steuern auswählen', remove: 'App entfernen', unavailable: 'Diese Version kann keine Apps auswählen', selected: 'App für diese Nachricht', needsFullAccess: 'Zum Steuern von Apps ist Vollzugriff nötig', switchFullAccess: 'Zu Vollzugriff wechseln',
        closeTitle: 'Beim Schließen eines Tabs oder Beenden von NextMux', closeBody: 'Gilt nur für Apps, die NextMux für einen Tab geöffnet hat; bereits geöffnete Apps kommen immer zurück auf den Schreibtisch. Apps werden normal beendet und fragen vorher nach, wenn etwas nicht gesichert ist.', closeQuit: 'Apps in Tabs beenden', closeDesktop: 'Apps zurück auf den Schreibtisch',
        placeholderMany: 'Beschreiben Sie, was in diesen {count} Apps passieren soll', searchPlaceholder: 'Apps suchen...', browseOther: 'Andere Apps durchsuchen…', selectedCount: '{count}/{max} ausgewählt', limitReached: 'Es können höchstens {max} Apps gleichzeitig ausgewählt werden.', loadingApps: 'Apps werden geladen…', emptyApps: 'Keine passenden Apps', runningBadge: 'Läuft', close: 'Schließen',
        opening: 'Wird geöffnet…', alreadyInTab: 'Diese App ist bereits in einem Tab geöffnet.', alreadyOpenInOs: 'Diese App ist auf Ihrem Computer bereits geöffnet. Schließen Sie sie, bevor Sie sie auswählen.', openFailed: '{name} konnte nicht in einem Tab geöffnet werden',
        windowNotReady: '{name} wurde gestartet, aber das Fenster ist noch nicht erschienen. Versuchen Sie es gleich noch einmal.', noOpenWindow: '{name} läuft, hat aber kein offenes Fenster. Öffnen Sie dort ein Fenster und versuchen Sie es noch einmal.', ambiguous: '{name} ist mehrfach installiert. Wählen Sie das richtige über „Andere Apps durchsuchen…“ aus.',
        notFound: '{name} wurde auf diesem Computer nicht gefunden.', ownedElsewhere: 'Das Fenster von {name} ist bereits im Tab einer anderen Unterhaltung.', tabsElsewhere: 'Die Tabs dieser Unterhaltung sind in einem anderen NextMux-Fenster geöffnet.',
        componentsMissing: 'Dieser NextMux-Installation fehlen die Komponenten für die App-Steuerung. Installieren Sie NextMux neu, um das zu beheben.', systemTooOld: 'Die App-Steuerung erfordert macOS 13 oder neuer.', systemUnsupported: 'Die App-Steuerung wird auf diesem System nicht unterstützt.',
        permissionNeeded: 'Erlauben Sie NextMux {items} in den Systemeinstellungen.', listFailed: 'Apps konnten nicht geladen werden', retry: 'Erneut versuchen', describeFailed: 'Diese App konnte nicht gelesen werden' },
    'pt-BR': { placeholder: 'Descreva o que fazer em {name}', button: 'Controle de apps', pickTitle: 'Escolha o app para controlar', remove: 'Remover app', unavailable: 'Esta versão não permite escolher apps', selected: 'App desta mensagem', needsFullAccess: 'Controlar apps exige Acesso total', switchFullAccess: 'Mudar para Acesso total',
        closeTitle: 'Ao fechar uma aba ou sair do NextMux', closeBody: 'Vale só para apps que o NextMux abriu para uma aba; apps que você já tinha abertos sempre voltam para a mesa. Os apps fecham normalmente e perguntam antes se algo não foi salvo.', closeQuit: 'Fechar os apps das abas', closeDesktop: 'Devolver os apps para a mesa',
        placeholderMany: 'Descreva o que fazer nestes {count} apps', searchPlaceholder: 'Buscar aplicativos...', browseOther: 'Procurar outros apps…', selectedCount: '{count}/{max} selecionados', limitReached: 'Você pode selecionar até {max} apps por vez.', loadingApps: 'Carregando aplicativos…', emptyApps: 'Nenhum aplicativo encontrado', runningBadge: 'Em execução', close: 'Fechar',
        opening: 'Abrindo…', alreadyInTab: 'Este app já está aberto em uma aba.', alreadyOpenInOs: 'Este app já está aberto no seu computador. Feche-o antes de selecionar.', openFailed: 'Não foi possível abrir {name} em uma aba',
        windowNotReady: 'O {name} foi aberto, mas a janela ainda não apareceu. Tente de novo em instantes.', noOpenWindow: 'O {name} está aberto, mas sem nenhuma janela. Abra uma janela dele e tente de novo.', ambiguous: 'Há mais de um {name} instalado. Escolha o certo em “Procurar outros apps…”.',
        notFound: 'O {name} não foi encontrado neste computador.', ownedElsewhere: 'A janela do {name} já está na aba de outra conversa.', tabsElsewhere: 'As abas desta conversa estão abertas em outra janela do NextMux.',
        componentsMissing: 'Esta cópia do NextMux está sem os componentes de controle de apps. Reinstale o NextMux para corrigir.', systemTooOld: 'O controle de apps requer o macOS 13 ou posterior.', systemUnsupported: 'O controle de apps não é compatível com este sistema.',
        permissionNeeded: 'Permita que o NextMux use {items} nos Ajustes do Sistema.', listFailed: 'Não foi possível carregar seus apps', retry: 'Tentar de novo', describeFailed: 'Não foi possível ler este app' },
    ru: { placeholder: 'Опишите, что сделать в приложении «{name}»', button: 'Управление приложением', pickTitle: 'Выберите приложение для управления', remove: 'Убрать приложение', unavailable: 'В этой версии нельзя выбрать приложение', selected: 'Приложение для этого сообщения', needsFullAccess: 'Для управления приложениями нужен полный доступ', switchFullAccess: 'Включить полный доступ',
        closeTitle: 'При закрытии вкладки или выходе из NextMux', closeBody: 'Касается только приложений, которые NextMux открыл для вкладки; уже открытые вами приложения всегда возвращаются на рабочий стол. Приложения закрываются обычным образом и сначала спрашивают о несохранённых данных.', closeQuit: 'Закрывать приложения во вкладках', closeDesktop: 'Возвращать приложения на рабочий стол',
        placeholderMany: 'Опишите, что сделать в этих приложениях ({count})', searchPlaceholder: 'Поиск приложений...', browseOther: 'Выбрать другое приложение…', selectedCount: 'Выбрано {count}/{max}', limitReached: 'Одновременно можно выбрать не больше {max} приложений.', loadingApps: 'Загрузка списка приложений…', emptyApps: 'Подходящих приложений нет', runningBadge: 'Запущено', close: 'Закрыть',
        opening: 'Открывается…', alreadyInTab: 'Это приложение уже открыто во вкладке.', alreadyOpenInOs: 'Это приложение уже открыто на компьютере. Закройте его, прежде чем выбирать.', openFailed: 'Не удалось открыть «{name}» во вкладке',
        windowNotReady: '«{name}» запущено, но его окно ещё не появилось. Попробуйте ещё раз чуть позже.', noOpenWindow: '«{name}» запущено, но у него нет открытых окон. Откройте одно из его окон и попробуйте снова.', ambiguous: 'Найдено несколько приложений «{name}». Выберите нужное через «Выбрать другое приложение…».',
        notFound: '«{name}» не найдено на этом компьютере.', ownedElsewhere: 'Окно «{name}» уже открыто во вкладке другой беседы.', tabsElsewhere: 'Вкладки этой беседы открыты в другом окне NextMux.',
        componentsMissing: 'В этой копии NextMux нет компонентов управления приложениями. Переустановите NextMux.', systemTooOld: 'Для управления приложениями нужна macOS 13 или новее.', systemUnsupported: 'Управление приложениями не поддерживается в этой системе.',
        permissionNeeded: 'Разрешите NextMux «{items}» в Системных настройках.', listFailed: 'Не удалось загрузить список приложений', retry: 'Повторить', describeFailed: 'Не удалось прочитать это приложение' },
    ar: { placeholder: 'صِف ما تريد فعله في {name}', button: 'التحكم بالتطبيق', pickTitle: 'اختر التطبيق الذي تريد التحكم به', remove: 'إزالة التطبيق', unavailable: 'لا يمكن اختيار التطبيقات في هذا الإصدار', selected: 'التطبيق لهذه الرسالة', needsFullAccess: 'يتطلب التحكم بالتطبيقات الوصول الكامل', switchFullAccess: 'التبديل إلى الوصول الكامل',
        closeTitle: 'عند إغلاق علامة تبويب أو إنهاء NextMux', closeBody: 'يسري فقط على التطبيقات التي فتحها NextMux لعلامة تبويب؛ أما التطبيقات التي كانت مفتوحة لديك فتعود دائمًا إلى سطح المكتب. تُغلق التطبيقات بشكل عادي وتسأل أولًا إن كان هناك ما لم يُحفظ.', closeQuit: 'إنهاء التطبيقات في علامات التبويب', closeDesktop: 'إعادة التطبيقات إلى سطح المكتب',
        placeholderMany: 'صِف ما تريد فعله في هذه التطبيقات ({count})', searchPlaceholder: 'ابحث عن التطبيقات...', browseOther: 'تصفّح تطبيقات أخرى…', selectedCount: 'تم تحديد {count}/{max}', limitReached: 'يمكنك تحديد {max} تطبيقات كحد أقصى في المرة الواحدة.', loadingApps: 'جارٍ تحميل التطبيقات…', emptyApps: 'لا توجد تطبيقات مطابقة', runningBadge: 'قيد التشغيل', close: 'إغلاق',
        opening: 'جارٍ الفتح…', alreadyInTab: 'هذا التطبيق مفتوح بالفعل في علامة تبويب.', alreadyOpenInOs: 'هذا التطبيق مفتوح بالفعل على حاسوبك. أغلقه أولًا ثم اختره.', openFailed: 'تعذّر فتح {name} في علامة تبويب',
        windowNotReady: 'بدأ تشغيل {name} لكن نافذته لم تظهر بعد. حاول مرة أخرى بعد لحظات.', noOpenWindow: '\u200f{name} قيد التشغيل لكن لا توجد له نافذة مفتوحة. افتح إحدى نوافذه ثم حاول مرة أخرى.', ambiguous: 'يوجد أكثر من تطبيق باسم {name}. اختر التطبيق الصحيح من «تصفّح تطبيقات أخرى…».',
        notFound: 'تعذّر العثور على {name} على هذا الحاسوب.', ownedElsewhere: 'نافذة {name} موجودة بالفعل في علامة تبويب محادثة أخرى.', tabsElsewhere: 'علامات تبويب هذه المحادثة مفتوحة في نافذة NextMux أخرى.',
        componentsMissing: 'تفتقد هذه النسخة من NextMux مكوّنات التحكم بالتطبيقات. أعد تثبيت NextMux لإصلاح ذلك.', systemTooOld: 'يتطلب التحكم بالتطبيقات macOS 13 أو أحدث.', systemUnsupported: 'التحكم بالتطبيقات غير مدعوم على هذا النظام.',
        permissionNeeded: 'اسمح لـ NextMux باستخدام {items} في إعدادات النظام.', listFailed: 'تعذّر تحميل تطبيقاتك', retry: 'إعادة المحاولة', describeFailed: 'تعذّرت قراءة هذا التطبيق' },
    hi: { placeholder: '{name} में क्या करना है, बताएँ', button: 'ऐप नियंत्रण', pickTitle: 'नियंत्रित करने के लिए ऐप चुनें', remove: 'ऐप हटाएँ', unavailable: 'इस संस्करण में ऐप नहीं चुना जा सकता', selected: 'इस संदेश के लिए ऐप', needsFullAccess: 'ऐप नियंत्रित करने के लिए पूर्ण एक्सेस चाहिए', switchFullAccess: 'पूर्ण एक्सेस पर जाएँ',
        closeTitle: 'टैब बंद करने या NextMux से बाहर निकलने पर', closeBody: 'यह केवल उन ऐप पर लागू होता है जिन्हें NextMux ने टैब के लिए खोला; जो ऐप आपने पहले से खोले थे वे हमेशा डेस्कटॉप पर लौटते हैं। ऐप सामान्य रूप से बंद होते हैं और बिना सहेजे बदलाव होने पर पहले पूछते हैं।', closeQuit: 'टैब के ऐप बंद करें', closeDesktop: 'ऐप को डेस्कटॉप पर लौटाएँ',
        placeholderMany: 'इन {count} ऐप में क्या करना है, बताएँ', searchPlaceholder: 'ऐप खोजें...', browseOther: 'दूसरे ऐप ब्राउज़ करें…', selectedCount: '{count}/{max} चुने गए', limitReached: 'एक बार में अधिकतम {max} ऐप चुने जा सकते हैं।', loadingApps: 'ऐप लोड हो रहे हैं…', emptyApps: 'कोई मिलता-जुलता ऐप नहीं मिला', runningBadge: 'चल रहा है', close: 'बंद करें',
        opening: 'खुल रहा है…', alreadyInTab: 'यह ऐप पहले से एक टैब में खुला है।', alreadyOpenInOs: 'यह ऐप आपके कंप्यूटर पर पहले से खुला है। चुनने से पहले इसे बंद करें।', openFailed: '{name} को टैब में नहीं खोला जा सका',
        windowNotReady: '{name} शुरू हो गया है, पर उसकी विंडो अभी नहीं दिखी। थोड़ी देर बाद फिर कोशिश करें।', noOpenWindow: '{name} चल रहा है, पर उसकी कोई विंडो खुली नहीं है। उसकी कोई विंडो खोलें, फिर दोबारा कोशिश करें।', ambiguous: '{name} एक से ज़्यादा इंस्टॉल है। “दूसरे ऐप ब्राउज़ करें…” से सही वाला चुनें।',
        notFound: 'इस कंप्यूटर पर {name} नहीं मिला।', ownedElsewhere: '{name} की विंडो पहले से किसी दूसरी बातचीत के टैब में है।', tabsElsewhere: 'इस बातचीत के टैब NextMux की दूसरी विंडो में खुले हैं।',
        componentsMissing: 'NextMux की इस कॉपी में ऐप नियंत्रण के घटक नहीं हैं। ठीक करने के लिए NextMux फिर से इंस्टॉल करें।', systemTooOld: 'ऐप नियंत्रण के लिए macOS 13 या उसके बाद का संस्करण चाहिए।', systemUnsupported: 'इस सिस्टम पर ऐप नियंत्रण समर्थित नहीं है।',
        permissionNeeded: 'सिस्टम सेटिंग्स में NextMux को {items} की अनुमति दें।', listFailed: 'आपके ऐप लोड नहीं हो सके', retry: 'फिर से कोशिश करें', describeFailed: 'यह ऐप पढ़ा नहीं जा सका' }
};

function uncheckedAppControlText(locale: NextMuxDesktopLocale, key: AppControlTextKey, vars: Readonly<Record<string, string>> = {}): string {
    return (appControlCatalog[locale] || appControlCatalog.en)[key]
        .replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? (name === 'max' ? String(MAX_COMPOSER_APPS) : whole));
}

/** What an open-app result tells the copy (the failure fields of resultVersion 2, see styles.d.ts openAppInTab). */
export interface AppOpenOutcome {
    readonly ok?: boolean;
    readonly error?: string;
    readonly phase?: string;
    readonly launched?: boolean;
    readonly reopened?: boolean;
    readonly wasRunningInOs?: boolean;
    readonly missing?: readonly string[];
}

/** Notification titles keep 120 characters: a long app name gives way, never the advice after it. */
const NOTICE_TITLE_MAX = 120;
function titleNaming(locale: NextMuxDesktopLocale, key: AppControlTextKey, name: string, vars: Readonly<Record<string, string>> = {}): string {
    const title = appControlText(locale, key, { ...vars, name });
    if (title.length <= NOTICE_TITLE_MAX || !title.includes(name)) return title;
    const room = Math.max(12, NOTICE_TITLE_MAX - (title.length - name.length) - 1);
    return appControlText(locale, key, { ...vars, name: `${[...name].slice(0, room).join('').trimEnd()}…` });
}

/**
 * The notice for an app that could not open in a tab when the user picked it: which stage failed and what to do, in
 * the user's language. The first matching row wins; `alreadyOpenInOs` keeps the case it was written for (the user's own
 * running copy that a tab cannot take). Titles name the app; the body stays empty unless there is more to say (the app's
 * full name when the title had to shorten it, or names no app). Error codes are for the AI's tool result, never shown here.
 */
export function appOpenFailureCopy(locale: NextMuxDesktopLocale, outcome: AppOpenOutcome | undefined, name: string,
    options: { readonly mac: boolean; readonly permissionItems?: string }): { readonly kind: 'warning' | 'error'; readonly key: AppControlTextKey; readonly title: string; readonly body: string } {
    const error = outcome?.error || '';
    const row = (kind: 'warning' | 'error', key: AppControlTextKey, body = '') => {
        const vars: Readonly<Record<string, string>> = key === 'permissionNeeded' ? { items: options.permissionItems || '' } : {};
        const title = titleNaming(locale, key, name, vars);
        return { kind, key, title, body: body || (title === appControlText(locale, key, { ...vars, name }) ? '' : name) };
    };
    if (error === 'permission_required') return row('error', 'permissionNeeded');
    if (error === 'runtime_missing') return row('error', 'componentsMissing');
    if (error === 'unsupported_system') return row('error', options.mac ? 'systemTooOld' : 'systemUnsupported');
    if (error === 'computer_app_not_found' || error === 'app_not_found') return row('error', 'notFound');
    if (error === 'computer_app_ambiguous' || error === 'app_ambiguous') return row('warning', 'ambiguous');
    if (error === 'app_window_unavailable' && outcome?.launched === true) return row('warning', 'windowNotReady');
    if (error === 'app_window_unavailable' && (outcome?.reopened === true || outcome?.wasRunningInOs === true)) return row('warning', 'noOpenWindow');
    if (error === 'computer_window_owned') return row('warning', 'ownedElsewhere');
    if (error === 'app_already_open_in_os_uncontrollable') return row('warning', 'alreadyOpenInOs', name);
    if (error === 'live_view_unsupported' && outcome?.phase === 'permission') return row('warning', 'tabsElsewhere');
    if (error === 'cancelled' && outcome?.phase === 'window' && outcome.launched === true) return row('warning', 'windowNotReady');
    // Opened, but its window cannot live in a tab: the user's own running copy is the case alreadyOpenInOs explains.
    if (!error && outcome?.wasRunningInOs === true) return row('warning', 'alreadyOpenInOs', name);
    return row('error', 'openFailed');
}

/** The same outcome for the AI's tabs.open_app: one short sentence it can act on (English, like every tool result). */
export function appOpenFailureForModel(outcome: AppOpenOutcome | undefined, app: string): string {
    const error = outcome?.error || '';
    const missing = (outcome?.missing || []).map(kind => kind === 'screen' ? 'Screen Recording' : kind === 'accessibility' ? 'Accessibility' : '').filter(Boolean);
    if (error === 'permission_required') return `NextMux needs the ${missing.length ? missing.join(' and ') : 'Accessibility and Screen Recording'} permission in System Settings to open apps in tabs. Ask the user to allow it, then try again.`;
    if (error === 'runtime_missing') return 'This copy of NextMux is missing its app control components. Ask the user to reinstall NextMux.';
    if (error === 'unsupported_system') return 'App control is not supported on this computer (a Mac needs macOS 13 or later).';
    if (error === 'computer_app_not_found' || error === 'app_not_found') return `${app} was not found on this computer. Check the app's name, or ask the user which app they mean.`;
    if (error === 'computer_app_ambiguous' || error === 'app_ambiguous') return `More than one installed app matches ${app}. Ask the user which one they mean, or use its exact name or id.`;
    if (error === 'app_window_unavailable' && outcome?.launched === true
        || error === 'cancelled' && outcome?.phase === 'window' && outcome.launched === true) return `${app} started, but its window has not appeared yet. Wait a moment, then call tabs.open_app again.`;
    if (error === 'app_window_unavailable') return `${app} is running but shows no window. Ask the user to open its main window, then try again.`;
    if (error === 'app_already_open_in_os_uncontrollable') return `${app} is already open on the user's computer in a way a tab cannot take over. Ask the user to close it, then try again.`;
    if (error === 'live_view_unsupported' && outcome?.phase === 'permission') return 'This conversation\'s tabs are open in another NextMux window, so the app cannot be opened here.';
    return `Could not open ${app} in a tab (${error || 'failed'}). Check the app's name, or ask the user which app they mean.`;
}

const clean = (value: string, max: number): string => value.replace(/[\u0000-\u001f\u007f[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

type AppReference = Pick<ComposerApp, 'name' | 'id'> & { readonly icon?: string };

/** One marker line the agent reads (see nextmuxTabInstructions): `[App: 计算器 (com.apple.calculator)]`. */
export function appControlMarker(app: AppReference): string {
    const name = clean(app.name, 80) || clean(app.id, 80);
    const id = clean(app.id, 160);
    return id && id !== name ? `[App: ${name} (${id})]` : `[App: ${name}]`;
}

/** The apps one message can carry: each id once (ids differ by more than case), the first MAX_COMPOSER_APPS in the order picked. */
export function composerAppList<T extends AppReference>(appOrApps: T | readonly T[] | undefined): T[] {
    const picked = appOrApps === undefined ? [] : Array.isArray(appOrApps) ? appOrApps as readonly T[] : [appOrApps as T];
    const seen = new Set<string>(), apps: T[] = [];
    for (const app of picked) {
        const key = (clean(app?.id || '', 160) || clean(app?.name || '', 80)).toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        apps.push(app);
        if (apps.length >= MAX_COMPOSER_APPS) break;
    }
    return apps;
}

const MARKER_LINE = /^\[App:\s*([^[\]()\n]+?)(?:\s*\(([^[\]()\n]+)\))?\]\n?/;

/**
 * Splits a sent message back into the picked apps and the text the user typed, for showing the turn. `apps` holds every
 * marker line at the top (at most MAX_COMPOSER_APPS); `app` is the first of them, for code that knows one app.
 */
export function parseAppControlMarker(text: string): { readonly app?: { readonly name: string; readonly id: string };
    readonly apps?: readonly { readonly name: string; readonly id: string }[]; readonly text: string } {
    const apps: { readonly name: string; readonly id: string }[] = [];
    let rest = text;
    while (apps.length < MAX_COMPOSER_APPS) {
        const match = MARKER_LINE.exec(rest);
        if (!match) break;
        apps.push({ name: match[1].trim(), id: (match[2] || match[1]).trim() });
        rest = rest.slice(match[0].length);
    }
    return apps.length ? { app: apps[0], apps, text: rest } : { text };
}

/** The message as sent: one marker line per picked app, then what the user typed (the markers alone when they typed nothing). */
export function withAppControlMarker(appOrApps: AppReference | readonly AppReference[] | undefined, text: string): string {
    const markers = composerAppList(appOrApps).map(appControlMarker).join('\n');
    if (!markers) return text;
    return text ? `${markers}\n${text}` : markers;
}

/** The 应用操控 button: an app tile with a pointer on it (the tile is cut out around the pointer, so it reads at 16px). */
export function AppControlGlyph(props: { readonly size?: number }): React.ReactElement {
    const size = props.size || 16;
    const mask = `nmx-app-glyph-${React.useId().replace(/[^\w-]/g, '')}`;
    const pointer = 'M8.4 7.3v7.5l2-1.9 1.3 2.9 1.6-.7-1.3-2.9h2.8z';
    return <svg className='nmx-app-control-glyph' viewBox='0 0 16 16' width={size} height={size} aria-hidden='true'>
        <mask id={mask}><rect width='16' height='16' fill='#fff' /><path d={pointer} fill='#000' stroke='#000' strokeWidth='2.6' strokeLinejoin='round' /></mask>
        <g mask={`url(#${mask})`}>
            <rect x='1.65' y='1.65' width='11' height='11' rx='3.1' fill='none' stroke='currentColor' strokeWidth='1.3' />
            <rect x='4.3' y='4.3' width='2.3' height='2.3' rx='.7' fill='currentColor' />
            <rect x='7.7' y='4.3' width='2.3' height='2.3' rx='.7' fill='currentColor' opacity='.55' />
            <rect x='4.3' y='7.7' width='2.3' height='2.3' rx='.7' fill='currentColor' opacity='.55' />
        </g>
        <path d={pointer} fill='currentColor' stroke='currentColor' strokeWidth='.7' strokeLinejoin='round' />
    </svg>;
}

/** A system-style arrow pointer (dark with a light rim), laid over the bottom left of an app icon: "NextMux can drive this app". */
function PointerBadge(): React.ReactElement {
    return <svg className='nmx-app-control-pointer' viewBox='0 0 12 16' aria-hidden='true'>
        <path d='M1.5 1.2v11.6l3-2.9 1.9 4.4 2.2-.95-1.9-4.35h4.15z' fill='#111' stroke='#fff' strokeWidth='1.25' strokeLinejoin='round' />
    </svg>;
}

export function AppControlIcon(props: { readonly icon?: string; readonly size?: number; readonly pointer?: boolean;
    /** In a long list: decode the picture when its row comes near the view. */
    readonly lazy?: boolean }): React.ReactElement {
    const size = props.size || 16;
    const image = props.icon
        ? <img className='nmx-app-control-icon' src={props.icon} alt='' width={size} height={size} draggable={false}
            {...(props.lazy ? { loading: 'lazy' as const, decoding: 'async' as const } : {})} />
        : <span className='nmx-app-control-icon is-generic' style={{ width: size, height: size }}><AppControlGlyph size={Math.round(size * .8)} /></span>;
    return props.pointer ? <span className='nmx-app-control-icon-wrap' style={{ width: size, height: size }}>{image}<PointerBadge /></span> : image;
}

/**
 * The picked apps at the top left of the composer, on their own row above the text: one chip each, wrapping onto more
 * lines in a narrow composer. `app` is the one-app form older callers use; `onRemove` gets the id of the chip closed.
 */
export function ComposerAppChip(props: { readonly app?: ComposerApp; readonly apps?: readonly ComposerApp[]; readonly locale: NextMuxDesktopLocale;
    readonly onRemove: (id?: string) => void; readonly disabled?: boolean;
    /** Apps whose tab is still opening: shown busy, and not part of the message until it has opened. */
    readonly pendingIds?: ReadonlySet<string>;
    /** Without Full access the agent has no tab tools, so the pick would do nothing: say so, with the switch. */
    readonly onFullAccess?: () => void }): React.ReactElement | null {
    const apps = composerAppList(props.apps?.length ? props.apps : props.app);
    if (!apps.length) return null;
    const selected = appControlText(props.locale, 'selected'), remove = appControlText(props.locale, 'remove');
    return <div className={`nmx-composer-app-row${apps.length > 1 ? ' is-multiple' : ''}`}>
        <div className='nmx-composer-app-list' role='list' aria-label={selected}>
            {apps.map(item => {
                const pending = props.pendingIds?.has(item.id) === true;
                return <span key={item.id} role='listitem' className={`nmx-composer-app${pending ? ' is-pending' : ''}`} aria-busy={pending || undefined}
                    title={pending ? `${appControlText(props.locale, 'opening')} ${item.name}` : `${selected}: ${item.name}`}>
                    {pending
                        ? <span className='nmx-composer-app-busy' aria-hidden='true'><i className='codicon codicon-loading codicon-modifier-spin'></i></span>
                        : <AppControlIcon icon={item.icon} size={apps.length > 1 ? 20 : 22} pointer />}
                    <span className='nmx-composer-app-name'>{item.name}</span>
                    <button type='button' className='nmx-composer-app-remove' disabled={props.disabled}
                        aria-label={`${remove}: ${item.name}`} title={remove}
                        onClick={() => props.onRemove(item.id)}><i className='codicon codicon-close' aria-hidden='true'></i></button>
                </span>;
            })}
            {apps.length > 1 && <span className='nmx-composer-app-count' aria-label={appControlText(props.locale, 'selectedCount', { count: String(apps.length) })}>
                {apps.length}/{MAX_COMPOSER_APPS}</span>}
        </div>
        {props.onFullAccess && <span className='nmx-composer-app-notice' role='status'>
            <span>{appControlText(props.locale, 'needsFullAccess')}</span>
            <button type='button' onClick={props.onFullAccess}>{appControlText(props.locale, 'switchFullAccess')}</button>
        </span>}
    </div>;
}

/** What the picker's search matches: every word typed must be in the app's name or id (case does not matter). */
export function filterPickerApps<T extends AppReference>(apps: readonly T[], query: string): T[] {
    const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [...apps];
    return apps.filter(app => { const text = `${app.name}\n${app.id}`.toLocaleLowerCase(); return words.every(word => text.includes(word)); });
}

/**
 * The in-app picker above the 应用操控 button: search, the installed apps (running ones marked), a check on every picked
 * one and "Browse other apps…" for anything not listed. It stays open while the user picks several; Esc (after clearing
 * a search), a click outside or its close button ends it. At the limit the other rows dim and say why.
 */
export function AppControlPickerPopover(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly apps: readonly AppControlPickerApp[];
    readonly selectedIds: ReadonlySet<string>;
    readonly loading?: boolean;
    /** Apps clicked whose tab is still opening: busy rows that count toward the limit. */
    readonly pendingIds?: ReadonlySet<string>;
    readonly onToggleApp: (app: AppControlPickerApp) => void;
    readonly onBrowse: () => void;
    readonly onClose: () => void;
    /** The list could not be read (a stable code): with no rows to show, the picker says so and offers onRetry. */
    readonly error?: string;
    readonly onRetry?: () => void;
}): React.ReactElement {
    const { locale, apps, selectedIds, pendingIds, onClose } = props;
    const [query, setQuery] = React.useState('');
    const [active, setActive] = React.useState(0);
    const [nudge, setNudge] = React.useState(0);
    const rootRef = React.useRef<HTMLElement>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const listRef = React.useRef<HTMLDivElement>(null);
    const listId = `nmx-app-control-list-${React.useId().replace(/[^\w-]/g, '')}`;
    const visible = React.useMemo(() => filterPickerApps(apps, query), [apps, query]);
    const chosen = selectedIds.size + (pendingIds ? [...pendingIds].filter(id => !selectedIds.has(id)).length : 0);
    const full = chosen >= MAX_COMPOSER_APPS;
    const current = Math.min(active, Math.max(0, visible.length - 1));
    const limitText = appControlText(locale, 'limitReached');
    // A failed load is told apart from "nothing matches": with rows from an earlier load the list stays as it was.
    const loadFailed = !visible.length && !props.loading && Boolean(props.error) && (!query || !apps.length);

    React.useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);
    // A click anywhere else ends the picker. The 应用操控 button toggles it itself, so its own click is left to it.
    React.useEffect(() => {
        const outside = (event: PointerEvent) => {
            const target = event.target as Element | null;
            if (!target || rootRef.current?.contains(target) || target.closest?.('.nmx-app-control-button')) return;
            onClose();
        };
        document.addEventListener('pointerdown', outside, true);
        return () => document.removeEventListener('pointerdown', outside, true);
    }, [onClose]);
    // Arrow keys move through rows that may be scrolled out of view.
    React.useEffect(() => {
        listRef.current?.querySelector<HTMLElement>('.nmx-app-control-item.is-active')?.scrollIntoView({ block: 'nearest' });
    }, [current, visible.length]);

    const toggle = (app: AppControlPickerApp) => {
        if (pendingIds?.has(app.id)) return;
        // At the limit a new pick is refused here, with the counter drawing the eye to why.
        if (full && !selectedIds.has(app.id)) { setNudge(value => value + 1); return; }
        props.onToggleApp(app);
    };
    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
            // Esc belongs to the picker while it is open: it never reaches the conversation's own Esc (stop a run, leave a tab).
            event.preventDefault();
            event.stopPropagation();
            if (query) setQuery(''); else onClose();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!visible.length) return;
            event.preventDefault();
            setActive((current + (event.key === 'ArrowDown' ? 1 : visible.length - 1)) % visible.length);
        } else if (event.key === 'Home' || event.key === 'End') {
            if (!visible.length || event.target === inputRef.current && query) return;
            event.preventDefault();
            setActive(event.key === 'Home' ? 0 : visible.length - 1);
        } else if (event.key === 'Enter' && event.target === inputRef.current && visible[current]) {
            event.preventDefault();
            toggle(visible[current]);
        } else if (event.key === 'Enter' && event.target === inputRef.current && loadFailed && props.onRetry) {
            event.preventDefault();
            props.onRetry();
        }
    };

    return <section ref={rootRef} className='nmx-app-control-popover' role='dialog' aria-label={appControlText(locale, 'pickTitle')} onKeyDown={onKeyDown}>
        <header className='nmx-app-control-head'>
            <strong>{appControlText(locale, 'pickTitle')}</strong>
            <span key={nudge} className={`nmx-app-control-count${chosen ? ' has-picks' : ''}${full ? ' is-full' : ''}${nudge ? ' is-nudged' : ''}`}
                role='status' title={full ? limitText : undefined}>{appControlText(locale, 'selectedCount', { count: String(chosen) })}</span>
            <button type='button' className='nmx-app-control-close' aria-label={appControlText(locale, 'close')} title={appControlText(locale, 'close')}
                onClick={onClose}><i className='codicon codicon-close' aria-hidden='true'></i></button>
        </header>
        <label className='nmx-app-control-search'>
            <i className='codicon codicon-search' aria-hidden='true'></i>
            <input ref={inputRef} type='text' value={query} placeholder={appControlText(locale, 'searchPlaceholder')} aria-label={appControlText(locale, 'searchPlaceholder')}
                role='combobox' aria-expanded={visible.length > 0} aria-controls={listId} aria-autocomplete='list'
                aria-activedescendant={visible[current] ? `${listId}-${current}` : undefined}
                autoComplete='off' autoCorrect='off' autoCapitalize='off' spellCheck={false}
                onChange={event => { setQuery(event.target.value); setActive(0); }} />
            {query && <button type='button' className='nmx-app-control-search-clear' tabIndex={-1} aria-label={appControlText(locale, 'close')}
                onClick={() => { setQuery(''); inputRef.current?.focus({ preventScroll: true }); }}><i className='codicon codicon-close' aria-hidden='true'></i></button>}
        </label>
        {props.loading && apps.length > 0 && <span className='nmx-app-control-refreshing' aria-hidden='true'></span>}
        {/* A listbox holds options only: while there are none, the loading, empty and error states are plain content. */}
        <div ref={listRef} id={listId} className='nmx-app-control-list' role={visible.length ? 'listbox' : undefined}
            aria-multiselectable={visible.length ? 'true' : undefined} aria-busy={props.loading || undefined}>
            {visible.map((app, index) => {
                const selected = selectedIds.has(app.id), pending = pendingIds?.has(app.id) === true && !selected;
                const dimmed = full && !selected && !pending;
                return <button key={app.id} id={`${listId}-${index}`} type='button' role='option' tabIndex={-1}
                    aria-selected={selected} aria-disabled={dimmed || pending || undefined} aria-busy={pending || undefined}
                    className={`nmx-app-control-item${selected ? ' is-selected' : ''}${pending ? ' is-pending' : ''}${dimmed ? ' is-dimmed' : ''}${index === current ? ' is-active' : ''}`}
                    title={dimmed ? limitText : pending ? appControlText(locale, 'opening') : app.name}
                    onPointerMove={() => { if (index !== current) setActive(index); }}
                    onClick={() => { toggle(app); inputRef.current?.focus({ preventScroll: true }); }}>
                    <AppControlIcon icon={app.icon} size={28} lazy />
                    <span className='nmx-app-control-item-name'>{app.name}</span>
                    {app.running && <span className='nmx-app-control-running' title={appControlText(locale, 'runningBadge')}>
                        <i aria-hidden='true'></i><span>{appControlText(locale, 'runningBadge')}</span></span>}
                    <span className='nmx-app-control-check' aria-hidden='true'>
                        {pending ? <i className='codicon codicon-loading codicon-modifier-spin'></i> : selected ? <i className='codicon codicon-check'></i> : null}</span>
                </button>;
            })}
            {!visible.length && props.loading && <div className='nmx-app-control-loading' role='status'>
                <span className='nmx-app-control-loading-text'>{appControlText(locale, 'loadingApps')}</span>
                {[0, 1, 2, 3, 4, 5].map(row => <span key={row} className='nmx-app-control-skeleton' aria-hidden='true'><i></i><b></b></span>)}
            </div>}
            {loadFailed && <div className='nmx-app-control-empty is-error' role='alert'>
                <i className='codicon codicon-warning' aria-hidden='true'></i><span>{appControlText(locale, 'listFailed')}</span>
                {props.onRetry && <button type='button' className='nmx-app-control-retry' onClick={() => { props.onRetry?.(); inputRef.current?.focus({ preventScroll: true }); }}>
                    <i className='codicon codicon-refresh' aria-hidden='true'></i><span>{appControlText(locale, 'retry')}</span></button>}
            </div>}
            {!visible.length && !props.loading && !loadFailed && <div className='nmx-app-control-empty' role='status'>
                <i className='codicon codicon-search' aria-hidden='true'></i><span>{appControlText(locale, 'emptyApps')}</span>
            </div>}
        </div>
        <footer className='nmx-app-control-foot'>
            <button type='button' className='nmx-app-control-browse' onClick={props.onBrowse}>
                <i className='codicon codicon-folder-opened' aria-hidden='true'></i><span>{appControlText(locale, 'browseOther')}</span>
            </button>
        </footer>
    </section>;
}

/** The app a sent turn used, above its text: its own icon when known. */
export function TurnAppChip(props: { readonly name: string; readonly locale: NextMuxDesktopLocale; readonly icon?: string }): React.ReactElement {
    return <span className='nmx-turn-app' title={appControlText(props.locale, 'selected')}>
        {props.icon ? <AppControlIcon icon={props.icon} size={16} /> : <AppControlGlyph size={13} />}<span>{props.name}</span>
    </span>;
}

/** Paths a drop carries that are apps rather than files: .app bundles on macOS, programs and shortcuts on Windows. */
export function droppedApplicationPath(path: string, platform: string): boolean {
    return /mac/i.test(platform) ? /\.app\/?$/i.test(path) : /win/i.test(platform) ? /\.(exe|lnk)$/i.test(path) : false;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function appControlText(locale: Parameters<typeof uncheckedAppControlText>[0], key: Parameters<typeof uncheckedAppControlText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedAppControlText>>): string {
    return totalCopy(locale, key, language => uncheckedAppControlText(language, key, ...rest));
}
