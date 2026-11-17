/**
 * The account page's card and column parts (GH-1075 P7, GH-1367 S3), shared since GH-1510 by the Settings screen, which
 * follows the account page's design. One card is a hairline frame with a small uppercase title strip and a body; the
 * columns are a wide one and a narrow one that fall to one column, in source order, on a narrow screen.
 *
 * The class names keep their `rl-profile__` spelling on purpose: the profile's tests, its crest echo
 * (`rl-profile__card--head:has(...)`) and its colour pins all read them, and the rules in `theme.css` are the profile's
 * own. A screen that borrows them adds its own modifier class beside them (`rl-settings__card--video`), never a copy
 * of the rules.
 *
 * The title is chrome: the caller passes the `t()` result, resolved when the card is built, never at module load.
 */

export interface PageCard {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
}

/** One card: `<section class="rl-profile__card {cls}">`, an optional `<h2>` title strip, then the body. */
export function pageCard(cls: string, title: string | null): PageCard {
  const el = document.createElement('section');
  el.className = `rl-profile__card ${cls}`;
  if (title !== null) {
    const h = document.createElement('h2');
    h.className = 'rl-profile__card-title';
    h.textContent = title;
    el.appendChild(h);
  }
  const body = document.createElement('div');
  body.className = 'rl-profile__card-body';
  el.appendChild(body);
  return { el, body };
}

export interface PageColumns {
  readonly el: HTMLElement;
  /** The wide column (38fr). */
  readonly main: HTMLElement;
  /** The narrow column (24fr). */
  readonly side: HTMLElement;
}

/** The two columns. `cls` adds the caller's own hook to the grid (`rl-settings__cols`); the grid itself is the profile's. */
export function pageColumns(cls?: string): PageColumns {
  const el = document.createElement('div');
  el.className = cls === undefined ? 'rl-profile__cols' : `rl-profile__cols ${cls}`;
  const main = document.createElement('div');
  main.className = 'rl-profile__col rl-profile__col--main';
  const side = document.createElement('div');
  side.className = 'rl-profile__col rl-profile__col--side';
  el.append(main, side);
  return { el, main, side };
}
