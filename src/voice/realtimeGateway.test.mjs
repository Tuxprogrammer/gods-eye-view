// This fork's local voice gateway (OPENAI_BASE_URL): a gateway-minted secret
// negotiates through the same-origin relay, an OpenAI one still goes direct.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeBackend } from './realtimeBackend.js';

const tokenReply = () =>
  Response.json({
    value: 'ephemeral-test',
    session: { model: 'compatible-model' },
    expires_at: Math.floor(Date.now() / 1000) + 60,
  });

test('a gateway-minted secret negotiates through the same-origin relay', async () => {
  const calls = [];
  const backend = createRealtimeBackend({
    tokenTransport: async () =>
      new Response(
        JSON.stringify({ value: 'gateway-secret', expires_at: 4e9 }),
        {
          headers: {
            'content-type': 'application/json',
            'X-GEV-Voice-Gateway': 'local',
            'X-GEV-Voice-Model': 'gev-voice',
          },
        },
      ),
    connectionTransport: async (input, init) => {
      calls.push(input);
      assert.equal(init.headers.Authorization, 'Bearer gateway-secret');
      return new Response('answer');
    },
  });
  const credential = await backend.requestToken();
  assert.equal(credential.gateway, 'local');
  assert.equal(credential.model, 'gev-voice');
  await backend.negotiate({ credential, offerSdp: 'offer' });
  assert.deepEqual(calls, ['/api/realtime/calls']);
});

test('an OpenAI-minted secret still negotiates with OpenAI directly', async () => {
  const calls = [];
  const backend = createRealtimeBackend({
    tokenTransport: async () => tokenReply(),
    connectionTransport: async (input) => {
      calls.push(input);
      return new Response('answer');
    },
  });
  const credential = await backend.requestToken();
  assert.equal(credential.gateway, null);
  await backend.negotiate({ credential, offerSdp: 'offer' });
  assert.deepEqual(calls, ['https://api.openai.com/v1/realtime/calls']);
});
