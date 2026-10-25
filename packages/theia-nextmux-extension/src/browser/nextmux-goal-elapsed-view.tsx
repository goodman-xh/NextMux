import * as React from 'react';
import { formatGoalElapsed, goalActiveElapsedMs, goalTurnRunning, type ElapsedGoal, type ElapsedGoalTurn } from './nextmux-goal-elapsed';

/** The clock updates this small leaf, never the desktop widget. */
export function GoalElapsed({ goal, turns }: { readonly goal: ElapsedGoal; readonly turns: readonly ElapsedGoalTurn[] }): React.ReactElement {
    const [, tick] = React.useState(0);
    const running = goalTurnRunning(goal, turns);
    React.useEffect(() => {
        if (!running) return undefined;
        const timer = window.setInterval(() => tick(value => value + 1), 30_000);
        return () => window.clearInterval(timer);
    }, [running]);
    return <span data-nmx-literal>{formatGoalElapsed(goalActiveElapsedMs(goal, turns, Date.now()))}</span>;
}
