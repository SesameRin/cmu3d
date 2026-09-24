// Phipps Conservatory and Botanical Gardens (Schenley Park, Pittsburgh).
//
// Modelled from the OSM footprints r2785563 (whole complex) and r18260908 (the 1893 glasshouse) plus research:
//   · 1893 Lord & Burnham Victorian glasshouse: white-painted iron + glass, long wings with curvilinear roofs and
//     apsidal (rounded) ends arranged symmetrically along a front spine that faces Schenley Drive (NE).
//     The Palm Court in the middle is the largest room: ~60 ft (18 m) wide and 65 ft (20 m) tall, with a two-tier roof
//     crowned by a reverse-curve (ogee) top, fleur-de-lis ridge cresting and tall finials at both ends.
//     Crossing pavilions (Fern Room / Victoria Room) rise over the wing intersections at both ends of the front.
//   · 2005 Welcome Center (IKM): mostly underground with a green roof and a neo-Victorian glass dome in front of the
//     Palm Court; visitors walk down into a sunken entrance court (Café Phipps).
//   · 2006 Tropical Forest Conservatory: tall south-facing glass wall, mono-pitch roof falling from south (~60 ft) to
//     north, concrete north/west walls; 2006 production greenhouses (ridge-and-furrow) further west.
// Local frame: u along the front spine (towards SE), w towards the back (SW); origin at the Palm Court.
import * as THREE from 'three';
import { buildingById } from '../core/placement.js';
import { GeoBatch, makeFrame, pointInRing } from './lib/oaklandB-geo.js';
import * as TX from './lib/oaklandB-tex.js';

const FRAME = makeFrame([-400, 442], (47 * Math.PI) / 180);
const GP = 44.6; // floor level of the Victorian glasshouse (plateau above Panther Hollow)

