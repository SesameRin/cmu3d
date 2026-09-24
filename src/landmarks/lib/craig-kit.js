// Geometry helpers for the Craig Street / Henry Street / Fifth Avenue landmarks (craig.js). Built on the shared
// MeshKit from north-kit.js (per-material triangle buckets merged into one mesh per material).
//
// Conventions (ARCHITECTURE.md): x = east, z = south, y = up. Rings are [[x,z],...]; for a CCW ring (ccw()) the
// outward normal of edge a→b is (dz, 0, -dx) / L. Wall UVs: u = metres along the wall, v = y - vRef.
import {
  MeshKit, massing, punchedWall, bandRing, makeFrame, rectLocal, insetRing, ccw, pointInRing, ringCentroid, prng,
  groundStats, infoNameZh, signedArea, lerp2, archWindow,
} from './north-kit.js';

export {
  MeshKit, massing, punchedWall, bandRing, makeFrame, rectLocal, insetRing, ccw, pointInRing, ringCentroid, prng,
  groundStats, signedArea, lerp2, archWindow,
};

// ------------------------------------------------------------------ edges
// Edge frame for a wall segment a→b whose outside is `out` (normal [nx,0,nz]); if out is omitted the CCW-ring
// convention is used. P(s, off) → [x, z] at distance s along the edge, off metres outwards.
export function edge(a, b, out = null) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n = out || [dir[1], 0, -dir[0]];
  return {
    a, b, L, dir, n,
    rot: Math.atan2(-dir[1], dir[0]),               // kit.box rotY: local +x along the edge, local +z inwards
    P: (s, off = 0) => [a[0] + dir[0] * s + n[0] * off, a[1] + dir[1] * s + n[2] * off],
    P3: (s, y, off = 0) => [a[0] + dir[0] * s + n[0] * off, y, a[1] + dir[1] * s + n[2] * off],
  };
}
// Edges of a ring in CCW order: [{ a, b, L, dir, n, rot, P, P3, i }]
export function ringEdges(ring) {
  const r = ccw(ring);
  return r.map((a, i) => ({ ...edge(a, r[(i + 1) % r.length]), i }));
}

// Box standing on the edge line: centred at s along the edge, `off` outwards, sized w (along) x h x d (across).
export function edgeBox(kit, key, E, s, off, y0, y1, w, d, opts = {}) {
  const [x, z] = E.P(s, off);
  kit.box(key, x, (y0 + y1) / 2, z, w, y1 - y0, d, E.rot, opts);
}

// Openings given by world endpoints { p0:[x,z], p1:[x,z], ...rest } → openings on the wall strip E (s0/s1 along it),
// keeping only those whose endpoints lie on the strip's line (within tol) and overlap it.
export function projectOpenings(E, specs, tol = 0.35) {
  const out = [];
  for (const sp of specs) {
    const d0 = [sp.p0[0] - E.a[0], sp.p0[1] - E.a[1]], d1 = [sp.p1[0] - E.a[0], sp.p1[1] - E.a[1]];
    const perp0 = Math.abs(d0[0] * E.n[0] + d0[1] * E.n[2]), perp1 = Math.abs(d1[0] * E.n[0] + d1[1] * E.n[2]);
    if (perp0 > tol || perp1 > tol) continue;
    let s0 = d0[0] * E.dir[0] + d0[1] * E.dir[1], s1 = d1[0] * E.dir[0] + d1[1] * E.dir[1];
    if (s0 > s1) [s0, s1] = [s1, s0];
    if (s1 < 0.05 || s0 > E.L - 0.05) continue;
    const { p0, p1, ...rest } = sp;
    out.push({ ...rest, s0, s1, sMid: (s0 + s1) / 2 });
  }
  return out;
}

