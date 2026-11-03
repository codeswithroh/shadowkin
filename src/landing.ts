/**
 * The page before entering mixed reality. Everything that moves on it is
 * drawn with the game's own pieces: the parametric hand, the point-light
 * shadow projection and the six target silhouettes. The landing page is a
 * small working demo of the real thing rather than a picture of it.
 */

import { Vector3 } from '@iwsdk/core';
import { sfx } from './audio.js';
import { HandJoints, HandPose, poseHand } from './hand-skeleton.js';
import { Normalization, ShapeMatcher } from './matcher.js';
import { dailySilhouette, loadSave, metCount, today } from './save.js';
import { createSurface, drawShadowGroup, projectHand, Shadow2D, ShadowGroup } from './shadow-projector.js';
import { PreparedSilhouette, prepareSilhouettes, SILHOUETTES } from './silhouettes.js';

const HERE = { x: 0, y: 0, z: -1 };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

const KIN_COPY: Record<string, { make: string; nature: string; tag: string }> = {
  starfish: {
    make: 'Spread all five fingers wide, palm to the wall.',
    nature: 'Your first kin, and the bravest. Always the first to say hello.',
    tag: 'Tutorial',
  },
  rabbit: {
    make: 'Two fingers up for ears. Fold the thumb and the other fingers in.',
    nature: 'Twitchy and quick, with the highest voice of the six.',
    tag: 'Unlock 2',
  },
  crab: {
    make: 'Turn your hand upside down and half-curl every finger.',
    nature: 'Low, grumbly chirps. Looks cross, but loves a pat.',
    tag: 'Unlock 3',
  },
  stag: {
    make: 'Index and little finger up as antlers. Tuck the rest away.',
    nature: 'Calm and proud, with antlers that catch the lantern light.',
    tag: 'Unlock 4',
  },
  wolf: {
    make: 'Hand on its side. Fingers together for the snout, thumb up for an ear, drop your little finger for the jaw.',
    nature: 'Cast a wolf and the other kin panic. Your wolves come running and howl.',
    tag: 'Scares the others',
  },
  butterfly: {
    make: 'Two hands. Hook your thumbs together and spread your fingers like wings.',
    nature: 'The last shape, and the only one that needs both hands.',
    tag: 'Final unlock',
  },
};

interface Pointer {
  x: number;
  y: number;
  seen: boolean;
}
const pointer: Pointer = { x: -9999, y: -9999, seen: false };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function flicker(t: number): number {
  return 0.9 + 0.05 * Math.sin(t * 7.3) + 0.035 * Math.sin(t * 17.1 + 1.3) + 0.02 * Math.sin(t * 31.7);
}

/** A silhouette drawn once to a square canvas, with where its eyes go. */
interface Sprite {
  canvas: HTMLCanvasElement;
  size: number;
  /** Eye centers in canvas pixels: left x, y, right x, y. */
  eyes: [number, number, number, number];
  eyeR: number;
}

/** Same framing as creature-art: centred on the centroid, sqrt(area) spans `frac`. */
function shapeSprite(p: PreparedSilhouette, size: number, fill: string, blur: number, frac = 0.3): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const k = (size * frac) / Math.sqrt(p.norm.area);
  ctx.translate(size / 2, size / 2);
  ctx.scale(k, -k);
  ctx.translate(-p.norm.cu, -p.norm.cv);
  // Canvas filter lengths are output pixels, not transformed units.
  if (blur > 0) ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  drawShadowGroup(ctx, p.shadow);
  const L = size * frac;
  return {
    canvas,
    size,
    eyes: [size / 2 - 0.13 * L, size / 2 - 0.24 * L, size / 2 + 0.13 * L, size / 2 - 0.24 * L],
    eyeR: 0.055 * L,
  };
}

function plasterTexture(w: number, h: number, base: string, dark: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, dark);
  g.addColorStop(0.45, base);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Plaster grain: a small noise tile, repeated.
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const tctx = tile.getContext('2d')!;
  const img = tctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 14;
  }
  tctx.putImageData(img, 0, 0);
  ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
  ctx.fillRect(0, 0, w, h);
  // Soft vertical trowel streaks.
  ctx.globalAlpha = 0.025;
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * w;
    const sw = 30 + Math.random() * 140;
    const sg = ctx.createLinearGradient(x, 0, x + sw, 0);
    sg.addColorStop(0, 'transparent');
    sg.addColorStop(0.5, Math.random() < 0.5 ? '#000' : '#fff');
    sg.addColorStop(1, 'transparent');
    ctx.fillStyle = sg;
    ctx.fillRect(x, 0, sw, h);
  }
  ctx.globalAlpha = 1;
  return c;
}

/** Ember particles shared by the canvases. */
class Embers {
  private readonly n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly max: Float32Array;
  readonly size: Float32Array;
  private next = 0;

  constructor(n: number) {
    this.n = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
  }

  spawn(x: number, y: number, speed: number, up: number, life: number, size: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = Math.cos(a) * s;
    this.vy[i] = Math.sin(a) * s - up;
    this.life[i] = this.max[i] = life * (0.6 + Math.random() * 0.6);
    this.size[i] = size * (0.5 + Math.random() * 0.8);
  }

