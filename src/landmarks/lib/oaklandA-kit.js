// Geometry kit shared by the Oakland landmarks (Cathedral of Learning, Heinz Chapel, Mellon Institute).
//
// Everything is built in a landmark-local "plan frame" (u = local +X, v = local +Z, y up) and transformed to
// world coordinates before merging, so the returned meshes sit directly in world space.
// UVs are in metres (see core/materials.js); facade walls get u = metres along the wall, v = metres above a
// chosen reference height so window storeys line up with the ground floor.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyWorldUV } from '../../core/materials.js';

const KEEP = new Set(['position', 'normal', 'uv']);

// Normalise a geometry for merging: non-indexed, exactly position/normal/uv.
export function prep(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

// ------------------------------------------------------------------ plan frame
// Local (u, v) -> world (x, z): world = origin + u*eu + v*ev with eu = (cos a, sin a), ev = (-sin a, cos a).
// Equivalent to an Object3D at `origin` with rotation.y = -a.
export function makeFrame(ox, oz, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const matrix = new THREE.Matrix4().makeRotationY(-angle).setPosition(ox, 0, oz);
  return {
    ox, oz, angle, c, s, matrix,
    toWorld(u, v) { return [ox + u * c - v * s, oz + u * s + v * c]; },
    toLocal(x, z) { const dx = x - ox, dz = z - oz; return [dx * c + dz * s, -dx * s + dz * c]; },
    // matrix placing a local object at (u, y, v) rotated by rotY about local +Y
    place(u, y, v, rotY = 0, out = new THREE.Matrix4()) {
      out.makeRotationY(rotY).setPosition(u, y, v);
      return out.premultiply(matrix);
    },
  };
}

// ------------------------------------------------------------------ batching
// Collects geometries by material key and merges each list into one mesh.
export class Batch {
  constructor() { this.lists = new Map(); this.tris = 0; }
  add(key, geo) {
    const g = prep(geo);
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(g);
    this.tris += g.attributes.position.count / 3;
    return g;
  }
  build(materials, { castShadow = true, receiveShadow = true, noShadow = [] } = {}) {
    const group = new THREE.Group();
    for (const [key, list] of this.lists) {
      const mat = materials[key];
      if (!mat || !list.length) { if (!mat) console.warn('[oaklandA] missing material', key); continue; }
      const merged = mergeGeometries(list, false);
      if (!merged) { console.warn('[oaklandA] merge failed for', key); continue; }
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = key;
      mesh.castShadow = castShadow && !noShadow.includes(key);
      mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      for (const g of list) g.dispose();
    }
    return group;
  }
}

// ------------------------------------------------------------------ primitives (local frame)
const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();

// Box with metre UVs computed in the local frame (v measured from vRef), then placed into the world.
// (cu, cy, cv) = centre, (sx, sy, sz) = size along local u, y, v; rotY rotates about the box centre.
export function box(batch, key, frame, cu, cy, cv, sx, sy, sz, { rotY = 0, vRef = 0 } = {}) {
  let g = new THREE.BoxGeometry(sx, sy, sz);
  _m.makeRotationY(rotY).setPosition(cu, cy, cv);
  g.applyMatrix4(_m);
  g = applyWorldUV(g, _t.makeTranslation(0, -vRef, 0));
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// Any geometry built around the local origin: transform to (u,y,v,rotY) in the frame, metre UVs by box projection.
export function placeGeo(batch, key, frame, geo, u, y, v, rotY = 0, { worldUV = true, vRef = 0, scale = null } = {}) {
  _m.makeRotationY(rotY).setPosition(u, y, v);
  if (scale) _m.scale(scale);
  geo.applyMatrix4(_m);
  let g = geo;
  if (worldUV) g = applyWorldUV(g, _t.makeTranslation(0, -vRef, 0));
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// Square pyramid (open base) of half-width hw and height h, base at y=0. Aligned with local axes.
export function pyramidGeo(hw, h, sides = 4) {
  const g = new THREE.ConeGeometry(hw * (sides === 4 ? Math.SQRT2 : 1), h, sides, 1, true);
  if (sides === 4) g.rotateY(Math.PI / 4);
  g.translate(0, h / 2, 0);
  return g;
}

// Gothic pinnacle: square shaft + spire; base at y=0, returns total height.
export function pinnacle(batch, key, frame, u, y, v, w, shaftH, spireH, rotY = 0) {
  box(batch, key, frame, u, y + shaftH / 2, v, w, shaftH, w, { rotY });
  placeGeo(batch, key, frame, pyramidGeo(w * 0.62, spireH), u, y + shaftH, v, rotY);
  // little gablets / crockets suggested by a wider collar under the spire
  box(batch, key, frame, u, y + shaftH + 0.08, v, w * 1.18, 0.16, w * 1.18, { rotY });
  return shaftH + spireH;
}

// ------------------------------------------------------------------ polygons (plan space, [u,v] points)
export function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
export function ensureCCW(ring) { return signedArea(ring) < 0 ? ring.slice().reverse() : ring.slice(); }

// Remove duplicate and collinear points.
export function cleanRing(ring, eps = 1e-3) {
  let pts = ring.filter((p, i) => { const q = ring[(i + 1) % ring.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > eps; });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) < eps * 10) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}

// Outward unit normal of edge a->b for a CCW ring ([u,v] math orientation).
export function edgeNormal(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  return [dz / l, -dx / l];
}

// Inset a CONVEX ring (CCW) by d metres (negative d = outset).
export function insetConvex(ring, d) {
  const n = ring.length, lines = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], [nx, nz] = edgeNormal(a, b);
    lines.push({ p: [a[0] - nx * d, a[1] - nz * d], d: [b[0] - a[0], b[1] - a[1]] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i + n - 1) % n], L2 = lines[i];
    const den = L1.d[0] * L2.d[1] - L1.d[1] * L2.d[0];
    if (Math.abs(den) < 1e-9) { out.push(L2.p.slice()); continue; }
    const t = ((L2.p[0] - L1.p[0]) * L2.d[1] - (L2.p[1] - L1.p[1]) * L2.d[0]) / den;
    out.push([L1.p[0] + L1.d[0] * t, L1.p[1] + L1.d[1] * t]);
  }
  return out;
}

