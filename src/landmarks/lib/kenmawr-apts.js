// Kenmawr Apartments, 401 Shady Avenue (1956): an eight-storey cross-plan block of orange-red face brick. Four
// arms of double-loaded corridors meet at a central core; every face carries the same rhythm of wide sliding
// living-room windows (each with a louvred through-wall air-conditioner sleeve under the sill) and narrow
// kitchen / bath windows, bronze frames and cast-stone sills. A limestone band caps the taller ground floor, a
// plain brick parapet with a stone coping finishes the flat roof, and a brick elevator / stair penthouse sits
// beside the core. The lobby is a one-storey glass pavilion in the north-west re-entrant corner (facing Kenmawr
// Field and the Shady Avenue / Walnut Street corner) under a flat maroon canopy.
// References (shapes only): the operator's and listing photos of the courtyard entrance, the lobby and the brick
// facades (storey count, window types, sleeves, band), published facts (1956, 8 storeys, 245 units), ESRI World
// Imagery for the roof (penthouse, plant) and the OSM footprint w170951269 (used as is for every wall).
import * as THREE from 'three';
import { MeshKit, ccw, prng, edge, holedWall, rectPts, panel, edgeBox, lodBuilding, registerBuilding, insetRing, ringCentroid, signBoard } from './kenmawr-kit.js';
import { KM, kmBrick, kmFacade, kmStone, kmRoof, kmAtlas, atlasUV, plainMat, addRelief } from './kenmawr-materials.js';
import { glz, cellUV } from './north-materials.js';

export const KENMAWR_OSM = 'w170951269';
const G = 47.4;                 // ground-floor level (terrain 46.2 … 48.0 along the walls)

function materials(ctx) {
  return {
    facade: kmFacade(ctx), brick: kmBrick(ctx), stone: kmStone(ctx), roof: kmRoof(ctx), atlas: kmAtlas(ctx),
    glass: glz(ctx, 'winBuff'), lobby: glz(ctx, 'gatesEntry', 1.4, 3.2), dark: glz(ctx, 'dark'),
    frame: plainMat(ctx, '#4f3a31', { roughness: 0.45, metalness: 0.55 }),
    metal: plainMat(ctx, '#8d9092', { roughness: 0.5, metalness: 0.5 }),
  };
}

// Window columns of one wall face: modules of KM.MODULE centred on the face, skipping [skip0, skip1] runs.
function faceLayout(L, margin = 1.0) {
  const nMod = Math.max(0, Math.floor((L - 2 * margin) / KM.MODULE));
  const s0 = (L - nMod * KM.MODULE) / 2;
  const cols = [];
  for (let m = 0; m < nMod; m++) for (const [a, b, kind] of KM.WIN) cols.push({ s0: s0 + m * KM.MODULE + a, s1: s0 + m * KM.MODULE + b, kind });
  // leftover end bays long enough for a narrow window
  if (s0 > 2.2) { cols.push({ s0: s0 / 2 - 0.33, s1: s0 / 2 + 0.33, kind: 'n' }); cols.push({ s0: L - s0 / 2 - 0.33, s1: L - s0 / 2 + 0.33, kind: 'n' }); }
  const gf = [];
  for (let m = 0; m < nMod; m++) for (const [a, b] of KM.GF_WIN) gf.push({ s0: s0 + m * KM.MODULE + a, s1: s0 + m * KM.MODULE + b });
  return { cols, gf, uStart: -s0 };
}

function setup(ctx) {
  const b = ctx.data.buildings.find((x) => x.id === KENMAWR_OSM || x.osmId === KENMAWR_OSM);
  const ring = ccw(b ? b.footprint : [[1796.9, -1367.7], [1847.8, -1371.6], [1844.6, -1409.4], [1863.2, -1410.6], [1867.2, -1362.1], [1910.1, -1365.6], [1911.4, -1346.7], [1866.3, -1343.3], [1869.2, -1306.4], [1851, -1304.9], [1847.1, -1352.8], [1798.2, -1348.8]]);
  const gMin = b?.ground?.min ?? 46.2;
  // the lobby corner: the re-entrant vertex nearest the north-west (Kenmawr Field)
  let lobbyI = 0, best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[(i + ring.length - 1) % ring.length], c = ring[i], q = ring[(i + 1) % ring.length];
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    if (cross >= 0) continue;                                   // convex corner (CCW ring: re-entrant corners turn right)
    const d = Math.hypot(c[0] - 1800, c[1] + 1420);
    if (d < best) { best = d; lobbyI = i; }
  }
  const edges = ring.map((a, i) => ({ ...edge(a, ring[(i + 1) % ring.length]), i }));
  return { ring, gMin, edges, lobbyI, base: gMin - 1.2 };
}

