import { describe, expect, it } from 'vitest';
import {
  AUTO_QUALITY,
  autoQualityArmed,
  autoQualityTarget,
  createQualitySampler,
  settingsAfterVerdict,
  type AutoQualityVerdict,
} from './quality-auto';
import { DEFAULT_SETTINGS, parseSettings, QUALITIES, type Quality, type QualitySource, type Settings } from './settings';

const RANK: Record<Quality, number> = { low: 0, medium: 1, high: 2 };
const SOURCES: QualitySource[] = ['default', 'player', 'auto'];

function withVideo(v: Partial<Settings['video']>): Settings {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.video = { ...s.video, ...v };
  return s;
}

/** Feed `n` frames of `ms` each; return the one verdict, if any. */
function feed(sampler: ReturnType<typeof createQualitySampler>, frames: [ms: number, visible: boolean][]): AutoQualityVerdict[] {
  const out: AutoQualityVerdict[] = [];
  for (const [ms, vis] of frames) {
    const v = sampler.frame(ms, vis);
    if (v) out.push(v);
  }
  return out;
}
const run = (n: number, ms: number, visible = true): [number, boolean][] => Array.from({ length: n }, () => [ms, visible]);

describe('autoQualityTarget: only ever lowers, never over the player', () => {
  it('never returns a quality above the current one, for any input', () => {
    for (const q of QUALITIES)
      for (const src of SOURCES)
        for (const share of [0, 0.01, AUTO_QUALITY.slowShare, 0.5, 1]) {
          const to = autoQualityTarget(q, src, share);
          if (to !== null) expect(RANK[to]).toBeLessThan(RANK[q]);
        }
  });

  it('steps down exactly one level when the opening is slow', () => {
    expect(autoQualityTarget('high', 'default', 0.2)).toBe('medium');
    expect(autoQualityTarget('medium', 'auto', 0.2)).toBe('low');
    expect(autoQualityTarget('low', 'auto', 1)).toBeNull();
  });

  it('leaves a fast opening alone', () => {
    expect(autoQualityTarget('high', 'default', AUTO_QUALITY.slowShare / 2)).toBeNull();
    expect(autoQualityTarget('high', 'default', 0)).toBeNull();
  });

  it('acts at the threshold itself', () => {
    expect(autoQualityTarget('high', 'default', AUTO_QUALITY.slowShare)).toBe('medium');
  });

  it("never touches the player's own choice, however slow", () => {
    for (const q of QUALITIES) expect(autoQualityTarget(q, 'player', 1)).toBeNull();
  });

  it('a NaN share decides nothing', () => {
    expect(autoQualityTarget('high', 'default', Number.NaN)).toBeNull();
  });
});

describe('autoQualityArmed', () => {
  it('watches the default and its own earlier step, not the player, and not the floor', () => {
    expect(autoQualityArmed(withVideo({ quality: 'high', qualitySource: 'default' }))).toBe(true);
    expect(autoQualityArmed(withVideo({ quality: 'medium', qualitySource: 'auto' }))).toBe(true);
    expect(autoQualityArmed(withVideo({ quality: 'high', qualitySource: 'player' }))).toBe(false);
    expect(autoQualityArmed(withVideo({ quality: 'low', qualitySource: 'auto' }))).toBe(false);
  });
});

describe('createQualitySampler', () => {
  const cfg = { skipMs: 100, sampleMs: 1000, slowFrameMs: 33.4 };

  it('judges once, at the end of the window, skipping the opening frames', () => {
    const s = createQualitySampler(cfg);
    // 10 slow frames inside the skip would read as a 100% share if counted.
    const v = feed(s, [...run(2, 50), ...run(60, 16.7), ...run(10, 16.7)]);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('judged');
    expect(v[0].slowFrames).toBe(0);
    expect(v[0].slowShare).toBe(0);
  });

  it('counts frames slower than 30 fps, and only those', () => {
    const s = createQualitySampler(cfg);
    // 33.3 is exactly two 60 Hz vsyncs -- 30 fps -- and is not slow.
    // 4 x 25 ms fill the skip; 20 x 33.3 + 6 x 50 reach 1066 ms; the third
    // 16.7 ms frame closes the window at 1116 ms: 29 judged, 6 slow.
    const v = feed(s, [...run(4, 25), ...run(20, 33.3), ...run(6, 50), ...run(5, 16.7)]);
    expect(v).toHaveLength(1);
    expect(v[0].frames).toBe(29);
    expect(v[0].slowFrames).toBe(6);
    expect(v[0].slowShare).toBeCloseTo(6 / 29, 6);
  });

  it('returns nothing after its one verdict', () => {
    const s = createQualitySampler(cfg);
    expect(feed(s, run(200, 16.7))).toHaveLength(1);
    expect(feed(s, run(200, 100))).toHaveLength(0);
  });

  it('a hidden tab anywhere in the window voids the whole sample', () => {
    const s = createQualitySampler(cfg);
    const v = feed(s, [...run(20, 16.7), [1, false], ...run(80, 16.7)]);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('void');
  });

  it('the void decides nothing even when every frame was slow', () => {
    const s = createQualitySampler(cfg);
    const v = feed(s, [...run(5, 25), [900, false], ...run(30, 100)]);
    expect(settingsAfterVerdict(withVideo({ qualityStrikes: 1 }), v[0])).toBeNull();
  });
});

