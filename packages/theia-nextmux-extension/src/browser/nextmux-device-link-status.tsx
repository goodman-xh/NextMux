import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Visible state of the browser sign-in (device link) flow. Mirrors the
 * device-authorization UX of GitHub CLI / Codex: while the browser is open the
 * app says so, shows the one-time code the web page displays, and offers
 * "Open again" and "Cancel"; an expired code asks the user to start over
 * instead of silently doing nothing.
 */
export type DeviceLinkState = 'idle' | 'starting' | 'pending' | 'expired';

type Copy = readonly [idle: string, starting: string, pending: string, expired: string, code: string, reopen: string, cancel: string, restart: string];

const copy: Readonly<Record<NextMuxDesktopLocale, Copy>> = {
    'zh-CN': ['登录后可使用余额与平台线路', '正在打开浏览器…', '请在浏览器中确认登录', '登录链接已过期，请重新登录', '验证码', '重新打开', '取消', '重新登录'],
    'zh-TW': ['登入後可使用餘額與平台線路', '正在開啟瀏覽器…', '請在瀏覽器中確認登入', '登入連結已過期，請重新登入', '驗證碼', '重新開啟', '取消', '重新登入'],
    en: ['Sign in to use your balance and platform relays', 'Opening your browser…', 'Confirm the sign-in in your browser', 'The sign-in link expired. Sign in again.', 'Code', 'Open again', 'Cancel', 'Sign in again'],
    ja: ['サインインすると残高とプラットフォーム経路を利用できます', 'ブラウザーを開いています…', 'ブラウザーでサインインを確認してください', 'サインインリンクの有効期限が切れました。もう一度サインインしてください', 'コード', 'もう一度開く', 'キャンセル', '再度サインイン'],
    ko: ['로그인하면 잔액과 플랫폼 경로를 사용할 수 있습니다', '브라우저를 여는 중…', '브라우저에서 로그인을 확인하세요', '로그인 링크가 만료되었습니다. 다시 로그인하세요', '코드', '다시 열기', '취소', '다시 로그인'],
    es: ['Inicia sesión para usar tu saldo y las rutas de la plataforma', 'Abriendo el navegador…', 'Confirma el inicio de sesión en el navegador', 'El enlace caducó. Vuelve a iniciar sesión.', 'Código', 'Abrir de nuevo', 'Cancelar', 'Iniciar sesión de nuevo'],
    fr: ['Connectez-vous pour utiliser votre solde et les relais de la plateforme', 'Ouverture du navigateur…', 'Confirmez la connexion dans votre navigateur', 'Le lien a expiré. Reconnectez-vous.', 'Code', 'Rouvrir', 'Annuler', 'Se reconnecter'],
    de: ['Melde dich an, um Guthaben und Plattform-Relays zu nutzen', 'Browser wird geöffnet…', 'Bestätige die Anmeldung im Browser', 'Der Anmeldelink ist abgelaufen. Bitte erneut anmelden.', 'Code', 'Erneut öffnen', 'Abbrechen', 'Erneut anmelden'],
    'pt-BR': ['Entre para usar seu saldo e as rotas da plataforma', 'Abrindo o navegador…', 'Confirme o login no navegador', 'O link expirou. Entre novamente.', 'Código', 'Abrir novamente', 'Cancelar', 'Entrar novamente'],
    ru: ['Войдите, чтобы использовать баланс и маршруты платформы', 'Открываем браузер…', 'Подтвердите вход в браузере', 'Ссылка для входа истекла. Войдите снова.', 'Код', 'Открыть снова', 'Отмена', 'Войти снова'],
    ar: ['سجّل الدخول لاستخدام رصيدك ومسارات المنصة', 'جارٍ فتح المتصفح…', 'أكّد تسجيل الدخول في المتصفح', 'انتهت صلاحية رابط تسجيل الدخول. سجّل الدخول مجدداً.', 'الرمز', 'فتح مجدداً', 'إلغاء', 'تسجيل الدخول مجدداً'],
    hi: ['बैलेंस और प्लेटफ़ॉर्म रूट उपयोग करने के लिए साइन इन करें', 'ब्राउज़र खोला जा रहा है…', 'ब्राउज़र में साइन-इन की पुष्टि करें', 'साइन-इन लिंक की अवधि समाप्त हो गई। फिर से साइन इन करें।', 'कोड', 'फिर से खोलें', 'रद्द करें', 'फिर से साइन इन करें']
};

export function deviceLinkState(input: { readonly linked: boolean; readonly starting: boolean; readonly expiresAt?: number; readonly now?: number }): DeviceLinkState {
    if (input.linked) return 'idle';
    if (input.starting) return 'starting';
    if (input.expiresAt === undefined) return 'idle';
    return Number(input.expiresAt) > (input.now ?? Date.now()) ? 'pending' : 'expired';
}

export function deviceLinkText(locale: NextMuxDesktopLocale, state: DeviceLinkState): string {
    const values = copy[locale];
    return state === 'starting' ? values[1] : state === 'pending' ? values[2] : state === 'expired' ? values[3] : values[0];
}

/** Actions for the signed-out account card; `signInLabel` keeps the existing "Sign in / Sign up" wording. */
export function DeviceLinkActions(props: {
    readonly locale: NextMuxDesktopLocale; readonly state: DeviceLinkState; readonly code?: string; readonly signInLabel: string;
    readonly onStart: () => void; readonly onReopen: () => void; readonly onCancel: () => void;
}): React.ReactElement {
    const values = copy[props.locale];
    if (props.state === 'pending') {
        return <span className='nmx-device-link-actions' data-device-link-state='pending' data-nmx-literal>
            {props.code && <span className='nmx-device-link-code' title={values[4]}><small>{values[4]}</small><bdi dir='ltr'>{props.code}</bdi></span>}
            <button type='button' onClick={props.onReopen}>{values[5]}</button>
            <button type='button' onClick={props.onCancel}>{values[6]}</button>
        </span>;
    }
    return <span className='nmx-device-link-actions' data-device-link-state={props.state} data-nmx-literal>
        <button type='button' disabled={props.state === 'starting'} aria-busy={props.state === 'starting'} onClick={props.onStart}>{props.state === 'expired' ? values[7] : props.signInLabel}</button>
    </span>;
}
