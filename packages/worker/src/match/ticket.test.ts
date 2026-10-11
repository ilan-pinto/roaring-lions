import { describe, it, expect } from 'vitest';
import { signTicket, verifyTicket } from './ticket';

const NOW = 1_790_000_000_000;
const SECRET = 'a long random ticket secret';
const T = { matchId: 'm-1', seat: 1 as const, player: 'p-1', exp: NOW + 60_000 };

describe('tickets', () => {
  it('round-trips a fresh ticket', async () => {
    expect(await verifyTicket(SECRET, await signTicket(SECRET, T), NOW)).toEqual(T);
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
});
