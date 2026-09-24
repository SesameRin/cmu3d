// Procedural tree species + shared foliage/bark shader (owner: life agent).
//
// A species is built from (a) displaced icosphere "lobes" forming the crown volume, (b) alpha-tested leaf-cluster
// cards scattered over the crown surface for a leafy, broken silhouette, and (c) tapered cylinders for the trunk
// and branch skeleton (visible in winter). All parts are merged into ONE geometry per species and LOD, so each
// species costs one draw call per LOD.
//   per-vertex  aTree   = (ambient occlusion, kind 0 bark | 1 lobe | 2 leaf card, random; < 0 = solid hedge foliage)
//               aLeafUv = card UVs (0 elsewhere)
//   per-instance iLeaf  = foliage colour (season dependent), iParams = (seed, deciduous, barkTone, swayScale)
// The shader adds wind sway + leaf flutter, leafy noise, inter-lobe AO, winter "bare" mode (cards removed,
// lobes become a sparse twig haze so the branch skeleton shows) and some sun translucency.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, glslRad } from './graph.js';

// ------------------------------------------------------------------ JS 3D value noise (for displacement)
function h3(x, y, z) {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), fx), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), fx), fy),
    l(l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), fx), l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), fx), fy),
    fz,
  );
}

// ------------------------------------------------------------------ geometry primitives
function finish(g, tree, uv) {
  g.setAttribute('aTree', new THREE.BufferAttribute(tree, 3));
  g.setAttribute('aLeafUv', new THREE.BufferAttribute(uv || new Float32Array((tree.length / 3) * 2), 2));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

// Crown normal (ellipsoid gradient) at a point
function crownNormal(crown, x, y, z, out) {
  let kx = (x - crown.x) / (crown.rx * crown.rx), ky = (y - crown.y) / (crown.ry * crown.ry), kz = (z - crown.z) / (crown.rx * crown.rx);
  const kl = Math.hypot(kx, ky, kz) || 1;
  out[0] = kx / kl; out[1] = ky / kl; out[2] = kz / kl;
  return out;
}
// Crown AO: dark in the interior / underside, bright on the outer upper shell
function crownAO(crown, x, y, z) {
  const ex = (x - crown.x) / crown.rx, ey = (y - crown.y) / crown.ry, ez = (z - crown.z) / crown.rx;
  const r = Math.min(1.15, Math.hypot(ex, ey, ez));
  const hgt = Math.min(1, Math.max(0, (ey + 1) / 2));
  return Math.min(1, Math.max(0, Math.pow(r / 1.02, 1.8))) * (0.5 + 0.5 * hgt);
}

// Foliage lobe: displaced icosphere; normals bent toward the crown normal (soft volumetric shading);
// AO darkens the crown interior and the creases where lobes intersect.
function lobe(L, crown, seed, amp, all) {
  const g = new THREE.IcosahedronGeometry(1, L.detail);
  const pos = g.attributes.position;
  const n = pos.count;
  const nor = new Float32Array(n * 3), tree = new Float32Array(n * 3);
  const rnd = mulberry32(seed)();
  const cn = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i);
    const d = 1 + amp * ((noise3(ux * 1.7 + seed * 0.37, uy * 1.7, uz * 1.7) - 0.5) * 2 + (noise3(ux * 4.1, uy * 4.1 + seed, uz * 4.1) - 0.5) * 0.9);
    const x = L.x + ux * L.rx * d, y = L.y + uy * L.ry * d, z = L.z + uz * L.rz * d;
    pos.setXYZ(i, x, y, z);
    let lx = ux / L.rx, ly = uy / L.ry, lz = uz / L.rz;
    const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
    crownNormal(crown, x, y, z, cn);
    const w = crown.bend ?? 0.5;
    let nx = lx * (1 - w) + cn[0] * w, ny = ly * (1 - w) + cn[1] * w + 0.1, nz = lz * (1 - w) + cn[2] * w;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nor[i * 3] = nx / nl; nor[i * 3 + 1] = ny / nl; nor[i * 3 + 2] = nz / nl;
    let ao = crownAO(crown, x, y, z);
    // creases: vertices close to / inside neighbouring lobes are occluded
    let occ = 0;
    for (const o of all) {
      if (o === L) continue;
      const q = Math.hypot((x - o.x) / o.rx, (y - o.y) / o.ry, (z - o.z) / o.rz);
      if (q < 1.25) occ += (1.25 - q) * 1.6;
    }
    ao *= 1 - Math.min(0.65, occ);
    tree[i * 3] = Math.min(1, ao * 1.08 + 0.05); tree[i * 3 + 1] = 1; tree[i * 3 + 2] = rnd;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return finish(g, tree);
}

