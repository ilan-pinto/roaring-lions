/** Password login for /stats. Sessions are stateless: a cookie carrying an
 *  expiry and an HMAC-SHA256 signature over it, keyed from STATS_PASSWORD --
 *  so rotating the password revokes every outstanding session with no
 *  server-side store. */

export const SESSION_COOKIE = 'stats_session';
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const COOKIE_ATTRS = 'HttpOnly; Secure; SameSite=Strict; Path=/stats';

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** `<expiryMs>.<base64url HMAC-SHA256 signature>`, unsigned into a cookie value. */
export async function signSession(secret: string, expiryMs: number): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`stats-session:${expiryMs}`));
  return `${expiryMs}.${b64url(sig)}`;
}

/** Valid only if the signature verifies (constant-time, via `crypto.subtle.verify`)
 *  AND the expiry is still in the future. Fails closed on anything malformed. */
export async function verifySession(cookieValue: string | null, secret: string, now: number): Promise<boolean> {
  if (!cookieValue) return false;
  const dot = cookieValue.indexOf('.');
  if (dot < 0) return false;
  const expiryMs = Number(cookieValue.slice(0, dot));
  const sigPart = cookieValue.slice(dot + 1);
  if (!Number.isFinite(expiryMs)) return false;
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = b64urlToBytes(sigPart);
  } catch {
    return false;
  }
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(`stats-session:${expiryMs}`));
  return ok && expiryMs > now;
}

/** Full `Set-Cookie` header value for a freshly logged-in session, expiring 7 days from `now`. */
export async function sessionCookieHeader(secret: string, now: number): Promise<string> {
  const value = await signSession(secret, now + SESSION_MS);
  return `${SESSION_COOKIE}=${value}; ${COOKIE_ATTRS}; Max-Age=604800`;
}

/** `Set-Cookie` header value that clears the session cookie on logout. */
export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;
}

/** Reads one cookie by name out of a request's `Cookie` header. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** Constant-time password comparison: hash both sides and XOR-accumulate over
 *  every byte of both 32-byte digests, never short-circuiting and never
 *  comparing the raw strings with `===`. */
export async function passwordsMatch(submitted: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(submitted), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
