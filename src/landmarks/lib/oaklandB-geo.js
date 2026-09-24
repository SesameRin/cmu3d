// Geometry toolkit shared by the Oakland-B landmarks (Carnegie Institute complex, Dippy, Phipps Conservatory).
//
// Everything is accumulated as flat-shaded triangles into per-material buckets and merged into ONE mesh per
// material at the end, so a whole landmark costs roughly one draw call per material it uses.
// All UVs are generated here in METRES (u along the surface horizontally, v upward), matching ctx.materials.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();

export class GeoBatch {
  /**
   * opts.aux: record a per-vertex vec2 'aux' attribute (value = this.aux at the time each vertex is emitted, default
   * [0, 0]); build() attaches it to the meshes whose key is listed in build opts.aux. Used by the Phipps glass shader
   * (x = floor height of the room behind the glass, y = dimming 0..1).
   */
  constructor(opts = {}) {
    this.buckets = new Map();
    this.useAux = !!opts.aux;
    this.aux = [0, 0];
  }

  _bucket(key) {
    let b = this.buckets.get(key);
    if (!b) { b = { p: [], n: [], uv: [], a: this.useAux ? [] : null }; this.buckets.set(key, b); }
    return b;
  }

  /** Triangle a,b,c ([x,y,z]) with uvs ([u,v]); normal = explicit n or the face normal. */
  tri(key, a, b, c, ua, ub, uc, n = null) {
    const bk = this._bucket(key);
    if (!n) {
      _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      _n.crossVectors(_a, _b);
      const l = _n.length();
      if (l < 1e-10) return;
      _n.multiplyScalar(1 / l);
      n = [_n.x, _n.y, _n.z];
    }
    bk.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    bk.n.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    bk.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    if (bk.a) { const [x, y] = this.aux; bk.a.push(x, y, x, y, x, y); }
  }

  /**
   * Planar-ish quad a-b-c-d (listed around the perimeter). If `facing` ([x,y,z]) is given the winding is
   * flipped when needed so the front face points that way; otherwise the a,b,c order defines the front.
   */
  quad(key, a, b, c, d, ua, ub, uc, ud, facing = null) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    _n.crossVectors(_a, _b);
    if (_n.lengthSq() < 1e-12) {
      _a.set(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
      _b.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      _n.crossVectors(_a, _b);
      if (_n.lengthSq() < 1e-12) return;
    }
    if (facing && _n.x * facing[0] + _n.y * facing[1] + _n.z * facing[2] < 0) {
      // reverse: a d c b
      [b, d] = [d, b];
      [ub, ud] = [ud, ub];
    }
    this.tri(key, a, b, c, ua, ub, uc);
    this.tri(key, a, c, d, ua, uc, ud);
  }

  /**
   * Vertical wall between (x0,z0) and (x1,z1). Bottom/top heights may differ at each end (sloping ground).
   * outward = [nx, nz] (which side is the front). UVs: u = metres measured along the "right" direction as seen
   * from outside (so text/ornament reads correctly), v = y - vOrigin.
   */
  wall(key, x0, z0, x1, z1, yb0, yb1, yt0, yt1, outward, vOrigin = 0, uAnchor = null) {
    const [nx, nz] = outward;
    // right-hand direction when looking at the wall from outside: (nz, -nx)
    let u0 = x0 * nz - z0 * nx, u1 = x1 * nz - z1 * nx;
    if (uAnchor !== null) { // u measured from the wall's midpoint (+ anchor) so facades are symmetric per wall
      const um = (u0 + u1) / 2;
      u0 = u0 - um + uAnchor; u1 = u1 - um + uAnchor;
    }
    this.quad(key,
      [x0, yb0, z0], [x1, yb1, z1], [x1, yt1, z1], [x0, yt0, z0],
      [u0, yb0 - vOrigin], [u1, yb1 - vOrigin], [u1, yt1 - vOrigin], [u0, yt0 - vOrigin],
      [nx, 0, nz]);
  }

