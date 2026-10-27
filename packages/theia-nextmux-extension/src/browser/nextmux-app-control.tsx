import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * 应用操控: the user picks one app under the composer. Its icon sits at the top left of the input, and the next
 * message starts with a marker line the agent reads as "use this app" (nextmuxTabInstructions): it finds the app's
 * tab, or opens the app in a new one. One app per message; tabs stay one app each.
 */
export interface ComposerApp {
    /** The name the user sees (计算器, 微信). */
    readonly name: string;
    /** Bundle id on macOS (com.apple.calculator), program name on Windows (WeChat): what tabs.open_app matches exactly. */
    readonly id: string;
    /** data: URL of the app's icon, empty when the system gave none. */
    readonly icon: string;
}

type AppControlTextKey = 'placeholder' | 'button' | 'pickTitle' | 'remove' | 'unavailable' | 'selected' | 'needsFullAccess' | 'switchFullAccess'
    | 'closeTitle' | 'closeBody' | 'closeQuit' | 'closeDesktop';

const appControlCatalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<AppControlTextKey, string>>>> = {
    'zh-CN': { placeholder: '输入要在「{name}」里完成的操作', button: '应用操控', pickTitle: '选择要操控的应用', remove: '移除应用', unavailable: '这个版本不能选择应用', selected: '这条消息使用的应用', needsFullAccess: '操控应用需要“完全访问”', switchFullAccess: '改为完全访问',
        closeTitle: '关闭标签或退出 NextMux 时', closeBody: '只影响 NextMux 为标签打开的应用；你原本就开着的应用总是放回桌面。应用会正常退出，有未保存的内容会先问你。', closeQuit: '退出标签里的应用', closeDesktop: '把应用放回桌面' },
    'zh-TW': { placeholder: '輸入要在「{name}」裡完成的操作', button: '應用操控', pickTitle: '選擇要操控的 App', remove: '移除 App', unavailable: '這個版本不能選擇 App', selected: '這則訊息使用的 App', needsFullAccess: '操控 App 需要「完整存取」', switchFullAccess: '改為完整存取',
        closeTitle: '關閉分頁或結束 NextMux 時', closeBody: '只影響 NextMux 為分頁開啟的 App；你原本就開著的 App 一律放回桌面。App 會正常結束，有未儲存的內容會先問你。', closeQuit: '結束分頁裡的 App', closeDesktop: '把 App 放回桌面' },
    en: { placeholder: 'Describe what to do in {name}', button: 'App control', pickTitle: 'Choose an app to control', remove: 'Remove app', unavailable: 'This version can’t pick apps', selected: 'App for this message', needsFullAccess: 'Controlling apps needs Full access', switchFullAccess: 'Switch to Full access',
        closeTitle: 'When a tab closes or NextMux quits', closeBody: 'Applies only to apps NextMux opened for a tab; apps you already had open always go back to your desktop. Apps quit the normal way and ask first if something is unsaved.', closeQuit: 'Quit the apps in tabs', closeDesktop: 'Put the apps back on the desktop' },
    ja: { placeholder: '「{name}」で行う操作を入力', button: 'アプリ操作', pickTitle: '操作するアプリを選択', remove: 'アプリを外す', unavailable: 'このバージョンではアプリを選べません', selected: 'このメッセージで使うアプリ', needsFullAccess: 'アプリの操作には「フルアクセス」が必要です', switchFullAccess: 'フルアクセスにする',
        closeTitle: 'タブを閉じたとき・NextMux を終了したとき', closeBody: 'NextMux がタブ用に開いたアプリだけが対象です。もともと開いていたアプリは常にデスクトップに戻ります。アプリは通常どおり終了し、未保存の内容があれば先に確認します。', closeQuit: 'タブのアプリを終了', closeDesktop: 'アプリをデスクトップに戻す' },
    ko: { placeholder: '{name}에서 할 작업을 입력하세요', button: '앱 제어', pickTitle: '제어할 앱 선택', remove: '앱 제거', unavailable: '이 버전에서는 앱을 선택할 수 없습니다', selected: '이 메시지에 사용할 앱', needsFullAccess: '앱을 제어하려면 ‘전체 액세스’가 필요합니다', switchFullAccess: '전체 액세스로 전환',
        closeTitle: '탭을 닫거나 NextMux를 종료할 때', closeBody: 'NextMux가 탭용으로 연 앱에만 적용됩니다. 원래 열려 있던 앱은 항상 데스크톱으로 돌아갑니다. 앱은 정상적으로 종료되며 저장하지 않은 내용이 있으면 먼저 묻습니다.', closeQuit: '탭의 앱 종료', closeDesktop: '앱을 데스크톱으로 되돌리기' },
    es: { placeholder: 'Describe qué hacer en {name}', button: 'Control de apps', pickTitle: 'Elige la app que quieres controlar', remove: 'Quitar app', unavailable: 'Esta versión no permite elegir apps', selected: 'App para este mensaje', needsFullAccess: 'Para controlar apps hace falta Acceso completo', switchFullAccess: 'Cambiar a Acceso completo',
        closeTitle: 'Al cerrar una pestaña o salir de NextMux', closeBody: 'Solo afecta a las apps que NextMux abrió para una pestaña; las que ya tenías abiertas siempre vuelven al escritorio. Las apps se cierran de forma normal y preguntan antes si hay algo sin guardar.', closeQuit: 'Cerrar las apps de las pestañas', closeDesktop: 'Devolver las apps al escritorio' },
    fr: { placeholder: 'Décrivez ce qu’il faut faire dans {name}', button: 'Contrôle d’app', pickTitle: 'Choisir l’app à contrôler', remove: 'Retirer l’app', unavailable: 'Cette version ne permet pas de choisir une app', selected: 'App pour ce message', needsFullAccess: 'Le contrôle des apps nécessite l’Accès complet', switchFullAccess: 'Passer en Accès complet',
        closeTitle: 'À la fermeture d’un onglet ou de NextMux', closeBody: 'Concerne seulement les apps que NextMux a ouvertes pour un onglet ; celles que vous aviez déjà ouvertes reviennent toujours sur le bureau. Les apps quittent normalement et demandent d’abord s’il reste des modifications.', closeQuit: 'Quitter les apps des onglets', closeDesktop: 'Remettre les apps sur le bureau' },
    de: { placeholder: 'Beschreiben Sie, was in {name} passieren soll', button: 'App-Steuerung', pickTitle: 'App zum Steuern auswählen', remove: 'App entfernen', unavailable: 'Diese Version kann keine Apps auswählen', selected: 'App für diese Nachricht', needsFullAccess: 'Zum Steuern von Apps ist Vollzugriff nötig', switchFullAccess: 'Zu Vollzugriff wechseln',
        closeTitle: 'Beim Schließen eines Tabs oder Beenden von NextMux', closeBody: 'Gilt nur für Apps, die NextMux für einen Tab geöffnet hat; bereits geöffnete Apps kommen immer zurück auf den Schreibtisch. Apps werden normal beendet und fragen vorher nach, wenn etwas nicht gesichert ist.', closeQuit: 'Apps in Tabs beenden', closeDesktop: 'Apps zurück auf den Schreibtisch' },
    'pt-BR': { placeholder: 'Descreva o que fazer em {name}', button: 'Controle de apps', pickTitle: 'Escolha o app para controlar', remove: 'Remover app', unavailable: 'Esta versão não permite escolher apps', selected: 'App desta mensagem', needsFullAccess: 'Controlar apps exige Acesso total', switchFullAccess: 'Mudar para Acesso total',
        closeTitle: 'Ao fechar uma aba ou sair do NextMux', closeBody: 'Vale só para apps que o NextMux abriu para uma aba; apps que você já tinha abertos sempre voltam para a mesa. Os apps fecham normalmente e perguntam antes se algo não foi salvo.', closeQuit: 'Fechar os apps das abas', closeDesktop: 'Devolver os apps para a mesa' },
    ru: { placeholder: 'Опишите, что сделать в приложении «{name}»', button: 'Управление приложением', pickTitle: 'Выберите приложение для управления', remove: 'Убрать приложение', unavailable: 'В этой версии нельзя выбрать приложение', selected: 'Приложение для этого сообщения', needsFullAccess: 'Для управления приложениями нужен полный доступ', switchFullAccess: 'Включить полный доступ',
        closeTitle: 'При закрытии вкладки или выходе из NextMux', closeBody: 'Касается только приложений, которые NextMux открыл для вкладки; уже открытые вами приложения всегда возвращаются на рабочий стол. Приложения закрываются обычным образом и сначала спрашивают о несохранённых данных.', closeQuit: 'Закрывать приложения во вкладках', closeDesktop: 'Возвращать приложения на рабочий стол' },
    ar: { placeholder: 'صِف ما تريد فعله في {name}', button: 'التحكم بالتطبيق', pickTitle: 'اختر التطبيق الذي تريد التحكم به', remove: 'إزالة التطبيق', unavailable: 'لا يمكن اختيار التطبيقات في هذا الإصدار', selected: 'التطبيق لهذه الرسالة', needsFullAccess: 'يتطلب التحكم بالتطبيقات الوصول الكامل', switchFullAccess: 'التبديل إلى الوصول الكامل',
        closeTitle: 'عند إغلاق علامة تبويب أو إنهاء NextMux', closeBody: 'يسري فقط على التطبيقات التي فتحها NextMux لعلامة تبويب؛ أما التطبيقات التي كانت مفتوحة لديك فتعود دائمًا إلى سطح المكتب. تُغلق التطبيقات بشكل عادي وتسأل أولًا إن كان هناك ما لم يُحفظ.', closeQuit: 'إنهاء التطبيقات في علامات التبويب', closeDesktop: 'إعادة التطبيقات إلى سطح المكتب' },
    hi: { placeholder: '{name} में क्या करना है, बताएँ', button: 'ऐप नियंत्रण', pickTitle: 'नियंत्रित करने के लिए ऐप चुनें', remove: 'ऐप हटाएँ', unavailable: 'इस संस्करण में ऐप नहीं चुना जा सकता', selected: 'इस संदेश के लिए ऐप', needsFullAccess: 'ऐप नियंत्रित करने के लिए पूर्ण एक्सेस चाहिए', switchFullAccess: 'पूर्ण एक्सेस पर जाएँ',
        closeTitle: 'टैब बंद करने या NextMux से बाहर निकलने पर', closeBody: 'यह केवल उन ऐप पर लागू होता है जिन्हें NextMux ने टैब के लिए खोला; जो ऐप आपने पहले से खोले थे वे हमेशा डेस्कटॉप पर लौटते हैं। ऐप सामान्य रूप से बंद होते हैं और बिना सहेजे बदलाव होने पर पहले पूछते हैं।', closeQuit: 'टैब के ऐप बंद करें', closeDesktop: 'ऐप को डेस्कटॉप पर लौटाएँ' }
};

