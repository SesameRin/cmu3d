// Camera / navigation helpers used across the UI. Every call tolerates a missing or partial ctx.nav.
import * as THREE from 'three';
import { pointInRing } from '../core/heightfield.js';
import { vec3, clamp } from './dom.js';
import { firstPickHit, terrainHitDistance } from './raycast.js';

const fwd = new THREE.Vector3();
const box = new THREE.Box3();
const losRay = new THREE.Raycaster();
const vA = new THREE.Vector3(), vB = new THREE.Vector3();

/** Compass heading of the camera: 0 = north (−Z), π/2 = east (+X), clockwise, in radians. */
export function cameraHeading(camera) {
  camera.getWorldDirection(fwd);
  if (Math.abs(fwd.x) < 1e-6 && Math.abs(fwd.z) < 1e-6) {
    // looking straight down: use the camera's up vector projected on the ground
    fwd.set(0, 1, 0).applyQuaternion(camera.quaternion);
  }
  return Math.atan2(fwd.x, -fwd.z);
}

/** Current mode string. */
export const navMode = (ctx) => ctx.nav?.mode || ctx.nav?.getState?.()?.mode || 'orbit';

/** { mode, position:[x,y,z], target:[x,y,z] } — target synthesised from the view direction when nav has none. */
export function viewState(ctx) {
  const cam = ctx.camera;
  let st = null;
  try { st = ctx.nav?.getState?.() || null; } catch { st = null; }
  const position = vec3(st?.position) || (cam ? [cam.position.x, cam.position.y, cam.position.z] : [0, 200, 400]);
  let target = vec3(st?.target);
  if (!target && ctx.nav?.getTarget) target = vec3(ctx.nav.getTarget());
  if (!target && cam) {
    cam.getWorldDirection(fwd);
    // Put the look-at point where the view ray meets the ground (or 60 m ahead)
    let d = 60;
    if (fwd.y < -0.05) d = clamp((position[1] - (ctx.heightAt?.(position[0], position[2]) ?? 0)) / -fwd.y, 5, 1500);
    target = [position[0] + fwd.x * d, position[1] + fwd.y * d, position[2] + fwd.z * d];
  }
  return { mode: st?.mode || navMode(ctx), position, target: target || [0, 45, 0], heading: st?.heading };
}

/**
 * Share link for the current view: the page address plus only the view parameters (cam, look, hours, season,
 * mode) — never the sharer's own ?tour, ?welcome, ?noui, ?debug, ?q… (a shared ?tour would fly the recipient away).
 */
export function shareUrl(ctx) {
  const { mode, position, target } = viewState(ctx);
  const f = (a) => a.map((v) => Math.round(v * 10) / 10).join(',');
  const q = [`cam=${f(position)}`, `look=${f(target)}`];
  const hours = ctx.env?.getTime?.() ?? ctx.env?.state?.hours;
  if (Number.isFinite(hours)) q.push(`hours=${Math.round(hours * 4) / 4}`);
  const season = ctx.env?.state?.season;
  if (/^(spring|summer|autumn|winter)$/.test(season || '')) q.push(`season=${season}`);
  if (mode === 'walk' || mode === 'fly') q.push(`mode=${mode}`);
  return `${location.href.split(/[?#]/)[0]}?${q.join('&')}`;
}

/** Nice orbit distance to frame a record of the given radius. */
export function frameDistance(rec) {
  const r = rec?.radius || 30;
  const h = rec?.height || 0;
  return clamp(Math.max(r * 2.6, h * 2.2, 70), 70, 900);
}

/**
 * Where a record is best seen from, as a ground point [x, z] on that side of it — from the record's preferred
 * view (rec.view: { stand:[x,z] } | { from:[x,z] } | { heading: compass deg the camera looks along }), or null.
 */
