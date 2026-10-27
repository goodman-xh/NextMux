import * as React from '@theia/core/shared/react';
import { NEXTMUX_DESKTOP_LOCALES, type NextMuxDesktopLocale } from './nextmux-locale';
import type { DesktopThemePreference } from './nextmux-desktop-theme';
import { SystemPermissionsSetup, type SystemPermissionsBridge } from './nextmux-system-permissions-panel';

/**
 * First-run setup: language and appearance, then (on macOS / Windows) the
 * system permissions the core features need. Every step can be skipped; the
 * same permissions stay available in Settings → System permissions, and a
 * feature that needs one still asks at the moment it is used.
 */
export const ONBOARDING_KEY = 'nextmux.desktop.onboarding.v1';
export type OnboardingStep = 'appearance' | 'permissions' | 'done';

export function readOnboardingStep(storage: Pick<Storage, 'getItem'> | undefined): OnboardingStep {
    try {
        const value = storage?.getItem(ONBOARDING_KEY);
        return value === 'permissions' || value === 'done' ? value : 'appearance';
    } catch {
        return 'done';
    }
}

type Key = 'welcome' | 'lead' | 'language' | 'appearance' | 'dark' | 'light' | 'system' | 'continue' | 'skip' | 'permissionsTitle' | 'permissionsLead'
    | 'start' | 'later' | 'step';

