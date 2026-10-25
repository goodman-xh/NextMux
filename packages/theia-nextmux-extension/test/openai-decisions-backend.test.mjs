import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {decideAppPlugin,appPluginModelChoices}=require('../lib/node/nextmux-app-plugin-decisions.js');
const role={protocol:'openai_decisions',endpoint:'/v1/decisions',role:'decision',canonicalModel:'openai/gpt-6-luna',upstreamModelId:'gpt-6-luna',
 sourceUrl:'https://developers.openai.com/api/docs/guides/decisions.md',sourceHash:'a'.repeat(64),source:'provider_metadata',scope:'model',tariffRole:'openai_decisions'};
const tariff={...role,kind:'openai_decisions_input_only_v1',currency:'USD',rates:{input_token:{unitSize:1000000,amountMicros:100000},output_token:{unitSize:1000000,amountMicros:0},cached_input_token:{unitSize:1000000,amountMicros:0},cache_write_token:{unitSize:1000000,amountMicros:0}},requiredDimensions:['input_token'],documentedPremiums:['regional_processing','long_context'],applicability:{regionalProcessing:false,maximumPlatformInputTokens:32768},pricingStatement:'Verified test source'};
const request={model:{source:'connection',connectionId:'own',model:'gpt-6-luna'},state:'Choose Save',questions:{next:{type:'choice',instructions:'Choose',criteria:{save:'Save',cancel:'Cancel'}}}};
function setup({base='https://api.openai.com/v1',hasTariff=true,declare=false,inputTokens=1000}={}){
 let calls=0,requests=[];
 const connection={id:'own',label:'Own',providerName:'OpenAI',protocol:'openai',baseUrl:base,models:[{id:'gpt-6-luna',outputModalities:['text'],inputModalities:['text'],taskCategories:['language','decision'],decisionEndpointRoles:[role],...(hasTariff?{decisionEndpointTariff:tariff}:{}),...(declare?{decisionEndpointSupport:{protocol:'openai_decisions',endpoint:'/v1/decisions',support:'supported',scope:'route',source:'provider_metadata'}}:{}),inputPricePerMillion:99,outputPricePerMillion:99,cachedInputPricePerMillion:0}]};
 const fetcher=async(url,init)=>{if(String(url).endsWith('/decisions')){calls++;requests.push({url:String(url),body:JSON.parse(init.body)});return Response.json({answers:[{name:'next',type:'choice',choice:'save'}],usage:{input_tokens:inputTokens,input_tokens_details:{cached_tokens:600},output_tokens:12345,cost:99}});}return Response.json({data:[]});};
 const host={baseUrl:'https://platform.example',deviceId:async()=>'device',fetch:fetcher,localFetch:fetcher,connections:async()=>[connection],connectionKey:async()=>'not-a-real-key'};
 return {host,connection,requests,calls:()=>calls};
}
test('own official Decisions uses independent input-only tariff and keeps normal chat prices intact',async()=>{
 const f=setup(),result=await decideAppPlugin(f.host,request);
 assert.equal(result.ok,true);assert.equal(result.costUsd,0.0001);assert.equal(result.costStatus,'known');assert.equal(f.calls(),1);
 assert.equal(result.payload.usage.cost,undefined);assert.equal(result.payload.usage.input_tokens,1000);
 assert.equal(f.requests[0].url,'https://api.openai.com/v1/decisions');assert.equal(f.requests[0].body.input,request.state);assert.equal(f.connection.models[0].inputPricePerMillion,99);
 const choices=await appPluginModelChoices(f.host);assert.equal(choices.connections[0].decisions[0].inputPricePerMillion,0.1);
});
test('unknown own native endpoint prices never borrow ordinary chat rates or supplier cost',async()=>{
 const f=setup({hasTariff:false}),result=await decideAppPlugin(f.host,request);
 assert.equal(result.ok,true);assert.equal(result.costStatus,'unknown');assert.equal(result.costUsd,undefined);assert.equal(f.calls(),1);
});
test('explicit relay native endpoint can run but author price is not evidence of its selling price',async()=>{
 const f=setup({base:'https://any-relay.example/proxy/v1',declare:true}),result=await decideAppPlugin(f.host,request);
 assert.equal(result.ok,true);assert.equal(result.costStatus,'unknown');assert.equal(result.costUsd,undefined);assert.equal(f.requests[0].url,'https://any-relay.example/proxy/v1/decisions');
});
test('role-only relay cannot dispatch an unsupported Decisions endpoint',async()=>{
 const f=setup({base:'https://ordinary-relay.example/v1'}),result=await decideAppPlugin(f.host,request);
 assert.equal(result.ok,false);assert.equal(result.error,'decision_protocol_unsupported');assert.equal(f.calls(),0);
});
test('native own usage beyond the verified tariff tier remains unknown',async()=>{
 const f=setup({inputTokens:32769}),result=await decideAppPlugin(f.host,request);
 assert.equal(result.ok,true);assert.equal(result.costStatus,'unknown');assert.equal(result.costUsd,undefined);assert.equal(f.calls(),1);
});
