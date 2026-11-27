<script setup>
import { reactive, ref, watch } from 'vue';
import UiButton from '../kit/UiButton.vue';
import UiCheckbox from '../kit/UiCheckbox.vue';
import UiSelect from '../kit/UiSelect.js';
import UiSlider from '../kit/UiSlider.js';
import UiSwitch from '../kit/UiSwitch.vue';
import { vFieldValue } from '../rail/fieldValue.js';
import { t } from '../../i18n/index.js';

// This fork's own row controls: colour ramp, sliders, dropdowns, text
// filters and the Meshtastic server list, drawn with the kit's controls.
// Every action re-reads the layer's live descriptor and on/off state at event
// time, so a stale paint can never drive a control the layer has dropped. A
// value being typed, picked or dragged is never rewritten by a repaint
// (`hold`, `v-field-value`). `display: contents` keeps each control a flex
// item of the row's `.data-toggle-controls`.
const props = defineProps({
  layerId: { type: String, required: true },
  // The layer's live descriptor at this paint.
  controls: { type: Object, default: null },
  // Re-read the live descriptor and the layer's on/off state at event time.
  live: { type: Function, required: true },
  isEnabled: { type: Function, required: true },
  // Changes on every paint, so each paint re-renders.
  paint: { type: Number, default: 0 },
});

const current = () => props.live(props.layerId);
const enabled = () => props.isEnabled(props.layerId);
const find = (kind, id) =>
  current()?.[kind]?.find?.((entry) => entry.id === id);
const serverItem = (id) =>
  current()?.servers?.items?.find?.((entry) => entry.id === id);

// ── Sliders ──
// While a slider is dragged its readout follows the thumb; the descriptor's
// value shows again once it lets go, or with the next paint while it is not
// focused (WebKit and macOS Firefox do not focus a range input they drag).
const dragging = reactive({});
const root = ref(null);
watch(
  () => props.paint,
  () => {
    const active = root.value?.ownerDocument?.activeElement;
    const held =
      active && root.value.contains(active)
        ? active.dataset?.sliderId
        : undefined;
    for (const id of Object.keys(dragging))
      if (id !== held) delete dragging[id];
  },
);
const sliderText = (slider) =>
  `${dragging[slider.id] ?? slider.value}${slider.suffix || ''}`;
function endDrag(id) {
  delete dragging[id];
}
function onSlider(id, value) {
  if (!enabled()) return;
  const slider = find('sliders', id);
  if (!slider || !Number.isFinite(value)) return;
  dragging[id] = value;
  slider.onInput?.(value);
}

// ── Dropdowns and text filters: a choice made, or Enter / blur ──
function onSelect(id, value) {
  if (enabled()) find('selects', id)?.onChange?.(value);
}
function onText(id, event) {
  if (enabled()) find('texts', id)?.onCommit?.(event.target.value);
}

const rampLabel = (ramp) =>
  t('{caption}. Scale marks: {marks}', {
    caption: ramp.caption,
    marks: ramp.ticks.map((tick) => tick.label).join(', '),
  });

// ── Servers: switch, delete, retopic and add ──
function onRemove(id) {
  if (enabled()) serverItem(id)?.onRemove?.();
}
function onToggle(id) {
  if (enabled()) serverItem(id)?.onToggle?.();
}
function onTopic(id, event) {
  if (enabled()) serverItem(id)?.onTopic?.(event.target.value);
}

const addForm = ref(null);
const addDetails = ref(null);
const tls = ref(false);
const submitting = ref(false);
// A failed add, shown beside the form until the next paint; the layer
// records it too, so the paint after carries its own error.
const addError = ref('');
watch(
  () => props.paint,
  () => {
    addError.value = '';
  },
);
const serverError = (servers) => addError.value || servers.error || '';

async function onAdd() {
  const form = addForm.value;
  const add = current()?.servers?.onAdd;
  if (!form || typeof add !== 'function' || submitting.value) return;
  const value = (name) => form.elements?.[name]?.value ?? '';
  submitting.value = true;
  try {
    await add({
      name: value('name'),
      host: value('host'),
      port: value('port'),
      tls: tls.value,
      username: value('username'),
      password: value('password'),
      topic: value('topic'),
      keys: value('keys'),
    });
    form.reset();
    tls.value = false;
    if (addDetails.value) addDetails.value.open = false;
  } catch (err) {
    addError.value = err?.message || t('Could not add the server');
  } finally {
    submitting.value = false;
  }
}

const FIELDS = [
  { name: 'name', label: () => t('NAME'), placeholder: () => t('My mesh') },
  // i18n-ignore: an MQTT broker's own field name
  { name: 'host', label: () => 'HOST', placeholder: () => 'mqtt.example.org' },
  {
    name: 'port',
    // i18n-ignore: an MQTT broker's own field name
    label: () => 'PORT',
    placeholder: () => '1883',
    type: 'number',
  },
  { name: 'tls' },
  { name: 'username', label: () => t('USER') },
  { name: 'password', label: () => t('PASS'), type: 'password' },
  // i18n-ignore: an example MQTT topic
  { name: 'topic', label: () => t('TOPIC'), placeholder: () => 'msh/US/#' },
  {
    name: 'keys',
    label: () => t('KEYS'),
    placeholder: () => t('optional channel keys (base64), comma separated'),
    title: () =>
      t(
        'The default public channel key is always tried. Add a key here to read a private channel you have the key for.',
      ),
  },
];
</script>

