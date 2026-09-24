// Sacred Heart Church, 310 Shady Avenue at Walnut Street (Carlton Strong, completed by Kaiser, Neal & Reid;
// begun 1924, choir 1929, façade window 1931, finished 1953). Grey, rock-faced random ashlar Gothic on a long
// north–south axis parallel to Shady Avenue:
//   · the south front on Walnut Street is one great gable filled almost entirely by a traceried window, over a
//     gabled portal, between stepped buttresses carrying pinnacles, with a low baptistery turret at the corner;
//   · a buttressed nave with large two-light aisle windows and a clerestory under a steep, pale grey-green metal
//     roof; low flat-roofed chapel ranges along both flanks and a gabled porch on the Shady Avenue side;
//   · a massive square tower at the east end of the nave with clasping buttresses, tall paired belfry lancets and
//     a flat top behind a pierced parapet with corner turrets;
//   · transepts with rose windows in their gables, a square-ended choir, and the three-storey stone rectory to
//     the north-west.
// Local frame: u runs north along the axis from the south front (x ≈ 1678.1, z ≈ −1417.2), v runs east.
// References (shapes only): photographs from Shady Avenue (east flank and tower, Wikimedia Commons / PHLF) and of
// the tower and rose-windowed transept from the north-east, the parish history, ESRI World Imagery and the OSM
// footprint w247904059.
import {
  MeshKit, frame, edge, holedWall, panel, rectPts, lancetPts, buttress, pinnacle, pyramid, prism, gableRoof, leanTo,
  coping, ngonRing, edgeBox, lodBuilding, registerBuilding,
} from './kenmawr-kit.js';
import { sacredStone, trimStone, stainedGlass, piercedParapet, kmAtlas, atlasUV, kmRoof, plainMat, addRelief } from './kenmawr-materials.js';
import { gWall as gWallK, hood, bays, outlineRect, gableOutline, tracery } from './kenmawr-gothic.js';
import { glz, cellUV, seamMetal } from './north-materials.js';
import { prng } from './north-kit.js';

export const SACRED_OSM = 'w247904059';
const ANG = (6.6 * Math.PI) / 180;
const F = frame([1678.1, -1417.15], [Math.sin(ANG), -Math.cos(ANG)], [Math.cos(ANG), Math.sin(ANG)]);
const FL = 46.6;
const Y = (h) => FL + h;
const CV = 2.2;                                     // nave centre line (v)
const H = { aisle: 7.8, aisleRoof: 11.2, clere: 19.0, ridge: 27.0, gable: 28.6, tower: 44.0, parapet: 45.6, tEave: 17.5, tRidge: 23.5 };
const NV = { v0: CV - 5.5, v1: CV + 5.5 };          // central vessel
const AI = { v0: -8.4, v1: 12.8 };                  // aisles' outer walls
const TW = { u0: 55, u1: 69, v0: CV - 7, v1: CV + 7 };
const TR = { u0: 69, u1: 77 };                      // transept
const CH = { u0: 77, u1: 91.5 };                    // choir

function materials(ctx) {
  return {
    stone: sacredStone(ctx), trim: trimStone(ctx), roof: seamMetal(ctx, { color: '#9aa8a7', seam: 0.5, metalness: 0.45, roughness: 0.42 }),
    sg: stainedGlass(ctx), dark: glz(ctx, 'dark'), glass: glz(ctx, 'winBuff'), atlas: kmAtlas(ctx), flat: kmRoof(ctx),
    pierced: piercedParapet(ctx, '#bdb6a8'), gold: plainMat(ctx, '#b8943c', { roughness: 0.35, metalness: 0.8 }),
  };
}
const side = (u0, v0, u1, v1, ou, ov) => F.edge(u0, v0, u1, v1, ou, ov);
function gWall(kit, E, outline, wins, detail, opts = {}) { return gWallK(kit, E, outline, wins, detail, { vRef: FL, trimKey: 'trim', ...opts }); }
const cope = (kit, E, s0, y0, s1, y1, w = 0.6, h = 0.22) => coping(kit, 'trim', E.P3(s0, y0, 0.04), E.P3(s1, y1, 0.04), w, h);
function gableCopings(kit, E, yE, yA, w = 0.65) { cope(kit, E, 0, yE, E.L / 2, yA, w, 0.26); cope(kit, E, E.L / 2, yA, E.L, yE, w, 0.26); }
function apexCross(kit, E, y) {
  const [x, z] = E.P(E.L / 2, 0.04);
  kit.box('trim', x, y + 0.9, z, 0.22, 1.8, 0.22, E.rot);
  kit.box('trim', x, y + 1.2, z, 1.0, 0.22, 0.22, E.rot);
}
// Rose window: a circle of stained glass with a trim ring and radiating spokes (fine) in wall E centred at (s, y).
function rose(kit, E, s, y, r, detail) {
  const seg = detail >= 2 ? 20 : 10, pts = [];
  for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push([s + Math.cos(a) * r, y + Math.sin(a) * r]); }
  return { pts, depth: 0.5, glass: 'sg', glassUV: 'metre', vRef: FL, reveal: 'trim', rose: { s, y, r } };
}
function roseTracery(kit, E, R) {
  const { s, y, r } = R, d = -0.3, n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    kit.beam('trim', E.P3(s + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, d), E.P3(s + Math.cos(a) * r * 0.98, y + Math.sin(a) * r * 0.98, d), 0.16, 0.14, { caps: false });
  }
  const seg = 12;
  for (let j = 0; j < seg; j++) {
    const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2, rr = r * 0.3;
    kit.beam('trim', E.P3(s + Math.cos(a0) * rr, y + Math.sin(a0) * rr, d), E.P3(s + Math.cos(a1) * rr, y + Math.sin(a1) * rr, d), 0.16, 0.14, { caps: false });
  }
}

