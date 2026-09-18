FROM node:24-slim
WORKDIR /app
# ws is a devDependency but IS required at runtime (server/providers/vessels/ais-live.js
# lazy-requires it for the AIS live feed) — plain `npm ci`, never --omit=dev.
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Cesium's build step is a known OOM risk on constrained runners.
ENV NODE_OPTIONS=--max-old-space-size=4096
# Vite's own host-check (build/vite.js) computes allowedHosts from HOST at config-load
# time — this is separate from the --host CLI flag below and MUST be set here, not left
# to the CLI flag alone, or every proxied request 403s ("Blocked request").
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG CESIUM_ION_TOKEN
ARG GOOGLE_MAPS_API_KEY
ENV CESIUM_ION_TOKEN=$CESIUM_ION_TOKEN \
    GOOGLE_MAPS_API_KEY=$GOOGLE_MAPS_API_KEY
RUN npm run build

EXPOSE 4173
# npx, not `npm run preview`: npm as PID 1 doesn't forward SIGTERM to the vite child,
# so `docker stop` would always hit the full grace period then SIGKILL mid-write to
# .gev-cache. npx execs vite directly as PID 1.
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "4173"]
