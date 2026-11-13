/**
 * The profile screen (GH-1075 A1, `/profile`, with accounts on). A guest sees the sign-in button and the privacy
 * line; a signed-in player sees the name, the public id, the linked identities and the account verbs.
 *
 * Disposer contract: everything is mounted inside `stage` except the delete confirm, which this screen closes itself,
 * and a late promise (`me()`, a PATCH, an export) is ignored once `disposed` is set.
 */
import type { StorageLike } from '../brigade-account';
import { SAVE_VERSION, type MatchOpponent, type MatchView } from '@lions/economy';
import { maps } from '@lions/data';
import { clearBinding, clearDeviceId, readBinding } from '../account/binding';
import { claimQuietly, hasGuestProgress, readClaiming, runClaim, type ClaimOutcome } from '../account/claim';
import type { LedgerStore } from '../ledger-store';
import { exportSlot, readActive } from '../profile';
import { PROVIDERS, readReturnCode, readReturnProvider, type AccountClient, type AccountError, type IdentityView, type MeResult, type Provider, type ReturnCode } from '../account/client';
import { resolveSignedIn, type SignedInResult } from '../account/signed-in';
import { hasKey, t } from '../i18n/t';
import { routes } from '../shell/links';
import type { Disposer } from '../shell/router';
import { confirmDialog, type ConfirmHandle } from './confirm';
import { footBack, screenFoot } from './foot';
import { panel } from './panel';

export interface ProfileDeps {
  client: AccountClient;
  store: StorageLike | null;
  query: URLSearchParams;
  /** This browser's anonymous telemetry player id, or null while telemetry is off. */
  telemetryPlayer: () => string | null;
  /** Leaves the page for `href`: Steam's login URL is another origin, so main.ts passes a real page load. */
  navigate: (href: string) => void;
  /** A HARD reload of the app (`shell/links.ts`'s `reloadMenuHref`: the menu plus the sticky query keys), so the next boot chooses its store afresh. */
  reload: () => void;
  /**
   * Signed in with the server-backed store (§0.46): flush, file what is left, send `logout`, clear the cache, the outboxes, `claimedAt` and
   * `deviceId`. Absent on a boot with no account store; the screen then only logs out and forgets the device id. A rejection is shown as `profile.error`.
   */
  signOut?: (logout: () => Promise<'ok' | AccountError>) => Promise<void>;
  /** After the account was deleted here: stop the sync loop and clear the cache and every outbox and tab key of that member. */
  wipeDeleted?: () => void;
  /**
   * The guest-to-account claim (GH-1075 A2). Given only on a guest boot (accounts on, no claimed binding): `guest` is the
   * device's own store, `download` saves a file, `onClaimed` re-enters the app so the server-backed store is chosen.
   */
  claim?: { guest: LedgerStore; download: (name: string, json: string) => void; onClaimed: () => void; now?: () => number };
}

/** Google's unaltered mark (GH-1075 U4): `assets/brand/google-g.svg`, served at /brand/, drawn by an <img> so it keeps its own four colours. */
const GOOGLE_G_SRC = '/brand/google-g.svg';

/** What `GET open` reported: whether new accounts may be made, and which providers work. */
interface SignInInfo {
  open: boolean;
  providers: readonly Provider[];
}

/**
 * The result line. `p` (which provider the return was about) selects WORDING only: a code with a per-provider variant takes it, else the
 * neutral text. It never decides what the screen does. The `taken` text names no owner (the server says only that the account is another player's).
 */
function resultText(code: ReturnCode, provider: Provider | null): string {
  if (provider !== null) {
    const key = `profile.result.${code}.${provider}`;
    if (hasKey(key)) return t(key);
  }
  return t(`profile.result.${code}`);
}

const NAME_MIN = 3;
const NAME_MAX = 20;

type SignedInMe = Extract<MeResult, { kind: 'signedIn' }>;

function isError(x: unknown): x is AccountError {
  return typeof x === 'object' && x !== null && 'error' in x && 'status' in x;
}

const mapNames: Readonly<Record<string, { name: string }>> = maps;

/** The outcome is read off the winning seat against the member's own; an unconfirmed row says so beside it. */
function outcomeKey(m: MatchView): 'won' | 'lost' | 'drawn' {
  return m.winnerSeat === null ? 'drawn' : m.winnerSeat === m.seat ? 'won' : 'lost';
}

/**
 * The opponent, as text. A member shows `name · publicId`; a guest is only the Guest word (nothing else of a guest is
 * ever read, A3-4); a bot is the Bot word plus its declared model. A listed model is chrome (`t()`), a typed one is
 * data: it is set as text, never through `t()` and never as HTML.
 */
