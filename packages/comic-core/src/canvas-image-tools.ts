import type { CanvasAssetVersion, CanvasEdge, CanvasImageGenNode, CanvasPoint } from './canvas.js';
import type { CanvasModelCapability } from './canvas-capabilities.js';
import { IMAGE_TOOL_LOCALES, IMAGE_STYLE_PRESETS, IMAGE_LIGHTING_PRESETS, IMAGE_POSE_PRESETS,
  getImageStylePreset, getImageLightingPreset, getImagePosePreset } from './canvas-image-presets.js';
import type { ImageToolLocale, ImageToolLocalizedText, ImagePaletteColor } from './canvas-image-presets.js';
import { IMAGE_TOOL_TEXT as text, IMAGE_VARIATION_TAGS, imageToolText } from './canvas-image-tool-text.js';
import { resolveCanvasImageToolRoute } from './canvas-image-tool-routes.js';

export { IMAGE_VARIATION_TAGS } from './canvas-image-tool-text.js';
export const DEFAULT_IMAGE_VARIATION_TAGS = Object.freeze(['close_shot', 'medium_shot', 'wide_shot', 'deep_focus', 'shallow_focus', 'extreme_close_up', 'close_up'] as const);
export type ImageVariationTag = typeof IMAGE_VARIATION_TAGS[number]['id'];
interface Instructions { readonly instruction: string }
interface Variations extends Instructions { readonly tags: readonly ImageVariationTag[]; readonly count: number }
export interface CanvasImageToolParameters {
  'image.relight': Instructions & { readonly presetId: string; readonly overrideMainLight: boolean; readonly direction: number; readonly height: number; readonly intensity: number; readonly colourTemperature: number; readonly softness: 'soft' | 'hard' };
  'image.angle': Instructions & { readonly yaw: number; readonly pitch: number; readonly distance: number };
  'image.pose': Instructions & { readonly presetId: string; readonly usePoseGuide: boolean };
  'image.imagine': Variations;
  'image.angleVariants': Variations;
  'image.gridStoryboard': { readonly story: string; readonly gridRows: number; readonly gridColumns: number; readonly style: string };
  'image.styleTransfer': Instructions & { readonly presetId: string };
  'image.palette': Instructions & { readonly colors: readonly ImagePaletteColor[]; readonly scope: 'all' | 'subject' | 'background' };
  'image.camera': Instructions & { readonly enabled: boolean; readonly body: string; readonly lens: string; readonly focalLength: number; readonly aperture: number };
  'image.outpaint': Instructions & { readonly targetAspect: string; readonly placement: 'center' | 'left' | 'right' | 'top' | 'bottom' };
  'image.panorama': Instructions;
  'image.annotatedEdit': Instructions;
  'image.upscale': Instructions;
  'image.depthIllustration': Instructions & { readonly invert: boolean };
}
export type CanvasImageToolId = keyof CanvasImageToolParameters;
export interface CanvasImageToolParameterOption { readonly value: string; readonly labels: ImageToolLocalizedText }
export interface CanvasImageToolParameterSchema {
  readonly key: string;
  readonly type: 'number' | 'string' | 'boolean' | 'select' | 'multiSelect' | 'palette';
  readonly labels: ImageToolLocalizedText;
  readonly hints: ImageToolLocalizedText;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly maxLength?: number;
  readonly multiline?: boolean;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly options?: readonly CanvasImageToolParameterOption[];
  readonly visibleWhen?: { readonly key: 'enabled' | 'overrideMainLight'; readonly equals: true };
}
export interface CanvasImageToolReference {
  readonly source: 'source' | 'marks' | 'poseGuide';
  readonly role: 'referenceImage';
  readonly purpose: 'identity' | 'annotation' | 'pose';
  readonly order: number;
}
export interface CanvasImageToolVariant {
  readonly prompt: string;
  readonly mode: 'imageToImage';
  /** Only generation transport fields belong here; tool UI parameters stay in the prompt. */
  readonly parametersPatch: Readonly<Record<string, unknown>>;
  readonly references: readonly CanvasImageToolReference[];
  readonly output: 'image' | 'panorama-image' | 'depth-illustration';
  readonly resolutionPolicy?: 'highest';
  readonly tagId?: ImageVariationTag;
}
export interface CompiledCanvasImageTool extends CanvasImageToolVariant {
  readonly toolId: CanvasImageToolId;
  readonly label: string;
  /** One imageGen node per entry, one provider request per node. No montage/count parameter. */
  readonly variants?: readonly CanvasImageToolVariant[];
}
export interface CanvasImageToolDefinition<K extends CanvasImageToolId = CanvasImageToolId> {
  readonly id: K;
  readonly kind: 'ai';
  readonly labels: ImageToolLocalizedText;
  readonly hints: ImageToolLocalizedText;
  readonly parameters: readonly CanvasImageToolParameterSchema[];
  readonly defaults: CanvasImageToolParameters[K];
  compile(params?: Partial<CanvasImageToolParameters[K]>, locale?: ImageToolLocale): CompiledCanvasImageTool;
}
export class CanvasImageToolError extends Error {
  constructor(readonly code: 'IMAGE_TOOL_UNKNOWN' | 'IMAGE_TOOL_PARAMETERS_INVALID' | 'IMAGE_TOOL_REFERENCE_REQUIRED' | 'IMAGE_TOOL_ROUTE_UNAVAILABLE', readonly path: string, message: string) {
    super(message); this.name = 'CanvasImageToolError';
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function invalid(path: string): never { throw new CanvasImageToolError('IMAGE_TOOL_PARAMETERS_INVALID', path, `Invalid image tool parameter: ${path}.`); }
function checkLocale(locale: ImageToolLocale): void { if (!(IMAGE_TOOL_LOCALES as readonly string[]).includes(locale)) invalid('locale'); }
const SOURCE = freeze([{ source: 'source', role: 'referenceImage', purpose: 'identity', order: 0 }] as const);
const PRESERVE = 'Preserve the subject identity, clothing, object count, scene continuity and spatial relationships. Do not add captions, borders or watermarks.';
const options = (presets: readonly { id: string; names: ImageToolLocalizedText }[]): readonly CanvasImageToolParameterOption[] => presets.map(preset => ({ value: preset.id, labels: preset.names }));
const field = (key: string, type: CanvasImageToolParameterSchema['type'], label: keyof typeof text, extra: Partial<CanvasImageToolParameterSchema> = {}): CanvasImageToolParameterSchema => ({ key, type, labels: text[label], hints: text.promptHint, ...extra });
const instruction = field('instruction', 'string', 'instruction', { maxLength: 6000, multiline: true });
const preset = (presets: readonly { id: string; names: ImageToolLocalizedText }[]) => field('presetId', 'select', 'preset', { options: options(presets) });
const choices = (...values: readonly (keyof typeof text)[]) => values.map(value => ({ value, labels: text[value] }));
const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2', '21:9', '9:21'];
const aspectOptions = ASPECTS.map(value => ({ value, labels: imageToolText(value,value,value,value,value,value,value,value,value,value,value,value) }));
const variationFields = [field('tags', 'multiSelect', 'tags', { options: options(IMAGE_VARIATION_TAGS), minItems: 1, maxItems: 11 }), field('count', 'number', 'count', { min: 1, max: 64, step: 1 }), instruction];

/** Runtime validation is deliberately strict: restored values cannot bypass the displayed schema. */
function normalize<K extends CanvasImageToolId>(definition: CanvasImageToolDefinition<K>, raw: Partial<CanvasImageToolParameters[K]> | undefined): CanvasImageToolParameters[K] {
  if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) invalid('params');
  const params: Record<string, unknown> = { ...(structuredClone(definition.defaults) as unknown as Record<string,unknown>), ...(structuredClone(raw ?? {}) as Record<string,unknown>) };
  for (const key of Object.keys(params)) if (!definition.parameters.some(schema => schema.key === key)) invalid(key);
  for (const schema of definition.parameters) {
    const value = params[schema.key];
    if (schema.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || schema.min !== undefined && value < schema.min || schema.max !== undefined && value > schema.max
        || schema.step !== undefined && Math.abs((value - (schema.min ?? 0)) / schema.step - Math.round((value - (schema.min ?? 0)) / schema.step)) > 1e-8) invalid(schema.key);
    } else if (schema.type === 'boolean') { if (typeof value !== 'boolean') invalid(schema.key); }
    else if (schema.type === 'string') {
      if (typeof value !== 'string' || value.length > (schema.maxLength ?? 6000) || value.includes('\0')) invalid(schema.key);
      params[schema.key] = value.trim();
    } else if (schema.type === 'select') { if (typeof value !== 'string' || !schema.options?.some(option => option.value === value)) invalid(schema.key); }
    else if (schema.type === 'multiSelect') {
      if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 64) || new Set(value).size !== value.length
        || value.some(item => !schema.options?.some(option => option.value === item))) invalid(schema.key);
    } else if (schema.type === 'palette') {
      if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid(schema.key);
      const colors = value as ImagePaletteColor[];
      if (colors.some(color => !color || typeof color !== 'object' || Object.keys(color).some(key => !['hex','weight'].includes(key))
        || typeof color.hex !== 'string' || !/^#[0-9a-f]{6}$/iu.test(color.hex) || typeof color.weight !== 'number' || !Number.isFinite(color.weight) || color.weight <= 0)) invalid(schema.key);
      const total = colors.reduce((sum, color) => sum + color.weight, 0);
      if (!Number.isFinite(total)) invalid(schema.key);
      params[schema.key] = colors.map(color => ({ hex: color.hex.toUpperCase(), weight: color.weight / total * 100 }));
    }
  }
  return freeze(params) as unknown as CanvasImageToolParameters[K];
}
function variant(prompt: string, parametersPatch: Readonly<Record<string, unknown>> = {}, references: readonly CanvasImageToolReference[] = SOURCE,
  output: CanvasImageToolVariant['output'] = 'image'): CanvasImageToolVariant {
  return { prompt, mode: 'imageToImage', parametersPatch, references, output };
}
function withInstruction(prompt: string, params: Instructions): string { return [prompt, params.instruction].filter(Boolean).join('\n\n'); }
function define<K extends CanvasImageToolId>(id: K, label: keyof typeof text, defaults: CanvasImageToolParameters[K], parameters: readonly CanvasImageToolParameterSchema[],
  compiler: (params: CanvasImageToolParameters[K]) => CanvasImageToolVariant & { variants?: readonly CanvasImageToolVariant[] }, hint: keyof typeof text = 'editHint'): CanvasImageToolDefinition<K> {
  const definition: CanvasImageToolDefinition<K> = {
    id, kind: 'ai', labels: text[label], hints: text[hint], defaults, parameters,
    compile(raw, locale = 'en') {
      checkLocale(locale);
      const params = normalize(definition, raw);
      const compiled = compiler(params);
      if (!compiled.prompt.trim()) invalid('prompt');
      return freeze({ ...compiled, toolId: id, label: text[label][locale] });
    },
  };
  return freeze(definition);
}
function compileVariations(params: Variations, angle: boolean): CanvasImageToolVariant & { variants: readonly CanvasImageToolVariant[] } {
  const variants = Array.from({ length: params.count }, (_, index) => {
    const tag = IMAGE_VARIATION_TAGS.find(item => item.id === params.tags[index % params.tags.length])!;
    const prompt = angle
      ? `Use the reference as the same subject and scene, and create a coherent view variation: ${tag.promptFragment}. Change the camera view while keeping the subject's pose and the scene layout consistent.`
      : `Use the reference to imagine a new shot: ${tag.promptFragment}. Keep the existing story, character and environment. Compose around the primary subject.`;
    const repeat = Math.floor(index / params.tags.length);
    return { ...variant(withInstruction(`${prompt}\n${PRESERVE}\nProduce exactly one complete image for variation ${index + 1} of ${params.count}; no collage or contact sheet.${repeat ? ` Explore a distinct composition for this tag, variation ${repeat + 1}.` : ''}`, params)), tagId: tag.id };
  });
  return { ...variants[0], variants };
}

