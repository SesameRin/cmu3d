// Geometry kit shared by the north-campus landmarks (Gates-Hillman, Pausch Bridge, Cohon Center, Tepper Quad).
//
// Everything is accumulated into per-material "buckets" of raw triangle data (non-indexed, positions + normals +
// metre UVs) and turned into ONE merged mesh per material at the end, so a whole landmark costs only as many draw
// calls as it has materials.
//
// Conventions (see ARCHITECTURE.md): x = east, z = south, y = up. Footprint rings are [[x,z],...] (not closed).
// UVs are in metres: walls u = distance along the wall, v = height above a reference level (so facade storeys
// line up); horizontal faces u = x, v = z.
import * as THREE from 'three';

// ------------------------------------------------------------------ 2D ring helpers
export function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
// Returns a copy with positive signed area (x/z math sense) so outward normals are (dz, -dx).
export function ccw(ring) {
  const r = ring.map((p) => [p[0], p[1]]);
  return signedArea(r) < 0 ? r.reverse() : r;
}
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function ringCentroid(ring) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cz += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cz / (3 * a)];
}
export function ringPerimeter(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return s;
}
export const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Inward offset of a (simple) polygon by d metres using mitred edge offsets. Miters are clamped so short edges and
// sharp reflex corners do not explode. Good for modest insets (plinths recessed under cantilevers, parapet inner rings).
export function insetRing(ring, d, miterLimit = 2.5) {
  const r = ccw(ring);
  const n = r.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = r[(i + n - 1) % n], c = r[i], q = r[(i + 1) % n];
    // inward normals (left of edge direction for CCW rings): (-dz, dx)
    let e1x = c[0] - p[0], e1z = c[1] - p[1]; const l1 = Math.hypot(e1x, e1z) || 1; e1x /= l1; e1z /= l1;
    let e2x = q[0] - c[0], e2z = q[1] - c[1]; const l2 = Math.hypot(e2x, e2z) || 1; e2x /= l2; e2z /= l2;
    const n1x = -e1z, n1z = e1x, n2x = -e2z, n2z = e2x;
    let bx = n1x + n2x, bz = n1z + n2z; const bl = Math.hypot(bx, bz);
    if (bl < 1e-6) { out.push([c[0] + n1x * d, c[1] + n1z * d]); continue; }
    bx /= bl; bz /= bl;
    const cosHalf = bx * n1x + bz * n1z;
    const m = Math.min(miterLimit, 1 / Math.max(cosHalf, 1e-3));
    out.push([c[0] + bx * d * m, c[1] + bz * d * m]);
  }
  return out;
}

// Inward offset with a distance per edge: distFn(a, b, i) → metres (0 keeps that edge in place). Vertices are the
// intersections of adjacent offset edges (miter-clamped). Output is CCW and index-aligned with ccw(ring).
export function insetRingEdges(ring, distFn, miterLimit = 3) {
  const r = ccw(ring), n = r.length;
  const E = [];
  for (let i = 0; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n];
    let ex = b[0] - a[0], ez = b[1] - a[1]; const l = Math.hypot(ex, ez) || 1; ex /= l; ez /= l;
    const d = distFn(a, b, i);
    E.push({ px: a[0] - ez * d, pz: a[1] + ex * d, ex, ez, d }); // inward normal (-ez, ex)
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const e1 = E[(i + n - 1) % n], e2 = E[i];
    const cr = e1.ex * e2.ez - e1.ez * e2.ex;
    let x, z;
    if (Math.abs(cr) < 1e-4) { x = r[i][0] - e2.ez * e2.d; z = r[i][1] + e2.ex * e2.d; }
    else {
      const t = ((e2.px - e1.px) * e2.ez - (e2.pz - e1.pz) * e2.ex) / cr;
      x = e1.px + e1.ex * t; z = e1.pz + e1.ez * t;
    }
    const dm = Math.max(e1.d, e2.d) * miterLimit, dx = x - r[i][0], dz = z - r[i][1], dl = Math.hypot(dx, dz);
    if (dl > dm && dl > 1e-6) { x = r[i][0] + dx / dl * dm; z = r[i][1] + dz / dl * dm; }
    out.push([x, z]);
  }
  return out;
}

// True when the edge a-b borders one of the given rings (its outside is inside another volume).
export function edgeShared(a, b, rings, probe = 0.3) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
  let best = 0;
  for (const ring of rings) {
    let hits = 0;
    for (const f of [0.2, 0.5, 0.8]) {
      if (pointInRing(a[0] + (b[0] - a[0]) * f + nx * probe, a[1] + (b[1] - a[1]) * f + nz * probe, ring)) hits++;
    }
    best = Math.max(best, hits);
  }
  return best >= 2;
}

// Terrain statistics under a ring (min/max/mean), sampled on the vertices + an interior grid.
export function groundStats(ctx, ring, step = 3) {
  if (ctx.heightfield?.statsOverRing) return ctx.heightfield.statsOverRing(ring, step);
  let min = Infinity, max = -Infinity;
  for (const [x, z] of ring) { const h = ctx.heightAt(x, z); min = Math.min(min, h); max = Math.max(max, h); }
  return { min, max, mean: (min + max) / 2 };
}

// ------------------------------------------------------------------ mesh builder
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();

export class MeshKit {
  constructor() { this.buckets = new Map(); }

  bucket(key) {
    let b = this.buckets.get(key);
    if (!b) { b = { pos: [], nor: [], uv: [] }; this.buckets.set(key, b); }
    return b;
  }

