/**
 * The formation row model (GH-859 P1a). Oracles are literals: class codes are the sim's documented
 * indices (0 armour, 1 light vehicle, 2 recon, 3 infantry, 4 support weapon, 5 medic, 6 aircraft,
 * 255 none), reasons and keys are the catalogue's own strings, and the schematic is compared with the
 * sim's `templateOffsets` over a formation compiled HERE from the data files, not through the model.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { formations } from '@lions/data';
import { compileFormation, ringTiles, templateOffsets } from '@lions/sim';
import en from '../i18n/en.json';
import { setCatalogue } from '../i18n/t';
import {
  classCounts,
  formationArmNote,
  formationBlurb,
  formationAnswersCall,
  formationCardLines,
  formationChip,
  formationFacingLine,
  formationLabel,
  formationLegendMark,
  formationLegendRows,
  formationReason,
  formationRow,
  formationTag,
  schematicRing,
  schematicSlots,
  type SchematicSlots,
  type FormationFacts,
  type FormationUnitFact,
} from './formation-model';
import { chipStatus, groupChips, type UnitFacts } from './selection-model';

const ARMOUR = 0;
const INFANTRY = 3;
const SUPPORT = 4;
const MEDIC = 5;
const AIRCRAFT = 6;
const NONE = 255;

const u = (cls: number, free = true, ambulance?: boolean): FormationUnitFact => ({ cls, free, ...(ambulance ? { ambulance } : {}) });
const facts = (units: FormationUnitFact[], formationsOpen = true): FormationFacts => ({ formationsOpen, units });
/** The mock's mixed selection: 3 armour, 5 infantry, 1 support weapon, 1 medic, 1 aircraft. */
const MIXED = [...Array(3).fill(ARMOUR), ...Array(5).fill(INFANTRY), SUPPORT, MEDIC, AIRCRAFT].map((c: number) => u(c));

afterEach(() => setCatalogue('en', en));

describe('formationRow: when it draws', () => {
  it('is absent for one unit, and for units of no class', () => {
    expect(formationRow(facts([u(INFANTRY)]), null)).toEqual([]);
    expect(formationRow(facts([u(INFANTRY), u(NONE)]), null)).toEqual([]);
    expect(formationRow(facts([]), null)).toEqual([]);
  });

  it('draws three buttons, Column then Attack then Ambush, for the mock\'s mixed selection, all active', () => {
    expect(formationRow(facts(MIXED), null)).toEqual([
      { id: 'column', labelKey: 'formation.column.name', key: 'formationColumn', family: 'manoeuvre', armed: false, inert: false },
      { id: 'attack', labelKey: 'formation.attack.name', key: 'formationAttack', family: 'offensive', armed: false, inert: false },
      { id: 'ambush', labelKey: 'formation.ambush.name', key: 'formationAmbush', family: 'control', armed: false, inert: false },
    ]);
  });

  it('marks exactly the armed formation', () => {
    expect(formationRow(facts(MIXED), 'attack').map((v) => v.armed)).toEqual([false, true, false]);
    expect(formationRow(facts(MIXED), 'ambush').map((v) => v.armed)).toEqual([false, false, true]);
    expect(formationRow(facts(MIXED), null).map((v) => v.armed)).toEqual([false, false, false]);
  });
});