// ------------------------------------------------------------------ nave, aisles, chapels
function nave(kit, S, detail) {
  const base = S.base, fine = detail >= 1, u1 = TW.u0;
  const nb = 7;
  for (const sg of [-1, 1]) {
    const v = sg < 0 ? AI.v0 : AI.v1;
    // aisle wall only where no chapel range stands in front of it (the chapels cover u 33.6 → 55)
    const E = sg < 0 ? side(u1, v, 0, v, 0, -1) : side(0, v, u1, v, 0, 1);
    const winsAll = bays(0.6, u1 - 0.6, nb, 1, 2.3, 0, Y(2.6), Y(6.0), { k: 0.9, depth: 0.45, mullions: 2 });
    const wins = winsAll.filter((w) => { const uc = sg < 0 ? u1 - (w.s0 + w.s1) / 2 : (w.s0 + w.s1) / 2; return uc < 33; });
    gWall(kit, E, outlineRect(E.L, base, Y(H.aisle + 0.8)), wins, detail);
    cope(kit, E, -0.1, Y(H.aisle + 0.8), E.L + 0.1, Y(H.aisle + 0.8), 0.55, 0.2);
    if (fine) for (let i = 0; i <= nb; i++) {
      const s = Math.min(E.L - 0.5, Math.max(0.5, 0.6 + ((u1 - 1.2) / nb) * i));
      const uc = sg < 0 ? u1 - s : s;
      if (uc > 33.2 && uc < u1 + 0.5) continue;
      buttress(kit, 'stone', E, s, base, [{ y1: Y(4.2), d: 1.3, w: 1.0 }, { y1: Y(H.aisle + 0.4), d: 0.8, w: 1.0 }], { capH: 0.5, vRef: FL });
    }
    leanTo(kit, 'roof', F, 0, u1, v - sg * 0.35, sg < 0 ? NV.v0 : NV.v1, Y(H.aisle + 0.4), Y(H.aisleRoof), 0);
    // clerestory
    const Ec = sg < 0 ? side(u1, NV.v0, 0, NV.v0, 0, -1) : side(0, NV.v1, u1, NV.v1, 0, 1);
    gWall(kit, Ec, outlineRect(Ec.L, Y(H.aisleRoof - 0.4), Y(H.clere + 0.8)), bays(0.6, u1 - 0.6, nb, 2, 1.0, 0.45, Y(12.3), Y(16.2), { k: 1.1, depth: 0.4 }), detail);
    cope(kit, Ec, 0, Y(H.clere + 0.8), Ec.L, Y(H.clere + 0.8));
    if (fine) for (let i = 1; i < nb; i++) edgeBox(kit, 'stone', Ec, 0.6 + ((u1 - 1.2) / nb) * i, 0.2, Y(H.aisleRoof - 0.3), Y(H.clere + 0.4), 0.8, 0.4, { px: 1, nx: 1, nz: 1, py: 1 }, FL);
  }
  gableRoof(kit, 'roof', F, 0, TW.u0, NV.v0, NV.v1, Y(H.clere + 0.3), Y(H.ridge), { axis: 'u', ov: 0.05 });
  // the aisles continue beside the tower (u 55 → 69) under lean-to roofs against it
  for (const sg of [-1, 1]) {
    const vo = sg < 0 ? AI.v0 : AI.v1, vi = sg < 0 ? TW.v0 : TW.v1;
    const E = sg < 0 ? side(TW.u1, vo, TW.u0, vo, 0, -1) : side(TW.u0, vo, TW.u1, vo, 0, 1);
    holedWall(kit, 'stone', E, outlineRect(E.L, base, Y(H.aisle + 0.8)), [], { vRef: FL });
    cope(kit, E, 0, Y(H.aisle + 0.8), E.L, Y(H.aisle + 0.8), 0.55, 0.2);
    leanTo(kit, 'roof', F, TW.u0, TW.u1, vo - sg * 0.35, vi, Y(H.aisle + 0.4), Y(H.aisleRoof), 0);
  }
  // flat-roofed chapel ranges (west u 33.6 → 70, east u 33.7 → 55) and the chapel beside the tower
  const ranges = [
    { u0: 33.6, u1: 70, v0: -16, v1: AI.v0, h: 6.6, west: true },
    { u0: 33.7, u1: 55, v0: AI.v1, v1: 16.8, h: 6.6 },
    { u0: 55, u1: 69, v0: AI.v1, v1: 19.8, h: 8.2 },
  ];
  for (const r of ranges) chapelRange(kit, S, r, detail);
  // gabled east porch on the Shady Avenue side
  {
    const u0 = 41.6, u1p = 49.2, v0 = 16.8, v1 = 24.8, yE = Y(7.2), yA = Y(11.4);
    const Ef = side(u0, v1, u1p, v1, 0, 1);
    const door = { pts: lancetPts(Ef.L / 2 - 1.5, Ef.L / 2 + 1.5, Y(0), Y(2.8), { k: 1, seg: detail >= 2 ? 5 : 3 }), depth: 1.0, back: 'atlas', glassUV: atlasUV('door'), reveal: 'trim', glassInset: 0.01 };
    const win = { s0: Ef.L / 2 - 1.0, s1: Ef.L / 2 + 1.0, sill: Y(6.0), spring: Y(7.6), k: 1, depth: 0.35 };
    if (detail === 0) { gWall(kit, Ef, gableOutline(Ef.L, S.base, yE, yA), [win], 0); panel(kit, 'atlas', Ef, door.pts, 0.03, atlasUV('door')); }
    else { holedWall(kit, 'stone', Ef, gableOutline(Ef.L, S.base, yE, yA), [door, { pts: lancetPts(win.s0, win.s1, win.sill, win.spring, { k: 1, seg: 4 }), depth: 0.35, glass: 'sg', glassUV: 'metre', vRef: FL, reveal: 'trim' }], { vRef: FL }); }
    gableCopings(kit, Ef, yE, yA, 0.55);
    apexCross(kit, Ef, yA);
    for (const [a, b, o] of [[[u0, v0], [u0, v1], [-1, 0]], [[u1p, v1], [u1p, v0], [1, 0]]]) {
      const Es = side(a[0], a[1], b[0], b[1], o[0], o[1]);
      holedWall(kit, 'stone', Es, outlineRect(Es.L, S.base, yE), [], { vRef: FL });
    }
    gableRoof(kit, 'roof', F, u0, u1p, v0 - 0.2, v1, yE, yA - 0.3, { axis: 'v', ov: 0.25, endOv: 0 });
    if (fine) for (const s of [0.4, Ef.L - 0.4]) buttress(kit, 'stone', Ef, s, S.base, [{ y1: Y(3.4), d: 0.9, w: 0.8 }, { y1: Y(6.9), d: 0.55, w: 0.8 }], { capH: 0.45, vRef: FL });
  }
}

