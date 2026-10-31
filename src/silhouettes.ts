/**
 * Target silhouettes. Each one is a parametric right hand held palm toward the wall;
 * its shadow (orthographic, straight onto the wall) is the shape to match.
 */

import { Vector3 } from '@iwsdk/core';
import { HandJoints, HandPose, poseHand, straightPose } from './hand-skeleton.js';
import { Normalization, ShapeMatcher } from './matcher.js';
import { createSurface, projectHand, Shadow2D } from './shadow-projector.js';

export interface SilhouetteDef {
  id: string;
  name: string;
  /** Tint for the creature's eyes and the ghost glow. */
  color: string;
  pose: HandPose;
  /** Extra roll around the light axis, radians. */
  roll: number;
}

function pose(p: Partial<Record<keyof HandPose, [number, number]>>): HandPose {
  const base = straightPose();
  for (const key of Object.keys(p) as (keyof HandPose)[]) {
    const [curl, spread] = p[key]!;
    base[key] = { curl, spread };
  }
  return base;
}

export const SILHOUETTES: SilhouetteDef[] = [
  {
    id: 'starfish',
    name: 'Starfish',
    color: '#ffb36b',
    pose: pose({
      thumb: [0, 0.35],
      index: [0, 0.22],
      middle: [0, 0.02],
      ring: [0, -0.2],
      pinky: [0, -0.38],
    }),
    roll: 0,
  },
  {
    id: 'rabbit',
    name: 'Rabbit',
    color: '#f6d6ff',
    pose: pose({
      thumb: [1, 0],
      index: [0, 0.18],
      middle: [0, -0.18],
      ring: [1, 0],
      pinky: [1, 0],
    }),
    roll: 0,
  },
  {
    id: 'stag',
    name: 'Stag',
    color: '#c8ffb0',
    pose: pose({
      thumb: [1, 0],
      index: [0, 0.3],
      middle: [1, 0],
      ring: [1, 0],
      pinky: [0, -0.45],
    }),
    roll: 0,
  },
  {
    id: 'crab',
    name: 'Crab',
    color: '#ff8f8f',
    pose: pose({
      thumb: [0.5, 0.4],
      index: [0.55, 0.25],
      middle: [0.55, 0],
      ring: [0.55, -0.22],
      pinky: [0.55, -0.42],
    }),
    roll: Math.PI,
  },
];

export interface PreparedSilhouette {
  def: SilhouetteDef;
  shadow: Shadow2D;
  norm: Normalization;
  mask: Uint8Array;
}

/** Builds each target's shadow outline and normalised mask once at startup. */
export function prepareSilhouettes(matcher: ShapeMatcher): PreparedSilhouette[] {
  const wall = createSurface();
  // Far enough back that curled fingertips (which reach toward -Z) stay in front.
  wall.origin.set(0, 0, -0.3);
  wall.normal.set(0, 0, 1);
  wall.axisU.set(1, 0, 0);
  wall.axisV.set(0, 1, 0);
  // A far light approximates the orthographic shadow we want as the target.
  const light = new Vector3(0, 0.06, 100);
  const joints = new HandJoints();
  const out: PreparedSilhouette[] = [];
  for (const def of SILHOUETTES) {
    poseHand(def.pose, new Vector3(0, 0, 0), { x: 0, y: 0, z: def.roll }, joints);
    const shadow = projectHand(joints, light, wall, new Shadow2D());
    const norm: Normalization = { cu: 0, cv: 0, area: 1 };
    matcher.measure(shadow, norm);
    const mask = matcher.createMask();
    matcher.rasterize(shadow, norm, 0, mask);
    out.push({ def, shadow, norm, mask });
  }
  return out;
}
