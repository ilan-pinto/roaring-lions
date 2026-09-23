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

import type { LedgerData } from '@lions/sim';
import { campaignRoe } from '../campaign';
import { t } from '../i18n/t';
import { drawFromPool, type DeployEntry, type DeployRosterView } from './deploy-roster';
import { defaultSelection, isComplete, slotsLeft, toggleEntry, type DeploySelection } from './deploy-select';
import { paintMapTerrain, type PreviewMap, type PreviewTones } from './map-preview';
import { objectivesPanel, type ObjectiveRow } from './objectives';

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

export interface BroughtPanel {
  /** Only what this mission's own `from_ledger` placements draw -- not the whole
   *  pool. The roster is cumulative (spec §4.7), so by mid-campaign the two are
   *  very different numbers and naming the pool overstates the force. A count,
   *  computed from `deploy-roster.ts`'s `drawFromPool` result -- this panel
   *  has no opinion about which named entries a player could choose instead. */
  roster: { type: string; count: number; stripes: number; names: string[] }[];
  /** Everything the pool still holds once those draws are taken: survivors this
   *  mission does not field. Rendered as one line, never named -- a reserve is a
   *  count, and the names belong to the people on the map. `pool.length` minus
   *  what `drawFromPool` drew, never `roster.reserve` (WP-G-E2's cap overflow,
   *  which this panel never names -- pre-flight E2/E10). */
  reserve: number;
  marked: number;
  conduct: number | null;
  sentences: string[];
}

/** What the ledger hands this mission, in the player's terms (spec §5). Null when the
 *  mission's contract reads nothing, so a sandbox and First Light show no panel.
 *
 *  Scoped to what this mission actually FIELDS, which is not the same as what the
 *  pool holds: `roster.surviving_units` is cumulative since the step-2 branch --
 *  survivors plus every entry an earlier mission never fielded -- while a mission
 *  only ever puts on the map what its own `from_ledger` placements draw. Naming
 *  the whole pool told the player they had brought a force they had not.
 *
 *  The draw is `MissionRuntime.spawnPlacement`'s own, replayed by
 *  `deploy-roster.ts`'s `drawFromPool` rather than hand-copied here a second
 *  time (pre-flight R-4: two hand-written copies of a sim rule is how they
 *  drift apart) -- deliberately step for step: each `from_ledger` placement
 *  takes up to `count` entries of its type in pool order, each entry removed
 *  as it is taken, so a second placement for the same type continues where
 *  the first stopped. `starting_force` cannot carry passengers or markers
 *  (`mission.schema.json` pins its keys), so array order here is the spawn
 *  order there and nothing else can draw. What the sim does that this
 *  deliberately does not is substitute a single fresh remnant for an empty
 *  draw: a fresh unit has no name, no stripes and no record, so it is not
 *  something the player "brought". */
export function broughtFor(
  mission: {
    ledger: { requires: readonly string[] };
    starting_force?: readonly { unit: string; count: number; from_ledger?: boolean }[];
  },
  ledger: LedgerData,
  unitName: (id: string) => string
): BroughtPanel | null {
  const req = mission.ledger.requires;
  if (req.length === 0) return null;
  const roster: BroughtPanel['roster'] = [];
  let reserve = 0;
  let draws = false;
  if (req.includes('roster.surviving_units')) {
    const pool = ledger['roster.surviving_units'] ?? [];
    const force = mission.starting_force ?? [];
    draws = force.some((p) => p.from_ledger === true);
    const fielded = drawFromPool(pool, force).map((i) => pool[i]);
    reserve = pool.length - fielded.length;
    const byType = new Map<string, { count: number; stripes: number; names: string[] }>();
    for (const e of fielded) {
      const cur = byType.get(e.type) ?? { count: 0, stripes: 0, names: [] };
      cur.count++;
      if (e.veterancy > cur.stripes) cur.stripes = e.veterancy;
      if (e.name) cur.names.push(e.name);
      byType.set(e.type, cur);
    }
    for (const [type, v] of byType) roster.push({ type: unitName(type), ...v });
  }
  const marked = req.includes('intel.marked_positions') ? (ledger['intel.marked_positions'] ?? []).length : 0;
  const conduct = campaignRoe(ledger)?.mean ?? null;
  const sentences: string[] = [];
  if (req.includes('intel.marked_positions')) {
    sentences.push(marked > 0 ? t('loading.marked', { n: marked }) : t('loading.marked.none'));
  }
  // Gated on `draws`, not on `roster.length` alone: a mission that reads the
  // roster key but fields nobody from it (no `from_ledger` placement at all) has
  // an empty roster here by design, and saying "no survivors carried forward"
  // over a pool of twenty would be a lie. The sentence is for the case it was
  // written for -- this mission wanted survivors and the pool had none of that
  // type, so the brigade hands over fresh remnants instead.
  if (draws && roster.length === 0) {
    sentences.push(t('loading.brought.none'));
  }
  return { roster, reserve, marked, conduct, sentences };
}

