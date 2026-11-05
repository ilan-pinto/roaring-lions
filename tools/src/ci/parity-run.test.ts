import { describe, expect, it } from 'vitest';
import { BASELINES } from '../golden-diff/baseline';
import { PARITY_ROWS, type ParityRow } from '../golden-diff/parity-bands';
import { buildParityLines, formatParity, parityExit, type ArmSummaries, type SummaryJson } from './parity-run';

const row = (layer: string, band: ParityRow['band'] = 'tight'): ParityRow => ({ scenario: 's', layer, band, r0: { wgl2: null, wgpu: null }, note: '' });
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
