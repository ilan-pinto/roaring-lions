// Minimal PixiJS renderer for the M0 sandbox. Placeholder coloured shapes on
// a 2:1 dimetric grid. Reads sim state and subscribes to events; never writes
// back (invariant 4). The renderer interpolates 20 Hz sim states to the
// display rate — it never advances the simulation itself (invariant 1).

import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
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
  private readonly spriteLayer = new Container();
  private sim: Sim;
  private opts: RendererOptions;

  private prevX: Float64Array;
  private prevY: Float64Array;
  private curX: Float64Array;
  private curY: Float64Array;

  /** unit type id → 16 facing textures (indexed 0–15). */
  private spriteAtlas = new Map<string, Texture[]>();
  /** Per-entity Sprite child in spriteLayer; created on demand. */
  private entitySprites: (Sprite | null)[] = [];

  private frameN = 0;
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
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ background: this.opts.background, resizeTo: host, antialias: true });
    host.appendChild(this.app.canvas);
    this.world.addChild(this.terrainG);
    this.world.addChild(this.fxG);
    this.world.addChild(this.spriteLayer);
    this.world.addChild(this.unitsG);
    this.app.stage.addChild(this.world);
    this.drawTerrain();
    this.snapshot();
    this.snapshot(); // prev == cur on the first frame
  }

  /**
   * Load 16-facing sprites for a unit type. Call after init().
   * `basePath` must end with `/` and point to the directory containing
   * f00_000.png … f15_000.png (the render rig output).
   */
  async loadSprites(unitTypeId: string, basePath: string): Promise<void> {
    const textures: Texture[] = [];
    for (let f = 0; f < 16; f++) {
      const url = `${basePath}f${f.toString().padStart(2, '0')}_000.png`;
      const tex = await Assets.load<Texture>(url);
      textures.push(tex);
    }
    this.spriteAtlas.set(unitTypeId, textures);
    console.log(`[lions] sprites loaded for "${unitTypeId}": ${textures.length} textures, first=`, textures[0]?.width, 'x', textures[0]?.height);
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
        const facingRad = fx.toNumber(this.sim.state.facing[e.shooter]) * Math.PI * 2;
        const type = this.sim.unitTypes[this.sim.state.typeIdx[e.shooter]];
        const barrelLen = type.isSoft ? 0.4 : 0.8;
        const mzX = this.curX[e.shooter] + Math.cos(facingRad) * barrelLen;
        const mzY = this.curY[e.shooter] + Math.sin(facingRad) * barrelLen;
        const mzR = type.isSoft ? 5 : 9;
        this.puffs.push({ x: mzX, y: mzY, ttl: 7, color: this.opts.flashColor, r: mzR });
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
          // Building block: two shaded wall faces + a roof, so it reads as volume.
          g.poly([cx - TILE_W / 2, cy, cx, cy + TILE_H / 2, cx, cy + TILE_H / 2 - H, cx - TILE_W / 2, cy - H])
            .fill({ color: '#1E1F1A', alpha: 0.9 });
          g.poly([cx + TILE_W / 2, cy, cx, cy + TILE_H / 2, cx, cy + TILE_H / 2 - H, cx + TILE_W / 2, cy - H])
            .fill({ color: '#3A3C33', alpha: 0.9 });
          g.poly(diamond.map((v, i) => (i % 2 ? v - H : v))).fill({ color: this.opts.terrainBlocked, alpha: 1 });
          // Roof clutter: a water tank or vent, hash-placed.
          if (rnd > 0.4) {
            g.circle(cx + (rnd - 0.5) * 18, cy - H + (rnd - 0.5) * 8, 3).fill({ color: '#8E9491', alpha: 0.8 });
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

    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] === 0) continue;
      const x = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
      const y = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
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
      const facingIdx = Math.round(facingNorm * 16) % 16;
      const textures = this.spriteAtlas.get(type.id);

      if (textures) {
        // Sprite-based rendering.
        while (this.entitySprites.length <= i) this.entitySprites.push(null);
        let spr = this.entitySprites[i];
        if (!spr) {
          spr = new Sprite({ texture: textures[0], anchor: 0.5 });
          this.spriteLayer.addChild(spr);
          this.entitySprites[i] = spr;
        }
        spr.texture = textures[facingIdx];
        spr.position.set(sx, sy);
        spr.alpha = bodyAlpha;
        spr.visible = true;
        const spriteScale = (type.isSoft ? 1.0 : 1.8) * TILE_W / textures[0].width;
        spr.scale.set(spriteScale);
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
