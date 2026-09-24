// Roof builders for the generic buildings.
//
// Pitched roofs use a "lower envelope of planes" formulation: each roof type is a small set of planes
// h_i(x, z) = a*x + b*z + c (height above the eaves, defined in the footprint's principal frame), and the roof
// surface is H(x, z) = min_i h_i. For a rectangle this is exactly the textbook gable / hip / pyramid / mansard /
// gambrel / barrel roof, and it degrades gracefully on any other simple polygon (L-shapes get a single ridge
// with raised side walls instead of a broken mesh). Each face region {h_i <= h_j ∀ j} is obtained by clipping
// the (eave-overhang) outline with half-planes, then triangulated and lifted.
import { clipHalfPlane, signedArea, offsetRing, triangulate, emitCap, emitRingWall, emitRingBand, emitBox, emitCylinder, emitFrameBox } from './building-geometry.js';
import { pointInRing } from '../core/heightfield.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- plane sets
// frame: footprintFrame(ring) → { angle, length (L, along +u), width (W), center }
// Returns planes in world x/z: { a, b, c } with h = a*x + b*z + c (metres above the eave line).
export function roofPlanes(shape, frame, pitchDeg, opts = {}) {
  const L = frame.length, W = frame.width;
  const [cx, cz] = frame.center;
  const cs = Math.cos(frame.angle), sn = Math.sin(frame.angle);
  const local = []; // { A, B, C } with h = A*u + B*v + C
  const t = Math.tan(pitchDeg * DEG);
  switch (shape) {
    case 'gabled':
      local.push({ A: 0, B: -t, C: (t * W) / 2 }, { A: 0, B: t, C: (t * W) / 2 });
      break;
    case 'hipped':
    case 'side_hipped': {
      local.push({ A: 0, B: -t, C: (t * W) / 2 }, { A: 0, B: t, C: (t * W) / 2 });
      const t2 = t * (opts.endFactor ?? 1.15); // hip ends slightly steeper
      local.push({ A: -t2, B: 0, C: (t2 * L) / 2 }, { A: t2, B: 0, C: (t2 * L) / 2 });
      break;
    }
    case 'pyramidal': {
      const t2 = (t * W) / Math.max(L, 1e-3);
      local.push({ A: 0, B: -t, C: (t * W) / 2 }, { A: 0, B: t, C: (t * W) / 2 });
      local.push({ A: -t2, B: 0, C: (t2 * L) / 2 }, { A: t2, B: 0, C: (t2 * L) / 2 });
      break;
    }
    case 'skillion': {
      const s = opts.flip ? -1 : 1;
      local.push({ A: 0, B: s * t, C: (t * W) / 2 });
      break;
    }
    case 'mansard': {
      // steep lower slopes on all four sides + a flat (or very low) top
      const T = Math.tan(68 * DEG);
      const top = Math.min(opts.mansardH ?? 3.2, (T * W) / 2 * 0.8);
      local.push({ A: 0, B: -T, C: (T * W) / 2 }, { A: 0, B: T, C: (T * W) / 2 });
      local.push({ A: -T, B: 0, C: (T * L) / 2 }, { A: T, B: 0, C: (T * L) / 2 });
      local.push({ A: 0, B: 0, C: top });
      break;
    }
    case 'gambrel': {
      // steep lower + shallow upper pitch on the long sides, gable ends
      const T = Math.tan(62 * DEG), ts = Math.tan(24 * DEG);
      const hb = Math.min(3, (W / 2) * 0.45 * T);
      const d = hb / T;
      local.push({ A: 0, B: -T, C: (T * W) / 2 }, { A: 0, B: T, C: (T * W) / 2 });
      local.push({ A: 0, B: -ts, C: hb + ts * (W / 2 - d) }, { A: 0, B: ts, C: hb + ts * (W / 2 - d) });
      break;
    }
    case 'round': {
      // segmental barrel vault: tangent planes of an elliptic profile + steep eave planes
      const r = W / 2, R = Math.min(r * 0.55, 8);
      for (let k = -3; k <= 3; k++) {
        const th = k * 20 * DEG;
        const v0 = r * Math.sin(th), y0 = R * Math.cos(th), slope = -(R / r) * Math.tan(th);
        local.push({ A: 0, B: slope, C: y0 - slope * v0 });
      }
      const T = 6;
      local.push({ A: 0, B: -T, C: T * r }, { A: 0, B: T, C: T * r });
      break;
    }
    default:
      return null;
  }
  return local.map(({ A, B, C }) => {
    const a = A * cs - B * sn, b = A * sn + B * cs;
    return { a, b, c: C - a * cx - b * cz };
  });
}

