import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import {
  extractPdfTextRuns,
  parseToUnicode,
} from '../../../server/providers/crime/pdfText.js';
import {
  centralTimeToEpoch,
  parseArchiveList,
  parseIncidentRows,
} from '../../../server/providers/crime/madisonReport.js';
import {
  GEOCODE_URL,
  createCrimeGeocoder,
  locationQuery,
} from '../../../server/providers/crime/geocode.js';
import {
  MADISON_ARCHIVE_URL,
  crimeCasesFromRows,
  crimeProxy,
} from '../../../server/providers/crime.js';
import {
  classifyOffense,
  isSensitiveOffense,
  mostSevereCategory,
} from './categories.js';

const NOW = Date.UTC(2026, 10, 9, 18);

const escape = (text) => text.replace(/[\\()]/g, (c) => `\\${c}`);
const tj = (x, y, text) =>
  `BT /F1 8 Tf 1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj ET`;

/** One table row: separate runs per cell, as most of the reports draw it. */
function row(y, { date, time, caseNumber, incident, location, timeBelow }) {
  return [
    tj(30, y, timeBelow ? date : `${date} ${time}`),
    timeBelow ? tj(30, y - 8, time) : '',
    tj(100, y, caseNumber),
    ...[].concat(incident).map((line, i) => tj(200, y - i * 8, line)),
    tj(400, y, location),
  ].join('\n');
}

/**
 * A minimal report PDF. Content streams use a small zlib window and an
 * indirect /Length, like the city's own files.
 */
