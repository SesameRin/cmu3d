// Geometry kit for the East Liberty / Penn Avenue landmarks (East Liberty Presbyterian Church, Motor Square Garden,
// Highland Building, ...). Everything is modelled in a landmark-local plan frame (u = local +X, v = local +Z, y up)
// and transformed to world space before merging by material, so each landmark is a handful of static meshes.
// UVs are metres (see core/materials.js): walls get u = metres along the wall, v = metres above a reference height;
// "atlas" pieces (windows, doors, signs) carry 0..1 UVs remapped into a cell of a shared texture atlas.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyWorldUV } from '../../core/materials.js';

const KEEP = new Set(['position', 'normal', 'uv']);
export const DEG = Math.PI / 180;

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
// Local (u, v) -> world (x, z): world = origin + u*(cos a, sin a) + v*(-sin a, cos a). Equivalent to an Object3D at
// `origin` with rotation.y = -a (world z points south, so a positive angle turns +u from east towards south).
export function makeFrame(ox, oz, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const matrix = new THREE.Matrix4().makeRotationY(-angle).setPosition(ox, 0, oz);
  return {
    ox, oz, angle, c, s, matrix,
    toWorld(u, v) { return [ox + u * c - v * s, oz + u * s + v * c]; },
    toLocal(x, z) { const dx = x - ox, dz = z - oz; return [dx * c + dz * s, -dx * s + dz * c]; },
  };
}

