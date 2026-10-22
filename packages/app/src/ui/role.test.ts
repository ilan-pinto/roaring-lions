// The role buckets the cursor and the inspect card share.
//
// hud.ts had this rung inline. The cursor needs the same answer, and two
// copies would let the cursor call a unit a transport while the card beside
// it says soft. One classifier, two callers -- the same reasoning as
// zoneContains in the slice before this one.
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { bucketVisible, isMountCarrier, ROLE_LABEL, roleBadgeSvg, roleBucket, roleLabel, type RoleBucket } from './role';
import { symbolBody } from './symbol';

const BUCKETS: readonly RoleBucket[] = ['kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour'];

/** The fields the classifier reads, defaulted to an armour unit. */
function unit(over: Partial<Parameters<typeof roleBucket>[0]> = {}) {
  return {
    isKamikaze: false,
    role: 'mbt',
    transportSlots: 0,
    isSoft: false,
    canCarry: null as readonly string[] | null,
    canEmbark: false,
    ...over,
  };
}

describe('roleBucket', () => {
  it('puts kamikaze first, above everything it also is', () => {
    // attack_drone is BOTH kamikaze and a drone. The rung order decides, and
    // kamikaze is the more urgent fact about a unit you are about to spend.
    expect(roleBucket(unit({ isKamikaze: true, role: 'drone' }))).toBe('kamikaze');
  });

  it('buckets a drone, a gunship and a sniper by role', () => {
    expect(roleBucket(unit({ role: 'drone' }))).toBe('drone');
    expect(roleBucket(unit({ role: 'gunship' }))).toBe('gunship');
    expect(roleBucket(unit({ role: 'sniper' }))).toBe('sniper');
  });

  it('calls anything with transport slots a transport', () => {
    expect(roleBucket(unit({ role: 'apc', transportSlots: 2 }))).toBe('transport');
  });

  it('puts transport above soft, so a carrier is not merely infantry', () => {
    expect(roleBucket(unit({ role: 'apc', transportSlots: 2, isSoft: true }))).toBe('transport');
  });

  it('calls a soft unit with no slots soft, and everything else armour', () => {
    expect(roleBucket(unit({ role: 'infantry', isSoft: true }))).toBe('soft');
    expect(roleBucket(unit({ role: 'mbt' }))).toBe('armour');
  });

  it('GH-707: a foot medic whose only seat is a stretcher is soft, not a transport', () => {
    // inf_medic_squad: role support, transport_slots 1, can_carry ['wounded'], on foot.
    expect(
      roleBucket(unit({ role: 'support', transportSlots: 1, isSoft: true, canCarry: ['wounded'], canEmbark: true }))
    ).toBe('soft');
  });

  it('GH-707: the ambulance and the medevac carry only the wounded and stay transports', () => {
    // veh_ambulance / air_medevac_heli: role apc, transport_slots 4, can_carry ['wounded'], cannot embark.
    expect(roleBucket(unit({ role: 'apc', transportSlots: 4, canCarry: ['wounded'] }))).toBe('transport');
    expect(roleBucket(unit({ role: 'apc', transportSlots: 4, isSoft: true, canCarry: ['wounded'] }))).toBe('transport');
  });

  it('GH-707: a foot unit that seats anyone other than the wounded is still a transport', () => {
    expect(
      roleBucket(unit({ role: 'infantry', transportSlots: 1, isSoft: true, canCarry: ['wounded', 'infantry'], canEmbark: true }))
    ).toBe('transport');
    expect(roleBucket(unit({ role: 'infantry', transportSlots: 1, isSoft: true, canEmbark: true }))).toBe('transport');
  });

});