export function envelope(planes, x, z) {
  let m = Infinity;
  for (const p of planes) { const h = p.a * x + p.b * z + p.c; if (h < m) m = h; }
  return m;
}

// Parameters t in (0,1) along segment a→b where the envelope switches plane (crease crossings).
export function envelopeKinks(planes, ax, az, bx, bz) {
  const out = [];
  const n = planes.length;
  for (let i = 0; i < n; i++) {
    const pi = planes[i];
    const hia = pi.a * ax + pi.b * az + pi.c, hib = pi.a * bx + pi.b * bz + pi.c;
    for (let j = i + 1; j < n; j++) {
      const pj = planes[j];
      const hja = pj.a * ax + pj.b * az + pj.c, hjb = pj.a * bx + pj.b * bz + pj.c;
      const den = (hia - hja) - (hib - hjb);
      if (Math.abs(den) < 1e-9) continue;
      const t = (hia - hja) / den;
      if (t <= 1e-3 || t >= 1 - 1e-3) continue;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const h = hia + (hib - hia) * t;
      if (Math.abs(envelope(planes, x, z) - h) < 1e-4) out.push(t);
    }
  }
  out.sort((p, q) => p - q);
  const dedup = [];
  for (const t of out) if (!dedup.length || t - dedup[dedup.length - 1] > 1e-3) dedup.push(t);
  return dedup;
}

// Highest point of the roof envelope over the footprint. The envelope is concave and piecewise linear, so its
// maximum over a polygon lies on a vertex of the arrangement: a footprint vertex, a crease crossing a footprint edge,
// or a point where three planes meet inside the footprint.
export function envelopeMax(planes, ring) {
  let top = -Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    top = Math.max(top, envelope(planes, a[0], a[1]));
    for (const t of envelopeKinks(planes, a[0], a[1], b[0], b[1])) top = Math.max(top, envelope(planes, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t));
  }
  const P = planes.length;
  for (let i = 0; i < P; i++) for (let j = i + 1; j < P; j++) for (let k = j + 1; k < P; k++) {
    // solve a*x + b*z + c equal for the three planes
    const p = planes[i], q = planes[j], s = planes[k];
    const a1 = p.a - q.a, b1 = p.b - q.b, c1 = q.c - p.c, a2 = p.a - s.a, b2 = p.b - s.b, c2 = s.c - p.c;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-9) continue;
    const x = (c1 * b2 - c2 * b1) / det, z = (a1 * c2 - a2 * c1) / det;
    const h = p.a * x + p.b * z + p.c;
    if (h <= top || Math.abs(envelope(planes, x, z) - h) > 1e-4 || !pointInRing(x, z, ring)) continue;
    top = h;
  }
  return top;
}

// Scale the whole roof so its highest point is at most maxRise above the eaves.
export function limitRise(planes, ring, maxRise) {
  let top = envelopeMax(planes, ring);
  if (top > maxRise && top > 0) {
    const k = maxRise / top;
    for (const p of planes) { p.a *= k; p.b *= k; p.c *= k; }
    top = maxRise;
  }
  return top;
}

// Scale the roof so its highest point is exactly `target` metres above the eaves (curated roof.height).
export function setRise(planes, ring, target) {
  const top = limitRise(planes, ring, Infinity);
  if (top > 1e-3) { const k = target / top; for (const p of planes) { p.a *= k; p.b *= k; p.c *= k; } }
  return target;
}

// Insert envelope kinks into a ring (used for fascia outlines).
function ringWithKinks(ring, planes) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    out.push(a);
    for (const t of envelopeKinks(planes, a[0], a[1], b[0], b[1])) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/**
 * Pitched roof mesh. ring = footprint (CCW). y0 = eave height (wall top where H = 0).
 * roofEm – emitter for the roof surface, soffitEm – for fascia + soffit (either may be null: the base LOD draws only
 * the roof surface, the detail LOD the underside, fascia, ridge caps and gutters).
 * overhang – eave overhang in metres, thick – roof slab thickness.
 * opts: planeEm(i) → emitter override for plane i; ridgeEm → ridge / hip caps; gutter { em, heightAt, groundY } →
 * half-round-ish gutters along the level eaves with a downspout at the end of each one.
 */
