import assert from 'node:assert/strict';
import test from 'node:test';
import { requestGeminiImage, requestOpenAICompatibleImage, requestOpenRouterImage, requestOpenAICompatibleSpeech, openAIImageEditModelSupported } from '../lib/index.js';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const reference = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
const image = { endpoint: new URL('https://example.test/v1/images'), apiKey: 'secret', model: 'image-model',
  idempotencyKey: 'comic-image-audit', prompt: 'Character', width: 1024, height: 1024 };

test('OpenAI generations cannot silently discard image references', async () => {
  let submissions = 0;
  await assert.rejects(requestOpenAICompatibleImage({ ...image, references: [reference], fetchImpl: async () => {
    submissions++; return Response.json({ data: [{ b64_json: Buffer.from(png).toString('base64') }] });
  } }), { code: 'IMAGE_REFERENCE_UNSUPPORTED' });
  assert.equal(submissions, 0);
});

for (const [name, invoke] of [['Gemini', requestGeminiImage], ['OpenRouter', requestOpenRouterImage]] as const) {
  test(`${name} rejects malformed or excess references before a paid submission`, async () => {
    let submissions = 0;
    for (const references of [[reference, 'https://untrusted.test/image.png'], Array(5).fill(reference)]) {
      await assert.rejects(invoke({ ...image, references, fetchImpl: async () => {
        submissions++; return Response.json({});
      } }), { code: 'INVALID_MEDIA_REQUEST' });
    }
    assert.equal(submissions, 0);
  });

  test(`${name} sends every admitted reference exactly once`, async () => {
    let body: any;
    let submissions = 0;
    const references = [reference, reference];
    await invoke({ ...image, references, fetchImpl: async (_endpoint, init) => {
      submissions++; body = JSON.parse(String(init?.body));
      return name === 'Gemini'
        ? Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from(png).toString('base64') } }] } }] })
        : Response.json({ data: [{ b64_json: Buffer.from(png).toString('base64') }] });
    } });
    assert.equal(submissions, 1);
    if (name === 'Gemini') assert.deepEqual(body.contents[0].parts.slice(0, 2).map((part: any) => part.inlineData.data), references.map(value => value.split(',')[1]));
    else assert.deepEqual(body.input_references.map((part: any) => part.image_url.url), references);
  });
}

test('speech rejects a provider format error without silently resubmitting', async () => {
  let submissions = 0;
  await assert.rejects(requestOpenAICompatibleSpeech({ endpoint: new URL('https://example.test/v1/audio/speech'), apiKey: 'secret',
    model: 'vendor/unknown-tts', idempotencyKey: 'comic-speech-audit', text: 'Hello', voice: 'alloy', format: 'mp3',
    fetchImpl: async () => { submissions++; return Response.json({ error: { message: 'This model only supports response_format="pcm".' } }, { status: 400 }); }
  }), { code: 'REQUEST_REJECTED' });
  assert.equal(submissions, 1);
});

test('an unanswered paid speech submission remains uncertain and is not retried', async () => {
  let submissions = 0;
  await assert.rejects(requestOpenAICompatibleSpeech({ endpoint: new URL('https://example.test/v1/audio/speech'), apiKey: 'secret',
    model: 'vendor/tts', idempotencyKey: 'comic-speech-unknown', text: 'Hello', voice: 'alloy', format: 'mp3',
    fetchImpl: async () => { submissions++; throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }); }
  }), (error: any) => error.code === 'MEDIA_SUBMISSION_UNKNOWN' && error.retryable === false);
  assert.equal(submissions, 1);
});

const gptImage = { ...image, endpoint: new URL('https://relay.example.test/prefix/v1/images/edits'), model: 'gpt-image-2.5-flare' };
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 8]);
const jpegReference = `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`;

