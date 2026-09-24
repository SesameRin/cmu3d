// First-person walking ("步行"): a vertical capsule (radius 0.35 m, 1.7 m tall, eye at 1.65 m) that stands on
// ctx.surfaceHeightAt (terrain + walkable meshes such as bridge decks and stairs), is pushed out of building
// colliders, can step up ledges ≤ 0.6 m, refuses terrain steeper than ~46°, jumps and falls with gravity.
//
// Movement is integrated in small sub-steps (≤ 0.2 m) so fast running can't tunnel through thin walls.
// The camera gets a subtle, speed-dependent head bob, a small dip on landing and a smoothed eye height
// so stepping up stairs doesn't jerk the view.
import * as THREE from 'three';
import { clamp, damp, headingForward, headingRight } from './tween.js';

export const WALK = {
  eye: 1.65,
  radius: 0.35,
  height: 1.7,
  walkSpeed: 4,
  runSpeed: 9,
  jumpSpeed: 4.9,     // ≈ 0.9 m jump
  gravity: 13,
  stepUp: 0.6,
  snapDown: 0.65,     // stick to the ground when walking down steps/slopes
  maxSlope: THREE.MathUtils.degToRad(46),
  near: 0.15,
  turnRate: 1.9,      // rad/s for the arrow keys
  maxPitch: 1.45,
};
const DIP_STEP = 1 / 60;   // s — sub-step of the landing-dip spring (stable up to ~0.087 s)
const DIP_MAX = 0.4;       // m — the dip never exceeds this

