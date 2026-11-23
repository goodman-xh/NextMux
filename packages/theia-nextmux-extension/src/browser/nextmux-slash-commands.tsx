import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import type { NextMuxDesktopLocale } from './nextmux-locale';

export type ComposerSlashGroupId = 'context' | 'workflow' | 'shortcut' | 'skills';

export type ComposerSlashCommandKind =
    | 'compact'
    | 'new'
    | 'undo'
    | 'review'
    | 'init'
    | 'commit'
    | 'plan'
    | 'goal'
    | 'council'
    | 'app'
    | 'model'
    | 'relay'
    | 'permissions'
    | 'mcp'
    | 'skill';

export interface ComposerSlashSkillInfo {
    readonly name: string;
    readonly description?: string;
    readonly location?: string;
}

export interface ComposerSlashContextState {
    readonly locale: NextMuxDesktopLocale;
    readonly hasActiveSession: boolean;
    readonly completedTurnCount: number;
    readonly isCompacting: boolean;
    readonly agentRunning: boolean;
    readonly hasRestorableTurn: boolean;
    readonly appControlAvailable: boolean;
    readonly composerAppPicking?: boolean;
    readonly councilActiveOrPending: boolean;
    readonly councilDisabledNotice?: string;
    readonly skills: readonly ComposerSlashSkillInfo[];
}

export interface ComposerSlashCommandItem {
    readonly id: string;
    readonly kind: ComposerSlashCommandKind;
    readonly group: ComposerSlashGroupId;
    /** Slash slug without leading `/`, e.g. `compact`, `review`, `my-skill`. */
    readonly slug: string;
    readonly title: string;
    readonly description: string;
    readonly icon: string;
    readonly argHint?: string;
    readonly badge?: string;
    /** True when selecting with empty trailing draft inserts `/<slug> ` for user input instead of firing immediately. */
    readonly requiresTaskInput?: boolean;
    /** True when `Tab` inserts `/<slug> ` so user can append optional arguments before submitting. */
    readonly acceptsArgs?: boolean;
    readonly disabled?: boolean;
    readonly disabledReason?: string;
    readonly keywords: readonly string[];
    readonly skillName?: string;
}

export interface ComposerSlashMatch {
    readonly slashIndex: number;
    readonly endIndex: number;
    readonly query: string;
    readonly token: string;
}

/**
 * A workflow or skill command picked from the `/` drawer (or typed as `/<slug> ` at the start of the input). It shows
 * as an icon and the slug at the start of the input, and goes out as `/<slug>` ahead of the text the user typed.
 */
export interface ComposerSlashChip {
    readonly slug: string;
    readonly kind: ComposerSlashCommandKind;
    readonly icon: string;
    readonly title: string;
    readonly skillName?: string;
}

/** Commands that wait for the user's text as a chip; every other command acts at once. */
export function isComposerSlashChipKind(kind: ComposerSlashCommandKind): boolean {
    return kind === 'review' || kind === 'init' || kind === 'commit' || kind === 'plan' || kind === 'skill';
}

export function slashChipFromCommand(command: ComposerSlashCommandItem): ComposerSlashChip {
    return {
        slug: command.slug,
        kind: command.kind,
        icon: command.icon,
        title: command.title,
        ...(command.skillName ? { skillName: command.skillName } : {})
    };
}

/** What a chip sends: its command typed in front of the user's text, so it expands exactly like a typed command. */
export function slashChipPrompt(chip: Pick<ComposerSlashChip, 'slug'>, body: string): string {
    return body ? `/${chip.slug} ${body}` : `/${chip.slug}`;
}

/**
 * `/<slug> ` just typed at the very start of the input, the caret right after its space, naming an enabled workflow
 * or skill command: that command, and the text left once the token comes out. Text that merely starts with a slash
 * command (a restored draft, a caret moved back in) stays text; it still runs as the command when sent.
 */
export function matchTypedComposerSlashChip(
    text: string,
    selectionStart: number | null | undefined,
    selectionEnd: number | null | undefined,
    commands: readonly ComposerSlashCommandItem[]
): { readonly command: ComposerSlashCommandItem; readonly rest: string } | undefined {
    const token = /^\/([\p{L}\p{N}_.:-]+) /u.exec(typeof text === 'string' ? text : '');
    if (!token || selectionStart !== token[0].length || selectionEnd !== token[0].length) return undefined;
    const slug = token[1].toLowerCase();
    const command = commands.find(item => !item.disabled && isComposerSlashChipKind(item.kind) && item.slug.toLowerCase() === slug);
    return command ? { command, rest: text.slice(token[0].length) } : undefined;
}

/** The muted text after a drawer row's slug: the description (or why it is unavailable), led by the title outside English. */
export function slashCommandRowDetail(locale: NextMuxDesktopLocale, item: ComposerSlashCommandItem): string {
    const detail = item.disabled && item.disabledReason ? item.disabledReason : item.description;
    const showTitle = locale !== 'en' && item.kind !== 'skill' && item.title.trim().toLowerCase() !== item.slug.toLowerCase();
    return showTitle ? `${item.title} · ${detail}` : detail;
}

export interface CompetingComposerSurfaces {
    readonly codingPopover?: string;
    readonly appControlPickerOpen?: boolean;
    readonly accountMenuOpen?: boolean;
    readonly goalDrawer?: boolean;
    readonly goalCloseConfirmation?: boolean;
    readonly walletTopupSheetOpen?: boolean;
    readonly officialProviderSheet?: boolean;
    readonly officialModelListOpenId?: string;
    readonly myApisOpen?: boolean;
    readonly councilConfigModalOpen?: boolean;
    readonly scheduleDialogOpen?: boolean;
    readonly fullAccessConfirmationOpen?: boolean;
    readonly pendingDurableRetry?: boolean;
    readonly pendingRestoreConfirmation?: boolean;
    readonly pendingIncognitoMode?: boolean;
    readonly pendingRelaySwitch?: boolean;
    readonly selectedOffering?: boolean;
    readonly activeCheckpointDiff?: boolean;
    readonly appPluginChatPicker?: boolean;
    readonly appPluginStart?: boolean;
    readonly appPluginHub?: boolean;
    readonly codingSearchOpen?: boolean;
    readonly pendingTurnEdit?: boolean;
}

const BUILTIN_SLASH_SLUGS = new Set([
    'compact', 'new', 'undo',
    'review', 'init', 'commit', 'plan',
    'goal', 'council', 'app', 'model', 'relay', 'permissions',
    'mcp'
]);

const SLASH_TRIGGER_BEFORE_CARET = /(?:^|\s)\/([\p{L}\p{N}_.:-]*)$/u;

/**
 * Whole-sentence copy for every language besides Chinese and English, keyed by the zh-CN source. The shared surface
 * dictionary pieces unknown sentences together from fragments, which mixed Chinese into Japanese and picked wrong senses
 * (管理 became "executives"); a sentence missing here shows the English instead.
 */
