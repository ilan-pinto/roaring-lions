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
// Several of these tests exist because a real measurement said something
// counter-intuitive, and a future reader tightening the code would otherwise
// "fix" it back:
//   - a scenario can fail on `meanAbsChannelDelta` with `diffPixels` at ZERO
//     (the palette-step regression this renderer actually suffers);
//   - `combat` must NOT vote, however tempting a fifth green tick looks;
//   - `vehicle`'s thresholds must still reject the pre-freeze flake's high
//     mode, because widening to absorb it was the rejected fix; and
//   - the thresholds must still score the recorded boulder-deletion numbers
//     `relief`-only, which is the map-coverage blind spot written down as
//     arithmetic -- and, separately, `RELIEF_SCENARIO`'s camera must still be
//     POINTED at that boulder field, which is the half the arithmetic cannot
//     see and which `RELIEF_SCENARIO framing` asserts against `tel_marum.json`.
//
// And the FIRST test in this file is here because the version it replaced
// could not fail: it compared `Object.keys(BASELINES)` against a hand-written
// copy of `Object.keys(BASELINES)` and never imported `SCENARIOS` at all, so a
// scenario shipped with no calibrated threshold was green.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maps, parseMap } from '@lions/data';
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
import { CAPTURE_VIEWPORT, RELIEF_SCENARIO, SCENARIOS } from './capture-protocol';

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
    //
    // THE ASSERTION READS `SCENARIOS`, NOT A HAND-WRITTEN LIST. What was here
    // before compared `Object.keys(BASELINES).sort()` against a literal copy
    // of `Object.keys(BASELINES)` -- a test that could not fail, and did not:
    // adding a fifth scenario to `SCENARIOS` with no `BASELINES` entry left
    // all eighteen specs in this file green while the gate itself would have
    // thrown at run time in CI, or (worse, on a `--scenario`-filtered run)
    // never looked at it at all.
    expect(Object.keys(BASELINES).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
    expect(() => specFor('no-such-scenario')).toThrow(/no BASELINES entry/);
  });

  it('names every scenario it gates, so the reverse direction is covered too', () => {
    // The equality above already forces both directions, but only while both
    // sides are compared as sets. Spelled out: an entry here with no scenario
    // behind it is a threshold nothing captures, which reads as coverage and
    // is not.
    const captured = new Set(SCENARIOS.map((s) => s.id));
    for (const id of Object.keys(BASELINES)) expect(captured.has(id)).toBe(true);
  });

  it('gates by default and only combat opts out', () => {
    expect(isGated(BASELINES.quiet)).toBe(true);
    expect(isGated(BASELINES['open-ground'])).toBe(true);
    expect(isGated(BASELINES.vehicle)).toBe(true);
    expect(isGated(BASELINES.relief)).toBe(true);
    // Not an oversight. Two captures of the SAME commit differ by 969-3847
    // pixels on this scene, and the scatter defect reads 3231 -- inside that
    // band. There is no honest threshold, so it is reported and does not vote.
    expect(isGated(BASELINES.combat)).toBe(false);
  });

  it('scopes open-ground to the measured-stable ground crop, not the whole frame', () => {
    expect(BASELINES['open-ground'].region).toEqual({ x: 950, y: 500, w: 450, h: 400 });
    expect(BASELINES.quiet.region).toBeNull();
  });

  it('covers a map with relief and boulders, which two of the five shipped maps cannot', () => {
    // `tel_marum` is the only shipped map with an elevation grid and the only
    // one with `b` tiles. Before `relief` existed the gate sampled
    // `beit_sahwan_outskirts` and `tutorial_ground` only, both flat and
    // boulder-free, and deleting every boulder decor object left it green.
    const maps = SCENARIOS.filter((s) => s.sandboxMap !== undefined).map((s) => s.sandboxMap);
    expect(maps).toContain('tel_marum');
    expect(BASELINES.relief).toBeDefined();
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
    expect(v.failures.join(' ')).toMatch(/meanAbsChannelDelta 0\.3519 > 0\.02/);
    // Exactly one failure: the pixel count is inside budget and contributes
    // nothing. (The one message mentions `diffPixels` in its own explanation,
    // so count the failures rather than grepping the text.)
    expect(v.failures).toHaveLength(1);
  });

  it('passes the measured run-to-run noise on every gated scenario', () => {
    // The WORST same-environment reading actually observed for each scenario
    // over 24 consecutive full-gate runs, with the app's frame loop frozen. If
    // a future edit tightens a threshold under these, the gate starts crying
    // wolf -- which is how a gate earns an allowlist.
    //
    // The figures this test used to carry (quiet 41 px / 0.0024, vehicle 133 px
    // / 0.0170) were the best case rather than the spread: an independent
    // 18-run sample measured `vehicle` at 45-1549 px / 0.0110-0.1299 and
    // false-red 28% of the time. The cause was the rAF loop repainting between
    // the capture script and the screenshot; see `FREEZE_FRAME_LOOP_STATEMENTS`.
    expect(evaluateBaseline(summary({ diffPixels: 1, meanAbsChannelDelta: 0.0001 }), BASELINES.quiet).ok).toBe(true);
    expect(
      evaluateBaseline(summary({ diffPixels: 0, meanAbsChannelDelta: 0 }), BASELINES['open-ground']).ok
    ).toBe(true);
    expect(evaluateBaseline(summary({ diffPixels: 101, meanAbsChannelDelta: 0.0058 }), BASELINES.vehicle).ok).toBe(
      true
    );
    expect(evaluateBaseline(summary({ diffPixels: 0, meanAbsChannelDelta: 0 }), BASELINES.relief).ok).toBe(true);
  });

  it('would have gone red on the pre-freeze vehicle flake, which is why it was fixed not widened', () => {
    // The high mode of the measured bimodal distribution on an UNMODIFIED
    // tree. It must still fail: widening `vehicle` until this passed was the
    // rejected option, because a threshold that absorbs 1549 px / 0.1299 also
    // absorbs the 0.1953 the scatter defect reads on this scenario.
    expect(
      evaluateBaseline(summary({ diffPixels: 1549, meanAbsChannelDelta: 0.1299 }), BASELINES.vehicle).ok
    ).toBe(false);
  });

  it('fails the measured scatter-defect signal on every gated scenario', () => {
    // Re-measured against the re-blessed baselines under the frozen frame
    // loop, by reverse-applying `d9fd1c7`'s own diff onto HEAD.
    expect(evaluateBaseline(summary({ diffPixels: 14, meanAbsChannelDelta: 0.047 }), BASELINES.quiet).ok).toBe(
      false
    );
    expect(
      evaluateBaseline(summary({ diffPixels: 0, meanAbsChannelDelta: 0.3519 }), BASELINES['open-ground']).ok
    ).toBe(false);
    expect(evaluateBaseline(summary({ diffPixels: 63, meanAbsChannelDelta: 0.1953 }), BASELINES.vehicle).ok).toBe(
      false
    );
    expect(evaluateBaseline(summary({ diffPixels: 86, meanAbsChannelDelta: 0.1452 }), BASELINES.relief).ok).toBe(
      false
    );
  });

  it('scores the RECORDED boulder-deletion numbers relief-only -- arithmetic over two sets of constants, not a capture', () => {
    // WHAT THIS TEST IS, said plainly, because its old name ("fails the boulder
    // deletion on relief, and on relief alone") promised something it never
    // did. There is no renderer here, no capture, and no `relief` PNG: four
    // hardcoded literals -- the numbers a real gate run measured with
    // `decor-place.ts`'s `if (boulder) return 'boulder'` turned into `return
    // null` -- are fed to `evaluateBaseline` and checked against thresholds
    // defined a few lines away in the same module. Re-aim `RELIEF_SCENARIO`'s
    // camera off the boulder corridor, which is exactly the change that
    // reopens the blind spot, and this test still passes.
    //
    // It is kept because the narrow property it DOES pin is worth pinning:
    // these thresholds still separate that measured signal from that measured
    // noise, so tightening `vehicle` under 35 px / 0.0046 or loosening
    // `relief` past 36001 px / 2.6292 goes red here. The property the old name
    // claimed -- that the gate is still pointed at the boulder field at all --
    // is pinned by `RELIEF_SCENARIO framing` below, against `tel_marum.json`.
    expect(
      evaluateBaseline(summary({ diffPixels: 36001, meanAbsChannelDelta: 2.6292 }), BASELINES.relief).ok
    ).toBe(false);
    expect(evaluateBaseline(summary({ diffPixels: 1, meanAbsChannelDelta: 0.0001 }), BASELINES.quiet).ok).toBe(true);
    expect(
      evaluateBaseline(summary({ diffPixels: 0, meanAbsChannelDelta: 0 }), BASELINES['open-ground']).ok
    ).toBe(true);
    expect(evaluateBaseline(summary({ diffPixels: 35, meanAbsChannelDelta: 0.0046 }), BASELINES.vehicle).ok).toBe(
      true
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

// ============================================================================
// RELIEF_SCENARIO framing -- the guard the boulder-deletion test only looked
// like it was
// ============================================================================
//
// `relief` catches a terrain regression for exactly one reason: its camera is
// pointed at `tel_marum`'s boulder corridor. Nothing enforced that. The
// scenario's `cameraTile`, `zoom` and `sandboxMap` are three plain literals,
// and moving any of them off the feature -- the single change that puts the
// map-coverage blind spot back -- left every spec in this file green, because
// none of them read the scenario at all.
//
// So this block asserts the geometry, from `tel_marum.json` rather than from a
// number typed here: every authored `b` tile must land inside the capture rect
// at the scenario's own camera and zoom, and the field must still cover a real
// share of the frame. It needs no browser and no PNG, so it runs in
// `pnpm test` with everything else.

/** `tools` may import `@lions/sim` and `@lions/data` only (eslint.config.mjs),
 *  and `packages/render` deliberately does not export its projection anyway
 *  ("Projection is a question you ask the renderer... a second exported copy
 *  of the arithmetic is a source of truth that drifts", `render/src/index.ts`).
 *  So the three numbers the framing check needs are READ OUT of `project.ts`
 *  instead of copied into this file: a copy would go on asserting against a
 *  frame the renderer had stopped drawing, silently and green. Throws rather
 *  than defaulting if the constant moves or is renamed. */
function renderConstant(name: string): number {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../packages/render/src/project.ts'
  );
  const m = new RegExp(`export const ${name} = (-?[0-9.]+);`).exec(readFileSync(file, 'utf8'));
  if (!m) {
    throw new Error(
      `baseline.test.ts: could not read ${name} out of packages/render/src/project.ts. The ` +
        'framing check below needs the real projection scale; fix this reader rather than ' +
        'hardcoding a number here.'
    );
  }
  return Number(m[1]);
}

const TILE_W = renderConstant('TILE_W');
const TILE_H = renderConstant('TILE_H');
const ELEV_STEP = renderConstant('ELEV_STEP');

/** Tile -> pixel inside the capture, the 2:1 dimetric projection
 *  `packages/render/src/project.ts` defines: `worldToScreen(wx, wy, cam, vp,
 *  lift)` with `lift = ELEV_STEP * height`, which is what puts a raised tile
 *  and whatever stands on it up the screen together. Ground-level agreement
 *  between the two backends is what `three/camera.ts`'s 30-degree pitch is FOR
 *  (see `ELEVATION` in that file), so this models the three capture too. */
function tileToCapture(
  x: number,
  y: number,
  height: number,
  cam: { x: number; y: number; zoom: number }
): { x: number; y: number } {
  const isoX = (wx: number, wy: number): number => ((wx - wy) * TILE_W) / 2;
  const isoY = (wx: number, wy: number): number => ((wx + wy) * TILE_H) / 2;
  return {
    x: (isoX(x, y) - isoX(cam.x, cam.y)) * cam.zoom + CAPTURE_VIEWPORT.width / 2,
    y:
      (isoY(x, y) - height * ELEV_STEP - isoY(cam.x, cam.y)) * cam.zoom +
      CAPTURE_VIEWPORT.height / 2,
  };
}

describe('RELIEF_SCENARIO framing', () => {
  const json = maps[RELIEF_SCENARIO.sandboxMap as keyof typeof maps];
  const map = parseMap(json);
  const boulders: [number, number][] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.boulder[y * map.width + x] !== 0) boulders.push([x, y]);
    }
  }
  const cam = {
    x: RELIEF_SCENARIO.cameraTile?.[0] ?? NaN,
    y: RELIEF_SCENARIO.cameraTile?.[1] ?? NaN,
    zoom: RELIEF_SCENARIO.zoom ?? 1,
  };

  it('is aimed at the only shipped map that has boulders at all', () => {
    expect(RELIEF_SCENARIO.sandboxMap).toBe('tel_marum');
    // The field itself, read from the map rather than asserted from memory:
    // the corridor x 10-11 / y 12-17 and the scree apron x 9-12 / y 18 that
    // `CLAUDE.md` and `RELIEF_SCENARIO`'s own comment both name.
    expect(boulders).toHaveLength(16);
    expect(Math.min(...boulders.map((b) => b[0]))).toBe(9);
    expect(Math.max(...boulders.map((b) => b[0]))).toBe(12);
    expect(Math.min(...boulders.map((b) => b[1]))).toBe(12);
    expect(Math.max(...boulders.map((b) => b[1]))).toBe(18);
    // A marker-framed scenario would need the map's marker table instead; this
    // one is `cameraTile`, and the check below reads it directly.
    expect(RELIEF_SCENARIO.cameraTile).toBeDefined();
  });

  it('puts every authored boulder tile inside the capture rect', () => {
    // 32 px of margin, not zero: a tile ON the edge of the frame is half out
    // of it, and the point of the scenario is that losing the field moves a
    // large, central part of the picture.
    const MARGIN = 32;
    const outside = boulders
      .map(([x, y]) => ({ x, y, p: tileToCapture(x, y, map.elevation[y * map.width + x], cam) }))
      .filter(
        (t) =>
          t.p.x < MARGIN ||
          t.p.y < MARGIN ||
          t.p.x > CAPTURE_VIEWPORT.width - MARGIN ||
          t.p.y > CAPTURE_VIEWPORT.height - MARGIN
      );
    expect(
      outside.map((t) => `(${t.x},${t.y}) -> ${t.p.x.toFixed(0)},${t.p.y.toFixed(0)}`)
    ).toEqual([]);
  });

  it('frames the field large enough for its deletion to be the picture, not a speck', () => {
    // The measured signal is 36001 differing pixels / 2.6292 against a
    // 0/0.0000 floor. That is a property of the FRAMING as much as of the
    // feature: at zoom 0.35 (the in-game floor) the same field is a smear a
    // few dozen pixels across, and the same deletion would read as noise.
    const pts = boulders.map(([x, y]) => tileToCapture(x, y, map.elevation[y * map.width + x], cam));
    const spanX = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const spanY = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    expect(spanX / CAPTURE_VIEWPORT.width).toBeGreaterThan(0.25);
    expect(spanY / CAPTURE_VIEWPORT.height).toBeGreaterThan(0.25);
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