export const CANVAS_IMAGE_TOOLS = freeze({
  'image.relight': define('image.relight', 'relight', { presetId: 'three_point', overrideMainLight: false, direction: 30, height: 30, intensity: 5, colourTemperature: 5600, softness: 'soft', instruction: '' },
    [preset(IMAGE_LIGHTING_PRESETS), field('overrideMainLight','boolean','manualLight'),field('direction','number','direction',{min:-180,max:180,step:1,visibleWhen:{key:'overrideMainLight',equals:true}}), field('height','number','height',{min:-90,max:90,step:1,visibleWhen:{key:'overrideMainLight',equals:true}}), field('intensity','number','intensity',{min:0,max:10,step:0.1,visibleWhen:{key:'overrideMainLight',equals:true}}), field('colourTemperature','number','temperature',{min:1000,max:20000,step:100,visibleWhen:{key:'overrideMainLight',equals:true}}), field('softness','select','softness',{options:choices('soft','hard'),visibleWhen:{key:'overrideMainLight',equals:true}}), instruction],
    params => variant(withInstruction(`Relight the reference image. Lighting layout: ${getImageLightingPreset(params.presetId).promptFragment}\n${params.overrideMainLight ? `Override the main light: azimuth ${params.direction} degrees, elevation ${params.height} degrees, intensity ${params.intensity}/10 (${params.intensity === 0 ? 'main light switched off' : 'relative artistic strength'}), colour temperature ${params.colourTemperature} K, ${params.softness} light.` : 'Use the complete preset lighting layout without a manual main-light override.'} Coordinate directions are relative to the subject as seen in the reference. Keep shadows, reflections, skin and material responses coherent. Keep the original actions and expressions; do not add visible lamps.\n${PRESERVE}`,params))),
  'image.angle': define('image.angle','angle',{yaw:0,pitch:0,distance:5,instruction:''},
    [field('yaw','number','yaw',{min:-180,max:180,step:1}),field('pitch','number','pitch',{min:-90,max:90,step:1}),field('distance','number','distance',{min:0.1,max:100,step:0.1}),instruction],
    params => variant(withInstruction(`Change the reference camera to yaw ${params.yaw} degrees, pitch ${params.pitch} degrees and distance ${params.distance} metres from the subject. Zero yaw and pitch mean the original viewing direction; positive yaw moves right and positive pitch raises the camera. Smaller distance means closer framing; larger distance means wider framing. Keep perspective and occlusion plausible, minimally complete unseen regions, and preserve the original pose.\n${PRESERVE}`,params))),
  'image.pose': define('image.pose','pose',{presetId:'standing',usePoseGuide:false,instruction:''},[preset(IMAGE_POSE_PRESETS),field('usePoseGuide','boolean','poseGuide'),instruction],
    params => variant(withInstruction(`Use image 1 to preserve the character identity. Pose: ${getImagePosePreset(params.presetId).promptFragment} ${params.usePoseGuide ? 'Use image 2 as the pose guide; its joint positions and limb directions take precedence over the preset.' : ''}\nKeep anatomy, limb count, balance and ground contact believable, with clothing responding to the new posture. Do not render skeletons, guides or handles.\n${PRESERVE}`,params),{},params.usePoseGuide ? [...SOURCE,{source:'poseGuide',role:'referenceImage',purpose:'pose',order:1}] : SOURCE)),
  'image.imagine': define('image.imagine','imagine',{tags:DEFAULT_IMAGE_VARIATION_TAGS,count:7,instruction:''},variationFields,params=>compileVariations(params,false),'batchHint'),
  'image.angleVariants': define('image.angleVariants','angleVariants',{tags:DEFAULT_IMAGE_VARIATION_TAGS,count:7,instruction:''},variationFields,params=>compileVariations(params,true),'batchHint'),
  'image.gridStoryboard': define('image.gridStoryboard','gridStoryboard',{story:'',gridRows:2,gridColumns:2,style:''},
    // These are editor bounds, not provider parameters or claims about the model's layout accuracy.
    [field('story','string','story',{maxLength:6000,multiline:true}),field('gridRows','number','gridRows',{min:1,max:8,step:1}),field('gridColumns','number','gridColumns',{min:1,max:8,step:1}),field('style','string','visualStyle',{maxLength:1000})],
    params => {
      if (!params.story) invalid('story');
      return variant(`Create exactly one storyboard grid image with ${params.gridRows} rows and ${params.gridColumns} columns (${params.gridRows * params.gridColumns} panels). Tell this story:\n${params.story}\n\nUse the reference image to preserve the characters and setting. Keep character identity, clothing, recurring props and environment consistent across panels. Show one clear shot per panel, progressing the action in reading order from left to right, then top to bottom. Make the panel boundaries clear and divide the image into equal-sized cells. Do not add panel numbers or explanatory text unless the story explicitly requests them. Do not add watermarks.\nVisual style: ${params.style || 'preserve the visual style of the reference image'}.`);
    },'gridStoryboardHint'),
  'image.styleTransfer': define('image.styleTransfer','styleTransfer',{presetId:'anime_90s_retro',instruction:''},[preset(IMAGE_STYLE_PRESETS),instruction],
    params => {
      const style = getImageStylePreset(params.presetId);
      const scope = style.parameters ? 'Apply only the colour grade, tone and illumination treatment. Preserve the original rendering medium, line work, geometry and material identity.'
        : 'Change only the rendering, line work, materials, colour and lighting language.';
      return variant(withInstruction(`Convert the reference image to this visual treatment:\n${style.promptFragment}\nOriginal visual configuration (these are model instructions, not executed pixel filters):\n${JSON.stringify(style.configuration)}\nPreserve the principal action, composition and spatial relationships. ${scope} Do not replace characters, remove key objects or rearrange the story.\n${PRESERVE}`,params));
    }),
  'image.palette': define('image.palette','palette',{colors:[{hex:'#263A59',weight:60},{hex:'#D2AC7A',weight:30},{hex:'#F3EEE3',weight:10}],scope:'all',instruction:''},
    [field('colors','palette','colors',{minItems:1,maxItems:8}),field('scope','select','scope',{options:choices('all','subject','background')}),instruction],
    params => variant(withInstruction(`Adjust the reference colour relationships using this palette: ${params.colors.map(color=>`${color.hex} (${Number(color.weight.toFixed(4))}%)`).join(', ')}. Application scope: ${params.scope === 'all' ? 'whole image' : params.scope}. Treat percentages as the desired visual colour balance. Keep tonal hierarchy, readable skin, material differences and subject recognition. Integrate colour changes with existing illumination; do not add objects to represent colours.\n${PRESERVE}`,params))),
  'image.camera': define('image.camera','camera',{enabled:true,body:'',lens:'',focalLength:35,aperture:2.8,instruction:''},
    [field('enabled','boolean','enabled'),field('body','string','body',{maxLength:160,visibleWhen:{key:'enabled',equals:true}}),field('lens','string','lens',{maxLength:160,visibleWhen:{key:'enabled',equals:true}}),field('focalLength','number','focalLength',{min:8,max:1200,step:1,visibleWhen:{key:'enabled',equals:true}}),field('aperture','number','aperture',{min:0.7,max:64,step:0.1,visibleWhen:{key:'enabled',equals:true}}),instruction],
    params => variant(withInstruction(`${params.enabled ? `Simulate the photographic look of ${params.body || 'a full-frame digital camera'} with ${params.lens || 'a general-purpose photographic lens'}, focal length ${params.focalLength} mm and aperture f/${params.aperture}. Keep perspective, subject distance, focus and background blur mutually plausible. Equipment names describe visual intent; do not insert a camera or brand text into the picture.` : 'Edit the reference without applying the stored camera look settings.'}\n${PRESERVE}`,params))),
  'image.outpaint': define('image.outpaint','outpaint',{targetAspect:'16:9',placement:'center',instruction:''},
    [field('targetAspect','select','aspect',{options:aspectOptions}),field('placement','select','placement',{options:choices('center','left','right','top','bottom')}),instruction],
    params => variant(withInstruction(`Place the original image at the ${params.placement} of a target ${params.targetAspect} canvas. Extend only the newly exposed regions. Preserve the original content and subject scale; naturally continue background geometry, textures, light and perspective across the borders. Do not repaint or crop the original subject; do not duplicate people or limbs.\n${PRESERVE}`,params),{aspectRatio:params.targetAspect})),
  'image.panorama': define('image.panorama','panorama',{instruction:''},[instruction],
    params => variant(withInstruction(`Expand the reference into one 360-degree equirectangular panorama with a 2:1 aspect ratio. Continue the existing scene around the viewer; align the left/right seam and keep the horizon and perspective coherent. This is a generated panoramic image, with no measured 3D geometry.\n${PRESERVE}`,params),{aspectRatio:'2:1'},SOURCE,'panorama-image')),
  'image.annotatedEdit': define('image.annotatedEdit','annotatedEdit',{instruction:''},[instruction],params => {
    if (!params.instruction) invalid('instruction');
    // The clean original is the picture to edit; the marked copy only locates the edits, so its marks cannot leak into the result.
    return variant(`Edit the first reference image, which is the original picture. The second reference image is the same picture with the user's editing marks (strokes, boxes, arrows and numbered badges) drawn on it only to show where to edit; numbers in the instructions refer to the numbered badges. Region instructions: ${params.instruction}\nOutput the first image with only these changes. Never reproduce any mark, outline, box, arrow, badge or number from the second image. Keep unmarked content as unchanged as possible; blend light, perspective and texture naturally. Except where requested, retain character identity, composition and object count.`,{},
      [{source:'source',role:'referenceImage',purpose:'identity',order:0},{source:'marks',role:'referenceImage',purpose:'annotation',order:1}]);
  },'marksHint'),
  'image.upscale': define('image.upscale','upscale',{instruction:''},[instruction],params => ({...variant(withInstruction(`Upscale the reference to the selected route's highest supported output resolution while preserving its aspect ratio. Restore fine detail without changing composition, identity, colour or object count; avoid invented text and oversharpening.`,params)),resolutionPolicy:'highest'}),'upscaleHint'),
  'image.depthIllustration': define('image.depthIllustration','depthIllustration',{invert:false,instruction:''},[field('invert','boolean','invert'),instruction],
    params => variant(withInstruction(`Create an artistic RGB depth illustration of the reference: ${params.invert ? 'near objects dark and far objects bright' : 'near objects bright and far objects dark'}, with coherent ordinal depth and clear silhouettes. Preserve the composition. Produce one ordinary image; do not claim metric depth, a depth tensor, camera calibration or reconstruction accuracy.`,params),{},SOURCE,'depth-illustration'),'depthHint'),
});
export const CANVAS_IMAGE_TOOL_REGISTRY: readonly CanvasImageToolDefinition[] = Object.freeze(Object.values(CANVAS_IMAGE_TOOLS));
export function compileCanvasImageTool<K extends CanvasImageToolId>(id: K, params?: Partial<CanvasImageToolParameters[K]>, locale: ImageToolLocale = 'en'): CompiledCanvasImageTool {
  const definition = Object.hasOwn(CANVAS_IMAGE_TOOLS,id) ? CANVAS_IMAGE_TOOLS[id] as CanvasImageToolDefinition<K> : undefined;
  if (!definition) throw new CanvasImageToolError('IMAGE_TOOL_UNKNOWN','toolId','Unknown image tool.');
  return definition.compile(params,locale);
}

