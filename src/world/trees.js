// Procedural tree species + shared foliage/bark shaders (owner: life agent).
//
// A species is built from (a) displaced icosphere "lobes" forming the crown volume, (b) alpha-tested leaf-cluster
// cards scattered over the crown surface for a leafy, broken silhouette, and (c) tapered cylinders for the trunk
// (with a root flare) and branch skeleton (visible in winter). All parts are merged into ONE geometry per species
// and LOD, so each species costs one draw call per LOD tier.
//   per-vertex  aTree   = (ambient occlusion, kind 0 bark | 1 lobe | 2 leaf card, random; < 0 = solid hedge foliage)
//               aLeafUv = card UVs into the leaf atlas (0 elsewhere)
//   per-instance iLeaf  = base foliage colour (season dependent), iLeaf2 = (accent colour, fraction of the crown
//               that shows it — early-fall turning, patchy per leaf cluster), iParams = (seed, deciduous, barkTone,
//               swayScale; < 0 = shadow-only instance)
// LOD: near (cards) → mid (low-poly lobes) → impostor (one camera-facing quad per tree, crown drawn procedurally).
// Neighbouring tiers overlap in a distance band and cross-fade with a complementary screen-space dither, so trees
// never pop. The shaders add wind sway + leaf flutter, bark furrows / plane-tree mottling / mossy bases, per-cluster
// hue jitter, inter-lobe AO, winter "bare" mode and back-lit leaf translucency.
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
// atlas: 0 = broadleaf cluster cell, 1 = conifer needle-tuft cell of the leaf atlas.
function leafCards(lobes, crown, count, size, seed, atlas = 0) {
  const rng = mulberry32(seed * 31 + 7);
  const pos = new Float32Array(count * 18), nor = new Float32Array(count * 18), tree = new Float32Array(count * 18), uv = new Float32Array(count * 12);
  const wsum = lobes.reduce((s, l) => s + l.rx * l.rz, 0);
  const cn = [0, 0, 0];
  const corners = [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0], [0.5, 0.5, 1, 1], [-0.5, -0.5, 0, 0], [0.5, 0.5, 1, 1], [-0.5, 0.5, 0, 1]];
  let made = 0;
  for (let c = 0, guard = 0; c < count && guard < count * 40; guard++) {
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
    if (crownAO(crown, px, py, pz) < 0.22) continue;
    // card plane basis: normal = mix(random, radial) so cards face various directions
    let nx = dx * 0.6 + (rng() - 0.5) * 2, ny = dy * 0.6 + (rng() - 0.5) * 2, nz = dz * 0.6 + (rng() - 0.5) * 2;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    // tangent: any vector perpendicular to n, rotated randomly
    let tx = -nz, ty = 0, tz = nx;
    if (Math.abs(ny) > 0.95) { tx = 1; ty = 0; tz = 0; }
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
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
      uv[(c * 6 + v) * 2] = (atlas + tu) * 0.5; uv[(c * 6 + v) * 2 + 1] = tv;
    }
    c++; made = c;
  }
  const cut = (a, n) => (made < count ? a.slice(0, made * 6 * n) : a);
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
  g.setAttribute('position', new THREE.BufferAttribute(dup(cut(pos, 3), 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(dup(cut(nor, 3), 3), 3));
  return finish(g, dup(cut(tree, 3), 3), dup(cut(uv, 2), 2));
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
// Root flare: short wide cone around the trunk base so trunks don't look like posts stuck in the lawn.
function rootFlare(r, segs = 7) {
  return limb(0, -0.25, 0, 0, 0.75, 0, r * 1.75, r * 1.02, segs, 0.32, 0.5);
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

// Deciduous skeleton: trunk (+ root flare) + primary + secondary branches reaching into the crown.
function skeleton(parts, rng, { trunkTop, trunkR, crown, primaries = 5, secondaries = 2, segs = 6, fork = false, lean = 0.08 }) {
  const lx = (rng() - 0.5) * lean, lz = (rng() - 0.5) * lean;
  const tx = lx * trunkTop, tz = lz * trunkTop;
  parts.push(rootFlare(trunkR, segs));
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
    // primaries bend: a lower, more horizontal first half, then up into the crown (less "umbrella ribs")
    const mx = bx + (ex - bx) * 0.5, mz = bz + (ez - bz) * 0.5, my = by + (ey - by) * 0.38;
    parts.push(limb(bx, by, bz, mx, my, mz, r0, r0 * 0.6, Math.max(4, segs - 2), 0.5, 0.7));
    parts.push(limb(mx, my, mz, ex, ey, ez, r0 * 0.6, r0 * 0.22, Math.max(4, segs - 2), 0.7, 0.88));
    for (let k = 0; k < secondaries; k++) {
      const t = 0.4 + rng() * 0.4;
      const sx = bx + (ex - bx) * t, sy = by + (ey - by) * t, sz = bz + (ez - bz) * t;
      const a2 = a + (rng() - 0.5) * 1.8;
      const Lb = crown.rx * (0.22 + rng() * 0.2);
      const ex2 = sx + Math.cos(a2) * Lb, ey2 = sy + Lb * (0.35 + rng() * 0.6), ez2 = sz + Math.sin(a2) * Lb;
      parts.push(limb(sx, sy, sz, ex2, ey2, ez2, r0 * 0.45, r0 * 0.1, 3, 0.6, 0.9));
      // tertiary twigs (mostly visible in winter)
      for (let m = 0; m < 2; m++) {
        const u = 0.5 + rng() * 0.4;
        const qx = sx + (ex2 - sx) * u, qy = sy + (ey2 - sy) * u, qz = sz + (ez2 - sz) * u;
        const a3 = a2 + (rng() - 0.5) * 2.2, L3 = Lb * (0.35 + rng() * 0.3);
        parts.push(limb(qx, qy, qz, qx + Math.cos(a3) * L3, qy + L3 * (0.4 + rng() * 0.6), qz + Math.sin(a3) * L3, r0 * 0.14, r0 * 0.04, 3, 0.7, 0.95));
      }
    }
  }
}

// Build crown lobes (+ cards) from a lobe list. With cards, the lobes are shrunk well inside the card shell so
// they read as the dark crown interior, never as smooth "balloons" poking through the leaves.
function crown(parts, lobes, cr, seed, { amp = 0.24, cards = 0, cardSize = 1.5, inner = 0.71, atlas = 0 } = {}) {
  const inn = cards ? lobes.map((l) => ({ ...l, rx: l.rx * inner, ry: l.ry * inner, rz: l.rz * inner, detail: Math.min(l.detail, 1) })) : lobes;
  if (inner > 0) inn.forEach((L, i) => parts.push(lobe(L, cr, seed + i * 13, amp, inn)));
  if (cards) parts.push(leafCards(lobes, cr, cards, cardSize, seed, atlas));
}
const L = (x, y, z, rx, ry, rz, detail) => ({ x, y, z, rx, ry, rz, detail });

// ------------------------------------------------------------------ species
// Each builder returns { near, far, crown, trunkR } geometries in local space (trunk base at origin, +Y up, metres).
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
    crown(near, lobes, cr, seed, { cards: 250, cardSize: 1.95 });
    const far = [limb(0, -0.8, 0, 0, cr.y - 1, 0, 0.3, 0.14, 5, 0.4, 0.7)];
    const fl = [L(0, cr.y + 0.3, 0, 3.4, 3.0, 3.4, 1), L(1.6, cr.y - 0.5, 0.8, 2.5, 2.1, 2.5, 0), L(-1.3, cr.y - 0.3, -1.2, 2.5, 2.1, 2.5, 0), L(-0.4, cr.y - 0.9, 1.7, 2.3, 1.9, 2.3, 0)];
    crown(far, fl, cr, seed + 5, { amp: 0.18 });
    return { near: merge(near), far: merge(far), crown: cr, trunkR: 0.28 };
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
    crown(near, lobes, cr, seed, { cards: 320, cardSize: 2.5 });
    const far = [limb(0, -0.8, 0, 0, cr.y - 2, 0, 0.45, 0.2, 5, 0.4, 0.7)];
    const fl = [L(cr.x, cr.y + 0.4, cr.z, 4.8, 3.9, 4.8, 1), L(cr.x + 2.8, cr.y - 0.8, cr.z + 1.5, 3.3, 2.7, 3.3, 0), L(cr.x - 2.4, cr.y - 0.5, cr.z - 2.0, 3.4, 2.8, 3.4, 0), L(cr.x - 0.6, cr.y - 1.2, cr.z + 2.9, 3.0, 2.4, 3.0, 0)];
    crown(far, fl, cr, seed + 5, { amp: 0.2 });
    return { near: merge(near), far: merge(far), crown: cr, trunkR: 0.45 };
  },
  // Columnar / fastigiate (columnar oak, hornbeam 'Fastigiata', ginkgo). ~13 m.
  columnar(seed) {
    const rng = mulberry32(seed);
    const cr = { x: 0, y: 7.2, z: 0, rx: 2.1, ry: 5.8, bend: 0.6 };
    const near = [rootFlare(0.24, 6), limb(0, -0.8, 0, 0, 11.5, 0, 0.24, 0.06, 6, 0.4, 0.8)];
    // steep upward branches (fastigiate habit) — visible in winter
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4 + rng(), y0 = 2.4 + i * 0.85, out = 1.1 + rng() * 0.6;
      near.push(limb(0, y0, 0, Math.cos(a) * out, y0 + 2.6 + rng() * 1.5, Math.sin(a) * out, 0.08, 0.02, 3, 0.55, 0.85));
    }
    const lobes = [];
    for (let i = 0; i < 6; i++) {
      const y = 3.2 + i * 1.62 + rng() * 0.3;
      const r = 1.7 - Math.abs(i - 2.2) * 0.17 + rng() * 0.15;
      lobes.push(L((rng() - 0.5) * 0.6, y, (rng() - 0.5) * 0.6, r, r * 1.3, r, 2));
    }
    crown(near, lobes, cr, seed, { cards: 210, cardSize: 1.5, amp: 0.26, inner: 0.62 });
    const far = [limb(0, -0.8, 0, 0, 3, 0, 0.24, 0.15, 5, 0.4, 0.7)];
    crown(far, [L(0, 7.3, 0, 1.9, 5.4, 1.9, 1)], cr, seed + 9, { amp: 0.15 });
    return { near: merge(near), far: merge(far), crown: cr, trunkR: 0.24 };
  },
  // Norway / blue spruce: layered cone tiers, ~15 m.
  spruce(seed) {
    const near = [rootFlare(0.3, 6), limb(0, -0.8, 0, 0, 14.5, 0, 0.3, 0.05, 6, 0.35, 0.7)];
    const tiers = 8;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const r = 3.4 * (1 - t) + 0.45;
      const h = 3.2 - t * 1.2;
      near.push(coneTier(1.7 + i * 1.62 + h / 2, r, h, 14, seed + i * 7.3, 0.3));
    }
    const far = [limb(0, -0.8, 0, 0, 2, 0, 0.3, 0.2, 4, 0.35, 0.6), coneTier(5.0, 3.5, 7.4, 8, seed, 0.35), coneTier(10.5, 2.2, 6.0, 8, seed + 3, 0.45)];
    return { near: merge(near), far: merge(far), crown: { x: 0, y: 8, z: 0, rx: 3.4, ry: 7 }, trunkR: 0.3 };
  },
  // Eastern white pine: tall trunk, irregular flat tufts of needles, ~17 m.
  pine(seed) {
    const rng = mulberry32(seed);
    const cr = { x: 0, y: 12.3, z: 0, rx: 4.3, ry: 4.4, bend: 0.4 };
    const near = [rootFlare(0.36, 7), limb(0, -0.8, 0, 0.2, 16.5, -0.1, 0.36, 0.08, 7, 0.35, 0.75)];
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
    crown(near, lobes, cr, seed, { cards: 170, cardSize: 1.7, amp: 0.3, inner: 0.72, atlas: 1 });
    const far = [limb(0, -0.8, 0, 0, 13, 0, 0.36, 0.15, 4, 0.35, 0.6)];
    crown(far, [L(0.3, 12.8, 0, 3.6, 2.4, 3.3, 1), L(-0.6, 10.2, 0.4, 2.8, 1.6, 2.6, 1)], cr, seed + 17, { amp: 0.3 });
    return { near: merge(near), far: merge(far), crown: cr, trunkR: 0.36 };
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
    crown(near, lobes, cr, seed, { cards: 160, cardSize: 1.35 });
    const far = [limb(0, -0.8, 0, 0, 2.6, 0, 0.16, 0.1, 4, 0.45, 0.7)];
    crown(far, [L(0, cr.y, 0, 2.8, 1.75, 2.8, 1)], cr, seed + 3, { amp: 0.2 });
    return { near: merge(near), far: merge(far), crown: cr, trunkR: 0.15 };
  },
  // Young street tree in a sidewalk pit (honey locust / zelkova / pear on Walnut St & Penn Ave): tall clear trunk,
  // small airy vase-shaped crown, ~8 m.
  street(seed) {
    const rng = mulberry32(seed);
    const cr = { x: 0, y: 5.7, z: 0, rx: 2.8, ry: 2.3 };
    const near = [];
    skeleton(near, rng, { trunkTop: 2.9, trunkR: 0.13, crown: cr, primaries: 5, secondaries: 2, segs: 5, lean: 0.05 });
    const lobes = [L(0, cr.y + 0.3, 0, 1.6, 1.5, 1.6, 1)];
    fibDirs(8, rng, -0.35).forEach((d) => {
      const r = 0.95 + rng() * 0.4;
      lobes.push(L(d[0] * cr.rx * 0.62, cr.y + d[1] * cr.ry * 0.55, d[2] * cr.rx * 0.62, r, r * 0.85, r, 1));
    });
    crown(near, lobes, cr, seed, { cards: 230, cardSize: 1.15, inner: 0 });   // airy: leaf clusters only, branches show through
    const far = [limb(0, -0.8, 0, 0, cr.y - 0.8, 0, 0.14, 0.08, 4, 0.4, 0.7)];
    crown(far, [L(0, cr.y + 0.2, 0, 2.4, 2.0, 2.4, 1), L(0.8, cr.y - 0.5, -0.5, 1.6, 1.3, 1.6, 0)], cr, seed + 3, { amp: 0.22 });
    return { near: merge(near), far: merge(far), crown: cr, trunkR: 0.13 };
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
    crown(near, lobes, cr, seed, { cards: 38, cardSize: 0.8, amp: 0.25, inner: 0.78 });
    const far = [];
    crown(far, [L(0, 0.6, 0, 1.15, 0.8, 1.15, 0)], cr, seed + 7, { amp: 0.15 });
    return { near: merge(near), far: merge(far), crown: cr, trunkR: 0 };
  },
};

