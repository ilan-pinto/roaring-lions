import { describe, it, expect } from 'vitest';
import { readFlags } from '../sandbox-help';
import { roomFlags } from './room-flags';

describe('roomFlags', () => {
  it('outside a room every flag is what the URL says', () => {
    const warned: string[] = [];
    const flags = roomFlags(readFlags(new URLSearchParams('tunnel&kit')), false, (k) => warned.push(k));
    expect(flags.tunnel).toBe(true);
    expect(flags.kit).toBe(true);
    expect(warned).toEqual([]);
  });
  it('in a room no sandbox flag survives, and each one asked for is named', () => {
    const warned: string[] = [];
    const flags = roomFlags(readFlags(new URLSearchParams('net=new&tunnel&kit&civ')), true, (k) => warned.push(k));
    expect(Object.values(flags).every((on) => !on)).toBe(true);
    expect(Object.keys(flags).sort()).toEqual(Object.keys(readFlags(new URLSearchParams(''))).sort());
    expect(warned.sort()).toEqual(['civ', 'kit', 'tunnel']);
  });
});
