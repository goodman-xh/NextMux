import type {
  Entitlement,
  FulfillmentAction,
  InventoryKey,
  ManagedCredential,
  ModelOffering,
  Purchase,
} from "@nextmux/contracts";

export class NoEligibleCredentialError extends Error {
  constructor() {
    super("No eligible managed credential is available");
    this.name = "NoEligibleCredentialError";
  }
}

export class InventoryUnavailableError extends Error {
  constructor() {
    super("No independent API key is available for this offering");
    this.name = "InventoryUnavailableError";
  }
}

export class InvalidFulfillmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFulfillmentError";
  }
}

export interface GatewaySelectionRequest {
  readonly offeringId: string;
  readonly endpointId: string;
  readonly preferredRegion?: string;
  readonly estimatedCostMinor?: number;
  readonly now: Date;
}

function dateIsAfter(value: string | undefined, now: Date): boolean {
  return value === undefined || new Date(value).getTime() > now.getTime();
}

function cooldownHasElapsed(value: string | undefined, now: Date): boolean {
  return value === undefined || new Date(value).getTime() <= now.getTime();
}

function credentialIsEligible(
  credential: ManagedCredential,
  request: GatewaySelectionRequest,
): boolean {
  const activeOrRecovered =
    credential.status === "active" ||
    (credential.status === "rate_limited" &&
      cooldownHasElapsed(credential.cooldownUntil, request.now));

  const hasBudget =
    credential.remainingBudgetMinor === undefined ||
    credential.remainingBudgetMinor >= (request.estimatedCostMinor ?? 0);

  return (
    activeOrRecovered &&
    credential.endpointId === request.endpointId &&
    credential.offeringIds.includes(request.offeringId) &&
    credential.inFlight < credential.maxConcurrency &&
    dateIsAfter(credential.expiresAt, request.now) &&
    hasBudget
  );
}

/**
 * Selects a server-side credential without exposing its secret. Region match,
 * explicit priority, current load, and weight are deterministic tie-breakers.
 */
export function selectManagedCredential(
  credentials: readonly ManagedCredential[],
  request: GatewaySelectionRequest,
): ManagedCredential {
  const eligible = credentials.filter((credential) =>
    credentialIsEligible(credential, request),
  );

  eligible.sort((left, right) => {
    const leftRegionPenalty =
      request.preferredRegion && left.region !== request.preferredRegion ? 1 : 0;
    const rightRegionPenalty =
      request.preferredRegion && right.region !== request.preferredRegion ? 1 : 0;

    if (leftRegionPenalty !== rightRegionPenalty) {
      return leftRegionPenalty - rightRegionPenalty;
    }

    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }

    const leftLoad = left.inFlight / left.maxConcurrency;
    const rightLoad = right.inFlight / right.maxConcurrency;
    if (leftLoad !== rightLoad) {
      return leftLoad - rightLoad;
    }

    if (left.weight !== right.weight) {
      return right.weight - left.weight;
    }

    return left.id.localeCompare(right.id);
  });

  const selected = eligible[0];
  if (!selected) {
    throw new NoEligibleCredentialError();
  }
  return selected;
}

export interface InventoryReservation {
  readonly key: InventoryKey;
  readonly inventory: readonly InventoryKey[];
}

export function countAvailableInventory(
  inventory: readonly InventoryKey[],
  offeringId: string,
  now: Date,
): number {
  return inventory
    .map((key) => releaseExpiredReservation(key, now))
    .filter(
      (key) =>
        key.offeringId === offeringId &&
        key.status === "available" &&
        dateIsAfter(key.expiresAt, now),
    ).length;
}

/**
 * Completes a one-time delivery. A reservation cannot be delivered to another
 * purchase and a delivered key can never transition back to available.
 */
export function deliverReservedInventoryKey(
  key: InventoryKey,
  purchaseId: string,
  now: Date,
): InventoryKey {
  if (key.status !== "reserved") {
    throw new InvalidFulfillmentError("Inventory key is not reserved");
  }
  if (key.reservedByPurchaseId !== purchaseId) {
    throw new InvalidFulfillmentError(
      "Inventory key is reserved for a different purchase",
    );
  }
  if (
    !key.reservationExpiresAt ||
    new Date(key.reservationExpiresAt).getTime() <= now.getTime()
  ) {
    throw new InvalidFulfillmentError("Inventory reservation has expired");
  }

  return {
    ...key,
    status: "delivered",
    reservedByPurchaseId: undefined,
    reservationExpiresAt: undefined,
    deliveredToPurchaseId: purchaseId,
  };
}

/**
 * Vendor withdrawal is allowed only before a key participates in a paid sale.
 * Production persistence keeps a masked audit record and destroys or retires
 * the corresponding vault secret according to retention policy.
 */
