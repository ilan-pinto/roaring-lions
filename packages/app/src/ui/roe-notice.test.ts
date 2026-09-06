import { describe, it, expect } from 'vitest';
import {
  roeNotice,
  isProtectedZoneReason,
  WARN_MARGIN,
  PROTECTED_ZONE_HINT,
} from './roe-notice';

describe('roeNotice', () => {
  it('states the deduction, the reason and the running score', () => {
    const [html, tone] = roeNotice(5, 'House destroyed', 82, undefined, false);
    expect(html).toContain('−5');
    expect(html).toContain('House destroyed');
    expect(html).toContain('82');
    expect(tone).toBe('bad');
  });

  it('says nothing about a floor when the mission declares none', () => {
    const [html] = roeNotice(5, 'House destroyed', 12, undefined, false);
    expect(html).not.toContain('floor');
    expect(html).not.toContain('LOST');
  });

  it('stays quiet while the score is comfortably clear of the floor', () => {
    // 94 against a floor of 40 is the passing clearance run; it should read
    // as an ordinary deduction, not an alarm.
    const [html] = roeNotice(5, 'House destroyed', 94, 40, false);
    expect(html).not.toContain('floor');
  });

  it('warns, naming the floor and the margin, once the gap is small', () => {
    const [html] = roeNotice(5, 'fire into protected structure (clinic)', 50, 40, false);
    expect(html).toContain('10 above the 40 floor');
  });

  it('warns exactly at the margin boundary, and not one point above it', () => {
    const atEdge = roeNotice(5, 'x', 40 + WARN_MARGIN, 40, false)[0];
    const justClear = roeNotice(5, 'x', 40 + WARN_MARGIN + 1, 40, false)[0];
    expect(atEdge).toContain('floor');
    expect(justClear).not.toContain('floor');
  });

  it('declares the mission lost once the score is under the floor', () => {
    // The failing clearance run: 39 against fail_below 40 (#121).
    const [html, tone] = roeNotice(5, 'fire into protected structure (clinic)', 39, 40, false);
    expect(html).toContain('BELOW 40');
    expect(html).toContain('THE MISSION IS LOST');
    expect(tone).toBe('bad');
  });

  it('drops the advice once the mission is already lost — there is nothing left to act on', () => {
    const [html] = roeNotice(5, 'fire into protected structure (clinic)', 39, 40, true);
    expect(html).not.toContain(PROTECTED_ZONE_HINT);
  });

  it('attaches the advice the first time ordnance lands in a protected zone', () => {
    const [html] = roeNotice(5, 'fire into protected structure (clinic)', 95, 40, true);
    expect(html).toContain(PROTECTED_ZONE_HINT);
  });

  it('does not repeat the advice on later deductions for the same reason', () => {
    const [html] = roeNotice(5, 'fire into protected structure (clinic)', 90, 40, false);
    expect(html).not.toContain(PROTECTED_ZONE_HINT);
  });

  it('never attaches zone advice to a reason that is not about a zone', () => {
    const [html] = roeNotice(8, 'civilian casualties', 95, 40, true);
    expect(html).not.toContain(PROTECTED_ZONE_HINT);
  });
});

describe('isProtectedZoneReason', () => {
  it('matches both the fire and strike wordings the runtime emits', () => {
    expect(isProtectedZoneReason('fire into protected structure (clinic)')).toBe(true);
    expect(isProtectedZoneReason('strike into protected structure (hall_block)')).toBe(true);
  });

  it('does not match the other deduction reasons', () => {
    expect(isProtectedZoneReason('civilian casualties')).toBe(false);
    expect(isProtectedZoneReason('House destroyed')).toBe(false);
    expect(isProtectedZoneReason('heavy ordnance danger-close to civilians')).toBe(false);
  });
});
