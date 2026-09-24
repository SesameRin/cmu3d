// Easing helpers + the cinematic camera flight used by flyTo / walkTo / mode transitions.
//
// A flight interpolates the camera position along a straight line that is lifted by a sine-shaped arc
// (so long hops "rise over" the campus and short hops stay low) and blends the look-at point from the
// start focus to the end focus slightly ahead of the position, which gives the camera a natural
// "turn towards the destination, then glide in" feel. The arc height is also raised until the path
// clears terrain and building tops sampled along the way.
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Frame-rate independent exponential smoothing factor: x += (goal - x) * damp(rate, dt)
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// All three components of a vector are finite numbers
export const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

// Wrap an angle difference into (-PI, PI]
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

// Heading convention used by the whole controls package: 0 = north (-Z), clockwise (east = +PI/2).
export function headingForward(heading, out) {
  return out.set(Math.sin(heading), 0, -Math.cos(heading));
}
export function headingRight(heading, out) {
  return out.set(Math.cos(heading), 0, Math.sin(heading));
}
// Heading/pitch of a direction vector (need not be normalised)
export function dirToHeading(d) {
  let h = Math.atan2(d.x, -d.z);
  if (h < 0) h += Math.PI * 2;
  return h;
}
export function dirToPitch(d) {
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  return Math.asin(clamp(d.y / l, -1, 1));
}

// Point `dist` metres from `origin` along heading/pitch
export function pointAlong(origin, heading, pitch, dist, out) {
  const c = Math.cos(pitch);
  return out.set(origin.x + Math.sin(heading) * c * dist, origin.y + Math.sin(pitch) * dist, origin.z - Math.cos(heading) * c * dist);
}

export class CameraFlight {
  // world: { obstacleTop(x, z) } — used to lift the arc over terrain/buildings
  constructor(world) {
    this.world = world;
    this.p0 = new THREE.Vector3();
    this.p1 = new THREE.Vector3();
    this.l0 = new THREE.Vector3();
    this.l1 = new THREE.Vector3();
    this.lift = 0;
    this.duration = 1;
    this.t = 0;
    this.active = false;
    this.cancelable = true;
    this.onDone = null;
    this.onCancel = null;
    this.lookLead = 1.25;
    this._tmp = new THREE.Vector3();
  }

  // Suggested duration (seconds) for a hop between two camera poses
  static autoDuration(p0, l0, p1, l1) {
    const d = Math.max(p0.distanceTo(p1), l0.distanceTo(l1) * 0.8);
    return clamp(1.1 + Math.sqrt(d) / 13, 1.2, 5.5);
  }

  start(p0, l0, p1, l1, { duration, arc = true, clearance = 14, cancelable = true, lookLead = 1.25, onDone = null, onCancel = null } = {}) {
    this.p1.copy(p1); this.l1.copy(l1);
    // A non-finite start (a camera that was already broken) would make every frame NaN and the flight never end:
    // start from the destination instead.
    this.p0.copy(finite(p0) ? p0 : p1); this.l0.copy(finite(l0) ? l0 : l1);
    const d = duration ?? CameraFlight.autoDuration(this.p0, this.l0, p1, l1);
    this.duration = Number.isFinite(d) ? Math.max(0.05, d) : 1.5;
    this.t = 0;
    this.cancelable = cancelable;
    this.lookLead = lookLead;
    this.onDone = onDone;
    this.onCancel = onCancel;
    this.active = true;

    // Arc height: a gentle cinematic rise proportional to the horizontal travel distance…
    const dh = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    // (tempered when the hop is mostly a climb or a descent — the chord already has altitude then)
    let lift = arc ? Math.max(0, Math.min(dh * 0.2, 320) * clamp((dh - 30) / 220, 0, 1) - Math.abs(p1.y - p0.y) * 0.35) : 0;
    // …raised until the path clears everything sampled along it (endpoints are assumed clear).
    if (this.world && dh > 4) {
      const N = clamp(Math.ceil(dh / 12), 12, 64);
      for (let i = 1; i < N; i++) {
        const s = i / N;
        if (s < 0.07 || s > 0.93) continue;
        const x = lerp(p0.x, p1.x, s), z = lerp(p0.z, p1.z, s), y = lerp(p0.y, p1.y, s);
        const need = this.world.obstacleTop(x, z) + clearance - y;
        if (need > 0) lift = Math.max(lift, need / Math.pow(Math.sin(Math.PI * s), 0.85));
      }
    }
    this.lift = Number.isFinite(lift) ? Math.min(lift, 1200) : 0;
    return this;
  }

  cancel() {
    if (!this.active) return;
    this.active = false;
    const cb = this.onCancel;
    this.onDone = this.onCancel = null;
    cb?.();
  }

  // Advances the flight; writes the camera position and look-at point. Returns true when finished.
  step(dt, outPos, outLook) {
    this.t = Math.min(1, this.t + dt / this.duration);
    if (!(this.t >= 0)) this.t = 1;   // NaN (bad dt / duration): finish rather than never ending
    const t = this.t;
    const s = easeInOutCubic(t);
    outPos.lerpVectors(this.p0, this.p1, s);
    outPos.y += this.lift * Math.pow(Math.sin(Math.PI * s), 0.85);
    const sl = easeInOutCubic(clamp(t * this.lookLead, 0, 1));
    outLook.lerpVectors(this.l0, this.l1, sl);
    // Guard: never let the look point collapse onto the camera (would spin the view)
    const d = this._tmp.subVectors(outLook, outPos);
    const len = d.length();
    if (len < 6) {
      if (len < 1e-4) d.subVectors(this.l1, this.p1);
      d.normalize();
      outLook.copy(outPos).addScaledVector(d, 6);
    }
    if (t >= 1) {
      this.active = false;
      const cb = this.onDone;
      this.onDone = this.onCancel = null;
      cb?.();
      return true;
    }
    return false;
  }
}
