// Map-style orbit camera ("俯瞰"): the camera circles a target point that sits on the ground.
//
// State is kept twice: `goal` is what input writes to, `cur` follows it with exponential smoothing
// (frame-rate independent damping). Rotation and panning additionally keep a little momentum after the
// pointer is released (fling). Constraints — distance, polar angle, data bounds, ground/buildings — are
// applied to the goal; the terrain constraint is also applied hard to the current pose so the camera can
// never dip below the ground, even for a single frame.
//
// `exact` mode (after setView / flyTo) displays the requested pose verbatim — no clamps, no smoothing — until
// the user touches the controls. This keeps scripted views (screenshots, tour stops) pixel-exact.
import * as THREE from 'three';
import { clamp, damp, headingForward, headingRight } from './tween.js';

export const ORBIT_LIMITS = {
  minDist: 15,
  maxDist: 2500,
  minElev: THREE.MathUtils.degToRad(5), // polar angle <= 85°
  maxElev: THREE.MathUtils.degToRad(89),
  groundClearance: 2,
  boundsMargin: 150,   // m — how far outside the data bounds the target may go
  poseMargin: 5000,    // m — sanity box for any requested camera / pivot position (horizontal)…
  minY: -1000,         // …and its vertical range
  maxY: 8000,
};

const TWO_PI = Math.PI * 2;

