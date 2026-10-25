/*
 * Copyright (C) 2026 NextMux contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { NextMuxDesktopLocale } from './nextmux-locale';
import { microphoneText } from './nextmux-microphone-locale';

/** States are deliberately user-actionable; there is no ambiguous "idle" state. */
export type MicrophoneCapabilityStatus =
    | 'unsupported'
    | 'prompt'
    | 'granted'
    | 'denied'
    | 'system-blocked'
    | 'device-busy'
    | 'device-missing';

export type DesktopMicrophonePlatform =
    | 'windows-10'
    | 'windows-11'
    | 'macos-intel'
    | 'macos-apple-silicon'
    | 'other';

export type BrowserMicrophonePermission = 'granted' | 'denied' | 'prompt';

export interface OperatingSystemMicrophonePermission {
    readonly status: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
    readonly requested?: boolean;
    readonly restartRequired?: boolean;
    readonly platform?: string;
    readonly osRelease?: string;
    readonly arch?: string;
    readonly scope?: 'application' | 'desktop-apps' | 'unsupported';
}

export interface MicrophoneDevice {
    readonly deviceId: string;
    readonly label: string;
}

export interface MicrophoneCapability {
    readonly status: MicrophoneCapabilityStatus;
    readonly devices: readonly MicrophoneDevice[];
    readonly canRequestAgain: boolean;
    readonly shouldOpenSettings: boolean;
    /** False when permission filtering or a failed enumeration can hide saved inputs. */
    readonly deviceListComplete?: boolean;
}

interface MediaDevicesLike {
    enumerateDevices(): Promise<readonly Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[]>;
    getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
}

export interface MicrophoneProbeOptions {
    readonly mediaDevices?: MediaDevicesLike;
    readonly locale?: NextMuxDesktopLocale;
    /** This query must be passive and must not itself display a permission prompt. */
    readonly permissionQuery?: () => Promise<BrowserMicrophonePermission>;
    /** A value already read by the desktop main process; probing never requests OS access. */
    readonly systemPermission?: OperatingSystemMicrophonePermission;
}

export interface MicrophoneAccessOptions extends Omit<MicrophoneProbeOptions, 'systemPermission'> {
    readonly deviceId?: string;
    readonly signal?: AbortSignal;
    readonly requestSystemPermission?: () => Promise<OperatingSystemMicrophonePermission | undefined>;
}

export interface DesktopPlatformDescriptor {
    readonly platform?: string;
    readonly osRelease?: string;
    readonly arch?: string;
}

export interface MicrophoneSettingsStrategy {
    readonly platform: DesktopMicrophonePlatform;
    readonly settingsUri?: string;
    readonly instructions: string;
    readonly permissionBoundary: string;
    readonly canRequestAgain: boolean;
    readonly restartRequired: boolean;
}

export interface MicrophoneLifecycleTarget {
    addEventListener(type: 'pagehide' | 'beforeunload', listener: (event: Event) => void): void;
    removeEventListener(type: 'pagehide' | 'beforeunload', listener: (event: Event) => void): void;
}

export interface TerminableWorker {
    terminate(): void;
}

export interface MicrophoneTestOptions {
    readonly mediaDevices: Pick<MediaDevicesLike, 'getUserMedia'>;
    readonly deviceId?: string;
    readonly signal?: AbortSignal;
    /** Navigation lifecycle. Pass `window` in a browser/Electron renderer. */
    readonly lifecycleTarget?: MicrophoneLifecycleTarget;
    /** CPU-heavy metering/ASR belongs in this worker, never in an animation callback. */
    readonly createWorker?: (stream: MediaStream) => TerminableWorker;
}

export interface MicrophoneTestSession {
    readonly stream: MediaStream;
    readonly active: boolean;
    cancel(): void;
}

export type SpeechEngineExecution = 'local' | 'cloud';
export type SpeechEngineReadiness = 'ready' | 'download-required' | 'unsupported';

