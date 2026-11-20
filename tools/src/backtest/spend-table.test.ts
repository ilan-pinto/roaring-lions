// GH-1387 S0: the spend probe's arithmetic and its refusal, on numbers written out by hand (C10, C11). Nothing here runs a mission.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Banking } from './banking';
import { SPEND_BOUND, SPEND_METHODS, installRefusal, spendProbeFailures, spendReport, spendRows, type SpendRow, type SpendRun } from './spend-table';

const run = (id: string, b: Banking, o: Partial<SpendRun> = {}): SpendRun => ({ id, result: 'victory', minutes: 6, stars: 2, roe: 80, banking: b, refused: 0, ...o });

describe('spendRows, against a hand recomputation (C10)', () => {
  // beit_sahwan_2_foothold, the design's table: start 400, earned 608, so P 1,008; it ends holding 716, so it spent 292 and banked 71%.
  // 716 / 1008 = 0.7103. khan_rafid_3_clearance: start 400, earned 151, P 551, spent 0, holds all 551: 100%.
  const rows = spendRows([
    run('beit_sahwan_2_foothold', { start: 400, earned: 608, zoneEarned: 300, held: 716 }),
    run('khan_rafid_3_clearance', { start: 400, earned: 151, zoneEarned: 0, held: 551 }),
    run('a_spender', { start: 400, earned: 500, zoneEarned: 0, held: 100 }),
    // 200 / 300 = 66.67%: the report rounds to the nearest whole percent, so it reads 67, not 66.
    run('two_thirds', { start: 300, earned: 0, zoneEarned: 0, held: 200 }),
    run('nothing_to_bank', { start: 0, earned: 0, zoneEarned: 0, held: 0 }),
  ]);
  it('P, spent and the banked percent are the hand figures', () => {
    expect(rows.map((r) => [r.id, r.purse, r.spent, r.bankPct])).toEqual([
      ['beit_sahwan_2_foothold', 1008, 292, 71],
      ['khan_rafid_3_clearance', 551, 0, 100],
      ['a_spender', 900, 800, 11],
      ['two_thirds', 300, 100, 67],
      ['nothing_to_bank', 0, 0, null],
    ]);
  });
  it('over 30% is strict: 71 and 100 are over, 11 is not, and 30.0 exactly is not', () => {
    expect(rows.map((r) => r.over30)).toEqual([true, true, false, true, false]);
    expect(spendRows([run('edge', { start: 100, earned: 0, zoneEarned: 0, held: 30 })])[0]?.over30).toBe(false);
    expect(spendRows([run('edge', { start: 100, earned: 0, zoneEarned: 0, held: 31 })])[0]?.over30).toBe(true);
  });
  it('the report counts them as the design\'s section 2 does', () => {
    const lines = spendReport(rows, false);
    expect(lines[0]).toBe('spend probe (as played, nothing refused): 5 winning-plan runs');
    expect(lines.at(-1)).toBe('spend probe: 3 of 5 bank over 30%, 2 spend nothing, 5 of 5 win');
    expect(lines[1]).toContain('purse  1008  spent   292  bank 71%');
    expect(lines[1]).toContain('victory in 6.0 min, stars 2  refused 0');
    expect(spendReport(spendRows([run('x', { start: 1, earned: 0, zoneEarned: 0, held: 1 }, { minutes: 5.104166666666667 })]), false)[1]).toContain('in 5.1 min');
  });
});

