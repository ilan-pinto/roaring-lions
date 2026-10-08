// The selection cluster's arithmetic, with no DOM and no sim in it.
//
// Two questions, both of which the HUD used to answer inline and both of which
// have a wrong answer that looks right:
//
//   1. What does a mixed selection say? One chip per unit TYPE, with the
//      group's aggregate health and one line of condition. Grouping by type is
//      what makes a 40-unit selection readable at all, and the aggregate is
//      what stops "Rifle Squad x8" from reporting one squad's health as the
//      whole group's.
//
//   2. Which orders can this selection give, and which of those would do
//      nothing if given right now? Those are two different facts and the spec
//      draws them differently -- absent versus 45% -- because "this unit
//      cannot unload" and "this transport is empty" are different things to
//      tell a player. Collapsing them loses the second one entirely.
//
// The inputs are structural (plain fields, not a Sim), so a test can describe a
// selection instead of building a world, and so this file needs no sim import
// at all -- invariant 4: the HUD renders what the sim reports and mutates
// nothing.

import { t } from '../i18n/t';
import type { RoleBucket } from './role';
import { combatBand, vehicleDamage } from './combat-state';

/** The five verbs the order row offers. Named rather than positional so the
 *  armed state, the dispatch table and the tests all say the same word. */
export type OrderId = 'attackMove' | 'halt' | 'smoke' | 'load' | 'unload';

export interface OrderSpec {
  /** Also the key the mark is drawn by: `symbolSvg(id)` (S3e, the G1 sheet)
   *  and `ORDER_SIGHT[id].family` for its colour -- one id, no second field
   *  that could name a different picture. */
  id: OrderId;
  /** A catalogue KEY, not the label text -- the same lesson `input/keymap.ts`'s
   *  `ActionSpec.label` follows (that file's own header comment has the
   *  full reasoning). `hud.ts`'s `renderOrders` calls `t()` on this at
   *  render time, which is what lets this table stay static data. */
  label: string;
  /** The key that does the same thing, shown dim beside the label. Since
   *  Task 5 this is an `input/keymap.ts` ACTION id (`'halt'`, `'smoke'`,
   *  `'load'`, `'unload'`), not a letter — the HUD resolves it to a label
   *  through `HudDeps.keyFor`, which is what lets a rebind change the button
   *  along with the key. `attackMove` is the one exception: it keeps the
   *  literal `'RMB'`, which is not an action id and `keyFor` passes through
   *  unchanged (see its own comment below for why it is not bound to a key
   *  at all). Empty for an order the keyboard does not bind. */
  key: string;
}

/**
 * The row, in the spec's order.
 *
 * `attackMove`'s key is the literal `'RMB'`, not an `input/keymap.ts` ACTION
 * id — there is no `attackMove` action, and `rebindable` does not apply to
 * it — and that is a deliberate and reversible decision rather than an
 * oversight. `a` is bound to pan the camera left (`main.ts`, the rAF loop's
 * `keys.has('panLeft')`), and with no edge-scroll and no drag-pan in the
 * game, WASD and the arrows are the only two ways to move the camera at all.
 * Binding `a` here would pan the map a couple of tiles on every arm; taking
 * `a` off the pan set would leave `w`, `s` and `d` panning around a hole.
 * Both are worse than a label naming the gesture that actually exists — and
 * a button whose printed key does something else is exactly the drift this
 * row is built to make impossible. Moving the camera off WASD would make `A`
 * available and is a controls decision, not a HUD one.
 */
export const ORDERS: readonly OrderSpec[] = [
  { id: 'attackMove', label: 'order.attackMove', key: 'RMB' },
  { id: 'halt', label: 'order.halt', key: 'halt' },
  { id: 'smoke', label: 'order.smoke', key: 'smoke' },
  { id: 'load', label: 'order.load', key: 'load' },
  { id: 'unload', label: 'order.unload', key: 'unload' },
];

