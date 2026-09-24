// Spatial helpers shared by vegetation / props / life (owner: life agent).
//
//  getLandMask(ctx)   1 m raster over the data bounds describing what occupies the ground:
//                     buildings, roads, paths, rails, water, hard surfaces (parking/plaza/pitches…),
//                     open lawns that must stay clear, and the CMU campus boundary. Plus an area-type
//                     raster (smallest OSM area covering each cell). Cached on ctx so it is built once.
//  buildNetwork(...)  planar graph from polylines (vertex snapping + T-junction repair). Used for the
//                     pedestrian footway graph and the car road graph.
//  small math utils   seeded RNG, value noise, polyline sampling, ground-aligned matrix composition.
import { pointInRing } from '../core/heightfield.js';

// ------------------------------------------------------------------ flags & area codes
export const M = {
  BUILDING: 1, ROAD: 2, PATH: 4, RAIL: 8, WATER: 16,
  HARD: 32,     // parking, plaza, pavement, pitches, track, stadium, playground, construction, bridge areas
  LAWN: 64,     // lawns that must stay open (The Cut, The Mall, CFA lawn, golf fairways…)
  CAMPUS: 128,  // inside the CMU campus boundary
};
export const AREA = {
  none: 0, grass: 1, park: 2, garden: 3, wood: 4, scrub: 5, water: 6, pitch: 7, track: 8, stadium: 9,
  golf: 10, playground: 11, plaza: 12, pavement: 13, parking: 14, flowerbed: 15, construction: 16,
  bridgeArea: 17, fairway: 18, coreLawn: 19,
};
const HARD_TYPES = new Set(['parking', 'plaza', 'pavement', 'pitch', 'track', 'stadium', 'playground', 'construction', 'bridgeArea']);
// Named lawns that are kept open (only edge planting allowed).
export const CORE_LAWNS = new Set(['The Cut', 'The Mall', 'CFA Lawn', 'Tepper Quad', 'Cathedral Lawn', 'Mudge Courtyard', 'Donner Ditch']);

