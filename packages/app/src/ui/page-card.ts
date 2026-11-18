/**
 * The account page's card and column parts (GH-1075 P7, GH-1367 S3), shared since GH-1510 by the Settings screen, which
 * follows the account page's design. One card is a hairline frame with a small uppercase title strip and a body; the
 * columns are a wide one and a narrow one that fall to one column, in source order, on a narrow screen.
 *
 * The class names are neutral (`rl-page-card`, `rl-page-card__title`, `rl-page-card__body`, `rl-page-cols`,
 * `rl-page-cols__col` and its `--main` / `--side`; GH-1510 Q4), because two screens wear them. A screen adds its own
 * modifier class beside them (`rl-profile__card--head`, `rl-settings__card--video`), never a copy of the rules.
 *
 * The title is chrome: the caller passes the `t()` result, resolved when the card is built, never at module load.
 */

export interface PageCard {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
}

/** One card: `<section class="rl-page-card {cls}">`, an optional `<h2>` title strip, then the body. */
export function pageCard(cls: string, title: string | null): PageCard {
  const el = document.createElement('section');
  el.className = `rl-page-card ${cls}`;
  if (title !== null) {
    const h = document.createElement('h2');
    h.className = 'rl-page-card__title';
    h.textContent = title;
    el.appendChild(h);
  }
  const body = document.createElement('div');
  body.className = 'rl-page-card__body';
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

/** The two columns. `cls` adds the caller's own hook to the grid (`rl-settings__cols`); the grid itself is `rl-page-cols`. */
export function pageColumns(cls?: string): PageColumns {
  const el = document.createElement('div');
  el.className = cls === undefined ? 'rl-page-cols' : `rl-page-cols ${cls}`;
  const main = document.createElement('div');
  main.className = 'rl-page-cols__col rl-page-cols__col--main';
  const side = document.createElement('div');
  side.className = 'rl-page-cols__col rl-page-cols__col--side';
  el.append(main, side);
  return { el, main, side };
}
