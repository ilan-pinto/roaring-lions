/**
 * The three.js backend. Phase B1: it exists, it sizes itself, it follows the
 * window, and its camera agrees with PixiRenderer's projection. It draws
 * nothing but the clear colour.
 *
 * Two kinds of unimplemented member, and the difference is deliberate:
 *
 *  - **Data pushed in** (`setDecor`, `setElevation`, `useEmitters`, the two
 *    sprite loaders) *retain* their argument and return. The app's boot path
 *    calls all five before the first frame, and the data is genuinely
 *    correct -- it has arrived, it simply is not drawn until B2/B3. Throwing
 *    here made `?renderer=three` unreachable: the boot threw at `setDecor`
 *    before `init` ever appended the canvas, so the one thing B1 does draw
 *    could not be seen through the shipped path at all.
 *  - **Queries** (`pickUnit`, `isVisible`, `unitsInScreenRect`) still throw.
 *    There is no honest answer to "which unit is under this point" in a
 *    backend that has drawn no units, and a plausible-looking fake -- `-1`,
 *    `false`, `[]` -- would read as "nothing is there" and be believed. A
 *    stack trace naming the method is the better failure.
 *
 * Presentation commands the app drives (`addOrderMarker`, the tutorial focus
 * pair) also still throw: they are not world data, nothing in the boot path
 * reaches them, and each is a drawing instruction whose whole content is the
 * drawing.
 */
import * as THREE from 'three';
import type { Sim } from '@lions/sim';
import type { Renderer, RendererOptions } from '../api'; // both, after Step 2
import type { Camera } from '../project';
import type { EmitterSpec } from '../vfx';
import { dimetricCamera, worldToScreenThree, screenToWorldThree } from './camera';
import { applyPalettePipeline } from './palette-material';

function notYet(member: string): never {
  throw new Error(
    `ThreeRenderer.${member} is not implemented until a later Phase B sub-plan. ` +
      `Use ?renderer=pixi (the default) for anything that needs it.`
  );
}

/** Where a unit type's sheets live, as the app named them. */
interface SpriteSheetRequest {
  basePath: string;
  turretPath?: string;
}

export class ThreeRenderer implements Renderer {
  readonly camera: Camera = { x: 24, y: 24, zoom: 1 };
  selection: number[] = [];
  readonly unitGroup: Uint8Array;
  hoverEntity = -1;
  hoverStructure = -1;
  hoverCanGarrison = false;
  objectiveZone: readonly number[] | null = null;
  objectiveZoneState: 'held' | 'unheld' | 'contested' = 'held';

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /**
   * World data the app has already handed over and B1 does not draw.
   *
   * One bag rather than six fields on purpose: the whole of it is "kept for
   * the sub-plan that will consume it", so it is worth being able to see at a
   * glance what B2/B3 inherit and that nothing else reads any of it yet.
   * Terrain (`decor`, `elevation`) is B2's; the emitter list and its palette
   * resolver are VFX, which is B4's; the two sheet maps are B3's.
   */
  private readonly retained = {
    decor: null as Uint8Array | null,
    elevation: null as Uint8Array | null,
    emitters: [] as EmitterSpec[],
    resolveColor: null as ((key: string) => string) | null,
    unitSheets: new Map<string, SpriteSheetRequest>(),
    structureSheets: new Map<string, string>(),
  };

