import type { ModelContract, MusicReferenceCapability } from '@nextmux/model-runtime';
import type { ComicOrganizerService } from './nextmux-comic-organizer-protocol';
import type { ApplyComicCanvasTimelineEditsRequest, CanvasTimelineDocument, CanvasTimelineSummary, ComicCanvasTimelineEditResult, CreateComicCanvasTimelineRequest, RestoreComicCanvasTimelineRequest } from './nextmux-canvas-timeline-contracts';
import type { ReadableModelError } from '@nextmux/model-runtime/errors';
import type { VideoModelGuide } from './nextmux-video-model-guide';
import type { RunComicCanvasToolRequest } from './nextmux-canvas-tool-contracts';
import type { PersistentComicCanvasToolJob } from '../node/nextmux-canvas-tools-backend';
import type { CanvasModelToolOperation, CanvasModelToolRequest } from './nextmux-canvas-tool-contracts';
import type { CanvasModelToolRoutePlan } from './nextmux-canvas-model-tools';
import type { ComicDirectorCaptureResult, ComicDirectorModelImportResult, ImportComicDirectorModelRequest, SaveComicCanvasMarkedImageRequest, SaveComicDirectorCaptureRequest, BeginComicDirectorUploadRequest, AppendComicDirectorUploadRequest, ComicDirectorUploadState } from './nextmux-director-contracts';
import type { DesktopComputerCapability, DesktopComputerToolRequest, DesktopComputerToolResult } from './nextmux-computer-automation';
import type {
    AgentCheckpointDiff,
    AgentFileVersion,
    AgentChildReceipt,
    AgentCouncilRoleId,
    AgentCouncilRouteSource,
    AgentDelegationLedger,
    AgentMessageAttachment,
    AgentModelMessage,
    ManagedPriceUpdate,
    AgentOutputAsset,
    AgentOutputPart,
    AgentPermissionMode,
    AgentReasoningEffort,
    AgentRunEvent,
    AgentRunStatus,
    AgentRunStopReason,
    AgentSteeringMessage,
    AgentUserQuestion,
    AgentUserQuestionAnswer,
    AgentTaskContext,
    AgentTokenBudget,
    AgentTokenBudgetSnapshot,
    AgentToolDescriptor
} from '@nextmux/agent-runtime';
import type { EditorDraftRecoveryAck, EditorDraftRecoveryDiscardRequest, EditorDraftRecoveryOpenResult, EditorDraftRecoveryRequest, EditorDraftRecoverySaveRequest, EditorDraftRecoveryState } from './nextmux-editor-draft-recovery';
import type { EditorDraftSaveAsRequest, EditorDraftSaveAsResult } from './nextmux-editor-save-as';
import type { CanvasDownloadResult, CanvasDownloadScope, ExportCanvasDownloadRequest } from './nextmux-canvas-download';
import type { FileHistoryEntry, FileHistoryRecordRequest, FileHistoryVersion } from './nextmux-file-history';
import type { PublicMerchantDirectoryPage, PublicMerchantDirectoryQuery, PublicMerchantIdentity, PublicMerchantStoreProfile } from './nextmux-public-merchants';
import type { PublicMerchantCapacityScope, PublicMerchantCapacitySnapshot } from './nextmux-relay-capacity';
import type { PublicPriceDetails } from './nextmux-public-price-details';
import type {
    CanvasDocument,
    CanvasAssetVersion,
    CanvasPoint,
    GenerationSnapshot,
    CanvasModeCapability,
    CanvasModelCapability,
    CanvasGenerationMode,
    ComicCanvas,
    ComicCommand,
    ComicEditorEdit,
    ComicFrameRate,
    ComicProject,
    ComicProductionDocument
} from '@nextmux/comic-core';
import type {
    EnqueueMediaJobRequest,
    MediaJob,
    MediaSubtitleCueInput
} from '@nextmux/media-core';
import type {
    DiscoveredOfficialModel,
    ModelCapabilityEvidence,
    OfficialProviderId,
    OfficialProviderPreset,
    OfficialProviderProtocol,
    OfficialProviderSettings
} from '@nextmux/model-runtime';

export const NextMuxPlatformServicePath = '/services/nextmux-platform';
export const NextMuxPlatformService = Symbol('NextMuxPlatformService');

/**
 * A small, explicit bridge between the backend Agent runtime and the browser
 * drawer owned by the renderer.  Browser commands are deliberately
 * structured; arbitrary JavaScript is never sent through this interface.
 */
export type DesktopBrowserToolAction =
    | 'list' | 'open' | 'open_external' | 'activate' | 'close' | 'navigate'
    | 'back' | 'forward' | 'reload' | 'snapshot' | 'click' | 'fill' | 'select' | 'upload' | 'drag'
    /** App settings the renderer owns: add or list MCP servers, or read/write conversation sticky notes for the model (nextmux-app-tools.ts). */
    | 'app_mcp_add' | 'app_note_read' | 'app_note_write';

export interface DesktopBrowserToolRequest {
    readonly id: string;
    readonly conversationId: string;
    readonly workspaceRoot?: string;
    /** Queue deadline; a renderer must not begin an expired side effect. */
    readonly expiresAt?: number;
    readonly action: DesktopBrowserToolAction;
    readonly mcpServer?: { readonly name: string; readonly configuration: { readonly command: string; readonly args: readonly string[] } | { readonly serverUrl: string } };
    readonly noteWrite?: {
        readonly mode?: 'append' | 'replace';
        readonly text?: string;
        readonly images?: readonly { readonly path?: string; readonly dataUrl?: string; readonly name?: string; readonly mimeType?: string }[];
    };
    readonly browserId?: string;
    readonly url?: string;
    /** browser.open follows the saved user choice unless this call explicitly selects a destination. */
    readonly destination?: 'default' | 'builtin-browser' | 'system-browser';
    readonly selector?: string;
    /** Opaque element reference returned by the latest snapshot of this exact tab. */
    readonly ref?: string;
    readonly timeoutMs?: number;
    readonly text?: string;
    readonly frameId?: string;
    readonly values?: readonly string[];
    readonly paths?: readonly string[];
    readonly targetRef?: string;
    readonly targetSelector?: string;
    readonly targetFrameId?: string;
}

export interface DesktopBrowserToolResult {
    readonly code?: string;
    readonly params?: Readonly<Record<string, string | number | boolean | undefined>>;
    readonly requestId: string;
    readonly ok: boolean;
    readonly message?: string;
    readonly data?: unknown;
}

export type EvidenceConfidence = 'low' | 'medium' | 'high' | 'very_high';

/** Music reference modes use explicit scoped declarations in DesktopModelContract. */
export type DesktopMusicReferenceCapability = MusicReferenceCapability;

/** Route, model, and transport declarations retain independent provenance. */
export interface DesktopModelContract extends ModelContract {
    /** Display task membership; execution still requires the selected route's contract. */
    readonly taskCategories?: readonly string[];
    /** Public model taxonomy, retained for category-specific desktop pickers. */
    readonly kind?: string;
    readonly modelCapabilityDeclarations?: ModelContract['capabilityDeclarations'];
    readonly routeCapabilityDeclarations?: ModelContract['capabilityDeclarations'];
    readonly transportCapabilityDeclarations?: ModelContract['capabilityDeclarations'];
    readonly modelModalityLimits?: ModelContract['modalityLimits'];
    readonly routeModalityLimits?: ModelContract['modalityLimits'];
    readonly maxInputTokens?: number | null;
}

/** Per-unit prices by dimension (null = not priced), shared by an offering's user price and official price. */
export interface OfferingPriceDimensions {
    readonly currency: string;
    readonly inputPerMillionMicros: number | null;
    readonly outputPerMillionMicros: number | null;
    readonly cachedInputPerMillionMicros: number | null;
    readonly cacheWritePerMillionMicros?: number | null;
    readonly imageEachMicros: number | null;
    readonly requestEachMicros?: number | null;
    readonly videoSecondMicros: number | null;
    /** Per input picture used by a video request; absent in legacy quotes. */
    readonly videoInputImageEachMicros?: number | null;
    readonly audioPerMillionCharactersMicros: number | null;
    readonly imageOutputPerMillionMicros?: number | null;
    readonly audioSecondMicros?: number | null;
}

export interface PlatformOffering extends PublicMerchantStoreProfile, DesktopModelContract {
    /** Hosted research proved for this exact connection/model; unknown never grants permission. */
    readonly nativeWebResearch?: {
        readonly profile: import('@nextmux/model-runtime').NativeWebResearchProfile;
        readonly search: import('@nextmux/model-runtime').NativeWebResearchSupport;
        readonly fetch: import('@nextmux/model-runtime').NativeWebResearchSupport;
        readonly boundedSearch: boolean;
        readonly searchEngine?: 'parallel';
        readonly searchMode?: 'basic' | 'turbo';
        readonly source: 'provider_metadata' | 'live_probe' | 'merchant_declaration';
        readonly reasonCode?: string;
    };
    /** Verified per-mode adapter metadata; omitted fields remain unknown to canvas submission. */
    readonly canvasCapabilities?: { readonly providerModelId: string; readonly version: string; readonly modes: readonly CanvasModeCapability[]; readonly defaultMode?: CanvasGenerationMode };
    readonly available?: boolean;
    readonly unavailableReason?: string;
    /** Maximum request the eligible credential pool can admit; null means no declared cap. */
    readonly credentialCapacity?: { readonly maximumRequestTokens: number | null };
    readonly managedTransport?: {
        readonly protocol: string;
        readonly orderedMediaReplay: boolean;
        readonly orderedMediaReplayModalities?: readonly string[];
        readonly fileInputMimeTypes?: readonly string[];
        readonly audioInputMimeTypes?: readonly string[];
        readonly videoInputMimeTypes?: readonly string[];
    };
    readonly inputRestrictions?: readonly { readonly modality: string; readonly reason: string }[];
    /** Whether this route can accept the desktop's baseline coding request. */
    readonly codingAvailability?: {
        readonly available: boolean;
        readonly unavailableReason?: string;
        readonly minimumInputTokens: number;
        readonly maximumOutputTokens: number;
    };
    /** Thinking options this API proved (`verified`/`accepted`) or refused (`rejected`) in real requests, by option key. */
    readonly reasoningEvidence?: Readonly<Record<string, 'verified' | 'accepted' | 'rejected'>>;
    /** Capacity measured or declared by this exact merchant route.  It is
     * intentionally separate from registry contextTokens: a registry value
     * must never make an API with unknown limits look capable. */
    readonly routeContextTokens?: number;
    readonly routeInputTokens?: number;
    readonly routeMaximumOutputTokens?: number;
    readonly contextTokens?: number;
    readonly inputTokens?: number;
    readonly maximumOutputTokens?: number;
    /** Exact route-declared choices; absence must not be inferred from the model name. */
    readonly reasoningEfforts?: readonly AgentReasoningEffort[];
    readonly pricingDetails?: PublicPriceDetails;
    readonly id: string;
    readonly keyPriceQuoteId?: string;
    readonly keyPrice?: {
        readonly pricingMode: 'official_key_multiplier' | 'direct';
        readonly minimumMultiplierBps: number | null;
        readonly maximumMultiplierBps: number | null;
        readonly selectedMultiplierBps: number | null;
        readonly quoteRequired: true;
    };
    /** Stable platform identity. Empty only when normalizing a legacy catalog. */
    readonly merchantId?: string;
    readonly providerName: string;
    readonly recommendedRank?: number;
    /** Place in the global list (frontier models first, then new releases, then established rank); lower is first. */
    readonly catalogRank?: number;
    /** Position on the platform's frontier list (null: not a frontier model). */
    readonly frontierPosition?: number | null;
    /** When the model was released or first listed (ISO). */
    readonly releasedAt?: string | null;
    readonly recommended?: boolean;
    readonly merchantTrustScore?: number;
    readonly likes?: number;
    readonly dislikes?: number;
    readonly endpointName: string;
    readonly modelFamily: string;
    readonly displayName: string;
    readonly providerModelCode: string;
    readonly category: 'coding' | 'text' | 'reasoning' | 'image' | 'video' | 'audio' | 'embedding' | 'other';
    readonly registryModelId: string;
    readonly canonicalModel: string;
    readonly sourceType: 'verified_relay' | 'unverified_relay';
    readonly status: 'active' | 'unavailable' | 'suspended';
    readonly region: string;
    readonly capabilities: readonly string[];
    readonly input: readonly string[];
    readonly output: readonly string[];
    readonly workbenches: readonly string[];
    /** Speech models: the voices the provider takes, the default first (absent when the provider does not list them). */
    readonly voices?: readonly string[];
    /** Public media adapter contract, used before offering a step that sends pictures. */
    readonly mediaInput?: {
        readonly firstFrame?: boolean;
        readonly lastFrame?: boolean;
        readonly referenceImages?: boolean;
        readonly maxReferences?: number;
    };
    /** Exact successful-image SKU supplied by this accepted public key quote. */
    readonly imageLimits?: {
        readonly count: 1;
        readonly dimensions: readonly { readonly width: number; readonly height: number; readonly resolution: string; readonly aspectRatio: string }[];
        readonly sequentialGeneration: false;
        readonly shapeQuoteId: string;
        readonly nativeProtocol: 'byteplus_seedream45_v1';
    };
    readonly videoLimits?: {
        readonly durations?: readonly number[];
        readonly aspectRatios?: readonly string[];
        readonly resolutions?: readonly string[];
        readonly frameImages?: readonly string[];
        /** Exact request shapes proved against the selected public key quote. Flat model limits are not hold evidence. */
        readonly provenShapes?: readonly import('@nextmux/comic-core').CanvasProvenVideoRequestShape[];
        /** Bounded rules over explicit output/duration dictionaries; bound to the same shapeQuoteId. */
        readonly provenShapeGroups?: import('@nextmux/comic-core').CanvasProvenVideoShapeGroups;
        readonly shapeQuoteId?: string;
        /** Per-image hold component proved by this exact shapeQuoteId. */
        readonly inputImagePriceMicros?: number;
    };
    /** The merchant API this offering runs on: one model on two APIs of a merchant is two offerings (absent from older platform versions). */
    readonly apiId?: string;
    /**
     * What users pay per unit (official × multiplier, or the merchant's own rates when `price.mode` is 'direct').
     * Micros per 1M tokens / characters, per image, per second, per request.
     */
    readonly price: {
        readonly currency: string;
        readonly mode: 'reference_multiplier' | 'direct';
        /** Null for a merchant-set price: the multiplier does not apply. */
        readonly multiplierBps: number | null;
        readonly inputPerMillionMicros: number | null;
        readonly outputPerMillionMicros: number | null;
        readonly cachedInputPerMillionMicros: number | null;
        readonly cacheWritePerMillionMicros?: number | null;
        readonly imageEachMicros: number | null;
        /** Music: one generated track per request (absent from older platform versions). */
        readonly requestEachMicros?: number | null;
        readonly videoSecondMicros: number | null;
        /** Each submitted first frame, last frame or reference image. */
        readonly videoInputImageEachMicros?: number | null;
        readonly audioPerMillionCharactersMicros: number | null;
        /** Pictures a chat model answers with, per million picture tokens (absent from older platform versions). */
        readonly imageOutputPerMillionMicros?: number | null;
        /** Speech-to-text per audio second (absent from older platform versions). */
        readonly audioSecondMicros?: number | null;
        /** Multi-tier image/video prices (contract v1); validate with normalizeOfferingMediaTiers before use. */
        readonly mediaTiers?: unknown;
    };
    /** The model's official price in the same units as `price`; null when there is none (a merchant's own model). */
    readonly officialPrice?: OfferingPriceDimensions | null;
    readonly routeScore: number;
    /** Null for a merchant-set price (older platform versions always sent a number). */
    readonly multiplierBps: number | null;
    readonly fidelity: {
        readonly index: number;
        readonly confidence: EvidenceConfidence;
        readonly sampleCount: number;
    };
    readonly agentReadiness: {
        readonly index: number;
        readonly level: string;
    };
    readonly network: {
        readonly availability: number;
        /** Null until a real latency distribution is available; never the latest sample. */
        readonly p95LatencyMs: number | null;
        readonly lastLatencyMs?: number | null;
        readonly sampleCount?: number;
        readonly state: string;
    };
    readonly privacy: {
        readonly zeroDataRetention: boolean;
        readonly dataCollection: boolean;
        /** What the gateway can guarantee under the strict desktop settings (absent from older catalogs: unknown). */
        readonly meetsZeroDataRetention?: boolean;
        readonly meetsDenyDataCollection?: boolean;
    };
}

export interface PlatformCatalog {
    readonly online: boolean;
    readonly offerings: readonly PlatformOffering[];
    readonly measuredAt?: string;
    readonly message?: string;
    /** The global list continues (it comes frontier models first, in slices): pass this to getCatalogPage. */
    readonly nextCursor?: string;
}

export interface PlatformMerchantCatalogPage extends PlatformCatalog {
    readonly merchantId: string;
    readonly nextCursor?: string;
    /**
     * The merchant has an available production key whose model discovery is
     * still pending (or stale for the current endpoint/key revision).  This
     * is deliberately optional for compatibility with older Workers.
     */
    readonly discoveryPending?: boolean;
}

/** Public browsing only. Never use these cached display prices to authorize an execution. */
export interface PlatformMerchantSupportQuery {
    readonly search?: string;
    readonly category?: 'all' | 'language' | 'image' | 'video' | 'audio' | 'others';
    readonly after?: string;
}

export interface PlatformMerchantSupportCatalogPage extends PlatformMerchantCatalogPage {
    readonly displayOnly: true;
    readonly snapshotVersion: string;
    /** Offering count, before the UI combines identical model/price rows. */
    readonly matchedOfferingCount: number;
}

/** Authenticated model-list evidence, not authorization or a customer quote. */
export interface PlatformMerchantDiscoveredModel extends DesktopModelContract {
    readonly contextTokens?: number;
    readonly inputTokens?: number;
    readonly maximumOutputTokens?: number;
    readonly categories?: readonly string[];
    readonly execution?: { readonly state: 'executable' | 'unavailable'; readonly reason?: 'official_model_retired' | 'route_unavailable' | 'not_published'; readonly listingIds?: readonly string[] };
    readonly pricing?: readonly (PublicPriceDetails & { readonly listingId?: string })[];
    readonly id: string;
    readonly displayName: string;
    readonly canonicalModel?: string;
    readonly input: readonly string[];
    readonly output: readonly string[];
    readonly capabilities: readonly string[];
    readonly discoveredAt: number;
    readonly multiplierBps: number | null;
    readonly listingIds: readonly string[];
    /** Server-side model identity evidence; omitted means unknown. */
    readonly fidelity?: PlatformOffering['fidelity'];
}