  /** Axis-aligned box in the batch's space. opts: { vOrigin, top=true, bottom=false, sides=true } */
  box(key, x0, x1, y0, y1, z0, z1, opts = {}) {
    const vo = opts.vOrigin ?? y0;
    const sides = opts.sides ?? true;
    const topKey = opts.topKey || key;
    if (sides) {
      this.wall(key, x0, z1, x1, z1, y0, y0, y1, y1, [0, 1], vo);
      this.wall(key, x1, z0, x0, z0, y0, y0, y1, y1, [0, -1], vo);
      this.wall(key, x1, z1, x1, z0, y0, y0, y1, y1, [1, 0], vo);
      this.wall(key, x0, z0, x0, z1, y0, y0, y1, y1, [-1, 0], vo);
    }
    if (opts.top !== false) this.quad(topKey, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [x0, z0], [x1, z0], [x1, z1], [x0, z1], [0, 1, 0]);
    if (opts.bottom) this.quad(key, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, z0], [x1, z0], [x1, z1], [x0, z1], [0, -1, 0]);
  }

  /** Oriented box: centre (cx,cz), half extents along its local axes, rotation about +Y (radians). */
  obox(key, cx, cz, hw, hd, y0, y1, rotY, opts = {}) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const P = (a, b) => [cx + a * c + b * s, cz - a * s + b * c];
    const q = [P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)];
    this.prism(key, q, y0, y1, opts);
  }

  /**
   * Extruded polygon (ring of [x,z], any orientation) between y0 and y1 (numbers or functions (x,z)=>y for the
   * bottom). opts: { top=true, bottom=false, topKey, vOrigin }
   */
  prism(key, ring, y0, y1, opts = {}) {
    const sgn = signedArea(ring) > 0 ? 1 : -1;
    const vo = opts.vOrigin ?? (typeof y0 === 'number' ? y0 : 0);
    const yb = typeof y0 === 'function' ? y0 : () => y0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      const nx = (dz / L) * sgn, nz = (-dx / L) * sgn;
      const anchor = opts.uAnchor ? opts.uAnchor(i, L) : null;
      this.wall(key, a[0], a[1], b[0], b[1], yb(a[0], a[1]), yb(b[0], b[1]), y1, y1, [nx, nz], vo, anchor);
    }
    if (opts.top !== false) this.polygon(opts.topKey || key, ring, y1, 1);
    if (opts.bottom) this.polygon(key, ring, typeof y0 === 'number' ? y0 : 0, -1);
  }

  /** Flat horizontal polygon at height y facing up (dir=1) or down (-1). holes optional. UV = (x, z). */
  polygon(key, ring, y, dir = 1, holes = []) {
    const contour = ring.map((p) => new THREE.Vector2(p[0], p[1]));
    const hs = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const all = [...ring, ...holes.flat()];
    for (const [i, j, k] of tris) {
      const a = all[i], b = all[j], c = all[k];
      const A = [a[0], y, a[1]], B = [b[0], y, b[1]], C = [c[0], y, c[1]];
      // cross((B-A),(C-A)).y = (bz-az)(cx-ax) - (bx-ax)(cz-az)
      const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (ny * dir >= 0) this.tri(key, A, B, C, [a[0], a[1]], [b[0], b[1]], [c[0], c[1]], [0, dir, 0]);
      else this.tri(key, A, C, B, [a[0], a[1]], [c[0], c[1]], [b[0], b[1]], [0, dir, 0]);
    }
  }

  /** Polygon with per-vertex height yFn(x,z) (planar sloped roofs), facing up. UV = (x, z). */
  polygonSloped(key, ring, yFn) {
    const contour = ring.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [i, j, k] of tris) {
      const a = ring[i], b = ring[j], c = ring[k];
      const A = [a[0], yFn(a[0], a[1]), a[1]], B = [b[0], yFn(b[0], b[1]), b[1]], C = [c[0], yFn(c[0], c[1]), c[1]];
      const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (ny >= 0) this.tri(key, A, B, C, [a[0], a[1]], [b[0], b[1]], [c[0], c[1]]);
      else this.tri(key, A, C, B, [a[0], a[1]], [c[0], c[1]], [b[0], b[1]]);
    }
  }

  /**
   * Hipped roof over an axis-aligned rectangle (x0..x1, z0..z1) starting at y, rising h. Ridge along the long axis.
   * UV: u along the eave, v up the slope (metres) — standing seams run down-slope.
   */
  hipRoof(key, x0, x1, z0, z1, y, h, overhang = 0) {
    x0 -= overhang; x1 += overhang; z0 -= overhang; z1 += overhang;
    const w = x1 - x0, d = z1 - z0;
    const alongX = w >= d;
    const half = (alongX ? d : w) / 2;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const top = y + h;
    let r0, r1; // ridge ends
    if (alongX) { r0 = [x0 + half, top, cz]; r1 = [x1 - half, top, cz]; }
    else { r0 = [cx, top, z0 + half]; r1 = [cx, top, z1 - half]; }
    const A = [x0, y, z0], B = [x1, y, z0], C = [x1, y, z1], D = [x0, y, z1];
    const slope = Math.hypot(half, h);
    const start = this._bucket(key).p.length;
    // p,q = eave corners; r,s = ridge points above q,p
    const face = (p, q, r, s, len) => {
      const inset = (len - Math.hypot(r[0] - s[0], r[2] - s[2])) / 2;
      this.quad(key, p, q, r, s, [0, 0], [len, 0], [len - inset, slope], [inset, slope], [0, 1, 0]);
    };
    if (alongX) {
      face(A, B, r1, r0, w); // north (z0)
      face(C, D, r0, r1, w); // south
      this.tri(key, B, C, r1, [0, 0], [d, 0], [d / 2, slope], null);
      this.tri(key, D, A, r0, [0, 0], [d, 0], [d / 2, slope], null);
    } else {
      face(B, C, r1, r0, d);
      face(D, A, r0, r1, d);
      this.tri(key, A, B, r0, [0, 0], [w, 0], [w / 2, slope], null);
      this.tri(key, C, D, r1, [0, 0], [w, 0], [w / 2, slope], null);
    }
    this._fixUp(key, start);
  }

  // make sure the most recent roof triangles face upwards (they are generated with arbitrary winding)
  _fixUp(key, start) {
    const b = this._bucket(key);
    const p = b.p, n = b.n;
    for (let t = start; t < p.length; t += 9) {
      _a.set(p[t + 3] - p[t], p[t + 4] - p[t + 1], p[t + 5] - p[t + 2]);
      _b.set(p[t + 6] - p[t], p[t + 7] - p[t + 1], p[t + 8] - p[t + 2]);
      _n.crossVectors(_a, _b).normalize();
      if (_n.y < 0) {
        // swap vertices 1 and 2 (positions, uvs) and flip normal
        for (let k = 0; k < 3; k++) { const tmp = p[t + 3 + k]; p[t + 3 + k] = p[t + 6 + k]; p[t + 6 + k] = tmp; }
        const uvb = (t / 9) * 6;
        const uv = b.uv;
        let tmp = uv[uvb + 2]; uv[uvb + 2] = uv[uvb + 4]; uv[uvb + 4] = tmp;
        tmp = uv[uvb + 3]; uv[uvb + 3] = uv[uvb + 5]; uv[uvb + 5] = tmp;
        _n.negate();
      }
      for (let k = 0; k < 3; k++) { n[t + k * 3] = _n.x; n[t + k * 3 + 1] = _n.y; n[t + k * 3 + 2] = _n.z; }
    }
  }

  /**
   * Loft a closed profile along the edges of a ring (mouldings, cornices, parapets, base courses).
   * profile: [[offset, y], ...] — offset > 0 pushes outward from the ring. Mitered at corners.
   * skipEdge(i) → true to leave edge i (ring[i]→ring[i+1]) out.
   */
  ringLoft(key, ring, profile, skipEdge = null, vOrigin = 0) {
    const sgn = signedArea(ring) > 0 ? 1 : -1;
    const N = ring.length;
    const normals = [];
    for (let i = 0; i < N; i++) {
      const a = ring[i], b = ring[(i + 1) % N];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      normals.push([(dz / L) * sgn, (-dx / L) * sgn]);
    }
    const off = ring.map((_, i) => miterVector(normals[(i - 1 + N) % N], normals[i], skipEdge ? skipEdge((i - 1 + N) % N) : false, skipEdge ? skipEdge(i) : false));
    for (let i = 0; i < N; i++) {
      if (skipEdge && skipEdge(i)) continue;
      const j = (i + 1) % N;
      const a = ring[i], b = ring[j], ma = off[i], mb = off[j];
      const n = normals[i];
      for (let k = 0; k < profile.length - 1; k++) {
        const [o0, y0] = profile[k], [o1, y1] = profile[k + 1];
        const A0 = [a[0] + ma[0] * o0, y0, a[1] + ma[1] * o0], B0 = [b[0] + mb[0] * o0, y0, b[1] + mb[1] * o0];
        const A1 = [a[0] + ma[0] * o1, y1, a[1] + ma[1] * o1], B1 = [b[0] + mb[0] * o1, y1, b[1] + mb[1] * o1];
        // facing: outward-ish combined with vertical component from the profile step
        const dy = y1 - y0, dof = o1 - o0;
        const fy = -dof, fh = dy; // normal of the profile segment in (horizontal, vertical) = (dy, -dof)
        const facing = [n[0] * fh, fy, n[1] * fh];
        const u0 = a[0] * n[1] - a[1] * n[0], u1 = b[0] * n[1] - b[1] * n[0];
        const len = Math.hypot(dy, dof);
        const vA = Math.abs(dof) > Math.abs(dy) ? 0 : y0 - vOrigin, vB = Math.abs(dof) > Math.abs(dy) ? len : y1 - vOrigin;
        this.quad(key, A0, B0, B1, A1, [u0, vA], [u1, vA], [u1, vB], [u0, vB], facing);
      }
    }
  }

  /** Append any BufferGeometry (converted to non-indexed), transformed by matrix. Keeps its normals/uvs. */
  addGeometry(key, geom, matrix = null, uvScale = 1) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const bk = this._bucket(key);
    if (matrix) _m3.getNormalMatrix(matrix);
    for (let i = 0; i < pos.count; i++) {
      _a.fromBufferAttribute(pos, i);
      _b.fromBufferAttribute(nor, i);
      if (matrix) { _a.applyMatrix4(matrix); _b.applyMatrix3(_m3).normalize(); }
      bk.p.push(_a.x, _a.y, _a.z);
      bk.n.push(_b.x, _b.y, _b.z);
      if (uv) bk.uv.push(uv.getX(i) * uvScale, uv.getY(i) * uvScale); else bk.uv.push(0, 0);
      if (bk.a) bk.a.push(this.aux[0], this.aux[1]);
    }
    if (g !== geom) g.dispose();
  }

  /** Move every bucket of `other` into this batch, transformed by matrix (UVs kept). `other` is emptied. */
  merge(other, matrix) {
    _m3.getNormalMatrix(matrix);
    for (const [key, ob] of other.buckets) {
      const bk = this._bucket(key);
      const p = ob.p, n = ob.n;
      for (let i = 0; i < p.length; i += 3) {
        _a.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(matrix);
        _b.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(_m3).normalize();
        bk.p.push(_a.x, _a.y, _a.z);
        bk.n.push(_b.x, _b.y, _b.z);
      }
      for (let i = 0; i < ob.uv.length; i++) bk.uv.push(ob.uv[i]);
      if (bk.a) {
        if (ob.a) for (let i = 0; i < ob.a.length; i++) bk.a.push(ob.a[i]);
        else for (let i = 0; i < p.length; i += 3) bk.a.push(this.aux[0], this.aux[1]);
      }
    }
    other.buckets.clear();
  }

  /** Number of triangles accumulated (all buckets) */
  triangles() {
    let t = 0;
    for (const b of this.buckets.values()) t += b.p.length / 9;
    return t;
  }

  /**
   * Build a Group with one Mesh per material: keys that map to the same Material object are merged into one mesh
   * (one draw call). materials: { key: Material }, shadows: { key: { cast, receive } } (default cast+receive true;
   * a merged mesh casts/receives if any of its keys does), aux: { key: true } attaches the 'aux' attribute.
   */
  build(materials, opts = {}) {
    const group = new THREE.Group();
    const byMat = new Map(); // material → { keys, parts }
    for (const [key, b] of this.buckets) {
      if (!b.p.length) continue;
      const mat = materials[key];
      if (!mat) { console.warn('[oaklandB] no material for', key); continue; }
      let e = byMat.get(mat);
      if (!e) { e = { keys: [], parts: [] }; byMat.set(mat, e); }
      e.keys.push(key); e.parts.push(b);
    }
    const cat = (parts, f) => (parts.length === 1 ? parts[0][f] : parts.flatMap((b) => b[f]));
    for (const [mat, { keys, parts }] of byMat) {
      const key = keys.join('+');
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(cat(parts, 'p'), 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(cat(parts, 'n'), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(cat(parts, 'uv'), 2));
      if (keys.some((k) => opts.aux?.[k]) && parts.every((b) => b.a)) g.setAttribute('aux', new THREE.Float32BufferAttribute(cat(parts, 'a'), 2));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const m = new THREE.Mesh(g, mat);
      m.name = `oaklandB:${key}`;
      const shs = keys.map((k) => opts.shadows?.[k]);
      m.castShadow = shs.some((sh) => (sh ? !!sh.cast : true));
      m.receiveShadow = shs.some((sh) => (sh ? sh.receive !== false : true));
      const ro = keys.map((k) => opts.renderOrder?.[k]).find((v) => v !== undefined);
      if (ro !== undefined) m.renderOrder = ro;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      group.add(m);
    }
    this.buckets.clear();
    return group;
  }
}

