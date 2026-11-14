/** The admin page's constants (GH-695, spec 2026-11-14-admin-account-page-design.md D2, D5, D10). */

/** D2.7: a write body is at most 2 KiB. */
export const ADMIN_BODY_MAX_BYTES = 2048;
/** D10: day caps in the accounts `rate_day`, global (key ''). */
export const ADMIN_READS_PER_DAY = 500;
export const ADMIN_WRITES_PER_DAY = 50;
/** D5: a display-name search needs this many code points, and lists at most this many members. */
export const FIND_NAME_MIN = 3;
export const FIND_NAME_MAX = 20;
export const FIND_MAX = 20;
/** D6: journal rows a page. */
export const JOURNAL_PAGE = 50;
