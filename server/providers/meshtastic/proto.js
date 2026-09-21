/**
 * A tiny protobuf wire-format reader, just enough for Meshtastic packets.
 *
 * Meshtastic's schema is not bundled or generated: the handful of fields this
 * layer shows are read by number (see `decode.js`), and everything else is
 * skipped. Unknown fields are therefore harmless, and a newer firmware that
 * adds fields cannot break the decoder.
 */

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LEN = 2;
const WIRE_FIXED32 = 5;

/**
 * Read every field of one message into `Map<fieldNumber, value[]>`.
 * Varints are numbers (or BigInt above 2^53), fixed32 is a raw uint32,
 * length-delimited fields are `Buffer` slices. Returns null when the bytes are
 * not a well-formed message, which is how a wrongly decrypted payload shows.
 * @param {Buffer} buffer
 * @returns {Map<number, Array<number|bigint|Buffer>>|null}
 */
export function readMessage(buffer) {
  const fields = new Map();
  let at = 0;
  const varint = () => {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i += 1) {
      if (at >= buffer.length) return null;
      const byte = buffer[at++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80))
        return result <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(result)
          : result;
      shift += 7n;
    }
    return null;
  };
  while (at < buffer.length) {
    const tag = varint();
    if (typeof tag !== 'number' || tag < 8) return null;
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    let value;
    if (wire === WIRE_VARINT) {
      value = varint();
      if (value === null) return null;
    } else if (wire === WIRE_FIXED32) {
      if (at + 4 > buffer.length) return null;
      value = buffer.readUInt32LE(at);
      at += 4;
    } else if (wire === WIRE_FIXED64) {
      if (at + 8 > buffer.length) return null;
      value = buffer.readBigUInt64LE(at);
      at += 8;
    } else if (wire === WIRE_LEN) {
      const length = varint();
      if (typeof length !== 'number' || at + length > buffer.length)
        return null;
      value = buffer.subarray(at, at + length);
      at += length;
    } else {
      return null;
    }
    const list = fields.get(field);
    if (list) list.push(value);
    else fields.set(field, [value]);
  }
  return fields;
}

/** The last value written for a field (protobuf: later wins), or `undefined`. */
export const last = (fields, number) => {
  const list = fields?.get(number);
  return list?.[list.length - 1];
};

/** A number-valued field, or `fallback` when absent or not a plain number. */
export const num = (fields, number, fallback = undefined) => {
  const value = last(fields, number);
  return typeof value === 'number' ? value : fallback;
};

/** A UTF-8 string field. Control characters are replaced with spaces. */
export const str = (fields, number) => {
  const value = last(fields, number);
  if (!Buffer.isBuffer(value)) return undefined;
  // eslint-disable-next-line no-control-regex
  return value
    .toString('utf8')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
};

/** A bytes field as a Buffer. */
export const bytes = (fields, number) => {
  const value = last(fields, number);
  return Buffer.isBuffer(value) ? value : undefined;
};

/** A nested message field, parsed, or null. */
export const message = (fields, number) => {
  const value = bytes(fields, number);
  return value ? readMessage(value) : null;
};

/** A fixed32 field reinterpreted as a signed int32 (`sfixed32`). */
export const sfixed32 = (fields, number) => {
  const value = num(fields, number);
  return value === undefined ? undefined : value | 0;
};

/** A fixed32 field reinterpreted as an IEEE float. */
export const float32 = (fields, number) => {
  const value = num(fields, number);
  if (value === undefined) return undefined;
  const scratch = Buffer.alloc(4);
  scratch.writeUInt32LE(value);
  const out = scratch.readFloatLE(0);
  return Number.isFinite(out) ? out : undefined;
};

/** A varint reinterpreted as a signed int32 (`int32`). */
export const int32 = (fields, number) => {
  // A negative int32 is a 10-byte varint, which arrives as a BigInt.
  const value = last(fields, number);
  if (typeof value === 'bigint') return Number(BigInt.asIntN(32, value));
  return typeof value === 'number' ? value | 0 : undefined;
};

/** A zig-zag encoded varint (`sint32`). */
export const sint32 = (fields, number) => {
  const value = num(fields, number);
  return value === undefined ? undefined : (value >>> 1) ^ -(value & 1);
};
