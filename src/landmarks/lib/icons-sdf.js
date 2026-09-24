// Tiny signed-distance-field toolkit + a naive Surface Nets mesher.
// Used by the "campus icons" landmarks to sculpt organic shapes procedurally (in idle time after loading —
// see deferRefine in icons-common.js): the Fence's blobby paint, the bronze Scotty dog and Borofsky's walkers.
//
// Convention: distance < 0 inside, > 0 outside. All functions take scalar coordinates
// (no Vector3 allocations) because they run millions of times while meshing.
import * as THREE from 'three';

// ------------------------------------------------------------------ combinators
// Polynomial smooth minimum (iq). k = blend radius in metres.
export function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}
export function smax(a, b, k) { return -smin(-a, -b, k); }

// ------------------------------------------------------------------ primitives
export function sdSphere(px, py, pz, cx, cy, cz, r) {
  const x = px - cx, y = py - cy, z = pz - cz;
  return Math.sqrt(x * x + y * y + z * z) - r;
}

// Axis-aligned box with rounded edges; h* are half extents of the whole shape (radius included).
export function sdRoundBox(px, py, pz, cx, cy, cz, hx, hy, hz, r) {
  const qx = Math.abs(px - cx) - hx + r, qy = Math.abs(py - cy) - hy + r, qz = Math.abs(pz - cz) - hz + r;
  const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
  const inner = Math.max(qx, qy, qz);
  return Math.sqrt(mx * mx + my * my + mz * mz) + (inner < 0 ? inner : 0) - r;
}

// Approximate ellipsoid distance (iq's bound), axis aligned in the given local coordinates.
export function sdEllipsoid(x, y, z, rx, ry, rz) {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = x / (rx * rx), by = y / (ry * ry), bz = z / (rz * rz);
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}

// Tapered capsule between points a and b with radii r1 (at a) and r2 (at b). (iq "round cone")
export function sdRoundCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-10) return sdSphere(px, py, pz, ax, ay, az, Math.max(r1, r2));
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

// ------------------------------------------------------------------ noise
// Cheap 3D value noise in [-1, 1] with smooth interpolation. Deterministic per seed.
export function makeNoise3(seed = 1) {
  const hash = (i, j, k) => {
    let h = (i * 374761393 + j * 668265263 + k * 1274126177 + seed * 1013904223) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h & 0xffff) / 32767.5 - 1;
  };
  return function noise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let fx = x - xi, fy = y - yi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const a = hash(xi, yi, zi), b = hash(xi + 1, yi, zi), c = hash(xi, yi + 1, zi), d = hash(xi + 1, yi + 1, zi);
    const e = hash(xi, yi, zi + 1), f = hash(xi + 1, yi, zi + 1), g = hash(xi, yi + 1, zi + 1), h = hash(xi + 1, yi + 1, zi + 1);
    const x1 = a + (b - a) * fx, x2 = c + (d - c) * fx, x3 = e + (f - e) * fx, x4 = g + (h - g) * fx;
    const y1 = x1 + (x2 - x1) * fy, y2 = x3 + (x4 - x3) * fy;
    return y1 + (y2 - y1) * fz;
  };
}

// ------------------------------------------------------------------ primitive lists
// A "prim list" is an array of simple shape records evaluated with a smooth union. Each record may carry
// a colour index `c` so the mesher can colour vertices by the nearest primitive.
//   { t:'cone', a:[x,y,z], b:[x,y,z], r1, r2, c }
//   { t:'sph',  p:[x,y,z], r, c }
//   { t:'ell',  p:[x,y,z], r:[rx,ry,rz], m?:[9] (world->local rotation, row major), c }
//   { t:'box',  p:[x,y,z], h:[hx,hy,hz], r, c }
//   { t:'sub',  ...one of the above..., k }   subtract (carve) with smooth radius k
export function evalPrim(p, x, y, z) {
  switch (p.t) {
    case 'cone': return sdRoundCone(x, y, z, p.a[0], p.a[1], p.a[2], p.b[0], p.b[1], p.b[2], p.r1, p.r2);
    case 'sph': return sdSphere(x, y, z, p.p[0], p.p[1], p.p[2], p.r);
    case 'box': return sdRoundBox(x, y, z, p.p[0], p.p[1], p.p[2], p.h[0], p.h[1], p.h[2], p.r || 0);
    case 'ell': {
      let lx = x - p.p[0], ly = y - p.p[1], lz = z - p.p[2];
      const m = p.m;
      if (m) {
        const tx = m[0] * lx + m[1] * ly + m[2] * lz;
        const ty = m[3] * lx + m[4] * ly + m[5] * lz;
        const tz = m[6] * lx + m[7] * ly + m[8] * lz;
        lx = tx; ly = ty; lz = tz;
      }
      return sdEllipsoid(lx, ly, lz, p.r[0], p.r[1], p.r[2]);
    }
    default: return 1e9;
  }
}

