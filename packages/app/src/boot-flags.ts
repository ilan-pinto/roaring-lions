/**
 * What a battlefield boot reads off its URL before anything is built (GH-1381): the side it commands and the sandbox
 * extras it takes. Out of `main.ts`, which no unit test can boot, so the pipeline the boot runs is the one
 * `boot-flags.test.ts` runs -- a side lost between the parse and the flag filter would otherwise let a Sarim Free play
 * open the KDF's field-works dock and dig the KDF's tunnel with every spec still green.
 *
 * Three readers, in this order, each saying what it dropped through `warn` (the boot prints each line with
 * `console.warn`):
 *   1. `sandboxSideOf`: `&side=`, for Free play only (a mission or a room plays the KDF, and says the value was ignored);
 *   2. `sideFlags`: the KDF-only extras off on the Sarim side;
 *   3. `roomFlags`: every extra off in a room, which always plays the KDF side, so step 2 changes nothing there.
 */
import { roomFlags } from './net/room-flags';
import { readFlags, sandboxSideOf, sideFlags, type SandboxFlagName, type SandboxSide } from './sandbox-help';

export interface BootFlags {
  side: SandboxSide;
  flags: Record<SandboxFlagName, boolean>;
}

export function bootFlags(
  params: URLSearchParams,
  boot: { readonly missionId: string | null; readonly inRoom: boolean },
  warn: (line: string) => void,
): BootFlags {
  const choice = sandboxSideOf(params, boot.missionId === null && !boot.inRoom);
  if (choice.warning !== undefined) warn(`[lions] ${choice.warning}`);
  const side = choice.value;
  const flags = roomFlags(
    sideFlags(readFlags(params), side, (k) => warn(`[lions] sandbox flag &${k} is ignored on the Sarim side: it adds KDF kit or Sarim opposition`)),
    boot.inRoom,
    (k) => warn(`[net] sandbox flag &${k} is ignored in a room`),
  );
  return { side, flags };
}
