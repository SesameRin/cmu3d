// Geometry kit shared by the east-Mall landmarks (CFA, Margaret Morrison, Hunt Library, Posner Hall).
//
// Everything is modelled in a per-building LOCAL frame (x/z in metres on the ground plane, y = absolute world
// height) and appended to a Bag, which accumulates raw triangles per material and finally emits ONE merged mesh
// per material. The Bag's group then gets the frame's position/rotation, so the model lands in world space.
//
// UV convention (see core/materials.js): metres. Walls: u = metres along the wall, v = metres above a datum.
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

// ---------------------------------------------------------------- local frame
// Same convention as core/placement.footprintFrame: local +x follows `angle` in the world x/z plane,
// world = center + (u cos a - v sin a, u sin a + v cos a); THREE rotation.y = -angle.
export function makeFrame(center, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return {
    center, angle, rotationY: -angle,
    toWorld(u, v) { return [center[0] + u * c - v * s, center[1] + u * s + v * c]; },
    toLocal(x, z) { const dx = x - center[0], dz = z - center[1]; return [dx * c + dz * s, -dx * s + dz * c]; },
    ringToWorld(ring) { return ring.map(([u, v]) => this.toWorld(u, v)); },
    ringToLocal(ring) { return ring.map(([x, z]) => this.toLocal(x, z)); },
    place(obj) { obj.position.set(center[0], 0, center[1]); obj.rotation.y = -angle; obj.updateMatrixWorld(true); return obj; },
  };
}

// Terrain statistics along a local-space ring / segment (sampled every ~2 m).
export function groundAlong(ctx, frame, pts, closed = true, step = 2) {
  let min = Infinity, max = -Infinity;
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j <= k; j++) {
      const t = j / k;
      const [x, z] = frame.toWorld(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      const h = ctx.heightAt(x, z);
      if (h < min) min = h; if (h > max) max = h;
    }
  }
  return { min, max };
}

// ---------------------------------------------------------------- Bag: per-material triangle soup
const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

// Metre box-projection UV for a point with a (face) normal — mirrors materials.applyWorldUV.
export function boxUV(x, y, z, nx, ny, nz) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay >= ax && ay >= az) return [x, z];
  if (ax >= az) return [nx > 0 ? -z : z, y];
  return [nz > 0 ? x : -x, y];
}

export class Bag {
  constructor() { this.acc = new Map(); this.opts = new Map(); }
  _get(mat) {
    let a = this.acc.get(mat);
    if (!a) { a = { p: [], n: [], u: [] }; this.acc.set(mat, a); }
    return a;
  }
  // Per-material mesh options: { castShadow, receiveShadow, renderOrder }
  setOptions(mat, o) { this.opts.set(mat, o); }

  // One triangle, flat normal from winding (counter-clockwise = front). uv: [u,v] per vertex or null → box UV.
  tri(mat, a, b, c, ua, ub, uc) {
    const A = this._get(mat);
    _e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _e2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_e1, _e2);
    const l = _n.length();
    if (l < 1e-9) return;
    _n.multiplyScalar(1 / l);
    A.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    A.n.push(_n.x, _n.y, _n.z, _n.x, _n.y, _n.z, _n.x, _n.y, _n.z);
    if (!ua) {
      ua = boxUV(a[0], a[1], a[2], _n.x, _n.y, _n.z);
      ub = boxUV(b[0], b[1], b[2], _n.x, _n.y, _n.z);
      uc = boxUV(c[0], c[1], c[2], _n.x, _n.y, _n.z);
    }
    A.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  quad(mat, a, b, c, d, ua, ub, uc, ud) {
    this.tri(mat, a, b, c, ua, ub, uc);
    this.tri(mat, a, c, d, ua, uc, ud);
  }

  // Append a BufferGeometry. matrix: optional Matrix4. uv: 'keep' | 'box' | fn(x,y,z,nx,ny,nz)→[u,v].
  // flip: reverse winding (and normals). smooth normals are kept from the geometry (transformed).
  geo(mat, g, { matrix = null, uv = 'box', flip = false, uvScale = null } = {}) {
    if (!mat || !g) return;
    const src = g.index ? g.toNonIndexed() : g;
    if (!src.attributes.normal) src.computeVertexNormals();
    const pos = src.attributes.position, nor = src.attributes.normal, uva = src.attributes.uv;
    const A = this._get(mat);
    if (matrix) _nm.getNormalMatrix(matrix);
    const cnt = pos.count - (pos.count % 3);
    for (let i = 0; i < cnt; i += 3) {
      const order = flip ? [0, 2, 1] : [0, 1, 2];
      // face normal (after transform) for box UVs
      let fx = 0, fy = 0, fz = 0;
      if (uv === 'box' || typeof uv === 'function') {
        _v0.fromBufferAttribute(pos, i); _v1.fromBufferAttribute(pos, i + 1); _v2.fromBufferAttribute(pos, i + 2);
        if (matrix) { _v0.applyMatrix4(matrix); _v1.applyMatrix4(matrix); _v2.applyMatrix4(matrix); }
        _e1.subVectors(_v1, _v0); _e2.subVectors(_v2, _v0); _n.crossVectors(_e1, _e2).normalize();
        if (flip) _n.negate();
        fx = _n.x; fy = _n.y; fz = _n.z;
      }
      for (const k of order) {
        const j = i + k;
        _v0.fromBufferAttribute(pos, j);
        if (matrix) _v0.applyMatrix4(matrix);
        _v1.fromBufferAttribute(nor, j);
        if (matrix) _v1.applyMatrix3(_nm).normalize();
        if (flip) _v1.negate();
        A.p.push(_v0.x, _v0.y, _v0.z);
        A.n.push(_v1.x, _v1.y, _v1.z);
        if (uv === 'keep') {
          let u = uva ? uva.getX(j) : 0, v = uva ? uva.getY(j) : 0;
          if (uvScale) { u *= uvScale[0]; v *= uvScale[1]; }
          A.u.push(u, v);
        } else if (typeof uv === 'function') {
          const r = uv(_v0.x, _v0.y, _v0.z, fx, fy, fz);
          A.u.push(r[0], r[1]);
        } else {
          const r = boxUV(_v0.x, _v0.y, _v0.z, fx, fy, fz);
          A.u.push(r[0], r[1]);
        }
      }
    }
    if (src !== g) src.dispose();
  }