const SLASH_COPY: Readonly<Record<string, Readonly<Partial<Record<NextMuxDesktopLocale, string>>>>> = {
    '上下文与会话': { ja: 'コンテキストと会話', ko: '컨텍스트와 대화', es: 'Contexto y conversación', fr: 'Contexte et conversation', de: 'Kontext und Unterhaltung', 'pt-BR': 'Contexto e conversa', ru: 'Контекст и диалог', ar: 'السياق والمحادثة', hi: 'संदर्भ और बातचीत' },
    '研发高频动作': { ja: '開発ワークフロー', ko: '개발 워크플로', es: 'Flujos de desarrollo', fr: 'Flux de développement', de: 'Entwicklungsabläufe', 'pt-BR': 'Fluxos de desenvolvimento', ru: 'Процессы разработки', ar: 'سير عمل التطوير', hi: 'डेवलपमेंट वर्कफ़्लो' },
    'NextMux 快捷入口': { ja: 'NextMux ショートカット', ko: 'NextMux 바로 가기', es: 'Accesos directos de NextMux', fr: 'Raccourcis NextMux', de: 'NextMux-Verknüpfungen', 'pt-BR': 'Atalhos do NextMux', ru: 'Быстрые действия NextMux', ar: 'اختصارات NextMux', hi: 'NextMux शॉर्टकट' },
    '技能与扩展': { ja: 'スキルと MCP', ko: '스킬과 MCP', es: 'Skills y MCP', fr: 'Skills et MCP', de: 'Skills und MCP', 'pt-BR': 'Skills e MCP', ru: 'Навыки и MCP', ar: 'المهارات وMCP', hi: 'स्किल और MCP' },
    '↑↓ 选择 · Tab 补全 · ↵ 执行 · Esc 关闭': { ja: '↑↓ 選択 · Tab 補完 · ↵ 実行 · Esc 閉じる', ko: '↑↓ 선택 · Tab 완성 · ↵ 실행 · Esc 닫기', es: '↑↓ Navegar · Tab Completar · ↵ Ejecutar · Esc Cerrar', fr: '↑↓ Naviguer · Tab Compléter · ↵ Exécuter · Esc Fermer', de: '↑↓ Auswählen · Tab Vervollständigen · ↵ Ausführen · Esc Schließen', 'pt-BR': '↑↓ Navegar · Tab Completar · ↵ Executar · Esc Fechar', ru: '↑↓ Выбор · Tab Дополнить · ↵ Выполнить · Esc Закрыть', ar: '↑↓ تنقّل · Tab إكمال · ↵ تشغيل · Esc إغلاق', hi: '↑↓ चुनें · Tab पूरा करें · ↵ चलाएँ · Esc बंद करें' },
    '对话运行中，完成后再压缩': { ja: '実行中です。完了後に圧縮できます', ko: '실행 중입니다. 끝난 뒤 압축할 수 있습니다', es: 'Espera a que termine la ejecución actual', fr: 'Attendez la fin de l’exécution en cours', de: 'Warten Sie, bis der aktuelle Lauf fertig ist', 'pt-BR': 'Aguarde a execução atual terminar', ru: 'Дождитесь окончания текущего запуска', ar: 'انتظر حتى ينتهي التشغيل الحالي', hi: 'मौजूदा रन पूरा होने तक रुकें' },
    '正在压缩上下文…': { ja: 'コンテキストを圧縮中…', ko: '컨텍스트 압축 중…', es: 'Compactando el contexto…', fr: 'Compactage du contexte…', de: 'Kontext wird komprimiert…', 'pt-BR': 'Compactando o contexto…', ru: 'Сжатие контекста…', ar: 'جارٍ ضغط السياق…', hi: 'संदर्भ संक्षिप्त हो रहा है…' },
    '至少完成 2 轮对话后可压缩': { ja: '2 ターン以上の会話が終わると圧縮できます', ko: '대화를 2턴 이상 마치면 압축할 수 있습니다', es: 'Requiere al menos 2 turnos completados', fr: 'Nécessite au moins 2 échanges terminés', de: 'Erfordert mindestens 2 abgeschlossene Runden', 'pt-BR': 'Requer pelo menos 2 turnos concluídos', ru: 'Нужно не меньше 2 завершённых ходов', ar: 'يتطلب جولتين مكتملتين على الأقل', hi: 'कम से कम 2 पूरे टर्न चाहिए' },
    '对话运行中暂不可撤回': { ja: '実行中は元に戻せません', ko: '실행 중에는 되돌릴 수 없습니다', es: 'No se puede deshacer mientras se ejecuta', fr: 'Impossible d’annuler pendant l’exécution', de: 'Während eines Laufs nicht rückgängig zu machen', 'pt-BR': 'Não é possível desfazer durante a execução', ru: 'Нельзя отменить во время выполнения', ar: 'لا يمكن التراجع أثناء التشغيل', hi: 'रन के दौरान पूर्ववत नहीं हो सकता' },
    '暂无可撤回的文件改动': { ja: '元に戻せるファイル変更はまだありません', ko: '되돌릴 파일 변경이 아직 없습니다', es: 'Aún no hay cambios de archivos que restaurar', fr: 'Aucune modification de fichier à restaurer', de: 'Noch keine wiederherstellbaren Dateiänderungen', 'pt-BR': 'Ainda não há alterações de arquivos para restaurar', ru: 'Пока нет изменений файлов для отката', ar: 'لا توجد تغييرات ملفات قابلة للاستعادة بعد', hi: 'अभी लौटाने लायक कोई फ़ाइल बदलाव नहीं है' },
    '议会模式启用中，请在议会配置中调整': { ja: '文殊モード中は変更できません。文殊モードの設定で調整してください', ko: '집단지성 모드 사용 중에는 바꿀 수 없습니다. 집단지성 모드 설정에서 조정하세요', es: 'Bloqueado con el Modo Equipo activo; ajústalo en su configuración', fr: 'Verrouillé tant que le Mode Équipe est actif ; réglez-le dans sa configuration', de: 'Gesperrt, solange der Teammodus aktiv ist; in dessen Einstellungen anpassen', 'pt-BR': 'Bloqueado com o Modo Equipe ativo; ajuste na configuração dele', ru: 'Недоступно, пока включена «Команда моделей»; настройте её параметры', ar: 'مقفل أثناء تفعيل وضع التعاون؛ عدّل إعداداته', hi: 'टीम मोड चालू रहते हुए बंद है; उसकी सेटिंग में बदलें' },
    '新建对话': { ja: '新しい会話', ko: '새 대화', es: 'Nueva conversación', fr: 'Nouvelle conversation', de: 'Neue Unterhaltung', 'pt-BR': 'Nova conversa', ru: 'Новый диалог', ar: 'محادثة جديدة', hi: 'नई बातचीत' },
    '在当前项目工作区立即创建并切换到全新对话': { ja: '現在のワークスペースで新しい会話を作成して切り替えます', ko: '현재 작업 공간에서 새 대화를 만들고 전환합니다', es: 'Crea una conversación nueva en el espacio de trabajo actual y cambia a ella', fr: 'Crée une nouvelle conversation dans l’espace de travail actuel et y bascule', de: 'Erstellt eine neue Unterhaltung im aktuellen Arbeitsbereich und wechselt dorthin', 'pt-BR': 'Cria uma conversa nova no espaço de trabalho atual e muda para ela', ru: 'Создаёт новый диалог в текущей рабочей области и переключается на него', ar: 'ينشئ محادثة جديدة في مساحة العمل الحالية وينتقل إليها', hi: 'मौजूदा वर्कस्पेस में नई बातचीत बनाकर उस पर ले जाता है' },
    '压缩上下文': { ja: 'コンテキストを圧縮', ko: '컨텍스트 압축', es: 'Compactar contexto', fr: 'Compacter le contexte', de: 'Kontext komprimieren', 'pt-BR': 'Compactar contexto', ru: 'Сжать контекст', ar: 'ضغط السياق', hi: 'संदर्भ संक्षिप्त करें' },
    '精炼早期对话历史，保留核心目标、文件改动与关键决策以释放上下文窗口': { ja: '古いターンを要約し、目標・ファイル変更・重要な決定は残します', ko: '이전 턴을 요약하고 목표, 파일 변경, 중요한 결정은 남깁니다', es: 'Resume los turnos antiguos y conserva objetivos, cambios de archivos y decisiones clave', fr: 'Résume les anciens échanges en gardant objectifs, modifications de fichiers et décisions clés', de: 'Fasst ältere Runden zusammen und behält Ziele, Dateiänderungen und wichtige Entscheidungen', 'pt-BR': 'Resume os turnos antigos e mantém objetivos, alterações de arquivos e decisões importantes', ru: 'Сжимает старые ходы, сохраняя цели, изменения файлов и ключевые решения', ar: 'يلخّص الجولات الأقدم ويحتفظ بالأهداف وتغييرات الملفات والقرارات المهمة', hi: 'पुराने टर्न का सार बनाता है और लक्ष्य, फ़ाइल बदलाव व अहम फ़ैसले रखता है' },
    '撤回上轮改动': { ja: '前のターンの変更を元に戻す', ko: '이전 턴의 변경 되돌리기', es: 'Deshacer cambios del último turno', fr: 'Annuler les modifications du dernier échange', de: 'Änderungen der letzten Runde rückgängig machen', 'pt-BR': 'Desfazer alterações do último turno', ru: 'Отменить изменения последнего хода', ar: 'التراجع عن تغييرات الجولة الأخيرة', hi: 'पिछले टर्न के बदलाव पूर्ववत करें' },
    '打开最近一轮代码检查点恢复确认，安全回滚本轮修改的文件': { ja: '直近のチェックポイントの復元確認を開き、そのターンで変更したファイルを安全に戻します', ko: '최근 체크포인트 복원 확인을 열어 그 턴에서 바꾼 파일을 안전하게 되돌립니다', es: 'Abre la confirmación para restaurar el último punto de control y revertir los archivos de ese turno', fr: 'Ouvre la confirmation de restauration du dernier point de contrôle pour rétablir les fichiers de cet échange', de: 'Öffnet die Bestätigung, um den letzten Prüfpunkt wiederherzustellen und die Dateien dieser Runde zurückzusetzen', 'pt-BR': 'Abre a confirmação para restaurar o último ponto de verificação e reverter os arquivos desse turno', ru: 'Открывает подтверждение отката к последней контрольной точке, чтобы вернуть файлы этого хода', ar: 'يفتح تأكيد استعادة آخر نقطة تحقق لإرجاع الملفات التي غيّرتها تلك الجولة بأمان', hi: 'पिछले चेकपॉइंट को बहाल करने की पुष्टि खोलता है, ताकि उस टर्न में बदली फ़ाइलें सुरक्षित रूप से लौटें' },
    '先出方案': { ja: '先に計画', ko: '먼저 계획', es: 'Planificar primero', fr: 'Planifier d’abord', de: 'Erst planen', 'pt-BR': 'Planejar primeiro', ru: 'Сначала план', ar: 'الخطة أولًا', hi: 'पहले योजना' },
    '先深入调研代码并输出分步架构与改动计划，未经您确认绝不修改文件': { ja: 'まずコードを調べて段階的な計画を示し、確認なしにファイルは変更しません', ko: '먼저 코드를 살펴 단계별 계획을 제시하며, 확인 전에는 파일을 수정하지 않습니다', es: 'Analiza el código y propone un plan paso a paso; no edita archivos sin tu confirmación', fr: 'Étudie le code et propose un plan étape par étape ; aucun fichier modifié sans votre accord', de: 'Untersucht den Code und legt einen Schritt-für-Schritt-Plan vor; ändert ohne Ihre Bestätigung keine Dateien', 'pt-BR': 'Analisa o código e apresenta um plano passo a passo; não edita arquivos sem sua confirmação', ru: 'Изучает код и предлагает пошаговый план; без вашего подтверждения файлы не меняет', ar: 'يدرس الشيفرة ويقدّم خطة خطوة بخطوة، ولا يعدّل أي ملف قبل تأكيدك', hi: 'पहले कोड जाँचकर चरण-दर-चरण योजना देता है; आपकी पुष्टि के बिना कोई फ़ाइल नहीं बदलता' },
    '<任务描述>': { ja: '<タスク>', ko: '<작업>', es: '<tarea>', fr: '<tâche>', de: '<Aufgabe>', 'pt-BR': '<tarefa>', ru: '<задача>', ar: '<المهمة>', hi: '<कार्य>' },
    '持续目标': { ja: '継続目標', ko: '지속 목표', es: 'Objetivo persistente', fr: 'Objectif persistant', de: 'Dauerziel', 'pt-BR': 'Meta contínua', ru: 'Постоянная цель', ar: 'هدف مستمر', hi: 'स्थायी लक्ष्य' },
    '打开持续目标输入栏，让智能体围绕目标多轮推进直至达成': { ja: '継続目標の入力欄を開き、達成するまでエージェントが複数ターンで進めます', ko: '지속 목표 입력란을 열어 목표를 이룰 때까지 에이전트가 여러 턴에 걸쳐 진행합니다', es: 'Abre la barra de objetivo persistente para que el agente avance en varios turnos hasta lograrlo', fr: 'Ouvre la barre d’objectif persistant pour que l’agent avance sur plusieurs échanges jusqu’au résultat', de: 'Öffnet die Dauerziel-Leiste, damit der Agent über mehrere Runden bis zum Ziel weiterarbeitet', 'pt-BR': 'Abre a barra de meta contínua para o agente avançar em vários turnos até concluí-la', ru: 'Открывает поле постоянной цели: агент работает несколько ходов, пока не достигнет её', ar: 'يفتح شريط الهدف المستمر ليواصل الوكيل عبر عدة جولات حتى يحققه', hi: 'स्थायी लक्ष्य बार खोलता है, ताकि एजेंट लक्ष्य पूरा होने तक कई टर्न में आगे बढ़े' },
    '代码审查': { ja: 'コードレビュー', ko: '코드 리뷰', es: 'Revisión de código', fr: 'Revue de code', de: 'Code-Review', 'pt-BR': 'Revisão de código', ru: 'Ревью кода', ar: 'مراجعة الشيفرة', hi: 'कोड समीक्षा' },
    '只读检查未提交的 git status 与 git diff，排查缺陷、回归与安全隐患': { ja: '未コミットの git status と diff を読み取り専用で確認し、バグ・回帰・リスクを探します', ko: '커밋하지 않은 git status와 diff를 읽기 전용으로 검사해 버그, 회귀, 위험을 찾습니다', es: 'Revisa en modo de solo lectura el git status y el diff sin confirmar en busca de errores, regresiones y riesgos', fr: 'Inspecte en lecture seule le git status et le diff non validés pour repérer bogues, régressions et risques', de: 'Prüft git status und diff ohne Commit schreibgeschützt auf Fehler, Regressionen und Risiken', 'pt-BR': 'Inspeciona, somente leitura, o git status e o diff sem commit em busca de bugs, regressões e riscos', ru: 'Только чтение: проверяет незакоммиченные git status и diff на ошибки, регрессии и риски', ar: 'يفحص git status وdiff غير المُودَعة للقراءة فقط بحثًا عن الأخطاء والتراجعات والمخاطر', hi: 'बिना कमिट वाले git status और diff को केवल पढ़कर बग, रिग्रेशन और जोखिम खोजता है' },
    '[审查重点]': { ja: '[重点]', ko: '[중점]', es: '[enfoque]', fr: '[priorité]', de: '[Schwerpunkt]', 'pt-BR': '[foco]', ru: '[фокус]', ar: '[التركيز]', hi: '[फ़ोकस]' },
    '提交代码': { ja: '変更をコミット', ko: '변경 사항 커밋', es: 'Hacer commit de los cambios', fr: 'Committer les modifications', de: 'Änderungen committen', 'pt-BR': 'Fazer commit das alterações', ru: 'Закоммитить изменения', ar: 'إيداع التغييرات', hi: 'बदलाव कमिट करें' },
    '核查 git status 与 diff，确认无密钥泄漏后生成规范提交信息并执行 git commit': { ja: 'git status と diff で秘密情報の漏れがないか確認し、規約に沿ったメッセージで git commit します', ko: 'git status와 diff에서 비밀 정보가 새지 않는지 확인하고 규칙에 맞는 메시지로 git commit합니다', es: 'Comprueba git status y el diff para no exponer secretos, redacta un mensaje convencional y ejecuta git commit', fr: 'Vérifie git status et le diff pour n’exposer aucun secret, rédige un message conventionnel et lance git commit', de: 'Prüft git status und diff auf offengelegte Geheimnisse, verfasst eine konventionelle Nachricht und führt git commit aus', 'pt-BR': 'Verifica git status e o diff para não expor segredos, escreve uma mensagem convencional e executa git commit', ru: 'Проверяет git status и diff на утечку секретов, пишет сообщение по соглашениям и выполняет git commit', ar: 'يتحقق من git status وdiff لتجنّب تسريب الأسرار، ثم يكتب رسالة متعارفًا عليها وينفّذ git commit', hi: 'git status और diff में सीक्रेट लीक न होने की जाँच करता है, मानक संदेश लिखता है और git commit चलाता है' },
    '[提交备注]': { ja: '[メッセージ]', ko: '[메시지]', es: '[mensaje]', fr: '[message]', de: '[Nachricht]', 'pt-BR': '[mensagem]', ru: '[сообщение]', ar: '[الرسالة]', hi: '[संदेश]' },
    '生成 AGENTS.md': { ja: 'AGENTS.md を生成', ko: 'AGENTS.md 생성', es: 'Generar AGENTS.md', fr: 'Générer AGENTS.md', de: 'AGENTS.md erstellen', 'pt-BR': 'Gerar AGENTS.md', ru: 'Создать AGENTS.md', ar: 'إنشاء AGENTS.md', hi: 'AGENTS.md बनाएँ' },
    '分析仓库目录、构建测试命令与架构约定，创建或更新 AGENTS.md': { ja: 'リポジトリの構成、ビルドとテストのコマンド、規約を調べて AGENTS.md を作成・更新します', ko: '저장소 구조, 빌드·테스트 명령, 규칙을 분석해 AGENTS.md를 만들거나 업데이트합니다', es: 'Analiza la estructura del repositorio, los comandos de compilación y prueba y las convenciones para crear o actualizar AGENTS.md', fr: 'Analyse la structure du dépôt, les commandes de build et de test et les conventions pour créer ou mettre à jour AGENTS.md', de: 'Analysiert Repository-Aufbau, Build- und Testbefehle sowie Konventionen und erstellt oder aktualisiert AGENTS.md', 'pt-BR': 'Analisa a estrutura do repositório, os comandos de build e teste e as convenções para criar ou atualizar o AGENTS.md', ru: 'Изучает структуру репозитория, команды сборки и тестов и соглашения, чтобы создать или обновить AGENTS.md', ar: 'يحلّل بنية المستودع وأوامر البناء والاختبار والأعراف لإنشاء AGENTS.md أو تحديثه', hi: 'रिपॉज़िटरी की संरचना, बिल्ड/टेस्ट कमांड और नियम देखकर AGENTS.md बनाता या अपडेट करता है' },
    '[补充说明]': { ja: '[補足]', ko: '[참고]', es: '[notas]', fr: '[notes]', de: '[Hinweise]', 'pt-BR': '[notas]', ru: '[примечания]', ar: '[ملاحظات]', hi: '[नोट्स]' },
    '议会模式': { ja: '文殊モード', ko: '집단지성 모드', es: 'Modo Equipo', fr: 'Mode Équipe', de: 'Teammodus', 'pt-BR': 'Modo Equipe', ru: 'Команда моделей', ar: 'وضع التعاون', hi: 'टीम मोड' },
    '配置多模型专家角色协作（臭皮匠模式）': { ja: '複数モデルに専門の役割を割り当てて協働させます（文殊モード）', ko: '여러 모델에 전문 역할을 맡겨 협업하게 합니다(집단지성 모드)', es: 'Configura la colaboración de varios modelos con roles especializados (Modo Equipo)', fr: 'Configure la collaboration de plusieurs modèles par rôles spécialisés (Mode Équipe)', de: 'Richtet die Zusammenarbeit mehrerer Modelle mit Fachrollen ein (Teammodus)', 'pt-BR': 'Configura a colaboração de vários modelos com funções especializadas (Modo Equipe)', ru: 'Настраивает совместную работу нескольких моделей по ролям («Команда моделей»)', ar: 'يضبط تعاون عدة نماذج بأدوار متخصصة (وضع التعاون)', hi: 'कई मॉडलों को विशेषज्ञ भूमिकाएँ देकर साथ काम कराता है (टीम मोड)' },
    '操控电脑应用': { ja: 'デスクトップアプリを操作', ko: '데스크톱 앱 제어', es: 'Controlar una app de escritorio', fr: 'Contrôler une application', de: 'Desktop-App steuern', 'pt-BR': 'Controlar um app da área de trabalho', ru: 'Управлять приложением', ar: 'التحكم في تطبيق سطح المكتب', hi: 'डेस्कटॉप ऐप नियंत्रित करें' },
    '选择本机运行中的应用窗口，授权当前对话协同查看与操控': { ja: '実行中のアプリのウィンドウを選び、この会話に表示と操作を許可します', ko: '실행 중인 앱 창을 골라 이 대화가 보고 조작하도록 허용합니다', es: 'Elige la ventana de una app abierta y permite que esta conversación la vea y la controle', fr: 'Choisissez la fenêtre d’une application ouverte que cette conversation pourra voir et contrôler', de: 'Wählen Sie ein geöffnetes App-Fenster, das diese Unterhaltung sehen und steuern darf', 'pt-BR': 'Escolha a janela de um app aberto para esta conversa ver e controlar', ru: 'Выберите окно запущенного приложения, чтобы этот диалог мог видеть его и управлять им', ar: 'اختر نافذة تطبيق قيد التشغيل لتتمكن هذه المحادثة من رؤيتها والتحكم فيها', hi: 'चल रहे ऐप की कोई विंडो चुनें, ताकि यह बातचीत उसे देख और नियंत्रित कर सके' },
    '正在读取窗口列表…': { ja: 'ウィンドウ一覧を読み込み中…', ko: '창 목록을 불러오는 중…', es: 'Cargando ventanas…', fr: 'Chargement des fenêtres…', de: 'Fenster werden geladen…', 'pt-BR': 'Carregando janelas…', ru: 'Загрузка списка окон…', ar: 'جارٍ تحميل قائمة النوافذ…', hi: 'विंडो सूची लोड हो रही है…' },
    '切换模型': { ja: 'モデルを切り替え', ko: '모델 전환', es: 'Cambiar de modelo', fr: 'Changer de modèle', de: 'Modell wechseln', 'pt-BR': 'Trocar de modelo', ru: 'Сменить модель', ar: 'تبديل النموذج', hi: 'मॉडल बदलें' },
    '打开主输入框模型选择抽屉': { ja: '入力欄のモデル選択パネルを開きます', ko: '입력창의 모델 선택 패널을 엽니다', es: 'Abre el selector de modelos del cuadro de mensaje', fr: 'Ouvre le sélecteur de modèle de la zone de saisie', de: 'Öffnet die Modellauswahl des Eingabefelds', 'pt-BR': 'Abre o seletor de modelos da caixa de mensagem', ru: 'Открывает выбор модели в поле ввода', ar: 'يفتح أداة اختيار النموذج في مربع الكتابة', hi: 'इनपुट बॉक्स का मॉडल चयन पैनल खोलता है' },
    '切换中转商': { ja: '中継事業者 / 自前の API を切り替え', ko: '중계 사업자 / 자체 API 전환', es: 'Cambiar revendedor / API propia', fr: 'Changer de revendeur / API personnelle', de: 'Reseller / eigene API wechseln', 'pt-BR': 'Trocar revendedor / API própria', ru: 'Сменить посредника / свой API', ar: 'تبديل الموزّع / واجهتك البرمجية', hi: 'रीसेलर / अपना API बदलें' },
    '打开中转商与自有 API 选择抽屉': { ja: '中継事業者と自前の API の選択パネルを開きます', ko: '중계 사업자와 자체 API 선택 패널을 엽니다', es: 'Abre el selector de revendedores y API propias', fr: 'Ouvre le sélecteur de revendeurs et d’API personnelles', de: 'Öffnet die Auswahl für Reseller und eigene APIs', 'pt-BR': 'Abre o seletor de revendedores e APIs próprias', ru: 'Открывает выбор посредника или своего API', ar: 'يفتح أداة اختيار الموزّعين وواجهاتك البرمجية', hi: 'रीसेलर और अपने API का चयन पैनल खोलता है' },
    '切换权限': { ja: '権限を切り替え', ko: '권한 전환', es: 'Cambiar permisos', fr: 'Changer les autorisations', de: 'Berechtigungen wechseln', 'pt-BR': 'Alterar permissões', ru: 'Сменить разрешения', ar: 'تبديل الأذونات', hi: 'अनुमतियाँ बदलें' },
    '调整当前对话的只读、工作区写入或完全访问权限档位': { ja: 'この会話の権限を読み取り専用・ワークスペースへの書き込み・フルアクセスから選びます', ko: '이 대화의 권한을 읽기 전용, 작업 공간 쓰기, 전체 액세스 중에서 고릅니다', es: 'Elige para esta conversación solo lectura, escritura en el espacio de trabajo o acceso completo', fr: 'Choisit pour cette conversation la lecture seule, l’écriture dans l’espace de travail ou l’accès complet', de: 'Wählt für diese Unterhaltung Nur-Lesen, Schreiben im Arbeitsbereich oder Vollzugriff', 'pt-BR': 'Escolhe para esta conversa somente leitura, escrita no espaço de trabalho ou acesso total', ru: 'Переключает права диалога: только чтение, запись в рабочую область или полный доступ', ar: 'يبدّل أذونات هذه المحادثة بين القراءة فقط والكتابة في مساحة العمل والوصول الكامل', hi: 'इस बातचीत की अनुमति केवल-पढ़ें, वर्कस्पेस-लेखन या पूर्ण पहुँच में बदलता है' },
    '管理 MCP 服务': { ja: 'MCP サーバーを管理', ko: 'MCP 서버 관리', es: 'Gestionar servidores MCP', fr: 'Gérer les serveurs MCP', de: 'MCP-Server verwalten', 'pt-BR': 'Gerenciar servidores MCP', ru: 'Управление серверами MCP', ar: 'إدارة خوادم MCP', hi: 'MCP सर्वर प्रबंधित करें' },
    '前往设置中心查看、添加或配置 MCP 工具服务': { ja: '設定 → MCP を開き、MCP サーバーを確認・追加・設定します', ko: '설정 → MCP를 열어 MCP 서버를 확인, 추가, 구성합니다', es: 'Abre Configuración → MCP para ver, añadir o configurar servidores MCP', fr: 'Ouvre Réglages → MCP pour afficher, ajouter ou configurer des serveurs MCP', de: 'Öffnet Einstellungen → MCP, um MCP-Server anzuzeigen, hinzuzufügen oder zu konfigurieren', 'pt-BR': 'Abre Configurações → MCP para ver, adicionar ou configurar servidores MCP', ru: 'Открывает Настройки → MCP, чтобы просмотреть, добавить или настроить серверы MCP', ar: 'يفتح الإعدادات ← MCP لعرض خوادم MCP أو إضافتها أو ضبطها', hi: 'सेटिंग्स → MCP खोलकर MCP सर्वर देखें, जोड़ें या कॉन्फ़िगर करें' },
    '[任务说明]': { ja: '[タスク]', ko: '[작업]', es: '[tarea]', fr: '[tâche]', de: '[Aufgabe]', 'pt-BR': '[tarefa]', ru: '[задача]', ar: '[المهمة]', hi: '[कार्य]' },
    '斜杠快捷命令': { ja: 'スラッシュコマンド', ko: '슬래시 명령', es: 'Comandos de barra', fr: 'Commandes slash', de: 'Slash-Befehle', 'pt-BR': 'Comandos de barra', ru: 'Слэш-команды', ar: 'أوامر الشرطة المائلة', hi: 'स्लैश कमांड' }
};

