import { describe, it, expect } from 'vitest';
import { signSession, verifySession, sessionCookieHeader, clearedSessionCookieHeader, readCookie, passwordsMatch, SESSION_COOKIE } from './auth';

const NOW = 1_790_000_000_000;
const SECRET = 'correct horse battery staple';

describe('signSession / verifySession', () => {
  it('accepts a freshly signed, unexpired session', async () => {
    const value = await signSession(SECRET, NOW + 1000);
    expect(await verifySession(value, SECRET, NOW)).toBe(true);
  });

  it('rejects an expired session', async () => {
    const value = await signSession(SECRET, NOW - 1);
    expect(await verifySession(value, SECRET, NOW)).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const value = await signSession(SECRET, NOW + 1000);
    const [expiry, sig] = value.split('.');
    const tampered = `${expiry}.${sig.slice(0, -1)}${sig.at(-1) === 'A' ? 'B' : 'A'}`;
    expect(await verifySession(tampered, SECRET, NOW)).toBe(false);
  });

  it('rejects a session signed with a different secret (password rotation revokes it)', async () => {
    const value = await signSession('a different password', NOW + 1000);
    expect(await verifySession(value, SECRET, NOW)).toBe(false);
  });

  it('rejects a tampered expiry', async () => {
    const value = await signSession(SECRET, NOW + 1000);
    const [, sig] = value.split('.');
    expect(await verifySession(`${NOW + 999_999}.${sig}`, SECRET, NOW)).toBe(false);
  });

  it('rejects null, empty and malformed cookie values', async () => {
    expect(await verifySession(null, SECRET, NOW)).toBe(false);
    expect(await verifySession('', SECRET, NOW)).toBe(false);
    expect(await verifySession('not-a-valid-cookie', SECRET, NOW)).toBe(false);
  });
});

describe('sessionCookieHeader / clearedSessionCookieHeader', () => {
  it('carries the exact required attributes and a 7-day Max-Age', async () => {
    const header = await sessionCookieHeader(SECRET, NOW);
    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/stats');
    expect(header).toContain('Max-Age=604800');
  });

  it('produces a cookie that verifies for the next 7 days and not after', async () => {
    const header = await sessionCookieHeader(SECRET, NOW);
    const value = header.split(';')[0].split('=').slice(1).join('=');
    expect(await verifySession(value, SECRET, NOW + 7 * 86_400_000 - 1)).toBe(true);
    expect(await verifySession(value, SECRET, NOW + 7 * 86_400_000 + 1)).toBe(false);
  });

  it('clears the cookie with the same name and attributes at Max-Age=0', () => {
    const header = clearedSessionCookieHeader();
    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/stats');
    expect(header).toContain('Max-Age=0');
  });
});

describe('readCookie', () => {
  it('reads a cookie by name out of a multi-cookie header', () => {
    const req = new Request('https://g.dev/stats', { headers: { cookie: 'foo=bar; stats_session=abc.def; other=1' } });
    expect(readCookie(req, SESSION_COOKIE)).toBe('abc.def');
  });

  it('returns null when the cookie header is absent or the name is not present', () => {
    expect(readCookie(new Request('https://g.dev/stats'), SESSION_COOKIE)).toBe(null);
    expect(readCookie(new Request('https://g.dev/stats', { headers: { cookie: 'foo=bar' } }), SESSION_COOKIE)).toBe(null);
  });
});

describe('passwordsMatch', () => {
  it('accepts the right password', async () => {
    expect(await passwordsMatch('hunter2', 'hunter2')).toBe(true);
  });

  it('rejects a wrong password of the same or different length', async () => {
    expect(await passwordsMatch('hunter3', 'hunter2')).toBe(false);
    expect(await passwordsMatch('short', 'a much longer password')).toBe(false);
  });

  it('rejects the empty string against a real password', async () => {
    expect(await passwordsMatch('', 'hunter2')).toBe(false);
  });
});
