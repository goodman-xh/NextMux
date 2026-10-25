import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateP3P5 } from './p3-p5-acceptance-gate.mjs';

const p3 = {
  stage: 'P3', status: 'passed', mode: 'authenticated-production-canary', productionData: true,
  transport: { sequence: { monotonic: true }, taskIdPresent: true }, billing: { duplicateAttemptObserved: false },
  longTaskRuns: [
    { duration: '1h', status: 'passed', productionData: true, providerRequests: 1, recovery: { verified: true }, billing: { duplicateDispatch: false } },
    { duration: '72h', status: 'passed', productionData: true, providerRequests: 1, recovery: { verified: true }, billing: { duplicateDispatch: false } },
  ],
};
const p5 = { report: 'p5-live-billing-audit', productionData: true, writes: 0, billingContract: { providerChargeEvidence: 'verified' }, liveLedgerReadOnly: { completedTotals: { customerChargedMicros: 1, merchantCostMicros: 1 } }, localVerification: { failed: 0 } };

test('P3/P5 gate passes only with both long-task runs and independent charge evidence', () => {
  assert.deepEqual(evaluateP3P5({ p3, p5 }), { status: 'passed', reasons: [] });
});

test('short canary and platform-only ledger stay blocked', () => {
  const result = evaluateP3P5({ p3: { ...p3, status: 'partial', longTaskRuns: [] }, p5: { ...p5, billingContract: { providerChargeEvidence: 'not_available' } } });
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.includes('missing_p3_72h_production_evidence'));
  assert.ok(result.reasons.includes('missing_independent_provider_charge_evidence'));
});

test('fixture-shaped duration claims without production evidence stay blocked', () => {
  const result = evaluateP3P5({
    p3: { ...p3, productionData: false, longTaskRuns: [{ duration: '1h', status: 'passed' }, { duration: '72h', status: 'passed' }] },
    p5,
  });
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.includes('p3_not_production_data'));
  assert.ok(result.reasons.includes('missing_p3_1h_production_evidence'));
  assert.ok(result.reasons.includes('missing_p3_72h_production_evidence'));
});