function pickLocaleCopy(locale: NextMuxDesktopLocale, zhCN: string, zhTW: string, en: string): string {
    if (locale === 'zh-CN') return zhCN;
    if (locale === 'zh-TW') return zhTW;
    return SLASH_COPY[zhCN]?.[locale] ?? en;
}

export function slashGroupLabel(locale: NextMuxDesktopLocale, group: ComposerSlashGroupId): string {
    switch (group) {
        case 'context':
            return pickLocaleCopy(locale, '上下文与会话', '上下文與會話', 'Context & Session');
        case 'workflow':
            return pickLocaleCopy(locale, '研发高频动作', '研發高頻動作', 'Engineering Workflows');
        case 'shortcut':
            return pickLocaleCopy(locale, 'NextMux 快捷入口', 'NextMux 快捷入口', 'NextMux Shortcuts');
        case 'skills':
            return pickLocaleCopy(locale, '技能与扩展', '技能與擴充', 'Skills & MCP');
    }
}

export function slashFooterHint(locale: NextMuxDesktopLocale): string {
    return pickLocaleCopy(
        locale,
        '↑↓ 选择 · Tab 补全 · ↵ 执行 · Esc 关闭',
        '↑↓ 選擇 · Tab 補全 · ↵ 執行 · Esc 關閉',
        '↑↓ Navigate · Tab Complete · ↵ Run · Esc Dismiss'
    );
}

