/**
 * A living shadow that wanders on the surface where it was born.
 * The surface frame is copied in so the creature does not depend on the
 * plane entity that spawned it (planes can be re-detected or lost).
 */

import { createComponent, Types } from '@iwsdk/core';

export const Mood = { Wander: 0, Startled: 1, Happy: 2, Curious: 3, Asleep: 4 } as const;

export const Shadowkin = createComponent('Shadowkin', {
  silhouette: { type: Types.Int8, default: 0 },
  size: { type: Types.Float32, default: 0.2 },
  u: { type: Types.Float32, default: 0 },
  v: { type: Types.Float32, default: 0 },
  homeU: { type: Types.Float32, default: 0 },
  homeV: { type: Types.Float32, default: 0 },
  heading: { type: Types.Float32, default: 0 },
  phase: { type: Types.Float32, default: 0 },
  age: { type: Types.Float32, default: 0 },
  /** Surface bounds in (u, v) so creatures stay on the real table or wall. */
  minU: { type: Types.Float32, default: -1 },
  maxU: { type: Types.Float32, default: 1 },
  minV: { type: Types.Float32, default: -1 },
  maxV: { type: Types.Float32, default: 1 },
  mood: { type: Types.Int8, default: 0 },
  moodTime: { type: Types.Float32, default: 0 },
  /** Born from the day's shadow: gold eyes. */
  daily: { type: Types.Boolean, default: false },
  /** Seconds until the next blink. */
  blink: { type: Types.Float32, default: 2 },
  chirp: { type: Types.Float32, default: 4 },
  born: { type: Types.String, default: '' },
  origin: { type: Types.Vec3, default: [0, 0, 0] },
  axisU: { type: Types.Vec3, default: [1, 0, 0] },
  axisV: { type: Types.Vec3, default: [0, 1, 0] },
  normal: { type: Types.Vec3, default: [0, 0, 1] },
});