describe('formationRow: why a button is inert', () => {
  it('two units with one garrisoned: every button needs two free units', () => {
    const row = formationRow(facts([u(INFANTRY), u(INFANTRY, false)]), null);
    expect(row.map((v) => [v.inert, v.reasonKey])).toEqual([
      [true, 'hud.formation.inert.needsMin'],
      [true, 'hud.formation.inert.needsMin'],
      [true, 'hud.formation.inert.needsMin'],
    ]);
  });

  it('names the formation\'s own minimum, and words it from the catalogue (M10)', () => {
    const row = formationRow(facts([u(INFANTRY), u(INFANTRY, false)]), null);
    expect(row.map((v) => v.reasonParams)).toEqual([{ n: 2 }, { n: 2 }, { n: 2 }]);
    expect(row.map((v) => formationReason(v))).toEqual(Array(3).fill('Needs 2 free units'));
    expect(formations.map((f) => f.min_members)).toEqual([2, 2, 2]);
    // The versus and ambush reasons carry no parameters.
    expect(formationRow(facts(MIXED, false), null).map((v) => v.reasonParams)).toEqual([undefined, undefined, undefined]);
  });

  it('two helicopters: column and attack are active, the ambush has no ground to ring the zone', () => {
    const row = formationRow(facts([u(AIRCRAFT), u(AIRCRAFT)]), null);
    expect(row.map((v) => v.inert)).toEqual([false, false, true]);
    expect(row[2].reasonKey).toBe('hud.formation.inert.ambushNoGround');
    expect(row[0].reasonKey).toBeUndefined();
  });

  it('a free ground unit among aircraft opens the ambush; a garrisoned one does not', () => {
    expect(formationRow(facts([u(AIRCRAFT), u(INFANTRY)]), null)[2].inert).toBe(false);
    expect(formationRow(facts([u(AIRCRAFT), u(AIRCRAFT), u(INFANTRY, false)]), null)[2].reasonKey).toBe('hud.formation.inert.ambushNoGround');
  });

  it('a medic and an aircraft do not ring the zone', () => {
    expect(formationRow(facts([u(MEDIC), u(AIRCRAFT)]), null)[2].reasonKey).toBe('hud.formation.inert.ambushNoGround');
  });
});

describe('formationRow: versus rooms (formations off until P1b)', () => {
  it('still draws, every button inert with the versus reason', () => {
    const row = formationRow(facts(MIXED, false), 'attack');
    expect(row).toHaveLength(3);
    expect(row.map((v) => [v.inert, v.reasonKey])).toEqual([
      [true, 'hud.formation.inert.versus'],
      [true, 'hud.formation.inert.versus'],
      [true, 'hud.formation.inert.versus'],
    ]);
  });

  it('the versus reason outranks needsMin and ambushNoGround', () => {
    expect(formationRow(facts([u(INFANTRY), u(INFANTRY, false)], false), null).map((v) => v.reasonKey)).toEqual(Array(3).fill('hud.formation.inert.versus'));
    expect(formationRow(facts([u(AIRCRAFT), u(AIRCRAFT)], false), null)[2].reasonKey).toBe('hud.formation.inert.versus');
  });

  it('is still absent for one unit', () => {
    expect(formationRow(facts([u(INFANTRY)], false), null)).toEqual([]);
  });
});

describe('labels are accessors, resolved when asked (the ROLE_LABEL lesson)', () => {
  it('follows the active catalogue between two calls', () => {
    expect(formationLabel('column')).toBe('Column');
    setCatalogue('xx', { ...en, 'formation.column.name': 'KOLONNE', 'hud.formation.tag': 'AUFSTELLUNG', 'hud.formation.arm.attack': 'ANGRIFF' });
    expect(formationLabel('column')).toBe('KOLONNE');
    expect(formationTag()).toBe('AUFSTELLUNG');
    expect(formationArmNote('attack')).toBe('ANGRIFF');
    setCatalogue('en', en);
    expect(formationLabel('column')).toBe('Column');
  });

  it('reads the English strings the mock approved', () => {
    expect([formationLabel('column'), formationLabel('attack'), formationLabel('ambush')]).toEqual(['Column', 'Attack', 'Ambush']);
    expect(formationTag()).toBe('Formation');
    expect(formationArmNote('column')).toBe('column — click open ground (Esc cancels)');
    expect(formationArmNote('attack')).toBe('attack formation — click the objective (Esc cancels)');
    expect(formationArmNote('ambush')).toBe('ambush — click the kill zone (Esc cancels)');
    const row = formationRow(facts([u(AIRCRAFT), u(AIRCRAFT)]), null);
    expect(formationReason(row[2])).toBe('Needs ground units to ring the zone');
    expect(formationReason(row[0])).toBeNull();
    const one = formationRow(facts([u(INFANTRY), u(INFANTRY, false)]), null);
    expect(formationReason(one[0])).toBe('Needs 2 free units');
    expect(formationBlurb('ambush')).toBe('Ring the clicked ground and hold. Armed units fire on what they can reach.');
  });

  it('every key a view names is in the catalogue', () => {
    const views = [...formationRow(facts(MIXED, false), null), ...formationRow(facts([u(AIRCRAFT), u(AIRCRAFT)]), null), ...formationRow(facts([u(INFANTRY), u(INFANTRY, false)]), null)];
    const catalogue = en as Record<string, string>;
    for (const v of views) {
      expect(catalogue[v.labelKey]).toBeTruthy();
      if (v.reasonKey !== undefined) expect(catalogue[v.reasonKey]).toBeTruthy();
    }
  });
});

