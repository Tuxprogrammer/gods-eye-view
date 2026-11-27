import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { installVueDom } from '../../testSupport/vueDom.mjs';

let mount;
let ForkRowControls;
let uninstall;
before(async () => {
  uninstall = installVueDom();
  ({ mount } = await import('@vue/test-utils'));
  ForkRowControls = (await import('./ForkRowControls.vue')).default;
});
after(() => uninstall());

const opacity = (value, extra = {}) => ({
  id: 'opacity',
  label: 'OPACITY',
  min: 10,
  max: 100,
  step: 5,
  value,
  suffix: '%',
  ...extra,
});
const ramp = (ticks = [{ position: 0.5, label: '10' }]) => ({
  gradient: 'linear-gradient(90deg, red, blue)',
  ticks,
  caption: 'MUF (3000 km) · MHz · 4–35 (log)',
});
const server = (id, extra = {}) => ({
  id,
  name: id,
  title: `${id}.example.org:1883`,
  status: 'live',
  statusText: 'Live · 12/min',
  enabled: true,
  topic: 'msh/US/#',
  removeLabel: `Delete ${id}`,
  ...extra,
});

/**
 * The component over a layer whose live descriptor is `state.controls`;
 * `paint(next)` republishes it, as the panel does after a change.
 */
function rowWith(controls, { enabled = true } = {}) {
  const state = { controls, enabled };
  let paint = 0;
  const wrapper = mount(ForkRowControls, {
    attachTo: document.body,
    props: {
      layerId: 'layer',
      controls,
      live: () => state.controls,
      isEnabled: () => state.enabled,
      paint,
    },
  });
  return {
    wrapper,
    state,
    el: wrapper.element,
    async paint(next = state.controls) {
      state.controls = next;
      await wrapper.setProps({ controls: next, paint: ++paint });
    },
  };
}

test('every control is a kit control: no hand-written button, select, checkbox or range', () => {
  const row = rowWith({
    sliders: [opacity(60)],
    selects: [
      {
        id: 'radius',
        label: 'RADIUS',
        value: '50',
        options: [
          { value: '50', label: '50 km' },
          { value: '100', label: '100 km' },
        ],
      },
    ],
    servers: { heading: 'MQTT SERVERS', items: [server('global')] },
  });
  for (const button of row.el.querySelectorAll('button'))
    assert.ok(button.matches('.ui-button, .ui-switch'), button.className);
  assert.ok(row.el.querySelector('.ui-checkbox input[name="tls"]'));
  row.wrapper.unmount();
});

test('a slider shows the descriptor value and follows it, except while it is being dragged', async () => {
  const seen = [];
  const row = rowWith({
    sliders: [opacity(60, { onInput: (value) => seen.push(value) })],
  });
  const labels = () => row.el.querySelectorAll('.data-fork-slider');
  const input = row.el.querySelector('.data-fork-slider-input');
  assert.equal(labels().length, 1);
  assert.equal(input.type, 'range');
  assert.equal(input.value, '60');
  assert.equal(input.dataset.sliderId, 'opacity');
  assert.equal(
    row.el.querySelector('.data-fork-slider-value').textContent,
    '60%',
  );

  await row.paint({ sliders: [opacity(90)] });
  assert.equal(input.value, '90', 'a switched map shows its own setting');
  assert.equal(row.el.querySelector('.data-fork-slider-input'), input);

  const onInput = (value) => seen.push(value);
  row.state.controls = { sliders: [opacity(90, { onInput })] };
  input.focus();
  input.value = '35';
  input.dispatchEvent(new Event('input'));
  assert.deepEqual(seen, [35], 'the live descriptor takes the drag');
  await row.wrapper.vm.$nextTick();
  assert.equal(
    row.el.querySelector('.data-fork-slider-value').textContent,
    '35%',
  );
  await row.paint({ sliders: [opacity(90, { onInput })] });
  assert.equal(input.value, '35', 'a refresh must not fight the drag');
  assert.equal(
    row.el.querySelector('.data-fork-slider-value').textContent,
    '35%',
    'nor its readout',
  );
  input.blur();
  await row.paint({ sliders: [opacity(35, { onInput })] });
  assert.equal(
    row.el.querySelector('.data-fork-slider-value').textContent,
    '35%',
  );

  await row.paint({ sliders: [] });
  assert.equal(labels().length, 0, 'a slider that leaves the descriptor goes');
  row.wrapper.unmount();
});

