export interface TimelineScrollMetrics {
    readonly scrollTop: number;
    readonly scrollHeight: number;
    readonly clientHeight: number;
}

export function timelineWheelDelta(delta: number, deltaMode: number, viewportHeight: number): number {
    if (!Number.isFinite(delta)) return 0;
    if (deltaMode === 1) return delta * 18;
    if (deltaMode === 2) return delta * Math.max(0, viewportHeight);
    return delta;
}

export function boundedTimelineScrollTop(metrics: TimelineScrollMetrics, delta: number): number {
    const maximum = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
    return Math.max(0, Math.min(maximum, metrics.scrollTop + delta));
}
