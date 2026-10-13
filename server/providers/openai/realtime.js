import { enforceRateLimit, openAiRateLimiter } from './rate-limit.js';
import {
  resolveVoiceModel,
  isKnownVoiceTier,
} from '../../../src/voice/voiceCost.js';
import {
  OPENAI_REALTIME_MODEL_MINI_DEFAULT,
  OPENAI_REALTIME_MODEL_DEFAULT,
  OPENAI_REALTIME_VOICE_DEFAULT,
  OPENAI_REALTIME_REASONING_DEFAULT,
  OPENAI_REALTIME_CONTEXT_TOKENS_DEFAULT,
  OPENAI_REALTIME_CONTEXT_RETENTION_DEFAULT,
  OPENAI_REALTIME_TRANSCRIBE_MODEL_DEFAULT,
} from './constants.js';
import { realtimeInstructions } from './instructions.js';
import { OPENAI_BASE_URL_DEFAULT, resolveOpenAiBaseUrl } from './base-url.js';
import { readRequestBody } from '../common/request.js';
import { GEV_REALTIME_TOOLS } from './tools.js';
import {
  preferCodexOAuth,
  readCodexOAuthAccessToken,
  createCodexOAuthLogin,
} from './codex-auth.js';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopbackRequest(req) {
  return LOOPBACK_ADDRESSES.has(String(req.socket?.remoteAddress || ''));
}

function isSameOriginRequest(req) {
  const origin = String(req.headers?.origin || '').trim();
  if (!origin) return true;
  const host = String(req.headers?.host || '').trim();
  if (!host) return false;
  const protocol = req.socket?.encrypted ? 'https:' : 'http:';
  try {
    return new URL(origin).origin === new URL(`${protocol}//${host}`).origin;
  } catch {
    return false;
  }
}

function requestQuery(req) {
  try {
    return new URL(req.url || '', 'http://localhost').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function resolveRealtimeAuthMode(query) {
  const requested = String(query.get('auth') || 'api-key').toLowerCase();
  if (requested === 'api-key' || requested === 'oauth') return requested;
  return null;
}

function createRealtimeOAuthStatusHandler({
  oauthLogin = createCodexOAuthLogin(),
} = {}) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    if (!isLoopbackRequest(req)) {
      res.statusCode = 403;
      res.end(
        JSON.stringify({
          available: false,
          error: 'ChatGPT OAuth is available only from this machine',
        }),
      );
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify(oauthLogin.status()));
  };
}

function createRealtimeOAuthLoginHandler({
  oauthLogin = createCodexOAuthLogin(),
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    if (!isLoopbackRequest(req)) {
      res.statusCode = 403;
      res.end(
        JSON.stringify({
          available: false,
          error: 'ChatGPT OAuth sign-in is available only from this machine',
        }),
      );
      return;
    }
    if (!isSameOriginRequest(req)) {
      res.statusCode = 403;
      res.end(
        JSON.stringify({
          available: false,
          error: 'Cross-origin ChatGPT OAuth sign-in is not allowed',
        }),
      );
      return;
    }

    try {
      const result = await oauthLogin.start();
      res.statusCode = result.available ? 200 : result.loginFailed ? 503 : 202;
      res.end(JSON.stringify(result));
    } catch {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          available: false,
          error: 'Could not start ChatGPT sign-in',
        }),
      );
    }
  };
}

/**
 * API-key voice follows OPENAI_BASE_URL, so a local OpenAI-compatible gateway
 * can serve Realtime too. ChatGPT OAuth always stays on OpenAI: that token is
 * the user's ChatGPT credential and must never be sent to another host.
 */
function realtimeGatewayBase(authMode, environment) {
  if (authMode === 'oauth') return OPENAI_BASE_URL_DEFAULT;
  return resolveOpenAiBaseUrl(environment.OPENAI_BASE_URL);
}

