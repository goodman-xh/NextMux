import { formatModelError, redactModelErrorDetail } from '@nextmux/model-runtime/errors';
import type { AgentRunEvent, ToolExecutionSummary } from '@nextmux/agent-runtime';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import {
    activityWithSteeringMessages, agentActivityEventKey, agentStreamTailPresentation, agentTaskPlanSteps, agentThinkingPresentation,
    browserToolActivity, commandActivityPresentation, commandExitStatus, completedNarrationSourceIndexes, isRedundantProcessControlCompletion,
    isVisibleAssistantProgress, latestLiveModelPhaseIndex, modelAttemptPresentation, modelPhasePresentation, projectAgentActivityEvents, toolActivityCompletionState, toolCompletionTitle,
    supersededEditFailures, type AgentTaskStepPresentation, type CommandActivityState
} from './nextmux-agent-activity';
import { browserSiteLabel, browserToolIdentity } from './nextmux-browser-activity-locale';
import { conversationStreamText as text, type ConversationStreamTextKey } from './nextmux-conversation-stream-locale';
import { shortFileActivityName } from './nextmux-file-activity';
import { localizedRuntimeActivity, localizedRuntimeToolTitle } from './nextmux-runtime-title-locale';
import { agentOutcomeText, desktopFailureMessage, type AgentOutcomeTextKey } from './nextmux-agent-outcome-locale';
import { managedPriceSummary, managedPriceText } from './nextmux-managed-price-text';
import { managedPriceRateSignature, normalizeManagedPriceUpdate } from './nextmux-managed-price-notice';
import { modelFailure, modelFailureText, type ScenarioModelErrorOptions } from './nextmux-model-errors';
import { runningTaskText } from './nextmux-running-task-locale';

/**
 * Pure projection of an agent run journal into the conversation stream.
 *
 * Presentation model follows OpenCode's session turn (MIT,
 * packages/session-ui/src/components/session-turn.tsx + basic-tool.tsx): parts
 * render in journal order; every tool is a one-line trigger (title, subtitle,
 * diff counts) whose body is collapsed; assistant text is always shown as
 * Markdown. Codex desktop is the visual benchmark (muted status lines, body
 * text at full contrast).
 */

export type StreamTone = 'running' | 'done' | 'failed' | 'stopped' | 'warning';

export type StreamDetails =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'markdown'; readonly text: string }
    | { readonly kind: 'terminal'; readonly command: string; readonly output: string; readonly running: boolean }
    | { readonly kind: 'diff'; readonly patch: string }
    | { readonly kind: 'link'; readonly url: string; readonly title?: string; readonly text?: string };

export interface StreamRowItem {
    readonly kind: 'row';
    readonly key: string;
    /** Stable, test-visible activity category (e.g. `file-read`, `command`, `browser`). */
    readonly activity: string;
    readonly tool?: string;
    readonly source?: string;
    readonly icon: string;
    readonly tone: StreamTone;
    /** Verb or the part of a phrase before its target. */
    readonly title: string;
    readonly target?: string;
    readonly targetStyle?: 'code' | 'file' | 'plain';
    /** Remaining phrase after the target (SOV languages). */
    readonly after?: string;
    /** Title, target and `after` form one sentence (browser steps) rather than verb + object. */
    readonly phrase?: boolean;
    readonly meta?: string;
    readonly additions?: number;
    readonly deletions?: number;
    /** Short failed/stopped state chip. */
    readonly chip?: string;
    /** Rows whose label replaces an earlier state cross-fade between them. */
    readonly swapKey?: string;
    readonly shimmer?: boolean;
    readonly details?: StreamDetails;
    readonly open?: { readonly kind: 'file' | 'browser'; readonly summary: ToolExecutionSummary; readonly label: string };
    readonly restoreCheckpointId?: string;
    readonly tooltip?: string;
}

export interface StreamTextItem {
    readonly kind: 'text';
    readonly key: string;
    readonly text: string;
    readonly streaming: boolean;
}

export interface StreamSteeringItem {
    readonly kind: 'steering';
    readonly key: string;
    readonly message: { readonly id: string; readonly content: string; readonly createdAt: string };
    readonly applied: boolean;
}

export type StreamItem = StreamRowItem | StreamTextItem | StreamSteeringItem;

export interface StreamChangeLike {
    readonly checkpointId: string;
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
    readonly patch?: string;
    readonly binary?: boolean;
    readonly truncated?: boolean;
}

export interface StreamProjectionInput {
    readonly locale: NextMuxDesktopLocale;
    readonly events: readonly AgentRunEvent[];
    readonly running: boolean;
    readonly preserveAssistantDeltas?: boolean;
    readonly terminalState?: 'complete' | 'stopped';
    readonly steeringMessages?: readonly { readonly id: string; readonly content: string; readonly createdAt: string; readonly status?: string }[];
    readonly changes?: readonly StreamChangeLike[];
    /** A computer tool waits for macOS permissions (already localized names), shown as the live approval row. */
    readonly systemPermissionWait?: string;
}

export interface StreamProjection {
    readonly items: readonly StreamItem[];
    /** Latest semantic plan, retained with settled turns. */
    readonly plan: readonly AgentTaskStepPresentation[];
    /** A live turn with no streaming prose shows a quiet caret at the end. */
    readonly idleCaret: boolean;
    readonly streamTail: ReturnType<typeof agentStreamTailPresentation>;
}

export interface ActivityToolVisual { readonly kind: string; readonly icon: string }

/**
 * Keep the activity rail semantic across built-in, skill and MCP tools. The
 * runtime still owns execution; this is presentation metadata only.
 */
