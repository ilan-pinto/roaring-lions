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
}

export type DamageOp = ThrowTrack | PeelPlate | BreakBarrel;

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
 * The Lavi's three, measured 2026-10-14 off `mbt_lavi.glb`:
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

export const DAMAGE_RECIPES: Readonly<Record<string, readonly DamageOp[]>> = {
  mbt_lavi: LAVI,
  // GH-298: the command Lavi is the shipped Lavi plus a cupola, a mast and
  // whips joined into its turret nodes (`export_officer_armour.py`, which
  // drops every WRECK_ object on import), so it takes the Lavi's own damage.
  // Its turret_metal has nothing forward of x 1.55 but the same gun tube.
  officer_armour: LAVI,
  ifv_namer: NAMER,
  dozer_d9: D9,
};
