/**
 * Projects hand joints from a point light onto a flat surface and draws the
 * result as a 2D shadow. All shadow math lives in the surface's own 2D frame
 * (u along `axisU`, v along `axisV`, meters), which keeps scoring independent
 * of where in the room the shadow lands.
 */

import { Quaternion, Vector3 } from '@iwsdk/core';
import { CHAINS, HandJoints, JOINT_COUNT, PALM } from './hand-skeleton.js';

export interface Surface {
  readonly origin: Vector3;
  readonly normal: Vector3;
  readonly axisU: Vector3;
  readonly axisV: Vector3;
  /** Polygon in (u, v); empty means unbounded. */
  polygon: Float32Array;
  label: string;
  virtual: boolean;
}

export function createSurface(): Surface {
  return {
    origin: new Vector3(),
    normal: new Vector3(0, 1, 0),
    axisU: new Vector3(1, 0, 0),
    axisV: new Vector3(0, 0, -1),
    polygon: new Float32Array(0),
    label: '',
    virtual: false,
  };
}

const WORLD_UP = new Vector3(0, 1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();

/**
 * Sets up a surface's basis. Vertical surfaces get v = up; horizontal ones get
 * v = away from the viewer so shadows read upright when looking down at them.
 */
export function orientSurface(
  surface: Surface,
  origin: Vector3,
  normal: Vector3,
  viewerForward: Vector3,
): void {
  surface.origin.copy(origin);
  surface.normal.copy(normal).normalize();
  const n = surface.normal;
  tmpA.copy(WORLD_UP).addScaledVector(n, -WORLD_UP.dot(n));
  if (tmpA.lengthSq() < 0.05) {
    tmpA.copy(viewerForward).addScaledVector(n, -viewerForward.dot(n));
    if (tmpA.lengthSq() < 1e-6) tmpA.set(0, 0, -1);
  }
  surface.axisV.copy(tmpA.normalize());
  surface.axisU.crossVectors(surface.axisV, n).normalize();
}

/** Fills a surface from an XRPlane pose (plane space: +Y normal, polygon in x/z). */
export function surfaceFromPlane(
  surface: Surface,
  position: Vector3,
  quaternion: Quaternion,
  polygon: ReadonlyArray<DOMPointReadOnly>,
  viewerForward: Vector3,
): void {
  tmpB.set(0, 1, 0).applyQuaternion(quaternion);
  orientSurface(surface, position, tmpB, viewerForward);
  if (surface.polygon.length !== polygon.length * 2) {
    surface.polygon = new Float32Array(polygon.length * 2);
  }
  for (let i = 0; i < polygon.length; i++) {
    tmpA.set(polygon[i].x, polygon[i].y, polygon[i].z).applyQuaternion(quaternion);
    surface.polygon[i * 2] = tmpA.dot(surface.axisU);
    surface.polygon[i * 2 + 1] = tmpA.dot(surface.axisV);
  }
}

export function surfaceContains(surface: Surface, u: number, v: number): boolean {
  const p = surface.polygon;
  const n = p.length / 2;
  if (n < 3) return true;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ui = p[i * 2];
    const vi = p[i * 2 + 1];
    const uj = p[j * 2];
    const vj = p[j * 2 + 1];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Distance along the ray from `from` toward `through` at which it meets the
 * surface, as a multiple of |through - from|. Returns -1 for no hit in front of
 * the hand or a hit outside the surface polygon.
 */
export function rayHit(surface: Surface, from: Vector3, through: Vector3): number {
  tmpA.subVectors(through, from);
  const denom = tmpA.dot(surface.normal);
  if (Math.abs(denom) < 1e-6) return -1;
  tmpB.subVectors(surface.origin, from);
  const t = tmpB.dot(surface.normal) / denom;
  if (t <= 1.02) return -1;
  tmpB.copy(from).addScaledVector(tmpA, t).sub(surface.origin);
  if (!surfaceContains(surface, tmpB.dot(surface.axisU), tmpB.dot(surface.axisV))) {
    return -1;
  }
  return t;
}

/** A hand's shadow in surface (u, v) coordinates. */
export class Shadow2D {
  readonly points = new Float32Array(JOINT_COUNT * 2);
  readonly radii = new Float32Array(JOINT_COUNT);
  valid = false;
  minU = 0;
  maxU = 0;
  minV = 0;
  maxV = 0;

  updateBounds(): void {
    this.minU = this.minV = Infinity;
    this.maxU = this.maxV = -Infinity;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const u = this.points[j * 2];
      const v = this.points[j * 2 + 1];
      const r = this.radii[j];
      if (u - r < this.minU) this.minU = u - r;
      if (u + r > this.maxU) this.maxU = u + r;
      if (v - r < this.minV) this.minV = v - r;
      if (v + r > this.maxV) this.maxV = v + r;
    }
  }
}

const tmpJoint = new Vector3();
const tmpHit = new Vector3();

/** Projects every joint through the light onto the surface. */
export function projectHand(
  hand: HandJoints,
  light: Vector3,
  surface: Surface,
  out: Shadow2D,
): Shadow2D {
  out.valid = false;
  if (!hand.present) return out;
  for (let j = 0; j < JOINT_COUNT; j++) {
    tmpJoint.fromArray(hand.positions, j * 3);
    tmpA.subVectors(tmpJoint, light);
    const denom = tmpA.dot(surface.normal);
    if (Math.abs(denom) < 1e-6) return out;
    tmpB.subVectors(surface.origin, light);
    const t = tmpB.dot(surface.normal) / denom;
    if (t <= 1) return out;
    tmpHit.copy(light).addScaledVector(tmpA, t).sub(surface.origin);
    out.points[j * 2] = tmpHit.dot(surface.axisU);
    out.points[j * 2 + 1] = tmpHit.dot(surface.axisV);
    // A sphere's shadow grows with the same ratio as its center's offset.
    out.radii[j] = hand.radii[j] * t;
  }
  out.valid = true;
  out.updateBounds();
  return out;
}

/** Adds a round-ended tapered limb from (ax, ay) to (bx, by) to the current path. */
function addLimb(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= Math.abs(ar - br)) {
    const r = Math.max(ar, br);
    const x = ar > br ? ax : bx;
    const y = ar > br ? ay : by;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    return;
  }
  const angle = Math.atan2(dy, dx);
  const open = Math.acos((ar - br) / d);
  ctx.moveTo(ax + Math.cos(angle + open) * ar, ay + Math.sin(angle + open) * ar);
  ctx.arc(ax, ay, ar, angle + open, angle + Math.PI * 2 - open);
  ctx.arc(bx, by, br, angle - open, angle + open);
  ctx.closePath();
}

