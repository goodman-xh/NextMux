import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const browser=new URL('../src/browser/',import.meta.url);
const widget=ts.createSourceFile('widget.tsx',readFileSync(new URL('nextmux-desktop-widget.tsx',browser),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const klass=widget.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='NextMuxDesktopWidget');
const method=klass.members.find(node=>node.name?.getText(widget)==='localizeRenderedSurface').getText(widget);
const {localizeDesktopSurface}=loadCurrentSource(new URL('nextmux-surface-locale.ts',browser));
const {projectFolderOpenText,projectPathLabel}=loadCurrentSource(new URL('nextmux-project-path.ts',browser));
const {comicChatText}=loadCurrentSource(new URL('nextmux-comic-chat-text.ts',browser));
const {isSurfaceLiteral}=loadCurrentSource(new URL('nextmux-surface-walk.ts',browser));
let button,codingRow,comicRow;
function visit(node){
 if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(widget)==='button'){
  const attributes=node.openingElement.attributes.properties;
  if(attributes.some(a=>a.name?.getText(widget)==='className'&&a.initializer?.text==='nmx-project-path-button'))button=node;
  if(attributes.some(a=>a.name?.getText(widget)==='data-project-path'&&a.initializer?.expression?.getText(widget)==='workspace.path'))codingRow=node;
  if(attributes.some(a=>a.name?.getText(widget)==='title'&&a.initializer?.expression?.getText(widget)==="missing ? `${path}\\n${t('folderMissing')}` : path"))comicRow=node;
 }
 ts.forEachChild(node,visit);
}
visit(widget);assert.ok(button);assert.ok(codingRow);assert.ok(comicRow);
const React={createElement:(tag,props,...children)=>({tag,props:props||{},children})};
const compile=(node,params)=>new Function('React',...params,ts.transpile(`return (${node.getText(widget)});`,{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}));
const renderButton=compile(button,['projectPath','openLabel','projectPathLabel']);
const renderCodingRow=compile(codingRow,['workspace','expanded','openWorkspacePaths']);
const renderComicRow=compile(comicRow,['path','name','missing','expanded','t']);

// Evaluate the actual localization method and literal selector. This is a
// source-level harness, not an installed-application or native shell test.
function element(node,parent){
 const el={attrs:new Map(Object.entries(node.props).filter(([key,value])=>typeof value==='string'||key==='data-nmx-literal')),parent,props:node.props,
  getAttribute(key){return this.attrs.get(key)||null;},setAttribute(key,value){this.attrs.set(key,value);},
  closest(){return this.attrs.has('data-nmx-literal')?this:parent?.closest()||null;},children:[],texts:[]};
 for(const child of node.children.flat(Infinity)){
  if(child&&typeof child==='object'&&child.tag){const sub=element(child,el);el.children.push(sub);el.texts.push(...sub.texts);}
  else if(typeof child==='string')el.texts.push({data:child,parentElement:el});
 }
 return el;
}
const forEachSurfaceTextNode=(root,visit)=>{for(const text of root.texts)if(!isSurfaceLiteral(text.parentElement))visit(text);};
const Harness=new Function('localizeDesktopSurface','forEachSurfaceTextNode','isSurfaceLiteral','queueMicrotask',ts.transpile(`class Harness { ${method} }; return Harness;`,{target:ts.ScriptTarget.ES2022}))(localizeDesktopSurface,forEachSurfaceTextNode,isSurfaceLiteral,fn=>fn());
function localize(node,locale){
 const el=element(node);el.querySelectorAll=()=>[el,...el.children];
 const host=Object.assign(new Harness(),{desktopLocale:locale,node:el,localizationMutationSuppressionGeneration:0,localizedTextNodes:new WeakMap(),localizedAttributes:new WeakMap()});
 host.localizeRenderedSurface();host.localizeRenderedSurface();
 return {title:el.getAttribute('title'),label:el.getAttribute('aria-label'),text:el.texts.map(t=>t.data).join(''),dataPath:el.getAttribute('data-project-path')};
}
const locales=['zh-CN','zh-TW','en','ja','ko','es','fr','de','pt-BR','ru','ar','hi'];
const paths=['C:\\Users\\Alice\\NextMux-Test\\workspace','D:\\Test\\Settings\\Copy','\\\\Test\\share\\Settings','/Users/alice/NextMux-Test/Settings/Copy','/Users/alice/删除/Test'];

test('the composer path keeps literal text and accessibility labels while its action label remains localized in all 12 locales',()=>{
 for(const locale of locales)for(const path of paths){
  const received=[],host={platformService:{async openFolderInFileManager(value){received.push(value);return true;}}};
  const label=projectFolderOpenText(locale,path.startsWith('/')?'darwin':'Win32');
  const node=renderButton.call(host,React,path,label,projectPathLabel),result=localize(node,locale);
  assert.equal(result.title,`${path}\n${label}`,locale);assert.equal(result.label,`${label}: ${path}`,locale);assert.equal(result.text,projectPathLabel(path),locale);
  node.props.onClick();assert.deepEqual(received,[path],locale);
 }
 assert.equal(localizeDesktopSurface('zh-CN','Test'),'检测','the real Test action remains translated');
});

test('coding project rows preserve user names and paths without changing project selection or drag data',()=>{
 for(const locale of locales)for(const path of paths){
  const label='NextMux-Test 删除',received=[],drag=[];
  const host={projectHighlightPath:'',activeWorkspaceRoot:'',selectWorkspaceRoot:value=>received.push(['select',value]),toggleCodingProject:value=>received.push(['toggle',value])};
  const node=renderCodingRow.call(host,React,{path,label},false,new Set([path])),result=localize(node,locale);
  assert.equal(result.title,path);assert.equal(result.text,label);assert.equal(result.dataPath,path);
  node.props.onClick();assert.deepEqual(received,[['select',path],['toggle',path]]);
  const prior=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>0;
  try {node.props.onDragStart({dataTransfer:{setData:(type,value)=>drag.push([type,value])}});}finally{globalThis.requestAnimationFrame=prior;}
  assert.deepEqual(drag,[['application/x-nextmux-project',path]]);
 }
});

test('comic project rows preserve literal paths and names while missing-folder explanations keep the selected locale',()=>{
 for(const locale of locales)for(const path of paths)for(const missing of [false,true]){
  const name='NextMux-Test 删除',received=[],host={comicFolderMenu:path,toggleComicChatFolder:value=>received.push(value)},t=key=>comicChatText(locale,key);
  const node=renderComicRow.call(host,React,path,name,missing,false,t),result=localize(node,locale);
  assert.equal(result.title,missing?`${path}\n${t('folderMissing')}`:path);assert.equal(result.text,name);
  node.props.onClick();assert.deepEqual(received,missing?[]:[path]);
 }
});
