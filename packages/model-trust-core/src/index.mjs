import { createHmac } from "node:crypto";

export const REMEDIATION_WINDOW_MS = 30 * 60 * 1000;

export const PROBE_KINDS = Object.freeze([
  "credential_validation",
  "network",
  "protocol",
  "capability",
  "fingerprint",
  "blind_canary",
]);

const FIDELITY_DIMENSIONS = Object.freeze({
  provenance: { weight: 25, categories: new Set(["provenance", "signed_artifact"]) },
  protocol: { weight: 20, categories: new Set(["protocol"]) },
  capability: { weight: 20, categories: new Set(["capability"]) },
  behavioral: { weight: 25, categories: new Set(["behavioral_fingerprint"]) },
  drift: { weight: 10, categories: new Set(["drift"]) },
});

const BASE_CADENCE_MS = Object.freeze({
  credential_validation: 0,
  network: 5 * 60 * 1000,
  protocol: 6 * 60 * 60 * 1000,
  capability: 48 * 60 * 60 * 1000,
  fingerprint: 7 * 24 * 60 * 60 * 1000,
  blind_canary: 12 * 60 * 60 * 1000,
});

const RISK_MULTIPLIER = Object.freeze({ low: 1, medium: 0.7, high: 0.35 });

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, percentileValue) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function confidenceFor({ sampleCount, dimensionCount, blindSampleCount }) {
  if (sampleCount >= 40 && dimensionCount >= 4 && blindSampleCount >= 6) return "very_high";
  if (sampleCount >= 16 && dimensionCount >= 4 && blindSampleCount >= 2) return "high";
  if (sampleCount >= 6 && dimensionCount >= 3) return "medium";
  return "low";
}

function verdictFor(index, confidence, evidence) {
  const definitiveContradiction = evidence.some(item =>
    item.severity === "critical" && item.contradiction === true && item.score <= 20,
  );
  if (definitiveContradiction) return "critical_mismatch";
  if (index < 20 && confidence !== "low") return "critical_mismatch";
  if (index < 45 && confidence !== "low") return "material_mismatch";
  if (confidence === "low") return "inconclusive";
  if (index >= 85 && ["high", "very_high"].includes(confidence)) return "strong_match";
  if (index >= 70) return "probable_match";
  return "inconclusive";
}

/**
 * Produces an evidence-weighted consistency index. It deliberately shrinks new
 * offerings toward 50 so a single successful request cannot create a 100 score.
 */
export function calculateModelFidelity(evidence, options = {}) {
  if (!Array.isArray(evidence)) throw new TypeError("evidence must be an array");
  const normalized = evidence
    .filter(item => item && Number.isFinite(item.score))
    .map(item => ({ ...item, score: clamp(Number(item.score)) }));

  const dimensions = {};
  let weightedTotal = 0;
  let availableWeight = 0;
  for (const [name, definition] of Object.entries(FIDELITY_DIMENSIONS)) {
    const samples = normalized.filter(item => definition.categories.has(item.category));
    if (!samples.length) continue;
    const score = average(samples.map(item => item.score));
    dimensions[name] = { score: Math.round(score), sampleCount: samples.length };
    weightedTotal += score * definition.weight;
    availableWeight += definition.weight;
  }

  const rawIndex = availableWeight ? weightedTotal / availableWeight : 50;
  const priorMean = clamp(options.priorMean ?? 50);
  const priorWeight = Math.max(1, options.priorWeight ?? 6);
  const evidenceWeight = normalized.reduce(
    (sum, item) => sum + (item.source === "blind_canary" || item.source === "inventory_sample" ? 1.35 : 1),
    0,
  );
  let index = (rawIndex * evidenceWeight + priorMean * priorWeight) /
    (evidenceWeight + priorWeight);

  const definitiveContradiction = normalized.some(item =>
    item.severity === "critical" && item.contradiction === true && item.score <= 20,
  );
  if (definitiveContradiction) index = Math.min(index, 19);
  index = Math.round(clamp(index));

  const sampleCount = normalized.length;
  const dimensionCount = Object.keys(dimensions).length;
  const blindSampleCount = normalized.filter(item =>
    item.source === "blind_canary" || item.source === "inventory_sample",
  ).length;
  const confidence = confidenceFor({ sampleCount, dimensionCount, blindSampleCount });
  const intervalRadius = Math.max(
    confidence === "low" ? 16 : confidence === "medium" ? 10 : confidence === "high" ? 6 : 4,
    Math.round(30 / Math.sqrt(sampleCount + 1)),
  );

  return {
    index,
    uncertaintyLow: Math.round(clamp(index - intervalRadius)),
    uncertaintyHigh: Math.round(clamp(index + intervalRadius)),
    verdict: verdictFor(index, confidence, normalized),
    confidence,
    sampleCount,
    blindSampleCount,
    dimensions,
    methodVersion: options.methodVersion || "mfi-1",
    baselineVersion: options.baselineVersion || "unversioned",
    measuredAt: options.measuredAt || new Date().toISOString(),
  };
}

