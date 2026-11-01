/**
 * The lantern: a small paper lantern with a live flame. Its flame position is
 * the light every shadow is cast from. Built procedurally; no model files.
 */

import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from '@iwsdk/core';
import { radialTexture } from './fx.js';

export interface LanternParts {
  group: Group;
  /** Spins to face the viewer. */
  halo: Mesh;
  flame: Mesh;
  body: Mesh;
  bodyMaterial: MeshBasicMaterial;
}

/** Height of the lantern body; the flame sits at the group origin. */
const H = 0.06;

export function buildLantern(): LanternParts {
  const group = new Group();

  // Paper body: a lathe profile, slightly bulged.
  const profile: Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const r = 0.016 + Math.sin(t * Math.PI) * 0.012;
    profile.push(new Vector2(r, (t - 0.5) * H));
  }
  const bodyMaterial = new MeshBasicMaterial({
    color: 0xffa64d,
    transparent: true,
    opacity: 0.55,
    side: DoubleSide,
    depthWrite: false,
  });
  const body = new Mesh(new LatheGeometry(profile, 20), bodyMaterial);
  body.renderOrder = 4;

  // Paper ribs.
  const ribMaterial = new MeshBasicMaterial({ color: 0x5a2e14, transparent: true, opacity: 0.6, depthWrite: false });
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const r = 0.016 + Math.sin(t * Math.PI) * 0.012;
    const rib = new Mesh(new TorusGeometry(r, 0.0006, 4, 24), ribMaterial);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = (t - 0.5) * H;
    rib.renderOrder = 4;
    group.add(rib);
  }

  const capMaterial = new MeshBasicMaterial({ color: 0x2b1a12 });
  const top = new Mesh(new CylinderGeometry(0.012, 0.016, 0.006, 16), capMaterial);
  top.position.y = H / 2 + 0.002;
  const bottom = new Mesh(new CylinderGeometry(0.016, 0.013, 0.006, 16), capMaterial);
  bottom.position.y = -H / 2 - 0.002;
  const handle = new Mesh(new TorusGeometry(0.011, 0.0012, 6, 20, Math.PI), capMaterial);
  handle.position.y = H / 2 + 0.005;

  const flame = new Mesh(
    new SphereGeometry(0.007, 12, 10),
    new MeshBasicMaterial({ color: 0xfff1c2 }),
  );
  flame.scale.set(1, 1.6, 1);

  const halo = new Mesh(
    new PlaneGeometry(0.22, 0.22),
    new MeshBasicMaterial({
      map: radialTexture(128, [
        [0, 'rgba(255,214,150,0.9)'],
        [0.15, 'rgba(255,170,80,0.45)'],
        [0.45, 'rgba(255,130,40,0.12)'],
        [1, 'rgba(255,120,40,0)'],
      ]),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.renderOrder = 6;

  group.add(body, top, bottom, handle, flame, halo);
  return { group, halo, flame, body, bodyMaterial };
}
