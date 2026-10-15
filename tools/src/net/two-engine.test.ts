// `two-engine.ts` drives three real browsers and is run only by CI's `visual`
// job; what it DECIDES is `verdict`, tested here on hand-written readings.
import { describe, it, expect } from 'vitest';
import { annotationText, decide, verdict, type EngineOutcome, type EngineReading } from './two-engine-verdict';

const TARGET = 600;
const FIRST_ORDER = 10;
/** What Node computed for the shipped content (L4, `shippedContentDigest`). */
const CONTENT = -1234567;
const at = (hash: number, over: Partial<EngineReading> = {}): EngineReading => ({
  bootTick: 0,
  bootUnits: 14,
  bootHostiles: 9,
  tick: TARGET,
  hash,
  contentDigest: CONTENT,
  ...over,
});

describe('two-engine verdict', () => {
  it('passes three engines that agree, naming the hash', () => {
    const v = verdict({ chromium: at(41717), firefox: at(41717), webkit: at(41717) }, TARGET, FIRST_ORDER, CONTENT);
    expect(v.ok).toBe(true);
    expect(v.message).toBe('PASS: 3 engines, tick 600, hash 41717, content digest -1234567 (equal to Node\'s)');
  });

  it('fails when one engine of three reports a different hash', () => {
    const v = verdict({ chromium: at(9001), firefox: at(9002), webkit: at(9001) }, TARGET, FIRST_ORDER, CONTENT);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/^FAIL: engines disagree/);
  });

  it('fails when an engine stopped short of the target tick, even with equal hashes', () => {
    const v = verdict({ chromium: at(7), firefox: at(7, { tick: TARGET - 1 }), webkit: at(7) }, TARGET, FIRST_ORDER, CONTENT);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/^FAIL: an engine missed the target tick 600/);
  });

  it('fails when an engine had run past the first order before the script started', () => {
    const v = verdict({ chromium: at(7), firefox: at(7, { bootTick: FIRST_ORDER + 1 }), webkit: at(7) }, TARGET, FIRST_ORDER, CONTENT);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/^FAIL: boot not comparable: firefox had already passed tick 10/);
  });

  it('fails when the engines spawned different forces', () => {
    const v = verdict({ chromium: at(7), firefox: at(7), webkit: at(7, { bootHostiles: 8 }) }, TARGET, FIRST_ORDER, CONTENT);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/^FAIL: boot not comparable: the engines spawned different forces/);
  });

  it('L4: fails when one engine computes a different content digest, even with equal sim hashes', () => {
    const v = verdict({ chromium: at(7), firefox: at(7, { contentDigest: CONTENT + 1 }), webkit: at(7) }, TARGET, FIRST_ORDER, CONTENT);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/^FAIL: content digest: firefox computed -1234566, Node computed -1234567/);
  });

  it('L4: fails when every engine agrees on a content digest that is not Node\'s', () => {
    const v = verdict({ chromium: at(7, { contentDigest: 3 }), firefox: at(7, { contentDigest: 3 }) }, TARGET, FIRST_ORDER, CONTENT);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/^FAIL: content digest: chromium computed 3, Node computed -1234567/);
  });

  it('fails a lone engine: one reading agrees with itself whatever it computed', () => {
    expect(verdict({ chromium: at(7) }, TARGET, FIRST_ORDER, CONTENT).ok).toBe(false);
    expect(verdict({}, TARGET, FIRST_ORDER, CONTENT).ok).toBe(false);
  });
});

const ok = (hash: number, over: Partial<EngineReading> = {}): EngineOutcome => ({ kind: 'reading', reading: at(hash, over) });
const noGl = (name: string): EngineOutcome => ({ kind: 'unbootable', reason: `${name}: no WebGL2 here.\n  second line` });
const brokenOn = (name: string): EngineOutcome => ({ kind: 'broken', reason: `${name}: the order script did not return within 120 s` });
const texts = (lines: { text: string }[]) => lines.map((l) => l.text);

