/** Shared by `branch-sticky.test.ts` (switch open) and `branch-sticky-closed.test.ts` (as shipped): a member, a campaign PUT, and a victory that carries a campaign. */
import { emptyAccount, legacyOffer, migrateAccount, parseWorld, worldMissionIds, type BrigadeAccount, type CampaignBody, type LegacyOffer } from '@lions/economy';
import { world } from '@lions/data';
import { asRoar, readWallet, receiptsOf } from './coin';
import { accountHarness, seedWalletMember, setWalletEntitlements } from './test-kit';

export const DAY = 86_400_000;
export const T0 = 20_000 * DAY + 3_600_000;
export const [M1 = ''] = worldMissionIds(parseWorld(world));
let seq = 1;
export const op = (): string => `${String(seq++).padStart(8, '0')}-9999-4999-8999-999999999999`;

export const setup = () => accountHarness({ now: T0 });
export type H = ReturnType<typeof setup>;
export const member = async (h: H): Promise<string> => (await seedWalletMember(h.db, 'm1', T0)).cookie;

/** A campaign body whose brigade holds the Lavi's firepower at tier 3, with `extra` (picks, legacy) beside it. */
export const body = (extra: Partial<BrigadeAccount> = {}): CampaignBody => ({
  ledger: {},
  brigade: { ...emptyAccount(), upgrades: { mbt_lavi: { firepower: 3 } }, ...extra },
  tutorialDone: false,
});
export const put = (h: H, cookie: string, base: number, b: CampaignBody) => h.call('PUT', '/api/account/campaign', { cookie, body: { op_id: op(), base, ...b } });
export const victory = (h: H, cookie: string, base: number, b: CampaignBody) =>
  h.call('POST', '/api/account/victory', { cookie, body: { op_id: op(), missionId: M1, stars: 1, start: null, base, campaign: b } });

export const stored = async (h: H): Promise<{ upgrades: Record<string, Record<string, number>>; picks?: Record<string, Record<string, number>>; legacy?: Record<string, Record<string, true>> }> =>
  JSON.parse(((await h.db.prepare('SELECT brigade FROM campaign_state').first<{ brigade: string }>()) as { brigade: string }).brigade);
export const revision = async (h: H): Promise<number> => ((await h.db.prepare('SELECT revision FROM campaign_state').first<{ revision: number }>()) as { revision: number }).revision;

/** GH-1384 Q11: the member's coin wallet holding the Lavi's firepower as `firepower` (a literal entitlement; `migrateRoar` settles it on read). */
export const walletHolds = (h: H, firepower: object): Promise<void> =>
  setWalletEntitlements(h.db, 'm1', { units: { mbt_lavi: { free: true } }, upgrades: { mbt_lavi: { firepower } } });
/** The wallet row's raw Lavi firepower entitlement, as stored. */
export const walletFirepower = async (h: H): Promise<unknown> =>
  (JSON.parse(((await h.db.prepare('SELECT entitlements AS e FROM wallet').first<{ e: string }>()) as { e: string }).e) as { upgrades: { mbt_lavi?: { firepower?: unknown } } }).upgrades.mbt_lavi?.firepower;
/** What the one-time choice offers NOW, read the way the `branch/switch` and `branch/return` routes read both stores. */
export const offerNow = async (h: H): Promise<LegacyOffer> =>
  legacyOffer(migrateAccount(await stored(h) as unknown as BrigadeAccount), asRoar(await readWallet(h.db, 'm1'), await receiptsOf(h.db, 'm1')), 'mbt_lavi', 'firepower');
