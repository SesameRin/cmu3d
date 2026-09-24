// Hunt Armory (Captain Alfred E. Hunt Armory), 324 Emerson Street, Shadyside (W. G. Wilkins Co., 1911–16; NRHP
// 1991; since 2021 the Pittsburgh Penguins' community ice rink). A whole city block:
//   · along Emerson Street a two-storey Classical Revival front range in pale grey terracotta: a rusticated base,
//     giant pilasters with a full entablature and a panelled attic, tall upper windows over glass-block lights,
//     green vehicle doors, and projecting entrance pavilions with raised attics;
//   · at the north end the main pavilion: a great round-arched vehicle entrance with a green grille gate, the
//     "PENNSYLVANIA NATIONAL GUARD" frieze and "HUNT ARMORY" attic panel under a sculpted crest (the state arms
//     with eagle and horses);
//   · behind it the drill hall: brick side walls with pilaster strips, an upper storey clad in ribbed metal with a
//     clerestory band, a shallow gabled roof and a long glazed monitor along its ridge.
// Local frame: u runs north along the Emerson Street front from the south-east corner (x ≈ 1604.8, z ≈ −1390.8),
// v runs west into the block.
// References (shapes only): Wikimedia Commons photographs (Emerson Street front, main and south entrances, 2009 and
// 2023), the NRHP-based Wikipedia article, ESRI World Imagery (drill-hall roof and monitor) and OSM w545286747.
import {
  MeshKit, frame, edge, holedWall, panel, rectPts, roundPts, edgeBox, gableRoof, ccw, lodBuilding, registerBuilding,
} from './kenmawr-kit.js';
import { trimStone, kmAtlas, atlasUV, kmRoof, plainMat, addRelief } from './kenmawr-materials.js';
import { glz, cellUV, seamMetal } from './north-materials.js';
import { prng } from './north-kit.js';

export const ARMORY_OSM = 'w545286747';
const U = [0.1483, -0.9889], V = [-0.9889, -0.1483];
const F = frame([1604.8, -1390.8], U, V);
const FL = 42.4;
const Y = (h) => FL + h;
const FR = { v1: 9.0, top: 11.8, cornice: 10.3 };     // front range depth and heights
const HALL = { v0: 9.0, v1: 45.4, eave: 15.6, ridge: 19.4, monV0: 23.2, monV1: 31.2, monTop: 21.0 };
const NP = { u0: 112.2, u1: 134.0, v: 1.7 };            // north (main) pavilion
const PAV = [[7.5, 16.5], [51.5, 60.5]];                 // front pavilions (south entrance, middle)
const GARAGE = [29.2, 37.8, 68.0, 81.2, 94.4];          // green vehicle doors (bay centres, u)

function materials(ctx) {
  return {
    terra: trimStone(ctx), brick: ctx.materials.get('brickBrown'), metal: seamMetal(ctx, { color: '#8e969b', seam: 0.35, metalness: 0.55, roughness: 0.45 }),
    roof: kmRoof(ctx), glass: glz(ctx, 'winBuff'), block: glz(ctx, 'skylight', 1.2, 1.2), clere: glz(ctx, 'darkCurtain', 1.4, 1.2),
    dark: glz(ctx, 'dark'), atlas: kmAtlas(ctx), green: plainMat(ctx, '#2e4a3b', { roughness: 0.55, metalness: 0.3 }),
  };
}
const side = (u0, v0, u1, v1, ou, ov) => F.edge(u0, v0, u1, v1, ou, ov);