export function emitPitchedRoof(roofEm, soffitEm, ring, planes, y0, overhang = 0.4, thick = 0.18, opts = {}) {
  const outline = overhang > 0 ? offsetRing(ring, -overhang, 2) : ring;
  const lift = 0.04; // keeps wall tops hidden under the roof surface
  const ox = ring[0][0], oz = ring[0][1]; // UV origin: keeps texture coordinates small (mediump-safe)
  const ridgeEm = opts.ridgeEm || null;
  if (roofEm || soffitEm || ridgeEm) for (let i = 0; i < planes.length; i++) {
    const pi = planes[i];
    let reg = outline;
    for (let j = 0; j < planes.length && reg.length >= 3; j++) {
      if (j === i) continue;
      const pj = planes[j];
      // tie-break so coincident regions are not emitted twice
      const bias = j < i ? 1e-6 : -1e-6;
      reg = clipHalfPlane(reg, pi.a - pj.a, pi.b - pj.b, pi.c - pj.c + bias);
    }
    if (reg.length < 3 || Math.abs(signedArea(reg)) < 0.02) continue;
    if (signedArea(reg) < 0) reg = reg.slice().reverse();
    // plane normal and slope-aligned UVs (v runs up the slope so tile courses are horizontal)
    const gx = pi.a, gz = pi.b, s = Math.hypot(gx, gz);
    let nx = -gx, ny = 1, nz = -gz; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const k = Math.sqrt(1 + s * s);
    const ux = s > 1e-6 ? -gz / s : 1, uz = s > 1e-6 ? gx / s : 0;
    const vx = s > 1e-6 ? gx / s : 0, vz = s > 1e-6 ? gz / s : -1;
    if (ridgeEm) emitCreaseCaps(ridgeEm, reg, planes, i, y0 + lift);
    if (!roofEm && !soffitEm) continue;
    const { pts, tris } = triangulate(reg);
    if (!tris.length) continue;
    const pEm = roofEm ? (opts.planeEm && opts.planeEm(i)) || roofEm : null; // e.g. the flat deck behind a mansard front
    const top = [], bot = [];
    for (const p of pts) {
      const h = pi.a * p[0] + pi.b * p[1] + pi.c;
      const px = p[0] - ox, pz = p[1] - oz;
      const u = px * ux + pz * uz, v = (px * vx + pz * vz) * (s > 1e-6 ? k : 1);
      if (pEm) top.push(pEm.v(p[0], y0 + h + lift, p[1], nx, ny, nz, u, v));
      if (soffitEm) bot.push(soffitEm.v(p[0], y0 + h + lift - thick, p[1], -nx, -ny, -nz, u, v));
    }
    for (let t = 0; t < tris.length; t += 3) {
      if (pEm) pEm.triFacing(top[tris[t]], top[tris[t + 1]], top[tris[t + 2]], nx, ny, nz);
      if (soffitEm) soffitEm.triFacing(bot[tris[t]], bot[tris[t + 1]], bot[tris[t + 2]], -nx, -ny, -nz);
    }
  }
  if (opts.gutter && overhang > 0.1) emitGutters(opts.gutter, ring, outline, planes, y0 + lift, thick);
  if (!soffitEm) return;
  // fascia boards around the outline
  const fr = ringWithKinks(outline, planes);
  let u = 0;
  for (let i = 0; i < fr.length; i++) {
    const a = fr[i], b = fr[(i + 1) % fr.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const nx = dz / len, nz = -dx / len;
    const ha = y0 + envelope(planes, a[0], a[1]) + lift, hb = y0 + envelope(planes, b[0], b[1]) + lift;
    const i0 = soffitEm.v(a[0], ha - thick, a[1], nx, 0, nz, u, 0);
    const i1 = soffitEm.v(b[0], hb - thick, b[1], nx, 0, nz, u + len, 0);
    const i2 = soffitEm.v(b[0], hb, b[1], nx, 0, nz, u + len, thick);
    const i3 = soffitEm.v(a[0], ha, a[1], nx, 0, nz, u, thick);
    soffitEm.triFacing(i0, i2, i1, nx, 0, nz); soffitEm.triFacing(i0, i3, i2, nx, 0, nz);
    u += len;
  }
}

// Quad (4 points [x, y, z]) whose normal is computed from its corners and turned to face up; uv = 4 [u, v] (metres).
function quadUp(em, A, B, C, D, uv) {
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  nx /= l; ny /= l; nz /= l;
  const i0 = em.v(A[0], A[1], A[2], nx, ny, nz, uv[0][0], uv[0][1]), i1 = em.v(B[0], B[1], B[2], nx, ny, nz, uv[1][0], uv[1][1]);
  const i2 = em.v(C[0], C[1], C[2], nx, ny, nz, uv[2][0], uv[2][1]), i3 = em.v(D[0], D[1], D[2], nx, ny, nz, uv[3][0], uv[3][1]);
  em.triFacing(i0, i1, i2, nx, ny, nz); em.triFacing(i0, i2, i3, nx, ny, nz);
}

// Ridge / hip caps: a low inverted-V strip over every crease between plane i's region `reg` and a later plane
// (each crease is drawn once). yb = eave height (+ lift) the plane heights are measured from.
function emitCreaseCaps(em, reg, planes, i, yb) {
  const pi = planes[i], n = reg.length, w = 0.17;
  for (let e = 0; e < n; e++) {
    const p = reg[e], q = reg[(e + 1) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 0.4) continue;
    const hp = pi.a * p[0] + pi.b * p[1] + pi.c, hq = pi.a * q[0] + pi.b * q[1] + pi.c;
    for (let j = i + 1; j < planes.length; j++) {
      const pj = planes[j];
      if (Math.abs(pj.a * p[0] + pj.b * p[1] + pj.c - hp) > 2e-3 || Math.abs(pj.a * q[0] + pj.b * q[1] + pj.c - hq) > 2e-3) continue;
      const tx = (q[0] - p[0]) / len, tz = (q[1] - p[1]) / len;
      let mx = -tz, mz = tx;
      if ((pi.a - pj.a) * mx + (pi.b - pj.b) * mz > 0) { mx = -mx; mz = -mz; } // +m = into region i
      const side = (pl, s) => (pt) => { const x = pt[0] + mx * w * s, z = pt[1] + mz * w * s; return [x, yb + pl.a * x + pl.b * z + pl.c + 0.02, z]; };
      const Pi = side(pi, 1), Pj = side(pj, -1);
      const cp = [p[0], yb + hp + 0.075, p[1]], cq = [q[0], yb + hq + 0.075, q[1]];
      quadUp(em, Pi(p), Pi(q), cq, cp, [[0, 0], [len, 0], [len, w], [0, w]]);
      quadUp(em, Pj(q), Pj(p), cp, cq, [[len, 0], [0, 0], [0, w], [len, w]]);
      break;
    }
  }
}

// Gutters along the level eaves of a pitched roof (outline = eave line with overhang, same vertex order as ring)
// plus a downspout down the wall corner at the end of (at most two) of them.
function emitGutters(g, ring, outline, planes, yb, thick) {
  const n = ring.length;
  let hmin = Infinity;
  for (const p of outline) hmin = Math.min(hmin, envelope(planes, p[0], p[1]));
  const eaves = [];
  for (let i = 0; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1.5) continue;
    const ha = envelope(planes, a[0], a[1]), hb = envelope(planes, b[0], b[1]);
    if (Math.abs(ha - hb) > 0.03 || ha > hmin + 0.3 || envelopeKinks(planes, a[0], a[1], b[0], b[1]).length) continue;
    eaves.push({ i, a, len, h: ha, tx: (b[0] - a[0]) / len, tz: (b[1] - a[1]) / len });
  }
  const em = g.em;
  let spouts = 0;
  for (const e of eaves.sort((p, q) => q.len - p.len)) {
    const nx = e.tz, nz = -e.tx; // outward (ring is counter-clockwise)
    const y1 = yb + e.h - thick * 0.35, y0 = y1 - 0.13;
    emitFrameBox(em, null, em, e.a[0], e.a[1], e.tx, e.tz, nx, nz, -0.03, e.len + 0.03, -0.01, 0.13, y0, y1);
    if (spouts >= 2) continue;
    const w = ring[(e.i + 1) % n];
    const over = Math.max(0, (e.a[0] - ring[e.i][0]) * nx + (e.a[1] - ring[e.i][1]) * nz);
    const dx = w[0] - e.tx * 0.3 + nx * 0.08, dz = w[1] - e.tz * 0.3 + nz * 0.08;
    const gy = (g.heightAt ? g.heightAt(dx, dz) : g.groundY) - 0.05;
    if (y0 - gy < 1.6) continue;
    emitFrameBox(em, null, null, dx, dz, e.tx, e.tz, nx, nz, -0.045, 0.045, -0.045, 0.045, gy, y0 - 0.28);
    emitFrameBox(em, em, em, dx, dz, e.tx, e.tz, nx, nz, -0.04, 0.04, -0.04, over - 0.02, y0 - 0.34, y0 - 0.2);
    spouts++;
  }
}

