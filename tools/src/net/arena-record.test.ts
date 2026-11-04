// GH-954 public-arena P1: every new record names its build, pace, round wall time, cap and prompt digest, and an older
// record that lacks them is still read, as "older", with nothing guessed. Stub players only; no model runs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runArena } from './arena';
import { currentPromptDigest, promptDigestOf, runFieldsOf, type OfferedTool } from './arena-record';
import { listResults } from './arena-results';
import type { GameRecord } from './arena-score';
import { buildId } from './build-id';
import { readStandingPrompt } from './external-player';
import { toolsFor } from './mcp-tools';
import { inProcess, passive, rush } from './players';

const dirs: string[] = [];
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true }); });
const outDir = (): string => { const d = mkdtempSync(join(tmpdir(), 'arena-record-')); dirs.push(d); return d; };
const quiet = { log: () => {}, print: () => {} };
const BUILD = buildId();
const FIELDS = ['build', 'pace', 'roundWallMs', 'capTicks', 'promptDigest'] as const;
const ARGV = ['--seeds', '1', '--first-seed', '7', '--map', 'tel_marum', '--pace', '40', '--round-wall-ms', '2500', '--tick-ms', '1', '--cap-ticks', '300'];
const stubs = (spec: string) => inProcess(spec, spec === 'passive' ? passive : rush);
const recordsIn = (out: string): GameRecord[] => {
  const f = readdirSync(out).find((n) => n.endsWith('.jsonl') && !n.endsWith('.frames.jsonl')) ?? '';
  return readFileSync(join(out, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as GameRecord);
};

const TOOLS: OfferedTool[] = [
  { name: 'observe', description: 'See the world.', schema: { type: 'object', properties: { since: { type: 'number' } } } },
  { name: 'order', description: 'Give an order.', schema: { type: 'object', required: ['verb'] } },
];

describe('promptDigest', () => {
  it('is a sha256 hex string, and the same prompt and tools give the same one (key order of a schema is not a change)', () => {
    const d = promptDigestOf('Play well.', TOOLS);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(promptDigestOf('Play well.', TOOLS)).toBe(d);
    const reordered = TOOLS.map((t) => ({ ...t, schema: Object.fromEntries(Object.entries(t.schema).reverse()) }));
    expect(promptDigestOf('Play well.', reordered)).toBe(d);
  });

  it('changes when the prompt text changes, by one character', () => {
    expect(promptDigestOf('Play well!', TOOLS)).not.toBe(promptDigestOf('Play well.', TOOLS));
  });

  it('changes when the tool list changes: a tool added, one removed, a description reworded, a schema edited, the order swapped', () => {
    const base = promptDigestOf('Play well.', TOOLS);
    const variants: Record<string, OfferedTool[]> = {
      added: [...TOOLS, { name: 'ping', description: 'Mark a place.', schema: {} }],
      removed: TOOLS.slice(0, 1),
      reworded: [{ ...TOOLS[0], description: 'See the world, please.' }, TOOLS[1]],
      schema: [TOOLS[0], { ...TOOLS[1], schema: { type: 'object', required: ['verb', 'to'] } }],
      renamed: [{ ...TOOLS[0], name: 'look' }, TOOLS[1]],
      order: [TOOLS[1], TOOLS[0]],
      none: [],
    };
    for (const [what, tools] of Object.entries(variants)) expect(promptDigestOf('Play well.', tools), what).not.toBe(base);
    // And a prompt cannot trade text with a tool name: the structure is hashed, not a concatenation.
    expect(promptDigestOf('a', [{ name: 'b', description: '', schema: {} }])).not.toBe(promptDigestOf('ab', [{ name: '', description: '', schema: {} }]));
  });

  it('this checkout\'s digest is the prompt file and the command-scope tool list, and moves with the real tool list', () => {
    const now = currentPromptDigest();
    expect(now).toBe(promptDigestOf(readStandingPrompt(), toolsFor('command')));
    expect(readStandingPrompt()).toContain('{seat}');   // the placeholders are in what is hashed: one run, one digest
    const offered = toolsFor('command');
    expect(offered.length).toBeGreaterThan(3);
    expect(promptDigestOf(readStandingPrompt(), offered.slice(1))).not.toBe(now);
    expect(promptDigestOf(readStandingPrompt(), offered.map((t, i) => (i === 0 ? { ...t, description: `${t.description} ` } : t)))).not.toBe(now);
    expect(promptDigestOf(`${readStandingPrompt()} `, offered)).not.toBe(now);
    // The scoring tools are not offered to a player, so they are not in the digest.
    expect(offered.map((t) => t.name)).not.toContain('submit_score');
  });
});

describe('a new record carries all five fields', () => {
  it('both games of a run: the room\'s build id, the run\'s pace, round wall time and cap, and this checkout\'s digest', async () => {
    const out = outDir();
    const r = await runArena(['--a', 'rush', '--b', 'passive', ...ARGV, '--out', out], { ...quiet, resolvePlayer: stubs });
    expect(r.code).toBe(0);
    const records = recordsIn(out);
    expect(records).toHaveLength(2);
    for (const g of [...records, ...r.games]) {
      for (const f of FIELDS) expect(g, f).toHaveProperty(f);
      expect(g.build).toBe(BUILD);
      expect(g.pace).toBe(40);
      expect(g.roundWallMs).toBe(2500);
      expect(g.capTicks).toBe(300);
      expect(g.promptDigest).toBe(currentPromptDigest());
      expect(runFieldsOf(g)).not.toBeNull();
    }
    // Different terms, different record: the fields are read from the run, not a constant.
    const out2 = outDir();
    await runArena(['--a', 'rush', '--b', 'passive', ...ARGV.map((x) => (x === '2500' ? '3000' : x === '300' ? '320' : x)), '--out', out2], { ...quiet, resolvePlayer: stubs });
    expect(recordsIn(out2).map((g) => [g.roundWallMs, g.capTicks])).toEqual([[3000, 320], [3000, 320]]);
  }, 120_000);

  it('no token, template or cmd: line enters any of the five, and the digest does not depend on who plays', async () => {
    const SPEC = 'cmd:zebraword --key sk-ant-abc123 {mcp} < {prompt}';
    const plain = outDir();
    const spiked = outDir();
    await runArena(['--a', 'rush', '--b', 'passive', ...ARGV, '--out', plain], { ...quiet, resolvePlayer: stubs });
    const r = await runArena(['--a', SPEC, '--b', 'passive', ...ARGV, '--judge', 'cmd:judgebin --k sk-ant-judge9 < {prompt}', '--out', spiked], {
      ...quiet, resolvePlayer: stubs, runJudge: () => Promise.resolve({ status: 'failed', reason: 'stub', tokens: null }),
    });
    expect(r.code).toBe(0);
    const records = recordsIn(spiked);
    expect(records).toHaveLength(2);
    for (const g of records) {
      const fields = JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, (g as unknown as Record<string, unknown>)[f]])));
      for (const needle of ['sk-', 'zebraword', 'cmd:', '{mcp}', '{prompt}', '--key', 'judgebin']) expect(fields.includes(needle), `the five fields have ${needle}`).toBe(false);
      expect(runFieldsOf(g)).not.toBeNull();
      expect(g.promptDigest).toBe(recordsIn(plain)[0].promptDigest);
    }
  }, 120_000);
});

