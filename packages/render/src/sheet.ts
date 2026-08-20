/**
 * Sprite sheet manifests.
 *
 * A sheet describes its own conventions — how many facings it has, which
 * index faces world +x, which way the rig rotated, how big it draws, and
 * which animation clips it contains. Those are properties of the rendered
 * files, not of the game, so they belong next to the files rather than in
 * app code. `tools/render_*.py` writes the manifest, so the rig that caused
 * a convention is the thing that reports it.
 *
 * Pure parsing: no Pixi, no I/O, no sim state.
 */

/** Canonical clip names. A sheet need not contain all of them — `work` in
 *  particular exists only on sheets whose unit can work a tunnel charge, and
 *  `clipOrFallback` resolves it to idle everywhere else. */
export type ClipName = 'idle' | 'move' | 'fire' | 'down' | 'wreck' | 'work';

export interface ClipSpec {
  /** Number of frames in this clip. */
  frames: number;
  /**
   * Playback rate for clips that run on their own clock — currently only
   * one-shot clips such as `fire`, whose latch expires after frames / fps.
   * Locomotion ignores this: `move` is paced by measured ground speed so the
   * feet track the terrain (see anim.ts).
   */
  fps: number;
  loop: boolean;
  /**
   * Index of this clip's first frame within the sheet's file numbering.
   * Zero for clip-layout sheets, where each clip has its own filename
   * prefix. Legacy sheets pack idle and walk into one flat sequence, so
   * their `move` starts at 1.
   */
  fileOffset: number;
}

export type SheetLayout = 'legacy' | 'clip';

export interface SheetSpec {
  facings: number;
  /** Sprite index that faces world +x. */
  facingOffset: number;
  /** True when the rig rotated the object the other way round. */
  facingReverse: boolean;
  /** Draw size multiplier, replacing the hardcoded isSoft ? 1.0 : 1.8. */
  scale: number;
  layout: SheetLayout;
  clips: Partial<Record<ClipName, ClipSpec>> & { idle: ClipSpec };
  /**
   * Where the weapon's traverse axis lands, in sheet pixels from the frame
   * centre, one entry per facing. Present only on turret sheets whose rig
   * declared a `turret_axis`.
   *
   * A turret sheet is composited at the hull's screen position while its frame
   * is chosen from where the weapon is aiming, so the turret is drawn as though
   * the whole vehicle had turned — it orbits the rig's pivot, the model's median
   * vertex. Harmless for a centre-mounted station (the Eitan measures 4.2% of
   * hull length, ~4px drawn) and plainly wrong for a pintle gun on a pickup bed
   * (16.2%). This is the correction; see `turretAxisOffset`.
   */
  turretAxisPx?: readonly (readonly [number, number])[];
}

/**
 * How far to shift a turret sprite so its traverse axis stays on the hull.
 *
 * Zero when the turret and hull face the same way, which is every frame of a
 * unit that is not currently tracking something off its heading, and zero for
 * any sheet whose rig did not declare an axis.
 */
export function turretAxisOffset(
  sheet: SheetSpec,
  hullIndex: number,
  turretIndex: number,
): readonly [number, number] {
  const axis = sheet.turretAxisPx;
  if (!axis) return [0, 0];
  const h = axis[hullIndex];
  const t = axis[turretIndex];
  if (!h || !t) return [0, 0];
  return [h[0] - t[0], h[1] - t[1]];
}

/**
 * A structure sheet: one frame, because a building never turns.
 *
 * Deliberately not a `SheetSpec`. A building has no facings, no clips beyond
 * idle, and no `facingOffset`, and `render_building.py` omits those fields rather
 * than writing lies into the manifest.
 */
export interface StructureSpec {
  /** Drawn width in map tiles. Derived by the render script, not authored. */
  scale: number;
  /**
   * The rubble frame, or null on a sheet rendered before wrecks existed.
   *
   * A destroyed building used to draw nothing at all: the sim unblocks its
   * tiles, so the terrain loop stopped reaching the sprite branch and a mosque
   * simply vanished mid-battle.
   */
  wreckFile: string | null;
  /**
   * Px from the anchor up to the building's **roof plane** — the highest place
   * something could stand — as distinct from `badgeTopPx`, which is the top of the
   * art. For the mosque those differ by 33px, because the top of the art is the tip
   * of the minaret. A badge wants the art; a garrison standing on the roof wants
   * this. Null on a sheet rendered before the field existed.
   */
  roofTopPx: number | null;
  /**
   * Display px from the sprite's anchor up to the top of its opaque art, or null
   * when the sheet predates the field.
   *
   * The renderer places a structure's integrity bar and garrison pips with this.
   * It used to use `heightPx` from `structures.json`, which belongs to the
   * procedural extrusion -- 34 for the mosque, whose sprite draws far taller --
   * and put the badge 67px inside the dome, hiding the pips that say whether a
   * building is held.
   */
  badgeTopPx: number | null;
  /** The single frame's file name. */
  file: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Parse a sheet manifest, accepting both the clip layout and the flat layout
 * shipped today.
 *
 * The legacy path is load-bearing rather than politeness: it lets units be
 * re-authored one at a time without the un-migrated ones breaking.
 */
/**
 * `turretAxisPx` if the rig wrote a usable one, nothing otherwise.
 *
 * Validated rather than trusted: a short or malformed array would silently
 * offset some facings and not others, which reads as a turret that jitters only
 * at certain headings — far harder to diagnose than a field that is simply
 * absent. Anything that is not `facings` pairs of finite numbers is dropped.
 */
function parseAxis(
  raw: unknown,
  facings: number,
): { turretAxisPx?: readonly (readonly [number, number])[] } {
  if (!Array.isArray(raw) || raw.length !== facings) return {};
  const out: [number, number][] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) return {};
    const [x, y] = entry;
    if (typeof x !== 'number' || !Number.isFinite(x)) return {};
    if (typeof y !== 'number' || !Number.isFinite(y)) return {};
    out.push([x, y]);
  }
  return { turretAxisPx: out };
}

