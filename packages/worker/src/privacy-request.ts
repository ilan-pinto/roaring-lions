/**
 * GET /privacy/request (GH-1417 C1/C2): the private form for privacy requests (access, export, deletion, correction).
 *
 * It posts to the EXISTING POST /api/feedback with category `privacy` and source `privacy`, so every cap, the Origin
 * check, the rate limits, the kill switch and the 180-day purge apply unchanged. The note is readable only on the
 * password-protected /stats feedback page, and a privacy row never yields a GitHub issue link.
 *
 * The page needs a script (a multipart `meta` part cannot come from a plain form), so it keeps the dashboard's CSP:
 * inline script and style, connect-src 'self', no framing. It holds no personal data, sets no cookie, and sends no
 * player, session or tester id: the person identifies themselves in the text, if they choose to.
 */
import { PAGE_CSP } from './security-headers';

export const PRIVACY_REQUEST_PATH = '/privacy/request';
/** The form has no app build to report; the schema wants one, so it sends this fixed placeholder. */
export const PRIVACY_FORM_BUILD = '0.0.0';
export const REQUEST_KINDS = ['access', 'export', 'deletion', 'correction'] as const;

export const PRIVACY_REQUEST_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy request - Roaring Lions</title>
<style>
:root { color-scheme: light dark; }
body { font: 16px/1.55 system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.6rem; }
label { display: block; margin-top: 1rem; font-weight: 600; }
input, select, textarea { font: inherit; width: 100%; box-sizing: border-box; padding: .4rem; }
textarea { min-height: 9rem; }
button { font: inherit; margin-top: 1.25rem; padding: .5rem 1.25rem; }
.hint { font-weight: 400; font-size: .9rem; opacity: .8; }
#msg { margin-top: 1rem; font-weight: 600; }
</style>
</head>
<body>
<main>
<h1>Send a privacy request</h1>
<p>Use this form to ask for a copy of your data, an export, a deletion or a correction. It is private: only the Roaring Lions team can read it, and it is never posted to GitHub. If you are signed in, "Download my data" and "Delete my account" on the profile screen do the same at once. See <a href="/privacy">how your data is kept</a>.</p>
<noscript><p><strong>This form needs JavaScript to send.</strong></p></noscript>
<form id="f" novalidate>
<label for="kind">What do you ask for?</label>
<select id="kind" required>
<option value="access">A copy of the data held about me (access)</option>
<option value="export">My data in a file (export)</option>
<option value="deletion">Delete my data (deletion)</option>
<option value="correction">Correct my data (correction)</option>
</select>
<label for="who">Your display name or Player ID <span class="hint">(optional; it helps us find your account)</span></label>
<input id="who" maxlength="120" autocomplete="off">
<label for="details">Details</label>
<textarea id="details" maxlength="1500" required></textarea>
<label for="contact">How to reach you <span class="hint">(optional; without it we cannot reply)</span></label>
<input id="contact" maxlength="120" autocomplete="off">
<button type="submit" id="go">Send</button>
</form>
<p id="msg" role="status" aria-live="polite"></p>
</main>
<script>
(function () {
  var f = document.getElementById('f'), msg = document.getElementById('msg'), go = document.getElementById('go');
  var clean = function (s) { return s.replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, ' '); };
  var line = function (s) { return clean(s).replace(/[\\r\\n\\t]+/g, ' ').trim(); };
  var say = function (t) { msg.textContent = t; };
  f.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var details = clean(document.getElementById('details').value).trim();
    if (details === '') { say('Please say what you need in the details box.'); return; }
    var who = line(document.getElementById('who').value), contact = line(document.getElementById('contact').value);
    var text = 'Request: ' + document.getElementById('kind').value + '\\n' + (who ? 'Account: ' + who + '\\n' : '') + '\\n' + details;
    var meta = { v: 1, t: Date.now(), source: 'privacy', category: 'privacy', text: text.slice(0, 2000), build: '${PRIVACY_FORM_BUILD}', context: {} };
    if (contact) meta.contact = contact;
    var body = new FormData();
    body.set('meta', JSON.stringify(meta));
    go.disabled = true; say('Sending...');
    fetch('/api/feedback', { method: 'POST', body: body }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 201) { f.reset(); say('Sent. Your reference is ' + j.ref + '.'); }
        else if (r.status === 410) say('This form is closed for now. Please try again later.');
        else if (r.status === 429) say('Too many requests from here today. Please try again later.');
        else say('It could not be sent (' + r.status + '). Please try again later.');
      });
    }).catch(function () { say('It could not be sent. Please check your connection and try again.'); }).then(function () { go.disabled = false; });
  });
})();
</script>
</body>
</html>
`;

export function handlePrivacyRequest(req: Request): Response {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
  return new Response(req.method === 'HEAD' ? null : PRIVACY_REQUEST_HTML, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP, 'cache-control': 'public, max-age=300' },
  });
}
