export interface SidebarProject {
    readonly path: string;
    readonly label: string;
}

/** Lexical filesystem identity; Windows drive/UNC paths compare without case. */
export function codingProjectPathKey(path: string): string {
    if (path.startsWith('archive:')) return path;
    const windows = /^[a-z]:[\\/]|^\\\\/i.test(path)
        || typeof navigator !== 'undefined' && /Win/i.test(navigator.platform);
    const normalized = path.replace(/\\/g, '/');
    const prefix = normalized.startsWith('//') ? '//' : normalized.startsWith('/') ? '/' : '';
    const segments: string[] = [];
    for (const part of normalized.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..' && segments.length && segments.at(-1) !== '..' && !segments.at(-1)!.endsWith(':')) segments.pop();
        else if (part !== '..' || !prefix) segments.push(part);
    }
    const key = prefix + segments.join('/') + (/^[a-z]:\/+$/i.test(normalized) ? '/' : '');
    return windows ? key.toLowerCase() : key;
}

/**
 * Project identity survives a closed or temporarily unavailable folder. These
 * entries are display-only; only workspaceOptions authorize filesystem work.
 */
export function codingSidebarProjects(
    workspaces: readonly SidebarProject[],
    sessions: readonly { readonly workspacePath: string; readonly archiveProject?: { readonly sourceSha256: string; readonly ref: string; readonly label: string } }[]
): readonly SidebarProject[] {
    const projects = new Map<string, SidebarProject>();
    for (const project of workspaces) {
        const key = codingProjectPathKey(project.path);
        if (!projects.has(key)) projects.set(key, project);
    }
    for (const session of sessions) {
        const path = session.workspacePath || (session.archiveProject ? `archive:${session.archiveProject.sourceSha256}:${session.archiveProject.ref}` : '');
        const key = codingProjectPathKey(path);
        if (!path || projects.has(key)) continue;
        const label = session.workspacePath ? (path.split(/[\\/]/).filter(Boolean).at(-1) || path) : (session.archiveProject?.label || path);
        projects.set(key, { path, label });
    }
    return [...projects.values()];
}
