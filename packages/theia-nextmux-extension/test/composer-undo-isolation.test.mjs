import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { desktopEditorShortcutPlan } from '../../../scripts/desktop-editor-shortcuts.mjs';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';

const require = createRequire(import.meta.url);
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const core = createRequire(require.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);
const source = await readFile(widgetUrl, 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxDesktopWidget');
const method = name => widget.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(file) === name).getText(file);
test('literal permission labels use the existing catalog in all twelve desktop languages', async () => {
    const Harness = Function('localizeDesktopSurface', ts.transpile(`class Harness { ${method('permissionLabel')} }; return Harness;`, {target:ts.ScriptTarget.ES2022}))(localizeDesktopSurface);
    const catalog = JSON.parse(await readFile(new URL('../src/browser/nextmux-surface-translations.json', import.meta.url), 'utf8'));
    const keys = ['只读','工作区写入','完全访问'], modes = ['read_only','workspace_write','full_access'];
    for (const locale of ['zh-CN','zh-TW','en','ja','ko','es','fr','de','pt-BR','ru','ar','hi']) {
        const h=Object.assign(new Harness(),{desktopLocale:locale});
        for (const [i,mode] of modes.entries()) {
            if(locale!=='zh-CN') assert.ok(catalog[locale][keys[i]], `${locale} has an existing explicit translation`);
            assert.equal(h.permissionLabel(mode),localizeDesktopSurface(locale,keys[i]));
            if(locale!=='zh-CN') assert.notEqual(h.permissionLabel(mode),keys[i]);
        }
    }
});
let composer, editor;
function visit(n) {
    if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && (n.openingElement || n).tagName.getText(file) === 'textarea') {
        const text = n.getText(file);
        if (text.includes('ref={this.composerTextareaRef}')) composer = text;
        if (text.includes('value={this.editingTurnValue}')) editor = text;
    }
    ts.forEachChild(n, visit);
}
visit(widget); assert.ok(composer); assert.ok(editor);
const methods = ['composerInputOwner', 'composerInputKey', 'ownsComposerInput', 'setComposerPrompt',
    'ensureCodingSession', 'scheduleComposerDraftPersist', 'captureEditingCommandTarget', 'nativeEditingTarget',
    'nativeTextSelection', 'canRunEditingCommand', 'commandRunEditingCommand', 'handleComposerKeyDown',
    'navigationSnapshot', 'applyNavigationSnapshot', 'navigateBack', 'navigateForward', 'flushComposerDraft', 'restoreComposerDraft'].map(method).join('\n');
