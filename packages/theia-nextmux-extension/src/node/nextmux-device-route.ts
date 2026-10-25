export interface StoredDeviceRoute {
    readonly origin: string;
    readonly deviceId: string;
    readonly token: string;
    readonly expiresAt: number;
}

export function storedDeviceRoute(value: unknown): StoredDeviceRoute | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Partial<StoredDeviceRoute>;
    if (typeof record.origin !== 'string' || typeof record.deviceId !== 'string' || !record.deviceId
        || typeof record.token !== 'string' || record.token.length > 6000
        || !/^nmx-dr1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(record.token)
        || !Number.isSafeInteger(record.expiresAt)) return undefined;
    try { if (new URL(record.origin).origin !== record.origin) return undefined; } catch { return undefined; }
    return record as StoredDeviceRoute;
}

/** A route token accompanies the device identity only at its exact platform
 * origin. Expiry falls back to the old authenticated device header; it never
 * triggers automatic replay of a generation request. */
export function deviceRouteForRequest(route: StoredDeviceRoute | undefined, origin: string, deviceId: string, now = Date.now()): string | undefined {
    return route && route.origin === origin && route.deviceId === deviceId && route.expiresAt > now ? route.token : undefined;
}