export interface PlatformMerchantDiscoveredModelsPage extends PublicMerchantStoreProfile {
    readonly merchant?: PublicMerchantIdentity;
    readonly stats?: { readonly discoveredCount: number; readonly executableCount: number };
    readonly catalogMeasuredAt?: string;
    readonly merchantId: string;
    readonly models: readonly PlatformMerchantDiscoveredModel[];
    readonly state: 'ready' | 'pending' | 'unavailable';
    readonly reason?: 'no_active_endpoint' | 'no_available_key' | 'discovery_pending' | 'discovery_failed' | 'no_models';
    readonly nextCursor?: string;
    readonly measuredAt: string;
}

export interface PlatformRegistryModel extends DesktopModelContract {
    readonly id: string;
    readonly canonicalModel: string;
    readonly provider: string;
    readonly displayName: string;
    readonly family: string;
    readonly status: 'active' | 'preview' | 'deprecated' | string;
    readonly input: readonly string[];
    readonly output: readonly string[];
    readonly capabilities: readonly string[];
    readonly contextTokens: number | null;
    readonly maximumOutputTokens: number | null;
    readonly maxInputTokens?: number | null;
    readonly inputTokens?: number | null;
    readonly releaseDate: string;
    readonly knowledgeCutoff: string;
    readonly openWeights: boolean;
    readonly anonymous: boolean;
    readonly sourceName: string;
    /** Public directory aliases, never local API credentials or deployment names. */
    readonly aliases?: readonly string[];
    /** Server-computed defaults from public usage rankings; applied once on first setup. */
    readonly recommendedGroups?: readonly ('language' | 'media')[];
    /** The directory's published list price (USD per million tokens); a reference for own APIs, never managed billing. */
    readonly referencePrice?: {
        readonly currency: 'USD';
        readonly unit: 'per_million_tokens';
        readonly input: number;
        readonly output: number;
        readonly cachedInput?: number;
        readonly cacheWrite?: number;
        readonly above200k?: { readonly input: number; readonly output: number };
        /** Other positive charges the source declares (web_search, image …), by name only. */
        readonly extra?: readonly string[];
        readonly source: string;
    };
    readonly popularity?: {
        readonly rank: number;
        readonly requests: number;
        readonly period: 'week';
        readonly metric: 'requests';
        readonly throughDate: string;
        readonly sourceName: string;
        readonly sourceUrl: string;
        readonly attribution: string;
    };
}

export interface PlatformGlobalModelCatalog {
    readonly models: readonly PlatformRegistryModel[];
    readonly updatedAt: number;
    readonly stale?: boolean;
}

export interface PlatformWallet {
    /** Verified consumption still owed; separate from payment disputes. */
    readonly usageDebtMicros?: number;
    /** Verified cumulative usage reported by requests that have not finalized. */
    readonly usageInFlightMicros?: number;
    /** Actual funds including reservations, less verified consumption debt. */
    readonly netBalanceMicros?: number;
    readonly currency: string;
    readonly availableMicros: number;
    readonly reservedMicros: number;
    readonly lifetimeCreditedMicros: number;
    readonly lifetimeSpentMicros: number;
    readonly lifetimeRefundedMicros: number;
    readonly updatedAt: number;
}

export interface PlatformWalletTopup {
    readonly id: string;
    readonly status: 'payment_pending' | 'paid' | 'credited' | 'expired' | 'cancelled' | 'review' | 'refunded';
    readonly currency: string;
    readonly baseAmountMinor: number;
    readonly payableAmountMinor: number;
    readonly amountOffsetMinor: number;
    readonly creditAmountMinor: number;
    readonly creditCurrency: string;
    readonly creditAmountMicros: number;
    readonly conversionMarginBps: number;
    readonly expiresAt: number;
    readonly paidAt: number | null;
    readonly creditedAt: number | null;
    readonly createdAt: number;
    /** 'whop' for USD card checkout; legacy CNY orders are 'wechat'. */
    readonly provider?: 'whop' | 'wechat';
    /** Whop orders: processing fee and total charged (credit + fee), USD cents. */
    readonly feeAmountMinor?: number;
    readonly chargeAmountMinor?: number;
}

export interface PlatformWalletTopupPayment {
    readonly provider: string;
    readonly method: 'wechat_qr' | 'whop_checkout';
    readonly status: string;
    readonly qrUrl: string;
    /** Hosted Whop checkout (https://whop.com/...) while the order waits for payment. */
    readonly checkoutUrl?: string;
    readonly feeAmount?: {
        readonly currency: string;
        readonly minor: number;
    };
    readonly payableAmount: {
        readonly currency: string;
        readonly minor: number;
        readonly display: string;
    };
    readonly creditAmount: {
        readonly currency: string;
        readonly micros: number;
    };
    readonly expiresAt: number;
}

export interface PlatformWalletTopupOrder {
    readonly topup: PlatformWalletTopup;
    readonly payment: PlatformWalletTopupPayment;
}

/** GET /api/wallet/topup-options (whop-topups.js whopTopupTerms). Amounts are USD cents. */
export interface PlatformWalletTopupOptions {
    readonly available: boolean;
    readonly currency: 'USD';
    readonly minimumMinor: number;
    readonly maximumMinor: number;
    readonly presetsMinor: readonly number[];
    readonly customAmount: boolean;
    readonly fee: { readonly bps: number; readonly fixedMinor: number };
}

export interface PlatformWalletMovement {
    readonly id: string;
    readonly currency: string;
    readonly kind: 'topup' | 'reserve' | 'capture' | 'release' | 'refund' | 'adjustment';
    readonly referenceType: string;
    readonly referenceId: string;
    readonly availableDeltaMicros: number;
    readonly reservedDeltaMicros: number;
    readonly spentDeltaMicros: number;
    readonly createdAt: number;
}

export interface PlatformUsageRecord {
    readonly id: string;
    /** Stable marketplace identity. Empty for legacy or non-managed records. */
    readonly merchantId?: string;
    readonly workbench: string;
    readonly canonicalModel: string;
    readonly routeMode: string;
    readonly status: string;
    readonly recoveryState?: 'pending' | 'review' | 'available' | null;
    readonly reservedMicros?: number;
    readonly currency: string;
    readonly chargedMicros: number;
    readonly providerName: string;
    readonly modelName: string;
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly cacheWriteTokens: number;
    /** Whether the provider's input counter already includes cache reads/writes. Omitted when unknown. */
    readonly inputIncludesCached?: boolean;
    readonly outputTokens: number;
    readonly pricingMode: string;
    readonly referenceModel: string;
    readonly upstreamModel: string;
    readonly reportedModel: string;
    readonly meteringSource: string;
    readonly settlementMultiplierBps: number;
    readonly platformFeeBps: number;
    readonly retailMultiplierBps: number;
    readonly metrics: readonly {
        readonly metric: string;
        readonly quantity: number;
        readonly source: string;
        readonly customerAmountMicros: number;
        readonly merchantAmountMicros: number;
    }[];
    readonly failoverCount: number;
    readonly durationMs: number;
    readonly startedAt: number | null;
    readonly completedAt: number | null;
}

export interface PlatformAccountOverview {
    readonly wallets: readonly PlatformWallet[];
    readonly topups: readonly PlatformWalletTopup[];
    readonly movements: readonly PlatformWalletMovement[];
    readonly usage: readonly PlatformUsageRecord[];
    readonly refreshedAt: number;
}

export interface PlatformMerchantUsageQuery {
    /** Inclusive start and exclusive end, in Unix milliseconds. */
    readonly since?: number;
    readonly until?: number;
    /** Empty or omitted means all currencies. */
    readonly currency?: string;
    readonly cursor?: string;
    readonly limit?: number;
}

export type PlatformMerchantModelEvidence = 'self_reported_consistent' | 'self_reported_conflict' | 'insufficient';

export interface PlatformMerchantUsageSummary {
    /** Stable marketplace identity; empty only for legacy records with no committed route. */
    readonly merchantId: string;
    /** Current profile label. Historical immutable names predate the current schema. */
    readonly providerName: string;
    readonly currency: string;
    readonly requestCount: number;
    readonly completedCount: number;
    readonly failedCount: number;
    readonly otherCount: number;
    /** Amount actually charged to this user, in integer currency micros. */
    readonly chargedMicros: number;
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly cacheWriteTokens: number;
    /** Whether the aggregated input counter already includes cache reads/writes. Omitted when routes are mixed or unknown. */
    readonly inputIncludesCached?: boolean;
    readonly outputTokens: number;
    readonly failoverCount: number;
    /** End-to-end request duration, only for rows with both captured timestamps. */
    readonly averageDurationMs: number | null;
    readonly durationSampleCount: number;
    readonly modelMatchedCount: number;
    readonly modelMismatchedCount: number;
    readonly modelUnreportedCount: number;
    /** Comparison of upstream self-reported names, never independent model verification. */
    readonly modelEvidence: PlatformMerchantModelEvidence;
    readonly firstAt: number;
    readonly latestAt: number;
}

export interface PlatformMerchantUsagePage {
    readonly items: readonly PlatformMerchantUsageSummary[];
    readonly nextCursor?: string;
    readonly range: { readonly since: number; readonly until: number };
    readonly refreshedAt: number;
}

export interface PlatformUsageHistoryQuery {
    /** Inclusive start and exclusive end, in Unix milliseconds (at most 366 days). */
    readonly since: number;
    readonly until: number;
    readonly currency?: string;
    readonly cursor?: string;
    /** 1–100 records per page. */
    readonly limit?: number;
}

/** One platform-managed request (`/api/wallet/history?kind=usage`). Token fields are null when the provider did not report usage. */
export interface PlatformUsageHistoryRecord {
    readonly id: string;
    readonly canonicalModel: string;
    readonly modelName: string;
    readonly providerName: string;
    readonly status: string;
    readonly currency: string;
    readonly chargedMicros: number;
    readonly createdAt: number;
    readonly durationMs: number | null;
    readonly inputTokens: number | null;
    readonly cachedInputTokens: number | null;
    readonly cacheWriteTokens: number | null;
    readonly outputTokens: number | null;
    readonly inputIncludesCached: boolean | null;
    readonly attemptCount: number;
}

export interface PlatformUsageHistoryPage {
    readonly items: readonly PlatformUsageHistoryRecord[];
    readonly nextCursor?: string;
    readonly range: { readonly since: number; readonly until: number };
}

export interface PlatformDeviceSession {
    readonly linked: boolean;
    readonly deviceRoute?: { readonly token: string; readonly expiresAt: number };
    readonly device?: {
        readonly label?: string;
        readonly linkedAt?: number;
    };
    readonly user?: {
        readonly id: string;
        readonly email: string;
        readonly displayName: string;
        readonly locale: string;
    };
    readonly wallets: readonly PlatformWallet[];
}

export interface PlatformDeviceLink {
    readonly code: string;
    /** Stable client key used to make retries safe without storing the code in plaintext. */
    readonly requestId?: string;
    readonly verificationUrl: string;
    readonly expiresAt: number;
}

export interface ManagedGatewayResult {
    readonly pricingUpdate?: ManagedPriceUpdate;
    readonly call: {
        readonly id: string;
        readonly offeringId: string;
        readonly providerName: string;
        readonly modelFamily: string;
        readonly createdAt: string;
        readonly automaticRouting: boolean;
        readonly failoverCount: number;
        readonly requestedRegistryModelId?: string;
        readonly servedRegistryModelId?: string;
        readonly canonicalModel?: string;
        readonly policyRevision?: number;
    };
    readonly switchReceipt?: ModelSwitchReceipt;
    readonly response: {
        readonly content: string;
        readonly finishReason?: string;
        readonly citations?: readonly import('@nextmux/agent-runtime').ModelCitation[];
        readonly nativeWebResearchEvidence?: import('@nextmux/model-runtime').NativeWebResearchEvidence;
        readonly toolCalls: readonly {
            readonly id: string;
            readonly name: string;
            readonly arguments: unknown;
        }[];
        readonly model: string;
        readonly usage: {
            readonly inputTokens: number;
            readonly cachedInputTokens?: number;
            readonly cacheWriteTokens?: number;
            readonly outputTokens: number;
            readonly web_search?: number;
            readonly web_fetch?: number;
            /** False when the upstream omitted either billable token counter. */
            readonly usageKnown: boolean;
        };
        /** Provider context counters, when they differ from billable usage. */
        readonly contextUsageKnown?: boolean;
        readonly contextUsage?: { readonly inputTokens: number; readonly outputTokens: number };
        /** Bounded provider-owned context required by a later tool-result turn. */
        readonly providerState?: unknown;
        /** Ordered visible output. Media entries are immutable references, never inline bytes. */
        readonly outputParts?: readonly AgentOutputPart[];
        /** Short-lived, user-authenticated download receipts for every media output part. */
        readonly outputAssets?: readonly {
            readonly transfer?: 'stream-v2';
            readonly contentRetained?: false;
            readonly partId?: string;
            readonly extension?: string;
            readonly partIndex: number;
            readonly sha256: string;
            readonly mimeType: string;
            readonly sizeBytes: number;
            readonly downloadPath: string;
            readonly expiresAt: number;
        }[];
        readonly upstreamMetadata?: {
            readonly protocol: 'openrouter';
            readonly generationId?: string;
            readonly provider?: string;
            readonly region?: string;
            readonly serviceTier?: string;
            readonly costUsd?: number;
            readonly upstreamInferenceCostUsd?: number;
            readonly byok?: boolean;
        };
    };
    readonly billing: {
        readonly kind: 'platform';
        readonly currency: string;
        readonly chargedMicros: number;
    };
    readonly developmentOnly: boolean;
}

export type RelayFeedbackVote = 'up' | 'down' | null;

export interface PlatformRelayFeedback {
    readonly requestId: string;
    readonly merchantId: string;
    readonly vote: RelayFeedbackVote;
    readonly likes: number;
    readonly dislikes: number;
    readonly createdAt: number | null;
    readonly updatedAt: number | null;
}

export interface PlatformRelayFeedbackSubmission {
    readonly feedback: PlatformRelayFeedback;
    readonly idempotent: boolean;
}

export interface PlatformRelayFeedbackTarget {
    readonly merchantId: string;
    readonly providerName: string;
    readonly endpointId: string;
    readonly endpointName: string;
    readonly modelId: string;
    readonly modelName: string;
    readonly canonicalModel: string;
    readonly vote: RelayFeedbackVote;
    readonly likes: number;
    readonly dislikes: number;
    readonly requestCount: number;
    readonly attemptCount: number;
}

export interface PlatformRelayFeedbackMerchantAggregate {
    readonly merchantId: string;
    readonly providerName: string;
    readonly likes: number;
    readonly dislikes: number;
}

/** One user rating projected onto every attributable route used by an assistant reply. */
export interface PlatformRelayFeedbackBatch {
    readonly groupId: string | null;
    readonly requestIds: readonly string[];
    readonly vote: RelayFeedbackVote;
    readonly createdAt: number | null;
    readonly updatedAt: number | null;
    readonly targets: readonly PlatformRelayFeedbackTarget[];
    readonly aggregates: {
        readonly requestCount: number;
        readonly attemptCount: number;
        readonly targetCount: number;
        readonly merchantCount: number;
        readonly merchants: readonly PlatformRelayFeedbackMerchantAggregate[];
    };
}

export interface PlatformRelayFeedbackBatchSubmission {
    readonly feedback: PlatformRelayFeedbackBatch;
    readonly idempotent: boolean;
}

export interface ModelSwitchPolicy {
    readonly version: 1;
    readonly revision: number;
    readonly mode: 'same_model' | 'single_route' | 'same_model_relays' | 'allowlisted_models';
    readonly fallbackRegistryModelIds: readonly string[];
    readonly merchantScope: 'selected_merchant' | 'eligible_marketplace';
    readonly maxRequestChargeMicros?: number;
}

export interface ModelSwitchReceipt {
    readonly version: 1;
    readonly policyRevision: number;
    readonly fromRegistryModelId: string;
    readonly toRegistryModelId: string;
    readonly fromAttemptId?: string;
    readonly toAttemptId: string;
    readonly reason: 'pre_acceptance_failure' | 'capacity_unavailable' | 'primary_unavailable';
    readonly actualOfferingId: string;
    readonly contextViewHash: string;
    readonly privateStateReused: boolean;
}

export interface ManagedGatewayRequest {
    /** Hosted research is selected by the route's explicit protocol and frozen pricing contract. */
    readonly nativeWebResearch?: import('@nextmux/model-runtime').NativeWebResearchRequest;
    /** Same-request media dictionary; never a server-side persisted content reference. */
    readonly inlineMedia?: Readonly<Record<string, string>>;
    readonly switchPolicy?: ModelSwitchPolicy;
    /** The desktop can persist and render ordered media references when a compatible route returns them. */
    readonly acceptOrderedOutput?: true;
    readonly instructions?: string;
    readonly messages: readonly AgentModelMessage[];
    readonly tools: readonly AgentToolDescriptor[];
    readonly workbench: 'coding' | 'comic' | 'general';
    readonly conversationId: string;
    readonly requiredCapabilities?: readonly string[];
    readonly maximumOutputTokens?: number;
    readonly reasoningEffort?: AgentReasoningEffort;
    readonly reasoningBudgetTokens?: number;
    readonly reasoningEnabled?: boolean;
    readonly reasoningExclude?: boolean;
    readonly reasoningMode?: 'adaptive' | 'enabled' | 'disabled';
    readonly zeroDataRetention?: boolean;
    readonly dataCollection?: 'allow' | 'deny';
}

export type ManagedGatewayRoute =
    | {
        readonly mode: 'automatic';
        readonly registryModelId: string;
        readonly keyPriceQuoteId?: string;
    }
    | {
        readonly mode: 'fixed';
        readonly offeringId: string;
        readonly keyPriceQuoteId?: string;
    };

