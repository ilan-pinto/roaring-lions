// The scripted winning plans for Bir Tarsha (The Long Ground, town 2), one file per mission. Side-effect free: exports closures and constants, runs
// nothing. `playtest.ts` runs `BIR_TARSHA_PLANS` down the ledger chain.
import type { Plan } from '../playtest-run';
import { bt1Plan } from './bir_tarsha_1';
import { bt2Plan } from './bir_tarsha_2';
import { bt3Plan } from './bir_tarsha_3';
import { bt4Plan } from './bir_tarsha_4';
import { bt5Plan } from './bir_tarsha_5';

export { bt1Plan, bt2Plan, bt3Plan, bt4Plan, bt5Plan };
export { M, foesIn } from './bir_tarsha_util';

export const BIR_TARSHA_CHAIN = ['bir_tarsha_1_recon', 'bir_tarsha_2_foothold', 'bir_tarsha_3_clearance', 'bir_tarsha_4_clearance', 'bir_tarsha_5_subterranean'] as const;

export const BIR_TARSHA_PLANS: Record<(typeof BIR_TARSHA_CHAIN)[number], Plan> = {
  bir_tarsha_1_recon: bt1Plan,
  bir_tarsha_2_foothold: bt2Plan,
  bir_tarsha_3_clearance: bt3Plan,
  bir_tarsha_4_clearance: bt4Plan,
  bir_tarsha_5_subterranean: bt5Plan,
};
