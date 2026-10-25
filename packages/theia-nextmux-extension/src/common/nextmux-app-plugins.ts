import type { ReadableModelError } from '@nextmux/model-runtime/errors';
/**
 * Skill plugins (技能插件): the shapes shared by the page, the backend and the main process
 * (apps/desktop/app-plugins.cjs, apps/desktop/app-plugin-core.cjs). The format itself is specified in
 * docs/SKILL_PLUGIN_DEVELOPMENT.md.
 */

/**
 * The fast decision model a plugin asks (chosen per plugin in Settings → 技能插件). Where it runs:
 *  - "nextmux": a relay merchant's decision model through the NextMux platform (billed per input token);
 *    `offeringId` pins one merchant, otherwise the platform picks an available one.
 *  - "connection": one of the user's own API connections whose model list has decision models.
 *  - "local": a server on this computer — a decision server (protocol "systemone", e.g. OpenJev), Ollama ("ollama")
 *    or any OpenAI-compatible chat server ("openai"); chat models answer the same questions as JSON.
 */
export interface AppPluginPricing {
    readonly inputPricePerMillion?: number;
    readonly outputPricePerMillion?: number;
    readonly cachedInputPricePerMillion?: number;
    readonly cacheWritePricePerMillion?: number;
}

export interface AppPluginModel extends AppPluginPricing {
    readonly source: 'nextmux' | 'connection' | 'local';
    readonly model: string;
    readonly label?: string;
    /** NextMux platform: a specific relay route, and that merchant's name for display. */
    readonly offeringId?: string;
    readonly merchant?: string;
    /** Own API: the connection and its name for display. */
    readonly connectionId?: string;
    readonly connectionLabel?: string;
    /** Local servers only: http://127.0.0.1:port, and how to talk to it. */
    readonly endpoint?: string;
    readonly protocol?: AppPluginLocalProtocol;
    /** The model reads screenshots too (OpenJev, a vision model in Ollama): the plugin's frames go with each decision. */
    readonly images?: boolean;
    readonly inputPricePerMillion?: number;
}

export type AppPluginLocalProtocol = 'systemone' | 'ollama' | 'openai';

/** A vision model that describes the screen for a decision model that cannot see: an own API connection or a local server. */
export interface AppPluginVisionModel extends AppPluginPricing {
    readonly source: 'connection' | 'local';
    readonly model: string;
    readonly connectionId?: string;
    readonly connectionLabel?: string;
    readonly endpoint?: string;
    readonly protocol?: 'ollama' | 'openai';
}

/** Declarative, user-selected long-term goals displayed on an app tab. */
export interface AppPluginPreset {
    readonly id: string;
    readonly label: string;
    readonly goal: string;
    readonly description?: string;
}

/** Declarative user-configurable parameter for a skill plugin (boolean, number, string, select, .txt/.md file, or folder/file path). */
export interface AppPluginParam {
    readonly id: string;
    /**
     * Validated by the host manifest validator (apps/desktop/app-plugin-core.cjs). 'path' is a local folder
     * chosen with the native folder dialog (value: absolute folder path, or null); 'directory' is its alias.
     * 'file' reads a .txt/.md file into lines on the host.
     */
    readonly type: 'boolean' | 'number' | 'string' | 'select' | 'file' | 'path' | 'directory';
    readonly label: string;
    readonly description?: string;
    readonly default?: boolean | number | string | null;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly options?: readonly { readonly value: string; readonly label: string }[];
    readonly accept?: readonly string[];
}

export interface AppPluginParamFileValue {
    readonly name: string;
    readonly path?: string;
    readonly count: number;
    readonly lines?: readonly string[];
    readonly preview?: readonly string[];
}

export type AppPluginParamValue = boolean | number | string | AppPluginParamFileValue | null;

