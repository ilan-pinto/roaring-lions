// G0 skirmish spike (GH-187) -- a utility-scored doctrine commander.
//
// THROWAWAY. Lives on `spike/skirmish-g0` only. The question it answers is
// whether a commander that reacts can be built inside the four invariants and
// over the mission vocabulary that already exists. It therefore:
//
//  - perceives the enemy ONLY through its own side's contact picture
//    (`contactLevel` + `lastSeenOf`), never through `state.pos*` of a unit it
//    has not seen;
//  - acts ONLY through `MissionRuntime.command` (the trigger `do` path:
//    commit, withdraw_to, plus the spike's `stance`) and
//    `MissionRuntime.dispatchWave` (the wave spawn path), never by calling
//    `sim.queueCommand` itself;
//  - is integer arithmetic throughout (no `/`, no Math) and draws its only
//    randomness from its own seeded Rng stream, so it is deterministic and the
//    unit streams are untouched by it.

import { Rng } from './rng';
import type { MissionRuntime } from './mission';
import type { Sim } from './sim';

export interface DoctrineZoneJson {
  id: string;
  /** [x, y, w, h] in tiles. */
  rect: readonly number[];
  /** Where a holding group stands. */
  marker: string;
  /** Where a standoff unit (ATGM) covers the zone from. */
  standoff_marker?: string;
  /** Income-weighted worth, before the per-game jitter. */
  value: number;
  /** True when the zone lies on the player's side of the wall. */
  forward?: boolean;
  /** Round 2: where a main effort on this zone is fought FROM -- a line
   *  behind the zone, so the fist comes onto prepared fire. */
  fallback?: string;
  /** A route to watch, not ground to hold: no income, no standing garrison,
   *  staffed only while the enemy is seen in or near it. */
  watch?: boolean;
}

export interface DoctrineWaveJson {
  unit: string;
  count: number;
  cost: number;
}

export interface DoctrineJson {
  id: string;
  side: number;
  think_ticks: number;
  /** Threat/force weight per unit type, both factions. */
  power: Record<string, number>;
  default_power: number;
  zones: readonly DoctrineZoneJson[];
  hq: { unit: string; marker: string; radius_tiles: number; value: number };
  /** Power a zone needs held when nobody is contesting it. */
  min_hold_power: number;
  /** Commit to a contested task only with own power >= enemy * this / 100. */
  attack_ratio_pct: number;
  /** Write a contested task off when what is left < enemy * this / 100. */
  abandon_ratio_pct: number;
  threat_radius_tiles: number;
  /** A unit keeps its task unless another is this much nearer (1/1024 tile). */
  hysteresis: number;
  /** A unit keeps the task it was last ordered to for this long, unless that
   *  ground is written off. Without it a 1 Hz re-plan walks units back and
   *  forth under fire and the ATGMs never set up. */
  dwell_ticks: number;
  /** Per-think selection noise, 1/1024 tile. */
  selection_jitter: number;
  /** Per-game zone value jitter, percent either way. */
  value_jitter_pct: number;
  ambush: Record<string, number>;
  standoff: readonly string[];
  static: readonly string[];
  armour: readonly string[];
  /** The only types that count against armour. A task with enemy armour near
   *  it is staffed from these alone; rifles do not stop tanks. */
  anti_armour: readonly string[];
  /** Where withdrawn and idle units gather. */
  reserve_marker: string;
  /** Round 2 (all three optional; absent = round 1 behaviour). */
  main_effort?: {
    /** A task is the main effort when it holds this share of all enemy
     *  power seen, and at least `min_enemy` is seen in total. */
    share_pct: number;
    min_enemy: number;
    /** Concentrate the ANTI-ARMOUR on the main effort only; the rest keep
     *  their ground. Default false: everything goes. */
    at_only?: boolean;
    /** Fight from the zone's fallback line. Default true. */
    use_fallback?: boolean;
  };
  /** A unit below this share of its hull, or routed, is withdrawn to the
   *  reserve and never fed back in. */
  preserve_hp_pct?: number;
  /** Bank the wave budget while not pressed; release it in one wave at the
   *  main effort once at least `min_bank` is banked. */
  counterattack?: { min_bank: number; max_units: number };
  waves: {
    start_budget: number;
    income_per_point: number;
    cooldown_ticks: number;
    spawns: readonly string[];
    anti_armour: readonly DoctrineWaveJson[];
    general: readonly DoctrineWaveJson[];
  };
}

