// A small PDF text-run reader for the police reports this layer reads.
//
// It understands only what those documents use: classic cross-referenced
// objects (no object or xref streams), FlateDecode or raw content streams,
// and Type0 or simple fonts with an optional ToUnicode CMap. It does not
// measure glyph widths: each run is placed where its text-showing operator
// starts, which is enough for tables whose cells each start their own run.
// Anything it cannot read throws, so the caller keeps its last good answer.
import { inflateSync } from 'node:zlib';

const OBJECT_HEADER = /(\d+)\s+(\d+)\s+obj\b/g;
const MAX_OBJECTS = 20_000;
const MAX_INFLATED_BYTES = 32 * 1024 * 1024;
// A TJ adjustment (thousandths of an em) this wide is a jump between cells.
const COLUMN_GAP = 500;

/** Index every object: its dictionary text and its (decoded) stream bytes. */
function readObjects(buffer) {
  const text = buffer.toString('latin1');
  const objects = new Map();
  OBJECT_HEADER.lastIndex = 0;
  let match;
  while ((match = OBJECT_HEADER.exec(text))) {
    if (objects.size >= MAX_OBJECTS) throw new Error('pdf_too_many_objects');
    const bodyStart = match.index + match[0].length;
    const streamAt = text.indexOf('stream', bodyStart);
    const endAt = text.indexOf('endobj', bodyStart);
    if (endAt < 0) break;
    if (streamAt < 0 || streamAt > endAt) {
      objects.set(Number(match[1]), {
        dict: text.slice(bodyStart, endAt),
        raw: null,
      });
      OBJECT_HEADER.lastIndex = endAt + 6;
      continue;
    }
    const dict = text.slice(bodyStart, streamAt);
    let dataStart = streamAt + 6;
    if (text[dataStart] === '\r') dataStart++;
    if (text[dataStart] === '\n') dataStart++;
    const direct = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let dataEnd = direct ? dataStart + Number(direct[1]) : -1;
    if (
      dataEnd < 0 ||
      text.slice(dataEnd, dataEnd + 12).indexOf('endstream') < 0
    )
      dataEnd = text.indexOf('endstream', dataStart);
    if (dataEnd < 0) throw new Error('pdf_unterminated_stream');
    objects.set(Number(match[1]), {
      dict,
      raw: buffer.subarray(dataStart, dataEnd),
    });
    const after = text.indexOf('endobj', dataEnd);
    OBJECT_HEADER.lastIndex = after < 0 ? dataEnd : after + 6;
  }
  return objects;
}

function streamBytes(object) {
  if (!object?.raw) return null;
  // windowBits 15 decodes every zlib window size. Leaving it unset makes
  // some Node builds reject valid streams written with a smaller window
  // ("invalid distance too far back"), which these reports use.
  if (/\/Filter\s*\/FlateDecode/.test(object.dict))
    return inflateSync(object.raw, {
      windowBits: 15,
      maxOutputLength: MAX_INFLATED_BYTES,
    });
  if (/\/Filter/.test(object.dict)) return null;
  return object.raw;
}

const ref = (dict, key) => {
  const found = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict);
  return found ? Number(found[1]) : null;
};

const refList = (dict, key) => {
  const found = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dict);
  if (!found) return null;
  return [...found[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
};

/** Text of a balanced << ... >> dictionary that starts at `from`. */
function balancedDict(text, from) {
  let depth = 0;
  for (let index = from; index < text.length - 1; index++) {
    const pair = text.slice(index, index + 2);
    if (pair === '<<') {
      depth++;
      index++;
    } else if (pair === '>>') {
      depth--;
      index++;
      if (depth === 0) return text.slice(from, index + 1);
    }
  }
  return '';
}

/** Page objects in document order, from the catalog's page tree. */
function pageObjects(objects) {
  const catalog = [...objects.values()].find((object) =>
    /\/Type\s*\/Catalog\b/.test(object.dict),
  );
  const root = catalog ? ref(catalog.dict, 'Pages') : null;
  const pages = [];
  const seen = new Set();
  const walk = (number) => {
    if (seen.has(number)) return;
    seen.add(number);
    const node = objects.get(number);
    if (!node) return;
    if (/\/Type\s*\/Pages\b/.test(node.dict))
      for (const kid of refList(node.dict, 'Kids') || []) walk(kid);
    else if (/\/Type\s*\/Page\b/.test(node.dict)) pages.push(node);
  };
  if (root !== null) walk(root);
  return pages;
}

/** Parse a ToUnicode CMap into {bytes, map: code → string}. */
export function parseToUnicode(cmap) {
  const map = new Map();
  const hexText = (hex) => {
    let out = '';
    for (let i = 0; i + 4 <= hex.length; i += 4)
      out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    if (hex.length % 4 === 2)
      out += String.fromCharCode(parseInt(hex.slice(-2), 16));
    return out;
  };
  let bytes = 1;
  const space = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(cmap);
  if (space) bytes = Math.max(1, space[1].length / 2);
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const [, src, dst] of block[1].matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g,
    ))
      map.set(parseInt(src, 16), hexText(dst));
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1];
    const entry =
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g;
    for (const [, lo, hi, dst, list] of body.matchAll(entry)) {
      const low = parseInt(lo, 16);
      const high = Math.min(parseInt(hi, 16), low + 0xffff);
      if (list !== undefined) {
        const targets = [...list.matchAll(/<([0-9a-fA-F]*)>/g)].map((m) =>
          hexText(m[1]),
        );
        for (let code = low; code <= high; code++)
          if (targets[code - low] !== undefined)
            map.set(code, targets[code - low]);
      } else {
        const base = hexText(dst);
        const last = base.charCodeAt(base.length - 1);
        for (let code = low; code <= high; code++)
          map.set(
            code,
            base.slice(0, -1) + String.fromCharCode(last + (code - low)),
          );
      }
    }
  }
  return { bytes, map };
}

