import { compactCanvasCapabilityVersion, buildCanvasModelCapability, decodeCanvasProvenVideoShapes, isCanvasDurationValid, isCanvasVideoRequestShape, type CanvasDurationRule, type CanvasModelCapability, type CanvasModelCapabilityEvidence, type CanvasModeCapability, type CanvasGenerationMode } from '@nextmux/comic-core';
import { officialMediaCapabilities } from '@nextmux/model-runtime';
import type { DesktopVideoModelFacts, OfficialModelConnection, PlatformOffering } from './nextmux-platform-protocol';
import { buildManagedCanvasAdapterPolicy, buildOfficialCanvasAdapterPolicy, type CanvasAdapterPolicy, type CanvasAdapterPolicyOptions } from './nextmux-canvas-adapter-policy';
import { plannedClipSeconds, videoModelGuide } from './nextmux-video-model-guide';
import { videoModelProfile } from './nextmux-video-profiles';
import { intersectCanvasRegistryCapability } from './nextmux-canvas-registry-intersection';
import { optionalKeyPriceQuoteId } from './nextmux-price-quote';
import { managedVideoImagePriceMatchesProof } from './nextmux-managed-video-price';
import { canvasVideoTier, offeringMediaTiers } from './nextmux-canvas-media-tiers';

/** Optional verified mode contract supplied by an adapter/catalog, never inferred from its label. */
export interface DesktopCanvasCapabilityDeclaration {
    readonly providerModelId: string;
    readonly version: string;
    readonly modes: readonly CanvasModeCapability[];
    readonly defaultMode?: CanvasGenerationMode;
}

export class CanvasCapabilityDeclarationError extends Error {
    readonly code = 'CANVAS_CAPABILITY_DECLARATION_INVALID';
    constructor(readonly path: string, message: string) {
        super(`${path}: ${message}`);
        this.name = 'CanvasCapabilityDeclarationError';
    }
}

