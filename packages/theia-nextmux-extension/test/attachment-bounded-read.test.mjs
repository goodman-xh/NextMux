import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { service } from './helpers/editor-recovery-source-loader.mjs';

class AttachmentService extends service.NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.root = root; }
    nextmuxDataRoot() { return this.root; }
    verify(target, size, digest) { return this.readVerifiedAttachmentFile(target, size, digest); }
}
const mismatch = error => error?.code === 'ATTACHMENT_CACHE_MISMATCH';
async function fixture(t, content = Buffer.from('approved fixture bytes\n')) {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'nextmux-bounded-attachment-')));
    const client = new AttachmentService(root), input = { name: 'fixture.txt', mimeType: 'text/plain', dataBase64: content.toString('base64') };
    const cached = await client.cacheDesktopAttachment(input), target = fileURLToPath(cached.uri);
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, client, input, cached, target, content, read: () => client.readDesktopAttachment({ uri: cached.uri, name: input.name, size: cached.size }) };
}
function observeHandle(t, target, configure) {
    const originalOpen = fs.open;
    return t.mock.method(fs, 'open', async (...args) => {
        const handle = await originalOpen(...args);
        if (String(args[0]) === target) await configure(handle);
        return handle;
    });
}

test('actual attachment growth after approved fstat cannot make a read consume more than approved bytes plus one', async t => {
    const f = await fixture(t, Buffer.alloc(1024, 65));
    let consumed = 0, readFileCalls = 0, closed = 0;
    observeHandle(t, f.target, async handle => {
        const stat = handle.stat.bind(handle), readFile = handle.readFile.bind(handle), read = handle.read.bind(handle), close = handle.close.bind(handle);
        let first = true;
        handle.stat = async (...args) => {
            const result = await stat(...args);
            if (first) { first = false; await fs.truncate(f.target, 32 * 1024 * 1024); }
            return result;
        };
        handle.readFile = async (...args) => { readFileCalls++; const bytes = await readFile(...args); consumed += bytes.length; return bytes; };
        handle.read = async (...args) => { const result = await read(...args); consumed += result.bytesRead; return result; };
        handle.close = async () => { closed++; return close(); };
    });
    await assert.rejects(f.read(), mismatch);
    assert.ok(consumed <= f.cached.size + 1, `reader consumed ${consumed} bytes after approval of only ${f.cached.size}`);
    assert.equal(readFileCalls, 0, 'readFile has no immutable-size bound when a file grows');
    assert.equal(closed, 1);
});

test('actual valid reads use a fixed buffer, exact positions and bounded partial reads, never handle.readFile', async t => {
    const f = await fixture(t, Buffer.from('UTF-8 中文🙂 exact bytes across short reads'));
    const positions = [], buffers = new Set(); let closed = 0, tail = 0;
    observeHandle(t, f.target, async handle => {
        const read = handle.read.bind(handle), close = handle.close.bind(handle);
        handle.readFile = async () => { assert.fail('unbounded handle.readFile is forbidden'); };
        handle.read = async (buffer, offset, length, position) => {
            if (position === f.cached.size) { tail++; assert.equal(buffer.length, 1); assert.equal(length, 1); }
            else { buffers.add(buffer); positions.push(position); assert.equal(buffer.length, f.cached.size); }
            return read(buffer, offset, Math.min(length, 3), position);
        };
        handle.close = async () => { closed++; return close(); };
    });
    const result = await f.read();
    assert.equal(Buffer.from(result.dataBase64, 'base64').equals(f.content), true); assert.equal(result.sha256, f.cached.sha256);
    assert.equal(buffers.size, 1); assert.equal(tail, 1); assert.equal(closed, 1);
    assert.deepEqual(positions, Array.from({ length: Math.ceil(f.cached.size / 3) }, (_, i) => i * 3));
});

test('content-addressed cache reuse and legacy unknown-size metadata share the same verified bounded reader', async t => {
    const f = await fixture(t); let reads = 0;
    observeHandle(t, f.target, async handle => {
        const read = handle.read.bind(handle);
        handle.readFile = async () => { assert.fail('cache reuse cannot bypass the bounded reader'); };
        handle.read = async (...args) => { reads++; return read(...args); };
    });
    const reused = await f.client.cacheDesktopAttachment(f.input);
    assert.deepEqual(reused, f.cached); assert.ok(reads >= 2);
    assert.equal((await f.client.verify(f.target, 0, f.cached.sha256)).equals(f.content), true,
        'size zero still means infer the already bounded fstat size for old metadata');
    assert.equal((await fs.readdir(join(f.root, 'conversation-attachments'))).length, 1);
});

