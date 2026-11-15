/**
 * The avatar element (GH-1075 P5). A member always has one: `me` returns the RESOLVED avatar, and this draws it. The
 * `error` chain steps down the same ladder the server resolves by, so a missing file or a 404 still shows something:
 * the avatar's crest, then the member's default crest, then the chevrons, and last the guest mark. It never ends empty.
 *
 * The guest mark is one fixed glyph in the same roundel. It is never derived from anything on the device (A1-10): it
 * takes no argument that could carry a telemetry id, a device id or a name.
 */
import { defaultAvatar, LAST_RESORT_AVATAR, type AvatarView } from '@lions/data';

/** The crests are static files (`assets/ui/avatars/crests/`, served from the site root like `/brand/`): no bundle weight. */
export function crestSrc(id: string): string {
  return `/ui/avatars/crests/${id}.svg`;
}

export type AvatarSize = 'chip' | 'head' | 'tile';

/** The ids tried in order: what `me` resolved, the member's default, the chevrons. Uploads draw their `fallback` crest (uploads are not open). */
export function avatarChain(view: AvatarView, publicId: string): readonly string[] {
  const first = view.kind === 'preset' ? view.id : view.fallback;
  return [...new Set([first, defaultAvatar(publicId), LAST_RESORT_AVATAR])];
}

const NS = 'http://www.w3.org/2000/svg';

function personGlyph(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'rl-sym rl-avatar__glyph');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('d', 'M12 3a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9Z M3.5 21c0-4.7 3.8-8 8.5-8s8.5 3.3 8.5 8Z');
  svg.appendChild(p);
  return svg;
}

/** The guest look: the person silhouette in the roundel members' avatars use. Fixed, and decorative. */
export function guestMark(size: AvatarSize = 'chip'): HTMLElement {
  const el = document.createElement('span');
  el.className = `rl-avatar rl-avatar--${size} rl-avatar--guest`;
  el.dataset.avatar = 'guest';
  el.setAttribute('aria-hidden', 'true');
  el.appendChild(personGlyph());
  return el;
}

/** A member's avatar. Decorative (`alt=""`): the name sits beside it. */
export function avatarElement(view: AvatarView, publicId: string, size: AvatarSize): HTMLElement {
  const chain = avatarChain(view, publicId);
  const el = document.createElement('span');
  el.className = `rl-avatar rl-avatar--${size}`;
  el.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.className = 'rl-avatar__img';
  img.alt = '';
  img.draggable = false;
  let step = 0;
  const show = (): void => {
    const id = chain[step] ?? LAST_RESORT_AVATAR;
    el.dataset.avatar = id;
    img.src = crestSrc(id);
  };
  img.addEventListener('error', () => {
    step += 1;
    if (step < chain.length) show();
    else {
      el.dataset.avatar = 'guest';
      el.classList.add('rl-avatar--guest');
      el.replaceChildren(personGlyph());
    }
  });
  show();
  el.appendChild(img);
  return el;
}
