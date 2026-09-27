/**
 * The closed role vocabulary for the props Blender kit (ground plan 2,
 * Task 3, N-12) -- jersey barrier, water tank, satellite dish, laundry line,
 * tyre pile, rebar, wrecked car. Its own asset class, the same reasoning
 * `decor-role.ts` gives for decor's `foliage/trunk/rock/sand`: a prop's
 * material vocabulary (concrete, sheet metal, rust, rubber, cloth) is not
 * `hull`/`plate` in any useful sense, and reusing a vehicle or decor role
 * name would make a prop GLB silently loadable as one of those instead.
 *
 * Unlike decor, `PROP_KINDS` and the role table are separate: a family (the
 * wrecked car) can carry more than one role at once (rust hood, metal body,
 * rubber tyres), so the closed set here is roles, not kinds -- `PROP_KINDS`
 * below is the seven authored shapes, `PROP_MESH_ROLES` is the five surface
 * materials any of them may tag a mesh node with.
 */
import { readRamp } from '../units/mesh-role';

export const PROP_MESH_ROLES = ['concrete', 'metal', 'rust', 'rubber', 'cloth'] as const;

export type PropMeshRole = (typeof PROP_MESH_ROLES)[number];

export function isPropMeshRole(role: string): role is PropMeshRole {
  return (PROP_MESH_ROLES as readonly string[]).includes(role);
}

/** `readRamp(band).slice(index)` to the end of the band -- the same shading
 *  convention `decor-role.ts`/`vehicle-mesh-role.ts` use for every entry in
 *  their own tables. */
function sliceFrom(band: string, index: number): readonly string[] {
  return readRamp(band).slice(index);
}

const PROP_ROLE_PALETTE: Record<PropMeshRole, readonly string[]> = {
  // Jersey barrier, sun-bleached poured concrete. Same band `decor-role.ts`
  // gives `sand` (litter) but starting two steps lighter/higher on the ramp,
  // since a barrier is a fresh masonry surface, not ground grit.
  concrete: sliceFrom('limestone', 2),
  // Water tank, satellite dish, the wrecked car's door and body: cold sheet
  // metal, the same ramp `mesh-role.ts` gives `metal`/`weapon`. Starts one
  // step in so the lit face never bleaches to the ramp's own near-white top.
  metal: sliceFrom('gunmetal', 1),
  // Rebar, tyre-pile wire, the wrecked car's hood: oxidised iron. `dust` is
  // the warm brown-orange band already used for sand/dirt/rubble, sliced deep
  // (index 5 of 7) so rust reads distinctly darker and more orange than the
  // `rust`-free `dust` tones scattered ground decor already uses.
  rust: sliceFrom('dust', 5),
  // Tyre pile: matte black rubber. `shadow` is the ramp `mesh-role.ts` keeps
  // for cast shadow and night base -- a stack of worn tyres is exactly that
  // dark, and taking the WHOLE band (index 0) keeps its lightest step legible
  // rather than crushing every tyre to the ramp's own darkest tone.
  rubber: sliceFrom('shadow', 0),
  // Laundry line washing: pale cloth catching the sky, not the ground.
  // `water` is the ramp used for sky gradient and cisterns -- the only pale,
  // cool-toned two-step band on the palette, and the one that reads as cloth
  // rather than as stone (`limestone`) or dirt (`dust`).
  cloth: sliceFrom('water', 0),
};

export function rampForPropRole(role: string): readonly string[] {
  if (!isPropMeshRole(role)) {
    throw new Error(
      `prop-role: unknown prop role "${role}" -- not in the closed prop role vocabulary`
    );
  }
  return PROP_ROLE_PALETTE[role];
}

/** The seven authored prop shapes (ART_PIPELINE §6, R-5). One builder
 *  function per kind in `tools/terrain/props.py`; one GLB per kind in
 *  `art/meshes/props/`. */
export const PROP_KINDS = [
  'jersey_barrier',
  'water_tank',
  'satellite_dish',
  'laundry_line',
  'tyre_pile',
  'rebar',
  'wrecked_car',
] as const;

export type PropKind = (typeof PROP_KINDS)[number];

/** Per-kind triangle cap (R-5), mirrored by hand in
 *  `validate_mesh_assets.py`'s `PROP_TRI_CAPS` (that file is Python, not
 *  importable here) and pinned against it by `prop-role.test.ts`. */
export const PROP_TRI_CAPS: Readonly<Record<PropKind, number>> = {
  jersey_barrier: 120,
  water_tank: 220,
  satellite_dish: 180,
  laundry_line: 160,
  tyre_pile: 260,
  rebar: 140,
  wrecked_car: 400,
};
