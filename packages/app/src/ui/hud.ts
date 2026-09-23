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
import type { RosterEntry } from '../ledger-store';
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { confirmDialog } from './confirm';
import { escapeHtml } from './escape-html';
import { flash, leave, titleCard } from './motion';
import { markSvg } from './mark';
import { roleBadgeSvg, roleBucket } from './role';
import { bindDelegatedTip, bindTip } from './tooltip';
import {
  beatDwellMs,
  conductDefinition,
  countSuppressed,
  holdClock,
  objectiveGlyph,
  roeTone,
  speakerPlate,
  speakerPortrait,
  stepBeat,
  stripObjectives,
  textToneClass,
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
  type ChipView,
  type OrderId,
  type OrderSpec,
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

/** Task 9: consecutive HUD ticks the projected-fire panel must stay visible
 *  before `deps.onProjectedFireShown` fires -- 3 ticks at the 4Hz
 *  `renderFire` cadence is ~0.75s, long enough that a player actually read
 *  it rather than swept the cursor past a hostile on the way somewhere else. */
const FIRE_TAUGHT_STREAK = 3;

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
  /** The label an order button prints for the key that does the same thing.
   *  `row.key` (from `selection-model.ts`'s `ORDERS`) is an `input/keymap.ts`
   *  ACTION id for every bound order and the literal `'RMB'` for `attackMove`
   *  — this is how the row turns that id into the CURRENT keycap, honouring a
   *  rebind, rather than printing the id itself. Absent in tests that do not
   *  exercise the row, which prints `row.key` unchanged (the same as an
   *  identity mapping). */
  keyFor?: (action: string) => string;
  /** The idle-frame URL for a unit type, or null where the type ships no sprite
   *  sheet. Resolved once at boot in main.ts from each sheet's own manifest. */
  portrait?: (typeId: string) => string | null;
  /** True when the URL `portrait` above returned for this type came from a
   *  cropped `unitIcon` rather than a whole sheet frame -- `artHtml` uses this
   *  only to set `data-icon="1"`, which `theme.css` reads to pick
   *  `image-rendering` (a resampled crop must not be nearest-neighboured the
   *  way a palette-quantised sheet frame is). Absent in tests that do not
   *  exercise it, which is the same as every type reading as a sheet frame. */
  portraitIsIcon?: (typeId: string) => boolean;
  /** The campaign roster entry a fielded unit was drawn from, if any -- the
   *  card's callsign and service record. Absent in tests and for a fresh spawn
   *  with no campaign history. Readonly, matching `MissionRuntime.rosterEntryOf`:
   *  this is the runtime's own entry, not a copy, and the HUD only ever reads it.
   *  Widened to `RosterEntry` (app-side, `slot` optional) rather than the sim's
   *  own `LedgerRosterEntry` -- `main.ts` hands over the runtime's entry
   *  unchanged, and the widening is free because `slot` is optional. */
  rosterEntryOf?: (id: number) => Readonly<RosterEntry> | undefined;
  /** The memorial record for whoever last held this slot before it was
   *  refilled (WP-G-E4, R-6), or `undefined` if the slot has never been lost --
   *  the common case, and a fresh spawn's absent `entry.slot` never calls this
   *  at all. It reads the ledger `main.ts` booted this battlefield with -- a
   *  `const`, never rebound -- which is the right one mid-mission: this
   *  mission's own losses reach `roster.lost` only through the victory write
   *  at mission end. `type` already carries a resolved display name
   *  (the same lookup `units[type]?.name ?? type` the debrief uses) -- never a
   *  raw sim type id -- so `cardHtml`'s own fallback never has to resolve one. */
  predecessorOf?: (slot: number) => { name?: string; type: string } | undefined;
  /** Narrow the selection to one chip's sub-group. */
  setSelection?: (ids: number[]) => void;
  /** Game speed as a multiplier: 0 paused, 1 normal, 2 double. The strip owns
   *  the buttons; the frame loop owns the number. */
  getSpeed?: () => number;
  setSpeed?: (speed: number) => void;
  /** Audio state, mirrored by the `m` key. Returns the new muted state. */
  isMuted?: () => boolean;
  toggleMute?: () => void;
  /** Task 6: whether the pause modal is up. `paintSpeed` reads this to dim
   *  the speed chips -- distinct from `getSpeed() === 0`, which is a player
   *  choice (a deliberate hold at 0x) rather than the mission being paused. */
  isPaused?: () => boolean;
  /** The navigation behind "leave the mission", confirmed first -- the Hud
   *  reads no `window.location` of its own and spells no path (`ui/confirm.ts`'s
   *  own header: this used to be a plain `<a href="?campaign">` with no confirm
   *  at all). `main.ts` passes
   *  `() => window.location.assign(routes.campaign())` -- still a FULL
   *  navigation, because a mission's teardown does not exist yet; absent in
   *  tests that do not exercise the click. */
  leave?: () => void;
  /** Task 6: opens (or, on a second call, closes) the in-mission objective
   *  tracker -- the strip's `+N` control is the one thing on this bar that
   *  reads the mission's FULL objective list rather than the one primary
   *  `renderStrip` already stamps inline. `main.ts` mounts the shared
   *  `objectivesPanel` lazily behind this call; absent in tests that do not
   *  exercise the click, which is the same as the control doing nothing. */
  openObjectives?: () => void;
  /** Task 9: what the bottom-centre hint line says, right now -- built by
   *  `main.ts` from `hint-model.ts`'s `hintFor` and the facts only the shell
   *  has (the selection, the hover, and the two `lions.seen` first-use
   *  flags). Absent in tests that do not exercise it, which falls back to
   *  today's plain controls line -- the same "a HUD built without this dep
   *  behaves as before" rule every other optional dep here follows. `hud.ts`
   *  itself carries no facts and no storage: it only asks the question and
   *  paints the answer, merging in a live key cap (`keyFor`) for the one
   *  hint that names a key. */
  hint?: () => { key: string; params?: Readonly<Record<string, string | number>> } | null;
  /** Task 9: the projected-fire panel has now held the screen for three
   *  consecutive HUD ticks (~0.75s at 4Hz) -- `renderFire`'s own streak
   *  counter, not a raw "is it visible this frame" signal, so a panel that
   *  flickers past on one hover does not teach the same lesson a panel the
   *  player actually read does. Called once per streak; `main.ts` marks
   *  `lions.seen.projectedFire` from it. Absent in tests that do not
   *  exercise it, which is the same as never marking it. */
  onProjectedFireShown?: () => void;
}

