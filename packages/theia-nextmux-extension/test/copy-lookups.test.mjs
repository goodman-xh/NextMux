import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * A text lookup that meets a key it does not know (a new step, status, kind or error code arriving before its
 * words) must still answer with a string: throwing while rendering unmounted the whole window and left it blank
 * (语音转文字 had no step_* title). Every exported `(locale, key, …)` text helper is called here with an unknown
 * key in every language and in an unknown one.
 */
const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi', 'xx-UNKNOWN'];
const dir = new URL('../lib/browser/', import.meta.url);
const require = createRequire(import.meta.url);
// Some views import their stylesheet; in node that import is a no-op.
require('node:module')._extensions['.css'] = () => undefined;
globalThis.document ??= { documentElement: { style: {} }, createElement: () => ({ style: {}, classList: { add() {} } }) };
globalThis.window ??= { navigator: { userAgent: '' }, localStorage: { getItem: () => null } };
globalThis.Element ??= class Element {};
globalThis.DragEvent ??= class DragEvent {};
// The build emits CommonJS: `function name(locale, key, …)` exported as `exports.name = name`.
const helper = /^(?:function (\w+)\(locale, key\b|const (\w+) = \(locale, key\b)/gm;

// Only modules that still have a source (lib/ can hold stale output of removed files).
const sources = new Set(readdirSync(new URL('../src/browser/', import.meta.url)).map(file => file.replace(/\.tsx?$/, '')));
const files = readdirSync(dir).filter(file => file.endsWith('.js') && sources.has(file.slice(0, -3)));
const withHelpers = files.map(file => {
    const source = readFileSync(new URL(file, dir), 'utf8');
    const names = [...source.matchAll(helper)].map(match => match[1] || match[2]).filter(name => source.includes(`exports.${name} = ${name}`));
    return { file, names };
}).filter(entry => entry.names.length);

test('there are text helpers to check (the scan still matches the compiled output)', () => {
    assert.ok(withHelpers.length >= 40, `only ${withHelpers.length} modules with (locale, key) helpers were found`);
});

for (const { file, names } of withHelpers) {
    test(`text helpers in ${file} answer an unknown key with a string`, async () => {
        const module = require(new URL(file, dir).pathname);
        const problems = [];
        for (const name of names) {
            const lookup = module[name];
            if (typeof lookup !== 'function') { problems.push(`${name} is not exported as a function`); continue; }
            for (const locale of LOCALES) {
                try {
                    const text = lookup(locale, '__nmx_unknown_key__');
                    // A text, or a list of options (empty for a key it does not know).
                    if (typeof text !== 'string' && !Array.isArray(text)) problems.push(`${name}('${locale}', unknown key) returned ${typeof text}`);
                } catch (error) {
                    problems.push(`${name}('${locale}', unknown key) threw ${error instanceof Error ? error.message : error}`);
                }
            }
        }
        // One line per helper is enough to act on.
        assert.deepEqual([...new Set(problems.map(problem => problem.replace(/\('[^']+'/, '(…')))], [], `${file}`);
    });
}
