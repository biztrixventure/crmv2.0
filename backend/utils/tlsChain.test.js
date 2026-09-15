// ============================================================================
// tlsChain.test.js -- the certificates shipped in backend/certs/intermediates.
//
// Offline and deterministic: the live behaviour (repair a missing intermediate,
// still refuse expired / self-signed / wrong-host / untrusted-root) was proven
// against real servers when utils/tlsChain.js was written. What CAN rot quietly
// is this directory -- someone drops in an expired certificate, or a ROOT,
// which would turn "trust only what Node ships" into "trust what the repo
// ships". So every file here must be an intermediate, currently valid, and
// signed by a root that is in Node's own bundle.
// ============================================================================
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'certs', 'intermediates');
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => /\.pem$/i.test(f)) : [];
const roots = tls.rootCertificates.map(p => new crypto.X509Certificate(p));

describe('shipped intermediates', () => {
  test('the directory ships at least the flexodialer issuer', () => {
    const subjects = files.map(f => new crypto.X509Certificate(fs.readFileSync(path.join(DIR, f))).subject);
    expect(subjects.some(s => s.includes('SSL.com TLS Issuing RSA CA R1'))).toBe(true);
  });

  test.each(files)('%s is an intermediate, not a root', (f) => {
    const c = new crypto.X509Certificate(fs.readFileSync(path.join(DIR, f)));
    const selfSigned = c.subject === c.issuer && c.verify(c.publicKey);
    expect(selfSigned).toBe(false);
  });

  test.each(files)('%s is still valid', (f) => {
    const c = new crypto.X509Certificate(fs.readFileSync(path.join(DIR, f)));
    expect(new Date(c.validTo).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(c.validFrom).getTime()).toBeLessThan(Date.now());
  });

  test.each(files)('%s is signed by a root Node already trusts', (f) => {
    const c = new crypto.X509Certificate(fs.readFileSync(path.join(DIR, f)));
    expect(roots.some(r => c.checkIssued(r) && c.verify(r.publicKey))).toBe(true);
  });
});
