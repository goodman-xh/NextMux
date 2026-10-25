import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = relativePath => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
const source = read('../src/browser/nextmux-desktop-widget.tsx');
const contribution = read('../src/browser/nextmux-desktop-contribution.ts');
const menuLocale = read('../src/browser/nextmux-product-menu-locale.ts');
const style = read('../src/browser/style/nextmux.css');

test('NextMux brand button opens only the trusted website', () => {
    const brandButton = source.match(/<button className='nmx-context-product'[\s\S]*?<\/button>/)?.[0] ?? '';
    assert.match(brandButton, /onClick=\{\(\) => this\.commandOpenWebsite\(\)\}/);
    assert.match(brandButton, /this\.renderBrandMark\(\)/);
    assert.doesNotMatch(brandButton, /toggleCodingPopover\('product'\)/);
    assert.doesNotMatch(brandButton, /aria-expanded=/);
    assert.doesNotMatch(brandButton, /codicon-chevron-down/);
    assert.doesNotMatch(source, /codingPopover === 'product' && <section className='nmx-header-popover nmx-product-popover'>/);
    assert.match(source, /commandOpenWebsite\(\): void[\s\S]*?openExternalUrl\('https:\/\/nextmux\.app'\)/);
});

test('sidebar, empty state and first-launch setup reuse one NextMux logo (the last frame of the launch animation)', () => {
    assert.equal((source.match(/protected renderBrandMark\(/g) || []).length, 1);
    assert.match(source, /renderBrandMark\(className\?: string\)[\s\S]*?nmx-brand-logo/);
    assert.match(source, /nmx-empty-brand-mark'>\{this\.renderBrandMark\('nmx-empty-brand-svg'\)\}<\/span>/);
    assert.match(style, /\.nmx-brand-logo \{[^}]*url\('\.\/brand\/nextmux-logo\.png'\)/);
    assert.ok(readFileSync(fileURLToPath(new URL('../src/browser/style/brand/nextmux-logo.png', import.meta.url))).length > 1000);
    assert.doesNotMatch(source, /M9\.2 9h2\.5c2\.6 0 3\.5 1\.15/, 'the retired mark is gone');
});

test('File, Edit, View, and Help menu labels are live-locale driven', () => {
    assert.match(contribution, /registerProductMenuLabels\([\s\S]*?CommonMenus\.FILE, 'file'[\s\S]*?CommonMenus\.EDIT, 'edit'[\s\S]*?CommonMenus\.VIEW, 'view'[\s\S]*?CommonMenus\.HELP, 'help'/);
    for (const key of ['file', 'edit', 'view', 'help']) {
        assert.match(menuLocale, new RegExp(`(?:^|[,{]\\s*)${key}:`));
    }
    assert.match(contribution, /registerSubmenu\(\[\.\.\.path\], productMenuText\(locale, key\)\)/);
    assert.match(contribution, /handleProductMenuLocaleChange[\s\S]*?configureProductMenus\(locale, true\)/);
});

test('editing and workbench commands use context-aware NextMux handlers', () => {
    for (const command of ['undo', 'redo', 'cut', 'copy', 'paste']) {
        assert.match(contribution, new RegExp(`NextMuxCommands\\.${command}[\\s\\S]*?canRunEditingCommand\\(key\\)`));
        assert.match(contribution, new RegExp(`commandId: NextMuxCommands\\.${command}\\.id`));
    }
    for (const command of ['saveFile', 'findConversation', 'terminal', 'browser']) {
        assert.match(contribution, new RegExp(`canRunDesktopContextCommand\\('${command}'\\)`));
    }
    assert.doesNotMatch(contribution, /commandId: 'core\.(?:undo|redo|cut|copy|paste)'/);
    assert.match(contribution, /NextMuxCommands\.settings[\s\S]*?widget\.commandOpenSettings\(\)/);
});

test('product menu styling uses semantic tokens in both themes and stays bounded', () => {
    assert.match(style, /\.nmx-desktop-widget \{[\s\S]*?--nmx-menu-background:/);
    assert.match(style, /\.nmx-desktop-widget \{[\s\S]*?--nmx-menu-border:/);
    assert.match(style, /body:has\([^\n]+nmx-theme-light\)[\s\S]*?--nmx-menu-background:/);
    assert.match(style, /body:has\(#nextmux\\\.desktop\\\.widget:not\(\.lm-mod-hidden\)\) \.lm-Menu[\s\S]*?background:\s*var\(--nmx-menu-background\)/);
    assert.match(style, /\.lm-Menu-content \{[\s\S]*?max-height:\s*min\(420px, calc\(100dvh - 56px\)\)/);
    assert.match(style, /\.lm-Menu-item \+ \.lm-Menu-item\.lm-mod-separator/);
    assert.match(style, /\.lm-Menu-item\.lm-mod-disabled[\s\S]*?opacity:/);
});

test('conversation copy action keeps its localized label and session id accessible', () => {
    const copyAction = source.match(/<button className='nmx-session-copy-id'[\s\S]*?<\/button>/)?.[0] ?? '';
    assert.match(copyAction, /aria-label=\{conversationText\(this\.desktopLocale, 'copyConversationId'\)\}/);
    assert.match(copyAction, /title=\{`\$\{conversationText\(this\.desktopLocale, 'copyConversationId'\)\} · \$\{session\.id\}`\}/);
    assert.match(copyAction, /copyToClipboard\(session\.id,/);
    const copyLabel = style.match(/\.nmx-session-menu > button\.nmx-session-copy-id strong\s*\{[\s\S]*?\}/)?.[0] ?? '';
    assert.doesNotMatch(copyLabel, /text-overflow:\s*ellipsis/);
    assert.match(copyLabel, /white-space:\s*nowrap/);
});

test('conversation menu width is constrained by its containing session row', () => {
    assert.match(style, /\.nmx-shell \.nmx-session-menu\s*\{[\s\S]*?max-width:\s*calc\(100%\s*-\s*8px\)/);
    assert.match(style, /\.nmx-shell \.nmx-session-menu\s*\{[\s\S]*?right:\s*0/);
});