export function viewFrom(rec) {
  const v = rec?.view;
  if (!v || !rec.position) return null;
  const p = v.stand || v.from;
  if (Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1])) return [+p[0], +p[1]];
  if (Number.isFinite(+v.heading)) {
    const a = (+v.heading * Math.PI) / 180;
    return [rec.position[0] - Math.sin(a) * 100, rec.position[2] + Math.cos(a) * 100];
  }
  return null;
}

/** Fly the orbit camera to a catalogue record (from its preferred side when it has one). Returns a promise. */
export function flyToRecord(ctx, rec, opts = {}) {
  if (!rec?.position) return Promise.resolve();
  const target = rec.position.slice();
  const nav = ctx.nav;
  try {
    if (nav?.flyTo) {
      const from = opts.position ? null : viewFrom(rec);
      const heading = from ? faceHeading(from[0], from[1], target[0], target[2]) : undefined;
      const distance = opts.distance || (Number.isFinite(+rec.view?.distance) ? +rec.view.distance : frameDistance(rec));
      const r = nav.flyTo({ target, distance, duration: opts.duration, ...(heading !== undefined ? { heading } : {}), ...(opts.position ? { position: opts.position } : {}) });
      return r && typeof r.then === 'function' ? r : Promise.resolve();
    }
    if (nav?.setView) {
      const d = opts.distance || frameDistance(rec);
      nav.setView([target[0] + d * 0.55, target[1] + d * 0.6, target[2] + d * 0.6], target);
    }
  } catch (e) { console.warn('[ui] flyTo failed', e); }
  return Promise.resolve();
}

/**
 * Walk to a record: pick a standing spot that shows it — outside its footprint at a distance that fits its
 * height, preferring its front (rec.view) or else the camera side, footways and spots on the same level, rejecting
 * spots inside other buildings, right behind a lamp post, or with another building / the terrain in the way — then
 * enter walk mode facing it.
 * Heading passed to nav.walkTo is the compass heading (0 = north, clockwise).
 */
export function walkToRecord(ctx, rec) {
  if (!rec?.position || !ctx.nav?.walkTo) return false;
  let spot = null;
  try { spot = standingSpot(ctx, rec); } catch (e) { console.warn('[ui] standing spot search failed', e); }
  if (!spot) spot = fallbackSpot(ctx, rec);
  // tilt the view up toward the middle of the subject (tall buildings otherwise fill the frame with ground floor)
  let pitch = 0;
  try {
    const [px, py, pz] = rec.position;
    const d = Math.hypot(px - spot.x, pz - spot.z);
    const eyeY = ctx.surfaceHeightAt(spot.x, spot.z) + EYE;
    const midY = eyeY + (py - eyeY) * 0.5;
    if (d > 1) pitch = Math.max(0, Math.min(0.45, Math.atan2(midY - eyeY, d)));
  } catch { /* keep level */ }
  try { ctx.nav.walkTo(spot.x, spot.z, spot.heading, { pitch }); } catch (e) { console.warn('[ui] walkTo failed', e); return false; }
  return true;
}

const EYE = 1.65;
const strip = (k) => String(k ?? '').replace(/^(landmark|lm|building|bld|b|poi|area|label|ui|adhoc:\w+):/i, '');
const faceHeading = (x, z, cx, cz) => Math.atan2(cx - x, -(cz - z));

function recordRings(ctx, rec) {
  const parts = rec.parts || null;
  if (parts?.length) return parts.map((b) => b.footprint).filter(Boolean);
  const ids = new Set(rec.osmIds || (rec.osmId ? [rec.osmId] : []));
  if (ids.size && ctx.data?.buildings) {
    const rings = ctx.data.buildings.filter((b) => ids.has(b.osmId) || ids.has(b.id)).map((b) => b.footprint).filter(Boolean);
    if (rings.length) return rings;
  }
  return rec.building?.footprint ? [rec.building.footprint] : [];
}