function reportPdf(pages) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(null);
  const pagesId = add(null);
  const font = add(
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  );
  const kids = [];
  for (const content of pages) {
    const data = deflateSync(Buffer.from(content, 'latin1'), {
      windowBits: 11,
    });
    const length = add(Buffer.from(String(data.length)));
    const stream = add(
      Buffer.concat([
        Buffer.from(
          `<< /Length ${length} 0 R /Filter /FlateDecode >>\nstream\n`,
        ),
        data,
        Buffer.from('\nendstream'),
      ]),
    );
    kids.push(
      add(
        Buffer.from(
          `<< /Type /Page /Parent ${pagesId} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`,
        ),
      ),
    );
  }
  objects[catalog - 1] = Buffer.from(
    `<< /Type /Catalog /Pages ${pagesId} 0 R >>`,
  );
  objects[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`,
  );
  const parts = [Buffer.from('%PDF-1.7\n')];
  objects.forEach((body, index) =>
    parts.push(
      Buffer.from(`${index + 1} 0 obj\n`),
      body,
      Buffer.from('\nendobj\n'),
    ),
  );
  parts.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n'));
  return new Uint8Array(Buffer.concat(parts));
}

const HEADER = [
  tj(30, 750, 'Date/Time'),
  tj(100, 750, 'Case No.'),
  tj(200, 750, 'Incident'),
  tj(400, 750, 'Location'),
].join('\n');

function samplePdf() {
  const first = [
    HEADER,
    row(700, {
      date: '11/2/2026',
      time: '8:15 PM',
      caseNumber: '26M000101',
      incident: 'THEFT OF PROPERTY 4TH',
      location: '100 BLOCK OF HUGHES RD',
    }),
    row(680, {
      date: '11/3/2026',
      time: '11:05 PM',
      timeBelow: true,
      caseNumber: '26M000102',
      incident: ['DOMESTIC VIOLENCE 3RD -', 'HARASSMENT'],
      location: '200 BLOCK OF MILL RD MAD',
    }),
    row(650, {
      date: '11/4/2026',
      time: '1:00 AM',
      caseNumber: '26M000102',
      incident: 'CRIMINAL MISCHIEF 3RD',
      location: '200 BLOCK OF MILL RD MAD',
    }),
    // One run that spans three cells, split by wide TJ gaps.
    tj(30, 630, '11/4/2026 2:00 PM'),
    'BT /F1 8 Tf 1 0 0 1 100 630 Tm [(26M000103) -2000 (POSSESSION OF MARIJUANA 2ND) -3000 (300 BLOCK OF BUTTERMILK RD)] TJ ET',
    row(610, {
      date: '11/5/2026',
      time: '9:30 AM',
      caseNumber: '26M000104',
      incident: 'RAPE 1ST',
      location: '400 BLOCK OF OAK ST',
    }),
  ].join('\n');
  // A short last page: too few runs to find its own columns.
  const last = row(700, {
    date: '11/5/2026',
    time: '10:00 AM',
    caseNumber: '26M000105',
    incident: 'DUI - ALCOHOL',
    location: 'HWY 72 / WALL TRIANA HWY',
  });
  return reportPdf([first, last]);
}

test('extracts positioned text runs from a small-window, indirect-length PDF', () => {
  const pages = extractPdfTextRuns(samplePdf());
  assert.equal(pages.length, 2);
  const spanning = pages[0].find((run) => run.text.startsWith('26M000103'));
  assert.deepEqual(spanning.text.split('\t'), [
    '26M000103',
    'POSSESSION OF MARIJUANA 2ND',
    '300 BLOCK OF BUTTERMILK RD',
  ]);
  assert.equal(spanning.x, 100);
  assert.equal(spanning.y, 630);
  assert.equal(spanning.size, 8);
  assert.throws(() => extractPdfTextRuns(new Uint8Array([1, 2, 3])), {
    message: 'pdf_not_a_pdf',
  });
});

test('reads ToUnicode CMaps with bfchar and bfrange', () => {
  const { bytes, map } = parseToUnicode(
    `begincodespacerange <0000> <FFFF> endcodespacerange
     beginbfchar <0003> <0020> endbfchar
     beginbfrange <0024> <0026> <0041> <0030> <0031> [<0061> <0062>] endbfrange`,
  );
  assert.equal(bytes, 2);
  assert.equal(map.get(3), ' ');
  assert.equal(map.get(0x26), 'C');
  assert.equal(map.get(0x31), 'b');
});

test('parses report rows, wrapped incidents and a short last page', () => {
  const rows = parseIncidentRows(extractPdfTextRuns(samplePdf()));
  assert.deepEqual(
    rows.map(({ caseNumber, incident, location }) => [
      caseNumber,
      incident,
      location,
    ]),
    [
      ['26M000101', 'THEFT OF PROPERTY 4TH', '100 BLOCK OF HUGHES RD'],
      [
        '26M000102',
        'DOMESTIC VIOLENCE 3RD - HARASSMENT',
        '200 BLOCK OF MILL RD MAD',
      ],
      ['26M000102', 'CRIMINAL MISCHIEF 3RD', '200 BLOCK OF MILL RD MAD'],
      [
        '26M000103',
        'POSSESSION OF MARIJUANA 2ND',
        '300 BLOCK OF BUTTERMILK RD',
      ],
      ['26M000104', 'RAPE 1ST', '400 BLOCK OF OAK ST'],
      ['26M000105', 'DUI - ALCOHOL', 'HWY 72 / WALL TRIANA HWY'],
    ],
  );
  // 11:05 PM Central on 3 Nov 2026 (CST, UTC-6), from the line below the date.
  assert.equal(rows[1].occurredAt, Date.UTC(2026, 10, 4, 5, 5));
  assert.equal(
    centralTimeToEpoch(2026, 7, 1, 12, 0, 0),
    Date.UTC(2026, 6, 1, 17),
  );
});

test('lists archive reports newest first with ISO days', () => {
  const html = `
    <a href="Archive.aspx?ADID=6100"><span>October 2, 2026 to October 8, 2026</span></a>
    <a href="Archive.aspx?ADID=6174">
      <span>October 30, 2026 to November 5, 2026  </span></a>
    <a href="Archive.aspx?ADID=6174"><span>duplicate</span></a>`;
  assert.deepEqual(parseArchiveList(html), [
    {
      id: 6174,
      title: 'October 30, 2026 to November 5, 2026',
      startDate: '2026-10-30',
      endDate: '2026-11-05',
    },
    {
      id: 6100,
      title: 'October 2, 2026 to October 8, 2026',
      startDate: '2026-10-02',
      endDate: '2026-10-08',
    },
  ]);
});

test('classifies offenses by their most severe charge and flags sensitive ones', () => {
  assert.equal(classifyOffense('THEFT OF PROPERTY 4TH'), 'property');
  assert.equal(classifyOffense('ASSAULT 3RD'), 'violent');
  assert.equal(classifyOffense('DUI - ALCOHOL'), 'traffic');
  assert.equal(classifyOffense('POSSESSION OF MARIJUANA 2ND'), 'drugs');
  assert.equal(classifyOffense('ALCOHOL LICENSE BACKGROUND CHECK'), 'other');
  assert.equal(
    mostSevereCategory(['traffic', 'violent', 'property']),
    'violent',
  );
  assert.equal(isSensitiveOffense('RAPE 1ST'), true);
  assert.equal(isSensitiveOffense('MISSING PERSON'), true);
  assert.equal(isSensitiveOffense('BURGLARY 3RD'), false);
});

test('turns report locations into locator queries', () => {
  assert.equal(locationQuery('0 BLOCK OF BLOCK OF HUGHES RD'), '1 HUGHES RD');
  assert.equal(locationQuery('200 BLOCK OF MILL RD MAD'), '200 MILL RD');
  assert.equal(
    locationQuery('HWY 72 / WALL TRIANA HWY'),
    'HWY 72 & WALL TRIANA HWY',
  );
  assert.equal(locationQuery('100 MAIN ST SUITE 4 @ WALMART'), '100 MAIN ST');
  assert.equal(locationQuery('I565 MILE MARKER 8'), null);
  assert.equal(locationQuery('#ERROR'), null);
  assert.equal(locationQuery(''), null);
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('geocodes in batches, rejects far-away matches and caches misses on disk', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crime-geo-'));
  try {
    const cachePath = path.join(dir, 'geocode.json');
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(url);
      assert.equal(url, GEOCODE_URL);
      const { records } = JSON.parse(
        new URLSearchParams(init.body).get('addresses'),
      );
      return jsonResponse({
        locations: records.map(({ attributes }) => ({
          attributes: { ResultID: attributes.OBJECTID },
          score: 100,
          location:
            attributes.SingleLine === '1 FAR ST'
              ? { x: -87.5, y: 34.7 }
              : attributes.SingleLine === 'NOWHERE'
                ? { x: Number.NaN, y: Number.NaN }
                : { x: -86.7481234567, y: 34.6993 },
        })),
      });
    };
    const geocoder = createCrimeGeocoder({
      cachePath,
      fetchImpl,
      now: () => NOW,
    });
    const found = await geocoder.locate([
      '100 HUGHES RD',
      '1 FAR ST',
      'NOWHERE',
    ]);
    assert.deepEqual(found.get('100 HUGHES RD'), {
      lon: -86.748123,
      lat: 34.6993,
    });
    assert.equal(found.get('1 FAR ST'), null);
    assert.equal(calls.length, 1);
    const saved = JSON.parse(await readFile(cachePath, 'utf8'));
    assert.equal(saved.entries['NOWHERE'].miss, true);

    const again = createCrimeGeocoder({
      cachePath,
      fetchImpl: async () => assert.fail('cached queries need no request'),
      now: () => NOW,
    });
    const cached = await again.locate(['100 HUGHES RD', 'NOWHERE']);
    assert.deepEqual(cached.get('100 HUGHES RD'), {
      lon: -86.748123,
      lat: 34.6993,
    });
    assert.equal(cached.get('NOWHERE'), null);

    const down = createCrimeGeocoder({
      cachePath,
      fetchImpl: async () => new Response('', { status: 503 }),
      now: () => NOW,
    });
    const partial = await down.locate(['100 HUGHES RD', '9 NEW ST']);
    assert.deepEqual(partial.get('100 HUGHES RD'), {
      lon: -86.748123,
      lat: 34.6993,
    });
    assert.equal(partial.has('9 NEW ST'), false);
    const after = JSON.parse(await readFile(cachePath, 'utf8'));
    assert.equal('9 NEW ST' in after.entries, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('groups charges into cases with the most severe category', () => {
  const cases = crimeCasesFromRows([
    {
      caseNumber: 'A',
      occurredAt: 20,
      incident: 'CRIMINAL MISCHIEF 3RD',
      location: 'X',
    },
    { caseNumber: 'A', occurredAt: 10, incident: 'ASSAULT 3RD', location: 'X' },
    { caseNumber: 'A', occurredAt: 30, incident: 'ASSAULT 3RD', location: 'X' },
    {
      caseNumber: 'B',
      occurredAt: 5,
      incident: 'RUNAWAY JUVENILE',
      location: 'Y',
    },
  ]);
  assert.deepEqual(cases[0], {
    id: 'A',
    t: 10,
    offenses: ['CRIMINAL MISCHIEF 3RD', 'ASSAULT 3RD'],
    location: 'X',
    sensitive: false,
    category: 'violent',
  });
  assert.equal(cases[1].sensitive, true);
});

/** Drive the middleware the way Connect does. */
function proxyHarness(options) {
  let handler;
  crimeProxy(options).configureServer({
    middlewares: { use: (route, fn) => (handler = fn) },
  });
  return (url, method = 'GET') =>
    new Promise((resolve) => {
      const res = {
        destroyed: false,
        headers: null,
        status: 0,
        writeHead(status, headers) {
          this.status = status;
          this.headers = headers;
        },
        end(body) {
          resolve({
            status: this.status,
            headers: this.headers,
            body: JSON.parse(body),
          });
        },
      };
      handler(
        { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } },
        res,
      );
    });
}

const ARCHIVE_HTML = `
  <a href="Archive.aspx?ADID=6174"><span>October 30, 2026 to November 5, 2026</span></a>
  <a href="Archive.aspx?ADID=5000"><span>October 1, 2025 to October 7, 2025</span></a>`;

test('/api/crime serves the windowed, privacy-filtered year and caches reports', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crime-proxy-'));
  try {
    const requested = [];
    const fetchImpl = async (url, init) => {
      requested.push(url);
      assert.equal(init.redirect, 'error');
      assert.match(init.headers['User-Agent'], /crime/);
      if (url === MADISON_ARCHIVE_URL) return new Response(ARCHIVE_HTML);
      if (url.endsWith('/ArchiveCenter/ViewFile/Item/6174'))
        return new Response(samplePdf());
      return new Response('', { status: 404 });
    };
    const located = [];
    const geocoder = {
      async locate(queries) {
        located.push(...queries);
        return new Map(
          queries
            .filter((query) => query !== '300 BUTTERMILK RD')
            .map((query, i) => [query, { lon: -86.75 + i / 1000, lat: 34.7 }]),
        );
      },
    };
    const get = proxyHarness({
      fetchImpl,
      geocoder,
      now: () => NOW,
      cacheDir: dir,
    });

    const { status, headers, body } = await get('/?days=7');
    assert.equal(status, 200);
    assert.equal(headers['Cache-Control'], 'no-store');
    // The report from 2025 is older than a year and is never fetched.
    assert.deepEqual(requested, [
      MADISON_ARCHIVE_URL,
      'https://www.madisonal.gov/ArchiveCenter/ViewFile/Item/6174',
    ]);
    assert.equal(body.reportCount, 1);
    assert.equal(body.complete, true);
    assert.equal(body.withheld, 1);
    assert.equal(body.unmapped, 1);
    assert.deepEqual(
      body.incidents.map(({ id, category }) => [id, category]),
      [
        ['26M000105', 'traffic'],
        ['26M000102', 'violent'],
        ['26M000101', 'property'],
      ],
    );
    assert.deepEqual(body.incidents[1].offenses, [
      'DOMESTIC VIOLENCE 3RD - HARASSMENT',
      'CRIMINAL MISCHIEF 3RD',
    ]);
    // The withheld case's location is never even geocoded.
    assert.equal(located.includes('400 OAK ST'), false);
    assert.equal(JSON.stringify(body).includes('OAK ST'), false);

    // The window ends at the newest case, not at the request time.
    const narrow = await get('/?days=1');
    assert.deepEqual(
      narrow.body.incidents.map(({ id }) => id),
      ['26M000105'],
    );
    assert.equal((await get('/?days=0')).status, 400);
    assert.equal((await get('/?days=366')).status, 400);
    assert.equal((await get('/?days=7', 'POST')).status, 405);
    assert.deepEqual(await readdir(path.join(dir, 'madison')), ['6174.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('/api/crime answers 502 when no report can be read', async () => {
  const get = proxyHarness({
    fetchImpl: async () => new Response('', { status: 500 }),
    geocoder: { locate: async () => new Map() },
    now: () => NOW,
    cacheDir: null,
  });
  const { status, body } = await get('/');
  assert.equal(status, 502);
  assert.equal(body.error, 'crime_unavailable');
});