/**
 * What the selection is made of, as counts.
 *
 * Counts and not ids because nothing here needs to name a unit: every rule is
 * "is there at least one of these". Building this is the HUD's one job that
 * touches the sim, and it is a single pass.
 */
export interface SelectionFacts {
  /** Living, own-side units selected. Zero hides the row entirely. */
  count: number;
  /** How many are moving or still hold a waypoint — what a halt would stop. */
  underway: number;
  /** How many carry smoke. */
  smokers: number;
  /** How many are transports. */
  carriers: number;
  /** Seats across those transports. */
  slots: number;
  /** Passengers currently in them. */
  aboard: number;
  /** How many selected units could board a transport. */
  riders: number;
}

export interface OrderView extends OrderSpec {
  /** Lime: this is the armed order, and the next click on the map spends it. */
  armed: boolean;
  /**
   * The selection can give this order, but giving it right now would issue no
   * command — an empty transport asked to unload, a transport with no infantry
   * selected asked to load, a force standing still asked to halt.
   */
  inert: boolean;
  /** `0/8` beside Load, for a selection holding transports. */
  capacity?: string;
}

/**
 * Which orders to show, and which of them are inert.
 *
 * SHOWN is a question about the units: can anything in this selection perform
 * this verb at all. INERT is a question about the moment: asked right now,
 * would the order produce a command.
 *
 * For the three verbs `input/intents.ts` resolves, inert is defined as
 * "`resolveKeyVerb` would return no intents", which is why the load rule reads
 * `riders === 0` and not `aboard >= slots`: `sortMount` does not check capacity
 * either, so a full transport still issues a load command that the sim then
 * declines. Mirroring the resolver rather than second-guessing it is the whole
 * point — the row must promise exactly what the key delivers.
 *
 * `halt` is the exception and is judged here, because the `h` key dispatches a
 * halt directly with no resolver in front of it. Nothing moving and no
 * waypoints queued means a halt changes nothing.
 */
export function orderRow(facts: SelectionFacts, armed: OrderId | null): OrderView[] {
  if (facts.count === 0) return [];
  const rows: OrderView[] = [];
  for (const spec of ORDERS) {
    let shown = false;
    let inert = false;
    let capacity: string | undefined;
    switch (spec.id) {
      case 'attackMove':
        // Anything alive can be sent somewhere.
        shown = true;
        break;
      case 'halt':
        shown = true;
        inert = facts.underway === 0;
        break;
      case 'smoke':
        shown = facts.smokers > 0;
        break;
      case 'load':
        shown = facts.carriers > 0;
        inert = facts.riders === 0;
        capacity = `${facts.aboard}/${facts.slots}`;
        break;
      case 'unload':
        shown = facts.carriers > 0;
        inert = facts.aboard === 0;
        break;
    }
    if (!shown) continue;
    rows.push({
      ...spec,
      armed: armed === spec.id,
      inert,
      ...(capacity !== undefined ? { capacity } : {}),
    });
  }
  return rows;
}

/** One selected unit, as the chip row needs it. Structural for the same reason
 *  SelectionFacts is. */
export interface UnitFacts {
  typeId: string;
  name: string;
  bucket: RoleBucket;
  hp: number;
  hpMax: number;
  routed: boolean;
  pinned: boolean;
  moving: boolean;
  /** Pass C2/C4 (D5): suppression (0..2), and the two component kills.
   *  Optional, so a caller with no combat facts reads healthy. */
  suppression?: number;
  mobilityKilled?: boolean;
  firepowerKilled?: boolean;
  /** Riding in a transport. */
  aboard: boolean;
  /** Active protection, where the type has any. */
  aps?: { ammo: number; magazine: number };
  /** Side 0 -- the player's own. Absent reads as not own, so a chip never
   *  claims kit it cannot prove (plan 2b). */
  own?: boolean;
}

