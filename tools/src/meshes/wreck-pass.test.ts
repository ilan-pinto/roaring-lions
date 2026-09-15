/**
 * The wreck pass, checked against documents built in memory rather than the
 * shipped GLBs.
 *
 * Two reasons for a fixture. The shipped vehicles are 1.6-3.4 MiB each and
 * `pnpm test` is the fast inner loop; and, more to the point, a test that
 * reads `art/meshes/vehicles/*.glb` would pass or fail on whether somebody had
 * already RUN the pass on them, which is Task 2's job, not this file's. The
 * bytes-level contract check over the shipped files is a separate gate
 * (`validate_mesh_assets.py`), and it asks a different question.
 *
 * The fixture is the census shape in miniature (`docs/superpowers/specs/
 * 2026-09-14-vehicle-wreck-design.md` §4.1): `hull_*` role meshes at the top
 * level plus one `turret_pivot` empty carrying its parts. `hull_hull` and
 * `hull_rubber` are deliberately the SAME box at the SAME transform, so the
 * only thing that can separate their wreck poses is the role split -- the body
 * settles and the wheels do not -- and the tilt cancels exactly between them.
 */
import { describe, it, expect } from 'vitest';
import {
  Document,
  NodeIO,
  getBounds,
  type Accessor,
  type Mesh,
  type Node,
  type bbox,
  type vec3,
} from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { WRECK_FRACTIONS, WRECK_RECIPES, type WreckRecipe } from './wreck-recipes';
import {
  applyWreckPass,
  parseWreckArgs,
  runWreckPass,
  CLIP_IDLE,
  CLIP_WRECK,
  CLIP_SECONDS,
  DEATH_ROOT,
  WRECK_PREFIX,
} from './wreck-pass';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** A closed box as one indexed TRIANGLES primitive, so `getBounds` reads real
 *  geometry rather than a degenerate point cloud. */
function box(doc: Document, name: string, min: vec3, max: vec3): Mesh {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = new Float32Array([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6, 4, 0, 3, 4, 3, 7,
    1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7, 4, 5, 1, 4, 1, 0,
  ]);
  const buffer = doc.getRoot().listBuffers()[0];
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor(`${name}_P`, buffer).setType('VEC3').setArray(positions))
    .setIndices(doc.createAccessor(`${name}_I`, buffer).setType('SCALAR').setArray(indices));
  return doc.createMesh(name).addPrimitive(prim);
}

/** Node translation of the pivot in the fixture. Large enough that a wreck
 *  built from the turret part's LOCAL matrix lands nowhere near one built from
 *  its world matrix.
 *
 *  **`PIVOT_X` is what the bake test now reads, and the Y offset alone is no
 *  longer enough to catch the defect.** Every wreck group is seated on the
 *  ground plane (`seatOnGround`), which is a Y-only translation, and it lands
 *  a turret built from either matrix at the same height -- so a horizontal
 *  offset is the one the seat cannot erase. */
const PIVOT_X = 2;
const PIVOT_Y = 6;

/** How far the fixture's hull stands above its rubber, and therefore the
 *  suspension gap `HULL_DROP` is a fraction of. Real vehicles measure
 *  0.000-0.363; this is a round number in the same territory. */
const HULL_CLEARANCE = 0.5;

interface Fixture {
  readonly doc: Document;
  readonly recipe: WreckRecipe;
}

