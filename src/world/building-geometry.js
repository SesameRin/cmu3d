// Low-level geometry helpers for the generic buildings: growable vertex buffers that carry a per-vertex tint
// (vertex colour) and building index (`bid`), plus polygon utilities, wall/cap/box emitters.
//
// Conventions: footprints are [[x, z], ...] rings, outer rings counter-clockwise in the x/z math sense
// (signed area > 0), holes clockwise. For any ring, the "outward" wall normal of edge a→b is (dz, -dx)/len,
// which points away from the solid for outer rings and into the courtyard for holes.
import * as THREE from 'three';

// ---------------------------------------------------------------- buffers
// Growable typed-array vertex buffer. GPU vertex format (36 B / vertex instead of 13 floats = 52 B):
//   position  Float32 x3
//   normal    Int8 x4, normalized (w unused; 4 components keep the format native on D3D11 / Metal)
//   uv        Float32 x2 (layer-tile units)
//   tint      Uint16 x4, normalized: linear-space tint / TINT_RANGE (w unused)
//   bidLayer  Uint16 x2, integer attribute (uvec2): building group index, texture-array layer
// The JS arrays are released by toGeometry() (a buffer is single-use), so nothing but the GPU-ready typed
// arrays stays alive after the buildings are built.
export const TINT_RANGE = 4;
export class GeoBuffer {
  constructor(cap = 2048) {
    this.count = 0; this.ni = 0;
    this._alloc(cap, cap * 3);
  }
  _alloc(vcap, icap) {
    const o = this;
    const grow = (Ctor, old, n) => { const a = new Ctor(n); if (old) a.set(old.subarray(0, Math.min(old.length, n))); return a; };
    if (!o.p || vcap !== o.vcap) {
      o.p = grow(Float32Array, o.p, vcap * 3); o.n = grow(Int8Array, o.n, vcap * 4); o.uv = grow(Float32Array, o.uv, vcap * 2);
      o.c = grow(Uint16Array, o.c, vcap * 4); o.bl = grow(Uint16Array, o.bl, vcap * 2);
      o.vcap = vcap;
    }
    if (!o.i || icap !== o.icap) { o.i = grow(Uint32Array, o.i, icap); o.icap = icap; }
  }
  // make room for one more vertex / three more indices
  _vroom() { if (this.count >= this.vcap) this._alloc(this.vcap * 2, this.icap); }
  _iroom() { if (this.ni + 3 > this.icap) this._alloc(this.vcap, this.icap * 2); }
  toGeometry() {
    const n = this.count, ni = this.ni;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.n.slice(0, n * 4), 4, true));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    g.setAttribute('tint', new THREE.BufferAttribute(this.c.slice(0, n * 4), 4, true));
    const bl = new THREE.BufferAttribute(this.bl.slice(0, n * 2), 2);
    bl.gpuType = THREE.IntType; // → vertexAttribIPointer, read as uvec2 in the shader
    g.setAttribute('bidLayer', bl);
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? this.i.slice(0, ni) : Uint16Array.from(this.i.subarray(0, ni)), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    this.tris = ni / 3;
    this.p = this.n = this.uv = this.c = this.bl = this.i = null; // single-use: free the growable arrays
    this.vcap = this.icap = 0;
    return g;
  }
  get empty() { return this.ni === 0; }
  get triangles() { return this.p ? this.ni / 3 : this.tris || 0; }
}

// An emitter writes into one buffer with a fixed tint, building index and texture-array layer.
// u/w are given in metres and normalised by the layer's tile size (su = 1/tileW, sv = 1/tileH).
const q16 = (t) => Math.max(0, Math.min(65535, Math.round((t / TINT_RANGE) * 65535)));
export class Emitter {
  constructor(buf, tint, bid, layer = 0, su = 1, sv = 1) {
    this.buf = buf; this.t = tint; this.bid = bid; this.layer = layer; this.su = su; this.sv = sv;
    this.tr = q16(tint[0]); this.tg = q16(tint[1]); this.tb = q16(tint[2]);
  }
  v(x, y, z, nx, ny, nz, u, w) {
    const B = this.buf;
    B._vroom();
    const k = B.count;
    const p = B.p, n = B.n, uv = B.uv, c = B.c, bl = B.bl;
    p[k * 3] = x; p[k * 3 + 1] = y; p[k * 3 + 2] = z;
    n[k * 4] = Math.round(nx * 127); n[k * 4 + 1] = Math.round(ny * 127); n[k * 4 + 2] = Math.round(nz * 127);
    uv[k * 2] = u * this.su; uv[k * 2 + 1] = w * this.sv;
    c[k * 4] = this.tr; c[k * 4 + 1] = this.tg; c[k * 4 + 2] = this.tb;
    bl[k * 2] = this.bid; bl[k * 2 + 1] = this.layer;
    return B.count++;
  }
  tri(a, b, c) {
    const B = this.buf; B._iroom();
    const I = B.i, j = B.ni; I[j] = a; I[j + 1] = b; I[j + 2] = c; B.ni = j + 3;
  }
  // Triangle that is flipped if needed so its geometric normal agrees with (nx, ny, nz).
  triFacing(a, b, c, nx, ny, nz) {
    const P = this.buf.p;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * nx + cy * ny + cz * nz >= 0) this.tri(a, b, c); else this.tri(a, c, b);
  }
}

