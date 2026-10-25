import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { ImeTextarea } from './nextmux-ime-field';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * The account sheet that rises from the avatar in the lower-left corner:
 * balance with top-up, feedback, settings and sign out. The gear next to the
 * avatar still opens settings directly.
 */

export const FEEDBACK_MIN_CHARS = 10;
export const FEEDBACK_MAX_CHARS = 4000;
export type FeedbackKind = 'bug' | 'suggestion' | 'partnership' | 'other';

type Key = 'menu' | 'balance' | 'topUp' | 'feedback' | 'feedbackHint' | 'settings' | 'signOut' | 'signOutConfirm' | 'signingOut' | 'signIn' | 'notSignedIn'
    | 'feedbackTitle' | 'feedbackLead' | 'bug' | 'suggestion' | 'partnership' | 'other' | 'placeholder' | 'partnershipPlaceholder' | 'emailRequired' | 'minimum' | 'counter' | 'send' | 'sending' | 'cancel'
    | 'sent' | 'sentBody' | 'close' | 'failed' | 'signInToSend';

const catalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    'zh-CN': { menu: '账户', balance: '余额', topUp: '充值', feedback: '反馈', feedbackHint: '报告问题或提出建议', settings: '设置', signOut: '退出登录', signOutConfirm: '再点一次确认退出', signingOut: '正在退出…', signIn: '登录 / 注册', notSignedIn: '未登录',
        feedbackTitle: '反馈', feedbackLead: '告诉我们哪里出了问题，或者你希望哪个功能怎么改。写清楚操作步骤和看到的现象，我们能更快处理。', bug: '问题 / Bug', suggestion: '功能建议', partnership: '合作', other: '其他',
        placeholder: '我希望……', partnershipPlaceholder: '请留下您的有效联系邮箱，并详细说明合作方向（如模型接入、渠道推广、定制开发或商务合作等）…', emailRequired: '请包含有效联系邮箱',
        minimum: '至少 {min} 个字', counter: '{count} / {max}', send: '发送反馈', sending: '正在发送…', cancel: '取消',
        sent: '感谢你的反馈', sentBody: '我们已经收到，会尽快查看。', close: '关闭', failed: '发送失败：{error}', signInToSend: '登录后才能发送反馈。' },
    'zh-TW': { menu: '帳戶', balance: '餘額', topUp: '儲值', feedback: '意見回饋', feedbackHint: '回報問題或提出建議', settings: '設定', signOut: '登出', signOutConfirm: '再點一次確認登出', signingOut: '正在登出…', signIn: '登入 / 註冊', notSignedIn: '未登入',
        feedbackTitle: '意見回饋', feedbackLead: '告訴我們哪裡出了問題，或你希望哪個功能怎麼改。寫清楚操作步驟和看到的現象，我們能更快處理。', bug: '問題 / Bug', suggestion: '功能建議', partnership: '合作', other: '其他',
        placeholder: '我希望……', partnershipPlaceholder: '請留下您的有效聯絡信箱，並詳細說明合作方向（如模型接入、管道推廣、客製化開發或商務合作等）…', emailRequired: '請包含有效聯絡信箱',
        minimum: '至少 {min} 個字', counter: '{count} / {max}', send: '送出回饋', sending: '正在送出…', cancel: '取消',
        sent: '感謝你的回饋', sentBody: '我們已經收到，會盡快查看。', close: '關閉', failed: '送出失敗：{error}', signInToSend: '登入後才能送出回饋。' },
    en: { menu: 'Account', balance: 'Balance', topUp: 'Top up', feedback: 'Feedback', feedbackHint: 'Report a bug or suggest a change', settings: 'Settings', signOut: 'Sign out', signOutConfirm: 'Click again to sign out', signingOut: 'Signing out…', signIn: 'Sign in / Sign up', notSignedIn: 'Not signed in',
        feedbackTitle: 'Send feedback', feedbackLead: 'Tell us what went wrong or what you would like changed. Steps and what you saw help us act faster.', bug: 'Bug', suggestion: 'Suggestion', partnership: 'Partnership', other: 'Other',
        placeholder: 'I would like…', partnershipPlaceholder: 'Please leave a valid contact email and describe how you would like to collaborate…', emailRequired: 'Include a valid contact email',
        minimum: 'At least {min} characters', counter: '{count} / {max}', send: 'Send feedback', sending: 'Sending…', cancel: 'Cancel',
        sent: 'Thanks for your feedback', sentBody: 'We received it and will look at it soon.', close: 'Close', failed: 'Couldn’t send: {error}', signInToSend: 'Sign in to send feedback.' },
    ja: { menu: 'アカウント', balance: '残高', topUp: 'チャージ', feedback: 'フィードバック', feedbackHint: '不具合の報告や改善の提案', settings: '設定', signOut: 'サインアウト', signOutConfirm: 'もう一度クリックでサインアウト', signingOut: 'サインアウト中…', signIn: 'サインイン / 登録', notSignedIn: '未サインイン',
        feedbackTitle: 'フィードバック', feedbackLead: '問題点や、変えてほしい機能を教えてください。手順と起きたことを書いていただくと早く対応できます。', bug: '不具合', suggestion: '機能の提案', partnership: '提携・協力', other: 'その他',
        placeholder: 'こうしてほしい…', partnershipPlaceholder: '連絡先メールアドレスと、ご希望の提携・協力内容を記入してください…', emailRequired: '有効なメールアドレスを入力してください',
        minimum: '{min} 文字以上', counter: '{count} / {max}', send: '送信', sending: '送信中…', cancel: 'キャンセル',
        sent: 'ありがとうございます', sentBody: '受け取りました。できるだけ早く確認します。', close: '閉じる', failed: '送信できませんでした：{error}', signInToSend: '送信するにはサインインしてください。' },
    ko: { menu: '계정', balance: '잔액', topUp: '충전', feedback: '피드백', feedbackHint: '버그 신고 또는 개선 제안', settings: '설정', signOut: '로그아웃', signOutConfirm: '한 번 더 클릭하면 로그아웃', signingOut: '로그아웃 중…', signIn: '로그인 / 가입', notSignedIn: '로그인 안 됨',
        feedbackTitle: '피드백 보내기', feedbackLead: '문제가 된 부분이나 바뀌었으면 하는 기능을 알려 주세요. 재현 단계와 본 현상을 적어 주시면 더 빨리 처리할 수 있습니다.', bug: '버그', suggestion: '기능 제안', partnership: '제휴/협력', other: '기타',
        placeholder: '이렇게 되면 좋겠어요…', partnershipPlaceholder: '유효한 연락처 이메일과 희망하는 협력 방향을 적어 주세요…', emailRequired: '유효한 이메일 주소를 포함해 주세요',
        minimum: '최소 {min}자', counter: '{count} / {max}', send: '보내기', sending: '보내는 중…', cancel: '취소',
        sent: '피드백 감사합니다', sentBody: '잘 받았습니다. 곧 확인하겠습니다.', close: '닫기', failed: '보내지 못했습니다: {error}', signInToSend: '피드백을 보내려면 로그인하세요.' },
    es: { menu: 'Cuenta', balance: 'Saldo', topUp: 'Recargar', feedback: 'Comentarios', feedbackHint: 'Informa de un error o sugiere un cambio', settings: 'Ajustes', signOut: 'Cerrar sesión', signOutConfirm: 'Pulsa otra vez para salir', signingOut: 'Cerrando sesión…', signIn: 'Iniciar sesión / Registrarse', notSignedIn: 'Sin sesión',
        feedbackTitle: 'Enviar comentarios', feedbackLead: 'Cuéntanos qué falló o qué te gustaría cambiar. Los pasos y lo que viste nos ayudan a actuar antes.', bug: 'Error', suggestion: 'Sugerencia', partnership: 'Colaboración', other: 'Otro',
        placeholder: 'Me gustaría…', partnershipPlaceholder: 'Deja un correo electrónico válido y explica la dirección de colaboración…', emailRequired: 'Incluye un correo electrónico válido',
        minimum: 'Al menos {min} caracteres', counter: '{count} / {max}', send: 'Enviar', sending: 'Enviando…', cancel: 'Cancelar',
        sent: 'Gracias por tus comentarios', sentBody: 'Los recibimos y los revisaremos pronto.', close: 'Cerrar', failed: 'No se pudo enviar: {error}', signInToSend: 'Inicia sesión para enviar comentarios.' },
    fr: { menu: 'Compte', balance: 'Solde', topUp: 'Recharger', feedback: 'Commentaires', feedbackHint: 'Signaler un bug ou proposer une amélioration', settings: 'Paramètres', signOut: 'Se déconnecter', signOutConfirm: 'Cliquez encore pour vous déconnecter', signingOut: 'Déconnexion…', signIn: 'Se connecter / S’inscrire', notSignedIn: 'Non connecté',
        feedbackTitle: 'Envoyer un commentaire', feedbackLead: 'Dites-nous ce qui ne va pas ou ce que vous aimeriez changer. Les étapes et ce que vous avez vu nous aident à agir plus vite.', bug: 'Bug', suggestion: 'Suggestion', partnership: 'Partenariat', other: 'Autre',
        placeholder: 'J’aimerais…', partnershipPlaceholder: 'Veuillez laisser une adresse e-mail valide et préciser le partenariat souhaité…', emailRequired: 'Incluez une adresse e-mail valide',
        minimum: 'Au moins {min} caractères', counter: '{count} / {max}', send: 'Envoyer', sending: 'Envoi…', cancel: 'Annuler',
        sent: 'Merci pour votre retour', sentBody: 'Nous l’avons reçu et l’examinerons bientôt.', close: 'Fermer', failed: 'Envoi impossible : {error}', signInToSend: 'Connectez-vous pour envoyer un commentaire.' },
    de: { menu: 'Konto', balance: 'Guthaben', topUp: 'Aufladen', feedback: 'Feedback', feedbackHint: 'Fehler melden oder Änderung vorschlagen', settings: 'Einstellungen', signOut: 'Abmelden', signOutConfirm: 'Zum Abmelden erneut klicken', signingOut: 'Abmeldung…', signIn: 'Anmelden / Registrieren', notSignedIn: 'Nicht angemeldet',
        feedbackTitle: 'Feedback senden', feedbackLead: 'Sagen Sie uns, was nicht funktioniert oder was Sie ändern möchten. Schritte und Beobachtungen helfen uns, schneller zu reagieren.', bug: 'Fehler', suggestion: 'Vorschlag', partnership: 'Kooperation', other: 'Sonstiges',
        placeholder: 'Ich wünsche mir…', partnershipPlaceholder: 'Bitte geben Sie eine gültige E-Mail-Adresse an und beschreiben Sie die gewünschte Zusammenarbeit…', emailRequired: 'Gültige E-Mail-Adresse erforderlich',
        minimum: 'Mindestens {min} Zeichen', counter: '{count} / {max}', send: 'Senden', sending: 'Wird gesendet…', cancel: 'Abbrechen',
        sent: 'Danke für Ihr Feedback', sentBody: 'Wir haben es erhalten und sehen es uns bald an.', close: 'Schließen', failed: 'Senden fehlgeschlagen: {error}', signInToSend: 'Melden Sie sich an, um Feedback zu senden.' },
    'pt-BR': { menu: 'Conta', balance: 'Saldo', topUp: 'Recarregar', feedback: 'Feedback', feedbackHint: 'Relatar um bug ou sugerir uma mudança', settings: 'Configurações', signOut: 'Sair', signOutConfirm: 'Clique de novo para sair', signingOut: 'Saindo…', signIn: 'Entrar / Cadastrar', notSignedIn: 'Não conectado',
        feedbackTitle: 'Enviar feedback', feedbackLead: 'Conte o que deu errado ou o que você gostaria de mudar. Passos e o que você viu nos ajudam a agir mais rápido.', bug: 'Bug', suggestion: 'Sugestão', partnership: 'Parceria', other: 'Outro',
        placeholder: 'Eu gostaria…', partnershipPlaceholder: 'Deixe um e-mail de contato válido e descreva a direção da parceria…', emailRequired: 'Inclua um e-mail válido',
        minimum: 'Pelo menos {min} caracteres', counter: '{count} / {max}', send: 'Enviar', sending: 'Enviando…', cancel: 'Cancelar',
        sent: 'Obrigado pelo feedback', sentBody: 'Recebemos e vamos analisar em breve.', close: 'Fechar', failed: 'Não foi possível enviar: {error}', signInToSend: 'Entre para enviar feedback.' },
    ru: { menu: 'Аккаунт', balance: 'Баланс', topUp: 'Пополнить', feedback: 'Отзыв', feedbackHint: 'Сообщить об ошибке или предложить улучшение', settings: 'Настройки', signOut: 'Выйти', signOutConfirm: 'Нажмите ещё раз, чтобы выйти', signingOut: 'Выход…', signIn: 'Войти / Зарегистрироваться', notSignedIn: 'Вход не выполнен',
        feedbackTitle: 'Отправить отзыв', feedbackLead: 'Расскажите, что не так или что хотелось бы изменить. Шаги и то, что вы увидели, помогут нам быстрее разобраться.', bug: 'Ошибка', suggestion: 'Предложение', partnership: 'Сотрудничество', other: 'Другое',
        placeholder: 'Хотелось бы…', partnershipPlaceholder: 'Укажите действующий email для связи и опишите направление сотрудничества…', emailRequired: 'Укажите действующий email',
        minimum: 'Не менее {min} символов', counter: '{count} / {max}', send: 'Отправить', sending: 'Отправка…', cancel: 'Отмена',
        sent: 'Спасибо за отзыв', sentBody: 'Мы получили его и скоро посмотрим.', close: 'Закрыть', failed: 'Не удалось отправить: {error}', signInToSend: 'Войдите, чтобы отправить отзыв.' },
    ar: { menu: 'الحساب', balance: 'الرصيد', topUp: 'اشحن', feedback: 'ملاحظات', feedbackHint: 'أبلغ عن خلل أو اقترح تحسينًا', settings: 'الإعدادات', signOut: 'تسجيل الخروج', signOutConfirm: 'انقر مرة أخرى لتسجيل الخروج', signingOut: 'جارٍ تسجيل الخروج…', signIn: 'تسجيل الدخول / إنشاء حساب', notSignedIn: 'لم يتم تسجيل الدخول',
        feedbackTitle: 'إرسال ملاحظات', feedbackLead: 'أخبرنا بما حدث من خطأ أو بما تود تغييره. خطوات إعادة المشكلة وما رأيته يساعداننا على التصرف أسرع.', bug: 'خلل', suggestion: 'اقتراح', partnership: 'شراكة', other: 'أخرى',
        placeholder: 'أودّ أن…', partnershipPlaceholder: 'يرجى ترك بريد إلكتروني صالح للتواصل وتوضيح مجال التعاون المطلوب…', emailRequired: 'يرجى تضمين بريد إلكتروني صالح',
        minimum: '{min} أحرف على الأقل', counter: '{count} / {max}', send: 'إرسال', sending: 'جارٍ الإرسال…', cancel: 'إلغاء',
        sent: 'شكرًا على ملاحظاتك', sentBody: 'استلمناها وسنراجعها قريبًا.', close: 'إغلاق', failed: 'تعذّر الإرسال: {error}', signInToSend: 'سجّل الدخول لإرسال الملاحظات.' },
    hi: { menu: 'खाता', balance: 'बैलेंस', topUp: 'टॉप अप', feedback: 'फ़ीडबैक', feedbackHint: 'बग बताएँ या बदलाव सुझाएँ', settings: 'सेटिंग्स', signOut: 'साइन आउट', signOutConfirm: 'साइन आउट के लिए फिर क्लिक करें', signingOut: 'साइन आउट हो रहा है…', signIn: 'साइन इन / साइन अप', notSignedIn: 'साइन इन नहीं',
        feedbackTitle: 'फ़ीडबैक भेजें', feedbackLead: 'बताएँ क्या गड़बड़ हुआ या आप क्या बदलना चाहते हैं। चरण और आपने क्या देखा, यह लिखने से हम जल्दी सुधार पाते हैं।', bug: 'बग', suggestion: 'सुझाव', partnership: 'साझेदारी', other: 'अन्य',
        placeholder: 'मैं चाहता/चाहती हूँ…', partnershipPlaceholder: 'कृपया अपना मान्य संपर्क ईमेल लिखें और सहयोग की दिशा बताएँ…', emailRequired: 'मान्य ईमेल पता शामिल करें',
        minimum: 'कम से कम {min} अक्षर', counter: '{count} / {max}', send: 'भेजें', sending: 'भेजा जा रहा है…', cancel: 'रद्द करें',
        sent: 'फ़ीडबैक के लिए धन्यवाद', sentBody: 'हमें मिल गया है, हम जल्द देखेंगे।', close: 'बंद करें', failed: 'भेजा नहीं जा सका: {error}', signInToSend: 'फ़ीडबैक भेजने के लिए साइन इन करें।' }
};

