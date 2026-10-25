import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} exited ${result.status}`);
};

const isRosettaProcess = () => {
  if (process.platform !== 'darwin' || process.arch !== 'x64') return false;
  const result = spawnSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() === '1';
};

// Build-only system SDK tooling; a UI click never compiles code, downloads a
// model or invokes a shell. Native release jobs run on their target OS.
if (process.platform === 'darwin') {
  // A universal Xcode tool launched by an x64 Node process inherits Rosetta on
  // Apple Silicon. Force its native slice so cross-compiling the arm64 helper
  // cannot stall; genuine Intel runners keep using xcrun directly.
  const runXcode = args => isRosettaProcess()
    ? run('/usr/bin/arch', ['-arm64', 'xcrun', ...args])
    : run('xcrun', args);
  const bundle = path.join(root, 'apps/desktop/native/speech/macos/NextMuxSpeechHelper.app');
  const directory = path.join(bundle, 'Contents');
  mkdirSync(path.join(directory, 'MacOS'), { recursive: true });
  const source = path.join(root, 'apps/desktop/native/speech/NextMuxSpeechHelper.swift');
  const executable = path.join(directory, 'MacOS/NextMuxSpeechHelper');
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.nextmux.desktop.speech</string>
<key>CFBundleName</key><string>NextMux Speech</string>
<key>CFBundleDisplayName</key><string>NextMux Speech</string>
<key>CFBundleExecutable</key><string>NextMuxSpeechHelper</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSMicrophoneUsageDescription</key><string>NextMux uses your microphone only for speech you start, entering text into the current draft.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>NextMux converts speech to draft text using on-device recognition, without sending audio to a model account.</string>
</dict></plist>`;
  // macOS remembers microphone and speech-recognition consent per code identity. An unchanged helper keeps its
  // exact bytes (no recompile), and it is signed as one bundle with its Info.plist bound under a fixed identifier,
  // so a granted permission is not asked again on the next click or the next build.
  const stamp = path.join(root, 'apps/desktop/native/speech/macos/.build/source.sha256');
  const digest = createHash('sha256').update(readFileSync(source)).update(infoPlist).digest('hex');
  const current = existsSync(executable) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === digest;
  if (!current) {
    // Each architecture is compiled outside the bundle (a stray unsigned file inside it would break the signature).
    const scratch = path.join(root, 'apps/desktop/native/speech/macos/.build');
    mkdirSync(scratch, { recursive: true });
    const outputs = ['arm64', 'x86_64'].map(arch => {
      const target = path.join(scratch, `NextMuxSpeechHelper-${arch}`);
      runXcode(['swiftc', '-O', '-target', `${arch}-apple-macos12.0`, source, '-o', target]);
      return target;
    });
    runXcode(['lipo', '-create', ...outputs, '-output', executable]);
    for (const arch of ['arm64', 'x86_64']) rmSync(path.join(directory, 'MacOS', `NextMuxSpeechHelper-${arch}`), { force: true });
    writeFileSync(path.join(directory, 'Info.plist'), infoPlist);
  }
  for (const arch of ['arm64', 'x86_64']) rmSync(path.join(directory, 'MacOS', `NextMuxSpeechHelper-${arch}`), { force: true });
  const verified = spawnSync('/usr/bin/codesign', ['--verify', '--strict', bundle], { stdio: 'ignore' }).status === 0
    && /Identifier=io\.nextmux\.desktop\.speech/.test(spawnSync('/usr/bin/codesign', ['-dv', bundle], { encoding: 'utf8' }).stderr || '');
  if (!current || !verified) {
    // Release builds re-sign the bundle with the app's Developer ID; development uses an ad-hoc bundle signature.
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'io.nextmux.desktop.speech', bundle]);
  }
  mkdirSync(path.dirname(stamp), { recursive: true });
  writeFileSync(stamp, `${digest}\n`);
  console.log(current ? 'macOS speech helper unchanged; kept its signature.' : 'Built macOS arm64/x64 local speech helper. No microphone or model download was used.');
} else if (process.platform === 'win32') {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
  const compilerCandidates = [
    process.env.NEXTMUX_CSC_PATH,
    path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(systemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ].filter(Boolean);
  let compiler = compilerCandidates.find(candidate => existsSync(candidate));
  if (!compiler) {
    const located = spawnSync('where.exe', ['csc.exe'], { encoding: 'utf8', windowsHide: true });
    compiler = located.status === 0
      ? located.stdout.split(/\r?\n/).map(value => value.trim()).find(value => value && existsSync(value))
      : undefined;
  }
  if (!compiler) {
    throw new Error('Windows speech helper requires the Windows .NET Framework C# compiler (csc.exe).');
  }
  const directory = path.join(root, 'apps/desktop/native/speech/windows');
  const target = path.join(directory, 'NextMuxSpeechHelper.exe');
  const source = path.join(root, 'apps/desktop/native/speech/NextMuxSpeechHelper.cs');
  const iconIcoPath = path.join(root, 'apps/desktop/build-resources/icon.ico');
  mkdirSync(directory, { recursive: true });
  const cscArgs = ['/nologo', '/target:exe', '/platform:anycpu', '/optimize+', '/checked+',
    '/utf8output', '/reference:System.Speech.dll'];
  if (existsSync(iconIcoPath)) cscArgs.push(`/win32icon:${iconIcoPath}`);
  cscArgs.push(`/out:${target}`, source);
  run(compiler, cscArgs);

  // The build runner must execute the managed AnyCPU helper itself. This is
  // what makes a successful x64 build incapable of masquerading as ARM64.
  const probe = spawnSync(target, ['--probe', 'en-US'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
  if (probe.error || probe.status !== 0) {
    throw probe.error || new Error(`Windows speech helper probe exited ${probe.status}`);
  }
  const capability = JSON.parse(probe.stdout.trim());
  if (capability.type !== 'capability' || capability.engine !== 'windows-system-speech'
    || capability.localOnly !== true || capability.defaultDeviceOnly !== true
    || !['ready', 'language-unavailable'].includes(capability.status)) {
    throw new Error('Windows speech helper returned an invalid capability response.');
  }
  console.log(`Built and executed Windows AnyCPU system speech helper (${process.arch}); ${capability.status}.`);
}
