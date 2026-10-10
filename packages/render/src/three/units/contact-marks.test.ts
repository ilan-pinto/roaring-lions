import { describe, expect, it } from 'vitest';
import { CONTACT_MARK, contactHaloTriangles, contactScale, contactShapeOf, contactTriangles, type ContactShape, type ContactTri } from './contact-marks';

const SHAPES: ContactShape[] = ['foot', 'vehicle', 'air', 'unknown'];

function inside(p: readonly [number, number], t: ContactTri): boolean {
  const s = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): number =>
    (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
  const d1 = s(p, t[0], t[1]);
  const d2 = s(p, t[1], t[2]);
  const d3 = s(p, t[2], t[0]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
const covers = (tris: ContactTri[], p: readonly [number, number]): boolean => tris.some((t) => inside(p, t));
const bottom = (tris: ContactTri[]): number => Math.max(...tris.flat().map((v) => v[1]));

describe('contactShapeOf', () => {
  it('says "unknown" for every class until the contact is identified', () => {
    for (const cls of ['foot', 'light', 'armour', 'air'] as const) {
      expect(contactShapeOf(cls, 0)).toBe('unknown');
      expect(contactShapeOf(cls, 1)).toBe('unknown');
    }
  });
  it('codes an identified contact by class: foot, vehicle (light or armour), air', () => {
    expect(contactShapeOf('foot', 2)).toBe('foot');
    expect(contactShapeOf('light', 2)).toBe('vehicle');
    expect(contactShapeOf('armour', 2)).toBe('vehicle');
    expect(contactShapeOf('air', 2)).toBe('air');
  });
});

describe('contactScale', () => {
  it('never draws a mark smaller on screen than at zoom 1, over the whole 0.35-2.5 clamp', () => {
    for (let z = 0.35; z <= 2.5; z += 0.05) expect(contactScale(z) * z).toBeGreaterThanOrEqual(1 - 1e-9);
  });
  it('grows with the world at and above zoom 1, like every other overlay', () => {
    expect(contactScale(1)).toBe(1);
    expect(contactScale(2.5)).toBe(1);
    expect(contactScale(0.5)).toBe(2);
  });
});

describe('contactTriangles', () => {
  const h = CONTACT_MARK.halfPx;
  it('the four shapes are told apart by their own geometry', () => {
    const sig = SHAPES.map((s) => {
      const t = contactTriangles(s, h);
      const xs = t.flat().map((v) => v[0]);
      const ys = t.flat().map((v) => v[1]);
      return `${t.length}:${Math.max(...xs) - Math.min(...xs)}x${Math.max(...ys) - Math.min(...ys)}:${covers(t, [0, 0])}`;
    });
    expect(new Set(sig).size).toBe(4);
  });
  it('the suspected mark is HOLLOW and the identified ones are solid at their centre', () => {
    expect(covers(contactTriangles('unknown', h), [0, 0])).toBe(false);
    expect(covers(contactTriangles('unknown', h), [0, -h * 0.8])).toBe(true);
    for (const s of ['foot', 'vehicle', 'air'] as const) expect(covers(contactTriangles(s, h), [0, 0]), s).toBe(true);
  });
  it('the foot chevron points DOWN at the man (its apex is its lowest point)', () => {
    const [t] = contactTriangles('foot', h);
    const apex = t.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(apex[0]).toBe(0);
    expect(apex[1]).toBeGreaterThan(0);
  });
});

describe('contactHaloTriangles', () => {
  const h = CONTACT_MARK.halfPx;
  const halo = CONTACT_MARK.haloPx;
  it('the halo reaches past the mark on the outside of every shape', () => {
    for (const s of SHAPES) expect(bottom(contactHaloTriangles(s, h, halo)), s).toBeGreaterThan(bottom(contactTriangles(s, h)));
  });
  it('the hollow diamond is haloed on its INNER edge too', () => {
    // A point just inside the mark's inner edge: no mark there, but halo.
    const p: [number, number] = [0, -(h * 0.55 - halo / 2)];
    expect(covers(contactTriangles('unknown', h), p)).toBe(false);
    expect(covers(contactHaloTriangles('unknown', h, halo), p)).toBe(true);
  });
  it('sits clear of the HP bar at every zoom: its lowest point is above r + 10 + the 1 px frame', () => {
    for (let z = 0.35; z <= 2.5; z += 0.05) {
      const k = contactScale(z);
      for (const s of SHAPES) {
        const lowest = CONTACT_MARK.liftPx * k - bottom(contactHaloTriangles(s, h * k, halo * k));
        expect(lowest, `${s} @ ${z.toFixed(2)}`).toBeGreaterThan(11);
      }
    }
  });
});
