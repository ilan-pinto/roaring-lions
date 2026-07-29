// Minimal PixiJS renderer for the M0 sandbox. Placeholder coloured shapes on
// a 2:1 dimetric grid. Reads sim state and subscribes to events; never writes
// back (invariant 4). The renderer interpolates 20 Hz sim states to the
// display rate — it never advances the simulation itself (invariant 1).

import { Application, Container, Graphics } from 'pixi.js';
import { fx, type Sim, type SimEvent } from '@lions/sim';

export interface RendererOptions {
  background: string;
  /** Team marker colours by side index (0 player, 1 hostile, 2 neutral). */
  teamColors: [string, string, string];
  /** Hull colours by side index. */
  hullColors: [string, string, string];
  terrainOpen: string;
  terrainCover: [string, string, string];
  terrainBlocked: string;
  tracerColors: [string, string];
  flashColor: string;
  nearMissColor: string;
  interceptColor: string;
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

  private readonly world = new Container();
  private readonly terrainG = new Graphics();
  private readonly unitsG = new Graphics();
  private readonly fxG = new Graphics();
  private sim: Sim;
  private opts: RendererOptions;

  private prevX: Float64Array;
  private prevY: Float64Array;
  private curX: Float64Array;
  private curY: Float64Array;

  private tracers: Tracer[] = [];
  private puffs: Puff[] = [];
  private wrecks: { x: number; y: number }[] = [];

  constructor(sim: Sim, opts: RendererOptions) {
    this.sim = sim;
    this.opts = opts;
    const n = sim.capacity;
    this.prevX = new Float64Array(n);
    this.prevY = new Float64Array(n);
    this.curX = new Float64Array(n);
    this.curY = new Float64Array(n);
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ background: this.opts.background, resizeTo: host, antialias: true });
    host.appendChild(this.app.canvas);
    this.world.addChild(this.terrainG);
    this.world.addChild(this.fxG);
    this.world.addChild(this.unitsG);
    this.app.stage.addChild(this.world);
    this.drawTerrain();
    this.snapshot();
    this.snapshot(); // prev == cur on the first frame
  }

  /** Copy positions after every sim tick; frame() lerps between the copies. */
  snapshot(): void {
    this.prevX.set(this.curX);
    this.prevY.set(this.curY);
    const st = this.sim.state;
    for (let i = 0; i < this.sim.entityCount; i++) {
      this.curX[i] = fx.toNumber(st.posX[i]);
      this.curY[i] = fx.toNumber(st.posY[i]);
    }
  }

  /** Feed each tick's events for transient visuals. */
  onEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.kind === 'fire') {
        this.tracers.push({
          sx: this.curX[e.shooter],
          sy: this.curY[e.shooter],
          tx: this.curX[e.target],
          ty: this.curY[e.target],
          ttl: 9,
          side: this.sim.state.side[e.shooter],
        });
        this.puffs.push({ x: this.curX[e.shooter], y: this.curY[e.shooter], ttl: 5, color: this.opts.flashColor, r: 5 });
      } else if (e.kind === 'nearMiss') {
        this.puffs.push({ x: fx.toNumber(e.x), y: fx.toNumber(e.y), ttl: 14, color: this.opts.nearMissColor, r: 7 });
      } else if (e.kind === 'aps' && e.intercepted) {
        this.puffs.push({ x: this.curX[e.target], y: this.curY[e.target], ttl: 12, color: this.opts.interceptColor, r: 10 });
      } else if (e.kind === 'impact' && e.penetrated) {
        this.puffs.push({ x: this.curX[e.target], y: this.curY[e.target], ttl: 10, color: this.opts.flashColor, r: 8 });
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

  private drawTerrain(): void {
    const g = this.terrainG;
    g.clear();
    const w = this.sim.width;
    const h = this.sim.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = y * w + x;
        const blocked = this.sim.blocked[t] !== 0;
        const cover = this.sim.cover[t];
        let color = this.opts.terrainOpen;
        if (blocked) color = this.opts.terrainBlocked;
        else if (cover > 0) color = this.opts.terrainCover[Math.min(cover, 3) - 1];
        const cx = isoX(x + 0.5, y + 0.5);
        const cy = isoY(x + 0.5, y + 0.5);
        g.poly([
          cx, cy - TILE_H / 2,
          cx + TILE_W / 2, cy,
          cx, cy + TILE_H / 2,
          cx - TILE_W / 2, cy,
        ]).fill({ color, alpha: blocked ? 1 : 0.9 });
        if (blocked) {
          // A little vertical extrusion so buildings read as volume.
          g.poly([
            cx - TILE_W / 2, cy,
            cx, cy + TILE_H / 2,
            cx, cy + TILE_H / 2 - 14,
            cx - TILE_W / 2, cy - 14,
          ]).fill({ color, alpha: 0.6 });
        }
      }
    }
  }

  frame(alpha: number): void {
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

    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] === 0) continue;
      const x = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
      const y = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
      const sx = isoX(x, y);
      const sy = isoY(x, y);
      const side = st.side[i];
      const type = this.sim.unitTypes[st.typeIdx[i]];
      const r = type.isSoft ? 7 : 11;

      // Non-player units fade in with the player's contact confidence (debug
      // view — everything stays visible, identification shows as opacity).
      // Until identified, a faded contact could be militia or civilians:
      // exactly the call ROE punishes getting wrong.
      let bodyAlpha = 1;
      if (side !== 0) {
        const lvl = this.sim.contactLevel(0, i);
        bodyAlpha = lvl === 2 ? 1 : lvl === 1 ? 0.65 : 0.35;
      }

      g.ellipse(sx, sy + 3, r + 3, (r + 3) / 2).fill({ color: '#0A0A08', alpha: 0.35 * bodyAlpha });
      g.circle(sx, sy, r).fill({ color: this.opts.hullColors[side], alpha: bodyAlpha });
      g.circle(sx, sy, r).stroke({ width: 2, color: this.opts.teamColors[side], alpha: bodyAlpha });

      // Facing tick — project the heading into iso space.
      const fc = fx.toNumber(st.facing[i]) * Math.PI * 2;
      const hx = x + Math.cos(fc) * 0.45;
      const hy = y + Math.sin(fc) * 0.45;
      g.moveTo(sx, sy).lineTo(isoX(hx, hy), isoY(hx, hy)).stroke({ width: 3, color: '#F2E8D5', alpha: bodyAlpha });

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
      if (st.pinned[i] === 1) {
        g.poly([sx - 5, sy - r - 16, sx + 5, sy - r - 16, sx, sy - r - 11]).fill('#FFB43C');
      }
      // Kill-state dots: mobility (gray) and firepower (dark red).
      if (st.mobilityKilled[i] === 1) g.circle(sx - r, sy + r - 2, 3).fill('#8E9491');
      if (st.firepowerKilled[i] === 1) g.circle(sx + r, sy + r - 2, 3).fill('#8B1E12');

      if (this.selection.includes(i)) {
        g.ellipse(sx, sy + 2, r + 7, (r + 7) / 2).stroke({ width: 2, color: '#B8FF5A' });
      }
    }

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
