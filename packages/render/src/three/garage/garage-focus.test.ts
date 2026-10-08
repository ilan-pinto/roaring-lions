// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KIT_BASE_COUNT_KEY } from '../units/vehicle-kit';
import { chooseFocus, collectTriangles, figureFacingYaws, subjectMask, visibleSubject } from './garage-focus';
import { GARAGE_FOV_DEG, defaultYawDeg, fitCamera } from './garage-frame';

/** A 2 x 1 x 1 hull with a thin kit plate merged onto its +Z flank, the way
 *  `applyVehicleKit` merges one: host triangles first, kit after
 *  `rlKitBaseCount`. */
function kittedHull(): { root: THREE.Group; turn: THREE.Group } {
  const host = new THREE.BoxGeometry(2, 1, 1).translate(0, 0.5, 0);
  const plate = new THREE.BoxGeometry(1.2, 0.6, 0.05).translate(0, 0.5, 0.53);
  const merged = mergeGeometries([host, plate]);
  if (!merged) throw new Error('merge failed');
  merged.userData[KIT_BASE_COUNT_KEY] = host.index?.count ?? 0;
  const mesh = new THREE.Mesh(merged);
  mesh.name = 'hull_hull';
  mesh.userData.rl_role = 'hull';
  const turn = new THREE.Group();
  turn.add(mesh);
  const root = new THREE.Group();
  root.add(turn);
  return { root, turn };
}

/** The bay's camera on +X, fitted to the whole model the way the door fits. */
function bayCamera(points: THREE.Vector3[]): THREE.PerspectiveCamera {
  const fit = fitCamera(points, GARAGE_FOV_DEG, 18, 1.5);
  const cam = new THREE.PerspectiveCamera(GARAGE_FOV_DEG, 1.5, 0.01, 200);
  cam.position.copy(fit.position);
  cam.lookAt(fit.target);
  cam.updateProjectionMatrix();
  return cam;
}

function sweptPoints(root: THREE.Object3D, turn: THREE.Object3D): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let a = 0; a < 360; a += 15) {
    turn.rotation.y = THREE.MathUtils.degToRad(a);
    const tris = collectTriangles(root);
    for (let i = 0; i < tris.pos.length; i += 3) out.push(new THREE.Vector3(tris.pos[i], tris.pos[i + 1], tris.pos[i + 2]));
  }
  turn.rotation.y = 0;
  return out;
}