// ------------------------------------------------------------------ wall with rectangular openings
// Builds the wall strip E (from s = 0 to E.L) between y0 and y1 around a list of openings
// { s0, s1, y0, y1, depth?, glass?, back?, frame?, mull?, transom?, sill?, head?, cell? } and fills each opening:
//   glass: bucket key of the recessed pane (null → the opening shows `back`, a dark recess face)
//   frame: bucket key for the perimeter frame + mullions every `mull` metres (+ a transom at `transom` m)
//   sill / head: bucket keys for a projecting sill / lintel block (lintel may have a keystone: keystone: true)
//   uv: 'cell' → the pane gets one atlas cell (cellUV(rand)); otherwise metre UVs (u along, v = y - vRef)
// o: { wallKey, revealKey?, vRef, uStart, rand, cellUV }
export function wallWithOpenings(kit, E, y0, y1, openings, o) {
  const { wallKey, vRef = 0, uStart = 0 } = o;
  const n = E.n, L = E.L;
  const ops = openings
    .map((p) => ({ ...p, s0: Math.max(0, p.s0), s1: Math.min(L, p.s1), y0: Math.max(y0, p.y0), y1: Math.min(y1, p.y1) }))
    .filter((p) => p.s1 - p.s0 > 0.05 && p.y1 - p.y0 > 0.05);
  const quadW = (s0, s1, ya, yb) => {
    if (s1 - s0 < 0.005 || yb - ya < 0.005) return;
    kit.quad(wallKey, E.P3(s0, ya), E.P3(s1, ya), E.P3(s1, yb), E.P3(s0, yb), n,
      [uStart + s0, ya - vRef], [uStart + s1, ya - vRef], [uStart + s1, yb - vRef], [uStart + s0, yb - vRef]);
  };
  // horizontal bands between all opening breakpoints
  const ys = [...new Set([y0, y1, ...ops.flatMap((p) => [p.y0, p.y1])])].sort((a, b) => a - b);
  for (let k = 0; k < ys.length - 1; k++) {
    const ya = ys[k], yb = ys[k + 1];
    if (yb - ya < 0.005) continue;
    const cut = ops.filter((p) => p.y0 <= ya + 1e-4 && p.y1 >= yb - 1e-4).sort((p, q) => p.s0 - q.s0);
    let s = 0;
    for (const p of cut) { quadW(s, p.s0, ya, yb); s = Math.max(s, p.s1); }
    quadW(s, L, ya, yb);
  }
  const inN = [-n[0], 0, -n[2]], dir3 = [E.dir[0], 0, E.dir[1]], ndir3 = [-E.dir[0], 0, -E.dir[1]];
  for (const p of ops) {
    const d = p.depth ?? 0.25, rk = o.revealKey || wallKey;
    const { s0, s1 } = p, ya = p.y0, yb = p.y1, w = s1 - s0, h = yb - ya;
    // reveals
    kit.quad(rk, E.P3(s0, ya), E.P3(s0, ya, -d), E.P3(s0, yb, -d), E.P3(s0, yb), dir3, [0, 0], [d, 0], [d, h], [0, h]);
    kit.quad(rk, E.P3(s1, ya), E.P3(s1, ya, -d), E.P3(s1, yb, -d), E.P3(s1, yb), ndir3, [0, 0], [d, 0], [d, h], [0, h]);
    kit.quad(rk, E.P3(s0, yb), E.P3(s1, yb), E.P3(s1, yb, -d), E.P3(s0, yb, -d), [0, -1, 0], [0, 0], [w, 0], [w, d], [0, d]);
    kit.quad(p.sillKey || rk, E.P3(s0, ya), E.P3(s1, ya), E.P3(s1, ya, -d), E.P3(s0, ya, -d), [0, 1, 0], [0, 0], [w, 0], [w, d], [0, d]);
    const gOff = -d + 0.04;
    const key = p.glass || p.back || 'dark';
    let uv;
    if (p.cell && o.cellUV) { const [u0, v0, u1, v1] = o.cellUV(o.rand); uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]; }
    else uv = [[uStart + s0, ya - vRef], [uStart + s1, ya - vRef], [uStart + s1, yb - vRef], [uStart + s0, yb - vRef]];
    kit.quad(key, E.P3(s0, ya, gOff), E.P3(s1, ya, gOff), E.P3(s1, yb, gOff), E.P3(s0, yb, gOff), n, ...uv);
    if (p.frame) {
      const fw = p.fw ?? 0.06, fo = gOff + 0.04, faces = { px: 1, nx: 1, nz: 1, py: 1, ny: 1 };
      const fb = (s, y, bw, bh) => { const [x, z] = E.P(s, fo); kit.box(p.frame, x, y, z, bw, bh, 0.08, E.rot, { faces }); };
      fb(s0 + fw / 2, (ya + yb) / 2, fw, h); fb(s1 - fw / 2, (ya + yb) / 2, fw, h);
      fb((s0 + s1) / 2, yb - fw / 2, w, fw); fb((s0 + s1) / 2, ya + fw / 2, w, fw);
      if (p.mull) { const k = Math.max(1, Math.round(w / p.mull)); for (let i = 1; i < k; i++) fb(s0 + w * i / k, (ya + yb) / 2, fw * 0.9, h); }
      if (p.transom) fb((s0 + s1) / 2, ya + p.transom, w, fw * 0.8);
    }
    if (p.sill) edgeBox(kit, p.sill, E, (s0 + s1) / 2, 0.06, ya - 0.12, ya + 0.02, w + 0.16, 0.2, { faces: { px: 1, nx: 1, nz: 1, pz: 1, py: 1, ny: 1 } });
    if (p.head) {
      edgeBox(kit, p.head, E, (s0 + s1) / 2, 0.04, yb, yb + (p.headH ?? 0.3), w + 0.36, 0.12, { faces: { px: 1, nx: 1, nz: 1, pz: 1, py: 1, ny: 1 } });
      if (p.keystone) edgeBox(kit, p.head, E, (s0 + s1) / 2, 0.08, yb - 0.05, yb + (p.headH ?? 0.3) + 0.12, 0.34, 0.18);
    }
  }
}