function chapelRange(kit, S, r, detail) {
  const outer = r.west ? r.v0 : r.v1;
  const E = r.west ? side(r.u1, outer, r.u0, outer, 0, -1) : side(r.u0, outer, r.u1, outer, 0, 1);
  const n = Math.max(1, Math.round(E.L / 5.2));
  gWall(kit, E, outlineRect(E.L, S.base, Y(r.h + 0.8)), bays(0.4, E.L - 0.4, n, 1, 1.7, 0, Y(2.4), Y(4.9), { k: 1, depth: 0.35, mullions: detail >= 2 ? 2 : 0 }), detail);
  cope(kit, E, -0.1, Y(r.h + 0.8), E.L + 0.1, Y(r.h + 0.8), 0.5, 0.2);
  // end walls
  for (const [u, ou] of [[r.u0, -1], [r.u1, 1]]) {
    const inner = r.west ? AI.v0 : AI.v1;
    const Ee = side(u, r.west ? inner : outer, u, r.west ? outer : inner, ou, 0);
    holedWall(kit, 'stone', Ee, outlineRect(Ee.L, S.base, Y(r.h + 0.8)), [], { vRef: FL });
  }
  if (r.u0 === 55) leanTo(kit, 'roof', F, r.u0, r.u1, outer - 0.35, AI.v1, Y(r.h + 0.4), Y(r.h + 2.6), 0);
  else kit.cap('flat', F.rect(r.u0, r.u1, Math.min(r.v0, r.v1), Math.max(r.v0, r.v1)), Y(r.h + 0.2), true);
  if (detail >= 1) for (let i = 0; i <= n; i++) {
    const s = Math.min(E.L - 0.4, Math.max(0.4, 0.4 + ((E.L - 0.8) / n) * i));
    buttress(kit, 'stone', E, s, S.base, [{ y1: Y(3.6), d: 0.9, w: 0.8 }, { y1: Y(r.h + 0.5), d: 0.5, w: 0.8 }], { capH: 0.45, vRef: FL });
  }
}