describe('classCounts', () => {
  it('counts by legend class, ignores class none, and tells an ambulance from a medic', () => {
    expect(classCounts([{ cls: ARMOUR }, { cls: ARMOUR }, { cls: INFANTRY }, { cls: MEDIC }, { cls: MEDIC, ambulance: true }, { cls: NONE }, { cls: AIRCRAFT }])).toEqual({
      armour: 2,
      light_vehicle: 0,
      recon: 0,
      infantry: 1,
      support_weapon: 0,
      medic: 1,
      ccp: 1,
      aircraft: 1,
    });
  });
});

describe('schematicSlots is the sim\'s templateOffsets over the compiled shipped formation', () => {
  const COUNTS = { armour: 3, infantry: 5, support_weapon: 1, medic: 1, aircraft: 1 };
  const CLASS_CODES = [ARMOUR, ARMOUR, ARMOUR, INFANTRY, INFANTRY, INFANTRY, INFANTRY, INFANTRY, SUPPORT, MEDIC, AIRCRAFT];
  const NAMES = ['armour', 'light_vehicle', 'recon', 'infantry', 'support_weapon', 'medic', 'aircraft'];
  for (const id of ['column', 'attack', 'ambush'] as const) {
    it(`${id}: slot for slot, from the data file compiled here`, () => {
      const file = formations.find((f) => f.id === id);
      if (file === undefined) throw new Error(`no ${id}`);
      const want = templateOffsets(compileFormation(file), CLASS_CODES).map((s) => ({ cls: NAMES[s.cls], forward: s.forward, lateral: s.lateral }));
      expect(want).toHaveLength(11);
      expect(schematicSlots(id, COUNTS)).toEqual(want);
    });
  }

  it('literal witnesses: the attack puts the three armour abreast on the click, the ambush rings nine at radius 3', () => {
    const attack = schematicSlots('attack', COUNTS);
    expect(attack.slice(0, 3)).toEqual([
      { cls: 'armour', forward: 0, lateral: 0 },
      { cls: 'armour', forward: 0, lateral: 2 },
      { cls: 'armour', forward: 0, lateral: -2 },
    ]);
    const ambush = schematicSlots('ambush', COUNTS);
    expect(ambush.filter((s) => s.cls === 'armour' || s.cls === 'infantry' || s.cls === 'support_weapon')).toHaveLength(9);
    expect(schematicRing('ambush', ambush)).toBe(3);
    expect(schematicRing('column', schematicSlots('column', COUNTS))).toBe(0);
  });

  it('an ambulance takes a medic slot after the medics, named ccp', () => {
    const slots = schematicSlots('column', { ...COUNTS, ccp: 1 });
    expect(slots.filter((s) => s.cls === 'medic')).toEqual([{ cls: 'medic', forward: -10, lateral: 0 }]);
    expect(slots.filter((s) => s.cls === 'ccp')).toEqual([{ cls: 'ccp', forward: -12, lateral: 0 }]);
  });

  it('is empty for nobody', () => {
    expect(schematicSlots('attack', {})).toEqual([]);
  });
});