const text: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    'zh-CN': { welcome: '欢迎使用 NextMux', lead: '先选择语言和外观，之后随时可以在设置里修改。', language: '语言', appearance: '外观', dark: '深色', light: '浅色', system: '跟随系统', continue: '继续', skip: '跳过',
        permissionsTitle: '系统权限', permissionsLead: 'AI 操作电脑、语音输入和任务通知需要这些权限。可以现在开启，也可以跳过，等用到时再弹出，或在“设置 → 系统权限”里开启。', start: '开始使用', later: '稍后再说', step: '第 {n} 步，共 {total} 步' },
    'zh-TW': { welcome: '歡迎使用 NextMux', lead: '先選擇語言與外觀，之後隨時可以在設定中修改。', language: '語言', appearance: '外觀', dark: '深色', light: '淺色', system: '跟隨系統', continue: '繼續', skip: '略過',
        permissionsTitle: '系統權限', permissionsLead: 'AI 操作電腦、語音輸入與任務通知需要這些權限。可以現在開啟，也可以略過，等用到時再詢問，或在「設定 → 系統權限」中開啟。', start: '開始使用', later: '稍後再說', step: '第 {n} 步，共 {total} 步' },
    en: { welcome: 'Welcome to NextMux', lead: 'Choose your language and appearance. You can change both later in Settings.', language: 'Language', appearance: 'Appearance', dark: 'Dark', light: 'Light', system: 'Match system', continue: 'Continue', skip: 'Skip',
        permissionsTitle: 'System permissions', permissionsLead: 'Computer control, voice input and task notifications need these. Allow them now, or skip: NextMux asks when a feature first needs one, and Settings → System permissions has them all.', start: 'Start using NextMux', later: 'Not now', step: 'Step {n} of {total}' },
    ja: { welcome: 'NextMux へようこそ', lead: '言語と外観を選んでください。あとから設定で変更できます。', language: '言語', appearance: '外観', dark: 'ダーク', light: 'ライト', system: 'システムに合わせる', continue: '続ける', skip: 'スキップ',
        permissionsTitle: 'システム権限', permissionsLead: 'コンピューター操作、音声入力、タスク通知に必要です。今すぐ許可するか、スキップしてください。必要になったときに確認し、「設定 → システム権限」からいつでも許可できます。', start: 'NextMux を始める', later: 'あとで', step: 'ステップ {n}/{total}' },
    ko: { welcome: 'NextMux에 오신 것을 환영합니다', lead: '언어와 모양을 선택하세요. 나중에 설정에서 바꿀 수 있습니다.', language: '언어', appearance: '모양', dark: '다크', light: '라이트', system: '시스템 설정 따름', continue: '계속', skip: '건너뛰기',
        permissionsTitle: '시스템 권한', permissionsLead: '컴퓨터 제어, 음성 입력, 작업 알림에 필요합니다. 지금 허용하거나 건너뛰세요. 기능이 처음 필요할 때 다시 묻고, 설정 → 시스템 권한에서 언제든 허용할 수 있습니다.', start: 'NextMux 시작하기', later: '나중에', step: '{total}단계 중 {n}단계' },
    es: { welcome: 'Te damos la bienvenida a NextMux', lead: 'Elige idioma y apariencia. Puedes cambiarlos luego en Ajustes.', language: 'Idioma', appearance: 'Apariencia', dark: 'Oscuro', light: 'Claro', system: 'Según el sistema', continue: 'Continuar', skip: 'Omitir',
        permissionsTitle: 'Permisos del sistema', permissionsLead: 'El control del equipo, la voz y los avisos de tareas los necesitan. Permítelos ahora u omite: NextMux los pedirá cuando haga falta y siempre están en Ajustes → Permisos del sistema.', start: 'Empezar a usar NextMux', later: 'Ahora no', step: 'Paso {n} de {total}' },
    fr: { welcome: 'Bienvenue dans NextMux', lead: 'Choisissez la langue et l’apparence. Vous pourrez les modifier dans les Réglages.', language: 'Langue', appearance: 'Apparence', dark: 'Sombre', light: 'Clair', system: 'Comme le système', continue: 'Continuer', skip: 'Passer',
        permissionsTitle: 'Autorisations système', permissionsLead: 'Le contrôle de l’ordinateur, la voix et les notifications en ont besoin. Autorisez-les maintenant ou passez : NextMux les demandera au besoin, et tout reste dans Réglages → Autorisations système.', start: 'Commencer avec NextMux', later: 'Plus tard', step: 'Étape {n} sur {total}' },
    de: { welcome: 'Willkommen bei NextMux', lead: 'Wählen Sie Sprache und Erscheinungsbild. Beides lässt sich später in den Einstellungen ändern.', language: 'Sprache', appearance: 'Erscheinungsbild', dark: 'Dunkel', light: 'Hell', system: 'Wie das System', continue: 'Weiter', skip: 'Überspringen',
        permissionsTitle: 'Systemberechtigungen', permissionsLead: 'Computersteuerung, Spracheingabe und Aufgabenmitteilungen brauchen diese. Jetzt erlauben oder überspringen: NextMux fragt bei Bedarf, und alles finden Sie unter Einstellungen → Systemberechtigungen.', start: 'NextMux verwenden', later: 'Später', step: 'Schritt {n} von {total}' },
    'pt-BR': { welcome: 'Boas-vindas ao NextMux', lead: 'Escolha idioma e aparência. Dá para mudar depois nos Ajustes.', language: 'Idioma', appearance: 'Aparência', dark: 'Escuro', light: 'Claro', system: 'Igual ao sistema', continue: 'Continuar', skip: 'Pular',
        permissionsTitle: 'Permissões do sistema', permissionsLead: 'Controle do computador, voz e avisos de tarefas precisam delas. Permita agora ou pule: o NextMux pede quando precisar, e tudo fica em Ajustes → Permissões do sistema.', start: 'Começar a usar o NextMux', later: 'Agora não', step: 'Passo {n} de {total}' },
    ru: { welcome: 'Добро пожаловать в NextMux', lead: 'Выберите язык и оформление. Их можно изменить позже в настройках.', language: 'Язык', appearance: 'Оформление', dark: 'Тёмное', light: 'Светлое', system: 'Как в системе', continue: 'Продолжить', skip: 'Пропустить',
        permissionsTitle: 'Системные разрешения', permissionsLead: 'Они нужны для управления компьютером, голосового ввода и уведомлений. Разрешите сейчас или пропустите: NextMux спросит при необходимости, а всё собрано в «Настройки → Системные разрешения».', start: 'Начать работу', later: 'Не сейчас', step: 'Шаг {n} из {total}' },
    ar: { welcome: 'مرحبًا بك في NextMux', lead: 'اختر اللغة والمظهر. يمكنك تغييرهما لاحقًا من الإعدادات.', language: 'اللغة', appearance: 'المظهر', dark: 'داكن', light: 'فاتح', system: 'مطابقة النظام', continue: 'متابعة', skip: 'تخطي',
        permissionsTitle: 'أذونات النظام', permissionsLead: 'يحتاجها التحكم في الكمبيوتر والإدخال الصوتي وإشعارات المهام. اسمح بها الآن أو تخطَّ: سيطلبها NextMux عند الحاجة، وكلها في الإعدادات ← أذونات النظام.', start: 'ابدأ استخدام NextMux', later: 'ليس الآن', step: 'الخطوة {n} من {total}' },
    hi: { welcome: 'NextMux में आपका स्वागत है', lead: 'भाषा और रूप चुनें। बाद में सेटिंग्स में बदल सकते हैं।', language: 'भाषा', appearance: 'रूप', dark: 'डार्क', light: 'लाइट', system: 'सिस्टम के अनुसार', continue: 'जारी रखें', skip: 'छोड़ें',
        permissionsTitle: 'सिस्टम अनुमतियाँ', permissionsLead: 'कंप्यूटर नियंत्रण, आवाज़ इनपुट और कार्य सूचनाओं के लिए ये ज़रूरी हैं। अभी अनुमति दें या छोड़ें: ज़रूरत पड़ने पर NextMux पूछेगा, और सभी सेटिंग्स → सिस्टम अनुमतियाँ में हैं।', start: 'NextMux शुरू करें', later: 'अभी नहीं', step: 'चरण {n} / {total}' }
};

