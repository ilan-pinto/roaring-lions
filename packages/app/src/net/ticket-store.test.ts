import { describe, it, expect } from 'vitest';
import { saveSeat, loadSeat, forgetSeat } from './ticket-store';
import type { StorageLike } from '../telemetry/identity';

const memory = (): StorageLike & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};

describe('ticket-store', () => {
  it('save then load returns the seat', () => {
    const s = memory();
    saveSeat(s, 'ABCDEF', { ticket: 'tk-1', seat: 1 });
    expect(loadSeat(s, 'ABCDEF')).toEqual({ ticket: 'tk-1', seat: 1 });
  });
  it('another code returns null', () => {
    const s = memory();
    saveSeat(s, 'ABCDEF', { ticket: 'tk-1', seat: 0 });
    expect(loadSeat(s, 'GHIJKL')).toBeNull();
  });
  it('a code is a code whatever its case', () => {
    const s = memory();
    saveSeat(s, 'abcdef', { ticket: 'tk-1', seat: 0 });
    expect(loadSeat(s, 'ABCDEF')).toEqual({ ticket: 'tk-1', seat: 0 });
  });
  it('forget makes load return null', () => {
    const s = memory();
    saveSeat(s, 'ABCDEF', { ticket: 'tk-1', seat: 0 });
    forgetSeat(s, 'ABCDEF');
    expect(loadSeat(s, 'ABCDEF')).toBeNull();
  });
  it('a malformed or foreign value reads as no seat', () => {
    for (const raw of ['', 'not json', '{"ticket":"","seat":0}', '{"ticket":"tk","seat":2}', '{"ticket":7,"seat":0}', 'null']) {
      const s = memory();
      saveSeat(s, 'ABCDEF', { ticket: 'tk', seat: 0 });
      const key = Object.keys(s.data)[0];
      s.data[key] = raw;
      expect(loadSeat(s, 'ABCDEF')).toBeNull();
    }
  });
  it('a null store never throws', () => {
    expect(() => saveSeat(null, 'ABCDEF', { ticket: 'tk', seat: 0 })).not.toThrow();
    expect(loadSeat(null, 'ABCDEF')).toBeNull();
    expect(() => forgetSeat(null, 'ABCDEF')).not.toThrow();
  });
});
