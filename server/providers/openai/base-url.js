const OPENAI_BASE_URL_DEFAULT = 'https://api.openai.com/v1';

let warnedValue = null;

/**
 * The OpenAI-compatible API root for text requests (the HUD summary), from
 * OPENAI_BASE_URL. Unset keeps OpenAI; a local gateway such as LiteLLM
 * (https://host/v1) serves the same Responses API without the cloud. A value
 * that is not an http(s) URL falls back to OpenAI rather than sending the key
 * somewhere unintended, and is reported once.
 */
function resolveOpenAiBaseUrl(value = process.env.OPENAI_BASE_URL) {
  const raw = String(value ?? '').trim();
  if (!raw) return OPENAI_BASE_URL_DEFAULT;
  let url;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  if (
    !url ||
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    if (warnedValue !== raw) {
      warnedValue = raw;
      console.warn(
        '[openai] OPENAI_BASE_URL is not a plain http(s) URL; using OpenAI',
      );
    }
    return OPENAI_BASE_URL_DEFAULT;
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

export { OPENAI_BASE_URL_DEFAULT, resolveOpenAiBaseUrl };
