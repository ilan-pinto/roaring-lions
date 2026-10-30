/**
 * The formation row and its words, as data (GH-859 P1a; the approved HUD mock, Q1 and Q3).
 *
 * Pure: no DOM, no sim state. The three shipped formations (`data/formations/*.json`) are compiled
 * here ONCE, lazily, by the sim's own `compileFormation`, so the tooltip's schematic is
 * `templateOffsets` over the same compiled shape the order uses and the two cannot disagree
 * (the mock's hand-drawn slot functions are NOT ported).
 *
 * Labels are ACCESSORS, never tables resolved at module load: a table frozen at import would
 * keep whatever locale was active before `main.ts` set the catalogue (the `ROLE_LABEL` lesson).
 * Views carry catalogue KEYS; `formationLabel` and friends call `t()` at the moment they are asked.
 *
 * Formations are OFF in versus rooms until P1b: the caller passes `formationsOpen` (from
 * `formationsOpenIn(mode)`, the one predicate in `net/versus-formations.ts`) and this file only
 * takes the boolean and the reason key. It never reads the room's mode.
 */
import { formations } from '@lions/data';
import { FM_CLASS_NONE, FORMATION_CLASSES, compileFormation, ringTiles, templateOffsets, type CompiledFormation, type FormationJson } from '@lions/sim';
import { t } from '../i18n/t';
import { FORMATION_VERSUS_REASON_KEY } from '../net/versus-formations';
import type { Action } from '../input/keymap';
import type { OrderFamily } from './order-sight';

export type FormationId = 'column' | 'attack' | 'ambush';
export const FORMATION_IDS: readonly FormationId[] = ['column', 'attack', 'ambush'];

/** The classes the legend names: the sim's seven, plus the ambulance (a medic-class vehicle). */
export type LegendClass = (typeof FORMATION_CLASSES)[number] | 'ccp';
const LEGEND_CLASSES: readonly LegendClass[] = ['armour', 'light_vehicle', 'recon', 'infantry', 'support_weapon', 'medic', 'ccp', 'aircraft'];

export type FormationCounts = Readonly<Record<LegendClass, number>>;

// ---------------------------------------------------------------------------------------------
// The shipped formations, compiled once.
// ---------------------------------------------------------------------------------------------

interface Shipped {
  readonly json: FormationJson;
  readonly compiled: CompiledFormation;
}
let shipped: ReadonlyMap<string, Shipped> | null = null;

function shippedFormation(id: FormationId): Shipped {
  if (shipped === null) {
    const m = new Map<string, Shipped>();
    for (const json of formations) m.set(json.id, { json, compiled: compileFormation(json) });
    shipped = m;
  }
  const f = shipped.get(id);
  if (f === undefined) throw new Error(`formation ${id}: not shipped`);
  return f;
}

/** The order verb a formation rides on: `attackMove` for the attack, `move` for the rest (an
 *  `either` formation sends as a plain move). Read from the file, so a retuned file moves it. */
export function formationVerb(id: FormationId): 'move' | 'attackMove' {
  return shippedFormation(id).json.verb === 'attackMove' ? 'attackMove' : 'move';
}

/** Fewest free units the sim will form this formation from (below it the order degrades). */
export function formationMinMembers(id: FormationId): number {
  return shippedFormation(id).compiled.minMembers;
}

