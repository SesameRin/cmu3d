// Baker Hall (1914), Porter Hall (1905/1915) and Doherty Hall (1908) — Palmer & Hornbostel's buff-brick Beaux-Arts
// ranges lining the west half of CMU's Mall. Owner: lm-mall-west.
//
// Baker and Porter are one continuous building (the famous ~1000-ft corridor runs through both): a long spine along
// the south side of the Mall with short wings projecting toward the Mall and toward Frew Street. The corridor
// SLOPES with the Mall (it climbs ~13 m from the Hamerschlag end to the CFA end), so the floor level steps up in
// sections: Porter, Baker west and Baker east each sit just above their own Mall-side grade. Toward the Mall they
// show the real two-storey elevation — tall rectangular windows below, tall round-arched windows above, bracketed
// eaves under low hipped pale grey-green metal roofs with green-copper eaves, hips and ridges; extra storeys only
// appear where the ground really falls away (Porter's end toward Junction Hollow).
// Doherty faces them across the Mall (three storeys to the Mall, five more toward the Gates/Wean valley), with
// hipped roofs on its perimeter ranges and the chemistry labs' exhaust stacks on the flat centre.
// Other vocabulary: terracotta belt courses, granite water table, classical door surrounds with stairs down to the
// Mall, an arcaded loggia in the court where Porter meets Baker, and Baker's tall stair window at the east end.
import {
  createFrame, Kit, wallFrame, facade, roofDeck, hipRoof, wbox, wrect, warchPanel, wreveal, stairFlight,
  tallBay, doorSurround, ccw, cylinder, inscription, settleMallWest,
} from './lib/mallWest-kit.js';
import { buildingById } from '../core/placement.js';

const BAKER = 'w27590907', PORTER = 'w27549961', DOHERTY = 'w27574545';

const settled = (key, fn) => async (ctx) => { try { return fn(ctx); } finally { settleMallWest(ctx, key); } };

export default [
  { key: 'baker', name: 'Baker Hall', nameZh: '贝克楼', osmIds: [BAKER], build: settled('baker', buildBaker) },
  { key: 'porter', name: 'Porter Hall', nameZh: '波特楼', osmIds: [PORTER], build: settled('porter', buildPorter) },
  { key: 'doherty', name: 'Doherty Hall', nameZh: '多尔蒂楼', osmIds: [DOHERTY], build: settled('doherty', buildDoherty) },
];

// ------------------------------------------------------------------------------------------------ levels
// Max grade sampled along local lines [u0..u1] x {v...}
function gradeMax(F, u0, u1, vs, step = 3) {
  let m = -Infinity;
  for (let u = u0; u <= u1 + 1e-6; u += step) for (const v of vs) m = Math.max(m, F.ground(u, v));
  return m;
}
// Porter: just above the grade along its Mall (north) front
const porterDatum = (F) => gradeMax(F, 2.5, 41.2, [23.4, 24.4]) + 0.3;
// Baker: two sections split at the Mall wing east of the second entrance (u = 125 / 125.9)
const BAKER_SPLIT = 125;
function bakerDatums(F) {
  return {
    W: gradeMax(F, 69.5, BAKER_SPLIT, [27.7, 44]) + 0.3,
    E: gradeMax(F, BAKER_SPLIT, 209.3, [27.6, 44.2]) + 0.3,
  };
}

// Two-storey Mall elevation (+ storeys below the floor wherever the ground falls away)
const TOP2 = 11.65;
function rangeTiers(D, below = 3) {
  const t = [];
  for (let k = below; k >= 1; k--) {
    t.push({ y0: D - 4.4 * k, y1: D - 4.4 * (k - 1), kind: 'rect', w: 1.8, sill: k === 1 ? 1.2 : 1.0, head: 0.8, trim: 'simple' });
  }
  t.push(
    { y0: D, y1: D + 5.2, kind: 'rect', w: 1.9, sill: 0.9, head: 0.7 },
    { y0: D + 5.2, y1: D + 11.0, kind: 'arch', w: 2.1, sill: 0.8, head: 0.45 },
  );
  return t;
}
function rangeSpec(D, F, bottom, extra = {}) {
  return {
    bottom, top: D + TOP2, tiers: rangeTiers(D, extra.below ?? 3), bay: 3.9, end: 1.3, depth: 0.38, ground: F.ground,
    belts: [
      { y: D - 0.2, h: 0.45, proj: 0.12, mat: 'granite' },
      { y: D + 5.05, h: 0.3, proj: 0.12 },
    ],
    cornice: { y: D + 11.0, layers: [[0.3, 0.1], [0.35, 0.22]] },
    plinth: { h: 0.7, proj: 0.08 },
    ...extra,
  };
}

