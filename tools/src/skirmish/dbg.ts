import { play, FIRE } from './skirmish';
const r = play(Number(process.env.SEED ?? 424242), (process.argv[2] ?? 'naive') as never, (process.argv[3] ?? 'commander') as never);
if (process.env.TRACE) for (const d of r.trace) console.log(d.tick / 20, d.kind, d.task, d.n);
console.log(r.winner, r.points, r.kdfLost, r.sarimLost, [...FIRE].sort().join(' '));