// ------------------------------------------------------------------ south front
function front(kit, S, detail) {
  const base = S.base, fine = detail >= 1;
  const E = side(0, NV.v0, 0, NV.v1, -1, 0);          // looking north at it, s runs west → east
  const c = E.L / 2;
  const great = { s0: c - 4.1, s1: c + 4.1, sill: Y(7.6), spring: Y(19.2), k: 0.85, depth: 0.7, mullions: 5, noHood: false };
  const portal = { pts: lancetPts(c - 1.8, c + 1.8, Y(0), Y(4.2), { k: 1, seg: detail >= 2 ? 6 : 3 }), depth: 1.2, back: 'atlas', glassUV: atlasUV('door'), reveal: 'trim', glassInset: 0.01 };
  const outline = gableOutline(E.L, base, Y(H.clere + 0.8), Y(H.gable));
  if (detail === 0) {
    gWall(kit, E, outline, [great], 0);
    panel(kit, 'atlas', E, portal.pts, 0.03, atlasUV('door'));
  } else {
    const gh = { pts: lancetPts(great.s0, great.s1, great.sill, great.spring, { k: great.k, seg: detail >= 2 ? 7 : 4 }), depth: great.depth, glass: 'sg', glassUV: 'metre', vRef: FL, reveal: 'trim' };
    holedWall(kit, 'stone', E, outline, [gh, portal], { vRef: FL });
    if (detail >= 2) {
      hood(kit, 'trim', E, great.s0 - 0.2, great.s1 + 0.2, great.spring, great.k);
      tracery(kit, 'trim', E, great, great.mullions);
      edgeBox(kit, 'trim', E, c, 0.1, great.sill - 0.25, great.sill, great.s1 - great.s0 + 0.5, 0.2, null, FL);
    }
  }
  gableCopings(kit, E, Y(H.clere + 0.8), Y(H.gable), 0.75);
  apexCross(kit, E, Y(H.gable));
  // gabled portal projecting from the front
  {
    const d = 1.6, w = 6.4, yE = Y(6.2), yA = Y(9.8);
    const Ef = side(-d, CV - w / 2, -d, CV + w / 2, -1, 0);
    const hole = { pts: lancetPts(1.1, w - 1.1, Y(0), Y(4.2), { k: 1, seg: detail >= 2 ? 6 : 3 }), depth: d + 0.02, reveal: 'trim' };
    holedWall(kit, 'stone', Ef, gableOutline(w, base, yE, yA), detail === 0 ? [] : [hole], { vRef: FL });
    for (const sg of [-1, 1]) {
      const Es = sg > 0 ? side(-d, CV + w / 2, 0, CV + w / 2, 0, 1) : side(0, CV - w / 2, -d, CV - w / 2, 0, -1);
      holedWall(kit, 'stone', Es, outlineRect(Es.L, base, yE), [], { vRef: FL });
    }
    gableRoof(kit, 'trim', F, -d - 0.1, 0, CV - w / 2, CV + w / 2, yE, yA, { axis: 'u', ov: 0.2, endOv: 0 });
    gableCopings(kit, Ef, yE, yA, 0.5);
    if (fine) { const [px, pz] = Ef.P(w / 2, 0.05); kit.box('trim', px, yA + 0.6, pz, 0.35, 1.2, 0.35, Ef.rot); }
  }
  // stepped buttresses at the corners of the central vessel, ending in pinnacles above the eaves
  for (const s of [0.2, E.L - 0.2]) {
    if (fine) buttress(kit, 'stone', E, s, base, [{ y1: Y(7.0), d: 2.0, w: 1.6 }, { y1: Y(14.0), d: 1.4, w: 1.5 }, { y1: Y(H.clere + 0.8), d: 0.9, w: 1.4 }], { capH: 0.7, vRef: FL });
    else edgeBox(kit, 'stone', E, s, 0.7, base, Y(H.clere + 0.8), 1.5, 1.4, null, FL);
    const [px, pz] = E.P(s, 0.45);
    pinnacle(kit, 'trim', px, pz, Y(H.clere + 0.8), 1.3, 2.6, 3.4, E.rot);
  }
  // aisle ends
  for (const sg of [-1, 1]) {
    const Ea = sg < 0 ? side(0, AI.v0, 0, NV.v0, -1, 0) : side(0, NV.v1, 0, AI.v1, -1, 0);
    const out = sg < 0 ? [[0, base], [Ea.L, base], [Ea.L, Y(H.aisleRoof + 0.6)], [0, Y(H.aisle + 0.8)]] : [[0, base], [Ea.L, base], [Ea.L, Y(H.aisle + 0.8)], [0, Y(H.aisleRoof + 0.6)]];
    gWall(kit, Ea, out, [{ s0: Ea.L / 2 - 0.9, s1: Ea.L / 2 + 0.9, sill: Y(2.8), spring: Y(6.2), k: 1, depth: 0.4 }], detail);
  }
  // baptistery turret at the south-west corner (u 0 → 4.4, v -12.8 → -8.4)
  {
    const r = F.rect(0, 4.4, -12.8, -8.4), yT = Y(12.6);
    for (const [a, b, o] of [[[0, -8.4], [0, -12.8], [-1, 0]], [[0, -12.8], [4.4, -12.8], [0, -1]], [[4.4, -12.8], [4.4, -8.4], [1, 0]]]) {
      const Eb = side(a[0], a[1], b[0], b[1], o[0], o[1]);
      gWall(kit, Eb, outlineRect(Eb.L, base, yT), [{ s0: Eb.L / 2 - 0.35, s1: Eb.L / 2 + 0.35, sill: Y(6.5), spring: Y(9.2), k: 1, depth: 0.3 }], detail);
    }
    const [cx, cz] = F.W(2.2, -10.6);
    pyramid(kit, 'roof', r, yT, [cx, yT + 4.2, cz]);
    if (fine) kit.box('gold', cx, yT + 4.6, cz, 0.12, 0.9, 0.12, F.rotY);
  }
}

