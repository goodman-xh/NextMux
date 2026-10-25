import * as React from 'react';
import type { AgentUserQuestion } from '@nextmux/agent-runtime';
import type { AgentQuestionDraft } from './nextmux-agent-question';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { ImeTextarea } from './nextmux-ime-field';
import { workbenchText } from './nextmux-workbench-locale';

const copy: Readonly<Record<NextMuxDesktopLocale, readonly [string, string, string, string]>> = {
    en: ['Your input is needed', 'Choose an option, or type your own answer', 'Submit answer', 'Queued messages stay separate'],
    'zh-CN': ['需要你确认', '选择选项，或自由输入你的答案', '提交回答', '排队消息独立保留'],
    'zh-TW': ['需要你確認', '選擇選項，或自由輸入你的答案', '提交回答', '排隊訊息獨立保留'],
    ja: ['入力が必要です', '選択肢を選ぶか、回答を入力してください', '回答を送信', '待機メッセージは別に保持されます'],
    ko: ['답변이 필요합니다', '옵션을 선택하거나 직접 답변하세요', '답변 제출', '대기 메시지는 별도로 보관됩니다'],
    es: ['Se necesita tu respuesta', 'Elige una opción o escribe tu respuesta', 'Enviar respuesta', 'Los mensajes en cola siguen separados'],
    fr: ['Votre réponse est nécessaire', 'Choisissez une option ou saisissez votre réponse', 'Envoyer la réponse', 'Les messages en attente restent séparés'],
    de: ['Deine Antwort wird benötigt', 'Option wählen oder eigene Antwort eingeben', 'Antwort senden', 'Nachrichten in der Warteschlange bleiben getrennt'],
    'pt-BR': ['Sua resposta é necessária', 'Escolha uma opção ou escreva sua resposta', 'Enviar resposta', 'As mensagens na fila continuam separadas'],
    ru: ['Нужен ваш ответ', 'Выберите вариант или введите свой ответ', 'Отправить ответ', 'Сообщения в очереди сохраняются отдельно'],
    ar: ['إجابتك مطلوبة', 'اختر خياراً أو اكتب إجابتك', 'إرسال الإجابة', 'تبقى رسائل الطابور منفصلة'],
    hi: ['आपके उत्तर की आवश्यकता है', 'विकल्प चुनें या अपना उत्तर लिखें', 'उत्तर भेजें', 'कतार के संदेश अलग सुरक्षित हैं']
};

const permissionCopy: Readonly<Record<NextMuxDesktopLocale, readonly [string, string, string, string, string, string]>> = {
    en: ['Permission needed', 'Allow once', 'Deny', 'Access outside the workspace', 'Run outside workspace protection', 'Send input to an unrestricted process'],
    'zh-CN': ['需要授权', '仅允许本次', '拒绝', '访问工作区之外的文件', '在工作区保护之外运行命令', '向未隔离的进程发送输入'],
    'zh-TW': ['需要授權', '僅允許本次', '拒絕', '存取工作區之外的檔案', '在工作區保護之外執行命令', '向未隔離的程序傳送輸入'],
    ja: ['許可が必要です', '今回のみ許可', '拒否', 'ワークスペース外のファイルにアクセス', 'ワークスペース保護の外でコマンドを実行', '制限のないプロセスに入力を送信'],
    ko: ['권한이 필요합니다', '이번만 허용', '거부', '작업 공간 외부 파일 접근', '작업 공간 보호 외부에서 명령 실행', '격리되지 않은 프로세스로 입력 전송'],
    es: ['Se requiere permiso', 'Permitir una vez', 'Denegar', 'Acceder a archivos fuera del espacio de trabajo', 'Ejecutar sin protección del espacio de trabajo', 'Enviar datos a un proceso sin restricciones'],
    fr: ['Autorisation requise', 'Autoriser une fois', 'Refuser', 'Accéder aux fichiers hors de l’espace de travail', 'Exécuter sans la protection de l’espace de travail', 'Envoyer une entrée à un processus non isolé'],
    de: ['Berechtigung erforderlich', 'Einmal erlauben', 'Ablehnen', 'Auf Dateien außerhalb des Arbeitsbereichs zugreifen', 'Befehl ohne Arbeitsbereichsschutz ausführen', 'Eingabe an einen nicht isolierten Prozess senden'],
    'pt-BR': ['Permissão necessária', 'Permitir uma vez', 'Negar', 'Acessar arquivos fora da área de trabalho', 'Executar sem a proteção da área de trabalho', 'Enviar entrada a um processo sem restrições'],
    ru: ['Требуется разрешение', 'Разрешить один раз', 'Отклонить', 'Доступ к файлам вне рабочей области', 'Запустить команду вне защиты рабочей области', 'Ввод в неизолированный процесс'],
    ar: ['الإذن مطلوب', 'السماح مرة واحدة', 'رفض', 'الوصول إلى ملفات خارج مساحة العمل', 'تشغيل أمر خارج حماية مساحة العمل', 'إرسال إدخال إلى عملية غير معزولة'],
    hi: ['अनुमति आवश्यक है', 'केवल इस बार अनुमति दें', 'अस्वीकार करें', 'कार्यस्थान के बाहर फ़ाइलों तक पहुँच', 'कार्यस्थान सुरक्षा के बाहर आदेश चलाएँ', 'अप्रतिबंधित प्रक्रिया को इनपुट भेजें']
};

