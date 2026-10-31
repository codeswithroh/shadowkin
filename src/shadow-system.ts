/**
 * Shadowkin's core loop.
 *
 * A virtual lantern sits near the player. Each tracked hand is projected from
 * the lantern onto the first real surface its shadow would land on (a detected
 * wall or table plane), drawn there as a soft shadow, and scored against the
 * current target silhouette. A target glow sits under the shadow showing what
 * to make; hold a close enough match and the shadow comes alive as a creature.
 *
 * Without an XR session the same loop runs in the browser against a virtual
 * desk and wall, with a simulated hand on the mouse (keys 0-4 change its pose),
 * so the whole pipeline can be checked on desktop.
 */

import {
  CanvasTexture,
  createSystem,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  XRPlane,
} from '@iwsdk/core';
import { CREATURE_FILL, buildCreatureMaterials } from './creature-art.js';
import { Shadowkin } from './creature-component.js';
import { HandJoints, JOINT_COUNT, JOINT_NAMES, poseHand, straightPose } from './hand-skeleton.js';
import { Normalization, ShapeMatcher } from './matcher.js';
import {
  createSurface,
  drawShadowPath,
  orientSurface,
  projectHand,
  rayHit,
  Shadow2D,
  Surface,
  surfaceFromPlane,
} from './shadow-projector.js';
import { PreparedSilhouette, prepareSilhouettes } from './silhouettes.js';

const MATCH_THRESHOLD = 0.66;
const HOLD_SECONDS = 0.8;
const SCORE_INTERVAL = 1 / 15;
const MAX_CREATURES = 8;
const SHADOW_CANVAS = 256;
const SURFACE_OFFSET = 0.003;
const VIRTUAL_SCREEN_DISTANCE = 0.8;
const PINCH_DISTANCE = 0.022;
const LANTERN_GRAB_RADIUS = 0.09;

/** Per-hand state: joints, where the shadow lands, and its on-surface display. */
class HandShadow {
  readonly joints = new HandJoints();
  readonly shadow = new Shadow2D();
  readonly norm: Normalization = { cu: 0, cv: 0, area: 1 };
  surface: Surface | null = null;
  normValid = false;
  score = 0;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Shadow drawn opaque first, then composited once at shadow opacity. */
  readonly layer: HTMLCanvasElement;
  readonly layerCtx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  readonly mesh: Mesh;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SHADOW_CANVAS;
    this.ctx = this.canvas.getContext('2d')!;
    this.layer = document.createElement('canvas');
    this.layer.width = this.layer.height = SHADOW_CANVAS;
    this.layerCtx = this.layer.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }
}