export interface ChipView {
  typeId: string;
  name: string;
  bucket: RoleBucket;
  count: number;
  /** 0..1 over the whole sub-group, not over its first member. */
  hpPct: number;
  hpTone: 'good' | 'warn' | 'bad';
  /** The chip's one line of condition, and what colour it is in. */
  status: string;
  statusTone: ChipTone;
  /** Every unit in the chip is the player's -- the kit sign's guard (plan 2b). */
  own: boolean;
  /** Draw the pinned mark on the chip art (GH-262): at least one unit is
   *  pinned and none is broken. It follows `chipStatus`'s precedence rather
   *  than a raw count, so the mark and the status line can never disagree --
   *  a broken unit's chip says BROKEN and carries no pinned mark. */
  pinned: boolean;
  /** The mark on the chip art (pass C2/C4, D5), from the same precedence as
   *  the status line, or null. `pinned` above stays the pinned case of it. */
  mark: ChipMark | null;
  /** A muted second clause naming the next state down, or null. */
  detail: string | null;
}

/** Which status mark a chip's art carries. */
export type ChipMark = 'broken' | 'pinned' | 'gunOut' | 'immobilised';

/**
 * The ink a chip's condition line is set in. Its own union rather than
 * `hud-model`'s `Tone`, because the two tones this line can take are `bad` and
 * `hot`, and `hot` is not a notice tone — the feed never uses it. `null` is the
 * ordinary case and means the line inherits the chip's dim ink.
 */
export type ChipTone = 'bad' | 'hot' | null;

/** The health track's three bands, shared by the chip and the card so a unit
 *  cannot be amber in one and green in the other. */
export function hpTone(pct: number): 'good' | 'warn' | 'bad' {
  return pct > 0.5 ? 'good' : pct > 0.25 ? 'warn' : 'bad';
}

/**
 * Group a selection into one chip per unit type.
 *
 * Order is first-appearance in the selection, which is stable across the 4 Hz
 * rebuild for as long as the selection is: sorting by count would make chips
 * swap places as casualties land, and the chip a player is reaching for must
 * not move while they reach for it.
 *
 * The status line reports the WORST thing true of the group, in a fixed
 * precedence, because there is room for exactly one line and a player scanning
 * a row of chips is looking for the one in trouble. Broken outranks pinned
 * outranks aboard; APS outranks moving, which is the spec's own reading — a
 * Namer shown as `APS 3/4` while it was moving.
 */
export function groupChips(units: UnitFacts[]): ChipView[] {
  const order: string[] = [];
  const byType = new Map<string, UnitFacts[]>();
  for (const u of units) {
    const bucket = byType.get(u.typeId);
    if (bucket) bucket.push(u);
    else {
      byType.set(u.typeId, [u]);
      order.push(u.typeId);
    }
  }
  return order.map((typeId) => {
    const group = byType.get(typeId) ?? [];
    const head = group[0];
    let hp = 0;
    let hpMax = 0;
    let routed = 0;
    let pinned = 0;
    let outOfAction = 0;
    let gunOut = 0;
    let immobilised = 0;
    let suppressed = 0;
    let shaken = 0;
    let aboard = 0;
    let moving = 0;
    let apsAmmo = 0;
    let apsMag = 0;
    for (const u of group) {
      hp += u.hp;
      hpMax += u.hpMax;
      if (u.routed) routed++;
      if (u.pinned) pinned++;
      const damage = vehicleDamage(u.mobilityKilled === true, u.firepowerKilled === true);
      if (damage === 'outOfAction') outOfAction++;
      else if (damage === 'gunOut') gunOut++;
      else if (damage === 'immobilised') immobilised++;
      const band = combatBand(u.suppression ?? 0, u.pinned, u.routed);
      if (band === 'suppressed') suppressed++;
      else if (band === 'shaken') shaken++;
      if (u.aboard) aboard++;
      if (u.moving) moving++;
      if (u.aps) {
        apsAmmo += u.aps.ammo;
        apsMag += u.aps.magazine;
      }
    }
    const pct = hpMax > 0 ? Math.max(0, Math.min(1, hp / hpMax)) : 0;
    const { status, statusTone, mark, detail } = chipStatus({
      count: group.length,
      routed,
      pinned,
      outOfAction,
      gunOut,
      immobilised,
      suppressed,
      shaken,
      aboard,
      moving,
      aps: apsMag > 0 ? { ammo: apsAmmo, magazine: apsMag } : undefined,
    });
    return {
      typeId,
      name: head.name,
      bucket: head.bucket,
      count: group.length,
      hpPct: pct,
      hpTone: hpTone(pct),
      status,
      statusTone,
      own: group.every((u) => u.own === true),
      pinned: mark === 'pinned',
      mark,
      detail,
    };
  });
}

