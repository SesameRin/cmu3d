// Geometry helpers for the Forbes-Avenue-west landmarks (CIC, Hamburg Hall, Smith Hall, TCS Hall).
// Built on the north-campus MeshKit (per-material triangle buckets merged into one mesh per material).
//
// Conventions (ARCHITECTURE.md): x = east, z = south, y = up. Rings are [[x,z],...]. UVs in metres: walls
// u = metres along the wall, v = metres above a reference level (vRef) so storeys line up with facade textures.
import { MeshKit, prng, ccw, pointInRing, ringCentroid, insetRing, hipRoof } from './north-kit.js';

export { MeshKit, prng, ccw, pointInRing, ringCentroid, insetRing };

// ------------------------------------------------------------------ local frames
// Orthonormal plan frame: local u along `dir` (a world [dx,dz]), v 90° clockwise from it in plan (for dir = east,
// v = south). W(u, v) → world [x, z]; P(u, y, v) → world [x, y, z]; rotY = three.js rotation mapping local +x → U
// (and local +z → V), for MeshKit.box.
export function planFrame(origin, dir) {
  const l = Math.hypot(dir[0], dir[1]);
  const U = [dir[0] / l, dir[1] / l], V = [-U[1], U[0]];
  const W = (u, v) => [origin[0] + U[0] * u + V[0] * v, origin[1] + U[1] * u + V[1] * v];
  const P = (u, y, v) => { const [x, z] = W(u, v); return [x, y, z]; };
  const toLocal = (x, z) => { const dx = x - origin[0], dz = z - origin[1]; return [dx * U[0] + dz * U[1], dx * V[0] + dz * V[1]]; };
  const rect = (u0, u1, v0, v1) => [W(u0, v0), W(u1, v0), W(u1, v1), W(u0, v1)];
  // direction vectors (world [x,0,z]) of local ±u / ±v
  const dirOf = (du, dv) => [U[0] * du + V[0] * dv, 0, U[1] * du + V[1] * dv];
  return { origin, U, V, W, P, toLocal, rect, dirOf, rotY: Math.atan2(-U[1], U[0]),
    // north-kit hipRoof/gableRoof expect F.W(e, n) plus F.E / F.N unit vectors
    E: U, N: V };
}

// Edge helpers: unit direction, outward normal of a CCW ring edge ([x,0,z]), length.
export function edgeInfo(a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  return { L, d, n: [d[1], 0, -d[0]], rotY: Math.atan2(-d[1], d[0]) };
}

