// Street-level detail for the generic OSM buildings (Oakland / Shadyside main streets):
//  * street index (nearest named street, kerb clearance) and a footprint index (is this spot inside a neighbour?)
//  * wall RUNS (straight-ish stretches of wall, split at corners exactly like emitWalls) and their street frontage
//  * storefront planning: shop units that line up with the storefront texture bays, businesses (POIs / building
//    names) assigned to the units nearest to them, generic units in between
//  * 3D parts: fascia sign boards + projecting blade signs + café furniture (atlas meshes, see signage.js), awnings,
//    canopies, ledges and storefront cornices (building surface buffer), bay windows, mansard dormers, fire escapes.
import * as THREE from 'three';
import { pointInRing } from '../core/heightfield.js';
import { emitQuad, emitFrameBox, emitWalls, emitCap, emitRingWall, signedArea, offsetRing } from './building-geometry.js';
import { businessStyle, signText, GENERIC_SIGNS } from './signage.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function segProj(px, pz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9;
  const t = clamp(((px - ax) * ex + (pz - az) * ez) / l2, 0, 1);
  const qx = ax + ex * t, qz = az + ez * t;
  return { t, qx, qz, d: Math.hypot(px - qx, pz - qz) };
}

// ---------------------------------------------------------------- street index
const STREET_TYPES = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'trunk',
  'primary_link', 'secondary_link', 'tertiary_link', 'trunk_link']);
const RANK = { trunk: 5, primary: 5, secondary: 4, tertiary: 3, residential: 2, unclassified: 2, living_street: 1 };

export function createStreetIndex(data) {
  const G = 40, grid = new Map();
  for (const r of data.roads || []) {
    if (r.tunnel || !r.points || r.points.length < 2) continue;
    const street = STREET_TYPES.has(r.type);
    if (!street && r.type !== 'service' && r.type !== 'pedestrian') continue;
    const half = (r.width || (street ? 9 : 4.5)) / 2;
    for (let i = 1; i < r.points.length; i++) {
      const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i];
      const seg = { ax, az, bx, bz, half, name: r.name || null, street, rank: RANK[r.type] || 0 };
      for (let gx = Math.floor(Math.min(ax, bx) / G); gx <= Math.floor(Math.max(ax, bx) / G); gx++) {
        for (let gz = Math.floor(Math.min(az, bz) / G); gz <= Math.floor(Math.max(az, bz) / G); gz++) {
          const k = gx + ',' + gz;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(seg);
        }
      }
    }
  }
  function each(x, z, r, fn) {
    const seen = new Set();
    for (let gx = Math.floor((x - r) / G); gx <= Math.floor((x + r) / G); gx++) {
      for (let gz = Math.floor((z - r) / G); gz <= Math.floor((z + r) / G); gz++) {
        const list = grid.get(gx + ',' + gz);
        if (list) for (const s of list) if (!seen.has(s)) { seen.add(s); fn(s); }
      }
    }
  }
  // nearest street centreline (named streets preferred within 3 m)
  function nearestStreet(x, z, maxD = 40) {
    let best = null;
    each(x, z, maxD, (s) => {
      if (!s.street) return;
      const p = segProj(x, z, s.ax, s.az, s.bx, s.bz);
      const score = p.d - (s.name ? 3 : 0);
      if (p.d < maxD && (!best || score < best.score)) best = { score, d: p.d, seg: s, px: p.qx, pz: p.qz };
    });
    return best;
  }
  // distance from the nearest carriageway edge (negative = on the road); service roads count too
  function clearance(x, z, maxD = 30) {
    let best = maxD;
    each(x, z, maxD, (s) => { const d = segProj(x, z, s.ax, s.az, s.bx, s.bz).d - s.half; if (d < best) best = d; });
    return best;
  }
  return { nearestStreet, clearance };
}

// ---------------------------------------------------------------- footprint index
export function createFootprintIndex(list) {
  const G = 30, grid = new Map();
  for (const b of list) {
    const ring = b.footprint;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const e = { id: b.id, ring, x0, x1, z0, z1 };
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) {
      for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) {
        const k = gx + ',' + gz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(e);
      }
    }
  }
  function inside(x, z, selfId = null, otherId = null) {
    const list = grid.get(Math.floor(x / G) + ',' + Math.floor(z / G));
    if (!list) return false;
    for (const e of list) {
      if (e.id === selfId || e.id === otherId || x < e.x0 || x > e.x1 || z < e.z0 || z > e.z1) continue;
      if (pointInRing(x, z, e.ring)) return true;
    }
    return false;
  }
  return { inside };
}

