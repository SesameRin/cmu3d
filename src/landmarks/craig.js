// Carnegie Mellon's buildings north of Forbes Avenue, around South Craig Street, Henry Street and Fifth Avenue:
//   · Software Engineering Institute (4500 Fifth Ave, 1987, Bohlin Powell Larkin Cywinski with Burt Hill Kosar
//     Rittelmann) — a warm granite plinth with slit windows carrying three storeys of mirror glass between silver
//     aluminium piers; a stone stair tower and a bowed glass bay with bent steel fins mark the Fifth Avenue entrance;
//     Henry Street runs through the building under a low segmental arch, and a steel pergola shelters the Henry
//     Street steps.
//   · Information Networking Institute (4616 Henry St) — a white-panelled mid-century office block with long dark
//     ribbon windows; its eastern bay rises a storey higher behind a rounded corner.
//   · 300 South Craig Street — red-brick offices (University Police, SCS departments): two wings with cast-stone
//     lintels and keystones, shopfronts with awnings, a glazed stair slot and a standing-seam mansard with dormers.
//   · 407 South Craig Street — a century-old storefront recast in white stucco: a long ground-floor window whose
//     end is cut on the diagonal of the stair behind it, with red "Carnegie Mellon" letters on a black rail.
//   · 4615 Forbes Avenue (Center for Technology Transfer and Enterprise Creation, the former GATF building) —
//     1960s modernism: a white precast upper storey of deep vertical fins cantilevered over a recessed glass and brown
//     brick ground floor, a coffered soffit and a "4615 FORBES" canopy.
// References (for the shapes only; all textures are painted at runtime): Wikimedia Commons "Category:Software
// Engineering Institute" (Fifth Ave, Dithridge St, Henry St views), CMU Facilities building pictures (4615 Forbes,
// 407 S. Craig, SEI), The Tartan (2014) photos of 300 and 407 S. Craig, CMU green-building pages, an oblique aerial
// of 4616 Henry St, and the OSM footprints.
import * as THREE from 'three';
import {
  MeshKit, massing, bandRing, ccw, pointInRing, ringCentroid, prng, insetRing, lerp2,
  edge, edgeBox, wallWithOpenings, curtainWall, mansard, rooftopUnits, signOnEdge, bladeSign, arcPoints,
  registerCraig, outwardOf, mirrored, makeFrame, rectLocal, projectOpenings, archWindow,
} from './lib/craig-kit.js';
import { ashlar, granite, whitePanel, redBrick, precast, cofferSoffit, signAtlas, signUV, flat } from './lib/craig-materials.js';
import { glz, cellUV, plain, seamMetal } from './lib/north-materials.js';

const lowQ = (ctx) => ctx.quality?.level === 'low';
const H = (ctx) => (x, z) => ctx.heightAt(x, z);

// Shared material dictionary (everything cached per context; keys that share a material merge into one mesh).
function materials(ctx) {
  const M = ctx.materials;
  const alu = plain(ctx, '#b9bdc0', { roughness: 0.34, metalness: 0.65 });
  const frameDark = plain(ctx, '#2f3437', { roughness: 0.45, metalness: 0.5 });
  const steel = plain(ctx, '#cfd2d3', { roughness: 0.45, metalness: 0.35 });
  const mech = plain(ctx, '#8f9497', { roughness: 0.55, metalness: 0.35 });
  const stoneTrim = flat(ctx, '#d8cfbd', { roughness: 0.75 });
  return {
    // SEI
    stone: ashlar(ctx), granite: granite(ctx), alu, steel, fin: steel,
    seiGlass: glz(ctx, 'forbesGlass', 1.5, 2.05), seiPane: glz(ctx, 'winBuff'),
    seiLight: glz(ctx, 'lightCurtain', 1.2, 3.3),
    soffit: precast(ctx, { color: '#cfc9bd' }),
    penthouse: plain(ctx, '#5e5953', { roughness: 0.6, metalness: 0.3 }),
    // shared bits
    roof: M.get('flatRoof'), mech, frame: frameDark, frameDark,
    door: glz(ctx, 'door', 0.75, 3.0), dark: glz(ctx, 'dark'), lamp: glz(ctx, 'lamp'),
    cells: glz(ctx, 'winBuff'), cellsDark: glz(ctx, 'winGates'),
    signs: signAtlas(ctx),
    // INI / 407
    white: whitePanel(ctx), whiteSmooth: whitePanel(ctx, { color: '#ecebe6', joints: false }),
    ribbon: glz(ctx, 'forbesGlass', 1.2, 1.4),
    shop: glz(ctx, 'tepperBase', 1.3, 2.4),
    // 300 S. Craig
    brick: redBrick(ctx), castStone: stoneTrim,
    seam: seamMetal(ctx, { color: '#8a9395', seam: 0.45 }),
    awning: flat(ctx, '#1f5a3c', { roughness: 0.85, side: THREE.DoubleSide }),
    canopy: seamMetal(ctx, { color: '#5f6b69', seam: 0.4 }),
    // 4615 Forbes
    precast: precast(ctx), coffer: cofferSoffit(ctx), bbrick: M.get('brickBrown'),
    upperGlass: glz(ctx, 'forbesGlass', 1.1, 4.2),
    rail: plain(ctx, '#ecebe7', { roughness: 0.5, metalness: 0.2 }),
  };
}

// Granite skin along the bottom of a wall strip: top follows the terrain (+h), sunk below it.
function graniteBase(kit, ctx, E, s0, s1, yBase, h = 0.9, key = 'granite') {
  const n = Math.max(1, Math.ceil((s1 - s0) / 4));
  for (let i = 0; i < n; i++) {
    const a = s0 + (s1 - s0) * i / n, b = s0 + (s1 - s0) * (i + 1) / n;
    const [xa, za] = E.P(a), [xb, zb] = E.P(b);
    const ta = ctx.heightAt(xa, za) + h, tb = ctx.heightAt(xb, zb) + h;
    kit.quad(key, E.P3(a, yBase, 0.04), E.P3(b, yBase, 0.04), E.P3(b, tb, 0.04), E.P3(a, ta, 0.04), E.n, [a, yBase], [b, yBase], [b, tb], [a, ta]);
    // chamfered top lip
    kit.quadH(key, E.P3(a, ta, 0.04), E.P3(b, tb, 0.04), E.P3(b, tb + 0.05, -0.02), E.P3(a, ta + 0.05, -0.02), [E.n[0], 1, E.n[2]]);
  }
}

// ============================================================================ Software Engineering Institute
const SEI_ID = 'w44150733';
// OSM footprint w44150733 (world metres). The north-east corner (F5–F14: bowed bay, stair tower, entrance notch)
// is re-drawn by hand below.
const SF = [
  [-623.9, -316.0], [-625.0, -334.9], [-628.8, -361.4], [-632.1, -399.5], [-630.0, -402.6], [-589.9, -412.0],
  [-586.1, -411.7], [-581.5, -406.9], [-578.9, -405.7], [-579.8, -403.6], [-578.8, -402.2], [-576.5, -401.9],
  [-576.6, -405.4], [-573.4, -406.2], [-569.0, -405.8], [-567.6, -390.3], [-574.4, -389.8], [-573.1, -374.4],
  [-605.6, -372.9], [-604.0, -360.2], [-586.5, -361.3], [-583.3, -318.8],
];
// Henry Street passes under the west wing (OSM tunnel w473677822): arch mouths W1–W2 (Dithridge St face) and
// F19–F18 (courtyard face).
const W1 = [-628.0, -355.8], W2 = [-629.4, -368.2];
// Bowed glass bay F5 → C1 and the stone stair tower (NW, NE, SE, SW corners)
const C1 = [-582.3, -407.6];
const TWR = [[-582.3, -408.6], [-575.4, -409.2], [-574.6, -400.2], [-581.5, -399.6]];
const EBOX0 = [-575.5, -406.0];   // east glass box meets the tower's east face