export interface OnboardingProps {
    readonly step: 'appearance' | 'permissions';
    readonly locale: NextMuxDesktopLocale;
    readonly theme: DesktopThemePreference;
    readonly bridge: SystemPermissionsBridge | undefined;
    readonly permissionsAvailable: boolean;
    readonly onPreviewTheme: (theme: DesktopThemePreference) => void;
    /** Applies the choices; the host reloads when the language changed. */
    readonly onAppearanceDone: (locale: NextMuxDesktopLocale, theme: DesktopThemePreference) => void;
    readonly onFinish: () => void;
    /** The NextMux mark; it opens large in the centre, then settles at the top. */
    readonly brand?: React.ReactNode;
}

/** How long the logo rests in the centre once the launch animation has handed over, before it draws back to the top. */
const INTRO_MS = 380;
/** The launch animation (apps/desktop/splash) covers the page until it has played; it says so on <html>. */
function launchAnimationPlaying(): boolean {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('nmx-splash-active');
}

function prefersReducedMotion(): boolean {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function NextMuxOnboarding(props: OnboardingProps): React.ReactElement {
    const [locale, setLocale] = React.useState<NextMuxDesktopLocale>(props.locale);
    const [theme, setTheme] = React.useState<DesktopThemePreference>(props.theme);
    const t = (key: Key, values: Readonly<Record<string, number>> = {}): string =>
        text[locale][key].replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
    const total = props.permissionsAvailable ? 2 : 1;
    const first = React.useRef<HTMLElement>(null);
    // The mark continues the launch screen: large and centred first, then it
    // moves to the top and the setup appears in the space it leaves.
    const [settled, setSettled] = React.useState(() => props.step !== 'appearance' || prefersReducedMotion());
    const [splash, setSplash] = React.useState(launchAnimationPlaying);
    React.useEffect(() => {
        if (!splash) return;
        const over = (): void => setSplash(false);
        window.addEventListener('nextmux-splash-done', over, { once: true });
        const guard = window.setTimeout(over, 22_000);
        return () => { window.removeEventListener('nextmux-splash-done', over); window.clearTimeout(guard); };
    }, [splash]);
    React.useEffect(() => {
        if (settled || splash) return;
        const timer = window.setTimeout(() => setSettled(true), INTRO_MS);
        return () => window.clearTimeout(timer);
    }, [settled, splash]);
    React.useEffect(() => { if (settled) first.current?.focus(); }, [props.step, settled]);
    const choose = (next: DesktopThemePreference): void => { setTheme(next); props.onPreviewTheme(next); };
    // Literal: this surface is already in the chosen language; the app-wide
    // localisation pass must not translate it back into the current one.
    return <div className={`nmx-onboarding-backdrop is-page ${settled ? 'is-settled' : 'is-intro'}`} data-nmx-literal dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}>
        <div className='nmx-onboarding-drag' aria-hidden='true'></div>
        <div className='nmx-onboarding-brand' aria-hidden='true'>{props.brand}</div>
        <section className={`nmx-onboarding is-${props.step}`} role='dialog' aria-modal='true' aria-labelledby='nmx-onboarding-title' ref={first} tabIndex={-1} aria-hidden={!settled}>
            <span className='nmx-onboarding-step'>{t('step', { n: props.step === 'appearance' ? 1 : 2, total })}</span>
            {props.step === 'appearance' ? <>
                <h1 id='nmx-onboarding-title'>{t('welcome')}</h1>
                <p>{t('lead')}</p>
                <fieldset className='nmx-onboarding-field'>
                    <legend>{t('language')}</legend>
                    <div className='nmx-onboarding-languages' role='radiogroup' aria-label={t('language')}>
                        {NEXTMUX_DESKTOP_LOCALES.map(([code, name]) => <button key={code} type='button' role='radio' aria-checked={locale === code} lang={code}
                            className={locale === code ? 'is-active' : ''} onClick={() => setLocale(code)}>{name}</button>)}
                    </div>
                </fieldset>
                <fieldset className='nmx-onboarding-field'>
                    <legend>{t('appearance')}</legend>
                    <div className='nmx-onboarding-themes' role='radiogroup' aria-label={t('appearance')}>
                        {(['dark', 'light', 'system'] as const).map(option => <button key={option} type='button' role='radio' aria-checked={theme === option}
                            className={`is-${option} ${theme === option ? 'is-active' : ''}`} onClick={() => choose(option)}>
                            <span className='nmx-onboarding-swatch' aria-hidden='true'><i></i><i></i></span>{t(option)}</button>)}
                    </div>
                </fieldset>
                <footer><button type='button' className='nmx-primary-button' onClick={() => props.onAppearanceDone(locale, theme)}>{t('continue')}</button></footer>
            </> : <>
                <h1 id='nmx-onboarding-title'>{t('permissionsTitle')}</h1>
                <p>{t('permissionsLead')}</p>
                <div className='nmx-onboarding-permissions nmx-system-permissions'><SystemPermissionsSetup locale={locale} bridge={props.bridge} onBeforeRelaunch={props.onFinish} /></div>
                <footer><button type='button' className='nmx-secondary-button' onClick={props.onFinish}>{t('later')}</button>
                    <button type='button' className='nmx-primary-button' onClick={props.onFinish}>{t('start')}</button></footer>
            </>}
        </section>
    </div>;
}
