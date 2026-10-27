import * as React from 'react';
import { CouncilPopover, trapCouncilDialogFocus, useCouncilDialogFocus } from './nextmux-council-popover';
import {
    AGENT_COUNCIL_ROLES,
    MAX_COUNCIL_SLOTS,
    MIN_COUNCIL_SLOTS,
    normalizeAgentCouncilRoleId,
    validateAgentCouncilConfig,
    type AgentCouncilRole,
    type AgentCouncilRoleId
} from '@nextmux/agent-runtime/council';
import type {
    DesktopAgentChildSnapshot,
    DesktopAgentCouncilSlot
} from '../common/nextmux-platform-protocol';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { councilModeText, councilRoleLabel } from './nextmux-council-mode-locale';
import { councilValidationMessage } from './nextmux-council-validation';

export interface CouncilDraftSlot {
    readonly slotId: string;
    readonly modelId: string;
    readonly routeId?: string;
    readonly label?: string;
    readonly modelLabel?: string;
    readonly roles: readonly AgentCouncilRole[];
}

export interface CouncilModelCandidate {
    readonly id?: string;
    readonly model?: string;
    readonly modelId: string;
    readonly label: string;
    readonly routeId: string;
    readonly detail?: string;
    readonly variantTag?: string;
}

export type CouncilSubConversationPhase =
    | 'entering'
    | 'visible'
    | 'locked'
    | 'timer_running'
    | 'exiting'
    | 'archived';

interface SubConversationEntry {
    phase: CouncilSubConversationPhase;
    viewedByUser: boolean;
    lastStatus: DesktopAgentChildSnapshot['status'];
    enterTimer?: ReturnType<typeof setTimeout>;
    disappearTimer?: ReturnType<typeof setTimeout>;
    exitTimer?: ReturnType<typeof setTimeout>;
}

export const COUNCIL_SUB_CONVERSATION_ENTER_MS = 220;
export const COUNCIL_SUB_CONVERSATION_EXIT_MS = 800;
export const COUNCIL_SUB_CONVERSATION_DISAPPEAR_MS = 10_000;

export function isTerminalChildStatus(status: DesktopAgentChildSnapshot['status']): boolean {
    return status !== 'running';
}

/**
 * Manages the lifecycle and 10-second silent conditional disappearance of
 * role sub-conversations in the left sidebar (`|_ （岗位）...`).
 *
 * Rules:
 * 1. Appears for a role of the run in progress: a configured role at once (a pending row), a dispatched role as its child.
 * 2. While `running`, never disappears.
 * 3. If user views the sub-conversation (`activeChildId === childRunId`), it is `locked`:
 *    - Never disappears while viewing it.
 *    - The mounted role view reports leaving even when switching to `models` (模型广场), `comic` (漫剧), or `settings` (设置).
 * 4. Only when the user switches to another conversation (or if the sub-conversation finishes
 *    while the user is already viewing another conversation) does a silent 10-second timer start.
 * 5. Re-entering the sub-conversation before 10s cancels the timer and re-locks it.
 * 6. A child first seen already finished — saved history after a restart, an earlier run — is archived at once:
 *    only a run of this app session (`councilLive`) or the user's own selection earns the 10-second countdown.
 */
export class CouncilSubConversationVisibilityController {
    private readonly entries = new Map<string, SubConversationEntry>();
    private activeChildId = '';
    private readonly onUpdate: () => void;
    private readonly disappearMs: number;
    private readonly animationMs: number;
    private readonly enterAnimationMs: number;

    constructor(
        onUpdate: () => void,
        options?: { readonly disappearMs?: number; readonly animationMs?: number; readonly enterAnimationMs?: number }
    ) {
        this.onUpdate = onUpdate;
        this.disappearMs = options?.disappearMs ?? COUNCIL_SUB_CONVERSATION_DISAPPEAR_MS;
        this.animationMs = options?.animationMs ?? COUNCIL_SUB_CONVERSATION_EXIT_MS;
        this.enterAnimationMs = options?.enterAnimationMs
            ?? (options?.animationMs !== undefined
                ? Math.min(options.animationMs, COUNCIL_SUB_CONVERSATION_ENTER_MS)
                : COUNCIL_SUB_CONVERSATION_ENTER_MS);
    }

    getActiveChildId(): string {
        return this.activeChildId;
    }

    syncChildren(children: readonly DesktopAgentChildSnapshot[]): void {
        for (const child of children) {
            const id = child.childRunId;
            let entry = this.entries.get(id);
            const isCurrentlyViewed = this.activeChildId === id;
            const nowTerminal = isTerminalChildStatus(child.status);

            if (!entry) {
                if (nowTerminal && !isCurrentlyViewed && !(child as CouncilRoleChild).councilLive) {
                    // Never seen running here: it finished before this app session or in an earlier run. No countdown.
                    this.entries.set(id, { phase: 'archived', viewedByUser: false, lastStatus: child.status });
                    continue;
                }
                entry = {
                    phase: isCurrentlyViewed ? 'locked' : 'entering',
                    viewedByUser: isCurrentlyViewed,
                    lastStatus: child.status
                };
                this.entries.set(id, entry);
                if (!isCurrentlyViewed && !nowTerminal) {
                    const targetEntry = entry;
                    targetEntry.enterTimer = setTimeout(() => {
                        targetEntry.enterTimer = undefined;
                        if (targetEntry.phase === 'entering') {
                            targetEntry.phase = this.activeChildId === id ? 'locked' : 'visible';
                            if (isTerminalChildStatus(targetEntry.lastStatus) && this.activeChildId !== id) {
                                this.startDisappearTimer(id, targetEntry);
                            }
                            this.onUpdate();
                        }
                    }, this.enterAnimationMs);
                }
            }

            const wasRunning = !isTerminalChildStatus(entry.lastStatus);
            entry.lastStatus = child.status;

            if (!nowTerminal) {
                // If a child resumed running, cancel any pending disappear/exit timers and show it.
                this.clearDisappearTimers(entry, isCurrentlyViewed || entry.phase !== 'entering');
                if (isCurrentlyViewed) {
                    entry.viewedByUser = true;
                    entry.phase = 'locked';
                } else if (entry.phase === 'archived' || entry.phase === 'exiting' || entry.phase === 'timer_running') {
                    entry.phase = 'visible';
                }
            } else if (isCurrentlyViewed) {
                // Viewing this child right now: keep it locked even after completion.
                this.clearDisappearTimers(entry);
                entry.viewedByUser = true;
                entry.phase = 'locked';
            } else if (wasRunning && nowTerminal && entry.phase !== 'archived' && entry.phase !== 'exiting') {
                // Just finished while user is on another conversation: start silent 10s timer.
                this.startDisappearTimer(id, entry);
            } else if (nowTerminal && (entry.phase === 'visible' || entry.phase === 'entering')) {
                // Already terminal and not viewed: ensure timer is running.
                this.startDisappearTimer(id, entry);
            }
        }
    }

