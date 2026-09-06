/**
 * Coursing: the generated masonry/form-work pattern `toonRampMaterial` can
 * splice into a building wall's shader (`palette-material.ts`'s own
 * "Coursing" doc comment for the whole account).
 *
 * Two properties carry the whole feature and both are tested here as
 * PROPERTIES rather than as strings-that-happen-to-be-present:
 *
 *  1. **Palette exactness.** The set of colours the shader can emit must be
 *     exactly the set of `uRamp` entries, and every `uRamp` entry must be a
 *     literal `data/palette.json` colour. A texture, a `mix()`, or any
 *     arithmetic on a ramp entry breaks it, silently -- Phase 0's whole
 *     finding is that off-palette output looks fine.
 *  2. **No-op for every existing caller.** `toonRampMaterial` is shared with
 *     units, vehicles and decor. With `coursing` left off, the generated
 *     source must be BYTE-IDENTICAL, which is checked here by removing the
 *     four known splices from the coursed source and requiring the result to
 *     equal the uncoursed source character for character -- a proof that the
 *     change is purely additive, not an assertion that it looks additive.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import paletteJson from '../../../../data/palette.json';
import {
  toonRampMaterial,
  COURSE_SURFACES,
  COURSE_SPECS,
  COURSE_VARYING_GLSL,
  COURSE_VERTEX_GLSL,
  COURSE_APPLY_GLSL,
  courseShiftGlsl,
  type CourseSurface,
} from './palette-material';

/** The limestone slice a hall wall actually shades through -- the retired
 *  mosque's wall took the identical slice, unchanged by the rename (both
 *  `limestone.1`; `building-mesh-role.ts`'s `sliceFrom('limestone', 1)`). */
const HALL_WALL = ['#E6D8BE', '#D9C7A7', '#C8B494'];
const OLIVE = ['#8F9464', '#6E7449', '#4E5433', '#333821'];

const ALL_PALETTE_HEXES = new Set(
  Object.values(paletteJson.ramps as Record<string, { colors: string[] }>)
    .flatMap((r) => r.colors)
    .map((h) => h.toUpperCase())
);

/** The four splices, in the order they appear, so a test can subtract them.
 *  `COURSE_VARYING_GLSL` is spliced TWICE (vertex and fragment), once each. */
function uncourse(src: string, surface: CourseSurface): string {
  return src
    .replace(COURSE_VARYING_GLSL, '')
    .replace(COURSE_VERTEX_GLSL, '')
    .replace(COURSE_APPLY_GLSL, '')
    .replace(courseShiftGlsl(surface), '');
}

describe('coursing is opt-in and a no-op for every existing caller', () => {
  it('leaves the generated source untouched when the option is absent', () => {
    // The three shapes a non-building caller reaches this function with:
    // decor (`terrain/decor-mesh.ts`, batched, no opts), a vehicle
    // (`units/mesh-vehicle.ts`, `specular: true`) and an explicit empty
    // options object.
    const bare = toonRampMaterial(OLIVE);
    for (const other of [toonRampMaterial(OLIVE, {}), toonRampMaterial(OLIVE, { specular: false })]) {
      expect(other.vertexShader).toBe(bare.vertexShader);
      expect(other.fragmentShader).toBe(bare.fragmentShader);
    }
    for (const token of ['courseShiftSteps', 'vWorldNormal', 'rlCourseHash']) {
      expect(bare.vertexShader).not.toContain(token);
      expect(bare.fragmentShader).not.toContain(token);
      expect(toonRampMaterial(OLIVE, { specular: true }).fragmentShader).not.toContain(token);
    }
  });

  it('adds only the four known splices -- removing them reproduces the source byte for byte', () => {
    // The real no-op proof. If any coursing edit also reflowed, reindented
    // or reordered a line that was already there, the subtraction below
    // stops matching and this goes red -- which a "does not contain
    // courseShiftSteps" check never would.
    for (const surface of COURSE_SURFACES) {
      const off = toonRampMaterial(HALL_WALL);
      const on = toonRampMaterial(HALL_WALL, { coursing: surface });
      expect(uncourse(on.vertexShader, surface)).toBe(off.vertexShader);
      expect(uncourse(on.fragmentShader, surface)).toBe(off.fragmentShader);
    }
  });

  it('composes with specular without either flag disturbing the other', () => {
    const surface: CourseSurface = 'brick';
    const specOnly = toonRampMaterial(HALL_WALL, { specular: true });
    const both = toonRampMaterial(HALL_WALL, { specular: true, coursing: surface });
    expect(uncourse(both.fragmentShader, surface)).toBe(specOnly.fragmentShader);
    expect(uncourse(both.vertexShader, surface)).toBe(specOnly.vertexShader);
  });

  it('adds no uniform of its own -- the pattern is pure position', () => {
    // A uniform would be a second thing to keep in sync per material and a
    // second thing `FlashLightManager.register` could collide with.
    const off = Object.keys(toonRampMaterial(HALL_WALL).uniforms).sort();
    const on = Object.keys(toonRampMaterial(HALL_WALL, { coursing: 'brick' }).uniforms).sort();
    expect(on).toEqual(off);
  });
});

