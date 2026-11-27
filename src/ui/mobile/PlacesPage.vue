<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../i18n/index.js';
import { CITY_POIS } from '../../cityPois.js';
import { useLocationStore } from '../stores/location.js';
import { useOmnibarStore } from '../stores/omnibar.js';
import { applicationPinia } from '../vueRuntime.js';
import UiButton from '../kit/UiButton.vue';
import UiSearchField from '../kit/UiSearchField.vue';
import { canWebShare } from './places-helpers.js';
import { currentPlace, notePlace } from './placesState.js';

// The phone's Places page (pages/places.js mounts it in the sheet): the place
// you are at, place search, the preset cities and their landmarks, orbit and
// sharing. It drives the same location controls the Omnibar's place chips
// call (src/ui/stores/location.js), so search, fly-to, landmark keys and
// orbit behave as on desktop.
const props = defineProps({
  /** Closes the sheet, so the map is in view. */
  close: { type: Function, default: () => {} },
});

const store = useLocationStore(applicationPinia());
const { view, controls } = storeToRefs(store);
const omnibar = useOmnibarStore(applicationPinia());

const CITIES = Object.entries(CITY_POIS).map(([id, city]) => ({
  id,
  name: city.name,
  pois: city.pois,
}));
const POI_KEYS = ['Q', 'W', 'E', 'R', 'T'];

const here = computed(() => currentPlace(view.value));
const landmarkCity = computed(() =>
  CITIES.find((city) => city.id === view.value?.poiCity),
);
const orbiting = computed(() => Boolean(view.value?.orbit?.active));

// ── Search ──
const query = ref('');
const message = ref({ kind: 'info', text: '' });
const field = ref(null);
const landmarks = ref(null);

async function search() {
  const text = query.value.trim();
  if (!text) {
    message.value = { kind: 'error', text: t('Type a place first.') };
    field.value?.focus();
    return;
  }
  const location = controls.value;
  if (!location) return;
  message.value = { kind: 'info', text: t('Searching') };
  // Dismiss the soft keyboard so the map shows once the camera flies.
  globalThis.document?.activeElement?.blur?.();
  const found = await location.search(text, { origin: 'phone-places' });
  if (found) {
    notePlace({ city: text }, view.value);
    message.value = {
      kind: 'ok',
      text: t('Flying to {place}', { place: text }),
    };
    props.close();
  } else if (view.value?.searchError) {
    message.value = { kind: 'error', text: view.value.searchError };
  } else {
    message.value = { kind: 'info', text: '' };
  }
}

function editQuery(next) {
  query.value = next;
  if (message.value.kind === 'error')
    message.value = { kind: 'info', text: '' };
  controls.value?.editSearch();
}

// ── Cities and landmarks ──
async function chooseCity(city) {
  const firstLandmark = { city: city.name, poi: city.pois[0]?.name ?? '' };
  const before = view.value;
  // The city whose landmarks are open would only fold them (the shell's
  // city pill toggles), and this page lists landmarks by the open city, so
  // that city is flown to through the action runner, as the Omnibar does.
  const runner = omnibar.runner;
  if (before?.poiCity === city.id && runner) {
    const result = await runner('fly_to_location', { locationId: city.id });
    if (result !== false && result?.ok !== false && !result?.cancelled)
      notePlace(firstLandmark, view.value);
    return;
  }
  controls.value?.chooseCity(city.id);
  // A city that flew shows its landmarks, which publishes a new view; a
  // refused flight changes nothing.
  if (view.value === before) return;
  // A city flies to its first landmark.
  notePlace(firstLandmark, view.value);
  void nextTick(() =>
    landmarks.value?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
  );
}

function choosePoi(city, index) {
  controls.value?.choosePoi(index);
  notePlace({ city: city.name, poi: city.pois[index]?.name ?? '' }, view.value);
  props.close();
}

// ── Orbit and sharing ──
/** The shell binds O on document keydown; the button replays it. */
function toggleOrbit() {
  globalThis.document?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', bubbles: true }),
  );
}