function uncheckedAccountMenuText(locale: NextMuxDesktopLocale, key: Key, values: Readonly<Record<string, string | number>> = {}): string {
    return (catalog[locale] || catalog.en)[key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name]));
}

/** Characters as a person counts them (a Chinese character or an emoji is one). */
export function feedbackLength(text: string): number {
    return [...text.trim()].length;
}

/** Whether the feedback text includes a valid email address (required for partnership inquiries). */
export function hasValidFeedbackEmail(text: string): boolean {
    return /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/u.test(text);
}

export interface AccountMenuProps {
    readonly locale: NextMuxDesktopLocale;
    readonly linked: boolean;
    readonly identity: string;
    readonly email?: string;
    readonly balance?: string;
    readonly signOutArmed: boolean;
    readonly signingOut: boolean;
    readonly onTopUp: () => void;
    readonly onFeedback: () => void;
    readonly onSettings: () => void;
    readonly onSignOut: () => void;
    readonly onSignIn: () => void;
}

export function AccountMenu(props: AccountMenuProps): React.ReactElement {
    const t = (key: Key): string => accountMenuText(props.locale, key);
    return <section className='nmx-account-sheet' role='menu' aria-label={t('menu')}>
        <header>
            <span className={`nmx-account-sheet-avatar ${props.linked ? 'is-linked' : ''}`} aria-hidden='true'>{props.linked ? props.identity.slice(0, 1).toUpperCase() : <i className='codicon codicon-account'></i>}</span>
            <div><strong data-nmx-literal title={props.identity}>{props.identity}</strong>{props.email && props.email !== props.identity && <small data-nmx-literal title={props.email}>{props.email}</small>}</div>
        </header>
        {props.linked
            ? <div className='nmx-account-sheet-balance' role='none'>
                <span><small>{t('balance')}</small><strong data-nmx-literal>{props.balance || '—'}</strong></span>
                <button type='button' role='menuitem' className='nmx-account-sheet-topup' onClick={props.onTopUp}>{t('topUp')}</button>
            </div>
            : <button type='button' role='menuitem' className='nmx-account-sheet-signin' onClick={props.onSignIn}><i className='codicon codicon-sign-in'></i><span>{t('signIn')}</span></button>}
        <button type='button' role='menuitem' disabled={!props.linked} title={props.linked ? undefined : t('signInToSend')} onClick={props.onFeedback}>
            <i className='codicon codicon-feedback'></i><span><strong>{t('feedback')}</strong><small>{t('feedbackHint')}</small></span></button>
        <button type='button' role='menuitem' onClick={props.onSettings}><i className='codicon codicon-settings-gear'></i><span><strong>{t('settings')}</strong></span></button>
        {props.linked && <button type='button' role='menuitem' className={`nmx-account-sheet-signout ${props.signOutArmed ? 'is-armed' : ''}`} disabled={props.signingOut} onClick={props.onSignOut}>
            <i className={`codicon codicon-${props.signingOut ? 'loading codicon-modifier-spin' : 'sign-out'}`}></i>
            <span><strong>{props.signingOut ? t('signingOut') : props.signOutArmed ? t('signOutConfirm') : t('signOut')}</strong></span></button>}
    </section>;
}

