import assert from 'node:assert/strict';
import test from 'node:test';

import { terminatePosixProcessTree } from '../lib/node/nextmux-process-tree.js';

test('POSIX cleanup checks and kills the process group even after its leader exits', async () => {
    const calls = [];
    let groupChecks = 0;
    const terminated = await terminatePosixProcessTree(4242, {
        delay: async () => undefined,
        kill: (pid, signal) => {
            calls.push([pid, signal]);
            if (pid === -4242 && signal === 0) {
                groupChecks += 1;
                if (groupChecks > 1) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
            }
            if (pid === 4242 && signal === 0) throw Object.assign(new Error('leader exited'), { code: 'ESRCH' });
        }
    });
    assert.equal(terminated, true);
    assert.deepEqual(calls, [
        [-4242, 'SIGTERM'],
        [-4242, 0],
        [-4242, 'SIGKILL'],
        [-4242, 0]
    ]);
});

test('POSIX cleanup reports false while the target group remains alive after SIGKILL', async () => {
    const terminated = await terminatePosixProcessTree(4343, {
        delay: async () => undefined,
        kill: () => undefined
    });
    assert.equal(terminated, false);
});