/** Network quality is independent from model authenticity. */
export function calculateNetworkQuality(samples, options = {}) {
  if (!Array.isArray(samples)) throw new TypeError("samples must be an array");
  // Platform-side egress failures are excluded rather than charged to the
  // merchant's availability score.
  const normalized = samples.filter(sample =>
    sample && typeof sample.outcome === "string" && sample.outcome !== "platform_error",
  );
  if (!normalized.length) {
    return {
      index: 50,
      confidence: "low",
      sampleCount: 0,
      availability: undefined,
      p50LatencyMs: undefined,
      p95LatencyMs: undefined,
      measuredAt: options.measuredAt || new Date().toISOString(),
    };
  }

  const reachable = new Set(["success", "rate_limited", "permission_denied"]);
  const successful = normalized.filter(sample => sample.outcome === "success");
  const availability = normalized.filter(sample => reachable.has(sample.outcome)).length /
    normalized.length;
  const latencies = successful
    .map(sample => Number(sample.latencyMs))
    .filter(Number.isFinite);
  const p50LatencyMs = percentile(latencies, 50);
  const p95LatencyMs = percentile(latencies, 95);
  const latencyScore = p95LatencyMs === undefined
    ? 45
    : clamp(100 - Math.max(0, p95LatencyMs - 500) / 45);
  const index = Math.round(clamp(availability * 75 + latencyScore * 0.25));
  const confidence = normalized.length >= 100
    ? "very_high"
    : normalized.length >= 30
      ? "high"
      : normalized.length >= 8
        ? "medium"
        : "low";

  return {
    index,
    confidence,
    sampleCount: normalized.length,
    availability: Number(availability.toFixed(4)),
    p50LatencyMs,
    p95LatencyMs,
    measuredAt: options.measuredAt || new Date().toISOString(),
  };
}

export function classifyTransportResult(result = {}) {
  if (result.ok === true) return "success";
  const status = Number(result.statusCode);
  if (status === 401) return "auth_invalid";
  if (status === 403) return "permission_denied";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "provider_5xx";
  if (result.errorCode === "DNS_ERROR") return "dns_error";
  if (result.errorCode === "TLS_ERROR") return "tls_error";
  if (result.errorCode === "TIMEOUT") return "timeout";
  if (result.errorCode === "PLATFORM_EGRESS_ERROR") return "platform_error";
  if (result.errorCode === "MODEL_MISMATCH") return "model_mismatch";
  if (result.errorCode === "CAPABILITY_MISMATCH") return "capability_mismatch";
  return "protocol_error";
}

/**
 * Authentication and identity incidents require corroboration. A transient
 * network failure never becomes a credential incident.
 */
export function confirmProbeIncident(attempts) {
  if (!Array.isArray(attempts) || !attempts.length) return { classification: "inconclusive" };
  const outcomes = attempts.map(attempt => attempt.outcome);
  const successes = outcomes.filter(outcome => outcome === "success").length;
  if (successes === attempts.length) return { classification: "healthy" };

  const distinctMonitors = new Set(attempts.map(attempt => attempt.monitorId).filter(Boolean)).size;
  const authFailures = outcomes.filter(outcome =>
    outcome === "auth_invalid" || outcome === "permission_denied",
  ).length;
  if (authFailures && successes) {
    return { classification: "intermittent_auth", confirmed: false };
  }
  if (authFailures >= 2 && distinctMonitors >= 2) {
    return { classification: "confirmed_auth_failure", confirmed: true };
  }
  if (authFailures) return { classification: "suspected_auth_failure", confirmed: false };

  const mismatches = attempts.filter(attempt => attempt.outcome === "model_mismatch");
  const definitive = mismatches.some(attempt => attempt.definitiveEvidence === true);
  const mismatchSources = new Set(mismatches.map(attempt => attempt.source).filter(Boolean)).size;
  if (definitive || (mismatches.length >= 2 && mismatchSources >= 2)) {
    return { classification: "confirmed_model_mismatch", confirmed: true };
  }
  if (mismatches.length) return { classification: "suspected_model_mismatch", confirmed: false };

  const networkOutcomes = new Set(["dns_error", "tls_error", "timeout", "provider_5xx"]);
  if (outcomes.every(outcome => networkOutcomes.has(outcome))) {
    return { classification: "network_incident", confirmed: attempts.length >= 2 };
  }
  return { classification: "inconclusive", confirmed: false };
}

