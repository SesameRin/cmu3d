// Navigation for CMU 3D — see ARCHITECTURE.md §controls.
//
//   ctx.nav = { mode, setMode, setView, flyTo, walkTo, getState, enabled, ... }
//
// Three camera modes share one camera:
//   orbit (俯瞰, default) — map-style orbit around a ground target            → orbit.js
//   walk  (步行)          — first-person on foot with gravity and collisions   → walk.js (+ touch.js on phones)
//   fly   (飞行)          — free camera                                        → fly.js
// Scripted camera moves (flyTo, walkTo, smooth mode changes) run as a CameraFlight (tween.js) that
// temporarily owns the camera.
//
// Input: this module owns the keys W A S D Q E Shift Space and the arrow keys, pointer/wheel input on the
// canvas and the pointer lock. Everything else (M, T, H, 1/2/3, Esc…) belongs to the UI. Text fields get every
// key; a focused button keeps Space and a focused slider keeps the arrows (see widgetWantsKey), unless the mouse
// is captured. Entering walk/fly drops the focus of the button that got us there so Space jumps / rises.
// Events emitted: 'nav:mode' {mode, prev}, 'nav:pointerlock' {locked}, 'nav:speed' {speed} (fly cruise speed).
//
// API (headings are compass radians: 0 = north / −Z, clockwise, east = π/2):
//   nav.mode                                  'orbit' | 'walk' | 'fly' (read-only; switches to the destination
//                                             mode as soon as a transition starts)
//   nav.setMode(m, {heading?, duration?})     → Promise<bool>. orbit→walk lands near the orbit target: on the
//                                             target itself if it is open ground, otherwise stepped out towards
//                                             the camera into the open (preferably onto a footway) facing what
//                                             was looked at (walkentry.js); from the opening overview (HOME, nothing
//                                             selected) a curated first spot on the Mall facing Hamerschlag Hall;
//                                             walk→orbit rises behind the walker; ↔ fly keeps the camera where it
//                                             is; fly→walk drops straight down.
//   nav.setView(cam[3], look[3])              instant, switches to orbit, pose kept EXACT (no clamps) until input.
//                                             → true, or false (ignored) for non-numeric input such as a mangled
//                                             share link. (Absurd coordinates are pulled into a sane box, and a look
//                                             point beyond the orbit area slides back along the same view ray.)
//   nav.flyTo({ target, distance?, position?, heading?, elevation?, duration?, cancelable?, mode? })
//                                             → Promise<bool> (false if interrupted by the user or another move).
//                                             Cinematic arc; ends in orbit (exact pose) — or mode:'fly' / 'walk'.
//                                             The target is kept within bounds ± 150 m (the orbit area), the
//                                             position where a camera can be.
//   nav.walkTo(x, z, heading?, {instant?, fromY?, duration?, pitch?}) → Promise<bool>. Stands at the nearest free spot
//                                             (pushed out of buildings, then facing the building). Same spot while
//                                             walking = smooth turn in place.
//   nav.getState() → { mode, position[3], target[3], heading, pitch, transitioning, pointerLocked,
//                      distance (orbit) | speed (fly/walk) | grounded (walk) }
//                    target: orbit target; walk/fly: a point along the view ray (position→target = view)
//   nav.enabled                               set false while the UI has keyboard focus (all input ignored)
//   extras: nav.focus (live Vector3 the camera is about — cheap for per-frame use), nav.busy, nav.cancel(),
//           nav.goHome(duration?), nav.home, nav.pointerLocked, nav.requestPointerLock(), nav.exitPointerLock(),
//           nav.lastDragDistance / nav.dragging (tell clicks from drags), nav.poke() (reset idle timer),
//           nav.flySpeed, nav.pickPoint(clientX, clientY) → [x,y,z] | null
// Heights: beyond the data grid every camera and ray uses the terrain as rendered (the skirt's hills, surface.js),
// not ctx.heightAt's clamped edge values. A per-frame guard puts a camera that ever became non-finite back in
// orbit at its last sane pose.
import * as THREE from 'three';
import { pointInRing } from '../core/heightfield.js';
import { createOrbit, ORBIT_LIMITS } from './orbit.js';
import { createWalk, WALK } from './walk.js';
import { createFly, FLY } from './fly.js';
import { createTouchUI } from './touch.js';
import { createWalkEntry } from './walkentry.js';
import { createSurface } from './surface.js';
import { CameraFlight, clamp, dirToHeading, dirToPitch, finite, pointAlong, wrapAngle } from './tween.js';

const IDLE_MS = 90000;            // idle showcase starts after 90 s without input (orbit mode only)
const OWN_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const MODES = ['orbit', 'walk', 'fly'];

// Default overview: from above Margaret Morrison / CFA looking west-north-west down the Mall towards Hamerschlag,
// with the Cut, the UC and Gates behind (afternoon sun from the left).
const HOME = { target: [-120, 0, 70], heading: THREE.MathUtils.degToRad(292), elev: THREE.MathUtils.degToRad(29), dist: 600 };
// First walk from that overview (or its intro move): the walk-entry search would stand you in Doherty Hall's
// courtyard facing a wall corner, so start on the Mall's path crossing instead, looking west along the axis:
// Doherty's arcade on the right, Hamerschlag Hall at the end, the Cathedral of Learning on the horizon.
const FIRST_WALK = {
  x: -120, z: 105, heading: THREE.MathUtils.degToRad(279), pitch: THREE.MathUtils.degToRad(1.5),
  near: 60,                                   // m — orbit target at most this far from HOME.target…
  minDist: 200,                               // m — …seen from at least this far (an overview, not a close-up)…
  maxTurn: THREE.MathUtils.degToRad(75),      // …looking roughly west (the way the walker will face)
  hint: '沿中央大草坪向西走，尽头是哈默施拉格楼',
};