// ------------------------------------------------------------------ Emerson Street front (u 0 → 112.2, v = 0)
function front(kit, S, detail, rand) {
  const base = S.base, fine = detail >= 1;
  const Ef = F.edge(0, 0, NP.u0, 0, 0, -1);               // outward = −v (east, towards Emerson Street)
  const bay = 4.4;
  const holes = [];
  const extras = [];
  const inPav = (s) => PAV.some(([a, b]) => s > a - 0.3 && s < b + 0.3);
  const nb = Math.floor((NP.u0 - 1.0) / bay);
  const s0 = (NP.u0 - nb * bay) / 2;
  for (let i = 0; i < nb; i++) {
    const c = s0 + bay * (i + 0.5);
    if (inPav(c)) continue;
    const garage = GARAGE.some((g) => Math.abs(g - c) < bay / 2);
    // lower storey: glass-block light or a green vehicle door
    if (garage) holes.push({ pts: rectPts(c - 1.5, c + 1.5, Y(0), Y(4.2)), depth: 0.35, back: 'green', glassUV: 'metre', reveal: 'terra' });
    else holes.push({ pts: rectPts(c - 1.15, c + 1.15, Y(1.6), Y(4.0)), depth: 0.25, glass: 'block', glassUV: 'metre', reveal: 'terra' });
    // upper storey sash windows
    holes.push({ pts: rectPts(c - 1.0, c + 1.0, Y(5.0), Y(8.8)), depth: 0.3, glass: 'glass', glassUV: cellUV(rand), reveal: 'terra' });
    extras.push({ c, garage });
  }
  // pavilion doors
  for (const [a, b] of PAV) {
    const c = (a + b) / 2;
    holes.push({ pts: rectPts(c - 1.0, c + 1.0, Y(0.3), Y(3.4)), depth: 0.9, glass: 'glass', glassUV: cellUV(rand), reveal: 'terra' });
    holes.push({ pts: rectPts(c - 1.0, c + 1.0, Y(5.6), Y(8.6)), depth: 0.3, glass: 'glass', glassUV: cellUV(rand), reveal: 'terra' });
  }
  if (detail === 0) {
    holedWall(kit, 'terra', Ef, rectPts(0, NP.u0, base, Y(FR.top)), [], { vRef: FL });
    for (const h of holes) panel(kit, h.glass || h.back, Ef, h.pts, 0.03, h.glassUV === 'metre' || !h.glassUV ? 'metre' : h.glassUV, FL);
  } else {
    holedWall(kit, 'terra', Ef, rectPts(0, NP.u0, base, Y(FR.top)), holes, { vRef: FL });
  }
  // entablature, cornice and base course (continuous)
  kit.beam('terra', Ef.P3(-0.2, Y(FR.cornice + 0.3), 0.35), Ef.P3(NP.u0 + 0.2, Y(FR.cornice + 0.3), 0.35), 0.7, 0.6, { caps: true });
  if (fine) {
    kit.beam('terra', Ef.P3(-0.1, Y(9.75), 0.1), Ef.P3(NP.u0, Y(9.75), 0.1), 0.2, 1.1, { caps: false });
    kit.beam('terra', Ef.P3(-0.1, Y(0.6), 0.15), Ef.P3(NP.u0, Y(0.6), 0.15), 0.3, 1.2 + (FL - base) * 0, { caps: false });
    kit.beam('terra', Ef.P3(-0.1, Y(FR.top), 0.05), Ef.P3(NP.u0, Y(FR.top), 0.05), 0.4, 0.14, { caps: true });
    // giant pilasters between the bays (capital block at the top)
    for (let i = 0; i <= nb; i++) {
      const s = s0 + bay * i;
      if (inPav(s)) continue;
      edgeBox(kit, 'terra', Ef, s, 0.18, Y(1.2), Y(9.2), 0.9, 0.36, { px: 1, nx: 1, nz: 1, py: 1 }, FL);
      edgeBox(kit, 'terra', Ef, s, 0.24, Y(8.9), Y(9.3), 1.15, 0.48, null, FL);
    }
    // sills + a panel between the storeys
    for (const x of extras) {
      if (!x.garage) edgeBox(kit, 'terra', Ef, x.c, 0.05, Y(1.45), Y(1.6), 2.5, 0.12, null, FL);
      edgeBox(kit, 'terra', Ef, x.c, 0.05, Y(4.8), Y(5.0), 2.2, 0.12, null, FL);
      if (x.garage) edgeBox(kit, 'terra', Ef, x.c, 0.12, Y(4.2), Y(4.6), 3.4, 0.24, null, FL);
    }
  }
  // projecting pavilions with raised attics
  for (const [a, b] of PAV) pavilion(kit, S, Ef, a, b, detail);
  return Ef;
}

