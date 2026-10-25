export const LINK_OPENING_DESTINATIONS = ['system-browser', 'builtin-browser'] as const;
export const LINK_OPENING_PREFERENCE_STORAGE_KEY = 'nextmux.linkOpeningPreference.v2';
export const LINK_OPENING_PREFERENCE_VERSION = 2 as const;
export const LEGACY_LINK_OPENING_PREFERENCE_STORAGE_KEYS = [
    'nextmux.linkOpeningPreference.v1',
    'nextmux.desktop.linkOpeningPreference'
] as const;

export type LinkOpeningDestination = typeof LINK_OPENING_DESTINATIONS[number];

export interface LinkOpeningStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem?(key: string): void;
}

export interface LinkOpeningSelection {
    readonly destination: LinkOpeningDestination;
    readonly remember: boolean;
}

export type LinkOpeningDecision =
    | {
        readonly action: 'confirm-web';
        readonly target: string;
        readonly destinations: typeof LINK_OPENING_DESTINATIONS;
        readonly canRemember: true;
    }
    | {
        readonly action: 'open-system-browser' | 'open-builtin-browser';
        readonly target: string;
        readonly remembered: boolean;
    }
    | { readonly action: 'open-file-drawer'; readonly target: string }
    | {
        readonly action: 'blocked';
        readonly target: string;
        readonly reason: 'invalid-selection' | 'invalid-target' | 'unsafe-scheme' | 'unsupported-scheme';
    };

const UNSAFE_SCHEMES = new Set(['javascript', 'data', 'vbscript']);

function normalizedScheme(target: string): string | undefined {
    const colon = target.indexOf(':');
    if (colon <= 0) return undefined;
    const candidate = target.slice(0, colon).replace(/[\u0000-\u0020]/g, '').toLowerCase();
    return /^[a-z][a-z\d+.-]*$/.test(candidate) ? candidate : undefined;
}

