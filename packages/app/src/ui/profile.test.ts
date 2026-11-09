// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
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
import { t } from '../i18n/t';
import { showProfile, type ProfileDeps } from './profile';

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
    ...over,
  };
  return Object.assign(c, { calls });
}

function mount(client: AccountClient, over: Partial<ProfileDeps> = {}, store = memStore()) {
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  const navigated: string[] = [];
  const dispose = showProfile(stage, {
    client,
    store,
    query: new URLSearchParams(),
    telemetryPlayer: () => 'tel-player',
    navigate: (h) => void navigated.push(h),
    ...over,
  });
  return { stage, dispose, navigated, store };
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

  it('sign out shows the signed-out line and keeps the binding', async () => {
    const c = stub({ me: async () => signedIn() });
    const { stage, store } = mount(c);
    await flush();
    btn(stage, t('profile.signOut')).click();
    await flush();
    expect(c.calls).toContain('logout');
    expect(stage.textContent).toContain(t('profile.signedOut'));
    expect(store.m.get(ACCOUNT_BINDING_KEY)).toContain('ABCD2345');
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
    const box = stage.querySelector<HTMLInputElement>('input[type=checkbox]');
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
    const box = stage.querySelector<HTMLInputElement>('input[type=checkbox]');
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
