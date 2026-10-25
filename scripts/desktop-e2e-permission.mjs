const fullAccessPattern = /Full Access|完全访问|完全存取|フルアクセス|전체 액세스|Acceso completo|Accès complet|Vollzugriff|Acesso total|Полный доступ|وصول كامل|पूर्ण पहुँच/i;

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForValue(evaluate, expression, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await evaluate(expression);
    if (value) return value;
    await pause(120);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
}

/** Select and confirm full access through the same product UI a user uses. */
export async function ensureDesktopFullAccess(evaluate, timeoutMs = 8_000) {
  const label = await evaluate(`document.querySelector('.nmx-permission-button')?.textContent || ''`);
  if (fullAccessPattern.test(label)) return label.trim();

  await evaluate(`document.querySelector('.nmx-permission-button')?.click()`);
  await waitForValue(evaluate,
    `Boolean(document.querySelector('.nmx-permission-popover button:nth-of-type(3)'))`,
    'full-access permission option', timeoutMs);
  await evaluate(`document.querySelector('.nmx-permission-popover button:nth-of-type(3)')?.click()`);
  await waitForValue(evaluate,
    `Boolean(document.querySelector('.nmx-permission-sheet .nmx-primary-button'))`,
    'full-access confirmation', timeoutMs);
  await evaluate(`document.querySelector('.nmx-permission-sheet .nmx-primary-button')?.click()`);
  return waitForValue(evaluate,
    `(() => {
      const label = document.querySelector('.nmx-permission-button')?.textContent || '';
      return /Full Access|完全访问|完全存取|フルアクセス|전체 액세스|Acceso completo|Accès complet|Vollzugriff|Acesso total|Полный доступ|وصول كامل|पूर्ण पहुँच/i.test(label) ? label.trim() : '';
    })()`,
    'full-access permission applied', timeoutMs);
}
