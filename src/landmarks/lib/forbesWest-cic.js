// Robert Mehrabian Collaborative Innovation Center (CIC, 2005, dggp Architecture), 4720 Forbes Avenue.
//
// The building sits on the lip of Junction Hollow: toward the service drive (east) it shows its office floors at
// grade, toward the ravine and the railway (west) a multi-level parking garage appears underneath, screened by
// long horizontal precast louvres, so the west face is roughly twice as tall as the east face.
// From photographs: an exposed light precast concrete frame (big square columns, deep slab edges) with aluminium-
// framed glazing between; the top storey is a recessed glass band under a thin overhanging roof slab with sun
// louvres; the north (Forbes Avenue) end is a taller block clad in cream ceramic tile with paired punched windows
// under projecting metal sunshade grilles. Entrance + name sign on the tile block by the service drive.
import { massing } from './north-kit.js';
import { glz, metalPanels, cellUV } from './north-materials.js';
import { MeshKit, prng, edgeInfo, openingWall, insetRing, ringGroundStats, registerForbes, groundMinAlong } from './forbesWest-kit.js';
import { creamTile, precast, plainMat, signMat } from './forbesWest-materials.js';

export const CIC_OSM = 'w27591069';

// OSM footprint split at z = -134.3 into the framed office body and the tile-clad north block
const OFFICE = [[-286.1, -69.0], [-327.6, -80.6], [-316.7, -134.3], [-280.3, -134.3], [-277.4, -93.0], [-281.0, -93.0], [-282.5, -88.6], [-279.6, -87.2]];
const NORTH = [[-316.7, -134.3], [-314.5, -145.2], [-282.5, -147.4], [-282.5, -144.4], [-278.9, -144.4], [-278.1, -134.3]];
const FOOT = [[-286.1, -69.0], [-327.6, -80.6], [-314.5, -145.2], [-282.5, -147.4], [-282.5, -144.4], [-278.9, -144.4], [-278.1, -134.3],
  [-280.3, -134.3], [-277.4, -93.0], [-281.0, -93.0], [-282.5, -88.6], [-279.6, -87.2]];

const L1 = 35.4, FH = 3.4;                        // lowest office floor ≈ service-drive grade
const lv = (n) => L1 + (n - 1) * FH;              // L5 = 49.0 (recessed top storey)
const ROOF = lv(6), TILE_TOP = ROOF + 3.6;

