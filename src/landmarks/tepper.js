// Tepper School of Business — the Tepper Quad building (David A. Tepper Quadrangle, 2018, Moore Ruble Yudell
// Architects). A five-storey business school on the north side of Forbes Avenue, organised around a big skylit
// atrium ("the Forum"). Outside it reads as rectilinear volumes of long, thin "Roman" brick in a golden-khaki blend
// (light, medium and a few orange units), cut by horizontal strip windows of varied length under white aluminium
// sunshades, and counterpointed by glazed "void" boxes that are syncopated and cantilevered at the corners.
//
// Forbes Avenue side: a continuous transparent street storey (the Welcome Center) under the brick, a one-storey glass
// box cantilevered from the long brick block, a glass corner tower at the west end, and in the middle a full-height
// glass section with the main entrance — a glass canopy on white steel beams carrying the school's name in letters.
// Quad side (east): the atrium's five-storey glass wall at the back of an entrance court, flanked by brick blocks
// whose corners carry glass boxes cantilevered on slender columns. The ground falls ~10 m to the north-west, where a
// lower storey appears.
//
// References (for proportions only): Moore Ruble Yudell project photographs (Forbes elevation at dusk, quad side,
// atrium skylight), Commons "Carnegie Mellon University Tepper School of Business.jpg" (entrance lettering, brick,
// sunshades) and orthophotos (atrium roof, rooftop plant).
import {
  MeshKit, massing, punchedWall, groundStats, prng, registerLandmark, ccw, lerp2, pointInRing,
} from './lib/north-kit.js';
import { brickPlain, cellUV, plain, glz, signAtlas, signQuad } from './lib/north-materials.js';

// OSM footprint w583510520
const T = [
  [-145.9, -259.6], [-159.1, -259.0], [-172.3, -234.1], [-157.6, -226.4], [-174.6, -193.9], [-212.6, -192.1], [-224.8, -185.8],
  [-229.8, -190.5], [-239.7, -185.1], [-263.7, -187.3], [-264.1, -194.7], [-270.8, -194.4], [-269.9, -204.3], [-264.9, -204.5],
  [-265.3, -217.7], [-225.8, -219.0], [-211.9, -247.5], [-192.1, -285.4], [-130.9, -288.1],
];
const L1 = 37.0, FH = 4.6;                     // level 1 = Forbes Avenue; the quad is entered on level 2
const lv = (n) => L1 + (n - 1) * FH;           // roof = lv(6) = 60.0
const ROOF = lv(6);
const SPLIT = 14.5;                            // metres of brick at the east end of the V4-V5 Forbes frontage
// atrium skylight (parallelogram along the building's diagonal axis, east edge just inside the court's glass wall)
const ATR = [[-189.5, -253.0], [-163.0, -253.4], [-183.7, -214.4], [-210.2, -214.0]];

const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.3;
const isEdge = (a, b, i, j) => (same(a, T[i]) && same(b, T[j])) || (same(a, T[j]) && same(b, T[i]));
// outward unit normal of edge a→b of the footprint (checked against the ring, so orientation does not matter)
function outward(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  let n = [dz / l, -dx / l];
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  if (pointInRing(mx + n[0] * 0.4, mz + n[1] * 0.4, T)) n = [-n[0], -n[1]];
  return n;
}

// strip-window rows (y above L1): a lower storey on the falling north-west side, the street storey, then four brick
// storeys with windows of changing length so the facade does not read as a grid
const LEVELS = [
  { y: -3.6, h: 2.6, winW: 3.6, bay: 6.0, lights: 3 },
  { y: 1.0, h: 2.8, winW: 3.6, bay: 6.0, lights: 3 },
  { y: 5.6, h: 2.3, winW: 2.2, bay: 5.2, lights: 2 },
  { y: 10.2, h: 2.6, winW: 7.2, bay: 12.0, lights: 5 },
  { y: 14.8, h: 2.6, winW: 5.0, bay: 8.2, lights: 4 },
  { y: 19.4, h: 2.6, winW: 7.2, bay: 12.0, lights: 5 },
];