export interface AppPluginSummary {
    readonly id: string;
    readonly version: string;
    readonly name: string;
    readonly description: string;
    readonly author: { readonly name: string; readonly url?: string };
    readonly license: string;
    readonly homepage: string;
    readonly risk: readonly string[];
    readonly apps: readonly { readonly platform: 'macos' | 'windows'; readonly bundleId?: string; readonly program?: string; readonly title?: string; readonly titleIncludes?: string; readonly name?: string }[];
    readonly keys: readonly string[];
    readonly pointer: boolean;
    readonly modes: readonly ('background' | 'foreground' | 'vm')[];
    readonly vision: 'none' | 'optional' | 'required';
    readonly goals: { readonly default: string; readonly examples: readonly string[] };
    readonly presets?: readonly AppPluginPreset[];
    readonly params?: readonly AppPluginParam[];
    readonly maxRunMinutes: number;
    readonly actions: readonly { readonly id: string; readonly label: string }[];
    readonly decisions: readonly { readonly id: string; readonly type: 'choice' | 'yesno' | 'score'; readonly question: string; readonly optionCount?: number; readonly minConfidence?: number }[];
    readonly reflexes: readonly { readonly when: string; readonly do: string }[];
    readonly events: readonly { readonly id: string; readonly message: string; readonly pause: boolean; readonly stop: boolean }[];
}

/** Review metadata does not imply that this device has verified a package signature. */
export interface AppPluginTrust {
    readonly source: 'marketplace' | 'local-file' | 'development';
    readonly reviewStatus: 'approved' | 'pending' | 'rejected' | 'unreviewed';
    readonly signaturePresent: boolean;
    readonly signatureVerified: boolean;
}