export function normalizeSkillSlashSlug(rawName: string): string {
    const cleaned = String(rawName || '')
        .trim()
        .replace(/^\/+/, '')
        .replace(/\s+/gu, '-')
        .replace(/[^\p{L}\p{N}_.:-]/gu, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!cleaned) return '';
    const lower = cleaned.toLowerCase();
    return BUILTIN_SLASH_SLUGS.has(lower) ? `${cleaned}-skill` : cleaned;
}

export interface ResolvedComposerSlashSkill {
    readonly slug: string;
    readonly skill: ComposerSlashSkillInfo;
}

/**
 * Shared skill-to-slash-slug resolver used by BOTH `buildComposerSlashCommands` and
 * `expandComposerSlashSubmission` so built-in commands (`/review`, `/mcp`, etc.) can
 * never be hijacked by same-named skills (`-> /review-skill`) and duplicate skill names
 * deterministically receive `-2`, `-3` suffixes across both menu rendering and execution.
 */
export function resolveComposerSlashSkills(
    skills: readonly ComposerSlashSkillInfo[] = []
): readonly ResolvedComposerSlashSkill[] {
    const seenSlugs = new Set<string>(BUILTIN_SLASH_SLUGS);
    const resolved: ResolvedComposerSlashSkill[] = [];
    for (const skill of skills || []) {
        const baseSlug = normalizeSkillSlashSlug(skill.name);
        if (!baseSlug) continue;
        let slug = baseSlug;
        let suffix = 2;
        while (seenSlugs.has(slug.toLowerCase())) {
            slug = `${baseSlug}-${suffix++}`;
        }
        seenSlugs.add(slug.toLowerCase());
        resolved.push({ slug, skill });
    }
    return resolved;
}