// Axis-aligned bounds of a primitive (for culling / grid sizing).
export function primBounds(p) {
  const r = (p.t === 'cone') ? Math.max(p.r1, p.r2) : p.t === 'sph' ? p.r : p.t === 'ell' ? Math.max(...p.r) : Math.max(...p.h);
  const pts = p.t === 'cone' ? [p.a, p.b] : [p.p];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const q of pts) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], q[i] - r); max[i] = Math.max(max[i], q[i] + r); }
  return { min, max };
}

// Rotation matrix (world -> local, row major 3x3) for an ellipsoid whose local Y axis points along `dir`
// and local Z axis roughly along `fwd`.
export function frameFromDir(dir, fwd = [0, 0, 1]) {
  const y = new THREE.Vector3(...dir).normalize();
  let z = new THREE.Vector3(...fwd);
  z.addScaledVector(y, -z.dot(y));
  if (z.lengthSq() < 1e-6) z.set(1, 0, 0).addScaledVector(y, -y.x);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  // rows are the local axes expressed in world coordinates -> multiplying gives local coords
  return [x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z];
}

// Build an evaluator {dist, nearest} for a prim list with smooth-union radius k.
export function primField(prims, k = 0.03) {
  const add = prims.filter((p) => !p.sub);
  const sub = prims.filter((p) => p.sub);
  const n = add.length;
  // flat AABB table for cheap lower-bound culling: a primitive whose box is farther than d + k
  // cannot change the smooth union, so it is skipped
  const box = new Float32Array(n * 7);
  for (let i = 0; i < n; i++) {
    const b = primBounds(add[i]);
    box.set([b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], add[i].k ?? k], i * 7);
  }
  const dist = (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < n; i++) {
      const o = i * 7, kk = box[o + 6];
      const ex = Math.max(box[o] - x, 0, x - box[o + 3]);
      const ey = Math.max(box[o + 1] - y, 0, y - box[o + 4]);
      const ez = Math.max(box[o + 2] - z, 0, z - box[o + 5]);
      const lb = ex * ex + ey * ey + ez * ez;
      const lim = d + kk;
      if (lim > 0 && lb > lim * lim) continue;
      d = smin(d, evalPrim(add[i], x, y, z), kk);
    }
    for (let i = 0; i < sub.length; i++) d = smax(d, -evalPrim(sub[i], x, y, z), sub[i].k ?? 0.01);
    return d;
  };
  // colour index of the closest additive primitive (ties -> later primitive wins, so details override)
  const nearest = (x, y, z) => {
    let best = Infinity, c = 0;
    for (let i = 0; i < n; i++) {
      const p = add[i];
      const o = i * 7;
      const ex = Math.max(box[o] - x, 0, x - box[o + 3]);
      const ey = Math.max(box[o + 1] - y, 0, y - box[o + 4]);
      const ez = Math.max(box[o + 2] - z, 0, z - box[o + 5]);
      const lim = best + (p.bias || 0) + 1e-4;
      if (lim > 0 && lim < 1e8 && ex * ex + ey * ey + ez * ez > lim * lim) continue;
      const di = evalPrim(p, x, y, z) - (p.bias || 0);
      if (di <= best + 1e-4) { best = di; c = p.c ?? 0; }
    }
    return c;
  };
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const p of add) {
    const b = primBounds(p);
    for (let i = 0; i < 3; i++) { bounds.min[i] = Math.min(bounds.min[i], b.min[i]); bounds.max[i] = Math.max(bounds.max[i], b.max[i]); }
  }
  return { dist, nearest, bounds };
}