function uncheckedAppControlText(locale: NextMuxDesktopLocale, key: AppControlTextKey, vars: Readonly<Record<string, string>> = {}): string {
    return (appControlCatalog[locale] || appControlCatalog.en)[key].replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

const clean = (value: string, max: number): string => value.replace(/[\u0000-\u001f\u007f[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** The first line of the message the agent reads (see nextmuxTabInstructions): `[App: 计算器 (com.apple.calculator)]`. */
export function appControlMarker(app: Pick<ComposerApp, 'name' | 'id'>): string {
    const name = clean(app.name, 80) || clean(app.id, 80);
    const id = clean(app.id, 160);
    return id && id !== name ? `[App: ${name} (${id})]` : `[App: ${name}]`;
}

/** Splits a sent message back into the picked app and the text the user typed, for showing the turn. */
export function parseAppControlMarker(text: string): { readonly app?: { readonly name: string; readonly id: string }; readonly text: string } {
    const match = /^\[App:\s*([^[\]()\n]+?)(?:\s*\(([^[\]()\n]+)\))?\]\n?/.exec(text);
    if (!match) return { text };
    return { app: { name: match[1].trim(), id: (match[2] || match[1]).trim() }, text: text.slice(match[0].length) };
}

/** The message as sent: the marker line, then what the user typed (the marker alone when they typed nothing). */
export function withAppControlMarker(app: ComposerApp | undefined, text: string): string {
    if (!app) return text;
    return text ? `${appControlMarker(app)}\n${text}` : appControlMarker(app);
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

export function AppControlIcon(props: { readonly icon?: string; readonly size?: number; readonly pointer?: boolean }): React.ReactElement {
    const size = props.size || 16;
    const image = props.icon
        ? <img className='nmx-app-control-icon' src={props.icon} alt='' width={size} height={size} draggable={false} />
        : <span className='nmx-app-control-icon is-generic' style={{ width: size, height: size }}><AppControlGlyph size={Math.round(size * .8)} /></span>;
    return props.pointer ? <span className='nmx-app-control-icon-wrap' style={{ width: size, height: size }}>{image}<PointerBadge /></span> : image;
}

/** The picked app at the top left of the composer, on its own row above the text. */
export function ComposerAppChip(props: { readonly app: ComposerApp; readonly locale: NextMuxDesktopLocale; readonly onRemove: () => void; readonly disabled?: boolean;
    /** Without Full access the agent has no tab tools, so the pick would do nothing: say so, with the switch. */
    readonly onFullAccess?: () => void }): React.ReactElement {
    return <div className='nmx-composer-app-row'>
        <span className='nmx-composer-app' title={`${appControlText(props.locale, 'selected')}: ${props.app.name}`}>
            <AppControlIcon icon={props.app.icon} size={22} pointer />
            <span className='nmx-composer-app-name'>{props.app.name}</span>
            <button type='button' className='nmx-composer-app-remove' disabled={props.disabled}
                aria-label={appControlText(props.locale, 'remove')} title={appControlText(props.locale, 'remove')}
                onClick={props.onRemove}><i className='codicon codicon-close' aria-hidden='true'></i></button>
        </span>
        {props.onFullAccess && <span className='nmx-composer-app-notice' role='status'>
            <span>{appControlText(props.locale, 'needsFullAccess')}</span>
            <button type='button' onClick={props.onFullAccess}>{appControlText(props.locale, 'switchFullAccess')}</button>
        </span>}
    </div>;
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