// ---------------------------------------------------------------- polygon utilities
export function signedArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s / 2;
}

// Remove consecutive duplicates / nearly collinear micro-vertices.
export function cleanRing(ring, eps = 0.05) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push([p[0], p[1]]);
  }
  while (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
  return out;
}

// Offset every edge towards its LEFT side by d (left = interior of a CCW ring, the solid side of a CW hole).
// Negative d offsets outward. Miter joints, clamped at sharp corners.
export function offsetRing(ring, d, maxMiter = 3) {
  const n = ring.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = ring[i], a = ring[(i + n - 1) % n], b = ring[(i + 1) % n];
    let d1x = p[0] - a[0], d1z = p[1] - a[1]; const l1 = Math.hypot(d1x, d1z) || 1; d1x /= l1; d1z /= l1;
    let d2x = b[0] - p[0], d2z = b[1] - p[1]; const l2 = Math.hypot(d2x, d2z) || 1; d2x /= l2; d2z /= l2;
    const n1x = -d1z, n1z = d1x, n2x = -d2z, n2z = d2x; // left normals
    const dot = n1x * n2x + n1z * n2z;
    let k = 1 / Math.max(1 + dot, 1e-6);
    let mx = (n1x + n2x) * k, mz = (n1z + n2z) * k;
    const ml = Math.hypot(mx, mz);
    if (ml > maxMiter) { mx *= maxMiter / ml; mz *= maxMiter / ml; }
    if (1 + dot < 1e-4) { mx = n1x; mz = n1z; } // hairpin: fall back to one normal
    out[i] = [p[0] + mx * d, p[1] + mz * d];
  }
  return out;
}

// Sutherland–Hodgman clip of a polygon against the half-plane a*x + b*z + c <= 0.
export function clipHalfPlane(poly, a, b, c) {
  const out = [];
  const n = poly.length;
  if (!n) return out;
  let prev = poly[n - 1], pv = a * prev[0] + b * prev[1] + c;
  for (let i = 0; i < n; i++) {
    const cur = poly[i], cv = a * cur[0] + b * cur[1] + c;
    const cin = cv <= 0, pin = pv <= 0;
    if (cin !== pin) {
      const t = pv / (pv - cv);
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (cin) out.push(cur);
    prev = cur; pv = cv;
  }
  return out;
}

// Triangulate a polygon (with optional holes). Returns { pts:[[x,z]...], tris:[i,j,k,...] }.
const _v2 = (p) => new THREE.Vector2(p[0], p[1]);
export function triangulate(ring, holes = []) {
  const contour = ring.map(_v2);
  const hv = holes.map((h) => h.map(_v2));
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, hv); } catch { faces = []; }
  const pts = ring.concat(...holes);
  const tris = [];
  for (const f of faces) tris.push(f[0], f[1], f[2]);
  return { pts, tris };
}

// Horizontal cap at height y(x,z) (number or function) facing up (dir=1) or down (dir=-1).
// uvFn(x, z) → [u, v]; defaults to world metres.
export function emitCap(em, ring, holes, y, dir = 1, uvFn = null) {
  const { pts, tris } = triangulate(ring, holes);
  if (!tris.length) return;
  const base = [];
  for (const p of pts) {
    const yy = typeof y === 'function' ? y(p[0], p[1]) : y;
    const uv = uvFn ? uvFn(p[0], p[1]) : [p[0], -p[1]];
    base.push(em.v(p[0], yy, p[1], 0, dir, 0, uv[0], uv[1]));
  }
  for (let i = 0; i < tris.length; i += 3) em.triFacing(base[tris[i]], base[tris[i + 1]], base[tris[i + 2]], 0, dir, 0);
}