// Brick chimney stack: shaft, a corbelled band, concrete crown and one or two clay flue pots.
export function emitChimney(brickEm, crownEm, potEm, cx, cz, hx, hz, angle, y0, y1, rnd) {
  emitBox(brickEm, null, cx, cz, hx, hz, angle, y0, y1 - 0.1);
  emitBox(brickEm, null, cx, cz, hx + 0.05, hz + 0.05, angle, y1 - 0.42, y1 - 0.3);
  emitBox(crownEm, crownEm, cx, cz, hx + 0.07, hz + 0.07, angle, y1 - 0.1, y1);
  const c = Math.cos(angle), s = Math.sin(angle);
  const nP = hx > 0.42 ? 2 : 1;
  for (let k = 0; k < nP; k++) {
    const u = nP === 1 ? 0 : (k - 0.5) * hx;
    emitCylinder(potEm, crownEm, cx + u * c, cz + u * s, 0.1 + rnd() * 0.03, y1, y1 + 0.28 + rnd() * 0.2, 6);
  }
}

/**
 * Flat roof: deck, parapet (inner face + coping) and optional cornice.
 *  ring/holes – footprint; roofY – top of the parapet; parapetH – parapet height above the deck
 *  em: { deck, parapetIn, coping, cornice }  (emitters; deck and cornice optional)
 */
