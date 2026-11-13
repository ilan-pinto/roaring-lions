// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountClient, AccountError, IdentityView, MeResult } from '../account/client';
import { ACCOUNT_BINDING_KEY, readBinding } from '../account/binding';
import { canonicalCampaign } from '@lions/economy';
import type { ClaimBody, ClaimResult } from '@lions/economy';
import { memoryLedgerStore } from '../ledger-store';
import { LEDGER_KEY } from '../main-keys';
import { confirmedState } from '../account/fixtures';
import { sha256Hex } from '../account/signed-in';
import { parseSlot } from '@lions/economy';
import { unusedA2Client } from '../account/fixtures';
import { setCatalogue, t } from '../i18n/t';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import type { MatchView, MatchesView } from '@lions/economy';
import { showProfile, type ProfileDeps } from './profile';
import { accountLedgerStore } from '../account/account-store';
import { ACCOUNT_CACHE_KEY, writeCache } from '../account/cache';
import { writeBinding } from '../account/binding';
import { cacheOf, memStorage, opIds, world } from '../account/fixtures';
import { HELD_KEY, readHeld } from '../account/local-held';
import { outboxKey, writeOutbox, heartbeatKey } from '../account/outbox';
import { signOut as syncSignOut, startSync, wipeMember } from '../account/sync';
import { clientFor, FakeServer, makeScheduler } from '../account/sync-kit';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function memStore(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

const steam = { id: 'ident-1', provider: 'steam', label: null, createdAt: 1, lastUsedDay: null, steamId: '76561197960287930' };
const signedIn = (identities: IdentityView[] = [steam]): MeResult => ({ kind: 'signedIn', publicId: 'ABCD2345', displayName: 'Ilan', showRecord: false, fresh: true, identities });

function stub(over: Partial<AccountClient> = {}): AccountClient & { calls: string[] } {
  const calls: string[] = [];
  const c: AccountClient = {
    enabled: true,
    open: async () => true,
    me: async () => ({ kind: 'signedOut' }),
    steamStart: async () => ({ url: 'https://steam.example/login' }),
    logout: async () => (calls.push('logout'), 'ok'),
    logoutAll: async () => (calls.push('logoutAll'), 'ok'),
    patchProfile: async (p) => (calls.push('patch:' + JSON.stringify(p)), 'ok'),
    deleteIdentity: async (id) => (calls.push('rm:' + id), 'ok'),
    exportData: async () => new Blob(['{}']),
    deleteAccount: async (o) => (calls.push('delete:' + JSON.stringify(o)), 'ok'),
    gone: async () => 'unknown',
    ...unusedA2Client,
    matches: async () => ({ ok: true, status: 200, body: { matches: [], next: null, record: { won: 0, lost: 0, drawn: 0 } } }),
    ...over,
  };
  return Object.assign(c, { calls });
}

function mount(client: AccountClient, over: Partial<ProfileDeps> = {}, store = memStore()) {
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  const navigated: string[] = [];
  const reloads: number[] = [];
  const dispose = showProfile(stage, {
    client,
    store,
    query: new URLSearchParams(),
    telemetryPlayer: () => 'tel-player',
    navigate: (h) => void navigated.push(h),
    reload: () => void reloads.push(1),
    ...over,
  });
  return { stage, dispose, navigated, store, reloads };
}

const btn = (stage: HTMLElement, label: string): HTMLButtonElement => {
  const b = [...stage.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent === label);
  if (!b) throw new Error('no button ' + label);
  return b;
};

describe('showProfile', () => {
  it('shows the sign-in button and the privacy line to a guest', async () => {
    const { stage } = mount(stub());
    await flush();
    expect(btn(stage, t('profile.signIn'))).toBeTruthy();
    expect(stage.textContent).toContain(t('profile.privacy'));
  });

  it('offers Create an account and Sign in as two buttons that both start steam-login (switch open)', async () => {
    const starts: string[] = [];
    const { stage } = mount(stub({ steamStart: async (p) => (starts.push(p), { url: 'https://steam.example/x' }) }));
    await flush();
    expect(btn(stage, t('profile.signUp'))).toBeTruthy();
    expect(btn(stage, t('profile.signIn'))).toBeTruthy();
    expect(stage.textContent).toContain(t('profile.signUpHint'));
    expect(stage.textContent).not.toContain(t('profile.signUpClosed'));
    btn(stage, t('profile.signUp')).click();
    await flush();
    btn(stage, t('profile.signIn')).click();
    await flush();
    expect(starts).toEqual(['steam-login', 'steam-login']);
  });

  it('hides sign-up and says so when the switch is closed or unreachable; sign-in stays', async () => {
    for (const open of [async () => false, async () => Promise.reject(new Error('x'))]) {
      const { stage, dispose } = mount(stub({ open }));
      await flush();
      expect(Array.from(stage.querySelectorAll('button')).some((b) => b.textContent === t('profile.signUp'))).toBe(false);
      expect(btn(stage, t('profile.signIn'))).toBeTruthy();
      expect(stage.textContent).toContain(t('profile.signUpClosed'));
      dispose();
    }
  });

  it('links to /privacy, as a guest and when signed in', async () => {
    for (const me of [{ kind: 'signedOut' } as MeResult, signedIn()]) {
      const { stage, dispose } = mount(stub({ me: async () => me }));
      await flush();
      expect(stage.querySelector('a[href="/privacy"]')?.textContent).toBe(t('profile.privacyLink'));
      dispose();
    }
  });

  it('sign-in starts steam-login and navigates to the returned url', async () => {
    const starts: string[] = [];
    const { stage, navigated } = mount(stub({ steamStart: async (p) => (starts.push(p), { url: 'https://steam.example/x' }) }));
    await flush();
    btn(stage, t('profile.signIn')).click();
    await flush();
    expect(starts).toEqual(['steam-login']);
    expect(navigated).toEqual(['https://steam.example/x']);
  });

  it('shows the name and the SteamID when signed in', async () => {
    const { stage } = mount(stub({ me: async () => signedIn() }));
    await flush();
    expect(stage.querySelector<HTMLInputElement>('input[type=text]')?.value).toBe('Ilan');
    expect(stage.textContent).toContain(t('profile.identity.steam', { id: '76561197960287930' }));
    expect(stage.textContent).toContain(t('profile.publicId', { id: 'ABCD2345' }));
  });

  it('shows the result line for r=closed', async () => {
    const { stage } = mount(stub(), { query: new URLSearchParams('accounts&r=closed') });
    await flush();
    expect(stage.textContent).toContain(t('profile.result.closed'));
  });

  it('ignores an unknown r', async () => {
    const { stage } = mount(stub(), { query: new URLSearchParams('r=bogus') });
    await flush();
    expect(stage.querySelector('.rl-profile__status')?.textContent).toBe('');
  });

  it('disables Remove for the only identity and enables it with two', async () => {
    const one = mount(stub({ me: async () => signedIn() }));
    await flush();
    expect(btn(one.stage, t('profile.identity.remove')).disabled).toBe(true);
    expect(one.stage.textContent).toContain(t('profile.identity.last'));
    const two = mount(stub({ me: async () => signedIn([steam, { ...steam, id: 'ident-2' }]) }));
    await flush();
    const removes = [...two.stage.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === t('profile.identity.remove'));
    expect(removes.length, 'one Remove button per identity').toBe(2);
    for (const b of removes) expect(b.disabled).toBe(false);
  });

  it('an identity with no label and no Steam id shows translated copy, never the raw provider token', async () => {
    const { stage } = mount(stub({ me: async () => signedIn([steam, { id: 'ident-pk', provider: 'passkey', label: null, createdAt: steam.createdAt, lastUsedDay: null }]) }));
    await flush();
    expect(stage.textContent).toContain(t('profile.identity.other'));
    expect(stage.textContent).not.toContain('passkey');
  });

  it('rejects a 2-character name without calling the server, and saves a good one', async () => {
    const c = stub({ me: async () => signedIn() });
    const { stage } = mount(c);
    await flush();
    const input = stage.querySelector<HTMLInputElement>('input[type=text]');
    if (!input) throw new Error('no input');
    input.value = 'ab';
    btn(stage, t('profile.name.save')).click();
    await flush();
    expect(stage.textContent).toContain(t('profile.name.invalid'));
    expect(c.calls.filter((x) => x.startsWith('patch'))).toEqual([]);
    input.value = ' Ilan P ';
    btn(stage, t('profile.name.save')).click();
    await flush();
    expect(c.calls).toContain('patch:{"displayName":"Ilan P"}');
  });

  it('sign out with no account store logs out, forgets the device id (§0.46) and reloads', async () => {
    const DEV = '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc';
    const store = memStore({ [ACCOUNT_BINDING_KEY]: JSON.stringify({ version: 1, publicId: 'ABCD2345', deviceId: DEV }) });
    const c = stub({ me: async () => signedIn() });
    const { stage, reloads } = mount(c, {}, store);
    await flush();
    btn(stage, t('profile.signOut')).click();
    await flush();
    expect(c.calls).toContain('logout');
    expect(reloads).toHaveLength(1);
    expect(readBinding(store)).toEqual({ version: 1, publicId: 'ABCD2345' }); // the binding stays, the claim id and mark go
  });

  it('a failed sign out says so and does not claim success (A1 follow-up 1)', async () => {
    const err: AccountError = { error: 'error', status: 500 };
    const c = stub({ me: async () => signedIn(), logout: async () => err, logoutAll: async () => err });
    const { stage } = mount(c);
    await flush();
    for (const label of [t('profile.signOut'), t('profile.signOutAll')]) {
      btn(stage, label).click();
      await flush();
      expect(stage.textContent).toContain(t('profile.error'));
      expect(stage.textContent).not.toContain(t('profile.signedOut'));
    }
  });

  it.each([
    ['reauth', 'profile.reauth'],
    ['last_identity', 'profile.identity.last'],
  ] as const)('removing an identity answered %s shows its own message (A1 follow-up 2)', async (code, key) => {
    const two = [steam, { ...steam, id: 'ident-2' }];
    const c = stub({ me: async () => signedIn(two), deleteIdentity: async () => ({ error: code, status: code === 'reauth' ? 403 : 409 }) });
    const { stage } = mount(c);
    await flush();
    [...stage.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === t('profile.identity.remove'))?.click();
    await flush();
    const status = stage.querySelector('.rl-bad');
    expect(status?.textContent).toBe(t(key));
    expect(status?.textContent).not.toBe(t('profile.error'));
  });

  it('shows the deleted line when the tombstone answers', async () => {
    const store = memStore({ [ACCOUNT_BINDING_KEY]: JSON.stringify({ version: 1, publicId: 'ABCD2345' }) });
    const { stage } = mount(stub({ gone: async () => 'deleted' }), {}, store);
    await vi.waitFor(() => expect(stage.textContent).toContain(t('profile.deleted')));
    expect(store.m.has(ACCOUNT_BINDING_KEY)).toBe(false);
  });

  it('delete confirms first, honours the unchecked telemetry box, then clears the binding', async () => {
    const store = memStore({ [ACCOUNT_BINDING_KEY]: JSON.stringify({ version: 1, publicId: 'ABCD2345' }) });
    const c = stub({ me: async () => signedIn() });
    const { stage } = mount(c, {}, store);
    await flush();
    const box = stage.querySelector<HTMLInputElement>('.rl-profile__telemetry input');
    expect(box?.checked).toBe(false);
    btn(stage, t('profile.delete')).click();
    expect(c.calls.some((x) => x.startsWith('delete'))).toBe(false);
    expect(document.querySelector('.rl-confirm')).not.toBeNull();
    (document.querySelector('.rl-confirm__yes') as HTMLButtonElement).click();
    await flush();
    expect(c.calls).toContain('delete:{}');
    expect(stage.textContent).toContain(t('profile.delete.done'));
    expect(store.m.has(ACCOUNT_BINDING_KEY)).toBe(false);
  });

  it('delete with the box ticked sends the telemetry player', async () => {
    const c = stub({ me: async () => signedIn() });
    const { stage } = mount(c);
    await flush();
    const box = stage.querySelector<HTMLInputElement>('.rl-profile__telemetry input');
    if (!box) throw new Error('no box');
    box.checked = true;
    btn(stage, t('profile.delete')).click();
    (document.querySelector('.rl-confirm__yes') as HTMLButtonElement).click();
    await flush();
    expect(c.calls).toContain('delete:{"telemetryPlayer":"tel-player"}');
  });

  it('cancelling the confirm deletes nothing', async () => {
    const c = stub({ me: async () => signedIn() });
    const { stage } = mount(c);
    await flush();
    btn(stage, t('profile.delete')).click();
    (document.querySelector('.rl-confirm__no') as HTMLButtonElement).click();
    await flush();
    expect(c.calls.some((x) => x.startsWith('delete'))).toBe(false);
  });

  it('delete on reauth shows the line and a sign-in button that starts steam-login', async () => {
    const starts: string[] = [];
    const err: AccountError = { error: 'reauth', status: 403 };
    const c = stub({ me: async () => signedIn(), deleteAccount: async () => err, steamStart: async (p) => (starts.push(p), { url: 'https://s/x' }) });
    const { stage } = mount(c);
    await flush();
    btn(stage, t('profile.delete')).click();
    (document.querySelector('.rl-confirm__yes') as HTMLButtonElement).click();
    await flush();
    expect(stage.textContent).toContain(t('profile.reauth'));
    expect(stage.querySelector('.rl-profile__reauth')).not.toBeNull();
    (stage.querySelector('.rl-profile__reauth') as HTMLButtonElement).click();
    await flush();
    expect(starts).toEqual(['steam-login']);
  });

  it('downloads through an object URL and revokes it after the click', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const clicks: { href: string; download: string }[] = [];
    URL.createObjectURL = () => (created.push('blob:x'), 'blob:x');
    URL.revokeObjectURL = (u: string) => void revoked.push(u);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
      expect(revoked).toEqual([]);
    });
    const { stage } = mount(stub({ me: async () => signedIn() }));
    await flush();
    btn(stage, t('profile.export')).click();
    await flush();
    click.mockRestore();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.download).toBe('roaring-lions-account.json');
    expect(revoked).toEqual(['blob:x']);
  });

  it('adds nothing after dispose when me() resolves late, and closes an open confirm', async () => {
    let release: (m: MeResult) => void = () => {};
    const late = new Promise<MeResult>((r) => (release = r));
    const { stage, dispose } = mount(stub({ me: () => late }));
    const detached = stage.firstElementChild;
    expect(detached).not.toBeNull();
    dispose();
    release(signedIn());
    await flush();
    expect(stage.children).toHaveLength(0);
    expect(stage.querySelector('button')).toBeNull();
    // The removed wrap is where a late render would land: it must stay as it was (only the Main menu link).
    expect(detached?.querySelector('button')).toBeNull();

    const c = stub({ me: async () => signedIn() });
    const m = mount(c);
    await flush();
    btn(m.stage, t('profile.delete')).click();
    expect(document.querySelector('.rl-confirm')).not.toBeNull();
    m.dispose();
    expect(document.querySelector('.rl-confirm')).toBeNull();
    await flush();
    expect(c.calls.some((x) => x.startsWith('delete'))).toBe(false);
  });
});

