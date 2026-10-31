/**
 * WebXR hand skeleton layout plus a small parametric hand used for target
 * silhouettes and the desktop simulator. Joint order matches XRHand iteration
 * order, so arrays produced here and arrays filled from real XRJointPoses are
 * interchangeable.
 */

import { Euler, Matrix4, Vector3 } from '@iwsdk/core';

export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const satisfies readonly XRHandJoint[];

export const JOINT_COUNT = JOINT_NAMES.length;

/** Joint chains drawn as round-capped capsules. */
export const CHAINS: readonly (readonly number[])[] = [
  [1, 2, 3, 4],
  [6, 7, 8, 9],
  [11, 12, 13, 14],
  [16, 17, 18, 19],
  [21, 22, 23, 24],
];

/** Filled palm outline. */
export const PALM: readonly number[] = [0, 1, 2, 6, 11, 16, 21, 20];

/**
 * One hand's joints: positions as xyz triples and radii, both in meters.
 * `present` is false when the hand is not tracked this frame.
 */
export class HandJoints {
  readonly positions = new Float32Array(JOINT_COUNT * 3);
  readonly radii = new Float32Array(JOINT_COUNT);
  present = false;

  copyFrom(other: HandJoints): void {
    this.positions.set(other.positions);
    this.radii.set(other.radii);
    this.present = other.present;
  }
}

/** Finger curl 0 = straight, 1 = fist. Spread in radians, + is toward thumb. */
export interface HandPose {
  thumb: { curl: number; spread: number };
  index: { curl: number; spread: number };
  middle: { curl: number; spread: number };
  ring: { curl: number; spread: number };
  pinky: { curl: number; spread: number };
}

interface FingerSpec {
  base: [number, number, number];
  knuckle: [number, number, number];
  lengths: [number, number, number];
  radii: [number, number, number, number];
  restSpread: number;
}

// Right hand, palm toward -Z, fingers toward +Y, thumb on +X.
const FINGERS: FingerSpec[] = [
  {
    base: [0.012, 0.03, 0],
    knuckle: [0.024, 0.088, 0],
    lengths: [0.04, 0.025, 0.021],
    radii: [0.0105, 0.0095, 0.0085, 0.0075],
    restSpread: 0.08,
  },
  {
    base: [0.003, 0.03, 0],
    knuckle: [0.004, 0.092, 0],
    lengths: [0.045, 0.028, 0.022],
    radii: [0.011, 0.01, 0.009, 0.0078],
    restSpread: 0,
  },
  {
    base: [-0.008, 0.03, 0],
    knuckle: [-0.015, 0.087, 0],
    lengths: [0.042, 0.026, 0.021],
    radii: [0.0102, 0.0093, 0.0083, 0.0073],
    restSpread: -0.08,
  },
  {
    base: [-0.018, 0.027, 0],
    knuckle: [-0.033, 0.077, 0],
    lengths: [0.033, 0.021, 0.019],
    radii: [0.0092, 0.0083, 0.0075, 0.0066],
    restSpread: -0.18,
  },
];

const FLEX = [1.45, 1.7, 1.15];
const tmpDir = new Vector3();
const tmpPalm = new Vector3(0, 0, -1);
const tmpPos = new Vector3();
const tmpMatrix = new Matrix4();
const tmpEuler = new Euler();

function writeJoint(
  out: HandJoints,
  index: number,
  p: Vector3,
  radius: number,
): void {
  out.positions[index * 3] = p.x;
  out.positions[index * 3 + 1] = p.y;
  out.positions[index * 3 + 2] = p.z;
  out.radii[index] = radius;
}

/**
 * Forward kinematics for the parametric hand, then a rigid transform.
 * `mirror` turns the right-hand model into a left hand.
 */
export function poseHand(
  pose: HandPose,
  position: Vector3,
  rotation: { x: number; y: number; z: number },
  out: HandJoints,
  mirror = false,
): HandJoints {
  tmpPos.set(0, 0, 0);
  writeJoint(out, 0, tmpPos, 0.018);

  // Thumb: swings from +X toward the palm as it curls.
  const t = pose.thumb;
  const thumbAngle = 0.75 + t.spread - t.curl * 0.9;
  tmpPos.set(0.02, 0.018, -0.006);
  writeJoint(out, 1, tmpPos, 0.016);
  const thumbLengths = [0.042, 0.032, 0.026];
  const thumbRadii = [0.0125, 0.0105, 0.009];
  let bend = t.curl * 0.25;
  for (let i = 0; i < 3; i++) {
    tmpDir
      .set(Math.sin(thumbAngle), Math.cos(thumbAngle), 0)
      .multiplyScalar(Math.cos(bend))
      .addScaledVector(tmpPalm, Math.sin(bend));
    tmpPos.addScaledVector(tmpDir, thumbLengths[i]);
    writeJoint(out, 2 + i, tmpPos, thumbRadii[i]);
    bend += t.curl * (i === 0 ? 0.5 : 0.9);
  }

  const fingers = [pose.index, pose.middle, pose.ring, pose.pinky];
  for (let f = 0; f < 4; f++) {
    const spec = FINGERS[f];
    const { curl, spread } = fingers[f];
    const first = 5 + f * 5;
    tmpPos.fromArray(spec.base);
    writeJoint(out, first, tmpPos, spec.radii[0] * 1.1);
    tmpPos.fromArray(spec.knuckle);
    writeJoint(out, first + 1, tmpPos, spec.radii[0]);
    const s = spec.restSpread * 0.4 + spread;
    let theta = 0;
    for (let i = 0; i < 3; i++) {
      theta += curl * FLEX[i];
      tmpDir
        .set(Math.sin(s), Math.cos(s), 0)
        .multiplyScalar(Math.cos(theta))
        .addScaledVector(tmpPalm, Math.sin(theta));
      tmpPos.addScaledVector(tmpDir, spec.lengths[i]);
      writeJoint(out, first + 2 + i, tmpPos, spec.radii[i + 1]);
    }
  }

  tmpEuler.set(rotation.x, rotation.y, rotation.z);
  tmpMatrix.makeRotationFromEuler(tmpEuler).setPosition(position);
  for (let j = 0; j < JOINT_COUNT; j++) {
    tmpPos.fromArray(out.positions, j * 3);
    if (mirror) tmpPos.x = -tmpPos.x;
    tmpPos.applyMatrix4(tmpMatrix);
    tmpPos.toArray(out.positions, j * 3);
  }
  out.present = true;
  return out;
}

export function straightPose(): HandPose {
  return {
    thumb: { curl: 0, spread: 0 },
    index: { curl: 0, spread: 0 },
    middle: { curl: 0, spread: 0 },
    ring: { curl: 0, spread: 0 },
    pinky: { curl: 0, spread: 0 },
  };
}