function recordHeight(ctx, rec, ground) {
  if (rec._walkH) return rec._walkH;
  let hgt = rec.height > 0 ? rec.height : 0;
  if (!hgt && rec.landmarkKey) {
    const lm = (ctx.landmarks || []).find((l) => l.key === rec.landmarkKey);
    if (lm?.object) {
      try {
        box.setFromObject(lm.object);
        if (!box.isEmpty() && Number.isFinite(box.max.y)) hgt = box.max.y - Math.max(box.min.y, ground);
      } catch { /* ignore */ }
    }
  }
  if (!hgt) {
    const parts = rec.parts || (rec.building ? [rec.building] : []);
    for (const b of parts) hgt = Math.max(hgt, b.height || 0);
  }
  if (!hgt) hgt = Math.max(4, (rec.position[1] - ground) * 2);
  rec._walkH = clamp(hgt, 2, 400);
  return rec._walkH;
}

function isOwn(entry, rec) {
  if (!entry) return false;
  const ids = rec.osmIds || (rec.osmId ? [rec.osmId] : []);
  if (entry.osmId && ids.includes(entry.osmId)) return true;
  const k = strip(entry.key);
  return !!k && (k === strip(rec.key) || k === rec.landmarkKey || k === rec.infoLandmarkKey || ids.includes(k));
}

// Is the view from an eye at (x, eyeY, z) to the record's centre blocked by something else?
function blocked(ctx, rec, x, eyeY, z, aim) {
  vA.set(x, eyeY, z);
  vB.set(aim[0] - x, aim[1] - eyeY, aim[2] - z);
  const dist = vB.length();
  if (dist < 1) return false;
  vB.divideScalar(dist);
  losRay.set(vA, vB);
  losRay.near = 0.3;
  losRay.far = dist;
  const terrainT = terrainHitDistance(ctx, losRay.ray, dist - 2);
  if (terrainT < dist - 4) return true;
  const hit = firstPickHit(ctx, losRay);
  if (!hit) return false;
  let entry = null;
  try { entry = ctx.pick.resolve(hit); } catch { entry = null; }
  if (isOwn(entry, rec)) return false;
  // something else in the way — unless it is right at the target (a sub-part without its own entry)
  return hit.distance < dist - Math.max(4, (rec.radius || 10) * 0.6);
}

