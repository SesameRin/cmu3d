// Hamerschlag Hall (Machinery Hall, Palmer & Hornbostel, 1906–1914) — the signature silhouette at the west end of
// CMU's Mall, on the bluff above Junction Hollow. Owner: lm-mall-west.
//
// Massing follows the OSM footprint + photographs + the HABS measured drawings of the tower (HABS PA-1174):
//  - Mall front: a pedimented central pavilion in cream cast stone with an enormous ceremonial entrance arch
//    (after Alberti's S. Andrea in Mantua; the porch vault is Guastavino tile), reached by a broad granite stair
//    and terrace. Flanking it, LOW one-storey wings with tall round-arched windows under hipped pale grey-green
//    metal roofs with green-copper eaves. From the Mall the building is not tall at all.
//  - Behind the pavilion the long central machinery hall runs back under one pitched roof to the tall west range,
//    which faces Junction Hollow (the ground drops, so it shows extra storeys toward the ravine).
//  - "The crown": on the Mall axis directly above the west facade's central bay, a chamfered-square tower block
//    (big arched window to the Hollow) carries a chamfered-square base room, then a circular Temple-of-Vesta
//    arcade of 12 bays wrapped round the real smokestack, with a helical stair winding up round the brick flue,
//    an entablature with a railed gallery, and the chimney-top drum.
import * as THREE from 'three';
import {
  createFrame, Kit, wallFrame, facade, parapet, roofDeck, hipRoof, column, annulus, cylinder, wbox, wrect,
  warchPanel, warchRing, wglass, stairFlight, inscription, tallBay, chamferRect, settleMallWest,
} from './lib/mallWest-kit.js';
import { buildingById, buildingLevels } from '../core/placement.js';

const OSM = 'w27551077';
const NAME = 'Hamerschlag Hall', NAME_ZH = '哈默施拉格楼';

export default [
  {
    key: 'hamerschlag',
    name: NAME,
    nameZh: NAME_ZH,
    osmIds: [OSM],
    async build(ctx) {
      try { return buildHamerschlag(ctx); } finally { settleMallWest(ctx, 'hamerschlag'); }
    },
  },
];

// Helical curve for the crown's stair handrail
class Helix extends THREE.Curve {
  constructor(cx, cz, r, y0, y1, a0, turns) { super(); Object.assign(this, { cx, cz, r, y0, y1, a0, turns }); }
  getPoint(t, target = new THREE.Vector3()) {
    const a = this.a0 + t * this.turns * Math.PI * 2;
    return target.set(this.cx + Math.cos(a) * this.r, this.y0 + (this.y1 - this.y0) * t, this.cz + Math.sin(a) * this.r);
  }
}

// Walls on the edges of a ring; fn(W, i) → facade spec | spec[] | null (skip)
function ringFacades(K, ring, fn) {
  for (let i = 0; i < ring.length; i++) {
    const W = wallFrame(ring[i], ring[(i + 1) % ring.length]);
    const r = fn(W, i);
    if (!r) continue;
    for (const s of Array.isArray(r) ? r : [r]) facade(K, W, s);
  }
}

