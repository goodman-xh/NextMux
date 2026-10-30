import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Visible state of the browser sign-in flow: while the browser is open the app
 * indicates that sign-in will sync automatically, and offers "Open again"
 * (minting a fresh link) and "Cancel"; an expired link asks the user to start
 * over instead of silently doing nothing.
 */
export type DeviceLinkState = 'idle' | 'starting' | 'pending' | 'expired';

type Copy = readonly [idle: string, starting: string, pending: string, expired: string, reopen: string, cancel: string, restart: string];

const copy: Readonly<Record<NextMuxDesktopLocale, Copy>> = {
    'zh-CN': ['登录后可使用余额与平台线路', '正在打开浏览器…', '请在浏览器中完成登录；登录成功后此处会自动同步。', '本次浏览器登录链接已过期，重新点击即可继续登录。', '重新打开', '取消', '重新登录'],
    'zh-TW': ['登入後可使用餘額與平台線路', '正在開啟瀏覽器…', '請在瀏覽器中完成登入；登入成功後此處會自動同步。', '本次瀏覽器登入連結已過期，重新點擊即可繼續登入。', '重新開啟', '取消', '重新登入'],
    en: ['Sign in to use your balance and platform relays', 'Opening your browser…', 'Finish signing in in your browser; NextMux will update automatically.', 'This browser sign-in link expired. Click Sign in to try again.', 'Open again', 'Cancel', 'Sign in again'],
    ja: ['サインインすると残高とプラットフォーム経路を利用できます', 'ブラウザーを開いています…', 'ブラウザーでサインインを完了してください。完了すると自動的に同期されます。', 'ブラウザーのサインインリンクの有効期限が切れました。再度クリックして続行してください。', 'もう一度開く', 'キャンセル', '再度サインイン'],
    ko: ['로그인하면 잔액과 플랫폼 경로를 사용할 수 있습니다', '브라우저를 여는 중…', '브라우저에서 로그인을 완료하세요. 완료되면 자동으로 동기화됩니다.', '이번 브라우저 로그인 링크가 만료되었습니다. 다시 클릭하여 로그인을 계속하세요.', '다시 열기', '취소', '다시 로그인'],
    es: ['Inicia sesión para usar tu saldo y las rutas de la plataforma', 'Abriendo el navegador…', 'Completa el inicio de sesión en tu navegador; NextMux se actualizará automáticamente.', 'Este enlace de inicio de sesión caducó. Haz clic de nuevo para continuar.', 'Abrir de nuevo', 'Cancelar', 'Iniciar sesión de nuevo'],
    fr: ['Connectez-vous pour utiliser votre solde et les relais de la plateforme', 'Ouverture du navigateur…', 'Terminez la connexion dans votre navigateur ; NextMux se mettra à jour automatiquement.', 'Ce lien de connexion a expiré. Cliquez à nouveau pour continuer.', 'Rouvrir', 'Annuler', 'Se reconnecter'],
    de: ['Melde dich an, um Guthaben und Plattform-Relays zu nutzen', 'Browser wird geöffnet…', 'Schließe die Anmeldung im Browser ab; NextMux aktualisiert sich automatisch.', 'Dieser Browser-Anmeldelink ist abgelaufen. Klicke erneut, um fortzufahren.', 'Erneut öffnen', 'Abbrechen', 'Erneut anmelden'],
    'pt-BR': ['Entre para usar seu saldo e as rotas da plataforma', 'Abrindo o navegador…', 'Conclua o login no navegador; o NextMux será atualizado automaticamente.', 'Este link de login expirou. Clique novamente para continuar.', 'Abrir novamente', 'Cancelar', 'Entrar novamente'],
    ru: ['Войдите, чтобы использовать баланс и маршруты платформы', 'Открываем браузер…', 'Завершите вход в браузере — NextMux обновится автоматически.', 'Срок действия ссылки для входа истёк. Нажмите снова, чтобы продолжить.', 'Открыть снова', 'Отмена', 'Войти снова'],
    ar: ['سجّل الدخول لاستخدام رصيدك ومسارات المنصة', 'جارٍ فتح المتصفح…', 'أكمل تسجيل الدخول في المتصفح؛ سيتم تحديث NextMux تلقائياً.', 'انتهت صلاحية رابط تسجيل الدخول هذا. انقر مجدداً للمتابعة.', 'فتح مجدداً', 'إلغاء', 'تسجيل الدخول مجدداً'],
    hi: ['बैलेंस और प्लेटफ़ॉर्म रूट उपयोग करने के लिए साइन इन करें', 'ब्राउज़र खोला जा रहा है…', 'अपने ब्राउज़र में साइन-इन पूरा करें; NextMux अपने-आप अपडेट हो जाएगा।', 'यह ब्राउज़र साइन-इन लिंक समाप्त हो गया है। जारी रखने के लिए फिर से क्लिक करें।', 'फिर से खोलें', 'रद्द करें', 'फिर से साइन इन करें']
};

export function deviceLinkState(input: { readonly linked: boolean; readonly starting: boolean; readonly expiresAt?: number; readonly now?: number }): DeviceLinkState {
    if (input.linked) return 'idle';
    if (input.starting) return 'starting';
    if (input.expiresAt === undefined) return 'idle';
    return Number(input.expiresAt) > (input.now ?? Date.now()) ? 'pending' : 'expired';
}

export function deviceLinkText(locale: NextMuxDesktopLocale, state: DeviceLinkState): string {
    const values = copy[locale] || copy.en;
    return state === 'starting' ? values[1] : state === 'pending' ? values[2] : state === 'expired' ? values[3] : values[0];
}

/** Actions for the signed-out account card; `signInLabel` keeps the existing "Sign in / Sign up" wording. */
export function DeviceLinkActions(props: {
    readonly locale: NextMuxDesktopLocale; readonly state: DeviceLinkState; readonly code?: string; readonly signInLabel: string;
    readonly onStart: () => void; readonly onReopen: () => void; readonly onCancel: () => void;
}): React.ReactElement {
    const values = copy[props.locale] || copy.en;
    if (props.state === 'pending') {
        return <span className='nmx-device-link-actions' data-device-link-state='pending' data-nmx-literal>
            <button type='button' onClick={props.onReopen}>{values[4]}</button>
            <button type='button' onClick={props.onCancel}>{values[5]}</button>
        </span>;
    }
    return <span className='nmx-device-link-actions' data-device-link-state={props.state} data-nmx-literal>
        <button type='button' disabled={props.state === 'starting'} aria-busy={props.state === 'starting'} onClick={props.onStart}>{props.state === 'expired' ? values[6] : props.signInLabel}</button>
    </span>;
}
