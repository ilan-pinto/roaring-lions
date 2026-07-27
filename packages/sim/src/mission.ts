// Mission runtime — the deterministic interpreter for declarative mission
// data (GDD §6). Missions are JSON: spawns, stances, triggers, waves, and an
// objective vocabulary. This module turns them into sim commands and mission
// events; it never reaches into sim internals (commands in, events out —
// invariant 4 applies to the runtime too).
//
// Shapes are declared structurally (the sim package imports nothing); the
// caller passes parsed mission JSON plus a context resolving unit ids and
// map markers/zones.

import { fx, HALF, type Fx } from './fixed';
import { TICKS_PER_SECOND, type Sim, type SimEvent } from './sim';

// ---------------------------------------------------------------------------

export interface StanceJson {
  /** 'hold_position' | 'ambush' | 'patrol' — string-typed so parsed JSON
   *  assigns structurally; the schema constrains the vocabulary. */
  kind: string;
  tiles?: number;
  waypoints?: readonly (readonly number[])[];
}

export interface PlacementJson {
  unit: string;
  count: number;
  at?: readonly number[];
  marker?: string;
  facing_deg?: number;
  group?: string;
  tag?: string;
  stance?: StanceJson;
}

export interface ObjectiveJson {
  id: string;
  type: string;
  primary: boolean;
  text?: string;
  target?: string;
  count?: number;
  seconds?: number;
}

export interface MissionJson {
  id: string;
  name?: string;
  map: { file: string; player_start?: readonly number[] };
  ledger: { requires: readonly string[]; produces: readonly string[] };
  objectives: readonly ObjectiveJson[];
  starting_force?: readonly PlacementJson[];
  enemy?: {
    faction?: string;
    garrison?: readonly PlacementJson[];
    waves?: readonly {
      at_seconds: number;
      trigger?: string;
      to?: string;
      units: readonly { unit: string; count: number; from?: string }[];
    }[];
  };
  triggers?: readonly {
    id?: string;
    on: { kind: string; value?: number; zone?: string };
    do: { kind: string; group?: string; to?: string; units?: readonly PlacementJson[] };
  }[];
}

export interface MissionContext {
  typeIdOf: (unitId: string) => number;
  markers: Record<string, readonly number[]>;
  zones: Record<string, readonly number[]>;
}

export type ObjectiveStatus = 'active' | 'complete' | 'failed';

export type MissionEvent =
  | { kind: 'objective'; tick: number; id: string; status: ObjectiveStatus }
  | { kind: 'trigger'; tick: number; id: string }
  | { kind: 'wave'; tick: number; count: number }
  | {
      kind: 'missionEnd';
      tick: number;
      result: 'victory' | 'defeat';
      roeRating: number;
      survivors: string[];
    };

const SUPPORTED = new Set(['locate', 'eliminate_hvt', 'capture', 'hold_for', 'survive_until', 'destroy_all']);

/** Spread for multi-unit placements: 1.25 tiles. */
const SPREAD = 81920;

interface ObjectiveState {
  def: ObjectiveJson;
  status: ObjectiveStatus;
  holdTicks: number;
}

interface PatrolState {
  id: number;
  waypoints: [Fx, Fx][];
  idx: number;
}

export class MissionRuntime {
  private readonly sim: Sim;
  private readonly mission: MissionJson;
  private readonly ctx: MissionContext;

  private readonly objectives: ObjectiveState[] = [];
  private readonly groups = new Map<string, number[]>();
  private readonly tags = new Map<string, number[]>();
  private readonly patrols: PatrolState[] = [];
  private readonly playerIds: number[] = [];
  private readonly enemyIds: number[] = [];
  private readonly identified = new Set<number>();
  private readonly firedTriggers: boolean[] = [];
  private readonly spawnedWaves: boolean[] = [];
  private firstContact = false;
  private ended = false;
  private resultValue: 'ongoing' | 'victory' | 'defeat' = 'ongoing';

