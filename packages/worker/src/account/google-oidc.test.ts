import { beforeAll, describe, expect, it } from 'vitest';
import { GOOGLE_JWKS_URL, createGoogleVerifier } from './google-oidc';

// GH-1075 G2: every token here is signed by a key generated in this file; no secret, no real network.
const CLIENT = 'test-client.apps.googleusercontent.com';
const NONCE = 'nonce-from-the-pre-cookie';
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;
const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) } as const;

const enc = (v: unknown): string => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

interface Pair { priv: CryptoKey; jwk: JsonWebKey & { kid: string } }
async function makePair(kid: string): Promise<Pair & { kid: string }> {
  const k = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', k.publicKey);
  return { priv: k.privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' }, kid };
}

let good: Pair & { kid: string };
let other: Pair & { kid: string };
beforeAll(async () => {
  good = await makePair('k1');
  other = await makePair('k1'); // same kid, different key: the signature check alone must catch it
});

const claims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: 'https://accounts.google.com', aud: CLIENT, azp: CLIENT, sub: '110169484474386276334',
  iat: NOW_S - 10, exp: NOW_S + 3000, nonce: NONCE, ...over,
});

async function token(over: Record<string, unknown> = {}, o: { header?: Record<string, unknown>; key?: CryptoKey; drop?: string[] } = {}): Promise<string> {
  const payload = claims(over);
  for (const d of o.drop ?? []) delete payload[d];
  const h = enc({ alg: 'RS256', typ: 'JWT', kid: good.kid, ...o.header });
  const p = enc(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', o.key ?? good.priv, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
}

function rig(jwks: () => Response | Promise<Response> = () => new Response(JSON.stringify({ keys: [good.jwk] }), { status: 200, headers: { 'cache-control': 'public, max-age=3600' } })) {
  const urls: string[] = [];
  let now = NOW_MS;
  const v = createGoogleVerifier({
    clientId: CLIENT,
    clock: () => now,
    fetch: async (url) => {
      urls.push(url);
      return jwks();
    },
  });
  return { v, urls, advance: (ms: number) => { now += ms; } };
}

const refused = (r: 'invalid' | 'google') => ({ refused: r });

describe('ID-token verifier: P4 checks (each one a mutation in G2)', () => {
  it('accepts a good token and returns exactly the sub', async () => {
    const { v, urls } = rig();
    expect(await v.verify(await token(), { nonce: NONCE })).toEqual({ sub: '110169484474386276334' });
    expect(urls).toEqual([GOOGLE_JWKS_URL]);
  });

  it('accepts the bare issuer and a one-member aud array', async () => {
    const { v } = rig();
    expect(await v.verify(await token({ iss: 'accounts.google.com', aud: [CLIENT] }), { nonce: NONCE })).toEqual({ sub: '110169484474386276334' });
  });

  it('1. alg must be RS256: none and HS256 are refused', async () => {
    const { v } = rig();
    expect(await v.verify(await token({}, { header: { alg: 'HS256' } }), { nonce: NONCE })).toEqual(refused('invalid'));
    const none = `${enc({ alg: 'none', kid: good.kid })}.${enc(claims())}.`;
    expect(await v.verify(none, { nonce: NONCE })).toEqual(refused('invalid'));
  });

  it('2. kid must name a key in the JWKS (and a missing kid is refused)', async () => {
    const { v } = rig();
    expect(await v.verify(await token({}, { header: { kid: 'nope' } }), { nonce: NONCE })).toEqual(refused('invalid'));
    expect(await v.verify(await token({}, { header: { kid: undefined } }), { nonce: NONCE })).toEqual(refused('invalid'));
  });

  it('3. the signature must verify (other key, tampered payload)', async () => {
    const { v } = rig();
    expect(await v.verify(await token({}, { key: other.priv }), { nonce: NONCE })).toEqual(refused('invalid'));
    const t = (await token()).split('.');
    const forged = `${t[0]}.${enc(claims({ sub: '999' }))}.${t[2]}`;
    expect(await v.verify(forged, { nonce: NONCE })).toEqual(refused('invalid'));
  });

  it('4. iss must be Google', async () => {
    const { v } = rig();
    expect(await v.verify(await token({ iss: 'https://evil.example' }), { nonce: NONCE })).toEqual(refused('invalid'));
  });

  it('5. aud must be the client id, alone', async () => {
    const { v } = rig();
    expect(await v.verify(await token({ aud: 'someone-else' }), { nonce: NONCE })).toEqual(refused('invalid'));
    expect(await v.verify(await token({ aud: [CLIENT, 'someone-else'] }), { nonce: NONCE })).toEqual(refused('invalid'));
  });

  it('6. azp, when present, must be the client id', async () => {
    const { v } = rig();
    expect(await v.verify(await token({ azp: 'someone-else' }), { nonce: NONCE })).toEqual(refused('invalid'));
    expect(await v.verify(await token({}, { drop: ['azp'] }), { nonce: NONCE })).toEqual({ sub: '110169484474386276334' });
  });

  it('7. exp must be later than now minus 60 s', async () => {
    const { v } = rig();
    expect(await v.verify(await token({ exp: NOW_S - 61 }), { nonce: NONCE })).toEqual(refused('invalid'));
    expect(await v.verify(await token({ exp: NOW_S - 59 }), { nonce: NONCE })).toEqual({ sub: '110169484474386276334' });
  });

  it('8. iat must be no later than now plus 60 s', async () => {
    const { v } = rig();
    expect(await v.verify(await token({ iat: NOW_S + 61 }), { nonce: NONCE })).toEqual(refused('invalid'));
    expect(await v.verify(await token({ iat: NOW_S + 60 }), { nonce: NONCE })).toEqual({ sub: '110169484474386276334' });
  });

  it('9. nonce must equal the expected one', async () => {
    const { v } = rig();
    expect(await v.verify(await token({ nonce: 'other' }), { nonce: NONCE })).toEqual(refused('invalid'));
    expect(await v.verify(await token({}, { drop: ['nonce'] }), { nonce: NONCE })).toEqual(refused('invalid'));
  });

  it('10. sub must be 1 to 255 ASCII digits', async () => {
    const { v } = rig();
    for (const sub of ['', 'abc123', '1'.repeat(256), '١٢٣', 12345, '12 3']) {
      expect(await v.verify(await token({ sub }), { nonce: NONCE })).toEqual(refused('invalid'));
    }
    expect(await v.verify(await token({ sub: '7'.repeat(255) }), { nonce: NONCE })).toEqual({ sub: '7'.repeat(255) });
  });
});

describe('ID-token verifier: claims kept, parsing, the JWKS', () => {
  it('a payload carrying email, name and picture verifies, and the result has only sub', async () => {
    const { v } = rig();
    const r = await v.verify(await token({ email: 'a@b.example', email_verified: true, name: 'A B', picture: 'https://x.example/p', hd: 'b.example' }), { nonce: NONCE });
    expect(r).toEqual({ sub: '110169484474386276334' });
    expect(Object.keys(r)).toEqual(['sub']);
  });

  it('refuses malformed tokens', async () => {
    const { v } = rig();
    for (const t of ['', 'a.b', 'a.b.c.d', '!!.!!.!!', `${enc('[]')}.${enc(claims())}.AAAA`, `${enc('not json')}.${enc(claims())}.AAAA`]) {
      expect(await v.verify(t, { nonce: NONCE })).toEqual(refused('invalid'));
    }
  });

  it('caches the JWKS within max-age and refetches after it', async () => {
    const { v, urls, advance } = rig();
    await v.verify(await token(), { nonce: NONCE });
    await v.verify(await token(), { nonce: NONCE });
    expect(urls).toHaveLength(1);
    advance(3_600_001);
    await v.verify(await token({ exp: NOW_S + 99999, iat: NOW_S + 3000 }), { nonce: NONCE });
    expect(urls).toHaveLength(2);
  });

  it('caps max-age at 24 hours', async () => {
    const { v, urls, advance } = rig(() => new Response(JSON.stringify({ keys: [good.jwk] }), { status: 200, headers: { 'cache-control': 'max-age=999999999' } }));
    await v.verify(await token(), { nonce: NONCE });
    advance(24 * 3_600_000 + 1);
    await v.verify(await token({ exp: NOW_S + 99999999, iat: NOW_S + 3000 }), { nonce: NONCE });
    expect(urls).toHaveLength(2);
  });

  it('a kid miss refetches once, at most once a minute, and picks up a rotated key', async () => {
    const rotated = await makePair('k2');
    let keys = [good.jwk];
    const { v, urls, advance } = rig(() => new Response(JSON.stringify({ keys }), { status: 200, headers: { 'cache-control': 'max-age=3600' } }));
    await v.verify(await token(), { nonce: NONCE });
    expect(urls).toHaveLength(1);
    const t2 = await token({}, { header: { kid: 'k2' }, key: rotated.priv });
    // Google has not rotated yet: first miss is inside the minute since the load, so no refetch
    expect(await v.verify(t2, { nonce: NONCE })).toEqual(refused('invalid'));
    expect(urls).toHaveLength(1);
    advance(61_000);
    keys = [good.jwk, rotated.jwk];
    expect(await v.verify(t2, { nonce: NONCE })).toEqual({ sub: '110169484474386276334' });
    expect(urls).toHaveLength(2);
    // a flood of unknown kids after that: one refetch per minute, not one per token
    const junk = await token({}, { header: { kid: 'ghost' } });
    expect(await v.verify(junk, { nonce: NONCE })).toEqual(refused('invalid'));
    expect(await v.verify(junk, { nonce: NONCE })).toEqual(refused('invalid'));
    expect(urls).toHaveLength(2);
    advance(61_000);
    await v.verify(junk, { nonce: NONCE });
    expect(urls).toHaveLength(3);
  });

  it('fails closed with google when the JWKS fetch fails, errors, is not JSON or is over 64 KiB', async () => {
    const t = await token();
    const cases: Array<() => Response | Promise<Response>> = [
      () => { throw new Error('network'); },
      () => new Response('nope', { status: 500 }),
      () => new Response('', { status: 302, headers: { location: 'https://evil.example' } }),
      () => new Response('not json', { status: 200 }),
      () => new Response('{"keys":3}', { status: 200 }),
      () => new Response(' '.repeat(64 * 1024 + 1), { status: 200 }),
    ];
    for (const c of cases) {
      const { v } = rig(c);
      expect(await v.verify(t, { nonce: NONCE })).toEqual(refused('google'));
    }
  });

  it('issuer: look-alikes, http and a trailing slash are refused', async () => {
    const { v } = rig();
    for (const iss of ['https://accounts.google.com.evil.example', 'http://accounts.google.com', 'https://accounts.google.com/', 'accounts.google.com/', 'evil.accounts.google.com']) {
      expect(await v.verify(await token({ iss }), { nonce: NONCE })).toEqual(refused('invalid'));
    }
  });

  it('exp exactly at now minus 60 s is refused; string and non-finite exp/iat are refused', async () => {
    const { v } = rig();
    expect(await v.verify(await token({ exp: NOW_S - 60 }), { nonce: NONCE })).toEqual(refused('invalid'));
    expect(await v.verify(await token({ exp: String(NOW_S + 3000) }), { nonce: NONCE })).toEqual(refused('invalid'));
    expect(await v.verify(await token({ iat: String(NOW_S - 10) }), { nonce: NONCE })).toEqual(refused('invalid'));
    // JSON.parse('1e999') is Infinity: exp passes a bare `> now`, and iat -Infinity passes `<= now`
    for (const raw of [{ exp: '1e999' }, { iat: '-1e999' }]) {
      const h = enc({ alg: 'RS256', kid: good.kid });
      const base = JSON.stringify(claims(raw as Record<string, unknown>)).replace(/"(1e999|-1e999)"/, '$1');
      const p = enc(base);
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', good.priv, new TextEncoder().encode(`${h}.${p}`));
      expect(await v.verify(`${h}.${p}.${Buffer.from(sig).toString('base64url')}`, { nonce: NONCE })).toEqual(refused('invalid'));
    }
  });

  it('alg none with a non-empty signature reaches check 1 and is refused (JWKS never needed for it)', async () => {
    const { v } = rig();
    const none = `${enc({ alg: 'none', kid: good.kid })}.${enc(claims())}.${Buffer.from('x'.repeat(256)).toString('base64url')}`;
    expect(await v.verify(none, { nonce: NONCE })).toEqual(refused('invalid'));
  });

  it('a crit header, an oversized token, a non-string token and an empty nonce are refused', async () => {
    const { v } = rig();
    expect(await v.verify(await token({}, { header: { crit: ['exp'] } }), { nonce: NONCE })).toEqual(refused('invalid'));
    expect(await v.verify(await token({ pad: 'x'.repeat(9000) }), { nonce: NONCE })).toEqual(refused('invalid'));
    for (const bad of [undefined, null, 5, {}, ['a.b.c']]) {
      expect(await v.verify(bad as unknown as string, { nonce: NONCE })).toEqual(refused('invalid'));
    }
    expect(await v.verify(await token({ nonce: '' }), { nonce: '' })).toEqual(refused('invalid'));
  });

  it('createGoogleVerifier throws on an empty clientId', () => {
    expect(() => createGoogleVerifier({ clientId: '', fetch: async () => new Response('') })).toThrow();
  });

  it('a null or non-object entry in keys is skipped, not fatal', async () => {
    const { v } = rig(() => new Response(JSON.stringify({ keys: [null, 7, 'x', [], good.jwk] }), { status: 200 }));
    expect(await v.verify(await token(), { nonce: NONCE })).toEqual({ sub: '110169484474386276334' });
  });

  it('JWK import refuses use other than sig, alg other than RS256, and a modulus under 2048 bits', async () => {
    const small = await crypto.subtle.generateKey({ ...ALG, modulusLength: 1024 }, true, ['sign', 'verify']);
    const smallJwk = { ...(await crypto.subtle.exportKey('jwk', small.publicKey)), kid: 'k1', alg: 'RS256' };
    const variants: Array<[JsonWebKey, CryptoKey]> = [[{ ...good.jwk, use: 'enc' }, good.priv], [{ ...good.jwk, alg: 'RS512' }, good.priv], [smallJwk, small.privateKey]];
    for (const [jwk, signer] of variants) {
      const { v } = rig(() => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }));
      expect(await v.verify(await token({}, { key: signer }), { nonce: NONCE })).toEqual(refused('invalid'));
    }
    const { v } = rig(() => new Response(JSON.stringify({ keys: [{ ...good.jwk, use: undefined, alg: undefined }] }), { status: 200 }));
    expect(await v.verify(await token(), { nonce: NONCE })).toEqual({ sub: '110169484474386276334' });
  });

  it('10 concurrent cold verifies make one JWKS fetch', async () => {
    const { v, urls } = rig();
    const t = await token();
    const all = await Promise.all(Array.from({ length: 10 }, () => v.verify(t, { nonce: NONCE })));
    expect(all.every((r) => 'sub' in r)).toBe(true);
    expect(urls).toHaveLength(1);
  });

  it('a failed JWKS load is not retried inside a minute, and is again after it', async () => {
    const { v, urls, advance } = rig(() => new Response('', { status: 500 }));
    const t = await token();
    for (let i = 0; i < 5; i++) expect(await v.verify(t, { nonce: NONCE })).toEqual(refused('google'));
    expect(urls).toHaveLength(1);
    advance(60_001);
    await v.verify(t, { nonce: NONCE });
    expect(urls).toHaveLength(2);
  });

  it('max-age=0 is floored: it does not mean one fetch per verify', async () => {
    const { v, urls } = rig(() => new Response(JSON.stringify({ keys: [good.jwk] }), { status: 200, headers: { 'cache-control': 'max-age=0' } }));
    for (let i = 0; i < 4; i++) await v.verify(await token(), { nonce: NONCE });
    expect(urls).toHaveLength(1);
  });

  it('the 64 KiB cap holds against a never-ending body', async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        c.enqueue(new Uint8Array(8192).fill(32));
      },
    });
    const { v } = rig(() => new Response(endless, { status: 200 }));
    expect(await v.verify(await token(), { nonce: NONCE })).toEqual(refused('google'));
    expect(pulls).toBeLessThan(20);
  });

  it('logs nothing, not even on refusal', async () => {
    const seen: unknown[][] = [];
    const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    for (const k of Object.keys(orig) as Array<keyof typeof orig>) console[k] = (...a: unknown[]) => { seen.push(a); };
    try {
      const { v } = rig();
      await v.verify(await token({ nonce: 'x' }), { nonce: NONCE });
      await v.verify('junk', { nonce: NONCE });
    } finally {
      Object.assign(console, orig);
    }
    expect(seen).toEqual([]);
  });
});
