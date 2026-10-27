import { normalizeScene, type SceneDocument } from '@nextmux/comic-core/director-scene';
import { SCENE_PROPS } from '@nextmux/comic-core/director-catalogue';

/** Reject JSON primitive IDs that the runtime cannot build before changing editor state. */
export function normalizeDirectorScene(input: unknown): SceneDocument {
    const scene = normalizeScene(input);
    for (const object of scene.objects) if (object.kind === 'prop' && object.assetId && !SCENE_PROPS.some(prop => prop.id === object.assetId)) {
        throw Object.assign(new Error('DIRECTOR_PROP_UNSUPPORTED'), { code: 'DIRECTOR_PROP_UNSUPPORTED' });
    }
    return scene;
}