// Leaf-cluster cards scattered on the lobe surfaces (alpha tested in the shader). Normals = crown normal.
function leafCards(lobes, crown, count, size, seed) {
  const rng = mulberry32(seed * 31 + 7);
  const pos = new Float32Array(count * 18), nor = new Float32Array(count * 18), tree = new Float32Array(count * 18), uv = new Float32Array(count * 12);
  const wsum = lobes.reduce((s, l) => s + l.rx * l.rz, 0);
  const cn = [0, 0, 0];
  const corners = [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0], [0.5, 0.5, 1, 1], [-0.5, -0.5, 0, 0], [0.5, 0.5, 1, 1], [-0.5, 0.5, 0, 1]];
  for (let c = 0; c < count; c++) {
    // pick a lobe weighted by its horizontal area
    let r = rng() * wsum, L = lobes[0];
    for (const l of lobes) { r -= l.rx * l.rz; if (r <= 0) { L = l; break; } }
    // direction biased upward/outward
    let dx = rng() * 2 - 1, dy = rng() * 1.6 - 0.45, dz = rng() * 2 - 1;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const k = 0.78 + rng() * 0.42;
    const px = L.x + dx * L.rx * k, py = L.y + dy * L.ry * k, pz = L.z + dz * L.rz * k;
    crownNormal(crown, px, py, pz, cn);
    // skip cards buried deep inside the crown
    if (crownAO(crown, px, py, pz) < 0.22) { c--; if (rng() < 0.01) break; continue; }
    // card plane basis: normal = mix(random, radial) so cards face various directions
    let nx = dx * 0.6 + (rng() - 0.5) * 2, ny = dy * 0.6 + (rng() - 0.5) * 2, nz = dz * 0.6 + (rng() - 0.5) * 2;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    // tangent: any vector perpendicular to n, rotated randomly
    let tx = -nz, ty = 0, tz = nx;
    if (Math.abs(ny) > 0.95) { tx = 1; ty = 0; tz = 0; }
    let tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const a = rng() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const ux = tx * ca + bx * sa, uy = ty * ca + by * sa, uz = tz * ca + bz * sa;
    const vx = -tx * sa + bx * ca, vy = -ty * sa + by * ca, vz = -tz * sa + bz * ca;
    const s = size * (0.75 + rng() * 0.5);
    const ao = Math.min(1, crownAO(crown, px, py, pz) * 1.1 + 0.1);
    const rr = rng();
    for (let v = 0; v < 6; v++) {
      const [cu, cv, tu, tv] = corners[v];
      const o = (c * 6 + v) * 3;
      pos[o] = px + (ux * cu + vx * cv) * s; pos[o + 1] = py + (uy * cu + vy * cv) * s; pos[o + 2] = pz + (uz * cu + vz * cv) * s;
      nor[o] = cn[0]; nor[o + 1] = cn[1]; nor[o + 2] = cn[2];
      tree[o] = ao; tree[o + 1] = 2; tree[o + 2] = rr;
      uv[(c * 6 + v) * 2] = tu; uv[(c * 6 + v) * 2 + 1] = tv;
    }
  }
  // back faces: same vertices with reversed winding and the SAME (crown) normal, so the material can stay
  // single-sided (lobes/bark get back-face culling) while cards look identical from both sides
  const dup = (a, n) => {
    const out = new Float32Array(a.length * 2);
    out.set(a);
    for (let t = 0; t < a.length / (3 * n); t++) {
      for (const [dst, src] of [[0, 0], [1, 2], [2, 1]]) for (let q = 0; q < n; q++) out[a.length + (t * 3 + dst) * n + q] = a[(t * 3 + src) * n + q];
    }
    return out;
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(dup(pos, 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(dup(nor, 3), 3));
  return finish(g, dup(tree, 3), dup(uv, 2));
}

const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
// Tapered limb between two points (bark).
function limb(x0, y0, z0, x1, y1, z1, r0, r1, segs = 6, ao0 = 0.55, ao1 = 0.9) {
  _dir.set(x1 - x0, y1 - y0, z1 - z0);
  const len = _dir.length();
  _dir.normalize();
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, true).toNonIndexed();
  _q.setFromUnitVectors(_up, _dir);
  _m.compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q, new THREE.Vector3(1, 1, 1));
  const pos = g.attributes.position;
  const n = pos.count;
  const tree = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = pos.getY(i) / len + 0.5;
    tree[i * 3] = ao0 + (ao1 - ao0) * t; tree[i * 3 + 1] = 0; tree[i * 3 + 2] = 0;
  }
  g.applyMatrix4(_m);
  return finish(g, tree);
}

// Conifer tier: open cone with a jagged, drooping hem; normals bent outward/up.
function coneTier(cy, radius, height, segs, seed, aoBase = 0.5) {
  const g = new THREE.ConeGeometry(radius, height, segs, 3, true).toNonIndexed();
  const pos = g.attributes.position;
  const n = pos.count;
  const nor = new Float32Array(n * 3), tree = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const rr = Math.hypot(x, z);
    const t = (y + height / 2) / height; // 0 bottom → 1 tip
    const jag = (0.5 + 0.5 * Math.sin(a * segs * 0.5 + seed)) * (1 - t);
    const nz = noise3(x * 1.3 + seed, y * 1.3, z * 1.3) - 0.5;
    const s = 1 + nz * 0.3 + jag * 0.14;
    x *= s; z *= s;
    y = y - jag * height * 0.2 + cy - (1 - t) * (1 - t) * height * 0.12;
    pos.setXYZ(i, x, y, z);
    const nx = Math.cos(a), ny = 0.8, nzn = Math.sin(a);
    const l = Math.hypot(nx, ny, nzn);
    nor[i * 3] = nx / l; nor[i * 3 + 1] = ny / l; nor[i * 3 + 2] = nzn / l;
    tree[i * 3] = Math.min(1, aoBase + (1 - aoBase) * Math.pow(rr / Math.max(radius, 0.01), 1.5) * 0.85 + t * 0.15);
    tree[i * 3 + 1] = 1; tree[i * 3 + 2] = (seed * 0.137) % 1;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return finish(g, tree);
}

