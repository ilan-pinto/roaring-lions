/**
 * Per-vehicle damage recipes: which outline-changing damage a vehicle's wreck
 * wears, and where.
 *
 * The lead's rule (2026-10-14, after the Lane B mock in
 * `docs/superpowers/specs/2026-10-14-wreck-damage-design.md`): **only damage
 * that changes the outline reads**. A thrown track on the sand, a peeled
 * plate, a broken barrel read at zoom 1.0. A roof hole or a cavity does not,
 * because a charred wreck draws near-black and a dark hole in it has nothing
 * to stand out against. So there is no `hole` verb here, by ruling, and
 * missing road wheels on a SKIRTED tank (the skirts hide them) are not
 * offered either.
 *
 * Authored in code beside the geometry it describes, like `wreck-recipes.ts`
 * and `running-gear-recipes.ts`. Every distance is in GLB units (1 unit =
 * 1 m), in the SOURCE mesh's own space -- +X forward, +Y up, +Z the hull's
 * physical right -- measured off the shipped bytes, with the measurement
 * recorded beside each number.
 */

/** +1 is +Z, the hull's physical right; -1 the left. */
import { rescaleOf } from './rescale-contract';

export type Side = 1 | -1;

/**
 * One side's visible track run, lifted off the wheels as ONE strip and laid
 * on the sand: slid back along the hull and curving out from it, with a slow
 * wave so it does not lie ruler-straight. Selected by #550's `_RL_TRACK`
 * tag on `hull_rubber`, so it needs no region at all.
 */
export interface ThrowTrack {
  readonly verb: 'throwTrack';
  readonly side: Side;
  /** How far back the strip slides, m (negative = rearward). */
  readonly slide: number;
  /** Outward offset at the strip's front end and its growth to the rear, m. */
  readonly out0: number;
  readonly out1: number;
  /** Amplitude of the lateral wave, m. */
  readonly wave: number;
  /** Faces whose centroid sits below this height (m) are the lower run and lie out on the sand; any tagged face above it (an upper return run, the top of the sprocket and idler) is gone with the track. */
  readonly lowY: number;
}

/**
 * A plate torn along a jagged edge and swung outward about one edge (`hinge`),
 * with its inside face added so the peeled side does not vanish under back-face
 * culling, and a backing across the opening so the hull does not read as
 * hollow. Faces are picked by their normal (`normalMin` along the side) and a
 * box whose edges are bent by closed periodic noise.
 */
export interface PeelPlate {
  readonly verb: 'peelPlate';
  readonly mesh: string;
  readonly side: Side;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly normalMin: number;
  /** Only faces whose centroid lies at least this far out along the side (|z|, m): the OUTER plate, not an inner wall that happens to face the same way. */
  readonly zMin: number;
  /** Add a backing across the opening (for a plate with nothing modelled behind it). */
  readonly backing: boolean;
  /** The edge the plate stays attached by: `top` folds it out like a shelf, `rear`/`front` swing it out like a door about that vertical edge. */
  readonly hinge: 'top' | 'rear' | 'front';
  /** Peel angle about the hinge, degrees outward. */
  readonly angleDeg: number;
  /** Jag of the torn edges, m. Faces are picked by CENTROID, so on a coarse plate the tear follows the triangle edges and this bites only on a finer mesh: on the Lavi's 17-triangle skirt, 0.07 -> 0.09 changes no selected face (the one surviving mutation, disclosed in the design record §5). */
  readonly jag: number;
  readonly seed: number;
}

/**
 * The gun barrel broken where it leaves the mantlet and drooping to the sand.
 * Every face whose three vertices lie forward of `breakX` is detached and
 * turned, in the WRECK node's ground frame, about a horizontal axis across
 * the barrel through its root -- by `droopDeg`, or less if that would put the
 * muzzle below the ground.
 */
export interface BreakBarrel {
  readonly verb: 'breakBarrel';
  readonly mesh: string;
  readonly breakX: number;
  readonly droopDeg: number;
  /** Only faces within this distance of the barrel axis (y, z) move: the mantlet ring and anything else forward of the break stay. */
  readonly axisRadius: number;
  /**
   * The bore's elevation above the hull's X axis, degrees (default 0, a level
   * gun). A howitzer's is raised: the axis is then the inclined line through
   * the centroid of the vertices forward of `breakX`, the radius is measured
   * from THAT line, and the droop turns about its root, so a gun at 35 degrees
   * is not judged against a horizontal one (which would pick none of the tube).
   */
  readonly elevationDeg?: number;
}

