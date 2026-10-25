import { resolveCanvasCapability, type CanvasModeCapability, type CanvasModelCapability } from './canvas-capabilities.js';
import { canvasRegistryFamily, listCanvasRegistryModels, type CanvasRegistryModel } from './canvas-model-registry.js';

/** Structural form of the desktop widget's existing route choices. The hint is the effective registry ∩ route capability. */
export interface CanvasRegistryRoute {
  readonly key: string;
  readonly connectionId: string;
  readonly modelId: string;
  readonly kind: 'image' | 'video';
  readonly source: string;
  readonly capabilityHint?: CanvasModelCapability;
}

export interface CanvasRegistryAvailabilityReason {
  readonly code: 'NO_ROUTE' | 'CAPABILITY_UNKNOWN' | 'MODEL_UNAVAILABLE' | 'NO_EXECUTABLE_MODE';
  readonly message: string;
  readonly sources?: readonly string[];
}

export interface CanvasRegistryAvailability {
  readonly available: boolean;
  readonly unavailableReason?: CanvasRegistryAvailabilityReason;
}

export type CanvasRegistryRouteChoice<T extends CanvasRegistryRoute = CanvasRegistryRoute> = T & CanvasRegistryAvailability;

/** Configured models have route facts, but do not acquire a fixed-spec snapshot. */
export type CanvasRegistryRouteFamily = Omit<CanvasRegistryModel, 'raw'> & { readonly raw?: CanvasRegistryModel['raw'] };

export interface CanvasRegistryRouteGroup<T extends CanvasRegistryRoute = CanvasRegistryRoute> extends CanvasRegistryAvailability {
  readonly family: CanvasRegistryRouteFamily;
  /** Keep disabled candidates so the picker can explain the route's restriction. */
  readonly routes: readonly CanvasRegistryRouteChoice<T>[];
}

function supportsReference(mode: CanvasModeCapability, kind: 'image' | 'video' | 'audio'): boolean {
  const rule = mode.referenceRules?.[kind];
  return rule?.supported === true && Number.isSafeInteger(rule.maxCount) && rule.maxCount > 0;
}

function acceptsRequiredInputs(mode: CanvasModeCapability): boolean {
  switch (mode.mode) {
    case 'imageToVideo': return mode.firstFrame === true;
    case 'firstLastFrame': return mode.firstFrame === true && mode.lastFrame === true;
    case 'imageToImage': return supportsReference(mode, 'image') && Boolean(mode.combinationConstraints?.some(constraint => constraint.combination === 'image' && (constraint.maxImages === undefined || constraint.maxImages > 0)));
    case 'videoEdit':
    case 'videoExtend': return supportsReference(mode, 'video') && Boolean(mode.combinationConstraints?.some(constraint => constraint.combination === 'video' && (constraint.maxVideos === undefined || constraint.maxVideos > 0)));
    case 'referenceToVideo': return Boolean(mode.combinationConstraints?.some(constraint => {
      if (constraint.combination === 'none') return false;
      return constraint.combination.split('+').every(kind => {
        const referenceKind = kind as 'image' | 'video' | 'audio';
        const maximum = referenceKind === 'image' ? constraint.maxImages : referenceKind === 'video' ? constraint.maxVideos : constraint.maxAudios;
        return supportsReference(mode, referenceKind) && (maximum === undefined || maximum > 0);
      });
    }));
    default: return true;
  }
}

/** Missing facts remain disabled until the desktop supplies its effective capability; identity alone grants no availability. */
export function canvasRegistryRouteAvailability(route: CanvasRegistryRoute): CanvasRegistryAvailability {
  const capability = route.capabilityHint;
  if (!capability) return { available: false, unavailableReason: { code: 'CAPABILITY_UNKNOWN', message: 'The route capability has not been verified.' } };
  if (capability.providerModelId !== route.modelId) return { available: false, unavailableReason: { code: 'CAPABILITY_UNKNOWN', message: 'The capability belongs to a different route model.', sources: capability.sources } };
  if (capability.status !== 'available') return { available: false, unavailableReason: { code: 'MODEL_UNAVAILABLE', message: `The route is ${capability.status}.`, sources: capability.sources } };
  const executable = capability.modes.some(mode => {
    if ((route.kind === 'image') !== (mode.mode === 'textToImage' || mode.mode === 'imageToImage')) return false;
    if (!acceptsRequiredInputs(mode)) return false;
    return mode.outputVariants?.some(variant => resolveCanvasCapability(capability, { mode: mode.mode, resolution: variant.resolution }).issues.length === 0);
  });
  return executable ? { available: true } : { available: false, unavailableReason: { code: 'NO_EXECUTABLE_MODE', message: 'The route has no verified mode with usable output options and required inputs.', sources: capability.sources } };
}

