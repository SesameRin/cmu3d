// Calvary Episcopal Church, 315 Shady Avenue at Walnut Street (Ralph Adams Cram, 1906–07; NRHP 2012).
// English Gothic of the 13th century in pale grey-buff limestone, 208 ft long and 108 ft across the transepts:
//   · a buttressed nave with lean-to aisles and a clerestory of paired lancets, a steep slate roof behind parapets;
//   · the west front on Shady Avenue: a steep gable with a triple lancet window over a deep pointed portal under
//     its own gable, flanked by octagonal stair turrets with spirelets;
//   · transepts with tall grouped lancets in their gable ends, and a square-ended chancel with a great east window;
//   · the crossing tower: stepped angle buttresses, two tall paired belfry lancets on every face under hood arches,
//     a pierced quatrefoil parapet with corner pinnacles, and a slender octagonal stone spire with three tiers of
//     lucarnes rising to about 220 ft;
//   · a three-storey Tudor-Gothic parish house to the north (1907) around a small court.
// Local frame: u runs east along the church axis from the west front (x ≈ 1746.9, z ≈ −1460.4), v runs north.
// References (shapes only): Wikimedia Commons photographs (west front 1907 and 2023, south flank from the Shady /
// Walnut corner, tower and spire close-ups, north elevation), the parish's published dimensions, ESRI World
// Imagery and the OSM footprint w170954640.
import * as THREE from 'three';
import {
  MeshKit, frame, edge, holedWall, opening, panel, rectPts, lancetPts, lancetApex, buttress, pinnacle, pyramid,
  prism, gableRoof, leanTo, coping, spire, ngonRing, edgeBox, ccw, lodBuilding, registerBuilding, signBoard,
} from './kenmawr-kit.js';
import { calvaryStone, slate, stainedGlass, piercedParapet, kmAtlas, atlasUV, plainMat, kmRoof, addRelief } from './kenmawr-materials.js';
import { glz, cellUV } from './north-materials.js';
import { gWall as gWallK, hood, bays, outlineRect, gableOutline } from './kenmawr-gothic.js';
import { prng } from './north-kit.js';

export const CALVARY_OSM = 'w170954640';
const ANG = Math.atan2(2.7, 26.9);
const EU = [Math.cos(ANG), Math.sin(ANG)], EV = [Math.sin(ANG), -Math.cos(ANG)];   // east along the axis, north
const F = frame([1746.85, -1460.35], EU, EV);
const FL = 47.0;                        // nave floor
const Y = (h) => FL + h;
// heights above the floor
const H = { aisle: 8.4, aisleRoof: 11.6, clere: 17.8, ridge: 25.8, gable: 27.8, tower: 36.4, parapet: 37.9, spire: 67.4, ph: 11.2, phRidge: 16.4 };
const TW = { u0: 32, u1: 44, v0: -6, v1: 6 };           // crossing tower (square)
const SP = { u: 38, v: 0, r0: 4.75 };                    // spire

function materials(ctx) {
  return {
    stone: calvaryStone(ctx), slate: slate(ctx), sg: stainedGlass(ctx), pierced: piercedParapet(ctx, '#cfc7b7'),
    atlas: kmAtlas(ctx), dark: glz(ctx, 'dark'), glass: glz(ctx, 'winBuff'), roof: kmRoof(ctx),
    lead: plainMat(ctx, '#5b6166', { roughness: 0.55, metalness: 0.4 }),
    gold: plainMat(ctx, '#b8943c', { roughness: 0.35, metalness: 0.8 }),
  };
}

// Wall of the local rectangle side from (u0,v0) to (u1,v1) (outside = local (ou,ov)) between yb and yt.
function side(u0, v0, u1, v1, ou, ov) { return F.edge(u0, v0, u1, v1, ou, ov); }

// Gothic walls in this building's floor reference (see kenmawr-gothic.js)
function gWall(kit, E, outline, wins, detail, opts = {}) { return gWallK(kit, E, outline, wins, detail, { vRef: FL, ...opts }); }

// ------------------------------------------------------------------ main volumes
function nave(kit, S, detail) {
  const base = S.base, fine = detail >= 1;
  // --- aisles (south v = -10.7, north v = +10.7), u 0 → 32
  for (const [v, sg] of [[-10.7, -1], [10.7, 1]]) {
    const E = sg < 0 ? side(0, v, 32, v, 0, -1) : side(32, v, 0, v, 0, 1);
    // south aisle: 5 bays of paired lancets, the second bay holds the side porch
    const wins = bays(0.8, 31.2, 5, 2, 0.95, 0.45, Y(3.2), Y(6.4), { k: 1.1 }).filter((w) => !(sg < 0 && w.s0 > 19.5 && w.s1 < 26));
    gWall(kit, E, outlineRect(E.L, base, Y(H.aisle + 0.9)), wins, detail);
    if (fine) {
      for (let i = 0; i <= 5; i++) {
        const s = Math.min(E.L - 0.45, Math.max(0.45, 0.8 + (30.4 / 5) * i));
        buttress(kit, 'stone', E, s, base, [{ y1: Y(4.6), d: 1.25, w: 0.95 }, { y1: Y(H.aisle + 0.5), d: 0.75, w: 0.95 }], { capH: 0.5, vRef: FL });
      }
    }
    // parapet coping on the aisle wall
    coping(kit, 'stone', E.P3(-0.1, Y(H.aisle + 0.9), 0.05), E.P3(E.L + 0.1, Y(H.aisle + 0.9), 0.05), 0.55, 0.2);
    // lean-to roof from behind the parapet up to the clerestory wall
    leanTo(kit, 'slate', F, 0, 32, v - sg * 0.35, sg * 5.6, Y(H.aisle + 0.4), Y(H.aisleRoof), 0);
  }
  // --- clerestory walls v = ±5.6 above the aisle roofs
  for (const [v, sg] of [[-5.6, -1], [5.6, 1]]) {
    const E = sg < 0 ? side(0, v, 32, v, 0, -1) : side(32, v, 0, v, 0, 1);
    const wins = bays(0.8, 31.2, 5, 2, 1.0, 0.5, Y(12.6), Y(15.9), { k: 1.1, depth: 0.4 });
    gWall(kit, E, outlineRect(E.L, Y(H.aisleRoof - 0.4), Y(H.clere + 0.8)), wins, detail);
    if (fine) for (let i = 1; i < 5; i++) edgeBox(kit, 'stone', E, 0.8 + (30.4 / 5) * i, 0.2, Y(H.aisleRoof - 0.3), Y(H.clere + 0.4), 0.8, 0.4, { px: 1, nx: 1, nz: 1, py: 1 }, FL);
    coping(kit, 'stone', E.P3(0, Y(H.clere + 0.8), 0.02), E.P3(E.L, Y(H.clere + 0.8), 0.02), 0.6, 0.22);
  }
  gableRoof(kit, 'slate', F, 0, TW.u0, -5.6, 5.6, Y(H.clere + 0.3), Y(H.ridge), { axis: 'u', ov: 0.05, endOv: 0 });
}

