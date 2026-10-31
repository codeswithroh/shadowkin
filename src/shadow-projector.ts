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

/**
 * Draws a shadow into a 2D context whose transform already maps (u, v) meters
 * to pixels. Uses the current fill/stroke style.
 */
export function drawShadowPath(
  ctx: CanvasRenderingContext2D,
  shadow: Shadow2D,
  radiusScale = 1,
): void {
  const p = shadow.points;
  const r = shadow.radii;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  for (let i = 0; i < PALM.length; i++) {
    const j = PALM[i];
    if (i === 0) ctx.moveTo(p[j * 2], p[j * 2 + 1]);
    else ctx.lineTo(p[j * 2], p[j * 2 + 1]);
  }
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = r[11] * 1.6 * radiusScale;
  ctx.stroke();

  for (const chain of CHAINS) {
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      ctx.beginPath();
      ctx.moveTo(p[a * 2], p[a * 2 + 1]);
      ctx.lineTo(p[b * 2], p[b * 2 + 1]);
      ctx.lineWidth = (r[a] + r[b]) * radiusScale;
      ctx.stroke();
    }
  }
}