const SEI = {
  PT: 48.6,          // top of the granite plinth (≈ 6.4 m above Fifth Avenue, 7.2 m above Henry Street)
  TOP: 62.3,         // top of the mirror-glass storeys (roof)
  TOWER: 65.4,       // stone stair tower
  ARCH_S: 44.8, ARCH_C: 46.7,   // Henry Street arch: springing, crown
  HENRY: 41.35,      // Henry Street at the arch
  BAY: 3.05,
};

function seiOutline(bayPts) {
  return [SF[0], SF[1], W1, W2, SF[3], SF[4], ...bayPts, EBOX0, ...SF.slice(14)];
}

async function buildSEI(ctx) {
  const low = lowQ(ctx);
  const kit = new MeshKit();
  const rand = prng(1987);
  const hAt = H(ctx);
  const { PT, TOP, TOWER, ARCH_S, ARCH_C, HENRY, BAY } = SEI;
  const base = 38.6;

  // bowed bay: arc from F5 to C1 bulging to the north-east
  const chord = [C1[0] - SF[5][0], C1[1] - SF[5][1]], cl = Math.hypot(...chord);
  const bayOut = [chord[1] / cl, -chord[0] / cl];   // left of the chord direction = outwards (north-east)
  const bayPts = arcPoints(SF[5], C1, 1.25, bayOut, low ? 4 : 8);
  const U = seiOutline(bayPts);                       // whole building above the plinth
  const RN = [W2, SF[3], SF[4], ...bayPts, EBOX0, ...SF.slice(14, 19)];   // north block + west wing (plinth)
  const RS = [SF[0], SF[1], W1, SF[19], SF[20], SF[21]];                   // south block + west wing (plinth)
  const onBay = (a, b) => bayPts.some((p) => Math.hypot(p[0] - a[0], p[1] - a[1]) < 0.05) && bayPts.some((p) => Math.hypot(p[0] - b[0], p[1] - b[1]) < 0.05);
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05;
  const isTunnelWall = (a, b) => (near(a, W1) && near(b, SF[19])) || (near(a, SF[19]) && near(b, W1)) || (near(a, SF[18]) && near(b, W2)) || (near(a, W2) && near(b, SF[18]));
  // Henry Street entrance on the north block's courtyard face (F17 → F18)
  const isHenryFace = (a, b) => (near(a, SF[17]) && near(b, SF[18])) || (near(a, SF[18]) && near(b, SF[17]));

  const volumes = [
    { tag: 'N', ring: RN, y0: base, y1: PT, wallKey: 'stone', roofKey: 'roof', vRef: 0, plinth: true },
    { tag: 'S', ring: RS, y0: base, y1: PT, wallKey: 'stone', roofKey: 'roof', vRef: 0, plinth: true },
    { tag: 'U', ring: U, y0: PT, y1: TOP, wallKey: 'seiGlass', roofKey: 'roof', vRef: PT, glass: true },
    { tag: 'T', ring: TWR, y0: base, y1: TOWER, wallKey: 'stone', roofKey: 'stone', vRef: 0, tower: true },
  ];

  const henry = { s0: 0, s1: 0, E: null };
  massing(kit, volumes, {
    wallBuilder(v, a, b, n, y0, y1, u) {
      const E = edge(a, b, n);
      if (E.L < 0.2) return false;
      if (v.glass) {
        const curve = onBay(a, b);
        curtainWall(kit, E, y0, y1, {
          glassKey: 'seiGlass', pierKey: 'alu', bay: curve ? 99 : BAY, returns: !curve, pierW: 0.55, set: 0.5, proj: 0.12,
          pierY0: y0 - 0.15, pierY1: y1 + 0.15, vRef: PT, uStart: u, cols: curve ? 0 : 2, mw: 1.5, ledgeKey: 'alu', capKey: 'alu',
          panes: { key: 'seiPane', frameKey: 'frameDark', rowH: 2.05, paneW: 1.3, cellUV, rand, transoms: !low },
        });
        return true;
      }
      if (v.plinth) {
        const openings = [];
        if (!isTunnelWall(a, b) && !onBay(a, b) && E.L > 2.5) {
          // slit windows, one per bay, in the upper half of the plinth
          const nb = Math.max(1, Math.round(E.L / BAY)), bw = E.L / nb;
          for (let i = 0; i < nb; i++) {
            const s = (i + 0.5) * bw;
            const [x, z] = E.P(s), g = hAt(x, z);
            const sb = Math.max(g + 2.1, PT - 4.6);
            if (PT - 1.2 - sb < 1.2) continue;
            openings.push({ s0: s - 0.22, s1: s + 0.22, y0: sb, y1: Math.min(PT - 1.2, sb + 1.9), depth: 0.3, glass: 'cellsDark', cell: true });
          }
        }
        if (isHenryFace(a, b)) {
          // Henry Street entrance: glazed doors at the top of the steps, near the east end (F17)
          const sMid = near(a, SF[17]) ? 6.0 : E.L - 6.0;
          henry.E = E; henry.s0 = sMid - 2.6; henry.s1 = sMid + 2.6;
          const fl = HENRY + 1.5;
          for (let k = openings.length - 1; k >= 0; k--) if (openings[k].s1 > henry.s0 - 0.6 && openings[k].s0 < henry.s1 + 0.6) openings.splice(k, 1);
          openings.push({ s0: henry.s0, s1: henry.s1, y0: fl, y1: fl + 4.6, depth: 1.4, glass: 'door', frame: low ? null : 'alu', mull: 0, transom: 3.0 });
        }
        wallWithOpenings(kit, E, y0, y1, openings, { wallKey: 'stone', vRef: 0, uStart: u, rand, cellUV });
        graniteBase(kit, ctx, E, 0, E.L, y0, isTunnelWall(a, b) ? 1.1 : 0.9);
        return true;
      }
      if (v.tower) {
        const front = Math.abs(a[1] - TWR[0][1]) < 0.3 && Math.abs(b[1] - TWR[1][1]) < 0.3;   // north face
        const openings = [];
        if (front) {
          const g = Math.max(hAt(...E.P(1)), hAt(...E.P(E.L - 1)));
          const sm = E.L / 2;
          openings.push({ s0: sm - 1.45, s1: sm + 1.45, y0: g + 0.05, y1: g + 3.05, depth: 1.5, glass: 'door', frame: low ? null : 'alu', mull: 0 });
          openings.push({ s0: sm - 1.25, s1: sm + 1.25, y0: g + 3.7, y1: g + 7.0, depth: 0.45, glass: 'seiLight', frame: low ? null : 'frameDark', mull: 1.25, transom: 1.65 });
          openings.push({ s0: sm - 1.2, s1: sm + 1.2, y0: 51.2, y1: 61.6, depth: 0.95, glass: 'seiGlass', frame: low ? null : 'frameDark', mull: 1.2 });
          openings.push({ s0: sm - 1.2, s1: sm + 1.2, y0: 61.6, y1: TOWER - 0.01, depth: 0.95, back: 'stone' });
          graniteBase(kit, ctx, E, 0, sm - 1.45, y0, 0.9);
          graniteBase(kit, ctx, E, sm + 1.45, E.L, y0, 0.9);
          // chamfered surround of the tall slot (the lit diagonal jambs in night photos)
          for (const sg of [-1, 1]) {
            const s = sm + sg * 1.2;
            kit.quadH('stone', E.P3(s, 51.2, 0), E.P3(s + sg * 0.45, 51.2, 0), E.P3(s + sg * 0.45, 61.6, 0), E.P3(s, 61.6, 0), [E.n[0], 0, E.n[2]]);
          }
          // small balcony rail under the slot
          if (!low) edgeBox(kit, 'alu', E, sm, 0.12, 50.2, 50.3, 2.6, 0.3);
        } else graniteBase(kit, ctx, E, 0, E.L, y0, 0.9);
        wallWithOpenings(kit, E, y0, y1, openings, { wallKey: 'stone', vRef: 0, uStart: u, rand, cellUV });
        return true;
      }
      return false;
    },
  });
  // coping on the tower, aluminium coping on the glass roof edge
  bandRing(kit, 'stone', TWR, TOWER + 0.1, 0.25, 0.2);
  bandRing(kit, 'alu', U, TOP + 0.08, 0.2, 0.16);

  // ---- Henry Street arch (Dithridge face W1–W2 and courtyard face F19–F18) + vault
  const NA = low ? 8 : 14;
  {
    const span = 12.5, sag = ARCH_C - ARCH_S, Rr = (span * span / 4 + sag * sag) / (2 * sag);
    const yArch = (t) => ARCH_S + Math.sqrt(Math.max(0, Rr * Rr - ((t - 0.5) * span) ** 2)) - (Rr - sag);
    const faces = [[W1, W2], [SF[19], SF[18]]];
    for (const [A, B] of faces) {
      const n = outwardOf([W1, W2, SF[18], SF[19]], A, B);
      const E = edge(A, B, n);
      for (let i = 0; i < NA; i++) {
        const t0 = i / NA, t1 = (i + 1) / NA, s0 = t0 * E.L, s1 = t1 * E.L;
        kit.quad('stone', E.P3(s0, yArch(t0)), E.P3(s1, yArch(t1)), E.P3(s1, PT), E.P3(s0, PT), E.n, [s0, yArch(t0)], [s1, yArch(t1)], [s1, PT], [s0, PT]);
        // voussoir band framing the arch
        kit.quadH('granite', E.P3(s0, yArch(t0), 0.06), E.P3(s1, yArch(t1), 0.06), E.P3(s1, yArch(t1) + 0.45, 0.06), E.P3(s0, yArch(t0) + 0.45, 0.06), E.n);
      }
      kit.quad('granite', E.P3(0, ARCH_S - 0.05, 0.06), E.P3(0, ARCH_S - 0.05, 0), E.P3(0, ARCH_S + 0.4, 0), E.P3(0, ARCH_S + 0.4, 0.06), [-E.dir[0], 0, -E.dir[1]], [0, 0], [0.06, 0], [0.06, 0.45], [0, 0.45]);
    }
    // vault (soffit) between the two mouths, facing down
    for (let i = 0; i < NA; i++) {
      const t0 = i / NA, t1 = (i + 1) / NA;
      const a0 = lerp2(W1, W2, t0), a1 = lerp2(W1, W2, t1), b0 = lerp2(SF[19], SF[18], t0), b1 = lerp2(SF[19], SF[18], t1);
      kit.quadH('soffit', [a0[0], yArch(t0), a0[1]], [a1[0], yArch(t1), a1[1]], [b1[0], yArch(t1), b1[1]], [b0[0], yArch(t0), b0[1]], [0, -1, 0],
        [t0 * 12.5, 0], [t1 * 12.5, 0], [t1 * 12.5, 24], [t0 * 12.5, 24]);
    }
    // two lamps under the vault
    if (!low) for (const t of [0.3, 0.7]) {
      const m = lerp2(lerp2(W1, SF[19], t), lerp2(W2, SF[18], t), 0.5);
      kit.box('lamp', m[0], ARCH_C - 0.08, m[1], 0.5, 0.06, 1.6, 0, { faces: { ny: 1, px: 1, nx: 1, pz: 1, nz: 1 } });
    }
  }

  // ---- steel fins rising over the bowed bay (bent "Γ" members leaning out over the entrance)
  {
    const nf = low ? 3 : 5;
    for (let k = 0; k < nf; k++) {
      const t = (k + 0.5) / nf, idx = t * (bayPts.length - 1), i0 = Math.floor(idx), f = idx - i0;
      const p = lerp2(bayPts[i0], bayPts[Math.min(bayPts.length - 1, i0 + 1)], f);
      const q = bayPts[Math.min(bayPts.length - 1, i0 + 1)], r0 = bayPts[i0];
      const tx = q[0] - r0[0], tz = q[1] - r0[1], tl = Math.hypot(tx, tz) || 1;
      const o = [tz / tl, -tx / tl];
      const out = pointInRing(p[0] + o[0], p[1] + o[1], U) ? [-o[0], -o[1]] : o;
      const P = (d, y) => [p[0] + out[0] * d, y, p[1] + out[1] * d];
      kit.beam('fin', P(-0.35, TOP - 3.0), P(-0.35, TOP + 3.6), 0.22, 0.34);
      kit.beam('fin', P(-0.35, TOP + 3.6), P(1.5, TOP + 1.7), 0.22, 0.3);
    }
  }

  // ---- carved lettering on the stone wall under the bay + red sign board on posts
  {
    const pts = bayPts;
    let total = 0; const segL = [];
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segL.push(l); total += l; }
    const [u0, v0, u1, v1] = signUV('seiCarved');
    const yT = 44.05, hT = 1.12, m0 = total * 0.08, m1 = total * 0.94;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = acc, b = acc + segL[i]; acc = b;
      const s0 = Math.max(a, m0), s1 = Math.min(b, m1);
      if (s1 <= s0) continue;
      const n = outwardOf(RN, pts[i], pts[i + 1]);
      const E = edge(pts[i], pts[i + 1], n);
      const flip = mirrored(E), uAt = (s) => (flip ? u1 - (u1 - u0) * (s - m0) / (m1 - m0) : u0 + (u1 - u0) * (s - m0) / (m1 - m0));
      const ua = uAt(s0), ub = uAt(s1);
      kit.quad('signs', E.P3(s0 - a, yT - hT / 2, 0.025), E.P3(s1 - a, yT - hT / 2, 0.025), E.P3(s1 - a, yT + hT / 2, 0.025), E.P3(s0 - a, yT + hT / 2, 0.025), E.n,
        [ua, v0], [ub, v0], [ub, v1], [ua, v1]);
    }
    // red board on two posts in the plaza, facing Fifth Avenue
    const mid = bayPts[Math.floor(bayPts.length * 0.35)];
    const bE = edge([mid[0] - 0.9 * 0.97, mid[1] - 3.2 + 0.9 * 0.23], [mid[0] + 0.9 * 0.97, mid[1] - 3.2 - 0.9 * 0.23], [0.23, 0, -0.97]);
    const g = hAt(mid[0], mid[1] - 3.2);
    signOnEdge(kit, 'signs', bE, 0.9, g + 1.35, 1.8, 0.66, signUV('seiBoard'), 0);
    if (!low) for (const s of [0.15, 1.65]) edgeBox(kit, 'frameDark', bE, s, -0.06, g - 0.3, g + 1.68, 0.08, 0.08);
  }

  // ---- Henry Street steps, landing and the steel pergola (posts + double beams) in front of the entrance
  if (henry.E) {
    const E = henry.E, s0 = henry.s0 - 0.8, s1 = henry.s1 + 0.8, fl = HENRY + 1.5;
    const w = s1 - s0, sm = (s0 + s1) / 2;
    edgeBox(kit, 'stone', E, sm, 0.75, base, fl, w, 1.5);                 // landing
    const steps = 8, run = 0.3;
    for (let k = 0; k < steps; k++) {
      const top = fl - (k + 1) * (fl - HENRY) / (steps + 1) + 0.02;
      edgeBox(kit, 'stone', E, sm, 1.5 + run * (k + 0.5), base, top, w - 1.2, run);
    }
    for (const sg of [-1, 1]) edgeBox(kit, 'granite', E, sm + sg * (w / 2 - 0.3), 1.5 + steps * run / 2, base, fl + 0.9, 0.6, steps * run + 0.1);  // cheek walls
    // pergola: 2 x 2 posts clear of the doors, beams at 6 m
    const py = fl + 5.6, span = w + 4;
    for (const sp of [-span / 2, span / 2]) for (const off of [0.6, 4.6]) {
      const [x, z] = E.P(sm + sp, off), g = hAt(x, z);
      kit.box('steel', x, (Math.min(g, HENRY) - 0.3 + py) / 2, z, 0.34, py - Math.min(g, HENRY) + 0.3, 0.34, E.rot);
    }
    for (const off of [0.6, 4.6]) edgeBox(kit, 'steel', E, sm, off, py - 0.45, py, span + 1.2, 0.3);
    if (!low) for (let k = 0; k <= 6; k++) edgeBox(kit, 'steel', E, sm - span / 2 + k * span / 6, 2.6, py, py + 0.3, 0.2, 5.4);
    // lamps on the pergola posts
    if (!low) for (const sp of [-span / 2, span / 2]) edgeBox(kit, 'lamp', E, sm + sp, 0.85, fl + 2.6, fl + 3.2, 0.12, 0.08);
  }

  // ---- roof: mechanical penthouses (dark metal) + small plant
  {
    const pen = (x, z, w, d, h, rot) => kit.box('penthouse', x, TOP + h / 2, z, w, h, d, rot, { faces: { px: 1, nx: 1, pz: 1, nz: 1, py: 1 } });
    const rot = Math.atan2(0.228, 0.973);
    pen(-603, -392, 16, 9, 3.6, rot);
    pen(-606, -338, 11, 8, 3.0, 0.05);
    if (!low) {
      rooftopUnits(kit, 'mech', [[-625, -330], [-590, -333], [-588, -355], [-626, -356]], TOP, 4, rand, { rot: 0.05 });
      rooftopUnits(kit, 'mech', [[-627, -372], [-575, -378], [-577, -400], [-628, -397]], TOP, 5, rand, { rot });
    }
  }

  const group = kit.build(materials(ctx), { name: 'landmark:sei' });

  // colliders: plinth blocks, the bridge over Henry Street (above the arch), the tower
  ctx.colliders.addPolygon(RN, base, TOP + 1, 'sei');
  ctx.colliders.addPolygon(RS, base, TOP + 1, 'sei');
  ctx.colliders.addPolygon([W1, W2, SF[18], SF[19]], ARCH_S, TOP + 1, 'sei');
  ctx.colliders.addPolygon(TWR, base, TOWER + 0.5, 'sei');
  if (henry.E) {
    const E = henry.E;
    const [x, z] = E.P((henry.s0 + henry.s1) / 2, 0.75);
    ctx.colliders.addBox(x, z, (henry.s1 - henry.s0) / 2 + 0.8, 0.75, E.rot, base, HENRY + 1.5, 'sei');
  }

  const c = ringCentroid(U);
  registerCraig(ctx, group, {
    key: 'sei', name: 'Software Engineering Institute', nameZh: '软件工程研究所', osmId: SEI_ID,
    position: [c[0], TOP, c[1]], radius: 50, labelY: TOP + 7, priority: 8,
  });
  return group;
}


