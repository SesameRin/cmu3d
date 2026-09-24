// Gates and Hillman Centers for Computer Science (2009, Mack Scogin Merrill Elam Architects) and the
// Randy Pausch Memorial Footbridge that links its 5th floor to the Purnell Center for the Arts.
//
// The complex climbs a hillside above the old Junction Hollow side of campus: the ground drops from ~45 m at the
// Forbes Avenue / Cyert side to ~30 m at the Hamerschlag Drive garage entrance, so the building shows five storeys to
// the north and nine to the south. The architects lifted the bulk of the building above the slope: dark diamond
// zinc-shingle volumes with irregular strips of windows set in chunky silver surrounds float on recessed glass
// plinths and slender columns, shifting and cantilevering over one another; lower blocks carry green roofs.
//
// Model: the OSM footprint (w27623372) is split into hand-placed volumes (north bar, sky link, tower, middle bar,
// south lobe, Newell-Simon link). Floor levels are shared so the Pausch bridge meets level 5 exactly.
import * as THREE from 'three';
import {
  MeshKit, massing, insetRingEdges, edgeShared, groundStats, lerp2, prng, ccw, registerLandmark, ringCentroid, pointInRing,
  punchedWall, bandRing, makeFrame, rectLocal, gableRoof, loggiaPiers, eaveBrackets, orielBay,
} from './lib/north-kit.js';
import {
  zincShingles, cellUV, metalPanels, greenRoof, penguinPanels, ledStrip, rainbowTexture, plain, brickPlain, glz, seamMetal,
} from './lib/north-materials.js';

// ---------------------------------------------------------------- shared levels
const L1 = 30.0, FH = 3.8;
const lv = (n) => L1 + (n - 1) * FH;           // L5 = 45.2 (Pausch bridge level), roof of the tower = lv(10) = 64.2

// OSM footprint w27623372 (world metres, x east / z south)
const F = [
  [-126.6, -8.5], [-143.6, -17.5], [-146.2, -8.7], [-157.0, -14.8], [-155.4, -18.8], [-178.3, -22.2], [-176.3, -36.5],
  [-188.2, -38.0], [-187.4, -41.0], [-166.8, -38.5], [-159.2, -58.8], [-154.2, -77.8], [-145.7, -75.3], [-144.4, -80.0],
  [-120.9, -73.7], [-116.3, -85.5], [-147.8, -97.5], [-147.4, -115.1], [-99.0, -114.1], [-99.0, -109.3], [-97.4, -109.3],
  [-97.1, -111.0], [-91.7, -110.9], [-95.8, -87.7], [-93.8, -87.3], [-95.3, -77.1], [-104.3, -78.7], [-103.2, -85.3],
  [-108.9, -87.5], [-110.6, -83.3], [-113.6, -84.5], [-118.1, -72.8], [-97.1, -66.9], [-113.1, -46.2], [-117.7, -29.5],
  [-132.6, -31.8], [-134.6, -27.9], [-120.8, -18.1],
];
const P1 = lerp2(F[10], F[11], 0.168);   // split line tower / middle bar
const P2 = lerp2(F[33], F[34], 0.371);
const pick = (...ids) => ids.map((i) => (typeof i === 'number' ? F[i] : i));

const RING = {
  north: pick(16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 15),
  link: pick(15, 30, 31, 14),
  tower: pick(P1, 11, 12, 13, 14, 31, 32, 33, P2),
  middle: pick(P2, 34, 35, 36, 6, 9, 10, P1),
  south: pick(36, 37, 0, 1, 2, 3, 4, 5, 6),
  nsh: pick(6, 7, 8, 9),
};

// Pausch bridge (OSM path w158105937): Gates end sits in the notch between F[35] and F[36].
const BRIDGE_A = [-133.44, -30.13], BRIDGE_B = [-66.05, -19.02];

// The walls of the entrance notch where the bridge arrives are fully glazed (a glass "canyon" around the level-5
// entrance), everything else is zinc with punched strips.
const NOTCH_C = [-128.5, -28.0];
function notchGlass(a, b) {
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  return Math.hypot(mx - NOTCH_C[0], mz - NOTCH_C[1]) < 7.5 ? 'curtain' : null;
}

// "Irregular masses piled on top of one another, as though haphazardly": the upper blocks are the footprint
// sub-rings rotated a few degrees about their centroid (and nudged), so they skew and overhang the blocks below.
function rotRing(ring, deg, shift = [0, 0]) {
  const [cx, cz] = ringCentroid(ring), t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return ring.map(([x, z]) => {
    const dx = x - cx, dz = z - cz;
    return [cx + dx * c - dz * s + shift[0], cz + dx * s + dz * c + shift[1]];
  });
}
const UPPER = {
  north: rotRing(RING.north, -3.2, [0.6, -1.0]),   // upper north bar swings out over Forbes-side plaza
  tower: rotRing(RING.tower, 4.5, [0.8, 0.4]),     // tower top twists towards Purnell / the Cut
  south: rotRing(RING.south, 5.0, [0.4, 0.6]),     // south lobe top turns away from the bridge, over the lawn
};

// Full-height glazed slots proud of the zinc skin: [edge start, edge end, from s, to s, y0, y1]
// (tower ring index 6→7 = footprint F32→F33, north ring 0→1 = F16→F17, south ring 7→8 = F5→F6)
const SLOTS = [
  [UPPER.tower[6], UPPER.tower[7], 0.6, 5.6, lv(7) + 0.3, lv(10) - 0.2],   // east prow of the tower, facing the Cut
  [F[16], F[17], 2.0, 6.5, lv(5) + 0.3, lv(7) - 0.2],                    // west end of the north bar
  [F[5], F[6], 4.0, 8.5, lv(2) + 0.3, lv(5) - 0.2],                      // south lobe, facing Newell-Simon
];

