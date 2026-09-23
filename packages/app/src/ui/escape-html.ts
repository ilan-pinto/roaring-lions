/**
 * The one HTML escaper the UI builds `innerHTML` with (shell upgrade Phase 3,
 * Task 10).
 *
 * There were three, for two jobs, and they disagreed. `hud.ts` carried
 * `escapeAttr` (`& " <`) for an attribute value and `escapeHtml` (`& < >`) for
 * text between tags, each with a comment warning that the two were "not
 * interchangeable"; `mission-notice.ts` carried its own `escapeHtml` escaping
 * all five. That warning was the defect rather than the documentation of one:
 * a pair of escapers each right in only one context is a choice every call
 * site has to get right, and the strip got it wrong three times in a row -- a
 * mission's `name`, the shown primary's `text` and a deadline objective's
 * `text` reached `innerHTML` with no escaping at all.
 *
 * So this is the five-character body, because it is a superset of both: its
 * output is correct between tags AND inside an attribute delimited by either
 * quote, and there is no wrong one left to reach for. `&` goes first, or the
 * entities the later replaces write would be escaped a second time.
 *
 * What it does not do: keep a value inside an UNQUOTED attribute (`a=${x}`,
 * where a space ends the value -- quote every attribute), or make a URL safe
 * to follow. Escaping keeps an `href`/`src` value inside its quotes; it does
 * nothing about a `javascript:` scheme, and the only URLs the UI builds are
 * the app's own asset paths, never mission data.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
