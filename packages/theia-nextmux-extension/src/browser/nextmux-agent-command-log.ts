import type { AgentRunEvent } from '@nextmux/agent-runtime';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * Every command the AI runs (process.run pipes, process.start sessions, sandboxed or not)
 * is mirrored into the bottom terminal drawer as a read-only log per conversation, so
 * “what did the AI run” is answerable in one place on macOS and Windows alike.
 */
export type AgentCommandState = 'running' | 'completed' | 'failed' | 'stopped';

export interface AgentCommandEntry {
    readonly key: string;
    readonly commandLine: string;
    readonly output: string;
    readonly state: AgentCommandState;
    readonly exitCode?: number | null;
    readonly signal?: string | null;
    readonly at: string;
}

export interface AgentCommandTurn {
    readonly id: string;
    readonly events?: readonly AgentRunEvent[];
    readonly running: boolean;
}

/** Output kept per command; the conversation row keeps the full stream. */
export const AGENT_COMMAND_OUTPUT_LIMIT = 40_000;
/** Commands kept per conversation log (oldest dropped first). */
export const AGENT_COMMAND_LOG_LIMIT = 60;

const settledTurns = new WeakMap<readonly AgentRunEvent[], readonly AgentCommandEntry[]>();

const isCommandTool = (name: string): boolean => name === 'process.run' || name === 'process.start';

export function agentCommandEntries(turnId: string, events: readonly AgentRunEvent[] | undefined, running: boolean): readonly AgentCommandEntry[] {
    if (!events?.length) return [];
    if (!running) {
        const cached = settledTurns.get(events);
        if (cached) return cached;
    }
    const order: string[] = [];
    const commands = new Map<string, { commandLine: string; output: string; exited?: Extract<AgentRunEvent, { type: 'tool_process_exited' }>;
        completed?: Extract<AgentRunEvent, { type: 'tool_completed' }>; at: string }>();
    const entry = (callId: string, at: string) => {
        let found = commands.get(callId);
        if (!found) { found = { commandLine: '', output: '', at }; commands.set(callId, found); order.push(callId); }
        return found;
    };
    for (const event of events) {
        if (!('toolName' in event) || !isCommandTool(event.toolName)) continue;
        if (event.type === 'tool_started') {
            const item = entry(event.callId, event.at);
            if (!item.commandLine && event.summary?.commandLine) item.commandLine = event.summary.commandLine;
        } else if (event.type === 'tool_process_started') {
            entry(event.callId, event.at).commandLine = event.commandLine;
        } else if (event.type === 'tool_output') {
            const item = entry(event.callId, event.at);
            if (item.output.length < AGENT_COMMAND_OUTPUT_LIMIT) item.output += event.chunk;
        } else if (event.type === 'tool_process_exited') {
            entry(event.callId, event.at).exited = event;
        } else if (event.type === 'tool_completed') {
            const item = commands.get(event.callId);
            if (item) item.completed = event;
        }
    }
    const result: AgentCommandEntry[] = [];
    for (const callId of order) {
        const item = commands.get(callId)!;
        if (!item.commandLine) continue;
        const exited = item.exited;
        const state: AgentCommandState = exited
            ? (exited.terminationReason !== undefined && exited.terminationReason !== 'timeout') || (exited.signal && !exited.failure) ? 'stopped'
                : exited.exitCode === 0 && !exited.failure ? 'completed' : 'failed'
            : item.completed && !item.completed.ok ? 'failed'
                // A started background process without an exit is still running while its turn runs.
                : running ? 'running' : item.completed ? 'completed' : 'stopped';
        result.push({
            key: `${turnId}:${callId}`,
            commandLine: item.commandLine,
            output: item.output.length > AGENT_COMMAND_OUTPUT_LIMIT ? item.output.slice(0, AGENT_COMMAND_OUTPUT_LIMIT) : item.output,
            state,
            ...(exited ? { exitCode: exited.exitCode, signal: exited.signal } : {}),
            at: item.at
        });
    }
    if (!running) settledTurns.set(events, result);
    return result;
}

