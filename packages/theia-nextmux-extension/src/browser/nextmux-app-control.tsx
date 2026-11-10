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

type AppControlTextKey = 'placeholder' | 'placeholderMany' | 'button' | 'pickTitle' | 'remove' | 'unavailable' | 'selected' | 'needsFullAccess' | 'switchFullAccess'
    | 'closeTitle' | 'closeBody' | 'closeQuit' | 'closeDesktop'
    | 'searchPlaceholder' | 'browseOther' | 'selectedCount' | 'limitReached' | 'loadingApps' | 'emptyApps' | 'runningBadge' | 'close'
    | 'opening' | 'alreadyInTab' | 'alreadyOpenInOs' | 'openFailed';

const appControlCatalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<AppControlTextKey, string>>>> = {
    'zh-CN': { placeholder: '输入要在「{name}」里完成的操作', button: '应用操控', pickTitle: '选择要操控的应用', remove: '移除应用', unavailable: '这个版本不能选择应用', selected: '这条消息使用的应用', needsFullAccess: '操控应用需要“完全访问”', switchFullAccess: '改为完全访问',
        closeTitle: '关闭标签或退出 NextMux 时', closeBody: '只影响 NextMux 为标签打开的应用；你原本就开着的应用总是放回桌面。应用会正常退出，有未保存的内容会先问你。', closeQuit: '退出标签里的应用', closeDesktop: '把应用放回桌面',
        placeholderMany: '输入要在这 {count} 个应用里完成的操作', searchPlaceholder: '搜索应用...', browseOther: '浏览其他应用…', selectedCount: '已选 {count}/{max}', limitReached: '最多同时选择 {max} 个应用', loadingApps: '正在加载应用列表…', emptyApps: '未找到匹配的应用', runningBadge: '运行中', close: '关闭',
        opening: '正在打开…', alreadyInTab: '该应用已经打开在标签内了', alreadyOpenInOs: '该应用已在电脑中打开，请先关闭再做选择', openFailed: '无法在标签中打开「{name}」' },
    'zh-TW': { placeholder: '輸入要在「{name}」裡完成的操作', button: '應用操控', pickTitle: '選擇要操控的 App', remove: '移除 App', unavailable: '這個版本不能選擇 App', selected: '這則訊息使用的 App', needsFullAccess: '操控 App 需要「完整存取」', switchFullAccess: '改為完整存取',
        closeTitle: '關閉分頁或結束 NextMux 時', closeBody: '只影響 NextMux 為分頁開啟的 App；你原本就開著的 App 一律放回桌面。App 會正常結束，有未儲存的內容會先問你。', closeQuit: '結束分頁裡的 App', closeDesktop: '把 App 放回桌面',
        placeholderMany: '輸入要在這 {count} 個 App 裡完成的操作', searchPlaceholder: '搜尋 App...', browseOther: '瀏覽其他 App…', selectedCount: '已選 {count}/{max}', limitReached: '最多同時選擇 {max} 個 App', loadingApps: '正在載入 App 列表…', emptyApps: '找不到符合的 App', runningBadge: '執行中', close: '關閉',
        opening: '正在開啟…', alreadyInTab: '這個 App 已經在分頁中開啟了', alreadyOpenInOs: '這個 App 已在電腦上開啟，請先關閉再選擇', openFailed: '無法在分頁中開啟「{name}」' },
    en: { placeholder: 'Describe what to do in {name}', button: 'App control', pickTitle: 'Choose an app to control', remove: 'Remove app', unavailable: 'This version can’t pick apps', selected: 'App for this message', needsFullAccess: 'Controlling apps needs Full access', switchFullAccess: 'Switch to Full access',
        closeTitle: 'When a tab closes or NextMux quits', closeBody: 'Applies only to apps NextMux opened for a tab; apps you already had open always go back to your desktop. Apps quit the normal way and ask first if something is unsaved.', closeQuit: 'Quit the apps in tabs', closeDesktop: 'Put the apps back on the desktop',
        placeholderMany: 'Describe what to do in these {count} apps', searchPlaceholder: 'Search applications...', browseOther: 'Browse other apps…', selectedCount: '{count}/{max} selected', limitReached: 'You can select up to {max} apps at a time.', loadingApps: 'Loading applications…', emptyApps: 'No matching applications', runningBadge: 'Running', close: 'Close',
        opening: 'Opening…', alreadyInTab: 'This app is already open in a tab.', alreadyOpenInOs: 'This app is already open on your computer. Please close it first before selecting.', openFailed: 'Couldn’t open {name} in a tab' },
    ja: { placeholder: '「{name}」で行う操作を入力', button: 'アプリ操作', pickTitle: '操作するアプリを選択', remove: 'アプリを外す', unavailable: 'このバージョンではアプリを選べません', selected: 'このメッセージで使うアプリ', needsFullAccess: 'アプリの操作には「フルアクセス」が必要です', switchFullAccess: 'フルアクセスにする',
        closeTitle: 'タブを閉じたとき・NextMux を終了したとき', closeBody: 'NextMux がタブ用に開いたアプリだけが対象です。もともと開いていたアプリは常にデスクトップに戻ります。アプリは通常どおり終了し、未保存の内容があれば先に確認します。', closeQuit: 'タブのアプリを終了', closeDesktop: 'アプリをデスクトップに戻す',
        placeholderMany: 'この {count} 個のアプリで行う操作を入力', searchPlaceholder: 'アプリを検索...', browseOther: 'ほかのアプリを選ぶ…', selectedCount: '{count}/{max} 個を選択中', limitReached: '同時に選べるアプリは {max} 個までです', loadingApps: 'アプリを読み込み中…', emptyApps: '一致するアプリがありません', runningBadge: '実行中', close: '閉じる',
        opening: '開いています…', alreadyInTab: 'このアプリはすでにタブで開いています', alreadyOpenInOs: 'このアプリはすでにパソコンで開いています。いったん閉じてから選び直してください', openFailed: '「{name}」をタブで開けませんでした' },
    ko: { placeholder: '{name}에서 할 작업을 입력하세요', button: '앱 제어', pickTitle: '제어할 앱 선택', remove: '앱 제거', unavailable: '이 버전에서는 앱을 선택할 수 없습니다', selected: '이 메시지에 사용할 앱', needsFullAccess: '앱을 제어하려면 ‘전체 액세스’가 필요합니다', switchFullAccess: '전체 액세스로 전환',
        closeTitle: '탭을 닫거나 NextMux를 종료할 때', closeBody: 'NextMux가 탭용으로 연 앱에만 적용됩니다. 원래 열려 있던 앱은 항상 데스크톱으로 돌아갑니다. 앱은 정상적으로 종료되며 저장하지 않은 내용이 있으면 먼저 묻습니다.', closeQuit: '탭의 앱 종료', closeDesktop: '앱을 데스크톱으로 되돌리기',
        placeholderMany: '이 앱 {count}개에서 할 작업을 입력하세요', searchPlaceholder: '앱 검색...', browseOther: '다른 앱 찾아보기…', selectedCount: '{count}/{max}개 선택됨', limitReached: '앱은 한 번에 {max}개까지 선택할 수 있습니다', loadingApps: '앱 목록을 불러오는 중…', emptyApps: '일치하는 앱이 없습니다', runningBadge: '실행 중', close: '닫기',
        opening: '여는 중…', alreadyInTab: '이 앱은 이미 탭에 열려 있습니다', alreadyOpenInOs: '이 앱은 이미 컴퓨터에서 열려 있습니다. 먼저 닫은 뒤 다시 선택하세요', openFailed: '{name} 앱을 탭에서 열 수 없습니다' },
    es: { placeholder: 'Describe qué hacer en {name}', button: 'Control de apps', pickTitle: 'Elige la app que quieres controlar', remove: 'Quitar app', unavailable: 'Esta versión no permite elegir apps', selected: 'App para este mensaje', needsFullAccess: 'Para controlar apps hace falta Acceso completo', switchFullAccess: 'Cambiar a Acceso completo',
        closeTitle: 'Al cerrar una pestaña o salir de NextMux', closeBody: 'Solo afecta a las apps que NextMux abrió para una pestaña; las que ya tenías abiertas siempre vuelven al escritorio. Las apps se cierran de forma normal y preguntan antes si hay algo sin guardar.', closeQuit: 'Cerrar las apps de las pestañas', closeDesktop: 'Devolver las apps al escritorio',
        placeholderMany: 'Describe qué hacer en estas {count} apps', searchPlaceholder: 'Buscar aplicaciones...', browseOther: 'Buscar otras apps…', selectedCount: '{count}/{max} seleccionadas', limitReached: 'Puedes seleccionar hasta {max} apps a la vez.', loadingApps: 'Cargando aplicaciones…', emptyApps: 'No hay aplicaciones que coincidan', runningBadge: 'En ejecución', close: 'Cerrar',
        opening: 'Abriendo…', alreadyInTab: 'Esta app ya está abierta en una pestaña.', alreadyOpenInOs: 'Esta app ya está abierta en tu ordenador. Ciérrala antes de seleccionarla.', openFailed: 'No se pudo abrir {name} en una pestaña' },
    fr: { placeholder: 'Décrivez ce qu’il faut faire dans {name}', button: 'Contrôle d’app', pickTitle: 'Choisir l’app à contrôler', remove: 'Retirer l’app', unavailable: 'Cette version ne permet pas de choisir une app', selected: 'App pour ce message', needsFullAccess: 'Le contrôle des apps nécessite l’Accès complet', switchFullAccess: 'Passer en Accès complet',
        closeTitle: 'À la fermeture d’un onglet ou de NextMux', closeBody: 'Concerne seulement les apps que NextMux a ouvertes pour un onglet ; celles que vous aviez déjà ouvertes reviennent toujours sur le bureau. Les apps quittent normalement et demandent d’abord s’il reste des modifications.', closeQuit: 'Quitter les apps des onglets', closeDesktop: 'Remettre les apps sur le bureau',
        placeholderMany: 'Décrivez ce qu’il faut faire dans ces {count} apps', searchPlaceholder: 'Rechercher des applications...', browseOther: 'Parcourir d’autres apps…', selectedCount: '{count}/{max} sélectionnées', limitReached: 'Vous pouvez sélectionner jusqu’à {max} apps à la fois.', loadingApps: 'Chargement des applications…', emptyApps: 'Aucune application correspondante', runningBadge: 'En cours', close: 'Fermer',
        opening: 'Ouverture…', alreadyInTab: 'Cette app est déjà ouverte dans un onglet.', alreadyOpenInOs: 'Cette app est déjà ouverte sur votre ordinateur. Fermez-la avant de la sélectionner.', openFailed: 'Impossible d’ouvrir {name} dans un onglet' },
    de: { placeholder: 'Beschreiben Sie, was in {name} passieren soll', button: 'App-Steuerung', pickTitle: 'App zum Steuern auswählen', remove: 'App entfernen', unavailable: 'Diese Version kann keine Apps auswählen', selected: 'App für diese Nachricht', needsFullAccess: 'Zum Steuern von Apps ist Vollzugriff nötig', switchFullAccess: 'Zu Vollzugriff wechseln',
        closeTitle: 'Beim Schließen eines Tabs oder Beenden von NextMux', closeBody: 'Gilt nur für Apps, die NextMux für einen Tab geöffnet hat; bereits geöffnete Apps kommen immer zurück auf den Schreibtisch. Apps werden normal beendet und fragen vorher nach, wenn etwas nicht gesichert ist.', closeQuit: 'Apps in Tabs beenden', closeDesktop: 'Apps zurück auf den Schreibtisch',
        placeholderMany: 'Beschreiben Sie, was in diesen {count} Apps passieren soll', searchPlaceholder: 'Apps suchen...', browseOther: 'Andere Apps durchsuchen…', selectedCount: '{count}/{max} ausgewählt', limitReached: 'Es können höchstens {max} Apps gleichzeitig ausgewählt werden.', loadingApps: 'Apps werden geladen…', emptyApps: 'Keine passenden Apps', runningBadge: 'Läuft', close: 'Schließen',
        opening: 'Wird geöffnet…', alreadyInTab: 'Diese App ist bereits in einem Tab geöffnet.', alreadyOpenInOs: 'Diese App ist auf Ihrem Computer bereits geöffnet. Schließen Sie sie, bevor Sie sie auswählen.', openFailed: '{name} konnte nicht in einem Tab geöffnet werden' },
    'pt-BR': { placeholder: 'Descreva o que fazer em {name}', button: 'Controle de apps', pickTitle: 'Escolha o app para controlar', remove: 'Remover app', unavailable: 'Esta versão não permite escolher apps', selected: 'App desta mensagem', needsFullAccess: 'Controlar apps exige Acesso total', switchFullAccess: 'Mudar para Acesso total',
        closeTitle: 'Ao fechar uma aba ou sair do NextMux', closeBody: 'Vale só para apps que o NextMux abriu para uma aba; apps que você já tinha abertos sempre voltam para a mesa. Os apps fecham normalmente e perguntam antes se algo não foi salvo.', closeQuit: 'Fechar os apps das abas', closeDesktop: 'Devolver os apps para a mesa',
        placeholderMany: 'Descreva o que fazer nestes {count} apps', searchPlaceholder: 'Buscar aplicativos...', browseOther: 'Procurar outros apps…', selectedCount: '{count}/{max} selecionados', limitReached: 'Você pode selecionar até {max} apps por vez.', loadingApps: 'Carregando aplicativos…', emptyApps: 'Nenhum aplicativo encontrado', runningBadge: 'Em execução', close: 'Fechar',
        opening: 'Abrindo…', alreadyInTab: 'Este app já está aberto em uma aba.', alreadyOpenInOs: 'Este app já está aberto no seu computador. Feche-o antes de selecionar.', openFailed: 'Não foi possível abrir {name} em uma aba' },
    ru: { placeholder: 'Опишите, что сделать в приложении «{name}»', button: 'Управление приложением', pickTitle: 'Выберите приложение для управления', remove: 'Убрать приложение', unavailable: 'В этой версии нельзя выбрать приложение', selected: 'Приложение для этого сообщения', needsFullAccess: 'Для управления приложениями нужен полный доступ', switchFullAccess: 'Включить полный доступ',
        closeTitle: 'При закрытии вкладки или выходе из NextMux', closeBody: 'Касается только приложений, которые NextMux открыл для вкладки; уже открытые вами приложения всегда возвращаются на рабочий стол. Приложения закрываются обычным образом и сначала спрашивают о несохранённых данных.', closeQuit: 'Закрывать приложения во вкладках', closeDesktop: 'Возвращать приложения на рабочий стол',
        placeholderMany: 'Опишите, что сделать в этих приложениях ({count})', searchPlaceholder: 'Поиск приложений...', browseOther: 'Выбрать другое приложение…', selectedCount: 'Выбрано {count}/{max}', limitReached: 'Одновременно можно выбрать не больше {max} приложений.', loadingApps: 'Загрузка списка приложений…', emptyApps: 'Подходящих приложений нет', runningBadge: 'Запущено', close: 'Закрыть',
        opening: 'Открывается…', alreadyInTab: 'Это приложение уже открыто во вкладке.', alreadyOpenInOs: 'Это приложение уже открыто на компьютере. Закройте его, прежде чем выбирать.', openFailed: 'Не удалось открыть «{name}» во вкладке' },
    ar: { placeholder: 'صِف ما تريد فعله في {name}', button: 'التحكم بالتطبيق', pickTitle: 'اختر التطبيق الذي تريد التحكم به', remove: 'إزالة التطبيق', unavailable: 'لا يمكن اختيار التطبيقات في هذا الإصدار', selected: 'التطبيق لهذه الرسالة', needsFullAccess: 'يتطلب التحكم بالتطبيقات الوصول الكامل', switchFullAccess: 'التبديل إلى الوصول الكامل',
        closeTitle: 'عند إغلاق علامة تبويب أو إنهاء NextMux', closeBody: 'يسري فقط على التطبيقات التي فتحها NextMux لعلامة تبويب؛ أما التطبيقات التي كانت مفتوحة لديك فتعود دائمًا إلى سطح المكتب. تُغلق التطبيقات بشكل عادي وتسأل أولًا إن كان هناك ما لم يُحفظ.', closeQuit: 'إنهاء التطبيقات في علامات التبويب', closeDesktop: 'إعادة التطبيقات إلى سطح المكتب',
        placeholderMany: 'صِف ما تريد فعله في هذه التطبيقات ({count})', searchPlaceholder: 'ابحث عن التطبيقات...', browseOther: 'تصفّح تطبيقات أخرى…', selectedCount: 'تم تحديد {count}/{max}', limitReached: 'يمكنك تحديد {max} تطبيقات كحد أقصى في المرة الواحدة.', loadingApps: 'جارٍ تحميل التطبيقات…', emptyApps: 'لا توجد تطبيقات مطابقة', runningBadge: 'قيد التشغيل', close: 'إغلاق',
        opening: 'جارٍ الفتح…', alreadyInTab: 'هذا التطبيق مفتوح بالفعل في علامة تبويب.', alreadyOpenInOs: 'هذا التطبيق مفتوح بالفعل على حاسوبك. أغلقه أولًا ثم اختره.', openFailed: 'تعذّر فتح {name} في علامة تبويب' },
    hi: { placeholder: '{name} में क्या करना है, बताएँ', button: 'ऐप नियंत्रण', pickTitle: 'नियंत्रित करने के लिए ऐप चुनें', remove: 'ऐप हटाएँ', unavailable: 'इस संस्करण में ऐप नहीं चुना जा सकता', selected: 'इस संदेश के लिए ऐप', needsFullAccess: 'ऐप नियंत्रित करने के लिए पूर्ण एक्सेस चाहिए', switchFullAccess: 'पूर्ण एक्सेस पर जाएँ',
        closeTitle: 'टैब बंद करने या NextMux से बाहर निकलने पर', closeBody: 'यह केवल उन ऐप पर लागू होता है जिन्हें NextMux ने टैब के लिए खोला; जो ऐप आपने पहले से खोले थे वे हमेशा डेस्कटॉप पर लौटते हैं। ऐप सामान्य रूप से बंद होते हैं और बिना सहेजे बदलाव होने पर पहले पूछते हैं।', closeQuit: 'टैब के ऐप बंद करें', closeDesktop: 'ऐप को डेस्कटॉप पर लौटाएँ',
        placeholderMany: 'इन {count} ऐप में क्या करना है, बताएँ', searchPlaceholder: 'ऐप खोजें...', browseOther: 'दूसरे ऐप ब्राउज़ करें…', selectedCount: '{count}/{max} चुने गए', limitReached: 'एक बार में अधिकतम {max} ऐप चुने जा सकते हैं।', loadingApps: 'ऐप लोड हो रहे हैं…', emptyApps: 'कोई मिलता-जुलता ऐप नहीं मिला', runningBadge: 'चल रहा है', close: 'बंद करें',
        opening: 'खुल रहा है…', alreadyInTab: 'यह ऐप पहले से एक टैब में खुला है।', alreadyOpenInOs: 'यह ऐप आपके कंप्यूटर पर पहले से खुला है। चुनने से पहले इसे बंद करें।', openFailed: '{name} को टैब में नहीं खोला जा सका' }
};