// ---------------------------------------------------------------- wall runs
// Straight-ish stretches of an outer ring, split where the wall turns by more than cornerDeg (same rule as emitWalls,
// so a run is exactly one texture run: its storefront bays line up with the units planned here).
export function wallRuns(ring, cornerDeg = 28) {
  const n = ring.length;
  const E = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    E.push({ i, ax: a[0], az: a[1], len, tx: len > 1e-6 ? dx / len : 0, tz: len > 1e-6 ? dz / len : 0, nx: len > 1e-6 ? dz / len : 0, nz: len > 1e-6 ? -dx / len : 0 });
  }
  const cosLim = Math.cos((cornerDeg * Math.PI) / 180);
  const corner = new Array(n).fill(false);
  let any = false;
  for (let i = 0; i < n; i++) {
    const e1 = E[(i + n - 1) % n], e2 = E[i];
    if (e1.len < 1e-6 || e2.len < 1e-6) continue;
    if (e1.tx * e2.tx + e1.tz * e2.tz < cosLim) { corner[i] = true; any = true; }
  }
  if (!any) corner[0] = true;
  const runs = [];
  const start = corner.indexOf(true);
  let i = start;
  do {
    const edges = [];
    let j = i;
    do { edges.push(E[j]); j = (j + 1) % n; } while (!corner[j] && j !== start);
    let s = 0, longest = edges[0];
    for (const e of edges) { e.s0 = s; s += e.len; if (e.len > longest.len) longest = e; }
    runs.push({ edges, len: s, nx: longest.nx, nz: longest.nz, tx: longest.tx, tz: longest.tz, longest });
    i = j;
  } while (i !== start);
  return runs;
}

// Point + frame at arc length s along a run
export function runPoint(run, s) {
  let e = run.edges[run.edges.length - 1];
  for (const q of run.edges) if (s <= q.s0 + q.len) { e = q; break; }
  const t = clamp(s - e.s0, 0, e.len);
  return { x: e.ax + e.tx * t, z: e.az + e.tz * t, tx: e.tx, tz: e.tz, nx: e.nx, nz: e.nz, e };
}

// Straight pieces of a run between arc lengths s0..s1: [{ ox, oz, tx, tz, nx, nz, len, sa }]
export function runSegs(run, s0, s1) {
  const out = [];
  for (const e of run.edges) {
    const a = Math.max(s0, e.s0), b = Math.min(s1, e.s0 + e.len);
    if (b - a < 0.05) continue;
    const t = a - e.s0;
    out.push({ ox: e.ax + e.tx * t, oz: e.az + e.tz * t, tx: e.tx, tz: e.tz, nx: e.nx, nz: e.nz, len: b - a, sa: a });
  }
  return out;
}

// Does the run face an open street? → { d (m from the wall to the street centreline), name, rank } or null.
// A run with a neighbour right in front of it (party wall) or no street within ~28 m in front is not a frontage.
export function runFrontage(run, street, fp, selfId, parentId = null) {
  run.blocked = false;
  if (run.len < 2.5) return null;
  let blocked = 0, votes = 0, best = null;
  for (const f of [0.2, 0.5, 0.8]) {
    const p = runPoint(run, f * run.len);
    if (fp.inside(p.x + p.nx * 1.2, p.z + p.nz * 1.2, selfId, parentId) || fp.inside(p.x + p.nx * 3.5, p.z + p.nz * 3.5, selfId, parentId)) { blocked++; continue; }
    const ns = street.nearestStreet(p.x + p.nx * 2, p.z + p.nz * 2, 30);
    if (!ns) continue;
    const vx = ns.px - p.x, vz = ns.pz - p.z, dist = Math.hypot(vx, vz);
    const along = vx * p.nx + vz * p.nz;
    if (along > 0.55 * dist && along < 30) {
      votes++;
      if (!best || along < best.d) best = { d: along, name: ns.seg.name, rank: ns.seg.rank };
    }
  }
  run.blocked = blocked >= 2;
  if (run.blocked || !best || votes < 1) return null;
  return best;
}

// ---------------------------------------------------------------- businesses
export const SHOP_POI = new Set(['restaurant', 'cafe', 'fast_food', 'bank', 'bar', 'pub', 'pharmacy', 'shop', 'ice_cream', 'atm']);
const NOT_BUSINESS = /^\d|square\b|apartments?|hall\b|building|house\b|center|centre|church|institute|school|tower|garage|parking|university|college|library|museum|hospital|office|dorm|residence|lofts?\b|annex|laborator|chapel|temple|synagogue|condominium|court\b|place\b|plaza\b/i;

// Named shop POIs inside / at the walls of the building; else a business-like building name.
export function findBusinesses(b, ring, shopPois, nearDist = 6) {
  const out = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (const p of shopPois) {
    if (!p.name || p.x < x0 - nearDist || p.x > x1 + nearDist || p.z < z0 - nearDist || p.z > z1 + nearDist) continue;
    let near = pointInRing(p.x, p.z, ring);
    if (!near) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (segProj(p.x, p.z, ring[j][0], ring[j][1], ring[i][0], ring[i][1]).d < nearDist) { near = true; break; }
    if (near && !out.some((o) => o.name === p.name)) out.push({ name: p.name, type: p.type, cuisine: p.cuisine || null, x: p.x, z: p.z });
  }
  return out;
}
export function nameBusiness(b) {
  const n = b.name;
  if (!n || NOT_BUSINESS.test(n)) return null;
  const t = /bank|chase|pnc|citizens/i.test(n) ? 'bank' : /dmd|dds|dental|llc|law|associates|clinic/i.test(n) ? 'office'
    : /caf[eé]|coffee|tea|starbucks/i.test(n) ? 'cafe' : /grill|restaurant|sushi|pizza|kitchen|bistro|crêpes|crepes|chipotle|subway/i.test(n) ? 'restaurant' : 'retail';
  return { name: n, type: t, cuisine: null, x: null, z: null, fromName: true };
}