// ------------------------------------------------------------------ tower
function tower(kit, S, detail) {
  const fine = detail >= 1, y0 = Y(H.aisleRoof), yT = Y(H.tower);
  const faces = [
    side(TW.u0, TW.v0, TW.u1, TW.v0, 0, -1), side(TW.u1, TW.v0, TW.u1, TW.v1, 1, 0),
    side(TW.u1, TW.v1, TW.u0, TW.v1, 0, 1), side(TW.u0, TW.v1, TW.u0, TW.v0, -1, 0),
  ];
  for (const E of faces) {
    const c = E.L / 2;
    const belfry = [
      { s0: c - 2.9, s1: c - 0.6, sill: Y(31.2), spring: Y(38.8), k: 1.05, depth: 0.9, glass: 'dark', mullions: detail >= 2 ? 2 : 0 },
      { s0: c + 0.6, s1: c + 2.9, sill: Y(31.2), spring: Y(38.8), k: 1.05, depth: 0.9, glass: 'dark', mullions: detail >= 2 ? 2 : 0 },
    ];
    const blind = [-1.75, 1.75].map((o) => ({ s0: c + o - 0.9, s1: c + o + 0.9, sill: Y(24.0), spring: Y(28.2), k: 1, depth: 0.25, glass: 'dark', noHood: true }));
    gWall(kit, E, outlineRect(E.L, y0, yT), [...belfry, ...blind], detail, { seg: detail >= 2 ? 5 : 3 });
    if (fine) {
      kit.beam('trim', E.P3(-0.3, Y(30.8), 0.14), E.P3(E.L + 0.3, Y(30.8), 0.14), 0.3, 0.32, { caps: false });
      kit.beam('trim', E.P3(-0.3, Y(23.4), 0.14), E.P3(E.L + 0.3, Y(23.4), 0.14), 0.3, 0.3, { caps: false });
      kit.beam('trim', E.P3(-0.3, yT - 0.2, 0.2), E.P3(E.L + 0.3, yT - 0.2, 0.2), 0.42, 0.42, { caps: false });
      for (const s of [0.9, E.L - 0.9]) buttress(kit, 'stone', E, s, y0, [{ y1: Y(23.0), d: 1.3, w: 1.8 }, { y1: Y(33.0), d: 0.9, w: 1.7 }, { y1: yT - 0.4, d: 0.5, w: 1.6 }], { capH: 0.7, vRef: FL });
    }
    // parapet: pierced arcade between corner turrets
    const pk = detail >= 1 ? 'pierced' : 'stone', s0 = 1.6, s1 = E.L - 1.6;
    kit.quad(pk, E.P3(s0, yT, 0.02), E.P3(s1, yT, 0.02), E.P3(s1, Y(H.parapet), 0.02), E.P3(s0, Y(H.parapet), 0.02), E.n, [0, 0], [s1 - s0, 0], [s1 - s0, H.parapet - H.tower], [0, H.parapet - H.tower]);
    if (fine) kit.beam('trim', E.P3(s0, Y(H.parapet) + 0.1, 0), E.P3(s1, Y(H.parapet) + 0.1, 0), 0.4, 0.2, { caps: false });
  }
  kit.cap('flat', F.rect(TW.u0, TW.u1, TW.v0, TW.v1), yT - 0.05, true);
  // square corner turrets rising above the parapet, with small pyramid caps
  for (const [u, v] of [[TW.u0, TW.v0], [TW.u1, TW.v0], [TW.u1, TW.v1], [TW.u0, TW.v1]]) {
    const [px, pz] = F.W(u + Math.sign((TW.u0 + TW.u1) / 2 - u) * 0.9, v + Math.sign((TW.v0 + TW.v1) / 2 - v) * 0.9);
    kit.box('stone', px, yT + 1.2, pz, 2.0, 2.4, 2.0, F.rotY, { faces: { px: 1, nx: 1, pz: 1, nz: 1, py: 0 }, vRef: FL });
    pinnacle(kit, 'trim', px, pz, yT + 2.4, 1.6, 0.5, 1.6, F.rotY);
  }
}

