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
  /** Draw survivors (with veterancy) from roster.surviving_units instead of
   *  spawning fresh. Sparse rosters degrade gracefully: fewer units, and a
   *  single fresh remnant when the roster has none of this type. */
  from_ledger?: boolean;
}

/** Campaign carry-over: the ledger keys this runtime understands today.
 *  Missions may declare future keys; the runtime produces only what it can. */
export interface LedgerRosterEntry {
  type: string;
  veterancy: number;
}
export interface LedgerData {
  'roster.surviving_units'?: LedgerRosterEntry[];
  'roe.cumulative_rating'?: number;
  [key: string]: unknown;
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
  resources?: {
    logistics_start?: number;
    intel_start?: number;
    logistics_rate_per_min?: number;
    supply_corridor?: boolean;
  };
  civilians?: {
    groups: readonly PlacementJson[];
    refuge?: string;
  };
  roe?: {
    enabled?: boolean;
    civilian_casualty_penalty?: number;
    flagged_structure_penalty?: number;
    disproportionate_ordnance_penalty?: number;
    flagged_zones?: readonly string[];
    fail_below?: number;
  };
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
  /** Campaign ledger read on entry (mission.ledger.requires). Absent or
   *  sparse values make the mission harder, never broken. */
  ledger?: LedgerData;
  /** Production catalogue: cost and build time per unit id, null if the
   *  unit cannot be built in the field. */
  unitInfo?: (unitId: string) => { logistics: number; intel?: number; buildTimeS: number } | null;
}

export type ObjectiveStatus = 'active' | 'complete' | 'failed';

export type MissionEvent =
  | { kind: 'objective'; tick: number; id: string; status: ObjectiveStatus }
  | { kind: 'trigger'; tick: number; id: string }
  | { kind: 'wave'; tick: number; count: number }
  | { kind: 'roe'; tick: number; penalty: number; reason: string; score: number }
  | { kind: 'built'; tick: number; unit: string }
  | {
      kind: 'missionEnd';
      tick: number;
      result: 'victory' | 'defeat';
      roeRating: number;
      survivors: string[];
      /** The produced carry-over, filtered to mission.ledger.produces. The
       *  app merges this into the campaign ledger on victory. */
      ledger: LedgerData;
    };

const SUPPORTED = new Set(['locate', 'eliminate_hvt', 'capture', 'hold_for', 'survive_until', 'destroy_all']);

/** Spread for multi-unit placements: 1.25 tiles. */
const SPREAD = 81920;
/** Civilians break for the refuge above this suppression (0.3). */
const CIV_FLEE_AT = 19661;
/** "Danger close": civilians within this of an aimpoint make heavy ordnance
 *  disproportionate (2 tiles, squared, Q16.16). */
const DANGER_CLOSE_SQ = 262144;
/** Weapons at or above this collateral_risk count as heavy ordnance (0.5). */
const HEAVY_COLLATERAL = 32768;
/** Below this collateral_risk a stray does not damage structures (0.3):
 *  rifle fire does not level clinics; shells and bombs do. */
const STRUCTURAL_COLLATERAL = 19661;
/** One structure deduction per zone per this many ticks (10 s): damage to a
 *  protected site is assessed per incident, not per round. */