// True if a window strip (world endpoints, heights) would sit behind one of the glass slots.
function inSlot(x0, z0, x1, z1, y0, y1) {
  for (const [p, q, s0, s1, sy0, sy1] of SLOTS) {
    if (y1 < sy0 || y0 > sy1) continue;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]), dx = (q[0] - p[0]) / L, dz = (q[1] - p[1]) / L;
    for (const [x, z] of [[x0, z0], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]) {
      const s = (x - p[0]) * dx + (z - p[1]) * dz, d = Math.abs(-(x - p[0]) * dz + (z - p[1]) * dx);
      if (d < 2.5 && s > s0 - 1.2 && s < s1 + 1.2) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- windows
// Window strip with a chunky projecting aluminium surround (the Gates signature), glass panes with atlas UVs so each
// pane lights independently at night, and slim mullions.
function addWindow(kit, rand, a, dir, n, s0, s1, y0, y1, depth = 0.42) {
  const f = 0.17;
  const rotY = Math.atan2(-dir[1], dir[0]);
  const at = (s, off) => [a[0] + dir[0] * s + n[0] * off, a[1] + dir[1] * s + n[2] * off];
  const panes = Math.max(1, Math.round((s1 - s0) / 1.55));
  const pw = (s1 - s0) / panes;
  for (let p = 0; p < panes; p++) {
    const sa = s0 + p * pw, sb = sa + pw;
    const A = at(sa, 0.04), B = at(sb, 0.04);
    const [u0, v0, u1, v1] = cellUV(rand);
    kit.quad('glass', [A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], n, [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
    if (p > 0) { const m = at(sa, 0.09); kit.box('frame', m[0], (y0 + y1) / 2, m[1], 0.07, y1 - y0, 0.1, rotY, { faces: { px: 1, nx: 1, nz: 1, py: 0, ny: 0 } }); }
  }
  const len = s1 - s0 + 2 * f, mid = at((s0 + s1) / 2, depth / 2), faces = { px: 1, nx: 1, nz: 1, py: 1, ny: 1 };
  kit.box('frame', mid[0], y1 + f / 2, mid[1], len, f, depth, rotY, { faces });           // head
  kit.box('frame', mid[0], y0 - f / 2, mid[1], len, f, depth, rotY, { faces });           // sill
  const l = at(s0 - f / 2, depth / 2), r = at(s1 + f / 2, depth / 2);
  kit.box('frame', l[0], (y0 + y1) / 2, l[1], f, y1 - y0, depth, rotY, { faces });         // jambs
  kit.box('frame', r[0], (y0 + y1) / 2, r[1], f, y1 - y0, depth, rotY, { faces });
}

// ---------------------------------------------------------------- Gates building
async function buildGates(ctx) {
  const kit = new MeshKit();
  const rand = prng(2009);
  const H = (x, z) => ctx.heightAt(x, z);

  // --- volumes (body = zinc, cantilevered over recessed glass plinths)
  const bodies = [
    // north bar: its west end cantilevers ~7 m over the path climbing from Forbes Avenue
    { tag: 'north', ring: RING.north, y0: lv(5), y1: lv(7), plinthInset: (a, b) => (Math.max(a[0], b[0]) < -146 ? 7.5 : 2.6), roof: 'roof', floors: [5, 6] },
    { tag: 'northUp', ring: UPPER.north, y0: lv(7), y1: lv(9), roof: 'roof', floors: [7, 8], noPlinth: true },
    { tag: 'towerLow', ring: null, base: 'tower', y0: lv(4), y1: lv(7), plinthInset: 3.2, roof: 'roof', floors: [4, 5, 6], inset: 1.6 },
    { tag: 'towerHigh', ring: UPPER.tower, y0: lv(7), y1: lv(10), roof: 'roof', floors: [7, 8, 9], noPlinth: true },
    { tag: 'middle', ring: RING.middle, y0: lv(3), y1: lv(8), plinthInset: 4.0, roof: 'green', floors: [3, 4, 5, 6, 7] },
    // south lobe: deep overhang on the east prow facing the bridge approach; its top two floors twist away
    { tag: 'south', ring: RING.south, y0: lv(2), y1: lv(5), plinthInset: (a, b) => (Math.min(a[0], b[0]) > -127.5 ? 5.5 : 3.0), roof: 'green', floors: [2, 3, 4] },
    { tag: 'southUp', ring: UPPER.south, y0: lv(5), y1: lv(7), roof: 'green', floors: [5, 6], noPlinth: true },
  ];
  const baseRings = [RING.north, RING.tower, RING.middle, RING.south, RING.nsh, RING.link];
  // lower tower: inset on its free edges so the upper floors overhang (shifted, stacked look)
  const towerOthers = [RING.middle, RING.link];
  bodies.find((b) => b.tag === 'towerLow').ring = insetRingEdges(RING.tower, (a, b) => (edgeShared(a, b, towerOthers) ? 0 : 1.6));

  const volumes = [];
  const plinths = [];
  for (const b of bodies) {
    const baseRing = b.base ? RING[b.base] : b.ring;
    const others = baseRings.filter((r) => r !== baseRing);
    b.ring = ccw(b.ring);
    volumes.push({ edgeKey: notchGlass, ring: b.ring, y0: b.y0, y1: b.y1, wallKey: 'zinc', roofKey: b.roof === 'green' ? 'green' : 'roof', soffitKey: 'soffit', parapet: 0.9, copingKey: 'frame', parapetKey: 'zinc', vRef: L1, tag: b.tag, floors: b.floors });
    if (b.noPlinth) continue;
    const g = groundStats(ctx, b.ring, 3);
    const inset = typeof b.plinthInset === 'function' ? b.plinthInset : () => b.plinthInset;
    const pr = insetRingEdges(b.ring, (a, c) => (edgeShared(a, c, others) ? 0 : inset(a, c)));
    const py0 = g.min - 1.5;
    if (b.y0 - py0 > 0.3) {
      plinths.push({ ring: pr, y0: py0, y1: b.y0, body: b });
      volumes.push({ ring: pr, y0: py0, y1: b.y0, wallKey: 'curtain', roofKey: false, vRef: L1, tag: `${b.tag}-plinth`, plinth: true });
    }
  }
  // sky link between north bar and tower, and the Newell-Simon link (glass)
  volumes.push({ ring: RING.link, y0: lv(6), y1: lv(8), wallKey: 'curtain', roofKey: 'roof', soffitKey: 'soffit', parapet: 0.5, copingKey: 'frame', vRef: L1, tag: 'link' });
  volumes.push({ ring: RING.nsh, y0: lv(2), y1: lv(4), wallKey: 'curtain', roofKey: 'roof', soffitKey: 'soffit', parapet: 0.5, copingKey: 'frame', vRef: L1, tag: 'nsh' });

  // --- walls + windows
  const bridgeMid = BRIDGE_A;
  massing(kit, volumes, {
    onWall(vol, a, b, n, y0, y1, u, i, key) {
      if (!vol.floors || key !== 'zinc') return;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 3) return;
      const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      // bridge entrance edge: handled separately
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (Math.hypot(mx - bridgeMid[0], mz - bridgeMid[1]) < 4) return;
      const er = prng(Math.round(a[0] * 31 + a[1] * 17 + vol.y0 * 7) >>> 0);
      // per-wall theme: a few short walls get ribbon windows on alternate floors; the rest get the irregular
      // strips of varying length that give the Gates its restless, "shifting" skin
      const ribbonWall = L > 7 && L < 26 && er() < 0.3;
      let fi = 0;
      for (const k of vol.floors) {
        const yf = lv(k);
        if (yf < y0 - 0.01 || yf + FH > y1 + 0.01) continue;
        const tall = er() < 0.22;
        const wy0 = yf + (tall ? 0.45 : 0.95), wy1 = wy0 + (tall ? 2.75 : 1.75);
        const strips = [];
        const kind = er();
        if (ribbonWall && fi++ % 2 === 0) strips.push([0.9, L - 0.9]);
        else if (kind < 0.88) {
          let s = 0.7 + er() * 2.5;
          while (s < L - 2.2) {
            const len = Math.min(L - 0.7 - s, 1.8 + er() * 6.5);
            if (len > 1.3) strips.push([s, s + len]);
            s += len + 1.0 + er() * 4.5;
          }
        }
        for (const [s0, s1] of strips) {
          // skip windows that would be (partly) underground on the uphill side
          const g0 = H(a[0] + dir[0] * s0, a[1] + dir[1] * s0), g1 = H(a[0] + dir[0] * s1, a[1] + dir[1] * s1);
          if (Math.max(g0, g1) > wy0 - 0.35) continue;
          if (inSlot(a[0] + dir[0] * s0, a[1] + dir[1] * s0, a[0] + dir[0] * s1, a[1] + dir[1] * s1, wy0, wy1)) continue;
          addWindow(kit, rand, a, dir, n, s0, s1, wy0, wy1, er() < 0.2 ? 0.95 : 0.42);
        }
      }
    },
  });

  // --- bridge entrance (level 5 glazed doors + canopy on the notch edge F35-F36)
  {
    const a = F[36], b = F[35]; // ordered so that the outward normal faces the bridge (east)
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let n = [dir[1], 0, -dir[0]];
    if (n[0] * (BRIDGE_B[0] - BRIDGE_A[0]) + n[2] * (BRIDGE_B[1] - BRIDGE_A[1]) < 0) n = [-n[0], 0, -n[2]];
    const y0 = lv(5), y1 = lv(5) + 3.2;
    const A = [a[0] + n[0] * 0.05, a[1] + n[2] * 0.05], B = [b[0] + n[0] * 0.05, b[1] + n[2] * 0.05];
    kit.quad('entry', [A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], n, [0, 0], [L, 0], [L, 3.2], [0, 3.2]);
    const rotY = Math.atan2(-dir[1], dir[0]);
    const c = [(a[0] + b[0]) / 2 + n[0] * 1.2, (a[1] + b[1]) / 2 + n[2] * 1.2];
    kit.box('frame', c[0], y1 + 0.2, c[1], L + 1.0, 0.25, 2.4, rotY);                // canopy
    kit.box('lamp', c[0], y1 + 0.06, c[1], L * 0.6, 0.04, 0.4, rotY, { faces: { ny: 1 } });
  }

  // --- full-height glass slots standing proud of the zinc, framed in aluminium
  for (const [p, q, s0, s1, y0, y1] of SLOTS) {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const dir = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    let n = [dir[1], 0, -dir[0]];
    const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    if (pointInRing(mx + n[0] * 0.5, mz + n[2] * 0.5, F)) n = [-n[0], 0, -n[2]];
    const off = 0.45;
    const A = [p[0] + dir[0] * s0 + n[0] * off, p[1] + dir[1] * s0 + n[2] * off];
    const B = [p[0] + dir[0] * s1 + n[0] * off, p[1] + dir[1] * s1 + n[2] * off];
    const w = s1 - s0;
    kit.quad('curtain', [A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], n, [0, y0 - L1], [w, y0 - L1], [w, y1 - L1], [0, y1 - L1]);
    const rotY = Math.atan2(-dir[1], dir[0]);
    const cx = (A[0] + B[0]) / 2 - n[0] * off / 2, cz = (A[1] + B[1]) / 2 - n[2] * off / 2;
    kit.box('frame', cx, y1 + 0.12, cz, w + 0.3, 0.24, off + 0.1, rotY);
    kit.box('frame', cx, y0 - 0.12, cz, w + 0.3, 0.24, off + 0.1, rotY);
    for (const s of [s0 - 0.08, s1 + 0.08]) {
      const e = [p[0] + dir[0] * s + n[0] * off / 2, p[1] + dir[1] * s + n[2] * off / 2];
      kit.box('frame', e[0], (y0 + y1) / 2, e[1], 0.16, y1 - y0 + 0.48, off + 0.1, rotY);
    }
  }

  // --- columns under the cantilevers, garage opening, rooftop plant
  const colliders = [];
  for (const p of plinths) {
    const b = p.body;
    const R = b.ring, PR = p.ring;
    for (let i = 0; i < R.length; i++) {
      const [x, z] = R[i], [px, pz] = PR[i];
      const over = Math.hypot(x - px, z - pz);
      if (over < 2.2) continue;
      const cx = x + (px - x) * (0.8 / over), cz = z + (pz - z) * (0.8 / over);
      const g = H(cx, cz);
      if (b.y0 - g < 3) continue;
      kit.cylinder('column', cx, cz, g - 0.5, b.y0, 0.32, 0.26, 10, { top: false });
      colliders.push(['c', cx, cz, 0.35, g - 1, b.y0]);
    }
  }
  // garage entrance on the south lobe plinth (OSM: Gates Garage entrance at (-140,-16))
  {
    const pl = plinths.find((p) => p.body.tag === 'south');
    if (pl) {
      let best = null;
      const R = pl.ring;
      for (let i = 0; i < R.length; i++) {
        const a = R[i], b = R[(i + 1) % R.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const t = Math.max(0, Math.min(1, ((-140 - a[0]) * (b[0] - a[0]) + (-16 - a[1]) * (b[1] - a[1])) / (L * L)));
        const d = Math.hypot(a[0] + (b[0] - a[0]) * t - -140, a[1] + (b[1] - a[1]) * t - -16);
        if (L > 6 && (!best || d < best.d)) best = { a, b, L, t, d };
      }
      if (best) {
        const { a, b, L } = best;
        const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [dir[1], 0, -dir[0]];
        const sMid = Math.max(3.2, Math.min(L - 3.2, best.t * L));
        const P = (s) => [a[0] + dir[0] * s + n[0] * 0.06, a[1] + dir[1] * s + n[2] * 0.06];
        const A = P(sMid - 3), B = P(sMid + 3), g = Math.min(H(A[0], A[1]), H(B[0], B[1]));
        kit.quad('dark', [A[0], g - 0.5, A[1]], [B[0], g - 0.5, B[1]], [B[0], g + 3.0, B[1]], [A[0], g + 3.0, A[1]], n, [0, 0], [6, 0], [6, 3.5], [0, 3.5]);
      }
    }
  }
  // rooftop mechanical units + a lift overrun on the tower and the north bar
  const roofBox = (x, z, w, d, h, rot, y) => { kit.box('mech', x, y + h / 2, z, w, h, d, rot); };
  roofBox(-128, -62, 14, 7, 2.6, 0.27, lv(10));
  roofBox(-139, -70, 6, 5, 3.6, 0.27, lv(10));
  roofBox(-112, -100, 12, 6, 2.2, -0.02, lv(9));
  roofBox(-132, -106, 5, 4, 3.0, -0.02, lv(9));

  // --- materials & mesh (keys sharing a material are merged into one mesh; all glass is one glazing mesh)
  const M = ctx.materials;
  const frame = plain(ctx, '#a3a9af', { roughness: 0.38, metalness: 0.65 });   // silver window surrounds + columns
  const panels = metalPanels(ctx, { color: '#b9bec2', panelW: 1.8, panelH: 0.3, tileM: 3.6 });   // soffits + rooftop plant
  const group = kit.build({
    zinc: zincShingles(ctx),
    frame,
    column: frame,
    glass: glz(ctx, 'winGates'),
    curtain: glz(ctx, 'gatesCurtain', 1.6, FH),
    entry: glz(ctx, 'gatesEntry', 1.2, 3.2),
    dark: glz(ctx, 'dark'),
    lamp: glz(ctx, 'lamp'),
    soffit: panels,
    mech: panels,
    roof: M.get('flatRoof'),
    green: greenRoof(ctx),
  }, { name: 'landmark:gates' });

  // --- colliders
  for (const v of volumes) {
    if (v.tag === 'link' || v.tag === 'nsh' || v.tag === 'towerHigh') {
      ctx.colliders.addPolygon(v.ring, v.y0, v.y1 + 1, 'gates');
      continue;
    }
    ctx.colliders.addPolygon(v.ring, v.y0 - (v.plinth ? 1 : 0), v.y1 + (v.parapet || 0), 'gates');
  }
  for (const [, x, z, r, y0, y1] of colliders) ctx.colliders.addCircle(x, z, r, y0, y1, 'gates');

  const c = ringCentroid(RING.tower);
  registerLandmark(ctx, group, {
    key: 'gates', name: 'Gates and Hillman Centers', nameZh: '盖茨-希尔曼中心', osmId: 'w27623372',
    position: [c[0], lv(10), c[1]], radius: 55, labelY: lv(10) + 6,
  });
  group.userData.triangles = countTris(group);
  return group;
}

// ---------------------------------------------------------------- Randy Pausch Memorial Footbridge
async function buildPauschBridge(ctx) {
  const kit = new MeshKit();
  const A = BRIDGE_A, B = BRIDGE_B;
  const dx = B[0] - A[0], dz = B[1] - A[1], LEN = Math.hypot(dx, dz);
  const dir = [dx / LEN, dz / LEN];
  const side = [dir[1], -dir[0]];          // horizontal unit perpendicular to the bridge (x, z)
  // the penguin panels go on the south (+z) side, facing the lower campus
  const south = side[1] > 0 ? side : [-side[0], -side[1]];
  const north = [-south[0], -south[1]];
  const W = 3.0;                           // deck width
  const yA = lv(5);
  const yB = ctx.heightAt(B[0], B[1]) + 0.12;
  const camber = 0.35;
  const deckY = (t) => yA + (yB - yA) * t + camber * 4 * t * (1 - t);
  const P = (t, off) => [A[0] + dx * t + south[0] * off, A[1] + dz * t + south[1] * off];
  const N = 36;

  // deck (walkable): top surface + edges + slab underside
  const deckT = 0.28;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const y0 = deckY(t0), y1 = deckY(t1);
    const a0 = P(t0, -W / 2), b0 = P(t0, W / 2), a1 = P(t1, -W / 2), b1 = P(t1, W / 2);
    const u0 = t0 * LEN, u1 = t1 * LEN;
    kit.quad('deck', [a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b1[0], y1, b1[1]], [a1[0], y1, a1[1]], [0, 1, 0],
      [u0, -W / 2], [u0, W / 2], [u1, W / 2], [u1, -W / 2]);
    for (const [s, p0, p1] of [[1, b0, b1], [-1, a0, a1]]) {
      kit.quad('steel', [p0[0], y0 - deckT, p0[1]], [p1[0], y1 - deckT, p1[1]], [p1[0], y1, p1[1]], [p0[0], y0, p0[1]],
        [south[0] * s, 0, south[1] * s], [u0, 0], [u1, 0], [u1, deckT], [u0, deckT]);
    }
    // box girder (trapezoid section) under the deck
    const gd = 1.15 + 0.35 * Math.sin(Math.PI * (t0 + t1) / 2); // slightly deeper mid-span
    const gw = 1.7;
    const c0 = P(t0, gw / 2), c1 = P(t1, gw / 2), e0 = P(t0, -gw / 2), e1 = P(t1, -gw / 2);
    const s0 = P(t0, W / 2 - 0.15), s1 = P(t1, W / 2 - 0.15), f0 = P(t0, -W / 2 + 0.15), f1 = P(t1, -W / 2 + 0.15);
    const yb0 = y0 - deckT - gd, yb1 = y1 - deckT - gd, yt0 = y0 - deckT, yt1 = y1 - deckT;
    kit.quadH('steel', [s0[0], yt0, s0[1]], [s1[0], yt1, s1[1]], [c1[0], yb1, c1[1]], [c0[0], yb0, c0[1]], [south[0], -0.5, south[1]], [u0, 0], [u1, 0], [u1, 1], [u0, 1]);
    kit.quadH('steel', [e0[0], yb0, e0[1]], [e1[0], yb1, e1[1]], [f1[0], yt1, f1[1]], [f0[0], yt0, f0[1]], [north[0], -0.5, north[1]], [u0, 0], [u1, 0], [u1, 1], [u0, 1]);
    kit.quad('steel', [c0[0], yb0, c0[1]], [c1[0], yb1, c1[1]], [e1[0], yb1, e1[1]], [e0[0], yb0, e0[1]], [0, -1, 0], [u0, 0], [u1, 0], [u1, 1], [u0, 1]);
    kit.quad('steel', [a0[0], y0 - deckT, a0[1]], [a1[0], y1 - deckT, a1[1]], [b1[0], y1 - deckT, b1[1]], [b0[0], y0 - deckT, b0[1]], [0, -1, 0], [0, 0], [1, 0], [1, 1], [0, 1]);
  }
  // railings. South: aluminium penguin panels (LED up/down-lit). North: glass panels. Both with handrails.
  const railH = 1.15, postEvery = 2.0;
  const nPanels = Math.round(LEN / postEvery);
  for (let i = 0; i < nPanels; i++) {
    const t0 = i / nPanels, t1 = (i + 1) / nPanels, u0 = t0 * LEN, u1 = t1 * LEN;
    const y0 = deckY(t0), y1 = deckY(t1);
    // penguin panel (the real rail is a double skin; one double-sided skin reads cleaner at this scale)
    const pa = P(t0, W / 2 - 0.16), pb = P(t1, W / 2 - 0.16);
    kit.quad('panel', [pa[0], y0 + 0.08, pa[1]], [pb[0], y1 + 0.08, pb[1]], [pb[0], y1 + railH, pb[1]], [pa[0], y0 + railH, pa[1]], [south[0], 0, south[1]],
      [u0, 0.08], [u1, 0.08], [u1, railH], [u0, railH]);
    // glass panels on the north side
    const ga = P(t0, -W / 2 + 0.12), gb = P(t1, -W / 2 + 0.12);
    kit.quad('glassRail', [ga[0], y0 + 0.1, ga[1]], [gb[0], y1 + 0.1, gb[1]], [gb[0], y1 + railH - 0.1, gb[1]], [ga[0], y0 + railH - 0.1, ga[1]], [north[0], 0, north[1]],
      [u0, 0], [u1, 0], [u1, 1], [u0, 1]);
    // posts
    for (const off of [W / 2 - 0.16, -W / 2 + 0.12]) {
      const p = P(t0, off);
      kit.box('rail', p[0], y0 + railH / 2, p[1], 0.06, railH, 0.14, Math.atan2(-dir[1], dir[0]));
    }
  }
  // handrails + LED strips (continuous along the profile)
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N, y0 = deckY(t0), y1 = deckY(t1);
    const S0 = P(t0, W / 2 - 0.16), S1 = P(t1, W / 2 - 0.16);
    kit.beam('rail', [S0[0], y0 + railH + 0.04, S0[1]], [S1[0], y1 + railH + 0.04, S1[1]], 0.3, 0.08, { caps: false });
    const along = { caps: false, alongU: t0 * LEN };   // LED colours travel along the bridge
    kit.beam('led', [S0[0], y0 + 0.05, S0[1]], [S1[0], y1 + 0.05, S1[1]], 0.3, 0.06, along);
    kit.beam('led', [S0[0], y0 + railH - 0.03, S0[1]], [S1[0], y1 + railH - 0.03, S1[1]], 0.22, 0.04, along);
    const G0 = P(t0, -W / 2 + 0.12), G1 = P(t1, -W / 2 + 0.12);
    kit.beam('rail', [G0[0], y0 + railH, G0[1]], [G1[0], y1 + railH, G1[1]], 0.1, 0.06, { caps: false });
    kit.beam('led', [G0[0], y0 + 0.06, G0[1]], [G1[0], y1 + 0.06, G1[1]], 0.14, 0.06, along);
  }

  // piers: V-shaped steel columns on concrete footings
  const piers = [0.3, 0.62];
  const colliderPts = [];
  for (const t of piers) {
    const [cx, cz] = P(t, 0);
    const g = ctx.heightAt(cx, cz);
    const top = deckY(t) - 0.28 - 1.35;
    kit.cylinder('concrete', cx, cz, g - 0.6, g + 0.35, 0.9, 0.8, 12);
    for (const s of [-1, 1]) {
      const tp = P(t, s * 0.7);
      kit.beam('steel', [cx, g + 0.3, cz], [tp[0], top + 0.2, tp[1]], 0.36, 0.36);
    }
    colliderPts.push([cx, cz, g - 1, top]);
  }
  // Purnell-side landing pad (meets the footway at ground level)
  {
    const rot = Math.atan2(-dir[1], dir[0]);
    const e = P(1.02, 0);
    kit.box('deck', e[0], yB - 0.2, e[1], 2.6, 0.4, W + 0.6, rot);
  }

  const M = ctx.materials;
  const deckMat = M.get('concrete');
  const steel = plain(ctx, '#d4d7d9', { roughness: 0.45, metalness: 0.35 });   // girder, piers, posts, handrails, footings
  const group = kit.build({
    deck: deckMat,
    steel,
    rail: steel,
    concrete: steel,
    panel: penguinPanels(ctx),
    glassRail: M.get('glassClear'),
    led: ledStrip(ctx),
  }, { name: 'landmark:randyPauschBridge' });

  const deckMesh = group.children.find((m) => m.name.endsWith(':deck'));
  if (deckMesh) ctx.walkables.add(deckMesh);

  // colliders: railings (thin oriented boxes per 6 m), piers
  const segs = Math.ceil(LEN / 6);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs, tm = (t0 + t1) / 2;
    const yLo = Math.min(deckY(t0), deckY(t1)) - 0.3, yHi = Math.max(deckY(t0), deckY(t1)) + railH;
    for (const off of [W / 2 - 0.12, -W / 2 + 0.12]) {
      const [cx, cz] = P(tm, off);
      ctx.colliders.addBox(cx, cz, (LEN / segs) / 2 + 0.05, 0.08, Math.atan2(-dir[1], dir[0]), yLo, yHi, 'pauschBridge');
    }
  }
  for (const [x, z, y0, y1] of colliderPts) ctx.colliders.addCircle(x, z, 0.9, y0, y1, 'pauschBridge');

  // LED light show: slide the colour gradient along the bridge at night (textures are shared, so one update).
  const rainbow = rainbowTexture(ctx);
  ctx.onUpdate((dt) => {
    const nf = ctx.env?.state?.nightFactor ?? 0;
    if (nf < 0.02) return;
    rainbow.offset.x = (rainbow.offset.x - dt * 0.05) % 1;
  }, 20);

  // optional real light on high quality: a soft coloured glow under the bridge deck
  if (ctx.quality?.level === 'high') {
    const light = new THREE.PointLight('#7fb8ff', 0, 30, 2);
    const [mx, mz] = P(0.5, 0);
    light.position.set(mx, deckY(0.5) + 1.5, mz);
    group.add(light);
    ctx.onUpdate(() => { light.intensity = (ctx.env?.state?.nightFactor ?? 0) * 25; }, 21);
  }

  const [mx, mz] = P(0.5, 0);
  registerLandmark(ctx, group, {
    key: 'randyPauschBridge', name: 'Randy Pausch Memorial Footbridge', nameZh: '兰迪·波许纪念桥', infoKey: 'randyPauschBridge',
    position: [mx, deckY(0.5), mz], radius: 36, labelY: deckY(0.5) + 4,
  });
  group.userData.triangles = countTris(group);
  return group;
}