export class Hud {
  private readonly strip: HTMLDivElement;
  private readonly stripBody: HTMLDivElement;
  private readonly stripInfo: HTMLDivElement;
  private readonly speedChips: { el: HTMLButtonElement; speed: number }[] = [];
  /** The chip row itself, so `paintSpeed` can dim it as a whole with
   *  `data-paused` (theme.css) rather than each chip individually. */
  private readonly speedCluster: HTMLDivElement;
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
  /** The chip row's own data from the last `renderChips`, so the delegated
   *  chip tooltip (bound once, in the constructor) can look a hovered chip's
   *  name and count back up by `data-tip` at SHOW time, rather than needing
   *  the html baked into the chip's own markup the way `title` used to carry
   *  it -- `groupChips` is already recomputed at 4 Hz, so this is never more
   *  than one tick stale. */
  private chipViews: ChipView[] = [];
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
  /** Task 9: consecutive HUD ticks (the 4Hz `renderFire` cadence, not raw
   *  `onTick` calls) the projected-fire panel has been visible without a
   *  gap -- reset to 0 the instant it hides. `renderFire` calls
   *  `deps.onProjectedFireShown` once it reaches `FIRE_TAUGHT_STREAK`, and
   *  only once per streak: a panel a player glances past on one hover has
   *  not taught them anything, where one they held over for ~0.75s has. */
  private fireVisibleStreak = 0;

  /** Fix round 1 (task 6 review, I1/I3): whether the in-mission tracker is
   *  open, mirrored onto the strip control's own `aria-expanded` every
   *  rebuild. `data-open` on `this.strip` (below) is for CSS; this is for a
   *  screen reader, and `renderStrip` rebuilds the button from THIS field
   *  every 4 Hz, so the attribute cannot go stale the way a plain DOM write
   *  made once, on the button `main.ts` will replace on the next tick, would. */
  private objectivesOpen = false;

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

  /** Everything this HUD put directly on `host`, in append order, so
   *  `destroy()` has one list to walk rather than a hand-kept set of field
   *  names that goes stale the next time a pane is added. Filled at the single
   *  `host.append(...)` in the constructor. */
  private readonly roots: HTMLElement[] = [];

  /** Every `bindTip`/`bindDelegatedTip` disposer this HUD registered --
   *  released in `destroy()`. `Element.remove()` on `roots` (below) already
   *  drops every hover/focus listener these calls added, since they live on
   *  descendants of `this.strip`/`this.cluster`; what it cannot reach is the
   *  shared tooltip's app-wide Escape listener on `window`, which is why the
   *  disposers still run first. All ten of this HUD's tooltips share one
   *  `.rl-tip` element, hosted on `this.strip` rather than on `document.body`
   *  -- `document.body` is what `host` (this HUD's own mount point) actually
   *  is in the real app, and a tip element that lived there directly would be
   *  a body child that outlives every `destroy()`, which is exactly the kind
   *  of leftover node `pnpm ui:routes` exists to catch. */
  private readonly tipDisposers: Disposer[] = [];

  /**
   * The strip and chip delegated tips' own `refresh()` (`./tooltip`'s
   * `DelegatedTip`), called after every `renderStrip`/`renderChips` — both
   * rebuild their container's tipped descendants wholesale via `innerHTML`
   * and fire no event of their own, so a tip shown for the OLD node would
   * otherwise freeze on stale content (a `{rate}` that stopped ticking, a
   * chip's `×{count}` that stopped counting) until the pointer physically
   * left and re-entered. Assigned once in the constructor, where the two
   * `bindDelegatedTip` calls that produce them live.
   */
  private readonly refreshStripTip: () => void;
  private readonly refreshChipTip: () => void;

  /** The live title card (`titleCard` in `motion.ts`) and its own dismisser,
   *  held rather than discarded: the card registers two window listeners and a
   *  timer to take itself down, and holds for up to five seconds with
   *  `dispatch`. Leaving a mission inside that window has to cancel all three
   *  AND remove the element, because the dismisser only starts a 250 ms fade.
   *  The ELEMENT is held rather than found again by selector -- this HUD's host
   *  is `document.body` in the real app, and a `.rl-titlecard` sweep of the
   *  shared body could match a card this HUD did not create. Null whenever no
   *  card is up. */
  private title: { el: HTMLElement; dismiss: () => void } | null = null;

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
    mark.title = `Roaring Lions${deps.gameVersion ? ` v${deps.gameVersion}` : ''}`; /* i18n-ok: proper noun */

    const right = document.createElement('div');
    right.className = 'rl-strip__right rl-strip__gap';
    right.appendChild(this.stripInfo);
    this.strip.append(mark, this.stripBody, right);