  // Axis-aligned (optionally rotated about Y) box centred at (cx, cy, cz) with size (sx, sy, sz).
  box(mat, cx, cy, cz, sx, sy, sz, rotY = 0, uv = 'box') {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(cx, cy, cz);
    this.geo(mat, g, { matrix: m, uv });
    g.dispose();
  }

  triangleCount() {
    let t = 0;
    for (const a of this.acc.values()) t += a.p.length / 9;
    return t;
  }

  // Total triangle area (m²) accumulated for a material.
  static area(A) {
    const p = A.p;
    let s = 0;
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    return s;
  }

  // Emit one mesh per material into a Group. Detail meshes with little surface (door leaves, sign strips, lamp
  // globes, window panes…) skip the shadow pass: their shadows are invisible but each costs a draw call.
  // share: { ctx, entry, frame, materials:Set } → triangles of those materials go to the shared Mall East batch
  // (one mesh per material across CFA / Posner / MMCH / Hunt, see settleMallEast) instead of this group; the group
  // then also gets an invisible bounds proxy so Box3.setFromObject(group) still spans the whole building.
  build(name = 'bag', { minShadowArea = 30, share = null } = {}) {
    const group = new THREE.Group();
    group.name = name;
    if (share) {
      const box = new THREE.Box3(), v = new THREE.Vector3();
      for (const A of this.acc.values()) for (let i = 0; i < A.p.length; i += 3) box.expandByPoint(v.set(A.p[i], A.p[i + 1], A.p[i + 2]));
      const part = { entry: share.entry, acc: new Map(), opts: new Map() };
      const c = Math.cos(share.frame.angle), s = Math.sin(share.frame.angle), [cx, cz] = share.frame.center;
      for (const [mat, A] of this.acc) {
        if (!A.p.length || !share.materials.has(mat)) continue;
        // bake the frame placement (see makeFrame.place) into positions and normals
        const p = new Float32Array(A.p.length), n = new Float32Array(A.n.length);
        for (let i = 0; i < A.p.length; i += 3) {
          const x = A.p[i], z = A.p[i + 2], nx = A.n[i], nz = A.n[i + 2];
          p[i] = cx + x * c - z * s; p[i + 1] = A.p[i + 1]; p[i + 2] = cz + x * s + z * c;
          n[i] = nx * c - nz * s; n[i + 1] = A.n[i + 1]; n[i + 2] = nx * s + nz * c;
        }
        part.acc.set(mat, { p, n, u: Float32Array.from(A.u), area: Bag.area(A) });
        if (this.opts.has(mat)) part.opts.set(mat, this.opts.get(mat));
        this.acc.delete(mat);
      }
      mallEastBatch(share.ctx).parts.push(part);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x, 0.1), Math.max(size.y, 0.1), Math.max(size.z, 0.1)), proxyMaterial());
        proxy.position.copy(ctr);
        proxy.visible = false;
        proxy.layers.set(31);   // never raycast
        proxy.name = `${name}:bounds`;
        group.add(proxy);
      }
    }
    for (const [mat, A] of this.acc) {
      if (!A.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(A.u, 2));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, mat);
      const o = this.opts.get(mat) || {};
      mesh.castShadow = o.castShadow ?? (Bag.area(A) >= minShadowArea);
      mesh.receiveShadow = o.receiveShadow ?? true;
      if (o.renderOrder) mesh.renderOrder = o.renderOrder;
      mesh.name = `${name}:${mat.name || 'mat'}`;
      group.add(mesh);
    }
    this.acc.clear();
    return group;
  }
}

