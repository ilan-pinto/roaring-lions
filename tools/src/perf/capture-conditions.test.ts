// The capture-conditions block (GH-1411): every field printed, read from a fake machine, and the real adapter read once.
import { describe, expect, it } from 'vitest';
import { NODE_ENV, conditionsBlock, formatLoad, readConditions, type ConditionsEnv } from './capture-conditions';
import { SIM_SCALING_BACKEND, simScalingConditions } from './sim-scaling';

const FAKE: ConditionsEnv = {
  gitHead: () => '0123456789ABCDEF0123456789abcdef01234567',
  gitDirty: () => false,
  nodeVersion: 'v99.1.2',
  cpus: () => [{ model: 'Fake CPU 9000 @ 4.20GHz' }, { model: 'Fake CPU 9000 @ 4.20GHz' }, { model: 'Fake CPU 9000 @ 4.20GHz' }],
  loadavg: () => [1.234, 5.6, 7.891],
  now: () => new Date(Date.UTC(2031, 2, 4, 5, 6, 7)),
};

describe('capture conditions', () => {
  it('prints commit, node, CPU model, core count, load average, date and backend, each from the env', () => {
    // mutation: any line of conditionsBlock dropped; cores read as a constant; the load's 15-minute figure dropped
    const block = conditionsBlock(readConditions('Fake backend', FAKE));
    expect(block).toEqual([
      'Capture conditions (GH-1411):',
      '  commit:       0123456789abcdef0123456789abcdef01234567 (clean)',
      '  node:         v99.1.2',
      '  cpu:          Fake CPU 9000 @ 4.20GHz',
      '  cores:        3',
      '  load average: 1.23 / 5.60 / 7.89 (1 / 5 / 15 min)',
      '  date:         2031-03-04T05:06:07.000Z',
      '  backend:      Fake backend',
    ]);
  });

  it('says unknown for a field it cannot read, and names a dirty tree', () => {
    const c = readConditions('x', {
      ...FAKE,
      gitHead: () => null,
      nodeVersion: '',
      cpus: () => [],
      loadavg: () => [],
    });
    expect(c).toMatchObject({ commit: 'unknown', node: 'unknown', cpuModel: 'unknown', cores: 'unknown', loadAverage: 'unknown' });
    expect(readConditions('x', { ...FAKE, gitDirty: () => true }).commit).toBe('0123456789abcdef0123456789abcdef01234567 + uncommitted changes to tracked files');
    expect(readConditions('x', { ...FAKE, gitHead: () => 'not a sha' }).commit).toBe('unknown');
    expect(formatLoad({ loadavg: () => [1, Number.NaN, 2] })).toBe('unknown');
  });

  it('sim-scaling opens with the block and calls itself CPU only', () => {
    const lines = simScalingConditions(FAKE);
    expect(SIM_SCALING_BACKEND).toMatch(/^CPU only/);
    expect(lines).toEqual(conditionsBlock(readConditions(SIM_SCALING_BACKEND, FAKE)));
    for (const label of ['commit:', 'node:', 'cpu:', 'cores:', 'load average:', 'date:', 'backend:']) {
      expect(lines.filter((l) => l.trimStart().startsWith(label))).toHaveLength(1);
    }
    expect(lines.at(-1)).toBe(`  backend:      ${SIM_SCALING_BACKEND}`);
  });

  it('the real Node adapter reads this machine: a CPU model, cores > 0, a commit or unknown', () => {
    // mutation: NODE_ENV's `cpus: () => cpus()` changed to `() => []` (cpu and cores read `unknown`)
    const c = readConditions('x', NODE_ENV);
    expect(c.cpuModel).not.toBe('unknown');
    expect(c.cpuModel.trim()).not.toBe('');
    expect(Number(c.cores)).toBeGreaterThan(0);
    expect(Number.isInteger(Number(c.cores))).toBe(true);
    expect(c.commit).toMatch(/^(unknown|[0-9a-f]{40} (\(clean\)|\(tree state unknown\)|\+ uncommitted changes to tracked files))$/);
    expect(c.node).toBe(process.version);
    expect(c.loadAverage).toMatch(/^(unknown|\d+\.\d\d \/ \d+\.\d\d \/ \d+\.\d\d \(1 \/ 5 \/ 15 min\))$/);
  });
});