/** Validates user/catalog configuration shape. This is configuration evidence, never a paid API probe. */
export function validateDesktopCanvasCapabilityDeclaration(value: unknown, expectedModelId: string): DesktopCanvasCapabilityDeclaration {
    const fail = (path: string, message: string): never => { throw new CanvasCapabilityDeclarationError(path, message); };
    const record = (input: unknown, path: string): Record<string, unknown> => input && typeof input === 'object' && !Array.isArray(input)
        ? input as Record<string, unknown> : fail(path, 'Expected an object.');
    const text = (input: unknown, path: string): string => typeof input === 'string' && Boolean(input.trim()) && !/[\r\n\0]/u.test(input)
        ? input : fail(path, 'Expected a nonempty single-line string.');
    const list = (input: unknown, path: string): unknown[] => Array.isArray(input) ? input : fail(path, 'Expected an array.');
    const number = (input: unknown, path: string, minimum = 0, integer = false): number => typeof input === 'number' && Number.isFinite(input) && input >= minimum && (!integer || Number.isSafeInteger(input))
        ? input : fail(path, 'Expected a finite number within the declared units.');
    const optionalBoolean = (input: unknown, path: string): void => { if (input !== undefined && typeof input !== 'boolean') fail(path, 'Expected a boolean.'); };
    const fields = (input: Record<string, unknown>, allowed: readonly string[], path: string): void => {
        for (const key of Object.keys(input)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'This field is not part of the public capability contract.');
    };
    const duration = (input: unknown, path: string): void => {
        if (input === undefined) return;
        const rule = record(input, path);
        fields(rule, ['kind', 'seconds', 'defaultSeconds', 'min', 'max', 'step'], path);
        if (rule.kind === 'fixed') number(rule.seconds, `${path}.seconds`, Number.MIN_VALUE);
        else if (rule.kind === 'enum') {
            const seconds = list(rule.seconds, `${path}.seconds`);
            if (!seconds.length) fail(path, 'A duration enumeration must contain values.');
            seconds.forEach((entry, index) => number(entry, `${path}.seconds.${index}`, Number.MIN_VALUE));
        } else if (rule.kind === 'range') {
            number(rule.min, `${path}.min`, Number.MIN_VALUE); number(rule.max, `${path}.max`, Number.MIN_VALUE); number(rule.step, `${path}.step`, Number.MIN_VALUE);
        } else fail(path, 'Unknown duration discriminator.');
        const seconds = rule.kind === 'fixed' ? rule.seconds : rule.defaultSeconds;
        if (!isCanvasDurationValid(rule as unknown as CanvasDurationRule, seconds)) fail(path, 'The duration default must obey its fixed, enum or stepped range rule.');
    };
    const audio = (input: unknown, path: string): void => {
        if (input === undefined) return;
        const definition = record(input, path);
        fields(definition, ['mode', 'defaultEnabled'], path);
        if (!['unsupported', 'optional', 'required'].includes(String(definition.mode)) || typeof definition.defaultEnabled !== 'boolean') fail(path, 'Audio requires a supported discriminator and boolean default.');
        if (definition.mode === 'unsupported' && definition.defaultEnabled || definition.mode === 'required' && !definition.defaultEnabled) fail(path, 'The audio default conflicts with its capability mode.');
    };
    const declaration = record(value, 'canvasCapabilities');
    fields(declaration, ['providerModelId', 'version', 'modes', 'defaultMode'], 'canvasCapabilities');
    if (text(declaration.providerModelId, 'canvasCapabilities.providerModelId') !== expectedModelId) fail('canvasCapabilities.providerModelId', 'The declaration must belong to this exact provider model.');
    text(declaration.version, 'canvasCapabilities.version');
    const modes = list(declaration.modes, 'canvasCapabilities.modes');
    const validModes: readonly string[] = ['textToImage', 'imageToImage', 'textToVideo', 'imageToVideo', 'firstLastFrame', 'referenceToVideo', 'videoEdit', 'videoExtend'];
    const seenModes = new Set<string>();
    modes.forEach((input, index) => {
        const path = `canvasCapabilities.modes.${index}`, mode = record(input, path);
        fields(mode, ['mode', 'outputVariants', 'defaultResolution', 'duration', 'audioGeneration', 'firstFrame', 'lastFrame', 'frameImageRule', 'referenceRules', 'audioDrivenVideo', 'preserveInputAudio', 'combinationConstraints', 'parameters'], path);
        const discriminator = text(mode.mode, `${path}.mode`);
        if (!validModes.includes(discriminator) || seenModes.has(discriminator)) fail(`${path}.mode`, 'Modes must be supported, unique discriminators.');
        seenModes.add(discriminator);
        duration(mode.duration, `${path}.duration`); audio(mode.audioGeneration, `${path}.audioGeneration`);
        for (const field of ['firstFrame', 'lastFrame', 'audioDrivenVideo', 'preserveInputAudio']) optionalBoolean(mode[field], `${path}.${field}`);
        const seenResolutions = new Set<string>();
        if (mode.outputVariants !== undefined) list(mode.outputVariants, `${path}.outputVariants`).forEach((raw, variantIndex) => {
            const variantPath = `${path}.outputVariants.${variantIndex}`, variant = record(raw, variantPath);
            fields(variant, ['id', 'resolution', 'aspectRatios', 'defaultAspectRatio', 'durationOverride', 'audioGenerationOverride', 'formats', 'dimensions', 'derivedAspectRatio', 'requestShapes', 'requestAudioOverride'], variantPath);
            text(variant.id, `${variantPath}.id`);
            const resolution = text(variant.resolution, `${variantPath}.resolution`);
            if (seenResolutions.has(resolution)) fail(`${variantPath}.resolution`, 'A resolution must have one effective variant per mode.');
            seenResolutions.add(resolution);
            if (variant.aspectRatios !== undefined) list(variant.aspectRatios, `${variantPath}.aspectRatios`).forEach((ratio, ratioIndex) => text(ratio, `${variantPath}.aspectRatios.${ratioIndex}`));
            if (variant.formats !== undefined) list(variant.formats, `${variantPath}.formats`).forEach((format, formatIndex) => text(format, `${variantPath}.formats.${formatIndex}`));
            if (variant.defaultAspectRatio !== undefined && (!Array.isArray(variant.aspectRatios) || !variant.aspectRatios.includes(variant.defaultAspectRatio))) fail(`${variantPath}.defaultAspectRatio`, 'The default aspect must belong to this variant.');
            if (variant.dimensions !== undefined) for (const [ratio, rawSize] of Object.entries(record(variant.dimensions, `${variantPath}.dimensions`))) {
                if (!Array.isArray(variant.aspectRatios) || !variant.aspectRatios.includes(ratio)) fail(`${variantPath}.dimensions.${ratio}`, 'Dimensions must belong to a declared aspect ratio.');
                const size = record(rawSize, `${variantPath}.dimensions.${ratio}`);
                fields(size, ['width', 'height'], `${variantPath}.dimensions.${ratio}`);
                number(size.width, `${variantPath}.dimensions.${ratio}.width`, 1, true); number(size.height, `${variantPath}.dimensions.${ratio}.height`, 1, true);
            }
            duration(variant.durationOverride, `${variantPath}.durationOverride`); audio(variant.audioGenerationOverride, `${variantPath}.audioGenerationOverride`);
            optionalBoolean(variant.requestAudioOverride, `${variantPath}.requestAudioOverride`);
            if (variant.derivedAspectRatio !== undefined) {
                const rulePath = `${variantPath}.derivedAspectRatio`, rule = record(variant.derivedAspectRatio, rulePath);
                fields(rule, ['inputRole', 'aspectRatios', 'tolerance', 'allowOmission'], rulePath);
                if (!['firstFrame', 'referenceImage'].includes(String(rule.inputRole))) fail(`${rulePath}.inputRole`, 'Auto must follow the carried first frame or reference image.');
                list(rule.aspectRatios, `${rulePath}.aspectRatios`).forEach((ratio, ratioIndex) => {
                    if (!/^\d+:\d+$/u.test(text(ratio, `${rulePath}.aspectRatios.${ratioIndex}`)) || String(ratio).split(':').some(value => Number(value) <= 0)) fail(`${rulePath}.aspectRatios.${ratioIndex}`, 'Expected a positive numeric ratio.');
                });
                if (number(rule.tolerance, `${rulePath}.tolerance`) > 0.02) fail(`${rulePath}.tolerance`, 'Aspect derivation permits at most two percent pixel rounding.');
                if (typeof rule.allowOmission !== 'boolean') fail(`${rulePath}.allowOmission`, 'Expected a boolean.');
            }
            if (variant.requestShapes !== undefined) list(variant.requestShapes, `${variantPath}.requestShapes`).forEach((shape, shapeIndex) => {
                if (!isCanvasVideoRequestShape(shape)) fail(`${variantPath}.requestShapes.${shapeIndex}`, 'Expected a complete finite video request shape.');
            });
        });
        if (mode.defaultResolution !== undefined && !seenResolutions.has(text(mode.defaultResolution, `${path}.defaultResolution`))) fail(`${path}.defaultResolution`, 'The default resolution must belong to this mode.');
        const referenceRule = (input: unknown, rulePath: string): void => {
                const rule = record(input, rulePath);
                fields(rule, ['supported', 'maxCount', 'formats', 'maxBytes', 'minDurationSeconds', 'maxDurationSeconds', 'maxTotalDurationSeconds', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'aspectRatios', 'minAspectRatio', 'maxAspectRatio', 'codecs', 'resolutions', 'minFrameRate', 'maxFrameRate'], rulePath);
                if (typeof rule.supported !== 'boolean') fail(`${rulePath}.supported`, 'Expected a boolean.');
                number(rule.maxCount, `${rulePath}.maxCount`, 0, true);
                if (rule.supported === true && rule.maxCount === 0 || rule.supported === false && rule.maxCount !== 0) fail(rulePath, 'Reference support must agree with its count limit.');
                for (const field of ['maxBytes', 'minDurationSeconds', 'maxDurationSeconds', 'maxTotalDurationSeconds', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'minFrameRate', 'maxFrameRate', 'minAspectRatio', 'maxAspectRatio']) if (rule[field] !== undefined) number(rule[field], `${rulePath}.${field}`);
                for (const [min, max] of [['minDurationSeconds', 'maxDurationSeconds'], ['minWidth', 'maxWidth'], ['minHeight', 'maxHeight'], ['minFrameRate', 'maxFrameRate'], ['minAspectRatio', 'maxAspectRatio']]) if (typeof rule[min] === 'number' && typeof rule[max] === 'number' && rule[min] > rule[max]) fail(rulePath, `${min} cannot exceed ${max}.`);
                for (const field of ['formats', 'aspectRatios', 'codecs', 'resolutions']) if (rule[field] !== undefined) list(rule[field], `${rulePath}.${field}`).forEach((entry, entryIndex) => text(entry, `${rulePath}.${field}.${entryIndex}`));
        };
        if (mode.frameImageRule !== undefined) referenceRule(mode.frameImageRule, `${path}.frameImageRule`);
        if (mode.referenceRules !== undefined) {
            const rules = record(mode.referenceRules, `${path}.referenceRules`);
            fields(rules, ['image', 'video', 'audio'], `${path}.referenceRules`);
            for (const kind of ['image', 'video', 'audio']) if (rules[kind] !== undefined) referenceRule(rules[kind], `${path}.referenceRules.${kind}`);
        }
        if (mode.combinationConstraints !== undefined) {
            const combinations = new Set<string>();
            list(mode.combinationConstraints, `${path}.combinationConstraints`).forEach((raw, combinationIndex) => {
                const combinationPath = `${path}.combinationConstraints.${combinationIndex}`, constraint = record(raw, combinationPath);
                fields(constraint, ['combination', 'maxImages', 'maxVideos', 'maxAudios', 'maxTotalBytes', 'maxTotalDurationSeconds'], combinationPath);
                const combination = text(constraint.combination, `${combinationPath}.combination`);
                if (!['none', 'image', 'video', 'audio', 'image+video', 'image+audio', 'video+audio', 'image+video+audio'].includes(combination) || combinations.has(combination)) fail(combinationPath, 'Reference combinations must use unique exact signatures.');
                combinations.add(combination);
                for (const field of ['maxImages', 'maxVideos', 'maxAudios', 'maxTotalBytes', 'maxTotalDurationSeconds']) if (constraint[field] !== undefined) number(constraint[field], `${combinationPath}.${field}`, 0, field.startsWith('maxI') || field.startsWith('maxV') || field.startsWith('maxA'));
            });
        }
        if (mode.parameters !== undefined) {
            const parameters = new Set<string>();
            list(mode.parameters, `${path}.parameters`).forEach((raw, parameterIndex) => {
                const parameterPath = `${path}.parameters.${parameterIndex}`, definition = record(raw, parameterPath);
                fields(definition, ['key', 'type', 'values', 'min', 'max', 'step', 'defaultValue', 'required'], parameterPath);
                const key = text(definition.key, `${parameterPath}.key`);
                if (['__proto__', 'prototype', 'constructor'].includes(key) || /^(?:api_?key|secret|password|authorization|cookie|access_?token)$/iu.test(key)) fail(`${parameterPath}.key`, 'Credentials and object control fields are not generation parameters.');
                if (parameters.has(key) || ['resolution', 'aspectRatio', 'durationSeconds', 'generateAudio', 'preserveInputAudio'].includes(key)) fail(parameterPath, 'Extension parameters cannot duplicate another definition or replace standard capability fields.');
                parameters.add(key);
                if (!['boolean', 'string', 'number'].includes(String(definition.type))) fail(`${parameterPath}.type`, 'Unknown parameter type.');
                optionalBoolean(definition.required, `${parameterPath}.required`);
                for (const field of ['min', 'max', 'step']) if (definition[field] !== undefined) {
                    if (definition.type !== 'number' || typeof definition[field] !== 'number' || !Number.isFinite(definition[field]) || field === 'step' && Number(definition[field]) <= 0) fail(`${parameterPath}.${field}`, 'Numeric bounds must be finite and steps positive.');
                }
                if (typeof definition.min === 'number' && typeof definition.max === 'number' && definition.min > definition.max) fail(parameterPath, 'Minimum cannot exceed maximum.');
                if (definition.values !== undefined) list(definition.values, `${parameterPath}.values`).forEach((entry, entryIndex) => { if (typeof entry !== definition.type || typeof entry === 'number' && !Number.isFinite(entry)) fail(`${parameterPath}.values.${entryIndex}`, 'An enumeration must match its parameter type.'); });
                if (definition.defaultValue !== undefined) {
                    const defaultValue = definition.defaultValue;
                    if (typeof defaultValue !== definition.type || Array.isArray(definition.values) && !definition.values.includes(defaultValue) || typeof defaultValue === 'number' && (!Number.isFinite(defaultValue) || typeof definition.min === 'number' && defaultValue < definition.min || typeof definition.max === 'number' && defaultValue > definition.max)) fail(`${parameterPath}.defaultValue`, 'The default must satisfy its parameter definition.');
                    if (typeof defaultValue === 'number' && typeof definition.step === 'number') {
                        const quotient = (defaultValue - Number(definition.min ?? 0)) / definition.step;
                        if (Math.abs(quotient - Math.round(quotient)) > 1e-8) fail(`${parameterPath}.defaultValue`, 'The default must align with the declared step.');
                    }
                }
            });
        }
    });
    if (declaration.defaultMode !== undefined && !seenModes.has(text(declaration.defaultMode, 'canvasCapabilities.defaultMode'))) fail('canvasCapabilities.defaultMode', 'The default mode must be declared.');
    return structuredClone(declaration) as unknown as DesktopCanvasCapabilityDeclaration;
}