// ---------------------------------------------------------------- Mall East batch
// CFA, Posner, Margaret Morrison and Hunt share most kit materials (trim, granite, pavers, windows, roofs, eaves…).
// Their triangles are merged into ONE mesh per material across the four buildings, in a shared
// 'landmarks:mallEast' group whose pick resolver maps a hit triangle back to its building. Each landmark keeps its
// unique materials (painted facades, reliefs, glass) in its own group.
export const MALL_EAST_KEYS = ['cfa', 'posner', 'mmch', 'hunt'];
const BATCHES = new WeakMap();
let PROXY_MAT = null;
function proxyMaterial() {
  if (!PROXY_MAT) { PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false }); PROXY_MAT.name = 'me-boundsProxy'; }
  return PROXY_MAT;
}
function mallEastBatch(ctx) {
  let b = BATCHES.get(ctx);
  if (!b) {
    b = { parts: [], settled: new Set(), flushed: false };
    BATCHES.set(ctx, b);
    // safety net: if one of the four is missing from the registry, flush on the first frame instead
    if (ctx.onUpdate) {
      const off = ctx.onUpdate(() => { off(); if (!b.flushed) flushMallEast(ctx, b); }, -100);
    }
  }
  return b;
}
// Call in a `finally` after every Mall East build (also when it threw): once all four reported, the merged meshes
// are built and added to the scene.
export function settleMallEast(ctx, key) {
  const b = mallEastBatch(ctx);
  b.settled.add(key);
  if (!b.flushed && MALL_EAST_KEYS.every((k) => b.settled.has(k))) flushMallEast(ctx, b);
}
function flushMallEast(ctx, b, minShadowArea = 30) {
  b.flushed = true;
  if (!b.parts.length || !ctx.scene) return;
  const group = new THREE.Group();
  group.name = 'landmarks:mallEast';
  const byMat = new Map();
  for (const part of b.parts) {
    for (const [mat, A] of part.acc) {
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat).push({ A, part });
    }
  }
  for (const [mat, list] of byMat) {
    let nv = 0, area = 0, cast = true;
    for (const { A, part } of list) { nv += A.p.length / 3; area += A.area; if (part.opts.get(mat)?.castShadow === false) cast = false; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const ranges = [];
    let v = 0;
    for (const { A, part } of list) {
      pos.set(A.p, v * 3); nor.set(A.n, v * 3); uv.set(A.u, v * 2);
      const cnt = A.p.length / 3;
      ranges.push({ start: v / 3, end: (v + cnt) / 3, entry: part.entry });
      v += cnt;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `mallEast:${mat.name || 'mat'}`;
    mesh.castShadow = cast && area >= minShadowArea;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.userData.ranges = ranges;
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  ctx.scene.add(group);
  ctx.pick?.add(group, (hit) => {
    const r = hit.object?.userData?.ranges, f = hit.faceIndex;
    if (!r || f == null) return null;
    for (const x of r) if (f >= x.start && f < x.end) return x.entry;
    return null;
  });
  b.parts.length = 0;
}

// ---------------------------------------------------------------- 2D ring utilities (local x/z)
export function ringArea2(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a;
}
// Walls/offsets in this kit assume area2 < 0 (then the outward normal of edge a→b is (-dz, dx)).
export function orientRing(r) { return ringArea2(r) > 0 ? r.slice().reverse() : r.slice(); }

export function ringLength(r, closed = true) {
  let L = 0;
  const m = closed ? r.length : r.length - 1;
  for (let i = 0; i < m; i++) { const p = r[i], q = r[(i + 1) % r.length]; L += Math.hypot(q[0] - p[0], q[1] - p[1]); }
  return L;
}

// Arc points (inclusive) around (cx, cz), angles in radians measured in the x/z plane: p = c + r(cos a, sin a).
export function arcPts(cx, cz, r, a0, a1, segs) {
  const out = [];
  for (let i = 0; i <= segs; i++) { const a = a0 + (a1 - a0) * (i / segs); out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return out;
}

// Mitred offset of a ring (area2 < 0 orientation): d > 0 → outward, d < 0 → inward. Open polylines: closed=false.
export function offsetRing(r, d, closed = true, maxMiter = 3) {
  const n = r.length, out = [];
  const nrm = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
  for (let i = 0; i < n; i++) {
    const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
    const n1 = hasPrev ? nrm(r[(i - 1 + n) % n], r[i]) : null;
    const n2 = hasNext ? nrm(r[i], r[(i + 1) % n]) : null;
    let mx, mz;
    if (n1 && n2) {
      const k = Math.max(1 + n1[0] * n2[0] + n1[1] * n2[1], 1 / (maxMiter * maxMiter));
      mx = (n1[0] + n2[0]) / k; mz = (n1[1] + n2[1]) / k;
    } else { const nn = n1 || n2; mx = nn[0]; mz = nn[1]; }
    out.push([r[i][0] + mx * d, r[i][1] + mz * d]);
  }
  return out;
}

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Triangulated horizontal polygon at height y. up=true → faces +Y. uv = (x, z) metres.
export function flatPolygon(bag, mat, ring, y, up = true, holes = []) {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const hs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  const all = contour.concat(...hs);
  for (const [i, j, k] of tris) {
    const a = [all[i].x, y, all[i].y], b = [all[j].x, y, all[j].y], c = [all[k].x, y, all[k].y];
    // winding: in x/z with y up, CCW seen from above means normal +Y when (b-a)x(c-a) has +y
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const flip = up ? cy < 0 : cy > 0;
    if (flip) bag.tri(mat, a, c, b, [a[0], a[2]], [c[0], c[2]], [b[0], b[2]]);
    else bag.tri(mat, a, b, c, [a[0], a[2]], [b[0], b[2]], [c[0], c[2]]);
  }
}

// ---------------------------------------------------------------- walls
// One vertical wall panel from a to b (local plan points), y0..y1, facing (-dz, dx) of a→b (use orientRing).
// u runs from u0 at a to u0+len at b; v = y - datum.
export function wallQuad(bag, mat, a, b, y0, y1, u0 = 0, datum = 0, y0b = null, y1b = null) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const yb0 = y0b ?? y0, yb1 = y1b ?? y1;
  bag.quad(mat,
    [a[0], y0, a[1]], [b[0], yb0, b[1]], [b[0], yb1, b[1]], [a[0], y1, a[1]],
    [u0, y0 - datum], [u0 + L, yb0 - datum], [u0 + L, yb1 - datum], [u0, y1 - datum]);
}

// Walls around a ring (area2 < 0). y0 may be a number or fn(i, point) (per-vertex base height).
// Bays are centred on every straight run of edges so painted windows sit symmetrically on each facade.
export function ringWalls(bag, mat, ring, y0, y1, { datum = 0, bay = 3.6, closed = true, skip = null, runAngle = 25 } = {}) {
  const n = ring.length, m = closed ? n : n - 1;
  const base = typeof y0 === 'function' ? y0 : () => y0;
  // group edges into runs of nearly collinear edges
  const dir = (i) => { const a = ring[i], b = ring[(i + 1) % n]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  const runs = [];
  let cur = [0];
  for (let i = 1; i < m; i++) {
    let d = Math.abs(dir(i) - dir(i - 1)); if (d > Math.PI) d = TAU - d;
    if (d < runAngle * DEG) cur.push(i); else { runs.push(cur); cur = [i]; }
  }
  runs.push(cur);
  for (const run of runs) {
    let L = 0;
    for (const i of run) { const a = ring[i], b = ring[(i + 1) % n]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const nb = Math.max(1, Math.round(L / bay));
    let u = (nb * bay - L) / 2 + bay * 64; // centre bays; + whole tiles keeps u positive
    for (const i of run) {
      const a = ring[i], b = ring[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!skip || !skip(i)) wallQuad(bag, mat, a, b, base(i, a), y1, u, datum, base((i + 1) % n, b), y1);
      u += len;
    }
  }
}

// A moulding (cornice, string course, plinth) swept along a ring: profile = [[out, h], ...] where out is the
// outward offset from the wall line and h the height above y0. Consecutive profile points form strips.
export function profileRing(bag, mat, ring, y0, profile, { closed = true } = {}) {
  const rings = profile.map(([d]) => offsetRing(ring, d, closed));
  const n = ring.length, m = closed ? n : n - 1;
  // u along the ring (at the wall line), v along the profile
  const us = [0];
  for (let i = 1; i <= n; i++) { const a = ring[i - 1], b = ring[i % n]; us.push(us[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  let vAcc = 0;
  for (let k = 0; k < profile.length - 1; k++) {
    const [d0, h0] = profile[k], [d1, h1] = profile[k + 1];
    const seg = Math.hypot(d1 - d0, h1 - h0);
    if (seg < 1e-6) continue;
    const r0 = rings[k], r1 = rings[k + 1];
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n;
      const A = [r0[i][0], y0 + h0, r0[i][1]], B = [r0[j][0], y0 + h0, r0[j][1]];
      const C = [r1[j][0], y0 + h1, r1[j][1]], D = [r1[i][0], y0 + h1, r1[i][1]];
      // outward-facing when the profile goes up/out; winding (A,B,C) faces (-dz,dx) × ... check with normal
      const ua = [us[i], vAcc], ub = [us[i + 1], vAcc], uc = [us[i + 1], vAcc + seg], ud = [us[i], vAcc + seg];
      // Determine desired facing: the profile segment's outward normal in (out, up) space is (dh, -dd) rotated;
      // for a segment going up (dh>0) and out (dd>=0) the face points outward/down. We orient by testing.
      const outN = [h1 - h0, -(d1 - d0)]; // (outward component, up component) of the face normal
      addOrientedQuad(bag, mat, A, B, C, D, ua, ub, uc, ud, ring, i, outN);
    }
    vAcc += seg;
  }
}

// Helper: emit quad A,B,C,D so that its normal agrees with the requested (outward, up) direction.
function addOrientedQuad(bag, mat, A, B, C, D, ua, ub, uc, ud, ring, i, outN) {
  const n = ring.length, a = ring[i], b = ring[(i + 1) % n];
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  const ox = -dz / l, oz = dx / l; // outward (area2<0)
  const want = [ox * outN[0], outN[1], oz * outN[0]];
  _e1.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  _e2.set(C[0] - A[0], C[1] - A[1], C[2] - A[2]);
  _n.crossVectors(_e1, _e2);
  if (_n.x * want[0] + _n.y * want[1] + _n.z * want[2] >= 0) bag.quad(mat, A, B, C, D, ua, ub, uc, ud);
  else bag.quad(mat, A, D, C, B, ua, ud, uc, ub);
}

// Truncated hip roof over any simple ring (area2<0): slopes rise from the eave (ring offset outward by
// `overhang`, at eaveY) inward by `inset` at `pitch`; the remaining top is flat (topMat) or omitted.
// Returns { topRing, topY }.
export function hipRoof(bag, mat, ring, eaveY, { overhang = 0.8, inset = 5, pitch = 24 * DEG, topMat = null, fasciaMat = null, fascia = 0.25, soffitMat = null, capMat = null, capMinTurn = 35 * DEG } = {}) {
  const outer = offsetRing(ring, overhang);
  const inner = offsetRing(ring, -inset);
  // Remove "swallowtails": where an inset edge runs backwards relative to its eave edge (short edges next to
  // reflex corners), collapse it to its midpoint — a cheap stand-in for the straight-skeleton edge event.
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (let i = 0; i < inner.length; i++) {
      const j = (i + 1) % inner.length;
      const ox = ring[j][0] - ring[i][0], oz = ring[j][1] - ring[i][1];
      const ix = inner[j][0] - inner[i][0], iz = inner[j][1] - inner[i][1];
      if (ox * ix + oz * iz < -1e-6) {
        const m = [(inner[i][0] + inner[j][0]) / 2, (inner[i][1] + inner[j][1]) / 2];
        inner[i] = m; inner[j] = [m[0], m[1]];
        changed = true;
      }
    }
    if (!changed) break;
  }
  const t = Math.tan(pitch);
  const topY = eaveY + (overhang + inset) * t;
  const n = ring.length;
  const slope = 1 / Math.cos(pitch);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o0 = outer[i], o1 = outer[j], i0 = inner[i], i1 = inner[j];
    const ex = o1[0] - o0[0], ez = o1[1] - o0[1], el = Math.hypot(ex, ez) || 1;
    const dx = ex / el, dz = ez / el;
    // uv: u along eave, v up-slope (horizontal distance from the eave line × 1/cos)
    const uvOf = (p) => {
      const rx = p[0] - o0[0], rz = p[1] - o0[1];
      const u = rx * dx + rz * dz;
      const w = Math.abs(rx * -dz + rz * dx); // perpendicular distance (inward)
      return [u, w * slope];
    };
    const A = [o0[0], eaveY, o0[1]], B = [o1[0], eaveY, o1[1]], C = [i1[0], topY, i1[1]], D = [i0[0], topY, i0[1]];
    _e1.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    _e2.set(C[0] - A[0], C[1] - A[1], C[2] - A[2]);
    _n.crossVectors(_e1, _e2);
    if (_n.y >= 0) bag.quad(mat, A, B, C, D, uvOf(o0), uvOf(o1), uvOf(i1), uvOf(i0));
    else bag.quad(mat, A, D, C, B, uvOf(o0), uvOf(i0), uvOf(i1), uvOf(o1));
    if (fasciaMat && fascia > 0) wallQuad(bag, fasciaMat, o0, o1, eaveY - fascia, eaveY, 0, 0);
  }
  if (soffitMat) {
    // underside of the overhang (faces down)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const y = eaveY - fascia;
      const a = [ring[i][0], y, ring[i][1]], b = [ring[j][0], y, ring[j][1]], c = [outer[j][0], y, outer[j][1]], d = [outer[i][0], y, outer[i][1]];
      _e1.set(b[0] - a[0], 0, b[2] - a[2]); _e2.set(c[0] - a[0], 0, c[2] - a[2]); _n.crossVectors(_e1, _e2);
      if (_n.y <= 0) bag.quad(soffitMat, a, b, c, d); else bag.quad(soffitMat, a, d, c, b);
    }
  }
  if (topMat) flatPolygon(bag, topMat, inner, topY, true);
  // hip caps: a low ridge "tent" along each hip line whose corner turns by more than capMinTurn
  if (capMat) {
    for (let i = 0; i < n; i++) {
      const p = ring[(i - 1 + n) % n], q = ring[i], r2 = ring[(i + 1) % n];
      const a1 = Math.atan2(q[1] - p[1], q[0] - p[0]), a2 = Math.atan2(r2[1] - q[1], r2[0] - q[0]);
      let turn = Math.abs(a2 - a1); if (turn > Math.PI) turn = TAU - turn;
      if (turn < capMinTurn) continue;
      const A = [outer[i][0], eaveY, outer[i][1]], B = [inner[i][0], topY, inner[i][1]];
      const dx = B[0] - A[0], dz = B[2] - A[2], L = Math.hypot(dx, dz) || 1;
      const sx = (-dz / L) * 0.14, sz = (dx / L) * 0.14, h = 0.12;
      const A1 = [A[0] + sx, A[1] + 0.02, A[2] + sz], A2 = [A[0] - sx, A[1] + 0.02, A[2] - sz], At = [A[0], A[1] + h, A[2]];
      const B1 = [B[0] + sx, B[1] + 0.02, B[2] + sz], B2 = [B[0] - sx, B[1] + 0.02, B[2] - sz], Bt = [B[0], B[1] + h, B[2]];
      orientQuadTo(bag, capMat, A1, B1, Bt, At, null, null, null, null, [sx, 0.5, sz]);
      orientQuadTo(bag, capMat, A2, B2, Bt, At, null, null, null, null, [-sx, 0.5, -sz]);
    }
  }
  return { topRing: inner, topY, outer };
}

// ---------------------------------------------------------------- curved solids
// Annular sector between radii r0<r1 and angles a0<a1 (x/z plane), from y0 to y1.
// faces: { outer, inner, top, bottom, ends } → material or null. datum sets v on vertical faces.
export function ringSector(bag, faces, cx, cz, r0, r1, a0, a1, y0, y1, segs = 24, datum = 0) {
  const P = (r, a, y) => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + (a1 - a0) * (i / segs), t1 = a0 + (a1 - a0) * ((i + 1) / segs);
    const s0 = r1 * (t0 - a0), s1 = r1 * (t1 - a0), q0 = r0 * (t0 - a0), q1 = r0 * (t1 - a0);
    // outer (normal away from centre)
    if (faces.outer) orientQuadTo(bag, faces.outer, P(r1, t0, y0), P(r1, t1, y0), P(r1, t1, y1), P(r1, t0, y1),
      [s0, y0 - datum], [s1, y0 - datum], [s1, y1 - datum], [s0, y1 - datum], [Math.cos((t0 + t1) / 2), 0, Math.sin((t0 + t1) / 2)]);
    if (faces.inner) orientQuadTo(bag, faces.inner, P(r0, t0, y0), P(r0, t1, y0), P(r0, t1, y1), P(r0, t0, y1),
      [-q0, y0 - datum], [-q1, y0 - datum], [-q1, y1 - datum], [-q0, y1 - datum], [-Math.cos((t0 + t1) / 2), 0, -Math.sin((t0 + t1) / 2)]);
    if (faces.top) orientQuadTo(bag, faces.top, P(r0, t0, y1), P(r0, t1, y1), P(r1, t1, y1), P(r1, t0, y1), null, null, null, null, [0, 1, 0]);
    if (faces.bottom) orientQuadTo(bag, faces.bottom, P(r0, t0, y0), P(r0, t1, y0), P(r1, t1, y0), P(r1, t0, y0), null, null, null, null, [0, -1, 0]);
  }
  if (faces.ends) {
    for (const [a, sgn] of [[a0, -1], [a1, 1]]) {
      const tx = -Math.sin(a) * sgn, tz = Math.cos(a) * sgn;
      orientQuadTo(bag, faces.ends, P(r0, a, y0), P(r1, a, y0), P(r1, a, y1), P(r0, a, y1), null, null, null, null, [tx, 0, tz]);
    }
  }
}

// Emit a quad oriented so that its normal points roughly along `want` ([x,y,z]).
export function orientQuadTo(bag, mat, A, B, C, D, ua, ub, uc, ud, want) {
  _e1.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  _e2.set(C[0] - A[0], C[1] - A[1], C[2] - A[2]);
  _n.crossVectors(_e1, _e2);
  if (_n.x * want[0] + _n.y * want[1] + _n.z * want[2] >= 0) bag.quad(mat, A, B, C, D, ua, ub, uc, ud);
  else bag.quad(mat, A, D, C, B, ua, ud, uc, ub);
}

// Vertical cylinder wall (open) — outward or inward facing. u = arc length, v = y - datum.
export function cylinderWall(bag, mat, cx, cz, r, a0, a1, y0, y1, segs, { inward = false, datum = 0, u0 = 0 } = {}) {
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + (a1 - a0) * (i / segs), t1 = a0 + (a1 - a0) * ((i + 1) / segs);
    const A = [cx + r * Math.cos(t0), y0, cz + r * Math.sin(t0)], B = [cx + r * Math.cos(t1), y0, cz + r * Math.sin(t1)];
    const C = [B[0], y1, B[2]], D = [A[0], y1, A[2]];
    const s0 = u0 + r * (t0 - a0) * (inward ? -1 : 1), s1 = u0 + r * (t1 - a0) * (inward ? -1 : 1);
    const m = (t0 + t1) / 2, sg = inward ? -1 : 1;
    orientQuadTo(bag, mat, A, B, C, D, [s0, y0 - datum], [s1, y0 - datum], [s1, y1 - datum], [s0, y1 - datum], [sg * Math.cos(m), 0, sg * Math.sin(m)]);
  }
}

// ---------------------------------------------------------------- lathe-based classical columns
// profile: [[radius, height], ...] from bottom to top. Returns a LatheGeometry with metre UVs (u = arc, v = y).
export function latheGeo(profile, segs = 14) {
  const pts = profile.map(([r, h]) => new THREE.Vector2(Math.max(r, 0.0001), h));
  const g = new THREE.LatheGeometry(pts, segs);
  const uv = g.attributes.uv, pos = g.attributes.position;
  const rMax = Math.max(...profile.map((p) => p[0]));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * rMax, pos.getY(i));
  return g;
}