export function createOrbit(ctx, world) {
  const camera = ctx.camera;
  const canvas = ctx.canvas || ctx.renderer.domElement;
  const L = ORBIT_LIMITS;
  const mk = () => ({ target: new THREE.Vector3(-100, 45, 60), heading: 0, elev: 0.6, dist: 420 });
  const cur = mk();
  const goal = mk();
  let exact = false;
  let followGround = true; // snap the target to the terrain (after user pans/zooms)
  const fling = { heading: 0, elev: 0, pan: new THREE.Vector3() };
  const vel = { heading: 0, elev: 0, pan: new THREE.Vector3(), t: 0 };

  // scratch objects (no per-frame allocation)
  const camPos = new THREE.Vector3();
  const goalPos = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let buildingLift = 0; // soft extra height applied to the current pose while it catches up with the goal

  function positionOf(s, out) {
    const ce = Math.cos(s.elev);
    return out.set(
      s.target.x - Math.sin(s.heading) * ce * s.dist,
      s.target.y + Math.sin(s.elev) * s.dist,
      s.target.z + Math.cos(s.heading) * ce * s.dist,
    );
  }

  // Raise a state's elevation (then distance) so the camera ends up at least at height minY.
  function liftState(s, minY) {
    const need = minY - s.target.y;
    if (need <= s.dist * Math.sin(s.elev)) return false;
    const cap = 1.25; // ~72°: beyond that, back away instead of tilting further
    let e = need >= s.dist ? cap : Math.min(cap, Math.asin(need / s.dist));
    if (e > s.elev) s.elev = e;
    if (s.dist * Math.sin(s.elev) < need) s.dist = need / Math.sin(s.elev);
    return true;
  }

  // Minimum allowed camera height at (x, z): terrain/walkables + clearance, or above a building roof.
  function minCameraY(p) {
    const ground = world.heightAt(p.x, p.z);
    let minY = ground + L.groundClearance;
    if (p.y - ground < 60 && ctx.walkables?.meshes?.length) {
      minY = Math.max(minY, world.groundAt(p.x, p.z, p.y) + L.groundClearance);
    }
    if (p.y - ground < 260) {
      // 5 m look-ahead margin: start rising before the camera actually reaches a wall
      const roof = world.roofAbove(p.x, p.z, p.y, 5);
      if (roof !== null) minY = Math.max(minY, roof + 2.5);
    }
    return minY;
  }

  // Keep a point inside a generous box around the data. Absurd but finite coordinates (a share link with
  // cam=1e200,…) would otherwise overflow the camera distance to Infinity and turn the camera into NaN.
  function saneBox(p) {
    const b = world.bounds, m = L.poseMargin;
    p.x = clamp(p.x, b.minX - m, b.maxX + m);
    p.z = clamp(p.z, b.minZ - m, b.maxZ + m);
    p.y = clamp(p.y, L.minY, L.maxY);
    return p;
  }
  // A pivot outside the area orbit targets may occupy (bounds ± boundsMargin) is pulled back along the view ray
  // to where that ray leaves the area: the view is unchanged, and the first interaction doesn't make the camera
  // jump when the target gets clamped. (If the ray never crosses the area the pivot is left alone.)
  function pullPivotIn(P, T) {
    const b = world.bounds, m = L.boundsMargin;
    const x0 = b.minX - m, x1 = b.maxX + m, z0 = b.minZ - m, z1 = b.maxZ + m;
    if (T.x >= x0 && T.x <= x1 && T.z >= z0 && T.z <= z1) return;
    const dx = T.x - P.x, dz = T.z - P.z;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {           // Liang–Barsky: p·t <= q
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (clip(-dx, P.x - x0) && clip(dx, x1 - P.x) && clip(-dz, P.z - z0) && clip(dz, z1 - P.z) && t1 > 0) {
      const len = P.distanceTo(T);
      T.lerpVectors(P, T, Math.min(1, Math.max(t1, L.minDist / len)));   // (never closer than minDist)
    }
  }

  const sP = new THREE.Vector3(), sT = new THREE.Vector3();
  function setPose(pos, look, { exact: ex = false } = {}) {
    // never take a non-finite pose (it would poison every later clamp and blank the scene for good)
    if (![pos.x, pos.y, pos.z, look.x, look.y, look.z].every(Number.isFinite)) {
      console.warn('[controls] ignoring non-finite camera pose', pos, look);
      return false;
    }
    saneBox(sP.copy(pos));
    saneBox(sT.copy(look));
    pullPivotIn(sP, sT);
    v1.subVectors(sP, sT);
    let r = Math.hypot(v1.x, v1.y, v1.z);
    if (!Number.isFinite(r)) { console.warn('[controls] ignoring degenerate camera pose', pos, look); return false; }
    if (r < 1e-3) { v1.set(0, 1, 1); r = Math.SQRT2; }
    cur.target.copy(sT);
    cur.dist = r;
    cur.elev = Math.asin(clamp(v1.y / r, -1, 1));
    cur.heading = Math.atan2(-v1.x, v1.z);
    copyState(goal, cur);
    exact = ex;
    followGround = false;
    buildingLift = 0;
    stopMomentum();
    return true;
  }

  function copyState(dst, src) {
    dst.target.copy(src.target); dst.heading = src.heading; dst.elev = src.elev; dst.dist = src.dist;
  }

  function stopMomentum() {
    fling.heading = fling.elev = 0; fling.pan.set(0, 0, 0);
    vel.heading = vel.elev = 0; vel.pan.set(0, 0, 0);
  }

  // Leave exact mode: from now on constraints apply (the goal glides into the valid range).
  function interact() {
    if (exact) { exact = false; }
    fling.heading = fling.elev = 0; fling.pan.set(0, 0, 0);
  }

  function trackVelocity(dh, de, dpx, dpz) {
    const now = performance.now();
    const dt = Math.max(0.004, (now - vel.t) / 1000);
    vel.t = now;
    const k = dt > 0.1 ? 1 : 0.35;
    vel.heading += (dh / dt - vel.heading) * k;
    vel.elev += (de / dt - vel.elev) * k;
    vel.pan.x += (dpx / dt - vel.pan.x) * k;
    vel.pan.z += (dpz / dt - vel.pan.z) * k;
  }

  // ---- input operations -------------------------------------------------------------------------
  // Rotate by screen pixels (drag right → scene follows the cursor; drag down → camera rises).
  function rotate(dx, dy) {
    interact();
    const h = canvas.clientHeight || innerHeight;
    const k = (TWO_PI * 0.75) / h;
    goal.heading += dx * k;
    goal.elev += dy * k * 0.8;
    goal.elev = clamp(goal.elev, L.minElev, L.maxElev);
    trackVelocity(dx * k, dy * k * 0.8, 0, 0);
  }
  function rotateBy(dHeading, dElev = 0) {
    interact();
    goal.heading += dHeading;
    goal.elev = clamp(goal.elev + dElev, L.minElev, L.maxElev);
  }

  function toNdc(clientX, clientY, out) {
    const r = canvas.getBoundingClientRect();
    return out.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  // World point on the horizontal plane through the target, under a screen position (null if near horizon).
  function planePoint(clientX, clientY, out) {
    toNdc(clientX, clientY, ndc);
    ray.setFromCamera(ndc, camera);
    const d = ray.ray.direction;
    if (d.y > -0.02) return null;
    plane.constant = -cur.target.y;
    if (!ray.ray.intersectPlane(plane, out)) return null;
    if (out.distanceTo(camera.position) > Math.max(400, cur.dist * 6)) return null;
    return out;
  }

  // Grab-pan: the ground point under the previous cursor position moves to the new cursor position.
  function pan(x0, y0, x1, y1) {
    interact();
    followGround = true;
    let dx, dz;
    const a = planePoint(x0, y0, v1), b = a && planePoint(x1, y1, v2);
    if (a && b) {
      dx = a.x - b.x; dz = a.z - b.z;
    } else {
      // Near the horizon: screen-space pan scaled with distance
      const k = cur.dist * 0.0018;
      headingRight(cur.heading, right); headingForward(cur.heading, fwd);
      dx = (-(x1 - x0) * right.x + (y1 - y0) * fwd.x) * k;
      dz = (-(x1 - x0) * right.z + (y1 - y0) * fwd.z) * k;
    }
    // Cap a single step so a glancing ray can't teleport the view
    const m = Math.hypot(dx, dz), cap = Math.max(40, cur.dist * 1.5);
    if (m > cap) { dx *= cap / m; dz *= cap / m; }
    goal.target.x += dx; goal.target.z += dz;
    trackVelocity(0, 0, dx, dz);
  }

  // Move the target in the horizontal view frame (keyboard). dForward/dRight in metres.
  function panLocal(dForward, dRight) {
    interact();
    followGround = true;
    headingForward(goal.heading, fwd); headingRight(goal.heading, right);
    goal.target.x += fwd.x * dForward + right.x * dRight;
    goal.target.z += fwd.z * dForward + right.z * dRight;
  }

  // Zoom by a factor (<1 = closer). If a screen point is given, zoom in towards what is under it: the camera and
  // the target are scaled about that world point, so it stays under the cursor. The point is found with a
  // real scene raycast (buildings included) once per zoom burst and reused while the cursor stays put.
  const anchor = { valid: false, cx: 0, cy: 0, t: 0, p: new THREE.Vector3() };
  // sticky = keep the current anchor even if the screen point moved (pinch: the grab-pan keeps it under the fingers)
  function zoom(factor, clientX, clientY, sticky = false) {
    interact();
    const nd = clamp(goal.dist * factor, L.minDist, L.maxDist);
    const f = nd / goal.dist;
    // Zooming in goes where the cursor points; zooming out simply pulls back about the target (anchoring a
    // zoom-out at the cursor drags the target far away when the view is low and the cursor near the horizon).
    if (clientX !== undefined && f < 1 - 1e-4) {
      const now = performance.now();
      const moved = !sticky && Math.abs(clientX - anchor.cx) + Math.abs(clientY - anchor.cy) > 3;
      if (!anchor.valid || moved || now - anchor.t > 400) {
        toNdc(clientX, clientY, ndc);
        ray.setFromCamera(ndc, camera);
        anchor.valid = !!world.pickRay(ray.ray.origin, ray.ray.direction, Math.max(2000, cur.dist * 5), anchor.p);
        anchor.cx = clientX; anchor.cy = clientY;
      }
      anchor.t = now;
      if (anchor.valid) {
        const P = anchor.p;
        followGround = false;
        goal.target.x = P.x + (goal.target.x - P.x) * f;
        goal.target.y = P.y + (goal.target.y - P.y) * f;
        goal.target.z = P.z + (goal.target.z - P.z) * f;
        goal.target.y = Math.max(goal.target.y, world.heightAt(goal.target.x, goal.target.z));
      }
    }
    goal.dist = nd;
  }

  // Called when a drag ends: keep some momentum if the pointer was still moving.
  function release() {
    const recent = performance.now() - vel.t < 70;
    if (recent) {
      fling.heading = clamp(vel.heading, -4, 4);
      fling.elev = clamp(vel.elev, -2, 2);
      const cap = Math.max(60, cur.dist * 2.5);
      fling.pan.set(clamp(vel.pan.x, -cap, cap), 0, clamp(vel.pan.z, -cap, cap));
    }
    vel.heading = vel.elev = 0; vel.pan.set(0, 0, 0);
  }

  // ---- per-frame update ----------------------------------------------------------------------------
  function update(dt, { idle = 0 } = {}) {
    // momentum
    if (fling.heading || fling.elev || fling.pan.x || fling.pan.z) {
      goal.heading += fling.heading * dt;
      goal.elev = clamp(goal.elev + fling.elev * dt, L.minElev, L.maxElev);
      goal.target.x += fling.pan.x * dt; goal.target.z += fling.pan.z * dt;
      const k = Math.exp(-dt * 4.5);
      fling.heading *= k; fling.elev *= k; fling.pan.multiplyScalar(k);
      if (Math.abs(fling.heading) < 1e-3 && Math.abs(fling.elev) < 1e-3 && fling.pan.lengthSq() < 1e-2) {
        fling.heading = fling.elev = 0; fling.pan.set(0, 0, 0);
      }
    }
    // idle showcase: very slow auto-rotation (idle = 0..1 ramp from controls.js)
    if (idle > 0) {
      if (exact) exact = false;
      goal.heading += 0.045 * idle * dt;
    }

    if (!exact) {
      goal.dist = clamp(goal.dist, L.minDist, L.maxDist);
      goal.elev = clamp(goal.elev, L.minElev, L.maxElev);
      const b = world.bounds, m = L.boundsMargin;
      goal.target.x = clamp(goal.target.x, b.minX - m, b.maxX + m);
      goal.target.z = clamp(goal.target.z, b.minZ - m, b.maxZ + m);
      if (followGround) goal.target.y = world.heightAt(goal.target.x, goal.target.z);
      // keep the goal pose above terrain and out of buildings
      positionOf(goal, goalPos);
      liftState(goal, minCameraY(goalPos));
    }

    if (exact) {
      copyState(cur, goal);
    } else {
      const aR = damp(11, dt), aP = damp(9, dt), aZ = damp(8, dt), aY = damp(5, dt);
      cur.heading += (goal.heading - cur.heading) * aR;
      // elevation: rate-capped so a sudden lift over a building (goal pushed up) glides instead of popping;
      // the soft buildingLift below keeps the camera out of the building meanwhile
      cur.elev += clamp((goal.elev - cur.elev) * aR, -2 * dt, 2 * dt);
      // zoom in log space, rate-capped so a violent wheel spin still glides (≤ ×e^3.5 per second)
      const dl = clamp((Math.log(goal.dist) - Math.log(cur.dist)) * aZ, -3.5 * dt, 3.5 * dt);
      cur.dist = Math.exp(Math.log(cur.dist) + dl);
      cur.target.x += (goal.target.x - cur.target.x) * aP;
      cur.target.z += (goal.target.z - cur.target.z) * aP;
      cur.target.y += (goal.target.y - cur.target.y) * aY;
      // keep headings bounded without visible jumps
      if (Math.abs(goal.heading) > 1e4) { const w = Math.floor(goal.heading / TWO_PI) * TWO_PI; goal.heading -= w; cur.heading -= w; }
    }

    positionOf(cur, camPos);
    if (!exact) {
      // Hard terrain clamp on the displayed pose (two passes: lifting moves the camera horizontally too)…
      for (let i = 0; i < 2; i++) {
        const g = world.heightAt(camPos.x, camPos.z) + L.groundClearance;
        if (camPos.y >= g) break;
        liftState(cur, g + 0.01);
        positionOf(cur, camPos);
      }
      // …and a soft lift over roofs / bridge decks while the (already lifted) goal pose is being caught up.
      const want = Math.max(0, minCameraY(camPos) - camPos.y);
      buildingLift += (want - buildingLift) * damp(want > buildingLift ? 16 : 6, dt);
      if (buildingLift > 1e-3) camPos.y += buildingLift; else buildingLift = 0;
    }
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(cur.target);
  }

  return {
    cur, goal,
    get exact() { return exact; },
    setPose, update, rotate, rotateBy, pan, panLocal, zoom, release, interact, stopMomentum,
    resetZoomAnchor() { anchor.valid = false; },
    positionOf,
    isMoving() {
      return Math.abs(goal.heading - cur.heading) > 1e-3 || Math.abs(goal.dist - cur.dist) > 0.05 ||
        cur.target.distanceToSquared(goal.target) > 0.01;
    },
  };
}
