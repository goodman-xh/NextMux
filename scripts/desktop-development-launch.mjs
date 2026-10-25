import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const application = fileURLToPath(new URL('../apps/desktop', import.meta.url));
const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url));

/** Use absolute application arguments for every source E2E, including restarts and queues. */
export function developmentDesktopLaunch({ workspaceRoot, cdpPort, electronProfile }) {
    const command = desktopRequire('electron');
    if (typeof command !== 'string' || !existsSync(command)) {
        throw new Error('NextMux Electron runtime is missing. Run pnpm desktop:build before desktop E2E.');
    }
    return {
        command,
        args: [application, resolve(workspaceRoot), '--log-level=debug',
            `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${electronProfile}`, `--electronUserData=${electronProfile}`],
        kind: 'development'
    };
}
