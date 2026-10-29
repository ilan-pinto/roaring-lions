/**
 * The formation row model (GH-859 P1a). Oracles are literals: class codes are the sim's documented
 * indices (0 armour, 1 light vehicle, 2 recon, 3 infantry, 4 support weapon, 5 medic, 6 aircraft,
 * 255 none), reasons and keys are the catalogue's own strings, and the schematic is compared with the
 * sim's `templateOffsets` over a formation compiled HERE from the data files, not through the model.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { formations } from '@lions/data';
import { compileFormation, templateOffsets } from '@lions/sim';
import en from '../i18n/en.json';
import { setCatalogue } from '../i18n/t';
import {
  classCounts,
  formationArmNote,
  formationBlurb,
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
      [true, 'hud.formation.inert.needsTwo'],
      [true, 'hud.formation.inert.needsTwo'],
      [true, 'hud.formation.inert.needsTwo'],
    ]);
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

  it('the versus reason outranks needsTwo and ambushNoGround', () => {
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
    expect(formationReason(one[0])).toBe('Needs two free units');
    expect(formationBlurb('ambush')).toBe('Ring the clicked ground and hold. Every unit opens fire together.');
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

  it('closes with the way the formation faces, from its file', () => {
    expect(formationFacingLine('column')).toBe('Faces the way you march.');
    expect(formationFacingLine('attack')).toBe('Faces the approach. Then press on, fighting.');
    expect(formationFacingLine('ambush')).toBe('Faces inward. Ring radius grows with the force.');
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

describe('the chip line', () => {
  it('names the formation most of the chip is in', () => {
    expect(formationChip({ column: 5 })).toBe('5 in column');
    expect(formationChip({ attack: 3 })).toBe('3 in attack formation');
    expect(formationChip({ ambush: 2 })).toBe('2 in ambush');
    expect(formationChip({ column: 1, ambush: 4 })).toBe('4 in ambush');
    expect(formationChip({ column: 2, attack: 2 })).toBe('2 in column');
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