function merge(parts) {
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// Evenly spread directions on a sphere (Fibonacci) between y = 1 and y = yMin.
function fibDirs(count, rng, yMin = -0.5) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  const off = rng() * 6.28;
  for (let i = 0; i < count; i++) {
    const y = 1 - ((i + 0.5) / count) * (1 - yMin);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * ga + off;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}

// Deciduous skeleton: trunk + primary + secondary branches reaching into the crown.
function skeleton(parts, rng, { trunkTop, trunkR, crown, primaries = 5, secondaries = 2, segs = 6, fork = false, lean = 0.08 }) {
  const lx = (rng() - 0.5) * lean, lz = (rng() - 0.5) * lean;
  const tx = lx * trunkTop, tz = lz * trunkTop;
  if (fork) {
    parts.push(limb(0, -0.8, 0, tx * 0.3, trunkTop * 0.45, tz * 0.3, trunkR, trunkR * 0.85, segs, 0.45, 0.65));
  } else {
    parts.push(limb(0, -0.8, 0, tx, trunkTop, tz, trunkR * 1.08, trunkR * 0.66, segs, 0.4, 0.7));
    parts.push(limb(tx, trunkTop, tz, tx * 1.3, crown.y + crown.ry * 0.4, tz * 1.3, trunkR * 0.66, trunkR * 0.2, segs - 1, 0.6, 0.8));
  }
  for (let i = 0; i < primaries; i++) {
    const a = (i / primaries + rng() * 0.15) * Math.PI * 2;
    const by = fork ? trunkTop * (0.4 + rng() * 0.2) : trunkTop + (rng() - 0.25) * (crown.y - trunkTop) * 0.6;
    const bx = fork ? tx * 0.3 : tx * (by / trunkTop), bz = fork ? tz * 0.3 : tz * (by / trunkTop);
    const reach = 0.7 + rng() * 0.22;
    const ex = crown.x + Math.cos(a) * crown.rx * reach, ez = crown.z + Math.sin(a) * crown.rx * reach;
    const ey = crown.y + (rng() * 0.8 - 0.15) * crown.ry;
    const r0 = trunkR * (fork ? 0.55 : 0.45);
    parts.push(limb(bx, by, bz, ex, ey, ez, r0, r0 * 0.25, Math.max(4, segs - 2), 0.5, 0.85));
    for (let k = 0; k < secondaries; k++) {
      const t = 0.4 + rng() * 0.4;
      const sx = bx + (ex - bx) * t, sy = by + (ey - by) * t, sz = bz + (ez - bz) * t;
      const a2 = a + (rng() - 0.5) * 1.8;
      const L = crown.rx * (0.22 + rng() * 0.2);
      const ex2 = sx + Math.cos(a2) * L, ey2 = sy + L * (0.35 + rng() * 0.6), ez2 = sz + Math.sin(a2) * L;
      parts.push(limb(sx, sy, sz, ex2, ey2, ez2, r0 * 0.45, r0 * 0.1, 3, 0.6, 0.9));
      // tertiary twigs (mostly visible in winter)
      for (let m = 0; m < 2; m++) {
        const u = 0.5 + rng() * 0.4;
        const qx = sx + (ex2 - sx) * u, qy = sy + (ey2 - sy) * u, qz = sz + (ez2 - sz) * u;
        const a3 = a2 + (rng() - 0.5) * 2.2, L3 = L * (0.35 + rng() * 0.3);
        parts.push(limb(qx, qy, qz, qx + Math.cos(a3) * L3, qy + L3 * (0.4 + rng() * 0.6), qz + Math.sin(a3) * L3, r0 * 0.14, r0 * 0.04, 3, 0.7, 0.95));
      }
    }
  }
}

// Build crown lobes (+ cards) from a lobe list. With cards, the lobes are shrunk well inside the card shell so
// they read as the dark crown interior, never as smooth "balloons" poking through the leaves.
function crown(parts, lobes, cr, seed, { amp = 0.24, cards = 0, cardSize = 1.5, inner = 0.71 } = {}) {
  const inn = cards ? lobes.map((l) => ({ ...l, rx: l.rx * inner, ry: l.ry * inner, rz: l.rz * inner, detail: Math.min(l.detail, 1) })) : lobes;
  inn.forEach((L, i) => parts.push(lobe(L, cr, seed + i * 13, amp, inn)));
  if (cards) parts.push(leafCards(lobes, cr, cards, cardSize, seed));
}
const L = (x, y, z, rx, ry, rz, detail) => ({ x, y, z, rx, ry, rz, detail });

// ------------------------------------------------------------------ species
// Each builder returns { near, far } geometries in local space (trunk base at origin, +Y up, metres).
const BUILDERS = {
  // Generic rounded broadleaf (linden, elm, honey locust, London plane). ~11 m, crown base ~2.8 m.
  broadleaf(seed) {
    const rng = mulberry32(seed);
    const cr = { x: 0, y: 6.9, z: 0, rx: 4.4, ry: 3.9 };
    const near = [];
    skeleton(near, rng, { trunkTop: 3.0, trunkR: 0.28, crown: cr, primaries: 5, secondaries: 2 });
    const lobes = [L(0, cr.y + 0.2, 0, 2.9, 2.6, 2.9, 2)];
    fibDirs(9, rng, -0.5).forEach((d) => {
      const r = 1.6 + rng() * 0.7;
      lobes.push(L(d[0] * cr.rx * 0.6, cr.y + d[1] * cr.ry * 0.55, d[2] * cr.rx * 0.6, r, r * 0.88, r, r > 1.9 ? 2 : 1));
    });
    crown(near, lobes, cr, seed, { cards: 200, cardSize: 2.2 });
    const far = [limb(0, -0.8, 0, 0, cr.y - 1, 0, 0.3, 0.14, 5, 0.4, 0.7)];
    const fl = [L(0, cr.y + 0.3, 0, 3.4, 3.0, 3.4, 1), L(1.6, cr.y - 0.5, 0.8, 2.5, 2.1, 2.5, 0), L(-1.3, cr.y - 0.3, -1.2, 2.5, 2.1, 2.5, 0), L(-0.4, cr.y - 0.9, 1.7, 2.3, 1.9, 2.3, 0)];
    crown(far, fl, cr, seed + 5, { amp: 0.18 });
    return { near: merge(near), far: merge(far), crown: cr };
  },
  // Tall oak / maple: broad irregular crown, ~17 m.
  oak(seed) {
    const rng = mulberry32(seed);
    const cr = { x: 0.3, y: 11.2, z: -0.2, rx: 6.4, ry: 5.6 };
    const near = [];
    skeleton(near, rng, { trunkTop: 5.2, trunkR: 0.45, crown: cr, primaries: 6, secondaries: 2, segs: 7 });
    const lobes = [L(cr.x, cr.y, cr.z, 3.9, 3.3, 3.9, 2)];
    fibDirs(12, rng, -0.4).forEach((d) => {
      const r = 2.0 + rng() * 1.0;
      const s = 0.55 + rng() * 0.2;
      lobes.push(L(cr.x + d[0] * cr.rx * s, cr.y + d[1] * cr.ry * 0.55 + (rng() - 0.5), cr.z + d[2] * cr.rx * s, r, r * 0.82, r, r > 2.3 ? 2 : 1));
    });
    crown(near, lobes, cr, seed, { cards: 270, cardSize: 2.85 });
    const far = [limb(0, -0.8, 0, 0, cr.y - 2, 0, 0.45, 0.2, 5, 0.4, 0.7)];
    const fl = [L(cr.x, cr.y + 0.4, cr.z, 4.8, 3.9, 4.8, 1), L(cr.x + 2.8, cr.y - 0.8, cr.z + 1.5, 3.3, 2.7, 3.3, 0), L(cr.x - 2.4, cr.y - 0.5, cr.z - 2.0, 3.4, 2.8, 3.4, 0), L(cr.x - 0.6, cr.y - 1.2, cr.z + 2.9, 3.0, 2.4, 3.0, 0)];
    crown(far, fl, cr, seed + 5, { amp: 0.2 });
    return { near: merge(near), far: merge(far), crown: cr };
  },
  // Columnar / fastigiate (columnar oak, hornbeam 'Fastigiata', ginkgo). ~13 m.
  columnar(seed) {
    const rng = mulberry32(seed);
    const cr = { x: 0, y: 7.2, z: 0, rx: 2.1, ry: 5.8, bend: 0.6 };
    const near = [limb(0, -0.8, 0, 0, 11.5, 0, 0.24, 0.06, 6, 0.4, 0.8)];
    // steep upward branches (fastigiate habit) — visible in winter
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4 + rng(), y0 = 2.4 + i * 0.85, out = 1.1 + rng() * 0.6;
      near.push(limb(0, y0, 0, Math.cos(a) * out, y0 + 2.6 + rng() * 1.5, Math.sin(a) * out, 0.08, 0.02, 3, 0.55, 0.85));
    }
    const lobes = [];
    for (let i = 0; i < 5; i++) {
      const y = 3.3 + i * 1.95 + rng() * 0.3;
      const r = 1.75 - Math.abs(i - 1.8) * 0.18 + rng() * 0.15;
      lobes.push(L((rng() - 0.5) * 0.5, y, (rng() - 0.5) * 0.5, r, r * 1.5, r, 2));
    }
    crown(near, lobes, cr, seed, { cards: 130, cardSize: 1.6, amp: 0.2 });
    const far = [limb(0, -0.8, 0, 0, 3, 0, 0.24, 0.15, 5, 0.4, 0.7)];
    crown(far, [L(0, 7.3, 0, 1.9, 5.4, 1.9, 1)], cr, seed + 9, { amp: 0.15 });
    return { near: merge(near), far: merge(far), crown: cr };
  },
  // Norway / blue spruce: layered cone tiers, ~15 m.
  spruce(seed) {
    const near = [limb(0, -0.8, 0, 0, 14.5, 0, 0.3, 0.05, 6, 0.35, 0.7)];
    const tiers = 8;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const r = 3.4 * (1 - t) + 0.45;
      const h = 3.2 - t * 1.2;
      near.push(coneTier(1.7 + i * 1.62 + h / 2, r, h, 14, seed + i * 7.3, 0.3));
    }
    const far = [limb(0, -0.8, 0, 0, 2, 0, 0.3, 0.2, 4, 0.35, 0.6), coneTier(5.0, 3.5, 7.4, 8, seed, 0.35), coneTier(10.5, 2.2, 6.0, 8, seed + 3, 0.45)];
    return { near: merge(near), far: merge(far), crown: { x: 0, y: 8, z: 0, rx: 3.4, ry: 7 } };
  },
  // Eastern white pine: tall trunk, irregular flat tufts, ~17 m.
  pine(seed) {
    const rng = mulberry32(seed);
    const cr = { x: 0, y: 12.3, z: 0, rx: 4.3, ry: 4.4, bend: 0.4 };
    const near = [limb(0, -0.8, 0, 0.2, 16.5, -0.1, 0.36, 0.08, 7, 0.35, 0.75)];
    const lobes = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const y = 8.2 + i * 1.1 + rng() * 0.6;
      const a = rng() * 6.28;
      const reach = (i < n - 2 ? 2.2 + rng() * 1.7 : 0.6) * (1 - i / (n * 1.6));
      const x = Math.cos(a) * reach, z = Math.sin(a) * reach;
      near.push(limb(0.1, y - 0.6, 0, x, y, z, 0.12, 0.05, 4, 0.5, 0.75));
      const r = 1.7 + rng() * 0.8 - i * 0.07;
      lobes.push(L(x, y + 0.3, z, r, r * 0.5, r * 0.9, 1));
    }
    crown(near, lobes, cr, seed, { cards: 110, cardSize: 1.9, amp: 0.3, inner: 0.76 });
    const far = [limb(0, -0.8, 0, 0, 13, 0, 0.36, 0.15, 4, 0.35, 0.6)];
    crown(far, [L(0.3, 12.8, 0, 3.6, 2.4, 3.3, 1), L(-0.6, 10.2, 0.4, 2.8, 1.6, 2.6, 1)], cr, seed + 17, { amp: 0.3 });
    return { near: merge(near), far: merge(far), crown: cr };
  },
  // Small ornamental (cherry, dogwood, crabapple, redbud): low wide crown, forked, ~5.5 m.
  ornamental(seed) {
    const rng = mulberry32(seed);
    const cr = { x: 0, y: 3.8, z: 0, rx: 3.0, ry: 1.95 };
    const near = [];
    skeleton(near, rng, { trunkTop: 1.5, trunkR: 0.15, crown: cr, primaries: 4, secondaries: 2, segs: 5, fork: true, lean: 0.2 });
    const lobes = [L(0, cr.y, 0, 2.0, 1.35, 2.0, 2)];
    fibDirs(7, rng, -0.25).forEach((d) => {
      const r = 1.1 + rng() * 0.4;
      lobes.push(L(d[0] * cr.rx * 0.58, cr.y + d[1] * cr.ry * 0.45, d[2] * cr.rx * 0.58, r, r * 0.75, r, 1));
    });
    crown(near, lobes, cr, seed, { cards: 130, cardSize: 1.5 });
    const far = [limb(0, -0.8, 0, 0, 2.6, 0, 0.16, 0.1, 4, 0.45, 0.7)];
    crown(far, [L(0, cr.y, 0, 2.8, 1.75, 2.8, 1)], cr, seed + 3, { amp: 0.2 });
    return { near: merge(near), far: merge(far), crown: cr };
  },
  // Shrub / bush (yew, boxwood, viburnum…): ~1.5 m.
  shrub(seed) {
    const rng = mulberry32(seed);
    const cr = { x: 0, y: 0.65, z: 0, rx: 1.15, ry: 0.85, bend: 0.65 };
    const near = [];
    const lobes = [L(0, 0.7, 0, 0.95, 0.78, 0.95, 1)];
    for (let i = 0; i < 4; i++) {
      const a = i * 1.57 + rng() * 0.8;
      const r = 0.55 + rng() * 0.25;
      lobes.push(L(Math.cos(a) * 0.55, 0.45 + rng() * 0.25, Math.sin(a) * 0.55, r, r * 0.85, r, 1));
    }
    crown(near, lobes, cr, seed, { cards: 34, cardSize: 0.85, amp: 0.25, inner: 0.78 });
    const far = [];
    crown(far, [L(0, 0.6, 0, 1.15, 0.8, 1.15, 0)], cr, seed + 7, { amp: 0.15 });
    return { near: merge(near), far: merge(far), crown: cr };
  },
};