  // One triangle; a,b,c are [x,y,z]; normal n = [x,y,z] (flat). Winding is fixed to face n.
  tri(key, a, b, c, n, ua, ub, uc) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _c.crossVectors(_a, _b);
    if (!n) { const l = _c.length() || 1; n = [_c.x / l, _c.y / l, _c.z / l]; }
    else if (_c.x * n[0] + _c.y * n[1] + _c.z * n[2] < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; }
    const B = this.bucket(key);
    B.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    B.nor.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    B.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }

  // Quad p0-p1-p2-p3 (any consistent order around the quad) facing normal n.
  quad(key, p0, p1, p2, p3, n, u0, u1, u2, u3) {
    this.tri(key, p0, p1, p2, n, u0, u1, u2);
    this.tri(key, p0, p2, p3, n, u0, u2, u3);
  }

  // Planar quad whose exact normal is computed from the vertices and oriented to agree with `hint` (a rough outward
  // direction). Use for sloped faces.
  quadH(key, p0, p1, p2, p3, hint, u0 = [0, 0], u1 = [1, 0], u2 = [1, 1], u3 = [0, 1]) {
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    _b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    _n.crossVectors(_a, _b).normalize();
    if (_n.x * hint[0] + _n.y * hint[1] + _n.z * hint[2] < 0) _n.negate();
    this.quad(key, p0, p1, p2, p3, [_n.x, _n.y, _n.z], u0, u1, u2, u3);
  }

  triH(key, p0, p1, p2, hint, u0 = [0, 0], u1 = [1, 0], u2 = [0.5, 1]) {
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    _b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    _n.crossVectors(_a, _b).normalize();
    if (_n.x * hint[0] + _n.y * hint[1] + _n.z * hint[2] < 0) _n.negate();
    this.tri(key, p0, p1, p2, [_n.x, _n.y, _n.z], u0, u1, u2);
  }

  // Vertical wall between two ground points, from y0 to y1. Normal points to the given side (outward).
  // uStart = u of point a, vRef = y where v = 0. Returns the wall length.
  wall(key, a, b, y0, y1, outward, uStart = 0, vRef = 0) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-4 || y1 - y0 < 1e-4) return L;
    const n = outward || [b[1] - a[1], 0, -(b[0] - a[0])].map((v) => v / L);
    this.quad(key,
      [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], n,
      [uStart, y0 - vRef], [uStart + L, y0 - vRef], [uStart + L, y1 - vRef], [uStart, y1 - vRef]);
    return L;
  }

  // Walls around a ring (outward faces). y0/y1 may be numbers or functions (x,z)=>y for sloped bottoms/tops.
  // opts: { vRef, skip:(i)=>bool, inward:false }
  ringWalls(key, ring, y0, y1, opts = {}) {
    const r = ccw(ring);
    const vRef = opts.vRef ?? (typeof y0 === 'number' ? y0 : 0);
    const fy0 = typeof y0 === 'function' ? y0 : () => y0;
    const fy1 = typeof y1 === 'function' ? y1 : () => y1;
    let u = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-4) continue;
      if (opts.skip && opts.skip(i, a, b)) { u += L; continue; }
      let n = [(b[1] - a[1]) / L, 0, -(b[0] - a[0]) / L];
      if (opts.inward) n = [-n[0], 0, -n[2]];
      const ya0 = fy0(a[0], a[1]), yb0 = fy0(b[0], b[1]), ya1 = fy1(a[0], a[1]), yb1 = fy1(b[0], b[1]);
      this.quad(key, [a[0], ya0, a[1]], [b[0], yb0, b[1]], [b[0], yb1, b[1]], [a[0], ya1, a[1]], n,
        [u, ya0 - vRef], [u + L, yb0 - vRef], [u + L, yb1 - vRef], [u, ya1 - vRef]);
      u += L;
    }
  }

  // Horizontal cap (roof / floor / soffit) of a ring at height y (or function). up=true faces +Y.
  cap(key, ring, y, up = true, holes = []) {
    const r = ccw(ring);
    const contour = r.map(([x, z]) => new THREE.Vector2(x, z));
    const hv = holes.map((h) => ccw(h).reverse().map(([x, z]) => new THREE.Vector2(x, z)));
    const tris = THREE.ShapeUtils.triangulateShape(contour, hv);
    const all = contour.concat(...hv);
    const fy = typeof y === 'function' ? y : () => y;
    const n = up ? [0, 1, 0] : [0, -1, 0];
    for (const [i, j, k] of tris) {
      const A = all[i], B = all[j], C = all[k];
      this.tri(key, [A.x, fy(A.x, A.y), A.y], [B.x, fy(B.x, B.y), B.y], [C.x, fy(C.x, C.y), C.y],
        typeof y === 'function' ? null : n, [A.x, A.y], [B.x, B.y], [C.x, C.y]);
    }
  }

  // Prism: walls + top cap (+ optional bottom cap for floating volumes).
  prism(key, ring, y0, y1, { roofKey = null, bottomKey = null, vRef, skip } = {}) {
    this.ringWalls(key, ring, y0, y1, { vRef, skip });
    if (roofKey !== false) this.cap(roofKey || key, ring, y1, true);
    if (bottomKey) this.cap(bottomKey, ring, y0, false);
  }

  // Axis-aligned-in-local-frame box. (cx,cy,cz) is the centre, rotY rotates about +Y (radians, three.js sense).
  // UVs: side faces u = horizontal metres, v = world y - vRef; top/bottom u,v = world x,z.
  box(key, cx, cy, cz, sx, sy, sz, rotY = 0, { vRef = 0, faces = null } = {}) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    // three.js rotation about +Y: x' = x c + z s, z' = -x s + z c
    const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const N = (x, y, z) => [x * c + z * s, y, -x * s + z * c];
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const y0 = cy - hy - vRef, y1 = cy + hy - vRef;
    const F = faces || { px: 1, nx: 1, pz: 1, nz: 1, py: 1, ny: 1 };
    if (F.pz) this.quad(key, P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N(0, 0, 1), [0, y0], [sx, y0], [sx, y1], [0, y1]);
    if (F.nz) this.quad(key, P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), N(0, 0, -1), [0, y0], [sx, y0], [sx, y1], [0, y1]);
    if (F.px) this.quad(key, P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), N(1, 0, 0), [0, y0], [sz, y0], [sz, y1], [0, y1]);
    if (F.nx) this.quad(key, P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), N(-1, 0, 0), [0, y0], [sz, y0], [sz, y1], [0, y1]);
    const T = (x, z) => { const p = P(x, 0, z); return [p[0], p[2]]; };
    if (F.py) this.quad(key, P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), [0, 1, 0], T(-hx, hz), T(hx, hz), T(hx, -hz), T(-hx, -hz));
    if (F.ny) this.quad(key, P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), [0, -1, 0], T(-hx, -hz), T(hx, -hz), T(hx, hz), T(-hx, hz));
  }

  // Box spanning from point a to point b (centre line), with cross-section w (horizontal) x h (vertical).
  // Works for sloped members (handrails, beams); the section stays vertical.
  beam(key, a, b, w, h, opts = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const Lh = Math.hypot(dx, dz);
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-5) return;
    // local frame: t along the member, s horizontal side, up = cross(s, t)
    const t = [dx / L, dy / L, dz / L];
    const s = Lh > 1e-6 ? [dz / Lh, 0, -dx / Lh] : [1, 0, 0];
    const u = [s[1] * t[2] - s[2] * t[1], s[2] * t[0] - s[0] * t[2], s[0] * t[1] - s[1] * t[0]];
    const hw = w / 2, hh = h / 2;
    const P = (p, i, j) => [p[0] + s[0] * i * hw + u[0] * j * hh, p[1] + s[1] * i * hw + u[1] * j * hh, p[2] + s[2] * i * hw + u[2] * j * hh];
    const a00 = P(a, -1, -1), a10 = P(a, 1, -1), a11 = P(a, 1, 1), a01 = P(a, -1, 1);
    const b00 = P(b, -1, -1), b10 = P(b, 1, -1), b11 = P(b, 1, 1), b01 = P(b, -1, 1);
    const nu = (v) => v.map((x) => -x);
    if (opts.alongU !== undefined) {
      // every face maps u = distance along the member (+ alongU offset): for strips with gradients (LEDs)
      const U0 = opts.alongU, U1 = opts.alongU + L;
      this.quad(key, a01, a11, b11, b01, u, [U0, 0], [U0, w], [U1, w], [U1, 0]);
      this.quad(key, a00, b00, b10, a10, nu(u), [U0, 0], [U1, 0], [U1, w], [U0, w]);
      this.quad(key, a10, b10, b11, a11, s, [U0, 0], [U1, 0], [U1, h], [U0, h]);
      this.quad(key, a00, a01, b01, b00, nu(s), [U0, 0], [U0, h], [U1, h], [U1, 0]);
      return;
    }
    this.quad(key, a01, a11, b11, b01, u, [0, 0], [w, 0], [w, L], [0, L]);            // top
    this.quad(key, a00, b00, b10, a10, nu(u), [0, 0], [0, L], [w, L], [w, 0]);        // bottom
    this.quad(key, a10, b10, b11, a11, s, [0, 0], [L, 0], [L, h], [0, h]);            // side +s
    this.quad(key, a00, a01, b01, b00, nu(s), [0, 0], [0, h], [L, h], [L, 0]);        // side -s
    if (opts.caps !== false) {
      this.quad(key, a00, a10, a11, a01, nu(t), [0, 0], [w, 0], [w, h], [0, h]);
      this.quad(key, b00, b01, b11, b10, t, [0, 0], [0, h], [w, h], [w, 0]);
    }
  }

  // Vertical cylinder (or tapered column) from y0 to y1.
  cylinder(key, x, z, y0, y1, r0, r1 = r0, seg = 12, { top = true, bottom = false } = {}) {
    const C = 2 * Math.PI * Math.max(r0, r1);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p0 = [x + c0 * r0, y0, z + s0 * r0], p1 = [x + c1 * r0, y0, z + s1 * r0];
      const p2 = [x + c1 * r1, y1, z + s1 * r1], p3 = [x + c0 * r1, y1, z + s0 * r1];
      const am = (a0 + a1) / 2;
      const n = [Math.cos(am), 0, Math.sin(am)];
      const u0 = (i / seg) * C, u1 = ((i + 1) / seg) * C;
      this.quad(key, p0, p1, p2, p3, n, [u0, y0], [u1, y0], [u1, y1], [u0, y1]);
      if (top) this.tri(key, [x, y1, z], p3, p2, [0, 1, 0], [x, z], [p3[0], p3[2]], [p2[0], p2[2]]);
      if (bottom) this.tri(key, [x, y0, z], p0, p1, [0, -1, 0], [x, z], [p0[0], p0[2]], [p1[0], p1[2]]);
    }
  }

  // Append an arbitrary three.js geometry (e.g. ExtrudeGeometry) transformed by matrix.
  // UVs from the geometry are kept (make them metres yourself) unless worldUV is set.
  geometry(key, geo, matrix = null) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    const B = this.bucket(key);
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      B.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      B.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      if (uv) B.uv.push(uv.getX(i), uv.getY(i)); else B.uv.push(p.getX(i), p.getZ(i));
    }
  }

  triangleCount() {
    let t = 0;
    for (const b of this.buckets.values()) t += b.pos.length / 9;
    return t;
  }

  // Build the meshes. materials: { key: THREE.Material | glazing descriptor (see north-materials glz()) }.
  // Buckets that resolve to the same material are merged into ONE mesh (so keys that are just aliases cost nothing),
  // and all glazing-descriptor buckets share the glazing array material: their UVs are normalised to the layer's tile
  // and a per-vertex `glayer` attribute selects the layer. Meshes that cannot add anything to the shadow map only cost
  // a shadow-pass draw call, so they do not cast unless one of their keys is in shadowKeys: meshes made only of
  // upward-facing caps (flat / green roofs: the shadow pass renders back faces, which such meshes do not have) and
  // tiny ones (bounding radius < minShadowRadius).
  build(materials, { castShadow = true, receiveShadow = true, name = 'north-landmark', noShadowKeys = [], shadowKeys = [], minShadowRadius = 1.5 } = {}) {
    const group = new THREE.Group();
    group.name = name;
    const groups = new Map();
    for (const [key, B] of this.buckets) {
      if (!B.pos.length) continue;
      const spec = materials[key];
      if (!spec) { console.warn(`[${name}] no material for bucket "${key}"`); continue; }
      const mat = spec.isGlazing ? spec.material : spec;
      let gr = groups.get(mat);
      if (!gr) { gr = { keys: [], parts: [], verts: 0, glazing: !!spec.isGlazing }; groups.set(mat, gr); }
      gr.keys.push(key);
      gr.parts.push({ B, spec });
      gr.verts += B.pos.length / 3;
    }
    for (const [mat, gr] of groups) {
      const n = gr.verts;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      const layer = gr.glazing ? new Float32Array(n) : null;
      let o = 0;
      for (const { B, spec } of gr.parts) {
        const cnt = B.pos.length / 3;
        pos.set(B.pos, o * 3);
        nor.set(B.nor, o * 3);
        if (gr.glazing) {
          const iw = 1 / spec.tileW, ih = 1 / spec.tileH;
          for (let i = 0; i < cnt; i++) { uv[(o + i) * 2] = B.uv[i * 2] * iw; uv[(o + i) * 2 + 1] = B.uv[i * 2 + 1] * ih; }
          layer.fill(spec.layer, o, o + cnt);
        } else uv.set(B.uv, o * 2);
        o += cnt;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      if (layer) g.setAttribute('glayer', new THREE.BufferAttribute(layer, 1));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.name = `${name}:${gr.keys.join('+')}`;
      const forced = gr.keys.some((k) => shadowKeys.includes(k));
      let upOnly = true;
      for (let i = 1; i < nor.length && upOnly; i += 3) if (nor[i] < 0.7) upOnly = false;
      const useless = upOnly || g.boundingSphere.radius < minShadowRadius;
      const noShadow = gr.keys.every((k) => noShadowKeys.includes(k)) || mat.transparent || (!forced && useless);
      m.castShadow = castShadow && !noShadow;
      m.receiveShadow = receiveShadow;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      group.add(m);
    }
    this.buckets.clear();
    return group;
  }
}

