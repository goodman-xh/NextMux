import { normalizeCanvasCharacterProfile } from './canvas-character-profile.js';
export { normalizeCanvasCharacterProfile } from './canvas-character-profile.js';
import { CanvasError, resolveCanvasInputs } from './canvas.js';
import type { CanvasAssetVersion, CanvasDocument, CanvasGenerationMode, ResolvedCanvasInput } from './canvas.js';
import { sameCanvasCapabilityVersion, canvasReferenceCombination, validateCanvasGenerationParameters } from './canvas-capabilities.js';
import type { CanvasCapabilityIssue, CanvasModelCapability, CanvasReferenceRule } from './canvas-capabilities.js';
import { canvasVersionFromComicAsset } from './canvas-project.js';
import { parseComicProject, serializeComicProject, validateComicProject } from './codec.js';
import type { ComicCharacter, ComicProject, ComicShot } from './types.js';

/** References identify managed assets and exact versions, never request image numbers. */
export type CharacterReferenceView = 'front' | 'threeQuarter' | 'side' | 'back' | 'fullBody' | 'detail' | 'unspecified';
export interface CharacterAssetVersionRef {
  readonly assetId: string;
  readonly versionId: string;
  readonly view: CharacterReferenceView;
  readonly qualityStatus: 'approved' | 'draft' | 'rejected';
  readonly sha256?: string;
  readonly subjectCount?: number;
}
export interface CharacterOutfit {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly description: string;
  readonly refs: readonly CharacterAssetVersionRef[];
  readonly episodeNumbers?: readonly number[];
}
export interface CharacterProviderScope {
  readonly providerId: string;
  /** Non-secret account namespace; never an API key. */
  readonly accountNamespace: string;
  readonly apiEndpoint: string;
  readonly product: string;
  readonly modelFamily: string;
  readonly modelVersion: string;
  readonly region?: string;
}
export type CharacterBindingStatus = 'unverified' | 'active' | 'valid' | 'expired' | 'invalid' | 'stale' | 'inaccessible' | 'disabled';
export interface ProviderCharacterBinding {
  readonly id: string;
  readonly scope: CharacterProviderScope;
  readonly externalElementId: string;
  readonly capabilityVersion: string;
  readonly referenceVersion: number;
  readonly referenceAssetHashes: readonly string[];
  readonly status: CharacterBindingStatus;
  readonly validatedAt?: string;
  readonly validationMethod?: 'query' | 'controlledCall';
  readonly expiresAt?: string | null;
  /** Any additional compatible versions must have been individually verified. */
  readonly verifiedModelVersions?: readonly string[];
}
export interface ScopedVoiceBinding {
  readonly id: string;
  readonly voiceProfileId: string;
  readonly scope: CharacterProviderScope;
  readonly externalVoiceId: string;
  readonly status: CharacterBindingStatus;
  readonly validatedAt?: string;
  readonly validationMethod?: 'query' | 'controlledCall';
  readonly expiresAt?: string | null;
  readonly sampleRefs?: readonly { readonly assetId: string; readonly versionId: string }[];
}
export interface CharacterIdentityVersion {
  readonly canonicalVersion: number;
  readonly immutableTraits: string;
  readonly referenceViews: readonly CharacterAssetVersionRef[];
  readonly sourceIdentityVersion?: string;
}
/** Stored on the existing ComicCharacter record. There is no independent character store. */
export interface CanvasCharacterProfile extends CharacterIdentityVersion {
  readonly history?: readonly CharacterIdentityVersion[];
  readonly outfits: readonly CharacterOutfit[];
  readonly voiceBindings: readonly ScopedVoiceBinding[];
  readonly providerBindings: readonly ProviderCharacterBinding[];
}
export interface CanvasComicCharacter extends ComicCharacter { readonly canvasCharacter?: CanvasCharacterProfile }
export interface CanvasCharacterProject extends ComicProject { readonly characters: readonly CanvasComicCharacter[] }
export interface CharacterAsset extends CanvasCharacterProfile {
  /** Reuses the project's stable character UUID, including legacy prefixed UUIDs. */
  readonly characterId: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly voice: string;
}