/**
 * A wheeled hull's lost tyre (the lead's "wheel-off corner drop"): every
 * face of that wheel (`_RL_WHEEL = wheel + 1`, #550) farther from the axle
 * than the rim (`WRECK_FRACTIONS.LOST_WHEEL_RIM_FRAC`) is cut out and laid
 * flat on the sand outboard of its corner. The
 * corner itself comes down in the WRECK pass (`WreckRecipe.lostWheel`, which
 * must name the same wheel -- `damage-pass.test.ts` holds the two tables
 * together), so the hub this leaves bare is what the wreck rests on.
 */
export interface DropTyre {
  readonly verb: 'dropTyre';
  /** The mesh the tyre is cut from: `hull_rubber`, plus `hull_hull` where a bake put tread there AND the cap allows the copy. */
  readonly mesh: string;
  readonly wheel: number;
  /** Where the tyre lies, from its own axle in the ground frame: along the hull (m), and out past the hull's side (m). */
  readonly along: number;
  readonly out: number;
  readonly yawDeg: number;
}

/**
 * Glass blown out of its frames: every face of one mesh goes except a
 * scatter of shards, a fixed-hash `keep` fraction of them (a twin must keep a
 * mesh -- the wreck contract wants one `WRECK_` child per live mesh node, and
 * glTF has no empty primitive). Index work, so the copy is SMALLER than its
 * source. With the far side's glass gone too, the cab reads see-through
 * against the ground: an outline change, which is why it qualifies.
 */
export interface BlowOut {
  readonly verb: 'blowOut';
  readonly mesh: string;
  readonly keep: number;
}

/**
 * A helicopter's rotor snapped: the one rigid disc is split into its blades
 * (faces farther than `hubRadius` from the mast, grouped by angle, a blade
 * being a run of occupied 15-degree sectors), every blade droops toward the
 * sand about the hub -- in the GROUND frame, whichever way the wreck pass bent
 * the disc -- and one blade's outer part, past `snapAt`, is broken off and
 * lies flat on the sand beside the fuselage. Closes the wreck spec's §7.9
 * follow-up: a rigid rotor stood up whichever way the body tilted.
 */
export interface SnapRotor {
  readonly verb: 'snapRotor';
  readonly mesh: string;
  readonly hubRadius: number;
  readonly droopDeg: number;
  readonly snapBlade: number;
  readonly snapAt: number;
  /** Where the broken piece lies, in the ground frame, m; and its yaw. */
  readonly lieAt: readonly [number, number];
  readonly yawDeg: number;
}

/**
 * The damaged copy simplified, ONLY to fit the cap (the lead's ruling R4:
 * "the big trucks and the helicopter may have their damaged copies simplified
 * to fit the cap"; the art rule: models at maximum detail, simplified only to a
 * measured budget). meshoptimizer's `simplify` (an exact devDependency of
 * tools), keeping `ratio` of the indices at most and stopping at `maxError`
 * (relative to the mesh's own extent, meshopt's default scale).
 *
 * Put it FIRST on its mesh. It then runs on the shipped bytes themselves,
 * which are identical on every machine, so its collapse decisions are too;
 * the verbs after it only move vertices, and their trigonometry differs across
 * Node versions in the last float bits (#614's CI lesson), which a collapse
 * decision taken after them could amplify into a different index buffer.
 */
export interface Simplify {
  readonly verb: 'simplify';
  readonly mesh: string;
  readonly ratio: number;
  readonly maxError: number;
  /** meshopt flags. `Permissive` lets collapses cross UV seams, which this bake is full of. */
  readonly flags?: readonly ('LockBorder' | 'Prune' | 'Permissive' | 'Regularize')[];
}

export type DamageOp = ThrowTrack | PeelPlate | BreakBarrel | DropTyre | BlowOut | SnapRotor | Simplify;

/**
 * The per-vehicle cap on what the damaged copies may add (the lead's ruling,
 * 2026-10-14): 64 KiB to the Draco mirror a browser downloads and 512 KiB to
 * the raw source of record. Measured on the copies themselves -- the Draco
 * `bufferView`s / raw accessor bytes of every mesh a wreck node owns through
 * `rl_damage` -- by `tools/validate_mesh_assets.py`, which reads this file
 * for the two numbers.
 */
