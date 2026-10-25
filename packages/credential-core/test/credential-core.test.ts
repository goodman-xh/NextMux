import assert from "node:assert/strict";
import test from "node:test";

import type {
  InventoryKey,
  ManagedCredential,
  ModelOffering,
  Purchase,
} from "@nextmux/contracts";

import {
  InventoryUnavailableError,
  assertUniqueInventoryFingerprints,
  countAvailableInventory,
  deliverReservedInventoryKey,
  planFulfillment,
  reconcileIndependentOfferingStock,
  reserveInventoryKey,
  selectManagedCredential,
  withdrawUnsoldInventoryKey,
} from "../src/index.ts";

const now = new Date("2026-08-25T12:00:00.000Z");

function offering(
  fulfillmentMode: ModelOffering["fulfillmentMode"],
): ModelOffering {
  return {
    id: `offer-${fulfillmentMode}`,
    providerId: "provider-1",
    endpointId: "endpoint-1",
    modelDefinitionId: "model-1",
    providerModelCode: "model-code",
    displayName: "Test model",
    sourceType: "authorized_relay",
    fulfillmentMode,
    region: "cn-east",
    status: "active",
  };
}

function paidPurchase(offeringId: string): Purchase {
  return {
    id: "purchase-1",
    organizationId: "organization-1",
    offeringId,
    status: "paid",
  };
}

function inventoryKey(
  id: string,
  offeringId: string,
  overrides: Partial<InventoryKey> = {},
): InventoryKey {
  return {
    id,
    providerId: "provider-1",
    offeringId,
    secretRef: `vault://inventory/${id}`,
    fingerprint: `fp-${id}`,
    status: "available",
    ...overrides,
  };
}

test("managed gateway purchase creates an entitlement and never delivers a provider key", () => {
  const managedOffering = offering("managed_gateway");
  const action = planFulfillment({
    offering: managedOffering,
    purchase: paidPurchase(managedOffering.id),
    inventory: [inventoryKey("unused", managedOffering.id)],
    now,
    entitlementId: "entitlement-1",
  });

  assert.equal(action.kind, "activate_entitlement");
  assert.equal("secretRef" in action, false);
});

test("independent-key purchase reserves exactly one matching key", () => {
  const keyOffering = offering("independent_key");
  const action = planFulfillment({
    offering: keyOffering,
    purchase: paidPurchase(keyOffering.id),
    inventory: [
      inventoryKey("wrong", "another-offering"),
      inventoryKey("right", keyOffering.id),
    ],
    now,
    entitlementId: "unused",
  });

  assert.equal(action.kind, "reserve_independent_key");
  if (action.kind === "reserve_independent_key") {
    assert.equal(action.inventoryKeyId, "right");
    assert.equal(action.secretRef, "vault://inventory/right");
  }
});

test("expired checkout reservations return to available inventory", () => {
  const inventory = [
    inventoryKey("reusable", "offer-1", {
      status: "reserved",
      reservedByPurchaseId: "old-purchase",
      reservationExpiresAt: "2026-08-25T11:59:59.000Z",
    }),
  ];

  const result = reserveInventoryKey(
    inventory,
    "offer-1",
    "new-purchase",
    now,
  );

  assert.equal(result.key.id, "reusable");
  assert.equal(result.key.reservedByPurchaseId, "new-purchase");
});

test("delivered keys are never allocated again", () => {
  assert.throws(
    () =>
      reserveInventoryKey(
        [
          inventoryKey("sold", "offer-1", {
            status: "delivered",
            deliveredToPurchaseId: "prior-purchase",
          }),
        ],
        "offer-1",
        "new-purchase",
        now,
      ),
    InventoryUnavailableError,
  );
});

