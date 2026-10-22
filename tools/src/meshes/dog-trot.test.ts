/**
 * The Chadaf recon robot's trot, read off the SHIPPED bytes
 * (`art/meshes/ugv_recon_dog.glb`, GH-709 unit 10).
 *
 * Why a test of its own: the gait gate in `mesh_gait.test.ts` was written for
 * bipeds, and its foot-skate oracle reads a planted foot against a ceiling of
 * 0.25 of body speed. A planted foot that wanders 20 mm over a 0.15 s stance
 * is 0.13 m/s, 3% of this unit's 3.9 m/s, and passes it. It is not a theory:
 * `motion/feet.ts` once reset every `*_foot_[LR]` bone to rest in every clip
 * (it assumed it had just added them), which turned each pad with its leg and
 * moved a planted foot 18-20 mm, and the whole of `mesh_gait.test.ts` stayed
 * green over it. This file reads the same quantity at the scale it matters here.
 *
 * What it measures, per foot, over two cycles of `move` at the motion pass's own
 * 120 fps: the pad's centre, carried through the skin, plus the distance the
 * body has travelled at the unit's own speed. While the pad is on the ground
 * that is a world position and must not move.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { lowestY } from './motion/kneel';
import { carry, clipRange, restVertices, Rig, tracksOf } from './motion/rig';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const FILE = path.join(REPO, 'art', 'meshes', 'ugv_recon_dog.glb');
const FPS = 120;
const TILE_M = 3;
/** On the ground: the lowest pad vertex within 2 mm of it (the motion pass seats it at 1 mm). */
const PLANTED_Y = 0.002;
/** A planted foot moves less than this over its whole stance, metres. */
const DRIFT_MAX = 0.003;

function unitSpeedMps(): number {
  const where = path.join(REPO, 'data', 'units', 'kdf', 'ugv_recon_dog.json');
  expect(existsSync(where), `the shipped unit JSON ${where}`).toBe(true);
  const doc = JSON.parse(readFileSync(where, 'utf8')) as { mobility?: { speed_tiles_s?: number } };
  const v = doc.mobility?.speed_tiles_s;
  expect(typeof v, 'mobility.speed_tiles_s').toBe('number');
  return (v as number) * TILE_M;
}

interface FootTrace {
  readonly name: string;
  /** Per sample over two cycles: pad centre x (forward, glTF X) at that pose, and its lowest vertex's y. */
  readonly x: number[];
  readonly y: number[];
}

async function read() {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(FILE);
  const rig = new Rig(doc);
  const anim = (clip: string) => {
    const a = doc.getRoot().listAnimations().find((x) => x.getName() === clip);
    expect(a, `clip ${clip}`).toBeDefined();
    return tracksOf(a!);
  };
  return { doc, rig, anim };
}

async function traces(): Promise<{ feet: FootTrace[]; cycleS: number; n: number; rig: Rig; move: ReturnType<typeof tracksOf> }> {
  const { rig, anim } = await read();
  const move = anim('move');
  const [t0, t1] = clipRange(move);
  const cycleS = t1 - t0;
  const n = Math.round(cycleS * FPS);
  const verts = restVertices(rig);
  const feet = rig.nodes.filter((nd) => /_foot_[LR]$/.test(nd.getName()));
  expect(feet.map((f) => f.getName()).sort(), 'the four foot bones').toEqual([
    'dog_fore_foot_L', 'dog_fore_foot_R', 'dog_hind_foot_L', 'dog_hind_foot_R',
  ]);
  const out: FootTrace[] = feet.map((f) => ({ name: f.getName(), x: [], y: [] }));
  for (let i = 0; i < 2 * n; i++) {
    const pose = rig.sample(move, t0 + ((i % n) / FPS));
    const cache = new Map();
    const world = (nd: Parameters<typeof rig.worldOf>[0]) => rig.worldOf(nd, pose, cache);
    feet.forEach((f, k) => {
      const pts = verts.filter((v) => v.role === 'boot' && v.joint === f);
      expect(pts.length, `${f.getName()}: boot vertices`).toBeGreaterThan(20);
      const posed = pts.map((v) => carry(rig, world, f, v.p));
      out[k].x.push(posed.reduce((s, p) => s + p[0], 0) / posed.length);
      out[k].y.push(Math.min(...posed.map((p) => p[1])));
    });
  }
  return { feet: out, cycleS, n, rig, move };
}