describe('runFieldsOf (what the results view reads back)', () => {
  const good = { build: '0.129.30+4d1b71344', pace: 40, roundWallMs: 1500, capTicks: 6000, promptDigest: 'ab'.repeat(32) };
  it('returns the five for a record that has them and null for an older one, or a record with any one missing or malformed', () => {
    expect(runFieldsOf({ ...good, seed: 1 })).toEqual(good);
    expect(runFieldsOf({ seed: 1 })).toBeNull();
    expect(runFieldsOf(null)).toBeNull();
    for (const f of FIELDS) {
      const rest: Record<string, unknown> = { ...good };
      delete rest[f];
      expect(runFieldsOf(rest), `without ${f}`).toBeNull();
    }
    const bad: Record<string, unknown> = {
      build: 'sk-ant-abc123', pace: 0, roundWallMs: 1.5, capTicks: '6000', promptDigest: 'AB'.repeat(32),
    };
    for (const [f, v] of Object.entries(bad)) expect(runFieldsOf({ ...good, [f]: v }), `bad ${f}`).toBeNull();
    expect(runFieldsOf({ ...good, promptDigest: 'ab'.repeat(31) })).toBeNull();
    expect(runFieldsOf({ ...good, build: '0.1.0+cmd:/Users/x' })).toBeNull();
  });
});

describe('the results list reads an older record', () => {
  it('shows terms null for a record from before, the five for a new one, and puts no stray string from an old file into the body', () => {
    const out = outDir();
    const base = { seed: 7, map: 'tel_marum', matchup: 'mirror', players: ['rush', 'passive'], factions: ['kdf', 'kdf'], outcome: 'seat0', by: 'cap', ticks: 300, reports: [{ tokens: null, timeouts: 0, errors: [] }, { tokens: null, timeouts: 0, errors: [] }] };
    const fresh = { ...base, build: '0.129.30+4d1b71344', pace: 40, roundWallMs: 1500, capTicks: 6000, promptDigest: 'cd'.repeat(32) };
    writeFileSync(join(out, '2026-11-01-rush-vs-passive.jsonl'), `${JSON.stringify(base)}\n${JSON.stringify({ ...base, build: 'sk-ant-leak9', pace: 40 })}\n`);
    writeFileSync(join(out, '2026-11-02-rush-vs-passive.jsonl'), `${JSON.stringify(fresh)}\n`);
    const list = listResults({ dir: out, build: () => BUILD });
    const byId = new Map(list.runs.map((r) => [r.id, r]));
    expect(byId.get('2026-11-01-1')?.games.map((g) => g.terms)).toEqual([null, null]);
    expect(byId.get('2026-11-02-1')?.games[0].terms).toEqual({ build: '0.129.30+4d1b71344', pace: 40, roundWallMs: 1500, capTicks: 6000, promptDigest: 'cd'.repeat(32) });
    expect(JSON.stringify(list)).not.toContain('sk-ant-leak9');
  });
});

describe('the prompt digest follows the mode (GH-976 P2)', () => {
  it('annihilation is the digest every earlier record carries; a mode is the digest of ITS prompt, one per mode', () => {
    expect(currentPromptDigest(null)).toBe(currentPromptDigest());
    expect(currentPromptDigest('points')).not.toBe(currentPromptDigest());
    expect(currentPromptDigest('points')).not.toBe(currentPromptDigest('camp'));
    expect(currentPromptDigest('points')).toMatch(/^[0-9a-f]{64}$/);
  });
});
