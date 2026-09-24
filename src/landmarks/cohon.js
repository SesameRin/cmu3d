// Jared L. Cohon University Center (1996, Michael Dennis & Associates with UDA Architects; north addition 2016 by
// CannonDesign). The student centre closes the east side of the Cut with an "Uffizi"-like range in pale buff factory
// brick: a long, tall ground-floor loggia of square brick piers on grey stone bases (stone lintels over the openings)
// gives a covered walk along the lawn; above it a plain brick band, a string course and a clerestory of triple
// windows under a deep, bracketed eave of dark standing-seam metal (a sloped band — the roof behind it is flat). The
// range ends in two taller four-storey pavilions whose gable ends face the Cut, each with a projecting dark-framed
// glass oriel carried on two stone columns.
//
// Behind the range (as seen from the air): the flat-roofed McConomy / Rangos block, a round rotunda capped by a low
// glazed cone over the Merson Courtyard entrance, the pool hall on the south side (flat roof, glazed south
// clerestory) and the big Wiegand Gymnasium under a light grey hipped metal roof, the tallest volume of the complex.
//
// The 2016 addition turns a very different face to Forbes Avenue: a two-storey glass lobby with silver fins next to
// the north pavilion, entered under an "L" of light grey panels — a slender pier rising past the roof with a big
// cantilevered roof plane — with the building's name on the fascia over the doors; beside it a light grey
// shingle-panel volume with a black-framed window box, then a black box lifted over a recessed ground floor on dark
// columns; gabion-basket planters in front.
//
// References (for proportions only): Commons "Jared_Cohon_University_Center_at_Carnegie_Mellon_University.JPG"
// (Cut facade from the south-west), "Carnegie_Mellon_Cohon_University_Center_2016.jpg" and "..._2016_main_entrance.jpg"
// (the Forbes addition), Commons "Carnegie Mellon University as seen from the Cathedral of Learning.jpg" (roofscape),
// and orthophotos (rotunda, hipped gym roof, pool clerestory).
import {
  MeshKit, massing, punchedWall, bandRing, makeFrame, rectLocal, gableRoof, hipRoof, groundStats, prng, registerLandmark,
  ringCentroid, loggiaPiers, eaveBrackets, orielBay,
} from './lib/north-kit.js';
import { brickPlain, cellUV, plain, glz, seamMetal, metalPanels, signAtlas, signQuad, gabion } from './lib/north-materials.js';

// OSM footprint w27574394
const C = [
  [22.9, -11.5], [27.2, -10.3], [59.3, -121.2], [55.0, -122.5], [57.5, -131.2], [78.2, -125.1], [78.0, -124.5], [98.8, -118.2],
  [102.8, -131.6], [105.5, -130.7], [106.8, -136.0], [135.2, -127.8], [127.6, -102.3], [112.2, -106.7], [104.0, -79.7],
  [137.0, -70.2], [125.7, -30.0], [127.4, -29.4], [129.3, -30.8], [132.6, -30.7], [135.8, -28.5], [137.1, -25.4],
  [136.6, -21.7], [134.0, -18.6], [130.1, -17.7], [126.5, -18.8], [122.9, -6.0], [128.5, -4.1], [120.2, 25.6], [65.1, 9.4],
  [71.9, -14.1], [67.8, -15.2], [67.5, -16.6], [66.6, -17.7], [62.7, -19.1], [61.8, -16.2], [58.4, -17.3], [59.2, -20.1],
  [55.9, -21.0], [52.9, -19.7], [49.1, -20.7], [42.3, 2.5], [38.7, 1.4], [38.5, 2.1], [20.3, -3.0],
];
// Local frame: origin at the south end of the Cut facade (C[1]), n runs north along the facade, e runs east.
const FR = makeFrame(C[1], [C[2][0] - C[1][0], C[2][1] - C[1][1]]);
const L = (e, n) => FR.W(e, n);
const V = (i) => C[i];

const G0 = 49.5;          // plateau level along the Cut
const FL = 4.6;           // storey height of the halls behind the range
const RN = FR.toLocal(C[2][0], C[2][1])[1];   // length of the Cut range (≈115 m, C[1] → C[2])
const NB = 24, BAY = RN / NB;                  // loggia bays (≈4.8 m on centre)
const LOG_H = 6.2;        // loggia height (underside of the upper wall) above G0
const LOG_D = 4.0;        // loggia depth (piers at the facade line, back wall recessed)
const PIER = 1.5;         // square brick piers
const ORIEL = { w: 4.4, y0: G0 + 4.9, y1: G0 + 11.6 };   // glass oriels on the pavilions (3 x 8 panes)
const NF = 123.7;         // north (Forbes) face of the 2016 lobby
const ROT = { e: 29.5, n: 28.0, r: 9.4 };                // rotunda over the Merson Courtyard entrance