test('the colour ramp is drawn, updated in place and removed with the layer', async () => {
  const row = rowWith({ ramp: ramp() });
  const nodes = () => row.el.querySelectorAll('.data-toggle-ramp');
  assert.equal(nodes().length, 1);
  const bar = row.el.querySelector('.data-toggle-ramp-bar');
  assert.match(bar.style.background, /linear-gradient/);
  assert.equal(
    row.el.querySelector('.data-toggle-ramp-caption').textContent,
    'MUF (3000 km) · MHz · 4–35 (log)',
  );
  const ticks = () => [
    ...row.el.querySelectorAll('.data-toggle-ramp-ticks span'),
  ];
  assert.equal(ticks().length, 1);
  assert.equal(ticks()[0].style.left, '50.00%');
  assert.match(bar.getAttribute('aria-label'), /Scale marks: 10/);

  await row.paint({
    ramp: ramp([
      { position: 0.1, label: '5' },
      { position: 0.9, label: '30' },
    ]),
  });
  assert.equal(row.el.querySelector('.data-toggle-ramp-bar'), bar);
  assert.deepEqual(
    ticks().map((tick) => tick.textContent),
    ['5', '30'],
  );
  await row.paint({ ramp: null });
  assert.equal(nodes().length, 0);
  row.wrapper.unmount();
});

test('a dropdown and a text filter commit to the live descriptor, never while the layer is off', async () => {
  const picks = [];
  const commits = [];
  const controls = {
    selects: [
      {
        id: 'radius',
        label: 'RADIUS',
        value: '50',
        options: [
          { value: '50', label: '50 km' },
          { value: '100', label: '100 km' },
        ],
        onChange: (value) => picks.push(value),
      },
    ],
    texts: [
      {
        id: 'call',
        label: 'CALL',
        value: 'W4*',
        placeholder: 'all stations',
        onCommit: (value) => commits.push(value),
      },
    ],
  };
  const row = rowWith(controls);
  const select = row.el.querySelector('.data-toggle-select-input');
  const text = row.el.querySelector('.data-toggle-text-input');
  assert.equal(select.value, '50');
  assert.equal(select.getAttribute('aria-label'), 'RADIUS');
  assert.equal(text.value, 'W4*');
  assert.equal(text.placeholder, 'all stations');

  select.value = '100';
  select.dispatchEvent(new Event('change'));
  text.value = 'KQ4VYY-9';
  text.dispatchEvent(new Event('change'));
  assert.deepEqual(picks, ['100']);
  assert.deepEqual(commits, ['KQ4VYY-9']);

  text.focus();
  text.value = 'typing';
  await row.paint(controls);
  assert.equal(text.value, 'typing', 'what is being typed is kept');
  text.blur();

  row.state.enabled = false;
  select.value = '50';
  select.dispatchEvent(new Event('change'));
  text.dispatchEvent(new Event('change'));
  assert.deepEqual(picks, ['100']);
  assert.deepEqual(commits, ['KQ4VYY-9']);
  row.wrapper.unmount();
});