// ------------------------------------------------------------------ small utils
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic 2D hash → [0,1)
export function hash2(x, z) {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((z | 0) + 0x9e3779b9, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// Smooth 2D value noise in [0,1)
export function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// Fractal noise (2 octaves) in ~[0,1)
export function fbm2(x, z) {
  return noise2(x, z) * 0.65 + noise2(x * 2.13 + 17.1, z * 2.13 - 9.7) * 0.35;
}

// ------------------------------------------------------------------ shader animation clock
// Shaders get `animTime(elapsed)` = elapsed mod ANIM_PERIOD instead of the ever-growing elapsed time: a float32
// uTime of 1e5–1e6 s quantises the phases (walk cycles stutter after ~1 day of uptime, legs freeze and jump after
// ~1 week). Every periodic effect uses a frequency with a whole number of cycles per period (loopHz / loopRad),
// so the wrap is seamless.
export const ANIM_PERIOD = 600;
export const animTime = (elapsed) => elapsed % ANIM_PERIOD;
export const loopHz = (hz) => Math.max(1, Math.round(hz * ANIM_PERIOD)) / ANIM_PERIOD;        // cycles per second
export const loopRad = (w) => loopHz(w / (2 * Math.PI)) * 2 * Math.PI;                         // radians per second
export const glslRad = (w) => loopRad(w).toFixed(6);                                            // as a GLSL float literal

export function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

// Walk a polyline and call fn(x, z, dirX, dirZ, distance) every `step` metres (starting at `offset`).
export function samplePolyline(pts, step, offset, fn) {
  let next = offset, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1], bx = pts[i][0], bz = pts[i][1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    while (next <= acc + L) {
      const t = next - acc;
      fn(ax + dx * t, az + dz * t, dx, dz, next);
      next += step;
    }
    acc += L;
  }
  return acc;
}

// Write a column-major 4x4 matrix into out[o..o+15]: object stands on a surface with up vector (nx,ny,nz),
// heading yaw (radians; local +Z → (sin yaw, 0, cos yaw) like THREE rotation.y), non-uniform scale.
export function composeMatrix(out, o, x, y, z, yaw, sx, sy, sz, nx = 0, ny = 1, nz = 0) {
  let fx = Math.sin(yaw), fy = 0, fz = Math.cos(yaw);
  if (ny < 0.9999) {
    const d = fx * nx + fz * nz;
    fx -= nx * d; fy = -ny * d; fz -= nz * d;
    const l = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    fx /= l; fy /= l; fz /= l;
  }
  // X = up × forward
  let rx = ny * fz - nz * fy, ry = nz * fx - nx * fz, rz = nx * fy - ny * fx;
  const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  out[o] = rx * sx; out[o + 1] = ry * sx; out[o + 2] = rz * sx; out[o + 3] = 0;
  out[o + 4] = nx * sy; out[o + 5] = ny * sy; out[o + 6] = nz * sy; out[o + 7] = 0;
  out[o + 8] = fx * sz; out[o + 9] = fy * sz; out[o + 10] = fz * sz; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}

// ------------------------------------------------------------------ land mask
// Rasterisation is exact and scanline based (per row: polygon spans from an edge table, capsule spans computed
// analytically), so the cost is ~ rows + filled cells instead of bounding-box cells × edges.
export function getLandMask(ctx) {
  if (ctx.__landMask) return ctx.__landMask;
  const t0 = performance.now();
  const data = ctx.data;
  const b = data.meta.bounds;
  // 1 m cells at every quality level: with 2 m cells the placement rules (clearances of 0.3–2 m) shift noticeably
  // (−25 % foundation shrubs, ±15–60 % lamps / hydrants, lost bus shelters), and the scanline raster is cheap enough.
  const C = 1;
  const X0 = Math.floor(b.minX) - 8, Z0 = Math.floor(b.minZ) - 8;
  const W = Math.ceil((b.maxX - X0) / C) + Math.ceil(16 / C), H = Math.ceil((b.maxZ - Z0) / C) + Math.ceil(16 / C);
  const flags = new Uint8Array(W * H);
  const area = new Uint8Array(W * H);
  const areaIndex = new Uint16Array(W * H);   // index + 1 of the smallest area covering the cell (0 = none)

  // Even-odd scanline fill of a set of rings (outer + holes): a cell is inside when its centre is.
  // Edges are bucketed by their first row (edge table) so each row only visits the edges that cross it.
  // cb(rowStart, i0, i1) for every span.
  const EZ0 = [], EZ1 = [], EX = [], EK = [], ORD = [], ACT = [], XS = [];
  function fillRings(rings, cb) {
    let n = 0;
    for (const r of rings) {
      for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
        const az = r[k][1], bz = r[i][1];
        if (az === bz) continue;
        // the edge crosses row centres zc with min(az,bz) <= zc < max(az,bz) (same rule as (az > zc) !== (bz > zc))
        const lo = az < bz ? az : bz, hi = az < bz ? bz : az;
        const j0 = Math.ceil((lo - Z0) / C - 0.5), j1 = Math.ceil((hi - Z0) / C - 0.5) - 1;
        if (j1 < j0 || j1 < 0 || j0 >= H) continue;
        EZ0[n] = j0; EZ1[n] = j1;
        EK[n] = (r[i][0] - r[k][0]) / (bz - az);          // dx/dz
        EX[n] = r[k][0] - az * EK[n];                      // x at z = 0
        ORD[n] = n; n++;
      }
    }
    if (n < 2) return;
    const ord = ORD.slice(0, n).sort((u, v) => EZ0[u] - EZ0[v]);
    let na = 0, next = 0;
    const jStart = Math.max(0, EZ0[ord[0]]);
    for (let j = jStart; j < H; j++) {
      while (next < n && EZ0[ord[next]] <= j) ACT[na++] = ord[next++];
      let w = 0;
      for (let q = 0; q < na; q++) if (EZ1[ACT[q]] >= j) ACT[w++] = ACT[q];
      na = w;
      if (!na) { if (next >= n) break; continue; }
      const zc = Z0 + (j + 0.5) * C;
      for (let q = 0; q < na; q++) XS[q] = EX[ACT[q]] + zc * EK[ACT[q]];
      // insertion sort (a handful of crossings per row)
      for (let q = 1; q < na; q++) { const v = XS[q]; let p = q - 1; while (p >= 0 && XS[p] > v) { XS[p + 1] = XS[p]; p--; } XS[p + 1] = v; }
      for (let q = 0; q + 1 < na; q += 2) {
        const i0 = Math.max(0, Math.ceil((XS[q] - X0) / C - 0.5)), i1 = Math.min(W - 1, Math.floor((XS[q + 1] - X0) / C - 0.5));
        if (i1 >= i0) cb(j * W, i0, i1);
      }
    }
  }
  // Thick polyline (capsules): OR `bit` into every cell whose centre lies within r of a segment. Per row the
  // capsule ∩ row is one interval = hull of the two end-disc chords and the band |perp| <= r, 0 <= t <= 1.
  function strokeLine(pts, r, bit, closed = false) {
    const r2 = r * r;
    const n = pts.length;
    for (let s = closed ? 0 : 1; s < n; s++) {
      const p0 = pts[s === 0 ? n - 1 : s - 1], p1 = pts[s];
      const ax = p0[0], az = p0[1], bx = p1[0], bz = p1[1];
      const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez, L = Math.sqrt(L2), rL = r * L;
      const j0 = Math.max(0, Math.ceil(((az < bz ? az : bz) - r - Z0) / C - 0.5));
      const j1 = Math.min(H - 1, Math.floor(((az > bz ? az : bz) + r - Z0) / C - 0.5));
      for (let j = j0; j <= j1; j++) {
        const pz = Z0 + (j + 0.5) * C;
        let lo = Infinity, hi = -Infinity;
        const dzA = pz - az, dzB = pz - bz;
        if (dzA * dzA <= r2) { const h = Math.sqrt(r2 - dzA * dzA); lo = ax - h; hi = ax + h; }
        if (dzB * dzB <= r2) { const h = Math.sqrt(r2 - dzB * dzB); if (bx - h < lo) lo = bx - h; if (bx + h > hi) hi = bx + h; }
        if (L2 > 1e-12) {
          // u = px - ax;  0 <= t: u*ex >= -dzA*ez;  t <= 1: u*ex <= L2 - dzA*ez;  |u*ez - dzA*ex| <= r*L
          let ulo = -Infinity, uhi = Infinity, ok = true;
          if (ex !== 0) { let u0 = -dzA * ez / ex, u1 = (L2 - dzA * ez) / ex; if (u0 > u1) { const t = u0; u0 = u1; u1 = t; } ulo = u0; uhi = u1; }
          else { const t = dzA * ez; ok = t >= 0 && t <= L2; }
          if (ok) {
            if (ez !== 0) { let v0 = (dzA * ex - rL) / ez, v1 = (dzA * ex + rL) / ez; if (v0 > v1) { const t = v0; v0 = v1; v1 = t; } if (v0 > ulo) ulo = v0; if (v1 < uhi) uhi = v1; }
            else ok = Math.abs(dzA * ex) <= rL;
          }
          if (ok && ulo <= uhi) { if (ax + ulo < lo) lo = ax + ulo; if (ax + uhi > hi) hi = ax + uhi; }
        }
        if (lo > hi) continue;
        const i0 = Math.max(0, Math.ceil((lo - X0) / C - 0.5)), i1 = Math.min(W - 1, Math.floor((hi - X0) / C - 0.5));
        for (let k = j * W + i0, e = j * W + i1; k <= e; k++) flags[k] |= bit;
      }
    }
  }

  // Areas: large → small (data is sorted), so the smallest area wins each cell.
  const KEEP = ~(M.HARD | M.WATER | M.LAWN) & 0xff;
  data.areas.forEach((a, idx) => {
    let code = AREA[a.type] || 0;
    if (a.type === 'grass' && (a.sport === 'golf')) code = AREA.fairway;
    if (a.type === 'pitch' && a.sport === 'golf') code = AREA.fairway;
    if ((a.type === 'grass' || a.type === 'park') && CORE_LAWNS.has(a.name)) code = AREA.coreLawn;
    const rings = a.holes?.length ? [a.polygon, ...a.holes] : [a.polygon];
    const lawn = code === AREA.coreLawn || code === AREA.fairway;
    const set = (HARD_TYPES.has(a.type) ? M.HARD : 0) | (a.type === 'water' ? M.WATER : 0) | (lawn ? M.LAWN : 0);
    const id1 = idx + 1;
    fillRings(rings, (row, i0, i1) => {
      for (let k = row + i0, e = row + i1; k <= e; k++) { area[k] = code; areaIndex[k] = id1; flags[k] = (flags[k] & KEEP) | set; }
    });
  });
  const orSpan = (bit) => (row, i0, i1) => { for (let k = row + i0, e = row + i1; k <= e; k++) flags[k] |= bit; };
  const campusSpan = orSpan(M.CAMPUS), buildingSpan = orSpan(M.BUILDING);
  for (const ring of data.meta.campusBoundary || []) fillRings([ring], campusSpan);
  for (const bd of data.buildings) {
    fillRings(bd.holes?.length ? [bd.footprint, ...bd.holes] : [bd.footprint], buildingSpan);
    // thin outline so tiny/narrow footprints still register
    strokeLine(bd.footprint, Math.max(0.5, C * 0.5), M.BUILDING, true);
  }
  for (const r of data.roads) {
    if (r.tunnel) continue;
    strokeLine(r.points, Math.max(C * 0.5, (r.width || 6) / 2), M.ROAD);
  }
  for (const p of data.paths) {
    if (p.tunnel || p.indoor) continue;
    strokeLine(p.points, Math.max(0.8, C * 0.5, (p.width || 2) / 2), M.PATH);
  }
  for (const r of data.railways || []) {
    if (r.tunnel) continue;
    strokeLine(r.points, 3, M.RAIL);
  }

  const idx = (x, z) => {
    const i = Math.floor((x - X0) / C), j = Math.floor((z - Z0) / C);
    if (i < 0 || j < 0 || i >= W || j >= H) return -1;
    return j * W + i;
  };
  const mask = {
    X0, Z0, W, H, C, flags, area, areaIndex,
    at(x, z) { const k = idx(x, z); return k < 0 ? 0 : flags[k]; },
    areaAt(x, z) { const k = idx(x, z); return k < 0 ? 0 : area[k]; },
    areaIndexAt(x, z) { const k = idx(x, z); return k < 0 ? -1 : areaIndex[k] - 1; },
    inBounds(x, z) { return idx(x, z) >= 0; },
    // true if no cell within radius r has any of the bits in `bits`
    free(x, z, r, bits) {
      const i0 = Math.max(0, Math.floor((x - r - X0) / C)), i1 = Math.min(W - 1, Math.floor((x + r - X0) / C));
      const j0 = Math.max(0, Math.floor((z - r - Z0) / C)), j1 = Math.min(H - 1, Math.floor((z + r - Z0) / C));
      const r2 = (r + C * 0.5) * (r + C * 0.5);
      for (let j = j0; j <= j1; j++) {
        const dz = Z0 + (j + 0.5) * C - z;
        for (let i = i0; i <= i1; i++) {
          const dx = X0 + (i + 0.5) * C - x;
          if (dx * dx + dz * dz > r2) continue;
          if (flags[j * W + i] & bits) return false;
        }
      }
      return true;
    },
    // distance (m, up to maxR) to the nearest cell carrying `bits`; returns maxR if none found
    distTo(x, z, bits, maxR = 8) {
      const ci = Math.floor((x - X0) / C), cj = Math.floor((z - Z0) / C);
      let best = maxR * maxR;
      const R = Math.ceil(maxR / C);
      for (let dj = -R; dj <= R; dj++) {
        const j = cj + dj; if (j < 0 || j >= H) continue;
        for (let di = -R; di <= R; di++) {
          const i = ci + di; if (i < 0 || i >= W) continue;
          const d2 = (di * di + dj * dj) * C * C;
          if (d2 < best && (flags[j * W + i] & bits)) best = d2;
        }
      }
      return Math.sqrt(best);
    },
  };
  ctx.__landMask = mask;
  console.info(`[life] land mask ${W}x${H} in ${(performance.now() - t0).toFixed(0)} ms`);
  return mask;
}

