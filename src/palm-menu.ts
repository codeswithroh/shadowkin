/**
 * Hands-only settings: turn a hand palm-up and a small card floats above it.
 * Poke a button with the other hand's index finger. Palm-up is never a
 * shadow-making pose (its shadow is just an edge), so it can't fire by accident.
 */

import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { HandJoints } from './hand-skeleton.js';

export type MenuAction = 'skip' | 'easy' | 'sound';

const W = 0.16;
const H = 0.05;
const BUTTONS: MenuAction[] = ['skip', 'easy', 'sound'];
const SHOW_AFTER = 0.45;
const PRESS_DEPTH = 0.015;

export class PalmMenu {
  readonly mesh: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  /** Hand index showing the menu, or -1. */
  owner = -1;
  /** Last palm-normal height per hand, for debugging. */
  readonly normalY = [0, 0];
  private held = [0, 0];
  private pressed = -1;
  private flash = 0;
  private flashButton = -1;
  private drawnKey = '';
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly n = new Vector3();
  private readonly palm = new Vector3();
  private readonly local = new Vector3();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 160;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(W, H),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
  }

  /**
   * Returns a pressed action this frame, if any. `hands[i]` are left/right joints,
   * `handedness` +1 for right, -1 for left.
   */
  update(hands: HandJoints[], head: Vector3, dt: number, settings: { easy: boolean; sound: boolean }): MenuAction | null {
    this.flash = Math.max(0, this.flash - dt);
    for (let h = 0; h < 2; h++) {
      const up = hands[h].present && this.palmUp(hands[h], h === 1 ? 1 : -1);
      this.normalY[h] = Number(this.n.y.toFixed(2));
      this.held[h] = up ? this.held[h] + dt : 0;
    }
    if (this.owner >= 0 && this.held[this.owner] === 0) this.owner = -1;
    if (this.owner < 0) {
      for (let h = 0; h < 2; h++) if (this.held[h] > SHOW_AFTER) this.owner = h;
    }
    this.mesh.visible = this.owner >= 0;
    if (this.owner < 0) {
      this.pressed = -1;
      return null;
    }

    // Float above the palm, facing the viewer.
    const joints = hands[this.owner];
    this.palm.fromArray(joints.positions, 0).add(this.a.fromArray(joints.positions, 11 * 3)).multiplyScalar(0.5);
    this.mesh.position.copy(this.palm);
    this.mesh.position.y += 0.07;
    this.mesh.lookAt(head);
    this.mesh.updateMatrixWorld();

    let action: MenuAction | null = null;
    const other = hands[1 - this.owner];
    let touching = -1;
    if (other.present) {
      this.local.fromArray(other.positions, 9 * 3);
      this.mesh.worldToLocal(this.local);
      if (Math.abs(this.local.z) < PRESS_DEPTH && Math.abs(this.local.y) < H / 2 && Math.abs(this.local.x) < W / 2) {
        touching = Math.min(BUTTONS.length - 1, Math.floor(((this.local.x + W / 2) / W) * BUTTONS.length));
      }
    }
    if (touching >= 0 && this.pressed !== touching) {
      action = BUTTONS[touching];
      this.flash = 0.25;
      this.flashButton = touching;
    }
    this.pressed = touching;
    this.draw(settings);
    return action;
  }

  private palmUp(joints: HandJoints, side: number): boolean {
    // Out-of-palm normal from wrist -> index and wrist -> little-finger metacarpals.
    this.a.fromArray(joints.positions, 5 * 3).sub(this.b.fromArray(joints.positions, 0));
    this.n.fromArray(joints.positions, 20 * 3).sub(this.b);
    this.n.crossVectors(this.a, this.n).normalize().multiplyScalar(side);
    return this.n.y > 0.75;
  }

  private draw(settings: { easy: boolean; sound: boolean }): void {
    const key = `${settings.easy}${settings.sound}${this.flashButton}${this.flash > 0}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const labels = ['Skip', settings.easy ? 'Easy ●' : 'Easy ○', settings.sound ? 'Sound ●' : 'Sound ○'];
    const bw = w / BUTTONS.length;
    for (let i = 0; i < BUTTONS.length; i++) {
      const lit = this.flash > 0 && this.flashButton === i;
      ctx.fillStyle = lit ? 'rgba(255,190,110,0.95)' : 'rgba(24,16,34,0.82)';
      ctx.beginPath();
      ctx.roundRect(i * bw + 8, 10, bw - 16, h - 20, 36);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,140,0.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = lit ? '#1a1020' : '#f5ecdf';
      ctx.font = '600 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], i * bw + bw / 2, h / 2);
    }
    this.texture.needsUpdate = true;
  }
}
