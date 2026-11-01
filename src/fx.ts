/**
 * Small additive particles (embers, sparkles, ink motes) in one instanced draw
 * call. Fading works by scaling instance color toward black, which under
 * additive blending reads as fading out.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';

const COUNT = 96;

/** Soft round dot, white center, used for embers and light pools. */
export function radialTexture(size: number, stops: [number, string][]): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export class Particles {
  readonly mesh: InstancedMesh;
  private readonly pos = new Float32Array(COUNT * 3);
  private readonly vel = new Float32Array(COUNT * 3);
  private readonly life = new Float32Array(COUNT);
  private readonly maxLife = new Float32Array(COUNT);
  private readonly size = new Float32Array(COUNT);
  private readonly gravity = new Float32Array(COUNT);
  private readonly colors: Color[] = [];
  private next = 0;
  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly c = new Color();
  private readonly tangent = new Vector3();
  private readonly bitangent = new Vector3();

  constructor() {
    const material = new MeshBasicMaterial({
      map: radialTexture(64, [
        [0, 'rgba(255,255,255,1)'],
        [0.25, 'rgba(255,255,255,0.8)'],
        [1, 'rgba(255,255,255,0)'],
      ]),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    for (let i = 0; i < COUNT; i++) {
      this.colors.push(new Color());
      this.mesh.setColorAt(i, this.c.setRGB(0, 0, 0));
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
  }

  /** Burst from a point on a surface, mostly out along its normal. */
  burst(at: Vector3, normal: Vector3, color: string, count: number, speed = 0.25, gravity = -0.15): void {
    this.tangent.set(normal.y, normal.z, normal.x).cross(normal).normalize();
    this.bitangent.crossVectors(normal, this.tangent);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % COUNT;
      const a = Math.random() * Math.PI * 2;
      const spread = Math.random() * speed;
      const out = (0.3 + Math.random() * 0.7) * speed;
      this.p
        .copy(this.tangent)
        .multiplyScalar(Math.cos(a) * spread)
        .addScaledVector(this.bitangent, Math.sin(a) * spread)
        .addScaledVector(normal, out);
      this.p.toArray(this.vel, i * 3);
      at.toArray(this.pos, i * 3);
      this.maxLife[i] = this.life[i] = 0.6 + Math.random() * 0.8;
      this.size[i] = 0.004 + Math.random() * 0.008;
      this.gravity[i] = gravity;
      this.colors[i].set(color);
    }
  }

  update(dt: number, camera: Quaternion): void {
    for (let i = 0; i < COUNT; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(this.life[i] / this.maxLife[i], 0);
      const j = i * 3;
      this.vel[j] *= 1 - dt * 1.8;
      this.vel[j + 1] = this.vel[j + 1] * (1 - dt * 1.8) + this.gravity[i] * dt;
      this.vel[j + 2] *= 1 - dt * 1.8;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const flick = 0.75 + Math.random() * 0.25;
      const sz = this.size[i] * (0.4 + k * 0.6);
      this.p.fromArray(this.pos, j);
      this.s.set(sz, sz, sz);
      this.m.compose(this.p, camera, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.c.copy(this.colors[i]).multiplyScalar(k * flick);
      this.mesh.setColorAt(i, this.c);
      if (this.life[i] <= 0) {
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
