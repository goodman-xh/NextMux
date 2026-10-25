const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/**
 * Reload an Electron renderer and wait for a genuinely new document.
 *
 * CDP's Page.reload command returns before Chromium commits the navigation.
 * Waiting only for an element that also exists in the old document can race
 * and send the next interaction to a document that is about to be destroyed.
 */
export async function reloadDesktopDocument({
  call,
  evaluate,
  ignoreCache = false,
  timeoutMs = 30_000,
}) {
  const marker = `nextmux-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await evaluate(`(() => {
    document.documentElement?.setAttribute('data-nextmux-e2e-document', ${JSON.stringify(marker)});
    return true;
  })()`);
  await call('Page.reload', { ignoreCache });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await evaluate(`({
        marker: document.documentElement?.getAttribute('data-nextmux-e2e-document') || '',
        readyState: document.readyState
      })`);
      if (state?.marker !== marker && state?.readyState !== 'loading') return state;
    } catch {
      // Chromium may briefly have no execution context while committing the
      // navigation. That is expected; retry against the new document.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for a new Electron document after Page.reload (${timeoutMs} ms).`);
}