// ---- world queries shared by all controllers ---------------------------------------------------------
function createWorld(ctx) {
  const bounds = ctx.data?.meta?.bounds || { minX: -805, maxX: 890, minZ: -833, maxZ: 611 };
  // Terrain height as rendered: the heightfield inside the data grid, the terrain skirt's hills outside it
  // (ctx.heightAt clamps to the edge values there, up to ~45 m below the visible ground) — see surface.js.
  const surface = createSurface(ctx, bounds);
  const heightAt = surface.heightAt;
  const colliders = ctx.colliders;
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  // Ground to stand / hover on: terrain + walkable meshes (decks, stairs) below fromY + 1.2 m.
  function groundAt(x, z, fromY = Infinity) {
    if (surface.inGrid(x, z) || !ctx.surfaceHeightAt) return ctx.surfaceHeightAt ? ctx.surfaceHeightAt(x, z, fromY) : heightAt(x, z);
    // outside the grid ctx.surfaceHeightAt starts from the clamped edge height: use the rendered ground instead
    const h = heightAt(x, z);
    const w = walkableBelow(x, z, Number.isFinite(fromY) ? fromY + 1.2 : h + 200, h);
    return w !== null && w > h ? w : h;
  }
  const contains = (s, x, z) => (s.kind === 'circle' ? (x - s.x) ** 2 + (z - s.z) ** 2 <= s.r * s.r : pointInRing(x, z, s.ring));

  // Distance from (x, z) to a collider shape's outline (0 when inside).
  function shapeDistance(s, x, z) {
    if (s.kind === 'circle') return Math.max(0, Math.hypot(x - s.x, z - s.z) - s.r);
    if (pointInRing(x, z, s.ring)) return 0;
    const r = s.ring;
    let best = Infinity;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const ax = r[j][0], az = r[j][1], ex = r[i][0] - ax, ez = r[i][1] - az;
      const l2 = ex * ex + ez * ez || 1e-9;
      let t = ((x - ax) * ex + (z - az) * ez) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = (x - ax - ex * t) ** 2 + (z - az - ez * t) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // Top of the tallest solid collider at (x, z) — or within `margin` metres of it — whose vertical span
  // contains y (or y is just above it). Used to keep cameras out of buildings.
  // (called every frame by the orbit camera: a reused result list, no allocation)
  const nearShapes = [];
  const shapesNear = (x, z, r) => {
    nearShapes.length = 0;
    if (colliders?.queryInto) return colliders.queryInto(x, z, r, nearShapes);
    return colliders?.query?.(x, z, r) || nearShapes;
  };
  function roofAbove(x, z, y, margin = 0) {
    const list = shapesNear(x, z, 0.25 + margin);
    if (!list.length) return null;
    let top = null;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!Number.isFinite(s.yMax)) continue;
      if (y < (Number.isFinite(s.yMin) ? s.yMin : -1e9) - 1 || y > s.yMax + 2.5) continue;
      if (top !== null && s.yMax <= top) continue;
      if (margin > 0 ? shapeDistance(s, x, z) > margin : !contains(s, x, z)) continue;
      top = s.yMax;
    }
    return top;
  }

  // Highest thing (terrain or collider top) at (x, z) — used to lift flight arcs.
  function obstacleTop(x, z) {
    let top = heightAt(x, z);
    const list = shapesNear(x, z, 3);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (Number.isFinite(s.yMax) && s.yMax > top && s.yMax < top + 400) top = s.yMax;
    }
    return top;
  }

  // March a ray against the heightfield; returns the hit point (in `out`) or null.
  function rayTerrain(o, d, maxDist, out) {
    let h = o.y - heightAt(o.x, o.z);
    if (h < 0) return null;
    let t = 0;
    for (let i = 0; i < 2500 && t < maxDist; i++) {
      const prev = t;
      t += Math.max(0.5, h * 0.5);
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      h = y - heightAt(x, z);
      if (h <= 0) {
        let a = prev, b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m - heightAt(o.x + d.x * m, o.z + d.z * m) > 0) a = m; else b = m;
        }
        return out.set(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
      }
    }
    return null;
  }

  // Would a standing person (feet on the ground) at (x, z) intersect a collider?
  function occupied(x, z, radius) {
    tmp2.set(x, groundAt(x, z) + 0.3, z);
    return !!colliders?.resolve(tmp2, radius, 1.4);
  }

  // Nearest free standing spot to (x, z): pushed out of buildings, spiral search as a fallback.
  function findFreeSpot(x, z, radius = 0.6) {
    const p = tmp.set(x, 0, z);
    if (colliders) {
      for (let i = 0; i < 10; i++) {
        p.y = groundAt(p.x, p.z) + 0.3;
        if (!colliders.resolve(p, radius, 1.4)) break;
      }
      if (occupied(p.x, p.z, radius)) {
        search: for (let r = 2; r <= 120; r += 2) {
          const n = Math.max(8, Math.round(r * 1.5));
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
            if (!occupied(qx, qz, radius)) { p.x = qx; p.z = qz; break search; }
          }
        }
      }
    }
    p.x = clamp(p.x, bounds.minX + 6, bounds.maxX - 6);
    p.z = clamp(p.z, bounds.minZ + 6, bounds.maxZ - 6);
    return { x: p.x, z: p.z, moved: Math.hypot(p.x - x, p.z - z) > 0.05 };
  }

  // What is directly above (x, fromY, z) among the walkable meshes? Returns { distance, inside } for the nearest
  // surface within maxUp, or null. `inside` = we hit a top face from below, i.e. the point is inside a solid
  // walkable (a plinth, a stair block, a thick deck) rather than underneath it. Walkables are ray-cast
  // double-sided by swapping in a private material for the duration of the (synchronous) test only.
  const solidProbeMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const upRay = new THREE.Raycaster();
  const downRay = new THREE.Raycaster();
  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const rayOrigin = new THREE.Vector3();
  const faceN = new THREE.Vector3();
  const hitList = [];
  const boxes = new WeakMap();
  const aboveResult = { distance: 0, inside: false };
  function walkableAbove(x, z, fromY, maxUp = 6) {
    const meshes = ctx.walkables?.meshes;
    if (!meshes || !meshes.length) return null;
    let best = Infinity, inside = false, bestMesh = null;
    rayOrigin.set(x, fromY, z);
    upRay.set(rayOrigin, UP);
    upRay.far = maxUp;
    for (const m of meshes) {
      if (!m.isMesh) continue;
      let b = boxes.get(m);
      if (!b) { b = new THREE.Box3().setFromObject(m); boxes.set(m, b); }
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z || b.max.y < fromY || b.min.y > fromY + maxUp) continue;
      hitList.length = 0;
      const saved = m.material;
      m.material = solidProbeMat;
      try { m.raycast(upRay, hitList); } catch { /* ignore */ } finally { m.material = saved; }
      for (const h of hitList) {
        if (h.distance < best && h.face) {
          best = h.distance;
          bestMesh = m;
          inside = faceN.copy(h.face.normal).transformDirection(m.matrixWorld).y > 0;
        }
      }
    }
    if (best === Infinity) return null;
    // A top face seen from below means "inside a closed solid" only if the same mesh also closes below us
    // (a bottom face under the probe). A single-sided surface overhead (top-only deck) is not a solid.
    if (inside) {
      downRay.set(rayOrigin, DOWN);
      downRay.far = 60;
      hitList.length = 0;
      const saved = bestMesh.material;
      bestMesh.material = solidProbeMat;
      try { bestMesh.raycast(downRay, hitList); } catch { /* ignore */ } finally { bestMesh.material = saved; }
      let nd = Infinity, below = false;
      for (const h of hitList) {
        if (h.distance < nd && h.face) { nd = h.distance; below = faceN.copy(h.face.normal).transformDirection(bestMesh.matrixWorld).y < 0; }
      }
      inside = below;
    }
    hitList.length = 0;
    aboveResult.distance = best; aboveResult.inside = inside;
    return aboveResult;
  }

  // Highest walkable surface under (x, top, z) down to minY, or null (bounding boxes first: cheap when none is near).
  function walkableBelow(x, z, top, minY) {
    const meshes = ctx.walkables?.meshes;
    if (!meshes || !meshes.length || !(top > minY)) return null;
    rayOrigin.set(x, top, z);
    downRay.set(rayOrigin, DOWN);
    downRay.far = top - minY;
    let best = null;
    for (const m of meshes) {
      if (!m.isMesh) continue;
      let b = boxes.get(m);
      if (!b) { b = new THREE.Box3().setFromObject(m); boxes.set(m, b); }
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z || b.max.y < minY || b.min.y > top) continue;
      hitList.length = 0;
      try { m.raycast(downRay, hitList); } catch { /* ignore */ }
      for (const h of hitList) if (best === null || h.point.y > best) best = h.point.y;
    }
    hitList.length = 0;
    return best;
  }

  // Nearest hit of a ray against the terrain and the pickable scene (buildings, landmarks) + walkables.
  // Costs a real raycast, so callers use it for discrete events (double-click, start of a zoom burst).
  const sceneRay = new THREE.Raycaster();
  const sceneHits = [];
  function pickRay(origin, dirN, maxDist, out) {
    let best = rayTerrain(origin, dirN, maxDist, out);
    let bestD = best ? best.distanceTo(origin) : maxDist;
    const objs = ctx.pick?.objects?.() || [];
    const walk = ctx.walkables?.meshes || [];
    if (objs.length || walk.length) {
      sceneRay.set(origin, dirN);
      sceneRay.near = 0;
      sceneRay.far = bestD;
      sceneHits.length = 0;
      try {
        if (objs.length) sceneRay.intersectObjects(objs, true, sceneHits);
        if (walk.length) sceneRay.intersectObjects(walk, false, sceneHits);
      } catch (err) { console.warn('[controls] scene raycast failed', err); }
      for (const h of sceneHits) if (h.distance < bestD) { bestD = h.distance; best = out.copy(h.point); }
      sceneHits.length = 0;
    }
    return best;
  }

  return { bounds, heightAt, groundAt, roofAbove, obstacleTop, rayTerrain, pickRay, findFreeSpot, occupied, walkableAbove, shapeDistance, contains, warm: surface.warm };
}