function rejectLiteralOutputContradiction(declaration: DesktopCanvasCapabilityDeclaration, facts: CanvasModelCapability): void {
    // Official bridge facts without a declaration have variants only when the template fixes output fields.
    const fixed = facts.modes.flatMap(mode => mode.outputVariants ?? [])[0];
    if (!fixed) return;
    const fixedSize = Object.values(fixed.dimensions ?? {})[0];
    const fixedAspect = fixed.aspectRatios?.[0];
    const [fixedAcross, fixedDown] = (fixedAspect ?? '').split(':').map(Number);
    const fixedRatio = fixedSize ? fixedSize.width / fixedSize.height : fixedAcross > 0 && fixedDown > 0 ? fixedAcross / fixedDown : undefined;
    declaration.modes.forEach((mode, modeIndex) => (mode.outputVariants ?? []).forEach((variant, variantIndex) => {
        const path = `canvasCapabilities.modes.${modeIndex}.outputVariants.${variantIndex}`;
        if (!fixedSize && variant.resolution.toLowerCase() !== fixed.resolution.toLowerCase()) throw new CanvasCapabilityDeclarationError(`${path}.resolution`, 'The declaration conflicts with the template\'s literal output resolution.');
        if (fixedSize) {
            for (const size of Object.values(variant.dimensions ?? {})) if (size.width !== fixedSize.width || size.height !== fixedSize.height) throw new CanvasCapabilityDeclarationError(`${path}.dimensions`, 'The declaration conflicts with the template\'s literal output dimensions.');
            const exactSize = /^(\d+)x(\d+)$/iu.exec(variant.resolution);
            const shortSide = /^(\d+)p$/iu.exec(variant.resolution);
            if (exactSize && (Number(exactSize[1]) !== fixedSize.width || Number(exactSize[2]) !== fixedSize.height)
                || shortSide && Number(shortSide[1]) !== Math.min(fixedSize.width, fixedSize.height)) throw new CanvasCapabilityDeclarationError(`${path}.resolution`, 'The declared resolution conflicts with the template\'s literal dimensions.');
        }
        if (fixedRatio !== undefined) for (const aspect of variant.aspectRatios ?? []) {
            const [across, down] = aspect.split(':').map(Number);
            if (aspect === 'auto' || across > 0 && down > 0 && Math.abs(across / down - fixedRatio) / fixedRatio > 0.02) throw new CanvasCapabilityDeclarationError(`${path}.aspectRatios`, 'The declared aspect conflicts with the template\'s literal output.');
        }
    }));
}

