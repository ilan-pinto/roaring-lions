// Debug overlay — the primary development instrument (CLAUDE.md). Every roll
// the model makes is shown with its full factor breakdown: detection
// probabilities, hit chances, penetration curves, facing, component results,
// suppression. DOM rather than canvas: crisp text, free scrolling.
//
// This is a developer's instrument and nothing else. The mission briefing,
// objectives, ROE, unit card and player narration that used to share this file
// are now the player's HUD, in @lions/app — see packages/app/src/ui/hud.ts.
// What is left is the roll feed and the detection table: the two views you
// read while tuning the combat model, and neither of which belongs on screen
// during play. Toggled with `o`.
//
// Colours come from the --rl-* / semantic custom properties published by the
// app's palette plugin. Naming a variable costs no import, so the one-way
// dependency rule (app → render → sim) is untouched.

import { fx, type Sim, type SimEvent } from '@lions/sim';

const PANEL_CSS =
  'position:absolute;top:8px;max-height:calc(100vh - 16px);overflow-y:auto;' +
  'background:var(--panel-bg);color:var(--ink);' +
  'font:11px var(--font-mono);padding:8px 10px;border:1px solid var(--panel-frame);' +
  'line-height:1.5;';

function pct(v: number): string {
  return (fx.toNumber(v) * 100).toFixed(0) + '%';
}

function fmt(v: number, digits = 1): string {
  return fx.toNumber(v).toFixed(digits);
}

export class DebugOverlay {
  private readonly left: HTMLDivElement;
  private readonly right: HTMLDivElement;
  private readonly feed: HTMLDivElement;
  private readonly status: HTMLDivElement;
  /** Off by default: the instrument should be opened deliberately, not be the
   *  thing a player sees first. `o` toggles it. */
  private visible = false;
  /**
   * Damage summed since the last feed line, per structure, with the integrity
   * band we were in when we last spoke. A blade lands a hit every tick; one
   * line per eighth of the building is enough to follow, and forty lines in
   * two seconds is not.
   */
  private readonly grind = new Map<number, { dmg: number; band: number }>();
  private feedCount = 0;
  private tickN = 0;

  constructor(
    host: HTMLElement,
    private readonly sim: Sim,
    private readonly getSelection: () => number[],
    /** Displayed at the top of the status pane. The app owns the value; the
     *  render package must not read the app's build-time globals. */
    private readonly gameVersion = ''
  ) {
    this.left = document.createElement('div');
    this.left.style.cssText = PANEL_CSS + 'left:8px;width:300px;display:none;';
    this.right = document.createElement('div');
    this.right.style.cssText = PANEL_CSS + 'right:8px;width:380px;max-height:52vh;display:none;';
    this.status = document.createElement('div');
    this.feed = document.createElement('div');
    const feedTitle = document.createElement('div');
    feedTitle.textContent = '── roll feed (newest first) ──';
    feedTitle.style.cssText = 'color:var(--ink-dim);margin-bottom:4px;';
    this.right.appendChild(feedTitle);
    this.right.appendChild(this.feed);
    this.left.appendChild(this.status);
    host.appendChild(this.left);
    host.appendChild(this.right);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.left.style.display = this.visible ? 'block' : 'none';
    this.right.style.display = this.visible ? 'block' : 'none';
  }

  onTick(events: SimEvent[]): void {
    if (!this.visible) return;
    for (const e of events) this.pushEvent(e);
    // The status panel is a full innerHTML rebuild — at 20 Hz it stalls the
    // page exactly when combat floods events. 4 Hz reads identically.
    if (this.tickN++ % 5 === 0) this.renderSelected();
  }

  private line(html: string, color = 'var(--ink)'): void {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.style.color = color;
    this.feed.prepend(div);
    this.feedCount++;
    while (this.feedCount > 90 && this.feed.lastChild) {
      this.feed.removeChild(this.feed.lastChild);
      this.feedCount--;
    }
  }

  private name(id: number): string {
    // Shots at buildings carry target -1; anything unresolvable is labelled
    // rather than crashing the panel mid-firefight.
    if (id < 0 || id >= this.sim.entityCount) return '—';
    const t = this.sim.unitTypes[this.sim.state.typeIdx[id]];
    return t ? `#${id} ${t.id}` : `#${id} ?`;
  }

