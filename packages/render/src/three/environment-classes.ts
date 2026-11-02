/**
 * Look uplift L1 (GH-943): which material classes see the scene's environment,
 * and how strongly. Pure: no `three`, so the table is readable (and testable)
 * without a GL context.
 *
 * Spec `docs/superpowers/specs/2026-11-01-look-uplift-design.md` §2 and §7.
 *
 * **Why this is a table of CLASSES and not a scene environment.** In three
 * 0.186.1 a `MeshStandardMaterial` with no `envMap` of its own and a non-null
 * `scene.environment` takes its `envMapIntensity` uniform from
 * `scene.environmentIntensity`: one global number. `material.envMapIntensity`
 * is honoured only when the material carries its own `envMap`. So the
 * environment is handed out PER MATERIAL (`environment.ts`), `scene.environment`
 * stays null, and a class that must not see it (the ground, whose albedo is a
 * ratio; decals; smoke and FX meshes; the backdrop) is simply never given one.
 * That is an exact zero, not a small number.
 *
 * **Every class is listed, and an unlisted one throws.** `envSpecFor` is the
 * only door to the table. A material tagged with a class this file does not
 * know fails loudly when it is adopted, so a new material cannot silently
 * inherit anything: it either names a class here or it gets no environment.
 *
 * The starting values are the lead's 1 Nov approval AS THE MOCK'S STARTING
 * POINT (GH-943), not ship values: metal 0.6, dielectric 0.3, buildings 0.2,
 * ground 0. Two classes the approval did not number are this file's own
 * picks, and are named as such below: `glass` and `prop`.
 */
import type { LitTimeOfDay } from './time-of-day';
import type { SurfaceClass } from './units/unit-surface';

/** Every material class the scene has. The tuple is the list a test walks. */
export const ENV_CLASS_IDS = [
  'unitMetal',
  'unitDielectric',
  'glass',
  'building',
  'prop',
  'ground',
  'decal',
  'smoke',
  'fx',
  'backdrop',
] as const;
export type EnvClass = (typeof ENV_CLASS_IDS)[number];

export interface EnvClassSpec {
  /** false: the class is never given an `envMap` (exact zero). */
  readonly receives: boolean;
  /** `material.envMapIntensity` when it does. Always 0 when it does not. */
  readonly intensity: number;
}

const NONE: EnvClassSpec = { receives: false, intensity: 0 };

/**
 * The class table. A `Record` over `EnvClass`, so dropping a class is a compile
 * error, and `envSpecFor` makes an UNKNOWN one a runtime error.
 */
export const ENV_CLASSES: Readonly<Record<EnvClass, EnvClassSpec>> = {
  // Lead-approved starting values (1 Nov, GH-943).
  unitMetal: { receives: true, intensity: 0.6 },
  unitDielectric: { receives: true, intensity: 0.3 },
  building: { receives: true, intensity: 0.2 },
  // THIS FILE'S PICKS (the approval numbered neither): smooth, so as bright as
  // metal reads; and scenery shaded like a unit's dielectric parts.
  glass: { receives: true, intensity: 0.6 },
  prop: { receives: true, intensity: 0.3 },
  // Exact zero: no envMap at all. (Ground-lying decor, `decor-sand`, is `ground` too: `envClassOfDecorMesh`.)
  ground: NONE,
  decal: NONE,
  smoke: NONE,
  fx: NONE,
  backdrop: NONE,
};

export function isEnvClass(v: unknown): v is EnvClass {
  return typeof v === 'string' && (ENV_CLASS_IDS as readonly string[]).includes(v);
}

/** The spec for `cls`, or a throw naming the known set. The only door to `ENV_CLASSES`. */
export function envSpecFor(cls: string): EnvClassSpec {
  if (!isEnvClass(cls)) {
    throw new Error(`environment: unknown material class "${cls}". Known: ${ENV_CLASS_IDS.join(', ')}.`);
  }
  const spec = ENV_CLASSES[cls];
  if (spec === undefined) throw new Error(`environment: class "${cls}" is missing from ENV_CLASSES`);
  return spec;
}

/** The `material.userData` key a producer writes its class under. `Material.clone()` copies `userData`, so a scar, running-gear, wounded or death-fade clone keeps its class. */
export const ENV_USERDATA_KEY = 'rlEnvClass';

/** Unit surface classes -> environment class. Typed over `SurfaceClass`: a new surface class is a compile error here. */
export const ENV_CLASS_OF_SURFACE: Readonly<Record<SurfaceClass, EnvClass>> = {
  cloth: 'unitDielectric',
  leather: 'unitDielectric',
  skin: 'unitDielectric',
  wood: 'unitDielectric',
  gear: 'unitDielectric',
  gunmetal: 'unitMetal',
  armour: 'unitDielectric',
  plate: 'unitDielectric',
  rubber: 'unitDielectric',
  glass: 'glass',
};

/**
 * Hemisphere intensity per preset WITH the environment on. The shipped one
 * (`time-of-day.ts`) is 0.75 / 0.9 / 0.7. These start at the lead-approved
 * 0.5 / 0.6 / 0.47 (the 2:3 ratio, `ENV_HEMISPHERE_START`) and are then SOLVED
 * by the brightness census (`tools/src/perf/look-l1-captures.ts --only=census`),
 * not set by eye: the zero crossing of mean (on - off) / off over the quiet
 * views, 2 Nov, ANGLE/Metal M3 Pro, `beit_sahwan_outskirts` (zero crossings 0.695 /
 * 0.820 / 0.648, rounded to two places).
 */
export const ENV_HEMISPHERE_INTENSITY: Readonly<Record<LitTimeOfDay, number>> = {
  dawn: 0.7,
  day: 0.82,
  dusk: 0.65,
};

/**
 * The lead-approved STARTING values (1 Nov, GH-943), kept so the mock can show
 * them beside the census-solved ones. With the ground, decals and smoke given
 * no environment (the approved rule) the ground-dominated frame loses its
 * hemisphere light and nothing hands it back, so these darken the frame by
 * 9% (dawn), 3% (day) and 10% (dusk): the census solves to the table above.
 */
export const ENV_HEMISPHERE_START: Readonly<Record<LitTimeOfDay, number>> = {
  dawn: 0.5,
  day: 0.6,
  dusk: 0.47,
};

/** The metal cap with an environment to reflect (`SURFACE_PARAMS.gunmetal.metalness` is 0.45 without one). */
export const ENV_METAL_CAP = 0.7;

/** The wide-open default for the metal cap without the flag (kept here so a test can pin the pair). */
export const SHIPPED_METAL_CAP = 0.45;

/**
 * The class of a decor batch, from its mesh name (`decor-<role>`, `terrain/decor-mesh.ts`).
 * `sand` is ground litter: flat discs lying ON the ground, which must read as the
 * ground they lie on. Given the environment they came out pale against a ground
 * that has none (found in the first mock, 2 Nov: sand patches washed to near-white
 * at dusk), so they are `ground`. Every other decor role (foliage, trunk, rock) stands
 * above it and is `prop`.
 */
export function envClassOfDecorMesh(meshName: string): EnvClass {
  return meshName === 'decor-sand' ? 'ground' : 'prop';
}