export interface PlatformFeedbackInput {
    readonly kind: 'bug' | 'suggestion' | 'partnership' | 'other';
    readonly message: string;
    readonly contact?: string;
    readonly locale?: string;
    readonly appVersion?: string;
}

export interface PlatformWebLinks {
    readonly account: string;
    readonly login: string;
}

export type OfficialToolCapability = 'verified' | 'failed' | 'untested';
export type OfficialModelDiscoveryStatus = 'verified' | 'catalog_discovered' | 'unsupported' | 'failed' | 'untested';
export type OfficialModelDiscoveryFailure = 'credentials_missing' | 'authentication_failed' | 'permission_denied'
    | 'endpoint_unsupported' | 'rate_limited' | 'timeout' | 'network_error' | 'invalid_response';

export interface OfficialModelValidation {
    readonly checkedAt: string;
    readonly latencyMs: number;
    readonly resolvedModel: string;
    readonly toolCalling: boolean;
}

export interface OfficialModelConnection {
    /** Local-only protocol override. Null disables; absence uses verified provider/discovery metadata. */
    readonly nativeWebResearch?: import('@nextmux/model-runtime').NativeWebResearchDeclaration | null;
    readonly canvasCapabilities?: { readonly providerModelId: string; readonly version: string; readonly modes: readonly CanvasModeCapability[]; readonly defaultMode?: CanvasGenerationMode };
    readonly id: string;
    readonly providerId: OfficialProviderId;
    readonly providerName: string;
    readonly modelFamily: string;
    readonly protocol: OfficialProviderProtocol;
    readonly label: string;
    readonly model: string;
    readonly baseUrl: string;
    /** Non-secret provider-native settings; credentials remain in keychain. */
    readonly providerSettings?: OfficialProviderSettings;
    readonly keyHint: string;
    readonly credentialSource?: 'none' | 'environment' | 'api_key';
    readonly status: 'verified' | 'unverified';
    readonly toolCapability: OfficialToolCapability;
    /** Evidence is capability-specific; a /models result never implies vision or tools. */
    readonly capabilityEvidence: readonly ModelCapabilityEvidence[];
    readonly discoveredModels: readonly (DiscoveredOfficialModel & {
        /** Exact-model proof for this credential and endpoint; never inherited from another model. */
        readonly validation?: OfficialModelValidation;
    })[];
    readonly modelDiscoveryStatus: OfficialModelDiscoveryStatus;
    /** Latest native Ollama directory check; safe to display in connection Settings. */
    readonly ollamaStatus?: {
        readonly version: string;
        readonly modelCount: number;
        readonly toolsModelCount: number;
    };
    /** Bounded diagnostic only; never the upstream response or credential. */
    readonly modelDiscoveryFailure?: OfficialModelDiscoveryFailure;
    /** Redacted provider diagnostic, localized only when displayed. */
    readonly modelDiscoveryError?: ReadableModelError;
    /** Last attempt and last successful directory read are intentionally separate. */
    readonly lastModelDiscoveryAt?: string;
    readonly lastSuccessfulModelDiscoveryAt?: string;
    /** User configuration identity; metadata discovery and validation only advance updatedAt. */
    readonly canvasConfigurationUpdatedAt?: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly lastCheckedAt?: string;
    readonly lastLatencyMs?: number;
}

export interface OfficialModelConnectionsState {
    readonly providers: readonly OfficialProviderPreset[];
    readonly connections: readonly OfficialModelConnection[];
}

export interface SaveOfficialModelConnectionRequest {
    readonly nativeWebResearch?: import('@nextmux/model-runtime').NativeWebResearchDeclaration | null | 'automatic';
    readonly connectionId?: string;
    readonly providerId: OfficialProviderId;
    readonly label?: string;
    readonly model: string;
    readonly baseUrl: string;
    readonly apiKey?: string;
    readonly providerSettings?: OfficialProviderSettings;
    /** Optional non-secret adapter contract, scoped to this exact provider model. */
    readonly canvasCapabilities?: OfficialModelConnection['canvasCapabilities'] | null;
    readonly validate: boolean;
}

export interface SaveOfficialModelConnectionResult {
    readonly connection: OfficialModelConnection;
    readonly validation?: OfficialModelValidation;
}

export type DesktopProxyMode = 'system' | 'direct' | 'manual';

export interface DesktopNetworkSettings {
    readonly mode: DesktopProxyMode;
    readonly proxyUrl: string;
    readonly username: string;
    readonly hasPassword: boolean;
    readonly noProxy: string;
    readonly rejectUnauthorized: boolean;
    readonly resolvedProxy: string;
    readonly source: 'environment' | 'operating_system' | 'manual' | 'direct' | 'none';
    readonly updatedAt?: string;
}

export interface DesktopGitState {
    readonly statusMessage?: import('./nextmux-domain-errors').DomainMessage;
    readonly available: boolean;
    readonly repository: boolean;
    readonly branch: string;
    readonly upstream: string;
    readonly ahead: number;
    readonly behind: number;
    readonly changes: readonly { readonly path: string; readonly status: string }[];
    readonly remoteName: string;
    readonly remoteUrl: string;
    readonly webUrl: string;
    readonly provider: 'github' | 'gitlab' | 'bitbucket' | 'gitee' | 'other' | 'none';
    readonly createPullRequestUrl: string;
    readonly commits: readonly {
        readonly hash: string;
        readonly shortHash: string;
        readonly subject: string;
        readonly author: string;
        readonly authoredAt: string;
    }[];
    readonly message: string;
}

export interface DesktopSiteScript {
    readonly name: string;
    readonly command: string;
    readonly kind: 'development' | 'preview' | 'start' | 'other';
}

export interface DesktopSiteProcess {
    readonly id: string;
    readonly script: string;
    readonly status: 'starting' | 'running' | 'stopped' | 'failed';
    readonly startedAt: number;
    readonly stoppedAt?: number;
    readonly urls: readonly string[];
    readonly output: string;
    readonly exitCode?: number;
}

export interface DesktopSiteState {
    readonly statusMessage?: import('./nextmux-domain-errors').DomainMessage;
    readonly packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'none';
    readonly scripts: readonly DesktopSiteScript[];
    readonly processes: readonly DesktopSiteProcess[];
    readonly message: string;
}

export interface DesktopScheduledTaskRegistrationRequest {
    readonly taskId: string;
    readonly cadence: 'once' | 'daily' | 'weekly';
    readonly runAt: string;
    /** Weekly: 0 = Sunday … 6 = Saturday (absent means Monday, as before the day could be chosen). */
    readonly weekday?: number;
    readonly enabled: boolean;
}

export interface DesktopScheduledTaskRegistrationResult {
    readonly registered: boolean;
    readonly mode: 'system' | 'app_open';
    readonly message: string;
}

export type DesktopAgentModelRoute =
    | { readonly kind: 'managed_gateway'; readonly route: ManagedGatewayRoute; readonly conversationId?: string }
    | { readonly kind: 'official_connection'; readonly connectionId: string; readonly model?: string };

export interface DesktopAgentCouncilSlot {
    readonly slotId: string;
    readonly modelId: string;
    readonly modelLabel: string;
    readonly label?: string;
    readonly routeId?: string;
    readonly relayKey?: string;
    readonly roles: readonly AgentCouncilRoleId[];
    readonly route: DesktopAgentModelRoute;
}

export interface DesktopAgentCouncilConfig {
    readonly enabled?: boolean;
    readonly revision: number;
    readonly sourceKey: string;
    readonly sourceLabel: string;
    readonly relayKey?: string;
    readonly relayLabel?: string;
    readonly leadSlotId?: string;
    readonly updatedAt?: number;
    readonly slots: readonly DesktopAgentCouncilSlot[];
}

/**
 * Opaque identity and ownership data for continuing a delegated child run.
 * The checkpoint itself never crosses the renderer boundary.
 */
export interface DesktopAgentChildContinuation {
    readonly childRunId: string;
    readonly parentRunId: string;
    readonly rootRunId: string;
    readonly depth: number;
    readonly resumeCheckpointId: string;
}

export interface DesktopAgentRunRequest {
    /** Stable local acceptance identity for a queued user message, never a model retry token. */
    readonly queuedRequestId?: string;
    /**
     * Identity and send time of this start request. A start held back by a brief connection drop can be withdrawn
     * (withdrawAgentStart) by a Stop pressed meanwhile; the backend checks before it accepts (audit B13-02).
     */
    readonly startToken?: string;
    readonly issuedAt?: number;
    readonly switchPolicy?: ModelSwitchPolicy;
    readonly route: DesktopAgentModelRoute;
    /** Optional Council Mode (臭皮匠模式) multi-model configuration for this turn. */
    readonly councilConfig?: DesktopAgentCouncilConfig;
    /**
     * Council Mode only (阻止模型创建子代理, checked by default). True or omitted writes the Subagents Disabled rule into
     * the lead and specialist instructions; only an explicit false leaves it out, with no other subagent rule.
     */
    readonly disableSubagents?: boolean;
    /**
     * The answer style chosen in Settings → Models. Omitted for 正常 (the model keeps its defaults); 严谨 and 发散 become a
     * temperature on direct APIs (a reasoning model drops it again) and a short style note in the instructions.
     */
    readonly creativityMode?: 'rigorous' | 'creative';
    readonly workbench: 'coding' | 'comic';
    /**
     * `comic`: only the comic project tools. `comic-scripts` / `comic-shots`: only reading the project and
     * the one structured write of that step (comic.write_scripts / comic.apply_adaptation), so the model
     * cannot build the result piecemeal with scene and shot edits.
     */
    readonly toolScope?: 'comic' | 'comic-scripts' | 'comic-shots' | 'comic-lyrics' | 'comic-json';
    /** Output cap for pure comic planning calls; never expands a provider limit. */
    readonly comicMaximumOutputTokens?: number;
    readonly prompt: string;
    readonly attachments?: readonly AgentMessageAttachment[];
    readonly history?: readonly AgentModelMessage[];
    readonly workspaceRoot: string;
    /** Original project folder path when that folder is currently missing on disk and the turn is temporarily running in the default workspace. */
    readonly missingProjectWorkspaceRoot?: string;
    /** Explicit per-directory grants; omitted on legacy single-root requests. */
    readonly workspaceBindings?: readonly {
        readonly id: string;
        readonly path: string;
        readonly permissionMode: AgentPermissionMode;
    }[];
    /** Explicitly unlinked private layout entries; paths are never trusted from history. */
    readonly unlinkedPrivateWorkspaceBindingIds?: readonly string[];
    readonly conversationId?: string;
    /** Compact project/task memory; deliberately separate from conversation history. */
    readonly taskContext?: AgentTaskContext;
    readonly permissionMode: AgentPermissionMode;
    readonly reasoningEffort?: AgentReasoningEffort;
    readonly reasoningBudgetTokens?: number;
    readonly reasoningEnabled?: boolean;
    readonly reasoningExclude?: boolean;
    readonly reasoningMode?: 'adaptive' | 'enabled' | 'disabled';
    /** Optional conversation context cap. The host clamps it to trusted model metadata; omission is automatic. */
    readonly contextWindowTokens?: number;
    /** Tools used in the conversation's recent turns, kept loaded on small-context models (see tool.search). */
    readonly recentToolNames?: readonly string[];
    /** Optional cumulative token ceiling; the selected backend must enforce it. */
    readonly tokenBudget?: AgentTokenBudget;
    /** Backend resolves this id against its own discovered profile inventory. */
    readonly terminalProfileId?: string;
    /** Backend-owned Theia terminal capability; never an operating-system PID. */
    readonly terminalId?: number;
    readonly skills?: readonly DesktopAgentSkill[];
    /** Opaque local-backend handle; checkpoint contents never cross into the renderer. */
    readonly resumeCheckpointId?: string;
    /** Exact retry preserves safety counters; explicit continuation starts a fresh bounded segment. */
    readonly resumeStrategy?: 'continue' | 'retry';
    /** Private child-agent continuation; mutually scoped to the owning parent conversation. */
    readonly childContinuation?: DesktopAgentChildContinuation;
}

export interface DesktopAgentDurableRecoveryRequest {
    readonly childContinuation?: DesktopAgentChildContinuation;
    readonly workspaceRoot: string;
    readonly workspaceBindings?: DesktopAgentRunRequest['workspaceBindings'];
    readonly permissionMode: AgentPermissionMode;
    readonly conversationId: string;
    readonly resumeCheckpointId: string;
}
export interface DesktopAgentDurableRecoveryResult {
    readonly status: 'none' | 'blocked' | 'unsupported' | 'expired' | 'owner_mismatch' | 'unavailable';
    readonly reason: 'no_unknown_operations' | 'result_unknown' | 'history_unknown' | 'unsupported_checkpoint' | 'unsupported_tool'
        | 'checkpoint_expired' | 'owner_mismatch' | 'recovery_unavailable' | 'active_operation';
    readonly resumeCheckpointId?: string;
    readonly headRevision?: number;
    readonly operations: readonly {
        readonly operationId: string;
        readonly revision: number;
        readonly toolCallId: string;
        readonly toolName: string;
        readonly operationKind: 'delegated_model' | 'tool';
        readonly state: 'running' | 'interrupted_unknown' | 'history_unknown';
        readonly reason: 'result_unknown' | 'history_unknown' | 'unsupported_tool' | 'active_operation';
        readonly retrySupported: boolean;
        readonly usageKnown: boolean;
    }[];
}
export interface DesktopAgentDurableRetryRequest {
    /** Normal selected route/options, but backend forces exact retry of this opaque checkpoint. */
    readonly run: DesktopAgentRunRequest;
    readonly operationId: string;
    readonly expectedRevision: number;
    readonly headRevision: number;
}

export interface DesktopAttachmentCacheRequest {
    readonly name: string;
    readonly mimeType: string;
    readonly dataBase64: string;
    /** Store durable text references with their project when one is selected. */
    readonly workspaceRoot?: string;
    /** Scope projectless durable text references to an application-owned conversation workspace. */
    readonly conversationId?: string;
    /** Create a collision-free file for this attachment instead of content-addressed deduplication. */
    readonly unique?: boolean;
}

export interface DesktopAttachmentCacheRecord {
    readonly uri: string;
    readonly size: number;
    readonly sha256: string;
    readonly workspaceRelativePath?: string;
}

export interface DesktopAttachmentReadRequest {
    readonly uri: string;
    readonly name: string;
    readonly size: number;
    readonly workspaceRelativePath?: string;
    readonly workspaceRoot?: string;
    readonly conversationId?: string;
}

export interface DesktopAttachmentReadResult {
    readonly dataBase64: string;
    readonly size: number;
    readonly sha256: string;
}

export interface DesktopAgentOutputAssetReadRequest {
    /** Opaque conversation/run owner returned with the completed result. */
    readonly ownerId: string;
    readonly asset: AgentOutputAsset;
}

export interface DesktopAgentOutputAssetReadResult extends AgentOutputAsset {
    readonly dataBase64: string;
}

export interface ConversationWorkspaceForkResult {
    readonly workspaceRoot: string;
    readonly filesCopied: number;
}

export interface AgentFileVersionRestoreRequest {
    readonly workspaceRoot: string;
    readonly checkpointId: string;
    readonly side: 'before' | 'after';
    readonly expectedSha256: string | null;
    readonly conversationId: string;
    readonly turnId?: string;
}

export interface AgentFileVersionRestoreResult {
    readonly restored: true;
    readonly checkpointId: string;
    readonly path: string;
    readonly sha256: string | null;
}

export interface AgentFileStateRequest {
    readonly workspaceRoot: string;
    readonly conversationId: string;
    /** Exactly one of checkpointId and path. Paths are constrained to the authorized root. */
    readonly checkpointId?: string;
    readonly path?: string;
}

export interface AgentFileState {
    readonly path: string;
    readonly exists: boolean;
    readonly sha256: string | null;
    readonly mode: number | null;
    readonly size: number;
}

export interface AgentFileVersionSaveRequest {
    readonly workspaceRoot: string;
    readonly path?: string;
    readonly checkpointId?: string;
    readonly content: string;
    readonly expectedSha256: string | null;
    readonly conversationId: string;
    readonly turnId?: string;
    readonly operation?: 'editor_save' | 'timeline_restore';
}

export interface AgentFileVersionsRequest extends AgentFileStateRequest {
    readonly limit?: number;
    readonly cursor?: string;
}

export interface AgentFileVersionsPage {
    readonly versions: readonly AgentFileVersion[];
    readonly nextCursor?: string;
}

export interface ConversationWorkspaceBindings {
    readonly workspaceRoot: string;
    readonly workspaces: readonly { readonly sourceWorkspaceRoot: string; readonly workspaceRoot: string }[];
}

export interface ConversationMultiWorkspaceForkRequest {
    readonly sourceConversationId: string;
    readonly targetConversationId: string;
    readonly primaryWorkspaceRoot: string;
    /** Include every inherited directory, even when this fork restores no changes there. */
    readonly groups: readonly { readonly workspaceRoot: string; readonly inheritedCheckpointIds: readonly string[]; readonly checkpointIds: readonly string[]; readonly targets?: readonly { readonly checkpointId: string; readonly side: 'before' | 'after' }[] }[];
}

export interface ConversationMultiWorkspaceForkResult extends ConversationWorkspaceForkResult {
    /** An empty source denotes the isolated directory for formerly external files. */
    readonly workspaces: readonly { readonly sourceWorkspaceRoot: string; readonly workspaceRoot: string }[];
    readonly resourceMappings: readonly { readonly sourcePath: string; readonly targetPath: string }[];
}

export interface DesktopAgentSkill {
    readonly sourcePath: string;
    readonly sourceSha256: string;
    readonly name: string;
    readonly description: string;
    readonly instructions: string;
    readonly allowedTools?: readonly string[];
}

export interface DesktopConversationIndexMessage {
    readonly id: string;
    readonly turnId?: string;
    readonly prompt: string;
    readonly response: string;
    /** Bounded supplementary output/activity prose for search; not a model response. */
    readonly activityText?: string;
    readonly error: string;
    /** Preserve runtime provenance until the model/display channel boundary. */
    readonly finalMessage?: import('@nextmux/agent-runtime').AgentRuntimeFinalMessage;
    readonly stopReason?: string;
    readonly failure?: Pick<DesktopAgentRunFailure, 'code' | 'kind'>;
    readonly createdAt: number;
    readonly completedAt?: number;
}