test('initial wrong size and files exceeding 24 MiB are rejected before any payload read', async t => {
    const f = await fixture(t); let reads = 0, closed = 0;
    observeHandle(t, f.target, async handle => {
        const close = handle.close.bind(handle);
        handle.readFile = handle.read = async () => { reads++; assert.fail('unapproved file cannot be read'); };
        handle.close = async () => { closed++; return close(); };
    });
    await assert.rejects(f.client.verify(f.target, f.cached.size + 1, f.cached.sha256), mismatch);
    await fs.truncate(f.target, 24 * 1024 * 1024 + 1);
    await assert.rejects(f.client.verify(f.target, 0, f.cached.sha256), mismatch);
    assert.equal(reads, 0); assert.equal(closed, 2);
});

test('shrinking after fstat ends at early EOF instead of returning a truncated success or looping', async t => {
    const f = await fixture(t); let reads = 0, closed = 0;
    observeHandle(t, f.target, async handle => {
        const stat = handle.stat.bind(handle), read = handle.read.bind(handle), close = handle.close.bind(handle); let first = true;
        handle.stat = async (...args) => {
            const result = await stat(...args); if (first) { first = false; await fs.truncate(f.target, 3); } return result;
        };
        handle.read = async (...args) => { reads++; assert.ok(reads <= 2); return read(...args); };
        handle.close = async () => { closed++; return close(); };
    });
    await assert.rejects(f.read(), mismatch); assert.equal(reads, 2); assert.equal(closed, 1);
});

test('one-byte append immediately after the exact payload is detected only with a bounded tail probe', async t => {
    const f = await fixture(t); let returned = 0; const lengths = [];
    observeHandle(t, f.target, async handle => {
        const read = handle.read.bind(handle);
        handle.read = async (...args) => {
            lengths.push(args[2]); const result = await read(...args); returned += result.bytesRead;
            if (returned === f.cached.size) await fs.appendFile(f.target, Buffer.from([1]));
            return result;
        };
    });
    await assert.rejects(f.read(), mismatch);
    assert.equal(returned, f.cached.size + 1); assert.deepEqual(lengths, [f.cached.size, 1]);
});

test('same-byte metadata change during reading is detected by the second descriptor stat', async t => {
    const f = await fixture(t); let stats = 0;
    observeHandle(t, f.target, async handle => {
        const stat = handle.stat.bind(handle);
        handle.stat = async (...args) => {
            stats++;
            if (stats === 2) { const before = await fs.stat(f.target); await fs.utimes(f.target, before.atime, new Date(before.mtimeMs + 2000)); }
            return stat(...args);
        };
    });
    await assert.rejects(f.read(), mismatch); assert.equal(stats, 2);
    assert.equal((await fs.readFile(f.target)).equals(f.content), true);
});

test('growth after descriptor recheck is still rejected by the final pathname metadata check', async t => {
    const f = await fixture(t); let stats = 0;
    observeHandle(t, f.target, async handle => {
        const stat = handle.stat.bind(handle);
        handle.stat = async (...args) => {
            const result = await stat(...args); stats++;
            if (stats === 2) await fs.appendFile(f.target, Buffer.from([1]));
            return result;
        };
    });
    await assert.rejects(f.read(), mismatch); assert.equal(stats, 2);
});

test('same-content pathname replacement cannot change the approved inode after open', async t => {
    const f = await fixture(t);
    observeHandle(t, f.target, async handle => {
        const stat = handle.stat.bind(handle); let first = true;
        handle.stat = async (...args) => {
            const result = await stat(...args);
            if (first) { first = false; await fs.rename(f.target, `${f.target}.old`); await fs.writeFile(f.target, f.content, { flag: 'wx' }); }
            return result;
        };
    });
    await assert.rejects(f.read(), mismatch);
    assert.equal((await fs.readFile(f.target)).equals(f.content), true);
});

test('bounded reading retains digest verification and always closes the descriptor on a read fault', async t => {
    const f = await fixture(t); let closed = 0;
    await assert.rejects(f.client.verify(f.target, f.cached.size, createHash('sha256').update('other').digest('hex')), mismatch);
    observeHandle(t, f.target, async handle => {
        const close = handle.close.bind(handle);
        handle.read = async () => { throw Object.assign(new Error('controlled read failure'), { code: 'EIO' }); };
        handle.close = async () => { closed++; return close(); };
    });
    await assert.rejects(f.read(), { code: 'EIO' }); assert.equal(closed, 1);
});