export interface ShotCharacterSelection {
  readonly characterId: string;
  readonly canonicalVersion?: number;
  readonly outfitId?: string;
  readonly outfitVersion?: number;
  readonly preferredViews?: readonly CharacterReferenceView[];
  readonly lead?: boolean;
  readonly priority?: number;
  /** Frames require an explicit editor choice; identity selection never sets them. */
  readonly frame?: { readonly role: 'firstFrame' | 'lastFrame'; readonly referenceVersionId: string };
}
export interface CanvasCharacterShot {
  readonly id: string;
  readonly nodeId?: string;
  readonly shotSize?: ComicShot['shotSize'];
  readonly cameraAngle?: ComicShot['cameraAngle'];
  readonly episodeNumber?: number;
  readonly characterIds?: readonly string[];
  readonly characterSelections?: readonly ShotCharacterSelection[];
}
export interface CanvasCharacterCapability extends CanvasModelCapability {
  readonly requestScope?: CharacterProviderScope;
  /** Supplying a clock is useful when validating a saved request preview. No online timers are created. */
  readonly now?: string;
  readonly identity?: {
    readonly referenceImages?: boolean;
    readonly maxIdentityImages?: number;
    readonly subjectPolicy?: 'singleSubject' | 'multipleSubjects';
    readonly elementBinding?: boolean;
    /** Adapter evidence that the job/request transport actually serializes element inputs. */
    readonly elementsTransportVerified?: boolean;
    readonly elementModes?: readonly CanvasGenerationMode[];
    readonly maxElements?: number;
    readonly elementsCountAsImages?: boolean;
    readonly voiceSelection?: boolean;
    readonly identityAlongsideStartFrame?: boolean;
    readonly identityAlongsideFirstLastFrames?: boolean;
    /** Includes first/last frames, scene pictures, outfit pictures and identity pictures. */
    readonly allImagesTotal?: number;
    readonly frameRules?: { readonly firstFrame?: CanvasReferenceRule; readonly lastFrame?: CanvasReferenceRule };
  };
}
export interface CompiledCharacterInput extends ResolvedCanvasInput {
  readonly purpose?: 'identity' | 'outfit' | 'composition' | 'targetPose';
  readonly canonicalVersion?: number;
  readonly view?: CharacterReferenceView;
  readonly outfitId?: string;
  readonly outfitVersion?: number;
}
export interface FrozenShotCharacter {
  readonly characterId: string;
  readonly name: string;
  readonly canonicalVersion: number;
  readonly sourceIdentityVersion?: string;
  readonly immutableTraits: string;
  readonly lead: boolean;
  readonly outfit?: CharacterOutfit;
  readonly voice: string;
  readonly voiceBinding?: ScopedVoiceBinding;
  readonly providerBinding?: ProviderCharacterBinding;
  readonly referenceVersionIds: readonly string[];
}
export interface CharacterReferenceDrop {
  readonly characterId: string;
  readonly versionId?: string;
  readonly purpose: 'identity' | 'outfit';
  readonly reason: string;
  readonly required: boolean;
}
export interface CharacterCompilationIssue extends CanvasCapabilityIssue {
  readonly characterId?: string;
  readonly severity: 'error' | 'warning' | 'info';
}
export interface ShotCharacterCompilation {
  readonly nodeId?: string;
  readonly modelId: string;
  readonly capabilityVersion: string;
  readonly mode?: CanvasGenerationMode;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly characters: readonly FrozenShotCharacter[];
  readonly inputs: readonly CompiledCharacterInput[];
  readonly referenceMap: readonly { readonly imageIndex: number; readonly inputIndex: number; readonly versionId: string; readonly characterId?: string; readonly label: string; readonly purpose?: CompiledCharacterInput['purpose'] }[];
  readonly mappingText: string;
  readonly prompt: string;
  readonly droppedReferences: readonly CharacterReferenceDrop[];
  readonly issues: readonly CharacterCompilationIssue[];
  readonly canSubmit: boolean;
}

const VIEW_LABELS: Readonly<Record<CharacterReferenceView, string>> = { front: '正面', threeQuarter: '三分之二侧面', side: '侧面', back: '背面', fullBody: '全身', detail: '细节', unspecified: '身份参考' };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function versionValid(version: number): boolean { return Number.isSafeInteger(version) && version > 0; }

function profileRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function profileList(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

/** Restores validated character metadata after the existing comic codec normalizes standard fields. */
export function restoreCanvasCharacterProfiles(normalized: ComicProject, source: unknown): CanvasCharacterProject {
  const raw = profileRecord(source, 'project');
  if (raw.id !== normalized.id) throw new Error('Cannot restore character profiles from another project');
  const sources = new Map(profileList(raw.characters, 'project.characters').map(value => { const record = profileRecord(value, 'character'); return [record.id, record] as const; }));
  return { ...normalized, characters: normalized.characters.map(character => {
    const profile = sources.get(character.id)?.canvasCharacter;
    if (profile === undefined) return character;
    const canvasCharacter = normalizeCanvasCharacterProfile(profile);
    if (character.appearance !== canvasCharacter.immutableTraits) throw new Error('Character appearance changed without an identity version update');
    const profileAssetIds = [...new Set(canvasCharacter.referenceViews.map(ref => ref.assetId))].sort();
    if (!equal([...(character.referenceAssetIds ?? [])].sort(), profileAssetIds)) throw new Error('Character reference IDs do not match its current identity profile');
    if (character.identityVersion !== (canvasCharacter.sourceIdentityVersion ?? String(canvasCharacter.canonicalVersion))) throw new Error('Character identity version does not match its current profile');
    return { ...character, canvasCharacter };
  }) };
}
export function normalizeCanvasCharacterProject(value: unknown): CanvasCharacterProject {
  const raw = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  const parsed = parseComicProject(value);
  return parsed.migratedFrom === undefined ? restoreCanvasCharacterProfiles(parsed.project, raw) : parsed.project;
}
export function parseCanvasCharacterProject(json: string): CanvasCharacterProject { return normalizeCanvasCharacterProject(json); }
export function prepareCanvasCharacterProjectForSave(project: ComicProject): CanvasCharacterProject {
  return restoreCanvasCharacterProfiles(validateComicProject(project), project);
}
export function serializeCanvasCharacterProject(project: ComicProject): string {
  const prepared = prepareCanvasCharacterProjectForSave(project);
  // Keep the codec's standard validation and text-size limit after adding the preserved profiles.
  serializeComicProject(prepared);
  const serialized = `${JSON.stringify(prepared, null, 2)}\n`;
  parseComicProject(serialized);
  return serialized;
}

/** Legacy reference IDs remain usable, but their view is not guessed from filenames or list order. */
export function characterAssetFromProject(project: ComicProject, characterId: string): CharacterAsset {
  const character = project.characters.find(item => item.id === characterId) as CanvasComicCharacter | undefined;
  if (!character) throw new Error(`Character ${characterId} does not exist in this project`);
  const profile: CanvasCharacterProfile = character.canvasCharacter ? normalizeCanvasCharacterProfile(character.canvasCharacter) : {
    canonicalVersion: 1, immutableTraits: character.appearance, sourceIdentityVersion: character.identityVersion,
    referenceViews: (character.referenceAssetIds ?? []).map(assetId => ({ assetId, versionId: `version-${assetId}`, view: 'unspecified', qualityStatus: 'approved' })),
    outfits: [], voiceBindings: [], providerBindings: [],
  };
  return freeze(copy({ ...profile, characterId: character.id, name: character.name, aliases: character.aliases ?? [], voice: character.voice }));
}
export function listProjectCharacterAssets(project: ComicProject): readonly CharacterAsset[] {
  return freeze(project.characters.map(character => characterAssetFromProject(project, character.id)));
}

/** Immutable project update; saves metadata on its existing character and retains every prior identity version. */
export function setProjectCharacterProfile(project: ComicProject, characterId: string, profile: CanvasCharacterProfile, now = project.updatedAt): CanvasCharacterProject {
  profile = normalizeCanvasCharacterProfile(profile);
  const previous = characterAssetFromProject(project, characterId);
  if (!versionValid(profile.canonicalVersion) || !Number.isFinite(Date.parse(now))) throw new Error('Invalid character version or update timestamp');
  if (profile.canonicalVersion < previous.canonicalVersion) throw new Error('Character versions cannot move backwards');
  const identity = (value: CharacterIdentityVersion): CharacterIdentityVersion => ({ canonicalVersion: value.canonicalVersion, immutableTraits: value.immutableTraits, referenceViews: value.referenceViews, ...(value.sourceIdentityVersion ? { sourceIdentityVersion: value.sourceIdentityVersion } : {}) });
  const previousRecord = project.characters.find(item => item.id === characterId) as CanvasComicCharacter;
  if (previousRecord.canvasCharacter && profile.canonicalVersion === previous.canonicalVersion && !equal(identity(profile), identity(previous))) throw new Error('Changing identity traits or references requires a new canonicalVersion');
  const history = new Map((previous.history ?? []).map(item => [item.canonicalVersion, identity(item)]));
  if (profile.canonicalVersion > previous.canonicalVersion) history.set(previous.canonicalVersion, identity(previous));
  for (const historic of profile.history ?? []) {
    if (!versionValid(historic.canonicalVersion) || historic.canonicalVersion >= profile.canonicalVersion) throw new Error('Invalid historical identity version');
    const existing = history.get(historic.canonicalVersion);
    if (existing && !equal(existing, identity(historic))) throw new Error('Historical character identities are immutable');
    history.set(historic.canonicalVersion, identity(historic));
  }
  for (const outfit of profile.outfits) {
    if (!outfit.id || !versionValid(outfit.version)) throw new Error('Invalid outfit version');
    const prior = previous.outfits.find(item => item.id === outfit.id && item.version === outfit.version);
    if (prior && !equal(prior, outfit)) throw new Error('Changing an outfit requires a new outfit version');
  }
  const retainedOutfits = [...profile.outfits, ...previous.outfits.filter(prior => !profile.outfits.some(outfit => outfit.id === prior.id && outfit.version === prior.version))];
  const nextProfile = copy({ ...profile, outfits: retainedOutfits, history: [...history.values()].sort((a, b) => a.canonicalVersion - b.canonicalVersion) });
  const referenceAssetIds = [...new Set(profile.referenceViews.map(ref => ref.assetId))];
  return { ...project, revision: project.revision + 1, updatedAt: now,
    characters: project.characters.map(character => character.id !== characterId ? character : {
      ...character, appearance: profile.immutableTraits, referenceAssetIds,
      identityVersion: profile.sourceIdentityVersion ?? String(profile.canonicalVersion), canvasCharacter: nextProfile, updatedAt: now,
    }) };
}

function scopeMatches(binding: CharacterProviderScope, scope: CharacterProviderScope, versions?: readonly string[]): boolean {
  const fields = ['providerId', 'accountNamespace', 'apiEndpoint', 'product', 'modelFamily'] as const;
  return fields.every(field => !!scope[field] && binding[field] === scope[field]) && binding.region === scope.region && !!scope.modelVersion
    && (binding.modelVersion === scope.modelVersion || !!versions?.includes(scope.modelVersion));
}
function bindingVerified(binding: { readonly status: CharacterBindingStatus; readonly validatedAt?: string; readonly validationMethod?: string; readonly expiresAt?: string | null }, now: string): boolean {
  const time = Date.parse(now), validated = Date.parse(binding.validatedAt ?? '');
  return ['active', 'valid'].includes(binding.status) && ['query', 'controlledCall'].includes(binding.validationMethod ?? '')
    && Number.isFinite(time) && Number.isFinite(validated) && validated <= time
    && (binding.expiresAt === undefined || binding.expiresAt === null || Number.isFinite(Date.parse(binding.expiresAt)) && Date.parse(binding.expiresAt) > time);
}
/** The caller's exact scope and capability version must have been verified, including account and endpoint. */
export function selectVerifiedCharacterBinding(character: CharacterAsset, capability: CanvasCharacterCapability, mode: CanvasGenerationMode, now = capability.now ?? new Date().toISOString()): ProviderCharacterBinding | undefined {
  if (!capability.identity?.elementBinding || capability.identity.elementsTransportVerified !== true || !capability.identity.elementModes?.includes(mode) || !capability.requestScope || capability.requestScope.providerId !== capability.providerId) return undefined;
  const hashes = character.referenceViews.filter(ref => ref.qualityStatus === 'approved').map(ref => ref.sha256);
  if (!hashes.length || hashes.some(hash => !hash)) return undefined;
  return character.providerBindings.find(binding => binding.externalElementId.trim() && bindingVerified(binding, now)
    && scopeMatches(binding.scope, capability.requestScope!, binding.verifiedModelVersions)
    && sameCanvasCapabilityVersion(binding.capabilityVersion, capability.version) && binding.referenceVersion === character.canonicalVersion
    && equal([...new Set(binding.referenceAssetHashes)].sort(), [...new Set(hashes)].sort()));
}

function referenceProblems(version: CanvasAssetVersion, rule: CanvasReferenceRule | undefined): string[] {
  if (version.kind !== 'image' || !version.uri || version.status === 'missing' || version.status === 'uploading') return ['asset is not a ready image'];
  if (!rule?.supported) return ['image references are unsupported or unknown'];
  const result: string[] = [], metadata = version.metadata ?? {};
  for (const [field, minimum, maximum] of [['byteLength', undefined, rule.maxBytes], ['width', rule.minWidth, rule.maxWidth], ['height', rule.minHeight, rule.maxHeight]] as const) {
    const value = metadata[field];
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || field !== 'byteLength' && value === 0)) result.push(`invalid ${field}`);
    if (minimum === undefined && maximum === undefined) continue;
    if (value === undefined) result.push(`${field} has not been measured`);
    else if (minimum !== undefined && value < minimum || maximum !== undefined && value > maximum) result.push(`${field} exceeds the model limit`);
  }
  if (rule.formats?.length) {
    const normalize = (format: string) => ({ jpeg: 'jpg' }[format.toLowerCase()] ?? format.toLowerCase());
    const format = metadata.mimeType?.split('/')[1];
    if (!format) result.push('image format is unknown');
    else if (!rule.formats.some(allowed => normalize(allowed) === normalize(format))) result.push('image format is unsupported');
  }
  if (rule.aspectRatios?.length) {
    if (!metadata.width || !metadata.height) result.push('image aspect ratio is unknown');
    else if (!rule.aspectRatios.some(ratio => { const [width, height] = ratio.split(':').map(Number); return width > 0 && height > 0 && Math.abs(metadata.width! / metadata.height! - width / height) / (width / height) <= 0.02; })) result.push('image aspect ratio is unsupported');
  }
  return result;
}
function preferredViews(shot: CanvasCharacterShot, selection: ShotCharacterSelection): readonly CharacterReferenceView[] {
  if (selection.preferredViews?.length) return selection.preferredViews;
  if (shot.shotSize === 'wide' || shot.shotSize === 'extreme_wide') return ['fullBody', 'front', 'side', 'threeQuarter', 'unspecified', 'detail', 'back'];
  if (shot.cameraAngle === 'over_the_shoulder') return ['side', 'threeQuarter', 'front', 'fullBody', 'unspecified', 'back', 'detail'];
  return ['front', 'threeQuarter', 'side', 'detail', 'fullBody', 'unspecified', 'back'];
}
function allVersions(project: ComicProject, canvas: CanvasDocument): Map<string, CanvasAssetVersion[]> {
  const result = new Map<string, CanvasAssetVersion[]>();
  const add = (version: CanvasAssetVersion) => { const list = result.get(version.id) ?? []; if (!list.some(old => equal(old, version))) list.push(version); result.set(version.id, list); };
  project.assets.filter(asset => asset.kind !== 'subtitle').forEach(asset => add(canvasVersionFromComicAsset(asset)));
  for (const node of canvas.nodes) {
    if ('versions' in node.payload) node.payload.versions.forEach(add);
    if ('inputs' in node.payload) node.payload.inputs?.forEach(input => add(input.version));
  }
  return result;
}