  constructor(sim: Sim, mission: MissionJson, ctx: MissionContext) {
    this.sim = sim;
    this.mission = mission;
    this.ctx = ctx;
    for (const def of mission.objectives) {
      if (!SUPPORTED.has(def.type)) {
        throw new Error(
          `mission ${mission.id}: objective type "${def.type}" is not supported by the runtime yet`
        );
      }
      this.objectives.push({ def, status: 'active', holdTicks: 0 });
    }
    this.firedTriggers = new Array(mission.triggers?.length ?? 0).fill(false);
    this.spawnedWaves = new Array(mission.enemy?.waves?.length ?? 0).fill(false);
  }

  get result(): 'ongoing' | 'victory' | 'defeat' {
    return this.resultValue;
  }

  objectiveStatus(id: string): ObjectiveStatus {
    const o = this.objectives.find((x) => x.def.id === id);
    if (!o) throw new Error(`no objective ${id}`);
    return o.status;
  }

  /** Objective list for UI: id, type, text, primary, status. */
  get objectiveList(): { id: string; type: string; text: string; primary: boolean; status: ObjectiveStatus }[] {
    return this.objectives.map((o) => ({
      id: o.def.id,
      type: o.def.type,
      text: o.def.text ?? o.def.id,
      primary: o.def.primary,
      status: o.status,
    }));
  }

  /** Spawn everything the mission declares. Call once before the first tick. */
  start(): void {
    for (const p of this.mission.starting_force ?? []) this.spawnPlacement(p, 0);
    for (const p of this.mission.enemy?.garrison ?? []) this.spawnPlacement(p, 1);
    for (const [tag, ids] of this.tags) {
      if (ids.length === 0) throw new Error(`mission ${this.mission.id}: tag "${tag}" has no units`);
    }
    for (const o of this.objectives) {
      if (o.def.type === 'eliminate_hvt') {
        const tag = o.def.target;
        if (!tag || !this.tags.has(tag)) {
          throw new Error(`mission ${this.mission.id}: eliminate_hvt "${o.def.id}" needs a garrisoned tag`);
        }
      }
      if ((o.def.type === 'capture' || o.def.type === 'hold_for') && !this.zone(o.def.target)) {
        throw new Error(`mission ${this.mission.id}: objective "${o.def.id}" needs a valid zone`);
      }
    }
  }

  /** Advance the mission one tick. Call immediately after sim.tick(). */
  step(simEvents: SimEvent[]): MissionEvent[] {
    if (this.ended) return [];
    const out: MissionEvent[] = [];
    const tick = this.sim.tickCount;

    // Digest sim events: contacts feed locate + first_contact.
    for (const e of simEvents) {
      if (e.kind === 'fire') this.firstContact = true;
      if (e.kind === 'contact' && e.level === 'identified') {
        this.firstContact = true;
        if (e.side === 0 && this.sim.state.side[e.target] === 1) this.identified.add(e.target);
      }
    }

    this.stepPatrols();
    this.stepTriggers(tick, out);
    this.stepWaves(tick, out);
    this.stepObjectives(tick, out);
    this.checkEnd(tick, out);
    return out;
  }

  // ------------------------------------------------------------------ spawns

  private markerPos(name: string): [Fx, Fx] {
    const m = this.ctx.markers[name];
    if (!m) throw new Error(`mission ${this.mission.id}: unknown marker "${name}"`);
    return [fx.add(fx.fromInt(m[0]), HALF), fx.add(fx.fromInt(m[1]), HALF)];
  }

  private zone(name: string | undefined): readonly number[] | undefined {
    return name ? this.ctx.zones[name] : undefined;
  }