for (const references of [[reference], [reference, jpegReference, reference, jpegReference]]) {
  test(`native GPT Image edit sends ${references.length} ordered files with SDK-compatible multipart boundary`, async () => {
    let submissions = 0;
    await requestOpenAICompatibleImage({ ...gptImage, references, negativePrompt: 'No watermark', fetchImpl: async (endpoint, init) => {
      submissions++;
      assert.equal(String(endpoint), gptImage.endpoint.href);
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).has('content-type'), false);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret');
      assert.equal(new Headers(init?.headers).get('idempotency-key'), 'comic-image-audit');
      const wire = new Request(endpoint, init);
      assert.match(wire.headers.get('content-type')!, /^multipart\/form-data; boundary=/);
      const form = await wire.formData();
      assert.equal(form.get('model'), gptImage.model);
      assert.equal(form.get('size'), '1024x1024');
      assert.equal(form.get('n'), '1');
      assert.equal(form.get('response_format'), null);
      assert.equal(String(form.get('prompt')).replace(/\r\n/g, '\n'), 'Character\n\nAvoid: No watermark');
      const field = references.length === 1 ? 'image' : 'image[]';
      const files = form.getAll(field) as File[];
      assert.equal(files.length, references.length);
      for (const [index, file] of files.entries()) {
        assert.equal(file.type, references[index].includes('image/jpeg') ? 'image/jpeg' : 'image/png');
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(references[index].split(',')[1], 'base64'));
        assert.equal(file.name, `reference-${index + 1}.${file.type === 'image/jpeg' ? 'jpg' : 'png'}`);
      }
      return Response.json({ data: [{ b64_json: Buffer.from(png).toString('base64') }] });
    } });
    assert.equal(submissions, 1);
  });
}

test('native image editing support is exact, not a family-name guess', () => {
  for (const model of ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2', 'gpt-image-2-2026-04-21',
    'gpt-image-2.5-flare', 'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08', 'chatgpt-image-latest']) {
    assert.equal(openAIImageEditModelSupported(model), true);
  }
  for (const model of ['dall-e-3', 'flux.2-pro', 'gemini-3.1-flash-image', 'gpt-image-2-official', 'gpt-image-future', 'openai/gpt-image-2', 'GPT-IMAGE-2', 'gpt-image-2-extra']) {
    assert.equal(openAIImageEditModelSupported(model), false);
  }
});

test('native GPT Image rejects unsafe references or a generation endpoint before submitting', async () => {
  let submissions = 0;
  const fetchImpl = async () => { submissions++; return Response.json({}); };
  for (const patch of [
    { references: Array(5).fill(reference) }, { references: [reference, 'https://untrusted.test/image.png'] },
    { references: ['data:image/png;base64,AAAA'] }, { references: ['data:image/png;base64,A'] },
    { references: [jpegReference.replace('image/jpeg', 'image/png')] },
  ]) await assert.rejects(requestOpenAICompatibleImage({ ...gptImage, ...patch, fetchImpl }), { code: 'INVALID_MEDIA_REQUEST' });
  await assert.rejects(requestOpenAICompatibleImage({ ...gptImage, endpoint: new URL('https://relay.example.test/v1/images/generations'), references: [reference], fetchImpl }), { code: 'IMAGE_REFERENCE_UNSUPPORTED' });
  for (const model of ['dall-e-3', 'gemini-3.1-flash-image', 'gpt-image-future', 'openai/gpt-image-2']) {
    await assert.rejects(requestOpenAICompatibleImage({ ...gptImage, model, references: [reference], fetchImpl }), { code: 'IMAGE_REFERENCE_UNSUPPORTED' });
  }
  assert.equal(submissions, 0);
});

test('native GPT Image bounds the reference body before a paid submission', async () => {
  const large = Buffer.alloc(10 * 1024 * 1024);
  large.set(png);
  const url = `data:image/png;base64,${large.toString('base64')}`;
  let submissions = 0;
  await assert.rejects(requestOpenAICompatibleImage({ ...gptImage, references: [url, url], fetchImpl: async () => {
    submissions++; return Response.json({});
  } }), { code: 'REQUEST_TOO_LARGE' });
  assert.equal(submissions, 0);
});

