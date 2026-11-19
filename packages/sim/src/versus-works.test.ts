import { describe, expect, it } from 'vitest';
import { MissionRuntime, type MissionEvent } from './mission';
import { encodeSim, restoreSim } from './snapshot';
import { encodeRuntimeSection, runtimeSchemaDigest } from './runtime-snapshot';
import { RUNTIME_SNAPSHOT_SCHEMA } from './runtime-snapshot-schema';
import { forwardWorld } from './runtime-forward-world.test-helper';
import { VW_PADS, VW_TICKS, versusWorksAdvance, versusWorksDrive, versusWorksWorld } from './runtime-versus-works-world.test-helper';

// Versus field works (the lead's ruling, 18 Nov 2026): a works-only runtime (`ctx.worksOnly`) runs both sides' works, each
// from its own purse, counts, sites and appended lines. The world is `runtime-versus-works-world.test-helper.ts`.

function run(ticks: number, onEvents?: (ev: MissionEvent[], t: number) => void): ReturnType<typeof versusWorksWorld> {
  const w = versusWorksWorld();
  for (let t = 0; t < ticks; t++) {
    versusWorksDrive(w.sim, w.rt, t);
    w.rt.applyQueued();
    const ev = w.rt.step(w.sim.tick());
    onEvents?.(ev, t);
  }
  return w;
}

const left = (rt: MissionRuntime, side: 0 | 1, id: string): number => rt.worksOffers(side).find((o) => o.typeId === id)?.left ?? -1;

