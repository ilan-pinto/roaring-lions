import { describe, expect, it } from 'vitest';
import { missions, tutorials } from '@lions/data';
import { SIM_EVENT_KINDS, MISSION_EVENT_KINDS } from '@lions/sim';
import { INTENT_KINDS } from '../input/intents';
import type { PredicateJson, StepJson } from './runtime';

const SIM_EVENTS = new Set<string>(SIM_EVENT_KINDS);
const MISSION_EVENTS = new Set<string>(MISSION_EVENT_KINDS);

function predicates(p: PredicateJson): PredicateJson[] {
  return [p, ...(p.of ?? []).flatMap(predicates)];
}

const all = Object.values(tutorials) as { id: string; mission: string; steps: StepJson[]; completes?: string }[];

describe('shipped tutorial steps', () => {
  it('ships at least one sequence', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it('names only intent kinds the input layer actually produces', () => {
    const known = new Set<string>(INTENT_KINDS);
    for (const t of all) {
      for (const s of t.steps) {
        for (const p of predicates(s.await)) {
          if (p.kind !== 'intent') continue;
          expect(known, `${t.id}/${s.id} awaits intent "${p.intent ?? '<missing>'}"`).toContain(p.intent);
        }
      }
    }
  });

  it('names only sim and mission events the sim actually emits', () => {
    for (const t of all) {
      for (const s of t.steps) {
        for (const p of predicates(s.await)) {
          if (p.kind === 'sim') {
            expect(SIM_EVENTS, `${t.id}/${s.id} awaits sim event "${p.event ?? '<missing>'}"`).toContain(p.event);
          }
          if (p.kind === 'mission') {
            expect(MISSION_EVENTS, `${t.id}/${s.id} awaits mission event "${p.event ?? '<missing>'}"`).toContain(p.event);
          }
        }
      }
    }
  });

  it('gives every predicate the field its kind needs', () => {
    for (const t of all) {
      for (const s of t.steps) {
        for (const p of predicates(s.await)) {
          const where = `${t.id}/${s.id}`;
          if (p.kind === 'intent') expect(p.intent, where).toBeDefined();
          if (p.kind === 'sim' || p.kind === 'mission') expect(p.event, where).toBeDefined();
          if (p.kind === 'elapsed_s') expect(p.seconds, where).toBeDefined();
          if (p.kind === 'camera') expect(p.tiles, where).toBeDefined();
          // An id only means something on the two events that carry an
          // authored one; on any other kind it would silently match nothing.
          if (p.kind === 'mission' && p.id !== undefined) expect(['trigger', 'objective'], where).toContain(p.event);
          if (p.kind === 'all_of' || p.kind === 'any_of') {
            expect((p.of ?? []).length, where).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  it('carries no field foreign to the predicate kind', () => {
    // The schema's predicate object is flat, so `{kind:'intent', intent:'order',
    // event:'destroyed'}` validates and then silently ignores `event` — the
    // author believed they had constrained the gate and they had not. The schema
    // cannot catch this without per-kind subschemas; this can.
    const allowed: Record<string, string[]> = {
      intent: ['kind', 'intent', 'verb', 'via', 'action', 'append'],
      sim: ['kind', 'event', 'side', 'by_unit', 'loaded'],
      mission: ['kind', 'event', 'id'],
      elapsed_s: ['kind', 'seconds'],
      all_of: ['kind', 'of'],
      any_of: ['kind', 'of'],
      hover: ['kind', 'target', 'projection'],
      camera: ['kind', 'tiles'],
    };
    for (const t of all) {
      for (const s of t.steps) {
        for (const p of predicates(s.await)) {
          const ok = allowed[p.kind];
          for (const key of Object.keys(p)) {
            expect(ok, `${t.id}/${s.id}: "${key}" means nothing to a ${p.kind} predicate`).toContain(key);
          }
        }
      }
    }
  });

  it('never teaches an ability the sim does not implement', () => {
    // hidden_setup, breach and tunnel_travel are unit data only — zero sim
    // references. A step mentioning one instructs the player to do something
    // that cannot happen. mark_tunnel left this list when stepDetection
    // started honouring it: a unit carrying it now identifies any tunnel
    // route it can see, so teaching it would be legitimate.
    const absent = ['hidden_setup', 'breach', 'tunnel_travel'];
    for (const t of all) {
      for (const s of t.steps) {
        const prose = `${s.title} ${s.teach} ${s.nudge ?? ''}`.toLowerCase();
        for (const a of absent) {
          expect(prose, `${t.id}/${s.id} mentions ${a}`).not.toContain(a.replace('_', ' '));
          expect(prose, `${t.id}/${s.id} mentions ${a}`).not.toContain(a);
        }
      }
    }
  });

  it('has unique step ids within a sequence', () => {
    for (const t of all) {
      const ids = t.steps.map((s) => s.id);
      expect(new Set(ids).size, `${t.id} has duplicate step ids`).toBe(ids.length);
    }
  });

  it('the tutorial teaches the hover, and every step id is still unique', () => {
    const STEPS = tutorials.beit_sahwan_0.steps;
    const ids = STEPS.map((s) => s.id);
    expect(ids).toContain('read_before_you_fire');
    expect(new Set(ids).size).toBe(ids.length);
    // GH-345: nine beats, down from fourteen.
    expect(STEPS).toHaveLength(9);
  });

  // GH-345 (spec §a): one verb per beat, and at most one NEW surface per beat
  // -- a beat may reveal an element together with the controls that are part
  // of it (the order row and its key hint; the objective and its list).
  it('reveals each HUD surface once, and never the ones the tutorial keeps off', () => {
    const t = tutorials.beit_sahwan_0 as unknown as { hud_start: string[]; steps: { reveal?: string[] }[] };
    const revealed = [...t.hud_start, ...t.steps.flatMap((s) => s.reveal ?? [])];
    expect(new Set(revealed).size).toBe(revealed.length);
    for (const never of ['clock', 'speed', 'mute', 'dock', 'logistics', 'intel', 'groups', 'radio']) {
      expect(revealed, `${never} is revealed by the tutorial`).not.toContain(never);
    }
    // The fire panel arrives with the beat that teaches it.
    const fireBeat = t.steps.findIndex((s) => (s.reveal ?? []).includes('fire'));
    expect(tutorials.beit_sahwan_0.steps[fireBeat].id).toBe('read_before_you_fire');
  });

  it('beat 5 asks for all four panel states, and never for "cannot penetrate"', () => {
    const beat = tutorials.beit_sahwan_0.steps.find((s) => s.id === 'read_before_you_fire') as StepJson;
    expect((beat.await.of ?? []).map((p) => p.projection).sort()).toEqual(['cover', 'moving', 'out_of_reach', 'unidentified']);
    expect(beat.teach).not.toMatch(/penetrat/i);
  });

  it('completes only an objective its mission declares', () => {
    for (const t of all) {
      expect(t.completes, `${t.id} should declare which objective finishing it completes`).toBeDefined();
      const m = (missions as Record<string, { objectives: { id: string }[] } | undefined>)[t.mission];
      expect(m, `${t.id} teaches unknown mission "${t.mission}"`).toBeDefined();
      expect(
        m?.objectives.map((o) => o.id),
        `${t.id} completes "${t.completes}"`
      ).toContain(t.completes);
    }
  });
});