describe('the legend', () => {
  it('lists present classes in class order with their counts, ambulances as Ambulance', () => {
    expect(formationLegendRows({ infantry: 5, armour: 3, medic: 1, ccp: 1, aircraft: 0 })).toEqual([
      { cls: 'armour', label: 'Armour', n: 3 },
      { cls: 'infantry', label: 'Infantry', n: 5 },
      { cls: 'medic', label: 'Medic', n: 1 },
      { cls: 'ccp', label: 'Ambulance', n: 1 },
    ]);
  });

  it('marks the attack\'s click and the ambush\'s kill zone, not the column', () => {
    expect(formationLegendMark('attack')).toEqual({ mark: 'click', label: 'Your click' });
    expect(formationLegendMark('ambush')).toEqual({ mark: 'killZone', label: 'Kill zone' });
    expect(formationLegendMark('column')).toBeNull();
  });

  it('closes with the lines the compiled file composes: face, drill (halt too), pace, ring, and what its on-call elements answer', () => {
    // Column: halt (P1a left it unsaid), a pace, a medic and an aircraft element on call.
    expect(formationFacingLine('column')).toBe(
      'Faces the way you march. Halts and returns fire on contact. Moves at the pace of its slowest ground unit. Medics go to a man who goes down. Aircraft answer a contact.'
    );
    expect(formationFacingLine('attack')).toBe(
      'Faces the approach. Then press on, fighting. Medics go to a man who goes down. Aircraft answer a contact.'
    );
    expect(formationFacingLine('ambush')).toBe(
      'Faces inward. Springs together on contact. Moves at the pace of its slowest ground unit. Ring radius grows with the force. Medics go to a man who goes down. Aircraft answer a contact.'
    );
  });

  it('each clause is the file\'s fact: a clause per call, once, in the file\'s element order', () => {
    const calls = (id: 'column' | 'attack' | 'ambush'): string[] =>
      formations.find((f) => f.id === id)!.elements.flatMap((el) => (el.on_call !== undefined && el.on_call !== 'none' ? [el.on_call] : []));
    // Medic first, aircraft after, in all three files: the tooltip's order follows.
    for (const id of ['column', 'attack', 'ambush'] as const) expect(calls(id), id).toEqual(['casualty', 'contact']);
    // P1c (GH-859): the Attack keeps no pace (its members walk at their own speeds between checkpoints), so its line above has no
    // pace clause; the Column and the Ambush keep theirs.
    expect(['column', 'attack', 'ambush'].map((id) => formations.find((f) => f.id === id)!.march!.pace)).toEqual(['slowest_ground', 'none', 'slowest_ground']);
  });
});

describe('card lines (Q1, cut to what P1a makes true)', () => {
  it('says what a member is doing', () => {
    expect(formationCardLines({ id: 'column', phase: 'marching' })).toEqual([{ text: 'In column', dim: false }]);
    expect(formationCardLines({ id: 'attack', phase: 'set' })).toEqual([{ text: 'In attack formation', dim: false }]);
    expect(formationCardLines({ id: 'ambush', phase: 'marching' })).toEqual([{ text: 'Moving to the ambush', dim: false }]);
    expect(formationCardLines({ id: 'ambush', phase: 'sprung' })).toEqual([{ text: 'Ambush sprung', dim: false }]);
  });

  it('a set ambush adds its ring radius in the dim ink, when known', () => {
    expect(formationCardLines({ id: 'ambush', phase: 'set', radius: 4 })).toEqual([
      { text: 'Ambush set — springs together', dim: false },
      { text: 'Ring radius 4', dim: true },
    ]);
    expect(formationCardLines({ id: 'ambush', phase: 'set' })).toEqual([{ text: 'Ambush set — springs together', dim: false }]);
  });
});