  private spawnPlacement(p: PlacementJson, side: number): number[] {
    let bx: Fx;
    let by: Fx;
    if (p.marker !== undefined) {
      [bx, by] = this.markerPos(p.marker);
    } else if (p.at !== undefined) {
      bx = fx.from(p.at[0]);
      by = fx.from(p.at[1]);
    } else {
      const ps = this.mission.map.player_start;
      if (!ps) throw new Error(`mission ${this.mission.id}: placement of ${p.unit} has no position`);
      bx = fx.from(ps[0]);
      by = fx.from(ps[1]);
    }
    const facing = p.facing_deg !== undefined ? fx.div(fx.from(p.facing_deg), fx.fromInt(360)) & 0xffff : 0;
    const typeIdx = this.ctx.typeIdOf(p.unit);
    const ids: number[] = [];
    for (let k = 0; k < p.count; k++) {
      const ox = (k % 3) * SPREAD;
      const oy = ((k - (k % 3)) / 3) * SPREAD;
      const id = this.sim.spawn(typeIdx, side, fx.add(bx, ox), fx.add(by, oy), facing);
      ids.push(id);
      (side === 0 ? this.playerIds : this.enemyIds).push(id);
      if (p.group) {
        const g = this.groups.get(p.group) ?? [];
        g.push(id);
        this.groups.set(p.group, g);
      }
      if (p.tag) {
        const t = this.tags.get(p.tag) ?? [];
        t.push(id);
        this.tags.set(p.tag, t);
      }
      if (p.stance?.kind === 'ambush') {
        this.sim.setAmbush(id, fx.from(p.stance.tiles ?? 3));
      } else if (p.stance?.kind === 'patrol' && p.stance.waypoints && p.stance.waypoints.length >= 2) {
        this.patrols.push({
          id,
          waypoints: p.stance.waypoints.map((w) => [fx.from(w[0]), fx.from(w[1])]),
          idx: 0,
        });
      }
    }
    return ids;
  }

  // ----------------------------------------------------------------- systems

  private stepPatrols(): void {
    for (const p of this.patrols) {
      if (this.sim.state.alive[p.id] === 0) continue;
      if (this.sim.state.moving[p.id] === 1) continue;
      const [wx, wy] = p.waypoints[p.idx];
      p.idx = (p.idx + 1) % p.waypoints.length;
      this.sim.queueCommand({ kind: 'move', ids: [p.id], x: wx, y: wy });
    }
  }

