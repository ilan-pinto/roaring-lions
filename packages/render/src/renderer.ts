// Minimal PixiJS renderer for the M0 sandbox. Placeholder coloured shapes on
// a 2:1 dimetric grid. Reads sim state and subscribes to events; never writes
// back (invariant 4). The renderer interpolates 20 Hz sim states to the
// display rate — it never advances the simulation itself (invariant 1).

import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { fx, type Sim, type SimEvent } from '@lions/sim';

export interface RendererOptions {
  background: string;
  /** Team marker colours by side index (0 player, 1 hostile, 2 neutral). */
  teamColors: [string, string, string];
  /** Vehicle hull colours by side index. */
  hullColors: [string, string, string];
  /** Infantry/soft-unit colours by side index — a lighter tone of the same
   *  faction ramp, so foot troops read apart from armour at gameplay zoom. */
  infantryColors: [string, string, string];
  terrainOpen: string;
  terrainCover: [string, string, string];
  terrainBlocked: string;
  tracerColors: [string, string];
  flashColor: string;
  nearMissColor: string;
  interceptColor: string;
  /** Resolve a palette key from structure data (e.g. "limestone.4") to hex. */
  resolveColor?: (paletteKey: string) => string;
}

export const TILE_W = 64;
export const TILE_H = 32;

interface Tracer {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  ttl: number;
  side: number;
}

interface Puff {
  x: number;
  y: number;
  ttl: number;
  color: string;
  r: number;
}

/** World (tile) coords → dimetric screen coords. */
export function isoX(x: number, y: number): number {
  return ((x - y) * TILE_W) / 2;
}
export function isoY(x: number, y: number): number {
  return ((x + y) * TILE_H) / 2;
}

export class PixiRenderer {
  readonly app = new Application();
  readonly camera = { x: 24, y: 24, zoom: 1 };
  selection: number[] = [];
  /** Control-group number per entity (0 = ungrouped), owned by the app. */
  readonly unitGroup: Uint8Array;
  private readonly groupLabels: Text[] = [];

  private readonly world = new Container();
  private readonly terrainG = new Graphics();
  private readonly fogG = new Graphics();
  private readonly unitsG = new Graphics();
  /** Per-tile visibility: 0 unseen, 1 explored, 2 in sight. */
  private fog!: Uint8Array;
  private fogDirty = true;
  private fogTick = 0;
  private readonly fxG = new Graphics();
  private readonly spriteLayer = new Container();
  private sim: Sim;
  private opts: RendererOptions;

  private prevX: Float64Array;
  private prevY: Float64Array;
  private curX: Float64Array;
  private curY: Float64Array;

  /** unit type id → facing textures, optionally with walk-cycle frames and turret. */
  private spriteAtlas = new Map<
    string,
    {
      textures: Texture[][];
      frames: number;
      turretTextures?: Texture[][];
      /** Sprite index that faces world +x. The render rig's start rotation
       *  decides this; it is a property of the sheet, not of the game. */
      facingOffset: number;
      /** True when the rig rotated the object the other way round. */
      facingReverse: boolean;
    }
  >();

  /** Facing (turns) → sprite index for a given sheet's convention. */
  private static spriteIndex(
    facingNorm: number,
    atlas: { facingOffset: number; facingReverse: boolean }
  ): number {
    const k = Math.round(facingNorm * 16) % 16;
    const dir = atlas.facingReverse ? -k : k;
    return ((dir + atlas.facingOffset) % 16 + 16) % 16;
  }
  /** Per-entity Sprite child in spriteLayer; created on demand. */
  private entitySprites: (Sprite | null)[] = [];
  /** Per-entity turret Sprite, layered above the hull sprite. */
  private turretSprites: (Sprite | null)[] = [];
  /** Per-entity fractional walk-cycle counter (advances while moving). */
  private entityAnimFrame: Float64Array;
  /** Per-entity turret facing (renderer-only, 0–1 normalized). */
  private turretFacing: Float64Array;

  /** Structure under the cursor, -1 when none. Set by the app. */
  hoverStructure = -1;
  /** True when the current selection could garrison the hovered building. */
  hoverCanGarrison = false;

  private frameN = 0;
  private terrainDirty = false;
  private tracers: Tracer[] = [];
  private puffs: Puff[] = [];
  private wrecks: { x: number; y: number }[] = [];
  private orderMarkers: { x: number; y: number; ttl: number }[] = [];

  /** Drop a fading move/attack order crosshair at a world point. */
  addOrderMarker(x: number, y: number): void {
    this.orderMarkers.push({ x, y, ttl: 80 });
  }

