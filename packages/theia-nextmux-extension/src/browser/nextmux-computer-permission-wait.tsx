import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { systemPermissionsText } from './nextmux-system-permissions-panel';

/**
 * Shown above the composer while a computer tool call waits for a system permission: the model is paused, not
 * failed, and carries on by itself once the user has granted it (Screen Recording takes effect after reopening
 * NextMux; the task then continues from where it stopped). An app the user picked waits the same way, named on the
 * card, and opens by itself after the grant; the user can stop that wait with Cancel.
 */
export type ComputerPermissionKind = 'accessibility' | 'screen';

const text: Record<NextMuxDesktopLocale, { readonly title: string; readonly body: string; readonly retryInstall: string; readonly windowsBody: string;
    readonly pickerBody: string; readonly afterUpdate: string; readonly cancel: string }> = {
    'zh-CN': { title: '正在等待系统权限', body: '在系统设置中允许 NextMux 使用「{items}」后，任务会自动继续。', retryInstall: '重新安装组件', windowsBody: '安装 NextMux 输入组件（在 Windows 弹出的确认中选择“是”）后，任务会自动继续。',
        pickerBody: '在系统设置中允许 NextMux 使用「{items}」后，会自动打开「{name}」。', afterUpdate: '如果开关已经是打开的（常见于 NextMux 更新后），请把它关掉再打开一次。', cancel: '取消' },
    'zh-TW': { title: '正在等待系統權限', body: '在系統設定中允許 NextMux 使用「{items}」後，任務會自動繼續。', retryInstall: '重新安裝元件', windowsBody: '安裝 NextMux 輸入元件（在 Windows 彈出的確認中選擇「是」）後，任務會自動繼續。',
        pickerBody: '在系統設定中允許 NextMux 使用「{items}」後，會自動開啟「{name}」。', afterUpdate: '如果開關已經是開啟的（常見於 NextMux 更新後），請把它關閉再開啟一次。', cancel: '取消' },
    en: { title: 'Waiting for a system permission', body: 'Allow NextMux to use {items} in System Settings and the task continues by itself.', retryInstall: 'Install the component again', windowsBody: 'Install the NextMux input component (choose Yes in the Windows prompt) and the task continues by itself.',
        pickerBody: 'Allow NextMux to use {items} in System Settings and {name} opens by itself.', afterUpdate: 'If the switch already looks on (common after a NextMux update), turn it off and on again.', cancel: 'Cancel' },
    ja: { title: 'システム権限を待っています', body: 'システム設定で NextMux に「{items}」を許可すると、作業が自動で再開します。', retryInstall: 'コンポーネントを再インストール', windowsBody: 'NextMux の入力コンポーネントをインストールすると（Windows の確認で「はい」を選択）、作業が自動で再開します。',
        pickerBody: 'システム設定で NextMux に「{items}」を許可すると、「{name}」が自動で開きます。', afterUpdate: 'スイッチがすでにオンに見える場合（NextMux の更新後によくあります）は、いったんオフにしてから再度オンにしてください。', cancel: 'キャンセル' },
    ko: { title: '시스템 권한을 기다리는 중', body: '시스템 설정에서 NextMux에 「{items}」 권한을 허용하면 작업이 자동으로 이어집니다.', retryInstall: '구성 요소 다시 설치', windowsBody: 'NextMux 입력 구성 요소를 설치하면(Windows 확인 창에서 \'예\' 선택) 작업이 자동으로 이어집니다.',
        pickerBody: '시스템 설정에서 NextMux에 「{items}」 권한을 허용하면 {name} 앱이 자동으로 열립니다.', afterUpdate: '스위치가 이미 켜져 있는 것처럼 보이면(NextMux 업데이트 후 흔히 발생) 껐다가 다시 켜 주세요.', cancel: '취소' },
    es: { title: 'Esperando un permiso del sistema', body: 'Permite a NextMux usar {items} en Ajustes del Sistema y la tarea seguirá sola.', retryInstall: 'Instalar el componente de nuevo', windowsBody: 'Instala el componente de entrada de NextMux (elige Sí en el aviso de Windows) y la tarea seguirá sola.',
        pickerBody: 'Permite a NextMux usar {items} en Ajustes del Sistema y {name} se abrirá solo.', afterUpdate: 'Si el interruptor ya parece activado (algo habitual tras actualizar NextMux), desactívalo y vuelve a activarlo.', cancel: 'Cancelar' },
    fr: { title: 'En attente d’une autorisation système', body: 'Autorisez NextMux à utiliser {items} dans les Réglages Système : la tâche reprendra d’elle-même.', retryInstall: 'Réinstaller le composant', windowsBody: 'Installez le composant de saisie NextMux (choisissez Oui dans l’invite Windows) : la tâche reprendra d’elle-même.',
        pickerBody: 'Autorisez NextMux à utiliser {items} dans les Réglages Système : {name} s’ouvrira de lui-même.', afterUpdate: 'Si l’interrupteur semble déjà activé (fréquent après une mise à jour de NextMux), désactivez-le puis réactivez-le.', cancel: 'Annuler' },
    de: { title: 'Warten auf eine Systemberechtigung', body: 'Erlauben Sie NextMux {items} in den Systemeinstellungen, dann läuft die Aufgabe von selbst weiter.', retryInstall: 'Komponente erneut installieren', windowsBody: 'Installieren Sie die NextMux-Eingabekomponente (im Windows-Dialog „Ja“ wählen), dann läuft die Aufgabe von selbst weiter.',
        pickerBody: 'Erlauben Sie NextMux {items} in den Systemeinstellungen, dann öffnet sich {name} von selbst.', afterUpdate: 'Wirkt der Schalter bereits eingeschaltet (häufig nach einem NextMux-Update), schalten Sie ihn aus und wieder ein.', cancel: 'Abbrechen' },
    'pt-BR': { title: 'Aguardando uma permissão do sistema', body: 'Permita que o NextMux use {items} nos Ajustes do Sistema e a tarefa continua sozinha.', retryInstall: 'Instalar o componente novamente', windowsBody: 'Instale o componente de entrada do NextMux (escolha Sim no aviso do Windows) e a tarefa continua sozinha.',
        pickerBody: 'Permita que o NextMux use {items} nos Ajustes do Sistema e o {name} abre sozinho.', afterUpdate: 'Se a chave já parecer ativada (comum após atualizar o NextMux), desative-a e ative-a de novo.', cancel: 'Cancelar' },
    ru: { title: 'Ожидание системного разрешения', body: 'Разрешите NextMux «{items}» в Системных настройках, и задача продолжится сама.', retryInstall: 'Установить компонент снова', windowsBody: 'Установите компонент ввода NextMux (нажмите «Да» в запросе Windows), и задача продолжится сама.',
        pickerBody: 'Разрешите NextMux «{items}» в Системных настройках, и «{name}» откроется само.', afterUpdate: 'Если переключатель уже выглядит включённым (так часто бывает после обновления NextMux), выключите и снова включите его.', cancel: 'Отмена' },
    ar: { title: 'في انتظار إذن من النظام', body: 'اسمح لـ NextMux باستخدام {items} في إعدادات النظام وستستمر المهمة تلقائيًا.', retryInstall: 'تثبيت المكوّن مجددًا', windowsBody: 'ثبّت مكوّن الإدخال في NextMux (اختر نعم في نافذة Windows) وستستمر المهمة تلقائيًا.',
        pickerBody: 'اسمح لـ NextMux باستخدام {items} في إعدادات النظام وسيُفتح {name} تلقائيًا.', afterUpdate: 'إذا بدا المفتاح مفعّلًا بالفعل (وهذا شائع بعد تحديث NextMux)، فأوقفه ثم شغّله مرة أخرى.', cancel: 'إلغاء' },
    hi: { title: 'सिस्टम अनुमति की प्रतीक्षा', body: 'सिस्टम सेटिंग्स में NextMux को {items} की अनुमति दें, कार्य अपने-आप जारी रहेगा।', retryInstall: 'घटक फिर से इंस्टॉल करें', windowsBody: 'NextMux इनपुट घटक इंस्टॉल करें (Windows संकेत में हाँ चुनें), कार्य अपने-आप जारी रहेगा।',
        pickerBody: 'सिस्टम सेटिंग्स में NextMux को {items} की अनुमति दें, {name} अपने-आप खुल जाएगा।', afterUpdate: 'अगर स्विच पहले से चालू दिखे (NextMux अपडेट के बाद अक्सर होता है), तो उसे बंद करके फिर चालू करें।', cancel: 'रद्द करें' }
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
    /** An app the user picked waits for the permission: the card names it, and Cancel (onCancel) stops waiting. */
    readonly appName?: string;
    readonly onCancel?: () => void;
}): React.ReactElement {
    const copy = text[props.locale] || text.en;
    const items = computerPermissionNames(props.locale, props.missing) || systemPermissionsText(props.locale, 'accessibility');
    const body = props.onInstallAgain ? copy.windowsBody
        : (props.appName ? copy.pickerBody : copy.body).replace('{items}', () => items).replace('{name}', () => props.appName || '');
    return <div className='nmx-permission-wait' role='status' aria-live='polite'>
        <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>
        <div>
            <strong>{copy.title}</strong>
            <span>{body}</span>
            {props.missing.includes('screen') && <small>{systemPermissionsText(props.locale, 'relaunchHint')}</small>}
            {/* macOS: a build signed by another identity keeps its switch looking on while it no longer works. */}
            {!props.onInstallAgain && <small>{copy.afterUpdate}</small>}
        </div>
        <div className='nmx-permission-wait-actions'>
            {/* Windows has no privacy page for the input component; installing it is the only step (audit A20-04). */}
            {!props.onInstallAgain && props.missing.map(kind => <button key={kind} type='button' onClick={() => props.onOpenSettings(kind)}>
                {`${systemPermissionsText(props.locale, 'openSettings')} · ${systemPermissionsText(props.locale, kind)}`}</button>)}
            {props.missing.includes('screen') && <button type='button' className='is-primary' onClick={props.onRelaunch}>{systemPermissionsText(props.locale, 'relaunch')}</button>}
            {props.onInstallAgain && <button type='button' className='is-primary' onClick={props.onInstallAgain}>{copy.retryInstall}</button>}
            {props.appName && props.onCancel && <button type='button' className='is-quiet' onClick={props.onCancel}>{copy.cancel}</button>}
        </div>
    </div>;
}
