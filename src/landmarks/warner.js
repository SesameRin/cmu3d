// Warner Hall and Cyert Hall — the administration / computing pair at the Forbes Avenue edge of campus, between the
// Morewood Avenue gate (where the Cut meets Forbes) and the Gates Center.
//
// Warner Hall (1966, Charles Luckman Associates): CMU's seven-storey administration building (president's office,
// admission). A crisp 1960s box wrapped in a curtain wall of dark bronze-tinted glass and greige spandrels on bronze
// mullions, with two full-height white marble piers set in from the ends of each long side, a grey precast band at the
// top and a mechanical penthouse carrying a lattice radio mast with floodlights. The ground floor is recessed under the
// overhang behind bronze diamond-lattice screens; a glazed vestibule with a bronze fascia lettered "WARNER HALL" projects
// towards Forbes Avenue.
//
// Cyert Hall (1982-83, Deeter Ritchey Sippel; the former University Computing Center): a dark brown brick block with
// continuous ribbon windows. Its Forbes Avenue side is a saw-tooth of angled bays; the ground falls ~7 m from the south
// entrance to Forbes, so the north side shows an extra storey. The west wing is a storey lower.
//
// References (for proportions only): Commons "Cmu-warner-hall.jpg" (Warner entrance panorama), "University_Center.JPG"
// (Warner's east face and mast behind Purnell), "Carnegie Mellon University as seen from the Cathedral of Learning.jpg"
// (both buildings from the west), orthophotos (roofs), CMU Archives listing (Cyert Hall dates / architect).
import {
  MeshKit, massing, makeFrame, rectLocal, groundStats, registerLandmark, ccw, ringCentroid,
} from './lib/north-kit.js';
import { plain, glz, signAtlas, signQuad, latticeScreen, marble, brickPlain } from './lib/north-materials.js';

// ------------------------------------------------------------------ Warner Hall
// OSM footprint w27574704: a 16.2 x 33.1 m rectangle, long axis NNW; local frame origin at the SW corner, n → north
const WF = [[-29.6, -112.7], [-45.3, -116.8], [-36.7, -148.7], [-21.0, -144.6]];
const FW = makeFrame(WF[1], [WF[2][0] - WF[1][0], WF[2][1] - WF[1][1]]);
const WE = 16.2, WN = 33.1;
const WG = 48.8;                  // ground floor level
const W_GF = 4.4, W_FH = 3.5;     // recessed ground storey, six curtain-wall storeys
const W_TOP = WG + W_GF + 6 * W_FH;   // 74.2