const historySource = await readFile(new URL('../src/browser/nextmux-conversation-history.ts', import.meta.url), 'utf8');
const historyFile = ts.createSourceFile('history.ts', historySource, ts.ScriptTarget.Latest, true);
const reuse = historyFile.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'reusableConversationForWorkspace').getText(historyFile).replace(/^export /, '');
async function bundle(legacy = false) {
    let input = composer, bodies = methods;
    if (legacy) {
        input = input.replace('key={this.composerInputKey()} data-composer-input-scope={this.composerInputKey()} ', '')
            .replaceAll('if (!this.ownsComposerInput(event.currentTarget)) return;', '');
        bodies = bodies.replace('!textarea || !this.ownsComposerInput(textarea) || textarea.value === value', '!textarea || textarea.value === value');
    }
    const { outputFiles } = await desktop('esbuild').build({ stdin: { loader: 'tsx', resolveDir: dirname(fileURLToPath(widgetUrl)), contents: `
import * as React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
import { ComposerInputScope } from './nextmux-composer-input-scope';
import { editingCommandEnabled } from './nextmux-desktop-editing-context';
import { removeAdjacentComposerLink } from './nextmux-markdown';
import { shouldSubmitComposerKey } from './nextmux-system-dictation';
${reuse}
const pastedTextReferencesInDocument = (_p, refs) => refs;
const conversationText = (_l, key) => key;
const normalizeDesktopSettingsPanel = p => p;
const normalizeAgentChildScrollStates = s => s || {};
const deserializePastedTextReferences = text => text ? JSON.parse(text) : [];
class Fixture {
  node = document.querySelector('main'); composerInputScope = new ComposerInputScope(); composerTextareaRef = React.createRef(); composerMarkdownOverlayRef = {current:null};
  activeCodingSessionId = 'A'; activeWorkspaceRoot = ''; globalCodingDraft = false; draftWorkspaceRoot = ''; prompt = '';
  codingSessions = ['A','B'].map(id => ({id, workspacePath:'', turns:[], titleOrigin:'default', draftPrompt:''}));
  expandedCodingProjects = new Set(); composerComposing = false; goalComposerActive = false; goalComposerSessionId = '';
  attachments=[]; pastedTextReferences=[]; editingTurnId=''; editingTurnValue=''; submitted=0;
  unpersistedPastedTextReferences=new Map();draftAttachmentRestores=new Map();
  activeSection='coding';codingPanel='thread';scheduledTasks=[];workspaceOptions=[];navigationBackStack=[];navigationForwardStack=[];codingSessionNavigationGeneration=0;
  ${bodies}
  activeCodingSession(){return this.codingSessions.find(s=>s.id===this.activeCodingSessionId);}
  workspaceRootIsOpen(){return true;} codingSessionTitle(p){return p;} activeModelRoute(){} reasoningSettingsForRoute(){return{};}
  currentCodingSessionViewState(){return{};} persistCodingSessions(){} persistDesktopRestoreState(){}
  detachContextEditorRecovery(){return true;} conversationHasActiveRun(){return false;} sessionPermissionMode(){return 'read_only';}
  syncActiveTerminal(){} syncActiveBrowser(){} restoreCodingViewState(){} applyNavigationSurface(){} constrainPaneSizes(){} navigationSurface(){return undefined;}
  restoreCodingSourceSelection(s){this.activeModelRouteId=s?.routeId;this.activeKeyPriceQuoteId=s?.keyPriceQuoteId;}
  persistActiveCodingSessionState(){} dismissTopSurface(){}
  persistComposerDraft(){ const s=this.activeCodingSession(); if(s)s.draftPrompt=this.prompt; }
  scheduleComposerUiUpdate(){this.update();} syncComposerDomControls(){} composerRows(){return 3;} composerApp(){} submitPrompt(){this.submitted++;}
  cancelTurnEdit(){this.editingTurnId='';this.update();} requestTurnEditConfirmation(){throw new Error('No sending in undo fixture');}
  render(){const codingSession=this.activeCodingSession(), agentRunning=false; const turn={id:this.editingTurnId}; return <><div className='nmx-composer'>${input}</div>{this.editingTurnId ? <section key={codingSession.id+':'+this.editingTurnId}>${editor}</section>:null}</>;}
  update(){flushSync(()=>root.render(this.render()));}
  open(id){ this.persistComposerDraft(); this.activeCodingSessionId=id; this.editingTurnId=''; this.goalComposerActive=false;
    this.setComposerPrompt(this.activeCodingSession()?.draftPrompt || ''); this.update(); }
  fresh(){this.persistComposerDraft(); this.composerInputScope.reset(); this.setComposerPrompt('');this.activeCodingSessionId='';this.globalCodingDraft=true;this.update();}
  goal(active){this.goalComposerActive=active;this.goalComposerSessionId=active?this.activeCodingSessionId:'';this.setComposerPrompt(active?'GOAL':'MESSAGE');this.update();}
}
const root=createRoot(document.querySelector('main')); window.f=new Fixture(); window.f.update();
document.querySelector('main').addEventListener('focusin', e=>window.f.captureEditingCommandTarget(e.target));
` }, bundle:true, write:false, platform:'browser', format:'iife', alias:{react:core.resolve('react'), 'react-dom/client':core.resolve('react-dom/client'), 'react-dom':core.resolve('react-dom')} });
    return outputFiles[0].text;
}