/** A page's font resource names → decoders. */
function pageFonts(objects, page) {
  let resources = page.dict;
  const resourcesRef = ref(page.dict, 'Resources');
  if (resourcesRef !== null) resources = objects.get(resourcesRef)?.dict || '';
  else {
    const at = page.dict.indexOf('/Resources');
    if (at >= 0)
      resources = balancedDict(page.dict, page.dict.indexOf('<<', at));
  }
  let fontDict = '';
  const fontRef = ref(resources, 'Font');
  if (fontRef !== null) fontDict = objects.get(fontRef)?.dict || '';
  else {
    const at = resources.indexOf('/Font');
    if (at >= 0)
      fontDict = balancedDict(resources, resources.indexOf('<<', at));
  }
  const fonts = new Map();
  for (const [, name, number] of fontDict.matchAll(
    /\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g,
  )) {
    const font = objects.get(Number(number));
    if (!font) continue;
    const unicodeRef = ref(font.dict, 'ToUnicode');
    const cmapBytes =
      unicodeRef === null ? null : streamBytes(objects.get(unicodeRef));
    const composite = /\/Subtype\s*\/Type0\b/.test(font.dict);
    const parsed = cmapBytes
      ? parseToUnicode(cmapBytes.toString('latin1'))
      : null;
    fonts.set(name, {
      bytes: parsed?.bytes ?? (composite ? 2 : 1),
      map: parsed?.map ?? null,
    });
  }
  return fonts;
}

function decodeString(bytes, font) {
  const width = font?.bytes || 1;
  let out = '';
  for (let i = 0; i + width <= bytes.length; i += width) {
    let code = 0;
    for (let j = 0; j < width; j++) code = code * 256 + bytes[i + j];
    const mapped = font?.map?.get(code);
    out += mapped !== undefined ? mapped : String.fromCharCode(code);
  }
  return out;
}

/** Tokenize a content stream into operands and operators. */
function* tokens(content) {
  const text = content.toString('latin1');
  const length = text.length;
  let i = 0;
  const isSpace = (c) =>
    c === ' ' ||
    c === '\n' ||
    c === '\r' ||
    c === '\t' ||
    c === '\f' ||
    c === '\0';
  const isDelim = (c) => '()<>[]{}/%'.includes(c);
  while (i < length) {
    const c = text[i];
    if (isSpace(c)) {
      i++;
    } else if (c === '%') {
      while (i < length && text[i] !== '\n' && text[i] !== '\r') i++;
    } else if (c === '(') {
      let depth = 1;
      const bytes = [];
      i++;
      while (i < length && depth > 0) {
        const ch = text[i];
        if (ch === '\\') {
          const next = text[i + 1];
          const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12 };
          if (next in escapes) {
            bytes.push(escapes[next]);
            i += 2;
          } else if (/[0-7]/.test(next)) {
            const octal = /^[0-7]{1,3}/.exec(text.slice(i + 1, i + 4))[0];
            bytes.push(parseInt(octal, 8) & 0xff);
            i += 1 + octal.length;
          } else if (next === '\r' || next === '\n') {
            i += next === '\r' && text[i + 2] === '\n' ? 3 : 2;
          } else {
            bytes.push(next.charCodeAt(0));
            i += 2;
          }
          continue;
        }
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (depth > 0) bytes.push(ch.charCodeAt(0));
        i++;
      }
      yield { type: 'string', value: Uint8Array.from(bytes) };
    } else if (c === '<' && text[i + 1] === '<') {
      yield { type: 'dictOpen' };
      i += 2;
    } else if (c === '>' && text[i + 1] === '>') {
      yield { type: 'dictClose' };
      i += 2;
    } else if (c === '<') {
      const end = text.indexOf('>', i);
      if (end < 0) return;
      let hex = text.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
      if (hex.length % 2) hex += '0';
      yield { type: 'string', value: Uint8Array.from(Buffer.from(hex, 'hex')) };
      i = end + 1;
    } else if (c === '[') {
      yield { type: 'arrayOpen' };
      i++;
    } else if (c === ']') {
      yield { type: 'arrayClose' };
      i++;
    } else if (c === '/') {
      let j = i + 1;
      while (j < length && !isSpace(text[j]) && !isDelim(text[j])) j++;
      yield { type: 'name', value: text.slice(i + 1, j) };
      i = j;
    } else {
      let j = i;
      while (j < length && !isSpace(text[j]) && !isDelim(text[j])) j++;
      if (j === i) {
        i++;
        continue;
      }
      const word = text.slice(i, j);
      i = j;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word))
        yield { type: 'number', value: Number(word) };
      else if (word === 'ID') {
        // Inline image data runs to the next whitespace-delimited EI.
        const end = text.indexOf('EI', i);
        i = end < 0 ? length : end + 2;
      } else yield { type: 'op', value: word };
    }
  }
}

