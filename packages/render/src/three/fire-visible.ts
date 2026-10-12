import { isOwnSide } from '../relation';

/** Network design §5.1's second leak: a shot fired out of sight drew its
 *  tracer, flash and smoke on the other player's screen. Own fire always
 *  draws; hostile fire draws when either end of it is in sight. Audio is not
 *  gated: hearing distant fire is realistic and leaks no position the sound
 *  falloff does not.
 *
 *  `ThreeRenderer.onFire` asks this only in a versus room
 *  (`RendererOptions.versus`). Single-player keeps drawing every shot, fog or
 *  not, exactly as before: there the gate would change what the one player
 *  has always seen, and there is no second seat for a shot to leak to. */
export function fireVisible(shooterSide: number, viewer: number, shooterSeen: boolean, targetSeen: boolean): boolean {
  return isOwnSide(shooterSide, viewer) || shooterSeen || targetSeen;
}