// ------------------------------------------------------------------ transepts & choir
function eastEnd(kit, S, detail) {
  const base = S.base, fine = detail >= 1;
  // transept arms (ridge along v): west arm v -20.1 → NV.v0, east arm NV.v1 → 28.4
  for (const [vEnd, vIn, sg] of [[-20.1, NV.v0, -1], [28.4, NV.v1, 1]]) {
    const E = sg < 0 ? side(TR.u1, vEnd, TR.u0, vEnd, 0, -1) : side(TR.u0, vEnd, TR.u1, vEnd, 0, 1);
    const c = E.L / 2;
    const rw = rose(kit, E, c, Y(13.6), 2.7, detail);
    const lancets = [-1.5, 0, 1.5].map((o) => ({ s0: c + o - 0.5, s1: c + o + 0.5, sill: Y(4.0), spring: Y(9.0), k: 1.1, depth: 0.45 }));
    const outline = gableOutline(E.L, base, Y(H.tEave + 0.6), Y(H.tRidge + 1.4));
    if (detail === 0) { gWall(kit, E, outline, lancets, 0); panel(kit, 'sg', E, rw.pts, 0.03, 'metre', FL); }
    else {
      const holes = lancets.map((w) => ({ pts: lancetPts(w.s0, w.s1, w.sill, w.spring, { k: w.k, seg: 4 }), depth: w.depth, glass: 'sg', glassUV: 'metre', vRef: FL, reveal: 'trim' }));
      holedWall(kit, 'stone', E, outline, [...holes, rw], { vRef: FL });
      if (detail >= 2) roseTracery(kit, E, rw.rose);
    }
    gableCopings(kit, E, Y(H.tEave + 0.6), Y(H.tRidge + 1.4));
    apexCross(kit, E, Y(H.tRidge + 1.4));
    for (const s of [0.3, E.L - 0.3]) {
      if (fine) buttress(kit, 'stone', E, s, base, [{ y1: Y(6.0), d: 1.5, w: 1.1 }, { y1: Y(12.0), d: 1.0, w: 1.1 }, { y1: Y(H.tEave + 0.5), d: 0.6, w: 1.0 }], { capH: 0.6, vRef: FL });
      const [px, pz] = E.P(s, 0.3);
      pinnacle(kit, 'trim', px, pz, Y(H.tEave + 0.5), 1.0, 1.8, 2.4, E.rot);
    }
    // side walls of the arm
    for (const [u, ou] of [[TR.u0, -1], [TR.u1, 1]]) {
      const Es = (sg < 0) === (ou < 0) ? side(u, vIn, u, vEnd, ou, 0) : side(u, vEnd, u, vIn, ou, 0);
      gWall(kit, Es, outlineRect(Es.L, base, Y(H.tEave + 0.6)), [{ s0: Es.L / 2 - 1.1, s1: Es.L / 2 + 1.1, sill: Y(9.5), spring: Y(13.4), k: 1, depth: 0.4 }], detail);
      cope(kit, Es, 0, Y(H.tEave + 0.6), Es.L, Y(H.tEave + 0.6));
    }
    gableRoof(kit, 'roof', F, TR.u0, TR.u1, sg < 0 ? vEnd : vIn, sg < 0 ? vIn : vEnd, Y(H.tEave + 0.2), Y(H.tRidge), { axis: 'v', ov: 0.1 });
  }
  // choir (same section as the nave) with a square north end
  for (const [v, sg] of [[NV.v0, -1], [NV.v1, 1]]) {
    const E = sg < 0 ? side(CH.u1, v, CH.u0, v, 0, -1) : side(CH.u0, v, CH.u1, v, 0, 1);
    gWall(kit, E, outlineRect(E.L, base, Y(H.clere + 0.8)), bays(0.6, E.L - 0.6, 2, 1, 2.2, 0, Y(9.0), Y(15.0), { k: 1, depth: 0.45, mullions: 2 }), detail);
    cope(kit, E, 0, Y(H.clere + 0.8), E.L, Y(H.clere + 0.8));
    if (fine) for (const s of [0.4, E.L / 2, E.L - 0.4]) buttress(kit, 'stone', E, s, base, [{ y1: Y(8.0), d: 1.3, w: 1.0 }, { y1: Y(H.clere + 0.4), d: 0.7, w: 1.0 }], { capH: 0.6, vRef: FL });
  }
  gableRoof(kit, 'roof', F, TW.u1, CH.u1, NV.v0, NV.v1, Y(H.clere + 0.3), Y(H.ridge), { axis: 'u', ov: 0.05 });
  const En = side(CH.u1, NV.v1, CH.u1, NV.v0, 1, 0);
  gWall(kit, En, gableOutline(En.L, base, Y(H.clere + 0.8), Y(H.gable - 0.8)), [{ s0: En.L / 2 - 2.6, s1: En.L / 2 + 2.6, sill: Y(8.5), spring: Y(17.4), k: 0.9, depth: 0.6, mullions: 3 }], detail);
  gableCopings(kit, En, Y(H.clere + 0.8), Y(H.gable - 0.8));
  apexCross(kit, En, Y(H.gable - 0.8));
  // north-east sacristy (flat roof) and the link to the rectory
  const blocks = [
    { u0: CH.u0, u1: CH.u1, v0: NV.v1, v1: 16.8, h: 6.2 },
    { u0: 76.6, u1: 83.3, v0: -13.8, v1: NV.v0, h: 5.4 },
  ];
  for (const b of blocks) {
    const ring = F.rect(b.u0, b.u1, b.v0, b.v1);
    kit.ringWalls('stone', ring, base, Y(b.h + 0.6), { vRef: FL });
    kit.cap('flat', ring, Y(b.h + 0.3), true);
    if (fine) {
      const outer = [side(b.u0, b.v0, b.u1, b.v0, 0, -1), side(b.u1, b.v1, b.u0, b.v1, 0, 1), side(b.u1, b.v0, b.u1, b.v1, 1, 0)];
      for (const E of outer) cope(kit, E, 0, Y(b.h + 0.6), E.L, Y(b.h + 0.6), 0.5, 0.18);
    }
  }
}

