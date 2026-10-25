import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { CouncilSubConversationVisibilityController, CouncilSidebarSubConversations, councilRoleTone,
    createDefaultCouncilDraftSlots, toggleCouncilSlotRole } from '../lib/browser/nextmux-council-mode-view.js';
import { councilModeText } from '../lib/browser/nextmux-council-mode-locale.js';
import { ConversationImportPanel } from '../lib/browser/nextmux-conversation-import-panel.js';
import { McpAccessPanel } from '../lib/browser/nextmux-mcp-access-panel.js';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const child = (status = 'running') => ({ childRunId: 'child', role: 'frontend', status, task: 'A child task', taskContext: {}, events: [] });

test('unviewed completion starts fading at 10s and disappears only 800ms later', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const controller = new CouncilSubConversationVisibilityController(() => {});
    // The countdown belongs to a run seen finishing here; a child first seen finished is history (archived at once).
    controller.syncChildren([child('running')]);
    controller.syncChildren([child('completed')]);
    t.mock.timers.tick(9999); assert.notEqual(controller.getPhase('child'), 'exiting');
    t.mock.timers.tick(1); assert.equal(controller.getPhase('child'), 'exiting');
    t.mock.timers.tick(799); assert.equal(controller.isVisibleInSidebar('child'), true);
    t.mock.timers.tick(1); assert.equal(controller.isVisibleInSidebar('child'), false);
    controller.dispose();
});

test('viewing a completed child locks it; leaving restarts the full countdown, returning cancels it', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const controller = new CouncilSubConversationVisibilityController(() => {});
    controller.selectChild('child'); controller.syncChildren([child('completed')]);
    t.mock.timers.tick(30000); assert.equal(controller.getPhase('child'), 'locked');
    controller.leaveToConversation(); t.mock.timers.tick(9999);
    controller.selectChild('child'); t.mock.timers.tick(30000); assert.equal(controller.getPhase('child'), 'locked');
    controller.leaveToConversation(); t.mock.timers.tick(10000); assert.equal(controller.getPhase('child'), 'exiting');
    controller.syncChildren([child('running')]); t.mock.timers.tick(800);
    assert.equal(controller.isVisibleInSidebar('child'), true);
    controller.dispose();
});

test('Council rows expose each assigned role, stable tones and no menu; native context menu is prevented', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const controller = new CouncilSubConversationVisibilityController(() => {});
    controller.syncChildren([child('running')]); controller.syncChildren([child('completed')]); t.mock.timers.tick(10000);
    const props = { locale: 'zh-CN', sessionId: 'lead', childrenSnapshots: [child('completed')], activeChildId: '',
        visibilityController: controller, onSelectChild() {}, rolesForChild: () => ['frontend', 'generalist'] };
    const html = renderToStaticMarkup(React.createElement(CouncilSidebarSubConversations, props));
    assert.match(html, /nmx-session-row is-council-child is-council-last is-council-fading/);
    assert.equal((html.match(/class="nmx-council-role-badge"/g) || []).length, 2);
    assert.doesNotMatch(html, /nmx-session-more|nmx-session-menu/);
    const tree = CouncilSidebarSubConversations(props);
    let prevented = 0;
    tree.props.children[0].props.onContextMenu({ preventDefault() { prevented++; }, stopPropagation() { prevented++; } });
    assert.equal(prevented, 2);
    assert.deepEqual(['lead', 'planning', 'frontend', 'backend', 'qa', 'review', 'delivery', 'generalist'].map(councilRoleTone), [1,2,3,4,5,6,7,8]);
    for (const role of ['architecture', 'a future role', '未知']) {
        assert.equal(councilRoleTone(role), councilRoleTone(role)); assert.ok(councilRoleTone(role) >= 1 && councilRoleTone(role) <= 8);
    }
    controller.dispose();
});

test('a child first seen already finished is archived without a countdown, unless it is the one being viewed', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const controller = new CouncilSubConversationVisibilityController(() => {});
    controller.syncChildren([child('completed')]);
    assert.equal(controller.getPhase('child'), 'archived');
    assert.equal(renderToStaticMarkup(React.createElement(CouncilSidebarSubConversations, { locale: 'zh-CN', sessionId: 'lead',
        childrenSnapshots: [child('completed')], activeChildId: '', visibilityController: controller, onSelectChild() {} })), '');
    controller.dispose();
});

test('default has three slots, tags remain multiselect and add label contains no duplicate plus', () => {
    const slots = createDefaultCouncilDraftSlots([{ modelId: 'model', routeId: 'route', label: 'Model' }]);
    assert.equal(slots.length, 3);
    const next = toggleCouncilSlotRole(slots, slots[1].slotId, 'qa');
    assert.ok(next[1].roles.includes('frontend')); assert.ok(next[1].roles.includes('qa'));
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        assert.doesNotMatch(councilModeText(locale, 'addModelSlot'), /\+/);
        assert.ok(councilModeText(locale, 'generalistWarning'));
    }
});

test('MCP initial github query populates both installed and registry search on the first render', () => {
    const html = renderToStaticMarkup(React.createElement(McpAccessPanel, { locale: 'en', initialQuery: 'github', service: {},
        loadRegistry: async () => ({ entries: [] }), openExternal() {}, onChange() {}, addServer() {}, credentialConfigurable: () => false }));
    assert.equal((html.match(/value="github"/g) || []).length, 2);
});