  draw(ctx: CanvasRenderingContext2D, dt: number, color: string): void {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = color;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vx[i] *= 1 - dt * 1.2;
      this.vy[i] = this.vy[i] * (1 - dt * 1.2) - 14 * dt;
      this.x[i] += this.vx[i] * dt + Math.sin(this.life[i] * 6 + i) * 0.3;
      this.y[i] += this.vy[i] * dt;
      const k = this.life[i] / this.max[i];
      ctx.globalAlpha = k * k;
      ctx.beginPath();
      ctx.arc(this.x[i], this.y[i], this.size[i] * (0.4 + 0.6 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function sizeCanvas(canvas: HTMLCanvasElement, maxDpr = 1.5): { w: number; h: number; dpr: number } {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  return { w, h, dpr };
}

// ---------------------------------------------------------------- hero wall

interface HandState {
  pose: HandPose;
  x: number;
  y: number;
  roll: number;
}

function blankPose(curl: number, spread: number): HandPose {
  return {
    thumb: { curl, spread },
    index: { curl, spread },
    middle: { curl, spread },
    ring: { curl, spread },
    pinky: { curl, spread },
  };
}
function copyHand(src: HandState, dst: HandState): void {
  for (const f of FINGERS) {
    dst.pose[f].curl = src.pose[f].curl;
    dst.pose[f].spread = src.pose[f].spread;
  }
  dst.x = src.x;
  dst.y = src.y;
  dst.roll = src.roll;
}
function lerpHand(a: HandState, b: HandState, t: number, out: HandState): void {
  for (const f of FINGERS) {
    out.pose[f].curl = a.pose[f].curl + (b.pose[f].curl - a.pose[f].curl) * t;
    out.pose[f].spread = a.pose[f].spread + (b.pose[f].spread - a.pose[f].spread) * t;
  }
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.roll = a.roll + (b.roll - a.roll) * t;
}
function newHand(): HandState {
  return { pose: blankPose(0, 0), x: 0, y: 0, roll: 0 };
}

const WALL_DEPTH = 0.32;
const LIGHT_Z = 0.42;
const MORPH_TIME = 1.1;
const HOLD_TIME = 3.6;
const BIRTH_AT = 0.5;

/**
 * A lantern-lit wall. The cursor is the flame; a hand floats between it and
 * the wall, cycling through the six target poses, and its shadow is the real
 * point-light projection the game uses. Hold a pose and the shadow opens its eyes.
 */
class HeroWall {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly lightCanvas = document.createElement('canvas');
  private readonly lctx = this.lightCanvas.getContext('2d')!;
  private readonly shadowCanvas = document.createElement('canvas');
  private readonly sctx = this.shadowCanvas.getContext('2d')!;
  private wall: HTMLCanvasElement | null = null;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private readonly surface = createSurface();
  private readonly light = new Vector3();
  private readonly handPos = new Vector3();
  private readonly joints = [new HandJoints(), new HandJoints()];
  private readonly shadows = [new Shadow2D(), new Shadow2D()];
  private readonly drawGroup = new ShadowGroup();
  private readonly measureGroup = new ShadowGroup();
  private readonly norm: Normalization = { cu: 0, cv: 0, area: 1 };
  private readonly matcher = new ShapeMatcher();
  private readonly targets: [HandState, HandState][];
  private readonly relaxed: HandState[] = [newHand(), newHand()];
  private readonly from = [newHand(), newHand()];
  private readonly cur = [newHand(), newHand()];
  private readonly embers = new Embers(140);
  private shape = 0;
  private morph = 1;
  private hold = 0;
  private alive = 0;
  private born = false;
  private userUntil = 0;
  private userPicked = false;
  private lx = 0;
  private ly = 0;
  private hover = false;
  private blink = 0;
  private emberClock = 0;
  visible = true;
  onShape: (index: number) => void = () => {};

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hero: HTMLElement,
    private readonly prepared: PreparedSilhouette[],
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.surface.origin.set(0, 0, -WALL_DEPTH);
    this.surface.normal.set(0, 0, 1);
    this.surface.axisU.set(1, 0, 0);
    this.surface.axisV.set(0, 1, 0);

    // Every pose placed so its shadow's centroid sits on the hand's axis.
    this.targets = prepared.map((p) => {
      const hands = p.def.hands;
      const make = (i: number): HandState => {
        const h = hands[i];
        if (!h) return { pose: blankPose(0.25, 0.05), x: 0.36, y: -0.42, roll: -0.5 };
        return {
          pose: { thumb: { ...h.pose.thumb }, index: { ...h.pose.index }, middle: { ...h.pose.middle }, ring: { ...h.pose.ring }, pinky: { ...h.pose.pinky } },
          x: h.x - p.norm.cu,
          y: h.y - p.norm.cv,
          roll: h.roll,
        };
      };
      return [make(0), make(1)];
    });
    copyHand(this.targets[0][0], this.cur[0]);
    copyHand(this.targets[0][1], this.cur[1]);
    copyHand(this.cur[0], this.from[0]);
    copyHand(this.cur[1], this.from[1]);

    hero.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || e.buttons) this.hover = true;
    });
    hero.addEventListener('pointerleave', () => (this.hover = false));
    canvas.addEventListener('click', () => {
      sfx.unlock();
      this.setShape((this.shape + 1) % prepared.length, true);
    });
    this.resize();
    this.lx = this.ox;
    this.ly = this.oy - 0.1 * this.scale;
  }

  resize(): void {
    const { w, h, dpr } = sizeCanvas(this.canvas);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    const narrow = w < 960;
    this.scale = narrow ? Math.min(h * 0.85, w * 1.35) : Math.min(h * 1.45, w * 0.95);
    this.ox = narrow ? w * 0.5 : w * 0.7;
    this.oy = narrow ? h * 0.24 : h * 0.47;
    this.lightCanvas.width = this.shadowCanvas.width = Math.ceil(w / 2);
    this.lightCanvas.height = this.shadowCanvas.height = Math.ceil(h / 2);
    this.wall = plasterTexture(Math.round(w * dpr), Math.round(h * dpr), '#1f1517', '#0e090c');
  }

  setShape(index: number, byUser: boolean): void {
    if (index === this.shape && this.morph >= 1 && !byUser) return;
    copyHand(this.cur[0], this.from[0]);
    copyHand(this.cur[1], this.from[1]);
    // Half way through, the hand relaxes, as a real one would between poses.
    for (let i = 0; i < 2; i++) {
      lerpHand(this.cur[i], this.targets[index][i], 0.5, this.relaxed[i]);
      for (const f of FINGERS) {
        this.relaxed[i].pose[f].curl = this.relaxed[i].pose[f].curl * 0.5 + 0.18;
      }
    }
    this.shape = index;
    this.morph = 0;
    this.hold = 0;
    this.born = false;
    this.userPicked = byUser;
    if (byUser) this.userUntil = performance.now() / 1000 + 9;
    this.onShape(index);
  }

