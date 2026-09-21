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

# The APRS layer keeps 24 h of packets in /app/.gev-cache/aprs (node:sqlite, built in
# to Node 24), inside the same /app/.gev-cache the other providers use: mount that one
# directory to keep history across restarts. Set APRS_CALLSIGN at run time; the
# container needs outbound TCP to noam.aprs2.net:10152.
# The Meshtastic layer keeps its 24 h cache and its list of MQTT servers in
# /app/.gev-cache/meshtastic (same mount). Nothing connects until a server is switched
# on in the layer panel; the container then needs outbound TCP to that broker (the
# public one and ALmesh use port 1883).
EXPOSE 4173
# npx, not `npm run preview`: npm as PID 1 doesn't forward SIGTERM to the vite child,
# so `docker stop` would always hit the full grace period then SIGKILL mid-write to
# .gev-cache. npx execs vite directly as PID 1.
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "4173"]
