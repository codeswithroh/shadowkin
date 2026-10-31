/**
 * Shared look for shadow creatures: one canvas texture per silhouette,
 * drawn once. The shape is centred on its centroid so a creature mesh can be
 * placed by centroid and scaled by `size`.
 */

import { CanvasTexture, DoubleSide, MeshBasicMaterial, SRGBColorSpace } from '@iwsdk/core';
import { drawShadowPath } from './shadow-projector.js';
import { PreparedSilhouette } from './silhouettes.js';

const SIZE = 256;
/** Fraction of the texture the shape's sqrt(area) spans. */
export const CREATURE_FILL = 0.34;

export function buildCreatureMaterials(prepared: PreparedSilhouette[]): MeshBasicMaterial[] {
  return prepared.map((p) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const k = (SIZE * CREATURE_FILL) / Math.sqrt(p.norm.area);

    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.scale(k, -k);
    ctx.translate(-p.norm.cu, -p.norm.cv);
    ctx.filter = 'blur(3px)';
    // Opaque here; the material carries the transparency so overlapping
    // strokes do not darken at the joints.
    ctx.fillStyle = '#0a0616';
    ctx.strokeStyle = '#0a0616';
    drawShadowPath(ctx, p.shadow);
    ctx.filter = 'none';

    // Eyes sit a little above the centroid, where a head usually is.
    const w = p.shadow.maxU - p.shadow.minU;
    const eyeV = p.norm.cv + (p.shadow.maxV - p.norm.cv) * 0.18;
    const eyeR = w * 0.035;
    ctx.fillStyle = p.def.color;
    ctx.shadowColor = p.def.color;
    ctx.shadowBlur = 10;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(p.norm.cu + side * w * 0.09, eyeV, eyeR, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: DoubleSide,
    });
  });
}
