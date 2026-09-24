// Wean Hall (Deeter Ritchey Sippel, 1968–71) and Newell-Simon Hall (Bureau of Mines buildings C and D, rebuilt
// 1998–2000), with the enclosed skybridge that links them over Hamerschlag Drive.
//
// Wean (references: Commons "Wean hall.jpg" and "Carnegie-Mellon-University-32", Ralf Brown 2009, the 2015 view
// from the Cathedral of Learning, Esri imagery):
//  · a long bar of warm, sand-blasted precast concrete dug into the slope: floor 5 opens onto the Mall, floors 1–4
//    face the old ravine side (Hamerschlag Drive / Newell-Simon) to the north, so the building shows three storeys
//    to the Mall and about eight to the north;
//  · every floor is a band of rough concrete with a row of deep-set windows alternating with smooth light panels,
//    between piers on a 5 m structural bay;
//  · above floor 7 both long sides step back in a stepped (bleacher-like) slope, split into bays by raking concrete
//    fins, up to a tall blank parapet — the painted "SORRY WORLD" on the Mall side has been there for decades;
//  · the "snout": a windowless concrete block cantilevered over the Mall entrance at the west end of the Mall front,
//    its east side raking down to the facade; an exterior stair drops beside it towards Hamerschlag Hall;
//  · lower wings step down to the west, a service tower and planted terraces on the north side, a mechanical
//    penthouse at the Doherty end.
// Newell-Simon (Jendoco project photos, 2015 view, Esri imagery): cream brick over a grey stone base, green
// standing-seam hipped roofs around a flat mechanical core with a barrel-vaulted atrium skylight, dark green window
// frames; a white Warren-truss glass bridge on one pier crosses to Wean's floor 3.
import * as THREE from 'three';
import { footprintFrame } from '../core/placement.js';
import { Bag, makeFrame, orientRing, flatPolygon, wallQuad, orientQuadTo, hipRoof, prng } from './lib/mallEast-kit.js';
import { painters } from './lib/mallEast-materials.js';

const WEAN_ID = 'w27551364';
const NSH_ID = 'w27551590';
const LINK_ID = 'w320582065';
const { canvas, tex, noise, paintBrick } = painters;

// Wean levels: floor n at L1 + (n-1)·4 m; floor 5 = the Mall (~46 m)
const L1 = 30.0, FL = 4.0;
const lv = (n) => L1 + (n - 1) * FL;
const Y_FAC = 58.8;          // head of the vertical walls (floor 7 + band)
const Y_SL = 61.8;           // top of the stepped slopes
const Y_ROOF = 63.2, Y_PAR = 64.0;
const V_S = 13.2, V_SC = 7.6;     // south wall line / core south line (local v, +v = towards the Mall)
const V_N = -15.5, V_NC = -9.9;   // north wall line / core north line
const U_W = -14.5, U_E = 57.2;    // west / east ends of the main block (local u, +u = east)
const Y_WW = 50.0;           // west wing roof
const Y_SN0 = 49.6;          // snout soffit
const BRIDGE_DECK = 38.0;    // skybridge floor (Wean floor 3)

