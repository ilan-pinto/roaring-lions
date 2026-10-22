// GH-707 P2: the wound half of the service record, measured through the REAL runtime. A fielded
// squad that sees `woundedDown` (parent = it) and `woundRejoined` (squad = it) comes home with
// `wounded_in_action` / `rescued` added to what its ledger entry already carried; one that saw
// neither comes home with NEITHER KEY (so a world without wound content is byte-identical).
// The wound events are synthetic: no shipped unit has `hull.wounds` yet.
import { describe, expect, it } from 'vitest';
import type { LedgerData, SimEvent } from '@lions/sim';
import { missionWorld } from './mission-harness';

const SCARRED = { type: 'inf_squad', veterancy: 1, missions: 2, kills: 3, name: 'Barkai', wounded_in_action: 4, rescued: 1 };
const CLEAN2 = { type: 'inf_squad', veterancy: 0, missions: 1, kills: 0, name: 'Gefen' };
const CLEAN = { type: 'at_team', veterancy: 0, missions: 1, kills: 0, name: 'Tzur' };

describe('roster wound counts through checkEnd', () => {
  it('adds this mission\'s counts to the entry\'s own, and leaves a clean squad keyless', () => {
    const ledger: LedgerData = { 'roster.surviving_units': [{ ...SCARRED }, { ...CLEAN2 }, { ...CLEAN }] };
    const { sim, runtime, runToEnd } = missionWorld('khan_rafid_1_recon', ledger);
    const ids = new Map<string, number>();
    for (let id = 0; id < sim.entityCount; id++) {
      const n = runtime.rosterEntryOf(id)?.name;
      if (n !== undefined) ids.set(n, id);
    }
    const squad = ids.get('Barkai');
    expect(squad, 'the scarred squad was not fielded').toBeDefined();
    const ev = (e: object): SimEvent => ({ tick: 0, ...e }) as SimEvent;
    runtime.step([
      ev({ kind: 'woundedDown', entity: 200, parent: squad, by: 20 }),
      ev({ kind: 'woundedDown', entity: 201, parent: squad, by: 20 }),
      ev({ kind: 'woundedDown', entity: 202, parent: -1, by: 20 }), // the last man: no squad to credit
      // He rejoined ANOTHER squad (999 is not a squad of ours): the credit still goes to his own.
      ev({ kind: 'woundRejoined', entity: 200, squad: 999 }),
      // Unknown man: nobody earns anything.
      ev({ kind: 'woundRejoined', entity: 777, squad }),
    ]);
    const produced = runToEnd()['roster.surviving_units'] ?? [];
    const barkai = produced.find((r) => r.name === 'Barkai');
    expect(barkai).toMatchObject({ missions: 3, wounded_in_action: 6, rescued: 2 });
    // Tzur is an unfielded pool entry here; the clean check that cannot be vacuous is on a
    // second FIELDED squad: any fielded survivor other than Barkai (his own type, if present).
    const tzur = produced.find((r) => r.name === 'Tzur');
    expect(tzur, 'the clean pool entry went missing').toBeDefined();
    expect(Object.keys(tzur ?? {})).not.toContain('wounded_in_action');
    expect(Object.keys(tzur ?? {})).not.toContain('rescued');
    // A second FIELDED squad (Gefen, drawn by the same placement) that saw no wound event.
    expect(ids.get('Gefen'), 'the clean squad was not fielded').toBeDefined();
    const gefen = produced.find((r) => r.name === 'Gefen');
    expect(gefen, 'the clean fielded squad did not come home').toBeDefined();
    expect(Object.keys(gefen ?? {})).not.toContain('wounded_in_action');
    expect(Object.keys(gefen ?? {})).not.toContain('rescued');
  }, 30_000);
});
