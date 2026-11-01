/**
 * Per-frame facts the shadow system publishes for the creature system: where
 * your fingertips are, where your hand shadows fall, and whether one of them
 * is shaped like a wolf. Plain module state, written once per frame, no allocation.
 */

import { Vector3 } from '@iwsdk/core';

export interface HandFacts {
  present: boolean;
  /** Index fingertip, world space. */
  tip: Vector3;
  /** Shadow centroid on its surface, world space; valid when `shadowOn`. */
  shadowCenter: Vector3;
  shadowNormal: Vector3;
  shadowRadius: number;
  /** Shadow centroid speed across the surface, m/s. */
  shadowSpeed: number;
  shadowOn: boolean;
  wolf: boolean;
}

function hand(): HandFacts {
  return {
    present: false,
    tip: new Vector3(),
    shadowCenter: new Vector3(),
    shadowNormal: new Vector3(),
    shadowRadius: 0,
    shadowSpeed: 0,
    shadowOn: false,
    wolf: false,
  };
}

export const shared = {
  hands: [hand(), hand()],
  /** Seconds since any hand was last seen; creatures doze when you're away. */
  awaySeconds: 0,
  paused: false,
  /** Nest frame (anchor) world transform, for saving creatures in room space. */
  nestReady: false,
  /** Set by the shadow system whenever creature state should be written out. */
  saveRequested: false,
};

/** A creature was petted, startled, etc. Burst effects are drawn by the shadow system. */
export type FxRequest = { kind: 'sparkle' | 'ink'; at: Vector3; normal: Vector3; color: string; count: number };

export const fxQueue: FxRequest[] = [];