const CACHE = new WeakMap();
function sharedMaterials(ctx) {
  const M = ctx.materials;
  if (CACHE.has(M)) return CACHE.get(M);
  const low = ctx.quality?.level === 'low';
  const aniso = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
  const std = (o, name) => { const m = new THREE.MeshStandardMaterial(o); m.name = name; return m; };
  const r = prng(1971);
  const CONC = '#ab9b7c', CONC_L = '#bfb092';

  // ---------------------------------------------------------------- Wean board-formed concrete (6 m tile)
  const concTex = (() => {
    const S = low ? 128 : 256, ppm = S / 6;
    const c = canvas(S, S), g = c.getContext('2d');
    g.fillStyle = CONC; g.fillRect(0, 0, S, S);
    noise(g, S, S, r, 0.06, 2);
    for (let y = 0; y < S; y += 0.3 * ppm) { g.fillStyle = `rgba(90,80,60,${0.05 + r() * 0.05})`; g.fillRect(0, y, S, 1); }
    for (let i = 0; i < 26; i++) { const x = r() * S, w = 1 + r() * 4; g.fillStyle = `rgba(70,62,48,${0.04 + r() * 0.06})`; g.fillRect(x, 0, w, S * (0.3 + r() * 0.7)); }
    g.fillStyle = 'rgba(60,54,44,0.35)'; g.fillRect(0, 0, S, 1); g.fillRect(0, 0, 1, S);   // panel joints every 6 m
    return tex(c, { repeat: [1 / 6, 1 / 6], aniso });
  })();
  const concrete = std({ map: concTex, roughness: 0.93 }, 'wean-concrete');

  // ---------------------------------------------------------------- Wean facade: 4 × 5 m bays × 3 floors (tiles)
  // u = metres along the wall, v = metres above floor 1 (L1) so window rows line up on every block.
  const TW = 20, TH = 12, fppm = low ? 12 : 24;
  const Wp = TW * fppm, Hp = TH * fppm;
  const cm = canvas(Wp, Hp), gm = cm.getContext('2d');
  const ce = canvas(Wp, Hp), ge = ce.getContext('2d');
  const Y = (v) => Hp - v * fppm, P = (m) => Math.max(1, Math.round(m * fppm));
  gm.fillStyle = CONC; gm.fillRect(0, 0, Wp, Hp);
  noise(gm, Wp, Hp, r, 0.05, 2);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, Wp, Hp);
  for (let f = 0; f < 3; f++) {
    const fb = f * FL;
    // board lines and a weathering shadow under each window row
    for (let y = fb; y < fb + FL; y += 0.3) { gm.fillStyle = 'rgba(80,70,52,0.07)'; gm.fillRect(0, Y(y), Wp, 1); }
    gm.fillStyle = 'rgba(60,52,40,0.18)'; gm.fillRect(0, Y(fb + 1.0), Wp, P(0.12));
    gm.fillStyle = 'rgba(255,250,235,0.15)'; gm.fillRect(0, Y(fb + 2.8) - P(0.06), Wp, P(0.06));
    for (let bay = 0; bay < 4; bay++) {
      const x0 = bay * 5;
      // structural pier at the bay edge (lighter, proud)
      gm.fillStyle = CONC_L; gm.fillRect(x0 * fppm, Y(fb + 2.8), P(0.34), P(1.8));
      gm.fillStyle = 'rgba(0,0,0,0.12)'; gm.fillRect(x0 * fppm + P(0.34), Y(fb + 2.8), P(0.06), P(1.8));
      const cells = [[0.46, 1.1, 'w'], [1.68, 1.08, 'p'], [2.88, 1.1, 'w'], [4.1, 0.8, 'p']];
      for (const [cx0, cw, kind] of cells) {
        const x = (x0 + cx0) * fppm, w = cw * fppm, top = Y(fb + 2.75), h = 1.7 * fppm;
        if (kind === 'w') {
          const grd = gm.createLinearGradient(x, top, x + w, top + h);
          grd.addColorStop(0, '#59646a'); grd.addColorStop(0.5, '#2c3337'); grd.addColorStop(1, '#1d2226');
          gm.fillStyle = grd; gm.fillRect(x, top, w, h);
          gm.fillStyle = '#4a3f33'; gm.fillRect(x, top, w, P(0.06)); gm.fillRect(x, top + h - P(0.06), w, P(0.06)); gm.fillRect(x + w / 2 - 1, top, 2, h);
          if (r() < 0.4) { gm.fillStyle = `rgba(215,205,185,${0.3 + r() * 0.3})`; gm.fillRect(x + 2, top + 2, w - 4, h * (0.2 + r() * 0.5)); }
          // deep reveal: shadow along the top and one side
          gm.fillStyle = 'rgba(0,0,0,0.35)'; gm.fillRect(x, top, w, P(0.18)); gm.fillRect(x, top, P(0.12), h);
          if (r() < 0.42) {
            const warm = 180 + ((r() * 50) | 0);
            ge.fillStyle = `rgba(255,${warm + 20},${warm - 50},${0.65 + r() * 0.35})`; ge.fillRect(x + 2, top + P(0.18), w - 4, h - P(0.2));
          }
        } else {
          gm.fillStyle = CONC_L; gm.fillRect(x, top, w, h);
          gm.fillStyle = 'rgba(0,0,0,0.2)'; gm.fillRect(x, top, w, P(0.1)); gm.fillRect(x, top, P(0.08), h);
        }
      }
    }
  }
  const frep = [1 / TW, 1 / TH];
  const facade = std({ map: tex(cm, { repeat: frep, aniso }), emissiveMap: tex(ce, { repeat: frep, aniso }), emissive: new THREE.Color('#ffd49a'), roughness: 0.9 }, 'wean-facade');
  M.registerNightMaterial(facade, 1.3);

  // ---------------------------------------------------------------- "SORRY WORLD" (painted on the Mall parapet)
  const cs = canvas(512, 64), gs = cs.getContext('2d');
  gs.clearRect(0, 0, 512, 64);
  gs.font = 'bold 50px "Arial Black", Arial, sans-serif'; gs.textAlign = 'center'; gs.textBaseline = 'middle';
  gs.fillStyle = 'rgba(245,242,232,0.92)'; gs.fillText('SORRY WORLD', 256, 34);
  const sorry = std({ map: tex(cs, { wrapT: false, aniso }), transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, 'wean-sorry');

  // ---------------------------------------------------------------- Newell-Simon: cream brick, grey stone base,
  // dark green frames. u = metres along the wall (4 bays of 3.4 m), v = metres above the south yard (22.6).
  const NB = 3.4, NBAYS = 4, NTH = 20.4, nppm = low ? 12 : 22;
  const nW = Math.round(NB * NBAYS * nppm), nH = Math.round(NTH * nppm);
  const cn = canvas(nW, nH), gn = cn.getContext('2d');
  const cne = canvas(nW, nH), gne = cne.getContext('2d');
  const NY = (v) => nH - v * nppm, NP = (m) => Math.max(1, Math.round(m * nppm));
  paintBrick(gn, 0, 0, nW, nH, '#d8c59c', nppm, r, { courseH: 0.075, brickW: 0.225 });
  noise(gn, nW, nH, r, 0.03, 1);
  gne.fillStyle = '#000'; gne.fillRect(0, 0, nW, nH);
  // rusticated grey stone base (two storeys on the yard side) and string courses
  gn.fillStyle = '#9d9a92'; gn.fillRect(0, NY(8.0), nW, NP(8.0));
  for (let v = 0; v < 8; v += 0.6) { gn.fillStyle = 'rgba(40,38,34,0.45)'; gn.fillRect(0, NY(v), nW, 1); const off = ((v / 0.6) % 2) * 0.6; for (let x = off; x < NB * NBAYS; x += 1.2) gn.fillRect(x * nppm, NY(v + 0.6), 1, NP(0.6)); }
  gn.save(); gn.translate(0, NY(8.0)); noise(gn, nW, NP(8), r, 0.05, 2); gn.restore();
  for (const [v, h] of [[8.0, 0.45], [15.7, 0.3], [19.4, 1.0]]) { gn.fillStyle = '#e2d8bf'; gn.fillRect(0, NY(v + h), nW, NP(h)); gn.fillStyle = 'rgba(0,0,0,0.2)'; gn.fillRect(0, NY(v), nW, 1); }
  for (let fl = 0; fl < 5; fl++) {
    const fb = fl * 4.0;
    for (let bay = 0; bay < NBAYS; bay++) {
      const cx = (bay + 0.5) * NB * nppm;
      const w = (fl < 1 ? 1.5 : 1.7) * nppm, h = (fl === 4 ? 1.9 : 2.3) * nppm;
      const x = cx - w / 2, top = NY(fb + 0.95) - h;
      gn.fillStyle = fl < 2 ? '#8b8983' : '#e2d8bf';
      gn.fillRect(x - NP(0.12), NY(fb + 0.95), w + NP(0.24), NP(0.14));        // sill
      if (fl >= 2) gn.fillRect(x - NP(0.1), top - NP(0.25), w + NP(0.2), NP(0.25));   // lintel
      const grd = gn.createLinearGradient(x, top, x + w * 0.5, top + h);
      grd.addColorStop(0, '#8ea3ad'); grd.addColorStop(0.5, '#4a5c64'); grd.addColorStop(1, '#2c373c');
      gn.fillStyle = grd; gn.fillRect(x, top, w, h);
      gn.fillStyle = '#2d4a3b';
      gn.fillRect(x, top, w, NP(0.08)); gn.fillRect(x, top + h - NP(0.08), w, NP(0.08)); gn.fillRect(x, top, NP(0.08), h); gn.fillRect(x + w - NP(0.08), top, NP(0.08), h);
      gn.fillRect(x + w / 2 - 1, top, 2, h); gn.fillRect(x, top + h * 0.36, w, 2); gn.fillRect(x, top + h * 0.7, w, 1);
      if (r() < 0.45) {
        const warm = 185 + ((r() * 50) | 0);
        gne.fillStyle = `rgba(255,${warm + 15},${warm - 45},${0.6 + r() * 0.4})`; gne.fillRect(x + 2, top + 2, w - 4, h - 4);
        gne.fillStyle = '#000'; gne.fillRect(x + w / 2 - 1, top, 2, h);
      }
    }
  }
  const nrep = [1 / (NB * NBAYS), 1 / NTH];
  const nshFacade = std({ map: tex(cn, { repeat: nrep, wrapT: false, aniso }), emissiveMap: tex(cne, { repeat: nrep, wrapT: false, aniso }), emissive: new THREE.Color('#ffd49a'), roughness: 0.9 }, 'nsh-facade');
  M.registerNightMaterial(nshFacade, 1.3);
  const nshRoof = std({ map: M.surfaceTexture('seam', '#5f917a', 2, 83), roughness: 0.5, metalness: 0.3, envMapIntensity: 0.9 }, 'nsh-roof');
  const trim = std({ map: M.surfaceTexture('stone', '#ddd3bb', 3, 84), roughness: 0.8 }, 'nsh-trim');
  const steelWhite = std({ color: '#e7e9e6', roughness: 0.45, metalness: 0.3 }, 'nsh-steel');
  const skyGlass = std({ color: '#7f97a3', roughness: 0.08, metalness: 0.6, envMapIntensity: 1.4, emissive: new THREE.Color('#ffe2b0') }, 'nsh-skyglass');
  M.registerNightMaterial(skyGlass, 0.35);
  const planting = std({ color: '#43603a', roughness: 1 }, 'wean-planting');
  const lamp = std({ color: '#e9e4d8', roughness: 0.4, emissive: new THREE.Color('#ffd9a0') }, 'wean-lamp');
  M.registerNightMaterial(lamp, 2.0);
  const out = { concrete, facade, sorry, nshFacade, nshRoof, trim, steelWhite, skyGlass, planting, lamp };
  CACHE.set(M, out);
  return out;
}