function asIso(value) {
  return new Date(value).toISOString();
}

/** Pure incident state machine. Persistence applies returned actions atomically. */
export function transitionTrustIncident(current, event, options = {}) {
  const now = new Date(options.now || event.at || Date.now());
  if (!Number.isFinite(now.getTime())) throw new TypeError("Invalid incident timestamp");
  const incident = current ? { ...current } : undefined;

  if (event.type === "confirmed_auth_failure") {
    if (!event.wasListed) {
      return { incident: { ...incident, status: "candidate_rejected", resolvedAt: asIso(now) }, actions: ["reject_candidate"] };
    }
    // Repeated failed probes must never extend the merchant's remediation
    // window. The first corroborated failure owns the deadline.
    if (incident?.status === "remediation" && incident.deadlineAt) {
      return {
        incident,
        actions: ["pause_checkout"],
      };
    }
    const deadline = new Date(now.getTime() + (options.remediationWindowMs || REMEDIATION_WINDOW_MS));
    return {
      incident: {
        ...incident,
        kind: "audit_credential",
        status: "remediation",
        firstDetectedAt: incident?.firstDetectedAt || asIso(now),
        confirmedAt: asIso(now),
        deadlineAt: asIso(deadline),
        resolvedAt: undefined,
      },
      actions: ["pause_checkout", "notify_merchant"],
    };
  }

  if (event.type === "confirmed_model_mismatch") {
    return {
      incident: {
        ...incident,
        kind: "model_mismatch",
        status: "quarantined",
        firstDetectedAt: incident?.firstDetectedAt || asIso(now),
        confirmedAt: asIso(now),
        deadlineAt: undefined,
        resolvedAt: undefined,
      },
      actions: ["pause_checkout", "quarantine_offering", "require_manual_review"],
    };
  }

  if (event.type === "network_incident") {
    return {
      incident: {
        ...incident,
        kind: "network",
        status: "observing",
        firstDetectedAt: incident?.firstDetectedAt || asIso(now),
        resolvedAt: undefined,
      },
      actions: ["mark_network_degraded"],
    };
  }

  if (event.type === "replacement_validated" || event.type === "probe_recovered") {
    return {
      incident: { ...incident, status: "resolved", resolvedAt: asIso(now) },
      actions: event.type === "replacement_validated"
        ? ["activate_replacement", "resume_checkout", "restore_listing"]
        : ["mark_network_healthy"],
    };
  }

  if (event.type === "deadline_elapsed") {
    if (!incident || incident.status !== "remediation") {
      return { incident, actions: [] };
    }
    if (new Date(incident.deadlineAt).getTime() > now.getTime()) {
      return { incident, actions: [] };
    }
    return {
      incident: { ...incident, status: "delisted", delistedAt: asIso(now) },
      actions: ["delist_offering", "notify_merchant"],
    };
  }

  return { incident, actions: [] };
}

function deterministicUnit(secret, subject) {
  const digest = createHmac("sha256", secret).update(subject).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

/** Hidden deterministic jitter prevents synchronized or provider-predictable probes. */
export function nextProbeAt({
  probeKind,
  subjectId,
  scheduleSecret,
  from = Date.now(),
  riskTier = "medium",
  sequence = 0,
}) {
  if (!PROBE_KINDS.includes(probeKind)) throw new TypeError(`Unknown probe kind: ${probeKind}`);
  const fromDate = new Date(from);
  if (!Number.isFinite(fromDate.getTime())) throw new TypeError("Invalid schedule start");
  const base = BASE_CADENCE_MS[probeKind];
  if (base === 0) return fromDate.toISOString();
  const multiplier = RISK_MULTIPLIER[riskTier] || RISK_MULTIPLIER.medium;
  const unit = deterministicUnit(scheduleSecret, `${subjectId}:${probeKind}:${sequence}`);
  const jitter = 0.75 + unit * 0.5;
  return new Date(fromDate.getTime() + base * multiplier * jitter).toISOString();
}