// ------------------------------------------------------------------ rectory (u 83.3 → 102.7, v -44.3 → 0)
function rectory(kit, S, detail, rand) {
  const u0 = 83.3, u1 = 102.7, v0 = -44.3, v1 = -0.2, RF = 42.6, h = 11.4;
  const base = S.base;
  const sides = [
    side(u0, v0, u1, v0, 0, -1), side(u1, v0, u1, v1, 1, 0), side(u1, v1, u0, v1, 0, 1), side(u0, v1, u0, v0, -1, 0),
  ];
  for (const E of sides) {
    const holes = [];
    if (detail >= 1) {
      const n = Math.max(1, Math.floor((E.L - 1.2) / 3.6));
      for (let i = 0; i < n; i++) {
        const c = (E.L / n) * (i + 0.5);
        for (const sy of [1.2, 4.9, 8.4]) {
          const y = RF + sy;
          const tMax = Math.max(S.ctx.heightAt(...E.P(c - 0.9)), S.ctx.heightAt(...E.P(c + 0.9)));
          if (tMax > y - 0.3) continue;
          holes.push({ pts: rectPts(c - 0.9, c + 0.9, y, y + 1.9), depth: 0.3, glass: 'glass', glassUV: cellUV(rand), reveal: 'trim' });
        }
      }
    }
    holedWall(kit, 'stone', E, outlineRect(E.L, base, RF + h + 0.8), holes, { vRef: FL });
    if (detail >= 2) for (const hl of holes) {
      const [s0, y0] = hl.pts[0], [s1] = hl.pts[1], y1 = hl.pts[2][1];
      panel(kit, 'trim', E, rectPts((s0 + s1) / 2 - 0.06, (s0 + s1) / 2 + 0.06, y0, y1), -0.27, 'metre', FL);
      edgeBox(kit, 'trim', E, (s0 + s1) / 2, 0.06, y0 - 0.12, y0 + 0.02, s1 - s0 + 0.2, 0.14, null, FL);
      edgeBox(kit, 'trim', E, (s0 + s1) / 2, 0.05, y1, y1 + 0.2, s1 - s0 + 0.3, 0.12, null, FL);
    }
    cope(kit, E, -0.1, RF + h + 0.8, E.L + 0.1, RF + h + 0.8, 0.5, 0.2);
  }
  kit.cap('flat', F.rect(u0, u1, v0, v1), RF + h + 0.3, true);
  if (detail >= 1) {
    for (const [u, v] of [[87, -40], [99, -22], [90, -6]]) { const [x, z] = F.W(u, v); kit.box('stone', x, RF + h + 1.6, z, 1.2, 2.6, 0.9, F.rotY); }
  }
}

