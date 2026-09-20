import { createPropagationMiddleware } from './propagation/middleware.js';

export { createPropagationMiddleware };
export { extractPropagationMap } from './propagation/extract.js';

/**
 * HF propagation maps (MUF 3000 km, foF2) from prop.kc2g.com, fetched only on
 * demand and cached. Routes: GET /api/propagation/{muf|fof2}.
 *
 * @returns {import('vite').Plugin}
 */
export function propagationProxy() {
  const middleware = createPropagationMiddleware();
  const install = (server) => {
    server.middlewares.use('/api/propagation', middleware);
  };
  return {
    name: 'propagation-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
