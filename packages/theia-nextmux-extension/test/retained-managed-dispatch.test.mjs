import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { retainedManagedDispatchRoute } from '../lib/browser/nextmux-retained-managed-selection.js';
import { bindPriceQuote } from '../lib/common/nextmux-price-quote.js';
import { resolveModelRouteId, resolveModelRelay, migrateOfficialRelayKey } from '../lib/browser/nextmux-model-route-selection.js';
import { automaticRelaySource } from '../lib/common/nextmux-relay-switch.js';
const id=randomUUID(), merchantId=randomUUID(), routeId=`managed:fixed:${id}`, relayKey=`managed:${merchantId}`, quote=`kq1_${'a'.repeat(64)}`;
const identity={id,merchantId,registryModelId:'registry-a',canonicalModel:'vendor/model',category:'coding',input:['text'],output:['text'],capabilities:['tools','coding'],workbenches:['coding'],status:'unavailable',available:false,unavailableReason:'retained_route_identity'};
const source=readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('widget.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const klass=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NextMuxDesktopWidget');
const names=['retainedManagedRouteForDispatch','codingRouteForSession','syncModelRoute','modelKeyForOffering','normalizedModelId'];
const methods=names.map(name=>klass.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)===name).getText(ast));
const deps={retainedManagedDispatchRoute,bindPriceQuote,resolveModelRouteId,resolveModelRelay,migrateOfficialRelayKey,automaticRelaySource,window:{localStorage:{setItem(){}}}};
const Widget=new Function(...Object.keys(deps),ts.transpile(`class Widget { ${methods.join('\n')} } return Widget;`,{target:ts.ScriptTarget.ES2022}))(...Object.values(deps));
const input={sessionId:'session-a',routeId,relayKey,modelId:'vendor/model',keyPriceQuoteId:quote,automaticRelaySource:'user'};
function fixture(){const widget=new Widget(),lookups=[];Object.assign(widget,{platformSession:{linked:true,user:{id:'owner-a'}},platformCatalog:{offerings:[]},merchantPickerSnapshots:new Map(),savedFixedOfferings:new Map(),automaticRelaySource:'off',activeCodingSessionId:'visible-other',activeModelRouteId:'other-route',activeRelayKey:'other-merchant',platformService:{async getRetainedManagedOffering(...args){lookups.push(args);return identity;}}});return{widget,lookups};}
test('actual widget sends only the saved original API identity to the server; same-name alternatives are never chosen locally',async()=>{
 const {widget,lookups}=fixture();widget.platformCatalog.offerings=[{...identity,id:randomUUID(),status:'listed',available:true}];
 const route=await widget.retainedManagedRouteForDispatch(input);
 assert.equal(route.id,routeId);assert.equal(route.offering.id,id);assert.equal(route.registryModelId,'registry-a');assert.equal(route.keyPriceQuoteId,quote);assert.equal(route.automatic,false);
 assert.deepEqual(lookups,[[id,quote]]);assert.equal(widget.activeModelRouteId,'other-route');assert.equal(widget.activeRelayKey,'other-merchant');assert.equal(widget.platformCatalog.offerings.length,1);
});
test('actual widget respects the submitted conversation consent independently of the visible conversation',async()=>{
 const {widget,lookups}=fixture();widget.automaticRelaySource='user';
 assert.equal(await widget.retainedManagedRouteForDispatch({...input,automaticRelaySource:'off'}),undefined);assert.equal(lookups.length,0);
 widget.automaticRelaySource='off';assert.equal((await widget.retainedManagedRouteForDispatch(input)).id,routeId);assert.equal(lookups.length,1);
});
test('an exact previously seen API snapshot avoids a new identity request without becoming an available picker entry',async()=>{
 const {widget,lookups}=fixture();widget.savedFixedOfferings.set('snapshot',{offering:identity});
 const route=await widget.retainedManagedRouteForDispatch(input);assert.equal(route.offering,identity);assert.equal(route.offering.available,false);assert.equal(lookups.length,0);
 assert.deepEqual(widget.platformCatalog.offerings,[]);
});
test('identity lookup cannot survive an account switch or overwrite a mismatched merchant/model selection',async()=>{
 for(const patch of [{merchantId:randomUUID()},{canonicalModel:'vendor/different'}]){const {widget}=fixture();widget.platformService.getRetainedManagedOffering=async()=>({...identity,...patch});assert.equal(await widget.retainedManagedRouteForDispatch(input),undefined);}
 const {widget}=fixture();let release;widget.platformService.getRetainedManagedOffering=()=>new Promise(r=>{release=r;});const pending=widget.retainedManagedRouteForDispatch(input);widget.platformSession={linked:true,user:{id:'owner-b'}};release(identity);assert.equal(await pending,undefined);
});
test('old queued selections without a canonical label derive it from the exact authenticated original API, never current UI',async()=>{
 const {widget}=fixture();const route=await widget.retainedManagedRouteForDispatch({...input,modelId:undefined});assert.equal(route.id,routeId);assert.equal(route.canonicalModel,'vendor/model');
});
test('child route lookup and directory refresh never replace the saved API with a same-model route',()=>{
 const {widget}=fixture(),alternate={id:`managed:fixed:${randomUUID()}`,kind:'managed_gateway',offering:{...identity,id:randomUUID()}};
 const session={id:'session-a',routeId,relayKey,modelId:'vendor/model',automaticRelaySource:'off',turns:[]};
 Object.assign(widget,{activeSection:'coding',codingSessions:[session],selectedModelIds:{coding:'vendor/model'},activeCodingSession:()=>session,codingSessionRelayKey:s=>s.relayKey,relayOptions:()=>[{key:relayKey}],officialRelayConnectionReferences:()=>[],migrateManagedRelaySelection:x=>x,modelRoutes:()=>[alternate],routesForRelay:()=>[alternate],modelKeyForRoute:()=> 'vendor/model',activeModelRoute(){return this.modelRoutes().find(r=>r.id===this.activeModelRouteId);},syncReasoningEffort(){},persistCodingSessions(){assert.fail('must not rewrite saved API');}});
 assert.equal(widget.codingRouteForSession(session),undefined);widget.syncModelRoute();assert.equal(widget.activeModelRouteId,routeId);assert.equal(widget.activeRelayKey,relayKey);assert.equal(widget.codingSessions[0].routeId,routeId);
});
class Service extends NextMuxPlatformServiceImpl { async request(path,options){this.calls.push({path,options});return this.reply;} }
const service=()=>{const s=new Service();s.calls=[];s.reply={ok:true,offering:identity};return s;};
test('actual service authenticates the identity-only endpoint without sending or manufacturing a quote',async()=>{
 const s=service();s.reply={ok:true,offering:{...identity,keyPriceQuoteId:'new-quote',price:123,keyPrice:{fake:true},officialPrice:{fake:true},pricingDetails:{fake:true}}};
 const value=await s.getRetainedManagedOffering(id,quote);assert.deepEqual(value,identity);assert.deepEqual(s.calls,[{path:'/api/gateway/route-identity',options:{authenticated:true,method:'POST',body:{offeringId:id},timeoutMs:15000}}]);assert(!JSON.stringify(s.calls).includes(quote));
});
test('actual service rejects malformed identities and does no network call without an original quote and fixed API',async()=>{
 for(const [badId,badQuote] of [['other',quote],[id,'bad'],[id,'']]){const s=service();assert.equal(await s.getRetainedManagedOffering(badId,badQuote),undefined);assert.equal(s.calls.length,0);}
 for(const patch of [{id:randomUUID()},{available:true},{status:'listed'},{category:'video'},{registryModelId:''},{input:'text'},{capabilities:[123]}]){const s=service();s.reply={ok:true,offering:{...identity,...patch}};assert.equal(await s.getRetainedManagedOffering(id,quote),undefined);}
});