  frame(dt: number, t: number): void {
    // The light follows the cursor; with no cursor it drifts like a held lantern.
    const r = this.canvas.getBoundingClientRect();
    let tx: number;
    let ty: number;
    if (this.hover && pointer.seen) {
      tx = pointer.x - r.left;
      ty = pointer.y - r.top;
    } else {
      tx = this.ox + (Math.sin(t * 0.33) * 0.28 - 0.1) * this.scale;
      ty = this.oy + (Math.cos(t * 0.47) * 0.1 - 0.12) * this.scale;
    }
    const k = 1 - Math.exp(-dt * (this.hover ? 9 : 2.5));
    this.lx += (tx - this.lx) * k;
    this.ly += (ty - this.ly) * k;

    // Morph between poses, then hold; a held pose comes alive.
    if (this.morph < 1) {
      this.morph = Math.min(1, this.morph + dt / MORPH_TIME);
      const m = this.morph;
      for (let i = 0; i < 2; i++) {
        if (m < 0.5) lerpHand(this.from[i], this.relaxed[i], ease(m * 2), this.cur[i]);
        else lerpHand(this.relaxed[i], this.targets[this.shape][i], ease(m * 2 - 1), this.cur[i]);
      }
      this.alive = Math.max(0, this.alive - dt * 5);
    } else {
      this.hold += dt;
      if (this.hold > BIRTH_AT) {
        this.alive = Math.min(1, this.alive + dt * 2.5);
        if (!this.born) this.birth();
      }
      const auto = t > this.userUntil && !reduced;
      if (auto && this.hold > HOLD_TIME) this.setShape((this.shape + 1) % this.prepared.length, false);
    }

    const breathe = Math.sin(t * 0.8) * 0.03;
    const bob = this.alive * Math.abs(Math.sin(t * 2.6)) * 0.008;
    for (let i = 0; i < 2; i++) {
      const c = this.cur[i];
      this.handPos.set(c.x, c.y + bob + Math.sin(t * 0.6 + i) * 0.003, 0);
      poseHand(c.pose, this.handPos, { x: 0, y: 0, z: c.roll + breathe * (i ? -1 : 1) }, this.joints[i], i === 1);
    }
    const lightU = clamp((this.lx - this.ox) / this.scale, -0.34, 0.34);
    const lightV = clamp((this.oy - this.ly) / this.scale, -0.26, 0.26);
    const lz = LIGHT_Z + Math.sin(t * 0.4) * 0.04;
    this.light.set(lightU, lightV, lz);
    projectHand(this.joints[0], this.light, this.surface, this.shadows[0]);
    projectHand(this.joints[1], this.light, this.surface, this.shadows[1]);
    this.drawGroup.set(this.shadows[0], this.shadows[1]);
    this.draw(dt, t, (lz + WALL_DEPTH) / lz);
  }

  private birth(): void {
    this.born = true;
    const def = this.prepared[this.shape].def;
    const twoHands = this.prepared[this.shape].handCount > 1;
    this.measureGroup.set(this.shadows[0], twoHands ? this.shadows[1] : null);
    if (this.matcher.measure(this.measureGroup, this.norm)) {
      const x = this.ox + this.norm.cu * this.scale;
      const y = this.oy - this.norm.cv * this.scale;
      for (let i = 0; i < 46; i++) this.embers.spawn(x, y, 160, 30, 1.3, 2.6);
    }
    if (this.userPicked) sfx.birth(def.voice, HERE, false);
  }

