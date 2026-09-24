// Walking people, driving cars & buses, Scotty dogs and birds (owner: life agent). Contract: ARCHITECTURE.md §life.
//
// Pedestrians walk along a graph built from data.paths (vertex snapping + T-junction repair, see graph.js),
// keeping to the right of the path, preferring campus walkways and continuing roughly straight at junctions.
// Paths are clipped to the data bounds and cut where they run through building footprints (people never walk
// through walls; covered passages are kept). Cars drive on the major-road graph (trunk/primary/secondary/
// tertiary + park circuit roads) on the RIGHT side, respecting one-way streets; positions are box-filtered along
// the route (across edges) which rounds corners into smooth arcs. Simple car-following + curve slow-down. Two PRT
// buses stay on Forbes/Fifth and stop at shelters.
// Bridges: heights come from the real walkable decks (roads agent's bridge decks, landmark decks) sampled every
// few metres; mapped bridge sidewalks that lie beside the rendered deck are pulled onto it.
// Rendering: each frame only the instances in (or casting a shadow into) the view are packed into the instanced
// meshes; distant cars use the low-poly LOD; only nearby cars cast shadows. All state lives in typed arrays.
import * as THREE from 'three';
import { getLandMask, buildNetwork, edgePoint, M, mulberry32, composeMatrix, pointInRing, createCuller, clipPolylineToRect, polylineLength, animTime, loopHz } from './graph.js';
import { personGeometry, createPersonMaterial, createPersonDepthMaterial, randomOutfit, scottyGeometry, createDogMaterial, birdGeometry, createBirdMaterial } from './people.js';
import { createCarMaterial, createVehicleMesh, randomPaint, CAR_DIMS } from './cars.js';
import { createLightPoolMaterial } from './props.js';
import { scheduleFinishWorld } from './warmup.js';

// Rendered ground height; unlike ctx.heightAt it keeps following the terrain skirt beyond the data grid.
const groundAt = (ctx, x, z) => (ctx.terrain?.meshHeightAt ? ctx.terrain.meshHeightAt(x, z) : ctx.heightAt(x, z));

const ROAD_CLASS = { trunk: 3, primary: 3, primary_link: 1.2, secondary: 2.4, tertiary: 1.6, unclassified: 0.7 };
const ROAD_SPEED = { trunk: 13, primary: 12.5, primary_link: 9, secondary: 11.5, tertiary: 10, unclassified: 8 };
const EDGE_CLIP = 25;          // networks stop this far inside the data bounds (no traffic on the unpainted skirt)

// ------------------------------------------------------------------ helpers
function distToRing(x, z, r) {
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const ax = r[j][0], az = r[j][1], ex = r[i][0] - ax, ez = r[i][1] - az, l2 = ex * ex + ez * ez || 1e-9;
    let t = ((x - ax) * ex + (z - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - ax - ex * t, dz = z - az - ez * t, d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Chain bridge ways that share an end node (like bridges.js) → Map wayId → chain {pts, cum, total}
function chainBridgeWays(ways) {
  const key = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const byEnd = new Map();
  for (const w of ways) for (const p of [w.points[0], w.points[w.points.length - 1]]) {
    const k = key(p); if (!byEnd.has(k)) byEnd.set(k, []); byEnd.get(k).push(w);
  }
  const used = new Set(), out = new Map();
  for (const w of ways) {
    if (used.has(w)) continue;
    used.add(w);
    let pts = w.points.slice();
    const members = [w];
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const end = dir === 0 ? pts[pts.length - 1] : pts[0];
        const cand = (byEnd.get(key(end)) || []).filter((o) => !used.has(o));
        if (cand.length !== 1) break;
        const o = cand[0]; used.add(o); members.push(o);
        const op = o.points.slice();
        if (dir === 0) { if (key(op[0]) !== key(end)) op.reverse(); pts = pts.concat(op.slice(1)); }
        else { if (key(op[op.length - 1]) !== key(end)) op.reverse(); pts = op.slice(0, -1).concat(pts); }
      }
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const chain = { pts, cum, total: cum[cum.length - 1] || 1 };
    for (const m of members) out.set(m.id, chain);
  }
  return out;
}

// Insert vertices so no segment of the edge is longer than `step` (bridge decks have camber / curvature).
function densifyEdge(e, step) {
  const n = e.cum.length;
  const xs = [], zs = [];
  for (let k = 0; k < n; k++) {
    const x = e.pts[k * 2], z = e.pts[k * 2 + 1];
    if (k > 0) {
      const px = e.pts[k * 2 - 2], pz = e.pts[k * 2 - 1], L = e.cum[k] - e.cum[k - 1];
      const m = Math.ceil(L / step);
      for (let j = 1; j < m; j++) { xs.push(px + ((x - px) * j) / m); zs.push(pz + ((z - pz) * j) / m); }
    }
    xs.push(x); zs.push(z);
  }
  setEdgePoints(e, xs, zs);
}
function setEdgePoints(e, xs, zs) {
  const n = xs.length;
  e.pts = new Float32Array(n * 2); e.cum = new Float32Array(n);
  let s = 0;
  for (let k = 0; k < n; k++) {
    e.pts[k * 2] = xs[k]; e.pts[k * 2 + 1] = zs[k];
    if (k) s += Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]);
    e.cum[k] = s;
  }
  e.len = s;
}

