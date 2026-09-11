/** The tier names and their closing lines (spec 2026-09-10 §4.1, decided by the lead). Fixed
 *  here so no screen rewrites them; the debrief resolves `speaker` to a plate and portrait
 *  the same way the commander bar does. Index by stars; 0 has neither. */
export const TIER_NAMES = ['', 'Entered in the log', 'Named in brigade orders', "Ari'im citation"] as const;

export const TIER_LINES = [
  null,
  { speaker: 'shai', text: 'It is in the log. That is what the log is for.' },
  {
    speaker: 'idit',
    text: 'Brigade read the file to the end and put the company in Thursday’s orders. They do not read many to the end.',
  },
  { speaker: 'shai', text: 'A citation. Put it with the slip and get the men fed.' },
] as const;