// Doherty keeps three storeys above its Mall floor
const TOP3 = 13.25;
function dohertyTiers(D, below) {
  const t = [];
  for (let k = below; k >= 1; k--) {
    t.push({ y0: D - 4.4 * k, y1: D - 4.4 * (k - 1), kind: 'rect', w: 1.8, sill: k === 1 ? 1.3 : 1.0, head: k === 1 ? 0.7 : 0.8, trim: 'simple' });
  }
  t.push(
    { y0: D, y1: D + 4.6, kind: 'arch', w: 2.2, sill: 0.95, head: 0.4 },
    { y0: D + 4.6, y1: D + 8.7, kind: 'rect', w: 2.1, sill: 0.9, head: 0.7 },
    { y0: D + 8.7, y1: D + 12.6, kind: 'rect', w: 2.1, sill: 0.85, head: 0.6 },
  );
  return t;
}

const PITCH = 0.36, OVER = 0.95;
const eaveY = (D, top = TOP2) => D + top + OVER * PITCH; // roof plane height at the wall line (soffit sits on the cornice)

// Walls for every edge of a ring. edgeFn(W, a, b, i) → spec | null (skip) | { segments:[spec...] }
function ringWalls(K, ring, edgeFn) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const W = wallFrame(a, b);
    const r = edgeFn(W, a, b, i);
    if (!r) continue;
    const segs = r.segments || [r];
    for (const s of segs) {
      const ops = facade(K, W, s);
      if (s.after) s.after(W, ops);
    }
  }
}

// Entrance: door surround + landing + stairs down to the terrain in front of the door
function entrance(K, F, W, door, { width = 3.4, landing = 1.8, pediment = true } = {}) {
  if (!door) return;
  doorSurround(K, W, door.sL, door.sR, door.yb, door.yt + 0.25, { pediment });
  const sc = door.sc;
  const plan = (d) => W.plan(sc, d);
  let g = F.ground(...plan(landing + 3));
  let n = Math.max(0, Math.round((door.yb - g) / 0.16));
  if (n > 0) g = F.ground(...plan(landing + n * 0.33));
  n = Math.max(0, Math.round((door.yb - g) / 0.16));
  const gLow = Math.min(g, F.ground(...plan(0.5))) - 1;
  wbox(K.m('step'), W, sc - width / 2 - 0.4, sc + width / 2 + 0.4, gLow, door.yb, 0, landing, ['-y']);
  if (n > 0) {
    const r = n * 0.33;
    stairFlight(K, plan(landing + r), plan(landing), g, door.yb, width, { ground: (u, v) => F.ground(u, v) });
  }
  // cast-iron lamp standards either side of the landing (glow at night)
  for (const sg of [-1, 1]) {
    const [u, v] = W.plan(sc + sg * (width / 2 + 0.2), landing - 0.3);
    cylinder(K.m('metal'), u, door.yb, v, 0.06, 2.6, { seg: 6 });
    K.m('lamp').box(u - 0.16, door.yb + 2.6, v - 0.16, u + 0.16, door.yb + 3.05, v + 0.16);
    K.m('metal').box(u - 0.2, door.yb + 3.05, v - 0.2, u + 0.2, door.yb + 3.15, v + 0.2);
  }
}