export interface SpeechTranscriptUpdate {
    readonly text: string;
    readonly final: boolean;
}

export interface SpeechRecognitionSession {
    cancel(): void;
    finish?(): Promise<void>;
}

export interface SpeechRecognitionStartOptions {
    readonly stream: MediaStream;
    readonly locale: string;
    readonly signal: AbortSignal;
    readonly onTranscript: (update: SpeechTranscriptUpdate) => void;
    readonly onError: (error: Error) => void;
}

/**
 * Common seam for local workers/native runtimes and cloud streaming engines.
 * `readiness` must be a quick metadata/cache check. Only an explicit call to
 * `prepare` may download a model, and callers must run it outside the UI path.
 */
export interface SpeechRecognitionEngineAdapter {
    readonly id: string;
    readonly execution: SpeechEngineExecution;
    readiness(signal?: AbortSignal): Promise<SpeechEngineReadiness>;
    prepare?(options: {
        readonly signal: AbortSignal;
        readonly onProgress?: (completedBytes: number, totalBytes?: number) => void;
    }): Promise<void>;
    start(options: SpeechRecognitionStartOptions): Promise<SpeechRecognitionSession>;
}

export function classifyDesktopPlatform(descriptor: DesktopPlatformDescriptor): DesktopMicrophonePlatform {
    const platform = descriptor.platform?.toLowerCase();
    const architecture = descriptor.arch?.toLowerCase();
    if (platform === 'win32' || platform === 'windows') {
        const releaseParts = descriptor.osRelease?.split('.').map(value => Number.parseInt(value, 10));
        const build = releaseParts && releaseParts.length >= 3 ? releaseParts[2] : undefined;
        return build !== undefined && Number.isFinite(build) && build >= 22000 ? 'windows-11' : 'windows-10';
    }
    if (platform === 'darwin' || platform === 'macos') {
        return architecture === 'arm64' || architecture === 'aarch64'
            ? 'macos-apple-silicon'
            : 'macos-intel';
    }
    return 'other';
}

export function getMicrophoneSettingsStrategy(
    platform: DesktopMicrophonePlatform,
    status: MicrophoneCapabilityStatus,
    restartRequired = false
): MicrophoneSettingsStrategy {
    const canRequestAgain = status !== 'unsupported' && status !== 'granted';
    const permissionBoundary = 'NextMux 只能请求或检查麦克风权限，不能替用户开启或绕过操作系统权限。';
    const needsRestart = restartRequired && (platform === 'macos-intel' || platform === 'macos-apple-silicon');

    switch (platform) {
        case 'windows-10':
            return {
                platform,
                settingsUri: 'ms-settings:privacy-microphone',
                instructions: 'Windows 10：打开“设置 → 隐私 → 麦克风”，开启设备麦克风访问和“允许桌面应用访问麦克风”，返回后重新请求。桌面应用通常没有单独的 NextMux 开关。',
                permissionBoundary,
                canRequestAgain,
                restartRequired: false
            };
        case 'windows-11':
            return {
                platform,
                settingsUri: 'ms-settings:privacy-microphone',
                instructions: 'Windows 11：打开“设置 → 隐私和安全性 → 麦克风”，开启“麦克风访问”和“允许桌面应用访问你的麦克风”，返回后重新请求。桌面应用通常没有单独的 NextMux 开关。',
                permissionBoundary,
                canRequestAgain,
                restartRequired: false
            };
        case 'macos-intel':
            return {
                platform,
                settingsUri: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
                instructions: `macOS（Intel）：打开“系统设置（旧版为系统偏好设置）→ 隐私与安全性 → 麦克风”，允许 NextMux${needsRestart ? '，然后重新启动应用' : '，返回后重新请求'}。`,
                permissionBoundary,
                canRequestAgain,
                restartRequired: needsRestart
            };
        case 'macos-apple-silicon':
            return {
                platform,
                settingsUri: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
                instructions: `macOS（Apple Silicon）：打开“系统设置 → 隐私与安全性 → 麦克风”，允许 NextMux${needsRestart ? '，然后重新启动应用' : '，返回后重新请求'}。`,
                permissionBoundary,
                canRequestAgain,
                restartRequired: needsRestart
            };
        default:
            return {
                platform,
                instructions: '请手动打开系统隐私设置中的麦克风权限，允许桌面应用访问麦克风，然后返回重新请求。',
                permissionBoundary,
                canRequestAgain,
                restartRequired: false
            };
    }
}

