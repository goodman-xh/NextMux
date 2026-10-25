import {ComicVisualRenderer} from './renderer.js';
import type {ComicCompositionClip} from '../composition.js';
let renderer:ComicVisualRenderer|undefined;
export async function comicVisualWorkerCommand(meta:{command:string;width?:number;height?:number;fps?:number;clip?:ComicCompositionClip;frame?:number;text?:string;effects?:ComicCompositionClip['effects']},bytes?:Uint8Array):Promise<Uint8Array>{
 if(meta.command==='init'){renderer?.destroy();renderer=new ComicVisualRenderer(meta.width!,meta.height!);await renderer.preflight(meta.effects??[]);return new Uint8Array();}
 if(!renderer)throw Error('Visual worker not initialized');
 if(meta.command==='begin'){renderer.begin();return new Uint8Array();}
 if(meta.command==='layer'){let source:ImageBitmap|undefined;try{if(bytes?.length){if(bytes.length!==meta.width!*meta.height!*4)throw Error('Invalid visual frame size');source=await createImageBitmap(new ImageData(new Uint8ClampedArray(bytes),meta.width!,meta.height!));}await renderer.add(meta.clip!,meta.frame!,meta.fps!,source,meta.text);return new Uint8Array();}finally{source?.close();}}
 if(meta.command==='end')return renderer.pixels();
 throw Error('Unknown visual worker command');
}
