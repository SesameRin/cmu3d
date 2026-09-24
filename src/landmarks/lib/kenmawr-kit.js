// Geometry helpers for the Shady Avenue landmarks (kenmawr.js): planar walls with real openings of any outline
// (rectangular apartment windows, Gothic lancets, pointed portals), stepped buttresses, pinnacles, octagonal
// spires and turrets, gabled / lean-to roofs in a local building frame, and the LOD + deferred-detail plumbing.
// Built on the shared MeshKit (north-kit.js): triangles are collected per material key and merged into one mesh
// per material, so each building level costs as many draw calls as it has materials.
//
// Conventions (ARCHITECTURE.md): x = east, z = south, y = up. Rings are [[x,z],...]. Wall UVs are metres
// (u along the wall, v = y - vRef).
import * as THREE from 'three';
import { MeshKit, ccw, pointInRing, ringCentroid, prng, insetRing, signedArea } from './north-kit.js';
import { makeLOD, deferRefine } from './icons-common.js';

export { MeshKit, ccw, pointInRing, ringCentroid, prng, insetRing, signedArea, makeLOD, deferRefine };

const V2 = (p) => new THREE.Vector2(p[0], p[1]);

// ------------------------------------------------------------------ frames
// Edge frame for a wall line a→b. `out` = outward normal [nx,0,nz] (default: the CCW-ring convention).
// P(s, off) → [x,z] at s metres along the edge, off metres outwards; P3(s, y, off) → [x,y,z].
export function edge(a, b, out = null) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n = out || [dir[1], 0, -dir[0]];
  return {
    a, b, L, dir, n, dir3: [dir[0], 0, dir[1]],
    rot: Math.atan2(-dir[1], dir[0]),                // kit.box rotY: local +x along the edge, local +z inwards
    P: (s, off = 0) => [a[0] + dir[0] * s + n[0] * off, a[1] + dir[1] * s + n[2] * off],
    P3: (s, y, off = 0) => [a[0] + dir[0] * s + n[0] * off, y, a[1] + dir[1] * s + n[2] * off],
  };
}
// Outward normal of edge a-b of an arbitrary ring (probe test).
export function outwardOf(ring, a, b) {
  const E = edge(a, b);
  const [x, z] = E.P(E.L / 2, 0.25);
  return pointInRing(x, z, ring) ? [-E.n[0], 0, -E.n[2]] : E.n;
}

// Local building frame: u along `dirU`, v along `dirV` (both unit [x,z]); W(u,v) → [x,z], P(u,v,y) → [x,y,z].
export function frame(O, dirU, dirV) {
  const W = (u, v) => [O[0] + dirU[0] * u + dirV[0] * v, O[1] + dirU[1] * u + dirV[1] * v];
  return {
    O, U: dirU, V: dirV, W,
    P: (u, v, y) => { const [x, z] = W(u, v); return [x, y, z]; },
    D3: (du, dv) => [dirU[0] * du + dirV[0] * dv, 0, dirU[1] * du + dirV[1] * dv],   // world direction of a local vector
    toLocal: (x, z) => { const dx = x - O[0], dz = z - O[1]; return [dx * dirU[0] + dz * dirU[1], dx * dirV[0] + dz * dirV[1]]; },
    rotY: Math.atan2(-dirU[1], dirU[0]),             // three.js rotation.y mapping local +x onto dirU
    // edge from local (u0,v0) to (u1,v1) whose outside is the local direction (ou, ov)
    edge(u0, v0, u1, v1, ou, ov) {
      const d = this.D3(ou, ov), l = Math.hypot(d[0], d[2]);
      return edge(W(u0, v0), W(u1, v1), [d[0] / l, 0, d[2] / l]);
    },
    rect: (u0, u1, v0, v1) => [W(u0, v0), W(u1, v0), W(u1, v1), W(u0, v1)],
  };
}

