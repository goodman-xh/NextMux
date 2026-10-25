import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { IMAGE_PALETTE_PRESETS } from '@nextmux/comic-core/canvas-image-presets';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

test('AI image dialogs preserve upscale aspect and palette edits; storyboard menu creates one referenced draft', { timeout: 45000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({
        stdin: { loader: 'tsx', resolveDir: dirname(fileURLToPath(new URL('../src/browser/nextmux-comic-canvas-ai-tools.tsx', import.meta.url))), contents: `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AiToolDialog } from './nextmux-comic-canvas-ai-tools';
import { ToolMenu } from './nextmux-comic-canvas-tools';
import { ReactFlowProvider } from '@xyflow/react';
const root = createRoot(document.querySelector('main'));
const created = [];
let fixtureId = 0;
window.fixture = { created, menu(fixture) { root.render(<ReactFlowProvider><div className='nmx-board' style={{width:900,height:900}}><ToolMenu locale='en' kind='image' onPick={()=>{}} onPickAi={tool=>window.fixture.show({...fixture,tool})} /></div></ReactFlowProvider>); }, show({tool='image.upscale', width, height, projectAspect, variants, defaultResolution, mode='imageToImage'}) {
    const version = {id:'source-version', assetId:'source-asset', kind:'image', uri:'source.png', createdAt:'2026-10-03T00:00:00.000Z', metadata:{width,height}};
    const source = {id:'source', title:'Source', kind:'image', position:{x:0,y:0}, size:{width:320,height:240}, payload:{versions:[version],currentVersionId:version.id}};
    const capability = {id:'fixture',providerId:'generic',providerModelId:'openai/gpt-image-2',displayName:'GPT Image 2',status:'available',version:'fixture-v1',sources:['fixture'],
        modes:[{mode,outputVariants:variants,defaultResolution:defaultResolution ?? variants[0].resolution,
            referenceRules:{image:{supported:true,maxCount:4}},combinationConstraints:[{combination:'image',maxImages:4}]}]};
    const route = {key:'route',modelId:capability.providerModelId,source:'Fixture',available:true};
    fixtureId++;
    root.render(<div key={fixtureId} data-fixture-id={fixtureId}><AiToolDialog locale='en' tool={tool} canvas={{nodes:[source],edges:[],groups:[],settings:{}}} source={source} version={version}
        families={[{id:'gpt-image-2',name:'GPT Image 2',available:true,routes:[route]}]} initialRoute={route} capabilityOf={()=>({capability})}
        mediaUrl={()=>'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'} defaults={{aspectRatio:projectAspect}} position={{x:360,y:0}}
        onCreate={(nodes,edges,choice,run)=>created.push({nodes,edges,parameters:nodes[0].payload.parameters,prompt:nodes[0].payload.prompt,sourceVersionId:edges[0]?.pinnedVersionId,run})} onClose={()=>{}} /></div>);
    return fixtureId;
} };
` },
        bundle: true, write: false, platform: 'browser', format: 'iife',
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom/client': core.resolve('react-dom/client'),
            '@nextmux/comic-core/canvas-image-tools': fileURLToPath(new URL('../../comic-core/src/canvas-image-tools.ts', import.meta.url)) }
    });
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // A secure intercepted document gives the production batchId() a real crypto.randomUUID().
    await page.setRequestInterception(true);
    page.on('request', request => void request.respond({ status: 200, contentType: 'text/html', body: '<main></main>' }));
    await page.goto('https://canvas-fixture.test/');
    await page.addScriptTag({ content: outputFiles[0].text });
    const variant = (width, height, aspect) => ({ id: `${width}x${height}`, resolution: `${width}x${height}`, aspectRatios: [aspect], dimensions: { [aspect]: { width, height } } });
    const cases = [
        { width: 512, height: 512, projectAspect: '16:9', variants: [variant(4096, 2304, '16:9'), variant(1024, 1024, '1:1'), variant(2048, 2048, '1:1')], expected: {resolution:'2048x2048',aspectRatio:'1:1'} },
        { width: 512, height: 768, projectAspect: '16:9', variants: [variant(1024, 1536, '2:3'), variant(2048, 3072, '2:3')], expected: {resolution:'2048x3072',aspectRatio:'2:3'} },
        { width: 640, height: 360, projectAspect: '1:1', variants: [variant(1920, 1080, '16:9'), variant(2560, 1440, '16:9')], expected: {resolution:'2560x1440',aspectRatio:'16:9'} },
        { tool:'image.relight', width:512, height:512, projectAspect:'16:9', variants:[variant(1920,1080,'16:9')], expected:{resolution:'1920x1080',aspectRatio:'16:9'} },
        { tool:'image.outpaint', width:512, height:512, projectAspect:'1:1', variants:[variant(1920,1080,'16:9')], expected:{resolution:'1920x1080',aspectRatio:'16:9'} }
    ];
    for (const [index, fixture] of cases.entries()) {
        const fixtureId = await page.evaluate(fixture => window.fixture.show(fixture), fixture);
        await page.waitForSelector(`[data-fixture-id="${fixtureId}"] .nmx-board-ai footer .nmx-secondary-button`);
        assert.equal(await page.$eval('.nmx-board-ai footer .nmx-secondary-button', element => element.disabled), false,
            `${fixture.tool ?? 'image.upscale'} ${fixture.width}x${fixture.height} in ${fixture.projectAspect}: ${await page.$eval('.nmx-board-ai footer', element => element.innerText)}`);
        await page.click('.nmx-board-ai footer .nmx-secondary-button');
        await page.waitForFunction(count => window.fixture.created.length === count, {}, index + 1);
        const actual = await page.evaluate(() => window.fixture.created.at(-1));
        assert.deepEqual(actual.parameters, fixture.expected);
        assert.equal(actual.sourceVersionId, 'source-version');
        assert.equal(actual.run, false, 'draft creation never starts a paid model job');
    }
    const paletteId = await page.evaluate(fixture => window.fixture.show(fixture), {tool:'image.palette',width:512,height:512,projectAspect:'1:1',variants:[variant(1024,1024,'1:1')]});
    await page.waitForSelector(`[data-fixture-id="${paletteId}"] select[aria-label="Palette preset"]`);
    assert.deepEqual(await page.$$eval('select[aria-label="Palette preset"] option', options => options.map(option => option.value)), ['', ...IMAGE_PALETTE_PRESETS.map(preset => preset.id)]);
    await page.type('textarea', 'Keep the hand-drawn lines.');
    for (const preset of IMAGE_PALETTE_PRESETS) {
        await page.select('select[aria-label="Palette preset"]', preset.id);
        const actual = await page.$$eval('.nmx-board-ai-swatch', swatches => swatches.map(swatch => ({hex:swatch.querySelector('input[type=color]').value.toUpperCase(),weight:Number(swatch.querySelector('input[type=number]').value)})));
        assert.deepEqual(actual, preset.colors.map(color => ({hex:color.hex,weight:Number((color.weight*100).toFixed(4))})));
        assert.equal(await page.$eval('textarea', element => element.value), 'Keep the hand-drawn lines.', 'choosing colours retains authored instructions');
        const preview = await page.$eval('.nmx-board-ai-preview pre', element => element.textContent);
        for (const color of actual) assert.ok(preview.includes(`${color.hex} (${color.weight}%)`), `${preset.id}: prompt includes its true percentage`);
    }
    await page.select('select[aria-label="Palette preset"]', 'blue_mood');
    const beforeCustom = await page.$$eval('.nmx-board-ai-swatch input[type=color]', inputs => inputs.map(input => input.value));
    await page.focus('.nmx-board-ai-swatch input[type=number]');
    await page.$eval('.nmx-board-ai-swatch input[type=number]', input => input.select());
    await page.keyboard.type('30');
    assert.equal(await page.$eval('select[aria-label="Palette preset"]', element => element.value), '', 'editing a preset switches to Custom');
    assert.deepEqual(await page.$$eval('.nmx-board-ai-swatch input[type=color]', inputs => inputs.map(input => input.value)), beforeCustom, 'manual weight changes retain the colours');
    await page.select('select[aria-label="Palette preset"]', '');
    assert.equal(await page.$eval('.nmx-board-ai-swatch input[type=number]', input => input.value), '30', 'choosing Custom does not restore defaults');
    const palettePreview = await page.$eval('.nmx-board-ai-preview pre', element => element.textContent);
    await page.click('.nmx-board-ai footer .nmx-secondary-button');
    await page.waitForFunction(count => window.fixture.created.length === count, {}, cases.length + 1);
    const paletteCreated = await page.evaluate(() => window.fixture.created.at(-1));
    assert.equal(paletteCreated.prompt, palettePreview, 'creation uses the visible edited palette, including normalized weights');
    assert.equal(paletteCreated.run, false);
    const finalId = await page.evaluate(fixture => window.fixture.show(fixture), {width:2048,height:2048,projectAspect:'16:9',variants:[variant(2048,2048,'1:1')]});
    await page.waitForSelector(`[data-fixture-id="${finalId}"] .nmx-board-ai footer .nmx-secondary-button`);
    await page.waitForFunction(() => document.querySelector('.nmx-board-ai footer .nmx-secondary-button')?.disabled);
    assert.equal(await page.evaluate(() => window.fixture.created.length), cases.length + 1, 'no larger supported size remains unavailable');

    const gridFixture = {width:512,height:512,projectAspect:'1:1',variants:[variant(1024,1024,'1:1')]};
    await page.evaluate(fixture => window.fixture.menu(fixture), gridFixture);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[role=menuitem]')).some(item => item.textContent === 'AI storyboard grid'));
    const menuLabels = await page.$$eval('[role=menuitem]', items => items.map(item => item.textContent));
    for (const label of ['AI storyboard grid','Edit with marks','Upscale','Relight','Camera angle','Pose','Outpaint','Panorama',
        'Style transfer','Palette','Camera look','Depth illustration','Shot variations','View variations','Split grid']) assert.ok(menuLabels.includes(label), label);
    await page.evaluate(() => Array.from(document.querySelectorAll('[role=menuitem]')).find(item => item.textContent === 'AI storyboard grid').click());
    await page.waitForSelector('textarea[aria-label=Story]');
    const draftButton = '.nmx-board-ai footer .nmx-secondary-button';
    const numberInput = key => `input[type=number][aria-label="${key}"]`;
    const setNumber = async (key, value) => {
        await page.$eval(numberInput(key), input => input.select());
        await page.keyboard.type(String(value));
        await page.keyboard.press('Tab');
    };
    assert.equal(await page.$eval(draftButton, element => element.disabled), true, 'a story is required');
    assert.equal(await page.$eval(numberInput('Grid rows'), input => input.value), '2');
    assert.equal(await page.$eval(numberInput('Grid columns'), input => input.value), '2');
    for (const key of ['Grid rows','Grid columns']) assert.deepEqual(await page.$eval(numberInput(key), input => [input.min,input.max,input.step]), ['1','8','1']);
    await page.type('textarea[aria-label=Story]', 'The courier arrives, knocks, delivers a parcel and leaves.');
    await page.type('input[aria-label="Style (optional)"]', 'Ink wash');
    await setNumber('Grid rows', 2);
    await setNumber('Grid columns', 3);
    const gridPreview = await page.$eval('.nmx-board-ai-preview pre', element => element.textContent);
    assert.match(gridPreview, /2 rows and 3 columns \(6 panels\)/);
    assert.match(gridPreview, /Visual style: Ink wash/);
    assert.doesNotMatch(gridPreview, /source.png|data:image|no collage|Do not add captions, borders/);
    assert.equal(await page.evaluate(() => window.fixture.created.length), cases.length + 1, 'preview and editing never start generation');
    for (const [key, value] of [['Grid rows',0],['Grid rows',9],['Grid rows',1.5],['Grid columns',0],['Grid columns',9],['Grid columns',1.5]]) {
        await setNumber(key, value);
        assert.equal(await page.$eval(draftButton, element => element.disabled), true, `${key}=${value} fails closed`);
        await setNumber(key, key === 'Grid rows' ? 2 : 3);
    }
    await setNumber('Grid rows', 1);await setNumber('Grid columns', 8);
    assert.equal(await page.$eval(draftButton, element => element.disabled), false, 'editor limits are inclusive');
    assert.match(await page.$eval('.nmx-board-ai-preview pre', element => element.textContent), /1 rows and 8 columns \(8 panels\)/);
    await setNumber('Grid rows', 2);await setNumber('Grid columns', 3);
    await page.click(draftButton);
    await page.waitForFunction(count => window.fixture.created.length === count, {}, cases.length + 2);
    const gridCreated = await page.evaluate(() => window.fixture.created.at(-1));
    assert.equal(gridCreated.run, false);
    assert.equal(gridCreated.nodes.length, 1);assert.equal(gridCreated.edges.length, 1);
    assert.equal(gridCreated.nodes[0].kind, 'imageGen');assert.equal(gridCreated.nodes[0].payload.mode, 'imageToImage');
    assert.equal(gridCreated.nodes[0].payload.job, undefined);assert.deepEqual(gridCreated.nodes[0].payload.versions, []);
    assert.equal(gridCreated.prompt, gridPreview);assert.deepEqual(gridCreated.parameters, {resolution:'1024x1024',aspectRatio:'1:1'});
    assert.equal(gridCreated.edges[0].role, 'referenceImage');assert.equal(gridCreated.edges[0].binding, 'pinnedVersion');
    assert.equal(gridCreated.sourceVersionId, 'source-version');
    const unavailableId = await page.evaluate(fixture => window.fixture.show(fixture), {...gridFixture,tool:'image.gridStoryboard',mode:'textToImage'});
    await page.waitForSelector(`[data-fixture-id="${unavailableId}"] textarea[aria-label=Story]`);
    await page.type('textarea[aria-label=Story]', 'A bird flies.');
    assert.equal(await page.$eval(draftButton, element => element.disabled), true, 'text-only routes cannot accept the reference');
    assert.equal(await page.evaluate(() => window.fixture.created.length), cases.length + 2);
    assert.deepEqual(errors, []);
});