describe('versus field works: a works-only runtime, both sides', () => {
  it('each side raises from its own purse and its own counts', () => {
    const { rt } = run(VW_TICKS);
    // Side 0: one post (150). Side 1: the camp (200), the contested post refunded in full, the second post cancelled part-built.
    expect(rt.logisticsOf(0)).toBe(850);
    expect(rt.logisticsOf(1)).toBeLessThan(1000 - 200);
    expect(rt.logisticsOf(1)).toBeGreaterThan(1000 - 200 - 150);
    expect(left(rt, 0, 'vw_post')).toBe(1);
    expect(left(rt, 0, 'fwd_camp')).toBe(1);
    // Every count side 1 spent came back but the camp's.
    expect(left(rt, 1, 'vw_post')).toBe(2);
    expect(left(rt, 1, 'fwd_camp')).toBe(0);
  });

  it('seat 1 raises: its production work completes and appends a line at the tail of side 1\'s lines', () => {
    const { rt, sim } = run(VW_TICKS);
    const lines = rt.productionLines(1);
    expect(lines).toHaveLength(1);
    expect(lines[0].appended).toBe(true);
    expect(sim.structures.owner[lines[0].anchor]).toBe(1);
    // A works-only room builds no lines of its own: side 0 has none.
    expect(rt.productionLines(0)).toHaveLength(0);
  });

  it('every works event names its side, and side 0 never opens the contested key', () => {
    const seen: { phase: string; side: number | undefined; typeId: string }[] = [];
    run(VW_TICKS, (ev) => {
      for (const e of ev) if (e.kind === 'works') seen.push({ phase: e.phase, side: e.side, typeId: e.typeId });
    });
    expect(seen.every((e) => e.side === 0 || e.side === 1)).toBe(true);
    expect(seen.filter((e) => e.phase === 'started').map((e) => `${e.side}:${e.typeId}`)).toEqual(['0:vw_post', '1:fwd_camp', '1:vw_post', '1:vw_post']);
    expect(seen.filter((e) => e.phase === 'cancelled').map((e) => e.side)).toEqual([1, 1]);
    expect(seen.some((e) => e.phase === 'complete' && e.side === 1 && e.typeId === 'fwd_camp')).toBe(true);
  });

  it('a cancel of the other side\'s site is refused, at the click and in the queue', () => {
    const w = run(4);
    const site = w.rt.unstakedWorksAt(VW_PADS.camp1[0], VW_PADS.camp1[1], 1)?.site ?? w.rt.worksAt(w.sim.structureAt(VW_PADS.camp1[0], VW_PADS.camp1[1]), 1)?.site ?? -1;
    expect(site).toBeGreaterThanOrEqual(0);
    expect(w.rt.canCancelWorks(site, 0)).toBe(false);
    expect(w.rt.canCancelWorks(site, 1)).toBe(true);
    w.sim.queueCommand({ kind: 'cancelWorks', side: 0, site });
    expect(w.rt.applyQueued()).toBe(0);
  });

  it('a raise is priced on its own side: the purse is decremented when the request is charged', () => {
    const w = versusWorksWorld();
    w.sim.queueCommand({ kind: 'raiseWorks', side: 1, works: 'vw_post', x: VW_PADS.post1[0], y: VW_PADS.post1[1], ids: [] });
    expect(w.rt.applyQueued()).toBe(1);
    expect(w.rt.logisticsOf(1)).toBe(850);
    expect(w.rt.logisticsOf(0)).toBe(1000);
    expect(left(w.rt, 1, 'vw_post')).toBe(1);
    expect(left(w.rt, 0, 'vw_post')).toBe(2);
  });

  it('R5: a request for the key the OTHER side asked for in the same frame is refused at the click, uncharged and uncounted', () => {
    const w = versusWorksWorld();
    const [x, y] = VW_PADS.contested;
    w.sim.queueCommand({ kind: 'raiseWorks', side: 1, works: 'vw_post', x, y, ids: [] });
    w.sim.queueCommand({ kind: 'raiseWorks', side: 0, works: 'vw_post', x, y, ids: [] });
    // Side 1's is charged; side 0's is refused before any charge, as the sim would have refused it (an overlap).
    expect(w.rt.applyQueued()).toBe(1);
    expect(w.rt.constructReason('vw_post', x, y, undefined, 0)).toBe('overlap');
    expect(w.rt.logisticsOf(0)).toBe(1000);
    expect(left(w.rt, 0, 'vw_post')).toBe(2);
    expect(w.rt.logisticsOf(1)).toBe(850);
    // The tick answers side 1's request: its site opens on side 1, and side 0 still has paid nothing.
    const ev = w.rt.step(w.sim.tick());
    expect(ev.filter((e) => e.kind === 'works').map((e) => (e.kind === 'works' ? `${e.phase}:${e.side}` : ''))).toEqual(['started:1']);
    expect(w.rt.logisticsOf(0)).toBe(1000);
    expect(w.rt.unstakedWorksAt(x, y, 1) ?? w.rt.worksAt(w.sim.structureAt(x, y), 1)).not.toBeNull();
  });

  it('R6: a side-1 work wrecked mid-build is forgotten on side 1, its event names side 1, and nothing is refunded', () => {
    const w = run(100);
    const [x, y] = VW_PADS.camp1;
    const st = w.sim.structureAt(x, y);
    expect(st).toBeGreaterThanOrEqual(0);
    const at = w.rt.worksAt(st, 1);
    expect(at?.done).toBe(false);
    expect(w.rt.worksAt(st, 0)).toBeNull();
    const purse1 = w.rt.logisticsOf(1);
    const left1 = left(w.rt, 1, 'fwd_camp');
    w.sim.debugDestroyStructure(st);
    const ev = w.rt.step(w.sim.tick()).filter((e) => e.kind === 'works');
    // The seat that hears it is side 1's (`main.ts` notes a works event only when `side === me`).
    expect(ev.map((e) => (e.kind === 'works' ? `${e.phase}:${e.side}:${e.typeId}` : ''))).toEqual(['destroyed:1:fwd_camp']);
    expect(w.rt.worksAt(st, 1)).toBeNull();
    expect(w.rt.canCancelWorks(at?.site ?? -1, 1)).toBe(false);
    expect(w.rt.logisticsOf(1)).toBe(purse1);
    expect(left(w.rt, 1, 'fwd_camp')).toBe(left1);
    // And no line was ever appended for it.
    expect(w.rt.productionLines(1)).toHaveLength(0);
  });

  it('a runtime that is not works-only keeps side 1 out of the works path', () => {
    const { sim, rt } = forwardWorld();
    expect(rt.worksOffers(1)).toEqual([]);
    expect(rt.constructReason('fwd_camp', 14, 10, undefined, 1)).toBe('not_listed');
    sim.queueCommand({ kind: 'raiseWorks', side: 1, works: 'fwd_camp', x: 14, y: 10, ids: [] });
    expect(rt.applyQueued()).toBe(0);
  });

  it('replays: two runs agree on the sim hash and the runtime digest at every 20th tick', () => {
    const a = versusWorksWorld();
    const b = versusWorksWorld();
    for (let t = 0; t < VW_TICKS; t++) {
      for (const w of [a, b]) {
        versusWorksDrive(w.sim, w.rt, t);
        versusWorksAdvance(w);
      }
      if (t % 20 === 0) {
        expect(b.sim.hash()).toBe(a.sim.hash());
        expect(b.rt.digest()).toBe(a.rt.digest());
      }
    }
  });

  it('a snapshot taken mid-build round-trips: the restored world runs on to the same hashes', () => {
    for (const T of [3, 60, 150, 200, 300]) {
      const a = versusWorksWorld();
      for (let t = 0; t < T; t++) {
        versusWorksDrive(a.sim, a.rt, t);
        versusWorksAdvance(a);
      }
      const bytes = encodeSim(a.sim, {}, a.rt);
      const b = versusWorksWorld();
      restoreSim(b.sim, bytes, b.rt);
      expect(b.rt.digest(), `T=${T}`).toBe(a.rt.digest());
      for (let t = T; t < VW_TICKS; t++) {
        for (const w of [a, b]) {
          versusWorksDrive(w.sim, w.rt, t);
          versusWorksAdvance(w);
        }
      }
      expect(b.sim.hash(), `T=${T}`).toBe(a.sim.hash());
      expect(b.rt.digest(), `T=${T}`).toBe(a.rt.digest());
      expect(b.rt.economyHash(), `T=${T}`).toBe(a.rt.economyHash());
    }
  });
});

