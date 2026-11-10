import assert from 'node:assert/strict';
import test from 'node:test';
import { createCrimeLayer } from './index.js';
import { createCrimeSource } from './source.js';
import { buildCrimeCard } from './cards.js';
import {
  crimeMarkerPixels,
  dominantCategory,
  groupCrimeLocations,
  normalizeCrimePayload,
  offenseLine,
  titleCaseLocation,
} from './model.js';

const T0 = Date.UTC(2026, 10, 5, 15);

function incident(id, extra = {}) {
  return {
    id,
    t: T0,
    category: 'property',
    offenses: ['THEFT OF PROPERTY 4TH'],
    location: '100 BLOCK OF HUGHES RD',
    lon: -86.75,
    lat: 34.7,
    ...extra,
  };
}

function payload(incidents, extra = {}) {
  return {
    source: 'madison-pd',
    agency: 'Madison Police Department (AL)',
    generatedAt: T0,
    days: 30,
    from: T0 - 30 * 86_400_000,
    through: T0,
    complete: true,
    withheld: 2,
    unmapped: 1,
    incidents,
    stale: false,
    ...extra,
  };
}

test('normalizes a payload and drops incidents it cannot place', () => {
  const snapshot = normalizeCrimePayload(
    payload([
      incident('A'),
      incident('B', { lon: 'x' }),
      incident('C', { category: 'arson?' }),
      { id: 7, lon: 1, lat: 1, t: 1 },
    ]),
  );
  assert.deepEqual(
    snapshot.incidents.map(({ id, category }) => [id, category]),
    [
      ['A', 'property'],
      ['C', 'other'],
    ],
  );
  assert.equal(snapshot.withheld, 2);
  assert.throws(() => normalizeCrimePayload({}), /Malformed/);
});

test('groups cases by block, newest first, colored by the most common kind', () => {
  const groups = groupCrimeLocations([
    incident('A', { t: T0 - 2 }),
    incident('B', { t: T0, category: 'violent', offenses: ['ASSAULT 3RD'] }),
    incident('C', { t: T0 - 1 }),
    incident('D', { lon: -86.7, category: 'traffic' }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups[0].incidents.map(({ id }) => id),
    ['B', 'C', 'A'],
  );
  assert.equal(groups[0].category, 'property');
  assert.equal(
    groupCrimeLocations([incident('A')], new Set(['violent'])).length,
    0,
  );
  // Ties go to the more severe kind.
  assert.equal(dominantCategory({ traffic: 1, violent: 1 }), 'violent');
  assert.equal(crimeMarkerPixels(1), 8);
  assert.equal(crimeMarkerPixels(500), 20);
  assert.equal(
    titleCaseLocation('100 BLOCK OF HUGHES RD NW'),
    '100 Block of Hughes Rd NW',
  );
  assert.equal(offenseLine('DUI - ALCOHOL'), 'DUI - alcohol');
});

test('a block card lists the newest cases and the kind mix', () => {
  const [group] = groupCrimeLocations(
    ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) =>
      incident(id, {
        t: T0 - i,
        ...(i === 0
          ? { category: 'violent', offenses: ['ASSAULT 3RD', 'MENACING'] }
          : {}),
      }),
    ),
  );
  const card = buildCrimeCard(group);
  assert.equal(card.title, 'MADISON PD · 100 BLOCK OF HUGHES RD');
  assert.equal(card.details[0], '6 cases · 1 violent · 5 property');
  assert.match(card.details[1], /^Nov 5 · Assault 3rd \+1$/);
  assert.equal(card.details[5], '+2 more');
  assert.equal(card.accent, '#f59e0b');
});