// Vertical strip between two rings of equal length (e.g. outset ring for cornices), at heights y0..y1.
// Faces outward (normal (dz,-dx)) unless inward=true.
export function emitRingWall(em, ring, y0, y1, inward = false) {
  const n = ring.length;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    let nx = dz / len, nz = -dx / len;
    if (inward) { nx = -nx; nz = -nz; }
    const i0 = em.v(a[0], y0, a[1], nx, 0, nz, u, y0);
    const i1 = em.v(b[0], y0, b[1], nx, 0, nz, u + len, y0);
    const i2 = em.v(b[0], y1, b[1], nx, 0, nz, u + len, y1);
    const i3 = em.v(a[0], y1, a[1], nx, 0, nz, u, y1);
    em.triFacing(i0, i2, i1, nx, 0, nz); em.triFacing(i0, i3, i2, nx, 0, nz);
    u += len;
  }
}

// Horizontal band between two rings of equal length at heights yA (ring A) and yB (ring B), facing dir (1 up, -1 down).
export function emitRingBand(em, ringA, ringB, yA, yB, dir = 1) {
  const n = ringA.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = ringA[i], a1 = ringA[j], b0 = ringB[i], b1 = ringB[j];
    const i0 = em.v(a0[0], yA, a0[1], 0, dir, 0, a0[0], -a0[1]);
    const i1 = em.v(a1[0], yA, a1[1], 0, dir, 0, a1[0], -a1[1]);
    const i2 = em.v(b1[0], yB, b1[1], 0, dir, 0, b1[0], -b1[1]);
    const i3 = em.v(b0[0], yB, b0[1], 0, dir, 0, b0[0], -b0[1]);
    em.triFacing(i0, i1, i2, 0, dir, 0); em.triFacing(i0, i2, i3, 0, dir, 0);
  }
}

// Oriented box (no bottom). (cx, cz) centre, hx/hz half sizes along the local axes, angle = footprintFrame angle
// (local +u = (cos a, sin a) in x/z). topEm may differ from sideEm (e.g. roof material on top).
export function emitBox(sideEm, topEm, cx, cz, hx, hz, angle, y0, y1) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const P = (u, v) => [cx + u * c - v * s, cz + u * s + v * c];
  const ring = [P(-hx, -hz), P(hx, -hz), P(hx, hz), P(-hx, hz)];
  if (signedArea(ring) < 0) ring.reverse();
  emitRingWall(sideEm, ring, y0, y1);
  if (topEm) emitCap(topEm, ring, [], y1, 1);
  return ring;
}

// Short vertical cylinder (vents, tanks, columns). Side only + optional top.
export function emitCylinder(sideEm, topEm, cx, cz, r, y0, y1, seg = 8) {
  const ring = [];
  for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  // ring is CCW in the x/z math sense → outward normals
  const n = seg;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const ma = [(a[0] - cx) / r, (a[1] - cz) / r], mb = [(b[0] - cx) / r, (b[1] - cz) / r];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const i0 = sideEm.v(a[0], y0, a[1], ma[0], 0, ma[1], u, y0);
    const i1 = sideEm.v(b[0], y0, b[1], mb[0], 0, mb[1], u + len, y0);
    const i2 = sideEm.v(b[0], y1, b[1], mb[0], 0, mb[1], u + len, y1);
    const i3 = sideEm.v(a[0], y1, a[1], ma[0], 0, ma[1], u, y1);
    const fx = (ma[0] + mb[0]) / 2, fz = (ma[1] + mb[1]) / 2;
    sideEm.triFacing(i0, i2, i1, fx, 0, fz); sideEm.triFacing(i0, i3, i2, fx, 0, fz);
    u += len;
  }
  if (topEm) emitCap(topEm, ring, [], y1, 1);
}

// ---------------------------------------------------------------- walls
// U mapping inside one straight-ish run of wall so that window bays are centred and never cut by corners.
function fitU(s, L, bay, winW, offset, stretch = false) {
  if (!bay) return s + offset;
  if (L < 0.8 * bay && !stretch) {
    if (L >= winW + 0.5) return bay / 2 - L / 2 + s + offset; // a single centred window
    return -L / 2 + s + offset;                                // plain pier
  }
  const nb = Math.max(1, Math.round(L / bay));
  return s * ((nb * bay) / L) + offset;
}

