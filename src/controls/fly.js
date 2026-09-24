// Free-flying camera ("飞行"): WASD moves along the view direction, E/Q (or Space) rise/sink, Shift boosts,
// mouse-drag (or pointer lock) looks around, the wheel changes the cruise speed. The camera glides with
// smoothed velocity, never goes below the terrain/walkables, lands softly on roofs and slides along walls.
import * as THREE from 'three';
import { clamp, damp, headingRight } from './tween.js';

export const FLY = {
  speed: 30,          // default cruise speed, m/s
  minSpeed: 2,
  maxSpeed: 400,
  boost: 4,
  clearance: 1.4,     // metres above ground / walkables
  radius: 0.9,
  maxAltitude: 2600,
  boundsMargin: 700,  // m — how far beyond the data bounds free flight may go
  turnRate: 1.6,
  maxPitch: 1.5,
};

export function createFly(ctx, world) {
  const camera = ctx.camera;
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const wish = new THREE.Vector3();
  const right = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const B = world.bounds;
  let heading = 0, pitch = 0, speed = FLY.speed, active = false;

  function enter(p, h, pt) {
    pos.copy(p); heading = h; pitch = clamp(pt, -FLY.maxPitch, FLY.maxPitch);
    vel.set(0, 0, 0); active = true;
    apply();
  }
  function exit() { active = false; vel.set(0, 0, 0); }

  function look(dh, dp) {
    heading += dh;
    pitch = clamp(pitch + dp, -FLY.maxPitch, FLY.maxPitch);
  }

  // Multiply the cruise speed (wheel). Returns the new speed.
  function scaleSpeed(k) {
    if (Number.isFinite(k) && k > 0) speed = clamp(speed * k, FLY.minSpeed, FLY.maxSpeed);
    return speed;
  }

  // input: { fwd, strafe, vert (−1..1), turn, run }
  function update(dt, input) {
    if (!active) return;
    heading += (input.turn || 0) * FLY.turnRate * dt;
    const cp = Math.cos(pitch);
    headingRight(heading, right);
    const f = input.fwd || 0, s = input.strafe || 0, u = input.vert || 0;
    wish.set(
      Math.sin(heading) * cp * f + right.x * s,
      Math.sin(pitch) * f + u,
      -Math.cos(heading) * cp * f + right.z * s,
    );
    const m = wish.length();
    if (m > 1) wish.multiplyScalar(1 / m);
    // speed also scales gently with altitude above the ground so low flying stays controllable
    const agl = pos.y - world.heightAt(pos.x, pos.z);
    const altK = clamp(0.35 + agl / 60, 0.35, 1.6);
    wish.multiplyScalar(speed * altK * (input.run ? FLY.boost : 1));
    vel.lerp(wish, damp(m > 0.01 ? 4 : 5.5, dt));
    pos.addScaledVector(vel, dt);
    constrain();
    apply();
  }

  function constrain() {
    // horizontal limits first, so the ground / roof checks below apply where the camera really ends up
    const m = FLY.boundsMargin;
    pos.x = clamp(pos.x, B.minX - m, B.maxX + m);
    pos.z = clamp(pos.z, B.minZ - m, B.maxZ + m);
    // buildings: land on roofs when coming from above, otherwise slide along the walls
    const roof = world.roofAbove(pos.x, pos.z, pos.y);
    if (roof !== null && pos.y > roof - 3) {
      if (pos.y < roof + FLY.clearance) { pos.y = roof + FLY.clearance; if (vel.y < 0) vel.y = 0; }
    } else {
      probe.set(pos.x, pos.y - 1, pos.z);
      if (ctx.colliders?.resolve(probe, FLY.radius, 2)) { pos.x = probe.x; pos.z = probe.z; }
    }
    const g = world.groundAt(pos.x, pos.z, pos.y) + FLY.clearance;
    if (pos.y < g) { pos.y = g; if (vel.y < 0) vel.y = 0; }
    if (pos.y > FLY.maxAltitude) { pos.y = FLY.maxAltitude; if (vel.y > 0) vel.y = 0; }
  }

  function apply() {
    camera.position.copy(pos);
    camera.rotation.set(pitch, -heading, 0, 'YXZ');
  }

  return {
    enter, exit, update, look, scaleSpeed, pos,
    get heading() { return heading; },
    get pitch() { return pitch; },
    get speed() { return speed; },
    set speed(v) { if (Number.isFinite(+v)) speed = clamp(+v, FLY.minSpeed, FLY.maxSpeed); },
    get active() { return active; },
  };
}
