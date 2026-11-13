// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ParsedWorld } from '../campaign';
import type { AccountClient } from './client';
import { menuAccount } from './menu-account';
import { showMenu } from '../ui/menu';

const world = { name: 'The Sahar Basin' } as unknown as ParsedWorld;
const tutorial = { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done: true };

function fake(open: boolean | 'throw', me: 'signedOut' | 'signedIn' = 'signedOut') {
  const calls: string[] = [];
  const client = {
    open: async () => {
      calls.push('open');
      if (open === 'throw') throw new Error('net');
      return open;
    },
    me: async () => {
      calls.push('me');
      return me === 'signedIn' ? { kind: 'signedIn', displayName: 'Ilan' } : { kind: 'signedOut' };
    },
  } as unknown as AccountClient;
  return { calls, loadClient: () => Promise.resolve(client) };
}

async function menuWith(f: ReturnType<typeof fake>, hasBinding: boolean) {
  let seen: boolean | null = null;
  const acct = menuAccount({ on: true, hasBinding, loadClient: f.loadClient, onOpen: (v) => (seen = v) });
  const stage = document.createElement('div');
  showMenu(stage, { base: '/', version: '0.0.0', world, tutorial, account: { enabled: true, ...acct } });
  await acct.open;
  await acct.name;
  await new Promise((r) => setTimeout(r, 0));
  return { stage, seen: seen as boolean | null };
}
const hasChip = (s: HTMLElement): boolean => s.querySelector('[data-act="profile"]') !== null;
const hasPrivacy = (s: HTMLElement): boolean => [...s.querySelectorAll('a')].some((a) => a.getAttribute('href')?.includes('privacy'));

describe('the account kill switch and the guest menu (GH-1075)', () => {
  it('an open switch keeps the chip and the privacy link, and tells the save prompt', async () => {
    const m = await menuWith(fake(true), false);
    expect(hasChip(m.stage)).toBe(true);
    expect(hasPrivacy(m.stage)).toBe(true);
    expect(m.seen).toBe(true);
  });
  it('a closed switch removes the chip and the privacy link, and the save prompt reads closed', async () => {
    const m = await menuWith(fake(false), false);
    expect(hasChip(m.stage)).toBe(false);
    expect(hasPrivacy(m.stage)).toBe(false);
    expect(m.seen).toBe(false);
  });
  it('an unreachable server reads as closed without throwing', async () => {
    const m = await menuWith(fake('throw'), false);
    expect(hasChip(m.stage)).toBe(false);
    expect(m.seen).toBe(false);
  });
  it('a closed switch keeps the chip of a signed-in member (export and delete still work)', async () => {
    const m = await menuWith(fake(false, 'signedIn'), true);
    expect(hasChip(m.stage)).toBe(true);
  });
  it('a guest menu (no binding) never calls GET me; a bound device does', async () => {
    const g = fake(true);
    await menuWith(g, false);
    expect(g.calls).not.toContain('me');
    const b = fake(true);
    await menuWith(b, true);
    expect(b.calls).toContain('me');
  });
  it('accounts off loads no client at all', () => {
    let loaded = 0;
    menuAccount({ on: false, hasBinding: true, loadClient: () => (loaded++, Promise.reject(new Error('x'))), onOpen: () => {} });
    expect(loaded).toBe(0);
  });
});