describe('coursing stays inside the palette by construction', () => {
  it('emits only uRamp entries -- every assignment to the output colour', () => {
    // The palette guarantee itself. Any `mix()`, any multiply, any literal
    // colour reaching `outColor` shows up here as an assignment that is not
    // a bare `uRamp[...]` read.
    for (const surface of COURSE_SURFACES) {
      const f = toonRampMaterial(HALL_WALL, { coursing: surface }).fragmentShader;
      const assigned = [...f.matchAll(/outColor\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
      expect(assigned.length).toBeGreaterThan(0);
      for (const rhs of assigned) expect(rhs).toMatch(/^uRamp\[[a-z0-9]+\]$/);
      expect(f).toContain('gl_FragColor = vec4(outColor, 1.0);');
      // ...and nothing else writes the fragment.
      expect([...f.matchAll(/gl_FragColor\s*=/g)]).toHaveLength(1);
      expect(f).not.toContain('mix(');
      expect(f).not.toContain('texture2D');
    }
  });

  it('re-clamps the band into the ramp after shifting it', () => {
    // `courseShiftSteps` is signed, so an unclamped `band + shift` can reach
    // -1 or uSteps -- indices the ramp does not have, which in the emit loop
    // below would leave `outColor` at its uRamp[0] initialiser and paint the
    // whole surface the ramp's lightest step. The bound is what makes the
    // "only uRamp entries" property above true for the SHIFTED band and not
    // merely for the shaded one.
    for (const surface of COURSE_SURFACES) {
      const f = toonRampMaterial(HALL_WALL, { coursing: surface }).fragmentShader;
      expect(f).toContain(
        'band = min(max(band + courseShiftSteps(vWorldPos, vWorldNormal), 0), uSteps - 1);'
      );
    }
  });

  it('carries a ramp whose every entry is a literal data/palette.json colour', () => {
    // The emittable SET, checked against the palette file itself rather than
    // against a hardcoded list -- so this measures the real thing even
    // though the shader cannot be executed in `environment: 'node'`.
    const m = toonRampMaterial(HALL_WALL, { coursing: 'brick' });
    const ramp = m.uniforms.uRamp.value as THREE.Color[];
    expect(ramp).toHaveLength(9);
    for (const c of ramp) {
      const hex = '#' + c.getHexString(THREE.LinearSRGBColorSpace).toUpperCase();
      expect(ALL_PALETTE_HEXES.has(hex)).toBe(true);
    }
  });

  it('shifts by at most one step in either direction', () => {
    // The only two returns other than 0, read off the generated source. A
    // wider shift is not unsafe (the clamp holds regardless) but it would
    // skip a ramp step and read as a hard tonal jump rather than as
    // masonry -- and on a 3-step wall slice it would flatten the pattern
    // against both ends at once.
    for (const surface of COURSE_SURFACES) {
      const glsl = courseShiftGlsl(surface);
      const returns = [...glsl.matchAll(/return ([^;]+);/g)].map((m) => m[1].trim());
      expect(returns).toContain('1');
      expect(returns.some((r) => r.includes('-1 : 0'))).toBe(true);
      for (const r of returns) {
        for (const n of r.match(/-?\d+(?=\s*(?:;|:|$))/g) ?? []) {
          expect(Math.abs(Number(n))).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('the surface specs', () => {
  it('are coarser than the sprite pipeline, which is the point', () => {
    // `render_building.py`'s brick_scale 6.0 with the brick node's 0.25 row
    // height is 24 courses per BLENDER unit; at MESH_UNITS_PER_TILE = 3
    // that is 72 courses per tile, well under a pixel each at gameplay
    // zoom. Anything near that number here is the sprite constant ported
    // rather than re-measured.
    for (const surface of COURSE_SURFACES) {
      const perTile = 1 / COURSE_SPECS[surface].course;
      expect(perTile).toBeLessThan(20);
      expect(perTile).toBeGreaterThan(1);
    }
  });

  it('gives concrete a much larger pattern than masonry', () => {
    // The lead's distinction: poured concrete has form seams, not courses.
    // Size is what carries it -- `tintChance` USED to be the third clause
    // here, asserting panel was quieter than brick, and that is exactly the
    // call the lead overturned ("make concrete read at gameplay zoom").
    // Quietness is now spelled out as an ink budget below instead, which is
    // the thing that was actually wrong.
    expect(COURSE_SPECS.panel.course).toBeGreaterThan(COURSE_SPECS.brick.course * 2);
    expect(COURSE_SPECS.panel.length).toBeGreaterThan(COURSE_SPECS.brick.length * 2);
  });

  it('paints concrete with as much ink as masonry -- the reason it now reads', () => {
    // The measured cause of "concrete does not read at gameplay zoom", and
    // the one number that decides it: what FRACTION of a cell's area is not
    // the base band. Joint area is the cell minus the inset rectangle
    // (`joint` bites into all four sides, so `2 * joint` off each axis);
    // the rest is tinted at `tintChance`. Panel shipped at 35% against
    // brick's 63% -- a 1.25 px hairline every 13.7 px on an otherwise flat
    // slab. Anything under about half of brick's is the old defect back.
    const ink = (s: (typeof COURSE_SPECS)[CourseSurface]) => {
      const cell = s.course * s.length;
      const inner = Math.max(0, s.length - 2 * s.joint) * Math.max(0, s.course - 2 * s.joint);
      const jointFraction = (cell - inner) / cell;
      return jointFraction + (1 - jointFraction) * s.tintChance;
    };
    const brickInk = ink(COURSE_SPECS.brick);
    expect(brickInk).toBeGreaterThan(0.55);
    expect(ink(COURSE_SPECS.panel)).toBeGreaterThan(brickInk * 0.8);
  });

  it('lays masonry in a running bond and pours concrete in a stack bond', () => {
    // The other half of the same fix, and the reason raising panel's
    // contrast alone was not enough: a running bond IS what masonry looks
    // like. Rendered side by side in the same colours, the new panel
    // numbers in a running bond read as large BRICKS -- which is the
    // failure mode ("concrete stops reading as concrete") the louder
    // pattern had to avoid.
    expect(COURSE_SPECS.brick.bond).toBeGreaterThan(0);
    expect(COURSE_SPECS.panel.bond).toBe(0);

    // ...and the generated source honours it, rather than the table merely
    // saying so. A stack bond emits no offset term at all.
    expect(courseShiftGlsl('brick')).toContain('mod(row, 2.0)');
    expect(courseShiftGlsl('panel')).not.toContain('mod(row, 2.0)');
    expect(courseShiftGlsl('panel')).toContain('float u = uv.x;');
  });

  it('keeps every joint thinner than half its own course', () => {
    // `joint` is a distance from the brick edge and applies on all four
    // sides, so `2 * joint >= course` is a wall that is entirely mortar.
    for (const surface of COURSE_SURFACES) {
      const s = COURSE_SPECS[surface];
      expect(2 * s.joint).toBeLessThan(s.course * 0.5);
      expect(2 * s.joint).toBeLessThan(s.length * 0.5);
    }
  });
});
