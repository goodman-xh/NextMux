import { DesktopDomainError } from '../common/nextmux-domain-errors';
import { createHash } from 'crypto';
import { realpath, stat } from 'fs/promises';
import { realpathSync } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';
import { AgentToolError, narrowAgentPermission } from '@nextmux/agent-runtime';
import type { AgentPermissionMode } from '@nextmux/agent-runtime';

/** Selected by the host/user, never derived from a model's tool arguments. */
export interface AgentWorkspaceSelection {
    readonly id: string;
    readonly path: string;
    readonly permissionMode: AgentPermissionMode;
}

export interface ResolvedAgentWorkspaces {
    readonly workspaceRoot: string;
    readonly primaryBindingId: string;
    readonly bindings: readonly AgentWorkspaceSelection[];
    /** Binds resumable state to directory identities and per-directory grants. */
    readonly workspaceBindingsKey?: string;
}

const validMode = (value: unknown): value is AgentPermissionMode =>
    value === 'read_only' || value === 'workspace_write' || value === 'full_access';
const workspaceError = (code: string, reason: string, english: string, params?: Readonly<Record<string, string | number | boolean>>): AgentToolError => {
    const detail = new DesktopDomainError(reason, english, params);
    return Object.assign(new AgentToolError(code, english, { params }), { domainError: detail.domainError, data: detail.data });
};
const pathKey = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path;

/** A nested project and its parent share files, even when opened as separate roots. */
export function agentWorkspaceScopesOverlap(left: string, right: string): boolean {
    const canonical = (path: string): string => {
        try { return pathKey(realpathSync(path)); } catch { return pathKey(resolve(path)); }
    };
    const a = canonical(left), b = canonical(right);
    const contains = (root: string, target: string): boolean => {
        const delta = relative(root, target);
        return !delta || !isAbsolute(delta) && delta !== '..' && !delta.startsWith(`..${sep}`);
    };
    return contains(a, b) || contains(b, a);
}

/** Match OpenCode's explicit external-directory boundary: no implicit cwd switch.
 * Canonical paths are resolved afresh at acceptance and at execution/resume.
 */
export async function resolveAgentWorkspaces(
    primaryPath: string,
    selections: readonly AgentWorkspaceSelection[] | undefined,
    permissionMode: AgentPermissionMode
): Promise<ResolvedAgentWorkspaces> {
    if (!validMode(permissionMode) || typeof primaryPath !== 'string' || !isAbsolute(primaryPath)
        || /[\0\r\n]/.test(primaryPath) || primaryPath.length > 32_768
        || selections !== undefined && (!Array.isArray(selections) || selections.length > 32)) {
        throw workspaceError('INVALID_WORKSPACE_BINDINGS', 'WORKSPACE_INVALID', 'Invalid project folder or permission.');
    }
    const canonical = async (path: string): Promise<{ path: string; identity: string }> => {
        if (typeof path !== 'string' || !isAbsolute(path) || /[\0\r\n]/.test(path) || path.length > 32_768) {
            throw workspaceError('INVALID_WORKSPACE_BINDINGS', 'WORKSPACE_ABSOLUTE_REQUIRED', 'Project folders must be absolute paths on this computer.');
        }
        try {
            const target = await realpath(path);
            const info = await stat(target);
            if (!info.isDirectory()) throw new Error('not a directory');
            return { path: target, identity: `${info.dev}:${info.ino}` };
        } catch {
            throw workspaceError('WORKSPACE_UNAVAILABLE', 'WORKSPACE_UNAVAILABLE', `The project folder does not exist or cannot be accessed: ${path}`, { path });
        }
    };
    const primary = await canonical(primaryPath);
    const ids = new Set<string>(), paths = new Set<string>();
    const resolved: Array<AgentWorkspaceSelection & { identity: string }> = [];
    for (const selection of selections || []) {
        if (!selection || typeof selection.id !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(selection.id) || ids.has(selection.id)
            || !validMode(selection.permissionMode)) {
            throw workspaceError('INVALID_WORKSPACE_BINDINGS', 'WORKSPACE_ID_INVALID', 'Duplicate or invalid project folder id or permission.');
        }
        const target = await canonical(selection.path);
        if (paths.has(pathKey(target.path))) throw workspaceError('INVALID_WORKSPACE_BINDINGS', 'WORKSPACE_DUPLICATE', 'The same project folder is bound twice.');
        ids.add(selection.id); paths.add(pathKey(target.path));
        resolved.push({ id: selection.id, ...target, permissionMode: narrowAgentPermission(permissionMode, selection.permissionMode) });
    }
    let primaryBinding = resolved.find(binding => pathKey(binding.path) === pathKey(primary.path));
    if (!primaryBinding) {
        let id = 'primary';
        while (ids.has(id)) id = `_${id}`;
        primaryBinding = { id, ...primary, permissionMode };
        resolved.unshift(primaryBinding);
    }
    if (resolved.length > 32) throw workspaceError('INVALID_WORKSPACE_BINDINGS', 'WORKSPACE_LIMIT', 'A task can bind at most 32 project folders.', { maxCount: 32 });
    const bindings = resolved.map(({ identity: _identity, ...binding }) => Object.freeze(binding));
    // Legacy single-root checkpoints retain their original ownership contract.
    // A multi-root checkpoint can never be resumed after dropping a root.
    const workspaceBindingsKey = resolved.length > 1 || resolved[0].permissionMode !== permissionMode ? createHash('sha256').update(JSON.stringify(
        [...resolved].sort((a, b) => a.id.localeCompare(b.id)).map(item =>
            [item.id, pathKey(item.path), item.identity, item.permissionMode, item.id === primaryBinding!.id])
    )).digest('hex') : undefined;
    return { workspaceRoot: primary.path, primaryBindingId: primaryBinding.id, bindings: Object.freeze(bindings), workspaceBindingsKey };
}
