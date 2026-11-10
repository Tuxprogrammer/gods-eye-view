import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { normalizeCrimePayload } from './model.js';

// A portable export: no i18n here. Failures stay English data; the Layers
// panel shows them translated.
const msg = (text) => text;

/** Same-origin reads of the server's Madison PD incident snapshot. */
export function createCrimeSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    /**
     * Mapped incidents for the last `days` of reports.
     * @param {{days?: number, signal?: AbortSignal}} [options]
     */
    async getIncidents({ days = 30, signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(
        `/api/crime?days=${encodeURIComponent(days)}`,
        { signal, cache: 'no-store' },
      );
      if (!response.ok)
        throw new Error(
          response.status === 502
            ? msg('Crime reports unavailable')
            : `Crime HTTP ${response.status}`,
        );
      const payload = await readResponseJsonCapped(
        response,
        16 * 1024 * 1024,
        signal,
      );
      signal?.throwIfAborted();
      return normalizeCrimePayload(payload);
    },
  };
}