function fixture(): Fixture {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('Scene');

  // Same box, different role, and the hull sitting `HULL_CLEARANCE` higher:
  // the tilt is identical between them and the settle is the only thing that
  // can change the gap. It has to be a real gap now, because the drop is a
  // fraction of the clearance and a hull resting on the ground has none.
  const hull = doc
    .createNode('hull_hull')
    .setTranslation([0, HULL_CLEARANCE, 0])
    .setMesh(box(doc, 'hull_hull', [-1, 0, -1], [1, 2, 1]))
    .setExtras({ rl_role: 'hull', rl_part: 'hull' });
  const rubber = doc
    .createNode('hull_rubber')
    .setMesh(box(doc, 'hull_rubber', [-1, 0, -1], [1, 2, 1]))
    .setExtras({ rl_role: 'rubber', rl_part: 'hull' });

  const pivot = doc
    .createNode('turret_pivot')
    .setTranslation([PIVOT_X, PIVOT_Y, 0])
    .setExtras({ rl_pivot: 'turret' });
  const turret = doc
    .createNode('turret_metal')
    .setTranslation([0.5, 0, 0])
    .setMesh(box(doc, 'turret_metal', [-0.4, 0, -0.4], [0.4, 1, 0.4]))
    .setExtras({ rl_role: 'metal', rl_part: 'turret' });
  pivot.addChild(turret);

  scene.addChild(hull).addChild(rubber).addChild(pivot);
  return { doc, recipe: { hull: 'wheeled', turretPivot: 'turret_pivot' } };
}

/**
 * A single flat slab, long along one horizontal axis, as an `air` hull so it
 * takes the big `BODY_ROLL_DEG` rather than the 6-degree ground roll.
 *
 * Flat on purpose. Under a roll a box's axis-aligned extent goes
 * `W*cos + H*sin`, so a TALL box's width can grow under the very rotation that
 * is tipping it over, and the measurement stops discriminating. At H = 0.1 x W
 * the cross-term is small and the collapse is unambiguous.
 */
function slabFixture(long: 'x' | 'z'): Fixture {
  const doc = new Document();
  doc.createBuffer();
  const min: vec3 = long === 'x' ? [-2, 0, -1] : [-1, 0, -2];
  const max: vec3 = long === 'x' ? [2, 0.2, 1] : [1, 0.2, 2];
  doc
    .createScene('Scene')
    .addChild(
      doc
        .createNode('hull_hull')
        .setMesh(box(doc, 'hull_hull', min, max))
        .setExtras({ rl_role: 'hull', rl_part: 'hull' })
    );
  return { doc, recipe: { hull: 'air' } };
}

const extent = (b: bbox, axis: number): number => b.max[axis] - b.min[axis];

/** Where a node's own +Y has ended up in world space: the second basis column
 *  of its world matrix, normalised. */
function worldUp(n: Node): vec3 {
  const m = n.getWorldMatrix();
  const len = Math.hypot(m[4], m[5], m[6]) || 1;
  return [m[4] / len, m[5] / len, m[6] / len];
}

const nodeNamed = (doc: Document, name: string): Node | undefined =>
  doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name);

function deathRoot(doc: Document): Node {
  const found = nodeNamed(doc, DEATH_ROOT);
  if (!found) throw new Error(`no ${DEATH_ROOT}`);
  return found;
}

/** World-space Y of a node's origin. */
const worldY = (n: Node): number => n.getWorldTranslation()[1];

