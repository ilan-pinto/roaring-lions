// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ParsedWorld } from '../campaign';
import type { AccountClient } from './client';
import { menuAccount, menuAccountSource } from './menu-account';
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

describe('the chip follows the device binding on every mount (GH-1075)', () => {
  const chipLabel = (s: HTMLElement): string => s.querySelector('.rl-menu__acct-name')?.textContent ?? '';
  function source(f: ReturnType<typeof fake>, bound: { v: boolean }) {
    return menuAccountSource({ on: true, hasBinding: () => bound.v, loadClient: f.loadClient, onOpen: () => {} });
  }
  async function mount(src: ReturnType<typeof source>): Promise<HTMLElement> {
    const acct = src();
    const stage = document.createElement('div');
    const dispose = showMenu(stage, { base: '/', version: '0.0.0', world, tutorial, account: { enabled: true, ...acct } });
    await acct.open;
    await acct.name;
    await new Promise((r) => setTimeout(r, 0));
    void dispose;
    return stage;
  }
  it('a sign-in made after the first mount shows on the next mount, with no reload', async () => {
    const f = fake(true, 'signedIn');
    const bound = { v: false };
    const src = source(f, bound);
    expect(chipLabel(await mount(src))).toBe('Sign up');
    bound.v = true; // the profile / return flow writes the binding
    expect(chipLabel(await mount(src))).toBe('Ilan');
    expect(f.calls.filter((c) => c === 'open')).toHaveLength(1); // the switch is asked once per page
  });
  it('a never-bound guest reads Sign up and calls no GET me', async () => {
    const f = fake(true);
    expect(chipLabel(await mount(source(f, { v: false })))).toBe('Sign up');
    expect(f.calls).not.toContain('me');
  });
  it('a bound device that is signed out reads Sign in', async () => {
    expect(chipLabel(await mount(source(fake(true, 'signedOut'), { v: true })))).toBe('Sign in');
  });
  it('a signed-in member reads their name and keeps the person icon', async () => {
    const stage = await mount(source(fake(true, 'signedIn'), { v: true }));
    expect(chipLabel(stage)).toBe('Ilan');
    expect(stage.querySelector('.rl-menu__acct-icon')).not.toBeNull();
  });
});