export function emitFlatRoof(em, ring, holes, roofY, parapetH, opts = {}) {
  const deckY = roofY - parapetH;
  if (em.deck) emitCap(em.deck, ring, holes, deckY + 0.02, 1);
  const rings = [ring, ...holes];
  if (parapetH > 0.05) {
    const t = opts.parapetT ?? 0.3;
    const copH = opts.copingH ?? 0.1, copO = opts.copingOut ?? 0.06;
    for (const r of rings) {
      const inner = offsetRing(r, t, 2.5);
      const outer = offsetRing(r, -copO, 2.5);
      // inner face of the parapet (faces the roof): reverse the inset ring so (dz,-dx) points inward
      emitRingWall(em.parapetIn, inner.slice().reverse(), deckY, roofY + copH);
      // coping: top band + small outer lip
      emitRingBand(em.coping, outer, inner, roofY + copH, roofY + copH, 1);
      emitRingWall(em.coping, outer, roofY - 0.12, roofY + copH);
      emitRingBand(em.coping, r, outer, roofY - 0.12, roofY - 0.12, -1);
    }
  }
  if (em.cornice && opts.cornice) {
    const { out = 0.4, h = 0.55, y1 = deckY + 0.1 } = opts.cornice;
    const y0 = y1 - h;
    for (const r of rings) {
      const o = offsetRing(r, -out, 2.5);
      const oMid = offsetRing(r, -out * 0.55, 2.5);
      emitRingWall(em.cornice, o, y1 - h * 0.45, y1);
      // stepped underside: an angled bed-mould from the wall face to the corona
      emitRingBand(em.cornice, r, oMid, y0, y1 - h * 0.45 - 0.02, -1);
      emitRingWall(em.cornice, oMid, y1 - h * 0.45 - 0.02, y1 - h * 0.45);
      emitRingBand(em.cornice, oMid, o, y1 - h * 0.45, y1 - h * 0.45, -1);
      emitRingBand(em.cornice, o, r, y1, y1, 1);
    }
  }
}