  private draw(dt: number, t: number, magnification: number): void {
    const { ctx, lctx, sctx, w, h, dpr } = this;
    const p = this.prepared[this.shape];
    const I = flicker(t);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (this.wall) ctx.drawImage(this.wall, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Lantern light at half resolution, with the shadow cut out of it.
    const hs = 0.5;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, this.lightCanvas.width, this.lightCanvas.height);
    const R = Math.max(w, h) * 0.85 * hs;
    const g = lctx.createRadialGradient(this.lx * hs, this.ly * hs, 0, this.lx * hs, this.ly * hs, R);
    g.addColorStop(0, `rgba(255,218,168,${0.98 * I})`);
    g.addColorStop(0.22, `rgba(255,182,112,${0.72 * I})`);
    g.addColorStop(0.55, `rgba(205,108,56,${0.36 * I})`);
    g.addColorStop(1, `rgba(140,60,34,${0.1 * I})`);
    lctx.fillStyle = g;
    lctx.fillRect(0, 0, this.lightCanvas.width, this.lightCanvas.height);

    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, this.shadowCanvas.width, this.shadowCanvas.height);
    const px = this.scale * hs;
    sctx.setTransform(px, 0, 0, -px, this.ox * hs, this.oy * hs);
    sctx.fillStyle = '#000';
    sctx.strokeStyle = '#000';
    drawShadowGroup(sctx, this.drawGroup);
    // Penumbra widens as the hand nears the flame, as a real one does.
    const blur = clamp(0.008 * (magnification - 1) * this.scale * hs, 1.5, 6);
    lctx.globalCompositeOperation = 'destination-out';
    lctx.filter = `blur(${blur}px)`;
    lctx.globalAlpha = 0.94;
    lctx.drawImage(this.shadowCanvas, 0, 0);
    lctx.filter = 'none';
    lctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(this.lightCanvas, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    // Eyes ride on the live shadow once it's alive.
    if (this.alive > 0.01) {
      const twoHands = p.handCount > 1;
      this.measureGroup.set(this.shadows[0], twoHands ? this.shadows[1] : null);
      if (this.matcher.measure(this.measureGroup, this.norm)) {
        const s = Math.sqrt(this.norm.area) * this.scale;
        const cx = this.ox + this.norm.cu * this.scale;
        const cy = this.oy - this.norm.cv * this.scale;
        this.blink -= dt;
        if (this.blink < -0.14) this.blink = 2 + Math.random() * 2.5;
        const open = this.blink < 0 ? 0.12 : 1;
        const er = 0.07 * s * (0.6 + 0.4 * this.alive);
        // Eyes glance toward the flame.
        const gx = clamp((this.lx - cx) / w, -0.5, 0.5) * er * 0.6;
        const gy = clamp((this.ly - cy) / h, -0.5, 0.5) * er * 0.6;
        ctx.globalCompositeOperation = 'lighter';
        for (const side of [-1, 1]) {
          const ex = cx + side * 0.15 * s + gx;
          const ey = cy - 0.26 * s + gy;
          const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, er * 4);
          glow.addColorStop(0, p.def.color);
          glow.addColorStop(1, 'transparent');
          ctx.globalAlpha = 0.45 * this.alive;
          ctx.fillStyle = glow;
          ctx.fillRect(ex - er * 4, ey - er * 4, er * 8, er * 8);
          ctx.globalAlpha = this.alive;
          ctx.fillStyle = p.def.color;
          ctx.beginPath();
          ctx.ellipse(ex, ey, er, er * 1.15 * open, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // The flame itself, and embers rising from it.
    this.emberClock += dt;
    while (this.emberClock > 0.09) {
      this.emberClock -= 0.09;
      this.embers.spawn(this.lx + (Math.random() - 0.5) * 8, this.ly - 4, 18, 46, 1.8, 1.6);
    }
    ctx.globalCompositeOperation = 'lighter';
    const fr = 46 * I;
    const fg = ctx.createRadialGradient(this.lx, this.ly, 0, this.lx, this.ly, fr);
    fg.addColorStop(0, 'rgba(255,236,190,0.95)');
    fg.addColorStop(0.18, 'rgba(255,190,110,0.55)');
    fg.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(this.lx - fr, this.ly - fr, fr * 2, fr * 2);
    ctx.fillStyle = 'rgba(255,248,225,0.95)';
    ctx.beginPath();
    ctx.ellipse(this.lx, this.ly - 2, 3.2 * I, 6 * I, Math.sin(t * 9) * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    this.embers.draw(ctx, dt, '#ffc078');
  }
}

// ---------------------------------------------------------------- kin cards

class KinStrip {
  private readonly eyes: { el: HTMLElement; size: number }[] = [];
  private readonly cards: HTMLButtonElement[] = [];
  private dirty = true;
  visible = false;

  constructor(strip: HTMLElement, prepared: PreparedSilhouette[]) {
    const size = 360;
    prepared.forEach((p, i) => {
      const copy = KIN_COPY[p.def.id];
      const body = shapeSprite(p, size, '#160a10', 2);
      const guide = shapeSprite(p, size, p.def.color, 16);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'kin-card';
      card.style.setProperty('--c', p.def.color);
      card.setAttribute('aria-label', `${p.def.name}: ${copy.make}`);
      const voice = p.def.voice >= 700 ? 'High voice' : p.def.voice <= 250 ? 'Deep voice' : 'Mid voice';
      card.innerHTML = `
        <span class="paper"></span>
        <span class="figure"><span class="eyes"></span></span>
        <span class="label">
          <span class="idx">0${i + 1}</span>
          <span class="name">${p.def.name}</span>
          <span class="more"><span><span class="ln"><b>Make it:</b> ${copy.make}</span><span class="ln">${copy.nature}</span>
            <span class="tags"><span>${p.handCount > 1 ? 'Two hands' : 'One hand'}</span><span>${voice}</span><span>${copy.tag}</span></span></span></span>
        </span>`;
      const figure = card.querySelector('.figure') as HTMLElement;
      guide.canvas.className = 'guide';
      body.canvas.className = 'body';
      figure.prepend(guide.canvas, body.canvas);
      const eyesEl = figure.querySelector('.eyes') as HTMLElement;
      for (let e = 0; e < 2; e++) {
        const eye = document.createElement('span');
        eye.className = 'eye';
        eye.style.left = `${(body.eyes[e * 2] / size) * 100}%`;
        eye.style.top = `${(body.eyes[e * 2 + 1] / size) * 100}%`;
        eye.style.setProperty('--er', `${((body.eyeR * 2.2) / size) * 100}%`);
        eye.style.setProperty('--bd', `${i * 0.7}s`);
        eyesEl.append(eye);
        this.eyes.push({ el: eye, size: body.eyeR });
      }
      const open = () => {
        for (const c of this.cards) c.classList.toggle('open', c === card);
        strip.classList.add('has-open');
        this.dirty = true;
      };
      card.addEventListener('mouseenter', open);
      card.addEventListener('focus', open);
      card.addEventListener('click', () => {
        open();
        sfx.unlock();
        card.classList.remove('pet');
        void card.offsetWidth;
        card.classList.add('pet');
        sfx.happy(p.def.voice, HERE);
        setTimeout(() => sfx.chirp(p.def.voice, HERE), 280);
      });
      card.addEventListener('animationend', (e) => {
        if (e.animationName === 'pet') card.classList.remove('pet');
      });
      strip.append(card);
      this.cards.push(card);
    });
    this.cards[0].classList.add('open');
    strip.classList.add('has-open');
    window.addEventListener('pointermove', () => (this.dirty = true), { passive: true });
  }

  frame(): void {
    if (!this.dirty || !pointer.seen) return;
    this.dirty = false;
    for (const { el } of this.eyes) {
      const r = el.getBoundingClientRect();
      const dx = pointer.x - (r.left + r.width / 2);
      const dy = pointer.y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const m = Math.min(1, d / 300) * r.width * 0.2;
      el.style.setProperty('--px', `${(dx / d) * m}px`);
      el.style.setProperty('--py', `${(dy / d) * m}px`);
    }
  }
}

// ---------------------------------------------------------------- today's shadow

class DailyStage {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly glow: Sprite;
  private readonly body: Sprite;
  private readonly embers = new Embers(90);
  private readonly p: PreparedSilhouette;
  private w = 1;
  private dpr = 1;
  private holding = false;
  private progress = 0;
  private alive = 0;
  private aliveFor = 0;
  private blink = 1.5;
  visible = false;

  constructor(
    private readonly stage: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly ring: SVGCircleElement,
    private readonly holdLabel: HTMLElement,
    prepared: PreparedSilhouette[],
  ) {
    this.ctx = canvas.getContext('2d')!;
    const date = today();
    this.p = prepared[dailySilhouette(date)];
    this.glow = shapeSprite(this.p, 512, this.p.def.color, 7, 0.24);
    this.body = shapeSprite(this.p, 512, '#0b0610', 3, 0.24);

    const name = this.p.def.name;
    document.getElementById('daily-title')!.innerHTML = `Everyone is making <em>the ${name}</em>`;
    document.getElementById('daily-text')!.innerHTML =
      `One shape a day, the same for every player, like a daily word puzzle. Make it to keep your ★ streak, and today's kin is born with gold eyes.<br><br><b style="color:var(--paper);font-weight:600">${name}:</b> ${KIN_COPY[this.p.def.id].make}`;

    const save = loadSave();
    const yesterday = today(new Date(Date.now() - 86400000));
    const streak = save.streak.last === date || save.streak.last === yesterday ? save.streak.count : 0;
    document.getElementById('daily-streak')!.textContent = `★ ${streak}`;
    document.getElementById('daily-met')!.textContent = `${metCount(save)} / ${SILHOUETTES.length}`;
    this.buildWeek(prepared);

    const down = (e: Event) => {
      e.preventDefault();
      sfx.unlock();
      if (this.alive > 0.5) this.reset();
      this.holding = true;
    };
    const up = () => (this.holding = false);
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointerleave', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down(e);
    });
    stage.addEventListener('keyup', up);
    this.resize();
  }

  private buildWeek(prepared: PreparedSilhouette[]): void {
    const week = document.getElementById('week')!;
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    for (let d = -3; d <= 3; d++) {
      const date = new Date(Date.now() + d * 86400000);
      const el = document.createElement('div');
      el.className = `day${d === 0 ? ' today' : ''}`;
      if (d <= 0) {
        const p = prepared[dailySilhouette(today(date))];
        const sprite = shapeSprite(p, 96, d === 0 ? p.def.color : 'rgba(245,236,223,0.55)', d === 0 ? 3 : 1, 0.26);
        el.append(sprite.canvas);
        el.title = `${fmt.format(date)}: ${p.def.name}`;
      } else {
        const q = document.createElement('div');
        q.className = 'q';
        q.textContent = '?';
        el.append(q);
      }
      el.append(d === 0 ? 'Today' : fmt.format(date));
      week.append(el);
    }
  }

  private reset(): void {
    this.progress = 0;
    this.alive = 0;
    this.aliveFor = 0;
    this.holdLabel.style.opacity = '1';
    this.holdLabel.textContent = 'Press and hold';
  }

  resize(): void {
    const { w, dpr } = sizeCanvas(this.canvas, 2);
    this.w = w;
    this.dpr = dpr;
  }

  frame(dt: number, t: number): void {
    // Countdown to the next shadow (local midnight).
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const left = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
    const hh = String(Math.floor(left / 3600)).padStart(2, '0');
    const mm = String(Math.floor((left % 3600) / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    document.getElementById('daily-count')!.textContent = `${hh}:${mm}:${ss}`;

    if (this.alive < 1) {
      this.progress = clamp(this.progress + (this.holding ? dt / 1.3 : -dt / 0.7), 0, 1);
      if (this.progress >= 1) {
        this.alive = 1;
        this.holdLabel.textContent = 'Born with gold eyes';
        for (let i = 0; i < 70; i++) this.embers.spawn(this.w / 2, this.w * 0.46, 220, 40, 1.5, 3);
        sfx.birth(this.p.def.voice, HERE, true);
        setTimeout(() => sfx.fanfare(), 450);
      } else if (this.progress > 0.02) {
        this.holdLabel.style.opacity = '0.4';
      } else {
        this.holdLabel.style.opacity = '1';
      }
    } else {
      this.aliveFor += dt;
    }
    this.ring.style.strokeDashoffset = String(301.6 * (1 - this.progress));

    const { ctx, w, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, w);
    const pulse = 0.75 + 0.25 * Math.sin(t * 2.2);
    const hop = this.alive ? Math.abs(Math.sin(this.aliveFor * 3.2)) * w * 0.025 : 0;
    const shake = this.holding && !this.alive ? Math.sin(t * 40) * this.progress * 1.2 : 0;
    const S = w * 0.92;
    const x0 = (w - S) / 2 + shake;
    const y0 = (w - S) / 2 - hop;

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.5 + 0.5 * pulse) * (1 - this.progress * 0.5);
    ctx.drawImage(this.glow.canvas, x0, (w - S) / 2, S, S);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // The shadow fills in from the bottom as you hold, like a match in the game.
    if (this.progress > 0) {
      ctx.save();
      const fillTop = y0 + S * (1 - ease(this.progress) * 1.0);
      ctx.beginPath();
      ctx.rect(0, fillTop, w, w);
      ctx.clip();
      ctx.globalAlpha = 0.6 + 0.4 * this.progress;
      ctx.drawImage(this.body.canvas, x0, y0, S, S);
      ctx.restore();
    }
    if (this.alive) {
      this.blink -= dt;
      if (this.blink < -0.14) this.blink = 1.8 + Math.random() * 2.4;
      const open = this.blink < 0 ? 0.12 : 1;
      const k = S / this.body.size;
      const er = this.body.eyeR * k * 1.3;
      ctx.globalCompositeOperation = 'lighter';
      for (let e = 0; e < 2; e++) {
        const ex = x0 + this.body.eyes[e * 2] * k;
        const ey = y0 + this.body.eyes[e * 2 + 1] * k;
        const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, er * 4);
        g.addColorStop(0, 'rgba(255,216,74,0.6)');
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.fillRect(ex - er * 4, ey - er * 4, er * 8, er * 8);
        ctx.fillStyle = '#ffd84a';
        ctx.beginPath();
        ctx.ellipse(ex, ey, er, er * 1.15 * open, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    this.embers.draw(ctx, dt, '#ffd884');
  }
}

// ---------------------------------------------------------------- playground

type Mood = 'wander' | 'startled' | 'happy' | 'curious' | 'asleep';

interface Kin {
  shape: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  size: number;
  mood: Mood;
  moodT: number;
  spin: number;
  hop: number;
  face: number;
  blink: number;
  nextWander: number;
  wakeDelay: number;
  howl: number;
}

/**
 * Creatures wander a lit wall; your cursor is your hand's shadow. Sweep it to
 * scatter them, hold still to call them, click to pet one, make a wolf to
 * send them running, and leave for a while to let them fall asleep.
 */
class Playground {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: Sprite[];
  private readonly hand: Sprite;
  private readonly wolfHand: Sprite;
  private readonly kin: Kin[] = [];
  private readonly sparks = new Embers(120);
  private readonly rings: { x: number; y: number; t: number; color: string }[] = [];
  private readonly zs: { x: number; y: number; t: number }[] = [];
  private bg: HTMLCanvasElement | null = null;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private px = 0;
  private py = 0;
  private inside = false;
  private speed = 0;
  private still = 0;
  private away = 0;
  private asleep = false;
  private wolf = false;
  private startleCooldown = 0;
  private zClock = 0;
  visible = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly status: HTMLElement,
    wolfToggle: HTMLButtonElement,
    private readonly prepared: PreparedSilhouette[],
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.sprites = prepared.map((p) => shapeSprite(p, 200, '#0b0610', 2.5, 0.3));
    const wolfIndex = prepared.findIndex((p) => p.def.id === 'wolf');
    this.hand = shapeSprite(prepared[0], 300, '#05030a', 9, 0.3);
    this.wolfHand = shapeSprite(prepared[wolfIndex], 300, '#05030a', 9, 0.3);
    this.resize();
    prepared.forEach((_, i) => {
      const x = this.w * (0.15 + 0.7 * Math.random());
      const y = this.h * (0.25 + 0.5 * Math.random());
      this.kin.push({
        shape: i, x, y, vx: 0, vy: 0, tx: x, ty: y, size: 92 + Math.random() * 26, mood: 'wander', moodT: 0,
        spin: 0, hop: Math.random() * 6, face: Math.random() < 0.5 ? -1 : 1, blink: Math.random() * 3,
        nextWander: Math.random() * 2, wakeDelay: 0, howl: 1 + Math.random() * 2,
      });
    });

    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (!this.inside) {
        this.px = p.x;
        this.py = p.y;
      }
      this.inside = true;
    });
    canvas.addEventListener('pointerenter', (e) => {
      const p = local(e);
      this.px = p.x;
      this.py = p.y;
      this.inside = true;
    });
    canvas.addEventListener('pointerleave', () => (this.inside = false));
    canvas.addEventListener('pointerdown', (e) => {
      sfx.unlock();
      const p = local(e);
      this.px = p.x;
      this.py = p.y;
      this.inside = true;
      this.poke(p.x, p.y);
    });
    wolfToggle.addEventListener('click', () => {
      sfx.unlock();
      this.wolf = !this.wolf;
      wolfToggle.setAttribute('aria-pressed', String(this.wolf));
      wolfToggle.textContent = this.wolf ? '✋ Back to a hand' : '🐺 Make a wolf';
      if (this.wolf) sfx.howl(HERE);
    });
  }

  resize(): void {
    const { w, h, dpr } = sizeCanvas(this.canvas);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    const wall = plasterTexture(Math.round(w * dpr), Math.round(h * dpr), '#33231f', '#160e12');
    const ctx = wall.getContext('2d')!;
    // The lantern hangs above the middle of the wall.
    const g = ctx.createRadialGradient(wall.width / 2, -wall.height * 0.1, 0, wall.width / 2, -wall.height * 0.1, wall.height * 1.25);
    g.addColorStop(0, 'rgba(255,200,140,0.55)');
    g.addColorStop(0.4, 'rgba(220,130,70,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, wall.width, wall.height);
    this.bg = wall;
    for (const k of this.kin) {
      k.x = clamp(k.x, 60, w - 60);
      k.y = clamp(k.y, 60, h - 90);
    }
  }

  private poke(x: number, y: number): void {
    let best: Kin | null = null;
    let bestD = Infinity;
    for (const k of this.kin) {
      const d = Math.hypot(k.x - x, k.y - y);
      if (d < k.size * 0.55 && d < bestD) {
        best = k;
        bestD = d;
      }
    }
    if (!best) {
      this.rings.push({ x, y, t: 0, color: 'rgba(255,200,140,0.6)' });
      return;
    }
    const def = this.prepared[best.shape].def;
    if (best.mood === 'asleep') best.wakeDelay = 0;
    best.mood = 'happy';
    best.moodT = 0.9;
    best.spin = 0;
    best.vx = best.vy = 0;
    for (let i = 0; i < 26; i++) this.sparks.spawn(best.x, best.y - best.size * 0.2, 150, 20, 0.9, 2.4);
    this.rings.push({ x: best.x, y: best.y, t: 0, color: def.color });
    sfx.happy(def.voice, HERE);
  }

  frame(dt: number, t: number): void {
    // Your hand's shadow trails the cursor a little, like a real one.
    const r = this.canvas.getBoundingClientRect();
    const tx = pointer.x - r.left;
    const ty = pointer.y - r.top;
    const opx = this.px;
    const opy = this.py;
    if (this.inside) {
      const k = 1 - Math.exp(-dt * 18);
      this.px += (tx - this.px) * k;
      this.py += (ty - this.py) * k;
    }
    const inst = dt > 0 ? Math.hypot(this.px - opx, this.py - opy) / dt : 0;
    this.speed += (inst - this.speed) * (1 - Math.exp(-dt * 10));
    this.still = this.inside && this.speed < 60 ? this.still + dt : 0;
    this.away = this.inside ? 0 : this.away + dt;
    this.startleCooldown -= dt;

    if (!this.asleep && this.away > 6) {
      this.asleep = true;
      for (const k of this.kin) {
        k.mood = 'asleep';
        k.vx = k.vy = 0;
      }
      this.setStatus('Asleep · come back to wake them', true);
    } else if (this.asleep && this.inside) {
      this.asleep = false;
      this.kin.forEach((k, i) => (k.wakeDelay = 0.15 + i * 0.18));
      this.setStatus('Awake', false);
    }

    for (const k of this.kin) this.step(k, dt, t);
    this.draw(dt, t);
  }

  private setStatus(text: string, sleep: boolean): void {
    this.status.querySelector('span')!.textContent = text;
    this.status.classList.toggle('sleep', sleep);
  }

  private step(k: Kin, dt: number, t: number): void {
    const def = this.prepared[k.shape].def;
    const isWolf = def.id === 'wolf';
    const dx = k.x - this.px;
    const dy = k.y - this.py;
    const d = Math.hypot(dx, dy) || 1;
    let wantX = 0;
    let wantY = 0;
    let speed = 70;

    if (k.mood === 'asleep') {
      if (k.wakeDelay > 0) {
        k.wakeDelay -= dt;
        if (k.wakeDelay <= 0) {
          k.mood = 'wander';
          k.hop = 0;
          sfx.wake(def.voice, HERE);
        }
      }
      k.vx *= 0.9;
      k.vy *= 0.9;
      return;
    }

    k.moodT -= dt;
    if (k.mood === 'happy') {
      k.spin = Math.min(1, k.spin + dt / 0.75);
      if (k.moodT <= 0) k.mood = 'wander';
    } else if (this.inside && this.wolf && !isWolf && d < 420) {
      k.mood = 'startled';
      k.moodT = 0.4;
    } else if (this.inside && !this.wolf && this.speed > 850 && d < 220 && k.mood !== 'startled') {
      k.mood = 'startled';
      k.moodT = 0.9;
      if (this.startleCooldown <= 0) {
        sfx.startle(def.voice, HERE);
        this.startleCooldown = 0.3;
      }
    } else if (k.mood === 'startled' && k.moodT <= 0) {
      k.mood = 'wander';
    } else if (k.mood !== 'startled') {
      const calls = this.inside && ((this.wolf && isWolf) || (!this.wolf && this.still > 0.6 && d < 360));
      k.mood = calls ? 'curious' : 'wander';
    }

    if (k.mood === 'startled') {
      wantX = dx / d;
      wantY = dy / d;
      speed = 360;
    } else if (k.mood === 'curious') {
      const stop = k.size * 0.75 + 30;
      if (d > stop) {
        wantX = -dx / d;
        wantY = -dy / d;
        speed = isWolf && this.wolf ? 190 : 80 * Math.min(1, (d - stop) / 60);
      }
      if (isWolf && this.wolf) {
        k.howl -= dt;
        if (k.howl <= 0 && d < 260) {
          k.howl = 3.5 + Math.random() * 2;
          this.rings.push({ x: k.x, y: k.y - k.size * 0.3, t: 0, color: def.color });
          sfx.howl(HERE);
        }
      }
    } else if (k.mood === 'wander') {
      k.nextWander -= dt;
      if (k.nextWander <= 0) {
        k.nextWander = 2 + Math.random() * 3;
        k.tx = this.w * (0.1 + 0.8 * Math.random());
        k.ty = this.h * (0.2 + 0.55 * Math.random());
        if (Math.random() < 0.3) sfx.chirp(def.voice, HERE);
      }
      const ex = k.tx - k.x;
      const ey = k.ty - k.y;
      const e = Math.hypot(ex, ey);
      if (e > 8) {
        wantX = ex / e;
        wantY = ey / e;
        speed = 70 * Math.min(1, e / 80);
      }
    }

    // Kin keep a little apart from each other.
    for (const o of this.kin) {
      if (o === k) continue;
      const ox = k.x - o.x;
      const oy = k.y - o.y;
      const od = Math.hypot(ox, oy) || 1;
      const min = (k.size + o.size) * 0.42;
      if (od < min) {
        wantX += (ox / od) * 0.8;
        wantY += (oy / od) * 0.8;
      }
    }

    const a = 1 - Math.exp(-dt * (k.mood === 'startled' ? 9 : 4));
    k.vx += (wantX * speed - k.vx) * a;
    k.vy += (wantY * speed - k.vy) * a;
    k.x += k.vx * dt;
    k.y += k.vy * dt;
    const m = k.size * 0.45;
    if (k.x < m || k.x > this.w - m) {
      k.x = clamp(k.x, m, this.w - m);
      k.vx *= -0.4;
    }
    if (k.y < m || k.y > this.h - m - 50) {
      k.y = clamp(k.y, m, this.h - m - 50);
      k.vy *= -0.4;
    }
    const v = Math.hypot(k.vx, k.vy);
    k.hop += dt * (v > 12 ? 6 + v / 40 : 0);
    if (Math.abs(k.vx) > 8) k.face = k.vx > 0 ? 1 : -1;
    k.blink -= dt;
    if (k.blink < -0.14) k.blink = 2 + Math.random() * 3;
    void t;
  }

  private draw(dt: number, t: number): void {
    const { ctx, dpr, w, h } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (this.bg) ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const I = flicker(t);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = (I - 0.85) * 2.5;
    const g = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, h);
    g.addColorStop(0, 'rgba(255,200,140,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Your hand's shadow, under the kin.
    if (this.inside) {
      const hs = this.wolf ? this.wolfHand : this.hand;
      const S = Math.min(320, h * 0.62);
      ctx.globalAlpha = 0.78;
      ctx.save();
      ctx.translate(this.px, this.py);
      const stretch = clamp(this.speed / 2400, 0, 0.18);
      ctx.scale(1 + stretch, 1 - stretch * 0.5);
      ctx.drawImage(hs.canvas, -S / 2, -S / 2, S, S);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Kin, back to front.
    const order = this.kin.slice().sort((a, b) => a.y - b.y);
    for (const k of order) {
      const sp = this.sprites[k.shape];
      const def = this.prepared[k.shape].def;
      const S = k.size * 2.2;
      const lift = k.mood === 'asleep' ? 0 : Math.abs(Math.sin(k.hop)) * k.size * 0.12;
      const squash = k.mood === 'asleep' ? 1 + Math.sin(t * 1.6 + k.shape) * 0.03 : 1;
      ctx.save();
      ctx.translate(k.x, k.y - lift);
      if (k.mood === 'happy') ctx.rotate(ease(k.spin) * Math.PI * 2);
      if (k.mood === 'startled') ctx.translate(Math.sin(t * 60) * 1.5, 0);
      ctx.scale(k.face * (2 - squash), squash);
      ctx.globalAlpha = 0.93;
      ctx.drawImage(sp.canvas, -S / 2, -S / 2, S, S);
      ctx.globalAlpha = 1;
      // Eyes, in sprite space (so they flip and spin with the body).
      const s = S / sp.size;
      const er = sp.eyeR * s * (k.mood === 'startled' ? 1.5 : 1.2);
      for (let e = 0; e < 2; e++) {
        const ex = (sp.eyes[e * 2] - sp.size / 2) * s;
        const ey = (sp.eyes[e * 2 + 1] - sp.size / 2) * s;
        if (k.mood === 'asleep') {
          ctx.strokeStyle = def.color;
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = Math.max(1.2, er * 0.5);
          ctx.beginPath();
          ctx.arc(ex, ey - er * 0.3, er, 0.15 * Math.PI, 0.85 * Math.PI);
          ctx.stroke();
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.globalCompositeOperation = 'lighter';
        const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, er * 3.5);
        glow.addColorStop(0, def.color);
        glow.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = glow;
        ctx.fillRect(ex - er * 3.5, ey - er * 3.5, er * 7, er * 7);
        ctx.globalAlpha = 1;
        ctx.fillStyle = def.color;
        if (k.mood === 'happy') {
          ctx.strokeStyle = def.color;
          ctx.lineWidth = Math.max(1.4, er * 0.55);
          ctx.beginPath();
          ctx.arc(ex, ey + er * 0.4, er, 1.15 * Math.PI, 1.85 * Math.PI);
          ctx.stroke();
        } else {
          const open = k.blink < 0 ? 0.12 : 1;
          ctx.beginPath();
          ctx.ellipse(ex, ey, er, er * 1.15 * open, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }

    // Sleep zs.
    if (this.asleep) {
      this.zClock -= dt;
      if (this.zClock <= 0) {
        this.zClock = 0.7;
        const k = this.kin[(Math.random() * this.kin.length) | 0];
        this.zs.push({ x: k.x + k.size * 0.3, y: k.y - k.size * 0.5, t: 0 });
      }
    }
    ctx.fillStyle = 'rgba(245,236,223,0.8)';
    ctx.font = '600 16px Fraunces, Georgia, serif';
    for (let i = this.zs.length - 1; i >= 0; i--) {
      const z = this.zs[i];
      z.t += dt;
      if (z.t > 2) {
        this.zs.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = 1 - z.t / 2;
      ctx.fillText('z', z.x + Math.sin(z.t * 3) * 6, z.y - z.t * 26);
    }
    ctx.globalAlpha = 1;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t > 0.9) {
        this.rings.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - r.t / 0.9;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + ease(r.t / 0.9) * 90, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.sparks.draw(ctx, dt, '#ffe2a8');
  }
}

// ---------------------------------------------------------------- page chrome

class Marquee {
  private offset = 0;
  private half = 1;
  private lastScroll = 0;
  private vel = 0;
  visible = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly row: HTMLElement,
    private readonly lit: HTMLElement,
    private readonly scroller: HTMLElement,
  ) {
    const words = ['Your shadow is waiting', 'Make it', 'Hold it', 'It comes alive', 'Meet your kin'];
    const html = words.map((w) => `<span>${w}</span>`).join('');
    row.innerHTML = lit.innerHTML = html + html;
    this.lastScroll = scroller.scrollTop;
    this.measure();
  }

  measure(): void {
    this.half = this.row.scrollWidth / 2 || 1;
  }

  frame(dt: number): void {
    const s = this.scroller.scrollTop;
    const ds = s - this.lastScroll;
    this.lastScroll = s;
    this.vel += (ds / Math.max(dt, 0.001) - this.vel) * 0.1;
    this.offset -= (60 + Math.abs(this.vel) * 0.35) * dt * (this.vel < 0 ? -1 : 1);
    if (this.offset < -this.half) this.offset += this.half;
    if (this.offset > 0) this.offset -= this.half;
    const skew = clamp(this.vel * -0.004, -8, 8);
    for (const r of [this.row, this.lit]) {
      r.style.setProperty('--mx', `${this.offset}px`);
      r.style.setProperty('--skew', `${skew}deg`);
    }
    const rect = this.el.getBoundingClientRect();
    this.lit.style.setProperty('--lx', `${pointer.x - rect.left - this.offset}px`);
    this.lit.style.setProperty('--ly', `${pointer.y - rect.top - 26}px`);
  }
}

function splitTitle(): void {
  const h1 = document.getElementById('title')!;
  const text = h1.textContent ?? '';
  h1.textContent = '';
  [...text].forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = 'ch lit';
    s.style.setProperty('--i', String(i));
    s.setAttribute('aria-hidden', 'true');
    s.textContent = ch;
    h1.append(s);
  });
}

function setupReveal(root: HTMLElement): void {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    { root, threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
  );
  root.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
}

function setupNav(root: HTMLElement): void {
  const nav = document.getElementById('nav')!;
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('.nav-links a')];
  root.addEventListener('scroll', () => nav.classList.toggle('solid', root.scrollTop > 40), { passive: true });
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const a of links) a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`);
      }
    },
    { root, rootMargin: '-45% 0px -50% 0px' },
  );
  for (const a of links) {
    const target = root.querySelector(a.getAttribute('href')!);
    if (target) io.observe(target);
  }
}

function setupTilt(): void {
  if (reduced || !finePointer) return;
  document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', `${(x - 0.5) * 10}deg`);
      el.style.setProperty('--rx', `${(0.5 - y) * 10}deg`);
      el.style.setProperty('--sx', `${x * 100}%`);
      el.style.setProperty('--sy', `${y * 100}%`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  });
  document.querySelectorAll<HTMLElement>('.btn').forEach((b) => {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      b.style.setProperty('--bx', `${e.clientX - r.left}px`);
      b.style.setProperty('--by', `${e.clientY - r.top}px`);
    });
  });
}

function setupProxies(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-proxy]').forEach((b) => {
    b.addEventListener('click', () => document.getElementById(b.dataset.proxy!)?.click());
  });
}

function watchVisible(el: Element, root: HTMLElement, set: (v: boolean) => void): void {
  new IntersectionObserver((entries) => set(entries[entries.length - 1].isIntersecting), { root, rootMargin: '80px' }).observe(el);
}

/** The "how it plays" illustrations use the real shapes too. */
function buildStepArt(prepared: PreparedSilhouette[]): void {
  const cast = document.querySelector('[data-art="cast"]');
  if (cast) {
    const shade = shapeSprite(prepared[0], 300, '#08040c', 5, 0.3).canvas;
    const hand = shapeSprite(prepared[0], 300, '#e6b58a', 0, 0.3).canvas;
    shade.className = 'shade';
    hand.className = 'hand';
    cast.append(shade, hand);
  }
  const fill = document.querySelector('[data-art="fill"]');
  if (fill) {
    const p = prepared[1];
    const glow = shapeSprite(p, 300, p.def.color, 6, 0.3);
    const body = shapeSprite(p, 300, '#0a0616', 1.5, 0.3);
    const wrap = document.createElement('div');
    wrap.className = 'sprite';
    glow.canvas.className = 'glowc';
    body.canvas.className = 'bodyc';
    wrap.append(glow.canvas, body.canvas);
    for (let e = 0; e < 2; e++) {
      const eye = document.createElement('span');
      eye.className = 'eye';
      const d = (body.eyeR * 2.2 * 100) / body.size;
      eye.style.width = eye.style.height = `${d}%`;
      eye.style.left = `${(body.eyes[e * 2] * 100) / body.size - d / 2}%`;
      eye.style.top = `${(body.eyes[e * 2 + 1] * 100) / body.size - d / 2}%`;
      wrap.append(eye);
    }
    fill.append(wrap);
  }
}

export function setupLandingPage(): void {
  const landing = document.getElementById('landing')!;
  splitTitle();
  setupReveal(landing);
  setupNav(landing);
  setupTilt();
  setupProxies();

  window.addEventListener(
    'pointermove',
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.seen = true;
    },
    { passive: true },
  );

  const prepared = prepareSilhouettes(new ShapeMatcher());
  buildStepArt(prepared);

  const heroEl = landing.querySelector('.hero') as HTMLElement;
  const hero = new HeroWall(document.getElementById('hero-wall') as HTMLCanvasElement, heroEl, prepared);
  const chips = document.getElementById('chips')!;
  const chipEls = prepared.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'tab');
    b.style.setProperty('--c', p.def.color);
    b.textContent = p.def.name;
    b.addEventListener('click', () => {
      sfx.unlock();
      hero.setShape(i, true);
    });
    chips.append(b);
    return b;
  });
  hero.onShape = (i) => chipEls.forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
  hero.onShape(0);
  watchVisible(heroEl, landing, (v) => (hero.visible = v));

  const kin = new KinStrip(document.getElementById('kin-strip')!, prepared);
  watchVisible(document.getElementById('kin')!, landing, (v) => (kin.visible = v));

  const daily = new DailyStage(
    document.getElementById('daily-stage')!,
    document.getElementById('daily-canvas') as HTMLCanvasElement,
    document.getElementById('daily-ring') as unknown as SVGCircleElement,
    document.getElementById('daily-hold')!,
    prepared,
  );
  watchVisible(document.getElementById('daily')!, landing, (v) => (daily.visible = v));

  const play = new Playground(
    document.getElementById('playground') as HTMLCanvasElement,
    document.getElementById('play-status')!,
    document.getElementById('wolf-toggle') as HTMLButtonElement,
    prepared,
  );
  watchVisible(document.getElementById('playground')!, landing, (v) => (play.visible = v));

  const marqueeEl = document.getElementById('marquee')!;
  const marquee = new Marquee(marqueeEl, document.getElementById('marquee-row')!, document.getElementById('marquee-lit')!, landing);
  watchVisible(marqueeEl, landing, (v) => (marquee.visible = v));

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      hero.resize();
      daily.resize();
      play.resize();
      marquee.measure();
    }, 120);
  });
  // Web fonts change the marquee's width once they arrive.
  void document.fonts?.ready.then(() => marquee.measure());

  let last = performance.now();
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (landing.classList.contains('hidden')) return;
    const t = now / 1000;
    if (hero.visible) hero.frame(dt, t);
    if (marquee.visible) marquee.frame(dt);
    if (kin.visible) kin.frame();
    if (daily.visible) daily.frame(dt, t);
    if (play.visible) play.frame(dt, t);
  };
  requestAnimationFrame(loop);
}
