/**
 * GET /.well-known/security.txt (GH-1417 C5, RFC 9116). Points at GitHub's private vulnerability reporting for this
 * repository, the same channel SECURITY.md names. No D1, no cookie.
 *
 * `Expires` is required by the RFC and must be renewed before it passes: bump it (and SECURITY.md's date, if any)
 * whenever this file is touched, and at the latest by the date below; security-txt's test goes red 30 days before it lapses.
 */
export const SECURITY_REPORT_URL = 'https://github.com/ilan-pinto/roaring-lions/security/advisories/new';
export const SECURITY_POLICY_URL = 'https://github.com/ilan-pinto/roaring-lions/blob/main/SECURITY.md';
export const SECURITY_EXPIRES = '2027-10-31T00:00:00.000Z';

export const SECURITY_TXT = `Contact: ${SECURITY_REPORT_URL}
Expires: ${SECURITY_EXPIRES}
Policy: ${SECURITY_POLICY_URL}
Preferred-Languages: en
`;

export function handleSecurityTxt(req: Request): Response {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
  return new Response(req.method === 'HEAD' ? null : SECURITY_TXT, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
