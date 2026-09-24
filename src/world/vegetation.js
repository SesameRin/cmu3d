// Trees, shrubs and hedges (owner: life agent). Contract: ARCHITECTURE.md §vegetation.
//
// Placement sources (in priority order, deduplicated with a spatial hash):
//   1. OSM individual trees (data.trees) and tree rows (data.treeRows)            — always kept
//   2. street trees along urban streets (both sides, species runs per street); where buildings stand at the back
//      of the sidewalk (Walnut St, Penn Ave, Ellsworth…) young street trees go into sidewalk pits at the kerb
//   3. area/terrain driven fill on a jittered grid: woods, steep slopes (Junction Hollow, Panther Hollow…),
//      Schenley Park groves, golf-course roughs, residential back yards, sparse campus planting
//   4. campus lawn-edge trees (never inside The Cut / The Mall / pitches…)
//   5. shrubs: forest understory, foundation planting along buildings, gardens & flowerbeds
// Everything avoids buildings, roads, paths, rails, water, hard surfaces and open lawns via the 1 m land mask.
//
// Rendering (cost bounded by what is near the camera, not by the size of the map):
//   near  (≤ ~180 m)  full model: leaf-cluster cards, branch skeleton, leafy shadows within 60 m
//   mid   (…~420 m)   low-poly lobe crowns (cast shadows up to 380 m)
//   impostor (beyond) ONE instanced draw of camera-facing quads for every tree on the map, crowns drawn procedurally
// Neighbouring tiers overlap in a distance band and cross-fade (complementary dither), so nothing pops. Instances
// are stored sorted by 64 m tiles; when the camera has moved ≥ 12 m or turned ≥ 12° a CPU pass visits only the
// tiles within the mid range that are in view (or throw a shadow into it) and packs the near/mid instances into
// the per-species meshes. The impostor mesh is static (the vertex shader hides trees that are still 3D).
// Seasons recolour the per-instance foliage attributes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getLandMask, M, AREA, mulberry32, fbm2, samplePolyline, composeMatrix, polylineLength, pointInRing, createCuller, createCameraWatch, animTime } from './graph.js';
import { SPECIES, EVERGREEN, buildSpeciesGeometry, seasonColor, createTreeShared, createTreeMaterial, createTreeDepthMaterial, createImpostorGeometry, createImpostorMaterial } from './trees.js';

const SP = Object.fromEntries(SPECIES.map((k, i) => [k, i]));

// Weighted species tables for different contexts
const MIX = {
  campus: [['broadleaf', 0.34], ['oak', 0.3], ['ornamental', 0.14], ['columnar', 0.1], ['pine', 0.06], ['spruce', 0.06]],
  osm: [['broadleaf', 0.42], ['oak', 0.3], ['ornamental', 0.1], ['columnar', 0.06], ['spruce', 0.07], ['pine', 0.05]],
  street: [['broadleaf', 0.52], ['oak', 0.26], ['columnar', 0.08], ['ornamental', 0.08], ['street', 0.06]],
  pit: [['street', 0.84], ['ornamental', 0.16]],
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
  pine: [0.85, 1.2], ornamental: [0.8, 1.2], street: [0.85, 1.15], shrub: [0.6, 1.25],
};
// Trunk radius at breast height (m, before instance scale) — walk-mode colliders
const TRUNK_R = { broadleaf: 0.3, oak: 0.45, columnar: 0.25, spruce: 0.35, pine: 0.36, ornamental: 0.2, street: 0.14, shrub: 0 };
// Trunk clearance to buildings for each species (m)
const CLEAR_B = { broadleaf: 3.2, oak: 4.2, columnar: 2.2, spruce: 3.0, pine: 3.2, ornamental: 2.2, street: 1.8, shrub: 0.6 };

// Open lawns inside unmapped park land (OSM maps only the woods around them). Generous outline: only cells whose
// area is plain "park" inside it are treated as lawn — woods, roads and other areas keep their own rules.
// Flagstaff Hill (Schenley Park, between Frew St, Schenley Drive and the Panther Hollow woods) is a big open
// grass slope with trees only around its edges: https://en.wikipedia.org/wiki/Flagstaff_Hill,_Pennsylvania
const OPEN_LAWNS = [
  [[-420, 200], [-290, 185], [-230, 215], [-160, 240], [-120, 290], [-125, 340], [-160, 400], [-205, 412], [-260, 385],
    [-300, 375], [-318, 362], [-380, 305], [-428, 255]],
];
const LAWN_EDGE = 12; // trees still grow in a band this wide along the lawn's edges