// ------------------------------------------------------------------ 2D outlines (edge coordinates s, y)
export const rectPts = (s0, s1, y0, y1) => [[s0, y0], [s1, y0], [s1, y1], [s0, y1]];
// Pointed (two-centred) arch opening from sill yb, springing at ys: radius = k × width (k = 1 equilateral,
// > 1 lancet, < 1 drop arch, 0.5 round). seg points per side.
export function lancetPts(s0, s1, yb, ys, { k = 1, seg = 5 } = {}) {
  const w = s1 - s0, R = Math.max(w / 2, k * w);
  const pts = [[s0, yb], [s1, yb], [s1, ys]];
  // right side: centre at (s1 - R, ys) going from angle 0 up to the apex
  const aTop = Math.acos((R - w / 2) / R);
  for (let i = 1; i <= seg; i++) { const a = (aTop * i) / seg; pts.push([s1 - R + Math.cos(a) * R, ys + Math.sin(a) * R]); }
  // left side: centre at (s0 + R, ys), from the apex down to angle π
  for (let i = seg - 1; i >= 1; i--) { const a = (aTop * i) / seg; pts.push([s0 + R - Math.cos(a) * R, ys + Math.sin(a) * R]); }
  pts.push([s0, ys]);
  return pts;
}
export function lancetApex(w, ys, k = 1) { const R = Math.max(w / 2, k * w); return ys + Math.sqrt(R * R - (R - w / 2) ** 2); }
// Semicircular-headed opening (round arch)
export function roundPts(s0, s1, yb, ys, seg = 8) {
  const r = (s1 - s0) / 2, c = (s0 + s1) / 2, pts = [[s0, yb], [s1, yb]];
  for (let i = 0; i <= seg; i++) { const a = (Math.PI * i) / seg; pts.push([c + Math.cos(a) * r, ys + Math.sin(a) * r]); }
  return pts;
}
function polyCentroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
function bbox(pts) {
  let s0 = Infinity, s1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [s, y] of pts) { s0 = Math.min(s0, s); s1 = Math.max(s1, s); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { s0, s1, y0, y1 };
}

// ------------------------------------------------------------------ planar wall with openings
// Wall piece in the plane of edge E: `outline` [[s,y],...] (any orientation) minus the `holes`. Each hole:
//   { pts:[[s,y]...], depth (m, default 0.25), glass: key|null, glassUV: 'metre'|'box'|[u0,v0,u1,v1],
//     reveal: key (default o.revealKey || key), back: key (flat back panel instead of glass), off (glass inset) }
// o: { vRef = 0, uStart = 0, off = 0 (wall plane offset outwards), revealKey }
export function holedWall(kit, key, E, outline, holes = [], o = {}) {
  const vRef = o.vRef ?? 0, uStart = o.uStart ?? 0, off = o.off ?? 0;
  const contour = outline.map(V2), hv = holes.map((h) => h.pts.map(V2));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(contour, hv); } catch { tris = []; }
  const all = contour.concat(...hv);
  const n = E.n;
  for (const [i, j, k] of tris) {
    const A = all[i], B = all[j], C = all[k];
    kit.tri(key, E.P3(A.x, A.y, off), E.P3(B.x, B.y, off), E.P3(C.x, C.y, off), n,
      [uStart + A.x, A.y - vRef], [uStart + B.x, B.y - vRef], [uStart + C.x, C.y - vRef]);
  }
  for (const h of holes) opening(kit, key, E, h, { ...o, off });
}