// Mitered offset direction at a ring vertex from the adjacent edge normals.
function miterVector(n0, n1, skip0, skip1) {
  if (skip0 && !skip1) return n1;
  if (skip1 && !skip0) return n0;
  let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
  const l = Math.hypot(mx, mz);
  if (l < 1e-6) return n1;
  mx /= l; mz /= l;
  const cosHalf = mx * n1[0] + mz * n1[1];
  const k = 1 / Math.max(cosHalf, 0.4); // miter length, limited
  return [mx * k, mz * k];
}

export function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Offset a ring outward (d > 0) with mitered corners. */
export function offsetRing(ring, d) {
  const sgn = signedArea(ring) > 0 ? 1 : -1;
  const N = ring.length, normals = [];
  for (let i = 0; i < N; i++) {
    const a = ring[i], b = ring[(i + 1) % N];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    normals.push([(dz / L) * sgn, (-dx / L) * sgn]);
  }
  return ring.map((p, i) => {
    const m = miterVector(normals[(i - 1 + N) % N], normals[i], false, false);
    return [p[0] + m[0] * d, p[1] + m[1] * d];
  });
}

/**
 * Split a ring into exterior pieces: every edge is cut into ~step metre pieces and a piece is kept when the point
 * just outside its midpoint is not inside any of `others` (rings of neighbouring footprints that share walls).
 * Returns [{ a:[x,z], b:[x,z], n:[nx,nz] }].
 */
