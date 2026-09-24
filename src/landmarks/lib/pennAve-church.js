// East Liberty Presbyterian Church ("Cathedral of Hope"), Ralph Adams Cram / Cram & Ferguson, 1931-35, a gift of
// Richard Beatty and Jennie King Mellon. It fills the whole block between Penn Avenue, South Highland Avenue,
// Baum Boulevard's short spur and South Whitfield Street, and its crossing tower - about 300 ft / 91 m to the cross -
// is the landmark of East Liberty's skyline.
//
// Massing read from aerial imagery and street photographs (reference only, nothing is shipped):
//   * the nave runs from the Penn Avenue front (north-north-east, set back behind a lawn) towards the chancel at the
//     Whitfield / Baum corner; a clerestory vessel with narrow buttressed aisles and a low-pitched lead roof hidden
//     behind parapets;
//   * the Penn Avenue front is a tall screen: a deep pointed arch framing a five-light window, the carved portal below,
//     octagonal corner turrets with open lanterns and spirelets, and a pierced parapet;
//   * the square crossing tower: a plain lower stage with a row of small lancets, a very tall belfry with twin
//     traceried openings on each face between clasping buttresses, a pierced gallery, a crown of pinnacle clusters,
//     a set-back stage, an octagonal lantern and a slender stone spire with a verdigris copper tip and cross;
//   * transepts with traceried end windows and corner turrets, a chancel with a polygonal apse;
//   * a lower Gothic chapel along Penn Avenue east of the front, and the Tudor-Gothic church house (steep tile roofs,
//     gables, mullioned windows, a small spire) wrapped around two courtyards along Highland Avenue and the south street.
// Plan fitted to the OSM outline w34309874. Local frame: origin (1485, -1998), +u along Penn Avenue (east-south-east),
// +v away from Penn Avenue (south-south-west); the church axis is u = -17.6.
import * as THREE from 'three';
import {
  Batch, makeFrame, box, boxY, placeGeo, pyramidGeo, prismGeo, frustumGeo, pinnacle, wallQuad, ringWalls, cap,
  gableTri, gableRoof, hipRoof, rect, edgeNormal, atlasPanel, atlasDisc, archFrame, archApex, groundRange, wallWithHoles,
  distanceCull, DEG,
} from './pennAve-kit.js';
import { getPennMaterials } from './pennAve-materials.js';

export const ELPC_OSM = 'w34309874';

const P = {
  origin: [1485, -1998], angle: 24.3 * DEG,
  axis: -17.6,
  nave: { v0: -35.4, v1: -1.8, half: 6.2, aisle: 9.0 },   // clerestory half-width, aisle outer half-width
  tower: { v0: -1.8, v1: 11.6, half: 6.7 },
  transept: { u0: -37.1, u1: 1.9 },
  chancel: { v1: 26.0 },
  // heights above the Penn Avenue floor level G
  aisleEave: 11.5, aisleTop: 14.5, clerEave: 26, ridge: 29.5, frontTop: 31, frontPar: 33,
};

