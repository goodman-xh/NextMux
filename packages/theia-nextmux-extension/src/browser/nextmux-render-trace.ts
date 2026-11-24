/**
 * Dev-only lightweight render diagnostics per UI region.
 *
 * Disabled by default with near-zero runtime overhead (no allocations, no storage reads
 * on hot paths). Enable via `globalThis.NEXTMUX_RENDER_TRACE = true`,
 * `process.env.NEXTMUX_RENDER_TRACE = '1'`, or `localStorage.setItem('NEXTMUX_RENDER_TRACE', '1')`.
 */

export type RenderProfilerPhase = 'mount' | 'update' | 'nested-update';

export interface RegionRenderTraceStats {
    readonly region: string;
    readonly renderCount: number;
    readonly profilerCount: number;
    readonly lastVersion: string | number | undefined;
    readonly versionChanges: number;
    readonly totalDurationMs: number;
    readonly maxDurationMs: number;
    readonly lastDurationMs: number;
    readonly lastBaseDurationMs: number;
    readonly lastPhase: RenderProfilerPhase | undefined;
    readonly lastUpdatedAt: number;
}

interface MutableRegionStats {
    region: string;
    renderCount: number;
    profilerCount: number;
    lastVersion: string | number | undefined;
    versionChanges: number;
    totalDurationMs: number;
    maxDurationMs: number;
    lastDurationMs: number;
    lastBaseDurationMs: number;
    lastPhase: RenderProfilerPhase | undefined;
    lastUpdatedAt: number;
}

const REGION_STATS = new Map<string, MutableRegionStats>();
const NOOP_PROFILER_CALLBACK = (): void => undefined;

let explicitEnabledOverride: boolean | undefined;
let cachedStorageEnabled: boolean | undefined;

function readStorageFlagOnce(): boolean {
    if (cachedStorageEnabled !== undefined) return cachedStorageEnabled;
    let enabled = false;
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const raw = window.localStorage.getItem('NEXTMUX_RENDER_TRACE');
            enabled = raw === '1' || raw === 'true';
        }
    } catch {
        enabled = false;
    }
    cachedStorageEnabled = enabled;
    return enabled;
}

function isTruthyFlag(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
}

/** Returns true only when render tracing has been explicitly enabled for dev/test diagnostics. */
export function isRenderTraceEnabled(): boolean {
    if (explicitEnabledOverride !== undefined) return explicitEnabledOverride;
    const globalFlag = (globalThis as { NEXTMUX_RENDER_TRACE?: unknown }).NEXTMUX_RENDER_TRACE;
    if (globalFlag !== undefined) return isTruthyFlag(globalFlag);
    if (typeof process !== 'undefined' && process.env?.NEXTMUX_RENDER_TRACE !== undefined) {
        return isTruthyFlag(process.env.NEXTMUX_RENDER_TRACE);
    }
    return readStorageFlagOnce();
}

/** Overrides render trace activation (pass `undefined` to restore environment/localStorage detection). */
export function setRenderTraceEnabled(enabled: boolean | undefined): void {
    explicitEnabledOverride = enabled;
    if (enabled === undefined) cachedStorageEnabled = undefined;
}

function getOrCreateStats(region: string): MutableRegionStats {
    let stats = REGION_STATS.get(region);
    if (!stats) {
        stats = {
            region,
            renderCount: 0,
            profilerCount: 0,
            lastVersion: undefined,
            versionChanges: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
            lastDurationMs: 0,
            lastBaseDurationMs: 0,
            lastPhase: undefined,
            lastUpdatedAt: 0
        };
        REGION_STATS.set(region, stats);
    }
    return stats;
}

/** Records a region render invocation and optional version key when render tracing is enabled. */
export function recordRegionRender(region: string, version?: string | number): void {
    if (!isRenderTraceEnabled()) return;
    const stats = getOrCreateStats(region);
    stats.renderCount += 1;
    if (version !== undefined && stats.lastVersion !== version) {
        if (stats.lastVersion !== undefined || stats.renderCount > 1) {
            stats.versionChanges += 1;
        }
        stats.lastVersion = version;
    }
    stats.lastUpdatedAt = Date.now();
}

/** Records a React `<Profiler>` commit duration for `region` when render tracing is enabled. */
export function recordRegionProfilerCommit(
    region: string,
    phase: RenderProfilerPhase,
    actualDurationMs: number,
    baseDurationMs = actualDurationMs,
    version?: string | number
): void {
    if (!isRenderTraceEnabled()) return;
    const stats = getOrCreateStats(region);
    stats.profilerCount += 1;
    stats.totalDurationMs += actualDurationMs;
    if (actualDurationMs > stats.maxDurationMs) stats.maxDurationMs = actualDurationMs;
    stats.lastDurationMs = actualDurationMs;
    stats.lastBaseDurationMs = baseDurationMs;
    stats.lastPhase = phase;
    if (version !== undefined && stats.lastVersion !== version) {
        if (stats.lastVersion !== undefined || stats.profilerCount > 1) {
            stats.versionChanges += 1;
        }
        stats.lastVersion = version;
    }
    stats.lastUpdatedAt = Date.now();
}

/** Returns a React `<Profiler onRender={...}>` callback for `region`, or a shared no-op when tracing is off. */
export function createRegionProfilerCallback(
    region: string,
    getVersion?: () => string | number | undefined
): (
    id: string,
    phase: RenderProfilerPhase,
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
) => void {
    if (!isRenderTraceEnabled()) return NOOP_PROFILER_CALLBACK;
    return (_id, phase, actualDuration, baseDuration) => {
        recordRegionProfilerCommit(region, phase, actualDuration, baseDuration, getVersion?.());
    };
}

/** Returns a shallow snapshot of all collected region render stats. */
export function getRenderTraceSnapshot(): Readonly<Record<string, RegionRenderTraceStats>> {
    const out: Record<string, RegionRenderTraceStats> = {};
    for (const [region, stats] of REGION_STATS.entries()) {
        out[region] = { ...stats };
    }
    return out;
}

/** Clears collected render trace counters (for tests or starting a clean profiling window). */
export function resetRenderTrace(): void {
    REGION_STATS.clear();
}
