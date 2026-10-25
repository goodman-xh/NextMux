import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { COMIC_DESK_LOCALES } from '../lib/browser/nextmux-comic-desk.js';
import { batchText, COMIC_CANVAS_BATCH_LOCALES } from '../lib/browser/nextmux-comic-canvas-batch-text.js';
import { panelText, COMIC_CANVAS_PANEL_LOCALES } from '../lib/browser/nextmux-comic-canvas-panels-text.js';
import { toolText, COMIC_CANVAS_TOOL_LOCALES } from '../lib/browser/nextmux-comic-canvas-tools-text.js';
import { storyboardText, COMIC_CANVAS_STORYBOARD_LOCALES } from '../lib/browser/nextmux-comic-canvas-storyboard-text.js';

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

function readCopyTables(fileName, keyTypeName) {
    const source = ts.createSourceFile(fileName,
        readFileSync(new URL(`../src/browser/${fileName}`, import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declarations = new Map(source.statements.filter(ts.isVariableStatement)
        .flatMap(statement => statement.declarationList.declarations).map(declaration => [declaration.name.text, declaration]));
    const aliasType = name => source.statements.find(statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === name)?.type;
    const expandKeys = (type, seen = new Set()) => {
        if (ts.isUnionTypeNode(type)) return type.types.flatMap(member => expandKeys(member, seen));
        if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) return [type.literal.text];
        if (ts.isTypeReferenceNode(type)) {
            const name = type.typeName.getText(source), target = aliasType(name);
            assert.ok(target && !seen.has(name), `${fileName} has literal copy keys`);
            return expandKeys(target, new Set([...seen, name]));
        }
        assert.fail(`${fileName} has literal copy keys`);
    };
    const keyType = aliasType(keyTypeName);
    assert.ok(keyType && ts.isUnionTypeNode(keyType), `${fileName} declares its copy keys`);
    const declaredKeys = expandKeys(keyType).sort();
    // A module may split its copy across several per-locale tables (base and layout keys).
    const dictionaries = [...declarations.values()].filter(declaration => /(^|_)TEXT$/u.test(declaration.name.text)
        && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer));
    assert.ok(dictionaries.length, `${fileName} has an explicit locale dictionary`);
    const localesOf = dictionary => dictionary.initializer.properties.map(property => property.name.text).sort();
    const locales = localesOf(dictionaries[0]);
    assert.equal(new Set(locales).size, locales.length, `${fileName} declares each locale once`);
    for (const dictionary of dictionaries.slice(1)) assert.deepEqual(localesOf(dictionary), locales, `${fileName} declares each locale in every table`);

    // Read each locale's own literal table: runtime fallback must not hide missing translations.
    const tables = new Map();
    for (const dictionary of dictionaries) for (const property of dictionary.initializer.properties) {
        assert.ok(ts.isPropertyAssignment(property), `${fileName} has explicit locale tables`);
        const table = ts.isIdentifier(property.initializer) ? declarations.get(property.initializer.text)?.initializer : property.initializer;
        assert.ok(table && ts.isObjectLiteralExpression(table), `${fileName}.${property.name.text} has a literal table`);
        const entries = tables.get(property.name.text) ?? [];
        entries.push(...table.properties.map(entry => {
            assert.ok(ts.isPropertyAssignment(entry) && ts.isStringLiteral(entry.initializer), `${fileName}.${property.name.text} has literal copy`);
            return [entry.name.text, entry.initializer.text];
        }));
        tables.set(property.name.text, entries);
    }
    assert.equal(tables.size, locales.length, `${fileName} declares each locale once`);
    return { declaredKeys, tables };
}

const modules = [
    { name: 'batch', fileName: 'nextmux-comic-canvas-batch-text.ts', keyTypeName: 'BatchTextKey', lookup: batchText, locales: COMIC_CANVAS_BATCH_LOCALES },
    { name: 'panel', fileName: 'nextmux-comic-canvas-panels-text.ts', keyTypeName: 'PanelTextKey', lookup: panelText, locales: COMIC_CANVAS_PANEL_LOCALES },
    { name: 'tool', fileName: 'nextmux-comic-canvas-tools-text.ts', keyTypeName: 'ToolTextKey', lookup: toolText, locales: COMIC_CANVAS_TOOL_LOCALES },
    { name: 'storyboard', fileName: 'nextmux-comic-canvas-storyboard-text.ts', keyTypeName: 'StoryboardTextKey', lookup: storyboardText, locales: COMIC_CANVAS_STORYBOARD_LOCALES }
].map(module => ({ ...module, ...readCopyTables(module.fileName, module.keyTypeName) }));

for (const { name, lookup, locales, declaredKeys, tables } of modules) {
    test(`${name} copy provides every key explicitly in every desk language`, () => {
        const expectedLocales = [...COMIC_DESK_LOCALES].sort();
        assert.equal(expectedLocales.length, 12, 'all 12 interface languages are covered');
        assert.deepEqual([...locales].sort(), expectedLocales, `${name} runtime locales match the desk`);
        assert.deepEqual([...tables.keys()].sort(), expectedLocales, `${name} source locales match the desk`);
        for (const [locale, entries] of tables) {
            assert.deepEqual(entries.map(([key]) => key).sort(), declaredKeys, `${name}.${locale} has each key exactly once`);
            for (const [key, text] of entries) {
                assert.ok(text.trim(), `${name}.${locale}.${key} is not empty`);
                assert.equal(lookup(locale, key), text, `${name}.${locale}.${key} uses its own translation`);
            }
        }
    });

    test(`${name} translations preserve the zh-CN placeholder multisets`, () => {
        const reference = new Map(tables.get('zh-CN'));
        for (const [locale, entries] of tables) {
            for (const [key, text] of entries) {
                assert.deepEqual(placeholders(text), placeholders(reference.get(key)), `${name}.${locale}.${key} placeholders`);
            }
        }
    });

    test(`${name} interpolation replaces every occurrence and preserves unresolved placeholders`, () => {
        for (const [locale, entries] of tables) {
            for (const [key, text] of entries) {
                const values = Object.fromEntries(placeholders(text).map(placeholder => [placeholder, `value_${placeholder}`]));
                assert.equal(lookup(locale, key, values), text.replace(/\{(\w+)\}/g, (_, placeholder) => values[placeholder]), `${name}.${locale}.${key} interpolation`);
                assert.equal(lookup(locale, key, {}), text, `${name}.${locale}.${key} unresolved placeholders`);
                const numericValues = Object.fromEntries(placeholders(text).map(placeholder => [placeholder, 0]));
                assert.equal(lookup(locale, key, numericValues), text.replace(/\{\w+\}/g, '0'), `${name}.${locale}.${key} accepts zero`);
            }
        }
    });

    test(`${name} lookups fall back to English or Chinese and return unknown keys without throwing`, () => {
        for (const [key, text] of tables.get('en')) {
            assert.equal(lookup('xx-UNKNOWN', key), text, `${name}.${key} falls back to English`);
        }
        for (const [key, text] of tables.get('zh-CN')) {
            assert.equal(lookup('zh-Hans', key), text, `${name}.${key} falls back to zh-CN`);
        }
        const unknownKey = `__nmx_unknown_canvas_${name}_key__`;
        for (const locale of [...COMIC_DESK_LOCALES, 'xx-UNKNOWN', 'zh-Hans']) {
            assert.doesNotThrow(() => {
                assert.equal(lookup(locale, unknownKey), unknownKey, `${name}.${locale} returns the unknown key itself`);
            }, `${name}.${locale} does not throw for an unknown key`);
        }
    });
}

test('batch naming-template hints retain the literal template tokens in every language', () => {
    const { tables } = modules.find(module => module.name === 'batch');
    for (const [locale, entries] of tables) {
        const text = new Map(entries).get('templateHint');
        assert.ok(text.includes('{prefix}{index}{suffix}{prompt}'), `${locale} shows the literal naming template`);
        assert.deepEqual(placeholders(text), ['index', 'prefix', 'prompt', 'prompt', 'suffix'], `${locale} retains both prompt references`);
        assert.equal(batchText(locale, 'templateHint'), text, `${locale} leaves template tokens visible without values`);
    }
});

test('tool translations retain file formats and colour-processing terms', () => {
    const { tables } = modules.find(module => module.name === 'tool');
    const technicalTerms = ['LUT', 'CRF', 'GIF', 'WebP', 'WAV', 'PNG', 'JPEG', '.cube'];
    const reference = new Map(tables.get('zh-CN'));
    for (const [locale, entries] of tables) {
        for (const [key, text] of entries) {
            for (const term of technicalTerms.filter(term => reference.get(key).includes(term))) {
                assert.ok(text.includes(term), `${locale}.${key} retains ${term}`);
            }
        }
    }
});

test('Arabic tool and storyboard copy leaves text direction to the interface', () => {
    for (const { name, tables } of modules.filter(module => ['tool', 'storyboard'].includes(module.name))) {
        for (const [key, text] of tables.get('ar')) {
            assert.doesNotMatch(text, /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u, `${name}.ar.${key} has no direction controls`);
        }
    }
});
