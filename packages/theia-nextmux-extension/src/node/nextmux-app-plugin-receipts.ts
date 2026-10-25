import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const APP_PLUGIN_RECEIPT_LIMIT = 1000;
const receiptFile = /^\d{13}-[0-9a-f-]{36}\.json$/;
export interface AppPluginReceiptResult {
    readonly ok: boolean;
    readonly costUsd?: number;
    readonly costStatus?: 'known' | 'unknown';
    readonly error?: string;
}

/** Backend-owned receipts survive renderer disposal. No prompts, frames, answers, models or credentials are stored. */
export async function recordAppPluginReceipt(dataRoot: string, requestId: string | undefined, kind: 'decision' | 'vision', result: AppPluginReceiptResult): Promise<void> {
    if (typeof requestId !== 'string' || !/^[\w.:-]{1,200}$/.test(requestId)) return;
    const root = join(dataRoot, 'app-plugin-receipts');
    const at = Date.now(), id = randomUUID();
    const target = join(root, `${String(at).padStart(13, '0')}-${id}.json`), temporary = join(root, `.${id}.tmp`);
    const known = result.costStatus === 'known' && typeof result.costUsd === 'number' && Number.isFinite(result.costUsd) && result.costUsd >= 0;
    // Provider diagnostics can include arbitrary text; retain only our fixed error family/status.
    const error = typeof result.error === 'string' ? /^(?:decision|vision)_[a-z0-9_]{1,60}(?=:|$)/.exec(result.error)?.[0] : undefined;
    const receipt = { requestId, kind, at, ok: result.ok === true, costStatus: known ? 'known' : 'unknown',
        ...(known ? { costUsd: result.costUsd } : {}), ...(error ? { error } : {}) };
    await mkdir(root, { recursive: true, mode: 0o700 });
    try {
        await writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => undefined); }
    // Independent atomic files avoid read/modify/write loss between backend connections/processes.
    const files = (await readdir(root)).filter(name => receiptFile.test(name)).sort();
    await Promise.all(files.slice(0, Math.max(0, files.length - APP_PLUGIN_RECEIPT_LIMIT)).map(name => unlink(join(root, name)).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    })));
}