function uncheckedAppControlText(locale: NextMuxDesktopLocale, key: AppControlTextKey, vars: Readonly<Record<string, string>> = {}): string {
    return (appControlCatalog[locale] || appControlCatalog.en)[key]
        .replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? (name === 'max' ? String(MAX_COMPOSER_APPS) : whole));
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
                role='combobox' aria-expanded='true' aria-controls={listId} aria-autocomplete='list'
                aria-activedescendant={visible[current] ? `${listId}-${current}` : undefined}
                autoComplete='off' autoCorrect='off' autoCapitalize='off' spellCheck={false}
                onChange={event => { setQuery(event.target.value); setActive(0); }} />
            {query && <button type='button' className='nmx-app-control-search-clear' tabIndex={-1} aria-label={appControlText(locale, 'close')}
                onClick={() => { setQuery(''); inputRef.current?.focus({ preventScroll: true }); }}><i className='codicon codicon-close' aria-hidden='true'></i></button>}
        </label>
        {props.loading && apps.length > 0 && <span className='nmx-app-control-refreshing' aria-hidden='true'></span>}
        <div ref={listRef} id={listId} className='nmx-app-control-list' role='listbox' aria-multiselectable='true' aria-busy={props.loading || undefined}>
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
            {!visible.length && !props.loading && <div className='nmx-app-control-empty' role='status'>
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