// ------------------------------------------------------------------ network (graph) builder
// lines: [{ pts:[[x,z],...], ...meta }]. Vertices of different lines closer than `snap` are merged into a
// node; dangling endpoints within `snap` of another line's segment are spliced into it (T-junctions).
// Returns { nodes:[{x,z,edges:[edgeIndex...]}], edges:[{a,b,pts:Float32Array(x,z,...),cum:Float32Array,len,line,comp}] }
export function buildNetwork(lines, { snap = 1.5, minComponent = 0 } = {}) {
  // 1) T-junction repair: insert a vertex where a dangling endpoint touches another line mid-segment.
  const SEG = 32;   // coarse cells: few registrations per segment; candidates are filtered by distance anyway
  const segGrid = new Map();
  const sk = (i, j) => i * 100003 + j;
  lines.forEach((ln, li) => {
    const p = ln.pts;
    for (let s = 1; s < p.length; s++) {
      const x0 = Math.min(p[s - 1][0], p[s][0]) - snap, x1 = Math.max(p[s - 1][0], p[s][0]) + snap;
      const z0 = Math.min(p[s - 1][1], p[s][1]) - snap, z1 = Math.max(p[s - 1][1], p[s][1]) + snap;
      for (let i = Math.floor(x0 / SEG); i <= Math.floor(x1 / SEG); i++) for (let j = Math.floor(z0 / SEG); j <= Math.floor(z1 / SEG); j++) {
        const k = sk(i, j);
        let arr = segGrid.get(k); if (!arr) segGrid.set(k, arr = []);
        arr.push(li, s);
      }
    }
  });
  const inserts = new Map(); // lineIndex → [{s, t, x, z}]
  lines.forEach((ln, li) => {
    for (const end of [ln.pts[0], ln.pts[ln.pts.length - 1]]) {
      const arr = segGrid.get(sk(Math.floor(end[0] / SEG), Math.floor(end[1] / SEG)));
      if (!arr) continue;
      let best = snap, bl = -1, bs = -1, bt = 0;
      for (let q = 0; q < arr.length; q += 2) {
        const oj = arr[q], s = arr[q + 1];
        if (oj === li) continue;
        const a = lines[oj].pts[s - 1], b = lines[oj].pts[s];
        const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez;
        if (l2 < 1e-6) continue;
        const t = ((end[0] - a[0]) * ex + (end[1] - a[1]) * ez) / l2;
        if (t <= 0 || t >= 1) continue;
        const d = Math.hypot(end[0] - a[0] - ex * t, end[1] - a[1] - ez * t);
        // skip if very close to an existing vertex (vertex snapping handles it)
        const L = Math.sqrt(l2);
        if (t * L < snap || (1 - t) * L < snap) continue;
        if (d < best) { best = d; bl = oj; bs = s; bt = t; }
      }
      if (bl >= 0) {
        const a = lines[bl].pts[bs - 1], b = lines[bl].pts[bs];
        let arr2 = inserts.get(bl); if (!arr2) inserts.set(bl, arr2 = []);
        arr2.push({ s: bs, t: bt, x: a[0] + (b[0] - a[0]) * bt, z: a[1] + (b[1] - a[1]) * bt });
      }
    }
  });
  const polys = lines.map((ln, li) => {
    const ins = inserts.get(li);
    if (!ins) return ln.pts;
    ins.sort((u, v) => u.s - v.s || u.t - v.t);
    const out = [ln.pts[0]];
    let q = 0;
    for (let s = 1; s < ln.pts.length; s++) {
      while (q < ins.length && ins[q].s === s) { out.push([ins[q].x, ins[q].z]); q++; }
      out.push(ln.pts[s]);
    }
    return out;
  });

  // 2) Union-find vertices of different lines within `snap`.
  const vx = [], vz = [], vl = [], vi = [];
  const lineStart = [];
  polys.forEach((p, li) => { lineStart.push(vx.length); p.forEach((pt, i) => { vx.push(pt[0]); vz.push(pt[1]); vl.push(li); vi.push(i); }); });
  const N = vx.length;
  const parent = new Int32Array(N); for (let i = 0; i < N; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const grid = new Map();
  for (let v = 0; v < N; v++) {
    const k = sk(Math.floor(vx[v] / snap), Math.floor(vz[v] / snap));
    let arr = grid.get(k); if (!arr) grid.set(k, arr = []);
    arr.push(v);
  }
  const clusterSize = new Int32Array(N);
  for (let v = 0; v < N; v++) {
    const ci = Math.floor(vx[v] / snap), cj = Math.floor(vz[v] / snap);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const arr = grid.get(sk(ci + di, cj + dj)); if (!arr) continue;
      for (const w of arr) {
        if (w <= v) continue;
        if (vl[w] === vl[v] && Math.abs(vi[w] - vi[v]) < 3) continue; // same line, neighbouring vertex
        if (Math.hypot(vx[w] - vx[v], vz[w] - vz[v]) < snap) {
          const a = find(v), c = find(w); if (a !== c) parent[a] = c;
        }
      }
    }
  }
  for (let v = 0; v < N; v++) clusterSize[find(v)]++;

  // 3) nodes = endpoints + clustered vertices
  const nodeOf = new Map(); // cluster root → node index
  const nodes = [];
  const acc = [];
  const isNodeVertex = (v) => {
    const li = vl[v], i = vi[v];
    return i === 0 || i === polys[li].length - 1 || clusterSize[find(v)] > 1;
  };
  for (let v = 0; v < N; v++) {
    if (!isNodeVertex(v)) continue;
    const r = find(v);
    let n = nodeOf.get(r);
    if (n === undefined) { n = nodes.length; nodeOf.set(r, n); nodes.push({ x: 0, z: 0, edges: [] }); acc.push(0); }
    nodes[n].x += vx[v]; nodes[n].z += vz[v]; acc[n]++;
  }
  nodes.forEach((n, i) => { n.x /= acc[i]; n.z /= acc[i]; });

  // 4) split lines at node vertices into edges
  const edges = [];
  polys.forEach((p, li) => {
    const base = lineStart[li];
    let startNode = nodeOf.get(find(base)), cur = [[nodes[startNode].x, nodes[startNode].z]];
    for (let i = 1; i < p.length; i++) {
      const v = base + i;
      if (isNodeVertex(v)) {
        const endNode = nodeOf.get(find(v));
        cur.push([nodes[endNode].x, nodes[endNode].z]);
        const len = polylineLength(cur);
        if (len > 0.3 && !(endNode === startNode && cur.length < 3)) {
          const pts = new Float32Array(cur.length * 2), cum = new Float32Array(cur.length);
          let s = 0;
          cur.forEach((q, k) => { pts[k * 2] = q[0]; pts[k * 2 + 1] = q[1]; if (k) s += Math.hypot(q[0] - cur[k - 1][0], q[1] - cur[k - 1][1]); cum[k] = s; });
          const e = { a: startNode, b: endNode, pts, cum, len: s, line: lines[li], lineIndex: li, comp: -1 };
          nodes[startNode].edges.push(edges.length);
          if (endNode !== startNode) nodes[endNode].edges.push(edges.length);
          edges.push(e);
        }
        startNode = endNode; cur = [[nodes[endNode].x, nodes[endNode].z]];
      } else {
        cur.push(p[i]);
      }
    }
  });

  // 5) connected components
  const compLen = [];
  const nodeComp = new Int32Array(nodes.length).fill(-1);
  for (let s = 0; s < nodes.length; s++) {
    if (nodeComp[s] >= 0 || !nodes[s].edges.length) continue;
    const c = compLen.length; compLen.push(0);
    const stack = [s]; nodeComp[s] = c;
    while (stack.length) {
      const n = stack.pop();
      for (const ei of nodes[n].edges) {
        const e = edges[ei];
        if (e.comp < 0) { e.comp = c; compLen[c] += e.len; }
        const o = e.a === n ? e.b : e.a;
        if (nodeComp[o] < 0) { nodeComp[o] = c; stack.push(o); }
      }
    }
  }
  for (const e of edges) e.compLen = compLen[e.comp] || 0;
  if (minComponent > 0) for (const e of edges) e.dead = e.compLen < minComponent;
  return { nodes, edges, compLen };
}