<template>
  <div
    ref="root"
    class="data-fork-controls"
    :data-paint="paint"
    style="display: contents"
    ><div v-if="controls?.ramp" class="data-toggle-ramp"
      ><div
        class="data-toggle-ramp-bar"
        role="img"
        :style="{ background: controls.ramp.gradient }"
        :aria-label="rampLabel(controls.ramp)"
      ></div
      ><div class="data-toggle-ramp-ticks"
        ><span
          v-for="(tick, index) in controls.ramp.ticks"
          :key="index"
          :style="{ left: `${(tick.position * 100).toFixed(2)}%` }"
          >{{ tick.label }}</span
        ></div
      ><div class="data-toggle-ramp-caption">{{
        controls.ramp.caption
      }}</div></div
    ><label
      v-for="slider in controls?.sliders || []"
      :key="`slider-${slider.id}`"
      class="data-fork-slider"
      :data-slider-id="slider.id"
      ><span class="data-fork-slider-name">{{ slider.label }}</span
      ><UiSlider
        class="data-fork-slider-input"
        unstyled
        :data-slider-id="slider.id"
        :min="slider.min"
        :max="slider.max"
        :step="slider.step"
        :model-value="slider.value"
        hold
        :aria-label="slider.label"
        @update:model-value="(value) => onSlider(slider.id, value)"
        @blur="endDrag(slider.id)"
      /><span class="data-fork-slider-value">{{
        sliderText(slider)
      }}</span></label
    ><label
      v-for="select in controls?.selects || []"
      :key="`select-${select.id}`"
      class="data-toggle-select"
      :data-select-id="select.id"
      :title="select.title || ''"
      ><span class="data-toggle-select-name">{{ select.label }}</span
      ><UiSelect
        class="data-toggle-select-input"
        :data-select-id="select.id"
        :options="select.options"
        :model-value="select.value"
        hold
        :aria-label="select.label"
        @update:model-value="(value) => onSelect(select.id, value)" /></label
    ><label
      v-for="text in controls?.texts || []"
      :key="`text-${text.id}`"
      class="data-toggle-text"
      :data-text-id="text.id"
      :title="text.title || ''"
      ><span class="data-toggle-text-name">{{ text.label }}</span
      ><input
        v-field-value="text.value"
        type="text"
        class="data-toggle-text-input"
        :data-text-id="text.id"
        autocomplete="off"
        spellcheck="false"
        :placeholder="text.placeholder || ''"
        :aria-label="text.label"
        @change="(event) => onText(text.id, event)" /></label
    ><div v-if="controls?.servers" class="data-servers"
      ><div class="data-servers-heading">{{
        controls.servers.heading || ''
      }}</div
      ><div class="data-server-list"
        ><div
          v-for="item in controls.servers.items || []"
          :key="item.id"
          class="data-server"
          :data-server-id="item.id"
          ><UiButton
            class="data-server-remove"
            :label="item.removeLabel || t('Delete server')"
            @click="onRemove(item.id)"
            >✕</UiButton
          ><div class="data-server-body"
            ><div class="data-server-name" :title="item.title || ''">{{
              item.name
            }}</div
            ><div
              class="data-server-status"
              :data-state="item.status || 'off'"
              >{{ item.statusText }}</div
            ><input
              v-field-value="item.topic"
              type="text"
              class="data-server-topic"
              autocomplete="off"
              spellcheck="false"
              :title="t('MQTT topic filter, e.g. msh/US/# or msh/US/AL/#')"
              :aria-label="t('{name} topic', { name: item.name })"
              @change="(event) => onTopic(item.id, event)" /></div
          ><UiSwitch
            class="data-server-toggle"
            :checked="Boolean(item.enabled)"
            :label="t('Listen to {name}', { name: item.name })"
            @change="onToggle(item.id)" /></div></div
      ><details ref="addDetails" class="data-server-add"
        ><summary>{{ t('+ ADD SERVER') }}</summary
        ><form
          ref="addForm"
          class="data-server-form"
          novalidate
          @submit.prevent="onAdd"
          ><template v-for="field in FIELDS" :key="field.name"
            ><UiCheckbox
              v-if="field.name === 'tls'"
              v-model="tls"
              class="data-server-field data-server-check"
              :input-attrs="{ name: 'tls' }"
              ><span>TLS<!-- i18n-ignore: protocol name --></span></UiCheckbox
            ><label v-else class="data-server-field" :title="field.title?.()"
              ><span>{{ field.label() }}</span
              ><input
                :name="field.name"
                :type="field.type || 'text'"
                autocomplete="off"
                spellcheck="false"
                :placeholder="field.placeholder?.()" /></label></template
          ><UiButton
            type="submit"
            class="data-server-add-submit"
            :disabled="submitting"
            :native-title="false"
            >{{ t('ADD') }}</UiButton
          ></form
        ></details
      ><div
        class="data-server-error"
        role="alert"
        :hidden="!serverError(controls.servers)"
        >{{ serverError(controls.servers) }}</div
      ></div
    ></div
  >
</template>