/** Public facts only: keys, URLs and template bodies never leave this bridge in the resulting catalog. */
export function buildOfficialCanvasCapability(
    connection: Pick<OfficialModelConnection, 'id' | 'providerId' | 'providerName' | 'protocol' | 'providerSettings' | 'label' | 'updatedAt'> & Partial<Pick<OfficialModelConnection, 'baseUrl' | 'canvasConfigurationUpdatedAt'>> & { readonly canvasCapabilities?: DesktopCanvasCapabilityDeclaration },
    modelId: string,
    overrides: Partial<CanvasModelCapabilityEvidence> = {},
    options: CanvasAdapterPolicyOptions = {}
): CanvasModelCapability {
    const template = connection.providerSettings?.mediaTemplate;
    const configuredAt = connection.canvasConfigurationUpdatedAt ?? connection.updatedAt;
    const declaration = connection.canvasCapabilities?.providerModelId === modelId ? validateDesktopCanvasCapabilityDeclaration(connection.canvasCapabilities, modelId) : undefined;
    const evidence: CanvasModelCapabilityEvidence = {
        id: `${connection.id}:${modelId}`,
        providerId: connection.providerId,
        providerModelId: modelId,
        displayName: modelId,
        version: `${configuredAt}:canvas-v1`,
        // Availability is local route configuration, not evidence that a paid generation has succeeded.
        status: 'available',
        capabilities: officialMediaCapabilities(connection.protocol, modelId, connection.providerSettings),
        ...(template ? { template } : {}),
        videoProfile: videoModelProfile(modelId),
        sources: ['model-runtime/officialMediaCapabilities', 'desktop/videoModelProfile', ...(declaration ? ['configured-adapter'] : [])],
        updatedAt: connection.updatedAt,
        ...overrides
    };
    if (declaration && template) rejectLiteralOutputContradiction(declaration, buildCanvasModelCapability({ ...evidence, modes: undefined, videoLimits: undefined }));
    const capability = buildCanvasModelCapability({ ...evidence,
        ...(declaration ? { version: `${declaration.version}@${configuredAt}:canvas-v1`, modes: declaration.modes, defaultMode: declaration.defaultMode } : {}), ...overrides });
    const policy = buildOfficialCanvasAdapterPolicy(connection, modelId, { ...options, ...(overrides.videoLimits ? { videoLimits: overrides.videoLimits } : {}) });
    const result = intersectCanvasRegistryCapability(withAdapterModes(capability, policy, Boolean(declaration || overrides.modes), options.videoFacts, overrides.videoLimits),
        policy, options.videoFacts, overrides.videoLimits);
    return { ...result, version: compactCanvasCapabilityVersion(result.version, capability.version) };
}