export interface CommanderDecision {
  tick: number;
  kind: 'commit' | 'withdraw' | 'abandon' | 'wave' | 'stance';
  task: string;
  n: number;
}

interface Task {
  id: string;
  /** Tile the holding group is sent to, and its standoff twin. */
  marker: string;
  standoff: string;
  rect: readonly number[];
  utility: number;
  /** Anti-armour power needed, x100. */
  atNeed100: number;
  /** Further power of any kind needed, x100. */
  softNeed100: number;
  armour: number;
  soft: number;
  enemy: number;
  armourSeen: boolean;
  abandoned: boolean;
  /** The quiet task leftovers and withdrawn units go to. */
  reserve?: boolean;
  /** Round 2: this is the main effort. */
  main?: boolean;
  /** The zone's own marker, kept when `marker` moves to a fallback line. */
  strike: string;
}

/** |v| without Math. */
function iabs(v: number): number {
  return v < 0 ? -v : v;
}

/** Octile distance in 1/1024 tile between two Q16.16 points; integer only. */
function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = iabs((ax - bx) >> 6);
  const dy = iabs((ay - by) >> 6);
  const mx = dx > dy ? dx : dy;
  const mn = dx > dy ? dy : dx;
  return mx + ((mn * 424) >> 10);
}

export class Commander {
  readonly trace: CommanderDecision[] = [];
  budget: number;
  private readonly rng: Rng;
  private readonly zoneValue: number[];
  private readonly assigned = new Map<number, number>();
  private readonly ambushed = new Set<number>();
  private readonly orderedAt = new Map<number, number>();
  private readonly preserved = new Set<number>();
  private readonly lastMarker = new Map<string, string>();
  private readonly abandonedPrev: boolean[];
  private lastWave = -1_000_000;
  private hq = -1;
  /** Units the commander has ever owned; spawned waves are added on arrival. */
  private readonly owned = new Set<number>();

  constructor(
    private readonly sim: Sim,
    private readonly rt: MissionRuntime,
    private readonly d: DoctrineJson,
    private readonly markers: Record<string, readonly number[]>,
    seed: number,
  ) {
    this.rng = new Rng((seed ^ 0x2c0ff1ce) | 0, 1);
    this.budget = d.waves.start_budget;
    const j = d.value_jitter_pct;
    // Value scaled x100, jittered once per game: the commander's "personality"
    // for this seed, so two seeds never weigh the ground identically.
    this.zoneValue = d.zones.map((z) => z.value * (100 - j + (this.rng.nextU32(0) % (2 * j + 1))));
    this.abandonedPrev = d.zones.map(() => false);
  }

  /** Points from held ground, converted to wave budget. */
  credit(points: number): void {
    this.budget += points * this.d.waves.income_per_point;
  }

  private markerFx(name: string): [number, number] {
    const m = this.markers[name];
    if (!m) throw new Error(`commander: unknown marker ${name}`);
    return [(m[0] << 16) + 0x8000, (m[1] << 16) + 0x8000];
  }

  private powerOf(id: number): number {
    const t = this.sim.unitTypes[this.sim.state.typeIdx[id]].id;
    return this.d.power[t] ?? this.d.default_power;
  }

  private typeOf(id: number): string {
    return this.sim.unitTypes[this.sim.state.typeIdx[id]].id;
  }

