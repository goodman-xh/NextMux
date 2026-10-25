import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import{retainedManagedDispatchRoute}from'../lib/browser/nextmux-retained-managed-selection.js';
const id=randomUUID(),merchantId=randomUUID(),routeId=`managed:fixed:${id}`,relayKey=`managed:${merchantId}`;
const offering={id,merchantId,registryModelId:'model-registry',canonicalModel:'vendor/model',status:'inactive'};
const retained={ownerId:'user-a',sessionId:'session-a',routeId,relayKey,modelId:'vendor/model',registryModelId:'model-registry',offering};
const input={ownerId:'user-a',sessionId:'session-a',routeId,relayKey,modelId:'vendor/model',automaticRelaySource:'user',retained};
test('explicit same-model opt-in retains original unavailable fixed identity for authoritative server selection',()=>{
 const result=retainedManagedDispatchRoute(input);assert.equal(result.id,routeId);assert.equal(result.automatic,false);assert.equal(result.offering,offering);assert.equal(result.offering.status,'inactive');
});
test('off and absent historical identity cannot authorize another dispatch',()=>{
 for(const value of [{...input,automaticRelaySource:'off'},{...input,retained:undefined},{...input,automaticRelaySource:'unknown'}])assert.equal(retainedManagedDispatchRoute(value),undefined);
});
test('foreign owner/conversation/API/merchant/registry/canonical model identity is rejected',()=>{
 for(const patch of [{ownerId:'user-b'},{sessionId:'session-b'},{routeId:`managed:fixed:${randomUUID()}`},{relayKey:`managed:${randomUUID()}`},{modelId:'vendor/different'}])assert.equal(retainedManagedDispatchRoute({...input,...patch}),undefined);
 for(const patch of [{registryModelId:'other-registry'},{offering:{...offering,registryModelId:'other-registry'}},{offering:{...offering,canonicalModel:'vendor/different'}},{offering:{...offering,merchantId:randomUUID()}}])assert.equal(retainedManagedDispatchRoute({...input,retained:{...retained,...patch}}),undefined);
});
