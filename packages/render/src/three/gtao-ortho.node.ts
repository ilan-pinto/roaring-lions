/**
 * GH-943 P1 (T7 fix): `GTAONode` with a view direction that is right for an ORTHOGRAPHIC camera.
 *
 * three 0.186.1's `GTAONode.setup` hard-codes `viewDir = normalize(-viewPosition)` (GTAONode.js, the line after `invRadius`), which
 * is the direction to the eye of a PERSPECTIVE camera. The game camera is orthographic: every view ray is (0, 0, -1), so the
 * direction to the camera is the constant (0, 0, 1) -- what legacy `GTAOPass` does with `PERSPECTIVE_CAMERA = 0`. With the stock
 * node the horizon angles drift towards the frame edges.
 *
 * The stock setup is a closure with no seam for that one line, so `setup` is COPIED here with the line routed through
 * `viewDirOf`, keyed on `camera.isOrthographicCamera`. Everything else is the stock body, to the statement; a perspective camera
 * gets the stock expression. `viewDirOf` is the unit-tested seam. The three-version pin in `post-chain.node.ao.test.ts` says when
 * to re-diff this against the addon.
 *
 * ADDON-FREE: nothing is imported at runtime. The `GTAONode` class and the TSL namespace arrive through `deps` (the node backend
 * loads them), so this file may sit in the node chunk without pulling an addon in by itself.
 *
 * The node-graph builders chain dozens of dynamic TSL methods that `three/tsl`'s types cannot follow, so the body is typed loosely
 * on purpose, in this one file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as THREE from 'three';

type L = any;

export interface OrthoGtaoDeps {
  readonly TSL: L;
  /** The addon's default export. */
  readonly GTAONode: new (depth: L, normal: L, camera: THREE.Camera) => L;
}

