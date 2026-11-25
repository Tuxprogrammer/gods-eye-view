// Fork-owned row control kinds for the layer panel: colour ramps, sliders,
// dropdowns, text filters and the Meshtastic server list, drawn by
// src/ui/layerPanel/ForkRowControls.vue. Kept out of layerPanel.js so
// upstream merges touch only the one call into here.

const KINDS = ['ramp', 'sliders', 'selects', 'texts', 'servers'];

/**
 * Whether a descriptor carries any fork control, which keeps the row's
 * controls container visible even with no chips, legend or info.
 * @param {object|null} controls The layer's live row-control descriptor.
 */
export function hasForkRowControls(controls) {
  return KINDS.some((kind) => {
    const value = controls?.[kind];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}
