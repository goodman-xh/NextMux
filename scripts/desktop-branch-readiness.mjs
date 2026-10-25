import { assertExactQaComposerRoute, readExactQaComposerRoute } from './desktop-official-qa-route.mjs';

/** A mounted renderer is not proof that the requested durable session has restored. */
export async function waitForExactBranchComposerRoute({ evaluate, route, sessionId, timeoutMs = 25_000,
  now = Date.now, pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('Branch readiness requires an exact session ID');
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const snapshot = await readExactQaComposerRoute(evaluate);
    if (snapshot.session?.id === sessionId) return assertExactQaComposerRoute(snapshot, route);
    await pause(120);
  }
  throw new Error('Timed out restoring the exact branch conversation before route verification');
}
