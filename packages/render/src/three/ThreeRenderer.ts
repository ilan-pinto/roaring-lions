/**
 * The three.js backend. Phase B1: it exists, it sizes itself, and its camera
 * agrees with PixiRenderer's projection. It draws nothing yet.
 *
 * Unimplemented members throw rather than no-op on purpose. A no-op renderer
 * looks like a working renderer drawing an empty world, and the failure would
 * surface as "the map is blank" three sub-plans later instead of as a stack
 * trace naming the method.
 */
import * as THREE from 'three';
import type { Sim } from '@lions/sim';
import type { Renderer, RendererOptions } from '../api'; // both, after Step 2
import type { Camera } from '../project';
import { dimetricCamera, worldToScreenThree, screenToWorldThree } from './camera';
import { applyPalettePipeline, setPaletteClearColor } from './palette-material';

function notYet(member: string): never {
  throw new Error(
    `ThreeRenderer.${member} is not implemented until a later Phase B sub-plan. ` +
      `Use ?renderer=pixi (the default) for anything that needs it.`
  );
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
    // Order is load-bearing, not cosmetic: three.js's WebGLBackground.setClear
    // converts the stored clear colour via `color.getRGB(_rgb,
    // getUnlitUniformColorSpace(renderer))`, and for the default render
    // target that resolves to `renderer.outputColorSpace` -- read
    // SYNCHRONOUSLY, at the moment `renderer.setClearColor()` is called, not
    // lazily at frame time. Calling applyPalettePipeline first means that
    // read sees the pass-through LinearSRGBColorSpace this pipeline requires;
    // calling it after would bake in a conversion against three.js's default
    // outputColorSpace (SRGBColorSpace) instead. setPaletteClearColor must
    // also build the colour through the same no-convert path, or it lands
    // off-palette on its own -- Phase 0 measured the naive `setClearColor(hex)`
    // background at #93744C instead of its actual palette entry #C8B494.
    applyPalettePipeline(this.renderer);
    setPaletteClearColor(this.renderer, this.opts.background);
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
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(this.renderer.domElement);
    await Promise.resolve();
    // Stored for a later sub-plan (resize handling); read once so
    // tsc's noUnusedLocals does not flag it as dead.
    void this.host;
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

  pickUnit(): number {
    return notYet('pickUnit');
  }
  isVisible(): boolean {
    return notYet('isVisible');
  }
  unitsInScreenRect(): number[] {
    return notYet('unitsInScreenRect');
  }
  setElevation(): void {
    return notYet('setElevation');
  }
  setDecor(): void {
    return notYet('setDecor');
  }
  useEmitters(): void {
    return notYet('useEmitters');
  }
  async loadSprites(): Promise<void> {
    return notYet('loadSprites');
  }
  async loadStructureSprite(): Promise<void> {
    return notYet('loadStructureSprite');
  }
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