describe('the claim panel (GH-1075 A2)', () => {
  function claimRig(opts: { progress: boolean; claimedAt?: number; withClaim?: boolean }) {
    const guest = memoryLedgerStore(opts.progress ? { [LEDGER_KEY]: JSON.stringify({ 'campaign.completed_missions': ['m1'] }) } : {});
    const storage = {
      getItem: (k: string) => guest.map.get(k) ?? null,
      setItem: (k: string, v: string) => void guest.map.set(k, v),
      removeItem: (k: string) => void guest.map.delete(k),
    };
    storage.setItem(ACCOUNT_BINDING_KEY, JSON.stringify({ version: 1, publicId: 'ABCD2345', ...(opts.claimedAt === undefined ? {} : { claimedAt: opts.claimedAt }) }));
    const calls = { claim: 0, state: 0, downloads: [] as { name: string; json: string }[], claimed: 0 };
    const client = stub({
      me: async () => signedIn(),
      claim: async (body: ClaimBody) => {
        calls.claim++;
        const result: ClaimResult = {
          coins: 0, earned: 0, coupons: [], carried: [], notCarried: [], slots: [], state: confirmedState(),
          campaign: body.campaign === null ? null : { deviceId: 'campaign', status: 'stored', serverId: 'c', digest: await sha256Hex(canonicalCampaign(body.campaign)) },
        };
        return { ok: true as const, status: 200 as const, body: result };
      },
      state: async () => (calls.state++, { ok: true as const, status: 200 as const, body: confirmedState() }),
    });
    const m = mount(client, {
      store: storage,
      claim: opts.withClaim === false ? undefined : { guest, download: (name, json) => void calls.downloads.push({ name, json }), onClaimed: () => void calls.claimed++, now: () => 42 },
    }, storage as never);
    return { ...m, guest, storage, calls };
  }

  it('shows the gain, a download, Move it and Not now to a signed-in guest device with progress', async () => {
    const r = claimRig({ progress: true });
    await flush();
    expect(r.stage.textContent).toContain(t('account.claim.lead'));
    for (const k of ['account.claim.download', 'account.claim.move', 'account.claim.notNow']) expect(btn(r.stage, t(k))).toBeTruthy();
    btn(r.stage, t('account.claim.notNow')).click();
    expect(r.stage.querySelector('.rl-profile__claim')).toBeNull();
    expect(r.calls.claim).toBe(0);
  });

  it('Download a copy first hands over the active campaign as a slot, and changes nothing', async () => {
    const r = claimRig({ progress: true });
    await flush();
    btn(r.stage, t('account.claim.download')).click();
    expect(r.calls.downloads).toHaveLength(1);
    const slot = parseSlot(r.calls.downloads[0].json);
    expect(slot.ledger['campaign.completed_missions']).toEqual(['m1']);
    expect(r.guest.map.has(LEDGER_KEY)).toBe(true);
  });

  it('Move it claims, removes the guest keys, and re-enters the app', async () => {
    const r = claimRig({ progress: true });
    await flush();
    btn(r.stage, t('account.claim.move')).click();
    for (let i = 0; i < 100 && r.calls.claimed === 0; i++) await new Promise((res) => setTimeout(res, 5)); // Web Crypto resolves off the microtask queue
    expect(r.calls.claim).toBe(1);
    expect(r.guest.map.has(LEDGER_KEY)).toBe(false);
    expect(readBinding(r.storage)?.claimedAt).toBe(42);
    expect(r.calls.claimed).toBe(1);
  });

  it('an empty device shows no panel, makes no claim request, sets claimedAt and loads the state (§0.41)', async () => {
    const r = claimRig({ progress: false });
    for (let i = 0; i < 10; i++) await flush();
    expect(r.stage.querySelector('.rl-profile__claim')).toBeNull();
    expect(r.calls.claim).toBe(0);
    expect(r.calls.state).toBe(1);
    expect(readBinding(r.storage)?.claimedAt).toBeDefined();
  });

  it('shows no panel on a claimed device, or when the screen was given no claim', async () => {
    for (const o of [{ progress: true, claimedAt: 5 }, { progress: true, withClaim: false }]) {
      const r = claimRig(o);
      for (let i = 0; i < 10; i++) await flush();
      expect(r.stage.querySelector('.rl-profile__claim')).toBeNull();
      expect(r.calls.claim).toBe(0);
    }
  });
});

