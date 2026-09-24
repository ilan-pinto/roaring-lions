import { STATS_STYLE_HEAD } from './stats-page';

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** The login page gating /stats. `message`, when given, is shown as an escaped
 *  status line above the form (e.g. a wrong-password or rate-limit notice). */
export function loginPageHtml(message?: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Roaring Lions Stats</title>
<style>${STATS_STYLE_HEAD}
form{max-width:320px;margin:48px auto 0;display:flex;flex-direction:column;gap:12px}
label{font:600 12px 'IBM Plex Mono',monospace;text-transform:uppercase;color:var(--muted)}
input{font:16px Barlow,Arial,sans-serif;padding:8px;border:1px solid var(--rule);background:var(--surface);color:var(--ink)}
button{font:700 15px Barlow,Arial,sans-serif;text-transform:uppercase;padding:10px;border:0;background:var(--accent);color:var(--surface);cursor:pointer}
.msg{max-width:320px;margin:24px auto 0;padding:8px 12px;background:var(--surface);border-left:3px solid var(--bad);color:var(--ink)}
</style></head><body><main>
<h1>Roaring Lions Stats</h1>
${message ? `<p class="msg">${escapeHtml(message)}</p>` : ''}
<form method="post" action="/stats/login">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Sign in</button>
</form>
</main></body></html>`;
}
