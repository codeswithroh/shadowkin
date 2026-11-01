/**
 * Brings shadow creatures to life on their surface.
 *
 * - Wander: little hops around their home spot, staying inside the real
 *   surface's bounds (they won't walk off your table).
 * - Poke one with a fingertip: it does a happy spin and sparkles.
 * - Sweep your hand shadow at them fast and they scatter; hold it still nearby
 *   and they creep over to it. A wolf-shaped shadow sends everyone but the
 *   wolves running, and the wolves come to it.
 * - Leave for a while and they curl up asleep; show your hands and they wake.
 */

import { createSystem, Matrix4, Mesh, Vector3 } from '@iwsdk/core';
import { sfx } from './audio.js';
import { Mood, Shadowkin } from './creature-component.js';
import { fxQueue, shared } from './shared.js';
import { SILHOUETTES, WOLF_INDEX } from './silhouettes.js';

const WANDER_RADIUS = 0.22;
const SURFACE_OFFSET = 0.004;
const SLEEP_AFTER = 25;
const POKE_DEPTH = 0.045;
/** Largest a grown creature gets, meters across. */
const ADULT_SIZE = 0.2;

export class CreatureSystem extends createSystem({
  creatures: { required: [Shadowkin] },
}) {
  private readonly origin = new Vector3();
  private readonly axisU = new Vector3();
  private readonly axisV = new Vector3();
  private readonly normal = new Vector3();
  private readonly basis = new Matrix4();
  private readonly world3 = new Vector3();
  private readonly d = new Vector3();
  private howlCooldown = 0;

  update(delta: number, time: number): void {
    if (shared.paused) return;
    const dt = Math.min(delta, 0.05);
    this.howlCooldown -= dt;
    for (const entity of this.queries.creatures.entities) {
      const object = entity.object3D;
      if (!object) continue;

      const age = entity.getValue(Shadowkin, 'age')! + dt;
      entity.setValue(Shadowkin, 'age', age);
      const silhouette = entity.getValue(Shadowkin, 'silhouette')!;
      const voice = SILHOUETTES[silhouette]?.voice ?? 440;
      // Born the full size of your shadow, then settles into a small creature.
      const bornSize = entity.getValue(Shadowkin, 'size')!;
      const settle = Math.min(Math.max((age - 1.4) / 1.2, 0), 1);
      const eased = settle * settle * (3 - 2 * settle);
      const size = bornSize + (Math.min(bornSize * 0.55, ADULT_SIZE) - bornSize) * eased;
      const phase = entity.getValue(Shadowkin, 'phase')!;
      let u = entity.getValue(Shadowkin, 'u')!;
      let v = entity.getValue(Shadowkin, 'v')!;
      let heading = entity.getValue(Shadowkin, 'heading')!;
      let homeU = entity.getValue(Shadowkin, 'homeU')!;
      let homeV = entity.getValue(Shadowkin, 'homeV')!;
      let mood = entity.getValue(Shadowkin, 'mood')!;
      let moodTime = entity.getValue(Shadowkin, 'moodTime')! + dt;
      const minU = entity.getValue(Shadowkin, 'minU')!;
      const maxU = entity.getValue(Shadowkin, 'maxU')!;
      const minV = entity.getValue(Shadowkin, 'minV')!;
      const maxV = entity.getValue(Shadowkin, 'maxV')!;

      this.origin.fromArray(entity.getVectorView(Shadowkin, 'origin'));
      this.axisU.fromArray(entity.getVectorView(Shadowkin, 'axisU'));
      this.axisV.fromArray(entity.getVectorView(Shadowkin, 'axisV'));
      this.normal.fromArray(entity.getVectorView(Shadowkin, 'normal'));
      this.world3.copy(this.origin).addScaledVector(this.axisU, u).addScaledVector(this.axisV, v);

      const awake = Math.min(Math.max((age - 1.2) / 0.8, 0), 1);
      const prevMood = mood;

      // ---- sleep and waking
      if (mood !== Mood.Asleep && shared.awaySeconds > SLEEP_AFTER) {
        mood = Mood.Asleep;
      } else if (mood === Mood.Asleep && shared.awaySeconds < 0.3) {
        mood = Mood.Happy;
        sfx.wake(voice, this.world3);
      }

      // ---- what your hands are doing near it
      let targetU = 0;
      let targetV = 0;
      let urgent = false;
      if (mood !== Mood.Asleep && awake >= 1) {
        for (const hand of shared.hands) {
          if (!hand.present) continue;
          // Poke: fingertip touching the creature on its surface.
          this.d.subVectors(hand.tip, this.world3);
          const depth = Math.abs(this.d.dot(this.normal));
          const du = this.d.dot(this.axisU);
          const dv = this.d.dot(this.axisV);
          if (depth < POKE_DEPTH && du * du + dv * dv < (size * 0.32 + 0.015) ** 2) {
            if (mood !== Mood.Happy || moodTime > 0.9) {
              mood = Mood.Happy;
              moodTime = 0;
              sfx.happy(voice, this.world3);
              fxQueue.push({ kind: 'sparkle', at: this.world3.clone(), normal: this.normal.clone(), color: SILHOUETTES[silhouette].color, count: 14 });
            }
            continue;
          }

          // Shadow on the same surface.
          if (!hand.shadowOn || hand.shadowNormal.dot(this.normal) < 0.95) continue;
          this.d.subVectors(hand.shadowCenter, this.world3);
          if (Math.abs(this.d.dot(this.normal)) > 0.05) continue;
          const su = this.d.dot(this.axisU);
          const sv = this.d.dot(this.axisV);
          const dist = Math.sqrt(su * su + sv * sv);
          const isWolf = silhouette === WOLF_INDEX;
          if (hand.wolf && !isWolf && dist < 0.8) {
            if (mood !== Mood.Startled) sfx.startle(voice, this.world3);
            mood = Mood.Startled;
            moodTime = 0;
            targetU = -su;
            targetV = -sv;
            urgent = true;
          } else if (hand.wolf && isWolf) {
            mood = Mood.Curious;
            moodTime = 0;
            targetU = su;
            targetV = sv;
            if (this.howlCooldown <= 0) {
              this.howlCooldown = 6;
              sfx.howl(this.world3);
            }
          } else if (dist < hand.shadowRadius + size * 0.35 && hand.shadowSpeed > 0.45) {
            if (mood !== Mood.Startled) sfx.startle(voice, this.world3);
            mood = Mood.Startled;
            moodTime = 0;
            targetU = -su;
            targetV = -sv;
            urgent = true;
          } else if (
            mood !== Mood.Startled &&
            mood !== Mood.Happy &&
            dist < hand.shadowRadius * 3 + 0.1 &&
            dist > hand.shadowRadius * 0.9 &&
            hand.shadowSpeed < 0.12
          ) {
            mood = Mood.Curious;
            moodTime = 0;
            targetU = su;
            targetV = sv;
          }
        }
      }

      // Moods wear off.
      if (mood === Mood.Startled && moodTime > 0.9) mood = Mood.Wander;
      if (mood === Mood.Happy && moodTime > 1.2) mood = Mood.Wander;
      if (mood === Mood.Curious && moodTime > 0.4) mood = Mood.Wander;
      if (mood !== prevMood) {
        moodTime = 0;
        // Wherever it ended up after fleeing or following becomes its new home.
        if (prevMood === Mood.Startled || prevMood === Mood.Curious) {
          homeU = u;
          homeV = v;
          shared.saveRequested = true;
        }
      }

      // ---- movement
      const hopRate = mood === Mood.Startled ? 4.2 : mood === Mood.Happy ? 3 : 2.2;
      const hopCycle = (time * hopRate + phase) % 1;
      const hopping = hopCycle < 0.45 && mood !== Mood.Asleep;
      let speed = 0;
      if (awake > 0 && hopping) {
        if (mood === Mood.Wander) {
          heading += Math.sin(time * 0.7 + phase * 6.28) * dt * 1.5;
          const du = u - homeU;
          const dv = v - homeV;
          if (du * du + dv * dv > WANDER_RADIUS * WANDER_RADIUS) {
            heading = Math.atan2(-dv, -du) + Math.sin(phase * 10) * 0.6;
          }
          speed = size * 0.5 * awake;
        } else if (mood === Mood.Startled || mood === Mood.Curious) {
          if (targetU !== 0 || targetV !== 0) heading = Math.atan2(targetV, targetU);
          speed = size * (mood === Mood.Startled ? (urgent ? 2.2 : 1.6) : 0.7);
        }
        u += Math.cos(heading) * speed * dt;
        v += Math.sin(heading) * speed * dt;
      }

      // Stay on the real surface.
      const margin = size * 0.3;
      const lo = minU + margin;
      const hi = maxU - margin;
      const loV = minV + margin;
      const hiV = maxV - margin;
      if (lo < hi) {
        if (u < lo || u > hi) heading = Math.PI - heading;
        u = Math.min(Math.max(u, lo), hi);
      }
      if (loV < hiV) {
        if (v < loV || v > hiV) heading = -heading;
        v = Math.min(Math.max(v, loV), hiV);
      }

      entity.setValue(Shadowkin, 'u', u);
      entity.setValue(Shadowkin, 'v', v);
      entity.setValue(Shadowkin, 'homeU', homeU);
      entity.setValue(Shadowkin, 'homeV', homeV);
      entity.setValue(Shadowkin, 'heading', heading);
      entity.setValue(Shadowkin, 'mood', mood);
      entity.setValue(Shadowkin, 'moodTime', moodTime);

      // ---- pose
      this.basis.makeBasis(this.axisU, this.axisV, this.normal);
      object.quaternion.setFromRotationMatrix(this.basis);
      object.position
        .copy(this.origin)
        .addScaledVector(this.axisU, u)
        .addScaledVector(this.axisV, v)
        .addScaledVector(this.normal, SURFACE_OFFSET);

      // Birth: grow out of the wall. Then hop squash/stretch and breathe.
      const birth = Math.min(age / 0.6, 1);
      const pop = birth < 1 ? 1 - Math.pow(1 - birth, 3) * Math.cos(birth * 9) : 1;
      const hopAmount = mood === Mood.Happy ? 1.8 : mood === Mood.Startled ? 1.2 : 1;
      const hop = hopping && awake > 0 ? Math.sin((hopCycle / 0.45) * Math.PI) * hopAmount : 0;
      const asleep = mood === Mood.Asleep;
      const breathe = 1 + Math.sin(time * (asleep ? 0.9 : 1.6) + phase * 6.28) * (asleep ? 0.05 : 0.03);
      const s = size * pop * breathe;
      const facing = speed > 0 && Math.cos(heading) < 0 ? -1 : 1;
      const flatten = asleep ? 0.86 : 1;
      object.scale.set(s * (1 - hop * 0.08) * facing, s * (1 + hop * 0.14) * flatten, 1);
      if (mood === Mood.Happy) object.rotateZ(Math.sin(moodTime * 9) * 0.25);
      else if (mood === Mood.Startled) object.rotateZ(Math.sin(time * 40) * 0.05);
      else object.rotateZ(Math.sin(time * 3 + phase * 6.28) * 0.04 * awake);
      // Hop: up the wall on walls, up off the surface on tables.
      if (hop > 0) {
        const up = Math.abs(this.normal.y) < 0.5 ? this.axisV : this.normal;
        object.position.addScaledVector(up, hop * size * 0.06);
      }

      // ---- eyes: open after birth, blink, closed while asleep
      let blink = entity.getValue(Shadowkin, 'blink')! - dt;
      if (blink < -0.14) blink = 1.5 + Math.random() * 3.5;
      entity.setValue(Shadowkin, 'blink', blink);
      const open = Math.min(Math.max((age - 0.45) / 0.3, 0), 1);
      const eyeY = asleep ? 0.12 : blink < 0 ? 0.15 : mood === Mood.Happy ? 0.55 : 1;
      for (let i = 0; i < object.children.length && i < 2; i++) {
        const eye = object.children[i] as Mesh;
        const r = eye.userData.radius as number;
        eye.scale.set(r * open * (mood === Mood.Startled ? 1.3 : 1), r * open * eyeY, 1);
      }

      // ---- the odd chirp
      if (!asleep && awake >= 1) {
        let chirp = entity.getValue(Shadowkin, 'chirp')! - dt;
        if (chirp <= 0) {
          chirp = 7 + Math.random() * 10;
          sfx.chirp(voice, this.world3);
        }
        entity.setValue(Shadowkin, 'chirp', chirp);
      }
    }
  }
}