/** One classification for Markdown decoration, clicks, and context menus. */
export function conversationLinkTargetKind(rawTarget: string): 'file' | 'web' | 'blocked' {
    const target = rawTarget.trim();
    if (!target || target.startsWith('#') || /[\u0000-\u001f\u007f]/.test(target)) return 'blocked';
    if (/^https?:\/\//i.test(target)) return 'web';
    // markdown-it percent-encodes backslashes in Windows Markdown destinations.
    if (/^[a-z]:(?:[\\/]|%5c|%2f)/i.test(target)) return 'file';
    const scheme = normalizedScheme(target);
    return !scheme || scheme === 'file' ? 'file' : 'blocked';
}

function destinationValue(value: unknown): LinkOpeningDestination | undefined {
    if (LINK_OPENING_DESTINATIONS.includes(value as LinkOpeningDestination)) {
        return value as LinkOpeningDestination;
    }
    if (value === 'external' || value === 'system' || value === 'external-browser') return 'system-browser';
    if (value === 'internal' || value === 'builtin' || value === 'embedded') return 'builtin-browser';
    return undefined;
}

function parseCurrentPreference(raw: string): LinkOpeningDestination | undefined {
    const value = JSON.parse(raw) as { version?: unknown; destination?: unknown } | null;
    return value?.version === LINK_OPENING_PREFERENCE_VERSION
        ? destinationValue(value.destination) : undefined;
}

function parseLegacyPreference(raw: string): LinkOpeningDestination | undefined {
    let value: unknown = raw;
    try {
        value = JSON.parse(raw) as unknown;
    } catch {
        // Some early builds stored the destination as an unquoted string.
    }
    if (typeof value === 'string') return destinationValue(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (record.version !== undefined && record.version !== 1) return undefined;
    return destinationValue(record.destination ?? record.opener ?? record.preference);
}

/**
 * Chooses a link-opening layer without invoking either Theia's opener service
 * or a concrete browser. Presentation code maps these stable action ids to
 * localized copy and delegates the chosen action to the matching opener.
 */
export class NextMuxLinkOpeningPolicy {
    private readonly storage: LinkOpeningStorage;
    /** An absent saved preference falls back to the built-in browser. */
    private preference: LinkOpeningDestination | undefined;

    constructor(storage: LinkOpeningStorage) {
        this.storage = storage;
        try {
            const raw = storage.getItem(LINK_OPENING_PREFERENCE_STORAGE_KEY);
            if (raw !== null) {
                const parsed = parseCurrentPreference(raw);
                if (parsed) {
                    this.preference = parsed;
                }
                return;
            }
            for (const key of LEGACY_LINK_OPENING_PREFERENCE_STORAGE_KEYS) {
                const legacyRaw = storage.getItem(key);
                if (legacyRaw === null) continue;
                const migrated = parseLegacyPreference(legacyRaw);
                if (!migrated) return;
                this.preference = migrated;
                try {
                    storage.setItem(LINK_OPENING_PREFERENCE_STORAGE_KEY, JSON.stringify({
                        version: LINK_OPENING_PREFERENCE_VERSION,
                        destination: migrated
                    }));
                    storage.removeItem?.(key);
                } catch {
                    // A valid legacy choice remains usable even when migration cannot be written.
                }
                return;
            }
        } catch {
            // Storage can be unavailable or corrupted.  Keep the built-in
            // browser as the decision fallback and never reintroduce a prompt.
            this.preference = undefined;
        }
    }

    getPreference(): LinkOpeningDestination | undefined {
        return this.preference;
    }

    setPreference(destination: LinkOpeningDestination): boolean {
        if (!LINK_OPENING_DESTINATIONS.includes(destination)) return false;
        try {
            this.storage.setItem(LINK_OPENING_PREFERENCE_STORAGE_KEY, JSON.stringify({
                version: LINK_OPENING_PREFERENCE_VERSION,
                destination
            }));
        } catch {
            return false;
        }
        this.preference = destination;
        try {
            for (const key of LEGACY_LINK_OPENING_PREFERENCE_STORAGE_KEYS) this.storage.removeItem?.(key);
        } catch {
            // The current record is authoritative; legacy cleanup is best effort.
        }
        return true;
    }

    clearPreference(): void {
        this.preference = undefined;
        try {
            if (this.storage.removeItem) this.storage.removeItem(LINK_OPENING_PREFERENCE_STORAGE_KEY);
            else this.storage.setItem(LINK_OPENING_PREFERENCE_STORAGE_KEY, JSON.stringify({
                version: LINK_OPENING_PREFERENCE_VERSION,
                destination: null
            }));
            for (const key of LEGACY_LINK_OPENING_PREFERENCE_STORAGE_KEYS) this.storage.removeItem?.(key);
        } catch {
            // Clearing the in-memory preference still restores the built-in default for this run.
        }
    }

    decide(rawTarget: string): LinkOpeningDecision {
        const target = rawTarget.trim();
        if (!target) return { action: 'blocked', target, reason: 'invalid-target' };
        const scheme = normalizedScheme(target);
        if (scheme && UNSAFE_SCHEMES.has(scheme)) {
            return { action: 'blocked', target, reason: 'unsafe-scheme' };
        }
        const kind = conversationLinkTargetKind(target);
        if (kind === 'web') {
            const destination = this.preference || 'builtin-browser';
            return {
                action: destination === 'system-browser'
                    ? 'open-system-browser' : 'open-builtin-browser',
                target,
                remembered: this.preference !== undefined
            };
        }
        if (kind === 'file') {
            return { action: 'open-file-drawer', target };
        }
        return { action: 'blocked', target, reason: 'unsupported-scheme' };
    }

    confirm(rawTarget: string, selection: LinkOpeningSelection): LinkOpeningDecision {
        const decision = this.decide(rawTarget);
        if (decision.action === 'blocked' || decision.action === 'open-file-drawer') return decision;
        if (!LINK_OPENING_DESTINATIONS.includes(selection.destination)) {
            return { action: 'blocked', target: decision.target, reason: 'invalid-selection' };
        }
        let remembered = false;
        if (selection.remember) {
            remembered = this.setPreference(selection.destination);
        }
        return {
            action: selection.destination === 'system-browser'
                ? 'open-system-browser' : 'open-builtin-browser',
            target: decision.target,
            remembered
        };
    }
}