const outputOf = (a: Accessor | null): number[] => Array.from(a?.getArray() ?? []);

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('applyWreckPass', () => {
  it('adds death_root with one WRECK_ child per live mesh node, sharing the mesh', () => {
    const { doc, recipe } = fixture();
    const meshesBefore = doc.getRoot().listMeshes().length;

    applyWreckPass(doc, 'fixture', recipe);

    const root = deathRoot(doc);
    expect(root.getParentNode()).toBeNull();
    expect(doc.getRoot().listScenes()[0].listChildren()).toContain(root);
    expect(root.getTranslation()).toEqual([0, 0, 0]);
    expect(root.getScale()).toEqual([1, 1, 1]);

    const children = root.listChildren();
    expect(children.map((c) => c.getName()).sort()).toEqual([
      `${WRECK_PREFIX}hull_hull`,
      `${WRECK_PREFIX}hull_rubber`,
      `${WRECK_PREFIX}turret_metal`,
    ]);

    // The whole point of the contract: a node, not a buffer. The wreck child
    // must reference the very same Mesh object its live twin does.
    for (const child of children) {
      const live = nodeNamed(doc, child.getName().slice(WRECK_PREFIX.length));
      expect(live, child.getName()).toBeDefined();
      expect(child.getMesh()).toBe(live?.getMesh());
      const extras = child.getExtras();
      expect(extras.rl_wreck).toBe(true);
      expect(extras.rl_role).toBe(live?.getExtras().rl_role);
      expect(extras.rl_part).toBe(live?.getExtras().rl_part);
    }
    expect(doc.getRoot().listMeshes().length).toBe(meshesBefore);
  });

  it("bakes a pivot child's transform into its wreck copy", () => {
    const { doc, recipe } = fixture();
    const scene = doc.getRoot().listScenes()[0];
    const bounds = getBounds(scene);
    const length = bounds.max[0] - bounds.min[0];

    const live = nodeNamed(doc, 'turret_metal');
    if (!live) throw new Error('fixture lost turret_metal');
    // Read ACROSS the pivot's horizontal offset, not up it. The ground seat
    // is a Y translation and puts a turret built either way at the same
    // height, so the Y reading this test used to take can no longer tell the
    // two apart -- see `PIVOT_X`.
    const liveWorld = live.getWorldTranslation()[0];
    const liveLocal = live.getTranslation()[0];
    expect(liveWorld).toBeCloseTo(PIVOT_X + 0.5, 6);
    expect(liveLocal).toBeCloseTo(0.5, 6);

    applyWreckPass(doc, 'fixture', recipe);

    const wreck = nodeNamed(doc, `${WRECK_PREFIX}turret_metal`);
    if (!wreck) throw new Error('no WRECK_turret_metal');
    const x = wreck.getWorldTranslation()[0];

    // Forgetting the pivot is the bug this catches, and it is invisible to a
    // "not the identity" check alone -- the part's own local matrix is not the
    // identity either.
    expect(wreck.getMatrix()).not.toEqual(IDENTITY);
    expect(Math.abs(x - liveWorld)).toBeLessThan(Math.abs(x - liveLocal));
    expect(Math.abs(x - liveWorld)).toBeLessThan(0.6 * length);
  });

  it('settles the body into its own clearance: the hull drops and the rubber does not', () => {
    const { doc, recipe } = fixture();

    const liveHull = nodeNamed(doc, 'hull_hull');
    const liveRubber = nodeNamed(doc, 'hull_rubber');
    if (!liveHull || !liveRubber) throw new Error('missing live hull parts');
    const liveGap = worldY(liveHull) - worldY(liveRubber);
    expect(liveGap).toBeCloseTo(HULL_CLEARANCE, 6);

    applyWreckPass(doc, 'fixture', recipe);

    const hull = nodeNamed(doc, `${WRECK_PREFIX}hull_hull`);
    const rubber = nodeNamed(doc, `${WRECK_PREFIX}hull_rubber`);
    if (!hull || !rubber) throw new Error('missing wreck hull parts');

    // The two share a box and a tilt, and the ground seat is one translation
    // applied to both, so everything cancels between them except the settle.
    // What is left of the gap is `(clearance - drop) * cos(roll)cos(pitch)`,
    // and the CHANGE in it is therefore the drop. Half the nominal is the
    // floor so the angles can be retuned without touching this.
    const settle = liveGap - (worldY(hull) - worldY(rubber));
    const nominal = WRECK_FRACTIONS.HULL_DROP * HULL_CLEARANCE;
    expect(settle).toBeGreaterThan(0.5 * nominal);
    expect(settle).toBeLessThan(1.5 * nominal);
  });

  it('seats every group on the ground plane, so no part of a wreck is under the terrain', () => {
    const { doc, recipe } = fixture();
    const groundY = getBounds(doc.getRoot().listScenes()[0]).min[1];

    applyWreckPass(doc, 'fixture', recipe);

    // `getBounds` accumulates over the TRANSFORMED vertices, so `min[1]` here
    // is the exact lowest point of the posed part and not a rotated box's
    // corner. Two groups in this fixture: the body, and the thrown turret.
    const lowest = (ns: Node[]): number => Math.min(...ns.map((n) => getBounds(n).min[1]));
    const children = deathRoot(doc).listChildren();
    const turret = children.filter((c) => c.getName().includes('turret'));
    const body = children.filter((c) => !c.getName().includes('turret'));
    expect(body.length).toBe(2);
    expect(turret.length).toBe(1);

    // Exactly ON the ground, both of them: the tilt would otherwise bury the
    // body's low corner (every shipped wreck stood 0.20-0.69 units under it
    // before this) and the throw would leave the turret in the air (the
    // shipped Eitan's hung 2.06 above the sand).
    expect(lowest(body)).toBeCloseTo(groundY, 6);
    expect(lowest(turret)).toBeCloseTo(groundY, 6);
  });

  // The axes are not fixed: eight of the eleven shipped vehicles run along X
  // and three do not. A roll hardcoded about world Z lays a Z-long vehicle on
  // its side and stands an X-long one on its NOSE -- which is what
  // `heli_peten` was doing, its fuselage running along X. Both orientations
  // are asserted, because a version reading `m.longAxis` and a version
  // hardcoding one axis are each right for exactly one of them.
  //
  // The assertion is where the body's own UP ends up, not how wide its
  // bounding box is, and that is a correction made after measuring. "The
  // perpendicular extent collapses" is the natural phrasing and it is FALSE
  // here: the 4-degree pitch tilts a 4-long body's length into Y, that Y then
  // feeds the roll's `W*cos + H*sin` cross-term, and the perpendicular AABB
  // extent comes out at 1.0074x -- it GROWS. An axis-aligned box measurement
  // cannot see this rotation. The up vector can, exactly: rolling about the
  // long axis tips up ACROSS the body and the pitch tips it ALONG, and the
  // defect SWAPS the two -- so the ratio between them inverts, and 1.0 is
  // where the boundary genuinely is rather than a number fitted to one set of
  // angles. (It was 3.0 against the first `BODY_ROLL_DEG` 25 / `HULL_PITCH_DEG`
  // 4, a ratio of 6.04 correct against 0.166 defective. The tuned 10 / 7 reads
  // 1.42 against 0.70, so a 3.0 floor would now fail the CORRECT
  // implementation.) The premise the boundary rests on -- that the air roll is
  // the larger of the two -- is asserted rather than assumed, just below, so a
  // future retune that broke it fails by name instead of by arithmetic. The
  // mirror-symmetry case after this one pins the rest to nine places.
  for (const [long, longAxis, perpAxis] of [
    ['x', 0, 2],
    ['z', 2, 0],
  ] as const) {
    it(`rolls a ${long}-long body about its own long axis, tipping it sideways and not onto its nose`, () => {
      // What makes the 1.0 boundary above discriminating at all.
      expect(WRECK_FRACTIONS.BODY_ROLL_DEG).toBeGreaterThan(WRECK_FRACTIONS.HULL_PITCH_DEG);

      const { doc, recipe } = slabFixture(long);

      applyWreckPass(doc, `slab_${long}`, recipe);

      const up = worldUp(deathRoot(doc).listChildren()[0]);
      expect(Math.abs(up[perpAxis])).toBeGreaterThan(Math.abs(up[longAxis]));
      expect(up[1]).toBeGreaterThan(0); // still broadly upright, not flipped
    });
  }

  it('treats an x-long and a z-long body identically in their own frames', () => {
    // The symmetry a hardcoded axis cannot have. Measured: both come out at
    // 1.0011 along and 1.0074 across, bit-identical -- so this is an equality,
    // not a tolerance, and it fails on either half of the swap.
    const ratios = (long: 'x' | 'z'): [number, number] => {
      const { doc, recipe } = slabFixture(long);
      const live = getBounds(doc.getRoot().listScenes()[0]);
      applyWreckPass(doc, `slab_${long}`, recipe);
      const wreck = getBounds(deathRoot(doc));
      const [longAxis, perpAxis] = long === 'x' ? [0, 2] : [2, 0];
      return [
        extent(wreck, longAxis) / extent(live, longAxis),
        extent(wreck, perpAxis) / extent(live, perpAxis),
      ];
    };
    const [alongX, acrossX] = ratios('x');
    const [alongZ, acrossZ] = ratios('z');
    expect(alongX).toBeCloseTo(alongZ, 9);
    expect(acrossX).toBeCloseTo(acrossZ, 9);
  });

  it('keys idle and wreck as constant scale channels on every top-level live node and death_root', () => {
    const { doc, recipe } = fixture();
    const liveTop = doc.getRoot().listScenes()[0].listChildren();
    expect(liveTop.length).toBe(3);

    applyWreckPass(doc, 'fixture', recipe);

    const animations = doc.getRoot().listAnimations();
    expect(animations.map((a) => a.getName())).toEqual([CLIP_IDLE, CLIP_WRECK]);

    const root = deathRoot(doc);
    for (const animation of animations) {
      const channels = animation.listChannels();
      expect(channels.length, animation.getName()).toBe(liveTop.length + 1);
      expect(new Set(channels.map((c) => c.getTargetNode()))).toEqual(new Set([...liveTop, root]));

      for (const channel of channels) {
        expect(channel.getTargetPath()).toBe('scale');
        const sampler = channel.getSampler();
        if (!sampler) throw new Error('channel with no sampler');
        expect(sampler.getInterpolation()).toBe('STEP');
        // Float32, so 0.1 reads back as 0.10000000149011612.
        const times = outputOf(sampler.getInput());
        expect(times.length).toBe(2);
        expect(times[0]).toBe(0);
        expect(times[1]).toBeCloseTo(CLIP_SECONDS, 6);

        const alive = animation.getName() === CLIP_IDLE;
        const dead = channel.getTargetNode() === root;
        // `idle` shows the live geometry and hides the wreck; `wreck` is the
        // reverse. A constant, so both keyframes carry it.
        const on = alive !== dead;
        expect(outputOf(sampler.getOutput()), `${animation.getName()} ${dead ? DEATH_ROOT : 'live'}`).toEqual(
          on ? [1, 1, 1, 1, 1, 1] : [0, 0, 0, 0, 0, 0]
        );
      }
    }
  });

  it('is idempotent: running twice leaves the same node and animation count and equal bytes', async () => {
    const { doc, recipe } = fixture();
    applyWreckPass(doc, 'fixture', recipe);
    const once = await io.writeBinary(doc);
    const nodes = doc.getRoot().listNodes().length;
    const accessors = doc.getRoot().listAccessors().length;

    applyWreckPass(doc, 'fixture', recipe);
    const twice = await io.writeBinary(doc);

    expect(doc.getRoot().listNodes().length).toBe(nodes);
    expect(doc.getRoot().listAnimations().length).toBe(2);
    // Orphaned accessors are the trap: disposing an Animation leaves its
    // samplers' input/output accessors on the Root, and the writer emits
    // everything the Root holds -- so a pass that only disposes the animation
    // grows the file on every run.
    expect(doc.getRoot().listAccessors().length).toBe(accessors);
    expect(Buffer.from(twice).equals(Buffer.from(once))).toBe(true);
  });

  it('strips a stale death_root and stale clips before rebuilding', () => {
    const { doc, recipe } = fixture();
    const buffer = doc.getRoot().listBuffers()[0];

    const stale = doc.createNode(DEATH_ROOT);
    stale.addChild(doc.createNode(`${WRECK_PREFIX}bogus`));
    doc.getRoot().listScenes()[0].addChild(stale);

    const times = doc.createAccessor('stale_t', buffer).setType('SCALAR').setArray(new Float32Array([0, 1]));
    const values = doc
      .createAccessor('stale_v', buffer)
      .setType('VEC3')
      .setArray(new Float32Array([1, 1, 1, 2, 2, 2]));
    const sampler = doc.createAnimationSampler().setInput(times).setOutput(values).setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel().setTargetPath('scale').setTargetNode(stale).setSampler(sampler);
    doc.createAnimation(CLIP_IDLE).addSampler(sampler).addChannel(channel);

    applyWreckPass(doc, 'fixture', recipe);

    expect(doc.getRoot().listNodes().filter((n) => n.getName() === DEATH_ROOT).length).toBe(1);
    expect(nodeNamed(doc, `${WRECK_PREFIX}bogus`)).toBeUndefined();
    expect(deathRoot(doc).listChildren().length).toBe(3);
    expect(doc.getRoot().listAnimations().map((a) => a.getName())).toEqual([CLIP_IDLE, CLIP_WRECK]);
    for (const animation of doc.getRoot().listAnimations()) {
      for (const s of animation.listSamplers()) expect(s.getInterpolation()).toBe('STEP');
    }
    expect(doc.getRoot().listAccessors().find((a) => a.getName() === 'stale_t')).toBeUndefined();
    expect(doc.getRoot().listAccessors().find((a) => a.getName() === 'stale_v')).toBeUndefined();
  });

  it('does not grow the buffer by more than the two clips need', async () => {
    const { doc, recipe } = fixture();
    const before = (await io.writeBinary(doc)).length;
    applyWreckPass(doc, 'fixture', recipe);
    const after = (await io.writeBinary(doc)).length;
    // Three accessors of 8/24/24 bytes and a dozen JSON objects. The failure
    // worth catching is a pass that COPIES geometry instead of referencing it,
    // which on a real vehicle is megabytes and on this fixture is still far
    // past a kilobyte.
    expect(after - before).toBeGreaterThan(0);
    expect(after - before).toBeLessThan(2048);
  });

  it('refuses a node the recipe names but the document does not have', () => {
    const { doc } = fixture();
    expect(() => applyWreckPass(doc, 'fixture', { hull: 'wheeled', turretPivot: 'no_such_pivot' })).toThrow(
      /no_such_pivot/
    );
  });
});

