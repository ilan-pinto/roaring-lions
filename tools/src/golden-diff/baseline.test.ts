// The part of the three-vs-three baseline gate that runs on EVERY push.
//
// The gate itself needs Playwright, a Vite dev server and a WebGL context, so
// it lives in its own workflow. Everything that decides anything, though, is
// pure -- which threshold a scenario is judged on, which metric votes, when a
// stored baseline stops applying, and what counts as the same capture
// environment -- and that is what this file pins. It is the same split
// `diff.ts` and `capture-protocol.ts` already make between measuring and
// capturing.
//
// Two of these tests exist because a real measurement said something
// counter-intuitive, and a future reader tightening the code would otherwise
// "fix" it back:
//   - a scenario can fail on `meanAbsChannelDelta` with `diffPixels` at ZERO
//     (the palette-step regression this renderer actually suffers), and
//   - `combat` must NOT vote, however tempting a fourth green tick looks.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
  BASELINES,
  capturePreconditionMismatches,
  envKey,
  evaluateBaseline,
  glFamily,
  isGated,
  specFor,
} from './baseline';
import { computeDiff, type DiffSummary } from './diff';

function summary(over: Partial<DiffSummary>): DiffSummary {
  return {
    baseline: 'a.png',
    candidate: 'b.png',
    region: null,
    width: 1400,
    height: 900,
    totalPixels: 1_260_000,
    diffPixels: 0,
    diffPixelPct: 0,
    meanAbsChannelDelta: 0,
    maxAbsChannelDelta: 0,
    thresholdUsed: 0.1,
    diffImagePath: null,
    ...over,
  };
}

describe('BASELINES', () => {
  it('covers every scenario the gate captures, since a missing entry throws', () => {
    // Mirrors golden-diff-gate.ts's own rule: a scenario with no calibrated
    // entry must not pass silently.
    expect(Object.keys(BASELINES).sort()).toEqual(['combat', 'open-ground', 'quiet', 'vehicle']);
    expect(() => specFor('no-such-scenario')).toThrow(/no BASELINES entry/);
  });

  it('gates by default and only combat opts out', () => {
    expect(isGated(BASELINES.quiet)).toBe(true);
    expect(isGated(BASELINES['open-ground'])).toBe(true);
    expect(isGated(BASELINES.vehicle)).toBe(true);
    // Not an oversight. Two captures of the SAME commit differ by 969-3847
    // pixels on this scene, and the scatter defect reads 3231 -- inside that
    // band. There is no honest threshold, so it is reported and does not vote.
    expect(isGated(BASELINES.combat)).toBe(false);
  });

  it('scopes open-ground to the measured-stable ground crop, not the whole frame', () => {
    expect(BASELINES['open-ground'].region).toEqual({ x: 950, y: 500, w: 450, h: 400 });
    expect(BASELINES.quiet.region).toBeNull();
  });
});

