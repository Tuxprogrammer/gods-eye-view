/**
 * @module ui/forkKit
 * @description Fork: the kit's controls (src/ui/kit) for this fork's
 * imperative modules, which build their DOM in script (the phone UI, the
 * propagation station card). A control is rendered once by Vue and handed
 * back as a plain element; the caller places it, listens on it and updates
 * its attributes in place, as it would any element it made. Upstream's
 * imperative modules render their kit controls the same way (`h` and
 * `render`, e.g. src/ui/quebecCctvOverlay.js).
 */
import { h, render } from 'vue';
import UiButton from './kit/UiButton.vue';
import UiCloseButton from './kit/UiCloseButton.vue';
import UiIcon from './kit/UiIcon.vue';

/**
 * A kit component's root element, rendered on its own.
 * @param {object} component A kit component.
 * @param {object} [props] Its props and attributes (`class`, `id`, `aria-*`).
 * @param {string|Function} [content] Its default slot: text, or a render
 *   function returning vnodes.
 * @returns {HTMLElement}
 */
export function kitElement(component, props = {}, content) {
  const host = document.createElement('div');
  const slot =
    content == null
      ? undefined
      : typeof content === 'function'
        ? { default: content }
        : { default: () => content };
  render(h(component, props, slot), host);
  const element = host.firstElementChild;
  element.remove();
  return element;
}

/**
 * A kit button (ghost unless `variant` says otherwise). `label` is its
 * accessible name; with `nativeTitle` false it is not shown as a tip.
 */
export const kitButton = (props, content) =>
  kitElement(UiButton, { nativeTitle: false, ...props }, content);

/** The kit's close button, drawing a bare ×; `label` names it. */
export const kitCloseButton = (props) => kitElement(UiCloseButton, props);

/** A Material Symbols glyph, sized by the caller's CSS. */
export const kitIcon = (name, props = {}) =>
  kitElement(UiIcon, { name, size: null, ...props });

/** `h`, for a button's content (the phone menu button's bars). */
export { h };
