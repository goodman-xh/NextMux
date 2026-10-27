import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Keeps one broken panel from taking the whole app down. Without a boundary, an error while rendering any sheet,
 * drawer or page unmounts the entire NextMux widget and leaves a blank window with nothing to click. A guarded part
 * is rendered through <Deferred> so that errors in the widget's own render methods are caught here as well.
 */

type Copy = readonly [title: string, body: string, retry: string, close: string];
const COPY: Readonly<Record<NextMuxDesktopLocale, Copy>> = {
    'zh-CN': ['这里出了点问题', '这个部分遇到错误，已停止显示；其他功能不受影响。可以关闭或重试。', '重试', '关闭'],
    'zh-TW': ['這裡出了點問題', '這個部分遇到錯誤，已停止顯示；其他功能不受影響。可以關閉或重試。', '重試', '關閉'],
    en: ['Something went wrong here', 'This part hit an error and stopped showing; everything else still works. Close it or try again.', 'Try again', 'Close'],
    ja: ['ここで問題が発生しました', 'この部分でエラーが起きたため表示を止めました。ほかの機能はそのまま使えます。閉じるか再試行してください。', '再試行', '閉じる'],
    ko: ['여기서 문제가 발생했습니다', '이 부분에서 오류가 나서 표시를 멈췄습니다. 다른 기능은 그대로 쓸 수 있습니다. 닫거나 다시 시도하세요.', '다시 시도', '닫기'],
    es: ['Algo salió mal aquí', 'Esta parte tuvo un error y dejó de mostrarse; lo demás sigue funcionando. Ciérrala o vuelve a intentarlo.', 'Reintentar', 'Cerrar'],
    fr: ['Un problème est survenu ici', 'Cette partie a rencontré une erreur et n’est plus affichée ; le reste fonctionne. Fermez-la ou réessayez.', 'Réessayer', 'Fermer'],
    de: ['Hier ist etwas schiefgelaufen', 'Dieser Teil hatte einen Fehler und wird nicht mehr angezeigt; alles andere funktioniert weiter. Schließe ihn oder versuche es erneut.', 'Erneut versuchen', 'Schließen'],
    'pt-BR': ['Algo deu errado aqui', 'Esta parte teve um erro e deixou de aparecer; o restante continua funcionando. Feche ou tente de novo.', 'Tentar de novo', 'Fechar'],
    ru: ['Здесь произошла ошибка', 'В этой части произошла ошибка, и она скрыта; остальное работает. Закройте её или повторите попытку.', 'Повторить', 'Закрыть'],
    ar: ['حدث خطأ هنا', 'واجه هذا الجزء خطأ فتوقف عرضه؛ بقية الميزات تعمل. أغلقه أو أعد المحاولة.', 'إعادة المحاولة', 'إغلاق'],
    hi: ['यहाँ कुछ गड़बड़ हो गई', 'इस हिस्से में त्रुटि आई और इसे दिखाना बंद कर दिया गया; बाकी सब काम कर रहा है। इसे बंद करें या फिर कोशिश करें।', 'फिर कोशिश करें', 'बंद करें']
};

export function panelBoundaryText(locale: NextMuxDesktopLocale): Copy {
    return COPY[locale] || COPY.en;
}

/** Renders a widget render method as its own component, so its errors reach the surrounding boundary. */
function Deferred(props: { readonly render: () => React.ReactNode }): React.ReactElement {
    return <>{props.render()}</>;
}

interface Props {
    readonly name: string;
    readonly locale: NextMuxDesktopLocale;
    /** overlay: a closable card over the app; section: an inline card in place of the page. */
    readonly variant: 'overlay' | 'section';
    /** Closes whatever opened the broken part (its open flag), so it does not break again at once. */
    readonly onDismiss?: () => void;
    readonly render: () => React.ReactNode;
}

export class PanelBoundary extends React.Component<Props, { error?: Error }> {
    override state: { error?: Error } = {};

    static getDerivedStateFromError(error: Error): { error: Error } {
        return { error };
    }

    override componentDidCatch(error: Error, info: React.ErrorInfo): void {
        console.error(`[nextmux] ${this.props.name} failed to render`, error, info.componentStack);
    }

    protected reset = (): void => this.setState({ error: undefined });

    override render(): React.ReactNode {
        if (!this.state.error) return <Deferred render={this.props.render} />;
        const [title, body, retry, close] = panelBoundaryText(this.props.locale);
        const dismiss = (): void => { this.props.onDismiss?.(); this.reset(); };
        return <div className={`nmx-panel-crash is-${this.props.variant}`} role='alert' data-nmx-panel={this.props.name}>
            <i className='codicon codicon-warning' aria-hidden='true'></i>
            <div><strong>{title}</strong><p>{body}</p></div>
            <div className='nmx-panel-crash-actions'>
                {this.props.onDismiss && <button type='button' onClick={dismiss}>{close}</button>}
                <button type='button' className='is-primary' onClick={this.reset}>{retry}</button>
            </div>
        </div>;
    }
}