// ------------------------------------------------------------------ Surface Nets mesher
/**
 * Polygonise an SDF on a regular grid (naive Surface Nets: one vertex per surface cell placed at the
 * average of its edge crossings; one quad per sign-changing grid edge). Produces smooth, watertight-ish
 * organic meshes with a nice even triangle distribution.
 *
 * opts: { min:[x,y,z], max:[x,y,z], voxel, normals='sdf'|'grid',
 *         color?: (x,y,z,nx,ny,nz,out[3]) => void  — per-vertex colour (linear 0..1) }
 * Returns a THREE.BufferGeometry (indexed) with position, normal (from the SDF gradient) and optional color.
 */
export function meshSDF(dist, opts) {
  return drain(meshSDFSteps(dist, opts));
}

// Run a step generator to completion and return its result.
export function drain(it) {
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

// Same as meshSDF, but as a generator that yields every few milliseconds of work so the caller can spread
// the sculpting over idle time (see deferRefine in icons-common.js). The final `return` value is the geometry.
// Samples are evaluated in a narrow band only: 4³ blocks whose centre is far from the surface are filled with
// that value, near blocks are split into 2³ sub-blocks that are tested again before sampling every node.
const EVALS_PER_STEP = 2500;
export function* meshSDFSteps(dist, opts) {
  const voxel = opts.voxel;
  const pad = voxel * 1.5;
  const x0 = opts.min[0] - pad, y0 = opts.min[1] - pad, z0 = opts.min[2] - pad;
  const nx = Math.ceil((opts.max[0] + pad - x0) / voxel) + 1;
  const ny = Math.ceil((opts.max[1] + pad - y0) / voxel) + 1;
  const nz = Math.ceil((opts.max[2] + pad - z0) / voxel) + 1;
  const sx = 1, sy = nx, sz = nx * ny;
  const N = nx * ny * nz;
  const F = new Float32Array(N);

  // ---- sample the field, skipping blocks that are provably far from the surface
  // (a node only needs its exact value when a neighbouring cell can straddle the surface; everywhere else the
  // sign is what matters, and the block centre's value has the right sign when |d| exceeds the block radius)
  const B = 4, H = 2;
  const band = voxel * (opts.normals === 'grid' ? 2.6 : 1.6);
  const margin = ((B - 1) * voxel * Math.sqrt(3)) / 2 + band;
  const marginH = ((H - 1) * voxel * Math.sqrt(3)) / 2 + band;
  let evals = 0;
  const fill = (i0, i1, j0, j1, k0, k1, v) => {
    for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) {
      let idx = i0 + j * sy + k * sz;
      for (let i = i0; i < i1; i++) F[idx++] = v;
    }
  };
  for (let bk = 0; bk < nz; bk += B) {
    const k1 = Math.min(bk + B, nz);
    for (let bj = 0; bj < ny; bj += B) {
      const j1 = Math.min(bj + B, ny);
      for (let bi = 0; bi < nx; bi += B) {
        const i1 = Math.min(bi + B, nx);
        const dc = dist(x0 + ((bi + i1 - 1) / 2) * voxel, y0 + ((bj + j1 - 1) / 2) * voxel, z0 + ((bk + k1 - 1) / 2) * voxel);
        evals++;
        if (Math.abs(dc) > margin) { fill(bi, i1, bj, j1, bk, k1, dc); continue; }
        // near block: 2x2x2 sub-blocks
        for (let hk = bk; hk < k1; hk += H) {
          const hk1 = Math.min(hk + H, k1);
          for (let hj = bj; hj < j1; hj += H) {
            const hj1 = Math.min(hj + H, j1);
            for (let hi = bi; hi < i1; hi += H) {
              const hi1 = Math.min(hi + H, i1);
              const dh = dist(x0 + ((hi + hi1 - 1) / 2) * voxel, y0 + ((hj + hj1 - 1) / 2) * voxel, z0 + ((hk + hk1 - 1) / 2) * voxel);
              evals++;
              if (Math.abs(dh) > marginH) { fill(hi, hi1, hj, hj1, hk, hk1, dh); continue; }
              for (let k = hk; k < hk1; k++) {
                const z = z0 + k * voxel;
                for (let j = hj; j < hj1; j++) {
                  const y = y0 + j * voxel;
                  let idx = hi + j * sy + k * sz;
                  for (let i = hi; i < hi1; i++) F[idx++] = dist(x0 + i * voxel, y, z);
                  evals += hi1 - hi;
                }
              }
            }
          }
        }
      }
      if (evals > EVALS_PER_STEP) { evals = 0; yield; }
    }
  }

  // ---- one vertex per cell that straddles the surface
  const cellVert = new Int32Array(N).fill(-1);
  const pos = [];
  const cornerOff = [0, sx, sy, sx + sy, sz, sx + sz, sy + sz, sx + sy + sz];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  const quads = [];
  let cells = 0;
  for (let k = 0; k < nz - 1; k++) {
    cells += nx * ny;
    if (cells > EVALS_PER_STEP * 20) { cells = 0; yield; }
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const idx = i + j * sy + k * sz;
        let mask = 0;
        for (let c = 0; c < 8; c++) { const v = F[idx + cornerOff[c]]; cv[c] = v; if (v < 0) mask |= 1 << c; }
        if (mask === 0 || mask === 255) continue;
        let ax = 0, ay = 0, az = 0, cnt = 0;
        for (let e = 0; e < 12; e++) {
          const a = EDGES[e][0], b = EDGES[e][1];
          const inA = (mask >> a) & 1, inB = (mask >> b) & 1;
          if (inA === inB) continue;
          const t = cv[a] / (cv[a] - cv[b]);
          ax += (a & 1) + ((b & 1) - (a & 1)) * t;
          ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          az += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          cnt++;
        }
        cellVert[idx] = pos.length / 3;
        pos.push(x0 + (i + ax / cnt) * voxel, y0 + (j + ay / cnt) * voxel, z0 + (k + az / cnt) * voxel);
        // quads for the three grid edges leaving this cell's min corner
        const inside0 = mask & 1;
        const coord = [i, j, k];
        const strides = [sx, sy, sz];
        for (let ax3 = 0; ax3 < 3; ax3++) {
          // corner 1 / 2 / 4 is the neighbour of corner 0 along +x / +y / +z
          const inside1 = (mask >> (1 << ax3)) & 1;
          if (inside0 === inside1) continue;
          const iu = (ax3 + 1) % 3, iv = (ax3 + 2) % 3;
          if (coord[iu] === 0 || coord[iv] === 0) continue;
          const du = strides[iu], dv = strides[iv];
          quads.push(idx, idx - du, idx - du - dv, idx - dv, inside0);
        }
      }
    }
  }

  yield;
  // ---- triangles
  const nv = pos.length / 3;
  const index = nv > 65535 ? new Uint32Array((quads.length / 5) * 6) : new Uint16Array((quads.length / 5) * 6);
  let t = 0;
  for (let q = 0; q < quads.length; q += 5) {
    const a = cellVert[quads[q]], b = cellVert[quads[q + 1]], c = cellVert[quads[q + 2]], d = cellVert[quads[q + 3]];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    // split along the shorter diagonal for nicer shading
    const dac = (pos[a * 3] - pos[c * 3]) ** 2 + (pos[a * 3 + 1] - pos[c * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[c * 3 + 2]) ** 2;
    const dbd = (pos[b * 3] - pos[d * 3]) ** 2 + (pos[b * 3 + 1] - pos[d * 3 + 1]) ** 2 + (pos[b * 3 + 2] - pos[d * 3 + 2]) ** 2;
    let tri;
    if (quads[q + 4]) tri = dac <= dbd ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
    else tri = dac <= dbd ? [a, c, b, a, d, c] : [a, d, b, b, d, c];
    for (let m = 0; m < 6; m++) index[t++] = tri[m];
  }

  const geo = new THREE.BufferGeometry();
  const P = new Float32Array(pos);
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setIndex(new THREE.BufferAttribute(t === index.length ? index : index.slice(0, t), 1));

  // ---- normals: either from the exact field gradient (keeps sub-voxel detail such as paint lumps, 6 extra
  // evaluations per vertex) or from central differences on the sampled grid, trilinearly blended (cheap, smooth)
  const Nrm = new Float32Array(nv * 3);
  if (opts.normals === 'grid') {
    const at = (i, j, k) => F[Math.min(nx - 1, Math.max(0, i)) + Math.min(ny - 1, Math.max(0, j)) * sy + Math.min(nz - 1, Math.max(0, k)) * sz];
    for (let v = 0; v < nv; v++) {
      if ((v & 16383) === 16383) yield;
      const fx = (P[v * 3] - x0) / voxel, fy = (P[v * 3 + 1] - y0) / voxel, fz = (P[v * 3 + 2] - z0) / voxel;
      const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
      const tx = fx - i0, ty = fy - j0, tz = fz - k0;
      let gx = 0, gy = 0, gz = 0;
      for (let c = 0; c < 8; c++) {
        const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
        const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
        const i = i0 + di, j = j0 + dj, k = k0 + dk;
        gx += w * (at(i + 1, j, k) - at(i - 1, j, k));
        gy += w * (at(i, j + 1, k) - at(i, j - 1, k));
        gz += w * (at(i, j, k + 1) - at(i, j, k - 1));
      }
      const l = Math.hypot(gx, gy, gz) || 1;
      Nrm[v * 3] = gx / l; Nrm[v * 3 + 1] = gy / l; Nrm[v * 3 + 2] = gz / l;
    }
  } else {
    // forward differences (4 evaluations per vertex instead of 6 for central differences)
    const e = voxel * 0.35;
    for (let v = 0; v < nv; v++) {
      if ((v & 511) === 511) yield;
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      const d0 = dist(x, y, z);
      const gx = dist(x + e, y, z) - d0;
      const gy = dist(x, y + e, z) - d0;
      const gz = dist(x, y, z + e) - d0;
      const l = Math.hypot(gx, gy, gz) || 1;
      Nrm[v * 3] = gx / l; Nrm[v * 3 + 1] = gy / l; Nrm[v * 3 + 2] = gz / l;
    }
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(Nrm, 3));

  if (opts.color) {
    const C = new Float32Array(nv * 3);
    const out = [0, 0, 0];
    for (let v = 0; v < nv; v++) {
      if ((v & 255) === 255) yield;
      opts.color(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], Nrm[v * 3], Nrm[v * 3 + 1], Nrm[v * 3 + 2], out);
      C[v * 3] = out[0]; C[v * 3 + 1] = out[1]; C[v * 3 + 2] = out[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
  }
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

// Mesh a prim list: colours come from `palette[prim.c]` (THREE.Color or hex), optional per-vertex tweak.
export function meshPrims(prims, opts = {}) {
  return drain(meshPrimsSteps(prims, opts));
}
export function* meshPrimsSteps(prims, { k = 0.03, voxel = 0.025, palette = ['#ffffff'], tweak = null, normals = 'grid' } = {}) {
  const field = primField(prims, k);
  const cols = palette.map((c) => (c instanceof THREE.Color ? c : new THREE.Color(c)));
  return yield* meshSDFSteps(field.dist, {
    min: field.bounds.min.map((v) => v - k),
    max: field.bounds.max.map((v) => v + k),
    voxel,
    normals,
    color: (x, y, z, nx, ny, nz, out) => {
      const c = cols[field.nearest(x, y, z)] || cols[0];
      out[0] = c.r; out[1] = c.g; out[2] = c.b;
      if (tweak) tweak(x, y, z, nx, ny, nz, out);
    },
  });
}

// Cheap stand-in for a prim list (distance LOD / placeholder until the sculpt is meshed): every primitive
// becomes a low-poly closed shape with its palette colour, all written into one vertex-coloured geometry.
// About 1k triangles and well under a millisecond per figure — meant to be seen from tens of metres away.
// `matrix` (optional) places the result; prims smaller than `minSize` are skipped.
const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pv = new THREE.Vector3(), _pd = new THREE.Vector3(), _ps = new THREE.Vector3();
const _pn = new THREE.Matrix3(), _Y = new THREE.Vector3(0, 1, 0);
let _templates = null;
function proxyTemplates() {
  if (_templates) return _templates;
  const t = (g) => ({ p: g.attributes.position.array, n: g.attributes.normal.array, i: g.index.array });
  _templates = {
    sphere: t(new THREE.SphereGeometry(1, 7, 5)),
    tube: t(new THREE.CylinderGeometry(1, 1, 1, 6, 1, false).translate(0, 0.5, 0)),
    box: t(new THREE.BoxGeometry(2, 2, 2)),
  };
  return _templates;
}
export function primProxyGeometry(prims, palette, { minSize = 0, matrix = null } = {}) {
  const T = proxyTemplates();
  const cols = palette.map((c) => (c instanceof THREE.Color ? c : new THREE.Color(c)));
  const P = [], N = [], C = [], I = [];
  const emit = (tpl, m, c) => {
    if (matrix) m.premultiply(matrix);
    _pn.getNormalMatrix(m);
    const e = m.elements, q = _pn.elements, base = P.length / 3;
    const tp = tpl.p, tn = tpl.n;
    for (let v = 0; v < tp.length; v += 3) {
      const x = tp[v], y = tp[v + 1], z = tp[v + 2];
      P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      const a = tn[v], b = tn[v + 1], d = tn[v + 2];
      let nx = q[0] * a + q[3] * b + q[6] * d, ny = q[1] * a + q[4] * b + q[7] * d, nz = q[2] * a + q[5] * b + q[8] * d;
      const l = Math.hypot(nx, ny, nz) || 1;
      N.push(nx / l, ny / l, nz / l);
      C.push(c.r, c.g, c.b);
    }
    for (const k of tpl.i) I.push(base + k);
  };
  for (const p of prims) {
    if (p.sub) continue;
    const c = cols[p.c ?? 0] || cols[0];
    if (p.t === 'sph') {
      if (p.r < minSize) continue;
      emit(T.sphere, _pm.compose(_pv.fromArray(p.p), _pq.identity(), _ps.setScalar(p.r)), c);
    } else if (p.t === 'ell') {
      if (Math.max(...p.r) < minSize) continue;
      // p.m is world->local (rows = local axes): its transpose rotates the unit sphere into place
      if (p.m) {
        const m = p.m;
        _pm.set(m[0] * p.r[0], m[3] * p.r[1], m[6] * p.r[2], p.p[0],
          m[1] * p.r[0], m[4] * p.r[1], m[7] * p.r[2], p.p[1],
          m[2] * p.r[0], m[5] * p.r[1], m[8] * p.r[2], p.p[2],
          0, 0, 0, 1);
      } else _pm.compose(_pv.fromArray(p.p), _pq.identity(), _ps.fromArray(p.r));
      emit(T.sphere, _pm, c);
    } else if (p.t === 'cone') {
      _pv.fromArray(p.a); _pd.fromArray(p.b).sub(_pv);
      const len = _pd.length(), r = (p.r1 + p.r2) / 2;
      if (Math.max(p.r1, p.r2) < minSize) continue;
      if (len < 1e-4) { emit(T.sphere, _pm.compose(_pv, _pq.identity(), _ps.setScalar(Math.max(p.r1, p.r2))), c); continue; }
      _pq.setFromUnitVectors(_Y, _pd.multiplyScalar(1 / len));
      emit(T.tube, _pm.compose(_pv, _pq, _ps.set(r, len, r)), c);
    } else if (p.t === 'box') {
      emit(T.box, _pm.compose(_pv.fromArray(p.p), _pq.identity(), _ps.fromArray(p.h)), c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  return g;
}