export const SPECIES = ['broadleaf', 'oak', 'columnar', 'spruce', 'pine', 'ornamental', 'street', 'shrub'];
export const EVERGREEN = { spruce: true, pine: true };
// impostor crown shape: 0 rounded, 1 conifer cone, 2 clumpy (white pine)
const IMP_SHAPE = { spruce: 1, pine: 2 };

// Returns { near, far, crown, imp } geometries in local space. imp = crown box for the impostor tier:
// { cy, rx, ry, trunkR, shape } measured from the foliage of the near model.
export function buildSpeciesGeometry(key, seed = 11) {
  const g = BUILDERS[key](seed);
  const pos = g.near.attributes.position, tr = g.near.attributes.aTree;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (tr.getY(i) < 0.5) continue;
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  g.imp = { cy: (y0 + y1) / 2, rx: ((x1 - x0) + (z1 - z0)) / 4 * 0.86, ry: (y1 - y0) / 2 * 0.9, trunkR: g.trunkR || 0.2, shape: IMP_SHAPE[key] || 0 };
  return g;
}

// ------------------------------------------------------------------ leaf atlas (painted at runtime)
// 1024×512, two 512² cells: [0, 0.5) a broadleaf cluster (≈190 pointed leaves radiating from a few twigs, 13–22 cm on
// a 1.8 m card), [0.5, 1) conifer needle tufts. RGB = per-leaf brightness (random tilt, darker towards the cluster
// centre and for the leaves behind), A = coverage. Painted on two canvases (brightness on an opaque grey background
// so mip levels never bleed black into the leaf edges, coverage separately) and combined into a DataTexture.
let leafTex = null;
export function getLeafTexture() {
  if (leafTex) return leafTex;
  const W = 1024, S = 512;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = S; return c; };
  const cB = mk(), cA = mk();
  const gB = cB.getContext('2d'), gA = cA.getContext('2d');
  gB.fillStyle = 'rgb(170,170,170)'; gB.fillRect(0, 0, W, S);
  gA.fillStyle = '#000'; gA.fillRect(0, 0, W, S);
  const rng = mulberry32(99);
  const both = (fn) => { fn(gB, false); fn(gA, true); };
  // --- broadleaf cluster
  const cx = S / 2, cy = S / 2, R = S * 0.45;
  const twigs = [];
  for (let t = 0; t < 6; t++) twigs.push(t * (Math.PI * 2 / 6) + (rng() - 0.5) * 0.7);
  both((g, a) => {
    g.strokeStyle = a ? '#fff' : 'rgb(95,88,80)';
    g.lineCap = 'round';
    for (const tw of twigs) {
      g.lineWidth = 5; g.beginPath(); g.moveTo(cx, cy);
      g.quadraticCurveTo(cx + Math.cos(tw + 0.3) * R * 0.4, cy + Math.sin(tw + 0.3) * R * 0.4, cx + Math.cos(tw) * R * 0.78, cy + Math.sin(tw) * R * 0.78);
      g.stroke();
    }
  });
  const leaves = [];
  for (let i = 0; i < 190; i++) {
    const tw = twigs[Math.floor(rng() * twigs.length)] + (rng() - 0.5) * 0.9;
    const d = Math.pow(rng(), 0.7) * R * 0.78;
    const x = cx + Math.cos(tw) * d, y = cy + Math.sin(tw) * d;
    const len = 40 + rng() * 26;
    if (Math.hypot(x - cx, y - cy) + len > R * 1.02) continue;
    const ang = tw + (rng() - 0.5) * 1.6;
    // brightness: random tilt, darker near the cluster centre (leaves behind / in shadow)
    const v = Math.round(Math.min(255, 105 + rng() * 110 + (d / R) * 55));
    leaves.push({ x, y, len, wid: len * (0.3 + rng() * 0.14), ang, v });
  }
  leaves.sort((p, q) => p.v - q.v);
  both((g, a) => {
    for (const lf of leaves) {
      g.save();
      g.translate(lf.x, lf.y); g.rotate(lf.ang);
      g.beginPath(); g.moveTo(0, 0);
      g.bezierCurveTo(lf.len * 0.25, -lf.wid, lf.len * 0.7, -lf.wid * 0.9, lf.len, 0);
      g.bezierCurveTo(lf.len * 0.7, lf.wid * 0.9, lf.len * 0.25, lf.wid, 0, 0);
      g.fillStyle = a ? '#fff' : `rgb(${lf.v},${lf.v},${lf.v})`;
      g.fill();
      if (!a) {
        // midrib + a lighter edge on the lit side
        g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(lf.len * 0.06, 0); g.lineTo(lf.len * 0.88, 0); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(lf.len * 0.1, -lf.wid * 0.62); g.quadraticCurveTo(lf.len * 0.5, -lf.wid * 1.02, lf.len * 0.9, -lf.wid * 0.2); g.stroke();
      }
      g.restore();
    }
  });
  // --- needle tufts
  const ox = S;
  for (let t = 0; t < 7; t++) {
    const a0 = rng() * 6.28, d0 = Math.sqrt(rng()) * R * 0.5;
    const tx = ox + S / 2 + Math.cos(a0) * d0, ty = S / 2 + Math.sin(a0) * d0;
    const nN = 70;
    const needles = [];
    for (let k = 0; k < nN; k++) {
      const a = rng() * 6.28, len = 50 + rng() * 60;
      const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.85;
      if (Math.hypot(ex - ox - S / 2, ey - S / 2) > R) continue;
      needles.push({ a, ex, ey, v: Math.round(110 + rng() * 130) });
    }
    both((g, alpha) => {
      g.lineCap = 'round';
      g.strokeStyle = alpha ? '#fff' : 'rgb(90,82,72)'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(tx - Math.cos(a0) * 30, ty - Math.sin(a0) * 30); g.lineTo(tx, ty); g.stroke();
      g.lineWidth = 2.6;
      for (const nd of needles) {
        g.strokeStyle = alpha ? '#fff' : `rgb(${nd.v},${nd.v},${nd.v})`;
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(nd.ex, nd.ey); g.stroke();
      }
    });
  }
  const b = gB.getImageData(0, 0, W, S).data, al = gA.getImageData(0, 0, W, S).data;
  const out = new Uint8Array(W * S * 4);
  for (let i = 0; i < W * S; i++) {
    const v = b[i * 4];
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = al[i * 4];
  }
  cB.width = cB.height = cA.width = cA.height = 0;     // release the canvas backing stores
  leafTex = new THREE.DataTexture(out, W, S, THREE.RGBAFormat);
  leafTex.colorSpace = THREE.NoColorSpace;
  leafTex.generateMipmaps = true;
  leafTex.minFilter = THREE.LinearMipmapLinearFilter;
  leafTex.magFilter = THREE.LinearFilter;
  leafTex.wrapS = leafTex.wrapT = THREE.ClampToEdgeWrapping;
  leafTex.anisotropy = 4;
  leafTex.needsUpdate = true;
  return leafTex;
}

