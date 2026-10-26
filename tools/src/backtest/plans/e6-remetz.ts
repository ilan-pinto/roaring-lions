// The Remetz laser carrier both swarm missions' winning plans build (E6, GH-274), lifted out of `playtest.ts`
// so a plan in a side-effect-free module (`wadi_halam.ts`; Umm Zeitoun II stays in `playtest.ts`) can use it.
// No side effects at import: the report map starts empty and only a plan that runs fills it.
import { fx, type Sim, type MissionRuntime, type SimEvent } from '@lions/sim';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

// E6 (GH-274 item 5): both swarm missions' optimal plans build ONE aa_remetz at t=0 and park it halted
// at `post`, so CI exercises the beam and the Conduct-85 gate. The post is the whole lesson: a carrier
// behind the crest has no line to the swarm (measured: beam target -1 for the whole fight), so UZ II
// parks it ON the crest and WH III on the bunds. It stays out of every re-anchoring attack-move below.
export const remetzReport = new Map<string, { accepted: boolean; built: boolean; beams: number }>();
export function e6Remetz(
  sim: Sim,
  rt: MissionRuntime,
  ids: (t: string) => number[],
  at: (t: number, fn: () => void) => void,
  missionId: string,
  post: [number, number]
): void {
  // Each run gets its OWN record; only the first (seed 424242, base tier) is entered in the report. The
  // max-tier replay builds the same carrier on a record of its own, so it can neither mask a base run
  // that refused the build or never struck, nor add its strikes to the base count.
  const rec = { accepted: false, built: false, beams: 0 };
  if (!remetzReport.has(missionId)) remetzReport.set(missionId, rec);
  at(0, () => void (rec.accepted = rt.requestBuild('aa_remetz')));
  for (let s = 2; s <= 120; s += 2)
    at(s, () => {
      const r = ids('aa_remetz');
      if (r.length && !rec.built) {
        rec.built = true;
        sim.queueCommand({ kind: 'move', ids: r, ...M(post[0], post[1]) });
      }
    });
}
/** Count the carrier's beam strikes, from the run's own event stream. */
export const countBeams = (missionId: string) => (evs: readonly SimEvent[]): void => {
  const rec = remetzReport.get(missionId);
  if (rec) for (const e of evs) if (e.kind === 'beam' && e.phase === 'struck') rec.beams++;
};
export const isRemetz = (sim: Sim, i: number): boolean => sim.unitTypes[sim.state.typeIdx[i]].id === 'aa_remetz';
