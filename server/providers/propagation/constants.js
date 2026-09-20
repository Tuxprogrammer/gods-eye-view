/** Upstream: prop.kc2g.com's rendered "now" maps. Credit GIRO ionosonde data. */
export const PROPAGATION_ORIGIN = 'https://prop.kc2g.com';

/** Public field id -> upstream render name. The route accepts only these keys. */
export const PROPAGATION_FIELDS = Object.freeze({
  muf: Object.freeze({
    id: 'muf',
    render: 'mufd',
    label: 'MUF (3000 km)',
    unit: 'MHz',
  }),
  fof2: Object.freeze({
    id: 'fof2',
    render: 'fof2',
    label: 'foF2',
    unit: 'MHz',
  }),
});

export function propagationUpstreamUrl(field) {
  return `${PROPAGATION_ORIGIN}/renders/current/${field.render}-normal-now.svg`;
}

/** The upstream regenerates every 15 minutes; never revalidate more often than this. */
export const PROPAGATION_MIN_RECHECK_MS = 2 * 60_000;
/** Upstream map cadence: a cached map is never presumed fresh for longer. */
export const PROPAGATION_MAX_FRESH_MS = 15 * 60_000;
/** Recheck delay when the upstream has not produced a newer map than the one held. */
export const PROPAGATION_UNCHANGED_RECHECK_MS = 3 * 60_000;
/** After a failed upstream attempt, wait before trying again. */
export const PROPAGATION_FAILURE_BACKOFF_MS = 60_000;
/** A held map older than this is refused rather than served as if it were current. */
export const PROPAGATION_MAX_STALE_MS = 6 * 60 * 60_000;
export const PROPAGATION_FETCH_TIMEOUT_MS = 20_000;
/** The observed SVG is ~370 KB; anything far beyond that is not the map we expect. */
export const PROPAGATION_SVG_MAX_BYTES = 3 * 1024 * 1024;
export const PROPAGATION_USER_AGENT =
  "God's Eye View propagation layer (demand-driven, cached; +https://github.com/bilawalsidhu/gods-eye-view)";

export function propagationContoursUrl(field) {
  return `${PROPAGATION_ORIGIN}/renders/current/${field.render}-normal-now.geojson`;
}
export const PROPAGATION_STATIONS_URL = `${PROPAGATION_ORIGIN}/api/stations.json`;

/** Contours are rendered together with the map, so they share its cadence. */
export const PROPAGATION_CONTOURS_MAX_BYTES = 1024 * 1024;
export const PROPAGATION_STATIONS_MAX_BYTES = 1024 * 1024;
/** The stations file sends no cache headers; ionosondes report every ~15 minutes. */
export const PROPAGATION_STATIONS_FRESH_MS = 10 * 60_000;
/** A station whose last reading is older than this is not "reporting". */
export const PROPAGATION_STATION_MAX_AGE_MS = 3 * 60 * 60_000;
export const PROPAGATION_CONTOURS_MAX_FEATURES = 200;
export const PROPAGATION_CONTOURS_MAX_VERTICES = 60_000;
export const PROPAGATION_STATIONS_MAX = 400;
