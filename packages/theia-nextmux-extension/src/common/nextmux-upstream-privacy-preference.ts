import type { DesktopPrivacySettings } from './nextmux-platform-protocol';

/** A request to the upstream, never an eligibility filter or a retention guarantee. */
export interface UpstreamPrivacyPreference {
    readonly mode: 'advisory-v1';
    readonly zeroDataRetention: boolean;
    readonly dataCollection: 'deny' | 'allow';
}

export function upstreamPrivacyPreference(settings: Pick<DesktopPrivacySettings, 'requireZeroDataRetention' | 'denyDataCollection'>): UpstreamPrivacyPreference {
    const enabled = settings.requireZeroDataRetention === true || settings.denyDataCollection === true;
    return {
        mode: 'advisory-v1',
        zeroDataRetention: enabled,
        dataCollection: enabled ? 'deny' : 'allow'
    };
}
