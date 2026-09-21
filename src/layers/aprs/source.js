import {
  normalizeDetailPayload,
  normalizeMessagesPayload,
  normalizeStationsPayload,
} from './model.js';

/**
 * Same-origin APRS endpoints. The server is always receiving and storing, so
 * these are cheap reads of its database; nothing here talks to APRS-IS.
 */
export function createAprsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function getJson(path, signal) {
    signal?.throwIfAborted();
    const response = await fetchImpl(`/api/aprs/${path}`, {
      signal,
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    signal?.throwIfAborted();
    if (!response.ok) {
      const error = new Error(payload?.error || `APRS HTTP ${response.status}`);
      // The feed status rides along even on failure, so the row can say why.
      error.feed = payload?.feed ?? null;
      throw error;
    }
    return payload;
  }
  return {
    /** @param {string} query From `stationsQuery`. */
    async getStations(query, { signal } = {}) {
      return normalizeStationsPayload(
        await getJson(`stations?${query}`, signal),
      );
    },
    /**
     * With no `after` the server only reports where "now" is (the cursor), so a
     * layer that has just been switched on is not handed a backlog to replay.
     */
    async getMessages({ after = null, query = '' } = {}, { signal } = {}) {
      const params = new URLSearchParams(query);
      if (after !== null) params.set('after', String(after));
      return normalizeMessagesPayload(
        await getJson(`messages?${params.toString()}`, signal),
      );
    },
    async getStation(id, { signal } = {}) {
      return normalizeDetailPayload(
        await getJson(`station?id=${encodeURIComponent(id)}`, signal),
      );
    },
  };
}