// Tuscan/Doric column: square plinth, torus base, tapering shaft (entasis), echinus, square abacus.
// order: 'doric' | 'ionic' | 'corinthian' | 'egyptian' (lotus-bell capital). Height H from y0, lower radius r.
export function column(bag, mat, x, z, y0, H, r, { order = 'doric', segs = 14, plinth = true, capMat = null } = {}) {
  const cm = capMat || mat;
  const pl = plinth ? 0.32 * r : 0;
  if (plinth) bag.box(mat, x, y0 + pl / 2, z, 2.5 * r, pl, 2.5 * r);
  const capH = order === 'corinthian' ? 1.9 * r : order === 'egyptian' ? 1.6 * r : 0.9 * r;
  const abH = order === 'egyptian' ? 0.25 * r : 0.28 * r;
  const shaftTop = H - capH - abH;
  const prof = [[1.25 * r, pl], [1.25 * r, pl + 0.1 * r], [1.12 * r, pl + 0.28 * r], [1.0 * r, pl + 0.4 * r]];
  const n = 6;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const rr = r * (1 - 0.16 * t * t + 0.03 * Math.sin(Math.PI * t));
    prof.push([rr, pl + 0.4 * r + (shaftTop - pl - 0.4 * r) * t]);
  }
  const rt = r * 0.84;
  if (order === 'doric' || order === 'ionic') {
    prof.push([rt * 1.08, shaftTop + 0.05 * r], [rt, shaftTop + 0.12 * r]);
    prof.push([rt * 1.12, shaftTop + 0.45 * r], [rt * 1.45, shaftTop + capH]);
  } else if (order === 'corinthian') {
    // bell with leaves suggested by a swelling
    prof.push([rt * 1.05, shaftTop + 0.05 * r], [rt * 1.12, shaftTop + 0.6 * r], [rt * 1.3, shaftTop + 1.2 * r], [rt * 1.55, shaftTop + capH]);
  } else {
    // egyptian papyrus/lotus bell
    prof.push([rt * 0.95, shaftTop + 0.1 * r], [rt * 1.3, shaftTop + 0.6 * r], [rt * 1.75, shaftTop + 1.2 * r], [rt * 1.85, shaftTop + capH]);
  }
  prof.push([0.001, shaftTop + capH]);
  const g = latheGeo(prof, segs);
  bag.geo(mat, g, { matrix: new THREE.Matrix4().makeTranslation(x, y0, z), uv: 'keep' });
  g.dispose();
  // abacus
  const abW = order === 'egyptian' ? 2.1 * r : order === 'corinthian' ? 3.0 * r : 2.9 * r;
  bag.box(cm, x, y0 + shaftTop + capH + abH / 2, z, abW, abH, abW);
  if (order === 'ionic') {
    // volutes: two short horizontal cylinders under the abacus
    const vg = new THREE.CylinderGeometry(0.32 * r, 0.32 * r, 2.6 * r, 10);
    vg.rotateZ(Math.PI / 2);
    bag.geo(cm, vg, { matrix: new THREE.Matrix4().makeTranslation(x, y0 + shaftTop + capH - 0.25 * r, z) });
    vg.dispose();
  }
}

