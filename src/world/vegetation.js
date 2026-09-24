// Trees, shrubs and hedges (owner: life agent). Contract: ARCHITECTURE.md §vegetation.
//
// Placement sources (in priority order, deduplicated with a spatial hash):
//   1. OSM individual trees (data.trees) and tree rows (data.treeRows)            — always kept
//   2. street trees along urban streets (both sides, species runs per street)
//   3. area/terrain driven fill on a jittered grid: woods, steep slopes (Junction Hollow, Panther Hollow…),
//      Schenley Park groves, golf-course roughs, residential back yards, sparse campus planting
//   4. campus lawn-edge trees (never inside The Cut / The Mall / pitches…)
//   5. shrubs: forest understory, foundation planting along buildings, gardens & flowerbeds
// Everything avoids buildings, roads, paths, rails, water, hard surfaces and open lawns via the 1 m land mask.
//
// Rendering: one InstancedMesh per species per LOD. A cheap CPU pass (when the camera has moved ≥ 12 m or turned
// ≥ 12°) packs the instances that are in view — or throw a shadow into it — into the near (full detail, leafy
// cards, branch skeleton for winter), mid/far (low poly) and very-far (~46 tris) meshes. Seasons recolour the
// per-instance foliage attribute.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { getLandMask, M, AREA, mulberry32, fbm2, samplePolyline, composeMatrix, polylineLength, pointInRing, createCuller, createCameraWatch, animTime } from './graph.js';
import { SPECIES, EVERGREEN, buildSpeciesGeometry, seasonColor, createTreeShared, createTreeMaterial, createTreeDepthMaterial } from './trees.js';

const SP = Object.fromEntries(SPECIES.map((k, i) => [k, i]));

// Weighted species tables for different contexts
const MIX = {
  campus: [['broadleaf', 0.34], ['oak', 0.3], ['ornamental', 0.14], ['columnar', 0.1], ['pine', 0.06], ['spruce', 0.06]],
  osm: [['broadleaf', 0.42], ['oak', 0.3], ['ornamental', 0.1], ['columnar', 0.06], ['spruce', 0.07], ['pine', 0.05]],
  street: [['broadleaf', 0.5], ['oak', 0.22], ['columnar', 0.16], ['ornamental', 0.12]],
  forest: [['oak', 0.52], ['broadleaf', 0.3], ['pine', 0.08], ['spruce', 0.05], ['columnar', 0.05]],
  park: [['oak', 0.36], ['broadleaf', 0.34], ['spruce', 0.12], ['pine', 0.1], ['ornamental', 0.08]],
  yard: [['broadleaf', 0.4], ['oak', 0.24], ['spruce', 0.12], ['ornamental', 0.16], ['columnar', 0.08]],
  garden: [['ornamental', 0.6], ['columnar', 0.2], ['broadleaf', 0.2]],
};
function pick(table, r) {
  let acc = 0;
  for (const [k, w] of table) { acc += w; if (r < acc) return k; }
  return table[table.length - 1][0];
}

// Base scale ranges per species (multiplies the modelled size)
const SCALE = {
  broadleaf: [0.8, 1.2], oak: [0.8, 1.2], columnar: [0.8, 1.15], spruce: [0.75, 1.15],
  pine: [0.85, 1.2], ornamental: [0.8, 1.2], shrub: [0.6, 1.25],
};
// Trunk radius at breast height (m, before instance scale) — walk-mode colliders
const TRUNK_R = { broadleaf: 0.3, oak: 0.45, columnar: 0.25, spruce: 0.35, pine: 0.36, ornamental: 0.2, shrub: 0 };
// Trunk clearance to buildings for each species (m)
const CLEAR_B = { broadleaf: 3.2, oak: 4.2, columnar: 2.2, spruce: 3.0, pine: 3.2, ornamental: 2.2, shrub: 0.6 };

// Open lawns inside unmapped park land (OSM maps only the woods around them). Generous outline: only cells whose
// area is plain "park" inside it are treated as lawn — woods, roads and other areas keep their own rules.
// Flagstaff Hill (Schenley Park, between Frew St, Schenley Drive and the Panther Hollow woods) is a big open
// grass slope with trees only around its edges: https://en.wikipedia.org/wiki/Flagstaff_Hill,_Pennsylvania
const OPEN_LAWNS = [
  [[-420, 200], [-290, 185], [-230, 215], [-160, 240], [-120, 290], [-125, 340], [-160, 400], [-205, 412], [-260, 385],
    [-300, 375], [-318, 362], [-380, 305], [-428, 255]],
];
const LAWN_EDGE = 12; // trees still grow in a band this wide along the lawn's edges