async function buildTepper(ctx) {
  const LOW = ctx.quality?.level === 'low';
  const kit = new MeshKit();
  const rand = prng(2018);
  const gs = groundStats(ctx, T, 4);
  const base = gs.min - 1.5;
  const H = (x, z) => ctx.heightAt(x, z);

  // ---------------------------------------------------------------- volumes
  const glassTower = [T[10], T[11], T[12], T[13]];
  const towerEdge = (a, b) => isEdge(a, b, 10, 11) || isEdge(a, b, 11, 12) || isEdge(a, b, 12, 13);
  // street storey: transparent to Forbes (and round the west end), glazed at the atrium wall in the quad court
  const baseEdge = (a, b) => {
    if (isEdge(a, b, 1, 2) || towerEdge(a, b)) return 'court';
    const n = outward(a, b);
    return n[1] > 0.5 ? 'glassBase' : null;
  };
  // Forbes frontage east of the Forum: the SE brick block returns SPLIT m along Forbes, then the full-height glass
  // entrance section runs to the long brick block (the massing ring gets an extra vertex there)
  const d45 = [(T[5][0] - T[4][0]) / 38.04, (T[5][1] - T[4][1]) / 38.04];
  const P45 = [T[4][0] + d45[0] * SPLIT, T[4][1] + d45[1] * SPLIT];
  const TM = [...T.slice(0, 5), P45, ...T.slice(5)];
  const glassEntry = (a, b) => (same(a, P45) && same(b, T[5])) || (same(a, T[5]) && same(b, P45));
  const upperEdge = (a, b) => {
    if (isEdge(a, b, 1, 2)) return 'court';                  // the Forum's five-storey glass wall
    if (glassEntry(a, b) || towerEdge(a, b)) return 'voidGlass';   // full-height glass entrance section / west tower
    return null;
  };
  const vols = [
    { ring: TM, y0: base, y1: lv(2), wallKey: 'brickP', edgeKey: baseEdge, roofKey: false, vRef: L1, win: true },
    { ring: TM, y0: lv(2), y1: ROOF, wallKey: 'brickP', edgeKey: upperEdge, roofKey: 'flat', parapet: 0.9, parapetKey: 'brickP', copingKey: 'coping', vRef: L1, win: true },
    // the west glass tower rises a little above the brick
    { ring: glassTower, y0: ROOF, y1: ROOF + 2.6, wallKey: 'voidGlass', roofKey: 'coping', vRef: L1 },
  ];

  // glazed "void" boxes, cantilevered / rotated off the brick grid: returns their rings (for colliders)
  const boxes = [];
  const along = (i, j, s, off) => {
    const a = T[i], b = T[j], l = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], n = outward(a, b);
    return { p: [a[0] + d[0] * s + n[0] * off, a[1] + d[1] * s + n[1] * off], d, n, l };
  };
  const rot = (p, c, deg) => { const t = (deg * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t); const dx = p[0] - c[0], dz = p[1] - c[1]; return [c[0] + dx * cs - dz * sn, c[1] + dx * sn + dz * cs]; };
  const voidBox = (i, j, s0, s1, dIn, dOut, y0, y1, deg = 0, column = null) => {
    const A = along(i, j, s0, 0), B = along(i, j, s1, 0);
    let ring = [
      [A.p[0] - A.n[0] * dIn, A.p[1] - A.n[1] * dIn], [B.p[0] - B.n[0] * dIn, B.p[1] - B.n[1] * dIn],
      [B.p[0] + B.n[0] * dOut, B.p[1] + B.n[1] * dOut], [A.p[0] + A.n[0] * dOut, A.p[1] + A.n[1] * dOut],
    ];
    const c = [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2];
    ring = ring.map((p) => rot(p, c, deg));
    vols.push({ ring, y0, y1, wallKey: 'voidGlass', roofKey: 'coping', soffitKey: 'coping', vRef: L1, parapet: 0 });
    boxes.push({ ring, y0, y1, column });
    return ring;
  };
  // Forbes: one-storey glass box hung on the long brick block (floor 3), and the glass section's box over the entrance
  voidBox(8, 9, 6.5, 19.5, 0.4, 2.1, lv(3) - 0.35, lv(4) + 0.35, 0, 'mid');
  voidBox(4, 5, 25.5, 36.5, 0.4, 2.4, lv(2) + 0.2, lv(4) - 0.2, -4);
  // quad side: glass boxes on the top floors at the corners of the two brick blocks, cantilevered on columns
  voidBox(18, 0, 0.2, 10.5, 7.5, 2.6, lv(4) - 0.2, ROOF + 1.2, 5, 'corner');
  voidBox(3, 4, 0.2, 9.5, 7.0, 2.4, lv(4) - 0.2, ROOF + 1.0, -6, 'corner');
  // north-west corner over the falling ground
  voidBox(16, 17, 31.0, 42.0, 7.0, 1.8, lv(3), ROOF + 0.8, 4);

  massing(kit, vols, {
    wallBuilder(v, a, b, n, y0, y1, u, i, key) {
      if (!v.win || key !== 'brickP') return false;
      const ok = punchedWall(kit, a, b, n, y0, y1, u, L1, {
        levels: LEVELS, bay: 6, winW: 3.6, depth: 0.42, margin: 1.4,
        wallKey: 'brickP', glassKey: 'win', frameKey: LOW ? null : 'wframe', sillKey: null, revealKey: 'reveal', rand, cellUV, ground: H,
      });
      if (ok && !LOW) sunshades(kit, a, b, n, y0, y1, H);
      return ok;
    },
  });

  // ---------------------------------------------------------------- atrium ("the Forum") skylight
  {
    // glass roof sloping down from the west (high) to the court wall (low), glazed clerestory sides
    const yW = ROOF + 3.4, yE = ROOF + 1.2, y0 = ROOF - 0.1;
    const [NW, NE, SE, SW] = ATR;
    const yOf = (p) => { // linear in the across-axis coordinate
      const ax = [0.886, 0.463], s = (q) => q[0] * ax[0] + q[1] * ax[1];
      const t = (s(p) - s(NW)) / (s(NE) - s(NW));
      return yW + (yE - yW) * t;
    };
    const top = (p) => [p[0], yOf(p), p[1]];
    kit.quadH('skylight', top(NW), top(NE), top(SE), top(SW), [0, 1, 0], [0, 0], [26.5, 0], [26.5, 44], [0, 44]);
    const r = ccw(ATR);
    let u = 0;
    for (let k = 0; k < 4; k++) {
      const a = r[k], b = r[(k + 1) % 4], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = [(b[1] - a[1]) / l, 0, -(b[0] - a[0]) / l];
      kit.quad('court', [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], yOf(b), b[1]], [a[0], yOf(a), a[1]], n, [u, y0 - L1], [u + l, y0 - L1], [u + l, yOf(b) - L1], [u, yOf(a) - L1]);
      if (!LOW) kit.beam('coping', [a[0], yOf(a) + 0.12, a[1]], [b[0], yOf(b) + 0.12, b[1]], 0.3, 0.3);
      u += l;
    }
    // white mullion ribs down the slope
    if (!LOW) for (let t = 1 / 12; t < 0.999; t += 1 / 12) {
      const a = lerp2(NW, SW, t), b = lerp2(NE, SE, t);
      kit.beam('coping', [a[0], yOf(a) + 0.1, a[1]], [b[0], yOf(b) + 0.1, b[1]], 0.14, 0.2);
    }
  }

  // ---------------------------------------------------------------- void-box details: frames and columns
  for (const { ring, y0, y1, column } of boxes) {
    const r = ccw(ring);
    for (let k = 0; k < 4; k++) {
      const a = r[k], b = r[(k + 1) % 4];
      kit.beam('coping', [a[0], y1 + 0.15, a[1]], [b[0], y1 + 0.15, b[1]], 0.35, 0.3);
      kit.beam('coping', [a[0], y0 - 0.12, a[1]], [b[0], y0 - 0.12, b[1]], 0.35, 0.24);
      if (!LOW) kit.box('coping', a[0], (y0 + y1) / 2, a[1], 0.18, y1 - y0, 0.18, Math.atan2(-(b[1] - a[1]), b[0] - a[0]));
    }
    if (column) {
      // round column under (corner) or in front of (mid) the cantilever, on its outer side
      const out = r.filter((p) => !pointInRing(p[0], p[1], T));
      const oc = out.length ? [out.reduce((s, p) => s + p[0], 0) / out.length, out.reduce((s, p) => s + p[1], 0) / out.length] : r[0];
      const bc = [r.reduce((s, p) => s + p[0], 0) / 4, r.reduce((s, p) => s + p[1], 0) / 4];
      const dl = Math.hypot(bc[0] - oc[0], bc[1] - oc[1]) || 1, k = column === 'corner' ? 0.9 : 0.35;
      const cx = oc[0] + (bc[0] - oc[0]) / dl * k, cz = oc[1] + (bc[1] - oc[1]) / dl * k;
      if (column === 'corner') {
        kit.cylinder('column', cx, cz, H(cx, cz) - 0.5, y0 - 0.25, 0.32, 0.32, 12, { top: false });
        boxes.colliders = (boxes.colliders || []).concat([[cx, cz]]);
      } else kit.cylinder('column', cx, cz, y0 - 0.1, y1 + 0.1, 0.33, 0.33, 12, { top: false });
    }
  }

  // ---------------------------------------------------------------- Forbes Avenue entrance: glass canopy + lettering
  {
    const E = along(4, 5, SPLIT + 5.4, 0), w = 10.4, d = 4.2, y = lv(2) - 0.9;
    const n = [E.n[0], 0, E.n[1]];
    const rotY = Math.atan2(-E.d[1], E.d[0]);
    const cx = E.p[0] + E.n[0] * d / 2, cz = E.p[1] + E.n[1] * d / 2;
    kit.box('canopyGlass', cx, y + 0.3, cz, w, 0.05, d, rotY, { faces: { py: 1, ny: 1 } });
    // white steel beams (outriggers) and edge girder, one round column at the front
    for (let k = 0; k <= 6; k++) {
      const s = -w / 2 + (k / 6) * w, p0 = [E.p[0] + E.d[0] * s, E.p[1] + E.d[1] * s];
      kit.beam('white', [p0[0], y + 0.12, p0[1]], [p0[0] + E.n[0] * d, y + 0.05, p0[1] + E.n[1] * d], 0.16, 0.34);
    }
    kit.beam('white', [E.p[0] - E.d[0] * w / 2 + E.n[0] * d, y + 0.1, E.p[1] - E.d[1] * w / 2 + E.n[1] * d],
      [E.p[0] + E.d[0] * w / 2 + E.n[0] * d, y + 0.1, E.p[1] + E.d[1] * w / 2 + E.n[1] * d], 0.2, 0.4);
    const colX = E.p[0] + E.n[0] * (d - 0.6), colZ = E.p[1] + E.n[1] * (d - 0.6);
    kit.cylinder('white', colX, colZ, H(colX, colZ) - 0.4, y, 0.26, 0.26, 12, { top: false });
    kit.box('lamp', cx, y - 0.14, cz, w - 1, 0.03, d - 0.8, rotY, { faces: { ny: 1 } });
    boxes.colliders = (boxes.colliders || []).concat([[colX, colZ]]);
    if (!LOW) {
      // letters stand on the canopy's front edge: the university over the school
      const A = signAtlas(ctx);
      const fx = E.p[0] + E.n[0] * (d - 0.2), fz = E.p[1] + E.n[1] * (d - 0.2);
      signQuad(kit, 'sign', A, 1, fx, y + 1.12, fz, n, 0.62);
      signQuad(kit, 'sign', A, 2, fx, y + 0.62, fz, n, 0.46);
    }
  }
  // quad entrance canopy in the court (level 2)
  {
    const [p, q] = [T[1], T[2]];
    const mid = lerp2(p, q, 0.62);
    const dd = [q[0] - p[0], q[1] - p[1]], l = Math.hypot(...dd);
    const rotY = Math.atan2(-(dd[1] / l), dd[0] / l);
    const n = outward(p, q);
    kit.box('coping', mid[0] + n[0] * 2.5, lv(2) + 4.3, mid[1] + n[1] * 2.5, l * 0.5, 0.35, 5, rotY);
    kit.box('lamp', mid[0] + n[0] * 2.5, lv(2) + 4.1, mid[1] + n[1] * 2.5, l * 0.45, 0.04, 4, rotY, { faces: { ny: 1 } });
  }

  // ---------------------------------------------------------------- rooftop plant (screened)
  const plant = (cx, cz, w, d, h, r, y = ROOF) => kit.box('plant', cx, y + h / 2, cz, w, h, d, r);
  plant(-178, -272, 22, 9, 3.2, 0.04);
  plant(-160, -266, 8, 6, 2.2, 0.04);
  plant(-236, -206, 10, 7, 2.5, 0.03);
  plant(-201, -230, 7, 5, 2.0, -0.45);
  if (!LOW) {
    plant(-252, -200, 5, 4, 1.8, 0.03);
    plant(-170, -205, 6, 4, 1.8, 0.05);
  }

  // ---------------------------------------------------------------- materials & registration
  const M = ctx.materials;
  // golden-khaki Roman-brick blend: light / medium / darker and a few orange units, close in value
  const golden = ['#e0bc8e', '#d6ad7c', '#ebcfa4', '#cca276', '#dfa56d', '#f0dcb8'];
  const brickP = brickPlain(ctx, { colors: golden, weights: [3, 3, 2, 2, 1, 1], brickW: 0.53, brickH: 0.05, joint: 0.011, mortar: '#dccfb4' });
  const alu = plain(ctx, '#d9dcde', { roughness: 0.35, metalness: 0.55 });
  const group = kit.build({
    brickP,
    reveal: brickP,
    win: glz(ctx, 'winTepper'),
    wframe: alu,
    shade: plain(ctx, '#e6e8e8', { roughness: 0.55, metalness: 0.15 }),
    white: plain(ctx, '#eceeee', { roughness: 0.45, metalness: 0.2 }),
    column: plain(ctx, '#cfd2d3', { roughness: 0.5, metalness: 0.3 }),
    glassBase: glz(ctx, 'lightCurtain', 1.6, FH),
    court: glz(ctx, 'tepperCourt', 1.8, FH),
    voidGlass: glz(ctx, 'tepperVoid', 1.5, FH),
    skylight: glz(ctx, 'skylight', 1.6, 1.6),
    canopyGlass: glz(ctx, 'skylight', 1.4, 1.4),
    lamp: glz(ctx, 'lamp'),
    sign: signAtlas(ctx).material,
    flat: M.get('flatRoof'),
    coping: alu,
    plant: plain(ctx, '#b9bec1', { roughness: 0.6, metalness: 0.4 }),
  }, { name: 'landmark:tepper' });

  ctx.colliders.addPolygon(T, base, ROOF + 1, 'tepper');
  for (const b of boxes) ctx.colliders.addPolygon(b.ring, b.y0, b.y1, 'tepper');
  for (const [x, z] of boxes.colliders || []) ctx.colliders.addCircle(x, z, 0.4, base, lv(4), 'tepper');
  const c = [-197.5, -236];
  registerLandmark(ctx, group, {
    key: 'tepper', name: 'Tepper School of Business (Tepper Quad)', nameZh: '泰珀商学院（泰珀广场）', osmId: 'w583510520',
    position: [c[0], ROOF, c[1]], radius: 65, labelY: ROOF + 8,
  });
  return group;
}

