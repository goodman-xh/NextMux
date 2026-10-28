export interface FloatingPanelRect {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

export interface FloatingPanelViewport {
    readonly width: number;
    readonly height: number;
}

export interface AnchoredFloatingPanelPlacement {
    /** The side of the anchor on which the panel was placed. */
    readonly side: 'above' | 'below';
    readonly top: number;
    readonly left: number;
    readonly width: number;
    /** The rendered height after clamping to the safe viewport. */
    readonly height: number;
    /** The maximum height available to the panel's scrollable body. */
    readonly maxHeight: number;
}

export interface AnchoredFloatingPanelOptions {
    /** Minimum distance from the viewport edge. */
    readonly edge?: number;
    /** Gap between the anchor and the panel. */
    readonly gap?: number;
    /** Space reserved for a titlebar or other fixed chrome. */
    readonly safeTop?: number;
    /** Space reserved for a bottom bar or other fixed chrome. */
    readonly safeBottom?: number;
    /** Prefer a side only when it can show at least this much content. */
    readonly minHeight?: number;
    /** Align the panel's left edge with the anchor (a leading trigger); default aligns right edges. */
    readonly alignLeft?: boolean;
}

export interface AdjacentFloatingPanelPlacement {
    readonly side: 'left' | 'right';
    readonly top: number;
    readonly left: number;
    readonly maxHeight: number;
    readonly width?: number;
}

/**
 * The model drawer beside the picker matches the picker's own width (264px) so both columns look balanced.
 * The stylesheet gives a drawer placed without this layout the same width (.nmx-model-evidence-menu).
 */
export const MODEL_PRICE_DETAIL_WIDTH = 264;

/** Reserve two adjacent columns before hover so opening prices never moves the row under the pointer. */
export function placeModelPickerPanels(picker: AnchoredFloatingPanelPlacement, viewport: FloatingPanelViewport,
    detailWidth = picker.width, gap = 7, edge = 8): { readonly picker: AnchoredFloatingPanelPlacement; readonly detail: { readonly side: 'left' | 'right'; readonly left: number; readonly width: number } } {
    const available = Math.max(2, viewport.width - edge * 2 - gap);
    const width = Math.min(picker.width, Math.max(1, available * picker.width / (picker.width + detailWidth)));
    const fits = picker.width + detailWidth <= available;
    const pickerWidth = fits ? picker.width : width;
    const priceWidth = fits ? detailWidth : available - pickerWidth;
    let left = picker.left;
    let side: 'left' | 'right';
    if (fits && viewport.width - edge - (left + pickerWidth) - gap >= priceWidth) side = 'right';
    else {
        side = 'left';
        left = clamp(Math.max(left, edge + priceWidth + gap), edge, viewport.width - edge - pickerWidth);
    }
    return { picker: { ...picker, left, width: pickerWidth }, detail: { side,
        left: side === 'left' ? left - gap - priceWidth : left + pickerWidth + gap, width: priceWidth } };
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/**
 * Place a fixed panel anchored to a trigger while keeping the complete outer
 * panel inside the usable viewport.  This deliberately does not depend on CSS
 * anchor-positioning: desktop WebViews can be on different Chromium versions
 * and an unsupported anchor rule otherwise leaves a menu clipped or off-screen.
 */
export function placeAnchoredFloatingPanel(
    anchor: FloatingPanelRect,
    viewport: FloatingPanelViewport,
    panelWidth: number,
    panelHeight: number,
    options: AnchoredFloatingPanelOptions = {}
): AnchoredFloatingPanelPlacement {
    const edge = Math.max(0, options.edge ?? 8);
    const gap = Math.max(0, options.gap ?? 10);
    const safeTop = Math.min(Math.max(0, options.safeTop ?? edge), Math.max(0, viewport.height - 1));
    const safeBottom = Math.min(Math.max(0, options.safeBottom ?? edge), Math.max(0, viewport.height - safeTop - 1));
    const width = Math.max(1, Math.min(Math.max(1, panelWidth), Math.max(1, viewport.width - edge * 2)));
    const desiredHeight = Math.max(1, panelHeight);
    const availableAbove = Math.max(0, anchor.top - gap - safeTop);
    const availableBelow = Math.max(0, viewport.height - safeBottom - anchor.bottom - gap);
    const preferredMinimum = Math.min(desiredHeight, Math.max(1, options.minHeight ?? 120));
    const side: 'above' | 'below' = availableAbove >= preferredMinimum
        ? 'above'
        : availableBelow >= preferredMinimum
            ? 'below'
            : availableAbove >= availableBelow ? 'above' : 'below';
    const available = side === 'above' ? availableAbove : availableBelow;
    const maxHeight = Math.max(1, Math.min(available, viewport.height - safeTop - safeBottom));
    const height = Math.max(1, Math.min(desiredHeight, maxHeight));
    const desiredTop = side === 'above'
        ? anchor.top - gap - height
        : anchor.bottom + gap;
    const top = clamp(desiredTop, safeTop, Math.max(safeTop, viewport.height - safeBottom - height));
    const desiredLeft = options.alignLeft ? anchor.left : anchor.right - width;
    const left = clamp(desiredLeft, edge, viewport.width - edge - width);
    return { side, top, left, width, height, maxHeight };
}

/**
 * Place a fixed panel beside a row. As with Floating UI shift/size, fit the
 * full measured menu before limiting its scrollable height at the viewport.
 */
export function placeAdjacentFloatingPanel(
    anchor: FloatingPanelRect,
    viewport: FloatingPanelViewport,
    panelWidth: number,
    panelHeight: number,
    gap = 7,
    edge = 8
): AdjacentFloatingPanelPlacement {
    const width = Math.max(1, Math.min(panelWidth, viewport.width - edge * 2));
    const height = Math.max(1, panelHeight);
    const availableRight = viewport.width - anchor.right - gap - edge;
    const availableLeft = anchor.left - gap - edge;
    const side = availableRight >= width || availableRight >= availableLeft ? 'right' : 'left';
    const desiredLeft = side === 'right' ? anchor.right + gap : anchor.left - gap - width;
    const left = clamp(desiredLeft, edge, viewport.width - edge - width);
    const visibleHeight = Math.min(height, Math.max(1, viewport.height - edge * 2));
    const top = clamp(anchor.top, edge, viewport.height - edge - visibleHeight);
    return {
        side,
        top,
        left,
        maxHeight: Math.max(1, viewport.height - top - edge)
    };
}