// ------------------------------------------------------------------ massing
// Builds a set of prismatic volumes that may touch / stack / overlap. Walls that are hidden by a neighbouring
// volume are clipped away (so windows are never placed inside another block), roofs covered by a volume sitting on
// top are skipped, and parapets with copings are added to exposed flat roofs.
//
// volume: { ring, y0, y1, wallKey, roofKey|false, soffitKey?, parapet? (m), parapetKey?, copingKey?, vRef?, tag? }
// opts.onWall(vol, a, b, n, y0, y1, uStart, edgeIndex) is called for every exposed wall strip (for windows etc.)
export function massing(kit, volumes, opts = {}) {
  const vols = volumes.map((v) => ({ ...v, ring: ccw(v.ring) }));
  for (const v of vols) {
    const topY = v.y1 + (v.parapet || 0);
    const vRef = v.vRef ?? v.y0;
    let u = 0;
    const r = v.ring;
    for (let i = 0; i < r.length; i++) {
      const A = r[i], B = r[(i + 1) % r.length];
      const LE = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (LE < 1e-3) continue;
      const n = [(B[1] - A[1]) / LE, 0, -(B[0] - A[0]) / LE];
      const key = (v.edgeKey && v.edgeKey(A, B, i)) || v.wallKey;
      // Coverage by neighbouring volumes can change along the edge (e.g. a pavilion only partly flanked by a
      // lower range), so sample it every ~1 m and handle runs of equal coverage as separate wall pieces.
      const N = Math.max(1, Math.ceil(LE / 1.0));
      const sets = [];
      for (let k = 0; k < N; k++) {
        const f = (k + 0.5) / N;
        const px = A[0] + (B[0] - A[0]) * f + n[0] * 0.3, pz = A[1] + (B[1] - A[1]) * f + n[2] * 0.3;
        let s = '';
        for (let j = 0; j < vols.length; j++) if (vols[j] !== v && pointInRing(px, pz, vols[j].ring)) s += `${j},`;
        sets.push(s);
      }
      for (let k0 = 0; k0 < N;) {
        let k1 = k0 + 1;
        while (k1 < N && sets[k1] === sets[k0]) k1++;
        const f0 = k0 / N, f1 = k1 / N;
        const a = [A[0] + (B[0] - A[0]) * f0, A[1] + (B[1] - A[1]) * f0], b = [A[0] + (B[0] - A[0]) * f1, A[1] + (B[1] - A[1]) * f1];
        const L = LE * (f1 - f0), uA = u + LE * f0;
        // (a neighbour's parapet only lines its rim, so it does not count as covering an adjacent taller wall)
        const covered = sets[k0] ? sets[k0].split(',').filter(Boolean).map((j) => [vols[+j].y0, vols[+j].y1]) : [];
        for (const [s0, s1] of subtractIntervals([v.y0, topY], covered)) {
          if (s1 - s0 < 0.05) continue;
          // a wall builder (e.g. punchedWall) may take over the wall strip below the roof line
          if (opts.wallBuilder) {
            const yTop = Math.min(s1, v.y1);
            if (yTop - s0 > 0.5 && opts.wallBuilder(v, a, b, n, s0, yTop, uA, i, key)) {
              if (s1 > yTop + 0.01) {
                kit.quad(key, [a[0], yTop, a[1]], [b[0], yTop, b[1]], [b[0], s1, b[1]], [a[0], s1, a[1]], n,
                  [uA, yTop - vRef], [uA + L, yTop - vRef], [uA + L, s1 - vRef], [uA, s1 - vRef]);
              }
              continue;
            }
          }
          kit.quad(key, [a[0], s0, a[1]], [b[0], s0, b[1]], [b[0], s1, b[1]], [a[0], s1, a[1]], n,
            [uA, s0 - vRef], [uA + L, s0 - vRef], [uA + L, s1 - vRef], [uA, s1 - vRef]);
          if (opts.onWall) opts.onWall(v, a, b, n, s0, Math.min(s1, v.y1), uA, i, key);
        }
        k0 = k1;
      }
      u += LE;
    }
    // roof unless a volume sits right on top and covers it
    const cx = ringCentroid(r);
    const shrunk = r.map(([x, z]) => [x + (cx[0] - x) * 0.05, z + (cx[1] - z) * 0.05]);
    const roofCovered = vols.some((o) => o !== v && Math.abs(o.y0 - v.y1) < 0.3 && shrunk.every(([x, z]) => pointInRing(x, z, o.ring)));
    if (v.roofKey !== false && !roofCovered) {
      kit.cap(v.roofKey || v.wallKey, r, v.y1, true);
      if (v.parapet > 0) {
        const inner = insetRing(r, v.parapetW || 0.3);
        const pk = v.parapetKey || v.wallKey, ck = v.copingKey || pk;
        for (let i = 0; i < r.length; i++) {
          const j = (i + 1) % r.length;
          const a = inner[i], b = inner[j];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (L < 1e-3) continue;
          const n = [-(b[1] - a[1]) / L, 0, (b[0] - a[0]) / L]; // facing inward
          kit.quad(pk, [a[0], v.y1, a[1]], [b[0], v.y1, b[1]], [b[0], topY, b[1]], [a[0], topY, a[1]], n,
            [0, 0], [L, 0], [L, topY - v.y1], [0, topY - v.y1]);
          // coping between outer and inner rings
          const A = r[i], B = r[j];
          kit.quad(ck, [A[0], topY, A[1]], [B[0], topY, B[1]], [b[0], topY, b[1]], [a[0], topY, a[1]], [0, 1, 0],
            [A[0], A[1]], [B[0], B[1]], [b[0], b[1]], [a[0], a[1]]);
        }
      }
    }
    if (v.soffitKey) kit.cap(v.soffitKey, r, v.y0, false);
  }
  return vols;
}

