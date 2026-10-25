// Synthetic certificates for tests only. Callers explicitly choose every proven
// resolution, aspect, duration, frame state and reference count; catalog lists
// must never be treated as these certificates by production code.
export const managedQuoteId = `kq1_${'a'.repeat(64)}`;

export function syntheticManagedVideoProof({ resolutions, aspectRatios, durations, frameStates, referenceCounts = [0], requestAudio = false }) {
  return resolutions.flatMap(resolution => aspectRatios.flatMap(aspectRatio => durations.flatMap(durationSeconds =>
    frameStates.flatMap(([firstFrame, lastFrame]) => referenceCounts.map(referenceImages => {
      const [across, down] = aspectRatio.split(':').map(Number), ratio = across / down;
      const pixels = Number(/^(\d+)p$/iu.exec(resolution)?.[1]) || ({ '1k': 1080, '2k': 1440, '4k': 2160 })[resolution.toLowerCase()];
      return { resolution, aspectRatio, durationSeconds, firstFrame, lastFrame, referenceImages, requestAudio,
        width: Math.round((ratio >= 1 ? pixels * ratio : pixels) / 2) * 2,
        height: Math.round((ratio >= 1 ? pixels : pixels / ratio) / 2) * 2 };
    })))));
}
