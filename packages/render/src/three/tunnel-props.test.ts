import { describe, expect, it } from 'vitest';
import { tunnelPiecesFor, type TunnelRouteView } from './tunnel-props';

/** A live, half-dug route nobody has identified, with its head in view. */
function route(over: Partial<TunnelRouteView> = {}): TunnelRouteView {
  return {
    alive: true,
    contactLevel: 0,
    ventOpen: false,
    progressTiles: 4,
    lengthTiles: 9,
    mouth: [10.5, 18.5],
    vent: [3.5, 12.5],
    digHead: [7.5, 15.5],
    digHeadSeen: true,
    ...over,
  };
}

const kinds = (r: TunnelRouteView) => tunnelPiecesFor(r).map((p) => p.kind);

describe('tunnelPiecesFor (GH-227): the art reveals nothing the trail does not', () => {
  it('shows only the spoil heap for an unidentified route being dug in view', () => {
    expect(kinds(route())).toEqual(['spoil_heap']);
    expect(tunnelPiecesFor(route())[0].at).toEqual([7.5, 15.5]);
  });

  it('shows nothing for an unidentified route whose dig head nobody sees', () => {
    expect(kinds(route({ digHeadSeen: false }))).toEqual([]);
  });

  it('suspected (level 1) is still not identified: no mouth, no vent', () => {
    expect(kinds(route({ contactLevel: 1 }))).toEqual(['spoil_heap']);
  });

  it('an identified route shows its mouth, and its vent only once open', () => {
    expect(kinds(route({ contactLevel: 2 }))).toEqual(['tunnel_mouth', 'spoil_heap']);
    expect(kinds(route({ contactLevel: 2, ventOpen: true, progressTiles: 9 }))).toEqual([
      'tunnel_mouth',
      'tunnel_vent',
    ]);
  });

  it('a finished route has no dig head to heap spoil at', () => {
    expect(kinds(route({ ventOpen: true, progressTiles: 9 }))).toEqual([]);
  });

  it('a collapsed route shows the collapsed twins only if it had been identified', () => {
    expect(kinds(route({ alive: false, contactLevel: 2, ventOpen: true }))).toEqual([
      'tunnel_mouth_collapsed',
      'tunnel_vent_collapsed',
    ]);
    expect(kinds(route({ alive: false, contactLevel: 2, ventOpen: false }))).toEqual(['tunnel_mouth_collapsed']);
    expect(kinds(route({ alive: false, contactLevel: 1 }))).toEqual([]);
    expect(kinds(route({ alive: false, contactLevel: 0 }))).toEqual([]);
  });

  it('places the mouth and the vent on the coordinates it was given', () => {
    const pieces = tunnelPiecesFor(route({ contactLevel: 2, ventOpen: true, progressTiles: 9 }));
    expect(pieces.map((p) => p.at)).toEqual([
      [10.5, 18.5],
      [3.5, 12.5],
    ]);
  });
});
