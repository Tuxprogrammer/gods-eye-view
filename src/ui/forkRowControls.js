// Fork-owned row control kinds for the layer panel: colour ramps, sliders,
// dropdowns, text filters and the Meshtastic server list. Kept out of
// layerPanel.js so upstream merges touch only the three calls into here.
import { t } from '../i18n/index.js';

const KINDS = ['ramp', 'sliders', 'selects', 'texts', 'servers'];

/** Class test over `className`, which every element (and test double) carries. */
function hasClass(node, name) {
  return String(node?.className ?? '')
    .split(/\s+/)
    .includes(name);
}

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

/**
 * Attach the delegated listeners for the fork's controls, once per row.
 * `bind` attaches to the row's `.data-toggle-controls` node and registers the
 * removal with the panel; `live` re-reads the layer's current descriptor.
 * @param {{bind: (type: string, listener: Function) => void,
 *   live: () => object|null, isEnabled: () => boolean}} row
 */
export function bindForkRowControls({ bind, live, isEnabled }) {
  // Sliders (opacity and the like) report continuous input; the live
  // descriptor is re-read so a stale row can never drive a dead slider.
  bind('input', (event) => {
    const input = event.target?.closest?.('.data-toggle-slider-input');
    if (!input || !isEnabled()) return;
    const slider = live()?.sliders?.find(
      (entry) => entry.id === input.dataset.sliderId,
    );
    if (!slider) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    const output = input.parentElement?.querySelector?.(
      '.data-toggle-slider-value',
    );
    if (output) output.textContent = `${value}${slider.suffix || ''}`;
    slider.onInput?.(value);
  });
  // Dropdowns and text filters commit on `change` (a choice made, or Enter
  // / blur), so typing never refetches per keystroke.
  bind('change', (event) => {
    const field = event.target?.closest?.(
      '.data-toggle-select-input, .data-toggle-text-input',
    );
    if (!field || !isEnabled()) return;
    const current = live();
    if (hasClass(field, 'data-toggle-select-input')) {
      current?.selects
        ?.find((entry) => entry.id === field.dataset.selectId)
        ?.onChange?.(field.value);
    } else {
      current?.texts
        ?.find((entry) => entry.id === field.dataset.textId)
        ?.onCommit?.(field.value);
    }
  });
  // A layer with a list of servers (Meshtastic MQTT): switch, delete,
  // retopic and add. Each reads the live descriptor, like the chips above.
  bind('click', (event) => {
    if (!isEnabled()) return;
    const target = event.target;
    const item = (node) =>
      live()?.servers?.items?.find(
        (entry) =>
          entry.id === node?.closest?.('.data-server')?.dataset?.serverId,
      );
    const remove = target?.closest?.('.data-server-remove');
    if (remove) return void item(remove)?.onRemove?.();
    const toggle = target?.closest?.('.data-server-toggle');
    if (toggle) return void item(toggle)?.onToggle?.();
  });
  bind('change', (event) => {
    const field = event.target?.closest?.('.data-server-topic');
    if (!field || !isEnabled()) return;
    live()
      ?.servers?.items?.find(
        (item) => item.id === field.closest('.data-server')?.dataset?.serverId,
      )
      ?.onTopic?.(field.value);
  });
  bind('submit', (event) => {
    const form = event.target?.closest?.('.data-server-form');
    if (!form) return;
    event.preventDefault();
    void submitServerForm(form, () => live()?.servers?.onAdd);
  });
}

/**
 * Reconcile the fork's controls after the chips, legend and info node.
 * @param {HTMLElement} container The row's `.data-toggle-controls` node.
 * @param {object|null} controls The layer's live row-control descriptor.
 */
export function syncForkRowControls(container, controls) {
  syncRamp(container, controls?.ramp || null);
  syncSliders(container, controls?.sliders || []);
  syncSelects(container, controls?.selects || []);
  syncTexts(container, controls?.texts || []);
  syncServers(container, controls?.servers || null);
}

/**
 * A list of servers, each with a delete button on its left, a name, a status
 * line, an editable topic and an on/off switch, above a collapsed "add
 * server" form. Rows are reconciled in place by id (a topic being typed is
 * never rewritten), and the form is built once so a refresh cannot wipe it.
 * @param {HTMLElement} container The row's `.data-toggle-controls` node.
 * @param {{heading?: string, error?: string|null, items: Array<object>}|null} servers
 */
