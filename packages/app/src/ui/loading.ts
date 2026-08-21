// Asset loading screen, and the mission's orders. Pure presentation — it owns
// no sim state and makes no decisions; main.ts drives it and decides when the
// game is allowed to start.
//
// It exists because the alternative is worse than a blank wait: with no gate,
// the first seconds of a mission render every unit and building through the
// procedural fallback path (flat boxes and circles), which is meant for art
// that was never authored. Players read that as the game's real look rather
// than as a load in progress.
//
// It also carries the briefing, because nothing else did. Every mission has
// declared one since the format was written and no call site ever read it —
// `MissionJson` did not even describe the field. This is the screen with the
// room and the time for prose, which is what #82 was really complaining about:
// it held for as long as the sheets took and then vanished.

/**
 * Does this screen wait for the player before handing over the field?
 *
 * Extracted and exported because it is the whole of #82 and it needs no DOM to
 * prove. A screen that tears itself down the instant the art gate settles is
 * why ten missions' worth of authored briefings had never been read by anyone.
 *
 * Blank is the case worth stating: `undefined` and `""` are both falsy, but a
 * briefing of spaces is truthy and means exactly the same thing, and holding
 * the game on an empty box reads as a hang rather than as a briefing.
 */
export function briefingHoldsDeployment(briefing: string | undefined): boolean {
  return briefing !== undefined && briefing.trim().length > 0;
}

export interface LoadingScreen {
  /** How many assets the gate is waiting on. Drives the bar's denominator. */
  total(n: number): void;
  /** One asset settled. Counts failures too — see the note in `main.ts`: the
   *  gate waits for a decided outcome, not for a successful one, or a single
   *  missing sheet would hang the game on this screen forever. */
  step(): void;
  /**
   * Hand the field to the game. Resolves at once when there is no briefing to
   * read; otherwise waits for the player to deploy, so the orders they were
   * given are not swept off screen the instant the last sheet lands.
   */
  done(): Promise<void>;
}

export function showLoading(
  host: HTMLElement,
  title: string,
  briefing?: string
): LoadingScreen {
  const wrap = document.createElement('div');
  wrap.className = 'rl-loading';
  // The screen is the only thing on the field while it is up, so it is the
  // live region: a player on a screen reader gets the count without polling.
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');

  const box = document.createElement('div');
  box.className = 'rl-loading__box';

  const label = document.createElement('div');
  label.className = 'rl-loading__label';
  label.textContent = 'deploying';

  const name = document.createElement('div');
  name.className = 'rl-loading__name';
  name.textContent = title;

  const track = document.createElement('div');
  track.className = 'rl-loading__track';
  const fill = document.createElement('div');
  fill.className = 'rl-loading__fill';
  track.appendChild(fill);

  const count = document.createElement('div');
  count.className = 'rl-loading__count';

  const holds = briefingHoldsDeployment(briefing);

  const orders = document.createElement('p');
  orders.className = 'rl-loading__brief';
  if (holds) orders.textContent = briefing as string;

  const deploy = document.createElement('button');
  deploy.className = 'rl-loading__deploy';
  deploy.type = 'button';
  deploy.textContent = 'deploy';

  box.append(label, name, track, count);
  if (holds) {
    box.classList.add('rl-loading__box--brief');
    box.append(orders, deploy);
  }
  wrap.appendChild(box);
  host.appendChild(wrap);

  let loaded = 0;
  let expected = 0;

  const paint = (): void => {
    // Before the total is known the bar would divide by zero; an empty bar and
    // a bare count is honest about not knowing yet.
    const ratio = expected > 0 ? Math.min(1, loaded / expected) : 0;
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    count.textContent = expected > 0 ? `${loaded} / ${expected} sheets` : 'reading manifests';
  };
  paint();

  return {
    total(n: number): void {
      expected = n;
      paint();
    },
    step(): void {
      loaded += 1;
      paint();
    },
    done(): Promise<void> {
      if (!holds) {
        wrap.remove();
        return Promise.resolve();
      }
      // Reading time is the player's to spend. Any of the three exits works —
      // the button says so, and click-anywhere and any-key match how the
      // mission title card already lets you past. The art gate has already
      // settled by the time this is called, so nothing is being waited on here
      // except the reader.
      return new Promise<void>((resolve) => {
        let gone = false;
        const dismiss = (): void => {
          if (gone) return;
          gone = true;
          window.removeEventListener('pointerdown', dismiss);
          window.removeEventListener('keydown', dismiss);
          wrap.remove();
          resolve();
        };
        deploy.addEventListener('click', dismiss);
        window.addEventListener('pointerdown', dismiss);
        window.addEventListener('keydown', dismiss);
        deploy.focus();
      });
    },
  };
}
