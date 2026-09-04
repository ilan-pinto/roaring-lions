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

/** Roughly two sentences to a beat, and never more than this many characters —
 *  whichever comes first. Two long sentences are a wall, not a beat. */
const BEAT_SENTENCES = 2;
const BEAT_CHARS = 240;

/**
 * Break a briefing into the beats a commander delivers it in.
 *
 * Sentence boundaries are the seam. That is safe for the eleven authored
 * briefings specifically because none of them contains a decimal or an
 * abbreviation — checked rather than assumed, and the reason this splits at
 * runtime instead of the schema growing a `beats` array nobody would keep
 * consistent with the prose above it.
 *
 * Text with no sentence end at all yields one beat rather than none: a brief
 * the player cannot read is worse than one delivered in a single breath.
 */
export function briefingBeats(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const beats: string[] = [];
  let held: string[] = [];
  const flush = (): void => {
    if (held.length > 0) beats.push(held.join(' '));
    held = [];
  };
  for (const sentence of sentences) {
    const wouldBe = [...held, sentence].join(' ');
    if (held.length > 0 && (held.length >= BEAT_SENTENCES || wouldBe.length > BEAT_CHARS)) flush();
    held.push(sentence);
  }
  flush();
  return beats;
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
  briefing?: string,
  /** Shai's rank and plate for this mission (`commanderForMission`,
   *  `campaign.ts`) -- optional so a sandbox or a mission with no briefing
   *  behaves exactly as it always has (gated on `holds` below, the same
   *  condition the orders paragraph itself is). `portrait`, when present,
   *  is already the RESOLVED URL (`portrait-catalogue.ts`'s
   *  `commanderPortraitUrl`, called once in `main.ts` -- the same value
   *  `ui/hud.ts`'s commander bar shows for Shai), not the bare file name
   *  `commander.json` authors. */
  commander?: { rank: string; plate: string; portrait?: string }
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

  // Attributed the same way the in-mission commander bar is (`ui/hud.ts`'s
  // `renderCommander`) -- rank and plate, gated on `holds` exactly like the
  // orders paragraph below: a sandbox or a mission with no briefing shows
  // neither.
  const commanderLine = document.createElement('div');
  commanderLine.className = 'rl-loading__commander';
  if (holds && commander) commanderLine.textContent = `${commander.rank} · ${commander.plate}`;

  // The same photo the in-mission commander bar shows for Shai, beside the
  // rank/plate line rather than replacing it -- the deploy screen's first
  // look at whoever is about to give the orders below. Same fallback as
  // `.rl-cmd__face`: hatched when there is no resolved URL, and the `error`
  // handler catches a URL that resolved but still fails to load, which
  // `commander.portrait` being set does not by itself guarantee.
  const commanderFace = document.createElement('div');
  commanderFace.className = 'rl-loading__face';
  const commanderFaceImg = document.createElement('img');
  commanderFaceImg.className = 'rl-loading__face-img';
  commanderFaceImg.alt = '';
  commanderFaceImg.hidden = true;
  commanderFaceImg.addEventListener('error', () => {
    commanderFaceImg.hidden = true;
    commanderFaceImg.removeAttribute('src');
  });
  if (commander?.portrait !== undefined) {
    commanderFaceImg.src = commander.portrait;
    commanderFaceImg.hidden = false;
  }
  commanderFace.appendChild(commanderFaceImg);

  const commanderHead = document.createElement('div');
  commanderHead.className = 'rl-loading__head';
  commanderHead.append(commanderFace, commanderLine);

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
    if (commander) box.append(commanderHead);
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
      // Reading time is the player's to spend, and the ways out are the button,
      // a click anywhere, and Escape.
      //
      // Deliberately NOT any-key, which is how titleCard works and would be
      // wrong here: a briefing long enough to scroll is a briefing the player
      // scrolls, and Down or Page-Down would deploy them mid-sentence. The
      // button is focused on mount, so Enter and Space still work through its
      // own activation rather than through a global listener.
      return new Promise<void>((resolve) => {
        let gone = false;
        const onKey = (e: KeyboardEvent): void => {
          if (e.key === 'Escape') dismiss();
        };
        const dismiss = (): void => {
          if (gone) return;
          gone = true;
          window.removeEventListener('pointerdown', dismiss);
          window.removeEventListener('keydown', onKey);
          wrap.remove();
          resolve();
        };
        deploy.addEventListener('click', dismiss);
        window.addEventListener('pointerdown', dismiss);
        window.addEventListener('keydown', onKey);
        deploy.focus();
      });
    },
  };
}