// ------------------------------------------------------------------ wall with openings
// A vertical wall strip from plan point a to b (outward normal n = [nx,0,nz]) between y0 and y1, pierced by
// rectangular or round-headed openings. openings: [{ s0, s1, yb, yt, arch?, kind? }] (s = metres from a along a→b;
// y absolute; for arch, yt is the crown and the head is a semicircle of radius (s1-s0)/2).
// The solid wall is triangulated by a horizontal band sweep, arch spandrels by fans.
// o: { wallKey, vRef = 0, uStart = 0, depth = 0.3 (reveal), revealKey, sillKey, glassKey (fn(op) → key or string),
//      cell(op) → [u0,v0,u1,v1] (glass UVs), seg = 10, sillProj (projecting sill box, m), frameKey, frameW,
//      mullions(op) → count of vertical bars, transoms(op) → array of fractions, glassInset = 0.05 }
export function openingWall(kit, a, b, n, y0, y1, openings, o) {
  const { L, d } = edgeInfo(a, b);
  const vRef = o.vRef ?? 0, u0 = o.uStart ?? 0, seg = o.seg ?? 10;
  const P = (s, y, off = 0) => [a[0] + d[0] * s + n[0] * off, y, a[1] + d[1] * s + n[2] * off];
  const UV = (s, y) => [u0 + s, y - vRef];
  const wk = o.wallKey;
  const quadW = (s0, s1, ya, yb) => {
    if (s1 - s0 < 1e-3 || yb - ya < 1e-3) return;
    kit.quad(wk, P(s0, ya), P(s1, ya), P(s1, yb), P(s0, yb), n, UV(s0, ya), UV(s1, ya), UV(s1, yb), UV(s0, yb));
  };
  // openings reaching below the terrain are shortened from the bottom (or dropped when too little is left)
  const lift = (q) => {
    if (!o.ground || q.door) return q;
    let g = -Infinity;
    for (const s of [q.s0, (q.s0 + q.s1) / 2, q.s1]) { const p = P(s, 0, 0.6); g = Math.max(g, o.ground(p[0], p[2])); }
    if (g + 0.3 <= q.yb) return q;
    const yb = g + 0.3;
    const spring = q.arch ? q.yt - (q.s1 - q.s0) / 2 : q.yt;
    return spring - yb < 1.0 ? null : { ...q, yb };
  };
  const ops = openings.map(lift).filter((q) => q && q.s0 >= 0.05 && q.s1 <= L - 0.05 && q.yb >= y0 + 0.02 && q.yt <= y1 - 0.02 && q.s1 > q.s0)
    .sort((p, q) => p.s0 - q.s0);
  // band sweep
  const ys = [...new Set([y0, y1, ...ops.flatMap((q) => [q.yb, q.yt])])].sort((p, q) => p - q);
  for (let i = 0; i + 1 < ys.length; i++) {
    const ya = ys[i], yb = ys[i + 1];
    if (yb - ya < 1e-4) continue;
    let s = 0;
    for (const q of ops) {
      if (q.yb <= ya + 1e-6 && q.yt >= yb - 1e-6) { quadW(s, q.s0, ya, yb); s = Math.max(s, q.s1); }
    }
    quadW(s, L, ya, yb);
  }
  const depth = o.depth ?? 0.3;
  for (const q of ops) {
    const w = q.s1 - q.s0, r = w / 2, cs = (q.s0 + q.s1) / 2;
    const spring = q.arch ? q.yt - r : q.yt;
    const dq = q.depth ?? depth;
    const rk = o.revealKey || wk;
    // arch spandrels (wall inside the bounding box above the arc)
    const arc = [];
    if (q.arch) {
      for (let k = 0; k <= seg; k++) { const t = Math.PI - (k / seg) * Math.PI; arc.push([cs + Math.cos(t) * r, spring + Math.sin(t) * r]); }
      for (let k = 0; k < seg; k++) {
        const c = k < seg / 2 ? [q.s0, q.yt] : [q.s1, q.yt];
        const p0 = arc[k], p1 = arc[k + 1];
        kit.tri(wk, P(c[0], c[1]), P(p0[0], p0[1]), P(p1[0], p1[1]), n, UV(c[0], c[1]), UV(p0[0], p0[1]), UV(p1[0], p1[1]));
      }
    }
    // reveals: jambs, sill, head (flat or arched soffit)
    const jh = spring - q.yb;
    kit.quad(rk, P(q.s0, q.yb), P(q.s0, q.yb, -dq), P(q.s0, spring, -dq), P(q.s0, spring), [d[0], 0, d[1]], [0, 0], [dq, 0], [dq, jh], [0, jh]);
    kit.quad(rk, P(q.s1, q.yb), P(q.s1, q.yb, -dq), P(q.s1, spring, -dq), P(q.s1, spring), [-d[0], 0, -d[1]], [0, 0], [dq, 0], [dq, jh], [0, jh]);
    kit.quad(o.sillKey || rk, P(q.s0, q.yb), P(q.s1, q.yb), P(q.s1, q.yb, -dq), P(q.s0, q.yb, -dq), [0, 1, 0], [0, 0], [w, 0], [w, dq], [0, dq]);
    if (q.arch) {
      let acc = 0;
      for (let k = 0; k < seg; k++) {
        const p0 = arc[k], p1 = arc[k + 1];
        const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const mx = (p0[0] + p1[0]) / 2 - cs, my = (p0[1] + p1[1]) / 2 - spring, ml = Math.hypot(mx, my) || 1;
        const nn = [-(d[0] * mx) / ml, -my / ml, -(d[1] * mx) / ml];
        kit.quad(rk, P(p0[0], p0[1]), P(p1[0], p1[1]), P(p1[0], p1[1], -dq), P(p0[0], p0[1], -dq), nn, [acc, 0], [acc + l, 0], [acc + l, dq], [acc, dq]);
        acc += l;
      }
    } else {
      kit.quad(rk, P(q.s0, q.yt), P(q.s1, q.yt), P(q.s1, q.yt, -dq), P(q.s0, q.yt, -dq), [0, -1, 0], [0, 0], [w, 0], [w, dq], [0, dq]);
    }
    // glass (or a door / dark void)
    const gk = typeof o.glassKey === 'function' ? o.glassKey(q) : o.glassKey;
    if (gk) {
      const gOff = -dq + (o.glassInset ?? 0.05);
      const [cu0, cv0, cu1, cv1] = o.cell ? o.cell(q) : [0, 0, w, q.yt - q.yb];
      const G = (s, y) => [cu0 + (cu1 - cu0) * (s - q.s0) / w, cv0 + (cv1 - cv0) * (y - q.yb) / (q.yt - q.yb)];
      kit.quad(gk, P(q.s0, q.yb, gOff), P(q.s1, q.yb, gOff), P(q.s1, spring, gOff), P(q.s0, spring, gOff), n,
        G(q.s0, q.yb), G(q.s1, q.yb), G(q.s1, spring), G(q.s0, spring));
      if (q.arch) {
        for (let k = 0; k < seg; k++) {
          const p0 = arc[k], p1 = arc[k + 1];
          kit.tri(gk, P(cs, spring, gOff), P(p0[0], p0[1], gOff), P(p1[0], p1[1], gOff), n, G(cs, spring), G(p0[0], p0[1]), G(p1[0], p1[1]));
        }
      }
      // 3D frame bars (optional)
      if (o.frameKey && !q.noFrame) {
        const fw = o.frameW ?? 0.08, fo = gOff + 0.04;
        const bar = (sA, yA, sB, yB, ww = fw) => kit.beam(o.frameKey, P(sA, yA, fo), P(sB, yB, fo), ww, 0.08);
        const nm = o.mullions ? o.mullions(q) : 0;
        for (let k = 1; k <= nm; k++) { const s = q.s0 + (w * k) / (nm + 1); bar(s, q.yb, s, spring); }
        const tr = o.transoms ? o.transoms(q) : [];
        for (const f of tr) { const y = q.yb + (spring - q.yb) * f; bar(q.s0, y, q.s1, y); }
      }
    }
    // projecting sill
    if (o.sillProj && !q.door) {
      const rot = Math.atan2(-d[1], d[0]);
      const p = P(cs, q.yb - 0.06, o.sillProj / 2 - 0.02);
      kit.box(o.sillKey || rk, p[0], p[1], p[2], w + 0.24, 0.12, o.sillProj, rot, { faces: { px: 1, nx: 1, nz: 1, pz: 1, py: 1, ny: 1 } });
    }
  }
  return ops;
}

