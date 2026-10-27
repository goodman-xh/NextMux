import {
    CAMERA_MOVES, CAMERA_PRESETS, CAMERA_SPEEDS, compileCameraPrompt, normalizeCameraSelection,
    type CameraMoveId, type CameraSelection, type CameraSpeedId
} from '@nextmux/comic-core/canvas-camera';

/** Existing projects keep the submitted camera prefix and the matching editable selection together. */
export interface CanvasCameraState {
    readonly selection: CameraSelection;
    readonly prefix: string;
}
export interface CanvasCameraPromptView { readonly body: string; readonly state?: CanvasCameraState }
export interface CanvasCameraPromptEdit { readonly prompt: string; readonly state?: CanvasCameraState }

function validSelection(value: unknown): CameraSelection | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const selection = value as Partial<CameraSelection>;
    if (!Array.isArray(selection.movements) || typeof selection.speed !== 'string') return undefined;
    try { return normalizeCameraSelection(selection as CameraSelection); } catch { return undefined; }
}
function sameSelection(left: CameraSelection, right: CameraSelection): boolean {
    return left.speed === right.speed && left.movements.length === right.movements.length
        && left.movements.every((id, index) => id === right.movements[index]);
}

/** Only an exact leading series of known camera tokens is eligible for the legacy display conversion. */
function legacyPrefix(prompt: string): CanvasCameraState | undefined {
    const movements: CameraMoveId[] = [];
    let cursor = 0, end = 0, speed: CameraSpeedId = 'normal';
    let preset: typeof CAMERA_PRESETS[number] | undefined;
    for (;;) {
        const token = /^\[([^\]\r\n]+)\]/u.exec(prompt.slice(cursor));
        if (!token || (prompt[cursor + token[0].length] && !/\s/u.test(prompt[cursor + token[0].length]))) break;
        const text = token[1];
        const move = CAMERA_MOVES.find(item => item.actionPhrase === text);
        const pace = CAMERA_SPEEDS.find(item => item.actionPhrase && item.actionPhrase === text);
        const combination = CAMERA_PRESETS.find(item => item.label === text);
        if (move) movements.push(move.id);
        else if (pace && movements.length) speed = pace.id;
        else if (combination && cursor === 0) preset = combination;
        else break;
        end = cursor + token[0].length;
        const separator = /^\s*/u.exec(prompt.slice(end))![0];
        cursor = end + separator.length;
    }
    // A lone [preset name] or [speed] might be authored prose, so never strip it by inference.
    if (!movements.length) return undefined;
    const selection = normalizeCameraSelection({ movements, speed, ...(preset ? { presetId: preset.id } : {}) });
    if (preset && selection.presetId !== preset.id) return undefined;
    // The compiler inserts one separator; any additional author whitespace belongs to the body.
    const prefix = prompt.slice(0, end + (prompt[end] === ' ' ? 1 : 0));
    return { selection, prefix };
}

/** Read-only projection: opening a form never rewrites a saved prompt or guesses away unknown text. */
export function deriveCanvasCameraPrompt(prompt: string, saved?: unknown): CanvasCameraPromptView {
    const stored = saved && typeof saved === 'object' ? saved as Partial<CanvasCameraState> : undefined;
    const selection = validSelection(stored?.selection);
    // An explicit clear is different from a legacy document with no state: the whole string
    // remains authored text even if it starts with a phrase that resembles a camera token.
    if (selection && !selection.movements.length && stored?.prefix === '') return { body: prompt, state: { selection, prefix: '' } };
    if (selection && typeof stored?.prefix === 'string' && stored.prefix && prompt.startsWith(stored.prefix)) {
        const boundary = legacyPrefix(stored.prefix);
        // Validate only the stored boundary, not the body after it. A no-separator prefix
        // is current only for an empty body; the old empty -> nonempty case must fall back.
        if (boundary && boundary.prefix === stored.prefix && sameSelection(selection, boundary.selection)
            && (stored.prefix.endsWith(' ') || prompt === stored.prefix)) {
            return { body: prompt.slice(stored.prefix.length), state: { selection, prefix: stored.prefix } };
        }
    }
    const parsed = legacyPrefix(prompt);
    return parsed ? { body: prompt.slice(parsed.prefix.length), state: parsed } : { body: prompt };
}

/** Store the same executable prompt contract; only the input field uses the separate body projection. */
export function composeCanvasCameraPrompt(body: string, selection?: CameraSelection): CanvasCameraPromptEdit {
    const normalized = selection && normalizeCameraSelection(selection);
    if (!normalized?.movements.length) return { prompt: body, ...(normalized
        ? { state: { selection: normalized, prefix: '' } } : {}) };
    // Build the control prefix separately so empty/whitespace-only authored text is also preserved exactly.
    const prefix = `${compileCameraPrompt(normalized, [], '').prompt}${body ? ' ' : ''}`;
    return { prompt: prefix + body, state: { selection: normalized, prefix } };
}