function pavilion(kit, S, Ef, a, b, detail) {
  const d = 0.55, base = S.base, fine = detail >= 1, top = Y(13.4);
  const Pf = F.edge(a, -d, b, -d, 0, -1);
  const c = (b - a) / 2;
  const holes = [
    { pts: rectPts(c - 1.0, c + 1.0, Y(0.3), Y(3.4)), depth: 0.9 + d, glass: 'glass', glassUV: 'metre', reveal: 'terra' },
    { pts: rectPts(c - 1.0, c + 1.0, Y(5.6), Y(8.6)), depth: 0.3 + d, glass: 'glass', glassUV: 'metre', reveal: 'terra' },
  ];
  holedWall(kit, 'terra', Pf, rectPts(0, b - a, base, top), detail === 0 ? [] : holes, { vRef: FL });
  if (detail === 0) for (const h of holes) panel(kit, 'glass', Pf, h.pts, 0.03, 'metre', FL);
  for (const [u, ou] of [[a, -1], [b, 1]]) {
    const Es = ou < 0 ? side(u, -d, u, 0, -1, 0) : side(u, 0, u, -d, 1, 0);
    holedWall(kit, 'terra', Es, rectPts(0, d, base, top), [], { vRef: FL });
  }
  kit.cap('roof', F.rect(a, b, -d, FR.v1 - 1), top, true);
  // attic returns behind the pavilion top
  const back = FR.v1 - 1;
  for (const [u, ou] of [[a, -1], [b, 1]]) {
    const Es = ou < 0 ? side(u, 0, u, back, -1, 0) : side(u, back, u, 0, 1, 0);
    holedWall(kit, 'terra', Es, rectPts(0, back, Y(FR.top - 0.3), top), [], { vRef: FL });
  }
  holedWall(kit, 'terra', side(b, back, a, back, 0, 1), rectPts(0, b - a, Y(FR.top - 0.3), top), [], { vRef: FL });
  kit.beam('terra', Pf.P3(-0.25, Y(FR.cornice + 0.3), 0.35), Pf.P3(b - a + 0.25, Y(FR.cornice + 0.3), 0.35), 0.7, 0.6, { caps: true });
  kit.beam('terra', Pf.P3(-0.2, top, 0.1), Pf.P3(b - a + 0.2, top, 0.1), 0.5, 0.22, { caps: true });
  if (fine) {
    for (const s of [0.6, b - a - 0.6]) edgeBox(kit, 'terra', Pf, s, 0.2, Y(1.2), Y(9.4), 1.1, 0.4, { px: 1, nx: 1, nz: 1, py: 1 }, FL);
    // door hood with a carved eagle block and the two globe lamps
    edgeBox(kit, 'terra', Pf, c, 0.35, Y(3.4), Y(4.0), 3.0, 0.7, null, FL);
    edgeBox(kit, 'terra', Pf, c, 0.2, Y(8.7), Y(9.6), 1.4, 0.4, null, FL);
    for (const s of [c - 1.5, c + 1.5]) { const [x, z] = Pf.P(s, 0.45); kit.box('glass', x, Y(2.6), z, 0.35, 0.35, 0.35, 0); }
    panel(kit, 'atlas', Pf, rectPts(c - 2.2, c + 2.2, Y(11.0), Y(11.8)), 0.03, atlasUV('huntName', 0.002));
  }
}