// Reveals + glass of one opening (also usable on its own for openings in walls built another way).
export function opening(kit, key, E, h, o = {}) {
  const off = o.off ?? 0, d = h.depth ?? 0.25, pts = h.pts, rk = h.reveal || o.revealKey || key;
  const [cs, cy] = polyCentroid(pts);
  let run = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const ds = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(ds, dy);
    if (L < 1e-4) continue;
    let ms = -dy / L, my = ds / L;
    if (ms * (cs - (p[0] + q[0]) / 2) + my * (cy - (p[1] + q[1]) / 2) < 0) { ms = -ms; my = -my; }
    const nrm = [E.dir[0] * ms, my, E.dir[1] * ms];
    kit.quad(rk, E.P3(p[0], p[1], off), E.P3(q[0], q[1], off), E.P3(q[0], q[1], off - d), E.P3(p[0], p[1], off - d), nrm,
      [run, 0], [run + L, 0], [run + L, d], [run, d]);
    run += L;
  }
  const gk = h.glass || h.back;
  if (!gk) return;
  const gOff = off - d + (h.glassInset ?? 0.02);
  const tris = convexTris(pts);
  if (!tris) return;
  const bb = bbox(pts);
  const uvOf = (s, y) => {
    const m = h.glassUV || 'metre';
    if (m === 'metre') return [(h.uStart ?? 0) + s, y - (h.vRef ?? o.vRef ?? 0)];
    const fu = (s - bb.s0) / (bb.s1 - bb.s0 || 1), fv = (y - bb.y0) / (bb.y1 - bb.y0 || 1);
    if (m === 'box') return [fu, fv];
    const [u0, v0, u1, v1] = m;
    return [u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv];
  };
  for (const [i, j, k] of tris) {
    const A = pts[i], B = pts[j], C = pts[k];
    kit.tri(gk, E.P3(A[0], A[1], gOff), E.P3(B[0], B[1], gOff), E.P3(C[0], C[1], gOff), E.n, uvOf(A[0], A[1]), uvOf(B[0], B[1]), uvOf(C[0], C[1]));
  }
}

// Triangles of a simple polygon: a fan for quads (rectangles, strips — the common case, no allocation-heavy
// triangulation), the general triangulator otherwise.
const QUAD = [[0, 1, 2], [0, 2, 3]];
function convexTris(pts) {
  if (pts.length === 4) return QUAD;
  if (pts.length === 3) return [[0, 1, 2]];
  try { return THREE.ShapeUtils.triangulateShape(pts.map(V2), []); } catch { return null; }
}

// Flat panel (no hole) in the wall plane, `off` metres in front of it: blind windows, signs, doors, louvres.
export function panel(kit, key, E, pts, off = 0.02, uv = 'metre', vRef = 0) {
  const tris = convexTris(pts);
  if (!tris) return;
  const bb = bbox(pts);
  const uvOf = (s, y) => {
    if (uv === 'metre') return [s, y - vRef];
    const fu = (s - bb.s0) / (bb.s1 - bb.s0 || 1), fv = (y - bb.y0) / (bb.y1 - bb.y0 || 1);
    if (uv === 'box') return [fu, fv];
    return [uv[0] + (uv[2] - uv[0]) * fu, uv[1] + (uv[3] - uv[1]) * fv];
  };
  for (const [i, j, k] of tris) {
    const A = pts[i], B = pts[j], C = pts[k];
    kit.tri(key, E.P3(A[0], A[1], off), E.P3(B[0], B[1], off), E.P3(C[0], C[1], off), E.n, uvOf(A[0], A[1]), uvOf(B[0], B[1]), uvOf(C[0], C[1]));
  }
}

// Moulding following a polyline of (s,y) points on edge E: a small square-section beam `w` wide, `h` proud of the wall.
export function mouldingAlong(kit, key, E, pts, w = 0.14, h = 0.1, off = 0) {
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    kit.beam(key, E.P3(p[0], p[1], off + h / 2), E.P3(q[0], q[1], off + h / 2), h, w, { caps: false });
  }
}

// Box standing on the edge line: centred at s along E, `off` outwards (centre), w along x h x d across.
export function edgeBox(kit, key, E, s, off, y0, y1, w, d, faces = null, vRef = 0) {
  const [x, z] = E.P(s, off);
  kit.box(key, x, (y0 + y1) / 2, z, w, y1 - y0, d, E.rot, { faces: faces || undefined, vRef });
}