// ---------------------------------------------------------------- arched outlines for Shapes / Paths
// Draw a (counter-clockwise) outline: rectangle from (x0,y0) width w, total height h, with top `type`:
// 'round' (semicircle), 'segmental' (rise = rise), 'pointed' (equilateral gothic), 'flat'.
export function archOutline(path, x0, y0, w, h, type = 'round', { rise = null, clockwise = false } = {}) {
  const pts = archPoints(x0, y0, w, h, type, { rise });
  if (clockwise) pts.reverse();
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
  path.closePath?.();
  return path;
}
export function archPoints(x0, y0, w, h, type = 'round', { rise = null, segs = 12 } = {}) {
  const pts = [[x0, y0], [x0 + w, y0]];
  const cx = x0 + w / 2;
  if (type === 'round') {
    const sp = y0 + h - w / 2;
    pts.push([x0 + w, sp]);
    for (let i = 1; i < segs; i++) { const a = (Math.PI * i) / segs; pts.push([cx + (w / 2) * Math.cos(a), sp + (w / 2) * Math.sin(a)]); }
    pts.push([x0, sp]);
  } else if (type === 'segmental') {
    const s = rise ?? w * 0.18;
    const sp = y0 + h - s;
    const R = (w * w / 4 + s * s) / (2 * s);
    const cy = sp + s - R;
    const half = Math.asin(Math.min(1, (w / 2) / R));
    pts.push([x0 + w, sp]);
    for (let i = 1; i < segs; i++) { const a = Math.PI / 2 - half + (2 * half * i) / segs; pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
    pts.push([x0, sp]);
  } else if (type === 'pointed') {
    const R = w;
    const sp = y0 + h - w * Math.sin(Math.PI / 3);
    pts.push([x0 + w, sp]);
    const k = segs >> 1;
    for (let i = 1; i <= k; i++) { const a = Math.PI - (Math.PI / 3) * (i / k); pts.push([x0 + w + R * Math.cos(a), sp + R * Math.sin(a)]); }
    for (let i = 1; i < k; i++) { const a = (Math.PI / 3) - (Math.PI / 3) * (i / k); pts.push([x0 + R * Math.cos(a), sp + R * Math.sin(a)]); }
    pts.push([x0, sp]);
  } else {
    pts.push([x0 + w, y0 + h], [x0, y0 + h]);
  }
  return pts;
}

// Flat panel in a vertical plane from a 2D outline (points in panel space u,v) placed by a matrix whose
// columns map (u, v, 0) into local space. uvMode 'unit' maps the outline's bbox to 0..1, 'metre' keeps u,v.
export function outlinePanel(bag, mat, pts, matrix, { uvMode = 'metre', flip = false, uvRect = null } = {}) {
  const contour = pts.map(([u, v]) => new THREE.Vector2(u, v));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [u, v] of pts) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const P = new THREE.Vector3();
  const map = (u, v) => {
    if (uvMode === 'unit') {
      let s = (u - u0) / (u1 - u0 || 1), t = (v - v0) / (v1 - v0 || 1);
      if (uvRect) { s = uvRect[0] + s * (uvRect[2] - uvRect[0]); t = uvRect[1] + t * (uvRect[3] - uvRect[1]); }
      return [s, t];
    }
    return [u, v];
  };
  const W = (u, v) => { P.set(u, v, 0).applyMatrix4(matrix); return [P.x, P.y, P.z]; };
  for (const [i, j, k] of tris) {
    const a = pts[i], b = pts[j], c = pts[k];
    // triangulateShape returns CCW in (u,v); keep CCW → faces +Z of the panel frame
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let A = a, B = b, C = c;
    if ((cross < 0) !== flip) { B = c; C = b; }
    bag.tri(mat, W(A[0], A[1]), W(B[0], B[1]), W(C[0], C[1]), map(A[0], A[1]), map(B[0], B[1]), map(C[0], C[1]));
  }
}