function harness(getIncidents, options = {}) {
  const sources = [];
  const events = [];
  const viewer = {
    dataSources: {
      add: (value) => sources.push(value),
      remove: (value) => sources.splice(sources.indexOf(value), 1),
    },
  };
  const calls = [];
  const layer = createCrimeLayer({
    source: {
      getIncidents: async (options) => {
        calls.push(options);
        return getIncidents(options);
      },
    },
    overlayHost: {
      setEntries: (...args) => events.push(args),
      setVisible() {},
      clearSource() {},
    },
    ...options,
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, events, calls };
}

test('draws one marker per block and filters by kind', async () => {
  const h = harness(async () =>
    normalizeCrimePayload(
      payload([
        incident('A'),
        incident('B', { category: 'violent' }),
        incident('C', { lon: -86.7, category: 'traffic' }),
      ]),
    ),
  );
  assert.equal(await h.layer.update(), true);
  assert.equal(h.calls[0].days, 30);
  assert.equal(h.sources[0].entities.values.length, 2);
  assert.equal(h.layer.getStats().count, 3);

  let notified = 0;
  h.layer.setRowControlsListener(() => notified++);
  const controls = h.layer.getRowControls();
  assert.deepEqual(
    controls.legend.map(({ count }) => count),
    [1, 1, 0, 1, 0],
  );
  assert.match(controls.info, /2 withheld for privacy · 1 not mapped/);
  controls.chips.find(({ id }) => id === 'category-traffic').onClick();
  assert.equal(notified, 1);
  assert.equal(h.sources[0].entities.values.length, 1);
  assert.equal(h.layer.getStats().count, 2);
  assert.equal(h.layer.getAnalystRecords().length, 2);
  assert.equal(
    h.layer.getAnalystRecords()[0].location,
    '100 Block of Hughes Rd',
  );
  h.layer.destroy();
  assert.equal(h.sources.length, 0);
});

test('the window control refetches with the chosen number of days', async () => {
  const h = harness(async ({ days }) =>
    normalizeCrimePayload(payload([incident(`D${days}`)], { days })),
  );
  await h.layer.update();
  const option = h.layer
    .getRowControls()
    .segmented.options.find(({ id }) => id === 'window-365');
  option.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.at(-1).days, 365);
  assert.equal(
    h.layer.getRowControls().segmented.options.find(({ active }) => active).id,
    'window-365',
  );
  h.layer.destroy();
});

test('a late answer cannot publish after disable or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve;
    let signal;
    const h = harness((options) => {
      signal = options.signal;
      return new Promise((done) => (resolve = done));
    });
    const pending = h.layer.update();
    h.layer[action]();
    assert.equal(signal.aborted, true);
    resolve(normalizeCrimePayload(payload([incident('A')])));
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    h.layer.destroy();
  }
});

test('a failed fetch is reported and keeps the last snapshot', async () => {
  let fail = false;
  const h = harness(async () => {
    if (fail) throw new Error('Crime reports unavailable');
    return normalizeCrimePayload(payload([incident('A')]));
  });
  await h.layer.update();
  fail = true;
  assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getStats().error, 'Crime reports unavailable');
  assert.equal(h.layer.getStats().count, 1);
  h.layer.destroy();
});

test('the source asks the same-origin endpoint and maps a 502', async () => {
  const urls = [];
  const ok = createCrimeSource({
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(payload([incident('A')])));
    },
  });
  const snapshot = await ok.getIncidents({ days: 90 });
  assert.equal(urls[0], '/api/crime?days=90');
  assert.equal(snapshot.incidents.length, 1);
  const down = createCrimeSource({
    fetchImpl: async () => new Response('{}', { status: 502 }),
  });
  await assert.rejects(down.getIncidents(), {
    message: 'Crime reports unavailable',
  });
});

test('an incomplete snapshot is fetched again soon, a complete one is not', async () => {
  let complete = false;
  const h = harness(
    async () => normalizeCrimePayload(payload([incident('A')], { complete })),
    { followUpMs: 5 },
  );
  await h.layer.update();
  complete = true;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(h.calls.length, 2);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(h.calls.length, 2);
  complete = false;
  await h.layer.update();
  h.layer.disable();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(h.calls.length, 3);
  h.layer.destroy();
});