describe('the refusal refuses (C11)', () => {
  it('installRefusal makes all three spend methods answer false, counts each call, and reports which runtime it was', () => {
    const proto = { requestBuild: () => true, requestSupport: () => true, requestConstruct: () => true, other: () => 'kept' };
    const seen: string[] = [];
    const count = installRefusal(proto, (_rt, m) => seen.push(m));
    expect([proto.requestBuild(), proto.requestSupport(), proto.requestConstruct(), proto.requestBuild(), proto.other()]).toEqual([false, false, false, false, 'kept']);
    expect([count(), seen]).toEqual([4, ['requestBuild', 'requestSupport', 'requestConstruct', 'requestBuild']]);
  });
  it('the refused set is every purse-taking method, field works included (literal list)', () => {
    expect([...SPEND_METHODS]).toEqual(['requestBuild', 'requestSupport', 'requestConstruct']);
  });
  it('a runtime with no such method is an error, not a silent no-op', () => {
    expect(() => installRefusal({ requestBuild: () => true, requestSupport: () => true }, () => undefined)).toThrow(/no requestConstruct/);
    expect(() => installRefusal({ requestBuild: () => true }, () => undefined)).toThrow(/no requestSupport/);
  });
  it('a run that still spent with the refusal on is an instrument error (a spend path the probe does not refuse); off, it is the play', () => {
    // ein_qasab_2_foothold before the works refusal: start 400, earned 600, held 650, so it spent 350 with 0 refused.
    const leaked = spendRows([
      run('ein_qasab_2_foothold', { start: 400, earned: 600, zoneEarned: 0, held: 650 }),
      run('a_refuser', { start: 400, earned: 100, zoneEarned: 0, held: 500 }, { refused: 2 }),
    ]);
    expect(spendProbeFailures(leaked, true)).toEqual([expect.stringContaining('ein_qasab_2_foothold spent 350 with every spend refused')]);
    expect(spendProbeFailures(leaked, false)).toEqual([]);
  });
  it('a refusal that refused nothing in any run fails the table (the control reading "wins" because the probe did nothing)', () => {
    const rows: SpendRow[] = spendRows([run('a', { start: 1, earned: 0, zoneEarned: 0, held: 1 })]);
    expect(spendProbeFailures(rows, true)).toEqual([expect.stringContaining('refused 0 spend calls')]);
    expect(spendProbeFailures(rows, false)).toEqual([]);
    expect(spendProbeFailures(spendRows([run('a', { start: 1, earned: 0, zoneEarned: 0, held: 1 }, { refused: 2 })]), true)).toEqual([]);
  });
});

describe('a forked sweep child installs the refusal too (per-process guard)', () => {
  // plan-sweep.ts forks with `execArgv: process.execArgv` and `env: { ...process.env, ... }`. The child here gets the probe the same
  // way (as an `--import`), an IPC channel (so it prints no table), and an environment carrying the marker the old env-var guard set
  // in the parent: a guard that reads the environment skips the install in exactly this child.
  it('the child, preloaded with the probe under PT_NOSPEND=1 and an inherited marker, refuses all three spend methods', async () => {
    const tools = fileURLToPath(new URL('../..', import.meta.url));
    const probe = fileURLToPath(new URL('./spend-probe.ts', import.meta.url));
    const code = [
      "import { MissionRuntime } from '@lions/sim';",
      "const p = MissionRuntime.prototype;",
      "const out = {};",
      // A refused method answers false on any receiver; the real one, on a bare object, throws or answers otherwise.
      "for (const m of ['requestBuild', 'requestSupport', 'requestConstruct']) { try { out[m] = p[m].call({}) === false ? 'refused' : 'real'; } catch { out[m] = 'real'; } }",
      "process.send(out, () => process.disconnect());",
    ].join('\n');
    const child = spawn(process.execPath, ['--import', 'tsx', '--import', probe, '--input-type=module', '-e', code], {
      cwd: tools,
      env: { ...process.env, PT_NOSPEND: '1', PT_SPEND_PROBE_LOADED: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let err = '';
    child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    const reply = await new Promise<unknown>((resolve, reject) => {
      let got: unknown;
      child.on('message', (m) => (got = m));
      child.on('error', reject);
      child.on('exit', (c) => (got === undefined ? reject(new Error(`child exited ${c} with no reply: ${err}`)) : resolve(got)));
    });
    expect(reply).toEqual({ requestBuild: 'refused', requestSupport: 'refused', requestConstruct: 'refused' });
  }, 30_000);
});

describe('SPEND_BOUND', () => {
  it('is empty until slice S1 binds the first missions', () => {
    expect([...SPEND_BOUND]).toEqual([]);
  });
  it('a bound mission whose plan still wins with every spend refused fails; one that loses, or is missing, is judged as it should be', () => {
    const won = spendRows([run('m1', { start: 1, earned: 0, zoneEarned: 0, held: 1 }, { refused: 3 })]);
    const lost = spendRows([run('m1', { start: 1, earned: 0, zoneEarned: 0, held: 1 }, { refused: 3, result: 'defeat' })]);
    expect(spendProbeFailures(won, true, new Set(['m1']))).toEqual([expect.stringContaining('m1 is bound')]);
    expect(spendProbeFailures(lost, true, new Set(['m1']))).toEqual([]);
    expect(spendProbeFailures(lost, true, new Set(['m2']))).toEqual([expect.stringContaining('m2 is bound but no run')]);
  });
});