export async function buildELPC(ctx) {
  const { mats, cells } = getPennMaterials(ctx);
  const low = ctx.quality?.level === 'low';
  await ctx.yield?.();
  const frame = makeFrame(P.origin[0], P.origin[1], P.angle);
  const main = new Batch('elpc');
  const det = low ? null : new Batch('elpc-detail');
  const D = det || { add() {} };          // detail sink: dropped entirely on low
  const rec = ctx.data.buildings.find((b) => b.id === ELPC_OSM || b.osmId === ELPC_OSM);
  const ringLocal = rec ? rec.footprint.map(([x, z]) => frame.toLocal(x, z)) : rect(-43, 43, -40, 42);
  const { lo, hi } = groundRange(ctx, frame, ringLocal);
  const G = hi + 0.2;                     // floor level: the Penn Avenue front is the high side of the block
  const bottom = lo - 1.6;
  const Y = (h) => G + h;
  const AX = P.axis;
  const S = 'stone', SL = 'stoneLit';
  const T0 = performance.now(), timing = [];
  const mark = (name) => timing.push([name, Math.round(performance.now() - T0)]);

  // ---------------------------------------------------------------- helpers
  const wall = (a, b, y0, y1, key = S) => wallQuad(main, key, frame, a, b, y0, y1, { vRef: G });
  const faceOf = (n) => (Math.abs(n[0]) > 0.5 ? (n[0] > 0 ? '+u' : '-u') : (n[1] > 0 ? '+v' : '-v'));
  const blockWalls = (u0, u1, v0, v1, y0, y1, faces, key = S) => {
    const r = rect(u0, u1, v0, v1);
    for (let i = 0; i < 4; i++) { const a = r[i], b = r[(i + 1) % 4]; if (faces.includes(faceOf(edgeNormal(a, b)))) wall(a, b, y0, y1, key); }
    return r;
  };
  // horizontal moulding strip along a->b pushed `out` along its normal
  const strip = (batch, a, b, y0, h, t, out = 0, key = S) => {
    const n = edgeNormal(a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    box(batch, key, frame, (a[0] + b[0]) / 2 + n[0] * out, y0 + h / 2, (a[1] + b[1]) / 2 + n[1] * out, L, h, t,
      { rotY: Math.atan2(-(b[1] - a[1]), b[0] - a[0]), vRef: G });
  };
  // a traceried window from the atlas on wall a->b at fraction t, with a hood moulding in the detail batch
  const windowAt = (a, b, t, y0, w, hs, k, cell, { hood = true, key = 'win', frameT = 0.28 } = {}) => {
    const n = edgeNormal(a, b), u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
    atlasPanel(main, key, frame, cells[cell], { u, v, n, y0, w, hs, k });
    if (hood) archFrame(det ? D : main, S, frame, { u, v, n, y0, w, hs, k, t: frameT, d: 0.22, vRef: G });
  };
  // stepped buttress against a wall (foot at plan point (u,v), projecting along n), top at height top (above G)
  const buttress = (batch, u, v, n, top, { w = 1.1, d = 1.9, steps = 3, pin = 0 } = {}) => {
    const rot = Math.atan2(n[0], n[1]);
    let y0 = bottom;
    for (let s = 0; s < steps; s++) {
      const y1 = Y(top * (s + 1) / steps), dd = d * (1 - s * 0.28);
      box(batch, S, frame, u + n[0] * dd / 2, (y0 + y1) / 2, v + n[1] * dd / 2, w, y1 - y0, dd, { rotY: rot, vRef: G });
      // weathering set-off: a sloped cap reads as a thin wedge - a small shallow box is enough at this scale
      box(batch, S, frame, u + n[0] * (dd - 0.15), y1 + 0.12, v + n[1] * (dd - 0.15), w + 0.12, 0.24, 0.5, { rotY: rot, vRef: G });
      y0 = y1;
    }
    if (pin) pinnacle(batch, S, frame, u + n[0] * 0.5, Y(top), v + n[1] * 0.5, 0.75, pin * 0.35, pin * 0.65, rot);
  };
  const pierced = (batch, a, b, y0, h, key = S) => {
    // pierced parapet: stone rail + posts; the openings read as a row of dark lights
    const n = edgeNormal(a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    strip(batch, a, b, y0, 0.3, 0.45, 0, key);
    strip(batch, a, b, y0 + h - 0.28, 0.28, 0.5, 0, key);
    const cnt = Math.max(2, Math.round(L / 1.1));
    for (let i = 0; i <= cnt; i++) {
      const t = i / cnt, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
      box(batch, key, frame, u, y0 + h / 2, v, 0.28, h, 0.4, { rotY: Math.atan2(-(b[1] - a[1]), b[0] - a[0]), vRef: G });
    }
    // back plate (dark) so the parapet reads pierced against the roof
    box(batch, 'dark', frame, (a[0] + b[0]) / 2 - n[0] * 0.12, y0 + h / 2, (a[1] + b[1]) / 2 - n[1] * 0.12, L, h - 0.5, 0.05,
      { rotY: Math.atan2(-(b[1] - a[1]), b[0] - a[0]) });
  };

  const NV = P.nave, TW = P.tower;
  const cl0 = AX - NV.half, cl1 = AX + NV.half;        // clerestory walls
  const ai0 = AX - NV.aisle, ai1 = AX + NV.aisle;      // aisle outer walls
  const BAY = (NV.v1 - NV.v0 - 3.4) / 6;               // six nave bays behind the front screen

  // ================================================================ nave
  {
    const vF = NV.v0 + 3.4, v1 = NV.v1;                 // nave body behind the 3.4 m deep front block
    // aisle outer walls, clerestory walls, roofs
    blockWalls(ai0, cl0, vF, v1, bottom, Y(P.aisleEave), ['-u']);
    blockWalls(cl1, ai1, vF, v1, bottom, Y(P.aisleEave), ['+u']);
    blockWalls(cl0, cl1, vF, v1, Y(P.aisleEave), Y(P.clerEave), ['-u', '+u']);
    // aisle lean-to roofs (lead) - a sloped slab from the aisle eave to the clerestory wall
    for (const s of [-1, 1]) {
      const uo = s < 0 ? ai0 : ai1, ui = s < 0 ? cl0 : cl1;
      const run = Math.abs(ui - uo), rise = P.aisleTop - P.aisleEave, len = Math.hypot(run, rise) + 0.4;
      const g = new THREE.BoxGeometry(len, 0.2, v1 - vF);
      g.rotateZ(-s * Math.atan2(rise, run));
      placeGeo(main, 'leadRoof', frame, g, (uo + ui) / 2 - s * 0.1, Y((P.aisleEave + P.aisleTop) / 2) + 0.12, (vF + v1) / 2);
    }
    // main roof, low pitch behind the parapets
    gableRoof(main, 'leadRoof', frame, cl0 - 0.2, cl1 + 0.2, vF, v1, Y(P.clerEave), Y(P.ridge), { alongU: false, overhang: 0.1, ends: [false, false] });
    // clerestory windows + aisle windows per bay, buttresses between bays
    for (let i = 0; i < 6; i++) {
      const va = vF + i * BAY, vm = va + BAY / 2;
      for (const s of [-1, 1]) {
        const uc = s < 0 ? cl0 : cl1, uo = s < 0 ? ai0 : ai1;
        const a = s < 0 ? [uc, v1] : [uc, vF], b = s < 0 ? [uc, vF] : [uc, v1];
        const t = s < 0 ? (v1 - vm) / (v1 - vF) : (vm - vF) / (v1 - vF);
        windowAt(a, b, t, Y(15.4), 3.4, 6.2, 1, 'lancet2');
        const ao = s < 0 ? [uo, v1] : [uo, vF], bo = s < 0 ? [uo, vF] : [uo, v1];
        windowAt(ao, bo, t, Y(3.2), 2.3, 4.6, 1, 'lancet2');
        // buttress at the bay line: a tall pier rising through the aisle roof to the clerestory parapet
        const n = [s, 0];
        buttress(main, uo, va + (i === 0 ? 0.6 : 0), n, P.aisleEave + 5.5, { w: 1.25, d: 2.4, steps: 3, pin: 4.2 });
        boxY(main, S, frame, uc + s * 0.55, va + (i === 0 ? 0.6 : 0), 1.1, 1.0, Y(P.aisleTop - 0.5), Y(P.clerEave + 1.4), { vRef: G });
        pinnacle(D, S, frame, uc + s * 0.55, Y(P.clerEave + 1.4), va + (i === 0 ? 0.6 : 0), 0.8, 1.1, 2.6);
        // flyer-like quadrant between aisle buttress and clerestory pier
        const fl = new THREE.BoxGeometry(Math.abs(uo - uc) + 0.6, 0.7, 0.8);
        fl.rotateZ(-s * 0.55);
        placeGeo(D, S, frame, fl, (uo + uc) / 2 + s * 0.3, Y(P.aisleEave + 4.2), va + (i === 0 ? 0.6 : 0), 0, { vRef: G });
      }
    }
    // clerestory parapets
    for (const s of [-1, 1]) {
      const uc = s < 0 ? cl0 : cl1;
      const a = s < 0 ? [uc, v1] : [uc, vF], b = s < 0 ? [uc, vF] : [uc, v1];
      strip(main, a, b, Y(P.clerEave - 0.6), 0.6, 0.7, 0.2);
      pierced(D, a, b, Y(P.clerEave), 1.3);
      strip(main, a, b, Y(P.clerEave), 1.3, 0.35, 0);
      const ao = s < 0 ? [s < 0 ? ai0 : ai1, v1] : [ai1, vF], bo = s < 0 ? [ai0, vF] : [ai1, v1];
      strip(main, ao, bo, Y(P.aisleEave - 0.5), 0.5, 0.6, 0.15);
      strip(main, ao, bo, bottom, G + 1.1 - bottom, 0.5, 0.18);     // plinth
    }
  }

  mark('nave');
  // ================================================================ the Penn Avenue front
  {
    const v0 = NV.v0, v1 = NV.v0 + 3.4;
    const u0 = ai0 - 0.4, u1 = ai1 + 0.4;
    const fr = rect(u0, u1, v0, v1);
    ringWalls(main, SL, frame, fr, bottom, Y(P.frontTop), { vRef: G, skip: (a, b) => ['+v', '-v'].includes(faceOf(edgeNormal(a, b))) });
    // gable wall above the front block, behind the parapet
    wall([u1, v1], [u0, v1], Y(P.frontTop), Y(P.frontTop + 1), SL);
    cap(main, 'leadRoof', frame, fr, Y(P.frontTop) + 0.02);
    // the front face with two real openings: the great window in a deep reveal, and the portal below it
    const n = [0, -1], wW = 10.2, sill = 9.6, hs = 17.6, k = 0.85;
    const gw = { y0: Y(sill - 0.7), w: wW + 1.0, hs: hs - sill + 0.7, k: 0.84 };
    const pw = 4.0, phs = 4.3, pk = 0.8;
    const po = { y0: Y(0), w: pw, hs: phs, k: pk };
    wallWithHoles(main, SL, frame, [u0, v0], [u1, v0], bottom, Y(P.frontTop), [{ at: AX - u0, ...gw }, { at: AX - u0, ...po }], { vRef: G });
    for (const [o, depth, cellName] of [[gw, 1.5, 'great'], [po, 1.0, 'door']]) {
      archFrame(main, SL, frame, { u: AX, v: v0 + depth, n, y0: o.y0, w: o.w, hs: o.hs, k: o.k, t: 0.3, d: depth, vRef: G });   // reveal
      atlasPanel(main, 'win', frame, cells[cellName], { u: AX, v: v0, n, y0: o.y0, w: o.w, hs: o.hs, k: o.k, out: -depth + 0.03 });
    }
    // moulded orders in front of the wall around the great window
    archFrame(main, SL, frame, { u: AX, v: v0, n, y0: gw.y0, w: gw.w, hs: gw.hs, k: gw.k, t: 0.45, d: 0.3, vRef: G });
    archFrame(D, SL, frame, { u: AX, v: v0, n, y0: gw.y0 - 0.5, w: gw.w + 1.6, hs: gw.hs + 0.5, k: 0.82, t: 0.4, d: 0.55, vRef: G });
    // blind arcade under the window
    for (let i = 0; i < 7; i++) {
      const u = AX - 4.5 + i * 1.5;
      if (Math.abs(u - AX) < 2.6) continue;
      atlasPanel(D, 'dark', frame, [0, 0, 1, 1], { u, v: v0, n, y0: Y(6.4), w: 0.9, hs: 1.6, k: 1, out: 0.02 });
      archFrame(D, SL, frame, { u, v: v0, n, y0: Y(6.4), w: 0.9, hs: 1.6, k: 1, t: 0.16, d: 0.14, vRef: G });
    }
    archFrame(main, SL, frame, { u: AX, v: v0, n, y0: Y(0), w: pw, hs: phs, k: pk, t: 0.55, d: 0.45, vRef: G });
    archFrame(D, SL, frame, { u: AX, v: v0 - 0.55, n, y0: Y(0), w: pw + 1.2, hs: phs, k: 0.78, t: 0.45, d: 0.35, vRef: G });
    // portal gablet with flanking pinnacles
    {
      const ph = phs + archApex(pw + 2.1, 0.78);
      const tri = new THREE.Shape([new THREE.Vector2(-(pw + 2.4) / 2, 0), new THREE.Vector2((pw + 2.4) / 2, 0), new THREE.Vector2(0, 2.8)]);
      placeGeo(D, SL, frame, new THREE.ExtrudeGeometry(tri, { depth: 0.4, bevelEnabled: false }), AX, Y(ph - 0.4), v0 - 0.9, Math.PI, { vRef: G });
      for (const s of [-1, 1]) {
        boxY(main, SL, frame, AX + s * (pw / 2 + 1.5), v0 - 0.5, 0.8, 1.2, bottom, Y(ph + 0.6), { vRef: G });
        pinnacle(D, SL, frame, AX + s * (pw / 2 + 1.5), Y(ph + 0.6), v0 - 0.5, 0.7, 0.8, 2.2);
      }
    }
    // steps up from the lawn
    for (let i = 0; i < 4; i++) boxY(main, 'concrete', frame, AX, v0 - 1.4 - i * 0.45, 7.5 + i * 0.6, 0.9, bottom, Y(-i * 0.16), { vRef: G });
    // string courses and the pierced parapet across the top
    strip(main, [u0, v0], [u1, v0], Y(sill - 1.6), 0.45, 0.5, 0.2, SL);
    strip(main, [u0, v0], [u1, v0], Y(P.frontTop - 0.7), 0.7, 0.8, 0.25, SL);
    pierced(main, [u0 + 1.6, v0], [u1 - 1.6, v0], Y(P.frontTop), P.frontPar - P.frontTop, SL);
    // corner turrets: square clasping base, octagonal open lantern, crocketed spirelet
    for (const s of [-1, 1]) {
      const tu = s < 0 ? u0 + 0.9 : u1 - 0.9, tv = v0 + 0.5;
      boxY(main, SL, frame, tu, tv, 3.4, 3.4, bottom, Y(P.frontTop + 1.2), { vRef: G });
      strip(main, [tu - 1.9, tv - 1.8], [tu + 1.9, tv - 1.8], Y(P.frontTop + 1.2), 0.45, 0.4, 0, SL);
      placeGeo(main, SL, frame, prismGeo(1.45, 0, 4.4, 8), tu, Y(P.frontTop + 1.2), tv, 0, { vRef: G });
      placeGeo(main, 'dark', frame, prismGeo(1.47, 0, 2.6, 8, false), tu, Y(P.frontTop + 2.2), tv, 0);
      // lantern mullions: eight thin posts in front of the dark core
      for (let k = 0; k < 8; k++) {
        const a = (k + 0.5) * Math.PI / 4;
        boxY(D, SL, frame, tu + Math.cos(a) * 1.52, tv + Math.sin(a) * 1.52, 0.22, 0.22, Y(P.frontTop + 2.1), Y(P.frontTop + 4.9), { vRef: G });
      }
      placeGeo(main, SL, frame, prismGeo(1.62, 0, 0.5, 8), tu, Y(P.frontTop + 5.6), tv, 0, { vRef: G });
      placeGeo(main, SL, frame, pyramidGeo(1.35, 8.4, 8), tu, Y(P.frontTop + 6.1), tv, 0, { vRef: G });
      placeGeo(D, SL, frame, prismGeo(0.8, 0, 0.3, 8), tu, Y(P.frontTop + 9.2), tv, 0, { vRef: G });
      // small corner pinnacles around the lantern base
      for (const [du, dv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pinnacle(D, SL, frame, tu + du * 1.45, Y(P.frontTop + 1.65), tv + dv * 1.45, 0.4, 0.9, 1.7);
      // buttress set-offs down the turret face
      for (const hh of [9, 19]) box(D, SL, frame, tu, Y(hh), tv - 1.85, 3.5, 0.35, 0.5, { vRef: G });
    }
  }

  mark('front');
  // ================================================================ crossing tower
  const TC = [AX, (TW.v0 + TW.v1) / 2], TH = TW.half;
  {
    const [cu, cv] = TC;
    const sq = (h) => rect(cu - h, cu + h, cv - h, cv + h);
    const faces = (h) => { const r = sq(h); return [0, 1, 2, 3].map((i) => [r[i], r[(i + 1) % 4]]); };
    // shaft from inside the crossing up to the belfry cornice
    ringWalls(main, SL, frame, sq(TH), Y(P.ridge - 3), Y(56.5), { vRef: G });
    // stage 1: a row of small lancets just above the roofs; stage 2: the tall twin belfry openings
    for (const [a, b] of faces(TH)) {
      for (const t of [0.3, 0.43, 0.57, 0.7]) windowAt(a, b, t, Y(31.0), 0.95, 1.9, 1, 'lancet1', { frameT: 0.16 });
      for (const t of [0.33, 0.67]) {
        windowAt(a, b, t, Y(37.8), 2.9, 13.3, 0.9, 'belfry', { frameT: 0.34 });
        archFrame(main, SL, frame, { u: a[0] + (b[0] - a[0]) * t, v: a[1] + (b[1] - a[1]) * t, n: edgeNormal(a, b), y0: Y(37.2), w: 3.5, hs: 13.9, k: 0.88, t: 0.3, d: 0.45, vRef: G });
      }
      const n = edgeNormal(a, b);
      // string courses; ogee hood between the openings suggested by a slim central shaft
      strip(main, a, b, Y(34.8), 0.55, 0.6, 0.25, SL);
      strip(main, a, b, Y(56.0), 0.8, 0.9, 0.35, SL);
      const mu = (a[0] + b[0]) / 2, mv = (a[1] + b[1]) / 2;
      boxY(D, SL, frame, mu + n[0] * 0.2, mv + n[1] * 0.2, 0.45, 0.45, Y(36), Y(56), { vRef: G, rotY: Math.atan2(n[0], n[1]) });
      // pierced gallery
      pierced(main, [a[0] + n[0] * 0.3, a[1] + n[1] * 0.3], [b[0] + n[0] * 0.3, b[1] + n[1] * 0.3], Y(56.8), 1.9, SL);
      // mid-face pinnacles on the gallery
      for (const t of [0.33, 0.67]) pinnacle(main, SL, frame, a[0] + (b[0] - a[0]) * t + n[0] * 0.3, Y(58.6), a[1] + (b[1] - a[1]) * t + n[1] * 0.3, 0.7, 2.2, 4.4);
    }
    // clasping corner buttresses in three set-offs, each corner ending in a cluster of pinnacles
    for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const pu = cu + du * TH, pv = cv + dv * TH;
      const tiers = [[Y(P.ridge - 3), Y(40), 2.6], [Y(40), Y(50), 2.3], [Y(50), Y(58.4), 2.0]];
      for (const [y0, y1, sz] of tiers) {
        boxY(main, SL, frame, pu + du * (sz / 2 - 0.9), pv + dv * (sz / 2 - 0.9), sz, sz, y0, y1, { vRef: G });
        box(D, SL, frame, pu + du * (sz / 2 - 0.9), y1 + 0.1, pv + dv * (sz / 2 - 0.9), sz + 0.2, 0.2, sz + 0.2, { vRef: G });
      }
      // set-off pinnacles at 40 and 50 m
      for (const [yy, off] of [[40, 1.55], [50, 1.4]]) {
        pinnacle(D, SL, frame, pu + du * off, Y(yy), pv - dv * 0.4, 0.55, 1.0, 2.6);
        pinnacle(D, SL, frame, pu - du * 0.4, Y(yy), pv + dv * off, 0.55, 1.0, 2.6);
      }
      // the crown: one big pinnacle on the corner, two smaller ones beside it (a stepped cluster, as photographed)
      const cu2 = pu + du * 0.1, cv2 = pv + dv * 0.1;
      pinnacle(main, SL, frame, cu2, Y(58.4), cv2, 1.6, 4.6, 7.2);
      pinnacle(main, SL, frame, cu2 - du * 1.75, Y(58.4), cv2 + dv * 0.15, 0.85, 2.8, 4.6);
      pinnacle(main, SL, frame, cu2 + du * 0.15, Y(58.4), cv2 - dv * 1.75, 0.85, 2.8, 4.6);
    }
    // stage 3: set-back square with openings, a parapet and a second ring of pinnacles
    const T3 = 5.0, top3 = 65.5;
    ringWalls(main, SL, frame, sq(T3), Y(56.8), Y(top3), { vRef: G });
    cap(main, 'leadRoof', frame, sq(TH + 0.2), Y(56.85));
    for (const [a, b] of faces(T3)) {
      for (const t of [0.3, 0.5, 0.7]) windowAt(a, b, t, Y(59.2), 1.2, 3.8, 1, 'belfry', { frameT: 0.2 });
      strip(main, a, b, Y(top3 - 0.3), 0.6, 0.7, 0.3, SL);
      const n = edgeNormal(a, b);
      pierced(D, [a[0] + n[0] * 0.25, a[1] + n[1] * 0.25], [b[0] + n[0] * 0.25, b[1] + n[1] * 0.25], Y(top3 + 0.3), 1.1, SL);
      pinnacle(main, SL, frame, (a[0] + b[0]) / 2 + n[0] * 0.3, Y(top3 + 0.3), (a[1] + b[1]) / 2 + n[1] * 0.3, 0.6, 1.8, 3.4);
    }
    for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pinnacle(main, SL, frame, cu + du * T3, Y(top3), cv + dv * T3, 1.1, 3.5, 5.6);
      // flying buttress from the crown pinnacle to the set-back stage
      const fl = new THREE.BoxGeometry(2.6, 0.5, 0.5);
      fl.rotateZ(0.55); fl.rotateY(-Math.atan2(dv, du));
      placeGeo(D, SL, frame, fl, cu + du * (T3 + 0.9), Y(62.8), cv + dv * (T3 + 0.9), 0, { vRef: G });
    }
    // stage 4: octagonal lantern with lancets, flying pinnacles on the diagonals and a pinnacle on every angle
    const LA = 2.9, top4 = 74.5;
    cap(main, 'leadRoof', frame, sq(T3 + 0.2), Y(top3 + 0.05));
    placeGeo(main, SL, frame, prismGeo(LA, 0, top4 - top3, 8), cu, Y(top3), cv, 0, { vRef: G });
    const ra = LA / Math.cos(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const a0 = (k - 0.5) * Math.PI / 4, a1 = (k + 0.5) * Math.PI / 4;
      const pa = [cu + Math.cos(a0) * ra, cv + Math.sin(a0) * ra], pb = [cu + Math.cos(a1) * ra, cv + Math.sin(a1) * ra];
      // rings built CCW in (u, v): a0 -> a1 walks counter-clockwise, so edge (pa, pb) has its outward normal on the right
      windowAt(pa, pb, 0.5, Y(top3 + 1.6), 1.05, 4.4, 1, 'belfry', { frameT: 0.16 });
      pinnacle(main, SL, frame, cu + Math.cos(a1) * (ra + 0.1), Y(top4 + 0.7), cv + Math.sin(a1) * (ra + 0.1), 0.42, 1.0, 2.6);
      if (k % 2 === 1) {
        const am = k * Math.PI / 4;
        pinnacle(main, SL, frame, cu + Math.cos(am) * (LA + 1.25), Y(top3 + 0.2), cv + Math.sin(am) * (LA + 1.25), 0.7, 4.2, 4.6);
      }
    }
    placeGeo(main, SL, frame, prismGeo(LA + 0.3, 0, 0.7, 8), cu, Y(top4), cv, 0, { vRef: G });
    // slender octagonal spire with two bands, verdigris crown and finial, iron cross
    placeGeo(main, SL, frame, frustumGeo(1.75, 0.42, 0, 11, 8), cu, Y(top4 + 0.7), cv, 0, { vRef: G });
    placeGeo(main, SL, frame, prismGeo(1.42, 0, 0.35, 8), cu, Y(top4 + 3.6), cv, 0, { vRef: G });
    placeGeo(main, SL, frame, prismGeo(0.98, 0, 0.3, 8), cu, Y(top4 + 7.4), cv, 0, { vRef: G });
    placeGeo(main, 'copper', frame, frustumGeo(0.62, 0.95, 0, 0.8, 8), cu, Y(top4 + 11.2), cv);
    placeGeo(main, 'copper', frame, pyramidGeo(0.8, 2.7, 8), cu, Y(top4 + 12.0), cv);
    boxY(main, 'metal', frame, cu, cv, 0.14, 0.14, Y(top4 + 14.6), Y(91.6));
    box(main, 'metal', frame, cu, Y(91.0), cv, 0.95, 0.12, 0.12, { rotY: 0 });
  }

  mark('tower');
  // ================================================================ transepts
  {
    const v0 = TW.v0, v1 = TW.v1;
    for (const s of [-1, 1]) {
      const uo = s < 0 ? P.transept.u0 : P.transept.u1, ui = s < 0 ? cl0 : cl1;
      const ua = Math.min(uo, ui), ub = Math.max(uo, ui);
      blockWalls(ua, ub, v0, v1, bottom, Y(P.clerEave), ['-v', '+v', s < 0 ? '-u' : '+u']);
      gableRoof(main, 'leadRoof', frame, ua, ub, v0 - 0.2, v1 + 0.2, Y(P.clerEave), Y(P.ridge), { alongU: true, overhang: 0.1, ends: [false, false] });
      // end wall: the great window, parapet with a low gable, corner turrets
      const ea = s < 0 ? [uo, v1] : [uo, v0], eb = s < 0 ? [uo, v0] : [uo, v1];
      windowAt(ea, eb, 0.5, Y(9.5), 7.6, 8.2, 0.85, 'great', { frameT: 0.6 });
      atlasDisc(main, 'win', frame, cells.rose, { u: uo + s * 0.03, v: (v0 + v1) / 2, n: [s, 0], y: Y(23.4), r: 1.25 });
      gableTri(main, SL, frame, ea, eb, Y(P.clerEave), Y(P.clerEave + 2.4), { vRef: G });
      strip(main, ea, eb, Y(P.clerEave - 0.6), 0.6, 0.7, 0.2, SL);
      strip(main, ea, eb, Y(8.4), 0.45, 0.5, 0.2);
      for (const tv of [v0, v1]) {
        boxY(main, S, frame, uo + s * 0.5, tv, 2.6, 2.6, bottom, Y(P.clerEave + 2.2), { vRef: G });
        placeGeo(main, S, frame, prismGeo(1.05, 0, 2.6, 8), uo + s * 0.5, Y(P.clerEave + 2.2), tv, 0, { vRef: G });
        placeGeo(main, S, frame, pyramidGeo(1.0, 5.6, 8), uo + s * 0.5, Y(P.clerEave + 4.8), tv, 0, { vRef: G });
      }
      // side windows and buttresses (the west arm faces Whitfield Street, the east arm the cloister garth)
      for (const [fv, n] of [[v0, [0, -1]], [v1, [0, 1]]]) {
        const a = n[1] < 0 ? [ua, fv] : [ub, fv], b = n[1] < 0 ? [ub, fv] : [ua, fv];
        windowAt(a, b, 0.5, Y(13.5), 3.6, 7.0, 1, 'lancet2');
        buttress(main, (ua + ub) / 2 + s * 3.2, fv, n, 18, { w: 1.1, d: 1.5, steps: 3, pin: 4 });
        pierced(D, a, b, Y(P.clerEave), 1.3);
        strip(main, a, b, Y(P.clerEave - 0.6), 0.6, 0.7, 0.2);
      }
    }
  }

  mark('transepts');
  // ================================================================ chancel with polygonal apse, ambulatory
  {
    const v0 = TW.v1, v1 = P.chancel.v1, h = NV.half;
    blockWalls(cl0, cl1, v0, v1, Y(12), Y(P.clerEave), ['-u', '+u']);
    const apse = [[AX + h, v1], [AX + h, v1 + 2.57], [AX + 2.57, v1 + 6.19], [AX - 2.57, v1 + 6.19], [AX - h, v1 + 2.57], [AX - h, v1]];
    for (let i = 0; i < apse.length - 1; i++) {
      const a = apse[i], b = apse[i + 1];
      wall(a, b, bottom, Y(P.clerEave));
      if (i >= 1 && i <= 3) windowAt(a, b, 0.5, Y(13.6), i === 2 ? 3.2 : 2.6, 7.4, 1, 'lancet2');
      strip(main, a, b, Y(P.clerEave - 0.6), 0.6, 0.7, 0.2);
      pierced(D, a, b, Y(P.clerEave), 1.3);
      // apse buttresses at the polygon corners
      if (i >= 1) {
        const n = edgeNormal(apse[i - 1], b), m = edgeNormal(a, b);
        const nn = [(n[0] + m[0]) / 2, (n[1] + m[1]) / 2], l = Math.hypot(nn[0], nn[1]);
        buttress(main, a[0], a[1], [nn[0] / l, nn[1] / l], 22, { w: 1.1, d: 1.7, steps: 3, pin: 5 });
      }
    }
    // chancel roof: gabled to the apse, then a half-pyramid over the apse
    gableRoof(main, 'leadRoof', frame, cl0 - 0.2, cl1 + 0.2, v0, v1, Y(P.clerEave), Y(P.ridge), { alongU: false, overhang: 0.1, ends: [false, false] });
    {
      const pos = [], top = [AX, Y(P.ridge), v1];
      for (let i = 0; i < apse.length - 1; i++) {
        const a = apse[i], b = apse[i + 1];
        pos.push(a[0], Y(P.clerEave), a[1], ...top, b[0], Y(P.clerEave), b[1]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      // orient each triangle upwards
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i += 3) {
        const ax = p.getX(i), az = p.getZ(i), bx = p.getX(i + 1), bz = p.getZ(i + 1), cx = p.getX(i + 2), cz = p.getZ(i + 2);
        if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0) { p.setXYZ(i + 1, cx, p.getY(i + 2), cz); p.setXYZ(i + 2, bx, Y(P.ridge), bz); }
      }
      g.computeVertexNormals();
      placeGeo(main, 'leadRoof', frame, g, 0, 0, 0);
    }
    // ambulatory / choir aisles: lower walls around the chancel with lean-to roofs
    for (const s of [-1, 1]) {
      const uo = s < 0 ? AX - 9.9 : AX + 9.6, ui = s < 0 ? cl0 : cl1;
      const ua = Math.min(uo, ui), ub = Math.max(uo, ui);
      blockWalls(ua, ub, v0, v1 + 1.2, bottom, Y(12), ['+v', s < 0 ? '-u' : '+u']);
      cap(main, 'leadRoof', frame, rect(ua, ub, v0, v1 + 1.2), Y(12.05));
      for (const t of [0.3, 0.72]) {
        const a = s < 0 ? [uo, v1 + 1.2] : [uo, v0], b = s < 0 ? [uo, v0] : [uo, v1 + 1.2];
        windowAt(a, b, t, Y(3.4), 2.0, 4.6, 1, 'lancet2');
      }
      pierced(D, s < 0 ? [uo, v1 + 1.2] : [uo, v0], s < 0 ? [uo, v0] : [uo, v1 + 1.2], Y(12), 1.1);
      for (const bv of [v0 + 5.2, v0 + 10.4]) buttress(main, uo, bv, [s, 0], 11, { w: 1.0, d: 1.5, steps: 2, pin: 3 });
      strip(main, s < 0 ? [uo, v1 + 1.2] : [uo, v0], s < 0 ? [uo, v0] : [uo, v1 + 1.2], bottom, G + 1.0 - bottom, 0.4, 0.15);
    }
  }

  mark('chancel');
  // ================================================================ west annex and the round south-west building
  {
    blockWalls(-37.1, cl0 - 3.7, TW.v1, 21.2, bottom, Y(12.5), ['-u', '+v']);
    hipRoof(main, 'slate', frame, -37.1, cl0 - 3.7, TW.v1, 21.2, Y(12.5), Y(16.5), 0.4);
    for (const t of [0.25, 0.5, 0.75]) windowAt([-37.1, 21.2], [-37.1, TW.v1], t, Y(5.0), 1.8, 3.4, 1, 'lancet2');
    // round-ended hall at the Whitfield / Baum corner, low walls and a conical clay-tile roof
    const c = [-37.7, 35.4], R = 5.4;
    blockWalls(-43.1, -32.3, 21.2, c[1], bottom, Y(6.5), ['-u', '+u']);
    wall([-43.1, 21.2], [-37.1, 21.2], bottom, Y(6.5));
    placeGeo(main, 'stone', frame, (() => { const g = new THREE.CylinderGeometry(R, R, Y(6.5) - bottom, 20, 1, true, Math.PI / 2, Math.PI); g.translate(0, (Y(6.5) + bottom) / 2, 0); return g; })(), c[0], 0, c[1], Math.PI, { vRef: G });
    gableRoof(main, 'clayTile', frame, -43.1, -32.3, 21.2, c[1], Y(6.5), Y(11), { alongU: false, overhang: 0.4, ends: [true, false], wallKey: S, vRef: G });
    placeGeo(main, 'clayTile', frame, (() => { const g = new THREE.ConeGeometry(R + 0.45, 4.5, 20, 1, true, Math.PI / 2, Math.PI); g.translate(0, 2.25, 0); return g; })(), c[0], Y(6.5), c[1], Math.PI);
    for (const a of [-50, 0, 50]) {
      const ar = (a + 90) * DEG, n = [Math.cos(ar), Math.sin(ar)];
      atlasPanel(main, 'win', frame, cells.lancet1, { u: c[0] + n[0] * R, v: c[1] + n[1] * R, n, y0: Y(1.8), w: 1.0, hs: 2.8, k: 1, out: 0.05 });
    }
  }

  mark('annex');
  // ================================================================ chapel on Penn Avenue (east of the front)
  {
    const u0 = ai1, u1 = 21.0, v0 = -35.6, v1 = -22.4, eave = 12, ridge = 20.5;
    blockWalls(u0, u1, v0, v1, bottom, Y(eave), ['-v', '+v', '+u']);
    gableRoof(main, 'slate', frame, u0 - 0.2, u1 + 0.3, v0, v1, Y(eave), Y(ridge), { alongU: true, overhang: 0.45, ends: [false, true], wallKey: S, vRef: G });
    const bays = 5, bw = (u1 - u0 - 1) / bays;
    for (let i = 0; i < bays; i++) {
      const um = u0 + 0.5 + (i + 0.5) * bw;
      windowAt([u0, v0], [u1, v0], (um - u0) / (u1 - u0), Y(3.4), 2.4, 5.2, 1, 'lancet2');
      windowAt([u1, v1], [u0, v1], (u1 - um) / (u1 - u0), Y(3.4), 2.4, 5.2, 1, 'lancet2');
      if (i > 0) buttress(main, u0 + 0.5 + i * bw, v0, [0, -1], eave - 1, { w: 0.9, d: 1.3, steps: 2 });
      // gablets / dormers on the Penn Avenue slope (as in the photographs of the chapel roof)
      if (i % 2 === 1) {
        const du = um, dv = v0 + 0.05;
        blockWalls(du - 1.3, du + 1.3, dv, dv + 2.4, Y(eave - 0.5), Y(eave + 2.6), ['-v', '-u', '+u']);
        gableRoof(D, 'slate', frame, du - 1.3, du + 1.3, dv, dv + 3.4, Y(eave + 2.6), Y(eave + 4.2), { alongU: false, overhang: 0.25, ends: [true, false], wallKey: S, vRef: G });
        atlasPanel(D, 'win', frame, cells.lancet2, { u: du, v: dv, n: [0, -1], y0: Y(eave + 0.2), w: 1.2, hs: 1.4, k: 1, out: 0.03 });
      }
    }
    windowAt([u1, v0], [u1, v1], 0.5, Y(4.5), 4.6, 6.4, 0.9, 'great', { frameT: 0.4 });
    strip(main, [u0, v0], [u1, v0], Y(eave - 0.45), 0.45, 0.55, 0.15);
    strip(main, [u0, v0], [u1, v0], bottom, G + 1.0 - bottom, 0.45, 0.15);
    // entrance porch at the Highland end
    const pu0 = 14.7, pu1 = 21.1, pv0 = -39.5;
    blockWalls(pu0, pu1, pv0, v0, bottom, Y(6.2), ['-v', '-u', '+u']);
    gableRoof(main, 'slate', frame, pu0, pu1, pv0, v0 + 1, Y(6.2), Y(9.0), { alongU: false, overhang: 0.3, ends: [true, false], wallKey: S, vRef: G });
    atlasPanel(main, 'win', frame, cells.door, { u: (pu0 + pu1) / 2, v: pv0, n: [0, -1], y0: Y(0), w: 2.6, hs: 3.2, k: 0.8, out: 0.04 });
    archFrame(D, S, frame, { u: (pu0 + pu1) / 2, v: pv0, n: [0, -1], y0: Y(0), w: 2.6, hs: 3.2, k: 0.8, t: 0.4, d: 0.3, vRef: G });
  }

  mark('chapel');
  // ================================================================ church house (Tudor Gothic) around two courts
  const wings = [
    // [u0, u1, v0, v1, eave, ridge, ridge along u?, gable ends]
    [21.0, 34.0, -34.0, 15.3, 12.5, 19.0, false, [true, false]],
    [20.1, 42.4, 15.3, 28.6, 12.5, 19.0, true, [false, true]],
    [-8.0, 7.5, 15.3, 34.2, 11.0, 17.0, false, [false, true]],
    [-8.0, 21.0, 11.6, 15.3, 8.5, 12.8, true, [false, false]],
  ];
  // blocks a window row must not face into (the church itself and the other wings)
  const solids = [
    rect(ai0, ai1, NV.v0, TW.v0), rect(P.transept.u0, P.transept.u1, TW.v0, TW.v1), rect(AX - 9.9, AX + 9.6, TW.v1, 32.5),
    rect(-37.1, -27.5, TW.v1, 21.2), rect(ai1, 21.0, -35.6, -22.4), ...wings.map(([u0, u1, v0, v1]) => rect(u0, u1, v0, v1)),
  ];
  const inside = (u, v) => solids.some((r) => u > r[0][0] && u < r[2][0] && v > r[0][1] && v < r[2][1]);
  const cross = [[34.0, -26, 7.5], [34.0, -12, 6.5], [34.0, 4, 7.5]];     // Highland cross-gables (u, v, width)
  for (const [u0, u1, v0, v1, eave, ridge, alongU, ends] of wings) {
    const r = rect(u0, u1, v0, v1);
    ringWalls(main, S, frame, r, bottom, Y(eave), { vRef: G });
    gableRoof(main, 'clayTile', frame, u0, u1, v0, v1, Y(eave), Y(ridge), { alongU, overhang: 0.4, ends, wallKey: S, vRef: G });
    // mullioned windows, one row per storey, on every face that looks outside
    const floors = eave > 10 ? [1.4, 5.3, 9.0] : [1.4, 5.0];
    for (let i = 0; i < 4; i++) {
      const a = r[i], b = r[(i + 1) % 4], n = edgeNormal(a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const cnt = Math.floor((L - 1.6) / 3.6);
      strip(main, a, b, Y(eave - 0.35), 0.35, 0.45, 0.12);
      strip(main, a, b, bottom, G + 0.9 - bottom, 0.3, 0.1);
      for (let k = 0; k < cnt; k++) {
        const t = (k + 0.5) / cnt, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
        if (inside(u + n[0] * 1.2, v + n[1] * 1.2)) continue;
        if (cross.some(([cu, cv, w]) => Math.abs(u - cu) < 1.2 && Math.abs(v - cv) < w / 2 + 1.2)) continue;
        for (const fy of floors) {
          atlasPanel(main, 'win', frame, cells.tudor, { u, v, n, y0: Y(fy), w: 2.1, hs: 1.9, k: 0, out: 0.03 });
          archFrame(D, S, frame, { u, v, n, y0: Y(fy), w: 2.1, hs: 1.9, k: 0, t: 0.16, d: 0.12, vRef: G });
        }
      }
    }
    // chimneys on the ridge
    const L = alongU ? u1 - u0 : v1 - v0;
    for (const f of L > 20 ? [0.22, 0.78] : [0.5]) {
      const cu = alongU ? u0 + (u1 - u0) * f : (u0 + u1) / 2, cv = alongU ? (v0 + v1) / 2 : v0 + (v1 - v0) * f;
      boxY(main, S, frame, cu, cv, 1.1, 1.8, Y(ridge - 2), Y(ridge + 1.8), { vRef: G });
      box(D, S, frame, cu, Y(ridge + 1.9), cv, 1.3, 0.2, 2.0, { vRef: G });
    }
  }
  // Highland Avenue front of the church house: stone cross-gables with big mullioned windows and a slim spire
  {
    const uF = 34.0;
    for (const [, vc, wv] of cross) {
      blockWalls(uF - 1, uF + 0.9, vc - wv / 2, vc + wv / 2, bottom, Y(12.5), ['+u', '-v', '+v']);
      gableRoof(main, 'clayTile', frame, uF - 4, uF + 0.9, vc - wv / 2, vc + wv / 2, Y(12.5), Y(17.6), { alongU: true, overhang: 0.35, ends: [false, true], wallKey: S, vRef: G });
      for (const [yy, ww] of [[2.2, 3.2], [6.4, 3.2], [10.9, 2.0]]) {
        atlasPanel(main, 'win', frame, cells.tudor, { u: uF + 0.9, v: vc, n: [1, 0], y0: Y(yy), w: ww, hs: 2.1, k: 0, out: 0.03 });
        archFrame(D, S, frame, { u: uF + 0.9, v: vc, n: [1, 0], y0: Y(yy), w: ww, hs: 2.1, k: 0, t: 0.18, d: 0.14, vRef: G });
      }
    }
    // dormers between the gables
    for (const vc of [-19, -5, 11]) {
      blockWalls(uF - 1.5, uF, vc - 1.3, vc + 1.3, Y(12), Y(14.6), ['+u', '-v', '+v']);
      gableRoof(D, 'clayTile', frame, uF - 3, uF + 0.3, vc - 1.3, vc + 1.3, Y(14.6), Y(16.4), { alongU: true, overhang: 0.2, ends: [false, true], wallKey: S, vRef: G });
      atlasPanel(D, 'win', frame, cells.tudor, { u: uF, v: vc, n: [1, 0], y0: Y(12.6), w: 1.6, hs: 1.4, k: 0, out: 0.03 });
    }
    // Highland Avenue entrance (116 S. Highland): Gothic arched doorway
    atlasPanel(main, 'win', frame, cells.door, { u: 42.4, v: 22, n: [1, 0], y0: Y(0), w: 2.4, hs: 3.0, k: 0.8, out: 0.04 });
    archFrame(D, S, frame, { u: 42.4, v: 22, n: [1, 0], y0: Y(0), w: 2.4, hs: 3.0, k: 0.8, t: 0.45, d: 0.35, vRef: G });
    // steps down to the Highland Avenue sidewalk (the block falls away from Penn Avenue)
    for (let i = 0; i < 4; i++) boxY(main, 'concrete', frame, 42.9 + i * 0.36, 22, 0.9, 3.6 + i * 0.3, bottom, Y(-0.22 * (i + 1)), { vRef: G });
    // slim square tower with a spire and weathercock, between the wings on Highland Avenue
    const su = 31.5, sv = 15.3;
    boxY(main, S, frame, su, sv, 3.6, 3.6, bottom, Y(21.5), { vRef: G });
    placeGeo(main, S, frame, prismGeo(1.6, 0, 3.0, 8), su, Y(21.5), sv, 0, { vRef: G });
    placeGeo(main, 'slate', frame, pyramidGeo(1.75, 8.5, 8), su, Y(24.5), sv);
    boxY(main, 'metal', frame, su, sv, 0.1, 0.1, Y(32.9), Y(34.4));
    for (const [du, dv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pinnacle(D, S, frame, su + du * 1.65, Y(21.5), sv + dv * 1.65, 0.45, 0.8, 1.6);
  }
  mark('house');
  // ================================================================ assemble
  const group = new THREE.Group();
  group.name = 'landmark:eastLibertyPresbyterian';
  const matMap = { ...mats };
  const mainG = main.build(matMap, { noShadow: ['win'] });
  group.add(mainG);
  let detG = null;
  if (det) { detG = det.build(matMap, { noShadow: ['win', 'dark'] }); detG.name = 'elpc-detail'; group.add(detG); }
  mark('merge');
  group.userData.tris = main.tris + (det ? det.tris : 0);
  group.userData.timing = timing;
  ctx.materials.enhance?.(group);

  // colliders: the OSM outline (courts are enclosed) plus the front steps and porch
  const worldRing = ringLocal.map(([u, v]) => frame.toWorld(u, v));
  ctx.colliders.addPolygon(worldRing, bottom, Y(P.frontPar), 'eastLibertyPresbyterian');
  ctx.colliders.addPolygon(rect(AX - 2.2, AX + 2.2, NV.v0 - 0.4, NV.v0 + 0.3).map(([u, v]) => frame.toWorld(u, v)), bottom, Y(20), 'eastLibertyPresbyterian');
  const [tx, tz] = frame.toWorld(TC[0], TC[1]);
  ctx.colliders.addBox(tx, tz, TH + 1, TH + 1, -P.angle, Y(P.ridge - 3), Y(92), 'eastLibertyPresbyterian');

  const entry = {
    key: 'eastLibertyPresbyterian', kind: 'landmark', name: 'East Liberty Presbyterian Church', nameZh: '东自由长老会教堂',
    osmId: ELPC_OSM, infoKey: ELPC_OSM, position: [tx, Y(40), tz], radius: 60,
  };
  ctx.pick.add(group, entry);
  ctx.labels.add({ key: 'eastLibertyPresbyterian', text: 'East Liberty Presbyterian Church', textZh: '东自由长老会教堂', kind: 'landmark', priority: 9, position: { x: tx, y: Y(95), z: tz }, maxDistance: 5000 });
  if (detG) distanceCull(ctx, { x: tx, z: tz, detail: detG, near: 650 });
  return group;
}