/**
 * Matches `/` at the collapsed caret ONLY when:
 * 1. Not IME-composing (`composing === false`).
 * 2. Selection is collapsed (`selectionStart === selectionEnd`).
 * 3. `/` is at index `0` or immediately preceded by whitespace.
 * 4. The contiguous non-whitespace word containing `/` has NO additional `/` or `\`
 *    (so file paths like `/Users/xuhao/a.ts` or URLs like `https://nextmux.app` never trigger).
 */
export function matchComposerSlashTrigger(
    text: string,
    selectionStart: number | null | undefined,
    selectionEnd: number | null | undefined,
    composing: boolean
): ComposerSlashMatch | undefined {
    if (composing || typeof text !== 'string') return undefined;
    const start = selectionStart ?? text.length;
    const end = selectionEnd ?? start;
    if (start !== end || start < 0 || start > text.length) return undefined;

    const beforeCaret = text.slice(0, start);
    const match = SLASH_TRIGGER_BEFORE_CARET.exec(beforeCaret);
    if (!match) return undefined;

    const query = match[1] || '';
    const slashIndex = start - query.length - 1;
    if (slashIndex < 0 || text[slashIndex] !== '/') return undefined;

    let wordEnd = start;
    while (wordEnd < text.length && !/\s/u.test(text[wordEnd])) {
        wordEnd++;
    }
    const afterSlashWord = text.slice(slashIndex + 1, wordEnd);
    if (afterSlashWord.includes('/') || afterSlashWord.includes('\\') || !/^[\p{L}\p{N}_.:-]*$/u.test(afterSlashWord)) {
        return undefined;
    }
    if (wordEnd > start) {
        return undefined;
    }

    return {
        slashIndex,
        endIndex: start,
        query,
        token: text.slice(slashIndex, start)
    };
}

/** Removes the matched `/command` token cleanly while preserving surrounding user text and caret position. */
export function removeComposerSlashToken(
    text: string,
    match: Pick<ComposerSlashMatch, 'slashIndex' | 'endIndex'>
): { readonly value: string; readonly caret: number } {
    const before = text.slice(0, match.slashIndex);
    const after = text.slice(match.endIndex);
    if (!before) {
        const trimmedAfter = after.replace(/^[ \t]+/, '');
        return { value: trimmedAfter, caret: 0 };
    }
    if (/[ \t]$/u.test(before) && /^[ \t]/u.test(after)) {
        const nextAfter = after.replace(/^[ \t]+/, '');
        return { value: before + nextAfter, caret: before.length };
    }
    if (!after && /[ \t]$/u.test(before)) {
        const trimmedBefore = before.replace(/[ \t]+$/u, '');
        return { value: trimmedBefore, caret: trimmedBefore.length };
    }
    return { value: before + after, caret: before.length };
}

/** Replaces the matched `/query` token with `/<slug> ` for Tab completion or task-input commands. */
export function replaceComposerSlashToken(
    text: string,
    match: Pick<ComposerSlashMatch, 'slashIndex' | 'endIndex'>,
    slug: string,
    trailingSpace = true
): { readonly value: string; readonly caret: number } {
    const before = text.slice(0, match.slashIndex);
    const after = text.slice(match.endIndex);
    const needsSpace = trailingSpace && (!after || !/^\s/u.test(after));
    const inserted = `/${slug}${needsSpace ? ' ' : ''}`;
    const nextCaret = before.length + inserted.length + (!needsSpace && trailingSpace && after.startsWith(' ') ? 1 : 0);
    return {
        value: before + inserted + after,
        caret: Math.min((before + inserted + after).length, nextCaret)
    };
}

export function isSlashDrawerSuppressedByCompetingSurface(surfaces: CompetingComposerSurfaces): boolean {
    return Boolean(
        surfaces.codingPopover
        || surfaces.appControlPickerOpen
        || surfaces.accountMenuOpen
        || surfaces.goalDrawer
        || surfaces.goalCloseConfirmation
        || surfaces.walletTopupSheetOpen
        || surfaces.officialProviderSheet
        || surfaces.officialModelListOpenId
        || surfaces.myApisOpen
        || surfaces.councilConfigModalOpen
        || surfaces.scheduleDialogOpen
        || surfaces.fullAccessConfirmationOpen
        || surfaces.pendingDurableRetry
        || surfaces.pendingRestoreConfirmation
        || surfaces.pendingIncognitoMode
        || surfaces.pendingRelaySwitch
        || surfaces.selectedOffering
        || surfaces.activeCheckpointDiff
        || surfaces.appPluginChatPicker
        || surfaces.appPluginStart
        || surfaces.appPluginHub
        || surfaces.codingSearchOpen
        || surfaces.pendingTurnEdit
    );
}