const externalWriteCopy: Readonly<Record<NextMuxDesktopLocale, string>> = {
    en: 'Modify a file outside the workspace', 'zh-CN': '修改工作区之外的文件', 'zh-TW': '修改工作區之外的檔案',
    ja: 'ワークスペース外のファイルを変更', ko: '작업 공간 외부 파일 수정', es: 'Modificar un archivo fuera del espacio de trabajo',
    fr: 'Modifier un fichier hors de l’espace de travail', de: 'Eine Datei außerhalb des Arbeitsbereichs ändern',
    'pt-BR': 'Modificar um arquivo fora da área de trabalho', ru: 'Изменить файл вне рабочей области',
    ar: 'تعديل ملف خارج مساحة العمل', hi: 'कार्यस्थान के बाहर फ़ाइल बदलें'
};

/** The out-of-workspace write reminder (audit OpenCode #12): title, the two bodies, targets, buttons and their hints. */
interface OutsideWriteCopy {
    readonly title: string;
    readonly commandBody: string;
    readonly fileBody: string;
    readonly targets: string;
    readonly ignore: string;
    readonly ignoreHint: string;
    readonly allow: string;
    readonly allowHint: string;
    readonly dontShowAgain: string;
    readonly dontShowAgainHint: string;
    readonly countdown: string;
}