function westFront(kit, S, detail) {
  const base = S.base, fine = detail >= 1;
  // central gable wall (u = 0, v from +5.6 to -5.6 looking at it from the west: s runs north → south)
  const E = side(0, 5.6, 0, -5.6, -1, 0);
  const cw = 2.3, sw = 1.75, gap = 0.55, c = E.L / 2;
  const wins = [
    { s0: c - cw / 2, s1: c + cw / 2, sill: Y(10.4), spring: Y(19.6), k: 1.2, depth: 0.7 },
    { s0: c - cw / 2 - gap - sw, s1: c - cw / 2 - gap, sill: Y(11.4), spring: Y(17.6), k: 1.2, depth: 0.7 },
    { s0: c + cw / 2 + gap, s1: c + cw / 2 + gap + sw, sill: Y(11.4), spring: Y(17.6), k: 1.2, depth: 0.7 },
  ];
  // the portal is a separate hole in the same wall
  const portal = { pts: lancetPts(c - 1.6, c + 1.6, Y(0), Y(4.3), { k: 1, seg: detail >= 2 ? 6 : 3 }), depth: 1.1, back: 'atlas', glassUV: atlasUV('door'), reveal: 'stone', glassInset: 0.01 };
  const outline = gableOutline(E.L, base, Y(H.clere + 0.8), Y(H.gable));
  if (detail === 0) {
    holedWall(kit, 'stone', E, outline, [], { vRef: FL });
    for (const w of wins) panel(kit, 'sg', E, lancetPts(w.s0, w.s1, w.sill, w.spring, { k: w.k, seg: 2 }), 0.03, 'metre', FL);
    panel(kit, 'atlas', E, portal.pts, 0.03, atlasUV('door'));
  } else {
    const holes = wins.map((w) => ({ pts: lancetPts(w.s0, w.s1, w.sill, w.spring, { k: w.k, seg: detail >= 2 ? 6 : 3 }), depth: w.depth, glass: 'sg', glassUV: 'metre', vRef: FL }));
    holedWall(kit, 'stone', E, outline, [...holes, portal], { vRef: FL });
    if (detail >= 2) for (const w of wins) hood(kit, 'stone', E, w.s0 - 0.15, w.s1 + 0.15, w.spring, w.k);
    // sill course under the window, band above the portal gable
    kit.beam('stone', E.P3(-0.1, Y(10.2), 0.12), E.P3(E.L + 0.1, Y(10.2), 0.12), 0.24, 0.3, { caps: true });
  }
  coping(kit, 'stone', E.P3(0, Y(H.clere + 0.8), 0.05), E.P3(E.L / 2, Y(H.gable), 0.05), 0.7, 0.28);
  coping(kit, 'stone', E.P3(E.L / 2, Y(H.gable), 0.05), E.P3(E.L, Y(H.clere + 0.8), 0.05), 0.7, 0.28);
  // cross on the apex
  const [ax, az] = E.P(E.L / 2, 0.05);
  kit.box('stone', ax, Y(H.gable + 1.1), az, 0.24, 1.9, 0.24, E.rot);
  kit.box('stone', ax, Y(H.gable + 1.4), az, 1.1, 0.24, 0.24, E.rot);
  // porch gable projecting in front of the portal
  {
    const d = 1.5, w = 5.0, u0 = -d, yE = Y(5.4), yA = Y(8.6);
    const Ef = side(u0, w / 2, u0, -w / 2, -1, 0);
    const hole = { pts: lancetPts(0.9, w - 0.9, Y(0), Y(4.3), { k: 1, seg: detail >= 2 ? 6 : 3 }), depth: d + 0.02, reveal: 'stone' };
    if (detail === 0) holedWall(kit, 'stone', Ef, gableOutline(w, base, yE, yA), [], { vRef: FL });
    else holedWall(kit, 'stone', Ef, gableOutline(w, base, yE, yA), [hole], { vRef: FL });
    // sides of the porch
    for (const sg of [-1, 1]) {
      const Es = sg > 0 ? side(0, w / 2, u0, w / 2, 0, 1) : side(u0, -w / 2, 0, -w / 2, 0, -1);
      holedWall(kit, 'stone', Es, outlineRect(Es.L, base, yE), [], { vRef: FL });
    }
    gableRoof(kit, 'stone', F, u0 - 0.1, 0, -w / 2, w / 2, yE, yA, { axis: 'u', ov: 0.2, endOv: 0 });
    coping(kit, 'stone', Ef.P3(0, yE, 0.05), Ef.P3(w / 2, yA, 0.05), 0.5, 0.22);
    coping(kit, 'stone', Ef.P3(w / 2, yA, 0.05), Ef.P3(w, yE, 0.05), 0.5, 0.22);
    if (fine) {
      const [px, pz] = Ef.P(w / 2, 0.05);
      kit.box('stone', px, yA + 0.5, pz, 0.35, 1.0, 0.35, Ef.rot);
    }
  }
  // aisle ends (v 5.6 → 10.7 and -5.6 → -10.7) with a lancet each and a sloping parapet
  for (const sg of [1, -1]) {
    const Ea = sg > 0 ? side(0, 10.7, 0, 5.6, -1, 0) : side(0, -5.6, 0, -10.7, -1, 0);
    const out = sg > 0 ? [[0, base], [Ea.L, base], [Ea.L, Y(H.aisleRoof + 0.6)], [0, Y(H.aisle + 0.9)]] : [[0, base], [Ea.L, base], [Ea.L, Y(H.aisle + 0.9)], [0, Y(H.aisleRoof + 0.6)]];
    gWall(kit, Ea, out, [{ s0: Ea.L / 2 - 0.55, s1: Ea.L / 2 + 0.55, sill: Y(3.2), spring: Y(6.4), k: 1.1 }], detail);
  }
  // stair turrets flanking the central gable: square buttress shafts turning octagonal above the eaves, with
  // arcaded lights at the top and slender spirelets
  for (const v of [5.6, -5.6]) {
    const [tx, tz] = F.W(-0.55, v);
    const yO = Y(H.clere + 0.8), yT = Y(H.gable + 0.2);
    kit.box('stone', tx, (base + yO) / 2, tz, 2.1, yO - base, 2.1, F.rotY, { faces: { px: 1, nx: 1, pz: 1, nz: 1, py: 1 }, vRef: FL });
    const r = 1.05, a0 = ANG + Math.PI / 8, ring = ngonRing(tx, tz, r, 8, a0);
    prism(kit, 'stone', ring, yO - 0.1, yT, { vRef: FL });
    const r2 = ngonRing(tx, tz, r + 0.14, 8, a0);
    prism(kit, 'stone', r2, yT, yT + 0.35, { topKey: 'stone', vRef: FL });
    if (fine) {
      for (let i = 0; i < 8; i++) {   // open lights at the top of the octagon, slits lower down
        const p = ring[i], q = ring[(i + 1) % 8];
        const out = [(p[0] + q[0]) / 2 - tx, 0, (p[1] + q[1]) / 2 - tz], l = Math.hypot(out[0], out[2]);
        const Et = edge(p, q, [out[0] / l, 0, out[2] / l]);
        panel(kit, 'dark', Et, lancetPts(Et.L / 2 - 0.2, Et.L / 2 + 0.2, yT - 3.0, yT - 1.0, { k: 1, seg: 2 }), 0.02);
        if (detail >= 2 && i % 2 === 0) panel(kit, 'dark', Et, lancetPts(Et.L / 2 - 0.1, Et.L / 2 + 0.1, yO + 1.0, yO + 1.9, { k: 1, seg: 2 }), 0.02);
      }
    }
    pyramid(kit, 'stone', r2, yT + 0.35, [tx, yT + 4.6, tz]);
    if (fine) kit.box('stone', tx, yT + 4.75, tz, 0.18, 0.3, 0.18, 0);
  }
  if (fine) {
    for (const v of [10.7, -10.7]) {
      const Ea = side(0, v, 0, v > 0 ? 5.6 : -5.6, -1, 0);
      buttress(kit, 'stone', Ea, 0.5, base, [{ y1: Y(4.6), d: 1.3, w: 1.0 }, { y1: Y(9.2), d: 0.8, w: 1.0 }], { capH: 0.5, vRef: FL });
    }
  }
}