// ------------------------------------------------------------------ main pavilion (north end of the front)
function mainPavilion(kit, S, detail) {
  const base = S.base, fine = detail >= 1, { u0, u1 } = NP, v = NP.v, top = Y(13.0);
  const E = F.edge(u0, v, u1, v, 0, -1);
  const L = u1 - u0, c = L / 2;
  const arch = { pts: roundPts(c - 3.2, c + 3.2, Y(0), Y(5.4), detail >= 2 ? 12 : 6), depth: 1.4, back: 'green', glassUV: 'metre', reveal: 'terra' };
  const side2 = [c - 7.4, c + 7.4].map((x) => ({ pts: rectPts(x - 0.9, x + 0.9, Y(5.2), Y(8.2)), depth: 0.3, glass: 'glass', glassUV: 'metre', reveal: 'terra' }));
  const holes = [arch, ...side2];
  holedWall(kit, 'terra', E, rectPts(0, L, base, top), detail === 0 ? [] : holes, { vRef: FL });
  if (detail === 0) { panel(kit, 'green', E, arch.pts, 0.03); for (const h of side2) panel(kit, 'glass', E, h.pts, 0.03, 'metre', FL); }
  // the vehicle gate fills the lower part of the arch; above it a dark fanlight
  if (detail >= 1) panel(kit, 'dark', E, roundPts(c - 3.15, c + 3.15, Y(4.6), Y(5.4), 8).slice(0), -1.35);
  // frieze + attic inscriptions, cornice, rusticated piers, relief panels
  kit.beam('terra', E.P3(-0.3, Y(10.0), 0.4), E.P3(L + 0.3, Y(10.0), 0.4), 0.8, 0.6, { caps: true });
  kit.beam('terra', E.P3(-0.2, top, 0.1), E.P3(L + 0.2, top, 0.1), 0.5, 0.24, { caps: true });
  panel(kit, 'atlas', E, rectPts(c - 5.5, c + 5.5, Y(8.9), Y(9.55)), 0.04, atlasUV('huntGuard', 0.002));
  panel(kit, 'atlas', E, rectPts(c - 3.4, c + 3.4, Y(11.0), Y(12.0)), 0.04, atlasUV('huntName', 0.002));
  if (fine) {
    // arch surround (voussoirs as a thick ring) and keystone
    const ring = roundPts(c - 3.9, c + 3.9, Y(5.4), Y(5.4), detail >= 2 ? 12 : 6).slice(2);
    for (let i = 0; i < ring.length - 1; i++) kit.beam('terra', E.P3(ring[i][0], ring[i][1], 0.15), E.P3(ring[i + 1][0], ring[i + 1][1], 0.15), 0.3, 0.6, { caps: false });
    edgeBox(kit, 'terra', E, c, 0.25, Y(8.7), Y(9.8), 0.9, 0.5, null, FL);
    for (const s of [0.9, c - 5.2, c + 5.2, L - 0.9]) {
      edgeBox(kit, 'terra', E, s, 0.25, Y(0.8), Y(9.7), 1.6, 0.5, { px: 1, nx: 1, nz: 1, py: 1 }, FL);
      for (let y = 1.4; y < 9.2; y += 0.9) edgeBox(kit, 'terra', E, s, 0.52, Y(y), Y(y + 0.12), 1.64, 0.06, { nz: 1, py: 1 }, FL);
    }
    // sculpted relief panels on the inner piers (trophies of arms) — shallow blocks
    for (const s of [c - 5.2, c + 5.2]) for (let k = 0; k < 3; k++) edgeBox(kit, 'terra', E, s, 0.62, Y(3.0 + k * 1.9), Y(4.3 + k * 1.9), 0.8, 0.12, null, FL);
    // round medallions beside the arch
    for (const s of [c - 4.4, c + 4.4]) { const [x, z] = E.P(s, 0.1); kit.cylinder('terra', x, z, Y(7.1), Y(7.2), 0.45, 0.45, 12); }
  }
  // crest: the state arms (shield between rearing horses, eagle above) on a raised plinth over the attic
  crest(kit, E, c, top, detail);
  // returns of the pavilion (the front steps back 1.7 m at the pavilion's south end)
  const Er = F.edge(u0, 0, u0, v, 1, 0);                   // the step where the front sets back by 1.7 m
  holedWall(kit, 'terra', Er, rectPts(0, v, base, Y(FR.top)), [], { vRef: FL });
  kit.cap('roof', F.rect(u0, u1, v, FR.v1), top - 0.05, true);
}

function crest(kit, E, c, top, detail) {
  const P = (s, y, off) => E.P3(c + s, y, off);
  const box = (s, y0, y1, w, off, d) => { const [x, , z] = P(s, 0, off); kit.box('terra', x, (y0 + y1) / 2, z, w, y1 - y0, d, E.rot); };
  box(0, top, top + 1.2, 7.0, 0.3, 1.2);                 // plinth
  box(0, top + 1.2, top + 3.4, 1.8, 0.35, 0.6);          // shield
  if (detail >= 1) {
    box(0, top + 3.4, top + 3.9, 0.7, 0.35, 0.6);        // eagle body
    for (const sg of [-1, 1]) {
      // eagle wings (tilted slabs) and the rearing horses (stacked blocks)
      const [wx, , wz] = P(sg * 0.9, 0, 0.35);
      kit.box('terra', wx, top + 4.2, wz, 1.4, 0.35, 0.3, E.rot + sg * 0.0);
      box(sg * 2.2, top + 1.2, top + 2.6, 1.5, 0.35, 0.8);
      box(sg * 2.0, top + 2.6, top + 3.3, 0.7, 0.35, 0.5);
      box(sg * 3.1, top + 1.2, top + 1.8, 0.9, 0.35, 0.6);
    }
  }
}

// Part of a ring (world [x,z]) with local v >= vMin (Sutherland–Hodgman against one line).
function clipV(ring, vMin) {
  const loc = ring.map(([x, z]) => F.toLocal(x, z)), out = [];
  for (let i = 0; i < loc.length; i++) {
    const p = loc[i], q = loc[(i + 1) % loc.length], pin = p[1] >= vMin, qin = q[1] >= vMin;
    if (pin) out.push(p);
    if (pin !== qin) { const t = (vMin - p[1]) / (q[1] - p[1]); out.push([p[0] + (q[0] - p[0]) * t, vMin]); }
  }
  return out.map(([u, v]) => F.W(u, v));
}

