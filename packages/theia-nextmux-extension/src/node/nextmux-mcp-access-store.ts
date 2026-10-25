import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

type ToolApproval = readonly [string, string];
type StoredApproval = readonly ToolApproval[];
type Listener = (identity: string, tools: StoredApproval | undefined, origin: object) => void;
const fingerprint = /^[a-f0-9]{64}$/;

/** Only hashes and selected tool names live here. Commands, environment and credentials remain in their existing stores. */
export class McpAccessStore {
    private entries = new Map<string, StoredApproval>();
    private touched = new Set<string>();
    private listeners = new Set<Listener>();
    private loading?: Promise<void>;
    private writing: Promise<void> = Promise.resolve();

    constructor(readonly path: string) {}

    ready(): Promise<void> {
        return this.loading ??= (async () => {
            try {
                if ((await stat(this.path)).size > 8 * 1024 * 1024) throw new Error('MCP_APPROVAL_STORE_INVALID');
                const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
                if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) throw new Error();
                const approvals = (parsed as { approvals?: unknown }).approvals;
                if (!Array.isArray(approvals) || approvals.length > 256) throw new Error();
                for (const entry of approvals) {
                    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !fingerprint.test(entry[0])) throw new Error();
                    this.validateTools(entry[1]);
                    // A Stop intent received during initial disk I/O wins over the old disk grant.
                    if (!this.touched.has(entry[0])) this.entries.set(entry[0], entry[1]);
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    this.entries.clear();
                    throw new Error('MCP_APPROVAL_STORE_INVALID');
                }
            }
        })();
    }

    private validateTools(tools: unknown): asserts tools is StoredApproval {
        if (!Array.isArray(tools) || tools.length > 4096 || tools.some(tool => !Array.isArray(tool) || tool.length !== 2
            || typeof tool[0] !== 'string' || !tool[0] || tool[0].length > 512 || typeof tool[1] !== 'string' || !fingerprint.test(tool[1]))) {
            throw new Error('MCP_APPROVAL_STORE_INVALID');
        }
    }

    get(identity: string): StoredApproval | undefined {
        const tools = this.entries.get(identity);
        return tools?.map(([name, hash]) => [name, hash] as const);
    }

    subscribe(listener: Listener): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    set(identity: string, tools: StoredApproval | undefined, origin: object): Promise<void> {
        if (!fingerprint.test(identity)) throw new Error('MCP_APPROVAL_STORE_INVALID');
        if (tools) this.validateTools(tools);
        this.touched.add(identity);
        if (tools) this.entries.set(identity, tools.map(([name, hash]) => [name, hash] as const));
        else this.entries.delete(identity);
        for (const listener of this.listeners) listener(identity, this.get(identity), origin);
        const pending = this.writing.catch(() => undefined).then(async () => {
            await this.ready();
            if (this.entries.size > 256) throw new Error('MCP_APPROVAL_STORE_LIMIT');
            const data = JSON.stringify({ version: 1, approvals: [...this.entries] });
            if (Buffer.byteLength(data) > 8 * 1024 * 1024) throw new Error('MCP_APPROVAL_STORE_LIMIT');
            await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
            const temporary = `${this.path}.${randomUUID()}.tmp`;
            try {
                const file = await open(temporary, 'wx', 0o600);
                try { await file.writeFile(data, 'utf8'); await file.sync(); } finally { await file.close(); }
                await rename(temporary, this.path);
            } finally { await rm(temporary, { force: true }).catch(() => undefined); }
        });
        this.writing = pending;
        // Some lifecycle hooks cannot await, but callers of set/flush still receive the failure.
        void pending.catch(() => undefined);
        return pending;
    }

    async flush(): Promise<void> { await this.writing; }
}

const stores = new Map<string, McpAccessStore>();
/** One backend-local publisher shared by connection containers; a new backend loads the same atomic file. */
export function persistentMcpAccessStore(): McpAccessStore {
    const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
        : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
            : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
    const directory = process.env.NEXTMUX_DESKTOP_STATE_DIR ? resolve(process.env.NEXTMUX_DESKTOP_STATE_DIR) : join(base, 'NextMux');
    const path = join(directory, 'mcp-approvals-v1.json');
    let store = stores.get(path);
    if (!store) { store = new McpAccessStore(path); stores.set(path, store); }
    return store;
}