function transepts(kit, S, detail) {
  const base = S.base, fine = detail >= 1;
  for (const sg of [-1, 1]) {
    const vEnd = sg * 14.8, vIn = sg * 6;
    // end gable
    const E = sg < 0 ? side(TW.u0, vEnd, TW.u1, vEnd, 0, -1) : side(TW.u1, vEnd, TW.u0, vEnd, 0, 1);
    const c = E.L / 2;
    const wins = [
      { s0: c - 0.9, s1: c + 0.9, sill: Y(6.4), spring: Y(17.2), k: 1.25, depth: 0.6 },
      { s0: c - 3.3, s1: c - 1.6, sill: Y(6.4), spring: Y(15.6), k: 1.25, depth: 0.6 },
      { s0: c + 1.6, s1: c + 3.3, sill: Y(6.4), spring: Y(15.6), k: 1.25, depth: 0.6 },
    ];
    const outline = gableOutline(E.L, base, Y(H.clere + 0.8), Y(H.gable - 0.8));
    gWall(kit, E, outline, wins, detail, { seg: detail >= 2 ? 6 : 3 });
    coping(kit, 'stone', E.P3(0, Y(H.clere + 0.8), 0.05), E.P3(c, Y(H.gable - 0.8), 0.05), 0.65, 0.26);
    coping(kit, 'stone', E.P3(c, Y(H.gable - 0.8), 0.05), E.P3(E.L, Y(H.clere + 0.8), 0.05), 0.65, 0.26);
    const [ax, az] = E.P(c, 0.05);
    kit.box('stone', ax, Y(H.gable + 0.2), az, 0.22, 1.7, 0.22, E.rot);
    kit.box('stone', ax, Y(H.gable + 0.5), az, 1.0, 0.22, 0.22, E.rot);
    if (detail >= 2) {
      // carved roundel in the gable (the quatrefoil cross roundel visible beside the tower)
      panel(kit, 'atlas', E, rectPts(c - 0.8, c + 0.8, Y(H.clere + 2.2), Y(H.clere + 3.8)), 0.04, atlasUV('quatrefoil'));
    }
    // corner turrets: square buttress turrets with pinnacles at both corners of the gable end
    for (const s of [0.6, E.L - 0.6]) {
      if (fine) buttress(kit, 'stone', E, s, base, [{ y1: Y(6.0), d: 1.4, w: 1.2 }, { y1: Y(12.0), d: 1.0, w: 1.2 }, { y1: Y(H.clere + 0.6), d: 0.7, w: 1.1 }], { capH: 0.55, vRef: FL });
      const [px, pz] = E.P(s, 0.35);
      pinnacle(kit, 'stone', px, pz, Y(H.clere + 0.6), 1.1, 2.0, 2.6, E.rot);
    }
    // side walls of the transept arm (u = 32 west face, u = 44 east face) between the aisle / chapel roofs and the eaves
    for (const [u, ou] of [[TW.u0, -1], [TW.u1, 1]]) {
      const Es = ou < 0 ? (sg < 0 ? side(u, vIn, u, vEnd, -1, 0) : side(u, vEnd, u, vIn, -1, 0)) : (sg < 0 ? side(u, vEnd, u, vIn, 1, 0) : side(u, vIn, u, vEnd, 1, 0));
      const lowY = (ou < 0) ? Y(H.aisle + 0.6) : Y(8.6);
      // the part of the west side wall beyond the aisle (|v| > 10.7) comes down to the ground; the east side
      // walls stand on the chapel / sacristy roofs along their whole length
      const outline = ou > 0 ? outlineRect(Es.L, lowY, Y(H.clere + 0.8)) : sg < 0
        ? (ou < 0 ? [[0, lowY], [Es.L - 4.1, lowY], [Es.L - 4.1, base], [Es.L, base], [Es.L, Y(H.clere + 0.8)], [0, Y(H.clere + 0.8)]]
          : [[0, base], [4.1, base], [4.1, lowY], [Es.L, lowY], [Es.L, Y(H.clere + 0.8)], [0, Y(H.clere + 0.8)]])
        : (ou < 0 ? [[0, base], [4.1, base], [4.1, lowY], [Es.L, lowY], [Es.L, Y(H.clere + 0.8)], [0, Y(H.clere + 0.8)]]
          : [[0, lowY], [Es.L - 4.1, lowY], [Es.L - 4.1, base], [Es.L, base], [Es.L, Y(H.clere + 0.8)], [0, Y(H.clere + 0.8)]]);
      const sMid = Es.L / 2;
      gWall(kit, Es, outline, [{ s0: sMid - 1.35, s1: sMid - 0.35, sill: Y(12.6), spring: Y(15.9), k: 1.1, depth: 0.4 }, { s0: sMid + 0.35, s1: sMid + 1.35, sill: Y(12.6), spring: Y(15.9), k: 1.1, depth: 0.4 }], detail);
      coping(kit, 'stone', Es.P3(0, Y(H.clere + 0.8), 0.02), Es.P3(Es.L, Y(H.clere + 0.8), 0.02), 0.6, 0.22);
    }
    // roof of the arm (ridge along v)
    gableRoof(kit, 'slate', F, TW.u0, TW.u1, sg < 0 ? vEnd : vIn, sg < 0 ? vIn : vEnd, Y(H.clere + 0.3), Y(H.ridge), { axis: 'v', ov: 0.05, endOv: 0 });
  }
}