export function createOrthoAwareGtao(deps: OrthoGtaoDeps): (depth: L, normal: L, camera: THREE.Camera) => L {
  const T = deps.TSL;
  class OrthoGTAONode extends deps.GTAONode {
    readonly orthographic: boolean;

    constructor(depth: L, normal: L, camera: THREE.Camera) {
      super(depth, normal, camera);
      this.orthographic = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
    }

    /** The direction from a fragment to the eye, in view space. Constant for an orthographic camera. */
    viewDirOf(viewPosition: L): L {
      if (this.orthographic) return T.vec3(0, 0, 1);
      return T.normalize(viewPosition.xyz.negate());
    }

    setup(builder: L): L {
      const { uv, Fn, float, int, vec2, vec3, vec4, dot, max, min, pow, abs, If, Loop, textureSize, sin, cos, PI, mat3, normalize, cross, mix, acos, clamp } = T;
      const uvNode = uv();

      const linearizeDepth = (depth: L): L => {
        if (builder.renderer.logarithmicDepthBuffer === true) {
          const viewZ = T.logarithmicDepthToViewZ(depth, this._cameraNear, this._cameraFar);
          return T.viewZToPerspectiveDepth(viewZ, this._cameraNear, this._cameraFar);
        }
        return depth;
      };
      const sampleDepth = (u: L): L => linearizeDepth(this.depthNode.sample(u).r);
      const sampleCenterDepth = (u: L): L => {
        const g = this.depthNode.gather().sample(u);
        return linearizeDepth(min(min(g.x, g.y), min(g.z, g.w)));
      };
      const sampleNoise = (u: L): L => this._noiseNode.sample(u);
      const sampleNormal = (u: L): L =>
        this.normalNode !== null
          ? this.normalNode.sample(u).rgb.normalize()
          : T.getNormalFromDepth(u, this.depthNode.value, this._cameraProjectionMatrixInverse);

      this._ao = Fn(() => {
        const depth = this._resolutionScale.lessThan(1).select(sampleCenterDepth(uvNode), sampleDepth(uvNode)).toConst();
        depth.greaterThanEqual(1.0).discard();

        const viewPosition = T.getViewPosition(uvNode, depth, this._cameraProjectionMatrixInverse).toConst();
        const viewNormal = sampleNormal(uvNode).toConst();

        const radius = this.radius;
        const invRadius = radius.reciprocal().toConst();
        const viewDir = this.viewDirOf(viewPosition).toConst();
        const clipPosition = this._cameraProjectionMatrix.mul(vec4(viewPosition, 1.0)).toConst();

        const noiseResolution = textureSize(this._noiseNode, 0);
        let noiseUv = vec2(uvNode.x, uvNode.y.oneMinus());
        noiseUv = noiseUv.mul(this._resolution.div(noiseResolution));

        const noiseTexel = sampleNoise(noiseUv);
        const randomVec = noiseTexel.xyz.mul(2.0).sub(1.0);
        const tangent = vec3(randomVec.xy, 0.0).normalize();
        const bitangent = vec3(tangent.y.mul(-1.0), tangent.x, 0.0);
        const kernelMatrix = mat3(tangent, bitangent, vec3(0.0, 0.0, 1.0));

        const SAMPLES = this.samples.value;
        const DIRECTIONS = SAMPLES < 30 ? 3 : 5;
        const STEPS = Math.ceil(SAMPLES / DIRECTIONS);
        const invSteps = 1 / STEPS;

        const ao = float(0).toVar();

        const noiseJitterIdx = this._temporalDirection.mul(0.02);
        const stepJitter = T.interleavedGradientNoise(T.screenCoordinate.add(this._temporalOffset)).add(
          T.rand(uvNode.add(noiseJitterIdx).mul(2).sub(1))
        );

        Loop({ start: int(0), end: int(DIRECTIONS), type: 'int', condition: '<' }, ({ i }: L) => {
          const angle = float(i).div(DIRECTIONS).mul(PI).add(this._temporalDirection).toConst();
          const sampleDir = kernelMatrix.mul(vec3(cos(angle), sin(angle), 0)).toConst();
          const clipDirRadius = this._cameraProjectionMatrix.mul(vec4(sampleDir, 0.0)).mul(radius).toConst();

          const sliceBitangent = normalize(cross(sampleDir, viewDir)).toConst();
          const sliceTangent = cross(sliceBitangent, viewDir).toConst();

          const projNRaw = viewNormal.sub(sliceBitangent.mul(dot(viewNormal, sliceBitangent))).toConst();
          const projNLen = projNRaw.length().toConst();
          const projN = projNRaw.div(max(projNLen, float(0.0001))).toConst();

          const nSin = dot(projN, sliceTangent).toConst();
          const nCos = clamp(dot(projN, viewDir), 0, 1).toConst();
          const signNSin = nSin.greaterThanEqual(0).select(float(1), float(-1));
          const angleN = signNSin.mul(acos(nCos)).toConst();

          const tangentToNormalInSlice = cross(projN, sliceBitangent).toConst();
          const cosHorizon = dot(viewDir, tangentToNormalInSlice).toConst();
          const cosHorizons = vec2(cosHorizon, cosHorizon.negate()).toVar();

          Loop({ end: int(STEPS), type: 'int', name: 'j', condition: '<' }, ({ j }: L) => {
            const t = float(j).add(1.0).add(stepJitter).mul(invSteps).toConst();
            const sampleDist = t.mul(t);
            const clipOffset = clipDirRadius.mul(sampleDist).toConst();

            const sampleScreenPositionX = T.getScreenPositionFromClip(clipPosition.add(clipOffset)).toConst();
            const sampleDepthX = sampleDepth(sampleScreenPositionX).toConst();
            const sampleSceneViewPositionX = T.getViewPosition(sampleScreenPositionX, sampleDepthX, this._cameraProjectionMatrixInverse).toConst();
            const viewDeltaX = sampleSceneViewPositionX.sub(viewPosition).toConst();
            const lenX = viewDeltaX.length().toConst();
            const sHX = dot(viewDir, viewDeltaX).div(max(lenX, float(0.0001)));
            const distFacX = min(lenX.mul(invRadius), 1);
            const distFacSqX = distFacX.mul(distFacX);
            If(abs(viewDeltaX.z).lessThan(this.thickness), () => {
              cosHorizons.x.assign(mix(max(cosHorizons.x, sHX), cosHorizons.x, distFacSqX));
            });

            const sampleScreenPositionY = T.getScreenPositionFromClip(clipPosition.sub(clipOffset)).toConst();
            const sampleDepthY = sampleDepth(sampleScreenPositionY).toConst();
            const sampleSceneViewPositionY = T.getViewPosition(sampleScreenPositionY, sampleDepthY, this._cameraProjectionMatrixInverse).toConst();
            const viewDeltaY = sampleSceneViewPositionY.sub(viewPosition).toConst();
            const lenY = viewDeltaY.length().toConst();
            const sHY = dot(viewDir, viewDeltaY).div(max(lenY, float(0.0001)));
            const distFacY = min(lenY.mul(invRadius), 1);
            const distFacSqY = distFacY.mul(distFacY);
            If(abs(viewDeltaY.z).lessThan(this.thickness), () => {
              cosHorizons.y.assign(mix(max(cosHorizons.y, sHY), cosHorizons.y, distFacSqY));
            });
          });

          const hPos = acos(cosHorizons.y).toConst();
          const hNeg = acos(cosHorizons.x).negate().toConst();

          const termPos = cos(hPos.mul(2).sub(angleN)).negate().add(nCos).add(hPos.mul(2).mul(nSin));
          const termNeg = cos(hNeg.mul(2).sub(angleN)).negate().add(nCos).add(hNeg.mul(2).mul(nSin));
          const a = termPos.add(termNeg).mul(0.25);

          ao.addAssign(projNLen.mul(a));
        });

        ao.assign(clamp(ao.div(DIRECTIONS), 0, 1));
        ao.assign(pow(ao, this.scale));

        return ao;
      });

      this._sharedContext = builder.getSharedContext();
      this._currentSamples = this.samples.value;

      this._material.contextNode = T.context(builder.getSharedContext());
      this._material.fragmentNode = this._ao();
      this._material.needsUpdate = true;

      return this._textureNode;
    }
  }
  return (depth, normal, camera) => new OrthoGTAONode(T.nodeObject(depth), T.nodeObject(normal), camera);
}
