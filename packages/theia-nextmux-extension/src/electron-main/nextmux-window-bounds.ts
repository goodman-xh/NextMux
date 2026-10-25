/*
 * Main-window sizing for NextMux.
 *
 * The fitting rules are ported from Visual Studio Code (MIT License,
 * Copyright (c) Microsoft Corporation):
 *   - src/vs/platform/windows/electron-main/windows.ts
 *     `WindowStateValidator.validateWindowState` (single-display branch) and
 *     `validateWindowStateOnDisplay`;
 *   - src/vs/platform/window/common/window.ts
 *     `DEFAULT_WORKSPACE_WINDOW_SIZE` (1440×900) as the default upper bound.
 * NextMux adapts the default size to the display's work area instead of using
 * a fixed size, and clamps the minimum size so it never exceeds small screens.
 */

export interface WindowRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface WindowSizeLimits {
    readonly minWidth: number;
    readonly minHeight: number;
    readonly maxWidth: number;
    readonly maxHeight: number;
    /** Share of the work area used by a first-launch window. */
    readonly ratio: number;
}

export const NEXTMUX_MAIN_WINDOW_LIMITS: WindowSizeLimits = {
    minWidth: 360,
    minHeight: 420,
    // VS Code's default workspace window size is the largest first-launch size.
    maxWidth: 1440,
    maxHeight: 900,
    ratio: 0.84
};

const DEFAULT_LAUNCH_MIN_WIDTH = 980;
const DEFAULT_LAUNCH_MIN_HEIGHT = 640;

/** VS Code keeps at least this many pixels of a window visible for dragging. */
const VISIBLE_MARGIN = 128;

function validArea(area: WindowRect | undefined): area is WindowRect {
    return Boolean(area) && [area!.x, area!.y, area!.width, area!.height].every(Number.isFinite)
        && area!.width > 0 && area!.height > 0;
}

/** Minimum size that is never larger than the display work area. */
export function mainWindowMinimumSize(workArea: WindowRect, limits: WindowSizeLimits = NEXTMUX_MAIN_WINDOW_LIMITS): { minWidth: number; minHeight: number } {
    if (!validArea(workArea)) return { minWidth: limits.minWidth, minHeight: limits.minHeight };
    return {
        minWidth: Math.max(1, Math.min(limits.minWidth, Math.floor(workArea.width))),
        minHeight: Math.max(1, Math.min(limits.minHeight, Math.floor(workArea.height)))
    };
}

/** First-launch bounds: a share of the work area between the minimum and maximum, centered. */
export function defaultMainWindowBounds(workArea: WindowRect, limits: WindowSizeLimits = NEXTMUX_MAIN_WINDOW_LIMITS): WindowRect {
    if (!validArea(workArea)) return { x: 0, y: 0, width: limits.maxWidth, height: limits.maxHeight };
    const { minWidth, minHeight } = mainWindowMinimumSize(workArea, limits);
    const launchMinWidth = Math.max(minWidth, Math.min(DEFAULT_LAUNCH_MIN_WIDTH, Math.floor(workArea.width)));
    const launchMinHeight = Math.max(minHeight, Math.min(DEFAULT_LAUNCH_MIN_HEIGHT, Math.floor(workArea.height)));
    const clamp = (value: number, min: number, max: number, available: number) =>
        Math.min(Math.floor(available), Math.max(min, Math.min(max, value)));
    const width = clamp(Math.round(workArea.width * limits.ratio), launchMinWidth, limits.maxWidth, workArea.width);
    const height = clamp(Math.round(workArea.height * limits.ratio), launchMinHeight, limits.maxHeight, workArea.height);
    // Electron dislikes fractional display coordinates (VS Code rounds as well).
    return {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.round(workArea.y + (workArea.height - height) / 2),
        width,
        height
    };
}

/**
 * Keep a restored window inside the display work area: never larger than the
 * work area and never pushed off the left/top edge, with at least 128 px
 * visible on the right/bottom (VS Code `validateWindowState`).
 * Returns `undefined` for unusable input so the caller can fall back to the default.
 */
export function fitWindowToWorkArea(state: Partial<WindowRect>, workArea: WindowRect): WindowRect | undefined {
    if (typeof state.x !== 'number' || typeof state.y !== 'number' || typeof state.width !== 'number' || typeof state.height !== 'number'
        || ![state.x, state.y, state.width, state.height].every(Number.isFinite) || state.width <= 0 || state.height <= 0) return undefined;
    if (!validArea(workArea)) return undefined;
    let { x, y, width, height } = state as WindowRect;
    const ensureTopLeft = () => {
        if (x < workArea.x) x = workArea.x;
        if (y < workArea.y) y = workArea.y;
    };
    ensureTopLeft();
    if (width > workArea.width) width = workArea.width;
    if (height > workArea.height) height = workArea.height;
    if (x > workArea.x + workArea.width - VISIBLE_MARGIN) x = workArea.x + workArea.width - width;
    if (y > workArea.y + workArea.height - VISIBLE_MARGIN) y = workArea.y + workArea.height - height;
    ensureTopLeft();
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