interface StatusCounts {
  count: number;
  routed: number;
  pinned: number;
  /** Pass C2/C4 (D5): optional, so a caller that knows none of them reads 0. */
  outOfAction?: number;
  gunOut?: number;
  immobilised?: number;
  suppressed?: number;
  shaken?: number;
  aboard: number;
  moving: number;
  aps?: { ammo: number; magazine: number };
}

/** The combat states in the chip's precedence, worst first (pass C2/C4,
 *  D5): broken › pinned › out of action › gun out › immobilised ›
 *  suppressed › shaken. Each with its line, its ink and its mark. */
const COMBAT_STATES: readonly {
  readonly key: 'routed' | 'pinned' | 'outOfAction' | 'gunOut' | 'immobilised' | 'suppressed' | 'shaken';
  readonly label: string;
  readonly tone: ChipTone;
  readonly mark: ChipMark | null;
}[] = [
  { key: 'routed', label: 'selection.chip.broken', tone: 'bad', mark: 'broken' },
  // 'hot' and not 'bad': pinned is recoverable and broken is not, and the top
  // strip already draws that same distinction in those same two colours.
  { key: 'pinned', label: 'selection.chip.pinned', tone: 'hot', mark: 'pinned' },
  { key: 'outOfAction', label: 'selection.chip.outOfAction', tone: 'bad', mark: 'gunOut' },
  { key: 'gunOut', label: 'selection.chip.gunOut', tone: 'bad', mark: 'gunOut' },
  { key: 'immobilised', label: 'selection.chip.immobilised', tone: 'bad', mark: 'immobilised' },
  { key: 'suppressed', label: 'selection.chip.suppressed', tone: 'hot', mark: null },
  { key: 'shaken', label: 'selection.chip.shaken', tone: null, mark: null },
];

/** The single condition line, exported so its precedence can be tested without
 *  assembling a group around it. The worst combat state present wins the
 *  line and the mark; the next one down, if any, is the muted `detail`. */
export function chipStatus(c: StatusCounts): { status: string; statusTone: ChipTone; mark: ChipMark | null; detail: string | null } {
  const present = COMBAT_STATES.filter((s) => (c[s.key] ?? 0) > 0);
  const detail = present.length > 1 ? t(present[1].label, { n: c[present[1].key] ?? 0 }) : null;
  if (present.length > 0) {
    const top = present[0];
    return { status: t(top.label, { n: c[top.key] ?? 0 }), statusTone: top.tone, mark: top.mark, detail };
  }
  const plain = (status: string): { status: string; statusTone: ChipTone; mark: null; detail: null } => ({ status, statusTone: null, mark: null, detail: null });
  if (c.aboard > 0) return plain(t('selection.chip.aboard', { n: c.aboard }));
  if (c.aps) return plain(t('selection.chip.aps', { ammo: c.aps.ammo, magazine: c.aps.magazine }));
  if (c.moving > 0) return plain(t('selection.chip.moving', { n: c.moving }));
  return plain(t('selection.chip.holding'));
}

/** Step the chip focus, wrapping. Tab is a cycle: reaching the end and stopping
 *  would leave the last chip with no way back to the first without a mouse. */
export function stepFocus(index: number, total: number): number {
  if (total <= 0) return 0;
  return (index + 1) % total;
}
