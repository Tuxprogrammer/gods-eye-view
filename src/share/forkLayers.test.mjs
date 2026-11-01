// The fork's layers in compact share codes. Their tokens (zx, zy, zz) sit at
// the far end of the two-character space so upstream's allocator never takes
// them, and the code stores enabled layers as a bitset indexed by token
// number, so any fork layer adds a ~167-byte bitset tail. Links still work;
// this pins the cost so a codec or token change is noticed either way.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultShareViewState,
  decodeShareView,
  encodeShareView,
} from './viewCodec.js';
import { FORK_LAYER_IDS } from '../testSupport/fork.mjs';

const code = (ids) =>
  encodeShareView({
    ...createDefaultShareViewState(),
    layerState: { enabledLayerIds: ids, options: {} },
  });

test('fork layers round-trip through a compact share code', () => {
  for (const ids of [
    ...FORK_LAYER_IDS.map((id) => [id]),
    ['flights', ...FORK_LAYER_IDS],
  ]) {
    const decoded = decodeShareView(code(ids));
    assert.equal(decoded.ok, true, ids.join());
    assert.deepEqual(
      [...decoded.state.layerState.enabledLayerIds].sort(),
      [...ids].sort(),
    );
  }
});

test('a fork layer costs a fixed bitset tail, not one per layer', () => {
  const upstreamOnly = code(['flights']).length;
  const withFork = code(['flights', 'aprs']).length;
  const allFork = code(['flights', ...FORK_LAYER_IDS]).length;
  assert.ok(upstreamOnly < 20, `${upstreamOnly}`);
  assert.equal(allFork, withFork, 'the tail is shared by all three');
  assert.ok(withFork - upstreamOnly <= 230, `${withFork - upstreamOnly}`);
});
