import test from 'node:test';
import assert from 'node:assert/strict';
import { bindRenderer } from '../render/rendererOf.js';
import { FORK_START_VIEW, flyToForkStart } from './startupFlight.js';

function sceneRecording() {
  const calls = { views: [], flights: [], cancelled: 0, flightsCancelled: 0 };
  const host = { isDestroyed: () => false };
  bindRenderer(host, {
    camera: {
      setView(view) {
        calls.views.push(view);
      },
      flyTo(destination, options) {
        calls.flights.push({ destination, options });
        return {
          done: Promise.resolve('complete'),
          cancel() {
            calls.flightsCancelled++;
          },
        };
      },
      cancelFlight() {
        calls.cancelled++;
      },
    },
  });
  return { host, calls };
}

test('the fork starts high over Huntsville, then flies down to it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { host, calls } = sceneRecording();
  flyToForkStart(host);
  assert.equal(calls.views.length, 1);
  assert.equal(calls.views[0].destination.lon, FORK_START_VIEW.lon);
  assert.equal(calls.views[0].destination.lat, FORK_START_VIEW.lat);
  assert.ok(calls.views[0].destination.height > FORK_START_VIEW.height);
  assert.equal(calls.flights.length, 0);
  t.mock.timers.tick(500);
  assert.equal(calls.flights.length, 1);
  const { destination, options } = calls.flights[0];
  assert.deepEqual(destination, {
    lon: FORK_START_VIEW.lon,
    lat: FORK_START_VIEW.lat,
    height: FORK_START_VIEW.height,
  });
  assert.ok(Math.abs(options.orientation.pitch - (-22 * Math.PI) / 180) < 1e-9);
});

test('teardown before the delay prevents a late flight', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { host, calls } = sceneRecording();
  const stop = flyToForkStart(host);
  stop();
  t.mock.timers.tick(1000);
  assert.equal(calls.flights.length, 0);
  assert.equal(calls.cancelled, 1);
});

test('teardown during the flight cancels it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { host, calls } = sceneRecording();
  const stop = flyToForkStart(host);
  t.mock.timers.tick(500);
  stop();
  assert.equal(calls.flightsCancelled, 1);
});