// ------------------------------------------------------------------ drill hall
function drillHall(kit, S, detail, ring) {
  const base = S.base, fine = detail >= 1;
  // side / back walls: every footprint edge except the Emerson front (v ≈ 0) and the pavilion front (v ≈ 1.7)
  const r = ccw(ring);
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const va = F.toLocal(a[0], a[1])[1], vb = F.toLocal(b[0], b[1])[1];
    if (va < 2.5 && vb < 2.5) continue;                    // the Emerson Street fronts
    const E = edge(a, b);
    if (E.L < 1) continue;
    const brickTop = Y(HALL.eave - 3.6), top = Y(HALL.eave);
    const holes = [];
    const n = Math.floor(E.L / 5.2);
    if (detail >= 1) for (let k = 0; k < n; k++) {
      const s = (E.L / n) * (k + 0.5);
      holes.push({ pts: rectPts(s - 1.2, s + 1.2, Y(5.0), Y(9.2)), depth: 0.3, glass: 'glass', glassUV: 'metre', reveal: 'brick' });
    }
    holedWall(kit, 'brick', E, rectPts(0, E.L, base, brickTop), holes, { vRef: FL });
    // ribbed-metal upper storey with a clerestory band
    const cl = [{ pts: rectPts(0.6, E.L - 0.6, brickTop + 0.9, top - 0.7), depth: 0.12, glass: 'clere', glassUV: 'metre' }];
    holedWall(kit, 'metal', E, rectPts(0, E.L, brickTop, top), E.L > 3 && detail >= 1 ? cl : [], { vRef: FL });
    if (detail === 0 && E.L > 3) panel(kit, 'clere', E, cl[0].pts, 0.03, 'metre', FL);
    kit.beam('terra', E.P3(-0.1, brickTop, 0.08), E.P3(E.L + 0.1, brickTop, 0.08), 0.18, 0.3, { caps: false });
    if (fine) for (let k = 0; k <= n; k++) edgeBox(kit, 'brick', E, Math.min(E.L - 0.35, Math.max(0.35, (E.L / Math.max(1, n)) * k)), 0.12, base, brickTop, 0.7, 0.24, { px: 1, nx: 1, nz: 1, py: 1 }, FL);
  }
  // upper wall of the hall behind the front range (v = 9), clad in metal with the clerestory windows
  const Eu = F.edge(0, FR.v1, 133.8, FR.v1, 0, -1);
  const cl = { pts: rectPts(1, Eu.L - 1, Y(FR.top + 0.8), Y(HALL.eave - 0.6)), depth: 0.12, glass: 'clere', glassUV: 'metre' };
  holedWall(kit, 'metal', Eu, rectPts(0, Eu.L, Y(FR.top - 0.3), Y(HALL.eave)), detail >= 1 ? [cl] : [], { vRef: FL });
  if (detail === 0) panel(kit, 'clere', Eu, cl.pts, 0.03, 'metre', FL);
  // roofs: flat over the front range and the hall's edges, the shallow gable and the ridge monitor
  kit.cap('roof', F.rect(0, NP.u0, -0.05, FR.v1), Y(FR.top - 0.25), true);
  kit.cap('roof', clipV(ring, FR.v1), Y(HALL.eave - 0.05), true);
  gableRoof(kit, 'metal', F, 0.5, 133.5, HALL.v0, HALL.v1, Y(HALL.eave), Y(HALL.ridge), { axis: 'u', ov: 0.3, endOv: 0 });
  // gable ends (metal triangles)
  const vm = (HALL.v0 + HALL.v1) / 2;
  for (const u of [0.5, 133.5]) {
    const a = F.P(u, HALL.v0, Y(HALL.eave)), b = F.P(u, HALL.v1, Y(HALL.eave)), t = F.P(u, vm, Y(HALL.ridge));
    kit.triH('metal', a, b, t, F.D3(u < 1 ? -1 : 1, 0), [0, 0], [HALL.v1 - HALL.v0, 0], [(HALL.v1 - HALL.v0) / 2, HALL.ridge - HALL.eave]);
  }
  // monitor
  const slope = (HALL.ridge - HALL.eave) / (vm - HALL.v0);
  const yAt = (v) => Y(HALL.ridge - Math.abs(v - vm) * slope);
  for (const [v, ov] of [[HALL.monV0, -1], [HALL.monV1, 1]]) {
    const E = ov < 0 ? F.edge(4, v, 130, v, 0, -1) : F.edge(130, v, 4, v, 0, 1);
    const y0 = yAt(v) - 0.1;
    holedWall(kit, 'metal', E, rectPts(0, E.L, y0, Y(HALL.monTop)), detail >= 1 ? [{ pts: rectPts(0.5, E.L - 0.5, y0 + 0.35, Y(HALL.monTop) - 0.35), depth: 0.1, glass: 'clere', glassUV: 'metre' }] : [], { vRef: FL });
    if (detail === 0) panel(kit, 'clere', E, rectPts(0.5, E.L - 0.5, y0 + 0.35, Y(HALL.monTop) - 0.35), 0.03, 'metre', FL);
  }
  for (const u of [4, 130]) {
    const E = u < 5 ? F.edge(u, HALL.monV1, u, HALL.monV0, -1, 0) : F.edge(u, HALL.monV0, u, HALL.monV1, 1, 0);
    holedWall(kit, 'metal', E, [[0, yAt(HALL.monV1) - 0.1], [E.L, yAt(HALL.monV0) - 0.1], [E.L, Y(HALL.monTop)], [0, Y(HALL.monTop)]], [], { vRef: FL });
  }
  gableRoof(kit, 'metal', F, 3.6, 130.4, HALL.monV0, HALL.monV1, Y(HALL.monTop), Y(HALL.monTop + 0.9), { axis: 'u', ov: 0.4, endOv: 0.4 });
  // south end of the front range (terracotta return) — the rest of the south wall is part of the ring walls
  const Ese = F.edge(0, 0, 0, FR.v1, -1, 0);
  holedWall(kit, 'terra', Ese, rectPts(0, FR.v1, base, Y(FR.top)), [], { vRef: FL, off: 0.06 });
}