function standingSpot(ctx, rec) {
  const [cx, cy, cz] = rec.position;
  const H = (x, z) => (ctx.heightAt ? ctx.heightAt(x, z) : 45);
  const b = ctx.data?.meta?.bounds || { minX: -805, maxX: 890, minZ: -833, maxZ: 611 };
  const rings = recordRings(ctx, rec);
  let ground = H(cx, cz);
  if (rec.building?.ground?.min !== undefined) ground = rec.building.ground.min;
  const hgt = recordHeight(ctx, rec, ground);
  const small = !rings.length && (rec.radius || 10) < 15;
  // how far to stand: tall buildings need more room to be seen at eye level (walk mode looks level)
  let stand;
  if (rings.length) stand = clamp(1.4 * hgt + 6, 15, 70);
  else if (small) stand = clamp((rec.radius || 10) * 0.6 + 6 + 0.3 * hgt, 8, 14);
  else stand = Math.min(rec.radius || 20, 25) + 5;
  const aim = [cx, clamp(cy, ground + 1, ground + Math.min(hgt * 0.5, 25)), cz];

  // the record's preferred side (its front) first, else the camera side
  const cam = ctx.camera?.position;
  const from = viewFrom(rec);
  let dx = from ? from[0] - cx : cam ? cam.x - cx : 0.3, dz = from ? from[1] - cz : cam ? cam.z - cz : 1;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  const lamps = lampGrid(ctx);
  // a curated standing point is taken as is when it is free and has a clear view
  const stand0 = rec.view?.stand && viewFrom(rec);
  if (stand0) {
    const [x, z] = stand0, g = H(x, z), hd = faceHeading(x, z, cx, cz);
    if (!insideAny(ctx, x, z, g) && !lampInView(lamps, x, z, hd) && !blocked(ctx, rec, x, g + EYE, z, aim)) return { x, z, heading: hd };
  }

  // nearby footways / roads to prefer / avoid (segments within reach)
  const reach = stand + (rec.radius || 20) + 60;
  const near = (pts) => pts?.some?.((p) => Math.abs(p[0] - cx) < reach && Math.abs(p[1] - cz) < reach);
  const paths = (ctx.data?.paths || []).filter((p) => !p.indoor && !p.tunnel && near(p.points));
  const roads = (ctx.data?.roads || []).filter((r) => !r.tunnel && !r.bridge && near(r.points));
  const segDist = (x, z, pts) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], az = pts[i - 1][1], ex = pts[i][0] - ax, ez = pts[i][1] - az;
      const l2 = ex * ex + ez * ez || 1e-9;
      let t = ((x - ax) * ex + (z - az) * ez) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
      if (d < best) best = d;
    }
    return best;
  };
  const insideSomething = (x, z, g) => insideAny(ctx, x, z, g);

  const cands = [];
  const N = 16;
  for (let k = 0; k < N; k++) {
    const a = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((Math.PI * 2) / N);
    const ux = dx * Math.cos(a) - dz * Math.sin(a), uz = dx * Math.sin(a) + dz * Math.cos(a);
    let edge = 0;
    if (rings.length) {
      edge = -1;
      for (let d = 1.5; d < 320; d += 1.5) {
        if (!rings.some((r) => pointInRing(cx + ux * d, cz + uz * d, r))) { edge = d; break; }
      }
      if (edge < 0) continue;
    }
    for (const f of rings.length ? [1, 0.7, 0.45] : [1, 0.75]) {
      const off = edge + Math.max(small ? 6 : 8, stand * f);
      const x = cx + ux * off, z = cz + uz * off;
      if (x < b.minX + 8 || x > b.maxX - 8 || z < b.minZ + 8 || z > b.maxZ - 8) continue;
      const g = H(x, z);
      if (g < ground - 6 || g > ground + 15) continue;            // down in a ravine / up on a ridge
      if (rings.some((r) => pointInRing(x, z, r)) || insideSomething(x, z, g)) continue;
      let score = -Math.abs(a) * 1.1 + (f === 1 ? 0.6 : f > 0.6 ? 0.3 : 0);
      let pd = Infinity;
      for (const p of paths) { pd = Math.min(pd, segDist(x, z, p.points)); if (pd < 2) break; }
      if (pd < 3) score += 0.8; else if (pd < 8) score += 0.3;
      for (const r of roads) if (segDist(x, z, r.points) < (r.width || 7) / 2) { score -= 0.6; break; }
      // a lamp post / bus shelter right beside you or just ahead would cut through the view
      if (lampInView(lamps, x, z, faceHeading(x, z, cx, cz))) score -= 3;
      cands.push({ x, z, g, score });
    }
  }
  if (!cands.length) return null;
  cands.sort((p, q) => q.score - p.score);
  // line of sight for the best few
  for (let i = 0; i < Math.min(cands.length, 12); i++) {
    const c = cands[i];
    if (!blocked(ctx, rec, c.x, c.g + EYE, c.z, aim)) return { x: c.x, z: c.z, heading: faceHeading(c.x, c.z, cx, cz) };
  }
  const c = cands[0];
  return { x: c.x, z: c.z, heading: faceHeading(c.x, c.z, cx, cz) };
}

// Inside a building / wall / other collider at (x, z) for someone standing on ground height g?
function insideAny(ctx, x, z, g) {
  const list = ctx.colliders?.query?.(x, z, 0.8) || [];
  for (const s of list) {
    if (!Number.isFinite(s.yMax) || s.yMax < g + 0.4) continue;
    if (Number.isFinite(s.yMin) && s.yMin > g + EYE) continue;
    const inside = s.kind === 'circle' ? Math.hypot(x - s.x, z - s.z) < s.r + 0.6 : pointInRing(x, z, s.ring);
    if (inside) return true;
  }
  return false;
}

