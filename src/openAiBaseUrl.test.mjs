import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import {
  OPENAI_BASE_URL_DEFAULT,
  resolveOpenAiBaseUrl,
} from '../server/providers/openai/base-url.js';
import { handleHudSummary } from '../server/providers/openai/hud-summary.js';
import {
  createRealtimeCallsHandler,
  createRealtimeTokenHandler,
} from '../server/providers/openai/realtime.js';

/** Set an env var for one test and put the old value back afterwards. */
function env(t, name, value) {
  const old = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (old === undefined) delete process.env[name];
    else process.env[name] = old;
  });
}

function post(
  handler,
  {
    body = '{}',
    remoteAddress,
    url = '/',
    method = 'POST',
    headers = { 'content-type': 'application/json' },
  } = {},
) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([Buffer.from(body)]);
    Object.assign(req, {
      method,
      url,
      headers: { host: 'localhost:4173', ...headers },
      socket: { remoteAddress },
    });
    const replyHeaders = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        replyHeaders[name.toLowerCase()] = value;
      },
      end(payload = '') {
        resolve({
          status: this.statusCode,
          headers: replyHeaders,
          body: String(payload),
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n';

test('an unset or blank OPENAI_BASE_URL keeps OpenAI', () => {
  assert.equal(resolveOpenAiBaseUrl(undefined), OPENAI_BASE_URL_DEFAULT);
  assert.equal(resolveOpenAiBaseUrl(''), OPENAI_BASE_URL_DEFAULT);
  assert.equal(resolveOpenAiBaseUrl('   '), OPENAI_BASE_URL_DEFAULT);
  assert.equal(OPENAI_BASE_URL_DEFAULT, 'https://api.openai.com/v1');
});

test('a local gateway root is used as given, without trailing slashes', () => {
  assert.equal(
    resolveOpenAiBaseUrl('https://lmg.example.net/v1/'),
    'https://lmg.example.net/v1',
  );
  assert.equal(
    resolveOpenAiBaseUrl(' http://10.0.0.5:4000/v1 '),
    'http://10.0.0.5:4000/v1',
  );
});

test('a value that is not a plain http(s) URL falls back to OpenAI', (t) => {
  t.mock.method(console, 'warn', () => {});
  for (const value of [
    'lmg.example.net/v1',
    'ftp://lmg.example.net/v1',
    'https://user:pass@lmg.example.net/v1',
    'https://lmg.example.net/v1?key=x',
    'https://lmg.example.net/v1#frag',
  ])
    assert.equal(resolveOpenAiBaseUrl(value), OPENAI_BASE_URL_DEFAULT, value);
});

test('the HUD summary goes to the configured gateway with the server key', async (t) => {
  env(t, 'OPENAI_API_KEY', 'fixture-gateway-key');
  env(t, 'OPENAI_BASE_URL', 'https://lmg.example.net/v1/');
  env(t, 'OPENAI_HUD_SUMMARY_MODEL', 'gev-hud');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    // LiteLLM answers with output_text null and the words in output[].
    return Response.json({
      output_text: null,
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'Huntsville traffic cameras live' },
          ],
        },
      ],
    });
  });

  const reply = await post(handleHudSummary, {
    body: JSON.stringify({ place: 'Huntsville' }),
    remoteAddress: '10.7.7.7',
  });

  assert.equal(reply.status, 200);
  assert.equal(
    JSON.parse(reply.body).summary,
    'Huntsville traffic cameras live',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://lmg.example.net/v1/responses');
  assert.equal(
    calls[0].init.headers.Authorization,
    'Bearer fixture-gateway-key',
  );
  assert.equal(JSON.parse(calls[0].init.body).model, 'gev-hud');
});

test('API-key voice mints from the gateway and tells the client to relay', async () => {
  const calls = [];
  const handler = createRealtimeTokenHandler({
    environment: { OPENAI_BASE_URL: 'https://lmg.example.net/v1' },
    resolveApiKey: () => 'fixture-gateway-key',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ value: 'gateway-secret', expires_at: 4e9 });
    },
  });
  const reply = await post(handler, {
    method: 'GET',
    url: '/?tier=standard',
    remoteAddress: '10.7.7.8',
  });
  assert.equal(reply.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://lmg.example.net/v1/realtime/client_secrets',
  );
  assert.equal(
    calls[0].init.headers.Authorization,
    'Bearer fixture-gateway-key',
  );
  assert.equal(reply.headers['x-gev-voice-gateway'], 'local');
  assert.equal(JSON.parse(reply.body).value, 'gateway-secret');
});