export const DAMAGE_CAP_DRACO_BYTES = 65536;
export const DAMAGE_CAP_RAW_BYTES = 524288;

/**
 * The Lavi's three, measured 2026-10-14 off `mbt_lavi.glb` -- in the 6.32 m
 * frame, before the x1.18 rescale (`scaleDamageOps` carries them over):
 *
 *   - track: the tagged lower run is x -2.73..1.46 at |z| 1.02-1.19, y 0-0.37
 *     (ramps at both ends);
 *   - plate: the +Z skirt between x -2.05 and -0.30 (skirt faces have
 *     normal.z > 0.55 and reach down to y 0.31). The skirt's outer face
 *     sits at |z| 1.4; faces facing +Z at |z| 0.8-1.2 are the road wheels'
 *     upper halves and the hull side behind it, and on the -Z side the
 *     skirt's own INNER wall faces +Z too (about 120 faces in this box), so
 *     `zMin` 1.3 is what picks the plate. With the wheels modelled behind
 *     it, the opening needs no backing;
 *   - barrel: `turret_metal` carries no vertex between x 1.79 and 3.00 --
 *     the tube is one run of long faces from the ring at x 1.5-1.79 to the
 *     muzzle at 3.16, radius about 0.1 about (y 1.70, z 0.01). Break at 1.55
 *     takes the whole tube and leaves the mantlet (x 0.5-1.3).
 *
 * The plate and the thrown track are on the same side, so both face the
 * camera at the same two headings. The plate is a DOOR swung 55 degrees about
 * its rear edge: folded out about its top edge (the first try, 80 degrees) it
 * lay flat as a shelf and photographed as nothing from this camera.
 */
const LAVI: readonly DamageOp[] = [
  { verb: 'throwTrack', side: 1, slide: -1.3, out0: 0.55, out1: 1.35, wave: 0.13, lowY: 0.6 },
  {
    verb: 'peelPlate',
    mesh: 'hull_hull',
    side: 1,
    x0: -2.05,
    x1: -0.3,
    y0: 0.33,
    y1: 1.1,
    normalMin: 0.55,
    zMin: 1.3,
    backing: false,
    hinge: 'rear',
    angleDeg: 55,
    jag: 0.07,
    seed: 1,
  },
  { verb: 'breakBarrel', mesh: 'turret_metal', breakX: 1.55, droopDeg: 28, axisRadius: 0.2 },
];

/**
 * Ops measured in one frame, carried into a frame `f` times larger: every
 * length scales, angles, normals, seeds and flags do not. The Lavi's three
 * were measured on the 6.32 m export and stay as measured; the shipped file is
 * x`LAVI_RESCALE` (`rescale-contract.ts`), and the damage pass runs after it.
 * Only the verbs the Lavi uses are handled: a fourth must say what its lengths
 * are before it can be scaled.
 */
export function scaleDamageOps(ops: readonly DamageOp[], f: number): readonly DamageOp[] {
  return ops.map((op): DamageOp => {
    switch (op.verb) {
      case 'throwTrack':
        return { ...op, slide: op.slide * f, out0: op.out0 * f, out1: op.out1 * f, wave: op.wave * f, lowY: op.lowY * f };
      case 'peelPlate':
        return { ...op, x0: op.x0 * f, x1: op.x1 * f, y0: op.y0 * f, y1: op.y1 * f, zMin: op.zMin * f, jag: op.jag * f };
      case 'breakBarrel':
        return { ...op, breakX: op.breakX * f, axisRadius: op.axisRadius * f };
      default:
        throw new Error(`scaleDamageOps: no length list for verb "${op.verb}"`);
    }
  });
}

/**
 * The Namer and the D9: a thrown track and nothing else, because the cap
 * allows nothing else. Each one's `hull_rubber` copy is most of the 64 KiB on
 * its own (48,415 / 52,382 Draco bytes live, 2026-10-14), so a plate on
 * `hull_hull` (25,985 / 39,256) would take either file over it.
 *
 * Both tag the WHOLE loop (`_RL_TRACK` runs over the upper return run at
 * y 1.1-1.3 too), unlike the Lavi, whose scan only has the lower run: the
 * lower run is y 0.03-0.07 with the end ramps rising to about 0.5, so
 * `lowY` 0.6 keeps the run and its feet and drops the return run.
 *
 * Their hulls are wider than their tracks (Namer |z| 2.06 against a track
 * centre at 1.6-1.7; the D9's blade reaches 2.13 against 1.6), so the strip
 * starts further out than the Lavi's to clear the hull's own outline.
 */
