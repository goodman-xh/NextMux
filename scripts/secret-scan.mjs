#!/usr/bin/env node
// Scan the working tree for credentials before code leaves the machine
// (open-source publication, a pull request, a shared archive).
//
//   node scripts/secret-scan.mjs [root ...] [--json]
//
// Exit code 0: nothing found. Exit code 1: findings (values are masked in the
// report so the report itself never leaks them). A line that deliberately
// holds a fake credential for a test can carry the marker
// `secret-scan: allow` in a comment on the same line.
import { spawnSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.hg', 'lib', 'dist', 'out', 'build', 'coverage', '.wrangler', '.nextmux-run',
    '.turbo', '.cache', '.next', 'public', '.pnpm-store', '.yarn', '__pycache__', '.venv', 'venv', 'reports', 'codex-thread-archive']);
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.pdf', '.zip', '.gz', '.tgz', '.7z', '.woff', '.woff2',
    '.ttf', '.otf', '.mp3', '.mp4', '.mov', '.wav', '.m4a', '.webm', '.wasm', '.node', '.dylib', '.so', '.dll', '.exe', '.bin', '.dmg', '.pyc', '.sqlite', '.db']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Named patterns; `group` selects the secret itself so only it is measured and masked. */
export const SECRET_PATTERNS = [
    { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
    { id: 'anthropic-key', pattern: /\b(sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{40,})/ },
    { id: 'openai-style-key', pattern: /\b(sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,})/, entropy: 3.4 },
    { id: 'aws-access-key', pattern: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/ },
    { id: 'github-token', pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
    { id: 'slack-token', pattern: /\b(xox[abprs]-[A-Za-z0-9-]{20,})\b/ },
    { id: 'google-api-key', pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/ },
    { id: 'stripe-key', pattern: /\b((?:sk|rk)_live_[A-Za-z0-9]{20,})\b/ },
    { id: 'whop-key', pattern: /\b(apik_[A-Za-z0-9_]{20,})\b/ },
    { id: 'jwt', pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/, entropy: 4 },
    { id: 'assigned-secret', pattern: /(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret|access[_-]?key)["']?\s*[:=]\s*["']([A-Za-z0-9+/_\-.]{28,})["']/i, entropy: 4 }
];

// Test fixtures use readable words and runs; generated credentials do not.
const PLACEHOLDER = /(?:x{6,}|\*{4,}|example|placeholder|dummy|fake|synthetic|redacted|your[_-]|test|fixture|mock|sample|demo|invalid|secret|local|changeme|0123456|abcdef|<[^>]+>|\$\{)/i;

export function shannonEntropy(value) {
    const counts = new Map();
    for (const character of value) counts.set(character, (counts.get(character) || 0) + 1);
    let entropy = 0;
    for (const count of counts.values()) { const p = count / value.length; entropy -= p * Math.log2(p); }
    return entropy;
}

export function mask(value) {
    return value.length <= 10 ? '*'.repeat(value.length) : `${value.slice(0, 6)}…${value.slice(-2)} (${value.length} chars)`;
}

/** Findings in one file's text. */
export function scanText(text, file = '') {
    const findings = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
        if (line.length > 4000 || /secret-scan:\s*allow/.test(line)) return;
        for (const rule of SECRET_PATTERNS) {
            const match = rule.pattern.exec(line);
            if (!match) continue;
            const secret = match[1] || match[0];
            if (PLACEHOLDER.test(secret)) continue;
            if (rule.entropy && shannonEntropy(secret) < rule.entropy) continue;
            findings.push({ file, line: index + 1, rule: rule.id, value: mask(secret) });
        }
    });
    return findings;
}

/** Paths (relative to the working directory) that git would not publish. */
function gitIgnored(files) {
    if (!files.length) return new Set();
    // -z keeps non-ASCII paths unquoted in both directions.
    const result = spawnSync('git', ['check-ignore', '-z', '--stdin'], { input: files.join('\0'), encoding: 'utf8' });
    if (result.error || (result.status !== 0 && result.status !== 1)) return new Set();
    return new Set(result.stdout.split('\0').filter(Boolean));
}

async function* walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) { if (!SKIP_DIRECTORIES.has(entry.name)) yield* walk(path); }
        else if (entry.isFile()) yield path;
    }
}

export async function scanTree(roots) {
    const findings = [], envFiles = [];
    let files = 0;
    for (const root of roots) {
        for await (const path of walk(root)) {
            const name = path.split(/[\\/]/).pop();
            if (/^\.env(\..+)?$/.test(name) && !/\.(example|sample|template)$/.test(name)) envFiles.push(relative(process.cwd(), path));
            if (BINARY_EXTENSIONS.has(extname(name).toLowerCase())) continue;
            const info = await stat(path);
            if (info.size > MAX_FILE_BYTES) continue;
            const buffer = await readFile(path);
            if (buffer.subarray(0, 8000).includes(0)) continue;
            files += 1;
            findings.push(...scanText(buffer.toString('utf8'), relative(process.cwd(), path)));
        }
    }
    return { files, findings, envFiles };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('secret-scan.mjs')) {
    const args = process.argv.slice(2);
    const json = args.includes('--json');
    const roots = args.filter(arg => !arg.startsWith('--'));
    const result = await scanTree((roots.length ? roots : ['.']).map(root => resolve(root)));
    // Files git ignores are never published; report them as warnings only.
    const ignored = gitIgnored([...new Set(result.findings.map(finding => finding.file))]);
    const blocking = result.findings.filter(finding => !ignored.has(finding.file));
    const local = result.findings.filter(finding => ignored.has(finding.file));
    if (json) console.log(JSON.stringify({ ...result, blocking, ignored: local }, null, 2));
    else {
        console.log(`Scanned ${result.files} text files.`);
        for (const finding of blocking) console.log(`  ✗ ${finding.file}:${finding.line}  ${finding.rule}  ${finding.value}`);
        for (const finding of local) console.log(`  ! ${finding.file}:${finding.line}  ${finding.rule}  ${finding.value}  (git-ignored, never published — rotate the credential if it was ever shared)`);
        for (const file of result.envFiles) console.log(`  ! ${file}  environment file present — keep it out of the published tree`);
        console.log(blocking.length ? `${blocking.length} possible secret(s) found in files that can be published.` : 'No secrets found in publishable files.');
    }
    process.exitCode = blocking.length ? 1 : 0;
}
