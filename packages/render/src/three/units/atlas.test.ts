/**
 * `packSheet` and `Semaphore` are the pure halves of this file -- the only
 * parts that can be tested headlessly. `buildUnitTexture` and `decodeFrame`
 * are I/O (fetch, image decode, a 2D canvas), none of which exist in
 * `environment: 'node'`, and stay untested here for that reason; `Semaphore`
 * is the fetch-throttling primitive `decodeFrame` queues behind, extracted
 * specifically because it has no I/O of its own and its queueing behaviour
 * (fix round 2, the unthrottled-parallel-fetch bug B3.5 hit) is exactly the
 * kind of off-by-one that deserves a real test rather than a read-through.
 *
 * Fixture: the real `INF_SQUAD` manifest, not a hand-rolled toy shape.
 * `INF_SQUAD`/`INF_RPG`/`INF_MILITIA`/`INF_DEMO`/`INF_AT` are the largest
 * sheets this game ships -- 16 facings x (10 idle + 4 move + 1 fire + 1 down
 * + 1 wreck) = 272 frames -- and a packer that only proves itself against a
 * 4-frame fixture is exactly the failure mode the brief calls out: it can
 * work at toy scale and silently overlap at 272. Importing the shipped JSON
 * directly (as `tones.ts` reads `data/palette.json`) means this test tracks
 * the real asset rather than a transcription of it that could drift.
 */
import { describe, it, expect } from 'vitest';
import { parseManifest, type ClipName, type SheetSpec } from '../../sheet';
import { packSheet, MAX_ARRAY_LAYERS, FRAME_PX, Semaphore, type FrameRegion } from './atlas';
import infSquadManifest from '../../../../../assets/sprites/INF_SQUAD/manifest.json';

const infSquad: SheetSpec = parseManifest(infSquadManifest);

/** Every `(clip, facing, frame)` triple a sheet declares, in no particular
 *  order -- used to drive `regionFor` from the sheet's own shape rather than
 *  from `packSheet`'s output, so the "distinct region" test is not just
 *  checking `packSheet` against itself. */
function everyTriple(sheet: SheetSpec): Array<[ClipName, number, number]> {
  const out: Array<[ClipName, number, number]> = [];
  for (const clip of Object.keys(sheet.clips) as ClipName[]) {
    const spec = sheet.clips[clip];
    if (!spec) continue;
    for (let facing = 0; facing < sheet.facings; facing++) {
      for (let frame = 0; frame < spec.frames; frame++) {
        out.push([clip, facing, frame]);
      }
    }
  }
  return out;
}

/**
 * Real rectangle intersection, not a layer-number comparison in disguise.
 * With `packSheet`'s current output -- every region `{layer, 0, 0, 256,
 * 256}`, one whole layer per frame -- this reduces exactly to `a.layer ===
 * b.layer`, so it cannot disagree with the "distinct layer" assertion in the
 * test above it; it is not a stronger check today, just a genuinely general
 * one, in the same spirit `FrameRegion` itself is kept general (see its own
 * comment) rather than collapsed to a bare layer index. Worth keeping as
 * real geometry anyway: if `packSheet` ever needs to place more than one
 * frame per layer (a 2D atlas page per layer), this is the check that would
 * start doing useful work without needing to be rewritten. The break-check
 * (temporarily colliding two frames onto one layer) confirms it does catch
 * a real collision today, not merely pass vacuously.
 */
