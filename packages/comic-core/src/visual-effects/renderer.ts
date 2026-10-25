import { GPU_EFFECT_REGISTRY, comicClipHasVisualProcessing, type ComicVisualEffect, type ComicVisualMask } from '../visual-effects.js';
import { evaluateComicCompositionClip, evaluateComicCompositionProperty, comicCompositionTextLines, type ComicCompositionClip } from '../composition.js';
import { FULLSCREEN_QUAD_WGSL } from './freecut/shared/fullscreen-quad.js';
import { COMMON_WGSL } from './freecut/common.js';
// WebGPU is still outside TypeScript's DOM declarations. This boundary is deliberately
// isolated; all persisted data is validated by comic-core before reaching the GPU.
type GpuObject = any;
const textureUsage = { COPY_SRC:1, COPY_DST:2, TEXTURE_BINDING:4, STORAGE_BINDING:8, RENDER_ATTACHMENT:16 };
const bufferUsage = {COPY_DST:8, UNIFORM:64};
const blit = `${FULLSCREEN_QUAD_WGSL}\n@group(0) @binding(0) var s: sampler; @group(0) @binding(1) var t: texture_2d<f32>; @fragment fn main(i:VertexOutput)->@location(0) vec4f {let c=textureSample(t,s,i.uv);return vec4f(c.rgb*c.a,c.a);}`;
export class ComicVisualRenderer {
  private readonly source:OffscreenCanvas; private readonly plane:OffscreenCanvas; private readonly output:OffscreenCanvas; private readonly below:OffscreenCanvas;
  private readonly sourceContext:OffscreenCanvasRenderingContext2D; private readonly planeContext:OffscreenCanvasRenderingContext2D; private readonly context:OffscreenCanvasRenderingContext2D;
  private device?:GpuObject; private gpuOutput?:OffscreenCanvas; private gpuContext?:GpuObject; private ping?:GpuObject; private pong?:GpuObject; private sampler?:GpuObject; private blitPipeline?:GpuObject;
  private readonly pipelines=new Map<string,GpuObject>();private readonly uniforms=new Map<string,GpuObject>();private readonly textures=new Map<string,{key:string;texture:GpuObject}>();private readonly maskCache=new Map<string,OffscreenCanvas>();
  private failure?:Error;private disposed=false;private initialized?:Promise<void>;
  constructor(readonly width:number,readonly height:number){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>33554432)throw Error('Unsupported picture dimensions');
    this.source=new OffscreenCanvas(width,height);this.plane=new OffscreenCanvas(width,height);this.output=new OffscreenCanvas(width,height);this.below=new OffscreenCanvas(width,height);
    this.sourceContext=this.source.getContext('2d')!;this.planeContext=this.plane.getContext('2d')!;this.context=this.output.getContext('2d')!;
    if(!this.sourceContext||!this.planeContext||!this.context)throw Error('Canvas renderer unavailable');
  }
  async prepare():Promise<void>{
    if(this.failure)throw this.failure;if(this.disposed)throw Error('Visual renderer closed');
    if(!this.initialized)this.initialized=(async()=>{
      const gpu=(navigator as unknown as {gpu?:GpuObject}).gpu;if(!gpu)throw Error('WebGPU is unavailable on this device');
      const adapter=await gpu.requestAdapter();if(!adapter)throw Error('No compatible graphics adapter');this.device=await adapter.requestDevice();
      const d=this.device;if(this.width>d.limits.maxTextureDimension2D||this.height>d.limits.maxTextureDimension2D)throw Error('Picture exceeds graphics adapter limits');
      d.lost.then((info:{message:string})=>{if(!this.disposed)this.failure=Error(`Graphics device lost: ${info.message}`);});
      d.addEventListener('uncapturederror',(e:{error:{message:string}})=>{this.failure??=Error(`Visual rendering failed: ${e.error.message}`);});
      this.sampler=d.createSampler({magFilter:'linear',minFilter:'linear'});
      const descriptor={size:[this.width,this.height],format:'rgba8unorm',usage:Object.values(textureUsage).reduce((a,b)=>a|b,0)};
      this.ping=d.createTexture(descriptor);this.pong=d.createTexture(descriptor);this.gpuOutput=new OffscreenCanvas(this.width,this.height);this.gpuContext=this.gpuOutput.getContext('webgpu');
      if(!this.gpuContext)throw Error('WebGPU canvas unavailable');const format=gpu.getPreferredCanvasFormat();this.gpuContext.configure({device:d,format,alphaMode:'premultiplied'});
      this.blitPipeline=await d.createRenderPipelineAsync({layout:'auto',vertex:{module:d.createShaderModule({code:blit}),entryPoint:'vertexMain'},fragment:{module:d.createShaderModule({code:blit}),entryPoint:'main',targets:[{format}]},primitive:{topology:'triangle-list'}});
    })().catch(error=>{this.failure=error instanceof Error?error:Error(String(error));throw this.failure;});
    await this.initialized;
  }
  /** Used before decoding: unsupported shaders fail before costly export work. */
  async preflight(effects:readonly ComicVisualEffect[]):Promise<void>{if(effects.some(e=>e.enabled))await this.prepare();for(const effect of effects)if(effect.enabled)await this.pipeline(effect.type);}
  private async pipeline(type:string):Promise<GpuObject>{
    let p=this.pipelines.get(type);if(p)return p;const def=GPU_EFFECT_REGISTRY.get(type);if(!def)throw Error(`Unknown effect ${type}`);
    const d=this.device!,module=d.createShaderModule({code:`${COMMON_WGSL}\n${def.shader}`});const info=await module.getCompilationInfo();
    const errors=info.messages.filter((m:{type:string})=>m.type==='error');if(errors.length)throw Error(`${def.name}: ${errors.map((m:{message:string})=>m.message).join('; ')}`);
    const visibility=def.compute?4:2;const entries=def.compute?[{binding:0,visibility,texture:{}},{binding:1,visibility,storageTexture:{access:'write-only',format:'rgba8unorm'}}]:[{binding:0,visibility,sampler:{}},{binding:1,visibility,texture:{}}];
    if(def.uniformSize)entries.push({binding:2,visibility,buffer:{type:'uniform'}} as never);if(def.dataTexture)entries.push({binding:3,visibility,texture:{viewDimension:def.dataTexture.dimension}} as never);
    const layout=d.createPipelineLayout({bindGroupLayouts:[d.createBindGroupLayout({entries})]});
    p=def.compute?await d.createComputePipelineAsync({layout,compute:{module,entryPoint:def.entryPoint}}):await d.createRenderPipelineAsync({layout,vertex:{module,entryPoint:'vertexMain'},fragment:{module,entryPoint:def.entryPoint,targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
    this.pipelines.set(type,p);return p;
  }
  private async effects(effects:readonly ComicVisualEffect[]):Promise<OffscreenCanvas>{
    const enabled=effects.filter(e=>e.enabled);if(!enabled.length)return this.source;await this.prepare();
    const d=this.device!;d.queue.copyExternalImageToTexture({source:this.source},{texture:this.ping},[this.width,this.height]);let input=this.ping,output=this.pong;
    for(const effect of enabled){
      const def=GPU_EFFECT_REGISTRY.get(effect.type)!,pipeline=await this.pipeline(effect.type),packed=def.packUniforms({...effect.params},this.width,this.height);
      const entries:GpuObject[]=def.compute?[{binding:0,resource:input.createView()},{binding:1,resource:output.createView()}]:[{binding:0,resource:this.sampler},{binding:1,resource:input.createView()}];
      if(packed){const key=effect.type;let b=this.uniforms.get(key);if(!b){b=d.createBuffer({size:Math.max(16,def.uniformSize,packed.byteLength),usage:bufferUsage.COPY_DST|bufferUsage.UNIFORM});this.uniforms.set(key,b);}d.queue.writeBuffer(b,0,packed);entries.push({binding:2,resource:{buffer:b}});}
      if(def.dataTexture){const key=def.dataTexture.key({...effect.params});let cached=this.textures.get(effect.type);if(!cached||cached.key!==key){cached?.texture.destroy();const data=def.dataTexture.build({...effect.params});if(data.width*data.height*data.depth*4!==data.data.length||data.data.length>200000)throw Error('Invalid effect auxiliary texture');
        const texture=d.createTexture({size:[data.width,data.height,data.depth],dimension:def.dataTexture.dimension,format:'rgba8unorm',usage:6});
        d.queue.writeTexture({texture},data.data,{bytesPerRow:data.width*4,rowsPerImage:data.height},[data.width,data.height,data.depth]);cached={key,texture};this.textures.set(effect.type,cached);}entries.push({binding:3,resource:cached.texture.createView({dimension:def.dataTexture.dimension})});}
      const encoder=d.createCommandEncoder(),group=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries});
      if(def.compute){const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(...def.compute.dispatch(this.width,this.height));pass.end();}
      else {const pass=encoder.beginRenderPass({colorAttachments:[{view:output.createView(),loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(6);pass.end();}
      d.queue.submit([encoder.finish()]);[input,output]=[output,input];
    }
    const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.gpuContext!.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store'}]});
    pass.setPipeline(this.blitPipeline);pass.setBindGroup(0,d.createBindGroup({layout:this.blitPipeline!.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:input.createView()}]}));pass.draw(6);pass.end();d.queue.submit([encoder.finish()]);await d.queue.onSubmittedWorkDone();if(this.failure)throw this.failure;return this.gpuOutput!;
  }
  begin():void{if(this.failure)throw this.failure;this.context.setTransform(1,0,0,1,0,0);this.context.globalCompositeOperation='source-over';this.context.globalAlpha=1;this.context.fillStyle='#000';this.context.fillRect(0,0,this.width,this.height);}
  private mask(mask:ComicVisualMask):OffscreenCanvas{
    const key=JSON.stringify(mask),cached=this.maskCache.get(key);if(cached)return cached;
    const canvas=new OffscreenCanvas(this.width,this.height),ctx=canvas.getContext('2d')!;ctx.save();ctx.translate(mask.x*this.width,mask.y*this.height);ctx.rotate(mask.rotation*Math.PI/180);ctx.scale(mask.width*this.width,mask.shape==='circle'?mask.width*this.width:mask.height*this.height);ctx.beginPath();
    if(mask.shape==='rectangle')ctx.rect(-.5,-.5,1,1);else if(mask.shape==='ellipse'||mask.shape==='circle')ctx.ellipse(0,0,.5,.5,0,0,Math.PI*2);else {const points=mask.points!;ctx.moveTo(points[0].x-.5,points[0].y-.5);for(let i=1;i<=points.length;i++){const a=points[(i-1)%points.length],b=points[i%points.length];ctx.bezierCurveTo((a.outX??a.x)-.5,(a.outY??a.y)-.5,(b.inX??b.x)-.5,(b.inY??b.y)-.5,b.x-.5,b.y-.5);}ctx.closePath();}
    ctx.restore();ctx.fillStyle='#fff';ctx.filter=mask.feather?`blur(${mask.feather}px)`:'none';ctx.fill();ctx.filter='none';
    // Mask opacity mixes the mask with identity; zero opacity has no effect.
    const result=new OffscreenCanvas(this.width,this.height),r=result.getContext('2d')!;r.fillStyle='#fff';r.fillRect(0,0,this.width,this.height);
    if(mask.invert){r.globalCompositeOperation='destination-out';r.globalAlpha=mask.opacity;r.drawImage(canvas,0,0);}else {r.globalCompositeOperation='destination-in';r.globalAlpha=1;r.drawImage(canvas,0,0);if(mask.opacity<1){r.globalCompositeOperation='source-over';r.globalAlpha=1-mask.opacity;r.fillStyle='#fff';r.fillRect(0,0,this.width,this.height);}}
    this.maskCache.set(key,result);while(this.maskCache.size>Math.max(1,Math.min(16,Math.floor(33554432/(this.width*this.height*4))))){const first=this.maskCache.keys().next().value!,old=this.maskCache.get(first)!;this.maskCache.delete(first);old.width=old.height=0;}return result;
  }
  async add(clip:ComicCompositionClip,localFrame:number,fps:number,source?:CanvasImageSource,text?:string):Promise<void>{
    if(this.failure)throw this.failure;const s=this.sourceContext,w=this.width,h=this.height;s.setTransform(1,0,0,1,0,0);s.globalAlpha=1;s.globalCompositeOperation='source-over';s.clearRect(0,0,w,h);
    if(clip.legacyFadeToBlack){s.fillStyle='#000';s.fillRect(0,0,w,h);}
    if(clip.kind==='text'){
      const style=clip.textStyle,size=style?.fontSize??56;const font=/Mac|iPhone|iPad/.test(navigator.platform)?'PingFang SC':/Win/.test(navigator.platform)?'Microsoft YaHei':'Noto Sans CJK SC';
      s.font=`${style?.bold?'bold ':''}${size}px "${font}", sans-serif`;s.textBaseline='middle';s.textAlign=style?.align??'center';const x=style?.align==='left'?0:style?.align==='right'?w:w/2;
      const lines=comicCompositionTextLines(text??clip.text??'',size,w).split('\n');lines.forEach((line,i)=>{const y=h/2+(i-(lines.length-1)/2)*size*1.2;if(style?.backgroundColor){s.fillStyle=style.backgroundColor;const tw=s.measureText(line).width;s.fillRect(x-(s.textAlign==='center'?tw/2:s.textAlign==='right'?tw:0),y-size*.6,tw,size*1.2);}s.fillStyle=style?.color??'#fff';s.fillText(line,x,y);});
    }else if(source){const dims=source as unknown as {videoWidth?:number;videoHeight?:number;naturalWidth?:number;naturalHeight?:number;width?:number;height?:number};const sw=dims.videoWidth||dims.naturalWidth||dims.width||w,sh=dims.videoHeight||dims.naturalHeight||dims.height||h;const scale=clip.fit==='cover'?Math.max(w/sw,h/sh):Math.min(w/sw,h/sh);s.drawImage(source,(w-sw*scale)/2,(h-sh*scale)/2,sw*scale,sh*scale);}
    const effectValues=(clip.effects??[]).map(effect=>({...effect,params:{...effect.params,...Object.fromEntries(Object.keys(effect.params).filter(key=>typeof effect.params[key]==='number').map(key=>[key,evaluateComicCompositionProperty(clip,`effect:${effect.id}:${key}`,localFrame)])),__time:(localFrame+(clip.envelope?.offsetFrames??0))/fps}}));
    const treated=await this.effects(effectValues),p=this.planeContext;p.setTransform(1,0,0,1,0,0);p.globalAlpha=1;p.globalCompositeOperation='source-over';p.clearRect(0,0,w,h);p.drawImage(treated,0,0);
    const masks=(clip.masks??[]).filter(m=>m.enabled).map(m=>({...m,points:m.points?.map((p,i)=>({...p,...Object.fromEntries(['x','y','inX','inY','outX','outY'].map(key=>[key,evaluateComicCompositionProperty(clip,`mask:${m.id}:point.${i}.${key}`,localFrame)]))})),...Object.fromEntries(['x','y','width','height','rotation','feather','opacity'].filter(key=>m.shape!=='circle'||key!=='height').map(key=>[key,evaluateComicCompositionProperty(clip,`mask:${m.id}:${key}`,localFrame)]))}));
    for(const m of masks.filter(m=>m.scope==='clip')){p.globalCompositeOperation='destination-in';p.drawImage(this.mask(m),0,0);}p.globalCompositeOperation='source-over';
    const sample=evaluateComicCompositionClip(clip,localFrame),c=this.context;
    for(const m of masks.filter(m=>m.scope==='below')){
      // Inversion and strength mix in project space AFTER the owner's transform.
      // Otherwise scaling an identity mask would incorrectly erase lower pixels.
      s.setTransform(1,0,0,1,0,0);s.globalCompositeOperation='source-over';s.globalAlpha=1;s.clearRect(0,0,w,h);s.save();s.translate(w/2+sample.x,h/2+sample.y);s.rotate(sample.rotation*Math.PI/180);s.scale(sample.scale,sample.scale);s.drawImage(this.mask({...m,invert:false,opacity:1}),-w/2,-h/2);s.restore();
      const b=this.below.getContext('2d')!,amount=m.opacity*sample.opacity;b.globalCompositeOperation='source-over';b.globalAlpha=1;b.clearRect(0,0,w,h);b.fillStyle='#fff';b.fillRect(0,0,w,h);
      if(m.invert){b.globalCompositeOperation='destination-out';b.globalAlpha=amount;b.drawImage(this.source,0,0);}else{b.globalCompositeOperation='destination-in';b.drawImage(this.source,0,0);if(amount<1){b.globalCompositeOperation='source-over';b.globalAlpha=1-amount;b.fillRect(0,0,w,h);}}
      c.globalCompositeOperation='destination-in';c.drawImage(this.below,0,0);c.globalCompositeOperation='destination-over';c.fillStyle='#000';c.fillRect(0,0,w,h);c.globalCompositeOperation='source-over';
    }
    c.save();c.translate(w/2+sample.x,h/2+sample.y);c.rotate(sample.rotation*Math.PI/180);c.scale(sample.scale,sample.scale);c.globalCompositeOperation='source-over';c.globalAlpha=sample.opacity;c.filter=sample.brightness===undefined?'none':`brightness(${sample.brightness})`;c.drawImage(this.plane,-w/2,-h/2);c.restore();c.filter='none';
  }
  hasFailed():boolean{return Boolean(this.failure);}
  failureReason():Error|undefined{return this.failure;}
  canvas():OffscreenCanvas{return this.output;}
  pixels():Uint8Array{return new Uint8Array(this.context.getImageData(0,0,this.width,this.height).data.buffer);}
  destroy():void{this.disposed=true;this.ping?.destroy();this.pong?.destroy();for(const b of this.uniforms.values())b.destroy();for(const t of this.textures.values())t.texture.destroy();this.device?.destroy();for(const canvas of this.maskCache.values())canvas.width=canvas.height=0;this.maskCache.clear();this.source.width=this.source.height=this.plane.width=this.plane.height=this.output.width=this.output.height=this.below.width=this.below.height=0;}
}
export { comicClipHasVisualProcessing };
