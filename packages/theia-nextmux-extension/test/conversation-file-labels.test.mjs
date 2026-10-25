import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const { compactFileLinkLabel, decorateConversationMedia, isValidLocalFileLinkCandidate, normalizeLocalFileLinkTarget,
    findLocalFileLinkCandidatesInText } = loadCurrentSource(new URL('../src/browser/nextmux-conversation-media.ts', import.meta.url));

test('absolute multi-segment directories accept no extension and normalize their optional trailing separator', () => {
    for (const path of ['/Users/xuhao/Desktop/nm/33/packages/theia-nextmux-extension', 'C:\\Users\\xuhao\\Desktop\\nm',
        'D:/work/project', ...['Users', 'home', 'var', 'tmp', 'private', 'opt', 'etc', 'Volumes'].map(root => `/${root}/nextmux/config`)]) {
        for (const suffix of ['', path.includes('\\') ? '\\' : '/']) {
            const raw = path + suffix;
            assert.equal(isValidLocalFileLinkCandidate(raw), true, raw);
            assert.equal(normalizeLocalFileLinkTarget(raw), path);
            assert.equal(compactFileLinkLabel(raw), path.replace(/\\/g, '/'));
            for (const text of [`目录 ${raw}。`, `目录 "${raw}"`, `目录 「${raw}」`, `目录 ${raw}.`]) {
                const candidates = findLocalFileLinkCandidatesInText(text);
                assert.deepEqual(candidates.map(candidate => candidate.target), [path], text);
                assert.equal(text.slice(candidates[0].start, candidates[0].end), raw);
            }
        }
    }
    for (const raw of ['https://example.com/Users/me/project', 'http://example.com/Users/me/file.ts',
        '//example.com/Users/me/project', '//example.com/Users/me/file.ts', '/Users/', 'C:/work', 'src/components',
        '/usr/bin/env node app.js', '/Users/me/project --flag', 'npm install', 'v1.2.3', 'node.js']) {
        assert.equal(isValidLocalFileLinkCandidate(raw), false, raw);
    }
    assert.deepEqual(findLocalFileLinkCandidatesInText('https://example.com/Users/me/project http://example.com/Users/me/file.ts //example.com/Users/me/file.ts'), []);
    assert.equal(compactFileLinkLabel('/'), '/');
    assert.equal(compactFileLinkLabel('C:/'), 'C:/');
});

test('deep absolute directories and rejected commands do not backtrack across separators', { timeout: 1000 }, () => {
    const directory = `/Users/me/${'nested/'.repeat(200)}project`;
    assert.equal(isValidLocalFileLinkCandidate(directory), true);
    assert.equal(isValidLocalFileLinkCandidate(`${directory} --flag`), false);
    assert.deepEqual(findLocalFileLinkCandidatesInText(directory).map(candidate => candidate.target), [directory]);
});

test('file labels retain every path segment and line suffix for CSS to fade the leading edge', () => {
    for (const path of [
        'tests/admin-unified-layout.test.mjs',
        'C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe',
        '/Users/me/long-project-name/source/components/Editor.tsx#L12-L24',
        'src/components/very-long-file-name.ts:123:4',
        'src/app.ts',
        'README.md',
        '查看文件'
    ]) {
        assert.equal(compactFileLinkLabel(path), path);
    }
});

test('file label separators normalize without changing drive, UNC prefix, literal names, or line references', () => {
    assert.equal(compactFileLinkLabel('C:\\Users\\John Smith\\projects\\src\\app.ts#L42'),
        'C:/Users/John Smith/projects/src/app.ts#L42');
    assert.equal(compactFileLinkLabel('\\\\server\\share\\long-project-name\\report.pdf:42:3'),
        '//server/share/long-project-name/report.pdf:42:3');
    assert.equal(compactFileLinkLabel('src\\literal%20name.ts'), 'src/literal%20name.ts');
    assert.equal(compactFileLinkLabel(''), '');
});