async function buildWarner(ctx) {
  const LOW = ctx.quality?.level === 'low';
  const kit = new MeshKit();
  const gs = groundStats(ctx, WF, 3);
  const base = gs.min - 1.0;
  const P = (e, n, y) => { const [x, z] = FW.W(e, n); return [x, y, z]; };
  const nN = [FW.N[0], 0, FW.N[1]], nE = [FW.E[0], 0, FW.E[1]];
  const nS = [-nN[0], 0, -nN[2]], nW = [-nE[0], 0, -nE[2]];
  const RS = 1.8;                 // ground-floor recess under the overhang
  const outer = rectLocal(FW, 0, WE, 0, WN);
  const gfRing = rectLocal(FW, RS, WE - RS, RS, WN - RS);
  const band0 = W_TOP, band1 = W_TOP + 1.3;

  massing(kit, [
    { ring: gfRing, y0: base, y1: WG + W_GF, wallKey: 'gfGlass', roofKey: false, vRef: WG },
    { ring: outer, y0: WG + W_GF, y1: W_TOP, wallKey: 'grid', roofKey: false, soffitKey: 'soffit', vRef: WG + W_GF },
    { ring: rectLocal(FW, -0.25, WE + 0.25, -0.25, WN + 0.25), y0: band0, y1: band1 - 0.6, wallKey: 'band', soffitKey: 'band', roofKey: 'flat', parapet: 0.6, parapetKey: 'band', copingKey: 'band', vRef: band0 },
    // mechanical penthouse (weathered concrete) and a small plant room
    { ring: rectLocal(FW, 3.2, 12.8, 15.5, 30.2), y0: band1 - 0.6, y1: band1 + 4.6, wallKey: 'pent', roofKey: 'flat', parapet: 0.3, parapetKey: 'pent', copingKey: 'band', vRef: band1 },
    { ring: rectLocal(FW, 4.5, 11.5, 5.5, 12), y0: band1 - 0.6, y1: band1 + 2.0, wallKey: 'pent', roofKey: 'flat', vRef: band1 },
  ]);

  // white marble piers set in from the ends of both long sides, full height up to the top band
  const piers = [];
  for (const n of [3.6, WN - 3.6]) {
    for (const [e, s] of [[0, -1], [WE, 1]]) {
      const [x, z] = FW.W(e + s * 0.3, n);
      kit.box('marble', x, (base + band0) / 2, z, 0.9, band0 - base, 2.3, FW.rotY, { vRef: WG, faces: { px: 1, nx: 1, pz: 1, nz: 1 } });
      piers.push([x, z]);
    }
  }
  // bronze mullion caps on the upper storeys (rhythm of the curtain wall read from a distance)
  if (!LOW) {
    for (const [e0, e1, n0, n1, nrm] of [[0, 0, 0, WN, nW], [WE, WE, 0, WN, nE], [0, WE, 0, 0, nS], [0, WE, WN, WN, nN]]) {
      const len = Math.hypot(e1 - e0, n1 - n0);
      for (let s = 3.0; s < len - 0.5; s += 3.0) {
        const t = s / len, e = e0 + (e1 - e0) * t, n = n0 + (n1 - n0) * t;
        if ((e0 === e1) && (Math.abs(n - 3.6) < 1.5 || Math.abs(n - (WN - 3.6)) < 1.5)) continue;
        const [x, z] = FW.W(e + nrm[0] * 0 + (e0 === e1 ? (e0 === 0 ? -0.08 : 0.08) : 0), n + (e0 !== e1 ? (n0 === 0 ? -0.08 : 0.08) : 0));
        kit.box('bronze', x, (WG + W_GF + W_TOP) / 2, z, e0 === e1 ? 0.16 : 0.12, W_TOP - WG - W_GF, e0 === e1 ? 0.12 : 0.16, FW.rotY);
      }
    }
  }

  // ground floor: bronze diamond-lattice screens in front of the recessed glazing (not at the entrance)
  if (!LOW) {
    const y0 = WG + 0.35, y1 = WG + 3.7;
    const scr = [
      [RS, RS, RS + 0.6, WN - RS - 0.6, nW], [WE - RS, WE - RS, RS + 0.6, WN - RS - 0.6, nE],
      [RS + 0.6, WE - RS - 0.6, RS, RS, nS], [RS + 0.6, 7.6, WN - RS, WN - RS, nN],
    ];
    for (const [e0, e1, n0, n1, nrm] of scr) {
      const off = 0.14, oe = nrm === nW ? -off : nrm === nE ? off : 0, on = nrm === nS ? -off : nrm === nN ? off : 0;
      const a = P(e0 + oe, n0 + on, y0), b = P(e1 + oe, n1 + on, y0), c = P(e1 + oe, n1 + on, y1), d = P(e0 + oe, n0 + on, y1);
      const len = Math.hypot(e1 - e0, n1 - n0);
      kit.quad('lattice', a, b, c, d, nrm, [0, 0], [len, 0], [len, y1 - y0], [0, y1 - y0]);
    }
  }
  // entrance vestibule towards Forbes with the bronze name fascia
  {
    const e0 = 8.4, e1 = 15.2, nIn = WN - RS, nOut = WN + 2.3, yT = WG + 3.3, yF = WG + 4.35;
    kit.quad('door', P(e0, nOut, base), P(e1, nOut, base), P(e1, nOut, yT), P(e0, nOut, yT), nN, [0, base - WG], [e1 - e0, base - WG], [e1 - e0, yT - WG], [0, yT - WG]);
    kit.quad('door', P(e0, nIn, base), P(e0, nOut, base), P(e0, nOut, yT), P(e0, nIn, yT), nW, [0, base - WG], [nOut - nIn, base - WG], [nOut - nIn, yT - WG], [0, yT - WG]);
    kit.quad('door', P(e1, nOut, base), P(e1, nIn, base), P(e1, nIn, yT), P(e1, nOut, yT), nE, [0, base - WG], [nOut - nIn, base - WG], [nOut - nIn, yT - WG], [0, yT - WG]);
    const [fx, fz] = FW.W((e0 + e1) / 2, (nIn + nOut + 0.2) / 2);
    kit.box('bronze', fx, (yT + yF) / 2, fz, e1 - e0 + 0.3, yF - yT, nOut + 0.2 - nIn, FW.rotY);
    kit.box('lamp', fx, yT - 0.02, fz, e1 - e0 - 0.6, 0.03, nOut - nIn - 0.6, FW.rotY, { faces: { ny: 1 } });
    for (const e of [e0, e1]) { const [x, z] = FW.W(e, nOut); kit.box('bronze', x, (base + yT) / 2, z, 0.14, yT - base, 0.14, FW.rotY); }
    if (!LOW) {
      const [sx, sz] = FW.W(e0 + (e1 - e0) * 0.58, nOut + 0.22);
      signQuad(kit, 'sign', signAtlas(ctx), 3, sx, (yT + yF) / 2 + 0.03, sz, nN, 0.62);
    }
  }
  // lattice radio mast with floodlights on the penthouse (seen above Purnell from the Cut)
  {
    const [mx, mz] = FW.W(5.2, 27.5), y0 = band1 + 4.6, y1 = y0 + (LOW ? 11 : 13.5);
    if (LOW) kit.cylinder('steel', mx, mz, y0, y1, 0.22, 0.12, 6);
    else {
      const legs = [0, 1, 2].map((k) => { const a = (k / 3) * Math.PI * 2 + 0.3; return [Math.cos(a), Math.sin(a)]; });
      const R0 = 0.75, R1 = 0.35;
      const at = (k, t) => { const r = R0 + (R1 - R0) * t; return [mx + legs[k][0] * r, y0 + (y1 - y0) * t, mz + legs[k][1] * r]; };
      for (let k = 0; k < 3; k++) {
        kit.beam('steel', at(k, 0), at(k, 1), 0.09, 0.09);
        for (let s = 0; s < 9; s++) kit.beam('steel', at(k, s / 9), at((k + 1) % 3, (s + 1) / 9), 0.045, 0.045);
      }
      for (const [t, k] of [[0.5, 0], [0.72, 1], [0.94, 2]]) {
        const p = at(k, t);
        kit.beam('steel', p, [p[0] + legs[k][0] * 0.9, p[1], p[2] + legs[k][1] * 0.9], 0.06, 0.06);
        kit.box('flood', p[0] + legs[k][0] * 1.05, p[1], p[2] + legs[k][1] * 1.05, 0.5, 0.35, 0.5, 0);
      }
      // cellular panel antennas round the penthouse parapet
      for (const [e, n] of [[3.5, 22], [3.5, 26], [12.5, 18], [12.5, 24], [8, 29.9]]) {
        const [x, z] = FW.W(e, n);
        kit.box('steel', x, band1 + 4.6 + 1.1, z, 0.35, 1.6, 0.2, FW.rotY);
      }
    }
  }

  const M = ctx.materials;
  const bronze = plain(ctx, '#5f4f3e', { roughness: 0.42, metalness: 0.6 });
  const group = kit.build({
    grid: glz(ctx, 'warnerGrid', 1.5, W_FH),
    gfGlass: glz(ctx, 'door', 1.5, 3.3),
    door: glz(ctx, 'door', 1.5, 3.3),
    lamp: glz(ctx, 'lamp'),
    flood: glz(ctx, 'lamp'),
    soffit: plain(ctx, '#b7afa3', { roughness: 0.85 }),
    band: plain(ctx, '#aeaca6', { roughness: 0.8 }),
    pent: plain(ctx, '#a69d8e', { roughness: 0.9 }),
    flat: M.get('flatRoof'),
    marble: marble(ctx),
    bronze,
    steel: plain(ctx, '#8e9296', { roughness: 0.5, metalness: 0.6 }),
    lattice: latticeScreen(ctx),
    sign: signAtlas(ctx).material,
  }, { name: 'landmark:warner' });

  ctx.colliders.addPolygon(gfRing, base, WG + W_GF, 'warner');
  ctx.colliders.addPolygon(outer, WG + W_GF, band1 + 1, 'warner');
  ctx.colliders.addPolygon(rectLocal(FW, 8.4, 15.2, WN - RS, WN + 2.3), base, WG + 4.4, 'warner');
  for (const [x, z] of piers) ctx.colliders.addBox(x, z, 0.5, 1.2, FW.rotY, base, band0, 'warner');
  const c = FW.W(WE / 2, WN / 2);
  registerLandmark(ctx, group, {
    key: 'warner', name: 'Warner Hall', nameZh: '华纳楼', osmId: 'w27574704',
    position: [c[0], W_TOP, c[1]], radius: 24, labelY: band1 + 9,
  });
  return group;
}