test('native GPT Image text generation uses JSON and omits unsupported response_format', async () => {
  let submissions = 0;
  await requestOpenAICompatibleImage({ ...gptImage, endpoint: new URL('https://relay.example.test/v1/images/generations'), references: [], fetchImpl: async (_endpoint, init) => {
    submissions++;
    assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), { model: gptImage.model, prompt: 'Character', n: 1, size: '1024x1024' });
    return Response.json({ data: [{ b64_json: Buffer.from(png).toString('base64') }] });
  } });
  assert.equal(submissions, 1);
});

test('non-GPT native image text generation retains its existing base64 response parameter', async () => {
  let submissions = 0;
  await requestOpenAICompatibleImage({ ...image, model: 'flux.2-pro', endpoint: new URL('https://relay.example.test/v1/images/generations'), fetchImpl: async (_endpoint, init) => {
    submissions++;
    assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), { model: 'flux.2-pro', prompt: 'Character', n: 1, size: '1024x1024', response_format: 'b64_json' });
    return Response.json({ data: [{ b64_json: Buffer.from(png).toString('base64') }] });
  } });
  assert.equal(submissions, 1);
});

test('native GPT Image cancellation before dispatch submits nothing', async () => {
  const controller = new AbortController(); controller.abort(); let submissions = 0;
  await assert.rejects(requestOpenAICompatibleImage({ ...gptImage, references: [reference], signal: controller.signal, fetchImpl: async () => {
    submissions++; return Response.json({});
  } }), { code: 'CANCELLED' });
  assert.equal(submissions, 0);
});

test('native GPT Image forwards cancellation to the one upstream request without replay', async () => {
  const controller = new AbortController(); let submissions = 0;
  await assert.rejects(requestOpenAICompatibleImage({ ...gptImage, references: [reference], signal: controller.signal, fetchImpl: async (_endpoint, init) => {
    submissions++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      controller.abort();
    });
  } }), { code: 'CANCELLED' });
  assert.equal(submissions, 1);
});

for (const status of [400, 401, 402, 429, 503]) {
  test(`native GPT Image retains HTTP ${status} classification and never switches to a paid fallback`, async () => {
    let submissions = 0;
    await assert.rejects(requestOpenAICompatibleImage({ ...gptImage, references: [reference], fetchImpl: async () => {
      submissions++; return Response.json({ error: { message: 'Controlled provider failure' } }, { status, headers: { 'retry-after': '2' } });
    } }), (error: any) => status === 429 ? error.code === 'RATE_LIMITED' && error.retryAfterMs === 2_000
      : status === 503 ? error.code === 'UPSTREAM_UNAVAILABLE' : status === 401 ? error.code === 'AUTH_FAILED' : error.code === 'REQUEST_REJECTED');
    assert.equal(submissions, 1);
  });
}

test('native GPT Image lost response remains unknown and is not automatically resubmitted', async () => {
  let submissions = 0;
  await assert.rejects(requestOpenAICompatibleImage({ ...gptImage, references: [reference], fetchImpl: async () => {
    submissions++; throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' });
  } }), (error: any) => error.code === 'MEDIA_SUBMISSION_UNKNOWN' && error.retryable === false);
  assert.equal(submissions, 1);
});

test('native GPT Image refuses URL-only output and bounded oversized responses', async () => {
  for (const response of [Response.json({ data: [{ url: 'http://127.0.0.1/private' }] }), new Response('x', { headers: { 'content-length': String(60 * 1024 * 1024) } })]) {
    let submissions = 0;
    await assert.rejects(requestOpenAICompatibleImage({ ...gptImage, references: [reference], fetchImpl: async () => { submissions++; return response; } }),
      (error: any) => ['URL_IMAGE_UNSUPPORTED', 'RESPONSE_TOO_LARGE'].includes(error.code));
    assert.equal(submissions, 1);
  }
});
