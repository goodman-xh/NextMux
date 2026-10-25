import test from 'node:test';
import assert from 'node:assert/strict';
import {storedDeviceRoute,deviceRouteForRequest} from '../lib/node/nextmux-device-route.js';
import {NextMuxPlatformServiceImpl} from '../lib/node/nextmux-platform-service.js';
const token='nmx-dr1.cGF5bG9hZA.'+'a'.repeat(64);
const proof={token,expiresAt:Date.now()+86400000};
class RouteService extends NextMuxPlatformServiceImpl {
 constructor(){super();this.baseUrl='https://platform.invalid';this.stored=undefined;this.saved=[];}
 async ensureNetworkConfigured(){}
 async deviceId(){return 'fixture-device-id';}
 async readStoredDeviceRoute(){return this.stored;}
 async saveStoredDeviceRoute(route){this.stored=route;this.saved.push(route);}
 async clearDeviceLinkRequestId(){}
 updateMediaDeliverySession(){}
}
test('device route proof only accompanies its exact platform and device, and expires without a POST retry',()=>{
 const route=storedDeviceRoute({...proof,origin:'https://platform.invalid',deviceId:'fixture-device-id'});
 assert.ok(route);assert.equal(deviceRouteForRequest(route,route.origin,route.deviceId),token);
 assert.equal(deviceRouteForRequest(route,'https://other.invalid',route.deviceId),undefined);
 assert.equal(deviceRouteForRequest(route,route.origin,'other-device'),undefined);
 assert.equal(deviceRouteForRequest(route,route.origin,route.deviceId,proof.expiresAt),undefined);
 assert.equal(storedDeviceRoute({...route,origin:'https://platform.invalid/path'}),undefined);
});
test('platform HTTP adds stored proof, rejects redirect forwarding and strips caller supplied proof from other origins',async t=>{
 const service=new RouteService();service.stored={...proof,origin:service.baseUrl,deviceId:await service.deviceId()};const sent=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{sent.push({url,init});return new Response('{}');});
 await service.networkFetch('https://platform.invalid/api/gateway',{method:'POST',headers:{'x-nextmux-device-id':'fixture-device-id'},body:'{}'});
 assert.equal(sent[0].init.headers.get('x-nextmux-device-route'),token);assert.equal(sent[0].init.redirect,'error');
 await service.networkFetch('https://upstream.invalid/result',{headers:{'x-nextmux-device-route':token}});
 assert.equal(sent[1].init.headers.get('x-nextmux-device-route'),null);
 assert.equal(sent.length,2);
});
test('linked session accepts proof once, routine session polls do not rewrite it, signout clears after server acknowledgement',async()=>{
 const service=new RouteService();service.request=async()=>({linked:true,wallets:[],deviceRoute:proof});
 await service.getDeviceSession();await service.getDeviceSession();assert.equal(service.saved.length,1);
 assert.equal(service.stored.token,token);
 let fail=true;service.request=async()=>{if(fail)throw Error('offline');return{ok:true};};
 await assert.rejects(service.signOutDevice(),/offline/);assert.equal(service.stored.token,token);
 fail=false;await service.signOutDevice();assert.equal(service.stored,undefined);
});
test('read-only session refresh drops a rejected proof exactly once and never repeats a generation POST',async t=>{
 const service=new RouteService();service.stored={...proof,origin:service.baseUrl,deviceId:await service.deviceId()};const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls.push({url:String(url),method:init?.method||'GET',proof:new Headers(init?.headers).get('x-nextmux-device-route')});
  if(calls.length===1)return Response.json({ok:false,code:'device_route_stale',message:'fixture stale'},{status:401});
  return Response.json({ok:true,linked:true,wallets:[],deviceRoute:proof});
 });
 await service.getDeviceSession();assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method==='GET'));
 assert.equal(calls[0].proof,token);assert.equal(calls[1].proof,null);
});