test('the server list keeps the delete button first and follows the descriptor order', async () => {
  const row = rowWith({
    servers: {
      heading: 'MQTT SERVERS',
      items: [server('global'), server('almesh')],
    },
  });
  const ids = () =>
    [...row.el.querySelectorAll('.data-server')].map((n) => n.dataset.serverId);
  assert.equal(
    row.el.querySelector('.data-servers-heading').textContent,
    'MQTT SERVERS',
  );
  assert.deepEqual(ids(), ['global', 'almesh']);
  const [remove, body, toggle] = row.el.querySelector('.data-server').children;
  assert.ok(remove.classList.contains('data-server-remove'));
  assert.equal(remove.getAttribute('aria-label'), 'Delete global');
  assert.ok(toggle.classList.contains('ui-switch'));
  assert.equal(toggle.getAttribute('role'), 'switch');
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.equal(body.querySelector('.data-server-topic').value, 'msh/US/#');
  const form = row.el.querySelector('.data-server-add');
  assert.equal(row.el.querySelector('.data-server-error').hidden, true);

  await row.paint({
    servers: {
      heading: 'MQTT SERVERS',
      items: [
        server('almesh', { enabled: false, statusText: 'Off', status: 'off' }),
        server('mine'),
      ],
      error: 'nope',
    },
  });
  assert.equal(
    row.el.querySelector('.data-server-add'),
    form,
    'the add form survives refreshes',
  );
  assert.deepEqual(ids(), ['almesh', 'mine']);
  const first = row.el.querySelector('.data-server');
  const serverSwitch = first.querySelector('.data-server-toggle');
  assert.equal(serverSwitch.getAttribute('role'), 'switch');
  assert.equal(serverSwitch.getAttribute('aria-checked'), 'false');
  assert.equal(serverSwitch.getAttribute('aria-label'), 'Listen to almesh');
  assert.equal(first.querySelector('.data-server-status').dataset.state, 'off');
  const error = row.el.querySelector('.data-server-error');
  assert.equal(error.textContent, 'nope');
  assert.equal(error.hidden, false);

  await row.paint(null);
  assert.equal(row.el.querySelector('.data-servers'), null);
  row.wrapper.unmount();
});

test('delete, switch and retopic act on the live server, and a typed topic survives a refresh', async () => {
  const calls = [];
  const item = server('global', {
    onRemove: () => calls.push('remove'),
    onToggle: () => calls.push('toggle'),
    onTopic: (topic) => calls.push(`topic ${topic}`),
  });
  const controls = { servers: { items: [item] } };
  const row = rowWith(controls);
  row.el.querySelector('.data-server-remove').click();
  row.el.querySelector('.data-server-toggle').click();
  const topic = row.el.querySelector('.data-server-topic');
  topic.focus();
  topic.value = 'msh/US/AL/#';
  await row.paint({ servers: { items: [{ ...item }] } });
  assert.equal(topic.value, 'msh/US/AL/#');
  topic.dispatchEvent(new Event('change'));
  assert.deepEqual(calls, ['remove', 'toggle', 'topic msh/US/AL/#']);

  row.state.enabled = false;
  row.el.querySelector('.data-server-remove').click();
  assert.equal(calls.length, 3, 'a layer turned off takes no action');
  row.wrapper.unmount();
});

test('adding a server sends the form, resets it on success and shows the reason on failure', async () => {
  const sent = [];
  let refuse = null;
  const controls = {
    servers: {
      items: [],
      onAdd: async (fields) => {
        sent.push(fields);
        if (refuse) throw new Error(refuse);
      },
    },
  };
  const row = rowWith(controls);
  const details = row.el.querySelector('.data-server-add');
  const form = row.el.querySelector('.data-server-form');
  details.open = true;
  form.elements.host.value = 'mqtt.example.org';
  form.elements.port.value = '8883';
  form.elements.topic.value = 'msh/US/#';
  const tls = form.querySelector('input[name="tls"]');
  tls.checked = true;
  tls.dispatchEvent(new Event('change'));
  await row.wrapper.vm.$nextTick();
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await row.wrapper.vm.$nextTick();
  assert.deepEqual(sent, [
    {
      name: '',
      host: 'mqtt.example.org',
      port: '8883',
      tls: true,
      username: '',
      password: '',
      topic: 'msh/US/#',
      keys: '',
    },
  ]);
  assert.equal(form.elements.host.value, '', 'the form is reset');
  assert.equal(tls.checked, false);
  assert.equal(details.open, false, 'and folded away');

  refuse = 'Broker refused the login';
  details.open = true;
  form.elements.host.value = 'bad.example.org';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await row.wrapper.vm.$nextTick();
  const error = row.el.querySelector('.data-server-error');
  assert.equal(error.textContent, 'Broker refused the login');
  assert.equal(error.hidden, false);
  assert.equal(
    form.elements.host.value,
    'bad.example.org',
    'a refused form is kept',
  );
  assert.equal(
    row.el.querySelector('.data-server-add-submit').disabled,
    false,
    'the button comes back',
  );
  row.wrapper.unmount();
});