export function syncServers(container, servers) {
  let block = [...container.children].find((child) =>
    hasClass(child, 'data-servers'),
  );
  if (!servers) {
    block?.remove();
    return;
  }
  if (!block) {
    block = document.createElement('div');
    block.className = 'data-servers';
    const heading = document.createElement('div');
    heading.className = 'data-servers-heading';
    const list = document.createElement('div');
    list.className = 'data-server-list';
    const error = document.createElement('div');
    error.className = 'data-server-error';
    error.setAttribute('role', 'alert');
    block.append(heading, list, buildServerForm(), error);
    container.appendChild(block);
  }
  const [heading, list, , error] = block.children;
  if (heading.textContent !== (servers.heading || ''))
    heading.textContent = servers.heading || '';
  const message = servers.error || '';
  if (error.textContent !== message) error.textContent = message;
  error.hidden = !message;

  const existing = new Map(
    [...list.children].map((node) => [node.dataset.serverId, node]),
  );
  let previous = null;
  for (const item of servers.items || []) {
    let node = existing.get(item.id);
    existing.delete(item.id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'data-server';
      node.dataset.serverId = item.id;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'data-server-remove';
      remove.textContent = '✕';
      const body = document.createElement('div');
      body.className = 'data-server-body';
      const name = document.createElement('div');
      name.className = 'data-server-name';
      const status = document.createElement('div');
      status.className = 'data-server-status';
      const topic = document.createElement('input');
      topic.type = 'text';
      topic.className = 'data-server-topic';
      topic.autocomplete = 'off';
      topic.spellcheck = false;
      body.append(name, status, topic);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'data-server-toggle';
      toggle.setAttribute('role', 'switch');
      node.append(remove, body, toggle);
    }
    const [remove, body, toggle] = node.children;
    const [name, status, topic] = body.children;
    remove.title = item.removeLabel || t('Delete server');
    remove.setAttribute('aria-label', item.removeLabel || t('Delete server'));
    if (name.textContent !== item.name) name.textContent = item.name;
    name.title = item.title || '';
    if (status.textContent !== item.statusText)
      status.textContent = item.statusText;
    status.dataset.state = item.status || 'off';
    topic.title = t('MQTT topic filter, e.g. msh/US/# or msh/US/AL/#');
    topic.setAttribute('aria-label', t('{name} topic', { name: item.name }));
    if (document.activeElement !== topic && topic.value !== item.topic)
      topic.value = item.topic;
    toggle.textContent = item.enabled ? t('ON') : t('OFF');
    toggle.classList.toggle('active', Boolean(item.enabled));
    toggle.setAttribute('aria-checked', item.enabled ? 'true' : 'false');
    toggle.setAttribute(
      'aria-label',
      t('Listen to {name}', { name: item.name }),
    );
    // Keep DOM order in step with descriptor order without rebuilding.
    const anchor = previous ? previous.nextSibling : list.firstChild;
    if (node !== anchor) list.insertBefore(node, anchor);
    previous = node;
  }
  for (const node of existing.values()) node.remove();
}

/** The collapsed "add server" form. Built once; see `_submitServerForm`. */
function buildServerForm() {
  const details = document.createElement('details');
  details.className = 'data-server-add';
  const summary = document.createElement('summary');
  summary.textContent = t('+ ADD SERVER');
  const form = document.createElement('form');
  form.className = 'data-server-form';
  form.noValidate = true;
  const field = (name, label, attrs = {}) => {
    const wrap = document.createElement('label');
    wrap.className = 'data-server-field';
    const caption = document.createElement('span');
    caption.textContent = label;
    const input = document.createElement('input');
    input.name = name;
    input.type = attrs.type || 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (attrs.placeholder) input.placeholder = attrs.placeholder;
    if (attrs.title) wrap.title = attrs.title;
    wrap.append(caption, input);
    return wrap;
  };
  const tls = document.createElement('label');
  tls.className = 'data-server-field data-server-check';
  const tlsInput = document.createElement('input');
  tlsInput.type = 'checkbox';
  tlsInput.name = 'tls';
  const tlsText = document.createElement('span');
  tlsText.textContent = 'TLS'; // i18n-ignore: protocol name
  tls.append(tlsInput, tlsText);
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'data-server-add-submit';
  submit.textContent = t('ADD');
  form.append(
    field('name', t('NAME'), { placeholder: t('My mesh') }),
    field('host', 'HOST', { placeholder: 'mqtt.example.org' }),
    field('port', 'PORT', { placeholder: '1883', type: 'number' }),
    tls,
    field('username', t('USER')),
    field('password', t('PASS'), { type: 'password' }),
    // i18n-ignore: an example MQTT topic
    field('topic', t('TOPIC'), { placeholder: 'msh/US/#' }),
    field('keys', t('KEYS'), {
      placeholder: t('optional channel keys (base64), comma separated'),
      title: t(
        'The default public channel key is always tried. Add a key here to read a private channel you have the key for.',
      ),
    }),
    submit,
  );
  details.append(summary, form);
  return details;
}