  constructor(
    private readonly sim: Sim,
    private readonly opts: RendererOptions
  ) {
    this.unitGroup = new Uint8Array(sim.capacity);
    // antialias stays off deliberately (Phase 0 verdict, "Antialiasing must
    // be off, or accounted for"): a blended edge pixel is by definition not
    // a palette colour, and this backend's sprite/toon pipeline quantizes
    // rather than blends. Do not re-enable it without accounting for edges.
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    // outputColorSpace and the clear colour, in the one order that is
    // correct -- see palette-material.ts's module doc comment for why
    // three.js reads outputColorSpace synchronously inside setClearColor(),
    // which is exactly why this is a single call rather than two lines a
    // future edit could reorder.
    applyPalettePipeline(this.renderer, this.opts.background);
    // `sim` has nothing to read yet -- terrain and units arrive in B2/B3.
    // Read once so tsc's noUnusedLocals does not flag a field kept for a
    // later sub-plan rather than dead code.
    void this.sim;
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
  get width(): number {
    return this.renderer.domElement.width;
  }
  get height(): number {
    return this.renderer.domElement.height;
  }

  async init(host: HTMLElement): Promise<void> {
    this.host = host;
    this.renderer.setPixelRatio(1);
    this.fitToHost();
    host.appendChild(this.renderer.domElement);
    // PixiRenderer gets this from `resizeTo: host` (renderer.ts). Without an
    // equivalent the three canvas would stay at boot size while `width`/
    // `height` -- which `worldToScreen`/`screenToWorld` both read off the
    // canvas -- kept reporting it, so the two backends would disagree by
    // exactly the resize delta and every pointer read would land on the
    // wrong tile.
    //
    // A ResizeObserver on the host rather than a window `resize` listener:
    // it covers the window case and also the ones a window listener misses
    // (a sidebar opening, the host's own layout changing, devtools docking),
    // and it is scoped to the element this renderer actually fills.
    this.resizeObserver = new ResizeObserver(() => {
      this.fitToHost();
    });
    this.resizeObserver.observe(host);
    await Promise.resolve();
  }

  /**
   * Release the GPU context and stop observing the host.
   *
   * Nothing calls this today: `main()` has no shutdown path -- see the `void
   * rafId` note at the end of it -- so there is no sensible place to hang
   * teardown off. It exists so the observer has a documented owner rather
   * than being a listener with no way to remove it, and so a future teardown
   * has one call to make instead of having to learn this class's internals.
   */
  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer.dispose();
    this.host = null;
  }

  /** Size the drawing buffer to the host element, exactly as Pixi's
   *  `resizeTo` does: `clientWidth`/`clientHeight`, at resolution 1. No clamp
   *  to a minimum -- a zero-sized host produces a zero-sized canvas on both
   *  backends, and inventing a 1x1 floor here would make them disagree. */
  private fitToHost(): void {
    if (!this.host) return;
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
  }

  /** `alpha`/`dtMs` (interpolation, presentation animation) go unread until
   *  B2/B3 draw anything they could apply to. */
  frame(): void {
    // B1 draws only the clear colour. B2 adds terrain.
    this.renderer.render(this.scene, this.threeCamera());
  }

  snapshot(): void {
    /* nothing to latch until B3 draws units */
  }
  onEvents(): void {
    /* B3 */
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return worldToScreenThree(wx, wy, this.camera, { width: this.width, height: this.height });
  }
  screenToWorld(px: number, py: number): { x: number; y: number } {
    return screenToWorldThree(px, py, this.camera, { width: this.width, height: this.height });
  }

  // --- queries. The line is between *inventing* an answer and *reporting the
  //     current state truthfully*, not between "implemented" and "not".
  pickUnit(): number {
    return notYet('pickUnit');
  }
  /**
   * True, always -- and this is the correct answer, not a placeholder.
   *
   * Fog is B4. This backend has no fog system, so nothing is hidden, so every
   * world point is visible. B4 replaces this with a real visibility query
   * against the fog it introduces.
   *
   * It matters that this does not throw: `updateHover()` calls it once per
   * living hostile every rAF iteration, so a throw here was a 60 Hz stream of
   * expected errors -- which drowns the diagnostics B2 will need and trains
   * everyone to stop reading the console.
   */
  isVisible(): boolean {
    return true;
  }
  unitsInScreenRect(): number[] {
    return notYet('unitsInScreenRect');
  }

  // --- world data pushed in: retained for the sub-plan that will draw it.
  setElevation(elevation: Uint8Array): void {
    this.retained.elevation = elevation;
  }
  setDecor(decor: Uint8Array): void {
    this.retained.decor = decor;
  }
  useEmitters(list: EmitterSpec[], resolve: (key: string) => string): void {
    this.retained.emitters = list;
    this.retained.resolveColor = resolve;
  }
  async loadSprites(
    unitTypeId: string,
    basePath: string,
    opts?: { turretPath?: string }
  ): Promise<void> {
    this.retained.unitSheets.set(unitTypeId, { basePath, turretPath: opts?.turretPath });
    await Promise.resolve();
  }
  async loadStructureSprite(structureId: string, basePath: string): Promise<void> {
    this.retained.structureSheets.set(structureId, basePath);
    await Promise.resolve();
  }

  // --- presentation commands: the instruction IS the drawing, so there is
  //     nothing to retain and nothing honest to do with one yet.
  addOrderMarker(): void {
    return notYet('addOrderMarker');
  }
  setTutorialFocus(): void {
    return notYet('setTutorialFocus');
  }
  clearTutorialFocus(): void {
    return notYet('clearTutorialFocus');
  }

  private threeCamera(): THREE.OrthographicCamera {
    return dimetricCamera(this.camera, { width: this.width, height: this.height });
  }
}
