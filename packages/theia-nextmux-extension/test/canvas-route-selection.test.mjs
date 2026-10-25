import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {sourceModule,comicCoreSource as core} from './helpers/comic-organizer-source-loader.mjs';
const {canvasRouteConnections,canvasConnectionFamilies,canvasPreferredRoute,canvasRouteSourceKey}=sourceModule('browser/nextmux-comic-canvas-route-selection.ts');
const {canvasRouteText,CANVAS_ROUTE_LOCALES}=sourceModule('browser/nextmux-comic-canvas-route-text.ts');
const route=(key,modelId,sourceKey,extra={})=>({key,connectionId:key,kind:'image',modelId,label:modelId,source:'Same name',sourceLabel:'Same name',sourceKey,routeKind:sourceKey.startsWith('official:')?'own':'relay',available:true,...extra});
const a=route('a1','model-a','managed:a'),b=route('b1','model-a','managed:b'),a2=route('a2','model-b','managed:a');
const ownA=route('o1','model-a','official:one',{connectionId:'one'}),ownB=route('o2','model-b','official:two',{connectionId:'two'});
const families=[{id:'a',name:'A',routes:[a,b,ownA],available:true},{id:'b',name:'B',routes:[a2,ownB],available:true}];
test('same-name merchants and own connections keep distinct stable identities and connection-scoped models',()=>{
 const relays=canvasRouteConnections(families,'relay');assert.deepEqual(relays.map(r=>r.key),['managed:a','managed:b']);assert.notEqual(relays[0].label,relays[1].label);
 assert.deepEqual(canvasRouteConnections(families,'own').map(r=>r.key),['official:one','official:two']);
 assert.deepEqual(canvasConnectionFamilies(families,'managed:b').map(f=>f.id),['a']);
 assert.deepEqual(canvasConnectionFamilies(families,'official:two').flatMap(f=>f.routes.map(r=>r.key)),['o2']);
 assert.equal(canvasPreferredRoute(relays[1].routes,a).key,'b1');
});
test('unsupported connections stay visible and cannot fall back to another merchant or source',()=>{
 const disabled={...b,available:false,reason:'unsupported'};const items=[{id:'a',name:'A',routes:[a,disabled,ownA],available:true}];
 const scope=canvasRouteConnections(items,'relay').find(r=>r.key==='managed:b');assert.equal(scope.available,false);
 assert.equal(canvasPreferredRoute(scope.routes,a),undefined);assert.equal(canvasConnectionFamilies(items,scope.key)[0].available,false);
 assert.deepEqual(canvasRouteConnections(items,'own').flatMap(r=>r.routes.map(r=>r.key)),['o1']);
});
test('legacy descriptors preserve exact own connection identity and exact available model variants',()=>{
 const old={...ownA,sourceKey:undefined};assert.equal(canvasRouteSourceKey(old),'own:one');
 assert.equal(canvasPreferredRoute([a,a2],a2),a2);assert.equal(canvasPreferredRoute([],a),undefined);
});
test('new selector labels cover every supported locale',()=>{
 for(const locale of CANVAS_ROUTE_LOCALES)for(const key of ['source','relay','own','merchant','connection','choose','none','unavailable'])assert.ok(canvasRouteText(locale,key)?.length);
});
const source=readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx',import.meta.url),'utf8');
const file=ts.createSourceFile('widget.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),widget=file.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NextMuxDesktopWidget');
const methods=['canvasConnectionId','canvasChoiceKey','canvasModelId','canvasModelChoices','canvasRouteOf'].map(name=>widget.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(file)===name).getText(file));
const Fixture=new Function('managedRelayKey','officialConnectionRelayKey','canvasRegistryFamily',ts.transpile(`class Fixture { ${methods.join('\n')} };return Fixture`,{target:ts.ScriptTarget.ES2022}))(
 id=>'managed:'+id,id=>'official:'+id,()=>({kind:'image'}));