/**
 * Extruded walls for one ring.
 *  ring   – [[x,z],...]
 *  bands  – stacked bottom → top: [{ em, y0, y1, bay, winW, uOffset, vFn(y, g) }]
 *           y0 / y1: number, 'top' (follows topFn) or a function (g, gv) of the segment's ground height g
 *           (level per segment → stepped storefronts) and the ground under the vertex gv (sloped base courses)
 *  topFn  – (x, z) → wall top height (flat roofs: constant); the band with y1 = 'top' follows it
 *  opts   – { kinkFn(ax,az,bx,bz) → sorted t in (0,1) where the top line bends (pitched roofs),
 *             groundFn(ax,az,bx,bz) → local ground g of a wall segment (terrain-following bands),
 *             vertexGroundFn(x,z) → ground under a wall vertex,
 *             subdiv – max segment length when groundFn is given (stepped storefronts / plinths on slopes),
 *             cornerDeg – turn angle that starts a new window run }
 */
export function emitWalls(ring, bands, topFn, opts = {}) {
  const { kinkFn = null, groundFn = null, vertexGroundFn = null, subdiv = 7, cornerDeg = 28 } = opts;
  // 1. points (with roof kinks / slope subdivisions inserted) and per-point "hard corner" flags
  const pts = [];
  const n0 = ring.length;
  for (let i = 0; i < n0; i++) {
    const a = ring[i], b = ring[(i + 1) % n0];
    pts.push({ x: a[0], z: a[1], orig: true, src: i });
    const ts = kinkFn ? kinkFn(a[0], a[1], b[0], b[1]) : [];
    const split = opts.splitFn ? opts.splitFn(i) : null;
    if (split) {
      // caller-defined breaks (e.g. storefront unit boundaries, so each unit steps down the hill as one piece)
      for (const t of split) if (t > 1e-3 && t < 1 - 1e-3) ts.push(t);
      ts.sort((p, q) => p - q);
    } else if (groundFn) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.floor(len / subdiv);
      for (let s = 1; s <= k; s++) ts.push(s / (k + 1));
      ts.sort((p, q) => p - q);
    }
    let last = -1;
    for (const t of ts) {
      if (t - last < 1e-3) continue;
      last = t;
      pts.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, orig: false, src: i });
    }
  }
  const n = pts.length;
  if (n < 3) return;
  // edges
  const E = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    E.push({ len, nx: len > 1e-6 ? dz / len : 0, nz: len > 1e-6 ? -dx / len : 0, dx: len > 1e-6 ? dx / len : 0, dz: len > 1e-6 ? dz / len : 0 });
  }
  // corner flags: angle between incoming and outgoing edge directions
  const cosLim = Math.cos((cornerDeg * Math.PI) / 180);
  const corner = new Array(n).fill(false);
  let anyCorner = false;
  for (let i = 0; i < n; i++) {
    if (!pts[i].orig) continue;
    const e1 = E[(i + n - 1) % n], e2 = E[i];
    if (e1.len < 1e-6 || e2.len < 1e-6) continue;
    if (e1.dx * e2.dx + e1.dz * e2.dz < cosLim) { corner[i] = true; anyCorner = true; }
  }
  if (!anyCorner) corner[0] = true; // closed smooth loop (round building): start the single run anywhere
  const bandY = (y, g, gv, top) => (y === 'top' ? top : typeof y === 'function' ? Math.min(y(g, gv), top) : Math.min(y, top));
  const gvCache = vertexGroundFn ? pts.map((q) => vertexGroundFn(q.x, q.z)) : null;
  // 2. runs: start at each corner, run until the next corner
  const start = corner.indexOf(true);
  let i = start;
  do {
    const run = [];
    let j = i;
    do { run.push(j); j = (j + 1) % n; } while (!corner[j] && j !== start);
    let L = 0; for (const k of run) L += E[k].len;
    let s = 0;
    for (let r = 0; r < run.length; r++) {
      const k = run[r], e = E[k];
      if (e.len < 1e-6) continue;
      const a = pts[k], b = pts[(k + 1) % n];
      // per-point normals: smooth inside the run, edge normal at run ends
      let nax = e.nx, naz = e.nz, nbx = e.nx, nbz = e.nz;
      if (r > 0) { const p = E[run[r - 1]]; nax = e.nx + p.nx; naz = e.nz + p.nz; const l = Math.hypot(nax, naz) || 1; nax /= l; naz /= l; }
      if (r < run.length - 1) { const q = E[run[r + 1]]; nbx = e.nx + q.nx; nbz = e.nz + q.nz; const l = Math.hypot(nbx, nbz) || 1; nbx /= l; nbz /= l; }
      const topA = topFn(a.x, a.z), topB = topFn(b.x, b.z);
      const g = groundFn ? groundFn(a.x, a.z, b.x, b.z) : 0;
      const gva = gvCache ? gvCache[k] : g, gvb = gvCache ? gvCache[(k + 1) % n] : g;
      for (const band0 of bands) {
        // per-edge override (e.g. storefront glazing only on the street-facing walls): band.alt(sourceEdgeIndex)
        const band = band0.alt ? band0.alt(a.src) || band0 : band0;
        const ya0 = bandY(band.y0, g, gva, topA), yb0 = bandY(band.y0, g, gvb, topB);
        let ya1 = bandY(band.y1, g, gva, topA), yb1 = bandY(band.y1, g, gvb, topB);
        if (ya1 <= ya0 + 1e-3 && yb1 <= yb0 + 1e-3) continue;
        ya1 = Math.max(ya1, ya0); yb1 = Math.max(yb1, yb0);
        const ua = fitU(s, L, band.bay, band.winW, band.uOffset || 0, band.stretch);
        const ub = fitU(s + e.len, L, band.bay, band.winW, band.uOffset || 0, band.stretch);
        const vf = band.vFn, em = band.em;
        const i0 = em.v(a.x, ya0, a.z, nax, 0, naz, ua, vf(ya0, g));
        const i1 = em.v(b.x, yb0, b.z, nbx, 0, nbz, ub, vf(yb0, g));
        const i2 = em.v(b.x, yb1, b.z, nbx, 0, nbz, ub, vf(yb1, g));
        const i3 = em.v(a.x, ya1, a.z, nax, 0, naz, ua, vf(ya1, g));
        em.tri(i0, i2, i1); em.tri(i0, i3, i2);
      }
      s += e.len;
    }
    i = j;
  } while (i !== start);
}