// ------------------------------------------------------------------ curtain wall with projecting piers
// Glass plane `set` metres behind the edge line from y0 to y1 (+ spandrel/parapet), piers every `bay` metres from
// `first` (pier faces at the edge line + proj), a sill ledge at y0. Glass UVs in metres (glazing layers tile).
// o: { glassKey, pierKey, bay, pierW, set, proj, pierY0?, pierY1?, vRef, uStart, skip?(s), ends?,
//      cols?/mw? (glass UVs per bay so each bay shows exactly `cols` mullion modules of width mw),
//      ledgeKey? (sill ledge at y0 between the glass and the wall line), capKey? (soffit strip at y1) }
export function curtainWall(kit, E, y0, y1, o) {
  const { glassKey, pierKey, bay, pierW = 0.5, set = 0.45, proj = 0.0, vRef = 0, uStart = 0 } = o;
  const g = -set, L = E.L, n = E.n;
  const nb = bay ? Math.max(1, Math.round(L / bay)) : 1, bw = L / nb;
  if (o.panes) {
    // individual panes (one window-atlas cell each, so they light independently at night) + a mullion grid
    const { key, frameKey, rowH = 2, paneW = 1.5, cellUV: cu, rand, transoms = true } = o.panes;
    const rows = Math.max(1, Math.round((y1 - y0) / rowH)), ph = (y1 - y0) / rows;
    const cols = o.cols || Math.max(1, Math.round(bw / paneW)), pw = bw / cols;
    const faces = { px: 1, nx: 1, nz: 1, py: 1, ny: 1 };
    for (let i = 0; i < nb; i++) {
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        const sa = i * bw + c * pw, sb = sa + pw, ya = y0 + r * ph, yb = ya + ph;
        const [u0, v0, u1, v1] = cu(rand);
        kit.quad(key, E.P3(sa, ya, g), E.P3(sb, ya, g), E.P3(sb, yb, g), E.P3(sa, yb, g), n, [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
      }
      if (!frameKey) continue;
      for (let c = 1; c < cols; c++) edgeBox(kit, frameKey, E, i * bw + c * pw, g + 0.05, y0, y1, 0.08, 0.1, { faces });
      if (transoms) for (let r = 1; r < rows; r++) edgeBox(kit, frameKey, E, (i + 0.5) * bw, g + 0.05, y0 + r * ph - 0.04, y0 + r * ph + 0.04, bw, 0.1, { faces });
    }
  } else if (o.cols && o.mw && bay) {
    const U = o.cols * o.mw;
    for (let i = 0; i < nb; i++) {
      const s0 = i * bw, s1 = s0 + bw;
      kit.quad(glassKey, E.P3(s0, y0, g), E.P3(s1, y0, g), E.P3(s1, y1, g), E.P3(s0, y1, g), n,
        [0, y0 - vRef], [U, y0 - vRef], [U, y1 - vRef], [0, y1 - vRef]);
    }
  } else {
    kit.quad(glassKey, E.P3(0, y0, g), E.P3(L, y0, g), E.P3(L, y1, g), E.P3(0, y1, g), n,
      [uStart, y0 - vRef], [uStart + L, y0 - vRef], [uStart + L, y1 - vRef], [uStart, y1 - vRef]);
  }
  if (o.ledgeKey) kit.quad(o.ledgeKey, E.P3(0, y0, g), E.P3(L, y0, g), E.P3(L, y0, 0), E.P3(0, y0, 0), [0, 1, 0], [0, 0], [L, 0], [L, set], [0, set]);
  if (o.capKey) kit.quad(o.capKey, E.P3(0, y1, g), E.P3(L, y1, g), E.P3(L, y1, 0), E.P3(0, y1, 0), [0, -1, 0], [0, 0], [L, 0], [L, set], [0, set]);
  // returns of the glass plane at the ends (so the set-back does not open a slot at the corners)
  const endN0 = [-E.dir[0], 0, -E.dir[1]], endN1 = [E.dir[0], 0, E.dir[1]];
  if (o.returns !== false) {
    kit.quad(pierKey, E.P3(0, y0, 0), E.P3(0, y0, g), E.P3(0, y1, g), E.P3(0, y1, 0), endN0, [0, 0], [set, 0], [set, y1 - y0], [0, y1 - y0]);
    kit.quad(pierKey, E.P3(L, y0, g), E.P3(L, y0, 0), E.P3(L, y1, 0), E.P3(L, y1, g), endN1, [0, 0], [set, 0], [set, y1 - y0], [0, y1 - y0]);
  }
  if (!pierKey || !bay) return [];
  // the wall is divided into equal bays close to `bay`; piers on the interior bay lines (+ the ends if o.ends)
  const py0 = o.pierY0 ?? y0, py1 = o.pierY1 ?? y1;
  const faces = { px: 1, nx: 1, nz: 1, py: 1, ny: 0 };
  const piers = [];
  for (let i = o.ends ? 0 : 1; i <= (o.ends ? nb : nb - 1); i++) {
    const s = Math.min(L - pierW / 2, Math.max(pierW / 2, i * bw));
    if (o.skip && o.skip(s)) continue;
    edgeBox(kit, pierKey, E, s, (proj - set) / 2, py0, py1, pierW, set + proj, { faces, vRef });
    piers.push(s);
  }
  return piers;
}

// ------------------------------------------------------------------ roofs
// Mansard: sloped walls from `ring` at y0 up to the ring inset by `inset` at y1, flat cap on top.
export function mansard(kit, key, capKey, ring, y0, y1, inset) {
  const r = ccw(ring), top = insetRing(r, inset);
  const sl = Math.hypot(inset, y1 - y0);
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length, a = r[i], b = r[j], c = top[j], d = top[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-3) continue;
    const n = [(b[1] - a[1]) / L, 0.3, -(b[0] - a[0]) / L];
    kit.quadH(key, [a[0], y0, a[1]], [b[0], y0, b[1]], [c[0], y1, c[1]], [d[0], y1, d[1]], n, [0, 0], [L, 0], [L, sl], [0, sl]);
  }
  if (capKey) kit.cap(capKey, top, y1, true);
  return top;
}