function fixture(){
 const f=new Fixture();f.officialModels={connections:[{id:'one',label:'My studio key',providerName:'Provider'}]};f.offeringMerchantId=o=>o.merchantId;f.modelDisplayName=m=>m;f.comicStepMediaRoute=()=>undefined;
 const managed=(id,merchantId)=>({id,kind:'managed',providerName:'Vendor',model:'model-a',offering:{id,merchantId,providerModelCode:'model-a'}});
 const ma=managed('offer-a','a'),mb=managed('offer-b','b');
 f.comicMediaRouteGroups=()=>[{option:{key:'auto',kind:'automatic',label:'Automatic'},routes:[ma,mb]},
 {option:{key:'managed:a',kind:'managed',label:'Store A'},routes:[ma]},{option:{key:'managed:b',kind:'managed',label:'Store B'},routes:[mb]},
 {option:{key:'official:one',kind:'official',label:'Legacy default model label'},routes:[{id:'own-model-a',kind:'official',model:'model-a',connection:{id:'one',label:'My studio key',providerName:'Provider'}}]}];return f;
}
test('widget automatic offerings retain their actual merchant identity and own connection label',()=>{
 const choices=fixture().canvasModelChoices('image').choices;assert.equal(choices.length,3);
 assert.deepEqual(choices.map(r=>[r.sourceKey,r.sourceLabel]),[['managed:a','Store A'],['managed:b','Store B'],['official:one','My studio key']]);
 assert.deepEqual(choices.map(r=>r.connectionId),['managed:fixed:offer-a','managed:fixed:offer-b','one']);
});
test('canvas own sources use the saved connection name for every discovered model without changing route identity',()=>{
 const f=fixture();f.officialModels={connections:[{id:'one',label:'My H3 connection',providerName:'Provider'},{id:'two',label:'Other connection',providerName:'Provider'}]};
 const routes=[{id:'official:one:model-a',kind:'official',model:'model-a',connection:{id:'one',label:'model-a',providerName:'Provider'}},
  {id:'official:one:model-b',kind:'official',model:'model-b',connection:{id:'one',label:'model-b',providerName:'Provider'}},
  {id:'official:two:model-a',kind:'official',model:'model-a',connection:{id:'two',label:'model-a',providerName:'Provider'}}];
 const before=JSON.stringify(routes);f.comicMediaRouteGroups=()=>[{option:{key:'official:one',kind:'official',label:'Model default'},routes}];
 const result=f.canvasModelChoices('image');
 assert.deepEqual(result.choices.map(r=>[r.key,r.connectionId,r.modelId,r.sourceKey,r.sourceLabel]),[
  ['official:one:model-a','one','model-a','official:one','My H3 connection'],['official:one:model-b','one','model-b','official:one','My H3 connection'],
  ['official:two:model-a','two','model-a','official:two','Other connection']]);
 assert.equal(JSON.stringify(routes),before);for(const route of routes)assert.equal(result.routes.get(route.id),route);
});
test('a removed explicit route is unavailable while old projects without route keys still resolve',()=>{
 const f=fixture(),node={id:'n',kind:'imageGen',payload:{modelId:'model-a'}};
 assert.equal(f.canvasRouteOf({settings:{nodeRoutes:{n:'removed-route'}}},node),undefined);
 assert.equal(f.canvasRouteOf({settings:{nodeRoutes:{n:'managed:fixed:offer-b'}}},node).sourceKey,'managed:b');
 assert.equal(f.canvasRouteOf({settings:{}},node).key,'managed:fixed:offer-a');
});
test('copied MiniMax nodes keep their exact route and become unavailable if it disappears, even with other merchants available',()=>{
 const {serializeCanvasClipboard:serialize,pasteCanvasClipboard:paste}=sourceModule('browser/nextmux-comic-canvas-clipboard.ts');
 const {duplicateCanvasNodes:duplicate}=sourceModule('browser/nextmux-comic-canvas-logic.ts');
 const {prepareCanvasDragCopy:prepare,commitCanvasDragCopy:commit}=sourceModule('browser/nextmux-comic-canvas-drag-copy.ts');
 const {prepareCanvasTransfer:transfer}=sourceModule('browser/nextmux-comic-canvas-transfer.ts');
 const now='2026-10-04T10:00:00.000Z',modelId='minimax/hailuo-3-max',key='managed:fixed:8bfc1a90-87f5-434b-a24b-1e4e9670118c';
 const original={id:'video',kind:'videoGen',title:'Video',position:{x:0,y:0},size:{width:280,height:160},payload:{mode:'textToVideo',modelId,prompt:'A person walking',parameters:{aspectRatio:'16:9',durationSeconds:15,resolution:'768p',generateAudio:true},versions:[{id:'v1',assetId:'asset',kind:'video',uri:'media/video.mp4',createdAt:now}],currentVersionId:'v1'}};
 const source={...core.createCanvasDocument({id:'source',projectId:'project',now}),nodes:[original],settings:{nodeRoutes:{video:key}}};
 const target=projectId=>core.createCanvasDocument({id:'target',projectId,now}),copies=[];
 for(const projectId of ['project','other-project']) {const result=paste(target(projectId),serialize(source,['video']),{now});assert.equal(result.ok,true);copies.push([result.canvas,result.ids[0]]);}
 const duplicated=duplicate(source,['video'],{x:40,y:40},now);copies.push([duplicated.canvas,duplicated.ids[0]]);
 for(const withIncoming of [false,true]) {const prepared=prepare(source,['video'],withIncoming,now);assert.equal(prepared.ok,true);const result=commit(source,prepared.plan,{x:30,y:40},now);assert.equal(result.ok,true);copies.push([result.canvas,result.ids[0]]);}
 const transferred=transfer(source,target('project'),{requestId:'route-copy-123',createdAt:now,sourceId:'source',targetId:'target',nodeIds:['video'],mode:'copy'});copies.push([transferred.document,transferred.ids[0]]);
 const f=fixture(),selected=route(key,modelId,'managed:chosen',{kind:'video'}),alternatives=[route('managed:fixed:other',modelId,'managed:other',{kind:'video'}),route('official:studio',modelId,'official:studio',{kind:'video'}),route('official:default','bytedance/seedance-2.5','official:default',{kind:'video'})];
 let choices=[...alternatives,selected];f.canvasModelChoices=()=>({choices});
 for(const [doc,id] of copies) {
  const copied=doc.nodes.find(node=>node.id===id);assert.equal(doc.settings.nodeRoutes[id],key);assert.equal(copied.payload.modelId,modelId);assert.deepEqual(copied.payload.parameters,original.payload.parameters);
  assert.equal(f.canvasRouteOf(doc,copied),selected,'copy resolves the explicitly selected merchant, not the first same-model route');
 }
 choices=alternatives;
 for(const [doc,id] of copies) assert.equal(f.canvasRouteOf(doc,doc.nodes.find(node=>node.id===id)),undefined,'removed explicit binding remains blocked across every copy path');
 const legacy={...source,settings:{}};assert.equal(f.canvasRouteOf(legacy,original).key,'managed:fixed:other','legacy nodes retain same-model lookup');
});
