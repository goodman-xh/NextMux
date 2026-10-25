import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);
const source = await readFile(widgetUrl, 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['renderContextPanel', 'renderWindowParts', 'renderUnifiedComicAssetLibrary', 'renderComicCastLibrary',
    'openComicCastLibrary', 'clearComicLibrarySurfaces', 'selectSection', 'onUpdateRequest', 'openLibrarySaveMenu',
    'handleLibraryChatContextMenu', 'saveChatLibraryAsset', 'uploadComicLibraryFiles', 'renderAssistantOutput', 'renderTurnMessageMenuItems'];
const members = names.map(name => {
    const member = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(member, name); return member;
});
// Import the real dependencies referenced by the extracted production methods.
const identifiers = new Set();
const visit = node => { if (ts.isIdentifier(node)) identifiers.add(node.text); ts.forEachChild(node, visit); };
for (const member of members) visit(member);
const imports = file.statements.filter(ts.isImportDeclaration).flatMap(node => {
    const clause = node.importClause; if (!clause || clause.isTypeOnly) return [];
    const parts = [];
    if (clause.name && identifiers.has(clause.name.text)) parts.push(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) && identifiers.has(clause.namedBindings.name.text)) parts.push(clause.namedBindings.getText(file));
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        const used = clause.namedBindings.elements.filter(item => !item.isTypeOnly && identifiers.has(item.name.text));
        if (used.length) parts.push(`{ ${used.map(item => item.getText(file)).join(', ')} }`);
    }
    return parts.length ? [`import ${parts.join(', ')} from ${node.moduleSpecifier.getText(file)};`] : [];
}).join('\n');