export async function probeMicrophoneCapability(options: MicrophoneProbeOptions): Promise<MicrophoneCapability> {
    if (!hasMediaDeviceSupport(options.mediaDevices)) {
        return capability('unsupported');
    }

    const systemStatus = statusFromSystemPermission(options.systemPermission);
    if (systemStatus === 'system-blocked') {
        return capability(systemStatus);
    }

    const browserStatus = await readBrowserPermission(options.permissionQuery);

    let devices: readonly MicrophoneDevice[];
    try {
        devices = await enumerateMicrophones(options.mediaDevices, options.locale);
    } catch (error) {
        return capability(statusFromError(error));
    }
    if (browserStatus === 'denied') {
        return capability('denied', devices);
    }
    // Permission filtering may hide every device. Only an authorized empty
    // enumeration proves that the microphone is missing.
    if (devices.length === 0) {
        return capability(browserStatus === 'granted' ? 'device-missing' : 'prompt', devices, browserStatus === 'granted');
    }
    if (systemStatus === 'granted' || browserStatus === 'granted') {
        return capability('granted', devices, browserStatus === 'granted');
    }
    return capability('prompt', devices);
}

export async function requestMicrophoneAccess(options: MicrophoneAccessOptions): Promise<MicrophoneCapability> {
    if (!hasMediaDeviceSupport(options.mediaDevices)) {
        return capability('unsupported');
    }
    if (options.signal?.aborted) {
        throw abortError();
    }

    let systemPermission: OperatingSystemMicrophonePermission | undefined;
    try {
        systemPermission = await options.requestSystemPermission?.();
    } catch (error) {
        if (options.signal?.aborted || isAbortError(error)) {
            throw abortError();
        }
        return capability(statusFromError(error));
    }
    if (options.signal?.aborted) {
        throw abortError();
    }
    const systemStatus = statusFromSystemPermission(systemPermission);
    if (systemStatus === 'system-blocked') {
        return capability(systemStatus);
    }

    let stream: MediaStream | undefined;
    try {
        stream = await acquireStreamWithDeviceFallback(
            options.mediaDevices,
            options.deviceId,
            options.signal
        );
        stopStream(stream);
        stream = undefined;
        const result = await probeMicrophoneCapability({
            mediaDevices: options.mediaDevices,
            locale: options.locale,
            permissionQuery: async () => 'granted',
            systemPermission
        });
        if (options.signal?.aborted) {
            throw abortError();
        }
        return result;
    } catch (error) {
        stopStream(stream);
        if (isAbortError(error)) {
            throw error;
        }
        const devices = await enumerateMicrophones(options.mediaDevices, options.locale).catch(() => [] as readonly MicrophoneDevice[]);
        if (options.signal?.aborted) {
            throw abortError();
        }
        return capability(statusFromError(error), devices);
    }
}