test('OpenAI voice keeps OpenAI and does not claim a gateway', async () => {
  const urls = [];
  const handler = createRealtimeTokenHandler({
    environment: {},
    resolveApiKey: () => 'fixture-openai-key',
    fetchImpl: async (url) => {
      urls.push(url);
      return Response.json({ value: 'openai-secret' });
    },
  });
  const reply = await post(handler, {
    method: 'GET',
    remoteAddress: '10.7.7.9',
  });
  assert.equal(reply.status, 200);
  assert.deepEqual(urls, ['https://api.openai.com/v1/realtime/client_secrets']);
  assert.equal(reply.headers['x-gev-voice-gateway'], undefined);
});

test('ChatGPT OAuth voice never sends its token to a configured gateway', async () => {
  const urls = [];
  const handler = createRealtimeTokenHandler({
    environment: { OPENAI_BASE_URL: 'https://lmg.example.net/v1' },
    resolveOAuthAccessToken: () => 'fixture-chatgpt-token',
    fetchImpl: async (url) => {
      urls.push(url);
      return Response.json({ value: 'openai-secret' });
    },
  });
  const reply = await post(handler, {
    method: 'GET',
    url: '/?auth=oauth',
    remoteAddress: '127.0.0.1',
  });
  assert.equal(reply.status, 200);
  assert.deepEqual(urls, ['https://api.openai.com/v1/realtime/client_secrets']);
  assert.equal(reply.headers['x-gev-voice-gateway'], undefined);
});

test('the SDP relay forwards the offer and secret to the gateway', async () => {
  const calls = [];
  const handler = createRealtimeCallsHandler({
    environment: { OPENAI_BASE_URL: 'https://lmg.example.net/v1/' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response('v=0\r\nanswer', {
        status: 201,
        headers: { location: 'https://lmg.example.net/v1/realtime/calls/x' },
      });
    },
  });
  const reply = await post(handler, {
    body: OFFER,
    remoteAddress: '10.7.7.10',
    headers: {
      'content-type': 'application/sdp',
      authorization: 'Bearer gateway-secret',
    },
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.body, 'v=0\r\nanswer');
  assert.equal(reply.headers['content-type'], 'application/sdp');
  assert.equal(reply.headers.location, undefined, 'gateway host stays hidden');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://lmg.example.net/v1/realtime/calls');
  assert.equal(calls[0].init.body, OFFER);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer gateway-secret');
  assert.equal(calls[0].init.redirect, 'error');
});

test('the SDP relay refuses without a gateway, a secret or an SDP body', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let upstream = 0;
  const fetchImpl = async () => {
    upstream += 1;
    return new Response('v=0');
  };
  const sdp = { 'content-type': 'application/sdp' };
  const bearer = { ...sdp, authorization: 'Bearer s' };

  const unconfigured = createRealtimeCallsHandler({
    environment: {},
    fetchImpl,
  });
  assert.equal(
    (
      await post(unconfigured, {
        body: OFFER,
        headers: bearer,
        remoteAddress: '10.7.7.11',
      })
    ).status,
    404,
    'OpenAI sessions negotiate with OpenAI directly, never through the relay',
  );

  const handler = createRealtimeCallsHandler({
    environment: { OPENAI_BASE_URL: 'https://lmg.example.net/v1' },
    fetchImpl,
  });
  assert.equal(
    (
      await post(handler, {
        method: 'GET',
        headers: bearer,
        remoteAddress: '10.7.7.11',
      })
    ).status,
    405,
  );
  assert.equal(
    (
      await post(handler, {
        body: OFFER,
        headers: sdp,
        remoteAddress: '10.7.7.11',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post(handler, {
        body: 'not sdp',
        headers: bearer,
        remoteAddress: '10.7.7.11',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(handler, {
        body: `v=0\r\n${'a'.repeat(70 * 1024)}`,
        headers: bearer,
        remoteAddress: '10.7.7.11',
      })
    ).status,
    413,
  );
  assert.equal(upstream, 0);
});

test('a gateway failure is reported without its wording', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const handler = createRealtimeCallsHandler({
    environment: { OPENAI_BASE_URL: 'https://lmg.example.net/v1' },
    fetchImpl: async () =>
      new Response('internal detail lmg.example.net', { status: 503 }),
  });
  const reply = await post(handler, {
    body: OFFER,
    remoteAddress: '10.7.7.12',
    headers: { 'content-type': 'application/sdp', authorization: 'Bearer s' },
  });
  assert.equal(reply.status, 502);
  assert.equal(reply.body.includes('lmg.example.net'), false);
});
