/**
 * `POST claim` (GH-1075 A2, spec §3.2): a device's guest progress (campaign, slots, coins as evidence, coupons, coin
 * entitlements) moves into the member's account once per device, and pays only the earn difference against the
 * LIFETIME record (`earn_lifetime`, A2-20): never the device id, never the device's balance. This is the main forgery
 * surface, so every figure the device sends is evidence, a ceiling or an ask, never an amount:
 *   - the earn table, with the 0 to 3 star clamp and world missions only, bounds what it can prove (925 in all);
 *   - the device's `coins.free` is only a CEILING on the net credit; `paid` is ignored;
 *   - coupon coins are capped per member (`CLAIM_COUPON_COINS_CAP`) and an id already in `coupon_use` credits 0;
 *   - carried entitlements are charged against the coins THIS claim credited, never the member's balance (§0.26).
 * Batch order (R2, R3): wallet, campaign or conflict slot, player slots, `device_claim`, `coupon_use`, the cap guards,
 * then the op insert. The wallet statement is always present, so its revision guard serialises two claims of one
 * member; the guards are the second line (`claim_cap` is the device guard, `cap` a slot guard).
 */
import {
  buyWithCoins,
  canonicalCampaign,
  canonicalSlot,
  claimEvidence,
  coinCost,
  couponGrant,
  earnDifference,
  emptyAccount,
  maxRecord,
  migrateRoar,
  parseSlot,
  parseWorld,
  raiseBy,
  spendable,
  storeInputFor,
  storeItems,
  MAX_COINS,
  type CampaignBody,
  type CoinAskWire,
  type InventoryItem,
  type RoarWallet,
  type SaveSlot,
  type SlotMetaView,
} from '@lions/economy';
import { coupons, world } from '@lions/data';
import type { D1Like, D1Stmt } from '../d1';
import { budgetedOp } from './budget';
import { campaignWrite, conflictSlot, digestOf, readCampaign, stateOf } from './campaign';
import { asRoar, capGuard, readWallet, receiptsOf, walletWrite, type JournalEntry } from './coin';
import { CAMPAIGN_MAX_BYTES, CLAIMS_PER_DAY, CLAIM_BODY_MAX, CLAIM_COUPON_COINS_CAP, DEVICE_CLAIMS_MAX, PLAYER_SLOTS, SLOT_NAME_MAX } from './config';
import { accountJson, readAccountBody } from './http';
import { validOpId } from './op';
import type { AccountCtx } from './routes';
import { requireSession, sessionJson } from './session';
import { slotCounts, validSlotName } from './slots';
import { bump, countToday } from '../rate-day';

type LedgerData = CampaignBody['ledger'];
const parsedWorld = parseWorld(world);
const utf8 = new TextEncoder();
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const MAX_SLOTS = 32;
const MAX_COUPONS = 16;
const ID_MAX = 128;
/** At most this many entitlement asks are priced in one claim (each ask re-derives the Stores' items). */
const ASKS_MAX = 48;
/** At most this many tiers of one track are asked for. */
const TIERS_MAX = 12;

interface ClaimIn {
  opId: string;
  deviceId: string;
  campaign: unknown;
  slots: { id: string; slot: unknown }[];
  wallet: unknown;
  coupons: string[];
}

/** Checked before anything is read (§0.42). */
function parseClaim(raw: unknown): ClaimIn | 'op_id' | 'body' {
  if (!isRec(raw) || !validOpId(raw.op_id)) return 'op_id';
  if (!validOpId(raw.device_id)) return 'body';
  if (!Array.isArray(raw.slots) || raw.slots.length > MAX_SLOTS) return 'body';
  if (!Array.isArray(raw.coupons) || raw.coupons.length > MAX_COUPONS) return 'body';
  const slots: ClaimIn['slots'] = [];
  for (const s of raw.slots as unknown[]) {
    if (!isRec(s) || typeof s.id !== 'string' || s.id === '' || s.id.length > ID_MAX) return 'body';
    slots.push({ id: s.id, slot: s.slot });
  }
  const ids: string[] = [];
  for (const c of raw.coupons as unknown[]) {
    if (typeof c !== 'string' || c.length > ID_MAX) return 'body';
    ids.push(c);
  }
  return { opId: raw.op_id, deviceId: raw.device_id, campaign: raw.campaign ?? null, slots, wallet: raw.wallet, coupons: ids };
}