function opponentText(o: MatchOpponent): string {
  switch (o.kind) {
    case 'member':
      return `${o.name} · ${o.publicId}`;
    case 'guest':
      return t('profile.history.guest');
    case 'deleted':
      return t('profile.history.deleted');
    case 'bot': {
      const bot = t('profile.history.bot');
      const m = o.model;
      if (m === null) return bot;
      if (m.id === 'other') return 'name' in m ? `${bot} · ${m.name}` : bot;
      const key = `bot.model.${m.id}`;
      return hasKey(key) ? `${bot} · ${t(key)}` : bot;
    }
  }
}

export function showProfile(stage: HTMLElement, deps: ProfileDeps): Disposer {
  let disposed = false;
  let confirm: ConfirmHandle | null = null;

  const wrap = document.createElement('div');
  wrap.className = 'rl-menu rl-menu--profile';
  const p = panel({ rank: 'inspect', title: t('profile.title') });
  wrap.appendChild(p.el);
  const status = document.createElement('p');
  status.className = 'rl-profile__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const content = document.createElement('div');
  content.className = 'rl-profile__content';
  p.body.append(status, content);

  const foot = screenFoot();
  foot.start.appendChild(footBack(t('nav.backToMenu'), routes.menu()));
  wrap.appendChild(foot.el);
  stage.appendChild(wrap);

  const say = (text: string, bad = false): void => {
    status.textContent = text;
    status.classList.toggle('rl-bad', bad);
  };
  const line = (cls: string, text: string): HTMLElement => {
    const el = document.createElement('p');
    el.className = cls;
    el.textContent = text;
    return el;
  };
  const button = (label: string, onClick: () => void, cls = 'rl-btn'): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const failText = (e: AccountError): string => {
    if (e.error === 'closed') return t('profile.result.closed');
    if (e.status === 429 || e.error === 'limit') return t('profile.result.limit');
    return t('profile.error');
  };

  /** `GET open`, read once at mount. A failed read is "closed, nothing listed". `?google` lists Google for the lead's test before the flag opens (presentation only: the routes work whenever the secrets are set). */
  const info: Promise<SignInInfo> = (async () => {
    let open = false;
    let listed: readonly Provider[] = [];
    try {
      open = await deps.client.open();
    } catch {
      /* unreachable: closed */
    }
    try {
      listed = await deps.client.providers();
    } catch {
      /* unreachable: nothing listed */
    }
    const want = deps.query.has('google') ? [...listed, 'google' as const] : listed;
    return { open, providers: PROVIDERS.filter((x) => want.includes(x)) };
  })();

  /** Starts a provider's flow and leaves for its URL. `reauth` is the server saying the session is stale (a link or a removal needs a fresh sign-in). */
  const start = async (provider: Provider, mode: 'login' | 'link', onReauth?: () => void): Promise<void> => {
    const r = provider === 'google' ? await deps.client.googleStart(mode === 'login' ? 'google-login' : 'google-link') : await deps.client.steamStart(mode === 'login' ? 'steam-login' : 'steam-link');
    if (disposed) return;
    if (isError(r)) {
      if (r.error === 'reauth' && onReauth !== undefined) onReauth();
      else say(r.error === 'network' || r.status === 0 ? t(`profile.result.${provider}`) : failText(r), true);
    } else deps.navigate(r.url);
  };
  const gMark = (): HTMLImageElement => {
    const img = document.createElement('img');
    img.className = 'rl-profile__g';
    img.src = GOOGLE_G_SRC;
    img.alt = '';
    img.width = 18;
    img.height = 18;
    return img;
  };
  /** A provider's sign-in or sign-up button. Steam keeps the plain keys; Google's carries its mark and its own wording. */
  const providerButton = (provider: Provider, kind: 'signIn' | 'signUp'): HTMLButtonElement => {
    const cls = `rl-btn rl-profile__${kind === 'signIn' ? 'signin' : 'signup'} rl-profile__${provider}`;
    const b = button(provider === 'google' ? t(`profile.google.${kind}`) : t(`profile.${kind}`), () => void start(provider, 'login'), cls);
    if (provider === 'google') b.prepend(gMark());
    return b;
  };
  const privacyLink = (): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.className = 'rl-profile__privacy-link';
    a.href = routes.privacy();
    a.textContent = t('profile.privacyLink');
    return a;
  };
  const guestBlock = (): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'rl-profile__guest';
    // Nothing is drawn until the server has said which providers work; a provider it does not list never gets a button (a button that fails every time spends the sign-in budget on nothing).
    void info.then(({ open, providers }) => {
      if (disposed) return;
      if (providers.length === 0) {
        box.replaceChildren(line('rl-profile__closed', t('profile.signInClosed')));
        return;
      }
      for (const provider of providers) {
        // Sign up is the same flow as sign in (the first sign-in creates the member while the switch is open); it is only offered while `GET open` says so.
        if (open) box.appendChild(providerButton(provider, 'signUp'));
        box.appendChild(providerButton(provider, 'signIn'));
      }
      box.append(line('rl-profile__signup-note', open ? t('profile.signUpHint') : t('profile.signUpClosed')), line('rl-profile__privacy', t('profile.privacy')), privacyLink());
    });
    return box;
  };

  const download = async (): Promise<void> => {
    const r = await deps.client.exportData();
    if (disposed) return;
    if (isError(r)) {
      say(t('profile.error'), true);
      return;
    }
    const url = URL.createObjectURL(r);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'roaring-lions-account.json';
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  /** §0.46: with an account store the sync module signs out (flush, file, logout, clear); without one, log out and forget the device id. Then reload. */
  const signOutWith = async (logout: () => Promise<'ok' | AccountError>): Promise<void> => {
    try {
      if (deps.signOut !== undefined) await deps.signOut(logout);
      else {
        const r = await logout();
        if (isError(r)) {
          if (!disposed) say(failText(r), true);
          return;
        }
        clearDeviceId(deps.store);
      }
    } catch (err) {
      console.error('profile sign-out', err);
      if (!disposed) say(t('profile.error'), true);
      return;
    }
    deps.reload(); // the keys are cleared: reload even when the player has left the profile, or the in-memory account store keeps writing (NB4)
  };

  /** The stale-session answer: say so and offer a fresh sign-in through the first listed provider the member holds (Google first). */
  const showReauth = (me: SignedInMe): void => {
    say(t('profile.reauth'), true);
    if (content.querySelector('.rl-profile__reauth') !== null) return;
    content.appendChild(
      button(
        t('profile.reauth.action'),
        () => {
          void info.then(({ providers }) => {
            if (disposed) return;
            const held = me.identities.map((i) => i.provider);
            const pick = PROVIDERS.find((x) => held.includes(x) && providers.includes(x)) ?? PROVIDERS.find((x) => held.includes(x));
            if (pick === undefined) say(t('profile.error'), true);
            else void start(pick, 'login');
          });
        },
        'rl-btn rl-profile__reauth'
      )
    );
  };

  const identityRow = (me: SignedInMe, id: IdentityView, reload: () => void): HTMLElement => {
    const li = document.createElement('li');
    li.className = 'rl-profile__identity';
    // A Google row names no identifier: the app is never given one, and nothing here reads one off the row.
    const label =
      id.provider === 'steam' && id.steamId !== undefined ? t('profile.identity.steam', { id: id.steamId }) : id.provider === 'google' ? t('profile.identity.google') : (id.label ?? t('profile.identity.other'));
    const only = me.identities.length <= 1;
    const rm = button(t('profile.identity.remove'), () => {
      void deps.client.deleteIdentity(id.id).then((r) => {
        if (disposed) return;
        if (isError(r)) {
          if (r.error === 'reauth') showReauth(me);
          else say(r.error === 'last_identity' ? t('profile.identity.last') : failText(r), true);
        } else reload();
      });
    });
    rm.disabled = only;
    li.append(line('rl-profile__identity-label', label), rm);
    return li;
  };

  /** The record, the "Show my record" toggle and the history list (GH-1075 A3). The W-L is the server's count, never recounted here. */
  const historyBlock = (me: SignedInMe): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'rl-profile__history';
    const recordLine = line('rl-profile__record', '');
    recordLine.hidden = true;

    const toggle = document.createElement('label');
    toggle.className = 'rl-profile__show-record';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = me.showRecord;
    cb.addEventListener('change', () => {
      const want = cb.checked;
      void deps.client.patchProfile({ showRecord: want }).then((r) => {
        if (disposed) return;
        if (isError(r)) {
          cb.checked = !want;
          say(failText(r), true);
        } else say('');
      });
    });
    toggle.append(cb, document.createTextNode(t('profile.showRecord.label')));

    const list = document.createElement('ul');
    list.className = 'rl-profile__matches';
    const more = button(t('profile.history.more'), () => void page(next), 'rl-btn rl-profile__more');
    more.hidden = true;
    const empty = line('rl-profile__history-empty', t('profile.history.empty'));
    empty.hidden = true;
    let next: string | undefined;

    const row = (m: MatchView): HTMLElement => {
      const li = document.createElement('li');
      li.className = 'rl-profile__match';
      const when = new Date(m.startedAt).toLocaleDateString();
      const map = mapNames[m.map]?.name ?? m.map;
      const parts = [when, map, t(`profile.history.${outcomeKey(m)}`)];
      if (!m.agreed) parts.push(t('profile.history.unconfirmed'));
      parts.push(opponentText(m.opponent));
      li.textContent = parts.join(' · ');
      return li;
    };
    const page = async (before: string | undefined): Promise<void> => {
      more.disabled = true;
      const r = await deps.client.matches(before);
      if (disposed) return;
      more.disabled = false;
      if (!r.ok) {
        say(t('profile.error'), true);
        return;
      }
      const a = r.body;
      recordLine.textContent = t('profile.record', { won: a.record.won, lost: a.record.lost, drawn: a.record.drawn });
      recordLine.hidden = false;
      for (const m of a.matches) list.appendChild(row(m));
      empty.hidden = list.childElementCount > 0;
      next = a.next ?? undefined;
      more.hidden = a.next === null;
    };
    void page(undefined);
    box.append(line('rl-profile__history-title', t('profile.history.title')), recordLine, toggle, line('rl-profile__show-record-hint', t('profile.showRecord.hint')), empty, list, more);
    return box;
  };

  const signedInBlock = (me: SignedInMe, reload: () => void): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'rl-profile__signed';

    const form = document.createElement('div');
    form.className = 'rl-profile__name';
    const labelEl = document.createElement('label');
    labelEl.textContent = t('profile.name.label');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = me.displayName;
    input.maxLength = NAME_MAX * 2;
    input.autocomplete = 'off';
    labelEl.appendChild(input);
    const save = button(t('profile.name.save'), () => {
      const name = input.value.trim();
      const n = [...name].length;
      if (n < NAME_MIN || n > NAME_MAX) {
        say(t('profile.name.invalid'), true);
        return;
      }
      void deps.client.patchProfile({ displayName: name }).then((r) => {
        if (disposed) return;
        if (isError(r)) say(r.error === 'name' ? t('profile.name.invalid') : t('profile.error'), true);
        else say('');
      });
    });
    form.append(labelEl, save);

    const ids = document.createElement('ul');
    ids.className = 'rl-profile__identities';
    for (const id of me.identities) ids.appendChild(identityRow(me, id, reload));

    // "Link Google" / "Link Steam": only for a provider the server lists and the member does not hold yet. A stale session asks for the fresh sign-in first.
    const links = document.createElement('div');
    links.className = 'rl-profile__links';
    void info.then(({ providers }) => {
      if (disposed) return;
      const held = me.identities.map((i) => i.provider);
      for (const provider of providers) {
        if (held.includes(provider)) continue;
        const b = button(t(`profile.link.${provider}`), () => (me.fresh ? void start(provider, 'link', () => showReauth(me)) : showReauth(me)), `rl-btn rl-profile__link rl-profile__link--${provider}`);
        if (provider === 'google') b.prepend(gMark());
        links.appendChild(b);
      }
    });

    box.append(form, line('rl-profile__public-id', t('profile.publicId', { id: me.publicId })), historyBlock(me), ids, links);
    if (me.identities.length <= 1) box.appendChild(line('rl-profile__last', t('profile.identity.last')));

    const verbs = document.createElement('div');
    verbs.className = 'rl-profile__verbs';
    verbs.append(
      button(t('profile.signOut'), () => void signOutWith(() => deps.client.logout())),
      button(t('profile.signOutAll'), () => void signOutWith(() => deps.client.logoutAll())),
      button(t('profile.export'), () => void download())
    );
    box.appendChild(verbs);
    box.appendChild(privacyLink());

    // Delete: the choices sit beside the button, the confirm is the last word.
    const danger = document.createElement('div');
    danger.className = 'rl-profile__danger';
    const tel = document.createElement('label');
    tel.className = 'rl-profile__telemetry';
    const box2 = document.createElement('input');
    box2.type = 'checkbox';
    box2.checked = false;
    tel.append(box2, document.createTextNode(t('profile.delete.telemetry')));
    const del = button(t('profile.delete'), () => {
      if (confirm !== null) return;
      const h = confirmDialog(stage, {
        title: t('profile.delete.confirm.title'),
        body: t('profile.delete.confirm.body'),
        confirm: t('profile.delete.confirm.action'),
        danger: true,
      });
      confirm = h;
      void h.answer.then(async (yes) => {
        if (confirm === h) confirm = null;
        if (!yes || disposed) return;
        const player = box2.checked ? deps.telemetryPlayer() : null;
        const r = await deps.client.deleteAccount(player === null ? {} : { telemetryPlayer: player });
        if (disposed) return;
        if (!isError(r)) {
          deps.wipeDeleted?.();
          clearBinding(deps.store);
          content.replaceChildren(line('rl-profile__done', t('profile.delete.done')));
          say('');
          deps.reload();
        } else if (r.error === 'reauth') {
          showReauth(me);
        } else {
          say(failText(r), true);
        }
      });
    }, 'rl-btn rl-profile__delete');
    danger.append(button(t('profile.export'), () => void download()), tel, del);
    box.appendChild(danger);
    return box;
  };

  /** The claim panel: shown when signed in, the binding has no `claimedAt` and the guest keys hold progress (§0.41: with none, the device claims quietly). */
  const mountClaim = async (): Promise<void> => {
    const c = deps.claim;
    const store = deps.store;
    const b = readBinding(store);
    if (c === undefined || store === null || b === null || b.claimedAt !== undefined) return;
    if (readClaiming(store) === null && !hasGuestProgress(c.guest)) {
      if (await claimQuietly(deps.client, store, c.now)) {
        if (!disposed) c.onClaimed();
      }
      return;
    }
    if (disposed) return;
    const box = document.createElement('div');
    box.className = 'rl-profile__claim';
    const note = line('rl-profile__claim-lead', t('account.claim.lead'));
    const state = line('rl-profile__claim-state', readClaiming(store) === null ? '' : t('account.claim.moving'));
    state.setAttribute('role', 'status');
    const copy = button(t('account.claim.download'), () => {
      const a = readActive(c.guest);
      const name = t('account.claim.copyName');
      c.download(`${name}.lions-save.json`, exportSlot({ version: SAVE_VERSION, id: 'before-claim', name, savedAt: (c.now ?? Date.now)(), build: '', ledger: a.ledger, account: a.account, tutorialDone: a.tutorialDone }));
    });
    const move = button(t('account.claim.move'), () => void go());
    const later = button(t('account.claim.notNow'), () => box.remove());
    const verdict = (o: ClaimOutcome): void => {
      if (o === 'moved') {
        state.textContent = t('account.claim.done');
        box.replaceChildren(state);
        c.onClaimed();
      } else if (o === 'kept') {
        state.textContent = t('account.claim.kept');
        state.classList.add('rl-bad');
        move.hidden = true;
        move.disabled = true;
      } else {
        state.textContent = t('account.claim.error');
        state.classList.add('rl-bad');
        move.textContent = t('account.claim.retry');
      }
    };
    const go = async (): Promise<void> => {
      move.disabled = true;
      later.disabled = true;
      state.classList.remove('rl-bad');
      state.textContent = t('account.claim.moving');
      const o = await runClaim({ client: deps.client, guest: c.guest, storage: store as StorageLike, now: c.now });
      if (disposed) return;
      verdict(o);
      move.disabled = false;
      later.disabled = o === 'retry' || o === 'blocked' || o === 'failed' ? readClaiming(store) !== null : false;
    };
    const row = document.createElement('div');
    row.className = 'rl-profile__claim-verbs';
    row.append(copy, move, later);
    box.append(note, state, row);
    content.prepend(box);
  };

  const render = (res: SignedInResult): void => {
    content.replaceChildren();
    if (res.kind === 'signedIn' && res.me.kind === 'signedIn') {
      const me = res.me;
      if (!switchNoted && code === 'ok' && previousId !== null && me.publicId !== previousId) {
        switchNoted = true;
        say(t('profile.result.switched', { name: me.displayName }));
      }
      content.appendChild(signedInBlock(me, load));
      void mountClaim();
    } else if (res.kind === 'deleted') {
      content.append(line('rl-profile__deleted', t('profile.deleted')), guestBlock());
    } else if (res.kind === 'signedOut') {
      content.append(line('rl-profile__signed-out', t('profile.signedOut')), guestBlock());
    } else {
      content.appendChild(guestBlock());
    }
  };
  function load(): void {
    void resolveSignedIn(deps.client, deps.store).then((res) => {
      if (!disposed) render(res);
    });
  }

  const code = readReturnCode(deps.query);
  const returnProvider = readReturnProvider(deps.query);
  // The member this device knew before the provider's page: if the sign-in lands on another one (a different Google account), say so.
  const previousId = readBinding(deps.store)?.publicId ?? null;
  let switchNoted = false;
  if (code !== null) say(resultText(code, returnProvider), code !== 'ok' && code !== 'linked');
  load();

  return () => {
    disposed = true;
    confirm?.close();
    confirm = null;
    wrap.remove();
  };
}
