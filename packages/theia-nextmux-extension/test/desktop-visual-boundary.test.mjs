import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
const guardrailMarker = 'Desktop visual production guardrails';
const guardrailOffset = style.lastIndexOf(guardrailMarker);
assert.notEqual(guardrailOffset, -1, 'the base stylesheet must end with an explicit visual production contract');
const guardrails = style.slice(guardrailOffset);

test('text-entry focus keeps the resting border and exposes a non-frame keyboard cue', () => {
    assert.match(guardrails, /--nmx-composer-resting-border:\s*#343434;/);
    assert.match(guardrails, /\.nmx-shell\.nmx-theme-light\s*\{[\s\S]*?--nmx-composer-resting-border:\s*#e4e0dd;/);
    assert.match(guardrails, /#nextmux\\\.desktop\\\.widget \.nmx-shell :is\([\s\S]*?input:not\(\[type='checkbox'\]\)[\s\S]*?textarea,[\s\S]*?select[\s\S]*?\)\s*\{[\s\S]*?border-color:\s*var\(--nmx-border\) !important;[\s\S]*?outline:\s*0 !important;[\s\S]*?box-shadow:\s*none !important;/);
    assert.match(guardrails, /#nextmux\\\.desktop\\\.widget \.nmx-shell :is\([\s\S]*?textarea,[\s\S]*?select[\s\S]*?\):is\(:focus, :focus-visible\)\s*\{[\s\S]*?border-color:\s*var\(--nmx-border\) !important;[\s\S]*?outline:\s*0 !important;[\s\S]*?box-shadow:\s*none !important;/);
    assert.match(guardrails, /#nextmux\\\.desktop\\\.widget \.nmx-shell \.nmx-composer,[\s\S]*?\.nmx-composer:focus-within[\s\S]*?border-color:\s*var\(--nmx-composer-resting-border\) !important;[\s\S]*?outline:\s*0 !important;/);
    assert.match(guardrails, /label:has\(>\s*:is\(input, textarea, select\):focus-visible\)\s*>\s*span[\s\S]*?color:\s*var\(--nmx-text\) !important;/);
});

test('light compatible API drawer owns a warm readable control palette', () => {
    assert.match(guardrails, /\.nmx-shell\.nmx-theme-light \.nmx-official-sheet\s*\{[\s\S]*?color:\s*#252225 !important;[\s\S]*?background:\s*#f8f6f3 !important;[\s\S]*?border-color:\s*#e3ded9 !important;/);
    assert.match(guardrails, /\.nmx-shell\.nmx-theme-light \.nmx-official-sheet :is\(input, select, textarea\)\s*\{[\s\S]*?color:\s*#252225 !important;[\s\S]*?background:\s*#f2efec !important;[\s\S]*?border-color:\s*#e4e0dd !important;/);
    assert.match(guardrails, /\.nmx-shell\.nmx-theme-light \.nmx-official-sheet :is\([\s\S]*?\.nmx-saved-connections,[\s\S]*?\.nmx-official-form-actions[\s\S]*?\)\s*\{[\s\S]*?border-color:\s*#e3ded9 !important;/);
    assert.match(guardrails, /\.nmx-shell\.nmx-theme-light \.nmx-official-sheet \.nmx-primary-button\s*\{[\s\S]*?color:\s*#fff !important;[\s\S]*?background:\s*#2c282b !important;/);
});

test('right-side API drawers are anchored to the viewport in compact hosts', () => {
    assert.match(guardrails, /\.nmx-shell \.nmx-sheet-backdrop\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;/);
    assert.match(guardrails, /\.nmx-shell \.nmx-official-sheet\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-width:\s*0;/);
    assert.match(guardrails, /@media \(max-width:\s*760px\)[\s\S]*?\.nmx-shell \.nmx-official-sheet\s*\{[\s\S]*?width:\s*min\(520px, 100dvw\);[\s\S]*?max-width:\s*100dvw;/);
});

test('desktop typography and authored Markdown remain readable without horizontal page overflow', () => {
    assert.match(guardrails, /--nmx-ui-font:\s*-apple-system-body, ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui,[^;]*"PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei"/);
    assert.match(guardrails, /\.nmx-desktop-widget,[\s\S]*?body:has\(#nextmux\\\.desktop\\\.widget:not\(\.lm-mod-hidden\)\)[\s\S]*?font-family:\s*var\(--nmx-ui-font\) !important;/);
    assert.match(guardrails, /\.nmx-assistant-markdown :where\([\s\S]*?table,[\s\S]*?ul, ol,[\s\S]*?\)\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
    assert.match(guardrails, /\.nmx-assistant-markdown table\s*\{[\s\S]*?display:\s*block;[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*auto;/);
    assert.match(guardrails, /\.nmx-assistant-markdown pre\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow:\s*auto;/);
    assert.match(guardrails, /\.nmx-assistant-markdown :is\(pre, code, kbd, samp\)[\s\S]*?font-family:\s*var\(--nmx-code-font\) !important;/);
    assert.match(guardrails, /@media \(max-width:\s*760px\)[\s\S]*?\.nmx-official-sheet[\s\S]*?max-width:\s*100dvw;[\s\S]*?\.nmx-assistant-markdown[\s\S]*?max-width:\s*100%;/);
});
