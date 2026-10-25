import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { CANVAS_IMAGE_TOOLS, CANVAS_IMAGE_TOOL_REGISTRY, DEFAULT_IMAGE_VARIATION_TAGS, IMAGE_VARIATION_TAGS,
  CanvasImageToolError, compileCanvasImageTool, changeImageVariationTags, prepareCanvasImageToolNodes } from '../lib/canvas-image-tools.js';
import type { CanvasImageToolId } from '../lib/canvas-image-tools.js';
import { IMAGE_TOOL_LOCALES, IMAGE_STYLE_PRESETS, IMAGE_LIGHTING_PRESETS, IMAGE_POSE_PRESETS } from '../lib/canvas-image-presets.js';
import type { CanvasModelCapability } from '../lib/canvas-capabilities.js';
import type { CanvasAssetVersion } from '../lib/canvas.js';

const source: CanvasAssetVersion = {id:'v1',assetId:'a1',kind:'image',uri:'file:///source.png',createdAt:'2026-10-01T00:00:00Z',status:'ready',metadata:{width:512,height:512,mimeType:'image/png'}};
function route(maxCount = 4): CanvasModelCapability {
  return {id:'route',providerId:'generic',providerModelId:'gpt-image-2.5-flare',displayName:'Image route',version:'v1',status:'available',sources:[],modes:[{
    mode:'imageToImage',defaultResolution:'1024x1024',outputVariants:[
      {id:'1k',resolution:'1024x1024',aspectRatios:['1:1'],defaultAspectRatio:'1:1'},
      {id:'2k',resolution:'2048x2048',aspectRatios:['1:1'],defaultAspectRatio:'1:1'},
      {id:'wide',resolution:'1536x1024',aspectRatios:['3:2'],defaultAspectRatio:'3:2'},
    ],referenceRules:{image:{supported:true,maxCount}},combinationConstraints:[{combination:'image',maxImages:maxCount}],
  }]};
}
function invalid(run: () => unknown,path?: string): void {
  assert.throws(run,error=>error instanceof CanvasImageToolError && error.code === 'IMAGE_TOOL_PARAMETERS_INVALID' && (!path || error.path===path));
}

test('each compiler exposes a complete localized schema and deterministic immutable image-to-image output',()=>{
  assert.equal(CANVAS_IMAGE_TOOL_REGISTRY.length,14);
  for(const definition of CANVAS_IMAGE_TOOL_REGISTRY) {
    const before = structuredClone(definition.defaults);
    assert.equal(definition.kind,'ai');
    for(const locale of IMAGE_TOOL_LOCALES) {
      assert.ok(definition.labels[locale]); assert.ok(definition.hints[locale]);
      for(const schema of definition.parameters) {
        assert.ok(schema.labels[locale]); assert.ok(schema.hints[locale]);
        for(const option of schema.options??[]) assert.ok(option.labels[locale]);
      }
      const params = definition.id==='image.annotatedEdit' ? {instruction:'Remove the marked sign.'} : definition.id==='image.gridStoryboard' ? {story:'The courier arrives, knocks, delivers a parcel and leaves.'} : {};
      const compiled=compileCanvasImageTool(definition.id,params,locale);
      assert.equal(compiled.toolId,definition.id); assert.equal(compiled.label,definition.labels[locale]);
      assert.equal(compiled.mode,'imageToImage'); assert.ok(compiled.prompt.trim());
      assert.deepEqual(compiled,compileCanvasImageTool(definition.id,params,locale));
      assert.ok(Object.isFrozen(compiled));assert.ok(Object.isFrozen(compiled.parametersPatch));assert.ok(Object.isFrozen(compiled.references));
      assert.ok(compiled.references.every(reference=>reference.role==='referenceImage'));
      assert.ok(Object.keys(compiled.parametersPatch).every(key=>['resolution','aspectRatio'].includes(key)));
    }
    assert.deepEqual(definition.defaults,before);
  }
});

