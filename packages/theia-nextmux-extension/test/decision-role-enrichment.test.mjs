import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const commonPath = fileURLToPath(new URL('../src/common/nextmux-decision-models.ts', import.meta.url));
const req = createRequire(commonPath), module = { exports: {} };
new Function('require','module','exports',ts.transpileModule(readFileSync(commonPath,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(req,module,module.exports);
const { publishedDecisionRoleIndex, withPublishedDecisionRole, isDecisionModel } = module.exports;
const { decisionTransportForModel } = req('@nextmux/model-runtime/decision-adapter');
const role = { protocol:'openai_decisions',endpoint:'/v1/decisions',role:'decision',canonicalModel:'openai/gpt-6-luna',upstreamModelId:'gpt-6-luna',
  sourceUrl:'https://developers.openai.com/api/docs/guides/decisions.md',sourceHash:'a'.repeat(64),source:'provider_metadata',scope:'model',tariffRole:'openai_decisions' };
const support = { protocol:'openai_decisions',endpoint:'/v1/decisions',support:'supported',scope:'route',source:'provider_metadata' };
const tariff = { ...role,kind:'openai_decisions_input_only_v1',currency:'USD',rates:{input_token:{unitSize:1000000,amountMicros:100000},output_token:{unitSize:1000000,amountMicros:0},cached_input_token:{unitSize:1000000,amountMicros:0},cache_write_token:{unitSize:1000000,amountMicros:0}},requiredDimensions:['input_token'],documentedPremiums:['regional_processing','long_context'],applicability:{regionalProcessing:false,maximumPlatformInputTokens:32768},pricingStatement:'Official dedicated endpoint price' };
const catalog = [{ canonicalModel:role.canonicalModel,output:['text'],decisionEndpointRoles:[role],decisionEndpointTariff:tariff }];

test('the production role join is exact, preserves normal chat prices and does not grant an unknown relay endpoint',()=>{
  const roles=publishedDecisionRoleIndex(catalog);
  for(const id of ['gpt-6-luna','openai/gpt-6-luna']){
    const original={id,label:'Luna',inputPricePerMillion:.3,outputPricePerMillion:1};
    const enriched=withPublishedDecisionRole(original,roles);
    assert.equal(enriched.inputPricePerMillion,.3);assert.equal(enriched.outputPricePerMillion,1);
    assert.deepEqual(enriched.decisionEndpointTariff,tariff);
    assert.deepEqual(enriched.taskCategories,['language','decision']);
    assert.equal(enriched.decisionEndpointSupport,undefined);assert.equal(isDecisionModel(id),false);
    assert.equal(decisionTransportForModel(enriched,'openai_chat_completions',{baseUrl:'https://unknown-relay.invalid/v1'}),undefined);
    assert.equal(decisionTransportForModel(enriched,'openai_chat_completions',{baseUrl:'https://api.openai.com/v1'}),'openai_decisions');
    assert.equal(decisionTransportForModel({...enriched,decisionEndpointSupport:support},'openai_chat_completions',{baseUrl:'https://generic-relay.invalid/v1',declaration:support}),'openai_decisions');
    assert.deepEqual(original,{id,label:'Luna',inputPricePerMillion:.3,outputPricePerMillion:1});
  }
  for(const id of ['other/gpt-6-luna','gpt-6-luna-20261008','Gpt-6-Luna']){const model={id,label:id};assert.equal(withPublishedDecisionRole(model,roles),model);}
  const futureRole={...role,canonicalModel:'openai/future-decider',upstreamModelId:'future-decider'};
  const only=withPublishedDecisionRole({id:'future-decider',label:'Future'},publishedDecisionRoleIndex([{canonicalModel:futureRole.canonicalModel,decisionEndpointRoles:[futureRole]}]));
  assert.deepEqual(only.taskCategories,['decision'],'an official decision role does not invent general language capability');
  const stale=withPublishedDecisionRole({id:'gpt-6-luna',label:'Luna',decisionEndpointTariff:tariff},publishedDecisionRoleIndex([{canonicalModel:role.canonicalModel,decisionEndpointRoles:[role]}]));
  assert.equal(stale.decisionEndpointTariff,undefined,'a public source without a verified endpoint tariff cannot retain an own metadata price');
  for(const changed of [{...tariff,sourceHash:'b'.repeat(64)},{...tariff,rates:{...tariff.rates,request:{unitSize:1,amountMicros:1000}}},{...tariff,rates:{...tariff.rates,output_token:{unitSize:1000000,amountMicros:1}}}]) {
    assert.equal(withPublishedDecisionRole({id:'gpt-6-luna',label:'Luna'},publishedDecisionRoleIndex([{...catalog[0],decisionEndpointTariff:changed}])).decisionEndpointTariff,undefined);
  }
});

// Execute the real appPluginHost method, not a second copy of its connection mapping.
const backend=readFileSync(new URL('../src/node/nextmux-platform-service.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('service.ts',backend,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let method;for(const statement of ast.statements)if(ts.isClassDeclaration(statement))for(const member of statement.members)if(ts.isMethodDeclaration(member)&&member.name.getText(ast)==='appPluginHost')method=member;
assert.ok(method);
const code=ts.transpileModule('class Fixture{'+method.getText(ast)+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const Fixture=new Function('publishedDecisionRoleIndex','withPublishedDecisionRole',code+';return Fixture;')(publishedDecisionRoleIndex,withPublishedDecisionRole);

test('the actual plugin host binds cached public facts to own metadata and remains usable when the directory is offline',async()=>{
  let directoryReads=0,networkCalls=0;
  const f=new Fixture();f.baseUrl='https://platform.invalid';f.appPluginRequestScope={};f.networkFetch=()=>{networkCalls++;throw new Error('no network');};
  const own={id:'own',label:'Own',providerName:'Generic',protocol:'openai_chat_completions',baseUrl:'https://generic.invalid/v1',discoveredModels:[{id:'gpt-6-luna',label:'Luna',inputPricePerMillion:.3,decisionEndpointSupport:support}]};
  f.readOfficialConnectionIndex=async()=>[own];f.getGlobalModelCatalog=async()=>{directoryReads++;return{models:catalog};};
  const connections=await f.appPluginHost().connections();
  assert.equal(directoryReads,1);assert.equal(networkCalls,0);
  assert.deepEqual(connections[0].models[0].decisionEndpointRoles,[role]);
  assert.deepEqual(connections[0].models[0].decisionEndpointTariff,tariff);
  assert.deepEqual(connections[0].models[0].decisionEndpointSupport,support);
  assert.equal(connections[0].models[0].inputPricePerMillion,.3);
  assert.equal(own.discoveredModels[0].decisionEndpointRoles,undefined);
  f.getGlobalModelCatalog=async()=>{throw new Error('offline');};
  const offline=await f.appPluginHost().connections();
  assert.equal(offline[0].models[0].decisionEndpointRoles,undefined);
  assert.deepEqual(offline[0].models[0].decisionEndpointSupport,support);
  assert.equal(decisionTransportForModel(offline[0].models[0],'openai_chat_completions',{baseUrl:own.baseUrl,declaration:support}),undefined);
});
