// A CDP `Profiler.stop` profile, reduced to self time per function and per file. Pure, so `low-end.ts` (the console lines) and the
// GH-1152 submit probe (`webgpu-submit-probe-lib.ts`, the structured rows) read it the same way. Moved here from `low-end.ts`
// unchanged in what it prints (GH-943 P3 T13).

export interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
}
export interface CpuProfile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
  startTime: number;
  endTime: number;
}

export interface ProfileRow {
  /** `name  file:line`, the function's key. */
  readonly key: string;
  readonly fn: string;
  /** The last two path segments of the script URL (`(native)` when it has none). */
  readonly file: string;
  readonly selfMs: number;
}

/** Self time per function key and per file, largest first, plus the window's wall time (ms). */
export function profileSelf(p: CpuProfile): { totalMs: number; byFunction: ProfileRow[]; byFile: { file: string; selfMs: number }[] } {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const selfUs = new Map<number, number>();
  for (let i = 0; i < p.samples.length; i++) selfUs.set(p.samples[i] as number, (selfUs.get(p.samples[i] as number) ?? 0) + (p.timeDeltas[i] ?? 0));
  const fn = new Map<string, { fn: string; file: string; us: number }>();
  const file = new Map<string, number>();
  for (const [id, us] of selfUs) {
    const n = byId.get(id);
    if (!n) continue;
    const f = n.callFrame.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') || '(native)';
    const short = f.split('/').slice(-2).join('/');
    const name = n.callFrame.functionName || '(anonymous)';
    const key = `${name}  ${short}:${n.callFrame.lineNumber + 1}`;
    const cur = fn.get(key) ?? { fn: name, file: short, us: 0 };
    cur.us += us;
    fn.set(key, cur);
    file.set(short, (file.get(short) ?? 0) + us);
  }
  return {
    totalMs: (p.endTime - p.startTime) / 1000,
    byFunction: [...fn.entries()].sort((a, b) => b[1].us - a[1].us).map(([key, v]) => ({ key, fn: v.fn, file: v.file, selfMs: v.us / 1000 })),
    byFile: [...file.entries()].sort((a, b) => b[1] - a[1]).map(([f, us]) => ({ file: f, selfMs: us / 1000 })),
  };
}

/** Self time per function and per file, as a share of the window's wall
 *  time. `(program)`/`(idle)`/`(garbage collector)` are kept: under a
 *  throttled CPU the GC line is one of the answers. */
export function summariseProfile(p: CpuProfile, top = 14): string[] {
  const s = profileSelf(p);
  const total = s.totalMs * 1000;
  const rows = (m: { key: string; us: number }[]): string[] =>
    m.slice(0, top).map(({ key, us }) => `    ${((us / total) * 100).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${key}`);
  return [
    `   window ${(total / 1000).toFixed(0)} ms -- by function:`,
    ...rows(s.byFunction.map((r) => ({ key: r.key, us: r.selfMs * 1000 }))),
    '   by file:',
    ...rows(s.byFile.map((r) => ({ key: r.file, us: r.selfMs * 1000 }))),
  ];
}
