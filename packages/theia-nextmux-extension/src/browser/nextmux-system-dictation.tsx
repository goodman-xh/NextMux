import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { NativeDictationPhase } from './nextmux-native-dictation-adapter';
import { nativeDictationText } from './nextmux-native-dictation-copy';

export const systemDictationCopy: Readonly<Record<NextMuxDesktopLocale, readonly [string, string, string, string, string, string, string, string]>> = {
    'zh-CN': ['系统听写', '按 Win + H 开始系统听写。', '使用系统设置中的听写快捷键。', '使用系统或输入法的听写快捷键。', '先用系统快捷键停止听写，再退出；系统可能联网，遵循系统隐私设置。', '当前没有可编辑的答复框。', '听写输入 · 点击发送', '退出听写输入'],
    'zh-TW': ['系統聽寫', '按 Win + H 開始系統聽寫。', '使用系統設定中的聽寫快捷鍵。', '使用系統或輸入法的聽寫快捷鍵。', '先用系統快捷鍵停止聽寫，再退出；系統可能連網，依系統隱私設定處理。', '目前沒有可編輯的答覆框。', '聽寫輸入 · 點擊傳送', '退出聽寫輸入'],
    en: ['System dictation', 'Press Win + H to start system dictation.', 'Use the dictation shortcut configured in system settings.', 'Use your system or input method’s dictation shortcut.', 'Stop dictation with the system shortcut before exiting. Your OS may use online recognition under its privacy settings.', 'No editable reply field is available.', 'Dictation input · click Send', 'Exit dictation input'],
    ja: ['システム音声入力', 'Win + H でシステム音声入力を開始します。', 'システム設定の音声入力ショートカットを使います。', 'システムまたは入力方式の音声入力ショートカットを使います。', '終了前にシステムのショートカットで音声入力を停止してください。OS のプライバシー設定によりオンライン認識が使われる場合があります。', '編集できる回答欄がありません。', '音声入力 · ボタンで送信', '音声入力を終了'],
    ko: ['시스템 받아쓰기', 'Win + H로 시스템 받아쓰기를 시작하세요.', '시스템 설정에 지정된 받아쓰기 단축키를 사용하세요.', '시스템 또는 입력기의 받아쓰기 단축키를 사용하세요.', '나가기 전에 시스템 단축키로 받아쓰기를 중지하세요. OS 개인정보 설정에 따라 온라인 인식을 사용할 수 있습니다.', '편집 가능한 답변 입력란이 없습니다.', '받아쓰기 입력 · 전송 클릭', '받아쓰기 입력 종료'],
    es: ['Dictado del sistema', 'Pulsa Win + H para iniciar el dictado.', 'Usa el atajo de dictado configurado en el sistema.', 'Usa el atajo de dictado del sistema o método de entrada.', 'Detén el dictado con el atajo del sistema antes de salir. El sistema puede usar reconocimiento en línea según sus ajustes de privacidad.', 'No hay un campo de respuesta editable.', 'Dictado · pulsa Enviar', 'Salir del dictado'],
    fr: ['Dictée système', 'Appuyez sur Win + H pour démarrer la dictée.', 'Utilisez le raccourci de dictée configuré dans le système.', 'Utilisez le raccourci de dictée du système ou de la méthode de saisie.', 'Arrêtez la dictée avec le raccourci système avant de quitter. Le système peut utiliser la reconnaissance en ligne selon ses réglages de confidentialité.', 'Aucun champ de réponse modifiable.', 'Dictée · cliquez sur Envoyer', 'Quitter la saisie dictée'],
    de: ['Systemdiktat', 'Win + H startet das Systemdiktat.', 'Nutze den in den Systemeinstellungen festgelegten Diktatkurzbefehl.', 'Nutze den Diktatkurzbefehl des Systems oder der Eingabemethode.', 'Stoppe das Diktat vor dem Verlassen mit dem Systemkurzbefehl. Das System kann gemäß seinen Datenschutzeinstellungen Online-Erkennung verwenden.', 'Kein bearbeitbares Antwortfeld verfügbar.', 'Diktateingabe · zum Senden klicken', 'Diktateingabe verlassen'],
    'pt-BR': ['Ditado do sistema', 'Pressione Win + H para iniciar o ditado.', 'Use o atalho de ditado definido nas configurações do sistema.', 'Use o atalho de ditado do sistema ou método de entrada.', 'Pare o ditado com o atalho do sistema antes de sair. O sistema pode usar reconhecimento on-line conforme suas configurações de privacidade.', 'Não há campo de resposta editável.', 'Ditado · clique em Enviar', 'Sair da entrada por ditado'],
    ru: ['Системный диктант', 'Нажмите Win + H для запуска диктанта.', 'Используйте сочетание для диктанта из настроек системы.', 'Используйте сочетание для диктанта системы или метода ввода.', 'Перед выходом остановите диктант системным сочетанием клавиш. Система может использовать онлайн-распознавание согласно настройкам приватности.', 'Нет доступного поля для редактирования ответа.', 'Диктант · нажмите «Отправить»', 'Выйти из ввода под диктовку'],
    ar: ['الإملاء عبر النظام', 'اضغط Win + H لبدء الإملاء.', 'استخدم اختصار الإملاء المحدد في إعدادات النظام.', 'استخدم اختصار الإملاء للنظام أو أسلوب الإدخال.', 'أوقف الإملاء باختصار النظام قبل الخروج. قد يستخدم النظام التعرف عبر الإنترنت وفق إعدادات الخصوصية.', 'لا يوجد حقل رد قابل للتحرير.', 'إدخال بالإملاء · اضغط إرسال', 'الخروج من إدخال الإملاء'],
    hi: ['सिस्टम डिक्टेशन', 'डिक्टेशन शुरू करने के लिए Win + H दबाएँ।', 'सिस्टम सेटिंग में तय डिक्टेशन शॉर्टकट का उपयोग करें।', 'सिस्टम या इनपुट विधि का डिक्टेशन शॉर्टकट उपयोग करें।', 'बाहर निकलने से पहले सिस्टम शॉर्टकट से डिक्टेशन रोकें। OS अपनी गोपनीयता सेटिंग के अनुसार ऑनलाइन पहचान कर सकता है।', 'कोई संपादन योग्य उत्तर फ़ील्ड उपलब्ध नहीं है।', 'डिक्टेशन इनपुट · भेजें पर क्लिक करें', 'डिक्टेशन इनपुट से बाहर निकलें']
};

