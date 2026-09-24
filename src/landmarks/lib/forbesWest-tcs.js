// TCS Hall (Bohlin Cywinski Jackson, 2020), 4665 Forbes Avenue — the western gateway to campus on the north side of
// Forbes, above Junction Hollow.
//
// From the architects' photographs: toward Forbes a glazed "lantern" of three storeys framed in dark mullions with
// dark spandrel bands, cantilevered over a recessed glass lobby on round columns and crowned by a big asymmetric
// gable whose white soffit overhangs the top-floor glass; beside it a dark slate-tile pier carrying the
// "TCS HALL" name, a dark-brown brick stair tower and a glazed entrance under a thin white canopy. The long east
// (Hollow) and west faces are buff "Norman" brick laid in vertical panels of two tones, pierced by storey-high
// windows in dark surrounds that shift from floor to floor; a recessed top storey of ribbed aluminium sits under a
// thin white roof slab. The site falls to the east, where a lower (parking) level appears.
import { massing } from './north-kit.js';
import { glz, cellUV, brickPlain, metalPanels } from './north-materials.js';
import {
  MeshKit, prng, planFrame, edgeInfo, openingWall, insetRing, ringGroundStats, registerForbes, groundMinAlong,
} from './forbesWest-kit.js';
import { tcsBrick, slateTile, ribbedAlu, plainMat, signMat } from './forbesWest-materials.js';

export const TCS_OSM = 'w946491335';

const F = planFrame([-358, -215], [28.7, -1.2]);        // u ≈ east, v ≈ south (Forbes side = +v)
const loc = (pts) => pts.map(([u, v]) => F.W(u, v));
const MAIN_L = [[-12.59, -35.09], [16.15, -35.03], [16.21, -14.33], [15.36, -14.31], [15.1, -9.71], [16.2, -5.0], [16.34, 19.5],
  [12.02, 19.5], [12.02, 26.24], [-2.2, 26.3], [-2.2, 21.33], [-12.08, 21.3], [-12.06, 23.1], [-19.27, 24.47], [-16.46, 4.88],
  [-16.41, -15.79], [-13.9, -15.83], [-13.85, -22.37], [-12.4, -22.39]];
const PIER_L = [[12.02, 19.5], [16.34, 19.5], [16.34, 26.35], [12.02, 26.24]];
const LANT_L = [[12.02, 26.24], [11.71, 36.55], [-2.78, 36.04], [-4.8, 26.3]];
const TOWER_L = [[-5.83, 21.33], [-2.2, 21.33], [-2.2, 26.3], [-4.8, 26.3]];
const FOOT_L = [[-12.59, -35.09], [16.15, -35.03], [16.21, -14.33], [15.36, -14.31], [15.1, -9.71], [16.2, -5.0], [16.34, 26.35],
  [12.02, 26.24], [11.71, 36.55], [-2.78, 36.04], [-5.83, 21.33], [-12.08, 21.3], [-12.06, 23.1], [-19.27, 24.47], [-16.46, 4.88],
  [-16.41, -15.79], [-13.9, -15.83], [-13.85, -22.37], [-12.4, -22.39]];

const L1 = 34.6;                                          // Forbes Avenue level
const lv = (n) => (n <= 1 ? L1 : L1 + 4.4 + (n - 2) * 3.9); // L2 39.0 … L5 50.7
const ROOF = lv(5) + 3.9;                                 // 54.6