// ---------------------------------------------------------------- storefront planning
// runs / fronts aligned arrays. mode 'all' → every street frontage is shop units; 'poi' → only runs that received a
// POI business. Returns { runs:[{ run, units, groups }], shopEdges:Set(edge index), split:Map(edge → t[]) } or null.
export function planStorefronts({ b, runs, fronts, businesses, mode, bay = 6, seed = 1 }) {
  const byRun = new Map();
  const unitsOf = (run) => {
    if (!byRun.has(run)) {
      const L = run.len;
      const units = [];
      // same split as the (stretched) storefront texture: whole units over the run
      const nb = Math.max(1, Math.round(L / bay)), uw = L / nb;
      for (let k = 0; k < nb; k++) units.push({ s0: k * uw, s1: (k + 1) * uw, biz: null });
      byRun.set(run, units);
    }
    return byRun.get(run);
  };
  const pois = businesses.filter((z) => !z.fromName);
  const named = businesses.filter((z) => z.fromName);
  // POI businesses → nearest run (frontages preferred), unit containing the projection
  for (const biz of pois) {
    let best = null;
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      if (run.len < 3) continue;
      let dmin = Infinity, sAt = 0;
      for (const e of run.edges) {
        const p = segProj(biz.x, biz.z, e.ax, e.az, e.ax + e.tx * e.len, e.az + e.tz * e.len);
        if (p.d < dmin) { dmin = p.d; sAt = e.s0 + p.t * e.len; }
      }
      const score = dmin + (fronts[r] ? fronts[r].d * 0.08 - fronts[r].rank * 0.3 : 8);
      if (!best || score < best.score) best = { score, run, sAt };
    }
    if (!best) continue;
    const units = unitsOf(best.run);
    let k = units.findIndex((u) => best.sAt >= u.s0 - 1e-6 && best.sAt <= u.s1 + 1e-6);
    if (k < 0) k = 0;
    const order = [k];
    for (let d = 1; d < units.length; d++) { if (k - d >= 0) order.push(k - d); if (k + d < units.length) order.push(k + d); }
    const free = order.find((q) => !units[q].biz);
    if (free !== undefined) units[free].biz = biz;
  }
  // the building's own business name (e.g. "Union Grill") next to POI businesses: the free units of its main frontage
  if (named.length && pois.length) {
    let best = null;
    for (let r = 0; r < runs.length; r++) {
      if (!fronts[r] || runs[r].len < 3.5) continue;
      const sc = fronts[r].rank * 10 + runs[r].len;
      if (!best || sc > best.sc) best = { sc, run: runs[r] };
    }
    if (best) for (const u of unitsOf(best.run)) if (!u.biz) u.biz = named[0];
  }
  // all frontages become storefronts in 'all' mode; the building's own business name fills them when there are no POIs
  for (let r = 0; r < runs.length; r++) {
    if (!fronts[r] || runs[r].len < 3.5) continue;
    if (mode === 'all' || (named.length && !pois.length)) {
      const units = unitsOf(runs[r]);
      if (named.length && !pois.length) for (const u of units) if (!u.biz) u.biz = named[0];
    }
  }
  if (!byRun.size) {
    // a retail building with no street frontage found: its longest wall
    if (mode !== 'all' && !named.length) return null;
    const run = runs.reduce((p, q) => (q.len > p.len ? q : p));
    if (run.len < 3) return null;
    const units = unitsOf(run);
    if (named.length) for (const u of units) u.biz = named[0];
  }
  const out = { runs: [], shopEdges: new Set(), split: new Map() };
  let k = 0;
  for (const [run, units] of byRun) {
    // generic units (category words) in retail streets; nothing in 'poi' mode
    for (const u of units) {
      if (u.biz) continue;
      const h = hashStr(`${b.id}:${k++}:${seed}`);
      if (mode === 'all' && h % 100 < 55) u.biz = { name: GENERIC_SIGNS[(h >>> 8) % GENERIC_SIGNS.length], type: 'generic', generic: true };
    }
    // groups of consecutive units sharing a business (a building-name sign spans them)
    const groups = [];
    for (const u of units) {
      const last = groups[groups.length - 1];
      if (last && last.biz && last.biz === u.biz && u.biz.fromName) last.s1 = u.s1;
      else groups.push({ s0: u.s0, s1: u.s1, biz: u.biz });
    }
    out.runs.push({ run, units, groups });
    for (const e of run.edges) {
      out.shopEdges.add(e.i);
      const ts = [];
      for (const u of units) { const s = u.s1; if (s > e.s0 + 0.05 && s < e.s0 + e.len - 0.05) ts.push((s - e.s0) / e.len); }
      if (ts.length) out.split.set(e.i, ts);
    }
  }
  return out;
}

