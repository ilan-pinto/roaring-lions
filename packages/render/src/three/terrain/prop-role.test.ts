import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liftTone } from '../world-materials';
import { readRamp } from '../units/mesh-role';
import { PROP_KINDS, PROP_MESH_ROLES, PROP_TRI_CAPS, rampForPropRole } from './prop-role';

describe('prop roles (N-12)', () => {
  it.each([
    ['concrete', 'limestone', 2],
    ['metal', 'gunmetal', 1],
    ['rust', 'dust', 5],
    ['cloth', 'water', 0],
  ] as const)('%s is %s from %i', (role, band, from) => {
    expect(rampForPropRole(role)).toEqual(readRamp(band).slice(from));
    expect(liftTone(rampForPropRole(role))).toMatch(/^#[0-9A-F]{6}$/i);
  });
  it('rubber is gunmetal\'s darkest step alone (the lead, 2026-09-28): dark grey, not metal, not black', () => {
    expect(rampForPropRole('rubber')).toEqual(readRamp('gunmetal').slice(3));
    expect(liftTone(rampForPropRole('rubber'))).toBe(readRamp('gunmetal')[3]);
    // Distinct from the car body's metal and from the `shadow` band it left.
    expect(liftTone(rampForPropRole('rubber'))).not.toBe(liftTone(rampForPropRole('metal')));
    expect(readRamp('shadow')).not.toContain(liftTone(rampForPropRole('rubber')));
  });
  it('throws on a role outside the vocabulary', () => {
    expect(() => rampForPropRole('foliage')).toThrow(/prop role/);
  });
  // The Python gate and this file must agree, or a GLB passes one and fails the other.
  it('matches validate_mesh_assets.py PROP_ROLES and PROP_TRI_CAPS', () => {
    const py = readFileSync(join(__dirname, '../../../../../tools/validate_mesh_assets.py'), 'utf8');
    const roles = /^PROP_ROLES = \{([^}]*)\}/m.exec(py);
    if (!roles) throw new Error('PROP_ROLES not found');
    expect(new Set(roles[1].match(/"(\w+)"/g)?.map((s) => s.slice(1, -1)))).toEqual(new Set(PROP_MESH_ROLES));
    for (const k of PROP_KINDS) expect(py).toMatch(new RegExp(`"${k}": ${PROP_TRI_CAPS[k]}\\b`));
  });
});