test('lighting compiles all preset lights and preserves zero intensity with numeric direction and temperature',()=>{
  for(const preset of IMAGE_LIGHTING_PRESETS) {
    const compiled=compileCanvasImageTool('image.relight',{presetId:preset.id,overrideMainLight:true,direction:-45,height:60,intensity:0,colourTemperature:3200,softness:'hard',instruction:'Keep her expression.'});
    assert.ok(compiled.prompt.includes(preset.promptFragment));
    for(const light of preset.lights) assert.ok(compiled.prompt.includes(light.hex));
    assert.match(compiled.prompt,/azimuth -45 degrees, elevation 60 degrees, intensity 0\/10 \(main light switched off\), colour temperature 3200 K, hard light/);
    assert.ok(compiled.prompt.endsWith('Keep her expression.'));assert.deepEqual(compiled.parametersPatch,{});
    assert.deepEqual(compiled.references,[{source:'source',role:'referenceImage',purpose:'identity',order:0}]);
    const presetOnly=compileCanvasImageTool('image.relight',{presetId:preset.id});
    assert.ok(presetOnly.prompt.includes(preset.promptFragment));assert.doesNotMatch(presetOnly.prompt,/Override the main light:/);
  }
});

test('angles use one consistent distance meaning without changing pose',()=>{
  const compiled=compileCanvasImageTool('image.angle',{yaw:135,pitch:-30,distance:1.7});
  assert.match(compiled.prompt,/yaw 135 degrees, pitch -30 degrees and distance 1.7 metres/);
  assert.match(compiled.prompt,/Smaller distance means closer framing; larger distance means wider framing/);
  assert.match(compiled.prompt,/preserve the original pose/); assert.deepEqual(compiled.parametersPatch,{});
});

test('every pose preset compiles and an optional pose guide has a separate ordered reference',()=>{
  for(const preset of IMAGE_POSE_PRESETS) assert.ok(compileCanvasImageTool('image.pose',{presetId:preset.id}).prompt.includes(preset.promptFragment));
  const compiled=compileCanvasImageTool('image.pose',{presetId:'running',usePoseGuide:true});
  assert.deepEqual(compiled.references,[{source:'source',role:'referenceImage',purpose:'identity',order:0},{source:'poseGuide',role:'referenceImage',purpose:'pose',order:1}]);
  assert.match(compiled.prompt,/image 2 as the pose guide/);assert.match(compiled.prompt,/take precedence/);
});

test('shot and view associations compile seven separate full-image prompts and explicit batch counts',()=>{
  assert.equal(IMAGE_VARIATION_TAGS.length,11);
  assert.ok(IMAGE_VARIATION_TAGS.every(tag=>Object.isFrozen(tag)&&Object.isFrozen(tag.names)));
  for(const id of ['image.imagine','image.angleVariants'] as const) {
    const compiled=compileCanvasImageTool(id);
    assert.equal(compiled.variants!.length,7); assert.deepEqual(compiled.variants!.map(item=>item.tagId),DEFAULT_IMAGE_VARIATION_TAGS);
    for(const [index,item] of compiled.variants!.entries()) {
      const tag=IMAGE_VARIATION_TAGS.find(tag=>tag.id===item.tagId)!;
      assert.ok(item.prompt.includes(tag.promptFragment));assert.ok(item.prompt.includes(`variation ${index+1} of 7`));
      assert.match(item.prompt,/exactly one complete image/);assert.match(item.prompt,/no collage or contact sheet/);
      assert.deepEqual(item.parametersPatch,{}); assert.equal(item.references.length,1);
    }
    assert.equal(new Set(compiled.variants!.map(item=>item.prompt)).size,7);
    const repeated=compileCanvasImageTool(id,{tags:['wide_shot'],count:3,instruction:'Only at dawn.'});
    assert.equal(repeated.variants!.length,3);assert.match(repeated.variants![1].prompt,/distinct composition/);
    assert.ok(repeated.variants!.every(item=>item.prompt.endsWith('Only at dawn.')));
  }
});