  /** Call once after `rt.start()`. */
  adopt(): void {
    const st = this.sim.state;
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] !== 1 || st.side[i] !== this.d.side) continue;
      if (this.typeOf(i) === this.d.hq.unit && this.hq < 0) this.hq = i;
      this.owned.add(i);
    }
  }

  step(tick: number): void {
    if (tick % this.d.think_ticks !== 1) return;
    this.think(tick);
  }

  private think(tick: number): void {
    const sim = this.sim;
    const st = sim.state;
    const side = this.d.side;
    const R = this.d.threat_radius_tiles;

    // --- perception: own force (full knowledge) and the contact picture ---
    const mine: number[] = [];
    for (const id of this.owned) {
      if (st.alive[id] !== 1 || st.tunnelIn[id] >= 0) continue;
      if (this.d.static.includes(this.typeOf(id))) continue;
      mine.push(id);
    }
    mine.sort((a, b) => a - b);
    const ex: number[] = [];
    const ey: number[] = [];
    const ep: number[] = [];
    const ea: boolean[] = [];
    for (let e = 0; e < sim.entityCount; e++) {
      if (st.alive[e] !== 1) continue;
      const s = st.side[e];
      if (s === side || s > 1) continue;
      if (sim.contactLevel(side, e) < 1) continue;
      const seen = sim.lastSeenOf(side, e);
      if (seen === null) continue;
      ex.push(seen[0] >> 16);
      ey.push(seen[1] >> 16);
      ep.push(this.powerOf(e));
      ea.push(this.d.armour.includes(this.typeOf(e)));
    }

    // --- tasks: every income zone, plus the HQ when threatened ---
    // Enemy power is split: armour can only be answered by anti-armour units,
    // everything else by anyone. One scalar "strength" sent rifles at tanks.
    const ratio = this.d.attack_ratio_pct;
    const mkTask = (id: string, marker: string, standoff: string, rect: readonly number[], inside: (x: number, y: number) => boolean, base: number, perEnemy: number, minHold: number): Task => {
      let armour = 0;
      let soft = 0;
      for (let k = 0; k < ex.length; k++) {
        if (!inside(ex[k], ey[k])) continue;
        if (ea[k]) armour += ep[k];
        else soft += ep[k];
      }
      const softNeed = soft * ratio;
      return {
        id, marker, standoff, rect, strike: marker,
        // Contested ground is worth more than quiet ground: that is where
        // the income is being decided.
        utility: base + (armour + soft) * perEnemy,
        atNeed100: armour * ratio,
        softNeed100: softNeed > minHold * 100 ? softNeed : minHold * 100,
        armour, soft,
        enemy: armour + soft,
        armourSeen: armour > 0,
        abandoned: false,
      };
    };
    const tasks: Task[] = [];
    for (let z = 0; z < this.d.zones.length; z++) {
      const zn = this.d.zones[z];
      const r = zn.rect;
      tasks.push(mkTask(zn.id, zn.marker, zn.standoff_marker ?? zn.marker, r,
        (x, y) => x >= r[0] - R && x < r[0] + r[2] + R && y >= r[1] - R && y < r[1] + r[3] + R,
        this.zoneValue[z] * 10, 2, zn.watch === true ? 0 : this.d.min_hold_power));
    }
    if (this.hq >= 0 && st.alive[this.hq] === 1) {
      const hx = st.posX[this.hq] >> 16;
      const hy = st.posY[this.hq] >> 16;
      const hr = this.d.hq.radius_tiles;
      const t = mkTask('hq', this.d.hq.marker, this.d.hq.marker, [hx - hr, hy - hr, 2 * hr + 1, 2 * hr + 1],
        (x, y) => iabs(x - hx) <= hr && iabs(y - hy) <= hr, this.d.hq.value * 1000, 4, 0);
      if (t.enemy > 0) tasks.push(t);
    }
    const reserveIdx = tasks.length;
    tasks.push({
      id: 'reserve', marker: this.d.reserve_marker, standoff: this.d.reserve_marker, rect: [0, 0, 0, 0],
      strike: this.d.reserve_marker,
      utility: -1, atNeed100: 0, softNeed100: 0, armour: 0, soft: 0, enemy: 0,
      armourSeen: false, abandoned: false, reserve: true,
    });
    // --- round 2: main effort. One task holding most of what the enemy is
    // showing takes everything; peripheral ground is written off and the
    // fight is taken from that zone's fallback line. ---
    let mainIdx = -1;
    const me = this.d.main_effort;
    if (me) {
      let seen = 0;
      for (const p of ep) seen += p;
      let best = -1;
      for (let ti = 0; ti < reserveIdx; ti++) if (best < 0 || tasks[ti].enemy > tasks[best].enemy) best = ti;
      if (best >= 0 && seen >= me.min_enemy && tasks[best].enemy * 100 >= seen * me.share_pct) {
        mainIdx = best;
        const t = tasks[best];
        t.main = true;
        const zn = best < this.d.zones.length ? this.d.zones[best] : undefined;
        if (zn?.fallback && me.use_fallback !== false) {
          t.marker = zn.fallback;
          t.standoff = zn.fallback;
        }
        t.utility = 1_000_000_000;
        if (me.at_only === true) t.atNeed100 = 1_000_000_000;
        for (let ti = 0; ti < reserveIdx; ti++) {
          if (me.at_only === true) break;
          if (ti === best) continue;
          // Peripheral ground keeps nothing unless it is itself contested.
          if (tasks[ti].enemy === 0) tasks[ti].softNeed100 = 0;
        }
      }
    }
    const order = tasks.map((_, i) => i).sort((a, b) => tasks[b].utility - tasks[a].utility || a - b);

    // --- assignment: greedy by utility, nearest units first ---
    const free = new Set(mine);
    const next = new Map<number, number>();
    const gotAT = tasks.map(() => 0);
    const gotAll = tasks.map(() => 0);
    const isAT = (id: number) => this.d.anti_armour.includes(this.typeOf(id));
    const give = (id: number, ti: number) => {
      free.delete(id);
      next.set(id, ti);
      const p = this.powerOf(id) * 100;
      if (isAT(id)) gotAT[ti] += p;
      gotAll[ti] += p;
    };
    // Round 2 preservation: a damaged or routed unit leaves the fight for
    // good and waits at the reserve.
    const keep = this.d.preserve_hp_pct;
    const leavingNow = new Set<number>();
    if (keep !== undefined && keep !== null) {
      for (const id of mine) {
        if (this.preserved.has(id)) {
          give(id, reserveIdx);
          continue;
        }
        const full = sim.unitTypes[st.typeIdx[id]].hp;
        if (st.routed[id] === 1 || (st.hp[id] >> 8) * 100 < (full >> 8) * keep) {
          this.preserved.add(id);
          leavingNow.add(id);
          give(id, reserveIdx);
        }
      }
    }
    // Dwell: recently ordered units stay on their task.
    for (const id of mine) {
      const prev = this.assigned.get(id);
      const at = this.orderedAt.get(id);
      if (!free.has(id)) continue;
      if (prev === undefined || prev >= tasks.length || tasks[prev].reserve) continue;
      if (at === undefined || tick - at >= this.d.dwell_ticks) continue;
      // A main effort overrides dwell: concentration is the point.
      if (mainIdx >= 0 && prev !== mainIdx) continue;
      give(id, prev);
    }
    const nearest = (ti: number, atOnly: boolean): number => {
      const [px, py] = this.markerFx(tasks[ti].marker);
      let best = -1;
      let bestScore = 0;
      for (const id of free) {
        if (atOnly && !isAT(id)) continue;
        let sc = dist(st.posX[id], st.posY[id], px, py);
        if (this.assigned.get(id) === ti) sc -= this.d.hysteresis;
        sc += this.rng.nextU32(0) % (this.d.selection_jitter + 1);
        if (best < 0 || sc < bestScore) {
          best = id;
          bestScore = sc;
        }
      }
      return best;
    };
    for (const ti of order) {
      const t = tasks[ti];
      if (t.reserve) continue;
      let availAT = 0;
      let availAll = 0;
      for (const id of free) {
        const p = this.powerOf(id) * 100;
        if (isAT(id)) availAT += p;
        availAll += p;
      }
      // Not enough left to do this one: write contested ground off rather
      // than feed it piecemeal. Quiet ground is held with what there is.
      const ab = this.d.abandon_ratio_pct;
      if (!t.main && ((t.armour > 0 && availAT + gotAT[ti] < t.armour * ab) || (t.enemy > 0 && availAll + gotAll[ti] < t.enemy * ab))) {
        t.abandoned = true;
        continue;
      }
      while (gotAT[ti] < t.atNeed100) {
        const u = nearest(ti, true);
        if (u < 0) break;
        give(u, ti);
      }
      while (gotAll[ti] < t.atNeed100 + t.softNeed100) {
        const u = nearest(ti, false);
        if (u < 0) break;
        give(u, ti);
      }
    }
    // Leftovers concentrate on the best task still being fought for; else
    // the reserve.
    let top = reserveIdx;
    let topSoft = reserveIdx;
    for (const ti of order) if (!tasks[ti].reserve && !tasks[ti].abandoned) { top = ti; break; }
    for (const ti of order) if (!tasks[ti].reserve && !tasks[ti].abandoned && !tasks[ti].main) { topSoft = ti; break; }
    for (const id of [...free]) give(id, me?.at_only === true && !isAT(id) && topSoft !== reserveIdx ? topSoft : top);
    // Units leaving ground just written off go to the reserve FIRST, rather
    // than straight across the open to their next task.
    for (const id of mine) {
      const prev = this.assigned.get(id);
      if (prev !== undefined && prev < tasks.length && tasks[prev].abandoned) next.set(id, reserveIdx);
    }

    // --- log write-offs once, when they happen ---
    for (let z = 0; z < this.d.zones.length; z++) {
      const ab = tasks[z].abandoned;
      if (ab && !this.abandonedPrev[z]) this.trace.push({ tick, kind: 'abandon', task: tasks[z].id, n: 0 });
      this.abandonedPrev[z] = ab;
    }

    // --- orders: only for units whose task changed ---
    for (let ti = 0; ti < tasks.length; ti++) {
      const t = tasks[ti];
      const moved: number[] = [];
      // A task whose marker moved (a main effort falling back to its line)
      // re-orders everyone on it, not only the newcomers.
      const markerMoved = (this.lastMarker.get(t.id) ?? t.marker) !== t.marker;
      this.lastMarker.set(t.id, t.marker);
      for (const id of mine) {
        if (next.get(id) === ti && (this.assigned.get(id) !== ti || markerMoved)) moved.push(id);
      }
      if (moved.length === 0) continue;
      // A unit leaving ground the doctrine has written off WITHDRAWS (move,
      // no stopping to fight); everyone else COMMITS (attack-move).
      const leaving: number[] = [];
      const going: number[] = [];
      for (const id of moved) {
        const prev = this.assigned.get(id);
        if (leavingNow.has(id) || (prev !== undefined && prev < tasks.length && tasks[prev].abandoned)) leaving.push(id);
        else going.push(id);
        this.ambushed.delete(id);
      }
      this.issue(tick, t, leaving, 'withdraw');
      this.issue(tick, t, going, 'commit');
    }
    this.assigned.clear();
    for (const [id, ti] of next) this.assigned.set(id, ti);

    // --- stances: an ambusher that has arrived lies in wait ---
    for (const id of mine) {
      const tiles = this.d.ambush[this.typeOf(id)];
      if (tiles === undefined || this.ambushed.has(id)) continue;
      const ti = this.assigned.get(id);
      if (ti === undefined) continue;
      const [gx, gy] = this.markerFx(tasks[ti].marker);
      if (dist(st.posX[id], st.posY[id], gx, gy) > 2048) continue;
      this.ambushed.add(id);
      const g = `cmd_amb_${id}`;
      this.rt.setGroup(g, [id]);
      this.rt.command({ kind: 'stance', group: g, tiles });
      this.trace.push({ tick, kind: 'stance', task: tasks[ti].id, n: 1 });
    }

    // --- waves: spend the budget where the deficit is largest ---
    if (tick - this.lastWave < this.d.waves.cooldown_ticks) return;
    const ca = this.d.counterattack;
    if (ca) {
      // Round 2: bank while not pressed; when a main effort is on, release
      // the bank as one wave that strikes the zone itself.
      if (mainIdx < 0 || this.budget < ca.min_bank) return;
      const t = tasks[mainIdx];
      const wantAT = gotAT[mainIdx] < t.atNeed100;
      const units: { unit: string; count: number; from: string }[] = [];
      const [tx, ty] = this.markerFx(t.strike);
      let from = this.d.waves.spawns[0];
      let fromD = -1;
      for (const sp of this.d.waves.spawns) {
        const [sx, sy] = this.markerFx(sp);
        const dd = dist(sx, sy, tx, ty);
        if (fromD < 0 || dd < fromD) {
          from = sp;
          fromD = dd;
        }
      }
      let n = 0;
      let k = 0;
      while (n < ca.max_units) {
        // Alternate, anti-armour first when armour is what is pressing.
        const menu = (k & 1) === (wantAT ? 0 : 1) ? this.d.waves.anti_armour : this.d.waves.general;
        k++;
        const w = menu[0];
        if (w.cost > this.budget) {
          const alt = (menu === this.d.waves.anti_armour ? this.d.waves.general : this.d.waves.anti_armour)[0];
          if (alt.cost > this.budget) break;
          continue;
        }
        this.budget -= w.cost;
        units.push({ unit: w.unit, count: w.count, from });
        n += w.count;
      }
      if (units.length === 0) return;
      this.lastWave = tick;
      const ids = this.rt.dispatchWave({ units, to: t.strike });
      for (const id of ids) {
        this.owned.add(id);
        this.assigned.set(id, mainIdx);
        this.orderedAt.set(id, tick);
      }
      this.trace.push({ tick, kind: 'wave', task: t.id, n: ids.length });
      return;
    }
    let worst = -1;
    let worstGap = 0;
    for (let ti = 0; ti < tasks.length; ti++) {
      if (tasks[ti].reserve) continue;
      const gap = tasks[ti].atNeed100 + tasks[ti].softNeed100 - gotAll[ti];
      if (gap > worstGap) {
        worst = ti;
        worstGap = gap;
      }
    }
    if (worst < 0) return;
    const t = tasks[worst];
    const menu = gotAT[worst] < t.atNeed100 ? this.d.waves.anti_armour : this.d.waves.general;
    // Cheapest item that closes the most gap within budget, in menu order.
    let pick: DoctrineWaveJson | null = null;
    for (const w of menu) if (w.cost <= this.budget) { pick = w; break; }
    if (pick === null) return;
    const [tx, ty] = this.markerFx(t.marker);
    let from = this.d.waves.spawns[0];
    let fromD = -1;
    for (const s of this.d.waves.spawns) {
      const [sx, sy] = this.markerFx(s);
      const dd = dist(sx, sy, tx, ty);
      if (fromD < 0 || dd < fromD) {
        from = s;
        fromD = dd;
      }
    }
    this.budget -= pick.cost;
    this.lastWave = tick;
    const ids = this.rt.dispatchWave({
      units: [{ unit: pick.unit, count: pick.count, from }],
      to: this.d.standoff.includes(pick.unit) ? t.standoff : t.marker,
    });
    for (const id of ids) {
      this.owned.add(id);
      this.assigned.set(id, worst);
      this.orderedAt.set(id, tick);
    }
    this.trace.push({ tick, kind: 'wave', task: t.id, n: ids.length });
  }

  private issue(tick: number, t: Task, ids: number[], kind: 'commit' | 'withdraw'): void {
    if (ids.length === 0) return;
    for (const id of ids) this.orderedAt.set(id, tick);
    const off: number[] = [];
    const on: number[] = [];
    for (const id of ids) (this.d.standoff.includes(this.typeOf(id)) ? off : on).push(id);
    const doKind = kind === 'commit' ? 'commit' : 'withdraw_to';
    if (on.length > 0) {
      const g = `cmd_${t.id}_${kind}`;
      this.rt.setGroup(g, on);
      this.rt.command({ kind: doKind, group: g, to: t.marker });
    }
    if (off.length > 0) {
      const g = `cmd_${t.id}_${kind}_standoff`;
      this.rt.setGroup(g, off);
      this.rt.command({ kind: doKind, group: g, to: t.standoff });
    }
    this.trace.push({ tick, kind, task: t.id, n: ids.length });
  }
}
