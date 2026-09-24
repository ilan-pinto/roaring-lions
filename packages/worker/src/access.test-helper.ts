/** Test-only helper for signing a Cloudflare Access JWT that `verifyAccessJwt`
 *  (access.ts) accepts. Other suites (stats.test.ts) that need a request to
 *  actually pass Access, rather than test verification itself, use this. */
import { __primeAccessCertsCacheForTests, type Jwk } from './access';
import type { Env } from './d1';

export const TEST_ACCESS_AUD = 'aud-0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab';

export function testAccessEnv(domain: string): Pick<Env, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD'> {
  return { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: TEST_ACCESS_AUD };
}

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const jsonB64url = (o: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** access.ts's certs cache is a single module-memory slot per domain, replaced
 *  wholesale on every prime. A caller that issues more than one token for the
 *  same domain (as stats.test.ts does) must prime it with every kid ever
 *  issued for that domain, not just the latest -- otherwise priming for the
 *  second token would evict the first token's key. */
const issuedKeysByDomain = new Map<string, Jwk[]>();

/** Issues a validly signed Access token for `domain`, and primes access.ts's
 *  10-minute module-memory certs cache so a caller using the real (default)
 *  `fetchCerts` -- like `handleStats` -- resolves from cache instead of
 *  making a network call. */
export async function issueValidAccessToken(domain: string, now: number): Promise<string> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as Jwk;
  jwk.kid = `stats-test-kid-${(issuedKeysByDomain.get(domain)?.length ?? 0) + 1}`;
  const keys = [...(issuedKeysByDomain.get(domain) ?? []), jwk];
  issuedKeysByDomain.set(domain, keys);

  const headerB64 = jsonB64url({ alg: 'RS256', kid: jwk.kid });
  const payloadB64 = jsonB64url({ aud: TEST_ACCESS_AUD, exp: Math.floor(now / 1000) + 3600, iss: `https://${domain}` });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${headerB64}.${payloadB64}`));
  const token = `${headerB64}.${payloadB64}.${b64url(sig)}`;

  __primeAccessCertsCacheForTests(domain, keys);
  return token;
}
