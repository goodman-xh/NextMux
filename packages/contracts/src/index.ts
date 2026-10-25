export type Id = string;
export type IsoDateTime = string;
export type CurrencyCode = string;

export type FulfillmentMode = "managed_gateway" | "independent_key";

export type ProviderSourceType =
  | "official_direct"
  | "authorized_relay"
  | "unverified_relay";

export type ProviderProtocol =
  | "openai_compatible"
  | "anthropic_messages"
  | "gemini_content"
  | "cloud_vendor"
  | "domestic_native"
  | "custom_reviewed";

export type ModelModality =
  | "text"
  | "vision"
  | "image"
  | "audio"
  | "video"
  | "embedding"
  | "rerank";

export interface ModelCapabilities {
  readonly modalities: readonly ModelModality[];
  readonly streaming: boolean;
  readonly nativeTools: boolean;
  readonly parallelTools: boolean;
  readonly structuredOutput: boolean;
  readonly maxContextTokens?: number;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface ModelDefinition {
  readonly id: Id;
  readonly family: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
}

export interface ProviderEndpoint {
  readonly id: Id;
  readonly providerId: Id;
  readonly protocol: ProviderProtocol;
  readonly baseUrl: string;
  readonly region: string;
}

export interface Money {
  readonly currency: CurrencyCode;
  readonly minor: number;
}

export interface PriceVersion {
  readonly id: Id;
  readonly offeringId: Id;
  readonly effectiveAt: IsoDateTime;
  readonly unit:
    | "request"
    | "input_token"
    | "output_token"
    | "character"
    | "image"
    | "megapixel"
    | "audio_second"
    | "video_second"
    | "fixed_key";
  readonly price: Money;
}

export interface ModelOffering {
  readonly id: Id;
  readonly providerId: Id;
  readonly endpointId: Id;
  readonly modelDefinitionId: Id;
  readonly providerModelCode: string;
  readonly displayName: string;
  readonly sourceType: ProviderSourceType;
  readonly fulfillmentMode: FulfillmentMode;
  readonly region: string;
  readonly status:
    | "draft"
    | "testing"
    | "active"
    | "out_of_stock"
    | "suspended";
}

export type VerificationVerdict =
  | "strong_match"
  | "probable_match"
  | "inconclusive"
  | "material_mismatch"
  | "critical_mismatch";

export type EvidenceConfidence = "low" | "medium" | "high" | "very_high";

export interface VerificationEvidence {
  readonly id: Id;
  readonly runId: Id;
  readonly category:
    | "provenance"
    | "signed_artifact"
    | "protocol"
    | "capability"
    | "behavioral_fingerprint"
    | "drift";
  readonly methodId: string;
  readonly score: number;
  readonly severity: "info" | "warning" | "critical";
  readonly summary: string;
  readonly reproducible: boolean;
}

export interface ModelFidelitySnapshot {
  readonly id: Id;
  readonly offeringId: Id;
  /** Evidence-weighted consistency index, not a literal truth probability. */
  readonly index: number;
  readonly uncertaintyLow: number;
  readonly uncertaintyHigh: number;
  readonly verdict: VerificationVerdict;
  readonly confidence: EvidenceConfidence;
  readonly sampleCount: number;
  readonly methodVersion: string;
  readonly baselineVersion: string;
  readonly measuredAt: IsoDateTime;
}

export interface ChannelQualitySnapshot {
  readonly id: Id;
  readonly providerId: Id;
  readonly index: number;
  readonly confidence: EvidenceConfidence;
  readonly modelFidelity: number;
  readonly networkQuality: number;
  readonly billingIntegrity: number;
  readonly capabilityCompleteness: number;
  readonly fulfillmentQuality: number;
  readonly supportQuality: number;
  readonly measuredAt: IsoDateTime;
}

export type AgentReadinessLevel =
  | "agent_ready"
  | "good_with_limits"
  | "limited_tools"
  | "chat_only"
  | "not_tested";

export interface AgentReadinessSnapshot {
  readonly id: Id;
  readonly offeringId: Id;
  readonly workbench: "coding" | "comic";
  readonly index: number;
  readonly level: AgentReadinessLevel;
  readonly confidence: EvidenceConfidence;
  readonly toolSchemaAdherence: number;
  readonly toolSelection: number;
  readonly multiStepCompletion: number;
  readonly recovery: number;
  readonly mcpInteroperability: number;
  readonly efficiency: number;
  readonly runtimeVersion: string;
  readonly benchmarkVersion: string;
  readonly sampleCount: number;
  readonly measuredAt: IsoDateTime;
}

export type ManagedCredentialStatus =
  | "pending_validation"
  | "active"
  | "rate_limited"
  | "exhausted"
  | "invalid"
  | "disabled"
  | "quarantined";

/**
 * A gateway credential never contains plaintext. `secretRef` points at an
 * envelope-encrypted vault entry and `fingerprint` is safe for diagnostics.
 */
export interface ManagedCredential {
  readonly id: Id;
  readonly providerId: Id;
  readonly endpointId: Id;
  readonly secretRef: string;
  readonly fingerprint: string;
  readonly status: ManagedCredentialStatus;
  readonly offeringIds: readonly Id[];
  readonly region: string;
  readonly priority: number;
  readonly weight: number;
  readonly maxConcurrency: number;
  readonly inFlight: number;
  readonly remainingBudgetMinor?: number;
  readonly cooldownUntil?: IsoDateTime;
  readonly expiresAt?: IsoDateTime;
}

export type InventoryKeyStatus =
  | "pending_validation"
  | "available"
  | "reserved"
  | "delivered"
  | "invalid"
  | "revoked"
  | "expired"
  | "quarantined"
  | "withdrawn";

/**
 * Inventory secrets are represented by a vault reference. A delivery service
 * may unwrap the secret only after confirmed payment and only for a one-time
 * reveal operation.
 */
export interface InventoryKey {
  readonly id: Id;
  readonly providerId: Id;
  readonly offeringId: Id;
  readonly secretRef: string;
  readonly fingerprint: string;
  readonly status: InventoryKeyStatus;
  readonly batchId?: Id;
  readonly nominalQuota?: string;
  readonly expiresAt?: IsoDateTime;
  readonly reservedByPurchaseId?: Id;
  readonly reservationExpiresAt?: IsoDateTime;
  readonly deliveredToPurchaseId?: Id;
  readonly withdrawnAt?: IsoDateTime;
}

export interface Purchase {
  readonly id: Id;
  readonly organizationId: Id;
  readonly offeringId: Id;
  readonly status:
    | "created"
    | "payment_pending"
    | "paid"
    | "fulfilled"
    | "failed"
    | "refunded";
}

export interface Entitlement {
  readonly id: Id;
  readonly organizationId: Id;
  readonly offeringId: Id;
  readonly purchaseId: Id;
  readonly status: "active" | "suspended" | "expired" | "cancelled";
  readonly startsAt: IsoDateTime;
  readonly endsAt?: IsoDateTime;
}

export type FulfillmentAction =
  | {
      readonly kind: "activate_entitlement";
      readonly entitlement: Entitlement;
    }
  | {
      readonly kind: "reserve_independent_key";
      readonly purchaseId: Id;
      readonly inventoryKeyId: Id;
      readonly secretRef: string;
      readonly reservationExpiresAt: IsoDateTime;
    };