// ---------------------------------------------------------------- helpers
// Walls around a local ring from terrain (sampled per edge, minus 1 m) up to y1. mat: material or fn(edge) → material
// (null skips the edge). u runs continuously along the ring; v = y − datum.
function ringWallsTerrain(ctx, frame, bag, mat, ring, y1, { datum = 0, yBot = null, top = null } = {}) {
  let u = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = typeof mat === 'function' ? mat(a, b, i) : mat;
    if (m && L > 0.01) {
      let y0 = yBot;
      if (y0 == null) {
        y0 = Infinity;
        const k = Math.max(1, Math.ceil(L / 3));
        for (let j = 0; j <= k; j++) { const [x, z] = frame.toWorld(a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k); y0 = Math.min(y0, ctx.heightAt(x, z)); }
        y0 -= 1.0;
      }
      if (y1 > y0) wallQuad(bag, m, a, b, y0, y1, u, datum);
    }
    u += L;
  }
  if (top) flatPolygon(bag, top, ring, y1, true);
}

function groundMin(ctx, frame, ring, step = 3) {
  let m = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j <= k; j++) { const [x, z] = frame.toWorld(a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k); m = Math.min(m, ctx.heightAt(x, z)); }
  }
  return m;
}

// Frame whose local +u points (roughly) east and +v south.
function eastFrame(b) {
  const fp = footprintFrame(b.footprint);
  let f = makeFrame(fp.center, fp.angle);
  if (f.toWorld(1, 0)[0] < fp.center[0]) f = makeFrame(fp.center, fp.angle + Math.PI);
  return f;
}

// Stepped slope ("bleachers") from the wall head (v = vFoot, y = yFoot) up to (vTop, yTop), for u0..u1, with nSteps
// risers and raking fins every finStep metres. dir = +1 when vFoot > vTop (south side), −1 for the north side.
function steppedSlope(bag, mat, u0, u1, vFoot, yFoot, vTop, yTop, nSteps, finStep, lowQ) {
  const run = (vTop - vFoot) / nSteps, rise = (yTop - yFoot) / nSteps;
  const out = Math.sign(vFoot - vTop);   // outward direction (+v south side)
  for (let k = 0; k < nSteps; k++) {
    const va = vFoot + run * k, vb = vFoot + run * (k + 1);
    const ya = yFoot + rise * k, yb = ya + rise;
    // riser at va (faces outward), tread from va to vb at yb (faces up)
    orientQuadTo(bag, mat, [u0, ya, va], [u1, ya, va], [u1, yb, va], [u0, yb, va], null, null, null, null, [0, 0, out]);
    orientQuadTo(bag, mat, [u0, yb, va], [u1, yb, va], [u1, yb, vb], [u0, yb, vb], null, null, null, null, [0, 1, 0]);
  }
  // end caps: the stepped profile closed down to the foot level
  for (const [u, s] of [[u0, -1], [u1, 1]]) {
    for (let k = 0; k < nSteps; k++) {
      const va = vFoot + run * k, vb = vFoot + run * (k + 1), yb = yFoot + rise * (k + 1);
      orientQuadTo(bag, mat, [u, yFoot, va], [u, yFoot, vb], [u, yb, vb], [u, yb, va], null, null, null, null, [s, 0, 0]);
    }
  }
  // raking fins: slabs whose top runs `proud` above the step nosings, splitting the slope into bays
  const nf = Math.max(1, Math.round((u1 - u0) / finStep));
  const T = 0.5, proud = rise + 1.1;
  for (let i = 1; i < nf; i++) {
    if (lowQ && i % 2) continue;
    const u = u0 + (u1 - u0) * (i / nf);
    const ua = u - T / 2, ub = u + T / 2;
    const A = [vFoot, yFoot], Bf = [vTop, yTop], B = [vTop, yTop + proud - rise], C = [vFoot, yFoot + proud];
    for (const [uu, s] of [[ua, -1], [ub, 1]]) {
      orientQuadTo(bag, mat, [uu, A[1], A[0]], [uu, Bf[1], Bf[0]], [uu, B[1], B[0]], [uu, C[1], C[0]], null, null, null, null, [s, 0, 0]);
    }
    orientQuadTo(bag, mat, [ua, C[1], C[0]], [ub, C[1], C[0]], [ub, B[1], B[0]], [ua, B[1], B[0]], null, null, null, null, [0, 1, out * 0.6]);
    orientQuadTo(bag, mat, [ua, A[1], A[0]], [ub, A[1], A[0]], [ub, C[1], C[0]], [ua, C[1], C[0]], null, null, null, null, [0, 0, out]);
  }
}