const multiply = (a, b) => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/**
 * Text runs of one content stream: {x, y, size, text} in page space (PDF
 * points, y up). A TJ adjustment wider than about a third of an em becomes a
 * space, and one wider than half an em becomes a tab, so a run that spans
 * several table columns keeps its cells apart.
 */
function contentRuns(content, fonts) {
  const runs = [];
  const stack = [];
  let ctm = [...IDENTITY];
  let tm = [...IDENTITY];
  let tlm = [...IDENTITY];
  let font = null;
  let fontSize = 0;
  let leading = 0;
  let operands = [];
  let array = null;
  const emit = (text) => {
    const clean = text
      .split('\t')
      .map((cell) => cell.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\t');
    if (!clean) return;
    const m = multiply(tm, ctm);
    runs.push({
      x: m[4],
      y: m[5],
      size: Math.abs(fontSize * Math.hypot(m[2], m[3])),
      text: clean,
    });
  };
  const nextLine = (tx, ty) => {
    tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
    tm = [...tlm];
  };
  for (const token of tokens(content)) {
    if (token.type === 'arrayOpen') {
      array = [];
      continue;
    }
    if (token.type === 'arrayClose') {
      operands.push(array || []);
      array = null;
      continue;
    }
    if (token.type !== 'op') {
      if (array) array.push(token);
      else operands.push(token);
      continue;
    }
    const nums = operands.map((o) => (o?.type === 'number' ? o.value : NaN));
    switch (token.value) {
      case 'q':
        stack.push(ctm);
        break;
      case 'Q':
        ctm = stack.pop() || [...IDENTITY];
        break;
      case 'cm':
        if (nums.length >= 6) ctm = multiply(nums.slice(-6), ctm);
        break;
      case 'BT':
        tm = [...IDENTITY];
        tlm = [...IDENTITY];
        break;
      case 'Tf': {
        const name = operands.find((o) => o?.type === 'name');
        font = name ? fonts.get(name.value) || null : null;
        fontSize = nums[nums.length - 1] || 0;
        break;
      }
      case 'TL':
        leading = nums[0] || 0;
        break;
      case 'Tm':
        if (nums.length >= 6) {
          tlm = nums.slice(-6);
          tm = [...tlm];
        }
        break;
      case 'Td':
        nextLine(nums[0] || 0, nums[1] || 0);
        break;
      case 'TD':
        leading = -(nums[1] || 0);
        nextLine(nums[0] || 0, nums[1] || 0);
        break;
      case 'T*':
        nextLine(0, -leading);
        break;
      case 'Tj':
      case "'":
      case '"': {
        if (token.value !== 'Tj') nextLine(0, -leading);
        const string = operands.findLast((o) => o?.type === 'string');
        if (string) emit(decodeString(string.value, font));
        break;
      }
      case 'TJ': {
        const parts = operands.findLast(Array.isArray) || [];
        let text = '';
        for (const part of parts) {
          if (part.type === 'string') text += decodeString(part.value, font);
          else if (part.type === 'number' && part.value <= -COLUMN_GAP)
            text += '\t';
          else if (part.type === 'number' && part.value < -330) text += ' ';
        }
        emit(text);
        break;
      }
      default:
        break;
    }
    operands = [];
  }
  return runs;
}

/**
 * Every text run in a PDF, page by page.
 * @param {Uint8Array} bytes - The whole PDF file.
 * @returns {Array<Array<{x: number, y: number, size: number, text: string}>>}
 */
export function extractPdfTextRuns(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-')
    throw new Error('pdf_not_a_pdf');
  const objects = readObjects(buffer);
  const pages = pageObjects(objects);
  if (!pages.length) throw new Error('pdf_no_pages');
  return pages.map((page) => {
    const fonts = pageFonts(objects, page);
    const contents = refList(page.dict, 'Contents') ?? [
      ref(page.dict, 'Contents'),
    ];
    const runs = [];
    for (const number of contents) {
      if (number === null) continue;
      const bytesOf = streamBytes(objects.get(number));
      if (bytesOf) runs.push(...contentRuns(bytesOf, fonts));
    }
    return runs;
  });
}
