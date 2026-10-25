/** User preferences only. The view owns localStorage and the paid-submit countdown. */
export interface CanvasSettings {
    readonly panSensitivity: number;
    readonly navigationSensitivity: number;
    readonly navigationShiftBoost: number;
    readonly blankAreaAction: 'rightClick' | 'doubleClick';
    readonly wheelAction: 'pan' | 'zoom';
    readonly snapGrid: boolean;
    readonly alignmentGuides: boolean;
    readonly wireWidth: number;
    readonly wireHoverHighlight: boolean;
    readonly wireAnimation: boolean;
    readonly wireFocusOnly: boolean;
    readonly gridSpacing: number;
    readonly gridDotSize: number;
    readonly showGrid: boolean;
    readonly minimap: boolean;
    readonly arrangeHorizontalSpacing: number;
    readonly arrangeVerticalSpacing: number;
    readonly groupPadding: number;
    /** Seconds before sending a paid request; zero disables the countdown. */
    readonly submitDelaySeconds: number;
    readonly notifyOnCompletion: boolean;
}

export type CanvasSettingDefinition<T> = [T] extends [number]
    ? { readonly type: 'number'; readonly min: number; readonly max: number; readonly step: number; readonly default: T }
    : [T] extends [boolean]
        ? { readonly type: 'boolean'; readonly values: readonly [false, true]; readonly default: boolean; readonly dependsOn?: keyof CanvasSettings }
        : { readonly type: 'enum'; readonly values: readonly T[]; readonly default: T };

/** Numeric units are canvas pixels except sensitivity/boost multipliers and submitDelaySeconds. */
export const CANVAS_SETTINGS_SPEC = Object.freeze({
    panSensitivity: { type: 'number', min: 0.2, max: 5, step: 0.1, default: 1.5 },
    navigationSensitivity: { type: 'number', min: 0.2, max: 3, step: 0.05, default: 1 },
    navigationShiftBoost: { type: 'number', min: 1, max: 8, step: 0.1, default: 2.5 },
    blankAreaAction: { type: 'enum', values: ['rightClick', 'doubleClick'], default: 'rightClick' },
    wheelAction: { type: 'enum', values: ['pan', 'zoom'], default: 'pan' },
    snapGrid: { type: 'boolean', values: [false, true], default: true },
    alignmentGuides: { type: 'boolean', values: [false, true], default: true, dependsOn: 'snapGrid' },
    wireWidth: { type: 'number', min: 1, max: 6, step: 0.2, default: 2 },
    wireHoverHighlight: { type: 'boolean', values: [false, true], default: true },
    wireAnimation: { type: 'boolean', values: [false, true], default: false },
    wireFocusOnly: { type: 'boolean', values: [false, true], default: false },
    gridSpacing: { type: 'number', min: 6, max: 60, step: 2, default: 20 },
    gridDotSize: { type: 'number', min: 1, max: 6, step: 0.5, default: 2 },
    showGrid: { type: 'boolean', values: [false, true], default: true },
    minimap: { type: 'boolean', values: [false, true], default: false },
    arrangeHorizontalSpacing: { type: 'number', min: 50, max: 200, step: 10, default: 100 },
    arrangeVerticalSpacing: { type: 'number', min: 80, max: 300, step: 10, default: 110 },
    groupPadding: { type: 'number', min: 50, max: 120, step: 5, default: 80 },
    submitDelaySeconds: { type: 'number', min: 0, max: 10, step: 1, default: 0 },
    notifyOnCompletion: { type: 'boolean', values: [false, true], default: true }
} as const satisfies { readonly [K in keyof CanvasSettings]: CanvasSettingDefinition<CanvasSettings[K]> });

export const DEFAULT_CANVAS_SETTINGS: Readonly<CanvasSettings> = Object.freeze(Object.fromEntries(
    Object.entries(CANVAS_SETTINGS_SPEC).map(([key, definition]) => [key, definition.default])
) as unknown as CanvasSettings);

/** Position snapping uses a fixed 10-unit grid; the visible dot spacing is independent. */
export const CANVAS_SNAP_GRID_SIZE = 10;

/** Clamp and round finite numbers to their slider steps; invalid values use defaults. Unknown keys are dropped. */
export function normalizeCanvasSettings(value: unknown): CanvasSettings {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const result: Record<string, unknown> = {};
    for (const [key, definition] of Object.entries(CANVAS_SETTINGS_SPEC)) {
        const candidate = Object.hasOwn(source, key) ? source[key] : undefined;
        if (definition.type === 'number') {
            const bounded = typeof candidate === 'number' && Number.isFinite(candidate)
                ? Math.max(definition.min, Math.min(definition.max, candidate)) : definition.default;
            result[key] = Number(Math.max(definition.min, Math.min(definition.max,
                definition.min + Math.round((bounded - definition.min) / definition.step) * definition.step)).toFixed(10));
        } else if (definition.type === 'boolean') {
            result[key] = typeof candidate === 'boolean' ? candidate : definition.default;
        } else {
            result[key] = (definition.values as readonly unknown[]).includes(candidate) ? candidate : definition.default;
        }
    }
    if (!result.snapGrid) result.alignmentGuides = false;
    return result as unknown as CanvasSettings;
}

/** A separate storage namespace for each signed-in user. No storage or other side effects occur here. */
export function canvasSettingsStorageKey(userId: string): string {
    if (!userId.trim()) throw new Error('Canvas settings need a user ID');
    return `nextmux.comic.canvas.settings.v1:${encodeURIComponent(userId)}`;
}
