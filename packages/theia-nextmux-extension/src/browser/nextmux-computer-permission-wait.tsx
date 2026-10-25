import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { systemPermissionsText } from './nextmux-system-permissions-panel';

/**
 * Shown above the composer while a computer tool call waits for a system permission: the model is paused, not
 * failed, and carries on by itself once the user has granted it (Screen Recording takes effect after reopening
 * NextMux; the task then continues from where it stopped).
 */
export type ComputerPermissionKind = 'accessibility' | 'screen';

const text: Record<NextMuxDesktopLocale, { readonly title: string; readonly body: string; readonly retryInstall: string; readonly windowsBody: string }> = {
    'zh-CN': { title: '正在等待系统权限', body: '在系统设置中允许 NextMux 使用「{items}」后，任务会自动继续。', retryInstall: '重新安装组件', windowsBody: '安装 NextMux 输入组件（在 Windows 弹出的确认中选择“是”）后，任务会自动继续。' },
    'zh-TW': { title: '正在等待系統權限', body: '在系統設定中允許 NextMux 使用「{items}」後，任務會自動繼續。', retryInstall: '重新安裝元件', windowsBody: '安裝 NextMux 輸入元件（在 Windows 彈出的確認中選擇「是」）後，任務會自動繼續。' },
    en: { title: 'Waiting for a system permission', body: 'Allow NextMux to use {items} in System Settings and the task continues by itself.', retryInstall: 'Install the component again', windowsBody: 'Install the NextMux input component (choose Yes in the Windows prompt) and the task continues by itself.' },
    ja: { title: 'システム権限を待っています', body: 'システム設定で NextMux に「{items}」を許可すると、作業が自動で再開します。', retryInstall: 'コンポーネントを再インストール', windowsBody: 'NextMux の入力コンポーネントをインストールすると（Windows の確認で「はい」を選択）、作業が自動で再開します。' },
    ko: { title: '시스템 권한을 기다리는 중', body: '시스템 설정에서 NextMux에 「{items}」 권한을 허용하면 작업이 자동으로 이어집니다.', retryInstall: '구성 요소 다시 설치', windowsBody: 'NextMux 입력 구성 요소를 설치하면(Windows 확인 창에서 \'예\' 선택) 작업이 자동으로 이어집니다.' },
    es: { title: 'Esperando un permiso del sistema', body: 'Permite a NextMux usar {items} en Ajustes del Sistema y la tarea seguirá sola.', retryInstall: 'Instalar el componente de nuevo', windowsBody: 'Instala el componente de entrada de NextMux (elige Sí en el aviso de Windows) y la tarea seguirá sola.' },
    fr: { title: 'En attente d’une autorisation système', body: 'Autorisez NextMux à utiliser {items} dans les Réglages Système : la tâche reprendra d’elle-même.', retryInstall: 'Réinstaller le composant', windowsBody: 'Installez le composant de saisie NextMux (choisissez Oui dans l’invite Windows) : la tâche reprendra d’elle-même.' },
    de: { title: 'Warte auf eine Systemberechtigung', body: 'Erlaube NextMux {items} in den Systemeinstellungen, dann läuft die Aufgabe von selbst weiter.', retryInstall: 'Komponente erneut installieren', windowsBody: 'Installiere die NextMux-Eingabekomponente (im Windows-Dialog „Ja“ wählen), dann läuft die Aufgabe von selbst weiter.' },
    'pt-BR': { title: 'Aguardando uma permissão do sistema', body: 'Permita que o NextMux use {items} nos Ajustes do Sistema e a tarefa continua sozinha.', retryInstall: 'Instalar o componente novamente', windowsBody: 'Instale o componente de entrada do NextMux (escolha Sim no aviso do Windows) e a tarefa continua sozinha.' },
    ru: { title: 'Ожидание системного разрешения', body: 'Разрешите NextMux «{items}» в Системных настройках, и задача продолжится сама.', retryInstall: 'Установить компонент снова', windowsBody: 'Установите компонент ввода NextMux (нажмите «Да» в запросе Windows), и задача продолжится сама.' },
    ar: { title: 'في انتظار إذن من النظام', body: 'اسمح لـ NextMux باستخدام {items} في إعدادات النظام وستستمر المهمة تلقائيًا.', retryInstall: 'تثبيت المكوّن مجددًا', windowsBody: 'ثبّت مكوّن الإدخال في NextMux (اختر نعم في نافذة Windows) وستستمر المهمة تلقائيًا.' },
    hi: { title: 'सिस्टम अनुमति की प्रतीक्षा', body: 'सिस्टम सेटिंग्स में NextMux को {items} की अनुमति दें, कार्य अपने-आप जारी रहेगा।', retryInstall: 'घटक फिर से इंस्टॉल करें', windowsBody: 'NextMux इनपुट घटक इंस्टॉल करें (Windows संकेत में हाँ चुनें), कार्य अपने-आप जारी रहेगा।' }
};

export function computerPermissionNames(locale: NextMuxDesktopLocale, missing: readonly ComputerPermissionKind[]): string {
    return missing.map(kind => systemPermissionsText(locale, kind))
        .join(locale === 'zh-CN' || locale === 'zh-TW' || locale === 'ja' ? '、' : ', ');
}

export function ComputerPermissionWait(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly missing: readonly ComputerPermissionKind[];
    readonly onOpenSettings: (kind: ComputerPermissionKind) => void;
    readonly onRelaunch: () => void;
    /** Windows: install the input component again after its UAC prompt was cancelled (audit A09-05). */
    readonly onInstallAgain?: () => void;
}): React.ReactElement {
    const copy = text[props.locale] || text.en;
    const items = computerPermissionNames(props.locale, props.missing);
    return <div className='nmx-permission-wait' role='status' aria-live='polite'>
        <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>
        <div>
            <strong>{copy.title}</strong>
            <span>{props.onInstallAgain ? copy.windowsBody : copy.body.replace('{items}', items || systemPermissionsText(props.locale, 'accessibility'))}</span>
            {props.missing.includes('screen') && <small>{systemPermissionsText(props.locale, 'relaunchHint')}</small>}
        </div>
        <div className='nmx-permission-wait-actions'>
            {/* Windows has no privacy page for the input component; installing it is the only step (audit A20-04). */}
            {!props.onInstallAgain && props.missing.map(kind => <button key={kind} type='button' onClick={() => props.onOpenSettings(kind)}>
                {`${systemPermissionsText(props.locale, 'openSettings')} · ${systemPermissionsText(props.locale, kind)}`}</button>)}
            {props.missing.includes('screen') && <button type='button' className='is-primary' onClick={props.onRelaunch}>{systemPermissionsText(props.locale, 'relaunch')}</button>}
            {props.onInstallAgain && <button type='button' className='is-primary' onClick={props.onInstallAgain}>{copy.retryInstall}</button>}
        </div>
    </div>;
}
