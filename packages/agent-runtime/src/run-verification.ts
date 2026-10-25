import type { AgentRunVerification, AgentVerificationCheck, AgentToolCall, ToolExecutionResult } from './types.js';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Browser-safe restore boundary. A model's prose is never verification evidence. */
export function normalizeAgentRunVerification(value: unknown): AgentRunVerification | undefined {
  const input = record(value);
  if (!['not_required', 'unverified', 'passed', 'failed'].includes(String(input.status))
    || !Array.isArray(input.changedPaths) || !Array.isArray(input.checks)) return undefined;
  const changedPaths = [...new Set(input.changedPaths.filter((path): path is string => typeof path === 'string' && path.length > 0 && path.length <= 4096))].slice(0, 2000);
  const revision = Number.isSafeInteger(input.revision) && Number(input.revision) >= 0 ? Number(input.revision) : 0;
  const checks: AgentVerificationCheck[] = input.checks.slice(-100).flatMap(value => {
    const check = record(value);
    if (typeof check.callId !== 'string' || typeof check.command !== 'string'
      || !['passed', 'failed', 'running'].includes(String(check.status))) return [];
    const exitCode = Number.isSafeInteger(check.exitCode) ? Number(check.exitCode) : null;
    const status = check.status === 'passed' && exitCode !== 0 ? 'failed' : check.status as AgentVerificationCheck['status'];
    return [{ callId: check.callId.slice(0, 180), command: check.command.slice(0, 4096),
      status, exitCode,
      ...(typeof check.cwd === 'string' ? { cwd: check.cwd.slice(0, 4096) } : {}),
      revision: Number.isSafeInteger(check.revision) && Number(check.revision) >= 0 ? Number(check.revision) : 0,
      afterLastChange: check.afterLastChange === true,
      ...(typeof check.processId === 'string' ? { processId: check.processId.slice(0, 180) } : {}),
    }];
  });
  const failedEdits = Array.isArray(input.failedEdits) ? input.failedEdits.filter((path): path is string => typeof path === 'string' && path.length > 0 && path.length <= 4096) : [];
  return summarize(changedPaths, revision, checks, failedEdits);
}

function summarize(changedPaths: readonly string[], revision: number, checks: readonly AgentVerificationCheck[],
  failedEdits: readonly string[] = []): AgentRunVerification {
  // Keep the latest execution of each command, so a successful rerun resolves
  // its earlier failure without concealing different checks that still fail.
  const latest = new Map<string, AgentVerificationCheck>();
  for (const check of checks) latest.set(`${check.cwd ?? '.'}\0${check.command}`, { ...check, afterLastChange: check.revision === revision });
  const current = [...latest.values()].filter(check => check.afterLastChange);
  // An edit that never applied is a failed outcome however the remaining checks went: passing old tests is not
  // evidence that the requested change was made.
  const status = failedEdits.length || current.some(check => check.status === 'failed') ? 'failed'
    : current.some(check => check.status === 'running') ? 'unverified'
    : current.some(check => check.status === 'passed') ? 'passed'
    : changedPaths.length ? 'unverified' : 'not_required';
  return { status, changedPaths: [...changedPaths], revision, checks: [...latest.values()].slice(-100),
    ...(failedEdits.length ? { failedEdits: [...new Set(failedEdits)].slice(0, 200) } : {}) };
}

// These modes inspect/discover/configure a checker without checking code. Keep
// them separate from the executable name: exit 0 from a query is not evidence.
const inspectionOptions = new Set([
  '--help', '--version', '--showconfig', '--listtestsonly', '--listtests', '--list-tests', '--list',
  '--collect-only', '--collectonly', '--fixtures', '--fixtures-per-test',
  '--setup-only', '--setup-plan', '--markers', '--listfilesonly', '--init',
  '--print-config', '--printconfig', '--inspect-config', '--show-settings',
  '--show-files', '--list-targets', '--clearcache', '--clear-cache',
  '--generate-rcfile', '--generate-toml-config', '--full-documentation',
  '--list-msgs', '--list-msgs-enabled', '--list-groups', '--list-extensions',
  '--help-msg', '--list-rules', '--explain', '--dry', '--dry-run', '--no-run',
]);

function inspectsOnly(argv: readonly string[]): boolean {
  return argv.some(arg => arg === '-h' || arg === '-V' || arg === '--co'
    || inspectionOptions.has(arg.split('=', 1)[0].toLowerCase()));
}

/** Recognize an execution mode, never words printed by echo or a model.
 * Project scripts remain conventional check entry points; this cannot prove
 * their contents or coverage. Query/list/setup modes never certify a revision. */