// ------------------------------------------------------------------ buttresses & pinnacles
// Stepped buttress against edge E at s: stages [{ y1, d, w }] from yBase upwards; each stage ends in a sloped
// weathering (capH tall) that runs back to the next stage's depth (or to the wall for the last one).
export function buttress(kit, key, E, s, yBase, stages, { capH = 0.6, vRef = 0 } = {}) {
  let y = yBase;
  for (let i = 0; i < stages.length; i++) {
    const st = stages[i], next = stages[i + 1];
    const d = st.d, w = st.w, top = st.y1 - capH;
    if (top > y + 0.05) edgeBox(kit, key, E, s, d / 2, y, top, w, d, { px: 1, nx: 1, nz: 1, pz: 0, py: 0, ny: 0 }, vRef);
    // weathering: from the front edge at `top` up to depth dn at top + capH
    const dn = next ? Math.min(next.d, d) : 0.02;
    const s0 = s - w / 2, s1 = s + w / 2, yt = st.y1;
    const A = E.P3(s0, top, d), B = E.P3(s1, top, d), C = E.P3(s1, yt, dn), D = E.P3(s0, yt, dn);
    kit.quadH(key, A, B, C, D, [E.n[0], 1, E.n[2]], [0, 0], [w, 0], [w, Math.hypot(d - dn, capH)], [0, Math.hypot(d - dn, capH)]);
    // side triangles / trapezoids of the weathering
    for (const [sa, sg] of [[s0, -1], [s1, 1]]) {
      const nrm = [E.dir[0] * sg, 0, E.dir[1] * sg];
      kit.quad(key, E.P3(sa, top, 0), E.P3(sa, top, d), E.P3(sa, yt, dn), E.P3(sa, yt, 0), nrm, [0, top - vRef], [d, top - vRef], [dn, yt - vRef], [0, yt - vRef]);
    }
    y = yt;
  }
}

// Square pinnacle: shaft w x w from y0 to y0 + shaftH, pyramid cap capH, small ball finial. rot = rotY.
export function pinnacle(kit, key, x, z, y0, w, shaftH, capH, rot = 0, { gablets = false } = {}) {
  const y1 = y0 + shaftH;
  kit.box(key, x, (y0 + y1) / 2, z, w, shaftH, w, rot, { faces: { px: 1, nx: 1, pz: 1, nz: 1, py: 0, ny: 0 } });
  const c = Math.cos(rot), s = Math.sin(rot), h = w / 2 + 0.03;
  const P = (u, v, y) => [x + u * c + v * s, y, z - u * s + v * c];
  const corners = [P(-h, -h, y1), P(h, -h, y1), P(h, h, y1), P(-h, h, y1)];
  // cap overhang band
  kit.box(key, x, y1 + 0.06, z, w + 0.12, 0.12, w + 0.12, rot, { faces: { px: 1, nx: 1, pz: 1, nz: 1, py: 1, ny: 1 } });
  const apex = [x, y1 + 0.12 + capH, z];
  const cs = corners.map((p) => [p[0], y1 + 0.12, p[2]]);
  for (let i = 0; i < 4; i++) {
    const a = cs[i], b = cs[(i + 1) % 4];
    const mx = (a[0] + b[0]) / 2 - x, mz = (a[2] + b[2]) / 2 - z;
    kit.triH(key, a, b, apex, [mx, 0.3, mz], [0, 0], [w, 0], [w / 2, capH]);
    if (gablets) {   // small gables at the foot of the cap (Calvary's tower pinnacles)
      const m = [(a[0] + b[0]) / 2, y1 + 0.12, (a[2] + b[2]) / 2];
      const tip = [m[0] + mx * 0.08, y1 + 0.12 + capH * 0.35, m[2] + mz * 0.08];
      kit.triH(key, a, b, tip, [mx, 0.2, mz]);
    }
  }
  kit.box(key, x, apex[1] + 0.08, z, 0.16, 0.16, 0.16, rot);
}

