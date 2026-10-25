import { spawn } from 'child_process';
import { win32 } from 'path';

// Node's Windows rename uses MOVEFILE_REPLACE_EXISTING, which can replace a
// regular legacy lock with a directory. Directory.Move uses MoveFile without
// replacement. Paths are data on stdin, never PowerShell source or arguments.
const MOVE_DIRECTORY_SCRIPT = `$ErrorActionPreference='Stop'; $moved=$false; try {
    [Console]::InputEncoding = [Text.Encoding]::UTF8;
    $request = ConvertFrom-Json ([Console]::In.ReadToEnd());
    $source = [string]$request.source; if ($source -match '^[A-Za-z]:\\\\') { $source = '\\\\?\\' + $source }
    $destination = [string]$request.destination; if ($destination -match '^[A-Za-z]:\\\\') { $destination = '\\\\?\\' + $destination }
    [IO.Directory]::Move($source, $destination);
    $moved=$true;
    [Console]::Out.Write('OK'); exit 0;
} catch {
    if ($moved) { exit 2; }
    $failure = $_.Exception;
    while ($failure.InnerException) { $failure = $failure.InnerException; }
    [Console]::Out.Write('ERROR:' + ($failure.HResult -band 65535)); exit 1;
}`;

export interface DelegationLockPublicationError extends Error {
    readonly code: string;
    readonly publicationUncertain?: boolean;
    readonly helperMayStillRun?: boolean;
}

function publicationError(code: string, uncertain = false): DelegationLockPublicationError {
    return Object.assign(new Error('Unable to publish the Windows delegation lock'), {
        code,
        ...(uncertain ? { publicationUncertain: true } : {})
    });
}

/** Windows only; this operation never replaces an existing destination. */
export async function moveWindowsDelegationLock(source: string, destination: string, timeoutMs = 5000): Promise<void> {
    const configuredRoot = process.env.SystemRoot;
    const systemRoot = configuredRoot && win32.isAbsolute(configuredRoot) ? configuredRoot : 'C:\\Windows';
    const executable = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', MOVE_DIRECTORY_SCRIPT], {
            windowsHide: true,
            shell: false,
            stdio: ['pipe', 'pipe', 'ignore']
        });
        let output = '';
        let timedOut = false;
        let finished = false;
        let terminationTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: DelegationLockPublicationError) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (terminationTimer) clearTimeout(terminationTimer);
            if (error) reject(error); else resolve();
        };
        const terminate = () => {
            if (timedOut || finished) return;
            timedOut = true;
            child.kill();
            if (finished) return;
            // Do not wait indefinitely for an unresponsive helper. The caller
            // retains its candidate and reconciles the unique owner token.
            terminationTimer = setTimeout(() => {
                child.unref();
                finish(Object.assign(publicationError('ETIMEDOUT', true), { helperMayStillRun: true }));
            }, 1000);
        };
        const timer = setTimeout(terminate, Math.max(1, Math.min(timeoutMs, 5000)));
        child.once('error', () => finish(Object.assign(publicationError('EIO', true), { helperMayStillRun: true })));
        child.stdout.on('data', data => {
            output = (output + data.toString('utf8')).slice(0, 257);
            if (output.length > 256) terminate();
        });
        child.stdin.on('error', () => { /* Reconcile on close: the move may already have succeeded. */ });
        child.once('close', code => {
            if (timedOut) return finish(publicationError('ETIMEDOUT', true));
            if (code === 0 && output === 'OK') return finish();
            const nativeCode = /^ERROR:(\d+)$/.exec(output)?.[1];
            const mapped = nativeCode === '183' || nativeCode === '80' ? 'EEXIST'
                : nativeCode === '5' ? 'EACCES'
                    : nativeCode === '2' || nativeCode === '3' ? 'ENOENT'
                        : nativeCode === '206' ? 'ENAMETOOLONG' : undefined;
            finish(publicationError(mapped || 'EIO', !nativeCode));
        });
        child.stdin.end(JSON.stringify({ source, destination }));
    });
}