// ---------------------------------------------------------------- atlas buffers (signs, blades, café furniture)
export class AtlasBuffer {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; }
  get empty() { return this.idx.length === 0; }
  _v(x, y, z, nx, ny, nz, u, v) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); return this.p.length / 3 - 1; }
  // P: 4 points CCW seen from the front; UV: 4 [u, v] (or one [u, v] for all)
  quad(P, UV, double = false) {
    const [a, b, c] = P;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const uvAt = (k) => (Array.isArray(UV[0]) ? UV[k] : UV);
    const i = P.map((p, k) => this._v(p[0], p[1], p[2], nx, ny, nz, uvAt(k)[0], uvAt(k)[1]));
    this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
    if (double) {
      const j = P.map((p, k) => this._v(p[0], p[1], p[2], -nx, -ny, -nz, uvAt(k)[0], uvAt(k)[1]));
      this.idx.push(j[0], j[2], j[1], j[0], j[3], j[2]);
    }
  }
  tri(A, B, C, uv, double = false) { this.quad([A, B, C, C], uv, double); }
  // oriented box in a wall frame (s along, d out, y up), solid colour uv; faces: sides + top (+ bottom)
  box(f, s0, s1, d0, d1, y0, y1, uv, bottom = false) {
    const P = (s, d, y) => [f.ox + f.tx * s + f.nx * d, y, f.oz + f.tz * s + f.nz * d];
    const q = (a, b, c, d) => this.quad([a, b, c, d], uv);
    // winding: choose per face by the outward direction (quad() derives the normal from the winding)
    const face = (pts, out) => {
      const [a, b, c] = pts;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * out[0] + ny * out[1] + nz * out[2] < 0) pts.reverse();
      q(...pts);
    };
    const T = [f.tx, 0, f.tz], N = [f.nx, 0, f.nz];
    face([P(s0, d1, y0), P(s1, d1, y0), P(s1, d1, y1), P(s0, d1, y1)], N);
    face([P(s0, d0, y0), P(s1, d0, y0), P(s1, d0, y1), P(s0, d0, y1)], N.map((v) => -v));
    face([P(s1, d0, y0), P(s1, d1, y0), P(s1, d1, y1), P(s1, d0, y1)], T);
    face([P(s0, d0, y0), P(s0, d1, y0), P(s0, d1, y1), P(s0, d0, y1)], T.map((v) => -v));
    face([P(s0, d0, y1), P(s1, d0, y1), P(s1, d1, y1), P(s0, d1, y1)], [0, 1, 0]);
    if (bottom) face([P(s0, d0, y0), P(s1, d0, y0), P(s1, d1, y0), P(s0, d1, y0)], [0, -1, 0]);
  }
  // polygon (3 or 4 points) wound so that its normal agrees with out
  _face(pts, out, uv, double = false) {
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const flip = nx * out[0] + ny * out[1] + nz * out[2] < 0;
    const q = pts.length === 3 ? (flip ? [a, c, b, b] : [a, b, c, c]) : (flip ? pts.slice().reverse() : pts);
    this.quad(q, uv, double);
  }
  cyl(cx, cz, r, y0, y1, seg, uv, top = true, bottom = false) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const A = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], B = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
      const A1 = [A[0], y1, A[2]], B1 = [B[0], y1, B[2]];
      this._face([A, B, B1, A1], [Math.cos(am), 0, Math.sin(am)], uv);
      if (top) this._face([[cx, y1, cz], A1, B1], [0, 1, 0], uv);
      if (bottom) this._face([[cx, y0, cz], A, B], [0, -1, 0], uv);
    }
  }
  toMesh(material, name) {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, material);
    m.name = name;
    // thin boards / small furniture: receive shadows only (casting would add a draw per shadow pass for little gain)
    m.castShadow = false; m.receiveShadow = true;
    m.matrixAutoUpdate = false; m.updateMatrix();
    this.tris = this.idx.length / 3;
    this.p = this.n = this.uv = this.idx = null;
    return m;
  }
}

// Screen-right direction on a vertical face with horizontal normal (nx, nz): text runs this way.
const rightOf = (nx, nz) => [nz, -nx];

// ---------------------------------------------------------------- storefront geometry
/**
 * One storefront run. o = {
 *   plan ({ run, units, groups }), groundOf(s0, s1) → pavement y of that unit, shopH,
 *   E(slot, tint) → building surface emitter, slots { trim, stone, awningSolid, awningStriped }, tintFor,
 *   signage, defer(kind 'far'|'near', fn(buf, sg)), near (bool: build small street furniture), street, fp, selfId,
 *   ledgeColor, corniceColor }
 */
