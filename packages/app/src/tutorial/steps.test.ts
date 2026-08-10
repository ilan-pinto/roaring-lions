import { describe, expect, it } from 'vitest';
import { tutorials } from '@lions/data';
import { SIM_EVENT_KINDS, MISSION_EVENT_KINDS } from '@lions/sim';
import { INTENT_KINDS } from '../input/intents';
import type { PredicateJson, StepJson } from './runtime';

const SIM_EVENTS = new Set<string>(SIM_EVENT_KINDS);
const MISSION_EVENTS = new Set<string>(MISSION_EVENT_KINDS);

function predicates(p: PredicateJson): PredicateJson[] {
  return [p, ...(p.of ?? []).flatMap(predicates)];
}

const all = Object.values(tutorials) as { id: string; mission: string; steps: StepJson[] }[];

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
      mission: ['kind', 'event'],
      elapsed_s: ['kind', 'seconds'],
      all_of: ['kind', 'of'],
      any_of: ['kind', 'of'],
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
    // hidden_setup, breach, mark_tunnel and tunnel_travel are unit data only —
    // zero sim references. A step mentioning one instructs the player to do
    // something that cannot happen.
    const absent = ['hidden_setup', 'breach', 'mark_tunnel', 'tunnel_travel'];
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
});
