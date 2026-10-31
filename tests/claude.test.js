import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentifier, ScanRefused, ScanInvalid } from '../src/claude.js';

const reading = {
  name: 'Fouinar',
  setName: 'Ténèbres Embrasées',
  setCode: null,
  number: '136',
  printedTotal: 189,
  language: 'fr',
  variant: 'normal',
  condition: 'Near Mint',
  defects: [],
  confidence: 'high',
};

function fakeClient(response) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        parse: async (request) => {
          requests.push(request);
          return {
            stop_reason: 'end_turn',
            parsed_output: reading,
            usage: { input_tokens: 10, output_tokens: 20 },
            content: [],
            ...response,
          };
        },
      },
    },
  };
}

test('the request targets sonnet 5.5 with structured output and the image first', async () => {
  const client = fakeClient();
  await createIdentifier({ client })('QUJD');
  const [request] = client.requests;
  assert.equal(request.model, 'claude-sonnet-5-5');
  assert.deepEqual(request.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(request.fallbacks, 'default');
  assert.equal(request.output_config.effort, 'medium');
  assert.ok(request.output_config.format);
  const [image, text] = request.messages[0].content;
  assert.deepEqual(image, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
  assert.equal(text.type, 'text');
  for (const banned of ['temperature', 'top_p', 'top_k', 'tool_choice', 'thinking']) {
    assert.equal(banned in request, false, banned);
  }
});

test('effort is configurable', async () => {
  const client = fakeClient();
  await createIdentifier({ client, effort: 'low' })('QUJD');
  assert.equal(client.requests[0].output_config.effort, 'low');
});

test('the result carries identification, usage and raw response', async () => {
  const result = await createIdentifier({ client: fakeClient() })('QUJD');
  assert.deepEqual(result.identification, reading);
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 20 });
  assert.ok(result.raw);
});

test('a refusal throws ScanRefused', async () => {
  const identify = createIdentifier({ client: fakeClient({ stop_reason: 'refusal', parsed_output: null }) });
  await assert.rejects(identify('QUJD'), ScanRefused);
});

test('a truncated answer throws ScanInvalid', async () => {
  const identify = createIdentifier({ client: fakeClient({ stop_reason: 'max_tokens' }) });
  await assert.rejects(identify('QUJD'), ScanInvalid);
});

test('a missing parsed output throws ScanInvalid', async () => {
  const identify = createIdentifier({ client: fakeClient({ parsed_output: null }) });
  await assert.rejects(identify('QUJD'), ScanInvalid);
});
