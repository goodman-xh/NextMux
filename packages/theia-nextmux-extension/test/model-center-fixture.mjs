import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
export async function startModelCenterFixture() {
    const entry = `import * as React from 'react'; import {createRoot} from 'react-dom/client';
import {ModelCenterMerchants} from './nextmux-model-center-merchants';
import {merchantModelCategory} from '@nextmux/model-runtime/merchant-modalities';
const params=new URLSearchParams(location.search), locale=params.get('locale')||'en';
const count=Number(params.get('count')||2); const calls=[], requests=[]; let fail=params.has('error'), favorite=new Map(), view=params.get('view')||'all', query='', capability='all';
const merchants=Array.from({length:count},(_,i)=>({id:'fixture-'+String(i).padStart(3,'0'), publicCode:'RLY-'+i.toString(16).padStart(16,'0').toUpperCase(), name:params.has('long')?'Synthetic Research Collective — International Foundation for Multilingual Scientific Software and Reliable Model Infrastructure':i===0?'Synthetic Research Collective':'Synthetic Relay '+(i+1),
 metrics:{quality:i===0?undefined:100,availability:.955,latencyMs:125,multiplierBps:250},
 measurement:{quality:{state:i===0?'pending':'measured',reason:i===0?'no_feedback':undefined,sampleCount:i===0?0:8},availability:{state:'pending',reason:'measurement_not_enabled',sampleCount:0},latency:{state:'pending',reason:'measurement_not_enabled',sampleCount:0}},
 apiStatus:{state:'ready',lastCheckedAt:Date.now()},outputCategories:['text','image'],
 ...(params.has('store')&&i===0?{storeTagline:'官方直连 · 7×24 小时技术支持，故障 5 分钟内切换备用线路，企业开票',storeDescription:'我们专注于大模型 API 中转服务三年，覆盖 GPT、Claude、Gemini、DeepSeek 等主流模型。\\n\\n所有线路均为官方直连，不掺假、不降级；按实际用量计费，价格透明。支持企业对公转账与增值税专票，大客户可申请专属线路和更高并发。\\n\\n遇到问题请在工作时间内通过网站工单联系我们，通常 10 分钟内回复；夜间有值班工程师处理紧急故障。我们会定期公布可用性报告，欢迎监督。'}:{}),
 ...(params.has('store')&&i===1?{storeTagline:'Low-latency Asia routes for coding models'}:{}) }));
const rates=['input_token','cached_input_token','cache_write_token','output_token'].map((metric,i)=>({metric,currency:'USD',official:{unitSize:1000000,amountMicros:params.has('long')?123456789000000:(i+1)*2000000,sourceType:'catalog_reference'},user:{unitSize:1000,amountMicros:params.has('long')?345678912300:(i+1)*6000}}));
const offering=(id,status='active')=>({id,registryModelId:'model-'+id,canonicalModel:'fixture/model-'+id,displayName:'Synthetic Model '+id,
 status,output:['text'],input:['text','image'],capabilities:['tools'],multiplierBps:30000,pricingDetails:{status:'complete',currency:'USD',quoteAt:Date.now(),multiplierBps:30000,dimensions:rates}});
const supportRequests=[], supportHeld=new Set(), supportPending=[], supportFailures=new Map(); let supportRepeatCursor=false;
const supportCount=Number(params.get('catalogCount')||0), supportPageSize=Number(params.get('catalogPageSize')||40);
const supportRows=supportCount?Array.from({length:supportCount},(_,index)=>({...offering(String(index).padStart(3,'0')),
 displayName:index===205?'Aurora 中文 GPT-4.1 Cinema':index===209?'Second 中文 GPT-4.1 Studio':'Synthetic Catalog Model '+index,
 canonicalModel:index===205?'openai/gpt-4.1-cinema':index===209?'openai/gpt-4.1-studio':'fixture/catalog-'+index,
 output:index===205||index===209?['video']:['text']})):[offering('A'),offering('B'),offering('C'),offering('suspended','suspended'),{...offering('duplicate'),registryModelId:'model-A',displayName:'Wrong duplicate last endpoint'}];
if(params.has('mixedModalities'))for(const [index,model] of [
 [1,{displayName:'OpenAI GPT-5.5',canonicalModel:'openai/gpt-5.5',kind:'llm',capabilities:['tools','reasoning','image_generation']}],
 [2,{displayName:'OpenAI GPT Image 2',canonicalModel:'openai/gpt-image-2',kind:'image',capabilities:['image_generation']}],
 [41,{displayName:'OpenAI GPT-5.5 Pro',canonicalModel:'openai/gpt-5.5-pro',kind:'llm',capabilities:['tools','reasoning','image_generation']}],
 [42,{displayName:'Google Gemini Image',canonicalModel:'google/gemini-image',kind:'image',capabilities:['tools','reasoning','image_generation']}]
])if(supportRows[index])supportRows[index]={...supportRows[index],...model,output:['text','image']};
const searchForm=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[._/:\\-]/g,'');
const supportCategory=merchantModelCategory;
const service={async getPublicMerchantDirectory(input={}){requests.push({...input}); await new Promise(resolve=>setTimeout(resolve,input.query==='slow'?180:params.has('delay')?(Number(params.get('delay'))>1?Number(params.get('delay')):150):10));
 if(fail){fail=false;throw Error('synthetic failure');} let rows=merchants.filter(m=>(!input.merchantIds||input.merchantIds.includes(m.id))&&(!input.query||m.name.toLowerCase().includes(input.query.toLowerCase())||m.publicCode.toLowerCase().includes(input.query.toLowerCase())));
 if(input.query==='slow')rows=[{...merchants[0],id:'late-should-not-win',name:'Late'}];
 const after=input.after?Number(input.after.replace('cursor-','')):0;const result=rows.slice(after,after+100);
 return {merchants:result,totalCount:rows.length,measuredAt:new Date().toISOString(),...(after+100<rows.length?{nextCursor:'cursor-'+(after+100)}:{})};},
 async getMerchantDiscoveredModels(id){return {merchantId:id,models:[{id:'raw-unpriced-model',displayName:'Raw unpriced must not appear',listingIds:[]}],stats:{discoveredCount:428,executableCount:3},state:'ready',measuredAt:new Date().toISOString()};},
 async getMerchantCatalog(id){requests.push({catalog:id});return {merchantId:id,offerings:[offering('A'),offering('B'),offering('C'),offering('suspended','suspended'),{...offering('duplicate'),registryModelId:'model-A',displayName:'Wrong duplicate last endpoint'}],online:true};},
 async getMerchantSupportCatalog(id,input={},force){const request={catalog:id,support:true,...input,...(force?{force:true}:{})};requests.push(request);supportRequests.push(request);
  if(supportHeld.has(input.search||''))await new Promise(resolve=>supportPending.push({search:input.search||'',resolve}));
  await new Promise(resolve=>setTimeout(resolve,10)); const failureKey=input.after||'';
  const failure=supportFailures.get(failureKey);if(failure?.count>0){failure.count--;throw Error(failure.message);}
  const terms=String(input.search||'').trim().split(/\\s+/).filter(Boolean).map(searchForm);
  const matching=supportRows.filter(row=>(!input.category||input.category==='all'||supportCategory(row)===input.category)
   &&terms.every(term=>searchForm([row.displayName,row.canonicalModel,row.registryModelId].join(' ')).includes(term)));
  const offset=input.after?Number(input.after.replace('support-','')):0,limit=supportCount?supportPageSize:100;
  const nextCursor=supportRepeatCursor&&input.after?input.after:offset+limit<matching.length?'support-'+(offset+limit):undefined;
  return {merchantId:id,offerings:matching.slice(offset,offset+limit),online:true,displayOnly:true,snapshotVersion:'fixture-support-v1',matchedOfferingCount:matching.length,...(nextCursor?{nextCursor}:{})};}};
const root=createRoot(document.getElementById('fixture'));
function render(){root.render(<div className='nmx-desktop-widget fixture-widget'><div className={'nmx-shell nmx-theme-'+(params.get('theme')||'dark')}><div className='fixture-titlebar'>Titlebar tabs</div><section className='nmx-workspace fixture-workspace'><header className='nmx-workspace-topbar fixture-topbar'><strong>Model Center</strong></header><div className='nmx-workspace-scroll nmx-model-center fixture-scroll'><ModelCenterMerchants service={service} locale={locale} view={view} query={query} capability={capability} favorites={[...favorite]}
 onFavorite={(id,name)=>{calls.push(['favorite',id]);favorite.has(id)?favorite.delete(id):favorite.set(id,name);render();}} onCopy={async id=>{calls.push(['copy',id]);}}/></div></section></div></div>);}
window.fixture={calls,requests,merchants,supportRequests,
 holdSupport:search=>supportHeld.add(search),releaseSupport:search=>{supportHeld.delete(search);for(let i=supportPending.length-1;i>=0;i--)if(supportPending[i].search===search)supportPending.splice(i,1)[0].resolve();},
 failSupportAfter:(after,count=1,message='Synthetic support page failure')=>supportFailures.set(after||'',{count,message}),repeatSupportCursor:value=>{supportRepeatCursor=value;},
 setQuery:value=>{query=value;render();},setView:value=>{view=value;render();},setCapability:value=>{capability=value;view='capability';render();},setFavorites:ids=>{favorite=new Map(ids.map(id=>[id,id]));render();},setFavoriteEntries:entries=>{favorite=new Map(entries);render();}};render();`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', sourcefile: 'model-center-fixture.tsx',
        resolveDir: dirname(fileURLToPath(new URL('../src/browser/nextmux-model-center-merchants.tsx', import.meta.url))) },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    const assets = {
        '/fixture.js': ['text/javascript', outputFiles[0].contents],
        '/style.css': ['text/css', await readFile(new URL('../src/browser/style/nextmux.css', import.meta.url))],
        '/production.css': ['text/css', await readFile(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url))],
        '/model-center.css': ['text/css', await readFile(new URL('../src/browser/style/nextmux-model-center.css', import.meta.url))],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))],
        '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html dir='ltr'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<link rel='stylesheet' href='/icons.css'><link rel='stylesheet' href='/style.css'><link rel='stylesheet' href='/production.css'><link rel='stylesheet' href='/model-center.css'>
<style>html,body,#fixture,.fixture-widget{margin:0;width:100%;height:100%;font:13px system-ui}*{box-sizing:border-box}.nmx-shell{display:block;width:100%;height:100%;position:relative}.fixture-titlebar{position:absolute;inset:0 0 auto 0;height:40px;z-index:5;display:flex;align-items:center;justify-content:center}.nmx-shell .fixture-workspace{height:100%;padding-top:40px}.fixture-scroll{flex:1;min-height:0;padding:16px;overflow:auto}</style>
</head><body><div id='fixture'></div><script src='/fixture.js'></script></body></html>`]
    };
    const server = createServer((request, response) => {
        const asset = request.method === 'GET' ? assets[new URL(request.url, 'http://127.0.0.1').pathname] : undefined;
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain', 'cache-control': 'no-store',
            'content-security-policy': "default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'none';img-src 'none';font-src 'self'" });
        response.end(asset?.[1] || 'Not found');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log((await startModelCenterFixture()).origin);
