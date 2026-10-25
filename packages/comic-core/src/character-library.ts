import type { ComicCharacterBundle, ComicProject } from "./types.js";
import { COMIC_CHARACTER_BUNDLE_SCHEMA_VERSION } from "./types.js";
import { ComicCoreError, boundedText, identifier, record, textList, timestamp } from "./validation.js";

/**
 * Creates an immutable, metadata-only character bundle. The platform copies the
 * referenced image bytes separately; keeping bytes out of the JSON prevents a
 * character export from becoming an unbounded project payload.
 */
export function createComicCharacterBundle(
  project: ComicProject,
  characterId: string,
  authorizationRef: string,
  options: { readonly bundleId: string; readonly now: string },
): ComicCharacterBundle {
  const character = project.characters.find(candidate => candidate.id === characterId);
  if (!character) throw new ComicCoreError("CHARACTER_NOT_FOUND", "Character does not exist", "comic.character_not_found.character_does_not_exist", {});
  const authorization = boundedText(authorizationRef, "characterBundle.authorizationRef", 500, { required: true });
  const referenceAssets = (character.referenceAssetIds || []).map(assetId => project.assets.find(asset => asset.id === assetId));
  if (referenceAssets.some(asset => !asset || asset.kind !== "image")) {
    throw new ComicCoreError("INVALID_REFERENCE", "Character bundle contains a missing or non-image reference", "comic.invalid_reference.character_bundle_contains_a_missing_or_non_image_reference", {});
  }
  return {
    schemaVersion: COMIC_CHARACTER_BUNDLE_SCHEMA_VERSION,
    bundleId: identifier(options.bundleId, "bundle", "characterBundle.bundleId"),
    sourceProjectId: project.id,
    sourceCharacterId: character.id,
    character: {
      name: character.name,
      ...(character.aliases ? { aliases: character.aliases } : {}),
      description: character.description,
      appearance: character.appearance,
      voice: character.voice,
      ...(character.identityVersion === undefined ? {} : { identityVersion: character.identityVersion }),
      authorizationRef: authorization,
    },
    referenceAssets: referenceAssets.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)),
    createdAt: timestamp(options.now, "characterBundle.createdAt"),
  };
}

/** Validates a persisted bundle before any files are copied into a target project. */
export function validateComicCharacterBundle(value: unknown): ComicCharacterBundle {
  const item = record(value, "characterBundle");
  if (item.schemaVersion !== COMIC_CHARACTER_BUNDLE_SCHEMA_VERSION) {
    throw new ComicCoreError("UNSUPPORTED_SCHEMA", "Unsupported character bundle schema", "comic.unsupported_schema.unsupported_character_bundle_schema", {});
  }
  const character = record(item.character, "characterBundle.character");
  const authorizationRef = boundedText(character.authorizationRef, "characterBundle.character.authorizationRef", 500, { required: true });
  if (!Array.isArray(item.referenceAssets) || item.referenceAssets.length > 16) {
    throw new ComicCoreError("INVALID_PROJECT", "Character bundle has too many reference assets", "comic.invalid_project.character_bundle_has_too_many_reference_assets", { maximum: 16 });
  }
  const referenceAssets = item.referenceAssets.map((entry, index) => {
    const asset = record(entry, `characterBundle.referenceAssets[${index}]`);
    if (asset.kind !== "image") throw new ComicCoreError("INVALID_REFERENCE", "Character bundle references must be images", "comic.invalid_reference.character_bundle_references_must_be_images", {});
    return entry as ComicCharacterBundle["referenceAssets"][number];
  });
  return {
    schemaVersion: COMIC_CHARACTER_BUNDLE_SCHEMA_VERSION,
    bundleId: identifier(item.bundleId, "bundle", "characterBundle.bundleId"),
    sourceProjectId: identifier(item.sourceProjectId, "project", "characterBundle.sourceProjectId"),
    sourceCharacterId: identifier(item.sourceCharacterId, "character", "characterBundle.sourceCharacterId"),
    character: {
      name: boundedText(character.name, "characterBundle.character.name", 120, { required: true }),
      ...(character.aliases === undefined ? {} : { aliases: textList(character.aliases, "characterBundle.character.aliases", 100, 120) }),
      description: boundedText(character.description, "characterBundle.character.description", 4_000),
      appearance: boundedText(character.appearance, "characterBundle.character.appearance", 8_000),
      voice: boundedText(character.voice, "characterBundle.character.voice", 500),
      ...(character.identityVersion === undefined ? {} : { identityVersion: boundedText(character.identityVersion, "characterBundle.character.identityVersion", 120) }),
      authorizationRef,
    },
    referenceAssets,
    createdAt: timestamp(item.createdAt, "characterBundle.createdAt"),
  };
}