const outsideWriteCopy: Readonly<Record<NextMuxDesktopLocale, OutsideWriteCopy>> = {
    en: { title: 'Writes outside the workspace', commandBody: 'This command writes outside the current project. If you ignore it, the task skips this step and carries on.',
        fileBody: 'The model wants to change a file outside the current project. If you ignore it, the task skips this step and carries on.', targets: 'Target',
        ignore: 'Ignore', ignoreHint: 'Skip this write and continue the task', allow: 'Got it', allowHint: 'Allow this write and continue the task',
        dontShowAgain: 'Don’t show again', dontShowAgainHint: 'In this conversation, later requests like this follow the choice you make now, until NextMux restarts',
        countdown: 'Ignored automatically in {seconds} s' },
    'zh-CN': { title: '将写入工作区之外', commandBody: '这条命令会写入当前项目之外的位置。忽略后任务会跳过这一步继续进行。',
        fileBody: '模型要修改当前项目之外的文件。忽略后任务会跳过这一步继续进行。', targets: '目标位置',
        ignore: '忽略', ignoreHint: '跳过这次写入，任务继续', allow: '知道了', allowHint: '允许这次写入，任务继续',
        dontShowAgain: '下次不再弹出', dontShowAgainHint: '本对话之后的同类请求按你这次的选择自动处理，重启 NextMux 后恢复提醒',
        countdown: '{seconds} 秒后自动忽略' },
    'zh-TW': { title: '將寫入工作區之外', commandBody: '這條命令會寫入目前專案之外的位置。忽略後任務會跳過這一步繼續進行。',
        fileBody: '模型要修改目前專案之外的檔案。忽略後任務會跳過這一步繼續進行。', targets: '目標位置',
        ignore: '忽略', ignoreHint: '跳過這次寫入，任務繼續', allow: '知道了', allowHint: '允許這次寫入，任務繼續',
        dontShowAgain: '下次不再彈出', dontShowAgainHint: '本對話之後的同類請求依你這次的選擇自動處理，重新啟動 NextMux 後恢復提醒',
        countdown: '{seconds} 秒後自動忽略' },
    ja: { title: 'ワークスペース外への書き込み', commandBody: 'このコマンドは現在のプロジェクトの外に書き込みます。無視すると、この手順を飛ばしてタスクを続けます。',
        fileBody: 'モデルが現在のプロジェクト外のファイルを変更しようとしています。無視すると、この手順を飛ばしてタスクを続けます。', targets: '書き込み先',
        ignore: '無視', ignoreHint: 'この書き込みを飛ばしてタスクを続ける', allow: '了解', allowHint: 'この書き込みを許可してタスクを続ける',
        dontShowAgain: '次回から表示しない', dontShowAgainHint: 'この会話では、NextMux を再起動するまで同じ種類の要求に今回の選択を適用します',
        countdown: '{seconds} 秒後に自動で無視' },
    ko: { title: '작업 공간 외부에 쓰기', commandBody: '이 명령은 현재 프로젝트 외부에 씁니다. 무시하면 이 단계를 건너뛰고 작업을 계속합니다.',
        fileBody: '모델이 현재 프로젝트 외부의 파일을 수정하려고 합니다. 무시하면 이 단계를 건너뛰고 작업을 계속합니다.', targets: '대상 위치',
        ignore: '무시', ignoreHint: '이번 쓰기를 건너뛰고 작업 계속', allow: '확인', allowHint: '이번 쓰기를 허용하고 작업 계속',
        dontShowAgain: '다음부터 표시 안 함', dontShowAgainHint: '이 대화에서는 NextMux를 다시 시작할 때까지 같은 종류의 요청에 지금 선택이 적용됩니다',
        countdown: '{seconds}초 후 자동으로 무시' },
    es: { title: 'Escritura fuera del espacio de trabajo', commandBody: 'Este comando escribe fuera del proyecto actual. Si lo ignoras, la tarea omite este paso y continúa.',
        fileBody: 'El modelo quiere cambiar un archivo fuera del proyecto actual. Si lo ignoras, la tarea omite este paso y continúa.', targets: 'Destino',
        ignore: 'Ignorar', ignoreHint: 'Omitir esta escritura y continuar la tarea', allow: 'Entendido', allowHint: 'Permitir esta escritura y continuar la tarea',
        dontShowAgain: 'No volver a mostrar', dontShowAgainHint: 'En esta conversación, las solicitudes similares seguirán tu elección actual hasta que reinicies NextMux',
        countdown: 'Se ignorará en {seconds} s' },
    fr: { title: 'Écriture hors de l’espace de travail', commandBody: 'Cette commande écrit hors du projet actuel. Si vous l’ignorez, la tâche saute cette étape et continue.',
        fileBody: 'Le modèle veut modifier un fichier hors du projet actuel. Si vous l’ignorez, la tâche saute cette étape et continue.', targets: 'Cible',
        ignore: 'Ignorer', ignoreHint: 'Passer cette écriture et poursuivre la tâche', allow: 'Compris', allowHint: 'Autoriser cette écriture et poursuivre la tâche',
        dontShowAgain: 'Ne plus afficher', dontShowAgainHint: 'Dans cette conversation, les demandes semblables suivent votre choix actuel jusqu’au redémarrage de NextMux',
        countdown: 'Ignoré automatiquement dans {seconds} s' },
    de: { title: 'Schreiben außerhalb des Arbeitsbereichs', commandBody: 'Dieser Befehl schreibt außerhalb des aktuellen Projekts. Wenn du ihn ignorierst, überspringt die Aufgabe diesen Schritt und läuft weiter.',
        fileBody: 'Das Modell möchte eine Datei außerhalb des aktuellen Projekts ändern. Wenn du es ignorierst, überspringt die Aufgabe diesen Schritt und läuft weiter.', targets: 'Ziel',
        ignore: 'Ignorieren', ignoreHint: 'Diesen Schreibvorgang überspringen und fortfahren', allow: 'Verstanden', allowHint: 'Diesen Schreibvorgang erlauben und fortfahren',
        dontShowAgain: 'Nicht mehr anzeigen', dontShowAgainHint: 'In dieser Unterhaltung folgen gleiche Anfragen deiner jetzigen Wahl, bis NextMux neu startet',
        countdown: 'Wird in {seconds} s automatisch ignoriert' },
    'pt-BR': { title: 'Gravação fora da área de trabalho', commandBody: 'Este comando grava fora do projeto atual. Se você ignorar, a tarefa pula esta etapa e continua.',
        fileBody: 'O modelo quer alterar um arquivo fora do projeto atual. Se você ignorar, a tarefa pula esta etapa e continua.', targets: 'Destino',
        ignore: 'Ignorar', ignoreHint: 'Pular esta gravação e continuar a tarefa', allow: 'Entendi', allowHint: 'Permitir esta gravação e continuar a tarefa',
        dontShowAgain: 'Não mostrar novamente', dontShowAgainHint: 'Nesta conversa, pedidos semelhantes seguem sua escolha atual até o NextMux reiniciar',
        countdown: 'Ignorado automaticamente em {seconds} s' },
    ru: { title: 'Запись вне рабочей области', commandBody: 'Эта команда пишет за пределами текущего проекта. Если её игнорировать, задача пропустит этот шаг и продолжит работу.',
        fileBody: 'Модель хочет изменить файл за пределами текущего проекта. Если это игнорировать, задача пропустит этот шаг и продолжит работу.', targets: 'Куда',
        ignore: 'Игнорировать', ignoreHint: 'Пропустить эту запись и продолжить задачу', allow: 'Понятно', allowHint: 'Разрешить эту запись и продолжить задачу',
        dontShowAgain: 'Больше не показывать', dontShowAgainHint: 'В этом разговоре такие же запросы будут следовать нынешнему выбору до перезапуска NextMux',
        countdown: 'Будет пропущено через {seconds} с' },
    ar: { title: 'كتابة خارج مساحة العمل', commandBody: 'يكتب هذا الأمر خارج المشروع الحالي. إذا تجاهلته، تتخطى المهمة هذه الخطوة وتتابع.',
        fileBody: 'يريد النموذج تعديل ملف خارج المشروع الحالي. إذا تجاهلته، تتخطى المهمة هذه الخطوة وتتابع.', targets: 'الوجهة',
        ignore: 'تجاهل', ignoreHint: 'تخطَّ هذه الكتابة وتابع المهمة', allow: 'حسنًا', allowHint: 'اسمح بهذه الكتابة وتابع المهمة',
        dontShowAgain: 'لا تعرض مرة أخرى', dontShowAgainHint: 'في هذه المحادثة، تتبع الطلبات المماثلة اختيارك الحالي حتى إعادة تشغيل NextMux',
        countdown: 'سيُتجاهل تلقائيًا بعد {seconds} ث' },
    hi: { title: 'कार्यस्थान के बाहर लिखना', commandBody: 'यह आदेश मौजूदा प्रोजेक्ट के बाहर लिखता है। अनदेखा करने पर कार्य यह चरण छोड़कर आगे बढ़ता है।',
        fileBody: 'मॉडल मौजूदा प्रोजेक्ट के बाहर की फ़ाइल बदलना चाहता है। अनदेखा करने पर कार्य यह चरण छोड़कर आगे बढ़ता है।', targets: 'लक्ष्य',
        ignore: 'अनदेखा करें', ignoreHint: 'यह लेखन छोड़ें और कार्य जारी रखें', allow: 'ठीक है', allowHint: 'यह लेखन होने दें और कार्य जारी रखें',
        dontShowAgain: 'फिर न दिखाएँ', dontShowAgainHint: 'इस बातचीत में, NextMux दोबारा शुरू होने तक ऐसे अनुरोध आपके अभी के चुनाव से तय होंगे',
        countdown: '{seconds} सेकंड में अपने-आप अनदेखा' }
};