// Only existing anchors and inline code are needed here. This DOM contract
// fixture deliberately has no ordinary text nodes, layout engine, or CSS.
function existingLinkDocument() {
    const document = { createElement, createTreeWalker: () => ({ nextNode: () => null }) };
    function createElement(tagName) {
        const classes = new Set();
        const attributes = new Map();
        let text = '';
        const element = {
            tagName: tagName.toUpperCase(), ownerDocument: document, parentElement: null,
            children: [], dataset: {}, title: '',
            classList: {
                add: (...tokens) => tokens.forEach(token => classes.add(token)),
                contains: token => classes.has(token),
                toggle: (token, enabled) => { if (enabled) classes.add(token); else classes.delete(token); return enabled; }
            },
            get className() { return [...classes].join(' '); },
            set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(token => classes.add(token)); },
            get textContent() { return text + this.children.map(child => child.textContent).join(''); },
            set textContent(value) { text = value; this.children = []; },
            get firstElementChild() { return this.children[0] || null; },
            get childElementCount() { return this.children.length; },
            setAttribute(name, value) {
                attributes.set(name, value);
                if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
            },
            getAttribute: name => attributes.get(name) ?? null,
            append(child) { child.parentElement = this; this.children.push(child); },
            replaceChildren(...children) {
                for (const child of this.children) child.parentElement = null;
                text = '';
                this.children = [];
                for (const child of children) this.append(child);
            },
            prepend(child) { child.parentElement = this; this.children.unshift(child); },
            closest(selector) {
                const tags = selector.split(',').map(tag => tag.trim().toUpperCase());
                for (let current = this; current; current = current.parentElement) if (tags.includes(current.tagName)) return current;
                return null;
            },
            querySelectorAll(selector) {
                const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
                if (selector === '*') return descendants;
                if (selector.startsWith('.')) return descendants.filter(child => child.classList.contains(selector.slice(1)));
                const tag = /^[a-z]+/i.exec(selector)?.[0].toUpperCase();
                return descendants.filter(child => child.tagName === tag && (selector !== 'a[data-href]' || child.getAttribute('data-href') !== null));
            },
            querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        };
        return element;
    }
    return document;
}

