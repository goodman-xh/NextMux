export type DesktopThemePreference = 'system' | 'light' | 'dark';
export type ResolvedDesktopTheme = Exclude<DesktopThemePreference, 'system'>;

export const NEXTMUX_DESKTOP_THEME_KEY = 'nextmux.desktop.theme.v1';
export const THEIA_THEME_STORAGE_KEY = 'theme';

export interface DesktopThemeTarget {
    setCurrentTheme(theme: ResolvedDesktopTheme, persist: boolean): void;
}

export interface DesktopThemeStorage {
    setItem(key: string, value: string): void;
}

export interface ApplyDesktopThemeOptions {
    readonly preference: DesktopThemePreference;
    readonly systemPrefersDark: boolean;
    readonly persistPreference?: boolean;
    readonly target: DesktopThemeTarget;
    readonly storage: DesktopThemeStorage;
}

export function resolveDesktopTheme(
    preference: DesktopThemePreference,
    systemPrefersDark: boolean
): ResolvedDesktopTheme {
    if (preference !== 'system') return preference;
    return systemPrefersDark ? 'dark' : 'light';
}

/**
 * Applies the NextMux preference and the native Theia theme atomically.
 *
 * Theia validates its active theme against `workbench.colorTheme` after its
 * preference service becomes ready. Calling `setCurrentTheme(..., false)`
 * therefore creates a split UI: NextMux renders light tokens while Theia and
 * Monaco are restored to the old dark preference. Persisting the resolved
 * theme is required even when the user-facing preference remains `system`.
 */
export function applyDesktopTheme(options: ApplyDesktopThemeOptions): ResolvedDesktopTheme {
    const resolved = resolveDesktopTheme(options.preference, options.systemPrefersDark);
    options.storage.setItem(NEXTMUX_DESKTOP_THEME_KEY, options.preference);
    options.storage.setItem(THEIA_THEME_STORAGE_KEY, resolved);
    options.target.setCurrentTheme(resolved, options.persistPreference !== false);
    return resolved;
}

export function desktopThemePreferenceNeedsPersistence(
    configuredTheme: unknown,
    resolvedTheme: ResolvedDesktopTheme
): boolean {
    return configuredTheme !== resolvedTheme;
}