test('changing tags keeps authored instructions until explicit overwrite',()=>{
  const params={tags:[...DEFAULT_IMAGE_VARIATION_TAGS],count:7,instruction:'My authored request'};
  assert.deepEqual(changeImageVariationTags(params,['wide_shot']),{confirmationRequired:true,parameters:params});
  assert.deepEqual(changeImageVariationTags(params,['wide_shot'],true),{confirmationRequired:false,parameters:{...params,tags:['wide_shot'],instruction:''}});
  assert.equal(params.instruction,'My authored request');invalid(()=>changeImageVariationTags(params,[]),'tags');
  const tags: Array<'wide_shot'>=['wide_shot'];
  changeImageVariationTags(params,tags,true);
  assert.equal(Object.isFrozen(tags),false);tags.push('wide_shot');
});

test('storyboard grid compiles a single ordered image with real references and validates editor bounds',()=>{
  const params={story:'The courier arrives, knocks, delivers a parcel and leaves.',gridRows:2,gridColumns:3,style:'Ink wash'};
  const compiled=compileCanvasImageTool('image.gridStoryboard',params);
  assert.match(compiled.prompt,/exactly one storyboard grid image with 2 rows and 3 columns \(6 panels\)/);
  assert.ok(compiled.prompt.includes(params.story));assert.match(compiled.prompt,/Visual style: Ink wash/);
  assert.match(compiled.prompt,/left to right, then top to bottom/);assert.match(compiled.prompt,/equal-sized cells/);
  assert.match(compiled.prompt,/Do not add panel numbers or explanatory text unless the story explicitly requests them/);
  assert.doesNotMatch(compiled.prompt,/no collage|Do not add captions, borders/);
  assert.equal(compiled.variants,undefined);assert.deepEqual(compiled.parametersPatch,{});
  assert.deepEqual(compiled.references,[{source:'source',role:'referenceImage',purpose:'identity',order:0}]);
  assert.match(compileCanvasImageTool('image.gridStoryboard',{story:'A bird flies.',gridRows:1,gridColumns:8}).prompt,/1 rows and 8 columns \(8 panels\)/);
  assert.match(compileCanvasImageTool('image.gridStoryboard',{story:'A bird flies.',gridRows:8,gridColumns:1}).prompt,/preserve the visual style of the reference image/);
  invalid(()=>compileCanvasImageTool('image.gridStoryboard'),'story');
  for(const story of ['', '  ', '\0', 'x'.repeat(6001), 0]) invalid(()=>compileCanvasImageTool('image.gridStoryboard',{...params,story} as any),'story');
  for(const key of ['gridRows','gridColumns']) for(const value of [0,9,1.5,NaN,'2']) invalid(()=>compileCanvasImageTool('image.gridStoryboard',{...params,[key]:value} as any),key);
  invalid(()=>compileCanvasImageTool('image.gridStoryboard',{...params,style:'x'.repeat(1001)}),'style');
  invalid(()=>compileCanvasImageTool('image.gridStoryboard',{...params,reference_images:source.uri} as any),'reference_images');
  const options={batchId:'grid-click',capability:route(1),references:{source:{nodeId:'source-node',version:source}}};
  const plan=prepareCanvasImageToolNodes(compiled,options);
  assert.equal(plan.nodes.length,1);assert.equal(plan.edges.length,1);assert.equal(plan.nodes[0].kind,'imageGen');
  assert.equal(plan.nodes[0].payload.prompt,compiled.prompt);assert.deepEqual(plan.nodes[0].payload.versions,[]);assert.equal(plan.nodes[0].payload.job,undefined);
  assert.deepEqual(plan.nodes[0].payload.parameters,{resolution:'1024x1024',aspectRatio:'1:1'});
  assert.equal(plan.edges[0].binding,'pinnedVersion');assert.equal(plan.edges[0].pinnedVersionId,source.id);
  assert.ok(!compiled.prompt.includes(source.uri));assert.deepEqual(plan,prepareCanvasImageToolNodes(compiled,options));
  assert.throws(()=>prepareCanvasImageToolNodes(compiled,{...options,references:{}}),error=>error instanceof CanvasImageToolError&&error.code==='IMAGE_TOOL_REFERENCE_REQUIRED');
  assert.throws(()=>prepareCanvasImageToolNodes(compiled,{...options,capability:{...route(),modes:[{...route().modes[0],mode:'textToImage'}]}}),error=>error instanceof CanvasImageToolError&&error.code==='IMAGE_TOOL_ROUTE_UNAVAILABLE');
  assert.throws(()=>prepareCanvasImageToolNodes(compiled,{...options,parameters:{aspectRatio:'16:9'}}),error=>error instanceof CanvasImageToolError&&error.code==='IMAGE_TOOL_ROUTE_UNAVAILABLE');
});

