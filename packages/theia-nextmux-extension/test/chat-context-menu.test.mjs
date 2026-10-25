import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Script } from 'node:vm';
import ts from 'typescript';
import { chatContextText, chatMenuPosition, chatContextAppendText } from '../lib/browser/nextmux-chat-context-menu.js';

const require = createRequire(import.meta.url);
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const core = createRequire(require.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);
const source = await readFile(widgetUrl, 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxDesktopWidget');
const method = name => widget.members.find(n => (ts.isMethodDeclaration(n) || ts.isPropertyDeclaration(n)) && n.name.getText(file) === name).getText(file);

test('all twelve locales have six distinct actions and geometry flips inside the message bounds', () => {
    for (const locale of ['zh-CN','zh-TW','en','ja','ko','es','fr','de','pt-BR','ru','ar','hi']) {
        const labels = ['copyLink','copyText','sendText','sendLink','openBuiltin','openSystem'].map(key => chatContextText(locale, key));
        assert.equal(new Set(labels).size, 6); assert.ok(labels.every(label => label.trim()));
        assert.ok(chatContextText(locale,'copySelection').trim());assert.ok(chatContextText(locale,'sendSelection').trim());
        assert.notEqual(chatContextText(locale,'copySelection'),chatContextText(locale,'copyText'));
        assert.notEqual(chatContextText(locale,'sendSelection'),chatContextText(locale,'sendText'));
    }
    assert.deepEqual(['copySelection','sendSelection'].map(key=>chatContextText('zh-CN',key)),['复制','发送到输入框']);
    const bounds = {left:20,top:60,right:280,bottom:190};
    const nearEdge = chatMenuPosition(277,188,220,190,bounds);
    assert.deepEqual(nearEdge, {left:56,top:64,maxWidth:252,maxHeight:122});
    assert.deepEqual(chatMenuPosition(-90,-20,999,999,bounds), {left:24,top:64,maxWidth:252,maxHeight:122});
    assert.equal(chatContextAppendText('old','new'), 'old\nnew');
    assert.equal(chatContextAppendText('old\n','new'), 'old\nnew');
    assert.equal(chatContextAppendText('','new'), 'new');
});

async function bundle() {
    const bodies = ['composerInputOwner','composerInputKey','ownsComposerInput','setComposerPrompt',
        'chatContextOwner','chatContextComposer','handleChatContextMenu','chatContextBounds','appendChatContextDraft',
        'performChatContextAction','renderChatContextMenu','resolveConversationTarget','openConversationFileLink','handleAssistantContentClick','conversationFileEvidence','decorateConversationContent',
        'classifyLocalFileCandidate','beginContextFileOpen','finishContextFileOpen','fileActivityRootContains'].map(method).join('\n');
    const {outputFiles} = await desktop('esbuild').build({stdin:{loader:'tsx', resolveDir:dirname(fileURLToPath(widgetUrl)), contents:`
import * as React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import {ComposerInputScope} from './nextmux-composer-input-scope';
import {NextMuxLinkOpeningPolicy} from './nextmux-link-opening';
import {ChatContextMenu, chatContextTarget, chatContextAppendText, appendChatContextToInput} from './nextmux-chat-context-menu';
import URI from '@theia/core/lib/common/uri';
import {FileUri} from '@theia/core/lib/common/file-uri';
import {conversationFileUri, conversationTurnFileEvidence, resolveConversationFileTarget} from './nextmux-conversation-file-target';
import {conversationMediaKind, decorateConversationMedia, isLocalConversationTarget, isValidLocalFileLinkCandidate} from './nextmux-conversation-media';
import {renderConversationMarkdownHtml} from './nextmux-conversation-markdown';
import {decorateConversationLinks} from './nextmux-markdown';
const conversationText = (_l,key)=>key;
const linkOpeningText = (_l,key)=>key;
const localizeDesktopSurface=(_l,key)=>key;
const filePreviewErrorText=(_l,key)=>key;
const FileOperationResult={FILE_NOT_FOUND:1}; const toFileOperationResult=error=>error?.fileOperationResult;
class Fixture {
 node=document.querySelector('main'); desktopLocale='en'; activeSection='coding'; codingPanel='thread'; activeCodingSessionId='A'; activeWorkspaceRoot='';
 activeComicWorkspaceRoot='comic-A'; globalCodingDraft=false; draftWorkspaceRoot=''; goalComposerActive=false; goalComposerSessionId='';
 composerInputScope=new ComposerInputScope(); composerTextareaRef=React.createRef(); composerComposing=false;
 prompt=''; drafts={A:'',B:''}; attachments=[{id:'keep',name:'fixture.txt'}]; copied=[]; opened=[]; submitted=0; persisted=0; bubbled=[];
 comicId='comic-A'; comicPrompt='comic draft'; chatContextMenu=undefined; files=[]; resolvedFiles=[]; warnings=[]; inside=true; turns=[]; activities=[];
 contextFilePreviewRequestToken=0;contextFileChildren=new Map();workContextMode='browser';contextFilePreviewLoading=false;
 fileService={resolve:async uri=>{this.resolvedFiles.push({path:FileUri.fsPath(uri)});return {isDirectory:false};}};
 platformService={resolveWorkspaceFile:async(root,path)=>{this.resolvedFiles.push({root,path});return {inside:this.inside,path};}};
 store=new Map(); linkOpeningPolicy=new NextMuxLinkOpeningPolicy({getItem:k=>this.store.get(k)??null,setItem:(k,v)=>this.store.set(k,v),removeItem:k=>this.store.delete(k)});
 ${bodies}
 scheduleComposerDraftPersist(){this.persisted++;this.drafts[this.activeCodingSessionId]=this.prompt;}
 copyToClipboard(value){this.copied.push(value);return Promise.resolve();}
 performConversationLinkDecision(decision){this.opened.push(decision);if(decision.action==='open-file-drawer')void this.openConversationFileLink(decision.target);}
 requestConversationLinkOpen(target){this.performConversationLinkDecision(this.linkOpeningPolicy.decide(target));}
 activeCodingSession(){return {turns:this.turns};}
 codingSessionWorkspaceRoot(){return this.activeWorkspaceRoot;}
 openContextFile(uri,range){const u=new URI(uri),path=u.authority?'//'+u.authority+u.path.toString():FileUri.fsPath(u);this.activities.push({title:path,kind:'workspace.read_file',resource:{kind:'file',action:'read',path,...(range?{startLine:range.startLine,endLine:range.endLine}:{})}});this.files.push({uri,range});this.finishContextFileOpen();return Promise.resolve();}
 openToolFileActivity(summary){this.activities.push(summary);const resource=summary.resource;this.files.push({uri:conversationFileUri(resource.path).toString(),range:resource.startLine?{startLine:resource.startLine,endLine:resource.endLine}:undefined});this.finishContextFileOpen();return Promise.resolve();}
 rememberContextFileTab(){} detachContextEditorRecovery(){return true;} loadContextDirectory(){return Promise.resolve();}
 addNotification(...args){this.warnings.push(args);}
 openConversationMedia(){return false;}
 comicChatUi(){return {surface:'chat',target:'project',chatId:this.comicId};}
 setComicChatPrompt(value){this.comicPrompt=value;this.update();}
 open(id){this.drafts[this.activeCodingSessionId]=this.prompt;this.activeCodingSessionId=id;this.setComposerPrompt(this.drafts[id]);this.update();}
 render(){return <div className='nmx-shell' onContextMenu={e=>{this.handleChatContextMenu(e);this.bubbled.push(e.defaultPrevented);}}>
  <header className='nmx-coding-topbar'>Status</header><section className={this.activeSection==='comic'?'nmx-comic-chat-thread':'nmx-task-view'}>
   <p className='nmx-user-message' id='plain'>Selected ordinary message</p>
   <div className='nmx-assistant-markdown'><p id='markdown'>Markdown body selection</p><a id='link' data-href='https://example.com/path?x=1#part' href='#'><strong>Visible label</strong></a>
    <a id='unsafe' href='javascript:alert(1)'>Unsafe link</a><input id='native-input' defaultValue='Native input'/><div id='native-editor' contentEditable='plaintext-only' suppressContentEditableWarning>Editable text</div>
    <img id='asset' alt='Existing media'/><button id='native-button'>Existing action</button></div>
    <section className='nmx-task-turn' data-turn-id='turn-A'><div id='file-markdown' className='nmx-assistant-markdown' onClick={e=>this.handleAssistantContentClick(e)}></div></section>
  </section><footer className={this.activeSection==='comic'?'nmx-comic-chat-dock':'nmx-composer-dock'}>
   {this.activeSection==='comic'?<textarea key={this.comicId} value={this.comicPrompt} maxLength={12000} onChange={e=>this.setComicChatPrompt(e.currentTarget.value)}/>:
   <textarea key={this.composerInputKey()} data-composer-input-scope={this.composerInputKey()} ref={this.composerTextareaRef} defaultValue={this.prompt}
     onInput={e=>{if(this.ownsComposerInput(e.currentTarget)){this.prompt=e.currentTarget.value;this.scheduleComposerDraftPersist();}}}/>}</footer>
  {this.renderChatContextMenu()}</div>;}
 update(){flushSync(()=>root.render(this.render()));}
}
const root=createRoot(document.querySelector('main')); window.f=new Fixture(); f.update();
window.selectText = id => {const node=document.getElementById(id).firstChild,range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);const r=range.getClientRects()[0];return {x:r.left+3,y:r.top+3};};
window.mountFile = (markdown,workspace) => {f.activeWorkspaceRoot=workspace;const host=document.getElementById('file-markdown');host.innerHTML=renderConversationMarkdownHtml(markdown,'en');f.decorateConversationContent(host);return [...host.querySelectorAll('a')].map(a=>({href:a.getAttribute('data-href')||a.getAttribute('href'),path:a.dataset.nmxPath,kind:a.dataset.nmxFileLink}));};
`}, bundle:true, write:false, platform:'browser',format:'iife',jsx:'transform',alias:{react:core.resolve('react'),'react-dom/client':core.resolve('react-dom/client'),'react-dom':core.resolve('react-dom')}});
    return outputFiles[0].text;
}

test('actual widget handlers and menu run in isolated Chromium without reading the live app', async t => {
    const script=await bundle(), css=await readFile(new URL('../src/browser/style/nextmux-composer-attachments.css', import.meta.url),'utf8');
    new Script(script, {filename:'chat-context-fixture.js'});
    const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript; charset=utf-8');res.end(script);return;}res.setHeader('content-type','text/html; charset=utf-8');res.end('<meta charset="utf-8"><style>'+css+`
body{margin:0;font:14px Arial;--nmx-panel:#242424;--nmx-text-primary:#eee;--nmx-border:#555;--nmx-accent:rgb(80,160,255)}
.nmx-coding-topbar{position:fixed;top:0;left:0;right:0;height:50px}.nmx-task-view,.nmx-comic-chat-thread{position:fixed;top:50px;bottom:100px;left:30px;right:20px;overflow:auto}
.nmx-composer-dock,.nmx-comic-chat-dock{position:fixed;bottom:0;height:100px;left:30px;right:20px}textarea{width:90%;height:70px}#link{display:block;width:max-content;margin-top:12px}
</style><main></main><script src="/fixture.js"></script>`);});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
    const browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());
    const evidence=[];
    const setup=async(height=600)=>{const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack||error.message));await page.setViewport({width:500,height});await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForSelector('#link',{timeout:5000}).catch(error=>{throw new Error(errors.join('\n')||error.message);});return page;};
    const startup=await setup();await startup.close();
    const right=async(page,id)=>{const rect=await page.$eval(id,e=>{const r=e.getBoundingClientRect();return{x:r.left+4,y:r.top+4};});await page.mouse.click(rect.x,rect.y,{button:'right'});};
    const actions=page=>page.$$eval('[data-chat-context-action]',items=>items.map(e=>e.dataset.chatContextAction));
    const dismiss=async page=>{await page.keyboard.press('Escape');};
    await t.test('text links expose all six actions, copy actual href and visible label, and keep bubbling',async()=>{
        const page=await setup();await right(page,'#link strong');assert.deepEqual(await actions(page),['copyLink','copyText','sendText','sendLink','openBuiltin','openSystem']);
        assert.deepEqual(await page.$$eval('[data-chat-context-action]',items=>items.map(e=>e.textContent)),['Copy link','Copy text','Send text to input','Send link to input','Open in built-in browser','Open in system browser']);
        assert.equal(await page.evaluate(()=>f.bubbled.at(-1)),true);await page.click('[data-chat-context-action=copyLink]');
        await right(page,'#link');await page.click('[data-chat-context-action=copyText]');
        assert.deepEqual(await page.evaluate(()=>f.copied),['https://example.com/path?x=1#part','Visible label']);evidence.push({case:'link-six-actions',passed:true});await page.close();
    });
    await t.test('unselected text keeps native menu; an actual selection under the mouse gets only copy and append',async()=>{
        const page=await setup();await right(page,'#plain');assert.deepEqual(await actions(page),[]);assert.equal(await page.evaluate(()=>f.bubbled.at(-1)),false);
        const point=await page.evaluate(()=>selectText('plain'));await page.mouse.click(point.x,point.y,{button:'right'});
        assert.deepEqual(await actions(page),['copyText','sendText']);assert.deepEqual(await page.$$eval('[data-chat-context-action]',items=>items.map(e=>e.textContent)),['Copy','Send to input']);await page.click('[data-chat-context-action=copyText]');
        assert.deepEqual(await page.evaluate(()=>f.copied),['Selected ordinary message']);
        await page.evaluate(()=>selectText('plain'));await right(page,'#markdown');assert.deepEqual(await actions(page),[]);
        const mark=await page.evaluate(()=>selectText('markdown'));await page.mouse.click(mark.x,mark.y,{button:'right'});assert.equal((await actions(page)).length,2);
        await dismiss(page);await page.evaluate(()=>{f.desktopLocale='zh-CN';f.update();});const chinese=await page.evaluate(()=>selectText('plain'));await page.mouse.click(chinese.x,chinese.y,{button:'right'});
        assert.deepEqual(await page.$$eval('[data-chat-context-action]',items=>items.map(e=>e.textContent)),['复制','发送到输入框']);
        await dismiss(page);await right(page,'#link');assert.deepEqual(await page.$$eval('[data-chat-context-action]',items=>items.map(e=>e.textContent)),['复制链接','复制文本','发送文本到输入框','发送链接到输入框','内置浏览器打开','系统浏览器打开']);
        evidence.push({case:'selected-text-only',passed:true});await page.close();
    });
    await t.test('inputs, editable regions, buttons and media retain their existing context handling',async()=>{
        const page=await setup();for(const id of ['native-input','native-editor','native-button','asset']){
            await page.evaluate(id=>{const e=document.getElementById(id);e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:60,clientY:120}));},id);
            assert.deepEqual(await actions(page),[]);assert.equal(await page.evaluate(()=>f.bubbled.at(-1)),false,id);
        }await page.close();
    });
    await t.test('append preserves draft, attachment and native undo/redo, and never submits',async()=>{
        const page=await setup();const client=await page.createCDPSession();await page.focus('textarea');await client.send('Input.insertText',{text:'ORIGINAL'});
        await right(page,'#link');await page.click('[data-chat-context-action=sendText]');
        assert.deepEqual(await page.evaluate(()=>({value:f.composerTextareaRef.current.value,prompt:f.prompt,attachments:f.attachments,submitted:f.submitted})),{value:'ORIGINAL\nVisible label',prompt:'ORIGINAL\nVisible label',attachments:[{id:'keep',name:'fixture.txt'}],submitted:0});
        const edit=command=>client.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,commands:[command]});
        await edit('undo');assert.equal(await page.$eval('textarea',e=>e.value),'ORIGINAL');await edit('redo');assert.equal(await page.$eval('textarea',e=>e.value),'ORIGINAL\nVisible label');
        await edit('undo');await edit('undo');assert.equal(await page.$eval('textarea',e=>e.value),'');
        evidence.push({case:'native-undo-draft-attachments',passed:true});await page.close();
    });
    await t.test('conversation changes dismiss the menu and captured old actions cannot write into a new draft',async()=>{
        const page=await setup();await page.evaluate(()=>{f.setComposerPrompt('A draft');f.drafts.B='B draft';f.update();});await right(page,'#link');
        await page.evaluate(()=>{window.oldMenu=f.chatContextMenu;window.oldInput=f.composerTextareaRef.current;f.open('B');f.performChatContextAction(oldMenu,'sendText');});
        assert.deepEqual(await actions(page),[]);assert.equal(await page.$eval('textarea',e=>e.value),'B draft');assert.equal(await page.evaluate(()=>oldInput.isConnected),false);
        await page.evaluate(()=>f.open('A'));assert.equal(await page.$eval('textarea',e=>e.value),'A draft');await page.close();
    });
    await t.test('changing away from the chat view invalidates captured content; composition and capacity keep append disabled',async()=>{
        const page=await setup();await right(page,'#link');await page.evaluate(()=>{window.oldMenu=f.chatContextMenu;f.codingPanel='sites';f.update();f.performChatContextAction(oldMenu,'sendText');});
        assert.deepEqual(await actions(page),[]);assert.equal(await page.$eval('textarea',e=>e.value),'');
        await page.evaluate(()=>{f.codingPanel='thread';f.composerComposing=true;f.update();});await right(page,'#link');
        assert.equal(await page.$eval('[data-chat-context-action=sendText]',e=>e.disabled),true);await dismiss(page);
        await page.evaluate(()=>{f.composerComposing=false;f.composerTextareaRef.current.maxLength=2;f.update();});await right(page,'#link');
        assert.equal(await page.$eval('[data-chat-context-action=sendLink]',e=>e.disabled),true);await dismiss(page);
        await page.evaluate(()=>{f.composerTextareaRef.current.removeAttribute('maxlength');f.composerTextareaRef.current.readOnly=true;f.update();});await right(page,'#link');
        assert.equal(await page.$eval('[data-chat-context-action=sendText]',e=>e.disabled),true);await page.close();
    });
    await t.test('explicit browser menu actions reuse URL policy without changing the saved default',async()=>{
        const page=await setup();await page.evaluate(()=>f.linkOpeningPolicy.setPreference('system-browser'));const before=await page.evaluate(()=>[...f.store]);
        await right(page,'#link');await page.click('[data-chat-context-action=openBuiltin]');await right(page,'#link');await page.click('[data-chat-context-action=openSystem]');
        await right(page,'#unsafe');assert.deepEqual(await actions(page),['copyText','sendText']);
        assert.deepEqual(await page.evaluate(()=>f.opened.map(d=>d.action)),['open-builtin-browser','open-system-browser']);assert.deepEqual(await page.evaluate(()=>[...f.store]),before);
        assert.equal(await page.evaluate(()=>f.linkOpeningPolicy.decide('https://example.com').action),'open-system-browser');await page.close();
    });
    await t.test('actual Markdown files use the drawer on single click and file actions on right click across path formats',async()=>{
        const cases=[
            {name:'real-thread-inline-relative',markdown:'`app/components/AdminConsole.tsx`',root:'C:/Users/test/Desktop/project',suffix:'/app/components/AdminConsole.tsx'},
            {name:'drive-backslashes-encoded-by-markdown',markdown:String.raw`[File](<C:\Users\test\Desktop\project\app\globals.css#L12-L14>)`,root:'C:/Users/test/Desktop/project',suffix:'/app/globals.css',range:{startLine:12,endLine:14}},
            {name:'drive-slashes-and-encoded-space',markdown:'[File](C:/Users/test/Desktop/project/My%20Files/app.ts#L8)',root:'C:/Users/test/Desktop/project',suffix:'/My Files/app.ts',range:{startLine:8,endLine:8}},
            {name:'windows-case-insensitive-root',markdown:'[File](c:/users/test/desktop/Project/app.ts)',root:'C:/Users/test/Desktop/project',suffix:'/Project/app.ts'},
            {name:'file-uri-decodes-once',markdown:'[File](file:///C:/Users/test/Desktop/project/literal%2520name.ts)',root:'C:/Users/test/Desktop/project',suffix:'/literal%20name.ts'},
            {name:'unc-authority',markdown:'[File](file://server/share/project/My%20Files/app.ts#L3)',root:String.raw`\\server\share\project`,suffix:'/My Files/app.ts',range:{startLine:3,endLine:3},authority:'server'},
            {name:'unc-raw-inline',markdown:'`'+String.raw`\\server\share\project\app.ts`+'`',root:String.raw`\\server\share\project`,suffix:'/app.ts',authority:'server'},
            {name:'posix-relative',markdown:'[File](src/app.ts#L10)',root:'/Users/test/project',suffix:'/src/app.ts',range:{startLine:10,endLine:10}},
        ];
        for(const item of cases){
            const page=await setup();const anchors=await page.evaluate((item)=>mountFile(item.markdown,item.root),item);
            assert.equal(anchors.length,1,item.name);assert.equal(anchors[0].kind,'file',item.name);
            await page.click('#file-markdown a');await page.waitForFunction(()=>f.files.length===1);
            const opened=await page.evaluate(()=>({file:f.files[0],resolved:f.activities[0].resource,actions:f.opened.map(d=>d.action)}));
            assert.deepEqual(opened.actions,[],item.name);
            assert.equal(opened.file.range?.startLine,item.range?.startLine,item.name);assert.equal(opened.file.range?.endLine,item.range?.endLine,item.name);
            assert.ok(opened.resolved.path.replaceAll('\\','/').endsWith(item.suffix),JSON.stringify(opened));
            if(item.authority)assert.ok(opened.resolved.path.replaceAll('\\','/').startsWith('//server/share/'),JSON.stringify(opened));
            await right(page,'#file-markdown a');assert.deepEqual(await actions(page),['openFile','copyPath','copyText','sendText','sendPath'],item.name);
            await page.click('[data-chat-context-action=copyPath]');assert.equal(await page.evaluate(()=>f.copied.at(-1)),anchors[0].path,item.name);
            await right(page,'#file-markdown a');await page.click('[data-chat-context-action=openFile]');await page.waitForFunction(()=>f.files.length===2);
            assert.equal(await page.evaluate(()=>f.opened.filter(d=>d.action.includes('browser')).length),0,item.name);
            evidence.push({case:item.name,passed:true});await page.close();
        }
    });
    await t.test('bare filenames become image/file chips in code, lists, table cells and prose without linking runtimes or domains',async()=>{
        const page=await setup();
        const anchors=await page.evaluate(()=>mountFile('`tasks.sqlite`\n\n- promo.png\n- report.pdf\n\n| File | Output |\n| --- | --- |\n| logo.svg | analysis.xlsx |\n\nSaved \"intro.wav\" and test_results.json. node.js next.js example.com v1.2.3','/Users/test/project'));
        assert.deepEqual(anchors.map(item=>item.href),['tasks.sqlite','promo.png','report.pdf','logo.svg','analysis.xlsx','intro.wav','test_results.json']);
        assert.deepEqual(anchors.map(item=>item.kind),['file','image','file','image','file','audio','file']);
        assert.ok(anchors.every(item=>item.path.startsWith('/Users/test/project/')));
        await page.close();
    });
    await t.test('file paths append as paths, explicit external clicks use the read-only viewer, and stale menus cannot cross threads',async()=>{
        const page=await setup();await page.evaluate(()=>mountFile('`src/app.ts`','/Users/test/project'));
        await right(page,'#file-markdown a');await page.click('[data-chat-context-action=sendPath]');assert.equal(await page.$eval('textarea',e=>e.value),'/Users/test/project/src/app.ts');
        await page.evaluate(()=>{f.files=[];});await page.click('#file-markdown a');await page.waitForFunction(()=>f.files.length===1);
        await page.evaluate(()=>mountFile('[File](/Users/test/outside.ts)','/Users/test/project'));await page.click('#file-markdown a');await page.waitForFunction(()=>f.activities.length===2);
        assert.deepEqual(await page.evaluate(()=>f.activities.map(item=>({path:item.resource.path,action:item.resource.action}))),[{path:'/Users/test/project/src/app.ts',action:'read'},{path:'/Users/test/outside.ts',action:'read'}]);
        await page.evaluate(()=>{f.files=[];});
        await right(page,'#file-markdown a');await page.evaluate(()=>{window.oldFileMenu=f.chatContextMenu;f.open('B');f.performChatContextAction(oldFileMenu,'openFile');f.performChatContextAction(oldFileMenu,'sendPath');});
        assert.equal(await page.$eval('textarea',e=>e.value),'');assert.deepEqual(await page.evaluate(()=>f.files),[]);await page.close();
    });
    await t.test('a file resolution completing after navigation cannot open into the new conversation',async()=>{
        const page=await setup();await page.evaluate(()=>{mountFile('`app.ts`','/Users/test/project');f.fileService.resolve=()=>new Promise(resolve=>{window.finishFileResolution=resolve;});});
        await page.click('#file-markdown a');await page.waitForFunction(()=>typeof finishFileResolution==='function');
        await page.evaluate(async()=>{f.open('B');finishFileResolution({inside:true,path:'/Users/test/project/src/app.ts'});await new Promise(resolve=>setTimeout(resolve,0));});
        assert.deepEqual(await page.evaluate(()=>({files:f.files,warnings:f.warnings})),{files:[],warnings:[]});await page.close();
    });
    await t.test('same-turn successful reads resolve the actual Windows reply to the existing read-only activity viewer',async()=>{
        const page=await setup();
        const result=await page.evaluate(()=>{
            const path='C:/Users/test/Desktop/ai漫剧/app/components/AdminConsole.tsx';
            const event={type:'tool_completed',ok:true,toolName:'workspace.read_file',summary:{title:'read',kind:'workspace.read_file',checkpointId:'must-not-open-diff',resource:{kind:'file',action:'read',path,startLine:1500}}};
            f.turns=[{id:'turn-A',events:[event,event]}];
            return mountFile('`app/components/AdminConsole.tsx`','C:/Users/test/Desktop/33');
        });
        assert.ok(result[0].path.endsWith('/ai漫剧/app/components/AdminConsole.tsx'));
        await page.click('#file-markdown a');await page.waitForFunction(()=>f.activities.length===1);
        await right(page,'#file-markdown a');await page.click('[data-chat-context-action=copyPath]');assert.equal(await page.evaluate(()=>f.copied[0]),result[0].path);
        await right(page,'#file-markdown a');await page.click('[data-chat-context-action=openFile]');
        await page.waitForFunction(()=>f.activities.length===2);
        const actual=await page.evaluate(()=>({activities:f.activities,workspaceReads:f.resolvedFiles,browser:f.opened}));
        assert.equal(actual.activities.length,2);assert.ok(actual.activities.every(s=>s.resource.action==='read'&&s.resource.path.endsWith('/ai漫剧/app/components/AdminConsole.tsx')&&!s.checkpointId&&!s.resource.startLine));
        assert.deepEqual(actual.workspaceReads,[]);assert.deepEqual(actual.browser,[]);await page.close();
    });
    await t.test('duplicate reads choose the latest turn file and another turn cannot donate an outside-workspace path',async()=>{
        const page=await setup();await page.evaluate(()=>{
            const event=path=>({type:'tool_completed',ok:true,toolName:'workspace.read_file',summary:{title:'read',kind:'workspace.read_file',resource:{kind:'file',action:'read',path}}});
            f.turns=[{id:'turn-A',events:[event('/a/project/app/file.ts'),event('/b/project/app/file.ts')]}];
            mountFile('`app/file.ts`','/Users/test/project');
        });
        await page.click('#file-markdown a');await page.waitForFunction(()=>f.files.length===1);
        assert.deepEqual(await page.evaluate(()=>f.activities.map(item=>item.resource.path)),['/b/project/app/file.ts']);
        assert.notEqual(await page.evaluate(()=>f.councilBelowNotice),'ambiguous');
        await page.evaluate(()=>{f.activities=[];f.files=[];f.turns[0].id='turn-B';mountFile('`app/file.ts`','/Users/test/project');});
        await page.click('#file-markdown a');await page.waitForFunction(()=>f.files.length===1);assert.deepEqual(await page.evaluate(()=>f.activities.map(item=>item.resource.path)),['/Users/test/project/app/file.ts']);await page.close();
    });
    await t.test('edge flipping and small-height scrolling stay clear of status bar and composer',async()=>{
        const page=await setup(260);await page.evaluate(()=>{f.desktopLocale='de';f.update();const link=document.getElementById('link');link.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:478,clientY:157}));});
        const rect=await page.$eval('.nmx-chat-context-menu',e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,client:e.clientHeight,scroll:e.scrollHeight,font:getComputedStyle(e).fontFamily};});
        assert.ok(rect.left>=34&&rect.right<=476&&rect.top>=54&&rect.bottom<=156,JSON.stringify(rect));assert.ok(rect.scroll>rect.client);assert.ok(rect.font.includes('Arial'));
        await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.chatContextAction),'openSystem');
        await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>f.opened.at(-1).action),'open-system-browser');
        await right(page,'#link');await page.setViewport({width:300,height:280});const clipped=await page.$eval('.nmx-chat-context-menu',e=>{const r=e.getBoundingClientRect();return{right:r.right,bottom:r.bottom};});assert.ok(clipped.right<=276&&clipped.bottom<=176);
        evidence.push({case:'bounded-small-window',passed:true});await page.close();
    });
    await t.test('comic composer appends without replacing attachments; current comic target changes invalidate old menu',async()=>{
        const page=await setup();await page.evaluate(()=>{f.activeSection='comic';f.update();});await right(page,'#link');await page.click('[data-chat-context-action=sendLink]');
        assert.equal(await page.$eval('textarea',e=>e.value),'comic draft\nhttps://example.com/path?x=1#part');assert.equal(await page.evaluate(()=>f.submitted),0);
        await right(page,'#link');await page.evaluate(()=>{window.oldComic=f.chatContextMenu;f.comicId='comic-B';f.comicPrompt='other comic';f.update();f.performChatContextAction(oldComic,'sendText');});
        assert.deepEqual(await actions(page),[]);assert.equal(await page.$eval('textarea',e=>e.value),'other comic');assert.deepEqual(await page.evaluate(()=>f.attachments),[{id:'keep',name:'fixture.txt'}]);await page.close();
    });
    if(process.env.NEXTMUX_CHAT_CONTEXT_EVIDENCE)await writeFile(process.env.NEXTMUX_CHAT_CONTEXT_EVIDENCE,JSON.stringify({preparedOnly:true,at:new Date().toISOString(),browser:await browser.version(),evidence},null,2),{mode:0o600,flag:'wx'});
});