const FINGER_WAIST = 0.93;
const WEB_REACH = 0.3;
const FOREARM_LENGTH = 2.6;
const FOREARM_FLARE = 1.4;

/**
 * Draws a shadow into a 2D context whose transform already maps (u, v) meters
 * to pixels. Uses the current fill/stroke style. Fingers taper and narrow
 * between knuckles, and the palm has a thumb web, webbing and a heel, so the
 * outline reads as a hand. `arm` adds the forearm, for display only: scoring
 * and targets compare the hand alone.
 */
export function drawShadowPath(
  ctx: CanvasRenderingContext2D,
  shadow: Shadow2D,
  radiusScale = 1,
  arm = false,
): void {
  const p = shadow.points;
  const r = shadow.radii;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const wx = p[0];
  const wy = p[1];
  const kx = p[22];
  const ky = p[23];
  let sideU = p[42] - p[12];
  let sideV = p[43] - p[13];
  const span = Math.sqrt(sideU * sideU + sideV * sideV);
  if (span > 1e-6) {
    sideU /= span;
    sideV /= span;
  } else {
    sideU = 1;
    sideV = 0;
  }
  // Seen edge-on the palm collapses but the wrist keeps its thickness.
  const wrist = Math.max(span * 0.36, r[0]);
  const centerU = (wx + kx) / 2;
  const centerV = (wy + ky) / 2;

  ctx.beginPath();
  ctx.moveTo(wx - sideU * wrist, wy - sideV * wrist);
  // Ball of the thumb, then the web across to the index knuckle.
  ctx.quadraticCurveTo(p[2] - sideU * r[1] * 0.7, p[3] - sideV * r[1] * 0.7, p[4], p[5]);
  ctx.quadraticCurveTo(
    (p[4] + p[12]) / 2 + (centerU - (p[4] + p[12]) / 2) * 0.22,
    (p[5] + p[13]) / 2 + (centerV - (p[5] + p[13]) / 2) * 0.22,
    p[12],
    p[13],
  );
  // Webbing sits a little way up the first finger bones.
  for (let f = 0; f < 3; f++) {
    const a = 6 + f * 5;
    const b = a + 5;
    const webU = (p[a * 2] + (p[a * 2 + 2] - p[a * 2]) * WEB_REACH + p[b * 2] + (p[b * 2 + 2] - p[b * 2]) * WEB_REACH) / 2;
    const webV =
      (p[a * 2 + 1] + (p[a * 2 + 3] - p[a * 2 + 1]) * WEB_REACH + p[b * 2 + 1] + (p[b * 2 + 3] - p[b * 2 + 1]) * WEB_REACH) / 2;
    ctx.lineTo(webU, webV);
    ctx.lineTo(p[b * 2], p[b * 2 + 1]);
  }
  // Heel of the hand down the little-finger side.
  ctx.quadraticCurveTo(
    p[40] + sideU * r[20] * 1.5,
    p[41] + sideV * r[20] * 1.5,
    wx + sideU * wrist,
    wy + sideV * wrist,
  );
  // Rounded off here so a creature's body has no flat cut; the arm covers it.
  ctx.quadraticCurveTo(wx + (wx - kx) * 0.2, wy + (wy - ky) * 0.2, wx - sideU * wrist, wy - sideV * wrist);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = r[11] * 1.4 * radiusScale;
  ctx.stroke();

  ctx.beginPath();
  for (const chain of CHAINS) {
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      const ax = p[a * 2];
      const ay = p[a * 2 + 1];
      const bx = p[b * 2];
      const by = p[b * 2 + 1];
      const ar = r[a] * radiusScale;
      const br = r[b] * radiusScale;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const mr = ((ar + br) / 2) * FINGER_WAIST;
      addLimb(ctx, ax, ay, ar, mx, my, mr);
      addLimb(ctx, mx, my, mr, bx, by, br);
    }
  }
  if (arm) {
    addLimb(
      ctx,
      wx,
      wy,
      wrist * 0.96,
      wx + (wx - kx) * FOREARM_LENGTH,
      wy + (wy - ky) * FOREARM_LENGTH,
      wrist * FOREARM_FLARE,
    );
  }
  ctx.fill();
}

