import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('scheduled tasks persist, register with native OS schedulers, and have an app-open fallback', async () => {
  const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  const service = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  assert.match(widget, /nextmux\.desktop\.scheduledTasks\.v1/);
  assert.match(widget, /scheduledTaskDueAt\(/);
  assert.match(widget, /executeScheduledTask\(/);
  assert.match(widget, /syncScheduledTaskRegistrations\(/);
  assert.match(widget, /backgroundMode: result\.mode/);
  assert.match(widget, /backgroundMode: 'app_open'/);
  assert.match(service, /schtasks\.exe/);
  assert.match(service, /launchctl/);
});

test('goal runs have bounded automatic continuation and persisted checkpoints', async () => {
  const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  const service = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  assert.match(widget, /AUTO_RESUME_LIMIT/);
  assert.match(widget, /scheduleAutomaticResume\(/);
  assert.match(widget, /resumeCheckpointId/);
  assert.match(service, /runStateStore\.save\(/);
  assert.match(service, /rebaseAgentRunCheckpoint\(/);
});