export function emitStorefrontRun(o) {
  const { plan, groundOf, shopH, E, slots, tintFor, signage } = o;
  const f = shopH / 4.5; // storefront texture is painted for a 4.5 m storey
  const run = plan.run;
  const trimLedge = E(slots.stone, tintFor(o.ledgeColor || '#cfc8b8'));
  const trimCornice = E(slots.trim, tintFor(o.corniceColor || '#3a3835'));
  // per unit: stone ledge under the sign frieze + a projecting storefront cornice at the top of the storey
  for (const u of plan.units) {
    const g = groundOf(u);
    for (const s of runSegs(run, u.s0, u.s1)) {
      emitFrameBox(trimLedge, trimLedge, trimLedge, s.ox, s.oz, s.tx, s.tz, s.nx, s.nz, 0.3, s.len - 0.3, 0, 0.12, g + 3.36 * f, g + 3.47 * f);
      emitFrameBox(trimCornice, trimCornice, trimCornice, s.ox, s.oz, s.tx, s.tz, s.nx, s.nz, -0.02, s.len + 0.02, 0, 0.2, g + shopH - 0.2, g + shopH);
    }
  }
  for (const grp of plan.groups) {
    const biz = grp.biz;
    const g = groundOf(grp);
    const st = biz ? businessStyle(biz) : null;
    const segs = runSegs(run, grp.s0 + 0.4, grp.s1 - 0.4);
    if (!segs.length) continue;
    const main = segs.reduce((p, q) => (q.len > p.len ? q : p));
    // ---- awning / canopy (building buffer: tinted fabric, casts shadow on the shop window)
    const yA = g + 3.3 * f;
    if (st && st.awning) {
      const striped = !!st.awning.striped;
      const em = E(striped ? slots.awningStriped : slots.awningSolid, tintFor(st.awning.color));
      const D = 1.25, drop = 0.62, val = 0.26;
      for (const s of segs) {
        const P = (ss, d, y) => [s.ox + s.tx * ss + s.nx * d, y, s.oz + s.tz * ss + s.nz * d];
        const L = s.len, sl = Math.hypot(D, drop);
        const [rx, rz] = rightOf(s.nx, s.nz);
        const flip = rx * s.tx + rz * s.tz < 0; // along-wall direction vs screen-right
        const U = (ss) => (flip ? L - ss : ss) + s.sa;
        // slope (wall-top edge → front edge; normal up / out)
        emitQuad(em, [P(0, 0.02, yA), P(L, 0.02, yA), P(L, D, yA - drop), P(0, D, yA - drop)], [[U(0), sl], [U(L), sl], [U(L), 0], [U(0), 0]], true);
        // valance
        emitQuad(em, [P(0, D, yA - drop - val), P(L, D, yA - drop - val), P(L, D, yA - drop), P(0, D, yA - drop)], [[U(0), -val], [U(L), -val], [U(L), 0], [U(0), 0]], true);
        // side cheeks (triangles)
        for (const ss of [0, L]) emitQuad(em, [P(ss, 0.02, yA), P(ss, D, yA - drop), P(ss, D, yA - drop - val), P(ss, 0.02, yA - drop * 0.1)], [[0, sl], [D, 0], [D, -val], [0, sl * 0.9]], true);
      }
    } else if (st && st.canopy) {
      const em = E(slots.trim, tintFor('#2b2e31'));
      for (const s of segs) emitFrameBox(em, em, em, s.ox, s.oz, s.tx, s.tz, s.nx, s.nz, -0.1, s.len + 0.1, 0, 1.05, yA - 0.05, yA + 0.16);
    }
    if (!biz) continue;
    // ---- fascia sign board (atlas: far LOD)
    const text = signText(st.text || biz.name);
    const bh = clamp(0.74 * f, 0.55, 0.8);
    const yb = g + 3.98 * f - bh / 2;
    const bw = Math.min(main.len - (st.blade && !biz.generic && o.near ? 2.2 : 0.2), biz.fromName ? 12 : 9, Math.max(2.4, text.length * bh * 0.62 + 1.2));
    if (bw < 1.2) continue;
    const cell = signage.board(text, st);
    const sc = main.len / 2;
    o.defer('far', (buf, sg) => emitBoard(buf, sg, main, sc, bw, bh, yb, cell));
    // ---- projecting blade sign + café furniture (near LOD, not on 'low')
    if (!o.near) continue;
    const endS = grp.s0 < 0.5 ? grp.s1 - 0.45 : grp.s0 + 0.45;
    if (st.blade && !biz.generic) {
      const bl = signage.blade(text, st);
      const p = runPoint(run, endS);
      o.defer('near', (buf, sg) => emitBlade(buf, sg, p, g + 3.05 * f + 0.9, bl));
    }
    if (st.tables > 0) {
      const umbrella = !st.awning && !st.canopy && (hashStr(text) & 1) === 1;
      const n = Math.min(st.tables, Math.floor((grp.s1 - grp.s0 - 1.2) / 1.9));
      const spots = [];
      for (let k = 0; k < n; k++) {
        const s = grp.s0 + (grp.s1 - grp.s0) / 2 + (k - (n - 1) / 2) * 1.95;
        const p = runPoint(run, s);
        const d = umbrella ? 1.9 : 1.45;
        const x = p.x + p.nx * d, z = p.z + p.nz * d;
        if (o.street.clearance(x, z) < (umbrella ? 1.5 : 1.0) || o.fp.inside(x, z, o.selfId)) continue;
        spots.push({ x, z, tx: p.tx, tz: p.tz, y: o.heightAt(x, z) });
      }
      const fabric = st.awning?.color ? null : ['green', 'cream', 'red', 'navy', 'teal'][hashStr(text) % 5];
      if (spots.length) o.defer('near', (buf, sg) => { for (const sp of spots) emitCafeSet(buf, sg, sp, umbrella ? fabric : null); });
      // sandwich board by the door
      const pb = runPoint(run, grp.s0 + 0.9);
      const bx = pb.x + pb.nx * 1.0, bz = pb.z + pb.nz * 1.0;
      if (o.street.clearance(bx, bz) > 0.8) o.defer('near', (buf, sg) => emitAFrame(buf, sg, bx, o.heightAt(bx, bz), bz, pb.tx, pb.tz));
    }
  }
}