// Lobby pavilion outline in the re-entrant corner C between the incoming edge eIn and the outgoing edge eOut.
function lobbyGeometry(S) {
  const n = S.ring.length, C = S.ring[S.lobbyI];
  const eIn = S.edges[(S.lobbyI + n - 1) % n], eOut = S.edges[S.lobbyI];
  const back = [-eIn.dir[0], -eIn.dir[1]];                      // along eIn, away from the corner
  const nIn = [eIn.n[0], eIn.n[2]];
  const D = 5.6, ch = 2.2;                                      // pavilion depth, chamfer
  // in the exterior quadrant of a re-entrant corner nIn runs along eOut, and `back` along eOut's normal
  const P = (a, b) => [C[0] + a * back[0] + b * nIn[0], C[1] + a * back[1] + b * nIn[1]];
  const sq = (d, c) => [C, P(d, 0), P(d, d - c), P(d - c, d), P(0, d)];   // square with a chamfered outer corner
  return { C, eIn, eOut, pav: sq(D, ch), canopy: sq(D + 1.4, ch + 0.6), D };
}

// ------------------------------------------------------------------ distant level (painted facade)
function buildCoarse(ctx, S, M) {
  const kit = new MeshKit();
  const top = G + KM.TOP, roofY = G + KM.ROOF;
  for (const E of S.edges) {
    const { uStart } = faceLayout(E.L);
    // plinth below the ground floor (plain brick), painted facade above
    kit.quad('brick', E.P3(0, S.base), E.P3(E.L, S.base), E.P3(E.L, G), E.P3(0, G), E.n, [0, S.base - G], [E.L, S.base - G], [E.L, 0], [0, 0]);
    kit.quad('facade', E.P3(0, G), E.P3(E.L, G), E.P3(E.L, top), E.P3(0, top), E.n, [uStart, 0], [uStart + E.L, 0], [uStart + E.L, KM.TOP], [uStart, KM.TOP]);
    // limestone band
    const ext = 0.08;
    kit.beam('stone', E.P3(-ext, G + KM.GF + KM.BAND / 2, 0.05), E.P3(E.L + ext, G + KM.GF + KM.BAND / 2, 0.05), 0.12, KM.BAND, { caps: false });
  }
  roofAndParapet(kit, S, roofY, top, false);
  lobby(kit, S, false);
  penthouse(kit, S, roofY, false);
  return kit.build(M, { name: 'kenmawr-coarse' });
}

function roofAndParapet(kit, S, roofY, top, fine) {
  kit.cap('roof', S.ring, roofY, true);
  // inner face of the parapet (facing the roof)
  const r = insetRing(S.ring, 0.3);
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = [-(b[1] - a[1]) / L, 0, (b[0] - a[0]) / L];
    kit.quad('brick', [a[0], roofY, a[1]], [b[0], roofY, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], n, [0, roofY - G], [L, roofY - G], [L, top - G], [0, top - G]);
  }
  // coping: a slab over the parapet, projecting a little on both sides
  const outer = insetRing(S.ring, -0.06), in2 = insetRing(S.ring, 0.36);
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    kit.quad('stone', [outer[i][0], top + 0.1, outer[i][1]], [outer[j][0], top + 0.1, outer[j][1]], [in2[j][0], top + 0.1, in2[j][1]], [in2[i][0], top + 0.1, in2[i][1]], [0, 1, 0],
      [outer[i][0], outer[i][1]], [outer[j][0], outer[j][1]], [in2[j][0], in2[j][1]], [in2[i][0], in2[i][1]]);
    const E = edge(outer[i], outer[j]);
    kit.quad('stone', E.P3(0, top - 0.02), E.P3(E.L, top - 0.02), E.P3(E.L, top + 0.1), E.P3(0, top + 0.1), E.n, [0, 0], [E.L, 0], [E.L, 0.12], [0, 0.12]);
    if (fine) {
      const Ei = edge(in2[i], in2[j]);
      kit.quad('stone', Ei.P3(0, top - 0.02), Ei.P3(Ei.L, top - 0.02), Ei.P3(Ei.L, top + 0.1), Ei.P3(0, top + 0.1), [-Ei.n[0], 0, -Ei.n[2]], [0, 0], [Ei.L, 0], [Ei.L, 0.12], [0, 0.12]);
    }
  }
}

