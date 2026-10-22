import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { VERSUS_HELD_UNITS, versusRoster } from './versus-roster';

const DOCTRINES = new URL('../../../../data/doctrines/', import.meta.url);

/** Every id on any shipped versus menu (`data/doctrines/*.json`). */
function menuIds(): Set<string> {
  const out = new Set<string>();
  const files = readdirSync(DOCTRINES).filter((f) => f.endsWith('.json'));
  // Not vacuous: there are doctrines to read.
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const d = JSON.parse(readFileSync(new URL(f, DOCTRINES), 'utf8')) as { menu?: string[] };
    for (const id of d.menu ?? []) out.add(id);
  }
  return out;
}

describe('VERSUS_HELD_UNITS (GH-698)', () => {
  it('names only real shipped unit ids', () => {
    const shipped = new Set(Object.keys(units));
    expect(VERSUS_HELD_UNITS.size).toBeGreaterThan(0);
    for (const id of VERSUS_HELD_UNITS) expect(shipped.has(id), id).toBe(true);
  });

  it('holds out nothing a versus menu offers', () => {
    const menu = menuIds();
    expect(menu.size).toBeGreaterThan(0);
    for (const id of VERSUS_HELD_UNITS) expect(menu.has(id), id).toBe(false);
  });

  it('versusRoster is the shipped roster, in order, minus the held ids', () => {
    const want = Object.values(units).filter((u) => !VERSUS_HELD_UNITS.has(u.id)).map((u) => u.id);
    expect(versusRoster().map((u) => u.id)).toEqual(want);
    for (const id of VERSUS_HELD_UNITS) expect(versusRoster().some((u) => u.id === id)).toBe(false);
  });
});
