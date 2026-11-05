/**
 * Shared look for shadow creatures and target glows: canvas textures per
 * silhouette, drawn once at startup. Every texture is centred on the shape's
 * centroid with sqrt(area) spanning CREATURE_FILL of it, so a mesh placed at a
 * centroid and scaled by sqrt(area) / CREATURE_FILL lines up exactly.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  MeshBasicMaterial,
  SRGBColorSpace,
} from '@iwsdk/core';
import { drawShadowGroup } from './shadow-projector.js';
import { PreparedSilhouette } from './silhouettes.js';

const SIZE = 512;
/** Fraction of the texture the shape's sqrt(area) spans. */
export const CREATURE_FILL = 0.34;

export interface CreatureLook {
  body: MeshBasicMaterial;
  eye: MeshBasicMaterial;
  goldEye: MeshBasicMaterial;
  /** The target shape as a soft pool of light, for showing what to make. */
  guide: MeshBasicMaterial;
  /** Eye centers and radius in the creature mesh's local units (mesh is 1x1). */
  eyes: [number, number, number, number];
  eyeRadius: number;
}

export const eyeGeometry = new CircleGeometry(1, 16);

function drawShape(p: PreparedSilhouette, fill: string, blur: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const k = (SIZE * CREATURE_FILL) / Math.sqrt(p.norm.area);
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.scale(k, -k);
  ctx.translate(-p.norm.cu, -p.norm.cv);
  ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  drawShadowGroup(ctx, p.shadow);
  return canvas;
}

function texture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function buildCreatureLooks(prepared: PreparedSilhouette[]): CreatureLook[] {
  return prepared.map((p) => {
    // Opaque here; the material carries the transparency so overlapping
    // strokes do not darken at the joints.
    const body = new MeshBasicMaterial({
      map: texture(drawShape(p, '#0a0616', 1.5)),
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: DoubleSide,
    });
    const guide = new MeshBasicMaterial({
      map: texture(drawShape(p, p.def.color, 20)),
      transparent: true,
      opacity: 0.3,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const eye = new MeshBasicMaterial({ color: p.def.color, transparent: true, depthWrite: false, side: DoubleSide });
    const goldEye = new MeshBasicMaterial({ color: '#ffd84a', transparent: true, depthWrite: false, side: DoubleSide });

    // Eyes sit a little above the centroid, where a head usually is.
    const L = CREATURE_FILL;
    const dv = 0.24 * L;
    const du = 0.13 * L;
    return { body, eye, goldEye, guide, eyes: [-du, dv, du, dv], eyeRadius: 0.055 * L };
  });
}
