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
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    // "frame() draws only the clear colour" (below) means this, honestly.
    this.renderer.setClearColor(this.opts.background);
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

  worldToScreen(): { x: number; y: number } {
    return notYet('worldToScreen'); // Task B1.2
  }
  screenToWorld(): { x: number; y: number } {
    return notYet('screenToWorld'); // Task B1.2
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
    return notYet('threeCamera'); // Task B1.2
  }
}