function lobby(kit, S, fine) {
  const Lb = lobbyGeometry(S);
  const y0 = G, y1 = G + 3.3, cy = G + 3.45;
  const pav = ccw(Lb.pav);
  // glass walls (skip the two edges against the building)
  const nearWall = (a, b) => {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return [Lb.eIn, Lb.eOut].some((E) => {
      const dx = m[0] - E.a[0], dz = m[1] - E.a[1];
      return Math.abs(dx * E.n[0] + dz * E.n[2]) < 0.3;
    });
  };
  for (let i = 0; i < pav.length; i++) {
    const a = pav[i], b = pav[(i + 1) % pav.length];
    if (nearWall(a, b)) continue;
    const E = edge(a, b);
    // bronze kick plate + glass + transom band
    kit.quad('frame', E.P3(0, y0 - 0.4), E.P3(E.L, y0 - 0.4), E.P3(E.L, y0 + 0.15), E.P3(0, y0 + 0.15), E.n, [0, 0], [E.L, 0], [E.L, 0.55], [0, 0.55]);
    kit.quad('lobby', E.P3(0, y0 + 0.15), E.P3(E.L, y0 + 0.15), E.P3(E.L, y1 - 0.3), E.P3(0, y1 - 0.3), E.n, [0, 0.15], [E.L, 0.15], [E.L, y1 - 0.3 - y0], [0, y1 - 0.3 - y0]);
    kit.quad('frame', E.P3(0, y1 - 0.3), E.P3(E.L, y1 - 0.3), E.P3(E.L, y1), E.P3(0, y1), E.n, [0, 0], [E.L, 0], [E.L, 0.3], [0, 0.3]);
    if (fine) {
      const k = Math.max(1, Math.round(E.L / 1.5));
      for (let m = 0; m <= k; m++) edgeBox(kit, 'frame', E, Math.min(E.L - 0.04, Math.max(0.04, (m * E.L) / k)), 0.04, y0 + 0.15, y1 - 0.3, 0.08, 0.1, { px: 1, nx: 1, nz: 1 });
    }
  }
  // canopy slab: soffit + top + maroon fascia
  const can = ccw(Lb.canopy);
  kit.cap('roof', can, cy + 0.35, true);
  const soff = atlasUV('soffit');
  // soffit: the canopy's bounding box maps onto the downlight tile (four lights)
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of can) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const tris = THREE.ShapeUtils.triangulateShape(can.map((p) => new THREE.Vector2(p[0], p[1])), []);
  for (const [i, j, k] of tris) {
    const uv = (p) => [soff[0] + ((soff[2] - soff[0]) * (p[0] - x0)) / (x1 - x0), soff[1] + ((soff[3] - soff[1]) * (p[1] - z0)) / (z1 - z0)];
    kit.tri('atlas', [can[i][0], cy, can[i][1]], [can[j][0], cy, can[j][1]], [can[k][0], cy, can[k][1]], [0, -1, 0], uv(can[i]), uv(can[j]), uv(can[k]));
  }
  const fas = atlasUV('fascia');
  for (let i = 0; i < can.length; i++) {
    const a = can[i], b = can[(i + 1) % can.length];
    if (nearWall(a, b)) continue;
    const E = edge(a, b);
    kit.quad('atlas', E.P3(0, cy - 0.05), E.P3(E.L, cy - 0.05), E.P3(E.L, cy + 0.4), E.P3(0, cy + 0.4), E.n, [fas[0], fas[1]], [fas[2], fas[1]], [fas[2], fas[3]], [fas[0], fas[3]]);
  }
  // pavilion roof under the canopy + inner ceiling (seen through the glass)
  kit.cap('roof', pav, y1 + 0.02, true);
  if (fine) kit.cap('stone', pav, y1 - 0.02, false);
}

function penthouse(kit, S, roofY, fine) {
  // elevator / stair penthouse beside the core on the west arm (roof survey), and a smaller machine room
  const ph = [[1838.2, -1362.6], [1847.3, -1363.3], [1846.4, -1351.4], [1837.3, -1350.7]];
  const mr = [[1848.5, -1364.9], [1854.6, -1365.4], [1854.2, -1360.2], [1848.1, -1359.7]];
  for (const [ring, h] of [[ph, 3.6], [mr, 2.6]]) {
    kit.ringWalls('brick', ccw(ring), roofY - 0.1, roofY + h, { vRef: G });
    kit.cap('roof', ring, roofY + h, true);
    const out = insetRing(ring, -0.08);
    kit.ringWalls('stone', ccw(out), roofY + h - 0.02, roofY + h + 0.14, { vRef: 0 });
    kit.cap('stone', out, roofY + h + 0.14, true);
  }
  if (fine) {
    // steel door + louvre on the penthouse, rooftop plant on the east arm near the core
    const E = edge(ccw(ph)[0], ccw(ph)[1]);
    panel(kit, 'frame', E, rectPts(E.L / 2 - 0.5, E.L / 2 + 0.5, roofY, roofY + 2.1), 0.02);
    const units = [[1871, -1356, 3.2, 1.6, 1.5], [1876.5, -1356.4, 2.2, 1.4, 1.2], [1881, -1355, 1.6, 1.6, 1.0], [1873, -1351.5, 1.2, 1.2, 0.9], [1826, -1358, 2.4, 1.4, 1.1]];
    for (const [x, z, w, d, h] of units) kit.box('metal', x, roofY + h / 2, z, w, h, d, -0.08, { faces: { px: 1, nx: 1, pz: 1, nz: 1, py: 1 } });
    // exhaust stacks and a satellite dish
    for (const [x, z] of [[1860, -1330], [1859, -1392], [1890, -1356], [1815, -1358]]) kit.cylinder('metal', x, z, roofY, roofY + 1.1, 0.18, 0.18, 8);
  }
}

