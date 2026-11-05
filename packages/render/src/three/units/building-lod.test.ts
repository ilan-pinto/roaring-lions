import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { lod1Shown, pairLod1Materials } from './building-lod';

function root(roles: readonly string[]): THREE.Group {
  const g = new THREE.Group();
  for (const r of roles) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    m.userData.rl_role = r;
    g.add(m);
  }
  return g;
}

describe('building LOD1 twin helpers (GH-974)', () => {
  it('pairs every twin mesh to the standing mesh of its role, sharing the material', () => {
    const full = root(['wall', 'roof', 'glass']);
    const twin = root(['wall', 'glass']);
    expect(pairLod1Materials(twin, full)).toBe(true);
    const byRole = (g: THREE.Group): Record<string, THREE.Material> =>
      Object.fromEntries(g.children.map((c) => [c.userData.rl_role as string, (c as THREE.Mesh).material as THREE.Material]));
    expect(byRole(twin).wall).toBe(byRole(full).wall);
    expect(byRole(twin).glass).toBe(byRole(full).glass);
  });

  it('refuses a twin with a role the standing mesh lacks, touching nothing', () => {
    const full = root(['wall']);
    const twin = root(['wall', 'metal']);
    const before = twin.children.map((c) => (c as THREE.Mesh).material);
    expect(pairLod1Materials(twin, full)).toBe(false);
    expect(twin.children.map((c) => (c as THREE.Mesh).material)).toEqual(before);
  });

  it('refuses an empty twin', () => {
    expect(pairLod1Materials(new THREE.Group(), root(['wall']))).toBe(false);
  });

  it('shows the twin only while the zoom state is on and the building is clean', () => {
    expect(lod1Shown(true, undefined)).toBe(true);
    expect(lod1Shown(true, 8)).toBe(true);
    expect(lod1Shown(false, 8)).toBe(false);
    expect(lod1Shown(true, 3)).toBe(false); // scarred keeps its full art
    expect(lod1Shown(true, 0)).toBe(false); // a wreck is never the twin
  });
});