export async function startMicrophoneTest(options: MicrophoneTestOptions): Promise<MicrophoneTestSession> {
    const stream = await acquireStreamWithDeviceFallback(
        options.mediaDevices,
        options.deviceId,
        options.signal
    );
    let worker: TerminableWorker | undefined;
    let active = true;
    const lifecycleTarget = options.lifecycleTarget;

    const cancel = (): void => {
        if (!active) {
            return;
        }
        active = false;
        lifecycleTarget?.removeEventListener('pagehide', leavePage);
        lifecycleTarget?.removeEventListener('beforeunload', leavePage);
        options.signal?.removeEventListener('abort', cancel);
        stopStream(stream);
        try {
            worker?.terminate();
        } catch {
            // Cleanup is best-effort, but tracks are always stopped first.
        }
        worker = undefined;
    };
    const leavePage = (): void => cancel();

    lifecycleTarget?.addEventListener('pagehide', leavePage);
    lifecycleTarget?.addEventListener('beforeunload', leavePage);
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) {
        cancel();
        throw abortError();
    }

    try {
        const createdWorker = options.createWorker?.(stream);
        if (!active || options.signal?.aborted) {
            try {
                createdWorker?.terminate();
            } catch {
                // The stream has already been stopped by the cancellation path.
            }
            cancel();
            throw abortError();
        }
        worker = createdWorker;
    } catch (error) {
        cancel();
        throw error;
    }

    return {
        stream,
        get active(): boolean {
            return active;
        },
        cancel
    };
}

/** Selects only a ready adapter. Model preparation/download is intentionally never invoked here. */
export async function selectSpeechRecognitionEngine(
    engines: readonly SpeechRecognitionEngineAdapter[],
    preference: readonly string[] = []
): Promise<SpeechRecognitionEngineAdapter | undefined> {
    const rank = new Map(preference.map((id, index) => [id, index]));
    const ordered = engines.map((engine, index) => ({ engine, index })).sort((left, right) => {
        const leftRank = rank.get(left.engine.id) ?? preference.length + left.index;
        const rightRank = rank.get(right.engine.id) ?? preference.length + right.index;
        return leftRank - rightRank;
    });
    for (const { engine } of ordered) {
        if (await engine.readiness() === 'ready') {
            return engine;
        }
    }
    return undefined;
}

function hasMediaDeviceSupport(mediaDevices: MediaDevicesLike | undefined): mediaDevices is MediaDevicesLike {
    return typeof mediaDevices?.enumerateDevices === 'function' && typeof mediaDevices.getUserMedia === 'function';
}

async function enumerateMicrophones(mediaDevices: Pick<MediaDevicesLike, 'enumerateDevices'>, locale: NextMuxDesktopLocale = 'zh-CN'): Promise<readonly MicrophoneDevice[]> {
    const devices = await mediaDevices.enumerateDevices();
    const inputs = new Map<string, MicrophoneDevice>();
    for (const device of devices) {
        // Chromium exposes Windows role aliases as well as physical endpoints.
        // Keep one default route and each physical ID, never dedupe by label:
        // two identical USB microphones can legitimately have the same name.
        if (device.kind !== 'audioinput') {
            continue;
        }
        // Always provide a system route, including on browsers that expose only
        // physical IDs or a redacted placeholder. Aliases are not extra hardware.
        if (!inputs.has('default')) inputs.set('default', { deviceId: 'default', label: '' });
        if (!device.deviceId || device.deviceId === 'communications') continue;
        const previous = inputs.get(device.deviceId);
        if (!previous || !previous.label) {
            inputs.set(device.deviceId, { deviceId: device.deviceId, label: device.label.trim() });
        }
    }
    return [...inputs.values()].sort((left, right) => Number(right.deviceId === 'default') - Number(left.deviceId === 'default')).map((device, index) => {
        return {
            deviceId: device.deviceId,
            label: device.label || (device.deviceId === 'default'
                ? microphoneText(locale, 'defaultDevice')
                : microphoneText(locale, 'unnamedDevice').replace('{index}', String(index)))
        };
    });
}

/** Permission-filtered lists cannot prove that a saved physical input disappeared. */
export function resolveMicrophoneSelection(savedDeviceId: string, result: MicrophoneCapability): string {
    if (savedDeviceId === 'communications' || savedDeviceId === 'default' || !savedDeviceId) return 'default';
    if (result.devices.some(device => device.deviceId === savedDeviceId)) return savedDeviceId;
    return result.deviceListComplete ? 'default' : savedDeviceId;
}