// Soft dark band just inside the parapet, where dirt and water marks collect: a strip from the parapet's inner face
// (inset d0) inwards by `width`, in two steps (emEdge's tint at the parapet → emMid's at 30 % → emIn's, the deck
// colour, inside) so the grime concentrates at the wall. All emitters must write into the same buffer (same
// texture array). Narrow wings get a narrower band (or none), so the strip never folds over or leaves the deck.
export function emitDeckBand(emEdge, emMid, emIn, ring, holes, y, d0, width) {
  const inside = (x, z) => pointInRing(x, z, ring) && !holes.some((h) => pointInRing(x, z, h));
  for (const r of [ring, ...holes]) {
    if (r.length > 400) continue;
    const a = offsetRing(r, d0, 2.5);
    let b = null, w = width;
    for (; w >= 0.3 && !b; w *= 0.5) {
      const c = offsetRing(r, d0 + w, 2.5);
      if (bandOK(r, a, c, inside)) b = c;
    }
    if (!b) continue;
    const m = a.map((p, i) => [p[0] + (b[i][0] - p[0]) * 0.3, p[1] + (b[i][1] - p[1]) * 0.3]);
    const n = r.length;
    for (const [A, B, eA, eB] of [[a, m, emEdge, emMid], [m, b, emMid, emIn]]) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const i0 = eA.v(A[i][0], y, A[i][1], 0, 1, 0, A[i][0], -A[i][1]);
        const i1 = eA.v(A[j][0], y, A[j][1], 0, 1, 0, A[j][0], -A[j][1]);
        const i2 = eB.v(B[j][0], y, B[j][1], 0, 1, 0, B[j][0], -B[j][1]);
        const i3 = eB.v(B[i][0], y, B[i][1], 0, 1, 0, B[i][0], -B[i][1]);
        eA.triFacing(i0, i1, i2, 0, 1, 0); eA.triFacing(i0, i2, i3, 0, 1, 0);
      }
    }
  }
}
function bandOK(r, a, b, inside) {
  const n = r.length;
  for (let i = 0; i < n; i++) {
    if (!inside(a[i][0], a[i][1]) || !inside(b[i][0], b[i][1])) return false;
    const j = (i + 1) % n;
    const ex = r[j][0] - r[i][0], ez = r[j][1] - r[i][1];
    if (ex * ex + ez * ez < 0.09) continue; // tiny edges: a small fold is invisible
    if (ex * (b[j][0] - b[i][0]) + ez * (b[j][1] - b[i][1]) <= 0) return false; // inset edge collapsed / flipped
  }
  return true;
}

// Box whose top maps onto whole texture tiles (fan grilles, skylight frames): n tiles along the box's long side.
function boxTiled(sideEm, topEm, cx, cz, hx, hz, angle, y0, y1, tileW, tileH) {
  const ring = emitBox(sideEm, null, cx, cz, hx, hz, angle, y0, y1);
  const long = hx >= hz, nT = Math.max(1, Math.round((long ? hx : hz) / Math.max(0.2, long ? hz : hx)));
  const c = Math.cos(angle), s = Math.sin(angle);
  const P = (u, v) => [cx + u * c - v * s, cz + u * s + v * c];
  const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
  const uv = corners.map(([u, v]) => (long ? [((u + hx) / (2 * hx)) * nT * tileW, ((v + hz) / (2 * hz)) * tileH] : [((u + hx) / (2 * hx)) * tileW, ((v + hz) / (2 * hz)) * nT * tileH]));
  const idx = corners.map(([u, v], k) => { const p = P(u, v); return topEm.v(p[0], y1, p[1], 0, 1, 0, uv[k][0], uv[k][1]); });
  topEm.triFacing(idx[0], idx[1], idx[2], 0, 1, 0); topEm.triFacing(idx[0], idx[2], idx[3], 0, 1, 0);
  return ring;
}