export function exteriorSegments(ring, others, step = 1.5, probe = 0.6) {
  const sgn = signedArea(ring) > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    const nx = (dz / L) * sgn, nz = (-dx / L) * sgn;
    const pieces = Math.max(1, Math.round(L / step));
    let runStart = -1;
    const flush = (endIdx) => {
      if (runStart < 0) return;
      const t0 = runStart / pieces, t1 = endIdx / pieces;
      out.push({ a: [a[0] + dx * t0, a[1] + dz * t0], b: [a[0] + dx * t1, a[1] + dz * t1], n: [nx, nz], edge: i });
      runStart = -1;
    };
    for (let k = 0; k < pieces; k++) {
      const t = (k + 0.5) / pieces;
      const px = a[0] + dx * t + nx * probe, pz = a[1] + dz * t + nz * probe;
      const internal = others.some((o) => pointInRing(px, pz, o));
      if (!internal) { if (runStart < 0) runStart = k; } else flush(k);
    }
    flush(pieces);
  }
  return out;
}

/**
 * Loft a tube with a varying elliptical cross-section along a list of spine points (Vector3).
 * radii: [[rx, ry], ...] per spine point (rx sideways, ry vertical). Closed caps at both ends (small).
 * Returns a non-indexed BufferGeometry with smooth normals and uvs (u around, v along in metres).
 */