export function buildTCS(ctx) {
  const low = ctx.quality?.level === 'low';
  const kit = new MeshKit();
  const rand = prng(2020);
  const FOOT = loc(FOOT_L), MAIN = loc(MAIN_L), PIER = loc(PIER_L), LANT = loc(LANT_L), TOWER = loc(TOWER_L);
  const gs = ringGroundStats(ctx, FOOT, 3);
  const base = gs.min - 1.5;
  const TOPIN = 1.3;
  const top = insetRing(MAIN, TOPIN);

  const vols = [
    { ring: FOOT, y0: base, y1: L1, wallKey: 'slate', roofKey: false, role: 'base' },
    { ring: MAIN, y0: L1, y1: lv(5), wallKey: 'brick', roofKey: 'deck', role: 'main' },
    { ring: top, y0: lv(5), y1: ROOF, wallKey: 'ribbed', roofKey: false, role: 'top' },
    { ring: PIER, y0: L1, y1: ROOF + 0.9, wallKey: 'slate', roofKey: 'slateTop', role: 'pier' },
    { ring: LANT, y0: L1, y1: ROOF, wallKey: 'lantern', roofKey: false, role: 'lantern' },
    { ring: TOWER, y0: L1, y1: ROOF - 1.6, wallKey: 'brown', roofKey: 'deck', parapet: 0.4, parapetKey: 'brown', copingKey: 'white', role: 'tower' },
  ];

  const frames = [];
  massing(kit, vols, {
    wallBuilder(v, a, b, n, y0, y1, uA, i) {
      const r = v.ring, A = r[i], B = r[(i + 1) % r.length];
      const E = edgeInfo(A, B);
      const { L, d } = edgeInfo(a, b);
      const off = Math.hypot(a[0] - A[0], a[1] - A[1]);
      const P = (s, y, o = 0) => [a[0] + d[0] * s + n[0] * o, y, a[1] + d[1] * s + n[2] * o];
      if (v.role === 'base') {
        // slate plinth; parking openings where the Hollow side falls away
        const ops = [];
        const gmin = groundMinAlong(ctx, a, b);
        if (gmin < L1 - 3.2 && !low) {
          for (let s = 3; s < E.L - 3; s += 6.5) {
            const q = { s0: s - off - 2.2, s1: s - off + 2.2, yb: Math.max(gmin + 0.4, L1 - 3.6), yt: L1 - 0.7 };
            const [gx, , gz] = P((q.s0 + q.s1) / 2, 0);
            if (ctx.heightAt(gx, gz) < q.yb - 0.2) ops.push(q);
          }
        }
        openingWall(kit, a, b, n, y0, y1, ops, { wallKey: 'slate', revealKey: 'slate', vRef: L1, uStart: uA, depth: 0.4, glassKey: 'dark' });
        return true;
      }
      if (v.role === 'lantern') return true;           // built separately below (only used to hide covered walls)
      if (v.role === 'main') {
        const mid = F.toLocal((A[0] + B[0]) / 2, (A[1] + B[1]) / 2);
        if (Math.abs(mid[1] - 21.3) < 0.4 && mid[0] > -12.3 && mid[0] < -2) {
          // glazed entrance hall + glass box between the brick tower and the west block
          kit.quad('glassDark', P(0, y0), P(L, y0), P(L, y1), P(0, y1), n, [uA, y0 - L1], [uA + L, y0 - L1], [uA + L, y1 - L1], [uA, y1 - L1]);
          return true;
        }
        // buff brick, storey-high windows in dark surrounds shifting from floor to floor
        const ops = [];
        const bay = 3.0;
        const nb = Math.floor((E.L - 1.8) / bay);
        const slot = E.L > 40 ? Math.floor(nb * (E.n[0] > 0 ? 0.62 : 0.35)) : -1;   // tall glass slot
        for (let k = 0; k < nb; k++) {
          const c = E.L / 2 + (k - (nb - 1) / 2) * bay;
          if (k === slot) {
            ops.push({ s0: c - off - 1.7, s1: c - off + 1.7, yb: lv(3) - 0.1, yt: lv(5) - 0.5, slot: true });
            for (const f of [1, 2]) ops.push({ s0: c - off - 0.7, s1: c - off + 0.7, yb: lv(f) + 0.7, yt: lv(f + 1) - 0.8 });
            continue;
          }
          for (let f = 1; f <= 4; f++) {
            const shift = ((k + f) % 2 ? 0.55 : -0.55);
            const w = rand() < 0.25 ? 2.1 : 1.45;
            const yb = lv(f) + (f === 1 ? 1.1 : 0.55), yt = lv(f + 1) - 0.55;
            ops.push({ s0: c + shift - off - w / 2, s1: c + shift - off + w / 2, yb, yt });
          }
        }
        const res = openingWall(kit, a, b, n, y0, y1, ops, {
          wallKey: 'brick', revealKey: 'wframe', sillKey: 'wframe', vRef: L1, uStart: uA, depth: 0.28,
          glassKey: (q) => (q.slot ? 'slotGlass' : 'win'), cell: (q) => (q.slot ? [0, 0, q.s1 - q.s0, q.yt - q.yb] : cellUV(rand)),
          ground: ctx.heightAt,
        });
        if (!low) for (const q of res) frames.push({ a, d, n, q });
        // precast band at each floor line is absent on TCS; a slim metal line marks the top of the brick
        kit.beam('white', P(0, y1 - 0.12, 0.04), P(L, y1 - 0.12, 0.04), 0.12, 0.24, { caps: false });
        return true;
      }
      if (v.role === 'top') {
        const ops = [];
        for (let s = 2.2; s < E.L - 1.5; s += 3.6) ops.push({ s0: s - off - 0.9, s1: s - off + 0.9, yb: lv(5) + 0.5, yt: ROOF - 0.6 });
        openingWall(kit, a, b, n, y0, y1, ops, { wallKey: 'ribbed', revealKey: 'white', vRef: lv(5), uStart: uA, depth: 0.15, glassKey: 'win', cell: () => cellUV(rand) });
        return true;
      }
      return false;
    },
  });

  // window surrounds (dark bronze), a slim box frame per opening
  for (const { a, d, n, q } of frames) {
    const rot = Math.atan2(-d[1], d[0]), fw = 0.12, pr = 0.07;
    const at = (s, y) => [a[0] + d[0] * s + n[0] * pr / 2, y, a[1] + d[1] * s + n[2] * pr / 2];
    const w = q.s1 - q.s0, h = q.yt - q.yb, cs = (q.s0 + q.s1) / 2, cy = (q.yb + q.yt) / 2;
    let p = at(cs, q.yt + fw / 2); kit.box('wframe', p[0], p[1], p[2], w + 2 * fw, fw, pr, rot);
    p = at(cs, q.yb - fw / 2); kit.box('wframe', p[0], p[1], p[2], w + 2 * fw, fw, pr, rot);
    p = at(q.s0 - fw / 2, cy); kit.box('wframe', p[0], p[1], p[2], fw, h, pr, rot);
    p = at(q.s1 + fw / 2, cy); kit.box('wframe', p[0], p[1], p[2], fw, h, pr, rot);
  }

  // ---------------------------------------------------------------- roof slab over the main block (white edge)
  kit.cap('roofTop', MAIN, ROOF + 0.4, true);
  kit.cap('white', MAIN, ROOF, false);
  kit.ringWalls('white', MAIN, ROOF, ROOF + 0.4);
  if (!low) {
    for (const [u, v, w, dd, h] of [[2, -20, 9, 6, 2.6], [-4, -6, 6, 5, 2.0], [6, 5, 5, 4, 1.8]]) {
      const [x, z] = F.W(u, v);
      kit.box('plant', x, ROOF + 0.4 + h / 2, z, w, h, dd, F.rotY);
    }
  }

  // ---------------------------------------------------------------- the lantern: glass box on columns + gable
  const lanternTop = ROOF;
  {
    const Lr = LANT;
    // glazed floors L2..L5 (cantilevered box) and the top storey
    kit.ringWalls('lantern', Lr, lv(2) - 0.35, lv(5), { vRef: L1 });
    kit.cap('dkMetal', Lr, lv(2) - 0.35, false);                                     // soffit of the cantilever
    kit.ringWalls('dkMetal', Lr, lv(2) - 0.9, lv(2) - 0.35);                         // deep slab edge
    for (const f of [3, 4, 5]) {
      const r = Lr;
      for (let k = 0; k < r.length; k++) {
        const p = r[k], q = r[(k + 1) % r.length];
        const E = edgeInfo(p, q);
        const o = 0.12;
        kit.beam('dkMetal', [p[0] + E.n[0] * o, lv(f) - 0.2, p[1] + E.n[2] * o], [q[0] + E.n[0] * o, lv(f) - 0.2, q[1] + E.n[2] * o], 0.3, 0.45, { caps: false });
      }
    }
    // recessed top storey under the gable
    const lTop = loc([[11.2, 26.24], [11.0, 34.8], [-2.0, 34.4], [-3.6, 26.3]]);
    kit.ringWalls('lantern', lTop, lv(5), lanternTop, { vRef: L1 });
    kit.cap('deck', Lr, lv(5), true);
    // recessed lobby at street level + round columns at the front corners
    const lobby = loc([[11.0, 26.24], [10.8, 33.8], [-1.6, 33.4], [-3.9, 26.3]]);
    kit.ringWalls('glassDark', lobby, L1 - 0.3, lv(2) - 0.9, { vRef: L1 });
    kit.cap('paving', Lr, L1 + 0.03, true);                                         // arcade floor under the cantilever
    for (const [u, v] of [[10.9, 35.6], [-1.9, 35.2]]) {
      const [x, z] = F.W(u, v);
      kit.cylinder('column', x, z, L1 - 1.5, lv(2) - 0.9, 0.38, 0.38, low ? 8 : 14, { top: false });
    }
    // asymmetric gable: ridge along v at u = 6.3, west eave low, east eave higher; overhangs Forbes by 2.4 m
    const uW = -4.4, uE = 12.9, uR = 6.3, vB = 25.8, vF = 38.9;
    const yW = lanternTop + 0.2, yE = lanternTop + 0.5, yR = lanternTop + 5.4, th = 0.45;
    const Pt = (u, y, v) => F.P(u, y, v);
    const up = [0, 1, 0];
    // upper surfaces
    kit.quadH('gable', Pt(uW, yW, vF), Pt(uR, yR, vF), Pt(uR, yR, vB), Pt(uW, yW, vB), up, [0, 0], [11, 0], [11, 13], [0, 13]);
    kit.quadH('gable', Pt(uR, yR, vF), Pt(uE, yE, vF), Pt(uE, yE, vB), Pt(uR, yR, vB), up, [0, 0], [7, 0], [7, 13], [0, 13]);
    // soffits (white, seen from the street)
    const dn = [0, -1, 0];
    kit.quadH('white', Pt(uW, yW - th, vF), Pt(uR, yR - th, vF), Pt(uR, yR - th, vB), Pt(uW, yW - th, vB), dn);
    kit.quadH('white', Pt(uR, yR - th, vF), Pt(uE, yE - th, vF), Pt(uE, yE - th, vB), Pt(uR, yR - th, vB), dn);
    // fascia edges
    const fs = F.dirOf(0, 1);
    kit.quadH('white', Pt(uW, yW - th, vF), Pt(uR, yR - th, vF), Pt(uR, yR, vF), Pt(uW, yW, vF), fs);
    kit.quadH('white', Pt(uR, yR - th, vF), Pt(uE, yE - th, vF), Pt(uE, yE, vF), Pt(uR, yR, vF), fs);
    kit.quadH('white', Pt(uW, yW - th, vB), Pt(uW, yW - th, vF), Pt(uW, yW, vF), Pt(uW, yW, vB), F.dirOf(-1, 0));
    kit.quadH('white', Pt(uE, yE - th, vF), Pt(uE, yE - th, vB), Pt(uE, yE, vB), Pt(uE, yE, vF), F.dirOf(1, 0));
    // glazed gable triangle over the top storey (set back under the overhang)
    const vg = 34.6;
    const yAt = (u) => (u < uR ? yW + (yR - yW) * (u - uW) / (uR - uW) : yR + (yE - yR) * (u - uR) / (uE - uR)) - th;
    kit.quadH('lantern', Pt(-2.8, lanternTop, vg), Pt(uR, lanternTop, vg), Pt(uR, yAt(uR), vg), Pt(-2.8, yAt(-2.8), vg), fs,
      [0, lanternTop - L1], [9.1, lanternTop - L1], [9.1, yAt(uR) - L1], [0, yAt(-2.8) - L1]);
    kit.quadH('lantern', Pt(uR, lanternTop, vg), Pt(11.1, lanternTop, vg), Pt(11.1, yAt(11.1), vg), Pt(uR, yAt(uR), vg), fs,
      [9.1, lanternTop - L1], [13.9, lanternTop - L1], [13.9, yAt(11.1) - L1], [9.1, yAt(uR) - L1]);
    // close the back of the gable down to the main roof
    const yb0 = ROOF + 0.4;
    kit.quadH('ribbed', Pt(uW, yb0, vB), Pt(uR, yb0, vB), Pt(uR, yR - th, vB), Pt(uW, Math.max(yb0, yW - th), vB), F.dirOf(0, -1), [0, 0], [10.7, 0], [10.7, 5.4], [0, 0.2]);
    kit.quadH('ribbed', Pt(uR, yb0, vB), Pt(uE, yb0, vB), Pt(uE, yE - th, vB), Pt(uR, yR - th, vB), F.dirOf(0, -1), [0, 0], [6.6, 0], [6.6, 0.5], [0, 5.4]);
  }

  // ---------------------------------------------------------------- entrance canopy + name sign
  {
    const [cx, cz] = F.W(-8.2, 23.4);
    kit.box('white', cx, lv(2) - 0.6, cz, 8.4, 0.35, 4.4, F.rotY);
    kit.box('lamp', cx, lv(2) - 0.79, cz, 7.6, 0.02, 3.8, F.rotY, { faces: { ny: 1 } });
    const [px, pz] = F.W(-11.4, 24.9);
    kit.cylinder('column', px, pz, L1 - 0.5, lv(2) - 0.75, 0.16, 0.16, 10, { top: false });
    // sign on the slate pier: "Carnegie Mellon University / TCS HALL"
    const a = F.W(12.5, 26.36), b = F.W(15.9, 26.39), nrm = F.dirOf(0, 1);
    const y0 = lv(2) + 0.2, y1 = y0 + 1.25;
    const o = 0.03;
    kit.quad('sign', [a[0] + nrm[0] * o, y0, a[1] + nrm[2] * o], [b[0] + nrm[0] * o, y0, b[1] + nrm[2] * o], [b[0] + nrm[0] * o, y1, b[1] + nrm[2] * o], [a[0] + nrm[0] * o, y1, a[1] + nrm[2] * o], nrm, [0, 0], [1, 0], [1, 1], [0, 1]);
  }

  const alu = ctx.materials.get('aluminium');
  const brown = brickPlain(ctx, { colors: ['#5e4034', '#6b4a3b', '#553a2f', '#72503f'], brickW: 0.29, brickH: 0.07, joint: 0.011, mortar: '#6e6258' });
  const group = kit.build({
    brick: tcsBrick(ctx),
    slate: slateTile(ctx), slateTop: slateTile(ctx),
    brown,
    ribbed: ribbedAlu(ctx),
    wframe: plainMat(ctx, '#3a3632', { roughness: 0.5, metalness: 0.45 }),
    win: glz(ctx, 'winTepper'),
    slotGlass: glz(ctx, 'forbesGlass', 1.1, 3.9),
    glassDark: glz(ctx, 'forbesGlass', 1.5, 3.9),
    lantern: glz(ctx, 'forbesGlass', 1.6, 3.9),
    dark: glz(ctx, 'dark'),
    lamp: glz(ctx, 'lamp'),
    dkMetal: plainMat(ctx, '#26282b', { roughness: 0.55, metalness: 0.15 }),
    white: plainMat(ctx, '#eeeeea', { roughness: 0.6 }),
    gable: plainMat(ctx, '#b9bec2', { roughness: 0.45, metalness: 0.5 }),
    column: plainMat(ctx, '#d9d8d2', { roughness: 0.6 }),
    deck: ctx.materials.get('flatRoof'),
    paving: ctx.materials.get('paver'),
    roofTop: ctx.materials.get('flatRoof'),
    plant: metalPanels(ctx, { color: '#a4aaaf' }),
    alu,
    sign: signMat(ctx, 'tcs', {
      w: 3.4, h: 1.25, bg: null, ppm: 150, color: '#f2f2ee', lines: [
        { text: 'Carnegie Mellon University', size: 0.16, y: 0.26, weight: 500 },
        { text: 'TCS HALL', size: 0.36, y: 0.64, weight: 700, spacing: true },
      ],
    }),
  }, { name: 'landmark:tcsHall', noShadowKeys: ['sign', 'lamp'] });

  // the arcade floor bridges the drop toward the Hollow: walk mode stands on it
  const floor = group.children.find((m) => m.name.includes('paving'));
  if (floor) ctx.walkables?.add(floor);
  ctx.colliders.addPolygon(MAIN, base, ROOF + 0.5, 'tcsHall');
  ctx.colliders.addPolygon(PIER, base, ROOF + 1, 'tcsHall');
  ctx.colliders.addPolygon(TOWER, base, ROOF, 'tcsHall');
  ctx.colliders.addPolygon(loc([[11.0, 26.24], [10.8, 33.8], [-1.6, 33.4], [-3.9, 26.3]]), base, lanternTop + 4, 'tcsHall');
  ctx.colliders.addPolygon(LANT, lv(2) - 0.9, lanternTop + 4, 'tcsHall');
  const [cx, cz] = F.W(0, 0);
  registerForbes(ctx, group, {
    key: 'tcsHall', name: 'TCS Hall', nameZh: 'TCS 楼', osmId: TCS_OSM,
    position: [cx, ROOF, cz], radius: 45, labelY: ROOF + 8,
  });
  return group;
}