describe('evaluateBaseline', () => {
  it('fails on meanAbsChannelDelta alone, with diffPixels at zero', () => {
    // THE case this gate exists for. The scatter defect (671acdb), re-injected
    // into today's HEAD and captured, measured exactly this on the open-ground
    // crop: pixelmatch counted 0 differing pixels because the whole ground
    // moved by one palette step (19/255, under pixelmatch's 0.1 threshold),
    // while the mean channel delta read 0.3519 against a 0.0000 noise floor.
    // A gate written the usual way -- pixel count only -- is blind to it.
    const v = evaluateBaseline(
      summary({ diffPixels: 0, meanAbsChannelDelta: 0.3519 }),
      BASELINES['open-ground']
    );
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toMatch(/meanAbsChannelDelta 0\.3519 > 0\.05/);
    // Exactly one failure: the pixel count is inside budget and contributes
    // nothing. (The one message mentions `diffPixels` in its own explanation,
    // so count the failures rather than grepping the text.)
    expect(v.failures).toHaveLength(1);
  });

  it('passes the measured run-to-run noise on every gated scenario', () => {
    // The worst same-environment reading actually observed for each scenario,
    // over 12 captures spanning five browser processes and two checkouts of one
    // commit. If a future edit tightens a threshold under these, the gate
    // starts crying wolf -- which is how a gate earns an allowlist.
    // quiet's worse noise mode carries the SAME pixel count as the defect
    // signal below; the two are separated only by magnitude.
    expect(evaluateBaseline(summary({ diffPixels: 41, meanAbsChannelDelta: 0.0024 }), BASELINES.quiet).ok).toBe(true);
    expect(
      evaluateBaseline(summary({ diffPixels: 0, meanAbsChannelDelta: 0 }), BASELINES['open-ground']).ok
    ).toBe(true);
    expect(evaluateBaseline(summary({ diffPixels: 133, meanAbsChannelDelta: 0.017 }), BASELINES.vehicle).ok).toBe(
      true
    );
  });

  it('fails the measured scatter-defect signal on every gated scenario', () => {
    expect(evaluateBaseline(summary({ diffPixels: 41, meanAbsChannelDelta: 0.0493 }), BASELINES.quiet).ok).toBe(
      false
    );
    expect(
      evaluateBaseline(summary({ diffPixels: 0, meanAbsChannelDelta: 0.3519 }), BASELINES['open-ground']).ok
    ).toBe(false);
    expect(evaluateBaseline(summary({ diffPixels: 100, meanAbsChannelDelta: 0.2068 }), BASELINES.vehicle).ok).toBe(
      false
    );
  });

  it('never votes on a report-only scenario, whatever the numbers say', () => {
    const v = evaluateBaseline(summary({ diffPixels: 999_999, meanAbsChannelDelta: 200 }), BASELINES.combat);
    expect(v.ok).toBe(true);
    expect(v.gated).toBe(false);
  });

  it('reports both metrics when both are over', () => {
    const v = evaluateBaseline(summary({ diffPixels: 5000, meanAbsChannelDelta: 3 }), BASELINES.quiet);
    expect(v.failures).toHaveLength(2);
  });
});