describe('card lines: the march and the calls (P1b)', () => {
  it('a marching Column or Attack names its checkpoint; one checkpoint keeps the plain line', () => {
    expect(formationCardLines({ id: 'column', phase: 'marching', cp: { n: 2, m: 4 } })).toEqual([{ text: 'In column — checkpoint 2 of 4', dim: false }]);
    expect(formationCardLines({ id: 'attack', phase: 'marching', cp: { n: 3, m: 3 } })).toEqual([{ text: 'In attack formation — checkpoint 3 of 3', dim: false }]);
    expect(formationCardLines({ id: 'column', phase: 'marching' })).toEqual([{ text: 'In column', dim: false }]);
    expect(formationCardLines({ id: 'attack', phase: 'marching' })).toEqual([{ text: 'In attack formation', dim: false }]);
  });

  it('contact replaces the march line: a halted Column, an Attack pressing on', () => {
    expect(formationCardLines({ id: 'column', phase: 'marching', contact: true })).toEqual([{ text: 'Column in contact', dim: false }]);
    expect(formationCardLines({ id: 'attack', phase: 'marching', contact: true })).toEqual([{ text: 'In contact — pressing on', dim: false }]);
    // Contact outranks a checkpoint the view might still carry.
    expect(formationCardLines({ id: 'column', phase: 'marching', contact: true, cp: { n: 2, m: 4 } })).toEqual([{ text: 'Column in contact', dim: false }]);
  });

  it('the pace line is dim and names the unit (escaped), the call line follows', () => {
    expect(formationCardLines({ id: 'column', phase: 'marching', cp: { n: 1, m: 3 }, pace: { pace: '0.7', unit: 'Sniper <team>' }, call: 'onCall' })).toEqual([
      { text: 'In column — checkpoint 1 of 3', dim: false },
      { text: 'Pace 0.7 t/s, set by Sniper &lt;team&gt;', dim: true },
      { text: 'On call', dim: false },
    ]);
    expect(formationCardLines({ id: 'column', phase: 'marching', call: 'answering' }).map((l) => l.text)).toEqual(['In column', 'Answering a call']);
  });

  it('an ambush standing with no stance has only what it answers; the degraded view says so', () => {
    expect(formationCardLines({ id: 'ambush', phase: 'standing' })).toEqual([]);
    expect(formationCardLines({ id: 'ambush', phase: 'standing', call: 'onCall' })).toEqual([{ text: 'On call', dim: false }]);
    expect(formationCardLines({ degraded: true })).toEqual([{ text: 'In formation (no march)', dim: false }]);
  });

  it('who answers a call: aircraft that do not stay, on a contact element; a foot medic, on a casualty one; never an ambulance', () => {
    const cases: [string, Parameters<typeof formationAnswersCall>, boolean][] = [
      ['a gunship in a Column', ['column', { cls: AIRCRAFT, air: true, stays: false, ambulance: false }], true],
      ['a seated helicopter', ['column', { cls: AIRCRAFT, air: true, stays: true, ambulance: false }], false],
      ['a medic squad in an Attack', ['attack', { cls: MEDIC, air: false, stays: false, ambulance: false }], true],
      ['an ambulance', ['attack', { cls: MEDIC, air: false, stays: false, ambulance: true }], false],
      ['a medevac helicopter (class aircraft)', ['ambush', { cls: AIRCRAFT, air: true, stays: false, ambulance: false }], true],
      ['a rifle squad', ['column', { cls: INFANTRY, air: false, stays: false, ambulance: false }], false],
      ['a unit of no class', ['column', { cls: NONE, air: false, stays: false, ambulance: false }], false],
    ];
    expect(cases).toHaveLength(7);
    for (const [name, args, want] of cases) expect(formationAnswersCall(...args), name).toBe(want);
  });
});

describe('M3: the schematic draws the ring the order would place', () => {
  it('the radius comes from templateOffsets: 6 -> 3, 17 -> 4, 32 -> 6; a Column has none', () => {
    const ring = (n: number): number => schematicRing('ambush', schematicSlots('ambush', { infantry: n }));
    expect([6, 17, 32].map(ring)).toEqual([3, 4, 6]);
    expect(schematicRing('column', schematicSlots('column', { infantry: 6 }))).toBe(0);
    expect(schematicRing('attack', schematicSlots('attack', { infantry: 6 }))).toBe(0);
  });

  it('a ring of radius 8 is drawn at 8 (a retuned file is a JSON edit, not a code change); the property survives and stays out of equality', () => {
    // Six ring-class slots on the radius-8 ring, carrying the radius the way templateOffsets' list does.
    const slots = ringTiles(8)
      .slice(0, 6)
      .map(([f, l]) => ({ cls: 'infantry' as const, forward: f, lateral: l }));
    const fixture = Object.defineProperty(slots, 'ringRadius', { value: 8, enumerable: false }) as SchematicSlots;
    expect(schematicRing('ambush', fixture)).toBe(8);
    // Without the property there is no ring to draw.
    expect(schematicRing('ambush', slots.map((s) => s) as SchematicSlots)).toBe(0);
    // A plain deep-equal against the slots still holds (P1a's tests compare schematicSlots with a literal list).
    expect(schematicSlots('ambush', { infantry: 3 })).toEqual(schematicSlots('ambush', { infantry: 3 }).map((s) => ({ ...s })));
  });
});