function chancel(kit, S, detail) {
  const base = S.base, fine = detail >= 1;
  const u0 = TW.u1, u1 = 59.6;
  // clerestory side walls above the chapels
  for (const [v, sg] of [[-5.6, -1], [5.6, 1]]) {
    const E = sg < 0 ? side(u0, v, u1, v, 0, -1) : side(u1, v, u0, v, 0, 1);
    const wins = bays(0.6, E.L - 0.6, 2, 2, 1.0, 0.5, Y(12.6), Y(15.9), { k: 1.1, depth: 0.4 });
    gWall(kit, E, outlineRect(E.L, Y(8.2), Y(H.clere + 0.8)), wins, detail);
    coping(kit, 'stone', E.P3(0, Y(H.clere + 0.8), 0.02), E.P3(E.L, Y(H.clere + 0.8), 0.02), 0.6, 0.22);
  }
  gableRoof(kit, 'slate', F, u0, u1, -5.6, 5.6, Y(H.clere + 0.3), Y(H.ridge), { axis: 'u', ov: 0.05, endOv: 0 });
  // east end: great window of five graded lancets
  const E = side(u1, -5.6, u1, 5.6, 1, 0), c = E.L / 2;
  const wins = [];
  const ws = [[0, 1.2, 17.8], [-1.6, 1.05, 16.6], [1.6, 1.05, 16.6], [-3.05, 0.95, 15.2], [3.05, 0.95, 15.2]];
  for (const [o, w, sp] of ws) wins.push({ s0: c + o - w / 2, s1: c + o + w / 2, sill: Y(8.8), spring: Y(sp), k: 1.3, depth: 0.6 });
  gWall(kit, E, gableOutline(E.L, base, Y(H.clere + 0.8), Y(H.gable - 0.8)), wins, detail, { seg: detail >= 2 ? 6 : 3 });
  coping(kit, 'stone', E.P3(0, Y(H.clere + 0.8), 0.05), E.P3(c, Y(H.gable - 0.8), 0.05), 0.65, 0.26);
  coping(kit, 'stone', E.P3(c, Y(H.gable - 0.8), 0.05), E.P3(E.L, Y(H.clere + 0.8), 0.05), 0.65, 0.26);
  const [ax, az] = E.P(c, 0.05);
  kit.box('stone', ax, Y(H.gable + 0.2), az, 0.22, 1.7, 0.22, E.rot);
  kit.box('stone', ax, Y(H.gable + 0.5), az, 1.0, 0.22, 0.22, E.rot);
  for (const s of [0.5, E.L - 0.5]) {
    if (fine) buttress(kit, 'stone', E, s, base, [{ y1: Y(6.0), d: 1.5, w: 1.1 }, { y1: Y(12.5), d: 1.0, w: 1.1 }, { y1: Y(H.clere + 0.6), d: 0.6, w: 1.0 }], { capH: 0.55, vRef: FL });
    const [px, pz] = E.P(s, 0.3);
    pinnacle(kit, 'stone', px, pz, Y(H.clere + 0.6), 1.0, 1.8, 2.4, E.rot);
  }
  // south chapels (u 44 → 49.6 deep to v -14.8, then the chancel aisle to v -9.3) and the north sacristy / organ chamber
  const lows = [
    { u0: 44, u1: 49.6, v0: -14.8, v1: -5.6, h: 8.6, south: true },
    { u0: 49.6, u1: 59.6, v0: -9.3, v1: -5.6, h: 8.2, south: true },
    { u0: 44, u1: 58.5, v0: 5.6, v1: 11.3, h: 8.6, south: false },
  ];
  for (const b of lows) {
    const outer = b.south ? b.v0 : b.v1;
    const E1 = b.south ? side(b.u0, outer, b.u1, outer, 0, -1) : side(b.u1, outer, b.u0, outer, 0, 1);
    const n = Math.max(1, Math.round(E1.L / 5));
    gWall(kit, E1, outlineRect(E1.L, base, Y(b.h + 0.8)), bays(0.4, E1.L - 0.4, n, 2, 0.85, 0.4, Y(3.0), Y(6.0), { k: 1.1 }), detail);
    coping(kit, 'stone', E1.P3(-0.1, Y(b.h + 0.8), 0.05), E1.P3(E1.L + 0.1, Y(b.h + 0.8), 0.05), 0.55, 0.2);
    // end walls (east / west faces of the low blocks, where exposed)
    const Ee = side(b.u1, b.south ? b.v1 : b.v0, b.u1, b.south ? b.v0 : b.v1, 1, 0);
    if (!(b.u1 === 49.6)) holedWall(kit, 'stone', Ee, outlineRect(Ee.L, base, Y(b.h + 0.8)), [], { vRef: FL });
    if (b.u1 === 49.6) {   // the part of the chapel's east wall beyond the chancel aisle
      const Ex = side(49.6, -9.3, 49.6, -14.8, 1, 0);
      holedWall(kit, 'stone', Ex, outlineRect(Ex.L, base, Y(b.h + 0.8)), [], { vRef: FL });
    }
    if (b.u0 === 44 && b.south) {
      // west face of the chapel beyond the transept (none: the transept covers it)
    }
    leanTo(kit, 'slate', F, b.u0, b.u1, outer + (b.south ? 0.35 : -0.35), b.south ? -5.6 : 5.6, Y(b.h + 0.4), Y(11.4), 0);
    if (fine) {
      for (let i = 0; i <= n; i++) {
        const s = Math.min(E1.L - 0.4, Math.max(0.4, 0.4 + ((E1.L - 0.8) / n) * i));
        buttress(kit, 'stone', E1, s, base, [{ y1: Y(4.4), d: 1.0, w: 0.85 }, { y1: Y(b.h + 0.5), d: 0.6, w: 0.85 }], { capH: 0.45, vRef: FL });
      }
    }
  }
}