  /** Name of a structure for the feed. */
  private structName(s: number): string {
    if (s < 0 || s >= this.sim.structureCount) return 'a building';
    const t = this.sim.structureTypes[this.sim.structures.typeIdx[s]];
    return t ? `the ${t.name}` : 'a building';
  }

  private pushEvent(e: SimEvent): void {
    const t = `<span style="color:var(--ink-dim)">t${e.tick}</span> `;
    switch (e.kind) {
      case 'fire': {
        const b = e.breakdown;
        this.line(
          t +
            `${this.name(e.shooter)} → ${
              e.target < 0 && e.structure !== undefined ? this.structName(e.structure) : this.name(e.target)
            } <b>${e.weaponId}</b> ` +
            `P(hit)=${pct(e.pHit)} roll=${pct(e.roll)} ${e.willHit ? '<b>HIT</b>' : 'miss'}<br>` +
            `&nbsp;&nbsp;<span style="color:var(--ink-dim)">acc ${pct(b.accuracy)} · rng ${pct(b.rangeFalloff)} · cov ${pct(
              b.coverMod
            )} · mot ${pct(b.motionMod)} · stance ${pct(b.stanceMod)} · supp ${pct(b.suppressionMod)}</span>`,
          e.willHit ? 'var(--ink)' : 'var(--ink-mute)'
        );
        break;
      }
      case 'impact':
        this.line(
          t +
            `${this.name(e.target)} <b>${e.arc}</b> armor eff=${fmt(e.effectiveArmor, 0)}mm vs pen=${fmt(
              e.penetration,
              0
            )}mm P(pen)=${pct(e.pPen)} roll=${pct(e.roll)} ${e.penetrated ? '<b>PENETRATION</b>' : 'no pen'}`,
          e.penetrated ? 'var(--hot)' : 'var(--info)'
        );
        break;
      case 'component':
        this.line(t + `${this.name(e.target)} <b>${e.result.toUpperCase()}</b> (overmatch z=${fmt(e.overmatch, 2)})`, 'var(--hot)');
        break;
      case 'aps':
        this.line(
          t + `${this.name(e.target)} APS vs ${this.name(e.shooter)}: P=${pct(e.pIntercept)} roll=${pct(e.roll)} ${
            e.intercepted ? '<b>INTERCEPT</b>' : 'LEAKER'
          }`,
          'var(--intercept)'
        );
        break;
      case 'contact':
        this.line(t + `side${e.side} ${e.level.toUpperCase()} ${this.name(e.target)} (conf ${pct(e.confidence)})`, 'var(--live)');
        break;
      case 'pinned':
        this.line(t + `${this.name(e.entity)} <b>PINNED</b> — gone to ground`, 'var(--hot)');
        break;
      case 'routed':
        this.line(t + `${this.name(e.entity)} <b>BROKEN</b> — fleeing the kill zone`, 'var(--bad)');
        break;
      case 'rallied':
        this.line(t + `${this.name(e.entity)} rallied — awaiting orders`, 'var(--good)');
        break;
      case 'unpinned':
        this.line(t + `${this.name(e.entity)} back up`, 'var(--good)');
        break;
      case 'destroyed':
        this.line(t + `${this.name(e.entity)} <b>DESTROYED</b>${e.by >= 0 ? ' by ' + this.name(e.by) : ''}`, 'var(--bad)');
        break;
      case 'structureHit': {
        // Shellfire keeps a line per hit: this panel exists to show every
        // roll. Only a blade, which hits at tick rate, gets coalesced.
        const grinding = e.by >= 0 && this.sim.state.demoTarget[e.by] === e.structure;
        if (!grinding) {
          this.line(
            t + `${this.structName(e.structure)} takes ${fmt(e.damage, 0)} — ${fmt(e.hpLeft, 0)} left`,
            'var(--ink-mute)'
          );
          break;
        }
        const max = fx.toNumber(this.sim.structures.maxHp[e.structure]);
        const band = max > 0 ? Math.floor((fx.toNumber(e.hpLeft) / max) * 8) : 0;
        const acc = this.grind.get(e.structure) ?? { dmg: 0, band: 8 };
        acc.dmg += fx.toNumber(e.damage);
        if (band !== acc.band) {
          this.line(
            t + `${this.structName(e.structure)} ground down ${acc.dmg.toFixed(0)} — ${fmt(e.hpLeft, 0)} left`,
            'var(--ink-mute)'
          );
          acc.dmg = 0;
          acc.band = band;
        }
        this.grind.set(e.structure, acc);
        break;
      }
      case 'strike':
        this.line(t + `<b>PRECISION STRIKE</b> called by ${this.name(e.by)}`, 'var(--hot)');
        break;
      case 'smokeLaid':
        this.line(t + `${this.name(e.by)} lays a <b>smoke screen</b>`, 'var(--ink-mute)');
        break;
      case 'revealed':
        if (e.count > 0) this.line(t + `satellite sweep: ${e.count} contact(s) identified`, 'var(--info)');
        break;
      case 'structureDestroyed': {
        const acc = this.grind.get(e.structure);
        this.grind.delete(e.structure);
        // Band 0 is terminal: once a building is under an eighth the crossing
        // check never fires again, so whatever the blade took off inside that
        // last band has not been reported yet. Say it here rather than dropping
        // it — this panel exists so that no damage goes unshown.
        const tail = acc && acc.dmg > 0 ? ` — ground down a final ${acc.dmg.toFixed(0)}` : '';
        this.line(t + `${this.structName(e.structure)} <b>COLLAPSES</b>${tail}`, 'var(--hot)');
        break;
      }
      case 'garrison':
        this.line(
          t + `${this.name(e.entity)} ${e.entered ? 'moves into' : 'leaves'} ${this.structName(e.structure)}`,
          'var(--info)'
        );
        break;
      case 'nearMiss':
        break; // too chatty for the feed; rendered as puffs instead
      case 'spawn':
        this.line(t + `spawn ${this.name(e.entity)} side${e.side}`, 'var(--ink-dim)');
        break;
    }
  }