test('a slider dragged without focus shows the descriptor again on the next paint', async () => {
  // WebKit and macOS Firefox do not focus a range input they drag.
  const onInput = () => {};
  const row = rowWith({ sliders: [opacity(60, { onInput })] });
  const input = row.el.querySelector('.data-fork-slider-input');
  const readout = () =>
    row.el.querySelector('.data-fork-slider-value').textContent;
  input.value = '35';
  input.dispatchEvent(new Event('input'));
  await row.wrapper.vm.$nextTick();
  assert.equal(readout(), '35%');
  await row.paint({ sliders: [opacity(80, { onInput })] });
  assert.equal(input.value, '80');
  assert.equal(
    readout(),
    '80%',
    'the readout follows the thumb, not the old drag',
  );
  row.state.enabled = false;
  const seen = [];
  row.state.controls = {
    sliders: [opacity(80, { onInput: (v) => seen.push(v) })],
  };
  input.value = '20';
  input.dispatchEvent(new Event('input'));
  assert.deepEqual(seen, [], 'a layer turned off takes no slider input');
  row.wrapper.unmount();
});

test('the add form stays open across paints, blocks a second submit and clears its error on the next paint', async () => {
  let finish;
  const sent = [];
  const controls = {
    servers: {
      items: [],
      onAdd: (fields) => {
        sent.push(fields);
        return new Promise((resolve, reject) => {
          finish = { resolve, reject };
        });
      },
    },
  };
  const row = rowWith(controls);
  const details = row.el.querySelector('.data-server-add');
  const form = row.el.querySelector('.data-server-form');
  const submit = () => row.el.querySelector('.data-server-add-submit');
  details.open = true;
  await row.paint(controls);
  assert.equal(details.open, true, 'a paint does not fold the form');
  assert.deepEqual(
    [...form.elements].map((field) => field.name).filter(Boolean),
    ['name', 'host', 'port', 'tls', 'username', 'password', 'topic', 'keys'],
    'the field order the grid CSS places',
  );
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await row.wrapper.vm.$nextTick();
  assert.equal(submit().disabled, true, 'busy while the server answers');
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(sent.length, 1, 'a second submit waits');
  finish.reject(new Error('refused'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await row.wrapper.vm.$nextTick();
  assert.equal(
    row.el.querySelector('.data-server-error').textContent,
    'refused',
  );
  assert.equal(submit().disabled, false);
  await row.paint(controls);
  const error = row.el.querySelector('.data-server-error');
  assert.equal(error.textContent, '');
  assert.equal(
    error.hidden,
    true,
    'the next paint carries the layer’s own error',
  );
  row.wrapper.unmount();
});

test('the delete button shows its name as a tip; the switch and the add button do not', () => {
  const row = rowWith({ servers: { items: [server('global')] } });
  assert.equal(
    row.el.querySelector('.data-server-remove').getAttribute('title'),
    'Delete global',
  );
  assert.equal(
    row.el.querySelector('.data-server-toggle').hasAttribute('title'),
    false,
  );
  assert.equal(
    row.el.querySelector('.data-server-add-submit').hasAttribute('title'),
    false,
  );
  row.wrapper.unmount();
});
