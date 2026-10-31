/**
 * The hand generator (`tools/units/hands.py`, numpy only) under its caps (GH-826 F1, spec 1.1, as
 * ruled after R0b, 31 Oct 2026: the lead's max-detail rule raised the spec's 256 to 400 triangles a
 * living hand and 48 to 64 a corpse fist; departure 17): 0.194 m long and 0.094 m across the
 * palm at S = 1.778, deterministic to the byte, scaled by S / 1.778.
 *
 * It runs the generator in a child `python3` (stdlib + numpy, as the backdrop gate does), so no
 * Blender is needed. The mesh checks on the BYTES (`mesh_hands.test.ts`, `kdf_carbine_part.test.ts`)
 * are the independent ones; this file pins what the generator itself promises.
 *
 * FALSIFICATION (run, red, put back): the cap is pinned at the hand's own size, so it can fail from
 * both sides. `TRIANGLE_CAP` lowered to 396, one under the 397 a hand is, makes `build` exit with its
 * refusal; `FIST_CAP` lowered to 63 refuses the 64-triangle fist; a hand with an extra ring on every
 * finger (+14 each, 453 triangles) breaks the 400 cap; and the 0.094 palm is pinned against the
 * numbers in the spec, so a mutated palm (x 1.25 in the palm rings) reads 0.1175.
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

  it('is at most 400 triangles a living hand, in every pose and on both sides', () => {
    for (const k of ['gripR', 'gripL', 'supportL', 'supportR', 'handleL', 'handleR']) {
      expect(d[k].tris, k).toBeLessThanOrEqual(400);
      expect(d[k].tris, k).toBeGreaterThan(350);                // the detail is spent, not a stub: 397
    }
  });

  it('spends it on seven-sided fingers, a twelve-sided palm, a thenar mound and a lipped cuff', () => {
    const g = d.gripR.groups;
    expect(g.palm).toBe(84);                                    // 12 sides: 3 bands of 24 + the 12-triangle cap
    expect(g.index).toBe(49);                                   // 7 sides: 3 bands of 14 + the 7-triangle tip
    expect(g.finger1).toBe(49);
    expect(g.thumb).toBe(63);                                   // 4 bands: root, mound, MCP, IP, tip
    expect(g.cuff).toBe(48);                                    // 2 bands: the turned-in lip, then the funnel into the wrist
  });

  it('keeps the index finger a part of its own on the firing hand (the trigger finger bone)', () => {
    expect(d.gripR.groups.index).toBeGreaterThan(40);
    expect(d.supportL.groups.index).toBeUndefined();
  });

  it('is at most 64 triangles a corpse fist', () => { expect(d.fist.tris).toBeLessThanOrEqual(64); expect(d.fist.tris).toBeGreaterThan(55); });

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

  it('refuses over its triangle cap instead of shipping it, and the cap sits exactly on the hand', () => {
    const over = py(HEAD + `H.TRIANGLE_CAP = 100; H.build('grip','R')`);
    expect(over.status).not.toBe(0);
    expect(over.err).toMatch(/triangles, the cap is 100/);
    // one under the hand's own 397 refuses, the hand's own size passes: the cap is live, not slack
    const one = py(HEAD + `H.TRIANGLE_CAP = 396; H.build('grip','R')`);
    expect(one.status).not.toBe(0);
    expect(one.err).toMatch(/397 triangles, the cap is 396/);
    const exact = py(HEAD + `H.TRIANGLE_CAP = 397; print(H.build('grip','R')['triangles'])`);
    expect(exact.out.trim()).toBe('397');
  });

  it('refuses a corpse fist over its own cap', () => {
    const tight = py(HEAD + `H.FIST_CAP = 63; H.build('x','R',kind='fist')`);
    expect(tight.status).not.toBe(0);
    expect(tight.err).toMatch(/fist 64 triangles, the cap is 63/);
  });

  it('breaks the cap when a finger gains a ring (the detail that would not fit)', () => {
    const extra = py(HEAD + `
import numpy as np
orig = H._tube
def fatter(mesh, group, pts, dirs, widths, *a, **k):
    # an extra ring at every knuckle: split each phalanx in two
    P = [pts[0]]
    D = []
    W = [widths[0]]
    for i in range(1, len(pts)):
        P += [(pts[i-1] + pts[i]) / 2.0, pts[i]]; D += [dirs[i-1], dirs[i-1]]; W += [widths[i-1], widths[i]]
    return orig(mesh, group, np.array(P), D, W, *a, **k)
H._tube = fatter
H.build('grip','R')`);
    expect(extra.status).not.toBe(0);
    expect(extra.err).toMatch(/triangles, the cap is 400/);
  });
});