// ------------------------------------------------------------------ batching
// Geometries collected by material key; build() merges each list into one static mesh.
export class Batch {
  constructor(tag = 'pennAve') { this.lists = new Map(); this.tris = 0; this.tag = tag; }
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
      if (!mat || !list.length) { if (!mat) console.warn(`[${this.tag}] missing material`, key); continue; }
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) { console.warn(`[${this.tag}] merge failed for`, key); continue; }
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${this.tag}:${key}`;
      mesh.castShadow = castShadow && !noShadow.includes(key);
      mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.lists.clear();
    return group;
  }
}

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();

// ------------------------------------------------------------------ primitives (local frame)
// Box centred at (cu, cy, cv), sizes along local u / y / v, rotated rotY about its centre; metre UVs (v from vRef).
export function box(batch, key, frame, cu, cy, cv, sx, sy, sz, { rotY = 0, vRef = 0 } = {}) {
  let g = new THREE.BoxGeometry(sx, sy, sz);
  _m.makeRotationY(rotY).setPosition(cu, cy, cv);
  g.applyMatrix4(_m);
  g = applyWorldUV(g, _t.makeTranslation(0, -vRef, 0));
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// Box spanning y0..y1 (bottom/top) - convenience for piers, buttresses, walls.
export function boxY(batch, key, frame, cu, cv, sx, sz, y0, y1, opts) {
  if (y1 - y0 < 1e-3) return null;
  return box(batch, key, frame, cu, (y0 + y1) / 2, cv, sx, y1 - y0, sz, opts);
}

// Any geometry built around its own origin: placed at (u, y, v) with rotY; metre UVs by box projection unless worldUV=false.
export function placeGeo(batch, key, frame, geo, u, y, v, rotY = 0, { worldUV = true, vRef = 0, scale = null } = {}) {
  _m.makeRotationY(rotY).setPosition(u, y, v);
  if (scale) _m.scale(scale);
  geo.applyMatrix4(_m);
  let g = geo;
  if (worldUV) g = applyWorldUV(g, _t.makeTranslation(0, -vRef, 0));
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// Faceted copy (flat normals) - polygonal stonework should read as faceted, not smooth.
export function flat(g) { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; }

// Pyramid (open base) with `sides` faces, base half-width hw (apothem for 4 sides), height h, base at y = 0.
export function pyramidGeo(hw, h, sides = 4) {
  const r = sides === 4 ? hw * Math.SQRT2 : hw / Math.cos(Math.PI / sides);
  const g = new THREE.ConeGeometry(r, h, sides, 1, true);
  g.rotateY(Math.PI / sides);
  g.translate(0, h / 2, 0);
  return flat(g);
}

// Regular prism (e.g. octagonal turret) of apothem a from y0 to y1, faces aligned with the local axes.
export function prismGeo(a, y0, y1, sides = 8, capTop = true) {
  const r = a / Math.cos(Math.PI / sides);
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, sides, 1, !capTop);
  g.rotateY(Math.PI / sides);
  g.translate(0, (y0 + y1) / 2, 0);
  return flat(g);
}

// Tapering prism (frustum) with `sides` faces, apothems a0 (bottom) -> a1 (top).
export function frustumGeo(a0, a1, y0, y1, sides = 8, open = false) {
  const k = 1 / Math.cos(Math.PI / sides);
  const g = new THREE.CylinderGeometry(a1 * k, a0 * k, y1 - y0, sides, 1, open);
  g.rotateY(Math.PI / sides);
  g.translate(0, (y0 + y1) / 2, 0);
  return flat(g);
}

// Gothic pinnacle: square shaft w x shaftH with a gabled collar, then a 4-sided spirelet (crockets suggested by a
// second, smaller collar). Base at y. Returns the tip height above y.
export function pinnacle(batch, key, frame, u, y, v, w, shaftH, spireH, rotY = 0) {
  box(batch, key, frame, u, y + shaftH / 2, v, w, shaftH, w, { rotY });
  box(batch, key, frame, u, y + shaftH + 0.07, v, w * 1.22, 0.14, w * 1.22, { rotY });
  placeGeo(batch, key, frame, pyramidGeo(w * 0.55, spireH), u, y + shaftH, v, rotY);
  if (spireH > 1.6) box(batch, key, frame, u, y + shaftH + spireH * 0.45, v, w * 0.62, 0.1, w * 0.62, { rotY });
  return shaftH + spireH;
}

// ------------------------------------------------------------------ polygons (plan space, [u,v] points)
export function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
export function ensureCCW(ring) { return signedArea(ring) < 0 ? ring.slice().reverse() : ring.slice(); }
export function edgeNormal(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  return [dz / l, -dx / l];
}
export function rect(u0, u1, v0, v1) {
  return ensureCCW([[Math.min(u0, u1), Math.min(v0, v1)], [Math.max(u0, u1), Math.min(v0, v1)], [Math.max(u0, u1), Math.max(v0, v1)], [Math.min(u0, u1), Math.max(v0, v1)]]);
}
export function pointInPoly(u, v, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > v) !== (zj > v) && u < ((xj - xi) * (v - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------------ walls & caps
// One vertical wall quad along plan edge a->b (outward normal on the right of a CCW ring), y0..y1.
// UV: u = -(u0 + along) (unmirrored seen from outside), v = y - vRef.
export function wallQuad(batch, key, frame, a, b, y0, y1, { u0 = 0, vRef = 0, uScale = 1 } = {}) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-4 || y1 - y0 < 1e-4) return null;
  const [nx, nz] = edgeNormal(a, b);
  const ua = -u0, ub = -(u0 + L * uScale);
  // A=(a,y0) B=(b,y0) C=(b,y1) D=(a,y1) -> triangles A C B, A D C face outward for a CCW ring
  const P = [a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]];
  const UV = [ua, y0 - vRef, ub, y0 - vRef, ub, y1 - vRef, ua, y1 - vRef];
  const idx = [0, 2, 1, 0, 3, 2];
  const pos = new Float32Array(18), nor = new Float32Array(18), uv = new Float32Array(12);
  idx.forEach((k, i) => {
    pos[i * 3] = P[k * 3]; pos[i * 3 + 1] = P[k * 3 + 1]; pos[i * 3 + 2] = P[k * 3 + 2];
    nor[i * 3] = nx; nor[i * 3 + 2] = nz;
    uv[i * 2] = UV[k * 2]; uv[i * 2 + 1] = UV[k * 2 + 1];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// A wall quad along a->b (outward normal on the right) from y0 to y1 with arch-shaped (k > 0) or rectangular (k = 0)
// openings cut through it: holes = [{ at: metres from a, y0, w, hs, k }]. Metre UVs, v from vRef.
export function wallWithHoles(batch, key, frame, a, b, y0, y1, holes, { vRef = 0 } = {}) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const sh = new THREE.Shape([new THREE.Vector2(0, y0), new THREE.Vector2(L, y0), new THREE.Vector2(L, y1), new THREE.Vector2(0, y1)]);
  for (const h of holes) {
    const x = L - h.at;          // shape x runs from b (0) to a (L) so the basis (x, up, normal) is right-handed
    const pts = h.k > 0 ? archPts(h.w, h.hs, h.k, 10).pts : [new THREE.Vector2(-h.w / 2, 0), new THREE.Vector2(h.w / 2, 0), new THREE.Vector2(h.w / 2, h.hs), new THREE.Vector2(-h.w / 2, h.hs)];
    sh.holes.push(new THREE.Path(pts.map((p) => new THREE.Vector2(x + p.x, h.y0 + p.y))));
  }
  let g = new THREE.ShapeGeometry(sh, 10);
  const dx = (a[0] - b[0]) / L, dz = (a[1] - b[1]) / L, [nx, nz] = edgeNormal(a, b);
  _m.set(dx, 0, nx, b[0], 0, 1, 0, 0, dz, 0, nz, b[1], 0, 0, 0, 1);
  g.applyMatrix4(_m);
  g = applyWorldUV(g, _t.makeTranslation(0, -vRef, 0));
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// Prism walls around a CCW ring from y0 to y1, continuous u along the perimeter. skip(a, b, i) omits edges.
export function ringWalls(batch, key, frame, ring, y0, y1, { vRef = 0, skip = null, u0 = 0 } = {}) {
  let u = u0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!skip || !skip(a, b, i)) wallQuad(batch, key, frame, a, b, y0, y1, { u0: u, vRef });
    u += L;
  }
}

// Horizontal cap of a ring (holes allowed) at height y facing up (or down). UV = plan metres.
export function cap(batch, key, frame, ring, y, { down = false, holes = [] } = {}) {
  const shape = new THREE.Shape(ring.map(([u, v]) => new THREE.Vector2(u, -v)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, -v))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  if (down) {
    g.scale(1, -1, 1);
    const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.computeVertexNormals();
  }
  g.translate(0, y, 0);
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// Vertical triangle above plan edge a->b: from y0 at both ends up to apexY at the middle (a gable end).
export function gableTri(batch, key, frame, a, b, y0, apexY, { vRef = 0 } = {}) {
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [nx, nz] = edgeNormal(a, b);
  let P = [[a[0], y0, a[1]], [b[0], y0, b[1]], [m[0], apexY, m[1]]];
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

// Dual-pitch roof over an axis-aligned plan rectangle: ridge along local u (alongU) or v, eave height ye, ridge yr,
// overhang o. Slopes are thin slabs; optional gable triangles in `wallKey` at both ends.
export function gableRoof(batch, key, frame, u0, u1, v0, v1, ye, yr, { alongU = true, overhang = 0.35, thick = 0.22, wallKey = null, vRef = 0, ends = [true, true] } = {}) {
  const L = alongU ? u1 - u0 : v1 - v0, span = alongU ? v1 - v0 : u1 - u0, hs = span / 2, h = yr - ye;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const ang = Math.atan2(h, hs), slope = Math.hypot(hs, h) + overhang / Math.cos(ang);
  for (const side of [-1, 1]) {
    const g = new THREE.BoxGeometry(L + (ends[0] || ends[1] ? overhang * 0.6 : 0), thick, slope);
    g.translate(0, -thick / 2, side * slope / 2);
    g.rotateX(side * ang);
    g.translate(0, yr, 0);
    if (!alongU) g.rotateY(Math.PI / 2);
    g.translate(cu, 0, cv);
    const gu = applyWorldUV(g);
    gu.applyMatrix4(frame.matrix);
    batch.add(key, gu);
  }
  if (wallKey) {
    if (alongU) {
      if (ends[0]) gableTri(batch, wallKey, frame, [u0, v1], [u0, v0], ye, yr, { vRef });
      if (ends[1]) gableTri(batch, wallKey, frame, [u1, v0], [u1, v1], ye, yr, { vRef });
    } else {
      if (ends[0]) gableTri(batch, wallKey, frame, [u0, v0], [u1, v0], ye, yr, { vRef });
      if (ends[1]) gableTri(batch, wallKey, frame, [u1, v1], [u0, v1], ye, yr, { vRef });
    }
  }
}

// Hipped roof over an axis-aligned rectangle (4 sloped faces meeting at a ridge along the long side).
export function hipRoof(batch, key, frame, u0, u1, v0, v1, ye, yr, overhang = 0.35) {
  u0 -= overhang; u1 += overhang; v0 -= overhang; v1 += overhang;
  const lu = u1 - u0, lv = v1 - v0, alongU = lu >= lv;
  const half = Math.min(lu, lv) / 2, h = yr - ye + overhang * (yr - ye) / Math.max(0.1, half - overhang);
  const y0 = yr - h;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const r0 = alongU ? [u0 + half, cv] : [cu, v0 + half], r1 = alongU ? [u1 - half, cv] : [cu, v1 - half];
  const A = [u0, y0, v0], B = [u1, y0, v0], C = [u1, y0, v1], D = [u0, y0, v1];
  const R0 = [r0[0], yr, r0[1]], R1 = [r1[0], yr, r1[1]];
  const tris = alongU
    ? [[A, R0, R1], [A, R1, B], [B, R1, C], [C, R1, R0], [C, R0, D], [D, R0, A]]
    : [[A, R0, B], [B, R0, R1], [B, R1, C], [C, R1, D], [D, R1, R0], [D, R0, A]];
  const pos = [];
  for (const [p, q, r] of tris) {
    // keep faces pointing up
    const ny = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
    if (ny >= 0) pos.push(...p, ...q, ...r); else pos.push(...p, ...r, ...q);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g = applyWorldUV(g);
  g.applyMatrix4(frame.matrix);
  return batch.add(key, g);
}

// ------------------------------------------------------------------ arches & atlas pieces
// Pointed-arch outline (THREE.Vector2, CCW) of span w springing at hs; k = radius / span (0.5 = semicircle, 1 =
// equilateral lancet). Returns { pts, apex }.
export function archPts(w, hs, k = 1, seg = 8) {
  const R = Math.max(0.5, k) * w, apex = Math.sqrt(Math.max(0, R * R - (R - w / 2) ** 2));
  const pts = [new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(w / 2, hs)];
  const aR = Math.atan2(apex, R - w / 2);
  for (let i = 1; i <= seg; i++) { const t = (aR * i) / seg; pts.push(new THREE.Vector2(w / 2 - R + R * Math.cos(t), hs + R * Math.sin(t))); }
  for (let i = seg - 1; i >= 0; i--) { const t = (aR * i) / seg; pts.push(new THREE.Vector2(-w / 2 + R - R * Math.cos(t), hs + R * Math.sin(t))); }
  return { pts, apex };
}
export function archApex(w, k = 1) { const R = Math.max(0.5, k) * w; return Math.sqrt(Math.max(0, R * R - (R - w / 2) ** 2)); }

// Remap a geometry's shape-space UVs (x in -w/2..w/2, y in 0..h) into atlas cell [u0, v0, u1, v1].
function atlasUV(g, w, h, cell) {
  const uv = g.attributes.uv, pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    uv.setXY(i, cell[0] + ((x + w / 2) / w) * (cell[2] - cell[0]), cell[1] + (y / h) * (cell[3] - cell[1]));
  }
  uv.needsUpdate = true;
}

// A window/door piece on a wall plane: an arch-shaped (or rectangular: k = 0) flat panel textured from an atlas cell.
// (u, v) = foot of the panel on the wall line, n = outward normal [nu, nv], y0 = sill height, w = width,
// hs = springing height above the sill. `out` pushes it off the wall plane to avoid z-fighting.
export function atlasPanel(batch, key, frame, cell, { u, v, n, y0, w, hs, k = 1, out = 0.03, seg = 8 }) {
  const rot = Math.atan2(n[0], n[1]);
  let shape, h;
  if (k > 0) { const a = archPts(w, hs, k, seg); shape = new THREE.Shape(a.pts); h = hs + a.apex; }
  else { h = hs; shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(w / 2, h), new THREE.Vector2(-w / 2, h)]); }
  const g = new THREE.ShapeGeometry(shape, 1);
  atlasUV(g, w, h, cell);
  return placeGeo(batch, key, frame, g, u + n[0] * out, y0, v + n[1] * out, rot, { worldUV: false });
}

// Circular panel (rose window, clock, logo) of radius r centred at (u, y, v) on a wall facing n.
export function atlasDisc(batch, key, frame, cell, { u, v, n, y, r, out = 0.03, seg = 24 }) {
  const rot = Math.atan2(n[0], n[1]);
  const g = new THREE.CircleGeometry(r, seg);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, cell[0] + uv.getX(i) * (cell[2] - cell[0]), cell[1] + uv.getY(i) * (cell[3] - cell[1]));
  return placeGeo(batch, key, frame, g, u + n[0] * out, y, v + n[1] * out, rot, { worldUV: false });
}

// Moulded stone surround of an arch opening (hood + jambs): an extruded ring `t` wide and `d` deep.
export function archFrame(batch, key, frame, { u, v, n, y0, w, hs, k = 1, t = 0.3, d = 0.25, seg = 6, vRef = 0 }) {
  const rot = Math.atan2(n[0], n[1]);
  let sh;
  if (k > 0) {
    // keep the arch centres of inner and outer curves at the same springing points so the ring stays even
    const R = Math.max(0.5, k) * w, Ro = R + t;
    const pts = [];
    const cxR = w / 2 - R, apexA = Math.atan2(archApex(w, k), R - w / 2);
    pts.push(new THREE.Vector2(-w / 2 - t, 0), new THREE.Vector2(w / 2 + t, 0), new THREE.Vector2(w / 2 + t, hs));
    for (let i = 1; i <= seg; i++) { const a = (apexA * i) / seg; pts.push(new THREE.Vector2(cxR + Ro * Math.cos(a), hs + Ro * Math.sin(a))); }
    for (let i = seg - 1; i >= 0; i--) { const a = (apexA * i) / seg; pts.push(new THREE.Vector2(-cxR - Ro * Math.cos(a), hs + Ro * Math.sin(a))); }
    sh = new THREE.Shape(pts);
    sh.holes.push(new THREE.Path(archPts(w, hs, k, seg).pts.reverse()));
  } else {
    sh = new THREE.Shape([new THREE.Vector2(-w / 2 - t, 0), new THREE.Vector2(w / 2 + t, 0), new THREE.Vector2(w / 2 + t, hs + t), new THREE.Vector2(-w / 2 - t, hs + t)]);
    sh.holes.push(new THREE.Path([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(-w / 2, hs), new THREE.Vector2(w / 2, hs), new THREE.Vector2(w / 2, 0)]));
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false, curveSegments: seg });
  return placeGeo(batch, key, frame, g, u, y0, v, rot, { vRef });
}

// Lathe around local Y with metre UVs (u = arc length at radius, v = height). profile: [[r, y], ...].
export function latheGeo(profile, segments = 24) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  const g = new THREE.LatheGeometry(pts, segments);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    uv.setXY(i, uv.getX(i) * Math.PI * 2 * Math.max(r, 0.3), pos.getY(i));
  }
  return g;
}

// ------------------------------------------------------------------ ground & runtime helpers
// Lowest / highest terrain under a set of plan points (local), sampled on edges too.
export function groundRange(ctx, frame, ring, step = 4) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, [x, z] = frame.toWorld(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      const h = ctx.heightAt(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
  }
  return { lo, hi };
}

// Show `detail` only while the camera is within `near` metres of (x, z) (and `main` within `far`, when given).
// Checked every few frames - it only toggles `visible`.
export function distanceCull(ctx, { x, z, detail = null, near = 600, main = null, far = Infinity }) {
  if (!ctx.onUpdate || (!detail && !main)) return;
  let frameN = 0;
  ctx.onUpdate(() => {
    if ((frameN++ & 7) !== 0) return;
    const cam = ctx.camera?.position;
    if (!cam) return;
    const d = Math.hypot(cam.x - x, cam.z - z);
    let changed = false;
    if (detail && detail.visible !== d < near) { detail.visible = d < near; changed = true; }
    if (main && main.visible !== d < far) { main.visible = d < far; changed = true; }
    if (changed) ctx.env?.refreshShadows?.();      // static casters appeared / vanished
  }, 20);
}

export { applyWorldUV };