// ------------------------------------------------------------------------------------------------ profiles
/** Wall + curvilinear (quarter-ellipse) roof profile: [[inset, y, key], ...] for half-width a. */
function curvilinear(a, eave, ridge, steps = 7) {
  const p = [[0, -2.2, 'base'], [0, 0.85, 'base'], [0, eave, 'glass']];
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    p.push([a * (1 - Math.cos(t)), eave + (ridge - eave) * Math.sin(t), 'glass']);
  }
  return p;
}
/** Reverse-curve (ogee) crown from (i0, y0) to (i1, y1): convex below, concave towards the ridge. */
function ogee(i0, y0, i1, y1, steps = 10, key = 'glass') {
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const s = (1 - Math.cos(Math.PI * Math.pow(t, 0.85))) / 2;
    out.push([i0 + (i1 - i0) * s, y0 + (y1 - y0) * t, key]);
  }
  return out;
}
/** Quarter-ellipse lean-to from (i0,y0) to (i1,y1) (vertical tangent at the bottom). */
function lean(i0, y0, i1, y1, steps = 5, key = 'glass') {
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    out.push([i0 + (i1 - i0) * (1 - Math.cos(t)), y0 + (y1 - y0) * Math.sin(t), key]);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ builders
/**
 * Straight glass wing swept along one local axis, with optional apsidal (half-dome) ends.
 * spec: { axis:'u'|'w', c (cross-axis centre), s0, s1 (outer extents along the axis), a (half width),
 *         profile, ends:[e0,e1] each 'round'|'open', rooms (collects floor rectangles) }
 */
function wing(B, spec) {
  const { axis, c, a, profile } = spec;
  let { s0, s1 } = spec;
  const [e0, e1] = spec.ends;
  const sa = e0 === 'round' ? s0 + a : s0, sb = e1 === 'round' ? s1 - a : s1;
  const P = (s, x, y) => (axis === 'u' ? [s, y, c + x] : [c + x, y, s]);
  const F = (sideN, dy, dI) => (axis === 'u' ? [0, dI, sideN * dy] : [sideN * dy, dI, 0]);
  // cumulative slant distance along the profile (for the glazing texture)
  const sd = [0];
  for (let k = 1; k < profile.length; k++) sd.push(sd[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  const Y = (y) => GP + y;
  // straight sides
  for (const side of [1, -1]) {
    for (let k = 1; k < profile.length; k++) {
      const [i0, y0] = profile[k - 1], [i1, y1, key] = profile[k];
      const x0 = side * (a - i0), x1 = side * (a - i1);
      const vA = key === 'base' ? y0 : sd[k - 1], vB = key === 'base' ? y1 : sd[k];
      B.quad(key, P(sa, x0, Y(y0)), P(sb, x0, Y(y0)), P(sb, x1, Y(y1)), P(sa, x1, Y(y1)),
        [vA, sa], [vA, sb], [vB, sb], [vB, sa], F(side, y1 - y0, i1 - i0));
    }
  }
  // apses
  const seg = 12;
  for (const [mode, sc, dir] of [[e0, sa, -1], [e1, sb, 1]]) {
    if (mode !== 'round') continue;
    for (let j = 0; j < seg; j++) {
      const f0 = -Math.PI / 2 + (j / seg) * Math.PI, f1 = -Math.PI / 2 + ((j + 1) / seg) * Math.PI;
      const fm = (f0 + f1) / 2;
      for (let k = 1; k < profile.length; k++) {
        const [i0, y0] = profile[k - 1], [i1, y1, key] = profile[k];
        const r0 = a - i0, r1 = a - i1;
        const pt = (f, r, y) => P(sc + dir * Math.cos(f) * r, Math.sin(f) * r, Y(y));
        const radial = axis === 'u' ? [dir * Math.cos(fm), 0, Math.sin(fm)] : [Math.sin(fm), 0, dir * Math.cos(fm)];
        const dy = y1 - y0, dI = i1 - i0;
        const facing = [radial[0] * dy, dI, radial[2] * dy];
        const vA = key === 'base' ? y0 : sd[k - 1], vB = key === 'base' ? y1 : sd[k];
        B.quad(key, pt(f0, r0, y0), pt(f1, r0, y0), pt(f1, r1, y1), pt(f0, r1, y1),
          [vA, f0 * a], [vA, f1 * a], [vB, f1 * a], [vB, f0 * a], facing);
      }
    }
  }
  // white ironwork: ridge cap and eave gutters on the straight part
  const top = profile[profile.length - 1][1], eave = profile[2][1];
  const bx = (s0_, s1_, x0, x1, y0, y1) => {
    if (axis === 'u') B.box('white', s0_, s1_, Y(y0), Y(y1), c + x0, c + x1);
    else B.box('white', c + x0, c + x1, Y(y0), Y(y1), s0_, s1_);
  };
  bx(sa, sb, -0.14, 0.14, top - 0.05, top + 0.22);
  bx(sa, sb, a - 0.02, a + 0.16, eave - 0.18, eave + 0.02);
  bx(sa, sb, -a - 0.16, -a + 0.02, eave - 0.18, eave + 0.02);
  // floor bed
  const rect = axis === 'u' ? [[s0, c - a], [s1, c - a], [s1, c + a], [s0, c + a]] : [[c - a, s0], [c + a, s0], [c + a, s1], [c - a, s1]];
  spec.rooms?.push({ ring: rect, top: GP + top - 0.8 });
  B.polygon('bed', rect, GP + 0.08, 1);
}

/**
 * Glass pavilion lofted through stacked rounded-rectangle contours (Palm Court, crossing domes, Welcome Center dome).
 * spec: { cu, cw, hx (half extent along u), hz (along w), corner (radius or 'round'), profile, K }
 */
function pavilion(B, spec) {
  const { cu, cw, hx, hz, profile } = spec;
  const K = spec.K ?? 6;
  const contour = (d) => {
    const ex = Math.max(0, hx - d), ez = Math.max(0, hz - d);
    const rr = spec.corner === 'round' ? Math.min(ex, ez) : Math.max(0, Math.min(spec.corner, ex, ez));
    const pts = [];
    const corners = [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, (3 * Math.PI) / 2]];
    for (const [sx, sz, a0] of corners) {
      const ccx = sx * (ex - rr), ccz = sz * (ez - rr);
      for (let k = 0; k <= K; k++) {
        const a = a0 + (k / K) * (Math.PI / 2);
        pts.push([cu + ccx + Math.cos(a) * rr, cw + ccz + Math.sin(a) * rr]);
      }
    }
    return pts;
  };
  const base = contour(0);
  const arc = [0];
  for (let i = 1; i <= base.length; i++) {
    const p = base[i % base.length], q = base[i - 1];
    arc.push(arc[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  let prev = contour(profile[0][0]);
  let sd = 0;
  const N = base.length;
  for (let k = 1; k < profile.length; k++) {
    const [i0, y0] = profile[k - 1], [i1, y1, key] = profile[k];
    const cur = contour(i1);
    const sd1 = sd + Math.hypot(i1 - i0, y1 - y0);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      // outward normal of this contour segment (base contour)
      const ex = base[j][0] - base[i][0], ez = base[j][1] - base[i][1];
      const L = Math.hypot(ex, ez);
      let nx, nz;
      if (L > 1e-6) { nx = ez / L; nz = -ex / L; } else { nx = base[i][0] - cu; nz = base[i][1] - cw; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; }
      // make sure the normal points away from the centre
      const mx = (base[i][0] + base[j][0]) / 2 - cu, mz = (base[i][1] + base[j][1]) / 2 - cw;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      const dy = y1 - y0, dI = i1 - i0;
      const vA = key === 'base' ? y0 : sd, vB = key === 'base' ? y1 : sd1;
      B.quad(key,
        [prev[i][0], GP + y0, prev[i][1]], [prev[j][0], GP + y0, prev[j][1]], [cur[j][0], GP + y1, cur[j][1]], [cur[i][0], GP + y1, cur[i][1]],
        [vA, arc[i]], [vA, arc[i + 1]], [vB, arc[i + 1]], [vB, arc[i]], [nx * dy, dI, nz * dy]);
    }
    prev = cur;
    sd = sd1;
  }
  B.polygon('bed', base, GP + 0.08, 1);
  return base;
}

/** Finial: slender white lathe spike (h metres) at (u, y, w). */
function finial(B, u, y, w, h) {
  const g = new THREE.LatheGeometry([
    [0.001, 0], [0.16, 0], [0.12, 0.12], [0.07, 0.2], [0.14, 0.32], [0.06, 0.45], [0.05, 0.7], [0.11, 0.78], [0.04, 0.86], [0.02, 1], [0.001, 1.0],
  ].map(([x, yy]) => new THREE.Vector2(x * h * 0.9, yy * h)), 8);
  B.addGeometry('white', g, new THREE.Matrix4().makeTranslation(u, y, w));
}

/** Fleur-de-lis cresting along a ridge line from (u0,w0) to (u1,w1) at height y. */
function cresting(B, u0, w0, u1, w1, y, h = 0.8) {
  const L = Math.hypot(u1 - u0, w1 - w0);
  B.quad('cresting', [u0, y, w0], [u1, y, w1], [u1, y + h, w1], [u0, y + h, w0], [0, 0], [L, 0], [L, h], [0, h]);
}

// ------------------------------------------------------------------------------------------------ plants
function makePlants(ctx, rooms, rnd) {
  const shrubs = [], palms = [];
  for (const r of rooms) {
    // bounding box of the room's floor ring
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (const [u, w] of r.ring) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
    const area = (u1 - u0) * (w1 - w0);
    const n = Math.round(area / (r.density || 5.5));
    for (let i = 0; i < n; i++) {
      const u = u0 + 1.2 + rnd() * (u1 - u0 - 2.4), w = w0 + 1.2 + rnd() * (w1 - w0 - 2.4);
      if (!pointInRing(u, w, r.ring)) continue;
      // keep a central walkway free
      const cu = (u0 + u1) / 2, cw = (w0 + w1) / 2;
      const along = (u1 - u0) > (w1 - w0);
      if (Math.abs(along ? w - cw : u - cu) < 0.9) continue;
      const floorY = r.floorY ?? GP;
      const s = 0.4 + rnd() * rnd() * 1.3;
      shrubs.push({ u, w, y: floorY + s * 0.55, s, flower: rnd() < 0.12 });
    }
    const np = r.palms || 0;
    for (let i = 0; i < np; i++) {
      const u = u0 + 2 + rnd() * (u1 - u0 - 4), w = w0 + 2 + rnd() * (w1 - w0 - 4);
      if (!pointInRing(u, w, r.ring)) continue;
      const floorY = r.floorY ?? GP;
      const h = Math.min(r.top - floorY - 2.2, 5 + rnd() * (r.top - floorY - 6));
      if (h < 3) continue;
      palms.push({ u, w, y: floorY, h });
    }
  }
  const group = new THREE.Group();
  // shrubs: low-poly blobs with per-instance colour (greens + flowering accents)
  const shrubGeo = new THREE.IcosahedronGeometry(1, 1);
  shrubGeo.scale(1, 0.75, 1);
  const mat = TX.foliage(ctx);
  const inst = new THREE.InstancedMesh(shrubGeo, mat, shrubs.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  const FLOWERS = ['#b8404f', '#d9ad3c', '#cf8aa6', '#e6e2d6', '#9a5aa8', '#cf7440'];
  shrubs.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
    m.compose(new THREE.Vector3(p.u, p.y, p.w), q, new THREE.Vector3(p.s * (0.8 + rnd() * 0.4), p.s, p.s * (0.8 + rnd() * 0.4)));
    inst.setMatrixAt(i, m);
    if (p.flower) col.set(FLOWERS[(rnd() * FLOWERS.length) | 0]);
    else col.setHSL(0.23 + rnd() * 0.1, 0.35 + rnd() * 0.25, 0.16 + rnd() * 0.12);
    inst.setColorAt(i, col);
  });
  inst.castShadow = false; inst.receiveShadow = true;
  inst.name = 'phipps-shrubs';
  group.add(inst);
  // palms: trunk + drooping frond crown
  if (palms.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.11, 0.17, 1, 6, 1).translate(0, 0.5, 0);
    const crownGeo = palmCrown();
    const trunks = new THREE.InstancedMesh(trunkGeo, ctx.materials.color('#7a6a52', { roughness: 0.95 }), palms.length);
    const crowns = new THREE.InstancedMesh(crownGeo, mat, palms.length);
    palms.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.u, p.y, p.w), q.identity(), new THREE.Vector3(1, p.h, 1));
      trunks.setMatrixAt(i, m);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      const cs = 0.75 + p.h * 0.035;
      m.compose(new THREE.Vector3(p.u, p.y + p.h, p.w), q, new THREE.Vector3(cs, cs, cs));
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, col.setHSL(0.25 + rnd() * 0.05, 0.42, 0.2 + rnd() * 0.07));
    });
    trunks.name = 'phipps-palm-trunks'; crowns.name = 'phipps-palm-crowns';
    group.add(trunks, crowns);
  }
  return group;
}