/** Preserve authored text until the UI obtains an explicit decision to replace it. */
export function changeImageVariationTags(params: Variations, tags: readonly ImageVariationTag[], replaceInstruction = false): { readonly confirmationRequired: boolean; readonly parameters: Variations } {
  const candidate = {...params,tags};
  normalize(CANVAS_IMAGE_TOOLS['image.imagine'],candidate);
  if (params.instruction.trim() && !replaceInstruction) return freeze({confirmationRequired:true,parameters:structuredClone(params)});
  return freeze({confirmationRequired:false,parameters:{...structuredClone(candidate),instruction:replaceInstruction ? '' : params.instruction}});
}

export interface CanvasImageToolNodeOptions {
  /** Stable per confirmed click; reusing it produces the same drafts without sending anything. */
  readonly batchId: string;
  readonly capability: CanvasModelCapability;
  readonly references: Readonly<Partial<Record<CanvasImageToolReference['source'],{ readonly nodeId?: string; readonly version: CanvasAssetVersion }>>>;
  readonly parameters?: Readonly<Record<string,unknown>>;
  readonly position?: CanvasPoint;
  readonly locale?: ImageToolLocale;
}
export interface CanvasImageToolNodePlan {
  readonly nodes: readonly CanvasImageGenNode[];
  readonly edges: readonly CanvasEdge[];
  readonly output: CanvasImageToolVariant['output'];
  readonly capabilityVersion: string;
}
/** Drafts only. Caller saves through canvas commands and runs the existing quote/confirm pipeline. */
export function prepareCanvasImageToolNodes(compiled: CompiledCanvasImageTool, options: CanvasImageToolNodeOptions): CanvasImageToolNodePlan {
  if (!/^[a-zA-Z0-9_-]{1,160}$/u.test(options.batchId)) invalid('batchId');
  const locale = options.locale ?? 'en'; checkLocale(locale);
  const variants = compiled.variants ?? [compiled];
  const nodes: CanvasImageGenNode[] = [], edges: CanvasEdge[] = [];
  for (const [index,item] of variants.entries()) {
    const references = item.references.map(reference => {
      const input = options.references[reference.source];
      if (!input?.version.id || !input.version.assetId || !input.version.uri || input.version.kind !== 'image' || input.version.status === 'uploading' || input.version.status === 'missing')
        throw new CanvasImageToolError('IMAGE_TOOL_REFERENCE_REQUIRED',reference.source,'A ready image reference is required.');
      return {reference,input};
    });
    const source = references[0]?.input.version;
    const route = resolveCanvasImageToolRoute({capability:options.capability,parameters:{...options.parameters,...item.parametersPatch},
      inputs:references.map(({reference,input})=>({role:reference.role,kind:'image',versionId:input.version.id,metadata:input.version.metadata})),
      sourceDimensions:source?.metadata?.width && source.metadata.height ? {width:source.metadata.width,height:source.metadata.height} : undefined,
      highestResolution:item.resolutionPolicy === 'highest',preserveSourceAspect:item.resolutionPolicy === 'highest',requireEnlargement:item.resolutionPolicy === 'highest'});
    if (!route.available) throw new CanvasImageToolError('IMAGE_TOOL_ROUTE_UNAVAILABLE','route',route.missingCapabilities.join('; '));
    const id = `image-tool-${options.batchId}-${index+1}`;
    const title = `${CANVAS_IMAGE_TOOLS[compiled.toolId].labels[locale]}${variants.length > 1 ? ` ${index+1}/${variants.length}` : ''}`;
    nodes.push({id,title,kind:'imageGen',position:{x:(options.position?.x ?? 0)+(index%4)*360,y:(options.position?.y ?? 0)+Math.floor(index/4)*280},size:{width:320,height:240},
      payload:{mode:'imageToImage',modelId:options.capability.providerModelId,prompt:item.prompt,parameters:route.parametersPatch,versions:[],
        inputs:references.filter(({input})=>!input.nodeId).map(({reference,input})=>({id:`${id}-input-${reference.order}`,role:reference.role,order:reference.order,version:structuredClone(input.version)}))}});
    for (const {reference,input} of references) if (input.nodeId) edges.push({id:`${id}-ref-${reference.order}`,sourceNodeId:input.nodeId,sourcePort:'output',targetNodeId:id,targetPort:'referenceImage',role:'referenceImage',order:reference.order,binding:'pinnedVersion',pinnedVersionId:input.version.id});
  }
  return freeze({nodes,edges,output:compiled.output,capabilityVersion:options.capability.version});
}
