import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { skillDomainMessage } from './nextmux-skill-domain-locale';
import type { SkillLoadIssue } from './nextmux-skill-service';
import { skillReadinessText } from './nextmux-skill-readiness-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * Installed Skills as a one-line summary on the Skills page and a dialog with the list,
 * so a long list never pushes the community catalogue down the page.
 */

const text = {
    en: { summary: '{count} Skills installed', hint: 'The AI picks them up by itself when a task needs one.', view: 'View', title: 'Installed Skills', how: 'Every conversation starts with each Skill’s name and summary. When a task needs one, the AI loads its full instructions on its own; to insist on one, name it in your message (for example “use the pdf skill”). Up to 24 Skills are offered per task.', open: 'Open', close: 'Close', remove: 'Uninstall', removing: 'Uninstalling…', empty: 'No Skills installed yet. Install one from the community list below.' },
    'zh-CN': { summary: '已安装 {count} 个 Skills', hint: '任务需要时，AI 会自动选用。', view: '查看', title: '已安装的 Skills', how: '每次对话开始时，AI 会拿到每个 Skill 的名称和简介；任务需要时它会自己加载完整说明，不用你提醒。想指定使用某个，在消息里写出它的名字即可（例如“用 pdf 这个 skill”）。每个任务最多提供 24 个。', open: '打开', close: '关闭', remove: '卸载', removing: '正在卸载…', empty: '还没有安装 Skills，可以在下方社区列表里安装。' },
    'zh-TW': { summary: '已安裝 {count} 個 Skills', hint: '任務需要時，AI 會自動選用。', view: '查看', title: '已安裝的 Skills', how: '每次對話開始時，AI 會取得每個 Skill 的名稱與簡介；任務需要時它會自行載入完整說明，不用你提醒。想指定使用某個，在訊息裡寫出它的名稱即可（例如「用 pdf 這個 skill」）。每個任務最多提供 24 個。', open: '開啟', close: '關閉', remove: '解除安裝', removing: '正在解除安裝…', empty: '尚未安裝 Skills，可以在下方社群清單中安裝。' },
    ja: { summary: '{count} 個の Skills をインストール済み', hint: 'タスクに必要なとき AI が自動で使います。', view: '表示', title: 'インストール済みの Skills', how: '会話の開始時に AI は各 Skill の名前と概要を受け取り、必要なときに自分で全文を読み込みます。特定の Skill を使わせたいときはメッセージで名前を書いてください（例：「pdf の skill を使って」）。1 タスクにつき最大 24 個です。', open: '開く', close: '閉じる', remove: 'アンインストール', removing: 'アンインストール中…', empty: 'Skills はまだありません。下のコミュニティ一覧からインストールできます。' },
    ko: { summary: 'Skills {count}개 설치됨', hint: '작업에 필요하면 AI가 알아서 사용합니다.', view: '보기', title: '설치된 Skills', how: '대화가 시작될 때 AI는 각 Skill의 이름과 요약을 받고, 작업에 필요하면 전체 지침을 스스로 불러옵니다. 특정 Skill을 쓰게 하려면 메시지에 이름을 적으세요(예: “pdf skill을 사용해”). 작업당 최대 24개까지 제공됩니다.', open: '열기', close: '닫기', remove: '제거', removing: '제거 중…', empty: '아직 설치된 Skills가 없습니다. 아래 커뮤니티 목록에서 설치하세요.' },
    es: { summary: '{count} Skills instaladas', hint: 'La IA las usa sola cuando la tarea lo necesita.', view: 'Ver', title: 'Skills instaladas', how: 'Cada conversación empieza con el nombre y el resumen de cada Skill; cuando la tarea lo necesita, la IA carga sus instrucciones completas por sí misma. Para exigir una, nómbrala en tu mensaje (por ejemplo, “usa la skill pdf”). Se ofrecen hasta 24 por tarea.', open: 'Abrir', close: 'Cerrar', remove: 'Desinstalar', removing: 'Desinstalando…', empty: 'Aún no hay Skills instaladas. Instala una desde la lista de la comunidad.' },
    fr: { summary: '{count} Skills installées', hint: 'L’IA les utilise d’elle-même quand la tâche en a besoin.', view: 'Voir', title: 'Skills installées', how: 'Chaque conversation commence avec le nom et le résumé de chaque Skill ; quand la tâche l’exige, l’IA charge seule les instructions complètes. Pour en imposer une, nommez-la dans votre message (par exemple « utilise la skill pdf »). Jusqu’à 24 Skills par tâche.', open: 'Ouvrir', close: 'Fermer', remove: 'Désinstaller', removing: 'Désinstallation…', empty: 'Aucune Skill installée. Installez-en une depuis la liste communautaire.' },
    de: { summary: '{count} Skills installiert', hint: 'Die KI nutzt sie selbst, wenn eine Aufgabe sie braucht.', view: 'Anzeigen', title: 'Installierte Skills', how: 'Jede Unterhaltung beginnt mit Namen und Kurzbeschreibung jeder Skill; braucht eine Aufgabe sie, lädt die KI die vollständige Anleitung selbst. Um eine bestimmte zu erzwingen, nennen Sie sie in der Nachricht (z. B. „nutze die pdf-Skill“). Bis zu 24 Skills pro Aufgabe.', open: 'Öffnen', close: 'Schließen', remove: 'Deinstallieren', removing: 'Wird deinstalliert…', empty: 'Noch keine Skills installiert. Installieren Sie eine aus der Community-Liste.' },
    'pt-BR': { summary: '{count} Skills instaladas', hint: 'A IA as usa sozinha quando a tarefa precisa.', view: 'Ver', title: 'Skills instaladas', how: 'Cada conversa começa com o nome e o resumo de cada Skill; quando a tarefa precisa, a IA carrega as instruções completas por conta própria. Para exigir uma, cite o nome na mensagem (por exemplo, “use a skill pdf”). Até 24 por tarefa.', open: 'Abrir', close: 'Fechar', remove: 'Desinstalar', removing: 'Desinstalando…', empty: 'Nenhuma Skill instalada. Instale uma pela lista da comunidade.' },
    ru: { summary: 'Установлено Skills: {count}', hint: 'ИИ сам использует их, когда задаче это нужно.', view: 'Показать', title: 'Установленные Skills', how: 'В начале каждого диалога ИИ получает название и описание каждой Skill и сам загружает полную инструкцию, когда она нужна. Чтобы потребовать конкретную, назовите её в сообщении (например, «используй skill pdf»). До 24 Skills на задачу.', open: 'Открыть', close: 'Закрыть', remove: 'Удалить', removing: 'Удаление…', empty: 'Skills пока не установлены. Установите из списка сообщества.' },
    ar: { summary: 'تم تثبيت {count} من Skills', hint: 'يستخدمها الذكاء الاصطناعي تلقائيًا عندما تحتاجها المهمة.', view: 'عرض', title: 'Skills المثبتة', how: 'تبدأ كل محادثة باسم كل Skill وملخصها؛ وعندما تحتاجها المهمة يحمّل الذكاء الاصطناعي التعليمات الكاملة بنفسه. لفرض واحدة اذكر اسمها في رسالتك (مثل: «استخدم skill pdf»). حتى 24 لكل مهمة.', open: 'فتح', close: 'إغلاق', remove: 'إلغاء التثبيت', removing: 'جارٍ إلغاء التثبيت…', empty: 'لا توجد Skills مثبتة بعد. ثبّت واحدة من قائمة المجتمع.' },
    hi: { summary: '{count} Skills इंस्टॉल हैं', hint: 'काम में ज़रूरत होने पर AI इन्हें खुद इस्तेमाल करता है।', view: 'देखें', title: 'इंस्टॉल Skills', how: 'हर बातचीत की शुरुआत में AI को हर Skill का नाम और सारांश मिलता है; ज़रूरत होने पर वह पूरे निर्देश खुद लोड करता है। किसी ख़ास Skill के लिए संदेश में उसका नाम लिखें (जैसे “pdf skill इस्तेमाल करो”)। हर काम में 24 तक।', open: 'खोलें', close: 'बंद करें', remove: 'अनइंस्टॉल करें', removing: 'अनइंस्टॉल हो रहा है…', empty: 'अभी कोई Skill इंस्टॉल नहीं है। नीचे की सूची से इंस्टॉल करें।' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

type Key = keyof typeof text.en;
function uncheckedInstalledSkillsText(locale: NextMuxDesktopLocale, key: Key, count?: number): string {
    const template: string = (text[locale] || text.en)[key];
    return count === undefined ? template : template.replace('{count}', String(count));
}

export interface InstalledSkillItem {
    readonly name: string;
    readonly description?: string;
    readonly location: string;
}

const ignoredSkillText: Record<NextMuxDesktopLocale, string> = {
    en: 'These Skills could not be loaded and were skipped. Other tasks can continue. Open a file to fix it, then retry.',
    'zh-CN': '以下 Skills 无法加载，已跳过，不影响其他任务。打开文件修复后可重新加载。',
    'zh-TW': '以下 Skills 無法載入，已略過，不影響其他任務。開啟檔案修復後可重新載入。',
    ja: '以下の Skills は読み込めないためスキップしました。他のタスクは続行できます。ファイルを開いて修正し、再試行してください。',
    ko: '다음 Skills를 불러올 수 없어 건너뛰었습니다. 다른 작업은 계속할 수 있습니다. 파일을 수정한 뒤 다시 시도하세요.',
    es: 'Se omitieron estas Skills porque no se pudieron cargar. Las demás tareas pueden continuar. Abre el archivo, corrígelo y reintenta.',
    fr: 'Ces Skills n’ont pas pu être chargées et ont été ignorées. Les autres tâches peuvent continuer. Ouvrez le fichier, corrigez-le puis réessayez.',
    de: 'Diese Skills konnten nicht geladen werden und wurden übersprungen. Andere Aufgaben können fortgesetzt werden. Datei öffnen, korrigieren und erneut versuchen.',
    'pt-BR': 'Estas Skills não puderam ser carregadas e foram ignoradas. As outras tarefas podem continuar. Abra o arquivo, corrija e tente novamente.',
    ru: 'Эти Skills не удалось загрузить, поэтому они пропущены. Другие задачи могут продолжаться. Откройте файл, исправьте его и повторите загрузку.',
    ar: 'تعذّر تحميل هذه Skills وتم تخطيها. يمكن متابعة المهام الأخرى. افتح الملف وأصلحه ثم أعد المحاولة.',
    hi: 'ये Skills लोड नहीं हो सके, इसलिए इन्हें छोड़ दिया गया। अन्य काम जारी रह सकते हैं। फ़ाइल खोलकर सुधारें और फिर कोशिश करें।'
};

export function SkillLoadErrors(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly errors: readonly SkillLoadIssue[];
    readonly onOpen: (location: string) => void;
    readonly onRetry: () => void;
}): React.ReactElement | null {
    if (!props.errors.length) return null;
    return <div className='nmx-settings-group' role='alert'>
        <p data-nmx-literal>{ignoredSkillText[props.locale] || ignoredSkillText.en}</p>
        {props.errors.map(error => <div className='nmx-setting-row' key={error.location}>
            <span><strong data-nmx-literal>{error.name}</strong><small data-nmx-literal>{error.location}</small>
                <small title={error.code}>{skillDomainMessage(props.locale, { code: error.code, fallbackEnglish: error.code }) || error.code}</small></span>
            <button type='button' onClick={() => props.onOpen(error.location)}>{installedSkillsText(props.locale, 'open')}</button>
        </div>)}
        <button type='button' onClick={props.onRetry}>{skillReadinessText(props.locale, 'retry')}</button>
    </div>;
}

export function InstalledSkillsSummary(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly count: number;
    readonly skills: readonly InstalledSkillItem[];
    readonly onView: () => void;
}): React.ReactElement {
    const t = (key: Key) => installedSkillsText(props.locale, key, props.count);
    const visible = props.skills.slice(0, 6);
    return <div className='nmx-installed-skills-summary'>
        <i className='codicon codicon-sparkle' aria-hidden='true'></i>
        <span className='nmx-installed-skills-summary-copy'><strong>{t('summary')}</strong><small>{t('hint')}</small></span>
        {visible.length > 0 && <div className='nmx-installed-skills-chips' aria-label={t('summary')}>
            {visible.map(skill => <button type='button' className='nmx-installed-skills-chip' key={skill.location}
                title={[skill.name, skill.description].filter(Boolean).join(' · ')} data-nmx-tip={skill.name}
                onClick={props.onView}>{skill.name}</button>)}
            {props.skills.length > visible.length && <button type='button' className='nmx-installed-skills-chip is-more'
                title={t('summary')} onClick={props.onView}>+{props.skills.length - visible.length}</button>}
        </div>}
        <button type='button' className='nmx-installed-skills-view' onClick={props.onView}>{t('view')}</button>
    </div>;
}

