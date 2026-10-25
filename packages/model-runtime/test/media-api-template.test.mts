import test from "node:test";
import assert from 'node:assert/strict';

import * as engine from "../lib/media-api-template.js";
// @ts-ignore The shared cases live beside the platform's JavaScript twin.
import { mediaTemplateCases } from "../../../apps/cloudflare-platform/test/fixtures/media-template-cases.mjs";

for (const [name, run] of Object.entries(mediaTemplateCases(engine) as Record<string, () => void>)) test(name, run);

test('media cancellation is optional, explicit and validated before use', () => {
  for (const [preset, method, path] of [
    ['fal', 'PUT', '{base}/{model}/requests/{id}/cancel'],
    ['replicate', 'POST', '{base}/predictions/{id}/cancel'],
    ['ark', 'DELETE', '{base}/contents/generations/tasks/{id}'],
  ]) assert.deepEqual(engine.normalizeMediaTemplate({ preset }).cancel, { method, path, body: '' });
  assert.equal(engine.normalizeMediaTemplate({ preset: 'relay' }).cancel, undefined);
  assert.equal(engine.normalizeMediaTemplate({ preset: 'fal', cancel: null }).cancel, undefined);
  assert.deepEqual(engine.normalizeMediaTemplate({ cancel: { method: 'POST', path: '{base}/cancel', body: '{"id":"{{id}}"}' } }).cancel,
    { method: 'POST', path: '{base}/cancel', body: '{"id":"{{id}}"}' });
  for (const [cancel, field, reason] of [
    [[], 'cancel', 'invalid_json_object'],
    [{ method: 'GET', path: '{base}/cancel' }, 'cancel.method', 'invalid_method'],
    [{ method: 'POST', path: 'http://insecure.test/cancel' }, 'cancel.path', 'invalid_path'],
    [{ method: 'DELETE', path: '{base}/cancel', body: '[]' }, 'cancel.body', 'invalid_json_object'],
  ]) assert.throws(() => engine.normalizeMediaTemplate({ cancel }), (error: any) => error.code === 'media_template_invalid'
    && error.params.field === field && error.params.reason === reason);
});
