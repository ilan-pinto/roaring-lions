// What a player reads when a screen cannot be shown (pass K, error states).
//
// Every card here answers the three questions the polish plan's §14 asks of
// an error: what happened, why, and what to do next -- in the game's words,
// never the exception's. The raw error (its message, its stack, the URL that
// 404'd) goes to the console for whoever is debugging; the screen only names
// the CLASS of failure, because "fetch for http://…/house.glb responded with
// 404" and a stack into `node_modules/.vite/deps` are true and useless to a
// player.
//
// Three classes, decided from the error alone (and, for graphics, from the
// same WebGL2 probe the campaign board and the scene host already ask):
//   graphics  -- the browser could not give the renderer a WebGL2 context.
//   download  -- a file the screen needed did not arrive (an HttpError from
//                three's FileLoader, a failed fetch, a dynamic import that
//                did not load).
//   unknown   -- anything else.
//   interrupted -- the picture stopped mid-mission: the browser took the
//                graphics context away (K-16). Chosen by the caller that heard
//                it, never inferred from an error.
import { t } from '../i18n/t';
import { symbolLabel } from './symbol';

export type BootFailureKind = 'graphics' | 'download' | 'unknown' | 'interrupted';

/** The text of an error, its name included -- three's `HttpError` carries its
 *  class only in `name`. Never shown to the player. */
function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name} ${err.message}`;
  return String(err);
}

const GRAPHICS = /webgl|creating .*context|context (?:was )?lost/i;
const DOWNLOAD = /httperror|failed to fetch|networkerror|load failed|responded with \d{3}|dynamically imported module|importing a module script failed/i;

/** Which card a failure gets. `webgl2` is the probe's answer (true when the
 *  browser CAN draw), so a renderer that throws for a reason of its own on a
 *  browser that has no WebGL2 still reads as a graphics failure. */
export function bootFailureKind(err: unknown, webgl2: boolean): BootFailureKind {
  const text = errorText(err);
  if (!webgl2 || GRAPHICS.test(text)) return 'graphics';
  if (DOWNLOAD.test(text)) return 'download';
  return 'unknown';
}

export interface ErrorCard {
  title: string;
  /** What happened and why. */
  body: string;
  /** What to do next. */
  next: string;
  /** Offer a "reload" control -- only where trying again can help. */
  reload: boolean;
}

export function bootFailureCard(kind: BootFailureKind): ErrorCard {
  return {
    title: t(`boot.failed.${kind}.title`),
    body: t(`boot.failed.${kind}.body`),
    next: t(`boot.failed.${kind}.next`),
    reload: kind !== 'graphics',
  };
}

/**
 * Mount an error card on `host`: a title, the explanation, the next step, and
 * the way out -- the main menu always, a reload where trying again can help.
 * Built from the design system's own pieces (`rl-btn`, the panel tokens), so a
 * failure reads as part of the game rather than as a browser page.
 */
export function mountErrorCard(host: HTMLElement, card: ErrorCard, home: string, reload: () => void = () => window.location.reload()): HTMLElement {
  const div = document.createElement('div');
  div.className = 'rl-boot-error';
  div.setAttribute('role', 'alert');

  const h = document.createElement('h2');
  h.className = 'rl-boot-error__title';
  h.textContent = card.title;
  div.appendChild(h);

  const p = document.createElement('p');
  p.className = 'rl-boot-error__body';
  p.textContent = card.body;
  div.appendChild(p);

  if (card.next.length > 0) {
    const n = document.createElement('p');
    n.className = 'rl-boot-error__next';
    n.textContent = card.next;
    div.appendChild(n);
  }

  const row = document.createElement('div');
  row.className = 'rl-boot-error__actions';
  if (card.reload) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rl-btn rl-boot-error__reload';
    b.textContent = t('boot.failed.reload');
    b.addEventListener('click', () => reload());
    row.appendChild(b);
  }
  const a = document.createElement('a');
  a.className = 'rl-btn rl-boot-error__home';
  a.href = home;
  a.innerHTML = symbolLabel('back', t('nav.backToMenu'));
  row.appendChild(a);
  div.appendChild(row);

  host.appendChild(div);
  return div;
}

/**
 * A route mount whose failure is answered on screen. A screen reached by a
 * SOFT navigation (a menu click, "next mission") used to reject the router's
 * promise into nothing -- every `navigate()` caller `void`s it -- and leave an
 * empty stage: a black screen with no words at all. `fail` draws the card;
 * the returned disposer clears it. A navigation that superseded this one has
 * aborted `signal`, and then the error is the router's to discard, as before.
 */
export async function guardBoot(
  host: HTMLElement,
  signal: AbortSignal,
  fail: (err: unknown) => void,
  boot: Promise<() => void>,
): Promise<() => void> {
  try {
    return await boot;
  } catch (err) {
    if (signal.aborted) throw err;
    fail(err);
    return () => host.replaceChildren();
  }
}

/**
 * K-16: the browser can take the graphics context away mid-mission (a GPU
 * reset, memory pressure, a driver crash). The canvas then goes black and
 * stays black, and nothing said so. `onLost` runs once, the first time the
 * canvas reports it; the returned function takes the listener off again and
 * is the screen's to call from its disposer, so a mission left normally never
 * hears the context its own teardown releases.
 */
export function watchContextLoss(canvas: HTMLCanvasElement, onLost: () => void): () => void {
  let fired = false;
  const listener = (): void => {
    if (fired) return;
    fired = true;
    onLost();
  };
  canvas.addEventListener('webglcontextlost', listener);
  return () => canvas.removeEventListener('webglcontextlost', listener);
}

/**
 * The "interrupted" card laid over a running mission: a scrim on the body (the
 * HUD lives there, outside the router's stage), the same card as any boot
 * failure, with Reload and the main menu. Returns the scrim, which the
 * mission's disposer removes.
 */
export function mountInterrupted(host: HTMLElement, home: string, reload?: () => void): HTMLElement {
  const scrim = document.createElement('div');
  scrim.className = 'rl-boot-scrim';
  mountErrorCard(scrim, bootFailureCard('interrupted'), home, reload);
  host.appendChild(scrim);
  return scrim;
}