test('actual file-link decoration marks the 36/37-character boundary and preserves full click targets across repeat renders', t => {
    const originalNodeFilter = Object.getOwnPropertyDescriptor(globalThis, 'NodeFilter');
    Object.defineProperty(globalThis, 'NodeFilter', { configurable: true, value: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 } });
    t.after(() => {
        if (originalNodeFilter) Object.defineProperty(globalThis, 'NodeFilter', originalNodeFilter);
        else delete globalThis.NodeFilter;
    });
    const document = existingLinkDocument();
    const root = document.createElement('main');
    const cases = [
        { label: `src/${'x'.repeat(23)}.ts`, inlineCode: false },
        { label: `src/${'x'.repeat(24)}.ts`, inlineCode: false },
        { label: `src/${'x'.repeat(29)}.ts`, inlineCode: false },
        { label: `src/${'x'.repeat(30)}.ts`, inlineCode: false },
        { label: `src/${'x'.repeat(23)}.ts`, inlineCode: true },
        { label: `src/${'x'.repeat(24)}.ts`, inlineCode: true },
        { label: `src/${'x'.repeat(29)}.ts`, inlineCode: true },
        { label: `src/${'x'.repeat(30)}.ts`, inlineCode: true },
        { label: 'tests/admin-unified-layout.test.mjs#L12-L24', inlineCode: true },
        { label: 'C:\\Users\\John Smith\\projects\\src\\app.ts#L42', inlineCode: true },
        { label: 'C:\\Users\\John Smith\\projects\\src\\app.ts#L42', inlineCode: false }
    ];
    const anchors = cases.map(({ label, inlineCode }) => {
        const anchor = document.createElement('a');
        anchor.setAttribute('data-href', label);
        if (inlineCode) {
            const code = document.createElement('code');
            code.textContent = label;
            anchor.append(code);
        } else anchor.textContent = label;
        root.append(anchor);
        return anchor;
    });
    const external = document.createElement('a');
    external.setAttribute('data-href', 'https://example.test/a/long/path/to/report.ts');
    external.textContent = 'https://example.test/a/long/path/to/report.ts';
    external.title = 'Original external title';
    root.append(external);
    const resolvedPath = target => (/^[a-z]:/i.test(target) ? target : `/workspace/${target}`).replace(/#.*$/, '');
    const resolvedTargets = [];
    decorateConversationMedia(root, target => {
        resolvedTargets.push(target);
        return { path: resolvedPath(target), url: 'file:///fixture' };
    });
    decorateConversationMedia(root, () => assert.fail('decorated links must not resolve again'));

    for (const [index, { label, inlineCode }] of cases.entries()) {
        const anchor = anchors[index];
        assert.equal(anchor.classList.contains('is-long-path'), label.length > 36, label);
        assert.equal(anchor.classList.contains('nmx-file-link'), true);
        assert.equal(anchor.textContent, label.replace(/\\/g, '/'));
        assert.equal(anchor.title, resolvedPath(label));
        assert.equal(anchor.dataset.nmxPath, resolvedPath(label));
        assert.equal(anchor.dataset.nmxLabel, label);
        assert.equal(anchor.getAttribute('data-href'), label);
        assert.equal(anchor.dataset.nmxFileLink, 'file');
        assert.equal(anchor.querySelectorAll('.codicon').length, 1);
        const displayLabel = label.replace(/\\/g, '/');
        const slashIndex = displayLabel.lastIndexOf('/');
        const hasDirPrefix = slashIndex > 0 && slashIndex < displayLabel.length - 1;
        assert.equal(anchor.classList.contains('has-dir-prefix'), hasDirPrefix);
        if (hasDirPrefix) {
            assert.equal(anchor.querySelector('.nmx-file-link-dir').textContent, displayLabel.slice(0, slashIndex + 1));
            assert.equal(anchor.querySelector('.nmx-file-link-name').textContent, displayLabel.slice(slashIndex + 1));
        }
        if (inlineCode) assert.equal(anchor.querySelector('code').classList.contains('is-long-path'), label.length > 36);
    }
    assert.deepEqual(resolvedTargets, cases.map(({ label }) => label));
    assert.equal(external.textContent, 'https://example.test/a/long/path/to/report.ts');
    assert.equal(external.getAttribute('data-href'), 'https://example.test/a/long/path/to/report.ts');
    assert.equal(external.title, 'Original external title');
    assert.equal(external.className, '');
    assert.equal(external.children.length, 0);
    assert.deepEqual(external.dataset, { href: 'https://example.test/a/long/path/to/report.ts' });
});