test('all 114 style compilers include original configuration fields and preservation constraints',()=>{
  for(const preset of IMAGE_STYLE_PRESETS) {
    const compiled=compileCanvasImageTool('image.styleTransfer',{presetId:preset.id,instruction:'Preserve the door.'});
    assert.ok(compiled.prompt.includes(preset.promptFragment));assert.ok(compiled.prompt.includes(JSON.stringify(preset.configuration)));
    assert.match(compiled.prompt,/not executed pixel filters/);assert.match(compiled.prompt,/Do not replace characters/);
    assert.ok(compiled.prompt.endsWith('Preserve the door.'));assert.deepEqual(compiled.parametersPatch,{});
    if(preset.parameters) assert.match(compiled.prompt,/Preserve the original rendering medium/);
  }
});

test('palette fields normalize positive weights into the prompt without unsupported transport fields',()=>{
  const colors=[{hex:'#abcdef',weight:2},{hex:'#123456',weight:1}];
  const compiled=compileCanvasImageTool('image.palette',{colors,scope:'background'});
  assert.match(compiled.prompt,/#ABCDEF \(66.6667%\), #123456 \(33.3333%\)/);
  assert.match(compiled.prompt,/Application scope: background/);assert.deepEqual(compiled.parametersPatch,{});
  assert.equal(colors[0].hex,'#abcdef');assert.equal(colors[0].weight,2);
});

test('camera body, lens, focal length and aperture are visual intent and disabled values stay inactive',()=>{
  const settings={body:'My camera',lens:'Anamorphic lens',focalLength:85,aperture:1.4};
  const compiled=compileCanvasImageTool('image.camera',settings);
  assert.match(compiled.prompt,/My camera with Anamorphic lens, focal length 85 mm and aperture f\/1.4/);
  assert.match(compiled.prompt,/do not insert a camera or brand text/);assert.deepEqual(compiled.parametersPatch,{});
  const disabled=compileCanvasImageTool('image.camera',{...settings,enabled:false});
  assert.doesNotMatch(disabled.prompt,/My camera|85 mm|f\/1.4/);
  assert.deepEqual(CANVAS_IMAGE_TOOLS['image.camera'].parameters.filter(field=>field.key!=='enabled'&&field.key!=='instruction').map(field=>field.visibleWhen),Array(4).fill({key:'enabled',equals:true}));
});

test('outpaint sets target ratio and placement, and panorama requests an equirectangular image',()=>{
  const expanded=compileCanvasImageTool('image.outpaint',{targetAspect:'3:2',placement:'left',instruction:'Continue the beach.'});
  assert.deepEqual(expanded.parametersPatch,{aspectRatio:'3:2'});assert.match(expanded.prompt,/left of a target 3:2 canvas/);assert.match(expanded.prompt,/only the newly exposed regions/);
  const panorama=compileCanvasImageTool('image.panorama',{instruction:'Keep the mountain range.'});
  assert.equal(panorama.output,'panorama-image');assert.deepEqual(panorama.parametersPatch,{aspectRatio:'2:1'});assert.match(panorama.prompt,/360-degree equirectangular/);
});

test('marked editing sends the mark overlay and instructions as an ordinary reference, without a mask',()=>{
  const compiled=compileCanvasImageTool('image.annotatedEdit',{instruction:'Replace the numbered region with flowers.'});
  assert.deepEqual(compiled.references,[{source:'source',role:'referenceImage',purpose:'identity',order:0},{source:'marks',role:'referenceImage',purpose:'annotation',order:1}]);
  assert.match(compiled.prompt,/Replace the numbered region with flowers/);assert.match(compiled.prompt,/Never reproduce any mark/);
  assert.deepEqual(compiled.parametersPatch,{});invalid(()=>compileCanvasImageTool('image.annotatedEdit'),'instruction');
});

test('upscale carries highest-resolution intent; depth illustration makes no depth-data claim',()=>{
  const upscale=compileCanvasImageTool('image.upscale');assert.equal(upscale.resolutionPolicy,'highest');assert.deepEqual(upscale.parametersPatch,{});
  const depth=compileCanvasImageTool('image.depthIllustration',{invert:true});assert.equal(depth.output,'depth-illustration');
  assert.match(depth.prompt,/near objects dark and far objects bright/);assert.match(depth.prompt,/ordinary image/);assert.match(depth.prompt,/do not claim metric depth/);
});

test('every compiler rejects invalid runtime data instead of silently repairing input',()=>{
  const cases:[CanvasImageToolId,any,string][]=[
    ['image.relight',{intensity:NaN},'intensity'],['image.angle',{distance:0},'distance'],['image.pose',{presetId:'missing'},'presetId'],
    ['image.imagine',{tags:[]},'tags'],['image.angleVariants',{count:1.5},'count'],['image.styleTransfer',{presetId:'missing'},'presetId'],
    ['image.palette',{colors:[{hex:'#ABCDEF',weight:0}]},'colors'],['image.camera',{aperture:0},'aperture'],['image.outpaint',{targetAspect:'free'},'targetAspect'],
    ['image.panorama',{instruction:0},'instruction'],['image.annotatedEdit',{instruction:'  '},'instruction'],['image.upscale',{instruction:'x'.repeat(6001)},'instruction'],['image.depthIllustration',{invert:'true'},'invert'],
  ];
  for(const [id,params,path] of cases) invalid(()=>compileCanvasImageTool(id,params),path);
  invalid(()=>compileCanvasImageTool('image.imagine',{tags:['wide_shot','wide_shot']}),'tags');
  invalid(()=>compileCanvasImageTool('image.upscale',{mask:'bad'} as any),'mask');
  invalid(()=>compileCanvasImageTool('image.angle',null as any),'params');
  invalid(()=>compileCanvasImageTool('image.angle',{},'xx' as any),'locale');
  assert.throws(()=>compileCanvasImageTool('toString' as any),error=>error instanceof CanvasImageToolError&&error.code==='IMAGE_TOOL_UNKNOWN');
});

test('batch draft nodes pin source versions, retain individual prompts and do not invoke generation',()=>{
  const compiled=compileCanvasImageTool('image.imagine'); const capability=route();const before=structuredClone(source);
  const options={batchId:'click1',capability,references:{source:{nodeId:'source-node',version:source}},locale:'zh-CN' as const,position:{x:100,y:200}};
  const plan=prepareCanvasImageToolNodes(compiled,options);
  assert.equal(plan.nodes.length,7);assert.equal(plan.edges.length,7);assert.equal(plan.capabilityVersion,'v1');
  assert.equal(plan.nodes[0].title,'画面联想 1/7');assert.equal(plan.nodes[4].position.y,480);
  for(const [index,node] of plan.nodes.entries()) {
    assert.equal(node.payload.prompt,compiled.variants![index].prompt);assert.equal(node.payload.modelId,capability.providerModelId);
    assert.deepEqual(node.payload.parameters,{resolution:'1024x1024',aspectRatio:'1:1'});assert.deepEqual(node.payload.versions,[]);assert.equal(node.payload.job,undefined);
    assert.equal(plan.edges[index].binding,'pinnedVersion');assert.equal(plan.edges[index].pinnedVersionId,'v1');assert.equal(plan.edges[index].sourceNodeId,'source-node');
  }
  assert.deepEqual(plan,prepareCanvasImageToolNodes(compiled,options));assert.deepEqual(source,before);
  assert.ok(Object.isFrozen(plan.nodes));assert.ok(!Object.isFrozen(capability));
});

test('draft preparation resolves mark and pose references, highest pixels and fails closed on unavailable routes',()=>{
  const marks={...source,id:'marks',assetId:'m'};
  const marked=prepareCanvasImageToolNodes(compileCanvasImageTool('image.annotatedEdit',{instruction:'Remove red mark.'}),{batchId:'marks',capability:route(2),references:{source:{version:source},marks:{version:marks}}});
  assert.deepEqual(marked.nodes[0].payload.inputs!.map(input=>input.version.id),[source.id,'marks']);assert.deepEqual(marked.edges,[]);
  // One-picture routes cannot hold the clean original and the marked copy, so the tool is unavailable there rather than leaking marks.
  assert.throws(()=>prepareCanvasImageToolNodes(compileCanvasImageTool('image.annotatedEdit',{instruction:'Edit'}),{batchId:'single',capability:route(1),references:{source:{version:source},marks:{version:marks}}}),error=>error instanceof CanvasImageToolError&&error.code==='IMAGE_TOOL_ROUTE_UNAVAILABLE');
  const upscaled=prepareCanvasImageToolNodes(compileCanvasImageTool('image.upscale'),{batchId:'upscale',capability:route(),references:{source:{version:source}},parameters:{resolution:'1024x1024'}});
  assert.equal(upscaled.nodes[0].payload.parameters.resolution,'2048x2048');
  assert.throws(()=>prepareCanvasImageToolNodes(compileCanvasImageTool('image.pose',{usePoseGuide:true}),{batchId:'pose',capability:route(1),references:{source:{version:source},poseGuide:{version:marks}}}),error=>error instanceof CanvasImageToolError&&error.code==='IMAGE_TOOL_ROUTE_UNAVAILABLE');
  assert.throws(()=>prepareCanvasImageToolNodes(compileCanvasImageTool('image.annotatedEdit',{instruction:'Edit'}),{batchId:'missing',capability:route(),references:{source:{version:source}}}),error=>error instanceof CanvasImageToolError&&error.code==='IMAGE_TOOL_REFERENCE_REQUIRED');
  assert.throws(()=>prepareCanvasImageToolNodes(compileCanvasImageTool('image.panorama'),{batchId:'pano',capability:route(),references:{source:{version:source}}}),error=>error instanceof CanvasImageToolError&&error.code==='IMAGE_TOOL_ROUTE_UNAVAILABLE');
});

test('image workbench package subpaths expose the same registry and pure helpers',()=>{
  const require=createRequire(import.meta.url);
  assert.equal(require('@nextmux/comic-core/canvas-image-tools').CANVAS_IMAGE_TOOLS,CANVAS_IMAGE_TOOLS);
  assert.equal(require('@nextmux/comic-core/canvas-image-presets').IMAGE_STYLE_PRESETS,IMAGE_STYLE_PRESETS);
  assert.equal(typeof require('@nextmux/comic-core/canvas-image-tool-routes').resolveCanvasImageToolRoute,'function');
  assert.equal(require('@nextmux/comic-core').compileCanvasImageTool,compileCanvasImageTool);
});
