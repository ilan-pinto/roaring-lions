import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@lions/sim';
import type { VoiceResult } from '@lions/render';
import type { PlayerIntent } from '../input/intents';
import type { DirectorLook, VoiceCue } from './director';
import type { VoiceClass } from './lines';
import { VOICE_LOG_SIZE, VoiceRuntime, voicePlaceholderOn, type VoiceRuntimeDeps } from './voice-runtime';

const LANGS = { kdf: 'he', ashwar: 'ar', sarim: 'ar', rif: 'ar' };
const UNITS: Record<number, { faction: string; voice: VoiceClass } | undefined> = {
  1: { faction: 'kdf', voice: 'infantry' },
  3: { faction: 'kdf', voice: 'crew' },
  5: { faction: 'kdf', voice: 'engineer' },
};
const look: DirectorLook = {
  unitOf: (id) => UNITS[id] ?? null,
  side: () => 0,
  pos: () => ({ x: 0, y: 0 }),
  isVisible: () => true,
  camera: () => ({ x: 0, y: 0 }),
};
const order = (...ids: number[]): PlayerIntent => ({ kind: 'order', verb: 'attackMove', ids, x: 1, y: 1, append: false });
const MISSING: VoiceResult = { status: 'missing', seconds: 0, en: null, cut: 0 };

function rig(over: Partial<VoiceRuntimeDeps> = {}) {
  const queued: (() => void)[] = [];
  const played: VoiceCue[] = [];
  const infos: string[] = [];
  const captions: [string, number][] = [];
  let now = 0;
  let result: VoiceResult = MISSING;
  const rt = new VoiceRuntime({
    now: () => now,
    schedule: (fn) => void queued.push(fn),
    look,
    languages: LANGS,
    play: (c) => {
      played.push(c);
      return result;
    },
    caption: (t, s) => void captions.push([t, s]),
    info: (m) => void infos.push(m),
    ...over,
  });
  const flush = (): void => {
    for (let fn = queued.shift(); fn; fn = queued.shift()) fn();
  };
  return {
    rt, flush, played, infos, captions, queued,
    setNow: (n: number): void => { now = n; },
    setResult: (r: VoiceResult): void => { result = r; },
  };
}

