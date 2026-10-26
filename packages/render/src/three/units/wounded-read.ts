/**
 * GH-707 (the lead, 26 Oct 2026): the wounded readability pass, DISPLAY ONLY. Two pure halves live
 * here; the ring itself is `selection-ring.ts`'s arc mode (`readability.ts`'s `WOUND_RING`).
 *
 * 1. `bleedFractionOf`: how much of a down wounded's bleed clock is left, 0..1, for the ring's arc.
 *    The clock is `@lions/sim`'s `bleedClock`, the SAME reading `packages/app/src/ui/bleed.ts`'s
 *    `bleedView` makes for the unit card, so the ring's arc and the card's countdown cannot drift.
 *    It reads the sim's public columns and writes nothing.
 *
 * 2. `liftWoundedTemplate`: a minimum-albedo floor for wounded TYPES only (`UnitType.isWounded`).
 *    A man lying on his front, under a building's shadow or on a dusk map, drew near-black -- the
 *    investigation's two worst frames. The floor is a real MINIMUM, not an addition: just before the
 *    fragment is written the shader adds back whatever light the body is short of `WOUNDED_LIFT` x its albedo
 *    (`FLOOR_GLSL`), so a body the sun already lights above the floor is byte-identical to today, and
 *    one in shadow or at dusk is held at WOUNDED_LIFT of its own colour instead of falling toward nothing. It is
 *    albedo-shaped on purpose (the floor is the base colour, map included), so a boot stays darker
 *    than a face and the figure keeps its colour instead of going flat grey. No light, no rim, no
 *    outline: nothing new in the world, only a floor under what is already there.
 *
 * The patch lives on a CLONE of each of the template's materials, never on the shared surface
 * clones (`unit-surface.ts`), which every other unit of that faction draws with. One shared uniform
 * carries the floor for all of them, so the `wounded-read` debug layer writes it once.
 */
import * as THREE from 'three';
import { ONE, bleedClock, type BleedClockSource } from '@lions/sim';
import { isOwnSide } from '../../relation';

/** The slice of the sim it reads (structural, so a test hands a literal). */
export type BleedSource = BleedClockSource;

export interface BleedRead {
  /** Remaining bleed, 0..1 (1 when no type says how long a wound bleeds, so the arc is a full band). */
  readonly fraction: number;
  /** The clock is running: he is DOWN and nobody has stabilised him. The ring breathes only then. */
  readonly bleeding: boolean;
}

/** The ring's read for entity `id`, or null when it is not a down or stabilised wounded. The clock is
 *  `@lions/sim`'s `bleedClock`, the one the unit card reads too; this only makes its Q16.16 fraction a float. */
export function bleedFractionOf(sim: BleedSource, id: number): BleedRead | null {
  const clock = bleedClock(sim, id);
  if (clock === null) return null;
  return { fraction: clock.fraction / ONE, bleeding: !clock.stabilised };
}

/**
 * Whether a wounded man's ring is drawn DASHED (`WOUND_RING.dashSegments`): the viewer's own men
 * only; the enemy's and a civilian's stay solid. The non-colour cue behind `wounded_ring_cvd.test.ts`:
 * own amber against `team.neutral` yellow is under dE 20 in every variant, so shape does not wait on colour.
 */
export function woundRingDashed(side: number, viewer: number): boolean {
  return isOwnSide(side, viewer);
}

/**
 * The floor, as a fraction of the body's own albedo, in scene-referred radiance before the tone map.
 * Presentation only, and the only number here a look can move; `wounded-read-captures.ts` is how to
 * see it. A body the light already carries above this is untouched.
 */
export const WOUNDED_LIFT = 0.5;

/** The light level (`lit` in `FLOOR_GLSL`) under which the floor is fully on, and over which it is off. */
export const WOUNDED_GATE_LO = 0.05;
export const WOUNDED_GATE_HI = 0.2;

/** The floor every lifted material reads. 0 is today's look (the debug layer). */
const floorUniform = { value: WOUNDED_LIFT };
const gateLoUniform = { value: WOUNDED_GATE_LO };
const gateHiUniform = { value: WOUNDED_GATE_HI };
const PROGRAM_KEY = 'rl-wounded-floor';

