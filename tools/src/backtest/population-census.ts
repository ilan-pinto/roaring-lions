// The population census (GH-183 F3 Task 5): what each side held, at the start, at the peak and at the end
// of a run, read off the RUNTIME (`MissionRuntime.population`) and never recomputed from mission JSON.
// Report only. No campaign mission has a cap and a pinned peak would be a fitted number; the figures exist
// for the doctrine caps and for any build-up mission the lead later allows a cap.
//
// A starting figure read off the JSON would miss what the runtime does to it (an `upgrades_to` swap, a
// ledger draw, a placement that spawns more than one body per count); a peak read off the JSON would miss
// every trigger spawn, wave and bought unit. Sampling the runtime once a tick sees all of them.

/** The one thing the census reads: both sides' population, as `MissionRuntime.population` answers it. */
export interface PopulationSource {
  population(side: 0 | 1): number;
}

/** One side's three readings. */
export interface SideCensus {
  start: number;
  peak: number;
  end: number;
}

/** Start, peak and end population of both sim sides over one run. Fields only: sampling allocates nothing. */
export class PopulationCensus {
  readonly side0: SideCensus = { start: 0, peak: 0, end: 0 };
  readonly side1: SideCensus = { start: 0, peak: 0, end: 0 };

  /** Call once, straight after the runtime's `start()`: the first tick's spawns are in. */
  begin(rt: PopulationSource): void {
    const a = rt.population(0);
    const b = rt.population(1);
    this.side0.start = this.side0.peak = this.side0.end = a;
    this.side1.start = this.side1.peak = this.side1.end = b;
  }

  /** Call once per tick, after the runtime has stepped. */
  sample(rt: PopulationSource): void {
    const a = rt.population(0);
    const b = rt.population(1);
    if (a > this.side0.peak) this.side0.peak = a;
    if (b > this.side1.peak) this.side1.peak = b;
    this.side0.end = a;
    this.side1.end = b;
  }

  /** Call once when the run is over: what each side holds now. */
  finish(rt: PopulationSource): void {
    this.side0.end = rt.population(0);
    this.side1.end = rt.population(1);
  }
}

/** The report line for one mission's winning plan. */
export function populationLine(id: string, c: PopulationCensus): string {
  const side = (s: SideCensus): string => `start ${s.start}, peak ${s.peak}, end ${s.end}`;
  return `population ${id}: side 0 ${side(c.side0)}; side 1 ${side(c.side1)} (report only)`;
}