// Point + tangent on an edge polyline at arc length s (clamped). Writes into out {x,z,dx,dz}; `hint`
// (segment index) speeds up sequential queries. Returns the segment index used.
export function edgePoint(e, s, out, hint = 1) {
  const cum = e.cum, pts = e.pts, n = cum.length;
  if (s <= 0) s = 0; else if (s >= e.len) s = e.len;
  let k = hint < 1 ? 1 : hint >= n ? n - 1 : hint;
  while (k < n - 1 && cum[k] < s) k++;
  while (k > 1 && cum[k - 1] > s) k--;
  const L = cum[k] - cum[k - 1] || 1e-6;
  const t = (s - cum[k - 1]) / L;
  const ax = pts[(k - 1) * 2], az = pts[(k - 1) * 2 + 1], bx = pts[k * 2], bz = pts[k * 2 + 1];
  out.x = ax + (bx - ax) * t; out.z = az + (bz - az) * t;
  out.dx = (bx - ax) / L; out.dz = (bz - az) / L;
  out.t = t;
  return k;
}

// ------------------------------------------------------------------ view / shadow culling of instances
// Sphere tests against the camera frustum (optionally widened by padDeg so a partition stays valid while the
// camera turns a little) and against the directional-light shadow box (ortho camera: |u| <= right, |v| <= top).
// update() reads the camera's matrices (and the shadow camera's, as of the last rendered frame).
export function createCuller() {
  const V = new Float64Array(16), S = new Float64Array(16);
  const st = { tx: 1, ty: 1, kx: 1.5, ky: 1.5, shadow: false, sx: 0, sy: 0, cx: 0, cy: 0, cz: 0, fx: 0, fy: 0, fz: -1, fov: 0, aspect: 0 };
  return {
    st,
    update(cam, padDeg = 0, shadowCam = null) {
      cam.updateMatrixWorld();
      const e = cam.matrixWorldInverse.elements;
      for (let i = 0; i < 16; i++) V[i] = e[i];
      const pad = (padDeg * Math.PI) / 180, hv = (cam.fov * Math.PI) / 360;
      const ah = Math.min(1.52, Math.atan(Math.tan(hv) * cam.aspect) + pad), av = Math.min(1.52, hv + pad);
      st.tx = Math.tan(ah); st.ty = Math.tan(av);
      st.kx = Math.sqrt(1 + st.tx * st.tx); st.ky = Math.sqrt(1 + st.ty * st.ty);
      const w = cam.matrixWorld.elements;
      st.cx = w[12]; st.cy = w[13]; st.cz = w[14]; st.fx = -w[8]; st.fy = -w[9]; st.fz = -w[10];
      st.fov = cam.fov; st.aspect = cam.aspect;
      st.shadow = !!shadowCam;
      if (shadowCam) {
        const s = shadowCam.matrixWorldInverse.elements;
        for (let i = 0; i < 16; i++) S[i] = s[i];
        st.sx = shadowCam.right; st.sy = shadowCam.top;
      }
    },
    inView(x, y, z, r) {
      const d = -(V[2] * x + V[6] * y + V[10] * z + V[14]);
      if (d < -r) return false;
      const vx = V[0] * x + V[4] * y + V[8] * z + V[12];
      const lx = d * st.tx + r * st.kx;
      if (vx > lx || -vx > lx) return false;
      const vy = V[1] * x + V[5] * y + V[9] * z + V[13];
      const ly = d * st.ty + r * st.ky;
      return !(vy > ly || -vy > ly);
    },
    inShadow(x, y, z, r) {
      if (!st.shadow) return false;
      const u = S[0] * x + S[4] * y + S[8] * z + S[12];
      if (u > st.sx + r || -u > st.sx + r) return false;
      const v = S[1] * x + S[5] * y + S[9] * z + S[13];
      return !(v > st.sy + r || -v > st.sy + r);
    },
    // translation of the shadow camera used by the last update (to notice when the shadow box has moved)
    shadowKey() { return st.shadow ? S[12] * 1.7 + S[13] * 2.3 + S[14] * 0.9 + st.sx * 5 : 0; },
  };
}