// ============================================================================ Information Networking Institute
// 4616 Henry St. The OSM footprint fronts Winthrop Street (south) with Zebina Way along its west side. An oblique
// aerial shows a flat-roofed white building with long dark ribbon windows: a three-storey western block (blank
// ground floor with the entrance, two ribbon floors split by a pier) and an eastern bay one storey taller, with a
// rounded south-west corner and a dark recessed ground floor; the roof is crowded with air-handling units.
const INI_ID = 'w44156184';
const INI_F = [[-440.8, -327.6], [-442.9, -348.6], [-410.9, -351.5], [-408.7, -330.5]];

async function buildINI(ctx) {
  const low = lowQ(ctx);
  const kit = new MeshKit();
  const rand = prng(1989);
  const A = INI_F[0], D = INI_F[3];
  const F = makeFrame(A, [D[0] - A[0], D[1] - A[1]]);   // n: east along the Winthrop front, e: outwards (south)
  const LEN = 32.2, DEP = 21.1, NB = 19.0, BAR = 7.6, PROJ = 0.6, RAD = 2.6;
  const L1 = 35.4, L2 = 39.8, FH = 3.55, L3 = L2 + FH, R1 = L3 + FH, R2 = R1 + FH, base = 32.9, PAR = 0.8;
  const west = rectLocal(F, -DEP, 0, 0, NB);
  const back = rectLocal(F, -DEP, -BAR, NB, LEN);
  // east bar with the rounded south-west corner (centre at e = PROJ - RAD, n = NB + RAD)
  const NSEG = low ? 3 : 6;
  // (explicit corner points: from (e, n) = (PROJ - RAD, NB) to (PROJ, NB + RAD))
  const corner = [];
  for (let i = 0; i <= NSEG; i++) {
    const a = (i / NSEG) * (Math.PI / 2);
    corner.push(F.W(PROJ - RAD + Math.sin(a) * RAD, NB + RAD - Math.cos(a) * RAD));
  }
  const bar = [F.W(-BAR, NB), ...corner, F.W(PROJ, LEN), F.W(-BAR, LEN)];

  const ribY = (fl) => [fl + 1.0, fl + 2.35];
  const specs = [];
  const add = (e0, n0, e1, n1, y0, y1, o) => specs.push({ p0: F.W(e0, n0), p1: F.W(e1, n1), y0, y1, depth: 0.3, ...o });
  const ribbon = { glass: 'ribbon', frame: low ? null : 'frameDark', mull: 1.2, sill: low ? null : 'alu' };
  for (const fl of [L2, L3]) {
    const [y0, y1] = ribY(fl);
    // Winthrop front of the west block: two long ribbons split by a pier + a short one by the east bar
    add(0, 0.6, 0, 7.6, y0, y1, ribbon); add(0, 8.7, 0, 15.8, y0, y1, ribbon); add(0, 16.9, 0, 18.6, y0, y1, ribbon);
    // Zebina Way (west) and the north side
    add(-1.0, 0, -9.8, 0, y0, y1, ribbon); add(-11.2, 0, -20.1, 0, y0, y1, ribbon);
    add(-DEP, 1.0, -DEP, 9.6, y0, y1, ribbon); add(-DEP, 11.0, -DEP, 18.2, y0, y1, ribbon); add(-DEP, 20.4, -DEP, 31.0, y0, y1, ribbon);
    add(-8.6, LEN, -20.2, LEN, y0, y1, ribbon);
  }
  for (const fl of [L2, L3, R1]) {
    const [y0, y1] = ribY(fl);
    add(PROJ, 24.9, PROJ, 31.6, y0, y1, ribbon);               // east bar front: three ribbons
    add(-0.6, LEN, -6.8, LEN, y0, y1, ribbon);                 // east bar, east end
  }
  // ground floor: glazed entrance (with sidelights) in the west block, service door, east bar's dark recessed base
  add(0, 9.3, 0, 12.1, L1, L1 + 3.3, { glass: 'door', frame: low ? null : 'alu', mull: 0, transom: 2.5, depth: 0.6 });
  add(0, 17.0, 0, 18.5, L1, L1 + 2.9, { glass: 'dark', depth: 0.5 });
  add(PROJ, 24.9, PROJ, 31.6, L1 - 1.0, L2 - 0.9, { glass: 'shop', frame: low ? null : 'frameDark', mull: 1.7, depth: 1.3 });
  add(-DEP, 4.0, -DEP, 6.0, L1 + 1.4, L1 + 4.2, { glass: 'door', depth: 0.4 });   // rear door towards Henry St

  const vols = [
    { ring: west, y0: base, y1: R1, wallKey: 'white', roofKey: 'roof', parapet: PAR, parapetKey: 'white', copingKey: 'whiteSmooth', vRef: L1 },
    { ring: back, y0: base, y1: R1, wallKey: 'white', roofKey: 'roof', parapet: PAR, parapetKey: 'white', copingKey: 'whiteSmooth', vRef: L1 },
    { ring: bar, y0: base, y1: R2, wallKey: 'white', roofKey: 'roof', parapet: PAR, parapetKey: 'white', copingKey: 'whiteSmooth', vRef: L1 },
  ];
  massing(kit, vols, {
    wallBuilder(v, a, b, n, y0, y1, u) {
      const E = edge(a, b, n);
      if (E.L < 0.3) return false;
      wallWithOpenings(kit, E, y0, y1, projectOpenings(E, specs), { wallKey: 'white', vRef: L1, uStart: u, rand, cellUV });
      return true;
    },
  });
  // entrance canopy + blade sign on the Winthrop front
  {
    const E = edge(F.W(0, 0), F.W(0, LEN), [F.E[0], 0, F.E[1]]);
    edgeBox(kit, 'whiteSmooth', E, 10.7, 0.9, L1 + 3.45, L1 + 3.75, 4.2, 1.8);
    if (!low) edgeBox(kit, 'lamp', E, 10.7, 0.9, L1 + 3.43, L1 + 3.46, 3.2, 1.2, { faces: { ny: 1 } });
    bladeSign(kit, 'signs', low ? null : 'frameDark', E, 13.2, L1 + 3.9, 0.9, 2.0, signUV('iniBlade'), 0.25);
    // a thin dark reveal line under the parapet coping (reads as the metal flashing on the aerial)
    edgeBox(kit, 'frameDark', E, NB / 2, 0.01, R1 + PAR - 0.28, R1 + PAR - 0.2, NB, 0.04, { faces: { nz: 1 } });
  }
  // rooftop plant (air handlers, condensers, exhaust boxes)
  const unitsAt = (ring, y, nU) => rooftopUnits(kit, 'mech', ring, y, nU, rand, { rot: F.rotY, min: 1.4, max: 3.6, hMin: 0.9, hMax: 2.0, margin: 1.6 });
  unitsAt(rectLocal(F, -DEP, 0, 0, NB), R1, low ? 4 : 11);
  unitsAt(rectLocal(F, -DEP, -BAR, NB, LEN), R1, low ? 2 : 6);
  if (!low) unitsAt(rectLocal(F, -BAR, 0, NB + 2, LEN), R2, 2);

  const group = kit.build(materials(ctx), { name: 'landmark:ini' });
  for (const v of vols) ctx.colliders.addPolygon(v.ring, base, v.y1 + PAR, 'ini');
  const c = ringCentroid(INI_F);
  registerCraig(ctx, group, {
    key: 'ini', name: 'Information Networking Institute (INI)', nameZh: '信息网络研究所', osmId: INI_ID,
    position: [c[0], R2, c[1]], radius: 22, labelY: R2 + 6, priority: 9,
  });
  return group;
}

