import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admitSameSiteRequest,
  parsePublicOrigins,
} from './localRequestGate.mjs';

const same = {
  hostHeader: 'localhost:4173',
  protocol: 'http:',
  origin: 'http://localhost:4173',
  secFetchSite: 'same-origin',
};

test('the honest same-origin browser request is admitted', () => {
  assert.equal(admitSameSiteRequest(same).ok, true);
});

test('a cross-site Origin is refused', () => {
  const r = admitSameSiteRequest({ ...same, origin: 'https://evil.example' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test('an opaque Origin ("null") is refused even when Host would match', () => {
  const r = admitSameSiteRequest({ ...same, origin: 'null' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test('Sec-Fetch-Site cross-site without an Origin is refused (the <img> case)', () => {
  const r = admitSameSiteRequest({
    hostHeader: 'localhost:4173',
    protocol: 'http:',
    secFetchSite: 'cross-site',
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test('Sec-Fetch-Site same-site (cross-origin sibling) is refused', () => {
  const r = admitSameSiteRequest({
    ...same,
    origin: 'http://localhost:4173',
    secFetchSite: 'same-site',
  });
  assert.equal(r.ok, false, 'same-site is not same-origin');
  assert.equal(r.status, 403);
});

test('a reverse-proxy signal header is refused', () => {
  for (const header of [
    'x-forwarded-for',
    'forwarded',
    'via',
    'cf-connecting-ip',
    'cf-ray',
    'x-real-ip',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-proto',
  ]) {
    const r = admitSameSiteRequest({
      ...same,
      proxyHeaders: { [header]: 'anything' },
    });
    assert.equal(r.ok, false, `${header} present → refused`);
  }
  // An empty forwarding header is not a proxy signal.
  assert.equal(
    admitSameSiteRequest({ ...same, proxyHeaders: { 'x-forwarded-for': '' } })
      .ok,
    true,
  );
});

test('same-origin Origin with Sec-Fetch-Site same-origin is admitted', () => {
  assert.equal(admitSameSiteRequest(same).ok, true);
});

test('no Origin and no Sec-Fetch headers (curl / Node harness) is admitted', () => {
  const r = admitSameSiteRequest({
    hostHeader: 'localhost:4173',
    protocol: 'http:',
  });
  assert.equal(r.ok, true, 'non-browser loopback tools pass');
});

test('Sec-Fetch-Site none (typed URL / bookmark) is admitted', () => {
  const r = admitSameSiteRequest({
    hostHeader: 'localhost:4173',
    protocol: 'http:',
    secFetchSite: 'none',
  });
  assert.equal(r.ok, true);
});

test('a LAN remote address is irrelevant: the function takes no remoteAddress', () => {
  // The credential-panel gate requires a loopback socket; this gate does not.
  // Passing a LAN-shaped Host/Origin pair must still match (LAN opt-in works).
  const lan = admitSameSiteRequest({
    hostHeader: '192.168.1.5:4173',
    protocol: 'http:',
    origin: 'http://192.168.1.5:4173',
    secFetchSite: 'same-origin',
  });
  assert.equal(lan.ok, true, 'a same-origin LAN browser request is admitted');
});

test('a cross-port or cross-scheme Origin against the same Host is refused', () => {
  assert.equal(
    admitSameSiteRequest({ ...same, origin: 'http://localhost:4174' }).ok,
    false,
    'cross-port',
  );
  assert.equal(
    admitSameSiteRequest({ ...same, origin: 'https://localhost:4173' }).ok,
    false,
    'cross-scheme',
  );
  assert.equal(
    admitSameSiteRequest({ ...same, origin: 'http://127.0.0.1:4173' }).ok,
    false,
    'different loopback host',
  );
});

test('an unparseable Origin is refused', () => {
  assert.equal(
    admitSameSiteRequest({ ...same, origin: 'not a url' }).ok,
    false,
  );
});

test('a missing Host with a present Origin is refused (no authority to match)', () => {
  assert.equal(
    admitSameSiteRequest({ ...same, hostHeader: '' }).ok,
    false,
    'empty Host → null authority',
  );
  assert.equal(
    admitSameSiteRequest({ ...same, hostHeader: undefined }).ok,
    false,
    'absent Host → null authority',
  );
});

test('a foreign Host is refused when an Origin is present', () => {
  assert.equal(
    admitSameSiteRequest({ ...same, hostHeader: 'evil.example:4173' }).ok,
    false,
    'foreign Host does not match local Origin',
  );
});

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
