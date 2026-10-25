import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { devNull } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';
import { AgentToolError } from './errors.js';

/** Environment layout adapted from desktop/dugite v3.2.3 (MIT).
 * Copyright (c) 2016 GitHub and contributors. See docs/oss-intake/dugite-MIT.txt.
 * Git itself is a separate GPL-2.0 executable, never linked into this runtime.
 */
export async function resolveForkGitRuntime(options: {
  readonly resourcesPath?: string;
  readonly packaged?: boolean;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
  readonly environment?: NodeJS.ProcessEnv;
} = {}): Promise<{ binary: string; env: NodeJS.ProcessEnv; bundled: boolean }> {
  const sourceEnv = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const resources = options.resourcesPath ?? sourceEnv.NEXTMUX_RESOURCES_PATH;
  const packaged = options.packaged ?? sourceEnv.NEXTMUX_PACKAGED_RUNTIME === '1';
  // Checkpoint operations must not inherit repository/config overrides from a
  // user's terminal. Windows treats environment keys case-insensitively.
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(sourceEnv).filter(([key]) => !/^GIT_/i.test(key)));
  env.GIT_CONFIG_NOSYSTEM = '1'; env.GIT_CONFIG_GLOBAL = devNull; env.GIT_TERMINAL_PROMPT = '0';
  if (!resources) {
    if (packaged) throw new AgentToolError('GIT_RUNTIME_MISSING', 'The installed Git runtime is missing; repair or update NextMux');
    return { binary: platform === 'win32' ? 'git.exe' : 'git', env, bundled: false };
  }
  const root = join(resources, 'git-runtime', `${platform}-${architecture}`);
  try {
    const manifest = JSON.parse(await readFile(join(root, 'complete.json'), 'utf8')) as {
      schema?: unknown; platform?: unknown; architecture?: unknown; release?: unknown;
    };
    if (manifest.schema !== 1 || manifest.platform !== platform || manifest.architecture !== architecture || manifest.release !== 'v2.53.0-4') {
      throw new Error('Git runtime target/version mismatch');
    }
    const windows = platform === 'win32';
    const subfolder = architecture === 'arm64' ? 'clangarm64' : 'mingw64';
    const binary = join(root, windows ? 'cmd' : 'bin', windows ? 'git.exe' : 'git');
    const execPath = windows ? join(root, subfolder, 'libexec', 'git-core') : join(root, 'libexec', 'git-core');
    const actualRoot = await realpath(root);
    for (const candidate of [binary, execPath]) {
      const delta = relative(actualRoot, await realpath(candidate));
      if (isAbsolute(delta) || delta === '..' || delta.startsWith(`..${sep}`)) throw new Error('Git runtime path escapes resource directory');
    }
    await access(binary, windows ? constants.F_OK : constants.X_OK);
    env.GIT_EXEC_PATH = execPath;
    if (windows) {
      const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH');
      const inherited = pathKey ? env[pathKey] : '';
      for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
      env.PATH = [join(root, subfolder, 'bin'), join(root, subfolder, 'usr', 'bin'), join(root, 'usr', 'bin'), inherited].filter(Boolean).join(';');
    } else env.GIT_TEMPLATE_DIR = join(root, 'share', 'git-core', 'templates');
    return { binary, env, bundled: true };
  } catch (error) {
    // A configured bundle must never silently fall back to the developer's
    // system Git: that would hide broken installers and architecture mismatches.
    throw new AgentToolError('GIT_RUNTIME_MISSING', `The installed Git runtime is unavailable: ${error instanceof Error ? error.message : 'invalid runtime'}`);
  }
}
