/**
 * Target silhouettes. Each one is the parametric right hand (mirrored for a
 * left hand) held palm toward the wall; its shadow, cast straight onto the
 * wall, is the shape to match. Two-hand shapes score both hands together.
 */

import { Vector3 } from '@iwsdk/core';
import { HandJoints, HandPose, poseHand, straightPose } from './hand-skeleton.js';
import { Normalization, ShapeMatcher } from './matcher.js';
import { createSurface, projectHand, Shadow2D, ShadowGroup } from './shadow-projector.js';

export interface HandPlacement {
  pose: HandPose;
  /** Offset of the wrist from the shape's center, meters. */
  x: number;
  y: number;
  /** Roll around the light axis, radians. */
  roll: number;
  mirror: boolean;
}

export interface SilhouetteDef {
  id: string;
  name: string;
  /** Tint for the creature's eyes and the target glow. */
  color: string;
  /** Base pitch of the creature's voice, Hz. */
  voice: number;
  hands: HandPlacement[];
}

function pose(p: Partial<Record<keyof HandPose, [number, number]>>): HandPose {
  const base = straightPose();
  for (const key of Object.keys(p) as (keyof HandPose)[]) {
    const [curl, spread] = p[key]!;
    base[key] = { curl, spread };
  }
  return base;
}

function one(p: HandPose, roll = 0): HandPlacement[] {
  return [{ pose: p, x: 0, y: 0, roll, mirror: false }];
}

const WING = pose({
  thumb: [0, 0.55],
  index: [0, 0.16],
  middle: [0, 0.04],
  ring: [0, -0.1],
  pinky: [0, -0.24],
});

/** In unlock order: each new kin you make reveals the next shape. */
export const SILHOUETTES: SilhouetteDef[] = [
  {
    id: 'starfish',
    name: 'Starfish',
    color: '#ffb36b',
    voice: 520,
    hands: one(
      pose({
        thumb: [0, 0.35],
        index: [0, 0.22],
        middle: [0, 0.02],
        ring: [0, -0.2],
        pinky: [0, -0.38],
      }),
    ),
  },
  {
    id: 'rabbit',
    name: 'Rabbit',
    color: '#f6d6ff',
    voice: 880,
    hands: one(
      pose({
        thumb: [1, 0],
        index: [0, 0.18],
        middle: [0, -0.18],
        ring: [1, 0],
        pinky: [1, 0],
      }),
    ),
  },
  {
    id: 'crab',
    name: 'Crab',
    color: '#ff8f8f',
    voice: 330,
    hands: one(
      pose({
        thumb: [0.5, 0.4],
        index: [0.55, 0.25],
        middle: [0.55, 0],
        ring: [0.55, -0.22],
        pinky: [0.55, -0.42],
      }),
      Math.PI,
    ),
  },
  {
    id: 'stag',
    name: 'Stag',
    color: '#c8ffb0',
    voice: 440,
    hands: one(
      pose({
        thumb: [1, 0],
        index: [0, 0.3],
        middle: [1, 0],
        ring: [1, 0],
        pinky: [0, -0.45],
      }),
    ),
  },
  {
    id: 'wolf',
    name: 'Wolf',
    color: '#9fd8ff',
    voice: 196,
    // Hand on its side: fingers together are the snout, the thumb an ear,
    // a dropped little finger the jaw.
    hands: one(
      pose({
        thumb: [0, 0.45],
        index: [0, -0.03],
        middle: [0, 0],
        ring: [0, 0.03],
        pinky: [0.2, -0.3],
      }),
      Math.PI / 2,
    ),
  },
  {
    id: 'butterfly',
    name: 'Butterfly',
    color: '#ffe27a',
    voice: 660,
    // Two hands, thumbs hooked in the middle, fingers spread as wings.
    hands: [
      { pose: WING, x: -0.05, y: 0, roll: 0.55, mirror: false },
      { pose: WING, x: 0.05, y: 0, roll: -0.55, mirror: true },
    ],
  },
];

export const WOLF_INDEX = SILHOUETTES.findIndex((s) => s.id === 'wolf');

export interface PreparedSilhouette {
  def: SilhouetteDef;
  index: number;
  handCount: number;
  shadow: ShadowGroup;
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
  const position = new Vector3();
  return SILHOUETTES.map((def, index) => {
    const parts = def.hands.map((h) => {
      position.set(h.x, h.y, 0);
      poseHand(h.pose, position, { x: 0, y: 0, z: h.roll }, joints, h.mirror);
      return projectHand(joints, light, wall, new Shadow2D());
    });
    const shadow = new ShadowGroup().set(parts[0], parts[1] ?? null);
    const norm: Normalization = { cu: 0, cv: 0, area: 1 };
    matcher.measure(shadow, norm);
    const mask = matcher.createMask();
    matcher.rasterize(shadow, norm, 0, mask);
    return { def, index, handCount: def.hands.length, shadow, norm, mask };
  });
}