export class ShadowSystem extends createSystem({
  planes: { required: [XRPlane] },
  creatures: { required: [Shadowkin] },
}) {
  private matcher!: ShapeMatcher;
  private targets!: PreparedSilhouette[];
  private creatureMaterials!: MeshBasicMaterial[];
  private creatureGeometry!: PlaneGeometry;
  private hands!: HandShadow[];
  private lantern!: Group;
  private lanternPlaced = false;
  private lanternHeldBy = -1;
  private hud!: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: CanvasTexture; mesh: Mesh };
  private chime!: HTMLAudioElement;

  private surfacePool: Surface[] = [];
  private surfaceCount = 0;
  private desktopSurfaces: Surface[] = [];
  private virtualScreen!: Surface;
  private virtualScreenMesh!: Mesh;
  private desktopProps!: Group;

  private targetIndex = 0;
  private progress = 0;
  private smoothedScore = 0;
  private scoreTimer = 0;
  private cooldown = 0;
  private creatureCount = 0;
  private sessionWasActive: boolean | null = null;
  /** Seconds since the XR session started; the head pose settles after a few frames. */
  private xrTime = 0;

  private sim = {
    pose: straightPose(),
    poseIndex: -1,
    x: 0,
    y: 0,
    roll: 0,
  };

  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly palm = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly basis = new Matrix4();
  private readonly simPosition = new Vector3();
  private readonly simRotation = { x: 0, y: 0, z: 0 };

  init(): void {
    this.matcher = new ShapeMatcher();
    this.targets = prepareSilhouettes(this.matcher);
    this.creatureMaterials = buildCreatureMaterials(this.targets);
    this.creatureGeometry = new PlaneGeometry(1, 1);
    this.chime = new Audio(`${import.meta.env.BASE_URL}audio/chime.mp3`);

    this.hands = [new HandShadow(), new HandShadow()];
    for (const hand of this.hands) this.world.createTransformEntity(hand.mesh);

    this.lantern = this.buildLantern();
    this.world.createTransformEntity(this.lantern);
    this.hud = this.buildHud();
    this.world.createTransformEntity(this.hud.mesh);

    this.virtualScreen = createSurface();
    this.virtualScreen.virtual = true;
    this.virtualScreen.label = 'paper';
    this.virtualScreenMesh = new Mesh(
      new PlaneGeometry(0.9, 0.6),
      new MeshBasicMaterial({ color: 0xf3e6cf, transparent: true, opacity: 0.18, depthWrite: false, side: DoubleSide }),
    );
    this.virtualScreenMesh.visible = false;
    this.world.createTransformEntity(this.virtualScreenMesh);

    this.desktopProps = this.buildDesktopProps();
    this.world.createTransformEntity(this.desktopProps);

    const onMove = (e: PointerEvent) => {
      this.sim.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.sim.y = 1 - (e.clientY / window.innerHeight) * 2;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        const i = Number(e.key) - 1;
        this.sim.poseIndex = i < this.targets.length ? i : -1;
        this.sim.pose = i >= 0 && i < this.targets.length ? this.targets[i].def.pose : straightPose();
        this.sim.roll = i >= 0 && i < this.targets.length ? this.targets[i].def.roll : 0;
      } else if (e.key === 'n') {
        this.nextTarget();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('keydown', onKey),
    );

    this.exposeDebug();
  }

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.05);
    const session = this.world.session;
    const inXR = session != null && this.xrFrame != null;

    if (inXR !== this.sessionWasActive) this.onSessionChange(inXR);

    this.updateHead();
    if (inXR) {
      this.readXRHands(session!);
      this.collectPlaneSurfaces();
      this.xrTime += dt;
      if (!this.lanternPlaced && this.xrTime > 0.6) this.placeLantern();
      this.updateLanternGrab();
    } else {
      this.updateSimHand();
    }

    const surfaces = inXR ? this.surfacePool : this.desktopSurfaces;
    const count = inXR ? this.surfaceCount : this.desktopSurfaces.length;
    let usedVirtual = false;
    for (const hand of this.hands) {
      hand.surface = null;
      if (hand.joints.present) {
        hand.surface = this.pickSurface(hand, surfaces, count);
        if (hand.surface === this.virtualScreen) usedVirtual = true;
        if (hand.surface) projectHand(hand.joints, this.lantern.position, hand.surface, hand.shadow);
      }
      if (!hand.surface || !hand.shadow.valid) {
        hand.shadow.valid = false;
        hand.normValid = false;
        hand.score = 0;
      }
    }
    this.virtualScreenMesh.visible = usedVirtual;

    this.scoreTimer += dt;
    if (this.scoreTimer >= SCORE_INTERVAL) {
      this.scoreTimer = 0;
      this.scoreHands();
    }

    this.updateProgress(dt);
    for (const hand of this.hands) this.drawHand(hand, time);
    this.updateLanternGlow(time);
    this.drawHud(time);
  }

  // ---------------------------------------------------------------- input

  private onSessionChange(inXR: boolean): void {
    this.sessionWasActive = inXR;
    this.desktopProps.visible = !inXR;
    this.lanternPlaced = !inXR;
    this.xrTime = 0;
    if (!inXR) this.lantern.position.set(0.14, 0.94, 0.02);
    // Real hands are visible through passthrough; virtual hand meshes would
    // just cover them and the shadow illusion.
    this.input.visualAdapters.hand.left.toggleVisual(!inXR);
    this.input.visualAdapters.hand.right.toggleVisual(!inXR);
  }

  private updateHead(): void {
    // The render camera is the headset in XR and the browser view otherwise.
    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
  }

  private readXRHands(session: XRSession): void {
    const frame = this.xrFrame;
    const space = this.xrManager.getReferenceSpace();
    this.hands[0].joints.present = false;
    this.hands[1].joints.present = false;
    if (!space) return;
    for (const source of session.inputSources) {
      if (!source.hand) continue;
      const hand = this.hands[source.handedness === 'left' ? 0 : 1];
      let ok = true;
      for (let j = 0; j < JOINT_COUNT && ok; j++) {
        const jointSpace = source.hand.get(JOINT_NAMES[j]);
        const pose = jointSpace ? frame.getJointPose?.(jointSpace, space) : undefined;
        if (!pose) {
          ok = false;
          break;
        }
        const p = pose.transform.position;
        hand.joints.positions[j * 3] = p.x;
        hand.joints.positions[j * 3 + 1] = p.y;
        hand.joints.positions[j * 3 + 2] = p.z;
        hand.joints.radii[j] = pose.radius ?? 0.008;
      }
      hand.joints.present = ok;
    }
  }

  /** Desktop stand-in: a right hand that follows the mouse in front of the wall. */
  private updateSimHand(): void {
    this.hands[0].joints.present = false;
    this.simPosition.set(this.sim.x * 0.22, 0.86 + this.sim.y * 0.22, -0.3);
    this.simRotation.z = this.sim.roll;
    poseHand(this.sim.pose, this.simPosition, this.simRotation, this.hands[1].joints);
  }

  private collectPlaneSurfaces(): void {
    this.surfaceCount = 0;
    for (const entity of this.queries.planes.entities) {
      const object = entity.object3D;
      const plane = entity.getValue(XRPlane, '_plane') as globalThis.XRPlane | undefined;
      if (!object || !plane) continue;
      if (this.surfaceCount === this.surfacePool.length) this.surfacePool.push(createSurface());
      const surface = this.surfacePool[this.surfaceCount++];
      surfaceFromPlane(surface, object.position, object.quaternion, plane.polygon, this.forward);
      surface.label = plane.semanticLabel ?? plane.orientation ?? '';
    }
  }

  private placeLantern(): void {
    // Chest height, a little forward: hands held in front of it throw
    // shadows onto the desk or the wall ahead.
    this.lantern.position
      .copy(this.head)
      .addScaledVector(this.forward, 0.16)
      .addScaledVector(this.right, 0.06);
    this.lantern.position.y -= 0.26;
    this.lanternPlaced = true;
  }

  /** Pinch the lantern to pick it up and move it; release to drop. */
  private updateLanternGrab(): void {
    for (let h = 0; h < 2; h++) {
      const joints = this.hands[h].joints;
      const pinching = joints.present && this.pinchPoint(joints, this.tmp);
      if (this.lanternHeldBy === h) {
        if (pinching) this.lantern.position.copy(this.tmp);
        else this.lanternHeldBy = -1;
      } else if (
        this.lanternHeldBy < 0 &&
        pinching &&
        this.tmp.distanceTo(this.lantern.position) < LANTERN_GRAB_RADIUS
      ) {
        this.lanternHeldBy = h;
      }
    }
  }

  private pinchPoint(joints: HandJoints, out: Vector3): boolean {
    out.fromArray(joints.positions, 4 * 3);
    this.tmp2.fromArray(joints.positions, 9 * 3);
    if (out.distanceTo(this.tmp2) > PINCH_DISTANCE) return false;
    out.add(this.tmp2).multiplyScalar(0.5);
    return true;
  }

  // ---------------------------------------------------------------- shadows

  /** First real surface the light-through-palm ray reaches, else a paper screen. */
  private pickSurface(hand: HandShadow, surfaces: Surface[], count: number): Surface | null {
    // The hand holding the lantern casts no shadow.
    if (this.lanternHeldBy >= 0 && this.hands[this.lanternHeldBy] === hand) return null;
    this.palm.fromArray(hand.joints.positions, 0).add(this.tmp.fromArray(hand.joints.positions, 11 * 3));
    this.palm.multiplyScalar(0.5);
    let best: Surface | null = null;
    let bestT = Infinity;
    for (let i = 0; i < count; i++) {
      const t = rayHit(surfaces[i], this.lantern.position, this.palm);
      if (t > 0 && t < bestT && t < 12) {
        bestT = t;
        best = surfaces[i];
      }
    }
    if (best) return best;

    // Nothing real nearby: hang a sheet of paper ahead of the hand.
    this.tmp.subVectors(this.palm, this.lantern.position);
    this.tmp.y *= 0.3;
    if (this.tmp.lengthSq() < 1e-6) return null;
    this.tmp.normalize();
    this.tmp2.copy(this.lantern.position).addScaledVector(this.tmp, VIRTUAL_SCREEN_DISTANCE);
    this.tmp.negate();
    orientSurface(this.virtualScreen, this.tmp2, this.tmp, this.forward);
    this.placeOnSurface(this.virtualScreenMesh, this.virtualScreen, 0, 0, -0.001);
    return this.virtualScreen;
  }

  private scoreHands(): void {
    const target = this.targets[this.targetIndex];
    let best = 0;
    for (const hand of this.hands) {
      hand.normValid = hand.shadow.valid && this.matcher.measure(hand.shadow, hand.norm);
      hand.score = hand.normValid ? this.matcher.score(hand.shadow, hand.norm, target.mask) : 0;
      if (hand.score > best) best = hand.score;
    }
    this.smoothedScore += (best - this.smoothedScore) * 0.45;
  }

  private updateProgress(dt: number): void {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      this.progress = Math.max(0, this.progress - dt * 2);
      return;
    }
    if (this.smoothedScore >= MATCH_THRESHOLD) {
      this.progress = Math.min(1, this.progress + dt / HOLD_SECONDS);
    } else {
      this.progress = Math.max(0, this.progress - dt * 1.5);
    }
    if (this.progress >= 1) {
      const hand = this.hands[0].score >= this.hands[1].score ? this.hands[0] : this.hands[1];
      if (hand.surface && hand.normValid) this.spawnCreature(hand);
      this.cooldown = 1.4;
      this.progress = 0;
      this.smoothedScore = 0;
      this.nextTarget();
    }
  }

  private nextTarget(): void {
    this.targetIndex = (this.targetIndex + 1) % this.targets.length;
  }

  private drawHand(hand: HandShadow, time: number): void {
    const visible = hand.shadow.valid && hand.surface != null;
    hand.mesh.visible = visible;
    if (!visible) return;
    const shadow = hand.shadow;
    const surface = hand.surface!;

    const cu = (shadow.minU + shadow.maxU) / 2;
    const cv = (shadow.minV + shadow.maxV) / 2;
    const extent = Math.max(shadow.maxU - shadow.minU, shadow.maxV - shadow.minV) * 1.5 + 0.06;
    this.placeOnSurface(hand.mesh, surface, cu, cv, SURFACE_OFFSET);
    hand.mesh.scale.set(extent, extent, 1);

    const ctx = hand.ctx;
    const px = SHADOW_CANVAS / extent;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, SHADOW_CANVAS, SHADOW_CANVAS);
    ctx.setTransform(px, 0, 0, -px, SHADOW_CANVAS / 2 - cu * px, SHADOW_CANVAS / 2 + cv * px);

    // The shape to make, as a pool of lantern light the shadow should fill.
    if (hand.normValid && this.cooldown <= 0) {
      const target = this.targets[this.targetIndex];
      const k = Math.sqrt(hand.norm.area / target.norm.area);
      const glow = 0.22 + this.progress * 0.5 + Math.sin(time * 3) * 0.04;
      ctx.save();
      ctx.translate(hand.norm.cu, hand.norm.cv);
      ctx.scale(k, k);
      ctx.translate(-target.norm.cu, -target.norm.cv);
      ctx.globalAlpha = glow;
      ctx.filter = `blur(${Math.round(4 + this.progress * 6)}px)`;
      ctx.fillStyle = target.def.color;
      ctx.strokeStyle = target.def.color;
      drawShadowPath(ctx, target.shadow);
      ctx.restore();
    }

    // Overlapping strokes must not stack up darker at the joints, so draw the
    // shadow opaque on its own layer and blend that in at one opacity.
    const layer = hand.layerCtx;
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.clearRect(0, 0, SHADOW_CANVAS, SHADOW_CANVAS);
    layer.setTransform(px, 0, 0, -px, SHADOW_CANVAS / 2 - cu * px, SHADOW_CANVAS / 2 + cv * px);
    layer.fillStyle = '#0a0616';
    layer.strokeStyle = '#0a0616';
    drawShadowPath(layer, shadow);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.8;
    ctx.filter = 'blur(2px)';
    ctx.drawImage(hand.layer, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    hand.texture.needsUpdate = true;
  }

  private placeOnSurface(mesh: Mesh, surface: Surface, u: number, v: number, offset: number): void {
    this.basis.makeBasis(surface.axisU, surface.axisV, surface.normal);
    mesh.quaternion.setFromRotationMatrix(this.basis);
    mesh.position
      .copy(surface.origin)
      .addScaledVector(surface.axisU, u)
      .addScaledVector(surface.axisV, v)
      .addScaledVector(surface.normal, offset);
  }

  // ---------------------------------------------------------------- creatures

  private spawnCreature(hand: HandShadow): void {
    const creatures = this.queries.creatures.entities;
    if (creatures.size >= MAX_CREATURES) {
      let oldest = null;
      let oldestAge = -1;
      for (const e of creatures) {
        const age = e.getValue(Shadowkin, 'age')!;
        if (age > oldestAge) {
          oldestAge = age;
          oldest = e;
        }
      }
      oldest?.dispose();
    }

    const surface = hand.surface!;
    const mesh = new Mesh(this.creatureGeometry, this.creatureMaterials[this.targetIndex]);
    mesh.renderOrder = 1;
    const entity = this.world.createTransformEntity(mesh);
    entity.addComponent(Shadowkin, {
      silhouette: this.targetIndex,
      size: Math.sqrt(hand.norm.area) / CREATURE_FILL,
      u: hand.norm.cu,
      v: hand.norm.cv,
      homeU: hand.norm.cu,
      homeV: hand.norm.cv,
      heading: Math.random() * Math.PI * 2,
      phase: Math.random(),
    });
    surface.origin.toArray(entity.getVectorView(Shadowkin, 'origin'));
    surface.axisU.toArray(entity.getVectorView(Shadowkin, 'axisU'));
    surface.axisV.toArray(entity.getVectorView(Shadowkin, 'axisV'));
    surface.normal.toArray(entity.getVectorView(Shadowkin, 'normal'));
    this.creatureCount++;

    this.chime.currentTime = 0;
    void this.chime.play().catch(() => undefined);
  }

  // ---------------------------------------------------------------- visuals

  private buildLantern(): Group {
    const group = new Group();
    const flame = new Mesh(
      new SphereGeometry(0.014, 16, 12),
      new MeshBasicMaterial({ color: 0xffd28a }),
    );
    const halo = new Mesh(
      new SphereGeometry(0.03, 16, 12),
      new MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    halo.name = 'halo';
    group.add(flame, halo);
    return group;
  }

  private updateLanternGlow(time: number): void {
    const halo = this.lantern.getObjectByName('halo');
    if (!halo) return;
    const flicker = 1 + Math.sin(time * 13) * 0.05 + Math.sin(time * 7.3) * 0.04 + this.progress * 0.5;
    halo.scale.setScalar(flicker);
  }

  private buildHud() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(
      new PlaneGeometry(0.12, 0.06),
      new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    mesh.renderOrder = 3;
    return { canvas, ctx, texture, mesh };
  }

  /** Small card above the lantern: the shape to make and a hold ring. */
  private drawHud(time: number): void {
    const { ctx, canvas, texture, mesh } = this.hud;
    mesh.position.copy(this.lantern.position);
    mesh.position.y += 0.07;
    mesh.lookAt(this.head);

    const target = this.targets[this.targetIndex];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(20, 14, 30, 0.72)';
    ctx.beginPath();
    ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 24);
    ctx.fill();

    // Target icon.
    const k = 34 / Math.sqrt(target.norm.area);
    ctx.save();
    ctx.translate(64, 64);
    ctx.scale(k, -k);
    ctx.translate(-target.norm.cu, -target.norm.cv);
    ctx.fillStyle = target.def.color;
    ctx.strokeStyle = target.def.color;
    drawShadowPath(ctx, target.shadow);
    ctx.restore();

    // Hold ring.
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.arc(64, 64, 50, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = target.def.color;
    ctx.beginPath();
    ctx.arc(64, 64, 50, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.progress);
    ctx.stroke();

    ctx.fillStyle = '#f5ecdf';
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.fillText(this.cooldown > 0 ? 'Alive!' : target.def.name, 128, 58);
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(245,236,223,0.7)';
    const pct = Math.round(this.smoothedScore * 100);
    ctx.fillText(`${pct}%  ·  ${this.creatureCount} kin`, 128, 90);
    void time;
    texture.needsUpdate = true;
  }

  /** Virtual desk and wall for desktop testing; hidden in XR. */
  private buildDesktopProps(): Group {
    const group = new Group();
    const wallMat = new MeshBasicMaterial({ color: 0xd9cbb4 });
    const deskMat = new MeshBasicMaterial({ color: 0x8a6a4f });
    const wall = new Mesh(new PlaneGeometry(2.4, 1.6), wallMat);
    wall.position.set(0, 1.4, -1.0);
    const desk = new Mesh(new PlaneGeometry(1.4, 0.8), deskMat);
    desk.rotation.x = -Math.PI / 2;
    desk.position.set(0, 0.72, -0.6);
    group.add(wall, desk);

    const wallSurface = createSurface();
    wallSurface.label = 'wall';
    orientSurface(wallSurface, wall.position, new Vector3(0, 0, 1), new Vector3(0, 0, -1));
    wallSurface.polygon = new Float32Array([-1.2, -0.8, 1.2, -0.8, 1.2, 0.8, -1.2, 0.8]);
    const deskSurface = createSurface();
    deskSurface.label = 'table';
    orientSurface(deskSurface, desk.position, new Vector3(0, 1, 0), new Vector3(0, 0, -1));
    deskSurface.polygon = new Float32Array([-0.7, -0.4, 0.7, -0.4, 0.7, 0.4, -0.7, 0.4]);
    this.desktopSurfaces = [wallSurface, deskSurface];
    return group;
  }

  /** Read-only hooks for automated checks (`window.__shadowkin`). */
  private exposeDebug(): void {
    (window as unknown as { __shadowkin: unknown }).__shadowkin = {
      state: () => ({
        target: this.targets[this.targetIndex].def.id,
        score: Number(this.smoothedScore.toFixed(3)),
        rawScores: this.hands.map((h) => Number(h.score.toFixed(3))),
        progress: Number(this.progress.toFixed(3)),
        creatures: this.queries.creatures.entities.size,
        surfaces: this.hands.map((h) => h.surface?.label ?? null),
        lantern: this.lantern.position.toArray().map((n) => Number(n.toFixed(3))),
      }),
      shapes: () => ({
        targets: this.targets.map((t) => ({
          id: t.def.id,
          bbox: [t.shadow.minU, t.shadow.maxU, t.shadow.minV, t.shadow.maxV].map((n) => Number(n.toFixed(3))),
          norm: t.norm,
          tips: [4, 9, 14, 19, 24].map((j) => [t.shadow.points[j * 2], t.shadow.points[j * 2 + 1]].map((n) => Number(n.toFixed(3)))),
          maskSum: t.mask.reduce((a, b) => a + b, 0),
        })),
        hands: this.hands.map((h) => ({
          valid: h.shadow.valid,
          bbox: [h.shadow.minU, h.shadow.maxU, h.shadow.minV, h.shadow.maxV].map((n) => Number(n.toFixed(3))),
          norm: h.norm,
        })),
      }),
      selfTest: () =>
        this.targets.map((t) => ({
          id: t.def.id,
          scores: this.targets.map((o) => Number(this.matcher.score(o.shadow, o.norm, t.mask).toFixed(2))),
        })),
    };
  }
}