// ======================================================================== Wean Hall
async function buildWean(ctx) {
  const b = ctx.data.buildings.find((x) => x.osmId === WEAN_ID || x.id === WEAN_ID);
  if (!b) { console.warn('[wean] building not in data'); return null; }
  const low = ctx.quality?.level === 'low';
  const M = ctx.materials;
  const W = sharedMaterials(ctx);
  const frame = eastFrame(b);
  const fpL = frame.ringToLocal(b.footprint);   // local footprint (30 vertices, see header of this function)
  const bag = new Bag();
  const roof = M.get('flatRoof'), glassDark = M.get('glassDark'), paver = M.get('sidewalk'), darkMetal = M.get('darkMetal');

  // split the footprint at u = U_W into the west wing and the main block; the snout is vertices 21..28
  const V = (i) => fpL[i];
  const e45 = [V(4), V(5)], tt = (U_W - e45[0][0]) / (e45[1][0] - e45[0][0]);
  const split = [U_W, e45[0][1] + (e45[1][1] - e45[0][1]) * tt];
  const mainRing = orientRing([split, ...[5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(V), V(28)]);
  const westRing = orientRing([V(29), V(0), V(1), V(2), V(3), V(4), split, V(28)]);
  const snoutRing = orientRing([21, 22, 23, 24, 25, 26, 27, 28].map(V));
  const isLong = (a, c) => Math.abs(c[0] - a[0]) > Math.abs(c[1] - a[1]);
  const onSplit = (a, c) => Math.abs(a[0] - U_W) < 0.9 && Math.abs(c[0] - U_W) < 0.9;

  // ---------------------------------------------------------------- P1: floors 1–4 over the whole main block (terraces on top)
  const wallMatP1 = (a, c) => (onSplit(a, c) ? null : ((a[1] + c[1]) / 2 > V_S - 1 ? null : (isLong(a, c) ? W.facade : W.concrete)));
  ringWallsTerrain(ctx, frame, bag, wallMatP1, mainRing, lv(5), { datum: L1 });
  flatPolygon(bag, paver, mainRing, lv(5), true);
  // terrace parapets on the north edges (only where the terrace is exposed)
  for (let i = 0; i < mainRing.length; i++) {
    const a = mainRing[i], c = mainRing[(i + 1) % mainRing.length];
    if ((a[1] + c[1]) / 2 > V_N - 0.6 || onSplit(a, c)) continue;
    const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L;   // outward (area2<0)
    const ia = [a[0] - nx * 0.3, a[1] - nz * 0.3], ic = [c[0] - nx * 0.3, c[1] - nz * 0.3];
    wallQuad(bag, W.concrete, a, c, lv(5), lv(5) + 1.05, 0, 0);
    orientQuadTo(bag, W.concrete, [ia[0], lv(5), ia[1]], [ic[0], lv(5), ic[1]], [ic[0], lv(5) + 1.05, ic[1]], [ia[0], lv(5) + 1.05, ia[1]], null, null, null, null, [-nx, 0, -nz]);
    orientQuadTo(bag, W.concrete, [a[0], lv(5) + 1.05, a[1]], [c[0], lv(5) + 1.05, c[1]], [ic[0], lv(5) + 1.05, ic[1]], [ia[0], lv(5) + 1.05, ia[1]], null, null, null, null, [0, 1, 0]);
  }
  // planters and shrubs on the north terraces
  if (!low) {
    for (const u of [4, 13, 22, 31]) {
      const v = -19.2;
      bag.box(W.concrete, u, lv(5) + 0.4, v, 3.2, 0.8, 2.6);
      bag.box(W.planting, u, lv(5) + 1.05, v, 2.8, 0.7, 2.2);
      bag.box(W.planting, u + 0.3, lv(5) + 1.6, v - 0.2, 1.6, 0.7, 1.4);
    }
  }

  // ---------------------------------------------------------------- P2: floors 5–7 — the long walls facing the Mall and north
  const p2 = orientRing([[U_W, V_N], [U_E, V_N], [U_E, V_S], [U_W, V_S]]);
  const p2Mat = (a, c) => (isLong(a, c) ? W.facade : W.concrete);
  ringWallsTerrain(ctx, frame, bag, p2Mat, p2, Y_FAC, { datum: L1, yBot: null });
  // band / coping line at the wall head, and proud sill / head ledges along every window row (real shadow lines)
  for (const vv of [V_S, V_N]) {
    const s = Math.sign(vv);
    bag.box(W.concrete, (U_W + U_E) / 2, Y_FAC - 0.2, vv + s * 0.12, U_E - U_W + 0.3, 0.4, 0.26);
    const u0 = vv > 0 ? V(21)[0] : U_W, u1 = U_E;
    for (let n = 5; n <= 7; n++) {
      for (const [dy, h] of [[0.92, 0.16], [2.8, 0.22]]) bag.box(W.concrete, (u0 + u1) / 2, lv(n) + dy + h / 2, vv + s * 0.1, u1 - u0, h, 0.2);
    }
  }

  // ---------------------------------------------------------------- stepped slopes and the core
  const nSteps = low ? 4 : 6;
  steppedSlope(bag, W.concrete, U_W, U_E, V_S, Y_FAC, V_SC, Y_SL, nSteps, 9.3, low);
  steppedSlope(bag, W.concrete, U_W, U_E, V_N, Y_FAC, V_NC, Y_SL, nSteps, 9.3, low);
  const core = orientRing([[U_W, V_NC], [U_E, V_NC], [U_E, V_SC], [U_W, V_SC]]);
  ringWallsTerrain(ctx, frame, bag, W.concrete, core, Y_PAR, { yBot: Y_FAC - 0.2, datum: 0 });
  flatPolygon(bag, roof, core.map(([u, v]) => [u - Math.sign(u - 20) * 0.35, v - Math.sign(v) * 0.35]), Y_ROOF, true);
  // parapet inner faces
  for (let i = 0; i < 4; i++) {
    const a = core[i], c = core[(i + 1) % 4];
    const ia = [a[0] - Math.sign(a[0] - 20) * 0.35, a[1] - Math.sign(a[1]) * 0.35], ic = [c[0] - Math.sign(c[0] - 20) * 0.35, c[1] - Math.sign(c[1]) * 0.35];
    const mid = [(ia[0] + ic[0]) / 2 - 20, (ia[1] + ic[1]) / 2];
    const nrm = isLong(a, c) ? [0, 0, -Math.sign(mid[1])] : [-Math.sign(mid[0]), 0, 0];
    orientQuadTo(bag, W.concrete, [ia[0], Y_ROOF, ia[1]], [ic[0], Y_ROOF, ic[1]], [ic[0], Y_PAR, ic[1]], [ia[0], Y_PAR, ia[1]], null, null, null, null, nrm);
    orientQuadTo(bag, W.concrete, [a[0], Y_PAR, a[1]], [c[0], Y_PAR, c[1]], [ic[0], Y_PAR, ic[1]], [ia[0], Y_PAR, ia[1]], null, null, null, null, [0, 1, 0]);
  }
  // "SORRY WORLD" on the Mall-side parapet
  {
    const uc = 22, w = 11, v = V_SC + 0.03, y0 = Y_SL + 0.35, y1 = y0 + 1.35;
    orientQuadTo(bag, W.sorry, [uc - w / 2, y0, v], [uc + w / 2, y0, v], [uc + w / 2, y1, v], [uc - w / 2, y1, v], [0, 0], [1, 0], [1, 1], [0, 1], [0, 0, 1]);
    bag.setOptions(W.sorry, { castShadow: false, receiveShadow: false, renderOrder: 2 });
  }
  // mechanical penthouse at the Doherty end + rooftop units
  {
    const pen = orientRing([[44.5, -8.2], [56.4, -8.2], [56.4, 6.2], [44.5, 6.2]]);
    ringWallsTerrain(ctx, frame, bag, W.concrete, pen, Y_ROOF + 3.6, { yBot: Y_ROOF - 0.1, top: roof });
    if (!low) {
      for (const [u, v] of [[8, -3], [14, 2], [26, -4], [33, 1.5]]) bag.box(darkMetal, u, Y_ROOF + 0.6, v, 2.4, 1.2, 1.8);
      bag.box(W.concrete, -8, Y_ROOF + 1.4, 0, 5, 2.8, 5.5);   // stair / lift overrun at the west end
    }
  }

  // ---------------------------------------------------------------- west wing (steps down towards Hamerschlag)
  const wwMat = (a, c) => (onSplit(a, c) ? null : (isLong(a, c) ? W.facade : W.concrete));
  ringWallsTerrain(ctx, frame, bag, wwMat, westRing, Y_WW + 0.9, { datum: L1 });
  flatPolygon(bag, roof, westRing, Y_WW, true);
  // parapet inner edge line (a thin ring inset) — cheap: a coping strip on top
  for (let i = 0; i < westRing.length; i++) {
    const a = westRing[i], c = westRing[(i + 1) % westRing.length];
    if (onSplit(a, c)) continue;
    const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz); if (L < 0.5) continue;
    const nx = -dz / L, nz = dx / L;
    orientQuadTo(bag, W.concrete, [a[0] - nx * 0.3, Y_WW, a[1] - nz * 0.3], [c[0] - nx * 0.3, Y_WW, c[1] - nz * 0.3], [c[0] - nx * 0.3, Y_WW + 0.9, c[1] - nz * 0.3], [a[0] - nx * 0.3, Y_WW + 0.9, a[1] - nz * 0.3], null, null, null, null, [-nx, 0, -nz]);
  }
  // stepped skylight band along the wing's north side (the grid seen from the air)
  steppedSlope(bag, W.concrete, -50, -17, -12.5, Y_WW, -8.5, Y_WW + 2.2, low ? 2 : 3, 8.2, low);

  // ---------------------------------------------------------------- north service tower (loading / stairs)
  const tower = orientRing([12, 13, 14].map(V).concat([[V(11)[0], V(14)[1]]]));
  ringWallsTerrain(ctx, frame, bag, W.concrete, tower, lv(6) + 0.8, { top: roof });

  // ---------------------------------------------------------------- the snout over the Mall entrance
  ringWallsTerrain(ctx, frame, bag, W.concrete, snoutRing, Y_FAC, { yBot: Y_SN0 });
  flatPolygon(bag, roof, snoutRing, Y_FAC, true);
  flatPolygon(bag, W.concrete, snoutRing, Y_SN0, false);
  // raking east wall under the snout (from the plaza at the facade up to the soffit)
  {
    const t = 0.45, ub = V(21)[0] - 0.45;
    const A = [ub, lv(5) - 0.5, V_S], B = [ub, Y_SN0, V_S + 7.5], C = [ub, Y_SN0, V_S];
    for (const [uu, s] of [[ub, 1], [ub - t, -1]]) {
      const a2 = [uu, A[1], A[2]], b2 = [uu, B[1], B[2]], c2 = [uu, C[1], C[2]];
      const n = (b2[1] - a2[1]) * (c2[2] - a2[2]) - (b2[2] - a2[2]) * (c2[1] - a2[1]);
      if (n * s >= 0) bag.tri(W.concrete, a2, b2, c2); else bag.tri(W.concrete, a2, c2, b2);
    }
    orientQuadTo(bag, W.concrete, [ub, A[1], A[2]], [ub - t, A[1], A[2]], [ub - t, B[1], B[2]], [ub, B[1], B[2]], null, null, null, null, [0, -0.7, 1]);
  }
  // plaza under the snout at the Mall level, with an exterior stair down to the west
  const plaza = orientRing([[V(28)[0] - 0.2, V_S], [V(21)[0], V_S], [V(22)[0], V(22)[1] + 1.5], [V(25)[0] - 0.2, V(25)[1] + 1.5]]);
  ringWallsTerrain(ctx, frame, bag, W.concrete, plaza, lv(5) - 0.02, { top: paver });
  const stairs = [];
  {
    const gW = groundMin(ctx, frame, [[-26, 16], [-26, 23], [-16, 23], [-16, 16]]);
    const drop = Math.max(0.5, lv(5) - 0.02 - (gW + 0.1)), n = Math.max(2, Math.round(drop / 0.17)), tread = 0.34;
    const u0 = V(28)[0] - 0.2;
    for (let k = 0; k < n; k++) {
      const yTop = lv(5) - 0.02 - (k + 1) * (drop / n), ua = u0 - (k + 1) * tread;
      bag.box(W.concrete, ua + tread / 2, (yTop + gW - 1) / 2, 19.5, tread, yTop - gW + 1, 4.2);
      stairs.push([ua, ua + tread, yTop]);
    }
  }
  // entrance glazing under the snout and the long sloped skylights along the Mall front
  orientQuadTo(bag, glassDark, [V(28)[0] + 1.5, lv(5), V_S + 0.05], [V(21)[0] - 1.5, lv(5), V_S + 0.05], [V(21)[0] - 1.5, Y_SN0 - 0.4, V_S + 0.05], [V(28)[0] + 1.5, Y_SN0 - 0.4, V_S + 0.05], null, null, null, null, [0, 0, 1]);
  for (let u = V(28)[0] + 3; u < V(21)[0] - 1.5; u += 3.2) bag.box(darkMetal, u, (lv(5) + Y_SN0 - 0.4) / 2, V_S + 0.1, 0.1, Y_SN0 - 0.4 - lv(5), 0.1);
  bag.box(darkMetal, (V(28)[0] + V(21)[0]) / 2, lv(5) + 2.6, V_S + 0.1, V(21)[0] - V(28)[0] - 3, 0.1, 0.1);
  if (!low) {
    const u0 = 9, u1 = 33, v0 = V_S + 0.2, v1 = V_S + 1.8;
    bag.box(W.concrete, (u0 + u1) / 2, lv(5) - 0.2, (v0 + v1) / 2, u1 - u0 + 0.4, 0.5, v1 - v0 + 0.4);
    orientQuadTo(bag, glassDark, [u0, lv(5) + 0.95, v0], [u1, lv(5) + 0.95, v0], [u1, lv(5) + 0.1, v1], [u0, lv(5) + 0.1, v1], null, null, null, null, [0, 0.8, 0.6]);
    for (let u = u0; u <= u1; u += 2) bag.box(darkMetal, u, lv(5) + 0.52, (v0 + v1) / 2, 0.08, 0.1, v1 - v0);
  }
  bag.setOptions(glassDark, { castShadow: false });
  // downlights in the snout soffit over the entrance plaza
  for (let u = V(28)[0] + 2.5; u < V(21)[0] - 1; u += 4.2) for (const v of [V_S + 3, V_S + 8.5]) bag.box(W.lamp, u, Y_SN0 - 0.03, v, 0.5, 0.05, 0.5);
  bag.setOptions(W.lamp, { castShadow: false });

  // ---------------------------------------------------------------- assemble
  const group = bag.build('wean');
  frame.place(group);
  const [cx, cz] = frame.toWorld(20, 0);
  const entry = { key: 'wean', kind: 'landmark', name: 'Wean Hall', nameZh: '韦恩楼', osmId: WEAN_ID, infoKey: WEAN_ID, position: [cx, Y_PAR, cz], radius: 62 };
  ctx.pick.add(group, entry);
  ctx.labels.add({ key: 'wean', text: 'Wean Hall', textZh: '韦恩楼', kind: 'landmark', priority: 9, position: { x: cx, y: Y_PAR + 6, z: cz } });

  // colliders: lower block, upper block, west wing, tower, snout (above the plaza), stair cheeks
  const W2 = (ring) => frame.ringToWorld(ring);
  ctx.colliders.addPolygon(W2(mainRing), 0, lv(5) - 0.3, 'wean');
  ctx.colliders.addPolygon(W2(p2), 0, Y_PAR, 'wean');
  ctx.colliders.addPolygon(W2(westRing), 0, Y_WW + 0.9, 'wean');
  ctx.colliders.addPolygon(W2(tower), 0, lv(6) + 0.8, 'wean');
  ctx.colliders.addPolygon(W2(snoutRing), Y_SN0 - 0.2, Y_FAC, 'wean-snout');
  // walkables: the Mall plaza under the snout and the stair treads
  {
    const pts = [];
    const quad = (r, y) => { const w = W2(r); pts.push(w[0][0], y, w[0][1], w[1][0], y, w[1][1], w[2][0], y, w[2][1], w[0][0], y, w[0][1], w[2][0], y, w[2][1], w[3][0], y, w[3][1]); };
    quad(plaza, lv(5) - 0.02);
    for (const [ua, ub, y] of stairs) quad([[ua, 17.4], [ub, 17.4], [ub, 21.6], [ua, 21.6]], y);
    const walk = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    walk.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    walk.name = 'wean-walkable';
    walk.updateMatrixWorld(true);
    ctx.walkables.add(walk);
  }
  return group;
}