// Evenly spaced columns of openings centred on a wall of length L: returns column centre positions.
export function bayCentres(L, bay, margin = 1) {
  const n = Math.max(0, Math.floor((L - 2 * margin) / bay + 1e-6));
  if (n <= 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(L / 2 + (i - (n - 1) / 2) * bay);
  return out;
}

// ------------------------------------------------------------------ roofs
// Hipped roof over a local rectangle with an eave overhang, a fascia band and a soffit.
// F: planFrame; u0..u1 × v0..v1 = wall lines; yWall = top of the walls; slope = rise/run; ov = overhang.
// keys: { roof, fascia, soffit }. dy lowers the whole roof a little (to keep coplanar overlaps from z-fighting).
export function hippedRoof(kit, F, u0, u1, v0, v1, yWall, slope, { ov = 0.9, keys, fasciaH = 0.32, dy = 0 } = {}) {
  const e0 = u0 - ov, e1 = u1 + ov, n0 = v0 - ov, n1 = v1 + ov;
  const yE = yWall - ov * slope - dy;
  const half = Math.min(e1 - e0, n1 - n0) / 2;
  hipRoof(kit, keys.roof, F, e0, e1, n0, n1, yE, half * slope);
  if (keys.fascia) {
    const c = [[e0, n0], [e1, n0], [e1, n1], [e0, n1]];
    for (let i = 0; i < 4; i++) {
      const [ua, va] = c[i], [ub, vb] = c[(i + 1) % 4];
      kit.beam(keys.fascia, F.P(ua, yE - fasciaH / 2 + 0.05, va), F.P(ub, yE - fasciaH / 2 + 0.05, vb), 0.1, fasciaH);
    }
  }
  if (keys.soffit) {
    const w = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], e = [[e0, n0], [e1, n0], [e1, n1], [e0, n1]];
    const ys = yE - fasciaH + 0.08;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      kit.quad(keys.soffit, F.P(w[i][0], ys, w[i][1]), F.P(w[j][0], ys, w[j][1]), F.P(e[j][0], ys, e[j][1]), F.P(e[i][0], ys, e[i][1]), [0, -1, 0],
        [w[i][0], w[i][1]], [w[j][0], w[j][1]], [e[j][0], e[j][1]], [e[i][0], e[i][1]]);
    }
    return { yEave: yE, ySoffit: ys };
  }
  return { yEave: yE, ySoffit: yE };
}

