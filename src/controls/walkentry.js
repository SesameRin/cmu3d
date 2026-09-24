// Where to stand when the user switches from the map view (俯瞰) to first person (步行).
//
// The orbit target usually sits on (or inside) the building the user was looking at, so dropping the walker
// straight onto it puts the camera nose-to-wall. Instead:
//   1. If the target is already in open space (a lawn, a plaza: ≥ 8 m from buildings, ≥ 4 m from trees, lamps
//      and statues, nothing right in front) keep the classic behaviour: stand there, facing the old view direction.
//   2. Otherwise step out from the target towards the camera's ground position until the spot is clear:
//        the subject (the building the target is on) by max(10 m, its height above the spot), ≤ 32 m;
//        other buildings / walls / big landmarks by max(7 m, 0.6 × their height), ≤ 16 m;
//        small things (tree trunks, lamps, benches, parked cars…) by 1.5 m;
//      never underneath anything (arcades, bridges), no big climb/drop, and a clear view of the target.
//      Lines fanned around the direct one compete (each degree of deviation costs 0.4 m), so for a long building
//      seen end-on (Baker Hall) we step out of its side instead of walking 120 m along it. Failing everything, the
//      best-cleared spot seen is used.
//   3. Prefer a nearby footway point (data.paths, ≤ 40 m away, same side, still clear, target still in view).
//   4. Face the target, tilted up a little to frame the facade (or towards the target's height for a sculpture).
//      If a trunk/lamp/wall is right in front (a ±15° cone over the first 6 m), turn in ±30° steps until clear.
// Everything here is a one-off query (a few ms) run when the mode changes, never per frame.
import { clamp } from './tween.js';

const MASSIVE_EXTENT = 3;   // m — a collider at least this wide…
const MASSIVE_HEIGHT = 3;   // m — …and this tall above the spot counts as a building / wall / big landmark
const SMALL_CLEAR = 1.5;    // m — clearance from small colliders
const OPEN_CLEAR = 8;       // m — a target this far from any building…
const OPEN_SMALL = 4;       // m — …and this far from small colliders counts as open space
const QUERY_R = 32;         // m — largest clearance asked for
const VIEW_FREE = 6;        // m of unobstructed view required ahead of the walker
const VIEW_CONE = 0.27;     // tan(15°): half-width of that view cone per metre
const CANOPY_LEN = 25;      // m — tree crowns this close across the line of sight to the target hide it
const FOOTWAY_R = 40;       // m — search radius for a footway to stand on
const MIN_FROM_TARGET = 6;  // m — stand at least this far from the target (small subjects: statue, fence)
const FAN = [0, 25, -25, 50, -50, 75, -75, 105, -105, 135, -135, 180];   // degrees off the line towards the camera
const TURN = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
const DEG = Math.PI / 180;
const headingTo = (x, z, tx, tz) => Math.atan2(tx - x, -(tz - z));   // compass heading, 0 = north (−Z), clockwise

