/**
 * The profile screen (GH-1075 A1, `/profile`, behind `?accounts`). A guest sees the sign-in button and the privacy
 * line; a signed-in player sees the name, the public id, the linked identities and the account verbs.
 *
 * Disposer contract: everything is mounted inside `stage` except the delete confirm, which this screen closes itself,
 * and a late promise (`me()`, a PATCH, an export) is ignored once `disposed` is set.
 */
import type { StorageLike } from '../brigade-account';
import { clearBinding } from '../account/binding';
import { readReturnCode, type AccountClient, type AccountError, type IdentityView, type MeResult } from '../account/client';
import { resolveSignedIn, type SignedInResult } from '../account/signed-in';
import { t } from '../i18n/t';
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
}

const NAME_MIN = 3;
const NAME_MAX = 20;

type SignedInMe = Extract<MeResult, { kind: 'signedIn' }>;

function isError(x: unknown): x is AccountError {
  return typeof x === 'object' && x !== null && 'error' in x && 'status' in x;
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

  const signIn = async (): Promise<void> => {
    const r = await deps.client.steamStart('steam-login');
    if (disposed) return;
    if (isError(r)) say(r.error === 'network' || r.status === 0 ? t('profile.result.steam') : failText(r), true);
    else deps.navigate(r.url);
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
    box.append(button(t('profile.signIn'), () => void signIn(), 'rl-btn rl-profile__signin'), line('rl-profile__privacy', t('profile.privacy')), privacyLink());
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

  const signOutWith = async (pending: Promise<'ok' | AccountError>, done: () => void): Promise<void> => {
    const r = await pending;
    if (disposed) return;
    if (isError(r)) say(failText(r), true);
    else done();
  };

  const identityRow = (me: SignedInMe, id: IdentityView, reload: () => void): HTMLElement => {
    const li = document.createElement('li');
    li.className = 'rl-profile__identity';
    const label = id.provider === 'steam' && id.steamId !== undefined ? t('profile.identity.steam', { id: id.steamId }) : (id.label ?? t('profile.identity.other'));
    const only = me.identities.length <= 1;
    const rm = button(t('profile.identity.remove'), () => {
      void deps.client.deleteIdentity(id.id).then((r) => {
        if (disposed) return;
        if (isError(r)) say(r.error === 'reauth' ? t('profile.reauth') : r.error === 'last_identity' ? t('profile.identity.last') : failText(r), true);
        else reload();
      });
    });
    rm.disabled = only;
    li.append(line('rl-profile__identity-label', label), rm);
    return li;
  };

  const signedInBlock = (me: SignedInMe, reload: () => void, afterSignOut: () => void): HTMLElement => {
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

    box.append(form, line('rl-profile__public-id', t('profile.publicId', { id: me.publicId })), ids);
    if (me.identities.length <= 1) box.appendChild(line('rl-profile__last', t('profile.identity.last')));

    const verbs = document.createElement('div');
    verbs.className = 'rl-profile__verbs';
    verbs.append(
      button(t('profile.signOut'), () => void signOutWith(deps.client.logout(), afterSignOut)),
      button(t('profile.signOutAll'), () => void signOutWith(deps.client.logoutAll(), afterSignOut)),
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
          clearBinding(deps.store);
          content.replaceChildren(line('rl-profile__done', t('profile.delete.done')));
          say('');
        } else if (r.error === 'reauth') {
          say(t('profile.reauth'), true);
          if (!content.querySelector('.rl-profile__reauth')) content.appendChild(button(t('profile.signIn'), () => void signIn(), 'rl-btn rl-profile__reauth'));
        } else {
          say(failText(r), true);
        }
      });
    }, 'rl-btn rl-profile__delete');
    danger.append(button(t('profile.export'), () => void download()), tel, del);
    box.appendChild(danger);
    return box;
  };

  const render = (res: SignedInResult): void => {
    content.replaceChildren();
    if (res.kind === 'signedIn' && res.me.kind === 'signedIn') {
      const me = res.me;
      content.appendChild(signedInBlock(me, load, () => render({ kind: 'signedOut', publicId: me.publicId })));
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
  if (code !== null) say(t(`profile.result.${code}`), code !== 'ok' && code !== 'linked');
  load();

  return () => {
    disposed = true;
    confirm?.close();
    confirm = null;
    wrap.remove();
  };
}