describe('subjectMask', () => {
  it('a kitted vehicle: exactly the triangles past rlKitBaseCount', () => {
    const { root } = kittedHull();
    const tris = collectTriangles(root);
    const s = subjectMask(tris, 'armour', { figures: 0, kitted: true });
    expect(s.subject).toBe('kit');
    // A box is 12 triangles: the host's 12 and the plate's 12.
    expect(tris.count).toBe(24);
    expect(s.triangles).toBe(12);
    expect([...s.mask.slice(0, 12)].every((m) => m === 0)).toBe(true);
    expect([...s.mask.slice(12)].every((m) => m === 1)).toBe(true);
  });

  it('a model with nothing in the region frames the whole model, and says so', () => {
    const { root } = kittedHull();
    const tris = collectTriangles(root);
    const warned: string[] = [];
    const s = subjectMask(tris, 'sensors', { figures: 0, kitted: false, label: 'test_hull', warn: (m) => warned.push(m) });
    expect(s.subject).toBe('whole');
    expect(s.triangles).toBe(tris.count);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('test_hull sensors');
  });

  it("a vehicle's firepower is its metal, never a rotor", () => {
    const gun = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.1));
    gun.name = 'gun_metal';
    gun.userData.rl_role = 'metal';
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(3, 0.02, 0.2));
    rotor.name = 'rotor_main';
    rotor.userData.rl_role = 'metal';
    const root = new THREE.Group().add(gun, rotor);
    const tris = collectTriangles(root);
    const s = subjectMask(tris, 'firepower', { figures: 0, kitted: false });
    expect(s.subject).toBe('role');
    expect(s.triangles).toBe(12);
    for (let t = 0; t < tris.count; t++) expect(s.mask[t], tris.name[t]).toBe(tris.name[t] === 'gun_metal' ? 1 : 0);
  });

  it('a team: the region on the LEAD figure, by role and height band', () => {
    // Two figures 1.8 tall: a body (uniform, 0.9-1.4), a head (face,
    // 1.55-1.8) and boots (boot, 0-0.1). The second carries a launcher
    // (weapon), so it leads firepower; the first, given a bigger torso,
    // leads armour.
    const figure = (x: number, torsoSegs: number, weapon: boolean): THREE.Group => {
      const g = new THREE.Group();
      g.position.x = x;
      const add = (geo: THREE.BufferGeometry, role: string): void => {
        const m = new THREE.Mesh(geo);
        m.name = role;
        m.userData.rl_role = role;
        g.add(m);
      };
      add(new THREE.BoxGeometry(0.4, 0.5, 0.3, torsoSegs, torsoSegs, torsoSegs).translate(0, 1.15, 0), 'uniform');
      add(new THREE.BoxGeometry(0.2, 0.25, 0.2).translate(0, 1.675, 0), 'face');
      add(new THREE.BoxGeometry(0.3, 0.1, 0.3).translate(0, 0.05, 0), 'boot');
      if (weapon) add(new THREE.BoxGeometry(1, 0.1, 0.1).translate(0, 1.3, 0.2), 'weapon');
      return g;
    };
    const a = figure(0, 3, false);
    const b = figure(1, 1, true);
    const root = new THREE.Group().add(a, b);
    const tris = collectTriangles(root, [a, b]);

    const armour = subjectMask(tris, 'armour', { figures: 2, kitted: false });
    expect(armour.figure).toBe(0);
    for (let t = 0; t < tris.count; t++) {
      expect(armour.mask[t]).toBe(tris.owner[t] === 0 && tris.role[t] === 'uniform' ? 1 : 0);
    }

    const fire = subjectMask(tris, 'firepower', { figures: 2, kitted: false });
    expect(fire.figure).toBe(1);
    for (let t = 0; t < tris.count; t++) expect(fire.mask[t]).toBe(tris.role[t] === 'weapon' ? 1 : 0);

    // The head: the face and what sits near it, never the boots.
    const sensors = subjectMask(tris, 'sensors', { figures: 2, kitted: false });
    expect(sensors.subject).toBe('role');
    let faces = 0;
    for (let t = 0; t < tris.count; t++) {
      if (!sensors.mask[t]) continue;
      expect(tris.owner[t]).toBe(sensors.figure);
      expect(tris.role[t]).not.toBe('boot');
      if (tris.role[t] === 'face') faces++;
    }
    expect(faces).toBe(12);
  });

  it("a PRONE figure's head is found by its face, not by its height", () => {
    // Lying along +X: boots at x 0, face at x 1.7, and a pack riding highest
    // of all on his back at x 0.8 -- the top fifth of his height is the pack.
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, role: string, name = role): void => {
      const m = new THREE.Mesh(geo);
      m.name = name;
      m.userData.rl_role = role;
      g.add(m);
    };
    add(new THREE.BoxGeometry(1.0, 0.25, 0.4).translate(0.7, 0.125, 0), 'uniform');
    add(new THREE.BoxGeometry(0.5, 0.15, 0.3).translate(0.8, 0.325, 0), 'uniform', 'pack');
    add(new THREE.BoxGeometry(0.22, 0.2, 0.2).translate(1.7, 0.15, 0), 'face');
    add(new THREE.BoxGeometry(0.2, 0.1, 0.2).translate(0.05, 0.05, 0), 'boot');
    const root = new THREE.Group().add(g);
    const tris = collectTriangles(root, [g]);
    const s = subjectMask(tris, 'sensors', { figures: 1, kitted: false });
    expect(s.subject).toBe('role');
    for (let t = 0; t < tris.count; t++) {
      expect(s.mask[t], tris.name[t]).toBe(tris.name[t] === 'face' ? 1 : 0);
    }
  });
});

