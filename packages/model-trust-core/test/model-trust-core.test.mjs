import assert from "node:assert/strict";
import test from "node:test";

import {
  REMEDIATION_WINDOW_MS,
  calculateModelFidelity,
  calculateNetworkQuality,
  confirmProbeIncident,
  nextProbeAt,
  transitionTrustIncident,
} from "../src/index.mjs";

test("one successful probe cannot create a high-confidence perfect score", () => {
  const snapshot = calculateModelFidelity([
    { category: "protocol", score: 100, severity: "info", source: "audit" },
  ], { measuredAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(snapshot.confidence, "low");
  assert.equal(snapshot.verdict, "inconclusive");
  assert.ok(snapshot.index < 60);
  assert.ok(snapshot.uncertaintyHigh > snapshot.index);
});

test("blind evidence and broad repeated coverage can produce strong match", () => {
  const categories = ["provenance", "protocol", "capability", "behavioral_fingerprint", "drift"];
  const evidence = Array.from({ length: 45 }, (_, index) => ({
    category: categories[index % categories.length],
    score: 96,
    severity: "info",
    source: index % 3 === 0 ? "blind_canary" : "audit",
  }));
  const snapshot = calculateModelFidelity(evidence);
  assert.equal(snapshot.confidence, "very_high");
  assert.equal(snapshot.verdict, "strong_match");
  assert.ok(snapshot.index >= 85);
});

test("definitive contradictory evidence caps fidelity and verdict", () => {
  const snapshot = calculateModelFidelity([
    ...Array.from({ length: 20 }, () => ({ category: "protocol", score: 95, severity: "info", source: "audit" })),
    { category: "signed_artifact", score: 0, severity: "critical", contradiction: true, source: "audit" },
  ]);
  assert.equal(snapshot.verdict, "critical_mismatch");
  assert.ok(snapshot.index <= 19);
});

test("auth remediation requires two monitors and a mixed success is not confirmed", () => {
  assert.equal(confirmProbeIncident([
    { outcome: "auth_invalid", monitorId: "cn-1" },
  ]).classification, "suspected_auth_failure");
  assert.equal(confirmProbeIncident([
    { outcome: "auth_invalid", monitorId: "cn-1" },
    { outcome: "auth_invalid", monitorId: "sg-1" },
  ]).classification, "confirmed_auth_failure");
  assert.equal(confirmProbeIncident([
    { outcome: "auth_invalid", monitorId: "cn-1" },
    { outcome: "success", monitorId: "sg-1" },
  ]).classification, "intermittent_auth");
});

test("network errors never become a credential remediation incident", () => {
  const confirmation = confirmProbeIncident([
    { outcome: "timeout", monitorId: "cn-1" },
    { outcome: "provider_5xx", monitorId: "sg-1" },
  ]);
  assert.equal(confirmation.classification, "network_incident");
  const transition = transitionTrustIncident(undefined, { type: "network_incident" }, {
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(transition.actions, ["mark_network_degraded"]);
  assert.equal(transition.incident.status, "observing");
});

test("confirmed auth failure pauses checkout then delists exactly after deadline", () => {
  const started = transitionTrustIncident(undefined, {
    type: "confirmed_auth_failure",
    wasListed: true,
  }, { now: "2026-01-01T00:00:00.000Z" });
  assert.equal(started.incident.deadlineAt, "2026-01-01T00:30:00.000Z");
  assert.ok(started.actions.includes("pause_checkout"));
  const early = transitionTrustIncident(started.incident, { type: "deadline_elapsed" }, {
    now: "2026-01-01T00:29:59.999Z",
  });
  assert.deepEqual(early.actions, []);
  const expired = transitionTrustIncident(started.incident, { type: "deadline_elapsed" }, {
    now: "2026-01-01T00:30:00.000Z",
  });
  assert.equal(REMEDIATION_WINDOW_MS, 1_800_000);
  assert.equal(expired.incident.status, "delisted");
  assert.ok(expired.actions.includes("delist_offering"));
});

test("repeated failures cannot silently extend the remediation deadline", () => {
  const first = transitionTrustIncident(undefined, {
    type: "confirmed_auth_failure",
    wasListed: true,
  }, { now: "2026-01-01T00:00:00.000Z" });
  const repeated = transitionTrustIncident(first.incident, {
    type: "confirmed_auth_failure",
    wasListed: true,
  }, { now: "2026-01-01T00:20:00.000Z" });
  assert.equal(repeated.incident.deadlineAt, "2026-01-01T00:30:00.000Z");
  assert.equal(repeated.incident.confirmedAt, "2026-01-01T00:00:00.000Z");
});

test("replacement validation restores checkout and listing", () => {
  const transition = transitionTrustIncident({
    kind: "audit_credential",
    status: "remediation",
    deadlineAt: "2026-01-01T00:30:00.000Z",
  }, { type: "replacement_validated" }, { now: "2026-01-01T00:12:00.000Z" });
  assert.equal(transition.incident.status, "resolved");
  assert.deepEqual(transition.actions, ["activate_replacement", "resume_checkout", "restore_listing"]);
});

test("probe jitter is deterministic but differs by kind and sequence", () => {
  const input = {
    probeKind: "network",
    subjectId: "offering-1",
    scheduleSecret: "test-schedule-secret",
    from: "2026-01-01T00:00:00.000Z",
    riskTier: "medium",
  };
  assert.equal(nextProbeAt(input), nextProbeAt(input));
  assert.notEqual(nextProbeAt(input), nextProbeAt({ ...input, sequence: 1 }));
  assert.notEqual(nextProbeAt(input), nextProbeAt({ ...input, probeKind: "protocol" }));
});

test("network quality keeps availability separate from latency", () => {
  const snapshot = calculateNetworkQuality([
    { outcome: "success", latencyMs: 400 },
    { outcome: "success", latencyMs: 900 },
    { outcome: "rate_limited", latencyMs: 200 },
    { outcome: "timeout", latencyMs: 5000 },
  ], { measuredAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(snapshot.availability, 0.75);
  assert.equal(snapshot.p50LatencyMs, 400);
  assert.equal(snapshot.p95LatencyMs, 900);
  assert.equal(snapshot.confidence, "low");
});

test("platform egress failures are not charged to a merchant network score", () => {
  const snapshot = calculateNetworkQuality([
    { outcome: "success", latencyMs: 300 },
    { outcome: "platform_error" },
  ]);
  assert.equal(snapshot.sampleCount, 1);
  assert.equal(snapshot.availability, 1);
});