/** Stable validation data; format at the display edge instead of showing the legacy English errors array. */
export interface AppPluginDiagnostic {
    readonly code: string;
    readonly path: string;
    readonly params: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AppPluginInfo extends Partial<AppPluginTrust> {
    readonly id: string;
    readonly ok: boolean;
    readonly errors?: readonly string[];
    readonly diagnostics?: readonly AppPluginDiagnostic[];
    readonly summary?: AppPluginSummary;
    /** Locale-independent English model projection, separate from the localized UI summary. */
    readonly modelSummary?: AppPluginSummary;
    readonly presets?: readonly AppPluginPreset[];
    readonly params?: Readonly<Record<string, AppPluginParamValue>>;
    readonly enabled: boolean;
    readonly model: AppPluginModel | null;
    readonly vision?: AppPluginVisionModel | null;
    readonly dev: boolean;
    readonly folder: string;
    readonly installedAt?: number;
    readonly icon?: string;
    readonly readme?: string;
    readonly tests?: number;
    /** Enabled with a model (and a way to see when the plugin needs one). */
    readonly ready?: boolean;
    readonly modelCompatibilityError?: string;
    readonly budgetEnforceable?: boolean;
    readonly inputErrors?: readonly string[];
    readonly running?: readonly string[];
    /** @deprecated Render source, reviewStatus, signaturePresent and signatureVerified separately. */
    readonly verified?: boolean;
    /** Bought in the marketplace: runs only with a valid license (licenseExpiresAt, ms). */
    readonly paid?: boolean;
    readonly licenseExpiresAt?: number;
    /** The account the stored license was issued to (a license copied from another account does not count). */
    readonly licenseUserId?: string;
    /** A plugin from disk: its content fingerprint, looked up among paid marketplace plugins before it runs. */
    readonly fingerprint?: AppPluginFingerprint;
}

/** What a plugin does, independent of its id and wording (app-plugin-core contentFingerprintInputs, SHA-256 hex). */
export interface AppPluginFingerprint {
    readonly behavior: string;
    readonly images: string;
}

export interface AppPluginFingerprintMatch {
    readonly ok: boolean;
    /** The paid marketplace plugin with this content, if any. */
    readonly match?: { readonly pluginId: string; readonly priceCents: number; readonly name: Readonly<Record<string, string>> };
    readonly error?: string;
}

export interface AppPluginInspection extends Partial<AppPluginTrust> {
    readonly ok: boolean;
    readonly cancelled?: boolean;
    readonly errors?: readonly string[];
    readonly diagnostics?: readonly AppPluginDiagnostic[];
    readonly token?: string;
    readonly file?: string;
    readonly summary?: AppPluginSummary;
    /** Locale-independent English model projection, separate from the localized UI summary. */
    readonly modelSummary?: AppPluginSummary;
    readonly icon?: string;
    readonly readme?: string;
    readonly installedVersion?: string;
    readonly downgrade?: boolean;
    /** @deprecated Alias of signatureVerified; it says nothing about reviewStatus or source. */
    readonly verified?: boolean;
    readonly fromMarket?: boolean;
    readonly fingerprint?: AppPluginFingerprint;
}

export interface AppPluginStartRequest {
    readonly conversationId: string;
    readonly tabId: string;
    readonly pid: number;
    readonly windowId: number;
    readonly title?: string;
    readonly pluginId: string;
    readonly goal?: string;
    readonly params?: Readonly<Record<string, unknown>>;
    readonly maxMinutes?: number;
    readonly maxCostUsd?: number;
    readonly maxRequests?: number;
    readonly dryRun?: boolean;
    readonly overlay?: boolean;
    /** Events go back to the conversation's AI (a follow-up message when no reply is running). */
    readonly handOff?: boolean;
    readonly locale?: string;
    readonly mode?: 'foreground' | 'background';
    /** A paid plugin (付费插件): the account's license, renewed online before each run when it is near its end. */
    readonly gate?: { readonly paid: boolean; readonly license?: AppPluginLicense };
}

export interface AppPluginRunEvent {
    /** English plugin message for tool results and model handoffs; absent on older hosts. */
    readonly modelMessage?: string;
    readonly id: string;
    readonly message: string;
    readonly pause: boolean;
    readonly stop: boolean;
    readonly at: number;
}

export interface AppPluginOverlayItem {
    readonly id: string;
    readonly type: 'bar' | 'pixel' | 'template' | 'change' | 'text';
    readonly rect: readonly number[] | null;
    readonly points: readonly (readonly [number, number, string])[] | null;
    readonly value: unknown;
}

export interface AppPluginRunSnapshot {
    readonly readableError?: ReadableModelError;
    readonly runId: string;
    readonly conversationId: string;
    readonly tabId: string;
    readonly pid: number;
    readonly windowId: number;
    readonly pluginId: string;
    readonly name: string;
    readonly goal: string;
    readonly presets?: readonly AppPluginPreset[];
    readonly params?: Readonly<Record<string, AppPluginParamValue>>;
    readonly startedAt: number;
    readonly elapsedMs: number;
    readonly costUsd: number;
    readonly costStatus?: 'known' | 'unknown';
    readonly budgetEnforceable?: boolean;
    readonly requests?: number;
    readonly maxRequests?: number;
    readonly maxCostUsd: number;
    readonly maxMinutes: number;
    readonly dryRun: boolean;
    readonly paused: boolean;
    readonly ended: boolean;
    readonly reason: string;
    readonly actions: number;
    readonly decisions: number;
    readonly lastAction: { readonly action: string; readonly at: number; readonly by: string } | null;
    readonly lastDecision: { readonly id: string; readonly choice: string; readonly confidence: number; readonly at: number; readonly latencyMs: number } | null;
    readonly signals: Readonly<Record<string, unknown>>;
    readonly events: readonly AppPluginRunEvent[];
    readonly error: string;
    readonly overlay?: readonly AppPluginOverlayItem[];
}

export type AppPluginMessage =
    | ({ readonly type: 'status' } & AppPluginRunSnapshot)
    | ({ readonly type: 'ended' } & AppPluginRunSnapshot)
    | ({ readonly type: 'event'; readonly runId: string; readonly conversationId: string; readonly tabId: string; readonly pluginId: string; readonly name: string; readonly handOff: boolean } & AppPluginRunEvent)
    | { readonly type: 'cancel'; readonly requestId: string; readonly runId: string }
    | { readonly type: 'decide'; readonly deadlineAt: number; readonly requestId: string; readonly runId: string; readonly model: AppPluginModel; readonly state: string; readonly questions: Readonly<Record<string, unknown>>; readonly images: readonly string[] }
    | { readonly type: 'describe'; readonly deadlineAt: number; readonly requestId: string; readonly runId: string; readonly vision: AppPluginVisionModel; readonly image: string; readonly hints: string };

export interface AppPluginDecisionRequest {
    readonly requestId?: string;
    readonly deadlineAt?: number;
    readonly model: AppPluginModel;
    readonly state: string;
    readonly questions: Readonly<Record<string, unknown>>;
    readonly images?: readonly string[];
}

export interface AppPluginDecisionResult {
    readonly readableError?: ReadableModelError;
    readonly ok: boolean;
    readonly payload?: unknown;
    readonly costUsd?: number;
    readonly costStatus?: 'known' | 'unknown';
    readonly latencyMs?: number;
    readonly error?: string;
}

export interface AppPluginDescribeRequest {
    readonly requestId?: string;
    readonly deadlineAt?: number;
    readonly vision: AppPluginVisionModel;
    readonly image: string;
    readonly hints?: string;
}

export interface AppPluginDescribeResult {
    readonly readableError?: ReadableModelError;
    readonly ok: boolean;
    readonly text?: string;
    readonly costUsd?: number;
    readonly costStatus?: 'known' | 'unknown';
    readonly latencyMs?: number;
    readonly error?: string;
}

/** A relay decision model on the platform and the merchants that sell it. */
export interface AppPluginRelayModel {
    readonly model: string;
    readonly label: string;
    readonly contextTokens?: number;
    readonly images?: boolean;
    readonly routes: readonly { readonly offeringId: string; readonly merchant: string; readonly inputPricePerMillion: number }[];
}

/** One of the user's own API connections: its decision models, and the models that can describe a picture. */
export interface AppPluginConnectionChoice {
    readonly connectionId: string;
    readonly label: string;
    readonly provider: string;
    readonly decisions: readonly (AppPluginPricing & { readonly model: string; readonly label: string })[];
    readonly vision: readonly (AppPluginPricing & { readonly model: string; readonly label: string })[];
}

/** A model server found on this computer. */
export interface AppPluginLocalServer {
    readonly endpoint: string;
    readonly protocol: AppPluginLocalProtocol;
    /** "Ollama", "OpenJev", "LM Studio" … or the address. */
    readonly name: string;
    readonly models: readonly { readonly model: string; readonly label?: string; readonly images?: boolean }[];
}

export interface AppPluginModelChoices {
    readonly relays: readonly AppPluginRelayModel[];
    readonly connections: readonly AppPluginConnectionChoice[];
    readonly local: readonly AppPluginLocalServer[];
    readonly errors: readonly string[];
    readonly excluded?: readonly { readonly connectionId: string; readonly label: string; readonly protocol: string; readonly kind: 'decision' | 'vision'; readonly reason: 'unsupported_transport' }[];
}

export interface AppPluginServerProbe {
    readonly ok: boolean;
    readonly server?: AppPluginLocalServer;
    readonly error?: string;
}

/** A plugin in the NextMux plugin marketplace (reviewed and listed on the platform). */
export interface AppPluginMarketPlugin extends AppPluginTrust {
    readonly id: string;
    readonly name: Readonly<Record<string, string>>;
    readonly description: Readonly<Record<string, string>>;
    readonly author: { readonly name: string };
    readonly homepage: string;
    readonly risk: readonly string[];
    readonly apps: readonly { readonly platform: 'macos' | 'windows'; readonly bundleId?: string; readonly program?: string }[];
    readonly latestVersion: string;
    readonly downloads: number;
    readonly readme?: string;
    readonly tests?: number;
    /** Price in US cents; 0 is free. A paid plugin downloads only for its buyers (and its author). */
    readonly priceCents: number;
    /** This account may download it: free, bought, or its own (absent when the app is not signed in). */
    readonly owned?: boolean;
}

/** Plugin prices: free, or $0.99–$999.99 (the platform keeps 10%). */
export const APP_PLUGIN_PRICE = { minCents: 99, maxCents: 99_999, feeBps: 1_000 } as const;

export interface AppPluginPurchase {
    readonly ok: boolean;
    readonly owned?: boolean;
    /** insufficient_balance, plugin_price_changed (with the new price), plugin_login_required, plugin_own, … */
    readonly error?: string;
    readonly priceCents?: number;
    readonly availableMicros?: number;
}

/** A license the platform signed for one buyer and plugin; checked with the built-in public key before every run. */
export interface AppPluginLicense {
    readonly userId: string;
    readonly pluginId: string;
    readonly issuedAt: number;
    readonly expiresAt: number;
    readonly signature: string;
}

export interface AppPluginLicenseCheck {
    readonly ok: boolean;
    /** Whether the marketplace sells this plugin id (unknown when the check failed). */
    readonly paid?: boolean;
    readonly owned?: boolean;
    readonly priceCents?: number;
    readonly license?: AppPluginLicense;
    readonly error?: string;
}

export interface AppPluginMarketList {
    readonly ok: boolean;
    readonly plugins: readonly AppPluginMarketPlugin[];
    readonly nextCursor?: string;
    readonly error?: string;
}

export interface AppPluginMarketDetail {
    readonly ok: boolean;
    readonly plugin?: AppPluginMarketPlugin;
    readonly versions?: readonly (AppPluginTrust & { readonly version: string; readonly sha256: string; readonly signed: boolean; readonly reviewedAt: number })[];
    readonly error?: string;
}

/** 我的插件: one version the user uploaded, as the platform's code review left it. */
export interface AppPluginMineVersion {
    readonly version: string;
    readonly status: 'pending' | 'approved' | 'rejected';
    /** The failing review check ('plugin_listing', 'package'), shown translated; otherwise the note as written. */
    readonly failedCheck?: string;
    readonly reviewNote: string;
    readonly reviewedBy: 'auto' | 'admin' | null;
    readonly authorName: string;
    readonly submittedAt: number;
}

export interface AppPluginMinePlugin {
    readonly id: string;
    readonly name: Readonly<Record<string, string>>;
    readonly authorName: string;
    readonly status: 'draft' | 'listed' | 'removed';
    readonly latestApprovedVersion: string;
    readonly downloads: number;
    readonly priceCents: number;
    readonly versions: readonly AppPluginMineVersion[];
}

/** Why an upload was refused (the package could not be used): the same codes as the app's own install check. */
export interface AppPluginUploadProblem {
    readonly code: string;
    readonly reason?: string;
    readonly params?: Readonly<Record<string, string | number | boolean | null>>;
    readonly diagnostics?: readonly AppPluginDiagnostic[];
}

export interface AppPluginUploadRejection extends AppPluginUploadProblem {
    readonly id: string;
    readonly pluginId?: string;
    readonly version?: string;
    readonly fileName: string;
    readonly name: Readonly<Record<string, string>>;
    readonly createdAt: number;
}

export interface AppPluginMine {
    readonly ok: boolean;
    readonly plugins: readonly AppPluginMinePlugin[];
    readonly rejections: readonly AppPluginUploadRejection[];
    readonly error?: string;
}

export interface AppPluginMarketUpload {
    readonly ok: boolean;
    readonly pluginId?: string;
    readonly version?: string;
    readonly name?: Readonly<Record<string, string>>;
    readonly status?: 'approved' | 'pending' | 'rejected';
    readonly failedCheck?: string;
    readonly problem?: AppPluginUploadProblem;
}

export interface AppPluginMarketDownload extends Partial<AppPluginTrust> {
    readonly ok: boolean;
    readonly dataBase64?: string;
    readonly sha256?: string;
    /** @deprecated Alias of signatureVerified; it says nothing about reviewStatus or source. */
    readonly verified?: boolean;
    readonly error?: string;
}
