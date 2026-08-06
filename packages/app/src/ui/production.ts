// Field production and fire support: the bottom-left cluster.
//
// Reinforcements deploy at player_start after their build time, paid from
// mission logistics. Fire support is bought with intel; arming a purchase puts
// the cursor into targeting mode and the next click on the map spends it.

import { TICKS_PER_SECOND } from '@lions/sim';
import { panel, type Panel } from './panel';
import type { Tone } from './hud';

export type SupportKind = 'sweep' | 'strike';

export interface BuildableUnit {
  id: string;
  name: string;
  logistics: number;
}

/** What production needs from the mission runtime, named so this module does
 *  not depend on MissionRuntime's whole surface. */
export interface ProductionRuntime {
  readonly intel: number;
  readonly sweepCost: number;
  readonly strikeCost: number;
  readonly production: { unit: string; ticksLeft: number; doneTicks: number; totalTicks: number }[];
  buildBlockedReason(unitId: string): string | null;
  requestBuild(unitId: string): boolean;
}

export interface ProductionOptions {
  units: BuildableUnit[];
  runtime: ProductionRuntime;
  note(html: string, tone?: Tone): void;
  /** Arming is owned by the input layer — it decides what the next click means. */
  onArm(kind: SupportKind | null): void;
}

export class ProductionBar {
  private readonly panel: Panel;
  private readonly queueEl: HTMLDivElement;
  private readonly buildBtns: { el: HTMLButtonElement; unit: BuildableUnit }[] = [];
  private readonly supportBtns: { el: HTMLButtonElement; kind: SupportKind; cost: number }[] = [];
  private armed: SupportKind | null = null;
  private readonly nameOf: Map<string, string>;

  constructor(
    host: HTMLElement,
    private readonly opts: ProductionOptions
  ) {
    this.nameOf = new Map(opts.units.map((u) => [u.id, u.name]));
    this.panel = panel({
      rank: 'inspect',
      title: 'Field production',
      place: 'left:var(--s2);bottom:var(--s2);width:var(--rail-left)',
    });

    const label = (text: string): HTMLElement => {
      const el = document.createElement('div');
      el.className = 'rl-label';
      el.textContent = text;
      return el;
    };

    this.queueEl = document.createElement('div');
    this.queueEl.className = 'rl-queue';

    const support = document.createElement('div');
    support.className = 'rl-btnrow';
    for (const spec of [
      { kind: 'sweep' as const, label: 'Satellite sweep', cost: opts.runtime.sweepCost },
      { kind: 'strike' as const, label: 'Precision strike', cost: opts.runtime.strikeCost },
    ]) {
      const b = document.createElement('button');
      b.className = 'rl-btn rl-btn--support';
      b.textContent = `${spec.label} (${spec.cost} intel)`;
      b.addEventListener('click', () => {
        if (opts.runtime.intel < spec.cost) {
          opts.note(`not enough intel for ${spec.label.toLowerCase()} — watch longer`, 'mute');
          return;
        }
        this.setArmed(this.armed === spec.kind ? null : spec.kind);
        opts.note(
          this.armed
            ? `<b>${spec.label} armed</b> — click the map to place it`
            : 'support call cancelled',
          'info'
        );
        b.blur();
      });
      this.supportBtns.push({ el: b, kind: spec.kind, cost: spec.cost });
      support.appendChild(b);
    }
    const bar = document.createElement('div');
    bar.className = 'rl-btnrow';
    for (const u of opts.units) {
      const btn = document.createElement('button');
      btn.className = 'rl-btn';
      btn.addEventListener('click', () => {
        const why = opts.runtime.buildBlockedReason(u.id);
        if (why !== null) {
          opts.note(`<b>${u.name}</b> is locked — ${why}`, 'warn');
          return;
        }
        if (opts.runtime.requestBuild(u.id)) {
          opts.note(`<b>building</b> ${u.name} — deploys at the start line`, 'info');
        } else {
          opts.note(`cannot build ${u.name} — insufficient logistics`, 'mute');
        }
        btn.blur();
      });
      this.buildBtns.push({ el: btn, unit: u });
      bar.appendChild(btn);
    }

    this.panel.body.append(
      this.queueEl,
      label('Fire support'),
      support,
      label('Reinforcements'),
      bar
    );
    host.appendChild(this.panel.el);
    this.refresh();
  }

  /** Cleared by the input layer once an armed purchase has been spent. */
  setArmed(kind: SupportKind | null): void {
    this.armed = kind;
    for (const { el, kind: k } of this.supportBtns) {
      el.dataset.armed = this.armed === k ? '1' : '0';
    }
    this.opts.onArm(kind);
  }

  refresh(): void {
    const rt = this.opts.runtime;
    for (const { el, unit } of this.buildBtns) {
      const locked = rt.buildBlockedReason(unit.id);
      el.textContent = locked ? `🔒 ${unit.name}` : `${unit.name} (${unit.logistics})`;
      el.title = locked ?? `${unit.logistics} logistics`;
      el.dataset.locked = locked ? '1' : '0';
    }
    for (const { el, cost } of this.supportBtns) {
      el.dataset.locked = rt.intel >= cost ? '0' : '1';
    }

    this.queueEl.replaceChildren();
    for (const item of rt.production) {
      const row = document.createElement('div');
      row.className = 'rl-queue__row';
      const secs = Math.ceil(item.ticksLeft / TICKS_PER_SECOND);
      const label = document.createElement('div');
      label.textContent = `${this.nameOf.get(item.unit) ?? item.unit} — ${secs}s`;
      const track = document.createElement('div');
      track.className = 'rl-track';
      const fill = document.createElement('i');
      const pct = item.totalTicks > 0 ? (item.doneTicks / item.totalTicks) * 100 : 100;
      fill.style.width = `${pct.toFixed(1)}%`;
      track.appendChild(fill);
      row.append(label, track);
      this.queueEl.appendChild(row);
    }
  }
}