/**
 * One or two hand shadows on the same surface, treated as a single shape.
 * Two-hand silhouettes (a butterfly) score the union of both hands.
 */
export class ShadowGroup {
  readonly parts: Shadow2D[] = [];
  count = 0;
  minU = 0;
  maxU = 0;
  minV = 0;
  maxV = 0;

  get valid(): boolean {
    return this.count > 0;
  }

  set(a: Shadow2D | null, b: Shadow2D | null = null): this {
    this.count = 0;
    if (a?.valid) this.parts[this.count++] = a;
    if (b?.valid) this.parts[this.count++] = b;
    this.minU = this.minV = Infinity;
    this.maxU = this.maxV = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const s = this.parts[i];
      if (s.minU < this.minU) this.minU = s.minU;
      if (s.maxU > this.maxU) this.maxU = s.maxU;
      if (s.minV < this.minV) this.minV = s.minV;
      if (s.maxV > this.maxV) this.maxV = s.maxV;
    }
    return this;
  }
}

export function drawShadowGroup(
  ctx: CanvasRenderingContext2D,
  group: ShadowGroup,
  radiusScale = 1,
  arm = false,
): void {
  for (let i = 0; i < group.count; i++) drawShadowPath(ctx, group.parts[i], radiusScale, arm);
}