export const SPECIES = ['broadleaf', 'oak', 'columnar', 'spruce', 'pine', 'ornamental', 'shrub'];
export const EVERGREEN = { spruce: true, pine: true };

// Very-far LOD (beyond ~520 m, where a crown covers ~20 px): 1–2 coarse lobes (20 tris each) + a 3-sided trunk,
// ~46 triangles instead of ~150. Lobes as [x, y, z, rx, ry, rz]; trunk as [top, r0, r1].
const VFAR = {
  broadleaf: { lobes: [[0, 7.0, 0, 3.8, 3.3, 3.8], [1.2, 6.1, 0.6, 2.6, 2.0, 2.6]], trunk: [4.5, 0.3, 0.16] },
  oak: { lobes: [[0.3, 11.4, -0.2, 5.4, 4.3, 5.4], [2.1, 10.1, 1.0, 3.6, 2.7, 3.6]], trunk: [8, 0.45, 0.22] },
  columnar: { lobes: [[0, 7.3, 0, 2.0, 5.5, 2.0]], trunk: [3, 0.24, 0.15] },
  pine: { lobes: [[0.3, 12.8, 0, 3.6, 2.4, 3.3], [-0.6, 10.2, 0.4, 2.8, 1.6, 2.6]], trunk: [12, 0.36, 0.15] },
  ornamental: { lobes: [[0, 3.8, 0, 2.9, 1.8, 2.9]], trunk: [2.4, 0.16, 0.1] },
};
function buildVeryFar(key, cr, seed) {
  const def = VFAR[key];
  const parts = [limb(0, -0.8, 0, 0, def.trunk[0], 0, def.trunk[1], def.trunk[2], 3, 0.4, 0.7)];
  crown(parts, def.lobes.map(([x, y, z, rx, ry, rz]) => L(x, y, z, rx, ry, rz, 0)), cr, seed + 29, { amp: 0.16 });
  return merge(parts);
}