function tower(kit, S, detail) {
  const fine = detail >= 1, y0 = Y(H.aisleRoof), yT = Y(H.tower);
  const faces = [
    side(TW.u0, TW.v0, TW.u1, TW.v0, 0, -1), side(TW.u1, TW.v0, TW.u1, TW.v1, 1, 0),
    side(TW.u1, TW.v1, TW.u0, TW.v1, 0, 1), side(TW.u0, TW.v1, TW.u0, TW.v0, -1, 0),
  ];
  for (const E of faces) {
    const c = E.L / 2;
    const belfry = [
      { s0: c - 2.25, s1: c - 0.55, sill: Y(26.6), spring: Y(33.0), k: 1.15, depth: 0.9, glass: 'dark', noHood: true },
      { s0: c + 0.55, s1: c + 2.25, sill: Y(26.6), spring: Y(33.0), k: 1.15, depth: 0.9, glass: 'dark', noHood: true },
    ];
    gWall(kit, E, outlineRect(E.L, y0, yT), belfry, detail, { seg: detail >= 2 ? 5 : 3 });
    if (detail >= 1) {
      // hood arches over each belfry pair + a central colonnette
      hood(kit, 'stone', E, c - 2.55, c - 0.25, Y(33.0), 1.15);
      hood(kit, 'stone', E, c + 0.25, c + 2.55, Y(33.0), 1.15);
      edgeBox(kit, 'stone', E, c - 1.4, -0.3, Y(26.6), Y(33.2), 0.14, 0.14, null, FL);
      edgeBox(kit, 'stone', E, c + 1.4, -0.3, Y(26.6), Y(33.2), 0.14, 0.14, null, FL);
      // string courses
      kit.beam('stone', E.P3(-0.2, Y(26.3), 0.12), E.P3(E.L + 0.2, Y(26.3), 0.12), 0.24, 0.3, { caps: false });
      kit.beam('stone', E.P3(-0.2, yT - 0.15, 0.2), E.P3(E.L + 0.2, yT - 0.15, 0.2), 0.4, 0.4, { caps: false });
      // angle buttresses (two per corner)
      for (const s of [0.75, E.L - 0.75]) {
        buttress(kit, 'stone', E, s, y0, [{ y1: Y(24.6), d: 1.2, w: 1.1 }, { y1: Y(31.0), d: 0.85, w: 1.0 }, { y1: yT, d: 0.5, w: 0.9 }], { capH: 0.6, vRef: FL });
      }
    }
    // pierced parapet between the corner pinnacles
    const pk = detail >= 1 ? 'pierced' : 'stone';
    const s0 = 1.1, s1 = E.L - 1.1;
    kit.quad(pk, E.P3(s0, yT, 0.02), E.P3(s1, yT, 0.02), E.P3(s1, Y(H.parapet), 0.02), E.P3(s0, Y(H.parapet), 0.02), E.n, [0, 0], [s1 - s0, 0], [s1 - s0, H.parapet - H.tower], [0, H.parapet - H.tower]);
    if (detail >= 1) kit.beam('stone', E.P3(s0, Y(H.parapet) + 0.1, 0), E.P3(s1, Y(H.parapet) + 0.1, 0), 0.34, 0.2, { caps: false });
  }
  // tower roof deck behind the parapet
  kit.cap('lead', F.rect(TW.u0, TW.u1, TW.v0, TW.v1), yT - 0.05, true);
  // corner pinnacles (with small gablets at their feet)
  for (const [u, v] of [[TW.u0, TW.v0], [TW.u1, TW.v0], [TW.u1, TW.v1], [TW.u0, TW.v1]]) {
    const [px, pz] = F.W(u + Math.sign(SP.u - u) * 0.55, v + Math.sign(SP.v - v) * 0.55);
    pinnacle(kit, 'stone', px, pz, yT, 1.35, 2.1, 3.4, F.rotY, { gablets: detail >= 1 });
  }
  // spire with lucarnes, and small pinnacles on the diagonal faces of its foot
  spire(kit, 'stone', F, SP.u, SP.v, yT, Y(H.spire), SP.r0, { ringKey: detail >= 1 ? 'stone' : null });
  const nDiag = 4;
  for (let i = 0; i < nDiag; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const [px, pz] = F.W(SP.u + Math.cos(a) * (SP.r0 * 0.88), SP.v + Math.sin(a) * (SP.r0 * 0.88));
    if (detail >= 1) pinnacle(kit, 'stone', px, pz, yT, 0.8, 2.6, 2.2, F.rotY + a);
  }
  const tiers = detail >= 2 ? [{ y: 38.6, w: 1.9, h: 3.4, faces: [0, 2, 4, 6] }, { y: 47.0, w: 1.2, h: 2.2, faces: [1, 3, 5, 7] }, { y: 55.4, w: 0.8, h: 1.5, faces: [0, 2, 4, 6] }]
    : detail === 1 ? [{ y: 38.6, w: 1.9, h: 3.4, faces: [0, 2, 4, 6] }, { y: 47.0, w: 1.2, h: 2.2, faces: [1, 3, 5, 7] }]
      : [{ y: 38.6, w: 1.9, h: 3.4, faces: [0, 2, 4, 6] }];
  for (const t of tiers) for (const fi of t.faces) lucarne(kit, t, fi, detail);
  // weathervane cross
  const [sx, sz] = F.W(SP.u, SP.v);
  kit.box('gold', sx, Y(H.spire + 1.0), sz, 0.12, 2.0, 0.12, F.rotY);
  kit.box('gold', sx, Y(H.spire + 1.3), sz, 0.9, 0.12, 0.12, F.rotY);
}

