import type { ComicProject, ComicShot } from '@nextmux/comic-core';

/** Adapt an independent source range to the existing, integrity-checked ASR pipeline.
 * This is an in-memory view, never a scene written back to the project. */
export function comicCompositionTranscriptionShot(project: ComicProject, clipId: string): ComicShot | undefined {
    const clip = project.composition?.clips.find(candidate => candidate.id === clipId);
    const track = project.composition?.tracks.find(candidate => candidate.id === clip?.trackId);
    if (!clip || !track || track.locked || !clip.assetId || !['video', 'audio'].includes(clip.kind)) return undefined;
    const asset = project.assets.find(candidate => candidate.id === clip.assetId);
    if (!asset || asset.status !== 'ready' || !['video', 'audio', 'music', 'effect'].includes(asset.kind)) return undefined;
    return {
        id: clip.id, title: clip.title ?? '', description: '', durationFrames: clip.durationFrames,
        shotSize: 'medium', cameraMotion: 'static', visualPrompt: '', negativePrompt: '',
        transitionIn: 'cut', transitionOut: 'cut', transitionOutExplicit: true,
        volume: 1, fadeInFrames: 0, fadeOutFrames: 0, dialogueCues: [],
        ...(clip.kind === 'video' ? { videoAssetId: asset.id } : { audioAssetId: asset.id }),
        mediaSourceStartFrames: { [asset.id]: clip.sourceStartFrames },
        status: 'generated', createdAt: project.createdAt, updatedAt: project.updatedAt
    };
}
