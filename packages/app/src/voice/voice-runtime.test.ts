import { describe, expect, it, vi } from 'vitest';
import type { AnnouncementManifest } from '@lions/render';
import type { SimEvent } from '@lions/sim';
import type { VoiceResult } from '@lions/render';
import type { PlayerIntent } from '../input/intents';
import type { DirectorLook, VoiceCue } from './director';
import type { VoiceClass } from './lines';
import { HUSH, PINNED_CAPTION_S, VOICE_LOG_SIZE, VoiceRuntime, voicePlaceholderOn, type VoiceRuntimeDeps } from './voice-runtime';
import { CAPTION_EXTRA_MS } from '../ui/voice-caption';

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
  const always: boolean[] = [];
  const cleared: number[] = [];
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
    caption: (t, s, a) => {
      captions.push([t, s]);
      always.push(a === true);
    },
    info: (m) => void infos.push(m),
    text: (k) => k,
    clearCaption: () => void cleared.push(now),
    ...over,
  });
  const flush = (): void => {
    for (let fn = queued.shift(); fn; fn = queued.shift()) fn();
  };
  return {
    rt, flush, played, infos, captions, always, queued, cleared,
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
    // A bark follows the captions setting (polish pass F, A5): not `always`.
    expect(r.always).toEqual([false]);
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

describe('the pinned caption fallback (GH-262)', () => {
  it('captions a pinned cue from its i18n key when no take exists', () => {
    const r = rig({ look: { ...look, isPinned: () => true }, text: (k) => `T:${k}` });
    r.rt.observe(order(1));
    r.flush();
    expect(r.captions).toEqual([['T:voice.caption.pinned', PINNED_CAPTION_S]]);
  });

  it('never captions an ordinary missing line (R-9 unchanged)', () => {
    const r = rig({ text: (k) => `T:${k}` });
    r.rt.observe(order(1));
    r.flush();
    expect(r.captions).toEqual([]);
  });
});

const TABLE: AnnouncementManifest = {
  hold_s: 3,
  caption_s: 3.5,
  events: {
    objective_complete: { caption: 'a.complete', audio: '', cooldown_s: 2, priority: 'high' },
    unit_lost: { caption: 'a.lost', audio: '', cooldown_s: 6, priority: 'low' },
  },
};
const complete = { kind: 'objective', tick: 1, id: 'o1', status: 'complete' } as const;

const played = (id: number, en: string | null, cutIds: number[] = []): VoiceResult => ({
  status: 'played', seconds: 1.2, en, cut: cutIds.length, id, cutIds,
});

describe('captions in step with what is voiced (AU-5)', () => {

  it('a bark never writes over a higher line’s caption while it stands; once it has gone, it may', () => {
    const r = rig({ announcements: TABLE, announceLang: 'he' });
    r.rt.onMission([complete]);
    r.setResult(played(1, 'moving'));
    r.setNow(1_000);
    r.rt.observe(order(1));
    r.flush();
    expect(r.captions.map((c) => c[0])).toEqual(['a.complete']);
    // The announcement's caption stands 3.5 s plus the slot's own extra second.
    r.setNow(3_500 + CAPTION_EXTRA_MS);
    r.rt.observe(order(3));
    r.flush();
    expect(r.captions.map((c) => c[0])).toEqual(['a.complete', 'moving']);
  });

  it('an announcement replaces a bark’s caption at once', () => {
    const r = rig({ announcements: TABLE, announceLang: 'he' });
    r.setResult(played(1, 'moving'));
    r.rt.observe(order(1));
    r.flush();
    r.setNow(100);
    r.rt.onMission([complete]);
    expect(r.captions.map((c) => c[0])).toEqual(['moving', 'a.complete']);
  });

  it('a line cut short takes its caption with it when the line that cut it has none', () => {
    const r = rig();
    r.setResult(played(7, 'moving'));
    r.rt.observe(order(1));
    r.flush();
    r.setResult({ status: 'placeholder', seconds: 0.12, en: null, cut: 1, id: 8, cutIds: [7] });
    r.setNow(500);
    r.rt.observe(order(3));
    r.flush();
    expect(r.cleared).toEqual([500]);
  });

  it('a cut that leaves the captioned line sounding leaves its caption alone', () => {
    const r = rig();
    r.setResult(played(7, 'moving'));
    r.rt.observe(order(1));
    r.flush();
    r.setResult({ status: 'placeholder', seconds: 0.12, en: null, cut: 1, id: 9, cutIds: [5] });
    r.setNow(500);
    r.rt.observe(order(3));
    r.flush();
    expect(r.cleared).toEqual([]);
  });

  it('a dropped line shows nothing', () => {
    const r = rig();
    r.setResult({ status: 'dropped', seconds: 0, en: null, cut: 0 });
    r.rt.observe(order(1));
    r.flush();
    expect(r.captions).toEqual([]);
  });
});

describe('intentional silence (AU-5, audio plan §5.1)', () => {
  const dead = (entity: number): SimEvent => ({ kind: 'destroyed', tick: 1, entity, by: 9 });

  it('no bark for the first 2 s of a mission; an announcement still speaks', () => {
    expect(HUSH.startMs).toBe(2000);
    const r = rig({ announcements: TABLE, announceLang: 'he' });
    r.rt.hush('start');
    r.rt.observe(order(1));
    r.flush();
    r.rt.onTick([dead(3)]);
    r.rt.onMission([complete]);
    expect(r.played).toEqual([]);
    expect(r.captions.map((c) => c[0])).toEqual(['a.complete']);
    expect(r.rt.log().filter((e) => e.why === 'silent:hushed').map((e) => e.source)).toEqual(['order', 'death']);
    r.setNow(HUSH.startMs);
    r.rt.observe(order(1));
    r.flush();
    expect(r.played.map((c) => c.key)).toEqual(['he.infantry.move']);
  });

  it('nothing at or below a death call for 1.5 s after a major alert; an order still answers', () => {
    expect(HUSH.majorMs).toBe(1500);
    const r = rig();
    r.rt.hush('major');
    r.rt.onTick([dead(3)]);
    r.rt.observe(order(1));
    r.flush();
    expect(r.played.map((c) => c.key)).toEqual(['he.infantry.move']);
    r.setNow(HUSH.majorMs);
    r.rt.onTick([dead(5)]);
    expect(r.played.map((c) => c.key)).toEqual(['he.infantry.move', 'he.engineer.death']);
  });

  it('nothing at all after the outcome, and the last bark’s caption goes', () => {
    const r = rig({ announcements: TABLE, announceLang: 'he' });
    r.setResult(played(1, 'moving'));
    r.rt.observe(order(1));
    r.flush();
    r.setNow(100);
    r.rt.hush('outcome');
    expect(r.cleared).toEqual([100]);
    r.setNow(60_000);
    r.rt.observe(order(3));
    r.flush();
    r.rt.onTick([dead(5)]);
    r.rt.onMission([complete]);
    expect(r.played.map((c) => c.key)).toEqual(['he.infantry.move']);
    expect(r.captions.map((c) => c[0])).toEqual(['moving']);
  });

  it('arms no timer: every window is a clock read on the next call, so dispose has nothing to leave behind (PR 446)', () => {
    vi.useFakeTimers();
    try {
      const r = rig({ announcements: TABLE, announceLang: 'he' });
      r.rt.hush('start');
      r.rt.hush('major');
      r.rt.onMission([{ kind: 'unitLost', tick: 2, entity: 1, side: 0, unit: 'x' } as never]);
      r.rt.observe(order(1));
      r.flush();
      expect(vi.getTimerCount()).toBe(0);
      r.rt.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('voicePlaceholderOn (R-10)', () => {
  it('only in a dev build, and only when asked', () => {
    expect(voicePlaceholderOn(new URLSearchParams('voicetick'), true)).toBe(true);
    expect(voicePlaceholderOn(new URLSearchParams('voicetick'), false)).toBe(false);
    expect(voicePlaceholderOn(new URLSearchParams(''), true)).toBe(false);
  });
});
