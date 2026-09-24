import { describe, it, expect } from 'vitest';
import { verifyAccessJwt, type Jwk } from './access';
import type { Env } from './d1';

const DOMAIN_PREFIX = 'access-test';
let domainCounter = 0;
/** A fresh team domain per test so the 10-minute module-memory certs cache
 *  never serves one test's keys to another. */
const freshDomain = (): string => `${DOMAIN_PREFIX}-${++domainCounter}.cloudflareaccess.com`;

const AUD = 'aud-0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab';
const KID = 'test-kid-1';

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const jsonB64url = (o: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function keypair() {
  return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
    'sign',
    'verify',
  ]);
}

async function sign(privateKey: CryptoKey, headerB64: string, payloadB64: string): Promise<string> {
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data);
  return `${headerB64}.${payloadB64}.${b64url(sig)}`;
}

/** Builds a signed token plus a `fetchCerts` that serves the matching JWK. */
async function issue(
  domain: string,
  opts: {
    header?: Record<string, unknown>;
    payload?: Record<string, unknown>;
    tamperPayload?: boolean;
    unknownKid?: boolean;
  } = {}
) {
  const { publicKey, privateKey } = await keypair();
  const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as Jwk;
  jwk.kid = opts.unknownKid ? 'a-different-kid' : KID;

  const header = { alg: 'RS256', kid: KID, ...opts.header };
  const payload = { aud: AUD, exp: 9_999_999_999, iss: `https://${domain}`, ...opts.payload };
  const headerB64 = jsonB64url(header);
  let payloadB64 = jsonB64url(payload);
  const token = await sign(privateKey, headerB64, payloadB64);
  if (opts.tamperPayload) {
    // Re-encode a payload that still passes the aud/exp/iss checks, keeping
    // the original signature, so only the signature check can catch it.
    payloadB64 = jsonB64url({ ...payload, sub: 'someone-else' });
    const [h, , s] = token.split('.');
    return { token: `${h}.${payloadB64}.${s}`, fetchCerts: async () => ({ keys: [jwk] }) };
  }
  return { token, fetchCerts: async () => ({ keys: [jwk] }) };
}

const env = (domain: string): Env => ({
  DB: {} as Env['DB'],
  ASSETS: { fetch: async () => new Response('') },
  ACCESS_TEAM_DOMAIN: domain,
  ACCESS_AUD: AUD,
});

const NOW = 1_790_000_000_000;

describe('verifyAccessJwt', () => {
  it('accepts a validly signed token', async () => {
    const domain = freshDomain();
    const { token, fetchCerts } = await issue(domain);
    expect(await verifyAccessJwt(token, env(domain), NOW, fetchCerts)).toBe(true);
  });

  it('rejects the wrong audience', async () => {
    const domain = freshDomain();
    const { token, fetchCerts } = await issue(domain, { payload: { aud: 'someone-else' } });
    expect(await verifyAccessJwt(token, env(domain), NOW, fetchCerts)).toBe(false);
  });

  it('rejects an expired token', async () => {
    const domain = freshDomain();
    const { token, fetchCerts } = await issue(domain, { payload: { exp: NOW / 1000 - 10 } });
    expect(await verifyAccessJwt(token, env(domain), NOW, fetchCerts)).toBe(false);
  });

  it('rejects the wrong issuer', async () => {
    const domain = freshDomain();
    const { token, fetchCerts } = await issue(domain, { payload: { iss: 'https://someone-elses-team.cloudflareaccess.com' } });
    expect(await verifyAccessJwt(token, env(domain), NOW, fetchCerts)).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const domain = freshDomain();
    const { token, fetchCerts } = await issue(domain, { tamperPayload: true });
    expect(await verifyAccessJwt(token, env(domain), NOW, fetchCerts)).toBe(false);
  });

  it('rejects an unknown kid', async () => {
    const domain = freshDomain();
    const { token, fetchCerts } = await issue(domain, { unknownKid: true });
    expect(await verifyAccessJwt(token, env(domain), NOW, fetchCerts)).toBe(false);
  });

  it('rejects alg none', async () => {
    const domain = freshDomain();
    const { token, fetchCerts } = await issue(domain, { header: { alg: 'none' } });
    expect(await verifyAccessJwt(token, env(domain), NOW, fetchCerts)).toBe(false);
  });

  it('fails closed when env vars are unset', async () => {
    const domain = freshDomain();
    const { token, fetchCerts } = await issue(domain);
    expect(await verifyAccessJwt(token, { DB: {} as Env['DB'], ASSETS: env(domain).ASSETS }, NOW, fetchCerts)).toBe(false);
  });

  it('rejects a malformed token', async () => {
    const domain = freshDomain();
    expect(await verifyAccessJwt('not-a-jwt', env(domain), NOW, async () => ({ keys: [] }))).toBe(false);
  });
});
