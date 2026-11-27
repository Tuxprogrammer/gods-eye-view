import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installVueDom } from '../../testSupport/vueDom.mjs';

let mount;
let PlacesPage;
let store;
let resetPlaces;
let currentPlace;
let notePlace;
let followShown;
let CITY_POIS;
let uninstall;
before(async () => {
  uninstall = installVueDom();
  ({ mount } = await import('@vue/test-utils'));
  PlacesPage = (await import('./PlacesPage.vue')).default;
  const { useLocationStore } = await import('../stores/location.js');
  const { applicationPinia } = await import('../vueRuntime.js');
  store = useLocationStore(applicationPinia());
  ({ resetPlaces, currentPlace, notePlace, followShown } =
    await import('./placesState.js'));
  ({ CITY_POIS } = await import('../../cityPois.js'));
});
after(() => uninstall());
beforeEach(() => resetPlaces());

const settle = async (wrapper) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
};

/** Location controls that record what the page asks of them. */
function connect({ found = true, error = null } = {}) {
  const calls = [];
  store.publish({
    poiCity: null,
    searchError: null,
    searching: false,
    orbit: { active: false },
  });
  store.connect({
    chooseCity: (id) => {
      calls.push(['city', id]);
      store.publish({ ...store.view, poiCity: id });
    },
    choosePoi: (index) => calls.push(['poi', index]),
    editSearch: () => calls.push(['edit']),
    search: async (query, options) => {
      calls.push(['search', query, options.origin]);
      if (error) store.publish({ ...store.view, searchError: error });
      return found ? true : undefined;
    },
  });
  return calls;
}

function page() {
  let closed = 0;
  const wrapper = mount(PlacesPage, {
    attachTo: document.body,
    props: { close: () => closed++ },
  });
  return { wrapper, el: wrapper.element, closed: () => closed };
}

test('every control is a kit control, and every preset city has a button', () => {
  connect();
  const { wrapper, el } = page();
  for (const button of el.querySelectorAll('button'))
    assert.ok(button.classList.contains('ui-button'), button.className);
  assert.equal(
    el.querySelectorAll('.location-pill').length,
    Object.keys(CITY_POIS).length,
  );
  assert.ok(el.querySelector('.ui-search-field input[type="search"]'));
  wrapper.unmount();
});

test('a city flies there and lists its landmarks; a landmark flies there and closes the sheet', async () => {
  const calls = connect();
  const { wrapper, el, closed } = page();
  assert.equal(el.querySelector('.poi-pill'), null);
  assert.ok(el.querySelector('.mp-pois .mp-hint'));
  const [id, city] = Object.entries(CITY_POIS)[1];
  [...el.querySelectorAll('.location-pill')]
    .find((b) => b.textContent === city.name)
    .click();
  await wrapper.vm.$nextTick();
  assert.deepEqual(calls, [['city', id]]);
  const pois = [...el.querySelectorAll('.poi-pill')];
  assert.equal(pois.length, city.pois.length);
  assert.equal(
    el.querySelector('.location-pill.active').textContent,
    city.name,
  );
  assert.equal(el.querySelector('.mp-here-city').textContent, city.name);
  pois[2].click();
  await wrapper.vm.$nextTick();
  assert.deepEqual(calls.at(-1), ['poi', 2]);
  assert.equal(closed(), 1);
  assert.deepEqual(currentPlace(store.view), {
    city: city.name,
    poi: city.pois[2].name,
  });
  // The card follows the landmark, though the controls published nothing.
  assert.equal(el.querySelector('.mp-here-poi').textContent, city.pois[2].name);
  wrapper.unmount();
});

test('tapping the open city flies there again, as the Omnibar does, and names its first landmark', async () => {
  const calls = connect();
  const { wrapper, el } = page();
  const flights = [];
  store.publish({ ...store.view });
  const { useOmnibarStore } = await import('../stores/omnibar.js');
  const { applicationPinia } = await import('../vueRuntime.js');
  const omnibar = useOmnibarStore(applicationPinia());
  omnibar.connectRunner(async (name, args) => {
    flights.push([name, args]);
    return { ok: true };
  });
  const [id, city] = Object.entries(CITY_POIS)[1];
  const pill = () =>
    [...el.querySelectorAll('.location-pill')].find(
      (b) => b.textContent === city.name,
    );
  pill().click();
  await wrapper.vm.$nextTick();
  el.querySelectorAll('.poi-pill')[3].click();
  await wrapper.vm.$nextTick();
  pill().click();
  await settle(wrapper);
  assert.equal(calls.filter(([kind]) => kind === 'city').length, 1);
  assert.deepEqual(flights, [['fly_to_location', { locationId: id }]]);
  assert.deepEqual(currentPlace(store.view), {
    city: city.name,
    poi: city.pois[0].name,
  });
  omnibar.connectRunner(null);
  wrapper.unmount();
});