function createRealtimeTokenHandler({
  annotationGuidance,
  endpoint,
  fetchImpl = (...args) => fetch(...args),
  resolveApiKey = () => process.env.OPENAI_API_KEY,
  resolveOAuthAccessToken = () => readCodexOAuthAccessToken(),
  environment = process.env,
  models = {},
  tools = GEV_REALTIME_TOOLS,
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const query = requestQuery(req);
    const authMode = resolveRealtimeAuthMode(query);
    if (!authMode) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Unsupported cloud voice auth mode' }));
      return;
    }

    let oauthPinned;
    try {
      oauthPinned = preferCodexOAuth(environment);
    } catch (error) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: error.message }));
      return;
    }
    if (oauthPinned && authMode !== 'oauth') {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error:
            'ChatGPT OAuth is required by GEV_PREFER_CODEX_OAUTH. Select USE CHATGPT OAUTH in Provider Settings.',
          code: 'CODEX_OAUTH_REQUIRED',
        }),
      );
      return;
    }

    // Per-IP throttle (GEV_RATELIMIT_OPENAI_PER_MIN). On by default; 0 disables.
    if (!enforceRateLimit(openAiRateLimiter(), req, res)) return;

    let bearer;
    if (authMode === 'oauth') {
      if (!isLoopbackRequest(req)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'ChatGPT OAuth voice is available only from this machine',
          }),
        );
        return;
      }
      try {
        bearer = resolveOAuthAccessToken();
      } catch (error) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: error?.message || 'ChatGPT sign-in is unavailable',
            code: error?.code || 'CODEX_OAUTH_UNAVAILABLE',
          }),
        );
        return;
      }
      if (!bearer) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'ChatGPT sign-in is unavailable',
            code: 'CODEX_OAUTH_UNAVAILABLE',
          }),
        );
        return;
      }
    } else {
      bearer = resolveApiKey();
      if (!bearer) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY is not set' }));
        return;
      }
    }

    // Voice model tier, requested by the client as ?tier=standard|mini.
    // resolveVoiceModel is total: an unknown, empty, or hostile value
    // resolves to `standard` instead of reaching OpenAI as a model id, so a
    // bad querystring degrades to a normal session rather than a dead mic.
    // The env overrides stay authoritative per tier (see .env.example) —
    // a wrong upstream model id is then a config fix, not a code change.
    const requestedTier = query.get('tier');
    const tier = resolveVoiceModel(requestedTier).tier;
    const model =
      tier === 'mini'
        ? models.mini ||
          process.env.OPENAI_REALTIME_MODEL_MINI ||
          OPENAI_REALTIME_MODEL_MINI_DEFAULT
        : models.standard ||
          process.env.OPENAI_REALTIME_MODEL ||
          OPENAI_REALTIME_MODEL_DEFAULT;
    const voice =
      process.env.OPENAI_REALTIME_VOICE || OPENAI_REALTIME_VOICE_DEFAULT;
    const effort =
      process.env.OPENAI_REALTIME_REASONING_EFFORT ||
      OPENAI_REALTIME_REASONING_DEFAULT;
    const contextTokenLimit = Math.round(
      Math.max(
        1000,
        Math.min(
          12000,
          Number(process.env.OPENAI_REALTIME_CONTEXT_TOKENS) ||
            OPENAI_REALTIME_CONTEXT_TOKENS_DEFAULT,
        ),
      ),
    );
    const contextRetentionRatio = Math.max(
      0.1,
      Math.min(
        1,
        Number(process.env.OPENAI_REALTIME_CONTEXT_RETENTION) ||
          OPENAI_REALTIME_CONTEXT_RETENTION_DEFAULT,
      ),
    );
    // User captions for the voice card. Billed separately from the session.
    const transcribeModel =
      process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ||
      OPENAI_REALTIME_TRANSCRIBE_MODEL_DEFAULT;
    const transcription =
      transcribeModel.toLowerCase() === 'off'
        ? {}
        : { transcription: { model: transcribeModel } };
    const sessionConfig = {
      session: {
        type: 'realtime',
        model,
        reasoning: { effort },
        truncation: {
          type: 'retention_ratio',
          retention_ratio: contextRetentionRatio,
          token_limits: {
            post_instructions: contextTokenLimit,
          },
        },
        audio: {
          input: {
            noise_reduction: { type: 'near_field' },
            ...transcription,
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'low',
              create_response: true,
              interrupt_response: false,
            },
          },
          output: { voice },
        },
        instructions: realtimeInstructions(annotationGuidance),
        tools,
        tool_choice: 'auto',
      },
    };

    const base = realtimeGatewayBase(authMode, environment);
    const gateway = base !== OPENAI_BASE_URL_DEFAULT;
    try {
      const response = await fetchImpl(
        endpoint || `${base}/realtime/client_secrets`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
            'OpenAI-Safety-Identifier': 'gev-local-dev',
          },
          body: JSON.stringify(sessionConfig),
        },
      );
      const body = await response.text();
      res.statusCode = response.status;
      // Which tier/model this secret was actually minted for. The upstream
      // success body is passed through untouched (the client parses it
      // verbatim), so these headers are the authoritative echo — including the
      // case where a bogus ?tier= was silently downgraded to standard.
      res.setHeader('X-GEV-Voice-Tier', tier);
      res.setHeader('X-GEV-Voice-Model', model);
      res.setHeader(
        'X-GEV-Voice-Auth',
        authMode === 'oauth' ? 'codex-oauth' : 'env',
      );
      // Captions are billed separately; the client meters them with this id.
      res.setHeader(
        'X-GEV-Voice-Transcribe-Model',
        transcription.transcription ? transcribeModel : 'off',
      );
      if (requestedTier && !isKnownVoiceTier(requestedTier)) {
        res.setHeader('X-GEV-Voice-Tier-Fallback', '1');
      }
      // A configured gateway means the browser negotiates through
      // /api/realtime/calls and the session is not billed by OpenAI.
      if (gateway) res.setHeader('X-GEV-Voice-Gateway', 'local');
      if (!response.ok) {
        console.warn(`[realtime-token] upstream HTTP ${response.status}`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'Failed to create Realtime token' }));
        return;
      }
      res.setHeader(
        'Content-Type',
        response.headers.get('content-type') || 'application/json',
      );
      res.end(body);
    } catch {
      // For a network fault this was a resolver message naming the upstream
      // host; the client only needs to know the mint failed.
      console.warn('[realtime-token] mint failed');
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Failed to create Realtime token',
        }),
      );
    }
  };
}

