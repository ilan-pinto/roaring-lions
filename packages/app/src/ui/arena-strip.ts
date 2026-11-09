/**
 * The arena watch strip (GH-954 W1): one band along the top of the battlefield while a run is watched. Game n of
 * m, the two players, the score, the round and tick, the sentence for what the room is doing ("Round 14: waiting
 * on the players"), the last game's verdict, and the view toggle (Both sides by default, then Side A and Side B).
 *
 * Every string comes from `net/spectator.ts`'s `stripText`, so every one went through `t()`; the labels are
 * the players' names, which are data and set as text. Mounted on `document.body` by the screen that makes it
 * (`ui/arena-watch.ts`), which removes it in its own disposer. DEV only: the route that mounts it does not exist
 * in a production build.
 */
import { t } from '../i18n/t';
import type { StripText, ViewChoice } from '../net/spectator';

export interface ArenaStripDeps {
  onView(choice: ViewChoice): void;
  onStop(): void;
  /** GH-954 W3: the replay screen's own controls, placed before the stop button. The strip does not own them. */
  extra?: HTMLElement;
  /** GH-954 W3: the stop button's words (the replay's is "Back to the results"); default the watch screen's. */
  stopLabel?: string;
}

export interface ArenaStrip {
  update(text: StripText): void;
  dispose(): void;
}

export function mountArenaStrip(host: HTMLElement, deps: ArenaStripDeps): ArenaStrip {
  const el = document.createElement('div');
  el.className = 'rl-arena-strip';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', t('arena.strip.label'));
  const line = (cls: string): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = `rl-arena-strip__${cls}`;
    return s;
  };
  const game = line('game');
  const players = line('players');
  const score = line('score');
  const force = line('force');
  const clock = line('clock');
  const status = line('status');
  const verdict = line('verdict');
  const views = document.createElement('div');
  views.className = 'rl-arena-strip__views';
  views.setAttribute('role', 'radiogroup');
  views.setAttribute('aria-label', t('arena.view.label'));
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'rl-arena-strip__stop';
  stop.textContent = deps.stopLabel ?? t('arena.watch.stop');
  stop.addEventListener('click', () => deps.onStop());
  el.append(game, players, score, force, clock, status, verdict, views, ...(deps.extra === undefined ? [] : [deps.extra]), stop);
  host.appendChild(el);

  let painted = '';
  const buttons = new Map<ViewChoice, HTMLButtonElement>();
  const set = (span: HTMLElement, text: string | null): void => {
    span.textContent = text ?? '';
    span.hidden = text === null || text === '';
  };
  return {
    update(text) {
      const key = JSON.stringify(text);
      if (key === painted) return;
      painted = key;
      set(game, text.game);
      set(players, text.players);
      set(score, text.score);
      set(force, text.force);
      set(clock, text.clock);
      set(status, text.status);
      set(verdict, text.verdict);
      for (const v of text.views) {
        let b = buttons.get(v.choice);
        if (b === undefined) {
          b = document.createElement('button');
          b.type = 'button';
          b.className = 'rl-arena-strip__view';
          b.dataset.view = v.choice;
          b.setAttribute('role', 'radio');
          const choice = v.choice;
          b.addEventListener('click', () => deps.onView(choice));
          buttons.set(v.choice, b);
          views.appendChild(b);
        }
        b.textContent = v.label;
        b.setAttribute('aria-checked', String(v.on));
      }
    },
    dispose() {
      el.remove();
      buttons.clear();
    },
  };
}
