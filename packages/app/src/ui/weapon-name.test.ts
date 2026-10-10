// WP-P2 (PA-01): a weapon reaches the screen by a player's name, never by its
// data id. The unit card, the fire panel and its out-of-reach line all read
// `weaponName`, so the guarantee lives here: every weapon a shipped unit
// carries has a `weapon.<id>` entry.
//
// The weapon ids are read from `data/units/**` ON DISK at test time, not
// from `@lions/data`'s import list -- the list is hand-kept, and a unit file
// that ships without being registered there would otherwise slip past both
// (the `vfxEmitters` failure in CLAUDE.md, in a second place).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { missingKeys, setCatalogue } from '../i18n/t';
import { weaponName } from './weapon-name';

const UNITS_DIR = resolve(__dirname, '../../../../data/units');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : [];
  });
}

/** Every weapon id in every shipped unit file, with the files that carry it. */
function shippedWeaponIds(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of walk(UNITS_DIR)) {
    const json = JSON.parse(readFileSync(file, 'utf8')) as { id: string; weapons?: { id: string }[] };
    for (const w of json.weapons ?? []) out.set(w.id, [...(out.get(w.id) ?? []), json.id]);
  }
  return out;
}

const catalogue = en as Record<string, string>;

afterEach(() => setCatalogue('en', en));

describe('weapon names', () => {
  it('reads a non-trivial set of weapons off disk (vacuity guard)', () => {
    // 31 at WP-P2; a walk that found nothing would make every loop below pass.
    expect(shippedWeaponIds().size).toBeGreaterThanOrEqual(25);
  });

  it('agrees with the registered unit list, so the walk is the shipped set', () => {
    const registered = new Set(
      Object.values(units).flatMap((u) => ((u as { weapons?: { id: string }[] }).weapons ?? []).map((w) => w.id))
    );
    expect([...shippedWeaponIds().keys()].sort()).toEqual([...registered].sort());
  });

  it('gives every weapon in shipped unit JSON a catalogue name', () => {
    const missing = [...shippedWeaponIds()]
      .filter(([id]) => catalogue[`weapon.${id}`] === undefined)
      .map(([id, owners]) => `weapon.${id} (carried by ${owners.join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('never prints the id, an underscore or a dotted key', () => {
    for (const id of shippedWeaponIds().keys()) {
      const name = weaponName(id);
      expect(name, id).not.toBe(id);
      expect(name, id).not.toContain('_');
      expect(name, id).not.toMatch(/^weapon\./);
    }
  });

  it('names the ones the audit photographed', () => {
    // Literals, not the catalogue read back: an oracle that imported its
    // expected values from en.json would agree with any edit to it.
    expect(weaponName('gun_120')).toBe('120 mm main gun');
    expect(weaponName('coax_mg')).toBe('Coaxial machine gun');
    expect(weaponName('rws_50')).toBe('Remote .50-calibre machine gun');
  });

  it('falls back to a plain word for a weapon with no entry, and records the gap', () => {
    expect(weaponName('plasma_lance')).toBe('Weapon');
    expect(missingKeys()).toContain('weapon.plasma_lance');
  });

  // The pseudo-locale check (CLAUDE.md: "a plain unbracketed word in a pseudo
  // capture is a string that never went through t()"). A name built from the
  // id, or read off the data, would come back unbracketed here.
  it('goes through the catalogue: every name is pseudo-transformed under ?pseudo=1', () => {
    setCatalogue('pseudo', en, pseudo);
    for (const id of shippedWeaponIds().keys()) {
      const name = weaponName(id);
      expect(name, id).toBe(pseudo(catalogue[`weapon.${id}`]));
      expect(name, id).not.toContain(id);
    }
  });
});