function regionsOverlap(a: FrameRegion, b: FrameRegion): boolean {
  if (a.layer !== b.layer) return false;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('packSheet', () => {
  it('packs all 272 frames of the real INF_SQUAD shape', () => {
    const packing = packSheet(infSquad);
    expect(packing.entries.length).toBe(272);
    expect(packing.layers).toBe(272);
    expect(packing.frameSize).toBe(FRAME_PX);
  });

  it('maps every (clip, facing, frame) INF_SQUAD declares to a distinct region', () => {
    const packing = packSheet(infSquad);
    const triples = everyTriple(infSquad);
    expect(triples.length).toBe(272);

    const regions = triples.map(([clip, facing, frame]) => packing.regionFor(clip, facing, frame));
    const layers = new Set(regions.map((r) => r.layer));
    // One region per triple, and every one of them a distinct layer -- if
    // two triples ever resolved to the same layer this set would be smaller
    // than the triple count.
    expect(layers.size).toBe(triples.length);
  });

  it('no region overlaps another', () => {
    const packing = packSheet(infSquad);
    const regions = packing.entries.map((e) => e.region);
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        expect(regionsOverlap(regions[i], regions[j])).toBe(false);
      }
    }
  });

  it('is stable across calls', () => {
    const a = packSheet(infSquad);
    const b = packSheet(infSquad);
    expect(a.layers).toBe(b.layers);
    expect(a.entries).toEqual(b.entries);
    for (const entry of a.entries) {
      expect(b.regionFor(entry.clip, entry.facing, entry.frame)).toEqual(entry.region);
    }
  });

  it('regionFor is consistent with entries for every packed triple', () => {
    const packing = packSheet(infSquad);
    for (const entry of packing.entries) {
      expect(packing.regionFor(entry.clip, entry.facing, entry.frame)).toEqual(entry.region);
    }
  });

  it('regionFor throws on a triple the sheet never declared', () => {
    const packing = packSheet(infSquad);
    // INF_SQUAD's fire clip has exactly 1 frame (index 0) -- frame 5 is not
    // a bug the packer should paper over with a default.
    expect(() => packing.regionFor('fire', 0, 5)).toThrow(/no packed region/);
  });

  it('fails loudly, before packing anything, when a sheet needs more layers than the default budget holds', () => {
    // Synthetic on purpose -- no shipped sheet is anywhere close to this
    // large. 64 facings x 40 idle frames = 2560 > MAX_ARRAY_LAYERS (2048).
    // Proves the *default* (no maxLayers argument) is really 2048, not
    // Infinity -- the parameterised tests below prove the general throw
    // behaviour more cheaply, against real INF_SQUAD data.
    const tooBig = parseManifest({
      facings: 64,
      clips: { idle: { frames: 40, fps: 4, loop: true } },
    });
    expect(() => packSheet(tooBig)).toThrow(/2560/);
    expect(() => packSheet(tooBig)).toThrow(new RegExp(String(MAX_ARRAY_LAYERS)));
  });

  it('does not silently overlap right at the default capacity boundary', () => {
    // Exactly MAX_ARRAY_LAYERS frames must still pack cleanly -- the throw
    // above is a ">", not an off-by-one masquerading as a safety check.
    const exact = parseManifest({
      facings: 64,
      clips: { idle: { frames: 32, fps: 4, loop: true } }, // 64 * 32 = 2048
    });
    const packing = packSheet(exact);
    expect(packing.layers).toBe(MAX_ARRAY_LAYERS);
    const layers = new Set(packing.entries.map((e) => e.region.layer));
    expect(layers.size).toBe(MAX_ARRAY_LAYERS);
  });

  it('accepts a caller-supplied layer budget, failing loudly one layer under what the real sheet needs', () => {
    // INF_SQUAD needs 272 layers -- a caller (buildUnitTexture, querying an
    // actual device) that found only 271 must get a named, numeric refusal,
    // not a partial pack.
    expect(() => packSheet(infSquad, 271)).toThrow(/272/);
    expect(() => packSheet(infSquad, 271)).toThrow(/271/);
  });

  it('packs cleanly exactly at a caller-supplied budget (no off-by-one)', () => {
    const packing = packSheet(infSquad, 272);
    expect(packing.layers).toBe(272);
    const layers = new Set(packing.entries.map((e) => e.region.layer));
    expect(layers.size).toBe(272);
  });

  it('omitting maxLayers is identical to passing MAX_ARRAY_LAYERS explicitly', () => {
    const a = packSheet(infSquad);
    const b = packSheet(infSquad, MAX_ARRAY_LAYERS);
    expect(a.layers).toBe(b.layers);
    expect(a.entries).toEqual(b.entries);
  });
});

/**
 * `Semaphore` is `decodeFrame`'s fetch-throttling primitive (fix round 2 on
 * this task: an unthrottled `Promise.all` per sheet, times ~30 sheets loading
 * in parallel, produced genuine 503s in B3.5). It has no `fetch`/DOM of its
 * own, so its queueing behaviour is exercised directly here rather than only
 * through the I/O it is used to throttle.
 */
describe('Semaphore', () => {
  it('resolves the first `limit` acquires immediately', async () => {
    const sem = new Semaphore(2);
    let resolved = 0;
    void sem.acquire().then(() => resolved++);
    void sem.acquire().then(() => resolved++);
    await Promise.resolve();
    expect(resolved).toBe(2);
  });

  it('queues an acquire past the limit until a release happens', async () => {
    const sem = new Semaphore(1);
    let secondResolved = false;

    await sem.acquire(); // takes the only slot
    void sem.acquire().then(() => {
      secondResolved = true;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false); // still queued -- the holder hasn't released

    sem.release();
    await Promise.resolve();
    expect(secondResolved).toBe(true);
  });

  it('wakes queued acquires in FIFO order, one at a time', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    async function worker(id: number): Promise<void> {
      await sem.acquire();
      order.push(id);
      sem.release();
    }

    // All three "start" together; only one can hold the slot at a time, so
    // arrival order is what decides completion order.
    await Promise.all([worker(1), worker(2), worker(3)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('never lets more holders run at once than the limit, under load, and does reach the limit', async () => {
    const limit = 3;
    const sem = new Semaphore(limit);
    let current = 0;
    let maxObserved = 0;

    async function worker(): Promise<void> {
      await sem.acquire();
      current++;
      maxObserved = Math.max(maxObserved, current);
      await Promise.resolve(); // yield a tick while "holding" the slot
      current--;
      sem.release();
    }

    await Promise.all(Array.from({ length: 20 }, () => worker()));
    expect(current).toBe(0); // every holder released
    expect(maxObserved).toBeLessThanOrEqual(limit);
    // Not just "never exceeded" -- confirms it actually reaches the budget
    // rather than a stricter, accidentally-serialising bug passing the same assertion.
    expect(maxObserved).toBe(limit);
  });
});