describe('settingsAfterVerdict', () => {
  const slow: AutoQualityVerdict = { kind: 'judged', frames: 400, slowFrames: 100, slowShare: 0.25 };
  const fast: AutoQualityVerdict = { kind: 'judged', frames: 480, slowFrames: 2, slowShare: 2 / 480 };

  it('a first slow opening records a strike and changes no quality', () => {
    const next = settingsAfterVerdict(withVideo({ quality: 'high', qualitySource: 'default', qualityStrikes: 0 }), slow);
    expect(next?.video).toMatchObject({ quality: 'high', qualitySource: 'default', qualityStrikes: 1 });
  });

  it('a second slow opening in a row lowers one step, marks it as its own, and clears the strike', () => {
    const next = settingsAfterVerdict(withVideo({ quality: 'high', qualitySource: 'default', qualityStrikes: 1 }), slow);
    expect(next?.video).toMatchObject({ quality: 'medium', qualitySource: 'auto', qualityStrikes: 0 });
  });

  it('two slow openings take high to medium and no further; two more take medium to low', () => {
    let s = withVideo({});
    const qualities: Quality[] = [];
    for (let i = 0; i < 6; i++) {
      s = settingsAfterVerdict(s, slow) ?? s;
      qualities.push(s.video.quality);
    }
    expect(qualities).toEqual(['high', 'medium', 'medium', 'low', 'low', 'low']);
  });

  it('a fast opening clears a standing strike, and writes nothing when there is none', () => {
    const cleared = settingsAfterVerdict(withVideo({ quality: 'high', qualityStrikes: 1 }), fast);
    expect(cleared?.video).toMatchObject({ quality: 'high', qualityStrikes: 0 });
    expect(settingsAfterVerdict(withVideo({ quality: 'high', qualityStrikes: 0 }), fast)).toBeNull();
  });

  it('slow, fast, slow never lowers: the strikes must be consecutive', () => {
    let s = withVideo({});
    for (const v of [slow, fast, slow]) s = settingsAfterVerdict(s, v) ?? s;
    expect(s.video.quality).toBe('high');
  });

  it('changes nothing else in the settings', () => {
    const s = withVideo({ quality: 'high', qualitySource: 'default', qualityStrikes: 1, textSize: 1.3 });
    s.audio.music = 0.25;
    const next = settingsAfterVerdict(s, slow);
    expect({ ...next, video: { ...next?.video, quality: 'high', qualitySource: 'default', qualityStrikes: 1 } }).toEqual(s);
  });

  it("saves nothing for the player's own choice, however slow and however many strikes", () => {
    expect(settingsAfterVerdict(withVideo({ quality: 'high', qualitySource: 'player', qualityStrikes: 1 }), slow)).toBeNull();
    expect(settingsAfterVerdict(withVideo({ quality: 'high', qualitySource: 'player' }), fast)).toBeNull();
  });

  it('a void verdict saves nothing', () => {
    expect(settingsAfterVerdict(withVideo({ qualityStrikes: 1 }), { ...slow, kind: 'void' })).toBeNull();
  });

  it('round-trips through the real parser', () => {
    const next = settingsAfterVerdict(withVideo({ qualityStrikes: 1 }), slow);
    const back = parseSettings(JSON.stringify(next));
    expect(back.video).toMatchObject({ quality: 'medium', qualitySource: 'auto', qualityStrikes: 0 });
    const strike = parseSettings(JSON.stringify(settingsAfterVerdict(withVideo({}), slow)));
    expect(strike.video.qualityStrikes).toBe(1);
  });
});

describe('qualitySource parsing', () => {
  const parse = (video: Record<string, unknown>): Settings =>
    parseSettings(JSON.stringify({ ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video, ...video } }));

  it('defaults to "default"', () => {
    expect(parseSettings(null).video.qualitySource).toBe('default');
  });

  it("reads a pre-existing save's non-high quality as the player's choice", () => {
    const legacy = (q: Quality): Settings => {
      const video: Record<string, unknown> = { ...DEFAULT_SETTINGS.video, quality: q };
      delete video.qualitySource;
      delete video.qualityStrikes;
      return parseSettings(JSON.stringify({ ...DEFAULT_SETTINGS, video }));
    };
    expect(legacy('low').video.qualitySource).toBe('player');
    expect(legacy('medium').video.qualitySource).toBe('player');
    expect(legacy('high').video.qualitySource).toBe('default');
  });

  it('reads a strike count of 0 or 1 and nothing else', () => {
    expect(parse({ qualityStrikes: 1 }).video.qualityStrikes).toBe(1);
    expect(parse({ qualityStrikes: 7 }).video.qualityStrikes).toBe(0);
    expect(parse({ qualityStrikes: '1' }).video.qualityStrikes).toBe(0);
    expect(parseSettings(null).video.qualityStrikes).toBe(0);
  });

  it('keeps a valid stored source and refuses an unknown one', () => {
    expect(parse({ quality: 'medium', qualitySource: 'auto' }).video.qualitySource).toBe('auto');
    expect(parse({ quality: 'high', qualitySource: 'robot' }).video.qualitySource).toBe('default');
  });
});
