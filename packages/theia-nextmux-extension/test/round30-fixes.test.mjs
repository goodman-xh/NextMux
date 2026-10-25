import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const widget = await read('../src/browser/nextmux-desktop-widget.tsx');

test('paths in a reply become file links: inline code paths and absolute paths in text, not commands or versions', { timeout: 30000 }, async t => {
    const media = ts.transpile(await read('../src/browser/nextmux-conversation-media.ts'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
        .replace(/^export /gm, '').replace(/^Object\.defineProperty\(exports.*$/gm, '').replace(/^exports\.\w+ = .*$/gm, '');
    const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`<div id="reply"><p>改了 <code>src/app.ts:42</code> 和 <code>docs/README.md</code>，运行 <code>npm install</code>，版本 <code>v1.2.3</code>。</p>
        <p>视频已保存到 /Users/me/Movies/demo.mp4。网页 https://example.com/Users/a.png 不是本机文件。</p>
        <p>命令固定为 C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe，运行 C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs。</p>
        <pre><code>/Users/me/in-a-block.txt</code></pre></div>`);
    await page.addScriptTag({ content: `const exports = {}; ${media}; window.decorate = decorateConversationMedia;` });
    const links = await page.evaluate(() => {
        const root = document.getElementById('reply');
        window.decorate(root, target => ({ path: target.startsWith('/') || /^[a-z]:/i.test(target) ? target.replace(/#.*$/, '') : `/work/${target.replace(/#.*$/, '')}`, url: 'file:///x' }));
        window.decorate(root, () => undefined);
        return [...root.querySelectorAll('a[data-href]')].map(anchor => ({
            href: anchor.dataset.href,
            kind: anchor.dataset.nmxFileLink,
            title: anchor.title,
            label: anchor.dataset.nmxLabel,
            text: anchor.textContent,
            longPath: anchor.classList.contains('is-long-path')
        }));
    });
    assert.deepEqual(links, [
        { href: 'src/app.ts#L42', kind: 'file', title: '/work/src/app.ts', label: 'src/app.ts:42', text: 'src/app.ts:42', longPath: false },
        { href: 'docs/README.md', kind: 'file', title: '/work/docs/README.md', label: 'docs/README.md', text: 'docs/README.md', longPath: false },
        { href: '/Users/me/Movies/demo.mp4', kind: 'video', title: '/Users/me/Movies/demo.mp4', label: '/Users/me/Movies/demo.mp4', text: '/Users/me/Movies/demo.mp4', longPath: false },
        {
            href: 'C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe',
            kind: 'file',
            title: 'C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe',
            label: 'C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe',
            text: 'C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe',
            longPath: true
        },
        {
            href: 'C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs',
            kind: 'file',
            title: 'C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs',
            label: 'C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs',
            text: 'C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs',
            longPath: true
        }
    ], 'a second pass adds nothing; long paths keep every segment and expose the CSS fade marker');
    const labels = [
        `src/${'x'.repeat(23)}.ts`,
        `src/${'x'.repeat(24)}.ts`,
        `src/${'x'.repeat(29)}.ts`,
        `src/${'x'.repeat(30)}.ts`,
        'tests/admin-unified-layout.test.mjs#L12-L24',
        'C:\\Users\\John Smith\\projects\\src\\app.ts'
    ];
    const inlineLinks = await page.evaluate(labels => {
        const root = document.createElement('div');
        for (const label of labels) {
            const paragraph = document.createElement('p');
            const code = document.createElement('code');
            code.textContent = label;
            paragraph.append(code);
            root.append(paragraph);
        }
        window.decorate(root, target => ({ path: /^[a-z]:/i.test(target) ? target : `/work/${target.replace(/#.*$/, '')}`, url: 'file:///x' }));
        window.decorate(root, () => undefined);
        return [...root.querySelectorAll('a[data-href]')].map(anchor => ({
            href: anchor.dataset.href,
            path: anchor.dataset.nmxPath,
            title: anchor.title,
            label: anchor.dataset.nmxLabel,
            text: anchor.textContent,
            longPath: anchor.classList.contains('is-long-path'),
            codeLongPath: anchor.querySelector('code').classList.contains('is-long-path'),
            icons: anchor.querySelectorAll('.codicon').length
        }));
    }, labels);
    assert.deepEqual(inlineLinks, labels.map(label => ({
        href: label,
        path: label.startsWith('C:') ? label : `/work/${label.replace(/#.*$/, '')}`,
        title: label.startsWith('C:') ? label : `/work/${label.replace(/#.*$/, '')}`,
        label,
        text: label.replace(/\\/g, '/'),
        longPath: label.length > 36,
        codeLongPath: label.length > 36,
        icons: 1
    })), '31–36 characters stay unmarked, longer inline paths fade, and original targets/titles survive normalization and repeat renders');
    assert.match(widget, /protected async revealContextFileInTree\(node: WorkContextFileNode\): Promise<void>/);
    assert.match(widget, /if \(restoreToken === undefined\) \{\s*void this\.revealContextFileInTree\?\.\(node\);\s*\}/);
});

test('a computer tool call without the system permission waits for it instead of failing at once', async () => {
    const { DesktopComputerTools, COMPUTER_PERMISSION_WAIT_MS } = await import('../lib/node/nextmux-computer-tools.js');
    assert.equal(COMPUTER_PERMISSION_WAIT_MS, 600_000);
    const tools = new DesktopComputerTools();
    tools.setCapability({ platform: 'darwin', version: 'x', delivery: 'background', available: false, reason: 'permission_required' });
    const pending = tools.request({ id: 'computer-a', conversationId: 'c', runId: 'r', expiresAt: Date.now() + 45_000, action: 'listApps', input: {} });
    const [held] = tools.requests();
    assert.ok(held.expiresAt - Date.now() > 9 * 60_000, 'held for the user to grant the permission');
    tools.resolve({ requestId: 'computer-a', ok: true, output: { apps: [] } });
    assert.equal((await pending).ok, true);
    tools.setCapability({ platform: 'darwin', version: 'x', delivery: 'background', available: true });
    void tools.request({ id: 'computer-b', conversationId: 'c', expiresAt: Date.now() + 45_000, action: 'listApps', input: {} });
    assert.ok(tools.requests()[0].expiresAt - Date.now() <= 45_000, 'with the permission, the usual limit');
    tools.dispose();
    // The page holds the call, shows the notice and, after Screen Recording's restart, continues the conversation.
    assert.match(widget, /protected async waitForComputerPermission\(/);
    assert.match(widget, /if \(needsPermission\(capability\)\) capability = await this\.waitForComputerPermission\(request, capability\);/);
    assert.match(widget, /this\.resumeAfterComputerPermission\?\.\(\);/);
    assert.match(widget, /<ComputerPermissionWait locale=/);
});

test('round 30 fixes stay in place', async () => {
    // Model lists: newest and strongest first in the coding drawer; own APIs' models ranked by the platform's order.
    assert.match(widget, /const pickerRows: readonly CodingModelOption\[\] = withPriceVariants\(\[\.\.\.visibleModelOptions, \.\.\.moreModelOptions\]\.filter\(matchesPickerQuery\)\s+\.sort\(\(left, right\) => \(left\.rank \?\? Infinity\) - \(right\.rank \?\? Infinity\)/);
    assert.match(widget, /const rank = option\.rank \?\? this\.globalModelRank\?\.\(option\.model\);/);
    assert.doesNotMatch(widget, /Math\.min\(400, Number\(offering!\.catalogRank\)\)/);
    // Advanced comic chat: sound goes in the prompt; no video lane accepts requestAudio.
    assert.equal((widget.match(/requestAudio: (?!false)/g) || []).length, 0);
    // A charged failure is not shown as “not charged”.
    assert.match(widget, /item\.status === 'failed' \? \(item\.chargedMicros > 0 \? '失败 · 已扣费' : '未扣费'\)/);
    // The comic chat drawer chooses a voice model too, reached through its skill card.
    const chat = await read('../src/browser/nextmux-comic-chat-view.tsx');
    assert.match(chat, /COMIC_CHAT_DRAWER_MODES: readonly ComicChatMode\[\] = \['image', 'video', 'music', 'speech'\]/);
    assert.match(chat, /\{ id: 'voice', mode: 'speech'/);
    // Sent videos and files open; the tooltip is the path.
    assert.match(widget, /className=\{`nmx-turn-file is-\$\{this\.turnAttachmentMediaKind\(item\)\}`\}/);
    // Import removal accepts this device's UUID-shaped imports.
    const service = await read('../src/node/nextmux-platform-service.ts');
    assert.match(service, /const imported = new Set\(Object\.values\(map\.entries\)\.map\(entry => entry\.sessionId\)\);/);
    // ⌘W closes a full-screen player or enlarged picture before the window.
    const updater = await read('../../../apps/desktop/updater.cjs');
    assert.match(updater, /window\.__nextmuxCloseTopLayer\(\) === true/);
    assert.match(widget, /shellHook\.__nextmuxCloseTopLayer = closeTopLayerForShell;/);
    // The menu bar shows the colour logo, not a template silhouette.
    assert.doesNotMatch(updater, /setTemplateImage\(true\)/);
    // File tab menu: copy, reveal, attach, find, replace, close.
    assert.match(widget, /onReveal=\{\(\) => void this\.platformService\.revealInFileManager\(preview\.path\)/);
});