/** Send the add form; show the server's reason on failure, reset it on success. */
async function submitServerForm(form, getAdd) {
  const details = form.closest('details');
  const error = details?.parentElement?.querySelector?.('.data-server-error');
  const submit = form.querySelector('.data-server-add-submit');
  const value = (name) => form.elements?.[name]?.value ?? '';
  const onAdd = getAdd();
  if (typeof onAdd !== 'function' || submit?.disabled) return;
  if (submit) submit.disabled = true;
  try {
    await onAdd({
      name: value('name'),
      host: value('host'),
      port: value('port'),
      tls: Boolean(form.elements?.tls?.checked),
      username: value('username'),
      password: value('password'),
      topic: value('topic'),
      keys: value('keys'),
    });
    form.reset();
    if (details) details.open = false;
  } catch (err) {
    // The layer also records this; showing it here keeps it beside the form.
    if (error) {
      error.textContent = err?.message || t('Could not add the server');
      error.hidden = false;
    }
  } finally {
    if (submit) submit.disabled = false;
  }
}

/**
 * A continuous colour scale: gradient bar, value ticks and a caption. Built
 * once and updated in place, since it repaints on every panel refresh.
 * @param {HTMLElement} container The row's `.data-toggle-controls` node.
 * @param {{gradient: string, ticks: Array<{position: number, label: string}>,
 *   caption: string}|null} ramp
 */
export function syncRamp(container, ramp) {
  let node = [...container.children].find((child) =>
    hasClass(child, 'data-toggle-ramp'),
  );
  if (!ramp) {
    node?.remove();
    return;
  }
  if (!node) {
    node = document.createElement('div');
    node.className = 'data-toggle-ramp';
    const bar = document.createElement('div');
    bar.className = 'data-toggle-ramp-bar';
    bar.setAttribute('role', 'img');
    const ticks = document.createElement('div');
    ticks.className = 'data-toggle-ramp-ticks';
    const caption = document.createElement('div');
    caption.className = 'data-toggle-ramp-caption';
    node.append(bar, ticks, caption);
    container.appendChild(node);
  }
  const [bar, ticks, caption] = node.children;
  if (bar.style.background !== ramp.gradient)
    bar.style.background = ramp.gradient;
  const tickKey = JSON.stringify(ramp.ticks);
  if (ticks.dataset.key !== tickKey) {
    ticks.dataset.key = tickKey;
    ticks.replaceChildren(
      ...ramp.ticks.map((tick) => {
        const label = document.createElement('span');
        label.style.left = `${(tick.position * 100).toFixed(2)}%`;
        label.textContent = tick.label;
        return label;
      }),
    );
  }
  if (caption.textContent !== ramp.caption) caption.textContent = ramp.caption;
  bar.setAttribute(
    'aria-label',
    t('{caption}. Scale marks: {marks}', {
      caption: ramp.caption,
      marks: ramp.ticks.map((tick) => tick.label).join(', '),
    }),
  );
}

/**
 * Dropdowns, reconciled in place by id. A select the user has open is never
 * rewritten, so a refresh cannot snap a menu shut under their cursor.
 * @param {HTMLElement} container The row's `.data-toggle-controls` node.
 * @param {Array<{id: string, label: string, value: string, title?: string,
 *   options: Array<{value: string, label: string}>}>} selects
 */
