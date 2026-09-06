// The player's HUD: the top strip, the hold clock, the commander, the event
// feed, and the bottom-centre selection cluster.
//
// This used to live inside DebugOverlay, in @lions/render, which put the face
// of the game inside the development instrument and inside the rendering
// package. Both were wrong. The HUD is shell (CLAUDE.md: app owns "shell,
// input, UI"), and it is what a player looks at continuously; the roll feed and
// the detection maths that stayed behind in the overlay are what a developer
// looks at while tuning the model.
//
// The layout is map-first as of GH-153. Three stacked `rl-panel` sections in
// the corners covered about a third of a 1440x900 viewport and hid the corner
// a player pans toward most; everything a player reads continuously is now
// edge-anchored, unpanelled, and 8px off the frame. The one panel left on the
// mission screen is projected fire, and it earns its box by being dense,
// transient, and read against whatever the cursor is over.
//
// The bottom-right inspect panel is gone as of slice 2, replaced by the
// cluster at the bottom centre: the order row over either a row of 150px chips
// (one per unit type in the selection) or one 460px card. What still draws the
// way it did is the production panel in production.ts, which the
// reinforcements dock replaces in a later slice.
//
// Nothing here reads or writes sim state — it renders what the sim reports
// (invariant 4). The arithmetic is in hud-model.ts and selection-model.ts, so
// that the strip's inline clock and the big centred clock cannot derive the
// same number twice, and so that "can this selection unload" is answered once.

import { fx, type Sim } from '@lions/sim';
import type { ResolvedCommander } from '../campaign';
import { flash, leave, titleCard } from './motion';
import { markSvg } from './mark';
import { roleBadgeSvg, roleBucket } from './role';
import {
  beatDwellMs,
  countSuppressed,
  holdClock,
  objectiveGlyph,
  roeTone,
  speakerPlate,
  speakerPortrait,
  stepBeat,
  stripObjectives,
  worstPenalties,
  type MissionView,
  type Tone,
} from './hud-model';
import {
  ORDERS,
  groupChips,
  hpTone,
  orderRow,
  stepFocus,
  type OrderId,
  type SelectionFacts,
  type UnitFacts,
} from './selection-model';

export type { MissionView, ObjectiveView, Tone } from './hud-model';
export type { OrderId } from './selection-model';

/**
 * Who delivers the orders, and who else can speak on the bar.
 *
 * `shai` is Shai's rank and plate ALREADY resolved for the current mission
 * (`commanderForMission`, `campaign.ts`) -- this file has no mission id and
 * no `world`/`commander.json` to resolve one from, so the caller (`main.ts`)
 * hands over the answer rather than the ingredients. `idit` is her static
 * plate, needed only when a `say` line is hers.
 *
 * `portrait`, on both, is the RESOLVED URL (`portrait-catalogue.ts`'s
 * `commanderPortraitUrl`, called in `main.ts`) -- not the bare file name
 * `commander.json` authors. `.rl-cmd__face` shows whichever one belongs to
 * the current speaker and falls back to its hatch when that person's is
 * `undefined`, which covers both "never authored" and "authored, file not
 * on disk yet" identically.
 *
 * `enemy` carries a portrait ONLY -- no name, no plate (storyline.md G18:
 * the bar shows the front's villain a face, never a name; `speakerPlate`
 * still answers the literal word `ENEMY` regardless of this field).
 * `main.ts` resolves it from the current mission's `town`, through
 * `regionForTown` and `villainPortrait` (`campaign.ts`), to
 * `commander.json`'s `villains` block -- absent on a sandbox (no owning
 * town), on a front whose villain has no portrait authored yet, or on any
 * mission the enemy has not spoken on at all, which is also fine: this
 * field is read only while an `enemy` `say` line is showing.
 */
export interface HudCommanderInfo {
  shai: ResolvedCommander;
  idit: { name: string; plate: string; portrait?: string };
  enemy?: { portrait?: string };
}

/** The feed is punctuation, not a log. Four lines is what fits above the dock
 *  without the stack reaching the reinforcements tiles. */
const FEED_LINES = 4;

/** How far the projected-fire panel sits from the target it describes. Right
 *  and slightly up, so it never covers the unit the player is aiming at. */
const FIRE_OFFSET = { x: 36, y: -8 };

/** The badge size in each of the two places a unit is pictured. Both are small
 *  enough that the mark is a shape rather than a drawing — the same reason the
 *  cursor's badge is seven buckets and not fourteen roles. */
const CHIP_BADGE = 8;
const CARD_BADGE = 10;
/** And the size the same mark is drawn at when it is standing IN for missing
 *  art rather than labelling it — big enough to read as the picture. */
const CHIP_MARK = 18;
const CARD_MARK = 32;

/**
 * The five order buttons, wired to whatever `main.ts` binds its keys to.
 *
 * A record and not five optional callbacks, so adding a sixth order is a
 * compile error here rather than a button that silently does nothing. Each
 * value is the SAME function object the keydown listener calls — that is the
 * whole contract of this type, and it is why the row cannot promise something
 * the key does not deliver.
 */
export type OrderHandlers = Record<OrderId, () => void>;

export interface HudDeps {
  sim: Sim;
  getSelection: () => number[];
  getMission: () => MissionView | null;
  hoverStructure: () => number;
  hoverEntity: () => number;
  gameVersion: string;
  /** Shai's rank/plate for the mission in play, and Idit's static plate --
   *  see `HudCommanderInfo`'s own doc comment. */
  commander: HudCommanderInfo;
  /** What each order button does. Absent in tests that do not exercise the row
   *  — the buttons then render and are inert, which is also what a mission with
   *  no input wiring should look like. */
  orders?: OrderHandlers;
  /** Which order is armed and waiting for a click on the map, if any. */
  armedOrder?: () => OrderId | null;
  /** The idle-frame URL for a unit type, or null where the type ships no sprite
   *  sheet. Resolved once at boot in main.ts from each sheet's own manifest. */
  portrait?: (typeId: string) => string | null;
  /** Narrow the selection to one chip's sub-group. */
  setSelection?: (ids: number[]) => void;
  /** Game speed as a multiplier: 0 paused, 1 normal, 2 double. The strip owns
   *  the buttons; the frame loop owns the number. */
  getSpeed?: () => number;
  setSpeed?: (speed: number) => void;
  /** Audio state, mirrored by the `m` key. Returns the new muted state. */
  isMuted?: () => boolean;
  toggleMute?: () => void;
}