describe('isMountCarrier', () => {
  it('GH-707: nothing whose seats are for the wounded alone is a carrier a squad mounts', () => {
    expect(isMountCarrier({ transportSlots: 1, canCarry: ['wounded'] })).toBe(false); // medic team
    expect(isMountCarrier({ transportSlots: 4, canCarry: ['wounded'] })).toBe(false); // ambulance, medevac
  });

  it('an ordinary transport, or a carrier that seats someone else too, is one', () => {
    expect(isMountCarrier({ transportSlots: 2, canCarry: null })).toBe(true);
    expect(isMountCarrier({ transportSlots: 2, canCarry: ['wounded', 'infantry'] })).toBe(true);
    expect(isMountCarrier({ transportSlots: 0, canCarry: null })).toBe(false);
  });
});

describe('roleBadgeSvg', () => {
  // S3e: the chip, the card, the dock, the tooltip and the garage all badge a
  // unit from the one G1 sheet (`symbol.ts`), so none of them can say
  // something different about what a unit is. Q7: unframed below 16 px (a
  // frame at 10 px is a smudge), the APP-6 frame from 16 up.
  it('draws every bucket from the shared sheet, unframed below 16 px and framed from 16', () => {
    for (const b of BUCKETS) {
      expect(roleBadgeSvg(b, 10)).toContain(symbolBody(b));
      expect(roleBadgeSvg(b, 10)).not.toContain(symbolBody(b, { framed: true }));
      expect(roleBadgeSvg(b, 15)).not.toContain(symbolBody(b, { framed: true }));
      expect(roleBadgeSvg(b, 16)).toContain(symbolBody(b, { framed: true }));
      expect(roleBadgeSvg(b, 24)).toContain(symbolBody(b, { framed: true }));
    }
  });

  it('keeps the rl-badge class and the size it was asked for', () => {
    const svg = roleBadgeSvg('armour', 22);
    expect(svg).toContain('class="rl-sym rl-badge"');
    expect(svg).toContain('width="22" height="22"');
    expect(svg).toContain('data-symbol="armour"');
  });

  it('no longer exports a Unicode table or the hand-built shapes', async () => {
    const mod = await import('./role');
    expect('ROLE_GLYPH' in mod).toBe(false);
    expect('roleBadgeShapes' in mod).toBe(false);
  });
});

describe('bucketVisible', () => {
  // The garage rail's whole filter (`brigade.ts`'s `syncTabs`) is this one
  // decision, made once per card per tab click. GH-237's actual bug was never
  // in this predicate -- it was `theme.css` letting a hidden card keep
  // drawing -- but the predicate had no test of its own before this, and a
  // wrong answer here would have been just as invisible to a player as the
  // CSS bug was.
  it('shows everything under the "all" tab, whatever the unit\'s own bucket', () => {
    const buckets: RoleBucket[] = ['kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour'];
    for (const b of buckets) expect(bucketVisible(b, 'all')).toBe(true);
  });

  it('shows a unit only under its own bucket\'s tab', () => {
    expect(bucketVisible('transport', 'transport')).toBe(true);
    expect(bucketVisible('transport', 'armour')).toBe(false);
    expect(bucketVisible('armour', 'transport')).toBe(false);
  });
});

describe('ROLE_LABEL', () => {
  it('covers every role any shipped KDF unit declares, so a new one cannot leak its id', () => {
    const roles = new Set(
      Object.values(units)
        .filter((u) => u.faction === 'kdf')
        .map((u) => u.role)
    );
    expect(roles.size).toBeGreaterThan(0);
    for (const role of roles) expect(ROLE_LABEL[role]).toBeTruthy();
  });

  it('never prints a raw role id', () => {
    expect(ROLE_LABEL.at_team).not.toBe('at_team');
    expect(ROLE_LABEL.ifv).not.toBe('ifv');
    expect(ROLE_LABEL.mbt).not.toBe('mbt');
    expect(ROLE_LABEL.recon).not.toBe('recon');
    expect(ROLE_LABEL.apc).not.toBe('apc');
  });

  it('falls back to the id with underscores turned to spaces for an unknown role', () => {
    expect(roleLabel('made_up_role')).toBe('made up role');
  });
});
