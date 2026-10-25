import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { formatModelError, redactModelErrorDetail, MODEL_ERROR_LOCALES } from '@nextmux/model-runtime/errors';
import { desktopFailureMessage, agentOutcomeText } from '../lib/browser/nextmux-agent-outcome-locale.js';

const require = createRequire(import.meta.url), React = require('react');
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
function source(name, extension = 'ts') { return readFileSync(new URL(`../src/browser/${name}.${extension}`, import.meta.url), 'utf8'); }
function compile(text, deps = {}) {
    const exports = {};
    const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    new Function('exports', ...Object.keys(deps), code)(exports, ...Object.values(deps));
    return exports;
}
function component(name, functionName) {
    const text = source(name, 'tsx'), parsed = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === functionName);
    return compile(node.getText(parsed), { React })[functionName];
}
const StreamNotice = component('nextmux-conversation-stream', 'StreamNotice');
const MediaDiagnostic = component('nextmux-media-diagnostics', 'MediaDiagnostic');
const localRequire = createRequire(new URL('../lib/browser/nextmux-model-errors.js', import.meta.url));
const errors = compile(source('nextmux-model-errors'), { require: localRequire });
const streamSource = source('nextmux-conversation-stream-model');
const streamParsed = ts.createSourceFile('stream-model.ts', streamSource, ts.ScriptTarget.Latest, true);
const selected = streamParsed.statements.filter(node => node.name?.text === 'conversationErrorText'
    || ts.isVariableStatement(node) && ['localizedOutcomeKeys', 'scripts'].includes(node.declarationList.declarations[0].name.getText(streamParsed)));
const { conversationErrorText } = compile(selected.map(node => node.getText(streamParsed)).join('\n'), {
    formatModelError, redactModelErrorDetail, desktopFailureMessage, agentOutcomeText, modelFailureText: errors.modelFailureText
});

test('real stream error card shows its reason/action and never renders raw details or a tooltip', () => {
    const props = { tone: 'error', locale: 'zh-CN', text: '余额不足，请充值后继续。', detail: 'PRIVATE_DIAGNOSTIC_RAW 401',
        action: React.createElement('button', null, '充值') };
    const html = renderToStaticMarkup(React.createElement(StreamNotice, props));
    assert.match(html, /余额不足，请充值后继续/);
    assert.match(html, /充值/);
    assert.doesNotMatch(html, /PRIVATE_DIAGNOSTIC_RAW|<pre|<details|title=/);
    assert.equal(props.detail, 'PRIVATE_DIAGNOSTIC_RAW 401', 'the owner retains diagnostic data');
});

test('shared comic/media diagnostic component hides details without mutating the owner record', () => {
    const props = { locale: 'en', detail: 'PRIVATE_DIAGNOSTIC_RAW upstream_timeout' };
    assert.equal(renderToStaticMarkup(React.createElement(MediaDiagnostic, props)), '');
    assert.equal(props.detail, 'PRIVATE_DIAGNOSTIC_RAW upstream_timeout');
});

test('all locales show classified reasons while retaining original code/detail for local diagnosis', () => {
    const value = { kind: 'content_refused', code: 'POLICY_BLOCKED_RAW', detail: 'POLICY_BLOCKED_RAW PRIVATE_DIAGNOSTIC_RAW',
        providerReason: 'POLICY_BLOCKED_RAW PRIVATE_DIAGNOSTIC_RAW', parameter: 'internal_parameter_raw', source: 'own_api' };
    const before = structuredClone(value);
    for (const locale of MODEL_ERROR_LOCALES) {
        const diagnostic = errors.modelFailure(locale, value);
        assert.match(diagnostic.detail, /PRIVATE_DIAGNOSTIC_RAW/);
        assert.equal(diagnostic.code, value.code);
        for (const text of [errors.modelFailureText(locale, value), conversationErrorText(locale, value)]) {
            assert.ok(text.trim());
            assert.doesNotMatch(text, /POLICY_BLOCKED_RAW|PRIVATE_DIAGNOSTIC_RAW|internal_parameter_raw/);
        }
    }
    assert.deepEqual(value, before);
});

test('unknown technical codes stay out of sentence copy and widget/director cards do not append them', () => {
    assert.doesNotMatch(conversationErrorText('en', { code: 'WeirdProviderFault', message: 'WeirdProviderFault' }), /WeirdProviderFault/);
    for (const source of ['relay', 'own_api', 'local']) {
        assert.doesNotMatch(errors.modelFailureText('en', { kind: 'unknown', source,
            code: 'WeirdProviderFault', providerReason: 'WeirdProviderFault PRIVATE_DIAGNOSTIC_RAW', parameter: 'internal_parameter_raw' }),
            /WeirdProviderFault|PRIVATE_DIAGNOSTIC_RAW|internal_parameter_raw/);
    }
    const widget = source('nextmux-desktop-widget', 'tsx');
    assert.doesNotMatch(widget, /title=\{run\.failure\?\.detail\}|<code[^>]*>\{receipt\.failure\.code\}|detail=\{displayErrorDetail\}/);
    assert.doesNotMatch(widget, /storyRun\.status[^;]*failure\.detail/);
    assert.doesNotMatch(source('nextmux-comic-director', 'tsx'), /setError\([^;]*failure[^;]*\.code/);
});
