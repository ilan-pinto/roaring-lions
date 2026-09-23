// packages/app/src/ui/outcome-moment.ts
/**
 * The victory/defeat moment (spec §6): a held, full-screen beat between the
 * mission ending and the debrief opening. Nothing in the tree was this
 * before -- `showEndScreen` (`ui/menu.ts`) is a floating card over the still-
 * visible battlefield, and `showDebrief` (`ui/debrief.ts`) is a report. This
 * is the punctuation mark in between: the verdict, alone, held long enough
 * to register.
 *
 * `titleCard` (`motion.ts`) is the closest thing already in the tree and
 * this inherits four of its rules VERBATIM, because each was already argued
 * there and nothing about a victory/defeat card changes the argument:
 *
 *  1. The hold is `setTimeout`-driven, not a CSS duration, so
 *     `prefers-reduced-motion`/`data-motion='reduce'` keeps the hold's
 *     LENGTH and only drops the entrance animation -- a player who turned
 *     down motion still gets the full read, never a shorter one.
 *  2. Skippable by ANY pointerdown or keydown, regardless of how much of the
 *     hold remains -- a player replaying a mission for a better score
 *     should not have to sit through this a fourth time.
 *  3. `dismiss` is idempotent and takes every listener AND the timer off.
 *  4. It returns the element as well as the dismisser, because a caller
 *     tearing this down (a navigation mid-hold) needs the node itself, the
 *     same reason `Hud.destroy()` cannot just query for `.rl-titlecard`.
 *
 * Three rules it does NOT inherit, because a full-viewport moment is a
 * dialog and a title card floating over gameplay is not:
 *
 *  - `role="dialog"`/`aria-modal="true"`, and `.rl-outcome` joins
 *    `confirm.ts`'s `isDialogOpen()` selector, so `main.ts`'s handler-wide
 *    guard defers to this the same way it defers to the pause menu and the
 *    key-bindings overlay.
 *  - A focus trap (`focus-trap.ts`) -- the first new caller of it outside
 *    the four it already serves, rather than a fifth full-screen overlay
 *    with none.
 *  - It resolves a promise (`done`), because `main.ts` shows the ordinary
 *    end screen behind this one, and needs to know when this is out of the
 *    way.
 *
 * `done` settles at exactly `holdMs` (or on an earlier skip/dismiss), never
 * `holdMs + 250` the way `titleCard`'s own timer does -- there is no
 * caller-visible fade to wait out here. `dismiss()` therefore also differs
 * from `titleCard`'s in one deliberate way: it takes the node off the
 * document SYNCHRONOUSLY rather than through `leave()`'s 250ms
 * fade-then-remove, because a promise a caller is `await`ing has to settle
 * with the DOM already clean, not 250ms later -- a caller that navigates the
 * instant `done` resolves must not find this node still attached.
 *
 * The skip-by-any-key guard is a CAPTURE-phase `keydown` listener on
 * `window`, mirroring `confirm.ts`'s/`pause.ts`'s own `onCaptureKey`, and
 * NOT a bubble-phase listener the way `titleCard`'s dismiss is. The
 * difference matters here in a way it does not for `titleCard`: this moment
 * also has to keep a key from reaching the game underneath it (the brief's
 * own example -- Escape opens the pause menu, and while this is up it must
 * not), and only a capture-phase guard that calls `stopPropagation()` can do
 * that; a bubble-phase listener registered after the game's own (which is
 * the oldest listener on `window`, registered once at boot) would run AFTER
 * it, not before. `Tab` is deliberately exempted from this guard -- exactly
 * the carve-out `confirm.ts`'s own guard makes -- because moving focus
 * inside the trap is `focusTrap`'s job, not this one's; a `Tab` press is
 * left to bubble through untouched, which is the other half of why
 * `.rl-outcome` has to join `isDialogOpen()`'s selector (see `confirm.ts`'s
 * updated doc comment).
 */
import type { MissionJson } from '@lions/sim';
import { t } from '../i18n/t';
import { focusTrap } from './focus-trap';
import { panel } from './panel';

export interface OutcomeMomentOptions {
  outcome: 'victory' | 'defeat';
  /** The verdict headline, already resolved by the caller (`t('outcome.victory')`
   *  or `t('outcome.defeat')`, or a mission-specific override). */
  title: string;
  /** The mission's own closing sentence, if it has one (GDD §11's story
   *  voice) -- entirely absent, not an empty paragraph, when it does not. */
  line?: string;
  /** The mission's `aftermath` -- the victory narration a mission may
   *  author, drawn directly under the verdict, as text. The HUD's end banner
   *  used to be the only thing that showed it, and it stands down for this
   *  moment (final review, ruling 9, and its correction), so this is now its
   *  one place. Absent, not an empty paragraph, when there is none. It buys
   *  no hold of its own: `holdMs` is still the whole hold. */
  aftermath?: string;
  holdMs?: number;
}