// ------------------------------------------------------------------ punched masonry wall with real openings
// Builds a wall strip a→b (outward normal n) between y0 and y1 with a grid of recessed windows: wall pieces around
// the openings, reveals (jambs, head, sill) of the given depth, recessed glass with per-window atlas UVs (so each
// window lights independently at night), a mullion and a projecting stone sill. Windows are centred on the edge.
// o: { wallKey, glassKey, frameKey, sillKey, bay, floor, vRef, winW, winH, sill, depth, margin, rand, cellUV,
//      ground(x,z)→y, floors:[fMin,fMax], pair (m between paired windows), transom (fraction), vRef,
//      count (force the number of window columns), lights (panes across a window; default 2 when wider than 1.1 m),
//      levels: [{ y, h, winW?, bay?, pair?, count?, lights?, transom? }] — explicit rows (y = sill height above vRef)
//      with their own window grid, instead of the floors/sill/winH repetition }
// Returns false when the strip is too short for a window (caller then draws a plain wall).
export function punchedWall(kit, a, b, n, y0, y1, uStart, vRef, o) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const margin = o.margin ?? 0.9;
  const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const P = (s, y, off = 0) => [a[0] + dir[0] * s + n[0] * off, y, a[1] + dir[1] * s + n[2] * off];
  const UV = (s, y) => [uStart + s, y - vRef];
  // window columns of one grid, centred on the strip: null when the strip is too short
  const grid = (bay, winW, pair, count) => {
    const unitW = pair ? winW * 2 + pair : winW;
    if (L < unitW + 2 * margin) return null;
    const nCols = count || Math.max(1, Math.floor((L - 2 * margin - unitW) / bay) + 1);
    const cols = [];
    for (let i = 0; i < nCols; i++) {
      const c = L / 2 + (i - (nCols - 1) / 2) * bay;
      if (pair) cols.push([c - pair / 2 - winW, c - pair / 2], [c + pair / 2, c + pair / 2 + winW]);
      else cols.push([c - winW / 2, c + winW / 2]);
    }
    return { cols, nCols };
  };
  const main = grid(o.bay, o.winW, o.pair, o.count);
  // rows (storeys) that fit inside the strip
  const rows = [];
  if (o.levels) {
    for (const lv of o.levels) {
      const yb = vRef + lv.y, yt = yb + lv.h;
      if (yb < y0 + 0.25 || yt > y1 - 0.25) continue;
      const gr = grid(lv.bay ?? o.bay, lv.winW ?? o.winW, lv.pair ?? o.pair, lv.count ?? o.count);
      if (gr) rows.push({ yb, yt, cols: gr.cols, lights: lv.lights ?? o.lights, transom: lv.transom ?? o.transom });
    }
  } else if (main) {
    const [fMin, fMax] = o.floors || [-5, 50];
    for (let f = fMin; f <= fMax; f++) {
      const yb = vRef + f * o.floor + o.sill, yt = yb + o.winH;
      if (yb >= y0 + 0.25 && yt <= y1 - 0.25) rows.push({ yb, yt, cols: main.cols, lights: o.lights, transom: o.transom });
    }
  }
  if (!rows.length) return false;
  const nCols = main ? main.nCols : 0;
  // brick pilasters between the window bays (vertical rhythm of a classical range)
  if (o.pilaster && nCols) {
    const { key = o.wallKey, w = 0.55, proj = 0.16 } = o.pilaster;
    const rot = Math.atan2(-dir[1], dir[0]);
    const first = L / 2 - ((nCols - 1) / 2) * o.bay - o.bay / 2;
    for (let i = 0; i <= nCols; i++) {
      const s = first + i * o.bay;
      if (s < w / 2 || s > L - w / 2) continue;
      const top = y1 - (o.pilaster.topGap ?? 0.6);   // stop under the cornice
      const p = P(s, (y0 + top) / 2, proj / 2);
      kit.box(key, p[0], p[1], p[2], w, top - y0, proj, rot, { faces: { px: 1, nx: 1, nz: 1, py: 1, ny: 0 }, vRef });
    }
  }
  const depth = o.depth ?? 0.28;
  const nIn = [-n[0], 0, -n[2]];
  const quadW = (s0, s1, ya, yb) => {
    if (s1 - s0 < 0.01 || yb - ya < 0.01) return;
    kit.quad(o.wallKey, P(s0, ya), P(s1, ya), P(s1, yb), P(s0, yb), n, UV(s0, ya), UV(s1, ya), UV(s1, yb), UV(s0, yb));
  };
  let yPrev = y0;
  for (const { yb, yt, cols, lights, transom } of rows) {
    quadW(0, L, yPrev, yb);
    // windows present in this row (skip those below the terrain)
    const present = cols.filter(([s0, s1]) => {
      if (o.skip) { const pm = P((s0 + s1) / 2, 0); if (o.skip(pm[0], pm[2], yb, yt)) return false; }
      if (!o.ground) return true;
      const p0 = P(s0, 0), p1 = P(s1, 0);
      return Math.max(o.ground(p0[0], p0[2]), o.ground(p1[0], p1[2])) < yb - 0.15;
    });
    let sPrev = 0;
    for (const [s0, s1] of present) {
      quadW(sPrev, s0, yb, yt);
      sPrev = s1;
      // reveals
      const d = depth;
      kit.quad(o.wallKey, P(s0, yb), P(s0, yb, -d), P(s0, yt, -d), P(s0, yt), [dir[0], 0, dir[1]], [0, 0], [d, 0], [d, yt - yb], [0, yt - yb]);
      kit.quad(o.wallKey, P(s1, yb), P(s1, yb, -d), P(s1, yt, -d), P(s1, yt), [-dir[0], 0, -dir[1]], [0, 0], [d, 0], [d, yt - yb], [0, yt - yb]);
      kit.quad(o.revealKey || o.wallKey, P(s0, yt), P(s1, yt), P(s1, yt, -d), P(s0, yt, -d), [0, -1, 0], [0, 0], [s1 - s0, 0], [s1 - s0, d], [0, d]);
      kit.quad(o.sillKey || o.wallKey, P(s0, yb), P(s1, yb), P(s1, yb, -d), P(s0, yb, -d), [0, 1, 0], [0, 0], [s1 - s0, 0], [s1 - s0, d], [0, d]);
      // glass
      const [u0, v0, u1, v1] = o.cellUV(o.rand);
      const gOff = -d + 0.05;
      kit.quad(o.glassKey, P(s0, yb, gOff), P(s1, yb, gOff), P(s1, yt, gOff), P(s0, yt, gOff), n, [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
      // frame: perimeter strip + mullion (+ transom)
      if (o.frameKey) {
        const rot = Math.atan2(-dir[1], dir[0]), fo = gOff + 0.05, fw = 0.07;
        const cx = (s0 + s1) / 2;
        const box = (s, y, w, h) => { const p = P(s, y, fo); kit.box(o.frameKey, p[0], p[1], p[2], w, h, 0.1, rot, { faces: { px: 1, nx: 1, nz: 1, py: 1, ny: 1 } }); };
        box(s0 + fw / 2, (yb + yt) / 2, fw, yt - yb);
        box(s1 - fw / 2, (yb + yt) / 2, fw, yt - yb);
        box(cx, yt - fw / 2, s1 - s0, fw);
        box(cx, yb + fw / 2, s1 - s0, fw);
        const nl = lights ?? (o.mullion !== false && s1 - s0 > 1.1 ? 2 : 1);
        for (let k = 1; k < nl; k++) box(s0 + (s1 - s0) * k / nl, (yb + yt) / 2, nl > 2 ? fw * 1.6 : fw * 0.8, yt - yb);
        if (transom) box(cx, yb + (yt - yb) * transom, s1 - s0, fw * 0.8);
      }
      // projecting sill
      if (o.sillKey) {
        const rot = Math.atan2(-dir[1], dir[0]);
        const p = P((s0 + s1) / 2, yb - 0.07, 0.06);
        kit.box(o.sillKey, p[0], p[1], p[2], s1 - s0 + 0.2, 0.14, 0.14 + 0.08, rot, { faces: { px: 1, nx: 1, nz: 1, py: 1, ny: 1 } });
      }
    }
    quadW(sPrev, L, yb, yt);
    yPrev = yt;
  }
  quadW(0, L, yPrev, y1);
  return true;
}

// Horizontal band / cornice running around a ring: a box beam per edge, pushed outward by proj/2 and extended at the
// ends so corners close.
export function bandRing(kit, key, ring, y, proj, h) {
  const r = ccw(ring);
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.5) continue;
    const dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l, nx = dz, nz = -dx;
    kit.beam(key, [a[0] - dx * proj + nx * proj / 2, y, a[1] - dz * proj + nz * proj / 2],
      [b[0] + dx * proj + nx * proj / 2, y, b[1] + dz * proj + nz * proj / 2], proj, h);
  }
}