test('real Chromium native undo stays within the mounted conversation input owner', async t => {
    const fixed = await bundle(), legacy = await bundle(true), evidence=[];
    const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<main></main><script>'+ (req.url==='/legacy'?legacy:fixed) +'</script>');});
    await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>server.close(r)));
    const browser=await puppeteer.launch({headless:true}); t.after(()=>browser.close());
    const setup=async (old=false)=>{
        const page=await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/${old?'legacy':''}`); await page.waitForSelector('.nmx-composer textarea');
        const client=await page.createCDPSession();
        const focus=()=>page.focus('.nmx-composer textarea');
        const type=async text=>{await focus();await client.send('Input.insertText',{text});};
        const key=async action=>{await focus();for(const e of desktopEditorShortcutPlan(action,process.platform))await client.send('Input.dispatchKeyEvent',e.type==='rawKeyDown'&&e.code==='KeyZ'?{...e,commands:[action]}:e);};
        const menu=async command=>page.evaluate(command=>window.f.commandRunEditingCommand(command),command);
        const state=()=>page.evaluate(()=>({id:f.activeCodingSessionId,prompt:f.prompt,value:f.composerTextareaRef.current.value,focused:document.activeElement===f.composerTextareaRef.current,composing:f.composerComposing,drafts:f.codingSessions.map(s=>({id:s.id,text:s.draftPrompt}))}));
        return {page,client,focus,type,key,menu,state};
    };
    await t.test('negative control reproduces B redo inserted into A using pre-fix DOM reuse',async()=>{
        const h=await setup(true); await h.type('A_ONLY'); await h.page.evaluate(()=>f.open('B')); await h.type('B_ONLY');
        await h.page.evaluate(()=>f.open('A')); await h.key('undo'); await h.key('redo'); const s=await h.state();
        evidence.push({case:'legacy-negative-control',...s}); assert.ok(s.prompt.includes('B_ONLY'),'old composer must reproduce the real cross-owner history failure'); await h.page.close();
    });
    await t.test('B→A keyboard undo/redo and Edit menu leave restored A and B drafts isolated',async()=>{
        const h=await setup(); await h.type('A_ONLY'); await h.page.evaluate(()=>{window.old=f.composerTextareaRef.current;f.open('B');});
        assert.equal(await h.page.evaluate(()=>old===f.composerTextareaRef.current),false); await h.type('B_ONLY');
        await h.page.evaluate(()=>{window.old=f.composerTextareaRef.current;f.open('A');}); await h.key('undo'); await h.key('redo');
        await h.menu('undo');await h.menu('redo'); assert.equal((await h.state()).prompt,'A_ONLY');
        assert.equal(await h.page.evaluate(()=>old.isConnected),false);
        await h.page.evaluate(()=>{const e=f.composerTextareaRef.current;e.setSelectionRange(e.value.length,e.value.length);});await h.type('_A_APPEND'); await h.page.evaluate(()=>f.open('B')); await h.key('undo'); await h.key('redo');await h.menu('undo');await h.menu('redo');
        assert.equal((await h.state()).prompt,'B_ONLY'); await h.page.evaluate(()=>f.open('A')); assert.equal((await h.state()).value,'A_ONLY_A_APPEND');
        evidence.push({case:'switch-keyboard-menu',...await h.state()}); await h.page.close();
    });
    await t.test('same owner keeps DOM, focus, selection and native history through background renders',async()=>{
        const h=await setup(); await h.type('ALPHA'); await h.page.evaluate(()=>{window.old=f.composerTextareaRef.current;old.setSelectionRange(1,4);for(let i=0;i<20;i++)f.update();});
        assert.deepEqual(await h.page.evaluate(()=>[old===f.composerTextareaRef.current,document.activeElement===old,old.selectionStart,old.selectionEnd]),[true,true,1,4]);
        await h.type('BETA'); assert.equal((await h.state()).prompt,'ABETAA'); await h.menu('undo'); assert.equal((await h.state()).prompt,'ALPHA');
        await h.menu('redo'); assert.equal((await h.state()).prompt,'ABETAA'); evidence.push({case:'same-owner-background',...await h.state()}); await h.page.close();
    });
    await t.test('identical drafts and an application clear cannot reopen another owner history',async()=>{
        const h=await setup(); await h.type('SAME');await h.page.evaluate(()=>{f.codingSessions.find(s=>s.id==='B').draftPrompt='SAME';f.open('B');});
        await h.key('undo');await h.key('redo');assert.equal((await h.state()).prompt,'SAME');await h.type('_B');
        await h.page.evaluate(()=>{f.setComposerPrompt('');f.persistComposerDraft();f.update();f.open('A');});
        await h.key('undo');await h.key('redo');assert.equal((await h.state()).prompt,'SAME');await h.page.evaluate(()=>f.open('B'));assert.equal((await h.state()).prompt,'');
        await h.menu('undo');await h.menu('redo');assert.equal((await h.state()).prompt,'');await h.page.close();
    });
    await t.test('first input promotes a draft without replacing an active IME target; old composition cannot change a new owner',async()=>{
        const h=await setup();await h.page.evaluate(()=>f.fresh());await h.focus();await h.page.evaluate(()=>window.old=f.composerTextareaRef.current);
        await h.client.send('Input.imeSetComposition',{text:'ni',selectionStart:2,selectionEnd:2});
        assert.equal(await h.page.evaluate(()=>old===f.composerTextareaRef.current&&f.activeCodingSessionId!==''&&f.composerComposing),true);
        await h.page.evaluate(()=>{for(let i=0;i<10;i++)f.update();});assert.equal(await h.page.evaluate(()=>old===document.activeElement),true);
        await h.client.send('Input.insertText',{text:'你好'});assert.equal((await h.state()).prompt,'你好');assert.equal((await h.state()).composing,false);
        await h.page.evaluate(()=>{f.open('B');old.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'迟到'}));old.dispatchEvent(new InputEvent('input',{bubbles:true,data:'迟到'}));});
        assert.equal((await h.state()).prompt,'');assert.equal((await h.state()).composing,false);evidence.push({case:'draft-ime',...await h.state()});await h.page.close();
    });
    await t.test('fresh drafts, goal mode and historical message editors do not share editing histories',async()=>{
        const h=await setup();await h.type('A_MESSAGE');await h.page.evaluate(()=>f.goal(true));await h.type('_GOAL_ONLY');await h.page.evaluate(()=>f.goal(false));
        await h.key('undo');await h.key('redo');assert.equal((await h.state()).prompt,'MESSAGE');
        await h.page.evaluate(()=>{f.editingTurnId='T1';f.editingTurnValue='HISTORY_ONE';f.update();});await h.page.focus('section textarea');await h.client.send('Input.insertText',{text:'_EDIT_ONE'});
        await h.page.evaluate(()=>{window.editorOld=document.querySelector('section textarea');f.editingTurnId='T2';f.editingTurnValue='HISTORY_TWO';f.update();});
        await h.page.focus('section textarea');await h.menu('undo');await h.menu('redo');assert.equal(await h.page.$eval('section textarea',e=>e.value),'HISTORY_TWO');
        await h.page.evaluate(()=>{f.cancelTurnEdit();f.fresh();});await h.key('undo');await h.key('redo');assert.equal((await h.state()).prompt,'');
        await h.type('NEW_DRAFT');await h.page.evaluate(()=>f.fresh());await h.menu('undo');await h.menu('redo');assert.equal((await h.state()).prompt,'');await h.page.close();
    });
    await t.test('before React commits owner navigation, setters and late old-node events are ignored; cached menu target disconnects',async()=>{
        const h=await setup();await h.type('A_OLD');await h.page.evaluate(()=>{window.old=f.composerTextareaRef.current;f.activeCodingSessionId='B';f.setComposerPrompt('B_NEW');});
        assert.equal(await h.page.evaluate(()=>old.value),'A_OLD');await h.client.send('Input.insertText',{text:'_LATE'});assert.equal((await h.state()).prompt,'B_NEW');
        await h.client.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        assert.equal(await h.page.evaluate(()=>f.submitted),0,'old-owner Enter must not submit the current conversation');
        await h.page.evaluate(()=>{f.composerMarkdownOverlayRef.current={scrollTop:17,scrollLeft:19};old.dispatchEvent(new Event('scroll',{bubbles:true}));});
        assert.deepEqual(await h.page.evaluate(()=>f.composerMarkdownOverlayRef.current),{scrollTop:17,scrollLeft:19});
        await h.page.evaluate(()=>f.update());assert.equal(await h.page.evaluate(()=>f.nativeEditingTarget()===undefined),true);
        await h.menu('undo');await h.menu('redo');assert.equal((await h.state()).prompt,'B_NEW');await h.focus();await h.menu('undo');await h.menu('redo');assert.equal((await h.state()).prompt,'B_NEW');
        evidence.push({case:'deferred-commit',...await h.state()});await h.page.close();
    });
    await t.test('real Back/Forward methods restore their own drafts and saved routes while same-owner panels retain undo',async()=>{
        const h=await setup();await h.type('A_BACK');await h.page.evaluate(()=>{
            f.codingSessions[0].routeId='routeA';f.codingSessions[0].keyPriceQuoteId='quoteA';
            f.codingSessions[1].routeId='routeB';f.codingSessions[1].keyPriceQuoteId='quoteB';
            f.navigationBackStack=[f.navigationSnapshot()];f.open('B');f.activeModelRouteId='routeB';f.activeKeyPriceQuoteId='quoteB';
        });await h.type('B_FORWARD');await h.page.evaluate(()=>f.navigateBack());
        assert.equal((await h.state()).prompt,'A_BACK');assert.deepEqual(await h.page.evaluate(()=>[f.activeModelRouteId,f.activeKeyPriceQuoteId]),['routeA','quoteA']);
        await h.key('undo');await h.key('redo');assert.equal((await h.state()).prompt,'A_BACK');
        await h.page.evaluate(()=>f.navigateForward());assert.equal((await h.state()).prompt,'B_FORWARD');
        assert.deepEqual(await h.page.evaluate(()=>[f.activeModelRouteId,f.activeKeyPriceQuoteId]),['routeB','quoteB']);
        await h.page.evaluate(()=>{window.old=f.composerTextareaRef.current;old.focus();old.setSelectionRange(old.value.length,old.value.length);});await h.type('_LOCAL');
        await h.page.evaluate(()=>f.applyNavigationSnapshot({...f.navigationSnapshot(),codingPanel:'files'}));
        assert.equal(await h.page.evaluate(()=>old===f.composerTextareaRef.current),true);await h.menu('undo');assert.equal((await h.state()).prompt,'B_FORWARD');
        await h.menu('redo');assert.equal((await h.state()).prompt,'B_FORWARD_LOCAL');evidence.push({case:'back-forward',...await h.state()});await h.page.close();
    });
    if(process.env.NEXTMUX_UNDO_EVIDENCE)await writeFile(process.env.NEXTMUX_UNDO_EVIDENCE,JSON.stringify({at:new Date().toISOString(),browser:await browser.version(),evidence},null,2));
});
