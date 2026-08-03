// Battle audio — procedural WebAudio synthesis driven by sim events. No
// asset files, presentation-only (invariant 4: nothing here touches the sim).
// Deliberately lo-fi: cracks, thuds and booms so a fight has weight.

import { WEAPON_CLASS, type Sim, type SimEvent } from '@lions/sim';

const MAX_VOICES_PER_TICK = 6;

export class BattleAudio {
  private ctx: AudioContext | null = null;
  private muted = false;

  /** Browsers require a user gesture before audio starts. */
  attach(): void {
    window.addEventListener('pointerdown', () => {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    });
  }

  toggle(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  onEvents(events: SimEvent[], sim: Sim): void {
    if (this.muted || this.ctx === null || this.ctx.state !== 'running') return;
    let voices = 0;
    for (const e of events) {
      if (voices >= MAX_VOICES_PER_TICK) break;
      if (e.kind === 'fire') {
        const type = sim.unitTypes[sim.state.typeIdx[e.shooter]];
        const w = type.weapons.find((x) => x.id === e.weaponId);
        const cls = w?.cls ?? WEAPON_CLASS.small_arms;
        voices++;
        if (cls === WEAPON_CLASS.small_arms || cls === WEAPON_CLASS.hmg) {
          this.noise(0.05, 2400, 0.025);
        } else if (cls === WEAPON_CLASS.autocannon) {
          this.tone(220, 0.08, 'square', 0.03);
        } else if (cls === WEAPON_CLASS.atgm || cls === WEAPON_CLASS.rpg) {
          this.noise(0.35, 700, 0.03);
        } else if (cls === WEAPON_CLASS.mortar) {
          this.tone(130, 0.12, 'sine', 0.04);
        } else {
          this.tone(90, 0.22, 'triangle', 0.06); // tank gun
          this.noise(0.15, 400, 0.04);
        }
      } else if (e.kind === 'impact' && e.penetrated) {
        voices++;
        this.tone(1500, 0.06, 'square', 0.03);
        this.tone(500, 0.1, 'sawtooth', 0.03);
      } else if (e.kind === 'nearMiss') {
        voices++;
        this.noise(0.09, 300, 0.015);
      } else if (e.kind === 'aps' && e.intercepted) {
        voices++;
        this.sweep(2200, 300, 0.09, 0.035);
      } else if (e.kind === 'destroyed') {
        voices++;
        this.tone(55, 0.7, 'triangle', 0.09);
        this.noise(0.5, 180, 0.06);
      }
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  private sweep(from: number, to: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(from, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + dur);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  private noise(dur: number, cutoff: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start();
  }
}
