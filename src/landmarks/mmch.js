// Margaret Morrison Carnegie Hall (Henry Hornbostel, 1906–07 / 1914) — the former Margaret Morrison Carnegie
// School for Women on Margaret Morrison Street, today home of the School of Design. Its signature is the
// "rotunda": a semicircular Doric portico wrapped around an oval open-air court, with bands of darker brick
// striping the curved walls and Lucian Scaife's inscription running around the frieze. Cream brick,
// polychrome terracotta frieze, low pale grey-green standing-seam hips with green-copper eaves; a round open Doric
// porch where the street block meets the long wing; the wing steps down the slope toward the Cut and carries the
// glass-and-aluminium Intelligent Workplace on its roof.
// Refs: Commons "Margaret Morrison Carnegie Hall, CMU - IMG 0853.jpg" (SW view: roofs, porch, IW); Esri imagery.
import * as THREE from 'three';
import { footprintFrame } from '../core/placement.js';
import {
  Bag, makeFrame, orientRing, ringWalls, profileRing, hipRoof, flatPolygon, column, ringSector, wallQuad, latheGeo,
  groundAlong, orientQuadTo, DEG, settleMallEast,
} from './lib/mallEast-kit.js';
import { getKitMaterials, HB } from './lib/mallEast-materials.js';

const OSM_ID = 'w27591314';
const INSCRIPTION = 'TO MAKE AND TO INSPIRE THE HOME · TO LESSEN SUFFERING AND INCREASE HAPPINESS · TO AID MANKIND IN ITS UPWARD STRUGGLES · TO ENNOBLE AND ADORN LIFE’S WORK HOWEVER HUMBLE · THESE ARE WOMAN’S HIGH PREROGATIVES';

// Rotunda geometry in the local frame (x east, z south; derived from the OSM outline of w27591314)
const C = [2.18, 39.72];          // centre of the oval court on the street facade line
const RA = 9.3, RB = 9.6;         // colonnade semi-axes (x, z)
const AMB = 3.5;                  // ambulatory depth behind the columns
const PORCH = { x: -25.45, z: 25.12, r: 4.6, wallX: -22.35 };   // round porch (OSM bulge) and the wall line behind it

const ell = (a, b, t) => [C[0] + a * Math.cos(t), C[1] + b * Math.sin(t)];