export function activityToolVisual(toolName: string, source?: string, resourceKind?: string): ActivityToolVisual {
    const name = toolName.toLowerCase();
    if (name.startsWith('computer.')) return { kind: 'computer', icon: 'device-desktop' };
    // Built-in library documentation (Context7) and diagrams (draw.io).
    if (name.startsWith('docs.')) return name.includes('search') ? { kind: 'search', icon: 'book' } : { kind: 'read', icon: 'book' };
    if (name.startsWith('diagram.')) return { kind: 'create', icon: 'type-hierarchy' };
    if (name.startsWith('github.')) return name === 'github.read' ? { kind: 'read', icon: 'github' } : { kind: 'tool', icon: 'github' };
    if (resourceKind === 'browser' || name.startsWith('browser.') || name.includes('browser')) return { kind: 'browser', icon: 'globe' };
    // Waiting/polling is a first-class activity, not a failed command.
    if (name.includes('wait') || name.includes('poll') || name.includes('sleep') || name.includes('delay')) return { kind: 'waiting', icon: 'history' };
    if (resourceKind === 'file' || name.startsWith('workspace.')) {
        if (name.includes('search') || name.includes('grep')) return { kind: 'search', icon: 'search' };
        if (name.includes('list')) return { kind: 'read', icon: 'list-tree' };
        if (name.includes('read')) return { kind: 'read', icon: 'file' };
        if (name.includes('write') || name.includes('patch') || name.includes('edit') || name.includes('create') || name.includes('delete')) return { kind: 'edit', icon: 'edit' };
        return { kind: 'workspace', icon: 'file-directory' };
    }
    if (source === 'skill' || name.startsWith('skill.') || name.includes('skill')) return { kind: 'skill', icon: 'sparkle' };
    if (source === 'mcp' || name.startsWith('mcp.') || name.includes('mcp')) return { kind: 'mcp', icon: 'plug' };
    if (source === 'acp' || name.includes('subagent') || name.includes('child') || name.includes('agent')) return { kind: 'agent', icon: 'organization' };
    if (source === 'comic') return { kind: 'media', icon: 'device-camera' };
    if (name.startsWith('process.') || name.includes('command') || name.includes('terminal') || name.includes('shell')) return { kind: 'command', icon: 'terminal' };
    if (name.includes('permission') || name.includes('approval') || name.includes('authorize')) return { kind: 'permission', icon: 'shield' };
    if (name.includes('image') || name.includes('screenshot') || name.includes('vision')) return { kind: 'media', icon: 'device-camera' };
    if (name.includes('goal') || name.includes('schedule') || name.includes('task')) return { kind: 'plan', icon: 'list-ordered' };
    return { kind: 'tool', icon: 'symbol-event' };
}

type VerbForms = readonly [running: ConversationStreamTextKey, done: ConversationStreamTextKey, base: ConversationStreamTextKey];

const verbs: Readonly<Record<string, VerbForms>> = {
    read: ['reading', 'read', 'readBase'],
    list: ['exploring', 'explored', 'exploreBase'],
    search: ['searching', 'searched', 'searchBase'],
    edit: ['editing', 'edited', 'editBase'],
    create: ['creating', 'created', 'createBase'],
    command: ['running', 'ran', 'runBase'],
    agent: ['agentRunning', 'agentDone', 'agentBase'],
    skill: ['skillRunning', 'skillDone', 'skillBase'],
    mcp: ['toolRunning', 'toolDone', 'toolBase'],
    tool: ['toolRunning', 'toolDone', 'toolBase'],
    workspace: ['exploring', 'explored', 'exploreBase'],
    waiting: ['waitRunning', 'waitDone', 'waitBase'],
    computer: ['computerRunning', 'computerDone', 'computerBase'],
    media: ['mediaRunning', 'mediaDone', 'mediaBase'],
    plan: ['planRunning', 'planDone', 'planBase'],
    permission: ['approvalWaiting', 'approved', 'approvalWaiting'],
    browser: ['toolRunning', 'toolDone', 'toolBase']
};

/** A stopped or failed step reads as its base verb plus a chip ("Run npm test · failed"), never as done. */
function verb(locale: NextMuxDesktopLocale, kind: string, state: CommandActivityState): string {
    const forms = verbs[kind] || verbs.tool;
    return text(locale, forms[state === 'running' ? 0 : state === 'completed' ? 1 : 2]);
}

function toneOf(state: CommandActivityState): StreamTone {
    return state === 'running' ? 'running' : state === 'completed' ? 'done' : state;
}

function chipOf(locale: NextMuxDesktopLocale, state: CommandActivityState): string | undefined {
    return state === 'stopped' ? text(locale, 'stopped') : state === 'failed' ? text(locale, 'failed') : undefined;
}

/**
 * The runtime's generic invocation titles are fixed Chinese phrases (see
 * agent-runtime toolInvocationSummary). Keep only their object so the row verb
 * stays in the user's language; generic phrases carry no object at all.
 */
const runtimeTitlePatterns: readonly RegExp[] = [
    /^查看\s+(.+)\s+的文件$/, /^搜索“(.+)”$/, /^(?:读取|修改|运行|打开)\s+(.+)$/
];
const runtimeGenericTitles = new Set(['查看项目文件', '搜索项目内容', '读取文件', '修改文件', '应用文件补丁', '运行命令', '调用工具', '操作页面', '浏览器操作', '工具已完成',
    // agent.delegate results: the row verb already says the sub-agent finished; the task stays the target.
    '子任务已完成', '子任务已取消', '子任务已达到限制']);
/** `workspace.list_files` result title: only the entry count is kept, as a localized meta. */
const runtimeListTitle = /^列出\s*(\d+)\s*个工作区条目$/;

/** Human summary title unless it is only the internal tool identifier or a legacy `浏览器：action` label. */
function readableSummaryTitle(summary: ToolExecutionSummary | undefined, toolName: string, locale?: NextMuxDesktopLocale): string {
    const semantic = locale && summary ? localizedRuntimeActivity(locale, summary) : undefined;
    if (semantic) return semantic.title;
    const title = summary?.title?.trim() || '';
    const localized = locale ? localizedRuntimeToolTitle(locale, title) : undefined;
    if (localized) return localized;
    if (!title || title === toolName || runtimeGenericTitles.has(title) || runtimeListTitle.test(title)
        || /^(?:浏览器|browser)\s*[:：]\s*[a-z_]+$/i.test(title) || /^MCP[:：]/.test(title)) return '';
    for (const pattern of runtimeTitlePatterns) {
        const match = pattern.exec(title);
        if (match) return match[1].trim();
    }
    return title;
}