export function createWalkEntry(ctx, world) {
  const colliders = ctx.colliders;
  const B = world.bounds;
  const extent = (s) => (s.kind === 'circle' ? 2 * s.r : Math.max(s.x1 - s.x0, s.z1 - s.z0));
  const topOf = (s, g) => (Number.isFinite(s.yMax) ? s.yMax - g : 40);
  const inBody = (s, g) => topOf(s, g) > 0.2 && !(Number.isFinite(s.yMin) && s.yMin > g + 2.2);
  const isMassive = (s, g) => extent(s) >= MASSIVE_EXTENT && topOf(s, g) >= MASSIVE_HEIGHT;
  function required(s, g, subject) {
    if (subject?.shapes.has(s)) return subject.massive ? clamp(subject.topY - g, 10, 32) : SMALL_CLEAR;
    return isMassive(s, g) ? clamp(0.6 * topOf(s, g), 7, 16) : SMALL_CLEAR;
  }
  const inBounds = (x, z) => x > B.minX + 8 && x < B.maxX - 8 && z > B.minZ + 8 && z < B.maxZ - 8;

  // How well (x, z) is cleared: min over nearby colliders of distance / required clearance (≥ 1 = fully clear,
  // 0 = inside or underneath something). `massiveMin` / `smallMin` = distance to the nearest building-like /
  // small collider (for the open-space test). Heights are taken from the surface the walker would stand on
  // (a bridge deck counts), and low overhangs (an arcade's upper storey, a bridge overhead) count as well: the
  // walker shouldn't stand under them or right next to them looking up at a soffit.
  const res = { ratio: 0, massiveMin: Infinity, smallMin: Infinity };
  function assess(x, z, subject = null) {
    res.ratio = Infinity; res.massiveMin = Infinity; res.smallMin = Infinity;
    if (!colliders?.query) return res;
    const list = colliders.query(x, z, QUERY_R);
    let g = world.heightAt(x, z);
    // anything elevated around? then find out whether we'd be standing on a deck (costs a raycast)
    for (const s of list) if (Number.isFinite(s.yMin) && s.yMin > g + 2.2) { g = Math.max(g, world.groundAt(x, z)); break; }
    for (const s of list) {
      const top = topOf(s, g);
      if (top <= 0.2 || (Number.isFinite(s.yMin) && s.yMin > g + 15)) continue;   // below our feet / high above
      const d = world.shapeDistance(s, x, z);
      if (d <= 0) { res.ratio = 0; return res; }
      const r = d / required(s, g, subject);
      if (r < res.ratio) res.ratio = r;
      if (isMassive(s, g)) { if (d < res.massiveMin) res.massiveMin = d; } else if (d < res.smallMin) res.smallMin = d;
    }
    return res;
  }

  // Is the view from (x, z) along `heading` free of colliders at body height within a ±15° cone (at least ±0.5 m)
  // over the first `len` metres? A lamp post or a tree trunk a few metres ahead would fill the first-person view.
  function viewFree(x, z, heading, len = VIEW_FREE, massiveOnly = false) {
    if (!colliders?.query) return true;
    const sx = Math.sin(heading), sz = -Math.cos(heading);
    for (let t = 0.6; t <= len; t += 0.6) {
      const px = x + sx * t, pz = z + sz * t, g = world.heightAt(px, pz);
      const w = Math.max(0.5, t * VIEW_CONE);
      for (const s of colliders.query(px, pz, w)) {
        if (!inBody(s, g) || (massiveOnly && !isMassive(s, g))) continue;
        if (world.shapeDistance(s, px, pz) < w) return false;
      }
    }
    return true;
  }

  // Tree colliders are only trunks, but the crown (≈ 11 trunk radii: 2.5–5 m) hides whatever is behind it. Is the
  // line of sight from (x, z) towards the target free of crowns over its first `len` metres (the last 3 m before
  // the target are ignored: a tree right against a facade doesn't hide the building)?
  function crownsClear(x, z, tx, tz, len = CANOPY_LEN) {
    if (!colliders?.query) return true;
    const dx = tx - x, dz = tz - z, L = Math.hypot(dx, dz);
    if (L < 1) return true;
    const sx = dx / L, sz = dz / L, reach = Math.min(len, L - 3);
    if (reach <= 1) return true;
    for (const s of colliders.query(x + sx * reach * 0.5, z + sz * reach * 0.5, reach * 0.5 + 5)) {
      if (s.tag !== 'tree' || s.kind !== 'circle') continue;
      const ox = s.x - x, oz = s.z - z, along = ox * sx + oz * sz;
      if (along < 0.5 || along > reach) continue;
      if (Math.abs(ox * sz - oz * sx) < clamp(s.r * 11, 2.5, 5) - 0.5) return false;
    }
    return true;
  }

  // What the user was looking at: the collider containing the target (the tallest one), else the nearest
  // building-like one within 10 m — together with every other collider carrying the same tag, since landmarks
  // register several (Gates-Hillman is a stack of terraced volumes, the Fence a row of boxes). Generic prop tags
  // (tree, lamp, bench…) are never grouped.
  const GENERIC = new Set(['tree', 'lamp', 'bench', 'bin', 'bikerack', 'hydrant', 'bollard', 'mailbox', 'busShelter',
    'pavilion', 'picnic', 'flagpole', 'car', 'hedge', 'fountain', 'bridge-pier', 'bridge-rail', 'portal', 'wall',
    'retaining-wall', 'barrier']);
  function subjectAt(x, z) {
    if (!colliders?.query) return null;
    const g = world.heightAt(x, z);
    let inside = null, near = null, nearD = Infinity;
    for (const s of colliders.query(x, z, 10)) {
      if (topOf(s, g) <= 0.2) continue;
      const d = world.shapeDistance(s, x, z);
      if (d <= 0) { if (!inside || topOf(s, g) > topOf(inside, g)) inside = s; }
      else if (d < nearD && isMassive(s, g)) { nearD = d; near = s; }
    }
    const main = inside || near;
    if (!main) return null;
    const shapes = new Set([main]);
    if (typeof main.tag === 'string' && main.tag && !GENERIC.has(main.tag)) {
      const r = isMassive(main, g) ? 160 : 30;   // ('fence' is also the tag of ordinary fences: stay local)
      for (const s of colliders.query(x, z, r)) if (s.tag === main.tag) shapes.add(s);
    }
    let topY = -Infinity, massive = false;
    for (const s of shapes) {
      topY = Math.max(topY, Number.isFinite(s.yMax) ? s.yMax : g + 40);
      if (isMassive(s, g)) massive = true;
    }
    return { shapes, topY, massive };
  }
  function subjectDistance(subject, x, z) {
    let d = Infinity;
    for (const s of subject.shapes) d = Math.min(d, world.shapeDistance(s, x, z));
    return d;
  }

  // Line of sight from (x, z) to the target: no other building in between (the subject itself is allowed).
  function sees(x, z, tx, tz, subject) {
    const dx = tx - x, dz = tz - z, L = Math.hypot(dx, dz);
    for (let t = 1.5; t < L - 1; t += 1.5) {
      const px = x + (dx * t) / L, pz = z + (dz * t) / L;
      if (subject && subjectDistance(subject, px, pz) <= 0) return true;  // reached the subject
      const g = world.heightAt(px, pz);
      for (const s of colliders.query(px, pz, 0.1)) {
        if (!subject?.shapes.has(s) && inBody(s, g) && isMassive(s, g) && world.shapeDistance(s, px, pz) <= 0) return false;
      }
    }
    return true;
  }

  // ---- footway points (lazy grid of points sampled every 2.5 m along outdoor paths) ----------------------------
  const CELL = 20;
  let footGrid = null;
  function buildFootways() {
    footGrid = new Map();
    for (const p of ctx.data?.paths || []) {
      if (p.tunnel || p.indoor || p.covered || p.footway === 'crossing' || p.type === 'track') continue;
      const pts = p.points || [];
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2.5));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
          const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
          let list = footGrid.get(key);
          if (!list) footGrid.set(key, (list = []));
          list.push(x, z);
        }
      }
    }
  }
  function footwaysNear(x, z, r) {
    if (!footGrid) buildFootways();
    const out = [];
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const list = footGrid.get(`${i},${j}`);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const d = Math.hypot(list[k] - x, list[k + 1] - z);
          if (d <= r) out.push({ x: list[k], z: list[k + 1], d });
        }
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  // March from the target along unit (ux, uz). Returns the first fully cleared spot ({ok:true}), else the
  // best-cleared one seen ({ok:false}), else null.
  function march(T, ux, uz, maxLen, subject) {
    let best = null;
    for (let t = MIN_FROM_TARGET; t <= maxLen; t += 1.5) {
      const x = T.x + ux * t, z = T.z + uz * t;
      if (!inBounds(x, z)) break;
      const r = assess(x, z, subject).ratio;
      if (r <= 0) continue;
      // a big drop/climb (e.g. down into Junction Hollow) is only a last resort; so is a spot whose view of the
      // target is blocked right in front (a tree trunk, a lamp post)
      let score = Math.abs(world.heightAt(x, z) - T.g) > 8 ? Math.min(r, 0.99) * 0.6 : r;
      if (score >= 1 && !viewFree(x, z, headingTo(x, z, T.x, T.z))) score = 0.97;
      else if (score >= 1 && !crownsClear(x, z, T.x, T.z)) score = 0.98;
      if (score >= 1) return { x, z, ratio: r, score, t, ok: true };
      if (!best || score > best.score + 0.02) best = { x, z, ratio: r, score, t, ok: false };
    }
    return best;
  }

  /**
   * @param tx,ty,tz  orbit target (what the user looked at; ty may be above the ground, e.g. a sculpture's middle)
   * @param ax,az     where the camera is (its ground position) — we step out towards it
   * @param viewHeading current compass heading of the camera
   * @returns { x, z, heading, pitch, open, footway } or null (no idea — caller falls back to the target)
   */
  function find(tx, ty, tz, ax, az, viewHeading) {
    const T = { x: tx, z: tz, g: world.heightAt(tx, tz) };
    // 1. already in open space: keep the classic behaviour
    const a = assess(tx, tz);
    if (a.ratio > 0 && a.massiveMin >= OPEN_CLEAR && a.smallMin >= OPEN_SMALL &&
        viewFree(tx, tz, viewHeading) && viewFree(tx, tz, viewHeading, 12, true)) {
      return { x: tx, z: tz, heading: viewHeading, pitch: 0, open: true, footway: false };
    }
    const subject = subjectAt(tx, tz);
    // 2. step out towards the camera (backwards along the view when the camera is right above the target)
    let ux = ax - tx, uz = az - tz;
    const L = Math.hypot(ux, uz);
    if (L < 2) { ux = -Math.sin(viewHeading); uz = Math.cos(viewHeading); } else { ux /= L; uz /= L; }
    const maxLen = clamp(L, 60, 200);
    let bestOk = null, best = null;
    for (const deg of FAN) {
      const pen = Math.abs(deg) * 0.4;
      // lines only need marching as far as they could still beat the best spot found
      const len = Math.min(deg === 0 ? maxLen : Math.min(maxLen, 120), bestOk ? bestOk.cost - pen : Infinity);
      if (len < MIN_FROM_TARGET) continue;
      const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
      const m = march(T, ux * c - uz * s, ux * s + uz * c, len, subject);
      if (!m) continue;
      if (m.ok) { m.cost = m.t + pen; if (!bestOk || m.cost < bestOk.cost) bestOk = m; }
      else if (!best || m.score > best.score + 0.02) best = m;
    }
    let spot = bestOk || best;
    if (!spot) return null;

    // 3. prefer standing on a footway nearby (same side of the target, still clear, target still in view)
    const need = spot.ok ? 1 : spot.ratio;
    const dT = Math.hypot(spot.x - tx, spot.z - tz);
    const ox = (spot.x - tx) / (dT || 1), oz = (spot.z - tz) / (dT || 1);
    const gSpot = world.heightAt(spot.x, spot.z);
    let tries = 0;
    for (const q of footwaysNear(spot.x, spot.z, FOOTWAY_R)) {
      if (++tries > 160) break;
      const qx = q.x - tx, qz = q.z - tz, qd = Math.hypot(qx, qz);
      if (qd < MIN_FROM_TARGET || qd > dT + 25) continue;
      if ((qx * ox + qz * oz) / (qd || 1) < 0.64) continue;          // within ~50° of the chosen side
      if (Math.abs(world.heightAt(q.x, q.z) - gSpot) > 6) continue;
      if (assess(q.x, q.z, subject).ratio < need) continue;
      if (!viewFree(q.x, q.z, headingTo(q.x, q.z, tx, tz))) continue;
      if (!crownsClear(q.x, q.z, tx, tz)) continue;
      if (!sees(q.x, q.z, tx, tz, subject)) continue;
      spot = { ...spot, x: q.x, z: q.z, footway: true };
      break;
    }

    // 4. face the target, framed; turn away from anything right in front of the walker
    const baseH = headingTo(spot.x, spot.z, tx, tz);
    let turn = null;
    for (const deg of TURN) if (viewFree(spot.x, spot.z, baseH + deg * DEG)) { turn = deg; break; }
    let pitch = 0;
    if (turn === 0) {
      const eyeY = world.groundAt(spot.x, spot.z) + 1.65;
      if (subject?.massive && subject.topY - T.g >= 8) {                // towards the building's mid-facade
        const d = subjectDistance(subject, spot.x, spot.z) + 2;
        pitch = clamp(Math.atan2(T.g + 0.45 * (subject.topY - T.g) - eyeY, d), -0.12, 0.2);
      } else {                                                          // towards the sculpture / statue itself
        const aimY = clamp(Number.isFinite(ty) ? ty : T.g, T.g, T.g + 25);
        pitch = clamp(Math.atan2(aimY - eyeY, Math.max(4, Math.hypot(spot.x - tx, spot.z - tz))), -0.12, 0.3);
      }
    }
    const heading = baseH + (turn ?? 0) * DEG;
    return { x: spot.x, z: spot.z, heading: ((heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), pitch, open: false, footway: !!spot.footway };
  }

  return { find, assess, viewFree };
}
