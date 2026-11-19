// GH-1383 slice 1, T4: the doctrine picks' cost-curve gate (tools/doctrine_balance.py; the lead's Q6, 19 Nov 2026).
// The bar: |delta| <= 0.005 on the frozen base fit, every priced unit inside +/-18%, KDF picks again at max tier once
// per branch (PR 1584). The gate's own oracle is a LITERAL per pick (T4b), so a gate that reads zero for every input
// fails its own pins; the data mutations are the design's T4c table, each one red.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { doctrinePicks, doctrines, resolveDoctrine } from '@lions/data';

const ROOT = join(__dirname, '..', '..');
const PICKS = join(ROOT, 'data', 'doctrines', 'picks');

interface PriceRow {
  unit: string;
  was: number;
  is: number;
  dev_base: number;
  dev_max: Record<'1' | '2', number>;
}
interface PickRow {
  id: string;
  faction: string;
  menu: string[];
  delta_base: number;
  delta_max: Record<'1' | '2', number>;
  max_gated: boolean;
  neutral_cap: number | null;
  prices: PriceRow[];
}
interface Result {
  fit: { a: number; scale: number; n: number };
  picks: PickRow[];
  failures: string[];
}

function run(picksDir?: string): { status: number | null; result: Result } {
  const args = ['tools/doctrine_balance.py', '--upgrade-cost-factor', '0.02', '--json'];
  if (picksDir) args.push('--picks', picksDir);
  const r = spawnSync('python3', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.error) throw r.error;
  return { status: r.status, result: JSON.parse(r.stdout) as Result };
}

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});
type PickDoc = { id: string; ops: { op: string; unit?: string; logistics?: number }[] };
/** The shipped picks copied to a fresh directory, with `edit` applied to the one named. */
function mutated(id: string, edit: (p: PickDoc) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'rl-doctrine-'));
  scratch.push(dir);
  for (const f of readdirSync(PICKS).filter((x) => x.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(join(PICKS, f), 'utf8')) as PickDoc;
    if (doc.id === id) edit(doc);
    writeFileSync(join(dir, f), JSON.stringify(doc));
  }
  return dir;
}
const price = (p: PickDoc, unit: string): { logistics?: number } => {
  const o = p.ops.find((x) => x.op === 'set_price' && x.unit === unit);
  if (!o) throw new Error(`${p.id} prices no ${unit}`);
  return o;
};