// Rooftop plant: a few boxes of assorted sizes inside a ring (deterministic).
export function rooftopUnits(kit, key, ring, y, count, rand, { min = 1.2, max = 3.2, hMin = 0.9, hMax = 1.8, rot = 0, margin = 2 } = {}) {
  const r = ccw(ring), inner = insetRing(r, margin);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of inner) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  let placed = 0;
  for (let t = 0; t < count * 12 && placed < count; t++) {
    const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0);
    const w = min + rand() * (max - min), d = min + rand() * (max - min) * 0.7, h = hMin + rand() * (hMax - hMin);
    const c = Math.cos(rot), s = Math.sin(rot);
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [x + u * c + v * s, z - u * s + v * c]);
    if (!corners.every(([cx, cz]) => pointInRing(cx, cz, inner))) continue;
    kit.box(key, x, y + h / 2, z, w, h, d, rot, { faces: { px: 1, nx: 1, pz: 1, nz: 1, py: 1 } });
    placed++;
  }
}

// ------------------------------------------------------------------ signs
// Flat sign quad centred at (s along E, y) `off` metres in front of the wall, w x h, atlas uv = [u0,v0,u1,v1].
// True when increasing s along E runs right-to-left for someone facing the wall from outside (text must be flipped).
export function mirrored(E) { return E.n[2] * E.dir[0] - E.n[0] * E.dir[1] < 0; }
export function signOnEdge(kit, key, E, s, yMid, w, h, uv, off = 0.03) {
  let [u0, v0, u1, v1] = uv;
  if (mirrored(E)) [u0, u1] = [u1, u0];
  kit.quad(key, E.P3(s - w / 2, yMid - h / 2, off), E.P3(s + w / 2, yMid - h / 2, off), E.P3(s + w / 2, yMid + h / 2, off), E.P3(s - w / 2, yMid + h / 2, off),
    E.n, [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
}

// Blade sign perpendicular to the wall: a thin double-sided panel sticking out `out` metres from the wall at s.
export function bladeSign(kit, key, frameKey, E, s, y0, w, h, uv, out = 0.25) {
  const [u0, v0, u1, v1] = uv;
  const A = E.P(s, out), B = E.P(s, out + w);
  const along = [E.n[0], E.n[2]];
  for (const sg of [1, -1]) {
    const nrm = [E.dir[0] * sg, 0, E.dir[1] * sg];
    const flip = nrm[2] * along[0] - nrm[0] * along[1] < 0;
    const ua = flip ? u1 : u0, ub = flip ? u0 : u1;
    kit.quad(key, [A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y0 + h, B[1]], [A[0], y0 + h, A[1]], nrm, [ua, v0], [ub, v0], [ub, v1], [ua, v1]);
  }
  if (frameKey) {
    const [bx, bz] = E.P(s, out / 2);
    const r = Math.atan2(-E.n[2], E.n[0]);
    kit.box(frameKey, bx, y0 + h - 0.1, bz, out + 0.04, 0.06, 0.06, r);
    kit.box(frameKey, bx, y0 + 0.1, bz, out + 0.04, 0.06, 0.06, r);
  }
}

// ------------------------------------------------------------------ misc
// Points of a circular arc from p0 to p1 bulging `sag` metres towards `side` ([x,z] unit vector), n+1 points.
export function arcPoints(p0, p1, sag, side, n = 8) {
  const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
  const c = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2;
  const R = (c * c + sag * sag) / (2 * sag);
  const cx = mx - side[0] * (R - sag), cz = mz - side[1] * (R - sag);
  const a0 = Math.atan2(p0[1] - cz, p0[0] - cx), a1 = Math.atan2(p1[1] - cz, p1[0] - cx);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + da * i / n; pts.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]); }
  return pts;
}

export function countTris(group) {
  let t = 0;
  group.traverse((o) => { if (o.isMesh) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return t;
}

// Pick entry + label. Minor buildings get a lower label priority so they do not crowd the campus labels.
export function registerCraig(ctx, object, { key, name, nameZh, osmId, position, radius, labelY, priority = 9, maxDistance }) {
  nameZh = infoNameZh(ctx, osmId, key, nameZh);
  const entry = { key, kind: 'landmark', name, nameZh, osmId, infoKey: osmId || key, position, radius };
  ctx.pick?.add(object, entry);
  const label = { key, text: name, textZh: nameZh, kind: 'landmark', priority, position: { x: position[0], y: labelY ?? position[1], z: position[2] } };
  if (maxDistance) label.maxDistance = maxDistance;
  ctx.labels?.add(label);
  object.userData.key = key;
  object.userData.triangles = countTris(object);
  return entry;
}

// Find the outward normal of an edge of an arbitrary ring (tests a probe point against the ring).
export function outwardOf(ring, a, b) {
  const E = edge(a, b);
  const [x, z] = E.P(E.L / 2, 0.3);
  return pointInRing(x, z, ring) ? [-E.n[0], 0, -E.n[2]] : E.n;
}