// ------------------------------------------------------------------ seasonal foliage colours
const C = (hex) => new THREE.Color(hex);
const SUMMER = {
  broadleaf: [C('#4a7431'), C('#577f35'), C('#41692c'), C('#4f7a3a'), C('#5a7d2e')],
  oak: [C('#3d6429'), C('#486f2f'), C('#517834'), C('#3f6a33')],
  columnar: [C('#4f7530'), C('#466c2f'), C('#557a36')],
  spruce: [C('#29432b'), C('#2f4a34'), C('#36503d'), C('#3a5249')],
  pine: [C('#34512f'), C('#3c5a36'), C('#40603a')],
  ornamental: [C('#557f35'), C('#62883d'), C('#4d7631')],
  street: [C('#5f8a35'), C('#6b9139'), C('#557f33')],
  shrub: [C('#3b6229'), C('#4a7231'), C('#33542a'), C('#44683a')],
};
const AUTUMN_ACCENT = [C('#c9a02a'), C('#d4ad3e'), C('#c7772a'), C('#b45a24'), C('#a0402a'), C('#8c3526')];
const YELLOWED = C('#8f8b2e');
const TWIG = C('#574c44');
const SPRING_GREEN = [C('#79a845'), C('#88b64c'), C('#6c9c3c')];
const BLOSSOM = [C('#f2bccb'), C('#f6d6df'), C('#faf2f0'), C('#e699b2')];
const _c = new THREE.Color(), _c2 = new THREE.Color();