export function pointInPoly(u, v, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > v) !== (zj > v) && u < ((xj - xi) * (v - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Distance from point to polygon boundary
export function distToRing(u, v, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], ex = ring[i][0] - ax, ez = ring[i][1] - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    let t = ((u - ax) * ex + (v - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(u - ax - ex * t, v - az - ez * t));
  }
  return best;
}

// ------------------------------------------------------------------ walls & caps (local frame)
// One vertical wall quad along plan edge a->b (outward normal on the right for CCW rings),
// from y0 to y1. UV: u = u0 + along * uScale, v = (y - vRef) * vScale.
export function wallQuad(batch, key, frame, a, b, y0, y1, { u0 = 0, uScale = 1, vRef = 0, vScale = 1, uvFn = null } = {}) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-4 || y1 - y0 < 1e-4) return null;
  const [nx, nz] = edgeNormal(a, b);
  // corners: A=(a,y0) B=(b,y0) C=(b,y1) D=(a,y1); outward-facing winding is A,C,B / A,D,C for CCW rings
  const P = [a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]];
  // u runs a->b, which is right-to-left seen from outside a CCW ring, so negate it to keep textures unmirrored
  const ua = -u0, ub = -(u0 + L * uScale);
  const uvq = uvFn ? uvFn(L) : [ua, (y0 - vRef) * vScale, ub, (y0 - vRef) * vScale, ub, (y1 - vRef) * vScale, ua, (y1 - vRef) * vScale];
  const idx = [0, 2, 1, 0, 3, 2];
  const pos = new Float32Array(18), nor = new Float32Array(18), uv = new Float32Array(12);
  idx.forEach((k, i) => {
    pos[i * 3] = P[k * 3]; pos[i * 3 + 1] = P[k * 3 + 1]; pos[i * 3 + 2] = P[k * 3 + 2];
    nor[i * 3] = nx; nor[i * 3 + 1] = 0; nor[i * 3 + 2] = nz;
    uv[i * 2] = uvq[k * 2]; uv[i * 2 + 1] = uvq[k * 2 + 1];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // the quad's winding may be mirrored for CW rings: fix by checking the geometric normal
  const ex = b[0] - a[0], ez = b[1] - a[1];
  // geometric normal of triangle (A, C, B) = (C-A) x (B-A) = (ez*h, 0, -ex*h)
  if (ez * nx - ex * nz < 0) {
    for (let i = 0; i < 18; i += 9) for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
    for (let i = 0; i < 12; i += 6) for (let k = 0; k < 2; k++) { const t = uv[i + 2 + k]; uv[i + 2 + k] = uv[i + 4 + k]; uv[i + 4 + k] = t; }
  }
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// Horizontal cap of a ring (with optional holes) at height y, facing up (or down). UV = plan metres.
export function cap(batch, key, frame, ring, y, { down = false, holes = [] } = {}) {
  const shape = new THREE.Shape(ring.map(([u, v]) => new THREE.Vector2(u, -v)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, -v))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  if (down) {
    g.scale(1, -1, 1); // flips winding & normal
    const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.computeVertexNormals();
  }
  g.translate(0, y, 0);
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// Horizontal ring band between an outer and an inner ring (same vertex count, both CCW), at height y.
export function bandCap(batch, key, frame, outer, inner, y, down = false) {
  const n = outer.length, pos = [];
  const want = down ? -1 : 1;
  const push = (p, q, r) => {
    // normal.y of triangle (p,q,r) in (u, y, v) space = (q-p) x (r-p) . y = dz1*dx2 - dx1*dz2
    const ny = (q[1] - p[1]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[1] - p[1]);
    if (Math.sign(ny) === want) pos.push(p[0], y, p[1], q[0], y, q[1], r[0], y, r[1]);
    else pos.push(p[0], y, p[1], r[0], y, r[1], q[0], y, q[1]);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    push(outer[i], outer[j], inner[j]);
    push(outer[i], inner[j], inner[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) { uv[i * 2] = pos[i * 3]; uv[i * 2 + 1] = -pos[i * 3 + 2]; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// Prism walls around a ring (CCW) from y0 to y1; continuous u along the perimeter.
export function ringWalls(batch, key, frame, ring, y0, y1, { vRef = 0, skip = null } = {}) {
  let u = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!skip || !skip(a, b, i)) wallQuad(batch, key, frame, a, b, y0, y1, { u0: u, vRef });
    u += L;
  }
}

// Gable roof prism along local u from u0..u1, centred at v=vc, eave height ye, ridge height yr, half span hs,
// overhang o. Slopes use the roof material; gable triangles are returned separately (caller may skip).
export function gableRoof(batch, key, frame, u0, u1, vc, hs, ye, yr, { overhang = 0.4, thick = 0.25, rotY = 0, cu = 0, cv = 0 } = {}) {
  const L = u1 - u0, h = yr - ye, o = overhang;
  const slope = Math.hypot(hs + o, h * (hs + o) / hs);
  // each slope as a thin box rotated about the ridge line
  const ang = Math.atan2(h, hs);
  for (const side of [-1, 1]) {
    const g = new THREE.BoxGeometry(L, thick, slope);
    g.translate(0, -thick / 2, side * slope / 2);
    g.rotateX(side * ang);
    g.translate((u0 + u1) / 2, yr, vc);
    if (rotY || cu || cv) { g.rotateY(rotY); g.translate(cu, 0, cv); }
    const gu = applyWorldUV(g);
    gu.applyMatrix4(frame.matrix);
    batch.add(key, gu);
  }
}

// Mono-pitch (lean-to) roof slab running along local v from v0..v1, sloping across u from the high edge
// (uHi, yHi) down to the low edge (uLo, yLo), with an overhang past the low edge.
export function leanTo(batch, key, frame, v0, v1, uHi, yHi, uLo, yLo, { overhang = 0.45, thick = 0.25 } = {}) {
  const run = Math.abs(uLo - uHi), drop = yHi - yLo;
  const len = Math.hypot(run, drop) + overhang;
  const g = new THREE.BoxGeometry(len, thick, v1 - v0);
  g.translate(len / 2, -thick / 2, 0); // hinge on the high edge, slab extends along +x
  g.rotateZ(-Math.atan2(drop, run));
  if (uLo < uHi) g.rotateY(Math.PI);
  g.translate(uHi, yHi, (v0 + v1) / 2);
  const gu = applyWorldUV(g);
  gu.applyMatrix4(frame.matrix);
  return batch.add(key, gu);
}

// Vertical triangle in the plane of plan edge a->b (outward normal on the right of a CCW ring), from y0 at a and b
// up to apexY at the middle: the gable above a wall. Metre UVs by box projection (v from vRef).
export function gableTri(batch, key, frame, a, b, y0, apexY, { vRef = 0 } = {}) {
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [nx, nz] = edgeNormal(a, b);
  let P = [[a[0], y0, a[1]], [b[0], y0, b[1]], [m[0], apexY, m[1]]];
  // winding: geometric normal (P1-P0) x (P2-P0) must point along the outward normal
  const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
  const cx = e1[1] * e2[2] - e1[2] * e2[1], cz = e1[0] * e2[1] - e1[1] * e2[0];
  if (cx * nx + cz * nz < 0) P = [P[0], P[2], P[1]];
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3));
  g.computeVertexNormals();
  g = applyWorldUV(g, _t.makeTranslation(0, -vRef, 0));
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// Pointed-arch outline (as THREE.Vector2 points) of span w, springing height hs, lancet factor k (radius / span),
// centred at x=0, y from 0.
export function archShapePts(w, hs, k = 1, seg = 8) {
  const R = Math.max(0.5, k) * w, hA = Math.sqrt(R * R - (R - w / 2) ** 2);
  const pts = [new THREE.Vector2(w / 2, 0), new THREE.Vector2(w / 2, hs)];
  // right arc: centre (w/2 - R, hs), from angle 0 up to apex
  const aR = Math.atan2(hA, R - w / 2);
  for (let i = 1; i <= seg; i++) { const t = (aR * i) / seg; pts.push(new THREE.Vector2(w / 2 - R + R * Math.cos(t), hs + R * Math.sin(t))); }
  for (let i = seg - 1; i >= 0; i--) { const t = (aR * i) / seg; pts.push(new THREE.Vector2(-w / 2 + R - R * Math.cos(t), hs + R * Math.sin(t))); }
  pts.push(new THREE.Vector2(-w / 2, 0));
  return pts;
}

// A Gothic portal on a wall: stone frame with a pointed opening, dark recessed doors, gablet + pinnacles.
// (u,v) = point on the wall line, n = outward normal [nu,nv], y0 = ground. Returns the frame height.
export function portal(batch, frame, { u, v, n, y0, w = 4.0, hs = 6.0, depth = 1.4, k = 1, stone = 'cathStone', dark = 'dark', gablet = true }) {
  const rot = Math.atan2(n[0], n[1]); // local +Z of the portal -> outward normal
  const R = Math.max(0.5, k) * w, hA = Math.sqrt(R * R - (R - w / 2) ** 2);
  const outerW = w + 1.6, outerH = hs + hA + 1.2;
  // frame: rectangle with a pointed hole, extruded outward
  const shape = new THREE.Shape([
    new THREE.Vector2(-outerW / 2, 0), new THREE.Vector2(outerW / 2, 0),
    new THREE.Vector2(outerW / 2, outerH), new THREE.Vector2(-outerW / 2, outerH),
  ]);
  shape.holes.push(new THREE.Path(archShapePts(w, hs, k).reverse()));
  const fg = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  placeGeo(batch, stone, frame, fg, u, y0, v, rot, { vRef: y0 });
  // recessed dark doors (slightly behind the frame's outer face)
  const dg = new THREE.ShapeGeometry(new THREE.Shape(archShapePts(w, hs, k)));
  placeGeo(batch, dark, frame, dg, u + n[0] * 0.25, y0, v + n[1] * 0.25, rot, { worldUV: false });
  // inner reveal (orders): a second, smaller arch ring set back
  const shape2 = new THREE.Shape(archShapePts(w + 0.5, hs, k));
  shape2.holes.push(new THREE.Path(archShapePts(w, hs, k).reverse()));
  const og = new THREE.ExtrudeGeometry(shape2, { depth: depth * 0.6, bevelEnabled: false, curveSegments: 6 });
  placeGeo(batch, stone, frame, og, u + n[0] * 0.2, y0, v + n[1] * 0.2, rot, { vRef: y0 });
  // carved tympanum filling the arch head, lintel and central trumeau: the doors show only below the lintel
  const doorH = Math.min(hs - 0.3, 4.2);
  const head = archShapePts(w, hs, k);
  const tym = new THREE.Shape([new THREE.Vector2(w / 2, doorH), ...head.slice(1, -1), new THREE.Vector2(-w / 2, doorH)]);
  const tg = new THREE.ExtrudeGeometry(tym, { depth: 0.12, bevelEnabled: false, curveSegments: 6 });
  placeGeo(batch, stone, frame, tg, u + n[0] * 0.27, y0, v + n[1] * 0.27, rot, { vRef: y0 });
  // blind trefoil in the tympanum
  const tre = new THREE.ShapeGeometry(new THREE.Shape(archShapePts(w * 0.36, 0.3, 1).map((p) => new THREE.Vector2(p.x, p.y + doorH + (hs - doorH) * 0.35))));
  placeGeo(batch, dark, frame, tre, u + n[0] * 0.4, y0, v + n[1] * 0.4, rot, { worldUV: false });
  box(batch, stone, frame, u + n[0] * 0.42, y0 + doorH + 0.18, v + n[1] * 0.42, w + 0.1, 0.36, 0.34, { rotY: rot, vRef: y0 });
  box(batch, stone, frame, u + n[0] * 0.42, y0 + doorH / 2, v + n[1] * 0.42, 0.42, doorH, 0.34, { rotY: rot, vRef: y0 });
  if (gablet) {
    // crocketed gablet: a thin triangular prism above the arch
    const tri = new THREE.Shape([new THREE.Vector2(-outerW / 2, 0), new THREE.Vector2(outerW / 2, 0), new THREE.Vector2(0, outerW * 0.75)]);
    const tg2 = new THREE.ExtrudeGeometry(tri, { depth: 0.5, bevelEnabled: false });
    placeGeo(batch, stone, frame, tg2, u + n[0] * (depth - 0.5), y0 + outerH, v + n[1] * (depth - 0.5), rot, { vRef: y0 });
    // flanking pinnacles
    const tu = [-n[1], n[0]];
    for (const s of [-1, 1]) {
      const pu = u + tu[0] * s * (outerW / 2 + 0.3) + n[0] * depth * 0.5, pv = v + tu[1] * s * (outerW / 2 + 0.3) + n[1] * depth * 0.5;
      box(batch, stone, frame, pu, y0 + outerH / 2, pv, 0.7, outerH, 0.7, { rotY: rot, vRef: y0 });
      pinnacle(batch, stone, frame, pu, y0 + outerH, pv, 0.6, 1.2, 2.4, rot);
    }
  }
  return outerH;
}

// Triangular gable wall in the plane u = uAt (facing +u if dir>0), spanning v in [vc-hs, vc+hs], from ye to apex yr.
export function gableTriangle(batch, key, frame, uAt, vc, hs, ye, yr, dir, uvFn) {
  const pts = dir > 0
    ? [[uAt, ye, vc + hs], [uAt, ye, vc - hs], [uAt, yr, vc]]
    : [[uAt, ye, vc - hs], [uAt, ye, vc + hs], [uAt, yr, vc]];
  const pos = new Float32Array(pts.flat());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const uv = new Float32Array(6);
  pts.forEach((p, i) => { const [a, b] = uvFn ? uvFn(p) : [p[2], p[1]]; uv[i * 2] = a; uv[i * 2 + 1] = b; });
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// Lathe around local Y with metre UVs (u = arc length at radius, v = height).
export function latheGeo(profile, segments = 24) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  const g = new THREE.LatheGeometry(pts, segments);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    uv.setXY(i, uv.getX(i) * Math.PI * 2 * Math.max(r, 0.3), y);
  }
  return g;
}

export { applyWorldUV };
