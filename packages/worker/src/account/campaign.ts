/**
 * The campaign's one writer and the state read (GH-1075 A2). Like the wallet (`coin.ts`), the campaign row is
 * guarded by the revision a write read, through `campaign_state`'s own CHECK (§0.6, §0.34): a stale write sets
 * `bytes = 262145`, the CHECK fails, and D1 rolls the batch back. In a batch the order is wallet, campaign, slots,
 * the cap guards, then the op insert (`withOp` appends it).
 */
import {
  canonicalCampaign,
  SAVE_VERSION,
  type CampaignBody,
  type CampaignView,
  type ConflictAnswer,
  type SaveSlot,
  type ServerState,
  type SlotMetaView,
} from '@lions/economy';
import type { D1Like, D1Stmt } from '../d1';
import { budgetedOp } from './budget';
import { CAMPAIGN_BODY_MAX, CAMPAIGN_MAX_BYTES, SYSTEM_SLOTS } from './config';
import { capGuard, walletView } from './coin';
import { accountJson, readAccountBody } from './http';
import { OpReject, validOpId } from './op';
import type { AccountCtx } from './routes';
import { requireSession, sessionJson } from './session';
import { slotCounts, slotMetas } from './slots';

const utf8 = new TextEncoder();

/** Lowercase hex SHA-256 of the text's UTF-8, through Web Crypto (never the economy's pure-JS `sha256Hex`, §0.13). */
export async function digestOf(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface CampaignSql {
  ledger: string;
  brigade: string;
  tutorial_done: number;
  revision: number;
}

export interface CampaignRead {
  revision: number;
  body: CampaignBody;
  /** `canonicalCampaign(body)`: the string the digest covers. */
  text: string;
}

export async function readCampaign(db: D1Like, memberId: string): Promise<CampaignRead | null> {
  const r = await db
    .prepare('SELECT ledger, brigade, tutorial_done, revision FROM campaign_state WHERE member_id = ?1')
    .bind(memberId)
    .first<CampaignSql>();
  if (r === null) return null;
  const body = { ledger: JSON.parse(r.ledger), brigade: JSON.parse(r.brigade), tutorialDone: r.tutorial_done === 1 } as CampaignBody;
  return { revision: r.revision, body, text: canonicalCampaign(body) };
}

/** The wire view of a campaign read: its canonical body, revision and digest. */
export async function campaignViewOf(c: CampaignRead): Promise<CampaignView> {
  const body = JSON.parse(c.text) as CampaignBody;
  return { ...body, revision: c.revision, digest: await digestOf(c.text) };
}

/**
 * The statement that writes `body`. `readRevision` null means no row was read: the insert writes revision 1, and a
 * lost race (a row now exists) fails the CHECK through `ON CONFLICT ... SET bytes = 262145` instead of a UNIQUE
 * (§0.34). Otherwise it is the guarded UPDATE. Refuses a canonical text over 262,144 bytes with 413.
 */
export async function campaignWrite(db: D1Like, memberId: string, readRevision: number | null, body: CampaignBody, now: number): Promise<D1Stmt[]> {
  const text = canonicalCampaign(body);
  const bytes = utf8.encode(text).length;
  if (bytes > CAMPAIGN_MAX_BYTES) throw new OpReject(413, { error: 'too_large' });
  const c = JSON.parse(text) as CampaignBody;
  const ledger = JSON.stringify(c.ledger);
  const brigade = JSON.stringify(c.brigade);
  const tutorial = c.tutorialDone ? 1 : 0;
  if (readRevision === null) {
    return [
      db
        .prepare(
          `INSERT INTO campaign_state (member_id, ledger, brigade, tutorial_done, bytes, revision, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)
           ON CONFLICT (member_id) DO UPDATE SET bytes = 262145`,
        )
        .bind(memberId, ledger, brigade, tutorial, bytes, now),
    ];
  }
  return [
    db
      .prepare(
        `UPDATE campaign_state SET ledger = ?3, brigade = ?4, tutorial_done = ?5,
           bytes = CASE WHEN revision = ?2 THEN ?6 ELSE 262145 END, updated_at = ?7, revision = revision + 1
         WHERE member_id = ?1`,
      )
      .bind(memberId, readRevision, ledger, brigade, tutorial, bytes, now),
  ];
}

/**
 * A campaign the server cannot take (a stale write, a claim's older campaign) is kept as a system slot, unless
 * `SYSTEM_SLOTS` of them exist already: then `{ held: true }` and no statement, and the device keeps the body.
 * The slot insert comes with the cap guard (R3), so a caller cannot forget it: two parallel requests that both
 * read 3 system slots cannot both add the fourth and fifth.
 */
export async function conflictSlot(
  db: D1Like,
  memberId: string,
  body: CampaignBody,
  now: number,
  label: 'conflict' | 'claim',
): Promise<{ statements: D1Stmt[]; answer: ConflictAnswer }> {
  if ((await slotCounts(db, memberId)).system >= SYSTEM_SLOTS) return { statements: [], answer: { held: true } };
  const id = crypto.randomUUID();
  const canon = JSON.parse(canonicalCampaign(body)) as CampaignBody;
  const slot: SaveSlot = {
    version: SAVE_VERSION,
    id,
    name: label,
    savedAt: now,
    build: 'server',
    ledger: canon.ledger,
    account: canon.brigade,
    tutorialDone: canon.tutorialDone,
  };
  const text = JSON.stringify(slot);
  const bytes = utf8.encode(text).length;
  // The slot wraps the campaign in a few more bytes than its canonical text: at the very cap it will not fit.
  if (bytes > CAMPAIGN_MAX_BYTES) return { statements: [], answer: { held: true } };
  const meta: SlotMetaView = { id, name: label, savedAt: now, build: slot.build, origin: label, bytes };
  return {
    statements: [
      db
        .prepare('INSERT INTO save_slot (member_id, slot_id, name, saved_at, build, origin, body, bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
        .bind(memberId, id, label, now, slot.build, label, text, bytes),
      capGuard(db, memberId, "SELECT COUNT(*) FROM save_slot WHERE member_id = ?1 AND origin <> 'player'", SYSTEM_SLOTS),
    ],
    answer: { slot: meta },
  };
}

export async function stateOf(db: D1Like, memberId: string): Promise<ServerState> {
  const c = await readCampaign(db, memberId);
  return {
    campaign: c === null ? null : await campaignViewOf(c),
    wallet: await walletView(db, memberId),
    slots: await slotMetas(db, memberId),
  };
}

export async function getState(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  return sessionJson(200, await stateOf(db, got.session.memberId), got.setCookie);
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `PUT campaign` (§0.34, §0.33). A `base` equal to the revision read writes (`base: 0` is "no row yet"). A stale one
 * answers 409 `stale` with the server's campaign and `conflictSlot`'s answer; the conflict slot rides in the SAME
 * batch as the op, so a retry of the op id replays the stored 409 and never stores a second slot. Batch order:
 * campaign, slot, cap guard, op (the guard is `conflictSlot`'s last statement).
 */
export async function putCampaign(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const raw = await readAccountBody<unknown>(ctx.req, CAMPAIGN_BODY_MAX);
  if (raw === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  if (!isRec(raw) || !validOpId(raw.op_id)) return sessionJson(400, { error: 'op_id' }, setCookie);
  const base = raw.base;
  if (typeof base !== 'number' || !Number.isInteger(base) || base < 0 || !isRec(raw.ledger) || !isRec(raw.brigade) || typeof raw.tutorialDone !== 'boolean') {
    return sessionJson(400, { error: 'body' }, setCookie);
  }
  const sent: CampaignBody = { ledger: raw.ledger as CampaignBody['ledger'], brigade: raw.brigade as unknown as CampaignBody['brigade'], tutorialDone: raw.tutorialDone };
  let sentText: string;
  try {
    sentText = canonicalCampaign(sent);
  } catch {
    return sessionJson(400, { error: 'body' }, setCookie);
  }
  const memberId = session.memberId;
  const out = await budgetedOp(ctx, { memberId, opId: raw.op_id, kind: 'campaign.put' }, async () => {
    const camp = await readCampaign(db, memberId);
    const expected = camp?.revision ?? 0;
    if (base === expected) {
      const statements = await campaignWrite(db, memberId, camp === null ? null : camp.revision, sent, ctx.now);
      const view: CampaignView = { ...(JSON.parse(sentText) as CampaignBody), revision: expected + 1, digest: await digestOf(sentText) };
      return { statements, status: 200, response: { campaign: view } };
    }
    const c = await conflictSlot(db, memberId, sent, ctx.now, 'conflict');
    return {
      statements: c.statements,
      status: 409,
      response: { error: 'stale', campaign: camp === null ? null : await campaignViewOf(camp), conflict: c.answer },
    };
  });
  return sessionJson(out.status, out.body, setCookie);
}