// Gabled lucarne on spire face fi (0 faces +u, counting towards +v) at height t.y above the floor.
function lucarne(kit, t, fi, detail) {
  const a = (fi * Math.PI) / 4;
  const d = [Math.cos(a), Math.sin(a)];                         // local outward direction of the face
  const yb = Y(t.y), ratio = 1 - (t.y - H.tower) / (H.spire - H.tower);
  const ap = SP.r0 * Math.cos(Math.PI / 8) * ratio;             // apothem of the spire at the lucarne's foot
  const front = ap + 0.25, back = ap - 1.4, w = t.w, h = t.h;
  const Pl = (r, s) => F.W(SP.u + d[0] * r - d[1] * s, SP.v + d[1] * r + d[0] * s);
  // box (sides + front) from back to front
  const E = edge(Pl(front, w / 2), Pl(front, -w / 2), F.D3(d[0], d[1]));
  const yE = yb + h, yA = yE + w * 0.75;
  const hole = { pts: lancetPts(w * 0.22, w * 0.78, yb + 0.25, yE - w * 0.3, { k: 1, seg: 2 }), depth: 0.2, back: 'dark' };
  if (detail >= 1) holedWall(kit, 'stone', E, gableOutline(w, yb, yE, yA), [hole], { vRef: FL });
  else { holedWall(kit, 'stone', E, gableOutline(w, yb, yE, yA), [], { vRef: FL }); panel(kit, 'dark', E, hole.pts, 0.02); }
  for (const sg of [-1, 1]) {
    const A = Pl(back, sg * w / 2), B = Pl(front, sg * w / 2);
    const n3 = F.D3(-d[1] * sg, d[0] * sg);
    const Ef = edge(sg > 0 ? A : B, sg > 0 ? B : A, n3);
    holedWall(kit, 'stone', Ef, rectPts(0, Ef.L, yb, yE), [], { vRef: FL });
  }
  // little gable roof (ridge along d)
  const R0 = Pl(back, 0), R1 = Pl(front + 0.1, 0);
  for (const sg of [-1, 1]) {
    const e0 = Pl(back, sg * (w / 2 + 0.08)), e1 = Pl(front + 0.1, sg * (w / 2 + 0.08));
    kit.quadH('stone', [e0[0], yE - 0.06, e0[1]], [e1[0], yE - 0.06, e1[1]], [R1[0], yA, R1[1]], [R0[0], yA, R0[1]], [F.D3(-d[1] * sg, d[0] * sg)[0], 1, F.D3(-d[1] * sg, d[0] * sg)[2]]);
  }
  if (detail >= 1) { const [fx, fz] = Pl(front + 0.05, 0); kit.box('stone', fx, yA + 0.25, fz, 0.16, 0.5, 0.16, 0); }
}