export function buildComposerSlashCommands(state: ComposerSlashContextState): readonly ComposerSlashCommandItem[] {
    const { locale } = state;
    const compactDisabledReason = state.agentRunning
        ? pickLocaleCopy(locale, '对话运行中，完成后再压缩', '對話運行中，完成後再壓縮', 'Wait for current run to finish')
        : state.isCompacting
            ? pickLocaleCopy(locale, '正在压缩上下文…', '正在壓縮上下文…', 'Compacting context…')
            : (!state.hasActiveSession || state.completedTurnCount < 2)
                ? pickLocaleCopy(locale, '至少完成 2 轮对话后可压缩', '至少完成 2 輪對話後可壓縮', 'Requires at least 2 completed turns')
                : undefined;

    const undoDisabledReason = state.agentRunning
        ? pickLocaleCopy(locale, '对话运行中暂不可撤回', '對話運行中暫不可撤回', 'Cannot undo while agent is running')
        : !state.hasRestorableTurn
            ? pickLocaleCopy(locale, '暂无可撤回的文件改动', '暫無可撤回的檔案改動', 'No restorable file changes yet')
            : undefined;

    const councilLockedReason = state.councilActiveOrPending
        ? (state.councilDisabledNotice || pickLocaleCopy(locale, '议会模式启用中，请在议会配置中调整', '議會模式啟用中，請在議會配置中調整', 'Locked while Council Mode is active'))
        : undefined;

    // One flat list with related commands next to each other.
    const items: ComposerSlashCommandItem[] = [
        // Session & context
        {
            id: 'cmd:new',
            kind: 'new',
            group: 'context',
            slug: 'new',
            title: pickLocaleCopy(locale, '新建对话', '新建對話', 'New Conversation'),
            description: pickLocaleCopy(
                locale,
                '在当前项目工作区立即创建并切换到全新对话',
                '在當前專案工作區立即建立並切換到全新對話',
                'Create and switch to a clean new conversation in the current workspace'
            ),
            icon: 'comment-discussion',
            keywords: ['new', 'clear', 'fresh', 'session', 'chat', '新建', '新对话', '清空', '開啟新對話']
        },
        {
            id: 'cmd:compact',
            kind: 'compact',
            group: 'context',
            slug: 'compact',
            title: pickLocaleCopy(locale, '压缩上下文', '壓縮上下文', 'Compact Context'),
            description: pickLocaleCopy(
                locale,
                '精炼早期对话历史，保留核心目标、文件改动与关键决策以释放上下文窗口',
                '精煉早期對話歷史，保留核心目標、檔案改動與關鍵決策以釋放上下文視窗',
                'Summarize older turns while keeping goals, file changes, and key decisions'
            ),
            icon: 'fold',
            disabled: Boolean(compactDisabledReason),
            disabledReason: compactDisabledReason,
            keywords: ['compact', 'compress', 'context', 'summary', '压缩', '精简', '上下文', '总结', '壓縮']
        },
        {
            id: 'cmd:undo',
            kind: 'undo',
            group: 'context',
            slug: 'undo',
            title: pickLocaleCopy(locale, '撤回上轮改动', '撤回上輪改動', 'Undo Last Turn Changes'),
            description: pickLocaleCopy(
                locale,
                '打开最近一轮代码检查点恢复确认，安全回滚本轮修改的文件',
                '開啟最近一輪程式碼檢查點恢復確認，安全回滾本輪修改的檔案',
                'Open checkpoint restore confirmation for the latest restorable turn'
            ),
            icon: 'discard',
            disabled: Boolean(undoDisabledReason),
            disabledReason: undoDisabledReason,
            keywords: ['undo', 'revert', 'restore', 'rollback', 'checkpoint', '撤回', '撤销', '回滚', '恢复', '還原']
        },
        // Planning & workflows
        {
            id: 'cmd:plan',
            kind: 'plan',
            group: 'workflow',
            slug: 'plan',
            title: pickLocaleCopy(locale, '先出方案', '先出方案', 'Plan First'),
            description: pickLocaleCopy(
                locale,
                '先深入调研代码并输出分步架构与改动计划，未经您确认绝不修改文件',
                '先深入調研程式碼並輸出分步架構與改動計劃，未經您確認絕不修改檔案',
                'Inspect codebase and output a concrete step-by-step plan first before editing any files'
            ),
            icon: 'list-tree',
            argHint: pickLocaleCopy(locale, '<任务描述>', '<任務描述>', '<task>'),
            acceptsArgs: true,
            requiresTaskInput: true,
            keywords: ['plan', 'design', 'architect', 'spec', '方案', '计划', '规划', '设计', '先出方案', '規劃']
        },
        {
            id: 'cmd:goal',
            kind: 'goal',
            group: 'workflow',
            slug: 'goal',
            title: pickLocaleCopy(locale, '持续目标', '持續目標', 'Persistent Goal'),
            description: pickLocaleCopy(
                locale,
                '打开持续目标输入栏，让智能体围绕目标多轮推进直至达成',
                '開啟持續目標輸入欄，讓智慧體圍繞目標多輪推進直至達成',
                'Open the Persistent Goal bar for autonomous multi-turn execution'
            ),
            icon: 'target',
            keywords: ['goal', 'autonomous', 'target', 'loop', '目标', '持续目标', '长期任务', '目標']
        },
        {
            id: 'cmd:review',
            kind: 'review',
            group: 'workflow',
            slug: 'review',
            title: pickLocaleCopy(locale, '代码审查', '程式碼審查', 'Code Review'),
            description: pickLocaleCopy(
                locale,
                '只读检查未提交的 git status 与 git diff，排查缺陷、回归与安全隐患',
                '唯讀檢查未提交的 git status 與 git diff，排查缺陷、回歸與安全隱患',
                'Read-only inspection of uncommitted git status & diff for bugs, regressions, and risks'
            ),
            icon: 'eye',
            argHint: pickLocaleCopy(locale, '[审查重点]', '[審查重點]', '[focus]'),
            acceptsArgs: true,
            keywords: ['review', 'diff', 'audit', 'bug', 'security', '审查', '代码审查', '检视', '走查', '審查']
        },
        {
            id: 'cmd:commit',
            kind: 'commit',
            group: 'workflow',
            slug: 'commit',
            title: pickLocaleCopy(locale, '提交代码', '提交程式碼', 'Commit Changes'),
            description: pickLocaleCopy(
                locale,
                '核查 git status 与 diff，确认无密钥泄漏后生成规范提交信息并执行 git commit',
                '核查 git status 與 diff，確認無金鑰洩漏後生成規範提交訊息並執行 git commit',
                'Verify git status & diff for safety, craft a conventional message, and run git commit'
            ),
            icon: 'git-commit',
            argHint: pickLocaleCopy(locale, '[提交备注]', '[提交備註]', '[message]'),
            acceptsArgs: true,
            keywords: ['commit', 'git', 'save', '提交', '提交代码', '版本']
        },
        {
            id: 'cmd:init',
            kind: 'init',
            group: 'workflow',
            slug: 'init',
            title: pickLocaleCopy(locale, '生成 AGENTS.md', '生成 AGENTS.md', 'Generate AGENTS.md'),
            description: pickLocaleCopy(
                locale,
                '分析仓库目录、构建测试命令与架构约定，创建或更新 AGENTS.md',
                '分析倉庫目錄、建置測試命令與架構約定，建立或更新 AGENTS.md',
                'Inspect repository layout, build/test scripts, and conventions to create or update AGENTS.md'
            ),
            icon: 'book',
            argHint: pickLocaleCopy(locale, '[补充说明]', '[補充說明]', '[notes]'),
            acceptsArgs: true,
            keywords: ['init', 'agents', 'agents.md', 'onboarding', 'guide', '初始化', '生成', '规范', '文档']
        },
        // Agent & model controls
        {
            id: 'cmd:council',
            kind: 'council',
            group: 'shortcut',
            slug: 'council',
            title: pickLocaleCopy(locale, '议会模式', '議會模式', 'Council Mode'),
            description: pickLocaleCopy(
                locale,
                '配置多模型专家角色协作（臭皮匠模式）',
                '配置多模型專家角色協作（臭皮匠模式）',
                'Configure multi-model specialist collaboration (Council Mode)'
            ),
            icon: 'organization',
            keywords: ['council', 'team', 'multi-agent', 'specialists', '议会', '臭皮匠', '多模型', '团队', '議會']
        },
        ...(state.appControlAvailable ? [{
            id: 'cmd:app',
            kind: 'app' as const,
            group: 'shortcut' as const,
            slug: 'app',
            title: pickLocaleCopy(locale, '操控电脑应用', '操控電腦應用', 'Control Desktop App'),
            description: pickLocaleCopy(
                locale,
                '选择本机运行中的应用窗口，授权当前对话协同查看与操控',
                '選擇本機運行中的應用視窗，授權當前對話協同查看與操控',
                'Pick a desktop application window for live inspection and control'
            ),
            icon: 'window',
            disabled: Boolean(state.composerAppPicking),
            disabledReason: state.composerAppPicking
                ? pickLocaleCopy(locale, '正在读取窗口列表…', '正在讀取視窗列表…', 'Loading application windows…')
                : undefined,
            keywords: ['app', 'window', 'desktop', 'control', '应用', '窗口', '操控', '电脑应用', '應用']
        }] : []),
        {
            id: 'cmd:model',
            kind: 'model',
            group: 'shortcut',
            slug: 'model',
            title: pickLocaleCopy(locale, '切换模型', '切換模型', 'Switch Model'),
            description: pickLocaleCopy(
                locale,
                '打开主输入框模型选择抽屉',
                '開啟主輸入框模型選擇抽屜',
                'Open the main composer Model Picker drawer'
            ),
            icon: 'zap',
            disabled: Boolean(councilLockedReason),
            disabledReason: councilLockedReason,
            keywords: ['model', 'llm', 'switch', 'route', '模型', '切换模型', '选模型', '切換模型']
        },
        {
            id: 'cmd:relay',
            kind: 'relay',
            group: 'shortcut',
            slug: 'relay',
            title: pickLocaleCopy(locale, '切换中转商', '切換中轉商', 'Switch Relay / Own API'),
            description: pickLocaleCopy(
                locale,
                '打开中转商与自有 API 选择抽屉',
                '開啟中轉商與自有 API 選擇抽屜',
                'Open the Relay Merchant & Own-API selector drawer'
            ),
            icon: 'server-environment',
            disabled: Boolean(councilLockedReason),
            disabledReason: councilLockedReason,
            keywords: ['relay', 'provider', 'merchant', 'api', 'byok', '中转', '中转商', '自有api', '渠道', '切換中轉商']
        },
        {
            id: 'cmd:permissions',
            kind: 'permissions',
            group: 'shortcut',
            slug: 'permissions',
            title: pickLocaleCopy(locale, '切换权限', '切換權限', 'Tool Permissions'),
            description: pickLocaleCopy(
                locale,
                '调整当前对话的只读、工作区写入或完全访问权限档位',
                '調整當前對話的唯讀、工作區寫入或完全存取權限檔位',
                'Switch between read-only, workspace-write, and full-access permissions'
            ),
            icon: 'shield',
            keywords: ['permissions', 'permission', 'access', 'sandbox', 'security', '权限', '切换权限', '沙盒', '完全访问', '權限']
        },
        // Extensions & skills (the installed skills follow)
        {
            id: 'cmd:mcp',
            kind: 'mcp',
            group: 'skills',
            slug: 'mcp',
            title: pickLocaleCopy(locale, '管理 MCP 服务', '管理 MCP 服務', 'Manage MCP Servers'),
            description: pickLocaleCopy(
                locale,
                '前往设置中心查看、添加或配置 MCP 工具服务',
                '前往設定中心查看、新增或配置 MCP 工具服務',
                'Open Settings → MCP to configure and inspect MCP servers'
            ),
            icon: 'plug',
            keywords: ['mcp', 'tools', 'server', 'extension', '服务', '工具', '扩展', '管理mcp']
        }
    ];

    for (const { slug, skill } of resolveComposerSlashSkills(state.skills)) {
        const summary = (skill.description || '').replace(/\s+/g, ' ').trim()
            || pickLocaleCopy(locale, `启用已安装技能 ${skill.name}`, `啟用已安裝技能 ${skill.name}`, `Apply installed skill ${skill.name}`);
        items.push({
            id: `skill:${skill.location || `${skill.name}:${slug}`}`,
            kind: 'skill',
            group: 'skills',
            slug,
            title: skill.name,
            description: summary,
            icon: 'sparkle',
            argHint: pickLocaleCopy(locale, '[任务说明]', '[任務說明]', '[task]'),
            badge: 'SKILL',
            acceptsArgs: true,
            requiresTaskInput: true,
            skillName: skill.name,
            keywords: [slug, skill.name, summary, 'skill', '技能']
        });
    }

    return items;
}

