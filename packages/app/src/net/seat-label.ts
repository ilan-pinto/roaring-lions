/**
 * How a seat is named in the lobby and the match (GH-1075 A3, Task 3.7). The room's lobby message carries a member's
 * label (`SeatState.member`), a seat's kind and a bot's declared model; the match config carries none of them (§0.14),
 * so the lobby keeps the labels it was told and hands them to the battlefield with the config.
 *
 * A bot's typed model name is DATA: it is returned as a plain string for a text node, never passed through `t()`
 * and never markup. A listed model id is chrome and goes through `t('bot.model.<id>')`.
 */
import type { BotModel, SeatState } from '@lions/net';
import { t } from '../i18n/t';

/** `PUBLIC_ID_SHOWN`: the whole public id is shown (8 Crockford characters, §0.18). */
export const PUBLIC_ID_SHOWN = 8;

export interface SeatLabel {
  text: string;
  tag: 'member' | 'guest' | 'bot' | null;
  record: string | null;
  model: string | null;
}

const modelText = (m: BotModel | undefined): string | null => {
  if (m === undefined) return null;
  return m.id === 'other' ? m.name : t(`bot.model.${m.id}`);
};

const recordText = (r: { won: number; lost: number; drawn: number }): string =>
  r.drawn > 0
    ? t('versus.seat.record.drawn', { won: String(r.won), lost: String(r.lost), drawn: String(r.drawn) })
    : t('versus.seat.record', { won: String(r.won), lost: String(r.lost) });

/** `sandbox`: nobody in a sandbox room is recorded, so no tag is shown. */
export function seatLabel(
  s: Pick<SeatState, 'callsign' | 'member' | 'botModel'>,
  kind: 'human' | 'bot',
  opts: { sandbox?: boolean } = {},
): SeatLabel {
  if (s.member !== undefined) {
    return {
      text: `${s.member.name} · ${s.member.publicId.slice(0, PUBLIC_ID_SHOWN)}`,
      tag: opts.sandbox === true ? null : 'member',
      record: s.member.record === undefined ? null : recordText(s.member.record),
      model: null,
    };
  }
  if (kind === 'bot') {
    return { text: s.callsign, tag: opts.sandbox === true ? null : 'bot', record: null, model: modelText(s.botModel) };
  }
  return { text: s.callsign, tag: opts.sandbox === true ? null : 'guest', record: null, model: null };
}

/** The label of each seat the lobby named, by seat; a seat it did not name is null. */
export function labelsOf(seats: readonly SeatState[], opts: { sandbox?: boolean } = {}): [SeatLabel | null, SeatLabel | null] {
  const one = (n: 0 | 1): SeatLabel | null => {
    const s = seats.find((x) => x.seat === n);
    return s === undefined ? null : seatLabel(s, s.kind ?? 'human', opts);
  };
  return [one(0), one(1)];
}

/** A seat's name in chat, status line and score: its label, else the config's callsign. */
export const nameFrom = (labels: readonly (SeatLabel | null)[] | undefined, seat: number, fallback: string): string =>
  labels?.[seat]?.text ?? fallback;
