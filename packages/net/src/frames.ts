import type { Command } from '@lions/sim';
import type { Seat } from './config';
export interface Stamped { seat: Seat; seq: number; cmd: Command }
export interface Frame { tick: number; cmds: Stamped[] }