export function emitBoard(buf, sg, s, sc, bw, bh, yb, cell) {
  const fr = { ox: s.ox, oz: s.oz, tx: s.tx, tz: s.tz, nx: s.nx, nz: s.nz };
  const s0 = sc - bw / 2, s1 = sc + bw / 2, d0 = 0.03, d1 = 0.13;
  buf.box(fr, s0, s1, d0, d1 - 0.005, yb, yb + bh, sg.swatch('black'), true);
  // front face: text cell (8:1 max) in the middle, plain ends sampled from the cell's edge column
  const [rx, rz] = rightOf(s.nx, s.nz);
  const dir = rx * s.tx + rz * s.tz >= 0 ? 1 : -1; // along-wall sign of screen-right
  const [u0, v0, u1, v1] = cell.rect;
  const cw = Math.min(bw, bh * cell.aspect);
  const P = (ss, y) => [s.ox + s.tx * ss + s.nx * d1, y, s.oz + s.tz * ss + s.nz * d1];
  // left → right along screen-right
  const L = dir > 0 ? s0 : s1;
  const at = (k) => L + dir * k; // k metres to the right of the left end
  const face = (k0, k1, ua, ub) => buf.quad([P(at(k0), yb), P(at(k1), yb), P(at(k1), yb + bh), P(at(k0), yb + bh)], [[ua, v0], [ub, v0], [ub, v1], [ua, v1]]);
  const side = (bw - cw) / 2;
  if (side > 0.01) { face(0, side, cell.edgeU, cell.edgeU); face(bw - side, bw, cell.edgeU, cell.edgeU); }
  face(side, side + cw, u0, u1);
}