export type DictationTarget = 'question' | 'composer' | 'unavailable';
/**
 * Focus a draft for dictation. A draft the user is already typing in keeps its caret, so spoken text lands where
 * they were; an unfocused draft gets the caret after its last character, never at the start.
 */
export function focusDictationInput(input: HTMLTextAreaElement): boolean {
    const document = input.ownerDocument;
    if (document.activeElement === input) return true;
    input.focus({ preventScroll: true });
    if (document.activeElement !== input) return false;
    const end = input.value.length;
    input.setSelectionRange(end, end);
    return true;
}

export function focusSystemDictationDraft(root: HTMLElement): DictationTarget {
    const question = root.querySelector<HTMLElement>('.nmx-user-question');
    // A pending/disabled question must never fall through into the queued-message composer.
    const input = question ? question.querySelector<HTMLTextAreaElement>('textarea')
        : root.querySelector<HTMLTextAreaElement>('.nmx-composer textarea');
    if (!input || input.disabled || input.readOnly || !input.isConnected) return 'unavailable';
    if (!focusDictationInput(input)) return 'unavailable';
    const body = question?.querySelector<HTMLElement>('.nmx-user-question-body');
    if (body) {
        // Reveal only this answer inside the question; never scroll the task or queue.
        const field = input.getBoundingClientRect(), viewport = body.getBoundingClientRect();
        const delta = field.height > viewport.height || field.top < viewport.top ? field.top - viewport.top
            : Math.max(0, field.bottom - viewport.bottom);
        if (delta) body.scrollTop += delta;
    }
    return question ? 'question' : 'composer';
}

export function dictationShortcut(locale: NextMuxDesktopLocale, platform: string): string {
    const copy = systemDictationCopy[locale];
    return copy[/^win/i.test(platform) ? 1 : /^(?:darwin|mac)/i.test(platform) ? 2 : 3];
}

export function shouldSubmitComposerKey(event: { readonly key: string; readonly shiftKey: boolean; readonly isComposing?: boolean; readonly keyCode?: number }, dictationDraftOnly: boolean): boolean {
    return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !dictationDraftOnly;
}

/** Reserve the actual composer overlap, only while this shell has dictation UI. */
export function observeSystemDictationClearance(hint: HTMLElement): () => void {
    const shell = hint.closest<HTMLElement>('.nmx-shell');
    const view = hint.ownerDocument.defaultView;
    const composer = hint.closest<HTMLElement>('.nmx-composer-wrap');
    const thread = shell?.querySelector<HTMLElement>('.nmx-task-view');
    if (!shell || !view || !composer || !thread) return () => undefined;
    let frame = 0, previousClearance = -1, disposed = false;
    const schedule = (): void => {
        if (frame || disposed) return;
        frame = view.requestAnimationFrame(() => {
            frame = 0;
            if (disposed || !hint.isConnected) return;
            // Padding changes scroll extent, not either measured border box.
            const clearance = Math.ceil(Math.max(0, thread.getBoundingClientRect().bottom - composer.getBoundingClientRect().top));
            if (clearance !== previousClearance) {
                previousClearance = clearance;
                shell.style.setProperty('--nmx-dictation-composer-clearance', `${clearance}px`);
            }
        });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(composer);
    observer.observe(thread);
    schedule();
    return () => {
        disposed = true;
        observer.disconnect();
        if (frame) view.cancelAnimationFrame(frame);
        shell.style.removeProperty('--nmx-dictation-composer-clearance');
    };
}

export function SystemDictationHint({ locale, platform, target, nativePhase, onExit }: {
    locale: NextMuxDesktopLocale; platform: string; target: DictationTarget; nativePhase?: NativeDictationPhase; onExit(): void;
}): React.ReactElement {
    const copy = systemDictationCopy[locale];
    const hint = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => hint.current ? observeSystemDictationClearance(hint.current) : undefined, []);
    return <div ref={hint} className='nmx-system-dictation-hint' role='status' data-nmx-literal>
        <i className='codicon codicon-mic' aria-hidden='true' /><span><strong>{target === 'unavailable' ? copy[5] : nativePhase ? nativeDictationText(locale, nativePhase) : copy[6]}</strong>
            <details><summary>{copy[0]}</summary><small tabIndex={0}>{nativePhase && !['unavailable', 'error'].includes(nativePhase)
                ? nativeDictationText(locale, 'help') : `${dictationShortcut(locale, platform)} ${copy[4]}`}</small></details>
        </span>
        <button type='button' onClick={onExit}>{copy[7]}</button>
    </div>;
}
