// Report-only: when does each shipped `first_contact` trigger first fire under the passive plan (no orders), seeds 1..5, and what
// is the world at that tick? Two readings of the same events, side by side:
//   LOOSE  (what `first_contact` meant before): any `fire` event, or any `contact` event at level `identified`, from anyone to
//          anything -- a militiaman spotting a civilian, a gun truck cutting a neutral wall, both counted.
//   STRICT (what it means now, `MissionRuntime.isEnemyFire` / `isEnemyContact`): the two combat sides, 0 and 1, meeting.
// The trigger's real tick must equal the STRICT tick (a mismatch is flagged MISMATCH: this probe disagreeing with the runtime
// is a defect in one of them). A trigger firing in the first 100 ticks (5 s) is flagged EARLY; the LOOSE tick shows what the
// old rule did.
//
//   pnpm --filter @lions/tools exec tsx src/backtest/first-contact-probe.ts [--seeds=1,2,3,4,5] [--max-ticks=6000] [--missions=a,b]
import { missions } from '@lions/data';
import type { MissionJson, SimEvent } from '@lions/sim';
import { missionWorld } from '../mission-harness';

const arg = (name: string, d: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? d;
const SEEDS = arg('seeds', '1,2,3,4,5').split(',').map(Number);
const MAX_TICKS = Number(arg('max-ticks', '6000'));
const ONLY = arg('missions', '').split(',').filter((s) => s.length > 0);
const EARLY = 100;

interface Row {
  mission: string;
  trigger: string;
  seed: number;
  tick: number | null;
  loose: string;
  strict: string;
  world: string;
}

const rows: Row[] = [];
const ids = Object.keys(missions).filter((id) => ONLY.length === 0 || ONLY.includes(id)).sort();
for (const id of ids) {
  const mission = (missions as Record<string, MissionJson>)[id];
  const fc = (mission.triggers ?? []).map((t, i) => ({ t, i })).filter(({ t }) => t.on.kind === 'first_contact');
  if (fc.length === 0) continue;
  for (const seed of SEEDS) {
    let w;
    try {
      w = missionWorld(id, {}, seed);
    } catch (e) {
      rows.push({ mission: id, trigger: '*', seed, tick: null, loose: `world did not build: ${(e as Error).message.slice(0, 80)}`, strict: '', world: '' });
      continue;
    }
    const { sim, runtime } = w;
    const S = sim.state as unknown as Record<string, ArrayLike<number>>;
    const typeName = (e: number): string => sim.unitTypes[S.typeIdx[e]]?.id ?? '?';
    const at = (e: number): string => `${typeName(e)}#${e}(s${S.side[e]}) @(${(S.posX[e] / 65536).toFixed(1)},${(S.posY[e] / 65536).toFixed(1)})`;
    const pending = new Set(fc.map(({ t, i }) => t.id ?? `trigger_${i}`));
    let loose = '';
    let looseTick = -1;
    let strict = '';
    let strictTick = -1;
    const owner = sim.structures.owner as ArrayLike<number>;
    const describeFire = (e: Extract<SimEvent, { kind: 'fire' }>): string =>
      e.target >= 0 ? `fire: ${at(e.shooter)} -> ${at(e.target)}` : `fire at a structure: ${at(e.shooter)} -> structure ${e.structure ?? -1} (owner ${owner[e.structure ?? 0]})`;
    const describeContact = (e: Extract<SimEvent, { kind: 'contact' }>): string => {
      const d = e.observer >= 0 ? Math.hypot(S.posX[e.observer] - S.posX[e.target], S.posY[e.observer] - S.posY[e.target]) / 65536 : NaN;
      return `contact identified for side ${e.side}: observer ${e.observer >= 0 ? at(e.observer) : '-1 (a reveal or a pre-marked spawn)'} sees ${at(e.target)}${Number.isNaN(d) ? '' : `, ${d.toFixed(1)} tiles`}`;
    };
    // the strict reading, written out here independently of the runtime's (sides 0 and 1 only, never the same side, never neutral)
    const strictFire = (e: Extract<SimEvent, { kind: 'fire' }>): boolean => {
      const a = S.side[e.shooter];
      if (a > 1) return false;
      if (e.target >= 0) return S.side[e.target] <= 1 && S.side[e.target] !== a;
      const o = owner[e.structure ?? 0];
      return (o === 0 || o === 1) && o !== a;
    };
    const strictContact = (e: Extract<SimEvent, { kind: 'contact' }>): boolean => e.side <= 1 && S.side[e.target] <= 1 && S.side[e.target] !== e.side;
    for (let n = 0; n < MAX_TICKS && pending.size > 0; n++) {
      const ev = sim.tick();
      for (const e of ev as SimEvent[]) {
        if (e.kind === 'fire') {
          if (loose === '') { loose = describeFire(e); looseTick = sim.tickCount; }
          if (strict === '' && strictFire(e)) { strict = describeFire(e); strictTick = sim.tickCount; }
        } else if (e.kind === 'contact' && e.level === 'identified') {
          if (loose === '') { loose = describeContact(e); looseTick = sim.tickCount; }
          if (strict === '' && strictContact(e)) { strict = describeContact(e); strictTick = sim.tickCount; }
        }
      }
      for (const me of runtime.step(ev)) {
        if (me.kind !== 'trigger' || !pending.has(me.id)) continue;
        pending.delete(me.id);
        // nearest cross-side pair among the living, as the world at the firing tick
        let best = Infinity;
        let pair = '';
        let p0 = 0, e1 = 0;
        for (let a = 0; a < sim.entityCount; a++) {
          if (S.alive[a] === 0) continue;
          if (S.side[a] === 0) p0++; else if (S.side[a] === 1) e1++;
          if (S.side[a] !== 0) continue;
          for (let b = 0; b < sim.entityCount; b++) {
            if (S.alive[b] === 0 || S.side[b] !== 1) continue;
            const d = Math.hypot(S.posX[a] - S.posX[b], S.posY[a] - S.posY[b]) / 65536;
            if (d < best) { best = d; pair = `${at(a)} ~ ${at(b)}`; }
          }
        }
        rows.push({ mission: id, trigger: me.id, seed, tick: me.tick, loose: `${looseTick}: ${loose}`, strict: `${strictTick}${strictTick === me.tick ? '' : ' MISMATCH'}: ${strict}`, world: `player ${p0}, enemy ${e1} alive; nearest player-enemy pair ${Number.isFinite(best) ? best.toFixed(1) : 'n/a'} tiles: ${pair}` });
      }
    }
    for (const left of pending) rows.push({ mission: id, trigger: left, seed, tick: null, loose: loose === '' ? 'no event' : `${looseTick}: ${loose}`, strict: `not fired in ${MAX_TICKS} ticks`, world: '' });
  }
}

console.log('mission | trigger | seed | tick | LOOSE reading (first event, tick: what) | STRICT reading (tick: what) | world at the firing tick');
for (const r of rows) console.log(`${r.mission} | ${r.trigger} | ${r.seed} | ${r.tick === null ? 'never' : `${r.tick}${r.tick < EARLY ? ' EARLY' : ''}`} | ${r.loose} | ${r.strict} | ${r.world}`);
const early = rows.filter((r) => r.tick !== null && r.tick < EARLY);
const loosely = rows.filter((r) => /^\d+:/.test(r.loose) && Number(r.loose.split(':')[0]) < EARLY);
const mismatch = rows.filter((r) => r.strict.includes('MISMATCH'));
console.log(`\n${rows.length} (trigger, seed) rows; ${early.length} fire inside ${EARLY} ticks (${EARLY / 20} s) under the runtime's rule; the LOOSE rule would fire ${loosely.length}; ${mismatch.length} MISMATCH.`);
process.exitCode = early.length > 0 || mismatch.length > 0 ? 1 : 0;
