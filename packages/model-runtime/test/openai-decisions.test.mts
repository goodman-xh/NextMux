import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionTransportForModel, invokeNativeDecision, openAIDecisionsUrl, openAIDecisionRequest, openAIDecisionResponse } from '../lib/decision-adapter.js';

const role = { protocol: 'openai_decisions', endpoint: '/v1/decisions', role: 'decision', canonicalModel: 'openai/gpt-6-luna', upstreamModelId: 'gpt-6-luna',
  source: 'provider_metadata', scope: 'model', tariffRole: 'openai_decisions', sourceUrl: 'https://developers.openai.com/api/docs/guides/decisions.md', sourceHash: 'a'.repeat(64) };
const model = { id: 'gpt-6-luna', output: ['text'], taskCategories: ['language','decision'], decisionEndpointRoles: [role] };
const questions = { action: { type: 'choice', instructions: 'Choose a button', criteria: { save: 'Save changes', cancel: 'Cancel changes' } },
  exists: { type: 'noul', instructions: 'Is a button visible?' },
  severity: { type: 'score', instructions: 'Rate severity', levels: { low: 'Cosmetic', high: 'Blocked' } } };

test('official model role is not permission to invoke a random relay endpoint', () => {
  assert.equal(decisionTransportForModel(model, 'openai', {baseUrl:'https://api.openai.com/v1'}),'openai_decisions');
  assert.equal(decisionTransportForModel(model, 'openai_responses', {baseUrl:'https://api.openai.com/v1'}),'openai_decisions');
  for (const baseUrl of ['https://relay.example/v1','http://api.openai.com/v1','https://api.openai.com.evil/v1','https://key@api.openai.com/v1'])
    assert.equal(decisionTransportForModel(model,'openai',{baseUrl}),undefined);
  assert.equal(decisionTransportForModel({...model, decisionEndpointRoles:[]},'openai',{baseUrl:'https://api.openai.com/v1'}),undefined);
  assert.equal(decisionTransportForModel({...model,id:'gpt-6-luna-latest'},'openai',{baseUrl:'https://api.openai.com/v1'}),undefined);
  assert.equal(decisionTransportForModel(model,'openrouter',{baseUrl:'https://openrouter.ai/api/v1'}),undefined);
});
test('explicit verified route endpoint declaration works across relay brands', () => {
  const declaration={support:'supported',scope:'route',source:'provider_metadata',protocol:'openai_decisions',endpoint:'/v1/decisions'};
  assert.equal(decisionTransportForModel(model,'openai',{baseUrl:'https://relay.example/v1',declaration}),'openai_decisions');
  for(const patch of [{scope:'model'},{source:'model_heuristic'},{endpoint:'/v1/responses'},{protocol:'openai'}])
    assert.equal(decisionTransportForModel(model,'openai',{baseUrl:'https://relay.example/v1',declaration:{...declaration,...patch}}),undefined);
});
test('OpenAI wire maps plugin Choice Noul and Score to typed official questions', () => {
  const request=openAIDecisionRequest('openai/gpt-6-luna','Button visible',questions);
  assert.deepEqual(request.body,{model:'gpt-6-luna',input:'Button visible',questions:[
    {name:'action',type:'choice',instructions:'Choose a button',choices:[{value:'save',description:'Save changes'},{value:'cancel',description:'Cancel changes'}]},
    {name:'exists',type:'predicate',instructions:'Is a button visible?'},
    {name:'severity',type:'score',instructions:'Rate severity',levels:[{label:'low',description:'Cosmetic'},{label:'high',description:'Blocked'}]}
  ]});
  assert.equal('state' in request.body,false);
});
test('official response adapts names and predicate without losing quantity receipt or inventing probabilities', () => {
  const receipt={input_tokens:1000,input_tokens_details:{cached_tokens:40}},request=openAIDecisionRequest('gpt-6-luna','x',questions);
  const value=openAIDecisionResponse({id:'receipt',usage:receipt,answers:[{name:'action',type:'choice',choice:'save',confidence:0.91},
    {name:'exists',type:'predicate',probability:0.8},{name:'severity',type:'score',score:0.6}]},request) as {id:string;usage:unknown;answers:Record<string,Record<string,unknown>>};
  assert.equal(value.id,'receipt');assert.equal(value.usage,receipt);assert.equal(value.answers.exists.noul,0.8);
  assert.equal(value.answers.severity.score,0.6);assert.equal('confidence' in value.answers.severity,false);
});
test('malformed missing and duplicated answers do not become valid plugin decisions', () => {
  const request=openAIDecisionRequest('gpt-6-luna','x',{exists:questions.exists});
  for(const answers of [[],[{name:'other',type:'predicate',probability:0.8}],[{name:'exists',type:'predicate',probability:2}],
    [{name:'exists',type:'predicate',probability:0.8},{name:'exists',type:'predicate',probability:0.8}]])
    assert.equal((openAIDecisionResponse({answers},request) as {error:{code:string}}).error.code,'decision_answer_unreadable');
});
test('native OpenAI call uses /v1/decisions, model input and named questions, with inline image and late usage retained', async () => {
  const controller=new AbortController();let calls=0;
  const result=await invokeNativeDecision({protocol:'openai_decisions',endpoint:'https://api.openai.com/v1/decisions',model:'gpt-6-luna',state:'Button',
    questions:{exists:questions.exists},images:['data:image/png;base64,YQ=='],headers:{authorization:'Bearer fixture'},signal:controller.signal,
    fetchImpl:(async (_url,init)=>{calls++;const body=JSON.parse(String(init?.body));
      assert.equal(body.model,'gpt-6-luna');assert.equal('state' in body,false);assert.equal('images' in body,false);
      assert.equal(body.input[0].content[1].image_url,'data:image/png;base64,YQ==');
      controller.abort();return Response.json({id:'paid-late',answers:[{name:'exists',type:'predicate',probability:0.9}],usage:{input_tokens:120}});
    }) as typeof fetch});
  assert.equal(calls,1);assert.equal((result.payload as {id:string}).id,'paid-late');
  assert.deepEqual((result.payload as {usage:unknown}).usage,{input_tokens:120});
});
test('native OpenAI validation happens before calling the paid endpoint', async () => {
  let calls=0;const invocation={protocol:'openai_decisions' as const,endpoint:'https://api.openai.com/v1/decisions',model:'gpt-6-luna',state:'x',questions:{exists:questions.exists},
    fetchImpl:(async()=>{calls++;return Response.json({});}) as typeof fetch};
  await assert.rejects(invokeNativeDecision({...invocation,images:['https://images.example/a.png']}),{code:'decision_images_invalid'});
  await assert.rejects(invokeNativeDecision({...invocation,questions:{action:{type:'choice',instructions:'x',criteria:{a:7,b:'B'}}}}),{code:'decision_options_invalid'});
  assert.equal(calls,0);
});
test('OpenAI decision endpoint URL preserves a relay prefix and rejects embedded credentials', () => {
  for(const path of ['','/v1','/v1/models','/v1/responses','/v1/decisions'])assert.equal(openAIDecisionsUrl('https://api.openai.com'+path),'https://api.openai.com/v1/decisions');
  assert.equal(openAIDecisionsUrl('https://relay.example/proxy/v1'),'https://relay.example/proxy/v1/decisions');
  assert.equal(openAIDecisionsUrl('https://key@api.openai.com/v1'),undefined);
});