/**
 * A veterancy stripe as the HUD card draws it: one `--commend` star per
 * stripe, in an element of its own so it can wear that colour.
 *
 * The ONE `★` site in this file. The brought panel's rows and the deploy
 * spread's rows both call it, so the symbol family's dingbat list (shell
 * Phase 3, gated Task 11) names `loading.ts` once, as the plan's own
 * `★` exception ("a repeated countable mark, not an icon" -- Open questions
 * for G1), however many rows a campaign roster grows to. Built, never
 * assigned as markup.
 */
function commendation(stripes: number): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'rl-commend';
  s.textContent = '★'.repeat(stripes);
  return s;
}

/** What the deploy spread hands back to its caller: the pick, whenever the
 *  player changes it. The screen reads and renders a `DeployRosterView`
 *  (Task 1) through Task 2's selection API and decides nothing itself. */
export interface DeployChoice {
  view: DeployRosterView;
  /** Called on every ACCEPTED change -- never at mount, and never for a
   *  click `toggleEntry` refused. An untouched screen therefore means
   *  `defaultSelection(view)`, which `permutePool` maps back onto the pool
   *  unchanged (Task 2's identity property): a caller that starts from the
   *  default and applies each change it is handed is always in step. */
  onChange(sel: DeploySelection): void;
}

/** The ground the orders are about (`map-preview.ts`). The same `map` and
 *  resolved tones `main.ts` already hands the minimap. */
export interface GroundPreview {
  map: PreviewMap;
  tones: PreviewTones;
}

/**
 * How many more bodies the player could still field: per demanded type, the
 * open slots (`slotsLeft`) capped by the unchosen bodies there are to put in
 * them. Zero exactly when `isComplete` is true -- a slot the pool cannot
 * fill is the spawner's to substitute (`mission.ts:1264`), not the player's
 * to fill -- so the line under the roster and the Deploy button can never
 * disagree about whether anything is left to do.
 */
function openSlots(view: DeployRosterView, sel: DeploySelection): number {
  let open = 0;
  for (const type of view.demand.keys()) {
    let unchosen = 0;
    for (const e of view.eligible) if (e.type === type && !sel.chosen.has(e.poolIndex)) unchosen++;
    open += Math.max(0, Math.min(slotsLeft(view, sel, type), unchosen));
  }
  return open;
}

/**
 * The force, chosen (spec Decision 4): one toggle row per body a placement
 * could draw, the slot line, and the reserve line.
 *
 * Every rule here is Task 2's: `defaultSelection` for the opening state,
 * `toggleEntry` for a click (it refuses a body whose type is full, and
 * answers a refusal with the SAME selection, which is how this tells "no
 * change" from a change), `isComplete` for whether Deploy may go. The rows
 * are `<button>`s so the keyboard reaches them with no code of its own, and
 * the whole spread is one `<fieldset>`, so its legend names every row for a
 * screen reader.
 *
 * The reserve line is the brought panel's, moved (pre-flight P2/E2): the same
 * `loading.brought.reserve` key and the same meaning -- pool entries this
 * mission does not draw -- so the screen carries one reserve count, never
 * two. `view.cap` is deliberately not read: how many places the BRIGADE
 * holds is the garage's line (`garage.brigade`), and this screen is about
 * one mission's draw.
 */