// Regular n-gon prism (vertical walls) centred at (x,z) with circumradius r, rotated by a0 (radians, x/z math sense).
export function ngonRing(x, z, r, n = 8, a0 = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = a0 + (i * 2 * Math.PI) / n; out.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
  return out;
}
// Pyramid / cone over a ring at y0 to apex (x, yA, z); faces use `key`.
export function pyramid(kit, key, ring, y0, apex) {
  const r = ccw(ring);
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mx = (a[0] + b[0]) / 2 - apex[0], mz = (a[1] + b[1]) / 2 - apex[2];
    const sl = Math.hypot(Math.hypot(mx, mz), apex[1] - y0);
    kit.triH(key, [a[0], y0, a[1]], [b[0], y0, b[1]], apex, [mx, 0.2, mz], [0, 0], [L, 0], [L / 2, sl]);
  }
}
// Prism with walls + optional top cap.
export function prism(kit, key, ring, y0, y1, { topKey = null, vRef } = {}) {
  kit.ringWalls(key, ring, y0, y1, { vRef: vRef ?? y0 });
  if (topKey) kit.cap(topKey, ring, y1, true);
}

// ------------------------------------------------------------------ roofs (local frame F)
// Gabled roof over the local rectangle u0..u1 x v0..v1, ridge along u (axis 'u') or v. `ov` eave overhang,
// `endOv` overhang past the gable ends (0 for parapet gables). UVs: u along the eave, v up the slope.
export function gableRoof(kit, key, F, u0, u1, v0, v1, yEave, yRidge, { axis = 'u', ov = 0.25, endOv = 0, under = true } = {}) {
  if (axis === 'u') {
    const vm = (v0 + v1) / 2, h = (v1 - v0) / 2, rise = yRidge - yEave;
    const yO = yEave - (rise * ov) / h;
    const a0 = u0 - endOv, a1 = u1 + endOv, L = a1 - a0, sl = Math.hypot(h + ov, rise + (rise * ov) / h);
    for (const [vE, sg] of [[v0 - ov, -1], [v1 + ov, 1]]) {
      const up = F.D3(0, sg);
      kit.quadH(key, F.P(a0, vE, yO), F.P(a1, vE, yO), F.P(a1, vm, yRidge), F.P(a0, vm, yRidge), [up[0], 1, up[2]], [0, 0], [L, 0], [L, sl], [0, sl]);
      if (under && ov > 0.05) kit.quadH(key, F.P(a0, vE, yO - 0.03), F.P(a1, vE, yO - 0.03), F.P(a1, vm, yRidge - 0.03), F.P(a0, vm, yRidge - 0.03), [0, -1, 0]);
    }
  } else {
    const um = (u0 + u1) / 2, h = (u1 - u0) / 2, rise = yRidge - yEave;
    const yO = yEave - (rise * ov) / h;
    const a0 = v0 - endOv, a1 = v1 + endOv, L = a1 - a0, sl = Math.hypot(h + ov, rise + (rise * ov) / h);
    for (const [uE, sg] of [[u0 - ov, -1], [u1 + ov, 1]]) {
      const up = F.D3(sg, 0);
      kit.quadH(key, F.P(uE, a0, yO), F.P(uE, a1, yO), F.P(um, a1, yRidge), F.P(um, a0, yRidge), [up[0], 1, up[2]], [0, 0], [L, 0], [L, sl], [0, sl]);
      if (under && ov > 0.05) kit.quadH(key, F.P(uE, a0, yO - 0.03), F.P(uE, a1, yO - 0.03), F.P(um, a1, yRidge - 0.03), F.P(um, a0, yRidge - 0.03), [0, -1, 0]);
    }
  }
}
// Lean-to (shed) roof: low edge along v = vLow at yLow, high edge at v = vHigh / yHigh, from u0 to u1.
export function leanTo(kit, key, F, u0, u1, vLow, vHigh, yLow, yHigh, ov = 0.2) {
  const dv = vHigh - vLow, sgn = Math.sign(dv), rise = yHigh - yLow;
  const vO = vLow - sgn * ov, yO = yLow - (rise * ov) / Math.abs(dv);
  const up = F.D3(0, -sgn), sl = Math.hypot(Math.abs(dv) + ov, rise + (rise * ov) / Math.abs(dv));
  kit.quadH(key, F.P(u0, vO, yO), F.P(u1, vO, yO), F.P(u1, vHigh, yHigh), F.P(u0, vHigh, yHigh), [up[0], 1, up[2]], [0, 0], [u1 - u0, 0], [u1 - u0, sl], [0, sl]);
}
// Coping stone along a sloped rake from A to B (world [x,y,z]): a beam w wide, h thick sitting on the line.
export function coping(kit, key, A, B, w = 0.5, h = 0.22) {
  kit.beam(key, [A[0], A[1] + h / 2, A[2]], [B[0], B[1] + h / 2, B[2]], w, h);
}