export interface FeedbackDialogProps {
    readonly locale: NextMuxDesktopLocale;
    readonly kind: FeedbackKind;
    readonly text: string;
    readonly status: 'editing' | 'sending' | 'sent';
    readonly error: string;
    readonly onKind: (kind: FeedbackKind) => void;
    readonly onText: (text: string) => void;
    readonly onSend: () => void;
    readonly onClose: () => void;
}

export function FeedbackDialog(props: FeedbackDialogProps): React.ReactElement {
    const t = (key: Key, values?: Readonly<Record<string, string | number>>): string => accountMenuText(props.locale, key, values);
    const count = feedbackLength(props.text);
    const tooShort = count < FEEDBACK_MIN_CHARS;
    const tooLong = count > FEEDBACK_MAX_CHARS;
    const missingEmail = props.kind === 'partnership' && !hasValidFeedbackEmail(props.text);
    const sending = props.status === 'sending';
    const keyDown = (event: React.KeyboardEvent): void => {
        if (event.key === 'Escape' && !sending) { event.preventDefault(); event.stopPropagation(); props.onClose(); }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !tooShort && !tooLong && !missingEmail && !sending && props.status === 'editing') { event.preventDefault(); props.onSend(); }
    };
    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop' onMouseDown={() => { if (!sending) props.onClose(); }}>
        <section className='nmx-permission-sheet nmx-feedback-sheet' role='dialog' aria-modal='true' aria-labelledby='nmx-feedback-title' onMouseDown={event => event.stopPropagation()} onKeyDown={keyDown}>
            {props.status === 'sent'
                ? <div className='nmx-feedback-sent' role='status'>
                    <i className='codicon codicon-pass-filled' aria-hidden='true'></i>
                    <h2 id='nmx-feedback-title'>{t('sent')}</h2><p>{t('sentBody')}</p>
                    <footer><button className='nmx-primary-button' autoFocus onClick={props.onClose}>{t('close')}</button></footer>
                </div>
                : <>
                    <header><div><h2 id='nmx-feedback-title'>{t('feedbackTitle')}</h2><p>{t('feedbackLead')}</p></div>
                        <button aria-label={t('cancel')} disabled={sending} onClick={props.onClose}>×</button></header>
                    <div className='nmx-feedback-kinds' role='radiogroup' aria-label={t('feedbackTitle')}>
                        {(['bug', 'suggestion', 'partnership', 'other'] as const).map(kind => <button key={kind} type='button' role='radio' aria-checked={props.kind === kind}
                            className={props.kind === kind ? 'is-active' : ''} disabled={sending} onClick={() => props.onKind(kind)}>{t(kind)}</button>)}
                    </div>
                    <ImeTextarea autoFocus rows={7} value={props.text} disabled={sending} placeholder={props.kind === 'partnership' ? t('partnershipPlaceholder') : t('placeholder')} aria-describedby='nmx-feedback-count'
                        onChange={event => props.onText(event.currentTarget.value)} />
                    <div className='nmx-feedback-meta'>
                        <small className={(tooShort || missingEmail) && count > 0 ? 'is-warning' : ''}>{t('minimum', { min: FEEDBACK_MIN_CHARS })}{props.kind === 'partnership' ? ` · ${t('emailRequired')}` : ''}</small>
                        <small id='nmx-feedback-count' className={tooLong ? 'is-error' : ''} data-nmx-literal>{t('counter', { count, max: FEEDBACK_MAX_CHARS })}</small>
                    </div>
                    {props.error && <div className='nmx-agent-inline-error' role='alert'>{t('failed', { error: props.error })}</div>}
                    <footer>
                        <button className='nmx-secondary-button' disabled={sending} onClick={props.onClose}>{t('cancel')}</button>
                        <button className='nmx-primary-button' disabled={sending || tooShort || tooLong || missingEmail} onClick={props.onSend}>{sending ? t('sending') : t('send')}</button>
                    </footer>
                </>}
        </section>
    </div>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function accountMenuText(locale: Parameters<typeof uncheckedAccountMenuText>[0], key: Parameters<typeof uncheckedAccountMenuText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedAccountMenuText>>): string {
    return totalCopy(locale, key, language => uncheckedAccountMenuText(language, key, ...rest));
}