const SDP_MAX_BYTES = 64 * 1024;

/**
 * Same-origin WebRTC signalling relay for a configured OPENAI_BASE_URL gateway.
 *
 * The browser POSTs its SDP offer here with the ephemeral secret minted by
 * /api/realtime/token; the server forwards both to `${base}/realtime/calls`
 * and returns the answer. The browser never needs to reach the gateway host
 * for signalling, and a secret a gateway issued is only ever presented back
 * to that gateway. Without a gateway this route refuses: OpenAI sessions
 * negotiate with OpenAI directly, as before.
 */
function createRealtimeCallsHandler({
  fetchImpl = (...args) => fetch(...args),
  environment = process.env,
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const fail = (status, error) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error }));
    };
    if (req.method !== 'POST') return fail(405, 'Method not allowed');
    const base = realtimeGatewayBase('api-key', environment);
    if (base === OPENAI_BASE_URL_DEFAULT)
      return fail(404, 'No Realtime gateway is configured');
    const authorization = String(req.headers?.authorization || '');
    if (!/^Bearer \S+$/.test(authorization))
      return fail(401, 'Missing Realtime client secret');
    if (!enforceRateLimit(openAiRateLimiter(), req, res)) return;

    let offer;
    try {
      offer = await readRequestBody(req, SDP_MAX_BYTES);
    } catch (error) {
      return fail(
        error?.code === 'BODY_TOO_LARGE' ? 413 : 400,
        'Invalid SDP offer',
      );
    }
    if (!offer.startsWith('v=0')) return fail(400, 'Invalid SDP offer');

    try {
      const response = await fetchImpl(`${base}/realtime/calls`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/sdp',
        },
        body: offer,
      });
      const answer = await response.text();
      if (!response.ok) {
        console.warn(`[realtime-calls] gateway HTTP ${response.status}`);
        return fail(
          response.status >= 500 ? 502 : response.status,
          'Realtime SDP negotiation failed',
        );
      }
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/sdp');
      res.end(answer);
    } catch {
      console.warn('[realtime-calls] relay failed');
      fail(502, 'Realtime SDP negotiation failed');
    }
  };
}

export {
  createRealtimeCallsHandler,
  createRealtimeOAuthLoginHandler,
  createRealtimeOAuthStatusHandler,
  createRealtimeTokenHandler,
};