// Matrix mapping panel space (u along the facade, v = world y, w = outward) onto a local-frame facade line
// starting at plan point p0 with direction angle `ang` (radians in x/z), outward normal = (-sin, cos) rotated.
// For a facade facing local +z: facadeMatrix(0, zFront) maps (u,v,w) → (u, v, zFront + w).
export function facadeMatrix(x0, z0, ang = 0) {
  const c = Math.cos(ang), s = Math.sin(ang);
  // columns: u-axis → (c, 0, s); v-axis → (0,1,0); w-axis (outward) → (-s, 0, c)
  return new THREE.Matrix4().set(
    c, 0, -s, x0,
    0, 1, 0, 0,
    s, 0, c, z0,
    0, 0, 0, 1,
  );
}

// Extruded wall slab with openings, in panel space (u, v=world y): outline = [[u,v],...] of the wall;
// holes = arrays of [[u,v],...]. Depth extrudes inward (−w) from w=0 (the outer face).
export function wallWithHoles(bag, mat, outline, holes, depth, matrix) {
  const shape = new THREE.Shape(outline.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -depth);
  // UVs: caps use (u, v) metres; the reveals use three's WorldUVGenerator (metres too). The back cap is kept
  // (it is hidden inside the building) — cheaper than splitting the geometry groups.
  bag.geo(mat, g, { matrix, uv: 'keep' });
  g.dispose();
}

