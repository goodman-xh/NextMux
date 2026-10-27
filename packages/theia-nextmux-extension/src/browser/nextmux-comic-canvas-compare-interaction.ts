/** View-only comparison actions. No graph mutations, file edits or model requests. */
export type CanvasCompareAction =
    | { readonly type: 'mode' | 'center' | 'swap' | 'play' | 'mute' | 'help' | 'escape' | 'reset' }
    | { readonly type: 'seek' | 'split' | 'zoom' | 'select'; readonly value: number };
export function canvasCompareKey(input: {
    readonly key: string; readonly shiftKey?: boolean; readonly ctrlKey?: boolean; readonly metaKey?: boolean; readonly altKey?: boolean;
    readonly isComposing?: boolean; readonly focused: boolean; readonly editing: boolean;
    readonly hasVideo: boolean; readonly mode: 'slider' | 'side'; readonly stripIndex?: number; readonly count: number;
}): CanvasCompareAction | undefined {
    if (!input.focused || input.editing || input.isComposing || input.ctrlKey || input.metaKey || input.altKey) return undefined;
    const key = input.key.toLowerCase(), direction = key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 : 0;
    if (input.stripIndex !== undefined && input.count && (direction || key === 'home' || key === 'end')) {
        return { type: 'select', value: key === 'home' ? 0 : key === 'end' ? input.count - 1
            : Math.max(0, Math.min(input.count - 1, input.stripIndex + direction)) };
    }
    if (direction) return input.hasVideo ? { type: 'seek', value: direction * (input.shiftKey ? 5 : 1) }
        : input.mode === 'slider' ? { type: 'split', value: direction * (input.shiftKey ? 10 : 2) } : undefined;
    if (key === 'v') return { type: 'mode' };
    if (key === 'c' && input.mode === 'slider') return { type: 'center' };
    if (key === 'x') return { type: 'swap' };
    if (key === ' ' && input.hasVideo) return { type: 'play' };
    if (key === 'm' && input.hasVideo) return { type: 'mute' };
    if (key === '?') return { type: 'help' };
    if (key === 'escape') return { type: 'escape' };
    if (key === '+' || key === '=') return { type: 'zoom', value: 1.2 };
    if (key === '-' || key === '_') return { type: 'zoom', value: 1 / 1.2 };
    if (key === '0') return { type: 'reset' };
    return undefined;
}
export function canvasCompareEditingTarget(target: EventTarget | null): boolean {
    return Boolean(target && 'closest' in target && (target as Element).closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}
export interface CanvasCompareViewport { readonly scale: number; readonly x: number; readonly y: number }
export function zoomCanvasCompare(view: CanvasCompareViewport, factor: number, anchor = { x: 0, y: 0 }): CanvasCompareViewport {
    const scale = Math.max(.1, Math.min(10, view.scale * factor)), ratio = scale / view.scale;
    return { scale, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio };
}
export function canvasCompareSeek(current: number, duration: number, delta: number): number {
    return Math.max(0, Math.min(Number.isFinite(duration) && duration >= 0 ? duration : Infinity, (Number.isFinite(current) ? current : 0) + delta));
}