/** Contiguous runs of planted samples that start and end inside the window. */
function stances(y: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  y.forEach((v, i) => {
    const on = v < PLANTED_Y;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      // A stance already under way at sample 0 began before the window, so it is not whole: dropped.
      if (start > 0) runs.push([start, i - 1]);
      start = -1;
    }
  });
  return runs;
}

function drift(f: FootTrace, speed: number, run: [number, number]): number {
  const w: number[] = [];
  for (let i = run[0]; i <= run[1]; i++) w.push(f.x[i] + speed * (i / FPS));
  return Math.max(...w) - Math.min(...w);
}

describe('ugv_recon_dog: the trot', () => {
  it('plants every foot: a pad on the ground does not move in the world', async () => {
    const speed = unitSpeedMps();
    const { feet, n } = await traces();
    for (const f of feet) {
      const runs = stances(f.y);
      expect(runs.length, `${f.name}: one whole stance in two cycles at least`).toBeGreaterThanOrEqual(1);
      for (const r of runs) {
        expect(r[1] - r[0] + 1, `${f.name}: a stance is a real fraction of the cycle`).toBeGreaterThan(0.25 * n);
        expect(drift(f, speed, r), `${f.name}: planted drift over ${r[1] - r[0] + 1} samples`).toBeLessThan(DRIFT_MAX);
      }
    }
  });

  it('is a trot: diagonal pairs land together, the other pair half a cycle later, and a flight between', async () => {
    const { feet, n } = await traces();
    const by = (nm: string) => feet.find((f) => f.name === nm)!;
    const first = (f: FootTrace) => stances(f.y)[0][0];
    const slack = 2;
    expect(Math.abs(first(by('dog_fore_foot_L')) - first(by('dog_hind_foot_R'))), 'fore L / hind R together').toBeLessThanOrEqual(slack);
    expect(Math.abs(first(by('dog_fore_foot_R')) - first(by('dog_hind_foot_L'))), 'fore R / hind L together').toBeLessThanOrEqual(slack);
    const gap = (first(by('dog_fore_foot_R')) - first(by('dog_fore_foot_L')) + n) % n;
    expect(Math.abs(gap - n / 2), 'the diagonals half a cycle apart').toBeLessThanOrEqual(slack);
    let flight = 0;
    for (let i = 0; i < n; i++) if (feet.every((f) => f.y[i] >= PLANTED_Y)) flight++;
    expect(flight, 'samples with every foot off the ground, per cycle').toBeGreaterThan(0.05 * n);
  });

  it('puts nothing under the ground in idle or move', async () => {
    const { rig, anim } = await read();
    const pts = restVertices(rig).map((v) => ({ joint: v.joint, p: v.p }));
    for (const clip of ['idle', 'move']) {
      const tracks = anim(clip);
      const [t0, t1] = clipRange(tracks);
      const step = clip === 'move' ? 1 / FPS / 2 : 0.05; // idle is a slow pan: sparse samples are enough
      for (let t = t0; t < t1; t += step) {
        expect(lowestY(rig, rig.sample(tracks, t), pts), `${clip} at ${t.toFixed(4)} s`).toBeGreaterThan(-1e-4);
      }
    }}, 60_000); // every skinned vertex at every half-key: seconds, not milliseconds

  // The oracle's own control. An instrument that cannot read a slide is a green light, so:
  // the same traces, read with the body's speed 15% wrong, must call the planted feet sliding.
  it('control: the same feet read against the wrong speed are caught sliding', async () => {
    const speed = unitSpeedMps();
    const { feet } = await traces();
    const f = feet[0];
    const r = stances(f.y)[0];
    expect(drift(f, speed, r), 'right speed').toBeLessThan(DRIFT_MAX);
    expect(drift(f, speed * 0.85, r), 'speed 15% low').toBeGreaterThan(5 * DRIFT_MAX);
  });
});