describe('C1: sign-out and deletion go through the sync module over the account store (§0.46)', () => {
  const DEV = '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc';
  function accountRig() {
    const server = new FakeServer();
    server.failWith.set('A', 0); // the queued op cannot be sent: sign-out must file it
    const storage = memStorage();
    const sched = makeScheduler();
    writeBinding(storage, { version: 1, publicId: 'pub1', deviceId: DEV, claimedAt: 5 });
    const cache = cacheOf(server.snapshot());
    writeCache(storage, cache);
    const client = { ...clientFor(server, { me: () => ({ kind: 'signedIn', publicId: 'pub1', displayName: 'D', showRecord: false, fresh: false, identities: [steam] }) }), logoutAll: async () => (server.calls.push({ name: 'logoutAll' }), 'ok' as const), deleteAccount: async () => 'ok' as const };
    const store = accountLedgerStore({ storage, cache, world, onChange: () => {}, newOpId: opIds(), tabId: 'T1' });
    const sync = startSync({ store, client, storage, now: sched.now, schedule: sched.schedule });
    store.sync.setOps([{ kind: 'campaign', opId: 'A', campaign: { ledger: {}, brigade: store.readAccount(), tutorialDone: false } }]);
    // a sibling tab of the same member, with a heartbeat
    writeOutbox(storage, 'T2', [{ kind: 'slot.delete', opId: 'D', slotId: 'x' }], 'pub1');
    storage.setItem(heartbeatKey('T2'), '1');
    const wired: Partial<ProfileDeps> = {
      signOut: (logout) => syncSignOut({ sync, store, client, logout, storage, now: sched.now, schedule: sched.schedule }),
      wipeDeleted: () => {
        sync.stop();
        wipeMember({ store, storage, now: sched.now });
      },
      store: storage,
    };
    return { server, storage, client, wired };
  }
  const cleared = (storage: ReturnType<typeof memStorage>): void => {
    expect(storage.getItem(ACCOUNT_CACHE_KEY)).toBeNull();
    expect(storage.getItem(outboxKey('T1'))).toBeNull();
    expect(storage.getItem(outboxKey('T2'))).toBeNull();
    expect(storage.getItem(heartbeatKey('T2'))).toBeNull();
    const b = readBinding(storage);
    expect(b?.claimedAt).toBeUndefined();
    expect(b?.deviceId).toBeUndefined();
  };

  it('"Sign out" and "Sign out everywhere" flush, file what is left, clear the cache, every outbox key, claimedAt and deviceId, then reload', async () => {
    for (const label of [t('profile.signOut'), t('profile.signOutAll')]) {
      const r = accountRig();
      const { stage, reloads } = mount(r.client, r.wired);
      await vi.waitFor(() => expect(btn(stage, label)).toBeTruthy());
      btn(stage, label).click();
      await vi.waitFor(() => expect(reloads).toHaveLength(1), { timeout: 3000 });
      cleared(r.storage);
      expect(readHeld(r.storage).map((h) => [h.id, h.reason]).sort()).toEqual([['A', 'refused']]);
      expect(r.server.calls.some((c) => c.name === (label === t('profile.signOut') ? 'logout' : 'logoutAll'))).toBe(true);
      expect(r.storage.getItem(HELD_KEY)).not.toBeNull();
    }
  });

  it('a rejected sign-out shows profile.error, does not reload and clears nothing', async () => {
    const r = accountRig();
    const failing = { ...r.client, logout: async () => ({ error: 'error', status: 500 }) as AccountError };
    const { stage, reloads } = mount(failing, { ...r.wired, signOut: (logout) => syncSignOut({ sync: { flush: async () => {}, stop: () => {} }, store: accountLedgerStore({ storage: r.storage, cache: cacheOf(), world, onChange: () => {}, newOpId: opIds(), tabId: 'T1' }), client: failing, logout, storage: r.storage, now: () => 1, schedule: () => () => {} }) });
    await vi.waitFor(() => expect(btn(stage, t('profile.signOut'))).toBeTruthy());
    btn(stage, t('profile.signOut')).click();
    await vi.waitFor(() => expect(stage.textContent).toContain(t('profile.error')));
    expect(reloads).toHaveLength(0);
    expect(r.storage.getItem(ACCOUNT_CACHE_KEY)).not.toBeNull();
  });

  it('deleting the account stops the loop, wipes the member\'s cache and every outbox key, clears the binding, then reloads', async () => {
    const r = accountRig();
    const { stage, reloads } = mount(r.client, r.wired);
    await vi.waitFor(() => expect(btn(stage, t('profile.delete'))).toBeTruthy());
    btn(stage, t('profile.delete')).click();
    (document.querySelector('.rl-confirm__yes') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(reloads).toHaveLength(1), { timeout: 3000 });
    expect(r.storage.getItem(ACCOUNT_CACHE_KEY)).toBeNull();
    expect(r.storage.getItem(outboxKey('T1'))).toBeNull();
    expect(r.storage.getItem(outboxKey('T2'))).toBeNull();
    expect(readBinding(r.storage)).toBeNull();
  });

  it('NB4: a sign-out that completes after the player left the profile still reloads', async () => {
    const release: { go: () => void } = { go: () => {} };
    const gate = new Promise<void>((r) => (release.go = r));
    const { stage, dispose, reloads } = mount(stub({ me: async () => signedIn() }), { signOut: async () => gate });
    await vi.waitFor(() => expect(btn(stage, t('profile.signOut'))).toBeTruthy());
    btn(stage, t('profile.signOut')).click();
    dispose();
    release.go();
    await vi.waitFor(() => expect(reloads).toHaveLength(1));
  });
});

