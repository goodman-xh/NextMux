import * as path from 'path';
import { lstat, mkdir, readdir, realpath, rename, rm } from 'fs/promises';
import { SkillDomainError } from '../common/nextmux-skill-domain';

// Install requests are bounded; a day also leaves ample room for another process's active staging directory.
export const COMMUNITY_SKILL_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export const communitySkillTempName = new RegExp(`^\\.nextmux-install-(?:${uuid}|[a-zA-Z0-9]{6})$`);
export const communitySkillBackupName = new RegExp(`^\\.nextmux-backup-([a-z0-9]+(?:-[a-z0-9]+)*)--${uuid}$`);

/** Use native path semantics, including drive/UNC boundaries and Windows case folding. */
export function communitySkillPathKey(value: string, paths: typeof path = path): string {
    const resolved = paths.resolve(value);
    return paths.sep === '\\' ? resolved.toLowerCase() : resolved;
}

export function communitySkillPathInside(root: string, candidate: string, paths: typeof path = path): boolean {
    const difference = paths.relative(paths.resolve(root), paths.resolve(candidate));
    return Boolean(difference) && difference !== '..' && !difference.startsWith(`..${paths.sep}`) && !paths.isAbsolute(difference);
}

/** Create one component at a time so mkdir never follows an unchecked link in a missing parent. */
export async function ensureCommunitySkillDirectory(directory: string): Promise<void> {
    try {
        const info = await lstat(directory);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new SkillDomainError('SKILL_INSTALL_PATH_UNSAFE');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = path.dirname(directory);
        if (parent === directory) throw error;
        await ensureCommunitySkillDirectory(parent);
        try { await mkdir(directory, { mode: 0o700 }); }
        catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError; }
        await ensureCommunitySkillDirectory(directory);
    }
}

/** Only regular files/directories may enter a published skill; Git symlinks/submodules are rejected earlier. */
export async function assertCommunitySkillTree(directory: string): Promise<string[]> {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new SkillDomainError('SKILL_INSTALL_PATH_UNSAFE');
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const child = path.join(directory, entry.name);
        const childInfo = await lstat(child);
        if (childInfo.isSymbolicLink() || (!childInfo.isDirectory() && !childInfo.isFile()) || (childInfo.isFile() && childInfo.nlink !== 1)) {
            throw new SkillDomainError('SKILL_INSTALL_PATH_UNSAFE');
        }
        if (childInfo.isDirectory()) {
            files.push(...(await assertCommunitySkillTree(child)).map(file => `${entry.name}/${file}`));
        } else {
            files.push(entry.name);
        }
    }
    return files;
}

/** The caller pins realpath before creating staging. Detect replaced ancestors as well as the root itself. */
async function assertCommunitySkillCanonicalRoot(root: string): Promise<void> {
    for (const directory of [path.dirname(root), root]) {
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new SkillDomainError('SKILL_INSTALL_PATH_UNSAFE');
    }
    if (communitySkillPathKey(await realpath(root)) !== communitySkillPathKey(root)) {
        throw new SkillDomainError('SKILL_INSTALL_PATH_UNSAFE');
    }
}

/** Check every staging parent before writing; an injected directory link must not redirect mkdir/writeFile. */
export async function prepareCommunitySkillFile(root: string, candidate: string): Promise<void> {
    if (!communitySkillPathInside(root, candidate)) throw new SkillDomainError('SKILL_PATH_ESCAPE');
    await assertCommunitySkillCanonicalRoot(root);
    let parent = root;
    for (const segment of path.relative(root, path.dirname(candidate)).split(path.sep).filter(Boolean)) {
        parent = path.join(parent, segment);
        await ensureCommunitySkillDirectory(parent);
    }
    const [realRoot, realParent] = await Promise.all([realpath(root), realpath(parent)]);
    if (communitySkillPathKey(realRoot) !== communitySkillPathKey(root)
        || (communitySkillPathKey(realRoot) !== communitySkillPathKey(realParent) && !communitySkillPathInside(realRoot, realParent))) {
        throw new SkillDomainError('SKILL_PATH_ESCAPE');
    }
}

/** Same-volume staging must commit by rename. Copy fallback would expose partially written skills. */
export async function renameCommunitySkillDirectory(from: string, to: string): Promise<void> {
    from = path.resolve(from);
    to = path.resolve(to);
    const root = path.dirname(from);
    if (communitySkillPathKey(root) !== communitySkillPathKey(path.dirname(to))) throw new SkillDomainError('SKILL_PATH_ESCAPE');
    for (let attempt = 0; ; attempt++) {
        await assertCommunitySkillCanonicalRoot(root);
        try { await rename(path.join(root, path.basename(from)), path.join(root, path.basename(to))); return; }
        catch (error) {
            if (attempt >= 3 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
            await new Promise(resolveDelay => setTimeout(resolveDelay, 40 * (attempt + 1)));
        }
    }
}

/** rm does not follow child links; refuse a replaced root and only unlink a direct owned staging child. */
export async function removeCommunitySkillTemp(root: string, temporary: string): Promise<void> {
    await removeCommunitySkillWorkDirectory(root, temporary, communitySkillTempName);
}

export async function removeCommunitySkillBackup(root: string, backup: string): Promise<void> {
    await removeCommunitySkillWorkDirectory(root, backup, communitySkillBackupName);
}

async function removeCommunitySkillWorkDirectory(root: string, directory: string, name: RegExp): Promise<void> {
    root = path.resolve(root);
    directory = path.resolve(directory);
    if (!name.test(path.basename(directory))
        || communitySkillPathKey(path.dirname(directory)) !== communitySkillPathKey(root)) throw new SkillDomainError('SKILL_PATH_ESCAPE');
    await assertCommunitySkillCanonicalRoot(root);
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