const live = new Set<WeakRef<THREE.Material>>();

function replaceOnce(src: string, find: string, by: string): string {
  const at = src.indexOf(find);
  if (at < 0) throw new Error(`wounded-read: the shader has no "${find}" to patch (three changed its chunks?)`);
  return src.slice(0, at) + by + src.slice(at + find.length);
}

/**
 * The floor, in luminance, and only in DEEP shadow. `lit` is the light the body is getting, its
 * outgoing luminance over its albedo's. Below `uWoundedFloor` 70% of the deficit is added back as
 * albedo-coloured fill, scaled by `gate`: 1 under `uWoundedGateLo`, 0 over `uWoundedGateHi`, a smooth
 * ramp between. So a body the light already reads (the lit dusk patch, full sun) adds exactly 0 and is
 * byte-identical to today, and a body in building shadow keeps its gain. Measured in luminance and
 * added (not a per-channel `max`) because a neutral floor under warm dusk light lifts the blue channel
 * most and turned the man into a pale blue ghost; the 30% not filled keeps some of the figure's own
 * shading (a full fill flattened it to a grey mush).
 */
const FLOOR_GLSL = `{
  const vec3 luma = vec3(0.2126, 0.7152, 0.0722);
  float albedoLuma = max(dot(diffuseColor.rgb, luma), 0.02);
  float lit = dot(outgoingLight, luma) / albedoLuma;
  float gate = 1.0 - smoothstep(uWoundedGateLo, uWoundedGateHi, lit);
  outgoingLight += diffuseColor.rgb * max(uWoundedFloor - lit, 0.0) * 0.7 * gate;
}`;

/** The fragment patch: declare the uniform, and clamp the outgoing light up to the floor. */
export function patchWoundedFloor(fragmentShader: string): string {
  const declared = replaceOnce(fragmentShader, 'void main() {', 'uniform float uWoundedFloor;\nuniform float uWoundedGateLo;\nuniform float uWoundedGateHi;\nvoid main() {');
  return replaceOnce(
    declared,
    '#include <opaque_fragment>',
    FLOOR_GLSL + '\n#include <opaque_fragment>'
  );
}

/**
 * Gives every mesh of a WOUNDED type's template its own copy of its material, carrying the floor.
 * One copy per source material, shared by the template's meshes that shared it. RETURNS the copies:
 * the caller adds them to the template's `materials` so its disposer releases them.
 */
export function liftWoundedTemplate(root: THREE.Object3D): THREE.Material[] {
  const made = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.Material;
    const std = src as THREE.MeshStandardMaterial;
    if (!std.isMeshStandardMaterial) return;
    let copy = made.get(src);
    if (!copy) {
      copy = std.clone();
      const baseKey = std.customProgramCacheKey();
      copy.customProgramCacheKey = () => `${baseKey}|${PROGRAM_KEY}`;
      copy.onBeforeCompile = (shader) => {
        shader.uniforms.uWoundedFloor = floorUniform;
        shader.uniforms.uWoundedGateLo = gateLoUniform;
        shader.uniforms.uWoundedGateHi = gateHiUniform;
        shader.fragmentShader = patchWoundedFloor(shader.fragmentShader);
      };
      // The tuning harness (`wounded-read-captures.ts --sweep`) reaches the shared uniforms here.
      copy.userData.rlWoundedUniforms = { floor: floorUniform, gateLo: gateLoUniform, gateHi: gateHiUniform };
      made.set(src, copy);
      live.add(new WeakRef(copy));
    }
    mesh.material = copy;
  });
  return [...made.values()];
}

/** The `wounded-read` debug layer's floor half: on (true) or today's look (false). Returns how many
 *  lifted materials are live, so a check can fail on a layer that reached none. */
export function setWoundedLift(on: boolean): number {
  floorUniform.value = on ? WOUNDED_LIFT : 0;
  let n = 0;
  for (const ref of [...live]) {
    if (ref.deref()) n++;
    else live.delete(ref);
  }
  return n;
}

/** The floor the shaders read now (test seam). */
export function woundedFloorValue(): number {
  return floorUniform.value;
}