// [a,b] minus a list of [c,d] intervals → sorted list of remaining intervals
export function subtractIntervals([a, b], cuts) {
  let out = [[a, b]];
  for (const [c, d] of cuts) {
    const next = [];
    for (const [x, y] of out) {
      if (d <= x || c >= y) { next.push([x, y]); continue; }
      if (c > x) next.push([x, c]);
      if (d < y) next.push([d, y]);
    }
    out = next;
  }
  return out;
}

// ------------------------------------------------------------------ local building frames & roofs
// A frame maps local (e, n) metres (e = across, n = along the building) to world [x, z].
export function makeFrame(origin, alongDir) {
  const l = Math.hypot(alongDir[0], alongDir[1]);
  const N = [alongDir[0] / l, alongDir[1] / l];
  const E = [-N[1], N[0]];                    // 90° from N (for N pointing north-ish, E points east-ish)
  const W = (e, n) => [origin[0] + E[0] * e + N[0] * n, origin[1] + E[1] * e + N[1] * n];
  const toLocal = (x, z) => { const dx = x - origin[0], dz = z - origin[1]; return [dx * E[0] + dz * E[1], dx * N[0] + dz * N[1]]; };
  return { origin, E, N, W, toLocal, rotY: Math.atan2(-E[1], E[0]) /* three.js rotation.y mapping local +x to E */ };
}
export const rectLocal = (F, e0, e1, n0, n1) => [F.W(e0, n0), F.W(e1, n0), F.W(e1, n1), F.W(e0, n1)];