// Keyboard focus rules. Text-entry fields get every key. Other focused widgets keep only the keys they use
// natively: Space activates buttons / checkboxes / switches; arrows move sliders and native radio groups. Everything
// else (W A S D Q E Shift, and Space on a slider) still drives the camera, so e.g. after dragging the time
// slider the movement keys keep working.
const NON_TEXT_INPUT = /^(range|checkbox|radio|button|submit|reset|color|file|image)$/i;
function isTextEntry(t) {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !NON_TEXT_INPUT.test(t.type || 'text');
}
const SPACE_ROLES = /^(button|checkbox|radio|switch|menuitem|menuitemcheckbox|menuitemradio|tab|option|link|treeitem)$/;
// (only widgets that really move with arrows: the HUD's role=radio buttons don't implement roving arrows, so
// arrows keep panning the map after a mode/season button was clicked)
const ARROW_ROLES = /^(slider|spinbutton|scrollbar)$/;
function widgetWantsKey(t, code) {
  if (!t || !t.tagName || t === document.body || t === document.documentElement || t.tagName === 'CANVAS') return false;
  const tag = t.tagName, type = (t.type || '').toLowerCase(), role = t.getAttribute?.('role') || '';
  if (code === 'Space') {
    return tag === 'BUTTON' || tag === 'SUMMARY' || (tag === 'INPUT' && type !== 'range') || SPACE_ROLES.test(role);
  }
  if (code.startsWith('Arrow')) return (tag === 'INPUT' && (type === 'range' || type === 'radio')) || ARROW_ROLES.test(role);
  return false;
}
// Accepts [x, y, z], [x, z] (on the ground) or a Vector3. Anything non-finite (e.g. a mangled share link) → null.
const toVec = (a, out, world) => {
  if (!a) return null;
  let x, y, z;
  if (a.isVector3) { x = a.x; y = a.y; z = a.z; }
  else if (typeof a.length !== 'number' || a.length < 2) return null;
  else if (a.length === 2) { x = +a[0]; z = +a[1]; y = Number.isFinite(x) && Number.isFinite(z) ? world.groundAt(x, z) : NaN; }
  else { x = +a[0]; y = +a[1]; z = +a[2]; }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return out.set(x, y, z);
};
// Optional numeric option: undefined unless it is a finite number.
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? undefined : +v);