export function buildCIC(ctx) {
  const low = ctx.quality?.level === 'low';
  const kit = new MeshKit();
  const rand = prng(2005);
  const gs = ringGroundStats(ctx, FOOT, 3);
  const base = gs.min - 1.5;
  const H = (x, z) => ctx.heightAt(x, z);
  const TOPIN = 1.6;                               // recess of the top storey behind the frame line
  const topRing = insetRing(OFFICE, TOPIN);

  const vols = [
    { ring: FOOT, y0: base, y1: L1, wallKey: 'garage', roofKey: false, role: 'garage' },
    { ring: OFFICE, y0: L1, y1: lv(5), wallKey: 'glass', roofKey: 'deck', role: 'office' },
    { ring: topRing, y0: lv(5), y1: ROOF, wallKey: 'glass', roofKey: false, role: 'top' },
    { ring: NORTH, y0: L1, y1: TILE_TOP, wallKey: 'tile', roofKey: 'roof', parapet: 0.5, parapetKey: 'tile', copingKey: 'alu', role: 'tile' },
  ];

  const colliderBoxes = [];
  massing(kit, vols, {
    wallBuilder(v, a, b, n, y0, y1, uA, i, key) {
      const r = v.ring, A = r[i], B = r[(i + 1) % r.length];
      const E = edgeInfo(A, B);
      const { L, d } = edgeInfo(a, b);
      const off = Math.hypot(a[0] - A[0], a[1] - A[1]);
      const P = (s, y, o = 0) => [a[0] + d[0] * s + n[0] * o, y, a[1] + d[1] * s + n[2] * o];
      if (v.role === 'garage') {
        // dark garage wall behind precast louvres + piers on the frame grid
        kit.quad('garage', P(0, y0), P(L, y0), P(L, y1), P(0, y1), n, [uA, y0], [uA + L, y0], [uA + L, y1], [uA, y1]);
        const gmin = groundMinAlong(ctx, a, b);
        if (gmin > y1 - 1.2) return true;              // buried: no louvres
        const nC = Math.max(1, Math.round(E.L / 8.4));
        for (let k = 0; k < nC; k++) {
          const s = (k * E.L) / nC - off;
          if (s < -0.01 || s > L + 0.01) continue;
          const [px, , pz] = P(s, 0, 0.2);
          kit.box('frame', px, (Math.max(gmin, y0) - 0.5 + y1) / 2, pz, 0.75, y1 - Math.max(gmin, y0) + 0.5, 0.75, E.rotY);
        }
        const step = low ? 1.2 : 0.62;
        for (let y = y1 - 0.55; y > gmin - 0.3; y -= step) {
          kit.beam('louvre', P(0.1, y, 0.45), P(L - 0.1, y, 0.45), 0.42, low ? 0.45 : 0.28, { caps: false });
        }
        kit.beam('frame', P(-0.1, y1 - 0.25, 0.3), P(L + 0.1, y1 - 0.25, 0.3), 0.7, 0.5);    // transfer beam
        return true;
      }
      if (v.role === 'office' || v.role === 'top') {
        // curtain glass at the ring line
        kit.quad('glass', P(0, y0), P(L, y0), P(L, y1), P(0, y1), n, [uA, y0 - L1], [uA + L, y0 - L1], [uA + L, y1 - L1], [uA, y1 - L1]);
        if (v.role === 'top') {
          // sun louvres across the top of the recessed storey
          if (!low) for (const dy of [0.35, 0.75]) kit.beam('alu', P(0, y1 - dy, TOPIN * 0.55), P(L, y1 - dy, TOPIN * 0.55), TOPIN * 0.9, 0.05, { caps: false });
          return true;
        }
        // exposed concrete frame: columns on an ~8.4 m grid, deep slab edges at every floor
        const nC = Math.max(1, Math.round(E.L / 8.4));
        for (let k = 0; k <= nC; k++) {
          const s = (k * E.L) / nC - off;
          if (s < -0.01 || s > L + 0.01) continue;
          const [px, , pz] = P(Math.min(L, Math.max(0, s)), 0, 0.25);
          kit.box('frame', px, (y0 + y1 + 0.45) / 2, pz, 0.8, y1 + 0.45 - y0, 0.8, E.rotY);
          colliderBoxes.push([px, pz, E.rotY]);
          // slim secondary fins between the columns
          if (!low && k < nC) {
            for (const f of [1 / 3, 2 / 3]) {
              const sf = ((k + f) * E.L) / nC - off;
              if (sf < 0.3 || sf > L - 0.3) continue;
              const [fx, , fz] = P(sf, 0, 0.12);
              kit.box('frame', fx, (y0 + y1) / 2, fz, 0.22, y1 - y0, 0.3, E.rotY);
            }
          }
        }
        for (let f = 2; f <= 5; f++) {
          const y = lv(f);
          kit.beam('frame', P(-0.35, y - 0.05, 0.3), P(L + 0.35, y - 0.05, 0.3), 0.66, 0.5);
          if (!low && f < 5) kit.beam('alu', P(0, y - 0.95, 0.35), P(L, y - 0.95, 0.35), 0.7, 0.04, { caps: false }); // light shelf
        }
        return true;
      }
      if (v.role === 'tile') {
        // cream tile with paired punched windows, projecting sunshade grilles
        const ops = [];
        const bay = 3.6;
        const cols = [];
        const nb = Math.floor((E.L - 1.6) / bay);
        for (let k = 0; k < nb; k++) cols.push(E.L / 2 + (k - (nb - 1) / 2) * bay);
        const entry = Math.abs(E.d[1]) > 0.9 && E.n[0] > 0.9;          // east face of the entrance projection
        for (const c of cols) {
          for (let f = 1; f <= 6; f++) {
            if (entry && f <= 2) continue;           // entrance + name sign
            const yb = lv(f) + 0.85, yt = Math.min(lv(f) + FH - 0.4, TILE_TOP - 0.6);
            if (yt - yb < 1) continue;
            ops.push({ s0: c - off - 1.35, s1: c - off - 0.1, yb, yt, sh: true });
            ops.push({ s0: c - off + 0.1, s1: c - off + 1.35, yb, yt });
          }
        }
        openingWall(kit, a, b, n, y0, y1, ops, {
          wallKey: 'tile', revealKey: 'alu', sillKey: 'alu', vRef: L1, uStart: uA, depth: 0.22, glassKey: 'win', cell: () => cellUV(rand), ground: H,
        });
        if (!low) {
          for (const q of ops) {
            if (!q.sh || q.s0 < 0 || q.s1 + 1.25 > L) continue;
            const [sx, , sz] = P(q.s1 + 0.1, q.yt + 0.25, 0.45);
            kit.box('grille', sx, q.yt + 0.25, sz, 2.9, 0.08, 0.9, E.rotY);
          }
        }
        if (entry && L > 6) {
          // glazed entrance + canopy + name sign
          const s0 = 1.2, s1 = L - 1.2;
          const [ex, , ez] = P((s0 + s1) / 2, 0, 0.02);
          kit.quad('door', P(s0, L1, 0.03), P(s1, L1, 0.03), P(s1, lv(2) - 0.3, 0.03), P(s0, lv(2) - 0.3, 0.03), n, [0, 0], [s1 - s0, 0], [s1 - s0, lv(2) - 0.3 - L1], [0, lv(2) - 0.3 - L1]);
          kit.box('alu', ex + n[0] * 1.6, lv(2) - 0.15, ez + n[2] * 1.6, s1 - s0 + 1, 0.3, 3.2, E.rotY);
          kit.box('lamp', ex + n[0] * 1.6, lv(2) - 0.31, ez + n[2] * 1.6, s1 - s0, 0.02, 2.6, E.rotY, { faces: { ny: 1 } });
          const gy = H(ex + n[0] * 2, ez + n[2] * 2);
          if (gy < L1 - 0.1) kit.box('frame', ex + n[0] * 1.5, (gy + L1) / 2 - 0.2, ez + n[2] * 1.5, s1 - s0, L1 - gy + 0.4, 3, E.rotY);
        }
        return true;
      }
      return false;
    },
  });

  // ---------------------------------------------------------------- roof slab of the office body (overhangs the
  // recessed top storey back to the frame line), rooftop plant penthouse
  {
    const r = OFFICE;
    kit.cap('roof', r, ROOF + 0.35, true);
    kit.cap('soffit', r, ROOF, false);
    kit.ringWalls('alu', r, ROOF, ROOF + 0.35);
    const pent = insetRing(OFFICE, 9);
    kit.ringWalls('plant', pent, ROOF + 0.35, ROOF + 3.4, { vRef: ROOF });
    kit.cap('roof', pent, ROOF + 3.4, true);
    if (!low) {
      for (const [x, z, w, dd] of [[-300, -118, 5, 3], [-296, -100, 4, 4], [-305, -90, 3.5, 3.5]]) kit.box('plant', x, ROOF + 4.2, z, w, 1.6, dd, 0.2);
    }
    // west-facade balconies (small cantilevered slabs with railings)
    if (!low) {
      const A = OFFICE[1], B = OFFICE[2], E = edgeInfo(A, B);
      for (const [t, f] of [[0.62, 3], [0.62, 4], [0.3, 3]]) {
        const p = [A[0] + (B[0] - A[0]) * t + E.n[0] * 1.3, A[1] + (B[1] - A[1]) * t + E.n[2] * 1.3];
        kit.box('frame', p[0], lv(f) - 0.1, p[1], 4.2, 0.25, 1.8, E.rotY);
        kit.box('rail', p[0] + E.n[0] * 0.85, lv(f) + 0.55, p[1] + E.n[2] * 0.85, 4.2, 1.05, 0.05, E.rotY);
      }
    }
  }
  // name sign on the tile wall facing the entrance drive
  {
    // on the east face of the entrance projection, (-278.9,-144.4) → (-278.1,-134.3); quad runs south → north so the
    // lettering reads left-to-right for someone facing west
    const W0 = [-278.9, -144.4], W1 = [-278.1, -134.3];
    const at = (t) => [W0[0] + (W1[0] - W0[0]) * t, W0[1] + (W1[1] - W0[1]) * t];
    const b = at(0.2), a = at(0.8);
    const E = edgeInfo(b, a);
    const y0 = lv(2) + 0.2, y1 = y0 + 1.9;
    const o = 0.04;
    kit.quad('sign', [a[0] + E.n[0] * o, y0, a[1] + E.n[2] * o], [b[0] + E.n[0] * o, y0, b[1] + E.n[2] * o], [b[0] + E.n[0] * o, y1, b[1] + E.n[2] * o], [a[0] + E.n[0] * o, y1, a[1] + E.n[2] * o], E.n, [0, 0], [1, 0], [1, 1], [0, 1]);
  }

  const alu = ctx.materials.get('aluminium');
  const group = kit.build({
    garage: plainMat(ctx, '#2b2d2f', { roughness: 0.95 }),
    louvre: precast(ctx, '#bdb9af'),
    frame: precast(ctx, '#c9c4b9'),
    glass: glz(ctx, 'lightCurtain', 1.4, FH),
    door: glz(ctx, 'gatesEntry', 1.4, lv(2) - 0.3 - L1),
    win: glz(ctx, 'winBuff'),
    lamp: glz(ctx, 'lamp'),
    tile: creamTile(ctx),
    deck: ctx.materials.get('flatRoof'),
    roof: ctx.materials.get('flatRoof'),
    soffit: plainMat(ctx, '#e7e5df', { roughness: 0.8 }),
    alu, grille: alu, rail: plainMat(ctx, '#8e969c', { roughness: 0.4, metalness: 0.6 }),
    plant: metalPanels(ctx, { color: '#a9afb3' }),
    sign: signMat(ctx, 'cic', {
      w: 6.2, h: 1.9, bg: null, color: '#3b3f44', ppm: 110, lines: [
        { text: 'Collaborative', size: 0.2, y: 0.14, weight: 600 },
        { text: 'Innovation', size: 0.2, y: 0.39, weight: 600 },
        { text: 'Center', size: 0.2, y: 0.64, weight: 600 },
        { text: '4720 Forbes Avenue', size: 0.13, y: 0.88, weight: 500 },
      ],
    }),
  }, { name: 'landmark:cic', noShadowKeys: ['sign', 'lamp', 'rail'] });

  ctx.colliders.addPolygon(FOOT, base, ROOF + 0.5, 'cic');
  for (const [x, z, rot] of colliderBoxes) ctx.colliders.addBox(x, z, 0.42, 0.42, rot, L1, lv(5) + 0.5, 'cic');   // frame columns
  ctx.colliders.addPolygon(NORTH, L1, TILE_TOP + 0.5, 'cic');
  const c = [-298, -110];
  registerForbes(ctx, group, {
    key: 'cic', name: 'Collaborative Innovation Center (CIC)', nameZh: '协同创新中心', osmId: CIC_OSM,
    position: [c[0], ROOF, c[1]], radius: 50, labelY: TILE_TOP + 6,
    labelText: 'Collaborative Innovation Center (CIC)', labelZh: '协同创新中心 CIC',
  });
  return group;
}