describe('the history and the record (GH-1075 A3)', () => {
  afterEach(() => setCatalogue('en', en));
  const view = (over: Partial<MatchView> & { opponent: MatchView['opponent'] }): MatchView => ({
    code: 'ABCDE',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    map: 'tel_marum',
    matchup: 'kdf-v-sarim',
    winMode: null,
    kit: 'k',
    reason: 'annihilation',
    winnerSeat: 0,
    ticks: 100,
    agreed: true,
    seat: 0,
    side: 'kdf',
    ...over,
  });
  const answer = (matches: MatchView[], over: Partial<MatchesView> = {}): MatchesView => ({ matches, next: null, record: { won: 2, lost: 1, drawn: 0 }, ...over });
  const withMatches = (a: MatchesView | ((before?: string) => MatchesView), over: Partial<AccountClient> = {}) =>
    stub({
      me: async () => signedIn(),
      matches: async (before) => ({ ok: true, status: 200, body: typeof a === 'function' ? a(before) : a }),
      ...over,
    });
  const rows = (stage: HTMLElement): string[] => [...stage.querySelectorAll('.rl-profile__match')].map((x) => x.textContent ?? '');

  it('history_shows_guest_never_a_callsign', async () => {
    const stray = { callsign: 'ZZ-SENTINEL-CALL' }; // a server bug, simulated: on the match and on the opponent
    const guest = { ...view({ opponent: { kind: 'guest', ...stray } as MatchView['opponent'] }), ...stray } as MatchView;
    const { stage } = mount(withMatches(answer([guest])));
    await flush();
    expect(rows(stage)[0]).toContain(t('profile.history.guest'));
    expect(stage.textContent).not.toContain('ZZ-SENTINEL-CALL');
    expect(stage.innerHTML).not.toContain('ZZ-SENTINEL-CALL');
    setCatalogue('pseudo', en, pseudo);
    const again = mount(withMatches(answer([guest])));
    await flush();
    expect(rows(again.stage)[0]).toContain(pseudo(en['profile.history.guest']));
  });

  it('history_kinds', async () => {
    const { stage } = mount(
      withMatches(
        answer([
          view({ opponent: { kind: 'member', name: 'Dana', publicId: 'K7Q2M4XA' } }),
          view({ opponent: { kind: 'bot', model: null }, winnerSeat: 1 }),
          view({ opponent: { kind: 'deleted' }, winnerSeat: null }),
          view({ opponent: { kind: 'guest' }, agreed: false }),
        ])
      )
    );
    await flush();
    const r = rows(stage);
    expect(r[0]).toContain('Dana · K7Q2M4XA');
    expect(r[0]).toContain(t('profile.history.won'));
    expect(r[0]).toContain('Tel Marum');
    expect(r[0]).not.toContain(t('profile.history.unconfirmed'));
    expect(r[1]).toContain(t('profile.history.lost'));
    expect(r[1]).toContain(t('profile.history.bot'));
    expect(r[2]).toContain(t('profile.history.deleted'));
    expect(r[2]).toContain(t('profile.history.drawn'));
    expect(r[3]).toContain(t('profile.history.unconfirmed'));
  });

  it('history_bot_models', async () => {
    const a = answer([
      view({ opponent: { kind: 'bot', model: { id: 'claude-haiku-5-5' } } }),
      view({ opponent: { kind: 'bot', model: { id: 'other', name: '<i>MyNet</i>' } } }),
      view({ opponent: { kind: 'bot', model: null } }),
    ]);
    setCatalogue('pseudo', en, pseudo);
    const { stage } = mount(withMatches(a));
    await flush();
    const r = rows(stage);
    expect(r[0]).toContain(t('bot.model.claude-haiku-5-5'));
    expect(r[1]).toContain('<i>MyNet</i>');
    expect(stage.querySelector('.rl-profile__match i')).toBeNull();
    expect(r[2]?.endsWith(t('profile.history.bot'))).toBe(true);
  });

  it('history_record_counts_everything', async () => {
    const { stage } = mount(withMatches(answer([view({ opponent: { kind: 'guest' } })], { record: { won: 7, lost: 3, drawn: 2 } })));
    await flush();
    expect(stage.querySelector('.rl-profile__record')?.textContent).toBe(t('profile.record', { won: 7, lost: 3, drawn: 2 }));
  });

  it('show_record_toggle', async () => {
    const c = withMatches(answer([]));
    const { stage } = mount(c);
    await flush();
    const cb = stage.querySelector<HTMLInputElement>('.rl-profile__show-record input')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await flush();
    expect(c.calls.filter((x) => x.startsWith('patch:'))).toEqual(['patch:{"showRecord":true}']);
    expect(cb.checked).toBe(true);

    const bad = withMatches(answer([]), { patchProfile: async () => ({ error: 'error', status: 500 }) });
    const m = mount(bad);
    await flush();
    const cb2 = m.stage.querySelector<HTMLInputElement>('.rl-profile__show-record input')!;
    cb2.checked = true;
    cb2.dispatchEvent(new Event('change'));
    await flush();
    expect(cb2.checked).toBe(false);
    expect(m.stage.querySelector('.rl-profile__status')?.textContent).toBe(t('profile.error'));
  });

  it('more_pages', async () => {
    const seen: (string | undefined)[] = [];
    const { stage } = mount(
      withMatches((before) => {
        seen.push(before);
        return before === undefined
          ? answer([view({ opponent: { kind: 'guest' } })], { next: '1731400000.K7Q2' })
          : answer([view({ opponent: { kind: 'deleted' } })], { next: null });
      })
    );
    await flush();
    expect(rows(stage)).toHaveLength(1);
    btn(stage, t('profile.history.more')).click();
    await flush();
    expect(seen).toEqual([undefined, '1731400000.K7Q2']);
    expect(rows(stage)).toHaveLength(2);
    expect(stage.querySelector<HTMLButtonElement>('.rl-profile__more')?.hidden).toBe(true);
  });
});
