/**
 * The APRS-IS login passcode for a callsign.
 *
 * It is a fixed 15-bit hash of the callsign without its SSID, not a secret:
 * it only tells the server the operator asked for a verified login.
 *
 * @param {string} callsign e.g. `KQ4VYY` or `KQ4VYY-9` (the SSID is ignored).
 * @returns {number}
 */
export function aprsPasscode(callsign) {
  const base = String(callsign ?? '')
    .split('-')[0]
    .toUpperCase();
  let hash = 0x73e2;
  for (let i = 0; i < base.length; i += 2) {
    hash ^= base.charCodeAt(i) << 8;
    if (i + 1 < base.length) hash ^= base.charCodeAt(i + 1);
  }
  return hash & 0x7fff;
}

/** A plausible amateur callsign with an optional numeric SSID. */
export function isValidCallsign(value) {
  return /^[A-Z0-9]{3,6}(-\d{1,2})?$/i.test(String(value ?? '').trim());
}