/** A name the slot route would accept: control and format characters dropped, cut to `SLOT_NAME_MAX` code points. */
function cleanName(name: string): string {
  const kept = [...name.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '')].slice(0, SLOT_NAME_MAX).join('');
  return validSlotName(kept) ? kept : 'Save';
}

interface Mark {
  deviceId: string;
  /** The row to insert, or null when the slot is not stored. */
  item: InventoryItem;
  savedAt: number;
  insert: { id: string; name: string; build: string; text: string; bytes: number } | null;
}

/** The asks a device wallet carries, in its receipt order, then what no receipt names (units by id, then tracks). */
function askOrder(device: RoarWallet, knownUnits: ReadonlySet<string>, trackLen: ReadonlyMap<string, number>): CoinAskWire[] {
  const out: CoinAskWire[] = [];
  const seen = new Set<string>();
  const push = (a: CoinAskWire): void => {
    const key = a.item === 'unit' ? `u:${a.unitId}` : `t:${a.unitId}:${a.track}:${a.tier}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(a);
    }
  };
  const unit = (id: string): void => {
    if (knownUnits.has(id) && device.entitlements.units[id] !== undefined) push({ item: 'unit', unitId: id });
  };
  const track = (unitId: string, name: string, upTo: number): void => {
    const held = device.entitlements.upgrades[unitId]?.[name]?.tier ?? 0;
    const len = trackLen.get(`${unitId}\u0000${name}`);
    if (len === undefined) return;
    for (let t = 1; t <= Math.min(held, upTo, len, TIERS_MAX); t++) push({ item: 'tier', unitId, track: name, tier: t });
  };
  for (const r of device.receipts) {
    if (r.kind === 'unit') unit(r.unitId);
    else if (r.kind === 'tier') track(r.unitId, r.track, r.tier);
  }
  for (const id of Object.keys(device.entitlements.units).sort()) unit(id);
  for (const id of Object.keys(device.entitlements.upgrades).sort()) {
    for (const name of Object.keys(device.entitlements.upgrades[id] ?? {}).sort()) track(id, name, TIERS_MAX);
  }
  return out.slice(0, ASKS_MAX);
}

const owns = (w: RoarWallet, a: CoinAskWire): boolean =>
  a.item === 'unit' ? w.entitlements.units[a.unitId] !== undefined : (w.entitlements.upgrades[a.unitId]?.[a.track]?.tier ?? 0) >= a.tier;

export async function claim(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const raw = await readAccountBody<unknown>(ctx.req, CLAIM_BODY_MAX);
  if (raw === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  const body = parseClaim(raw);
  if (typeof body === 'string') return sessionJson(400, { error: body }, setCookie);
  const memberId = session.memberId;
  const table = ctx.deps.coupons ?? coupons;

  const out = await budgetedOp(
    ctx,
    {
      memberId,
      opId: body.opId,
      kind: 'claim',
      deviceCapError: 'claim_cap',
      // §0.48: the claim budget is read first and bumped only after the member's day budget passes.
      extra: {
        check: async (d: D1Like) => (await countToday(d, 'acct-claim', memberId, ctx.now)) < CLAIMS_PER_DAY,
        bump: async (d: D1Like) => {
          await bump(d, 'acct-claim', memberId, ctx.now, CLAIMS_PER_DAY);
        },
      },
    },
    async () => {
      // 1. This device claimed before: its stored result, nothing else.
      const done = await db.prepare('SELECT result FROM device_claim WHERE member_id = ?1 AND device_id = ?2').bind(memberId, body.deviceId).first<{ result: string }>();
      if (done !== null) return { statements: [], status: 200, response: JSON.parse(done.result) as unknown };
      const devices = (await db.prepare('SELECT COUNT(*) AS n FROM device_claim WHERE member_id = ?1').bind(memberId).first<{ n: number }>())?.n ?? 0;
      if (devices >= DEVICE_CLAIMS_MAX) return { statements: [], status: 409, response: { error: 'claim_cap' } };

      const wallet = await readWallet(db, memberId);
      const serverCamp = await readCampaign(db, memberId);
      const receipts = await receiptsOf(db, memberId);
      const device = migrateRoar(body.wallet);

      // The device's campaign, canonical; a malformed or oversized one is rejected and never stored.
      let sentBody: CampaignBody | null = null;
      let sentText = '';
      let campaignItem: InventoryItem | null = null;
      if (body.campaign !== null) {
        const c = body.campaign;
        if (!isRec(c) || !isRec(c.ledger) || !isRec(c.brigade) || typeof c.tutorialDone !== 'boolean') {
          campaignItem = { deviceId: 'campaign', status: 'rejected', reason: 'invalid' };
        } else {
          try {
            sentText = canonicalCampaign({ ledger: c.ledger as LedgerData, brigade: c.brigade as unknown as CampaignBody['brigade'], tutorialDone: c.tutorialDone });
            sentBody = JSON.parse(sentText) as CampaignBody;
          } catch {
            campaignItem = { deviceId: 'campaign', status: 'rejected', reason: 'invalid' };
          }
        }
      }

      // The device's slots: parsed, canonical, stored under new ids by the server (§0.43).
      const marks: Mark[] = [];
      const ledgers: LedgerData[] = sentBody === null ? [] : [sentBody.ledger];
      for (const s of body.slots) {
        let slot: SaveSlot;
        try {
          slot = parseSlot(JSON.stringify(s.slot));
        } catch {
          marks.push({ deviceId: s.id, item: { deviceId: s.id, status: 'rejected', reason: 'invalid' }, savedAt: 0, insert: null });
          continue;
        }
        ledgers.push(slot.ledger);
        const id = crypto.randomUUID();
        const name = cleanName(slot.name);
        const stored: SaveSlot = { ...slot, id, name };
        const text = JSON.stringify(stored);
        const bytes = utf8.encode(text).length;
        if (bytes > CAMPAIGN_MAX_BYTES) {
          marks.push({ deviceId: s.id, item: { deviceId: s.id, status: 'rejected', reason: 'size' }, savedAt: slot.savedAt, insert: null });
          continue;
        }
        marks.push({
          deviceId: s.id,
          item: { deviceId: s.id, status: 'stored', serverId: id, digest: await digestOf(canonicalSlot(stored)) },
          savedAt: slot.savedAt,
          insert: { id, name, build: slot.build, text, bytes },
        });
      }
      // Newest first take the room; the rest are `rejected: cap`. Nothing already on the server is evicted.
      const room = Math.max(0, PLAYER_SLOTS - (await slotCounts(db, memberId)).player);
      const storable = marks.filter((m) => m.insert !== null).map((m, i) => ({ m, i })).sort((a, b) => b.m.savedAt - a.m.savedAt || a.i - b.i);
      storable.slice(room).forEach(({ m }) => {
        m.item = { deviceId: m.deviceId, status: 'rejected', reason: 'cap' };
        m.insert = null;
      });

      // 2. The earn difference, against the lifetime record.
      const evidence = claimEvidence({ wallet: device, ledgers, world: parsedWorld });
      const d = earnDifference(wallet.earnLifetime, evidence, parsedWorld);
      const earnLifetime = maxRecord(d.record, wallet.earnLifetime);
      const earn = raiseBy(wallet.earn, d.raised);

      // 3. Coupons, de-duplicated; an id off the table is ignored and not echoed.
      const used = new Set((await db.prepare('SELECT coupon_id FROM coupon_use WHERE member_id = ?1').bind(memberId).all<{ coupon_id: string }>()).results.map((r) => r.coupon_id));
      let capUsed =
        (
          await db
            .prepare("SELECT COALESCE(SUM(json_extract(detail, '$.couponCoins')), 0) AS n FROM coin_journal WHERE member_id = ?1 AND kind IN ('claim', 'backfill')")
            .bind(memberId)
            .first<{ n: number }>()
        )?.n ?? 0;
      const couponRows: { id: string; credited: number; capped: boolean }[] = [];
      const creditOnly: string[] = [];
      let couponCoins = 0;
      for (const id of [...new Set(body.coupons)]) {
        const entry = table.find((c) => c.id === id);
        if (entry === undefined) continue;
        if (used.has(id)) {
          couponRows.push({ id, credited: 0, capped: false });
          continue;
        }
        const grant = couponGrant(entry);
        if (grant === 0) {
          // Credits only: they arrived inside the trusted brigade, so the real code must not pay them again.
          couponRows.push({ id, credited: 0, capped: false });
          creditOnly.push(id);
          continue;
        }
        const credited = Math.max(0, Math.min(grant, CLAIM_COUPON_COINS_CAP - capUsed));
        capUsed += credited;
        couponCoins += credited;
        couponRows.push({ id, credited, capped: credited < grant });
      }

      // 4. Entitlements, charged against this claim's own coins on a scratch wallet.
      const credits = d.coins + couponCoins;
      const ledger = sentBody?.ledger ?? serverCamp?.body.ledger ?? {};
      const brigade = sentBody?.brigade ?? serverCamp?.body.brigade ?? emptyAccount();
      let scratch: RoarWallet = { ...asRoar(wallet, []), coins: { free: credits, paid: 0 } };
      const input0 = storeInputFor({ ledger, brigade, roar: scratch });
      const trackLen = new Map(storeItems(input0).tiers.map((t) => [`${t.unitId}\u0000${t.track}`, t.length] as const));
      const asks = askOrder(device, new Set(input0.units.map((u) => u.id)), trackLen);
      const carried: CoinAskWire[] = [];
      const notCarried: { ask: CoinAskWire; reason: 'coins' | 'closed' | 'owned' }[] = [];
      const entries: JournalEntry[] = [];
      let charged = 0;
      for (const ask of asks) {
        if (owns(scratch, ask)) {
          notCarried.push({ ask, reason: 'owned' });
          continue;
        }
        const input = storeInputFor({ ledger, brigade, roar: scratch });
        const coinAsk = ask.item === 'unit' ? ({ kind: 'unit', unitId: ask.unitId } as const) : ({ kind: 'tier', unitId: ask.unitId, track: ask.track, tier: ask.tier } as const);
        const bought = buyWithCoins(input, scratch, coinAsk, ctx.now);
        if (!bought.ok) {
          const items = storeItems(input);
          const item =
            coinAsk.kind === 'unit' ? items.units.find((u) => u.id === coinAsk.unitId) : items.tiers.find((t) => t.unitId === coinAsk.unitId && t.track === coinAsk.track && t.next?.tier === coinAsk.tier);
          const cost = item === undefined ? null : coinCost(item);
          notCarried.push({ ask, reason: cost !== null && cost > 0 && spendable(scratch) < cost ? 'coins' : 'closed' });
          continue;
        }
        const price = scratch.coins.free - bought.account.coins.free;
        charged += price;
        scratch = bought.account;
        carried.push(ask);
        entries.push({
          kind: coinAsk.kind,
          delta: -price,
          receipt: scratch.receipts[scratch.receipts.length - 1] ?? null,
          detail: coinAsk.kind === 'unit' ? { unitId: coinAsk.unitId } : { unitId: coinAsk.unitId, track: coinAsk.track, tier: coinAsk.tier },
          opId: body.opId,
          at: ctx.now,
        });
      }

      // 5. The net credit: the device's own balance is a CEILING, never an amount; the wallet range is another.
      const net = Math.max(0, Math.min(device.coins.free, credits - charged, MAX_COINS - wallet.free));
      const claimEntry: JournalEntry = {
        kind: devices === 0 ? 'backfill' : 'claim',
        delta: net + charged,
        receipt: null,
        detail: { earned: d.coins, couponCoins, coupons: couponRows, ceilingCut: credits - charged - net },
        opId: body.opId,
        at: ctx.now,
      };
      const after: RoarWallet = { ...asRoar(wallet, receipts), coins: { free: wallet.free + net, paid: 0 }, entitlements: scratch.entitlements, earn };
      const statements: D1Stmt[] = [...walletWrite(db, wallet, { roar: after, earnLifetime }, [claimEntry, ...entries])];
      const guards: D1Stmt[] = [];

      // 6. The campaign: active when the member has none, else a `claim` system slot, else held.
      if (sentBody !== null) {
        const bytes = utf8.encode(sentText).length;
        if (bytes > CAMPAIGN_MAX_BYTES) campaignItem = { deviceId: 'campaign', status: 'rejected', reason: 'size' };
        else if (serverCamp === null) {
          statements.push(...(await campaignWrite(db, memberId, null, sentBody, ctx.now)));
          campaignItem = { deviceId: 'campaign', status: 'stored', serverId: 'campaign', digest: await digestOf(sentText) };
        } else {
          const c = await conflictSlot(db, memberId, sentBody, ctx.now, 'claim');
          if ('slot' in c.answer) {
            statements.push(...c.statements.slice(0, -1));
            guards.push(...c.statements.slice(-1));
            const slot: SlotMetaView = c.answer.slot;
            campaignItem = { deviceId: 'campaign', status: 'stored', serverId: slot.id, digest: await digestOf(sentText) };
          } else campaignItem = { deviceId: 'campaign', status: 'rejected', reason: 'cap' };
        }
      }

      // Slots, in the device's order of arrival (the room was decided newest first above).
      let stored = 0;
      for (const m of marks) {
        if (m.insert === null) continue;
        stored++;
        statements.push(
          db
            .prepare("INSERT INTO save_slot (member_id, slot_id, name, saved_at, build, origin, body, bytes) VALUES (?1, ?2, ?3, ?4, ?5, 'player', ?6, ?7)")
            .bind(memberId, m.insert.id, m.insert.name, ctx.now, m.insert.build, m.insert.text, m.insert.bytes),
        );
      }
      if (stored > 0) guards.push(capGuard(db, memberId, "SELECT COUNT(*) FROM save_slot WHERE member_id = ?1 AND origin = 'player'", PLAYER_SLOTS));

      const result = {
        coins: net,
        earned: d.coins,
        coupons: couponRows,
        carried,
        notCarried,
        campaign: campaignItem,
        slots: marks.map((m) => m.item),
      };
      statements.push(db.prepare('INSERT INTO device_claim (member_id, device_id, at, result) VALUES (?1, ?2, ?3, ?4)').bind(memberId, body.deviceId, ctx.now, JSON.stringify(result)));
      for (const id of creditOnly) statements.push(db.prepare('INSERT OR IGNORE INTO coupon_use (member_id, coupon_id, at) VALUES (?1, ?2, ?3)').bind(memberId, id, ctx.now));
      statements.push(...guards);
      // The device guard trips a different column from the slot guards, so `claim_cap` means the device cap alone.
      statements.push(capGuard(db, memberId, 'SELECT COUNT(*) FROM device_claim WHERE member_id = ?1', DEVICE_CLAIMS_MAX, 'created_at'));
      return { statements, status: 200, response: result };
    },
  );
  // `state` is read fresh after the batch, also for a repeated device or a replayed op id (the stored answer has none).
  if (out.status === 200 && isRec(out.body)) return sessionJson(200, { ...out.body, state: await stateOf(db, memberId) }, setCookie);
  return sessionJson(out.status, out.body, setCookie);
}