async function buildMMCH(ctx) {
  const b = ctx.data.buildings.find((x) => x.osmId === OSM_ID || x.id === OSM_ID);
  if (!b) { console.warn('[mmch] building not in data'); return null; }
  const K = getKitMaterials(ctx);
  const fp = footprintFrame(b.footprint);
  const frame = makeFrame(fp.center, fp.angle - Math.PI / 2); // local x → east, z → south (street side)
  const low = ctx.quality?.level === 'low';

  // Street / court level
  let F = -Infinity;
  for (const [u, v] of [[0, -5], [-5, -3], [5, -3], [0, -1], [-7, 1], [7, 1], [0, 3]]) {
    const [wx, wz] = frame.toWorld(C[0] + u, C[1] + v);
    F = Math.max(F, ctx.heightAt(wx, wz));
  }
  F += 0.05;
  const EAVE = F + 13.2;
  const DAT = F - 8.4;

  // ------------------------------------------------ wall ring from OSM with the court & porch replaced
  const raw = frame.ringToLocal(b.footprint);
  const inCourt = ([x, z]) => z > C[1] - RB - 1.2 && z < C[1] + 0.6 && Math.abs(x - C[0]) < RA + 0.6 && ((x - C[0]) / (RA + 0.6)) ** 2 + ((z - C[1]) / (RB + 0.6)) ** 2 < 1.15;
  const inPorch = ([x, z]) => x < PORCH.wallX - 0.25 && Math.hypot(x - PORCH.x, z - PORCH.z) < PORCH.r + 1;
  let ring = [];
  let courtDone = false;
  const courtPts = [];
  const segN = 20;
  for (let k = 0; k <= segN; k++) courtPts.push(ell(RA + AMB, RB + AMB, -(k / segN) * Math.PI)); // east → north → west
  for (const p of raw) {
    if (inPorch(p)) continue;
    if (inCourt(p)) { if (!courtDone) { ring.push('COURT'); courtDone = true; } continue; }
    ring.push(p);
  }
  // splice the court arc in the direction consistent with the ring's neighbours
  const ci = ring.indexOf('COURT');
  if (ci >= 0) {
    const prev = ring[(ci - 1 + ring.length) % ring.length];
    const pts = prev[0] > C[0] ? courtPts : courtPts.slice().reverse();
    ring.splice(ci, 1, ...pts);
  }
  const hasCourt = ci >= 0;
  ring = orientRing(ring);
  const g = groundAlong(ctx, frame, ring);
  const yBase = Math.min(g.min, F) - 1.6;
  const isCourtEdge = (i) => {
    if (!hasCourt) return false;
    const a = ring[i], c = ring[(i + 1) % ring.length];
    const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    return m[1] < C[1] - 0.3 && ((m[0] - C[0]) / (RA + AMB)) ** 2 + ((m[1] - C[1]) / (RB + AMB)) ** 2 < 1.05;
  };

  // ------------------------------------------------ materials
  const mFacade = K.facade({
    key: 'mmch', bay: 3.4, bays: 4, height: EAVE - DAT, seed: 1907, lit: 0.42,
    bands: [
      { y0: 8.4, y1: 9.2, color: '#bfae8c' },
      { y0: 13.2, y1: 13.6, color: HB.terracotta },
      { y0: 20.4, y1: 21.6, color: HB.terracotta, poly: true },
    ],
    rows: [
      { sill: 1.0, w: 1.4, h: 2.0, shape: 'rect', lintel: HB.terracotta },
      { sill: 5.0, w: 1.4, h: 2.3, shape: 'rect', lintel: HB.terracotta },
      { sill: 9.8, w: 1.7, h: 3.2, shape: 'arch', surround: HB.terracotta },
      { sill: 14.2, w: 1.5, h: 2.6, shape: 'rect', lintel: HB.terracotta },
      { sill: 17.6, w: 1.4, h: 2.0, shape: 'rect', lintel: HB.terracotta },
    ],
  });
  const mRot = K.facade({
    key: 'mmch-rotunda', bay: 3.2, bays: 4, height: EAVE - DAT, seed: 1906, lit: 0.5, wall: 'stripes',
    bands: [
      { y0: 8.4, y1: 8.85, color: '#bfae8c' },
      { y0: 20.4, y1: 21.6, color: HB.terracotta, poly: true },
    ],
    rows: [
      { sill: 8.85, w: 1.9, h: 3.8, shape: 'door', every: 2 },
      { sill: 9.9, w: 1.4, h: 3.0, shape: 'arch', every: 2, offset: 1, surround: HB.terracotta },
      { sill: 17.7, w: 1.4, h: 2.2, shape: 'arch', surround: HB.terracotta },
    ],
  });
  const mTrim = K.trim(), mStripe = K.stripes();
  const mText = K.text('mmch-inscription', {
    text: INSCRIPTION, wM: Math.PI * 0.5 * (RA + RB) * 0.97, hM: 0.62, ppm: 150, bg: HB.terracotta, ink: '#57492f', fill: 0.66, condense: 0.72,
  });
  if (!mText.emissive || mText.emissive.getHex() === 0) {
    mText.emissive = new THREE.Color('#ffcf93'); mText.emissiveMap = mText.map;
    ctx.materials.registerNightMaterial(mText, 0.35);
  }

  const bag = new Bag();
  bag.setOptions(mText, { castShadow: false });

  // ------------------------------------------------ main walls
  ringWalls(bag, mFacade, ring, yBase, EAVE, { datum: DAT, bay: 3.4, skip: isCourtEdge });
  if (hasCourt) ringWalls(bag, mRot, ring, yBase, EAVE, { datum: DAT, bay: 3.2, skip: (i) => !isCourtEdge(i) });
  // mouldings: string course, cornice
  profileRing(bag, mTrim, ring, F + 4.8, [[0, 0], [0.08, 0.04], [0.14, 0.12], [0.14, 0.34], [0.06, 0.4], [0, 0.44]]);
  const cornice = [[0, 0], [0.08, 0], [0.08, 0.1], [0.2, 0.2], [0.26, 0.32], [0.75, 0.36], [0.85, 0.42], [0.85, 0.62], [0.95, 0.7], [0.95, 0.86], [0.8, 0.95], [-0.4, 0.95]];
  profileRing(bag, mTrim, ring, EAVE - 0.95, cornice);
  // granite water table at street level (the lower storeys below it stay brick with windows)
  profileRing(bag, K.granite(), ring, F - 0.35, [[0, 0], [0.12, 0], [0.12, 0.9], [0.03, 1.1], [0, 1.1]]);

  // ------------------------------------------------ roofs (hand-simplified outline)
  // Street block: low hips in pale grey-green standing seam with green-copper eaves. The long wing is flat-roofed
  // under the rooftop Intelligent Workplace.
  const mRoof = K.roof(), mEave = K.eave();
  const bow = [[28.31, 17.57], [29.69, 21.3], [30.05, 25.06], [29.65, 28.56], [28.5, 32.18]];
  const WING_S = 10.5; // where the wing roof meets the street block's hips
  const mainRing = orientRing([
    [-7.4, WING_S], [-7.4, 14.77], [11.63, 14.77], [11.53, 10.34], [26.42, 10.41], [26.53, 17.66],
    ...bow, [27.14, 39.72],
    ...courtPts,
    [-22.34, 39.53], [-22.3, WING_S],
  ]);
  hipRoof(bag, mRoof, mainRing, EAVE + 0.02, { overhang: 0.45, inset: 5.0, pitch: 24 * DEG, topMat: mRoof, fasciaMat: mEave, fascia: 0.22 });
  const wingRing = orientRing([[-0.11, -39.74], [-0.41, -15.96], [-7.01, -15.72], [-7.4, WING_S], [-22.3, WING_S], [-22.2, -32.0], [-23.82, -39.5]]);
  flatPolygon(bag, K.flatRoof(), wingRing, EAVE - 0.05, true);

  // ------------------------------------------------ Robert L. Preger Intelligent Workplace (1997): a one-storey
  // glass-and-aluminium penthouse along the wing, set back ~1 m from the cornice, under a sawtooth of shed roofs
  // with north-facing clerestories. Lit (cool white) at night.
  {
    const mGlass = K.iwGlass(), mAlu = ctx.materials.get('aluminium');
    const Y0 = EAVE - 0.05, H = 3.6, Y1 = Y0 + H, RISE = 1.1;
    const iw = orientRing([[-21.3, -38.7], [-1.4, -38.7], [-1.4, -16.9], [-8.0, -16.9], [-8.0, 9.0], [-21.3, 9.0]]);
    let u = 0;
    for (let i = 0; i < iw.length; i++) {
      const a = iw[i], c = iw[(i + 1) % iw.length];
      wallQuad(bag, mGlass, a, c, Y0, Y1, u, Y0);
      u += Math.hypot(c[0] - a[0], c[1] - a[1]);
    }
    profileRing(bag, mAlu, iw, Y1 - 0.05, [[0, 0], [0.12, 0], [0.12, 0.3], [0, 0.3]]);   // roof-edge fascia
    // sawtooth: each tooth slopes down to the south, its glazed vertical face looks north
    for (const [x0, x1, z0, z1] of [[-21.3, -1.4, -38.7, -16.9], [-21.3, -8.0, -16.9, 9.0]]) {
      const n = Math.max(1, Math.round((z1 - z0) / 4.3)), t = (z1 - z0) / n;
      for (let k = 0; k < n; k++) {
        const za = z0 + k * t, zb = za + t, yt = Y1 + RISE;
        orientQuadTo(bag, mAlu, [x0, yt, za], [x1, yt, za], [x1, Y1 + 0.25, zb], [x0, Y1 + 0.25, zb], null, null, null, null, [0, 1, 0.3]);
        orientQuadTo(bag, mGlass, [x0, Y1 + 0.25, za], [x1, Y1 + 0.25, za], [x1, yt, za], [x0, yt, za], [0, 1.6], [x1 - x0, 1.6], [x1 - x0, 1.6 + RISE], [0, 1.6 + RISE], [0, 0, -1]);
        for (const [xe, s] of [[x0, -1], [x1, 1]]) {
          const A = [xe, Y1 + 0.25, za], B = [xe, Y1 + 0.25, zb], Cc = [xe, yt, za];
          const nrm = (B[2] - A[2]) * (Cc[1] - A[1]) * -1;   // sign of the x normal for winding A,B,C
          if (Math.sign(nrm) === s) bag.tri(mAlu, A, B, Cc); else bag.tri(mAlu, A, Cc, B);
        }
      }
    }
    bag.setOptions(mGlass, { castShadow: false });
  }

  // ------------------------------------------------ round open Doric porch where the street block meets the long
  // wing (the bulge in the OSM outline): ten columns on a granite podium in front of the continuous wall, a plain
  // entablature and a flat roof ringed by a balustrade.
  {
    const P = PORCH;
    const [px, pz] = frame.toWorld(P.x, P.z);
    const ground = ctx.heightAt(px, pz);
    const yF = Math.max(ground + 0.6, F - 0.6);          // porch floor, a little below the street level
    const yBot = Math.min(ground, yF) - 1.8;
    const aW = Math.acos(Math.min(0.95, (P.wallX - P.x) / P.r));   // where the drum meets the wall line
    const a0 = aW - 0.05, a1 = 2 * Math.PI - aW + 0.05;
    const rc = P.r - 0.45, colH = 6.0, colR = 0.34;
    const circle = (r, n = 32) => { const out = []; for (let k = 0; k < n; k++) { const t = (k / n) * Math.PI * 2; out.push([P.x + r * Math.cos(t), P.z + r * Math.sin(t)]); } return orientRing(out); };
    // podium (granite drum) and paved floor
    ringSector(bag, { outer: K.granite(), top: K.granite() }, P.x, P.z, P.r - 0.05, P.r + 0.15, a0, a1, yBot, yF + 0.02, 28);
    flatPolygon(bag, K.paver(), circle(P.r - 0.05), yF, true);
    // columns
    const cA = Math.acos(Math.min(0.95, (P.wallX - 0.6 - P.x) / rc)) + 0.08, cB = 2 * Math.PI - cA;
    const n = 10;
    for (let k = 0; k < n; k++) {
      const t = cA + (k / (n - 1)) * (cB - cA);
      const x = P.x + rc * Math.cos(t), z = P.z + rc * Math.sin(t);
      column(bag, mTrim, x, z, yF, colH, colR, { order: 'doric', segs: 12 });
    }
    // entablature (architrave + frieze), cornice, ceiling, flat roof and balustrade
    const yE = yF + colH;
    ringSector(bag, { outer: mTrim, inner: mTrim, bottom: mTrim }, P.x, P.z, rc - 0.42, P.r, a0, a1, yE, yE + 1.1, 28);
    ringSector(bag, { outer: mTrim, bottom: mTrim, top: mTrim }, P.x, P.z, P.r - 0.1, P.r + 0.3, a0, a1, yE + 1.1, yE + 1.4, 28);
    flatPolygon(bag, mTrim, circle(rc - 0.4), yE + 0.01, false);
    flatPolygon(bag, K.flatRoof(), circle(P.r), yE + 1.38, true);
    const yB = yE + 1.4;
    ringSector(bag, { outer: mTrim, inner: mTrim, top: mTrim }, P.x, P.z, P.r - 0.1, P.r + 0.15, a0, a1, yB, yB + 0.16, 28);
    ringSector(bag, { outer: mTrim, inner: mTrim, top: mTrim, bottom: mTrim }, P.x, P.z, P.r - 0.08, P.r + 0.13, a0, a1, yB + 0.84, yB + 0.98, 28);
    if (!low) {
      const bal = latheGeo([[0.001, 0], [0.08, 0], [0.08, 0.06], [0.05, 0.12], [0.1, 0.3], [0.045, 0.52], [0.065, 0.6], [0.065, 0.68], [0.001, 0.68]], 8);
      const cnt = 34;
      for (let k = 0; k < cnt; k++) {
        const t = a0 + 0.06 + (k / (cnt - 1)) * (a1 - a0 - 0.12);
        bag.geo(mTrim, bal, { matrix: new THREE.Matrix4().makeTranslation(P.x + (P.r + 0.02) * Math.cos(t), yB + 0.16, P.z + (P.r + 0.02) * Math.sin(t)), uv: 'keep' });
      }
      bal.dispose();
    }
  }

  // ------------------------------------------------ the rotunda: oval court, Doric portico, inscription
  if (hasCourt) {
    const RI = RA - 0.45; // inner face of the entablature (x semi-axis); z semi-axis scales proportionally
    const eA = (a) => a, eB = (a) => a + (RB - RA);
    // elliptical annulus sector helper (inner/outer semi-axes given by x-axis values)
    const ovalBand = (mats, r0, r1, t0, t1, y0, y1, segs = 40, textUV = false) => {
      const P = (r, t, y) => { const p = ell(eA(r), eB(r), t); return [p[0], y, p[1]]; };
      for (let i = 0; i < segs; i++) {
        const a0 = t0 + (t1 - t0) * (i / segs), a1 = t0 + (t1 - t0) * ((i + 1) / segs);
        const s0 = (i / segs), s1 = ((i + 1) / segs);
        const mid = (a0 + a1) / 2, nx = Math.cos(mid) / eA(r0), nz = Math.sin(mid) / eB(r0);
        if (mats.inner) {
          const uv = textUV ? [[s0, 0], [s1, 0], [s1, 1], [s0, 1]] : [[s0 * 30, y0], [s1 * 30, y0], [s1 * 30, y1], [s0 * 30, y1]];
          orientQuadTo(bag, mats.inner, P(r0, a0, y0), P(r0, a1, y0), P(r0, a1, y1), P(r0, a0, y1), ...uv, [-nx, 0, -nz]);
        }
        if (mats.outer) orientQuadTo(bag, mats.outer, P(r1, a0, y0), P(r1, a1, y0), P(r1, a1, y1), P(r1, a0, y1), [s0 * 30, y0], [s1 * 30, y0], [s1 * 30, y1], [s0 * 30, y1], [nx, 0, nz]);
        if (mats.top) orientQuadTo(bag, mats.top, P(r0, a0, y1), P(r0, a1, y1), P(r1, a1, y1), P(r1, a0, y1), null, null, null, null, [0, 1, 0]);
        if (mats.bottom) orientQuadTo(bag, mats.bottom, P(r0, a0, y0), P(r0, a1, y0), P(r1, a1, y0), P(r1, a0, y0), null, null, null, null, [0, -1, 0]);
      }
    };
    const T0 = -Math.PI, T1 = 0; // west → north → east
    // stylobate with three steps up from the court, and the ambulatory floor
    const paver = K.paver();
    ovalBand({ inner: K.granite(), top: paver }, RA - 1.25, RA - 0.95, T0, T1, F - 0.4, F + 0.15);
    ovalBand({ inner: K.granite(), top: paver }, RA - 0.95, RA - 0.65, T0, T1, F - 0.4, F + 0.3);
    ovalBand({ inner: K.granite(), top: paver }, RA - 0.65, RA + AMB + 0.2, T0, T1, F - 0.4, F + 0.45);
    // court paving (half oval) + apron to the street
    const courtRing = [];
    for (let k = 0; k <= 32; k++) { const p = ell(RA - 1.25, RB - 1.25, T0 + (k / 32) * Math.PI); courtRing.push(p); }
    courtRing.push([C[0] + RA + 1, C[1] + 5], [C[0] - RA - 1, C[1] + 5]);
    flatPolygon(bag, paver, orientRing(courtRing), F + 0.04, true);
    // columns (Greek Doric, paired at the ends)
    const n = 11;
    const colTs = [];
    for (let k = 0; k < n; k++) colTs.push(T0 + 0.2 + (k / (n - 1)) * (Math.PI - 0.4));
    const colH = 6.0, colR = 0.36;
    for (const t of colTs) {
      const p = ell(RA, RB, t);
      column(bag, mTrim, p[0], p[1], F + 0.45, colH, colR, { order: 'doric', segs: 14 });
    }
    // entablature: architrave + inscribed frieze + cornice, then the ambulatory roof slab and a balustrade
    const yE = F + 0.45 + colH;
    ovalBand({ inner: mTrim, outer: mTrim, bottom: mTrim }, RA - 0.42, RA + 0.42, T0, T1, yE, yE + 0.5);
    ovalBand({ inner: mText, outer: mTrim }, RA - 0.36, RA + 0.36, T0, T1, yE + 0.5, yE + 1.12, 48, true);
    ovalBand({ inner: mTrim, outer: mTrim, bottom: mTrim, top: mTrim }, RA - 0.6, RA + 0.6, T0, T1, yE + 1.12, yE + 1.4);
    ovalBand({ bottom: mTrim, top: K.flatRoof() }, RA + 0.36, RA + AMB + 0.1, T0, T1, yE + 0.5, yE + 1.12);
    // balustrade on top
    const yB = yE + 1.4;
    ovalBand({ inner: mTrim, outer: mTrim, top: mTrim }, RA - 0.3, RA + 0.3, T0, T1, yB, yB + 0.16);
    ovalBand({ inner: mTrim, outer: mTrim, top: mTrim, bottom: mTrim }, RA - 0.28, RA + 0.28, T0, T1, yB + 0.86, yB + 1.0);
    if (!low) {
      const bal = latheGeo([[0.001, 0], [0.09, 0], [0.09, 0.06], [0.06, 0.12], [0.11, 0.3], [0.05, 0.52], [0.07, 0.6], [0.07, 0.7], [0.001, 0.7]], 8);
      const cnt = 90;
      for (let k = 0; k < cnt; k++) {
        const t = T0 + 0.03 + (k / (cnt - 1)) * (Math.PI - 0.06);
        const p = ell(RA, RB, t);
        bag.geo(mTrim, bal, { matrix: new THREE.Matrix4().makeTranslation(p[0], yB + 0.16, p[1]), uv: 'keep' });
      }
      bal.dispose();
      // lamps hanging in the ambulatory (glow at night)
      const lampMat = K.lamp();
      for (let k = 0; k < 7; k++) {
        const t = T0 + 0.35 + (k / 6) * (Math.PI - 0.7);
        const p = ell(RA + AMB / 2, RB + AMB / 2, t);
        const lg = new THREE.SphereGeometry(0.22, 10, 8);
        bag.geo(lampMat, lg, { matrix: new THREE.Matrix4().makeTranslation(p[0], yE - 0.6, p[1]) });
        lg.dispose();
        bag.box(mEave, p[0], yE - 0.1, p[1], 0.04, 0.8, 0.04);
      }
    }
    // end pylons (striped brick) where the portico meets the street front
    for (const sx of [-1, 1]) {
      const x0 = C[0] + sx * (RA + 0.45), x1 = C[0] + sx * (RA + AMB + 0.6);
      const cx = (x0 + x1) / 2, w = Math.abs(x1 - x0);
      bag.box(mStripe, cx, (yBase + yB + 1.2) / 2, C[1] - 1.4, w, yB + 1.2 - yBase, 3.0);
      bag.box(mTrim, cx, yB + 1.3, C[1] - 1.4, w + 0.3, 0.2, 3.3);
      bag.box(mTrim, cx, yE + 1.26, C[1] - 1.4, w + 0.25, 0.28, 3.25);
      // urn
      const urn = latheGeo([[0.001, 0], [0.3, 0], [0.3, 0.12], [0.18, 0.2], [0.42, 0.55], [0.36, 0.8], [0.2, 0.9], [0.25, 1.0], [0.001, 1.05]], 12);
      bag.geo(mTrim, urn, { matrix: new THREE.Matrix4().makeTranslation(cx, yB + 1.4, C[1] - 1.4), uv: 'keep' });
      urn.dispose();
    }
  }

  const [cx, cz] = frame.toWorld(2, 0);
  const entry = { key: 'mmch', kind: 'landmark', name: 'Margaret Morrison Carnegie Hall', nameZh: '玛格丽特·莫里森·卡内基楼', osmId: OSM_ID, infoKey: OSM_ID, position: [cx, EAVE, cz], radius: 45 };
  const group = bag.build('mmch', { share: { ctx, entry, frame, materials: K.shared } });
  frame.place(group);

  // ------------------------------------------------ colliders, walkables, pick, label
  const tag = 'mmch';
  ctx.colliders.addPolygon(frame.ringToWorld(ring), yBase, EAVE + 4, tag);
  {
    const [tx, tz] = frame.toWorld(PORCH.x, PORCH.z);
    ctx.colliders.addCircle(tx, tz, PORCH.r + 0.15, yBase, F + 9, tag);   // raised porch: podium + colonnade
  }
  if (hasCourt) {
    const n = 11;
    for (let k = 0; k < n; k++) {
      const p = ell(RA, RB, -Math.PI + 0.2 + (k / (n - 1)) * (Math.PI - 0.4));
      const [wx, wz] = frame.toWorld(p[0], p[1]);
      ctx.colliders.addCircle(wx, wz, 0.45, F, F + 7, tag);
    }
    for (const sx of [-1, 1]) {
      const x0 = C[0] + sx * (RA + 0.45), x1 = C[0] + sx * (RA + AMB + 0.6);
      ctx.colliders.addPolygon(frame.ringToWorld([[x0, C[1] - 2.9], [x1, C[1] - 2.9], [x1, C[1] + 0.1], [x0, C[1] + 0.1]]), yBase, F + 10, tag);
    }
    // walkable stylobate / ambulatory floor
    const wp = [];
    const segs = 32;
    for (let i = 0; i < segs; i++) {
      const t0 = -Math.PI + (i / segs) * Math.PI, t1 = -Math.PI + ((i + 1) / segs) * Math.PI;
      const q = [ell(RA - 0.65, RB - 0.65, t0), ell(RA - 0.65, RB - 0.65, t1), ell(RA + AMB, RB + AMB, t1), ell(RA + AMB, RB + AMB, t0)].map((p) => frame.toWorld(p[0], p[1]));
      const y = F + 0.45;
      wp.push(q[0][0], y, q[0][1], q[1][0], y, q[1][1], q[2][0], y, q[2][1], q[0][0], y, q[0][1], q[2][0], y, q[2][1], q[3][0], y, q[3][1]);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    const wm = new THREE.Mesh(wg, K.walkHidden());
    wm.name = 'mmch-walkable';
    wm.updateMatrixWorld(true);
    ctx.walkables.add(wm);
  }
  ctx.pick.add(group, entry);
  const [lx, lz] = frame.toWorld(C[0], C[1] - RB - AMB - 4);
  ctx.labels.add({ key: 'mmch', text: 'Margaret Morrison Carnegie Hall', textZh: '玛格丽特·莫里森楼', kind: 'landmark', priority: 9, position: { x: lx, y: EAVE + 6, z: lz } });
  return group;
}

export default [
  {
    key: 'mmch',
    name: 'Margaret Morrison Carnegie Hall',
    nameZh: '玛格丽特·莫里森·卡内基楼',
    osmIds: [OSM_ID],
    async build(ctx) { try { return await buildMMCH(ctx); } finally { settleMallEast(ctx, 'mmch'); } },
  },
];