export function filterComposerSlashCommands(
    commands: readonly ComposerSlashCommandItem[],
    rawQuery: string
): readonly ComposerSlashCommandItem[] {
    const query = rawQuery.trim().toLowerCase();
    if (!query) return commands;

    const scored: { readonly item: ComposerSlashCommandItem; readonly score: number; readonly index: number }[] = [];
    commands.forEach((item, index) => {
        const slugLower = item.slug.toLowerCase();
        const titleLower = item.title.toLowerCase();
        const descLower = item.description.toLowerCase();
        const kwMatch = item.keywords.some(kw => kw.toLowerCase().includes(query));
        const kwStarts = item.keywords.some(kw => kw.toLowerCase().startsWith(query));

        let score = 0;
        if (slugLower === query || titleLower === query) score = 100;
        else if (slugLower.startsWith(query)) score = 90;
        else if (titleLower.startsWith(query) || kwStarts) score = 80;
        else if (slugLower.includes(query)) score = 70;
        else if (titleLower.includes(query) || kwMatch) score = 60;
        else if (descLower.includes(query)) score = 40;

        if (score > 0) {
            scored.push({ item, score, index });
        }
    });

    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.map(entry => entry.item);
}

export interface ExpandSlashSubmissionOptions {
    readonly hasAttachments?: boolean;
}

export interface ExpandedSlashSubmission {
    readonly matchedCommand?: 'review' | 'init' | 'commit' | 'plan' | 'skill';
    readonly needsTaskInput?: boolean;
    readonly displayPrompt: string;
    readonly modelPrompt: string;
    readonly prioritizedSkillNames: readonly string[];
    readonly prioritizedSkillLocations: readonly string[];
}

const LEADING_APP_CONTROL_MARKERS = /^(?:\[(?:App|NextMux\s*应用操控):[^\n\]]*\](?:\r?\n|$))+/u;

/**
 * Expands workflow slash commands (`/review`, `/init`, `/commit`, `/plan`) and `/<skill>` invocations
 * into crisp, structured engineering directives while keeping `displayPrompt` clean for the chat bubble.
 * Transparently preserves any leading `[App: ...]\n` markers prepended for queued/steered app-control messages.
 */
export function expandComposerSlashSubmission(
    rawPrompt: string,
    skills: readonly ComposerSlashSkillInfo[] = [],
    options?: ExpandSlashSubmissionOptions
): ExpandedSlashSubmission {
    const fullTrimmed = rawPrompt.trim();
    if (!fullTrimmed) {
        return { displayPrompt: '', modelPrompt: '', prioritizedSkillNames: [], prioritizedSkillLocations: [] };
    }

    const markerMatch = LEADING_APP_CONTROL_MARKERS.exec(fullTrimmed);
    const rawMarkerBlock = markerMatch ? markerMatch[0].replace(/\s+$/u, '') : '';
    const trimmed = markerMatch ? fullTrimmed.slice(markerMatch[0].length).trim() : fullTrimmed;
    const withMarkers = (body: string): string => (rawMarkerBlock ? (body ? `${rawMarkerBlock}\n${body}` : rawMarkerBlock) : body);

    if (!trimmed) {
        return {
            displayPrompt: fullTrimmed,
            modelPrompt: fullTrimmed,
            prioritizedSkillNames: [],
            prioritizedSkillLocations: []
        };
    }

    // Map ONLY canonical resolved slugs (`BUILTIN_SLASH_SLUGS`-safe + `-2`/`-3` deduplicated).
    const skillBySlug = new Map<string, ComposerSlashSkillInfo>();
    for (const { slug, skill } of resolveComposerSlashSkills(skills)) {
        skillBySlug.set(slug.toLowerCase(), skill);
    }

    const prioritizedSkillNames: string[] = [];
    const prioritizedSkillLocations: string[] = [];
    const tokenRegex = /(?:^|\s)\/([\p{L}\p{N}_.:-]+)(?=\s|$)/gu;
    let tok: RegExpExecArray | null;
    while ((tok = tokenRegex.exec(trimmed)) !== null) {
        const candidate = skillBySlug.get(tok[1].toLowerCase());
        if (candidate) {
            if (!prioritizedSkillNames.includes(candidate.name)) {
                prioritizedSkillNames.push(candidate.name);
            }
            if (candidate.location && !prioritizedSkillLocations.includes(candidate.location)) {
                prioritizedSkillLocations.push(candidate.location);
            }
        }
    }

    const leadingCmd = /^\/(review|init|commit|plan)(?:\s+([\s\S]*))?$/iu.exec(trimmed);
    const trailingCmd = !leadingCmd ? /^([\s\S]+?)\s+\/(review|init|commit|plan)$/iu.exec(trimmed) : null;
    const effectiveCmd = leadingCmd
        ? { cmd: leadingCmd[1].toLowerCase() as 'review' | 'init' | 'commit' | 'plan', rest: (leadingCmd[2] || '').trim() }
        : trailingCmd
            ? { cmd: trailingCmd[2].toLowerCase() as 'review' | 'init' | 'commit' | 'plan', rest: trailingCmd[1].trim() }
            : undefined;

    if (effectiveCmd) {
        const { cmd, rest } = effectiveCmd;
        if (cmd === 'review') {
            const focusLine = rest ? `\nAdditional review focus from user: ${rest}` : '';
            return {
                matchedCommand: 'review',
                displayPrompt: fullTrimmed,
                modelPrompt: withMarkers([
                    'Perform a thorough, read-only code review of the uncommitted changes in the current workspace (`git status` and `git diff`, including staged and unstaged changes).',
                    'STRICT RULE: Do NOT modify, create, or delete any files during this review.',
                    'Report only concrete, actionable findings prioritized by severity: correctness bugs, regressions, security/credential risks, race conditions, and missing edge cases, citing exact file paths and line numbers.' + focusLine
                ].join('\n')),
                prioritizedSkillNames,
                prioritizedSkillLocations
            };
        }
        if (cmd === 'init') {
            const notesLine = rest ? `\nAdditional instructions from user: ${rest}` : '';
            return {
                matchedCommand: 'init',
                displayPrompt: fullTrimmed,
                modelPrompt: withMarkers([
                    'Inspect this repository\'s directory layout, package manifests, build/lint/test scripts, and existing architectural conventions, then create or update `AGENTS.md` at the workspace root.',
                    'Keep `AGENTS.md` concise, accurate, and actionable for coding agents: cover workspace structure, exact build & targeted test commands, code style/architecture boundaries, and safety rules. Preserve any critical existing user rules.' + notesLine
                ].join('\n')),
                prioritizedSkillNames,
                prioritizedSkillLocations
            };
        }
        if (cmd === 'commit') {
            const msgLine = rest ? `\nUser commit message / note to incorporate: ${rest}` : '';
            return {
                matchedCommand: 'commit',
                displayPrompt: fullTrimmed,
                modelPrompt: withMarkers([
                    'Inspect `git status` and `git diff` in the current workspace.',
                    'Verify that no secrets, credentials, `.env` files, or broken debug artifacts are included, stage the intended changes cleanly, craft a clear conventional commit message summarizing the why and what, and execute `git commit` (do NOT `git push` unless explicitly requested).' + msgLine
                ].join('\n')),
                prioritizedSkillNames,
                prioritizedSkillLocations
            };
        }
        if (cmd === 'plan') {
            if (!rest) {
                if (options?.hasAttachments) {
                    return {
                        matchedCommand: 'plan',
                        displayPrompt: fullTrimmed,
                        modelPrompt: withMarkers([
                            'PLAN-FIRST MODE (STRICT READ-ONLY PHASE):',
                            'Inspect the attached files/images and the relevant files, types, call sites, and architecture in the workspace thoroughly, then present a concrete, step-by-step implementation & verification plan (exact files to change, data flow, edge cases, and test strategy).',
                            'CRITICAL: Do NOT create, edit, or delete any files and do NOT run mutating commands yet — wait for the user to review and confirm the plan first.'
                        ].join('\n')),
                        prioritizedSkillNames,
                        prioritizedSkillLocations
                    };
                }
                return {
                    matchedCommand: 'plan',
                    needsTaskInput: true,
                    displayPrompt: fullTrimmed,
                    modelPrompt: fullTrimmed,
                    prioritizedSkillNames,
                    prioritizedSkillLocations
                };
            }
            return {
                matchedCommand: 'plan',
                displayPrompt: fullTrimmed,
                modelPrompt: withMarkers([
                    'PLAN-FIRST MODE (STRICT READ-ONLY PHASE):',
                    'Inspect the relevant files, types, call sites, and architecture in the workspace thoroughly, then present a concrete, step-by-step implementation & verification plan (exact files to change, data flow, edge cases, and test strategy).',
                    'CRITICAL: Do NOT create, edit, or delete any files and do NOT run mutating commands yet — wait for the user to review and confirm the plan first.',
                    '',
                    `Task to plan:\n${rest}`
                ].join('\n')),
                prioritizedSkillNames,
                prioritizedSkillLocations
            };
        }
    }

    if (prioritizedSkillNames.length > 0) {
        const leadingSkill = /^\/([\p{L}\p{N}_.:-]+)(?:\s+([\s\S]*))?$/u.exec(trimmed);
        if (leadingSkill && skillBySlug.has(leadingSkill[1].toLowerCase()) && !(leadingSkill[2] || '').trim()) {
            const matchedSkill = skillBySlug.get(leadingSkill[1].toLowerCase())!;
            return {
                matchedCommand: 'skill',
                displayPrompt: fullTrimmed,
                modelPrompt: withMarkers(`Apply the installed skill "${matchedSkill.name}" (follow its SKILL.md instructions carefully) in the current workspace.`),
                prioritizedSkillNames,
                prioritizedSkillLocations
            };
        }
        const cleanedBody = leadingSkill && skillBySlug.has(leadingSkill[1].toLowerCase())
            ? (leadingSkill[2] || '').trim()
            : trimmed;
        return {
            matchedCommand: 'skill',
            displayPrompt: fullTrimmed,
            modelPrompt: withMarkers([
                `<explicit-skill-directive>Prioritize and strictly follow the installed SKILL.md instructions for: ${prioritizedSkillNames.map(name => `"${name}"`).join(', ')}.</explicit-skill-directive>`,
                cleanedBody
            ].filter(Boolean).join('\n\n')),
            prioritizedSkillNames,
            prioritizedSkillLocations
        };
    }

    return {
        displayPrompt: fullTrimmed,
        modelPrompt: fullTrimmed,
        prioritizedSkillNames: [],
        prioritizedSkillLocations: []
    };
}