const NAMER: readonly DamageOp[] = [
  { verb: 'throwTrack', side: 1, slide: -1.6, out0: 0.95, out1: 1.4, wave: 0.15, lowY: 0.6 },
];
const D9: readonly DamageOp[] = [
  { verb: 'throwTrack', side: 1, slide: -1.4, out0: 0.85, out1: 1.4, wave: 0.15, lowY: 0.6 },
];

/**
 * Wheeled hulls: the rear +Z tyre is gone (`WreckRecipe.lostWheel` drops that
 * corner onto its hub; it is the corner the slump already lowers) and lies
 * flat on the sand behind and outboard of it. Only `hull_rubber` is copied:
 * the Eitan's hull and rubber copies together would exceed the cap
 * (37,352 + 43,468 Draco bytes live). `wheel` indexes `rl_running_gear` and
 * must equal the wreck recipe's `lostWheel` (`damage-pass.test.ts`).
 */
const lostRearTyre = (wheel: number, mesh = 'hull_rubber'): DamageOp => ({ verb: 'dropTyre', mesh, wheel, along: -1.2, out: 0.8, yawDeg: 25 });

const ROTOR: DamageOp = {
  verb: 'snapRotor',
  mesh: 'rotor_metal',
  hubRadius: 0.6,
  droopDeg: 32,
  snapBlade: 0,
  snapAt: 1.1,
  lieAt: [-2.2, 2.0],
  yawDeg: 35,
};

