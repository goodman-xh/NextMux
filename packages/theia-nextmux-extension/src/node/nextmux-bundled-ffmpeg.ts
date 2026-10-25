import { win32 } from 'path';

export interface BundledFfmpegCandidateOptions {
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
    readonly resourcesPath?: string;
    readonly moduleDirectory: string;
}

/**
 * Return Windows x64/ARM64 FFmpeg locations in packaged-first order. Using the
 * target platform's path implementation keeps this pure and testable on any
 * host without changing Electron globals.
 */
export function bundledFfmpegCandidates(options: BundledFfmpegCandidateOptions): readonly string[] {
    if (options.platform !== 'win32' || !['arm64', 'x64'].includes(options.architecture)) return [];
    const packaged = options.resourcesPath && win32.isAbsolute(options.resourcesPath)
        ? [win32.join(options.resourcesPath, 'native', 'ffmpeg', 'ffmpeg.exe')]
        : [];
    return [
        ...packaged,
        win32.resolve(options.moduleDirectory, `../../../../apps/desktop/native/ffmpeg/win32-${options.architecture}/ffmpeg.exe`)
    ];
}