// ------------------------------------------------------------------ detailed level (real openings)
function* buildFine(ctx, S, M) {
  addRelief(M.brick);
  yield;
  const kit = new MeshKit();
  const low = ctx.quality?.level === 'low';
  const rand = prng(1956);
  const top = G + KM.TOP, roofY = G + KM.ROOF;
  const Lb = lobbyGeometry(S);
  const louvre = atlasUV('louvre');
  for (const E of S.edges) {
    const { cols, gf, uStart } = faceLayout(E.L);
    // lobby: keep the ground floor next to the pavilion plain (plus the door) — the pavilion covers it
    const lobbyRun = (E === Lb.eIn) ? [E.L - Lb.D - 0.6, E.L] : (E === Lb.eOut) ? [0, Lb.D + 0.6] : null;
    const inLobby = (s0, s1) => lobbyRun && s1 > lobbyRun[0] && s0 < lobbyRun[1];
    // ground floor (from below the terrain to the band)
    const gHoles = [];
    for (const w of gf) {
      if (inLobby(w.s0, w.s1)) continue;
      const sill = G + KM.GF_SILL;
      const tMax = Math.max(ctx.heightAt(...E.P(w.s0)), ctx.heightAt(...E.P(w.s1)));
      if (tMax > sill + 0.25) continue;
      gHoles.push({ pts: rectPts(w.s0, w.s1, sill, sill + KM.GF_H), depth: 0.22, glass: 'glass', glassUV: cellUV(rand), reveal: 'brick' });
    }
    if (lobbyRun) {
      const sd = E === Lb.eIn ? E.L - Lb.D / 2 : Lb.D / 2;
      gHoles.push({ pts: rectPts(sd - 1.0, sd + 1.0, G, G + 2.5), depth: 0.3, glass: 'lobby', glassUV: 'metre', reveal: 'frame' });
    }
    holedWall(kit, 'brick', E, rectPts(0, E.L, S.base, G + KM.GF + 0.02), gHoles, { vRef: G, uStart: 0 });
    for (const h of gHoles) {
      if (h.glass !== 'glass') continue;
      const s0 = h.pts[0][0], s1 = h.pts[1][0], y = h.pts[0][1];
      edgeBox(kit, 'stone', E, (s0 + s1) / 2, 0.05, y - 0.12, y + 0.02, s1 - s0 + 0.16, 0.14);
      frameRing(kit, E, s0, s1, y, h.pts[2][1], 0.2, 3);
    }
    // limestone band (projecting slightly, returned at the corners)
    kit.beam('stone', E.P3(-0.09, G + KM.GF + KM.BAND / 2, 0.06), E.P3(E.L + 0.09, G + KM.GF + KM.BAND / 2, 0.06), 0.14, KM.BAND, { caps: false });
    // upper storeys: one wall strip per storey (triangulating fewer holes at a time is much cheaper)
    const extras = [];
    for (let f = 0; f < KM.N_UP; f++) {
      const y0 = G + KM.UP0 + f * KM.FLOOR;
      const holes = [];
      for (const c of cols) {
        const wide = c.kind === 'W';
        const sill = y0 + (wide ? KM.W_SILL : KM.n_SILL), h = wide ? KM.W_H : KM.n_H;
        holes.push({ pts: rectPts(c.s0, c.s1, sill, sill + h), depth: 0.2, glass: 'glass', glassUV: cellUV(rand), reveal: 'brick' });
        extras.push({ s0: c.s0, s1: c.s1, sill, h, wide });
      }
      const yA = f === 0 ? G + KM.GF : y0, yB = f === KM.N_UP - 1 ? top : y0 + KM.FLOOR;
      holedWall(kit, 'brick', E, rectPts(0, E.L, yA, yB), holes, { vRef: G, uStart });
    }
    for (const w of extras) {
      // cast-stone sill, bronze frame with the sliders' meeting rail, louvred AC sleeve under the wide windows
      edgeBox(kit, 'stone', E, (w.s0 + w.s1) / 2, 0.04, w.sill - 0.09, w.sill + 0.01, w.s1 - w.s0 + 0.12, 0.12, { px: 1, nx: 1, pz: 1, nz: 1, py: 1, ny: 1 });
      if (!low) frameRing(kit, E, w.s0, w.s1, w.sill, w.sill + w.h, 0.17, w.wide ? 2 : 1);
      if (w.wide) {
        const cx = (w.s0 + w.s1) / 2, gy = w.sill - KM.GRILLE_GAP;
        panel(kit, 'atlas', E, rectPts(cx - KM.GRILLE_W / 2, cx + KM.GRILLE_W / 2, gy - KM.GRILLE_H, gy), 0.012, louvre);
      }
    }
    yield;
  }
  roofAndParapet(kit, S, roofY, top, true);
  lobby(kit, S, true);
  penthouse(kit, S, roofY, true);
  // monument sign on Kenmawr Field at the Shady Avenue / Walnut Street corner
  {
    const x = 1755.5, z = -1418.5, g = ctx.heightAt(x, z);
    signBoard(kit, { x, z, face: [-0.77, -0.64], y0: g + 0.75, w: 3.2, h: 0.95, key: 'atlas', uv: atlasUV('signKen', 0.002), bodyKey: 'frame', baseKey: 'brick', baseH: 0.75 });
  }
  yield;
  return kit.build(M, { name: 'kenmawr-fine' });
}

