import type { CanvasCharacterProfile, CharacterAssetVersionRef, CharacterReferenceView, CharacterIdentityVersion, CharacterProviderScope, CharacterBindingStatus, ProviderCharacterBinding } from './canvas-characters.js';

// Kept below the project codec: profile decoding does not depend on project parsing or commands.
const VIEW_LABELS = { front: true, threeQuarter: true, side: true, back: true, fullBody: true, detail: true, unspecified: true };
function versionValid(version: number): boolean { return Number.isSafeInteger(version) && version > 0; }

function profileRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function profileText(value: unknown, label: string, required = true): string {
  if (typeof value !== 'string' || required && !value.trim()) throw new Error(`${label} must be a string${required ? ' with a value' : ''}`);
  return value;
}
function profileList(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function profileVersion(value: unknown, label: string): number {
  if (typeof value !== 'number' || !versionValid(value)) throw new Error(`${label} must be a positive integer`);
  return value;
}
function profileDate(value: unknown, label: string): string {
  const result = profileText(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be a valid timestamp`);
  return result;
}
function profileRef(value: unknown): CharacterAssetVersionRef {
  const item = profileRecord(value, 'character reference');
  const view = profileText(item.view, 'reference.view');
  if (!Object.hasOwn(VIEW_LABELS, view) || !['approved', 'draft', 'rejected'].includes(String(item.qualityStatus))) throw new Error('Invalid reference view or approval state');
  if (item.sha256 !== undefined && (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256))) throw new Error('Reference sha256 must be a content hash');
  if (item.subjectCount !== undefined && (typeof item.subjectCount !== 'number' || !Number.isSafeInteger(item.subjectCount) || item.subjectCount < 0)) throw new Error('Reference subjectCount must be a non-negative integer');
  return { assetId: profileText(item.assetId, 'reference.assetId'), versionId: profileText(item.versionId, 'reference.versionId'), view: view as CharacterReferenceView,
    qualityStatus: item.qualityStatus as CharacterAssetVersionRef['qualityStatus'], ...(item.sha256 ? { sha256: item.sha256 as string } : {}),
    ...(item.subjectCount !== undefined ? { subjectCount: item.subjectCount as number } : {}) };
}
function profileIdentity(value: unknown): CharacterIdentityVersion {
  const item = profileRecord(value, 'character identity');
  const refs = profileList(item.referenceViews, 'referenceViews').map(profileRef);
  if (new Set(refs.map(ref => ref.versionId)).size !== refs.length) throw new Error('Identity references must have distinct version IDs');
  return { canonicalVersion: profileVersion(item.canonicalVersion, 'canonicalVersion'), immutableTraits: profileText(item.immutableTraits, 'immutableTraits', false), referenceViews: refs,
    ...(item.sourceIdentityVersion !== undefined ? { sourceIdentityVersion: profileText(item.sourceIdentityVersion, 'sourceIdentityVersion') } : {}) };
}
function profileScope(value: unknown): CharacterProviderScope {
  const item = profileRecord(value, 'binding.scope');
  const apiEndpoint = profileText(item.apiEndpoint, 'scope.apiEndpoint');
  let url: URL;
  try { url = new URL(apiEndpoint); } catch { throw new Error('scope.apiEndpoint must be an absolute HTTP endpoint'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('scope.apiEndpoint must not contain credentials, query parameters or fragments');
  return { providerId: profileText(item.providerId, 'scope.providerId'), accountNamespace: profileText(item.accountNamespace, 'scope.accountNamespace'), apiEndpoint,
    product: profileText(item.product, 'scope.product'), modelFamily: profileText(item.modelFamily, 'scope.modelFamily'), modelVersion: profileText(item.modelVersion, 'scope.modelVersion'),
    ...(item.region !== undefined ? { region: profileText(item.region, 'scope.region') } : {}) };
}
function profileBindingState(item: Record<string, unknown>): Pick<ProviderCharacterBinding, 'status' | 'validatedAt' | 'validationMethod' | 'expiresAt'> {
  if (!['unverified', 'active', 'valid', 'expired', 'invalid', 'stale', 'inaccessible', 'disabled'].includes(String(item.status))) throw new Error('Invalid binding status');
  if (item.validationMethod !== undefined && !['query', 'controlledCall'].includes(String(item.validationMethod))) throw new Error('Invalid binding validation method');
  return { status: item.status as CharacterBindingStatus,
    ...(item.validatedAt !== undefined ? { validatedAt: profileDate(item.validatedAt, 'binding.validatedAt') } : {}),
    ...(item.validationMethod !== undefined ? { validationMethod: item.validationMethod as ProviderCharacterBinding['validationMethod'] } : {}),
    ...(item.expiresAt === null ? { expiresAt: null } : item.expiresAt !== undefined ? { expiresAt: profileDate(item.expiresAt, 'binding.expiresAt') } : {}) };
}
/** Validates and reconstructs only known fields, so extension data cannot smuggle provider credentials. */
export function normalizeCanvasCharacterProfile(value: unknown): CanvasCharacterProfile {
  const item = profileRecord(value, 'canvasCharacter'), identity = profileIdentity(item);
  const history = item.history === undefined ? [] : profileList(item.history, 'history').map(profileIdentity);
  if (history.some(entry => entry.canonicalVersion >= identity.canonicalVersion) || new Set(history.map(entry => entry.canonicalVersion)).size !== history.length) throw new Error('Identity history must contain distinct older versions');
  const outfits = profileList(item.outfits, 'outfits').map(value => {
    const outfit = profileRecord(value, 'outfit');
    return { id: profileText(outfit.id, 'outfit.id'), version: profileVersion(outfit.version, 'outfit.version'), label: profileText(outfit.label, 'outfit.label'),
      description: profileText(outfit.description, 'outfit.description', false), refs: profileList(outfit.refs, 'outfit.refs').map(profileRef),
      ...(outfit.episodeNumbers !== undefined ? { episodeNumbers: profileList(outfit.episodeNumbers, 'episodeNumbers').map(episode => profileVersion(episode, 'episodeNumber')) } : {}) };
  });
  if (new Set(outfits.map(outfit => `${outfit.id}:${outfit.version}`)).size !== outfits.length) throw new Error('Outfit versions must be distinct');
  const providerBindings = profileList(item.providerBindings, 'providerBindings').map(value => {
    const binding = profileRecord(value, 'provider binding');
    const hashes = profileList(binding.referenceAssetHashes, 'referenceAssetHashes').map(hash => {
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('referenceAssetHashes must be content hashes');
      return hash;
    });
    return { id: profileText(binding.id, 'binding.id'), scope: profileScope(binding.scope), externalElementId: profileText(binding.externalElementId, 'externalElementId'),
      capabilityVersion: profileText(binding.capabilityVersion, 'binding.capabilityVersion'), referenceVersion: profileVersion(binding.referenceVersion, 'binding.referenceVersion'),
      referenceAssetHashes: hashes, ...profileBindingState(binding),
      ...(binding.verifiedModelVersions !== undefined ? { verifiedModelVersions: profileList(binding.verifiedModelVersions, 'verifiedModelVersions').map(version => profileText(version, 'verifiedModelVersion')) } : {}) };
  });
  const voiceBindings = profileList(item.voiceBindings, 'voiceBindings').map(value => {
    const binding = profileRecord(value, 'voice binding');
    return { id: profileText(binding.id, 'voiceBinding.id'), voiceProfileId: profileText(binding.voiceProfileId, 'voiceProfileId'), scope: profileScope(binding.scope),
      externalVoiceId: profileText(binding.externalVoiceId, 'externalVoiceId'), ...profileBindingState(binding),
      ...(binding.sampleRefs !== undefined ? { sampleRefs: profileList(binding.sampleRefs, 'voice.sampleRefs').map(value => { const ref = profileRecord(value, 'voice sample'); return { assetId: profileText(ref.assetId, 'voice.assetId'), versionId: profileText(ref.versionId, 'voice.versionId') }; }) } : {}) };
  });
  if (new Set(providerBindings.map(binding => binding.id)).size !== providerBindings.length || new Set(voiceBindings.map(binding => binding.id)).size !== voiceBindings.length) throw new Error('Binding IDs must be distinct');
  return { ...identity, history: history.sort((a, b) => a.canonicalVersion - b.canonicalVersion), outfits, providerBindings, voiceBindings };
}