function emitBlade(buf, sg, p, y, cell) {
  const fr = { ox: p.x, oz: p.z, tx: p.tx, tz: p.tz, nx: p.nx, nz: p.nz };
  const metal = sg.swatch('black');
  buf.box(fr, -0.03, 0.03, 0, 1.12, y + 0.02, y + 0.07, metal, true);        // bracket arm
  buf.box(fr, -0.04, 0.04, 0, 0.06, y - 0.66, y + 0.1, metal);               // wall plate
  const bw = 0.84, bh = 0.56, d0 = 0.24, yb = y - 0.02 - bh;
  buf.box(fr, -0.02, 0.02, d0 + 0.04, d0 + 0.07, yb + bh, y + 0.02, metal);  // hangers
  buf.box(fr, -0.02, 0.02, d0 + bw - 0.07, d0 + bw - 0.04, yb + bh, y + 0.02, metal);
  const [u0, v0, u1, v1] = cell.rect;
  for (const side of [1, -1]) {
    const nx = p.tx * side, nz = p.tz * side;
    const [rx, rz] = rightOf(nx, nz);
    const out = rx * p.nx + rz * p.nz >= 0; // screen-right points away from the wall
    const off = 0.025 * side;
    const P = (d, yy) => [p.x + p.nx * d + p.tx * off, yy, p.z + p.nz * d + p.tz * off];
    const dl = out ? d0 : d0 + bw, dr = out ? d0 + bw : d0;
    buf.quad([P(dl, yb), P(dr, yb), P(dr, yb + bh), P(dl, yb + bh)], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }
  buf.box(fr, -0.018, 0.018, d0, d0 + bw, yb, yb + bh, sg.swatch('black'), true); // panel edges (text faces sit just outside)
}

function emitCafeSet(buf, sg, sp, fabric) {
  const { x, z, y } = sp;
  const metal = sg.swatch('black'), top = sg.swatch('chrome'), seat = sg.swatch('metal');
  buf.cyl(x, z, 0.36, y + 0.72, y + 0.75, 8, top, true);
  buf.cyl(x, z, 0.035, y, y + 0.72, 5, metal, false);
  buf.cyl(x, z, 0.22, y, y + 0.025, 8, metal, true);
  for (const side of [-1, 1]) {
    const cx = x + sp.tx * side * 0.62, cz = z + sp.tz * side * 0.62;
    const fr = { ox: cx, oz: cz, tx: sp.tx, tz: sp.tz, nx: -sp.tz, nz: sp.tx };
    buf.box(fr, -0.2, 0.2, -0.2, 0.2, y + 0.43, y + 0.47, seat);
    const back = side > 0 ? [0.17, 0.21] : [-0.21, -0.17];
    buf.box(fr, back[0], back[1], -0.2, 0.2, y + 0.47, y + 0.86, seat);
    for (const [ls, ld] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) buf.box(fr, ls - 0.015, ls + 0.015, ld - 0.015, ld + 0.015, y, y + 0.43, metal);
  }
  if (fabric) {
    buf.cyl(x, z, 0.025, y + 0.75, y + 2.35, 5, metal, false);
    const col = sg.swatch(fabric), R = 1.15, yr = y + 2.02, ya = y + 2.42, seg = 8;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      buf.tri([x + Math.cos(a0) * R, yr, z + Math.sin(a0) * R], [x, ya, z], [x + Math.cos(a1) * R, yr, z + Math.sin(a1) * R], col, true);
    }
  }
}

function emitAFrame(buf, sg, x, y, z, tx, tz) {
  const nx = -tz, nz = tx, w = 0.3, H = 0.95, sp = 0.2;
  const board = sg.swatch('black');
  for (const s of [1, -1]) {
    const P = (u, h, d) => [x + tx * u + nx * d * s, y + h, z + tz * u + nz * d * s];
    buf.quad([P(-w, 0, sp), P(w, 0, sp), P(w, H, 0.02), P(-w, H, 0.02)], board, true);
  }
}

// ---------------------------------------------------------------- facade extras (building buffers)
// Bay window (projecting, angled sides) on a street wall: plan trapezoid on the wall at arc length sC.
// bands = facade bands (same emitters / v mapping as the main wall, so the windows line up).
export function emitBay({ run, sC, width = 2.7, depth = 0.72, y0, y1, bands, capEm, bottomEm, colliders, id }) {
  const p = runPoint(run, sC);
  const P = (s, d) => [p.x + p.tx * s + p.nx * d, p.z + p.tz * s + p.nz * d];
  let ring = [P(-width / 2, 0), P(width / 2, 0), P(width / 2 - depth, depth), P(-width / 2 + depth, depth)];
  if (signedArea(ring) < 0) ring = ring.reverse();
  emitWalls(ring, bands.map((b) => ({ ...b, y0, y1: 'top' })), () => y1, {});
  const lid = offsetRing(ring, -0.1, 2);
  emitRingWall(capEm, lid, y1, y1 + 0.28);
  emitCap(capEm, lid, [], y1 + 0.28, 1);
  emitCap(capEm, lid, [], y1, -1);
  if (bottomEm) emitCap(bottomEm, ring, [], y0, -1);
  else colliders?.addPolygon(ring, y0 - 1, y1, id);
}

// Gabled dormer on a mansard front (seg = wall frame at the dormer centre, y0 = eave, t = slope tangent)
export function emitDormer({ p, y0, t, roofEm, trimEm, winEm }) {
  const w = 1.3, d0 = 0.16, fh = 1.5, gh = 0.42;
  const yb = y0 + t * d0, yt = yb + fh;
  const d1 = (yt - y0) / t + 0.35;
  // d = distance INTO the building from the wall line (the mansard slope rises inwards)
  const P = (s, d, y) => [p.x + p.tx * s - p.nx * d, y, p.z + p.tz * s - p.nz * d];
  // cheeks (the box's street face sits just behind the window quad)
  emitFrameBox(roofEm, null, null, p.x, p.z, p.tx, p.tz, -p.nx, -p.nz, -w / 2, w / 2, d0 + 0.03, d1, yb - 0.4, yt);
  const [rx, rz] = rightOf(p.nx, p.nz);
  const dir = rx * p.tx + rz * p.tz >= 0 ? 1 : -1;
  const L = -dir * w / 2, R = dir * w / 2;
  emitQuad(winEm, [P(L, d0, yb), P(R, d0, yb), P(R, d0, yt), P(L, d0, yt)], [[0, 0.12], [1.3, 0.12], [1.3, 1.78], [0, 1.78]]);
  // pediment + gable roof
  emitQuad(trimEm, [P(L, d0, yt), P(R, d0, yt), P(0, d0, yt + gh), P(0, d0, yt + gh)], [[0, 0], [w, 0], [w / 2, gh], [w / 2, gh]]);
  const e = w / 2 + 0.1, df = d0 - 0.1;
  for (const sd of [-1, 1]) {
    const q = [P(sd * e, df, yt - 0.04), P(sd * e, d1, yt - 0.04), P(0, d1, yt + gh), P(0, df, yt + gh)];
    const up = [[0, 0], [d1 - df, 0], [d1 - df, 0.75], [0, 0.75]];
    const ax = q[1][0] - q[0][0], az = q[1][2] - q[0][2], bx = q[2][0] - q[0][0], bz = q[2][2] - q[0][2];
    if (az * bx - ax * bz < 0) { q.reverse(); up.reverse(); } // normal must point up
    emitQuad(roofEm, q, up);
    emitQuad(trimEm, q.map(([x, y, z]) => [x, y - 0.06, z]).reverse(), up.slice().reverse());
  }
}