// ---------------------------------------------------------------- Purnell Center for the Arts (2000)
// Michael Dennis & Associates' arts building on the west side of the Cut, the twin of his University Center opposite:
// pale buff factory brick, a long loggia of square piers with stone lintels along the lawn, a clerestory of triple
// windows under a low dark roof with deep bracketed eaves, and a four-storey south-east pavilion whose gable faces the
// Cut, with a dark-framed glass oriel on two columns next to the loggia. The fly tower of the Chosky Theater rises
// behind the range, and a rounded, glazed south-west end receives the Pausch Bridge. The ground falls away to the
// west, so the Gates side shows two extra lower storeys.
// References: Wikimedia Commons "University_Center.JPG" (2007, Purnell's Cut facade); Pittsburgh Quarterly, "A new
// front door" (the University Center's loggia is "partially mirrored by Dennis's later Chosky Theater across the Cut").
const PURNELL = [
  [-81.1, -31.7], [-63.7, -93.1], [-34.0, -84.8], [-32.6, -89.3], [-38.0, -90.9], [-34.9, -103.5], [-29.4, -102.0],
  [-28.3, -106.8], [-10.5, -101.8], [-30.8, -27.1], [-26.1, -25.9], [-28.6, -17.1], [-39.8, -20.0], [-42.8, -15.0],
  [-47.7, -12.2], [-52.5, -11.4], [-58.0, -11.9], [-62.5, -14.1], [-66.0, -19.0], [-67.4, -25.3], [-66.7, -27.8],
];
async function buildPurnell(ctx) {
  const kit = new MeshKit();
  const rand = prng(2000);
  const H = (x, z) => ctx.heightAt(x, z);
  const gs = groundStats(ctx, PURNELL, 3);
  const base = gs.min - 1.5;
  const G0 = 49.5, FLP = 4.4, top = G0 + 3 * FLP + 0.6;
  // local frame on the Cut facade (vertex 9 → 8): n north along the facade, e east (towards the Cut)
  const FRP = makeFrame(PURNELL[9], [PURNELL[8][0] - PURNELL[9][0], PURNELL[8][1] - PURNELL[9][1]]);
  const W = (e, n) => FRP.W(e, n);
  const LP = FRP.toLocal(PURNELL[8][0], PURNELL[8][1])[1];      // ≈77 m of loggia
  const NBP = Math.round(LP / 4.8), BAYP = LP / NBP;
  const LOG_H = 6.2, LOG_D = 4.0, PIER = 1.5, RW = 14, rangeTop = G0 + 11.0, pavTop = G0 + 14.0;
  const RISE = 1.9, OV = 1.4;
  // south-east pavilion = footprint vertices 10, 11, 12 + the corner on the facade line
  const [pe1] = FRP.toLocal(...PURNELL[10]), [, pn0] = FRP.toLocal(...PURNELL[11]), [pe0] = FRP.toLocal(...PURNELL[12]);
  const PAVP = { e0: pe0, e1: pe1, n0: pn0, n1: 0, oriel: -2.9 };
  // drum = the rounded south end (vertices 12..19)
  const drumPts = PURNELL.slice(12, 20);
  const dc = ringCentroid(drumPts.concat([[-53, -27]]));
  const inDrum = (p) => Math.hypot(p[0] - dc[0], p[1] - dc[1]) < 15.5 && p[1] > -29;
  const drumEdge = (a, b) => (inDrum(a) && inDrum(b) ? 'drum' : null);
  // main block = footprint minus the Cut range (e -RW…0) and the pavilion
  const mainRing = [...PURNELL.slice(0, 8), W(-RW, LP), W(-RW, 0), W(pe0, 0), ...PURNELL.slice(12)];
  const flyRing = rectLocal(FRP, -32, -15, 30, 52);
  const pavRing = rectLocal(FRP, PAVP.e0, PAVP.e1, PAVP.n0, PAVP.n1);
  const vols = [
    // brick below the Cut level everywhere; above it the drum turns into a glazed rotunda
    { ring: mainRing, y0: base, y1: G0, wallKey: 'brick', roofKey: false, vRef: G0, win: 'P' },
    { ring: mainRing, y0: G0, y1: top, wallKey: 'brick', edgeKey: drumEdge, roofKey: 'flat', parapet: 0.9, parapetKey: 'brick', copingKey: 'stone', vRef: G0, win: 'P' },
    { ring: flyRing, y0: top - 1, y1: G0 + 22, wallKey: 'brick', roofKey: 'flat', parapet: 0.6, parapetKey: 'brick', copingKey: 'stone', vRef: G0 },
    // the Cut range: loggia (back wall LOG_D behind the pier line) + upper wall with the clerestory
    { ring: rectLocal(FRP, -RW, -LOG_D, 0, LP), y0: base, y1: G0 + LOG_H, wallKey: 'brick', roofKey: false, vRef: G0, win: 'inner' },
    { ring: rectLocal(FRP, -RW, 0, 0, LP), y0: G0 + LOG_H, y1: rangeTop, wallKey: 'brick', roofKey: 'flat', soffitKey: 'stone', vRef: G0, win: 'clere' },
    { ring: pavRing, y0: base, y1: pavTop, wallKey: 'brick', roofKey: false, vRef: G0, win: 'pav' },
  ];
  const full = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) > LP - 1;
  const WIN = {
    P: { bay: 3.3, winW: 1.45, winH: 2.6, sill: 0.9, floor: FLP, depth: 0.3, floors: [-3, 2], transom: 0.72, pilaster: { key: 'brick', w: 0.55, proj: 0.14 } },
    inner: (a, b) => ({ bay: BAYP, winW: 2.5, depth: 0.3, count: full(a, b) ? NBP : 0, levels: [{ y: 0.5, h: 4.2, lights: 2, transom: 0.72 }] }),
    clere: (a, b) => ({ bay: BAYP, winW: 3.0, depth: 0.34, count: full(a, b) ? NBP : 0, levels: [{ y: 8.85, h: 1.65, lights: 3 }] }),
    pav: {
      bay: 4.4, winW: 2.2, depth: 0.34, levels: [
        { y: 0.5, h: 3.5, lights: 2, transom: 0.7 },
        { y: 5.5, h: 2.1, winW: 1.4 },
        { y: 8.4, h: 2.1, winW: 1.4 },
        { y: 11.4, h: 1.85, winW: 3.3, lights: 3 },
      ],
    },
  };
  // no windows behind the oriel, nor where the range roof meets the pavilion
  const skip = (x, z, yb) => {
    const [e, nn] = FRP.toLocal(x, z);
    if (yb > G0 + 4 && e > PAVP.e1 - 0.5 && Math.abs(nn - PAVP.oriel) < 2.6) return true;
    return Math.abs(nn) < 0.6 && e > -RW - 1.8 && e < 1.8 && yb > G0 + LOG_H - 1 && yb < rangeTop + 2.2;
  };
  massing(kit, vols, {
    wallBuilder(v, a, b, n, y0, y1, u, i, key) {
      if (!v.win || key !== 'brick') return false;
      const spec = typeof WIN[v.win] === 'function' ? WIN[v.win](a, b) : WIN[v.win];
      return punchedWall(kit, a, b, n, y0, y1, u, G0, {
        ...spec, wallKey: 'brick', glassKey: 'win', frameKey: 'wframe', sillKey: 'stone', rand, cellUV, ground: H, skip,
      });
    },
  });
  bandRing(kit, 'stone', mainRing, top - 0.3, 0.5, 0.5);        // cornice
  bandRing(kit, 'stone', mainRing, G0 + FLP - 0.15, 0.1, 0.3);  // string course above the Cut-level storey
  // drum: glazed rotunda crowned by a metal ring
  bandRing(kit, 'frame', drumPts, top + 0.4, 0.4, 0.6);
  // the loggia, the range roof (bracketed eave on the Cut side, gable to the north) and the pavilion
  const piers = loggiaPiers(kit, FRP, {
    bay: BAYP, count: NBP, out: 1, G0, base, logH: LOG_H, logD: LOG_D, pier: PIER, stringY: G0 + 8.72,
    keys: { brick: 'brick', stone: 'stone', lamp: 'lamp' },
  });
  gableRoof(kit, 'roof', 'brick', FRP, -RW, 0, 0, LP, rangeTop, RISE, 'n', { overhang: OV, vRef: G0 });
  eaveBrackets(kit, 'roof', FRP, 'n', 0.7, LP - 0.7, 0, OV - 0.05, rangeTop, rangeTop - RISE * OV / (RW / 2), OV);
  {
    const p = PAVP, rise = 1.7, h = (p.n1 - p.n0) / 2, yO = pavTop - rise * OV / h;
    gableRoof(kit, 'roof', 'brick', FRP, p.e0, p.e1, p.n0, p.n1, pavTop, rise, 'e', { overhang: OV, vRef: G0 });
    eaveBrackets(kit, 'roof', FRP, 'e', p.e0 + 0.6, p.e1 - 0.6, p.n0, p.n0 - OV + 0.05, pavTop, yO, OV);
    eaveBrackets(kit, 'roof', FRP, 'e', p.e0 + 0.6, p.e1 - 0.6, p.n1, p.n1 + OV - 0.05, pavTop, yO, OV);
    bandRing(kit, 'stone', pavRing, G0 + 0.45, 0.26, 0.9);
    bandRing(kit, 'stone', pavRing, G0 + 4.95, 0.2, 0.3);
    bandRing(kit, 'stone', pavRing, G0 + 11.15, 0.16, 0.24);
  }
  const orielCols = orielBay(kit, FRP, {
    eFace: PAVP.e1, n: PAVP.oriel, out: 1, w: 4.4, y0: G0 + 4.9, y1: G0 + 11.6, base,
    keys: { glass: 'oriel', frame: 'frame', cap: 'roof', column: 'stone' },
  });
  // glazed doors where the Pausch Bridge meets the drum
  {
    const [bx, bz] = BRIDGE_B, dx = BRIDGE_B[0] - BRIDGE_A[0], dz = BRIDGE_B[1] - BRIDGE_A[1], l = Math.hypot(dx, dz);
    const t = [-dz / l, dx / l], y0 = ctx.heightAt(bx, bz) + 0.1;
    const p0 = [bx + t[0] * 1.6 - dx / l * 0.15, bz + t[1] * 1.6 - dz / l * 0.15], p1 = [bx - t[0] * 1.6 - dx / l * 0.15, bz - t[1] * 1.6 - dz / l * 0.15];
    kit.quad('door', [p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y0 + 3, p1[1]], [p0[0], y0 + 3, p0[1]], [-dx / l, 0, -dz / l], [0, 0], [3.2, 0], [3.2, 3], [0, 3]);
    kit.box('frame', bx - dx / l * 0.8, y0 + 3.25, bz - dz / l * 0.8, 1.8, 0.2, 4.2, Math.atan2(-dz / l, dx / l));
  }
  const M = ctx.materials;
  // same pale buff factory brick, dark green-grey frames and dark metal roofs as the University Center across the Cut
  const buff = ['#cdbd9c', '#c4b392', '#d3c4a6', '#bdab8a', '#cab999', '#b5a282'];
  const frame = plain(ctx, '#3c4744', { roughness: 0.5, metalness: 0.35 });
  const group = kit.build({
    brick: brickPlain(ctx, { colors: buff, weights: [3, 3, 2, 2, 3, 1], brickW: 0.215, brickH: 0.0675, joint: 0.01, mortar: '#d2c9b6' }),
    win: glz(ctx, 'winBuff'),
    wframe: frame,
    frame,
    stone: M.get('limestone'),
    flat: M.get('flatRoof'),
    roof: seamMetal(ctx, { color: '#4f555b' }),
    drum: glz(ctx, 'lightCurtain', 1.5, FLP),
    door: glz(ctx, 'door', 1.6, 3),
    oriel: glz(ctx, 'oriel', 4.4 / 3, 6.7 / 8),
    lamp: glz(ctx, 'lamp'),
  }, { name: 'landmark:purnell' });
  // colliders: footprint with the loggia left open, the wall over the loggia, piers, oriel columns
  const ring = PURNELL.slice();
  ring.splice(8, 2, W(-LOG_D, LP), W(-LOG_D, 0));
  ctx.colliders.addPolygon(ring, base, top + 1, 'purnell');
  ctx.colliders.addPolygon(rectLocal(FRP, -LOG_D, 0, 0, LP), G0 + LOG_H, rangeTop + 2, 'purnell');
  ctx.colliders.addPolygon(pavRing, top, pavTop + 2, 'purnell');
  for (const [x, z] of piers) ctx.colliders.addBox(x, z, PIER / 2 + 0.05, PIER / 2 + 0.05, FRP.rotY, base, G0 + LOG_H, 'purnell');
  for (const [x, z] of orielCols) ctx.colliders.addCircle(x, z, 0.35, base, G0 + 5, 'purnell');
  const c = FRP.W(-22, 40);
  registerLandmark(ctx, group, {
    key: 'purnell', name: 'Purnell Center for the Arts', nameZh: '珀内尔艺术中心', osmId: 'w27574406',
    position: [c[0], top, c[1]], radius: 45, labelY: G0 + 26,
  });
  return group;
}

function countTris(group) {
  let t = 0;
  group.traverse((o) => { if (o.isMesh) t += o.geometry.attributes.position.count / 3; });
  return t;
}

export default [
  {
    key: 'gates',
    name: 'Gates and Hillman Centers',
    nameZh: '盖茨-希尔曼中心',
    osmIds: ['w27623372'],
    build: buildGates,
  },
  {
    key: 'randyPauschBridge',
    name: 'Randy Pausch Memorial Footbridge',
    nameZh: '兰迪·波许纪念桥',
    osmIds: [],
    skipRoads: ['w158105937'],
    build: buildPauschBridge,
  },
  {
    key: 'purnell',
    name: 'Purnell Center for the Arts',
    nameZh: '珀内尔艺术中心',
    osmIds: ['w27574406'],
    build: buildPurnell,
  },
];