// Rooftop equipment on a flat deck, inside the footprint and away from the edges: packaged HVAC units with fan
// grilles, small condensers, mushroom exhaust fans, vent stacks, roof hatches and (on big decks) skylights.
// em = { unit (louvred sides), top (fan-grille top), dark (painted metal), glass (skylight), curb }
export function emitRooftopUnits(em, ring, holes, deckY, frame, rnd, count, maxSize = 5, opts = {}) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const placed = [];
  const edgeDist = (x, z) => {
    let best = Infinity;
    for (const r of [ring, ...holes]) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const ax = r[j][0], az = r[j][1], ex = r[i][0] - ax, ez = r[i][1] - az;
        const l2 = ex * ex + ez * ez || 1e-9;
        let t = ((x - ax) * ex + (z - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
        if (d < best) best = d;
      }
    }
    return best;
  };
  const ang = frame.angle, c = Math.cos(ang), s = Math.sin(ang);
  const topTile = opts.topTile || 1.6;
  let tries = 0, n = 0;
  while (n < count && tries < count * 12) {
    tries++;
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    if (!pointInRing(x, z, ring) || holes.some((h) => pointInRing(x, z, h))) continue;
    const roll = rnd();
    const kind = opts.small ? (roll < 0.7 ? 'condenser' : roll < 0.85 ? 'vent' : 'hatch')
      : opts.skylights && roll < 0.13 ? 'skylight' : roll < 0.27 ? 'fan' : roll < 0.36 ? 'vent' : roll < 0.43 ? 'hatch' : roll < 0.58 ? 'condenser' : 'rtu';
    let hx, hz;
    if (kind === 'rtu') { hx = 0.8 + rnd() * (maxSize / 2 - 0.8); hz = 0.7 + rnd() * Math.min(1.1, maxSize / 2 - 0.9); }
    else if (kind === 'skylight') { hx = 0.8 + rnd() * 1.6; hz = 0.6 + rnd() * 0.8; }
    else if (kind === 'condenser') { hx = 0.4 + rnd() * 0.25; hz = 0.4 + rnd() * 0.2; }
    else if (kind === 'hatch') { hx = 0.5; hz = 0.45; }
    else { hx = hz = 0.45; }
    const rad = Math.hypot(hx, hz);
    if (edgeDist(x, z) < rad + (opts.small ? 0.5 : 1.2)) continue;
    if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + rad + 0.8)) continue;
    placed.push([x, z, rad]);
    n++;
    if (kind === 'rtu') {
      // packaged unit on a curb: louvred casing, fan grilles on top
      const h = 1.0 + rnd() * 1.3;
      emitBox(em.curb || em.unit, null, x, z, hx + 0.12, hz + 0.12, ang, deckY, deckY + 0.25);
      boxTiled(em.unit, em.top || em.unit, x, z, hx, hz, ang, deckY + 0.25, deckY + h, topTile, topTile);
      if (em.dark && rnd() < 0.6) {
        // supply / return duct dropping into the roof beside the unit
        const u = (hx + 0.35) * (rnd() < 0.5 ? -1 : 1), v = (rnd() - 0.5) * hz;
        emitBox(em.dark, em.dark, x + u * c - v * s, z + u * s + v * c, 0.3, 0.28, ang, deckY, deckY + 0.55 + rnd() * 0.3);
      }
    } else if (kind === 'condenser') {
      boxTiled(em.unit, em.top || em.unit, x, z, hx, hz, ang, deckY, deckY + 0.7 + rnd() * 0.25, topTile, topTile);
    } else if (kind === 'skylight') {
      // curb + glazed top (slightly pitched glazing reads as a ridge line)
      emitBox(em.curb || em.unit, null, x, z, hx, hz, ang, deckY, deckY + 0.35);
      if (em.glass) boxTiled(em.curb || em.unit, em.glass, x, z, hx - 0.05, hz - 0.05, ang, deckY + 0.35, deckY + 0.42, 1.2, 1.2);
    } else if (kind === 'fan') {
      // mushroom exhaust fan: curb, short stack, overhanging hood
      const dk = em.dark || em.unit;
      emitBox(em.curb || em.unit, null, x, z, 0.42, 0.42, ang, deckY, deckY + 0.3);
      emitCylinder(em.unit, null, x, z, 0.24, deckY + 0.3, deckY + 0.7, 8);
      emitCylinder(dk, dk, x, z, 0.46, deckY + 0.7, deckY + 0.95, 10);
    } else if (kind === 'vent') {
      const dk = em.dark || em.unit, k = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < k; i++) emitCylinder(dk, dk, x + (rnd() - 0.5) * 0.6, z + (rnd() - 0.5) * 0.6, 0.06 + rnd() * 0.06, deckY, deckY + 0.5 + rnd() * 0.9, 6);
    } else {
      const dk = em.dark || em.unit;
      emitBox(dk, dk, x, z, hx, hz, ang, deckY, deckY + 0.4);
    }
  }
  return placed;
}