// Hipped roof over a local rectangle. Seam/tile textures run down the slope (u along the eave, v up the slope).
export function hipRoof(kit, key, F, e0, e1, n0, n1, yEave, rise) {
  const we = e1 - e0, wn = n1 - n0;
  const P = (e, n, y) => { const [x, z] = F.W(e, n); return [x, y, z]; };
  const yR = yEave + rise;
  if (we >= wn) {
    const h = wn / 2, nm = (n0 + n1) / 2;
    const ra = P(e0 + h, nm, yR), rb = P(e1 - h, nm, yR);
    const sl = Math.hypot(h, rise);
    kit.quadH(key, P(e0, n0, yEave), P(e1, n0, yEave), rb, ra, [0, 1, 0], [0, 0], [we, 0], [we - h, sl], [h, sl]);
    kit.quadH(key, P(e1, n1, yEave), P(e0, n1, yEave), ra, rb, [0, 1, 0], [0, 0], [we, 0], [we - h, sl], [h, sl]);
    kit.triH(key, P(e0, n1, yEave), P(e0, n0, yEave), ra, [0, 1, 0], [0, 0], [wn, 0], [h, sl]);
    kit.triH(key, P(e1, n0, yEave), P(e1, n1, yEave), rb, [0, 1, 0], [0, 0], [wn, 0], [h, sl]);
  } else {
    const h = we / 2, em = (e0 + e1) / 2;
    const ra = P(em, n0 + h, yR), rb = P(em, n1 - h, yR);
    const sl = Math.hypot(h, rise);
    kit.quadH(key, P(e1, n0, yEave), P(e1, n1, yEave), rb, ra, [0, 1, 0], [0, 0], [wn, 0], [wn - h, sl], [h, sl]);
    kit.quadH(key, P(e0, n1, yEave), P(e0, n0, yEave), ra, rb, [0, 1, 0], [0, 0], [wn, 0], [wn - h, sl], [h, sl]);
    kit.triH(key, P(e0, n0, yEave), P(e1, n0, yEave), ra, [0, 1, 0], [0, 0], [we, 0], [h, sl]);
    kit.triH(key, P(e1, n1, yEave), P(e0, n1, yEave), rb, [0, 1, 0], [0, 0], [we, 0], [h, sl]);
  }
}

