/**
 * The TypeScript half of GH-142's building facing gate.
 *
 * The gate itself is `tools/building_facing.py`, run by `pnpm
 * validate:meshes`. It decides which of a building's four elevations the
 * camera can see from two constants it cannot import, because they live in
 * TypeScript: `camera.ts`'s `VIEW_DIRECTION` and
 * `building-mesh-role.ts`'s `BUILDING_MESH_ROLES`. This file parses the
 * Python and pins both -- the same shape of cross-language pin
 * `textured-building.test.ts` already uses for `TEXTURED_MESH_EXEMPT`, and
 * for the same reason: the drift it stops is silent in both directions.
 *
 * Change the camera's azimuth and the gate would go on checking the two
 * sides that used to face the player, passing a building that now shows its
 * back. Rename the `glass` role and the gate would find no facade geometry
 * anywhere, report every building "unchecked", and exit 0 -- a green tick
 * over nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VIEW_DIRECTION } from '../camera';
import { BUILDING_MESH_ROLES } from './building-mesh-role';

const py = readFileSync(
  fileURLToPath(new URL('../../../../../tools/building_facing.py', import.meta.url)),
  'utf8'
);

/** A `("+X", "+Z")`-style tuple assigned to `name` in the gate. */
function pyTuple(name: string): string[] {
  const block = new RegExp(`^${name}\\s*=\\s*\\(([^)]*)\\)`, 'm').exec(py);
  expect(block, `${name} not found in tools/building_facing.py`).not.toBeNull();
  return [...(block as RegExpExecArray)[1].matchAll(/"([+-][XZ])"/g)].map((m) => m[1]);
}

/** A `FACADE_ROLE = "glass"`-style assignment. */
function pyString(name: string): string {
  const block = new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm').exec(py);
  expect(block, `${name} not found in tools/building_facing.py`).not.toBeNull();
  return (block as RegExpExecArray)[1];
}

function pyNumber(name: string): number {
  const block = new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, 'm').exec(py);
  expect(block, `${name} not found in tools/building_facing.py`).not.toBeNull();
  return Number((block as RegExpExecArray)[1]);
}

describe('the building facing gate agrees with the renderer it is gating', () => {
  // The derivation the gate's CAMERA_FACING encodes, restated against the
  // real vector. `VIEW_DIRECTION` points from the camera's TARGET toward the
  // camera, so a face whose outward normal is +X or +Z has a positive dot
  // product with it and sits on the side of a solid the camera is on.
  it('sees exactly the two ground axes VIEW_DIRECTION is positive along', () => {
    const seen: string[] = [];
    const unseen: string[] = [];
    for (const [name, dot] of [
      ['+X', VIEW_DIRECTION.x],
      ['-X', -VIEW_DIRECTION.x],
      ['+Z', VIEW_DIRECTION.z],
      ['-Z', -VIEW_DIRECTION.z],
    ] as const) {
      (dot > 0 ? seen : unseen).push(name);
    }
    expect(seen.sort()).toEqual(['+X', '+Z']);
    expect(pyTuple('CAMERA_FACING').sort()).toEqual(seen.sort());
    expect(pyTuple('CAMERA_HIDDEN').sort()).toEqual(unseen.sort());
  });

  // A building mesh never turns (`mesh-building.ts`), so the elevation the
  // camera gets is the one the export baked. If that stops being true --
  // someone adds a per-structure rotation -- this gate is measuring a bake
  // whose on-screen orientation no longer follows from it, and this
  // assertion is the tripwire.
  it('is only meaningful while buildings render at identity rotation', () => {
    const src = readFileSync(fileURLToPath(new URL('./mesh-building.ts', import.meta.url)), 'utf8');
    expect(src).toContain('leaves rotation at identity');
    const renderer = readFileSync(
      fileURLToPath(new URL('../ThreeRenderer.ts', import.meta.url)),
      'utf8'
    );
    // Scoped to the one method that instantiates a building clone. A
    // repo-wide search would hit `entity.root.rotation.y` on the unit and
    // vehicle paths, which DO turn and are not what this pins.
    const start = renderer.indexOf('private updateBuildingMeshes(');
    expect(start, 'updateBuildingMeshes not found in ThreeRenderer.ts').toBeGreaterThan(-1);
    const end = renderer.indexOf('\n  private ', start + 1);
    const body = renderer.slice(start, end === -1 ? undefined : end);
    expect(body).toContain('root.position.set(');
    expect(/\brotation\b/.test(body)).toBe(false);
  });

  it('marks the facade with a role the building vocabulary actually has', () => {
    const role = pyString('FACADE_ROLE');
    expect(role).toBe('glass');
    expect(BUILDING_MESH_ROLES as readonly string[]).toContain(role);
  });

  // Not a style rule. `FRONT_MARGIN <= 1` would make "has a front" true of
  // every building including the perfectly symmetric ones, and the gate
  // would start failing `concrete` (1080 px each half) on whichever side
  // rounded higher.
  it('keeps a real ambiguity band between "has a front" and "glazed all round"', () => {
    expect(pyNumber('FRONT_MARGIN')).toBeGreaterThan(1);
  });
});
