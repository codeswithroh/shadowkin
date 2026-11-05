/**
 * Shadowkin's core loop.
 *
 * A paper lantern sits near the player. Each tracked hand is projected from
 * the lantern's flame onto the first real surface its shadow would land on (a
 * detected wall or table plane), drawn there as a soft shadow inside a pool of
 * lantern light, and scored against the current target silhouette. The target
 * shows as a faint glow under your shadow; hold a close enough match and the
 * shadow comes alive as a creature that stays in your room.
 *
 * Progression: the first shape is a tutorial (Starfish), then today's shadow
 * (the same for everyone on a date), then each kin you make reveals the next
 * shape. Creatures are saved relative to a persistent anchor (the nest) so
 * they're where you left them next time.
 *
 * Without an XR session the same loop runs in the browser against a virtual
 * desk and wall, with a simulated hand on the mouse (keys 0-6 change its pose),
 * so the whole pipeline can be checked on desktop.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  createSystem,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  XRPlane,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { CREATURE_FILL, CreatureLook, buildCreatureLooks, eyeGeometry } from './creature-art.js';
import { Mood, Shadowkin } from './creature-component.js';
import { Particles, radialTexture } from './fx.js';
import { HandJoints, JOINT_COUNT, JOINT_NAMES, poseHand, straightPose } from './hand-skeleton.js';
import { buildLantern, LanternParts } from './lantern.js';
import { Normalization, ShapeMatcher } from './matcher.js';
import { MenuAction, PalmMenu } from './palm-menu.js';
import {
  completeDaily,
  dailySilhouette,
  loadSave,
  metCount,
  rollDay,
  SaveData,
  SavedCreature,
  today,
  unlockedCount,
  writeSave,
} from './save.js';
import {
  createSurface,
  drawShadowGroup,
  orientSurface,
  projectHand,
  rayHit,
  Shadow2D,
  ShadowGroup,
  Surface,
  surfaceFromPlane,
} from './shadow-projector.js';
import { fxQueue, shared } from './shared.js';
import { HandPlacement, PreparedSilhouette, prepareSilhouettes, SILHOUETTES, WOLF_INDEX } from './silhouettes.js';

const NORMAL = { threshold: 0.66, hold: 0.8 };
const EASY = { threshold: 0.56, hold: 0.5 };
const WOLF_THRESHOLD = 0.62;
const SCORE_INTERVAL = 1 / 15;
const WOLF_INTERVAL = 1 / 5;
const MAX_CREATURES = 10;
const SHADOW_CANVAS = 512;
const SURFACE_OFFSET = 0.003;
const VIRTUAL_SCREEN_DISTANCE = 0.8;
const PAPER_W = 0.9;
const PAPER_H = 0.6;
const PINCH_DISTANCE = 0.022;
const LANTERN_GRAB_RADIUS = 0.09;
const FLAME_RADIUS = 0.0015;
const ARM_SHIFT = 0.5;
/** Surfaces further than this many hand-distances from the lantern are ignored. */
const MAX_MAGNIFICATION = 24;
const SAVE_INTERVAL = 5;
const NEST_RESTORE_TIMEOUT = 4;

type NativeAnchor = {
  anchorSpace: XRSpace;
  requestPersistentHandle?: () => Promise<string>;
  delete?: () => void;
};
type AnchorSession = XRSession & {
  restorePersistentAnchor?: (uuid: string) => Promise<NativeAnchor>;
  deletePersistentAnchor?: (uuid: string) => Promise<void>;
};
type AnchorFrame = XRFrame & {
  createAnchor?: (pose: XRRigidTransform, space: XRSpace) => Promise<NativeAnchor>;
};

/** Per-hand state: joints, where the shadow lands, and its on-surface display. */
class HandShadow {
  readonly joints = new HandJoints();
  readonly shadow = new Shadow2D();
  surface: Surface | null = null;
  /** Light-to-surface over light-to-palm distance; sets shadow softness. */
  t = 1;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Shadow drawn opaque first, then composited once at shadow opacity. */
  readonly layer: HTMLCanvasElement;
  readonly layerCtx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  readonly mesh: Mesh;
  readonly pool: Mesh;
  readonly lastCenter = new Vector3();
  hadCenter = false;

  constructor(poolMaterial: MeshBasicMaterial) {
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
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, side: DoubleSide }),
    );
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.pool = new Mesh(new PlaneGeometry(1, 1), poolMaterial);
    this.pool.renderOrder = 0;
    this.pool.visible = false;
  }
}

/** A shadow shape that can be scored: one hand, or both hands on one surface. */
class Cast {
  /** Where it lands, for drawing, the guide glow and spawning. */
  readonly group = new ShadowGroup();
  readonly norm: Normalization = { cu: 0, cv: 0, area: 1 };
  surface: Surface | null = null;
  /**
   * The same hands projected onto a screen square to the light: the shape as
   * the lantern sees it. Scoring uses this so a slanted table scores like a
   * wall and the result doesn't depend on which surface it hit.
   */
  readonly light = new ShadowGroup();
  readonly lightNorm: Normalization = { cu: 0, cv: 0, area: 1 };
  readonly lightSurface = createSurface();
  readonly lightParts = [new Shadow2D(), new Shadow2D()];
  useLight = false;
  valid = false;
  score = 0;
  hands = 1;
}

