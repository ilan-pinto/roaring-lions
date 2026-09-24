import type { Env } from './d1';

/** Verifies a Cloudflare Access JWT (`cf-access-jwt-assertion`). Fails closed:
 *  any parse error, missing env var, bad signature, wrong audience, wrong
 *  issuer or expiry returns false rather than throwing. */

// TypeScript's own JsonWebKey (lib.dom) omits `kid` -- part of the JWK spec
// (RFC 7517 §4.5) but not of any operation the DOM's WebCrypto types model.
export type Jwk = JsonWebKey & { kid?: string };

const CERTS_TTL_MS = 10 * 60 * 1000;
let certsCache: { domain: string; keys: Jwk[]; at: number } | null = null;

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;
}

async function certsFor(domain: string, fetchCerts: (url: string) => Promise<{ keys: Jwk[] }>): Promise<Jwk[]> {
  const now = Date.now();
  if (certsCache && certsCache.domain === domain && now - certsCache.at < CERTS_TTL_MS) return certsCache.keys;
  const { keys } = await fetchCerts(`https://${domain}/cdn-cgi/access/certs`);
  certsCache = { domain, keys, at: now };
  return keys;
}

/** Test-only escape hatch: primes the module-memory certs cache directly, for
 *  a helper that needs `verifyAccessJwt`'s default (real) `fetchCerts` path to
 *  resolve from cache without a network call. Not used by production code. */
export function __primeAccessCertsCacheForTests(domain: string, keys: Jwk[]): void {
  certsCache = { domain, keys, at: Date.now() };
}

export async function verifyAccessJwt(
  token: string,
  env: Env,
  now: number,
  fetchCerts: (url: string) => Promise<{ keys: Jwk[] }> = (url) => fetch(url).then((r) => r.json() as Promise<{ keys: Jwk[] }>)
): Promise<boolean> {
  try {
    const domain = env.ACCESS_TEAM_DOMAIN;
    const aud = env.ACCESS_AUD;
    if (!domain || !aud) return false;

    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, sigB64] = parts;

    const header = b64urlToJson<{ alg?: string; kid?: string }>(headerB64);
    if (header.alg !== 'RS256' || !header.kid) return false;

    const payload = b64urlToJson<{ aud?: string | string[]; exp?: number; iss?: string }>(payloadB64);
    const audOk = Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud;
    if (!audOk) return false;
    if (typeof payload.exp !== 'number' || payload.exp <= now / 1000) return false;
    if (payload.iss !== `https://${domain}`) return false;

    const keys = await certsFor(domain, fetchCerts);
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return false;

    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sig = b64urlToBytes(sigB64);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
  } catch {
    return false;
  }
}
