import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// REQUIREMENTS §4.2 "左侧项目与对话列表": create, delete, reorder and pin move
// items smoothly into place. Real Chromium + the production FlipList module and
// production sidebar CSS; the list markup mirrors renderContextPanel.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const core = createRequire(desktop.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const widgetSource = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');

const entry = `import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {FlipList} from './packages/theia-nextmux-extension/src/browser/nextmux-motion';
const flip = new FlipList({ selector: '.nmx-project-tree[data-project-tree], .nmx-session-row[data-session-id]',
  keyOf: el => el.dataset.projectTree ? 'project:' + el.dataset.projectTree : el.dataset.sessionId ? 'session:' + el.dataset.sessionId : undefined,
  ignoreWithin: '.nmx-session-virtual-list' });
let state = { pinned: [], projects: [{ path: '/a', label: 'alpha', sessions: ['a1', 'a2', 'a3'] }, { path: '/b', label: 'beta', sessions: ['b1', 'b2'] }] };
let setState;
const row = id => <div key={id} className='nmx-session-row' data-session-id={id}><button className='nmx-session-open'><span>{'Conversation ' + id}</span></button></div>;
function Sidebar() {
  const [value, set] = React.useState(state); setState = next => flushSync(() => set(state = next(state)));
  return <aside id='nmx-context-panel' className='nmx-context-panel nmx-coding-context'>
    <nav ref={flip.ref} className='nmx-context-nav'>
      {value.pinned.length > 0 && <><p>置顶</p>{value.pinned.map(row)}</>}
      <p className='nmx-projects-heading'>项目</p>
      {value.projects.map(project => <div className='nmx-project-tree' data-project-tree={project.path} key={project.path}>
        <div className='nmx-project-header'><button className='nmx-project-row' data-project-path={project.path}><i className='codicon codicon-folder'></i><span>{project.label}</span><i className='codicon codicon-chevron-down'></i></button></div>
        {project.sessions.map(row)}
      </div>)}
    </nav>
  </aside>;
}
window.fixture = { update: next => setState(next), flip };
createRoot(document.querySelector('#fixture')).render(<Sidebar/>);`;