/** A Skill folder directly inside NextMux's Skills folder (~/.agents/skills), which NextMux may uninstall. */
export function nextmuxManagedSkill(location: string): boolean {
    return /[\\/]\.agents[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/.test(location);
}

export function InstalledSkillsDialog(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly skills: readonly InstalledSkillItem[];
    readonly onOpen: (location: string) => void;
    readonly onClose: () => void;
    /** Skills in NextMux's own Skills folder can be uninstalled here (audit A10-005). */
    readonly onRemove?: (location: string) => void;
    readonly removing?: string;
}): React.ReactElement {
    const t = (key: Key) => installedSkillsText(props.locale, key, props.skills.length);
    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop' onMouseDown={props.onClose}>
        <section className='nmx-permission-sheet nmx-installed-skills-sheet' role='dialog' aria-modal='true' aria-labelledby='nmx-installed-skills-title'
            onMouseDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.onClose(); } }}>
            <header><div><h2 id='nmx-installed-skills-title'>{t('title')}<small>{props.skills.length}</small></h2><p>{t('how')}</p></div>
                <button type='button' aria-label={t('close')} autoFocus onClick={props.onClose}>×</button></header>
            <div className='nmx-installed-skills-list'>
                {props.skills.length ? props.skills.map(skill => <article key={skill.location} title={skill.location}>
                    <i className='codicon codicon-sparkle' aria-hidden='true'></i>
                    <span><strong data-nmx-literal>{skill.name}</strong>{skill.description ? <small data-nmx-literal>{skill.description}</small> : undefined}<code data-nmx-literal>{skill.location}</code></span>
                    <button type='button' onClick={() => props.onOpen(skill.location)}>{t('open')}</button>
                    {props.onRemove && nextmuxManagedSkill(skill.location) && <button type='button' disabled={Boolean(props.removing)}
                        onClick={() => props.onRemove!(skill.location)}>{props.removing === skill.location ? t('removing') : t('remove')}</button>}
                </article>) : <p className='nmx-installed-skills-empty'>{t('empty')}</p>}
            </div>
        </section>
    </div>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function installedSkillsText(locale: Parameters<typeof uncheckedInstalledSkillsText>[0], key: Parameters<typeof uncheckedInstalledSkillsText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedInstalledSkillsText>>): string {
    return totalCopy(locale, key, language => uncheckedInstalledSkillsText(language, key, ...rest));
}
