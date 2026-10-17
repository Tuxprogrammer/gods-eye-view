import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admitSameSiteRequest,
  parsePublicOrigins,
} from './localRequestGate.mjs';

// GEV_PUBLIC_ORIGINS: this fork's opt-in for a TLS-terminating reverse proxy.
const proxied = {
  hostHeader: 'docker.example:4173',
  protocol: 'http:',
  origin: 'https://gev.example',
  secFetchSite: 'same-origin',
};
const publicOrigins = ['https://gev.example'];

test('behind a TLS proxy the public Origin never matches the app authority by default', () => {
  assert.equal(admitSameSiteRequest(proxied).ok, false);
  const forwarded = { 'x-forwarded-for': '10.0.0.2' };
  assert.equal(
    admitSameSiteRequest({ ...proxied, proxyHeaders: forwarded }).ok,
    false,
  );
});

test('a configured public Origin is admitted, with or without proxy headers', () => {
  assert.equal(admitSameSiteRequest({ ...proxied, publicOrigins }).ok, true);
  assert.equal(
    admitSameSiteRequest({
      ...proxied,
      publicOrigins,
      proxyHeaders: { 'x-forwarded-for': '10.0.0.2' },
    }).ok,
    true,
  );
});

test('public origins never admit a foreign, sibling or opaque request', () => {
  for (const request of [
    { ...proxied, origin: 'https://evil.example' },
    { ...proxied, origin: 'http://gev.example' },
    { ...proxied, origin: 'null' },
    { ...proxied, secFetchSite: 'cross-site' },
    { ...proxied, secFetchSite: 'same-site' },
  ])
    assert.equal(
      admitSameSiteRequest({ ...request, publicOrigins }).ok,
      false,
      JSON.stringify(request),
    );
});

test('behind a proxy, a request without Origin needs the browser to say same-origin', () => {
  const proxyHeaders = { 'x-forwarded-for': '10.0.0.2' };
  const bare = { hostHeader: 'docker.example:4173', proxyHeaders };
  assert.equal(
    admitSameSiteRequest({
      ...bare,
      publicOrigins,
      secFetchSite: 'same-origin',
    }).ok,
    true,
  );
  assert.equal(admitSameSiteRequest({ ...bare, publicOrigins }).ok, false);
  assert.equal(
    admitSameSiteRequest({ ...bare, publicOrigins, secFetchSite: 'none' }).ok,
    false,
  );
  assert.equal(
    admitSameSiteRequest({ ...bare, secFetchSite: 'same-origin' }).ok,
    false,
  );
});

test('only bare http(s) origins are accepted as public origins', () => {
  assert.deepEqual(
    parsePublicOrigins(
      ' https://gev.example , https://gev.example/, http://lan.example:8080,' +
        'https://x.example/path, *, null, ftp://f.example, https://*.example,',
    ),
    ['https://gev.example', 'http://lan.example:8080'],
  );
  assert.deepEqual(parsePublicOrigins(undefined), []);
});