export class ShadowSystem extends createSystem({
  planes: { required: [XRPlane] },
  creatures: { required: [Shadowkin] },
}) {
  private matcher!: ShapeMatcher;
  private targets!: PreparedSilhouette[];
  private looks!: CreatureLook[];
  private creatureGeometry!: PlaneGeometry;
  private hands!: HandShadow[];
  private casts!: Cast[];
  private lantern!: LanternParts;
  private lanternPlaced = false;
  private lanternHeldBy = -1;
  private lanternAge = 0;
  private hud!: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: CanvasTexture; mesh: Mesh };
  private guide!: Mesh;
  private particles!: Particles;
  private menu!: PalmMenu;
  private save!: SaveData;

  private surfacePool: Surface[] = [];
  private surfaceCount = 0;
  private armFadeGradient: CanvasGradient | null = null;
  private desktopSurfaces: Surface[] = [];
  private virtualScreen!: Surface;
  private virtualScreenMesh!: Mesh;
  private paperPinned = false;
  private desktopProps!: Group;

  private targetIndex = 0;
  private targetIsDaily = false;
  private targetIsNew = false;
  private progress = 0;
  private smoothedScore = 0;
  private scoreTimer = 0;
  private wolfTimer = 0;
  private cooldown = 0;
  private banner = '';
  private bannerTime = 0;
  private lastPick = -1;
  private sessionWasActive: boolean | null = null;
  /** Seconds since the XR session started; the head pose settles after a few frames. */
  private xrTime = 0;
  private controllersOnly = false;
  private saveTimer = 0;
  private dirty = false;
  private pausedLast = false;
  private frames = 0;

  // Nest: the persistent anchor creatures are stored relative to.
  private readonly nest = new Matrix4();
  private readonly nestInverse = new Matrix4();
  private nestReady = false;
  private nestAnchor: NativeAnchor | null = null;
  private nestRequested = false;
  private nestRestoring = false;
  private creaturesRestored = false;

  private sim = {
    poseIndex: -1,
    x: 0,
    y: 0,
  };

  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly palm = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tmp3 = new Vector3();
  private readonly basis = new Matrix4();
  private readonly mat = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly camQuat = new Quaternion();
  private readonly simPosition = new Vector3();
  private readonly simRotation = { x: 0, y: 0, z: 0 };
  private readonly simDefault: HandPlacement = { pose: straightPose(), x: 0, y: 0, roll: 0, mirror: false };

  init(): void {
    this.save = loadSave();
    sfx.setEnabled(this.save.settings.sound);
    this.matcher = new ShapeMatcher();
    this.targets = prepareSilhouettes(this.matcher);
    this.looks = buildCreatureLooks(this.targets);
    this.creatureGeometry = new PlaneGeometry(1, 1);

    const poolMaterial = new MeshBasicMaterial({
      map: radialTexture(128, [
        [0, 'rgba(255,196,120,0.55)'],
        [0.35, 'rgba(255,160,80,0.28)'],
        [0.7, 'rgba(255,130,60,0.08)'],
        [1, 'rgba(255,120,60,0)'],
      ]),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    this.hands = [new HandShadow(poolMaterial), new HandShadow(poolMaterial)];
    for (const hand of this.hands) {
      this.world.createTransformEntity(hand.mesh);
      this.world.createTransformEntity(hand.pool);
    }
    this.casts = [new Cast(), new Cast(), new Cast()];
    this.casts[2].hands = 2;

    this.guide = new Mesh(new PlaneGeometry(1, 1), this.looks[0].guide);
    this.guide.renderOrder = 1;
    this.guide.visible = false;
    this.world.createTransformEntity(this.guide);

    this.lantern = buildLantern();
    this.world.createTransformEntity(this.lantern.group);
    this.hud = this.buildHud();
    this.world.createTransformEntity(this.hud.mesh);
    this.particles = new Particles();
    this.world.createTransformEntity(this.particles.mesh);
    this.menu = new PalmMenu();
    this.world.createTransformEntity(this.menu.mesh);

    this.virtualScreen = createSurface();
    this.virtualScreen.virtual = true;
    this.virtualScreen.label = 'paper';
    this.virtualScreen.polygon = new Float32Array([
      -PAPER_W / 2, -PAPER_H / 2, PAPER_W / 2, -PAPER_H / 2, PAPER_W / 2, PAPER_H / 2, -PAPER_W / 2, PAPER_H / 2,
    ]);
    this.virtualScreenMesh = new Mesh(
      new PlaneGeometry(PAPER_W, PAPER_H),
      new MeshBasicMaterial({ color: 0xf3e6cf, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide }),
    );
    this.virtualScreenMesh.visible = false;
    this.world.createTransformEntity(this.virtualScreenMesh);

    this.desktopProps = this.buildDesktopProps();
    this.world.createTransformEntity(this.desktopProps);

    this.pickTarget();

    const onMove = (e: PointerEvent) => {
      this.sim.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.sim.y = 1 - (e.clientY / window.innerHeight) * 2;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        const i = Number(e.key) - 1;
        this.sim.poseIndex = i < this.targets.length ? i : -1;
      } else if (e.key === 'n') {
        this.onMenu('skip');
      } else if (e.key === 'e') {
        this.onMenu('easy');
      } else if (e.key === 'm') {
        this.onMenu('sound');
      }
    };
    const onHide = () => this.persist();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('keydown', onKey),
      () => window.removeEventListener('pagehide', onHide),
      () => document.removeEventListener('visibilitychange', onHide),
    );

    this.exposeDebug();
  }

  update(delta: number, time: number): void {
    this.frames++;
    const dt = Math.min(delta, 0.05);
    const session = this.world.session;
    const inXR = session != null && this.xrFrame != null;
    if (inXR !== this.sessionWasActive) this.onSessionChange(inXR);

    // Pause cleanly when the headset is taken off or a system menu is up.
    const visibility = this.world.visibilityState.peek() as string;
    const paused = inXR && visibility !== 'visible' && visibility !== 'Visible';
    shared.paused = paused;
    if (paused !== this.pausedLast) {
      this.pausedLast = paused;
      if (paused) {
        sfx.suspend();
        this.persist();
      } else {
        sfx.resume();
      }
    }
    if (paused) return;

    this.updateHead();
    if (inXR) {
      this.readXRHands(session!);
      this.collectPlaneSurfaces();
      this.xrTime += dt;
      this.updateNest();
      if (!this.lanternPlaced && this.xrTime > 0.6) this.placeLantern();
      this.updateLanternGrab();
    } else {
      this.updateSimHands();
    }
    if (!this.creaturesRestored && this.nestReady) this.restoreCreatures(inXR);

    const anyHand = this.hands[0].joints.present || this.hands[1].joints.present;
    shared.awaySeconds = anyHand ? 0 : shared.awaySeconds + dt;

    const action = this.menu.update(
      [this.hands[0].joints, this.hands[1].joints],
      this.head,
      dt,
      this.save.settings,
    );
    if (action) this.onMenu(action);

    const surfaces = inXR ? this.surfacePool : this.desktopSurfaces;
    const count = inXR ? this.surfaceCount : this.desktopSurfaces.length;
    let usedVirtual = false;
    for (let h = 0; h < 2; h++) {
      const hand = this.hands[h];
      hand.surface = null;
      if (hand.joints.present && this.menu.owner !== h) {
        hand.surface = this.pickSurface(hand, surfaces, count);
        if (hand.surface === this.virtualScreen) usedVirtual = true;
        if (hand.surface) projectHand(hand.joints, this.lantern.group.position, hand.surface, hand.shadow);
      }
      if (!hand.surface || !hand.shadow.valid) hand.shadow.valid = false;
    }
    this.virtualScreenMesh.visible = usedVirtual || this.paperPinned;

    this.scoreTimer += dt;
    if (this.scoreTimer >= SCORE_INTERVAL) {
      this.scoreHands(this.scoreTimer);
      this.scoreTimer = 0;
    }
    this.wolfTimer += dt;
    if (this.wolfTimer >= WOLF_INTERVAL) {
      this.wolfTimer = 0;
      this.checkWolves();
    }

    this.updateProgress(dt);
    this.drawShadows();
    this.drawGuide(time);
    this.updateLantern(dt, time);
    this.drawHud(time);
    this.publishHands();
    this.drainFx();
    this.camera.getWorldQuaternion(this.camQuat);
    this.particles.update(dt, this.camQuat);

    sfx.setListener(this.head, this.tmp.set(0, 0, -1).applyQuaternion(this.camQuat));
    sfx.tick(dt, anyHand && this.lanternPlaced, this.smoothedScore, this.progress);

    this.bannerTime = Math.max(0, this.bannerTime - dt);
    this.saveTimer += dt;
    if ((this.dirty || shared.saveRequested) && this.saveTimer > SAVE_INTERVAL) this.persist();
  }

  // ---------------------------------------------------------------- session & input

  private onSessionChange(inXR: boolean): void {
    if (this.sessionWasActive) this.persist();
    this.sessionWasActive = inXR;
    this.desktopProps.visible = !inXR;
    this.lanternPlaced = !inXR;
    this.lanternAge = inXR ? 0 : 10;
    this.xrTime = 0;
    this.nestAnchor = null;
    this.nestRequested = false;
    this.nestRestoring = false;
    this.paperPinned = false;
    this.lanternHeldBy = -1;
    // Each mode has its own creatures (desktop ones live on the virtual wall).
    for (const e of [...this.queries.creatures.entities]) e.dispose();
    this.creaturesRestored = false;
    if (!inXR) {
      this.lantern.group.position.set(0.14, 0.94, 0.02);
      this.nest.identity();
      this.nestInverse.identity();
      this.nestReady = true;
    } else {
      this.nestReady = false;
    }
    // Real hands are visible through passthrough; virtual hand meshes would
    // just cover them and the shadow illusion.
    this.input.visualAdapters.hand.left.toggleVisual(!inXR);
    this.input.visualAdapters.hand.right.toggleVisual(!inXR);
    this.pickTarget();
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
    let controllers = false;
    if (!space) return;
    for (const source of session.inputSources) {
      if (!source.hand) {
        if (source.gamepad && source.targetRayMode === 'tracked-pointer') controllers = true;
        continue;
      }
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
    this.controllersOnly = controllers && !this.hands[0].joints.present && !this.hands[1].joints.present;
  }

  /** Desktop stand-in: hands that follow the mouse in front of the wall. */
  private updateSimHands(): void {
    const target = this.sim.poseIndex >= 0 ? this.targets[this.sim.poseIndex] : null;
    const placements = target ? target.def.hands : [this.simDefault];
    this.hands[0].joints.present = false;
    this.hands[1].joints.present = false;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      // One hand is the right hand; two-hand shapes use both.
      const hand = this.hands[placements.length === 1 ? 1 : i];
      this.simPosition.set(this.sim.x * 0.22 + p.x * 1.0, 0.86 + this.sim.y * 0.22 + p.y, -0.3);
      this.simRotation.z = p.roll;
      poseHand(p.pose, this.simPosition, this.simRotation, hand.joints, p.mirror);
    }
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
    const saved = this.save.lantern;
    if (this.nestReady && this.nestAnchor && saved) {
      // Back where you left it.
      this.lantern.group.position.fromArray(saved).applyMatrix4(this.nest);
    } else {
      // Chest height, a little forward: hands held in front of it throw
      // shadows onto the desk or the wall ahead.
      this.lantern.group.position
        .copy(this.head)
        .addScaledVector(this.forward, 0.16)
        .addScaledVector(this.right, 0.06);
      this.lantern.group.position.y -= 0.26;
    }
    this.lanternPlaced = true;
    this.lanternAge = 0;
    sfx.ignite();
  }

  /** Pinch the lantern to pick it up and move it; release to drop. */
  private updateLanternGrab(): void {
    for (let h = 0; h < 2; h++) {
      const joints = this.hands[h].joints;
      const pinching = joints.present && this.pinchPoint(joints, this.tmp);
      if (this.lanternHeldBy === h) {
        if (pinching) {
          this.lantern.group.position.copy(this.tmp);
        } else {
          this.lanternHeldBy = -1;
          this.rememberLantern();
        }
      } else if (
        this.lanternHeldBy < 0 &&
        pinching &&
        this.tmp.distanceTo(this.lantern.group.position) < LANTERN_GRAB_RADIUS
      ) {
        this.lanternHeldBy = h;
        sfx.click();
      }
    }
  }

  private rememberLantern(): void {
    if (!this.nestReady) return;
    this.save.lantern = this.tmp3.copy(this.lantern.group.position).applyMatrix4(this.nestInverse).toArray() as [number, number, number];
    this.dirty = true;
  }

  private pinchPoint(joints: HandJoints, out: Vector3): boolean {
    out.fromArray(joints.positions, 4 * 3);
    this.tmp2.fromArray(joints.positions, 9 * 3);
    if (out.distanceTo(this.tmp2) > PINCH_DISTANCE) return false;
    out.add(this.tmp2).multiplyScalar(0.5);
    return true;
  }

  private onMenu(action: MenuAction): void {
    sfx.click();
    if (action === 'skip') {
      this.progress = 0;
      this.pickTarget(true);
    } else if (action === 'easy') {
      this.save.settings.easy = !this.save.settings.easy;
      this.dirty = true;
      this.showBanner(this.save.settings.easy ? 'Easy matching' : 'Normal matching');
    } else if (action === 'sound') {
      this.save.settings.sound = !this.save.settings.sound;
      sfx.setEnabled(this.save.settings.sound);
      this.dirty = true;
    }
  }

  // ---------------------------------------------------------------- nest (persistent anchor)

  private updateNest(): void {
    const session = this.world.session as AnchorSession | undefined;
    const frame = this.xrFrame as AnchorFrame;
    const space = this.xrManager.getReferenceSpace();
    if (!session || !space) return;

    // Try to bring back last time's nest first.
    if (!this.nestRequested && this.save.nestUuid && session.restorePersistentAnchor) {
      this.nestRequested = true;
      this.nestRestoring = true;
      const uuid = this.save.nestUuid;
      session
        .restorePersistentAnchor(uuid)
        .then((anchor) => {
          if (this.world.session !== session) return;
          this.nestAnchor = anchor;
        })
        .catch(() => {
          this.save.nestUuid = null;
          this.dirty = true;
        })
        .finally(() => {
          this.nestRestoring = false;
        });
    }

    if (this.nestAnchor) {
      const pose = frame.getPose(this.nestAnchor.anchorSpace, space);
      if (pose) {
        this.nest.fromArray(pose.transform.matrix);
        this.nestInverse.copy(this.nest).invert();
        this.nestReady = true;
      }
      return;
    }

    const restoreTimedOut = this.xrTime > NEST_RESTORE_TIMEOUT;
    if (this.nestRestoring && !restoreTimedOut) return;
    if (!this.lanternPlaced) return;

    // No nest yet: make one at the lantern, upright, facing the player.
    if (!this.nestReady) {
      this.quat.setFromAxisAngle(this.tmp.set(0, 1, 0), Math.atan2(-this.forward.x, -this.forward.z));
      this.nest.compose(this.lantern.group.position, this.quat, this.tmp2.set(1, 1, 1));
      this.nestInverse.copy(this.nest).invert();
      this.nestReady = true;
      this.save.lantern = [0, 0, 0];
      // Fallback nest is head-relative; only a real anchor keeps old creatures in place.
      if (this.save.nestUuid && restoreTimedOut) this.save.nestUuid = null;
      if (frame.createAnchor && !this.save.nestUuid) {
        const p = this.lantern.group.position;
        const q = this.quat;
        frame
          .createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), space)
          .then(async (anchor) => {
            if (this.world.session !== session) return;
            this.nestAnchor = anchor;
            const uuid = await anchor.requestPersistentHandle?.();
            if (uuid) {
              this.save.nestUuid = uuid;
              this.dirty = true;
            }
          })
          .catch(() => undefined);
      }
    }
  }

  private restoreCreatures(inXR: boolean): void {
    // In XR, wait for the anchor if there is one to wait for.
    if (inXR && this.save.nestUuid && !this.nestAnchor && this.xrTime < NEST_RESTORE_TIMEOUT) return;
    this.creaturesRestored = true;
    const space = inXR ? 'xr' : 'desktop';
    for (const c of this.save.creatures) {
      if (c.space !== space) continue;
      this.tmp.fromArray(c.origin).applyMatrix4(this.nest);
      this.quat.setFromRotationMatrix(this.nest);
      const entity = this.makeCreature(c.silhouette, c.size, c.u, c.v, c.daily, c.born);
      entity.setValue(Shadowkin, 'homeU', c.homeU);
      entity.setValue(Shadowkin, 'homeV', c.homeV);
      entity.setValue(Shadowkin, 'phase', c.phase);
      entity.setValue(Shadowkin, 'minU', c.bounds[0]);
      entity.setValue(Shadowkin, 'maxU', c.bounds[1]);
      entity.setValue(Shadowkin, 'minV', c.bounds[2]);
      entity.setValue(Shadowkin, 'maxV', c.bounds[3]);
      // Restored kin are already grown; they start asleep and wake when they see you.
      entity.setValue(Shadowkin, 'age', 5);
      entity.setValue(Shadowkin, 'mood', Mood.Asleep);
      this.tmp.toArray(entity.getVectorView(Shadowkin, 'origin'));
      this.tmp2.fromArray(c.axisU).applyQuaternion(this.quat).toArray(entity.getVectorView(Shadowkin, 'axisU'));
      this.tmp2.fromArray(c.axisV).applyQuaternion(this.quat).toArray(entity.getVectorView(Shadowkin, 'axisV'));
      this.tmp2.fromArray(c.normal).applyQuaternion(this.quat).toArray(entity.getVectorView(Shadowkin, 'normal'));
    }
    shared.awaySeconds = 30;
  }

  /** Writes settings, progress and every creature (in nest space) to storage. */
  private persist(): void {
    this.saveTimer = 0;
    this.dirty = false;
    shared.saveRequested = false;
    if (!this.nestReady || this.sessionWasActive === null) {
      writeSave(this.save);
      return;
    }
    const space = this.sessionWasActive ? 'xr' : 'desktop';
    const kept = this.save.creatures.filter((c) => c.space !== space);
    this.quat.setFromRotationMatrix(this.nestInverse);
    const v3 = (out: Vector3) => out.toArray().map((n) => Number(n.toFixed(4))) as [number, number, number];
    for (const e of this.queries.creatures.entities) {
      kept.push({
        space,
        silhouette: e.getValue(Shadowkin, 'silhouette')!,
        size: e.getValue(Shadowkin, 'size')!,
        phase: e.getValue(Shadowkin, 'phase')!,
        u: e.getValue(Shadowkin, 'u')!,
        v: e.getValue(Shadowkin, 'v')!,
        homeU: e.getValue(Shadowkin, 'homeU')!,
        homeV: e.getValue(Shadowkin, 'homeV')!,
        bounds: [
          e.getValue(Shadowkin, 'minU')!,
          e.getValue(Shadowkin, 'maxU')!,
          e.getValue(Shadowkin, 'minV')!,
          e.getValue(Shadowkin, 'maxV')!,
        ],
        origin: v3(this.tmp.fromArray(e.getVectorView(Shadowkin, 'origin')).applyMatrix4(this.nestInverse)),
        axisU: v3(this.tmp.fromArray(e.getVectorView(Shadowkin, 'axisU')).applyQuaternion(this.quat)),
        axisV: v3(this.tmp.fromArray(e.getVectorView(Shadowkin, 'axisV')).applyQuaternion(this.quat)),
        normal: v3(this.tmp.fromArray(e.getVectorView(Shadowkin, 'normal')).applyQuaternion(this.quat)),
        daily: e.getValue(Shadowkin, 'daily')!,
        born: e.getValue(Shadowkin, 'born')!,
      } as SavedCreature);
    }
    this.save.creatures = kept;
    writeSave(this.save);
  }

  // ---------------------------------------------------------------- shadows

  /** First real surface the light-through-palm ray reaches, else a paper screen. */
  private pickSurface(hand: HandShadow, surfaces: Surface[], count: number): Surface | null {
    // The hand holding the lantern casts no shadow.
    if (this.lanternHeldBy >= 0 && this.hands[this.lanternHeldBy] === hand) return null;
    const light = this.lantern.group.position;
    this.palm.fromArray(hand.joints.positions, 0).add(this.tmp.fromArray(hand.joints.positions, 11 * 3));
    this.palm.multiplyScalar(0.5);
    let best: Surface | null = null;
    let bestT = Infinity;
    for (let i = 0; i < count; i++) {
      const t = rayHit(surfaces[i], light, this.palm);
      if (t > 0 && t < bestT && t < MAX_MAGNIFICATION) {
        bestT = t;
        best = surfaces[i];
      }
    }
    if (this.paperPinned) {
      const t = rayHit(this.virtualScreen, light, this.palm);
      if (t > 0 && t < bestT) {
        bestT = t;
        best = this.virtualScreen;
      }
    }
    if (best) {
      hand.t = bestT;
      return best;
    }
    if (this.paperPinned) return null;

    // Nothing real nearby: hang a sheet of paper ahead of the hand.
    this.tmp.subVectors(this.palm, light);
    this.tmp.y *= 0.3;
    if (this.tmp.lengthSq() < 1e-6) return null;
    this.tmp.normalize();
    this.tmp2.copy(light).addScaledVector(this.tmp, VIRTUAL_SCREEN_DISTANCE);
    this.tmp.negate();
    orientSurface(this.virtualScreen, this.tmp2, this.tmp, this.forward);
    this.placeOnSurface(this.virtualScreenMesh, this.virtualScreen, 0, 0, -0.001);
    hand.t = VIRTUAL_SCREEN_DISTANCE / Math.max(this.palm.distanceTo(light), 0.05);
    return this.virtualScreen;
  }

  private scoreHands(elapsed: number): void {
    const target = this.targets[this.targetIndex];
    const [left, right] = this.hands;
    const casts = this.casts;
    casts[0].group.set(left.shadow.valid ? left.shadow : null);
    casts[0].surface = left.surface;
    casts[1].group.set(right.shadow.valid ? right.shadow : null);
    casts[1].surface = right.surface;
    const together = left.shadow.valid && right.shadow.valid && left.surface === right.surface;
    casts[2].group.set(together ? left.shadow : null, together ? right.shadow : null);
    casts[2].surface = together ? left.surface : null;

    let best = 0;
    for (let i = 0; i < 3; i++) {
      const cast = casts[i];
      cast.valid = cast.group.valid && (i < 2 || together) && this.matcher.measure(cast.group, cast.norm);
      // Walls: score what you see on the wall. Tables and slopes stretch the
      // shadow away from the lantern, so score the shape as the lantern sees it.
      cast.useLight = cast.valid && Math.abs(cast.surface!.normal.y) > 0.5 && this.projectForLight(cast, i);
      const relevant = cast.hands === target.handCount;
      cast.score = cast.valid && relevant ? this.matcher.score(this.scoreGroup(cast), this.scoreNorm(cast), target.mask) : 0;
      if (cast.score > best) best = cast.score;
    }
    this.smoothedScore += (best - this.smoothedScore) * 0.45;

    // Shadow motion, for creatures to react to.
    for (let h = 0; h < 2; h++) {
      const hand = this.hands[h];
      const facts = shared.hands[h];
      const cast = casts[h];
      if (!cast.valid || !hand.surface) {
        facts.shadowOn = false;
        hand.hadCenter = false;
        continue;
      }
      const s = hand.surface;
      facts.shadowCenter.copy(s.origin).addScaledVector(s.axisU, cast.norm.cu).addScaledVector(s.axisV, cast.norm.cv);
      facts.shadowNormal.copy(s.normal);
      facts.shadowRadius = Math.sqrt(cast.norm.area) * 0.6;
      const speed = hand.hadCenter ? facts.shadowCenter.distanceTo(hand.lastCenter) / Math.max(elapsed, 1e-3) : 0;
      facts.shadowSpeed += (speed - facts.shadowSpeed) * 0.5;
      hand.lastCenter.copy(facts.shadowCenter);
      hand.hadCenter = true;
      facts.shadowOn = true;
    }
  }

  private scoreGroup(cast: Cast): ShadowGroup {
    return cast.useLight ? cast.light : cast.group;
  }

  private scoreNorm(cast: Cast): Normalization {
    return cast.useLight ? cast.lightNorm : cast.norm;
  }

  /** Projects the cast's hands onto a screen facing the lantern (see Cast.light). */
  private projectForLight(cast: Cast, index: number): boolean {
    const light = this.lantern.group.position;
    const from = index === 2 ? 0 : index;
    const to = index === 2 ? 1 : index;
    this.tmp3.set(0, 0, 0);
    for (let h = from; h <= to; h++) {
      const j = this.hands[h].joints.positions;
      this.tmp3.x += (j[0] + j[33]) / 2;
      this.tmp3.y += (j[1] + j[34]) / 2;
      this.tmp3.z += (j[2] + j[35]) / 2;
    }
    this.tmp3.multiplyScalar(1 / (to - from + 1));
    this.tmp.subVectors(this.tmp3, light);
    if (this.tmp.lengthSq() < 1e-6) return false;
    this.tmp.normalize();
    this.tmp2.copy(this.tmp3).addScaledVector(this.tmp, 0.3);
    orientSurface(cast.lightSurface, this.tmp2, this.tmp.negate(), this.forward);
    const a = projectHand(this.hands[from].joints, light, cast.lightSurface, cast.lightParts[0]);
    const b = index === 2 ? projectHand(this.hands[to].joints, light, cast.lightSurface, cast.lightParts[1]) : null;
    cast.light.set(a, b);
    if (index === 2 && cast.light.count < 2) return false;
    return cast.light.valid && this.matcher.measure(cast.light, cast.lightNorm);
  }

  /** Is either hand making a wolf? Everyone else runs from it. */
  private checkWolves(): void {
    const wolf = this.targets[WOLF_INDEX];
    const anyCreatures = this.queries.creatures.entities.size > 0;
    for (let h = 0; h < 2; h++) {
      const cast = this.casts[h];
      shared.hands[h].wolf =
        anyCreatures && cast.valid && this.matcher.score(this.scoreGroup(cast), this.scoreNorm(cast), wolf.mask, true) >= WOLF_THRESHOLD;
    }
  }

  private publishHands(): void {
    for (let h = 0; h < 2; h++) {
      const facts = shared.hands[h];
      const joints = this.hands[h].joints;
      facts.present = joints.present;
      if (joints.present) facts.tip.fromArray(joints.positions, 9 * 3);
      if (!this.hands[h].shadow.valid) facts.shadowOn = false;
    }
  }

  private updateProgress(dt: number): void {
    const rule = this.save.settings.easy ? EASY : NORMAL;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      this.progress = Math.max(0, this.progress - dt * 2);
      return;
    }
    if (this.smoothedScore >= rule.threshold) {
      this.progress = Math.min(1, this.progress + dt / rule.hold);
    } else {
      this.progress = Math.max(0, this.progress - dt * 1.5);
    }
    if (this.progress >= 1) {
      const target = this.targets[this.targetIndex];
      let cast: Cast | null = null;
      for (const c of this.casts) {
        if (c.hands === target.handCount && c.valid && c.surface && (!cast || c.score > cast.score)) cast = c;
      }
      if (cast) this.bringToLife(cast);
      this.cooldown = 1.6;
      this.progress = 0;
      this.smoothedScore = 0;
    }
  }

  private drawShadows(): void {
    const [left, right] = this.hands;
    const merged = left.shadow.valid && right.shadow.valid && left.surface === right.surface;
    if (merged) {
      left.mesh.visible = false;
      left.pool.visible = false;
      this.drawShadowInto(right, this.casts[2].group.set(left.shadow, right.shadow), Math.max(left.t, right.t));
    } else {
      for (let h = 0; h < 2; h++) {
        const hand = this.hands[h];
        if (!hand.shadow.valid || !hand.surface) {
          hand.mesh.visible = false;
          hand.pool.visible = false;
          continue;
        }
        this.drawShadowInto(hand, this.casts[h].group.set(hand.shadow), hand.t);
      }
    }
  }

  private drawShadowInto(hand: HandShadow, group: ShadowGroup, t: number): void {
    const surface = hand.surface!;
    const cu = (group.minU + group.maxU) / 2;
    const cv = (group.minV + group.maxV) / 2;
    const extent = Math.max(group.maxU - group.minU, group.maxV - group.minV) * 2.1 + 0.06;
    // Slide the canvas down the arm of a lone hand so the forearm stays in it.
    const first = group.parts[0];
    const armU = group.count === 1 ? (first.points[0] - first.points[22]) * ARM_SHIFT : 0;
    const armV = group.count === 1 ? (first.points[1] - first.points[23]) * ARM_SHIFT : 0;
    const meshU = cu + armU;
    const meshV = cv + armV;
    hand.mesh.visible = true;
    this.placeOnSurface(hand.mesh, surface, meshU, meshV, SURFACE_OFFSET);
    hand.mesh.scale.set(extent, extent, 1);

    // A pool of lantern light on the surface around the shadow.
    const light = this.lantern.group.position;
    this.tmp.subVectors(light, surface.origin);
    const distance = Math.abs(this.tmp.dot(surface.normal));
    const poolSize = 0.35 + distance * 1.1;
    hand.pool.visible = true;
    this.placeOnSurface(hand.pool, surface, cu, cv, SURFACE_OFFSET * 0.5);
    hand.pool.scale.set(poolSize, poolSize, 1);

    // Overlapping strokes must not stack up darker at the joints, so draw the
    // shadow opaque on its own layer and blend that in at one opacity.
    const px = SHADOW_CANVAS / extent;
    const layer = hand.layerCtx;
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.clearRect(0, 0, SHADOW_CANVAS, SHADOW_CANVAS);
    layer.setTransform(px, 0, 0, -px, SHADOW_CANVAS / 2 - meshU * px, SHADOW_CANVAS / 2 + meshV * px);
    layer.fillStyle = '#0a0616';
    layer.strokeStyle = '#0a0616';
    drawShadowGroup(layer, group, 1, true);

    // The forearm runs off the edge of this canvas, so let it leave the light.
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.globalCompositeOperation = 'destination-in';
    layer.fillStyle = this.armFade(layer);
    layer.fillRect(0, 0, SHADOW_CANVAS, SHADOW_CANVAS);
    layer.globalCompositeOperation = 'source-over';

    // Penumbra grows with the hand's distance from the surface, like a real
    // shadow from a small flame.
    const blur = Math.min(Math.max(FLAME_RADIUS * (t - 1) * px, 0.4), 1.6);
    const ctx = hand.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, SHADOW_CANVAS, SHADOW_CANVAS);
    ctx.globalAlpha = 0.9;
    ctx.filter = `blur(${blur.toFixed(1)}px)`;
    ctx.drawImage(hand.layer, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    hand.texture.needsUpdate = true;
  }

  private armFade(ctx: CanvasRenderingContext2D): CanvasGradient {
    if (!this.armFadeGradient) {
      const c = SHADOW_CANVAS / 2;
      const g = ctx.createRadialGradient(c, c, c * 0.8, c, c, c);
      g.addColorStop(0, '#000');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      this.armFadeGradient = g;
    }
    return this.armFadeGradient;
  }

  /** The shape to make, as a glow the shadow should fill, sized to the player's own shadow. */
  private drawGuide(time: number): void {
    const target = this.targets[this.targetIndex];
    let cast: Cast | null = null;
    if (this.cooldown <= 0) {
      if (target.handCount === 2 && this.casts[2].valid) cast = this.casts[2];
      else if (this.casts[1].valid) cast = this.casts[1];
      else if (this.casts[0].valid) cast = this.casts[0];
    }
    if (!cast || !cast.surface) {
      this.guide.visible = false;
      return;
    }
    const scale = target.handCount / cast.hands;
    const size = Math.sqrt(cast.norm.area * scale) / CREATURE_FILL;
    this.guide.material = this.looks[this.targetIndex].guide;
    (this.guide.material as MeshBasicMaterial).opacity = 0.22 + this.progress * 0.5 + Math.sin(time * 3) * 0.06;
    this.placeOnSurface(this.guide, cast.surface, cast.norm.cu, cast.norm.cv, SURFACE_OFFSET * 0.75);
    this.guide.scale.set(size * (1 + this.progress * 0.06), size * (1 + this.progress * 0.06), 1);
    this.guide.visible = true;
  }

  private placeOnSurface(mesh: Mesh | Group, surface: Surface, u: number, v: number, offset: number): void {
    this.basis.makeBasis(surface.axisU, surface.axisV, surface.normal);
    mesh.quaternion.setFromRotationMatrix(this.basis);
    mesh.position
      .copy(surface.origin)
      .addScaledVector(surface.axisU, u)
      .addScaledVector(surface.axisV, v)
      .addScaledVector(surface.normal, offset);
  }

  // ---------------------------------------------------------------- targets & creatures

  /** Tutorial first, then today's shadow, then the newest shape, then free play. */
  private pickTarget(skipping = false): void {
    const save = this.save;
    const dailyOpen = rollDay(save);
    const daily = dailySilhouette(save.daily.date);
    const unlocked = unlockedCount(save);
    this.targetIsDaily = false;
    this.targetIsNew = false;
    let next: number;
    if (metCount(save) === 0 && !skipping) {
      next = 0;
      this.targetIsNew = true;
    } else if (dailyOpen && !(skipping && this.targetIndex === daily)) {
      next = daily;
      this.targetIsDaily = true;
    } else if (!save.met[SILHOUETTES[unlocked - 1].id] && !(skipping && this.targetIndex === unlocked - 1)) {
      next = unlocked - 1;
      this.targetIsNew = true;
    } else {
      // Free play among everything you've unlocked (plus today's), never the same twice.
      const pool: number[] = [];
      for (let i = 0; i < unlocked; i++) pool.push(i);
      if (!pool.includes(daily)) pool.push(daily);
      const choices = pool.filter((i) => i !== this.targetIndex && i !== this.lastPick);
      next = choices.length ? choices[Math.floor(Math.random() * choices.length)] : pool[0];
    }
    this.lastPick = this.targetIndex;
    this.targetIndex = next;
  }

  private bringToLife(cast: Cast): void {
    const target = this.targets[this.targetIndex];
    const surface = cast.surface!;
    const creatures = this.queries.creatures.entities;
    if (creatures.size >= MAX_CREATURES) {
      // The oldest kin wanders off to make room.
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

    const daily = this.targetIsDaily;
    const entity = this.makeCreature(this.targetIndex, Math.sqrt(cast.norm.area) / CREATURE_FILL, cast.norm.cu, cast.norm.cv, daily, today());
    surface.origin.toArray(entity.getVectorView(Shadowkin, 'origin'));
    surface.axisU.toArray(entity.getVectorView(Shadowkin, 'axisU'));
    surface.axisV.toArray(entity.getVectorView(Shadowkin, 'axisV'));
    surface.normal.toArray(entity.getVectorView(Shadowkin, 'normal'));
    const [minU, maxU, minV, maxV] = this.surfaceBounds(surface, cast.norm.cu, cast.norm.cv);
    entity.setValue(Shadowkin, 'minU', minU);
    entity.setValue(Shadowkin, 'maxU', maxU);
    entity.setValue(Shadowkin, 'minV', minV);
    entity.setValue(Shadowkin, 'maxV', maxV);
    if (surface === this.virtualScreen) this.paperPinned = true;

    // Ink and embers where it peels off the wall.
    this.tmp.copy(surface.origin).addScaledVector(surface.axisU, cast.norm.cu).addScaledVector(surface.axisV, cast.norm.cv);
    this.particles.burst(this.tmp, surface.normal, target.def.color, 26, 0.3, -0.05);
    this.particles.burst(this.tmp, surface.normal, '#ffb060', 14, 0.18, 0.08);
    sfx.birth(target.def.voice, this.tmp, daily);

    // Progress.
    const save = this.save;
    const before = unlockedCount(save);
    const firstOfKind = !save.met[target.def.id];
    save.met[target.def.id] = (save.met[target.def.id] ?? 0) + 1;
    if (daily) {
      completeDaily(save);
      this.showBanner(`Today's shadow!  ★ ${save.streak.count}`);
      sfx.fanfare();
    } else if (unlockedCount(save) > before) {
      this.showBanner(`New shape: ${SILHOUETTES[unlockedCount(save) - 1].name}`);
      sfx.fanfare();
    } else if (firstOfKind) {
      this.showBanner(`${target.def.name} joined you`);
    } else {
      this.showBanner('Alive!');
    }
    this.pickTarget();
    this.persist();
  }

  private makeCreature(silhouette: number, size: number, u: number, v: number, daily: boolean, born: string) {
    const look = this.looks[silhouette];
    const mesh = new Mesh(this.creatureGeometry, look.body);
    mesh.renderOrder = 2;
    for (let i = 0; i < 2; i++) {
      const eye = new Mesh(eyeGeometry, daily ? look.goldEye : look.eye);
      eye.position.set(look.eyes[i * 2], look.eyes[i * 2 + 1], 0.001);
      eye.userData.radius = look.eyeRadius;
      eye.scale.setScalar(0);
      eye.renderOrder = 4;
      mesh.add(eye);
    }
    const entity = this.world.createTransformEntity(mesh);
    entity.addComponent(Shadowkin, {
      silhouette,
      size,
      u,
      v,
      homeU: u,
      homeV: v,
      heading: Math.random() * Math.PI * 2,
      phase: Math.random(),
      daily,
      born,
      blink: 1 + Math.random() * 2,
      chirp: 2 + Math.random() * 4,
    });
    return entity;
  }

  /** Bounds of the surface in its own (u, v) frame, so kin stay on the real table. */
  private surfaceBounds(surface: Surface, u: number, v: number): [number, number, number, number] {
    const p = surface.polygon;
    if (p.length < 6) return [u - 0.6, u + 0.6, v - 0.6, v + 0.6];
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      minU = Math.min(minU, p[i]);
      maxU = Math.max(maxU, p[i]);
      minV = Math.min(minV, p[i + 1]);
      maxV = Math.max(maxV, p[i + 1]);
    }
    return [minU, maxU, minV, maxV];
  }

  private drainFx(): void {
    while (fxQueue.length) {
      const fx = fxQueue.pop()!;
      if (fx.kind === 'sparkle') this.particles.burst(fx.at, fx.normal, fx.color, fx.count, 0.18, 0.1);
      else this.particles.burst(fx.at, fx.normal, fx.color, fx.count, 0.25, -0.1);
    }
  }

  private showBanner(text: string): void {
    this.banner = text;
    this.bannerTime = 2.6;
  }

  // ---------------------------------------------------------------- visuals

  private updateLantern(dt: number, time: number): void {
    const { group, halo, flame, bodyMaterial } = this.lantern;
    this.lanternAge += dt;
    const ignite = this.lanternPlaced ? Math.min(this.lanternAge / 0.9, 1) : 0;
    const easeOut = 1 - Math.pow(1 - ignite, 3);
    group.visible = this.lanternPlaced;
    group.scale.setScalar(0.4 + easeOut * 0.6);
    const flicker = 1 + Math.sin(time * 13) * 0.05 + Math.sin(time * 7.3) * 0.04 + Math.sin(time * 23) * 0.02;
    halo.scale.setScalar(easeOut * flicker * (1 + this.progress * 0.6));
    halo.quaternion.copy(this.camQuat);
    halo.quaternion.premultiply(this.quat.copy(group.quaternion).invert());
    flame.scale.set(flicker, 1.6 * flicker * (1 + this.progress * 0.3), flicker);
    bodyMaterial.opacity = 0.4 + 0.15 * flicker * easeOut + this.progress * 0.2;
  }

  private buildHud() {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(
      new PlaneGeometry(0.144, 0.06),
      new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    mesh.renderOrder = 7;
    return { canvas, ctx, texture, mesh };
  }

  /** Small card above the lantern: the shape to make, a hold ring, and your progress. */
  private drawHud(time: number): void {
    const { ctx, canvas, texture, mesh } = this.hud;
    mesh.visible = this.lanternPlaced && this.lanternAge > 0.8 && this.menu.owner < 0;
    if (!mesh.visible) return;
    // Kept close to the line of sight (about 19 degrees down, a little right)
    // so it stays inside a narrow field of view, whatever the lantern does.
    mesh.position.copy(this.head).addScaledVector(this.forward, 0.4).addScaledVector(this.right, 0.1);
    mesh.position.y -= 0.13;
    if (!this.sessionWasActive) mesh.position.copy(this.lantern.group.position).setY(this.lantern.group.position.y + 0.085);
    mesh.lookAt(this.head);

    const target = this.targets[this.targetIndex];
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(20, 14, 30, 0.74)';
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 30);
    ctx.fill();
    if (this.targetIsDaily) {
      ctx.strokeStyle = 'rgba(255, 216, 74, 0.7)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (this.controllersOnly) {
      ctx.fillStyle = '#f5ecdf';
      ctx.font = '600 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Put the controllers down', w / 2, 70);
      ctx.font = '24px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(245,236,223,0.7)';
      ctx.fillText('Shadowkin is played with your hands', w / 2, 108);
      ctx.textAlign = 'left';
      texture.needsUpdate = true;
      return;
    }

    // Target icon with hold ring.
    const cx = 80;
    const cy = h / 2;
    const k = 40 / Math.sqrt(target.norm.area);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(k, -k);
    ctx.translate(-target.norm.cu, -target.norm.cv);
    ctx.fillStyle = target.def.color;
    ctx.strokeStyle = target.def.color;
    drawShadowGroup(ctx, target.shadow);
    ctx.restore();
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(cx, cy, 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = target.def.color;
    ctx.beginPath();
    ctx.arc(cx, cy, 60, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.progress);
    ctx.stroke();

    const x = 160;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f5ecdf';
    ctx.font = '600 32px system-ui, sans-serif';
    const title = this.bannerTime > 0 ? this.banner : target.def.name;
    ctx.fillText(title, x, 58, w - x - 16);

    ctx.font = '600 19px system-ui, sans-serif';
    let tag = '';
    let tagColor = 'rgba(245,236,223,0.65)';
    if (this.bannerTime > 0) {
      tag = '';
    } else if (target.handCount === 2 && !this.casts[2].valid) {
      tag = 'USE BOTH HANDS';
      tagColor = '#ffd27a';
    } else if (this.targetIsDaily) {
      tag = "TODAY'S SHADOW";
      tagColor = '#ffd84a';
    } else if (this.targetIsNew) {
      tag = metCount(this.save) === 0 ? 'FILL THE GLOW' : 'NEW SHAPE';
      tagColor = '#ffb36b';
    } else {
      tag = `${Math.round(this.smoothedScore * 100)}% MATCH`;
    }
    ctx.fillStyle = tagColor;
    ctx.fillText(tag, x, 90);

    ctx.font = '20px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(245,236,223,0.7)';
    const kin = this.queries.creatures.entities.size;
    const streak = this.save.streak.count;
    const met = metCount(this.save);
    const pulse = 0.85 + Math.sin(time * 2) * 0.15;
    ctx.globalAlpha = streak > 0 ? pulse : 1;
    ctx.fillText(`${streak > 0 ? `★${streak}  ` : ''}${kin} kin  ·  ${met}/${SILHOUETTES.length} met`, x, 126);
    ctx.globalAlpha = 1;
    texture.needsUpdate = true;
  }

  /** Virtual desk and wall for desktop testing; hidden in XR. */
  private buildDesktopProps(): Group {
    const group = new Group();
    const wallMat = new MeshBasicMaterial({ color: 0x3a3040 });
    const deskMat = new MeshBasicMaterial({ color: 0x5a4636 });
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

  /** Hooks for automated checks (`window.__shadowkin`). */
  private exposeDebug(): void {
    (window as unknown as { __shadowkin: unknown }).__shadowkin = {
      state: () => ({
        target: this.targets[this.targetIndex].def.id,
        daily: this.targetIsDaily,
        isNew: this.targetIsNew,
        score: Number(this.smoothedScore.toFixed(3)),
        rawScores: this.casts.map((c) => Number(c.score.toFixed(3))),
        progress: Number(this.progress.toFixed(3)),
        creatures: this.queries.creatures.entities.size,
        moods: [...this.queries.creatures.entities].map((e) => e.getValue(Shadowkin, 'mood')),
        surfaces: this.hands.map((h) => h.surface?.label ?? null),
        lantern: this.lantern.group.position.toArray().map((n) => Number(n.toFixed(3))),
        nestReady: this.nestReady,
        anchored: this.nestAnchor != null,
        met: { ...this.save.met },
        streak: this.save.streak.count,
        dailyId: SILHOUETTES[dailySilhouette(this.save.daily.date || today())].id,
        easy: this.save.settings.easy,
        menu: this.menu.owner,
        palmNormalY: this.menu.normalY,
        menuPos: this.menu.mesh.position.toArray().map((n) => Number(n.toFixed(3))),
        tips: shared.hands.map((h) => h.tip.toArray().map((n) => Number(n.toFixed(3)))),
        wolf: shared.hands.map((h) => h.wolf),
        banner: this.bannerTime > 0 ? this.banner : '',
        frames: this.frames,
        now: performance.now(),
      }),
      selfTest: () =>
        this.targets.map((t) => ({
          id: t.def.id,
          scores: this.targets.map((o) => Number(this.matcher.score(o.shadow, o.norm, t.mask).toFixed(2))),
        })),
      save: () => {
        this.persist();
        return JSON.parse(localStorage.getItem('shadowkin.save.v1') ?? 'null');
      },
      wipe: () => {
        for (const e of [...this.queries.creatures.entities]) e.dispose();
        this.save = loadSave();
        this.save.met = {};
        this.save.creatures = [];
        this.save.daily = { date: '', done: false };
        this.save.streak = { count: 0, last: '' };
        this.targetIndex = 0;
        this.pickTarget();
        writeSave(this.save);
      },
      reset: () => {
        (window as unknown as { __shadowkin: { wipe: () => void } }).__shadowkin.wipe();
        location.reload();
      },
    };
  }
}