  constructor(sim: Sim, opts: RendererOptions) {
    this.sim = sim;
    this.opts = opts;
    const n = sim.capacity;
    this.prevX = new Float64Array(n);
    this.prevY = new Float64Array(n);
    this.curX = new Float64Array(n);
    this.curY = new Float64Array(n);
    this.unitGroup = new Uint8Array(n);
    this.entityAnimFrame = new Float64Array(n);
    this.turretFacing = new Float64Array(n);
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ background: this.opts.background, resizeTo: host, antialias: true });
    host.appendChild(this.app.canvas);
    this.world.addChild(this.terrainG);
    this.world.addChild(this.fxG);
    this.world.addChild(this.spriteLayer);
    this.world.addChild(this.unitsG);
    // Fog sits above terrain and units, so unobserved ground and anything
    // standing on it are hidden together.
    this.world.addChild(this.fogG);
    this.app.stage.addChild(this.world);
    this.fog = new Uint8Array(this.sim.width * this.sim.height);
    this.drawTerrain();
    this.updateFog();
    this.drawFog();
    this.snapshot();
    this.snapshot(); // prev == cur on the first frame
  }

  /**
   * Load sprites for a unit type. `frames` is the total number of frames per
   * facing (1 = static, >1 = frame 0 is idle + remaining are walk cycle).
   * `turretPath` loads a separate turret sprite sheet for independent rotation.
   */
  async loadSprites(
    unitTypeId: string,
    basePath: string,
    opts: { frames?: number; turretPath?: string; facingOffset?: number; facingReverse?: boolean } = {}
  ): Promise<void> {
    const frames = opts.frames ?? 1;
    const turretPath = opts.turretPath;
    const textures: Texture[][] = [];
    for (let f = 0; f < 16; f++) {
      const row: Texture[] = [];
      for (let n = 0; n < frames; n++) {
        const url = `${basePath}f${f.toString().padStart(2, '0')}_${n.toString().padStart(3, '0')}.png`;
        const tex = await Assets.load<Texture>(url);
        row.push(tex);
      }
      textures.push(row);
    }
    let turretTextures: Texture[][] | undefined;
    if (turretPath) {
      turretTextures = [];
      for (let f = 0; f < 16; f++) {
        const url = `${turretPath}f${f.toString().padStart(2, '0')}_000.png`;
        turretTextures.push([await Assets.load<Texture>(url)]);
      }
    }
    this.spriteAtlas.set(unitTypeId, {
      textures,
      frames,
      turretTextures,
      facingOffset: opts.facingOffset ?? 0,
      facingReverse: opts.facingReverse ?? false,
    });
  }

  /** Copy positions after every sim tick; frame() lerps between the copies. */
  snapshot(): void {
    // Fog only needs to keep up with movement, not the tick rate.
    if (this.fog && this.fogTick++ % 4 === 0) this.updateFog();
    this.prevX.set(this.curX);
    this.prevY.set(this.curY);
    const st = this.sim.state;
    for (let i = 0; i < this.sim.entityCount; i++) {
      this.curX[i] = fx.toNumber(st.posX[i]);
      this.curY[i] = fx.toNumber(st.posY[i]);
      // Seed turret facing to hull facing on first snapshot.
      if (this.turretFacing[i] === 0 && this.frameN === 0) {
        this.turretFacing[i] = fx.toNumber(st.facing[i]);
      }
    }
  }

  /** Feed each tick's events for transient visuals. */
  onEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.kind === 'fire') {
        // Shots at buildings carry target -1: aim the tracer at the building.
        const atStruct = e.target < 0 && e.structure !== undefined;
        const tx = atStruct ? fx.toNumber(this.sim.structures.cx[e.structure as number]) : this.curX[e.target];
        const ty = atStruct ? fx.toNumber(this.sim.structures.cy[e.structure as number]) : this.curY[e.target];
        this.tracers.push({
          sx: this.curX[e.shooter],
          sy: this.curY[e.shooter],
          tx,
          ty,
          ttl: 9,
          side: this.sim.state.side[e.shooter],
        });
        const type = this.sim.unitTypes[this.sim.state.typeIdx[e.shooter]];
        const usesTurret = !type.isSoft && this.turretFacing.length > e.shooter;
        const facingRad = usesTurret
          ? this.turretFacing[e.shooter] * Math.PI * 2
          : fx.toNumber(this.sim.state.facing[e.shooter]) * Math.PI * 2;
        const barrelLen = type.isSoft ? 0.4 : 0.8;
        const mzX = this.curX[e.shooter] + Math.cos(facingRad) * barrelLen;
        const mzY = this.curY[e.shooter] + Math.sin(facingRad) * barrelLen;
        if (type.isSoft) {
          this.puffs.push({ x: mzX, y: mzY, ttl: 7, color: this.opts.flashColor, r: 5 });
        } else {
          this.puffs.push({ x: mzX, y: mzY, ttl: 4, color: this.opts.flashColor, r: 14 });
          this.puffs.push({ x: mzX, y: mzY, ttl: 8, color: this.opts.flashColor, r: 10 });
          this.puffs.push({ x: mzX, y: mzY, ttl: 18, color: '#6B6355', r: 7 });
        }
      } else if (e.kind === 'nearMiss') {
        this.puffs.push({ x: fx.toNumber(e.x), y: fx.toNumber(e.y), ttl: 14, color: this.opts.nearMissColor, r: 7 });
      } else if (e.kind === 'aps' && e.intercepted) {
        this.puffs.push({ x: this.curX[e.target], y: this.curY[e.target], ttl: 12, color: this.opts.interceptColor, r: 10 });
      } else if (e.kind === 'impact' && e.penetrated) {
        this.puffs.push({ x: this.curX[e.target], y: this.curY[e.target], ttl: 10, color: this.opts.flashColor, r: 8 });
      } else if (e.kind === 'structureHit') {
        this.terrainDirty = true;
        const s = e.structure;
        this.puffs.push({
          x: fx.toNumber(this.sim.structures.cx[s]),
          y: fx.toNumber(this.sim.structures.cy[s]),
          ttl: 12,
          color: this.opts.nearMissColor,
          r: 9,
        });
      } else if (e.kind === 'structureDestroyed') {
        this.terrainDirty = true;
        const s = e.structure;
        const bx = fx.toNumber(this.sim.structures.cx[s]);
        const by = fx.toNumber(this.sim.structures.cy[s]);
        // A collapse throws a lot of dust.
        for (let k = 0; k < 14; k++) {
          const a = PixiRenderer.h2(k * 7 + s, k * 13 + s);
          const b = PixiRenderer.h2(k * 31 + s, k * 3 + s);
          this.puffs.push({
            x: bx + (a - 0.5) * 3,
            y: by + (b - 0.5) * 3,
            ttl: 26 + Math.floor(a * 16),
            color: this.opts.nearMissColor,
            r: 10 + a * 10,
          });
        }
      } else if (e.kind === 'destroyed') {
        this.wrecks.push({ x: this.curX[e.entity], y: this.curY[e.entity] });
      }
    }
  }

  screenToWorld(px: number, py: number): { x: number; y: number } {
    const cx = this.app.renderer.width / 2;
    const cy = this.app.renderer.height / 2;
    const z = this.camera.zoom;
    const sx = (px - cx) / z + isoX(this.camera.x, this.camera.y);
    const sy = (py - cy) / z + isoY(this.camera.x, this.camera.y);
    return { x: sx / TILE_W + sy / TILE_H, y: sy / TILE_H - sx / TILE_W };
  }

  /** Living units whose screen position falls inside a screen-space rect. */
  unitsInScreenRect(x0: number, y0: number, x1: number, y1: number): number[] {
    const cx = this.app.renderer.width / 2;
    const cy = this.app.renderer.height / 2;
    const z = this.camera.zoom;
    const ox = cx - isoX(this.camera.x, this.camera.y) * z;
    const oy = cy - isoY(this.camera.x, this.camera.y) * z;
    const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
    const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
    const out: number[] = [];
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (this.sim.state.alive[i] === 0) continue;
      const sx = isoX(this.curX[i], this.curY[i]) * z + ox;
      const sy = isoY(this.curX[i], this.curY[i]) * z + oy;
      if (sx >= lo.x && sx <= hi.x && sy >= lo.y && sy <= hi.y) out.push(i);
    }
    return out;
  }

  /** Nearest living unit within `radiusTiles` of a world point, or -1. */
  pickUnit(wx: number, wy: number, radiusTiles = 1.2): number {
    let best = -1;
    let bestD = radiusTiles * radiusTiles;
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (this.sim.state.alive[i] === 0) continue;
      const dx = this.curX[i] - wx;
      const dy = this.curY[i] - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Fog of war (presentation only — the sim always knows everything; this is
   * what the *player* is allowed to see). Per tile: 0 never seen, 1 explored
   * but not currently observed, 2 in sight right now.
   */
  private updateFog(): void {
    const w = this.sim.width;
    const h = this.sim.height;
    const st = this.sim.state;
    const fog = this.fog;
    // Anything currently visible decays to "explored" before we re-reveal.
    for (let t = 0; t < fog.length; t++) if (fog[t] === 2) fog[t] = 1;

    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] === 0 || st.side[i] !== 0) continue;
      const type = this.sim.unitTypes[st.typeIdx[i]];
      const sight = fx.toNumber(type.sight);
      const ux = st.posX[i] / 65536;
      const uy = st.posY[i] / 65536;
      const tx = ux | 0;
      const ty = uy | 0;
      const r = Math.ceil(sight);
      for (let y = ty - r; y <= ty + r; y++) {
        if (y < 0 || y >= h) continue;
        for (let x = tx - r; x <= tx + r; x++) {
          if (x < 0 || x >= w) continue;
          const t = y * w + x;
          if (fog[t] === 2) continue;
          const dx = x + 0.5 - ux;
          const dy = y + 0.5 - uy;
          if (dx * dx + dy * dy > sight * sight) continue;
          if (this.hasSight(tx, ty, x, y)) fog[t] = 2;
        }
      }
    }
    this.fogDirty = true;
  }

  /** Bresenham LOS over the blocked grid — walls cast shadows. The wall tile
   *  itself is visible (you can see the building you're standing next to). */
  private hasSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const w = this.sim.width;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (;;) {
      if (x === x1 && y === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if (x === x1 && y === y1) return true;
      if (this.sim.blocked[y * w + x] !== 0) return false;
    }
  }

  /** Dark overlay for everything not currently in sight. */
  private drawFog(): void {
    const g = this.fogG;
    g.clear();
    const w = this.sim.width;
    const h = this.sim.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = this.fog[y * w + x];
        if (v === 2) continue;
        const cx = isoX(x + 0.5, y + 0.5);
        const cy = isoY(x + 0.5, y + 0.5);
        g.poly([
          cx, cy - TILE_H / 2 - 1,
          cx + TILE_W / 2 + 1, cy,
          cx, cy + TILE_H / 2 + 1,
          cx - TILE_W / 2 - 1, cy,
        ]).fill({ color: '#0A0A08', alpha: v === 0 ? 1 : 0.55 });
      }
    }
    this.fogDirty = false;
  }

  /** True when the player can currently see this world position. */
  isVisible(wx: number, wy: number): boolean {
    const x = wx | 0;
    const y = wy | 0;
    if (x < 0 || y < 0 || x >= this.sim.width || y >= this.sim.height) return false;
    return this.fog[y * this.sim.width + x] === 2;
  }

  /** Deterministic per-tile hash for ground variation — same look every run. */
  private static h2(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  private drawTerrain(): void {
    const g = this.terrainG;
    g.clear();
    const w = this.sim.width;
    const h = this.sim.height;
    const H = 18; // building height in px
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = y * w + x;
        const blocked = this.sim.blocked[t] !== 0;
        const cover = this.sim.cover[t];
        const cx = isoX(x + 0.5, y + 0.5);
        const cy = isoY(x + 0.5, y + 0.5);
        const rnd = PixiRenderer.h2(x, y);
        const diamond = [cx, cy - TILE_H / 2, cx + TILE_W / 2, cy, cx, cy + TILE_H / 2, cx - TILE_W / 2, cy];

        if (blocked) {
          // Buildings draw from their own type: taller blocks read as taller
          // shapes, and a battered building visibly darkens as it takes hits.
          const sIdx = this.sim.structureAt(x, y);
          let roof = this.opts.terrainBlocked;
          let bh = H;
          let integrity = 1;
          if (sIdx >= 0) {
            const stype = this.sim.structureTypes[this.sim.structures.typeIdx[sIdx]];
            bh = stype.heightPx;
            roof = this.opts.resolveColor ? this.opts.resolveColor(stype.color) : roof;
            const max = this.sim.structures.maxHp[sIdx];
            if (max > 0) integrity = Math.max(0, this.sim.structures.hp[sIdx] / max);
          }
          const wear = 0.45 + 0.55 * integrity; // battered walls go dark
          g.poly([cx - TILE_W / 2, cy, cx, cy + TILE_H / 2, cx, cy + TILE_H / 2 - bh, cx - TILE_W / 2, cy - bh])
            .fill({ color: '#1E1F1A', alpha: 0.9 });
          g.poly([cx + TILE_W / 2, cy, cx, cy + TILE_H / 2, cx, cy + TILE_H / 2 - bh, cx + TILE_W / 2, cy - bh])
            .fill({ color: '#3A3C33', alpha: 0.9 * wear });
          g.poly(diamond.map((v, i) => (i % 2 ? v - bh : v))).fill({ color: roof, alpha: wear });
          // Roof clutter: a water tank or vent, hash-placed. Shaken off as
          // the building is chewed up.
          if (rnd > 0.4 && integrity > 0.6) {
            g.circle(cx + (rnd - 0.5) * 18, cy - bh + (rnd - 0.5) * 8, 3).fill({ color: '#8E9491', alpha: 0.8 });
          }
          continue;
        }

        // Open ground: base wash with per-tile tonal variation.
        g.poly(diamond).fill({ color: this.opts.terrainOpen, alpha: 0.92 + rnd * 0.08 });
        if (rnd > 0.82 && cover === 0) {
          // Sparse pebbles/scrub so the ground has grain.
          g.circle(cx + (rnd - 0.9) * 40, cy + (rnd - 0.86) * 20, 1.6).fill({ color: '#8F9464', alpha: 0.5 });
        }
        if (cover > 0) {
          // Cover reads as scattered rubble/sandbags, denser with level.
          const c = this.opts.terrainCover[Math.min(cover, 3) - 1];
          for (let k = 0; k < cover + 2; k++) {
            const a = PixiRenderer.h2(x * 7 + k, y * 13 + k);
            const b = PixiRenderer.h2(x * 31 + k, y * 3 + k);
            const px = cx + (a - 0.5) * (TILE_W - 18);
            const py = cy + (b - 0.5) * (TILE_H - 8);
            g.rect(px, py, 4 + a * 4, 2.5).fill({ color: c, alpha: 0.9 });
          }
        }
      }
    }
  }

  frame(alpha: number): void {
    this.frameN++;
    const cx = this.app.renderer.width / 2;
    const cy = this.app.renderer.height / 2;
    this.world.scale.set(this.camera.zoom);
    this.world.position.set(
      cx - isoX(this.camera.x, this.camera.y) * this.camera.zoom,
      cy - isoY(this.camera.x, this.camera.y) * this.camera.zoom
    );

    const st = this.sim.state;
    const g = this.unitsG;
    g.clear();

    // Wrecks under everything.
    for (const wk of this.wrecks) {
      const sx = isoX(wk.x, wk.y);
      const sy = isoY(wk.x, wk.y);
      g.moveTo(sx - 7, sy - 5).lineTo(sx + 7, sy + 5).stroke({ width: 3, color: '#5C625F' });
      g.moveTo(sx - 7, sy + 5).lineTo(sx + 7, sy - 5).stroke({ width: 3, color: '#5C625F' });
    }

    // Hide all entity sprites first; visible ones get shown below.
    for (const spr of this.entitySprites) {
      if (spr) spr.visible = false;
    }
    for (const spr of this.turretSprites) {
      if (spr) spr.visible = false;
    }

    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] === 0) continue;
      const x = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
      const y = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
      // Anyone who isn't ours is only drawn while actually observed — fog
      // hides them, and losing sight loses the contact.
      if (st.side[i] !== 0 && !this.isVisible(x, y)) continue;
      const sx = isoX(x, y);
      const sy = isoY(x, y);
      const side = st.side[i];
      const type = this.sim.unitTypes[st.typeIdx[i]];
      const r = type.isSoft ? 7 : 11;

      let bodyAlpha = 1;
      if (side !== 0) {
        const lvl = this.sim.contactLevel(0, i);
        bodyAlpha = lvl === 2 ? 1 : lvl === 1 ? 0.65 : 0.35;
      }

      const facingNorm = fx.toNumber(st.facing[i]);
      const atlas = this.spriteAtlas.get(type.id);

      if (atlas) {
        const facings = atlas.textures;
        // Walk cycle: frames 1–(N-1) loop while moving; frame 0 is idle.
        let frame = 0;
        if (st.moving[i] === 1 && atlas.frames > 1) {
          this.entityAnimFrame[i] += 0.12;
          const walkFrames = atlas.frames - 1;
          frame = 1 + (Math.floor(this.entityAnimFrame[i]) % walkFrames);
        } else {
          this.entityAnimFrame[i] = 0;
        }
        // Sprite-based rendering.
        while (this.entitySprites.length <= i) this.entitySprites.push(null);
        let spr = this.entitySprites[i];
        if (!spr) {
          spr = new Sprite({ texture: facings[0][0], anchor: 0.5 });
          this.spriteLayer.addChild(spr);
          this.entitySprites[i] = spr;
        }
        const hullIdx = PixiRenderer.spriteIndex(facingNorm, atlas);
        spr.texture = facings[hullIdx][frame] ?? facings[hullIdx][0];
        spr.position.set(sx, sy);
        spr.alpha = bodyAlpha;
        spr.visible = true;
        const spriteScale = ((type.isSoft ? 1.0 : 1.8) * TILE_W) / facings[0][0].width;
        spr.scale.set(spriteScale);

        // Turret: independent rotation sprite composited above the hull.
        if (atlas.turretTextures) {
          const target = st.curTarget[i];
          const struct = st.curStructure[i];
          const aimAtStructure = target < 0 && struct >= 0 && this.sim.structures.alive[struct] === 1;
          if ((target >= 0 && st.alive[target] !== 0) || aimAtStructure) {
            const ax = aimAtStructure ? fx.toNumber(this.sim.structures.cx[struct]) : this.curX[target];
            const ay = aimAtStructure ? fx.toNumber(this.sim.structures.cy[struct]) : this.curY[target];
            const dx = ax - this.curX[i];
            const dy = ay - this.curY[i];
            const goal = ((Math.atan2(dy, dx) / (Math.PI * 2)) % 1 + 1) % 1;
            let delta = goal - this.turretFacing[i];
            if (delta > 0.5) delta -= 1;
            if (delta < -0.5) delta += 1;
            this.turretFacing[i] += delta * 0.15;
          } else {
            let delta = facingNorm - this.turretFacing[i];
            if (delta > 0.5) delta -= 1;
            if (delta < -0.5) delta += 1;
            this.turretFacing[i] += delta * 0.08;
          }
          this.turretFacing[i] = ((this.turretFacing[i] % 1) + 1) % 1;

          const tIdx = PixiRenderer.spriteIndex(this.turretFacing[i], atlas);
          while (this.turretSprites.length <= i) this.turretSprites.push(null);
          let tspr = this.turretSprites[i];
          if (!tspr) {
            tspr = new Sprite({ texture: atlas.turretTextures[0][0], anchor: 0.5 });
            this.spriteLayer.addChild(tspr);
            this.turretSprites[i] = tspr;
          }
          tspr.texture = atlas.turretTextures[tIdx][0];
          tspr.position.set(sx, sy);
          tspr.alpha = bodyAlpha;
          tspr.visible = true;
          tspr.scale.set(spriteScale);
        }
      } else {
        // Procedural fallback.
        g.ellipse(sx, sy + 3, r + 3, (r + 3) / 2).fill({ color: '#0A0A08', alpha: 0.35 * bodyAlpha });
        const fc = facingNorm * Math.PI * 2;
        const cos = Math.cos(fc);
        const sin = Math.sin(fc);
        if (type.role === 'drone') {
          const spin = this.frameN * 0.3;
          const ah = 8;
          for (const o of [0, Math.PI / 2] as const) {
            g.moveTo(sx + Math.cos(spin + o) * 8, sy - ah + Math.sin(spin + o) * 4)
              .lineTo(sx - Math.cos(spin + o) * 8, sy - ah - Math.sin(spin + o) * 4)
              .stroke({ width: 2, color: this.opts.hullColors[side], alpha: bodyAlpha });
          }
          g.circle(sx, sy - ah, 3.5).fill({ color: this.opts.hullColors[side], alpha: bodyAlpha });
          g.circle(sx, sy - ah, 3.5).stroke({ width: 1.5, color: this.opts.teamColors[side], alpha: bodyAlpha });
        } else if (type.isSoft) {
          // Infantry wear the lighter faction tone so foot troops never read
          // as armour at a glance.
          g.circle(sx, sy, r).fill({ color: this.opts.infantryColors[side], alpha: bodyAlpha });
          g.circle(sx, sy, r).stroke({ width: 2, color: this.opts.teamColors[side], alpha: bodyAlpha });
          const hx = x + cos * 0.4;
          const hy = y + sin * 0.4;
          g.moveTo(sx, sy).lineTo(isoX(hx, hy), isoY(hx, hy)).stroke({ width: 2.5, color: '#F2E8D5', alpha: bodyAlpha });
        } else {
          const HL = 0.55;
          const HW = 0.32;
          const pts: number[] = [];
          for (const [a, b] of [[HL, HW], [HL, -HW], [-HL, -HW], [-HL, HW]] as const) {
            const wx = x + a * cos - b * sin;
            const wy = y + a * sin + b * cos;
            pts.push(isoX(wx, wy), isoY(wx, wy));
          }
          g.poly(pts).fill({ color: this.opts.hullColors[side], alpha: bodyAlpha });
          g.poly(pts).stroke({ width: 1.5, color: this.opts.teamColors[side], alpha: bodyAlpha });
          const bx = x + cos * 0.8;
          const by = y + sin * 0.8;
          g.moveTo(sx, sy - 2).lineTo(isoX(bx, by), isoY(bx, by) - 2).stroke({ width: 2.5, color: '#2E2F28', alpha: bodyAlpha });
          g.circle(sx, sy - 2, 4.5).fill({ color: this.opts.hullColors[side], alpha: bodyAlpha });
          g.circle(sx, sy - 2, 4.5).stroke({ width: 1.5, color: '#2E2F28', alpha: 0.8 * bodyAlpha });
        }
      }

      // HP bar.
      const hpRatio = Math.max(0, fx.toNumber(st.hp[i]) / fx.toNumber(type.hp));
      g.rect(sx - 12, sy - r - 10, 24, 3).fill({ color: '#14150F', alpha: 0.8 });
      g.rect(sx - 12, sy - r - 10, 24 * hpRatio, 3).fill(hpRatio > 0.5 ? '#6B8A4A' : hpRatio > 0.25 ? '#E8C33A' : '#D93A2B');

      // Suppression bar (orange) — the mechanic that matters most, so it is
      // always on screen.
      const supp = Math.min(1, fx.toNumber(st.suppression[i]));
      if (supp > 0.02) {
        g.rect(sx - 12, sy - r - 6, 24 * supp, 3).fill('#FFB43C');
      }
      // Pinned/broken must be readable at a glance across the whole field:
      // a pulsing ring in the suppression colour, not just a small glyph.
      if (st.pinned[i] === 1 || st.routed[i] === 1) {
        const pulse = 0.45 + 0.35 * Math.sin(this.frameN * 0.25);
        g.ellipse(sx, sy + 2, r + 10, (r + 10) / 2).stroke({
          width: 2.5,
          color: st.routed[i] === 1 ? '#D93A2B' : '#FFB43C',
          alpha: pulse,
        });
      }
      if (st.routed[i] === 1) {
        // Broken: a white flag, running for cover.
        g.moveTo(sx + 6, sy - r - 18).lineTo(sx + 6, sy - r - 8).stroke({ width: 1.5, color: '#F2E8D5' });
        g.poly([sx + 6, sy - r - 18, sx + 13, sy - r - 15, sx + 6, sy - r - 12]).fill('#F2E8D5');
      } else if (st.pinned[i] === 1) {
        g.poly([sx - 5, sy - r - 16, sx + 5, sy - r - 16, sx, sy - r - 11]).fill('#FFB43C');
      }
      // Kill-state dots: mobility (gray) and firepower (dark red).
      if (st.mobilityKilled[i] === 1) g.circle(sx - r, sy + r - 2, 3).fill('#8E9491');
      if (st.firepowerKilled[i] === 1) g.circle(sx + r, sy + r - 2, 3).fill('#8B1E12');

      if (this.selection.includes(i)) {
        g.ellipse(sx, sy + 2, r + 7, (r + 7) / 2).stroke({ width: 2, color: '#B8FF5A' });
      }

      // Control-group badge, so the org chart is visible on the field.
      const grp = this.unitGroup[i];
      if (grp > 0) {
        let label = this.groupLabels[i];
        if (!label) {
          label = new Text({
            text: '',
            style: { fill: '#14150F', fontFamily: 'monospace', fontSize: 11, fontWeight: 'bold' },
          });
          label.anchor.set(0.5);
          this.spriteLayer.addChild(label);
          this.groupLabels[i] = label;
        }
        g.circle(sx - r - 4, sy - r - 4, 7).fill({ color: '#B8FF5A', alpha: 0.95 });
        label.text = String(grp);
        label.position.set(sx - r - 4, sy - r - 4);
        label.visible = true;
      } else if (this.groupLabels[i]) {
        this.groupLabels[i].visible = false;
      }
    }
    // Badges for units that went out of view this frame.
    for (let i = 0; i < this.groupLabels.length; i++) {
      const lb = this.groupLabels[i];
      if (lb && (st.alive[i] === 0 || this.unitGroup[i] === 0)) lb.visible = false;
    }

    if (this.terrainDirty) {
      this.terrainDirty = false;
      this.drawTerrain();
      this.fogDirty = true;
    }

    // Building status: an integrity bar once a building has been hit, and a
    // pip per man inside — you should be able to see that a house is held
    // and how close it is to coming down.
    const str = this.sim.structures;
    for (let s = 0; s < this.sim.structureCount; s++) {
      if (str.alive[s] === 0) continue;
      const bx = isoX(fx.toNumber(str.cx[s]), fx.toNumber(str.cy[s]));
      const by = isoY(fx.toNumber(str.cx[s]), fx.toNumber(str.cy[s]));
      const stype = this.sim.structureTypes[str.typeIdx[s]];
      const top = by - stype.heightPx - 12;
      const ratio = str.maxHp[s] > 0 ? str.hp[s] / str.maxHp[s] : 1;
      if (ratio < 0.999) {
        g.rect(bx - 16, top, 32, 4).fill({ color: '#14150F', alpha: 0.85 });
        g.rect(bx - 16, top, 32 * Math.max(0, ratio), 4).fill(
          ratio > 0.6 ? '#8E9491' : ratio > 0.3 ? '#E8C33A' : '#D93A2B'
        );
      }
      const occ = str.occupants[s];
      if (occ > 0) {
        // Held building: a house badge in the holder's colour, with one pip
        // per man inside, so "who is in there and how many" reads at a glance.
        let side = 1;
        for (let i = 0; i < this.sim.entityCount; i++) {
          if (st.alive[i] === 1 && st.garrisonedIn[i] === s) {
            side = st.side[i];
            break;
          }
        }
        const col = this.opts.teamColors[side];
        const by2 = top - 16;
        g.poly([bx - 7, by2, bx, by2 - 6, bx + 7, by2]).fill({ color: col }); // roof
        g.rect(bx - 5, by2, 10, 8).fill({ color: col }); // walls
        g.rect(bx - 1.5, by2 + 3, 3, 5).fill({ color: '#14150F' }); // doorway
        for (let k = 0; k < occ; k++) {
          g.circle(bx - (occ - 1) * 3 + k * 6, by2 + 12, 2).fill({ color: col });
        }
      }

      // Hover affordance: an arrow walking into a doorway, shown when the
      // selection could actually move in. It answers "can I garrison this?"
      // before the click rather than after.
      if (s === this.hoverStructure && this.hoverCanGarrison) {
        const pulse = 0.55 + 0.45 * Math.sin(this.frameN * 0.12);
        const hy = top - 34;
        g.rect(bx + 2, hy - 9, 11, 18).stroke({ width: 2, color: '#B8FF5A', alpha: pulse });
        g.rect(bx + 2, hy - 9, 3, 18).fill({ color: '#B8FF5A', alpha: pulse }); // door jamb
        g.moveTo(bx - 14, hy).lineTo(bx - 2, hy).stroke({ width: 2.5, color: '#B8FF5A', alpha: pulse });
        g.poly([bx - 2, hy - 5, bx + 4, hy, bx - 2, hy + 5]).fill({ color: '#B8FF5A', alpha: pulse });
      }
    }

    // Demolition charges being set: a ring that closes as the timer runs.
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] === 0) continue;
      const prog = this.sim.demolitionProgress(i);
      if (prog <= 0) continue;
      const px = isoX(this.curX[i], this.curY[i]);
      const py = isoY(this.curX[i], this.curY[i]);
      g.ellipse(px, py, 20, 10).stroke({ width: 2, color: '#5C625F', alpha: 0.5 });
      g.ellipse(px, py, 20 * prog, 10 * prog).stroke({ width: 3, color: '#E8541E', alpha: 0.9 });
    }

    // Weapon envelopes for the selection (GDD §5.8): solid ring at effective
    // range where accuracy holds up, faint ring at maximum reach, and an
    // inner ring for weapons with a minimum range (mortars can't shoot close).
    // A world circle maps to an axis-aligned ellipse in 2:1 dimetric.
    const ISO_K = Math.SQRT1_2;
    for (const i of this.selection) {
      if (st.alive[i] === 0) continue;
      const type = this.sim.unitTypes[st.typeIdx[i]];
      if (type.weapons.length === 0) continue;
      const ux = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
      const uy = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
      const ex = isoX(ux, uy);
      const ey = isoY(ux, uy);
      const ring = (tiles: number, color: string, width: number, a: number): void => {
        if (tiles <= 0) return;
        g.ellipse(ex, ey, tiles * TILE_W * ISO_K, tiles * TILE_H * ISO_K).stroke({
          width,
          color,
          alpha: a,
        });
      };
      const w0 = type.weapons[0];
      ring(fx.toNumber(w0.range), this.opts.teamColors[st.side[i]], 1, 0.28);
      ring(fx.toNumber(w0.effectiveRange), this.opts.teamColors[st.side[i]], 1.5, 0.5);
      ring(Math.sqrt(fx.toNumber(w0.minRangeSq)), '#D93A2B', 1, 0.35);
    }

    // Engagement reticles: brackets on whatever the selected units are
    // shooting at, with a faint line so the duel is readable at a glance.
    for (const i of this.selection) {
      if (st.alive[i] === 0 || st.side[i] !== 0) continue;
      const t = st.curTarget[i];
      if (t < 0 || st.alive[t] === 0) continue;
      const tx = this.prevX[t] + (this.curX[t] - this.prevX[t]) * alpha;
      const ty = this.prevY[t] + (this.curY[t] - this.prevY[t]) * alpha;
      const rx = isoX(tx, ty);
      const ry = isoY(tx, ty);
      const R = 15;
      const c = this.opts.teamColors[1];
      for (const [mx, my] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        g.moveTo(rx + mx * R, ry + my * (R / 2) - my * 4)
          .lineTo(rx + mx * R, ry + my * (R / 2))
          .lineTo(rx + mx * R - mx * 7, ry + my * (R / 2))
          .stroke({ width: 2, color: c });
      }
      const sx0 = isoX(this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha, this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha);
      const sy0 = isoY(this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha, this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha);
      g.moveTo(sx0, sy0).lineTo(rx, ry).stroke({ width: 1, color: c, alpha: 0.35 });
    }

    // Order crosshairs fade out where the last command pointed.
    this.orderMarkers = this.orderMarkers.filter((m) => --m.ttl > 0);
    for (const m of this.orderMarkers) {
      const mx = isoX(m.x, m.y);
      const my = isoY(m.x, m.y);
      const a = m.ttl / 80;
      const s = 10 + (1 - a) * 6;
      g.moveTo(mx - s, my).lineTo(mx - 4, my).stroke({ width: 2, color: '#B8FF5A', alpha: a });
      g.moveTo(mx + 4, my).lineTo(mx + s, my).stroke({ width: 2, color: '#B8FF5A', alpha: a });
      g.moveTo(mx, my - s / 2).lineTo(mx, my - 2).stroke({ width: 2, color: '#B8FF5A', alpha: a });
      g.moveTo(mx, my + 2).lineTo(mx, my + s / 2).stroke({ width: 2, color: '#B8FF5A', alpha: a });
      g.ellipse(mx, my, s + 4, (s + 4) / 2).stroke({ width: 1.5, color: '#B8FF5A', alpha: a * 0.6 });
    }

    if (this.fogDirty) this.drawFog();

    // Transient FX.
    const fg = this.fxG;
    fg.clear();
    this.tracers = this.tracers.filter((t) => --t.ttl > 0);
    for (const t of this.tracers) {
      fg.moveTo(isoX(t.sx, t.sy), isoY(t.sx, t.sy) - 4)
        .lineTo(isoX(t.tx, t.ty), isoY(t.tx, t.ty) - 4)
        .stroke({ width: 1.5, color: this.opts.tracerColors[t.side], alpha: t.ttl / 9 });
    }
    this.puffs = this.puffs.filter((p) => --p.ttl > 0);
    for (const p of this.puffs) {
      fg.circle(isoX(p.x, p.y), isoY(p.x, p.y) - 3, p.r * (1.4 - p.ttl / 14)).fill({
        color: p.color,
        alpha: (p.ttl / 14) * 0.8,
      });
    }
  }
}
