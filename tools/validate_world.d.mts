export function townGateFailures(world: {
  regions: { id: string; towns: { id: string; missions: string[]; unlock?: { after_mission?: string } }[] }[];
}): string[];