export class Hud {
  private readonly strip: HTMLDivElement;
  private readonly stripBody: HTMLDivElement;
  private readonly stripInfo: HTMLDivElement;
  private readonly speedChips: { el: HTMLButtonElement; speed: number }[] = [];
  private readonly muteChip: HTMLButtonElement;
  /** The bottom-centre cluster: the order row over the chips or the card. */
  private readonly sel: HTMLDivElement;
  private readonly orderBar: HTMLDivElement;
  private readonly orderBtns = new Map<OrderId, HTMLButtonElement>();
  private readonly cluster: HTMLDivElement;
  /** Which sub-group the lime frame is on, and the type ids it indexes into.
   *  Kept as an index rather than a type id so Tab has something to step, and
   *  re-clamped on every rebuild so a sub-group wiped out by casualties does
   *  not leave the frame pointing past the end of the row. */
  private chipFocus = 0;
  private chipTypes: string[] = [];
  private readonly clock: HTMLDivElement;
  private readonly feed: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly fire: HTMLDivElement;
  private readonly cmd: HTMLDivElement;
  private readonly cmdFace: HTMLDivElement;
  private readonly cmdFaceImg: HTMLImageElement;
  private readonly cmdQuote: HTMLDivElement;
  private readonly cmdWho: HTMLSpanElement;
  private readonly cmdFill: HTMLElement;
  private readonly cmdPrev: HTMLButtonElement;
  private readonly cmdNext: HTMLButtonElement;
  private readonly banner: HTMLDivElement;
  private bannerShown = false;
  private tickN = 0;

  /** "${rank} ${name}", precomputed once from `deps.commander.shai` --
   *  the combined line the face tooltip and the open bar's `who` line both
   *  show, exactly what the retired `COMMANDER.rank` constant used to hold
   *  as one hard-coded string. */
  private readonly commanderLine: string;

  /** The mission's briefing, split into the beats it is delivered in. */
  private beats: string[] = [];
  private beatIdx = 0;
  private beatTimer = 0;
  /** A `say` line (GDD §11) currently overriding the bar's own beat display
   *  -- see `say()`. Cleared by paging (`pageCommander`) or replaced by the
   *  next line; never by a timer, so a radio transmission does not vanish
   *  mid-read the way a beat's own timed fold would. */
  private activeSay: { speaker: string; text: string } | null = null;

