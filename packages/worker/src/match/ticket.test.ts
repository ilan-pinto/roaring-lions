import { describe, it, expect } from 'vitest';
import { signTicket, verifyTicket } from './ticket';

const NOW = 1_790_000_000_000;
const SECRET = 'a long random ticket secret';
const T = { matchId: 'm-1', seat: 1 as const, player: 'p-1', exp: NOW + 60_000 };

describe('tickets', () => {
  it('round-trips a fresh ticket', async () => {
    expect(await verifyTicket(SECRET, await signTicket(SECRET, T), NOW)).toEqual({ ...T, role: 'seat' });
  });
  it('fails closed on expiry, a tampered seat, another secret, and garbage', async () => {
    expect(await verifyTicket(SECRET, await signTicket(SECRET, { ...T, exp: NOW - 1 }), NOW)).toBeNull();
    const raw = await signTicket(SECRET, T);
    const [payload, sig] = raw.split('.');
    const forged = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    forged.seat = 0;
    const forgedPayload = btoa(JSON.stringify(forged)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifyTicket(SECRET, `${forgedPayload}.${sig}`, NOW)).toBeNull();
    expect(await verifyTicket('the stats password', raw, NOW)).toBeNull();
    expect(await verifyTicket(SECRET, 'nope', NOW)).toBeNull();
    expect(await verifyTicket(SECRET, '', NOW)).toBeNull();
  });
  it('refuses an empty secret on both sides', async () => {
    await expect(signTicket('', T)).rejects.toThrow();
    const raw = await signTicket(SECRET, T);
    expect(await verifyTicket('', raw, NOW)).toBeNull();
  });
  it('an advisor ticket round-trips with its scope', async () => {
    for (const scope of ['advise', 'assist'] as const) {
      const adv = { ...T, role: 'advisor' as const, scope };
      expect(await verifyTicket(SECRET, await signTicket(SECRET, adv), NOW)).toEqual(adv);
    }
  });
  it('an advisor ticket with no scope, or a scope that is not one, verifies to null', async () => {
    expect(await verifyTicket(SECRET, await signTicket(SECRET, { ...T, role: 'advisor' }), NOW)).toBeNull();
    const bad = { ...T, role: 'advisor', scope: 'command' } as unknown as typeof T;
    expect(await verifyTicket(SECRET, await signTicket(SECRET, bad), NOW)).toBeNull();
  });
  it('a role that is neither seat nor advisor verifies to null; a seat ticket drops a stray scope', async () => {
    const odd = { ...T, role: 'admin' } as unknown as typeof T;
    expect(await verifyTicket(SECRET, await signTicket(SECRET, odd), NOW)).toBeNull();
    const seat = await verifyTicket(SECRET, await signTicket(SECRET, { ...T, role: 'seat', scope: 'assist' }), NOW);
    expect(seat).toEqual({ ...T, role: 'seat' });
  });
  it('a pre-N4 ticket (no role in its payload) verifies as a seat', async () => {
    const raw = await signTicket(SECRET, T);
    expect(JSON.parse(atob(raw.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')))).not.toHaveProperty('role');
    expect((await verifyTicket(SECRET, raw, NOW))?.role).toBe('seat');
  });
});