export async function createVegetation(ctx) {
  const t0 = performance.now();
  const data = ctx.data;
  const q = ctx.quality || {};
  const density = q.treeDensity ?? 1;
  const phases = {};
  let tPh = t0;
  const mark = (k) => { const n = performance.now(); phases[k] = Math.round(n - tPh); tPh = n; };
  const mask = getLandMask(ctx);
  mark('mask');
  const rng = mulberry32(0xC4E1230);
  const hf = ctx.heightfield;

  // ---------------------------------------------------------------- instance store
  const T = { x: [], z: [], sp: [], s: [], sy: [], rot: [], r1: [], r2: [], evg: [] };
  const HASH = 4;
  const hash = new Map();
  const hk = (i, j) => i * 92821 + j;
  function nearest(x, z, r) {
    const R = Math.ceil(r / HASH);
    const ci = Math.floor(x / HASH), cj = Math.floor(z / HASH);
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
      const arr = hash.get(hk(ci + di, cj + dj));
      if (!arr) continue;
      for (const k of arr) if ((T.x[k] - x) ** 2 + (T.z[k] - z) ** 2 < r * r) return true;
    }
    return false;
  }
  function add(x, z, sp, { minDist = 0, scale = 1, evg = false, osm = false } = {}) {
    if (!osm && excluded(x, z)) return false;
    if (minDist > 0 && nearest(x, z, minDist)) return false;
    const [a, b] = SCALE[sp];
    const s = (a + (b - a) * rng()) * scale;
    const k = T.x.length;
    T.x.push(x); T.z.push(z); T.sp.push(SP[sp]); T.s.push(s); T.sy.push(s * (0.9 + rng() * 0.22));
    T.rot.push(rng() * Math.PI * 2); T.r1.push(rng()); T.r2.push(rng()); T.evg.push(evg ? 1 : 0);
    if (sp !== 'shrub') {
      const key = hk(Math.floor(x / HASH), Math.floor(z / HASH));
      let arr = hash.get(key); if (!arr) hash.set(key, arr = []);
      arr.push(k);
    }
    return true;
  }
  const blocked = (x, z, r, bits) => !mask.free(x, z, r, bits);
  // keep generated plants off sculptures, memorials, fountains and fences/walls (The Fence, Walking to the Sky…)
  const excl = new Map();
  const ek = (i, j) => i * 7919 + j;
  const addExcl = (x, z, r) => {
    for (let i = Math.floor((x - r) / 8); i <= Math.floor((x + r) / 8); i++) for (let j = Math.floor((z - r) / 8); j <= Math.floor((z + r) / 8); j++) {
      const k = ek(i, j); let a = excl.get(k); if (!a) excl.set(k, a = []); a.push(x, z, r);
    }
  };
  for (const p of data.pois) if (p.type === 'artwork' || p.type === 'memorial' || p.type === 'fountain') addExcl(p.x, p.z, 5);
  for (const br of data.barriers) {
    if (br.type === 'hedge') continue;
    samplePolyline(br.points, 1.5, 0, (x, z) => addExcl(x, z, 1.8));
  }
  const excluded = (x, z) => {
    const a = excl.get(ek(Math.floor(x / 8), Math.floor(z / 8)));
    if (a) for (let q = 0; q < a.length; q += 3) if ((a[q] - x) ** 2 + (a[q + 1] - z) ** 2 < a[q + 2] * a[q + 2]) return true;
    return false;
  };

  // ---------------------------------------------------------------- 1. OSM trees & rows
  for (const [x, z] of data.trees) {
    if (mask.at(x, z) & (M.BUILDING | M.WATER)) continue;
    const campus = mask.at(x, z) & M.CAMPUS;
    add(x, z, pick(campus ? MIX.campus : MIX.osm, rng()), { minDist: 1.5, osm: true });
  }
  for (const row of data.treeRows || []) {
    const sp = pick([['broadleaf', 0.4], ['columnar', 0.25], ['ornamental', 0.2], ['oak', 0.15]], rng());
    const len = polylineLength(row.points);
    const step = Math.max(5, Math.min(9, len / Math.max(1, Math.round(len / 7))));
    samplePolyline(row.points, step, 0, (x, z) => {
      if (mask.at(x, z) & (M.BUILDING | M.ROAD | M.WATER)) return;
      add(x, z, sp, { minDist: 3, osm: true });
    });
  }
  const osmCount = T.x.length;
  mark('osm');
  await ctx.yield?.();

  // ---------------------------------------------------------------- 2. street trees
  const STREET_TYPES = { residential: 0.82, tertiary: 0.68, secondary: 0.6, primary: 0.55, trunk: 0.4, unclassified: 0.45 };
  for (const r of data.roads) {
    const p = STREET_TYPES[r.type];
    if (!p || r.bridge || r.tunnel || r.points.length < 2) continue;
    // one dominant species per street
    const streetRnd = mulberry32((r.id.length * 7919 + r.points.length * 131 + Math.floor(r.points[0][0] * 13)) >>> 0);
    const main = pick(MIX.street, streetRnd());
    const half = (r.width || 7) / 2;
    // candidate offsets from the centreline: kerb strip, strip beyond the sidewalk, front yard
    const offs = [half + 1.0, half + 1.8, half + 3.4, half + 5.2];
    for (const side of [-1, 1]) {
      samplePolyline(r.points, 9 * (0.9 + streetRnd() * 0.25) / Math.sqrt(Math.max(0.5, density)), 4 + streetRnd() * 5, (x, z, dx, dz) => {
        if (rng() > p) return;
        const j = (rng() - 0.5) * 2.2;
        const sp = rng() < 0.75 ? main : pick(MIX.street, rng());
        for (const off of offs) {
          const tx = x - dz * off * side + dx * j, tz = z + dx * off * side + dz * j;
          if (!mask.inBounds(tx, tz)) return;
          const f = mask.at(tx, tz);
          if (f & (M.LAWN | M.HARD | M.WATER | M.BUILDING)) continue;
          if (blocked(tx, tz, 0.6, M.ROAD | M.RAIL) || blocked(tx, tz, 0.45, M.PATH)) continue;
          if (blocked(tx, tz, CLEAR_B[sp] * 0.6, M.BUILDING)) continue;
          if (add(tx, tz, sp, { minDist: 5.5 })) return;
          return;
        }
      });
    }
  }
  const streetCount = T.x.length - osmCount;
  mark('street');
  await ctx.yield?.();

  // ---------------------------------------------------------------- 3. area / terrain fill
  const b = data.meta.bounds;
  const cell = 7.2 / Math.sqrt(Math.max(0.2, density));
  const inOpenLawn = (x, z) => OPEN_LAWNS.some((r) => pointInRing(x, z, r));
  // within LAWN_EDGE of the lawn's border (a cell that is not plain park land, or a road)
  const nearLawnEdge = (x, z) => {
    const R = Math.ceil(LAWN_EDGE / mask.C), ci = Math.floor((x - mask.X0) / mask.C), cj = Math.floor((z - mask.Z0) / mask.C);
    for (let dj = -R; dj <= R; dj++) {
      const j = cj + dj; if (j < 0 || j >= mask.H) return true;
      for (let di = -R; di <= R; di++) {
        const i = ci + di; if (i < 0 || i >= mask.W) return true;
        if ((di * di + dj * dj) * mask.C * mask.C > LAWN_EDGE * LAWN_EDGE) continue;
        const k = j * mask.W + i;
        if (mask.area[k] !== AREA.park || (mask.flags[k] & M.ROAD)) return true;
      }
    }
    return false;
  };
  for (let gz = b.minZ; gz < b.maxZ; gz += cell) {
    for (let gx = b.minX; gx < b.maxX; gx += cell) {
      const x = gx + rng() * cell, z = gz + rng() * cell;
      const f = mask.at(x, z);
      if (f & (M.BUILDING | M.WATER | M.LAWN | M.HARD)) continue;
      const code = mask.areaAt(x, z);
      const campus = f & M.CAMPUS;
      const slope = hf.slopeAt(x, z);
      const grove = fbm2(x / 70, z / 70);
      let p = 0, table = MIX.forest, clearRoad = 3, clearPath = 1.6, clearB = 1;
      switch (code) {
        case AREA.wood: p = 0.97; break;
        case AREA.scrub: p = 0.45; table = MIX.park; break;
        case AREA.park:
          // steep ravines are wooded; gentle slopes stay open with a few groves; mapped open lawns stay open
          if (inOpenLawn(x, z)) { p = nearLawnEdge(x, z) ? 0.3 : 0.01; table = MIX.park; }
          else if (slope > 14) p = 0.95;
          else if (slope > 10) p = grove > 0.5 ? 0.8 : 0.2;
          else { p = grove > 0.6 ? 0.8 : grove > 0.5 ? 0.22 : 0.03; table = grove > 0.6 ? MIX.forest : MIX.park; }
          break;
        case AREA.golf: p = grove > 0.52 ? 0.6 : 0.12; table = MIX.park; clearPath = 3; break;
        case AREA.garden: p = 0.1; table = MIX.garden; break;
        case AREA.grass:
          p = slope > 16 ? 0.8 : campus ? 0.03 : 0.12; table = campus ? MIX.campus : MIX.park; break;
        case AREA.none:
          if (slope > 12 && !campus) { p = 0.92; }
          else if (campus) { p = slope > 12 ? 0.55 : 0.04; table = MIX.campus; }
          else { p = 0.16 * (0.4 + grove * 1.4); table = MIX.yard; clearRoad = 5; clearB = 1.3; }
          break;
        default: p = 0;
      }
      if (p <= 0 || rng() > p) continue;
      const sp = pick(table, rng());
      if (blocked(x, z, clearRoad, M.ROAD | M.RAIL)) continue;
      if (blocked(x, z, clearPath, M.PATH)) continue;
      if (blocked(x, z, CLEAR_B[sp] * clearB, M.BUILDING)) continue;
      if (blocked(x, z, 1.2, M.LAWN | M.HARD)) continue;
      add(x, z, sp, { minDist: sp === 'ornamental' ? 3 : 4.2, scale: table === MIX.forest ? 1.22 : 1 });
    }
    if (((gz - b.minZ) / cell | 0) % 40 === 0) await ctx.yield?.();
  }
  const fillCount = T.x.length - osmCount - streetCount;
  mark('fill');

  // ---------------------------------------------------------------- 4. campus lawn-edge trees
  const lawnEdge = [];
  for (const a of data.areas) {
    if (a.type !== 'grass' && a.type !== 'park') continue;
    const cx = a.polygon.reduce((s, p) => s + p[0], 0) / a.polygon.length, cz = a.polygon.reduce((s, p) => s + p[1], 0) / a.polygon.length;
    if (!(mask.at(cx, cz) & M.CAMPUS)) continue;
    lawnEdge.push(a);
  }
  for (const a of lawnEdge) {
    const ring = [...a.polygon, a.polygon[0]];
    // ring orientation → inward normal
    let area2 = 0;
    for (let i = 0, j = a.polygon.length - 1; i < a.polygon.length; j = i++) area2 += (a.polygon[j][0] - a.polygon[i][0]) * (a.polygon[j][1] + a.polygon[i][1]);
    const inward = area2 > 0 ? 1 : -1;
    const core = a.name && ['The Cut', 'The Mall', 'CFA Lawn', 'Tepper Quad'].includes(a.name);
    const inset = core ? -2.5 : 3.5; // core lawns: plant just outside the lawn edge
    samplePolyline(ring, core ? 17 : 13, 5, (x, z, dx, dz) => {
      if (rng() > 0.7) return;
      const tx = x - dz * inset * inward, tz = z + dx * inset * inward;
      const f = mask.at(tx, tz);
      if (f & (M.BUILDING | M.HARD | M.WATER | M.LAWN)) return;
      if (blocked(tx, tz, 1.3, M.PATH | M.ROAD)) return;
      const sp = pick(MIX.campus, rng());
      if (blocked(tx, tz, CLEAR_B[sp], M.BUILDING)) return;
      add(tx, tz, sp, { minDist: core ? 8 : 6 });
    });
  }
  const treeCount = T.x.length;
  await ctx.yield?.();

  // ---------------------------------------------------------------- 5. shrubs
  const shrubCell = 8.5 / Math.sqrt(Math.max(0.2, density));
  for (let gz = b.minZ; gz < b.maxZ; gz += shrubCell) {
    for (let gx = b.minX; gx < b.maxX; gx += shrubCell) {
      const x = gx + rng() * shrubCell, z = gz + rng() * shrubCell;
      const f = mask.at(x, z);
      if (f & (M.BUILDING | M.WATER | M.LAWN | M.HARD | M.ROAD | M.PATH | M.RAIL)) continue;
      const code = mask.areaAt(x, z);
      let p = 0;
      if (code === AREA.wood || code === AREA.scrub) p = 0.45;
      else if (code === AREA.garden || code === AREA.flowerbed) p = 0.9;
      else if (code === AREA.park) p = inOpenLawn(x, z) ? (nearLawnEdge(x, z) ? 0.08 : 0) : hf.slopeAt(x, z) > 13 ? 0.35 : 0.05;
      else if (code === AREA.none && !(f & M.CAMPUS) && hf.slopeAt(x, z) > 15) p = 0.4;
      if (rng() > p) continue;
      if (blocked(x, z, 1.2, M.PATH | M.ROAD | M.BUILDING)) continue;
      add(x, z, 'shrub', { scale: code === AREA.garden || code === AREA.flowerbed ? 0.9 : 1.15, evg: rng() < 0.3 });
    }
  }
  // gardens & flowerbeds get denser planting
  data.areas.forEach((a, ai) => {
    if (a.type !== 'garden' && a.type !== 'flowerbed') return;
    const bb = a.polygon.reduce((o, p) => [Math.min(o[0], p[0]), Math.min(o[1], p[1]), Math.max(o[2], p[0]), Math.max(o[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
    const areaM2 = (bb[2] - bb[0]) * (bb[3] - bb[1]);
    const n = Math.min(120, Math.round(areaM2 / 30 * density));
    for (let i = 0; i < n; i++) {
      const x = bb[0] + rng() * (bb[2] - bb[0]), z = bb[1] + rng() * (bb[3] - bb[1]);
      if (mask.areaIndexAt(x, z) !== ai) continue;
      if (blocked(x, z, 0.8, M.PATH | M.ROAD | M.BUILDING | M.WATER)) continue;
      add(x, z, 'shrub', { scale: 0.75, evg: rng() < 0.5 });
    }
  });
  // foundation planting around campus buildings (and some houses)
  for (const bd of data.buildings) {
    if (bd.hidden) continue;
    const campus = bd.campus;
    if (!campus && (bd.area > 600 || rng() > 0.25)) continue;
    const ring = [...bd.footprint, bd.footprint[0]];
    let a2 = 0;
    for (let i = 0, j = bd.footprint.length - 1; i < bd.footprint.length; j = i++) a2 += (bd.footprint[j][0] - bd.footprint[i][0]) * (bd.footprint[j][1] + bd.footprint[i][1]);
    const outward = a2 > 0 ? -1 : 1;
    const step = campus ? 3.4 : 4;
    samplePolyline(ring, step / Math.sqrt(Math.max(0.3, density)), rng() * 3, (x, z, dx, dz) => {
      if (fbm2(x / 9, z / 9) < (campus ? 0.5 : 0.55)) return; // runs of shrubs with gaps (entrances etc.)
      const off = 1.1 + rng() * 0.5;
      const sx = x - dz * off * outward, sz = z + dx * off * outward;
      const f = mask.at(sx, sz);
      if (f & (M.BUILDING | M.WATER | M.HARD | M.LAWN)) return;
      if (blocked(sx, sz, 0.9, M.PATH | M.ROAD | M.RAIL)) return;
      if (blocked(sx, sz, 0.35, M.BUILDING)) return;
      add(sx, sz, 'shrub', { scale: 0.7, evg: rng() < 0.7 });
    });
  }
  const total = T.x.length;
  const shrubCount = total - treeCount;
  mark('lawnEdge+shrubs');

  // ---------------------------------------------------------------- build instance data per species
  const shared = createTreeShared();
  const matNear = createTreeMaterial(shared, { near: true });
  const matFar = createTreeMaterial(shared, { near: false });
  const depthMat = createTreeDepthMaterial(shared);
  const group = new THREE.Group();
  group.name = 'vegetation';

  // LOD rings (3D camera distance): near = full model (0…nearR), mid = low-poly model that still casts shadows
  // (…MID_R), far = low-poly, no shadow (…VFAR_R), very far = coarse model. Only near trees within SHADOW_NEAR_R cast their full leafy shadow; beyond
  // that the low-poly model is drawn into the shadow map as a shadow-only instance.
  const nearRFor = (lvl) => (lvl === 'low' ? 80 : lvl === 'medium' ? 130 : 180);
  const nearR = nearRFor(q.level);
  const MID_R2 = 380 * 380;
  const VFAR_R2 = (q.level === 'low' ? 420 : 520) ** 2;   // beyond: ~46-triangle crowns
  const SHADOW_NEAR_R2 = 60 * 60;
  const farR = Math.max(1200, q.drawDistance || 2400);
  const layers = [];
  const counts = {};
  for (let s = 0; s < SPECIES.length; s++) {
    const key = SPECIES[s];
    const idx = [];
    for (let k = 0; k < total; k++) if (T.sp[k] === s) idx.push(k);
    counts[key] = idx.length;
    if (!idx.length) continue;
    const n = idx.length;
    const geo = buildSpeciesGeometry(key, 101 + s * 17);
    const bs = geo.near.boundingSphere;
    const L = {
      key, n,
      xs: new Float32Array(n), ys: new Float32Array(n), zs: new Float32Array(n),
      cy: new Float32Array(n), rad: new Float32Array(n),      // bounding sphere (centre height, radius) for culling
      mats: new Float32Array(n * 16), leaf: new Float32Array(n * 3), params: new Float32Array(n * 4),
      r1: new Float32Array(n), r2: new Float32Array(n), evg: new Uint8Array(n),
      farR2: (key === 'shrub' ? 420 : key === 'ornamental' ? 900 : farR) ** 2,
    };
    for (let i = 0; i < n; i++) {
      const k = idx[i];
      const x = T.x[k], z = T.z[k];
      // sink the trunk on slopes: lowest ground under the trunk
      const g0 = ctx.heightAt(x, z);
      const gMin = Math.min(g0, ctx.heightAt(x + 0.6, z), ctx.heightAt(x - 0.6, z), ctx.heightAt(x, z + 0.6), ctx.heightAt(x, z - 0.6));
      const y = gMin - 0.05;
      const s1 = T.s[k], sw = s1 * (0.92 + T.r2[k] * 0.16);
      composeMatrix(L.mats, i * 16, x, y, z, T.rot[k], sw, T.sy[k], s1 * (0.92 + T.r1[k] * 0.16));
      L.xs[i] = x; L.ys[i] = y; L.zs[i] = z;
      L.cy[i] = y + bs.center.y * T.sy[k];
      L.rad[i] = bs.radius * Math.max(sw, T.sy[k], s1 * 1.08);
      L.r1[i] = T.r1[k]; L.r2[i] = T.r2[k]; L.evg[i] = T.evg[k];
      const decid = EVERGREEN[key] || T.evg[k] ? 0 : 1;
      const barkTone = key === 'oak' ? 0.15 + T.r1[k] * 0.3 : key === 'pine' || key === 'spruce' ? 0.1 + T.r2[k] * 0.2 : 0.35 + T.r1[k] * 0.5;
      L.params.set([T.r1[k], decid, barkTone, key === 'shrub' ? 0.5 : 1], i * 4);
      if (key !== 'shrub') ctx.colliders?.addCircle(x, z, TRUNK_R[key] * s1, y - 1, y + 5, 'tree');
    }
    const mk = (g, mat, cap, shadow) => {
      const m = new THREE.InstancedMesh(g, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iLeaf', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('iParams', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
      m.count = 0;
      m.visible = false;
      m.frustumCulled = false;
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.customDepthMaterial = depthMat;
      m.name = `trees:${key}`;
      group.add(m);
      return m;
    };
    L.nearC = mk(geo.near, matNear, n, !!q.shadows);            // near, casting (≤ 60 m)
    L.nearN = mk(geo.near.clone(), matNear, n, false);          // near, no shadow
    L.mid = mk(geo.far, matFar, n, !!q.shadows && key !== 'shrub');
    L.far = mk(geo.far.clone(), matFar, n, false);
    L.vfar = mk(geo.vfar, matFar, n, false);
    L.tiers = [L.nearC, L.nearN, L.mid, L.far, L.vfar];
    layers.push(L);
  }

  // ---------------------------------------------------------------- hedges (clipped, boxy, following the polyline)
  const hedgeSegs = [];
  for (const h of data.barriers) {
    if (h.type !== 'hedge' || ctx.skipBarrierIds?.has(h.id)) continue;
    const ht = Math.min(2.4, Math.max(1.1, h.height ? h.height * 0.55 : 1.3));
    for (let i = 1; i < h.points.length; i++) {
      const [ax, az] = h.points[i - 1], [bx, bz] = h.points[i];
      const len = Math.hypot(bx - ax, bz - az);
      const pieces = Math.max(1, Math.ceil(len / 4));
      for (let k = 0; k < pieces; k++) {
        const t0 = k / pieces, t1 = (k + 1) / pieces;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const g = Math.min(ctx.heightAt(x0, z0), ctx.heightAt(x1, z1));
        const gMax = Math.max(ctx.heightAt(x0, z0), ctx.heightAt(x1, z1));
        hedgeSegs.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: g - 0.4, len: len / pieces + 0.5, h: ht + 0.4 + (gMax - g), yaw: Math.atan2(bx - ax, bz - az) });
        ctx.colliders?.addBox((x0 + x1) / 2, (z0 + z1) / 2, 0.6, len / pieces / 2 + 0.25, Math.atan2(bx - ax, bz - az), g - 1, g + ht, 'hedge');
      }
    }
  }
  let hedge = null;
  if (hedgeSegs.length) {
    let hg = new RoundedBoxGeometry(1, 1, 1, 2, 0.18);
    if (hg.index) hg = hg.toNonIndexed();
    hg.translate(0, 0.5, 0);
    hg.deleteAttribute('uv');
    const hp = hg.attributes.position;
    const at = new Float32Array(hp.count * 3);
    for (let i = 0; i < hp.count; i++) { at[i * 3] = 0.45 + 0.55 * hp.getY(i); at[i * 3 + 1] = 1; at[i * 3 + 2] = -1; } // z < 0: solid foliage
    hg.setAttribute('aTree', new THREE.BufferAttribute(at, 3));
    hg.setAttribute('aLeafUv', new THREE.BufferAttribute(new Float32Array(hp.count * 2), 2));
    const n = hedgeSegs.length;
    hedge = new THREE.InstancedMesh(hg, matNear, n);
    const leaf = new Float32Array(n * 3), prm = new Float32Array(n * 4);
    hedgeSegs.forEach((s, i) => {
      composeMatrix(hedge.instanceMatrix.array, i * 16, s.x, s.y, s.z, s.yaw, 1.15, s.h, s.len);
      prm.set([rng(), 0, 0.3, 0.15], i * 4);
    });
    hg.setAttribute('iLeaf', new THREE.InstancedBufferAttribute(leaf, 3));
    hg.setAttribute('iParams', new THREE.InstancedBufferAttribute(prm, 4));
    hedge.castShadow = !!q.shadows; hedge.receiveShadow = true;
    hedge.customDepthMaterial = depthMat;
    hedge.name = 'hedges';
    hedge.computeBoundingSphere();
    group.add(hedge);
  }

  mark('meshes');
  ctx.scene.add(group);

  // ---------------------------------------------------------------- seasons
  let season = ctx.env?.state?.season || 'autumn';
  let dirty = true;
  function applySeason(s) {
    season = ['spring', 'summer', 'autumn', 'winter'].includes(s) ? s : 'autumn';
    for (const L of layers) {
      for (let i = 0; i < L.n; i++) seasonColor(L.key, season, L.r1[i], L.r2[i], L.leaf, i * 3, !!L.evg[i]);
    }
    if (hedge) {
      const arr = hedge.geometry.attributes.iLeaf.array;
      for (let i = 0; i < hedgeSegs.length; i++) seasonColor('shrub', season === 'winter' ? 'winter' : 'summer', 0.3 + (i % 3) * 0.2, 0.5, arr, i * 3, true);
      hedge.geometry.attributes.iLeaf.needsUpdate = true;
    }
    shared.uBare.value = season === 'winter' ? 1 : 0;
    dirty = true;
  }
  applySeason(season);
  const offSeason = ctx.events.on('env:season', (s) => applySeason(s));

  // ---------------------------------------------------------------- LOD partition + culling
  let nearR2 = nearR * nearR;
  let shadowsOn = !!q.shadows;
  // runtime quality switch (engine emits 'quality' after applying a preset)
  const offQuality = ctx.events.on('quality', (qp) => {
    if (!qp) return;
    const r = nearRFor(qp.level);
    nearR2 = r * r;
    shadowsOn = !!qp.shadows;
    for (const L of layers) { L.nearC.castShadow = shadowsOn; L.mid.castShadow = shadowsOn && L.key !== 'shrub'; }
    if (hedge) hedge.castShadow = shadowsOn;
    dirty = true;
  });
  const cull = createCuller();
  const watch = createCameraWatch(12, 12);
  const MOVE = 13;          // the partition stays valid while the camera moves < 12 m / turns < 12° (+18° pad)
  // Copy each instance that is in view (or throws a shadow into it) into the mesh of its LOD ring.
  // Shadow-only instances (outside the view, or near trees whose shadow comes from the low-poly model) carry
  // iParams.w < 0 and are collapsed in the colour pass.
  function partition() {
    const cam = ctx.camera;
    const sun = ctx.env?.sun;
    const shOn = shadowsOn && !!sun?.castShadow;
    cull.update(cam, 18, shOn ? sun.shadow.camera : null);
    const cx = cull.st.cx, cy = cull.st.cy, cz = cull.st.cz;
    // The near-cast/near and mid/far pairs differ only in shadow casting (same geometry and material). Without
    // shadows each pair is drawn as ONE mesh (tiers 1 → 0 and 3 → 2): up to 2 fewer draw calls per species.
    const tNear = shOn ? 1 : 0, tFar = shOn ? 3 : 2;
    for (const L of layers) {
      const tiers = L.tiers;
      const M4 = tiers.map((m) => m.instanceMatrix.array);
      const LF = tiers.map((m) => m.geometry.attributes.iLeaf.array);
      const PR = tiers.map((m) => m.geometry.attributes.iParams.array);
      const cnt = [0, 0, 0, 0, 0];
      const nR2 = L.key === 'shrub' ? nearR2 * 0.5 : nearR2;
      const nC2 = Math.min(SHADOW_NEAR_R2, nR2);
      const castMid = shOn && L.key !== 'shrub';
      const mats = L.mats, leaf = L.leaf, params = L.params;
      const put = (t, i, shadowOnly) => {
        const c = cnt[t]++, m = M4[t], lf = LF[t], pr = PR[t];
        const o = c * 16, s = i * 16;
        for (let k = 0; k < 16; k++) m[o + k] = mats[s + k];
        lf[c * 3] = leaf[i * 3]; lf[c * 3 + 1] = leaf[i * 3 + 1]; lf[c * 3 + 2] = leaf[i * 3 + 2];
        pr[c * 4] = params[i * 4]; pr[c * 4 + 1] = params[i * 4 + 1]; pr[c * 4 + 2] = params[i * 4 + 2];
        pr[c * 4 + 3] = shadowOnly ? -Math.abs(params[i * 4 + 3]) - 1e-3 : params[i * 4 + 3];
      };
      for (let i = 0; i < L.n; i++) {
        const x = L.xs[i], z = L.zs[i];
        const dx = x - cx, dy = L.ys[i] - cy, dz = z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= L.farR2) continue;
        const y = L.cy[i], r = L.rad[i] + MOVE;
        const vis = cull.inView(x, y, z, r);
        if (d2 < nC2) {
          if (vis) put(0, i, false);
          else if (shOn && cull.inShadow(x, y, z, r)) put(0, i, true);
        } else if (d2 < nR2) {
          if (vis) put(tNear, i, false);
          if (castMid && cull.inShadow(x, y, z, r)) put(2, i, true);
        } else if (d2 < MID_R2) {
          if (vis) put(2, i, false);
          else if (castMid && cull.inShadow(x, y, z, r)) put(2, i, true);
        } else if (vis) put(d2 < VFAR_R2 ? tFar : 4, i, false);
      }
      tiers.forEach((m, t) => {
        m.count = cnt[t];
        m.visible = cnt[t] > 0;
        for (const [attr, sz] of [[m.instanceMatrix, 16], [m.geometry.attributes.iLeaf, 3], [m.geometry.attributes.iParams, 4]]) {
          attr.clearUpdateRanges();
          if (cnt[t] > 0) { attr.addUpdateRange(0, cnt[t] * sz); attr.needsUpdate = true; }
        }
      });
    }
  }

  const sunCol = new THREE.Color();
  let partitionMs = 0, lastPart = -1, shadowKey = 0;
  let canvasAA = false;
  try { canvasAA = !!ctx.renderer?.getContextAttributes?.()?.antialias; } catch { /* no renderer yet */ }
  ctx.onUpdate((dt, elapsed) => {
    shared.uTime.value = animTime(elapsed);   // wrapped: keeps float32 wind phases precise on long uptimes
    // alpha-to-coverage needs a multisampled target (post-processing MSAA buffer or an antialiased canvas)
    shared.uA2C.value = ctx.engine?.postActive || canvasAA ? 1 : 0;
    const st = ctx.env?.state;
    if (st?.sunDir) shared.uSunDir.value.copy(st.sunDir);
    const night = st?.nightFactor ?? 0;
    const sun = ctx.env?.sun;
    if (sun) sunCol.copy(sun.color).multiplyScalar(Math.min(1.2, sun.intensity / 2.5) * (1 - night));
    else sunCol.setRGB(1, 0.95, 0.85).multiplyScalar(1 - night);
    shared.uSunCol.value.copy(sunCol);
    const cam = ctx.camera;
    if (!cam) return;
    cam.updateMatrixWorld();
    // the shadow box follows the view; notice when it has moved since the last partition (e.g. after the first frame)
    let sk = 0;
    if (shadowsOn && sun?.castShadow) { const e = sun.shadow.camera.matrixWorldInverse.elements; sk = e[12] + e[13] * 1.3 + e[14] * 0.7 + sun.shadow.camera.right; }
    const changed = watch.changed(cam) || Math.abs(sk - shadowKey) > 8;
    // re-partition after 12 m of movement or 12° of turning; at most ~12×/s while turning, 5×/s while moving
    if (dirty || (changed && elapsed - lastPart > (watch.moved(cam) ? 0.2 : 0.08))) {
      watch.mark(cam); shadowKey = sk; dirty = false; lastPart = elapsed;
      const tp = performance.now();
      partition();
      partitionMs = performance.now() - tp;
    }
  }, 10);

  mark('rest');
  const stats = { phases, osm: osmCount, street: streetCount, fill: fillCount, lawnEdge: treeCount - osmCount - streetCount - fillCount, trees: treeCount, shrubs: shrubCount, hedgeSegments: hedgeSegs.length, bySpecies: counts, ms: Math.round(performance.now() - t0) };
  console.info('[vegetation]', JSON.stringify(stats));
  ctx.vegetation = {
    group, stats, layers, shared,
    setSeason: applySeason,
    getSeason: () => season,
    partitionMs: () => partitionMs,
    lodCounts: () => layers.map((L) => `${L.key}:${L.nearC.count}+${L.nearN.count}/${L.mid.count}/${L.far.count}+${L.vfar.count}`).join(' '),
    setWind(w) { shared.uWind.value = w; },
    refresh() { dirty = true; },
    dispose() { offSeason(); offQuality(); },
  };
  return ctx.vegetation;
}
