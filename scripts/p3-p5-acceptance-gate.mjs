import { readFile } from 'node:fs/promises';

const REQUIRED_P3_DURATIONS = new Set(['1h', '72h']);

export function evaluateP3P5({ p3, p5 }) {
  const reasons = [];
  if (!p3 || p3.stage !== 'P3') reasons.push('missing_p3_report');
  if (p3?.status !== 'passed') reasons.push('p3_report_not_passed');
  if (p3?.mode !== 'authenticated-production-canary') reasons.push('p3_not_authenticated_canary');
  if (p3?.productionData !== true) reasons.push('p3_not_production_data');
  const productionRuns = (p3?.longTaskRuns || []).filter(run => (
    run?.status === 'passed'
    && run?.productionData === true
    && Number.isSafeInteger(run?.providerRequests)
    && run.providerRequests > 0
    && run?.recovery?.verified === true
    && run?.billing?.duplicateDispatch === false
  ));
  const durations = new Set(productionRuns.map(run => run.duration));
  for (const duration of REQUIRED_P3_DURATIONS) {
    if (!durations.has(duration)) reasons.push(`missing_p3_${duration}_production_evidence`);
  }
  if (p3?.transport?.sequence?.monotonic !== true) reasons.push('p3_sequence_not_proven');
  if (p3?.transport?.taskIdPresent !== true) reasons.push('p3_task_id_not_proven');
  if (p3?.billing?.duplicateAttemptObserved !== false) reasons.push('p3_duplicate_attempt_unknown');

  if (!p5 || p5.report !== 'p5-live-billing-audit') reasons.push('missing_p5_report');
  if (p5?.productionData !== true || p5?.writes !== 0) reasons.push('p5_not_read_only_production_data');
  if (p5?.billingContract?.providerChargeEvidence !== 'verified') reasons.push('missing_independent_provider_charge_evidence');
  const totals = p5?.liveLedgerReadOnly?.completedTotals;
  if (!totals || !Number.isSafeInteger(totals.customerChargedMicros) || !Number.isSafeInteger(totals.merchantCostMicros)) reasons.push('p5_totals_missing');
  if (p5?.localVerification?.failed !== 0) reasons.push('p5_local_suite_failed');
  return reasons.length ? { status: 'blocked', reasons } : { status: 'passed', reasons: [] };
}

async function load(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

if (process.argv[1]?.endsWith('p3-p5-acceptance-gate.mjs')) {
  const [p3Path, p5Path] = process.argv.slice(2);
  if (!p3Path || !p5Path) { console.error('usage: node scripts/p3-p5-acceptance-gate.mjs P3.json P5.json'); process.exit(2); }
  const result = evaluateP3P5({ p3: await load(p3Path), p5: await load(p5Path) });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'passed') process.exitCode = 1;
}