test('a city opened elsewhere after a note names the current place, even the one open at the note', () => {
  const [tokyoId, tokyo] = Object.entries(CITY_POIS)[3];
  const [parisId, paris] = Object.entries(CITY_POIS)[5];
  notePlace({ city: 'Oslo' }, { poiCity: tokyoId });
  assert.equal(currentPlace({ poiCity: tokyoId }).city, 'Oslo');
  followShown(parisId);
  assert.equal(currentPlace({ poiCity: parisId }).city, paris.name);
  followShown(tokyoId);
  assert.equal(currentPlace({ poiCity: tokyoId }).city, tokyo.name);
});

test('a search names the place searched for, though the landmarks of another city were open', async () => {
  connect();
  const { wrapper, el } = page();
  const [, city] = Object.entries(CITY_POIS)[2];
  [...el.querySelectorAll('.location-pill')]
    .find((b) => b.textContent === city.name)
    .click();
  await wrapper.vm.$nextTick();
  const input = el.querySelector('input[type="search"]');
  input.value = 'Oslo';
  input.dispatchEvent(new Event('input'));
  await wrapper.vm.$nextTick();
  el.querySelector('.mp-search-box').dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
  await settle(wrapper);
  assert.deepEqual(currentPlace(store.view), { city: 'Oslo', poi: '' });
  assert.equal(el.querySelector('.mp-here-city').textContent, 'Oslo');
  // Landmarks the Omnibar opens later for another city name that city.
  const [otherId, other] = Object.entries(CITY_POIS)[3];
  store.publish({ ...store.view, poiCity: otherId });
  assert.equal(currentPlace(store.view).city, other.name);
  wrapper.unmount();
});

test('search asks for a place first, flies to a found one and shows why one was not found', async () => {
  let calls = connect();
  let { wrapper, el, closed } = page();
  const form = el.querySelector('.mp-search-box');
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle(wrapper);
  assert.equal(el.querySelector('.mp-message').dataset.kind, 'error');
  assert.equal(calls.length, 0);

  const input = el.querySelector('input[type="search"]');
  input.value = 'Oslo';
  input.dispatchEvent(new Event('input'));
  await wrapper.vm.$nextTick();
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle(wrapper);
  assert.deepEqual(calls.at(-1), ['search', 'Oslo', 'phone-places']);
  assert.equal(closed(), 1, 'a found place closes the sheet');
  assert.equal(currentPlace(store.view).city, 'Oslo');
  wrapper.unmount();

  calls = connect({ found: false, error: 'Location not found.' });
  ({ wrapper, el, closed } = page());
  const again = el.querySelector('input[type="search"]');
  again.value = 'Nowhere';
  again.dispatchEvent(new Event('input'));
  await wrapper.vm.$nextTick();
  el.querySelector('.mp-search-box').dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
  await settle(wrapper);
  const message = el.querySelector('.mp-message');
  assert.equal(message.dataset.kind, 'error');
  assert.equal(message.textContent, 'Location not found.');
  assert.equal(closed(), 0, 'the sheet stays open to try again');
  // Editing the query clears the error.
  again.value = 'Nowhere 2';
  again.dispatchEvent(new Event('input'));
  await wrapper.vm.$nextTick();
  assert.equal(el.querySelector('.mp-message').textContent, '');
  assert.ok(calls.some(([kind]) => kind === 'edit'));
  wrapper.unmount();
});

test('the orbit button follows the orbit and replays the O key', async () => {
  connect();
  const { wrapper, el } = page();
  const keys = [];
  const onKey = (event) => keys.push(event.key);
  document.addEventListener('keydown', onKey);
  const orbit = el.querySelector('.mp-tool');
  assert.equal(orbit.getAttribute('aria-pressed'), 'false');
  orbit.click();
  assert.deepEqual(keys, ['o']);
  store.publish({ ...store.view, orbit: { active: true } });
  await wrapper.vm.$nextTick();
  assert.equal(orbit.getAttribute('aria-pressed'), 'true');
  document.removeEventListener('keydown', onKey);
  wrapper.unmount();
});