test("a reserved key can only be delivered to its owning purchase", () => {
  const reservation = reserveInventoryKey(
    [inventoryKey("one-time", "offer-1")],
    "offer-1",
    "purchase-owner",
    now,
  );

  assert.throws(() =>
    deliverReservedInventoryKey(reservation.key, "another-purchase", now),
  );

  const delivered = deliverReservedInventoryKey(
    reservation.key,
    "purchase-owner",
    now,
  );
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.deliveredToPurchaseId, "purchase-owner");
  assert.equal(delivered.reservedByPurchaseId, undefined);
});

test("available stock reaches zero after the final key is reserved", () => {
  const reservation = reserveInventoryKey(
    [inventoryKey("last-key", "offer-1")],
    "offer-1",
    "purchase-1",
    now,
  );

  assert.equal(countAvailableInventory(reservation.inventory, "offer-1", now), 0);
  const keyOffering = { ...offering("independent_key"), id: "offer-1" };
  assert.equal(
    reconcileIndependentOfferingStock(keyOffering, reservation.inventory, now)
      .status,
    "out_of_stock",
  );
});

test("new validated stock restores an out-of-stock offering", () => {
  const keyOffering: ModelOffering = {
    ...offering("independent_key"),
    id: "offer-1",
    status: "out_of_stock",
  };
  const restored = reconcileIndependentOfferingStock(
    keyOffering,
    [inventoryKey("new-stock", keyOffering.id)],
    now,
  );
  assert.equal(restored.status, "active");
});

test("vendors may withdraw unsold keys but not reserved or delivered keys", () => {
  const withdrawn = withdrawUnsoldInventoryKey(
    inventoryKey("unsold", "offer-1"),
    now,
  );
  assert.equal(withdrawn.status, "withdrawn");

  assert.throws(() =>
    withdrawUnsoldInventoryKey(
      inventoryKey("reserved", "offer-1", {
        status: "reserved",
        reservedByPurchaseId: "purchase-1",
        reservationExpiresAt: "2026-08-25T12:10:00.000Z",
      }),
      now,
    ),
  );

  assert.throws(() =>
    withdrawUnsoldInventoryKey(
      inventoryKey("delivered", "offer-1", {
        status: "delivered",
        deliveredToPurchaseId: "purchase-1",
      }),
      now,
    ),
  );
});

test("managed credential selection respects region, capacity, budget, and load", () => {
  const credentials: ManagedCredential[] = [
    {
      id: "busy",
      providerId: "provider-1",
      endpointId: "endpoint-1",
      secretRef: "vault://credential/busy",
      fingerprint: "fp-busy",
      status: "active",
      offeringIds: ["offer-1"],
      region: "cn-east",
      priority: 10,
      weight: 1,
      maxConcurrency: 10,
      inFlight: 9,
      remainingBudgetMinor: 1000,
    },
    {
      id: "free",
      providerId: "provider-1",
      endpointId: "endpoint-1",
      secretRef: "vault://credential/free",
      fingerprint: "fp-free",
      status: "active",
      offeringIds: ["offer-1"],
      region: "cn-east",
      priority: 10,
      weight: 1,
      maxConcurrency: 10,
      inFlight: 1,
      remainingBudgetMinor: 1000,
    },
    {
      id: "other-region",
      providerId: "provider-1",
      endpointId: "endpoint-1",
      secretRef: "vault://credential/other",
      fingerprint: "fp-other",
      status: "active",
      offeringIds: ["offer-1"],
      region: "us-east",
      priority: 20,
      weight: 10,
      maxConcurrency: 10,
      inFlight: 0,
      remainingBudgetMinor: 1000,
    },
  ];

  const selected = selectManagedCredential(credentials, {
    offeringId: "offer-1",
    endpointId: "endpoint-1",
    preferredRegion: "cn-east",
    estimatedCostMinor: 10,
    now,
  });

  assert.equal(selected.id, "free");
});

test("duplicate inventory fingerprints are rejected", () => {
  assert.throws(() =>
    assertUniqueInventoryFingerprints([
      inventoryKey("one", "offer-1", { fingerprint: "same" }),
      inventoryKey("two", "offer-1", { fingerprint: "same" }),
    ]),
  );
});