async function fixture(t, { reduced = false, theme = 'dark' } = {}) {
    const bundle = await desktop('esbuild').build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'flip-fixture.tsx', loader: 'tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client'), 'react-dom': core.resolve('react-dom') } });
    const styles = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-motion.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')));
    const html = `<!doctype html><html><head><meta charset='utf-8'><style>${styles.join('\n')}</style>
<style>html,body{margin:0;height:100%;font:14px system-ui}.nmx-context-panel{position:relative!important;width:276px;height:100vh}</style></head>
<body><div class='nmx-desktop-widget'><div class='nmx-shell nmx-theme-${theme}'><div id='fixture'></div></div></div><script src='/fixture.js'></script></body></html>`;
    const server = createServer((request, response) => {
        if (request.url === '/fixture.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(bundle.outputFiles[0].contents); return; }
        response.writeHead(200, { 'content-type': 'text/html' }); response.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
    await page.setViewport({ width: 900, height: 700 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('.nmx-session-row');
    return page;
}

const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const top = (page, id) => page.$eval(`[data-session-id="${id}"]`, el => el.getBoundingClientRect().top);
// Update and capture in one task, so a loaded runner cannot let the
// 200 ms animations progress between the commit and the measurement.
const commit = (page, next) => page.evaluate(async source => {
    window.fixture.update(new Function('state', `return (${source})(state)`));
    await Promise.resolve();
    const items = document.getAnimations().map(animation => {
        const target = animation.effect.target;
        const keyframes = animation.effect.getKeyframes();
        return { id: target.dataset.sessionId || target.dataset.projectTree || '', ghost: target.dataset.nmxFlipGhost === 'true',
            first: keyframes[0].transform || '', opacity: keyframes[0].opacity,
            ghostState: target.dataset.nmxFlipGhost === 'true' ? [target.getAttribute('aria-hidden'), target.hasAttribute('inert'), target.style.pointerEvents].join() : '' };
    });
    const a3 = document.querySelector('[data-session-id="a3"]');
    return { items, a3Top: a3 ? a3.getBoundingClientRect().top : 0 };
}, next.toString());

test('reorder, pin, create and delete glide into place with AutoAnimate keyframes and then go fully idle', { timeout: 40000 }, async t => {
    const page = await fixture(t);
    // Running/reorder: a3 moves to the top of its project.
    const before = await top(page, 'a3');
    const reorder = await commit(page, state => ({ ...state, projects: state.projects.map(project => project.path === '/a' ? { ...project, sessions: ['a3', 'a1', 'a2'] } : project) }));
    const moving = reorder.items;
    const a3 = moving.find(item => item.id === 'a3');
    assert.ok(a3, 'moved row animates');
    assert.match(a3.first, /^translate\(0px, \d+(\.\d+)?px\)$/);
    const startY = Number(/, ([\d.]+)px/.exec(a3.first)[1]);
    const layoutTop = await page.$eval('[data-session-id="a3"]', el => el.offsetTop);
    const visualTop = reorder.a3Top;
    assert.ok(startY > 40, 'new slot is above the old one');
    assert.ok(Math.abs(visualTop - before) < 12, `the row starts where it was (${visualTop} vs ${before}), not at its new slot`);
    assert.ok(layoutTop >= 0);
    assert.ok(moving.filter(item => item.id === 'a1' || item.id === 'a2').every(item => /translate\(0px, -/.test(item.first)), 'displaced rows glide down');
    assert.ok(!moving.some(item => item.id === '/a' || item.id === '/b'), 'projects did not move');

    // Pin: the session re-mounts under the pinned heading and still FLIPs (shared key).
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));
    const pinned = (await commit(page, state => ({ pinned: ['b2'], projects: state.projects.map(project => ({ ...project, sessions: project.sessions.filter(id => id !== 'b2') })) }))).items;
    assert.match(pinned.find(item => item.id === 'b2')?.first || '', /^translate\(-?[\d.]+px, [1-9][\d.]*px\)$/, 'pinned row travels up from its project (and across its indent)');
    const projectMove = pinned.find(item => item.id === '/a');
    assert.ok(projectMove, 'projects shift down under the new pinned section');
    assert.ok(!pinned.some(item => ['a1', 'a2', 'a3'].includes(item.id)), 'rows inside a moving project inherit its motion instead of double-moving');

    // Create: a new conversation fades/scales in.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));
    const created = (await commit(page, state => ({ ...state, projects: state.projects.map(project => project.path === '/b' ? { ...project, sessions: ['b-new', ...project.sessions] } : project) }))).items.find(item => item.id === 'b-new');
    assert.equal(created?.first, 'scale(0.98)');
    assert.equal(Number(created?.opacity), 0);

    // Delete: the removed row is kept as an inert ghost that fades out while neighbours close the gap.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));
    const deleting = (await commit(page, state => ({ ...state, projects: state.projects.map(project => project.path === '/a' ? { ...project, sessions: project.sessions.filter(id => id !== 'a1') } : project) }))).items;
    const ghost = deleting.find(item => item.ghost);
    assert.equal(ghost?.id, 'a1');
    assert.ok(deleting.some(item => item.id === 'a2' && /translate\(0px, \d/.test(item.first)), 'following row slides up');
    assert.equal(ghost.ghostState, 'true,true,none');
    await page.screenshot({ path: '/tmp/nm-motion-sidebar-delete-mid.png' });

    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 450)));
    assert.equal(await page.$('[data-nmx-flip-ghost]'), null, 'ghost removed after its fade');
    assert.deepEqual(await page.evaluate(() => document.getAnimations().length), 0, 'idle list has no running animation');
    assert.deepEqual(await page.$$eval('.nmx-session-row', rows => rows.map(row => row.dataset.sessionId)), ['b2', 'a3', 'a2', 'b-new', 'b1']);
    await page.screenshot({ path: '/tmp/nm-motion-sidebar-settled.png' });
});

test('reduced motion updates the list instantly with no Web Animations', { timeout: 30000 }, async t => {
    const page = await fixture(t, { reduced: true, theme: 'light' });
    await page.evaluate(() => window.fixture.update(state => ({ ...state, projects: [...state.projects].reverse() })));
    await frames(page);
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    await page.evaluate(() => window.fixture.update(state => ({ ...state, projects: state.projects.map(project => ({ ...project, sessions: project.sessions.slice(1) })) })));
    assert.equal(await page.$('[data-nmx-flip-ghost]'), null);
});

test('production sidebar wires the FLIP controller to the coding project list', () => {
    assert.match(widgetSource, /<nav ref=\{this\.sidebarFlip\.ref\} className=\{`nmx-context-nav /);
    assert.match(widgetSource, /<div className=[^\n]*nmx-project-tree[^\n]* data-project-tree=\{workspace\.path\} key=\{workspace\.path\}/);
    assert.match(widgetSource, /className=\{`nmx-session-row [\s\S]{0,400}?`\} data-session-id=\{session\.id\}/);
});