// Bronze window frame: a flat ring just in front of the glass (glass at -depth + 0.02) + meeting rails.
function frameRing(kit, E, s0, s1, y0, y1, depth, lights) {
  const f = 0.055, off = -depth + 0.035;
  const outer = rectPts(s0, s1, y0, y1);
  // ring as 4 strips (cheaper than triangulating a polygon with a hole)
  panel(kit, 'frame', E, [outer[0], outer[1], [s1, y0 + f], [s0, y0 + f]], off, 'metre');
  panel(kit, 'frame', E, [[s0, y1 - f], [s1, y1 - f], outer[2], outer[3]], off, 'metre');
  panel(kit, 'frame', E, [[s0, y0 + f], [s0 + f, y0 + f], [s0 + f, y1 - f], [s0, y1 - f]], off, 'metre');
  panel(kit, 'frame', E, [[s1 - f, y0 + f], [s1, y0 + f], [s1, y1 - f], [s1 - f, y1 - f]], off, 'metre');
  for (let k = 1; k < lights; k++) {
    const s = s0 + ((s1 - s0) * k) / lights;
    panel(kit, 'frame', E, rectPts(s - 0.035, s + 0.035, y0 + f, y1 - f), off + 0.01, 'metre');
  }
}

// ------------------------------------------------------------------ landmark
export async function buildKenmawr(ctx, def) {
  const S = setup(ctx);
  const t0 = performance.now();
  const M = materials(ctx);
  const t1 = performance.now();
  const low = ctx.quality?.level === 'low';
  // the distant level merges its small parts into fewer materials (fewer draw calls)
  const coarse = buildCoarse(ctx, S, { ...M, brick: M.facade, frame: M.roof, metal: M.roof });
  const t2 = performance.now();
  const c = ringCentroid(S.ring), top = G + KM.TOP;
  const obj = lodBuilding(ctx, {
    name: 'kenmawr', centre: [c[0], G + 12, c[1]], coarse,
    far: low ? 260 : 420, near: low ? 300 : 480,
    fine: () => buildFine(ctx, S, M),
  });
  obj.name = 'landmark:kenmawr';
  ctx.colliders?.addPolygon(S.ring, S.base, top + 0.2, KENMAWR_OSM);
  const Lb = lobbyGeometry(S);
  ctx.colliders?.addPolygon(ccw(Lb.pav), G - 1, G + 3.5, `${KENMAWR_OSM}:lobby`);
  registerBuilding(ctx, obj, {
    key: def.key, name: def.name, nameZh: def.nameZh, osmId: KENMAWR_OSM,
    position: [c[0], top, c[1]], radius: 60, labelY: top + 6, priority: 9, maxDistance: 2600,
  });
  obj.userData.buildMs = { materials: Math.round(t1 - t0), coarse: Math.round(t2 - t1), total: Math.round(performance.now() - t0) };
  return obj;
}