// Exercise the real text walker and the full production stylesheet order, not only regex/CSS source strings.
test('conversation paths render without fills, fade only the prefix, and preserve capped filenames in Chromium', { timeout: 60000 }, async t => {
    const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
    const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    const { outputFiles } = await desktop('esbuild').build({
        entryPoints: [new URL('../src/browser/nextmux-conversation-media.ts', import.meta.url).pathname],
        bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ConversationMedia'
    });
    const frontend = await readFile(new URL('../src/browser/nextmux-frontend-module.ts', import.meta.url), 'utf8');
    const styles = await Promise.all([...frontend.matchAll(/import '\.\.\/\.\.\/src\/browser\/style\/([^']+\.css)'/g)]
        .map(([, name]) => readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')));
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    await page.setContent('<div class="nmx-desktop-widget nmx-shell" style="display:block;width:700px;height:auto"><div id="paths"></div></div>');
    await page.addStyleTag({ content: styles.join('\n') });
    await page.addStyleTag({ content: '#paths a { transition: none !important; }' });
    await page.addScriptTag({ content: outputFiles[0].text });
    const directoryCases = ['/Users/xuhao/Desktop/nm/33/packages/theia-nextmux-extension', 'C:\\Users\\xuhao\\Desktop\\nm\\'];
    const decorated = await page.evaluate(paths => {
        const host = document.getElementById('paths');
        const results = [];
        for (const role of ['user', 'assistant']) {
            const root = document.createElement('div'); root.className = `nmx-${role}-markdown`;
            for (const path of paths) for (const mode of ['text', 'quoted', 'code']) {
                const p = document.createElement('p');
                if (mode === 'code') { const code = document.createElement('code'); code.textContent = path; p.append(code); }
                else p.textContent = mode === 'quoted' ? `目录「${path}」` : `目录 ${path}。`;
                root.append(p);
            }
            const excluded = document.createElement('p');
            excluded.textContent = 'https://example.com/Users/me/project http://example.com/Users/me/file.ts //example.com/Users/me/file.ts';
            root.append(excluded); host.append(root);
            ConversationMedia.decorateConversationMedia(root, target => ({ path: target, url: 'file:///fixture' }));
            ConversationMedia.decorateConversationMedia(root, () => { throw new Error('must be idempotent'); });
            results.push([...root.querySelectorAll('a')].map(anchor => ({
                href: anchor.dataset.href, prefix: anchor.querySelector('.nmx-file-link-dir')?.textContent,
                name: anchor.querySelector('.nmx-file-link-name')?.textContent, split: anchor.classList.contains('has-dir-prefix')
            })));
        }
        return results;
    }, directoryCases);
    for (const links of decorated) assert.deepEqual(links, directoryCases.flatMap(raw => {
        const target = raw.replace(/[\\/]+$/, ''); const label = target.replace(/\\/g, '/'); const last = label.lastIndexOf('/');
        return Array.from({ length: 3 }, () => ({ href: target, prefix: label.slice(0, last + 1), name: label.slice(last + 1), split: true }));
    }));

    await page.evaluate(() => {
        const host = document.getElementById('paths'); host.replaceChildren();
        for (const role of ['user', 'assistant']) for (const local of [false, true]) for (const inlineCode of [false, true]) {
            const root = document.createElement('div'); root.className = `nmx-${role}-markdown`;
            for (const filename of ['Editor.tsx', 'extremely-long-filename-'.repeat(5) + '.tsx']) {
                const p = document.createElement('p'); const anchor = document.createElement('a'); anchor.href = '#';
                anchor.className = `${local ? 'nmx-local-file-link' : 'nmx-file-link'} has-dir-prefix is-long-path`;
                const icon = document.createElement('i'); icon.className = 'codicon codicon-file-code'; anchor.append(icon);
                const label = inlineCode ? document.createElement('code') : anchor;
                if (inlineCode) { label.className = 'has-dir-prefix is-long-path'; anchor.append(label); }
                const dir = document.createElement('span'); dir.className = 'nmx-file-link-dir';
                dir.textContent = '/Users/xuhao/Desktop/' + 'long-directory/'.repeat(12);
                const name = document.createElement('span'); name.className = 'nmx-file-link-name'; name.textContent = filename;
                label.append(dir, name); p.append(anchor); root.append(p);
            }
            host.append(root);
        }
    });
    for (const theme of ['dark', 'nmx-theme-light', 'data-theme', 'theia-light', 'NextMux-light',
        'widget-light', 'widget-data', 'nested-light', 'nested-data']) {
        await page.evaluate(theme => {
            const widget = document.querySelector('.nmx-desktop-widget'); const host = document.getElementById('paths');
            document.body.className = ['nmx-theme-light', 'theia-light', 'NextMux-light'].includes(theme) ? theme : '';
            if (theme === 'data-theme') document.body.dataset.nextmuxTheme = 'light'; else delete document.body.dataset.nextmuxTheme;
            widget.classList.toggle('nmx-theme-light', theme === 'widget-light');
            if (theme === 'widget-data') widget.dataset.nextmuxTheme = 'light'; else delete widget.dataset.nextmuxTheme;
            host.classList.toggle('nmx-theme-light', theme === 'nested-light');
            if (theme === 'nested-data') host.dataset.nextmuxTheme = 'light'; else delete host.dataset.nextmuxTheme;
        }, theme);
        await page.mouse.move(1190, 890);
        const metrics = await page.$$eval('#paths a', anchors => anchors.map(anchor => {
            const dir = anchor.querySelector('.nmx-file-link-dir'); const name = anchor.querySelector('.nmx-file-link-name');
            const a = getComputedStyle(anchor), d = getComputedStyle(dir), n = getComputedStyle(name);
            const range = document.createRange(); range.setStart(dir.firstChild, dir.textContent.length - 1); range.setEnd(dir.firstChild, dir.textContent.length);
            const last = range.getBoundingClientRect(), db = dir.getBoundingClientRect();
            return { background: a.backgroundColor, border: a.borderTopColor, shadow: a.boxShadow, color: a.color,
                padding: a.paddingLeft, overflow: a.textOverflow, cap: a.maxWidth, dirColor: d.color, opacity: d.opacity,
                mask: d.maskImage, dirOverflow: d.textOverflow, direction: d.direction, bidi: d.unicodeBidi,
                tailVisible: last.left >= db.left - 1 && last.right <= db.right + 1,
                shrink: n.flexShrink, nameColor: n.color, weight: n.fontWeight, nameCap: n.maxWidth,
                filenameFull: name.scrollWidth <= name.clientWidth + 1, nameWidth: name.getBoundingClientRect().width,
                nameOverflow: n.textOverflow, longName: name.textContent.length > 38,
                codeBackground: anchor.querySelector('code') ? getComputedStyle(anchor.querySelector('code')).backgroundColor : a.backgroundColor };
        }));
        for (const m of metrics) {
            const context = `${theme}: ${JSON.stringify(m)}`;
            assert.equal(m.background, 'rgba(0, 0, 0, 0)', context);
            assert.equal(m.codeBackground, 'rgba(0, 0, 0, 0)', context);
            assert.equal(m.border, 'rgba(0, 0, 0, 0)', context); assert.equal(m.shadow, 'none', context);
            assert.equal(m.padding, '2px', context); assert.equal(m.overflow, 'clip', context);
            assert.match(m.cap, /^min\(100%, [\d.]+px\)$/, context);
            assert.equal(m.mask, 'linear-gradient(to right, rgba(0, 0, 0, 0) 0px, rgb(0, 0, 0) 24px, rgb(0, 0, 0) 100%)', context);
            assert.equal(m.dirOverflow, 'clip', context); assert.equal(m.direction, 'rtl', context); assert.equal(m.bidi, 'plaintext', context);
            assert.equal(m.tailVisible, true, context); assert.equal(m.shrink, '0', context); assert.equal(m.weight, '600', context);
            assert.ok(m.nameWidth <= 320, context); assert.equal(m.nameOverflow, 'ellipsis', context);
            assert.equal(m.filenameFull, !m.longName, context);
            if (theme !== 'dark') {
                assert.equal(m.color, 'rgb(15, 23, 42)', context); assert.equal(m.nameColor, 'rgb(15, 23, 42)', context);
                assert.equal(m.dirColor, 'rgb(30, 41, 59)', context); assert.equal(m.opacity, '0.9', context);
            }
        }
        for (const selector of ['a.nmx-file-link', 'a.nmx-local-file-link']) {
            await page.hover(`#paths ${selector}`);
            const hover = await page.$eval(`#paths ${selector}`, anchor => {
                const s = getComputedStyle(anchor); return { background: s.backgroundColor, border: s.borderTopColor, shadow: s.boxShadow, color: s.color };
            });
            assert.equal(hover.background, 'rgba(0, 0, 0, 0)', theme); assert.equal(hover.border, 'rgba(0, 0, 0, 0)', theme);
            assert.equal(hover.shadow, 'none', theme);
            if (theme !== 'dark') assert.equal(hover.color, 'rgb(2, 6, 23)', theme);
        }
    }
});