// ============================================================================ 300 South Craig Street
// Red-brick offices on the block between Winthrop and Filmore Streets. The southern wing steps forward to the
// Craig Street sidewalk (paired windows under cast-stone lintels with keystones); the set-back northern wing has a
// shopfront with a green awning under a standing-seam canopy, a glazed stair slot and an entrance canopy. Both wings
// are three brick storeys under a light grey standing-seam mansard with arched dormers.
const C300_ID = 'w34262288';
const C300_F = [[-548.4, -300.8], [-511.3, -304.4], [-509.1, -281.9], [-501.9, -282.7], [-499.7, -258.0], [-537.5, -254.4], [-539.7, -273.2], [-546.3, -272.5]];

function segIntersect(p, d, a, b) {
  // p + t d  ∩  line a–b, returns the point or null
  const ex = b[0] - a[0], ez = b[1] - a[1], den = d[0] * ez - d[1] * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a[0] - p[0]) * ez - (a[1] - p[1]) * ex) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

async function build300(ctx) {
  const low = lowQ(ctx);
  const kit = new MeshKit();
  const rand = prng(300);
  const P = C300_F;
  const dW = [P[2][0] - P[3][0], P[2][1] - P[3][1]], dl = Math.hypot(dW[0], dW[1]);
  const S7 = segIntersect(P[2], [dW[0] / dl, dW[1] / dl], P[7], P[0]);
  const NW = [P[0], P[1], P[2], S7];                   // north wing (set back from Craig St)
  const SW = [S7, P[2], P[3], P[4], P[5], P[6], P[7]];  // south wing (on the Craig St building line)
  const L1 = 38.35, L2 = 42.75, L3 = 46.55, CR = 50.35, MT = 53.75, base = 36.6, INSET = 1.15;
  const floors = [L1, L2, L3];

  const inNW = (E) => pointInRing(...E.P(E.L / 2, -0.5), NW);
  const onEdge = (E, p, q) => Math.hypot(E.a[0] - p[0], E.a[1] - p[1]) + Math.hypot(E.b[0] - q[0], E.b[1] - q[1]) < 0.5
    || Math.hypot(E.a[0] - q[0], E.a[1] - q[1]) + Math.hypot(E.b[0] - p[0], E.b[1] - p[1]) < 0.5;
  const win = (s0, s1, y0, y1, o = {}) => ({
    s0, s1, y0, y1, depth: 0.28, glass: 'cells', cell: true, frame: low ? null : 'frameDark', mull: 0.7,
    sill: low ? null : 'castStone', head: 'castStone', headH: 0.28, ...o,
  });
  const dormerSpots = [];   // [E, s] for the mansard dormers

  massing(kit, [
    { ring: NW, y0: base, y1: CR, wallKey: 'brick', roofKey: false, vRef: L1 },
    { ring: SW, y0: base, y1: CR, wallKey: 'brick', roofKey: false, vRef: L1 },
  ], {
    wallBuilder(v, a, b, n, y0, y1, u) {
      const E = edge(a, b, n);
      if (E.L < 0.4) return false;
      const ops = [];
      // along-coordinate measured from end point p of the strip (whichever end it is)
      const from = (p) => (s) => { const sp = (p[0] - E.a[0]) * E.dir[0] + (p[1] - E.a[1]) * E.dir[1]; return sp < E.L / 2 ? sp + s : sp - s; };
      if (onEdge(E, P[1], P[2])) {
        const S = from(P[1]);   // s = 0 at the Winthrop St corner, running south
        const cols = [1.9, 4.6, 7.3, 10.0, 17.9];
        for (const fl of [L2, L3]) for (const c of cols) { const m = S(c); ops.push(win(m - 0.64, m + 0.64, fl + 0.8, fl + 2.95)); }
        for (const c of cols) dormerSpots.push([E, S(c)]);
        const sq = (c, hw, y0w, y1w, o) => { const m = S(c); ops.push({ s0: m - hw, s1: m + hw, y0: y0w, y1: y1w, ...o }); };
        const fr = low ? null : 'frameDark';
        sq(12.3, 0.75, L1 + 0.5, CR - 0.5, { depth: 0.35, glass: 'shop', frame: fr, mull: 1.5 });                 // glazed stair slot
        sq(2.4, 1.25, L1 + 0.45, L1 + 3.4, { depth: 0.3, glass: 'shop', frame: fr, mull: 1.25, transom: 2.3 });   // shop windows
        sq(5.4, 1.0, L1 + 0.45, L1 + 3.4, { depth: 0.3, glass: 'shop', frame: fr, mull: 1.0, transom: 2.3 });
        sq(8.9, 1.1, L1, L1 + 3.1, { depth: 0.9, glass: 'door', frame: low ? null : 'alu', mull: 0 });          // entrance
        sq(17.9, 4.2, L1 + 0.05, L1 + 3.3, { depth: 0.45, glass: 'shop', frame: fr, mull: 1.4, transom: 2.5 });   // storefront
      } else if (onEdge(E, P[3], P[4])) {
        // paired windows under lintels with keystones, every 5 m
        const nb = Math.max(1, Math.round(E.L / 5.0)), bw = E.L / nb;
        for (const fl of floors) for (let i = 0; i < nb; i++) {
          const m = (i + 0.5) * bw, h = fl === L1 ? 2.7 : 2.35, y0w = fl === L1 ? L1 + 0.7 : fl + 0.75;
          for (const sg of [-1, 1]) { const c = m + sg * 0.95; ops.push(win(c - 0.68, c + 0.68, y0w, y0w + h, { keystone: true, headH: 0.34 })); }
          if (fl === L3) dormerSpots.push([E, m]);
        }
      } else {
        // other faces: singles (north wing) or lintelled pairs (south wing) on a regular bay
        const isN = inNW(E), bay = isN ? 3.1 : 5.0;
        const nb = Math.max(0, Math.floor((E.L - 1.2) / bay)), bw = nb ? E.L / nb : 0;
        for (let i = 0; i < nb; i++) {
          const m = (i + 0.5) * bw;
          for (const fl of floors) {
            const y0w = fl + (fl === L1 ? 0.9 : 0.8), h = fl === L1 ? 2.3 : 2.15;
            if (isN) ops.push(win(m - 0.64, m + 0.64, y0w, y0w + h));
            else for (const sg of [-1, 1]) { const c = m + sg * 0.95; if (c - 0.7 > 0.3 && c + 0.7 < E.L - 0.3) ops.push(win(c - 0.68, c + 0.68, y0w, y0w + h, { keystone: true, headH: 0.34 })); }
          }
          if (E.L > 6) dormerSpots.push([E, m]);
        }
        // University Police entrance on Winthrop Street
        if (onEdge(E, P[0], P[1])) {
          const m = from(P[1])(8.0);
          for (let k = ops.length - 1; k >= 0; k--) if (ops[k].y0 < L2 && Math.abs((ops[k].s0 + ops[k].s1) / 2 - m) < 2.5) ops.splice(k, 1);
          ops.push({ s0: m - 1.0, s1: m + 1.0, y0: L1 - 0.05, y1: L1 + 2.9, depth: 0.8, glass: 'door', frame: low ? null : 'alu', mull: 0 });
          edgeBox(kit, 'canopy', E, m, 0.9, L1 + 3.1, L1 + 3.35, 3.2, 1.8);
        }
      }
      wallWithOpenings(kit, E, y0, y1, ops, { wallKey: 'brick', vRef: L1, uStart: u, rand, cellUV });
      // cast-stone water table at the base
      kit.quad('castStone', E.P3(0, base, 0.05), E.P3(E.L, base, 0.05), E.P3(E.L, L1 + 0.35, 0.05), E.P3(0, L1 + 0.35, 0.05), E.n, [u, 0], [u + E.L, 0], [u + E.L, L1 + 0.35 - base], [u, L1 + 0.35 - base]);
      return true;
    },
  });
  // cornice + string course on both wings, mansard roofs
  for (const R of [NW, SW]) {
    bandRing(kit, 'castStone', R, CR - 0.1, 0.32, 0.45);
    bandRing(kit, 'castStone', R, L2 - 0.05, 0.06, 0.22);
    mansard(kit, 'seam', 'roof', R, CR + 0.12, MT, INSET);
  }
  // dormers: small seam-metal boxes with arched glass, standing on the mansard slope
  {
    const seen = new Set();
    for (const [E, s] of dormerSpots) {
      const [x, z] = E.P(s, -0.55);
      const k = `${Math.round(x * 2)},${Math.round(z * 2)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!pointInRing(...E.P(s, -0.3), NW) && !pointInRing(...E.P(s, -0.3), SW)) continue;
      const yb = CR + 0.3, w = 1.5, h = 2.3, d = 1.6;
      edgeBox(kit, 'seam', E, s, -0.55 - d / 2, yb, yb + h, w, d, { faces: { nz: 1, px: 1, nx: 1, py: 1 } });
      const [wx, wz] = E.P(s, -0.53);
      archWindow(kit, 'cells', low ? null : 'castStone', wx, wz, yb + 0.35, 0.95, 1.6, E.dir, E.n, { off: 0.0, bars: 0, frameW: 0.09, depth: 0.08 });
      if (!low) {
        // curved hood with a half-round front
        const segs = 6, r = w / 2 + 0.05, yc = yb + h;
        const pts = [];
        for (let i = 0; i <= segs; i++) { const a = Math.PI * i / segs; pts.push([s + Math.cos(a) * r, yc + Math.sin(a) * 0.45]); }
        for (let i = 0; i < segs; i++) {
          const [s0, y0h] = pts[i], [s1, y1h] = pts[i + 1];
          kit.quadH('seam', E.P3(s0, y0h, -0.5), E.P3(s1, y1h, -0.5), E.P3(s1, y1h, -0.55 - d), E.P3(s0, y0h, -0.55 - d), [0, 1, 0]);
          kit.tri('seam', E.P3(s, yc, -0.5), E.P3(s0, y0h, -0.5), E.P3(s1, y1h, -0.5), E.n, [0, 0], [1, 0], [0, 1]);
        }
      }
    }
  }
  // shopfront awning (green) + standing-seam canopy over it, entrance canopy, blade sign
  {
    const E = edge(P[1], P[2], outwardOf(NW, P[1], P[2]));
    const s0 = 13.5, s1 = 22.3, ya = L1 + 3.45, out = 1.4;
    kit.quadH('awning', E.P3(s0, ya + 0.75, 0.02), E.P3(s1, ya + 0.75, 0.02), E.P3(s1, ya, out), E.P3(s0, ya, out), [E.n[0], 1, E.n[2]]);
    kit.quad('awning', E.P3(s0, ya - 0.3, out), E.P3(s1, ya - 0.3, out), E.P3(s1, ya, out), E.P3(s0, ya, out), E.n, [s0, 0], [s1, 0], [s1, 0.3], [s0, 0.3]);
    for (const s of [s0, s1]) {
      const sg = s === s0 ? -1 : 1;
      kit.triH('awning', E.P3(s, ya + 0.75, 0.02), E.P3(s, ya - 0.3, out), E.P3(s, ya, out), [E.dir[0] * sg, 0, E.dir[1] * sg]);
    }
    const yc = L2 + 0.3;
    kit.quadH('canopy', E.P3(s0 - 0.3, yc + 0.9, 0), E.P3(s1 + 0.3, yc + 0.9, 0), E.P3(s1 + 0.3, yc, 1.9), E.P3(s0 - 0.3, yc, 1.9), [E.n[0], 1, E.n[2]]);
    edgeBox(kit, 'canopy', E, (s0 + s1) / 2, 1.9, yc - 0.18, yc, s1 - s0 + 0.6, 0.12);
    kit.quadH('canopy', E.P3(7.2, L1 + 4.0, 0), E.P3(10.6, L1 + 4.0, 0), E.P3(10.6, L1 + 3.4, 1.7), E.P3(7.2, L1 + 3.4, 1.7), [E.n[0], 1, E.n[2]]);
    edgeBox(kit, 'canopy', E, 8.9, 1.7, L1 + 3.2, L1 + 3.4, 3.4, 0.12);
    if (!low) for (const s of [7.4, 10.4]) edgeBox(kit, 'frameDark', E, s, 1.6, L1, L1 + 3.3, 0.1, 0.1);
    bladeSign(kit, 'signs', low ? null : 'frameDark', E, 12.95, L1 + 4.3, 0.9, 2.0, signUV('craigBlade'), 0.3);
  }
  if (!low) {
    const rot = Math.atan2(-dW[1], dW[0]);
    rooftopUnits(kit, 'mech', insetRing(NW, INSET + 0.5), MT, 3, rand, { rot });
    rooftopUnits(kit, 'mech', insetRing(SW, INSET + 0.5), MT, 3, rand, { rot });
  }
  const group = kit.build(materials(ctx), { name: 'landmark:craig300' });
  ctx.colliders.addPolygon(NW, base, MT + 0.5, 'craig300');
  ctx.colliders.addPolygon(SW, base, MT + 0.5, 'craig300');
  const c = ringCentroid(C300_F);
  registerCraig(ctx, group, {
    key: 'craig300', name: '300 South Craig Street', nameZh: '克雷格南街 300 号', osmId: C300_ID,
    position: [c[0], MT, c[1]], radius: 26, labelY: MT + 5, priority: 6, maxDistance: 900,
  });
  return group;
}

// ============================================================================ 407 South Craig Street
// A two-storey storefront recast in smooth white stucco (1978 conversion into a gallery): a long ground-floor
// window whose north end is cut on the diagonal of the stair inside, red "Carnegie Mellon" letters on a black rail
// beneath it, a row of upper windows, and a recessed entrance bay with a tall window above.
const C407_ID = 'w44157443';
const C407_F = [[-477.9, -213.3], [-479.1, -228.8], [-456.2, -231.0], [-441.4, -232.0], [-440.6, -216.6]];

async function build407(ctx) {
  const low = lowQ(ctx);
  const kit = new MeshKit();
  const rand = prng(407);
  const Q = C407_F;
  const L1 = 37.65, L2 = 42.1, RF = 45.9, PAR = 0.6, base = 35.7;
  // chamfer the north-west corner
  const ch1 = lerp2(Q[1], Q[0], 1.5 / Math.hypot(Q[0][0] - Q[1][0], Q[0][1] - Q[1][1]));
  const ch2 = lerp2(Q[1], Q[2], 1.5 / Math.hypot(Q[2][0] - Q[1][0], Q[2][1] - Q[1][1]));
  const R = [Q[0], ch1, ch2, Q[2], Q[3], Q[4]];
  const front = edge(ch1, Q[0], outwardOf(R, ch1, Q[0]));   // s = 0 at the north end, running south
  const sp = [];
  const fr = low ? null : 'frameDark';
  const add = (s0, s1, y0, y1, o) => sp.push({ p0: front.P(s0), p1: front.P(s1), y0, y1, ...o });
  add(0.5, 2.0, L1 - 0.05, L1 + 2.8, { glass: 'door', depth: 1.0, frame: fr, mull: 0 });        // entrance
  add(2.4, 3.2, L1 + 0.6, L1 + 2.8, { glass: 'dark', depth: 0.3 });                                  // service panel
  add(0.35, 2.95, L2 + 0.3, RF - 0.5, { glass: 'shop', depth: 0.35, frame: fr, mull: 0.65 });       // tall upper window
  for (const c of [5.6, 8.2, 10.8, 13.4]) add(c - 0.95, c + 0.95, L2 + 0.75, L2 + 2.65, { glass: 'cells', cell: true, depth: 0.3, frame: fr, mull: 0.95 });
  const WIN = [4.4, 14.0, L1 + 0.95, L1 + 3.35];
  add(WIN[0], WIN[1], WIN[2], WIN[3], { glass: 'shop', depth: 0.45, frame: fr, mull: 2.4 });

  massing(kit, [{ ring: R, y0: base, y1: RF, wallKey: 'whiteSmooth', roofKey: 'roof', parapet: PAR, parapetKey: 'whiteSmooth', copingKey: 'alu', vRef: L1 }], {
    wallBuilder(v, a, b, n, y0, y1, u) {
      const E = edge(a, b, n);
      if (E.L < 0.3) return false;
      wallWithOpenings(kit, E, y0, y1, projectOpenings(E, sp), { wallKey: 'whiteSmooth', vRef: L1, uStart: u, rand, cellUV });
      return true;
    },
  });
  {
    // diagonal cut at the north end of the big window: stucco triangle over the lower-left corner + sloped reveal
    const E = front, [s0, s1, y0, y1] = WIN, cut = 2.3, d = 0.4;
    kit.tri('whiteSmooth', E.P3(s0, y0, 0.002), E.P3(s0 + cut, y0, 0.002), E.P3(s0, y1, 0.002), E.n, [s0, y0 - L1], [s0 + cut, y0 - L1], [s0, y1 - L1]);
    kit.quadH('whiteSmooth', E.P3(s0 + cut, y0, 0.002), E.P3(s0, y1, 0.002), E.P3(s0, y1, -d), E.P3(s0 + cut, y0, -d), [E.dir[0], 0.7, E.dir[1]]);
    // "Carnegie Mellon" letters on a black rail under the window
    signOnEdge(kit, 'signs', E, (s0 + s1) / 2 + 0.6, L1 + 0.5, 5.6, 0.79, signUV('cmRail'), 0.06);
    if (!low) for (let k = 0; k < 6; k++) edgeBox(kit, 'frameDark', E, s0 + 2.2 + k * 1.1, 0.03, L1 + 0.12, L1 + 0.32, 0.06, 0.06);
    // slim projecting frame round the upper window row
    edgeBox(kit, 'whiteSmooth', E, 9.5, 0.12, L2 + 2.85, L2 + 3.0, 10.6, 0.24);
    edgeBox(kit, 'whiteSmooth', E, 9.5, 0.12, L2 + 0.45, L2 + 0.6, 10.6, 0.24);
  }
  if (!low) rooftopUnits(kit, 'mech', R, RF, 4, rand, { rot: front.rot + Math.PI / 2, margin: 2.5 });
  const group = kit.build(materials(ctx), { name: 'landmark:craig407' });
  ctx.colliders.addPolygon(R, base, RF + PAR, 'craig407');
  const lp = front.P(8, -5);
  registerCraig(ctx, group, {
    key: 'craig407', name: '407 South Craig Street', nameZh: '克雷格南街 407 号', osmId: C407_ID,
    position: [lp[0], RF, lp[1]], radius: 20, labelY: RF + 5, priority: 6, maxDistance: 800,
  });
  return group;
}

// ============================================================================ 4615 Forbes Avenue (CTTEC)
// The former Graphic Arts Technical Foundation building: a floating white upper storey of deep precast fins (with
// boxy feet over a coffered soffit) cantilevered all round over a recessed ground floor of dark glass and brown
// brick, on a terrace with white railings; "4615 FORBES" on the entrance canopy.
const CTTEC_ID = 'w44157444';
const CTTEC_F = [[-424.0, -176.2], [-425.0, -207.3], [-391.3, -208.3], [-390.2, -177.3]];

async function buildCTTEC(ctx) {
  const low = lowQ(ctx);
  const kit = new MeshKit();
  const rand = prng(4615);
  const L1 = 35.75, U0 = 40.55, U1 = 46.1, base = 32.9, OH = 2.3, FIN = 1.55;
  const upper = ccw(CTTEC_F);
  const ground = insetRing(upper, OH);
  const southE = edge(CTTEC_F[3], CTTEC_F[0], outwardOf(upper, CTTEC_F[3], CTTEC_F[0]));   // Forbes front (east → west)
  const fr = low ? null : 'frameDark';

  massing(kit, [
    { tag: 'g', ring: ground, y0: base, y1: U0, wallKey: 'bbrick', roofKey: false, vRef: L1 },
    { tag: 'u', ring: upper, y0: U0, y1: U1, wallKey: 'precast', roofKey: 'roof', vRef: U0 },
  ], {
    wallBuilder(v, a, b, n, y0, y1, u) {
      const E = edge(a, b, n);
      if (E.L < 0.4) return false;
      if (v.tag === 'u') {
        // glass behind the fins, bottom band, top fascia, fins with boxy feet
        kit.quad('upperGlass', E.P3(0, U0 + 0.5, -0.78), E.P3(E.L, U0 + 0.5, -0.78), E.P3(E.L, U1 - 0.65, -0.78), E.P3(0, U1 - 0.65, -0.78), E.n,
          [u, 0.5], [u + E.L, 0.5], [u + E.L, U1 - 0.65 - U0], [u, U1 - 0.65 - U0]);
        edgeBox(kit, 'precast', E, E.L / 2, -0.35, U0, U0 + 0.55, E.L + 0.2, 0.9);
        edgeBox(kit, 'precast', E, E.L / 2, -0.33, U1 - 0.7, U1, E.L + 0.24, 0.94);
        const nf = Math.max(1, Math.round(E.L / FIN)), fw = E.L / nf;
        for (let i = 0; i < nf; i++) {
          const s = (i + 0.5) * fw;
          edgeBox(kit, 'precast', E, s, -0.38, U0 + 0.55, U1 - 0.7, 0.42, 0.8, { faces: { px: 1, nx: 1, pz: 1, nz: 1 } });
          if (!low) edgeBox(kit, 'precast', E, s, -0.3, U0 + 0.55, U0 + 1.25, 1.0, 0.9, { faces: { px: 1, nx: 1, pz: 1, py: 1, nz: 1 } });
        }
        return true;
      }
      // ground floor: dark glass on the Forbes front and along the sides, brick with small windows at the back
      const ops = [];
      const dot = E.n[0] * southE.n[0] + E.n[2] * southE.n[2];
      if (dot > 0.95) {
        const nb = Math.max(1, Math.round((E.L - 8.5) / 1.6));
        ops.push({ s0: 0.6, s1: E.L - 7.9, y0: L1 + 0.1, y1: U0 - 0.25, depth: 0.25, glass: 'shop', frame: fr, mull: (E.L - 8.5) / nb, transom: 2.6 });
      } else if (Math.abs(dot) < 0.1) {
        ops.push({ s0: 0.8, s1: E.L - 0.8, y0: L1 + 0.9, y1: U0 - 0.6, depth: 0.25, glass: 'shop', frame: fr, mull: 1.6 });
      } else {
        const k = Math.floor(E.L / 4.5);
        for (let i = 0; i < k; i++) { const m = (i + 0.5) * E.L / k; ops.push({ s0: m - 0.8, s1: m + 0.8, y0: L1 + 1.0, y1: L1 + 2.9, depth: 0.25, glass: 'cellsDark', cell: true }); }
      }
      wallWithOpenings(kit, E, y0, y1, ops, { wallKey: 'bbrick', vRef: L1, uStart: u, rand, cellUV });
      return true;
    },
  });
  // coffered soffit under the overhang
  kit.cap('coffer', upper, U0 - 0.001, false, [ground]);
  // slender white columns under the corners of the overhang
  const cols = insetRing(upper, 0.9);
  for (const p of cols) kit.box('precast', p[0], (base + U0) / 2, p[1], 0.5, U0 - base, 0.5, southE.rot);
  // terrace (walkable) with brown brick sides and white railings, steps at the south-west corner
  const terr = insetRing(upper, -0.7);
  kit.cap('terrace', terr, L1, true);
  kit.ringWalls('bbrick', terr, base, L1, { vRef: L1 });
  bandRing(kit, 'precast', terr, L1 - 0.06, 0.12, 0.14);
  {
    const E = southE, off = 0.64, yr = L1 + 1.05;
    if (!low) for (let s = 2.4; s < E.L + 0.6; s += 1.6) edgeBox(kit, 'rail', E, s, off, L1, yr, 0.06, 0.06);
    kit.beam('rail', E.P3(2.4, yr, off), E.P3(E.L + 0.6, yr, off), 0.08, 0.08);
    kit.beam('rail', E.P3(2.4, L1 + 0.5, off), E.P3(E.L + 0.6, L1 + 0.5, off), 0.04, 0.04);
    // steps up from the Forbes sidewalk at the west end
    const g = ctx.heightAt(...E.P(E.L - 0.2, 1.6));
    const nSt = Math.max(2, Math.round((L1 - g) / 0.16));
    for (let k = 0; k < nSt; k++) {
      const top = L1 - (k + 1) * (L1 - g) / (nSt + 1);
      edgeBox(kit, 'terrace', E, E.L - 0.6, 0.7 + 0.32 * (k + 0.5), base, top + 0.02, 2.2, 0.32);
    }
    // entrance canopy with the address, glazed doors behind it
    const m = E.L / 2 + 1.0;
    edgeBox(kit, 'precast', E, m, -OH + 1.35, U0 - 1.35, U0 - 0.45, 4.8, 2.7);
    signOnEdge(kit, 'signs', E, m, U0 - 0.9, 4.4, 0.62, signUV('forbes'), -OH + 2.72);
    if (!low) edgeBox(kit, 'lamp', E, m, -OH + 1.35, U0 - 1.37, U0 - 1.34, 3.8, 1.8, { faces: { ny: 1 } });
    kit.quad('door', E.P3(m - 1.6, L1, -OH + 0.03), E.P3(m + 1.6, L1, -OH + 0.03), E.P3(m + 1.6, L1 + 3.0, -OH + 0.03), E.P3(m - 1.6, L1 + 3.0, -OH + 0.03), E.n, [0, 0], [3.2, 0], [3.2, 3], [0, 3]);
  }
  if (!low) rooftopUnits(kit, 'mech', upper, U1, 5, rand, { rot: southE.rot, margin: 3 });

  const group = kit.build({ ...materials(ctx), terrace: ctx.materials.get('sidewalk') }, { name: 'landmark:cttec' });
  const deck = group.children.find((m) => m.name.split(':').pop().split('+').includes('terrace'));
  if (deck) ctx.walkables?.add(deck);
  ctx.colliders.addPolygon(ground, base, U0, 'cttec');
  ctx.colliders.addPolygon(upper, U0, U1 + 0.5, 'cttec');
  for (const [x, z] of cols) ctx.colliders.addCircle(x, z, 0.35, base, U0, 'cttec');
  const c = ringCentroid(upper);
  registerCraig(ctx, group, {
    key: 'cttec', name: '4615 Forbes · Technology Transfer & Enterprise Creation', nameZh: '技术转移与创业中心', osmId: CTTEC_ID,
    position: [c[0], U1, c[1]], radius: 25, labelY: U1 + 5, priority: 6, maxDistance: 900,
  });
  return group;
}

// A failure in one building must not take the others down (main.js also guards each build).
const safe = (key, fn) => async (ctx) => {
  try { return await fn(ctx); } catch (e) { console.error(`[craig] ${key} failed`, e && e.stack); return null; }
};

export default [
  { key: 'sei', name: 'Software Engineering Institute', nameZh: '软件工程研究所', osmIds: [SEI_ID], build: safe('sei', buildSEI) },
  { key: 'ini', name: 'Information Networking Institute', nameZh: '信息网络研究所', osmIds: [INI_ID], build: safe('ini', buildINI) },
  { key: 'craig300', name: '300 South Craig Street', nameZh: '克雷格南街 300 号', osmIds: [C300_ID], build: safe('craig300', build300) },
  { key: 'craig407', name: '407 South Craig Street', nameZh: '克雷格南街 407 号', osmIds: [C407_ID], build: safe('craig407', build407) },
  { key: 'cttec', name: 'Center for Technology Transfer and Enterprise Creation', nameZh: '技术转移与创业中心', osmIds: [CTTEC_ID], build: safe('cttec', buildCTTEC) },
];
