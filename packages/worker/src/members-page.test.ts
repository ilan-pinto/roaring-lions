/**
 * GH-695 S5: the /stats/members page. The page script runs in jsdom with its `fetch` wired to the real `handleStats`
 * (the real admin gate, the real coin route, a real migrated accounts database), so a header, a body field or a revision
 * the page forgets is refused by the server and the test reads that refusal. Each test names its one-line mutation in the
 * commit message.
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { FEEDBACK_HTML } from './feedback-page';
import { MEMBERS_HTML, MEMBERS_SCRIPT } from './members-page';
import { STATS_HTML } from './stats-page';
import { handleStats } from './stats';
import { NOW, PASSWORD, adminKit, addMember, gameCookie } from './admin/kit';
import { sessionCookieHeader } from './auth';
import { TEST_ORIGIN } from './account/test-kit';

const ADMIN = { id: 'adm', publicId: 'ADMQ0001', name: 'The Lead' };
const HOSTILE = '<img src=x onerror=alert(1)>Sand';

interface Sent {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

async function boot(opts: { admin?: boolean; open?: boolean; game?: 'admin' | 'player' | 'none'; loseReply?: (s: Sent) => boolean; slow?: (s: Sent, n: number) => number } = {}) {
  const k = adminKit();
  await addMember(k.db, ADMIN);
  await addMember(k.db, { id: 'm1', publicId: 'K7Q2ABCD', name: HOSTILE, free: 500, walletRevision: 4, brigade: { version: 1, balance: 3180, earned_total: 3180, grants: [{ source: 'earned', amount: 3180, missionId: 'x', at: 1 }] }, campaignRevision: 7, identities: [['google', 'SECRET-GOOGLE-SUB-777']] });
  await addMember(k.db, { id: 'm2', publicId: 'HAMS0002', name: 'Hamsin Six', free: 925 });
  if (opts.admin !== false) await k.db.prepare("INSERT INTO admin_member VALUES ('adm', 1)").run();
  if (opts.open !== false) await k.db.prepare("INSERT INTO flags VALUES ('admin', 'open', 1)").run();
  const stats = (await sessionCookieHeader(PASSWORD, NOW)).split(';')[0] ?? '';
  const game = opts.game === 'none' ? '' : await gameCookie(k.db, opts.game === 'player' ? 'm2' : 'adm');
  const sent: Sent[] = [];
  const env = { ...k.env, STATS_PASSWORD: PASSWORD };
  const bridge = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    // What a browser adds to a same-origin fetch: the cookies, and an Origin on a POST. Nothing else is free.
    const headers = new Headers(init.headers ?? {});
    headers.set('cookie', [stats, game].filter((c) => c !== '').join('; '));
    if (method !== 'GET') headers.set('origin', TEST_ORIGIN);
    const rec: Sent = { method, path: url, headers: Object.fromEntries(headers), body: init.body === undefined ? undefined : JSON.parse(init.body) };
    sent.push(rec);
    const res = await handleStats(new Request(TEST_ORIGIN + url, { method, headers, body: init.body }), env, NOW);
    if (opts.loseReply?.(rec) === true) throw new TypeError('network lost the reply');
    const ms = opts.slow?.(rec, sent.length) ?? 0;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    return res;
  };
  const dom = new JSDOM(MEMBERS_HTML, {
    runScripts: 'dangerously',
    url: TEST_ORIGIN + '/stats/members',
    beforeParse(w) {
      (w as unknown as { fetch: unknown }).fetch = bridge;
      w.confirm = () => true;
    },
  });
  const w = dom.window;
  const $ = (id: string) => w.document.getElementById(id) as HTMLElement & HTMLInputElement & HTMLButtonElement;
  const waitFor = async (f: () => boolean, what: string) => {
    for (let i = 0; i < 400; i++) {
      if (f()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('timed out waiting for ' + what + '\n' + w.document.body.textContent?.replace(/\s+/g, ' ').slice(0, 600));
  };
  const type = (id: string, v: string) => {
    $(id).value = v;
    $(id).dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const click = (el: Element) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await waitFor(() => $('sw-chip').textContent !== 'Admin writes: …', 'whoami');
  const openCard = async (q = 'K7Q2ABCD') => {
    type('q', q);
    $('find-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => w.document.querySelector('#results-body button') !== null, 'results');
    click(w.document.querySelector('#results-body button')!);
    await waitFor(() => !$('member').hidden && $('journal-body').children.length > 0, 'card');
  };
  const dbOne = async <T>(sql: string) => (await k.db.prepare(sql).first<T>()) as T;
  return { k, w, $, sent, waitFor, type, click, openCard, dbOne, game, dom };
}

describe('the route and the links (S5, D4)', () => {
  it('serves the page to a stats session with the triage page CSP, and the login page to anyone else', async () => {
    const k = adminKit();
    const ok = await k.call('GET', '/stats/members');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-security-policy')).toBe(
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    expect(ok.headers.get('cache-control')).toContain('no-store');
    expect(await ok.text()).toBe(MEMBERS_HTML);
    const anon = await k.call('GET', '/stats/members', { stats: false });
    expect(await anon.text()).not.toContain('id="find-form"');
    expect(await (await k.call('GET', '/stats/members/x')).text()).not.toContain('id="find-form"');
  });

  it('/stats and /stats/feedback link to Members, and the page marks itself current', () => {
    expect(STATS_HTML).toContain('<a href="/stats/members">Members</a>');
    expect(FEEDBACK_HTML).toContain('<a href="/stats/members">Members</a>');
    expect(MEMBERS_HTML).toContain('<a href="/stats/members" aria-current="page">Members</a>');
    expect(MEMBERS_HTML).toContain('<a href="/stats">Players</a><a href="/stats/feedback">Feedback</a>');
  });
});

describe('what the page source may contain (S5, D2.6, D14)', () => {
  it('never builds markup from data, loads nothing from elsewhere and mentions no secret-bearing name', () => {
    for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'localStorage']) expect(MEMBERS_SCRIPT, bad).not.toContain(bad);
    expect(MEMBERS_HTML).not.toMatch(/https?:\/\//);
    expect(MEMBERS_HTML).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(MEMBERS_SCRIPT).not.toMatch(/\bsubject\b|\bid_hash\b|document\.cookie/);
  });
});

describe('who sees what (S5, D1, D3)', () => {
  it('an admin on an open switch gets the Close button, Me, and a form that can be sent', async () => {
    const t = await boot();
    expect(t.$('sw-chip').textContent).toBe('Admin writes: open');
    expect(t.$('sw-close').hidden).toBe(false);
    expect(t.$('me').disabled).toBe(false);
    expect(t.$('sw-who').textContent).toBe('Signed in as admin ADMQ0001');
    expect(t.sent.map((s) => s.path)).toEqual(['/stats/api/members/whoami']);
  });

  it('with no admin row the form cannot be reviewed, and with the switch closed the chip says so', async () => {
    const t = await boot({ admin: false });
    expect(t.$('sw-close').hidden).toBe(true);
    await t.openCard();
    t.type('amt', '5');
    t.type('why', 'a perfectly good reason');
    expect(t.$('review').disabled).toBe(true);
    expect(t.$('hint').textContent).toContain('signed-in admin');
    const c = await boot({ open: false });
    expect(c.$('sw-chip').textContent).toBe('Admin writes: closed');
    expect(c.$('sw-chip').className).toContain('bad');
    expect(c.$('sw-close').hidden).toBe(true);
    await c.openCard();
    c.type('amt', '5');
    c.type('why', 'a perfectly good reason');
    expect(c.$('review').disabled).toBe(true);
  });

  it('Me is disabled without a game session, and opens the signed-in member otherwise', async () => {
    const none = await boot({ game: 'none' });
    expect(none.$('me').disabled).toBe(true);
    const t = await boot({ game: 'player' });
    expect(t.$('me').disabled).toBe(false);
    t.click(t.$('me'));
    await t.waitFor(() => !t.$('member').hidden && t.$('journal-body').children.length > 0, 'own card');
    expect(t.$('who').textContent).toContain('HAMS0002');
  });
});

describe('look up, the card and the journal (S5, D5, D6)', () => {
  it('draws member text as text, never as markup, and never shows an identity subject', async () => {
    const t = await boot();
    await t.openCard('<img');
    const cell = t.w.document.querySelector('#results-body td button')!;
    expect(cell.textContent).toBe(HOSTILE);
    expect(t.w.document.querySelector('img')).toBeNull();
    expect(t.$('who').textContent).toContain(HOSTILE);
    expect(t.w.document.querySelector('#who img')).toBeNull();
    expect(t.w.document.documentElement.outerHTML).not.toContain('SECRET-GOOGLE-SUB-777');
    expect(t.$('who').textContent).toContain('Google');
  });

  it('the card shows both balances with their revisions, and a member with no campaign says so', async () => {
    const t = await boot();
    await t.openCard();
    const cards = t.$('cards').textContent ?? '';
    expect(cards).toContain('500');
    expect(cards).toContain('wallet revision4');
    expect(cards).toContain('3,180');
    expect(cards).toContain('campaign revision7');
    const n = await boot();
    await n.openCard('HAMS0002');
    expect(n.$('cards').textContent).toContain('No campaign on the server yet: credits cannot be set.');
  });

  it('pages the journal with the cursor the server gave, and filters by currency', async () => {
    const t = await boot();
    for (let i = 0; i < 54; i++) await t.k.db.prepare("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', ?1, 'earn', 0, '{}', ?2)").bind(NOW - 10_000 - i, `earn-${i}`).run();
    await t.openCard();
    expect(t.$('journal-body').children.length).toBe(50);
    expect(t.$('older').hidden).toBe(false);
    t.click(t.$('older'));
    await t.waitFor(() => t.$('journal-body').children.length === 55, 'page two');
    expect(t.$('older').hidden).toBe(true);
    expect(new Set([...t.$('journal-body').children].map((r) => r.children[7]?.textContent)).size).toBe(55);
    const fetches = t.sent.length;
    t.click(t.w.document.querySelector('#filters button[data-filter="credits"]')!);
    expect(t.$('journal-body').children.length).toBe(0);
    expect(t.$('journal-empty').hidden).toBe(false);
    t.click(t.w.document.querySelector('#filters button[data-filter="coins"]')!);
    expect(t.$('journal-body').children.length).toBe(55);
    expect(t.sent.length).toBe(fetches); // a filter click is client-side: no fetch, no view row, no read spent
  });
});

describe('a coin change, end to end (S5, D7, D9.3, D12)', () => {
  const fill = (t: Awaited<ReturnType<typeof boot>>, amount: string, reason = 'Compensation: lost a won mission') => {
    t.type('amt', amount);
    t.type('why', reason);
  };

  it('review, confirm: sends exactly what the route requires, moves the balance, and highlights the new row', async () => {
    const t = await boot();
    await t.openCard();
    fill(t, '100');
    expect(t.$('preview').textContent).toBe('500 → 600 (+100 grant)');
    t.click(t.$('review'));
    expect(t.$('d-title').textContent).toBe('Grant 100 Roar coins?');
    expect(t.$('d-table').textContent).toContain('4 (refused if it has moved)');
    expect(t.$('typed').disabled).toBe(true);
    t.click(t.$('d-go'));
    await t.waitFor(() => t.$('msg').textContent?.startsWith('Grant done') === true, 'success');
    const post = t.sent.find((s) => s.method === 'POST')!;
    expect(post.path).toBe('/stats/api/members/K7Q2ABCD/coins');
    expect(post.headers['x-rl-admin']).toBe('1');
    expect(post.headers['content-type']).toBe('application/json');
    expect(Object.keys(post.body as object).sort()).toEqual(['amount', 'mode', 'op_id', 'reason', 'revision']);
    expect(post.body).toMatchObject({ mode: 'grant', amount: 100, revision: 4, reason: 'Compensation: lost a won mission' });
    expect(t.$('cards').textContent).toContain('600');
    expect(t.$('cards').textContent).toContain('wallet revision5');
    await t.waitFor(() => t.w.document.querySelector('#journal-body tr.new') !== null, 'highlighted row');
    const row = t.w.document.querySelector('#journal-body tr.new')!;
    expect(row.textContent).toContain('admin grant');
    expect(row.textContent).toContain('500 → 600');
    expect(row.textContent).toContain('ADMQ0001');
    expect(await t.dbOne<{ free: number }>("SELECT free FROM wallet WHERE member_id = 'm1'")).toEqual({ free: 600 });
    expect(t.$('dlg').hasAttribute('open')).toBe(false);
  });

  it('a deduction or a set needs the Player ID typed; a grant does not', async () => {
    const t = await boot();
    await t.openCard();
    t.click(t.w.document.querySelector('#modes button[data-mode="deduct"]')!);
    fill(t, '40');
    t.click(t.$('review'));
    expect(t.$('d-title').textContent).toBe('Deduct 40 Roar coins?');
    expect(t.$('typed').disabled).toBe(false);
    expect(t.$('d-go').disabled).toBe(true);
    t.type('typed', 'WRONG');
    expect(t.$('d-go').disabled).toBe(true);
    t.type('typed', 'k7q2abcd');
    expect(t.$('d-go').disabled).toBe(false);
    t.click(t.$('d-go'));
    await t.waitFor(() => t.$('msg').textContent?.startsWith('Deduct done') === true, 'deduct');
    expect(await t.dbOne<{ free: number }>("SELECT free FROM wallet WHERE member_id = 'm1'")).toEqual({ free: 460 });
  });

  it('a set past the range, a short reason and a no-op cannot be reviewed', async () => {
    const t = await boot();
    await t.openCard();
    t.click(t.w.document.querySelector('#modes button[data-mode="set"]')!);
    fill(t, '1000001');
    expect(t.$('review').disabled).toBe(true);
    expect(t.$('hint').textContent).toContain('between 0 and 1,000,000');
    fill(t, '900', 'seven c');
    expect(t.$('review').disabled).toBe(true);
    expect(t.$('hint').textContent).toContain('at least 8');
    fill(t, '500');
    expect(t.$('hint').textContent).toBe('That changes nothing.');
    t.click(t.w.document.querySelector('#modes button[data-mode="deduct"]')!);
    fill(t, '501');
    expect(t.$('review').disabled).toBe(true);
    fill(t, '500');
    expect(t.$('review').disabled).toBe(false);
    expect(t.sent.filter((s) => s.method === 'POST')).toEqual([]);
  });

  it('a double confirm after a lost reply re-sends the SAME op id, so the coins move once', async () => {
    let lost = true;
    const t = await boot({ loseReply: (s) => s.method === 'POST' && lost });
    await t.openCard();
    fill(t, '100');
    t.click(t.$('review'));
    t.click(t.$('d-go'));
    await t.waitFor(() => t.$('d-err').textContent !== '' && !t.$('d-go').disabled, 'lost reply');
    lost = false;
    t.click(t.$('d-go'));
    await t.waitFor(() => t.$('msg').textContent?.startsWith('Grant done') === true, 'retry');
    const posts = t.sent.filter((s) => s.method === 'POST');
    expect(posts.length).toBe(2);
    expect((posts[0]!.body as { op_id: string }).op_id).toBe((posts[1]!.body as { op_id: string }).op_id);
    expect(await t.dbOne<{ free: number }>("SELECT free FROM wallet WHERE member_id = 'm1'")).toEqual({ free: 600 });
    expect(await t.dbOne<{ n: number }>("SELECT COUNT(*) AS n FROM admin_action WHERE action = 'coins'")).toEqual({ n: 1 });
  });

  it('a wallet that moved since the card was drawn is redrawn, and nothing is written', async () => {
    const t = await boot();
    await t.openCard();
    fill(t, '100');
    t.click(t.$('review'));
    await t.k.db.prepare("UPDATE wallet SET free = 520, revision = 5 WHERE member_id = 'm1'").run();
    t.click(t.$('d-go'));
    await t.waitFor(() => t.$('err').textContent === 'The balance changed since the card was drawn.', 'moved');
    expect(t.$('dlg').hasAttribute('open')).toBe(false);
    expect(t.$('cards').textContent).toContain('520');
    expect(t.$('cards').textContent).toContain('wallet revision5');
    expect(await t.dbOne<{ n: number }>("SELECT COUNT(*) AS n FROM admin_action WHERE action = 'coins'")).toEqual({ n: 0 });
  });
});

describe('Close admin writes (S5, D3)', () => {
  it('closes the switch with { open: false } and the page then shows it closed, without a reload', async () => {
    const t = await boot();
    t.click(t.$('sw-close'));
    await t.waitFor(() => t.$('sw-chip').textContent === 'Admin writes: closed', 'closed chip');
    const post = t.sent.find((s) => s.path === '/stats/api/members/switch')!;
    expect(post.body).toEqual({ open: false });
    expect(post.headers['x-rl-admin']).toBe('1');
    expect(t.$('sw-close').hidden).toBe(true);
    expect(await t.dbOne<{ value: string }>("SELECT value FROM flags WHERE name = 'admin'")).toEqual({ value: 'closed' });
    expect(t.w.document.querySelector('button#sw-open')).toBeNull();
  });
});

describe('audit noise, races and the highlight (S5 review)', () => {
  const journalFetches = (t: Awaited<ReturnType<typeof boot>>) => t.sent.filter((s) => s.path.includes('/journal')).length;

  it('opening a card fetches the journal exactly once, and logs the views that implies', async () => {
    const t = await boot();
    await t.openCard();
    expect(journalFetches(t)).toBe(1);
    expect(t.sent.filter((s) => s.path === '/stats/api/members/K7Q2ABCD').length).toBe(1);
  });

  it('a slower, earlier journal response cannot overwrite a newer one', async () => {
    let seen = 0;
    const t = await boot({ slow: (s) => (s.path.includes('/journal') && seen++ === 0 ? 150 : 0) });
    t.type('q', 'K7Q2ABCD');
    t.$('find-form').dispatchEvent(new t.w.Event('submit', { bubbles: true, cancelable: true }));
    await t.waitFor(() => t.w.document.querySelector('#results-body button') !== null, 'results');
    const btn = t.w.document.querySelector('#results-body button')!;
    t.click(btn);
    await t.waitFor(() => journalFetches(t) === 1, 'first journal request');
    await t.k.db.prepare("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', ?1, 'earn', 0, '{}', 'late-row')").bind(NOW + 1).run();
    t.click(t.w.document.querySelector('#results-body button')!);
    await t.waitFor(() => t.$('journal-body').children.length === 2, 'newer response drawn');
    await new Promise((r) => setTimeout(r, 300));
    expect(t.$('journal-body').children.length).toBe(2);
  });

  it('highlights the row whose op id is the write just made, not the first row', async () => {
    const t = await boot();
    await t.k.db.prepare("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', ?1, 'earn', 0, '{}', 'newer-earn-0001')").bind(NOW + 5000).run();
    await t.openCard();
    t.type('amt', '100');
    t.type('why', 'Compensation: lost a won mission');
    t.click(t.$('review'));
    t.click(t.$('d-go'));
    await t.waitFor(() => t.w.document.querySelector('#journal-body tr.new') !== null, 'highlight');
    const opId = (t.sent.find((s) => s.method === 'POST')!.body as { op_id: string }).op_id;
    const marked = [...t.w.document.querySelectorAll('#journal-body tr.new')];
    expect(marked.length).toBe(1);
    expect(marked[0]!.textContent).toContain(opId.slice(0, 4) + '\u2026' + opId.slice(-4));
    expect(t.$('journal-body').children[0]!.className).not.toBe('new');
  });

  it('a set, driven through the dialog, writes the target balance and keeps wallet = sum of journal', async () => {
    const t = await boot();
    await t.openCard();
    t.click(t.w.document.querySelector('#modes button[data-mode="set"]')!);
    t.type('amt', '900');
    t.type('why', 'Correcting the 12 Nov sync bug');
    expect(t.$('preview').textContent).toBe('500 \u2192 900 (+400 set)');
    t.click(t.$('review'));
    expect(t.$('d-title').textContent).toBe('Set Roar coins to 900?');
    t.type('typed', 'K7Q2ABCD');
    t.click(t.$('d-go'));
    await t.waitFor(() => t.$('msg').textContent?.startsWith('Set done') === true, 'set');
    expect(t.sent.find((s) => s.method === 'POST')!.body).toMatchObject({ mode: 'set', amount: 900, revision: 4 });
    expect(await t.dbOne<{ free: number }>("SELECT free FROM wallet WHERE member_id = 'm1'")).toEqual({ free: 900 });
    expect(await t.dbOne<{ s: number }>("SELECT SUM(free_delta) AS s FROM coin_journal WHERE member_id = 'm1'")).toEqual({ s: 900 });
  });

  it('a second confirm while the write is in flight sends nothing more (a programmatic click reaches the busy guard)', async () => {
    const t = await boot({ slow: (s) => (s.method === 'POST' ? 100 : 0) });
    await t.openCard();
    t.type('amt', '100');
    t.type('why', 'Compensation: lost a won mission');
    t.click(t.$('review'));
    t.click(t.$('d-go'));
    t.click(t.$('d-go'));
    t.click(t.$('d-cancel'));
    await t.waitFor(() => t.$('msg').textContent?.startsWith('Grant done') === true, 'grant');
    expect(t.sent.filter((s) => s.method === 'POST').length).toBe(1);
  });

  it('counts the reason as the server does: format characters do not add length', async () => {
    const t = await boot();
    await t.openCard();
    t.type('amt', '100');
    t.type('why', 'sevench\u200b\u200b\u200b');
    expect(t.$('review').disabled).toBe(true);
    expect(t.$('hint').textContent).toContain('at least 8');
    t.type('why', 'eightchr\u200b');
    expect(t.$('review').disabled).toBe(false);
  });
});