async function buildCohon(ctx) {
  const LOW = ctx.quality?.level === 'low';
  const kit = new MeshKit();
  const rand = prng(1996);
  const gs = groundStats(ctx, C, 4);
  const base = gs.min - 1.2;
  const P = (e, n, y) => { const [x, z] = L(e, n); return [x, y, z]; };
  const nE = [FR.E[0], 0, FR.E[1]], nN = [FR.N[0], 0, FR.N[1]];
  const nW = [-nE[0], 0, -nE[2]], nS = [-nN[0], 0, -nN[2]];

  // ---------------------------------------------------------------- volumes
  const rangeTop = G0 + 11.0;                // eave of the Cut range: loggia + brick band + clerestory
  const pavTop = G0 + 14.0;                  // four-storey end pavilions
  const lowTop = G0 + 2 * FL + 1.1;          // connecting block behind the range
  const RB = 5.0, RRISE = 1.6;               // range roof: sloped metal band RB m deep rising RRISE, flat behind
  const vol = [];
  const add = (ring, y1, wallKey, win = null, extra = {}) => {
    if (win && typeof win === 'object') { extra = win; win = null; }
    const v = { ring, y0: base, y1, wallKey, win, vRef: G0, parapet: 0, roofKey: 'flat', ...extra };
    vol.push(v);
    return v;
  };

  // Cut range: the ground floor is recessed LOG_D behind the pier line (the loggia), the upper wall sits on the piers
  const rangeRing = (e0) => [L(e0, 0), L(14, 0), L(14, 100), L(17.1, 100), L(17.1, RN), L(e0, RN)];
  add(rangeRing(LOG_D), G0 + LOG_H, 'brickP', 'inner', { roofKey: false });
  add(rangeRing(0), rangeTop, 'brickP', 'clere', { y0: G0 + LOG_H, soffitKey: 'stone', roofKey: false });
  // flat roof behind the sloped eave band (its low rear wall shows above the connecting block)
  add(rangeRing(RB), rangeTop + RRISE, 'brickP', { y0: rangeTop, parapet: 0.35, parapetKey: 'brickP', copingKey: 'roof' });
  // end pavilions (from the footprint: 9 m deep, projecting 4.5 m in front of the range; gable ends to the Cut)
  const PAV = [
    { e0: -4.6, e1: 18.1, n0: -8.9, n1: 0, oriel: -2.9 },       // south-west, on the Merson court corner
    { e0: -4.5, e1: 17.1, n0: RN, n1: 124.4, oriel: RN + 3.1 },  // north-west, towards Forbes Avenue
  ];
  for (const p of PAV) add(rectLocal(FR, p.e0, p.e1, p.n0, p.n1), pavTop, 'brickP', 'pav', { roofKey: false });
  // connecting block (offices, courts, dining). On the Merson Courtyard (south) its two recessed entrance bays are glazed.
  const inCourt = (a, b) => {
    const [e0, n0] = FR.toLocal(a[0], a[1]), [e1, n1] = FR.toLocal(b[0], b[1]);
    return (Math.min(e0, e1) > 20 && Math.max(e0, e1) < 39 && Math.min(n0, n1) > 17.4 && Math.max(n0, n1) < 19) ? 'court' : null;
  };
  add([V(40), V(39), V(38), V(37), V(36), V(35), V(34), V(33), V(32), V(31), V(30), V(29), V(28), V(27), V(26), V(25), V(24), V(23), V(22), V(21), V(20), V(19), V(18), V(17), V(16), V(15), V(14), L(54.6, 100), L(17.1, 100), L(14, 100), L(14, 0), L(18.1, 0)],
    lowTop, 'brickP', 'B', { parapet: 0.7, parapetKey: 'brickP', copingKey: 'stone', edgeKey: inCourt });
  // tall halls behind: pool (south-east, flat, glazed south clerestory), Wiegand Gym (east, hipped), McConomy / Rangos
  const poolTop = G0 + 12.4, gymEave = G0 + 15.8, hallTop = G0 + 13.0;
  add(rectLocal(FR, 50, 99.2, -8.5, 22.2), poolTop, 'brickP', 'B', { parapet: 0.8, parapetKey: 'brickP', copingKey: 'stone' });
  const GYM = { e0: 52, e1: 88.9, n0: 46.4, n1: 88.0 };
  add(rectLocal(FR, GYM.e0, GYM.e1, GYM.n0, GYM.n1), gymEave, 'brickP', 'G', { roofKey: false });
  add(rectLocal(FR, 17.5, 40, 46, 100), hallTop, 'brickP', 'A', { parapet: 0.8, parapetKey: 'brickP', copingKey: 'stone' });

  // 2016 addition (Forbes side)
  const addTop = G0 + 10.8;
  add(rectLocal(FR, 17.1, 38.9, 100, NF), addTop, 'brickP', {
    parapet: 0.5, parapetKey: 'panel', copingKey: 'black',
    edgeKey: (a, b) => { const [, n0] = FR.toLocal(a[0], a[1]), [, n1] = FR.toLocal(b[0], b[1]); return n0 > NF - 0.5 && n1 > NF - 0.5 ? 'atrium' : null; },
  });
  add(rectLocal(FR, 38.9, 54.8, 100, 116.2), addTop, 'panel', { parapet: 0.5, parapetKey: 'panel', copingKey: 'black' });
  const GREY = [L(38.9, 116.2), L(56, 116.2), L(56, 142.9), L(41.5, 142.9), L(41.6, 137.45), L(38.9, 137.5)];
  add(GREY, G0 + 13.4, 'panel', { parapet: 0.45, parapetKey: 'panel', copingKey: 'black' });
  // black box: upper floors on the full footprint, recessed ground floor below (open corner on dark columns)
  const BB = { e0: 56, e1: 71.1, n0: 116.3, n1: 142.9 };
  add(rectLocal(FR, BB.e0, BB.e1, BB.n0, BB.n1), G0 + 14.2, 'black', 'BB', { y0: G0 + 4.4, soffitKey: 'black', parapet: 0.3, parapetKey: 'black', copingKey: 'black' });
  add(rectLocal(FR, BB.e0, BB.e1 - 2.6, BB.n0, BB.n1 - 3.2), G0 + 4.4, 'bbGlass', { roofKey: false });
  // stair shaft clad in the grey panels, rising above the lobby roof and carrying the entrance roof plane
  add(rectLocal(FR, 28.2, 31.8, 119.2, NF + 0.6), G0 + 15.2, 'panel', { roofKey: 'panel' });
  // round stair tower on the east side (the bulge in the footprint) — built below as a cylinder

  // ---------------------------------------------------------------- walls + windows
  const H = (x, z) => ctx.heightAt(x, z);
  const full = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) > RN - 1;   // the full-length range strip
  const WIN = {
    // tall windows of the McConomy hall
    A: { bay: 3.4, winW: 1.5, winH: 2.75, sill: 0.85, floor: FL, depth: 0.32, floors: [0, 2], transom: 0.74, pilaster: LOW ? null : { key: 'brickP', w: 0.62, proj: 0.18 } },
    // high strip windows of the halls and the connecting block
    B: { bay: 6.4, winW: 3.4, winH: 1.5, sill: 2.4, floor: FL, depth: 0.3, floors: [0, 2] },
    // gym: a row of high windows under the eave only
    G: { bay: 7.2, winW: 4.2, winH: 1.8, sill: 12.6, floor: 100, depth: 0.3, floors: [0, 0], lights: 3 },
    // back wall of the loggia: tall glazed openings, one per bay
    inner: (a, b) => ({ bay: BAY, winW: 2.5, depth: 0.3, count: full(a, b) ? NB : 0, levels: [{ y: 0.5, h: 4.2, lights: 2, transom: 0.72 }] }),
    // clerestory of triple windows over the loggia, one group per bay
    clere: (a, b) => ({ bay: BAY, winW: 3.0, depth: 0.34, count: full(a, b) ? NB : 0, levels: [{ y: 8.85, h: 1.65, lights: 3 }] }),
    // pavilions: tall ground-floor openings, two storeys of windows, a band of triple windows under the eave
    pav: {
      bay: 4.4, winW: 2.2, depth: 0.34, levels: [
        { y: 0.5, h: 3.5, lights: 2, transom: 0.7 },
        { y: 5.5, h: 2.1, winW: 1.4 },
        { y: 8.4, h: 2.1, winW: 1.4 },
        { y: 11.4, h: 1.85, winW: 3.3, lights: 3 },
      ],
    },
    // black box: big two-pane windows on both upper floors
    BB: { bay: 4.8, winW: 3.3, depth: 0.25, glassKey: 'bbGlass', wallKey: 'black', noFrame: true, levels: [{ y: 5.3, h: 3.2, lights: 2 }, { y: 9.6, h: 3.4, lights: 2 }] },
  };
  // no windows behind the glass oriels on the pavilions' west faces, where the range roof meets a pavilion, nor on
  // faces of the black box that the grey volume hides
  const behindOriel = (x, z, yb) => {
    const [e, nn] = FR.toLocal(x, z);
    if (yb > G0 + 4 && e < -4 && PAV.some((p) => Math.abs(nn - p.oriel) < 2.6)) return true;
    return (Math.abs(nn) < 0.6 || Math.abs(nn - RN) < 0.6) && e > -1.8 && e < 15.8 && yb > G0 + LOG_H - 1 && yb < rangeTop + 2.2;
  };
  massing(kit, vol, {
    wallBuilder(v, a, b, n, y0, y1, u, i, key) {
      if (!v.win || key !== v.wallKey) return false;
      const spec = typeof WIN[v.win] === 'function' ? WIN[v.win](a, b) : WIN[v.win];
      const wk = spec.wallKey || 'brickP';
      return punchedWall(kit, a, b, n, y0, y1, u, G0, {
        ...spec, wallKey: wk, glassKey: spec.glassKey || 'win', frameKey: (LOW || spec.noFrame) ? null : 'wframe',
        sillKey: spec.noFrame ? null : 'stone', revealKey: wk, rand, cellUV, ground: H, skip: behindOriel,
      });
    },
  });

  // ---------------------------------------------------------------- the loggia: piers, imposts, bases, lights
  const piers = loggiaPiers(kit, FR, {
    bay: BAY, count: NB, out: -1, G0, base, logH: LOG_H, logD: LOG_D, pier: PIER, stringY: G0 + 8.72,
    keys: { brick: 'brickP', stone: 'stone', lamp: 'lamp' },
  });
  for (const [x, z] of piers) ctx.colliders.addBox(x, z, PIER / 2 + 0.05, PIER / 2 + 0.05, FR.rotY, base, G0 + LOG_H, 'cohon');

  // ---------------------------------------------------------------- roofs: dark standing-seam metal, deep bracketed eaves
  const OV = 1.4;
  {
    // Cut range: a sloped band RB deep from the bracketed eave up to the flat roof
    const slope = RRISE / RB, yO = rangeTop - slope * OV, yT = rangeTop + RRISE, len = RN, sl = Math.hypot(RB + OV, RRISE + slope * OV);
    kit.quadH('roof', P(-OV, 0, yO), P(-OV, RN, yO), P(RB, RN, yT), P(RB, 0, yT), [0, 1, 0], [0, 0], [len, 0], [len, sl], [0, sl]);
    kit.quadH('roof', P(-OV, 0, yO - 0.02), P(-OV, RN, yO - 0.02), P(0, RN, rangeTop - 0.02), P(0, 0, rangeTop - 0.02), [0, -1, 0]);
    if (!LOW) eaveBrackets(kit, 'roof', FR, 'n', 0.7, RN - 0.7, 0, -OV + 0.05, rangeTop, yO, OV);
  }
  // pavilions: gables facing the Cut (ridge along e)
  for (const p of PAV) {
    const rise = 1.7, h = (p.n1 - p.n0) / 2, yO = pavTop - rise * OV / h;
    gableRoof(kit, 'roof', 'brickP', FR, p.e0, p.e1, p.n0, p.n1, pavTop, rise, 'e', { overhang: OV, vRef: G0 });
    if (!LOW) {
      eaveBrackets(kit, 'roof', FR, 'e', p.e0 + 0.6, p.e1 - 0.6, p.n0, p.n0 - OV + 0.05, pavTop, yO, OV);
      eaveBrackets(kit, 'roof', FR, 'e', p.e0 + 0.6, p.e1 - 0.6, p.n1, p.n1 + OV - 0.05, pavTop, yO, OV);
    }
    const ring = rectLocal(FR, p.e0, p.e1, p.n0, p.n1);
    bandRing(kit, 'stone', ring, G0 + 0.45, 0.26, 0.9);      // base course / water table
    bandRing(kit, 'stone', ring, G0 + 4.95, 0.2, 0.3);       // string course over the ground storey
    bandRing(kit, 'stone', ring, G0 + 11.15, 0.16, 0.24);    // sill band of the top-floor windows
  }
  // Wiegand Gym: big low hipped roof in light grey metal
  hipRoof(kit, 'gymRoof', FR, GYM.e0 - 0.6, GYM.e1 + 0.6, GYM.n0 - 0.6, GYM.n1 + 0.6, gymEave - 0.15, 5.0);
  kit.cap('gymRoof', rectLocal(FR, GYM.e0 - 0.6, GYM.e1 + 0.6, GYM.n0 - 0.6, GYM.n1 + 0.6), gymEave - 0.17, false);
  bandRing(kit, 'stone', rectLocal(FR, GYM.e0, GYM.e1, GYM.n0, GYM.n1), gymEave - 0.35, 0.3, 0.5);
  // pool hall: south-facing glazed clerestory on the flat roof
  {
    const y0 = poolTop, y1 = poolTop + 2.3, e0 = 51.5, e1 = 97.8, nA = -6.8, nB = -2.2;
    kit.quad('skylight', P(e0, nA, y0), P(e1, nA, y0), P(e1, nA, y1), P(e0, nA, y1), nS, [0, 0], [e1 - e0, 0], [e1 - e0, 2.3], [0, 2.3]);
    kit.quadH('roof', P(e0, nA, y1), P(e1, nA, y1), P(e1, nB, y0 + 0.3), P(e0, nB, y0 + 0.3), [0, 1, 0], [0, 0], [e1 - e0, 0], [e1 - e0, 4.9], [0, 4.9]);
    for (const e of [e0, e1]) kit.triH('roof', P(e, nA, y0), P(e, nA, y1), P(e, nB, y0 + 0.3), e === e0 ? nW : nE);
  }

  // ---------------------------------------------------------------- rotunda (Merson Courtyard entrance hall)
  {
    const SEG = LOW ? 16 : 28, [cx, cz] = L(ROT.e, ROT.n), r = ROT.r, rIn = r - 1.5;
    const yTop = G0 + 14.2, gl0 = lowTop + 0.6, gl1 = G0 + 13.1;
    const circ = 2 * Math.PI * r;
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2, am = (a0 + a1) / 2;
      const p0 = [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r];
      const n = [Math.cos(am), 0, Math.sin(am)], u0 = (i / SEG) * circ, u1 = ((i + 1) / SEG) * circ;
      const W = (key, y0, y1) => kit.quad(key, [p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], n, [u0, y0 - G0], [u1, y0 - G0], [u1, y1 - G0], [u0, y1 - G0]);
      W('brickP', lowTop - 0.2, gl0);
      W('rotGlass', gl0, gl1);
      W('brickP', gl1, yTop);
      // flat ring roof + coping
      const q0 = [cx + Math.cos(a0) * rIn, cz + Math.sin(a0) * rIn], q1 = [cx + Math.cos(a1) * rIn, cz + Math.sin(a1) * rIn];
      kit.quad('flat', [p0[0], yTop, p0[1]], [p1[0], yTop, p1[1]], [q1[0], yTop, q1[1]], [q0[0], yTop, q0[1]], [0, 1, 0], [p0[0], p0[1]], [p1[0], p1[1]], [q1[0], q1[1]], [q0[0], q0[1]]);
      // low glazed cone
      const apex = [cx, yTop + 2.4, cz];
      kit.triH('skylight', [q0[0], yTop + 0.25, q0[1]], [q1[0], yTop + 0.25, q1[1]], apex, [0, 1, 0], [0, 0], [(u1 - u0) * rIn / r, 0], [0, rIn]);
      if (!LOW && i % 2 === 0) kit.beam('frame', [q0[0], yTop + 0.33, q0[1]], [apex[0], apex[1] + 0.08, apex[2]], 0.14, 0.16);
    }
    bandRing(kit, 'stone', Array.from({ length: SEG }, (_, i) => [cx + Math.cos(i / SEG * Math.PI * 2) * r, cz + Math.sin(i / SEG * Math.PI * 2) * r]), yTop + 0.12, 0.3, 0.28);
    kit.cylinder('roof', cx, cz, yTop + 2.1, yTop + 2.8, 1.2, 1.0, 12);        // small cap over the apex
  }

  // ---------------------------------------------------------------- pavilion oriels: dark-framed glass bays on columns
  const orielColliders = [];
  for (const p of PAV) {
    orielColliders.push(...orielBay(kit, FR, {
      eFace: p.e0, n: p.oriel, out: -1, w: ORIEL.w, y0: ORIEL.y0, y1: ORIEL.y1, base,
      keys: { glass: 'oriel', frame: 'frame', cap: 'roof', column: 'stone' },
    }));
  }

  // ---------------------------------------------------------------- Merson Courtyard: door canopies in the two entrance bays
  for (const [ea, eb] of [[24.6, 28.0], [31.7, 35.8]]) {
    const [cx, cz] = L((ea + eb) / 2, 17.4);
    kit.box('frame', cx, G0 + 3.6, cz, 0.25, 0.28, (eb - ea) + 0.6, FR.rotY);
    kit.box('lamp', cx, G0 + 3.45, cz, 1.4, 0.03, (eb - ea) - 0.4, FR.rotY, { faces: { ny: 1 } });
  }
  // round stair tower on the east side (the bulge in the footprint)
  {
    const pts = C.slice(17, 26);
    const [tx, tz] = ringCentroid(pts);
    const r = pts.reduce((s, p) => s + Math.hypot(p[0] - tx, p[1] - tz), 0) / pts.length;
    kit.cylinder('brickP', tx, tz, base, G0 + 16.5, r, r, 20, { top: false });
    kit.cylinder('roof', tx, tz, G0 + 16.5, G0 + 17.3, r + 0.3, r + 0.3, 20);
    // slit windows
    for (let k = 0; k < 5; k++) {
      const a = -0.4 + k * 0.45;
      const nx = Math.cos(a + Math.atan2(FR.E[1], FR.E[0])), nz = Math.sin(a + Math.atan2(FR.E[1], FR.E[0]));
      for (let f = 0; f < 3; f++) {
        const y0 = G0 + 1 + f * FL, y1 = y0 + 3.0;
        const px = tx + nx * (r + 0.03), pz = tz + nz * (r + 0.03), tx2 = -nz * 0.35, tz2 = nx * 0.35;
        const [u0, v0, u1, v1] = cellUV(rand);
        kit.quad('win', [px - tx2, y0, pz - tz2], [px + tx2, y0, pz + tz2], [px + tx2, y1, pz + tz2], [px - tx2, y1, pz - tz2], [nx, 0, nz], [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
      }
    }
  }

  // ---------------------------------------------------------------- 2016 addition: Forbes Avenue entrance
  const colliderExtra = [];
  {
    // silver fins on the lobby glass east of the stair shaft
    if (!LOW) for (let e = 32.7; e < 38.6; e += 1.2) {
      const [x, z] = L(e, NF + 0.24);
      kit.box('fin', x, (G0 + addTop) / 2, z, 0.08, addTop - G0 - 0.2, 0.46, FR.rotY);
    }
    // glass vestibule with the name fascia
    const V0 = 19.9, V1 = 28.1, VN = NF + 3.2, fy0 = G0 + 4.3, fy1 = G0 + 5.6;
    kit.quad('door', P(V0 + 0.2, VN, base), P(V1 - 0.2, VN, base), P(V1 - 0.2, VN, fy0), P(V0 + 0.2, VN, fy0), nN, [0, base - G0], [V1 - V0, base - G0], [V1 - V0, fy0 - G0], [0, fy0 - G0]);
    for (const e of [V0 + 0.2, V1 - 0.2]) {
      const n = e < 20 ? nW : nE;
      kit.quad('door', P(e, NF, base), P(e, VN, base), P(e, VN, fy0), P(e, NF, fy0), n, [0, base - G0], [VN - NF, base - G0], [VN - NF, fy0 - G0], [0, fy0 - G0]);
    }
    const [fx, fz] = L((V0 + V1) / 2, (NF + VN + 0.3) / 2);
    kit.box('panel', fx, (fy0 + fy1) / 2, fz, V1 - V0, fy1 - fy0, VN + 0.3 - NF, FR.rotY);
    kit.box('lamp', fx, fy0 - 0.02, fz, V1 - V0 - 0.6, 0.03, VN - NF - 0.3, FR.rotY, { faces: { ny: 1 } });
    if (!LOW) {
      const [sx, sz] = L((V0 + V1) / 2, VN + 0.32);
      signQuad(kit, 'sign', signAtlas(ctx), 0, sx, (fy0 + fy1) / 2 + 0.02, sz, nN, 0.48);
    }
    // the tall pier and the cantilevered roof plane ("L" frame) over the plaza
    const pierE = 18.95, pierN = NF + 4.2, top0 = G0 + 15.2, top1 = G0 + 16.4;
    const [px, pz] = L(pierE, pierN);
    kit.box('panel', px, (base + top1) / 2, pz, 1.3, top1 - base, 1.3, FR.rotY);
    const [cx, cz] = L((18.3 + 32.2) / 2, (117 + pierN + 0.65) / 2);
    kit.box('panel', cx, (top0 + top1) / 2, cz, 32.2 - 18.3, top1 - top0, pierN + 0.65 - 117, FR.rotY);
    colliderExtra.push([px, pz]);
  }
  // black box: dark steel columns at the open corner of the recessed ground floor
  for (const [e, n] of [[BB.e1 - 0.5, BB.n1 - 0.5], [BB.e1 - 0.5, 129.6], [BB.e0 + 6.5, BB.n1 - 0.5]]) {
    const [x, z] = L(e, n);
    kit.box('black', x, (base + G0 + 4.4) / 2, z, 0.5, G0 + 4.4 - base, 0.5, FR.rotY);
    colliderExtra.push([x, z]);
  }
  // grey volume: black-framed window box on the lobby side (west) and a tall window to Forbes (north)
  const frameBox = (eF, nC, w, y0, y1, face, depth = 0.7) => {
    const t = 0.35;
    if (face === 'w') {
      const cE = eF - depth / 2;
      kit.quad('bbGlass', P(eF - 0.03, nC + w / 2, y0), P(eF - 0.03, nC - w / 2, y0), P(eF - 0.03, nC - w / 2, y1), P(eF - 0.03, nC + w / 2, y1), nW, [0, y0 - G0], [w, y0 - G0], [w, y1 - G0], [0, y1 - G0]);
      for (const [n, sy, sn] of [[nC, y1 + t / 2, w + 2 * t], [nC, y0 - t / 2, w + 2 * t]]) { const [x, z] = L(cE, n); kit.box('black', x, sy, z, depth, t, sn, FR.rotY); }
      for (const n of [nC - w / 2 - t / 2, nC + w / 2 + t / 2]) { const [x, z] = L(cE, n); kit.box('black', x, (y0 + y1) / 2, z, depth, y1 - y0, t, FR.rotY); }
    } else {
      const cN = eF + depth / 2;
      kit.quad('bbGlass', P(nC - w / 2, eF + 0.03, y0), P(nC + w / 2, eF + 0.03, y0), P(nC + w / 2, eF + 0.03, y1), P(nC - w / 2, eF + 0.03, y1), nN, [0, y0 - G0], [w, y0 - G0], [w, y1 - G0], [0, y1 - G0]);
      for (const [sy] of [[y1 + t / 2], [y0 - t / 2]]) { const [x, z] = L(nC, cN); kit.box('black', x, sy, z, w + 2 * t, t, depth, FR.rotY); }
      for (const e of [nC - w / 2 - t / 2, nC + w / 2 + t / 2]) { const [x, z] = L(e, cN); kit.box('black', x, (y0 + y1) / 2, z, t, y1 - y0, depth, FR.rotY); }
    }
  };
  frameBox(38.9, 128.5, 6.2, G0 + 5.0, G0 + 11.4, 'w');
  kit.quad('black', P(38.86, 133.2, G0 + 1.0), P(38.86, 131.8, G0 + 1.0), P(38.86, 131.8, G0 + 12.4), P(38.86, 133.2, G0 + 12.4), nW, [0, 0], [1.4, 0], [1.4, 11.4], [0, 11.4]);   // dark panel strip
  frameBox(142.9, 48.8, 9.0, G0 + 5.4, G0 + 11.4, 'n', 0.5);   // (face 'n': eF = n of the face, nC = e of the centre)
  kit.quad('door', P(42.2, 142.93, base), P(55.2, 142.93, base), P(55.2, 142.93, G0 + 3.8), P(42.2, 142.93, G0 + 3.8), nN, [0, 0], [13, 0], [13, 3.8], [0, 3.8]);
  // gabion-basket planters along the entrance plaza
  if (!LOW) {
    for (const [e0, e1, n0, n1, h] of [[33, 38.4, 128.6, 129.8, 0.8], [40.5, 47.5, 146, 147.2, 0.9], [49, 55.5, 147.8, 149, 0.7]]) {
      const [x, z] = L((e0 + e1) / 2, (n0 + n1) / 2), g = ctx.heightAt(x, z);
      kit.box('gabion', x, g + h / 2 - 0.15, z, e1 - e0, h + 0.3, n1 - n0, FR.rotY, { vRef: g });
      kit.box('wood', x, g + h + 0.2, z, Math.min(3.2, e1 - e0 - 1), 0.1, n1 - n0 + 0.1, FR.rotY);
    }
  }

  // ---------------------------------------------------------------- materials
  const M = ctx.materials;
  // pale buff "factory" brick, variegated but close in tone (reads almost greige next to the Hornbostel buildings)
  const buff = ['#cdbd9c', '#c4b392', '#d3c4a6', '#bdab8a', '#cab999', '#b5a282'];
  const roof = seamMetal(ctx, { color: '#4f555b' });                  // dark grey standing seam (roofs, eaves, trim)
  const frame = plain(ctx, '#3c4744', { roughness: 0.5, metalness: 0.35 });   // dark green-grey window & oriel frames
  const black = plain(ctx, '#26292d', { roughness: 0.45, metalness: 0.5 });
  const panel = metalPanels(ctx, { color: '#b3b6b4', panelW: 1.2, panelH: 0.6, tileM: 4.8, metalness: 0.35, roughness: 0.5, seed: 16 });
  const group = kit.build({
    brickP: brickPlain(ctx, { colors: buff, weights: [3, 3, 2, 2, 3, 1], brickW: 0.215, brickH: 0.0675, joint: 0.01, mortar: '#d2c9b6' }),
    stone: M.get('limestone'),
    flat: M.get('flatRoof'),
    roof,
    gymRoof: seamMetal(ctx, { color: '#848a8e', seam: 0.55, metalness: 0.45, roughness: 0.5 }),
    wframe: frame,
    frame,
    black,
    panel,
    fin: plain(ctx, '#c5c9cb', { roughness: 0.35, metalness: 0.6 }),
    wood: plain(ctx, '#b58a5c', { roughness: 0.8 }),
    gabion: gabion(ctx),
    sign: signAtlas(ctx).material,
    win: glz(ctx, 'winBuff'),
    oriel: glz(ctx, 'oriel', ORIEL.w / 3, (ORIEL.y1 - ORIEL.y0) / 8),
    skylight: glz(ctx, 'skylight', 1.4, 1.4),
    court: glz(ctx, 'lightCurtain', 1.5, FL),
    rotGlass: glz(ctx, 'lightCurtain', 1.2, 2.4),
    atrium: glz(ctx, 'cucAtrium', 1.25, 5.4),
    bbGlass: glz(ctx, 'blackBox', 1.6, 2.2),
    door: glz(ctx, 'door', 1.5, 3.3),
    lamp: glz(ctx, 'lamp'),
  }, { name: 'landmark:cohon' });

  // colliders: the footprint with its Cut side pulled back to the loggia's back wall (the covered walk is open),
  // the upper wall over the loggia, piers (above), the oriel columns, the entrance pier and the black-box columns
  const ring = C.slice();
  ring.splice(1, 2, L(LOG_D, 0), L(LOG_D, RN));
  ctx.colliders.addPolygon(ring, base, G0 + 16, 'cohon');
  ctx.colliders.addPolygon(rectLocal(FR, 0, LOG_D, 0, RN), G0 + LOG_H, rangeTop + 2, 'cohon');
  ctx.colliders.addPolygon(rectLocal(FR, 19.9, 28.1, NF, NF + 3.2), base, G0 + 5.6, 'cohon');
  for (const [x, z] of orielColliders) ctx.colliders.addCircle(x, z, 0.35, base, G0 + 5, 'cohon');
  for (const [x, z] of colliderExtra) ctx.colliders.addCircle(x, z, 0.75, base, G0 + 16, 'cohon');

  const c = FR.W(50, 60);
  registerLandmark(ctx, group, {
    key: 'cohon', name: 'Cohon University Center', nameZh: '科翁大学中心', osmId: 'w27574394',
    position: [c[0], G0 + 12, c[1]], radius: 70, labelY: G0 + 24,
  });
  return group;
}

export default [
  {
    key: 'cohon',
    name: 'Cohon University Center',
    nameZh: '科翁大学中心',
    osmIds: ['w27574394'],
    build: buildCohon,
  },
];