// Gable roof over a local rectangle with the ridge along `axis` ('n' or 'e'). Gable triangles use gableKey
// (UV v = world height - vRef so brick courses continue from the walls below).
export function gableRoof(kit, key, gableKey, F, e0, e1, n0, n1, yEave, rise, axis = 'n', { overhang = 0.4, vRef = 0 } = {}) {
  const P = (e, n, y) => { const [x, z] = F.W(e, n); return [x, y, z]; };
  const yR = yEave + rise;
  if (axis === 'n') {
    const em = (e0 + e1) / 2, h = (e1 - e0) / 2, sl = Math.hypot(h + overhang, rise * (1 + overhang / h));
    const yO = yEave - rise * overhang / h;
    const a0 = n0 - overhang, a1 = n1 + overhang, L = a1 - a0;
    kit.quadH(key, P(e0 - overhang, a0, yO), P(e0 - overhang, a1, yO), P(em, a1, yR), P(em, a0, yR), [0, 1, 0], [0, 0], [L, 0], [L, sl], [0, sl]);
    kit.quadH(key, P(e1 + overhang, a1, yO), P(e1 + overhang, a0, yO), P(em, a0, yR), P(em, a1, yR), [0, 1, 0], [0, 0], [L, 0], [L, sl], [0, sl]);
    // undersides of the eaves
    kit.quadH(key, P(e0 - overhang, a0, yO - 0.02), P(e0 - overhang, a1, yO - 0.02), P(em, a1, yR - 0.02), P(em, a0, yR - 0.02), [0, -1, 0]);
    kit.quadH(key, P(e1 + overhang, a1, yO - 0.02), P(e1 + overhang, a0, yO - 0.02), P(em, a0, yR - 0.02), P(em, a1, yR - 0.02), [0, -1, 0]);
    if (gableKey) {
      const w = e1 - e0;
      kit.triH(gableKey, P(e0, n0, yEave), P(e1, n0, yEave), P(em, n0, yR), dirOf(F, 0, -1), [0, yEave - vRef], [w, yEave - vRef], [w / 2, yR - vRef]);
      kit.triH(gableKey, P(e1, n1, yEave), P(e0, n1, yEave), P(em, n1, yR), dirOf(F, 0, 1), [0, yEave - vRef], [w, yEave - vRef], [w / 2, yR - vRef]);
    }
  } else {
    const nm = (n0 + n1) / 2, h = (n1 - n0) / 2, sl = Math.hypot(h + overhang, rise * (1 + overhang / h));
    const yO = yEave - rise * overhang / h;
    const a0 = e0 - overhang, a1 = e1 + overhang, L = a1 - a0;
    kit.quadH(key, P(a1, n0 - overhang, yO), P(a0, n0 - overhang, yO), P(a0, nm, yR), P(a1, nm, yR), [0, 1, 0], [0, 0], [L, 0], [L, sl], [0, sl]);
    kit.quadH(key, P(a0, n1 + overhang, yO), P(a1, n1 + overhang, yO), P(a1, nm, yR), P(a0, nm, yR), [0, 1, 0], [0, 0], [L, 0], [L, sl], [0, sl]);
    kit.quadH(key, P(a1, n0 - overhang, yO - 0.02), P(a0, n0 - overhang, yO - 0.02), P(a0, nm, yR - 0.02), P(a1, nm, yR - 0.02), [0, -1, 0]);
    kit.quadH(key, P(a0, n1 + overhang, yO - 0.02), P(a1, n1 + overhang, yO - 0.02), P(a1, nm, yR - 0.02), P(a0, nm, yR - 0.02), [0, -1, 0]);
    if (gableKey) {
      const w = n1 - n0;
      kit.triH(gableKey, P(e0, n1, yEave), P(e0, n0, yEave), P(e0, nm, yR), dirOf(F, -1, 0), [0, yEave - vRef], [w, yEave - vRef], [w / 2, yR - vRef]);
      kit.triH(gableKey, P(e1, n0, yEave), P(e1, n1, yEave), P(e1, nm, yR), dirOf(F, 1, 0), [0, yEave - vRef], [w, yEave - vRef], [w / 2, yR - vRef]);
    }
  }
}
function dirOf(F, de, dn) { return [F.E[0] * de + F.N[0] * dn, 0, F.E[1] * de + F.N[1] * dn]; }

// Flat glazed arch window (rectangle topped by a semicircle) on a vertical plane. centre bottom = (x,z) at y0,
// dir = unit [dx,dz] along the wall, n = outward [nx,0,nz]. Frame members go to frameKey.
export function archWindow(kit, glassKey, frameKey, x, z, y0, width, height, dir, n, { off = 0.05, bars = 3, frameW = 0.16, depth = 0.2 } = {}) {
  const r = width / 2, ySpring = y0 + height - r, seg = 14;
  const P = (s, y, o = off) => [x + dir[0] * s + n[0] * o, y, z + dir[1] * s + n[2] * o];
  // rectangle part
  kit.quad(glassKey, P(-r, y0), P(r, y0), P(r, ySpring), P(-r, ySpring), n, [0, 0], [width, 0], [width, ySpring - y0], [0, ySpring - y0]);
  // semicircle fan
  for (let i = 0; i < seg; i++) {
    const a0 = Math.PI - (i / seg) * Math.PI, a1 = Math.PI - ((i + 1) / seg) * Math.PI;
    const p0 = P(Math.cos(a0) * r, ySpring + Math.sin(a0) * r), p1 = P(Math.cos(a1) * r, ySpring + Math.sin(a1) * r);
    kit.tri(glassKey, P(0, ySpring), p0, p1, n, [r, ySpring - y0], [r + Math.cos(a0) * r, ySpring - y0 + Math.sin(a0) * r], [r + Math.cos(a1) * r, ySpring - y0 + Math.sin(a1) * r]);
  }
  if (!frameKey) return;
  const fo = off + depth / 2;
  const beam = (a, b, w = frameW) => kit.beam(frameKey, a, b, w, depth);
  // frame: jambs, sill, arch ring, mullions / transom / radial bars
  beam(P(-r, y0, fo), P(-r, ySpring, fo));
  beam(P(r, y0, fo), P(r, ySpring, fo));
  beam(P(-r - frameW / 2, y0, fo), P(r + frameW / 2, y0, fo));
  for (let i = 0; i < seg; i++) {
    const a0 = Math.PI - (i / seg) * Math.PI, a1 = Math.PI - ((i + 1) / seg) * Math.PI;
    beam(P(Math.cos(a0) * r, ySpring + Math.sin(a0) * r, fo), P(Math.cos(a1) * r, ySpring + Math.sin(a1) * r, fo));
  }
  beam(P(-r, ySpring, fo), P(r, ySpring, fo), frameW * 0.7);
  for (let b = 1; b < bars + 1; b++) {
    const s = -r + (b / (bars + 1)) * width;
    beam(P(s, y0, fo), P(s, ySpring, fo), frameW * 0.6);
    const a = Math.PI - (b / (bars + 1)) * Math.PI;
    beam(P(0, ySpring, fo), P(Math.cos(a) * r, ySpring + Math.sin(a) * r, fo), frameW * 0.6);
  }
}

// ------------------------------------------------------------------ Michael Dennis' "Uffizi" ranges on the Cut
// (Cohon University Center and Purnell Center: a tall ground-floor loggia of square brick piers, a clerestory under
// deep bracketed eaves, end pavilions with projecting glass oriels.) All in a local frame F (see makeFrame) whose
// facade line is e = 0 with the outside towards out (±1 along e).