describe('VoiceRuntime (WP-AU1 §7, R-3)', () => {
  it('coalesces one gesture’s intents into one cue, on one scheduled flush', () => {
    const r = rig();
    r.rt.hint({ hostile: true });
    r.rt.observe({ kind: 'demolish', ids: [5], structure: 9 });
    r.rt.observe({ kind: 'garrison', ids: [1], structure: 9 });
    r.rt.observe(order(3));
    expect(r.queued).toHaveLength(1);
    expect(r.played).toEqual([]);
    r.flush();
    expect(r.played.map((c) => c.key)).toEqual(['he.engineer.task']);
  });

  it('a hint belongs to its own gesture and no other', () => {
    const r = rig();
    r.rt.hint({ hostile: true });
    r.rt.observe(order(1));
    r.flush();
    r.setNow(10_000);
    r.rt.observe(order(3));
    r.flush();
    expect(r.played.map((c) => c.key)).toEqual(['he.infantry.attack', 'he.crew.move']);
  });

  it('a selection plays nothing and logs nothing', () => {
    const r = rig();
    r.rt.observe({ kind: 'select', ids: [1], via: 'click' });
    r.flush();
    expect(r.played).toEqual([]);
    expect(r.rt.log()).toEqual([]);
  });

  it('a missing line is noted ONCE, as information, and never called an error (R-9)', () => {
    const r = rig();
    r.rt.observe(order(1));
    r.flush();
    r.setNow(10_000);
    r.rt.observe(order(3, 1)); // a tie: the first selected, crew, speaks
    r.flush();
    r.setNow(20_000);
    r.rt.observe(order(1));
    r.flush();
    expect(r.infos).toHaveLength(2); // he.infantry.move once, he.crew.move once
    expect(r.infos[0]).toContain('he.infantry.move');
    for (const m of r.infos) expect(m).not.toMatch(/error|fail|warn/i);
    expect(r.rt.log().map((e) => e.status)).toEqual(['missing', 'missing', 'missing']);
  });

  it('a noted set shared by two runtimes notes a key once per document, not once per battlefield', () => {
    const noted = new Set<string>();
    const first = rig({ noted });
    first.rt.observe(order(1));
    first.flush();
    first.rt.dispose(); // the player leaves; a second battlefield boots
    const second = rig({ noted });
    second.rt.observe(order(1));
    second.flush();
    expect(first.infos).toHaveLength(1);
    expect(second.infos).toEqual([]);
    expect(second.rt.log().map((e) => e.status)).toEqual(['missing']);
  });

  it('captions a played line with its meaning and length, and nothing else (D8)', () => {
    const r = rig();
    r.setResult({ status: 'played', seconds: 1.2, en: 'moving', cut: 0 });
    r.rt.observe(order(1));
    r.flush();
    r.setResult({ status: 'placeholder', seconds: 0.12, en: null, cut: 0 });
    r.setNow(10_000);
    r.rt.observe(order(3));
    r.flush();
    expect(r.captions).toEqual([['moving', 1.2]]);
  });

  it('logs every voiced decision, silent ones included, for __lions.voiceLog()', () => {
    const r = rig();
    for (const ms of [0, 1000, 2000]) {
      r.setNow(ms);
      r.rt.observe(order(1));
      r.flush();
    }
    expect(r.rt.log().map((e) => [e.source, e.trigger, e.key, e.why])).toEqual([
      ['order', 'move', 'he.infantry.move', 'line'],
      ['order', 'move', 'he.common.ack', 'ack:repeat'],
      ['order', 'move', null, 'silent:repeat'],
    ]);
    expect(r.rt.log()[2]?.status).toBeNull();
  });

  it('hears deaths from the tick', () => {
    const r = rig();
    const dead: SimEvent = { kind: 'destroyed', tick: 1, entity: 1, by: 9 };
    r.rt.onTick([dead]);
    expect(r.played.map((c) => c.key)).toEqual(['he.infantry.death']);
    expect(r.rt.log()[0]).toMatchObject({ source: 'death', trigger: 'death', why: 'line' });
  });

  it('keeps the last 64 entries, oldest evicted first (recency)', () => {
    const r = rig();
    const total = VOICE_LOG_SIZE + 10;
    for (let i = 0; i < total; i++) {
      r.setNow(i * 10_000);
      r.rt.observe(order(1));
      r.flush();
    }
    const log = r.rt.log();
    expect(log).toHaveLength(VOICE_LOG_SIZE);
    // The oldest 10 pushes were evicted: what remains starts at push #10...
    expect(log[0]?.at).toBe(10 * 10_000);
    // ...and ends at the very last push, #(total - 1).
    expect(log.at(-1)?.at).toBe((total - 1) * 10_000);
  });

  it('mutating a log() result does not change the ring', () => {
    const r = rig();
    r.rt.observe(order(1));
    r.flush();
    const snapshot = r.rt.log();
    expect(snapshot).toHaveLength(1);
    // Mutate the returned array and one of its entries...
    snapshot[0].key = 'tampered';
    snapshot.push({ at: 999, source: 'order', trigger: 'x', key: 'x', why: 'line', status: null });
    // ...and neither change reaches the runtime's own ring.
    const again = r.rt.log();
    expect(again).toHaveLength(1);
    expect(again[0]?.key).toBe('he.infantry.move');
  });

  it('after dispose, a gesture already in flight and a later tick both play nothing', () => {
    const r = rig();
    r.rt.observe(order(1));
    r.rt.dispose();
    r.flush();
    r.rt.onTick([{ kind: 'destroyed', tick: 1, entity: 1, by: 9 }]);
    r.rt.observe(order(3));
    r.flush();
    expect(r.played).toEqual([]);
  });
});

describe('voicePlaceholderOn (R-10)', () => {
  it('only in a dev build, and only when asked', () => {
    expect(voicePlaceholderOn(new URLSearchParams('voicetick'), true)).toBe(true);
    expect(voicePlaceholderOn(new URLSearchParams('voicetick'), false)).toBe(false);
    expect(voicePlaceholderOn(new URLSearchParams(''), true)).toBe(false);
  });
});