function finishLandmark(ctx, F, K, group, { key, name, nameZh, osmId, labelAt, pickAt, radius, colliderTop }) {
  const [px, pz] = F.toWorld(pickAt[0], pickAt[1]);
  const entry = { key, kind: 'landmark', name, nameZh, osmId, infoKey: osmId, position: [px, pickAt[2], pz], radius };
  K.commit(group, entry, { walkKeys: ['step', 'paver'] });
  const rec = buildingById(ctx.data, osmId);
  if (rec) ctx.colliders.addPolygon(rec.footprint, rec.ground.min - 2, colliderTop, osmId);
  ctx.pick.add(group, entry);
  const [lx, lz] = F.toWorld(labelAt[0], labelAt[1]);
  ctx.labels.add({ key: `landmark:${key}`, text: name, textZh: nameZh, kind: 'landmark', priority: 9, osmId, infoKey: osmId, position: { x: lx, y: labelAt[2], z: lz } });
  return group;
}

// Copper-capped ridge ventilator
function ventilator(K, u, v, yRidge) {
  K.m('brick').box(u - 0.9, yRidge - 1, v - 0.9, u + 0.9, yRidge + 1.3, v + 0.9);
  hipRoof(K, { u0: u - 0.9, u1: u + 0.9, v0: v - 0.9, v1: v + 0.9, y: yRidge + 1.3, pitch: 0.6, over: 0.25, mat: 'verdigris', axis: 'u' });
}

// ================================================================================================ BAKER HALL
// Squared OSM footprint in the local frame, split into a west and an east section (the floor steps up between them
// at the Mall wing east of the middle entrance). Spine v 44..62, wings toward the Mall (v<44) and Frew St (v>62).
const BAKER_W = [
  [69.5, 27.8], [86, 27.8], [86, 44], [108.5, 44], [108.5, 27.7], [125, 27.7], [125, 44], [125, 53], [125.9, 53],
  [125.9, 62], [103.5, 62], [103.5, 82.4], [87.5, 82.4], [87.5, 62], [69.5, 62],
];
const BAKER_E = [
  [125, 44], [147.2, 44], [147.2, 27.6], [164, 27.6], [164, 44.2], [189, 44.2], [189, 37.8], [207.3, 37.8],
  [207.3, 45.2], [209.3, 45.2], [209.3, 60.6], [207.2, 60.6], [207.2, 68], [189.1, 68], [189.1, 62], [183, 62],
  [183, 82.8], [165.3, 82.8], [165.3, 62], [142.6, 62], [142.6, 82.3], [125.9, 82.3], [125.9, 62], [125.9, 53], [125, 53],
];
const onCut = ([u, v]) => (Math.abs(u - 125) < 0.01 && v >= 44 - 0.01 && v <= 53.01)
  || (Math.abs(v - 53) < 0.01 && u >= 124.99 && u <= 125.91)
  || (Math.abs(u - 125.9) < 0.01 && v >= 52.99 && v <= 62.01);

