// Mobility kills (#706): `mobility.gear` pinned against the running-gear recipes,
// both ways. Spec docs/superpowers/specs/2026-10-22-mobility-kills-design.md §3.2.
//
// A recipe (tools/src/meshes/running-gear-recipes.ts) is the measured truth about
// what a hull rolls on: one with a `track` is `tracks` (the Namer's road wheels sit
// inside its track), one with wheels and no track is `wheels`. The unit JSON is
// read off disk, every file under data/units/, so a hull added without its gear
// cannot slip past a hand-kept list. Air types ignore gear and are skipped.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUNNING_GEAR_RECIPES } from './meshes/running-gear-recipes';

interface UnitFile {
  id: string;
  mobility: { domain?: string; gear?: string };
}

const UNITS_DIR = join(__dirname, '../../data/units');

function allUnits(): UnitFile[] {
  const out: UnitFile[] = [];
  for (const dir of readdirSync(UNITS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of readdirSync(join(UNITS_DIR, dir.name))) {
      if (f.endsWith('.json')) out.push(JSON.parse(readFileSync(join(UNITS_DIR, dir.name, f), 'utf8')) as UnitFile);
    }
  }
  return out;
}

const gearOf = (u: UnitFile): string => u.mobility.gear ?? 'tracks';
const recipeGear = (id: string): 'tracks' | 'wheels' | undefined => {
  const r = RUNNING_GEAR_RECIPES[id];
  if (r === undefined) return undefined;
  return r.track !== undefined ? 'tracks' : r.wheels.length > 0 ? 'wheels' : undefined;
};

describe('mobility.gear vs the running-gear recipes (#706)', () => {
  const units = allUnits().filter((u) => u.mobility.domain !== 'air');

  it('every recipe vehicle with a unit declares the gear its recipe describes', () => {
    const checked: string[] = [];
    for (const u of units) {
      const want = recipeGear(u.id);
      if (want === undefined) continue;
      expect(`${u.id}: ${gearOf(u)}`).toBe(`${u.id}: ${want}`);
      checked.push(u.id);
    }
    // Not vacuous: the fifteen ground hulls with a recipe and a unit file (the ten,
    // plus GH-709's `veh_ambulance`, `mbt_lavi_camo`, `spg_long_range` and `spg_cluster`)
    // (officer_armour has a recipe and no unit; it is a held mesh).
    expect(checked.sort()).toEqual([
      'apc_eitan', 'apc_kipod', 'dozer_d9', 'gun_truck', 'ifv_namer', 'jeep_shoded',
      'mbt_lavi', 'mbt_lavi_camo', 'rocket_battery', 'scout_shachaf', 'spg_cluster', 'spg_long_range', 'technical',
      'veh_ambulance',
    ]);
  });

  it('every unit declaring wheels has a wheels-only recipe', () => {
    const wheels = units.filter((u) => u.mobility.gear === 'wheels').map((u) => u.id);
    for (const id of wheels) expect(`${id}: ${recipeGear(id) ?? 'no recipe'}`).toBe(`${id}: wheels`);
    expect(wheels.length).toBe(7);
  });
});