export function conversationAgentCommands(turns: readonly AgentCommandTurn[]): readonly AgentCommandEntry[] {
    const all = turns.flatMap(turn => agentCommandEntries(turn.id, turn.events, turn.running));
    return all.length > AGENT_COMMAND_LOG_LIMIT ? all.slice(-AGENT_COMMAND_LOG_LIMIT) : all;
}

const text = {
    en: { failed: 'failed', title: 'AI commands', readOnly: 'Read only · everything the AI ran in this conversation', truncated: 'output truncated; the full output is in the conversation', exit: 'exit {value}', stopped: 'stopped', running: 'running', empty: 'The AI has not run any command in this conversation yet.' },
    'zh-CN': { failed: '失败', title: 'AI 命令', readOnly: '只读 · 这个对话里 AI 运行过的全部命令', truncated: '输出过长已截断，完整输出在对话中', exit: '退出码 {value}', stopped: '已停止', running: '运行中', empty: '这个对话里 AI 还没有运行过命令。' },
    'zh-TW': { failed: '失敗', title: 'AI 命令', readOnly: '唯讀 · 此對話中 AI 執行過的所有命令', truncated: '輸出過長已截斷，完整輸出在對話中', exit: '結束代碼 {value}', stopped: '已停止', running: '執行中', empty: '此對話中 AI 尚未執行任何命令。' },
    ja: { failed: '失敗', title: 'AI コマンド', readOnly: '読み取り専用 · この会話で AI が実行したすべてのコマンド', truncated: '出力が長いため省略しました。全文は会話にあります', exit: '終了コード {value}', stopped: '停止', running: '実行中', empty: 'この会話で AI はまだコマンドを実行していません。' },
    ko: { failed: '실패', title: 'AI 명령', readOnly: '읽기 전용 · 이 대화에서 AI가 실행한 모든 명령', truncated: '출력이 너무 길어 잘렸습니다. 전체 출력은 대화에 있습니다', exit: '종료 코드 {value}', stopped: '중지됨', running: '실행 중', empty: '이 대화에서 AI가 아직 명령을 실행하지 않았습니다.' },
    es: { failed: 'falló', title: 'Comandos de la IA', readOnly: 'Solo lectura · todo lo que la IA ejecutó en esta conversación', truncated: 'salida recortada; la salida completa está en la conversación', exit: 'código de salida {value}', stopped: 'detenido', running: 'en ejecución', empty: 'La IA aún no ha ejecutado comandos en esta conversación.' },
    fr: { failed: 'échec', title: 'Commandes de l’IA', readOnly: 'Lecture seule · tout ce que l’IA a exécuté dans cette conversation', truncated: 'sortie tronquée ; la sortie complète est dans la conversation', exit: 'code de sortie {value}', stopped: 'arrêtée', running: 'en cours', empty: 'L’IA n’a encore exécuté aucune commande dans cette conversation.' },
    de: { failed: 'fehlgeschlagen', title: 'KI-Befehle', readOnly: 'Nur lesen · alles, was die KI in dieser Unterhaltung ausgeführt hat', truncated: 'Ausgabe gekürzt; die vollständige Ausgabe steht in der Unterhaltung', exit: 'Exit-Code {value}', stopped: 'gestoppt', running: 'läuft', empty: 'Die KI hat in dieser Unterhaltung noch keinen Befehl ausgeführt.' },
    'pt-BR': { failed: 'falhou', title: 'Comandos da IA', readOnly: 'Somente leitura · tudo o que a IA executou nesta conversa', truncated: 'saída cortada; a saída completa está na conversa', exit: 'código de saída {value}', stopped: 'interrompido', running: 'em execução', empty: 'A IA ainda não executou comandos nesta conversa.' },
    ru: { failed: 'ошибка', title: 'Команды ИИ', readOnly: 'Только чтение · всё, что ИИ запускал в этом диалоге', truncated: 'вывод обрезан; полный вывод есть в диалоге', exit: 'код выхода {value}', stopped: 'остановлено', running: 'выполняется', empty: 'ИИ ещё не запускал команды в этом диалоге.' },
    ar: { failed: 'فشل', title: 'أوامر الذكاء الاصطناعي', readOnly: 'للقراءة فقط · كل ما شغّله الذكاء الاصطناعي في هذه المحادثة', truncated: 'تم اقتطاع المخرجات؛ المخرجات الكاملة في المحادثة', exit: 'رمز الخروج {value}', stopped: 'متوقف', running: 'قيد التشغيل', empty: 'لم يشغّل الذكاء الاصطناعي أي أمر في هذه المحادثة بعد.' },
    hi: { failed: 'विफल', title: 'AI कमांड', readOnly: 'केवल पढ़ने के लिए · इस बातचीत में AI द्वारा चलाए गए सभी कमांड', truncated: 'आउटपुट छोटा किया गया; पूरा आउटपुट बातचीत में है', exit: 'एग्ज़िट कोड {value}', stopped: 'रुका', running: 'चल रहा है', empty: 'इस बातचीत में AI ने अभी तक कोई कमांड नहीं चलाया है।' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

export type AgentCommandLogTextKey = keyof typeof text.en;

function uncheckedAgentCommandLogText(locale: NextMuxDesktopLocale, key: AgentCommandLogTextKey): string {
    return (text[locale] || text.en)[key];
}

const sanitize = (value: string): string => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');

/**
 * One xterm-ready transcript. Settled commands only ever grow at the end, so the
 * terminal host can append instead of replaying while the AI works.
 */
export function agentCommandTranscript(locale: NextMuxDesktopLocale, entries: readonly AgentCommandEntry[]): string {
    let out = '';
    for (const entry of entries) {
        out += `\u001b[1;36m❯\u001b[0m \u001b[1m${sanitize(entry.commandLine).slice(0, 8_000)}\u001b[0m\r\n`;
        if (entry.output) {
            out += entry.output;
            if (!/[\r\n]$/.test(entry.output)) out += '\r\n';
            if (entry.output.length >= AGENT_COMMAND_OUTPUT_LIMIT) out += `\u001b[90m… ${agentCommandLogText(locale, 'truncated')}\u001b[0m\r\n`;
        }
        if (entry.state === 'running') continue;
        const status = entry.state === 'stopped' ? agentCommandLogText(locale, 'stopped')
            : entry.exitCode !== undefined && entry.exitCode !== null ? agentCommandLogText(locale, 'exit').replace('{value}', String(entry.exitCode))
                : entry.signal || (entry.state === 'failed' ? agentCommandLogText(locale, 'failed') : agentCommandLogText(locale, 'exit').replace('{value}', '0'));
        out += `\u001b[${entry.state === 'failed' ? '31' : '90'}m${status}\u001b[0m\r\n\r\n`;
    }
    return out;
}

/** True while a command the AI started has not finished (drives the drawer button's activity dot). */
export function hasRunningAgentCommand(events: readonly AgentRunEvent[]): boolean {
    const open = new Set<string>();
    for (const event of events) {
        if (!('toolName' in event) || !isCommandTool(event.toolName)) continue;
        if (event.type === 'tool_started' || event.type === 'tool_process_started') open.add(event.callId);
        else if (event.type === 'tool_process_exited' || (event.type === 'tool_completed' && !(event.toolName === 'process.start' && event.ok))) open.delete(event.callId);
    }
    return open.size > 0;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function agentCommandLogText(locale: Parameters<typeof uncheckedAgentCommandLogText>[0], key: Parameters<typeof uncheckedAgentCommandLogText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedAgentCommandLogText>>): string {
    return totalCopy(locale, key, language => uncheckedAgentCommandLogText(language, key, ...rest));
}
