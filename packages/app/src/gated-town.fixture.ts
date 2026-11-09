/**
 * A world.json with a GATED town listed first in Naharin (GH-912 G1): the shape
 * Ein Qasab takes once it ships, built from the real file so every test walks the
 * real regions. It is a fixture so G1 does not wait on the town's content; if the
 * real file already carries `ein_qasab`, it is returned as shipped.
 */
import worldJson from '../../../data/campaign/world.json';

interface RawTown {
  id: string;
  name: string;
  at: number[];
  missions: string[];
  unlock?: { after_mission?: string; roe_rating_min?: number };
}
interface RawWorld {
  regions: { id: string; towns: RawTown[] }[];
}

export const EIN_QASAB_GATE = 'wadi_halam_3_counterraid';

export const gatedWorldJson = (): unknown => {
  const w = structuredClone(worldJson) as unknown as RawWorld;
  const naharin = w.regions.find((r) => r.id === 'naharin');
  if (!naharin) throw new Error('fixture: no naharin region in world.json');
  if (!naharin.towns.some((t) => t.id === 'ein_qasab')) {
    naharin.towns.unshift({
      id: 'ein_qasab',
      name: 'Ein Qasab',
      at: [804.0, 461.7],
      missions: ['ein_qasab_1_recon', 'ein_qasab_2_foothold', 'ein_qasab_3_buildup'],
      unlock: { after_mission: EIN_QASAB_GATE },
    });
  }
  return w;
};

/** Every Marj and Sur mission completed: the ledger that has just cleared Umm Zeitoun IV. */
export const ledgerBeforeNaharin = (): { 'campaign.completed_missions': string[] } => {
  const w = worldJson as unknown as RawWorld;
  return {
    'campaign.completed_missions': w.regions
      .filter((r) => r.id !== 'naharin')
      .flatMap((r) => r.towns.flatMap((t) => t.missions)),
  };
};
