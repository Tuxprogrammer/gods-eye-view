import {
  normalizeContoursPayload,
  normalizePropagationPayload,
  normalizeStationsPayload,
  propagationField,
} from './model.js';

/**
 * Construct the same-origin propagation endpoints without making a request.
 * The server caches and revalidates upstream; the browser revalidates ours with
 * its ETag, so an unchanged document is a tiny 304 rather than a re-download.
 */
export function createPropagationSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function getJson(path, signal) {
    signal?.throwIfAborted();
    const response = await fetchImpl(`/api/propagation/${path}`, {
      signal,
      cache: 'no-cache',
    });
    if (!response.ok) throw new Error(`Propagation HTTP ${response.status}`);
    const payload = await response.json();
    signal?.throwIfAborted();
    return payload;
  }
  const knownField = (fieldId) => {
    if (!propagationField(fieldId))
      throw new Error(`Unknown propagation map: ${fieldId}`);
  };
  return {
    async getMap(fieldId, { signal } = {}) {
      knownField(fieldId);
      return normalizePropagationPayload(
        await getJson(fieldId, signal),
        fieldId,
      );
    },
    async getContours(fieldId, { signal } = {}) {
      knownField(fieldId);
      return normalizeContoursPayload(
        await getJson(`${fieldId}/contours`, signal),
        fieldId,
      );
    },
    async getStations({ signal } = {}) {
      return normalizeStationsPayload(await getJson('stations', signal));
    },
  };
}