describe('versus field works: the snapshot carries side 1 only for a works-only runtime', () => {
  const sideRows = RUNTIME_SNAPSHOT_SCHEMA.filter((r) => r.when === 'worksOnly').map((r) => r.name);

  it('the four side-1 rows are conditional', () => {
    expect(sideRows).toEqual(['worksOfferList1', 'worksPending1', 'worksSites1', 'appendedAnchors1']);
  });

  it('the digest of every other runtime is the table\'s before the rows existed (pinned), and a works-only one differs', () => {
    // Pinned from the table at 93448908f (before the side-1 rows): a mission save or a snapshot an earlier build wrote restores.
    expect(runtimeSchemaDigest()).toBe(RUNTIME_DIGEST_BEFORE_ROWS);
    expect(runtimeSchemaDigest(true)).not.toBe(runtimeSchemaDigest());
  });

  it('a mission\'s section has no side-1 row; a works-only runtime\'s has all four', () => {
    const off = forwardWorld();
    const offSection = JSON.parse(new TextDecoder().decode(encodeRuntimeSection(off.rt, off.sim))) as Record<string, unknown>;
    for (const n of sideRows) expect(offSection, n).not.toHaveProperty(n);
    const on = versusWorksWorld();
    const onSection = JSON.parse(new TextDecoder().decode(encodeRuntimeSection(on.rt, on.sim))) as Record<string, unknown>;
    for (const n of sideRows) expect(onSection, n).toHaveProperty(n);
  });

  it('a snapshot of a works-only world is refused by a world that is not, and the other way round', () => {
    const on = versusWorksWorld();
    const off = versusWorksWorld();
    // A runtime of the same world built without the flag: the digests differ, so the header refuses it.
    const plain = new MissionRuntime(off.sim, (off.rt as unknown as { mission: never }).mission, { ...(off.rt as unknown as { ctx: object }).ctx, worksOnly: undefined } as never);
    expect(() => restoreSim(off.sim, encodeSim(on.sim, {}, on.rt), plain)).toThrow(/runtime schema digest differs/);
  });
});

/** `runtimeSchemaDigest()` with the table as it stood at 93448908f (measured by restoring that file and reading it). */
const RUNTIME_DIGEST_BEFORE_ROWS = 65675699;