// Octagonal (or n-sided) broach spire in local frame F centred at (u,v): base circumradius r0 at y0, apex at y1.
// Faces are rotated so flats face the frame axes. Lucarnes: [{ y, h, w, faces:[indices] }] small gabled openings.
export function spire(kit, key, F, u, v, y0, y1, r0, { n = 8, entasis = 0.0, ringKey = null } = {}) {
  const a0 = Math.PI / n;       // a flat faces +u
  const ptsAt = (r) => { const out = []; for (let i = 0; i < n; i++) { const a = a0 + (i * 2 * Math.PI) / n; out.push(F.W(u + Math.cos(a) * r, v + Math.sin(a) * r)); } return out; };
  const [cx, cz] = F.W(u, v);
  // slight entasis: a mid ring pushed out
  const ym = y0 + (y1 - y0) * 0.45, rm = r0 * (0.55 + entasis);
  const base = ptsAt(r0), mid = ptsAt(rm);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = [base[i][0], y0, base[i][1]], b = [base[j][0], y0, base[j][1]];
    const c = [mid[j][0], ym, mid[j][1]], d = [mid[i][0], ym, mid[i][1]];
    const mx = (base[i][0] + base[j][0]) / 2 - cx, mz = (base[i][1] + base[j][1]) / 2 - cz;
    const L0 = Math.hypot(b[0] - a[0], b[2] - a[2]), L1 = Math.hypot(c[0] - d[0], c[2] - d[2]), sl = Math.hypot(r0 - rm, ym - y0);
    kit.quadH(key, a, b, c, d, [mx, 0.15, mz], [0, 0], [L0, 0], [(L0 + L1) / 2, sl], [(L0 - L1) / 2, sl]);
    kit.triH(key, d, c, [cx, y1, cz], [mx, 0.1, mz], [0, 0], [L1, 0], [L1 / 2, Math.hypot(rm, y1 - ym)]);
  }
  if (ringKey) {   // moulded band at the base
    const ring = ptsAt(r0 + 0.12);
    kit.ringWalls(ringKey, ring, y0 - 0.3, y0 + 0.05, { vRef: 0 });
    kit.cap(ringKey, ring, y0 + 0.05, true);
  }
  return { base, cx, cz };
}