// ------------------------------------------------------------------ assembly
function* build(ctx, S, M, detail) {
  if (detail) { addRelief(M.stone); yield; addRelief(M.trim); yield; }
  const kit = new MeshKit();
  const rand = prng(1924);
  nave(kit, S, detail); yield;
  front(kit, S, detail); yield;
  tower(kit, S, detail); yield;
  eastEnd(kit, S, detail); yield;
  rectory(kit, S, detail, rand); yield;
  return kit.build(M, { name: detail ? 'sacred-fine' : 'sacred-coarse' });
}
function drain(it) { let r = it.next(); while (!r.done) r = it.next(); return r.value; }

export async function buildSacredHeart(ctx, def) {
  const b = ctx.data.buildings.find((x) => x.id === SACRED_OSM || x.osmId === SACRED_OSM);
  const S = { ctx, base: (b?.ground?.min ?? 41.4) - 1.0 };
  const t0 = performance.now();
  const M = materials(ctx);
  const t1 = performance.now();
  const low = ctx.quality?.level === 'low';
  // the distant level merges its small parts into fewer materials (fewer draw calls)
  const coarse = drain(build(ctx, S, { ...M, trim: M.stone, gold: M.stone, atlas: M.stone }, 0));
  const t2 = performance.now();
  const [cx, cz] = F.W((TW.u0 + TW.u1) / 2, CV);
  const obj = lodBuilding(ctx, {
    name: 'sacredHeart', centre: [cx, Y(18), cz], coarse,
    far: low ? 260 : 460, near: low ? 300 : 520,
    fine: () => build(ctx, S, M, low ? 1 : 2),
  });
  obj.name = 'landmark:sacredHeart';
  const add = (u0, u1, v0, v1, h, y0 = S.base) => ctx.colliders?.addPolygon(F.rect(u0, u1, v0, v1), y0, Y(h), SACRED_OSM);
  add(-1.6, TW.u0, AI.v0, AI.v1, H.ridge); add(TW.u0, TW.u1, TW.v0, TW.v1, H.parapet); add(TR.u0, TR.u1, -20.1, 28.4, H.tRidge);
  add(CH.u0, CH.u1, NV.v0, 16.8, H.ridge); add(33.6, 70, -16, AI.v0, 7.4); add(33.7, 55, AI.v1, 16.8, 7.4); add(55, 69, AI.v1, 19.8, 9);
  add(41.6, 49.2, 16.8, 24.8, 11); add(0, 4.4, -12.8, AI.v0, 17); add(83.3, 102.7, -44.3, -0.2, 8); add(76.6, 83.3, -13.8, NV.v0, 6);
  registerBuilding(ctx, obj, {
    key: def.key, name: def.name, nameZh: def.nameZh, osmId: SACRED_OSM,
    position: [cx, Y(30), cz], radius: 45, labelY: Y(H.parapet + 7), priority: 8, maxDistance: 2600,
  });
  obj.userData.buildMs = { materials: Math.round(t1 - t0), coarse: Math.round(t2 - t1), total: Math.round(performance.now() - t0) };
  return obj;
}
