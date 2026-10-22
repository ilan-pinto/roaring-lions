// Every KDF unit type, through the real catalogue: does a halt hold, and does a
// plain attack-move stop where it was sent, when the side remembers an enemy
// far off? Promoted from the bug-move-obey census (2026-10-11), which read
// 18 of 19 types walking off in BOTH cases -- 8 to 28 tiles from the clicked
// tile, or from where the halt stopped them, ten seconds later -- because
// stepSweep restarted any idle attack-mover toward the nearest remembered
// contact, at any distance, whoever had sent it.
//
// The sim-level pins are packages/sim/src/orders-obeyed.test.ts (one rifle and
// one tank) and the orders replay in determinism.test.ts. This one exists
// because those use two hand-built types, and a unit's own data (a sensor
// upgrade's sight, an air domain, a kamikaze warhead) is exactly what decides
// whether something else moves it.
//
// It carries its own control: the same order WITH `sweep: true` (what an AI
// wave or a scripted commit sends) must still walk most types off, or this
// census could not tell a holding unit from a sweep that found nothing.
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

const all = units as Record<string, UnitTypeJson & { faction: string }>;
// Not the role-`wounded` types (GH-707 P2): a casualty is something the sim makes and he crawls at
// 0.12 tile/s on his own account; nobody fields him, so an order's "held where it was sent" is not
// a question about him (measured: `wounded_kdf` drifts 10.0 tiles under the plain attack-move and
// stays put under the sweep, being unarmed). `mesh_wounded.test.ts` is where he is judged.
const KDF = Object.values(all)
  .filter((u) => u.faction === 'kdf' && (u as { role?: string }).role !== 'wounded')
  .map((u) => u.id);

/** The one type allowed to leave: an `attack_drone` IS its warhead, and
 *  stepKamikaze steers it onto an identified target on its own, at any range,
 *  under a plain `move` exactly as under an attack-move (the census read it
 *  disobeying both verbs, before and after the fix). Not an order being
 *  ignored -- the munition doing its job. Demoted below if that ever stops. */
const EXEMPT = new Set(['attack_drone']);

type Case = 'hold' | 'halt' | 'sweep';

/** Tiles from where the unit was told to be, 10 s after it got there. */
function drift(type: string, c: Case): number {
  const sim = new Sim({ seed: 7, width: 48, height: 48, capacity: 16 });
  const typeOf = new Map<string, number>();
  for (const u of Object.values(all)) typeOf.set(u.id, sim.addUnitType(u));
  const me = sim.spawn(typeOf.get(type) as number, 0, fx.from(10.5), fx.from(24.5), 0);
  const foe = sim.spawn(typeOf.get('militia_cell') as number, 1, fx.from(42.5), fx.from(44.5), 0);
  for (let t = 0; t < 2 * TICKS_PER_SECOND; t++) sim.tick();
  sim.identifyTo(0, foe);
  const gx = c === 'halt' ? 30.5 : 20.5;
  sim.queueCommand({ kind: 'attackMove', ids: [me], x: fx.from(gx), y: fx.from(24.5), sweep: c !== 'hold' });
  sim.tick(); // the order is applied on the next tick, not when it is queued
  let hx = gx;
  let hy = 24.5;
  if (c === 'halt') {
    for (let t = 1; t < 3 * TICKS_PER_SECOND; t++) sim.tick();
    sim.queueCommand({ kind: 'halt', ids: [me] });
    sim.tick();
    hx = fx.toNumber(sim.state.posX[me]);
    hy = fx.toNumber(sim.state.posY[me]);
  } else {
    for (let t = 0; t < 60 * TICKS_PER_SECOND && sim.state.moving[me] === 1; t++) sim.tick();
  }
  for (let t = 0; t < 10 * TICKS_PER_SECOND; t++) sim.tick();
  if (sim.state.alive[me] === 0) return Number.POSITIVE_INFINITY;
  return Math.hypot(fx.toNumber(sim.state.posX[me]) - hx, fx.toNumber(sim.state.posY[me]) - hy);
}

describe('orders are obeyed after they are done, every KDF type', () => {
  it('the catalogue is the one the census measured', () => {
    expect(KDF.length).toBeGreaterThanOrEqual(19);
    for (const id of EXEMPT) expect(KDF).toContain(id);
  });

  for (const c of ['hold', 'halt'] as const) {
    it(`${c === 'hold' ? 'a plain attack-move holds where it was sent' : 'a halt holds'}, with a contact remembered 25 tiles off`, () => {
      const off: string[] = [];
      for (const type of KDF) {
        if (EXEMPT.has(type)) continue;
        const d = drift(type, c);
        if (!(d < 1.5)) off.push(`${type} ${d.toFixed(1)}`);
      }
      expect(off).toEqual([]);
    });
  }

  it('the control: the same order with `sweep` still walks the armed types off', () => {
    // Measured 2026-10-11: every type but `recon_drone` left its point by
    // more than 3 tiles (4.5 to 29.7; the attack drone dies on its target).
    // The recon drone carries no weapon, so the sweep's couldEngage refuses
    // to walk it at anything -- correct, and the one stay-put expected here.
    // GH-709 (22 Oct): the armoured ambulance and the medevac are unarmed too (`weapons: []`),
    // so they stay put for the same reason.
    const stayed = KDF.filter((type) => !(drift(type, 'sweep') > 3));
    expect(stayed).toEqual(['recon_drone', 'veh_ambulance', 'air_medevac_heli']);
  });

  it('the exemption is still needed', () => {
    for (const type of EXEMPT) expect(drift(type, 'hold')).toBeGreaterThan(1.5);
  });
});