// Returns { near, far, vfar, crown } geometries in local space.
export function buildSpeciesGeometry(key, seed = 11) {
  const g = BUILDERS[key](seed);
  g.vfar = VFAR[key] ? buildVeryFar(key, g.crown, seed) : g.far.clone();
  return g;
}

// ------------------------------------------------------------------ leaf cluster texture (canvas)
let leafTex = null;
export function getLeafTexture() {
  if (leafTex) return leafTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rng = mulberry32(99);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 110; i++) {
    const r = Math.pow(rng(), 0.6) * S * 0.44;
    const a = rng() * Math.PI * 2;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    const v = Math.round(165 + rng() * 90 - (r / S) * 60);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.save();
    g.translate(x, y);
    g.rotate(rng() * Math.PI * 2);
    g.beginPath();
    g.ellipse(0, 0, 7 + rng() * 5, 3.2 + rng() * 1.8, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  leafTex = new THREE.CanvasTexture(c);
  leafTex.colorSpace = THREE.NoColorSpace;
  leafTex.generateMipmaps = true;
  leafTex.minFilter = THREE.LinearMipmapLinearFilter;
  leafTex.anisotropy = 4;
  return leafTex;
}

// ------------------------------------------------------------------ seasonal foliage colours
const C = (hex) => new THREE.Color(hex);
const SUMMER = {
  broadleaf: [C('#4a7431'), C('#577f35'), C('#41692c')],
  oak: [C('#3d6429'), C('#486f2f'), C('#517834')],
  columnar: [C('#4f7530'), C('#466c2f')],
  spruce: [C('#29432b'), C('#2f4a34'), C('#36503d')],
  pine: [C('#34512f'), C('#3c5a36')],
  ornamental: [C('#557f35'), C('#62883d')],
  shrub: [C('#3b6229'), C('#4a7231'), C('#33542a')],
};
const AUTUMN_ACCENT = [C('#c9a02a'), C('#d8b03c'), C('#c7772a'), C('#b8561f'), C('#9e3421'), C('#86281f')];
const YELLOWED = C('#8f8b2e');
const TWIG = C('#574c44');
const SPRING_GREEN = [C('#79a845'), C('#88b64c'), C('#6c9c3c')];
const BLOSSOM = [C('#f2bccb'), C('#f6d6df'), C('#faf2f0'), C('#e699b2')];
const _c = new THREE.Color();

// Writes the foliage colour for one tree into out[o..o+2]. rnd, rnd2 ∈ [0,1) are per-tree randoms.
export function seasonColor(species, season, rnd, rnd2, out, o, evergreenShrub = false) {
  const base = SUMMER[species] || SUMMER.broadleaf;
  _c.copy(base[Math.floor(rnd * 997) % base.length]);
  const evergreen = EVERGREEN[species] || evergreenShrub;
  if (season === 'autumn' && !evergreen) {
    // early fall: most trees still green (a little yellowed); ~1 in 5 shows yellow / orange / red
    const turnP = species === 'ornamental' ? 0.3 : species === 'oak' ? 0.12 : species === 'shrub' ? 0.08 : 0.1;
    if (rnd2 < turnP) {
      let pick;
      if (species === 'ornamental') pick = AUTUMN_ACCENT[3 + (Math.floor(rnd * 997) % 3)];
      else if (species === 'oak') pick = AUTUMN_ACCENT[2 + (Math.floor(rnd * 997) % 4)];
      else pick = AUTUMN_ACCENT[[0, 1, 0, 1, 2, 3, 4][Math.floor(rnd * 997) % 7]]; // mostly yellows early in the season
      _c.lerp(pick, 0.45 + (rnd2 / turnP) * 0.55);
    } else {
      _c.lerp(YELLOWED, 0.05 + rnd2 * 0.2);
    }
  } else if (season === 'winter' && !evergreen) {
    _c.copy(TWIG).multiplyScalar(0.85 + rnd * 0.3);
  } else if (season === 'winter' && evergreen) {
    _c.multiplyScalar(0.8);
  } else if (season === 'spring' && !evergreen) {
    if (species === 'ornamental') _c.copy(BLOSSOM[Math.floor(rnd * 997) % BLOSSOM.length]);
    else _c.copy(SPRING_GREEN[Math.floor(rnd * 997) % SPRING_GREEN.length]).lerp(base[0], rnd2 * 0.4);
  }
  const j = 0.9 + rnd2 * 0.2;
  out[o] = _c.r * j; out[o + 1] = _c.g * j; out[o + 2] = _c.b * j;
}

// ------------------------------------------------------------------ material
const GLSL_NOISE = /* glsl */`
float tHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float tNoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(tHash(i), tHash(i + vec3(1,0,0)), f.x), mix(tHash(i + vec3(0,1,0)), tHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(tHash(i + vec3(0,0,1)), tHash(i + vec3(1,0,1)), f.x), mix(tHash(i + vec3(0,1,1)), tHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

// uTime wraps every ANIM_PERIOD seconds (graph.js animTime); the angular frequencies are rounded (glslRad) to a
// whole number of cycles per period so the wrap is seamless.
const WIND_VERTEX = /* glsl */`
  vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float ph = iParams.x * 6.2831 + dot(iPos.xz, vec2(0.043, 0.031));
  float hN = max(position.y, 0.0);
  float bend = uWind * hN * hN * 0.0011 * abs(iParams.w);
  float s1 = sin(uTime * ${glslRad(0.85)} + ph), s2 = sin(uTime * ${glslRad(2.05)} + ph * 1.3);
  transformed.x += (s1 * 0.7 + s2 * 0.3) * bend;
  transformed.z += cos(uTime * ${glslRad(0.63)} + ph * 0.7) * 0.5 * bend;
  float fl = step(0.5, aTree.y) * uWind * (0.035 + 0.04 * step(1.5, aTree.y));
  transformed += fl * vec3(sin(uTime * ${glslRad(5.1)} + position.y * 2.1 + ph), sin(uTime * ${glslRad(4.3)} + position.x * 1.7) * 0.5, sin(uTime * ${glslRad(4.7)} + position.z * 1.9));
`;

// Alpha for leaf cards with mip-level compensation (keeps distant cards from thinning out).
const CARD_ALPHA = /* glsl */`
  float cardAlpha(vec2 uv) {
    vec2 du = dFdx(uv * 128.0), dv = dFdy(uv * 128.0);
    float lod = max(0.0, 0.5 * log2(max(dot(du, du), dot(dv, dv))));
    return texture2D(uLeafTex, uv).a * (1.0 + lod * 0.35);
  }
`;

export function createTreeShared() {
  return {
    uTime: { value: 0 },
    uWind: { value: 0.6 },
    uBare: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
    uLeafTex: { value: getLeafTexture() },
    // 1 when the scene is drawn into a multisampled buffer (alpha-to-coverage works), 0 → plain alpha test
    uA2C: { value: 1 },
  };
}

// near = full detail (leaf cards, twig haze); far = cheaper variant (ragged blob crowns, translucent winter haze).
// Cut-outs use alpha-to-coverage on the MSAA target (anti-aliased leaf edges, smooth partial coverage instead of a
// dither checkerboard); without MSAA they fall back to an alpha test. iParams.w < 0 marks a shadow-only instance:
// it is collapsed in the colour pass (the depth material still draws it).
export function createTreeMaterial(shared, { near = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0, envMapIntensity: 0.5 });
  mat.name = near ? 'treeNear' : 'treeFar';
  mat.alphaToCoverage = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aTree; attribute vec2 aLeafUv; attribute vec3 iLeaf; attribute vec4 iParams;
        uniform float uTime; uniform float uWind;
        varying vec3 vTree; varying vec3 vLeaf; varying vec3 vWPos; varying vec2 vIP; varying vec2 vLeafUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${WIND_VERTEX}
        vTree = aTree; vLeaf = iLeaf; vIP = iParams.yz; vLeafUv = aLeafUv;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        if (iParams.w < 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uBare; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform sampler2D uLeafTex; uniform float uA2C;
        varying vec3 vTree; varying vec3 vLeaf; varying vec3 vWPos; varying vec2 vIP; varying vec2 vLeafUv;
        ${GLSL_NOISE}
        ${CARD_ALPHA}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float kind = vTree.y;
        float isLeaf = step(0.5, kind);
        float isLobe = isLeaf * (1.0 - step(1.5, kind));
        float bare = uBare * vIP.x;
        float cardMod = 1.0;
        float cover = 1.0;
        if (kind > 1.5) {
          if (bare > 0.5) discard;
          float ca = cardAlpha(vLeafUv);
          cover = clamp((ca - 0.5) / max(fwidth(ca), 1e-3) + 0.5, 0.0, 1.0);
          cardMod = 0.8 + 0.4 * vTree.z;
        }
        float n1 = tNoise(vWPos * 1.7);
        ${near ? 'float n2 = kind > 1.5 ? vTree.z : tNoise(vWPos * 4.9 + 7.1);' : 'float n2 = n1;'}
        float leafN = n1 * 0.55 + n2 * 0.45;
        if (isLobe > 0.5) {
          // facing from the true (faceted) surface normal: the shading normals are bent towards the crown and never
          // reach 0 at a lobe's visible outline
          vec3 vv = normalize(vViewPosition);
          float fc = abs(dot(normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))), vv));
          if (bare > 0.5) {
            ${near
              ? `// fine twig mass: a thin translucent veil around the branch skeleton. Coverage follows the optical depth
              // through the lobe (densest where the view crosses its centre, fading to nothing at its outline, so no
              // shell edges show), clumped by low-frequency world noise — no pixel speckle, no dark flakes
              float tn = tNoise(vWPos * 1.6);
              cover = (0.06 + 0.3 * fc * fc) * (0.45 + tn);`
              : `// distant bare crown: a translucent grey-brown twig haze (partial coverage), thinner at the silhouette
              cover = (0.36 + 0.3 * tNoise(vWPos * 0.9)) * mix(0.55, 1.0, fc);`}
          }${near ? ` else if (vTree.z >= 0.0) {
            // the crown interior dissolves towards its silhouette (no smooth "balloon" outline between the cards)
            cover = smoothstep(0.22, 0.55, fc + (tNoise(vWPos * 2.6) - 0.5) * 0.55);
          }` : ` else {
            // ragged, leafy silhouette instead of a smooth blob outline
            cover = smoothstep(0.15, 0.45, fc + (tNoise(vWPos * 1.4) - 0.5) * 0.6);
          }`}
        }
        if (uA2C < 0.5) { if (cover < 0.5) discard; cover = 1.0; }
        else if (cover < 0.01) discard;
        diffuseColor.a = cover;
        vec3 barkCol = mix(vec3(0.045, 0.034, 0.026), vec3(0.15, 0.14, 0.125), vIP.y) * (0.75 + 0.5 * n2);
        vec3 leafCol = vLeaf * (0.72 + 0.56 * leafN) * cardMod;
        float ao = mix(0.2, 1.0, vTree.x);
        ${near ? 'ao *= mix(1.0, 0.6, isLobe * step(0.0, vTree.z) * (1.0 - bare)); // crown interior (not hedges: aTree.z < 0)' : ''}
        diffuseColor.rgb = mix(barkCol, leafCol, isLeaf) * ao;
        float leafMask = isLeaf * (1.0 - bare);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${near ? `if (vTree.y > 0.5 && vTree.y < 1.5) {
          // break up the smooth lobe shading with a world-space noise bump
          vec3 bp = vWPos * 2.5; float b0 = tNoise(bp);
          vec3 bg = vec3(tNoise(bp + vec3(0.35, 0.0, 0.0)) - b0, tNoise(bp + vec3(0.0, 0.35, 0.0)) - b0, tNoise(bp + vec3(0.0, 0.0, 0.35)) - b0) / 0.35;
          normal = normalize(normal - (viewMatrix * vec4(bg, 0.0)).xyz * 0.35);
        }` : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (vTree.y > 0.5) roughnessFactor = vTree.y < 1.5 ? 1.0 : 0.92;`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        if (vTree.y > 0.5 && vTree.y < 1.5) { radiance *= 0.3; iblIrradiance *= 0.6; }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 vdir = normalize(vWPos - cameraPosition);
          float tr = pow(max(dot(vdir, uSunDir), 0.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunCol * (0.05 + 0.3 * tr) * leafMask;
        }`);
  };
  mat.customProgramCacheKey = () => (near ? 'cmu-tree-near-v5' : 'cmu-tree-far-v5');
  return mat;
}

// Shadow-caster material with the same wind motion; leaf cards are alpha tested, cards vanish in winter.
export function createTreeDepthMaterial(shared) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aTree; attribute vec2 aLeafUv; attribute vec4 iParams; uniform float uTime; uniform float uWind;
        varying vec2 vLeafUv; varying float vKind; varying float vDec;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${WIND_VERTEX}
        vLeafUv = aLeafUv; vKind = aTree.y; vDec = iParams.y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uLeafTex; uniform float uBare; varying vec2 vLeafUv; varying float vKind; varying float vDec;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vKind > 1.5 && (uBare * vDec > 0.5 || texture2D(uLeafTex, vLeafUv).a < 0.5)) discard;
        if (vKind > 0.5 && vKind < 1.5 && uBare * vDec > 0.5) discard;`);
  };
  mat.customProgramCacheKey = () => 'cmu-tree-depth-v3';
  return mat;
}