/** One line preview for collapsed reasoning (OpenCode shows the latest heading). */
function reasoningPreview(content: string): string {
    const lines = content.split(/\r?\n/).map(line => line.replace(/^[#>*\-\s]+|[*_`]+/g, '').trim()).filter(Boolean);
    const heading = [...content.matchAll(/^\s*(?:#{1,6}\s+|\*\*)([^*\n]+?)\*{0,2}\s*$/gm)].at(-1)?.[1]?.trim();
    const value = heading || lines.at(-1) || '';
    return value.length <= 120 ? value : `${value.slice(0, 119).trimEnd()}…`;
}

function fileRangeLabel(resource: { readonly startLine?: number; readonly endLine?: number }): string {
    if (!resource.startLine) return '';
    return `L${resource.startLine}${resource.endLine && resource.endLine !== resource.startLine ? `–${resource.endLine}` : ''}`;
}

// Events are immutable journal snapshots. A cache hit must precede every event
// projection/scan; weak keys let retired journals and their projections go away.
const streamProjectionCache = new WeakMap<readonly AgentRunEvent[], Map<string, StreamProjection>>();
// Keep large patches out of the serialized key. Comparing their string values
// also allows callers to rebuild equivalent change objects without a cache miss.
const streamProjectionPatches = new WeakMap<StreamProjection, readonly (string | undefined)[]>();

/** Steps between two texts that keep them separate blocks (live status rows, retries and resumes do not). */
const PROSE_CLOSING_EVENTS: ReadonlySet<AgentRunEvent['type']> = new Set<AgentRunEvent['type']>([
    'tool_started', 'tool_completed', 'tool_process_exited', 'task_plan_updated', 'user_input_requested', 'user_input_resolved',
    'steering_accepted', 'steering_applied', 'context_compaction_started', 'context_compaction_completed', 'assistant_progress'
]);

export function projectConversationStream(input: StreamProjectionInput): StreamProjection {
    const changes = input.changes || [];
    const cacheKey = JSON.stringify([
        input.locale, input.running ? 1 : 0, input.preserveAssistantDeltas ? 1 : 0,
        input.terminalState || '', input.systemPermissionWait || '',
        // createdAt controls steering placement; diff details can arrive after
        // their counts. Tuples keep colons/control characters unambiguous.
        (input.steeringMessages || []).map(message => [message.id, message.status || '', message.content, message.createdAt]),
        changes.map(change => [change.checkpointId, change.path, change.additions, change.deletions, change.binary ? 1 : 0, change.truncated ? 1 : 0])
    ]);
    let cachedProjections = streamProjectionCache.get(input.events);
    const cached = cachedProjections?.get(cacheKey);
    const cachedPatches = cached && streamProjectionPatches.get(cached);
    if (cached && cachedPatches && changes.every((change, index) => change.patch === cachedPatches[index])) return cached;
    const { locale, running } = input;
    const steeringMessages = input.steeringMessages || [];
    const events = activityWithSteeringMessages(input.events, steeringMessages);
    const streamTail = agentStreamTailPresentation({ running, ...(input.terminalState ? { terminalState: input.terminalState } : {}) });
    const plan = !running ? agentTaskPlanSteps(events) : [];
    const superseded = supersededEditFailures(events);
    const projected = projectAgentActivityEvents(events).filter(({ event }) => !('callId' in event && superseded.has(event.callId)));
    const settledToolCalls = new Set(projected.flatMap(({ event }) =>
        event.type === 'tool_completed' || event.type === 'tool_process_exited' ? [event.callId] : []));
    const processCommandLines = new Map<string, string>();
    const processOutput = new Map<string, string>();
    const processExits = new Map<string, Extract<AgentRunEvent, { readonly type: 'tool_process_exited' }>>();
    for (const event of events) {
        if (event.type === 'tool_process_exited') processExits.set(event.callId, event);
        if ((event.type !== 'tool_started' && event.type !== 'tool_completed' && event.type !== 'tool_output' && event.type !== 'tool_process_started')
            || (event.toolName !== 'process.run' && event.toolName !== 'process.start')) continue;
        if (event.type === 'tool_started' || event.type === 'tool_completed') {
            const presentation = commandActivityPresentation(locale, 'running', {
                commandLine: event.summary?.commandLine, processCommandLine: processCommandLines.get(event.callId), legacyTitle: event.summary?.title
            });
            if (presentation) processCommandLines.set(event.callId, presentation.command);
        } else if (event.type === 'tool_process_started') {
            processCommandLines.set(event.callId, event.commandLine);
        } else {
            processOutput.set(event.callId, `${processOutput.get(event.callId) || ''}${event.chunk}`.slice(-80_000));
        }
    }
    const terminalOutput = (callId: string, fallbackDetails?: readonly string[]): string => {
        const output = processOutput.get(callId) || '';
        if (!output && !processExits.has(callId) && fallbackDetails?.length) {
            return fallbackDetails.filter(line => line !== processCommandLines.get(callId)).join('\r\n');
        }
        const exited = processExits.get(callId);
        if (!exited) return output;
        const separator = output && !/[\r\n]$/.test(output) ? '\r\n' : '';
        return `${output}${separator}\u001b[90m${commandExitStatus(locale, exited.exitCode, exited.signal)}\u001b[0m\r\n`;
    };
    const changesByCheckpoint = new Map((input.changes || []).map(change => [change.checkpointId, change]));
    // A completed row whose result title is generic keeps the object its start row showed (e.g. the sub-agent task).
    const startedTargets = new Map<string, string>();
    for (const event of events) {
        if (event.type !== 'tool_started') continue;
        const target = readableSummaryTitle(event.summary, event.toolName, locale);
        if (target) startedTargets.set(event.callId, target);
    }
    const completedNarration = completedNarrationSourceIndexes(events);
    const liveModelPhaseIndex = latestLiveModelPhaseIndex(events, running);
    const items: StreamItem[] = [];
    const observedPrices = new Map<string, string>();
    const deltaTurns = new Map<string, number>();
    let visibleBeforeResume = false;
    // The reply is still one piece of prose: its next text may join the last text item. A step the user reads in
    // between (tool, plan, question, steering, compaction) closes it, and so does a new model request unless that
    // request continues the reply (output limit, dropped stream). A resumed run decides at its first request.
    let proseOpen = false;
    let resumePending = false;

    const commandRow = (key: string, event: { readonly toolName: string; readonly callId: string; readonly source?: string },
        state: CommandActivityState, command: string | undefined, fallbackTitle?: string, fallbackDetails?: readonly string[]): StreamRowItem => ({
        kind: 'row', key, activity: 'command', tool: event.toolName, source: event.source,
        icon: state === 'failed' ? 'error' : state === 'stopped' ? 'debug-stop' : 'terminal', tone: toneOf(state),
        title: verb(locale, 'command', state), target: command || fallbackTitle, targetStyle: command ? 'code' : 'plain',
        chip: chipOf(locale, state), shimmer: state === 'running',
        details: command ? { kind: 'terminal', command, output: terminalOutput(event.callId, fallbackDetails), running: state === 'running' } : undefined,
        tooltip: command
    });

    const toolRow = (key: string, event: Extract<AgentRunEvent, { readonly type: 'tool_started' | 'tool_completed' }>, state: CommandActivityState): StreamRowItem => {
        const summary = event.type === 'tool_completed' ? event.summary : event.summary;
        const visual = activityToolVisual(event.toolName, event.type === 'tool_started' ? event.source : undefined, summary?.resource?.kind);
        const browser = browserToolIdentity(event.toolName);
        const titleText = readableSummaryTitle(summary, event.toolName, locale)
            || (event.type === 'tool_completed' ? startedTargets.get(event.callId) || '' : '');
        const listed = event.toolName === 'workspace.list_files' ? summary?.params?.count ?? runtimeListTitle.exec(summary?.title?.trim() || '')?.[1] : undefined;
        const semantic = summary ? localizedRuntimeActivity(locale, summary) : undefined;
        const details = [...new Set((semantic?.details || summary?.details || []).map(line => line.trim()).filter(Boolean))];
        if (browser) {
            const resource = summary?.resource?.kind === 'browser' ? summary.resource : undefined;
            const target = summary?.target
                || (browser.action === 'open' || browser.action === 'open_external' ? browserSiteLabel(resource?.url, resource?.title)
                    : browser.action === 'snapshot' ? resource?.title || browserSiteLabel(resource?.url) : undefined);
            const phrase = browserToolActivity(locale, event.toolName, state, target)!.phrase;
            return {
                kind: 'row', key, activity: 'browser', tool: event.toolName, source: event.type === 'tool_started' ? event.source : undefined,
                icon: state === 'failed' ? 'error' : state === 'stopped' ? 'debug-stop' : 'globe', tone: toneOf(state),
                title: phrase.before, target: phrase.target, targetStyle: 'plain', after: phrase.after, phrase: true,
                chip: chipOf(locale, state), shimmer: state === 'running',
                details: resource ? { kind: 'link', url: resource.url, title: resource.title, text: details.join('\n') || undefined }
                    : details.length ? { kind: 'text', text: details.join('\n') } : undefined,
                open: resource && summary ? { kind: 'browser', summary, label: text(locale, 'openPage') } : undefined,
                tooltip: browser.service ? `${phrase.text} · ${browser.service}` : phrase.text
            };
        }
        const kind = event.toolName === 'workspace.list_files' ? 'list' : visual.kind;
        // Native computer failures use the localized outcome; diagnostic codes
        // remain in the journal rather than visible details.
        const computerOutcome = event.type === 'tool_completed' && state !== 'completed' && event.toolName.startsWith('computer.');
        const failureDetail = computerOutcome && !semantic ? [summary?.title?.trim() || ''] : [];
        const allDetails = [...new Set([...failureDetail, ...details].filter(Boolean))];
        // The workspace root reads as "Explored 5 items", not "Explored . 5 items".
        const rootListing = kind === 'list' && /^\.[\\/]?$/.test((titleText || summary?.target || '').trim());
        return {
            kind: 'row', key, activity: visual.kind, tool: event.toolName, source: event.type === 'tool_started' ? event.source : undefined,
            icon: state === 'failed' ? 'error' : state === 'stopped' ? 'debug-stop' : visual.icon, tone: toneOf(state),
            title: computerOutcome ? toolCompletionTitle(locale, event) : verb(locale, kind, state),
            target: computerOutcome || rootListing ? undefined : titleText || summary?.target || undefined,
            targetStyle: 'plain', chip: computerOutcome ? undefined : chipOf(locale, state), shimmer: state === 'running',
            ...(listed !== undefined ? { meta: text(locale, 'listedEntries', { n: String(listed) }) } : {}),
            details: allDetails.length ? { kind: 'text', text: allDetails.join('\n') } : undefined,
            restoreCheckpointId: event.type === 'tool_completed' ? summary?.checkpointId : undefined,
            tooltip: rootListing ? undefined : titleText || undefined
        };
    };

    const resolvedInputRow = (key: string, event: Extract<AgentRunEvent, { readonly type: 'user_input_resolved' }>,
        permission: boolean, target: string | undefined): StreamRowItem => {
        const answer = [event.answer?.optionLabel || event.answer?.optionId, event.answer?.text].filter(Boolean).join(' · ');
        const approved = event.status === 'answered' && !/^(?:deny|denied|reject|no|cancel)/i.test(event.answer?.optionId || '');
        return {
            kind: 'row', key, activity: permission ? 'permission' : 'question', tone: 'done',
            icon: permission ? approved ? 'shield' : 'circle-slash' : event.status === 'answered' ? 'comment' : 'debug-pause',
            title: permission ? text(locale, approved ? 'approved' : 'declined')
                : event.status === 'answered' ? text(locale, 'answered') : text(locale, 'questionClosed'),
            target: permission ? target : answer || target, targetStyle: permission ? 'code' : 'plain',
            tooltip: permission ? answer || undefined : target
        };
    };

    // Open prose carries across a retry or a new backend only when the next request continues it, or while the run
    // is still live and that request has not started: a stopped turn shows the failure that cut its reply short.
    const continuesOpenProse = (sourceIndex: number): boolean => {
        if (!proseOpen) return false;
        const nextModelStart = events.slice(sourceIndex + 1).find((candidate): candidate is Extract<AgentRunEvent, { readonly type: 'model_started' }> => candidate.type === 'model_started');
        return nextModelStart ? Boolean(nextModelStart.continuation) : running;
    };

    for (let projectedIndex = 0; projectedIndex < projected.length; projectedIndex += 1) {
        const { event, sourceIndex } = projected[projectedIndex];
        const key = agentActivityEventKey(event, sourceIndex);
        if (event.type === 'model_started') {
            if (!event.continuation) proseOpen = false;
            resumePending = false;
        } else if (PROSE_CLOSING_EVENTS.has(event.type)) proseOpen = false;
        if (event.type === 'backend_selected') {
            if (!continuesOpenProse(sourceIndex)) {
                resumePending = true;
                // A new backend selection after visible work is a resumed run
                // (after a pause, restart or checkpoint recovery), not a fallback.
                const previous = events[sourceIndex - 1];
                if (visibleBeforeResume && previous?.type !== 'backend_fallback') {
                    items.push({ kind: 'row', key, activity: 'resumed', icon: 'debug-continue', tone: 'done', title: text(locale, 'resumed') });
                }
            }
            continue;
        }
        const before = items.length;
        switch (event.type) {
            case 'steering_accepted': {
                const applied = events.some(candidate => candidate.type === 'steering_applied' && candidate.message.id === event.message.id)
                    || steeringMessages.find(message => message.id === event.message.id)?.status === 'applied';
                items.push({ kind: 'steering', key: `steering:${event.message.id}`, message: event.message, applied });
                break;
            }
            case 'user_input_requested': {
                // A question or approval is updated where it was asked, like a tool row.
                const permission = event.question.kind === 'permission';
                const resolution = events.find((candidate): candidate is Extract<AgentRunEvent, { readonly type: 'user_input_resolved' }> =>
                    candidate.type === 'user_input_resolved' && candidate.questionId === event.question.questionId);
                const target = permission ? event.question.approval?.target || event.question.prompt : event.question.prompt;
                if (resolution) {
                    items.push(resolvedInputRow(key, resolution, permission, target));
                    break;
                }
                items.push({
                    kind: 'row', key, activity: permission ? 'permission' : 'question', icon: permission ? 'shield' : 'question',
                    tone: running ? 'running' : 'done', shimmer: running,
                    title: text(locale, permission ? 'approvalWaiting' : 'questionWaiting'),
                    target, targetStyle: permission ? 'code' : 'plain',
                    details: event.question.approval?.detail ? { kind: 'text', text: event.question.approval.detail } : undefined
                });
                break;
            }
            case 'user_input_resolved': {
                const requested = events.some(candidate => candidate.type === 'user_input_requested' && candidate.question.questionId === event.questionId);
                if (!requested) items.push(resolvedInputRow(key, event, false, undefined));
                break;
            }
            case 'model_phase': {
                if (sourceIndex !== liveModelPhaseIndex) break;
                const phase = modelPhasePresentation(locale, event.phase, event.capacityReasons);
                items.push({
                    kind: 'row', key, activity: `model-${event.phase}`, tone: event.phase === 'failed' ? 'failed' : 'running',
                    icon: event.phase === 'failed' ? 'error' : event.phase === 'tool_calling' ? 'tools' : event.phase === 'responding' ? 'edit' : 'sparkle',
                    title: phase.title, shimmer: event.phase !== 'failed', tooltip: phase.detail
                });
                break;
            }
            case 'provider_reasoning': {
                const thinking = agentThinkingPresentation(event);
                if (!thinking) break;
                const hasSubsequentOutput = projected.slice(projectedIndex + 1).some(later =>
                    later.event.type === 'tool_started' || later.event.type === 'tool_completed'
                    || later.event.type === 'assistant_delta' || later.event.type === 'assistant_progress'
                    || later.event.type === 'model_completed');
                const streaming = thinking.streaming && streamTail.showCursor && !hasSubsequentOutput;
                items.push({
                    kind: 'row', key, activity: 'reasoning', icon: 'lightbulb', tone: streaming ? 'running' : 'done', shimmer: streaming,
                    title: text(locale, streaming ? 'thinking' : 'thought'), target: reasoningPreview(thinking.content), targetStyle: 'plain',
                    details: { kind: 'markdown', text: thinking.content }
                });
                break;
            }
            case 'tool_started': {
                const interrupted = !running && !settledToolCalls.has(event.callId);
                const state: CommandActivityState = interrupted ? 'stopped' : 'running';
                if (event.toolName === 'process.run' || event.toolName === 'process.start') {
                    const presentation = commandActivityPresentation(locale, state, {
                        commandLine: event.summary?.commandLine, processCommandLine: processCommandLines.get(event.callId),
                        legacyTitle: event.summary?.title?.trim() !== event.toolName ? event.summary?.title : undefined
                    });
                    items.push(commandRow(key, event, state, presentation?.command));
                } else if (event.summary?.resource?.kind === 'file' && !browserToolIdentity(event.toolName)) {
                    const resource = event.summary.resource;
                    const kind = resource.action === 'read' ? 'read' : resource.action === 'created' ? 'create' : 'edit';
                    items.push({
                        kind: 'row', key, activity: `file-${resource.action}`, tool: event.toolName, source: event.source,
                        icon: interrupted ? 'debug-stop' : resource.action === 'read' ? 'file' : 'edit', tone: toneOf(state),
                        title: verb(locale, kind, state), target: shortFileActivityName(resource.path), targetStyle: 'file',
                        meta: fileRangeLabel(resource) || undefined, chip: chipOf(locale, state), shimmer: !interrupted, tooltip: resource.path
                    });
                } else items.push(toolRow(key, event, state));
                break;
            }
            case 'tool_process_exited': {
                if (event.toolName !== 'process.start' && event.toolName !== 'process.run') break;
                const stopped = event.terminationReason !== undefined && event.terminationReason !== 'timeout' || Boolean(event.signal && !event.failure);
                const state: CommandActivityState = stopped ? 'stopped' : event.exitCode === 0 && !event.failure ? 'completed' : 'failed';
                const command = processCommandLines.get(event.callId);
                const row = commandRow(key, event, state, command, commandExitStatus(locale, event.exitCode, event.signal));
                items.push(row);
                break;
            }
            case 'tool_completed': {
                if (event.toolName === 'process.start' && event.ok) break;
                if (isRedundantProcessControlCompletion(event)) break;
                const state = toolActivityCompletionState({ ok: event.ok, status: event.status, outcome: event.summary.outcome, terminationReason: event.summary.terminationReason });
                if (event.toolName === 'process.run' || event.toolName === 'process.start') {
                    const presentation = commandActivityPresentation(locale, state, {
                        commandLine: event.summary.commandLine, processCommandLine: processCommandLines.get(event.callId), legacyTitle: event.summary.title
                    });
                    items.push({ ...commandRow(key, event, state, presentation?.command, readableSummaryTitle(event.summary, event.toolName, locale) || undefined, event.summary.details),
                        restoreCheckpointId: event.summary.checkpointId });
                    break;
                }
                const resource = event.summary.resource;
                if (resource?.kind === 'file' && event.ok) {
                    const change = event.summary.checkpointId ? changesByCheckpoint.get(event.summary.checkpointId) : undefined;
                    const kind = resource.action === 'read' ? 'read' : resource.action === 'created' ? 'create' : 'edit';
                    const counted = change && !change.binary;
                    items.push({
                        kind: 'row', key, activity: `file-${resource.action}`, tool: event.toolName,
                        icon: resource.action === 'read' ? 'file' : resource.action === 'created' ? 'new-file' : 'edit', tone: 'done',
                        title: verb(locale, kind, 'completed'), target: shortFileActivityName(resource.path), targetStyle: 'file',
                        meta: resource.action === 'read' ? fileRangeLabel(resource) || undefined : undefined,
                        ...(counted ? { additions: change.additions, deletions: change.deletions } : {}),
                        details: change?.patch && !change.binary ? { kind: 'diff', patch: change.patch } : undefined,
                        open: { kind: 'file', summary: event.summary, label: text(locale, 'openFile') },
                        restoreCheckpointId: event.summary.checkpointId, tooltip: resource.path
                    });
                    break;
                }
                items.push(toolRow(key, event, state));
                break;
            }
            case 'backend_fallback':
                items.push({ kind: 'row', key, activity: 'fallback', icon: 'arrow-swap', tone: 'warning', title: text(locale, 'engineSwitched'), tooltip: event.reason });
                break;
            case 'model_route_switched': {
                // “Switched to <model · relay> (why)”, while the new route works (REQUIREMENTS §3 automatic best).
                const reason = text(locale, event.reason === 'busy' ? 'switchBusy' : event.reason === 'timeout' ? 'switchTimeout'
                    : event.reason === 'unavailable' ? 'switchUnavailable' : 'switchFailed');
                items.push({ kind: 'row', key, activity: 'route-switch', icon: 'arrow-swap', tone: 'done',
                    title: text(locale, event.route ? 'routeSwitchedTo' : 'routeSwitched'), ...(event.route ? { target: event.route, targetStyle: 'plain' as const } : {}),
                    meta: reason });
                break;
            }
            case 'model_price_changed': {
                const price = normalizeManagedPriceUpdate(event.pricingUpdate);
                if (!price) break;
                const scope = JSON.stringify([event.sessionId, price.offeringId]);
                const signature = managedPriceRateSignature(price);
                if (observedPrices.get(scope) === signature) break;
                observedPrices.set(scope, signature);
                items.push({ kind: 'row', key, activity: 'price-update', icon: 'info', tone: 'done',
                    title: managedPriceText(locale, 'title'), target: price.model, targetStyle: 'plain',
                    meta: managedPriceSummary(locale, price),
                    details: { kind: 'text', text: managedPriceText(locale, 'body', { model: price.model, price: managedPriceSummary(locale, price) }) } });
                break;
            }
            case 'model_retry_scheduled':
                if (continuesOpenProse(sourceIndex)) break;
                items.push({ kind: 'row', key, activity: 'retry', icon: 'sync', tone: running ? 'running' : 'warning', shimmer: running,
                    title: text(locale, 'retrying'), meta: text(locale, 'attempt', { n: event.attempt }) });
                break;
            case 'model_attempt_completed': {
                if (event.outcome !== 'failed' || (event.retryScheduled && continuesOpenProse(sourceIndex))) break;
                // The row shows the localized attempt; raw diagnostics stay on the event.
                const attempt = modelAttemptPresentation(locale, event);
                items.push({ kind: 'row', key, activity: 'model-attempt', icon: 'debug-disconnect', tone: event.retryScheduled ? 'warning' : 'failed',
                    title: attempt.title, details: { kind: 'text', text: attempt.detail }, tooltip: attempt.detail });
                break;
            }
            case 'context_compaction_started':
                items.push({ kind: 'row', key, activity: 'context-compaction', icon: 'fold', tone: running ? 'running' : 'done', shimmer: running,
                    title: text(locale, 'compacting'), swapKey: 'compacting' });
                break;
            case 'context_compaction_completed':
                items.push({ kind: 'row', key, activity: 'context-compaction', icon: 'fold', tone: 'done', title: text(locale, 'compacted'), swapKey: 'compacted' });
                break;
            case 'assistant_progress':
                if (!isVisibleAssistantProgress({ ...event, previousEventType: events[sourceIndex - 1]?.type })) break;
                items.push({ kind: 'text', key, text: event.content, streaming: false });
                break;
            case 'assistant_delta': {
                if (!(running || input.preserveAssistantDeltas || completedNarration.has(sourceIndex))) break;
                if (resumePending) { proseOpen = false; resumePending = false; }
                // Merge adjacent text only. A tool or a steering message is a real
                // chronological boundary, even within one model turn.
                // The live model-phase row ("Calling a tool") is a status indicator, not a
                // boundary: text that keeps streaming after it joins the sentence before it.
                // While the reply continues (output limit, dropped stream) its retry and
                // resumed rows are status too: they go, and the text stays one block.
                const liveRow = (item: StreamItem | undefined): boolean => item?.kind === 'row' && item.activity.startsWith('model-') && item.activity !== 'model-attempt';
                const staleRow = (item: StreamItem | undefined): boolean => proseOpen && item?.kind === 'row'
                    && (item.activity === 'retry' || item.activity === 'resumed' || item.activity === 'model-attempt');
                let lastIndex = items.length - 1;
                while (lastIndex >= 0 && (liveRow(items[lastIndex]) || staleRow(items[lastIndex]))) lastIndex -= 1;
                // Outside a continued reply only one trailing phase row is skipped, as before.
                if (!proseOpen && lastIndex < items.length - 2) lastIndex = items.length - 1;
                const last = items[lastIndex];
                const lastTurn = last?.kind === 'text' ? deltaTurns.get(last.key) : undefined;
                const streaming = streamTail.showCursor && !completedNarration.has(sourceIndex);
                if (last?.kind === 'text' && lastTurn !== undefined && (lastTurn === event.turn || proseOpen)) {
                    for (let index = items.length - 1; index > lastIndex; index -= 1) if (staleRow(items[index])) items.splice(index, 1);
                    items[lastIndex] = { ...last, text: `${last.text}${event.delta}`, streaming };
                } else {
                    items.push({ kind: 'text', key, text: event.delta, streaming });
                    deltaTurns.set(key, event.turn);
                }
                proseOpen = true;
                break;
            }
            default:
                break;
        }
        if (items.length > before) visibleBeforeResume = true;
    }
    if (items.some(item => item.kind === 'text' && /<(?:think|thinking)>/i.test(item.text))) {
        const nextItems: StreamItem[] = [];
        let extractedAnyThink = false;
        for (const item of items) {
            if (item.kind !== 'text' || !/<(?:think|thinking)>/i.test(item.text)) {
                nextItems.push(item);
                continue;
            }
            const lines = item.text.split('\n');
            let fence: string | undefined;
            const nonFencedRanges: { start: number; end: number }[] = [];
            let rangeStart = 0;
            let offset = 0;
            for (const line of lines) {
                const marker = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
                const validMarker = marker && !(marker[1][0] === '`' && marker[2].includes('`')) ? marker[1] : undefined;
                if (fence) {
                    if (validMarker && validMarker[0] === fence[0] && validMarker.length >= fence.length && line.trim() === validMarker) {
                        fence = undefined;
                        rangeStart = offset + line.length + 1;
                    }
                } else if (validMarker) {
                    if (offset > rangeStart) nonFencedRanges.push({ start: rangeStart, end: offset });
                    fence = validMarker;
                }
                offset += line.length + 1;
            }
            if (!fence && rangeStart <= item.text.length) {
                nonFencedRanges.push({ start: rangeStart, end: item.text.length });
            }
            const isOutsideFence = (pos: number): boolean => nonFencedRanges.some(r => pos >= r.start && pos < r.end);
            const openRe = /<(think|thinking)>/gi;
            let cursor = 0;
            let thinkIndex = 0;
            let proseIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = openRe.exec(item.text)) !== null) {
                if (!isOutsideFence(match.index)) continue;
                const tagName = match[1].toLowerCase();
                const beforeText = item.text.slice(cursor, match.index);
                if (beforeText.trim()) {
                    nextItems.push({
                        kind: 'text',
                        key: proseIndex === 0 ? item.key : `${item.key}:prose:${proseIndex}`,
                        text: beforeText,
                        streaming: false
                    });
                    proseIndex++;
                }
                const bodyStart = match.index + match[0].length;
                const closeRe = new RegExp(`</${tagName}>`, 'gi');
                closeRe.lastIndex = bodyStart;
                let closeMatch: RegExpExecArray | null = null;
                while ((closeMatch = closeRe.exec(item.text)) !== null) {
                    if (isOutsideFence(closeMatch.index)) break;
                }
                if (closeMatch) {
                    const thinkBody = item.text.slice(bodyStart, closeMatch.index).trim();
                    extractedAnyThink = true;
                    nextItems.push({
                        kind: 'row',
                        key: `${item.key}:think:${thinkIndex++}`,
                        activity: 'reasoning',
                        icon: 'lightbulb',
                        tone: 'done',
                        shimmer: false,
                        title: text(locale, 'thought'),
                        target: reasoningPreview(thinkBody),
                        targetStyle: 'plain',
                        ...(thinkBody ? { details: { kind: 'markdown', text: thinkBody } } : {})
                    });
                    cursor = closeMatch.index + closeMatch[0].length;
                    openRe.lastIndex = cursor;
                } else {
                    const thinkBody = item.text.slice(bodyStart).trim();
                    const thinkStreaming = Boolean(item.streaming);
                    extractedAnyThink = true;
                    nextItems.push({
                        kind: 'row',
                        key: `${item.key}:think:${thinkIndex++}`,
                        activity: 'reasoning',
                        icon: 'lightbulb',
                        tone: thinkStreaming ? 'running' : 'done',
                        shimmer: thinkStreaming,
                        title: text(locale, thinkStreaming ? 'thinking' : 'thought'),
                        target: reasoningPreview(thinkBody),
                        targetStyle: 'plain',
                        ...(thinkBody ? { details: { kind: 'markdown', text: thinkBody } } : {})
                    });
                    cursor = item.text.length;
                    break;
                }
            }
            if (thinkIndex === 0) {
                nextItems.push(item);
            } else if (cursor < item.text.length) {
                const afterText = item.text.slice(cursor).replace(/^\n+/, '');
                if (afterText.trim()) {
                    nextItems.push({
                        kind: 'text',
                        key: proseIndex === 0 ? item.key : `${item.key}:prose:${proseIndex}`,
                        text: afterText,
                        streaming: item.streaming
                    });
                }
            }
        }
        if (extractedAnyThink) {
            items.length = 0;
            for (const nextItem of nextItems) {
                if (nextItem.kind === 'row' && nextItem.activity === 'model-thinking') continue;
                items.push(nextItem);
            }
        }
    }
    if (!items.length && !running) {
        const thinkingPhase = events.find((candidate): candidate is Extract<AgentRunEvent, { readonly type: 'model_phase' }> =>
            candidate.type === 'model_phase' && candidate.phase === 'thinking');
        if (thinkingPhase) {
            const phase = modelPhasePresentation(locale, 'thinking');
            items.push({
                kind: 'row', key: `model_phase:${thinkingPhase.turn}:thinking`, activity: 'reasoning',
                icon: 'lightbulb', tone: 'done', shimmer: false, title: text(locale, 'thought'), tooltip: phase.detail
            });
        }
    }
    if (running && input.systemPermissionWait) {
        const last = items.at(-1);
        if (last?.kind === 'row' && last.activity.startsWith('model-')) items.pop();
        items.push({ kind: 'row', key: 'system-permission-wait', activity: 'permission', icon: 'shield', tone: 'running', shimmer: true,
            title: text(locale, 'approvalWaiting'), target: input.systemPermissionWait, targetStyle: 'plain' });
    }
    const streamingText = items.some(item => item.kind === 'text' && item.streaming);
    const projection = { items, plan, idleCaret: streamTail.showCursor && !streamingText, streamTail };
    if (!cachedProjections) {
        cachedProjections = new Map();
        streamProjectionCache.set(input.events, cachedProjections);
    }
    if (cachedProjections.size >= 8 && !cachedProjections.has(cacheKey)) cachedProjections.delete(cachedProjections.keys().next().value!);
    cachedProjections.set(cacheKey, projection);
    streamProjectionPatches.set(projection, changes.map(change => change.patch));
    return projection;
}

const localizedOutcomeKeys: readonly AgentOutcomeTextKey[] = [
    'insufficient_balance', 'switch_policy_invalid', 'price_changed', 'model_not_ready', 'route_unavailable', 'route_capacity',
    'privacy_route_unavailable', 'rate_limited', 'model_auth', 'model_unavailable', 'model_timeout', 'network_failed', 'tool_failed',
    'waiting_user', 'failed', 'fallbackBody', 'contextWindowBody', 'mediaContextBody', 'cancelledBody'
];

const scripts: Readonly<Partial<Record<NextMuxDesktopLocale, RegExp>>> = {
    'zh-CN': /[\u3400-\u9fff]/, 'zh-TW': /[\u3400-\u9fff]/, ja: /[\u3040-\u30ff\u3400-\u9fff]/, ko: /[\uac00-\ud7af]/,
    ru: /[\u0400-\u04ff]/, ar: /[\u0600-\u06ff]/, hi: /[\u0900-\u097f]/
};

/**
 * One short sentence for a failed turn, in the user's language. Known failures
 * use the shared provider classifier before legacy desktop failure copy. Other text is
 * shown only when it is a short plain sentence in the user's script, never a
 * code, JSON, stack trace or URL. Everything else becomes a generic sentence.
 */
export function conversationErrorText(locale: NextMuxDesktopLocale, value: unknown, context?: ScenarioModelErrorOptions): string {
    const threadContext: ScenarioModelErrorOptions = { surface: 'thread', ...context };
    if (value !== undefined && value !== null && value !== '') {
        const scenario = modelFailure(locale, value, threadContext);
        if (scenario.text === runningTaskText(locale, 'selectRelayFirst')
            || scenario.text === runningTaskText(locale, 'selectModelFirst')
            || scenario.text === runningTaskText(locale, 'modelUnavailable')
            || scenario.text === runningTaskText(locale, 'routeUnavailable')) {
            return scenario.text;
        }
    }
    const mapped = formatModelError(value, locale, threadContext);
    if (mapped.kind !== 'unknown') return modelFailureText(locale, mapped, threadContext);
    const message = redactModelErrorDetail(desktopFailureMessage(locale, value)).trim();
    if (localizedOutcomeKeys.some(key => agentOutcomeText(locale, key) === message)) return message;
    // Code patterns are case-sensitive: ordinary words ("email", "exceeded")
    // must never look like an errno or an identifier.
    const technical = !message || message.length > 180 || Boolean(mapped.code && message.includes(mapped.code))
        || /[{}\[\]<>`|\\]|https?:\/\/|\bat\s+\S+\s+\([^)]*[:/][^)]*\)|\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b|\b[a-z][a-z0-9]*_[a-z0-9_]+\b/.test(message)
        || /\b(?:HTTP|[Ss]tatus|[Cc]ode|errno)\s*[:=#]?\s*\d{3}\b|^\s*(?:[A-Z]\w*)?Error\s*:|\bE[A-Z]{4,}\b|\b0x[0-9a-fA-F]{4,}\b/.test(message);
    const script = scripts[locale];
    // Latin-script locales share one rule: plain Latin text is readable.
    const readable = script ? script.test(message) : !/[^\u0000-\u024f\u2000-\u206f]/.test(message);
    return !technical && readable ? message : agentOutcomeText(locale, 'fallbackBody');
}

/** The unabridged failure text, kept for the notice tooltip when the visible sentence replaced it. */
export function conversationErrorDetail(locale: NextMuxDesktopLocale, value: unknown): string | undefined {
    const raw = formatModelError(value, locale).detail.trim();
    return raw && raw !== conversationErrorText(locale, value) ? raw : undefined;
}