export const OUTSIDE_WRITE_PROMPT_KEY = 'nextmux.desktop.suppressOutsideWorkspaceWritePrompt.v1';
export type OutsideWriteChoice = 'ignore' | 'allow';

function rememberedChoices(): Record<string, OutsideWriteChoice> {
    try {
        const stored: unknown = JSON.parse(window.sessionStorage.getItem(OUTSIDE_WRITE_PROMPT_KEY) || '{}');
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
        return Object.fromEntries(Object.entries(stored as Record<string, unknown>)
            .filter((entry): entry is [string, OutsideWriteChoice] => entry[1] === 'ignore' || entry[1] === 'allow'));
    } catch {
        return {};
    }
}

/**
 * "Don't show again" for out-of-workspace writes: remembered per conversation and only for this app session
 * (sessionStorage), so an allowed write never outlives the run of NextMux in which the user chose it.
 */
export function rememberedOutsideWriteChoice(scope: string): OutsideWriteChoice | undefined {
    return scope ? rememberedChoices()[scope] : undefined;
}

export function rememberOutsideWriteChoice(scope: string, choice: OutsideWriteChoice): void {
    if (!scope) return;
    try {
        const choices = { ...rememberedChoices() };
        delete choices[scope];
        choices[scope] = choice;
        window.sessionStorage.setItem(OUTSIDE_WRITE_PROMPT_KEY, JSON.stringify(Object.fromEntries(Object.entries(choices).slice(-64))));
    } catch { /* the choice only applies to this dialog */ }
}