// Arbitrary planar quad P = [[x,y,z] x4] (counter-clockwise seen from its front side), UV = [[u,v] x4] in metres.
// double = also emit the back face (thin fabric / sheet metal seen from both sides).
export function emitQuad(em, P, UV, double = false) {
  const [a, b, c] = P;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const i = P.map((p, k) => em.v(p[0], p[1], p[2], nx, ny, nz, UV[k][0], UV[k][1]));
  em.tri(i[0], i[1], i[2]); em.tri(i[0], i[2], i[3]);
  if (double) {
    const j = P.map((p, k) => em.v(p[0], p[1], p[2], -nx, -ny, -nz, UV[k][0], UV[k][1]));
    em.tri(j[0], j[2], j[1]); em.tri(j[0], j[3], j[2]);
  }
}

// Box in a wall frame: origin (ox, oz) on the wall line, t = along-wall unit, n = outward unit.
// Spans along-wall [s0, s1], out from the wall [d0, d1], heights [y0, y1]. Emits the 4 sides (+ top / bottom when
// the emitters are given). UVs in metres (u along the face, v = y).
export function emitFrameBox(sideEm, topEm, botEm, ox, oz, tx, tz, nx, nz, s0, s1, d0, d1, y0, y1) {
  const P = (s, d) => [ox + tx * s + nx * d, oz + tz * s + nz * d];
  const ring = [P(s0, d0), P(s1, d0), P(s1, d1), P(s0, d1)];
  if (signedArea(ring) < 0) ring.reverse();
  emitRingWall(sideEm, ring, y0, y1);
  if (topEm) emitCap(topEm, ring, [], y1, 1);
  if (botEm) emitCap(botEm, ring, [], y0, -1);
  return ring;
}

// Vertical quad on a wall plane (doors, signs): centre (cx, cz), along-wall unit (tx, tz), outward normal (nx, nz),
// width w, from y0 to y1. UVs in metres (u 0..w, v 0..h).
export function emitWallQuad(em, cx, cz, tx, tz, nx, nz, w, y0, y1) {
  const hw = w / 2;
  const ax = cx - tx * hw, az = cz - tz * hw, bx = cx + tx * hw, bz = cz + tz * hw;
  const h = y1 - y0;
  const i0 = em.v(ax, y0, az, nx, 0, nz, 0, 0);
  const i1 = em.v(bx, y0, bz, nx, 0, nz, w, 0);
  const i2 = em.v(bx, y1, bz, nx, 0, nz, w, h);
  const i3 = em.v(ax, y1, az, nx, 0, nz, 0, h);
  em.triFacing(i0, i1, i2, nx, 0, nz); em.triFacing(i0, i2, i3, nx, 0, nz);
}