export function buildBaker(ctx) {
  const F = createFrame(ctx);
  const K = new Kit(ctx, F);
  const group = F.group('landmark:baker');
  const rec = buildingById(ctx.data, BAKER);
  const DP = porterDatum(F);
  const { W: DW, E: DE } = bakerDatums(F);
  const bottom = (rec ? rec.ground.min : DW - 6) - 1.6;
  const doors = [];

  const sections = [
    { ring: ccw(BAKER_W), D: DW, cutFrom: null },
    { ring: ccw(BAKER_E), D: DE, cutFrom: DW < DE - 0.3 ? DW + TOP2 - 0.4 : null },
  ];
  for (const sec of sections) {
    const D = sec.D;
    ringWalls(K, sec.ring, (W, a, b) => {
      const base = rangeSpec(D, F, bottom, { below: 2 });
      // the step between the two sections: only the higher section shows a wall, above the lower one's eaves
      if (onCut(a) && onCut(b)) {
        if (sec.cutFrom === null) return null;
        return { ...base, bottom: sec.cutFrom, bays: 0, plinth: null, belts: [] };
      }
      // west end: middle part is shared with Porter (which sits lower: wall rises above Porter's eaves)
      if (a[0] === 69.5 && b[0] === 69.5) {
        const s0 = Math.min(Math.abs(a[1] - 61), Math.abs(a[1] - 46.8)), s1 = Math.max(Math.abs(a[1] - 61), Math.abs(a[1] - 46.8));
        const segs = [{ ...base, s0: 0, s1: s0, bays: 0 }, { ...base, s0: s1, s1: W.L }];
        if (DP < D - 0.3) segs.push({ ...base, s0, s1, bottom: DP + TOP2 - 0.4, bays: 0, plinth: null, belts: [] });
        return { segments: segs };
      }
      // east end: tall stair window between two bays
      if (a[0] === 209.3 && b[0] === 209.3) {
        const mid = [5.2, W.L - 5.2];
        return {
          segments: [
            { ...base, s0: 0, s1: mid[0] },
            { ...base, s0: mid[0], s1: mid[1], bays: 0, noWall: true,
              after: () => tallBay(K, W, { s0: mid[0], s1: mid[1], bottom, top: D + TOP2, yb: D + 0.9, yt: D + 10.3, w: 3.2, spandrels: [D + 5.1], mullions: 2 }) },
            { ...base, s0: mid[1], s1: W.L },
          ],
        };
      }
      // spine walls facing the Mall between the wings → central entrance with stairs
      const facingMall = W.n[2] < -0.9 && Math.abs(a[1] - 44) < 0.5 && W.L > 15;
      if (facingMall) {
        return {
          ...base,
          override: (i, T, sc, nb) => {
            if (i !== Math.floor(nb / 2)) return undefined;
            if (Math.abs(T.y0 - D) < 0.01) return { kind: 'door', arch: true, w: 2.4, head: 0.35 };
            if (Math.abs(T.y0 - (D + 5.2)) < 0.01) return { kind: 'arch', sill: 2.0 };
            if (T.y0 < D) return 'blank';
            return undefined;
          },
          after: (W2, ops) => doors.push([W2, ops.find((o) => o.kind === 'door'), D]),
        };
      }
      return base;
    });
  }
  for (const [W, door, D] of doors) {
    if (!door) continue;
    entrance(K, F, W, door, { pediment: false });
    // carved name panel over the door surround
    wbox(K.m('stone'), W, door.sc - 2.1, door.sc + 2.1, D + 6.0, D + 6.85, -0.02, 0.08);
    inscription(K, W, door.sc - 1.95, door.sc + 1.95, D + 6.07, D + 6.78, 0.09, 1);
  }

  // roofs: a spine + wings per section (hipped where the section steps)
  for (const [D, u0, u1] of [[DW, 69.5, BAKER_SPLIT + 0.45], [DE, BAKER_SPLIT + 0.45, 209.3]]) {
    const common = { y: eaveY(D), pitch: PITCH, over: OVER, brackets: 0.95 };
    hipRoof(K, { ...common, u0, u1, v0: 43.6, v1: 61.8, axis: 'u', ends: ['hip', 'hip'] });
  }
  const wingD = (u) => (u < BAKER_SPLIT + 0.5 ? DW : DE);
  for (const [u0, u1, v0] of [[69.5, 86, 27.8], [108.5, 125, 27.7], [147.2, 164, 27.6], [189, 207.3, 37.8]]) {
    hipRoof(K, { y: eaveY(wingD(u0)), pitch: PITCH, over: OVER, brackets: 0.95, u0, u1, v0, v1: 52.7, axis: 'v', ends: ['hip', 'none'] });
  }
  for (const [u0, u1, v1] of [[87.5, 103.5, 82.4], [125.9, 142.6, 82.3], [165.3, 183, 82.8], [189.1, 207.2, 68]]) {
    hipRoof(K, { y: eaveY(wingD(u0)), pitch: PITCH, over: OVER, brackets: 0.95, u0, u1, v0: 52.7, v1, axis: 'v', ends: ['none', 'hip'] });
  }
  // rooftop: copper-capped ventilators along the ridge
  for (const u of [98, 136, 176]) ventilator(K, u, 52.7, eaveY(wingD(u)) + 9.1 * PITCH);

  return finishLandmark(ctx, F, K, group, {
    key: 'baker', name: 'Baker Hall', nameZh: '贝克楼', osmId: BAKER,
    labelAt: [140, 53, eaveY(DE) + 9], pickAt: [140, 53, DW + 6], radius: 75, colliderTop: eaveY(DE) + 4,
  });
}