describe('subjectMask on a skinned figure', () => {
  it("sensors is the head BONE's triangles, whatever role they carry", () => {
    // One figure: a root, a spine and a head bone. `uniform` carries the body
    // (spine) and the helmet (head); `face` carries the face (head) and, as
    // a shipped rig can, a hand on the spine, well away from the head.
    const root = new THREE.Bone();
    root.name = 'f0_root';
    const spine = new THREE.Bone();
    spine.name = 'f0_spine';
    const head = new THREE.Bone();
    head.name = 'f0_head';
    root.add(spine);
    spine.add(head);
    const part = (geo: THREE.BufferGeometry, bone: number): THREE.BufferGeometry => {
      const g = geo.toNonIndexed();
      const n = g.getAttribute('position').count;
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? bone : 0)), 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      return g;
    };
    const skinned = (parts: THREE.BufferGeometry[], role: string): THREE.SkinnedMesh => {
      const geo = mergeGeometries(parts);
      if (!geo) throw new Error('merge failed');
      const m = new THREE.SkinnedMesh(geo);
      m.name = role;
      m.userData.rl_role = role;
      return m;
    };
    const uniform = skinned(
      [part(new THREE.BoxGeometry(0.4, 0.6, 0.3).translate(0, 1.1, 0), 1), part(new THREE.BoxGeometry(0.26, 0.12, 0.26).translate(0, 1.82, 0), 2)],
      'uniform'
    );
    const face = skinned(
      [part(new THREE.BoxGeometry(0.2, 0.22, 0.2).translate(0, 1.66, 0), 2), part(new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(0.5, 0.9, 0), 1)],
      'face'
    );
    const group = new THREE.Group();
    group.add(root, uniform, face);
    group.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton([root, spine, head]);
    uniform.bind(skeleton);
    face.bind(skeleton);

    const tris = collectTriangles(group, [root]);
    expect(tris.count).toBe(48);
    const s = subjectMask(tris, 'sensors', { figures: 1, kitted: false });
    expect(s.subject).toBe('role');
    for (let t = 0; t < tris.count; t++) {
      expect(s.mask[t], `${tris.role[t]} on ${tris.bone[t]}`).toBe(tris.bone[t] === 'f0_head' ? 1 : 0);
    }
    expect(s.triangles).toBe(24);
  });
});

describe('visibleSubject and chooseFocus', () => {
  it('counts a kit plate on the far flank as hidden, and turns the model to show it', () => {
    const { root, turn } = kittedHull();
    const cam = bayCamera(sweptPoints(root, turn));
    // rotation.y = theta sends local +Z to (sin theta, 0, cos theta): at 90
    // the plate faces the camera on +X, at 270 it faces away.
    const at = (deg: number): number => {
      turn.rotation.y = THREE.MathUtils.degToRad(deg);
      const tris = collectTriangles(root);
      const s = subjectMask(tris, 'armour', { figures: 0, kitted: true });
      return visibleSubject(tris, s.mask, cam).pixels;
    };
    expect(at(90)).toBeGreaterThan(200);
    expect(at(270)).toBe(0);

    const choice = chooseFocus({
      model: root,
      figures: [],
      track: 'armour',
      kitted: true,
      applyYaw: (deg) => {
        turn.rotation.y = THREE.MathUtils.degToRad(deg);
      },
      bayCamera: cam,
    });
    expect(choice.yawDeg).toBe(90);
    expect(choice.subject).toBe('kit');
    expect(choice.pixelsByYaw[choice.pixelsByYaw.length - 2]).toBe(0); // 270
    // Framed on the plate alone: every point within the plate's own box.
    const box = new THREE.Box3().setFromPoints(choice.points);
    const size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(0.6, 5);
    expect(Math.max(size.x, size.z)).toBeCloseTo(1.2, 5);
  });
});

describe('figureFacingYaws', () => {
  it("keeps a team's faces at least side-on to the camera", () => {
    // The shipped default faces the key, 40 degrees off the camera axis.
    expect(defaultYawDeg('figures')).toBe(320);
    expect(figureFacingYaws(320)).toEqual([0, 45, 90, 315]);
    // Square on: the four yaws within 90 degrees of the camera.
    expect(figureFacingYaws(0)).toEqual([0, 45, 90, 270, 315]);
  });
});