/** Platform contract fields win; a recognizable model name alone never enables a generation mode. */
export function buildManagedCanvasCapability(
    offering: Pick<PlatformOffering, 'id' | 'merchantId' | 'providerName' | 'providerModelCode' | 'displayName' | 'status' | 'capabilities' | 'mediaInput' | 'videoLimits'> & Partial<Pick<PlatformOffering, 'available' | 'category' | 'managedTransport' | 'canonicalModel' | 'imageLimits' | 'keyPriceQuoteId' | 'price'>> & { readonly canvasCapabilities?: DesktopCanvasCapabilityDeclaration },
    overrides: Partial<CanvasModelCapabilityEvidence> = {},
    options: CanvasAdapterPolicyOptions = {}
): CanvasModelCapability {
    const declaration = offering.canvasCapabilities?.providerModelId === offering.providerModelCode ? validateDesktopCanvasCapabilityDeclaration(offering.canvasCapabilities, offering.providerModelCode) : undefined;
    const capability = buildCanvasModelCapability({
        id: offering.id,
        providerId: offering.merchantId ?? offering.providerName,
        providerModelId: offering.providerModelCode,
        displayName: offering.displayName,
        // The version includes the exact public capability facts so a changed catalog cannot reinterpret history.
        version: `platform-v1:${JSON.stringify([offering.capabilities, offering.mediaInput ?? null, offering.videoLimits ?? null, ...(offering.imageLimits ? [offering.imageLimits] : []), offering.keyPriceQuoteId ?? null])}`,
        status: offering.status === 'active' && offering.available !== false ? 'available' : 'maintenance',
        capabilities: offering.capabilities,
        mediaInput: offering.mediaInput,
        videoLimits: offering.videoLimits,
        videoProfile: videoModelProfile(offering.providerModelCode),
        sources: ['platform/offering', 'desktop/videoModelProfile', ...(declaration ? ['configured-adapter'] : [])],
        ...(declaration ? { version: declaration.version, modes: declaration.modes, defaultMode: declaration.defaultMode } : {}),
        ...overrides
    });
    const limits = overrides.videoLimits ?? offering.videoLimits;
    const policy = buildManagedCanvasAdapterPolicy(offering, { ...options, ...(limits ? { videoLimits: limits } : {}) });
    const adapted = withAdapterModes(capability, policy, Boolean(declaration || overrides.modes), options.videoFacts, limits);
    const result = intersectCanvasRegistryCapability(withManagedShapeProof(adapted, policy, limits, offering.keyPriceQuoteId, offering),
        policy, options.videoFacts, limits, offering.canonicalModel);
    return { ...result, version: compactCanvasCapabilityVersion(result.version) };
}