// ------------------------------------------------------------------ Cyert Hall
// OSM footprint w27574718 (saw-tooth north side on Forbes Avenue)
const CF = [
  [-66.6, -115.9], [-66.0, -118.1], [-91.7, -125.0], [-90.2, -130.6], [-108.0, -135.4], [-107.2, -138.6], [-115.7, -140.9],
  [-110.8, -158.9], [-102.0, -156.5], [-101.2, -159.4], [-92.4, -157.1], [-91.5, -160.1], [-82.9, -157.8], [-82.1, -160.5],
  [-73.2, -158.1], [-72.4, -161.2], [-63.9, -158.9], [-63.0, -161.9], [-52.8, -159.2], [-53.4, -156.9], [-49.9, -156.0],
  [-61.1, -114.5],
];
const CY0 = 41.6, CFH = 3.95;
const cyLv = (k) => CY0 + k * CFH;            // k = 0 lower ground (Forbes side) … roof of the east block = cyLv(4)

// half-plane clip (Sutherland–Hodgman): keep the part with sign * (x - x0) >= 0
function clipX(ring, x0, sign) {
  const out = [], inside = (p) => sign * (p[0] - x0) >= 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) { const t = (x0 - a[0]) / (b[0] - a[0]); out.push([x0, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

async function buildCyert(ctx) {
  const LOW = ctx.quality?.level === 'low';
  const kit = new MeshKit();
  const gs = groundStats(ctx, CF, 3);
  const base = gs.min - 1.0;
  const H = (x, z) => ctx.heightAt(x, z);
  const SPLIT = -92.0;
  const east = clipX(CF, SPLIT, 1), west = clipX(CF, SPLIT, -1);
  const topE = cyLv(4), topW = cyLv(3);

  // ribbon windows: a continuous dark glass strip per storey, slightly recessed, with a precast sill band
  const ribbons = (a, b, n, y0, y1, u) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 2.2) return false;
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], m = Math.min(0.9, L * 0.12), d = 0.22;
    const Pt = (s, y, off = 0) => [a[0] + dir[0] * s + n[0] * off, y, a[1] + dir[1] * s + n[2] * off];
    const W = (s0, s1, ya, yb) => { if (yb - ya > 0.01) kit.quad('brick', Pt(s0, ya), Pt(s1, ya), Pt(s1, yb), Pt(s0, yb), n, [u + s0, ya - CY0], [u + s1, ya - CY0], [u + s1, yb - CY0], [u + s0, yb - CY0]); };
    let yPrev = y0, any = false;
    for (let k = 0; k < 4; k++) {
      const yb = cyLv(k) + 1.05, yt = yb + 1.75;
      if (yb < y0 + 0.2 || yt > y1 - 0.3) continue;
      const g0 = Math.max(H(a[0], a[1]), H(b[0], b[1]));
      if (g0 > yb - 0.2) continue;
      any = true;
      W(0, L, yPrev, yb);
      W(0, m, yb, yt); W(L - m, L, yb, yt);
      kit.quad('ribbon', Pt(m, yb, -d), Pt(L - m, yb, -d), Pt(L - m, yt, -d), Pt(m, yt, -d), n, [0, 0], [L - 2 * m, 0], [L - 2 * m, 1.75], [0, 1.75]);
      kit.quad('brick', Pt(m, yt), Pt(L - m, yt), Pt(L - m, yt, -d), Pt(m, yt, -d), [0, -1, 0], [0, 0], [L, 0], [L, d], [0, d]);
      kit.quad('brick', Pt(m, yb, -d), Pt(L - m, yb, -d), Pt(L - m, yb), Pt(m, yb), [0, 1, 0], [0, 0], [L, 0], [L, d], [0, d]);
      for (const s of [m, L - m]) kit.quad('brick', Pt(s, yb), Pt(s, yb, -d), Pt(s, yt, -d), Pt(s, yt), s === m ? [dir[0], 0, dir[1]] : [-dir[0], 0, -dir[1]], [0, 0], [d, 0], [d, 1.75], [0, 1.75]);
      if (!LOW) { const c = Pt(L / 2, yb - 0.1, 0.05); kit.box('precast', c[0], c[1], c[2], L - 2 * m + 0.3, 0.2, 0.2, Math.atan2(-dir[1], dir[0])); }
      yPrev = yt;
    }
    if (!any) return false;
    W(0, L, yPrev, y1);
    return true;
  };
  massing(kit, [
    { ring: east, y0: base, y1: topE, wallKey: 'brick', roofKey: 'flat', parapet: 0.9, parapetKey: 'brick', copingKey: 'precast', vRef: CY0, win: true },
    { ring: west, y0: base, y1: topW, wallKey: 'brick', roofKey: 'flat', parapet: 0.9, parapetKey: 'brick', copingKey: 'precast', vRef: CY0, win: true },
  ], {
    wallBuilder(v, a, b, n, y0, y1, u) { return v.win ? ribbons(a, b, n, y0, y1, u) : false; },
  });
  // rooftop plant
  const plant = (x, z, w, d, h, r, y) => kit.box('plant', x, y + h / 2, z, w, h, d, r);
  plant(-78, -140, 14, 8, 2.8, 0.26, topE + 0.1);
  plant(-66, -128, 6, 5, 2.0, 0.26, topE + 0.1);
  plant(-102, -147, 8, 5, 1.8, 0.26, topW + 0.1);
  if (!LOW) plant(-61, -146, 4, 4, 1.4, 0.26, topE + 0.1);

  const M = ctx.materials;
  const group = kit.build({
    brick: brickPlain(ctx, { colors: ['#6e4c3c', '#5f4336', '#7b5645', '#684737', '#744f3f'], weights: [3, 2, 2, 3, 2], brickW: 0.2, brickH: 0.065, joint: 0.01, mortar: '#8c8176' }),
    precast: plain(ctx, '#b1aca3', { roughness: 0.8 }),
    ribbon: glz(ctx, 'cyRibbon', 1.4, 1.75),
    flat: M.get('flatRoof'),
    plant: plain(ctx, '#aeb2b4', { roughness: 0.6, metalness: 0.4 }),
  }, { name: 'landmark:cyert' });

  ctx.colliders.addPolygon(CF, base, topE + 1, 'cyert');
  const c = ringCentroid(ccw(east));
  registerLandmark(ctx, group, {
    key: 'cyert', name: 'Cyert Hall', nameZh: '赛尔特楼', osmId: 'w27574718',
    position: [c[0], topE, c[1]], radius: 32, labelY: topE + 7,
  });
  return group;
}

export default [
  { key: 'warner', name: 'Warner Hall', nameZh: '华纳楼', osmIds: ['w27574704'], build: buildWarner },
  { key: 'cyert', name: 'Cyert Hall', nameZh: '赛尔特楼', osmIds: ['w27574718'], build: buildCyert },
];
