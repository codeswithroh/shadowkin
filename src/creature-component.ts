/**
 * A living shadow that wanders on the surface where it was born.
 * The surface frame is copied in so the creature does not depend on the
 * plane entity that spawned it (planes can be re-detected or lost).
 */

import { createComponent, Types } from '@iwsdk/core';

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
  origin: { type: Types.Vec3, default: [0, 0, 0] },
  axisU: { type: Types.Vec3, default: [1, 0, 0] },
  axisV: { type: Types.Vec3, default: [0, 1, 0] },
  normal: { type: Types.Vec3, default: [0, 0, 1] },
});