// Street lamps and bus shelters (ctx.props) in a coarse 16 m grid, built once.
const LAMP_CELL = 16;
const lampGrids = new WeakMap();
function lampGrid(ctx) {
  const props = ctx.props;
  if (!props) return null;
  let g = lampGrids.get(props);
  if (g) return g;
  g = new Map();
  const add = (p, r) => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
    const k = `${Math.floor(p.x / LAMP_CELL)},${Math.floor(p.z / LAMP_CELL)}`;
    let a = g.get(k);
    if (!a) g.set(k, (a = []));
    a.push([p.x, p.z, r]);
  };
  for (const p of props.lampPositions?.campus || []) add(p, 0);
  for (const p of props.lampPositions?.street || []) add(p, 0);
  for (const p of props.busStops || []) add(p, 2);     // shelters are a few metres wide
  lampGrids.set(props, g);
  return g;
}
/** A lamp / shelter within 4 m, or within 15 m and inside ±20° of the view heading (compass radians). */
function lampInView(grid, x, z, heading) {
  if (!grid) return false;
  const fx = Math.sin(heading), fz = -Math.cos(heading);
  const cos20 = Math.cos((20 * Math.PI) / 180);
  const i0 = Math.floor((x - 16) / LAMP_CELL), i1 = Math.floor((x + 16) / LAMP_CELL);
  const j0 = Math.floor((z - 16) / LAMP_CELL), j1 = Math.floor((z + 16) / LAMP_CELL);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      for (const [lx, lz, r] of lampsAt(grid, i, j)) {
        const ex = lx - x, ez = lz - z;
        const d = Math.hypot(ex, ez) - r;
        if (d < 4) return true;
        if (d < 15 && (ex * fx + ez * fz) / Math.max(1e-6, Math.hypot(ex, ez)) > cos20) return true;
      }
    }
  }
  return false;
}
const NONE = [];
const lampsAt = (grid, i, j) => grid.get(`${i},${j}`) || NONE;

// The old rule (first outside point on the camera side + 7 m) when nothing better is found.
function fallbackSpot(ctx, rec) {
  const [cx, , cz] = rec.position;
  const rings = recordRings(ctx, rec);
  const cam = ctx.camera?.position;
  const from = viewFrom(rec);
  let dx = from ? from[0] - cx : cam ? cam.x - cx : 0.3, dz = from ? from[1] - cz : cam ? cam.z - cz : 1;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  let x = cx + dx * (Math.min(rec.radius || 10, 25) + 5), z = cz + dz * (Math.min(rec.radius || 10, 25) + 5);
  if (rings.length) {
    for (let d = 2; d < 260; d += 2) {
      const px = cx + dx * d, pz = cz + dz * d;
      if (!rings.some((r) => pointInRing(px, pz, r))) { x = cx + dx * (d + 7); z = cz + dz * (d + 7); break; }
    }
  }
  return { x, z, heading: faceHeading(x, z, cx, cz) };
}

/** Rotate the view to face north, keeping the current focus. */
export function faceNorth(ctx) {
  const { mode, position, target } = viewState(ctx);
  const nav = ctx.nav;
  if (!nav) return;
  try {
    if (mode === 'walk' && nav.walkTo) {
      nav.walkTo(position[0], position[2], 0);
    } else if (nav.flyTo) {
      const dx = position[0] - target[0], dz = position[2] - target[2];
      const hd = Math.hypot(dx, dz);
      if (mode === 'fly') {
        nav.flyTo({ position, target: [position[0], target[1], position[2] - Math.max(hd, 30)], duration: 0.9, mode: 'fly' });
      } else {
        nav.flyTo({ target, position: [target[0], position[1], target[2] + Math.max(hd, 1)], duration: 0.9 });
      }
    }
  } catch (e) { console.warn('[ui] faceNorth failed', e); }
}
