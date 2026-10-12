/**
 * The running gear in the SHIPPED files, both copies: `art/meshes/vehicles/`
 * (the source of record, what the gates render) and `assets/meshes/vehicles/`
 * (the Draco copy the game loads).
 *
 * The Draco half is the design doc's first unverified item (§2.3): custom
 * attributes are encoded as GENERIC, `_RL_TRACK` is quantised, and Draco
 * reorders vertices, so nothing upstream proves the tags survive. This file
 * decodes the shipped bytes and compares them with the source face by face:
 * the same number of triangles per wheel, every triangle's corners agreeing
 * on one wheel, the wheel ids still integers in an unsigned byte, and every
 * track coordinate within quantisation of the source's range per side.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NodeIO, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { RUNNING_GEAR_RECIPES } from './running-gear-recipes';
import { RG_EXTRAS_KEY, RG_NOT_TRACK, RG_TRACK_ATTR, RG_WHEEL_ATTR, type RgExtras } from './running-gear-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const ART = path.join(REPO, 'art', 'meshes', 'vehicles');
const SHIPPED = path.join(REPO, 'assets', 'meshes', 'vehicles');
/** Draco's default 12-bit generic quantisation over a ~17 m range is ~4 mm. */
const TRACK_QUANT_M = 0.01;

async function ioWithDraco(): Promise<NodeIO> {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });
}

interface FaceStats {
  /** Triangles per wheel id (0 = static). */
  readonly perWheel: Map<number, number>;
  /** Triangles whose corners disagree about their wheel. */
  readonly mixed: number;
  /** Min and max track coordinate per side, track corners only. */
  readonly track: Map<'r' | 'l', [number, number]>;
  readonly wheelType: string;
}

function stats(prim: Primitive): FaceStats {
  const w = prim.getAttribute(RG_WHEEL_ATTR);
  const t = prim.getAttribute(RG_TRACK_ATTR);
  const p = prim.getAttribute('POSITION');
  const idx = prim.getIndices()?.getArray();
  if (!w || !t || !p || !idx) throw new Error('a tagged primitive lost an attribute or its indices');
  const wa = w.getArray();
  const ta = t.getArray();
  const pa = p.getArray();
  if (!wa || !ta || !pa) throw new Error('no data');
  const perWheel = new Map<number, number>();
  const track = new Map<'r' | 'l', [number, number]>();
  let mixed = 0;
  for (let f = 0; f < idx.length / 3; f++) {
    const a = wa[idx[f * 3]];
    if (a !== wa[idx[f * 3 + 1]] || a !== wa[idx[f * 3 + 2]]) mixed++;
    perWheel.set(a, (perWheel.get(a) ?? 0) + 1);
  }
  for (let v = 0; v < ta.length; v++) {
    if (ta[v] < RG_NOT_TRACK + 0.5) continue;
    const side = pa[v * 3 + 2] > 0 ? 'r' : 'l';
    const cur = track.get(side) ?? [Infinity, -Infinity];
    track.set(side, [Math.min(cur[0], ta[v]), Math.max(cur[1], ta[v])]);
  }
  return { perWheel, mixed, track, wheelType: wa.constructor.name };
}

function tagged(doc: Document): Map<string, Primitive> {
  const out = new Map<string, Primitive>();
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!name.startsWith('hull_')) continue;
    const prim = node.getMesh()?.listPrimitives()[0];
    if (prim?.getAttribute(RG_WHEEL_ATTR)) out.set(name, prim);
  }
  return out;
}

describe('running gear survives the Draco encode', () => {
  for (const id of Object.keys(RUNNING_GEAR_RECIPES).sort()) {
    it(`${id}: the shipped copy carries the source's tags`, async () => {
      const io = await ioWithDraco();
      const art = await io.read(path.join(ART, `${id}.glb`));
      const shipped = await io.read(path.join(SHIPPED, `${id}.glb`));
      expect(readFileSync(path.join(SHIPPED, `${id}.glb`)).includes('KHR_draco_mesh_compression')).toBe(true);

      const ex = shipped.getRoot().listScenes()[0].getExtras()[RG_EXTRAS_KEY] as RgExtras | undefined;
      expect(ex).toEqual(art.getRoot().listScenes()[0].getExtras()[RG_EXTRAS_KEY]);

      const a = tagged(art);
      const s = tagged(shipped);
      expect([...s.keys()].sort()).toEqual([...a.keys()].sort());
      expect(a.size).toBeGreaterThan(0);
      for (const [name, prim] of a) {
        const sa = stats(prim);
        const ss = stats(s.get(name) as Primitive);
        expect(sa.mixed).toBe(0);
        expect(ss.mixed, `${id}/${name}: decoded triangles mixing wheels`).toBe(0);
        expect(ss.wheelType).toBe('Uint8Array');
        expect([...ss.perWheel.entries()].sort()).toEqual([...sa.perWheel.entries()].sort());
        for (const [side, [lo, hi]] of sa.track) {
          const got = ss.track.get(side);
          expect(got, `${id}/${name}: side ${side} lost its track`).toBeDefined();
          expect(Math.abs((got as [number, number])[0] - lo)).toBeLessThan(TRACK_QUANT_M);
          expect(Math.abs((got as [number, number])[1] - hi)).toBeLessThan(TRACK_QUANT_M);
        }
      }
    }, 30_000);
  }
});