const ZONE_DEDUCT_COOLDOWN = 200;

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
  private readonly civIds: number[] = [];
  private readonly civFled = new Set<number>();
  private readonly zoneDeductedAt = new Map<string, number>();
  private roeScoreValue = 100;
  private roeFailed = false;
  private logisticsValue = 0;
  private intelValue = 0;
  private readonly buildQueue: { unit: string; startTick: number; readyTick: number }[] = [];
  private readonly identified = new Set<number>();
  private readonly kills = new Map<number, number>();
  private readonly rosterPool: LedgerRosterEntry[];
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
    this.rosterPool = [...(ctx.ledger?.['roster.surviving_units'] ?? [])];
    this.logisticsValue = mission.resources?.logistics_start ?? 0;
    this.intelValue = mission.resources?.intel_start ?? 0;
  }

  /** Spendable logistics, floored for display. */
  get logistics(): number {
    return this.logisticsValue - (this.logisticsValue % 1);
  }

  get intel(): number {
    return this.intelValue - (this.intelValue % 1);
  }

  /** Field production: spend logistics/intel, deploy at player_start after
   *  the build time. Returns false when unaffordable or unknown. */
  requestBuild(unitId: string): boolean {
    if (this.ended) return false;
    const info = this.ctx.unitInfo?.(unitId);
    if (!info) return false;
    if (this.logisticsValue < info.logistics || this.intelValue < (info.intel ?? 0)) return false;
    if (!this.mission.map.player_start) return false;
    this.logisticsValue -= info.logistics;
    this.intelValue -= info.intel ?? 0;
    this.buildQueue.push({
      unit: unitId,
      startTick: this.sim.tickCount,
      readyTick: this.sim.tickCount + info.buildTimeS * TICKS_PER_SECOND,
    });
    return true;
  }

  get result(): 'ongoing' | 'victory' | 'defeat' {
    return this.resultValue;
  }

  /** Live ROE score 0-100 — must be visible in the HUD at all times. */
  get roeScore(): number {
    return this.roeScoreValue;
  }

  /** In-flight production for the HUD, in whole ticks — the presentation
   *  layer turns these into a bar and a countdown (no floats in the sim). */
  get production(): { unit: string; doneTicks: number; totalTicks: number; ticksLeft: number }[] {
    const tick = this.sim.tickCount;
    return this.buildQueue.map((b) => {
      const totalTicks = b.readyTick - b.startTick;
      const rawDone = tick - b.startTick;
      const doneTicks = rawDone < 0 ? 0 : rawDone > totalTicks ? totalTicks : rawDone;
      const rawLeft = b.readyTick - tick;
      return { unit: b.unit, doneTicks, totalTicks, ticksLeft: rawLeft < 0 ? 0 : rawLeft };
    });
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
    for (const p of this.mission.civilians?.groups ?? []) this.spawnPlacement(p, 2);
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

    // Digest sim events: contacts feed locate + first_contact; kills feed
    // veterancy progression.
    for (const e of simEvents) {
      if (e.kind === 'fire') this.firstContact = true;
      if (e.kind === 'contact' && e.level === 'identified') {
        this.firstContact = true;
        if (e.side === 0 && this.sim.state.side[e.target] === 1) this.identified.add(e.target);
      }
      if (e.kind === 'destroyed' && e.by >= 0) {
        this.kills.set(e.by, (this.kills.get(e.by) ?? 0) + 1);
      }
    }

    // Income: logistics arrive by rate; interdiction (supply_corridor) is a
    // later slice. Fractional accrual is exact-enough JS arithmetic.
    const rate = this.mission.resources?.logistics_rate_per_min ?? 0;
    if (rate > 0) this.logisticsValue += rate / 1200;
    for (let i = this.buildQueue.length - 1; i >= 0; i--) {
      const b = this.buildQueue[i];
      if (tick < b.readyTick) continue;
      this.buildQueue.splice(i, 1);
      this.spawnPlacement({ unit: b.unit, count: 1 }, 0);
      out.push({ kind: 'built', tick, unit: b.unit });
    }

    this.stepRoe(simEvents, tick, out);
    this.stepCivilians();
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

    // Ledger draw (GDD §6): survivors come back with their veterancy. A
    // sparse roster fields fewer units; a gutted one fields a single fresh
    // remnant — harder mission, never a broken one. A campaign that has not
    // produced a roster yet (key absent) is a fresh start, not a degraded one.
    const hasRoster = this.ctx.ledger?.['roster.surviving_units'] !== undefined;
    let veterancies: number[];
    if (side === 0 && p.from_ledger === true && hasRoster) {
      veterancies = [];
      for (let k = 0; k < p.count; k++) {
        const idx = this.rosterPool.findIndex((r) => r.type === p.unit);
        if (idx < 0) break;
        veterancies.push(this.rosterPool[idx].veterancy);
        this.rosterPool.splice(idx, 1);
      }
      if (veterancies.length === 0) veterancies = [0];
    } else {
      veterancies = new Array(p.count).fill(0);
    }

    const ids: number[] = [];
    for (let k = 0; k < veterancies.length; k++) {
      const ox = (k % 3) * SPREAD;
      const oy = ((k - (k % 3)) / 3) * SPREAD;
      const id = this.sim.spawn(typeIdx, side, fx.add(bx, ox), fx.add(by, oy), facing, veterancies[k]);
      ids.push(id);
      (side === 0 ? this.playerIds : side === 1 ? this.enemyIds : this.civIds).push(id);
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

  /** ROE scoring (GDD §6): civilian casualties, fire into flagged zones, and
   *  heavy ordnance danger-close to civilians all deduct. Only player-caused
   *  harm counts — the score is a judgement of the player's restraint. */
  private stepRoe(simEvents: SimEvent[], tick: number, out: MissionEvent[]): void {
    const roe = this.mission.roe;
    if (roe?.enabled === false) return;
    const st = this.sim.state;
    const deduct = (penalty: number, reason: string): void => {
      this.roeScoreValue = this.roeScoreValue - penalty;
      if (this.roeScoreValue < 0) this.roeScoreValue = 0;
      out.push({ kind: 'roe', tick, penalty, reason, score: this.roeScoreValue });
      const floor = roe?.fail_below;
      if (floor !== undefined && this.roeScoreValue < floor) this.roeFailed = true;
    };

    for (const e of simEvents) {
      if (e.kind === 'destroyed' && this.civIds.includes(e.entity)) {
        if (e.by >= 0 && st.side[e.by] === 0) {
          deduct(roe?.civilian_casualty_penalty ?? 8, 'civilian casualties');
        }
      } else if (e.kind === 'nearMiss' && st.side[e.shooter] === 0) {
        // Only ordnance damages structures — rifle strays do not level clinics.
        const type = this.sim.unitTypes[st.typeIdx[e.shooter]];
        const weapon = type.weapons.find((w) => w.id === e.weaponId);
        if (weapon === undefined || weapon.collateralRisk < STRUCTURAL_COLLATERAL) continue;
        const tx = e.x >> 16;
        const ty = e.y >> 16;
        for (const zoneName of roe?.flagged_zones ?? []) {
          const z = this.zone(zoneName);
          if (z && tx >= z[0] && tx < z[0] + z[2] && ty >= z[1] && ty < z[1] + z[3]) {
            const last = this.zoneDeductedAt.get(zoneName);
            if (last === undefined || tick - last >= ZONE_DEDUCT_COOLDOWN) {
              this.zoneDeductedAt.set(zoneName, tick);
              deduct(roe?.flagged_structure_penalty ?? 5, `fire into protected structure (${zoneName})`);
            }
            break;
          }
        }
      } else if (e.kind === 'fire' && st.side[e.shooter] === 0) {
        const type = this.sim.unitTypes[st.typeIdx[e.shooter]];
        const weapon = type.weapons.find((w) => w.id === e.weaponId);
        if (weapon !== undefined && weapon.collateralRisk >= HEAVY_COLLATERAL) {
          const tx = st.posX[e.target];
          const ty = st.posY[e.target];
          for (const civ of this.civIds) {
            if (st.alive[civ] === 0) continue;
            const dx = (fx.sub(st.posX[civ], tx) >> 8) | 0;
            const dy = (fx.sub(st.posY[civ], ty) >> 8) | 0;
            if (dx * dx + dy * dy <= DANGER_CLOSE_SQ) {
              deduct(
                roe?.disproportionate_ordnance_penalty ?? 3,
                'heavy ordnance danger-close to civilians'
              );
              break;
            }
          }
        }
      }
    }
  }

  /** Civilians shelter in place until fire lands close, then break for the
   *  refuge — once, in fear, not as a controlled unit. */
  private stepCivilians(): void {
    const refuge = this.mission.civilians?.refuge;
    if (refuge === undefined) return;
    for (const civ of this.civIds) {
      if (this.sim.state.alive[civ] === 0 || this.civFled.has(civ)) continue;
      if (this.sim.state.suppression[civ] <= CIV_FLEE_AT) continue;
      this.civFled.add(civ);
      const [rx, ry] = this.markerPos(refuge);
      this.sim.queueCommand({ kind: 'move', ids: [civ], x: rx, y: ry });
    }
  }

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
    // An ROE collapse loses the mission even with objectives in hand.
    const lost = wiped || this.roeFailed;
    if (!lost && !won) return;

    this.ended = true;
    this.resultValue = lost ? 'defeat' : 'victory';
    const roeRating = this.roeScoreValue;

    // Produce the carry-over, filtered to the declared contract. Units that
    // killed something come back a level more veteran (cap 3).
    const survivors: string[] = [];
    const roster: LedgerRosterEntry[] = [];
    for (const id of this.playerIds) {
      if (this.sim.state.alive[id] !== 1) continue;
      const typeId = this.sim.unitTypes[this.sim.state.typeIdx[id]].id;
      survivors.push(typeId);
      let vet = this.sim.state.veterancy[id];
      if ((this.kills.get(id) ?? 0) > 0 && vet < 3) vet++;
      roster.push({ type: typeId, veterancy: vet });
    }
    const prev = this.ctx.ledger?.['roe.cumulative_rating'];
    const cumulative = typeof prev === 'number' ? ((prev + roeRating) / 2) | 0 : roeRating;

    const produced: LedgerData = {};
    for (const key of this.mission.ledger.produces) {
      if (key === 'roster.surviving_units') produced[key] = roster;
      else if (key === 'roe.cumulative_rating') produced[key] = cumulative;
      // Unknown keys: declared for the future, produced by nothing yet.
    }

    out.push({
      kind: 'missionEnd',
      tick,
      result: this.resultValue,
      roeRating,
      survivors,
      ledger: produced,
    });
  }
}