export function parseManifest(raw: unknown): SheetSpec {
  if (!isRecord(raw)) throw new Error('sheet manifest: expected an object');

  const facings = num(raw.facings, 0);
  if (facings <= 0) throw new Error('sheet manifest: missing or invalid "facings"');

  const base = {
    facings,
    facingOffset: num(raw.facingOffset, 0),
    facingReverse: raw.facingReverse === true,
    scale: num(raw.scale, 1),
    ...parseAxis(raw.turretAxisPx, facings),
  };

  if (isRecord(raw.clips)) {
    const clips: Record<string, ClipSpec> = {};
    for (const [name, spec] of Object.entries(raw.clips)) {
      if (!isRecord(spec)) continue;
      const frames = num(spec.frames, 0);
      if (frames <= 0) continue;
      clips[name] = { frames, fps: num(spec.fps, 0), loop: spec.loop === true, fileOffset: 0 };
    }
    if (!clips.idle) {
      throw new Error('sheet manifest: clip layout must declare an "idle" clip to fall back to');
    }
    return { ...base, layout: 'clip', clips: clips as SheetSpec['clips'] };
  }

  // Legacy flat layout: frame 0 is idle, any remainder is the walk cycle.
  const total = Math.max(1, Math.floor(num(raw.frames, 1)));
  const clips: Record<string, ClipSpec> = {
    idle: { frames: 1, fps: 0, loop: false, fileOffset: 0 },
  };
  if (total > 1) {
    clips.move = { frames: total - 1, fps: 0, loop: true, fileOffset: 1 };
  }
  return { ...base, layout: 'legacy', clips: clips as SheetSpec['clips'] };
}

/**
 * Parse a structure manifest as written by `render_building.py`.
 *
 * `badgeTopPx` is optional on purpose: a building sheet rendered before the field
 * existed still loads, and the renderer falls back to `heightPx` for it rather
 * than drawing the badge in the wrong place with false confidence.
 */
export function parseStructureManifest(raw: unknown): StructureSpec {
  if (!isRecord(raw)) throw new Error('structure manifest: expected an object');
  const files = Array.isArray(raw.files) ? raw.files : [];
  // Found by clip, not by position. files[0] happened to be idle while a
  // building sheet had exactly one frame; now that wrecks exist, relying on
  // order would be one reordering away from drawing rubble on a live building.
  const pick = (clip: string): string | null => {
    for (const f of files) {
      if (isRecord(f) && f.clip === clip && typeof f.file === 'string') return f.file;
    }
    return null;
  };
  const firstFile =
    files.length > 0 && isRecord(files[0]) && typeof files[0].file === 'string'
      ? files[0].file
      : 'idle_f00_000.png';
  const file = pick('idle') ?? firstFile;
  const wreckFile = pick('wreck');
  const badge = raw.badgeTopPx;
  const roof = raw.roofTopPx;
  return {
    scale: num(raw.scale, 1),
    badgeTopPx: typeof badge === 'number' && Number.isFinite(badge) ? badge : null,
    roofTopPx: typeof roof === 'number' && Number.isFinite(roof) ? roof : null,
    file,
    wreckFile,
  };
}

/** File name for one frame of one clip, in the sheet's own layout. */
export function frameFileName(
  sheet: SheetSpec,
  clip: ClipName,
  facing: number,
  frame: number
): string {
  const spec = sheet.clips[clip];
  const index = (spec?.fileOffset ?? 0) + frame;
  const f = facing.toString().padStart(2, '0');
  const n = index.toString().padStart(3, '0');
  return sheet.layout === 'clip' ? `${clip}_f${f}_${n}.png` : `f${f}_${n}.png`;
}

/**
 * Requested clip, or `idle` when this sheet has not authored it.
 *
 * Degrading rather than throwing is what makes the asset roster additive:
 * a sheet with no `fire` yet simply keeps standing there.
 */
export function clipOrFallback(sheet: SheetSpec, clip: ClipName): ClipName {
  return sheet.clips[clip] ? clip : 'idle';
}
