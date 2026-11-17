/**
 * The versus and chat kit (lead ruling 16 Nov 2026: the entry chunk's ceiling stays at `MAIN_CHUNK_MAX_BYTES`, so what only a room
 * needs loads on demand). One dynamic-import boundary: `main.ts` reaches this file through `versusKit()` (importWithRetry), at the
 * lobby's open/advisor calls and at the top of a room boot (`?net=`, an offline match, a spectated game). A campaign or free-play
 * session never loads it.
 *
 * `main.ts` and the router import this file's TYPES only (`import type * as VersusKit`); `versus-kit-wiring.test.ts` fails on a static
 * import of it, or of any module re-exported here. Whatever a non-room boot also calls (the frame step, ownership, the pause copy,
 * `LocalTransport`) is small and stays in the entry.
 */
export { WsTransport, PAUSES_PER_SEAT } from '@lions/net';
export { JoinNeedsConfirmation, connectMatch, inviteAdvisor, openRoom } from './net/connect';
export { nameFrom } from './net/seat-label';
export { desyncReportDraft, withoutReplay } from './net/desync-report';
export { logRejoin, netReport } from './net/net-report';
export { SnapshotProducer } from './net/snapshot-producer';
export { seatShouldProduceSnapshots } from './net/snapshot-gate';
export { settleRejoin } from './net/snapshot-rejoin';
export { campOf, factionsBySide, versusUnitTypes } from './net/versus-force';
export { ownedStoreSpecials } from './net/versus-specials';
export { buildMatchWorld, matchTick } from './net/match-world';
export { SPECTATOR_SHOWN, spectatorSink } from './net/spectator';
export { roomDockMenu, roomDockRuntime, roomEconomyView } from './net/room-economy';
export { NetStatusLine, lineOverMatchEnd, matchClock } from './ui/net-status';
export { NetChat, chatFeedLine, roomEnterAction } from './ui/net-chat';
export { inboxOf } from './ui/chat-inbox';
export { quickChatText } from './ui/quick-chat';
export { showNetEnd } from './ui/net-end';
export { NetPoints, payZoneOf } from './ui/net-points';
export { NetFlags } from './ui/net-flags';
export { flagMarksOf, flagViewOf } from './net/flag-view';
export { pointsViewOf } from './net/points-view';
export { describeCommand, mountAdvisorPanel } from './ui/advisor';
export { NetScoreboard, advisorPresenceHook } from './ui/net-score';
export { scoreOf, showsScoreboard } from './net/scoreboard';
export { decideOnHashTick, goalsOf, productionOf, matchResult, reportOver, roomEndingOutcome } from './net/outcome';
