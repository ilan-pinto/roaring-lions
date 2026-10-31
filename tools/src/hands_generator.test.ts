/**
 * The hand generator (`tools/units/hands.py`, numpy only) under the spec's caps (GH-826 F1, spec
 * 1.1): at most 256 triangles a living hand, 48 a corpse fist, 0.194 m long and 0.094 m across the
 * palm at S = 1.778, deterministic to the byte, scaled by S / 1.778.
 *
 * It runs the generator in a child `python3` (stdlib + numpy, as the backdrop gate does), so no
 * Blender is needed. The mesh checks on the BYTES (`mesh_hands.test.ts`, `kdf_carbine_part.test.ts`)
 * are the independent ones; this file pins what the generator itself promises.
 *
 * FALSIFICATION (run, red, put back): `TRIANGLE_CAP` lowered to 100 in the child makes `build`
 * exit with its refusal, which the last test asserts; and the 0.094 palm is pinned here against the
 * numbers in the spec, so a mutated `PALM_BREADTH` (x 1.25 in the palm rings) reads 0.118.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function py(code: string): { status: number | null; out: string; err: string } {
  const r = spawnSync('python3', ['-c', code], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const HEAD = `
import sys, json, hashlib
sys.path.insert(0, 'tools/units')
import hands as H, numpy as np
`;

describe('hands.py', () => {
  const r = py(HEAD + `
out = {}
for pose, side in (('grip','R'),('grip','L'),('support','L'),('support','R'),('handle','L'),('handle','R')):
    h = H.build(pose, side)
    V = h['verts']
    xs = np.sort(V[V[:,1] >= 0][:,0])
    out[pose + side] = dict(tris=h['triangles'], groups=h['by_group'],
        hash=hashlib.sha256(V.tobytes() + h['tris'].tobytes()).hexdigest()[:16])
f = H.build('x', 'R', kind='fist'); out['fist'] = dict(tris=f['triangles'])
big = H.build('grip', 'R', S=1.90)
small = H.build('grip', 'R', S=1.778)
out['scale'] = float(np.ptp(big['verts'][:,1]) / np.ptp(small['verts'][:,1]))
out['extended_hand_length'] = H.hand_length_extended()
out['again'] = hashlib.sha256(H.build('grip','R')['verts'].tobytes() + H.build('grip','R')['tris'].tobytes()).hexdigest()[:16]
# the palm's own breadth: ring 3's x extent (the knuckle ring), not counting fingers or thumb
h = H.build('support','R')
pal = h['tris'][[g == 'palm' for g in h['groups']]]
pv = h['verts'][np.unique(pal.ravel())]
knuckle = pv[np.abs(pv[:,1] - 0.1) < 0.012]
out['palm_breadth'] = float(np.ptp(knuckle[:,0]))
# mirror: the left hand is the right hand mirrored in x
a = H.build('support','R'); b = H.build('support','L')
out['mirror_err'] = float(np.abs(a['verts'] * np.array((-1,1,1)) - b['verts']).max())
print(json.dumps(out))
`);
  const d = JSON.parse(r.out || '{}');

  it('runs', () => { expect(r.status, r.err).toBe(0); });

  it('is at most 256 triangles a living hand, in every pose and on both sides', () => {
    for (const k of ['gripR', 'gripL', 'supportL', 'supportR', 'handleL', 'handleR']) {
      expect(d[k].tris, k).toBeLessThanOrEqual(256);
      expect(d[k].tris, k).toBeGreaterThan(200);                // a modelled hand, not a stub
    }
  });

  it('keeps the index finger a part of its own on the firing hand (the trigger finger bone)', () => {
    expect(d.gripR.groups.index).toBeGreaterThan(20);
    expect(d.supportL.groups.index).toBeUndefined();
  });

  it('is at most 48 triangles a corpse fist', () => { expect(d.fist.tris).toBeLessThanOrEqual(48); });

  it('is 0.194 m from the wrist crease to the middle fingertip, extended', () => {
    expect(d.extended_hand_length).toBeCloseTo(0.194, 4);
  });

  it('is 0.094 m across the palm at the knuckles', () => {
    expect(d.palm_breadth).toBeGreaterThan(0.090); expect(d.palm_breadth).toBeLessThan(0.100);
  });

  it('scales with the figure: S / 1.778', () => { expect(d.scale).toBeCloseTo(1.90 / 1.778, 3); });

  it('is the same bytes every time, in this process and in a second one', () => {
    const second = py(HEAD + `import hashlib; h = H.build('grip','R'); print(hashlib.sha256(h['verts'].tobytes() + h['tris'].tobytes()).hexdigest()[:16])`);
    expect(d.again).toBe(d.gripR.hash);
    expect(second.out.trim()).toBe(d.gripR.hash);
  });

  it('builds the left hand as the right hand mirrored in x', () => { expect(d.mirror_err).toBeLessThan(1e-12); });

  it('refuses over its triangle cap instead of shipping it', () => {
    const over = py(HEAD + `H.TRIANGLE_CAP = 100; H.build('grip','R')`);
    expect(over.status).not.toBe(0);
    expect(over.err).toMatch(/triangles, the cap is 100/);
  });
});