// Writes the foliage colour for one tree into out[o..o+2] and (optionally) the accent colour + the fraction of the
// crown showing it into out2[o2..o2+3]. rnd, rnd2 ∈ [0,1) are per-tree randoms.
export function seasonColor(species, season, rnd, rnd2, out, o, evergreenShrub = false, out2 = null, o2 = 0) {
  const base = SUMMER[species] || SUMMER.broadleaf;
  _c.copy(base[Math.floor(rnd * 997) % base.length]);
  const evergreen = EVERGREEN[species] || evergreenShrub;
  let frac = 0;
  _c2.copy(_c);
  if (season === 'autumn' && !evergreen) {
    // early fall: most trees still green (a little yellowed, a few turning clusters); ~1 in 5 is turning — patchily,
    // cluster by cluster, from partly to fully coloured
    const turnP = species === 'ornamental' ? 0.3 : species === 'oak' ? 0.1 : species === 'shrub' ? 0.08 : species === 'street' ? 0.16 : 0.12;
    if (rnd2 < turnP) {
      let pick;
      if (species === 'ornamental') pick = AUTUMN_ACCENT[3 + (Math.floor(rnd * 997) % 3)];
      else if (species === 'oak') pick = AUTUMN_ACCENT[2 + (Math.floor(rnd * 997) % 4)];
      else pick = AUTUMN_ACCENT[[0, 1, 0, 1, 2, 3, 4][Math.floor(rnd * 997) % 7]]; // mostly yellows early in the season
      _c2.copy(pick);
      _c.lerp(YELLOWED, 0.15 + rnd * 0.15);
      frac = 0.3 + (rnd2 / turnP) * 0.62;
    } else {
      _c.lerp(YELLOWED, 0.05 + rnd2 * 0.18);
      _c2.copy(AUTUMN_ACCENT[Math.floor(rnd * 997) % 3]);
      frac = rnd2 < 0.3 ? rnd2 * 0.2 : 0;          // a few yellowing clusters on some trees
    }
  } else if (season === 'winter' && !evergreen) {
    _c.copy(TWIG).multiplyScalar(0.85 + rnd * 0.3); _c2.copy(_c);
  } else if (season === 'winter' && evergreen) {
    _c.multiplyScalar(0.8); _c2.copy(_c);
  } else if (season === 'spring' && !evergreen) {
    if (species === 'ornamental') { _c.copy(BLOSSOM[Math.floor(rnd * 997) % BLOSSOM.length]); _c2.copy(SPRING_GREEN[0]); frac = 0.12; }
    else { _c.copy(SPRING_GREEN[Math.floor(rnd * 997) % SPRING_GREEN.length]).lerp(base[0], rnd2 * 0.4); _c2.copy(_c); }
  }
  const j = 0.9 + rnd2 * 0.2;
  out[o] = _c.r * j; out[o + 1] = _c.g * j; out[o + 2] = _c.b * j;
  if (out2) { out2[o2] = _c2.r * j; out2[o2 + 1] = _c2.g * j; out2[o2 + 2] = _c2.b * j; out2[o2 + 3] = frac; }
}

