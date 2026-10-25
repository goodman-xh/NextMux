import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const swift = readFileSync(new URL('../native/speech/NextMuxSpeechHelper.swift', import.meta.url), 'utf8');
const windows = readFileSync(new URL('../native/speech/NextMuxSpeechHelper.cs', import.meta.url), 'utf8');
const expected = [
  '第一句未修正', '第一句', '第一句', '第一句第二', '第一句第二句',
  '第一句第二句', '第一句第二句', 'first sentence', 'first sentence next',
  'first sentence next part', 'first sentence next', 'first sentence next',
  'first sentence next', '第一句第二句', '第一句第二句第三句', '😀', '😀',
];

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('the actual Swift accumulator preserves completed utterances, corrections and empty finish snapshots', { skip: process.platform !== 'darwin' }, () => {
  const source = swift.slice(swift.indexOf('struct DictationTranscript {'), swift.indexOf('final class RecognitionSession {'));
  assert.ok(source.startsWith('struct DictationTranscript {'));
  const directory = mkdtempSync(path.join(tmpdir(), 'nextmux-swift-transcript-'));
  try {
    const file = path.join(directory, 'main.swift'), output = path.join(directory, 'transcript');
    writeFileSync(file, `import Foundation\n${source}
var transcript = DictationTranscript()
print(transcript.revise("第一句未修正"))
print(transcript.revise("第一句"))
transcript.commit()
print(transcript.text)
print(transcript.revise("第二"))
print(transcript.revise("第二句"))
print(transcript.revise(""))
transcript.commit()
print(transcript.text)
var english = DictationTranscript()
print(english.revise("first sentence"))
english.commit()
print(english.revise("next"))
print(english.revise("next part"))
print(english.revise("next"))
print(english.revise("  "))
english.commit()
print(english.text)
transcript.commit()
print(transcript.text)
print(transcript.revise("第三句"))
var emoji = DictationTranscript()
print(emoji.revise("😀"))
print(emoji.revise(""))
`);
    const rosetta = process.arch === 'x64' && spawnSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' }).stdout?.trim() === '1';
    run(rosetta ? '/usr/bin/arch' : '/usr/bin/xcrun', [...(rosetta ? ['-arm64', 'xcrun'] : []), 'swiftc', file, '-o', output]);
    assert.deepEqual(run(output, []).trim().split(/\r?\n/), expected);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the actual Windows accumulator follows the same cumulative transcript contract', t => {
  const compiler = process.platform === 'win32' ? process.env.NEXTMUX_CSC_PATH || 'csc.exe' : 'mcs';
  const capability = spawnSync(compiler, ['--version'], { encoding: 'utf8' });
  if (capability.error?.code === 'ENOENT') { t.skip('a C# source compiler is not installed'); return; }
  const source = windows.slice(windows.indexOf('    private sealed class DictationTranscript\n'), windows.indexOf('    private sealed class RecognitionSession : IDisposable'));
  assert.ok(source.includes('private sealed class DictationTranscript'));
  const directory = mkdtempSync(path.join(tmpdir(), 'nextmux-windows-transcript-'));
  try {
    const file = path.join(directory, 'Transcript.cs'), output = path.join(directory, 'transcript.exe');
    writeFileSync(file, `using System;\ninternal static class Program {\n${source}
static void Main() {
var transcript = new DictationTranscript();
Console.WriteLine(transcript.Revise("第一句未修正"));
Console.WriteLine(transcript.Revise("第一句"));
Console.WriteLine(transcript.Commit(""));
Console.WriteLine(transcript.Revise("第二"));
Console.WriteLine(transcript.Revise("第二句"));
Console.WriteLine(transcript.Revise(""));
Console.WriteLine(transcript.Commit(""));
var english = new DictationTranscript();
Console.WriteLine(english.Revise("first sentence"));
english.Commit("");
Console.WriteLine(english.Revise("next"));
Console.WriteLine(english.Revise("next part"));
Console.WriteLine(english.Revise("next"));
Console.WriteLine(english.Revise("  "));
Console.WriteLine(english.Commit(""));
Console.WriteLine(transcript.Commit(""));
Console.WriteLine(transcript.Revise("第三句"));
var emoji = new DictationTranscript();
Console.WriteLine(emoji.Revise("😀"));
Console.WriteLine(emoji.Revise(""));
} }`);
    run(compiler, ['/nologo', `/out:${output}`, file]);
    assert.deepEqual(run(process.platform === 'win32' ? output : 'mono', process.platform === 'win32' ? [] : [output]).trim().split(/\r?\n/), expected);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('native utterance rotation retains capture ownership and the original session bounds', () => {
  assert.match(swift, /generation == self\.taskGeneration/);
  assert.match(swift, /result\.isFinal \|\| \(result\.speechRecognitionMetadata\?\.speechDuration \?\? 0\) > 0/);
  assert.match(swift, /self\.transcript\.commit\(\)/);
  assert.match(swift, /if self\.finishing \{ self\.end\("stopped"\) \}/);
  assert.match(swift, /else \{ self\.startTask\(recognizer\) \}/);
  const rotation = swift.slice(swift.indexOf('    private func startTask('));
  assert.doesNotMatch(rotation, /engine\.start\(|installTap\(|requestAuthorization|requestAccess|asyncAfter/);
  assert.equal((swift.match(/\.now\(\) \+ 300/g) || []).length, 1);
  assert.match(swift, /requestLock\.lock\(\)[\s\S]*?self\.request\?\.append\(buffer\)[\s\S]*?requestLock\.unlock\(\)/);
  assert.match(swift, /text\.utf16\.count <= 10_000/);
  assert.match(windows, /transcript\.Revise\(eventArgs\.Result\.Text\)/);
  assert.match(windows, /transcript\.Commit\(eventArgs\.Result\.Text\)/);
  assert.match(windows, /RecognizeAsync\(RecognizeMode\.Multiple\)/);
  assert.match(windows, /300000/);
});