  private livingIn(zone: readonly number[], side: number): number {
    let n = 0;
    const st = this.sim.state;
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] === 0 || st.side[i] !== side) continue;
      const tx = st.posX[i] >> 16;
      const ty = st.posY[i] >> 16;
      if (tx >= zone[0] && tx < zone[0] + zone[2] && ty >= zone[1] && ty < zone[1] + zone[3]) n++;
    }
    return n;
  }

  private stepTriggers(tick: number, out: MissionEvent[]): void {
    const triggers = this.mission.triggers ?? [];
    for (let i = 0; i < triggers.length; i++) {
      if (this.firedTriggers[i]) continue;
      const t = triggers[i];
      let fire = false;
      if (t.on.kind === 'first_contact') {
        fire = this.firstContact;
      } else if (t.on.kind === 'timer_s') {
        fire = tick >= (t.on.value ?? 0) * TICKS_PER_SECOND;
      } else if (t.on.kind === 'casualties_pct') {
        const initial = this.enemyIds.length;
        if (initial > 0) {
          let dead = 0;
          for (const id of this.enemyIds) if (this.sim.state.alive[id] === 0) dead++;
          fire = dead * 100 >= (t.on.value ?? 100) * initial;
        }
      } else if (t.on.kind === 'zone_entered') {
        const z = this.zone(t.on.zone);
        fire = z !== undefined && this.livingIn(z, 0) > 0;
      }
      if (!fire) continue;
      this.firedTriggers[i] = true;
      out.push({ kind: 'trigger', tick, id: t.id ?? `trigger_${i}` });

      if (t.do.kind === 'commit' || t.do.kind === 'withdraw_to') {
        const ids = (this.groups.get(t.do.group ?? '') ?? []).filter((id) => this.sim.state.alive[id] === 1);
        if (ids.length > 0 && t.do.to) {
          const [x, y] = this.markerPos(t.do.to);
          this.sim.queueCommand({ kind: t.do.kind === 'commit' ? 'attackMove' : 'move', ids, x, y });
        }
      } else if (t.do.kind === 'spawn') {
        for (const p of t.do.units ?? []) this.spawnPlacement(p, 1);
      }
    }
  }

  private stepWaves(tick: number, out: MissionEvent[]): void {
    const waves = this.mission.enemy?.waves ?? [];
    for (let i = 0; i < waves.length; i++) {
      if (this.spawnedWaves[i]) continue;
      const w = waves[i];
      let due: boolean;
      if (w.trigger !== undefined) {
        due = this.objectives.some((o) => o.def.id === w.trigger && o.status === 'complete');
      } else {
        due = tick >= w.at_seconds * TICKS_PER_SECOND;
      }
      if (!due) continue;
      this.spawnedWaves[i] = true;
      const spawned: number[] = [];
      for (const u of w.units) {
        if (!u.from) throw new Error(`mission ${this.mission.id}: wave unit ${u.unit} has no "from"`);
        spawned.push(...this.spawnPlacement({ unit: u.unit, count: u.count, marker: u.from }, 1));
      }
      out.push({ kind: 'wave', tick, count: spawned.length });
      if (w.to && spawned.length > 0) {
        const [x, y] = this.markerPos(w.to);
        this.sim.queueCommand({ kind: 'attackMove', ids: spawned, x, y });
      }
    }
  }

  private stepObjectives(tick: number, out: MissionEvent[]): void {
    for (const o of this.objectives) {
      if (o.status !== 'active') continue;
      const d = o.def;
      let complete = false;
      if (d.type === 'destroy_all') {
        complete = this.enemyIds.length > 0 && this.enemyIds.every((id) => this.sim.state.alive[id] === 0);
      } else if (d.type === 'eliminate_hvt') {
        const ids = this.tags.get(d.target ?? '') ?? [];
        complete = ids.length > 0 && ids.every((id) => this.sim.state.alive[id] === 0);
      } else if (d.type === 'locate') {
        if (d.target) {
          const ids = this.tags.get(d.target) ?? [];
          complete = ids.length > 0 && ids.every((id) => this.identified.has(id));
        } else {
          complete = this.identified.size >= (d.count ?? 1);
        }
      } else if (d.type === 'survive_until') {
        complete = tick >= (d.seconds ?? 60) * TICKS_PER_SECOND;
      } else if (d.type === 'capture') {
        const z = this.zone(d.target);
        if (z && this.livingIn(z, 0) > 0 && this.livingIn(z, 1) === 0) o.holdTicks++;
        else o.holdTicks = 0;
        complete = o.holdTicks >= (d.seconds ?? 10) * TICKS_PER_SECOND;
      } else if (d.type === 'hold_for') {
        const z = this.zone(d.target);
        if (z && this.livingIn(z, 0) > 0 && this.livingIn(z, 1) === 0) o.holdTicks++;
        complete = o.holdTicks >= (d.seconds ?? 60) * TICKS_PER_SECOND;
      }
      if (complete) {
        o.status = 'complete';
        out.push({ kind: 'objective', tick, id: d.id, status: 'complete' });
      }
    }
  }

  private checkEnd(tick: number, out: MissionEvent[]): void {
    const primaries = this.objectives.filter((o) => o.def.primary);
    const won = primaries.length > 0 && primaries.every((o) => o.status === 'complete');
    const wiped =
      this.playerIds.length > 0 && this.playerIds.every((id) => this.sim.state.alive[id] === 0);
    if (!won && !wiped) return;

    this.ended = true;
    this.resultValue = won ? 'victory' : 'defeat';
    const survivors: string[] = [];
    for (const id of this.playerIds) {
      if (this.sim.state.alive[id] === 1) survivors.push(this.sim.unitTypes[this.sim.state.typeIdx[id]].id);
    }
    out.push({
      kind: 'missionEnd',
      tick,
      result: this.resultValue,
      roeRating: 100, // ROE scoring lands with the civilians slice
      survivors,
    });
  }
}
