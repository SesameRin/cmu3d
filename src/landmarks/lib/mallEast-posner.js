// Posner Hall (Kallmann McKinnell & Wood, c. 1988) — the former home of the Graduate School of Industrial
// Administration (Tepper), east of the College of Fine Arts. A three-storey block in buff brick chosen to match
// Hornbostel's campus, with painted-metal windows and a projecting trellised metal cornice over a flat roof.
// A semicircular forecourt at the low (north) end of its sloping site, marked by a single freestanding column,
// leads into the building.
import * as THREE from 'three';
import { footprintFrame } from '../../core/placement.js';
import { Bag, makeFrame, orientRing, ringWalls, profileRing, flatPolygon, column, ringSector, groundAlong, offsetRing, outlinePanel, facadeMatrix, settleMallEast } from './mallEast-kit.js';
import { getKitMaterials, HB } from './mallEast-materials.js';

const OSM_ID = 'w27591241';

async function buildPosner(ctx) {
  const b = ctx.data.buildings.find((x) => x.osmId === OSM_ID || x.id === OSM_ID);
  if (!b) { console.warn('[posner] building not in data'); return null; }
  const K = getKitMaterials(ctx);
  const fp = footprintFrame(b.footprint);
  // local +z → the long axis pointing to the low, north end (the forecourt)
  let frame = makeFrame(fp.center, fp.angle - Math.PI / 2);
  if (frame.toLocal(fp.center[0], fp.center[1] - 50)[1] < 0) frame = makeFrame(fp.center, fp.angle + Math.PI / 2);
  const ring = orientRing(frame.ringToLocal(b.footprint));
  const g = groundAlong(ctx, frame, ring);
  const FLOOR = 4.2;
  const EAVE = g.max + 3 * FLOOR + 0.4;
  const DAT = EAVE - 4 * FLOOR - 0.4;       // four storeys where the site falls away to the north
  const yBase = g.min - 1.6;
  const bag = new Bag();
  const mMetal = K.metalPaint();

  const mFacade = K.facade({
    key: 'posner', bay: 3.0, bays: 4, height: EAVE + 0.8 - DAT, seed: 1988, lit: 0.45,
    bands: [
      { y0: 0, y1: 0.5, color: '#b9aa8a' },
      { y0: FLOOR - 0.25, y1: FLOOR, color: HB.terracotta },
      { y0: 2 * FLOOR - 0.25, y1: 2 * FLOOR, color: HB.terracotta },
      { y0: 3 * FLOOR - 0.25, y1: 3 * FLOOR, color: HB.terracotta },
      { y0: 4 * FLOOR + 0.2, y1: 4 * FLOOR + 1.2, color: '#cdb98f' },
    ],
    rows: [
      { sill: 0.8, w: 2.2, h: 2.6, shape: 'rect', mullions: 3, transom: 0.75 },
      { sill: FLOOR + 0.8, w: 1.6, h: 2.3, shape: 'rect', mullions: 2, lintel: '#c9b58c' },
      { sill: 2 * FLOOR + 0.8, w: 1.6, h: 2.3, shape: 'rect', mullions: 2, lintel: '#c9b58c' },
      { sill: 3 * FLOOR + 0.9, w: 1.6, h: 2.0, shape: 'arch', mullions: 2 },
    ],
  });

  // walls + parapet, flat roof and rooftop plant
  ringWalls(bag, mFacade, ring, yBase, EAVE + 0.8, { datum: DAT, bay: 3.0 });
  profileRing(bag, K.trim(), ring, EAVE + 0.8, [[0, 0], [0.12, 0], [0.12, 0.16], [-0.3, 0.16]]);
  flatPolygon(bag, K.flatRoof(), offsetRing(ring, -0.25), EAVE + 0.5, true);
  profileRing(bag, K.granite(), ring, g.max - 0.35, [[0, 0], [0.1, 0], [0.1, 0.55], [0, 0.6]]);
  bag.box(mMetal, 0, EAVE + 1.5, -8, 9, 2, 6);    // rooftop plant
  bag.box(mMetal, -4, EAVE + 1.2, 14, 4, 1.4, 4);

  // trellised metal cornice: outriggers every 1.5 m carrying three longitudinal rails
  {
    const n = ring.length, yT = EAVE + 0.35, depth = 1.3;
    for (const d of [0.45, 0.85, depth]) {
      const r2 = offsetRing(ring, d);
      for (let i = 0; i < n; i++) {
        const a = r2[i], c = r2[(i + 1) % n];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (L < 0.2) continue;
        bag.box(mMetal, (a[0] + c[0]) / 2, yT + (d === depth ? 0.05 : 0.12), (a[1] + c[1]) / 2, L + (d === depth ? 0.12 : 0), d === depth ? 0.3 : 0.08, d === depth ? 0.1 : 0.08, -Math.atan2(c[1] - a[1], c[0] - a[0]));
      }
    }
    for (let i = 0; i < n; i++) {
      const a = ring[i], c = ring[(i + 1) % n];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const dx = (c[0] - a[0]) / L, dz = (c[1] - a[1]) / L, ox = -dz, oz = dx;
      const ang = -Math.atan2(dz, dx);
      const cnt = Math.max(1, Math.round(L / 1.5));
      for (let k = 0; k <= cnt; k++) {
        const t = (k / cnt) * L;
        const px = a[0] + dx * t + ox * depth / 2, pz = a[1] + dz * t + oz * depth / 2;
        bag.box(mMetal, px, yT, pz, 0.07, 0.26, depth, ang);
      }
    }
  }

  // north forecourt: semicircular paved court, seat wall, entrance and the freestanding column
  const zN = Math.max(...ring.map((p) => p[1]));
  const fc = [0, zN];
  const [fwx, fwz] = frame.toWorld(fc[0], fc[1] + 4);
  const yF = ctx.heightAt(fwx, fwz) + 0.06;
  {
    const R = 9.5;
    const pts = [];
    for (let k = 0; k <= 24; k++) { const t = (k / 24) * Math.PI; pts.push([fc[0] + R * Math.cos(t), fc[1] + R * Math.sin(t)]); }
    flatPolygon(bag, K.paver(), orientRing(pts), yF, true);
    ringSector(bag, { outer: K.trim(), inner: K.trim(), top: K.trim(), ends: K.trim() }, fc[0], fc[1], R, R + 0.5, 0.15, Math.PI - 0.15, yF - 0.8, yF + 0.5, 20);
    // glazed entrance in the north wall
    for (let k = -1; k <= 1; k++) {
      const pts = [[k * 2.4 - 1.15, yF], [k * 2.4 + 1.15, yF], [k * 2.4 + 1.15, yF + 4.1], [k * 2.4 - 1.15, yF + 4.1]];
      outlinePanel(bag, K.window(k === 0), pts, facadeMatrix(0, zN + 0.05), { uvMode: 'unit' });
    }
    bag.box(mMetal, 0, yF + 4.15, zN + 0.1, 7.4, 0.14, 0.2);
    bag.box(mMetal, 0, yF + 4.4, zN + 1.4, 9, 0.25, 2.8);
    for (const sx of [-1, 1]) bag.box(mMetal, sx * 4.3, yF + 2.2, zN + 2.6, 0.18, 4.4, 0.18);
    // the "iconic column" at the foot of the slope
    const cz = fc[1] + R - 1.4;
    bag.box(K.granite(), 0, yF + 0.5, cz, 1.6, 1.0, 1.6);
    column(bag, K.trim(), 0, cz, yF + 1.0, 7.5, 0.42, { order: 'doric', segs: 16 });
    const orb = new THREE.SphereGeometry(0.45, 16, 12);
    bag.geo(mMetal, orb, { matrix: new THREE.Matrix4().makeTranslation(0, yF + 9.0, cz) });
    orb.dispose();
  }

  const [px, pz] = frame.toWorld(0, 0);
  const entry = { key: 'posner', kind: 'landmark', name: 'Posner Hall', nameZh: '波斯纳楼', osmId: OSM_ID, infoKey: OSM_ID, position: [px, EAVE, pz], radius: 40 };
  const group = bag.build('posner', { share: { ctx, entry, frame, materials: K.shared } });
  frame.place(group);

  ctx.colliders.addPolygon(frame.ringToWorld(ring), yBase, EAVE + 3, 'posner');
  {
    const [cx, cz] = frame.toWorld(0, zN + 9.5 - 1.4);
    ctx.colliders.addCircle(cx, cz, 0.9, yF - 1, yF + 10, 'posner');
  }
  ctx.pick.add(group, entry);
  ctx.labels.add({ key: 'posner', text: 'Posner Hall', textZh: '波斯纳楼', kind: 'landmark', priority: 8, position: { x: px, y: EAVE + 5, z: pz } });
  return group;
}

export default [
  {
    key: 'posner',
    name: 'Posner Hall',
    nameZh: '波斯纳楼',
    osmIds: [OSM_ID],
    async build(ctx) { try { return await buildPosner(ctx); } finally { settleMallEast(ctx, 'posner'); } },
  },
];
