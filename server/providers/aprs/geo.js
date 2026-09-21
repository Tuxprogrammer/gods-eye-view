const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_DEGREE = 111.195;
/** At or beyond this radius a query covers the whole planet. */
export const WHOLE_EARTH_KM = 20_000;

const rad = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * A latitude/longitude box that contains every point within `radiusKm` of the
 * centre, for a cheap SQL pre-filter (the exact test is `haversineKm`).
 * `lon` is null when the box would wrap the antimeridian or reach a pole, in
 * which case only latitude is constrained. `wrap` means `lon` is a pair to be
 * OR-ed rather than AND-ed.
 * @returns {{lat: [number, number], lon: [number, number]|null, wrap: boolean}}
 */
export function boundingBox(lat, lon, radiusKm) {
  const dLat = radiusKm / KM_PER_DEGREE;
  const south = Math.max(-90, lat - dLat);
  const north = Math.min(90, lat + dLat);
  if (north >= 89.9 || south <= -89.9)
    return { lat: [south, north], lon: null, wrap: false };
  const dLon =
    radiusKm /
    (KM_PER_DEGREE * Math.cos(rad(Math.max(Math.abs(south), Math.abs(north)))));
  if (dLon >= 180) return { lat: [south, north], lon: null, wrap: false };
  let west = lon - dLon;
  let east = lon + dLon;
  if (west < -180)
    return { lat: [south, north], lon: [west + 360, east], wrap: true };
  if (east > 180)
    return { lat: [south, north], lon: [west, east - 360], wrap: true };
  return { lat: [south, north], lon: [west, east], wrap: false };
}