describe('two-engine decision (exit codes, R39)', () => {
  it('exit 0: three engines booted and agree', () => {
    const d = decide({ chromium: ok(5), firefox: ok(5), webkit: ok(5) }, TARGET, FIRST_ORDER, CONTENT);
    expect(d.exit).toBe(0);
    expect(texts(d.lines)).toEqual(['PASS: 3 engines, tick 600, hash 5, content digest -1234567 (equal to Node\'s) (chromium, firefox, webkit)']);
  });

  it('exit 3: an engine with no WebGL2 is a named warning, and the two that booted are still compared', () => {
    const d = decide({ chromium: ok(5), firefox: noGl('firefox'), webkit: ok(5) }, TARGET, FIRST_ORDER, CONTENT);
    expect(d.exit).toBe(3);
    expect(texts(d.lines)).toEqual([
      '::warning title=firefox could not boot (three-engine check)::firefox: no WebGL2 here.%0A  second line',
      'PASS: 2 engines, tick 600, hash 5, content digest -1234567 (equal to Node\'s) (chromium, webkit)',
    ]);
    expect(d.lines.every((l) => l.level === 'log')).toBe(true);
  });

  it('exit 1: two that booted disagree, whatever else could not boot', () => {
    const d = decide({ chromium: ok(5), firefox: noGl('firefox'), webkit: ok(6) }, TARGET, FIRST_ORDER, CONTENT);
    expect(d.exit).toBe(1);
    expect(d.lines.at(-1)).toMatchObject({ level: 'error', text: expect.stringMatching(/^FAIL: engines disagree/) });
  });

  it('exit 1: a disagreement outranks an engine that broke', () => {
    expect(decide({ chromium: ok(5), firefox: ok(6), webkit: brokenOn('webkit') }, TARGET, FIRST_ORDER, CONTENT).exit).toBe(1);
  });

  it('exit 1: a missed tick or an incomparable boot among the booted is a failure, not a warning', () => {
    expect(decide({ chromium: ok(5), firefox: ok(5, { tick: TARGET - 1 }), webkit: noGl('webkit') }, TARGET, FIRST_ORDER, CONTENT).exit).toBe(1);
    expect(decide({ chromium: ok(5), firefox: ok(5, { bootTick: FIRST_ORDER + 1 }), webkit: noGl('webkit') }, TARGET, FIRST_ORDER, CONTENT).exit).toBe(1);
  });

  it('exit 2: an engine that started and broke is a failure even when the other two agree', () => {
    const d = decide({ chromium: ok(5), firefox: ok(5), webkit: brokenOn('webkit') }, TARGET, FIRST_ORDER, CONTENT);
    expect(d.exit).toBe(2);
    expect(texts(d.lines)).toEqual([
      'FAIL (no reading): webkit: the order script did not return within 120 s',
      'PASS: 2 engines, tick 600, hash 5, content digest -1234567 (equal to Node\'s) (chromium, firefox)',
      'FAIL: webkit started and did not produce a reading.',
    ]);
  });

  it('exit 2 outranks exit 3', () => {
    expect(decide({ chromium: ok(5), firefox: noGl('firefox'), webkit: brokenOn('webkit') }, TARGET, FIRST_ORDER, CONTENT).exit).toBe(2);
  });

  it('exit 3 with a warning that NO cross-engine reading was taken when fewer than two booted', () => {
    for (const outcomes of [
      { chromium: ok(5), firefox: noGl('firefox'), webkit: noGl('webkit') },
      { chromium: noGl('chromium'), firefox: noGl('firefox'), webkit: noGl('webkit') },
    ]) {
      const d = decide(outcomes, TARGET, FIRST_ORDER, CONTENT);
      expect(d.exit).toBe(3);
      expect(d.lines.at(-1)?.text).toMatch(/^::warning title=No cross-engine reading::Only [01] engine\(s\) booted/);
      expect(texts(d.lines).some((t) => t.startsWith('PASS'))).toBe(false);
    }
  });

  it('exit 1: nothing at all, or a lone reading with nothing else to explain it, is never a pass', () => {
    expect(decide({}, TARGET, FIRST_ORDER, CONTENT).exit).toBe(1);
    expect(decide({ chromium: ok(5) }, TARGET, FIRST_ORDER, CONTENT).exit).toBe(1);
  });

  it('an annotation message stays on one line', () => {
    expect(annotationText('a%b\r\nc\nd')).toBe('a%25b%0D%0Ac%0Ad');
  });
});