export interface ComposerSlashCommandDrawerPortalProps {
    readonly locale: NextMuxDesktopLocale;
    readonly theme: 'dark' | 'light';
    readonly commands: readonly ComposerSlashCommandItem[];
    readonly activeIndex: number;
    readonly anchorElement?: HTMLElement | null;
    readonly onHoverIndex: (index: number) => void;
    readonly onSelectCommand: (command: ComposerSlashCommandItem) => void;
    readonly onDismiss: () => void;
}

export const ComposerSlashCommandDrawerPortal: React.FC<ComposerSlashCommandDrawerPortalProps> = ({
    locale,
    theme,
    commands,
    activeIndex,
    anchorElement,
    onHoverIndex,
    onSelectCommand,
    onDismiss
}) => {
    const listRef = React.useRef<HTMLDivElement | null>(null);
    const [tick, setTick] = React.useState(0);

    React.useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const refresh = (): void => setTick(value => (value + 1) % 10_000);
        window.addEventListener('resize', refresh);
        window.addEventListener('scroll', refresh, true);
        return () => {
            window.removeEventListener('resize', refresh);
            window.removeEventListener('scroll', refresh, true);
        };
    }, []);

    React.useEffect(() => {
        const container = listRef.current;
        if (!container) return;
        const activeOption = container.querySelector<HTMLElement>(`[data-slash-index="${activeIndex}"]`);
        activeOption?.scrollIntoView?.({ block: 'nearest' });
    }, [activeIndex, commands.length]);

    if (!commands.length || typeof document === 'undefined' || !document.body) return null;

    void tick;
    const viewportWidth = typeof window !== 'undefined' ? Math.max(320, window.innerWidth) : 1024;
    const viewportHeight = typeof window !== 'undefined' ? Math.max(320, window.innerHeight) : 768;
    const resolvedAnchor = anchorElement
        || document.querySelector<HTMLElement>('.nmx-composer')
        || document.querySelector<HTMLElement>('.nmx-composer-wrap');
    const rect = resolvedAnchor?.getBoundingClientRect();

    const margin = 12;
    const gap = 8;
    const desiredWidth = rect ? Math.min(Math.max(340, rect.width), 560) : 440;
    const width = Math.max(260, Math.min(desiredWidth, viewportWidth - margin * 2));
    const left = rect
        ? Math.max(margin, Math.min(rect.left, viewportWidth - width - margin))
        : margin;
    const availableAbove = rect ? Math.max(140, rect.top - margin - gap) : 340;
    // About eight single-line rows: the drawer stays a compact strip above the composer and scrolls for the rest.
    const maxHeight = Math.min(248, availableAbove, viewportHeight - margin * 2);
    const bottom = rect
        ? Math.max(margin, viewportHeight - rect.top + gap)
        : margin + 88;

    const safeActive = Math.max(0, Math.min(activeIndex, commands.length - 1));
    const activeItem = commands[safeActive];

    return createPortal(
        <div
            className='nmx-slash-command-portal nmx-model-picker-portal nmx-desktop-widget'
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            lang={locale}
            onKeyDown={event => {
                if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    onDismiss();
                }
            }}
        >
            <div className={`nmx-model-picker-surface nmx-shell nmx-theme-${theme}`}>
                <section
                    className='nmx-composer-popover nmx-slash-command-popover'
                    aria-label={pickLocaleCopy(locale, '斜杠快捷命令', '斜槓快捷命令', 'Slash Commands')}
                    onMouseDown={event => {
                        // Prevent blurring composer <textarea> when clicking disabled items, padding, or the scrollbar.
                        event.preventDefault();
                    }}
                    style={{
                        left: `${Math.round(left)}px`,
                        bottom: `${Math.round(bottom)}px`,
                        top: 'auto',
                        width: `${Math.round(width)}px`,
                        maxHeight: `${Math.round(maxHeight)}px`
                    }}
                >
                    <div
                        ref={listRef}
                        className='nmx-slash-command-list'
                        role='listbox'
                        aria-activedescendant={activeItem ? `nmx-slash-opt-${safeActive}` : undefined}
                    >
                        {commands.map((item, index) => {
                            const isSelected = index === safeActive;
                            const detail = slashCommandRowDetail(locale, item);
                            return (
                                <button
                                    key={item.id}
                                    // Skill ids hold file paths (spaces, slashes), which are not valid ID references.
                                    id={`nmx-slash-opt-${index}`}
                                    type='button'
                                    role='option'
                                    data-slash-index={index}
                                    data-slash-command={item.slug}
                                    aria-selected={isSelected}
                                    aria-disabled={item.disabled || undefined}
                                    disabled={item.disabled}
                                    className={`nmx-slash-command-item${isSelected ? ' is-active' : ''}${item.disabled ? ' is-disabled' : ''}`}
                                    title={`${item.title} — ${item.disabled && item.disabledReason ? item.disabledReason : item.description}`}
                                    onMouseDown={event => {
                                        // Preserve composer textarea focus & selection caret!
                                        event.preventDefault();
                                    }}
                                    // A disabled row never becomes the highlighted one: Enter would answer with its reason instead of
                                    // running the command the keyboard had highlighted.
                                    onMouseEnter={() => { if (!item.disabled) onHoverIndex(index); }}
                                    onClick={() => {
                                        if (item.disabled) return;
                                        onSelectCommand(item);
                                    }}
                                >
                                    <i className={`nmx-slash-command-icon codicon codicon-${item.icon}`} aria-hidden='true'></i>
                                    <span className='nmx-slash-command-token' data-nmx-literal><span className='nmx-slash-command-sigil'>/</span>{item.slug}</span>
                                    <span className='nmx-slash-command-desc'>{detail}</span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            </div>
        </div>,
        document.body
    );
};
