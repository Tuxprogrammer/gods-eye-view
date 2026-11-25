import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { installVueDom } from '../../testSupport/vueDom.mjs';

let uninstall;
let keepVoiceOutOfDockLayout;
let holdRootClass;
before(async () => {
  uninstall = installVueDom();
  ({ keepVoiceOutOfDockLayout } = await import('./pages/voice.js'));
  ({ holdRootClass } = await import('../rail/rootClass.js'));
});
after(() => uninstall());

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('the dock layout never takes the phone FAB for a voice control in the dock', async () => {
  const html = document.documentElement;
  html.dataset.ui = 'mobile';
  // The dock's VoiceControl holds the class before the FAB adopts it...
  const release = holdRootClass(document, 'dock-has-voice');
  assert.ok(html.classList.contains('dock-has-voice'));
  const stop = keepVoiceOutOfDockLayout(document);
  assert.equal(html.classList.contains('dock-has-voice'), false);
  // ...and a remount that takes it again is undone too.
  release();
  const again = holdRootClass(document, 'dock-has-voice');
  await settle();
  assert.equal(html.classList.contains('dock-has-voice'), false);
  // Other root classes are left alone.
  html.classList.add('has-omnibar');
  await settle();
  assert.ok(html.classList.contains('has-omnibar'));
  stop();
  again();
  html.classList.remove('has-omnibar');
  delete html.dataset.ui;
});

test('back on the desktop UI the dock layout returns once the dock has its voice control again', async () => {
  const html = document.documentElement;
  html.dataset.ui = 'mobile';
  const dock = document.createElement('div');
  dock.id = 'command-dock';
  const control = document.createElement('div');
  control.id = 'gev-voice-control';
  dock.append(control);
  document.body.append(dock);
  const release = holdRootClass(document, 'dock-has-voice');
  const stop = keepVoiceOutOfDockLayout(document);
  // The phone UI moves the control out of the dock to be the mic FAB.
  document.body.append(control);
  assert.equal(html.classList.contains('dock-has-voice'), false);
  html.dataset.ui = 'desktop';
  await settle();
  assert.equal(
    html.classList.contains('dock-has-voice'),
    false,
    'not before the control is back in the dock',
  );
  dock.append(control);
  await settle();
  assert.ok(
    html.classList.contains('dock-has-voice'),
    'the desktop layout is back',
  );
  html.dataset.ui = 'mobile';
  await settle();
  assert.equal(html.classList.contains('dock-has-voice'), false);
  stop();
  release();
  control.remove();
  dock.remove();
  delete html.dataset.ui;
});

test('a voice control left outside the dock, or a class the dock let go of, is not put back', async () => {
  const html = document.documentElement;
  html.dataset.ui = 'mobile';
  const dock = document.createElement('div');
  dock.id = 'command-dock';
  document.body.append(dock);
  const leftover = document.createElement('div');
  leftover.id = 'gev-voice-control';
  document.body.append(leftover);
  const release = holdRootClass(document, 'dock-has-voice');
  const stop = keepVoiceOutOfDockLayout(document);
  assert.equal(html.classList.contains('dock-has-voice'), false);
  // The dock's session ends; a detached copy of its control stays in <body>.
  release();
  html.dataset.ui = 'desktop';
  await settle();
  dock.append(document.createElement('div'));
  await settle();
  assert.equal(html.classList.contains('dock-has-voice'), false);
  // On desktop, the dock's own hold and release are left alone.
  const again = holdRootClass(document, 'dock-has-voice');
  assert.ok(html.classList.contains('dock-has-voice'));
  again();
  await settle();
  assert.equal(html.classList.contains('dock-has-voice'), false);
  stop();
  leftover.remove();
  dock.remove();
  delete html.dataset.ui;
});
