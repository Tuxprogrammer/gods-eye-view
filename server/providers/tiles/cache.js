import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Permanent on-disk store for upstream map tiles. A tile that has been fetched
 * once is served from disk forever; the upstream is asked again only for keys
 * it has never answered. Tiles are immutable to us, so there is no expiry and
 * no size limit.
 *
 * Layout: <root>/<provider>/<key>. A tile the upstream says does not exist
 * (empty ocean in a vector set, say) is remembered as <key>.none so it is not
 * asked for again either.
 */
export function createTileCache({ root, fetchImpl = fetch, warn = () => {} }) {
  const inflight = new Map();

  const fileFor = (provider, key) => {
    const file = path.resolve(root, provider, key);
    // Keys are built from validated segments; this is the backstop.
    if (!file.startsWith(path.resolve(root) + path.sep))
      throw new Error('Tile key escapes the cache root');
    return file;
  };

  async function readCached(file) {
    try {
      return { status: 200, body: await readFile(file) };
    } catch {
      /* not cached */
    }
    try {
      await readFile(`${file}.none`);
      return { status: 404, body: null };
    } catch {
      return null;
    }
  }

  async function store(file, body) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, file);
  }

  async function pull({ file, upstream, headers, contentType }) {
    const response = await fetchImpl(upstream, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 404 || response.status === 204) {
      await store(`${file}.none`, '').catch(() => {});
      return { status: 404, body: null };
    }
    if (!response.ok) return { status: 502, body: null, transient: true };
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length) return { status: 502, body: null, transient: true };
    await store(file, body).catch((error) =>
      warn(`[tiles] could not cache ${file}: ${error?.message || error}`),
    );
    return {
      status: 200,
      body,
      contentType: response.headers.get('content-type') || contentType,
    };
  }

  /**
   * @returns {Promise<{status: number, body: Buffer|null, transient?: boolean, contentType?: string}>}
   */
  async function get({ provider, key, upstream, headers = {}, contentType }) {
    const file = fileFor(provider, key);
    const cached = await readCached(file);
    if (cached) return { ...cached, contentType, cached: true };
    // Concurrent requests for one missing tile share a single upstream call.
    let shared = inflight.get(file);
    if (!shared) {
      shared = pull({ file, upstream, headers, contentType })
        .catch((error) => ({
          status: 502,
          body: null,
          transient: true,
          error: error?.message || String(error),
        }))
        .finally(() => inflight.delete(file));
      inflight.set(file, shared);
    }
    return shared;
  }

  /** Remove a cached entry; used by tests and manual repair. */
  const forget = (provider, key) => {
    const file = fileFor(provider, key);
    return Promise.all([
      rm(file, { force: true }),
      rm(`${file}.none`, { force: true }),
    ]);
  };

  return { get, forget };
}