test('real Council popover closes on outside clicks and Escape, preserves multiselect and closing mount', { timeout: 30000 }, async t => {
    const { build } = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url))('esbuild');
    const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
    const puppeteer = (await import(pathToFileURL(platform.resolve('puppeteer')).href)).default;
    const bundle = await build({ stdin: { loader: 'tsx', resolveDir: dirname(fileURLToPath(new URL('../lib/browser/nextmux-council-mode-view.js', import.meta.url))), contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {CouncilConfigModal,createDefaultCouncilDraftSlots,toggleCouncilSlotRole} from './nextmux-council-mode-view.js';
const models=[{modelId:'m',routeId:'route',label:'Model'}]; window.councilClosed=0; window.hoveredModel='';
function App(){const [closing,setClosing]=React.useState(false); const [relay,setRelay]=React.useState(''); const [role,setRole]=React.useState('');
const [disableSubagents,setDisableSubagents]=React.useState(false);
const [slots,setSlots]=React.useState(createDefaultCouncilDraftSlots(models));
return <><button id='outside'>Outside</button><CouncilConfigModal locale='zh-CN' relayKey={relay} relayLabel='Relay' models={models} slots={slots}
closing={closing} openRolePickerSlotId={role} onToggleRolePicker={id=>setRole(p=>p===id?'':id)} onDismissDropdowns={()=>setRole('')}
disableSubagents={disableSubagents} onToggleDisableSubagents={next=>setDisableSubagents(next)}
onModelOptionPointerEnter={model=>{window.hoveredModel=model.routeId||model.modelId;}}
onModelOptionPointerLeave={()=>{window.hoveredModel='';}}
renderModelOptionHoverPortal={model=>window.hoveredModel===(model.routeId||model.modelId)?<div className='nmx-model-effort-portal' data-hover-model={model.modelId}>Drawer</div>:null}
renderRelayDrawer={()=> <button data-relay-key='relay' onClick={()=>setRelay('relay')}>Relay option</button>}
onToggleSlotRole={(id,role)=>setSlots(p=>toggleCouncilSlotRole(p,id,role))} onSelectSlotModel={()=>{}} onRemoveSlot={()=>{}}
onAddSlot={()=>{}} onConfirm={()=>{}} onClose={()=>{window.councilClosed++;setClosing(true)}}/></>}
createRoot(document.querySelector('main')).render(<App/>);
` }, bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        plugins: [{ name: 'unused-crypto', setup(build) { build.onResolve({ filter: /^node:crypto$/ }, () => ({ path: 'unused', namespace: 'test' }));
            build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const createHash=()=>{}; export const randomInt=()=>0;', loader: 'js' })); } }],
        alias: { react: core.resolve('react'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }); t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<main></main>'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('[data-council-relay-drawer="true"]');
    assert.equal(await page.$('.nmx-council-relay-trigger'), null, 'Relay list must be expanded inline without a trigger button');
    assert.equal(await page.$$eval('.nmx-council-slot-row', rows => rows.length), 3);
    await page.click('[data-relay-key]');
    const roleTrigger = '[data-council-roles-trigger="slot-1"]';
    const rolePopup = '.nmx-council-popover[data-council-role-picker="slot-1"]';
    await page.click(roleTrigger); await page.waitForSelector(rolePopup);
    await page.click('#outside'); assert.equal(await page.$(rolePopup), null);
    await page.click(roleTrigger); await page.waitForSelector(rolePopup);
    await page.keyboard.press('Escape'); assert.equal(await page.$(rolePopup), null);
    assert.equal(await page.evaluate(() => window.councilClosed), 0);
    // Test preventSubagents checkbox in modal footer
    assert.equal(await page.$eval('[data-council-prevent-subagents] input[type="checkbox"]', el => el.checked), false);
    await page.click('[data-council-prevent-subagents]');
    assert.equal(await page.$eval('[data-council-prevent-subagents] input[type="checkbox"]', el => el.checked), true);
    // Test model option hover callback and hover portal
    await page.click('[data-council-model-select="slot-1"]');
    await page.waitForSelector('[data-council-model-option="m"]');
    await page.hover('[data-council-model-option="m"]');
    assert.equal(await page.evaluate(() => window.hoveredModel), 'route');
    assert.equal(await page.$$eval('.nmx-council-slot-row', rows => rows.length), 3);
    assert.equal(await page.$eval('.nmx-council-add-slot', element => element.textContent.includes('+')), false);
    await page.click('.nmx-council-modal-close');
    assert.equal(await page.$eval('.nmx-council-modal-backdrop', el => el.classList.contains('is-closing')), true);
});


test('import batch deletion and undo retain hover while exposing the live blocked hint', () => {
    for (const result of [undefined, { sessionIds: ['a'], imported: 1, updated: 0, failed: [] }]) {
        const html = renderToStaticMarkup(React.createElement(ConversationImportPanel, { locale: 'en', scanning: false,
            historyEnabled: true, deletionBlocked: ids => ids.includes('a'), results: result ? { codex: result } : {},
            scan: { scannedAt: 1, sources: [{ source: 'codex', total: 1, imported: 1, importable: 0, roots: [],
                candidates: [{ sessionId: 'a', status: 'imported' }] }] } }));
        assert.match(html, /is-blocked[^>]*aria-disabled="true"[^>]*title="Please stop this conversation first"/);
        assert.doesNotMatch(html, /is-blocked[^>]* disabled=/);
    }
});
