import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioManifest, units } from '@lions/data';
import {
  ORDER_VERBS,
  VOICE_CLASSES,
  ackLineKey,
  allLineKeys,
  deathLineKey,
  languageOf,
  orderLineKey,
  pinnedLineKey,
  rosterLanguages,
  voiceClassOf,
  type VoiceClass,
} from './lines';

const SCHEMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data/schemas/unit.schema.json');
const LANGS = { kdf: 'he', ashwar: 'ar', sarim: 'ar', rif: 'ar' };

describe('voiceClassOf (spec §3)', () => {
  // Every shipped unit, written out: a new unit or a role change must be a
  // conscious edit here, not a silent new voice.
  const EXPECTED: Record<string, VoiceClass> = {
    apc_eitan: 'crew', apc_kipod: 'crew', at_team: 'infantry', attack_drone: 'air',
    breach_team: 'infantry', demo_squad: 'engineer', dozer_d9: 'engineer', heli_peten: 'air',
    ifv_namer: 'crew', inf_squad: 'infantry', jeep_shoded: 'crew', mbt_lavi: 'crew',
    mortar_team: 'infantry', recon_drone: 'air', scout_shachaf: 'crew', sniper_team: 'infantry',
    yahalom_squad: 'engineer', recon_zikit: 'infantry', heli_peten_gunship: 'air',
    atgm_cell: 'infantry', charge_squad: 'infantry', digger_crew: 'engineer', gun_truck: 'crew',
    loiter_drone: 'air', manpad_team: 'infantry', militia_cell: 'infantry', mortar_crew: 'infantry',
    moto_rpg: 'crew', paramotor: 'air', recoilless_team: 'infantry', rocket_battery: 'crew',
    rpg_team: 'infantry', sarim_rifles: 'infantry', technical: 'crew',
    civilians: 'infantry', // a class, but no language: civilians never speak (languageOf)
  };

  it('gives every shipped unit the class spec §3 names, overrides first', () => {
    const got = Object.fromEntries(Object.values(units).map((u) => [u.id, voiceClassOf(u)]));
    expect(got).toEqual(EXPECTED);
  });

  it('covers every role the schema offers, eod included (R-15), and refuses one it does not', () => {
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as { properties: { role: { enum: string[] } } };
    for (const role of schema.properties.role.enum) {
      expect(() => voiceClassOf({ id: 'probe', role })).not.toThrow();
    }
    expect(voiceClassOf({ id: 'probe', role: 'eod' })).toBe('engineer');
    expect(() => voiceClassOf({ id: 'probe', role: 'submarine' })).toThrow(/submarine/);
  });

  it('ignores a voice value that is not a class, and falls back to the role', () => {
    expect(voiceClassOf({ id: 'probe', role: 'mbt', voice: 'tank' })).toBe('crew');
  });
});

describe('languageOf (spec §3, D10)', () => {
  it('KDF speaks Hebrew, the three doctrines Arabic, civilians nothing', () => {
    expect(languageOf('kdf', LANGS)).toBe('he');
    for (const f of ['ashwar', 'sarim', 'rif']) expect(languageOf(f, LANGS)).toBe('ar');
    expect(languageOf('civilian', LANGS)).toBeNull();
    expect(languageOf('constructor', LANGS)).toBeNull(); // not a prototype walk
  });
});

describe('the key grammar (R-5)', () => {
  it('is twenty keys per language, distinct, and ASCII <lang>.<class>.<trigger>', () => {
    const he = allLineKeys(['he']);
    expect(he).toHaveLength(20);
    expect(new Set(he).size).toBe(20);
    for (const k of he) expect(k).toMatch(/^[a-z]{2}\.(infantry|crew|engineer|air|common)\.[a-z]+$/);
    expect(allLineKeys(['he', 'ar', 'he'])).toHaveLength(40);
  });

  it('declares the pinned call once per language', () => {
    expect(allLineKeys(['he'])).toHaveLength(20);
    expect(allLineKeys(['he', 'ar'])).toContain('ar.common.pinned');
    expect(pinnedLineKey('he')).toBe('he.common.pinned');
  });

  it('engineers have a task and no attack; nobody else has a task', () => {
    const he = new Set(allLineKeys(['he']));
    expect(he.has('he.engineer.task')).toBe(true);
    expect(he.has('he.engineer.attack')).toBe(false);
    for (const c of ['infantry', 'crew', 'air']) expect(he.has(`he.${c}.task`)).toBe(false);
  });

  it('maps a verb to its pool: engineers attack from infantry, demolish is always the engineer task', () => {
    expect(orderLineKey('he', 'crew', 'move')).toBe('he.crew.move');
    expect(orderLineKey('he', 'engineer', 'attack')).toBe('he.infantry.attack');
    expect(orderLineKey('he', 'crew', 'demolish')).toBe('he.engineer.task');
    expect(orderLineKey('he', 'air', 'halt')).toBe('he.common.halt');
    expect(orderLineKey('he', 'infantry', 'charge')).toBe('he.common.charge');
    expect(deathLineKey('ar', 'air')).toBe('ar.air.death');
    expect(ackLineKey('he')).toBe('he.common.ack');
  });

  it('every key the director can ask for is inside the universe the manifest declares', () => {
    const all = new Set(allLineKeys(['he']));
    for (const c of VOICE_CLASSES) {
      for (const v of ORDER_VERBS) expect(all.has(orderLineKey('he', c, v)), `${c} ${v}`).toBe(true);
      expect(all.has(deathLineKey('he', c))).toBe(true);
    }
    expect(all.has(ackLineKey('he'))).toBe(true);
  });
});

describe('rosterLanguages (N16)', () => {
  const FACTION: Record<string, string> = { inf_squad: 'kdf', sarim_rifles: 'sarim', technical: 'rif', civilians: 'civilian' };
  const factionOf = (id: string): string | undefined => FACTION[id];

  it('names each spoken language once, sorted, and nothing for civilians or unknown ids', () => {
    expect(rosterLanguages(['inf_squad', 'civilians'], factionOf, LANGS)).toEqual(['he']);
    expect(rosterLanguages(['sarim_rifles', 'inf_squad', 'technical'], factionOf, LANGS)).toEqual(['ar', 'he']);
    expect(rosterLanguages(['nope'], factionOf, LANGS)).toEqual([]);
  });
});

describe('data/audio.json declares the director’s whole vocabulary (spec §6, R-6)', () => {
  const voices = (audioManifest as {
    voices?: { gain?: number; languages?: Record<string, string>; lines?: Record<string, unknown> };
  }).voices;

  it('maps the four fighting factions and leaves civilians silent (D10)', () => {
    expect(voices?.languages).toEqual({ kdf: 'he', ashwar: 'ar', sarim: 'ar', rif: 'ar' });
  });

  it('declares every key the director can ask for, and nothing else', () => {
    const langs = Object.values(voices?.languages ?? {});
    expect(Object.keys(voices?.lines ?? {}).sort()).toEqual(allLineKeys(langs).sort());
  });

  it('carries N11’s line gain', () => {
    expect(voices?.gain).toBe(0.8);
  });
});