async function readBrowserPermission(
    permissionQuery: MicrophoneProbeOptions['permissionQuery']
): Promise<BrowserMicrophonePermission | undefined> {
    try {
        return await permissionQuery?.();
    } catch {
        return undefined;
    }
}

function statusFromSystemPermission(
    permission: OperatingSystemMicrophonePermission | undefined
): MicrophoneCapabilityStatus | undefined {
    switch (permission?.status) {
        case 'restricted':
        case 'denied': return 'system-blocked';
        case 'granted': return 'granted';
        case 'not-determined': return 'prompt';
        default: return undefined;
    }
}

export function microphoneStatusFromError(error: unknown): MicrophoneCapabilityStatus {
    const name = errorName(error);
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return 'denied';
    }
    if (name === 'SecurityError') {
        return 'system-blocked';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
        return 'device-missing';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
        return 'device-busy';
    }
    return 'unsupported';
}

const statusFromError = microphoneStatusFromError;

function errorName(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'name' in error) {
        const name = (error as { readonly name?: unknown }).name;
        return typeof name === 'string' ? name : '';
    }
    return '';
}

function capability(
    status: MicrophoneCapabilityStatus,
    devices: readonly MicrophoneDevice[] = [],
    deviceListComplete = false
): MicrophoneCapability {
    return {
        status,
        devices,
        deviceListComplete,
        canRequestAgain: status !== 'unsupported' && status !== 'granted',
        shouldOpenSettings: status === 'denied' || status === 'system-blocked'
    };
}

function microphoneConstraints(deviceId: string | undefined): MediaStreamConstraints {
    return {
        audio: {
            ...(deviceId && deviceId !== 'default' && deviceId !== 'communications' ? { deviceId: { exact: deviceId } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }
    };
}

async function acquireStreamWithDeviceFallback(
    mediaDevices: Pick<MediaDevicesLike, 'getUserMedia'>,
    deviceId: string | undefined,
    signal: AbortSignal | undefined
): Promise<MediaStream> {
    try {
        return await acquireAbortableStream(mediaDevices, microphoneConstraints(deviceId), signal);
    } catch (error) {
        const name = errorName(error);
        if (deviceId && deviceId !== 'default' && deviceId !== 'communications' && !isAbortError(error)
            && (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError' || name === 'NotFoundError' || name === 'DevicesNotFoundError')) {
            return acquireAbortableStream(mediaDevices, microphoneConstraints(undefined), signal);
        }
        throw error;
    }
}

async function acquireAbortableStream(
    mediaDevices: Pick<MediaDevicesLike, 'getUserMedia'>,
    constraints: MediaStreamConstraints,
    signal: AbortSignal | undefined
): Promise<MediaStream> {
    if (signal?.aborted) {
        throw abortError();
    }
    const acquisition = mediaDevices.getUserMedia(constraints);
    if (!signal) {
        return acquisition;
    }

    let rejectAbort: ((reason: Error) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
    });
    const onAbort = (): void => rejectAbort?.(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
        const stream = await Promise.race([acquisition, aborted]);
        if (signal.aborted) {
            throw abortError();
        }
        return stream;
    } catch (error) {
        if (signal.aborted) {
            void acquisition.then(stopStream, () => undefined);
        }
        throw error;
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}

function stopStream(stream: MediaStream | undefined): void {
    if (!stream) {
        return;
    }
    for (const track of stream.getTracks()) {
        try {
            track.stop();
        } catch {
            // Continue stopping remaining tracks.
        }
    }
}

function abortError(): Error {
    if (typeof DOMException === 'function') {
        return new DOMException('The microphone operation was cancelled.', 'AbortError');
    }
    return Object.assign(new Error('The microphone operation was cancelled.'), { name: 'AbortError' });
}

function isAbortError(error: unknown): boolean {
    return errorName(error) === 'AbortError';
}