export interface DesktopConversationIndexRecord {
    readonly titleOrigin?: 'default' | 'recoveredDraft' | 'draft';
    readonly id: string;
    readonly sourceConversationId?: string;
    readonly sourceMessageId?: string;
    readonly workspacePath: string;
    readonly title: string;
    readonly messages: readonly DesktopConversationIndexMessage[];
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface DesktopConversationSearchRequest {
    readonly query?: string;
    readonly conversationId?: string;
    readonly messageId?: string;
    readonly limit?: number;
}

export interface DesktopConversationSearchMatch {
    readonly titleOrigin?: 'default' | 'recoveredDraft' | 'draft';
    readonly conversationId: string;
    readonly messageId?: string;
    readonly turnId?: string;
    readonly title: string;
    readonly workspacePath: string;
    readonly kind: 'conversation_id' | 'message_id' | 'content';
    readonly snippet: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface DesktopConversationSearchResult {
    readonly matches: readonly DesktopConversationSearchMatch[];
}

export interface DesktopConversationHistoryLoadResult {
    readonly sessions: readonly unknown[];
    readonly status: 'empty' | 'ok' | 'partial';
    readonly deletedSessionIds?: readonly string[];
}

export interface DesktopConversationHistoryListRequest {
    /** Omitted matches all projects; an empty string matches only unbound conversations. */
    readonly workspacePath?: string;
    /** Omitted matches both; true loads pinned conversations independently from project recency. */
    readonly pinned?: boolean;
    readonly cursor?: string;
    readonly limit?: number;
}

export interface DesktopConversationHistoryListResult extends DesktopConversationHistoryLoadResult {
    /** Headers only; call readConversationHistorySession before editing or sending. */
    readonly sessions: readonly Record<string, unknown>[];
    readonly total: number;
    readonly nextCursor?: string;
}

export interface DesktopConversationProjectSummary {
    readonly workspacePath: string;
    readonly conversationCount: number;
    readonly latestUpdatedAt: number;
}

export interface DesktopConversationHistoryProjectsRequest {
    readonly cursor?: string;
    readonly limit?: number;
}

export interface DesktopConversationHistoryProjectsResult {
    readonly projects: readonly DesktopConversationProjectSummary[];
    readonly total: number;
    readonly nextCursor?: string;
    readonly status: 'empty' | 'ok' | 'partial';
}

export interface DesktopConversationHistorySaveResult {
    readonly conversations: number;
    readonly turns: number;
    readonly savedAt: string;
}

export interface DesktopConversationHistoryPatchRequest {
    readonly upserts: readonly unknown[];
    readonly removedSessionIds: readonly string[];
    /** Per upserted conversation, the stored `updatedAt` the writer's copy is based on (0 when it had none). */
    readonly baseUpdatedAt?: Readonly<Record<string, number>>;
}

export interface DesktopConversationHistoryPatchResult {
    readonly conversations: number;
    readonly upserted: number;
    readonly removed: number;
    readonly savedAt: string;
}

export interface DesktopCommunitySkillSource {
    readonly id: string;
    readonly name: string;
    readonly repository: string;
    readonly homepage: string;
}

export interface DesktopCommunitySkillMetadata {
    readonly schemaVersion: 1;
    /** Author declarations, not a license audit or tested compatibility certification. */
    readonly license: { readonly status: 'declared' | 'unknown'; readonly value?: string };
    readonly compatibility: {
        readonly operatingSystems: { readonly status: 'declared' | 'unknown'; readonly values: readonly string[] };
        readonly architectures: { readonly status: 'declared' | 'unknown'; readonly values: readonly string[] };
        readonly notes?: string;
    };
    readonly dependencies: { readonly status: 'declared' | 'unknown'; readonly items: readonly string[] };
    readonly tools: { readonly mode: 'inherit' | 'restricted' | 'unknown' | 'invalid'; readonly allowedToolNames: readonly string[] };
    readonly source: {
        readonly status: 'verified' | 'unknown' | 'modified';
        readonly repository: string;
        readonly path: string;
        readonly revision?: string;
        readonly treeSha?: string;
        readonly blobSha?: string;
        readonly sha256?: string;
    };
    readonly issues: readonly string[];
}

export interface DesktopCommunitySkillPermissionChange {
    readonly state: 'not_installed' | 'unchanged' | 'changed' | 'unknown';
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly mayExpand: boolean | null;
    readonly requiresReview: boolean;
    readonly previousMode?: DesktopCommunitySkillMetadata['tools']['mode'];
    readonly nextMode?: DesktopCommunitySkillMetadata['tools']['mode'];
    /** Compare-and-set digest of the old installed snapshot, new fixed source and permission difference. */
    readonly reviewToken?: string;
}

export interface DesktopCommunitySkillInstallReview {
    readonly reviewToken: string;
    readonly permissionChangeAcknowledged: true;
}

export interface DesktopCommunitySkill {
    readonly descriptionMessage?: import('./nextmux-domain-errors').DomainMessage;
    readonly id: string;
    readonly sourceId: string;
    readonly sourceName: string;
    readonly repository: string;
    readonly path: string;
    readonly name: string;
    readonly description: string;
    readonly version: string;
    /** Immutable upstream commit; legacy cached entries require a catalog refresh before installation. */
    readonly sourceRevision?: string;
    readonly homepage: string;
    readonly installed: boolean;
    readonly installedVersion?: string;
    readonly updateAvailable: boolean;
    readonly metadata?: DesktopCommunitySkillMetadata;
    readonly permissionChange?: DesktopCommunitySkillPermissionChange;
}

export interface DesktopCommunitySkillsState {
    readonly sourceFailures?: readonly { readonly source: string; readonly reason: import('./nextmux-domain-errors').DomainMessage }[];
    readonly statusMessage?: import('./nextmux-domain-errors').DomainMessage;
    readonly sources: readonly DesktopCommunitySkillSource[];
    readonly skills: readonly DesktopCommunitySkill[];
    readonly refreshedAt: number;
    readonly stale: boolean;
    readonly message: string;
}

export interface DesktopCommunitySkillActionResult {
    readonly id: string;
    readonly installed: boolean;
    readonly version?: string;
    readonly location?: string;
}

/** One own-API call outside a coding conversation, kept on this computer for 使用记录 (the provider bills it directly). */
export interface OwnApiUsageEntry {
    readonly id: string;
    /** Completion time (ms). */
    readonly at: number;
    readonly kind: 'text' | 'image' | 'video' | 'speech' | 'music' | 'sound_effect';
    /** The own-API connection (official-<uuid>). */
    readonly connectionId: string;
    readonly model: string;
    /** Where it was used: a coding project/conversation, a comic project (its folder name) or a comic conversation. */
    readonly source: { readonly kind: 'comic' | 'comic_chat' | 'coding'; readonly title?: string };
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly status: 'completed' | 'failed';
}

export interface DesktopAgentRunResult {
    readonly finalMessage?: import('@nextmux/agent-runtime').AgentRuntimeFinalMessage;
    readonly verification?: import('@nextmux/agent-runtime').AgentRunVerification;
    readonly runId: string;
    readonly status: AgentRunStatus;
    readonly stopReason: AgentRunStopReason;
    readonly finalText: string;
    /** Ordered visible answer. Media entries contain inert local references, never provider bytes or paths. */
    readonly outputParts?: readonly AgentOutputPart[];
    /** Required only when `outputParts` contains media references. */
    readonly outputAssetOwnerId?: string;
    readonly citations?: readonly import('@nextmux/agent-runtime').ModelCitation[];
    readonly events: readonly AgentRunEvent[];
    readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
    /** False when one or more provider responses omitted verifiable usage. */
    readonly usageKnown?: boolean;
    readonly detectedContextWindowLimit?: number;
    /** Bounded accounting snapshot when a run was configured with a token budget. */
    readonly tokenBudget?: AgentTokenBudgetSnapshot;
    readonly turns: number;
    readonly toolCalls: number;
    /** Present only when this terminal state can be explicitly continued. */
    readonly resumeCheckpointId?: string;
    readonly developmentOnly: boolean;
    readonly billing: {
        readonly kind: 'platform' | 'provider_direct';
        readonly currency?: string;
        readonly chargedMicros: number;
        readonly requestCount: number;
    };
    readonly failoverCount: number;
    readonly changes: readonly AgentCheckpointDiff[];
    readonly checkpointWarnings?: readonly string[];
    /** Present for a child continuation; lets the parent diagnose its terminal outcome. */
    readonly childReceipt?: AgentChildReceipt;
    readonly route: {
        readonly kind: 'managed_gateway' | 'official_connection';
        readonly routeId: string;
        /** Stable platform request identifier used for post-response relay feedback. */
        readonly requestId?: string;
        /** Every managed request used by this reply, in first-use order. */
        readonly requestIds?: readonly string[];
        readonly offeringId?: string;
        readonly connectionId?: string;
        readonly providerName: string;
        readonly modelFamily: string;
        readonly model: string;
        readonly requestedRegistryModelId?: string;
        readonly servedRegistryModelId?: string;
        readonly switchReceipt?: ModelSwitchReceipt;
    };
}

export type DesktopAgentRunFailureKind =
    | 'model_timeout'
    | 'rate_limited'
    | 'model_unavailable'
    | 'model_auth'
    | 'tool_failed'
    | 'waiting_user'
    | 'failed';

export interface PendingManagedReceiptIdentity {
    readonly version: 1;
    readonly requestId: string;
    readonly userId: string;
    readonly platformOrigin: string;
    readonly conversationId: string;
    readonly runId: string;
}

export interface DesktopAgentRunFailure {
    /** Original unresolved receipt only; never part of confirmed IDs, billing totals, or ordinary model retry. */
    readonly pendingManagedReceipt?: PendingManagedReceiptIdentity;
    /** Confirmed managed gateway receipt IDs from this run only, in first-use order; never pending request IDs. */
    readonly requestIds?: readonly string[];
    /** Verified gateway receipts already settled before this run stopped. */
    readonly billing?: { readonly kind: 'platform'; readonly currency: string; readonly chargedMicros: number; readonly requestCount: number };
    readonly readableError?: ReadableModelError;
    readonly code: string;
    readonly message: string;
    readonly kind: DesktopAgentRunFailureKind;
    readonly retryable: boolean;
    /** True only when the runtime proved checkpoint retry cannot duplicate a side effect or charge. */
    readonly retrySafe?: boolean;
    readonly resumable: boolean;
    /** HTTP status when the failure came from a gateway/provider response. */
    readonly httpStatus?: number;
    /** Bounded server-provided delay before an explicit retry/resume. */
    readonly retryAfterMs?: number;
    readonly resumeCheckpointId?: string;
    /** The queued run was refused before any upstream acceptance, usage or tool execution. */
    readonly queuedSubmissionRejected?: true;
}

export type DesktopAgentRunJobStatus =
    | 'running'
    | 'completed'
    | 'limit_reached'
    | 'cancelled'
    | 'paused'
    /** A persisted run was active when the desktop host closed. */
    | 'interrupted'
    | 'model_timeout'
    | 'rate_limited'
    | 'model_unavailable'
    | 'tool_failed'
    | 'waiting_user'
    | 'error';

export interface DesktopAgentRunStartResult {
    readonly runId: string;
    /** Present when this host run is a continuation of a delegated child. */
    readonly childRunId?: string;
}

export type DesktopQueuedSubmissionStatus =
    | { readonly state: 'accepted'; readonly runId: string }
    | { readonly state: 'pending' | 'rejected' | 'unknown' };

/** Bounded local lifecycle history; does not retain prompts, final answers, or raw process output. */
export interface DesktopAgentRunHistoryRecord {
    readonly runId: string;
    readonly conversationId: string;
    readonly status: DesktopAgentRunJobStatus;
    readonly workbench: 'coding' | 'comic';
    readonly startedAt: number;
    readonly updatedAt: number;
    readonly finishedAt?: number;
    readonly error?: { readonly code: string; readonly message: string };
}
export interface DesktopAgentRunHistoryPage {
    readonly runs: readonly DesktopAgentRunHistoryRecord[];
    readonly nextCursor?: string;
}
export interface DesktopAgentRunHistoryDetail extends DesktopAgentRunHistoryRecord {
    readonly events: readonly AgentRunEvent[];
}

export interface DesktopAgentRunRecoveryOwnerHint {
    readonly conversationId: string;
    readonly workspaceRoot: string;
    readonly toolCallIds: readonly string[];
    readonly logicalRootRunId?: string;
}

export interface DesktopAgentRunSnapshot {
    readonly runId: string;
    readonly childRunId?: string;
    readonly status: DesktopAgentRunJobStatus;
    readonly events: readonly AgentRunEvent[];
    /** Oldest event still retained by the bounded server-side journal. */
    readonly firstEventIndex: number;
    readonly nextEventIndex: number;
    readonly startedAt: number;
    readonly updatedAt: number;
    readonly pendingMessages: readonly AgentSteeringMessage[];
    readonly pendingQuestion?: AgentUserQuestion;
    /** Child runs remain queryable after their tab is closed. */
    readonly children: readonly DesktopAgentChildSnapshot[];
    /** Compact backend diagnostics; never contains child transcript messages. */
    readonly delegationLedger?: AgentDelegationLedger;
    readonly result?: DesktopAgentRunResult;
    readonly error?: DesktopAgentRunFailure;
}

export interface DesktopAgentChildResult {
    /** Safe-boundary persistence confidence; never authorizes automatic replay. */
    readonly recoveryStatus?: import('@nextmux/agent-runtime').AgentDelegationRecoveryStatus;
    readonly finalMessage?: import('@nextmux/agent-runtime').AgentRuntimeFinalMessage;
    readonly runId: string;
    readonly status: AgentRunStatus;
    /** Stable runtime reason; do not infer it from localized status text. */
    readonly stopReason: AgentRunStopReason;
    readonly finalText: string;
    readonly outputParts?: readonly AgentOutputPart[];
    readonly outputAssetOwnerId?: string;
    readonly citations?: readonly import('@nextmux/agent-runtime').ModelCitation[];
    /** Bounded accounting snapshot retained with the child result. */
    readonly tokenBudget?: AgentTokenBudgetSnapshot;
    /** Durable outcome retained with the parent turn when the child panel is closed. */
    readonly receipt?: AgentChildReceipt;
    /** Opaque child-only continuation handle; never contains checkpoint contents. */
    readonly resumeCheckpointId?: string;
    readonly checkpointError?: {
        readonly code: string;
        readonly message: string;
    };
    readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
    /** False when one or more provider responses omitted verifiable usage. */
    readonly usageKnown?: boolean;
    readonly detectedContextWindowLimit?: number;
    readonly turns: number;
    readonly toolCalls: number;
    readonly role?: AgentCouncilRoleId;
    readonly slotId?: string;
    readonly modelId?: string;
    readonly modelLabel?: string;
    readonly routeSource?: AgentCouncilRouteSource;
    readonly invocationKey?: string;
}

export interface DesktopAgentChildSnapshot {
    /** Safe-boundary persistence confidence; never authorizes automatic replay. */
    readonly recoveryStatus?: import('@nextmux/agent-runtime').AgentDelegationRecoveryStatus;
    readonly childRunId: string;
    readonly parentRunId: string;
    readonly rootRunId: string;
    readonly depth: number;
    readonly task: string;
    readonly role?: AgentCouncilRoleId;
    readonly slotId?: string;
    readonly acceptanceCriteria?: readonly string[];
    readonly modelId?: string;
    readonly modelLabel?: string;
    readonly routeSource?: AgentCouncilRouteSource;
    readonly invocationKey?: string;
    readonly status: DesktopAgentRunJobStatus;
    readonly events: readonly AgentRunEvent[];
    /** Total child lifecycle events, including entries evicted from the bounded in-memory journal. */
    readonly eventCount?: number;
    readonly firstEventIndex: number;
    readonly nextEventIndex: number;
    readonly startedAt: number;
    readonly updatedAt: number;
    readonly finishedAt?: number;
    readonly taskContext: AgentTaskContext;
    /** Present for a failed child that has no normal AgentDelegateOutput. */
    readonly receipt?: AgentChildReceipt;
    /** A paused or limit-stopped child rebuilt from its delegation ledger keeps the checkpoint it continues from. */
    readonly resumeCheckpointId?: string;
    readonly result?: DesktopAgentChildResult;
    readonly error?: DesktopAgentRunFailure;
    readonly checkpointError?: {
        readonly code: string;
        readonly message: string;
    };
}

export interface DesktopAgentRunMessageResult {
    readonly accepted: boolean;
    readonly disposition: 'steering' | 'follow_up';
    readonly status: DesktopAgentRunJobStatus;
    readonly message: AgentSteeringMessage;
}

export interface DesktopAgentProcessWriteResult {
    readonly accepted: number;
}

export interface DesktopAgentProcessResizeResult {
    readonly resized: boolean;
}

export interface DesktopAgentProcessTerminateResult {
    readonly terminated: boolean;
}

export interface CheckpointRestoreResult {
    readonly restored: true;
    readonly title: string;
    readonly checkpointId: string;
}

export interface CheckpointChainRestoreResult {
    readonly restored: true;
    readonly checkpointIds: readonly string[];
    readonly versions?: readonly { readonly workspaceRoot: string; readonly checkpointId: string; readonly path: string }[];
}

export interface DesktopComicProjectState {
    readonly exists: boolean;
    readonly fileName: 'nextmux.comic.json';
    readonly project?: ComicProject;
    readonly sha256?: string;
    readonly migratedFrom?: number;
    readonly production?: ComicProductionDocument;
}

/** Canvas document revisions are independent of the editor project's revisions. */
export interface DesktopComicCanvasState {
    readonly exists: boolean;
    readonly fileName: string;
    readonly canvasId?: string;
    readonly canvas?: CanvasDocument;
    readonly jobs: readonly DesktopComicCanvasJob[];
}

export interface DesktopComicCanvasJob {
    readonly nodeId: string;
    readonly idempotencyKey: string;
    readonly jobId?: string;
    readonly snapshot: GenerationSnapshot;
    readonly status: string;
    readonly error?: { readonly code: string; readonly message: string };
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly startFrameContinuation?: { readonly preparationId: string; readonly intentFingerprint: string };
}

export interface SaveDesktopComicCanvasRequest {
    readonly workspaceRoot: string;
    readonly canvasId?: string;
    readonly expectedRevision: number;
    readonly canvas: CanvasDocument;
}

export interface SeedDesktopComicCanvasRequest {
    readonly workspaceRoot: string;
    readonly expectedRevision: number;
    readonly imageModelId?: string;
    readonly imageConnectionId?: string;
    readonly videoModelId?: string;
    readonly imageParameters?: Readonly<Record<string, unknown>>;
    readonly videoParameters?: Readonly<Record<string, unknown>>;
}

export interface CommitDesktopComicCanvasRequest {
    readonly workspaceRoot: string;
    readonly expectedCanvasRevision: number;
    readonly expectedProjectRevision: number;
}

/** One explicit generate click. Repeating its key recovers the original queue record. */
export interface RunDesktopComicCanvasNodeRequest {
    readonly workspaceRoot: string;
    readonly canvasId?: string;
    readonly expectedRevision: number;
    readonly nodeId: string;
    readonly idempotencyKey: string;
    readonly connectionId: string;
    /** The desk's selected text route, used only when an English-only model needs prompt translation. */
    readonly promptTranslationRoute?: DesktopAgentModelRoute;
    readonly keyPriceQuoteId?: string;
    readonly cost: EnqueueMediaJobRequest['cost'];
    readonly startFrameContinuation?: { readonly preparationId: string; readonly intentFingerprint: string };
}

export interface DesktopComicCanvasGenerationResult {
    readonly state: DesktopComicCanvasState;
    readonly job: MediaJob;
    readonly startFramePricing?: { readonly quotedBeforeImageId?: string; readonly effectiveVideoQuoteId?: string;
        readonly before?: PublicPriceDetails; readonly effective?: PublicPriceDetails; readonly changed?: true };
}

/** Explicit selected image route; never chosen or changed by the start-frame backend. */
export interface DesktopComicCanvasStartFrameImageRoute {
    readonly connectionId: string;
    readonly modelId: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly keyPriceQuoteId?: string;
    readonly cost: EnqueueMediaJobRequest['cost'];
}
export interface GetDesktopComicCanvasStartFramePlanRequest {
    readonly workspaceRoot: string;
    readonly canvasId?: string;
    readonly nodeId: string;
    readonly imageRoute: DesktopComicCanvasStartFrameImageRoute;
    readonly videoConnectionId: string;
    readonly videoKeyPriceQuoteId?: string;
    readonly videoCost: EnqueueMediaJobRequest['cost'];
    readonly characterVersionIds?: readonly string[];
    /** Existing local material/character-library IDs only; no caller-provided paths or URIs. */
    readonly characterLibraryAssetIds?: readonly string[];
    /** Explicitly plan a new image, using the original tail rather than an already-applied result. */
    readonly regenerate?: true;
}
export interface DesktopComicCanvasStartFramePlan {
    readonly fingerprint: string;
    readonly imagePrompt: string;
    readonly tailFrameVersionId: string;
    readonly characterVersionIds: readonly string[];
    readonly imageParameters: Readonly<Record<string, unknown>>;
    readonly videoParameters: Readonly<Record<string, unknown>>;
    readonly reusablePreparationId?: string;
    readonly readyVersion?: CanvasAssetVersion;
    /** The initial automatic continuation survives apply/reply loss without a second video submission. */
    readonly videoContinuationKey?: string;
    /** Includes the actual prepared frame and reviewed video inputs, never a quote or multiplier. */
    readonly videoIntentFingerprint?: string;
    readonly videoModelId: string;
}
export interface RunDesktopComicCanvasStartFrameRequest extends GetDesktopComicCanvasStartFramePlanRequest {
    readonly idempotencyKey: string;
    readonly planFingerprint: string;
    /** One consent covers the additional image call and the subsequent existing video call. */
    readonly acceptedTwoStepBilling: true;
    /** Only an explicit redo may create another image call for the same prepared inputs. */
    readonly regenerate?: true;
}
export interface GetDesktopComicCanvasStartFrameRequest {
    readonly workspaceRoot: string;
    readonly canvasId?: string;
    readonly preparationId: string;
    readonly intentFingerprint?: string;
}
export interface DesktopComicCanvasStartFrameResult {
    readonly state: DesktopComicCanvasState;
    readonly preparationId: string;
    readonly job?: MediaJob;
    readonly version?: CanvasAssetVersion;
    readonly applied: boolean;
    readonly videoContinuationKey: string;
    readonly videoJob?: MediaJob;
    readonly videoIntentFingerprint?: string;
}
export interface ApplyDesktopComicCanvasStartFrameRequest extends GetDesktopComicCanvasStartFrameRequest {
    readonly nodeId: string;
    readonly versionId: string;
    readonly videoConnectionId?: string;
    readonly videoKeyPriceQuoteId?: string;
    readonly intentFingerprint?: string;
}

/** Local processing uses a stable request ID and returns the current persisted canvas. */
export interface RunDesktopComicCanvasToolRequest extends RunComicCanvasToolRequest {
    readonly workspaceRoot: string;
    readonly canvasId?: string;
}

export interface DesktopComicCanvasToolResult {
    readonly state: DesktopComicCanvasState;
    readonly job?: PersistentComicCanvasToolJob;
}

export interface DesktopComicCanvasToolRunResult extends DesktopComicCanvasToolResult {
    readonly job: PersistentComicCanvasToolJob;
}

export interface DesktopComicCanvasModelToolReference {
    readonly role: NonNullable<CanvasModelToolRequest['references']>[number]['role'];
    readonly nodeId: string;
    readonly versionId: string;
}

export interface GetDesktopComicCanvasModelToolRouteRequest {
    readonly workspaceRoot: string;
    readonly canvasId?: string;
    readonly nodeId: string;
    readonly sourceVersionId: string;
    readonly operation: CanvasModelToolOperation;
    readonly connectionId: string;
    readonly modelId: string;
    readonly references?: readonly DesktopComicCanvasModelToolReference[];
    readonly prompt?: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface RunDesktopComicCanvasModelToolRequest extends GetDesktopComicCanvasModelToolRouteRequest {
    readonly expectedRevision: number;
    readonly idempotencyKey: string;
    readonly promptTranslationRoute?: DesktopAgentModelRoute;
    readonly keyPriceQuoteId?: string;
    readonly cost: EnqueueMediaJobRequest['cost'];
    readonly position?: CanvasPoint;
}

export type DesktopComicCanvasModelToolResult =
    | (Extract<CanvasModelToolRoutePlan, { status: 'unavailable' }> & { readonly state: DesktopComicCanvasState })
    | (DesktopComicCanvasToolRunResult & { readonly status: 'local'; readonly operation: 'image.matting' | 'image.depth' | 'video.depth' })
    | (DesktopComicCanvasGenerationResult & { readonly status: 'submitted'; readonly nodeId: string });

export interface ImportDesktopComicCanvasAssetRequest {
    readonly workspaceRoot: string;
    readonly canvasId?: string;
    readonly expectedRevision: number;
    readonly path: string;
    readonly position?: CanvasPoint;
    readonly target?: { readonly nodeId: string; readonly role: import('@nextmux/comic-core/canvas').CanvasInputRole };
}

export interface ExtractDesktopComicCanvasFrameRequest {
    readonly workspaceRoot: string;
    readonly canvasId?: string;
    readonly expectedRevision: number;
    readonly nodeId: string;
}

/** Extract a fixed direct reference without adding a canvas node or wire. */
export interface ExtractDesktopComicCanvasInputFrameRequest extends ExtractDesktopComicCanvasFrameRequest {
    readonly inputId: string;
    readonly versionId: string;
    readonly assetId: string;
    readonly selection: import('@nextmux/comic-core/canvas').CanvasFrameSelection;
}

export interface BindDesktopComicCanvasCharacterRequest {
    readonly workspaceRoot: string;
    readonly canvasId?: string;
    readonly characterNodeId: string;
    readonly portraitNodeId?: string;
    readonly expectedProjectRevision: number;
    readonly expectedCanvasRevision: number;
}

export interface ComicStepDefault {
    readonly kind: 'novel' | 'image' | 'topic' | 'music';
    readonly step: 'text' | 'image' | 'video' | 'speech' | 'music' | 'sound_effect';
    readonly merchantId: string;
    readonly canonicalModel: string;
    /** 'configured' by staff, or 'fallback' while that pick's route is down. */
    readonly source: 'configured' | 'fallback';
}

export interface DesktopComicLibraryProject {
    readonly projectId?: string;
    readonly folderId?: string | null;
    readonly coverAssetId?: string | null;
    readonly titleDefault?: import("@nextmux/comic-core").ComicDefaultTitle;
    readonly path: string;
    readonly title: string;
    readonly updatedAt: string;
    readonly sceneCount: number;
    readonly shotCount: number;
    readonly generatedShotCount: number;
    readonly durationSeconds: number;
    readonly aspectRatio: string;
    /** Absolute path of a representative image, when one exists. */
    readonly coverPath?: string;
    /** Which of the four comic entries the project belongs to (absent: novel; chat: a conversation folder). */
    readonly projectKind?: 'novel' | 'image' | 'topic' | 'music' | 'chat';
    /** 草稿 nothing generated yet · 进行中 some of it made · 已完成 everything made (every shot filmed; a song chosen). */
    readonly stage?: 'draft' | 'progress' | 'done';
    /** When the last export finished (absent: never exported). */
    readonly exportedAt?: string;
    /** Generations whose latest attempt failed and whose result is still missing (失败待处理). */
    readonly failedJobs?: number;
}

export interface DesktopComicLibraryState {
    readonly root: string;
    readonly folders?: readonly import('@nextmux/comic-core').ComicProjectFolder[];
    readonly projects: readonly DesktopComicLibraryProject[];
}

export interface CreateComicLibraryProjectRequest {
    readonly locale?: string;
    readonly title?: string;
    readonly projectKind?: 'novel' | 'image' | 'topic' | 'music';
    readonly aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3';
    readonly starter?: 'storyboard' | 'empty';
    readonly frameRate?: 24 | 25 | 30;
    readonly parentDirectory?: string;
}

export interface ImportComicShotImageRequest {
    readonly workspaceRoot: string;
    readonly sceneId: string;
    readonly shotId: string;
    readonly name: string;
    readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    readonly dataBase64: string;
}

/** Files from disk into the comic's media library (nextmux.media/imports). */
export interface ImportDesktopComicMediaRequest {
    readonly workspaceRoot: string;
    /** Absolute paths of images, videos and audio files (up to 50). */
    readonly paths: readonly string[];
}

export interface ImportDesktopComicMediaResult {
    readonly state: DesktopComicProjectState;
    /** Library entries created, in the order of `paths` (unsupported files are skipped). */
    readonly assetIds: readonly string[];
    /** Per input path: the library entry it became, or null when it was skipped. */
    readonly sources: readonly (string | null)[];
    readonly skipped: readonly { readonly name: string; readonly reason: 'unsupported' | 'too_large' | 'unreadable' }[];
}

/** One editor action (several timeline edits), written to the project once. */
export interface ApplyDesktopComicEditsRequest {
    readonly locale?: string;
    readonly workspaceRoot: string;
    readonly expectedRevision: number;
    readonly edits: readonly ComicEditorEdit[];
}

export interface ApplyDesktopComicEditsResult {
    readonly state: DesktopComicProjectState;
    readonly createdShotIds: readonly string[];
}

/** Undo / redo: put an earlier version of the storyboard back as a new revision. */
export interface RestoreDesktopComicProjectRequest {
    readonly workspaceRoot: string;
    readonly expectedRevision: number;
    readonly project: ComicProject;
}

export interface CreateComicLibraryProjectResult {
    readonly path: string;
    readonly state: DesktopComicProjectState;
}

export interface DesktopComicCharacterLibraryEntry {
    readonly bundleId: string;
    readonly name: string;
    readonly sourceProjectId: string;
    readonly sourceCharacterId: string;
    readonly identityVersion?: string;
    readonly referenceCount: number;
    readonly authorizationRef: string;
    readonly createdAt: string;
    /** Absolute path of the first reference picture, for the library grid. */
    readonly thumbnailPath?: string;
    readonly description?: string;
    readonly appearance?: string;
}

export interface SaveComicCharacterToLibraryRequest {
    readonly workspaceRoot: string;
    readonly characterId: string;
    /** Optional: only needed for a real person's likeness. */
    readonly authorizationRef?: string;
}

export interface ImportComicCharacterFromLibraryRequest {
    readonly workspaceRoot: string;
    readonly bundleId: string;
    readonly expectedRevision: number;
    readonly authorizationRef?: string;
    /** Give this story role the library character's look (pictures, appearance, voice) instead of adding a new character. */
    readonly replaceCharacterId?: string;
}

/** One reference portrait for a character, made by an image model and set as its picture. */
export interface GenerateComicCharacterPortraitRequest {
    readonly workspaceRoot: string;
    readonly characterId: string;
    readonly connectionId: string;
    readonly model: string;
    readonly keyPriceQuoteId?: string;
    readonly billing: 'free' | 'provider_billed' | 'platform_billed';
}

/** 人物库 → 新建人物: a portrait drawn from the user's words, saved straight into the library. */
export interface CreateComicLibraryCharacterRequest {
    readonly name: string;
    /** Face, age, hair, build, costume… in the user's words. */
    readonly appearance: string;
    readonly description?: string;
    /** A look preset id (live, anime, …) or the user's own words. */
    readonly look?: string;
    /** A picture of the user's own (PNG / JPEG / WebP): kept as the reference; no portrait is drawn. */
    readonly imagePath?: string;
    /** The image model that draws the portrait (not needed with imagePath). */
    readonly connectionId?: string;
    readonly model?: string;
    readonly keyPriceQuoteId?: string;
    readonly billing?: 'free' | 'provider_billed' | 'platform_billed';
}

export interface UpdateComicLibraryCharacterRequest {
    readonly bundleId: string;
    readonly name: string;
    readonly description?: string;
    readonly appearance?: string;
}

/** What a video model takes: the published guide, with a live listing's lengths and sizes where there is one. */
export interface DesktopVideoModelFacts extends VideoModelGuide {
    /** Exact own OpenRouter /videos/models flag; separate from native soundtrack output. */
    readonly supportsGenerateAudio?: boolean;
    /** Where clipSeconds came from. */
    readonly source: 'listing' | 'guide';
    readonly resolutions: readonly string[];
    readonly aspectRatios: readonly string[];
    /** Raw listing slots; a guide's lastFrame flag cannot authorize a paid tail-frame submission. */
    readonly frameImages?: readonly string[];
}

export interface CreateDesktopComicProjectRequest {
    readonly locale?: string;
    readonly workspaceRoot: string;
    readonly title?: string;
    /** novel (default), image (pictures animated by a video model), topic (AI-written short video), music, or chat (a conversation folder). */
    readonly projectKind?: 'novel' | 'image' | 'topic' | 'music' | 'chat';
    readonly frameRate?: ComicFrameRate;
    readonly canvas?: ComicCanvas;
    readonly starter?: 'storyboard' | 'empty';
    readonly scriptText?: string;
    readonly overwrite?: boolean;
}

export interface ApplyDesktopComicCommandRequest {
    readonly locale?: string;
    readonly workspaceRoot: string;
    readonly command: ComicCommand;
}

export interface UpdateDesktopComicScriptRequest {
    readonly workspaceRoot: string;
    readonly scriptText: string;
    readonly language?: string;
    readonly expectedRevision: number;
}

export interface ApplyDesktopComicAnalysisRequest {
    readonly locale?: string;
    readonly workspaceRoot: string;
    readonly expectedRevision: number;
}

export interface DesktopMediaRuntimeState {
    readonly whisper?: {
        readonly available: boolean;
        readonly source: 'configured' | 'bundled' | 'downloaded' | 'missing';
        /** whisper.cpp (configured paths) or sherpa-onnx (Settings → Downloads). */
        readonly engine?: 'whisper.cpp' | 'sherpa-onnx';
        readonly executablePath?: string;
        readonly modelPath?: string;
        readonly message: string;
    };
    readonly ffmpeg: {
        readonly available: boolean;
        readonly source: 'configured' | 'environment' | 'bundled' | 'downloaded' | 'path' | 'missing';
        readonly path?: string;
        readonly version?: string;
        readonly message: string;
    };
    readonly comfyUi: {
        readonly configured: boolean;
        readonly available: boolean;
        readonly source: 'configured' | 'missing';
        readonly baseUrl?: string;
        readonly workflowPath?: string;
        readonly workflowName?: string;
        readonly version?: string;
        readonly deviceName?: string;
        readonly nodeCount?: number;
        readonly message: string;
    };
}

export interface DesktopMediaWorkspaceState {
    readonly jobs: readonly MediaJob[];
    readonly runtime: DesktopMediaRuntimeState;
}

export interface EnqueueDesktopMediaJobRequest {
    readonly workspaceRoot: string;
    readonly job: EnqueueMediaJobRequest;
}

export interface SaveDesktopMediaRuntimeRequest {
    readonly ffmpegPath: string;
    readonly comfyUiBaseUrl: string;
    readonly comfyUiWorkflowPath: string;
    readonly whisperExecutablePath?: string;
    readonly whisperModelPath?: string;
}

export interface TranscribeComicShotRequest {
    readonly requestId: string;
    readonly workspaceRoot: string;
    readonly projectId: string;
    readonly sceneId: string;
    readonly shotId: string;
    /** Independent multi-track clip; source time comes from the saved composition. */
    readonly compositionClipId?: string;
    readonly expectedRevision: number;
    /** Independent canvas timeline; when set, projectId/revision refer to its editor project. */
    readonly timelineId?: string;
    readonly expectedTimelineRevision?: number;
    readonly locale?: string;
    /** Align the selected full song locally, independently of the shot's dialogue or visual audio. */
    readonly source?: 'music';
    /** Omitted for local recognition; a paid route must be explicitly selected and confirmed. */
    readonly managedRoute?: {
        readonly connectionId: string;
        readonly model: string;
        /** Bind the catalog quote when advertised; the ceiling caps the full measured request. */
        readonly keyPriceQuoteId?: string;
        readonly maximumPriceMicros?: number;
        readonly costConfirmed: true;
    };
}

export interface TranscribeComicShotResult {
    readonly requestId: string;
    readonly projectId: string;
    readonly sceneId: string;
    readonly shotId: string;
    readonly revision: number;
    readonly timelineId?: string;
    readonly timelineRevision?: number;
    readonly source: 'native_subtitle' | 'whisper.cpp' | 'sherpa-onnx' | 'managed';
    readonly cues: readonly MediaSubtitleCueInput[];
}

export type DesktopTerminalShellKind = 'powershell' | 'cmd' | 'git_bash' | 'wsl' | 'zsh' | 'bash' | 'fish' | 'sh' | 'unknown';
export type DesktopTerminalArchitecture = 'x64' | 'arm64' | 'ia32' | 'other';
export type DesktopTerminalSupportStatus = 'supported' | 'unsupported';
export type DesktopTerminalSupportReason = 'unsupported_architecture' | 'windows_conpty_unavailable' | 'macos_version_unsupported' | 'terminal_profile_unavailable';
export type DesktopWslStatus = 'not_applicable' | 'ready' | 'setup_required' | 'unavailable' | 'probe_failed';
export type DesktopTerminalProfileSource = 'account' | 'path' | 'registry' | 'system' | 'wsl' | 'fallback';

export interface DesktopTerminalProfile {
    readonly id: string;
    readonly shellKind: DesktopTerminalShellKind;
    readonly shellPath: string;
    readonly shellArgs: readonly string[];
    readonly label: string;
    readonly source: DesktopTerminalProfileSource;
    readonly env?: Readonly<Record<string, string>>;
}

export interface DesktopTerminalRuntime {
    readonly platform: 'windows' | 'macos' | 'linux' | 'other';
    readonly architecture: DesktopTerminalArchitecture;
    /** Native host architecture; differs from architecture when an emulated build is running. */
    readonly hostArchitecture: DesktopTerminalArchitecture;
    readonly osRelease: string;
    readonly supportStatus: DesktopTerminalSupportStatus;
    readonly supportReason?: DesktopTerminalSupportReason;
    readonly wslStatus: DesktopWslStatus;
    readonly wslDistributions: readonly string[];
    readonly detectedAt: number;
    /** Compatibility projection of the default profile. */
    readonly shellKind: DesktopTerminalShellKind;
    readonly shellPath: string;
    readonly label: string;
    readonly defaultProfileId: string;
    readonly profiles: readonly DesktopTerminalProfile[];
}

export type DesktopComicExportQuality = 'draft' | 'balanced' | 'high';
export type DesktopComicSubtitleMode = 'none' | 'sidecar' | 'embedded' | 'burned';
export type DesktopComicExportStatus = 'validating' | 'rendering' | 'muxing' | 'completed' | 'failed' | 'cancelled';

export interface GetComicExportDestinationRequest {
    readonly destinationDirectory: string;
    readonly fileName?: string;
    readonly fallbackName: string;
    readonly subtitleMode: DesktopComicSubtitleMode;
}

export interface DesktopComicExportDestination {
    /** Complete, sanitized filename, including .mp4. */
    readonly fileName: string;
    /** Existing video/subtitle basenames in this destination. */
    readonly conflicts: readonly string[];
}

export interface StartDesktopComicExportRequest {
    readonly workspaceRoot: string;
    /** A frozen independent editor timeline; never combined with the legacy episode/composition scope. */
    readonly timelineId?: string;
    readonly expectedTimelineRevision?: number;
    /** Owning canvas for composition export; storyboard exports keep their existing main source. */
    readonly canvasId?: string;
    readonly episodeId?: string;
    /** Export a canvas composition through the same renderer, without rewriting the editor project. */
    readonly compositionNodeId?: string;
    readonly expectedCanvasRevision?: number;
    readonly fileName?: string;
    readonly quality: DesktopComicExportQuality;
    readonly subtitleMode: DesktopComicSubtitleMode;
    readonly allowPlaceholders: boolean;
    readonly verifyAssetIntegrity: boolean;
    /** Absolute folder the finished film (and its subtitle files) is saved to; absent: kept in the project only. */
    readonly destinationDirectory?: string;
    /** Missing preserves legacy automatic numbering. Explicit modes never silently rename. */
    readonly destinationConflict?: 'error' | 'overwrite';
}

export interface DesktopComicExportOutput {
    readonly relativeUri: string;
    readonly subtitleRelativeUri?: string;
    /** Standalone subtitle files produced alongside the MP4. */
    readonly subtitleRelativeUris?: Readonly<{
        readonly srt: string;
        readonly vtt: string;
        readonly ass: string;
    }>;
    readonly byteLength: number;
    readonly sha256: string;
    readonly durationSeconds: number;
    readonly width: number;
    readonly height: number;
    readonly frameRate: ComicFrameRate;
    /** Where the film was saved outside the project (then `relativeUri` no longer holds it). */
    readonly savedPath?: string;
    readonly savedSubtitlePaths?: Readonly<{ readonly srt: string; readonly vtt: string; readonly ass: string }>;
}

export interface DesktopComicExportState {
    readonly id: string;
    readonly projectId: string;
    readonly projectRevision: number;
    readonly projectTitle: string;
    readonly episodeId?: string;
    readonly timelineId?: string;
    readonly sourceCanvasId?: string;
    readonly status: DesktopComicExportStatus;
    readonly quality: DesktopComicExportQuality;
    readonly subtitleMode: DesktopComicSubtitleMode;
    readonly progress: number;
    readonly completedShots: number;
    readonly totalShots: number;
    readonly message: string;
    readonly warnings: readonly string[];
    readonly messageInfo?: import('./nextmux-media-messages').MediaMessage;
    readonly warningInfos?: readonly import('./nextmux-media-messages').MediaMessage[];
    readonly errorInfo?: import('@nextmux/model-runtime/errors').ReadableModelError;
    readonly cancelRequested: boolean;
    readonly cancellable: boolean;
    readonly startedAt: string;
    readonly updatedAt: string;
    readonly finishedAt?: string;
    readonly error?: string;
    readonly output?: DesktopComicExportOutput;
    /** Imported record only: the archive did not contain an MP4 or subtitles. */
    readonly restoredHistoryOnly?: true;
}

export interface DesktopComicExportWorkspaceState {
    readonly exports: readonly DesktopComicExportState[];
    readonly active?: DesktopComicExportState;
    /** The system's Movies / Videos folder for NextMux, used until the user picks another folder. */
    readonly defaultDirectory?: string;
}

export interface DesktopPrivacySettings {
    readonly requireZeroDataRetention: boolean;
    readonly denyDataCollection: boolean;
    readonly saveConversationHistory: boolean;
    readonly saveFileEditorRecovery?: boolean;
    readonly fileEditorRecoveryRevision?: number;
    readonly updatedAt?: string;
}

export type DesktopLocalDataCategory = 'agent_checkpoints' | 'conversation_history' | 'conversation_attachments' | 'comic_history' | 'media_jobs' | 'comic_exports' | 'comic_media_files';

export interface DesktopLocalDataEntry {
    readonly category: DesktopLocalDataCategory;
    readonly bytes: number;
    readonly files: number;
}

export interface DesktopLocalDataState {
    readonly entries: readonly DesktopLocalDataEntry[];
    readonly totalBytes: number;
    readonly scannedAt: string;
    /** Historical external project caches without a host write receipt are not enumerated. */
    readonly attachmentCoverage?: {
        readonly scope: 'registered_and_owned';
        readonly unavailableRoots: number;
        readonly pendingStagingRoots: number;
    };
}

export interface ClearDesktopLocalDataRequest {
    readonly workspaceRoot: string;
    readonly categories: readonly DesktopLocalDataCategory[];
}

export interface DesktopComicHistoryArchiveResult {
    readonly directoryUri: string;
    readonly files: number;
    readonly bytes: number;
}

export interface DesktopComicHistoryImportResult {
    readonly files: number;
    readonly bytes: number;
}

/** Media task records only; generated media and source assets are not in this archive. */
export interface DesktopMediaHistoryArchiveResult {
    readonly fileUri: string;
    readonly jobs: number;
    readonly bytes: number;
}

export interface DesktopMediaHistoryImportResult {
    readonly jobs: number;
    readonly bytes: number;
}

/** Terminal export records only; MP4, subtitles and source assets are excluded. */
export interface DesktopComicExportHistoryArchiveResult {
    readonly fileUri: string;
    readonly records: number;
    readonly bytes: number;
}

export interface DesktopComicExportHistoryImportResult {
    readonly records: number;
    readonly bytes: number;
}

/** Actual files under the current project's nextmux.media directory, not the project file or record archives. */
export interface DesktopComicMediaFilesArchiveResult {
    readonly directoryUri: string;
    readonly files: number;
    readonly bytes: number;
}

export interface DesktopComicMediaFilesImportResult {
    readonly files: number;
    readonly bytes: number;
}

/** An Ollama model download (LobeChat #13): byte progress summed over the model's layers, and Ollama's current step. */
export interface DesktopOllamaPull {
    readonly model: string;
    readonly status: 'pulling' | 'completed' | 'failed';
    readonly completedBytes: number;
    readonly totalBytes: number;
    /** Ollama's own words for the step ("pulling manifest", "verifying sha256 digest" …). */
    readonly step?: string;
    readonly error?: string;
}

export interface DesktopDiagnosticReport {
    readonly fileName: string;
    readonly content: string;
}

export interface NextMuxPlatformService extends ComicOrganizerService {
    getProjectKnowledge(workspaceRoot: string): Promise<import('./nextmux-project-memory').ProjectKnowledgeSnapshot>;
    /**
     * Text of a document attachment for models that cannot read the file natively: at most 110,000 characters, or up
     * to `maxCharacters` (2,000,000 at most) when it will be saved for reading in parts.
     */
    extractAttachmentText(request: { readonly name: string; readonly mimeType: string; readonly dataBase64: string; readonly maxCharacters?: number }): Promise<
        | { readonly ok: true; readonly text: string; readonly method: string; readonly truncated: boolean; readonly pages?: number; readonly note?: string }
        | { readonly ok: false; readonly code: 'unsupported' | 'encrypted' | 'empty' | 'invalid' | 'too_large'; readonly message: string; readonly domainError?: import('./nextmux-domain-errors').DomainMessage }>;
    /**
     * Downloads a model an Ollama connection lacks (its reply said "model not found"), on the user's request; one
     * download per connection and model runs at a time. getOllamaPull reports its progress until a while after it ends.
     */
    pullOllamaModel(request: { readonly connectionId: string; readonly model: string }): Promise<DesktopOllamaPull>;
    getOllamaPull(request: { readonly connectionId: string; readonly model: string }): Promise<DesktopOllamaPull | undefined>;
    /**
     * Saves a long attachment's text as Markdown in this conversation's private folder, where the agent's file tools
     * read it in parts in every permission mode (Cherry Studio #12). Fails closed: the caller then sends the text inline.
     */
    saveAttachmentDocument(request: { readonly conversationId: string; readonly name: string; readonly content: string }): Promise<
        | { readonly ok: true; readonly path: string; readonly lines: number; readonly characters: number }
        | { readonly ok: false }>;
    /** Personal and project AGENTS.md instruction files that every agent run reads. */
    getAgentInstructions(workspaceRoot?: string): Promise<import('./nextmux-agent-instructions').AgentInstructionSnapshot>;
    saveAgentInstructions(request: import('./nextmux-agent-instructions').AgentInstructionSaveRequest): Promise<import('./nextmux-agent-instructions').AgentInstructionFile>;
    saveProjectMemory(workspaceRoot: string, draft: import('./nextmux-project-memory').ProjectMemoryDraft, expectedRevision: number): Promise<import('./nextmux-project-memory').ProjectMemoryDocument>;
    removeProjectMemory(workspaceRoot: string, id: string, expectedRevision: number): Promise<import('./nextmux-project-memory').ProjectMemoryDocument>;
    adoptProjectExperience(workspaceRoot: string, id: string, expectedRevision: number, verification: string, expectedSourceSha256: string): Promise<import('./nextmux-project-memory').ProjectMemoryDocument>;
    ensureProjectDesign(workspaceRoot: string): Promise<string>;
    /** Backend-to-renderer browser bridge used by the built-in Agent tools. */
    setDesktopComputerCapability(capability: DesktopComputerCapability): Promise<void>;
    getComputerToolRequests(): Promise<readonly DesktopComputerToolRequest[]>;
    resolveComputerToolRequest(result: DesktopComputerToolResult): Promise<{ readonly accepted: boolean }>;
    getBrowserToolRequests(): Promise<readonly DesktopBrowserToolRequest[]>;
    resolveBrowserToolRequest(result: DesktopBrowserToolResult): Promise<{ readonly accepted: boolean }>;
    recoverManagedReceipt(requestId: string, expectedOwner?: PendingManagedReceiptIdentity): Promise<import('./nextmux-billing-receipts').BillingReceiptRecovery>;
    saveManagedReceiptMedia(requestId: string, ownerId: string): Promise<string>;
    getMcpAccess(): Promise<readonly import('./nextmux-mcp-access').McpServerAccess[]>;
    getCloudSpeechSettings(): Promise<import('./nextmux-speech-input').CloudSpeechSettingsState>;
    configureCloudSpeech(settings: import('./nextmux-speech-input').CloudSpeechSettings): Promise<import('./nextmux-speech-input').CloudSpeechSettingsState>;
    transcribeCloudSpeech(request: import('./nextmux-speech-input').CloudSpeechRequest): Promise<import('./nextmux-speech-input').CloudSpeechResult>;
    cancelCloudSpeech(requestId: string, ownerId: string): Promise<{ readonly cancelled: true }>;
    reviewMcpAccess(serverName: string): Promise<readonly import('./nextmux-mcp-access').McpServerAccess[]>;
    changeMcpAccess(change: import('./nextmux-mcp-access').McpAccessChange): Promise<readonly import('./nextmux-mcp-access').McpServerAccess[]>;
    changeMcpCredential(change: import('./nextmux-mcp-access').McpCredentialChange): Promise<import('./nextmux-mcp-access').McpCredentialChangeResult>;
    getCatalog(): Promise<PlatformCatalog>;
    /** The next slice of the global list after getCatalog (or a previous slice). */
    getCatalogPage(after: string): Promise<PlatformCatalog>;
    /** A small version of the cloud model list and its prices; download them again only when it changes. */
    getModelCatalogVersion(): Promise<{ readonly version: string; readonly models: number; readonly updatedAt: number }>;
    /** One listed offering as it is priced right now (undefined when it is no longer listed). */
    getCatalogOffering(offeringId: string): Promise<PlatformOffering | undefined>;
    /** Authenticated original-selection identity only; never makes a withdrawn API selectable. */
    getRetainedManagedOffering(offeringId: string, keyPriceQuoteId: string): Promise<PlatformOffering | undefined>;
    getPublicMerchantDirectory(query?: PublicMerchantDirectoryQuery, force?: boolean): Promise<PublicMerchantDirectoryPage>;
    getPublicMerchantCapacity(merchantIds: readonly string[], scope: PublicMerchantCapacityScope): Promise<PublicMerchantCapacitySnapshot>;
    /** 默认模型: the relay model each comic kind × step uses when the user has not chosen one (set in the platform admin). */
    getComicStepDefaults(): Promise<readonly ComicStepDefault[]>;
    getMerchantCatalog(merchantId: string, after?: string, force?: boolean): Promise<PlatformMerchantCatalogPage>;
    getMerchantSupportCatalog(merchantId: string, query?: PlatformMerchantSupportQuery, force?: boolean): Promise<PlatformMerchantSupportCatalogPage>;
    getMerchantDiscoveredModels(merchantId: string, after?: string, force?: boolean): Promise<PlatformMerchantDiscoveredModelsPage>;
    getRelayFeedback(requestId: string): Promise<PlatformRelayFeedback>;
    submitRelayFeedback(requestId: string, vote: RelayFeedbackVote): Promise<PlatformRelayFeedbackSubmission>;
    getRelayFeedbackBatch(requestIds: readonly string[]): Promise<PlatformRelayFeedbackBatch>;
    submitRelayFeedbackBatch(requestIds: readonly string[], vote: RelayFeedbackVote): Promise<PlatformRelayFeedbackBatchSubmission>;
    getModelRegistry(force?: boolean): Promise<readonly PlatformRegistryModel[]>;
    getGlobalModelCatalog(force?: boolean): Promise<PlatformGlobalModelCatalog>;
    getDeviceSession(): Promise<PlatformDeviceSession>;
    getAccountOverview(): Promise<PlatformAccountOverview>;
    getMerchantUsageOverview(query?: PlatformMerchantUsageQuery): Promise<PlatformMerchantUsagePage>;
    getUsageHistory(query: PlatformUsageHistoryQuery): Promise<PlatformUsageHistoryPage>;
    getWalletTopupOptions(): Promise<PlatformWalletTopupOptions>;
    createWalletTopup(amountMinor: number, currency?: string): Promise<PlatformWalletTopupOrder>;
    getWalletTopupStatus(topupId: string): Promise<PlatformWalletTopupOrder>;
    startDeviceLink(label?: string): Promise<PlatformDeviceLink>;
    completeDeviceLink(nonce: string): Promise<PlatformDeviceSession>;
    /** Sign this desktop out of its NextMux account (the device stays known, unlinked). */
    signOutDevice(): Promise<{ readonly linked: false }>;
    /** Send a bug report or suggestion from the signed-in account. */
    submitFeedback(input: PlatformFeedbackInput): Promise<{ readonly id: string }>;
    getPlatformWebLinks(): Promise<PlatformWebLinks>;
    invokeManagedGateway(route: ManagedGatewayRoute, prompt: string, clientRequestId: string): Promise<ManagedGatewayResult>;
    completeManagedGateway(route: ManagedGatewayRoute, request: ManagedGatewayRequest, clientRequestId: string): Promise<ManagedGatewayResult>;
    getOfficialModelConnections(): Promise<OfficialModelConnectionsState>;
    discoverLocalModels(baseUrl: string): Promise<OfficialModelConnection['discoveredModels']>;
    /** The names the user sees for NextMux's controls, in their interface language, quoted in the model's (English) instructions. */
    setAgentUiLabels(labels: Readonly<Record<string, string>>): Promise<void>;
    /** Own-API calls made outside coding conversations (comic scripts, pictures, voices, clips), newest first. */
    listOwnApiUsage?(): Promise<readonly OwnApiUsageEntry[]>;
    getOfficialConnectionApiKey(connectionId: string): Promise<string>;
    saveOfficialModelConnection(request: SaveOfficialModelConnectionRequest): Promise<SaveOfficialModelConnectionResult>;
    refreshOfficialModelDiscovery(connectionId: string): Promise<OfficialModelConnection>;
    validateOfficialModelSelection(connectionId: string, model: string): Promise<OfficialModelConnection>;
    removeOfficialModelConnection(connectionId: string): Promise<{ readonly removed: true }>;
    getNetworkSettings(): Promise<DesktopNetworkSettings>;
    getWorkspaceGitState(workspaceRoot: string): Promise<DesktopGitState>;
    /** Whether a file is really inside the workspace once links are resolved; its real path when it is. */
    resolveWorkspaceFile(workspaceRoot: string, filePath: string): Promise<{ readonly inside: boolean; readonly path?: string }>;
    /** Manual current-workspace copy/move: no overwrite, no links or special files; cross-device moves are refused. */
    copyOrMoveWorkspaceFile(workspaceRoot: string, sourcePath: string, destinationPath: string, operation: 'copy' | 'move'): Promise<void>;
    /** Show a file in Finder (macOS) or File Explorer (Windows), selected. False when it does not exist. */
    revealInFileManager(path: string): Promise<boolean>;
    /** Open a folder itself in Finder (macOS) or File Explorer (Windows). False when it is not an existing folder. */
    openFolderInFileManager(path: string): Promise<boolean>;
    getWorkspaceSiteState(workspaceRoot: string): Promise<DesktopSiteState>;
    startWorkspaceSite(workspaceRoot: string, script: string): Promise<DesktopSiteProcess>;
    stopWorkspaceSite(workspaceRoot: string, processId: string): Promise<DesktopSiteProcess>;
    registerDesktopScheduledTask(request: DesktopScheduledTaskRegistrationRequest): Promise<DesktopScheduledTaskRegistrationResult>;
    claimDesktopScheduledTaskRun(taskId: string, occurrenceAt: number): Promise<{ readonly claimed: boolean }>;
    loadDesktopScheduledTasks(legacy?: readonly import('./nextmux-schedule').ScheduledTaskRecord[]): Promise<readonly import('./nextmux-schedule').ScheduledTaskRecord[]>;
    saveDesktopScheduledTasks(patch: { readonly upsert: readonly import('./nextmux-schedule').ScheduledTaskRecord[]; readonly remove: readonly string[] }): Promise<void>;
    upsertDesktopScheduledTask(task: import('./nextmux-schedule').ScheduledTaskRecord, expectedRevision?: number): Promise<import('./nextmux-schedule').ScheduledTaskRecord>;
    removeDesktopScheduledTask(taskId: string): Promise<{ readonly removed: true }>;
    getCommunitySkills(force?: boolean): Promise<DesktopCommunitySkillsState>;
    /** Measured aspect ratios and frame rates per video model (platform /api/models/video-profiles), cached for an hour. */
    getVideoModelProfiles(force?: boolean): Promise<unknown>;
    /** The GitHub account linked for AI tasks (token kept in the OS keychain, never returned). */
    getGitHubAccount(): Promise<import('./nextmux-github-account').GitHubAccountState>;
    connectGitHubAccount(token: string): Promise<import('./nextmux-github-account').GitHubAccountState>;
    disconnectGitHubAccount(): Promise<import('./nextmux-github-account').GitHubAccountState>;
    setGitHubAgentAccess(allow: boolean): Promise<import('./nextmux-github-account').GitHubAccountState>;
    /** GitHub's MCP registry (github.com/mcp), cached for six hours. */
    getMcpRegistry(force?: boolean): Promise<import('./nextmux-mcp-registry').McpRegistryState>;
    installCommunitySkill(id: string, review?: DesktopCommunitySkillInstallReview): Promise<DesktopCommunitySkillActionResult>;
    /** Install a catalog Skill from a supported GitHub URL (the URL is resolved against the verified catalog). */
    installCommunitySkillFromUrl(url: string, review?: DesktopCommunitySkillInstallReview): Promise<DesktopCommunitySkillActionResult>;
    removeCommunitySkill(id: string): Promise<DesktopCommunitySkillActionResult>;
    /** Uninstall a Skill folder in NextMux's own Skills folder (installed or written by the AI), by its SKILL.md path. */
    removeInstalledSkill(location: string): Promise<{ readonly removed: boolean }>;
    cacheDesktopAttachment(request: DesktopAttachmentCacheRequest): Promise<DesktopAttachmentCacheRecord>;
    readDesktopAttachment(request: DesktopAttachmentReadRequest): Promise<DesktopAttachmentReadResult>;
    readAgentOutputAsset(request: DesktopAgentOutputAssetReadRequest): Promise<DesktopAgentOutputAssetReadResult>;
    planComicText(request: { readonly route: DesktopAgentModelRoute; readonly workspaceRoot: string; readonly prompt: string; readonly attachments?: readonly AgentMessageAttachment[]; readonly maximumOutputTokens?: number }): Promise<string>;
    getComicTextModelLimits(route: DesktopAgentModelRoute): Promise<{ contextWindowTokens?: number; modelOutputTokenLimit?: number; modelInputTokenLimit?: number }>;
    saveComicScriptsPlan(request: { readonly workspaceRoot: string; readonly expectedRevision: number; readonly scripts: unknown; readonly mode: 'replace' | 'append' }): Promise<DesktopComicProjectState>;
    saveComicStoryboardPlan(request: { readonly workspaceRoot: string; readonly episodeNumber: number; readonly expectedScript: string; readonly adaptation: unknown }): Promise<DesktopComicProjectState>;
    runAgent(request: DesktopAgentRunRequest): Promise<DesktopAgentRunResult>;
    startAgentRun(request: DesktopAgentRunRequest): Promise<DesktopAgentRunStartResult>;
    getAgentDurableRecovery(request: DesktopAgentDurableRecoveryRequest): Promise<DesktopAgentDurableRecoveryResult>;
    retryAgentDurableOperation(request: DesktopAgentDurableRetryRequest): Promise<DesktopAgentRunStartResult>;
    /** Stop pressed before a start returned: the start with this token is not accepted if it has not been yet. */
    withdrawAgentStart?(startToken: string): Promise<void>;
    getQueuedAgentSubmission(conversationId: string, requestId: string): Promise<DesktopQueuedSubmissionStatus>;
    updateAgentRunSwitchPolicy(runId: string, taskId: string, route: ManagedGatewayRoute, policy: ModelSwitchPolicy): Promise<{ readonly revision: number; readonly applies: 'next_model_turn' }>;
    getAgentRunSnapshot(runId: string, afterEventIndex?: number, waitMs?: number, recoveryOwnerHint?: DesktopAgentRunRecoveryOwnerHint): Promise<DesktopAgentRunSnapshot>;
    listConversationAgentRuns(conversationId: string, cursor?: string, limit?: number): Promise<DesktopAgentRunHistoryPage>;
    readConversationAgentRun(conversationId: string, runId: string): Promise<DesktopAgentRunHistoryDetail | undefined>;
    /** Read compact child-lineage diagnostics after the live job has expired or the UI restarted. */
    getAgentDelegationLedger(rootRunId: string, conversationId: string): Promise<AgentDelegationLedger | undefined>;
    sendAgentRunMessage(runId: string, message: string): Promise<DesktopAgentRunMessageResult>;
    answerAgentRunQuestion(answer: AgentUserQuestionAnswer): Promise<{ readonly accepted: true; readonly replayed?: boolean }>;
    writeAgentProcess(runId: string, processId: string, data: string): Promise<DesktopAgentProcessWriteResult>;
    resizeAgentProcess(runId: string, processId: string, columns: number, rows: number): Promise<DesktopAgentProcessResizeResult>;
    terminateAgentProcess(runId: string, processId: string): Promise<DesktopAgentProcessTerminateResult>;
    cancelAgentRun(runId: string, reason?: 'user_stop' | 'exit_incognito' | 'client_shutdown'): Promise<{ readonly cancelled: true; readonly status: 'cancelled' }>;
    syncConversationIndex(records: readonly DesktopConversationIndexRecord[]): Promise<{ readonly conversations: number; readonly messages: number }>;
    listEditorDraftRecoveries(): Promise<EditorDraftRecoveryState>;
    openEditorDraftRecovery(request: EditorDraftRecoveryRequest): Promise<EditorDraftRecoveryOpenResult>;
    saveEditorDraftRecovery(request: EditorDraftRecoverySaveRequest): Promise<EditorDraftRecoveryAck>;
    discardEditorDraftRecovery(request: EditorDraftRecoveryDiscardRequest): Promise<{ readonly discarded: true }>;
    saveEditorDraftAsNewFile(request: EditorDraftSaveAsRequest): Promise<EditorDraftSaveAsResult>;
    listFileHistory(sourceUri: string): Promise<readonly FileHistoryEntry[]>;
    readFileHistory(sourceUri: string, id: string): Promise<FileHistoryVersion>;
    recordFileHistory(request: FileHistoryRecordRequest): Promise<FileHistoryEntry>;
    readConversationReceipts(ids: readonly string[], noticeIds?: readonly string[]): Promise<readonly import('./nextmux-conversation-attention').ConversationReadReceipt[]>;
    markConversationRead(receipt: import('./nextmux-conversation-attention').ConversationReadReceipt): Promise<import('./nextmux-conversation-attention').ConversationReadReceipt>;
    listIncognitoConversations(): Promise<readonly { readonly id: string; readonly workspaceRoot: string }[]>;
    canReuseEmptyConversation(id: string): Promise<boolean>;
    createIncognitoConversation(): Promise<{ readonly id: string; readonly workspaceRoot: string }>;
    setConversationIncognito(request: { readonly id: string; readonly incognito: boolean; readonly expectedRevision: number; readonly draftOnly?: boolean; readonly expectedUpdatedAt?: number }): Promise<{ readonly session: Record<string, unknown>; readonly workspaceRoot: string; readonly revision: number; readonly removedSessionId?: string }>;
    bindConversationDraftWorkspace(request: { readonly id: string; readonly workspacePath: string; readonly expectedUpdatedAt: number; readonly expectedRevision?: number }): Promise<{ readonly session: Record<string, unknown>; readonly workspaceRoot: string }>;
    closeIncognitoConversations(ids: readonly string[], all?: boolean): Promise<{ readonly deleted: readonly string[] }>;
    loadConversationHistory(): Promise<DesktopConversationHistoryLoadResult>;
    listConversationHistory(request?: DesktopConversationHistoryListRequest): Promise<DesktopConversationHistoryListResult>;
    listConversationHistoryProjects(request?: DesktopConversationHistoryProjectsRequest): Promise<DesktopConversationHistoryProjectsResult>;
    readConversationHistorySession(id: string): Promise<Record<string, unknown> | undefined>;
    saveConversationHistory(sessions: readonly unknown[]): Promise<DesktopConversationHistorySaveResult>;
    /** Find conversations in Claude Code, Claude Cowork, Codex and Cursor on this machine (read-only). */
    scanConversationImports(): Promise<import('./nextmux-conversation-import-protocol').ConversationImportScan>;
    importConversations(request: import('./nextmux-conversation-import-protocol').ConversationImportRequest): Promise<import('./nextmux-conversation-import-protocol').ConversationImportResult>;
    /** Extra folders to look in for one source (a tool installed or moved elsewhere). */
    setConversationImportRoots(source: import('./nextmux-conversation-import-protocol').ConversationImportSource, roots: readonly string[]): Promise<import('./nextmux-conversation-import-protocol').ConversationImportScan>;
    /** Undo an import: remove those conversations and forget that they were imported. */
    /** undoBatch: the last import batch is undone, so a conversation it only updated goes back to its earlier version. */
    removeImportedConversations(sessionIds: readonly string[], undoBatch?: boolean): Promise<{ readonly removed: number; readonly restored?: readonly string[] }>;
    patchConversationHistory(request: DesktopConversationHistoryPatchRequest): Promise<DesktopConversationHistoryPatchResult>;
    deleteProjectConversationHistory(workspacePath: string): Promise<{ readonly removedSessionIds: readonly string[] }>;
    searchConversationHistory(request: DesktopConversationSearchRequest): Promise<DesktopConversationSearchResult>;
    clearConversationHistory(): Promise<{ readonly cleared: true }>;
    exportConversationArchive(destinationUri: string, sessionIds?: readonly string[], options?: ConversationArchiveExportOptions): Promise<ConversationArchiveExportResult>;
    previewConversationArchive(sourceUri: string): Promise<ConversationArchivePreview>;
    prepareConversationArchiveBindings(previewId: string, bindings: readonly ConversationArchiveProjectBinding[]): Promise<ConversationArchivePreview>;
    importConversationArchive(previewId: string, conflictPolicy: 'skip' | 'copy'): Promise<ConversationArchiveImportResult>;
    getConversationWorkspace(conversationId: string): Promise<string>;
    getConversationWorkspaceBindings(conversationId: string, existingForkOnly?: boolean): Promise<ConversationWorkspaceBindings>;
    validateConversationWorkspaceBindings(workspaceRoot: string, bindings: NonNullable<DesktopAgentRunRequest['workspaceBindings']>, permissionMode: AgentPermissionMode): Promise<{
        readonly workspaceRoot: string; readonly primaryBindingId: string;
        readonly bindings: NonNullable<DesktopAgentRunRequest['workspaceBindings']>;
    }>;
    forkConversationWorkspaces(request: ConversationMultiWorkspaceForkRequest): Promise<ConversationMultiWorkspaceForkResult>;
    forkConversationWorkspace(
        sourceConversationId: string,
        targetConversationId: string,
        checkpointIds?: readonly string[]
    ): Promise<ConversationWorkspaceForkResult>;
    forkProjectConversationWorkspace(
        sourceConversationId: string,
        targetConversationId: string,
        sourceWorkspaceRoot: string,
        checkpointIds?: readonly string[]
    ): Promise<ConversationWorkspaceForkResult>;
    discardConversationWorkspace(conversationId: string): Promise<{ readonly deleted: boolean }>;
    getTerminalRuntime(refresh?: boolean): Promise<DesktopTerminalRuntime>;
    terminateTerminalProcessTree(terminalId: number): Promise<{ readonly terminated: boolean }>;
    /** Default includes historical contents; summary is bounded, before/after compares the live file to that restore target. */
    getAgentCheckpointDiff(workspaceRoot: string, checkpointId: string, preview?: 'summary' | 'before' | 'after'): Promise<AgentCheckpointDiff>;
    restoreAgentFileVersion(request: AgentFileVersionRestoreRequest): Promise<AgentFileVersionRestoreResult>;
    getAgentFileState(request: AgentFileStateRequest): Promise<AgentFileState>;
    saveCodingGoalFile(request: AgentFileVersionSaveRequest): Promise<AgentFileState>;
    listAgentFileVersions(request: AgentFileVersionsRequest): Promise<AgentFileVersionsPage>;
    saveAgentFileVersion(request: AgentFileVersionSaveRequest): Promise<Omit<AgentFileVersionRestoreResult, 'restored'>>;
    restoreAgentCheckpoint(workspaceRoot: string, checkpointId: string): Promise<CheckpointRestoreResult>;
    restoreAgentCheckpointChain(workspaceRoot: string, checkpointIds: readonly string[]): Promise<CheckpointChainRestoreResult>;
    restoreAgentCheckpointGroups(groups: readonly { readonly workspaceRoot: string; readonly checkpointIds: readonly string[]; readonly targets?: readonly { readonly checkpointId: string; readonly side: 'before' | 'after' }[] }[], owner?: { readonly conversationId: string; readonly turnId: string }): Promise<CheckpointChainRestoreResult>;
    getComicProject(workspaceRoot: string): Promise<DesktopComicProjectState>;
    getComicCanvas(workspaceRoot: string, canvasId?: string): Promise<DesktopComicCanvasState>;
    getComicCanvasCapability(request: { readonly connectionId: string; readonly modelId: string; readonly kind: 'image' | 'video' }): Promise<CanvasModelCapability>;
    saveComicCanvas(request: SaveDesktopComicCanvasRequest): Promise<DesktopComicCanvasState>;
    createComicCanvasTimeline(request: CreateComicCanvasTimelineRequest): Promise<CanvasTimelineDocument>;
    listComicCanvasTimelines(workspaceRoot: string, canvasId?: string): Promise<readonly CanvasTimelineSummary[]>;
    getComicCanvasTimeline(workspaceRoot: string, timelineId: string): Promise<CanvasTimelineDocument>;
    applyComicCanvasTimelineEdits(request: ApplyComicCanvasTimelineEditsRequest): Promise<ComicCanvasTimelineEditResult>;
    restoreComicCanvasTimeline(request: RestoreComicCanvasTimelineRequest): Promise<CanvasTimelineDocument>;
    exportComicCanvasDownload(request: ExportCanvasDownloadRequest): Promise<CanvasDownloadResult>;
    cancelComicCanvasDownload(request: CanvasDownloadScope): Promise<void>;
    seedComicCanvas(request: SeedDesktopComicCanvasRequest): Promise<DesktopComicCanvasState>;
    commitComicCanvasToProject(request: CommitDesktopComicCanvasRequest): Promise<DesktopComicProjectState>;
    runComicCanvasNode(request: RunDesktopComicCanvasNodeRequest): Promise<DesktopComicCanvasGenerationResult>;
    getComicCanvasStartFramePlan(request: GetDesktopComicCanvasStartFramePlanRequest): Promise<DesktopComicCanvasStartFramePlan>;
    runComicCanvasStartFrame(request: RunDesktopComicCanvasStartFrameRequest): Promise<DesktopComicCanvasStartFrameResult>;
    getComicCanvasStartFrame(request: GetDesktopComicCanvasStartFrameRequest): Promise<DesktopComicCanvasStartFrameResult>;
    applyComicCanvasStartFrame(request: ApplyDesktopComicCanvasStartFrameRequest): Promise<DesktopComicCanvasState>;
    runComicCanvasTool(request: RunDesktopComicCanvasToolRequest): Promise<DesktopComicCanvasToolRunResult>;
    getComicCanvasToolJob(workspaceRoot: string, requestId: string, canvasId?: string): Promise<DesktopComicCanvasToolResult>;
    cancelComicCanvasTool(workspaceRoot: string, requestId: string, canvasId?: string): Promise<DesktopComicCanvasToolResult>;
    /** Copy a user-chosen .cube file into the project (LUT tools only read project files); returns its project-relative path. */
    importComicCanvasLut(request: { readonly workspaceRoot: string; readonly path: string }): Promise<{ readonly path: string }>;
    getComicCanvasModelToolRoute(request: GetDesktopComicCanvasModelToolRouteRequest): Promise<CanvasModelToolRoutePlan>;
    runComicCanvasModelTool(request: RunDesktopComicCanvasModelToolRequest): Promise<DesktopComicCanvasModelToolResult>;
    recoverComicCanvasJobs(workspaceRoot: string, canvasId?: string): Promise<DesktopComicCanvasState>;
    importComicCanvasAsset(request: ImportDesktopComicCanvasAssetRequest): Promise<{ readonly state: DesktopComicCanvasState; readonly nodeId: string; readonly assetId: string }>;
    saveComicDirectorCapture(request: SaveComicDirectorCaptureRequest): Promise<ComicDirectorCaptureResult>;
    saveComicCanvasMarkedImage(request: SaveComicCanvasMarkedImageRequest): Promise<ComicDirectorCaptureResult>;
    importComicDirectorModel(request: ImportComicDirectorModelRequest): Promise<ComicDirectorModelImportResult>;
    beginComicDirectorUpload(request: BeginComicDirectorUploadRequest): Promise<ComicDirectorUploadState>;
    appendComicDirectorUpload(request: AppendComicDirectorUploadRequest): Promise<ComicDirectorUploadState>;
    discardComicDirectorUpload(request: { readonly workspaceRoot: string; readonly uploadId: string }): Promise<void>;
    extractComicCanvasFrame(request: ExtractDesktopComicCanvasFrameRequest): Promise<DesktopComicCanvasState>;
    extractComicCanvasInputFrame(request: ExtractDesktopComicCanvasInputFrameRequest): Promise<import('@nextmux/comic-core/canvas').CanvasAssetVersion>;
    bindComicCanvasCharacter(request: BindDesktopComicCanvasCharacterRequest): Promise<DesktopComicProjectState>;
    createComicProject(request: CreateDesktopComicProjectRequest): Promise<DesktopComicProjectState>;
    updateComicScript(request: UpdateDesktopComicScriptRequest): Promise<DesktopComicProjectState>;
    applyComicAnalysis(request: ApplyDesktopComicAnalysisRequest): Promise<DesktopComicProjectState>;
    applyComicCommand(request: ApplyDesktopComicCommandRequest): Promise<DesktopComicProjectState>;
    getMediaWorkspaceState(workspaceRoot: string): Promise<DesktopMediaWorkspaceState>;
    enqueueMediaJob(request: EnqueueDesktopMediaJobRequest): Promise<MediaJob>;
    confirmMediaJob(workspaceRoot: string, jobId: string): Promise<MediaJob>;
    pauseMediaJob(workspaceRoot: string, jobId: string): Promise<MediaJob>;
    resumeMediaJob(workspaceRoot: string, jobId: string): Promise<MediaJob>;
    cancelMediaJob(workspaceRoot: string, jobId: string): Promise<MediaJob>;
    retryMediaJob(workspaceRoot: string, jobId: string): Promise<MediaJob>;
    regenerateMediaJob(workspaceRoot: string, jobId: string): Promise<MediaJob>;
    dismissMediaJob(workspaceRoot: string, jobId: string): Promise<{ readonly removed: true }>;
    getMediaRuntimeState(): Promise<DesktopMediaRuntimeState>;
    saveMediaRuntime(request: SaveDesktopMediaRuntimeRequest): Promise<DesktopMediaRuntimeState>;
    transcribeComicShot(request: TranscribeComicShotRequest): Promise<TranscribeComicShotResult>;
    /** Read verified external subtitle assets for the editor; no inference or project mutation. */
    getComicCompositionSubtitlePreview(request: { readonly workspaceRoot: string; readonly projectId: string; readonly expectedRevision: number; readonly timelineId?: string }): Promise<{
        readonly projectId: string; readonly revision: number;
        readonly cues: Readonly<Record<string, readonly { readonly text: string; readonly startFrame: number; readonly durationFrames: number }[]>>;
    }>;
    cancelComicShotTranscription(workspaceRoot: string, requestId: string): Promise<{ readonly cancelled: boolean }>;
    getComicExportWorkspaceState(workspaceRoot: string): Promise<DesktopComicExportWorkspaceState>;
    getComicExportDestination(request: GetComicExportDestinationRequest): Promise<DesktopComicExportDestination>;
    startComicExport(request: StartDesktopComicExportRequest): Promise<DesktopComicExportState>;
    cancelComicExport(workspaceRoot: string, exportId: string): Promise<DesktopComicExportState>;
    listComicCharacterLibrary(): Promise<readonly DesktopComicCharacterLibraryEntry[]>;
    comicAssetLibraryCategories(): Promise<readonly import('./nextmux-comic-asset-library').ComicAssetCategoryOption[]>;
    listComicAssetLibrary(): Promise<readonly import('./nextmux-comic-asset-library').ComicAssetLibraryEntry[]>;
    saveComicLocalAssetToLibrary(request:import('./nextmux-comic-asset-library').SaveComicLocalAssetRequest):Promise<import('./nextmux-comic-asset-library').ComicAssetLibraryEntry>;
    setComicAssetLibraryPinned(request:import('./nextmux-comic-asset-library').PinComicAssetLibraryRequest):Promise<void>;
    setComicAssetLibraryCategory(request:import('./nextmux-comic-asset-library').SetComicAssetLibraryCategoryRequest):Promise<void>;
    deleteComicAssetLibraryAsset(assetId:string):Promise<void>;
    saveComicCanvasAssetToLibrary(request: import('./nextmux-comic-asset-library').SaveComicCanvasAssetRequest): Promise<import('./nextmux-comic-asset-library').ComicAssetLibraryEntry>;
    importComicAssetLibraryAsset(request: import('./nextmux-comic-asset-library').ImportComicLibraryAssetRequest): Promise<{ readonly state: DesktopComicCanvasState; readonly nodeId: string }>;
    /** Comic projects live in their own library folder, never inside coding projects. */
    /** `extraPaths`: comics opened from folders outside the library, listed with it. */
    listComicLibrary(extraPaths?: readonly string[]): Promise<DesktopComicLibraryState>;
    createComicLibraryProject(request: CreateComicLibraryProjectRequest): Promise<CreateComicLibraryProjectResult>;
    /** Use a local picture as a shot's image; video generation then animates it (first frame). */
    importComicShotImage(request: ImportComicShotImageRequest): Promise<DesktopComicProjectState>;
    /** Editor: copy images, videos and audio into the comic's media library. */
    importComicMedia(request: ImportDesktopComicMediaRequest): Promise<ImportDesktopComicMediaResult>;
    /** 漫剧对话 (nextmux-comic-chat.ts): a comic project's conversations, one file each in the project folder. */
    listComicChats(workspaceRoot: string): Promise<readonly import('./nextmux-comic-chat').ComicChatSummary[]>;
    comicChatFolders(paths: readonly string[]): Promise<readonly import('./nextmux-comic-chat').ComicChatFolder[]>;
    openComicChatFolder(path?: string, locale?: string): Promise<import('./nextmux-comic-chat').ComicChatFolder>;
    listComicMaterials(paths: readonly string[]): Promise<readonly import('./nextmux-comic-chat').ComicMaterialProject[]>;
    /** A folder's 素材库 (asset IDs, newest first); add or remove materials of that folder. */
    comicMaterialLibrary(workspaceRoot: string): Promise<readonly string[]>;
    updateComicMaterialLibrary(workspaceRoot: string, change: { readonly add?: readonly string[]; readonly remove?: readonly string[] }): Promise<readonly string[]>;
    readComicChat(workspaceRoot: string, chatId: string): Promise<import('./nextmux-comic-chat').ComicChat>;
    saveComicChat(workspaceRoot: string, chat: import('./nextmux-comic-chat').ComicChat): Promise<import('./nextmux-comic-chat').ComicChatSummary>;
    /** Settings → Downloads: open-source tools fetched after installation (FFmpeg, speech recognition, Chromium). */
    getDesktopComponents(locale: string): Promise<import('./nextmux-components').DesktopComponentsState>;
    downloadDesktopComponent(id: import('./nextmux-components').DesktopComponentId, locale: string): Promise<import('./nextmux-components').DesktopComponentsState>;
    cancelDesktopComponentDownload(id: import('./nextmux-components').DesktopComponentId, locale: string): Promise<import('./nextmux-components').DesktopComponentsState>;
    removeDesktopComponent(id: import('./nextmux-components').DesktopComponentId, locale: string): Promise<import('./nextmux-components').DesktopComponentsState>;
    setDesktopComponentsAutoDownload(enabled: boolean, locale: string): Promise<import('./nextmux-components').DesktopComponentsState>;
    /** Chooses the natural voice spoken replies use (Settings → Downloads). */
    setDesktopVoice(voice: string, locale: string): Promise<import('./nextmux-components').DesktopComponentsState>;
    /** A reply read aloud in the natural local voice; undefined when it is not downloaded or does not speak the language. */
    synthesizeSpeech(text: string, locale: string, voice?: string): Promise<{ readonly mimeType: 'audio/wav'; readonly dataBase64: string } | undefined>;
    /** After start-up: quietly queue the recommended downloads that are missing (when automatic downloads are on). */
    ensureDesktopComponents(locale: string): Promise<import('./nextmux-components').DesktopComponentsState>;
    /** Topic to video: free stock libraries (Pexels / Pixabay) with the user's own key, kept in the keychain. */
    getStockMediaState(): Promise<import('./nextmux-stock-media').StockMediaState>;
    saveStockMediaKey(provider: import('./nextmux-stock-media').StockMediaProvider, key: string): Promise<import('./nextmux-stock-media').StockMediaState>;
    deleteStockMediaKey(provider: import('./nextmux-stock-media').StockMediaProvider): Promise<import('./nextmux-stock-media').StockMediaState>;
    /** Shots without a picture get a stock picture or clip (searched by the shot's picture prompt). */
    fillComicShotsWithStock(request: import('./nextmux-stock-media').FillComicShotsWithStockRequest): Promise<import('./nextmux-stock-media').FillComicShotsWithStockResult>;
    /** Editor: apply one timeline action (insert clips, lay audio, trim, split…) in one write. */
    applyComicEdits(request: ApplyDesktopComicEditsRequest): Promise<ApplyDesktopComicEditsResult>;
    /** Editor undo / redo. */
    restoreComicProject(request: RestoreDesktopComicProjectRequest): Promise<DesktopComicProjectState>;
    /** Fuzzy editor voice command → one intent, via the user's OpenRouter key (TypeSafe Jev). Undefined when unavailable. */
    classifyComicVoiceIntent(request: import('./nextmux-voice-intent').ClassifyComicVoiceIntentRequest): Promise<import('./nextmux-voice-intent').ClassifyComicVoiceIntentResult | undefined>;
    /** Skill plugins (技能插件): one decision from the plugin's fast model; keys and the platform credential stay here. */
    decideAppPlugin(request: import('./nextmux-app-plugins').AppPluginDecisionRequest): Promise<import('./nextmux-app-plugins').AppPluginDecisionResult>;
    /** Skill plugins: a vision model's short description of the tab's screen. */
    describeAppPluginFrame(request: import('./nextmux-app-plugins').AppPluginDescribeRequest): Promise<import('./nextmux-app-plugins').AppPluginDescribeResult>;
    /** Cancel a plugin request owned by this backend connection. */
    cancelAppPluginRequest(requestId: string): Promise<void>;
    /** Skill plugins: decision models from the platform and the user's OpenRouter key. */
    appPluginModelChoices(query?: { readonly connectionId?: string }): Promise<import('./nextmux-app-plugins').AppPluginModelChoices>;
    /** Skill plugins: the models a decision or vision server on this computer offers. */
    probeAppPluginServer(endpoint: string): Promise<import('./nextmux-app-plugins').AppPluginServerProbe>;
    /** Skill plugin marketplace: reviewed plugins listed on the platform. */
    listAppPluginMarket(query: { q?: string; cursor?: string; app?: string }): Promise<import('./nextmux-app-plugins').AppPluginMarketList>;
    appPluginMarketDetail(id: string): Promise<import('./nextmux-app-plugins').AppPluginMarketDetail>;
    /** Downloads a reviewed version; its digest and review signature are checked before it is returned. */
    downloadAppPluginFromMarket(id: string, version: string): Promise<import('./nextmux-app-plugins').AppPluginMarketDownload>;
    /** 我的插件: what this account and this device uploaded, with the review result and failed uploads. */
    myAppPlugins(): Promise<import('./nextmux-app-plugins').AppPluginMine>;
    /** Uploads a .nmxplugin to the marketplace (signed-in accounts only); free or a USD price; the code review answers at once. */
    /** priceCents absent: the platform keeps the plugin's current price (a new plugin is free). */
    uploadAppPluginToMarket(request: { readonly path: string; readonly author: string; readonly priceCents?: number }): Promise<import('./nextmux-app-plugins').AppPluginMarketUpload>;
    /** Buys a paid plugin from the account's USD balance (charged only at the price the buyer saw). */
    purchaseAppPlugin(id: string, expectedPriceCents: number, idempotencyKey: string): Promise<import('./nextmux-app-plugins').AppPluginPurchase>;
    /** Whether a plugin loaded from disk is a paid marketplace plugin's content under another id or name. */
    appPluginFingerprintMatch(fingerprint: import('./nextmux-app-plugins').AppPluginFingerprint): Promise<import('./nextmux-app-plugins').AppPluginFingerprintMatch>;
    /** Whether a plugin id is sold in the marketplace and, when it is, this account's signed license. */
    appPluginLicense(id: string): Promise<import('./nextmux-app-plugins').AppPluginLicenseCheck>;
    saveComicCharacterToLibrary(request: SaveComicCharacterToLibraryRequest): Promise<DesktopComicCharacterLibraryEntry>;
    /** Removes a character from the library; projects that already imported it keep their copy. */
    /** The folder of one library character, for the desktop to move to the system Trash. */
    comicCharacterLibraryFolder(bundleId: string): Promise<string>;
    importComicCharacterFromLibrary(request: ImportComicCharacterFromLibraryRequest): Promise<DesktopComicProjectState>;
    /** Draws a character's portrait; the character is then kept in the library too (one entry per project character). */
    generateComicCharacterPortrait(request: GenerateComicCharacterPortraitRequest): Promise<DesktopComicProjectState>;
    cancelComicCharacterPortrait(workspaceRoot: string, characterId: string): Promise<boolean>;
    createComicCharacterInLibrary(request: CreateComicLibraryCharacterRequest): Promise<DesktopComicCharacterLibraryEntry>;
    updateComicCharacterInLibrary(request: UpdateComicLibraryCharacterRequest): Promise<DesktopComicCharacterLibraryEntry>;
    verifyOfficialMediaConnection(connectionId: string): Promise<OfficialModelConnectionsState>;
    getVideoModelFacts(connectionId: string, model: string): Promise<DesktopVideoModelFacts>;
    /** In-app playback copies of clips whose sound the app cannot decode (AAC → Opus): clip uri → copy uri. */
    preparePlaybackMedia(workspaceRoot: string): Promise<Record<string, string>>;
    getPrivacySettings(): Promise<DesktopPrivacySettings>;
    savePrivacySettings(settings: DesktopPrivacySettings): Promise<DesktopPrivacySettings>;
    getDesktopLocalDataState(workspaceRoot: string): Promise<DesktopLocalDataState>;
    clearDesktopLocalData(request: ClearDesktopLocalDataRequest): Promise<DesktopLocalDataState>;
    /** Revision snapshots only, for the same unchanged comic project; no project file or media. */
    exportComicHistoryArchive(workspaceRoot: string, destinationDirectoryUri: string): Promise<DesktopComicHistoryArchiveResult>;
    importComicHistoryArchive(workspaceRoot: string, archiveDirectoryUri: string): Promise<DesktopComicHistoryImportResult>;
    /** Export only definite terminal media records; no generated media files or assets. */
    exportMediaJobHistoryArchive(workspaceRoot: string, destinationDirectoryUri: string): Promise<DesktopMediaHistoryArchiveResult>;
    /** Restore read-only terminal records to an empty queue bound to the same workspace. */
    importMediaJobHistoryArchive(workspaceRoot: string, archiveFileUri: string): Promise<DesktopMediaHistoryImportResult>;
    /** Save read-only terminal export summaries, without film files or paths. */
    exportComicExportHistoryArchive(workspaceRoot: string, destinationDirectoryUri: string): Promise<DesktopComicExportHistoryArchiveResult>;
    /** Restore inert summaries only into an empty export-history category. */
    importComicExportHistoryArchive(workspaceRoot: string, archiveFileUri: string): Promise<DesktopComicExportHistoryImportResult>;
    /** Back up actual managed media bytes and film/subtitle files for the unchanged current project. */
    exportComicMediaFilesArchive(workspaceRoot: string, destinationDirectoryUri: string): Promise<DesktopComicMediaFilesArchiveResult>;
    /** Restore verified media files only when the current project's media directory is empty. */
    importComicMediaFilesArchive(workspaceRoot: string, archiveDirectoryUri: string): Promise<DesktopComicMediaFilesImportResult>;
    createDesktopDiagnosticReport(workspaceRoot: string): Promise<DesktopDiagnosticReport>;
}
import type { ConversationArchiveExportOptions, ConversationArchiveExportResult, ConversationArchiveImportResult, ConversationArchivePreview, ConversationArchiveProjectBinding } from './nextmux-conversation-archive';
