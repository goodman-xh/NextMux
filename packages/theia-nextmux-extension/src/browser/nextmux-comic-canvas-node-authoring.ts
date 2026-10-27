import { normalizeCameraSelection, validateStoryboard, type CameraSelection, type CanvasStoryboard } from '@nextmux/comic-core/canvas-camera';
import type { CanvasDocument, CanvasNode } from '@nextmux/comic-core/canvas';
import type { CanvasCameraState } from './nextmux-comic-canvas-camera-state';

/** Only node-local authoring state and opaque route keys are portable; credentials and execution state are not. */
export interface CanvasNodeAuthoring {
    readonly nodeCamera?: Readonly<Record<string, CanvasCameraState>>;
    readonly nodeStoryboard?: Readonly<Record<string, CanvasStoryboard>>;
    readonly nodeRoutes?: Readonly<Record<string, string>>;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function cameraSelection(value: unknown): CameraSelection {
    if (!object(value) || !Array.isArray(value.movements) || typeof value.speed !== 'string'
        || value.presetId !== undefined && typeof value.presetId !== 'string') throw new Error('Invalid copied camera selection.');
    return normalizeCameraSelection(value as unknown as CameraSelection);
}
function camera(value: unknown): CanvasCameraState {
    if (!object(value) || typeof value.prefix !== 'string') throw new Error('Invalid copied camera boundary.');
    return { selection: cameraSelection(value.selection), prefix: value.prefix };
}
function routeKey(value: unknown): string {
    // Keys are app-level offering/connection identities, not connection descriptors.
    // Leave unavailable keys intact: route resolution must block rather than pick another merchant.
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Invalid copied route key.');
    return value;
}
function storyboard(value: unknown): CanvasStoryboard {
    if (!object(value) || !Array.isArray(value.shots) || !Array.isArray(value.guidance)) throw new Error('Invalid copied storyboard.');
    const copied = {
        version: value.version, clipDurationSeconds: value.clipDurationSeconds, soundEffects: value.soundEffects,
        backgroundMusic: value.backgroundMusic, guidance: [...value.guidance],
        ...(value.originalPrompt !== undefined ? { originalPrompt: value.originalPrompt } : {}),
        shots: value.shots.map(shot => {
            if (!object(shot)) throw new Error('Invalid copied storyboard shot.');
            return { id: shot.id, camera: cameraSelection(shot.camera), foreground: shot.foreground, background: shot.background, requirements: shot.requirements,
                ...(shot.startSeconds !== undefined ? { startSeconds: shot.startSeconds } : {}), ...(shot.endSeconds !== undefined ? { endSeconds: shot.endSeconds } : {}),
                ...(shot.focalLength !== undefined ? { focalLength: shot.focalLength } : {}), ...(shot.aperture !== undefined ? { aperture: shot.aperture } : {}) };
        })
    } as CanvasStoryboard;
    const issues = validateStoryboard(copied);
    if (issues.length) throw new Error(issues[0].message);
    return copied;
}

/** Clone whitelisted selected-node settings and map only their owner IDs, including explicit empty camera markers. */
export function copyCanvasNodeAuthoring(settings: Readonly<Record<string, unknown>>, nodes: readonly CanvasNode[], idMap?: ReadonlyMap<string, string>): CanvasNodeAuthoring {
    const result: { nodeCamera?: Readonly<Record<string, CanvasCameraState>>; nodeStoryboard?: Readonly<Record<string, CanvasStoryboard>>; nodeRoutes?: Readonly<Record<string, string>> } = {};
    for (const key of ['nodeCamera', 'nodeStoryboard', 'nodeRoutes'] as const) {
        const values = settings[key];
        if (values === undefined) continue;
        if (!object(values)) throw new Error(`Invalid copied ${key} metadata.`);
        const entries = nodes.filter(node => (node.kind === 'videoGen' || key === 'nodeRoutes' && node.kind === 'imageGen') && Object.hasOwn(values, node.id)).map(node => {
            const id = idMap?.get(node.id) ?? node.id;
            return [id, key === 'nodeCamera' ? camera(values[node.id]) : key === 'nodeStoryboard' ? storyboard(values[node.id]) : routeKey(values[node.id])] as const;
        });
        if (entries.length) Object.assign(result, { [key]: Object.fromEntries(entries) });
    }
    return result;
}

/** Merge new-node metadata into the current canvas, retaining unrelated and concurrently edited settings. */
export function mergeCanvasNodeAuthoring(canvas: CanvasDocument, authoring: CanvasNodeAuthoring): CanvasDocument {
    let settings = canvas.settings;
    for (const key of ['nodeCamera', 'nodeStoryboard', 'nodeRoutes'] as const) if (authoring[key] && Object.keys(authoring[key]).length) {
        settings = { ...settings, [key]: { ...(object(settings[key]) ? settings[key] : {}), ...authoring[key] } };
    }
    return settings === canvas.settings ? canvas : { ...canvas, settings };
}
