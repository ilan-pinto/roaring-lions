import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ProxyBoxBatch, proxyBoxDims } from './proxy-box';
import { colorSlot } from '../../relation';
import { hexToLinear } from '../terrain/shared';
import { ELLIPSE_BY_TYPE, ELLIPSE_PAD_TILES, ringRadiusFor } from './readability';

describe('proxyBoxDims', () => {
  it('a ground vehicle takes its own hull half-extents and centre offset from the ring ellipse', () => {
    const e = ELLIPSE_BY_TYPE.mbt_lavi;
    const d = proxyBoxDims('mbt_lavi', 'armour');
    expect(d.halfAlong).toBeCloseTo(e.along - ELLIPSE_PAD_TILES, 10);
    expect(d.halfAcross).toBeCloseTo(e.across - ELLIPSE_PAD_TILES, 10);
    expect(d.offsetAlong).toBe(e.offsetAlong);
    expect(d.halfAlong).toBeGreaterThan(d.halfAcross); // a hull is longer than it is wide
  });

  it('a foot unit is a square inside its ring circle, centred on the unit', () => {
    const d = proxyBoxDims('inf_squad', 'foot');
    expect(d.halfAlong).toBe(d.halfAcross);
    expect(d.halfAlong).toBeLessThan(ringRadiusFor('inf_squad', 'foot'));
    expect(d.offsetAlong).toBe(0);
  });

  it('never collapses to nothing, even for an unknown type', () => {
    const d = proxyBoxDims('no_such_type', 'foot');
    expect(d.halfAlong).toBeGreaterThanOrEqual(0.15);
    expect(d.height).toBeGreaterThan(0);
  });
});

describe('ProxyBoxBatch colour', () => {
  // Network design §5.1: a box wears its side's colour AS THE VIEWER SEES IT,
  // so the seat on side 1 sees its own boxes friendly. Break to confirm red:
  // index `teamLinear` by `e.side` instead of `slotOf(e.side)`.
  const TEAM = ['#ff0000', '#00ff00', '#0000ff'];
  const colourOf = (batch: ProxyBoxBatch, side: number): number[] => {
    const dims = proxyBoxDims('inf_squad', 'foot');
    batch.update([{ x: 0, groundY: 0, z: 0, yaw: 0, dims, side }]);
    const c = new THREE.Color();
    batch.mesh.getColorAt(0, c);
    return [c.r, c.g, c.b];
  };
  const close = (got: number[], want: readonly number[]): void => {
    got.forEach((v, k) => expect(v).toBeCloseTo(want[k], 6));
  };

  it('draws the viewer’s own side in the friendly slot and the other in the hostile one', () => {
    const batch = new ProxyBoxBatch(new THREE.Scene(), TEAM, (s) => colorSlot(s, 1));
    close(colourOf(batch, 1), hexToLinear(TEAM[0]));
    close(colourOf(batch, 0), hexToLinear(TEAM[1]));
    close(colourOf(batch, 2), hexToLinear(TEAM[2]));
  });

  it('indexes by raw side when no slot function is given (viewer 0)', () => {
    const batch = new ProxyBoxBatch(new THREE.Scene(), TEAM);
    close(colourOf(batch, 0), hexToLinear(TEAM[0]));
    close(colourOf(batch, 1), hexToLinear(TEAM[1]));
  });
});
