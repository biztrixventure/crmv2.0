// ============================================================================
// clientIp.test.js -- resolving the real client address behind proxies
// (IP access control, mig 319). Real Express apps + supertest, so the actual
// `trust proxy` machinery (proxy-addr) is what gets exercised. supertest
// connects from loopback, so "the immediate peer" is 127.0.0.1 throughout.
// ============================================================================
jest.mock('./logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { resolveClientIp, describeClientIp, configureTrustProxy, readTrustedProxies } = require('./clientIp');

function appWith(env) {
  const app = express();
  configureTrustProxy(app, env);
  app.get('/ip', (req, res) => res.json({ ip: resolveClientIp(req, env), info: describeClientIp(req, env) }));
  return app;
}

describe('no trusted proxies configured (the default -- exactly today\'s behaviour)', () => {
  test('a spoofed X-Forwarded-For from an untrusted peer is ignored', async () => {
    const r = await request(appWith({})).get('/ip').set('X-Forwarded-For', '203.0.113.9');
    expect(r.body.ip).toBe('127.0.0.1');
    expect(r.body.info.warnings.join(' ')).toMatch(/IP_TRUSTED_PROXIES is not set/);
  });

  test('a spoofed CF-Connecting-IP is ignored too', async () => {
    const r = await request(appWith({ IP_CLIENT_HEADER: 'cf-connecting-ip' })).get('/ip').set('CF-Connecting-IP', '203.0.113.9');
    expect(r.body.ip).toBe('127.0.0.1');
  });

  test('configureTrustProxy leaves Express untouched', () => {
    const app = express();
    expect(configureTrustProxy(app, {})).toEqual({ configured: false, list: [] });
    expect(app.get('trust proxy')).toBe(false);
  });
});

describe('the peer is NOT one of the trusted proxies', () => {
  test('X-Forwarded-For is ignored -- the raw socket address wins', async () => {
    const r = await request(appWith({ IP_TRUSTED_PROXIES: '10.0.0.0/8' })).get('/ip').set('X-Forwarded-For', '203.0.113.9');
    expect(r.body.ip).toBe('127.0.0.1');
    expect(r.body.info.peer_trusted).toBe(false);
  });

  test('CF-Connecting-IP is ignored', async () => {
    const r = await request(appWith({ IP_TRUSTED_PROXIES: '10.0.0.0/8', IP_CLIENT_HEADER: 'cf-connecting-ip' }))
      .get('/ip').set('CF-Connecting-IP', '203.0.113.9');
    expect(r.body.ip).toBe('127.0.0.1');
  });
});

describe('the peer IS a trusted proxy', () => {
  test('X-Forwarded-For gives the client address', async () => {
    const r = await request(appWith({ IP_TRUSTED_PROXIES: 'loopback' })).get('/ip').set('X-Forwarded-For', '203.0.113.9');
    expect(r.body.ip).toBe('203.0.113.9');
    expect(r.body.info.peer_trusted).toBe(true);
  });

  test('a chain is walked right-to-left past trusted hops', async () => {
    const r = await request(appWith({ IP_TRUSTED_PROXIES: 'loopback, 10.0.0.0/8' }))
      .get('/ip').set('X-Forwarded-For', '198.51.100.1, 10.0.0.5');
    expect(r.body.ip).toBe('198.51.100.1');
  });

  test('a value the client prepended to the chain is NOT believed', async () => {
    // Client sends "6.6.6.6"; the (trusted) proxy appends the real peer 203.0.113.9.
    const r = await request(appWith({ IP_TRUSTED_PROXIES: 'loopback' }))
      .get('/ip').set('X-Forwarded-For', '6.6.6.6, 203.0.113.9');
    expect(r.body.ip).toBe('203.0.113.9');
  });

  test('IPv6 client through a trusted proxy', async () => {
    const r = await request(appWith({ IP_TRUSTED_PROXIES: 'loopback' })).get('/ip').set('X-Forwarded-For', '2001:DB8::0:1');
    expect(r.body.ip).toBe('2001:db8::1');
  });

  test('CF-Connecting-IP mode reads Cloudflare\'s header', async () => {
    const r = await request(appWith({ IP_TRUSTED_PROXIES: 'loopback', IP_CLIENT_HEADER: 'cf-connecting-ip' }))
      .get('/ip').set('CF-Connecting-IP', '203.0.113.77').set('X-Forwarded-For', '198.51.100.1');
    expect(r.body.ip).toBe('203.0.113.77');
  });

  test('CF mode without the header falls back to X-Forwarded-For', async () => {
    const r = await request(appWith({ IP_TRUSTED_PROXIES: 'loopback', IP_CLIENT_HEADER: 'cf-connecting-ip' }))
      .get('/ip').set('X-Forwarded-For', '198.51.100.1');
    expect(r.body.ip).toBe('198.51.100.1');
    expect(r.body.info.warnings.join(' ')).toMatch(/no CF-Connecting-IP header/);
  });

  test('a garbage CF-Connecting-IP is not trusted as an address', async () => {
    const r = await request(appWith({ IP_TRUSTED_PROXIES: 'loopback', IP_CLIENT_HEADER: 'cf-connecting-ip' }))
      .get('/ip').set('CF-Connecting-IP', 'not-an-ip').set('X-Forwarded-For', '198.51.100.1');
    expect(r.body.ip).toBe('198.51.100.1');
  });
});

describe('configuration parsing', () => {
  test('invalid entries are dropped, keywords and CIDRs kept (normalised)', () => {
    const { list, invalid } = readTrustedProxies({ IP_TRUSTED_PROXIES: 'loopback, 10.0.0.5/8, nonsense, 2001:db8::/32' });
    expect(list).toEqual(['loopback', '10.0.0.0/8', '2001:db8::/32']);
    expect(invalid).toEqual(['nonsense']);
  });

  test('an unknown IP_CLIENT_HEADER falls back to X-Forwarded-For', async () => {
    const r = await request(appWith({ IP_TRUSTED_PROXIES: 'loopback', IP_CLIENT_HEADER: 'x-real-ip' }))
      .get('/ip').set('X-Forwarded-For', '198.51.100.1').set('X-Real-IP', '6.6.6.6');
    expect(r.body.ip).toBe('198.51.100.1');
    expect(r.body.info.header).toBe('x-forwarded-for');
  });
});
