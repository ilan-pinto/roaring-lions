import { createHash } from 'node:crypto';
import { it } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, structures as structureCatalogue, paletteColor, type MapId } from '@lions/data';
import { composeTerrain } from '@lions/render/three';
import { rendererOptionsFor } from './renderer-options';

const H = (b: Buffer | string) => createHash('sha256').update(b).digest('hex').slice(0, 10);
function probe(id: MapId): void {
  const parsed = parseMap(maps[id]);
  const sim = new Sim({ seed: 20260727, width: parsed.width, height: parsed.height, capacity: 256 });
  applyTerrain(parsed, sim);
  const typeIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    typeIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of parsed.structures) sim.addStructure(typeIdx.get(b.type) as number, b.tiles);
  const tones = rendererOptionsFor(parsed, { colorVision: 'default', quality: 'high' }, '/').terrainTones;
  const c = composeTerrain(sim, parsed.decor, parsed.elevation, () => false, tones, paletteColor, paletteColor('shadow.1'));
  const lines: string[] = [];
  const meshes: Array<[string, typeof c.ground]> = [['ground', c.ground], ['scatter', c.scatter], ['residual', c.residual], ...c.buildings.map((b, i) => [`b${i}`, b.mesh] as [string, typeof c.ground])];
  for (const [n, m] of meshes) {
    for (const f of ['positions', 'colors', 'indices'] as const) {
      const a = m[f] as { buffer: ArrayBufferLike; byteOffset: number; byteLength: number; length: number };
      const buf = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
      if (a.length === 0) continue;
      lines.push(`PROBE ${n}.${f} len=${a.length} ${H(buf)}`);
      const blk = 4096 * 4;
      const parts: string[] = [];
      for (let o = 0; o < buf.length; o += blk) parts.push(H(buf.subarray(o, o + blk)));
      lines.push(`PROBE ${n}.${f}.blocks ${parts.join(',')}`);
    }
  }
  for (const [n, arr] of [['decor', c.decorPlacements], ['prop', c.propPlacements]] as const) {
    const a = arr as unknown as unknown[];
    lines.push(`PROBE ${n} count=${a.length} ${H(JSON.stringify(a))}`);
    if (n === 'decor') for (let i = 6500; i < 6600; i++) lines.push(`PROBE e${i} ${JSON.stringify(a[i])}`);
    const parts: string[] = [];
    for (let o = 0; o < a.length; o += 100) parts.push(H(JSON.stringify(a.slice(o, o + 100))));
    lines.push(`PROBE ${n}.blocks ${parts.join(',')}`);
  }
  throw new Error(lines.join('\n'));
}
it('probe wadi_tarfan_l', () => { probe('wadi_tarfan_l'); }, 60_000);
