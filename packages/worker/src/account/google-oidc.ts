/** Google ID-token verifier (GH-1075 G2, spec §1.5 and §1.6). Pure: no route, no wiring, no logging.
 *  Returns the `sub` and nothing else: any other claim is dropped unread. */
import type { AccountDeps } from './routes';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS: readonly string[] = ['https://accounts.google.com', 'accounts.google.com'];

const SKEW_S = 60;
const REFETCH_MIN_MS = 60_000;
const MAX_TTL_MS = 24 * 3_600_000;
const DEFAULT_TTL_MS = 300_000;
const JWKS_CAP = 64 * 1024;
const B64URL = /^[A-Za-z0-9_-]+$/;
const SUB = /^[0-9]{1,255}$/;

export type GoogleRefusal = 'invalid' | 'google';
export type GoogleVerdict = { sub: string } | { refused: GoogleRefusal };

export interface GoogleVerifier {
  verify(idToken: string, expect: { nonce: string }): Promise<GoogleVerdict>;
}

type Keys = Map<string, CryptoKey>;

const b64urlBytes = (s: string): Uint8Array<ArrayBuffer> | null => {
  if (!B64URL.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
};

const jsonObject = (part: string): Record<string, unknown> | null => {
  const bytes = b64urlBytes(part);
  if (bytes === null) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const maxAgeMs = (cacheControl: string | null): number => {
  const m = /max-age=(\d{1,9})/i.exec(cacheControl ?? '');
  return m === null ? DEFAULT_TTL_MS : Math.min(Number(m[1]) * 1000, MAX_TTL_MS);
};

async function readCappedText(res: Response, max: number): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** `clock` is wall milliseconds; injectable so a test needs no fake timers. State (the JWKS cache and the
 *  once-a-minute refetch guard) lives in the returned verifier, one per isolate in production. */
export function createGoogleVerifier(o: {
  clientId: string;
  fetch: AccountDeps['fetch'];
  clock?: () => number;
}): GoogleVerifier {
  const clock = o.clock ?? ((): number => Date.now());
  let keys: Keys | null = null;
  let expiresAt = 0;
  let lastFetch = Number.NEGATIVE_INFINITY;

  async function load(): Promise<boolean> {
    lastFetch = clock();
    try {
      const res = await o.fetch(GOOGLE_JWKS_URL, {
        method: 'GET',
        headers: { 'user-agent': 'roaring-lions-worker', accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
        redirect: 'manual',
      });
      if (res.status !== 200) return false;
      const text = await readCappedText(res, JWKS_CAP);
      if (text === null) return false;
      const doc: unknown = JSON.parse(text);
      const list = (doc as { keys?: unknown } | null)?.keys;
      if (!Array.isArray(list)) return false;
      const next: Keys = new Map();
      for (const jwk of list as Record<string, unknown>[]) {
        if (typeof jwk.kid !== 'string' || jwk.kty !== 'RSA') continue;
        try {
          next.set(
            jwk.kid,
            await crypto.subtle.importKey(
              'jwk',
              { kty: 'RSA', n: String(jwk.n), e: String(jwk.e), alg: 'RS256', ext: true },
              { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
              false,
              ['verify'],
            ),
          );
        } catch {
          // one unusable key must not hide the rest
        }
      }
      keys = next;
      expiresAt = clock() + maxAgeMs(res.headers.get('cache-control'));
      return true;
    } catch {
      return false;
    }
  }

  /** The key for `kid`; a miss refetches once, and at most once a minute. null: no such key. 'google': the fetch failed. */
  async function keyFor(kid: string): Promise<CryptoKey | null | 'google'> {
    if (keys === null || clock() >= expiresAt) {
      if (!(await load())) return 'google';
    }
    const hit = keys?.get(kid);
    if (hit !== undefined) return hit;
    if (clock() - lastFetch >= REFETCH_MIN_MS) {
      if (!(await load())) return 'google';
    }
    return keys?.get(kid) ?? null;
  }

  return {
    async verify(idToken, expect) {
      const invalid = { refused: 'invalid' } as const;
      const parts = idToken.split('.');
      if (parts.length !== 3) return invalid;
      const [h, p, s] = parts as [string, string, string];
      const header = jsonObject(h);
      const payload = jsonObject(p);
      const sig = b64urlBytes(s);
      if (header === null || payload === null || sig === null) return invalid;

      // 1. alg is RS256 and nothing else
      if (header.alg !== 'RS256') return invalid;
      // 2. kid names a key in the JWKS
      if (typeof header.kid !== 'string') return invalid;
      const key = await keyFor(header.kid);
      if (key === 'google') return { refused: 'google' };
      if (key === null) return invalid;
      // 3. the signature verifies
      let ok: boolean;
      try {
        ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, new TextEncoder().encode(`${h}.${p}`));
      } catch {
        ok = false;
      }
      if (!ok) return invalid;
      // 4. iss
      if (typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.includes(payload.iss)) return invalid;
      // 5. aud: the client id, or an array whose only member it is
      const aud = payload.aud;
      if (!(aud === o.clientId || (Array.isArray(aud) && aud.length === 1 && aud[0] === o.clientId))) return invalid;
      // 6. azp, when present
      if ('azp' in payload && payload.azp !== o.clientId) return invalid;
      const nowS = Math.floor(clock() / 1000);
      // 7. exp is later than now minus the skew
      if (typeof payload.exp !== 'number' || !(payload.exp > nowS - SKEW_S)) return invalid;
      // 8. iat is no later than now plus the skew
      if (typeof payload.iat !== 'number' || !(payload.iat <= nowS + SKEW_S)) return invalid;
      // 9. nonce
      if (typeof payload.nonce !== 'string' || payload.nonce !== expect.nonce) return invalid;
      // 10. sub: 1 to 255 ASCII digits
      if (typeof payload.sub !== 'string' || !SUB.test(payload.sub)) return invalid;
      // Only the sub leaves this function (§1.6): email, name, picture, hd and the rest are dropped unread.
      return { sub: payload.sub };
    },
  };
}