export function withdrawUnsoldInventoryKey(
  key: InventoryKey,
  now: Date,
): InventoryKey {
  const withdrawableStatuses: readonly InventoryKey["status"][] = [
    "pending_validation",
    "available",
    "invalid",
    "expired",
    "quarantined",
  ];

  if (!withdrawableStatuses.includes(key.status)) {
    throw new InvalidFulfillmentError(
      `Inventory key in status ${key.status} cannot be withdrawn`,
    );
  }

  return {
    ...key,
    status: "withdrawn",
    reservedByPurchaseId: undefined,
    reservationExpiresAt: undefined,
    withdrawnAt: now.toISOString(),
  };
}

export function reconcileIndependentOfferingStock(
  offering: ModelOffering,
  inventory: readonly InventoryKey[],
  now: Date,
): ModelOffering {
  if (
    offering.fulfillmentMode !== "independent_key" ||
    !["active", "out_of_stock"].includes(offering.status)
  ) {
    return offering;
  }

  const nextStatus =
    countAvailableInventory(inventory, offering.id, now) > 0
      ? "active"
      : "out_of_stock";
  return { ...offering, status: nextStatus };
}

function releaseExpiredReservation(key: InventoryKey, now: Date): InventoryKey {
  if (
    key.status === "reserved" &&
    key.reservationExpiresAt &&
    new Date(key.reservationExpiresAt).getTime() <= now.getTime()
  ) {
    return {
      ...key,
      status: "available",
      reservedByPurchaseId: undefined,
      reservationExpiresAt: undefined,
    };
  }
  return key;
}

function inventoryExpiry(key: InventoryKey): number {
  return key.expiresAt
    ? new Date(key.expiresAt).getTime()
    : Number.MAX_SAFE_INTEGER;
}

/**
 * Pure domain helper for tests and service logic. Production persistence must
 * claim the selected row atomically in the database using the same predicates.
 */
export function reserveInventoryKey(
  inventory: readonly InventoryKey[],
  offeringId: string,
  purchaseId: string,
  now: Date,
  reservationDurationMs = 10 * 60 * 1000,
): InventoryReservation {
  const normalized = inventory.map((key) => releaseExpiredReservation(key, now));
  const candidates = normalized
    .filter(
      (key) =>
        key.offeringId === offeringId &&
        key.status === "available" &&
        dateIsAfter(key.expiresAt, now),
    )
    .sort((left, right) => {
      const expiryDifference = inventoryExpiry(left) - inventoryExpiry(right);
      return expiryDifference !== 0
        ? expiryDifference
        : left.id.localeCompare(right.id);
    });

  const selected = candidates[0];
  if (!selected) {
    throw new InventoryUnavailableError();
  }

  const reservationExpiresAt = new Date(
    now.getTime() + reservationDurationMs,
  ).toISOString();
  const reserved: InventoryKey = {
    ...selected,
    status: "reserved",
    reservedByPurchaseId: purchaseId,
    reservationExpiresAt,
  };

  return {
    key: reserved,
    inventory: normalized.map((key) => (key.id === reserved.id ? reserved : key)),
  };
}

export interface PlanFulfillmentInput {
  readonly offering: ModelOffering;
  readonly purchase: Purchase;
  readonly inventory: readonly InventoryKey[];
  readonly now: Date;
  readonly entitlementId: string;
  readonly reservationDurationMs?: number;
}

/**
 * Enforces the critical boundary: managed purchases create entitlements;
 * independent-key purchases reserve inventory. Neither path can silently fall
 * back to the other.
 */
export function planFulfillment(
  input: PlanFulfillmentInput,
): FulfillmentAction {
  if (input.purchase.status !== "paid") {
    throw new InvalidFulfillmentError("Purchase must be paid before fulfillment");
  }
  if (input.purchase.offeringId !== input.offering.id) {
    throw new InvalidFulfillmentError("Purchase and offering do not match");
  }
  if (input.offering.status !== "active") {
    throw new InvalidFulfillmentError("Offering is not active");
  }

  if (input.offering.fulfillmentMode === "managed_gateway") {
    const entitlement: Entitlement = {
      id: input.entitlementId,
      organizationId: input.purchase.organizationId,
      offeringId: input.offering.id,
      purchaseId: input.purchase.id,
      status: "active",
      startsAt: input.now.toISOString(),
    };
    return { kind: "activate_entitlement", entitlement };
  }

  const reservation = reserveInventoryKey(
    input.inventory,
    input.offering.id,
    input.purchase.id,
    input.now,
    input.reservationDurationMs,
  );

  return {
    kind: "reserve_independent_key",
    purchaseId: input.purchase.id,
    inventoryKeyId: reservation.key.id,
    secretRef: reservation.key.secretRef,
    reservationExpiresAt: reservation.key.reservationExpiresAt!,
  };
}

export function assertUniqueInventoryFingerprints(
  inventory: readonly InventoryKey[],
): void {
  const fingerprints = new Set<string>();
  for (const key of inventory) {
    if (fingerprints.has(key.fingerprint)) {
      throw new InvalidFulfillmentError(
        `Duplicate inventory fingerprint: ${key.fingerprint}`,
      );
    }
    fingerprints.add(key.fingerprint);
  }
}
