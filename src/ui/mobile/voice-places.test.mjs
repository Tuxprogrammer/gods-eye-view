import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canWebShare,
  classifySearchOutcome,
  cleanCityLine,
  cleanPoiLine,
  placesSummary,
} from './places-helpers.js';
import {
  fabLabel,
  isSessionBusy,
  statusWord,
  voiceSupport,
} from './voice-support.js';

test('city and poi lines drop prefixes and placeholders', () => {
  assert.equal(cleanCityLine('📍 Location: Tokyo'), 'Tokyo');
  assert.equal(cleanCityLine('📍 Location: --'), '');
  assert.equal(cleanPoiLine('Landmark: Eiffel Tower'), 'Eiffel Tower');
  assert.equal(cleanPoiLine('Landmark: --'), '');
});

test('placesSummary composes the tile line', () => {
  assert.equal(
    placesSummary('📍 Location: Paris', 'Landmark: Louvre'),
    'Paris - Louvre',
  );
  assert.equal(placesSummary('📍 Location: Paris', 'Landmark: --'), 'Paris');
  assert.equal(
    placesSummary('📍 Location: --', 'Landmark: --'),
    'Search or pick a city',
  );
});

test('classifySearchOutcome reads the toast, else reports success', () => {
  assert.equal(classifySearchOutcome('Location not found', '').kind, 'error');
  assert.equal(classifySearchOutcome('Search failed', '').kind, 'error');
  const ok = classifySearchOutcome('', '📍 Location: Oslo');
  assert.equal(ok.kind, 'ok');
  assert.match(ok.text, /Oslo/);
});

test('canWebShare needs navigator.share', () => {
  assert.equal(canWebShare({ share() {} }), true);
  assert.equal(canWebShare({}), false);
});

test('voiceSupport flags insecure contexts and missing APIs', () => {
  const insecure = voiceSupport({ isSecureContext: false, navigator: {} });
  assert.equal(insecure.ok, false);
  assert.equal(insecure.reason, 'insecure');
  assert.match(insecure.message, /https/);
  const noMedia = voiceSupport({ isSecureContext: true, navigator: {} });
  assert.equal(noMedia.reason, 'no-media');
  const noRtc = voiceSupport({
    isSecureContext: true,
    navigator: { mediaDevices: {} },
  });
  assert.equal(noRtc.reason, 'no-webrtc');
  const ok = voiceSupport({
    isSecureContext: true,
    navigator: { mediaDevices: {} },
    RTCPeerConnection: function () {},
  });
  assert.equal(ok.ok, true);
});

test('voice labels and status words', () => {
  assert.equal(statusWord('listening'), 'Listening');
  assert.equal(statusWord('nonsense'), 'Off');
  assert.equal(isSessionBusy('connecting'), true);
  assert.equal(isSessionBusy('idle'), false);
  assert.match(fabLabel('idle'), /tap to start/);
  assert.match(fabLabel('listening'), /tap to stop/);
  assert.match(fabLabel('idle', { ok: false }), /unavailable/);
});