function sidePorch(kit, S, detail) {
  // south porch on the aisle (bay 4 from the west) with statue niches over a pointed door
  const u0 = 19.9, u1 = 25.9, v0 = -10.7, v1 = -12.9, yE = Y(6.4), yA = Y(9.6), base = S.base;
  const Ef = side(u0, v1, u1, v1, 0, -1);
  const door = { pts: lancetPts(1.6, Ef.L - 1.6, Y(0.4), Y(3.4), { k: 1, seg: detail >= 2 ? 5 : 3 }), depth: 2.1, back: 'atlas', glassUV: atlasUV('door'), reveal: 'stone', glassInset: 0.01 };
  if (detail === 0) { holedWall(kit, 'stone', Ef, gableOutline(Ef.L, base, yE, yA), [], { vRef: FL }); panel(kit, 'atlas', Ef, door.pts, 0.03, atlasUV('door')); }
  else holedWall(kit, 'stone', Ef, gableOutline(Ef.L, base, yE, yA), [door], { vRef: FL });
  coping(kit, 'stone', Ef.P3(0, yE, 0.05), Ef.P3(Ef.L / 2, yA, 0.05), 0.5, 0.22);
  coping(kit, 'stone', Ef.P3(Ef.L / 2, yA, 0.05), Ef.P3(Ef.L, yE, 0.05), 0.5, 0.22);
  if (detail >= 2) {
    // three statue niches above the door
    for (const o of [-0.9, 0, 0.9]) panel(kit, 'dark', Ef, lancetPts(Ef.L / 2 + o - 0.3, Ef.L / 2 + o + 0.3, Y(6.2), Y(7.3), { k: 1, seg: 3 }), 0.02);
  }
  for (const [a, b, o] of [[[u0, v0], [u0, v1], [-1, 0]], [[u1, v1], [u1, v0], [1, 0]]]) {
    const Es = side(a[0], a[1], b[0], b[1], o[0], o[1]);
    holedWall(kit, 'stone', Es, outlineRect(Es.L, base, yE), [], { vRef: FL });
  }
  gableRoof(kit, 'slate', F, u0 - 0.15, u1 + 0.15, v1, v0, yE, yA - 0.3, { axis: 'v', ov: 0.15, endOv: 0 });
}

// Parish house (1907): three storeys of the same stone north of the church, slate gables, mullioned windows.
function parishHouse(kit, S, detail, rand) {
  const blocks = [
    { u0: 26.7, u1: 47.9, v0: 27.1, v1: 45.0, h: H.ph, ridge: H.phRidge, axis: 'u' },
    { u0: 47.9, u1: 65.0, v0: 26.8, v1: 45.0, h: H.ph - 0.8, ridge: H.phRidge - 0.8, axis: 'u' },
    { u0: 65.0, u1: 75.5, v0: 22.6, v1: 37.5, h: H.ph - 0.8, ridge: H.phRidge - 0.8, axis: 'v' },
    { u0: 27.6, u1: 32.0, v0: 10.7, v1: 27.1, h: 6.0, ridge: 8.6, axis: 'v', link: true },
    { u0: 44.0, u1: 58.5, v0: 11.3, v1: 26.8, h: 8.0, ridge: 11.4, axis: 'u' },
  ];
  const base = S.base - 1.2;
  const holesFor = (E, b) => {
    const out = [];
    if (detail === 0) return out;
    const storeys = b.link ? [1.4] : b.h > 9 ? [1.2, 4.7, 8.1] : [1.2, 4.7];
    const n = Math.max(1, Math.floor((E.L - 1.5) / 4.2));
    for (let i = 0; i < n; i++) {
      const c = (E.L / n) * (i + 0.5);
      for (const sy of storeys) {
        const y = Y(sy);
        const tMax = Math.max(S.ctx.heightAt(...E.P(c - 1.1)), S.ctx.heightAt(...E.P(c + 1.1)));
        if (tMax > y - 0.3) continue;
        out.push({ pts: rectPts(c - 1.1, c + 1.1, y, y + 1.9), depth: 0.3, glass: 'glass', glassUV: cellUV(rand), reveal: 'stone', mull: true });
      }
    }
    return out;
  };
  for (const b of blocks) {
    const sidesDef = [
      [b.u0, b.v0, b.u1, b.v0, 0, -1], [b.u1, b.v0, b.u1, b.v1, 1, 0], [b.u1, b.v1, b.u0, b.v1, 0, 1], [b.u0, b.v1, b.u0, b.v0, -1, 0],
    ];
    for (const [a0, a1, c0, c1, ou, ov] of sidesDef) {
      const E = side(a0, a1, c0, c1, ou, ov);
      // skip faces buried against the church or another block
      const [mx, mz] = E.P(E.L / 2, 0.6);
      const [mu, mv] = F.toLocal(mx, mz);
      const inside = (mu > 0 && mu < 59.6 && mv > -14.8 && mv < 11.3) || blocks.some((o) => o !== b && mu > o.u0 && mu < o.u1 && mv > o.v0 && mv < o.v1 && o.h >= b.h - 0.1);
      if (inside) continue;
      const gableEnd = (b.axis === 'u' && ou !== 0) || (b.axis === 'v' && ov !== 0);
      const outline = gableEnd ? gableOutline(E.L, base, Y(b.h), Y(b.ridge + 0.4)) : outlineRect(E.L, base, Y(b.h + 0.5));
      const holes = holesFor(E, b);
      holedWall(kit, 'stone', E, outline, holes, { vRef: FL });
      if (detail >= 2) for (const h of holes) {
        const [s0, y0] = h.pts[0], [s1] = h.pts[1], y1 = h.pts[2][1];
        for (const f of [1 / 3, 2 / 3]) panel(kit, 'stone', E, rectPts(s0 + (s1 - s0) * f - 0.06, s0 + (s1 - s0) * f + 0.06, y0, y1), -0.27, 'metre', FL);
        panel(kit, 'stone', E, rectPts(s0, s1, y0 + 1.35, y0 + 1.45), -0.27, 'metre', FL);
        edgeBox(kit, 'stone', E, (s0 + s1) / 2, 0.06, y1, y1 + 0.18, s1 - s0 + 0.4, 0.14, null, FL);
      }
      if (gableEnd) {
        coping(kit, 'stone', E.P3(0, Y(b.h), 0.05), E.P3(E.L / 2, Y(b.ridge + 0.4), 0.05), 0.5, 0.2);
        coping(kit, 'stone', E.P3(E.L / 2, Y(b.ridge + 0.4), 0.05), E.P3(E.L, Y(b.h), 0.05), 0.5, 0.2);
      }
    }
    gableRoof(kit, 'slate', F, b.u0, b.u1, b.v0, b.v1, Y(b.h), Y(b.ridge), { axis: b.axis, ov: 0.35, endOv: 0 });
    if (detail >= 1 && !b.link) {
      // chimneys
      const [cx, cz] = F.W(b.u0 + (b.u1 - b.u0) * 0.3, (b.v0 + b.v1) / 2);
      kit.box('stone', cx, Y(b.ridge + 0.6), cz, 1.1, 3.0, 0.8, F.rotY);
    }
  }
}

