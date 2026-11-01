/**
 * Scores how well a live shadow matches a target silhouette.
 *
 * Both shapes are rasterised small, normalised by pixel centroid and area, then
 * compared with intersection-over-union. Normalising on what is actually drawn
 * (not on joint positions) means hand size, distance to the wall and where the
 * shadow lands all stop mattering; only the shape counts. A few small rotations
 * are tried so a slightly tilted hand still matches.
 */

import { drawShadowGroup, ShadowGroup } from './shadow-projector.js';

const SIZE = 64;
const FIT = 52;
const TARGET_AREA = 950;
const ROTATIONS = [-0.3, -0.15, 0, 0.15, 0.3];
/** A cheaper set for side checks (is that shadow a wolf?). */
const QUICK_ROTATIONS = [-0.2, 0, 0.2];

export interface Normalization {
  /** Centroid in surface meters. */
  cu: number;
  cv: number;
  /** Filled area in square meters. */
  area: number;
}

export class ShapeMatcher {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly mask = new Uint8Array(SIZE * SIZE);

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  /** Measures centroid and area of a shadow by drawing it once at fit scale. */
  measure(shadow: ShadowGroup, out: Normalization): boolean {
    const w = shadow.maxU - shadow.minU;
    const h = shadow.maxV - shadow.minV;
    if (!(w > 0 && h > 0)) return false;
    const s = FIT / Math.max(w, h);
    const mu = (shadow.minU + shadow.maxU) / 2;
    const mv = (shadow.minV + shadow.maxV) / 2;
    this.draw(shadow, s, mu, mv, 0);
    const data = this.ctx.getImageData(0, 0, SIZE, SIZE).data;
    let count = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (data[(y * SIZE + x) * 4 + 3] > 127) {
          count++;
          sx += x;
          sy += y;
        }
      }
    }
    if (count < 8) return false;
    out.cu = mu + (sx / count + 0.5 - SIZE / 2) / s;
    out.cv = mv - (sy / count + 0.5 - SIZE / 2) / s;
    out.area = count / (s * s);
    return true;
  }

  /** Rasterises a normalised mask into `out` (SIZE*SIZE bytes, 0/1). */
  rasterize(
    shadow: ShadowGroup,
    norm: Normalization,
    rotation: number,
    out: Uint8Array,
    mirror = false,
  ): void {
    const s = Math.sqrt(TARGET_AREA / norm.area);
    this.draw(shadow, s, norm.cu, norm.cv, rotation, mirror);
    const data = this.ctx.getImageData(0, 0, SIZE, SIZE).data;
    for (let i = 0; i < SIZE * SIZE; i++) out[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  }

  createMask(): Uint8Array {
    return new Uint8Array(SIZE * SIZE);
  }

  /**
   * Best IoU over the rotation set, trying the mirror image too so left and
   * right hands (and palm-in versus palm-out) both count.
   * `target` comes from `rasterize(..., 0)`.
   */
  score(shadow: ShadowGroup, norm: Normalization, target: Uint8Array, quick = false): number {
    const rotations = quick ? QUICK_ROTATIONS : ROTATIONS;
    let best = 0;
    for (let k = 0; k < rotations.length * 2; k++) {
      const mirror = k >= rotations.length;
      this.rasterize(shadow, norm, rotations[k % rotations.length], this.mask, mirror);
      let inter = 0;
      let union = 0;
      for (let i = 0; i < this.mask.length; i++) {
        const a = this.mask[i];
        const b = target[i];
        inter += a & b;
        union += a | b;
      }
      const iou = union > 0 ? inter / union : 0;
      if (iou > best) best = iou;
    }
    return best;
  }

  private draw(
    shadow: ShadowGroup,
    s: number,
    cu: number,
    cv: number,
    rotation: number,
    mirror = false,
  ): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate(rotation);
    ctx.scale(mirror ? -s : s, -s);
    ctx.translate(-cu, -cv);
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    drawShadowGroup(ctx, shadow);
  }
}