/** Flat listing arrays do not prove a complete request against a managed hold. */
function withManagedShapeProof(capability: CanvasModelCapability, policy: CanvasAdapterPolicy,
    limits: CanvasModelCapabilityEvidence['videoLimits'], currentQuote: string | undefined, offering: Partial<Pick<PlatformOffering, 'price'>>): CanvasModelCapability {
    if (policy.kind !== 'video') return capability;
    const decoded = decodeCanvasProvenVideoShapes(limits);
    const field = limits?.provenShapeGroups !== undefined ? 'videoLimits.provenShapeGroups' : 'videoLimits.provenShapes';
    const raw = decoded.shapes;
    let reason: string | undefined;
    if (decoded.error) reason = `${field}:${decoded.error}`;
    else if (limits?.shapeQuoteId === undefined) reason = 'videoLimits.shapeQuoteId:missing';
    else if (!optionalKeyPriceQuoteId(limits.shapeQuoteId) || !optionalKeyPriceQuoteId(currentQuote)) reason = 'videoLimits.shapeQuoteId:invalid';
    else if (limits.shapeQuoteId !== currentQuote) reason = 'videoLimits.shapeQuoteId:stale';
    else if (!managedVideoImagePriceMatchesProof(offering, limits)) reason = 'videoLimits.inputImagePriceMicros:stale';
    // An official video tier table bills the requested output class, or one fixed class when the API format sends
    // no resolution (Veo's 720p default on the Gemini format): only shapes the gateway bills and renders are offered.
    const tiers = offeringMediaTiers(offering);
    const billedResolution = tiers?.kind === 'video' && tiers.requestTier === 'fixed'
        ? tiers.tiers.find(tier => tier.id === tiers.billedTierId)?.resolution?.toLowerCase() : undefined;
    const tierShapes = tiers?.kind === 'video' ? raw?.filter(shape => billedResolution ? shape.resolution.toLowerCase() === billedResolution
        : Boolean(canvasVideoTier(tiers, { resolution: shape.resolution }))) : raw;
    const usable = tierShapes?.length ? tierShapes : raw;
    const version = `${capability.version}:managed-shape-v1:${JSON.stringify([limits?.shapeQuoteId ?? null, currentQuote ?? null, limits?.inputImagePriceMicros ?? 0, offering.price?.videoInputImageEachMicros ?? 0, limits?.provenShapeGroups ?? limits?.provenShapes ?? null,
        ...(tiers?.kind === 'video' ? [tiers.requestTier ?? null, tiers.billedTierId ?? null] : [])])}`;
    if (reason) return { ...capability, modes: [], defaultMode: undefined, status: capability.status === 'available' ? 'unknown' : capability.status,
        version, sources: [...capability.sources, reason] };
    const modes = capability.modes.flatMap(mode => {
        const firstFrame = mode.mode === 'imageToVideo' || mode.mode === 'firstLastFrame';
        const lastFrame = mode.mode === 'firstLastFrame';
        const shapes = usable!.filter(shape => shape.firstFrame === firstFrame && shape.lastFrame === lastFrame
            && shape.referenceImages <= (mode.referenceRules?.image?.supported ? mode.referenceRules.image.maxCount : 0)
            && (mode.mode !== 'referenceToVideo' || shape.referenceImages > 0));
        const variants = (mode.outputVariants ?? []).flatMap(variant => {
            const followsImage = variant.aspectRatios?.includes('auto') && Boolean(policy.videoAutoAspect
                && (firstFrame ? policy.videoAutoAspect.firstFrame : policy.videoAutoAspect.referenceImage && mode.referenceRules?.image?.supported));
            const eligible = shapes.filter(shape => shape.resolution.toLowerCase() === variant.resolution.toLowerCase()
                && (variant.durationOverride ?? mode.duration) && isCanvasDurationValid((variant.durationOverride ?? mode.duration)!, shape.durationSeconds)
                && (!variant.aspectRatios?.length || variant.aspectRatios.includes(shape.aspectRatio) || followsImage));
            const audioChoices = new Set(eligible.map(shape => shape.requestAudio));
            const audioGeneration = audioChoices.size > 1 ? { mode: 'optional' as const, defaultEnabled: true }
                : audioChoices.has(true) ? { mode: 'required' as const, defaultEnabled: true } : { mode: 'unsupported' as const, defaultEnabled: false };
            const provenAspects = [...new Set(eligible.map(shape => shape.aspectRatio))];
            if (!provenAspects.length) return [];
            const aspects = followsImage ? [...provenAspects, 'auto'] : provenAspects;
            return [{ ...variant, aspectRatios: aspects, defaultAspectRatio: aspects.includes(variant.defaultAspectRatio ?? '') ? variant.defaultAspectRatio : aspects[0],
                durationOverride: durationRule(eligible.map(shape => shape.durationSeconds))!, audioGenerationOverride: audioGeneration,
                requestAudioOverride: audioChoices.size === 1 ? audioChoices.has(true) : undefined,
                requestShapes: eligible.map(({ resolution: _resolution, ...shape }) => shape),
                ...(followsImage ? { derivedAspectRatio: { inputRole: firstFrame ? 'firstFrame' as const : 'referenceImage' as const,
                    aspectRatios: provenAspects.filter(ratio => policy.videoAutoAspect!.aspectRatios.includes(ratio)), tolerance: 0.02, allowOmission: false } } : {}) }];
        });
        if (!variants.length) return [];
        const maxImages = Math.max(...variants.flatMap(variant => variant.requestShapes.map(shape => shape.referenceImages)));
        const imageRule = mode.referenceRules?.image;
        const referenceRules = { ...mode.referenceRules, image: imageRule?.supported && maxImages > 0
            ? { ...imageRule, maxCount: Math.min(imageRule.maxCount, maxImages) } : { supported: false, maxCount: 0 } };
        const combinations = mode.combinationConstraints?.flatMap(constraint => constraint.combination.includes('image')
            ? maxImages > 0 ? [{ ...constraint, maxImages: Math.min(constraint.maxImages ?? Infinity, maxImages) }] : [] : [constraint]);
        const modeAudioChoices = new Set(variants.flatMap(variant => variant.requestShapes.map(shape => shape.requestAudio)));
        const audioGeneration = modeAudioChoices.size > 1 ? { mode: 'optional' as const, defaultEnabled: true }
            : modeAudioChoices.has(true) ? { mode: 'required' as const, defaultEnabled: true } : { mode: 'unsupported' as const, defaultEnabled: false };
        return [{ ...mode, audioGeneration, outputVariants: variants, referenceRules, ...(combinations ? { combinationConstraints: combinations } : {}),
            defaultResolution: variants.some(variant => variant.resolution === mode.defaultResolution) ? mode.defaultResolution : variants[0].resolution }];
    });
    return { ...capability, modes, defaultMode: modes.some(mode => mode.mode === capability.defaultMode) ? capability.defaultMode : modes[0]?.mode,
        status: capability.status === 'available' && !modes.length ? 'unknown' : capability.status, version,
        sources: [...capability.sources, `${field}:complete-current-quote`, ...(!modes.length ? [`${field}:no-effective-mode`] : [])] };
}