// LOD distances per quality level (camera distance, m): near → mid cross-fade ends at `near`, mid → impostor at `imp`.
const LOD = {
  low: { near: 80, imp: 260 },
  medium: { near: 130, imp: 340 },
  high: { near: 180, imp: 420 },
};
const NEAR_BAND = 11, IMP_BAND = 30;
const SHRUB_LOD = 1.45;                   // shrubs switch at 1 / 1.45 of the tree distances and fade out at the mid end
const TILE = 64;

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
  const T = { x: [], z: [], sp: [], s: [], sy: [], w: [], rot: [], r1: [], r2: [], evg: [] };
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
  function add(x, z, sp, { minDist = 0, scale = 1, wide = 1, evg = false, osm = false } = {}) {
    if (!osm && excluded(x, z)) return false;
    if (minDist > 0 && nearest(x, z, minDist)) return false;
    const [a, b] = SCALE[sp];
    const s = (a + (b - a) * rng()) * scale;
    const k = T.x.length;
    T.x.push(x); T.z.push(z); T.sp.push(SP[sp]); T.s.push(s); T.sy.push(s * (0.9 + rng() * 0.22)); T.w.push(wide);
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
  // junctions (road vertices shared by several streets) and pedestrian crossings: no street trees there
  const JC = 8, jGrid = new Map();
  const jk = (i, j) => i * 100003 + j;
  const addPt = (x, z) => { const k = jk(Math.floor(x / JC), Math.floor(z / JC)); let a = jGrid.get(k); if (!a) jGrid.set(k, a = []); a.push(x, z); };
  const nearPt = (x, z, r) => {
    const R = Math.ceil(r / JC), ci = Math.floor(x / JC), cj = Math.floor(z / JC);
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
      const a = jGrid.get(jk(ci + di, cj + dj)); if (!a) continue;
      for (let q = 0; q < a.length; q += 2) if ((a[q] - x) ** 2 + (a[q + 1] - z) ** 2 < r * r) return true;
    }
    return false;
  };
  {
    const seen = new Map();
    data.roads.forEach((r, ri) => {
      if (r.tunnel) return;
      for (const [x, z] of r.points) {
        const k = `${Math.round(x)},${Math.round(z)}`;
        const v = seen.get(k);
        if (v === undefined) seen.set(k, ri);
        else if (v !== ri && v >= 0) { addPt(x, z); seen.set(k, -1); }
      }
    });
    for (const p of data.paths) if (p.footway === 'crossing') samplePolyline(p.points, 2, 0, (x, z) => addPt(x, z));
  }
  const pits = [];
  const STREET_TYPES = { residential: 0.82, tertiary: 0.68, secondary: 0.6, primary: 0.55, trunk: 0.4, unclassified: 0.45 };
  const PIT_TYPES = { residential: 0.35, tertiary: 0.85, secondary: 0.8, primary: 0.75, unclassified: 0.3 };
  for (const r of data.roads) {
    const p = STREET_TYPES[r.type];
    if (!p || r.bridge || r.tunnel || r.points.length < 2) continue;
    // one dominant species per street
    const streetRnd = mulberry32((r.id.length * 7919 + r.points.length * 131 + Math.floor(r.points[0][0] * 13)) >>> 0);
    const main = pick(MIX.street, streetRnd());
    const half = (r.width || 7) / 2;
    // candidate offsets from the centreline: kerb strip, strip beyond the sidewalk, front yard
    const offs = [half + 1.0, half + 1.8, half + 3.4, half + 5.2];
    const pitP = PIT_TYPES[r.type] || 0;
    for (const side of [-1, 1]) {
      samplePolyline(r.points, 9 * (0.9 + streetRnd() * 0.25) / Math.sqrt(Math.max(0.5, density)), 4 + streetRnd() * 5, (x, z, dx, dz) => {
        if (rng() > p) return;
        const j = (rng() - 0.5) * 2.2;
        const sp = rng() < 0.75 ? main : pick(MIX.street, rng());
        let room = false;       // true when the verge has space for a tree somewhere (then no sidewalk pit)
        for (const off of offs) {
          const tx = x - dz * off * side + dx * j, tz = z + dx * off * side + dz * j;
          if (!mask.inBounds(tx, tz)) return;
          const f = mask.at(tx, tz);
          if (f & (M.LAWN | M.HARD | M.WATER | M.BUILDING)) continue;
          if (blocked(tx, tz, 0.6, M.ROAD | M.RAIL) || blocked(tx, tz, 0.45, M.PATH)) continue;
          if (blocked(tx, tz, CLEAR_B[sp] * 0.6, M.BUILDING)) continue;
          room = true;
          if (nearPt(tx, tz, 7)) return;
          if (add(tx, tz, sp, { minDist: 5.5 })) return;
          return;
        }
        // no verge: buildings at the back of the sidewalk → a young street tree in a pit at the kerb
        if (room || rng() > pitP) return;
        const off = half + 0.8;
        const tx = x - dz * off * side, tz = z + dx * off * side;
        if (!mask.inBounds(tx, tz) || (mask.at(tx, tz) & (M.BUILDING | M.WATER | M.RAIL))) return;
        if (blocked(tx, tz, 0.3, M.ROAD) || blocked(tx, tz, 1.5, M.BUILDING) || !blocked(tx, tz, 4.5, M.BUILDING)) return;
        if (nearPt(tx, tz, 7)) return;
        const psp = pick(MIX.pit, rng());
        if (add(tx, tz, psp, { minDist: 8 })) pits.push(tx, tz, Math.atan2(dx, dz));
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
  const SKIP = M.BUILDING | M.WATER | M.LAWN | M.HARD;
  // cheap terrain steepness: squared gradient from 3 height lookups, compared against tan²(angle)
  const grad2 = (x, z) => { const h0 = hf.heightAt(x, z), gx = (hf.heightAt(x + 2, z) - h0) / 2, gz = (hf.heightAt(x, z + 2) - h0) / 2; return gx * gx + gz * gz; };
  const T2 = (deg) => Math.tan((deg * Math.PI) / 180) ** 2;
  const S10 = T2(10), S12 = T2(12), S13 = T2(13), S14 = T2(14), S15 = T2(15), S16 = T2(16);
  for (let gz = b.minZ; gz < b.maxZ; gz += cell) {
    for (let gx = b.minX; gx < b.maxX; gx += cell) {
      const x = gx + rng() * cell, z = gz + rng() * cell;
      const f = mask.at(x, z);
      if (f & (SKIP | M.ROAD)) continue;
      const code = mask.areaAt(x, z);
      const campus = f & M.CAMPUS;
      let p = 0, table = MIX.forest, clearRoad = 3, clearPath = 1.6, clearB = 1;
      switch (code) {
        case AREA.wood: p = 0.97; break;
        case AREA.scrub: p = 0.45; table = MIX.park; break;
        case AREA.park: {
          // steep ravines are wooded; gentle slopes stay open with a few groves; mapped open lawns stay open
          if (inOpenLawn(x, z)) { p = nearLawnEdge(x, z) ? 0.3 : 0.01; table = MIX.park; break; }
          const g2 = grad2(x, z);
          if (g2 > S14) p = 0.95;
          else {
            const grove = fbm2(x / 70, z / 70);
            if (g2 > S10) p = grove > 0.5 ? 0.8 : 0.2;
            else { p = grove > 0.6 ? 0.8 : grove > 0.5 ? 0.22 : 0.03; table = grove > 0.6 ? MIX.forest : MIX.park; }
          }
          break;
        }
        case AREA.golf: p = fbm2(x / 70, z / 70) > 0.52 ? 0.6 : 0.12; table = MIX.park; clearPath = 3; break;
        case AREA.garden: p = 0.1; table = MIX.garden; break;
        case AREA.grass: {
          p = grad2(x, z) > S16 ? 0.8 : campus ? 0.03 : 0.12; table = campus ? MIX.campus : MIX.park; break;
        }
        case AREA.none: {
          const steep = grad2(x, z) > S12;
          if (steep && !campus) { p = 0.92; }
          else if (campus) { p = steep ? 0.55 : 0.04; table = MIX.campus; }
          else { p = 0.16 * (0.4 + fbm2(x / 70, z / 70) * 1.4); table = MIX.yard; clearRoad = 5; clearB = 1.3; }
          break;
        }
        default: p = 0;
      }
      if (p <= 0 || rng() > p) continue;
      const sp = pick(table, rng());
      const minDist = sp === 'ornamental' ? 3 : 4.2;
      if (nearest(x, z, minDist)) continue;                       // cheap test first
      if (blocked(x, z, 1.2, M.LAWN | M.HARD)) continue;
      if (blocked(x, z, clearPath, M.PATH)) continue;
      if (blocked(x, z, CLEAR_B[sp] * clearB, M.BUILDING)) continue;
      if (blocked(x, z, clearRoad, M.ROAD | M.RAIL)) continue;
      // woodland: taller trees with wider crowns so the canopy closes (seen from above it is one mass, not balls)
      const forest = table === MIX.forest;
      add(x, z, sp, { scale: forest ? 1.22 : 1, wide: forest ? 1.14 : 1 });
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
      else if (code === AREA.park) p = inOpenLawn(x, z) ? (nearLawnEdge(x, z) ? 0.08 : 0) : grad2(x, z) > S13 ? 0.35 : 0.05;
      else if (code === AREA.none && !(f & M.CAMPUS) && grad2(x, z) > S15) p = 0.4;
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

  // ---------------------------------------------------------------- tiles (instances are stored tile by tile)
  const TX0 = Math.floor((b.minX - 20) / TILE), TZ0 = Math.floor((b.minZ - 20) / TILE);
  const NTX = Math.floor((b.maxX + 20) / TILE) - TX0 + 1, NTZ = Math.floor((b.maxZ + 20) / TILE) - TZ0 + 1;
  const NT = NTX * NTZ;
  const tileOf = (x, z) => {
    const tx = Math.min(NTX - 1, Math.max(0, Math.floor(x / TILE) - TX0)), tz = Math.min(NTZ - 1, Math.max(0, Math.floor(z / TILE) - TZ0));
    return tz * NTX + tx;
  };
  // per tile bounds of everything in it (for view / shadow culling of whole tiles)
  const tY0 = new Float32Array(NT).fill(Infinity), tY1 = new Float32Array(NT).fill(-Infinity), tN = new Int32Array(NT);

  // ---------------------------------------------------------------- build instance data per species
  const lvl = LOD[q.level] ? q.level : 'high';
  const shared = createTreeShared();
  const setBands = (level) => {
    const L = LOD[level] || LOD.high;
    shared.uLod.value.set(L.near - NEAR_BAND, L.near, L.imp - IMP_BAND, L.imp);
  };
  setBands(lvl);
  // impostors end where the haze has swallowed a tree anyway (FogExp2 ≈ 0.0006/m: ~75 % at 2 km)
  shared.uFar.value = Math.min(2600, Math.max(1200, q.drawDistance || 2400));
  const depthMat = createTreeDepthMaterial(shared);
  const matNearTree = createTreeMaterial(shared, { near: true }), matFarTree = createTreeMaterial(shared, { near: false });
  const matNearShrub = createTreeMaterial(shared, { near: true, lodScale: SHRUB_LOD }), matFarShrub = createTreeMaterial(shared, { near: false, lodScale: SHRUB_LOD });
  const group = new THREE.Group();
  group.name = 'vegetation';

  const SHADOW_NEAR_R = 60;
  const MID_CAST_R = 380;
  const layers = [];
  const counts = {};
  let nImp = 0;
  const tileK = new Int32Array(total);
  for (let k = 0; k < total; k++) tileK[k] = tileOf(T.x[k], T.z[k]);
  for (let s = 0; s < SPECIES.length; s++) {
    const key = SPECIES[s];
    const idx = [];
    for (let k = 0; k < total; k++) if (T.sp[k] === s) idx.push(k);
    counts[key] = idx.length;
    if (!idx.length) continue;
    const n = idx.length;
    idx.sort((u, v) => tileK[u] - tileK[v] || u - v);
    const tg = performance.now();
    const geo = buildSpeciesGeometry(key, 101 + s * 17);
    phases.geo = (phases.geo || 0) + Math.round(performance.now() - tg);
    const bs = geo.near.boundingSphere;
    const shrub = key === 'shrub';
    const L = {
      key, n, shrub, imp: geo.imp, lodScale: shrub ? SHRUB_LOD : 1,
      xs: new Float32Array(n), ys: new Float32Array(n), zs: new Float32Array(n),
      cy: new Float32Array(n), rad: new Float32Array(n),      // bounding sphere (centre height, radius) for culling
      sw: new Float32Array(n), sh: new Float32Array(n),       // crown width / height scale (impostor)
      mats: new Float32Array(n * 16), leaf: new Float32Array(n * 3), leaf2: new Float32Array(n * 4), params: new Float32Array(n * 4),
      r1: new Float32Array(n), r2: new Float32Array(n), evg: new Uint8Array(n),
      ts: new Int32Array(NT + 1),                             // tile t holds instances ts[t] … ts[t+1]-1
      impOff: -1,
    };
    for (let i = 0; i < n; i++) {
      const k = idx[i];
      const x = T.x[k], z = T.z[k];
      // sink the trunk on slopes: lowest ground under the trunk
      const g0 = hf.heightAt(x, z);
      const gMin = Math.min(g0, hf.heightAt(x + 0.6, z), hf.heightAt(x - 0.6, z), hf.heightAt(x, z + 0.6), hf.heightAt(x, z - 0.6));
      const y = gMin - 0.05;
      const s1 = T.s[k], sw = s1 * (0.92 + T.r2[k] * 0.16) * T.w[k], sd = s1 * (0.92 + T.r1[k] * 0.16) * T.w[k];
      composeMatrix(L.mats, i * 16, x, y, z, T.rot[k], sw, T.sy[k], sd);
      L.xs[i] = x; L.ys[i] = y; L.zs[i] = z;
      L.cy[i] = y + bs.center.y * T.sy[k];
      L.rad[i] = bs.radius * Math.max(sw, T.sy[k], sd * 1.08);
      L.sw[i] = (sw + sd) / 2; L.sh[i] = T.sy[k];
      L.r1[i] = T.r1[k]; L.r2[i] = T.r2[k]; L.evg[i] = T.evg[k];
      const decid = EVERGREEN[key] || T.evg[k] ? 0 : 1;
      const barkTone = key === 'oak' ? 0.15 + T.r1[k] * 0.3 : key === 'pine' || key === 'spruce' ? 0.1 + T.r2[k] * 0.2 : 0.35 + T.r1[k] * 0.52;
      L.params[i * 4] = T.r1[k]; L.params[i * 4 + 1] = decid; L.params[i * 4 + 2] = barkTone; L.params[i * 4 + 3] = shrub ? 0.5 : 1;
      if (!shrub) ctx.colliders?.addCircle(x, z, TRUNK_R[key] * s1, y - 1, y + 5, 'tree');
      const t = tileK[k];
      L.ts[t + 1]++;
      tN[t]++;
      if (y < tY0[t]) tY0[t] = y;
      if (L.cy[i] + L.rad[i] > tY1[t]) tY1[t] = L.cy[i] + L.rad[i];
    }
    for (let t = 0; t < NT; t++) L.ts[t + 1] += L.ts[t];
    if (!shrub) { L.impOff = nImp; nImp += n; }
    const mNear = shrub ? matNearShrub : matNearTree, mFar = shrub ? matFarShrub : matFarTree;
    // tier capacities: only trees within ~210 m (near) / ~450 m (mid) of the camera are ever packed, so the buffers
    // need not hold the whole map (the densest woods put < 3k / 9k of one species in those rings)
    const mk = (g, mat, shadow, cap) => {
      const m = new THREE.InstancedMesh(g, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iLeaf', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('iLeaf2', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('iParams', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
      m.userData.cap = cap;
      m.count = 0;
      m.visible = false;
      m.frustumCulled = false;
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.customDepthMaterial = depthMat;
      m.renderOrder = 3;              // after terrain / buildings: early-z rejects the leaves they hide
      m.name = `trees:${key}`;
      group.add(m);
      return m;
    };
    const capN = Math.min(n, 3000), capM = Math.min(n, 9000);
    L.nearC = mk(geo.near, mNear, !!q.shadows, capN);             // near, casting (≤ 60 m)
    L.nearN = mk(geo.near.clone(), mNear, false, capN);           // near, no shadow
    L.mid = mk(geo.far, mFar, !!q.shadows && !shrub, capM);       // mid, casting (≤ 380 m)
    L.far = mk(geo.far.clone(), mFar, false, capM);               // mid, no shadow
    L.tiers = [L.nearC, L.nearN, L.mid, L.far];
    L.caps = L.tiers.map((m) => m.userData.cap);
    layers.push(L);
  }

  mark('layers');
  // ---------------------------------------------------------------- impostors: every tree, one draw call
  let imp = null;
  if (nImp) {
    const ig = createImpostorGeometry(nImp);
    const P = ig.attributes.iPos.array, D = ig.attributes.iDim.array;
    for (const L of layers) {
      if (L.impOff < 0) continue;
      const d = L.imp;
      for (let i = 0; i < L.n; i++) {
        const o = L.impOff + i;
        // w: the tree's seed (= iParams.x of the 3D tiers: same per-tree LOD jitter) + 2 if deciduous
        P[o * 4] = L.xs[i]; P[o * 4 + 1] = L.ys[i]; P[o * 4 + 2] = L.zs[i]; P[o * 4 + 3] = L.r1[i] * 0.999 + (L.params[i * 4 + 1] > 0.5 ? 2 : 0);
        const rx = d.rx * L.sw[i];
        D[o * 4] = d.cy * L.sh[i]; D[o * 4 + 1] = rx; D[o * 4 + 2] = d.ry * L.sh[i];
        D[o * 4 + 3] = d.shape + Math.min(0.45, (d.trunkR * L.sw[i]) / Math.max(0.1, rx));
      }
    }
    imp = new THREE.Mesh(ig, createImpostorMaterial(shared));
    imp.frustumCulled = false;
    imp.castShadow = false;
    imp.receiveShadow = true;
    imp.renderOrder = 4;              // last opaque draw: crowns hidden behind hills and buildings are rejected early
    imp.name = 'trees:impostors';
    group.add(imp);
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
    // same program as the near trees; lodScale 0 → never fades out (hedges have no low-poly tier)
    hedge = new THREE.InstancedMesh(hg, createTreeMaterial(shared, { near: true, lodScale: 0 }), n);
    const leaf = new Float32Array(n * 3), leaf2 = new Float32Array(n * 4), prm = new Float32Array(n * 4);
    hedgeSegs.forEach((s, i) => {
      composeMatrix(hedge.instanceMatrix.array, i * 16, s.x, s.y, s.z, s.yaw, 1.15, s.h, s.len);
      prm.set([rng(), 0, 0.3, 0.15], i * 4);
    });
    hg.setAttribute('iLeaf', new THREE.InstancedBufferAttribute(leaf, 3));
    hg.setAttribute('iLeaf2', new THREE.InstancedBufferAttribute(leaf2, 4));
    hg.setAttribute('iParams', new THREE.InstancedBufferAttribute(prm, 4));
    hedge.castShadow = !!q.shadows; hedge.receiveShadow = true;
    hedge.customDepthMaterial = depthMat;
    hedge.name = 'hedges';
    hedge.computeBoundingSphere();
    group.add(hedge);
  }

  // ---------------------------------------------------------------- sidewalk tree pits (mulch square + steel frame)
  let pitMesh = null;
  const nPits = pits.length / 3;
  if (nPits) {
    const parts = [];
    const vc = (g, hex) => {
      g = g.index ? g.toNonIndexed() : g;
      g.deleteAttribute('uv');
      const c = new THREE.Color(hex), a = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const bx = (w, h, d, x, y, z, hex) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return vc(g, hex); };
    parts.push(bx(1.2, 0.12, 1.2, 0, -0.03, 0, '#3a2d22'));                          // mulch
    for (const s of [-1, 1]) {
      parts.push(bx(1.34, 0.14, 0.07, 0, -0.02, s * 0.635, '#8d918f'));              // kerb frame
      parts.push(bx(0.07, 0.14, 1.2, s * 0.635, -0.02, 0, '#8d918f'));
    }
    const pg = mergeGeometries(parts, false);
    const pm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    pm.name = 'treePits';
    pitMesh = new THREE.InstancedMesh(pg, pm, nPits);
    for (let i = 0; i < nPits; i++) {
      const x = pits[i * 3], z = pits[i * 3 + 1];
      composeMatrix(pitMesh.instanceMatrix.array, i * 16, x, ctx.heightAt(x, z) + 0.02, z, pits[i * 3 + 2], 1, 1, 1);
    }
    pitMesh.receiveShadow = true;
    pitMesh.name = 'trees:pits';
    pitMesh.computeBoundingSphere();
    group.add(pitMesh);
  }

  mark('meshes');
  ctx.scene.add(group);

  // ---------------------------------------------------------------- seasons
  let season = ctx.env?.state?.season || 'autumn';
  let dirty = true;
  function applySeason(s) {
    season = ['spring', 'summer', 'autumn', 'winter'].includes(s) ? s : 'autumn';
    const IL = imp?.geometry.attributes.iLeaf, IL2 = imp?.geometry.attributes.iLeaf2;
    for (const L of layers) {
      for (let i = 0; i < L.n; i++) seasonColor(L.key, season, L.r1[i], L.r2[i], L.leaf, i * 3, !!L.evg[i], L.leaf2, i * 4);
      if (IL && L.impOff >= 0) { IL.array.set(L.leaf, L.impOff * 3); IL2.array.set(L.leaf2, L.impOff * 4); }
    }
    if (IL) { IL.needsUpdate = true; IL2.needsUpdate = true; }
    if (hedge) {
      const arr = hedge.geometry.attributes.iLeaf.array, arr2 = hedge.geometry.attributes.iLeaf2.array;
      for (let i = 0; i < hedgeSegs.length; i++) seasonColor('shrub', season === 'winter' ? 'winter' : 'summer', 0.3 + (i % 3) * 0.2, 0.5, arr, i * 3, true, arr2, i * 4);
      hedge.geometry.attributes.iLeaf.needsUpdate = true;
      hedge.geometry.attributes.iLeaf2.needsUpdate = true;
    }
    shared.uBare.value = season === 'winter' ? 1 : 0;
    dirty = true;
  }
  applySeason(season);
  const offSeason = ctx.events.on('env:season', (s) => applySeason(s));

  // ---------------------------------------------------------------- LOD partition + culling
  let lod = LOD[lvl];
  let shadowsOn = !!q.shadows;
  // runtime quality switch (engine emits 'quality' after applying a preset)
  const offQuality = ctx.events.on('quality', (qp) => {
    if (!qp) return;
    if (LOD[qp.level]) { lod = LOD[qp.level]; setBands(qp.level); }
    shadowsOn = !!qp.shadows;
    for (const L of layers) { L.nearC.castShadow = shadowsOn; L.mid.castShadow = shadowsOn && !L.shrub; }
    if (hedge) hedge.castShadow = shadowsOn;
    dirty = true;
  });
  const cull = createCuller();
  const watch = createCameraWatch(12, 12);
  const MOVE = 13;          // the partition stays valid while the camera moves < 12 m / turns < 12° (+18° pad)
  const TILE_R = TILE * 0.7072;
  let lastVisited = 0, overflow = 0;
  // Copy each instance that is in view (or throws a shadow into it) into the mesh of its LOD tier. Instances in a
  // cross-fade band go into both tiers (the shaders dither between them). Shadow-only instances (outside the view,
  // or near trees whose shadow comes from the low-poly model) carry iParams.w < 0 and are collapsed in the colour pass.
  function partition() {
    const cam = ctx.camera;
    const sun = ctx.env?.sun;
    const shOn = shadowsOn && !!sun?.castShadow;
    cull.update(cam, 18, shOn ? sun.shadow.camera : null);
    const cx = cull.st.cx, cy = cull.st.cy, cz = cull.st.cz;
    // The near-cast/near and mid/far pairs differ only in shadow casting (same geometry and material). Without
    // shadows each pair is drawn as ONE mesh (tiers 1 → 0 and 3 → 2): up to 2 fewer draw calls per species.
    const tNear = shOn ? 1 : 0, tFar = shOn ? 3 : 2;
    // (+ the ±15 m per-tree LOD jitter of the shaders)
    const nearHi = lod.near + MOVE + 15, nearLo = Math.max(0, lod.near - NEAR_BAND - MOVE - 15), reach = lod.imp + MOVE + 15;
    for (const L of layers) {
      L.cnt = L.cnt || new Int32Array(4);
      L.cnt.fill(0);
      L.M4 = L.tiers.map((m) => m.instanceMatrix.array);
      L.LF = L.tiers.map((m) => m.geometry.attributes.iLeaf.array);
      L.LF2 = L.tiers.map((m) => m.geometry.attributes.iLeaf2.array);
      L.PR = L.tiers.map((m) => m.geometry.attributes.iParams.array);
    }
    const put = (L, t, i, shadowOnly) => {
      if (L.cnt[t] >= L.caps[t]) { overflow++; return; }
      const c = L.cnt[t]++, m = L.M4[t], lf = L.LF[t], lf2 = L.LF2[t], pr = L.PR[t];
      const mats = L.mats, leaf = L.leaf, leaf2 = L.leaf2, params = L.params;
      const o = c * 16, s = i * 16;
      for (let k = 0; k < 16; k++) m[o + k] = mats[s + k];
      lf[c * 3] = leaf[i * 3]; lf[c * 3 + 1] = leaf[i * 3 + 1]; lf[c * 3 + 2] = leaf[i * 3 + 2];
      lf2[c * 4] = leaf2[i * 4]; lf2[c * 4 + 1] = leaf2[i * 4 + 1]; lf2[c * 4 + 2] = leaf2[i * 4 + 2]; lf2[c * 4 + 3] = leaf2[i * 4 + 3];
      pr[c * 4] = params[i * 4]; pr[c * 4 + 1] = params[i * 4 + 1]; pr[c * 4 + 2] = params[i * 4 + 2];
      pr[c * 4 + 3] = shadowOnly ? -Math.abs(params[i * 4 + 3]) - 1e-3 : params[i * 4 + 3];
    };
    const tx0 = Math.max(0, Math.floor((cx - reach - 24) / TILE) - TX0), tx1 = Math.min(NTX - 1, Math.floor((cx + reach + 24) / TILE) - TX0);
    const tz0 = Math.max(0, Math.floor((cz - reach - 24) / TILE) - TZ0), tz1 = Math.min(NTZ - 1, Math.floor((cz + reach + 24) / TILE) - TZ0);
    let visited = 0;
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = tz * NTX + tx;
        if (!tN[t]) continue;
        const wx0 = (tx + TX0) * TILE, wz0 = (tz + TZ0) * TILE;
        const ddx = Math.max(0, wx0 - cx, cx - wx0 - TILE), ddz = Math.max(0, wz0 - cz, cz - wz0 - TILE);
        if (ddx * ddx + ddz * ddz > (reach + 16) * (reach + 16)) continue;
        const tcx = wx0 + TILE / 2, tcz = wz0 + TILE / 2, tcy = (tY0[t] + tY1[t]) / 2;
        const tr = Math.hypot(TILE_R, (tY1[t] - tY0[t]) / 2) + 16 + MOVE;
        if (!cull.inView(tcx, tcy, tcz, tr) && !(shOn && cull.inShadow(tcx, tcy, tcz, tr))) continue;
        for (const L of layers) {
          const i0 = L.ts[t], i1 = L.ts[t + 1];
          if (i0 === i1) continue;
          const s2 = L.lodScale * L.lodScale;
          const nH2 = nearHi * nearHi, nL2 = nearLo * nearLo, R2 = reach * reach;
          const nC2 = SHADOW_NEAR_R * SHADOW_NEAR_R, castR2 = MID_CAST_R * MID_CAST_R;
          const castMid = shOn && !L.shrub;
          for (let i = i0; i < i1; i++) {
            visited++;
            const x = L.xs[i], z = L.zs[i];
            const dx = x - cx, dy = L.ys[i] - cy, dz = z - cz;
            const e2 = (dx * dx + dy * dy + dz * dz) * s2;
            if (e2 >= R2) continue;
            const y = L.cy[i], r = L.rad[i] + MOVE;
            const vis = cull.inView(x, y, z, r);
            const inMid = e2 > nL2;
            if (e2 < nH2) {
              if (e2 < nC2) {
                if (vis) put(L, 0, i, false);
                else if (shOn && cull.inShadow(x, y, z, r)) put(L, 0, i, true);
              } else {
                if (vis) put(L, tNear, i, false);
                if (!inMid && castMid && cull.inShadow(x, y, z, r)) put(L, 2, i, true);
              }
            }
            if (inMid) {
              const cast = castMid && e2 < castR2;
              if (vis) put(L, cast ? 2 : tFar, i, false);
              else if (cast && cull.inShadow(x, y, z, r)) put(L, 2, i, true);
            }
          }
        }
      }
    }
    lastVisited = visited;
    for (const L of layers) {
      L.tiers.forEach((m, t) => {
        const c = L.cnt[t];
        m.count = c;
        m.visible = c > 0;
        for (const [attr, sz] of [[m.instanceMatrix, 16], [m.geometry.attributes.iLeaf, 3], [m.geometry.attributes.iLeaf2, 4], [m.geometry.attributes.iParams, 4]]) {
          attr.clearUpdateRanges();
          if (c > 0) { attr.addUpdateRange(0, c * sz); attr.needsUpdate = true; }
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
  const stats = { phases, osm: osmCount, street: streetCount, pits: nPits, fill: fillCount, lawnEdge: treeCount - osmCount - streetCount - fillCount, trees: treeCount, shrubs: shrubCount, hedgeSegments: hedgeSegs.length, impostors: nImp, bySpecies: counts, ms: Math.round(performance.now() - t0) };
  console.info('[vegetation]', JSON.stringify(stats));
  ctx.vegetation = {
    group, stats, layers, shared, impostors: imp,
    setSeason: applySeason,
    getSeason: () => season,
    partitionMs: () => partitionMs,
    lodCounts: () => layers.map((L) => `${L.key}:${L.nearC.count}+${L.nearN.count}/${L.mid.count}+${L.far.count}`).join(' ') + ` visited:${lastVisited} overflow:${overflow}`,
    setWind(w) { shared.uWind.value = w; },
    refresh() { dirty = true; },
    dispose() { offSeason(); offQuality(); },
  };
  return ctx.vegetation;
}