export function createControls(ctx) {
  const camera = ctx.camera;
  const canvas = ctx.canvas || ctx.renderer.domElement;
  camera.rotation.order = 'YXZ';
  canvas.style.touchAction = 'none';

  const world = createWorld(ctx);
  const orbit = createOrbit(ctx, world);
  const walk = createWalk(ctx, world);
  const fly = createFly(ctx, world);
  const flight = new CameraFlight(world);
  const walkEntry = createWalkEntry(ctx, world);
  const params = new URLSearchParams(location.search);
  const shot = !!(ctx.shotMode ?? params.has('shot'));

  let mode = 'orbit';
  let enabled = true;
  let lastInput = performance.now();
  let interacted = false;          // any real user input since load (suppresses the intro move)
  let pendingResolve = null;       // resolver of the running flyTo / walkTo / transition promise
  let locked = false;              // pointer lock state
  let lastDrag = 0;                // pixels moved during the last pointer press (UI can ignore drags as clicks)
  const keys = new Set();
  const pointers = new Map();
  let gesture = null;              // two-finger orbit gesture baseline
  const input = { fwd: 0, strafe: 0, turn: 0, vert: 0, run: false, speed: undefined };
  const focus = new THREE.Vector3();

  // scratch
  const fPos = new THREE.Vector3(), fLook = new THREE.Vector3();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vD = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const touch = createTouchUI(ctx, { onJump: () => walk.jump(), onVert: () => markInput() });

  // ---- helpers ------------------------------------------------------------------------------------------
  // Keep a requested orbit target inside the area the orbit may pan to (bounds ± boundsMargin). → clamped?
  function clampToTargetArea(p) {
    const b = world.bounds, m = ORBIT_LIMITS.boundsMargin;
    const x = clamp(p.x, b.minX - m, b.maxX + m), z = clamp(p.z, b.minZ - m, b.maxZ + m);
    const moved = x !== p.x || z !== p.z;
    p.x = x; p.z = z;
    return moved;
  }
  // Keep a requested camera position where cameras can actually be: an orbit camera around a target at the
  // edge of its area (bounds ± boundsMargin + maxDist), or the fly margin for free flight.
  function clampCameraPos(p, margin = ORBIT_LIMITS.boundsMargin + ORBIT_LIMITS.maxDist) {
    const b = world.bounds;
    p.x = clamp(p.x, b.minX - margin, b.maxX + margin);
    p.z = clamp(p.z, b.minZ - margin, b.maxZ + margin);
    p.y = clamp(p.y, ORBIT_LIMITS.minY, Math.min(ORBIT_LIMITS.maxY, FLY.maxAltitude + 400));
    return p;
  }
  function markInput() {
    lastInput = performance.now();
  }
  function setModeInternal(m) {
    if (m === mode) return;
    const prev = mode;
    mode = m;
    touch.setMode(m);
    if (m === 'orbit') exitPointerLock();   // walk → fly keeps a captured mouse (mouse-look continues)
    else releaseWidgetFocus();
    ctx.events?.emit('nav:mode', { mode: m, prev });
  }
  // The mode button (or any other widget) used to get into walk/fly keeps the keyboard focus, and Space would
  // press it again instead of jumping / rising. Drop that focus (text fields are left alone).
  function releaseWidgetFocus() {
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement && a !== canvas && !isTextEntry(a) && typeof a.blur === 'function') {
      try { a.blur(); } catch { /* ignore */ }
    }
  }
  function viewHeading() { camera.getWorldDirection(dir); return dirToHeading(dir); }
  function viewPitch() { camera.getWorldDirection(dir); return dirToPitch(dir); }
  // The point the camera is currently "about" (orbit target, flight look point, or ahead of the viewer)
  function currentLook(out) {
    if (flight.active) return out.copy(fLook);
    if (mode === 'orbit') return out.copy(orbit.cur.target);
    camera.getWorldDirection(dir);
    return out.copy(camera.position).addScaledVector(dir, 30);
  }
  function leaveControllers() {
    if (walk.active) walk.exit();
    if (fly.active) fly.exit();
  }
  function settle(result) {
    const r = pendingResolve;
    pendingResolve = null;
    r?.(result);
  }
  // Abort a running flight without touching the camera (a new camera command follows immediately).
  function abortFlight() {
    if (!flight.active) return;
    flight.onCancel = null;
    flight.cancel();
    settle(false);
  }
  // User grabbed the controls mid-flight: stay where we are, in orbit mode.
  function interruptFlight() {
    if (!flight.active || !flight.cancelable) return false;
    const look = vD.copy(fLook);
    abortFlight();
    leaveControllers();
    setModeInternal('orbit');
    // re-derive an orbit target on the ground in the current view direction
    camera.getWorldDirection(dir);
    const hit = world.rayTerrain(camera.position, dir, 4000, vC);
    orbit.setPose(camera.position, hit || look);
    return true;
  }

  // fromLook must be captured (currentLook) BEFORE the mode is switched.
  function startFlight(fromLook, toPos, toLook, { duration, cancelable = true, arc = true, lookLead, onArrive }) {
    settle(false);
    const fromPos = vA.copy(camera.position);
    if (flight.active) { flight.onCancel = null; flight.cancel(); }
    fLook.copy(fromLook); fPos.copy(fromPos);
    return new Promise((resolve) => {
      pendingResolve = resolve;
      flight.start(fromPos, fromLook, toPos, toLook, {
        duration, cancelable, arc, lookLead,
        onDone: () => { onArrive?.(); markInput(); settle(true); },
        onCancel: () => settle(false),
      });
    });
  }

  // ---- pointer lock (walk mode, desktop) ------------------------------------------------------------------
  function requestPointerLock() {
    if (!canvas.requestPointerLock || document.pointerLockElement === canvas) return;
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* ignore */ } });
    } catch {
      try { canvas.requestPointerLock(); } catch { /* ignore */ }
    }
  }
  function exitPointerLock() {
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  }
  document.addEventListener('pointerlockchange', () => {
    const now = document.pointerLockElement === canvas;
    if (now === locked) return;
    locked = now;
    if (locked) releaseWidgetFocus();
    ctx.events?.emit('nav:pointerlock', { locked });
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked || !enabled) return;
    markInput();
    const dx = clamp(e.movementX || 0, -250, 250), dy = clamp(e.movementY || 0, -250, 250);
    const k = 0.0022;
    if (flight.active) return;
    if (mode === 'walk') walk.look(dx * k, -dy * k);
    else if (mode === 'fly') fly.look(dx * k, -dy * k);
  });

  // ---- keyboard ------------------------------------------------------------------------------------------
  let spaceClaimed = false;        // the current Space press was used by the camera (jump / rise)
  addEventListener('keydown', (e) => {
    if (!OWN_KEYS.has(e.code)) return;
    if (!enabled || isTextEntry(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    // a focused widget keeps its native keys (Space presses a button, arrows move the time slider) — unless the
    // mouse is captured for walking/flying, where the keyboard obviously belongs to the camera
    if (!locked && widgetWantsKey(e.target, e.code)) return;
    if (e.code === 'Space') {
      if (mode === 'orbit') return;          // Space does nothing in the map view: leave it to the page
      e.preventDefault();
      spaceClaimed = true;
    } else if (e.code.startsWith('Arrow')) e.preventDefault();
    markInput();
    interacted = true;
    if (!keys.has(e.code)) {
      keys.add(e.code);
      if (e.code === 'Space' && !e.repeat && mode === 'walk' && !flight.active) walk.jump();
    }
    if (MOVE_KEYS.has(e.code) && flight.active) interruptFlight();
  });
  addEventListener('keyup', (e) => {
    if (!OWN_KEYS.has(e.code)) return;
    keys.delete(e.code);
    // a Space press the camera used (jump / rise) must not also "click" a focused button on release
    if (e.code === 'Space' && spaceClaimed) {
      spaceClaimed = false;
      if (widgetWantsKey(e.target, 'Space')) e.preventDefault();
    }
  });
  const clearKeys = () => { keys.clear(); touch.reset(); };
  addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeys(); });

  function computeInput() {
    const k = (c) => (keys.has(c) ? 1 : 0);
    input.run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    input.speed = undefined;
    const W = k('KeyW'), S = k('KeyS'), A = k('KeyA'), D = k('KeyD'), Q = k('KeyQ'), E = k('KeyE');
    const U = k('ArrowUp'), Dn = k('ArrowDown'), Lf = k('ArrowLeft'), Rt = k('ArrowRight');
    if (mode === 'orbit') {
      // WASD / arrows pan the map, Q/E rotate
      input.fwd = W + U - S - Dn;
      input.strafe = D + Rt - A - Lf;
      input.turn = E - Q;
      input.vert = 0;
    } else {
      input.fwd = W + U - S - Dn;
      input.strafe = D - A;
      input.turn = Rt - Lf + (mode === 'walk' ? E - Q : 0);
      input.vert = mode === 'fly' ? E - Q + k('Space') + touch.vert : 0;
    }
    // touch joystick (analog)
    if (touch.joyId !== null && touch.axes.mag > 0.08) {
      input.fwd += -touch.axes.y;
      input.strafe += touch.axes.x;
      if (mode === 'walk') {
        const m = touch.axes.mag;
        input.speed = m < 0.85 ? (m / 0.85) * WALK.walkSpeed : WALK.walkSpeed + ((m - 0.85) / 0.15) * (WALK.runSpeed - WALK.walkSpeed);
        // the joystick vector is already analog: normalise it so speed carries the magnitude
        const l = Math.hypot(input.fwd, input.strafe) || 1;
        input.fwd /= l; input.strafe /= l;
      }
    }
    input.fwd = clamp(input.fwd, -1, 1);
    input.strafe = clamp(input.strafe, -1, 1);
    input.turn = clamp(input.turn, -1, 1);
    input.vert = clamp(input.vert, -1, 1);
  }

  // ---- pointer input -------------------------------------------------------------------------------------
  function twoFingerState(out) {
    const [a, b] = [...pointers.values()].filter((p) => p.role === 'pinch');
    if (!a || !b) return null;
    out.cx = (a.x + b.x) / 2; out.cy = (a.y + b.y) / 2;
    out.d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    out.a = Math.atan2(b.y - a.y, b.x - a.x);
    return out;
  }
  const g2 = { cx: 0, cy: 0, d: 1, a: 0 };

  function assignRole(p, e) {
    if (e.pointerType === 'touch') {
      if (mode === 'orbit') {
        const touches = [...pointers.values()].filter((q) => q.type === 'touch');
        if (touches.length >= 2) {
          for (const q of touches.slice(0, 2)) q.role = 'pinch';
          for (const q of touches.slice(2)) q.role = 'none';
          gesture = twoFingerState({ ...g2 });
          orbit.release();
          orbit.resetZoomAnchor();
        } else p.role = 'rotate';
      } else if (touch.wantsJoystick(e.clientX)) {
        p.role = 'joy';
        touch.start(e.pointerId, e.clientX, e.clientY);
      } else p.role = 'look';
      return;
    }
    if (mode === 'orbit') {
      if (e.button === 2 || (e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey))) p.role = 'pan';
      else if (e.button === 0) p.role = 'rotate';
      else if (e.button === 1) p.role = 'dolly';
      else p.role = 'none';
    } else {
      p.role = locked ? 'none' : 'look';
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!enabled) return;
    markInput();
    interacted = true;
    if (e.pointerType === 'touch') touch.markTouch();
    if (flight.active) interruptFlight();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), button: e.button, type: e.pointerType, role: 'none', moved: 0 };
    pointers.set(e.pointerId, p);
    lastDrag = 0;
    if (!flight.active) assignRole(p, e);
  });

  canvas.addEventListener('pointermove', (e) => {
    markInput();
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const px = p.x, py = p.y;
    const dx = e.clientX - px, dy = e.clientY - py;
    p.x = e.clientX; p.y = e.clientY;
    p.moved += Math.abs(dx) + Math.abs(dy);
    lastDrag = Math.max(lastDrag, p.moved);
    if (!enabled || flight.active) return;
    switch (p.role) {
      case 'rotate': orbit.rotate(dx, dy); break;
      case 'pan': orbit.pan(px, py, p.x, p.y); break;
      case 'dolly': orbit.zoom(Math.exp(dy * 0.006)); break;
      case 'pinch': {
        const g = twoFingerState(g2);
        if (g && gesture) {
          orbit.zoom(gesture.d / g.d, g.cx, g.cy, true);
          orbit.pan(gesture.cx, gesture.cy, g.cx, g.cy);
          let da = g.a - gesture.a;
          if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
          orbit.rotateBy(-da);
          Object.assign(gesture, g);
        }
        break;
      }
      case 'look': {
        if (locked) break;
        const k = p.type === 'touch' ? 0.0058 : 0.0042;
        if (mode === 'walk') walk.look(dx * k, -dy * k);
        else if (mode === 'fly') fly.look(dx * k, -dy * k);
        break;
      }
      case 'joy': touch.move(e.pointerId, e.clientX, e.clientY); break;
      default: break;
    }
  });

  function endPointer(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (p.role === 'rotate' || p.role === 'pan') orbit.release();
    if (p.role === 'joy') touch.end(e.pointerId);
    if (p.role === 'pinch') {
      gesture = null;
      // the remaining finger continues as a one-finger rotate
      for (const q of pointers.values()) if (q.role === 'pinch') q.role = mode === 'orbit' ? 'rotate' : 'look';
    }
    // desktop walk: a click (not a drag) on the canvas captures the mouse
    if (e.type === 'pointerup' && enabled && mode === 'walk' && p.type === 'mouse' && p.button === 0 &&
        p.moved < 6 && performance.now() - p.t0 < 500 && !flight.active) {
      requestPointerLock();
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    if (!enabled) return;
    e.preventDefault();
    markInput();
    interacted = true;
    if (flight.active && !interruptFlight()) return;
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    if (mode === 'orbit') {
      const f = clamp(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0012)), 0.5, 2);
      orbit.zoom(f, e.clientX, e.clientY);
    } else if (mode === 'fly') {
      const s = fly.scaleSpeed(Math.exp(-dy * 0.0015));
      ctx.events?.emit('nav:speed', { speed: s });
    }
  }, { passive: false });

  // Double-click in orbit: fly to the clicked point
  canvas.addEventListener('dblclick', (e) => {
    if (!enabled || mode !== 'orbit') return;
    const p = pickPoint(e.clientX, e.clientY, vC);
    if (!p) return;
    // (a click on the far hills beyond the data flies to the edge of the explorable area in that direction)
    if (clampToTargetArea(p)) p.y = world.heightAt(p.x, p.z);
    const c = orbit.cur;
    nav.flyTo({
      target: [p.x, p.y, p.z],
      distance: clamp(c.dist * 0.5, 40, 320),
      heading: c.heading,
      elevation: Math.max(c.elev, THREE.MathUtils.degToRad(28)),
    });
  });

  function pickPoint(clientX, clientY, out) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return world.pickRay(raycaster.ray.origin, raycaster.ray.direction, 8000, out);
  }

  ctx.events?.on?.('app:ready', () => {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    idle(() => { try { world.warm(); } catch { /* built on demand then */ } }, { timeout: 4000 });
  });
  let selected = null;             // what the UI has selected (info panel open), or null
  ctx.events?.on?.('select', (entry) => { selected = entry || null; markInput(); });

  // ---- public API -----------------------------------------------------------------------------------------
  function setView(cam, look) {
    const c = toVec(cam, vA, world), l = toVec(look, vB, world);
    if (!c || !l) { console.warn('[controls] setView: ignoring invalid camera/look', cam, look); return false; }
    clampCameraPos(c);   // (absurd coordinates only: every reachable pose is inside; orbit.setPose sanitises `l`)
    abortFlight();
    leaveControllers();
    setModeInternal('orbit');
    orbit.setPose(c, l, { exact: true });
    orbit.update(0);
    markInput();
    return true;
  }

  // Orbit-style camera position for a target/heading/elevation/distance, raised until it is clear.
  function orbitPosition(target, heading, elev, dist, out) {
    for (let i = 0; i < 8; i++) {
      const ce = Math.cos(elev);
      out.set(target.x - Math.sin(heading) * ce * dist, target.y + Math.sin(elev) * dist, target.z + Math.cos(heading) * ce * dist);
      const roof = world.roofAbove(out.x, out.z, out.y);
      const minY = Math.max(world.heightAt(out.x, out.z) + 3, roof !== null ? roof + 4 : -Infinity);
      if (out.y >= minY) break;
      elev = Math.min(1.35, elev + 0.12);
    }
    return out;
  }

  function flyTo(opts = {}) {
    if (opts.mode === 'walk') {
      const t = toVec(opts.target, vC, world);
      return t ? walkTo(t.x, t.z, num(opts.heading), { duration: num(opts.duration) }) : Promise.resolve(false);
    }
    const fromLook = currentLook(new THREE.Vector3());
    const target = toVec(opts.target, new THREE.Vector3(), world) || (finite(fromLook) ? fromLook.clone() : null);
    if (!target) return Promise.resolve(false);
    // targets stay where the orbit target may go (bounds ± boundsMargin), positions where cameras can be
    if (clampToTargetArea(target)) target.y = world.heightAt(target.x, target.z);
    target.y = clamp(target.y, ORBIT_LIMITS.minY, ORBIT_LIMITS.maxY);
    const endMode = opts.mode === 'fly' ? 'fly' : 'orbit';
    const end = new THREE.Vector3();
    // (a missing or non-finite position falls back to an orbit pose around the target)
    if (opts.position && toVec(opts.position, end, world)) clampCameraPos(end, endMode === 'fly' ? FLY.boundsMargin : undefined);
    else {
      const dist = clamp(num(opts.distance) ?? 180, ORBIT_LIMITS.minDist, ORBIT_LIMITS.maxDist);
      let heading = num(opts.heading);
      if (heading === undefined) {
        const dx = target.x - camera.position.x, dz = target.z - camera.position.z;
        heading = Math.hypot(dx, dz) > dist * 0.6 ? dirToHeading(vD.set(dx, 0, dz)) : viewHeading();
      }
      const elev = clamp(num(opts.elevation) ?? THREE.MathUtils.degToRad(32), ORBIT_LIMITS.minElev, ORBIT_LIMITS.maxElev);
      orbitPosition(target, heading, elev, dist, end);
    }
    let duration = num(opts.duration);
    if (duration === undefined) duration = CameraFlight.autoDuration(camera.position, fromLook, end, target);
    leaveControllers();
    setModeInternal(endMode);
    return startFlight(fromLook, end, target, {
      duration,
      cancelable: opts.cancelable ?? true,
      onArrive: () => {
        if (endMode === 'fly') {
          vD.subVectors(target, end);
          fly.enter(end, dirToHeading(vD), dirToPitch(vD));
        } else orbit.setPose(end, target, { exact: true });
      },
    });
  }

  function walkTo(x, z, heading, opts = {}) {
    if (!Number.isFinite(+x) || !Number.isFinite(+z)) return Promise.resolve(false);
    const fromLook = currentLook(new THREE.Vector3());
    const spot = world.findFreeSpot(+x, +z, 0.6);
    heading = num(heading);
    const pitch = clamp(num(opts.pitch) ?? 0, -WALK.maxPitch, WALK.maxPitch);
    if (heading === undefined) {
      const dx = spot.x - camera.position.x, dz = spot.z - camera.position.z;
      if (spot.moved) heading = dirToHeading(vD.set(x - spot.x, 0, z - spot.z));          // face the building
      else if (Math.hypot(dx, dz) > 25) heading = dirToHeading(vD.set(dx, 0, dz));        // face the way we came
      else heading = viewHeading();
    }
    // Already walking and (almost) standing there: just turn smoothly in place.
    if (mode === 'walk' && walk.active && !flight.active && !opts.instant &&
        Math.hypot(spot.x - walk.feet.x, spot.z - walk.feet.z) < 1.5) {
      walk.turnTo(heading, pitch);
      markInput();
      return Promise.resolve(true);
    }
    const fromY = opts.fromY ?? Infinity;
    const gy = world.groundAt(spot.x, spot.z, fromY);
    const eye = new THREE.Vector3(spot.x, gy + WALK.eye, spot.z);
    const look = pointAlong(eye, heading, pitch, 30, new THREE.Vector3());
    abortFlight();
    leaveControllers();
    setModeInternal('walk');
    const arrive = () => walk.enter(spot.x, spot.z, heading, pitch, { fromY });
    const d = camera.position.distanceTo(eye);
    if (opts.instant || d < 0.3) { arrive(); markInput(); return Promise.resolve(true); }
    const duration = num(opts.duration) ?? clamp(0.9 + Math.sqrt(d) / 14, 1.0, 4.5);
    // hop in an arc only for long, mostly horizontal moves (from the air we simply descend)
    const horiz = Math.hypot(eye.x - camera.position.x, eye.z - camera.position.z);
    const arc = horiz > 60 && camera.position.y - eye.y < horiz * 0.3;
    return startFlight(fromLook, eye, look, { duration, cancelable: false, arc, lookLead: 1.1, onArrive: arrive });
  }

  // Is the orbit view (target t seen from `from`, looking along `heading`) the app's opening overview?
  function isHomeOverview(t, from, heading) {
    return !selected && Math.hypot(t.x - HOME.target[0], t.z - HOME.target[2]) < FIRST_WALK.near &&
      from.distanceTo(t) > FIRST_WALK.minDist && Math.abs(wrapAngle(heading - FIRST_WALK.heading)) < FIRST_WALK.maxTurn;
  }
  let firstWalkHinted = false;
  function firstWalk() {
    const F = FIRST_WALK;
    return walkTo(F.x, F.z, F.heading, { pitch: F.pitch }).then((ok) => {
      // (the direction hint once per visit)
      if (ok && !firstWalkHinted && mode === 'walk' && Math.hypot(walk.feet.x - F.x, walk.feet.z - F.z) < 3) {
        firstWalkHinted = true;
        try { ctx.ui?.toast?.(F.hint, { icon: 'walk', ms: 5200 }); } catch { /* ignore */ }
      }
      return ok;
    });
  }

  function setMode(m, opts = {}) {
    if (!MODES.includes(m)) { console.warn('[controls] unknown mode', m); return Promise.resolve(false); }
    if (m === mode && (!flight.active || m === 'walk')) return Promise.resolve(true); // already there / landing
    const prev = mode;
    const heading = viewHeading(), pitch = viewPitch();
    if (m === 'walk') {
      if (flight.active || prev === 'orbit') {
        // From the map view (or mid-flight): stand near what we were looking at — but out in the open, facing it,
        // not nose-to-wall on its footprint (see walkentry.js). Stepping out goes towards the camera.
        const t = flight.active ? flight.l1 : orbit.cur.target;
        const from = flight.active ? flight.p1 : camera.position;
        // (mid-flight — e.g. the intro move — what counts is the view the flight is heading for)
        const endHeading = flight.active ? dirToHeading(vD.subVectors(flight.l1, flight.p1)) : heading;
        if (num(opts.heading) === undefined && isHomeOverview(t, from, endHeading)) return firstWalk();
        let e = null;
        try { e = walkEntry.find(t.x, t.y, t.z, from.x, from.z, heading); } catch (err) { console.warn('[controls] walk entry search failed', err); }
        if (e) return walkTo(e.x, e.z, num(opts.heading) ?? e.heading, { pitch: num(opts.heading) === undefined ? e.pitch : 0 });
        return walkTo(t.x, t.z, num(opts.heading) ?? heading);
      }
      // fly: straight down
      return walkTo(camera.position.x, camera.position.z, num(opts.heading) ?? heading, { fromY: camera.position.y });
    }
    abortFlight();
    if (m === 'fly') {
      leaveControllers();
      setModeInternal('fly');
      fly.enter(camera.position, heading, pitch);
      markInput();
      return Promise.resolve(true);
    }
    // → orbit
    if (prev === 'walk' && walk.active) {
      const f = walk.feet;
      const tx = f.x + Math.sin(heading) * 12, tz = f.z - Math.cos(heading) * 12;
      const target = new THREE.Vector3(tx, world.heightAt(tx, tz), tz);
      const end = orbitPosition(target, heading, THREE.MathUtils.degToRad(30), 75, new THREE.Vector3());
      const fromLook = currentLook(new THREE.Vector3());
      leaveControllers();
      setModeInternal('orbit');
      return startFlight(fromLook, end, target, { duration: opts.duration ?? 1.5, cancelable: true, arc: false, onArrive: () => orbit.setPose(end, target) });
    }
    // fly (or anything else) → orbit: keep the camera still, orbit around the ground point in view
    leaveControllers();
    setModeInternal('orbit');
    camera.getWorldDirection(dir);
    let target = world.rayTerrain(camera.position, dir, 3000, vC);
    if (!target) {
      const h = heading;
      const tx = camera.position.x + Math.sin(h) * 200, tz = camera.position.z - Math.cos(h) * 200;
      target = vC.set(tx, world.heightAt(tx, tz), tz);
    }
    orbit.setPose(camera.position, target);
    markInput();
    return Promise.resolve(true);
  }

  const stTarget = new THREE.Vector3();
  function getState() {
    camera.getWorldDirection(dir);
    let target;
    if (mode === 'orbit' && !flight.active) target = orbit.cur.target;
    else if (flight.active) target = fLook;
    else {
      // walk / fly: a point exactly along the view ray (so position → target reproduces the view, e.g. for
      // share links): where it meets the ground, or a fixed distance ahead when looking up / far.
      const hit = mode === 'fly' ? world.rayTerrain(camera.position, dir, 1500, stTarget) : null;
      target = hit || stTarget.copy(camera.position).addScaledVector(dir, mode === 'walk' ? 20 : 200);
    }
    return {
      mode,
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [target.x, target.y, target.z],
      heading: dirToHeading(dir),
      pitch: dirToPitch(dir),
      transitioning: flight.active,
      pointerLocked: locked,
      ...(mode === 'orbit' ? { distance: orbit.cur.dist } : {}),
      ...(mode === 'fly' ? { speed: fly.speed } : {}),
      ...(mode === 'walk' ? { grounded: walk.onGround, speed: walk.speed } : {}),
    };
  }

  const nav = {
    get mode() { return mode; },
    setMode, setView, flyTo, walkTo, getState,
    get enabled() { return enabled; },
    set enabled(v) {
      enabled = !!v;
      if (!enabled) {
        clearKeys();
        for (const p of pointers.values()) if (p.role === 'rotate' || p.role === 'pan') orbit.release();
        pointers.clear(); gesture = null;
      }
    },
    // extras (not required by the contract, handy for the UI / env)
    focus,                                             // live Vector3: what the camera is looking at (read-only)
    home: HOME,
    goHome(duration) {
      const t = new THREE.Vector3(HOME.target[0], world.heightAt(HOME.target[0], HOME.target[2]), HOME.target[2]);
      return flyTo({ target: t, heading: HOME.heading, elevation: HOME.elev, distance: HOME.dist, duration });
    },
    get pointerLocked() { return locked; },
    requestPointerLock() { if (mode === 'walk') requestPointerLock(); },
    exitPointerLock,
    get busy() { return flight.active; },            // a scripted camera move is running
    cancel() { if (flight.active) { if (!interruptFlight()) abortFlight(); } },
    get lastDragDistance() { return lastDrag; },     // px moved during the last press (ignore clicks after drags)
    get dragging() { for (const p of pointers.values()) if (p.moved > 5) return true; return false; },
    poke: markInput,                                 // reset the idle timer (e.g. while a panel is open)
    get flySpeed() { return fly.speed; },
    set flySpeed(v) { fly.speed = v; },
    pickPoint: (x, y) => { const p = pickPoint(x, y, new THREE.Vector3()); return p ? [p.x, p.y, p.z] : null; },
    // What getState().target is in orbit mode (the orbit target, or the look point of a flight that ends in orbit),
    // as a live Vector3 — null in walk / fly. Allocation-free, for per-frame readers (env shadows, minimap).
    get orbitTarget() { return mode !== 'orbit' ? null : flight.active ? fLook : orbit.cur.target; },
    // Loading-time preparation (main.js, behind the loading screen): the lazy lookups the first camera moves need.
    prepare() {
      try { world.warm(); } catch (err) { console.warn('[controls] terrain index failed', err); }
      try { walkEntry.prepare?.(); } catch (err) { console.warn('[controls] walk-entry index failed', err); }
    },
  };
  ctx.nav = nav;

  // ---- per-frame update ------------------------------------------------------------------------------------
  const stats = { ms: 0, maxMs: 0 };   // smoothed cost of this per-frame update (debug / perf overlay)
  ctx.onUpdate((dt) => {
    if (dt <= 0) return;
    const t0 = performance.now();
    update(dt);
    const ms = performance.now() - t0;
    stats.ms += (ms - stats.ms) * 0.05;
    stats.maxMs = Math.max(stats.maxMs * 0.995, ms);
  }, -10);
  nav.stats = stats;

  const orbitOpts = { idle: 0 };
  function update(dt) {
    if (flight.active) {
      flight.step(dt, fPos, fLook);
      // onArrive may have handed the camera to a controller; only drive it if the flight is still running
      if (flight.active || (!walk.active && !fly.active && mode !== 'orbit')) {
        camera.position.copy(fPos);
        camera.up.set(0, 1, 0);
        camera.lookAt(fLook);
      } else if (mode === 'orbit') orbit.update(0);
      focus.copy(fLook);
      guardCamera();
      return;
    }
    computeInput();
    if (!enabled) { input.fwd = input.strafe = input.turn = input.vert = 0; input.run = false; }
    if (mode === 'orbit') {
      if (input.fwd || input.strafe) {
        const sp = Math.max(12, orbit.cur.dist * 0.9) * (input.run ? 2.5 : 1) * dt;
        orbit.panLocal(input.fwd * sp, input.strafe * sp);
      }
      if (input.turn) orbit.rotateBy(input.turn * 1.3 * dt);
      const idleMs = performance.now() - lastInput;
      orbitOpts.idle = !shot && !document.hidden && idleMs > IDLE_MS ? clamp((idleMs - IDLE_MS) / 5000, 0, 1) : 0;
      orbit.update(dt, orbitOpts);
      focus.copy(orbit.cur.target);
    } else if (mode === 'walk') {
      walk.update(dt, input);
      const f = walk.feet, h = walk.heading;
      focus.set(f.x + Math.sin(h) * 15, f.y, f.z - Math.cos(h) * 15);
    } else if (mode === 'fly') {
      fly.update(dt, input);
      const p = fly.pos, h = fly.heading;
      const agl = p.y - world.heightAt(p.x, p.z);
      const d = clamp(agl * 1.4, 20, 600);
      const fx = p.x + Math.sin(h) * d, fz = p.z - Math.cos(h) * d;
      focus.set(fx, world.heightAt(fx, fz), fz);
    }
    guardCamera();
  }

  // Safety net: if anything ever drives the camera to a non-finite pose (a bad walkable, a broken height lookup…),
  // the scene would go blank for good. Put it back in orbit at the last sane pose (or the overview) instead.
  const lastGood = { pos: new THREE.Vector3(), look: new THREE.Vector3(), valid: false };
  let lastWarn = -Infinity;
  function guardCamera() {
    const p = camera.position, q = camera.quaternion;
    if (finite(p) && Number.isFinite(q.x + q.y + q.z + q.w)) {
      if (finite(focus) && p.distanceToSquared(focus) > 1) { lastGood.pos.copy(p); lastGood.look.copy(focus); lastGood.valid = true; }
      return;
    }
    const now = performance.now();
    if (now - lastWarn > 5000) { lastWarn = now; console.warn('[controls] camera pose became non-finite — recovering'); }
    abortFlight();
    leaveControllers();
    setModeInternal('orbit');
    let ok = lastGood.valid && orbit.setPose(lastGood.pos, lastGood.look);
    lastGood.valid = false;             // (if that pose fails again, the next recovery goes home)
    if (!ok) {
      const t = new THREE.Vector3(HOME.target[0], world.heightAt(HOME.target[0], HOME.target[2]), HOME.target[2]);
      ok = orbit.setPose(orbitPosition(t, HOME.heading, HOME.elev, HOME.dist, new THREE.Vector3()), t);
    }
    orbit.update(0);
    focus.copy(orbit.cur.target);
  }

  // ---- initial view + optional intro ---------------------------------------------------------------------
  {
    const t = new THREE.Vector3(HOME.target[0], world.heightAt(HOME.target[0], HOME.target[2]), HOME.target[2]);
    const start = orbitPosition(t, HOME.heading, HOME.elev, HOME.dist, new THREE.Vector3());
    orbit.setPose(start, t);
    orbit.update(0);
    focus.copy(t);
    touch.setMode(mode);
  }
  // A gentle establishing move when the app opens normally (not for screenshots or when a view was requested).
  // (a mangled share link — cam/look that aren't numbers — is ignored by setView, so it gets the intro too)
  const paramVec = (k) => { const a = (params.get(k) || '').split(',').map((v) => (v.trim() === '' ? NaN : +v)); return a.length >= 2 && a.every(Number.isFinite); };
  if (!shot && !(paramVec('cam') && paramVec('look'))) {
    const t = new THREE.Vector3(HOME.target[0], world.heightAt(HOME.target[0], HOME.target[2]), HOME.target[2]);
    const pre = orbitPosition(t, HOME.heading - 0.55, THREE.MathUtils.degToRad(48), 1500, new THREE.Vector3());
    orbit.setPose(pre, t);
    orbit.update(0);
    ctx.events?.on?.('app:ready', () => {
      if (mode === 'orbit' && !flight.active && !interacted && !orbit.exact) nav.goHome(5);
    });
  }

  return nav;
}
