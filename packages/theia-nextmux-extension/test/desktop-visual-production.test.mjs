import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const frontendModule = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-frontend-module.ts', import.meta.url)), 'utf8');
const productionStyle = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url)), 'utf8');
const widgetSource = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');

test('desktop production visual contracts load after the legacy stylesheet', () => {
    assert.match(
        frontendModule,
        /import '\.\.\/\.\.\/src\/browser\/style\/nextmux\.css';[\s\S]*?import '\.\.\/\.\.\/src\/browser\/style\/nextmux-desktop-production\.css';/
    );
});

test('keyboard focus stays visible without reintroducing the composer focus border', () => {
    assert.match(productionStyle, /\.nmx-shell\s*\{[\s\S]*?--nmx-composer-resting-border:\s*#343434;/);
    assert.match(productionStyle, /\.nmx-shell\.nmx-theme-light\s*\{[\s\S]*?--nmx-composer-resting-border:\s*#e4e0dd;/);
    assert.match(productionStyle, /\.nmx-desktop-widget \.nmx-shell :is\([\s\S]*?\):focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--nmx-focus-ring\)[\s\S]*?outline-offset:\s*2px/);
    assert.match(productionStyle, /\.nmx-model-effort-portal :is\([\s\S]*?button,[\s\S]*?\):focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--nmx-focus-ring\) !important;/);
    assert.match(productionStyle, /\.nmx-desktop-widget \.nmx-shell \.nmx-composer,[\s\S]*?\.nmx-desktop-widget \.nmx-shell \.nmx-composer:focus-within,[\s\S]*?\.nmx-desktop-widget \.nmx-shell \.nmx-composer:has\(textarea:focus-visible\)\s*\{[\s\S]*?border-color:\s*var\(--nmx-composer-resting-border\) !important;[\s\S]*?outline:\s*0 !important;[\s\S]*?box-shadow:\s*none !important;/);
    assert.doesNotMatch(productionStyle, /--nmx-(?:composer|control)-focus-elevation:/,
        'focus must not draw a white or grey frame around any text entry surface');
    assert.match(productionStyle, /input:not\(\[type='checkbox'\]\)[\s\S]*?textarea,[\s\S]*?select[\s\S]*?:is\(:focus, :focus-visible\)[\s\S]*?border-color:\s*var\(--nmx-border\) !important;[\s\S]*?outline:\s*0 !important;[\s\S]*?box-shadow:\s*none !important;/);
    const textFocusRule = productionStyle.match(/\.nmx-desktop-widget \.nmx-shell :is\([\s\S]*?\):is\(:focus, :focus-visible\)\s*\{[\s\S]*?\}/)?.[0] || '';
    assert.doesNotMatch(textFocusRule, /background(?:-color)?:/, 'focusing an input must not change its light or dark surface');
    assert.doesNotMatch(productionStyle, /:not\(\[aria-invalid='true'\]\)/,
        'validation state must not restore a focus-only border around text controls');
    assert.doesNotMatch(widgetSource, /aria-invalid=\{Boolean\(this\.officialConnectionError\)\}/,
        'a connection-level failure must not mark every compatible API field invalid');
    assert.match(productionStyle, /label:has\(>\s*:is\(input, textarea, select\):focus-visible\)\s*>\s*span[\s\S]*?color:\s*var\(--nmx-text\) !important;/);
    assert.match(productionStyle, /\.nmx-desktop-widget \.nmx-shell \.nmx-model-picker-search:has\(input:focus-visible\)[\s\S]*?border-color:\s*var\(--nmx-border\) !important;[\s\S]*?box-shadow:\s*none !important;/);
    assert.match(productionStyle, /\.nmx-topup-amount-field:focus-within[\s\S]*?border-color:\s*var\(--nmx-border\) !important;[\s\S]*?outline:\s*0 !important;[\s\S]*?box-shadow:\s*none !important;/);
    assert.match(productionStyle, /\.nmx-turn-edit-restore > input:focus-visible[\s\S]*?outline:\s*0 !important;/);
    assert.match(productionStyle, /\[role='separator'\]:focus-visible[\s\S]*?outline:\s*2px solid var\(--nmx-focus-ring\) !important/);
});

test('desktop typography uses native UI fonts with CJK fallbacks while code and terminal surfaces stay monospaced', () => {
    assert.match(productionStyle, /--nmx-ui-font:\s*-apple-system-body, ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui,[^;]*"Segoe UI"[^;]*"PingFang SC"[^;]*"Microsoft YaHei UI"[^;]*sans-serif[^;]*!important;/);
    assert.match(productionStyle, /body:has\(#nextmux\\\.desktop\\\.widget:not\(\.lm-mod-hidden\)\),[\s\S]*?\.nmx-model-effort-portal,[\s\S]*?font-family:\s*var\(--nmx-ui-font\) !important;/);
    assert.match(productionStyle, /\.nmx-assistant-markdown :where\([\s\S]*?ul, ol, li, blockquote,[\s\S]*?table, thead, tbody, tfoot, tr, th, td, details, summary[\s\S]*?font-family:\s*var\(--nmx-ui-font\) !important;/);
    assert.match(productionStyle, /\.nmx-assistant-markdown :is\(pre, code, kbd, samp\)[\s\S]*?font-family:\s*var\(--nmx-code-font\) !important;/);
    const codeFont = productionStyle.match(/--nmx-code-font:\s*([^;]+?)\s*!important;/)?.[1];
    assert.match(codeFont, /^ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas,[\s\S]*?"PingFang SC", "Microsoft YaHei UI", monospace$/);
    assert.equal(widgetSource.match(/NEXTMUX_TERMINAL_FONT_FAMILY\s*=\s*'([^']+)'/)?.[1], codeFont,
        'terminal and rendered code use the same native monospace stack with CJK fallbacks');
    assert.match(widgetSource, /fontFamily:\s*'ui-monospace, "SFMono-Regular", "SF Mono", Menlo,[\s\S]*?"PingFang SC", "Microsoft YaHei UI", monospace'/, 'Monaco uses the same code stack');
});

test('light direct-API drawer uses a warm readable palette instead of dark-theme controls', () => {
    assert.match(productionStyle, /\.nmx-shell\.nmx-theme-light \.nmx-purchase-sheet\s*\{[\s\S]*?color:\s*var\(--nmx-text\) !important;[\s\S]*?background:\s*var\(--nmx-dialog-background\) !important;/);
    assert.match(productionStyle, /\.nmx-shell\.nmx-theme-light \.nmx-official-sheet :is\(input, select\)\s*\{[\s\S]*?color:\s*var\(--nmx-text\) !important;[\s\S]*?background:\s*#f2efec !important;/);
    assert.match(productionStyle, /\.nmx-shell\.nmx-theme-light \.nmx-official-sheet \.nmx-official-form-actions button\.nmx-primary-button\s*\{[\s\S]*?color:\s*#fff !important;[\s\S]*?background:\s*#2c282b !important;/);
    assert.match(productionStyle, /\.nmx-shell\.nmx-theme-light \.nmx-official-sheet \.nmx-connection-message\s*\{[\s\S]*?background:\s*#e7f2ed !important;/);
    assert.match(productionStyle, /\.nmx-shell\.nmx-theme-light \.nmx-official-sheet \.nmx-purchase-error,[\s\S]*?background:\s*#f8e9ea !important;/);
});

test('compatible API drawer traps keyboard focus and restores the opening control', () => {
    assert.match(widgetSource, /protected officialProviderTrigger:\s*HTMLElement \| undefined/);
    assert.match(widgetSource, /protected openOfficialProvider[\s\S]*?document\.activeElement instanceof HTMLElement[\s\S]*?officialProviderTrigger/);
    assert.match(widgetSource, /className='nmx-purchase-sheet nmx-official-sheet'[\s\S]*?onKeyDown=\{event => this\.trapDialogFocus\(event\)\}/);
    assert.match(widgetSource, /protected clearOfficialProviderSurface\(restoreFocus = false\)[\s\S]*?trigger\?\.isConnected[\s\S]*?trigger\.focus\(\)/);
    assert.match(widgetSource, /officialProviderSheet && this\.officialConnectionStage === 'idle'\)[\s\S]*?this\.clearOfficialProviderSurface\(true\)/);
    assert.match(widgetSource, /protected navigateBack\(\): void \{[\s\S]*?const officialProviderTrigger[\s\S]*?officialProviderTrigger\.focus\(\)/);
});

test('themes own native controls and every non-comic floating surface is viewport bounded', () => {
    assert.match(productionStyle, /\.nmx-shell\s*\{[\s\S]*?color-scheme:\s*dark;/);
    assert.match(productionStyle, /\.nmx-shell\.nmx-theme-light\s*\{[\s\S]*?color-scheme:\s*light;/);
    assert.match(productionStyle, /\.nmx-shell :where\([\s\S]*?\.nmx-header-popover,[\s\S]*?\.nmx-model-picker-popover[\s\S]*?\)\s*\{[\s\S]*?overscroll-behavior:\s*contain;/);
    assert.match(productionStyle, /\.nmx-model-effort-portal \.nmx-model-effort-menu\s*\{[\s\S]*?max-width:\s*calc\(100dvw - 16px\);[\s\S]*?max-height:\s*calc\(100dvh - 16px\);[\s\S]*?overscroll-behavior:\s*contain;/);
    assert.match(productionStyle, /\.nmx-dialog-backdrop:not\(:has\(> :is\([\s\S]*?\.nmx-comic-create-sheet,[\s\S]*?\.nmx-comic-character-sheet,[\s\S]*?\.nmx-comic-export-sheet[\s\S]*?\)\)\)\s*\{[\s\S]*?overflow:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/);
    assert.match(productionStyle, /\.nmx-dialog-backdrop > :where\([\s\S]*?\.nmx-thread-dialog,[\s\S]*?\.nmx-permission-sheet:not\(\.nmx-comic-create-sheet\):not\(\.nmx-comic-character-sheet\)[\s\S]*?\)[\s\S]*?max-height:\s*calc\(100dvh - 32px\);[\s\S]*?overflow:\s*auto;/);
    assert.match(productionStyle, /\.nmx-sheet-backdrop:not\(\.nmx-dialog-backdrop\) > :where\([\s\S]*?\.nmx-diff-sheet,[\s\S]*?\.nmx-purchase-sheet[\s\S]*?\)[\s\S]*?max-width:\s*100dvw;[\s\S]*?max-height:\s*100dvh;/);
});

test('narrow windows keep menus, settings, drawers, and terminal controls reachable', () => {
    assert.match(productionStyle, /\.nmx-shell:has\(\.nmx-terminal-drawer\.is-open\) \.nmx-work-context\s*\{[\s\S]*?bottom:\s*0;/);
    assert.match(productionStyle, /@media \(max-width: 760px\)\s*\{[\s\S]*?#theia\\:menubar > \.lm-MenuBar-content[\s\S]*?overflow-x:\s*auto !important;/);
    assert.match(productionStyle, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.nmx-settings-page\s*\{[\s\S]*?padding-inline:\s*16px;[\s\S]*?\.nmx-settings-page label[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
    assert.match(productionStyle, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.nmx-work-context\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?width:\s*calc\(100% - 8px\);/);
    assert.match(productionStyle, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.nmx-terminal-layout[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 6px clamp\(120px, 28vw, 176px\);/);
    assert.match(productionStyle, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.nmx-official-sheet \.nmx-saved-connections article[\s\S]*?grid-template-columns:\s*8px minmax\(0, 1fr\);/);
    assert.match(productionStyle, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.nmx-official-sheet \.nmx-connection-actions[\s\S]*?grid-column:\s*2;[\s\S]*?flex-wrap:\s*wrap;/);
    assert.match(productionStyle, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.nmx-official-sheet \.nmx-official-form > label[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
    assert.match(productionStyle, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.nmx-official-sheet \.nmx-official-form-actions[\s\S]*?align-items:\s*stretch;[\s\S]*?flex-direction:\s*column;/);
});

test('locale changes preserve authored history and bidi layout follows each message', () => {
    // The translator walks through nextmux-surface-walk, which rejects literal subtrees wholesale.
    assert.match(widgetSource, /forEachSurfaceTextNode\(/);
    // The literal selector is now composed: content subtrees (starting with [data-nmx-literal]) plus typed fields.
    const surfaceWalk = readFileSync(new URL('../src/browser/nextmux-surface-walk.ts', import.meta.url), 'utf8');
    assert.match(surfaceWalk, /SURFACE_CONTENT_SELECTOR = '\[data-nmx-literal\]/);
    assert.match(surfaceWalk, /SURFACE_LITERAL_SELECTOR = `\$\{SURFACE_CONTENT_SELECTOR\}/);
    assert.match(widgetSource, /protected renderUserMessage\(value: string, turnId: string\)/);
    assert.match(widgetSource, /renderUserMessage\(publicTurn\.prompt, turn\.id\)/);
    assert.match(widgetSource, /const picked = [\s\S]*?parseAppControlMarker\(message\.content\)[\s\S]*?<span data-nmx-literal>\{this\.renderThreadText\(picked\.text, turnId, 'steering'\)/);
    assert.match(widgetSource, /className='nmx-gateway-content' data-nmx-literal[\s\S]*?\{this\.renderAssistantOutput\(\s*response/);
    assert.match(widgetSource, /this\.node\.dir = this\.desktopLocale === 'ar' \? 'rtl' : 'ltr';/);
    assert.match(productionStyle, /\.nmx-desktop-widget \[data-nmx-literal\][\s\S]*?unicode-bidi:\s*plaintext;/);
    assert.match(productionStyle, /body:has\(#nextmux\\\.desktop\\\.widget:not\(\.lm-mod-hidden\)\[dir='rtl'\]\) :where\([\s\S]*?\.nmx-model-effort-menu,[\s\S]*?\.lm-Menu-content[\s\S]*?\)[\s\S]*?direction:\s*rtl;/);
    assert.match(productionStyle, /\.nmx-user-message\s*\{[\s\S]*?margin-inline-start:\s*auto;/);
    assert.match(productionStyle, /\.nmx-user-message-actions\s*\{[\s\S]*?inset-inline-end:\s*0;/);
});

test('long prose fades without clipping and compact drawer controls never shrink away', () => {
    assert.match(productionStyle, /\.nmx-desktop-widget :where\([\s\S]*?\.nmx-literal-content,[\s\S]*?\.nmx-gateway-content,[\s\S]*?\.nmx-assistant-markdown[\s\S]*?\)\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow-wrap:\s*anywhere;/);
    assert.match(productionStyle, /\.nmx-message-fade\s*\{[\s\S]*?pointer-events:\s*none;[\s\S]*?background:\s*linear-gradient\(180deg, transparent, var\(--nmx-message-fade-bg\)\);/);
    assert.match(productionStyle, /\.nmx-workspace-controls :where\(button\)\s*\{[\s\S]*?flex:\s*0 0 auto;/);
    assert.match(productionStyle, /\.nmx-shell :where\(\.nmx-work-context, \.nmx-terminal-drawer\) > header :where\(button\)\s*\{[\s\S]*?flex:\s*0 0 auto;/);
    assert.match(productionStyle, /\.nmx-shell\.is-titlebar-crowded :is\(\.nmx-titlebar-primary-nav, \.nmx-coding-topbar \.nmx-workspace-controls\)\s*\{[\s\S]*?display:\s*none !important;/);
    assert.match(productionStyle, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.nmx-shell \.nmx-composer-wrap[\s\S]*?width:\s*min\(730px, calc\(100% - 24px\)\);/);
    assert.match(widgetSource, /protected isTitlebarCrowded\(/);
    assert.match(widgetSource, /target\.classList\.add\('is-scrolling'\)/);
});