// White aluminium sunshade (light shelf) over every strip window of the brick storeys: mirrors punchedWall's grid.
function sunshades(kit, a, b, n, y0, y1, H) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const rotY = Math.atan2(-dir[1], dir[0]), margin = 1.4;
  for (const lvl of LEVELS) {
    if (lvl.y < 5) continue;
    const yb = L1 + lvl.y, yt = yb + lvl.h;
    if (yb < y0 + 0.25 || yt > y1 - 0.25) continue;
    if (L < lvl.winW + 2 * margin) continue;
    const nCols = Math.max(1, Math.floor((L - 2 * margin - lvl.winW) / lvl.bay) + 1);
    for (let i = 0; i < nCols; i++) {
      const c = L / 2 + (i - (nCols - 1) / 2) * lvl.bay;
      const x = a[0] + dir[0] * c + n[0] * 0.38, z = a[1] + dir[1] * c + n[2] * 0.38;
      if (H(x, z) > yb) continue;
      kit.box('shade', x, yt + 0.28, z, lvl.winW + 0.3, 0.06, 0.76, rotY, { faces: { px: 1, nx: 1, pz: 1, nz: 1, py: 1, ny: 1 } });
    }
  }
}

export default [
  {
    key: 'tepper',
    name: 'Tepper School of Business (Tepper Quad)',
    nameZh: '泰珀商学院（泰珀广场）',
    osmIds: ['w583510520'],
    build: buildTepper,
  },
];
