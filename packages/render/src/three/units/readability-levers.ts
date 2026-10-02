/**
 * GH-346 (playtest critique item 2): the battlefield readability PROTOTYPE.
 *
 * Design branch only -- every lever here is off unless the app passes
 * `RendererOptions.readability`, which it does only from five sandbox flags
 * (`&teamband`, `&bigrings`, `&contacts`, `&rimlift`, `&footscale`) and never on a mission.
 * Nothing here reads or writes sim state beyond what the overlay loop already
 * reads (`contactLevel`, the unit type), and nothing here adds a
 * `renderOrder`: every lever draws in a band that already exists
 * (`render-order.ts`) -- the team band IS the occlusion silhouette (6), the
 * rings are the selection ring's (0.5), the contact marks are overlays (4),
 * and the rim is the unit's own material.
 *
 * The measurements, the costs and the lead's open decisions are in
 * `docs/superpowers/specs/2026-10-02-readability-design.md`.
 */
import * as THREE from 'three';
import type { RingClass } from './readability';

/** Which levers are on. All four default off. */
export interface ReadabilityLevers {
  /** A team-colour outline on every mesh unit, always (not only when occluded). */
  readonly teamBand?: boolean;
  /** A bigger, thicker selection ring, plus a faint team ring under every unselected unit. */
  readonly bigRings?: boolean;
  /** A shape-coded contact mark over every observed hostile. */
  readonly contacts?: boolean;
  /** A per-class fresnel rim light on unit bodies. */
  readonly rimLift?: boolean;
  /** Team band width, screen px. */
  readonly teamBandPx?: number;
  /** Rim fresnel power. */
  readonly rimPower?: number;
  /** Infantry mesh scale, 1 = off. */
  readonly footScale?: number;
}

/** The prototype's numbers, in one place, for the spec to quote. */
export const LEVER = {
  /** Team band: the occlusion outline's own width (2.5 px) at full team colour. */
  teamBand: { widthPx: 2.5 },
  bigRings: {
    /** Selected ring radius and ellipse axes x this. */
    selectedScale: 1.25,
    selected: { coreAlpha: 0.95, haloAlpha: 0.5, thicknessTiles: 0.1, minThicknessPx: 2.5 },
    /** The always-on team ring under every unselected unit. */
    team: { coreAlpha: 0.55, haloAlpha: 0.3, thicknessTiles: 0.05, minThicknessPx: 1.5 },
    teamCapacity: 512,
  },
  contacts: {
    /** Half-size of a mark in screen px at zoom 1, held as a FLOOR on screen
     *  below zoom 1 (the overlay layer otherwise shrinks with the world). */
    halfPx: 6,
    /** Dark halo width, px. */
    haloPx: 1.5,
    /** How far above the overlay radius the mark sits (the HP bar is at r + 10). */
    liftPx: 22,
  },
  /** Infantry exaggeration: the one silhouette lever that adds AREA. */
  footScale: 1.3,
  rim: {
    /** Fresnel strength per ring class: the smallest bodies get the most. */
    strength: { foot: 0.85, light: 0.6, armour: 0.4, air: 0.5 } as Readonly<Record<RingClass, number>>,
    /** 4 is a narrow edge light. 2.2 (the first cut) washed the whole body
     *  toward the sand -- measured, see the spec. */
    power: 4,
    /** The palette key the rim takes its colour from (lightest limestone). */
    colorKey: 'limestone.0',
  },
} as const;

/** What a contact mark says. `unknown` is a suspected (not identified) contact. */
export type ContactShape = 'foot' | 'vehicle' | 'air' | 'unknown';

export function contactShapeOf(cls: RingClass, contactLevel: number): ContactShape {
  if (contactLevel < 2) return 'unknown';
  if (cls === 'air') return 'air';
  return cls === 'foot' ? 'foot' : 'vehicle';
}

/** The mark's screen scale at `zoom`: 1 at zoom >= 1 (it grows with the
 *  world like every other overlay), and 1/zoom below that so it never falls
 *  under its zoom-1 size on screen. */
export function contactScale(zoom: number): number {
  return zoom >= 1 ? 1 : 1 / Math.max(zoom, 0.05);
}

type Pt = readonly [number, number];
type Tri = readonly [Pt, Pt, Pt];

/**
 * The mark as triangles, in overlay px (Pixi convention: y DOWN), centred on
 * (0, 0), half-size `h`. Four shapes a player can tell apart at 12 px:
 *  - foot: a downward chevron-triangle (points at the man),
 *  - vehicle: a wide bar (a hull, side on),
 *  - air: an upward wedge,
 *  - unknown: a hollow diamond (the minimap's own "something is here" shape).
 */
export function contactTriangles(shape: ContactShape, h: number): Tri[] {
  switch (shape) {
    case 'foot':
      return [[[-h, -h * 0.7], [h, -h * 0.7], [0, h * 0.9]]];
    case 'vehicle': {
      const w = h * 1.25;
      const t = h * 0.6;
      return [
        [[-w, -t], [w, -t], [w, t]],
        [[-w, -t], [w, t], [-w, t]],
      ];
    }
    case 'air':
      return [
        [[0, -h], [h, h * 0.6], [0, h * 0.1]],
        [[0, -h], [0, h * 0.1], [-h, h * 0.6]],
      ];
    case 'unknown': {
      // A diamond ring, stroke 0.35 h: four quads, eight triangles.
      const o = h;
      const i = h * 0.55;
      const outer: Pt[] = [[0, -o], [o, 0], [0, o], [-o, 0]];
      const inner: Pt[] = [[0, -i], [i, 0], [0, i], [-i, 0]];
      const out: Tri[] = [];
      for (let k = 0; k < 4; k++) {
        const a = outer[k];
        const b = outer[(k + 1) % 4];
        const c = inner[(k + 1) % 4];
        const d = inner[k];
        out.push([a, b, c], [a, c, d]);
      }
      return out;
    }
  }
}

/**
 * Adds a view-dependent fresnel rim to a unit material, once. Patches in
 * place: unit materials are per GLB primitive and shared across every
 * instance of that type, so the per-class strength holds wherever a material
 * is only ever used by one class -- true for every shipped GLB, since no two
 * types share a loaded material.
 *
 * Added to `totalEmissiveRadiance`, so it is lit-independent and survives a
 * unit standing in a building's shadow, which is exactly where olive on olive
 * is worst. The camera is orthographic, so the view vector is constant +Z in
 * view space.
 */
const RIM_PATCHED = new WeakSet<THREE.Material>();

export function patchRim(
  material: THREE.Material,
  strength: number,
  colorLinear: readonly [number, number, number],
  power: number = LEVER.rim.power
): void {
  if (RIM_PATCHED.has(material)) return;
  const std = material as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return;
  RIM_PATCHED.add(material);
  const uRim = { value: new THREE.Vector4(colorLinear[0], colorLinear[1], colorLinear[2], strength) };
  const prev = std.onBeforeCompile;
  std.onBeforeCompile = (shader, renderer) => {
    prev.call(std, shader, renderer);
    shader.uniforms.uRlRim = uRim;
    shader.fragmentShader = `uniform vec4 uRlRim;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec3 rlV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
        float rlF = pow(1.0 - clamp(abs(dot(normalize(normal), rlV)), 0.0, 1.0), ${power.toFixed(2)});
        totalEmissiveRadiance += uRlRim.rgb * uRlRim.a * rlF;
      }`
    );
  };
  const prevKey = std.customProgramCacheKey.bind(std);
  std.customProgramCacheKey = () => `${prevKey()}|rl-rim-${power.toFixed(2)}`;
  std.needsUpdate = true;
}
