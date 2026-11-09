// Report-only: every `fire` event aimed at a STRUCTURE in a passive run of every shipped mission, classified by who owns the structure
// relative to the shooter, with the world state at the first such shot. A structure is shot (a) because someone hostile is inside it or
// the other side owns it (`selectStructureTarget`), or (b) because a unit with somewhere to be is pressed against it and cutting through
// (`selectBreachTarget`). Class of a shot:
//   own        the structure's owner is the shooter's own side                      (should never happen)
//   protected  neutral, and its type's ROE penalty is at/over PROTECTED_ROE          (should never happen)
//   neutral    owner -1, not protected                                              (the breach rule's intended wall)
//   enemy      owned by the other side, or a neutral one with a hostile garrison    (a siege)
//
//   pnpm --filter @lions/tools exec tsx src/backtest/structure-fire-probe.ts [--seeds=1,2,3] [--ticks=6000] [--missions=a,b]
import { missions } from '@lions/data';
import { PROTECTED_ROE as SIM_PROTECTED_ROE } from '@lions/sim';
import { missionWorld } from '../mission-harness';

const arg = (name: string, d: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? d;
const SEEDS = arg('seeds', '1,2,3').split(',').map(Number);
const TICKS = Number(arg('ticks', '6000'));
const ONLY = arg('missions', '').split(',').filter((s) => s.length > 0);
const PROTECTED_ROE = Number(arg('protected-roe', String(SIM_PROTECTED_ROE)));

interface Hit { mission: string; seed: number; tick: number; cls: string; shooter: string; shooterSide: number; type: string; owner: number; occupants: number; garrisonSlots: number; roe: number; world: string; count: number; struct: number; hp0: number; endHp: number; endAlive: number; sim?: unknown }
const hits = new Map<string, Hit>();
for (const id of Object.keys(missions).filter((m) => ONLY.length === 0 || ONLY.includes(m)).sort()) {
  for (const seed of SEEDS) {
    let w;
    try { w = missionWorld(id, {}, seed); } catch { continue; }
    const { sim, runtime } = w;
    const S = sim.state as unknown as Record<string, ArrayLike<number>>;
    const st = sim.structures;
    const mine = (): Hit[] => [...hits.values()].filter((h) => h.mission === id && h.seed === seed);
    for (let n = 0; n < TICKS && runtime.result === 'ongoing'; n++) {
      const ev = sim.tick();
      for (const e of ev) {
        if (e.kind !== 'fire' || e.target >= 0 || e.structure === undefined || e.structure < 0) continue;
        const s = e.structure;
        const side = S.side[e.shooter];
        const owner = st.owner[s];
        const type = sim.structureTypes[st.typeIdx[s]];
        const roe = type.roePenalty ?? 0;
        const cls = owner === side ? 'own' : owner === -1 && roe >= PROTECTED_ROE ? 'protected' : owner === -1 && st.occupants[s] === 0 ? 'neutral' : 'enemy';
        const key = `${id}|${seed}|${cls}|${type.id}|${S.typeIdx[e.shooter]}|${side}`;
        const prior = hits.get(key);
        if (prior) { prior.count++; continue; }
        const pct = (k: number): number => Math.round((100 * st.hp[k]) / Math.max(1, st.maxHp[k]));
        const tid = sim.unitTypes[S.typeIdx[e.shooter]].id;
        const dist = Math.hypot(S.posX[e.shooter] / 65536 - st.cx[s] / 65536, S.posY[e.shooter] / 65536 - st.cy[s] / 65536);
        hits.set(key, {
          mission: id, seed, tick: sim.tickCount, cls, shooter: `${tid}#${e.shooter}`, shooterSide: side, type: type.id, owner, occupants: st.occupants[s], garrisonSlots: type.garrisonSlots ?? 0, roe,
          world: `shooter @(${(S.posX[e.shooter] / 65536).toFixed(1)},${(S.posY[e.shooter] / 65536).toFixed(1)}) moving ${(sim as unknown as { moving: ArrayLike<number> }).moving[e.shooter]} goal (${((sim as unknown as { goalX: ArrayLike<number> }).goalX[e.shooter] / 65536).toFixed(1)},${((sim as unknown as { goalY: ArrayLike<number> }).goalY[e.shooter] / 65536).toFixed(1)}) -> structure #${s} ${type.id} owner ${owner} centroid (${(st.cx[s] / 65536).toFixed(1)},${(st.cy[s] / 65536).toFixed(1)}) ${dist.toFixed(1)} tiles, ${st.occupants[s]} inside`,
          count: 1, struct: s, hp0: pct(s), endHp: -1, endAlive: -1,
        });
      }
    }
    for (const h of mine()) { h.endHp = Math.round((100 * st.hp[h.struct]) / Math.max(1, st.maxHp[h.struct])); h.endAlive = st.alive[h.struct]; }
  }
}
console.log('class | mission | seed | first tick | shooter (side) | structure type (owner) | shots | structure hp first shot -> end (alive) | world at the first shot');
const rows = [...hits.values()].sort((a, b) => a.cls.localeCompare(b.cls) || a.mission.localeCompare(b.mission) || a.seed - b.seed || a.tick - b.tick);
for (const h of rows) console.log(`${h.cls} | ${h.mission} | ${h.seed} | ${h.tick} | ${h.shooter} (s${h.shooterSide}) | ${h.type} (owner ${h.owner}) | ${h.count} | ${h.hp0}% -> ${h.endHp}% (${h.endAlive === 1 ? 'standing' : 'DESTROYED'}) | ${h.world}`);
const bad = rows.filter((h) => h.cls === 'own' || h.cls === 'protected');
console.log(`\n${rows.length} (mission, seed, shooter type, structure type) rows; ${bad.length} own or protected.`);
process.exitCode = bad.length > 0 ? 1 : 0;