// Black steel fire escape on a wall (atlas buffer, near LOD): landings at every upper floor, zig-zag stairs, drop
// ladder. floors = [y of each landing], p = wall frame (runPoint) at the centre, uv = paint swatch.
export function emitFireEscape({ p, floors, buf, uv, width = 3.3, depth = 1.15 }) {
  const f = { ox: p.x, oz: p.z, tx: p.tx, tz: p.tz, nx: p.nx, nz: p.nz };
  const B = (s0, s1, d0, d1, y0, y1, caps = false) => buf.box(f, s0, s1, d0, d1, y0, y1, uv, caps);
  const P = (s, d, y) => [p.x + p.tx * s + p.nx * d, y, p.z + p.tz * s + p.nz * d];
  const hw = width / 2;
  for (let k = 0; k < floors.length; k++) {
    const y = floors[k];
    B(-hw, hw, 0.05, depth, y - 0.07, y, true);                       // landing (grating)
    B(-hw, hw, depth - 0.04, depth, y + 0.95, y + 1.0, true);         // top rail
    B(-hw, hw, depth - 0.03, depth, y + 0.45, y + 0.48);              // mid rail
    for (const s of [-hw, hw]) { B(s - 0.025, s + 0.025, 0.05, depth, y + 0.95, y + 1.0); B(s - 0.025, s + 0.025, depth - 0.05, depth, y - 0.07, y + 1.0); }
    B(-0.025, 0.025, depth - 0.05, depth, y - 0.07, y + 1.0);
    if (k + 1 < floors.length) {
      // stair to the next landing (alternating direction) on the inner half of the landing, with hand rails
      const y2 = floors[k + 1], dir = k % 2 ? -1 : 1;
      const sA = -dir * (hw - 0.3), sB = dir * (hw - 0.9);
      const dA = 0.45, dB = depth - 0.1;
      buf.quad([P(sA, dA, y), P(sB, dA, y2), P(sB, dB, y2), P(sA, dB, y)], uv, true);
      for (const dd of [dA, dB]) buf.quad([P(sA, dd, y + 0.9), P(sB, dd, y2 + 0.9), P(sB, dd, y2 + 0.95), P(sA, dd, y + 0.95)], uv, true);
    }
  }
  const y1 = floors[0], sL = hw - 0.6;
  for (const s of [sL - 0.22, sL + 0.22]) B(s - 0.02, s + 0.02, depth - 0.12, depth - 0.08, y1 - 2.3, y1);
  for (let yy = y1 - 2.1; yy < y1 - 0.1; yy += 0.35) B(sL - 0.22, sL + 0.22, depth - 0.115, depth - 0.085, yy, yy + 0.03);
}

// Cornice brackets / dentils (atlas buffer, near LOD) under the corona built by roofs.emitBracketCornice.
export function emitCorniceDetail(buf, uv, segs, yTop, opts = {}) {
  const out = opts.out ?? 0.55, ch = opts.corona ?? 0.3, fh = opts.frieze ?? 0.55;
  for (const s of segs) {
    if (s.len < 0.8) continue;
    const box = (s0, s1, d0, d1, y0, y1) => buf.box(s, s0, s1, d0, d1, y0, y1, uv, true);
    if (opts.dentil) {
      for (let x = 0.14; x < s.len - 0.12; x += 0.26) box(x, x + 0.12, 0.06, 0.19, yTop - ch - 0.15, yTop - ch);
    } else {
      const n = Math.max(2, Math.round(s.len / 1.05) + 1);
      for (let k = 0; k < n; k++) {
        const x = 0.12 + (k * (s.len - 0.24)) / (n - 1);
        box(x - 0.07, x + 0.07, 0.06, out - 0.06, yTop - ch - 0.22, yTop - ch);
        box(x - 0.055, x + 0.055, 0.06, out * 0.45, yTop - ch - fh + 0.06, yTop - ch - 0.22);
      }
    }
  }
}