function durationRule(seconds: readonly number[]): CanvasDurationRule | undefined {
    const values = [...new Set(seconds.filter(value => Number.isSafeInteger(value) && value > 0 && value <= 300))];
    return values.length === 1 ? { kind: 'fixed', seconds: values[0] } : values.length ? { kind: 'enum', seconds: values, defaultSeconds: values[0] } : undefined;
}

/** The old desk uses these exact listing limits and guide restrictions when fitting a request. */
function withAdapterModes(capability: CanvasModelCapability, policy: CanvasAdapterPolicy, explicitlyDeclared: boolean,
    facts?: DesktopVideoModelFacts, limits?: CanvasModelCapabilityEvidence['videoLimits']): CanvasModelCapability {
    const guide = facts ?? videoModelGuide(capability.providerModelId);
    const durations = limits?.durations?.length ? limits.durations : facts?.clipSeconds?.length ? facts.clipSeconds : guide.clipSeconds;
    const resolutions = limits?.resolutions?.length ? limits.resolutions : facts?.resolutions;
    const ratios = limits?.aspectRatios?.length ? limits.aspectRatios : policy.videoAspectRatios ?? (facts?.aspectRatios?.length ? facts.aspectRatios : videoModelProfile(capability.providerModelId)?.aspectRatios);
    const generated = policy.modes.map((name): CanvasModeCapability | undefined => {
        const previous = capability.modes.find(mode => mode.mode === name);
        if (explicitlyDeclared && !previous) return undefined;
        const image = name === 'textToImage' || name === 'imageToImage';
        const frames = name === 'imageToVideo' || name === 'firstLastFrame';
        // OpenRouter keeps the distinct text/reference modes: Veo references have a different duration contract.
        const maxImages = frames && !policy.framesWithImageReferences || name === 'textToVideo' && policy.durationsWithImageReferences?.length ? 0 : policy.maxImageReferences;
        const referenceRules = { image: { supported: maxImages > 0, maxCount: maxImages },
            ...(!policy.referenceVideos ? { video: { supported: false, maxCount: 0 } } : {}),
            ...(!policy.referenceAudios ? { audio: { supported: false, maxCount: 0 } } : {}) };
        const duration = durationRule(policy.durations?.length ? policy.durations : plannedClipSeconds(guide, durations, { withReferences: name === 'referenceToVideo' }));
        const outputVariants = (policy.adapter === 'template' || explicitlyDeclared ? previous?.outputVariants : undefined) ?? (image && policy.imageOutputVariants?.length
            ? policy.imageOutputVariants : image && policy.imageAspectRatios?.length
            ? [{ id: 'provider-default', resolution: 'auto', aspectRatios: policy.imageAspectRatios, defaultAspectRatio: '1:1' }]
            : !image && resolutions?.length ? resolutions.map(resolution => {
                const highRes = /^(?:1080p|[124]k)$/iu.test(resolution);
                const narrowed = durationRule(plannedClipSeconds(guide, durations, { withReferences: name === 'referenceToVideo', highRes }));
                return { id: resolution, resolution, ...(ratios?.length ? { aspectRatios: ratios } : {}), ...(narrowed ? { durationOverride: narrowed } : {}) };
            }) : !image && policy.videoAutoOutput ? [{ id: 'provider-default', resolution: policy.videoAutoOutput.resolution,
                aspectRatios: policy.videoAutoOutput.aspectRatios }] : undefined);
        const frozenDimensions = (image && policy.imageAspectRatios?.length || !image && policy.videoAutoOutput) && outputVariants?.some(variant => variant.resolution === 'auto')
            ? (['width', 'height'] as const).filter(key => !(previous?.parameters ?? []).some(parameter => parameter.key === key))
                .map(key => ({ key, type: 'number' as const, min: 64, max: 4096, step: 1 })) : [];
        if (explicitlyDeclared && previous) {
            // Configuration may narrow transport limits, but it cannot grant inputs the adapter does not write.
            const declaredCount = previous.referenceRules?.image?.maxCount;
            const videoUnsupported = previous.referenceRules?.video?.supported && !policy.referenceVideos;
            const audioUnsupported = previous.referenceRules?.audio?.supported && !policy.referenceAudios;
            const imageOverLimit = declaredCount !== undefined && declaredCount > maxImages;
            const combinations = previous.combinationConstraints?.filter(constraint => !(videoUnsupported && constraint.combination.includes('video'))
                && !(audioUnsupported && constraint.combination.includes('audio')) && !(maxImages === 0 && constraint.combination.includes('image')));
            return { ...previous,
                ...(!image && policy.videoAutoOutput && !previous.outputVariants?.length && outputVariants
                    ? { outputVariants, defaultResolution: outputVariants[0].resolution } : {}),
                ...(!image && policy.videoAutoOutput && !previous.duration && duration ? { duration } : {}),
                ...(frozenDimensions.length ? { parameters: [...(previous.parameters ?? []), ...frozenDimensions] } : {}),
                ...(!image && policy.audioGeneration?.mode === 'required' && previous.outputVariants?.some(variant => variant.audioGenerationOverride)
                    ? { outputVariants: previous.outputVariants.map(variant => variant.audioGenerationOverride ? { ...variant, audioGenerationOverride: policy.audioGeneration } : variant) } : {}),
                ...(previous.firstFrame === true && !policy.firstFrameField ? { firstFrame: false } : {}),
                ...(previous.lastFrame === true && !policy.lastFrame ? { lastFrame: false } : {}),
                ...(!image && policy.audioGeneration && policy.audioGeneration.mode !== 'optional' ? { audioGeneration: policy.audioGeneration } : {}),
                ...(imageOverLimit || videoUnsupported || audioUnsupported ? { referenceRules: { ...previous.referenceRules,
                    ...(imageOverLimit ? { image: referenceRules.image } : {}), ...(videoUnsupported ? { video: referenceRules.video } : {}), ...(audioUnsupported ? { audio: referenceRules.audio } : {}) } } : {}),
                ...(previous.preserveInputAudio && !policy.preserveOriginalAudio ? { preserveInputAudio: false } : {}),
                ...(previous.audioDrivenVideo && !policy.referenceAudios ? { audioDrivenVideo: false } : {}),
                ...(combinations && (combinations.length !== previous.combinationConstraints?.length) ? { combinationConstraints: combinations } : {}) };
        }
        return { ...previous, mode: name, ...(outputVariants ? { outputVariants, defaultResolution: outputVariants[0].resolution } : {}),
            ...(!image ? { ...(previous?.duration ?? duration ? { duration: previous?.duration ?? duration } : {}), audioGeneration: policy.audioGeneration } : {}),
            firstFrame: frames && Boolean(policy.firstFrameField), lastFrame: name === 'firstLastFrame' && policy.lastFrame,
            referenceRules, combinationConstraints: maxImages ? [{ combination: 'image' as const, maxImages }] : [],
            parameters: [...(previous?.parameters ?? []),
                ...(!(previous?.parameters ?? []).some(parameter => parameter.key === 'negativePrompt') ? [{ key: 'negativePrompt', type: 'string' as const }] : []),
                ...frozenDimensions,
                // Image output quality priced per tier (GPT Image low/medium/high): the selected value picks the billed tier.
                ...(image && policy.imageQualities?.length && !(previous?.parameters ?? []).some(parameter => parameter.key === 'quality')
                    ? [{ key: 'quality', type: 'string' as const, values: policy.imageQualities, defaultValue: policy.defaultImageQuality ?? policy.imageQualities[0] }] : []),
                ...(!image ? [{ key: 'requestSubtitles', type: 'boolean' as const, values: policy.subtitles === 'unsupported' ? [false] : policy.subtitles === 'required' ? [true] : [false, true] }] : [])],
            preserveInputAudio: policy.preserveOriginalAudio, audioDrivenVideo: policy.referenceAudios };
    }).filter((mode): mode is CanvasModeCapability => mode !== undefined);
    const modes = explicitlyDeclared ? capability.modes.flatMap(mode => {
        const supported = generated.find(candidate => candidate.mode === mode.mode); return supported ? [supported] : [];
    }) : generated;
    const defaultMode = capability.defaultMode && modes.some(mode => mode.mode === capability.defaultMode) ? capability.defaultMode : modes[0]?.mode;
    return { ...capability, modes, defaultMode,
        version: !explicitlyDeclared || facts ? `${capability.version}:adapter-v2:${JSON.stringify([policy, facts ?? null, limits ?? null])}` : capability.version,
        sources: [...capability.sources, 'desktop/canvas-adapter-policy', ...(facts ? [`desktop/getVideoModelFacts:${facts.source}`] : [])] };
}