// Tracks when a camera-dependent partition must be rebuilt: moved > moveM, turned > turnDeg, fov/aspect change.
export function createCameraWatch(moveM = 12, turnDeg = 12) {
  const cosT = Math.cos((turnDeg * Math.PI) / 180);
  let px = Infinity, py = Infinity, pz = Infinity, fx = 0, fy = 0, fz = 0, fov = 0, aspect = 0;
  return {
    changed(cam) {
      const w = cam.matrixWorld.elements;
      const dx = w[12] - px, dy = w[13] - py, dz = w[14] - pz;
      if (dx * dx + dy * dy + dz * dz > moveM * moveM) return true;
      if (-w[8] * fx - w[9] * fy - w[10] * fz < cosT) return true;
      return cam.fov !== fov || cam.aspect !== aspect;
    },
    moved(cam) {
      const w = cam.matrixWorld.elements;
      const dx = w[12] - px, dy = w[13] - py, dz = w[14] - pz;
      return dx * dx + dy * dy + dz * dz > moveM * moveM;
    },
    mark(cam) {
      const w = cam.matrixWorld.elements;
      px = w[12]; py = w[13]; pz = w[14]; fx = -w[8]; fy = -w[9]; fz = -w[10]; fov = cam.fov; aspect = cam.aspect;
    },
  };
}

// Split a polyline into the runs that lie inside the rectangle [x0,x1]×[z0,z1] (exact segment clipping).
export function clipPolylineToRect(pts, x0, z0, x1, z1) {
  const runs = [];
  let cur = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    // Liang–Barsky
    let t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const P = [-dx, dx, -dz, dz], Q = [a[0] - x0, x1 - a[0], a[1] - z0, z1 - a[1]];
    let ok = true;
    for (let k = 0; k < 4 && ok; k++) {
      if (P[k] === 0) { if (Q[k] < 0) ok = false; continue; }
      const r = Q[k] / P[k];
      if (P[k] < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; } else { if (r < t0) ok = false; else if (r < t1) t1 = r; }
    }
    if (!ok) { if (cur) { runs.push(cur); cur = null; } continue; }
    const pa = t0 > 0 ? [a[0] + dx * t0, a[1] + dz * t0] : a, pb = t1 < 1 ? [a[0] + dx * t1, a[1] + dz * t1] : b;
    if (!cur || t0 > 0) { if (cur) runs.push(cur); cur = [pa]; }
    cur.push(pb);
    if (t1 < 1) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.filter((r) => r.length >= 2 && polylineLength(r) > 1);
}

export { pointInRing };