// ------------------------------------------------------------------ assembly
function* build(ctx, S, M, detail, ring) {
  if (detail) { addRelief(M.terra); yield; }
  const kit = new MeshKit();
  const rand = prng(1916);
  front(kit, S, detail, rand); yield;
  mainPavilion(kit, S, detail); yield;
  drillHall(kit, S, detail, ring); yield;
  return kit.build(M, { name: detail ? 'armory-fine' : 'armory-coarse' });
}
function drain(it) { let r = it.next(); while (!r.done) r = it.next(); return r.value; }

export async function buildArmory(ctx, def) {
  const t0 = performance.now();
  const b = ctx.data.buildings.find((x) => x.id === ARMORY_OSM || x.osmId === ARMORY_OSM);
  const ring = b ? b.footprint : [[1604.8, -1390.8], [1559.7, -1397.2], [1565, -1510.6], [1569, -1531.7], [1623.3, -1523.5], [1619.5, -1502.5], [1621.4, -1501.5]];
  const S = { ctx, base: (b?.ground?.min ?? 39.9) - 1.0 };
  const M = materials(ctx);
  const low = ctx.quality?.level === 'low';
  const t1 = performance.now();
  // the distant level merges its small parts into fewer materials (fewer draw calls)
  const coarse = drain(build(ctx, S, { ...M, green: M.brick, atlas: M.terra }, 0, ring));
  const t2 = performance.now();
  const [cx, cz] = F.W(67, 24);
  const obj = lodBuilding(ctx, {
    name: 'huntArmory', centre: [cx, Y(10), cz], coarse,
    far: low ? 240 : 400, near: low ? 280 : 460,
    fine: () => build(ctx, S, M, low ? 1 : 2, ring),
  });
  obj.name = 'landmark:huntArmory';
  ctx.colliders?.addPolygon(ring, S.base, Y(HALL.monTop + 1), ARMORY_OSM);
  registerBuilding(ctx, obj, {
    key: def.key, name: def.name, nameZh: def.nameZh, osmId: ARMORY_OSM,
    position: [cx, Y(HALL.monTop), cz], radius: 60, labelY: Y(HALL.monTop + 7), priority: 8, maxDistance: 1800,
  });
  obj.userData.buildMs = { materials: Math.round(t1 - t0), coarse: Math.round(t2 - t1), total: Math.round(performance.now() - t0) };
  return obj;
}