export interface AgentQuestionPanelProps {
    readonly question: AgentUserQuestion;
    readonly draft: AgentQuestionDraft;
    readonly submitting: boolean;
    readonly queuedCount: number;
    readonly locale: NextMuxDesktopLocale;
    /** The conversation a "don't show again" choice belongs to. */
    readonly rememberScope?: string;
    readonly keyboardSubmitDisabled?: boolean;
    readonly onEdit: (patch: Partial<Pick<AgentQuestionDraft, 'optionId' | 'text'>>) => void;
    readonly onAnswer: () => void;
    readonly onCancel: () => void;
}

interface PermissionQuestionPanelProps {
    readonly question: AgentUserQuestion;
    readonly submitting: boolean;
    readonly locale: NextMuxDesktopLocale;
    readonly error?: string;
    readonly rememberScope: string;
    readonly onDecide: (optionId: 'allow_once' | 'deny') => void;
}

/**
 * A permission request. An out-of-workspace write (command or file) is a reminder: Ignore skips the step, Got it
 * allows it, and an unanswered reminder ignores itself when the runtime's window (question.expiresAt) closes.
 */
function PermissionQuestionPanel(props: PermissionQuestionPanelProps): React.ReactElement {
    const { question, submitting, locale, onDecide } = props;
    const approval = question.approval!;
    const [heading, allow, deny, fileScope, commandScope, inputScope] = permissionCopy[locale];
    const text = outsideWriteCopy[locale];
    const outsideWrite = approval.outOfWorkspaceWrite === true;
    const autoIgnore = outsideWrite && typeof approval.autoIgnoreAfterMs === 'number' && approval.autoIgnoreAfterMs > 0;
    const deadline = Date.parse(question.expiresAt);
    const secondsLeft = (): number => Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
    const [seconds, setSeconds] = React.useState(secondsLeft);
    const [dontShowAgain, setDontShowAgain] = React.useState(false);
    const dontShowAgainRef = React.useRef(false);
    const decided = React.useRef(false);
    const decide = (choice: OutsideWriteChoice): void => {
        if (submitting || decided.current) return;
        decided.current = true;
        if (outsideWrite && dontShowAgainRef.current) rememberOutsideWriteChoice(props.rememberScope, choice);
        onDecide(choice === 'allow' ? 'allow_once' : 'deny');
    };
    React.useEffect(() => {
        if (!outsideWrite) return;
        const remembered = rememberedOutsideWriteChoice(props.rememberScope);
        if (!remembered) return;
        decided.current = true;
        onDecide(remembered === 'allow' ? 'allow_once' : 'deny');
    }, [question.questionId]);
    React.useEffect(() => {
        if (!autoIgnore) return;
        const timer = window.setInterval(() => {
            const left = secondsLeft();
            setSeconds(left);
            if (left > 0) return;
            window.clearInterval(timer);
            // The runtime closes the request itself when the window ends (an unanswered reminder is not approved);
            // a checked box still remembers that ending as Ignore for the rest of the conversation.
            if (dontShowAgainRef.current && !decided.current) rememberOutsideWriteChoice(props.rememberScope, 'ignore');
        }, 250);
        return () => window.clearInterval(timer);
    }, [question.questionId, autoIgnore]);
    const labelId = `nmx-question-${question.questionId}`;
    const bodyId = `${labelId}-body`;
    const paths = (approval.outOfWorkspacePaths || []).filter(path => typeof path === 'string' && path.length > 0);
    const body = outsideWrite
        ? approval.scope === 'external_file' ? text.fileBody : text.commandBody
        : approval.scope === 'external_file' ? approval.detail === 'write' ? externalWriteCopy[locale] : fileScope
            : approval.scope === 'process_input' ? inputScope : commandScope;
    const totalMs = autoIgnore ? Math.max(1_000, approval.autoIgnoreAfterMs!) : 0;
    const remainingMs = autoIgnore && Number.isFinite(deadline) ? Math.max(0, Math.min(totalMs, deadline - Date.now())) : 0;
    return <section className={`nmx-user-question nmx-permission-question${outsideWrite ? ' is-outside-write' : ''}`}
        aria-labelledby={labelId} aria-describedby={bodyId} aria-busy={submitting}
        data-question-id={question.questionId} data-run-id={question.runId} data-task-id={question.taskId}
        data-out-of-workspace-write={outsideWrite ? 'true' : undefined}>
        <header>
            <span className='nmx-permission-icon' aria-hidden='true'><i className={`codicon codicon-${outsideWrite ? 'warning' : 'shield'}`}></i></span>
            <strong id={labelId}>{outsideWrite ? text.title : heading}</strong>
        </header>
        <div className='nmx-user-question-body'>
            <p id={bodyId}>{body}</p>
            {(!outsideWrite || approval.scope !== 'external_file') && <pre className='nmx-permission-target' data-nmx-literal dir='ltr'>{approval.target}</pre>}
            {paths.length > 0 && <div className='nmx-permission-paths' role='group' aria-label={text.targets}>
                <span className='nmx-permission-paths-label'>{text.targets}</span>
                <ul>{paths.map(path => <li key={path}><i className='codicon codicon-folder' aria-hidden='true'></i><span data-nmx-literal dir='ltr' title={path}>{path}</span></li>)}</ul>
            </div>}
            {approval.detail && approval.scope !== 'external_file' && <small className='nmx-permission-detail' data-nmx-literal dir='ltr'>{approval.detail}</small>}
            {outsideWrite && <label className='nmx-permission-remember' title={text.dontShowAgainHint}>
                <input type='checkbox' checked={dontShowAgain} disabled={submitting} onChange={event => {
                    dontShowAgainRef.current = event.currentTarget.checked;
                    setDontShowAgain(event.currentTarget.checked);
                }} />
                <span>{text.dontShowAgain}</span>
            </label>}
            {props.error && <p className='nmx-user-question-error' role='alert'>{props.error}</p>}
        </div>
        {autoIgnore && <div className='nmx-permission-countdown' role='timer' aria-label={text.countdown.replace('{seconds}', String(seconds))}>
            <span style={{ animationDuration: `${remainingMs}ms`, transform: `scaleX(${totalMs ? remainingMs / totalMs : 0})` }}></span>
        </div>}
        <footer>
            <button type='button' className='nmx-permission-ignore' data-permission-action='ignore' disabled={submitting}
                title={outsideWrite ? text.ignoreHint : undefined} onClick={() => decide('ignore')}>
                {outsideWrite ? <>{text.ignore}{autoIgnore && <span className='nmx-permission-seconds' dir='ltr'>({seconds}s)</span>}</> : deny}
            </button>
            <button type='button' className='is-primary' data-permission-action='allow' disabled={submitting}
                title={outsideWrite ? text.allowHint : undefined} onClick={() => decide('allow')}>
                {outsideWrite ? text.allow : allow}
            </button>
        </footer>
    </section>;
}