export function buildHamerschlag(ctx) {
  const F = createFrame(ctx);
  const K = new Kit(ctx, F);
  const low = K.low; // reduced-detail build at low quality (fewer arc segments, less small ornament)
  const group = F.group('landmark:hamerschlag');
  const rec = buildingById(ctx.data, OSM);
  const ground = F.ground;

  // ------------------------------------------------------------------ plan (local u toward the Mall, v south)
  const AX = 0.2;                                       // Mall axis
  const PV0 = -10.7, PV1 = 11.1, PU = 3.7;              // Mall pavilion (projects 3.7 m from the wings)
  const NWG = { u0: -41.5, u1: 0, v0: -18.7, v1: PV0 }; // north Mall wing (one storey)
  const SWG = { u0: -35.8, u1: 0, v0: PV1, v1: 18.9 };  // south Mall wing (one storey)
  const HALL = { u0: -40.2, u1: 0, v0: PV0, v1: PV1 };  // central machinery hall behind the pavilion
  const TB = { u0: -57, u1: -37.2, v0: PV0, v1: PV1, c: 3.0 }; // tower block = the west facade's central bay
  const TC = [(TB.u0 + TB.u1) / 2, AX];                 // tower axis (≈ 10 m inside the west face)
  const WRN = { u0: -52.3, u1: -41.5, v0: -37.9, v1: PV0 }; // west range, north half (toward Scott Hall)
  const WRS = { u0: -52.3, u1: -35.8, v0: PV1, v1: 37.4 };  // west range, south half
  const TD = 8.2;                                       // front edge of the Mall terrace (u)

  // ------------------------------------------------------------------ levels
  let gFront = -Infinity;
  for (let u = -2; u <= TD + 4; u += 2) for (let v = -19; v <= 19; v += 2) gFront = Math.max(gFront, ground(u, v));
  const E = gFront + 0.95;                   // ground floor = terrace level, a short flight above the Mall lawn
  const lowest = rec ? Math.min(rec.ground.min, buildingLevels(rec).groundY) : E - 10;
  const BOTTOM = lowest - 1.6;
  const WC = E + 6.6, WTOP = E + 7.15;        // Mall wings: cornice, wall top
  const CORN = E + 12.1, YP = E + 12.9;       // pavilion + hall: cornice, pediment base / hall eave
  const WRC = E + 12.2, WRTOP = E + 12.8;     // west range
  const TBC = E + 16.4, PLAT = E + 17.3;      // tower block: cornice, platform deck
  const PITCH_W = 0.45, OVER_W = 0.7;         // wing / range roofs
  const SLOPE = 0.47, OV = 0.65;              // pediment + hall roof

  const below = (w = 2.0) => [
    { y0: E - 13.8, y1: E - 9.2, kind: 'rect', w, sill: 1.1, head: 0.9, trim: 'simple' },
    { y0: E - 9.2, y1: E - 4.6, kind: 'rect', w, sill: 1.1, head: 0.9, trim: 'simple' },
    { y0: E - 4.6, y1: E, kind: 'rect', w, sill: 1.0, head: 0.8, trim: 'simple' },
  ];
  const waterTable = { y: E - 0.15, h: 0.4, proj: 0.12, mat: 'granite' };

  // ------------------------------------------------------------------ Mall wings: one tall storey of arched windows
  const wingSpec = (extra = {}) => ({
    bottom: BOTTOM, top: WTOP, ground, bay: 3.4, end: 1.2, depth: 0.42,
    tiers: [...below(), { y0: E, y1: WC, kind: 'arch', w: 2.1, sill: 1.2, head: 0.5 }],
    belts: [waterTable], cornice: { y: WC, layers: [[0.25, 0.1], [0.3, 0.32]] }, plinth: { h: 0.9, proj: 0.1 },
    ...extra,
  });
  const rectRing = (r) => [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]];
  ringFacades(K, rectRing(NWG), (W, i) => (i === 0 || i === 1 ? wingSpec() : null));   // north + Mall faces
  ringFacades(K, rectRing(SWG), (W, i) => (i === 1 || i === 2 ? wingSpec() : null));   // Mall + south faces
  const wingRoof = { y: WTOP + OVER_W * PITCH_W, pitch: PITCH_W, over: OVER_W, axis: 'u', brackets: 1.1 };
  hipRoof(K, { ...wingRoof, u0: NWG.u0, u1: NWG.u1, v0: NWG.v0, v1: NWG.v1, ends: ['none', 'hip'], bracketSides: [true, false] });
  hipRoof(K, { ...wingRoof, u0: SWG.u0, u1: SWG.u1, v0: SWG.v0, v1: SWG.v1, ends: ['none', 'hip'], bracketSides: [false, true] });

  // ------------------------------------------------------------------ central hall: clerestory above the wing roofs
  {
    const spec = {
      bottom: WTOP - 0.25, top: YP, bay: 4.2, end: 1.2, depth: 0.35,
      tiers: [{ y0: E + 7.6, y1: CORN, kind: 'arch', w: 1.8, sill: 0.5, head: 0.45 }],
      cornice: { y: CORN, layers: [[0.35, 0.12], [0.45, 0.45]] },
    };
    facade(K, wallFrame([HALL.u0, PV0], [0, PV0]), spec);                  // north side (whole length)
    facade(K, wallFrame([0, PV1], [WRS.u1, PV1]), spec);                    // south side, east of the west range
    hipRoof(K, { u0: HALL.u0, u1: PU, v0: PV0, v1: PV1, y: YP + OV * SLOPE, pitch: SLOPE, over: OV, axis: 'u', ends: ['hip', 'none'] });
  }

  // ------------------------------------------------------------------ Mall pavilion: S. Andrea arch + pediment
  {
    const W = wallFrame([PU, PV0], [PU, PV1]);    // faces the Mall (+u)
    const Lp = W.L, sc = Lp / 2;                  // 21.8 m wide, axis at sc
    const AW = 7.6, aL = sc - AW / 2, aR = sc + AW / 2, AR = AW / 2;
    const SPR = E + 7.0;                          // springing of the great arch (crown E+10.8)
    const DEPTH = 3.4;                            // depth of the vaulted entrance porch
    const EI = E + 1.05;                          // door level inside the porch (steps up under the arch)
    const wall = K.m('floodStone'), stone = K.m('stone'), trim = K.m('trim');
    // smooth cast-stone front: plain bays either side of the arch, wall above the arch, base below grade
    wrect(wall, W, 0, aL, BOTTOM, YP);
    wrect(wall, W, aR, Lp, BOTTOM, YP);
    warchPanel(wall, W, aL, aR, SPR, YP, 0, 18);
    wrect(wall, W, aL, aR, BOTTOM, E);
    wbox(K.m('granite'), W, -0.1, aL, BOTTOM, E + 0.25, -0.03, 0.14, ['-y']);   // granite base course
    wbox(K.m('granite'), W, aR, Lp + 0.1, BOTTOM, E + 0.25, -0.03, 0.14, ['-y']);
    // giant pilasters on pedestals (paired rhythm of the S. Andrea front) with recessed panels between
    const pil = [1.0, aL - 1.1, aR + 1.1, Lp - 1.0];
    for (const s of pil) {
      wbox(stone, W, s - 0.8, s + 0.8, E - 0.2, E + 1.3, -0.02, 0.5, ['-y']);         // pedestal
      wbox(trim, W, s - 0.85, s + 0.85, E + 1.3, E + 1.5, -0.02, 0.55);               // pedestal cap
      wbox(wall, W, s - 0.62, s + 0.62, E + 1.5, E + 10.6, -0.02, 0.32);              // shaft
      wbox(trim, W, s - 0.72, s + 0.72, E + 1.5, E + 1.8, -0.02, 0.38);               // base
      wbox(trim, W, s - 0.75, s + 0.75, E + 10.6, E + 11.3, -0.02, 0.46);             // capital
    }
    for (const [a, b] of [[pil[0] + 0.62, pil[1] - 0.62], [pil[2] + 0.62, pil[3] - 0.62]]) {
      const p0 = a + 0.4, p1 = b - 0.4;
      for (const [y0, y1] of [[E + 2.3, E + 8.4], [E + 8.9, E + 10.5]]) {           // tall + small panel
        wbox(trim, W, p0, p1, y0, y0 + 0.12, -0.02, 0.06);
        wbox(trim, W, p0, p1, y1 - 0.12, y1, -0.02, 0.06);
        wbox(trim, W, p0, p0 + 0.12, y0, y1, -0.02, 0.06);
        wbox(trim, W, p1 - 0.12, p1, y0, y1, -0.02, 0.06);
      }
    }
    // entablature + cornice across the pavilion (green-copper top member, as on the real building)
    wbox(trim, W, -0.2, Lp + 0.2, E + 11.3, CORN, -0.02, 0.4);
    wbox(trim, W, -0.35, Lp + 0.35, CORN, CORN + 0.35, -0.03, 0.55);
    wbox(K.m('verdigris'), W, -0.5, Lp + 0.5, CORN + 0.35, YP, -0.03, 0.8);
    // porch: tile-lined jambs, Guastavino barrel vault, steps up to the doors, back wall with the great window
    const t = W.t, nt = [-t[0], 0, -t[2]];
    const gv = K.m('guastavino');
    gv.quadN(W.P(aL, E, 0), W.P(aL, E, -DEPTH), W.P(aL, SPR, -DEPTH), W.P(aL, SPR, 0), t);
    gv.quadN(W.P(aR, E, 0), W.P(aR, SPR, 0), W.P(aR, SPR, -DEPTH), W.P(aR, E, -DEPTH), nt);
    const SEG = low ? 10 : 20;
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI, a1 = ((i + 1) / SEG) * Math.PI, am = (a0 + a1) / 2;
      const p = (a, d) => W.P(sc + Math.cos(a) * AR, SPR + Math.sin(a) * AR, d);
      const inward = [-t[0] * Math.cos(am), -Math.sin(am), -t[2] * Math.cos(am)];
      gv.quadN(p(a0, 0), p(a1, 0), p(a1, -DEPTH), p(a0, -DEPTH), inward);
    }
    // coffer ribs across the vault
    for (const d of [-0.9, -1.7, -2.5]) {
      for (let i = 0; i < SEG; i++) {
        const a0 = (i / SEG) * Math.PI, a1 = ((i + 1) / SEG) * Math.PI;
        const q = (a, r, dd) => W.P(sc + Math.cos(a) * r, SPR + Math.sin(a) * r, dd);
        const am = (a0 + a1) / 2, inward = [-t[0] * Math.cos(am), -Math.sin(am), -t[2] * Math.cos(am)];
        stone.quadN(q(a0, AR - 0.12, d - 0.14), q(a1, AR - 0.12, d - 0.14), q(a1, AR - 0.12, d + 0.14), q(a0, AR - 0.12, d + 0.14), inward);
      }
    }
    stairFlight(K, W.plan(sc, 0), W.plan(sc, -1.9), E, EI, AW - 0.05, { cheek: null });
    wbox(K.m('step'), W, aL, aR, E - 0.6, EI, -DEPTH, -1.9, ['-y']);
    const back = -DEPTH;
    const doorW = 1.8, gap = (AW - 3 * doorW) / 4;
    for (let k = 0; k < 3; k++) {
      const s0 = aL + gap + k * (doorW + gap);
      wbox(K.m('door'), W, s0, s0 + doorW, EI, EI + 3.2, back, back + 0.1);
      wbox(K.m('metal'), W, s0 + doorW / 2 - 0.03, s0 + doorW / 2 + 0.03, EI, EI + 3.2, back, back + 0.14);
      wrect(gv, W, s0 - gap, s0, EI, EI + 3.2, back);
    }
    wrect(gv, W, aR - gap, aR, EI, EI + 3.2, back);
    wrect(gv, W, aL, aR, E, EI, back);
    wbox(stone, W, aL, aR, EI + 3.2, EI + 4.0, back, back + 0.25);
    wglass(K.m('glass'), W, aL, aR, EI + 4.0, SPR + AR, true, back, 2, 24);
    for (const f of [1 / 3, 2 / 3]) {
      const s = aL + AW * f, yTop = SPR + Math.sqrt(Math.max(0, AR * AR - (s - sc) ** 2));
      wbox(stone, W, s - 0.14, s + 0.14, EI + 4.0, yTop, back, back + 0.22);
    }
    wbox(stone, W, aL, aR, SPR - 0.1, SPR + 0.1, back, back + 0.22);
    // archivolt, impost blocks, keystone (up into the architrave, as on the real front)
    warchRing(stone, W, sc, SPR, AR, AR + 0.55, -0.02, 0.28, 24);
    warchRing(trim, W, sc, SPR, AR + 0.55, AR + 0.72, -0.02, 0.16, 24);
    wbox(stone, W, aL - 0.5, aL + 0.1, SPR - 0.5, SPR, -0.02, 0.32);
    wbox(stone, W, aR - 0.1, aR + 0.5, SPR - 0.5, SPR, -0.02, 0.32);
    wbox(stone, W, sc - 0.5, sc + 0.5, SPR + AR - 0.2, E + 11.3, -0.02, 0.45);
    // bronze lanterns either side of the great arch
    for (const s of [aL - 0.45, aR + 0.45]) {
      const [u, v] = W.plan(s, 0.55);
      K.m('metal').para(W.P(s - 0.05, E + 5.35, 0), [W.t[0] * 0.1, 0, W.t[2] * 0.1], [0, 0.1, 0], [W.n[0] * 0.55, 0, W.n[2] * 0.55]);
      K.m('lamp').box(u - 0.2, E + 4.6, v - 0.2, u + 0.2, E + 5.3, v + 0.2);
      K.m('metal').box(u - 0.26, E + 5.3, v - 0.26, u + 0.26, E + 5.42, v + 0.26);
    }
    // pediment: tympanum with the carved name panel, green-copper raking cornices, acroterion
    const half = sc + OV;
    const apex = YP + half * SLOPE;
    const yRake = (s) => YP + (half - Math.abs(s - sc)) * SLOPE;
    wall.poly([W.P(0, YP, 0), W.P(Lp, YP, 0), W.P(Lp, yRake(Lp), 0), W.P(sc, yRake(sc), 0), W.P(0, yRake(0), 0)], W.n);
    const rake = (sA, sB) => {
      const yA = yRake(sA), yB = yRake(sB);
      const o = W.P(sA, yA - 0.05, -0.4);
      const ex = [W.t[0] * (sB - sA), yB - yA, W.t[2] * (sB - sA)];
      K.m('verdigris').para(o, ex, [0, 0.6, 0], [W.n[0] * 1.2, 0, W.n[2] * 1.2]);
    };
    rake(-OV, sc); rake(sc, Lp + OV);
    wbox(stone, W, sc - 4.8, sc + 4.8, YP + 0.7, YP + 2.0, -0.02, 0.08);
    inscription(K, W, sc - 4.6, sc + 4.6, YP + 0.8, YP + 1.9, 0.09, 0);
    stone.box(PU - 1.2, apex + 0.45, AX - 0.45, PU + 0.1, apex + 1.35, AX + 0.45);
    // pavilion returns (side faces of the 3.7 m projection) up to the pediment
    for (const [a, b] of [[[0, PV0], [PU, PV0]], [[PU, PV1], [0, PV1]]]) {
      const Wr = wallFrame(a, b);
      wrect(wall, Wr, 0, Wr.L, BOTTOM, YP);
      wbox(trim, Wr, 0, Wr.L + 0.2, E + 11.3, CORN, -0.02, 0.4);
      wbox(trim, Wr, 0, Wr.L + 0.35, CORN, CORN + 0.35, -0.03, 0.55);
      wbox(K.m('verdigris'), Wr, 0, Wr.L + 0.5, CORN + 0.35, YP, -0.03, 0.8);
      wbox(K.m('granite'), Wr, 0, Wr.L + 0.1, BOTTOM, E + 0.25, -0.03, 0.14, ['-y']);
    }
  }

  // ------------------------------------------------------------------ Mall terrace + broad granite stair on the axis
  const colliders = [];   // [u, v, halfU, halfV, yMin, yMax]
  {
    const V0 = NWG.v0, V1 = SWG.v1, SW = 12;               // terrace width = the whole front; stair 12 m wide
    const gT = Math.min(ground(TD, V0), ground(TD, V1), ground(TD, AX), ground(0, V0), ground(0, V1)) - 0.8;
    K.m('paver').quadN([0, E, V0], [TD, E, V0], [TD, E, V1], [0, E, V1], [0, 1, 0]);
    const gran = K.m('granite');
    // front retaining wall + low parapet either side of the stair; end walls
    const pH = 0.65;
    for (const [va, vb] of [[V0, AX - SW / 2], [AX + SW / 2, V1]]) {
      gran.box(TD - 0.5, gT, va, TD, E + pH, vb, ['-y']);
      K.m('trim').box(TD - 0.58, E + pH, va - 0.05, TD + 0.08, E + pH + 0.12, vb + 0.05);
      colliders.push([TD - 0.25, (va + vb) / 2, 0.25, (vb - va) / 2, gT, E + pH + 0.1]);
    }
    for (const [va, vb] of [[V0 - 0.5, V0], [V1, V1 + 0.5]]) {
      gran.box(0, gT, va, TD, E + pH, vb, ['-y']);
      K.m('trim').box(-0.05, E + pH, va - 0.05, TD + 0.08, E + pH + 0.12, vb + 0.05);
      colliders.push([TD / 2, (va + vb) / 2, TD / 2, 0.25, gT, E + pH + 0.1]);
    }
    const gS = ground(TD + 2.5, AX);
    const n = Math.max(1, Math.round((E - gS) / 0.16)), run = n * 0.34;
    stairFlight(K, [TD + run, AX], [TD, AX], ground(TD + run, AX), E, SW, { ground, cheekH: 0.55, cheek: 'granite' });
    // the two bronze lanterns at the head of the stair
    for (const sg of [-1, 1]) {
      const u = TD - 0.25, v = AX + sg * (SW / 2 + 0.25);
      K.m('granite').box(u - 0.35, E + pH, v - 0.35, u + 0.35, E + pH + 0.5, v + 0.35, ['-y']);
      cylinder(K.m('metal'), u, E + pH + 0.5, v, 0.08, 2.4, { seg: 8 });
      K.m('lamp').box(u - 0.22, E + pH + 2.9, v - 0.22, u + 0.22, E + pH + 3.5, v + 0.22);
      K.m('metal').box(u - 0.28, E + pH + 3.5, v - 0.28, u + 0.28, E + pH + 3.62, v + 0.28);
    }
  }

  // ------------------------------------------------------------------ west range (faces Junction Hollow)
  {
    const tiersWest = [
      ...below(2.1),
      { y0: E, y1: E + 5.6, kind: 'rect', w: 2.1, sill: 1.0, head: 0.8 },
      { y0: E + 5.6, y1: WRC, kind: 'arch', w: 2.4, sill: 0.9, head: 0.6 },
    ];
    const westSpec = (extra = {}) => ({
      bottom: BOTTOM, top: WRTOP, tiers: tiersWest, bay: 4.0, end: 1.3, depth: 0.42, ground,
      pilasters: { y0: E + 5.8, y1: WRC, w: 0.75, proj: 0.14, ends: true },
      belts: [waterTable, { y: E + 5.5, h: 0.35, proj: 0.13 }],
      cornice: { y: WRC, layers: [[0.3, 0.1], [0.3, 0.3]] }, plinth: { h: 0.9, proj: 0.1 },
      ...extra,
    });
    // parts of the inner faces hidden behind the one-storey Mall wings get no openings
    const hiddenBy = (wing, W) => (i, T, sc) => {
      const v = W.plan(sc)[1];
      if (v > Math.min(wing.v0, wing.v1) - 0.5 && v < Math.max(wing.v0, wing.v1) + 0.5 && T.y0 < WTOP + 0.5) return 'blank';
      return undefined;
    };
    ringFacades(K, rectRing(WRN), (W, i) => {
      if (i === 2) return null;                                   // against the tower block
      if (i === 1) return westSpec({ override: hiddenBy(NWG, W) });
      return westSpec();
    });
    ringFacades(K, rectRing(WRS), (W, i) => {
      if (i === 0) return null;                                   // against the tower block / hall
      if (i === 1) return westSpec({ override: hiddenBy(SWG, W) });
      return westSpec();
    });
    const rr = { y: WRTOP + OVER_W * 0.4, pitch: 0.4, over: OVER_W, axis: 'v', brackets: 1.1 };
    hipRoof(K, { ...rr, u0: WRN.u0, u1: WRN.u1, v0: WRN.v0, v1: WRN.v1, ends: ['hip', 'none'] });
    hipRoof(K, { ...rr, u0: WRS.u0, u1: WRS.u1, v0: WRS.v0, v1: WRS.v1, ends: ['gable', 'hip'] });
  }

  // ------------------------------------------------------------------ tower block (west central bay) + platform
  const tbRing = chamferRect(TB.u0, TB.u1, TB.v0, TB.v1, TB.c);
  for (let i = 0; i < tbRing.length; i++) {
    const W = wallFrame(tbRing[i], tbRing[(i + 1) % tbRing.length]);
    const cornice = { y: TBC, layers: [[0.3, 0.1], [0.4, 0.25], [0.35, 0.55]] };
    if (i === 6) {
      // west face to the Hollow: one great arched window through the upper storeys
      tallBay(K, W, { s0: 0, s1: W.L, bottom: BOTTOM, top: TBC, yb: E + 2.4, yt: E + 15.2, w: 6.2, spandrels: [E + 6.4, E + 10.6], mullions: 2, depth: 0.55 });
      facade(K, W, { bottom: TBC, top: PLAT + 0.9, tiers: [], bays: 0, cornice });
      wbox(K.m('granite'), W, -0.1, W.L + 0.1, BOTTOM, E + 0.25, -0.03, 0.14, ['-y']);
    } else {
      // the other faces rise out of the surrounding roofs as a plain pedestal for the crown
      facade(K, W, { bottom: BOTTOM, top: PLAT + 0.9, ground, tiers: [], bays: 0, belts: [waterTable], cornice });
    }
    parapet(K, W, PLAT, PLAT + 0.9);
  }
  roofDeck(K, tbRing, PLAT, 'lead');

  // ------------------------------------------------------------------ the crown (HABS PA-1174)
  let crownTop;
  {
    const [CX, CZ] = TC;
    const trim = K.m('trim');
    // chamfered-square base room (46 ft) with small windows, carved frieze and cornice
    const BRT = PLAT + 3.7;
    const brRing = chamferRect(CX - 7, CX + 7, CZ - 7, CZ + 7, 2.2);
    ringFacades(K, brRing, () => ({
      bottom: PLAT - 0.05, top: BRT, bay: 2.6, end: 0.8, depth: 0.25,
      tiers: [{ y0: PLAT, y1: PLAT + 2.5, kind: 'rect', w: 1.0, sill: 0.8, head: 0.4, trim: 'simple' }],
      belts: [{ y: PLAT + 2.5, h: 0.6, proj: 0.05, mat: 'stone' }],
      cornice: { y: PLAT + 3.1, layers: [[0.25, 0.12], [0.35, 0.42]] },
    }));
    roofDeck(K, brRing, BRT, 'lead');
    // stylobate
    annulus(trim, { cx: CX, cz: CZ, r0: 0, r1: 5.45, y0: BRT, y1: BRT + 0.35, seg: 48, faces: { bottom: false } });
    annulus(K.m('brick'), { cx: CX, cz: CZ, r0: 0, r1: 5.15, y0: BRT + 0.35, y1: BRT + 1.0, seg: 48, faces: { bottom: false } });
    annulus(K.m('step'), { cx: CX, cz: CZ, r0: 0, r1: 5.05, y0: BRT + 1.0, y1: BRT + 1.2, seg: 48, faces: { bottom: false } });
    const YC = BRT + 1.2, YE = YC + 6.6;
    // Temple-of-Vesta arcade: 12 tall round-arched openings between piers with engaged columns
    const RO = 4.95, RI = 4.35;
    const po = (a, r) => [CX + Math.cos(a) * r, CZ + Math.sin(a) * r];
    const arcade = (trimKind) => [{ y0: YC, y1: YE, kind: 'arch', w: 1.5, sill: 0.05, head: 0.45, trim: trimKind }];
    for (let k = 0; k < 12; k++) {
      const a0 = ((15 + k * 30) * Math.PI) / 180, a1 = a0 + Math.PI / 6;
      facade(K, wallFrame(po(a0, RO), po(a1, RO)), {
        bottom: YC, top: YE, tiers: arcade('simple'), bays: 1, end: 0.12, depth: RO - RI, noGlass: true,
        mats: { wall: 'glowStone', reveal: 'glowStone', arch: 'trim' },
      });
      facade(K, wallFrame(po(a1, RI), po(a0, RI)), {
        bottom: YC, top: YE, tiers: arcade('none'), bays: 1, end: 0.02, depth: 0, noGlass: true, mats: { wall: 'glowStone' },
      });
      const [x, z] = po(a0, RO + 0.1);
      column(K, x, YC, z, { r: 0.26, h: YE - YC - 0.05, order: 'corinthian', shaft: 'glowStone', cap: 'trim' });
      // small uplight at each pier (glows at night; too small to matter at low quality)
      if (low) continue;
      const [lx, lz] = po(a0 + Math.PI / 12, RI - 0.45);
      K.m('lamp').box(lx - 0.14, YC, lz - 0.14, lx + 0.14, YC + 0.16, lz + 0.14);
    }
    // the smokestack itself: floodlit brick flue inside the arcade
    cylinder(K.m('glow'), CX, YC, CZ, 2.0, YE + 2.2 - YC, { seg: 24, capped: false });
    // helical stair around the flue (≈1.5 turns)
    const steps = 40, turns = 1.5, rIn = 2.05, rOut = 3.5, rise = (YE - YC - 0.6) / steps;
    const st = K.m('stone');
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * turns * Math.PI * 2;
      const y = YC + (i + 1) * rise;
      const m = new THREE.Matrix4().makeRotationY(-a).setPosition(CX + Math.cos(a) * ((rIn + rOut) / 2), y - 0.14, CZ + Math.sin(a) * ((rIn + rOut) / 2));
      st.geometry(new THREE.BoxGeometry(rOut - rIn, 0.28, 0.72), m);
      if (!low && i % 2 === 0) {
        const mb = new THREE.Matrix4().makeRotationY(-a).setPosition(CX + Math.cos(a) * (rOut - 0.06), y + 0.47, CZ + Math.sin(a) * (rOut - 0.06));
        K.m('metal').geometry(new THREE.BoxGeometry(0.04, 0.94, 0.04), mb, { flat: true });
      }
    }
    const rail = new THREE.TubeGeometry(new Helix(CX, CZ, rOut - 0.06, YC + rise + 0.95, YC + steps * rise + 0.95, 0, turns), low ? 40 : 96, 0.035, low ? 3 : 5, false);
    K.m('metal').geometry(rail, new THREE.Matrix4());
    rail.dispose();
    // entablature: architrave, ornamented frieze, cornice; gallery deck with railing
    annulus(trim, { cx: CX, cz: CZ, r0: 4.25, r1: 5.2, y0: YE, y1: YE + 0.55, seg: 48 });
    annulus(K.m('glowStone'), { cx: CX, cz: CZ, r0: 4.3, r1: 5.05, y0: YE + 0.55, y1: YE + 1.4, seg: 48, faces: { bottom: false, top: false } });
    for (let k = 0; k < 24; k += low ? 2 : 1) {
      const a = (k / 24) * Math.PI * 2;
      const m = new THREE.Matrix4().makeRotationY(-a).setPosition(CX + Math.cos(a) * 5.08, YE + 0.97, CZ + Math.sin(a) * 5.08);
      trim.geometry(new THREE.BoxGeometry(0.1, 0.55, 0.36), m);
    }
    annulus(trim, { cx: CX, cz: CZ, r0: 4.2, r1: 5.45, y0: YE + 1.4, y1: YE + 1.85, seg: 48 });
    annulus(K.m('lead'), { cx: CX, cz: CZ, r0: 2.55, r1: 5.3, y0: YE + 1.85, y1: YE + 1.95, seg: 48, faces: { inner: false, outer: false, bottom: false } });
    for (let k = 0; k < 36; k += low ? 3 : 1) {
      const a = (k / 36) * Math.PI * 2;
      const x = CX + Math.cos(a) * 5.12, z = CZ + Math.sin(a) * 5.12;
      K.m('metal').box(x - 0.03, YE + 1.95, z - 0.03, x + 0.03, YE + 2.85, z + 0.03, ['-y', '+y']);
    }
    annulus(K.m('metal'), { cx: CX, cz: CZ, r0: 5.07, r1: 5.17, y0: YE + 2.82, y1: YE + 2.9, seg: 48 });
    // chimney-top drum
    annulus(K.m('brick'), { cx: CX, cz: CZ, r0: 2.0, r1: 2.55, y0: YE + 1.85, y1: YE + 3.95, seg: 32, faces: { bottom: false, inner: false } });
    annulus(trim, { cx: CX, cz: CZ, r0: 2.5, r1: 2.72, y0: YE + 2.55, y1: YE + 2.75, seg: 32, faces: { inner: false } });
    annulus(trim, { cx: CX, cz: CZ, r0: 2.45, r1: 2.9, y0: YE + 3.75, y1: YE + 4.15, seg: 32, faces: { inner: false } });
    annulus(K.m('brickDark'), { cx: CX, cz: CZ, r0: 1.7, r1: 2.7, y0: YE + 4.15, y1: YE + 4.4, seg: 32 });
    annulus(K.m('metal'), { cx: CX, cz: CZ, r0: 0, r1: 1.7, y0: YE + 4.2, y1: YE + 4.3, seg: 24, faces: { bottom: false, outer: false } });
    crownTop = YE + 4.4;
  }

  // ------------------------------------------------------------------ finish: batch, colliders, pick, label
  const [wx, wz] = F.toWorld(-22, AX);
  const entry = {
    key: 'hamerschlag', kind: 'landmark', name: NAME, nameZh: NAME_ZH, osmId: OSM, infoKey: OSM,
    position: [wx, E + 12, wz], radius: 48,
  };
  K.commit(group, entry, { walkKeys: ['paver', 'step'] });
  if (rec) ctx.colliders.addPolygon(rec.footprint, BOTTOM, E + 19, OSM);
  for (const [u, v, hu, hv, y0, y1] of colliders) {
    const [x, z] = F.toWorld(u, v);
    ctx.colliders.addBox(x, z, hu, hv, -F.angle, y0, y1, 'hamerschlag-terrace');
  }
  {
    const [x, z] = F.toWorld(...TC);
    ctx.colliders.addCircle(x, z, 7.2, PLAT, crownTop, OSM);
  }
  ctx.pick.add(group, entry);
  const [lx, lz] = F.toWorld(...TC);
  ctx.labels.add({ key: 'landmark:hamerschlag', text: NAME, textZh: NAME_ZH, kind: 'landmark', priority: 9, osmId: OSM, infoKey: OSM, position: { x: lx, y: crownTop + 5, z: lz } });
  return group;
}