export interface OutcomeMoment {
  readonly el: HTMLElement;
  /** Settles once, whether the hold ran out or the player skipped it. Never
   *  rejects. */
  readonly done: Promise<void>;
  /** Idempotent: safe to call after `done` has already settled on its own. */
  dismiss(): void;
}

/** How long the moment holds a player who does nothing. Short enough that a
 *  player is never stuck looking at it, long enough that "Objective secured"
 *  and a one-line closing sentence can both be read before it moves on --
 *  shorter than `titleCard`'s `DISPATCH_HOLD_MS` (a full paragraph of story
 *  prose), longer than its mechanical `DEFAULT_HOLD_MS` (a name and a
 *  count), because this single beat is the one the whole mission was for. */
export const OUTCOME_HOLD_MS = 2600;

/**
 * What the moment says when `mission` has just ended in `result`: the one
 * place `main.ts`'s `missionEnd` handler gets the moment's options from, so
 * the choice is testable without booting `main.ts`, which no test can load.
 *
 * - `title`: the verdict, from the catalogue.
 * - `line`: the mission's own outcome-specific closing sentence
 *   (`debrief.victory`/`debrief.defeat`), the same `say` the end screen
 *   quotes after this.
 * - `aftermath`: victory only, and only when authored -- exactly the rule the
 *   HUD banner drew it under (`mission.ts`'s own doc comment: "Shown on the
 *   victory banner").
 *
 * No `holdMs`: the hold is `OUTCOME_HOLD_MS` whatever the text.
 */
export function outcomeMomentOptions(
  result: 'victory' | 'defeat',
  mission: Pick<MissionJson, 'aftermath' | 'debrief'>
): OutcomeMomentOptions {
  const say = result === 'victory' ? mission.debrief?.victory : mission.debrief?.defeat;
  const aftermath = result === 'victory' ? mission.aftermath : undefined;
  return {
    outcome: result,
    title: t(result === 'victory' ? 'outcome.victory' : 'outcome.defeat'),
    ...(say !== undefined ? { line: say.text } : {}),
    ...(aftermath ? { aftermath } : {}),
  };
}

export function outcomeMoment(host: HTMLElement, o: OutcomeMomentOptions): OutcomeMoment {
  const el = document.createElement('div');
  el.className = 'rl-outcome rl-enter';
  el.dataset.outcome = o.outcome;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');

  const p = panel({ rank: 'alert', title: o.title });
  p.el.classList.add('rl-outcome__panel');

  // Narration first, directly under the verdict -- the order the banner
  // drew it in -- then the speaker's own closing line. `textContent`, never
  // markup: it is mission data.
  if (o.aftermath !== undefined) {
    const aftermath = document.createElement('p');
    aftermath.className = 'rl-outcome__aftermath';
    aftermath.textContent = o.aftermath;
    p.body.appendChild(aftermath);
  }

  if (o.line !== undefined) {
    const line = document.createElement('p');
    line.className = 'rl-outcome__line';
    line.textContent = o.line;
    p.body.appendChild(line);
  }

  // The moment's one focusable element: a keyboard path for the same skip
  // any pointerdown/keydown already offers, and a stated affordance rather
  // than a silent "wait it out or guess" -- Phase 4's "no hover-only
  // affordance without a keyboard path" reads on a click-to-skip design too.
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'rl-btn rl-outcome__skip';
  skip.textContent = t('outcome.skip');
  p.body.appendChild(skip);

  el.appendChild(p.el);
  host.appendChild(el);

  // Queries `p.el` for its own focusables at keypress time, so it does not
  // matter that `skip` was appended before this line -- see focus-trap.ts's
  // own header for why that is deliberate.
  const disposeTrap = focusTrap(p.el);

  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  let settled = false;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    window.removeEventListener('keydown', onCaptureKey, true);
    window.removeEventListener('pointerdown', onPointerDown);
    disposeTrap();
    el.remove();
    resolveDone();
  };

  // Capture-phase: see the file header for why this has to run before the
  // game's own bubble-phase listener rather than after it, and why `Tab`
  // alone is left untouched.
  //
  // An autorepeat (`e.repeat`) is swallowed and does NOT skip (final review,
  // ruling 3): a player still holding a pan key when the mission ends is
  // already sending keydowns at the browser's repeat rate, and the first of
  // them used to end the moment before it was seen. A held key was pressed
  // before this existed, so it is not an answer to it; a fresh press is.
  const onCaptureKey = (e: KeyboardEvent): void => {
    if (e.key === 'Tab') return;
    if (e.repeat) {
      e.stopPropagation();
      return;
    }
    finish();
    e.stopPropagation();
  };
  const onPointerDown = (): void => finish();

  window.addEventListener('keydown', onCaptureKey, true);
  window.addEventListener('pointerdown', onPointerDown);

  const hold = o.holdMs ?? OUTCOME_HOLD_MS;
  const timer = window.setTimeout(finish, hold);

  skip.addEventListener('click', finish);
  skip.focus();

  return { el, done, dismiss: finish };
}