describe('envKey', () => {
  it('folds a driver string down to a family, so a Chromium bump does not orphan a baseline', () => {
    // Both strings are real, read from this harness's own runs.
    expect(glFamily('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)')).toBe(
      'swiftshader'
    );
    expect(glFamily('ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)')).toBe('metal');
    expect(glFamily('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('llvmpipe');
    expect(glFamily('something nobody has seen')).toBe('unknown');
  });

  it('separates the two GL backends that were measured to disagree', () => {
    // 230 differing pixels / 0.0320 meanAbsChannelDelta between them on `quiet`
    // alone -- 100x that scenario's run-to-run noise. Sharing one baseline
    // across both would need thresholds wide enough to miss the defect.
    const sw = envKey('darwin', 'arm64', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)');
    const hw = envKey('darwin', 'arm64', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)');
    expect(sw).toBe('darwin-arm64-swiftshader');
    expect(hw).toBe('darwin-arm64-metal');
    expect(sw).not.toBe(hw);
  });

  it('separates runners as well as backends', () => {
    const mac = envKey('darwin', 'arm64', 'SwiftShader driver');
    const linux = envKey('linux', 'x64', 'SwiftShader driver');
    expect(mac).not.toBe(linux);
    expect(linux).toBe('linux-x64-swiftshader');
  });
});

describe('capturePreconditionMismatches', () => {
  const stored = {
    tick: 200,
    camera: { x: 31, y: 22, zoom: 1 },
    rect: { w: 1400, h: 900 },
    region: null,
    sha256: 'x',
  };
  const live = { tick: 200, camera: { x: 31, y: 22, zoom: 1 }, rect: { w: 1400, h: 900 } };

  it('is silent when the baseline still applies', () => {
    expect(capturePreconditionMismatches(stored, live, null)).toEqual([]);
  });

  it('catches a re-authored scenario rather than reporting it as a regression', () => {
    expect(capturePreconditionMismatches(stored, { ...live, tick: 240 }, null)).toEqual(['tick 200 -> 240']);
    expect(
      capturePreconditionMismatches(stored, { ...live, camera: { x: 31, y: 22, zoom: 1.5 } }, null)
    ).toEqual(['zoom 1 -> 1.5']);
    expect(capturePreconditionMismatches(stored, { ...live, rect: { w: 1280, h: 720 } }, null)).toEqual([
      'canvas 1400x900 -> 1280x720',
    ]);
  });

  it('catches a region moved under a baseline captured for a different one', () => {
    const out = capturePreconditionMismatches(stored, live, { x: 0, y: 0, w: 10, h: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^region null -> /);
  });
});

describe('computeDiff region', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-region-'));

  /** Two 40x40 images identical except for one 10x10 patch at (0,0). */
  function pair(): [string, string] {
    const a = new PNG({ width: 40, height: 40 });
    const b = new PNG({ width: 40, height: 40 });
    for (let i = 0; i < a.data.length; i += 4) {
      a.data[i] = b.data[i] = 100;
      a.data[i + 1] = b.data[i + 1] = 100;
      a.data[i + 2] = b.data[i + 2] = 100;
      a.data[i + 3] = b.data[i + 3] = 255;
    }
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const p = (x + y * 40) << 2;
        b.data[p] = 250;
        b.data[p + 1] = 10;
        b.data[p + 2] = 10;
      }
    }
    const pa = path.join(dir, 'a.png');
    const pb = path.join(dir, 'b.png');
    writeFileSync(pa, PNG.sync.write(a));
    writeFileSync(pb, PNG.sync.write(b));
    return [pa, pb];
  }

  it('sees the whole frame when no region is given', () => {
    const [a, b] = pair();
    const s = computeDiff(a, b);
    expect(s.region).toBeNull();
    expect(s.diffPixels).toBe(100);
    expect(s.totalPixels).toBe(1600);
  });

  it('scopes every number to the region, and excludes what falls outside it', () => {
    // This is the whole mechanism behind `open-ground`'s 1762 -> 0 noise drop:
    // the unstable content is elsewhere in the frame, so a region that does not
    // contain it reports nothing.
    const [a, b] = pair();
    const inside = computeDiff(a, b, { region: { x: 0, y: 0, w: 20, h: 20 } });
    expect(inside.diffPixels).toBe(100);
    expect(inside.totalPixels).toBe(400);
    const outside = computeDiff(a, b, { region: { x: 20, y: 20, w: 20, h: 20 } });
    expect(outside.diffPixels).toBe(0);
    expect(outside.meanAbsChannelDelta).toBe(0);
    expect(outside.region).toEqual({ x: 20, y: 20, w: 20, h: 20 });
  });

  it('refuses a region that leaves the capture rather than reading garbage', () => {
    const [a, b] = pair();
    expect(() => computeDiff(a, b, { region: { x: 30, y: 30, w: 20, h: 20 } })).toThrow(/falls outside/);
  });

  it('measures a sub-threshold palette step on meanAbsChannelDelta while pixelmatch counts zero', () => {
    // A synthetic stand-in for the real defect: every pixel of the region moved
    // by 19/255, exactly the limestone.3 -> limestone.4 step the scatter fix
    // turned on. pixelmatch's 0.1 threshold does not see it; the magnitude pass
    // does. If this ever starts reporting diffPixels > 0, the gate's primary
    // metric has quietly changed and BASELINES needs recalibrating.
    const a = new PNG({ width: 20, height: 20 });
    const b = new PNG({ width: 20, height: 20 });
    for (let i = 0; i < a.data.length; i += 4) {
      a.data[i] = 200;
      a.data[i + 1] = 180;
      a.data[i + 2] = 148;
      a.data[i + 3] = 255;
      b.data[i] = 181;
      b.data[i + 1] = 161;
      b.data[i + 2] = 129;
      b.data[i + 3] = 255;
    }
    const pa = path.join(dir, 'step-a.png');
    const pb = path.join(dir, 'step-b.png');
    writeFileSync(pa, PNG.sync.write(a));
    writeFileSync(pb, PNG.sync.write(b));
    const s = computeDiff(pa, pb);
    expect(s.diffPixels).toBe(0);
    expect(s.meanAbsChannelDelta).toBeCloseTo(19, 5);
    expect(evaluateBaseline(s, BASELINES['open-ground']).ok).toBe(false);
  });
});
