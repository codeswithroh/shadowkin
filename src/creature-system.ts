/**
 * Moves shadow creatures around their home spot on a surface: a wandering
 * heading, little hops (squash and stretch), and a slow breathing pulse.
 */

import { createSystem, Matrix4, Vector3 } from '@iwsdk/core';
import { Shadowkin } from './creature-component.js';

const WANDER_RADIUS = 0.22;
const SURFACE_OFFSET = 0.004;

export class CreatureSystem extends createSystem({
  creatures: { required: [Shadowkin] },
}) {
  private readonly origin = new Vector3();
  private readonly axisU = new Vector3();
  private readonly axisV = new Vector3();
  private readonly normal = new Vector3();
  private readonly basis = new Matrix4();

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.05);
    for (const entity of this.queries.creatures.entities) {
      const object = entity.object3D;
      if (!object) continue;

      const age = entity.getValue(Shadowkin, 'age')! + dt;
      entity.setValue(Shadowkin, 'age', age);
      const size = entity.getValue(Shadowkin, 'size')!;
      const phase = entity.getValue(Shadowkin, 'phase')!;
      let u = entity.getValue(Shadowkin, 'u')!;
      let v = entity.getValue(Shadowkin, 'v')!;
      let heading = entity.getValue(Shadowkin, 'heading')!;
      const homeU = entity.getValue(Shadowkin, 'homeU')!;
      const homeV = entity.getValue(Shadowkin, 'homeV')!;

      // Sit still for a beat after being born, then start exploring.
      const awake = Math.min(Math.max((age - 1.2) / 0.8, 0), 1);
      const hopCycle = (time * 2.2 + phase) % 1;
      const hopping = hopCycle < 0.45;
      if (awake > 0 && hopping) {
        heading += Math.sin(time * 0.7 + phase * 6.28) * dt * 1.5;
        const du = u - homeU;
        const dv = v - homeV;
        if (du * du + dv * dv > WANDER_RADIUS * WANDER_RADIUS) {
          heading = Math.atan2(-dv, -du) + Math.sin(phase * 10) * 0.6;
        }
        const speed = size * 0.5 * awake;
        u += Math.cos(heading) * speed * dt;
        v += Math.sin(heading) * speed * dt;
      }
      entity.setValue(Shadowkin, 'u', u);
      entity.setValue(Shadowkin, 'v', v);
      entity.setValue(Shadowkin, 'heading', heading);

      this.origin.fromArray(entity.getVectorView(Shadowkin, 'origin'));
      this.axisU.fromArray(entity.getVectorView(Shadowkin, 'axisU'));
      this.axisV.fromArray(entity.getVectorView(Shadowkin, 'axisV'));
      this.normal.fromArray(entity.getVectorView(Shadowkin, 'normal'));

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
      const hop = hopping && awake > 0 ? Math.sin((hopCycle / 0.45) * Math.PI) : 0;
      const breathe = 1 + Math.sin(time * 1.6 + phase * 6.28) * 0.03;
      const s = size * pop * breathe;
      object.scale.set(s * (1 - hop * 0.08), s * (1 + hop * 0.14), 1);
      object.rotateZ(Math.sin(time * 3 + phase * 6.28) * 0.04 * awake);
    }
  }
}
