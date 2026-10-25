import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { scanText, mask } from './secret-scan.mjs';

// Generated at run time so this file never contains a credential-shaped literal.
const random = length => randomBytes(length).toString('base64url').slice(0, length);

test('detects generated credentials and masks them in the report', () => {
    const keys = [`sk-${random(40)}`, `sk-ant-api03-${random(80)}`, `AKIA${random(16).toUpperCase().replace(/[^A-Z0-9]/g, 'Q')}`,
        `ghp_${random(36).replace(/[^A-Za-z0-9]/g, 'a')}`, `apik_${random(32).replace(/[^A-Za-z0-9_]/g, 'b')}`];
    for (const key of keys) {
        const findings = scanText(`const value = "${key}";`, 'x.ts');
        assert.equal(findings.length >= 1, true, key.slice(0, 8));
        assert.doesNotMatch(JSON.stringify(findings), new RegExp(key.slice(8, 20).replace(/[-]/g, '\\-')), 'the report never repeats the secret');
    }
    assert.equal(scanText(['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' ')).length, 1);
    assert.equal(scanText(`api_key = "${random(40)}"`).length, 1);
    assert.equal(mask('abcdefghijklmnop'), 'abcdef…op (16 chars)');
});

test('ignores readable fixtures, placeholders and explicitly allowed lines', () => {
    for (const line of ['apiKey: "sk-test-model-discovery-key"', 'const secret = "sk-secret-that-must-not-appear";',
        'const SECRET = "ws_0123456789abcdef0123456789abcdef0123456789abcdef";', 'token: "${TOKEN}"', 'key = "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
        `const k = "sk-${random(40)}"; // secret-scan: allow`]) assert.deepEqual(scanText(line), [], line);
});
