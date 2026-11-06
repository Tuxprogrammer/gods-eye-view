<script setup>
import { onBeforeUnmount, onMounted, onUpdated, ref } from 'vue';
import {
  bindForkRowControls,
  syncForkRowControls,
} from '../forkRowControls.js';

// Host for this fork's own row controls (colour ramp, sliders, dropdowns,
// text filters, the Meshtastic server list). forkRowControls.js builds and
// reconciles them in place, so a value being typed or a slider being dragged
// is never rewritten; Vue owns only this element, never its children.
// `display: contents` keeps each control a flex item of the row's
// `.data-toggle-controls`, as before the panel moved to Vue.
const props = defineProps({
  layerId: { type: String, required: true },
  // The layer's live descriptor at this paint.
  controls: { type: Object, default: null },
  // Re-read the live descriptor and the layer's on/off state at event time.
  live: { type: Function, required: true },
  isEnabled: { type: Function, required: true },
  // Changes on every paint, so each paint re-syncs.
  paint: { type: Number, default: 0 },
});

const host = ref(null);
const removers = [];

onMounted(() => {
  const element = host.value;
  bindForkRowControls({
    bind: (type, listener) => {
      element.addEventListener(type, listener);
      removers.push(() => element.removeEventListener(type, listener));
    },
    live: () => props.live(props.layerId),
    isEnabled: () => props.isEnabled(props.layerId),
  });
  syncForkRowControls(element, props.controls);
});

onUpdated(() => {
  if (host.value) syncForkRowControls(host.value, props.controls);
});

onBeforeUnmount(() => {
  for (const remove of removers.splice(0)) remove();
});
</script>

<template>
  <div
    ref="host"
    class="data-fork-controls"
    :data-paint="paint"
    style="display: contents"
  ></div>
</template>