  /** Build identity, first line of the pane so it is unmissable in a report. */
  private versionHtml(): string {
    if (!this.gameVersion) return '';
    return `<div style="color:var(--ink-dim);margin-bottom:4px">V ${this.gameVersion}</div>`;
  }

  /**
   * Detection maths for the selected unit against every hostile it could
   * conceivably see: per-tick probability, signature, occlusion, and the
   * confidence its side currently holds. This is the view that tuning §5.1
   * is done against, which is why it survived the split into the player HUD —
   * a player never needs it, and a developer needs nothing else.
   */
  private renderSelected(): void {
    const sel = this.getSelection();
    if (sel.length === 0) {
      this.status.innerHTML =
        this.versionHtml() +
        '<span style="color:var(--ink-dim)">select a unit to inspect its detection maths</span>';
      return;
    }
    const st = this.sim.state;
    const id = sel[0];
    const type = this.sim.unitTypes[st.typeIdx[id]];
    const rows: string[] = [
      this.versionHtml(),
      `<b>${this.name(id)}</b> <span style="color:var(--ink-dim)">${type.role || 'unit'}</span>`,
      sel.length > 1 ? `<span style="color:var(--ink-dim)">+${sel.length - 1} more selected</span>` : '',
      '<br><b>detection vs hostiles</b> <span style="color:var(--ink-dim)">(P per tick / confidence)</span>',
    ];
    const mySide = st.side[id];
    let shown = 0;
    for (let e = 0; e < this.sim.entityCount && shown < 14; e++) {
      if (st.alive[e] === 0 || st.side[e] === mySide) continue;
      const d = this.sim.debugDetection(id, e);
      if (d === null) continue;
      const lvl = this.sim.contactLevel(mySide, e);
      const glyph = lvl === 2 ? '<b>ID</b>' : lvl === 1 ? '?' : '·';
      const conf = this.sim.contactConfidence(mySide, e);
      rows.push(
        `${glyph} ${this.name(e)} — ${
          d.visible
            ? `P=${(fx.toNumber(d.p) * 100).toFixed(1)}%/tick sig=${fmt(d.signature, 2)} occl=${fmt(d.occlusion, 2)}`
            : 'no LOS'
        } conf=${pct(conf)}`
      );
      shown++;
    }
    if (shown === 0) rows.push('<span style="color:var(--ink-dim)">no hostiles in the model</span>');
    this.status.innerHTML = rows.filter(Boolean).join('<br>');
  }
}