// Dome (or onion-ish cupola) centred on (cx, cz): radius R, height H, sitting on y0.
export function emitDome(em, cx, cz, R, H, y0, lat = 8, lon = 24) {
  const rows = [];
  for (let i = 0; i <= lat; i++) {
    const phi = (i / lat) * (Math.PI / 2);
    const r = Math.cos(phi) * R, y = y0 + Math.sin(phi) * H;
    const row = [];
    for (let j = 0; j <= lon; j++) {
      const th = (j / lon) * Math.PI * 2;
      const x = cx + Math.cos(th) * r, z = cz + Math.sin(th) * r;
      // ellipsoid normal
      let nx = Math.cos(phi) * Math.cos(th) / R, ny = Math.sin(phi) / H, nz = Math.cos(phi) * Math.sin(th) / R;
      const l = Math.hypot(nx, ny, nz) || 1;
      row.push(em.v(x, y, z, nx / l, ny / l, nz / l, (j / lon) * Math.PI * 2 * R, (i / lat) * (Math.PI / 2) * (R + H) / 2));
    }
    rows.push(row);
  }
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j + 1], d = rows[i + 1][j];
      const th = ((j + 0.5) / lon) * Math.PI * 2, phi = ((i + 0.5) / lat) * (Math.PI / 2);
      const nx = Math.cos(phi) * Math.cos(th), ny = Math.sin(phi), nz = Math.cos(phi) * Math.sin(th);
      em.triFacing(a, b, c, nx, ny, nz); em.triFacing(a, c, d, nx, ny, nz);
    }
  }
}


// ---------------------------------------------------------------- street-front roof & cornice details
// Mansard FRONT (Pittsburgh / Victorian rowhouses): a steep slate slope rising from the street-facing wall line(s)
// to a flat deck at height H above the eaves. fronts = [{ ax, az, nx, nz }] (a point on the wall line + outward
// unit normal). Returns the plane set for emitPitchedRoof / envelope (last plane = the flat deck), or null when
// part of the footprint lies in front of a wall line (the slope would go negative there).
export function mansardFrontPlanes(ring, fronts, H, pitchDeg = 72) {
  const t = Math.tan(pitchDeg * DEG);
  const planes = [];
  for (const f of fronts) {
    for (const [x, z] of ring) if ((x - f.ax) * -f.nx + (z - f.az) * -f.nz < -0.3) return null;
    planes.push({ a: -t * f.nx, b: -t * f.nz, c: t * (f.ax * f.nx + f.az * f.nz) });
  }
  if (!planes.length) return null;
  planes.push({ a: 0, b: 0, c: H });
  return planes;
}

// Italianate cornice along street-facing wall segments: frieze board + corona (the brackets / dentils are small
// street detail, see storefronts.emitCorniceDetail).
// segs = [{ ox, oz, tx, tz, nx, nz, len }] (start point, along-wall unit, outward unit, length); yTop = top of the
// corona. em = painted trim emitter (tinted). opts: { out (projection), frieze (height), dentil (bool) }
export function emitBracketCornice(em, segs, yTop, opts = {}) {
  const out = opts.out ?? 0.55, ch = opts.corona ?? 0.3, fh = opts.frieze ?? 0.55;
  for (const s of segs) {
    if (s.len < 0.8) continue;
    const box = (s0, s1, d0, d1, y0, y1, top, bot) => emitFrameBox(em, top ? em : null, bot ? em : null, s.ox, s.oz, s.tx, s.tz, s.nx, s.nz, s0, s1, d0, d1, y0, y1);
    // frieze board, corona (with a small cymatium step on top)
    box(0, s.len, 0, 0.06, yTop - ch - fh, yTop - ch, false, true);
    box(-0.02, s.len + 0.02, 0, out, yTop - ch, yTop - 0.08, false, true);
    box(-0.02, s.len + 0.02, 0, out - 0.06, yTop - 0.08, yTop, true, false);
    if (opts.dentil) box(0, s.len, 0.06, 0.1, yTop - ch - 0.24, yTop - ch - 0.15, false, true); // bed moulding
  }
}
