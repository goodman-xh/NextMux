import { GPU_EFFECT_REGISTRY, getGpuEffectDefaultParams } from './visual-effects/freecut/registry.js';
export { GPU_EFFECT_REGISTRY, getGpuEffectDefaultParams } from './visual-effects/freecut/registry.js';
export {readGpuCurvesChannelPoints,type GpuCurvesChannelKey} from './visual-effects/freecut/shared/gpu-curves.js';
export { parseCubeLut, resampleCubeLut, encodeLutData } from './visual-effects/freecut/lut/cube-lut.js';
export type { EffectParam, GpuEffectDefinition, GpuEffectInstance } from './visual-effects/freecut/types.js';
export interface ComicVisualEffect { readonly id: string; readonly type: string; readonly enabled: boolean; readonly params: Readonly<Record<string, number | boolean | string>>; }
export interface ComicMaskPoint { readonly x: number; readonly y: number; readonly inX?: number; readonly inY?: number; readonly outX?: number; readonly outY?: number; }
/** Coordinates are fractions of the untransformed project picture; feather is in project pixels. */
export interface ComicVisualMask { readonly id: string; readonly shape: 'rectangle' | 'circle' | 'ellipse' | 'path'; readonly enabled: boolean; readonly invert: boolean; readonly scope: 'clip' | 'below'; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rotation: number; readonly feather: number; readonly opacity: number; readonly points?: readonly ComicMaskPoint[]; }
export type ComicVisualProperty = `effect:${string}:${string}` | `mask:${string}:${string}`;
const id = (value: unknown): string => { if(typeof value!=='string'||!/^[-\w]{1,160}$/.test(value))throw Error('Invalid visual item ID');return value; };
const record = (value: unknown): Record<string, unknown> => { if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid visual item');return value as Record<string,unknown>; };
const list = (value: unknown, limit: number): readonly unknown[] => { if(!Array.isArray(value)||value.length>limit)throw Error('Visual item limit exceeded');return value; };
const numeric = (value: unknown, min: number, max: number): number => { if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error('Visual parameter outside its range');return value; };
export const comicMaskRanges = {x:[-4,4],y:[-4,4],width:[.001,8],height:[.001,8],rotation:[-36000,36000],feather:[0,512],opacity:[0,1]} as const;
export function validateComicVisualEffects(value: unknown): readonly ComicVisualEffect[] {
  const result=list(value,32).map(raw=>{
    const item=record(raw),definition=GPU_EFFECT_REGISTRY.get(String(item.type));if(!definition)throw Error('Unsupported visual effect');
    if(typeof item.enabled!=='boolean')throw Error('Invalid effect enabled state');
    const source=record(item.params),params=getGpuEffectDefaultParams(definition.id);
    for(const [key,param]of Object.entries(definition.params))if(source[key]!==undefined){
      const v=source[key];
      if(param.type==='number')params[key]=numeric(v,param.min??-100000,param.max??100000);
      else if(param.type==='boolean'){if(typeof v!=='boolean')throw Error('Invalid effect boolean');params[key]=v;}
      else {if(typeof v!=='string'||v.includes('\0')||v.length>(key==='lutData'?200000:8192))throw Error('Invalid effect text');
        if(param.type==='select'&&!param.options?.some(option=>option.value===v))throw Error('Invalid effect option');
        if(param.type==='color'&&!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(v))throw Error('Invalid effect color');params[key]=v;}
    }
    if(definition.id==='gpu-lut'&&params.lutData){const size=Number(params.lutSize);if(!Number.isInteger(size)||size<2||size>33||!/^[-A-Za-z0-9+/=]+$/.test(String(params.lutData))||atob(String(params.lutData)).length!==size**3*4)throw Error('Invalid embedded LUT');}
    if(definition.id==='gpu-gradient-map'){const stops=String(params.customStops).split(',').map(s=>s.trim());if(stops.length<2||stops.length>64||stops.some(s=>!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(s)))throw Error('Invalid gradient colors');}
    if(definition.id==='gpu-curves')for(const key of ['masterPoints','redPoints','greenPoints','bluePoints'])if(params[key]){
      const points=JSON.parse(String(params[key]));if(!Array.isArray(points)||points.length<2||points.length>16)throw Error('Invalid curve points');
      let previous=-1;for(const pair of points){if(!Array.isArray(pair)||pair.length!==2)throw Error('Invalid curve point');const x=numeric(pair[0],0,1);numeric(pair[1],0,1);if(x<=previous)throw Error('Curve points must increase');previous=x;}
    }
    return {id:id(item.id),type:definition.id,enabled:item.enabled,params};
  });
  if(new Set(result.map(item=>item.id)).size!==result.length)throw Error('Duplicate effect IDs');return result;
}
export function validateComicVisualMasks(value: unknown): readonly ComicVisualMask[] {
  const result=list(value,16).map(raw=>{
    const m=record(raw);if(!['rectangle','circle','ellipse','path'].includes(String(m.shape))||!['clip','below'].includes(String(m.scope))||typeof m.enabled!=='boolean'||typeof m.invert!=='boolean')throw Error('Invalid mask');
    const values={} as Record<keyof typeof comicMaskRanges,number>;for(const [key,range]of Object.entries(comicMaskRanges))values[key as keyof typeof values]=numeric(m[key],range[0],range[1]);
    const points=m.points===undefined?undefined:list(m.points,128).map(raw=>{const p=record(raw);return {x:numeric(p.x,-4,4),y:numeric(p.y,-4,4),...Object.fromEntries(['inX','inY','outX','outY'].filter(key=>p[key]!==undefined).map(key=>[key,numeric(p[key],-4,4)]))};});
    if(m.shape==='path'&&(!points||points.length<3))throw Error('A path mask needs at least three points');
    return {id:id(m.id),shape:m.shape as ComicVisualMask['shape'],scope:m.scope as ComicVisualMask['scope'],enabled:m.enabled,invert:m.invert,...values,...(points?{points}:{})};
  });if(new Set(result.map(item=>item.id)).size!==result.length)throw Error('Duplicate mask IDs');return result;
}
export function comicVisualPropertyRange(clip:{readonly effects?:readonly ComicVisualEffect[];readonly masks?:readonly ComicVisualMask[]},property:string):readonly [number,number]|undefined {
  const [kind,id,key,...rest]=property.split(':');if(rest.length)return undefined;
  if(kind==='effect'){const effect=clip.effects?.find(item=>item.id===id),param=effect&&GPU_EFFECT_REGISTRY.get(effect.type)?.params[key];return param?.type==='number'&&param.animatable===true?[param.min??-100000,param.max??100000]:undefined;}
  if(kind==='mask'){const mask=clip.masks?.find(item=>item.id===id);if(mask){const point=/^point\.(\d+)\.(x|y|inX|inY|outX|outY)$/.exec(key);if(point&&mask.points?.[Number(point[1])])return[-4,4];return mask.shape==='circle'&&key==='height'?undefined:comicMaskRanges[key as keyof typeof comicMaskRanges];}}return undefined;
}
export function comicVisualPropertyBase(clip:{readonly effects?:readonly ComicVisualEffect[];readonly masks?:readonly ComicVisualMask[]},property:string):number {
  const [kind,id,key]=property.split(':');if(kind==='mask'){const mask=clip.masks?.find(m=>m.id===id),point=/^point\.(\d+)\.(x|y|inX|inY|outX|outY)$/.exec(key);if(point&&mask?.points){const p=mask.points[Number(point[1])],k=point[2] as keyof ComicMaskPoint;return p?.[k]??p?.[k.endsWith('X')?'x':'y']??0;}}const value=kind==='effect'?clip.effects?.find(item=>item.id===id)?.params[key]:clip.masks?.find(item=>item.id===id)?.[key as keyof ComicVisualMask];return typeof value==='number'?value:0;
}
export function comicVisualProperties(clip:{readonly effects?:readonly ComicVisualEffect[];readonly masks?:readonly ComicVisualMask[]}):readonly ComicVisualProperty[]{
  return [...(clip.effects??[]).flatMap(effect=>Object.entries(GPU_EFFECT_REGISTRY.get(effect.type)?.params??{}).filter(([,p])=>p.type==='number'&&p.animatable===true).map(([key])=>`effect:${effect.id}:${key}` as ComicVisualProperty)),...(clip.masks??[]).flatMap(mask=>[...Object.keys(comicMaskRanges).filter(key=>mask.shape!=='circle'||key!=='height'),...(mask.points??[]).flatMap((_,i)=>['x','y','inX','inY','outX','outY'].map(k=>`point.${i}.${k}`))].map(key=>`mask:${mask.id}:${key}` as ComicVisualProperty))];
}
export function comicClipHasVisualProcessing(clip:{readonly effects?:readonly ComicVisualEffect[];readonly masks?:readonly ComicVisualMask[]}):boolean{return Boolean(clip.effects?.some(e=>e.enabled)||clip.masks?.some(m=>m.enabled));}

/** H.264 4:2:0 export uses even output pixels; preview processing uses the same canvas. */
export function comicVisualOutputSize(width:number,height:number):{width:number;height:number}{return {width:width-width%2,height:height-height%2};}