/** Fixed families keep their order; additional configured models require an executable capability. */
export function groupCanvasRegistryRoutes<T extends CanvasRegistryRoute>(kind: 'image' | 'video', routeList: readonly T[]): readonly CanvasRegistryRouteGroup<T>[] {
  const routesByFamily = new Map<string, CanvasRegistryRouteChoice<T>[]>();
  const configuredFamilies = new Map<string, CanvasRegistryRouteFamily>();
  const seen = new Set<string>();
  for (const route of routeList) {
    if (route.kind !== kind) continue;
    const family = canvasRegistryFamily(route.modelId);
    if (family && family.kind !== kind) continue;
    const availability = canvasRegistryRouteAvailability(route);
    // A bare directory ID, image input, or an unusable declaration grants no new model option.
    if (!family && !availability.available) continue;
    const identity = `${route.key}\0${route.connectionId}\0${route.modelId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const familyId = family?.id ?? `configured:${kind}:${route.modelId}`;
    if (!family && !configuredFamilies.has(familyId)) {
      const capability = route.capabilityHint!;
      configuredFamilies.set(familyId, { id: familyId, specId: route.modelId,
        displayName: capability.displayName || route.modelId, vendor: capability.providerId, kind,
        modes: capability.modes, sources: capability.sources, restrictions: [] });
    }
    const routes = routesByFamily.get(familyId) ?? [];
    routes.push({ ...route, ...availability });
    routesByFamily.set(familyId, routes);
  }
  return [...listCanvasRegistryModels(kind), ...configuredFamilies.values()].map(family => {
    const routes = routesByFamily.get(family.id) ?? [];
    const available = routes.some(route => route.available);
    return {
      family, routes, available,
      ...(available ? {} : { unavailableReason: routes[0]?.unavailableReason ?? { code: 'NO_ROUTE' as const, message: 'No configured route serves this model.' } })
    };
  });
}

export interface CanvasRegistryDefault<T extends CanvasRegistryRoute = CanvasRegistryRoute> {
  readonly selection: 'studio' | 'firstAvailable' | 'none';
  readonly family?: CanvasRegistryRouteFamily;
  readonly route?: CanvasRegistryRouteChoice<T>;
  readonly reason?: CanvasRegistryAvailabilityReason;
}

/** Use the executable studio route, then the first available family; never seed an unsupported model. */
export function chooseCanvasRegistryDefault<T extends CanvasRegistryRoute>(kind: 'image' | 'video', routeList: readonly T[], studioRoute?: string | Pick<CanvasRegistryRoute, 'key' | 'modelId'>): CanvasRegistryDefault<T> {
  const groups = groupCanvasRegistryRoutes(kind, routeList);
  for (const group of groups) {
    const route = group.routes.find(candidate => candidate.available && (typeof studioRoute === 'string'
      ? candidate.key === studioRoute
      : studioRoute !== undefined && candidate.key === studioRoute.key && candidate.modelId === studioRoute.modelId));
    if (route) return { selection: 'studio', family: group.family, route };
  }
  for (const group of groups) {
    const route = group.routes.find(candidate => candidate.available);
    if (route) return { selection: 'firstAvailable', family: group.family, route };
  }
  const candidate = groups.find(group => group.routes.length > 0);
  return { selection: 'none', reason: candidate?.unavailableReason ?? { code: 'NO_ROUTE', message: `No available ${kind} route serves a model in the fixed canvas registry.` } };
}
