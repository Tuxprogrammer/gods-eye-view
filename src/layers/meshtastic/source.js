import {
  normalizeDetailPayload,
  normalizeMessagesPayload,
  normalizeNodesPayload,
  normalizeServers,
} from './model.js';

/**
 * Same-origin Meshtastic endpoints. The server holds the MQTT connections and
 * the 24-hour store; these are cheap reads of it, plus the calls that edit the
 * list of MQTT servers. Nothing here talks to a broker.
 */
export function createMeshtasticSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function request(path, { signal, method = 'GET', body } = {}) {
    signal?.throwIfAborted();
    const response = await fetchImpl(`/api/meshtastic/${path}`, {
      method,
      signal,
      cache: 'no-store',
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    const payload = await response.json().catch(() => null);
    signal?.throwIfAborted();
    if (!response.ok) {
      const error = new Error(
        payload?.error || `Meshtastic HTTP ${response.status}`,
      );
      error.servers = normalizeServers(payload?.servers);
      throw error;
    }
    return payload;
  }
  return {
    /** @param {string} query From `nodesQuery`. */
    async getNodes(query, { signal } = {}) {
      return normalizeNodesPayload(await request(`nodes?${query}`, { signal }));
    },
    /**
     * With no `after` the server only reports where "now" is (the cursor), so a
     * layer that has just been switched on is not handed a backlog to replay.
     */
    async getMessages({ after = null, query = '' } = {}, { signal } = {}) {
      const params = new URLSearchParams(query);
      if (after !== null) params.set('after', String(after));
      return normalizeMessagesPayload(
        await request(`messages?${params.toString()}`, { signal }),
      );
    },
    async getNode(id, { signal } = {}) {
      return normalizeDetailPayload(
        await request(`node?id=${encodeURIComponent(id)}`, { signal }),
      );
    },
    async getServers({ signal } = {}) {
      return normalizeServers((await request('servers', { signal })).servers);
    },
    /** Each of these resolves with the refreshed server list, or throws with the server's reason. */
    async addServer(fields) {
      const payload = await request('servers', {
        method: 'POST',
        body: fields,
      });
      return normalizeServers(payload.servers);
    },
    async updateServer(id, patch) {
      const payload = await request('servers/update', {
        method: 'POST',
        body: { ...patch, id },
      });
      return normalizeServers(payload.servers);
    },
    async removeServer(id) {
      const payload = await request('servers/delete', {
        method: 'POST',
        body: { id },
      });
      return normalizeServers(payload.servers);
    },
  };
}