export function syncSelects(container, selects) {
  const existing = new Map(
    [...container.children]
      .filter((child) => hasClass(child, 'data-toggle-select'))
      .map((child) => [child.dataset.selectId, child]),
  );
  for (const select of selects) {
    let label = existing.get(select.id);
    existing.delete(select.id);
    if (!label) {
      label = document.createElement('label');
      label.className = 'data-toggle-select';
      label.dataset.selectId = select.id;
      const name = document.createElement('span');
      name.className = 'data-toggle-select-name';
      const input = document.createElement('select');
      input.className = 'data-toggle-select-input';
      input.dataset.selectId = select.id;
      label.append(name, input);
      container.appendChild(label);
    }
    const [name, input] = label.children;
    if (name.textContent !== select.label) name.textContent = select.label;
    label.title = select.title || '';
    input.setAttribute('aria-label', select.label);
    const key = JSON.stringify(select.options);
    if (input.dataset.optionKey !== key) {
      input.dataset.optionKey = key;
      input.replaceChildren(
        ...select.options.map((option) => {
          const node = document.createElement('option');
          node.value = option.value;
          node.textContent = option.label;
          return node;
        }),
      );
    }
    if (document.activeElement !== input && input.value !== select.value)
      input.value = select.value;
  }
  for (const label of existing.values()) label.remove();
}

/**
 * Text filters, reconciled in place by id. The typed text is never rewritten
 * while the field has focus.
 * @param {HTMLElement} container The row's `.data-toggle-controls` node.
 * @param {Array<{id: string, label: string, value: string,
 *   placeholder?: string, title?: string}>} texts
 */
export function syncTexts(container, texts) {
  const existing = new Map(
    [...container.children]
      .filter((child) => hasClass(child, 'data-toggle-text'))
      .map((child) => [child.dataset.textId, child]),
  );
  for (const text of texts) {
    let label = existing.get(text.id);
    existing.delete(text.id);
    if (!label) {
      label = document.createElement('label');
      label.className = 'data-toggle-text';
      label.dataset.textId = text.id;
      const name = document.createElement('span');
      name.className = 'data-toggle-text-name';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'data-toggle-text-input';
      input.dataset.textId = text.id;
      input.autocomplete = 'off';
      input.spellcheck = false;
      label.append(name, input);
      container.appendChild(label);
    }
    const [name, input] = label.children;
    if (name.textContent !== text.label) name.textContent = text.label;
    label.title = text.title || '';
    input.placeholder = text.placeholder || '';
    input.setAttribute('aria-label', text.label);
    if (document.activeElement !== input && input.value !== text.value)
      input.value = text.value;
  }
  for (const label of existing.values()) label.remove();
}

/**
 * Range sliders, reconciled in place by id. The value is never rewritten
 * while the slider is the active element, so a drag is not fought by the
 * refresh its own input triggers.
 * @param {HTMLElement} container The row's `.data-toggle-controls` node.
 * @param {Array<{id: string, label: string, min: number, max: number,
 *   step: number, value: number, suffix?: string}>} sliders
 */
export function syncSliders(container, sliders) {
  const existing = new Map(
    [...container.children]
      .filter((child) => hasClass(child, 'data-toggle-slider'))
      .map((child) => [child.dataset.sliderId, child]),
  );
  for (const slider of sliders) {
    let label = existing.get(slider.id);
    existing.delete(slider.id);
    if (!label) {
      label = document.createElement('label');
      label.className = 'data-toggle-slider';
      label.dataset.sliderId = slider.id;
      const name = document.createElement('span');
      name.className = 'data-toggle-slider-name';
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'data-toggle-slider-input';
      input.dataset.sliderId = slider.id;
      const value = document.createElement('span');
      value.className = 'data-toggle-slider-value';
      label.append(name, input, value);
      container.appendChild(label);
    }
    const [name, input, value] = label.children;
    if (name.textContent !== slider.label) name.textContent = slider.label;
    input.min = String(slider.min);
    input.max = String(slider.max);
    input.step = String(slider.step);
    if (document.activeElement !== input) input.value = String(slider.value);
    input.setAttribute('aria-label', slider.label);
    const text = `${slider.value}${slider.suffix || ''}`;
    if (document.activeElement !== input && value.textContent !== text)
      value.textContent = text;
  }
  for (const label of existing.values()) label.remove();
}