describe('runWreckPass', () => {
  it('refuses a vehicle with no recipe', async () => {
    await expect(runWreckPass(['not_a_vehicle'])).rejects.toThrow(/not_a_vehicle/);
  });
});

describe('parseWreckArgs', () => {
  it('reads --id= flags, and tolerates the separator pnpm forwards verbatim', () => {
    expect(parseWreckArgs([])).toBe('all');
    expect(parseWreckArgs(['--'])).toBe('all');
    expect(parseWreckArgs(['--', '--id=mbt_lavi', '--id=technical'])).toEqual(['mbt_lavi', 'technical']);
  });

  // Falling through to "all eleven" on an argument nobody recognised rewrites
  // 25 MB of tracked art the caller never asked about. A destructive default
  // reached by a typo is worse than an error.
  for (const argv of [
    ['--id', 'mbt_lavi'],
    ['--ids=mbt_lavi'],
    ['--id='],
    ['mbt_lavi'],
    ['--all'],
    ['--id=mbt_lavi', '--force'],
  ]) {
    it(`refuses [${argv.join(' ')}] rather than defaulting to all eleven`, () => {
      expect(() => parseWreckArgs(argv)).toThrow(/unrecognised argument/);
    });
  }
});

describe('WRECK_RECIPES', () => {
  it('names the eleven shipped vehicles and nothing else', () => {
    expect(Object.keys(WRECK_RECIPES).sort()).toEqual([
      'apc_eitan',
      'apc_kipod',
      'dozer_d9',
      'heli_peten',
      'ifv_namer',
      'jeep_shoded',
      'mbt_lavi',
      'paramotor',
      'rocket_battery',
      'scout_shachaf',
      'technical',
    ]);
  });
});