    selectChild(childRunId: string): void {
        const previousChildId = this.activeChildId;
        this.activeChildId = childRunId;

        if (previousChildId && previousChildId !== childRunId) {
            const prevEntry = this.entries.get(previousChildId);
            if (prevEntry && isTerminalChildStatus(prevEntry.lastStatus) && prevEntry.phase !== 'archived') {
                this.startDisappearTimer(previousChildId, prevEntry);
            }
        }

        if (childRunId) {
            const entry = this.entries.get(childRunId);
            if (entry) {
                this.clearDisappearTimers(entry);
                entry.viewedByUser = true;
                entry.phase = 'locked';
            }
        }
        this.onUpdate();
    }

    /**
     * Called when the user explicitly navigates to another conversation
     * (e.g. clicking the parent Lead conversation, clicking "返回主对话",
     * or switching to another conversation in the sidebar).
     * Note: Switching to `models`, `comic` studio, or `settings` must NOT call this.
     */
    leaveToConversation(): void {
        const previousChildId = this.activeChildId;
        if (!previousChildId) return;
        this.activeChildId = '';
        const prevEntry = this.entries.get(previousChildId);
        if (prevEntry && isTerminalChildStatus(prevEntry.lastStatus) && prevEntry.phase !== 'archived') {
            this.startDisappearTimer(previousChildId, prevEntry);
        }
        this.onUpdate();
    }

    /**
     * A pending role row was taken by the child the lead dispatched for that role: the child keeps the row's phase,
     * so it neither enters a second time nor starts over, and the view moves with it when the user is on the row.
     */
    adoptEntry(fromId: string, toId: string): void {
        if (!fromId || !toId || fromId === toId) return;
        const entry = this.entries.get(fromId);
        if (this.activeChildId === fromId) this.activeChildId = toId;
        if (!entry) return;
        this.entries.delete(fromId);
        if (this.entries.has(toId)) {
            this.clearDisappearTimers(entry);
            return;
        }
        if (entry.enterTimer !== undefined) {
            // The entrance timer closes over the pending id; settle it now rather than let it act on a stale id.
            clearTimeout(entry.enterTimer);
            entry.enterTimer = undefined;
            if (entry.phase === 'entering') entry.phase = 'visible';
        }
        if (this.activeChildId === toId) {
            entry.viewedByUser = true;
            entry.phase = 'locked';
        }
        this.entries.set(toId, entry);
    }

    getPhase(childRunId: string, status?: DesktopAgentChildSnapshot['status']): CouncilSubConversationPhase {
        const entry = this.entries.get(childRunId);
        if (entry) return entry.phase;
        if (this.activeChildId === childRunId) return 'locked';
        if (status !== undefined) return isTerminalChildStatus(status) ? 'timer_running' : 'entering';
        return 'visible';
    }

    isVisibleInSidebar(childRunId: string): boolean {
        const entry = this.entries.get(childRunId);
        if (!entry) return true;
        return entry.phase !== 'archived';
    }

    visibleItems(children: readonly DesktopAgentChildSnapshot[]): readonly {
        readonly childRunId: string;
        readonly child: DesktopAgentChildSnapshot;
        readonly phase: CouncilSubConversationPhase;
    }[] {
        return children
            .filter(child => this.isVisibleInSidebar(child.childRunId))
            .map(child => ({
                childRunId: child.childRunId,
                child,
                phase: this.getPhase(child.childRunId, child.status)
            }));
    }

    dispose(): void {
        for (const entry of this.entries.values()) {
            this.clearDisappearTimers(entry);
        }
        this.entries.clear();
    }

    private clearDisappearTimers(entry: SubConversationEntry, includeEnterTimer = true): void {
        if (includeEnterTimer && entry.enterTimer !== undefined) {
            clearTimeout(entry.enterTimer);
            entry.enterTimer = undefined;
        }
        if (entry.disappearTimer !== undefined) {
            clearTimeout(entry.disappearTimer);
            entry.disappearTimer = undefined;
        }
        if (entry.exitTimer !== undefined) {
            clearTimeout(entry.exitTimer);
            entry.exitTimer = undefined;
        }
    }

    private startDisappearTimer(childRunId: string, entry: SubConversationEntry): void {
        if (this.activeChildId === childRunId) return;
        if (entry.phase === 'timer_running' && entry.disappearTimer !== undefined) return;
        if (entry.phase === 'exiting' || entry.phase === 'archived') return;

        this.clearDisappearTimers(entry);
        entry.phase = 'timer_running';
        entry.disappearTimer = setTimeout(() => {
            entry.disappearTimer = undefined;
            if (this.activeChildId === childRunId) {
                entry.phase = 'locked';
                this.onUpdate();
                return;
            }
            entry.phase = 'exiting';
            this.onUpdate();
            entry.exitTimer = setTimeout(() => {
                entry.exitTimer = undefined;
                if (this.activeChildId === childRunId) {
                    entry.phase = 'locked';
                } else {
                    entry.phase = 'archived';
                }
                this.onUpdate();
            }, this.animationMs);
        }, this.disappearMs);
    }
}

/** Ids of the rows a running Council run shows for roles the lead has not dispatched yet. */
export const COUNCIL_PENDING_ROLE_PREFIX = 'council-pending:';

export type CouncilRoleChild = DesktopAgentChildSnapshot & {
    /** A configured role of the running run that has no delegated child yet: its row waits for the lead. */
    readonly councilPending?: true;
    /** Belongs to the run in progress in this app session, so a finish seen here still earns the countdown. */
    readonly councilLive?: true;
};

export function isCouncilPendingRoleChild(child: DesktopAgentChildSnapshot | undefined): boolean {
    return Boolean(child && (child as CouncilRoleChild).councilPending);
}

export interface CouncilRoleChildSource {
    readonly sessionId: string;
    readonly turns: readonly {
        readonly id: string;
        readonly prompt?: string;
        readonly stage?: string;
        readonly createdAt?: number;
        readonly childAgents?: readonly DesktopAgentChildSnapshot[];
    }[];
    /** Children the host reports for this conversation's run. */
    readonly liveChildren?: readonly DesktopAgentChildSnapshot[];
    /** This app session drives a run of the conversation now; a stage restored from history does not count. */
    readonly running: boolean;
    /** The turn of that run (else its last running turn). */
    readonly runningTurnId?: string;
    /** The roster of the running Council run. Each non-lead role gets a row as the run starts. */
    readonly councilSlots?: readonly {
        readonly slotId: string;
        readonly modelId?: string;
        readonly modelLabel?: string;
        readonly label?: string;
        readonly roles: readonly AgentCouncilRoleId[];
    }[];
}