export const DAMAGE_RECIPES: Readonly<Record<string, readonly DamageOp[]>> = {
  mbt_lavi: scaleDamageOps(LAVI, rescaleOf('mbt_lavi')),
  // GH-298: the command Lavi is the shipped Lavi plus a cupola, a mast and
  // whips joined into its turret nodes (`export_officer_armour.py`, which
  // drops every WRECK_ object on import), so it takes the Lavi's own damage.
  // Its turret_metal has nothing forward of x 1.55 but the same gun tube.
  officer_armour: scaleDamageOps(LAVI, rescaleOf('officer_armour')),
  // GH-709: the Lavi Ambush Tank: the Lavi's thrown track and drooped barrel,
  // NOT its skirt plate. The plate op copies all of `hull_hull`, which carries
  // the net (~8,000 more triangles), and that copy alone took the file to
  // 657,332 raw bytes against the 524,288 cap (measured 2026-10-22).
  mbt_lavi_camo: scaleDamageOps(
    LAVI.filter((op) => op.verb !== 'peelPlate'),
    rescaleOf('mbt_lavi_camo'),
  ),
  ifv_namer: NAMER,
  dozer_d9: D9,
  apc_eitan: [lostRearTyre(3)],
  apc_kipod: [lostRearTyre(2)],
  // The soft-skins. Rubber only, except the gun truck, whose bake puts part
  // of each tyre in `hull_hull` and whose hull copy still fits the cap
  // (47,506 + 5,938 Draco bytes live); its cab glass is blown out too, the
  // one soft-skin that models glass at all (`hull_glass`, 881 Draco bytes --
  // the jeep's, the technical's and the Shachaf's windows are painted into
  // the bake, so there is nothing to blow out). The jeep's and the
  // technical's hull copies would not fit: their tread in `hull_hull` sinks
  // into the sand with the corner instead.
  jeep_shoded: [lostRearTyre(1)],
  technical: [lostRearTyre(1)],
  scout_shachaf: [lostRearTyre(1)],
  gun_truck: [lostRearTyre(1), lostRearTyre(1, 'hull_hull'), { verb: 'blowOut', mesh: 'hull_glass', keep: 0.15 }],
  // The Peten and the Gunship (its own export plus stores): `rotor_metal` is
  // 8,450 vertices, five blades 4.1 m across about a hub at mesh-space
  // (0.40, 1.16, 0.01) -- the angular census puts blade clusters about 72
  // degrees apart with empty sectors between, which is what the split reads.
  // The copy costs about the live rotor's 50,130 Draco bytes, inside the cap.
  // The rocket battery (R4, a big truck): its `hull_rubber` is 77,049 Draco
  // bytes live, so even an unsimplified rubber copy is 77,756 Draco / 766,776
  // raw (119% / 146% of the cap). Simplified FIRST, then the rear +Z tyre
  // (wheel 2 of six) drops. The ratio is the LARGEST on a 0.01 grid that fits
  // both caps -- the raw one binds. Measured 2026-10-15 (copy Draco / raw,
  // share of cap, triangles of 10,839, meshopt error relative to extent):
  //
  //   0.78  65,392 100% / 551,374 105%   8,399  1.54e-3
  //   0.76  64,432  98% / 533,422 102%   8,182  1.69e-3
  //   0.75  63,806  97% / 525,091 100%   8,070  1.76e-3   (raw: 803 bytes over)
  //   0.74  63,266  97% / 517,561  99%   7,962  1.85e-3   <- shipped
  //   0.70  60,817  93% / 484,483  92%   7,518  2.18e-3
  //
  // Without `Permissive` it stalls at 8,672 triangles whatever the ratio
  // (still 102% / 128%): the bake splits 5,015 positions into 18,851 vertices
  // (none exact duplicates -- every one differs in UV or normal), and every
  // split is a seam meshopt will not collapse across. 1.85e-3 of a 6.9 m
  // hull is about 1.3 cm.
  rocket_battery: [
    { verb: 'simplify', mesh: 'hull_rubber', ratio: 0.74, maxError: 0.01, flags: ['Permissive'] },
    lostRearTyre(2),
  ],
  heli_peten: [ROTOR],
  heli_peten_gunship: [ROTOR],
  // GH-698 (held): the Yanshuf's `rotor_metal` is a four-blade disc 4.32 m
  // across about a hub at mesh-space (0.60, 1.55, 0.00), hub blob ~0.43 m
  // (tools/vehicles/export_meshy_yanshuf.py's own census: 4 blades, 15 of 72
  // five-degree sectors), so the Peten's op reads it as four clusters about
  // 90 degrees apart with empty sectors between. Same droop, snap and lie.
  heli_yanshuf: [ROTOR],
  // GH-709 (2026-10-22): the Te'o Howitzer: a thrown track and its raised gun
  // broken at the sleeve and drooped to the sand. The gun is at 35 degrees
  // (`elevationDeg`), the tube straight from x 2.4 (mesh space, the sleeve and
  // rails behind it stay on the mantlet); `axisRadius` 0.3 takes the tube
  // (radius 0.13) and nothing of the rails. `droopDeg` is the angle from 35
  // down to the sand: 60 leaves it 25 degrees below the horizontal if the
  // ground allows, and the pass shortens it where the muzzle would go under.
  // The rubber copy is simplified to the cap, as the rocket battery's is (R4): the
  // track band, six road wheels, sprocket and idler are 27,657 triangles live, so an
  // unsimplified copy is several times the 64 KiB. The ratio is the LARGEST on a
  // 0.01 grid whose copies (rubber + the gun, 3,419 triangles of `turret_metal`)
  // fit; the DRACO cap binds, not the raw one. Measured 2026-10-22 (Draco bytes /
  // share of cap, raw bytes, triangles of 27,657, meshopt error relative to extent):
  //
  //   0.25  72,100 110% / 401,288  6,862  3.61e-3   (over)
  //   0.22  66,399 101% / 362,965  6,020  4.02e-3   (over)
  //   0.21  64,478  98% / 350,302  5,739  4.25e-3   <- shipped
  //   0.20  62,478  95% / 339,167  5,501  4.38e-3
  //   0.18  57,877  88% / 312,768  4,941  4.58e-3
  //
  // 4.25e-3 of the 6.8 m hull is about 3 cm; the copy is drawn charred and black.
  spg_long_range: [
    { verb: 'simplify', mesh: 'hull_rubber', ratio: 0.21, maxError: 0.01, flags: ['Permissive'] },
    { verb: 'throwTrack', side: 1, slide: -1.5, out0: 0.6, out1: 1.3, wave: 0.13, lowY: 0.6 },
    { verb: 'breakBarrel', mesh: 'turret_metal', breakX: 2.3, droopDeg: 60, axisRadius: 0.3, elevationDeg: 35 },
  ],
};