// ------------------------------------------------------------------ misc parts
// Downspout: vertical pipe with a small head box at the eave.
export function downspout(kit, key, x, z, y0, y1, r = 0.09) {
  kit.cylinder(key, x, z, y0, y1, r, r, 6, { top: false });
  kit.box(key, x, y1 - 0.2, z, 0.34, 0.4, 0.34, 0);
}

// Terrain minimum along a segment (sampled every ~2 m)
export function groundMinAlong(ctx, a, b, step = 2) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(L / step));
  let m = Infinity;
  for (let i = 0; i <= n; i++) m = Math.min(m, ctx.heightAt(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n));
  return m;
}
export function groundMaxAlong(ctx, a, b, step = 2) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(L / step));
  let m = -Infinity;
  for (let i = 0; i <= n; i++) m = Math.max(m, ctx.heightAt(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n));
  return m;
}
export function ringGroundStats(ctx, ring, step = 3) {
  if (ctx.heightfield?.statsOverRing) return ctx.heightfield.statsOverRing(ring, step);
  let min = Infinity, max = -Infinity;
  for (const [x, z] of ring) { const h = ctx.heightAt(x, z); min = Math.min(min, h); max = Math.max(max, h); }
  return { min, max, mean: (min + max) / 2 };
}

// Clip a polygon (plan ring) to the half-plane dot(p - p0, nrm) <= 0 (Sutherland–Hodgman, one plane).
export function clipHalf(ring, p0, nrm) {
  const out = [];
  const f = (p) => (p[0] - p0[0]) * nrm[0] + (p[1] - p0[1]) * nrm[1];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// Pick entry + label for one of these landmarks. The Chinese name follows CAMPUS_INFO when present so the label,
// info panel and search agree.
export function registerForbes(ctx, object, { key, name, nameZh, osmId, position, radius, labelY, labelText, labelZh }) {
  const info = ctx.info || globalThis.CAMPUS_INFO;
  const zh = info?.buildings?.[osmId]?.nameZh || nameZh;
  const entry = { key, kind: 'landmark', name, nameZh: zh, osmId, infoKey: osmId, position, radius };
  ctx.pick?.add(object, entry);
  ctx.labels?.add({
    key, text: labelText || name, textZh: labelZh || zh, kind: 'landmark', priority: 9,
    position: { x: position[0], y: labelY ?? position[1], z: position[2] },
  });
  return entry;
}