export function isVerificationCommand(input: unknown): boolean {
  const args = record(input);
  if (args.useTerminalProfile === true || typeof args.command !== 'string' || !Array.isArray(args.args)
    || !args.args.every(arg => typeof arg === 'string')) return false;
  const command = args.command.replaceAll('\\', '/').split('/').pop()!.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, '');
  const argv = args.args as string[];
  if (inspectsOnly(argv)) return false;
  if (command === 'tsc') return !argv.includes('-v');
  if (/^(?:pytest|jest|eslint|mypy|pylint)$/.test(command)) return true;
  if (command === 'vitest') return !['list', 'init', 'bench'].includes(argv[0] ?? '');
  if (command === 'ruff') return argv[0] === 'check' || argv[0] === 'format' && argv.includes('--check');
  if (command === 'cargo-nextest') return argv[0] === 'run';
  if (/^node(?:js)?$/.test(command)) return argv.includes('--test') && !argv.some(arg => ['-e', '--eval', '-p', '--print'].includes(arg));
  if (/^python(?:3(?:\.\d+)?)?$/.test(command)) {
    if (argv[0] !== '-m') return false;
    if (['pytest', 'mypy', 'pylint'].includes(argv[1] ?? '')) return isVerificationCommand({ command: argv[1], args: argv.slice(2) });
    return ['unittest', 'compileall'].includes(argv[1] ?? '');
  }
  if (command === 'cargo') return ['test', 'check', 'clippy', 'build'].includes(argv[0] ?? '') && !argv.includes('--list');
  if (command === 'go') return ['test', 'build', 'vet'].includes(argv[0] ?? '') && !argv.some(arg => arg === '-n' || arg === '-list' || arg.startsWith('-list='));
  if (command === 'dotnet') return ['test', 'build'].includes(argv[0] ?? '') && !argv.includes('-t');
  if (/^(?:npm|pnpm|yarn|bun)$/.test(command)) {
    const words = [...argv];
    // These options take a directory value; never search arbitrary argv for
    // the word "test" (npm exec echo test is not a test).
    while (['--dir', '-C', '--prefix', '--cwd'].includes(words[0] ?? '')) words.splice(0, 2);
    if (words[0] === 'run' || words[0] === 'run-script') words.shift();
    if (words.slice(1).some(word => ['list', '--list', 'collect-only'].includes(word))) return false;
    return /^(?:test|lint|typecheck|check|build)(?:[:.-][\w.-]+)?$/.test(words[0] ?? '');
  }
  return false;
}

function samePath(left: string, right: string): boolean {
  const a = left.replaceAll('\\', '/'), b = right.replaceAll('\\', '/');
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

export class AgentVerificationTracker {
  #state: AgentRunVerification;
  constructor(restored?: unknown) {
    this.#state = normalizeAgentRunVerification(restored) ?? { status: 'not_required', changedPaths: [], revision: 0, checks: [] };
  }
  snapshot(): AgentRunVerification { return summarize(this.#state.changedPaths, this.#state.revision, this.#state.checks, this.#state.failedEdits); }
  observe(call: AgentToolCall, result: ToolExecutionResult): void {
    const output = record(result.output);
    const summaryPaths = result.summary.changedPaths ?? (Array.isArray(output.changedPaths) ? output.changedPaths.filter((v): v is string => typeof v === 'string') : []);
    const resource = result.summary.resource;
    const paths = [...summaryPaths, ...(result.ok && resource?.kind === 'file' && ['created', 'updated', 'deleted'].includes(resource.action) ? [resource.path] : [])];
    // Recovery may start from a checkpoint before a committed edit was
    // observed. Recover its missing dirty paths, but never certify a current
    // revision with an old command result or repeatedly advance that revision.
    if (result.ledger?.replayed) {
      const missing = paths.filter(path => !this.#state.changedPaths.includes(path));
      if (missing.length) this.#state = summarize([...new Set([...this.#state.changedPaths, ...missing])].slice(0, 2000),
        this.#state.revision + 1, this.#state.checks, this.#state.failedEdits);
      return;
    }
    // A file edit that failed leaves the file as it was; a later successful edit of that file resolves it. Models mix
    // absolute and workspace-relative spellings of one file, so compare by path suffix.
    let failedEdits = this.#state.failedEdits ?? [];
    if (resource?.kind === 'file' && ['created', 'updated', 'deleted'].includes(resource.action)) {
      const others = failedEdits.filter(path => !samePath(path, resource.path));
      failedEdits = result.ok ? others : [...others, resource.path];
    }
    let { revision } = this.#state;
    if (paths.length) revision += 1;
    const changedPaths = [...new Set([...this.#state.changedPaths, ...paths])].slice(0, 2000);
    const checks = this.#state.checks.map(check => ({ ...check }));
    const processId = typeof output.processId === 'string' ? output.processId : typeof record(call.arguments).processId === 'string' ? String(record(call.arguments).processId) : undefined;
    if ((call.name === 'process.run' || call.name === 'process.start') && isVerificationCommand(call.arguments)) {
      const running = output.running === true;
      const exitCode = typeof output.exitCode === 'number' ? output.exitCode : null;
      checks.push({ callId: call.id, command: result.summary.commandLine ?? JSON.stringify(call.arguments),
        ...(typeof record(call.arguments).cwd === 'string' ? { cwd: String(record(call.arguments).cwd) } : {}),
        status: running ? 'running' : result.ok && exitCode === 0 && !output.signal && !output.terminationReason ? 'passed' : 'failed',
        exitCode, revision, afterLastChange: true, ...(processId ? { processId } : {}) });
    } else if (processId && ['process.read', 'process.terminate'].includes(call.name) && output.running === false) {
      let index = -1;
      for (let i = checks.length - 1; i >= 0; i--) if (checks[i].processId === processId && checks[i].status === 'running') { index = i; break; }
      if (index >= 0) {
        const previous = checks[index];
        // A separate edit while an async check ran invalidates that check.
        const wasCurrent = previous.revision === this.#state.revision;
        checks[index] = { ...previous, revision: wasCurrent ? revision : previous.revision,
          status: result.ok && output.exitCode === 0 && !output.signal && !output.terminationReason ? 'passed' : 'failed',
          exitCode: typeof output.exitCode === 'number' ? output.exitCode : null };
      }
    }
    this.#state = summarize(changedPaths, revision, checks, failedEdits);
  }
}
