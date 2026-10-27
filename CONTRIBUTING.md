# Contributing to NextMux

NextMux welcomes focused, reviewable contributions. The customer desktop,
merchant portal, gateway contracts, and credential state machines are separate
trust boundaries; a change should not blur them for convenience.

## Development setup

Requirements:

- Node.js 24.18 or newer in the Node 24 line;
- pnpm 11.19.0 through Corepack;
- Windows for Windows installer verification;
- macOS for signed DMG/ZIP verification.

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm check
```

## Pull requests

- Keep one behavioural change per pull request.
- Add a regression test for state, security, routing, or credential changes.
- Never place a real API key, session, signing identity, or merchant database in
  source control, fixtures, screenshots, or CI logs.
- Preserve the two fulfilment boundaries: a managed purchase returns a platform
  entitlement; independent inventory allocates one upstream key to one buyer.
- Keep customer purchase/workbench UI in the desktop app and merchant operations
  in the provider web portal.
- For UI changes, attach a real rendered capture and verify keyboard focus,
  overflow, empty, loading, error, and narrow-window states.
- Update the relevant document when changing a public contract or lifecycle.

Run `pnpm check` before opening a pull request. Desktop changes also require a
generated-app build and packaged-app smoke test on the affected operating system.

Security reports must follow [SECURITY.md](SECURITY.md), not a public issue.