/** Pure request preview/compiler. This function neither uploads resources nor submits a paid job. */
export function compileShotCharacterInputs(project: ComicProject, shot: CanvasCharacterShot, canvas: CanvasDocument, capability: CanvasCharacterCapability): ShotCharacterCompilation {
  const issues: CharacterCompilationIssue[] = [], droppedReferences: CharacterReferenceDrop[] = [];
  const addIssue = (code: string, message: string, characterId?: string, severity: CharacterCompilationIssue['severity'] = 'error', path = 'characters') => issues.push({ code, message, path, severity, ...(characterId ? { characterId } : {}) });
  let inputs: CompiledCharacterInput[] = [], characters: FrozenShotCharacter[] = [];
  const modelMatches = (modelId: string): boolean => modelId === capability.providerModelId || modelId === capability.id;
  const candidates = canvas.nodes.filter(node => !node.orphaned && (node.kind === 'imageGen' || node.kind === 'videoGen')
    && (shot.nodeId ? node.id === shot.nodeId : node.origin?.shotId === shot.id && modelMatches(node.payload.modelId)));
  const target = candidates.length === 1 ? candidates[0] : undefined;
  if (canvas.projectId !== project.id) addIssue('CHARACTER_PROJECT_MISMATCH', 'Canvas and character project must have the same project ID');
  if (!target || target.kind !== 'imageGen' && target.kind !== 'videoGen') {
    addIssue(candidates.length > 1 ? 'CHARACTER_TARGET_AMBIGUOUS' : 'CHARACTER_TARGET_MISSING', 'Choose one generation node for this shot');
    return freeze({ modelId: capability.providerModelId, capabilityVersion: capability.version, parameters: {}, characters, inputs, referenceMap: [], mappingText: '', prompt: '', droppedReferences, issues, canSubmit: false });
  }
  const mode = capability.modes.find(item => item.mode === target.payload.mode);
  if (!modelMatches(target.payload.modelId)) addIssue('CHARACTER_MODEL_MISMATCH', 'The preview capability must match the generation node model');
  let resolution: ReturnType<typeof resolveCanvasInputs>;
  try { resolution = resolveCanvasInputs(canvas, target.id); }
  catch (error) {
    if (!(error instanceof CanvasError)) throw error;
    issues.push(...error.issues.map(item => ({ ...item, severity: 'error' as const })));
    if (!error.issues.length) addIssue(error.code, error.message, undefined, 'error', 'canvas');
    const directInputs: CompiledCharacterInput[] = (target.payload.inputs ?? []).map(input => ({ role: input.role, order: input.order, inputId: input.id,
      versionId: input.version.id, assetId: input.version.assetId, kind: input.version.kind, uri: input.version.uri, ...(input.version.metadata ? { metadata: input.version.metadata } : {}) }));
    return freeze(copy({ nodeId: target.id, modelId: capability.providerModelId, capabilityVersion: capability.version, mode: target.payload.mode,
      parameters: target.payload.parameters, characters, inputs: directInputs, referenceMap: [], mappingText: '', prompt: target.payload.prompt, droppedReferences, issues, canSubmit: false }));
  }
  const connected = canvas.edges.filter(edge => edge.targetNodeId === target.id).map(edge => canvas.nodes.find(node => node.id === edge.sourceNodeId))
    .filter(node => node?.kind === 'character').map(node => (node as Extract<typeof node, { kind: 'character' }>).payload.characterId);
  const selections: readonly ShotCharacterSelection[] = shot.characterSelections ?? [...new Set(shot.characterIds ?? connected)].map(characterId => ({ characterId }));
  const selectedIds = new Set(selections.map(selection => selection.characterId));
  if (selectedIds.size !== selections.length) addIssue('CHARACTER_SELECTION_DUPLICATE', 'A character may occur only once in the shot selection');
  // Replace floating character-node identity inputs with the frozen chosen identity. Explicit frames stay intact.
  inputs = copy(resolution.inputs.filter(input => !(input.characterId && selectedIds.has(input.characterId) && (input.role === 'character' || input.role === 'referenceImage'))))
    .map(input => ({ ...input, ...(input.role === 'firstFrame' ? { purpose: 'composition' as const } : input.role === 'lastFrame' ? { purpose: 'targetPose' as const } : {}) }));
  const versions = allVersions(project, canvas);
  const episodeNumber = shot.episodeNumber ?? project.scenes.find(scene => scene.shots.some(item => item.id === shot.id))?.episodeNumber;
  const now = capability.now ?? new Date().toISOString();
  const rule = mode?.referenceRules?.image;
  const groups: { snapshot: FrozenShotCharacter; identities: CompiledCharacterInput[]; outfits: CompiledCharacterInput[]; explicitFrame: boolean }[] = [];
  const ranked = [...selections].sort((a, b) => Number(!!b.lead) - Number(!!a.lead) || (b.priority ?? 0) - (a.priority ?? 0));
  for (const selection of ranked) {
    let asset: CharacterAsset;
    try { asset = characterAssetFromProject(project, selection.characterId); }
    catch { addIssue('CHARACTER_MISSING', 'A selected character is absent from this project', selection.characterId); continue; }
    const identity = selection.canonicalVersion === undefined || selection.canonicalVersion === asset.canonicalVersion ? asset : asset.history?.find(item => item.canonicalVersion === selection.canonicalVersion);
    if (!identity) { addIssue('CHARACTER_VERSION_MISSING', `Character version ${selection.canonicalVersion} is unavailable`, asset.characterId); continue; }
    if (!versionValid(identity.canonicalVersion)) { addIssue('CHARACTER_VERSION_INVALID', 'Character identity version must be a positive integer', asset.characterId); continue; }
    const outfitMatches = asset.outfits.filter(item => selection.outfitId ? item.id === selection.outfitId && (selection.outfitVersion === undefined || item.version === selection.outfitVersion) : episodeNumber !== undefined && item.episodeNumbers?.includes(episodeNumber));
    const outfitIds = new Set(outfitMatches.map(item => item.id));
    if (outfitIds.size > 1) addIssue('CHARACTER_OUTFIT_AMBIGUOUS', 'Choose one outfit for this episode', asset.characterId);
    if (selection.outfitId && !outfitMatches.length) addIssue('CHARACTER_OUTFIT_MISSING', 'The selected outfit version is unavailable', asset.characterId);
    const outfit = [...outfitMatches].sort((a, b) => b.version - a.version)[0];
    const frozenAsset = { ...asset, ...identity };
    if (asset.providerBindings.length && capability.identity?.elementBinding && capability.identity.elementsTransportVerified !== true) addIssue('CHARACTER_ELEMENT_TRANSPORT_UNVERIFIED', 'The current job adapter has no verified element transport; using managed identity images', asset.characterId, 'warning');
    let binding = selectVerifiedCharacterBinding(frozenAsset, capability, target.payload.mode, now);
    // Match hashes to the actual frozen bytes, not just mutable metadata supplied by the profile.
    if (binding && identity.referenceViews.some(ref => { const matching = versions.get(ref.versionId)?.filter(version => version.assetId === ref.assetId); return !matching?.length || matching.some(version => version.metadata?.sha256 !== ref.sha256); })) {
      addIssue('CHARACTER_BINDING_STALE', 'The element binding does not match the current reference bytes; using images', asset.characterId, 'warning'); binding = undefined;
    }
    if (!binding && asset.providerBindings.length) addIssue('CHARACTER_BINDING_FALLBACK', 'No verified element binding matches this provider, account, model and reference version; using images', asset.characterId, 'info');
    const voiceBinding = capability.identity?.voiceSelection && capability.requestScope?.providerId === capability.providerId
      ? asset.voiceBindings.find(item => bindingVerified(item, now) && scopeMatches(item.scope, capability.requestScope!) && item.externalVoiceId.trim()) : undefined;
    const snapshot: FrozenShotCharacter = { characterId: asset.characterId, name: asset.name, canonicalVersion: identity.canonicalVersion,
      ...(identity.sourceIdentityVersion ? { sourceIdentityVersion: identity.sourceIdentityVersion } : {}), immutableTraits: identity.immutableTraits,
      lead: !!selection.lead, ...(outfit ? { outfit: copy(outfit) } : {}), voice: asset.voice, ...(voiceBinding ? { voiceBinding: copy(voiceBinding) } : {}),
      ...(binding ? { providerBinding: copy(binding) } : {}), referenceVersionIds: [] };
    const refs = (references: readonly CharacterAssetVersionRef[], purpose: 'identity' | 'outfit'): CompiledCharacterInput[] => {
      const preferred = preferredViews(shot, selection);
      return [...references].sort((a, b) => {
        const rank = (view: CharacterReferenceView) => preferred.includes(view) ? preferred.indexOf(view) : preferred.length;
        return rank(a.view) - rank(b.view);
      }).flatMap(ref => {
        const matching = versions.get(ref.versionId)?.filter(version => version.assetId === ref.assetId) ?? [];
        // Metadata may differ between copies; differing bytes/URI for one ID are unsafe.
        const byteIdentities = new Set(matching.map(version => JSON.stringify([version.uri, version.metadata?.sha256, version.kind])));
        const version = matching[0];
        const reasons = ref.qualityStatus !== 'approved' ? ['reference has not been approved'] : ref.subjectCount !== undefined && ref.subjectCount !== 1 ? ['reference does not contain one identified subject']
          : !version ? ['asset version is unavailable'] : byteIdentities.size !== 1 ? ['asset version ID has conflicting media'] : ref.sha256 && version.metadata?.sha256 !== ref.sha256 ? ['reference content hash has changed'] : referenceProblems(version, rule);
        if (reasons.length) { droppedReferences.push({ characterId: asset.characterId, versionId: ref.versionId, purpose, reason: reasons.join('; '), required: false }); return []; }
        return [{ role: 'referenceImage' as const, order: 0, versionId: version!.id, assetId: version!.assetId, kind: 'image' as const, uri: version!.uri,
          ...(version!.metadata ? { metadata: copy(version!.metadata) } : {}), characterId: asset.characterId, canonicalVersion: identity.canonicalVersion, view: ref.view, purpose,
          ...(purpose === 'outfit' && outfit ? { outfitId: outfit.id, outfitVersion: outfit.version } : {}) }];
      });
    };
    const identities = binding ? [] : refs(identity.referenceViews, 'identity');
    const outfits = outfit ? refs(outfit.refs, 'outfit') : [];
    if (selection.frame) {
      const ref = [...identity.referenceViews, ...(outfit?.refs ?? [])].find(item => item.versionId === selection.frame!.referenceVersionId);
      const matching = ref ? versions.get(ref.versionId)?.filter(item => item.assetId === ref.assetId) ?? [] : [];
      const frame = matching[0], frameRule = capability.identity?.frameRules?.[selection.frame.role];
      const reasons = !ref || ref.qualityStatus !== 'approved' || ref.subjectCount !== undefined && ref.subjectCount !== 1 ? ['an approved single-subject character frame must be selected']
        : !frame ? ['frame asset is missing'] : new Set(matching.map(item => JSON.stringify([item.uri, item.metadata?.sha256]))).size !== 1 ? ['frame version has conflicting media']
        : ref.sha256 && frame.metadata?.sha256 !== ref.sha256 ? ['frame content hash has changed'] : referenceProblems(frame, frameRule);
      if (reasons.length) addIssue('CHARACTER_FRAME_INVALID', reasons.join('; '), asset.characterId);
      else inputs.push({ role: selection.frame.role, order: 0, versionId: frame!.id, assetId: frame!.assetId, kind: 'image', uri: frame!.uri,
        metadata: copy(frame!.metadata ?? {}), characterId: asset.characterId, canonicalVersion: identity.canonicalVersion,
        purpose: selection.frame.role === 'firstFrame' ? 'composition' : 'targetPose', view: ref!.view });
    }
    groups.push({ snapshot, identities, outfits, explicitFrame: !!selection.frame && inputs.some(input => input.characterId === asset.characterId && input.role === selection.frame!.role && input.versionId === selection.frame!.referenceVersionId) });
  }
  if (groups.length > 1 && capability.identity?.subjectPolicy !== 'multipleSubjects') addIssue('CHARACTER_SUBJECT_POLICY', 'This model has not declared support for multiple character identities; choose another model or create an approved group storyboard first');
  const frames = inputs.filter(input => input.role === 'firstFrame' || input.role === 'lastFrame');
  const elements = groups.filter(group => group.snapshot.providerBinding).length;
  if (elements && (!Number.isSafeInteger(capability.identity?.maxElements) || elements > capability.identity!.maxElements!)) addIssue('CHARACTER_ELEMENT_LIMIT', 'The verified element count limit is missing or exceeded');
  const existingReferences = inputs.filter(input => input.role === 'referenceImage' || input.role === 'character' && input.kind === 'image').length;
  const combination = canvasReferenceCombination([...inputs, { role: 'referenceImage', kind: 'image' }]);
  const combinationLimit = mode?.combinationConstraints?.find(item => item.combination === combination)?.maxImages;
  const limits = [rule?.maxCount, combinationLimit];
  if (capability.identity?.allImagesTotal !== undefined) limits.push(capability.identity.allImagesTotal - frames.length - (capability.identity.elementsCountAsImages ? elements : 0));
  const limitValues = limits.filter((limit): limit is number => limit !== undefined);
  const validLimit = limitValues.every(limit => Number.isSafeInteger(limit) && limit >= 0);
  if (!validLimit) addIssue('CHARACTER_REFERENCE_LIMIT_INVALID', 'Character image limits must be non-negative integers');
  const identityLimit = capability.identity?.maxIdentityImages;
  if (identityLimit !== undefined && (!Number.isSafeInteger(identityLimit) || identityLimit < 0)) addIssue('CHARACTER_IDENTITY_LIMIT_INVALID', 'The identity image limit must be a non-negative integer');
  let identityBudget = identityLimit === undefined ? Infinity : Number.isSafeInteger(identityLimit) && identityLimit >= 0 ? identityLimit : 0;
  let budget = capability.identity?.referenceImages === false || !rule?.supported || !Number.isSafeInteger(rule.maxCount) || rule.maxCount < 1 || !validLimit ? 0 : Math.max(0, Math.min(...limitValues) - existingReferences);
  const used = new Set<CompiledCharacterInput>();
  const append = (input: CompiledCharacterInput): boolean => { if (!budget || input.purpose === 'identity' && !identityBudget) return false; inputs.push(input); used.add(input); budget--; if (input.purpose === 'identity') identityBudget--; return true; };
  const dropReason = (input: CompiledCharacterInput): string => input.purpose === 'identity' && !identityBudget ? 'identity image budget is exhausted' : 'reference budget is exhausted';
  // Allocate one image per character before optional angles/outfits, with explicit lead priority.
  for (const group of groups) {
    if (group.snapshot.providerBinding) continue;
    const first = group.identities[0];
    if ((!first || !budget || !identityBudget) && group.explicitFrame) {
      addIssue('CHARACTER_IDENTITY_VIA_EXPLICIT_FRAME', 'The explicitly selected character picture is used as a frame; no separate identity reference can be supplied in this mode', group.snapshot.characterId, 'warning');
      continue;
    }
    if (!first || !append(first)) {
      addIssue('CHARACTER_IDENTITY_REQUIRED', `No visual identity input can be supplied for ${group.snapshot.name}; choose fewer characters, another model, or an approved storyboard image`, group.snapshot.characterId);
      droppedReferences.push({ characterId: group.snapshot.characterId, ...(first ? { versionId: first.versionId } : {}), purpose: 'identity', required: true, reason: first ? dropReason(first) : 'no usable approved identity reference' });
    }
  }
  for (const group of groups) {
    const optional = [...group.outfits, ...group.identities.slice(1)];
    for (const input of optional) if (!append(input)) droppedReferences.push({ characterId: group.snapshot.characterId, versionId: input.versionId, purpose: input.purpose === 'outfit' ? 'outfit' : 'identity', required: false, reason: dropReason(input) });
  }
  for (const group of groups) {
    if (group.identities[0] && !used.has(group.identities[0]) && !droppedReferences.some(drop => drop.characterId === group.snapshot.characterId && drop.versionId === group.identities[0].versionId)) droppedReferences.push({ characterId: group.snapshot.characterId, versionId: group.identities[0].versionId, purpose: 'identity', required: !group.explicitFrame, reason: dropReason(group.identities[0]) });
    characters.push({ ...group.snapshot, referenceVersionIds: inputs.filter(input => input.characterId === group.snapshot.characterId).map(input => input.versionId) });
  }
  for (const dropped of droppedReferences) addIssue('CHARACTER_REFERENCE_DROPPED', `${dropped.versionId ?? 'Identity'}: ${dropped.reason}`, dropped.characterId, dropped.required ? 'error' : 'warning');
  inputs = inputs.map((input, order) => ({ ...input, order }));
  if ((inputs.some(input => input.purpose === 'identity' || input.purpose === 'outfit') || groups.some(group => group.snapshot.providerBinding)) && frames.length) {
    const compatible = frames.some(frame => frame.role === 'lastFrame') ? capability.identity?.identityAlongsideFirstLastFrames : capability.identity?.identityAlongsideStartFrame;
    if (compatible !== true) addIssue('CHARACTER_FRAME_COMBINATION_UNVERIFIED', 'Combining character identities with these frame slots has not been verified');
    if (capability.identity?.allImagesTotal === undefined) addIssue('CHARACTER_TOTAL_IMAGE_LIMIT_UNKNOWN', 'The combined frame and identity image limit has not been declared');
  }
  if (elements && inputs.some(input => input.kind === 'image') && capability.identity?.elementsCountAsImages === undefined) addIssue('CHARACTER_ELEMENT_IMAGE_BUDGET_UNKNOWN', 'The adapter must declare whether elements share the image budget before combining them with pictures');
  if (capability.identity?.allImagesTotal !== undefined && inputs.filter(input => input.kind === 'image').length + (capability.identity.elementsCountAsImages ? elements : 0) > capability.identity.allImagesTotal) addIssue('CHARACTER_TOTAL_IMAGE_LIMIT', 'Frames, references and counted elements exceed the model total image limit');
  for (const missing of resolution.missing) {
    if (missing.reason === 'requiredInput' && inputs.some(input => input.role === missing.role)) continue;
    const source = canvas.nodes.find(node => node.id === missing.sourceNodeId);
    if (missing.role === 'referenceImage' && source?.kind === 'character' && selectedIds.has(source.payload.characterId) && inputs.some(input => input.characterId === source.payload.characterId && input.purpose === 'identity')) continue;
    addIssue('CHARACTER_UPSTREAM_MISSING', `Upstream ${missing.role}: ${missing.reason}`, undefined, 'error', 'inputs');
  }
  issues.push(...validateCanvasGenerationParameters(capability, target.payload.mode, target.payload.parameters, inputs).map(item => ({ ...item, severity: 'error' as const })));
  const referenceMap: ShotCharacterCompilation['referenceMap'][number][] = [];
  inputs.forEach((input, inputIndex) => {
    if (input.kind !== 'image') return;
    const character = characters.find(item => item.characterId === input.characterId);
    const label = character ? `${character.name} ${input.purpose === 'outfit' ? `${character.outfit?.label ?? '服装'} ` : ''}${VIEW_LABELS[input.view ?? 'unspecified']}`
      : canvas.nodes.find(node => node.id === input.sourceNodeId)?.title ?? input.assetId;
    referenceMap.push({ imageIndex: referenceMap.length + 1, inputIndex, versionId: input.versionId, ...(input.characterId ? { characterId: input.characterId } : {}), label, ...(input.purpose ? { purpose: input.purpose } : {}) });
  });
  const mappingText = referenceMap.map(item => `图${item.imageIndex} = ${item.label}`).join('\n');
  const identityText = characters.map(character => [
    `${character.name}：${character.immutableTraits}`,
    character.outfit ? `本镜服装：${character.outfit.description}。身份参考仅用于人物面部、发型和体型，服装采用本镜指定造型。` : '',
    character.providerBinding ? `${character.name} 使用当前模型已验证的角色元素。` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
  const prompt = [target.payload.prompt, ...inputs.filter(input => input.role === 'prompt').map(input => input.text), mappingText, identityText].filter(text => text?.trim()).join('\n\n');
  return freeze(copy({ nodeId: target.id, modelId: capability.providerModelId, capabilityVersion: capability.version, mode: target.payload.mode, parameters: target.payload.parameters,
    characters, inputs, referenceMap, mappingText, prompt, droppedReferences, issues, canSubmit: !issues.some(item => item.severity === 'error') }));
}
