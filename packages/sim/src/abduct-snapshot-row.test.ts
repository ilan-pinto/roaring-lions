import { describe, expect, it } from 'vitest';
import type { MissionJson, MissionRuntime } from './mission';
import { abductMission, abductWorld } from './runtime-abduct-world.test-helper';
import { RUNTIME_SNAPSHOT_SCHEMA } from './runtime-snapshot-schema';
import { abductRuntime, encodeRuntimeSection, runtimeSchemaDigest, runtimeSchemaDigestOf } from './runtime-snapshot';
import { SNAPSHOT_FIXED_HEADER_BYTES, encodeSim, restoreSim } from './snapshot';

// GH-1438 E8 pacing, the PM ruling of 19 Nov 2026 (option b): the escort's pacing word `abductPace` is a `when: 'abduct'` runtime
// row. Only a runtime whose mission has an `abduct` trigger writes it, reads it and folds it into its runtime schema digest, so
// every other runtime (every shipped mission: none authors an abduct) keeps the section and the digest an earlier build wrote,
// and its old saves still load. The every-shipped-mission half is `tools/src/runtime_digest_shipped.test.ts`.

/** The runtime schema digest every runtime but a works-only or an abduct one had before E8 (versus-works.test.ts pins it too). */
const DIGEST_BEFORE_E8 = 65675699;
/** The digest of an abduct runtime: the table with `abductPace|when:abduct` folded in (measured, then pinned). */
const DIGEST_ABDUCT = 1626469548;

/** The abduct world's mission with its abduct turned into a `withdraw_to` (the same triggers, the same length): no abduct. */
function withoutAbduct(): MissionJson {
  const m = abductMission();
  return { ...m, triggers: (m.triggers ?? []).map((t) => (t.do.kind === 'abduct' ? { ...t, do: { kind: 'withdraw_to', group: 'takers', to: 'back' } } : t)) };
}

const headerDigest = (bytes: Uint8Array): number => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(SNAPSHOT_FIXED_HEADER_BYTES - 4, true);
const section = (w: { sim: Parameters<typeof encodeRuntimeSection>[1]; rt: MissionRuntime }): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(encodeRuntimeSection(w.rt, w.sim))) as Record<string, unknown>;

describe('E8 pacing: `abductPace` is carried by an abduct runtime only', () => {
  it('the row is the one `when: abduct` row', () => {
    expect(RUNTIME_SNAPSHOT_SCHEMA.filter((r) => r.when === 'abduct').map((r) => r.name)).toEqual(['abductPace']);
  });

  it('a runtime is an abduct one exactly when its mission has an abduct trigger', () => {
    expect(abductRuntime(abductWorld().rt)).toBe(true);
    expect(abductRuntime(abductWorld(withoutAbduct()).rt)).toBe(false);
  });

  it('every other runtime keeps the digest it had before E8; an abduct runtime gets its own (pinned), and the snapshot header carries it', () => {
    expect(runtimeSchemaDigest()).toBe(DIGEST_BEFORE_E8);
    expect(runtimeSchemaDigest(false, true)).toBe(DIGEST_ABDUCT);
    expect(DIGEST_ABDUCT).not.toBe(DIGEST_BEFORE_E8);
    expect(runtimeSchemaDigest(true, true)).not.toBe(runtimeSchemaDigest(true));
    const on = abductWorld();
    const off = abductWorld(withoutAbduct());
    expect(runtimeSchemaDigestOf(on.rt)).toBe(DIGEST_ABDUCT);
    expect(runtimeSchemaDigestOf(off.rt)).toBe(DIGEST_BEFORE_E8);
    expect(headerDigest(encodeSim(on.sim, {}, on.rt))).toBe(DIGEST_ABDUCT);
    expect(headerDigest(encodeSim(off.sim, {}, off.rt))).toBe(DIGEST_BEFORE_E8);
  });

  it('the section of a runtime with no abduct has no `abductPace`; an abduct one has it, one word per trigger', () => {
    expect(section(abductWorld(withoutAbduct()))).not.toHaveProperty('abductPace');
    expect(section(abductWorld())).toHaveProperty('abductPace', [0, 0]);
  });

  it('a snapshot of an abduct world is refused by the same world built without its abduct, and the other way round', () => {
    const a = abductWorld();
    const b = abductWorld(withoutAbduct());
    expect(() => restoreSim(b.sim, encodeSim(a.sim, {}, a.rt), b.rt)).toThrow(/runtime schema digest differs/);
    const c = abductWorld(withoutAbduct());
    const d = abductWorld();
    expect(() => restoreSim(d.sim, encodeSim(c.sim, {}, c.rt), d.rt)).toThrow(/runtime schema digest differs/);
  });

  it('a poisoned pacing word is overwritten by the restore (the escort halted at tick 60)', () => {
    const a = abductWorld();
    for (let t = 0; t < 60; t++) a.rt.step(a.sim.tick());
    const halted = (a.rt as unknown as { abductPace: number[] }).abductPace[0];
    expect(halted).toBeGreaterThan(0);
    const b = abductWorld();
    (b.rt as unknown as { abductPace: number[] }).abductPace[0] = -999;
    restoreSim(b.sim, encodeSim(a.sim, {}, a.rt), b.rt);
    expect((b.rt as unknown as { abductPace: number[] }).abductPace).toEqual([halted, 0]);
    expect(b.rt.digest()).toBe(a.rt.digest());
  });
});
