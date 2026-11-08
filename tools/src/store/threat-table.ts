// GENERATED OUTPUT, NEVER HAND-EDITED: this file writes
// packages/app/src/ui/generated/threat-table.json (`pnpm store:threats`).
// JSON carries no comment, so this header is the "do not edit" note, and
// tools/src/store_threat_table.test.ts regenerates and compares (GH-1076, D4).
//
// For every KDF unit type, the sorted ids of the enemy types that can hurt it,
// asked of a headless Sim's own `focusHurts` (the same rule the right-click
// attack order uses), never re-derived. Base JSON, tier 0. The KDF unit
// presents its SIDE plate: it faces 90 degrees (16384 of 65536) with the
// shooter due east four tiles away, so the bearing is 0 and rel = 16384, which
// lies strictly between ARC_60 and ARC_120 (R0.9). `focusHurts` tests no range.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, unitTypeFromJson, type UnitTypeJson } from '../../../packages/sim/src/sim';
import { fx } from '../../../packages/sim/src/fixed';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const KDF_DIR = resolve(ROOT, 'data/units/kdf');
const ENEMY_DIR = resolve(ROOT, 'data/units/enemy');
export const THREAT_TABLE_PATH = resolve(ROOT, 'packages/app/src/ui/generated/threat-table.json');

/** Tile of the KDF unit, the shooter, and the KDF unit's facing in turns x 65536 (90 degrees). */
const KDF_TILE = 6;
const SHOOTER_TILE = 10;
const ROW = 8;
const SIDE_FACING = 16384;

function readDir(dir: string): UnitTypeJson[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as UnitTypeJson);
}

interface Pair {
  /** What `focusHurts(enemy, kdf)` answered. */
  hurts: boolean;
  /** `presentedArc` straight after the call: 0 front, 1 side, 2 rear. The scratch `focusHurts` documents writing. */
  arc: number;
}

/** One headless Sim, one pair, no tick: `focusHurts` is a read. Exported for the test. */
export function askPair(enemy: UnitTypeJson, kdf: UnitTypeJson, kdfFacing = SIDE_FACING): Pair {
  const sim = new Sim({ seed: 1, width: 16, height: 16, capacity: 2 });
  const kdfType = sim.addUnitType(kdf);
  const enemyType = sim.addUnitType(enemy);
  const target = sim.spawn(kdfType, 0, fx.from(KDF_TILE + 0.5), fx.from(ROW + 0.5), kdfFacing);
  const shooter = sim.spawn(enemyType, 1, fx.from(SHOOTER_TILE + 0.5), fx.from(ROW + 0.5), 0);
  // R0.9: focusHurts picks the air or ground weapon slot from isAirborne(target).
  // A landed aircraft would answer the ground slots and list rifles as a threat.
  const wantAir = unitTypeFromJson(kdf).isAir;
  if (sim.isAirborne(target) !== wantAir) {
    throw new Error(`threat table: ${kdf.id} isAir=${wantAir} but isAirborne=${sim.isAirborne(target)}`);
  }
  const hurts = sim.focusHurts(shooter, target);
  const arc = (sim as unknown as { presentedArc: number }).presentedArc;
  return { hurts, arc };
}

export function buildThreatTable(): Record<string, string[]> {
  const kdf = readDir(KDF_DIR);
  const enemies = readDir(ENEMY_DIR).filter(
    (e) => e.role !== 'wounded' && ((e as { weapons?: unknown[] }).weapons ?? []).length > 0,
  );
  const out: Record<string, string[]> = {};
  for (const k of [...kdf].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    out[k.id] = enemies
      .filter((e) => askPair(e, k).hurts)
      .map((e) => e.id)
      .sort();
  }
  return out;
}

const invoked = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const table = buildThreatTable();
  writeFileSync(THREAT_TABLE_PATH, JSON.stringify(table, null, 2) + '\n');
  console.log(`wrote ${THREAT_TABLE_PATH} (${Object.keys(table).length} KDF types)`);
}