export interface CouncilRoleChildren {
    /** History first (finished; a stale `running` reads `interrupted`), then the running turn by role, then extra dispatches. */
    readonly children: readonly CouncilRoleChild[];
    /** A pending row's id → the delegated child that took the row. */
    readonly bindings: ReadonlyMap<string, string>;
}

/** The lead works in the main conversation: only another role, never `lead`, is a sub-conversation. */
function isCouncilRoleSubConversation(child: DesktopAgentChildSnapshot): boolean {
    return Boolean(child.role) && normalizeAgentCouncilRoleId(child.role) !== 'lead';
}

/**
 * The left sidebar's role rows for one conversation (`|_ 「岗位」 title`).
 *
 * While a Council run of this app session is in progress, every configured non-lead role has a row from the start:
 * a pending row until the lead dispatches that role, then the delegated child in the same place (matched by role,
 * else by the slot that runs it). Children of earlier runs, and every child once nothing runs, are history: a child
 * saved mid-run reads `interrupted`, so a restart never revives it as running.
 */
export function collectSessionCouncilRoleChildren(source: CouncilRoleChildSource): CouncilRoleChildren {
    const settled = (child: DesktopAgentChildSnapshot): CouncilRoleChild => child.status === 'running' ? { ...child, status: 'interrupted' } : child;
    const live = new Map((source.liveChildren || []).filter(isCouncilRoleSubConversation).map(child => [child.childRunId, child] as const));
    const runningTurn = source.running
        ? source.turns.find(turn => turn.id === source.runningTurnId) ?? [...source.turns].reverse().find(turn => turn.stage === 'running')
        : undefined;
    const history: CouncilRoleChild[] = [];
    const current = new Map<string, CouncilRoleChild>();
    const listed = new Set<string>();
    const place = (child: DesktopAgentChildSnapshot, inRunningTurn: boolean): void => {
        listed.add(child.childRunId);
        const latest = live.get(child.childRunId) ?? child;
        if (source.running && (inRunningTurn || live.has(child.childRunId))) current.set(latest.childRunId, { ...latest, councilLive: true });
        else history.push(settled(latest));
    };
    for (const turn of source.turns) {
        for (const child of turn.childAgents || []) {
            if (isCouncilRoleSubConversation(child) && !listed.has(child.childRunId)) place(child, turn === runningTurn);
        }
    }
    for (const child of live.values()) if (!listed.has(child.childRunId)) place(child, true);
    const dispatched = [...current.values()].sort((left, right) => left.startedAt - right.startedAt);
    const bindings = new Map<string, string>();
    const turnId = runningTurn?.id || source.runningTurnId;
    const roster = source.running && turnId ? councilSpecialistRoster(source.councilSlots) : [];
    if (!roster.length) return { children: [...history, ...dispatched], bindings };

    // An explicit role takes its row first; a role routed elsewhere (a generalist covering 测试) takes its slot's row.
    const byRole = new Map<AgentCouncilRole, CouncilRoleChild>();
    const unmatched: CouncilRoleChild[] = [];
    for (const child of dispatched) {
        const role = normalizeAgentCouncilRoleId(child.role);
        if (role && !byRole.has(role) && roster.some(entry => entry.role === role)) byRole.set(role, child);
        else unmatched.push(child);
    }
    const extra: CouncilRoleChild[] = [];
    for (const child of unmatched) {
        const entry = child.slotId ? roster.find(candidate => !byRole.has(candidate.role) && candidate.slotIds.includes(child.slotId!)) : undefined;
        if (entry) byRole.set(entry.role, child);
        else extra.push(child);
    }
    const title = (runningTurn?.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const startedAt = runningTurn?.createdAt || 0;
    const rows = roster.map((entry): CouncilRoleChild => {
        const id = `${COUNCIL_PENDING_ROLE_PREFIX}${source.sessionId}:${turnId}:${entry.role}`;
        const child = byRole.get(entry.role);
        if (child) {
            bindings.set(id, child.childRunId);
            return child;
        }
        return {
            childRunId: id, parentRunId: '', rootRunId: '', depth: 1, task: title, role: entry.role, slotId: entry.slotIds[0],
            ...(entry.modelId ? { modelId: entry.modelId } : {}), ...(entry.modelLabel ? { modelLabel: entry.modelLabel } : {}),
            status: 'running', events: [], firstEventIndex: 0, nextEventIndex: 0, startedAt, updatedAt: startedAt,
            taskContext: {
                version: 1, workspaceRoot: '', goal: title, constraints: [], relevantPaths: [], recentOperations: [], depth: 1,
                permissionMode: 'read_only', allowedToolNames: [], selectedMemory: [],
                ...(entry.modelLabel || entry.modelId ? { modelId: entry.modelLabel || entry.modelId } : {})
            },
            councilPending: true, councilLive: true
        };
    });
    return { children: [...history, ...rows, ...extra], bindings };
}

/** The run's non-lead roles in the team's working order (方案 → 前端 → 后端 → 测试 → 审查 → 交付 → 杂活) and the slots that hold each. */
function councilSpecialistRoster(slots: CouncilRoleChildSource['councilSlots']): readonly {
    readonly role: AgentCouncilRole;
    readonly slotIds: readonly string[];
    readonly modelId?: string;
    readonly modelLabel?: string;
}[] {
    const roster = new Map<AgentCouncilRole, { role: AgentCouncilRole; slotIds: string[]; modelId?: string; modelLabel?: string }>();
    for (const slot of slots || []) {
        for (const raw of slot.roles || []) {
            const role = normalizeAgentCouncilRoleId(raw);
            if (!role || role === 'lead') continue;
            const entry = roster.get(role) ?? { role, slotIds: [], modelId: slot.modelId, modelLabel: slot.label || slot.modelLabel };
            if (!entry.slotIds.includes(slot.slotId)) entry.slotIds.push(slot.slotId);
            roster.set(role, entry);
        }
    }
    return [...roster.values()].sort((left, right) => AGENT_COUNCIL_ROLES.indexOf(left.role) - AGENT_COUNCIL_ROLES.indexOf(right.role));
}

export function createDefaultCouncilDraftSlots(
    models: readonly CouncilModelCandidate[],
    existingSlots?: readonly DesktopAgentCouncilSlot[]
): readonly CouncilDraftSlot[] {
    if (existingSlots && existingSlots.length >= MIN_COUNCIL_SLOTS) {
        return existingSlots.map(slot => ({
            slotId: slot.slotId,
            modelId: slot.modelId || slot.modelLabel || slot.slotId,
            routeId: slot.routeId || (slot.route.kind === 'managed_gateway'
                ? (slot.route.route.mode === 'fixed'
                    ? `managed:fixed:${slot.route.route.offeringId}`
                    : `managed:auto:${slot.route.route.registryModelId}`)
                : `official:${slot.route.connectionId}:${slot.route.model}`),
            label: slot.modelLabel,
            modelLabel: slot.modelLabel,
            roles: [...new Set(slot.roles.flatMap(role => {
                const normalized = normalizeAgentCouncilRoleId(role);
                return normalized ? [normalized] : [];
            }))]
        }));
    }
    const defaultRoles: readonly (readonly AgentCouncilRole[])[] = [
        ['lead', 'planning'],
        ['frontend'],
        ['backend', 'generalist']
    ];
    return [0, 1, 2].map(index => {
        const candidate = models[index % Math.max(1, models.length)] || models[0];
        return {
            slotId: `slot-${index + 1}`,
            modelId: candidate?.modelId || candidate?.id || '',
            routeId: candidate?.routeId || '',
            label: candidate?.label || '',
            modelLabel: candidate?.label || '',
            roles: defaultRoles[index] || ['generalist']
        };
    });
}

export function toggleCouncilSlotRole(
    slots: readonly CouncilDraftSlot[],
    targetSlotId: string,
    role: AgentCouncilRole
): readonly CouncilDraftSlot[] {
    return slots.map(slot => {
        if (role === 'lead') {
            // `lead` is mutually exclusive across all slots: selecting it on targetSlotId
            // assigns `lead` to targetSlotId and removes `lead` from other slots.
            if (slot.slotId === targetSlotId) {
                const hasLead = slot.roles.includes('lead');
                const nextRoles = hasLead
                    ? slot.roles.filter(item => item !== 'lead')
                    : ['lead' as const, ...slot.roles.filter(item => item !== 'lead')];
                return { ...slot, roles: nextRoles };
            }
            if (slot.roles.includes('lead')) {
                return { ...slot, roles: slot.roles.filter(item => item !== 'lead') };
            }
            return slot;
        }
        if (slot.slotId !== targetSlotId) return slot;
        const exists = slot.roles.includes(role);
        return {
            ...slot,
            roles: exists ? slot.roles.filter(item => item !== role) : [...slot.roles, role]
        };
    });
}

export function councilDraftHasGeneralist(slots: readonly CouncilDraftSlot[]): boolean {
    return slots.some(slot => slot.roles.includes('generalist'));
}

/**
 * Compact 16×16 branching glyph: one coordinated task, multiple specialist outputs.
 * Visually distinct from `codicon-organization` (right-side Agents / 智能体 button).
 */
export const CouncilModeGlyph: React.FC<{ readonly size?: number; readonly className?: string }> = ({
    size = 16,
    className
}) => (
    <svg
        className={`nmx-council-glyph${className ? ` ${className}` : ''}`}
        viewBox='0 0 16 16'
        width={size}
        height={size}
        fill='none'
        aria-hidden='true'
        focusable='false'
    >
        <path d='M3 4.5V11.5M3 8H8M8 8V3H12M8 8V13H12' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' />
        <circle cx='3' cy='3' r='1.5' fill='currentColor' />
        <circle cx='3' cy='13' r='1.5' fill='currentColor' />
        <rect x='11.5' y='1.5' width='3' height='3' rx='.7' fill='currentColor' />
        <rect x='11.5' y='11.5' width='3' height='3' rx='.7' fill='currentColor' />
    </svg>
);

export interface CouncilConfigModalProps {
    readonly locale: NextMuxDesktopLocale;
    readonly relayKey: string;
    readonly relayLabel: string;
    readonly renderRelayDrawer: () => React.ReactNode;
    readonly models: readonly CouncilModelCandidate[];
    readonly slots: readonly CouncilDraftSlot[];
    readonly openModelPickerSlotId?: string;
    readonly onToggleModelPicker?: (slotId: string) => void;
    readonly openRolePickerSlotId: string;
    readonly onToggleRolePicker: (slotId: string) => void;
    readonly onSelectSlotModel: (slotId: string, routeId: string) => void;
    readonly onToggleSlotRole: (slotId: string, role: AgentCouncilRole) => void;
    readonly onAddSlot: () => void;
    readonly onRemoveSlot: (slotId: string) => void;
    readonly onConfirm: () => void;
    readonly onClose: () => void;
    readonly onDismissDropdowns?: () => void;
    readonly disableSubagents?: boolean;
    readonly onToggleDisableSubagents?: (disabled: boolean) => void;
    readonly onModelOptionPointerEnter?: (model: CouncilModelCandidate, element: HTMLElement) => void;
    readonly onModelOptionPointerLeave?: () => void;
    readonly renderModelOptionHoverPortal?: (model: CouncilModelCandidate) => React.ReactNode;
    readonly errorMessage?: string;
    readonly configWarning?: string;
    readonly agentRunning?: boolean;
    readonly closing?: boolean;
}

export const CouncilConfigModal: React.FC<CouncilConfigModalProps> = props => {
    const {
        locale,
        relayKey,
        relayLabel,
        renderRelayDrawer,
        models,
        slots: draftSlots,
        openModelPickerSlotId: controlledModelPickerSlotId,
        onToggleModelPicker,
        openRolePickerSlotId,
        onToggleRolePicker,
        onSelectSlotModel,
        onToggleSlotRole,
        onAddSlot,
        onRemoveSlot,
        onConfirm,
        onClose,
        onDismissDropdowns,
        errorMessage,
        configWarning,
        agentRunning
    } = props;

    // A draft cannot borrow a model selection from another source or the composer.
    const slots = relayKey && draftSlots.length ? draftSlots : createDefaultCouncilDraftSlots([]);

    const dialog = React.useRef<HTMLElement>(null);
    const slotAnchors = React.useRef(new Map<string, React.RefObject<HTMLDivElement>>());
    const slotAnchor = (key: string): React.RefObject<HTMLDivElement> => {
        let anchor = slotAnchors.current.get(key);
        if (!anchor) { anchor = React.createRef<HTMLDivElement>(); slotAnchors.current.set(key, anchor); }
        return anchor;
    };
    useCouncilDialogFocus(dialog);

    const validation = validateAgentCouncilConfig({
        enabled: true,
        relayKey: relayKey || 'missing',
        revision: 1,
        slots: slots.map(slot => ({
            slotId: slot.slotId,
            modelId: slot.modelId,
            roles: slot.roles
        }))
    });
    const hasGeneralist = councilDraftHasGeneralist(slots);

    const [uncontrolledModelPickerSlotId, setUncontrolledModelPickerSlotId] = React.useState<string>('');
    const openModelPickerSlotId = controlledModelPickerSlotId !== undefined
        ? controlledModelPickerSlotId
        : uncontrolledModelPickerSlotId;

    const setOpenModelPickerSlotId = (slotId: string): void => {
        if (onToggleModelPicker) {
            if (!slotId && openModelPickerSlotId) {
                onToggleModelPicker(openModelPickerSlotId);
            } else if (slotId && openModelPickerSlotId !== slotId) {
                onToggleModelPicker(slotId);
            } else if (slotId && openModelPickerSlotId === slotId) {
                onToggleModelPicker(slotId);
            }
            return;
        }
        setUncontrolledModelPickerSlotId(slotId);
    };

    const hasAnyOpenDropdown = Boolean(openRolePickerSlotId || openModelPickerSlotId);

    const dismissOpenDropdowns = (): void => {
        props.onModelOptionPointerLeave?.();
        if (openModelPickerSlotId && controlledModelPickerSlotId === undefined) {
            setUncontrolledModelPickerSlotId('');
        }
        if (onDismissDropdowns) {
            onDismissDropdowns();
            return;
        }
        if (openRolePickerSlotId) onToggleRolePicker(openRolePickerSlotId);
    };

    return (
        <div
            className={`nmx-sheet-backdrop nmx-dialog-backdrop nmx-council-modal-backdrop${props.closing ? ' is-closing' : ''}`}
            onMouseDown={event => {
                if (event.target === event.currentTarget) {
                    if (hasAnyOpenDropdown) {
                        dismissOpenDropdowns();
                    } else {
                        onClose();
                    }
                }
            }}
        >
            <section
                ref={dialog}
                tabIndex={-1}
                className='nmx-thread-dialog nmx-council-modal'
                role='dialog'
                aria-modal='true'
                aria-labelledby='nmx-council-modal-title'
                onMouseDown={event => {
                    event.stopPropagation();
                    const target = event.target as HTMLElement | null;
                    const inModelPicker = target?.closest?.('[data-council-model-picker]')?.getAttribute('data-council-model-picker') || '';
                    const inRolePicker = target?.closest?.('[data-council-role-picker]')?.getAttribute('data-council-role-picker') || '';
                    const inRelayPicker = target?.closest?.('[data-council-relay-picker]');
                    if (!inModelPicker && !inRolePicker && !inRelayPicker) {
                        if (hasAnyOpenDropdown) {
                            dismissOpenDropdowns();
                        }
                        return;
                    }
                    if (openModelPickerSlotId && inModelPicker !== openModelPickerSlotId && controlledModelPickerSlotId === undefined) {
                        setUncontrolledModelPickerSlotId('');
                    }
                }}
                onKeyDown={event => {
                    trapCouncilDialogFocus(event);
                    if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (hasAnyOpenDropdown) {
                            dismissOpenDropdowns();
                        } else {
                            onClose();
                        }
                    }
                }}
            >
                <header className='nmx-council-modal-header'>
                    <div className='nmx-council-modal-heading'>
                        <span className='nmx-council-modal-badge' aria-hidden='true'>
                            <CouncilModeGlyph size={18} />
                        </span>
                        <div className='nmx-council-modal-titles'>
                            <div className='nmx-council-modal-title-row'>
                                <h2 id='nmx-council-modal-title'>{councilModeText(locale, 'modeName')}</h2>
                            </div>
                            <p>{councilModeText(locale, 'menuDescription')}</p>
                        </div>
                    </div>
                    <button type='button' className='nmx-council-modal-close' aria-label={councilModeText(locale, 'cancelAction')} onClick={onClose}>
                        <i className='codicon codicon-close' aria-hidden='true' />
                    </button>
                </header>

                <div className='nmx-council-modal-body'>
                    <aside className='nmx-council-sources' data-council-relay-picker='true'>
                        <div className='nmx-council-step-label'>
                            <span>{councilModeText(locale, 'selectRelayStep').replace(/^\d+\.\s*/, '')}</span>
                            {relayLabel && <small className='nmx-council-selected-relay-badge'>{relayLabel}</small>}
                        </div>
                        <div className='nmx-council-source-list nmx-model-picker-relay-view' data-council-relay-drawer='true'>
                            {renderRelayDrawer()}
                        </div>
                    </aside>

                    {/* Each row configures one model and its assigned roles. */}
                    <div className='nmx-council-assignments'>
                        <div className='nmx-council-step-header'>
                            <div className='nmx-council-step-label'>
                                <span>{councilModeText(locale, 'selectModelsStep').replace(/^\d+\.\s*/, '')}</span>
                                <small>{slots.length} / {MAX_COUNCIL_SLOTS}</small>
                                {agentRunning && <small className='nmx-council-next-turn-tag'>{councilModeText(locale, 'pendingNextTurnHint')}</small>}
                            </div>
                            <button
                                type='button'
                                className='nmx-secondary-button nmx-council-add-slot'
                                data-council-add-slot='true'
                                disabled={!relayKey || slots.length >= MAX_COUNCIL_SLOTS}
                                onClick={() => {
                                    dismissOpenDropdowns();
                                    onAddSlot();
                                }}
                            >
                                <i className='codicon codicon-add' aria-hidden='true' />
                                <span>{councilModeText(locale, 'addModelSlot')}</span>
                            </button>
                        </div>

                        {/* Prominent Generalist Notice */}
                        {relayKey && <div
                            className={`nmx-council-generalist-note ${hasGeneralist ? 'is-satisfied' : 'is-warning'}`}
                            role='note'
                            data-council-generalist-note='true'
                        >
                            <i className={`codicon codicon-${hasGeneralist ? 'pass-filled' : 'warning'}`} aria-hidden='true' />
                            <span>{councilModeText(locale, hasGeneralist ? 'generalistReady' : 'generalistWarning')}</span>
                        </div>}

                        <div className='nmx-council-slots-list'>
                            {slots.map((slot, index) => {
                                const isLead = slot.roles.includes('lead');
                                const modelPickerOpen = openModelPickerSlotId === slot.slotId;
                                const rolePickerOpen = openRolePickerSlotId === slot.slotId;
                                const normalizedSlotModelId = (slot.modelId || '').trim().toLowerCase();
                                const selectedCandidate = (slot.routeId
                                    ? models.find(model => model.routeId === slot.routeId)
                                    : undefined) ?? models.find(model => {
                                    const optionId = (model.modelId || model.id || '').trim().toLowerCase();
                                    return Boolean(optionId && normalizedSlotModelId === optionId);
                                });
                                const selectedModelLabel = selectedCandidate
                                    ? selectedCandidate.label
                                    : (slot.label || slot.modelLabel || slot.modelId || '');
                                return (
                                    <div
                                        key={slot.slotId}
                                        className={`nmx-council-slot-row ${isLead ? 'is-lead' : ''} ${(modelPickerOpen || rolePickerOpen) ? 'is-picker-open' : ''}`}
                                        data-council-slot={slot.slotId}
                                    >
                                        <span className={`nmx-council-slot-index ${isLead ? 'is-lead' : ''}`} aria-hidden='true'>{index + 1}</span>
                                        <div ref={slotAnchor(`model:${slot.slotId}`)} className='nmx-council-slot-model' data-council-model-picker={slot.slotId}>
                                            <button
                                                type='button'
                                                className={`nmx-council-model-trigger ${modelPickerOpen ? 'is-open' : ''}`}
                                                aria-label={`${councilModeText(locale, 'selectModelPlaceholder')} #${index + 1}`}
                                                aria-haspopup='listbox'
                                                aria-expanded={modelPickerOpen}
                                                data-council-model-select={slot.slotId}
                                                disabled={!relayKey || models.length === 0}
                                                onClick={() => {
                                                    props.onModelOptionPointerLeave?.();
                                                    if (onToggleModelPicker) {
                                                        onToggleModelPicker(slot.slotId);
                                                        return;
                                                    }
                                                    const nextSlotId = modelPickerOpen ? '' : slot.slotId;
                                                    if (nextSlotId && openRolePickerSlotId) {
                                                        if (onDismissDropdowns) {
                                                            onDismissDropdowns();
                                                        } else {
                                                            if (openRolePickerSlotId) onToggleRolePicker(openRolePickerSlotId);
                                                        }
                                                    }
                                                    setOpenModelPickerSlotId(nextSlotId);
                                                }}
                                            >
                                                <span className={`nmx-council-model-trigger-label ${selectedModelLabel ? '' : 'is-placeholder'}`}>
                                                    {selectedModelLabel || councilModeText(locale, 'selectModelPlaceholder')}
                                                </span>
                                                {selectedCandidate?.variantTag && <small className='nmx-model-price-variant nmx-council-model-price' dir='ltr'>{selectedCandidate.variantTag}</small>}
                                                <i className={`codicon codicon-chevron-${modelPickerOpen ? 'up' : 'down'} nmx-council-select-chevron`} aria-hidden='true' />
                                            </button>

                                            {modelPickerOpen && (
                                                <CouncilPopover dialog={dialog} anchor={slotAnchor(`model:${slot.slotId}`)} kind='model'
                                                    slotId={slot.slotId} label={`${councilModeText(locale, 'selectModelPlaceholder')} ${index + 1}`}
                                                    onDismiss={dismissOpenDropdowns}>
                                                    {models.map(model => {
                                                        const optionId = model.modelId || model.id || '';
                                                        const selected = selectedCandidate === model;
                                                        const optionTitle = [model.label, model.detail, model.variantTag].filter(Boolean).join(' · ');
                                                        return (
                                                            <React.Fragment key={`${model.routeId}:${optionId}`}>
                                                                <button
                                                                    type='button'
                                                                    role='option'
                                                                    aria-selected={selected}
                                                                    data-council-model-option={optionId}
                                                                    title={optionTitle}
                                                                    data-nmx-tip={optionTitle}
                                                                    className={`nmx-council-model-option ${selected ? 'is-selected' : ''}`}
                                                                    onPointerEnter={event => props.onModelOptionPointerEnter?.(model, event.currentTarget)}
                                                                    onFocus={event => props.onModelOptionPointerEnter?.(model, event.currentTarget)}
                                                                    onPointerLeave={() => props.onModelOptionPointerLeave?.()}
                                                                    onBlur={() => props.onModelOptionPointerLeave?.()}
                                                                    onClick={() => {
                                                                        props.onModelOptionPointerLeave?.();
                                                                        onSelectSlotModel(slot.slotId, model.routeId);
                                                                        setOpenModelPickerSlotId('');
                                                                        slotAnchor(`model:${slot.slotId}`).current?.querySelector('button')?.focus({ preventScroll: true });
                                                                    }}
                                                                >
                                                                    <i className={`codicon codicon-${selected ? 'check' : 'blank'}`} aria-hidden='true' />
                                                                    <span className='nmx-council-model-option-main'>
                                                                        <span className='nmx-council-model-option-label'>
                                                                            {model.label}
                                                                        </span>
                                                                        {model.detail && model.detail !== relayLabel && (
                                                                            <small className='nmx-council-model-option-detail'>{model.detail}</small>
                                                                        )}
                                                                    </span>
                                                                    {model.variantTag && <small className='nmx-model-price-variant nmx-council-model-price' dir='ltr'>{model.variantTag}</small>}
                                                                </button>
                                                                {props.renderModelOptionHoverPortal?.(model)}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </CouncilPopover>
                                            )}
                                        </div>

                                        <div ref={slotAnchor(`role:${slot.slotId}`)} className='nmx-council-slot-roles' data-council-role-picker={slot.slotId}>
                                            <button
                                                type='button'
                                                className={`nmx-council-roles-trigger ${rolePickerOpen ? 'is-open' : ''}`}
                                                data-council-roles-trigger={slot.slotId}
                                                aria-expanded={rolePickerOpen}
                                                onClick={() => {
                                                    props.onModelOptionPointerLeave?.();
                                                    setOpenModelPickerSlotId('');
                                                    onToggleRolePicker(slot.slotId);
                                                }}
                                            >
                                                <span className='nmx-council-role-chips'>
                                                    {slot.roles.length > 0 ? slot.roles.map(role => (
                                                        <span
                                                            key={role}
                                                            className={`nmx-council-role-chip is-role-${role}`}
                                                            data-council-role-chip={role}
                                                        >
                                                            {councilRoleLabel(locale, role)}
                                                        </span>
                                                    )) : (
                                                        <span className='nmx-council-role-placeholder'>
                                                            {councilModeText(locale, 'selectRolesPlaceholder')}
                                                        </span>
                                                    )}
                                                </span>
                                                <i className={`codicon codicon-chevron-${rolePickerOpen ? 'up' : 'down'}`} aria-hidden='true' />
                                            </button>

                                            {rolePickerOpen && (
                                                <CouncilPopover dialog={dialog} anchor={slotAnchor(`role:${slot.slotId}`)} kind='role'
                                                    slotId={slot.slotId} label={councilModeText(locale, 'selectRolesPlaceholder')}
                                                    onDismiss={dismissOpenDropdowns}>
                                                    {AGENT_COUNCIL_ROLES.map(role => {
                                                        const checked = slot.roles.includes(role);
                                                        return (
                                                            <button
                                                                key={role}
                                                                type='button'
                                                                role='checkbox'
                                                                aria-checked={checked}
                                                                data-council-role-option={role}
                                                                className={`nmx-council-role-option ${checked ? 'is-checked' : ''} ${role === 'lead' ? 'is-lead-option' : ''}`}
                                                                onClick={() => onToggleSlotRole(slot.slotId, role)}
                                                            >
                                                                <i className={`codicon codicon-${checked ? 'check' : 'blank'}`} aria-hidden='true' />
                                                                <span>{councilRoleLabel(locale, role)}</span>
                                                            </button>
                                                        );
                                                    })}
                                                </CouncilPopover>
                                            )}
                                        </div>

                                        <button
                                            type='button'
                                            className='nmx-council-slot-remove'
                                            aria-label={councilModeText(locale, 'removeModelSlot')}
                                            title={councilModeText(locale, 'removeModelSlot')}
                                            disabled={slots.length <= MIN_COUNCIL_SLOTS}
                                            onClick={() => onRemoveSlot(slot.slotId)}
                                        >
                                            <i className='codicon codicon-trash' aria-hidden='true' />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {(errorMessage || !validation.valid && relayKey || configWarning) && (
                        <p className='nmx-council-validation-error' role='alert'>
                            <i className='codicon codicon-error' aria-hidden='true' />
                            <span>
                                {errorMessage || (relayKey && !validation.valid
                                    ? councilValidationMessage(locale, validation.error) : configWarning)}
                            </span>
                        </p>
                    )}
                </div>

                <footer className='nmx-council-modal-footer'>
                    <label className='nmx-council-prevent-subagents' data-council-prevent-subagents='true'>
                        <input
                            type='checkbox'
                            checked={props.disableSubagents ?? true}
                            onChange={event => props.onToggleDisableSubagents?.(event.currentTarget.checked)}
                        />
                        <span>{councilModeText(locale, 'preventSubagents')}</span>
                    </label>
                    <div className='nmx-council-modal-footer-actions'>
                        <button type='button' onClick={onClose}>{councilModeText(locale, 'cancelAction')}</button>
                        <button
                            type='button'
                            className='is-primary'
                            data-council-confirm='true'
                            disabled={!relayKey || !validation.valid}
                            onClick={onConfirm}
                        >
                            {councilModeText(locale, agentRunning ? 'enableNextTurnButton' : 'enableButton')}
                        </button>
                    </div>
                </footer>
            </section>
        </div>
    );
};

export interface CouncilCloseConfirmModalProps {
    readonly locale: NextMuxDesktopLocale;
    readonly onConfirm: () => void;
    readonly onCancel: () => void;
}

export const CouncilCloseConfirmModal: React.FC<CouncilCloseConfirmModalProps> = ({ locale, onConfirm, onCancel }) => {
    const dialog = React.useRef<HTMLElement>(null);
    useCouncilDialogFocus(dialog);
    return (
    <div className='nmx-sheet-backdrop nmx-dialog-backdrop nmx-council-close-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
        <section
            ref={dialog} tabIndex={-1}
            className='nmx-thread-dialog nmx-council-close-dialog'
            role='alertdialog'
            aria-modal='true'
            aria-labelledby='nmx-council-close-title'
            aria-describedby='nmx-council-close-desc'
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={event => {
                trapCouncilDialogFocus(event);
                if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                    event.preventDefault();
                    event.stopPropagation();
                    onCancel();
                }
            }}
        >
            <header>
                <h2 id='nmx-council-close-title'>{councilModeText(locale, 'closeConfirmTitle')}</h2>
                <button type='button' aria-label={councilModeText(locale, 'cancelAction')} onClick={onCancel}>
                    <i className='codicon codicon-close' aria-hidden='true' />
                </button>
            </header>
            <p id='nmx-council-close-desc'>{councilModeText(locale, 'closeConfirmBody')}</p>
            <footer>
                <button type='button' autoFocus onClick={onCancel}>{councilModeText(locale, 'cancelAction')}</button>
                <button type='button' className='is-danger' data-council-confirm-close='true' onClick={onConfirm}>
                    {councilModeText(locale, 'closeConfirmAction')}
                </button>
            </footer>
        </section>
    </div>
    );
};

/** Fixed tones survive role reorderings and also support future/unknown roles. */
export function councilRoleTone(role: string): number {
    const known = ['lead', 'planning', 'frontend', 'backend', 'qa', 'review', 'delivery', 'generalist'];
    const index = known.indexOf(role);
    if (index >= 0) return index % 8 + 1;
    let hash = 0;
    for (const char of role) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    return hash % 8 + 1;
}

/** Row status glyph. A stop, a pause, a question for the user or a reached limit is not drawn as a failure. */
function councilChildStatusIcon(status: DesktopAgentChildSnapshot['status']): string {
    switch (status) {
        case 'running': return 'loading codicon-modifier-spin';
        case 'completed': return 'pass';
        case 'cancelled':
        case 'interrupted': return 'debug-stop';
        case 'paused': return 'debug-pause';
        case 'waiting_user': return 'question';
        case 'limit_reached': return 'warning';
        default: return 'error';
    }
}

export interface CouncilSidebarSubConversationsProps {
    readonly locale: NextMuxDesktopLocale;
    readonly sessionId: string;
    readonly childrenSnapshots: readonly DesktopAgentChildSnapshot[];
    readonly activeChildId: string;
    readonly visibilityController: CouncilSubConversationVisibilityController;
    readonly onSelectChild: (sessionId: string, childRunId: string) => void;
    readonly rolesForChild?: (child: DesktopAgentChildSnapshot) => readonly string[];
}

export const CouncilSidebarSubConversations: React.FC<CouncilSidebarSubConversationsProps> = ({
    locale,
    sessionId,
    childrenSnapshots,
    activeChildId,
    visibilityController,
    onSelectChild,
    rolesForChild
}) => {
    // Synced before filtering, so a child the controller archives on first sight (finished history) is never painted.
    if (childrenSnapshots.length) visibilityController.syncChildren(childrenSnapshots);
    const visibleChildren = childrenSnapshots.filter(child => visibilityController.isVisibleInSidebar(child.childRunId));
    if (!visibleChildren.length) return null;

    return (
        <div className='nmx-sub-conversation-list' role='group' aria-label={councilModeText(locale, 'modeName')}>
            {visibleChildren.map((child, idx) => {
                const phase = visibilityController.getPhase(child.childRunId, child.status);
                const isSelected = activeChildId === child.childRunId;
                const role = child.role || 'generalist';
                const roleName = councilRoleLabel(locale, role);
                // One badge per role the caller names (the sidebar names only the dispatched role): never none, never twice.
                const suppliedRoles = rolesForChild?.(child);
                const roles = suppliedRoles?.length ? [...new Set(suppliedRoles)] : [role];
                const isLast = idx === visibleChildren.length - 1;
                const pending = isCouncilPendingRoleChild(child);
                const awaiting = pending ? councilModeText(locale, 'roleAwaitingDispatch') : '';
                const statusIcon = pending ? 'clock' : councilChildStatusIcon(child.status);
                const title = child.task || awaiting;
                return (
                    <div
                        key={child.childRunId}
                        className={`nmx-session-row is-council-child${isLast ? ' is-council-last' : ''}${phase === 'exiting' ? ' is-council-fading' : ''}${pending ? ' is-council-pending' : ''} nmx-sub-conversation-row ${isSelected ? 'is-current' : ''} ${phase === 'entering' ? 'is-entering' : ''} ${phase === 'exiting' ? 'is-exiting' : ''} ${isLast ? 'is-last-branch' : ''}`}
                        data-council-tone={councilRoleTone(role)}
                        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
                        data-sub-conversation-id={child.childRunId}
                        data-sub-conversation-role={role}
                        data-sub-conversation-phase={phase}
                        data-sub-conversation-pending={pending || undefined}
                    >
                        <span className='nmx-council-tree nmx-sub-conversation-connector' aria-hidden='true' />
                        <span className='nmx-council-role-badges'>{roles.map(item => <span key={item} className='nmx-council-role-badge' data-council-tone={councilRoleTone(item)}>{councilRoleLabel(locale, item as AgentCouncilRole)}</span>)}</span>
                        <button
                            type='button'
                            className='nmx-sub-conversation-open'
                            onClick={event => {
                                event.stopPropagation();
                                onSelectChild(sessionId, child.childRunId);
                            }}
                            title={pending ? `${roleName} · ${awaiting}` : `${roleName} · ${child.task}`}
                            aria-label={pending ? `${roleName} · ${title} · ${awaiting}` : undefined}
                        >
                            <span className='nmx-sub-conversation-title' data-nmx-literal dir='auto'>
                                {title}
                            </span>
                            <i className={`codicon codicon-${statusIcon} nmx-sub-conversation-status is-${pending ? 'pending' : child.status}`} aria-hidden='true' />
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

export interface CouncilRoleConversationStageProps {
    readonly locale: NextMuxDesktopLocale;
    readonly child: DesktopAgentChildSnapshot;
    readonly statusLabel: string;
    readonly onBackToLead: () => void;
    readonly onViewingChange?: (viewing: boolean) => void;
    readonly renderTask?: (child: DesktopAgentChildSnapshot) => React.ReactNode;
    readonly renderActivity: (child: DesktopAgentChildSnapshot) => React.ReactNode;
    readonly renderOutput: (child: DesktopAgentChildSnapshot) => React.ReactNode;
}

export const CouncilRoleConversationStage: React.FC<CouncilRoleConversationStageProps> = ({
    locale,
    child,
    statusLabel,
    onBackToLead,
    onViewingChange,
    renderTask,
    renderActivity,
    renderOutput
}) => {
    const role = child.role || 'generalist';
    const roleName = councilRoleLabel(locale, role);
    const modelName = child.taskContext.modelId || '';
    // Opened before the lead dispatched this role: say so, rather than a "running" role with an empty transcript.
    const pending = isCouncilPendingRoleChild(child);
    const awaiting = pending ? councilModeText(locale, 'roleAwaitingDispatch') : '';
    const onViewingChangeRef = React.useRef(onViewingChange);
    onViewingChangeRef.current = onViewingChange;
    React.useEffect(() => {
        onViewingChangeRef.current?.(true);
    }, [child.childRunId]);
    React.useEffect(() => () => {
        onViewingChangeRef.current?.(false);
    }, []);

    return (
        <div className='nmx-task-view nmx-role-conversation-view' data-conversation-kind='role' data-role-child-id={child.childRunId}>
            <header className='nmx-team-identity-bar'>
                <div className='nmx-team-identity-leading'>
                    <button type='button' className='nmx-team-back-button' data-council-back-to-lead='true' onClick={onBackToLead}>
                        <i className='codicon codicon-arrow-left' aria-hidden='true' />
                        <span>{councilModeText(locale, 'backToLeadConversation')}</span>
                    </button>
                    <span className={`nmx-council-role-chip is-role-${role}`}>
                        {roleName}
                    </span>
                    {modelName && (
                        <span className='nmx-team-identity-model' data-nmx-literal>
                            <i className='codicon codicon-hubot' aria-hidden='true' />
                            <span>{modelName}</span>
                        </span>
                    )}
                    <span className={`nmx-team-identity-status is-${pending ? 'pending' : child.status}`}>
                        {pending ? awaiting : statusLabel}
                    </span>
                </div>
                <span className='nmx-team-readonly-pill'>
                    <i className='codicon codicon-eye' aria-hidden='true' />
                    <span>{councilModeText(locale, 'roleSubConversationReadonlyHint')}</span>
                </span>
            </header>

            <div className='nmx-role-conversation-scroll'>
                <section className='nmx-task-turn is-first is-last' data-turn-id={child.childRunId}>
                    {pending ? <div className='nmx-user-message'>
                        <div className='nmx-role-dispatch-heading'>
                            <strong>{councilRoleLabel(locale, 'lead')} → {roleName}</strong>
                        </div>
                        <p className='nmx-role-awaiting' role='status'>
                            <i className='codicon codicon-clock' aria-hidden='true' />
                            <span>{awaiting}</span>
                        </p>
                    </div> : <>
                    <div className='nmx-user-message'>
                        <div className='nmx-role-dispatch-heading'>
                            <strong>{councilRoleLabel(locale, 'lead')} → {roleName}</strong>
                        </div>
                        <div data-nmx-literal>{renderTask ? renderTask(child) : child.task}</div>
                        {child.acceptanceCriteria && child.acceptanceCriteria.length > 0 && (
                            <ul className='nmx-role-acceptance-list'>
                                {child.acceptanceCriteria.map((criterion, idx) => (
                                    <li key={idx} data-nmx-literal>{criterion}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div className={`nmx-agent-message is-${child.status === 'running' ? 'running' : child.status === 'completed' ? 'complete' : 'error'}`}>
                        <div>
                            {renderActivity(child)}
                            {renderOutput(child)}
                            {child.error && (
                                <p className='nmx-agent-child-error' data-nmx-literal>{child.error.message}</p>
                            )}
                        </div>
                    </div>
                    </>}
                </section>
            </div>
        </div>
    );
};