// ------------------------------------------------------------------ signs
// Free-standing sign board centred at (x, z) facing the unit direction `face` [dx, dz]: a board w x h whose bottom
// edge is at y0, the front showing atlas region `uv` (u0,v0,u1,v1) on `key`, body / back / posts in `bodyKey`, and an
// optional masonry base (baseKey, baseH) under it.
export function signBoard(kit, { x, z, face, y0, w, h, key, uv, bodyKey, baseKey = null, baseH = 0, depth = 0.14, posts = false }) {
  const l = Math.hypot(face[0], face[1]), n = [face[0] / l, 0, face[1] / l];
  const along = [-n[2], n[0]];                                   // left → right for a viewer facing the board
  const a = [x - along[0] * w / 2, z - along[1] * w / 2], b = [x + along[0] * w / 2, z + along[1] * w / 2];
  const E = edge(a, b, n);
  const rot = E.rot;
  if (baseKey && baseH > 0) kit.box(baseKey, x, y0 - baseH / 2, z, w + 0.4, baseH + 0.6, depth + 0.4, rot, { faces: { px: 1, nx: 1, pz: 1, nz: 1, py: 1 }, vRef: y0 - baseH - 0.6 });
  kit.box(bodyKey, x, y0 + h / 2, z, w + 0.1, h + 0.1, depth, rot, { faces: { px: 1, nx: 1, pz: 1, nz: 1, py: 1, ny: 1 } });
  // front face (text reads left → right: flip u when the edge runs right-to-left for the viewer)
  const mir = n[2] * E.dir[0] - n[0] * E.dir[1] < 0;
  let [u0, v0, u1, v1] = uv;
  if (mir) [u0, u1] = [u1, u0];
  const P = (s, y) => E.P3(s, y, depth / 2 + 0.005);
  kit.quad(key, P(0, y0), P(w, y0), P(w, y0 + h), P(0, y0 + h), n, [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
  if (posts) for (const s of [0.15, w - 0.15]) { const [px, pz] = E.P(s, 0); kit.box(bodyKey, px, (y0 + 0.02) / 2 + (y0 - 1.2) / 2, pz, 0.1, y0 - (y0 - 1.2) + 0.02, 0.1, rot); }
  return E;
}

// ------------------------------------------------------------------ registration
export function countTris(obj) {
  let t = 0;
  obj.traverse((o) => { if (o.isMesh) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return t;
}
// Pick entry + label for a building landmark (the info panel resolves infoKey = osmId in CAMPUS_INFO.buildings).
export function registerBuilding(ctx, object, { key, name, nameZh, osmId, position, radius, labelY, priority = 9, maxDistance }) {
  const inf = osmId ? ctx.info?.buildings?.[osmId] : null;
  const zh = inf?.nameZh || ctx.info?.landmarks?.[key]?.nameZh || nameZh;
  const en = inf?.nameEn || name;
  const entry = { key, kind: 'landmark', name: en, nameZh: zh, osmId, infoKey: osmId || key, position, radius };
  try { ctx.pick?.add(object, entry); } catch (e) { console.warn(`[kenmawr] pick ${key}`, e); }
  const label = { key: `landmark:${key}`, text: en, textZh: zh, kind: 'landmark', priority, position: { x: position[0], y: labelY ?? position[1], z: position[2] } };
  if (maxDistance) label.maxDistance = maxDistance;
  try { ctx.labels?.add(label); } catch (e) { console.warn(`[kenmawr] label ${key}`, e); }
  object.userData.landmarkKey = key;
  object.userData.anchor = [position[0], position[2]];
  return entry;
}

// Two-level building: `coarse` (world-space Group) now, the detailed level built later by the generator `fine`
// (yields between parts; returns a world-space Group) in idle time after app:ready, or at once when the camera
// comes within `near` metres. The LOD switches to the detailed level within `far` metres of `centre`.
export function lodBuilding(ctx, { name, centre, coarse, far, near, fine }) {
  const [cx, cy, cz] = centre;
  const place = (g) => { g.position.set(-cx, -cy, -cz); g.updateMatrix(); return g; };
  const lod = makeLOD(place(coarse), far);
  lod.name = `${name}-lod`;
  lod.position.set(cx, cy, cz);
  lod.updateMatrix();
  if (fine) {
    deferRefine(ctx, {
      name, anchor: centre, near,
      steps: fine,
      apply(g) {
        if (!g) return;
        place(g);
        lod.setFine(g);
        try { ctx.engine?.warm?.(g); } catch { /* compiled on first use instead */ }
        try { ctx.env?.refreshShadows?.(); } catch { /* next scheduled refresh */ }
        lod.userData.fineTriangles = countTris(g);
      },
    });
  }
  return lod;
}