// Loggia along n = n0 … n0 + count*bay: square brick piers on stone bases (k = 1 … count-1; the ends abut other
// volumes), a light stone lintel over every opening, a ceiling light per bay and a stone string course at stringY.
// keys: { brick, stone, lamp }. Returns the pier centres (for colliders).
export function loggiaPiers(kit, F, { n0 = 0, bay, count, out, G0, base, logH, logD, pier = 1.2, stringY, keys }) {
  const pts = [];
  for (let k = 1; k < count; k++) {
    const nk = n0 + k * bay;
    const [px, pz] = F.W(-out * pier / 2, nk);
    kit.box(keys.stone, px, (base + G0 + 1.0) / 2, pz, pier + 0.12, G0 + 1.0 - base, pier + 0.12, F.rotY);
    kit.box(keys.brick, px, G0 + 1.0 + (logH - 1.0) / 2, pz, pier, logH - 1.0, pier, F.rotY, { vRef: G0, faces: { px: 1, nx: 1, pz: 1, nz: 1 } });
    pts.push([px, pz]);
  }
  for (let k = 0; k < count; k++) {
    const a = n0 + k * bay + (k ? pier / 2 : 0), b = n0 + (k + 1) * bay - (k < count - 1 ? pier / 2 : 0);
    const [lx, lz] = F.W(-out * 0.235, (a + b) / 2);
    kit.box(keys.stone, lx, G0 + logH - 0.25, lz, 0.53, 0.5, b - a, F.rotY, { faces: { px: 1, nx: 1, ny: 1 } });   // lintel
    const [cx, cz] = F.W(-out * logD * 0.55, n0 + (k + 0.5) * bay);
    kit.box(keys.lamp, cx, G0 + logH - 0.03, cz, 0.7, 0.05, 0.7, F.rotY, { faces: { ny: 1 } });
  }
  if (stringY) {
    const [ax, az] = F.W(out * 0.06, n0), [bx, bz] = F.W(out * 0.06, n0 + count * bay);
    kit.beam(keys.stone, [ax, stringY, az], [bx, stringY, bz], 0.12, 0.2, { caps: false });
  }
  return pts;
}

// Rafter-tail brackets (every ~step m) + fascia under a gable eave (see gableRoof overhang ov). axis 'n': the eave
// runs along n from `from` to `to`, wall line at e = wallC, eave edge at e = outC; axis 'e': along e at n = wallC → outC.
export function eaveBrackets(kit, key, F, axis, from, to, wallC, outC, yWall, yOut, ov, step = 1.5) {
  const P = (c, t) => (axis === 'n' ? F.W(c, t) : F.W(t, c));
  const cnt = Math.max(1, Math.round((to - from) / step));
  for (let k = 0; k <= cnt; k++) {
    const t = from + (to - from) * k / cnt;
    const [ax, az] = P(wallC, t), [bx, bz] = P(outC, t);
    kit.beam(key, [ax, yWall - 0.2, az], [bx, yOut - 0.2, bz], 0.14, 0.3);
  }
  const [fx0, fz0] = P(outC, from - ov), [fx1, fz1] = P(outC, to + ov);
  kit.beam(key, [fx0, yOut - 0.12, fz0], [fx1, yOut - 0.12, fz1], 0.1, 0.32);
}

// Projecting glazed oriel on the wall e = eFace (outside towards out), centred at n, from y0 to y1, carried on two
// columns down to `base`. The front shows exactly one tile of the glass layer (map it with mw = w / cols, mh = (y1-y0) /
// rows). keys: { glass, frame, cap, column }. Returns the column centres (for colliders).
export function orielBay(kit, F, { eFace, n, out, w = 4.4, d = 1.3, y0, y1, base, keys }) {
  const P = (e, nn, y) => { const [x, z] = F.W(e, nn); return [x, y, z]; };
  const nOut = [F.E[0] * out, 0, F.E[1] * out], ef = eFace + out * d, h = y1 - y0;
  kit.quad(keys.glass, P(ef, n - w / 2, y0), P(ef, n + w / 2, y0), P(ef, n + w / 2, y1), P(ef, n - w / 2, y1), nOut, [0, 0], [w, 0], [w, h], [0, h]);
  const cols = [];
  for (const s of [-1, 1]) {
    const nn = n + s * w / 2;
    kit.quad(keys.glass, P(eFace, nn, y0), P(ef, nn, y0), P(ef, nn, y1), P(eFace, nn, y1), [F.N[0] * s, 0, F.N[1] * s], [0, 0], [d, 0], [d, h], [0, h]);
    const [cx, cz] = F.W(eFace + out * (d + 0.02), nn - s * 0.04);
    kit.box(keys.frame, cx, (y0 + y1) / 2, cz, 0.16, h, 0.16, F.rotY);                                   // corner posts
    const [qx, qz] = F.W(eFace + out * (d - 0.4), n + s * (w / 2 - 0.5));
    kit.cylinder(keys.column, qx, qz, base, y0 - 0.4, 0.3, 0.3, 12, { top: false });                     // columns below
    cols.push([qx, qz]);
  }
  const [mx, mz] = F.W(eFace + out * (d / 2 + 0.1), n);
  kit.box(keys.cap, mx, y1 + 0.2, mz, d + 0.5, 0.4, w + 0.5, F.rotY);                                   // cap
  kit.box(keys.cap, mx, y0 - 0.2, mz, d + 0.5, 0.4, w + 0.5, F.rotY);                                   // soffit
  return cols;
}

// ------------------------------------------------------------------ misc
// Deterministic PRNG (mulberry32) so models look the same on every load.
export function prng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Find a CAMPUS_DATA building record by OSM id (null if the data set does not contain it).
export function findBuilding(ctx, osmId) {
  return ctx.data?.buildings?.find((b) => b.osmId === osmId || b.id === osmId) || null;
}

// Chinese name as used by the info panel / search (CAMPUS_INFO), so the map label never disagrees with them.
export function infoNameZh(ctx, osmId, key, fallback) {
  const info = ctx.info || globalThis.CAMPUS_INFO;
  return (osmId && info?.buildings?.[osmId]?.nameZh) || info?.landmarks?.[key]?.nameZh || fallback;
}

// Register the standard landmark extras: pick entry on the group + label.
export function registerLandmark(ctx, object, { key, name, nameZh, osmId, infoKey, position, radius, labelY }) {
  nameZh = infoNameZh(ctx, osmId, key, nameZh);
  const entry = { key, kind: 'landmark', name, nameZh, osmId, infoKey: infoKey || osmId || key, position, radius };
  ctx.pick?.add(object, entry);
  ctx.labels?.add({
    key, text: name, textZh: nameZh, kind: 'landmark', priority: 9,
    position: { x: position[0], y: labelY ?? position[1], z: position[2] },
  });
  return entry;
}