    // Delegated, once, here -- exactly the lesson `stripBody`'s own three-run
    // comment above already records for the speed chips and the mute toggle,
    // and the same fix `this.cluster`'s click listener below applies for the
    // selection chips: `renderStrip` innerHTMLs `stripBody` at 4 Hz (task 6),
    // so a listener bound to the `.rl-strip__more` button ITSELF would be
    // dropped on the very next rebuild and the first click would land only if
    // it beat that rebuild. Bound on `this.strip`, which is never replaced,
    // the listener outlives every rebuild the button underneath it goes
    // through.
    this.strip.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement | null)?.closest('[data-open-objectives]');
      if (!btn) return;
      this.deps.openObjectives?.();
    });

    // Same delegation, same reason, for the strip's five field tooltips
    // (Conduct, Logistics, Intel, Pinned, Broken) -- `stripBody`/`stripInfo`
    // are innerHTML'd at 4 Hz, so a `bindTip` on one of their spans would be
    // dropped on the very next rebuild. `this.strip` also hosts the tip
    // element itself (`host` below): it is a node this HUD owns and removes
    // in `destroy()`, not `document.body`, which is what `host` (the
    // constructor parameter) actually is in the real app.
    const stripTip = bindDelegatedTip(this.strip, (target) => this.stripTipHtml(target.dataset.tip), {
      host: this.strip,
    });
    this.tipDisposers.push(stripTip.dispose);
    this.refreshStripTip = stripTip.refresh;

    // Speed. Rendered even where the frame loop has not wired it, because a
    // strip that grows a control the moment a dependency appears is a strip
    // whose layout nobody has actually looked at.
    const chips = document.createElement('div');
    chips.className = 'rl-strip__chips';
    this.speedCluster = chips;
    for (const spec of [
      { speed: 0, label: '▮▮', title: 'hud.speed.pause' },
      { speed: 1, label: '1×', title: 'hud.speed.normal' },
      { speed: 2, label: '2×', title: 'hud.speed.double' },
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rl-strip__chip';
      b.textContent = spec.label;
      b.title = t(spec.title);
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

    // The map page is always one click away, mid-mission included -- but
    // leaving a fight costs the attempt, so it is confirmed first rather than
    // a plain navigation (task 6: this used to be a bare `<a href="?campaign">`,
    // and there was no way to change your mind once the click landed). Moved
    // to the strip's far left, ahead of the mission's own fields, and out of
    // this right-hand instrument cluster -- it is not a speed or mute toggle,
    // it is the one control here that ends the attempt.
    const leaveBtn = document.createElement('button');
    leaveBtn.type = 'button';
    // `rl-strip__link` styles it; `rl-hud__leave` names it. The second class
    // carries no CSS at all and exists so an instrument can find the one
    // control that ends the attempt -- `tools/src/ui-review/routes-check.ts`
    // clicks it to walk a mission's exit. Styling it by the same hook the
    // walk selects on would make a restyle silently break the walk.
    leaveBtn.className = 'rl-strip__link rl-hud__leave';
    leaveBtn.textContent = t('hud.leave.link');
    leaveBtn.title = t('hud.leave.title');
    leaveBtn.addEventListener('click', () => {
      void confirmDialog(document.body, {
        title: t('hud.leave.confirm.title'),
        body: t('hud.leave.confirm.body'),
        confirm: t('hud.leave.confirm.action'),
        danger: true,
      }).answer.then((ok) => {
        if (ok) deps.leave?.();
      });
    });
    this.strip.prepend(leaveBtn);

    this.muteChip = document.createElement('button');
    this.muteChip.type = 'button';
    this.muteChip.className = 'rl-strip__chip';
    this.muteChip.addEventListener('click', () => {
      deps.toggleMute?.();
      this.paintMute();
      this.muteChip.blur();
    });

    right.append(chips, this.muteChip);
    this.paintSpeed();
    this.paintMute();

    // --- the selection cluster --------------------------------------------
    //
    // Bottom centre: one column (`.rl-sel`) holding, in order, the feed, the
    // order row, the card/chips, and the controls hint -- the bottom-centre
    // STACK, never hidden as a whole. `renderCard` shows or hides only the
    // order row and the card/chips body; `renderHint` (Task 9) no longer
    // hides the hint at all -- it is on screen with a selection exactly as
    // it is with none, and what it says is `hintFor`'s call
    // (`hint-model.ts`), not a visibility toggle. Splitting the stack this
    // way (fix round 1) is what keeps a live notice on screen with nothing
    // selected -- the default state, and true for most of a mission -- where
    // hiding the whole column used to take the feed down with it. Before
    // that it was three separate absolutely-positioned blocks at fixed
    // `bottom` offsets, which drew over each other the moment more than one
    // was on screen at once.
    //
    // The order buttons are built ONCE and only repainted, while the chips and
    // the card are innerHTML'd wholesale four times a second. That split is not
    // tidiness — it is the same lesson the top strip's three runs record. A
    // single innerHTML over both would drop every button's listener 4 Hz, and
    // the symptom is an order button that fires only if you click it fast
    // enough.
    // .rl-sel is never hidden as a whole -- it is the bottom-centre STACK
    // (feed, order row, card/chips, hint), and hiding the whole thing
    // whenever nothing was selected took the feed and the hint down with it
    // (task-5 review, fix round 1: the feed is invisible in the default
    // no-selection state, true for most of a mission). `renderCard` hides
    // only `orderBar` and `cluster`; `renderHint` hides only `hint`.
    this.sel = document.createElement('div');
    this.sel.className = 'rl-sel';

    this.orderBar = document.createElement('div');
    this.orderBar.className = 'rl-orders';
    // Nothing is selected at construction, same as the order row and card
    // used to start hidden via the parent's own display:none.
    this.orderBar.style.display = 'none';
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
      // Bound once, directly on the button -- unlike the chips and the strip
      // fields, the order row is built ONCE and only repainted (the comment
      // below explains why), so there is no rebuild to lose this listener to.
      this.tipDisposers.push(bindTip(b, () => this.orderTipHtml(spec), { host: this.strip }));
    }

    this.cluster = document.createElement('div');
    this.cluster.className = 'rl-cluster';
    this.cluster.style.display = 'none';
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
    // Same delegation, for the same reason, as the tooltip: a chip's own
    // `data-tip` names the type id, and `chipTipHtml` looks its name and
    // count up in `this.chipViews` from the last `renderChips` rather than
    // needing the html baked into markup that is rebuilt out from under it.
    const chipTip = bindDelegatedTip(this.cluster, (target) => this.chipTipHtml(target.dataset.tip), {
      host: this.strip,
    });
    this.tipDisposers.push(chipTip.dispose);
    this.refreshChipTip = chipTip.refresh;
    this.sel.append(this.orderBar, this.cluster);

    this.clock = document.createElement('div');
    // A number over the world too -- the plate through the same class rather
    // than a second copy of the background rule (task-4 brief resolution).
    this.clock.className = 'rl-clock rl-plate';
    this.clock.style.display = 'none';

    this.feed = document.createElement('div');
    this.feed.className = 'rl-feed';
    // First child of .rl-sel: with that container's `flex-direction: column`
    // the feed sits above the order row and the card, separated by the
    // column's own gap, rather than floating over either at a fixed offset.
    this.sel.prepend(this.feed);

    this.hint = document.createElement('div');
    // A plate, not the shadow halo -- .rl-onmap alone measured ~1.3:1 over
    // sand for this line. The halo stays available through .rl-onmap for
    // glyph-only marks; the hint no longer uses it.
    this.hint.className = 'rl-hint rl-plate';
    // Last child of .rl-sel, the same stack the feed is the first child of
    // (fix round 1): with nothing selected the column reads feed-over-hint;
    // with a selection it reads feed-over-orders-over-card-over-hint (Task 9:
    // `renderHint` no longer hides this element on a selection at all).
    this.sel.append(this.hint);

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
    this.cmdPrev.title = t('hud.commander.previous');
    this.cmdNext = document.createElement('button');
    this.cmdNext.type = 'button';
    this.cmdNext.textContent = '▸';
    this.cmdNext.title = t('hud.commander.next');
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

    // The six panes this HUD owns on the host. Recorded as they are appended
    // -- `destroy()` walks `roots`, so a seventh pane added here is torn down
    // by construction rather than by remembering to name it twice.
    this.roots.push(this.strip, this.cmd, this.clock, this.sel, this.fire, this.banner);
    host.append(...this.roots);
  }

  /**
   * Take the HUD off the host.
   *
   * The HUD mounts on `document.body` in `main.ts`, not on the stage the
   * router clears between screens, so leaving a mission softly strands all six
   * panes unless the battlefield's own disposer says otherwise -- which is
   * exactly what was measured before this: the strip and the minimap survived
   * a Back out of a battlefield and sat over the screen underneath.
   *
   * Idempotent. `Element.remove()` on an already-detached node is a no-op, and
   * a stale battlefield mount resolving onto an aborted route runs its
   * disposer after the teardown that aborted it.
   *
   * The button listeners go with their buttons -- `Element.remove()` on
   * `roots` takes every hover/focus/click listener a descendant carries with
   * it. Two things here are registered on `window` rather than on anything
   * `roots` reaches: `titleCard`'s own pair, dismissed explicitly below, and
   * the shared tooltip's single Escape listener (`tooltip.ts`), which is why
   * `tipDisposers` runs first rather than being left to the DOM removal that
   * follows it.
   */
  destroy(): void {
    // `dismiss()` releases the card's two window listeners and its timer, then
    // fades it over 250 ms before removing the node -- so the element is still
    // on the host when this returns. Teardown has to be synchronous (the
    // router mounts the next screen immediately), so THIS card is taken off by
    // the reference `announce` kept, not by a selector sweep of a body other
    // screens also mount on.
    this.title?.dismiss();
    this.title?.el.remove();
    this.title = null;
    for (const off of this.tipDisposers) off();
    for (const root of this.roots) root.remove();
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
    // Any previous card goes first, so its window listeners and timer are
    // released rather than left running against a node about to be covered.
    this.title?.dismiss();
    this.title = titleCard(this.host, name, subtitle, dispatch);
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
    // `renderStrip` innerHTML's `stripBody`/`stripInfo` wholesale; a strip
    // tip shown for the pre-rebuild node would otherwise freeze on stale
    // content (fix round 1, I1) with no event of its own to notice by.
    this.refreshStripTip();
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
    this.muteChip.title = muted ? t('hud.mute.muted') : t('hud.mute.unmuted');
    this.muteChip.dataset.on = muted ? '0' : '1';
  }

  /** Public since Task 6: `main.ts`'s `pause`/`resume` call this directly so
   *  the strip repaints the moment either one runs, rather than waiting for a
   *  tick that a pause guarantees never comes. */
  paintSpeed(): void {
    const now = this.deps.getSpeed?.() ?? 1;
    for (const { el, speed } of this.speedChips) el.dataset.on = speed === now ? '1' : '0';
    this.speedCluster.dataset.paused = this.deps.isPaused?.() ? '1' : '0';
  }

  /** Task 6: paints the strip's own knowledge of the in-mission tracker's
   *  open/closed state via `data-open` on `this.strip` -- `main.ts` calls this
   *  from `openObjectives`'s own toggle, since the control's element is
   *  rebuilt at 4 Hz (`renderStrip`) and cannot hold that state itself the
   *  way a persistent button's own `dataset` would. CSS reads it to mark the
   *  control while the panel is up, the same pattern `paintSpeed` already
   *  uses for the speed chips. Fix round 1: also stores the flag for
   *  `renderStrip` to read back onto the button's own `aria-expanded` on the
   *  very next rebuild, so a screen-reader user is told the tracker's state
   *  without depending on `data-open` alone. */
  setObjectivesOpen(open: boolean): void {
    this.objectivesOpen = open;
    this.strip.dataset.open = open ? '1' : '0';
  }

  /** Mission-level narration — objectives, triggers, waves, refusals.
   *
   *  `html` is set as `innerHTML`, and it is HTML on purpose: callers pass a
   *  `t()` result whose catalogue markup (`<b>…</b>`) is meant to render. So
   *  every value a caller interpolates that the catalogue did not write -- an
   *  objective's `text`, a trigger's `label`, a unit's or a mission's `name`
   *  -- goes through `escapeHtml` (`escape-html.ts`) before it reaches `t()`,
   *  never after: `describeMissionEvent` in `main.ts`, `alertNotice`
   *  (`mission-notice.ts`) and the dock's notes (`production.ts`) all do.
   *  Schema-constrained ids (`^[a-z0-9_]+$`) cannot carry markup and are
   *  interpolated as they are. */
  note(html: string, tone: Tone = 'live'): void {
    const el = document.createElement('div');
    // textToneClass, not `rl-${tone}` by hand: a 'bad'-tone notice sits on
    // this same rl-plate, and `rl-bad`'s fill red reads 4.01:1 there.
    el.className = `rl-notice rl-enter rl-plate ${textToneClass(tone)}`;
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
      m.result === 'victory' ? t('hud.banner.victory') : t('hud.banner.defeat');
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
        `<span class="rl-strip__name"${m.campaign ? ` title="${escapeHtml(m.campaign)}"` : ''}>${escapeHtml(m.name)}</span>`
      );
      if (m.roe !== undefined) {
        rows.push(
          `<span data-tip="conduct" tabindex="0"><b class="rl-${roeTone(m.roe)}" data-roe>${m.roe}</b> <span class="rl-dim">${t('hud.strip.conduct')}</span></span>`
        );
      }
      const { primary, deadline, primaryOpen, secondaryOpen } = stripObjectives(m);
      const hold = holdClock(m);
      if (primary) {
        // The clock is stamped inline ONLY when it belongs to this objective.
        // A hold running on a secondary while the strip shows a primary would
        // otherwise read as the primary's own timer.
        const inline =
          hold && hold.id === primary.id
            ? ` <b class="${textToneClass(hold.tone)}">${hold.text}</b>`
            : '';
        const tone =
          primary.status === 'complete' ? 'rl-good' : primary.status === 'failed' ? 'rl-bad-text' : '';
        rows.push(
          `<span class="rl-strip__obj ${tone}" data-obj="${escapeHtml(primary.id)}">` +
            `${objectiveGlyph(primary.status)} ${escapeHtml(primary.text)}${inline}</span>`
        );
      }
      if (deadline) {
        // A failable primary's clock, running out while the strip shows a
        // different primary. Tel Marum II was lost on exactly this clock with
        // the hold ticked complete beside it (2026-09-06).
        rows.push(
          // Clock FIRST: this span shrinks with an ellipsis at the end, and
          // the clock is the part that must survive the cut -- at 1440 px with
          // two long objectives it was the clock that vanished.
          `<span class="rl-strip__obj rl-strip__deadline" data-obj="${escapeHtml(deadline.objective.id)}">` +
            `${objectiveGlyph(deadline.objective.status)} ` +
            `<b class="${textToneClass(deadline.tone)}">${deadline.text}</b> ` +
            `${escapeHtml(deadline.objective.text)}</span>`
        );
      }
      // Task 6: the two `+N` counts above (primaries/secondaries the inline
      // fields do not already name) collapse into ONE control -- two buttons
      // that open the same tracker would be two answers to one question. It
      // is a control to open the FULL list, not merely a display of the extra
      // counts, so it shows whenever the mission has anything open at all
      // (including the one primary already stamped inline above): "nothing
      // left open" -- every objective complete or failed -- is the one case
      // with no control at all, never a disabled one.
      if (m.objectives.some((o) => o.status === 'active')) {
        // Fix round 1 (I3): `aria-expanded` mirrors `this.objectivesOpen`,
        // which `setObjectivesOpen` writes -- read back here on every 4 Hz
        // rebuild so the attribute tracks the tracker even though the button
        // element itself is torn down and recreated each time.
        rows.push(
          `<button type="button" class="rl-strip__more" data-open-objectives ` +
            `aria-expanded="${this.objectivesOpen ? 'true' : 'false'}">` +
            `${t('hud.strip.open', { primary: primaryOpen, secondary: secondaryOpen })}</button>`
        );
      }
    } else {
      /* i18n-ok: proper noun */
      rows.push('<span class="rl-strip__name">Roaring Lions</span>');
    }

    const info: string[] = [];
    if (m?.logistics !== undefined) {
      const rate =
        m.logisticsRate !== undefined && m.logisticsRate > 0
          ? ` <span class="rl-dim">${t('hud.strip.rate', { n: m.logisticsRate })}</span>`
          : '';
      info.push(`<span class="rl-info" data-tip="logistics" tabindex="0">▣ <b>${m.logistics}</b>${rate}</span>`);
    }
    if (m?.intel !== undefined) {
      info.push(`<span class="rl-info" data-tip="intel" tabindex="0">◎ <b>${m.intel}</b></span>`);
    }
    // Suppression: shown only when there is some. A permanent "0 pinned" is
    // the kind of field a player learns to stop reading.
    const { pinned, broken } = countSuppressed(this.deps.sim.state, this.deps.sim.entityCount);
    if (pinned > 0)
      info.push(
        `<span class="rl-hot" data-tip="pinned" tabindex="0"><b>${t('hud.strip.pinned', { n: pinned })}</b></span>`
      );
    if (broken > 0)
      info.push(
        `<span class="rl-bad-text" data-tip="broken" tabindex="0"><b>${t('hud.strip.broken', { n: broken })}</b></span>`
      );

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

  /**
   * The strip's five field tooltips, keyed by the `data-tip` the hovered
   * span carries -- Conduct first, the one §6 names, since the ROE numeral
   * is the least self-explanatory thing on screen. `null` for anything else
   * `bindDelegatedTip`'s `[data-tip]` selector could in principle match,
   * which there is currently nothing of, but a resolver that cannot say "no
   * tip here" is a resolver that will show stale content the day something
   * else in the strip picks up the same attribute by accident.
   */
  private stripTipHtml(key: string | undefined): string | null {
    switch (key) {
      case 'conduct':
        return conductDefinition();
      case 'logistics':
        return t('hud.strip.logistics.tip', { rate: this.deps.getMission()?.logisticsRate ?? 0 });
      case 'intel':
        return t('hud.strip.intel.tip');
      case 'pinned':
        return t('hud.strip.pinned.tip');
      case 'broken':
        return t('hud.strip.broken.tip');
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------
  // Bottom centre: the hint line -- always on, one line, never hidden.
  // ------------------------------------------------------------------

  /**
   * Task 9: the line used to hide the moment anything was selected, which is
   * exactly when a new player most needs it -- so it no longer hides for
   * that reason at all. What it SAYS is `this.deps.hint`'s call: a thunk
   * `main.ts` builds from `hint-model.ts`'s `hintFor` and the facts only the
   * shell has (the selection, the hover, the two `lions.seen` first-use
   * flags, and whether this mission fields a dock). Absent in tests that do
   * not exercise it -- the same as every other optional dep here -- which
   * falls back to today's plain controls line, so a HUD built without the
   * dep behaves exactly as it did before this task.
   *
   * One line, not the three-line block this replaces. That block was a panel
   * section with room to spare; on bare map it is a wall, and measured at
   * 1440 the full key list wrapped to two lines and read as a paragraph
   * sitting on the battlefield. The verb keys (h/f/g/u) are deliberately not
   * here: the order row a later slice puts in this same place names them as
   * buttons, and the unit card's Capabilities section already does.
   */
  private renderHint(): void {
    this.hint.style.display = '';
    const hint = this.deps.hint?.();
    if (!hint) {
      this.hint.textContent = t('hud.controlHint');
      return;
    }
    // `hintFor` answers from facts alone and never sees a binding -- the key
    // name inside the dock hint's copy comes from HERE, the same way the
    // order row's own key caps do (`this.deps.keyFor`, above), so a rebind
    // keeps the hint true instead of quietly starting to lie.
    const params: Readonly<Record<string, string | number>> | undefined =
      hint.key === 'hud.hint.dock'
        ? { ...hint.params, key: this.deps.keyFor?.('production') ?? 'production' }
        : hint.params;
    this.hint.textContent = t(hint.key, params);
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
   *
   * Task 9: also the panel's own first-use instrument. Counted HERE, where
   * visibility is actually decided, rather than in `main.ts` re-deriving the
   * same condition a second time -- `fireVisibleStreak` resets to 0 the
   * instant the panel hides, so a player who sweeps past a hostile without
   * pausing never trips `onProjectedFireShown`, and `=== FIRE_TAUGHT_STREAK`
   * (not `>=`) is what makes the call fire exactly once per streak rather
   * than once more on every tick the panel stays up after that.
   */
  private renderFire(): void {
    const html = this.projectedFireHtml();
    const visible = html !== '';
    this.fire.style.display = visible ? '' : 'none';
    if (visible) this.fire.innerHTML = html;
    if (!visible) {
      this.fireVisibleStreak = 0;
      return;
    }
    this.fireVisibleStreak++;
    if (this.fireVisibleStreak === FIRE_TAUGHT_STREAK) this.deps.onProjectedFireShown?.();
  }

  private projectedFireHtml(): string {
    const sim = this.deps.sim;
    // Not named `t`: this class is the one place in the file that would
    // shadow the catalogue's own `t()` import with a local of the same name.
    const hoverId = this.deps.hoverEntity();
    if (hoverId < 0 || sim.state.alive[hoverId] === 0) return '';
    const sel = this.deps.getSelection().filter((i) => sim.state.alive[i] === 1);
    if (sel.length === 0) return '';

    const MAX_ROWS = 6;
    const rows: string[] = [];
    let cannot = 0;
    let unidentified = 0;
    let holdingFire = 0;
    for (const s of sel) {
      const p = sim.projectHit(s, hoverId);
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
        [t('hud.fire.factor.range'), fx.toNumber(p.factors.rangeFalloff)],
        [t('hud.fire.factor.cover'), fx.toNumber(p.factors.coverMod)],
        [t('hud.fire.factor.targetMoving'), fx.toNumber(p.factors.motionMod)],
        [t('hud.fire.factor.firingOnTheMove'), fx.toNumber(p.factors.stanceMod)],
        [t('hud.fire.factor.suppressed'), fx.toNumber(p.factors.suppressionMod)],
      ]);
      const why = worst.length > 0 ? ` · ${worst.join(' · ')}` : '';
      const bounce = p.hurts ? '' : ` · <span class="rl-bad-text">${t('hud.fire.cannotPenetrate')}</span>`;
      rows.push(
        `<div>${name} <b>${chance}%</b> <span class="rl-dim">${p.weaponId}${why}</span>${bounce}</div>`
      );
    }

    const target = sim.unitTypes[sim.state.typeIdx[hoverId]].name;
    const head = `<div class="rl-label">${t('hud.fire.heading', { target })}</div>`;
    if (rows.length === 0 && unidentified > 0 && cannot === 0 && holdingFire === 0) {
      return head + `<div class="rl-dim">${t('hud.fire.unidentifiedOnly')}</div>`;
    }
    // Pinned or lying in ambush is a different fact from "cannot reach" —
    // the shot exists, the unit is choosing (or forced) not to take it.
    if (rows.length === 0 && holdingFire > 0 && cannot === 0 && unidentified === 0) {
      return head + `<div class="rl-dim">${t('hud.fire.holdingFireOnly')}</div>`;
    }
    if (rows.length === 0) return head + `<div class="rl-dim">${t('hud.fire.noneCanEngage')}</div>`;

    const extra = sel.length - rows.length - cannot - unidentified - holdingFire;
    const tail: string[] = [];
    if (extra > 0) tail.push(t('hud.fire.andMore', { n: extra }));
    if (cannot > 0) tail.push(t('hud.fire.cannotReach', { n: cannot }));
    if (holdingFire > 0) tail.push(t('hud.fire.holdingFire', { n: holdingFire }));
    if (unidentified > 0) tail.push(t('hud.fire.unidentified', { n: unidentified }));
    const foot = tail.length > 0 ? `<div class="rl-dim">${tail.join(' · ')}</div>` : '';
    return head + rows.join('') + foot;
  }

  // ------------------------------------------------------------------
  // The selection cluster: the order row, and either a chip per unit type or
  // one wide card.
  //
  // One entry point rather than two, because the two states share the order
  // row above them and share the decision of whether the order row and the
  // card/chips body are on screen at all. `sel.length` picks the body: one
  // unit gets the 460px card with its armament and capabilities, more than
  // one gets 150px chips grouped by type. A player is asking a different
  // question in each case — "what is this thing" versus "what have I got" —
  // and answering both with the same widget is what the old bottom-right
  // panel did.
  //
  // `.rl-sel` itself is NEVER hidden here (fix round 1) — only `orderBar` and
  // `cluster` are, the two elements this method owns. Hiding the shared
  // column used to take the feed and the hint down with the order row and
  // the card, which is the wrong scope: a live notice or the controls hint
  // must survive an empty selection exactly as well as a full one.
  // ------------------------------------------------------------------

  private renderCard(): void {
    const sim = this.deps.sim;
    // Alive only. A selection outlives its units by up to a tick, and a chip
    // reporting a corpse's health reads as a bug in the health bar.
    const sel = this.deps.getSelection().filter((i) => sim.state.alive[i] === 1);
    if (sel.length === 0) {
      this.orderBar.style.display = 'none';
      this.cluster.style.display = 'none';
      this.chipTypes = [];
      return;
    }
    const wasHidden = this.cluster.style.display === 'none';
    this.orderBar.style.display = '';
    this.cluster.style.display = '';

    this.renderOrders(sel);
    if (sel.length === 1) {
      this.chipTypes = [];
      this.cluster.innerHTML = this.cardHtml(sel[0]);
    } else {
      this.renderChips(sel);
    }
    // `this.cluster.innerHTML` was just replaced wholesale either way -- by
    // the chips or by the single-unit card -- so a chip tip shown for the
    // pre-rebuild node needs the same rescue `renderStrip` needs above (fix
    // round 1, I1). Dropping to one unit removes every `[data-tip]` from the
    // cluster entirely, which `refresh` reads as "no replacement" and hides.
    this.refreshChipTip();
    // The order row and the card/chips body arrive from below the frame edge
    // the first time they are needed, and then hold still: re-running the
    // entrance on every rebuild would make them twitch four times a second.
    // Restarted on both elements individually now, since `.rl-sel` itself no
    // longer transitions between hidden and shown.
    if (wasHidden) {
      this.orderBar.classList.remove('rl-enter');
      this.cluster.classList.remove('rl-enter');
      void this.orderBar.offsetWidth; // restart the animation rather than resume it
      void this.cluster.offsetWidth;
      this.orderBar.classList.add('rl-enter');
      this.cluster.classList.add('rl-enter');
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
      // `row.label` is a catalogue key (`selection-model.ts`'s `ORDERS[].label`
      // own doc comment), not text -- resolved here, at render time.
      const label = t(row.label);
      btn.innerHTML =
        `<span class="rl-order__glyph">${row.glyph}</span>${label}` +
        `${cap} <b class="rl-dim">${this.deps.keyFor?.(row.key) ?? row.key}</b>`;
      // `btn.title` used to carry this; `orderTipHtml` (bound once, in the
      // constructor) reads `dataset.inert` back off the button at SHOW time
      // instead, so the tooltip's "why inert" clause is never one tick stale
      // behind this repaint.
    }
  }

  /**
   * What a verb DOES -- its key is already on the button's own face, so the
   * tooltip does not repeat it -- and, only while `row.inert` is true, why
   * giving it right now would do nothing. Read fresh from the button's own
   * `dataset.inert` on every show (`bindTip`'s thunk contract), rather than
   * captured at bind time, since `renderOrders` repaints that dataset
   * without rebuilding the button itself.
   */
  private orderTipHtml(spec: OrderSpec): string {
    const label = t(spec.label);
    const inert = this.orderBtns.get(spec.id)?.dataset.inert === '1';
    const does = `<div class="rl-tip__blurb">${t(`hud.order.tip.${spec.id}`)}</div>`;
    const why = inert
      ? `<div class="rl-tip__blurb rl-dim">${t('hud.order.inertTitle', { label })}</div>`
      : '';
    return `<div class="rl-tip__head"><span class="rl-tip__name">${label}</span></div>${does}${why}`;
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
    // The chip tooltip's own lookup table -- see `chipTipHtml` -- kept
    // alongside `chipTypes` rather than derived from it, since the tooltip
    // needs the name and count too, not only the id.
    this.chipViews = chips;
    // Clamp rather than reset: losing the last sub-group should walk the frame
    // back one, not throw it to the front of the row.
    if (this.chipFocus >= chips.length) this.chipFocus = Math.max(0, chips.length - 1);

    this.cluster.innerHTML = chips
      .map((c, i) => {
        const tone = c.statusTone === null ? 'rl-dim' : textToneClass(c.statusTone);
        return (
          `<div class="rl-chip" data-type="${escapeHtml(c.typeId)}" ` +
          `data-tip="${escapeHtml(c.typeId)}" ` +
          `data-focus="${i === this.chipFocus ? '1' : '0'}">` +
          this.artHtml(c.typeId, c.bucket, 'rl-chip__art', CHIP_MARK) +
          `<div class="rl-chip__body">` +
          `<div class="rl-chip__top">` +
          // The name in its own span: `text-overflow`/wrapping does nothing
          // to a flex CONTAINER's own text (`theme.css`'s
          // `.rl-chip__name > span`), so "AH-64 Peten" was being cut to
          // "AH-64 Pete" with no ellipsis glyph at all before it had one.
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

  /** The chip's own name and count -- what `title` used to carry, before a
   *  chip that is rebuilt at 4 Hz could keep a `bindTip` of its own. `null`
   *  for a stale `data-tip` whose sub-group vanished (a casualty, a rebuild
   *  mid-hover) between the mouse landing on it and this lookup running,
   *  which `bindDelegatedTip` treats as "no tip here" rather than showing
   *  whatever the last render happened to leave behind. */
  private chipTipHtml(typeId: string | undefined): string | null {
    const chip = this.chipViews.find((c) => c.typeId === typeId);
    return chip ? t('hud.chip.selectOnly', { name: chip.name, count: chip.count }) : null;
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
      // Same wording as the brigade screen's own art gap (`brigade.art.noSprite`
      // -- `{id} — no sprite sheet`, `en.json`): one sentence for "this type
      // has no picture", wherever it is drawn.
      return (
        `<div class="${cls}" data-nosprite="1" title="${escapeHtml(t('brigade.art.noSprite', { id: typeId }))}">` +
        `${roleBadgeSvg(bucket, markSize)}</div>`
      );
    }
    const icon = this.deps.portraitIsIcon?.(typeId) === true;
    return (
      `<img class="${cls}"${icon ? ` data-icon="1"` : ''} src="${escapeHtml(src)}" alt="" draggable="false">`
    );
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

    // Callsign and service record, from the campaign roster this unit was
    // drawn from -- both absent for a fresh spawn with no history.
    const entry = this.deps.rosterEntryOf?.(id);
    const callsign = entry?.name ? `<span class="rl-card__callsign">${escapeHtml(entry.name)}</span> ` : '';
    const record =
      entry && (entry.missions !== undefined || entry.kills !== undefined)
        ? `<div class="rl-card__record rl-dim">${t('hud.card.record', { missions: entry.missions ?? 0, kills: entry.kills ?? 0 })}</div>`
        : '';

    // Whose place this is (WP-G-E4, R-6): only looked up when the entry
    // actually carries a slot -- a fresh spawn's `entry?.slot` is `undefined`
    // and must never reach `predecessorOf` at all, since a save with no
    // ledger behind it has no `roster.lost` to search. `predecessor.name`
    // already carries a resolved display name when absent, so this never
    // shows a raw sim id, and `escapeHtml` is not optional: a callsign is
    // player-visible data that arrives from a save file.
    const predecessor = entry?.slot !== undefined ? this.deps.predecessorOf?.(entry.slot) : undefined;
    const replaces =
      predecessor !== undefined
        ? `<div class="rl-card__replaces rl-dim">${t('hud.card.replaces', { predecessor: escapeHtml(predecessor.name ?? predecessor.type) })}</div>`
        : '';

    // Condition: only what is actually true right now. Unchanged from the panel
    // this replaces — the list is the product of a dozen play sessions and the
    // layout around it is what GH-153 is changing, not the facts in it.
    const flags: string[] = [];
    if (st.routed[id] === 1) flags.push(`<span class="rl-bad-text">${t('hud.card.broken')}</span>`);
    else if (st.pinned[id] === 1) flags.push(`<span class="rl-hot">${t('hud.card.pinned')}</span>`);
    if (st.garrisonedIn[id] >= 0) flags.push(`<span class="rl-live">${t('hud.card.inBuilding')}</span>`);
    if (st.mobilityKilled[id] === 1) flags.push(`<span class="rl-dim">${t('hud.card.immobilised')}</span>`);
    if (st.firepowerKilled[id] === 1) flags.push(`<span class="rl-bad-text">${t('hud.card.gunsOut')}</span>`);
    if (st.moving[id] === 1) flags.push(t('hud.card.moving'));
    const supp = fx.toNumber(st.suppression[id]);
    if (supp > 0.05) flags.push(t('hud.card.suppression', { pct: (supp * 100).toFixed(0) }));
    if (type.hasAps) flags.push(`<span class="rl-info">${t('selection.chip.aps', { ammo: st.apsAmmo[id], magazine: type.apsMagazine })}</span>`);
    const wp = sim.waypointCount(id);
    if (wp > 0) flags.push(t('hud.card.waypoints', { n: wp }));

    // Armament, so the player can tell what this unit is for.
    const arms: string[] = [];
    if (type.weapons.length > 0) {
      for (const w of type.weapons) {
        const pen = fx.toNumber(w.penetration);
        arms.push(
          `<div>${t('hud.card.weapon', { id: w.id, effective: fx.toNumber(w.effectiveRange).toFixed(1), range: fx.toNumber(w.range).toFixed(0) })}` +
            (pen > 0 ? ` · ${t('hud.card.weaponPen', { n: pen.toFixed(0) })}` : '') +
            (fx.toNumber(w.collateralRisk) >= 0.5 ? ` <span class="rl-warn">${t('hud.card.weaponHeavy')}</span>` : '') +
            `</div>`
        );
      }
    } else {
      arms.push(`<div class="rl-dim">${t('hud.card.unarmed')}</div>`);
    }

    // Special controls: what this unit can do beyond move and shoot.
    const caps: string[] = [];
    if (type.canSmoke) caps.push(t('hud.card.cap.smoke'));
    if (st.carriedBy[id] >= 0) caps.push(t('hud.card.cap.aboard'));
    if (type.canGarrison) caps.push(t('hud.card.cap.garrison'));
    // Two sentences because there are now two rules: charges go in wherever the
    // unit halts, except at a protected site, which takes an order by name.
    // Saying only the first left the player with a dozer that silently refused
    // to touch a mosque and no hint that right-clicking it would work.
    if (type.canDemolish) caps.push(t('hud.card.cap.demolish'));
    if (type.isKamikaze) caps.push(t('hud.card.cap.kamikaze'));
    if (type.transportSlots > 0) caps.push(t('hud.card.cap.transport', { n: type.transportSlots }));
    if (type.canMarkTarget) caps.push(t('hud.card.cap.markTarget'));
    if (caps.length === 0) caps.push(t('hud.card.cap.none'));

    return (
      `<div class="rl-card" data-type="${escapeHtml(type.id)}">` +
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
      callsign +
      `<span class="rl-card__name">${type.name}</span>` +
      (vet > 0 ? `<span class="rl-commend">${'★'.repeat(vet)}</span>` : '') +
      `<span class="rl-card__hp rl-dim">${t('hud.card.hp', { now: hpNow.toFixed(0), max: hpMax.toFixed(0) })}</span>` +
      `</div>` +
      record +
      replaces +
      `<div class="rl-track"><i class="rl-fill-${hpTone(hpPct)}" ` +
      `style="width:${(hpPct * 100).toFixed(0)}%"></i></div>` +
      `<div class="rl-card__cond">${flags.length > 0 ? flags.join(' · ') : t('hud.card.holdingPosition')}</div>` +
      `<div class="rl-card__cols">` +
      `<div><div class="rl-label">${t('hud.card.armamentLabel')}</div>${arms.join('')}</div>` +
      `<div><div class="rl-label">${t('hud.card.capabilitiesLabel')}</div>${caps.map((c) => `<div>${c}</div>`).join('')}</div>` +
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