const shareUrl = ref('');
const shareNote = ref('');
async function share() {
  shareNote.value = '';
  shareUrl.value = '';
  const url = globalThis.location.href;
  if (canWebShare()) {
    try {
      // i18n-ignore: the product name
      await navigator.share({ title: "God's Eye View", url });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  // The existing share button owns link building, the clipboard and its toast.
  globalThis.document?.getElementById('share-btn')?.click();
  if (!globalThis.isSecureContext || !navigator.clipboard) {
    shareUrl.value = url;
    shareNote.value = t(
      'Copying is blocked on this connection. Press and hold the link to copy it.',
    );
  }
}

onBeforeUnmount(() => {
  message.value = { kind: 'info', text: '' };
});
</script>

<template>
  <div class="mp-places-page">
    <section class="mp-card mp-here">
      <h3 class="mp-heading">{{ t('Current place') }}</h3>
      <p class="mp-here-city">{{ here.city || '--' }}</p>
      <p v-if="here.poi" class="mp-here-poi">{{ here.poi }}</p>
    </section>

    <section class="mp-card mp-search">
      <h3 class="mp-heading">{{ t('Search') }}</h3>
      <form class="mp-search-box" role="search" @submit.prevent="search">
        <UiSearchField
          ref="field"
          class="mp-search-field"
          input-class="mp-search-input"
          :model-value="query"
          :label="t('Search location')"
          :placeholder="t('City, address, or lat, lon')"
          :clear-label="t('Clear search')"
          clear-class="mp-clear"
          autocomplete="off"
          spellcheck="false"
          @update:model-value="editQuery"
        />
        <UiButton
          type="submit"
          class="m-btn mp-go"
          :label="t('Search location')"
          :native-title="false"
          >{{ t('Go') }}</UiButton
        >
      </form>
      <p
        class="m-meta mp-message"
        role="status"
        aria-live="polite"
        :data-kind="message.kind"
        >{{ message.text }}</p
      >
    </section>

    <section class="mp-card mp-cities">
      <h3 class="mp-heading">{{ t('Cities') }}</h3>
      <div class="mp-city-list">
        <UiButton
          v-for="city in CITIES"
          :key="city.id"
          class="m-btn location-pill"
          :pressed="view?.poiCity === city.id"
          pressed-class="active"
          @click="chooseCity(city)"
          >{{ city.name }}</UiButton
        >
      </div>
    </section>

    <section ref="landmarks" class="mp-card mp-pois">
      <h3 class="mp-heading">{{ t('Landmarks') }}</h3>
      <div v-if="landmarkCity" class="mp-poi-list">
        <UiButton
          v-for="(poi, index) in landmarkCity.pois"
          :key="poi.name"
          class="m-btn poi-pill"
          @click="choosePoi(landmarkCity, index)"
          ><span class="poi-pill-key" aria-hidden="true">{{
            POI_KEYS[index]
          }}</span
          ><span class="poi-pill-name">{{ poi.name }}</span></UiButton
        >
      </div>
      <p v-else class="m-meta mp-hint">{{
        t('Pick a city above to list its landmarks.')
      }}</p>
    </section>

    <section class="mp-card mp-tools">
      <h3 class="mp-heading">{{ t('Camera and sharing') }}</h3>
      <UiButton
        class="m-btn mp-tool"
        :pressed="orbiting"
        @click="toggleOrbit"
        >{{ orbiting ? t('↻ Stop orbit') : t('↻ Orbit landmark') }}</UiButton
      >
      <p class="m-meta mp-hint-line">
        {{
          t(
            'Circles the last landmark you flew to. Tap the ORBIT chip on the map to stop.',
          )
        }}
      </p>
      <UiButton class="m-btn mp-tool" @click="share">{{
        t('Share this view')
      }}</UiButton>
      <a
        v-if="shareUrl"
        class="mp-share-url"
        :href="shareUrl"
        :aria-label="t('Share link')"
        >{{ shareUrl }}</a
      >
      <p v-if="shareNote" class="m-meta mp-hint-line">{{ shareNote }}</p>
    </section>
  </div>
</template>
