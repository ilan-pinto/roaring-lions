import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decorFamilyOf, isTexturedDecorKey, TEXTURED_DECOR_FAMILIES } from './textured-decor';

describe('the textured-decor opt-out is a named list', () => {
  it('covers exactly the ditch', () => {
    // If this grows, the growth should be a decision someone made, not
    // something that arrived with an asset.
    expect([...TEXTURED_DECOR_FAMILIES].sort()).toEqual(['ditch']);
  });

  // Drift between the two sides is the failure this exists to stop: listed
  // here but not there and the gate rejects a GLB the runtime requires;
  // listed there but not here and the runtime throws on a GLB the gate waved
  // straight past.
  it('agrees with TEXTURED_DECOR_EXEMPT in tools/validate_mesh_assets.py', () => {
    const py = readFileSync(
      fileURLToPath(new URL('../../../../../tools/validate_mesh_assets.py', import.meta.url)),
      'utf8'
    );
    const block = /TEXTURED_DECOR_EXEMPT\s*=\s*\{([^}]*)\}/.exec(py);
    expect(block, 'TEXTURED_DECOR_EXEMPT not found in tools/validate_mesh_assets.py').not.toBeNull();
    const ids = [...(block as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(ids).toEqual([...TEXTURED_DECOR_FAMILIES].sort());
  });

  it('keys on the family, so every variant of a listed family is covered', () => {
    expect(decorFamilyOf('ditch_0')).toBe('ditch');
    expect(decorFamilyOf('boulder_2')).toBe('boulder');
    expect(isTexturedDecorKey('ditch_0')).toBe(true);
    expect(isTexturedDecorKey('ditch_7')).toBe(true);
    expect(isTexturedDecorKey('boulder_0')).toBe(false);
    expect(isTexturedDecorKey('rock_1')).toBe(false);
  });
});
