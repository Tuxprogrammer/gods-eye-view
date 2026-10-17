// This fork's local voice gateway is free: its sessions meter at zero and
// never trip the spend cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceCostTracker } from './voiceCost.js';

/** A representative `response.done` usage payload with full modality detail. */
const FULL_USAGE = Object.freeze({
  total_tokens: 1500,
  input_tokens: 1000,
  output_tokens: 500,
  input_token_details: {
    cached_tokens: 200,
    text_tokens: 400,
    audio_tokens: 600,
    image_tokens: 0,
    cached_tokens_details: {
      text_tokens: 100,
      audio_tokens: 100,
      image_tokens: 0,
    },
  },
  output_token_details: { text_tokens: 100, audio_tokens: 400 },
});

test('a local gateway session is metered at zero and never as an unknown model', () => {
  const tracker = createVoiceCostTracker({
    modelId: 'gev-voice',
    tier: 'standard',
    limits: { warnUsd: 0.01, capUsd: 0.02 },
    local: true,
  });
  assert.equal(tracker.model.id, 'gev-voice');
  assert.equal(tracker.model.label, 'LOCAL');
  let state;
  for (let i = 0; i < 50; i += 1) state = tracker.record(FULL_USAGE);
  assert.equal(state.totalUsd, 0);
  assert.equal(state.ratesRecognized, true);
  assert.equal(state.capReached, false, 'a free session never trips the cap');
  assert.equal(state.level, 'ok');
});