// ================================================================================================ PORTER HALL
const PORTER_RING = [
  [-11.6, 69.8], [-11.6, 60.5], [-2.5, 60.5], [-2.5, 57.6], [2.5, 57.6], [2.5, 24.4], [41.2, 24.4], [41.2, 43.1],
  [63.8, 43.1], [63.8, 46.8], [69.5, 46.8], [69.5, 61], [44.2, 61], [44.2, 70], [64.1, 70], [64.1, 86.8], [43.8, 86.8],
  [43.8, 85.8], [21, 85.8], [21, 86.8], [-19.1, 86.8], [-19.1, 69.8],
];

export function buildPorter(ctx) {
  const F = createFrame(ctx);
  const K = new Kit(ctx, F);
  const group = F.group('landmark:porter');
  const rec = buildingById(ctx.data, PORTER);
  const D = porterDatum(F);
  const bottom = (rec ? rec.ground.min : D - 13) - 1.6;
  const ring = ccw(PORTER_RING);
  let northDoor = null;
  // north door toward Hamerschlag: on the lowest storey that is still above the ground in front of it
  const gDoor = F.ground(9, 21);
  const doorY0 = [D, D - 4.4, D - 8.8, D - 13.2].filter((y) => y >= gDoor - 0.3).pop() ?? D;

  ringWalls(K, ring, (W, a, b) => {
    const base = rangeSpec(D, F, bottom, { below: 3 });
    if (a[0] === 69.5 && b[0] === 69.5) return null; // shared with Baker
    if (Math.abs(a[1] - 24.4) < 0.1 && Math.abs(b[1] - 24.4) < 0.1) {
      return {
        ...base,
        override: (i, T, sc) => {
          const u = W.plan(sc)[0];
          if (Math.abs(u - 9) < 2.5) {
            if (Math.abs(T.y0 - doorY0) < 0.01) return { kind: 'door', arch: true, w: 2.4, head: 0.35 };
            if (Math.abs(T.y0 - (doorY0 + 4.4)) < 0.01 || T.y0 < doorY0) return 'blank'; // name panel goes above
          }
          return undefined;
        },
        after: (W2, ops) => { northDoor = [W2, ops.find((o) => o.kind === 'door')]; },
      };
    }
    return base;
  });
  if (northDoor && northDoor[1]) {
    const [W, door] = northDoor;
    entrance(K, F, W, door, { landing: 1.6 });
    wbox(K.m('stone'), W, door.sc - 2.1, door.sc + 2.1, door.yt + 2.3, door.yt + 3.15, -0.02, 0.08);
    inscription(K, W, door.sc - 1.95, door.sc + 1.95, door.yt + 2.37, door.yt + 3.08, 0.09, 2);
  }

  // ---- arcaded loggia in the court where Porter meets Baker (covered link between the two entrances)
  {
    const u0 = 41.2, u1 = 69.5, vf = 39.0, vb = 43.1;
    let gmax = -Infinity;
    for (let u = u0; u <= u1; u += 2) gmax = Math.max(gmax, F.ground(u, vf - 0.5), F.ground(u, vb));
    const FL = gmax + 0.15;
    const W = wallFrame([u0, vf], [u1, vf]); // outward normal → -v (the court)
    const nb = 6, pier = 0.9, bw = (W.L - pier) / nb, r = (bw - pier) / 2;
    const SPR = FL + 3.0, TOP = SPR + r + 0.7, ENT = TOP + 0.7;
    const brick = K.m('brick'), trim = K.m('trim');
    const gLow = Math.min(F.ground(u0, vf), F.ground(u1, vf)) - 1;
    wrect(brick, W, 0, W.L, gLow, FL);
    for (let i = 0; i < nb; i++) {
      const sL = pier + i * bw, sR = sL + bw - pier;
      wrect(brick, W, sL - pier, sL, FL, TOP);
      warchPanel(brick, W, sL, sR, SPR, TOP, 0, 12);
      wreveal(K.m('stone'), W, sL, sR, FL, SPR + r, true, vb - vf, 12);
      wbox(trim, W, sL - 0.12, sL, SPR - 0.3, SPR, -0.02, 0.1);
      wbox(trim, W, sR, sR + 0.12, SPR - 0.3, SPR, -0.02, 0.1);
      wbox(K.m('stone'), W, (sL + sR) / 2 - 0.22, (sL + sR) / 2 + 0.22, SPR + r - 0.1, SPR + r + 0.55, -0.02, 0.14);
    }
    wrect(brick, W, W.L - pier, W.L, FL, TOP);
    // entablature, terrace roof with balustrade
    wbox(trim, W, -0.1, W.L + 0.1, TOP, ENT, -0.05, 0.18);
    wbox(trim, W, -0.2, W.L + 0.2, ENT, ENT + 0.18, -(vb - vf) + 0.02, 0.32);
    K.m('lead').box(u0, TOP, vf, u1, ENT - 0.02, vb);
    // balustrade (tops and feet of the balusters are hidden by the rail and the entablature)
    for (let s = 0.4; s < W.L - 0.2; s += 0.34) wbox(trim, W, s - 0.07, s + 0.07, ENT + 0.18, ENT + 0.95, 0.02, 0.16, ['-y', '+y']);
    wbox(trim, W, -0.2, W.L + 0.2, ENT + 0.95, ENT + 1.1, -0.02, 0.24);
    // floor + back wall where Porter's wall steps back
    K.m('paver').box(u0, gLow, vf, u1, FL, vb, ['-y']);
    K.m('brick').box(63.8, FL, vb, 69.5, TOP, vb + 0.3);
    // continuous flight of steps from the court up into the loggia
    let gmin = Infinity;
    for (let u = u0; u <= u1; u += 2) gmin = Math.min(gmin, F.ground(u, vf - 2.5));
    if (FL - gmin > 0.1) {
      const n = Math.round((FL - gmin) / 0.15), run = n * 0.34;
      stairFlight(K, [(u0 + u1) / 2, vf - run], [(u0 + u1) / 2, vf], gmin, FL, u1 - u0, { ground: F.ground, cheek: null });
    }
    ctx.colliders.addBox(...F.toWorld((u0 + u1) / 2, vf + 0.2), (u1 - u0) / 2, 0.3, -F.angle, TOP, ENT + 1.2, 'porter-loggia');
    for (let i = 0; i <= nb; i++) { // arcade piers (walk mode passes under the arches, not through the piers)
      const [x, z] = F.toWorld(u0 + pier / 2 + i * bw, vf + 0.25);
      ctx.colliders.addBox(x, z, pier / 2, 0.25, -F.angle, FL - 0.5, TOP, 'porter-loggia');
    }
  }

  // roofs (Baker's floor is higher, so Porter's spine ends in a hip against Baker's end wall)
  const y = eaveY(D);
  const common = { y, pitch: PITCH, over: OVER, brackets: 0.95 };
  hipRoof(K, { ...common, u0: 2.5, u1: 69.5, v0: 43.6, v1: 61.8, axis: 'u', ends: ['hip', 'hip'] });   // spine
  hipRoof(K, { ...common, u0: 2.5, u1: 41.2, v0: 24.4, v1: 52.7, axis: 'u', ends: ['hip', 'hip'] });   // north block
  hipRoof(K, { ...common, u0: -11.6, u1: 44.2, v0: 60.5, v1: 86.8, axis: 'u', ends: ['hip', 'hip'] });  // south range (Frew St)
  hipRoof(K, { ...common, u0: -19.1, u1: -2, v0: 69.8, v1: 86.8, axis: 'u', ends: ['hip', 'none'] });   // west end toward the Hollow
  hipRoof(K, { ...common, u0: 34, u1: 64.1, v0: 70, v1: 86.8, axis: 'u', ends: ['none', 'hip'] });      // SE wing
  // fill the little sliver at the ANSYS junction
  roofDeck(K, [[-2.5, 57.6], [2.5, 57.6], [2.5, 60.5], [-2.5, 60.5]], y, 'roofFlat');

  return finishLandmark(ctx, F, K, group, {
    key: 'porter', name: 'Porter Hall', nameZh: '波特楼', osmId: PORTER,
    labelAt: [22, 55, y + 9], pickAt: [22, 55, D + 3], radius: 55, colliderTop: y + 4,
  });
}