/** Palm crown: 9 arching fronds (double-sided strips), ~3 m radius at scale 1. */
function palmCrown() {
  const pos = [], nor = [];
  const fronds = 9;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + (f % 2) * 0.2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const steps = 5;
    let prevL = null, prevR = null;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const r = t * 2.6;
      const y = 0.5 * Math.sin(t * Math.PI * 0.9) - t * t * 1.1 + (f % 3) * 0.08;
      const wdt = 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.04;
      const cx = ca * r, cz = sa * r;
      const L = [cx - sa * wdt, y, cz + ca * wdt], R = [cx + sa * wdt, y, cz - ca * wdt];
      if (prevL) {
        for (const tri of [[prevL, prevR, R], [prevL, R, L], [prevL, R, prevR], [prevL, L, R]]) {
          for (const v of tri) { pos.push(...v); nor.push(0, 1, 0); }
        }
      }
      prevL = L; prevR = R;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------------------------------------ build
async function buildPhipps(ctx) {
  const whole = buildingById(ctx.data, 'r2785563');
  const victorian = buildingById(ctx.data, 'r18260908');
  if (!whole) { console.warn('[phipps] footprint r2785563 missing'); return null; }
  const F = FRAME;
  const hAt = (u, w) => { const [x, z] = F.toWorld(u, w); return ctx.heightAt(x, z); };
  // aux = [floor height of the room behind the glass, night dimming] for the glass glow shader (see oaklandB-tex.js)
  const B = new GeoBatch({ aux: true });
  B.aux = [GP, 0];
  const rooms = [];
  let seed = 1893;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  // ---------------------------------------------------------------- 1893 Victorian glasshouse
  const wingProf = curvilinear(5.45, 4.3, 8.6);
  const spineProf = curvilinear(4.85, 4.7, 9.4);
  const W = (o) => wing(B, { rooms, ...o });
  // west crossing wing (Fern Room crossing, Orchid / Stove rooms) — apses at both ends
  W({ axis: 'w', c: -54.65, s0: -29.4, s1: -4.0, a: 5.45, profile: wingProf, ends: ['round', 'open'] });
  W({ axis: 'w', c: -54.65, s0: 12.2, s1: 37.8, a: 5.45, profile: wingProf, ends: ['open', 'round'] });
  // east crossing wing (Victoria Room crossing, Broderie / East rooms)
  W({ axis: 'w', c: 65.1, s0: -29.6, s1: -3.9, a: 5.5, profile: curvilinear(5.5, 4.3, 8.6), ends: ['round', 'open'] });
  W({ axis: 'w', c: 65.1, s0: 12.2, s1: 37.8, a: 5.5, profile: curvilinear(5.5, 4.3, 8.6), ends: ['open', 'round'] });
  // front spine: Serpentine Room (NW arm) and Sunken Garden (SE arm)
  W({ axis: 'u', c: 4.4, s0: -49.2, s1: -15.2, a: 4.85, profile: spineProf, ends: ['open', 'open'] });
  W({ axis: 'u', c: 4.3, s0: 25.5, s1: 59.6, a: 4.85, profile: spineProf, ends: ['open', 'open'] });
  // wing E (behind the Sunken Garden)
  W({ axis: 'w', c: 51.4, s0: 8.8, s1: 35.7, a: 5.4, profile: curvilinear(5.4, 4.1, 8.2), ends: ['open', 'round'] });
  // South Conservatory (parallel to the front), split around its central crossing
  const dProf = curvilinear(5.35, 4.4, 8.8);
  W({ axis: 'u', c: 28.55, s0: -30.5, s1: -3.7, a: 5.35, profile: dProf, ends: ['round', 'open'] });
  W({ axis: 'u', c: 28.55, s0: 14.1, s1: 41.1, a: 5.35, profile: dProf, ends: ['open', 'round'] });
  // links: Palm Court → South Conservatory, South Conservatory → Tropical Forest, Palm Court → Welcome Center dome
  W({ axis: 'w', c: 5.2, s0: 13.6, s1: 23.2, a: 7.6, profile: curvilinear(7.6, 4.6, 9.6), ends: ['open', 'open'] });
  W({ axis: 'w', c: 5.25, s0: 33.9, s1: 47.0, a: 6.4, profile: curvilinear(6.4, 4.3, 8.4), ends: ['open', 'open'] });
  W({ axis: 'w', c: 5.1, s0: -12.3, s1: -5.2, a: 5.2, profile: curvilinear(5.2, 3.8, 6.8), ends: ['open', 'open'] });

  // Palm Court: 18.8 m wide, two-tier roof with an ogee crown to ~20 m
  const pc = { cu: 5.15, cw: 4.2, hx: 20.35, hz: 9.4 };
  const pcProf = [[0, -2.2, 'base'], [0, 0.85, 'base'], [0, 6.8, 'glass'], ...lean(0, 6.8, 3.0, 10.0),
    [3.0, 12.3, 'glass'], ...ogee(3.0, 12.3, 9.4, 20.1, 12)];
  pavilion(B, { ...pc, corner: 3.2, profile: pcProf, K: 5 });
  rooms.push({ ring: [[-15, -5], [25.3, -5], [25.3, 13.4], [-15, 13.4]], top: GP + 19, palms: 14, density: 7 });
  // white bands at the eave and clerestory, ridge cresting + finials
  const ridgeHalf = pc.hx - pc.hz;
  cresting(B, pc.cu - ridgeHalf, pc.cw, pc.cu + ridgeHalf, pc.cw, GP + 20.05, 0.9);
  finial(B, pc.cu - ridgeHalf, GP + 19.9, pc.cw, 2.4);
  finial(B, pc.cu + ridgeHalf, GP + 19.9, pc.cw, 2.4);
  // crossing pavilions with ogee domes (both ends of the front)
  const crossProf = (hmin) => [[0, -2.2, 'base'], [0, 0.85, 'base'], [0, 5.4, 'glass'], ...lean(0, 5.4, 1.3, 6.9, 4),
    [1.3, 7.9, 'glass'], ...ogee(1.3, 7.9, hmin, 13.8, 9)];
  for (const cx of [{ cu: -54.65, cw: 4.1, hx: 5.45, hz: 8.1 }, { cu: 65.1, cw: 4.15, hx: 5.5, hz: 8.05 }]) {
    pavilion(B, { ...cx, corner: 1.6, profile: crossProf(Math.min(cx.hx, cx.hz)), K: 4 });
    const rh = cx.hz - cx.hx;
    cresting(B, cx.cu, cx.cw - rh, cx.cu, cx.cw + rh, GP + 13.75, 0.6);
    finial(B, cx.cu, GP + 13.6, cx.cw - rh, 1.6);
    finial(B, cx.cu, GP + 13.6, cx.cw + rh, 1.6);
    rooms.push({ ring: [[cx.cu - cx.hx + 0.5, cx.cw - cx.hz + 0.5], [cx.cu + cx.hx - 0.5, cx.cw - cx.hz + 0.5], [cx.cu + cx.hx - 0.5, cx.cw + cx.hz - 0.5], [cx.cu - cx.hx + 0.5, cx.cw + cx.hz - 0.5]], top: GP + 12, palms: 2 });
  }
  // South Conservatory crossing (raised pavilion)
  pavilion(B, { cu: 5.2, cw: 28.55, hx: 8.9, hz: 5.35, corner: 1.2, K: 3,
    profile: [[0, -2.2, 'base'], [0, 0.85, 'base'], [0, 5.0, 'glass'], ...lean(0, 5.0, 1.2, 6.4, 4), [1.2, 7.2, 'glass'], ...ogee(1.2, 7.2, 5.35, 11.6, 8)] });
  rooms.push({ ring: [[-3.2, 23.7], [13.6, 23.7], [13.6, 33.4], [-3.2, 33.4]], top: GP + 10.5, palms: 2 });
  cresting(B, 5.2 - 3.5, 28.55, 5.2 + 3.5, 28.55, GP + 11.55, 0.5);

  // ---------------------------------------------------------------- 2005 Welcome Center: glass dome + sunken court
  const wc = { cu: 5.2, cw: -20.0, r: 7.7 };
  pavilion(B, { cu: wc.cu, cw: wc.cw, hx: wc.r, hz: wc.r, corner: 'round', K: 6,
    profile: [[0, -2.5, 'base'], [0, 0.6, 'base'], [0, 2.8, 'frit'], ...lean(0, 2.8, wc.r - 1.1, 7.2, 7, 'frit')] });
  // lantern on top of the dome
  B.addGeometry('frit', new THREE.CylinderGeometry(1.1, 1.1, 1.0, 12, 1, true), new THREE.Matrix4().makeTranslation(wc.cu, GP + 7.7, wc.cw));
  B.addGeometry('white', new THREE.ConeGeometry(1.35, 0.9, 12), new THREE.Matrix4().makeTranslation(wc.cu, GP + 8.6, wc.cw));
  finial(B, wc.cu, GP + 9.0, wc.cw, 1.3);
  // Sunken entrance court (the walkway ramps down ~4 m to the Welcome Center's lower level): white railing around the
  // edge following the ground, glazed entrance front on the dome side under the green-roof fascia.
  {
    const cu = 3.6, cw = -37.6, R = 10.8;
    const seg = 32;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const p0 = [cu + Math.cos(a0) * R, cw + Math.sin(a0) * R], p1 = [cu + Math.cos(a1) * R, cw + Math.sin(a1) * R];
      const g0 = hAt(p0[0], p0[1]), g1 = hAt(p1[0], p1[1]);
      if (Math.sin(am) > 0.5) {
        // glazed Welcome Center entrance facing the court (+ white fascia/coping above it)
        const top = GP + 0.25;
        B.aux = [GP - 4.3, -1]; // lit lobby front: evenly lit
        B.wall('frit', p0[0], p0[1], p1[0], p1[1], Math.min(g0, GP - 4.3) - 0.3, Math.min(g1, GP - 4.3) - 0.3, top, top, [-Math.cos(am), -Math.sin(am)], GP - 4.3);
        B.wall('white', p0[0], p0[1], p1[0], p1[1], top, top, top + 0.45, top + 0.45, [-Math.cos(am), -Math.sin(am)], top);
        B.aux = [GP, 0];
        continue;
      }
      // railing: posts + top rail following the ground
      B.box('white', p0[0] - 0.05, p0[0] + 0.05, g0 - 0.2, g0 + 1.05, p0[1] - 0.05, p0[1] + 0.05);
      const ty0 = g0 + 1.0, ty1 = g1 + 1.0;
      B.quad('white', [p0[0], ty0, p0[1]], [p1[0], ty1, p1[1]], [p1[0], ty1 + 0.08, p1[1]], [p0[0], ty0 + 0.08, p0[1]], [0, 0], [1, 0], [1, 0.1], [0, 0.1], [Math.cos(am), 0, Math.sin(am)]);
      B.quad('white', [p0[0], ty0, p0[1]], [p1[0], ty1, p1[1]], [p1[0], ty1 + 0.08, p1[1]], [p0[0], ty0 + 0.08, p0[1]], [0, 0], [1, 0], [1, 0.1], [0, 0.1], [-Math.cos(am), 0, -Math.sin(am)]);
    }
    // Paved court floor draped over the terrain (the DEM already carries the ~4 m dip of the real sunken court),
    // on a fine polar grid so it hugs the ground; UVs = local metres.
    const rings = 7, rOuter = R - 0.15;
    const at = (k, i) => {
      const rr = (k / rings) * rOuter, a = (i / seg) * Math.PI * 2;
      const u = cu + Math.cos(a) * rr, w = cw + Math.sin(a) * rr;
      return [[u, hAt(u, w) + 0.06, w], [u, w]];
    };
    // triangles emitted facing up explicitly (the centre ring's quads are degenerate on one side)
    const upTri = (A, Bv, C, ua, ub, uc) => {
      const ny = (Bv[2] - A[2]) * (C[0] - A[0]) - (Bv[0] - A[0]) * (C[2] - A[2]);
      if (ny >= 0) B.tri('court', A, Bv, C, ua, ub, uc); else B.tri('court', A, C, Bv, ua, uc, ub);
    };
    const kPlanter = 2; // the inner rings are a raised round planter
    for (let k = kPlanter; k < rings; k++) {
      for (let i = 0; i < seg; i++) {
        const [a, ua] = at(k, i), [b, ub] = at(k, i + 1), [c, uc] = at(k + 1, i + 1), [d, ud] = at(k + 1, i);
        upTri(a, b, c, ua, ub, uc);
        upTri(a, c, d, ua, uc, ud);
      }
    }
    // raised planter: limestone curb + planted bed + shrubs
    const pr = (kPlanter / rings) * rOuter, curbTop = 0.45;
    const gc = hAt(cu, cw);
    const planterRing = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [cu + Math.cos(a0) * pr, cw + Math.sin(a0) * pr], p1 = [cu + Math.cos(a1) * pr, cw + Math.sin(a1) * pr];
      planterRing.push(p0);
      const g0 = hAt(p0[0], p0[1]), g1 = hAt(p1[0], p1[1]);
      const am = (a0 + a1) / 2;
      B.wall('base', p0[0], p0[1], p1[0], p1[1], g0 - 0.3, g1 - 0.3, gc + curbTop, gc + curbTop, [Math.cos(am), Math.sin(am)], gc);
    }
    B.ringLoft('base', planterRing, [[0.12, gc + curbTop], [0.12, gc + curbTop + 0.08], [-0.25, gc + curbTop + 0.08], [-0.25, gc + curbTop - 0.05]]);
    B.polygon('bed', planterRing, gc + curbTop - 0.05, 1);
    rooms.push({ ring: planterRing, top: gc + 6, floorY: gc + curbTop - 0.05, density: 2.2, palms: 0 });
    const [pcx, pcz] = F.toWorld(cu, cw);
    ctx.colliders.addCircle(pcx, pcz, pr + 0.1, gc - 1, gc + curbTop, 'phipps');
  }

  // ---------------------------------------------------------------- 2006 Tropical Forest Conservatory
  {
    const GT = 40.4; // floor level (the building is cut into the slope towards Panther Hollow)
    B.aux = [GT, 0];
    const main = [[-8.8, 47.0], [31.1, 47.1], [31.1, 68.6], [30.3, 68.8], [26.6, 71.9], [22.7, 74.9], [19.0, 76.8], [15.3, 78.2],
      [11.6, 78.8], [7.9, 78.8], [2.9, 77.5], [-2.1, 74.9], [-5.2, 72.3], [-7.7, 69.6], [-8.9, 69.6]];
    const roofY = (u, w) => 50.4 + (w - 47) * 0.26;
    const bot = (u, w) => Math.min(hAt(u, w), GT) - 1.2;
    for (let i = 0; i < main.length; i++) {
      const a = main[i], b = main[(i + 1) % main.length];
      const du = b[0] - a[0], dw = b[1] - a[1], L = Math.hypot(du, dw);
      let nu = dw / L, nw = -du / L;
      const mu = (a[0] + b[0]) / 2 - 10, mw = (a[1] + b[1]) / 2 - 62;
      if (nu * mu + nw * mw < 0) { nu = -nu; nw = -nw; }
      const south = nw > 0.25 || (a[1] > 68 && b[1] > 68);
      const key = south ? 'glassM' : 'concrete';
      B.wall(key, a[0], a[1], b[0], b[1], bot(a[0], a[1]), bot(b[0], b[1]), roofY(a[0], a[1]), roofY(b[0], b[1]), [nu, nw], GT);
    }
    B.polygonSloped('glassM', main, roofY);
    // roof vent bands (white)
    for (let w = 50; w < 78; w += 5.5) {
      B.quad('white', [-8.5, roofY(0, w) + 0.06, w], [30.8, roofY(0, w) + 0.06, w], [30.8, roofY(0, w + 0.5) + 0.06, w + 0.5], [-8.5, roofY(0, w + 0.5) + 0.06, w + 0.5], [0, 0], [1, 0], [1, 1], [0, 1], [0, 1, 0]);
    }
    rooms.push({ ring: [[-7, 49], [29, 49], [29, 70], [15, 76], [0, 74], [-7, 68]], top: 55, floorY: GT, palms: 9, density: 6 });
    B.polygon('bed', main, GT + 0.1, 1);
    // east annex (lower glass hall)
    const annex = [[31.1, 52.6], [56.0, 52.6], [56.1, 69.9], [53.4, 70.0], [49.6, 66.8], [45.4, 65.8], [37.4, 66.0], [33.0, 67.3], [31.1, 68.6]];
    const annexTop = (u, w) => 49.6 + (w - 52.6) * 0.05;
    for (let i = 0; i < annex.length; i++) {
      const a = annex[i], b = annex[(i + 1) % annex.length];
      if (Math.abs(a[0] - 31.1) < 0.01 && Math.abs(b[0] - 31.1) < 0.01) continue; // shared with the main hall
      const du = b[0] - a[0], dw = b[1] - a[1], L = Math.hypot(du, dw);
      let nu = dw / L, nw = -du / L;
      const mu = (a[0] + b[0]) / 2 - 43, mw = (a[1] + b[1]) / 2 - 60;
      if (nu * mu + nw * mw < 0) { nu = -nu; nw = -nw; }
      B.wall(nw > 0.3 ? 'glassM' : 'concrete', a[0], a[1], b[0], b[1], bot(a[0], a[1]), bot(b[0], b[1]), annexTop(a[0], a[1]), annexTop(b[0], b[1]), [nu, nw], GT);
    }
    B.polygonSloped('glassM', annex, annexTop);
    rooms.push({ ring: [[32, 54], [55, 54], [55, 68], [32, 66]], top: 48, floorY: GT, palms: 2, density: 8 });
  }

  // ---------------------------------------------------------------- 2006 production greenhouses (ridge-and-furrow)
  {
    const poly = [[-8.9, 69.6], [-9.0, 97.5], [-34.1, 96.8], [-34.2, 100.3], [-43.1, 100.1], [-43.4, 103.5], [-52.5, 103.7], [-52.6, 107.2],
      [-66.2, 106.9], [-66.3, 100.3], [-67.5, 100.3], [-67.4, 103.2], [-71.0, 103.0], [-70.8, 100.3], [-75.3, 100.2], [-75.4, 86.9],
      [-84.6, 86.7], [-84.6, 70.9], [-86.7, 70.9], [-86.7, 67.2], [-84.6, 67.2], [-84.6, 48.6], [-70.8, 48.8], [-70.8, 42.5],
      [-8.7, 42.5], [-8.6, 47.0]];
    const span = 8.4;
    const u0 = -84.6, u1 = -8.7;
    const nStrips = Math.round((u1 - u0) / span);
    const sw = (u1 - u0) / nStrips;
    for (let s = 0; s < nStrips; s++) {
      const ua = u0 + s * sw, ub = ua + sw, um = (ua + ub) / 2;
      // w-extent of the polygon along the strip centre line
      const hits = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if ((a[0] - um) * (b[0] - um) < 0) hits.push(a[1] + ((um - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
      }
      if (hits.length < 2) continue;
      hits.sort((x, y) => x - y);
      const w0 = hits[0] + 0.1, w1 = hits[hits.length - 1] - 0.1;
      // terrace the floor: highest ground at the north end, stepped per strip
      let gmin = Infinity;
      for (let w = w0; w <= w1; w += 4) gmin = Math.min(gmin, hAt(um, w));
      const floor = Math.max(gmin, hAt(um, w0) - 3.2);
      const eave = floor + 4.0, ridge = floor + 5.9;
      B.aux = [floor, 0.85]; // back-of-house growing houses: only dim work lighting at night
      const gb = (u, w) => Math.min(hAt(u, w), floor) - 0.8;
      // concrete knee wall + glass sides
      B.wall('concrete', ua, w0, ua, w1, gb(ua, w0), gb(ua, w1), floor + 0.6, floor + 0.6, [-1, 0], floor);
      B.wall('concrete', ub, w1, ub, w0, gb(ub, w1), gb(ub, w0), floor + 0.6, floor + 0.6, [1, 0], floor);
      B.wall('glassM', ua, w0, ua, w1, floor + 0.6, floor + 0.6, eave, eave, [-1, 0], floor);
      B.wall('glassM', ub, w1, ub, w0, floor + 0.6, floor + 0.6, eave, eave, [1, 0], floor);
      // gable ends
      for (const [w, n] of [[w0, -1], [w1, 1]]) {
        B.wall('concrete', ua, w, ub, w, gb(ua, w), gb(ub, w), floor + 0.6, floor + 0.6, [0, n], floor);
        B.wall('glassM', ua, w, ub, w, floor + 0.6, floor + 0.6, eave, eave, [0, n], floor);
        const A = [ua, eave, w], Bp = [ub, eave, w], C = [um, ridge, w];
        if (n > 0) B.tri('glassM', A, Bp, C, [0, 0], [sw, 0], [sw / 2, 2]); else B.tri('glassM', Bp, A, C, [0, 0], [sw, 0], [sw / 2, 2]);
      }
      // roof planes
      const slope = Math.hypot(sw / 2, ridge - eave);
      B.quad('glassM', [ua, eave, w0], [ua, eave, w1], [um, ridge, w1], [um, ridge, w0], [0, w0], [0, w1], [slope, w1], [slope, w0], [-1, 1, 0]);
      B.quad('glassM', [ub, eave, w1], [ub, eave, w0], [um, ridge, w0], [um, ridge, w1], [0, w1], [0, w0], [slope, w0], [slope, w1], [1, 1, 0]);
      B.box('white', um - 0.12, um + 0.12, ridge - 0.05, ridge + 0.15, w0, w1);
      B.polygon('bed', [[ua, w0], [ub, w0], [ub, w1], [ua, w1]], floor + 0.1, 1);
      rooms.push({ ring: [[ua + 0.5, w0 + 0.5], [ub - 0.5, w0 + 0.5], [ub - 0.5, w1 - 0.5], [ua + 0.5, w1 - 0.5]], top: eave, floorY: floor, density: 16 });
    }
  }

  // ---------------------------------------------------------------- assemble
  const mats = {
    glass: TX.phippsGlass(ctx, 'victorian'),
    glassM: TX.phippsGlass(ctx, 'modern'),
    frit: TX.phippsGlass(ctx, 'frit'),
    white: TX.phippsWhite(ctx),
    cresting: TX.phippsCresting(ctx),
    base: ctx.materials.get('limestone'),
    concrete: ctx.materials.get('concrete'),
    bed: TX.plantBed(ctx),
    court: TX.courtPaver(ctx),
  };
  const group = B.build(mats, {
    shadows: { glass: { cast: false }, glassM: { cast: false }, frit: { cast: false }, cresting: { cast: true }, bed: { cast: false }, court: { cast: false } },
    aux: { glass: true, glassM: true, frit: true },
  });
  group.add(makePlants(ctx, rooms, rnd));
  group.name = 'landmark:phipps';
  group.position.set(F.origin[0], 0, F.origin[1]);
  group.rotation.y = F.rotationY;
  group.updateMatrixWorld(true);

  // ---------------------------------------------------------------- colliders, picking, label
  ctx.colliders.addPolygon(whole.footprint, whole.ground.min - 4, GP + 22, 'phipps');
  if (victorian) ctx.colliders.addPolygon(victorian.footprint, victorian.ground.min - 4, GP + 22, 'phipps');
  const [wcx, wcz] = F.toWorld(wc.cu, wc.cw);
  ctx.colliders.addCircle(wcx, wcz, wc.r, GP - 5, GP + 9, 'phipps');
  const [lx, lz] = F.toWorld(pc.cu, pc.cw);
  const entry = {
    key: 'phipps', kind: 'landmark', name: 'Phipps Conservatory and Botanical Gardens', nameZh: '菲普斯温室植物园',
    osmId: 'r2785563', infoKey: 'phipps', position: [lx, GP + 10, lz], radius: 80,
  };
  ctx.pick.add(group, entry);
  ctx.labels.add({ key: 'phipps', text: 'Phipps Conservatory', textZh: '菲普斯温室植物园', kind: 'landmark', priority: 8, position: { x: lx, y: GP + 27, z: lz }, maxDistance: 1800 });
  return group;
}

export default [
  {
    key: 'phipps',
    name: 'Phipps Conservatory and Botanical Gardens',
    nameZh: '菲普斯温室植物园',
    osmIds: ['r2785563', 'r18260908'],
    build: buildPhipps,
  },
];