function deploySpread(choice: DeployChoice, deployButton: HTMLButtonElement): HTMLFieldSetElement {
  const { view } = choice;
  let sel = defaultSelection(view);

  const set = document.createElement('fieldset');
  set.className = 'rl-deploy';
  const legend = document.createElement('legend');
  legend.className = 'rl-deploy__title';
  legend.textContent = t('deploy.title');

  const list = document.createElement('ul');
  list.className = 'rl-deploy__rows';
  const rows: { entry: DeployEntry; button: HTMLButtonElement }[] = [];

  const slots = document.createElement('div');
  slots.className = 'rl-deploy__slots';
  const reserve = document.createElement('div');
  reserve.className = 'rl-deploy__reserve';

  const paint = (): void => {
    for (const { entry, button } of rows) {
      const chosen = sel.chosen.has(entry.poolIndex);
      button.dataset.chosen = chosen ? '1' : '0';
      button.setAttribute('aria-pressed', String(chosen));
      // Not `disabled`: a disabled button leaves the tab order, and a row
      // that cannot be fielded NOW becomes fieldable the moment another of
      // its type is benched. `aria-disabled` says "not at the moment".
      if (!chosen && slotsLeft(view, sel, entry.type) <= 0) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }
    const open = openSlots(view, sel);
    slots.textContent = open > 0 ? t('deploy.slots', { n: open }) : t('deploy.slots.full');
    const notDrawn = view.eligible.length + view.undrawable.length - sel.chosen.size;
    reserve.textContent = t('loading.brought.reserve', { n: notDrawn });
    reserve.hidden = notDrawn <= 0;
    deployButton.disabled = !isComplete(view, sel);
  };

  for (const entry of view.eligible) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rl-deploy__row';
    button.dataset.poolIndex = String(entry.poolIndex);

    // Who, then what: a named body leads with its name and carries its type
    // beside it; a nameless one is its type and nothing more.
    const who = document.createElement('span');
    who.className = 'rl-deploy__name';
    who.textContent = entry.name ?? entry.typeName;
    button.append(who);
    if (entry.name !== undefined) {
      const type = document.createElement('span');
      type.className = 'rl-deploy__type';
      type.textContent = entry.typeName;
      button.append(type);
    }
    if (entry.veterancy > 0) button.append(commendation(entry.veterancy));
    // The service record in the unit card's own words (`hud.card.record`):
    // one record, one wording, wherever the same body is shown. Absent for a
    // body with nothing on it yet -- "0 missions · 0 kills" is noise.
    if (entry.missions > 0 || entry.kills > 0) {
      const record = document.createElement('span');
      record.className = 'rl-deploy__record';
      record.textContent = t('hud.card.record', { missions: entry.missions, kills: entry.kills });
      button.append(record);
    }

    button.addEventListener('click', () => {
      const next = toggleEntry(view, sel, entry.poolIndex);
      if (next === sel) return;
      sel = next;
      paint();
      choice.onChange(sel);
    });
    li.append(button);
    list.append(li);
    rows.push({ entry, button });
  }

  paint();
  set.append(legend, list, slots, reserve);
  return set;
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
  /**
   * Take the screen down without starting the mission, from outside.
   *
   * The battlefield's disposer owns this. `done()` parks on the player's click
   * for as long as they care to read, so a router navigation that supersedes a
   * half-booted mission would otherwise wait forever on a screen nobody is
   * looking at any more -- and the mount it is blocking never resolves, so its
   * own teardown never runs either. Disposing REJECTS a pending `done()` with
   * an `AbortError`, which is the shape `bootBattlefield` rethrows and the
   * router swallows for a stale mount.
   *
   * Idempotent, and safe before `done()` has ever been called.
   */
  dispose(): void;
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
  commander?: { rank: string; plate: string; portrait?: string },
  /** A short cinematic for this mission, already the RESOLVED URL (main.ts
   *  prefixes `BASE` to the mission's `briefing_video`). Shown above the
   *  beats; the beats and the deploy button are unchanged with or without
   *  it, and a URL that fails to load removes the element rather than
   *  leaving a dead player on the screen. */
  briefingVideo?: string,
  /** What the campaign ledger hands this mission (`broughtFor`), rendered as a
   *  sibling of the beats -- never one itself, so the beat count a test reads
   *  off a briefing is unaffected by whether a panel is present. Gated on
   *  `holds`, the same condition the orders paragraph and commander line are:
   *  a sandbox or a mission with no briefing shows neither. */
  brought?: BroughtPanel,
  /**
   * Where Escape takes the player instead of deploying (task 6). Before this,
   * Escape on the briefing -- and a stray click anywhere on it, the deleted
   * `pointerdown` listener below -- DEPLOYED the mission nobody meant to
   * start. Now Escape goes back when there is somewhere to go back to, and a
   * back link renders under Deploy calling the same function; with nothing
   * supplied (a sandbox, which has no briefing to return from) Escape does
   * nothing and no link renders, same as any other key a long briefing is
   * scrolled with. `main.ts` passes `() => req.navigate(routes.campaign())`
   * for a mission and omits this for a sandbox -- a ROUTER navigation since
   * the battlefield gained a real disposer, not the full page load
   * (`window.location.assign('?campaign')`) this used to name. The screen is
   * torn down here without settling `done()`; the abort that follows the
   * navigation is what unparks whoever is awaiting it (`dispose()` above).
   */
  onBack?: () => void,
  /** Every objective the mission declares, shown under the orders. The
   *  briefing is the one place the player can read the whole contract before
   *  committing; the strip shows one primary and a count (`stripObjectives`),
   *  which is right on the field and wrong here. Absent for a sandbox. */
  objectives?: readonly ObjectiveRow[],
  /** Whether this mission pays credits at all -- `ledger.produces.length > 0`,
   *  the same gate `main.ts` puts on `payMission`. */
  paysCredits?: boolean,
  /**
   * The force, to be chosen rather than merely shown (shell Phase 3, Task 3;
   * spec Decision 4). Gated on `holds` like everything else conditional on
   * this screen, and drawn only when the view has at least one body to
   * choose -- with none, `brought` keeps its own roster and reserve lines as
   * it always has. When it IS drawn it takes those two lines over, so the
   * screen never carries two reserve counts (pre-flight P2). Appended after
   * `paysCredits` so no existing call site's argument order moves.
   */
  force?: DeployChoice,
  /** The ground the orders are about, painted one pixel per tile beside the
   *  force. Gated on `holds`; dropped, not thrown on, where the canvas has no
   *  2D context. */
  preview?: GroundPreview
): LoadingScreen {
  const wrap = document.createElement('div');
  wrap.className = 'rl-loading';

  const box = document.createElement('div');
  box.className = 'rl-loading__box';

  const label = document.createElement('div');
  label.className = 'rl-loading__label';
  label.textContent = t('loading.deploying');

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
  // The live region is the COUNT, not the screen (final review, ruling 8): a
  // player on a screen reader gets the progress without polling, and it is
  // the one thing here that changes on its own. The whole screen used to be
  // the region, and `status` is atomic -- so every deploy-row toggle, which
  // rewrites `aria-pressed` and the slot and reserve lines, re-read it. A
  // pressed row already announces its own state through `aria-pressed`.
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');

  const holds = briefingHoldsDeployment(briefing);

  // Attributed the same way the in-mission commander bar is (`ui/hud.ts`'s
  // `renderCommander`) -- rank and plate, gated on `holds` exactly like the
  // orders paragraph below: a sandbox or a mission with no briefing shows
  // neither.
  const commanderLine = document.createElement('div');
  commanderLine.className = 'rl-loading__commander';
  if (holds && commander) commanderLine.textContent = t('loading.commander', { rank: commander.rank, plate: commander.plate });

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

  // A container of beats, not one paragraph (GH-162): the eleven authored
  // briefings already split on `briefingBeats` for the in-mission commander
  // bar, and landing the whole string as one block at the plate-style body
  // size was the complaint. `orders` keeps the class the scroll/max-height
  // rule below already targets -- only the tag changes, `<p>` to a `<div>`
  // that can hold one `<p class="rl-loading__beat">` per beat -- so the
  // "Deploy never leaves the screen" contract is untouched.
  const orders = document.createElement('div');
  orders.className = 'rl-loading__brief';
  if (holds) {
    for (const [i, beat] of briefingBeats(briefing as string).entries()) {
      const p = document.createElement('p');
      p.className = 'rl-loading__beat';
      p.textContent = beat;
      // `--i` is the same per-child stagger property `motion.ts`'s `stagger()`
      // sets for the menu entrance (`.rl-stagger`) -- reused here rather than
      // a new custom property, and read at a different pace by
      // `.rl-loading__beat`'s own animation-delay in theme.css. `data-index`
      // is the redundant, assertable half: jsdom does not run CSS animations
      // at all (see loading.test.ts), so the test reads this, not `--i`.
      p.style.setProperty('--i', String(i));
      p.dataset.index = String(i);
      orders.appendChild(p);
    }
  }

  // Whether the force is CHOSEN on this screen (Task 3) rather than listed.
  // Only with orders to read, and only when there is at least one body to
  // choose: an empty spread under "Confirm your force" would be a question
  // with no answers, so that case keeps the brought panel whole instead.
  const choosing = holds && force !== undefined && force.view.eligible.length > 0;

  // "What you brought" -- a sibling of the beats, never a beat itself, so the
  // beat count a test reads off a briefing stays what the briefing alone
  // produces. Gated on `holds` exactly like `orders` above it: a sandbox or a
  // mission with no briefing shows no panel, whether or not one was supplied.
  //
  // With the force being chosen, the spread takes over this panel's roster
  // and reserve lines (pre-flight P2): the spread's rows ARE the roster, and
  // two reserve counts from two computations is the defect that ruling
  // closed. What stays here is what the spread does not say -- conduct and
  // the intel sentences -- and a panel left with nothing to say is not drawn.
  let broughtEl: HTMLElement | null = null;
  if (holds && brought) {
    broughtEl = document.createElement('div');
    broughtEl.className = 'rl-loading__brought';
    const h = document.createElement('div');
    h.className = 'rl-loading__brought-head';
    h.textContent = t('loading.brought.head');
    broughtEl.appendChild(h);
    const ul = document.createElement('ul');
    for (const r of choosing ? [] : brought.roster) {
      const li = document.createElement('li');
      li.textContent = t('loading.brought.item', { type: r.type, count: r.count });
      // The stripe is its own element so it can wear `--commend` like the HUD
      // card's does. Built rather than assigned as innerHTML: `r.type` is a
      // unit name out of the catalogue and this panel never interpolates.
      if (r.stripes > 0) li.append(' ', commendation(r.stripes));
      // Names, spelled out rather than counted -- who came back is the point
      // of a service record, and a count would just repeat `×${r.count}`.
      if (r.names.length > 0) li.append(` (${r.names.join(', ')})`);
      ul.appendChild(li);
    }
    // The reserve is a count on its own line under the roster, not a roster row:
    // it is the one number here that is about people who are NOT coming, and
    // giving it a `×N` of its own would read as another unit type.
    if (!choosing && brought.reserve > 0) {
      const li = document.createElement('li');
      li.className = 'rl-loading__reserve';
      li.textContent = t('loading.brought.reserve', { n: brought.reserve });
      ul.appendChild(li);
    }
    if (brought.conduct !== null) {
      const li = document.createElement('li');
      li.textContent = t('loading.brought.conduct', { n: brought.conduct });
      ul.appendChild(li);
    }
    broughtEl.appendChild(ul);
    for (const s of brought.sentences) {
      const p = document.createElement('p');
      p.className = 'rl-loading__brought-line';
      p.textContent = s;
      broughtEl.appendChild(p);
    }
    if (choosing && ul.childElementCount === 0 && brought.sentences.length === 0) broughtEl = null;
  }

  // The cinematic, when the mission has one. Autoplay is asked for with sound
  // -- the player reached this screen by clicking a mission, which is the
  // gesture browsers want -- and if the browser still refuses, the element
  // falls back to muted autoplay and keeps its controls, so the picture plays
  // either way and the sound is one click away. Nothing here holds
  // deployment: Deploy stays the player's decision, exactly as for the beats.
  let video: HTMLVideoElement | null = null;
  if (briefingVideo !== undefined) {
    video = document.createElement('video');
    video.className = 'rl-loading__video';
    video.src = briefingVideo;
    video.autoplay = true;
    video.controls = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('error', () => {
      video?.remove();
      box.classList.remove('rl-loading__box--video');
    });
    const attempt = video.play?.();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {
        if (!video) return;
        video.muted = true;
        void video.play?.()?.catch(() => undefined);
      });
    }
  }

  // The display face: a stamped button, not a quiet outline -- the one
  // control on this screen that starts the mission earns the same weight the
  // mission's own name gets above it.
  const deploy = document.createElement('button');
  deploy.className = 'rl-loading__deploy';
  deploy.type = 'button';
  deploy.textContent = t('loading.deploy');

  // The back edge Escape now uses (see `onBack`'s own doc comment above).
  // Rendered only when there is somewhere to go back to -- a sandbox has no
  // briefing to return from, and no `onBack` to call. Its click listener is
  // NOT wired here -- `done()` below wires it, through the same `cleanup()`
  // Escape uses (fix round 1: this used to call `onBack()` directly, which
  // skipped `cleanup()` and left the window keydown listener, `wrap` and the
  // pending promise all dangling -- invisible only because every `onBack`
  // this app wires up is a hard page navigation that tears the whole JS
  // realm down anyway).
  let back: HTMLButtonElement | null = null;
  if (onBack) {
    back = document.createElement('button');
    back.type = 'button';
    back.className = 'rl-btn rl-loading__back';
    back.textContent = t('nav.backToCampaignMap');
  }

  // The right-hand column of the spread (Task 3; spec Decision 4: "portrait
  // and orders left, the roster's force and a map preview right"). Built
  // only with orders to read, like everything else conditional on `holds`.
  // The spread is built after `deploy` because it owns that button's
  // `disabled` -- the screen may not deploy short (`isComplete`).
  const spreadEl = choosing && force ? deploySpread(force, deploy) : null;
  let groundEl: HTMLElement | null = null;
  if (holds && preview) {
    const ground = paintMapTerrain(preview.map, preview.tones);
    if (ground !== null) {
      ground.className = 'rl-deploy__ground';
      groundEl = document.createElement('figure');
      groundEl.className = 'rl-deploy__map';
      const caption = document.createElement('figcaption');
      caption.textContent = t('deploy.map');
      groundEl.append(caption, ground);
    }
  }

  box.append(label, name, track, count);
  if (video) {
    box.classList.add('rl-loading__box--video');
    box.append(video);
  }
  if (holds) {
    box.classList.add('rl-loading__box--brief');
    // With a right-hand column the orders get a column of their own; with
    // none the box is laid out exactly as it was before the spread existed,
    // child for child, so a mission that reads no roster and draws no
    // preview cannot tell this change happened.
    let left: HTMLElement = box;
    if (spreadEl || groundEl) {
      box.classList.add('rl-loading__box--spread');
      left = document.createElement('div');
      left.className = 'rl-loading__orders';
    }
    if (commander) left.append(commanderHead);
    left.append(orders);
    // Task 5 (R-7: one component, three mounts): the full objective list,
    // read once, before deploying. A sibling of the beats -- appended here,
    // never built as one -- so a test counting `.rl-loading__beat` off a
    // briefing is unaffected by whether this is present. Gated on `holds`
    // exactly like `orders` and `broughtEl`: a sandbox declares no
    // objectives here and shows none. `objs` is captured in a local `const`
    // rather than closing over the `objectives` parameter directly, so the
    // `rows()` thunk keeps the type this `if` already narrowed it to.
    if (objectives) {
      const objs = objectives;
      objectivesPanel(left, { rows: () => objs, paysCredits: paysCredits ?? false });
    }
    if (broughtEl) left.append(broughtEl);
    if (left !== box) {
      const right = document.createElement('div');
      right.className = 'rl-loading__force';
      if (spreadEl) right.append(spreadEl);
      if (groundEl) right.append(groundEl);
      box.append(left, right);
    }
    // Below both columns, never inside one: Deploy is the answer to the
    // whole spread, and on a narrow screen where the columns stack it still
    // comes after the force it deploys.
    box.append(deploy);
    if (back) box.append(back);
  } else if (video) {
    // A cinematic with no orders still needs the player's go.
    box.append(deploy);
  }
  wrap.appendChild(box);
  host.appendChild(wrap);

  // Hook for GH-133 (music epic), not music: this is where a mission's theme
  // would start, and firing it here -- once, the moment the screen mounts --
  // means the cue lands without this screen ever needing to be re-laid out
  // for it. `title` is the same identifier main.ts already resolves before
  // calling this (`mission?.name ?? mission?.id ?? 'M0 sandbox'`), so no
  // caller needs to change to supply one. Nobody listens yet: `data/audio.json`
  // has no music-set kind to key a per-mission theme off, and
  // `packages/render/src/audio.ts`'s `BattleAudio.startMusic` is private and
  // plays one manifest-wide loop with no per-screen cue call to reach for
  // instead. Do not call it from here -- that would be reaching from `app`
  // into a module that has not grown the API this event is standing in for.
  document.dispatchEvent(new CustomEvent('rl:cue', { detail: { cue: 'briefing', mission: title } }));

  let loaded = 0;
  let expected = 0;
  let totalKnown = false;

  const paint = (): void => {
    // Before the total is known the bar would divide by zero; an empty bar and
    // a bare count is honest about not knowing yet. Three states since
    // 2026-09-07, not two: a boot on the mesh path can have NO sheets to load
    // at all (every fielded type draws as a model -- `spriteSheetPlan`), and
    // that is a full bar reading 'meshes only', not a bar stuck at 'reading
    // manifests' under a deploy button that already works.
    const ratio = expected > 0 ? Math.min(1, loaded / expected) : totalKnown ? 1 : 0;
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    count.textContent =
      expected > 0
        ? t('loading.sheets', { loaded, expected })
        : totalKnown
          ? t('loading.meshesOnly')
          : t('loading.readingManifests');
  };
  paint();

  /** Whether `dispose()` has already run. `done()` after that point is a
   *  mount still walking its own boot after being superseded, so it rejects
   *  rather than putting a torn-down screen back on the player's expectations. */
  let disposed = false;
  /** The live `done()` promise's teardown and its rejection handle, lifted out
   *  of that promise's closure so `dispose()` can reach both. Null whenever no
   *  `done()` is outstanding -- before the first call, and after the deploy
   *  button has resolved it. */
  let pendingCleanup: (() => void) | null = null;
  let pendingReject: ((err: unknown) => void) | null = null;

  return {
    total(n: number): void {
      expected = n;
      totalKnown = true;
      paint();
    },
    step(): void {
      loaded += 1;
      paint();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const reject = pendingReject;
      // Takes the keydown listener off and removes `wrap`; a no-op if the
      // player already deployed.
      pendingCleanup?.();
      pendingCleanup = null;
      pendingReject = null;
      // Also covers the case where `done()` was never called at all -- the
      // mission was superseded while its sheets were still loading, so the
      // screen is up but no promise is outstanding. `remove()` on an
      // already-detached node is a no-op.
      wrap.remove();
      reject?.(new DOMException('loading screen disposed', 'AbortError'));
    },
    done(): Promise<void> {
      if (disposed) {
        return Promise.reject(new DOMException('loading screen disposed', 'AbortError'));
      }
      if (!holds) {
        wrap.remove();
        return Promise.resolve();
      }
      // Reading time is the player's to spend, and the only way out that
      // starts the mission is the button itself.
      //
      // Deliberately NOT any-key, which is how titleCard works and would be
      // wrong here: a briefing long enough to scroll is a briefing the player
      // scrolls, and Down or Page-Down would deploy them mid-sentence. The
      // button is focused on mount, so Enter and Space still work through its
      // own activation rather than through a global listener.
      //
      // A stray click used to dismiss too (the `pointerdown` listener this
      // replaced), and Escape used to deploy unconditionally -- both read as
      // the game starting itself, which is the whole complaint task 6 exists
      // to answer. Escape now goes BACK instead, when `onBack` gives it
      // somewhere to go: `cleanup` tears the screen down WITHOUT resolving,
      // because the mission never starts and the page is about to navigate
      // away under it. With nowhere to go back to, Escape does nothing, same
      // as any other key a long briefing is scrolled with.
      return new Promise<void>((resolve, reject) => {
        let gone = false;
        const cleanup = (): void => {
          if (gone) return;
          gone = true;
          window.removeEventListener('keydown', onKey);
          wrap.remove();
        };
        // Published so `dispose()` can tear this down from outside and unpark
        // whoever is awaiting it. Cleared on every path that settles the
        // promise, so a later `dispose()` cannot reject a resolved one.
        pendingCleanup = cleanup;
        pendingReject = reject;
        // The one path out that does NOT start the mission -- shared by
        // Escape and the back link (fix round 1), so both tear the screen
        // down the same way rather than the link bypassing `cleanup()`.
        const goBack = (): void => {
          if (!onBack) return;
          cleanup();
          onBack();
        };
        const onKey = (e: KeyboardEvent): void => {
          if (e.key === 'Escape') goBack();
        };
        deploy.addEventListener('click', () => {
          cleanup();
          // Settled: a later `dispose()` (the ordinary battlefield teardown,
          // minutes into the mission) must not reject a promise the player
          // already answered. Rejecting a settled promise is a no-op in JS, so
          // this is for the reader rather than the runtime.
          pendingCleanup = null;
          pendingReject = null;
          resolve();
        });
        // `goBack` deliberately does NOT clear these: it tears the screen down
        // without settling the promise, so whoever is awaiting `done()` is
        // still parked, and the abort that follows the navigation is what
        // unparks them.
        back?.addEventListener('click', goBack);
        window.addEventListener('keydown', onKey);
        deploy.focus();
      });
    },
  };
}
