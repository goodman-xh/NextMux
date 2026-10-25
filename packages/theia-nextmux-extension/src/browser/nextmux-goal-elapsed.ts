import { goalRequestObjective } from './nextmux-goal-presentation';

export interface ElapsedGoal {
    readonly createdAt: number;
    readonly status: string;
    readonly pausedAt?: number;
    /** Closed pause intervals also exclude pauses within a still-running turn after resume. */
    readonly activeTimePauses?: readonly { readonly start: number; readonly end: number }[];
}

export interface ElapsedGoalTurn {
    readonly prompt: string;
    readonly createdAt: number;
    readonly completedAt?: number;
    readonly stage: string;
    readonly automaticGoal?: boolean;
    readonly goalPresentationOrigin?: 'automatic-v1' | 'user';
}

export function isGoalElapsedTurn(goal: ElapsedGoal, turn: ElapsedGoalTurn): boolean {
    return Number.isFinite(turn.createdAt) && turn.createdAt >= goal.createdAt
        && (turn.goalPresentationOrigin === 'automatic-v1' || turn.automaticGoal === true
            || turn.goalPresentationOrigin !== 'user' && goalRequestObjective(turn.prompt) !== undefined);
}

export function goalTurnRunning(goal: ElapsedGoal, turns: readonly ElapsedGoalTurn[]): boolean {
    return goal.status === 'active' && turns.some(turn => turn.stage === 'running' && isGoalElapsedTurn(goal, turn));
}

export function goalActiveElapsedMs(goal: ElapsedGoal, turns: readonly ElapsedGoalTurn[], now: number): number {
    if (!Number.isFinite(now)) return 0;
    return turns.reduce((total, turn) => {
        if (!isGoalElapsedTurn(goal, turn)) return total;
        const end = Math.min(now, turn.completedAt ?? (turn.stage === 'running' ? now : turn.createdAt));
        if (!Number.isFinite(end) || end <= turn.createdAt) return total;
        const pauses = [...(goal.activeTimePauses || []),
            ...(goal.pausedAt !== undefined ? [{ start: goal.pausedAt, end: now }] : [])]
            .filter(pause => Number.isFinite(pause.start) && Number.isFinite(pause.end) && pause.end > pause.start)
            .sort((a, b) => a.start - b.start);
        let paused = 0, cursor = turn.createdAt;
        for (const pause of pauses) {
            const start = Math.max(cursor, pause.start), stop = Math.min(end, pause.end);
            if (stop > start) { paused += stop - start; cursor = stop; }
        }
        return total + Math.max(0, end - turn.createdAt - paused);
    }, 0);
}

export function formatGoalElapsed(ms: number): string {
    const minutes = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes / 60) % 24;
    return days ? `${days}d ${hours}h ${minutes % 60}m`
        : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** Validate persisted timing without trusting imported recovery metadata. */
export function normalizeGoalTiming(value: { readonly pausedAt?: unknown; readonly activeTimePauses?: unknown }): Pick<ElapsedGoal, 'pausedAt' | 'activeTimePauses'> {
    return { pausedAt: typeof value.pausedAt === 'number' && Number.isFinite(value.pausedAt) && value.pausedAt >= 0 ? value.pausedAt : undefined,
        activeTimePauses: Array.isArray(value.activeTimePauses) ? value.activeTimePauses.filter(pause => pause
            && Number.isFinite(pause.start) && Number.isFinite(pause.end) && pause.start >= 0 && pause.end > pause.start)
            .map(pause => ({ start: pause.start as number, end: pause.end as number })) : [] };
}

export function pauseGoalTiming(goal: ElapsedGoal, now: number): Pick<ElapsedGoal, 'pausedAt' | 'activeTimePauses'> {
    return { ...normalizeGoalTiming(goal), pausedAt: goal.pausedAt ?? now };
}

export function resumeGoalTiming(goal: ElapsedGoal, now: number): Pick<ElapsedGoal, 'pausedAt' | 'activeTimePauses'> {
    return { pausedAt: undefined, activeTimePauses: [...(goal.activeTimePauses || []),
        ...(goal.pausedAt !== undefined && now > goal.pausedAt ? [{ start: goal.pausedAt, end: now }] : [])] };
}