  /** Objective status and ROE from the previous refresh, so a change can be
   *  punctuated. Without this the HUD can only show state, never report that
   *  state just changed — and a completed objective is exactly the thing a
   *  player misses while looking somewhere else on the map. */
  private lastStatus = new Map<string, string>();
  private lastRoe: number | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly deps: HudDeps
  ) {
    this.commanderLine = `${deps.commander.shai.rank} ${deps.commander.shai.name}`;
    this.strip = document.createElement('div');
    this.strip.className = 'rl-strip';

    // Three runs, for two different reasons.
    //
    // Left and right, because the strip's two halves report different things:
    // what the mission wants (name, ROE, the objective in hand) and what the
    // force has (resources, suppression, the controls). The right half is
    // pushed over by `rl-strip__gap`.
    //
    // Rebuilt and persistent, because the mission fields are innerHTML'd
    // wholesale four times a second while the speed chips, the campaign link
    // and the mute toggle carry listeners. One innerHTML over both would drop
    // those listeners 4 Hz and break the very first click on any of them.
    //
    // `display: contents` on the rebuilt runs so the strip's own flex gap
    // falls between the fields rather than around a wrapper holding them all.
    this.stripBody = document.createElement('div');
    this.stripBody.style.display = 'contents';
    this.stripInfo = document.createElement('div');
    this.stripInfo.style.display = 'contents';

    const mark = document.createElement('span');
    mark.className = 'rl-strip__mark';
    mark.innerHTML = markSvg(15, 12);
    mark.title = `Roaring Lions${deps.gameVersion ? ` v${deps.gameVersion}` : ''}`;

    const right = document.createElement('div');
    right.className = 'rl-strip__right rl-strip__gap';
    right.appendChild(this.stripInfo);
    this.strip.append(mark, this.stripBody, right);

    // Speed. Rendered even where the frame loop has not wired it, because a
    // strip that grows a control the moment a dependency appears is a strip
    // whose layout nobody has actually looked at.
    const chips = document.createElement('div');
    chips.className = 'rl-strip__chips';
    for (const spec of [
      { speed: 0, label: '▮▮', title: 'pause' },
      { speed: 1, label: '1×', title: 'normal speed' },
      { speed: 2, label: '2×', title: 'double speed' },
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rl-strip__chip';
      b.textContent = spec.label;
      b.title = spec.title;
      b.addEventListener('click', () => {
        deps.setSpeed?.(spec.speed);
        // Repainted here and not on the next tick, deliberately: at speed 0 no
        // tick ever comes, so a pause button that waits for one never lights.
        this.paintSpeed();
        b.blur(); // keep the keyboard on the battlefield, not the button
      });
      this.speedChips.push({ el: b, speed: spec.speed });
      chips.appendChild(b);
    }

    // The map page is always one click away, mid-mission included. A plain
    // navigation, so leaving a fight costs the attempt -- deliberately.
    const campaign = document.createElement('a');
    campaign.className = 'rl-strip__link';
    campaign.href = '?campaign';
    campaign.textContent = '⌂';
    campaign.title = 'campaign map';

    this.muteChip = document.createElement('button');
    this.muteChip.type = 'button';
    this.muteChip.className = 'rl-strip__chip';
    this.muteChip.addEventListener('click', () => {
      deps.toggleMute?.();
      this.paintMute();
      this.muteChip.blur();
    });

    right.append(chips, campaign, this.muteChip);
    this.paintSpeed();
    this.paintMute();

    // --- the selection cluster --------------------------------------------
    //
    // Bottom centre, on the same x as the feed and the controls hint, because
    // it replaces the hint the moment anything is selected: one place at the
    // bottom of the screen that answers "what am I holding and what can it do".
    //
    // The order buttons are built ONCE and only repainted, while the chips and
    // the card are innerHTML'd wholesale four times a second. That split is not
    // tidiness — it is the same lesson the top strip's three runs record. A
    // single innerHTML over both would drop every button's listener 4 Hz, and
    // the symptom is an order button that fires only if you click it fast
    // enough.
    this.sel = document.createElement('div');
    this.sel.className = 'rl-sel';
    this.sel.style.display = 'none';

    this.orderBar = document.createElement('div');
    this.orderBar.className = 'rl-orders';
    for (const spec of ORDERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rl-btn rl-order';
      b.dataset.order = spec.id;
      b.addEventListener('click', () => {
        // Straight through to whatever main.ts bound the key to. No local
        // eligibility check: an inert order still calls its handler, and the
        // handler's own resolver is what explains the refusal in the feed
        // ("select a transport and the infantry to load"). Second-guessing it
        // here would mean two answers to one question.
        this.deps.orders?.[spec.id]();
        b.blur(); // keep the keyboard on the battlefield
      });
      this.orderBtns.set(spec.id, b);
      this.orderBar.appendChild(b);
    }

    this.cluster = document.createElement('div');
    this.cluster.className = 'rl-cluster';
    // Delegated, because the chips themselves are replaced 4 Hz. Clicking a
    // chip narrows the selection to that sub-group, which is what makes the
    // focus frame worth having: Tab picks, the click commits.
    this.cluster.addEventListener('click', (ev) => {
      const chip = (ev.target as HTMLElement | null)?.closest<HTMLElement>('.rl-chip');
      const typeId = chip?.dataset.type;
      if (typeId === undefined) return;
      const sim = this.deps.sim;
      const ids = this.deps
        .getSelection()
        .filter((i) => sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id === typeId);
      if (ids.length > 0) this.deps.setSelection?.(ids);
    });
    this.sel.append(this.orderBar, this.cluster);

    this.clock = document.createElement('div');
    this.clock.className = 'rl-clock';
    this.clock.style.display = 'none';

    this.feed = document.createElement('div');
    this.feed.className = 'rl-feed';

    this.hint = document.createElement('div');
    this.hint.className = 'rl-hint rl-onmap';

    this.fire = document.createElement('div');
    this.fire.className = 'rl-fire';
    this.fire.style.display = 'none';

    // --- commander ---------------------------------------------------------
    this.cmd = document.createElement('div');
    this.cmd.className = 'rl-cmd';
    this.cmd.dataset.open = '0';
    this.cmd.style.display = 'none';

    this.cmdFace = document.createElement('div');
    this.cmdFace.className = 'rl-cmd__face';
    this.cmdFace.title = this.commanderLine;
    // The collapsed frame is the way back in. A briefing the player dismissed
    // by looking away is otherwise unreadable for the rest of the mission.
    this.cmdFace.addEventListener('click', () => this.openCommander());
    // The photo of whoever is currently speaking. Hidden by default, so the
    // frame's own hatch (theme.css: "reads as reserved") shows through until
    // `renderCommander` has a speaker to paint -- and again whenever that
    // speaker has no portrait, since a hidden `<img>` with no `src` cannot
    // show a broken-image glyph. The `error` handler is the one case the
    // build-time glob in `portrait-catalogue.ts` cannot see: a URL it
    // resolved that still fails to load at runtime.
    this.cmdFaceImg = document.createElement('img');
    this.cmdFaceImg.className = 'rl-cmd__face-img';
    this.cmdFaceImg.alt = '';
    this.cmdFaceImg.hidden = true;
    this.cmdFaceImg.addEventListener('error', () => {
      this.cmdFaceImg.hidden = true;
      this.cmdFaceImg.removeAttribute('src');
    });
    const plate = document.createElement('span');
    plate.className = 'rl-cmd__plate';
    plate.textContent = deps.commander.shai.plate;
    // The brigade net (`net`, GDD §11) is a system voice, not a person on the
    // roster -- `speakerPortrait` already returns `undefined` for it exactly
    // as it does for an unauthored portrait, and the hatch that answer used
    // to paint reads as "reserved for art nobody drew yet". That is the wrong
    // message for a speaker with no face to draw at all, so `paintFace`
    // recognises `net` by name and swaps in this mark instead -- always in
    // the DOM like `cmdFaceImg`, shown or hidden purely by the
    // `rl-cmd__face--net` modifier class (theme.css) so CSS owns the look.
    const faceMark = document.createElement('div');
    faceMark.className = 'rl-cmd__face-mark';
    faceMark.innerHTML = markSvg(86, 52);
    this.cmdFace.append(this.cmdFaceImg, plate, faceMark);

    const bar = document.createElement('div');
    bar.className = 'rl-cmd__bar';
    const head = document.createElement('div');
    head.className = 'rl-cmd__head';
    this.cmdWho = document.createElement('span');
    this.cmdWho.className = 'rl-cmd__who';
    const paging = document.createElement('div');
    paging.className = 'rl-cmd__page';
    this.cmdPrev = document.createElement('button');
    this.cmdPrev.type = 'button';
    this.cmdPrev.textContent = '◂';
    this.cmdPrev.title = 'previous';
    this.cmdNext = document.createElement('button');
    this.cmdNext.type = 'button';
    this.cmdNext.textContent = '▸';
    this.cmdNext.title = 'next';
    this.cmdPrev.addEventListener('click', () => this.pageCommander(-1));
    this.cmdNext.addEventListener('click', () => this.pageCommander(1));
    paging.append(this.cmdPrev, this.cmdNext);
    head.append(this.cmdWho, paging);

    this.cmdQuote = document.createElement('div');
    this.cmdQuote.className = 'rl-cmd__quote';
    const track = document.createElement('div');
    track.className = 'rl-cmd__track';
    this.cmdFill = document.createElement('i');
    track.appendChild(this.cmdFill);
    bar.append(head, this.cmdQuote, track);
    this.cmd.append(this.cmdFace, bar);

    this.banner = document.createElement('div');
    this.banner.className = 'rl-bigbanner';
    this.banner.style.display = 'none';

    host.append(
      this.strip,
      this.cmd,
      this.clock,
      this.sel,
      this.feed,
      this.hint,
      this.fire,
      this.banner
    );
  }

  /**
   * Move the lime frame to the next sub-group. Returns false when there is
   * nothing to cycle, which is what lets main.ts leave Tab alone — swallowing
   * the browser's own focus traversal on a screen with no chips on it would be
   * taking a key for nothing.
   */
  cycleChipFocus(): boolean {
    if (this.chipTypes.length < 2) return false;
    this.chipFocus = stepFocus(this.chipFocus, this.chipTypes.length);
    this.paintChipFocus();
    return true;
  }

  /** Repaint the frame without rebuilding the row — Tab has to answer on the
   *  keystroke, not on the next 4 Hz rebuild 250 ms later. */
  private paintChipFocus(): void {
    const chips = this.cluster.querySelectorAll<HTMLElement>('.rl-chip');
    chips.forEach((el, i) => {
      el.dataset.focus = i === this.chipFocus ? '1' : '0';
    });
  }

  /** Mission start punctuation. `dispatch` is the story voice (GDD §11):
   *  present, it holds the card for a full read (`titleCard`'s own
   *  default); absent, the card behaves exactly as it always has. */
  announce(name: string, subtitle: string, dispatch?: string): void {
    titleCard(this.host, name, subtitle, dispatch);
  }

  /**
   * Hand the commander his orders.
   *
   * Beats come from `briefingBeats()` in loading.ts, which is the same split
   * the deployment screen reads the briefing out in — so the bar continues a
   * conversation the player has already started rather than opening a second,
   * differently-punctuated one.
   */
  brief(beats: string[]): void {
    this.beats = beats;
    this.beatIdx = 0;
    if (beats.length === 0 && !this.activeSay) {
      this.cmd.style.display = 'none';
      return;
    }
    this.cmd.style.display = '';
    this.openCommander();
  }

  /**
   * The story voice (GDD §11): a `say` line takes over the commander bar,
   * showing the speaker's own plate in place of the rank/beat line, until
   * the next line replaces it or the player pages a beat (`pageCommander`
   * clears it -- see that method's own comment). Independent of `brief()`:
   * a mission can carry `say` events on its triggers with no authored
   * `briefing` prose at all, so this forces the bar visible and cancels any
   * pending beat-fold timer rather than assuming `brief()` already ran.
   */
  say(speaker: string, text: string): void {
    this.activeSay = { speaker, text };
    window.clearTimeout(this.beatTimer);
    this.cmd.style.display = '';
    this.cmd.dataset.open = '1';
    this.renderCommander();
  }

  onTick(): void {
    this.updateBanner();
    // A full innerHTML rebuild at 20 Hz stalls the page exactly when combat
    // floods events. 4 Hz reads identically.
    if (this.tickN++ % 5 !== 0) return;
    this.renderStrip();
    this.renderCard();
    this.renderClock();
    this.renderHint();
    this.renderFire();
  }

  /**
   * Put the projected-fire panel beside the thing it describes.
   *
   * Called from the frame loop rather than from `onTick`, because at 4 Hz a
   * panel anchored to a moving target visibly steps along behind it. Only the
   * position moves here; the rows are rebuilt on the tick with everything
   * else, which is the cadence the content actually changes at.
   */
  placeFire(x: number, y: number): void {
    this.fire.style.left = `${Math.round(x + FIRE_OFFSET.x)}px`;
    this.fire.style.top = `${Math.round(y + FIRE_OFFSET.y)}px`;
  }

  /** Mirror the audio state the `m` key just changed. */
  paintMute(): void {
    const muted = this.deps.isMuted?.() ?? false;
    this.muteChip.textContent = muted ? '🔇' : '🔊';
    this.muteChip.title = muted ? 'audio muted' : 'audio on';
    this.muteChip.dataset.on = muted ? '0' : '1';
  }

  private paintSpeed(): void {
    const now = this.deps.getSpeed?.() ?? 1;
    for (const { el, speed } of this.speedChips) el.dataset.on = speed === now ? '1' : '0';
  }

  /** Mission-level narration — objectives, triggers, waves, refusals. */
  note(html: string, tone: Tone = 'live'): void {
    const el = document.createElement('div');
    el.className = `rl-notice rl-enter rl-onmap rl-${tone}`;
    el.innerHTML = html;
    this.feed.prepend(el);
    while (this.feed.childElementCount > FEED_LINES) {
      this.feed.lastElementChild?.remove();
    }
    // Notices are punctuation, not a log — the roll feed in the debug overlay
    // is where history lives. These clear themselves so the map stays visible.
    window.setTimeout(() => leave(el), 9000);
  }

  private updateBanner(): void {
    const m = this.deps.getMission();
    if (!m || m.result === 'ongoing' || this.bannerShown) return;
    this.bannerShown = true;
    this.banner.innerHTML = '<div class="rl-bigbanner__head"></div>';
    (this.banner.firstChild as HTMLElement).textContent =
      m.result === 'victory' ? 'Mission accomplished' : 'Mission failed';
    // The story voice's closing line (GDD §11) -- victory only, matching
    // `mission.ts`'s own doc comment on `aftermath`: "Shown on the victory
    // banner." A defeat gets no second line; the retry prompt speaks for
    // itself.
    if (m.result === 'victory' && m.aftermath) {
      const line = document.createElement('div');
      line.className = 'rl-bigbanner__aftermath';
      line.textContent = m.aftermath;
      this.banner.appendChild(line);
    }
    this.banner.dataset.result = m.result;
    this.banner.style.display = 'block';
    this.banner.classList.add('rl-banner-in');
  }

  // ------------------------------------------------------------------
  // Commander: the briefing, delivered a beat at a time.
  // ------------------------------------------------------------------

  private openCommander(): void {
    if (this.beats.length === 0 && !this.activeSay) return;
    this.cmd.dataset.open = '1';
    this.renderCommander();
  }

  /** ◂/▸: always steps the underlying BEAT position, whether or not a `say`
   *  line is currently showing over it -- "keep the beat paging working"
   *  means the buttons' enabled state and what they step are unaffected by
   *  the overlay. A manual page is also how a `say` line is dismissed by
   *  hand, short of waiting for the next one: it clears `activeSay` before
   *  stepping, so the very next render shows the beat paging landed on. */
  private pageCommander(dir: number): void {
    this.activeSay = null;
    this.beatIdx = stepBeat(this.beatIdx, this.beats.length, dir);
    this.renderCommander();
  }

  private renderCommander(): void {
    const total = this.beats.length;
    this.cmdPrev.disabled = this.beatIdx === 0;
    this.cmdNext.disabled = total === 0 || this.beatIdx === total - 1;
    // Beats are always delivered by Shai, so the default speaker (no active
    // `say` line) is his -- the same default `commanderLine` above already
    // assumes.
    this.paintFace(this.activeSay?.speaker ?? 'shai');
    if (this.activeSay) {
      const { speaker, text } = this.activeSay;
      this.cmdWho.textContent = speakerPlate(this.deps.commander, speaker);
      this.cmdQuote.textContent = `“${text}”`;
      this.cmdFill.style.width = '100%';
      return;
    }
    const text = this.beats[this.beatIdx] ?? '';
    this.cmdWho.textContent = `${this.commanderLine} · ${this.beatIdx + 1} / ${total}`;
    this.cmdQuote.textContent = `“${text}”`;
    this.cmdFill.style.width = `${(((this.beatIdx + 1) / total) * 100).toFixed(0)}%`;
    // Each beat gets its own dwell, restarted by paging. The bar folds back to
    // the portrait rather than vanishing: the orders stay one click away.
    window.clearTimeout(this.beatTimer);
    this.beatTimer = window.setTimeout(() => {
      this.cmd.dataset.open = '0';
    }, beatDwellMs(text));
  }

  /**
   * `.rl-cmd__face` tracks whoever is currently speaking -- Shai while the
   * bar shows his own beats, whoever a `say` line names otherwise
   * (`speakerPortrait`, `hud-model.ts`). `net` is carved out FIRST and
   * always paints the brigade mark (`rl-cmd__face--net`, theme.css) rather
   * than looking up a portrait at all -- it is the brigade radio net, never
   * a person, so there is no face to reserve a hatch for. `undefined` from
   * `speakerPortrait` still covers the remaining cases the caller does not
   * need to tell apart: the person has no portrait authored, `commander.json`
   * names a file this build never found on disk, or the speaker is `enemy`
   * and this mission's front has no villain portrait resolved
   * (`deps.commander.enemy`, absent on a sandbox or a front not yet
   * reached) -- every one of THOSE means "show the hatch", because each is
   * art not yet produced rather than art that will never exist. When it IS
   * resolved, `enemy` paints the villain's face while `speakerPlate` still
   * answers the literal word `ENEMY` on the line beside it (storyline.md
   * G18: a face, never a name).
   */
  private paintFace(speaker: string): void {
    this.cmdFace.classList.toggle('rl-cmd__face--net', speaker === 'net');
    if (speaker === 'net') {
      this.cmdFaceImg.hidden = true;
      this.cmdFaceImg.removeAttribute('src');
      return;
    }
    const url = speakerPortrait(this.deps.commander, speaker);
    if (url === undefined) {
      this.cmdFaceImg.hidden = true;
      this.cmdFaceImg.removeAttribute('src');
      return;
    }
    this.cmdFaceImg.hidden = false;
    if (this.cmdFaceImg.getAttribute('src') !== url) this.cmdFaceImg.src = url;
  }

  // ------------------------------------------------------------------
  // Top strip: the mission, in one line, always.
  // ------------------------------------------------------------------

  private renderStrip(): void {
    const m = this.deps.getMission();
    const rows: string[] = [];
    if (m) {
      // The campaign summary has no field of its own in a 30px strip. It rides
      // the mission name's tooltip rather than being dropped: it is a
      // between-missions fact, not something read mid-fight.
      rows.push(
        `<span class="rl-strip__name"${m.campaign ? ` title="${escapeAttr(m.campaign)}"` : ''}>${m.name}</span>`
      );
      if (m.roe !== undefined) {
        rows.push(
          `<span><b class="rl-${roeTone(m.roe)}" data-roe>${m.roe}</b> <span class="rl-dim">ROE</span></span>`
        );
      }
      const { primary, secondaryOpen } = stripObjectives(m);
      const hold = holdClock(m);
      if (primary) {
        // The clock is stamped inline ONLY when it belongs to this objective.
        // A hold running on a secondary while the strip shows a primary would
        // otherwise read as the primary's own timer.
        const inline =
          hold && hold.id === primary.id
            ? ` <b class="${hold.tone ? `rl-${hold.tone}` : ''}">${hold.text}</b>`
            : '';
        const tone =
          primary.status === 'complete' ? 'rl-good' : primary.status === 'failed' ? 'rl-bad' : '';
        rows.push(
          `<span class="rl-strip__obj ${tone}" data-obj="${escapeAttr(primary.id)}">` +
            `${objectiveGlyph(primary.status)} ${primary.text}${inline}</span>`
        );
      }
      if (secondaryOpen > 0) {
        rows.push(`<span class="rl-dim">+${secondaryOpen} secondary</span>`);
      }
    } else {
      rows.push('<span class="rl-strip__name">Roaring Lions</span>');
    }

    const info: string[] = [];
    if (m?.logistics !== undefined) {
      const rate =
        m.logisticsRate !== undefined && m.logisticsRate > 0
          ? ` <span class="rl-dim">+${m.logisticsRate}/min</span>`
          : '';
      info.push(`<span class="rl-info" title="logistics">▣ <b>${m.logistics}</b>${rate}</span>`);
    }
    if (m?.intel !== undefined) {
      info.push(`<span class="rl-info" title="intel">◎ <b>${m.intel}</b></span>`);
    }
    // Suppression: shown only when there is some. A permanent "0 pinned" is
    // the kind of field a player learns to stop reading.
    const { pinned, broken } = countSuppressed(this.deps.sim.state, this.deps.sim.entityCount);
    if (pinned > 0) info.push(`<span class="rl-hot"><b>▼ ${pinned} pinned</b></span>`);
    if (broken > 0) info.push(`<span class="rl-bad"><b>⚑ ${broken} broken</b></span>`);

    this.stripBody.innerHTML = rows.join('');
    this.stripInfo.innerHTML = info.join('');
    this.punctuate(m);
  }

  /** Flash what just changed. Runs after the rebuild, on the fresh nodes. */
  private punctuate(m: MissionView | null): void {
    if (!m) return;
    for (const o of m.objectives) {
      const prev = this.lastStatus.get(o.id);
      this.lastStatus.set(o.id, o.status);
      if (prev === undefined || prev === o.status) continue;
      const row = this.stripBody.querySelector<HTMLElement>(`[data-obj="${CSS.escape(o.id)}"]`);
      if (row) flash(row, o.status === 'complete' ? 'rl-flash-good' : 'rl-flash-bad', 400);
    }
    if (m.roe !== undefined) {
      const dropped = this.lastRoe !== null && m.roe < this.lastRoe;
      this.lastRoe = m.roe;
      const el = this.stripBody.querySelector<HTMLElement>('[data-roe]');
      if (dropped && el) flash(el, 'rl-flash-bad', 300);
    }
  }

  // ------------------------------------------------------------------
  // Bottom centre: what the controls are, while nothing is selected.
  // ------------------------------------------------------------------

  private renderHint(): void {
    if (this.deps.getSelection().length > 0) {
      this.hint.style.display = 'none';
      return;
    }
    this.hint.style.display = '';
    // One line, not the three-line block this replaces. That block was a panel
    // section with room to spare; on bare map it is a wall, and measured at
    // 1440 the full key list wrapped to two lines and read as a paragraph
    // sitting on the battlefield. The verb keys (h/f/g/u) are deliberately not
    // here: the order row a later slice puts in this same place names them as
    // buttons, and the unit card's Capabilities section already does.
    this.hint.textContent =
      'click/drag select · right-click attack-move · shift adds a waypoint · ' +
      'ctrl+1–9 group · 1–9 recall';
  }

  // ------------------------------------------------------------------
  // Projected fire: what a shot costs, before it is taken.
  // ------------------------------------------------------------------

  /**
   * Projected P(hit) for each selected unit against the hovered enemy.
   *
   * GDD 5.8: the player should know what a shot costs before taking it. Rows
   * are capped because selecting the whole force must not bury the map, and
   * units that cannot engage are counted rather than listed — "3 cannot reach"
   * is information, three empty rows are not.
   */
  private renderFire(): void {
    const html = this.projectedFireHtml();
    this.fire.style.display = html === '' ? 'none' : '';
    if (html !== '') this.fire.innerHTML = html;
  }

  private projectedFireHtml(): string {
    const sim = this.deps.sim;
    const t = this.deps.hoverEntity();
    if (t < 0 || sim.state.alive[t] === 0) return '';
    const sel = this.deps.getSelection().filter((i) => sim.state.alive[i] === 1);
    if (sel.length === 0) return '';

    const MAX_ROWS = 6;
    const rows: string[] = [];
    let cannot = 0;
    let unidentified = 0;
    let holdingFire = 0;
    for (const s of sel) {
      const p = sim.projectHit(s, t);
      if (p.kind === 'unidentified') {
        unidentified++;
        continue;
      }
      if (p.kind === 'noSolution') {
        cannot++;
        continue;
      }
      if (p.kind === 'holdingFire') {
        holdingFire++;
        continue;
      }
      if (rows.length >= MAX_ROWS) continue;
      const name = sim.unitTypes[sim.state.typeIdx[s]].name;
      const chance = Math.round(fx.toNumber(p.pHit) * 100);
      // Name only the factors actually degrading the shot, worst first.
      // accuracy is the weapon's baseline, not a penalty the player can act on.
      const worst = worstPenalties([
        ['range', fx.toNumber(p.factors.rangeFalloff)],
        ['cover', fx.toNumber(p.factors.coverMod)],
        ['target moving', fx.toNumber(p.factors.motionMod)],
        ['firing on the move', fx.toNumber(p.factors.stanceMod)],
        ['suppressed', fx.toNumber(p.factors.suppressionMod)],
      ]);
      const why = worst.length > 0 ? ` · ${worst.join(' · ')}` : '';
      const bounce = p.hurts ? '' : ' · <span class="rl-bad">cannot penetrate</span>';
      rows.push(
        `<div>${name} <b>${chance}%</b> <span class="rl-dim">${p.weaponId}${why}</span>${bounce}</div>`
      );
    }

    const target = sim.unitTypes[sim.state.typeIdx[t]].name;
    const head = `<div class="rl-label">Projected fire · ${target}</div>`;
    if (rows.length === 0 && unidentified > 0 && cannot === 0 && holdingFire === 0) {
      return head + '<div class="rl-dim">contact not identified — no firing solution</div>';
    }
    // Pinned or lying in ambush is a different fact from "cannot reach" —
    // the shot exists, the unit is choosing (or forced) not to take it.
    if (rows.length === 0 && holdingFire > 0 && cannot === 0 && unidentified === 0) {
      return head + '<div class="rl-dim">pinned — holding fire</div>';
    }
    if (rows.length === 0) return head + '<div class="rl-dim">no unit can engage</div>';

    const extra = sel.length - rows.length - cannot - unidentified - holdingFire;
    const tail: string[] = [];
    if (extra > 0) tail.push(`and ${extra} more`);
    if (cannot > 0) tail.push(`${cannot} cannot reach`);
    if (holdingFire > 0) tail.push(`${holdingFire} holding fire`);
    if (unidentified > 0) tail.push(`${unidentified} unidentified`);
    const foot = tail.length > 0 ? `<div class="rl-dim">${tail.join(' · ')}</div>` : '';
    return head + rows.join('') + foot;
  }

  // ------------------------------------------------------------------
  // The selection cluster: the order row, and either a chip per unit type or
  // one wide card.
  //
  // One entry point rather than two, because the two states share the order
  // row above them and share the decision of whether the whole cluster is on
  // screen at all. `sel.length` picks the body: one unit gets the 460px card
  // with its armament and capabilities, more than one gets 150px chips
  // grouped by type. A player is asking a different question in each case —
  // "what is this thing" versus "what have I got" — and answering both with
  // the same widget is what the old bottom-right panel did.
  // ------------------------------------------------------------------

  private renderCard(): void {
    const sim = this.deps.sim;
    // Alive only. A selection outlives its units by up to a tick, and a chip
    // reporting a corpse's health reads as a bug in the health bar.
    const sel = this.deps.getSelection().filter((i) => sim.state.alive[i] === 1);
    if (sel.length === 0) {
      this.sel.style.display = 'none';
      this.chipTypes = [];
      return;
    }
    const wasHidden = this.sel.style.display === 'none';
    this.sel.style.display = '';

    this.renderOrders(sel);
    if (sel.length === 1) {
      this.chipTypes = [];
      this.cluster.innerHTML = this.cardHtml(sel[0]);
    } else {
      this.renderChips(sel);
    }
    // The cluster arrives from below the frame edge the first time it is
    // needed, and then holds still: re-running the entrance on every rebuild
    // would make it twitch four times a second.
    if (wasHidden) {
      this.sel.classList.remove('rl-enter');
      void this.sel.offsetWidth; // restart the animation rather than resume it
      this.sel.classList.add('rl-enter');
    }
  }

  // ------------------------------------------------------------------
  // Order row.
  // ------------------------------------------------------------------

  /**
   * Show the orders this selection can give, and dim the ones that would do
   * nothing right now.
   *
   * Only own-side living units count: an enemy or a civilian can be
   * click-selected (pickUnit does not filter by side, deliberately — inspecting
   * a contact is how a player reads the battlefield) and no order in this row
   * applies to one.
   */
  private renderOrders(sel: number[]): void {
    const sim = this.deps.sim;
    const st = sim.state;
    const mine = sel.filter((i) => st.side[i] === 0);
    const facts: SelectionFacts = {
      count: mine.length,
      underway: 0,
      smokers: 0,
      carriers: 0,
      slots: 0,
      aboard: 0,
      riders: 0,
    };
    for (const i of mine) {
      const type = sim.unitTypes[st.typeIdx[i]];
      if (st.moving[i] === 1 || sim.waypointCount(i) > 0) facts.underway++;
      if (type.canSmoke) facts.smokers++;
      if (type.canEmbark) facts.riders++;
      if (type.transportSlots > 0) {
        facts.carriers++;
        facts.slots += type.transportSlots;
        facts.aboard += sim.passengerCount(i);
      }
    }
    const rows = orderRow(facts, this.deps.armedOrder?.() ?? null);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const [id, btn] of this.orderBtns) {
      const row = byId.get(id);
      if (!row) {
        btn.style.display = 'none';
        continue;
      }
      btn.style.display = '';
      btn.dataset.armed = row.armed ? '1' : '0';
      // Not `disabled`: an inert order still runs its handler, and the
      // handler's own note is what tells the player why nothing happened.
      // A disabled button answers "why?" with silence.
      btn.dataset.inert = row.inert ? '1' : '0';
      const cap =
        row.capacity !== undefined ? ` <b class="rl-dim">${row.capacity}</b>` : '';
      btn.innerHTML =
        `<span class="rl-order__glyph">${row.glyph}</span>${row.label}` +
        `${cap} <b class="rl-dim">${row.key}</b>`;
      btn.title = row.inert
        ? `${row.label} — nothing in the selection would act on it right now`
        : row.label;
    }
  }

  // ------------------------------------------------------------------
  // Multi-select: one chip per unit type.
  // ------------------------------------------------------------------

  private renderChips(sel: number[]): void {
    const sim = this.deps.sim;
    const st = sim.state;
    const facts: UnitFacts[] = sel.map((i) => {
      const type = sim.unitTypes[st.typeIdx[i]];
      return {
        typeId: type.id,
        name: type.name,
        bucket: roleBucket(type),
        hp: fx.toNumber(st.hp[i]),
        hpMax: fx.toNumber(type.hp),
        routed: st.routed[i] === 1,
        pinned: st.pinned[i] === 1,
        moving: st.moving[i] === 1,
        aboard: st.carriedBy[i] >= 0,
        ...(type.hasAps
          ? { aps: { ammo: st.apsAmmo[i], magazine: type.apsMagazine } }
          : {}),
      };
    });
    const chips = groupChips(facts);
    this.chipTypes = chips.map((c) => c.typeId);
    // Clamp rather than reset: losing the last sub-group should walk the frame
    // back one, not throw it to the front of the row.
    if (this.chipFocus >= chips.length) this.chipFocus = Math.max(0, chips.length - 1);

    this.cluster.innerHTML = chips
      .map((c, i) => {
        const tone = c.statusTone === null ? 'rl-dim' : `rl-${c.statusTone}`;
        return (
          `<div class="rl-chip" data-type="${escapeAttr(c.typeId)}" ` +
          `data-focus="${i === this.chipFocus ? '1' : '0'}" ` +
          `title="${escapeAttr(c.name)} — click to select only these">` +
          this.artHtml(c.typeId, c.bucket, 'rl-chip__art', CHIP_MARK) +
          `<div class="rl-chip__body">` +
          `<div class="rl-chip__top">` +
          // The name in its own span, not loose text beside the badge:
          // `text-overflow: ellipsis` has no effect on a flex CONTAINER's own
          // text, so "AH-64 Peten" was being cut to "AH-64 Pete" with no
          // ellipsis, which reads as a truncated field rather than a long name.
          `<span class="rl-chip__name">${roleBadgeSvg(c.bucket, CHIP_BADGE)}` +
          `<span>${c.name}</span></span>` +
          `<b>×${c.count}</b>` +
          `</div>` +
          `<div class="rl-track"><i class="rl-fill-${c.hpTone}" ` +
          `style="width:${(c.hpPct * 100).toFixed(0)}%"></i></div>` +
          `<div class="rl-chip__status ${tone}">${c.status}</div>` +
          `</div></div>`
        );
      })
      .join('');
  }

  /**
   * A unit's own art, or a deliberate stand-in for a type that ships none.
   *
   * The stand-in is the commander portrait's hatch with the role mark on it —
   * the same "reserved, not broken" language the briefing bar already uses —
   * and never an empty box. `civilians` is the one shipped type with no sheet
   * in `SPRITE_MAP`, and it is reachable: a left click picks any unit, not only
   * your own. A boot where a sheet failed to fetch lands here too, which is the
   * case worth drawing honestly: the HUD says "no picture for this type", and
   * the failed-art notice says which.
   */
  private artHtml(
    typeId: string,
    bucket: ReturnType<typeof roleBucket>,
    cls: string,
    markSize: number
  ): string {
    const src = this.deps.portrait?.(typeId) ?? null;
    if (src === null) {
      return (
        `<div class="${cls}" data-nosprite="1" title="${escapeAttr(typeId)} — no sprite sheet">` +
        `${roleBadgeSvg(bucket, markSize)}</div>`
      );
    }
    return `<img class="${cls}" src="${escapeAttr(src)}" alt="" draggable="false">`;
  }

  // ------------------------------------------------------------------
  // Single unit: the wide card.
  // ------------------------------------------------------------------

  private cardHtml(id: number): string {
    const sim = this.deps.sim;
    const st = sim.state;
    const type = sim.unitTypes[st.typeIdx[id]];
    const hpNow = fx.toNumber(st.hp[id]);
    const hpMax = fx.toNumber(type.hp);
    const hpPct = hpMax > 0 ? Math.max(0, hpNow / hpMax) : 0;
    const vet = st.veterancy[id];
    const bucket = roleBucket(type);

    // Condition: only what is actually true right now. Unchanged from the panel
    // this replaces — the list is the product of a dozen play sessions and the
    // layout around it is what GH-153 is changing, not the facts in it.
    const flags: string[] = [];
    if (st.routed[id] === 1) flags.push('<span class="rl-bad">BROKEN</span>');
    else if (st.pinned[id] === 1) flags.push('<span class="rl-hot">PINNED</span>');
    if (st.garrisonedIn[id] >= 0) flags.push('<span class="rl-live">in a building</span>');
    if (st.mobilityKilled[id] === 1) flags.push('<span class="rl-dim">immobilised</span>');
    if (st.firepowerKilled[id] === 1) flags.push('<span class="rl-bad">guns out</span>');
    if (st.moving[id] === 1) flags.push('moving');
    const supp = fx.toNumber(st.suppression[id]);
    if (supp > 0.05) flags.push(`suppression ${(supp * 100).toFixed(0)}%`);
    if (type.hasAps) flags.push(`<span class="rl-info">APS ${st.apsAmmo[id]}/${type.apsMagazine}</span>`);
    const wp = sim.waypointCount(id);
    if (wp > 0) flags.push(`${wp} waypoint${wp === 1 ? '' : 's'}`);

    // Armament, so the player can tell what this unit is for.
    const arms: string[] = [];
    if (type.weapons.length > 0) {
      for (const w of type.weapons) {
        const pen = fx.toNumber(w.penetration);
        arms.push(
          `<div>${w.id} — ${fx.toNumber(w.effectiveRange).toFixed(1)}/${fx.toNumber(w.range).toFixed(0)} tiles` +
            (pen > 0 ? ` · ${pen.toFixed(0)}mm pen` : '') +
            (fx.toNumber(w.collateralRisk) >= 0.5 ? ' <span class="rl-warn">⚠ heavy</span>' : '') +
            `</div>`
        );
      }
    } else {
      arms.push('<div class="rl-dim">unarmed</div>');
    }

    // Special controls: what this unit can do beyond move and shoot.
    const caps: string[] = [];
    if (type.canSmoke) caps.push('<b>f</b> smoke screen');
    if (st.carriedBy[id] >= 0) caps.push('<b>aboard a transport</b> — <b>u</b> to dismount');
    if (type.canGarrison) caps.push('right-click a building to garrison');
    // Two sentences because there are now two rules: charges go in wherever the
    // unit halts, except at a protected site, which takes an order by name.
    // Saying only the first left the player with a dozer that silently refused
    // to touch a mosque and no hint that right-clicking it would work.
    if (type.canDemolish) caps.push('hold beside a building to demolish it · right-click a protected site to order it');
    if (type.isKamikaze) {
      caps.push('<span class="rl-hot">one-use: dives on what your side has identified</span>');
    }
    if (type.transportSlots > 0) {
      caps.push(`carries ${type.transportSlots} — <b>g</b> load · <b>u</b> unload`);
    }
    if (type.canMarkTarget) caps.push('earns intel while stationary');
    if (caps.length === 0) caps.push('<span class="rl-dim">none</span>');

    return (
      `<div class="rl-card" data-type="${escapeAttr(type.id)}">` +
      `<div class="rl-card__frame">` +
      this.artHtml(type.id, bucket, 'rl-card__art', CARD_MARK) +
      // The corner badge only where there IS art. Without it the placeholder
      // already carries the mark, and two of the same shape in one 72px frame
      // reads as a rendering fault rather than as emphasis.
      (this.deps.portrait?.(type.id) != null
        ? `<span class="rl-card__badge">${roleBadgeSvg(bucket, CARD_BADGE)}</span>`
        : '') +
      `</div>` +
      `<div class="rl-card__body">` +
      `<div class="rl-card__top">` +
      `<span class="rl-card__name">${type.name}</span>` +
      (vet > 0 ? `<span class="rl-warn">${'★'.repeat(vet)}</span>` : '') +
      `<span class="rl-card__hp rl-dim">${hpNow.toFixed(0)} / ${hpMax.toFixed(0)} hp</span>` +
      `</div>` +
      `<div class="rl-track"><i class="rl-fill-${hpTone(hpPct)}" ` +
      `style="width:${(hpPct * 100).toFixed(0)}%"></i></div>` +
      `<div class="rl-card__cond">${flags.length > 0 ? flags.join(' · ') : 'holding position'}</div>` +
      `<div class="rl-card__cols">` +
      `<div><div class="rl-label">Armament</div>${arms.join('')}</div>` +
      `<div><div class="rl-label">Capabilities</div>${caps.map((c) => `<div>${c}</div>`).join('')}</div>` +
      `</div></div></div>`
    );
  }

  // ------------------------------------------------------------------
  // Clock: in a timed hold you watch this more than anything else.
  // ------------------------------------------------------------------

  private renderClock(): void {
    const hold = holdClock(this.deps.getMission());
    if (!hold) {
      this.clock.style.display = 'none';
      return;
    }
    this.clock.textContent = hold.text;
    this.clock.dataset.tone = hold.tone;
    this.clock.classList.toggle('rl-pulse', hold.contested);
    this.clock.style.display = 'block';
  }
}

/** Mission and objective text reaches the strip inside an attribute. Escaped
 *  rather than trusted: it is authored JSON, but an apostrophe in a mission
 *  name would otherwise end the attribute and eat the rest of the strip. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