// ================================================================================================ DOHERTY HALL
const DOHERTY_RING = [
  [98, -93.7], [175.2, -93.7], [175.2, -66], [182.3, -66], [182.3, -71], [200.3, -71], [200.3, -64.4], [201.6, -64.4],
  [201.6, -48.5], [200.3, -48.5], [200.3, -41.5], [182, -41.5], [182, -42.7], [162.2, -42.7], [162.2, -45.5],
  [157.9, -45.5], [157.9, -28.3], [101.6, -28.3], [101.6, -45.3], [99.6, -45.3], [99.6, -65.1], [98, -65.1],
];

export function buildDoherty(ctx) {
  const F = createFrame(ctx);
  const K = new Kit(ctx, F);
  const group = F.group('landmark:doherty');
  const rec = buildingById(ctx.data, DOHERTY);
  const D = gradeMax(F, 102, 157, [-26.5]) + 0.3;   // Mall-level main floor
  const bottom = (rec ? rec.ground.min : D - 22) - 1.6;
  const ring = ccw(DOHERTY_RING);
  const TOP = D + TOP3;
  // central frontispiece on the Mall facade: the 3 middle bays of a 15-bay front (s along the wall)
  const FRONT_L = 157.9 - 101.6, FRONT_END = 1.3, FRONT_BAYS = 15, fbw = (FRONT_L - 2 * FRONT_END) / FRONT_BAYS;
  const FRONT = { s0: FRONT_END + 6 * fbw, s1: FRONT_END + 9 * fbw };
  let frontW = null, frontOps = null;

  ringWalls(K, ring, (W, a, b) => {
    const base = {
      ...rangeSpec(D, F, bottom),
      top: TOP, tiers: dohertyTiers(D, 5),
      pilasters: { y0: D + 4.85, y1: D + 12.6, w: 0.72, proj: 0.13, ends: true },
      belts: [{ y: D - 0.2, h: 0.45, proj: 0.12, mat: 'granite' }, { y: D + 4.5, h: 0.35, proj: 0.13 }, { y: D + 8.6, h: 0.18, proj: 0.07 }],
      cornice: { y: D + 12.6, layers: [[0.3, 0.1], [0.35, 0.22]] },
    };
    const mallFront = Math.abs(a[1] + 28.3) < 0.1 && Math.abs(b[1] + 28.3) < 0.1;
    if (mallFront) {
      return {
        ...base,
        bays: FRONT_BAYS, end: FRONT_END,
        override: (i, T, sc) => {
          const inFront = sc > FRONT.s0 && sc < FRONT.s1;
          if (!inFront) return undefined;
          if (T.y0 === D) return { kind: 'door', arch: true, w: 2.5, head: 0.35 };
          if (T.y0 === D + 4.6) return { kind: 'double', arch: true, w: 2.4, sill: 0.8, head: 0.3, mid: D + 8.65 };
          if (T.y0 === D + 8.7) return 'blank';
          return undefined;
        },
        after: (W2, ops) => { frontW = W2; frontOps = ops; },
      };
    }
    return base;
  });

  // ---- roofs: low hipped ranges round the perimeter, flat centre for the laboratory plant
  const y = eaveY(D, TOP3);
  const common = { y, pitch: PITCH, over: OVER, brackets: 0.95 };
  hipRoof(K, { ...common, u0: 101.6, u1: 157.9, v0: -45.3, v1: -28.3, axis: 'u' });   // Mall range
  hipRoof(K, { ...common, u0: 98, u1: 114, v0: -77, v1: -45.3, axis: 'v' });          // west range
  hipRoof(K, { ...common, u0: 98, u1: 175.2, v0: -93.7, v1: -77, axis: 'u' });        // north range (toward Wean)
  hipRoof(K, { ...common, u0: 157.9, u1: 175.2, v0: -77, v1: -42.7, axis: 'v' });     // east range
  hipRoof(K, { ...common, u0: 175.2, u1: 201.6, v0: -71, v1: -41.5, axis: 'u' });     // east wing
  roofDeck(K, [[114, -77], [157.9, -77], [157.9, -45.3], [114, -45.3]], TOP - 0.05);

  // ---- Mall frontispiece: projecting giant-order pilasters, attic with name panel, monumental stair
  if (frontW) {
    const W = frontW, st = K.m('stone'), tr = K.m('trim');
    const doorsF = frontOps.filter((o) => o.kind === 'door');
    // giant pilasters between the frontispiece bays (on pedestals), rising through storeys 2-3
    const xs = [FRONT.s0 - 0.2, ...doorsF.map((o, i) => (i ? (doorsF[i - 1].sR + o.sL) / 2 : null)).filter((v) => v !== null), FRONT.s1 + 0.2];
    for (const s of xs) {
      wbox(st, W, s - 0.6, s + 0.6, D - 0.2, D + 4.5, -0.02, 0.45);
      wbox(K.m('brick'), W, s - 0.45, s + 0.45, D + 4.5, D + 12.1, -0.02, 0.32);
      wbox(tr, W, s - 0.58, s + 0.58, D + 12.1, D + 12.6, -0.02, 0.42);
    }
    // attic over the frontispiece, standing in front of the roof eave
    wbox(K.m('brick'), W, FRONT.s0 - 0.8, FRONT.s1 + 0.8, TOP - 0.3, TOP + 1.9, -0.6, 1.15);
    wbox(tr, W, FRONT.s0 - 0.95, FRONT.s1 + 0.95, TOP + 1.9, TOP + 2.15, -0.7, 1.3);
    wbox(st, W, FRONT.s0 + 0.2, FRONT.s1 - 0.2, TOP + 0.3, TOP + 1.5, 1.1, 1.22);
    inscription(K, W, FRONT.s0 + 0.5, FRONT.s1 - 0.5, TOP + 0.4, TOP + 1.4, 1.23, 3);
    // monumental stair across the three doors
    const sc = (FRONT.s0 + FRONT.s1) / 2, width = FRONT.s1 - FRONT.s0 - 1;
    const g = Math.min(F.ground(...W.plan(sc, 6)), F.ground(...W.plan(FRONT.s0, 6)), F.ground(...W.plan(FRONT.s1, 6)));
    const n = Math.max(1, Math.round((D - g) / 0.155));
    const landing = 2.4, run = n * 0.34;
    wbox(K.m('step'), W, FRONT.s0 - 0.8, FRONT.s1 + 0.8, g - 1, D, 0, landing, ['-y']);
    stairFlight(K, W.plan(sc, landing + run), W.plan(sc, landing), g, D, width, { ground: F.ground, cheekH: 0.7 });
    for (const sg of [-1, 1]) {
      const [u, v] = W.plan(sc + sg * (width / 2 + 0.25), landing + run - 0.3);
      K.m('granite').box(u - 0.45, g - 0.5, v - 0.45, u + 0.45, g + 1.3, v + 0.45, ['-y']);
      cylinder(K.m('metal'), u, g + 1.3, v, 0.07, 2.4, { seg: 6 });
      K.m('lamp').box(u - 0.2, g + 3.7, v - 0.2, u + 0.2, g + 4.2, v + 0.2);
      K.m('metal').box(u - 0.25, g + 4.2, v - 0.25, u + 0.25, g + 4.32, v + 0.25);
    }
  }

  // ---- flat centre: laboratory exhaust stacks and mechanical penthouse (chemistry building)
  {
    const R = TOP - 0.05;
    const m = K.m('metal'), le = K.m('lead');
    K.m('brick').box(118, R, -75, 150, R + 3.6, -57);
    K.m('trim').box(117.7, R + 3.6, -75.3, 150.3, R + 3.85, -56.7);
    le.box(118.2, R + 3.85, -74.8, 149.8, R + 3.95, -57.2);
    for (let i = 0; i < 6; i++) {
      const u = 121 + i * 5;
      cylinder(m, u, R + 3.9, -66, 0.45, 3.2, { seg: 12 });
      cylinder(K.m('aluminium'), u, R + 7.1, -66, 0.5, 0.25, { seg: 12 });
    }
    for (const [u, v] of [[124, -50.5], [148, -50.5]]) {
      m.box(u - 2.5, R, v - 1.8, u + 2.5, R + 1.9, v + 1.8);
      le.box(u - 2.6, R + 1.9, v - 1.9, u + 2.6, R + 2.0, v + 1.9);
    }
  }

  return finishLandmark(ctx, F, K, group, {
    key: 'doherty', name: 'Doherty Hall', nameZh: '多尔蒂楼', osmId: DOHERTY,
    labelAt: [138, -62, y + 12], pickAt: [138, -62, D], radius: 60, colliderTop: y + 4,
  });
}
