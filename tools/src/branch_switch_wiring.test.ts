// GH-1384: the branch switch reaches production through its DEFAULT, as `COINS_COSMETIC_ONLY` does (GH-1415's
// coin-switch-wiring.test.ts). `applyUpgrades`, `tierPatch` and `parseStartInputs` take the switch as a trailing `open`
// argument that only a test passes: a literal `true` in a production call would open branching there alone, and no behaviour
// test of the closed build could see it, since the closed build reads the envelope whatever the picks. So this is the source
// guard, over every non-test source file under packages/, plus the one list of production files allowed to NAME the switch.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('dist')) continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** The top-level arguments of every call `name(...)` in `src` (not a declaration), split at depth-0 commas. */
function callArgs(src: string, name: string): string[][] {
  const out: string[][] = [];
  const re = new RegExp(`(?<!function )\\b${name}\\(`, 'g');
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const args: string[] = [];
    let depth = 0;
    let cur = '';
    for (let i = m.index + m[0].length; i < src.length; i++) {
      const c = src[i];
      if (depth === 0 && c === ')') break;
      if ('([{'.includes(c)) depth++;
      if (')]}'.includes(c)) depth--;
      if (depth === 0 && c === ',') {
        args.push(cur.trim());
        cur = '';
      } else cur += c;
    }
    if (cur.trim() !== '') args.push(cur.trim());
    out.push(args);
  }
  return out;
}

const FILES = sources(join(ROOT, 'packages')).map((f) => ({ file: relative(ROOT, f), src: readFileSync(f, 'utf8') }));
/** The switch's own module, its readers' modules in data and economy, the resume record, the replay start (`replayStartPicks`),
 *  the room path's three readers (GH-1384, the net slice), the spend route's one read (the member coin path) and the account
 *  route table, which registers the member's Switch and Return only while the switch is open. */
const MAY_NAME_THE_SWITCH = new Set([
  'packages/data/src/branches-open.ts',
  'packages/data/src/upgrades.ts',
  'packages/data/src/index.ts',
  'packages/economy/src/branches.ts',
  'packages/economy/src/brigade.ts',
  'packages/economy/src/wallet.ts',
  'packages/app/src/mission-resume.ts',
  'packages/app/src/feedback/replay.ts',
  // GH-1384, the net slice: the room claim (`roomClaim`), the seat world (`seatKitPicksOf`), and the Worker's one read
  // for the room routes, meta and mint (`picksOpen`).
  'packages/app/src/net/connect.ts',
  'packages/app/src/net/match-world.ts',
  'packages/worker/src/match/room-fields.ts',
  // GH-1384, the member coin path: the spend route reads `branch` off a body only while the switch is open.
  'packages/worker/src/account/spend.ts',
  // GH-1384, the member's Switch and Return: the account route table registers them only while the switch is open.
  'packages/worker/src/account/routes.ts',
]);
/** The most arguments a production call may pass: one fewer than the signature, so `open` is always the default. */
const MAX_ARGS: Record<string, number> = { applyUpgrades: 3, tierPatch: 2, parseStartInputs: 1, replayStartPicks: 1, roomClaim: 2, seatKitPicksOf: 3 };

describe('the branch switch reaches production through its default (GH-1384)', () => {
  it('no production call passes `open`', () => {
    const over: string[] = [];
    let seen = 0;
    for (const { file, src } of FILES) {
      for (const [name, max] of Object.entries(MAX_ARGS)) {
        for (const args of callArgs(src, name)) {
          seen++;
          // The one forward allowed: `applyUpgrades` handing its own `open` parameter on to `tierPatch`, in their module.
          const forwarded = file === 'packages/data/src/upgrades.ts' && args.length === max + 1 && args[max] === 'open';
          if (args.length > max && !forwarded) over.push(`${file}: ${name}(${args.join(', ')})`);
        }
      }
    }
    expect(seen).toBeGreaterThan(10); // the guard read real calls
    expect(over).toEqual([]);
  });
  it('only the listed modules name BRANCHES_OPEN, and only data/branches-open.ts assigns it', () => {
    const naming = FILES.filter(({ src }) => /\bBRANCHES_OPEN\b/.test(src)).map(({ file }) => file).sort();
    expect(naming.filter((f) => !MAY_NAME_THE_SWITCH.has(f))).toEqual([]);
    const assigning = FILES.filter(({ src }) => /BRANCHES_OPEN\s*(:\s*boolean\s*)?=/.test(src)).map(({ file }) => file);
    expect(assigning).toEqual(['packages/data/src/branches-open.ts']);
    expect(readFileSync(join(ROOT, 'packages/data/src/branches-open.ts'), 'utf8')).toMatch(/export const BRANCHES_OPEN: boolean = false;/);
  });
  // The PR 1584 review's N2: the Bug-note replay start once spread `BRANCHES_OPEN ? { picks } : {}` inline in main.ts, and a
  // `true ?` there passed every test. Its `picks` now come only through `replayStartPicks` (pinned closed in replay.test.ts),
  // called with its one argument (above); this holds main.ts's one `replayLog.begin` to that call and to no `picks:` of its own.
  it('the replay start takes its picks only through replayStartPicks(branchPicks)', () => {
    const main = FILES.find(({ file }) => file === 'packages/app/src/main.ts');
    expect(main).toBeDefined();
    const begins = callArgs(main?.src ?? '', 'replayLog\\.begin');
    expect(begins).toHaveLength(1);
    const body = begins[0]?.join(', ') ?? '';
    expect(body).toContain('...replayStartPicks(branchPicks)');
    expect(body.replace('...replayStartPicks(branchPicks)', '')).not.toMatch(/\bpicks\s*:/);
  });
  it('the splitter sees a trailing argument (the guard is not vacuous)', () => {
    expect(callArgs('applyUpgrades(u, { a: [1, 2] }, f(x, y), true)', 'applyUpgrades')).toEqual([['u', '{ a: [1, 2] }', 'f(x, y)', 'true']]);
  });
});