// ------------------------------------------------------------------ material
const GLSL_NOISE = /* glsl */`
float tHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float tNoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(tHash(i), tHash(i + vec3(1,0,0)), f.x), mix(tHash(i + vec3(0,1,0)), tHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(tHash(i + vec3(0,0,1)), tHash(i + vec3(1,0,1)), f.x), mix(tHash(i + vec3(0,1,1)), tHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// 4×4 ordered (Bayer) threshold: the per-pixel threshold of the LOD cross-fade dither (the two tiers use
// complementary halves). An ordered pattern reads as an even screen-door blend, not as hatching or grain.
float tBayer(vec2 p){
  ivec2 i = ivec2(mod(floor(p), 4.0));
  int v = (((i.x ^ i.y) & 1) << 3) | ((i.y & 1) << 2) | ((((i.x >> 1) ^ (i.y >> 1)) & 1) << 1) | ((i.y >> 1) & 1);
  return (float(v) + 0.5) / 16.0;
}
`;
// LOD cross-fade: vFade = (fade-in, fade-out). A pixel is kept when 1 - b <= fadeIn and b < fadeOut, so a tier fading
// in keeps exactly the pixels the tier fading out drops.
const LOD_DITHER = /* glsl */`
  { float lodB = tBayer(gl_FragCoord.xy); if (1.0 - lodB > vFade.x || lodB >= vFade.y) discard; }
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
    // LOD bands (camera distance, m): near→mid cross-fade over [x, y], mid→impostor over [z, w]
    uLod: { value: new THREE.Vector4(156, 180, 380, 420) },
    uFar: { value: 3200 },
  };
}

// near = full detail (leaf cards, twig haze); far = the mid tier (ragged low-poly lobe crowns, translucent winter
// haze). Cut-outs use alpha-to-coverage on the MSAA target (anti-aliased leaf edges, smooth partial coverage instead
// of a dither checkerboard); without MSAA they fall back to an alpha test. iParams.w < 0 marks a shadow-only
// instance: it is collapsed in the colour pass (the depth material still draws it). lodScale multiplies the camera
// distance for the LOD bands (shrubs switch at ~70 % of the tree distances).
export function createTreeMaterial(shared, { near = true, lodScale = 1 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0, envMapIntensity: 0.5 });
  mat.name = near ? 'treeNear' : 'treeFar';
  mat.alphaToCoverage = true;
  const own = { uLodScale: { value: lodScale } };
  mat.userData.lodScale = own.uLodScale;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aTree; attribute vec2 aLeafUv; attribute vec3 iLeaf; attribute vec4 iLeaf2; attribute vec4 iParams;
        uniform float uTime; uniform float uWind; uniform vec4 uLod; uniform float uLodScale;
        varying vec3 vTree; varying vec3 vLeaf; varying vec4 vLeaf2; varying vec3 vWPos; varying vec3 vIP; varying vec2 vLeafUv;
        varying vec2 vFade; varying float vH;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${WIND_VERTEX}
        vTree = aTree; vLeaf = iLeaf; vLeaf2 = iLeaf2; vIP = iParams.xyz; vLeafUv = aLeafUv; vH = position.y;
        // each tree switches at its own distance (±15 m): the cross-fades are scattered, never a visible ring
        float lodD = distance(cameraPosition, iPos) * uLodScale + (iParams.x - 0.5) * 30.0;
        float lodA = smoothstep(uLod.x, uLod.y, lodD);
        ${near ? 'vFade = vec2(1.0, 1.0 - lodA);' : 'vFade = vec2(lodA, 1.0 - smoothstep(uLod.z, uLod.w, lodD));'}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        if (iParams.w < 0.0 || vFade.x <= 0.0 || vFade.y <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uBare; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform sampler2D uLeafTex; uniform float uA2C;
        varying vec3 vTree; varying vec3 vLeaf; varying vec4 vLeaf2; varying vec3 vWPos; varying vec3 vIP; varying vec2 vLeafUv;
        varying vec2 vFade; varying float vH;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${LOD_DITHER}
        float kind = vTree.y;
        float isLeaf = step(0.5, kind);
        float isLobe = isLeaf * (1.0 - step(1.5, kind));
        float bare = uBare * vIP.y;
        float cardMod = 1.0;
        float cover = 1.0;
        float texL = 0.78;
        if (kind > 1.5) {
          if (bare > 0.5) discard;
          // alpha with mip-level compensation (keeps distant cards from thinning out), sharpened for alpha-to-coverage
          vec2 du = dFdx(vLeafUv * vec2(1024.0, 512.0)), dv = dFdy(vLeafUv * vec2(1024.0, 512.0));
          float lod = max(0.0, 0.5 * log2(max(dot(du, du), dot(dv, dv))));
          vec4 lt = texture2D(uLeafTex, vLeafUv);
          float ca = lt.a * (1.0 + lod * 0.3);
          cover = clamp((ca - 0.5) / max(fwidth(ca), 1e-3) + 0.5, 0.0, 1.0);
          texL = lt.r;
          cardMod = 0.84 + 0.32 * vTree.z;
          // cards seen edge-on fade out (no streaks); true facing from the flat card's screen-space derivatives
          float fcc = abs(dot(normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))), normalize(vViewPosition)));
          cover *= smoothstep(0.06, 0.26, fcc);
        }
        // one or two noise lookups per fragment: n1 = leaf-scale variation (near) / leaf-clump field (mid tier); it is
        // also the bump height whose screen-space derivatives tilt the lobe normals (no extra lookups for the bump)
        float n1 = ${near ? 'tNoise(vWPos * (kind > 1.5 ? 1.7 : 2.5))' : 'tNoise(vWPos * 0.85 + vIP.x * 7.0)'};
        float leafN = ${near ? 'n1 * 0.55 + (kind > 1.5 ? vTree.z : n1) * 0.45' : 'n1'};
        if (isLobe > 0.5) {
          // facing from the true (faceted) surface normal: the shading normals are bent towards the crown and never
          // reach 0 at a lobe's visible outline
          vec3 vv = normalize(vViewPosition);
          float fc = abs(dot(normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))), vv));
          if (bare > 0.5) {
            ${near
              ? `// close up the modelled branches and twigs carry the bare crown; a translucent veil here only reads as grey
              // smudges against a winter sky (alpha-to-coverage quantises it), so the lobes are dropped
              discard;`
              : `// distant bare crown: a translucent grey-brown twig haze (partial coverage), thinner at the silhouette
              cover = (0.36 + 0.3 * n1) * mix(0.55, 1.0, fc);`}
          }${near ? ` else if (vTree.z >= 0.0) {
            // the crown interior dissolves towards its silhouette (no smooth "balloon" outline between the cards)
            cover = smoothstep(0.28, 0.6, fc + (n1 - 0.5) * 0.55 + (tNoise(vWPos * 6.3) - 0.5) * 0.4);
          }` : ` else {
            // ragged, leafy silhouette instead of a smooth blob outline
            cover = smoothstep(0.15, 0.45, fc + (n1 - 0.5) * 0.6);
          }`}
        }
        if (uA2C < 0.5) { if (cover < 0.5) discard; cover = 1.0; }
        else if (cover < 0.01) discard;
        diffuseColor.a = cover;
        // bark: vertical furrows, fine grain, London-plane mottling (pale barkTone), damp mossy base
        vec3 barkCol = mix(vec3(0.12, 0.1, 0.082), vec3(0.28, 0.265, 0.24), vIP.z);
        ${near ? `if (kind < 0.5) {
          float furrow = tNoise(vec3(vWPos.x * 9.0, vWPos.y * 1.1, vWPos.z * 9.0));
          float grain = tNoise(vWPos * 17.0);
          barkCol *= 0.5 + 0.6 * furrow + 0.25 * grain;
          float mot = tNoise(vec3(vWPos.x * 2.3, vWPos.y * 1.3, vWPos.z * 2.3));
          barkCol = mix(barkCol, vec3(0.36, 0.34, 0.25) * (0.85 + 0.3 * grain), smoothstep(0.8, 0.86, vIP.z) * smoothstep(0.5, 0.58, mot));
          barkCol = mix(barkCol, vec3(0.055, 0.075, 0.032), (1.0 - smoothstep(0.0, 1.5, vH)) * 0.5 * mot);
        }` : 'barkCol *= 0.75 + 0.5 * n1;'}
        // foliage: base colour, early-fall turning cluster by cluster (cards) or in patches (lobes), per-cluster hue jitter
        ${near ? `float turnA = kind > 1.5 ? step(fract(vTree.z * 7.31 + vIP.x * 3.17), vLeaf2.a) : vLeaf2.a;`
          : `float turnR = tNoise(vWPos * 1.1 + vIP.x * 13.0);
        float turnA = smoothstep(turnR - 0.18, turnR + 0.18, vLeaf2.a < 0.15 ? 0.0 : vLeaf2.a);`}
        vec3 fol = mix(vLeaf, vLeaf2.rgb, turnA) * (1.0 - 0.35 * bare);    // bare twigs: darker than the summer crown
        float hj = (kind > 1.5 ? fract(vTree.z * 13.7 + vIP.x * 5.3) : n1) - 0.5;
        fol *= vec3(1.0 + hj * 0.18, 1.0 + hj * 0.05, 1.0 - hj * 0.26);
        vec3 leafCol = fol * (0.52 + 0.62 * texL) * cardMod * (0.84 + 0.32 * leafN);
        float ao = mix(0.26, 1.0, vTree.x);
        ${near ? 'ao *= mix(1.0, 0.76, isLobe * step(0.0, vTree.z) * (1.0 - bare)); // crown interior (not hedges: aTree.z < 0)'
          : `// leaf clumps on the low-poly crowns (≈1.2 m): the gaps between them are darker
        ao *= mix(1.0, 0.62 + 0.5 * n1, isLobe * (1.0 - bare));`}
        diffuseColor.rgb = mix(barkCol, leafCol, isLeaf) * ao;
        float leafMask = isLeaf * (1.0 - bare);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vTree.y > 0.5 && vTree.y < 1.5) {
          // bump the lobe (and clipped hedge) normals with the surface gradient of n1 (screen-space derivatives: no extra lookups)
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = (dFdx(n1) * r1 + dFdy(n1) * r2) / (abs(det) > 1e-10 ? det : 1e-10);
          normal = normalize(normal - grad * ${near ? '(vTree.z < 0.0 ? 0.3 : 0.14)' : '0.55'});
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (vTree.y > 0.5) roughnessFactor = vTree.y < 1.5 ? 1.0 : 0.8;`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        if (vTree.y > 0.5 && vTree.y < 1.5 && vTree.z >= 0.0) { radiance *= ${near ? '0.5' : '0.82'}; iblIrradiance *= ${near ? '0.7' : '0.92'}; }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // sunlight shining through the leaves: warmer, yellow-green, strongest looking towards the sun
          vec3 vdir = normalize(vWPos - cameraPosition);
          float tr = pow(max(dot(vdir, uSunDir), 0.0), 4.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.05, 1.12, 0.6) * uSunCol * (0.05 + 0.5 * tr) * leafMask * (kind > 1.5 ? 1.0 : 0.55);
        }`);
  };
  mat.customProgramCacheKey = () => (near ? 'cmu-tree-near-v9' : 'cmu-tree-far-v9');
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

// ------------------------------------------------------------------ impostor tier
// One camera-facing quad per tree (4 vertices): the crown is drawn procedurally in the fragment shader — a lumpy
// ellipse (cone for spruces, clumps for white pines) with a pseudo-spherical normal so it is lit like the 3D crowns,
// clump shading, the season's colours (turning in patches), a trunk below it when seen from the side. The quad is
// oriented so the tree stays upright: its "up" axis is world up projected onto the view plane, and the crown's
// projected height blends to its width when seen from above. Per instance: iPos = (x, ground y, z, seed + 2·deciduous),
// iDim = (crown centre height, crown radius, crown half height, shape + trunk radius / crown radius).
export function createImpostorGeometry(capacity) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
  g.setAttribute('iDim', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
  g.setAttribute('iLeaf', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  g.setAttribute('iLeaf2', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
  g.instanceCount = capacity;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

export function createImpostorMaterial(shared) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.5 });
  mat.name = 'treeImpostor';
  mat.alphaToCoverage = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 iPos; attribute vec4 iDim; attribute vec3 iLeaf; attribute vec4 iLeaf2;
        uniform vec4 uLod; uniform float uFar;
        varying vec2 vQ; varying vec4 vImp; varying vec3 vLeaf; varying vec4 vLeaf2; varying vec3 vR; varying vec3 vU; varying vec3 vF;
        varying vec2 vFade; varying float vSinE;`)
      .replace('#include <beginnormal_vertex>', `
        vec3 impC = vec3(iPos.x, iPos.y + iDim.x, iPos.z);
        vec3 impToC = impC - cameraPosition;
        float impDist = length(impToC);
        vec3 impF = impToC / max(impDist, 1e-3);
        vec3 impR = cross(impF, vec3(0.0, 1.0, 0.0));
        float impRl = length(impR);
        impR = impRl > 1e-3 ? impR / impRl : vec3(1.0, 0.0, 0.0);
        vec3 impU = cross(impR, impF);
        float sinE = min(1.0, abs(impF.y)), cosE = sqrt(max(0.0, 1.0 - sinE * sinE));
        float hv = sqrt(iDim.z * iDim.z * cosE * cosE + iDim.y * iDim.y * sinE * sinE);
        float gnd = iDim.x * cosE;
        vec3 objectNormal = -impF;`)
      .replace('#include <begin_vertex>', `
        float qx = position.x * 1.14;
        float qy = mix(-max(hv * 1.14, gnd), hv * 1.14, position.y);
        vec3 transformed = impC + impR * (qx * iDim.y) + impU * qy;
        float lodD = distance(cameraPosition, iPos.xyz) + (fract(iPos.w) - 0.5) * 30.0;   // same as the mid tier's fade-out
        float fin = smoothstep(uLod.z, uLod.w, lodD);
        float fout = 1.0 - smoothstep(uFar * 0.82, uFar, lodD);
        vFade = vec2(fin, fout);
        if (fin <= 0.0 || fout <= 0.0) transformed = impC;
        vQ = vec2(qx, qy / hv);
        vImp = vec4(-gnd / hv, iPos.w, iDim.w, iDim.y / hv);
        vLeaf = iLeaf; vLeaf2 = iLeaf2; vR = impR; vU = impU; vF = impF; vSinE = sinE;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uBare; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uA2C;
        varying vec2 vQ; varying vec4 vImp; varying vec3 vLeaf; varying vec4 vLeaf2; varying vec3 vR; varying vec3 vU; varying vec3 vF;
        varying vec2 vFade; varying float vSinE;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${LOD_DITHER}
        vec2 q = vQ;
        if (dot(q, q) > 1.5 && q.y > -0.15) discard;       // quad corners outside any crown: skip the shading
        float shape = floor(vImp.z + 0.01);
        float tw = fract(vImp.z);
        float seed = fract(vImp.y);
        float dec = step(1.5, vImp.y);
        float bare = uBare * dec;
        // crown outline
        float ang = atan(q.y, q.x);
        vec2 cs = vec2(cos(ang), sin(ang));
        float lob = tNoise(vec3(cs * 2.1 + seed * 31.0, seed * 7.0));
        float r;
        bool cone = shape > 0.5 && shape < 1.5;
        if (cone) {
          float xs = mix(clamp(0.96 - (q.y + 1.0) * 0.47, 0.03, 1.0), 1.0, vSinE * vSinE);
          r = mix(max(abs(q.x) / xs, abs(q.y)), length(q), vSinE) / (0.9 + 0.12 * lob);
        } else if (shape > 1.5) {
          float lob2 = tNoise(vec3(cs * 4.3 + seed * 17.0, 3.0 + seed));
          r = length(q) / (0.7 + 0.22 * lob + 0.2 * lob2);
        } else {
          r = length(q) / (0.86 + 0.16 * lob);
        }
        // leaf clumps: a cellular pattern over the crown (3–4 clumps across its radius, circular in world units),
        // each clump shaded as a small ball, dark gaps between them; they also make the outline bumpy
        vec2 cp = vec2(q.x * vImp.w, q.y) * (cone ? vec2(2.4, 3.4) : vec2(2.25)) + seed * 17.0;
        float cw = fwidth(cp.x) + fwidth(cp.y);
        float cK = 1.0 - smoothstep(0.35, 0.9, cw);        // clumps fade out once they get smaller than ~2 px
        float cBest = 0.25; vec2 cVec = vec2(0.0), cId = vec2(0.0);
        if (cK > 0.0) {                                    // (distant, tiny crowns skip the cellular search)
          cp += (vec2(tNoise(vec3(cp * 0.7, 4.0)), tNoise(vec3(cp * 0.7, 9.0))) - 0.5) * 0.9;   // irregular cells
          vec2 ci = floor(cp), cf = fract(cp);
          cBest = 9.0;
          for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
            vec2 g = vec2(float(xx), float(yy));
            vec2 id = ci + g;
            vec2 dv = g + 0.15 + 0.7 * vec2(tHash(vec3(id, 3.1)), tHash(vec3(id, 5.7))) - cf;
            float dd = dot(dv, dv);
            if (dd < cBest) { cBest = dd; cVec = dv; cId = id; }
          }
        }
        float cd = sqrt(cBest);
        r -= (0.5 - cd) * 0.16 * cK;
        float cover = clamp((1.0 - r) / max(fwidth(r), 1e-3) + 0.5, 0.0, 1.0);
        vec2 cv = -cVec / 0.62;
        float cz = sqrt(max(0.0, 1.0 - min(1.0, dot(cv, cv))));
        float nz = sqrt(max(0.0, 1.0 - min(1.0, r * r)));
        vec3 crownN = vR * q.x + vU * (q.y + 0.2) - vF * (nz + 0.25);
        vec3 clumpN = vR * cv.x + vU * cv.y - vF * cz;
        float fineN = tNoise(vec3(cp * 2.3, 2.0));
        vec3 impN = normalize(normalize(crownN) + clumpN * 0.6 * cK * smoothstep(0.8, 0.35, cd));   // no normal jump at clump borders
        float cAO = mix(1.0, mix(0.66, 1.0, smoothstep(0.78, 0.25, cd)) * (0.86 + 0.28 * fineN), cK);
        // season colours: turning clump by clump
        float tp = tHash(vec3(cId, 9.3 + seed * 7.0));
        float turnA = vLeaf2.a < 0.15 ? 0.0 : vLeaf2.a;       // (a few yellow clusters would only speckle at this size)
        vec3 fol = mix(vLeaf, vLeaf2.rgb, mix(step(tp, turnA), turnA, 1.0 - cK));
        float hj = seed - 0.5;
        fol *= vec3(1.0 + hj * 0.14, 1.0 + hj * 0.04, 1.0 - hj * 0.2);
        vec3 col = fol * cAO * mix(0.6, 1.0, smoothstep(-1.0, 0.6, q.y + 0.3 * vSinE));
        // winter: bare deciduous crowns are a translucent twig haze
        cover *= mix(1.0, 0.36 + 0.3 * cAO, bare);
        // trunk below the crown (seen from the side)
        float trunk = step(abs(q.x), tw * (1.3 - 0.3 * (q.y - vImp.x))) * step(vImp.x, q.y) * step(q.y, -0.2) * (1.0 - vSinE * vSinE);
        if (trunk > 0.5 && cover < 0.5) { cover = 1.0; col = vec3(0.14, 0.12, 0.1); impN = normalize(vR * q.x / max(tw, 1e-3) * 0.7 - vF); }
        if (uA2C < 0.5) { if (cover < 0.5) discard; cover = 1.0; }
        else if (cover < 0.01) discard;
        diffuseColor.rgb = col;
        diffuseColor.a = cover;
        float leafMask = (1.0 - trunk) * (1.0 - bare);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(impN, 0.0)).xyz);`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        radiance *= 0.86; iblIrradiance *= 0.92;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float tr = pow(max(dot(vF, uSunDir), 0.0), 4.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.05, 1.12, 0.6) * uSunCol * (0.05 + 0.3 * tr) * leafMask * 0.55;
        }`);
  };
  mat.customProgramCacheKey = () => 'cmu-tree-impostor-v5';
  return mat;
}