export function loftTube(points, radii, radial = 12) {
  const rings = [];
  const up = new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3(), side = new THREE.Vector3(), nup = new THREE.Vector3();
  let prevSide = null;
  let dist = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const pa = points[Math.max(0, i - 1)], pb = points[Math.min(points.length - 1, i + 1)];
    t.subVectors(pb, pa).normalize();
    side.crossVectors(t, up);
    if (side.lengthSq() < 1e-6) side.copy(prevSide || new THREE.Vector3(1, 0, 0));
    side.normalize();
    prevSide = side.clone();
    nup.crossVectors(side, t).normalize();
    if (i > 0) dist += p.distanceTo(points[i - 1]);
    const [rx, ry] = radii[i];
    const ring = [];
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const pos = new THREE.Vector3().copy(p).addScaledVector(side, ca * rx).addScaledVector(nup, sa * ry);
      // ellipse normal
      const nrm = new THREE.Vector3().addScaledVector(side, ca / Math.max(rx, 1e-3)).addScaledVector(nup, sa / Math.max(ry, 1e-3)).normalize();
      ring.push({ pos, nrm, u: (k / radial) * Math.PI * (rx + ry), v: dist });
    }
    rings.push(ring);
  }
  const P = [], N = [], U = [];
  const push = (r) => { P.push(r.pos.x, r.pos.y, r.pos.z); N.push(r.nrm.x, r.nrm.y, r.nrm.z); U.push(r.u, r.v); };
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = rings[i][k], b = rings[i][k + 1], c = rings[i + 1][k + 1], d = rings[i + 1][k];
      // winding so that normals face outward: (b-a)x(d-a) should align with a.nrm
      push(a); push(d); push(c);
      push(a); push(c); push(b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  // Verify winding on the first quad; flip if needed
  const pa = new THREE.Vector3(P[0], P[1], P[2]), pb = new THREE.Vector3(P[3], P[4], P[5]), pc = new THREE.Vector3(P[6], P[7], P[8]);
  const fn = new THREE.Vector3().crossVectors(pb.sub(pa), pc.sub(pa));
  if (fn.dot(new THREE.Vector3(N[0], N[1], N[2])) < 0) {
    const pos = g.attributes.position.array, uv = g.attributes.uv.array, nor = g.attributes.normal.array;
    for (let i = 0; i < pos.length; i += 9) {
      for (let k = 0; k < 3; k++) { const tmp = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = tmp; }
      for (let k = 0; k < 3; k++) { const tmp = nor[i + 3 + k]; nor[i + 3 + k] = nor[i + 6 + k]; nor[i + 6 + k] = tmp; }
      const j = (i / 9) * 6;
      for (let k = 0; k < 2; k++) { const tmp = uv[j + 2 + k]; uv[j + 2 + k] = uv[j + 4 + k]; uv[j + 4 + k] = tmp; }
    }
  }
  return g;
}

/** Catmull-Rom sample helper: returns n points along the curve through ctrl ([x,y,z] list). */
export function sampleCurve(ctrl, n) {
  const curve = new THREE.CatmullRomCurve3(ctrl.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  return curve.getPoints(n - 1);
}

/** Local frame helper: world = origin + u*axisU + w*axisW (axisW = axisU rotated +90° towards +z). */
export function makeFrame(origin, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return {
    origin, angle, c, s,
    rotationY: -angle,
    toWorld(u, w) { return [origin[0] + u * c - w * s, origin[1] + u * s + w * c]; },
    toLocal(x, z) { const dx = x - origin[0], dz = z - origin[1]; return [dx * c + dz * s, -dx * s + dz * c]; },
  };
}
