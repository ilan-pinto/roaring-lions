import { describe, expect, it } from 'vitest';
import { BASELINES } from '../golden-diff/baseline';
import { PARITY_ROWS, type ParityRow } from '../golden-diff/parity-bands';
import { buildParityLines, formatParity, parityExit, type ArmSummaries, type SummaryJson } from './parity-run';

const row = (layer: string, band: ParityRow['band'] = 'tight', floor: number | null = null): ParityRow => ({ scenario: 's', layer, band, r0: { wgl2: null, wgpu: null }, nodeFloor: { wgl2: floor, wgpu: floor }, note: '' });
const rd = (layer: string, mean: number, px = 100) => ({ layer, meanAbsChannelDelta: mean, changedPixels: px, diffPixels: px });
const arm = (...layers: ReturnType<typeof rd>[]): ArmSummaries =>
  new Map<string, SummaryJson>([['s', { readings: { repaintControl: rd('x', 0, 0), layers } }]]);

describe('parity report', () => {
  it('judges a row from the two arms and exits 0 when all are in band', () => {
    const lines = buildParityLines(arm(rd('fog', 10)), arm(rd('fog', 10.2)), [row('fog')]);
    expect(parityExit(lines)).toBe(0);
  });
  it('exits 1 for an out-of-band row, and a delta of 0 on the node arm is FAIL', () => {
    expect(parityExit(buildParityLines(arm(rd('fog', 10)), arm(rd('fog', 5)), [row('fog')]))).toBe(1);
    expect(parityExit(buildParityLines(arm(rd('fog', 10)), arm(rd('fog', 0)), [row('fog')]))).toBe(1);
  });
  it('refuses (exit 2) rather than skips a row an arm never read, and an empty table', () => {
    const lines = buildParityLines(arm(rd('fog', 10)), arm(), [row('fog')]);
    expect(parityExit(lines)).toBe(2);
    expect(formatParity(lines, 'wgpu').join('\n')).toContain('REFUSED');
    expect(parityExit([])).toBe(2);
    expect(parityExit(buildParityLines(new Map(), new Map(), [row('fog')]))).toBe(2);
  });
  it('the repaint-control row reads the control, not a layer', () => {
    const lines = buildParityLines(arm(), arm(), [row('repaint-control', 'zero')]);
    expect(parityExit(lines)).toBe(0);
  });
});

describe('DEAD verdict (report-only)', () => {
  const dead = (r: ParityRow, nodeMean: number, key = 'wgpu') => {
    const lines = buildParityLines(arm(rd(r.layer, 10)), arm(rd(r.layer, nodeMean)), [r], key);
    return { lines, text: formatParity(lines, key).join('\n') };
  };
  it('prints DEAD for a node delta of 0 with no floor yet', () => {
    const { lines, text } = dead(row('fog'), 0);
    expect(lines[0]?.dead).toBe(true);
    expect(text).toContain('DEAD s/fog');
  });
  it('prints DEAD under a floor, and not at the floor or above it', () => {
    expect(dead(row('fog', 'tight', 2), 1.9).lines[0]?.dead).toBe(true);
    expect(dead(row('fog', 'tight', 2), 2).lines[0]?.dead).toBe(false);
    expect(dead(row('fog', 'tight', 2), 2).text).not.toContain('DEAD');
    expect(dead(row('fog', 'tight', 2), 3).lines[0]?.dead).toBe(false);
  });
  it('a zero-band row at 0 is the pass, never DEAD', () => {
    const { lines, text } = dead(row('repaint-control', 'zero'), 0);
    expect(lines[0]?.dead).toBe(false);
    expect(text).not.toContain('DEAD');
    expect(dead(row('bloom', 'zero'), 0).lines[0]?.dead).toBe(false);
  });
  it('never changes the exit code: a DEAD row in band still exits as the band says', () => {
    const lines = buildParityLines(arm(rd('fog', 0)), arm(rd('fog', 0)), [row('fog', 'loose')], 'wgpu');
    expect(lines[0]?.dead).toBe(true);
    expect(parityExit(lines)).toBe(parityExit(lines.map((l) => ({ ...l, dead: false }))));
  });
  it('reads the floor of the key it is run for', () => {
    const r: ParityRow = { ...row('fog'), nodeFloor: { wgl2: 5, wgpu: null } };
    expect(dead(r, 3, 'wgl2').lines[0]?.dead).toBe(true);
    expect(dead(r, 3, 'wgpu').lines[0]?.dead).toBe(false);
  });
});

describe('PARITY_ROWS name real toggles', () => {
  it('every row is a layer its scenario really declares (a typo would be refused at run time, every time)', () => {
    for (const r of PARITY_ROWS) {
      if (r.layer === 'repaint-control') continue;
      const spec = BASELINES[r.scenario];
      expect(spec, r.scenario).toBeDefined();
      expect(spec?.layerChecks?.some((c) => c.layer === r.layer), `${r.scenario}/${r.layer}`).toBe(true);
    }
  });
});