// ======================================================================== Newell-Simon Hall + skybridge
async function buildNsh(ctx) {
  const b = ctx.data.buildings.find((x) => x.osmId === NSH_ID || x.id === NSH_ID);
  if (!b) { console.warn('[wean] Newell-Simon not in data'); return null; }
  const low = ctx.quality?.level === 'low';
  const M = ctx.materials;
  const W = sharedMaterials(ctx);
  const frame = eastFrame(b);
  const fpL = frame.ringToLocal(b.footprint);
  const ring = orientRing(fpL);
  const bag = new Bag();
  const DATUM = 22.6, EAVE = 42.5;

  // walls: brick facade with the stone base, from terrain to the eave
  ringWallsTerrain(ctx, frame, bag, W.nshFacade, ring, EAVE, { datum: DATUM });
  // cornice: a projecting cream band under the eave
  {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], c = ring[(i + 1) % n];
      const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz); if (L < 0.3) continue;
      const nx = -dz / L, nz = dx / L;
      const oa = [a[0] + nx * 0.35, a[1] + nz * 0.35], oc = [c[0] + nx * 0.35, c[1] + nz * 0.35];
      orientQuadTo(bag, W.trim, [oa[0], EAVE - 0.55, oa[1]], [oc[0], EAVE - 0.55, oc[1]], [oc[0], EAVE, oc[1]], [oa[0], EAVE, oa[1]], null, null, null, null, [nx, 0, nz]);
      orientQuadTo(bag, W.trim, [a[0], EAVE - 0.55, a[1]], [c[0], EAVE - 0.55, c[1]], [oc[0], EAVE - 0.55, oc[1]], [oa[0], EAVE - 0.55, oa[1]], null, null, null, null, [0, -1, 0]);
    }
  }
  // green hipped roofs around a flat mechanical core
  const hr = hipRoof(bag, W.nshRoof, ring, EAVE, { overhang: 0.55, inset: 12.5, pitch: 25 * Math.PI / 180, topMat: M.get('flatRoof'), fasciaMat: W.trim, fascia: 0.3, soffitMat: W.trim });
  const topY = hr.topY;
  // atrium: barrel-vaulted skylight on the flat core (east–west), rooftop cooling units, a louvred dormer
  {
    const R = 3.2, u0 = -10, u1 = 12, v0 = 4.5, segs = low ? 6 : 12;
    const P = (a, u) => [u, topY + 0.6 + R * Math.sin(a) * 0.7, v0 + R * Math.cos(a)];
    for (let k = 0; k < segs; k++) {
      const a0 = (Math.PI * k) / segs, a1 = (Math.PI * (k + 1)) / segs;
      orientQuadTo(bag, W.skyGlass, P(a0, u0), P(a0, u1), P(a1, u1), P(a1, u0), null, null, null, null, [0, Math.sin((a0 + a1) / 2), Math.cos((a0 + a1) / 2)]);
      if (!low && k % 2 === 0) { const a = a0; const p0 = P(a, u0); bag.box(W.steelWhite, (u0 + u1) / 2, p0[1], p0[2], u1 - u0, 0.12, 0.12); }
    }
    for (let u = u0; u <= u1 + 0.01; u += 3.6) {
      for (let k = 0; k < segs; k++) {
        const a0 = (Math.PI * k) / segs, a1 = (Math.PI * (k + 1)) / segs;
        const p0 = P(a0, u), p1 = P(a1, u);
        if (!low) bag.box(W.steelWhite, u, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, 0.14, Math.abs(p1[1] - p0[1]) + 0.12, Math.abs(p1[2] - p0[2]) + 0.12);
      }
    }
    bag.box(W.trim, (u0 + u1) / 2, topY + 0.3, v0, u1 - u0 + 0.6, 0.6, 2 * R + 0.6);
    if (!low) for (const [u, v] of [[-8, -8], [-3, -8], [2, -8], [7, -8]]) {
      bag.box(M.get('darkMetal'), u, topY + 1.1, v, 3.6, 2.2, 3.6);
      bag.box(W.steelWhite, u, topY + 2.3, v, 3.0, 0.2, 3.0);
    }
  }
  // north entrance: glazed doors in the recess between vertices 7 and 8, a curved canopy and an arched window above
  {
    const vN = (fpL[7][1] + fpL[8][1]) / 2;   // recessed north front between OSM vertices 7 and 8 (~ -22.9)
    const gN = groundMin(ctx, frame, [[-4, vN - 1], [4, vN - 1], [4, vN - 3], [-4, vN - 3]]);
    const y0 = gN + 0.05;
    orientQuadTo(bag, M.get('glassDark'), [-3.2, y0, vN - 0.06], [3.2, y0, vN - 0.06], [3.2, y0 + 3.1, vN - 0.06], [-3.2, y0 + 3.1, vN - 0.06], null, null, null, null, [0, 0, -1]);
    for (let u = -3.2; u <= 3.21; u += 1.6) bag.box(W.steelWhite, u, y0 + 1.55, vN - 0.1, 0.1, 3.1, 0.1);
    // curved canopy (segmental, 7 × 2.6 m)
    const segs = 6;
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs, t1 = (k + 1) / segs;
      const x0 = -3.8 + 7.6 * t0, x1 = -3.8 + 7.6 * t1;
      const y = (t) => y0 + 3.6 + 0.45 * Math.sin(Math.PI * t);
      orientQuadTo(bag, W.steelWhite, [x0, y(t0), vN - 0.1], [x1, y(t1), vN - 0.1], [x1, y(t1), vN - 2.7], [x0, y(t0), vN - 2.7], null, null, null, null, [0, 1, 0]);
      orientQuadTo(bag, W.steelWhite, [x0, y(t0) - 0.18, vN - 2.7], [x1, y(t1) - 0.18, vN - 2.7], [x1, y(t1), vN - 2.7], [x0, y(t0), vN - 2.7], null, null, null, null, [0, 0, -1]);
    }
    // tall arched window (the stair hall) above the canopy
    const arch = [];
    const aw = 5.2, ab = y0 + 4.6, at = Math.min(EAVE - 0.8, ab + 8.5);
    arch.push([-aw / 2, ab], [aw / 2, ab], [aw / 2, at - aw / 2]);
    for (let k = 1; k < 10; k++) { const a = (Math.PI * k) / 10; arch.push([(aw / 2) * Math.cos(a), at - aw / 2 + (aw / 2) * Math.sin(a)]); }
    arch.push([-aw / 2, at - aw / 2]);
    const m = new THREE.Matrix4().set(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, vN - 0.05, 0, 0, 0, 1);   // panel facing -v
    const contour = arch.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const Pt = new THREE.Vector3();
    const Wt = (x, y) => { Pt.set(x, y, 0).applyMatrix4(m); return [Pt.x, Pt.y, Pt.z]; };
    for (const [i, j, k] of tris) {
      const A = Wt(...arch[i]), B = Wt(...arch[j]), C = Wt(...arch[k]);
      const ny = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      // want the face to point -z (local -v): cross z-component = e1.x*e2.y - e1.y*e2.x
      if (ny <= 0) bag.tri(W.skyGlass, A, B, C); else bag.tri(W.skyGlass, A, C, B);
    }
    for (let x = -aw / 2 + 1.3; x < aw / 2; x += 1.3) bag.box(W.steelWhite, x, (ab + at - 0.6) / 2, vN - 0.1, 0.1, at - ab - 0.8, 0.1);
  }
  // south front: tall glazed bay with a curved head over the arched yard entrance (east of the bridge)
  {
    const vS = (fpL[0][1] + fpL[12][1]) / 2;
    const u0 = 7, u1 = 14, d = 1.6;
    const gS = groundMin(ctx, frame, [[u0 - 1, vS + 0.5], [u1 + 1, vS + 0.5], [u1 + 1, vS + 3], [u0 - 1, vS + 3]]);
    const yA = gS + 0.05, yB = Math.max(yA + 6.2, 29.4), yT = EAVE - 1.2;
    // arched entrance: stone surround, dark glazing
    const aw = u1 - u0 - 1.6, ax = (u0 + u1) / 2;
    const arch = [[-aw / 2, yA], [aw / 2, yA], [aw / 2, yB - aw / 2 - 0.4]];
    for (let k = 1; k < 10; k++) { const a = (Math.PI * k) / 10; arch.push([(aw / 2) * Math.cos(a), yB - aw / 2 - 0.4 + (aw / 2) * Math.sin(a)]); }
    arch.push([-aw / 2, yB - aw / 2 - 0.4]);
    const tris = THREE.ShapeUtils.triangulateShape(arch.map(([x, y]) => new THREE.Vector2(x, y)), []);
    for (const [i, j, k] of tris) {
      const A = [ax + arch[i][0], arch[i][1], vS + 0.04], B = [ax + arch[j][0], arch[j][1], vS + 0.04], C = [ax + arch[k][0], arch[k][1], vS + 0.04];
      const nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (nz >= 0) bag.tri(M.get('glassDark'), A, B, C); else bag.tri(M.get('glassDark'), A, C, B);
    }
    bag.box(W.trim, ax, yB - 0.2, vS + 0.12, aw + 1.4, 0.4, 0.3);
    for (const s of [-1, 1]) bag.box(W.trim, ax + s * (aw / 2 + 0.35), (yA + yB - 0.4) / 2, vS + 0.12, 0.7, yB - 0.4 - yA, 0.3);
    // the glazed bay (front + sides) with a segmental metal head
    orientQuadTo(bag, W.skyGlass, [u0, yB, vS + d], [u1, yB, vS + d], [u1, yT, vS + d], [u0, yT, vS + d], null, null, null, null, [0, 0, 1]);
    for (const u of [u0, u1]) orientQuadTo(bag, W.skyGlass, [u, yB, vS], [u, yB, vS + d], [u, yT, vS + d], [u, yT, vS], null, null, null, null, [u === u0 ? -1 : 1, 0, 0]);
    bag.box(W.trim, (u0 + u1) / 2, yB - 0.15, vS + d / 2, u1 - u0 + 0.3, 0.3, d + 0.3);
    for (let u = u0; u <= u1 + 0.01; u += (u1 - u0) / 5) bag.box(W.steelWhite, u, (yB + yT) / 2, vS + d + 0.05, 0.12, yT - yB, 0.12);
    for (let y = yB + 3.2; y < yT; y += 3.2) bag.box(W.steelWhite, (u0 + u1) / 2, y, vS + d + 0.05, u1 - u0, 0.14, 0.12);
    const segs = low ? 4 : 8;
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs, t1 = (k + 1) / segs;
      const x0 = u0 - 0.2 + (u1 - u0 + 0.4) * t0, x1 = u0 - 0.2 + (u1 - u0 + 0.4) * t1;
      const h = (t) => yT + 1.4 * Math.sin(Math.PI * t);
      orientQuadTo(bag, W.steelWhite, [x0, h(t0), vS + d + 0.2], [x1, h(t1), vS + d + 0.2], [x1, h(t1), vS - 0.2], [x0, h(t0), vS - 0.2], null, null, null, null, [0, 1, 0]);
      orientQuadTo(bag, W.steelWhite, [x0, yT, vS + d + 0.2], [x1, yT, vS + d + 0.2], [x1, h(t1), vS + d + 0.2], [x0, h(t0), vS + d + 0.2], null, null, null, null, [0, 0, 1]);
    }
  }
  bag.setOptions(W.skyGlass, { castShadow: false });

  const group = bag.build('newellSimon');
  frame.place(group);

  // ------------------------------------------------ the skybridge to Wean (OSM w320582065)
  const link = ctx.data.buildings.find((x) => x.osmId === LINK_ID || x.id === LINK_ID);
  let bridgeGroup = null;
  if (link) {
    const lf = footprintFrame(link.footprint);
    const bf = makeFrame(lf.center, lf.angle);
    const hl = lf.length / 2 + 0.4, hw = 2.1;
    const bb = new Bag();
    const yD = BRIDGE_DECK, yR = yD + 3.7;
    // deck slab and roof slab
    bb.box(M.get('concrete'), 0, yD - 0.35, 0, 2 * hl, 0.7, 2 * hw + 0.3);
    bb.box(W.steelWhite, 0, yR + 0.2, 0, 2 * hl, 0.4, 2 * hw + 0.8);
    // glazing
    for (const s of [-1, 1]) {
      orientQuadTo(bb, W.skyGlass, [-hl, yD, s * hw], [hl, yD, s * hw], [hl, yR, s * hw], [-hl, yR, s * hw], null, null, null, null, [0, 0, s]);
      // Warren truss outside the glass: chords + diagonals
      bb.box(W.steelWhite, 0, yD + 0.15, s * (hw + 0.15), 2 * hl, 0.3, 0.3);
      bb.box(W.steelWhite, 0, yR - 0.15, s * (hw + 0.15), 2 * hl, 0.3, 0.3);
      const nP = Math.max(4, Math.round((2 * hl) / 3.6));
      const step = (2 * hl) / nP;
      for (let k = 0; k < nP; k++) {
        const x0 = -hl + k * step, x1 = x0 + step;
        const up = k % 2 === 0;
        const xa = up ? x0 : x1, xb = up ? x1 : x0;
        const len = Math.hypot(xb - xa, yR - yD - 0.3), ang = Math.atan2(yR - yD - 0.3, xb - xa);
        const g = new THREE.BoxGeometry(len, 0.22, 0.22);
        const m = new THREE.Matrix4().makeRotationZ(ang).setPosition((xa + xb) / 2, (yD + yR) / 2, s * (hw + 0.15));
        bb.geo(W.steelWhite, g, { matrix: m });
        g.dispose();
        if (!low) bb.box(W.steelWhite, x0, (yD + yR) / 2, s * (hw + 0.15), 0.18, yR - yD, 0.18);
      }
    }
    // one pier in the median between the two drives
    {
      const along = bf.toLocal(-226.6, 4.8)[0];
      const [px, pz] = bf.toWorld(along, 0);
      const gy = ctx.heightAt(px, pz);
      bb.box(M.get('concrete'), along, (gy - 1 + yD - 0.7) / 2, 0, 1.4, yD - 0.7 - gy + 1, 2.4);
      ctx.colliders.addBox(px, pz, 0.7, 1.2, bf.rotationY, gy - 1, yD - 0.7, 'nsh-bridge-pier');
    }
    bb.setOptions(W.skyGlass, { castShadow: false });
    bridgeGroup = bb.build('nsh-bridge');
    bf.place(bridgeGroup);
    ctx.colliders.addPolygon(bf.ringToWorld([[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]]), yD - 0.7, yR + 0.4, 'nsh-bridge');
  }

  // ------------------------------------------------ pick / label / colliders
  const [cx, cz] = frame.toWorld(0, 0);
  const entry = { key: 'newellSimon', kind: 'landmark', name: 'Newell-Simon Hall', nameZh: '纽厄尔-西蒙楼', osmId: NSH_ID, infoKey: NSH_ID, position: [cx, topY, cz], radius: 40 };
  const root = new THREE.Group();
  root.name = 'newellSimon';
  root.add(group);
  if (bridgeGroup) root.add(bridgeGroup);
  root.updateMatrixWorld(true);
  ctx.pick.add(root, entry);
  ctx.labels.add({ key: 'newellSimon', text: 'Newell-Simon Hall', textZh: '纽厄尔-西蒙楼', kind: 'landmark', priority: 9, position: { x: cx, y: topY + 6, z: cz } });
  ctx.colliders.addPolygon(frame.ringToWorld(ring), 0, topY, 'newellSimon');
  return root;
}

export default [
  {
    key: 'wean',
    name: 'Wean Hall',
    nameZh: '韦恩楼',
    osmIds: [WEAN_ID],
    async build(ctx) { return buildWean(ctx); },
  },
  {
    key: 'newellSimon',
    name: 'Newell-Simon Hall',
    nameZh: '纽厄尔-西蒙楼',
    osmIds: [NSH_ID, LINK_ID],
    async build(ctx) { return buildNsh(ctx); },
  },
];