// Recess ("tunnel") behind an opening: the opening outline (panel space) swept from w=w0 to w=w1 (w1 < w0),
// faces pointing inward (visible from outside). Also closes the back with `backMat` at w1.
export function recess(bag, mat, pts, w0, w1, matrix, { backMat = null, backUV = 'metre', backUvRect = null, floorMat = null, matFn = null } = {}) {
  const n = pts.length;
  const P = new THREE.Vector3();
  const W = (u, v, w) => { P.set(u, v, w).applyMatrix4(matrix); return [P.x, P.y, P.z]; };
  const vMin = Math.min(...pts.map((p) => p[1]));
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const isBottom = Math.abs(a[1] - b[1]) < 1e-6 && a[1] <= vMin + 1e-6;
    const m = isBottom && floorMat ? floorMat : (matFn ? matFn(a, b, i) : mat);
    if (!m) { acc += L; continue; }
    // inward-facing: normal points toward the opening's interior (the centroid) — outline is CCW so the
    // interior is on the left of a→b; build quad and orient toward the left normal.
    const lx = -(b[1] - a[1]) / (L || 1), ly = (b[0] - a[0]) / (L || 1);
    const A = W(a[0], a[1], w0), B = W(b[0], b[1], w0), C = W(b[0], b[1], w1), D = W(a[0], a[1], w1);
    // desired normal in local space = matrix applied to direction (lx, ly, 0) (rotation part only)
    const e = matrix.elements;
    const want = [e[0] * lx + e[4] * ly, e[1] * lx + e[5] * ly, e[2] * lx + e[6] * ly];
    const du = Math.abs(w0 - w1);
    orientQuadTo(bag, m, A, B, C, D, [acc, 0], [acc + L, 0], [acc + L, du], [acc, du], want);
    acc += L;
  }
  if (backMat) {
    const bm = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, w1));
    outlinePanel(bag, backMat, pts, bm, { uvMode: backUV, uvRect: backUvRect });
  }
}

// Simple hash-based PRNG
export function prng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