describe('the chip line', () => {
  it('names the formation most of the chip is in', () => {
    expect(formationChip({ column: 5 })).toBe('5 in column');
    expect(formationChip({ attack: 3 })).toBe('3 in attack formation');
    expect(formationChip({ ambush: 2 })).toBe('2 in ambush');
    expect(formationChip({ column: 1, ambush: 4 })).toBe('4 in ambush');
    expect(formationChip({ column: 2, attack: 2 })).toBe('2 in column');
  });

  it('a marching group adds its checkpoint: "6 in column · cp 2/4"', () => {
    expect(formationChip({ column: 6, cp: { column: { k: 2, m: 4 } } })).toBe('6 in column · cp 2/4');
    expect(formationChip({ attack: 3, cp: { attack: { k: 1, m: 3 } } })).toBe('3 in attack formation · cp 1/3');
    // The checkpoint belongs to the formation the chip names.
    expect(formationChip({ column: 1, ambush: 4, cp: { column: { k: 2, m: 4 } } })).toBe('4 in ambush');
    expect(formationChip({ column: 5 })).toBe('5 in column');
  });

  it('groupChips keeps the earliest checkpoint among a chip\'s marching groups', () => {
    const unit = (k?: number): UnitFacts => ({
      typeId: 'inf_squad', name: 'Rifle Squad', bucket: 'soft', hp: 100, hpMax: 100, routed: false, pinned: false, moving: true, aboard: false, onLoan: false, own: true,
      formation: 'column',
      ...(k !== undefined ? { formationCp: { k, m: 4 } } : {}),
    });
    expect(groupChips([unit(3), unit(2), unit(2), unit()])[0].status).toBe('4 in column · cp 2/4');
    expect(groupChips([unit(), unit()])[0].status).toBe('2 in column');
  });

  it('is null when no unit is in one', () => {
    expect(formationChip(undefined)).toBeNull();
    expect(formationChip({})).toBeNull();
    expect(formationChip({ column: 0 })).toBeNull();
  });
});

describe('chipStatus precedence: formation sits after APS and before moving; combat states still win', () => {
  const base = { count: 4, routed: 0, pinned: 0, aboard: 0, moving: 0 };
  const inColumn = { column: 4 };

  it('beats moving and holding', () => {
    expect(chipStatus({ ...base, moving: 4, formation: inColumn }).status).toBe('4 in column');
    expect(chipStatus({ ...base, formation: { ambush: 3 } }).status).toBe('3 in ambush');
  });

  it('loses to APS and to aboard', () => {
    expect(chipStatus({ ...base, aps: { ammo: 3, magazine: 4 }, formation: inColumn }).status).toBe('APS 3/4');
    expect(chipStatus({ ...base, aboard: 1, formation: inColumn }).status).toBe('1 aboard');
  });

  it('loses to every combat state', () => {
    expect(chipStatus({ ...base, pinned: 1, formation: inColumn }).status).toBe('1 PINNED');
    expect(chipStatus({ ...base, routed: 1, formation: inColumn }).status).toBe('1 BROKEN');
    expect(chipStatus({ ...base, suppressed: 2, formation: inColumn }).status).toBe('2 suppressed');
  });

  it('without a formation nothing changed: moving, then holding', () => {
    expect(chipStatus({ ...base, moving: 2 }).status).toBe('2 moving');
    expect(chipStatus({ ...base }).status).toBe('holding');
  });

  it('groupChips counts the units that stand in a formation', () => {
    const unit = (formation?: 'column' | 'attack' | 'ambush'): UnitFacts => ({
      typeId: 'inf_squad',
      name: 'Rifle Squad',
      bucket: 'soft',
      hp: 100,
      hpMax: 100,
      routed: false,
      pinned: false,
      moving: true,
      aboard: false,
      onLoan: false,
      own: true,
      ...(formation ? { formation } : {}),
    });
    expect(groupChips([unit('column'), unit('column'), unit()])[0].status).toBe('2 in column');
    expect(groupChips([unit(), unit()])[0].status).toBe('2 moving');
  });
});
