import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { canvasText, canvasIssueText, COMIC_CANVAS_LOCALES } from '../lib/browser/nextmux-comic-canvas-text.js';

const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const source = ts.createSourceFile('canvas-text.ts', readFileSync(new URL('../src/browser/nextmux-comic-canvas-text.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declarations = new Map(source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => statement.declarationList.declarations).map(declaration => [declaration.name.text, declaration]));
const keyType = source.statements.find(statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'CanvasTextKey');
const declaredKeys = keyType.type.types.map(type => type.literal.text).sort();

// Read each locale's own literal table: runtime fallback must not hide missing translations.
const tables = new Map(declarations.get('TEXT').initializer.properties.map(property => {
    assert.ok(ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer));
    const table = declarations.get(property.initializer.text).initializer;
    assert.ok(ts.isObjectLiteralExpression(table), `${property.name.text} has a literal table`);
    return [property.name.text, table.properties.map(entry => {
        assert.ok(ts.isPropertyAssignment(entry) && ts.isStringLiteral(entry.initializer), `${property.name.text} has literal copy`);
        return [entry.name.text, entry.initializer.text];
    })];
}));

test('canvas copy provides every key explicitly in all 12 interface languages', () => {
    assert.deepEqual([...COMIC_CANVAS_LOCALES].sort(), [...LOCALES].sort());
    assert.deepEqual([...tables.keys()].sort(), [...LOCALES].sort());
    assert.ok(declaredKeys.length > 150, 'all canvas key families are covered');
    for (const [locale, entries] of tables) {
        assert.deepEqual(entries.map(([key]) => key).sort(), declaredKeys, `${locale} has each key exactly once`);
        for (const [key, text] of entries) {
            assert.ok(text.trim(), `${locale}.${key} is not empty`);
            assert.equal(canvasText(locale, key), text, `${locale}.${key} uses its own translation`);
        }
    }
});

test('every canvas translation preserves the zh-CN placeholders', () => {
    const reference = new Map(tables.get('zh-CN'));
    for (const [locale, entries] of tables) {
        for (const [key, text] of entries) {
            assert.deepEqual(placeholders(text), placeholders(reference.get(key)), `${locale}.${key} placeholders`);
        }
    }
});

test('canvas interpolation replaces every placeholder and preserves unresolved ones', () => {
    for (const [locale, entries] of tables) {
        for (const [key, text] of entries) {
            const values = Object.fromEntries(placeholders(text).map(name => [name, `value_${name}`]));
            assert.equal(canvasText(locale, key, values), text.replace(/\{(\w+)\}/g, (_, name) => values[name]), `${locale}.${key}`);
            assert.equal(canvasText(locale, key, {}), text, `${locale}.${key} unresolved placeholders`);
        }
        assert.ok(canvasText(locale, 'seconds', { n: 0 }).includes('0'), `${locale} accepts zero`);
        assert.equal(canvasText(locale, 'version', { i: 1, n: 4 }), '1/4', `${locale} version numbers`);
    }
});

test('canvas issues interpolate localized input roles in every language', () => {
    for (const locale of LOCALES) {
        const role = canvasText(locale, 'role.referenceImage');
        assert.equal(canvasIssueText(locale, { code: 'INPUT_REQUIRED', path: 'inputs.referenceImage' }),
            canvasText(locale, 'issue.INPUT_REQUIRED', { role }), `${locale} input role`);
        assert.equal(canvasIssueText(locale, { code: 'PARAMETER_INVALID', path: 'duration' }),
            canvasText(locale, 'issue.PARAMETER_INVALID', { path: 'duration' }), `${locale} parameter path`);
    }
    assert.equal(canvasText('unknown-locale', 'generate'), canvasText('en', 'generate'));
    assert.equal(canvasText('zh-Hans', 'generate'), canvasText('zh-CN', 'generate'));
});