async function fixtureBundle() {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { loader: 'tsx', resolveDir: dirname(fileURLToPath(widgetUrl)), contents: `
${imports}
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
const root = createRoot(document.querySelector('main'));
const part = { type: 'image', asset: { mimeType: 'image/png', sizeBytes: 128, sha256: 'a'.repeat(64) } };
class Base { onUpdateRequest() { flushSync(() => root.render(<div className='nmx-shell' onContextMenu={event => this.handleLibraryChatContextMenu(event)}>{this.renderWindowParts()}</div>)); } }
class NextMuxDesktopWidget extends Base {
 static CONTEXT_PANEL_MIN_WIDTH=200;
 activeSection='coding'; desktopLocale='en'; contextPanelWidth=260; contextPanelCollapsed=false;
 navigationBackStack=[]; navigationForwardStack=[]; onboardingStep='done'; workContextOpen=false;workContextWasOpen=false;
 codingSessions=[];workspaceOptions=[];codingHistoryProjects=[];hiddenProjectPaths=new Set();expandedProjectConversationLists=new Set();
 codingSearchQuery='';codingSearchOpen=false;codingSessionPageCursors=new Map();codingSessionPagesLoading=new Set();
 notifications=[];sidebarFlip={ref:()=>{}};codingPanel='thread';codingPopover='';
 comicLibrary={projects:[]};comicLibraryQuery='';comicStage='idle';comicLibraryUploading=false;comicLibraryUploadQueue=[];
 comicChatState={foldersLoaded:true,folders:[],lists:new Map(),surface:'chat',target:'',prompt:'comic draft'};
 comicCharacterLibrary=[];comicCharacterLibraryBusy=false;comicLibraryCreating=false;
 activeComicWorkspaceRoot='/comic';comicWorkspaceRoot='/comic';mediaWorkspaceRoot='/comic';activeCodingSessionId='coding-id';
 agentOutputAssetUrls=new Map([['media',{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII='}]]);
 agentOutputAssetErrors=new Set(); calls=[]; node=document.querySelector('main');
 platformService={listComicAssetLibrary:async()=>[],saveComicLocalAssetToLibrary:async request=>{this.calls.push(['save',request]);return {assetName:'saved'};}};
 fileDialogService={showOpenDialog:async()=>{this.calls.push(['filePicker']);return undefined;}};
 update(){this.onUpdateRequest({});} tx(key){return key;}comicChatT(key){return key;}
 orderedCodingSessions(items){return items;}orderedComicProjects(items){return items;}
 comicChatUi(){return this.comicChatState;}activeComicChat(){return {id:'comic-id'};}
 renderContextAccountDock(){return <footer data-account-dock/>;}renderBrandMark(){return null;}
 hasDismissibleSurface(){return false;}contextPanelMaximumWidth(){return 400;}
 guard(_name,render){return render();}
 renderTitlebarPrimaryNavigation(){return null;}renderWorkContextTitlebar(){return null;}renderConversationWindowMenu(){return null;}
 renderWorkContext(){return null;}renderCheckpointDiffSheet(){return null;}renderWalletTopupSheet(){return null;}
 renderFeedbackDialog(){return null;}renderRelaySwitchConfirmation(){return null;}
 renderCodingWorkbench(){return <div className='nmx-task-view'><p id='chat-text'>Coding text</p>{this.renderAssistantOutput('',[part],'owner','turn')}<div id='turn-menu'>{this.renderTurnMessageMenuItems('coding-id',{id:'turn'},'assistant','Coding text',false)}</div></div>;}
 renderComicWorkbench(){return <div className='nmx-comic-chat-thread'><p id='chat-text'>Comic text</p>{this.renderAssistantOutput('',[part],'comic-owner','turn')}</div>;}
 renderModelCenter(){return null;}renderSettings(){return null;}
 renderAssistantResponse(text){return <p>{text}</p>;}agentOutputAssetKey(){return 'media';}loadAgentOutputAsset(){throw Error('unexpected asset loading');}
 stopVoiceInput(){}rememberNavigation(){}syncModelRoute(){}loadComicLibrary(){}refreshComicCharacterLibrary(){}loadContextFiles(){}
 constrainPaneSizes(){}persistDesktopRestoreState(){}syncThreadFloatBounds(){}scheduleAgentChildScrollSync(){}
 scheduleContextFileListScrollRestore(){}localizeRenderedSurface(){}comicStepMediaRoute(){return undefined;}
 addNotification(...args){this.calls.push(['notification',...args]);}comicCanvasIsTracked(){return false;}
 ${members.map(member => member.getText(file)).join('\n')}
}
window.fixture=new NextMuxDesktopWidget();window.fixture.update();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, alias: {
        react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'),
        'react-dom/client': core.resolve('react-dom/client'), '@theia/core/shared/react': core.resolve('react'), '@theia/core/shared/react-dom': core.resolve('react-dom')
    } });
    return outputFiles[0].text;
}

test('actual widget React keeps the comic library out of Coding, including navigation and stale actions', { timeout: 45000 }, async t => {
    const bundle = await fixtureBundle();
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []));
    await page.setRequestInterception(true); page.on('request', request => void request.respond({ status: 200, contentType: 'text/html', body: '<main></main>' }));
    await page.goto('https://comic-section-isolation.test/');
    for (const name of ['nextmux-comic-canvas.css','nextmux-comic-asset-library.css']) await page.addStyleTag({ content: await readFile(new URL('../src/browser/style/'+name, import.meta.url),'utf8') });
    await page.addScriptTag({ content: bundle }); await page.waitForSelector('.nmx-coding-context');
    assert.equal(await page.$('.nmx-comic-cast-button'), null, 'Coding sidebar has no comic library');
    assert.equal(await page.$('#turn-menu .codicon-library'), null, 'Coding message menu has no comic save');
    assert.equal(await page.$('.nmx-assistant-media figcaption .codicon-library'), null, 'Coding generated media has no comic save');
    assert.ok(await page.$('.nmx-assistant-media img'), 'the media output itself stays available');
    const selectAndContext = () => {
        const text=document.querySelector('#chat-text'),range=document.createRange(); range.selectNodeContents(text);
        getSelection().removeAllRanges();getSelection().addRange(range);
        const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:30,clientY:40});text.dispatchEvent(event);
        return event.defaultPrevented;
    };
    assert.equal(await page.evaluate(selectAndContext), false, 'Coding native right click remains available');
    assert.equal(await page.$('.nmx-comic-chat-menu'), null);
    await page.evaluate(async()=>{
        const f=window.fixture;f.openLibrarySaveMenu({clientX:1,clientY:2},'stale',{textContent:'coding'});
        f.openComicCastLibrary();await f.saveChatLibraryAsset('stale',{textContent:'coding'});await f.uploadComicLibraryFiles();
    });
    assert.deepEqual(await page.evaluate(()=>window.fixture.calls), [], 'stale comic actions cannot launch file pickers or save Coding content');

    await page.evaluate(()=>window.fixture.selectSection('comic'));
    await page.waitForSelector('.nmx-comic-cast-button');
    assert.ok(await page.$('.nmx-assistant-media figcaption .codicon-library'), 'Comic generated media retains save');
    assert.equal(await page.evaluate(selectAndContext), true);
    assert.match(await page.evaluate(()=>window.fixture.comicLibraryContextMenu.key), /^selected:\/comic:comic-id:/);
    await page.evaluate(()=>{window.fixture.comicLibraryContextMenu=undefined;window.fixture.update();});
    await page.click('.nmx-comic-cast-button');
    await page.waitForSelector('[role=dialog][aria-label="Asset library"]');
    await page.evaluate(()=>window.fixture.selectSection('coding'));
    assert.equal(await page.$('[role=dialog]'), null, 'leaving Comic unmounts the real portal dialog');
    assert.equal(await page.$('.nmx-comic-cast-button'), null);
    await page.evaluate(()=>window.fixture.selectSection('comic'));
    assert.equal(await page.$('[role=dialog]'), null, 'returning to Comic does not resurrect a dismissed library');

    await page.evaluate(()=>{const f=window.fixture;f.comicCastLibraryOpen=true;f.comicCharacterFromUnified=true;f.comicChatState.castSeed={imagePath:'/comic/portrait.png',imageName:'portrait'};f.update();});
    await page.waitForSelector('.nmx-cast-library');
    await page.evaluate(()=>{
        const f=window.fixture;f.savedCastClose=f.renderComicCastLibrary().props.onClose;
        f.comicUnifiedLibraryFilter='all';f.savedManage=f.renderUnifiedComicAssetLibrary().props.children.props.onManageCharacters;
        // History, restore and deep links assign the section directly, then send an update.
        f.activeSection='coding';f.update();f.savedCastClose();f.savedManage();
    });
    assert.equal(await page.$('[role=dialog]'), null);
    assert.deepEqual(await page.evaluate(()=>{const f=window.fixture;return {library:f.comicUnifiedLibraryFilter??null,cast:f.comicCastLibraryOpen,menu:f.comicLibraryContextMenu??null,seed:f.comicChatState.castSeed??null,fromUnified:f.comicCharacterFromUnified,draft:f.comicChatState.prompt};}),
        {library:null,cast:false,menu:null,seed:null,fromUnified:false,draft:'comic draft'}, 'clear only transient library UI, preserving the comic conversation draft');
    assert.equal(await page.evaluate(()=>{const f=window.fixture;f.comicUnifiedLibraryFilter='all';f.comicCastLibraryOpen=true;return f.renderUnifiedComicAssetLibrary()===undefined&&f.renderComicCastLibrary()===undefined;}), true, 'render methods defend against stale state before a lifecycle update');
    await page.evaluate(()=>window.fixture.update());
    await page.evaluate(()=>window.fixture.selectSection('comic'));
    assert.equal(await page.$('[role=dialog]'), null);
    assert.ok(await page.$('.nmx-comic-cast-button'), 'the comic library remains reachable after repeated switches');
});
