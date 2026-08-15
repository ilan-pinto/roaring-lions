// Asset loading screen. Pure presentation — it owns no sim state and makes no
// decisions; main.ts drives it and decides when the game is allowed to start.
//
// It exists because the alternative is worse than a blank wait: with no gate,
// the first seconds of a mission render every unit and building through the
// procedural fallback path (flat boxes and circles), which is meant for art
// that was never authored. Players read that as the game's real look rather
// than as a load in progress.

export interface LoadingScreen {
  /** How many assets the gate is waiting on. Drives the bar's denominator. */
  total(n: number): void;
  /** One asset settled. Counts failures too — see the note in `main.ts`: the
   *  gate waits for a decided outcome, not for a successful one, or a single
   *  missing sheet would hang the game on this screen forever. */
  step(): void;
  /** Tear the screen down and hand the field to the game. */
  done(): void;
}

export function showLoading(host: HTMLElement, title: string): LoadingScreen {
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

  box.append(label, name, track, count);
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
    done(): void {
      wrap.remove();
    },
  };
}
