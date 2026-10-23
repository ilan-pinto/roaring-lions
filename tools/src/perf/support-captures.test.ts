import { describe, expect, it } from 'vitest';
import { FLOORS, verdict, type Reading } from './support-captures';

const r = (over: Partial<Reading>): Reading => ({
  shot: 's',
  layer: 'support-blast',
  changedPx: 5000,
  meanDelta: 1,
  controlPx: 0,
  objects: 2,
  ...over,
});

describe('support-captures verdict', () => {
  it('passes a toggle that moves the frame past its floor with a still control', () => {
    expect(verdict(r({}))).toBe('pass');
  });
  it('fails a toggle under its floor -- the falsified pass reads 0', () => {
    expect(verdict(r({ changedPx: 0, objects: 0 }))).toBe('below-floor');
    expect(verdict(r({ changedPx: FLOORS['support-blast'] - 1 }))).toBe('below-floor');
  });
  it('fails any reading whose zero-time repaint moved the frame', () => {
    expect(verdict(r({ controlPx: 1 }))).toBe('control-moved');
  });
});