export function createWalk(ctx, world) {
  const camera = ctx.camera;
  const feet = new THREE.Vector3();
  const vel = new THREE.Vector3(); // x/z horizontal velocity, y unused (vy separate)
  const probe = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const minSlopeY = Math.cos(WALK.maxSlope);
  const B = world.bounds;

  let heading = 0, pitch = 0;
  let vy = 0, onGround = true, groundY = 0;
  let jumpBuffer = 0;           // seconds a jump press stays queued (lets you press slightly before landing)
  let eyeFeet = 0;              // smoothed feet height used for the camera
  let bobPhase = 0, bobAmp = 0;
  let dip = 0, dipVel = 0;      // landing dip spring
  let savedNear = null;
  let active = false;
  let airTime = 0;

  function enter(x, z, h = heading, p = 0, { fromY = Infinity } = {}) {
    feet.set(x, world.groundAt(x, z, fromY), z);
    groundY = feet.y;
    heading = h; pitch = clamp(p, -WALK.maxPitch, WALK.maxPitch);
    vel.set(0, 0, 0); vy = 0; onGround = true; jumpBuffer = 0; airTime = 0; turn.active = false;
    eyeFeet = feet.y; bobPhase = 0; bobAmp = 0; dip = 0; dipVel = 0;
    if (savedNear === null) {
      savedNear = camera.near;
      camera.near = WALK.near;
      camera.updateProjectionMatrix();
    }
    active = true;
    applyCamera(0);
  }

  function exit() {
    active = false;
    if (savedNear !== null) {
      camera.near = savedNear;
      camera.updateProjectionMatrix();
      savedNear = null;
    }
  }

  function look(dh, dp) {
    turn.active = false;
    heading += dh;
    pitch = clamp(pitch + dp, -WALK.maxPitch, WALK.maxPitch);
  }

  function jump() { jumpBuffer = 0.18; }

  // Smoothly turn in place (shortest way round) — e.g. "face north" from the UI.
  const turn = { active: false, t: 0, dur: 0.5, h0: 0, h1: 0, p0: 0, p1: 0 };
  function turnTo(h, p = 0, dur = 0.55) {
    let d = (h - heading) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
    Object.assign(turn, { active: true, t: 0, dur, h0: heading, h1: heading + d, p0: pitch, p1: clamp(p, -WALK.maxPitch, WALK.maxPitch) });
  }

  // Ground under (x, z) reachable from the current feet height (decks more than stepUp above are ignored,
  // so you walk underneath bridges). surfaceHeightAt casts from fromY + 1.2.
  const groundFor = (x, z, feetY) => world.groundAt(x, z, feetY + WALK.stepUp - 1.2);

  // Try to move the feet horizontally to (nx, nz). Returns false if blocked.
  function tryMove(nx, nz) {
    probe.set(nx, feet.y + 0.3, nz);
    ctx.colliders?.resolve(probe, WALK.radius, WALK.height - 0.3);
    nx = clamp(probe.x, B.minX + 5, B.maxX - 5);
    nz = clamp(probe.z, B.minZ + 5, B.maxZ - 5);
    const g = groundFor(nx, nz, feet.y);
    const rise = g - feet.y;
    if (rise > WALK.stepUp) return false;                 // wall / ledge too high
    // Walkable geometry at body height that the downward ground probe can't see: the inside of a solid block
    // taller than a step (plinth, stair side, terrace) or the underside of a deck at head height.
    const probeY = feet.y + WALK.stepUp + 0.02;
    const above = world.walkableAbove?.(nx, nz, probeY, 3.4);
    if (above && (above.inside || above.distance < Math.max(g, feet.y) + WALK.height + 0.05 - probeY)) return false;
    if (onGround && rise > 0.02) {
      // slope limit on bare terrain (walkable meshes are allowed to be stair-like)
      const terrainY = world.heightAt(nx, nz);
      if (g - terrainY < 0.03) {
        ctx.normalAt(nx, nz, nrm);
        if (nrm.y < minSlopeY) return false;
      }
    }
    feet.x = nx; feet.z = nz; groundY = g;
    return true;
  }

  function stepHorizontal(h) {
    const ox = feet.x, oz = feet.z;
    const nx = ox + vel.x * h, nz = oz + vel.z * h;
    if (nx === ox && nz === oz) { groundY = groundFor(ox, oz, feet.y); return; }
    if (tryMove(nx, nz)) return;
    // blocked: slide along the obstacle by trying each axis on its own
    const ax = Math.abs(vel.x) > Math.abs(vel.z);
    if (ax ? (tryMove(nx, oz) || tryMove(ox, nz)) : (tryMove(ox, nz) || tryMove(nx, oz))) return;
    groundY = groundFor(ox, oz, feet.y);
    vel.x *= 0.3; vel.z *= 0.3;
  }

  function stepVertical(h) {
    if (onGround) {
      const drop = feet.y - groundY;
      if (drop <= WALK.snapDown) feet.y = groundY;          // follow slopes/steps up and down
      else { onGround = false; vy = 0; }                     // walked off an edge
    }
    if (!onGround) {
      vy -= WALK.gravity * h;
      feet.y += vy * h;
      if (feet.y <= groundY && vy <= 0) {
        const impact = -vy;
        feet.y = groundY; vy = 0; onGround = true;
        if (airTime > 0.12) dipVel -= clamp(impact * 0.07, 0.05, 0.9);
      }
    }
  }

  // input: { fwd, strafe (−1..1), turn (−1..1), run (bool), speed? (analog override, m/s) }
  function update(dt, input) {
    if (!active) return;
    if (turn.active) {
      turn.t = Math.min(1, turn.t + dt / turn.dur);
      const k = turn.t * turn.t * (3 - 2 * turn.t);
      heading = turn.h0 + (turn.h1 - turn.h0) * k;
      pitch = turn.p0 + (turn.p1 - turn.p0) * k;
      if (turn.t >= 1 || input.turn) turn.active = false;
    }
    heading += (input.turn || 0) * WALK.turnRate * dt;
    headingForward(heading, fwd); headingRight(heading, right);
    let wx = fwd.x * (input.fwd || 0) + right.x * (input.strafe || 0);
    let wz = fwd.z * (input.fwd || 0) + right.z * (input.strafe || 0);
    const m = Math.hypot(wx, wz);
    if (m > 1) { wx /= m; wz /= m; }
    const speed = input.speed ?? (input.run ? WALK.runSpeed : WALK.walkSpeed);
    const a = damp(onGround ? (m > 0.01 ? 9 : 12) : 1.2, dt);
    vel.x += (wx * speed - vel.x) * a;
    vel.z += (wz * speed - vel.z) * a;

    if (jumpBuffer > 0) {
      jumpBuffer -= dt;
      if (onGround) { vy = WALK.jumpSpeed; onGround = false; jumpBuffer = 0; airTime = 0; }
    }
    airTime = onGround ? 0 : airTime + dt;

    const hs = Math.hypot(vel.x, vel.z);
    const n = clamp(Math.ceil((hs * dt) / 0.2), 1, 8);
    const h = dt / n;
    for (let i = 0; i < n; i++) { stepHorizontal(h); stepVertical(h); }
    applyCamera(dt, hs);
  }

  function applyCamera(dt, hs = 0) {
    // eye height smoothing (stairs / small steps), snap for big changes and in the air
    const diff = feet.y - eyeFeet;
    if (!onGround || Math.abs(diff) > 1.2 || dt === 0) eyeFeet = feet.y;
    else eyeFeet += diff * damp(16, dt);
    // head bob: one hump per step, amplitude grows with speed; tiny lateral sway every stride
    if (dt > 0) {
      if (onGround && hs > 0.3) bobPhase += (hs * dt / (hs > 6 ? 1.2 : 0.78)) * Math.PI;
      const targetAmp = onGround ? clamp(hs / WALK.walkSpeed, 0, 1) * (hs > 6 ? 0.05 : 0.03) : 0;
      bobAmp += (targetAmp - bobAmp) * damp(6, dt);
      // landing dip: damped spring back to 0. Sub-stepped: explicit integration of this stiff spring is only
      // stable for steps below ~0.087 s, and a slow device runs whole frames at dt = 0.1 s (the engine's clamp).
      if (dip !== 0 || dipVel !== 0) {
        const n = Math.min(16, Math.ceil(dt / DIP_STEP));
        const h = Math.min(dt, 16 * DIP_STEP) / n;
        for (let i = 0; i < n; i++) { dipVel += (-dip * 140 - dipVel * 17) * h; dip += dipVel * h; }
        if (!Number.isFinite(dip) || !Number.isFinite(dipVel)) dip = dipVel = 0;
        dip = clamp(dip, -DIP_MAX, DIP_MAX);
        if (Math.abs(dip) < 1e-5 && Math.abs(dipVel) < 1e-4) dip = dipVel = 0;
      }
    }
    const bobY = (Math.abs(Math.sin(bobPhase)) - 0.64) * 2 * bobAmp;
    const sway = Math.sin(bobPhase) * bobAmp * 0.35;
    headingRight(heading, right);
    camera.position.set(feet.x + right.x * sway, eyeFeet + WALK.eye + bobY + dip, feet.z + right.z * sway);
    camera.rotation.set(pitch, -heading, 0, 'YXZ');
  }

  return {
    enter, exit, update, look, jump, turnTo,
    feet,
    get heading() { return heading; },
    set heading(v) { heading = v; },
    get pitch() { return pitch; },
    get onGround() { return onGround; },
    get speed() { return Math.hypot(vel.x, vel.z); },
    get active() { return active; },
  };
}
