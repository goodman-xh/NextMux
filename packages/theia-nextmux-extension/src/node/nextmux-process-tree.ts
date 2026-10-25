import { execFile } from 'child_process';

export interface PosixProcessTreeDependencies {
    readonly kill?: (processId: number, signal: NodeJS.Signals | 0) => void;
    readonly delay?: (milliseconds: number) => Promise<void>;
}

function processMissing(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
}

function targetAlive(target: number, kill: (processId: number, signal: NodeJS.Signals | 0) => void): boolean {
    try {
        kill(target, 0);
        return true;
    } catch (error) {
        // EPERM means the process still exists but cannot be signalled. Only ESRCH
        // proves that the process or process group has disappeared.
        return !processMissing(error);
    }
}

/**
 * Terminates a POSIX process group when the terminal owns one, otherwise its
 * leader. Liveness checks deliberately use the same target that was signalled:
 * checking only the leader can leak children after that leader exits.
 */
export async function terminatePosixProcessTree(
    processId: number,
    dependencies: PosixProcessTreeDependencies = {}
): Promise<boolean> {
    if (!Number.isSafeInteger(processId) || processId <= 1) return false;
    const kill = dependencies.kill || process.kill.bind(process);
    const delay = dependencies.delay || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));

    let target = -processId;
    try {
        kill(target, 'SIGTERM');
    } catch (groupError) {
        // Not every PTY child is a process-group leader. Fall back to the child
        // only when the group does not exist; permission errors must not be
        // misreported as successful cleanup.
        if (!processMissing(groupError)) return false;
        target = processId;
        try {
            kill(target, 'SIGTERM');
        } catch (leaderError) {
            return processMissing(leaderError);
        }
    }

    await delay(250);
    if (!targetAlive(target, kill)) return true;
    try {
        kill(target, 'SIGKILL');
    } catch (error) {
        return processMissing(error);
    }
    await delay(100);
    return !targetAlive(target, kill);
}

/**
 * Descendants of a process that was not started as its own group (the MCP SDK spawns stdio servers that way), read
 * from `ps` on POSIX. Collected before the parent is stopped: once it exits, its children are re-parented and can no
 * longer be found from it.
 */
export async function posixDescendantProcessIds(
    rootId: number,
    listProcesses: () => Promise<string> = defaultProcessList
): Promise<number[]> {
    if (!Number.isSafeInteger(rootId) || rootId <= 1) return [];
    let listing = '';
    try { listing = await listProcesses(); } catch { return []; }
    const children = new Map<number, number[]>();
    for (const line of listing.split('\n')) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number);
        if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid)) continue;
        children.set(ppid, [...children.get(ppid) || [], pid]);
    }
    const found: number[] = [];
    const queue = [...children.get(rootId) || []];
    while (queue.length && found.length < 512) {
        const next = queue.shift()!;
        if (found.includes(next) || next === rootId) continue;
        found.push(next);
        queue.push(...children.get(next) || []);
    }
    return found;
}

function defaultProcessList(): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile('ps', ['-Ao', 'pid=,ppid='], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(String(stdout)));
    });
}

/** SIGTERM the given processes, then SIGKILL whichever are still alive a moment later. */
export async function terminatePosixProcesses(processIds: readonly number[], dependencies: PosixProcessTreeDependencies = {}): Promise<void> {
    const kill = dependencies.kill || process.kill.bind(process);
    const delay = dependencies.delay || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    const targets = processIds.filter(id => Number.isSafeInteger(id) && id > 1 && id !== process.pid);
    for (const id of targets) { try { kill(id, 'SIGTERM'); } catch { /* already gone */ } }
    if (!targets.length) return;
    await delay(250);
    for (const id of targets) if (targetAlive(id, kill)) { try { kill(id, 'SIGKILL'); } catch { /* already gone */ } }
}