/** Class codes (0..6) the formation's ring element takes; empty when it has no ring. */
function ringClasses(id: FormationId): readonly number[] {
  const out: number[] = [];
  for (const el of shippedFormation(id).json.elements) {
    if (el.shape.kind !== 'ring') continue;
    for (const name of el.classes) {
      const code = (FORMATION_CLASSES as readonly string[]).indexOf(name);
      if (code >= 0) out.push(code);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The row.
// ---------------------------------------------------------------------------------------------

/** One own, living, selected unit as the row needs it. The caller filters to own living units. */
export interface FormationUnitFact {
  /** The unit's formation class code: an index into `FORMATION_CLASSES`, or `FM_CLASS_NONE`. */
  cls: number;
  /** Not garrisoned, aboard a carrier or below ground. */
  free: boolean;
  /** A casualty-collection vehicle (the legend's Ambulance); medic-class for the sim. */
  ambulance?: boolean;
}

export interface FormationFacts {
  /** `formationsOpenIn(netConfig?.mode)`: false in a versus room until P1b. */
  formationsOpen: boolean;
  units: readonly FormationUnitFact[];
}

export interface FormationView {
  id: FormationId;
  /** A catalogue KEY (`formation.column.name`); resolve with `formationLabel`. */
  labelKey: string;
  /** A keymap ACTION id, resolved to a letter by the HUD's `keyFor`. */
  key: Extract<Action, 'formationColumn' | 'formationAttack' | 'formationAmbush'>;
  family: Extract<OrderFamily, 'manoeuvre' | 'offensive' | 'control'>;
  /** This is the armed formation: the next click on the map spends it. */
  armed: boolean;
  inert: boolean;
  /** Why it is inert, a catalogue key; present exactly when `inert` is. */
  reasonKey?: string;
}

const ROW: readonly { id: FormationId; key: FormationView['key']; family: FormationView['family'] }[] = [
  { id: 'column', key: 'formationColumn', family: 'manoeuvre' },
  { id: 'attack', key: 'formationAttack', family: 'offensive' },
  { id: 'ambush', key: 'formationAmbush', family: 'control' },
];

/**
 * Which formation buttons to show, and which are inert.
 *
 * The row draws when the selection holds at least two own living units of a class other than none.
 * Then, in order of precedence: a versus room (`formationsOpen` false) makes every button inert with
 * the versus reason; fewer than `min_members` FREE units makes it `needsTwo`; and the ambush alone
 * also needs one free unit of a ring class (`ambushNoGround`).
 */
export function formationRow(facts: FormationFacts, armed: FormationId | null): FormationView[] {
  const placeable = facts.units.filter((u) => u.cls !== FM_CLASS_NONE);
  if (placeable.length < 2) return [];
  const free = placeable.filter((u) => u.free);
  return ROW.map((spec) => {
    let reasonKey: string | undefined;
    if (!facts.formationsOpen) reasonKey = FORMATION_VERSUS_REASON_KEY;
    else if (free.length < formationMinMembers(spec.id)) reasonKey = 'hud.formation.inert.needsTwo';
    else if (spec.id === 'ambush' && !free.some((u) => ringClasses('ambush').includes(u.cls))) reasonKey = 'hud.formation.inert.ambushNoGround';
    return {
      id: spec.id,
      labelKey: `formation.${spec.id}.name`,
      key: spec.key,
      family: spec.family,
      armed: armed === spec.id,
      inert: reasonKey !== undefined,
      ...(reasonKey !== undefined ? { reasonKey } : {}),
    };
  });
}

/** The button's text, in the ACTIVE catalogue at the moment of asking. */
export function formationLabel(id: FormationId): string {
  return t(`formation.${id}.name`);
}
/** The tooltip's one-line description of the formation. */
export function formationBlurb(id: FormationId): string {
  return t(`formation.${id}.blurb`);
}
/** The row's caption ("Formation"). */
export function formationTag(): string {
  return t('hud.formation.tag');
}
/** The note shown while the formation is armed and waiting for a click. */
export function formationArmNote(id: FormationId): string {
  return t(`hud.formation.arm.${id}`);
}
/** An inert button's reason line. */
export function formationReason(view: FormationView): string | null {
  return view.reasonKey === undefined ? null : t(view.reasonKey);
}

// ---------------------------------------------------------------------------------------------
// Class counts, the schematic and its legend.
// ---------------------------------------------------------------------------------------------

/** Count units by legend class. A unit of class none is not counted; an ambulance is counted as
 *  `ccp`, not `medic`. */
export function classCounts(units: readonly { cls: number; ambulance?: boolean }[]): FormationCounts {
  const out: Record<LegendClass, number> = { armour: 0, light_vehicle: 0, recon: 0, infantry: 0, support_weapon: 0, medic: 0, ccp: 0, aircraft: 0 };
  for (const u of units) {
    if (u.cls < 0 || u.cls >= FORMATION_CLASSES.length) continue;
    const name = FORMATION_CLASSES[u.cls];
    out[name === 'medic' && u.ambulance === true ? 'ccp' : name]++;
  }
  return out;
}

export interface SchematicSlot {
  cls: LegendClass;
  /** Positive ahead of the frame (toward the click for the attack). */
  forward: number;
  /** Positive to the frame's right-hand side. */
  lateral: number;
}

/**
 * Where each class stands on open ground: the sim's `templateOffsets` over the compiled shipped
 * formation, so the tooltip cannot disagree with the order. Ambulances take the medic element's
 * slots after the medics, and are told apart here.
 */
export function schematicSlots(id: FormationId, counts: Partial<Record<LegendClass, number>>): SchematicSlot[] {
  const classes: number[] = [];
  FORMATION_CLASSES.forEach((name, code) => {
    const n = (counts[name] ?? 0) + (name === 'medic' ? (counts.ccp ?? 0) : 0);
    for (let i = 0; i < n; i++) classes.push(code);
  });
  const medicCode = FORMATION_CLASSES.indexOf('medic');
  let medicsLeft = counts.medic ?? 0;
  return templateOffsets(shippedFormation(id).compiled, classes).map((s) => {
    let cls: LegendClass = FORMATION_CLASSES[s.cls];
    if (s.cls === medicCode) {
      if (medicsLeft > 0) medicsLeft--;
      else cls = 'ccp';
    }
    return { cls, forward: s.forward, lateral: s.lateral };
  });
}

/** The ambush ring's radius in the slots drawn: the smallest ring (3..6) holding every ring-class slot, 0 when
 *  there are none. For the schematic's dashed circle. */
export function schematicRing(id: FormationId, slots: readonly SchematicSlot[]): number {
  const rc = new Set(ringClasses(id).map((c) => FORMATION_CLASSES[c] as LegendClass));
  const ring = slots.filter((s) => rc.has(s.cls));
  if (ring.length === 0) return 0;
  for (let r = 3; r <= 6; r++) {
    const tiles = new Set(ringTiles(r).map((p) => `${p[0]},${p[1]}`));
    if (ring.every((s) => tiles.has(`${s.forward},${s.lateral}`) || tiles.has(`${s.lateral},${s.forward}`))) return r;
  }
  return 0;
}

export interface LegendRow {
  cls: LegendClass;
  label: string;
  n: number;
}
/** The legend's class rows, present classes only, in class order. */
export function formationLegendRows(counts: Partial<Record<LegendClass, number>>): LegendRow[] {
  return LEGEND_CLASSES.filter((c) => (counts[c] ?? 0) > 0).map((cls) => ({ cls, label: t(`formation.class.${cls}`), n: counts[cls] ?? 0 }));
}
/** The extra legend line: the attack's click, the ambush's kill zone, none for the column. */
export function formationLegendMark(id: FormationId): { mark: 'click' | 'killZone'; label: string } | null {
  if (id === 'attack') return { mark: 'click', label: t('hud.formation.legend.click') };
  if (id === 'ambush') return { mark: 'killZone', label: t('hud.formation.legend.killZone') };
  return null;
}
/** The tooltip's closing line about which way the formation faces, from the shipped file. */
export function formationFacingLine(id: FormationId): string {
  const f = shippedFormation(id).json;
  const face = `hud.formation.face.${f.arrival.face}`;
  const parts = [t(face)];
  // Ruling 16: composed from the file's facts. Every drill with copy speaks (the validator requires the key for each
  // but halt and none, which P1a leaves unsaid), and the ring line follows a ring element, not the id.
  const drill = f.contact.drill;
  if (drill !== 'halt' && drill !== 'none') parts.push(t(`hud.formation.drill.${drill}`));
  if (f.elements.some((el) => el.shape.kind === 'ring')) parts.push(t('hud.formation.shape.ring'));
  return parts.join(' ');
}

// ---------------------------------------------------------------------------------------------
// The card and the chip.
// ---------------------------------------------------------------------------------------------

/** Where a member stands in its formation: on the march, set in its slot, or (an ambush) sprung. */
export type FormationPhase = 'marching' | 'set' | 'sprung';

export interface FormationMemberView {
  id: FormationId;
  phase: FormationPhase;
  /** The ring radius, an ambush member's, when the HUD knows it. */
  radius?: number;
}

export interface FormationCardLine {
  text: string;
  /** Drawn in the dim ink. */
  dim: boolean;
}

/** What a formation member's card says (the mock's Q1, cut to what P1a can make true). */
export function formationCardLines(view: FormationMemberView): FormationCardLine[] {
  if (view.id === 'column') return [{ text: t('hud.card.formation.column'), dim: false }];
  if (view.id === 'attack') return [{ text: t('hud.card.formation.attack'), dim: false }];
  if (view.phase === 'sprung') return [{ text: t('hud.card.formation.sprung'), dim: false }];
  if (view.phase === 'marching') return [{ text: t('hud.card.formation.ambush.moving'), dim: false }];
  const lines: FormationCardLine[] = [{ text: t('hud.card.formation.ambush.set'), dim: false }];
  if (view.radius !== undefined && view.radius > 0) lines.push({ text: t('hud.card.formation.ambush.radius', { r: view.radius }), dim: true });
  return lines;
}

/** How many of a chip's units are in each formation. */
export interface FormationChipCounts {
  column?: number;
  attack?: number;
  ambush?: number;
}

/** The chip's formation line ("5 in column"), or null when none of its units is in one. A chip mixing
 *  formations names the one most of them are in (ties: column, attack, ambush). */
export function formationChip(counts: FormationChipCounts | undefined): string | null {
  if (counts === undefined) return null;
  let best: FormationId | null = null;
  let bestN = 0;
  for (const id of FORMATION_IDS) {
    const n = counts[id] ?? 0;
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best === null ? null : t(`selection.chip.formation.${best}`, { n: bestN });
}
