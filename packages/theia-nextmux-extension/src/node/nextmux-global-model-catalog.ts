import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import type { PlatformGlobalModelCatalog, PlatformRegistryModel } from '../common/nextmux-platform-protocol';

const cacheTtlMs = 30 * 60 * 1000;
const maximumBytes = 16 * 1024 * 1024;

function validateCatalog(payload: unknown): PlatformGlobalModelCatalog {
    const value = payload as (Partial<PlatformGlobalModelCatalog> & { nextOffset?: unknown }) | null;
    if (!value || !Array.isArray(value.models) || !value.models.length || value.models.length > 10000
        || value.nextOffset != null
        || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt <= 0) throw new Error('Invalid public model directory');
    const ids = new Set<string>();
    const models = value.models.map((model: PlatformRegistryModel) => {
        if (!model || typeof model.canonicalModel !== 'string' || !model.canonicalModel.includes('/')
            || model.canonicalModel.length > 300 || typeof model.provider !== 'string' || typeof model.displayName !== 'string'
            || ![model.input, model.output, model.capabilities].every(items => Array.isArray(items) && items.length <= 100 && items.every(item => typeof item === 'string'))
            || ids.has(model.canonicalModel)) throw new Error('Invalid public model entry');
        ids.add(model.canonicalModel);
        return { ...model, aliases: (Array.isArray(model.aliases) ? model.aliases : []).filter(alias => typeof alias === 'string' && alias.length <= 300).slice(0, 500) };
    });
    return { models, updatedAt: value.updatedAt };
}

/** A public snapshot shared by desktop windows. Private API discovery never enters this cache. */
export class GlobalModelCatalogCache {
    private snapshot: PlatformGlobalModelCatalog | undefined;
    private expiresAt = 0;
    private pending: Promise<PlatformGlobalModelCatalog> | undefined;
    private diskRead: Promise<{ snapshot: PlatformGlobalModelCatalog; expiresAt: number; version: string } | undefined> | undefined;
    private diskWrite: Promise<void> = Promise.resolve();
    private version = '';
    private generation = 0;

    constructor(private readonly path: string, private readonly fetchCatalog: (version: string) => Promise<unknown>) {}

    /** In-flight requests belong to the revision that started them, including optional disk writes. */
    invalidate(version: string): void {
        if (version === this.version) return;
        this.version = version;
        this.generation++;
        this.expiresAt = 0;
        this.pending = undefined;
        if (this.snapshot) this.snapshot = { ...this.snapshot, stale: true };
    }

    async get(force = false, version = this.version): Promise<PlatformGlobalModelCatalog> {
        this.invalidate(version);
        if (!force && this.snapshot && this.expiresAt > Date.now()) return this.snapshot;
        if (this.pending) return this.pending;
        const operation = this.refresh(force, version, this.generation).finally(() => {
            if (this.pending === operation) this.pending = undefined;
        });
        this.pending = operation;
        return operation;
    }

    private async readDisk(): Promise<{ snapshot: PlatformGlobalModelCatalog; expiresAt: number; version: string } | undefined> {
        try {
            const info = await stat(this.path);
            if (info.size > maximumBytes) throw new Error('Public directory cache is too large');
            const disk = JSON.parse(await readFile(this.path, 'utf8'));
            return { snapshot: validateCatalog(disk), expiresAt: Math.min(Number(disk.fetchedAt) || 0, Date.now()) + cacheTtlMs,
                version: typeof disk.catalogVersion === 'string' ? disk.catalogVersion : '' };
        } catch { return undefined; }
    }

    private async saveSnapshot(fresh: PlatformGlobalModelCatalog, version: string, generation: number): Promise<void> {
        // Serial renames ensure a write already in progress cannot land after a newer revision's write.
        this.diskWrite = this.diskWrite.then(async () => {
            if (generation !== this.generation) return;
            const temporary = `${this.path}.${randomUUID()}.tmp`;
            try {
                await mkdir(dirname(this.path), { recursive: true });
                await writeFile(temporary, JSON.stringify({ ...fresh, fetchedAt: Date.now(), catalogVersion: version }), { encoding: 'utf8', mode: 0o600 });
                if (generation === this.generation) await rename(temporary, this.path);
            } catch { /* Disk caching is optional; the verified in-memory snapshot remains usable. */ }
            finally { await rm(temporary, { force: true }).catch(() => undefined); }
        });
        await this.diskWrite;
    }

    private async refresh(force: boolean, version: string, generation: number): Promise<PlatformGlobalModelCatalog> {
        this.diskRead ||= this.readDisk();
        const disk = await this.diskRead;
        if (generation !== this.generation) throw new Error('Public directory revision changed');
        if (!this.snapshot && disk) {
            this.snapshot = disk.snapshot;
            this.expiresAt = disk.version === version ? disk.expiresAt : 0;
        }
        if (!force && this.snapshot && this.expiresAt > Date.now()) return this.snapshot;
        try {
            const fresh = validateCatalog(await this.fetchCatalog(version));
            if (generation !== this.generation) return { ...fresh, stale: true };
            this.snapshot = fresh;
            this.expiresAt = Date.now() + cacheTtlMs;
            await this.saveSnapshot(fresh, version, generation);
            return generation === this.generation ? fresh : { ...fresh, stale: true };
        } catch (error) {
            if (!this.snapshot) throw error;
            if (generation !== this.generation) return { ...this.snapshot, stale: true };
            // A previous revision stays usable offline, but never acknowledges the new revision.
            this.expiresAt = Date.now() + 60_000;
            this.snapshot = { ...this.snapshot, stale: true };
            return this.snapshot;
        }
    }
}