export function AgentQuestionPanel(props: AgentQuestionPanelProps): React.ReactElement {
    const { question, draft, submitting, queuedCount, locale, onEdit, onAnswer, onCancel } = props;
    if (question.kind === 'permission' && question.approval) {
        return <PermissionQuestionPanel key={question.questionId} question={question} submitting={submitting} locale={locale}
            error={draft.error} rememberScope={props.rememberScope || ''}
            onDecide={optionId => { if (!submitting) { onEdit({ optionId, text: '' }); onAnswer(); } }} />;
    }
    const [title, placeholder, submit, queueHint] = copy[locale];
    const labelId = `nmx-question-${question.questionId}`;

    return <form className='nmx-user-question' aria-labelledby={labelId} aria-busy={submitting}
        data-question-id={question.questionId} data-run-id={question.runId} data-task-id={question.taskId}
        onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (!submitting) onAnswer(); }}
        onPaste={event => event.stopPropagation()} onDrop={event => { event.preventDefault(); event.stopPropagation(); }}
        onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDragEnter={event => event.stopPropagation()}
        onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && !props.keyboardSubmitDisabled) {
                event.preventDefault(); if (!submitting) onAnswer();
            }
        }}>
        <header><i className='codicon codicon-question' aria-hidden='true'></i><strong>{title}</strong></header>
        <div className='nmx-user-question-body'>
            <p id={labelId} data-nmx-literal>{question.prompt}</p>
            {question.options.length > 0 && <div className='nmx-user-question-options' role='radiogroup' aria-labelledby={labelId}>
                {question.options.map(option => <label key={option.id} className={draft.optionId === option.id ? 'is-selected' : ''}>
                    <input type='radio' name={labelId} value={option.id} checked={draft.optionId === option.id} disabled={submitting}
                        onChange={() => onEdit({ optionId: option.id })} />
                    <span data-nmx-literal><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                </label>)}
                <label className={!draft.optionId ? 'is-selected' : ''}>
                    <input type='radio' name={labelId} value='' checked={!draft.optionId} disabled={submitting} onChange={() => onEdit({ optionId: '' })} />
                    <span>{placeholder}</span>
                </label>
            </div>}
            <ImeTextarea value={draft.text} rows={1} maxLength={10_000} disabled={submitting} placeholder={placeholder} aria-label={placeholder}
                onChange={event => onEdit({ text: event.currentTarget.value })} />
            {draft.error && <p className='nmx-user-question-error' role='alert'>{draft.error}</p>}
        </div>
        <footer>{queuedCount > 0 && <small title={`${queueHint} · ${queuedCount}`}><i className='codicon codicon-list-unordered' aria-hidden='true'></i><span>{queueHint}</span><b>{queuedCount}</b></small>}
            <button type='button' disabled={submitting} onClick={onCancel}>{workbenchText(locale, 'cancel')}</button>
            <button type='submit' className='is-primary' disabled={submitting || !draft.optionId && !draft.text.trim()}>{submit}</button>
        </footer>
    </form>;
}
