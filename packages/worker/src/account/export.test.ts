import { describe, expect, it } from 'vitest';
import { SEED_EARN, SEED_PUBLIC_ID, accountHarness, seedFullMember } from './test-kit';

const NOW = 20_000 * 86_400_000 + 3_600_000;

describe('GET export', () => {
  it('needs a session', async () => {
    const h = accountHarness({ now: NOW });
    expect((await h.call('GET', '/api/account/export')).status).toBe(401);
  });

  it('works while closed and is an attachment (A4-3, A1 half)', async () => {
    const h = accountHarness({ now: NOW });
    const { cookie } = await seedFullMember(h.db, NOW);
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM flags").first<{ n: number }>())?.n).toBe(0);
    const res = await h.call('GET', '/api/account/export', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="roaring-lions-account.json"');
    const body = (await res.json()) as { tables: Record<string, Record<string, unknown>[]> };
    expect(body.tables.member?.[0]?.public_id).toBe(SEED_PUBLIC_ID);
    expect(body.tables.match_seat?.length).toBe(2);
  });

  it('the profile export carries the avatar columns (GH-1075 P4)', async () => {
    const h = accountHarness({ now: NOW });
    const { cookie } = await seedFullMember(h.db, NOW);
    const body = (await (await h.call('GET', '/api/account/export', { cookie })).json()) as { tables: Record<string, Record<string, unknown>[]> };
    expect(body.tables.profile?.[0]).toMatchObject({ avatar: 'p:crest-claw', avatar_rev: 2 });
  });

  it('names no secret', async () => {
    const h = accountHarness({ now: NOW });
    const { cookie } = await seedFullMember(h.db, NOW);
    const hashes = (await h.db.prepare('SELECT token_hash FROM session').all<{ token_hash: string }>()).results.map((r) => r.token_hash);
    expect(hashes.length).toBeGreaterThan(0);
    const text = await (await h.call('GET', '/api/account/export', { cookie })).text();
    for (const t of hashes) expect(text).not.toContain(t);
    expect(text).not.toContain('token_hash');
    expect(text).not.toContain('public_key');
    expect(text).not.toContain('code-hash'); // the recovery code's hash is the identity subject
    expect(text).not.toContain('cred-1'); // a passkey's credential id
    expect(text).not.toMatch(/0[aA]0[bB]0[cC]0[dD]|\[10,11,12,13\]/); // the key bytes, hex or array
    expect(text).toContain('76561197960287930'); // the SteamID, in full
    expect(text).toContain(SEED_EARN); // the player's own wallet
    expect(text).not.toContain('NNNN2222'); // another member
    expect(text).not.toContain('uh1'); // member.user_handle (WebAuthn user.id)
    expect(text).not.toContain('"id":"m1"'); // the internal member id
    const sessions = ((JSON.parse(text) as { tables: Record<string, Record<string, unknown>[]> }).tables.session ?? []);
    expect(sessions[0]).toEqual({ created_day: Math.floor(NOW / 86_400_000), last_seen_day: Math.floor(NOW / 86_400_000) });
  });
});