export async function createLife(ctx) {
  const t0 = performance.now();
  // per-phase timings (ms) reported in the stats line
  const phases = {};
  let tPh = t0;
  const mark = (k) => { const n = performance.now(); phases[k] = Math.round(n - tPh); tPh = n; };
  const data = ctx.data;
  const q = ctx.quality || {};
  const mask = getLandMask(ctx);
  mark('mask');
  const rng = mulberry32(0x11fe);
  const shared = { uTime: { value: 0 } };
  const group = new THREE.Group();
  group.name = 'life';
  let shadows = !!q.shadows;
  const b = data.meta.bounds;
  const hf = ctx.heightfield;
  const clip = (pts) => clipPolylineToRect(pts, b.minX + EDGE_CLIP, b.minZ + EDGE_CLIP, b.maxX - EDGE_CLIP, b.maxZ - EDGE_CLIP);

  // ------------------------------------------------------------------ bridge decks
  // Vertical probes against the walkable surfaces (bridge decks, landmark decks, stairs). Instead of a THREE
  // raycast against every walkable mesh per probe (thousands of probes: deck heights every 3–4 m plus lateral
  // searches), the world-space triangles are binned once into an xz grid and a probe tests only the triangles
  // of its cell. Same rules as Raycaster + Mesh.raycast: FrontSide keeps up-facing triangles only (a downward
  // ray hits their front), BackSide down-facing, DoubleSide both; drawRange respected. Meshes this fast path
  // does not cover (instanced/skinned/morphed, material arrays) fall back to the raycaster.
  const walk = ctx.walkables?.meshes || [];
  const ray = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), ORG = new THREE.Vector3();
  const NOHITS = [];
  const WG = 8, wGrid = new Map();
  const wk = (i, j) => i * 100003 + j;
  const TRI = [];              // world triangles: ax, ay, az, bx, by, bz, cx, cy, cz
  const slow = [];             // meshes probed with the raycaster
  const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3();
  for (const m of walk) {
    m.updateWorldMatrix(true, false);
    const g = m.geometry, pos = g?.attributes?.position;
    if (!pos) continue;
    if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || Array.isArray(m.material) || !m.material || g.morphAttributes?.position?.length) { slow.push(m); continue; }
    const side = m.material.side, sgn = m.matrixWorld.determinant() < 0 ? -1 : 1;
    const index = g.index;
    const start = Math.max(0, g.drawRange.start), end = Math.min(index ? index.count : pos.count, g.drawRange.start + g.drawRange.count);
    for (let t = start; t + 2 < end; t += 3) {
      const ia = index ? index.getX(t) : t, ib = index ? index.getX(t + 1) : t + 1, ic = index ? index.getX(t + 2) : t + 2;
      _va.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld);
      _vb.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld);
      _vc.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
      // y of (b - a) × (c - a), in the mesh's local handedness
      const ny = ((_vb.z - _va.z) * (_vc.x - _va.x) - (_vb.x - _va.x) * (_vc.z - _va.z)) * sgn;
      if (side === THREE.FrontSide ? !(ny > 0) : side === THREE.BackSide ? !(ny < 0) : ny === 0) continue;
      const ti = TRI.length / 9;
      TRI.push(_va.x, _va.y, _va.z, _vb.x, _vb.y, _vb.z, _vc.x, _vc.y, _vc.z);
      const x0 = Math.min(_va.x, _vb.x, _vc.x), x1 = Math.max(_va.x, _vb.x, _vc.x), z0 = Math.min(_va.z, _vb.z, _vc.z), z1 = Math.max(_va.z, _vb.z, _vc.z);
      for (let i = Math.floor(x0 / WG); i <= Math.floor(x1 / WG); i++) for (let j = Math.floor(z0 / WG); j <= Math.floor(z1 / WG); j++) {
        const k = wk(i, j); let a = wGrid.get(k); if (!a) wGrid.set(k, a = []); a.push(ti);
      }
    }
  }
  const T9 = new Float64Array(TRI);
  mark('deckIndex');
  // heights of all walkable surfaces more than 0.4 m above the terrain at (x, z), highest first
  function deckHits(x, z, g) {
    let out = NOHITS;
    const arr = wGrid.get(wk(Math.floor(x / WG), Math.floor(z / WG)));
    if (arr) {
      const yMin = g + 0.4, yMax = g + 300;
      for (let q = 0; q < arr.length; q++) {
        const o = arr[q] * 9;
        const ax = T9[o], az = T9[o + 2], bx = T9[o + 3], bz = T9[o + 5], cx = T9[o + 6], cz = T9[o + 8];
        // barycentric coordinates of (x, z) in the triangle's xz projection (edges inclusive)
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (d === 0) continue;
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        if (u < -1e-9 || u > 1 + 1e-9) continue;
        const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        if (v < -1e-9 || u + v > 1 + 1e-9) continue;
        const y = u * T9[o + 1] + v * T9[o + 4] + (1 - u - v) * T9[o + 7];
        if (y < yMin || y > yMax) continue;
        if (out === NOHITS) out = [];
        out.push(y);
      }
    }
    if (slow.length) {
      ORG.set(x, g + 300, z); ray.set(ORG, DOWN); ray.far = 300 - 0.4;
      const hits = ray.intersectObjects(slow, false);
      if (hits.length) { if (out === NOHITS) out = []; for (const h of hits) out.push(h.point.y); }
    }
    if (out.length > 1) out.sort((p, s) => s - p);
    return out;
  }
  const closest = (hits, y) => { let best = hits[0]; for (const h of hits) if (Math.abs(h - y) < Math.abs(best - y)) best = h; return best; };
  const inGrid = (x, z) => x >= hf.minX && x <= hf.maxX && z >= hf.minZ && z <= hf.maxZ;
  // expected deck height from the chained bridge (ends on the terrain, slight camber) — picks between stacked decks
  function chainY(chain, x, z) {
    const P = chain.pts;
    if (chain.h0 === undefined) {
      const a = P[0], e = P[P.length - 1];
      let h0 = inGrid(a[0], a[1]) ? groundAt(ctx, a[0], a[1]) : null, h1 = inGrid(e[0], e[1]) ? groundAt(ctx, e[0], e[1]) : null;
      if (h0 === null) h0 = h1 ?? 0; if (h1 === null) h1 = h0;
      chain.h0 = h0; chain.h1 = h1;
    }
    let best = Infinity, arc = 0;
    for (let i = 1; i < P.length; i++) {
      const ax = P[i - 1][0], az = P[i - 1][1], ex = P[i][0] - ax, ez = P[i][1] - az, l2 = ex * ex + ez * ez || 1e-9;
      let t = ((x - ax) * ex + (z - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = (x - ax - ex * t) ** 2 + (z - az - ez * t) ** 2;
      if (d < best) { best = d; arc = chain.cum[i - 1] + Math.sqrt(l2) * t; }
    }
    const u = arc / chain.total;
    return chain.h0 + (chain.h1 - chain.h0) * u + Math.min(1.2, chain.total * 0.005) * 4 * u * (1 - u);
  }
  // Road bridge edge: deck height per (densified) vertex.
  function roadBridgeYs(e) {
    densifyEdge(e, 4);
    const n = e.cum.length, ys = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = e.pts[k * 2], z = e.pts[k * 2 + 1], g = groundAt(ctx, x, z);
      const exp = e.line.chain ? Math.max(g, chainY(e.line.chain, x, z)) : g;
      const hits = deckHits(x, z, g);
      ys[k] = hits.length ? closest(hits, exp) : exp - g < 1 ? g : exp;
    }
    return ys;
  }
  // Pedestrian bridge edge: deck heights; points that miss the deck (OSM sidewalks drawn beside the carriageway)
  // are pulled sideways onto it. Short gaps (e.g. where a mapped sidewalk runs past the end of the deck) are
  // bridged by interpolating height and sideways shift; returns null when a long part of the edge has no deck.
  function pedBridgeYs(e) {
    densifyEdge(e, 3);
    const n = e.cum.length, ys = new Float32Array(n);
    const xs = Array.from({ length: n }, (_, k) => e.pts[k * 2]), zs = Array.from({ length: n }, (_, k) => e.pts[k * 2 + 1]);
    const ox = new Float32Array(n), oz = new Float32Array(n), known = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const x = xs[k], z = zs[k], g = groundAt(ctx, x, z);
      const exp = e.line.chain ? Math.max(g, chainY(e.line.chain, x, z)) : g;
      const hits = deckHits(x, z, g);
      known[k] = 1;
      if (hits.length) { ys[k] = closest(hits, exp); continue; }
      if (exp - g < 0.8) { ys[k] = g; continue; }
      // lateral search (both sides) for the nearest deck, then step 1.3 m further onto it
      const k0 = Math.max(0, k - 1), k1 = Math.min(n - 1, k + 1);
      let tx = e.pts[k1 * 2] - e.pts[k0 * 2], tz = e.pts[k1 * 2 + 1] - e.pts[k0 * 2 + 1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      let found = null;
      for (let d = 0.5; d <= 12 && !found; d += 0.5) {
        for (const sd of [1, -1]) {
          const px = x - tz * d * sd, pz = z + tx * d * sd, pg = groundAt(ctx, px, pz);
          const h = deckHits(px, pz, pg);
          if (!h.length) continue;
          const y = closest(h, exp);
          if (Math.abs(y - exp) > 6) continue;
          const qx = x - tz * (d + 1.3) * sd, qz = z + tx * (d + 1.3) * sd;
          const h2 = deckHits(qx, qz, groundAt(ctx, qx, qz));
          found = h2.length ? [qx, qz, closest(h2, exp)] : [px, pz, y];
          break;
        }
      }
      if (!found) { known[k] = 0; continue; }
      ox[k] = found[0] - x; oz[k] = found[1] - z; ys[k] = found[2];
    }
    // fill the gaps: interpolate (height, sideways shift) between known neighbours; clamp at the edge ends
    let moved = false;
    for (let k = 0; k < n;) {
      if (known[k]) { k++; continue; }
      let j = k; while (j < n && !known[j]) j++;
      const a = k - 1, c = j < n ? j : -1;
      if (a < 0 && c < 0) return null;
      const s0 = a >= 0 ? e.cum[a] : e.cum[k], s1 = c >= 0 ? e.cum[c] : e.cum[j - 1];
      if (s1 - s0 > 16) return null;
      for (let m = k; m < j; m++) {
        const t = a < 0 ? 1 : c < 0 ? 0 : (e.cum[m] - s0) / Math.max(1e-6, s1 - s0);
        const A = a >= 0 ? a : c, C = c >= 0 ? c : a;
        ys[m] = ys[A] + (ys[C] - ys[A]) * t; ox[m] = ox[A] + (ox[C] - ox[A]) * t; oz[m] = oz[A] + (oz[C] - oz[A]) * t;
      }
      k = j;
    }
    for (let k = 0; k < n; k++) if (ox[k] || oz[k]) { xs[k] += ox[k]; zs[k] += oz[k]; moved = true; }
    if (moved) setEdgePoints(e, xs, zs);
    return ys;
  }

  // ------------------------------------------------------------------ building footprints (walls people must not cross)
  const BG = 32, bGrid = new Map();
  const bk = (i, j) => i * 100003 + j;
  const solid = data.buildings.filter((bd) => !bd.hidden && bd.type !== 'roof' && (bd.minHeight || 0) < 2 && bd.footprint?.length > 2).map((bd) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of bd.footprint) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    return { fp: bd.footprint, holes: bd.holes || [], x0, x1, z0, z1 };
  });
  solid.forEach((s, idx) => {
    for (let i = Math.floor(s.x0 / BG); i <= Math.floor(s.x1 / BG); i++) for (let j = Math.floor(s.z0 / BG); j <= Math.floor(s.z1 / BG); j++) {
      const k = bk(i, j); let a = bGrid.get(k); if (!a) bGrid.set(k, a = []); a.push(idx);
    }
  });
  mark('footprints');
  // the solid footprint containing (x, z) by more than 0.3 m, or null
  function buildingAt(x, z) {
    if (!(mask.at(x, z) & M.BUILDING)) return null;
    const arr = bGrid.get(bk(Math.floor(x / BG), Math.floor(z / BG)));
    if (!arr) return null;
    for (const idx of arr) {
      const s = solid[idx];
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      if (!pointInRing(x, z, s.fp) || s.holes.some((h) => pointInRing(x, z, h))) continue;
      if (distToRing(x, z, s.fp) > 0.3) return s;
    }
    return null;
  }
  // nearest point on the footprint outline, then 0.6 m further out
  function pushOut(x, z, r) {
    let best = Infinity, px = x, pz = z;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const ax = r[j][0], az = r[j][1], ex = r[i][0] - ax, ez = r[i][1] - az, l2 = ex * ex + ez * ez || 1e-9;
      let t = ((x - ax) * ex + (z - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t, qz = az + ez * t, d = (qx - x) ** 2 + (qz - z) ** 2;
      if (d < best) { best = d; px = qx; pz = qz; }
    }
    const d = Math.sqrt(best) || 1;
    return [px + ((px - x) / d) * 0.6, pz + ((pz - z) / d) * 0.6];
  }
  // Keep a path out of buildings: where it grazes a footprint (≤ 3.5 m deep) it is pushed out to run along the wall;
  // where it goes deeper it is cut (the pieces end at the wall).
  // true if any of the 0.75 m samples splitOutside() takes along the path lies inside a solid footprint
  function touchesBuilding(pts) {
    if (buildingAt(pts[0][0], pts[0][1])) return true;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.75));
      for (let j = 1; j <= k; j++) {
        const x = ax + ((bx - ax) * j) / k, z = az + ((bz - az) * j) / k;
        if ((mask.at(x, z) & M.BUILDING) && buildingAt(x, z)) return true;
      }
    }
    return false;
  }
  function splitOutside(pts) {
    if (!touchesBuilding(pts)) return [pts];
    const sx = [], sz = [], sv = [], sb = [];
    const add = (x, z, v) => { sx.push(x); sz.push(z); sv.push(v); sb.push(buildingAt(x, z)); };
    add(pts[0][0], pts[0][1], 1);
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.75));
      for (let j = 1; j <= k; j++) add(ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k, j === k ? 1 : 0);
    }
    const n = sx.length;
    const mode = new Uint8Array(n); // 0 outside · 1 pushed out · 2 cut
    let touched = false;
    for (let k = 0; k < n;) {
      if (!sb[k]) { k++; continue; }
      touched = true;
      let j = k, maxD = 0;
      while (j < n && sb[j]) { maxD = Math.max(maxD, distToRing(sx[j], sz[j], sb[j].fp)); j++; }
      let push = maxD <= 3.5;
      const qs = [];
      if (push) {
        for (let m = k; m < j; m++) {
          const q = pushOut(sx[m], sz[m], sb[m].fp);
          if (buildingAt(q[0], q[1])) { push = false; break; }
          qs.push(q);
        }
      }
      for (let m = k; m < j; m++) {
        mode[m] = push ? 1 : 2;
        if (push) { sx[m] = qs[m - k][0]; sz[m] = qs[m - k][1]; }
      }
      k = j;
    }
    if (!touched) return [pts];
    const runs = [];
    let cur = null;
    for (let k = 0; k < n; k++) {
      if (mode[k] === 2) { if (cur) runs.push(cur); cur = null; continue; }
      const keep = mode[k] === 1 || sv[k] || k === 0 || k === n - 1 || mode[k - 1] !== 0 || (k + 1 < n && mode[k + 1] !== 0);
      if (!cur) cur = [];
      if (keep) cur.push([sx[k], sz[k]]);
    }
    if (cur) runs.push(cur);
    return runs.filter((r) => r.length >= 2 && polylineLength(r) > 1.5);
  }

  // ================================================================== PEDESTRIANS
  const pedLines = [];
  let cutPaths = 0;
  const pedBridgeWays = data.paths.filter((p) => p.bridge && !p.indoor && !p.tunnel && p.points.length > 1);
  const pedChains = chainBridgeWays(pedBridgeWays);
  for (const p of data.paths) {
    if (p.indoor || p.tunnel || p.points.length < 2) continue;
    for (const run of clip(p.points)) {
      const pieces = p.covered ? [run] : splitOutside(run);
      if (pieces.length !== 1 || pieces[0].length !== run.length) cutPaths++;
      for (const pts of pieces) pedLines.push({ pts, id: p.id, bridge: p.bridge, width: p.width || 2, type: p.type, chain: p.bridge ? pedChains.get(p.id) : null });
    }
  }
  mark('pedLines');
  const pedNet = buildNetwork(pedLines, { snap: 1.6, minComponent: 150 });
  mark('pedNet');
  let pedNoDeck = 0;
  for (const e of pedNet.edges) {
    const mid = Math.floor(e.cum.length / 2);
    e.campus = !!(mask.at(e.pts[mid * 2], e.pts[mid * 2 + 1]) & M.CAMPUS);
    e.ys = null;
    if (e.line.bridge) {
      e.ys = pedBridgeYs(e);
      if (!e.ys) { e.dead = true; pedNoDeck++; }
    }
    e.halfW = Math.max(0.35, Math.min(1.1, e.line.width / 2 - 0.3));
    const n = e.cum.length;
    e.yA = e.ys ? e.ys[0] : groundAt(ctx, e.pts[0], e.pts[1]);
    e.yB = e.ys ? e.ys[n - 1] : groundAt(ctx, e.pts[n * 2 - 2], e.pts[n * 2 - 1]);
  }
  const pedEdges = pedNet.edges;
  mark('pedDecks');
  // busy sidewalks: shops, cafés and restaurants nearby (Walnut St, Penn Ave, Craig St, Forbes…) draw more walkers
  const BUSY = new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'bank', 'library', 'hotel', 'atm', 'museum', 'school']);
  const busyGrid = new Map();
  const TK = 64, tk = (x, z) => Math.floor(x / TK) * 100003 + Math.floor(z / TK);
  for (const p of data.pois) if (BUSY.has(p.type)) { const k = tk(p.x, p.z); busyGrid.set(k, (busyGrid.get(k) || 0) + 1); }
  const busyAt = (x, z) => {
    let n = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) n += busyGrid.get(tk(x + di * TK, z + dj * TK)) || 0;
    return n;
  };
  const pedW = new Float32Array(pedEdges.length);
  const pedTiles = new Map();          // 64 m tile → edge indices (spawning near the camera)
  let pedWMax = 0;
  pedEdges.forEach((e, i) => {
    if (e.dead) return;
    const mid = Math.floor(e.cum.length / 2), mx = e.pts[mid * 2], mz = e.pts[mid * 2 + 1];
    const w = (e.campus ? 3 : 1) * (1 + Math.min(3, busyAt(mx, mz) * 0.35)) * (e.line.type === 'steps' ? 0.5 : 1);
    pedW[i] = w; if (w > pedWMax) pedWMax = w;
    const k = tk(mx, mz); let a = pedTiles.get(k); if (!a) pedTiles.set(k, a = []); a.push(i);
  });
  const spawnable = pedEdges.map((e) => (e.dead ? 0 : e.len * (e.campus ? 7 : 1)));
  const spawnCum = new Float64Array(spawnable.length);
  spawnable.reduce((s, w, i) => (spawnCum[i] = s + w), 0);
  const spawnTotal = spawnCum[spawnCum.length - 1] || 0;
  const pickSpawnEdge = () => {
    const r = rng() * spawnTotal;
    let lo = 0, hi = spawnCum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (spawnCum[mid] < r) lo = mid + 1; else hi = mid; }
    return lo;
  };

  const npc = Math.max(0, q.npcCount ?? 120);
  // standing groups on The Cut
  const cut = data.areas.find((a) => a.name === 'The Cut');
  const groups = [];
  if (cut && npc > 20) {
    const bb = cut.polygon.reduce((o, p) => [Math.min(o[0], p[0]), Math.min(o[1], p[1]), Math.max(o[2], p[0]), Math.max(o[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
    let tries = 0;
    while (groups.length < 4 && tries++ < 500) {
      const x = bb[0] + rng() * (bb[2] - bb[0]), z = bb[1] + rng() * (bb[3] - bb[1]);
      if (!pointInRing(x, z, cut.polygon) || !mask.free(x, z, 3, M.PATH | M.BUILDING)) continue;
      if (groups.some((g) => Math.hypot(g.x - x, g.z - z) < 18)) continue;
      if (Math.hypot(x - 65, z + 16) < 10) continue; // Scotty statue
      groups.push({ x, z, n: 3 + Math.floor(rng() * 3) });
    }
  }
  const standers = [];
  for (const g of groups) {
    const r = 0.75 + g.n * 0.08;
    for (let k = 0; k < g.n; k++) {
      const a = (k / g.n) * Math.PI * 2 + rng() * 0.4;
      const x = g.x + Math.cos(a) * r, z = g.z + Math.sin(a) * r;
      standers.push({ x, z, yaw: Math.atan2(g.x - x, g.z - z) + (rng() - 0.5) * 0.4 });
    }
  }
  const nWalk = spawnTotal > 0 ? Math.max(0, npc - standers.length) : 0;
  const nPeople = nWalk + standers.length;

  const pGeo = personGeometry();
  const pMesh = new THREE.InstancedMesh(pGeo, createPersonMaterial(shared), Math.max(1, nPeople));
  pMesh.count = 0;
  pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pMesh.customDepthMaterial = createPersonDepthMaterial(shared);
  pMesh.castShadow = shadows; pMesh.receiveShadow = true;
  pMesh.frustumCulled = false;
  pMesh.name = 'life:pedestrians';
  // per-person master data; the mesh attributes hold only the instances drawn this frame
  const capP = Math.max(1, nPeople);
  const mShirt = new Float32Array(capP * 3), mPants = new Float32Array(capP * 3), mLook = new Float32Array(capP * 4), mAnim = new Float32Array(capP * 3);
  for (let i = 0; i < nPeople; i++) randomOutfit(rng, mShirt, mPants, mLook, i * 3, i * 4);
  const pAttr = {
    shirt: new THREE.InstancedBufferAttribute(new Float32Array(capP * 3), 3).setUsage(THREE.DynamicDrawUsage),
    pants: new THREE.InstancedBufferAttribute(new Float32Array(capP * 3), 3).setUsage(THREE.DynamicDrawUsage),
    look: new THREE.InstancedBufferAttribute(new Float32Array(capP * 4), 4).setUsage(THREE.DynamicDrawUsage),
    anim: new THREE.InstancedBufferAttribute(new Float32Array(capP * 3), 3).setUsage(THREE.DynamicDrawUsage),
  };
  pGeo.setAttribute('iShirt', pAttr.shirt); pGeo.setAttribute('iPants', pAttr.pants);
  pGeo.setAttribute('iLook', pAttr.look); pGeo.setAttribute('iAnim', pAttr.anim);
  const pSlotOwner = new Int32Array(capP).fill(-1);
  const pEdge = new Int32Array(nWalk), pDir = new Int8Array(nWalk), pHint = new Int32Array(nWalk).fill(1);
  const pS = new Float32Array(nWalk), pSpeed = new Float32Array(nWalk), pLat = new Float32Array(nWalk);
  const pYaw = new Float32Array(nPeople), pScale = new Float32Array(nPeople);
  const pX = new Float32Array(nWalk), pZ = new Float32Array(nWalk);   // current positions (debug / probes)
  // Walkers that were not drawn last frame (out of view, casting no shadow into it) are simulated at a lower rate
  // with the accumulated time — nobody sees them move. Each frame a cheap check at their last position still
  // catches the ones the camera turned towards: those are updated (and drawn) right away.
  const pY = new Float32Array(nWalk), pAcc = new Float32Array(nWalk), pDrawn = new Uint8Array(nWalk).fill(1);
  const standMat = new Float32Array(Math.max(1, standers.length) * 16);
  const tmpP0 = { x: 0, z: 0, dx: 0, dz: 0, t: 0 };
  for (let i = 0; i < nWalk; i++) {
    const e = pickSpawnEdge();
    pEdge[i] = e; pDir[i] = rng() < 0.5 ? 1 : -1;
    pS[i] = rng() * pedEdges[e].len;
    pSpeed[i] = 1.15 + rng() * 0.45;
    pLat[i] = 0.35 + rng() * 0.65;
    pScale[i] = 0.9 + rng() * 0.16;
    const stride = 0.72 * pScale[i];                       // metres per step
    mAnim[i * 3] = rng() * 6.28; mAnim[i * 3 + 1] = loopHz(pSpeed[i] / (2 * stride)); mAnim[i * 3 + 2] = 1;
    pYaw[i] = NaN;
    edgePoint(pedEdges[e], pS[i], tmpP0, 1); pX[i] = tmpP0.x; pZ[i] = tmpP0.z;
  }
  const standPos = new Float32Array(Math.max(1, standers.length) * 3);
  standers.forEach((s, k) => {
    const i = nWalk + k;
    pScale[i] = 0.9 + rng() * 0.16;
    mAnim[i * 3] = rng() * 6.28; mAnim[i * 3 + 1] = loopHz(0.12 + rng() * 0.1); mAnim[i * 3 + 2] = 0.1;
    pYaw[i] = s.yaw;
    const y = groundAt(ctx, s.x, s.z);
    standPos[k * 3] = s.x; standPos[k * 3 + 1] = y; standPos[k * 3 + 2] = s.z;
    composeMatrix(standMat, k * 16, s.x, y, s.z, s.yaw, pScale[i], pScale[i], pScale[i]);
  });
  group.add(pMesh);

  const tmpP = { x: 0, z: 0, dx: 0, dz: 0, t: 0 };
  const endY = (e, node) => (e.a === node ? e.yA : e.yB);
  function chooseNext(node, fromEdge, tx, tz) {
    const list = pedNet.nodes[node].edges;
    if (list.length === 1) return list[0];
    const yArr = endY(pedEdges[fromEdge], node);
    let total = 0;
    const W = chooseNext.w || (chooseNext.w = new Float32Array(64));
    for (let k = 0; k < list.length && k < 64; k++) {
      const ei = list[k];
      const e = pedEdges[ei];
      let w = 0;
      // skip dead edges and edges that leave this node at another level (bridge deck vs the ground below)
      if (ei !== fromEdge && !e.dead && Math.abs(endY(e, node) - yArr) < 1.5) {
        // direction leaving the node
        const fwd = e.a === node;
        const i0 = fwd ? 0 : e.cum.length - 1, i1 = fwd ? 1 : e.cum.length - 2;
        let dx = e.pts[i1 * 2] - e.pts[i0 * 2], dz = e.pts[i1 * 2 + 1] - e.pts[i0 * 2 + 1];
        const l = Math.sqrt(dx * dx + dz * dz) || 1; dx /= l; dz /= l;
        const straight = dx * tx + dz * tz;
        w = (e.campus ? 3 : 1) * (0.35 + Math.max(0, straight) * 1.3) * (e.line.type === 'steps' ? 0.6 : 1);
      }
      W[k] = w; total += w;
    }
    if (total <= 0) return fromEdge;
    let r = rng() * total;
    for (let k = 0; k < list.length && k < 64; k++) { r -= W[k]; if (r <= 0) return list[k]; }
    return list[list.length - 1];
  }

  // ------------------------------------------------------------------ per-frame culling
  const cull = createCuller();
  const cam = { x: 0, y: 0, z: 0 };
  const focus = { x: 0, z: 0 };        // what the camera looks at (orbit target / a point ahead): NPCs gather here
  const PEOPLE_R2 = (q.level === 'low' ? 220 : 350) ** 2, PEOPLE_SHADOW_R2 = 120 ** 2;
  const CAR_NEAR2 = 120 ** 2, CAR_FAR2 = (q.level === 'low' ? 420 : 600) ** 2;

  function putPerson(c, i) {
    if (pSlotOwner[c] === i) return;
    pSlotOwner[c] = i;
    const a3 = pAttr.shirt.array, b3 = pAttr.pants.array, l4 = pAttr.look.array, n3 = pAttr.anim.array;
    a3[c * 3] = mShirt[i * 3]; a3[c * 3 + 1] = mShirt[i * 3 + 1]; a3[c * 3 + 2] = mShirt[i * 3 + 2];
    b3[c * 3] = mPants[i * 3]; b3[c * 3 + 1] = mPants[i * 3 + 1]; b3[c * 3 + 2] = mPants[i * 3 + 2];
    n3[c * 3] = mAnim[i * 3]; n3[c * 3 + 1] = mAnim[i * 3 + 1]; n3[c * 3 + 2] = mAnim[i * 3 + 2];
    l4[c * 4] = mLook[i * 4]; l4[c * 4 + 1] = mLook[i * 4 + 1]; l4[c * 4 + 2] = mLook[i * 4 + 2]; l4[c * 4 + 3] = mLook[i * 4 + 3];
    pAttr.dirty = true;
  }
  const personShown = (x, y, z) => {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > PEOPLE_R2) return false;
    return cull.inView(x, y + 0.9, z, 1.5) || (shadows && d2 < PEOPLE_SHADOW_R2 && cull.inShadow(x, y, z, 3));
  };

  // Walkers far from what the camera looks at are moved to a sidewalk / path near it (rate-limited, never popping
  // into view close by), so the crowd follows the viewer around the 4 km map instead of thinning out over it.
  const PED_KEEP = q.level === 'low' ? 260 : 380, PED_SPAWN = [45, q.level === 'low' ? 230 : 330];
  // out-of-view NPCs: simulated every npcSlow-th frame (CPU degrade level 1+: every 4th)
  let npcFrame = 0, npcSlow = 2;
  ctx.events?.on?.('perf:degrade', (ev) => { npcSlow = (Number(ev?.cpu) || 0) >= 1 ? 4 : 2; });
  const recycle = [];
  const P_ATTRS = [pAttr.shirt, pAttr.pants, pAttr.look, pAttr.anim]; // (per-frame upload ranges: no array literals in the loop)
  function respawnPed(i) {
    for (let tries = 0; tries < 14; tries++) {
      const a = rng() * Math.PI * 2, r = PED_SPAWN[0] + Math.sqrt(rng()) * (PED_SPAWN[1] - PED_SPAWN[0]);
      const list = pedTiles.get(tk(focus.x + Math.cos(a) * r, focus.z + Math.sin(a) * r));
      if (!list) continue;
      const ei = list[Math.floor(rng() * list.length)];
      if (rng() * pedWMax > pedW[ei]) continue;
      const e = pedEdges[ei];
      const s0 = rng() * e.len;
      edgePoint(e, s0, tmpP, 1);
      const dx = tmpP.x - cam.x, dz = tmpP.z - cam.z;
      if (dx * dx + dz * dz < 90 * 90 && cull.inView(tmpP.x, groundAt(ctx, tmpP.x, tmpP.z) + 0.9, tmpP.z, 1.5)) continue;
      pEdge[i] = ei; pDir[i] = rng() < 0.5 ? 1 : -1; pS[i] = pDir[i] > 0 ? s0 : e.len - s0; pHint[i] = 1; pYaw[i] = NaN;
      pX[i] = tmpP.x; pZ[i] = tmpP.z;
      return true;
    }
    return false;
  }
  function updatePeople(dt0) {
    const arr = pMesh.instanceMatrix.array;
    let c = 0;
    recycle.length = 0;
    npcFrame++;
    for (let i = 0; i < nWalk; i++) {
      {
        const fx = pX[i] - focus.x, fz = pZ[i] - focus.z;
        if (fx * fx + fz * fz > PED_KEEP * PED_KEEP && recycle.length < 12) { recycle.push(i); pAcc[i] = 0; pDrawn[i] = 1; continue; }
      }
      let dt = dt0;
      if (!pDrawn[i] && (npcFrame + i) % npcSlow !== 0 && pAcc[i] < 0.5 && !personShown(pX[i], pY[i], pZ[i])) { pAcc[i] += dt0; continue; }
      dt += pAcc[i]; pAcc[i] = 0;
      let e = pedEdges[pEdge[i]];
      pS[i] += pSpeed[i] * dt;
      let guard = 0;
      while (pS[i] >= e.len && guard++ < 4) {
        pS[i] -= e.len;
        const node = pDir[i] > 0 ? e.b : e.a;
        // heading when arriving
        const k = pDir[i] > 0 ? e.cum.length - 1 : 0, k2 = pDir[i] > 0 ? k - 1 : 1;
        let tx = e.pts[k * 2] - e.pts[k2 * 2], tz = e.pts[k * 2 + 1] - e.pts[k2 * 2 + 1];
        const l = Math.sqrt(tx * tx + tz * tz) || 1;
        const ne = chooseNext(node, pEdge[i], tx / l, tz / l);
        const nEdge = pedEdges[ne];
        pDir[i] = nEdge.a === node ? 1 : -1;
        if (nEdge.a === nEdge.b) pDir[i] = rng() < 0.5 ? 1 : -1;
        pEdge[i] = ne; e = nEdge; pHint[i] = 1;
      }
      const arc = pDir[i] > 0 ? pS[i] : e.len - pS[i];
      const k = edgePoint(e, arc, tmpP, pHint[i]);
      pHint[i] = k;
      const tx = tmpP.dx * pDir[i], tz = tmpP.dz * pDir[i];
      // smooth heading; the keep-right offset follows the smoothed heading so corners / U-turns don't pop
      const target = Math.atan2(tx, tz);
      if (Number.isNaN(pYaw[i])) pYaw[i] = target;
      let d = target - pYaw[i];
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      pYaw[i] += d * Math.min(1, dt * 7);
      const lat = Math.min(pLat[i], e.halfW);
      const x = tmpP.x - Math.cos(pYaw[i]) * lat, z = tmpP.z + Math.sin(pYaw[i]) * lat;
      const y = e.ys ? e.ys[k - 1] + (e.ys[k] - e.ys[k - 1]) * tmpP.t : groundAt(ctx, x, z);
      pX[i] = x; pZ[i] = z; pY[i] = y;
      if (!personShown(x, y, z)) { pDrawn[i] = 0; continue; }
      pDrawn[i] = 1;
      const s = pScale[i];
      composeMatrix(arr, c * 16, x, y, z, pYaw[i], s, s, s);
      putPerson(c++, i);
    }
    for (const i of recycle) respawnPed(i);
    for (let k = 0; k < standers.length; k++) {
      if (!personShown(standPos[k * 3], standPos[k * 3 + 1], standPos[k * 3 + 2])) continue;
      for (let j = 0; j < 16; j++) arr[c * 16 + j] = standMat[k * 16 + j];
      putPerson(c++, nWalk + k);
    }
    pMesh.count = c;
    pMesh.visible = c > 0;
    if (c) {
      pMesh.instanceMatrix.clearUpdateRanges(); pMesh.instanceMatrix.addUpdateRange(0, c * 16); pMesh.instanceMatrix.needsUpdate = true;
      if (pAttr.dirty) {
        pAttr.dirty = false;
        for (let k = 0; k < P_ATTRS.length; k++) { const a = P_ATTRS[k]; a.clearUpdateRanges(); a.addUpdateRange(0, c * a.itemSize); a.needsUpdate = true; }
      }
    }
  }

  // ================================================================== CARS
  const roadBridgeWays = data.roads.filter((r) => r.bridge && !r.tunnel && r.points.length > 1);
  const roadChains = chainBridgeWays(roadBridgeWays);
  const roadLines = [];
  for (const r of data.roads) {
    if (!ROAD_CLASS[r.type] || r.tunnel || r.points.length < 2) continue;
    for (const pts of clip(r.points)) {
      roadLines.push({ pts, id: r.id, type: r.type, name: r.name, width: r.width || 9, lanes: r.lanes, oneway: !!r.oneway, bridge: r.bridge, chain: r.bridge ? roadChains.get(r.id) : null });
    }
  }
  mark('people');
  const roadNet = buildNetwork(roadLines, { snap: 2.5, minComponent: 300 });
  const rEdges = roadNet.edges, rNodes = roadNet.nodes;
  for (const e of rEdges) {
    const L = e.line;
    e.ys = L.bridge ? roadBridgeYs(e) : null;
    e.cls = ROAD_CLASS[L.type] || 1;
    const mid = Math.floor(e.cum.length / 2);
    if (Math.hypot(e.pts[mid * 2] + 100, e.pts[mid * 2 + 1] + 60) < 700) e.cls *= 2.2;
    e.vmax = ROAD_SPEED[L.type] || 9;
    const lanes = L.lanes || (L.oneway ? Math.max(1, Math.round(L.width / 3.6)) : Math.max(2, Math.round(L.width / 3.6)));
    e.lanesPerDir = L.oneway ? lanes : Math.max(1, Math.floor(lanes / 2));
    e.laneW = L.oneway ? L.width / lanes : L.width / (e.lanesPerDir * 2);
  }
  // lane centre offset to the right of the travel direction
  const laneOffset = (e, lane) => {
    const li = Math.min(lane, e.lanesPerDir - 1);
    // lane 0 = kerb-side lane (rightmost)
    return e.line.oneway ? e.line.width / 2 - (li + 0.5) * e.laneW : (e.lanesPerDir - li - 0.5) * e.laneW;
  };
  // the road network is clipped EDGE_CLIP inside the bounds: dead ends there are map edges (respawn, no U-turn)
  const EDGE_M = EDGE_CLIP + 15;
  const nearEdge = (n) => { const nd = rNodes[n]; return nd.x < b.minX + EDGE_M || nd.x > b.maxX - EDGE_M || nd.z < b.minZ + EDGE_M || nd.z > b.maxZ - EDGE_M; };
  const canEnter = (ei, node) => { const e = rEdges[ei]; return !e.dead && (!e.line.oneway || e.a === node); };
  const carSpawnEdges = rEdges.map((e, i) => i).filter((i) => !rEdges[i].dead);
  const roadTiles = new Map();         // 64 m tile → drivable edges (respawning traffic near the camera)
  for (const i of carSpawnEdges) {
    const e = rEdges[i], mid = Math.floor(e.cum.length / 2);
    const k = tk(e.pts[mid * 2], e.pts[mid * 2 + 1]);
    let a = roadTiles.get(k); if (!a) roadTiles.set(k, a = []); a.push(i);
  }
  const busNames = ['Forbes Avenue', 'Fifth Avenue'];

  const nCars = rEdges.length ? Math.round(npc * 0.6) : 0;
  const nBus = rEdges.length ? (q.level === 'low' ? 1 : 2) : 0;
  const N = nCars + nBus;
  const cType = new Uint8Array(N);     // 0 sedan 1 suv 2 pickup 3 bus
  const cE = new Int32Array(N), cD = new Int8Array(N), cPE = new Int32Array(N), cPD = new Int8Array(N), cNE = new Int32Array(N), cND = new Int8Array(N);
  const cS = new Float32Array(N), cV = new Float32Array(N), cLane = new Uint8Array(N), cLat = new Float32Array(N), cWait = new Float32Array(N);
  const cX = new Float32Array(N), cZ = new Float32Array(N), cHX = new Float32Array(N), cHZ = new Float32Array(N), cBrake = new Float32Array(N);
  const cStopCool = new Float32Array(N), cBusName = new Int8Array(N).fill(-1);
  const cCol = new Float32Array(Math.max(1, N) * 3);
  const typeNames = ['sedan', 'suv', 'pickup', 'bus'];
  const carLen = new Float32Array(N);
  const cY = new Float32Array(N), cAcc = new Float32Array(N), cDrawn = new Uint8Array(N).fill(1);   // (see pDrawn)

  function pickNextEdge(i, node, fromEdge, hx, hz) {
    const list = rNodes[node].edges;
    let total = 0, best = -1;
    const W = pickNextEdge.w || (pickNextEdge.w = new Float32Array(32));
    const busName = cBusName[i] >= 0 ? busNames[cBusName[i]] : null;
    for (let k = 0; k < list.length && k < 32; k++) {
      const ei = list[k];
      let w = 0;
      if (ei !== fromEdge && canEnter(ei, node)) {
        const e = rEdges[ei];
        const fwd = e.a === node;
        const i0 = fwd ? 0 : e.cum.length - 1, i1 = fwd ? 1 : e.cum.length - 2;
        let dx = e.pts[i1 * 2] - e.pts[i0 * 2], dz = e.pts[i1 * 2 + 1] - e.pts[i0 * 2 + 1];
        const l = Math.sqrt(dx * dx + dz * dz) || 1; dx /= l; dz /= l;
        const straight = dx * hx + dz * hz;
        if (straight > -0.5) {
          w = e.cls * (0.25 + Math.max(0, straight) * 1.5);
          if (busName) w = e.line.name === busName ? w * 100 : 0;
        }
      }
      W[k] = w; total += w;
    }
    if (total <= 0) return -1;
    let r = rng() * total;
    for (let k = 0; k < list.length && k < 32; k++) { r -= W[k]; if (r <= 0) { best = list[k]; break; } }
    return best < 0 ? list[list.length - 1] : best;
  }
  // exit direction heading at the end of (edge, dir)
  function endHeading(ei, dir, out) {
    const e = rEdges[ei];
    const k = dir > 0 ? e.cum.length - 1 : 0, k2 = dir > 0 ? k - 1 : 1;
    const dx = e.pts[k * 2] - e.pts[k2 * 2], dz = e.pts[k * 2 + 1] - e.pts[k2 * 2 + 1], l = Math.sqrt(dx * dx + dz * dz) || 1;
    out.x = dx / l; out.z = dz / l;
  }
  const hv = { x: 0, z: 0 };
  function planNext(i) {
    const e = rEdges[cE[i]];
    const node = cD[i] > 0 ? e.b : e.a;
    endHeading(cE[i], cD[i], hv);
    const ne = pickNextEdge(i, node, cE[i], hv.x, hv.z);
    if (ne < 0) {
      // dead end: U-turn on two-way roads (not at the map edge), otherwise mark for respawn
      if (!e.line.oneway && !nearEdge(node) && cBusName[i] < 0) { cNE[i] = cE[i]; cND[i] = -cD[i]; return; }
      cNE[i] = -1; cND[i] = 0; return;
    }
    cNE[i] = ne; cND[i] = rEdges[ne].a === node ? 1 : -1;
  }
  const busCands = new Map();
  function spawnCar(i, awayFromCamera) {
    for (let tries = 0; tries < 30; tries++) {
      let ei;
      if (cBusName[i] >= 0) {
        const name = busNames[cBusName[i]];
        let cands = busCands.get(name); // (per line, made once: filtering every road edge per try was a 1–10 ms spike)
        if (!cands) busCands.set(name, (cands = carSpawnEdges.filter((k) => rEdges[k].line.name === name)));
        if (!cands.length) { cBusName[i] = -1; continue; }
        ei = cands[Math.floor(rng() * cands.length)];
      } else {
        ei = carSpawnEdges[Math.floor(rng() * carSpawnEdges.length)];
        if (tries < 25 && rng() > rEdges[ei].cls / 6.6) continue;
      }
      const e = rEdges[ei];
      const dir = e.line.oneway ? 1 : rng() < 0.5 ? 1 : -1;
      const s = rng() * e.len;
      edgePoint(e, dir > 0 ? s : e.len - s, tmpP, 1);
      if (awayFromCamera && ctx.camera) {
        const c = ctx.camera.position;
        if (Math.hypot(tmpP.x - c.x, tmpP.z - c.z) < 180 && tries < 25) continue;
      }
      cE[i] = ei; cD[i] = dir; cS[i] = s; cPE[i] = -1; cPD[i] = dir; // no previous edge yet
      cX[i] = tmpP.x; cZ[i] = tmpP.z;
      cLane[i] = rng() < 0.7 ? 0 : 1;
      cLat[i] = laneOffset(e, cLane[i]);
      cV[i] = e.vmax * 0.8; cWait[i] = 0;
      planNext(i);
      return true;
    }
    return false;
  }

  // Traffic far from what the camera looks at re-enters on a road near it (not in plain view close by).
  const CAR_KEEP = q.level === 'low' ? 450 : 650, CAR_SPAWN = [130, q.level === 'low' ? 380 : 520];
  function spawnCarNear(i) {
    for (let tries = 0; tries < 16; tries++) {
      const a = rng() * Math.PI * 2, r = CAR_SPAWN[0] + Math.sqrt(rng()) * (CAR_SPAWN[1] - CAR_SPAWN[0]);
      const list = roadTiles.get(tk(focus.x + Math.cos(a) * r, focus.z + Math.sin(a) * r));
      if (!list) continue;
      const ei = list[Math.floor(rng() * list.length)];
      const e = rEdges[ei];
      if (rng() * 6.6 > e.cls) continue;
      const dir = e.line.oneway ? 1 : rng() < 0.5 ? 1 : -1;
      const s0 = rng() * e.len;
      edgePoint(e, dir > 0 ? s0 : e.len - s0, tmpP, 1);
      const dx = tmpP.x - cam.x, dz = tmpP.z - cam.z;
      if (dx * dx + dz * dz < 150 * 150 && cull.inView(tmpP.x, groundAt(ctx, tmpP.x, tmpP.z) + 1, tmpP.z, 3)) continue;
      cE[i] = ei; cD[i] = dir; cS[i] = s0; cPE[i] = -1; cPD[i] = dir;
      cLane[i] = rng() < 0.7 ? 0 : 1;
      cLat[i] = laneOffset(e, cLane[i]);
      cV[i] = e.vmax * 0.8; cWait[i] = 0;
      cX[i] = tmpP.x; cZ[i] = tmpP.z;
      planNext(i);
      return true;
    }
    return false;
  }

  // Point on the route at distance s (relative to the start of the current edge, in travel direction).
  const rp = { x: 0, z: 0, e: 0, k: 1, t: 0 };
  function routePoint(i, s) {
    let ei = cE[i], dir = cD[i];
    const e0 = rEdges[ei];
    if (s < 0 && cPE[i] < 0) {
      s = 0; // freshly spawned: clamp the look-behind to the start of the current edge
    } else if (s < 0) {
      const pe = rEdges[cPE[i]];
      ei = cPE[i]; dir = cPD[i];
      s = Math.max(0, pe.len + s);
    } else if (s > e0.len && cNE[i] >= 0) {
      s -= e0.len; ei = cNE[i]; dir = cND[i];
      if (s > rEdges[ei].len) s = rEdges[ei].len;
    } else if (s > e0.len) s = e0.len;
    const e = rEdges[ei];
    rp.k = edgePoint(e, dir > 0 ? s : e.len - s, tmpP, 1);
    rp.x = tmpP.x; rp.z = tmpP.z; rp.e = ei; rp.t = tmpP.t;
    return rp;
  }
  function routeY(x, z) {
    const e = rEdges[rp.e];
    return e.ys ? e.ys[rp.k - 1] + (e.ys[rp.k] - e.ys[rp.k - 1]) * rp.t : groundAt(ctx, x, z);
  }

  // meshes: full model (near, casts shadows) + low-poly LOD (far, no shadow) per type; the bus has one LOD
  const carMat = createCarMaterial({ lights: true });
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    if (i >= nCars) { cType[i] = 3; cBusName[i] = (i - nCars) % 2; }
    else { const r = rng(); cType[i] = r < 0.55 ? 0 : r < 0.88 ? 1 : 2; }
    counts[cType[i]]++;
    carLen[i] = CAR_DIMS[typeNames[cType[i]]].length;
  }
  const vNear = [], vFar = [];
  const mkVeh = (t, low) => {
    const m = createVehicleMesh(typeNames[t], carMat.material, counts[t], low);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.geometry.attributes.iBrake.setUsage(THREE.DynamicDrawUsage);
    m.geometry.attributes.iColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = shadows && !low;
    m.count = 0; m.visible = false;
    m.userData.owner = new Int32Array(counts[t]).fill(-1);
    group.add(m);
    return m;
  };
  for (let t = 0; t < 4; t++) {
    vNear.push(counts[t] ? mkVeh(t, false) : null);
    vFar.push(counts[t] && t < 3 ? mkVeh(t, true) : null);
  }
  if (vNear[3]) carMat.uniforms.uAccent.value.set('#e3a82b');
  const busCol = new THREE.Color('#3f6d9a');
  for (let i = 0; i < N; i++) {
    if (cType[i] === 3) { cCol[i * 3] = busCol.r; cCol[i * 3 + 1] = busCol.g; cCol[i * 3 + 2] = busCol.b; }
    else randomPaint(rng(), cCol, i * 3);
    spawnCar(i, false);
  }
  mark('cars');
  // headlight pools (night)
  const hl = createLightPoolMaterial('#fff1d6', 'beam');
  const hlGeo = new THREE.PlaneGeometry(1, 1); hlGeo.rotateX(-Math.PI / 2);
  const hlMesh = new THREE.InstancedMesh(hlGeo, hl.material, Math.max(1, N));
  hlMesh.count = 0; hlMesh.frustumCulled = false; hlMesh.visible = false; hlMesh.renderOrder = 2;
  hlMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  hlMesh.name = 'life:headlightPools';
  group.add(hlMesh);

  const busStops = (ctx.props?.busStops || []).map((s) => [s.x, s.z]);
  const WIN = 4.0;
  const fillN = [0, 0, 0, 0], fillF = [0, 0, 0, 0];
  function flushVehicles(m, c) {
    if (!m) return;
    m.count = c; m.visible = c > 0;
    if (!c) return;
    const im = m.instanceMatrix, br = m.geometry.attributes.iBrake;
    im.clearUpdateRanges(); im.addUpdateRange(0, c * 16); im.needsUpdate = true;
    br.clearUpdateRanges(); br.addUpdateRange(0, c); br.needsUpdate = true;
    if (m.userData.colDirty) {
      m.userData.colDirty = false;
      const ca = m.geometry.attributes.iColor;
      ca.clearUpdateRanges(); ca.addUpdateRange(0, c * 3); ca.needsUpdate = true;
    }
  }
  // spatial hash of the cars (built once per frame) for the car-following check — it was an all-pairs loop
  const CAR_CELL = 40, CAR_HASH = 1023;
  const carHead = new Int32Array(CAR_HASH + 1), carNext = new Int32Array(Math.max(1, N));
  const carHash = (gx, gz) => ((gx * 73856093) ^ (gz * 19349663)) & CAR_HASH;
  function updateCars(dt0) {
    const night = ctx.env?.state?.nightFactor ?? 0;
    for (let t = 0; t < 4; t++) { fillN[t] = 0; fillF[t] = 0; }
    carHead.fill(-1);
    for (let j = 0; j < N; j++) { const h = carHash(Math.floor(cX[j] / CAR_CELL), Math.floor(cZ[j] / CAR_CELL)); carNext[j] = carHead[h]; carHead[h] = j; }
    let nPool = 0, moved = 0;
    for (let i = 0; i < N; i++) {
      if (cType[i] !== 3 && moved < 6) {
        const fx = cX[i] - focus.x, fz = cZ[i] - focus.z;
        if (fx * fx + fz * fz > CAR_KEEP * CAR_KEEP && spawnCarNear(i)) { moved++; cAcc[i] = 0; cDrawn[i] = 1; }
      }
      let dt = dt0;
      if (!cDrawn[i] && (npcFrame + i) % npcSlow !== 0 && cAcc[i] < 0.5) {
        // out of view last frame and not due: skipped unless it would be drawn at its last position now
        const bus = cType[i] === 3, x = cX[i], y = cY[i], z = cZ[i];
        const ddx = x - cam.x, ddy = y - cam.y, ddz = z - cam.z, d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        const vis = d2 < CAR_FAR2 && cull.inView(x, y + 1, z, bus ? 7.5 : 3.5);
        if (!vis && !(d2 < CAR_NEAR2 && shadows && cull.inShadow(x, y, z, bus ? 9 : 5))) { cAcc[i] += dt0; continue; }
      }
      dt += cAcc[i]; cAcc[i] = 0;
      const e = rEdges[cE[i]];
      // ---- target speed: road class, curvature ahead, car ahead, bus stops
      let vt = cType[i] === 3 ? Math.min(e.vmax, 10.5) : e.vmax;
      const p1 = routePoint(i, cS[i] + 16); const ax = p1.x, az = p1.z;
      const p2 = routePoint(i, cS[i] + 26);
      const fx = p2.x - ax, fz = p2.z - az, fl = Math.sqrt(fx * fx + fz * fz) || 1;
      const curve = 1 - (fx * cHX[i] + fz * cHZ[i]) / fl;           // 0 straight … 2 reverse
      vt *= Math.max(0.3, 1 - curve * 1.1);
      const hx = cHX[i], hz = cHZ[i];
      const xi = cX[i], zi = cZ[i], li = carLen[i];
      // cars ahead within 28 m: only the 3×3 grid cells around (see carGrid; cells are 40 m, so a car that moved a
      // little since the grid was built is still found)
      const gx = Math.floor(xi / CAR_CELL), gz = Math.floor(zi / CAR_CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        for (let j = carHead[carHash(gx + ox, gz + oz)]; j >= 0; j = carNext[j]) {
          if (j === i) continue;
          const dx = cX[j] - xi, dz = cZ[j] - zi;
          const along = dx * hx + dz * hz;
          if (along <= 0 || along > 28) continue;
          const side = Math.abs(dx * hz - dz * hx);
          if (side > 1.8 || hx * cHX[j] + hz * cHZ[j] < 0.3) continue;
          const gap = along - (carLen[j] + li) / 2 - 2.5;
          vt = Math.min(vt, Math.max(0, gap * 0.9));
        }
      }
      if (cType[i] === 3) {
        cStopCool[i] = Math.max(0, cStopCool[i] - dt);
        if (cWait[i] > 0) { cWait[i] -= dt; vt = 0; if (cWait[i] <= 0) cStopCool[i] = 25; }
        else if (cStopCool[i] <= 0) {
          for (let s = 0; s < busStops.length; s++) {
            const dx = busStops[s][0] - xi, dz = busStops[s][1] - zi;
            const along = dx * hx + dz * hz, right = -dx * hz + dz * hx;
            if (along > 0 && along < 12 && right < -1 && right > -9) { vt = Math.min(vt, along * 0.6); if (along < 3) cWait[i] = 9; }
          }
        }
      }
      const dv = vt - cV[i];
      cV[i] += dv > 0 ? Math.min(dv, 2.2 * dt) : Math.max(dv, -6 * dt);
      cBrake[i] = dv < -1.2 ? 1 : cBrake[i] * 0.9;
      cS[i] += cV[i] * dt;
      // ---- edge transitions
      for (let guard = 0; guard < 4 && cS[i] >= rEdges[cE[i]].len; guard++) {
        if (cNE[i] < 0) { if (!spawnCar(i, true)) cS[i] = 0; break; }
        cS[i] -= rEdges[cE[i]].len;
        cPE[i] = cE[i]; cPD[i] = cD[i];
        cE[i] = cNE[i]; cD[i] = cND[i];
        if (cLane[i] >= rEdges[cE[i]].lanesPerDir) cLane[i] = rEdges[cE[i]].lanesPerDir - 1;
        planNext(i);
      }
      const ce = rEdges[cE[i]];
      // ---- smoothed position (box filter along the route) and heading
      let sx = 0, sz = 0;
      for (let k = -2; k <= 2; k++) { const p = routePoint(i, cS[i] + k * WIN * 0.5); sx += p.x; sz += p.z; }
      sx /= 5; sz /= 5;
      const pa = routePoint(i, cS[i] + WIN * 0.8); const ahx = pa.x, ahz = pa.z;
      const pb = routePoint(i, cS[i] - WIN * 0.8);
      let hx2 = ahx - pb.x, hz2 = ahz - pb.z;
      const hl2 = Math.sqrt(hx2 * hx2 + hz2 * hz2) || 1; hx2 /= hl2; hz2 /= hl2;
      cHX[i] = hx2; cHZ[i] = hz2;
      const latT = laneOffset(ce, cLane[i]);
      cLat[i] += (latT - cLat[i]) * Math.min(1, dt * 1.5);
      const x = sx - hz2 * cLat[i], z = sz + hx2 * cLat[i];
      cX[i] = x; cZ[i] = z;
      routePoint(i, cS[i]);
      const y = routeY(x, z);
      cY[i] = y;
      // ---- visibility / LOD (only instances in view, or casting a shadow into it, are drawn)
      const bus = cType[i] === 3;
      const ddx = x - cam.x, ddy = y - cam.y, ddz = z - cam.z, d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      const vis = d2 < CAR_FAR2 && cull.inView(x, y + 1, z, bus ? 7.5 : 3.5);
      const near = d2 < CAR_NEAR2 && (vis || (shadows && cull.inShadow(x, y, z, bus ? 9 : 5)));
      if (!near && !vis) { cDrawn[i] = 0; continue; }
      cDrawn[i] = 1;
      const t = cType[i];
      const m = near || bus ? vNear[t] : vFar[t];
      const slot = near || bus ? fillN[t]++ : fillF[t]++;
      // pitch from ground height ahead/behind
      const half = bus ? 4 : 1.6;
      routePoint(i, cS[i] + half); const yf = routeY(x + hx2 * half, z + hz2 * half);
      routePoint(i, cS[i] - half); const yb = routeY(x - hx2 * half, z - hz2 * half);
      const slope = (yf - yb) / (2 * half);
      let nx = -hx2 * slope, ny = 1, nz = -hz2 * slope;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= nl; ny /= nl; nz /= nl;
      composeMatrix(m.instanceMatrix.array, slot * 16, x, (y + (yf + yb) / 2) / 2, z, Math.atan2(hx2, hz2), 1, 1, 1, nx, ny, nz);
      m.geometry.attributes.iBrake.array[slot] = cBrake[i];
      const own = m.userData.owner;
      if (own[slot] !== i) {
        own[slot] = i;
        const ca = m.geometry.attributes.iColor;
        ca.array[slot * 3] = cCol[i * 3]; ca.array[slot * 3 + 1] = cCol[i * 3 + 1]; ca.array[slot * 3 + 2] = cCol[i * 3 + 2];
        m.userData.colDirty = true;
      }
      // headlight pool 7 m ahead
      if (night > 0.02 && vis) {
        const reach = bus ? 8.5 : 7.5, px = x + hx2 * reach, pz = z + hz2 * reach;
        // canvas top row (bright end, flipY → uv v=1) lands at local -Z of the rotated plane = towards the car
        composeMatrix(hlMesh.instanceMatrix.array, nPool++ * 16, px, groundAt(ctx, px, pz) + 0.15, pz, Math.atan2(hx2, hz2), 5, 1, 12, 0, 1, 0);
      }
    }
    for (let t = 0; t < 4; t++) { flushVehicles(vNear[t], fillN[t]); flushVehicles(vFar[t], fillF[t]); }
    carMat.uniforms.uHead.value = night;
    carMat.uniforms.uTail.value = night * 0.7;
    hl.uniforms.uIntensity.value = night * 0.4;
    hlMesh.count = nPool;
    hlMesh.visible = night > 0.02 && nPool > 0;
    if (hlMesh.visible) hlMesh.instanceMatrix.needsUpdate = true;
  }

  // ================================================================== SCOTTY DOGS on The Cut
  const dogs = [];
  let dogMesh = null;
  if (cut) {
    const nd = 3;
    const dGeo = scottyGeometry();
    const dAnim = new Float32Array(nd * 3);
    dGeo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(dAnim, 3));
    dogMesh = new THREE.InstancedMesh(dGeo, createDogMaterial(shared), nd);
    dogMesh.castShadow = shadows; dogMesh.frustumCulled = false;
    dogMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dogMesh.name = 'life:scotties';
    const bb = cut.polygon.reduce((o, p) => [Math.min(o[0], p[0]), Math.min(o[1], p[1]), Math.max(o[2], p[0]), Math.max(o[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
    const randomIn = () => {
      for (let k = 0; k < 200; k++) {
        const x = bb[0] + rng() * (bb[2] - bb[0]), z = bb[1] + rng() * (bb[3] - bb[1]);
        if (pointInRing(x, z, cut.polygon) && Math.hypot(x - 65, z + 16) > 4) return [x, z];
      }
      return [cut.polygon[0][0], cut.polygon[0][1]];
    };
    for (let k = 0; k < nd; k++) {
      const [x, z] = randomIn();
      const [tx, tz] = randomIn();
      dogs.push({ x, z, tx, tz, yaw: rng() * 6.28, pause: 0, speed: 1.3 + rng() * 0.5, randomIn });
      dAnim[k * 3] = rng() * 6; dAnim[k * 3 + 1] = loopHz(2.6); dAnim[k * 3 + 2] = 1;
    }
    group.add(dogMesh);
  }
  const dogN = [0, 1, 0];
  function updateDogs(dt) {
    if (!dogMesh) return;
    // the dogs stay on The Cut: skip the work when it is far away
    if (dogs.length && (dogs[0].x - cam.x) ** 2 + (dogs[0].z - cam.z) ** 2 > 400 * 400) { dogMesh.visible = false; return; }
    dogMesh.visible = true;
    const anim = dogMesh.geometry.attributes.iAnim.array;
    for (let k = 0; k < dogs.length; k++) {
      const d = dogs[k];
      if (d.pause > 0) {
        d.pause -= dt;
        anim[k * 3 + 2] = 0;
      } else {
        const dx = d.tx - d.x, dz = d.tz - d.z, dist = Math.hypot(dx, dz);
        if (dist < 0.6) {
          [d.tx, d.tz] = d.randomIn();
          if (rng() < 0.5) d.pause = 1.5 + rng() * 3;
        } else {
          const target = Math.atan2(dx, dz);
          let a = target - d.yaw; a -= Math.round(a / 6.2832) * 6.2832;
          d.yaw += a * Math.min(1, dt * 3);
          const v = d.speed * Math.max(0.2, Math.cos(a));
          d.x += Math.sin(d.yaw) * v * dt; d.z += Math.cos(d.yaw) * v * dt;
        }
        anim[k * 3 + 2] = 1;
      }
      const n = ctx.normalAt(d.x, d.z, dogN);
      composeMatrix(dogMesh.instanceMatrix.array, k * 16, d.x, groundAt(ctx, d.x, d.z), d.z, d.yaw, 1.1, 1.1, 1.1, n[0], n[1], n[2]);
    }
    dogMesh.instanceMatrix.needsUpdate = true;
    dogMesh.geometry.attributes.iAnim.needsUpdate = true;
  }

  // ================================================================== BIRDS
  const flocks = [[0, -40, 60], [-120, 160, 45], [150, 480, 55], [-520, 150, 50]];
  const nb = q.level === 'low' ? 8 : 20;
  const bGeo = birdGeometry();
  const bAnim = new Float32Array(nb * 3);
  const birds = [];
  for (let k = 0; k < nb; k++) {
    const f = flocks[k % flocks.length];
    birds.push({ cx: f[0] + (rng() - 0.5) * 30, cz: f[1] + (rng() - 0.5) * 30, h: f[2] + rng() * 25, r: 25 + rng() * 45, w: (0.12 + rng() * 0.1) * (rng() < 0.5 ? 1 : -1), a: rng() * 6.28, bob: rng() * 6 });
    bAnim[k * 3] = rng() * 6.28; bAnim[k * 3 + 1] = loopHz(2.2 + rng() * 1.5); bAnim[k * 3 + 2] = 0.5;
  }
  bGeo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(bAnim, 3));
  const birdMesh = new THREE.InstancedMesh(bGeo, createBirdMaterial(shared), nb);
  birdMesh.frustumCulled = false; birdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  birdMesh.name = 'life:birds';
  group.add(birdMesh);
  const bGround = birds.map((bd) => groundAt(ctx, bd.cx, bd.cz));
  function updateBirds(dt, t) {
    const arr = birdMesh.instanceMatrix.array;
    for (let k = 0; k < birds.length; k++) {
      const bd = birds[k];
      bd.a += bd.w * dt;
      const x = bd.cx + Math.cos(bd.a) * bd.r, z = bd.cz + Math.sin(bd.a) * bd.r;
      const y = bGround[k] + bd.h + Math.sin(t * 0.3 + bd.bob) * 4;
      const yaw = Math.atan2(-Math.sin(bd.a) * Math.sign(bd.w), Math.cos(bd.a) * Math.sign(bd.w));
      // bank into the turn
      const bank = Math.sign(bd.w) * 0.35, bl = Math.hypot(bank, 1);
      composeMatrix(arr, k * 16, x, y, z, yaw, 1.4, 1.4, 1.4, (Math.cos(yaw) * bank) / bl, 1 / bl, (-Math.sin(yaw) * bank) / bl);
      // glide now and then
      bAnim[k * 3 + 2] = Math.sin(t * 0.25 + bd.bob) > 0.3 ? 0.08 : 0.55;
    }
    birdMesh.instanceMatrix.needsUpdate = true;
    birdMesh.geometry.attributes.iAnim.needsUpdate = true;
  }

  ctx.scene.add(group);
  ctx.events.on('quality', (qp) => {
    if (!qp) return;
    shadows = !!qp.shadows;
    pMesh.castShadow = shadows;
    if (dogMesh) dogMesh.castShadow = shadows;
    for (const m of vNear) if (m) m.castShadow = shadows;
  });

  // ================================================================== frame update
  let frameMs = 0;
  ctx.onUpdate((dt, elapsed) => {
    const a = performance.now();
    shared.uTime.value = animTime(elapsed);   // wrapped animation clock (float32-safe, seamless: see graph.js)
    if (dt <= 0) return;
    const c = ctx.camera;
    if (c) {
      const sun = ctx.env?.sun;
      cull.update(c, 3, shadows && sun?.castShadow ? sun.shadow.camera : null);
      cam.x = cull.st.cx; cam.y = cull.st.cy; cam.z = cull.st.cz;
      const f = ctx.nav?.focus;
      if (f && Number.isFinite(f.x) && Number.isFinite(f.z) && (f.x !== 0 || f.z !== 0)) { focus.x = f.x; focus.z = f.z; }
      else {
        // a point ahead of the camera, further when it is high above the ground
        const h = Math.max(0, cam.y - groundAt(ctx, cam.x, cam.z));
        const fl = Math.hypot(cull.st.fx, cull.st.fz) || 1, ahead = Math.min(450, h * 1.1);
        focus.x = cam.x + (cull.st.fx / fl) * ahead; focus.z = cam.z + (cull.st.fz / fl) * ahead;
      }
    }
    updatePeople(dt);
    if (N) updateCars(dt);
    updateDogs(dt);
    updateBirds(dt, elapsed);
    frameMs = frameMs * 0.95 + (performance.now() - a) * 0.05;
  }, 10);

  mark('rest');
  const stats = {
    phases,
    pedestrians: nWalk, standing: standers.length, groups: groups.length, pathNodes: pedNet.nodes.length, pathEdges: pedEdges.length,
    pathsCutAtBuildings: cutPaths, pedBridgeEdgesWithoutDeck: pedNoDeck,
    cars: nCars, buses: nBus, roadEdges: rEdges.length, dogs: dogs.length, birds: nb, ms: Math.round(performance.now() - t0),
  };
  console.info('[life]', JSON.stringify(stats));
  ctx.life = {
    group, stats, frameMs: () => frameMs, pedNet, roadNet,
    // current simulated positions (for probes): [[x, z], ...]
    positions: () => ({ people: Array.from(pX, (x, i) => [x, pZ[i]]), cars: Array.from(cX, (x, i) => [x, cZ[i]]) }),
  };
  // last world step: finish deferred refinements, merge shadow casters, warm-up (world/warmup.js — queued as a
  // loading task when main.js offers ctx.addLoadTask, else right away)
  try { await scheduleFinishWorld(ctx); } catch (e) { console.warn('[life] world warm-up failed', e); }
  return ctx.life;
}