// ------------------------------------------------------------------ assembly
function* build(ctx, S, M, detail) {
  if (detail) { addRelief(M.stone); yield; }
  const kit = new MeshKit();
  const rand = prng(1907);
  nave(kit, S, detail); yield;
  westFront(kit, S, detail); yield;
  transepts(kit, S, detail); yield;
  chancel(kit, S, detail); yield;
  sidePorch(kit, S, detail);
  tower(kit, S, detail); yield;
  if (detail >= 1) {   // parish notice board on the lawn at the Shady / Walnut corner
    const [x, z] = F.W(-3.5, -14.2), g = ctx.heightAt(x, z);
    signBoard(kit, { x, z, face: F.D3(-0.6, -0.8).filter((_, i) => i !== 1), y0: g + 1.2, w: 2.6, h: 1.1, key: 'atlas', uv: atlasUV('signCal', 0.002), bodyKey: 'lead', posts: true });
  }
  parishHouse(kit, S, detail, rand); yield;
  // foundation course around the church (hides the join with sloping ground)
  return kit.build(M, { name: detail ? 'calvary-fine' : 'calvary-coarse' });
}
function drain(it) { let r = it.next(); while (!r.done) r = it.next(); return r.value; }

export async function buildCalvary(ctx, def) {
  const b = ctx.data.buildings.find((x) => x.id === CALVARY_OSM || x.osmId === CALVARY_OSM);
  const S = { ctx, base: (b?.ground?.min ?? 44.9) - 1.0 };
  const t0 = performance.now();
  const M = materials(ctx);
  const t1 = performance.now();
  const low = ctx.quality?.level === 'low';
  // the distant level merges its small parts into fewer materials (fewer draw calls)
  const coarse = drain(build(ctx, S, { ...M, gold: M.stone, lead: M.slate, atlas: M.stone }, 0));
  const t2 = performance.now();
  const [cx, cz] = F.W(SP.u, SP.v);
  const obj = lodBuilding(ctx, {
    name: 'calvary', centre: [cx, Y(20), cz], coarse,
    far: low ? 260 : 460, near: low ? 300 : 520,
    fine: () => build(ctx, S, M, low ? 1 : 2),
  });
  obj.name = 'landmark:calvaryEpiscopal';
  // colliders: church body and parish house blocks
  const add = (u0, u1, v0, v1, h) => ctx.colliders?.addPolygon(F.rect(u0, u1, v0, v1), S.base, Y(h), CALVARY_OSM);
  add(-1.6, 32, -10.7, 10.7, H.ridge); add(TW.u0, TW.u1, -14.8, 14.8, H.spire); add(TW.u1, 59.6, -9.3, 11.3, H.ridge);
  add(44, 49.6, -14.8, -9.3, 9); add(19.9, 25.9, -12.9, -10.7, 9);
  add(26.7, 65, 26.8, 45, H.phRidge); add(65, 75.5, 22.6, 37.5, H.phRidge); add(27.6, 32, 14.8, 27.1, 8); add(44, 58.5, 11.3, 26.8, 11);
  registerBuilding(ctx, obj, {
    key: def.key, name: def.name, nameZh: def.nameZh, osmId: CALVARY_OSM,
    position: [cx, Y(30), cz], radius: 45, labelY: Y(H.spire + 6), priority: 9, maxDistance: 3200,
  });
  obj.userData.buildMs = { materials: Math.round(t1 - t0), coarse: Math.round(t2 - t1), total: Math.round(performance.now() - t0) };
  return obj;
}
