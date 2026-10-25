const TOOL_CONTRACT_FIXTURE_PATTERN = /artifacts\/NM_TOOL_CONTRACT_E2E_[A-Za-z0-9][A-Za-z0-9-]{0,79}\.txt/i;

/**
 * Extract the disposable tool-contract fixture without accepting path
 * separators or traversal. Run ids may be timestamps or UUIDs.
 */
export function toolContractFixturePath(value) {
  if (typeof value !== 'string') return undefined;
  if (/NM_MARKETING_DEMO_EN/i.test(value) && /(?:^|\s)src\/route-policy\.ts(?:\s|,|$)/i.test(value)) {
    return 'src/route-policy.ts';
  }
  return TOOL_CONTRACT_FIXTURE_PATTERN.exec(value)?.[0];
}

const OBSERVED_QA_ROUTES = new Set([
  '/health', '/v1/models', '/v1/chat/completions', '/v1/images/generations', '/v1/audio/speech',
  '/__nextmux_qa/delegation', '/__nextmux_qa/rate-limit'
]);

/** Only fixture lifecycle metadata; never log headers, bodies, queries or arbitrary URLs. */
export function observeQaRequest(request, response, pathname, write = line => process.stdout.write(line)) {
  const started = performance.now();
  const route = OBSERVED_QA_ROUTES.has(pathname) ? pathname : 'unknown';
  const method = ['GET', 'POST'].includes(request.method) ? request.method : 'other';
  const emit = (phase, extra = {}) => write(`${JSON.stringify({
    event: 'qa_request', at: new Date().toISOString(), method, route, phase, ...extra
  })}\n`);
  emit('started');
  let recorded = false;
  const complete = phase => {
    if (recorded) return;
    recorded = true;
    emit(phase, { status: phase === 'finished' || response.headersSent ? response.statusCode : null,
      elapsedMs: Math.round(performance.now() - started) });
  };
  response.once('finish', () => complete('finished'));
  response.once('close', () => complete('closed'));
}
