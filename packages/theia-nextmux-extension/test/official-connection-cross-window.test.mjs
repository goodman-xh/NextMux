import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

// Audit DS-13: two windows (two service instances, one backend) save different
// connections at the same moment; the index keeps both.
test('connections saved from two windows at once are both kept', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-connections-windows-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  class WindowService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return root; }
    networkFetch = async () => Response.json({ data: [] });
    async deleteOfficialCredential() { /* environment credentials never use the keychain */ }
    async readOfficialConnectionIndex() {
      const value = await super.readOfficialConnectionIndex();
      await new Promise(resolve => setTimeout(resolve, 10)); // widen the read-modify-write window
      return value;
    }
  }
  const request = model => ({ providerId: 'azure_openai', model, baseUrl: 'https://resource.openai.azure.com/openai/v1',
    providerSettings: { credentialSource: 'environment', apiVersion: 'v1' }, validate: false });
  const windows = [new WindowService(), new WindowService(), new WindowService()];
  await Promise.all(windows.map((window, index) => window.saveOfficialModelConnection(request(`deployment-${index}`))));
  const saved = await windows[0].readOfficialConnectionIndex();
  assert.deepEqual(saved.map(item => item.model).sort(), ['deployment-0', 'deployment-1', 'deployment-2']);
});