const shipped = run();
const row = (r: Result, id: string): PickRow => {
  const found = r.picks.find((p) => p.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};

describe('the shipped picks pass the cost-curve bar', () => {
  it('exit 0, no failures, all six scored on the base fit validate_balance.py prints', () => {
    expect(shipped.status).toBe(0);
    expect(shipped.result.failures).toEqual([]);
    expect(shipped.result.picks.map((p) => p.id)).toEqual(['kdf_airmobile', 'kdf_armour', 'kdf_urban', 'sarim_militia', 'sarim_raid', 'sarim_standoff']);
    // validate_balance.py on data/units prints `cost = 282.314 * power^0.482 (n=47)`.
    expect(shipped.result.fit.scale).toBeCloseTo(282.314, 3);
    expect(shipped.result.fit.a).toBeCloseTo(0.4818, 4);
    expect(shipped.result.fit.n).toBe(47);
  });

  // T4b: the net values, LITERALS to four decimals. Base tier is design §3.3's column exactly; max tier is per branch
  // since PR 1584 (the design's pre-PR 1584 unbranched column is superseded). Sarim's max-tier column is a reading, not gated.
  const pins: [string, number, number, number, boolean][] = [
    ['kdf_airmobile', +0.0031, -0.0026, -0.0008, true],
    ['kdf_armour', -0.0036, -0.0003, -0.0005, true],
    ['kdf_urban', -0.0009, -0.0011, -0.0014, true],
    ['sarim_militia', -0.0003, +0.0038, +0.0039, false],
    ['sarim_raid', +0.0, +0.009, +0.0094, false],
    ['sarim_standoff', +0.0007, -0.0031, -0.0034, false],
  ];
  for (const [id, base, br1, br2, gated] of pins) {
    it(`${id}: delta ${base} at base, ${br1} and ${br2} at max tier`, () => {
      const r = row(shipped.result, id);
      expect(r.delta_base).toBeCloseTo(base, 4);
      expect(r.delta_max['1']).toBeCloseTo(br1, 4);
      expect(r.delta_max['2']).toBeCloseTo(br2, 4);
      expect(r.max_gated).toBe(gated);
    });
  }

  it('curve deviations at the pick prices match design §3.3 (kdf_armour and sarim_standoff, literals)', () => {
    const dev = (id: string, unit: string) => row(shipped.result, id).prices.find((p) => p.unit === unit)?.dev_base;
    expect(dev('kdf_armour', 'mbt_lavi')).toBeCloseTo(-0.132, 3);
    expect(dev('kdf_armour', 'ifv_namer')).toBeCloseTo(-0.107, 3);
    expect(dev('sarim_standoff', 'sarim_rifles')).toBeCloseTo(0.151, 3);
  });

  it("the neutral caps it prints are the picks' caps (42, 35, 35, 44, 44, 56)", () => {
    expect(shipped.result.picks.map((p) => p.neutral_cap)).toEqual([35, 42, 35, 44, 44, 56]);
  });

  it("its menus are @lions/data's resolveDoctrine menus", () => {
    for (const p of shipped.result.picks) {
      const pick = doctrinePicks[p.id];
      expect(pick, p.id).toBeDefined();
      if (pick) expect(p.menu, p.id).toEqual([...resolveDoctrine(doctrines[pick.extends], pick).menu]);
    }
  });
});

describe('T4c: data mutations, each red', () => {
  it("kdf_armour's mbt_lavi 860 -> 760: delta +0.0088 and the Lavi at -23.3% (red twice)", () => {
    const { status, result } = run(mutated('kdf_armour', (p) => { price(p, 'mbt_lavi').logistics = 760; }));
    expect(status).toBe(1);
    expect(row(result, 'kdf_armour').delta_base).toBeCloseTo(0.0088, 4);
    expect(result.failures.some((f) => f.includes('kdf_armour') && f.includes('+0.0088 at base tier'))).toBe(true);
    expect(result.failures.some((f) => f.includes('mbt_lavi at 760 is -23.3% off the curve'))).toBe(true);
  });

  it('sarim_raid without its two price rises: delta +0.0167', () => {
    const { status, result } = run(
      mutated('sarim_raid', (p) => { p.ops = p.ops.filter((o) => o.unit !== 'gun_truck' && o.unit !== 'manpad_team'); }),
    );
    expect(status).toBe(1);
    expect(row(result, 'sarim_raid').delta_base).toBeCloseTo(0.0167, 4);
    expect(result.failures.some((f) => f.includes('sarim_raid') && f.includes('+0.0167 at base tier'))).toBe(true);
  });

  it('sarim_militia with no prices at all: delta -0.0059', () => {
    const { status, result } = run(mutated('sarim_militia', (p) => { p.ops = p.ops.filter((o) => o.op !== 'set_price'); }));
    expect(status).toBe(1);
    expect(row(result, 'sarim_militia').delta_base).toBeCloseTo(-0.0059, 4);
  });

  it("sarim_standoff's sarim_rifles 355 -> 370: delta -0.0062 and +20.0% (red twice)", () => {
    const { status, result } = run(mutated('sarim_standoff', (p) => { price(p, 'sarim_rifles').logistics = 370; }));
    expect(status).toBe(1);
    expect(row(result, 'sarim_standoff').delta_base).toBeCloseTo(-0.0062, 4);
    expect(result.failures.some((f) => f.includes('sarim_rifles at 370 is +20.0% off the curve'))).toBe(true);
  });

  it('a KDF pick is gated at max tier on its own: kdf_urban mbt_lavi 915 -> 980 fails both branches', () => {
    const { status, result } = run(mutated('kdf_urban', (p) => { price(p, 'mbt_lavi').logistics = 980; }));
    expect(status).toBe(1);
    expect(result.failures.some((f) => f.includes('kdf_urban') && f.includes('max tier, branch 1'))).toBe(true);
    expect(result.failures.some((f) => f.includes('kdf_urban') && f.includes('max tier, branch 2'))).toBe(true);
  });

  it('an empty picks directory is a failure, never a vacuous pass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-doctrine-'));
    scratch.push(dir);
    const { status, result } = run(dir);
    expect(status).toBe(1);
    expect(result.failures).toEqual(['no doctrine picks to score (an empty directory passes nothing)']);
  });
});
