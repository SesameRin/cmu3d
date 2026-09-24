// 3D bridges for OSM ways tagged bridge=yes (roads and paths): deck, sidewalks, parapets / railings, lane markings,
// and a substructure chosen from the gap below — steel three-hinged deck arches with stone approach arches for the
// deep Junction Hollow / Panther Hollow crossings (Schenley Bridge, Panther Hollow Bridge, Forbes Ave), piers for
// shallower crossings, abutments at the ends. Decks are registered as walkables, parapets as colliders.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pointInRing } from '../core/heightfield.js';
import { polyLength, resamplePolyline, offsetPolyline, mulberry } from './ground-painter.js';

const ROAD_TYPES_WITH_MARKINGS = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'construction']);

// Road bridges with a known structure (OSM only says bridge=yes; both are tagged highway=construction while
// they are being rehabilitated):
//   Charles Anderson Memorial Bridge (Boulevard of the Allies over Junction Hollow, 1940): a 780 ft steel Wichert
//     deck truss in three spans (64 / 110 / 64 m), 58 ft wide — en.wikipedia.org/wiki/Charles_Anderson_Memorial_Bridge
//   Panther Hollow Bridge (1897): steel three-hinged deck arch; four bronze panthers by Giuseppe Moretti crouch
//     as sentinels on the bridge corners — en.wikipedia.org/wiki/Panther_Hollow_Bridge
const KNOWN_BRIDGES = {
  'Charles Anderson Bridge': { width: 12, truss: { spans: [0.27, 0.46, 0.27] } },
  'Panther Hollow Bridge': { panthers: true, infoKey: 'Panther Hollow Bridge', nameZh: '黑豹谷桥' },
};

// Road bridges that the data clips mid-span (OSM draws the Charles Anderson Bridge's carriageway only as far as
// x −572, while its two bridge sidewalks run on to the west rim at x −737): the carriageway is carried on along
// its last segment as far as the bridge footways beside it reach. Map road id → extended points. Shared with
// terrain.js, whose synthetic terrain beyond the data must not be pulled up to such a deck.
export function extendedBridgeRoads(data, B) {
  const inG = (p) => p[0] >= B.minX && p[0] <= B.maxX && p[1] >= B.minZ && p[1] <= B.maxZ;
  const foot = (data.paths || []).filter((p) => p.bridge && !p.tunnel && p.points.length > 1);
  const out = new Map();
  for (const r of data.roads) {
    if (!r.bridge || r.tunnel || r.points.length < 2) continue;
    const n = r.points.length, inA = inG(r.points[0]), inB = inG(r.points[n - 1]);
    if (inA === inB) continue;
    const pts = inA ? r.points.slice() : r.points.slice().reverse(); // in → out
    const e = pts[pts.length - 1], f = pts[pts.length - 2];
    const segL = Math.hypot(e[0] - f[0], e[1] - f[1]) || 1, ux = (e[0] - f[0]) / segL, uz = (e[1] - f[1]) / segL;
    let reach = 0;
    for (const p of foot) {
      let ok = true, tMin = Infinity, tMax = -Infinity;
      for (const [x, z] of p.points) {
        const dx = x - e[0], dz = z - e[1], t = dx * ux + dz * uz;
        if (t < -(segL + 10)) continue;                        // (far back along a curving carriageway)
        if (Math.abs(-dx * uz + dz * ux) > 16) { ok = false; break; }
        tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
      }
      if (ok && tMin < 0 && tMax > reach) reach = tMax;
    }
    if (reach > 5) {
      pts.push([e[0] + ux * reach, e[1] + uz * reach]);
      out.set(r.id, inA ? pts : pts.reverse());
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry accumulator: pushes triangles with winding fixed against an expected outward direction,
// flat normals per triangle, metre UVs supplied by the caller.
class GeoBuf {
  constructor() { this.pos = []; this.nor = []; this.uv = []; }
  tri(a, b, c, ua, ub, uc, e) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * e[0] + ny * e[1] + nz * e[2] < 0) { const t = b; b = c; c = t; const tu = ub; ub = uc; uc = tu; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // (explicit arguments: spreading arrays into push() was the single hottest line of the roads step)
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  quad(a, b, c, d, ua, ub, uc, ud, e) { this.tri(a, b, c, ua, ub, uc, e); this.tri(a, c, d, ua, uc, ud, e); }
  get empty() { return this.pos.length === 0; }
  // Typed-array geometry; the (large, plain-JS) scratch arrays are released afterwards — builders that keep a
  // GeoBuf reachable from a long-lived closure would otherwise hold tens of MB of doubles.
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    this.pos = []; this.nor = []; this.uv = [];
    return g;
  }
}

// Sweep a profile segment (a → b in cross-section coords [lateral offset, dy]) along samples.
// yOf(i) = base height at sample i. out = outward direction in profile coords [dOff, dY].
function sweepSeg(buf, S, yOf, a, b, out, vOffset = 0) {
  const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let i = 0; i < S.length - 1; i++) {
    const p = S[i], q = S[i + 1];
    const P = (smp, k, off, dy) => [smp.x + smp.nx * off, yOf(k) + dy, smp.z + smp.nz * off];
    const A0 = P(p, i, a[0], a[1]), B0 = P(p, i, b[0], b[1]), A1 = P(q, i + 1, a[0], a[1]), B1 = P(q, i + 1, b[0], b[1]);
    const nx = (p.nx + q.nx) / 2, nz = (p.nz + q.nz) / 2;
    const e = [nx * out[0], out[1], nz * out[0]];
    buf.quad(A0, B0, B1, A1, [p.s, vOffset], [p.s, vOffset + segLen], [q.s, vOffset + segLen], [q.s, vOffset], e);
  }
}

// Axis-aligned-in-local-frame box: centre (x, y, z), size along tangent (len), lateral (wid), height (h), frame (tx,tz)
function boxAt(buf, x, y, z, len, wid, h, tx, tz, taper = 0) {
  const nx = -tz, nz = tx;
  const hl = len / 2, hw = wid / 2;
  const corner = (sl, sw, top) => {
    const k = top ? 1 - taper : 1;
    return [x + tx * sl * hl * k + nx * sw * hw * k, y + (top ? h : 0), z + tz * sl * hl * k + nz * sw * hw * k];
  };
  const c = {};
  for (const sl of [-1, 1]) for (const sw of [-1, 1]) for (const t of [0, 1]) c[`${sl}${sw}${t}`] = corner(sl, sw, t);
  const uvq = (w, hh, u0 = 0, v0 = y) => [[u0, v0], [u0 + w, v0], [u0 + w, v0 + hh], [u0, v0 + hh]];
  // sides
  const faces = [
    ['-1-10', '1-10', '1-11', '-1-11', [-nx, 0, -nz], len],
    ['-110', '110', '111', '-111', [nx, 0, nz], len],
    ['-1-10', '-110', '-111', '-1-11', [-tx, 0, -tz], wid],
    ['1-10', '110', '111', '1-11', [tx, 0, tz], wid],
  ];
  for (const [a, b, cc, d, e, w] of faces) {
    const [ua, ub, uc, ud] = uvq(w, h);
    buf.quad(c[a], c[b], c[cc], c[d], ua, ub, uc, ud, e);
  }
  buf.quad(c['-1-11'], c['1-11'], c['111'], c['-111'], [x - hl, z - hw], [x + hl, z - hw], [x + hl, z + hw], [x - hl, z + hw], [0, 1, 0]);
}

// ---------------------------------------------------------------------------------------------------------------
function chainWays(ways) {
  // join ways that share endpoints into longer chains (keeps each way's direction when possible)
  const key = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const used = new Set();
  const chains = [];
  const byEnd = new Map();
  for (const w of ways) for (const p of [w.points[0], w.points[w.points.length - 1]]) {
    const k = key(p);
    if (!byEnd.has(k)) byEnd.set(k, []);
    byEnd.get(k).push(w);
  }
  for (const w of ways) {
    if (used.has(w)) continue;
    used.add(w);
    let pts = w.points.slice();
    const members = [w];
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const end = dir === 0 ? pts[pts.length - 1] : pts[0];
        const cand = (byEnd.get(key(end)) || []).filter((o) => !used.has(o) && o.kind === w.kind);
        if (cand.length !== 1) break;
        const o = cand[0];
        used.add(o); members.push(o);
        let op = o.points.slice();
        if (dir === 0) { if (key(op[0]) !== key(end)) op.reverse(); pts = pts.concat(op.slice(1)); }
        else { if (key(op[op.length - 1]) !== key(end)) op.reverse(); pts = op.slice(0, -1).concat(pts); }
      }
    }
    chains.push({ ways: members, main: members.reduce((a, b) => (polyLength(b.points) > polyLength(a.points) ? b : a)), points: pts });
  }
  return chains;
}

function distToPolyline(x, z, pts) {
  let best = Infinity, side = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], ex = pts[i][0] - ax, ez = pts[i][1] - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    const dx = x - ax - ex * t, dz = z - az - ez * t, d = Math.hypot(dx, dz);
    if (d < best) { best = d; side = Math.sign(-ez * dx + ex * dz) || 1; }
  }
  return { d: best, side };
}

// ---------------------------------------------------------------------------------------------------------------
export function createBridges(ctx) {
  const T0 = performance.now();
  const data = ctx.data;
  const skip = ctx.skipRoadIds || new Set();
  const hf = ctx.heightfield;
  const inGrid = (x, z) => x >= hf.minX && x <= hf.maxX && z >= hf.minZ && z <= hf.maxZ;
  const ground = (x, z) => (ctx.terrain?.extHeightAt ? ctx.terrain.extHeightAt(x, z) : ctx.heightAt(x, z));
  const M = ctx.materials;
  const mats = {
    asphalt: M.get('asphalt'),
    walk: M.get('sidewalk'),
    concrete: M.get('concrete'),
    stone: M.get('sandstone'),
    steel: M.color('#4d5752', { roughness: 0.55, metalness: 0.55 }),
    rail: M.get('darkMetal'),
    white: M.color('#e9e7df', { roughness: 0.7 }),
    yellow: M.color('#d9a526', { roughness: 0.7 }),
  };
  for (const k of ['white', 'yellow']) {
    // markings sit a hair above the deck
    if (!mats[k].userData.bridgeMarking) {
      mats[k] = mats[k].clone();
      mats[k].polygonOffset = true; mats[k].polygonOffsetFactor = -2; mats[k].polygonOffsetUnits = -2;
      mats[k].userData.bridgeMarking = true;
    }
  }
  const buf = {};
  for (const k of Object.keys(mats)) buf[k] = new GeoBuf();

  // ---- collect & chain bridge ways
  const ways = [];
  const extended = extendedBridgeRoads(data, { minX: hf.minX, minZ: hf.minZ, maxX: hf.maxX, maxZ: hf.maxZ });
  for (const r of data.roads) {
    if (!r.bridge || r.tunnel || skip.has(r.id) || r.points.length < 2) continue;
    const known = KNOWN_BRIDGES[r.name] || null;
    const width = known?.width && !(r.width > known.width) ? known.width : r.width;
    ways.push({ ...r, points: extended.get(r.id) || r.points, width, known, kind: 'road' });
  }
  for (const p of data.paths) if (p.bridge && !p.tunnel && !p.indoor && !skip.has(p.id) && p.points.length > 1) ways.push({ ...p, kind: 'path' });
  const chains = chainWays(ways);
  const roadChains = chains.filter((c) => c.main.kind === 'road');
  const pathChains = chains.filter((c) => c.main.kind === 'path');

  // ---- attach parallel footways (mapped bridge sidewalks) to road bridges
  for (const rc of roadChains) {
    rc.sidewalks = [];
    const half = (rc.main.width || 9) / 2;
    for (const pc of pathChains) {
      if (pc.attached) continue;
      let maxD = 0, sideSum = 0;
      for (const [x, z] of pc.points) { const { d, side } = distToPolyline(x, z, rc.points); maxD = Math.max(maxD, d); sideSum += side * d; }
      if (maxD < half + 11 && polyLength(pc.points) > 5) {
        pc.attached = true;
        // OSM often draws bridge sidewalks a few metres too far out: snap them against the roadway
        const w = Math.max(2.4, pc.main.width || 2.4);
        const off = Math.min(pc.points.reduce((acc, [x, z]) => acc + distToPolyline(x, z, rc.points).d, 0) / pc.points.length, half + 0.4 + w / 2);
        rc.sidewalks.push({ side: Math.sign(sideSum) || 1, off, w });
      }
    }
  }

  // ---- building-end test (footbridges that land inside a building keep the level of their other end)
  const bIndex = data.buildings.filter((b) => b.footprint && b.footprint.length > 2).map((b) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.footprint) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { b, x0, x1, z0, z1 };
  });
  const nearBuilding = (x, z) => bIndex.some((e) => x > e.x0 - 1.5 && x < e.x1 + 1.5 && z > e.z0 - 1.5 && z < e.z1 + 1.5 &&
    (pointInRing(x, z, e.b.footprint) || distToPolyline(x, z, e.b.footprint.concat([e.b.footprint[0]])).d < 1.5));

  const decks = []; // for deckHeightAt()
  const walkGeos = [];
  const colliderCount = { n: 0 };
  const lamps = [];
  const panthers = [];

  const build = (chain, isRoad) => {
    let pts = chain.points;
    if (polyLength(pts) < 3) return;
    const w = chain.main;
    const a0 = pts[0], b0 = pts[pts.length - 1];
    const bA = !isRoad && nearBuilding(a0[0], a0[1]), bB = !isRoad && nearBuilding(b0[0], b0[1]);
    // The 4.8 m DEM blurs ravine edges: just beyond a deck end the approach often keeps climbing (Schenley
    // Bridge: 1.3–2 m within 3 m), which left the deck end below the approach road with a raised lip. Such ends
    // are carried EXT m further out, onto the approach, and take the terrain height there.
    const EXT = 4;
    const extend = (e, n) => {
      if (!inGrid(e[0], e[1])) return null;
      const dx = e[0] - n[0], dz = e[1] - n[1], l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
      const rise = ctx.heightAt(e[0] + ux * 3, e[1] + uz * 3) - ctx.heightAt(e[0], e[1]);
      return rise > 0.3 && inGrid(e[0] + ux * EXT, e[1] + uz * EXT) ? [e[0] + ux * EXT, e[1] + uz * EXT] : null;
    };
    const eA = bA ? null : extend(a0, pts[1]), eB = bB ? null : extend(b0, pts[pts.length - 2]);
    if (eA || eB) pts = [...(eA ? [eA] : []), ...pts, ...(eB ? [eB] : [])];
    const L = polyLength(pts);
    const width = isRoad ? (w.width || 9) : Math.max(2.4, w.width || 2.4);
    // deck cross-section (distances from the centreline)
    let left = width / 2, right = width / 2, walkL = 0, walkR = 0;
    if (isRoad) {
      for (const sw of chain.sidewalks || []) {
        const edge = sw.off + sw.w / 2;
        if (sw.side > 0) right = Math.max(right, edge); else left = Math.max(left, edge);
      }
      const minWalk = w.type === 'construction' || w.type === 'service' ? 1.2 : 2.2;
      if (right - width / 2 < minWalk) right = width / 2 + minWalk;
      if (left - width / 2 < minWalk) left = width / 2 + minWalk;
      walkR = right - width / 2; walkL = left - width / 2;
    }
    // end heights
    const a = pts[0], b = pts[pts.length - 1];
    let hA = inGrid(a[0], a[1]) ? ctx.heightAt(a[0], a[1]) : null;
    let hB = inGrid(b[0], b[1]) ? ctx.heightAt(b[0], b[1]) : null;
    if (!isRoad) {
      if (bA && !bB) hA = hB; else if (bB && !bA) hB = hA;
      else if (bA && bB && hA !== null && hB !== null) hA = hB = Math.max(hA, hB); // skybridge between buildings: level
    }
    if (hA === null && hB === null) return;
    if (hA === null) hA = hB;
    if (hB === null) hB = hA;
    const camber = Math.min(1.2, L * 0.005);
    const yDeck = (s) => hA + (hB - hA) * (s / L) + camber * 4 * (s / L) * (1 - s / L);
    const S = resamplePolyline(pts, 2).map((p) => ({ ...p, nx: -p.tz, nz: p.tx }));
    // smooth normals at sample points (average adjacent tangents)
    for (let i = 1; i < S.length - 1; i++) {
      let tx = S[i + 1].x - S[i - 1].x, tz = S[i + 1].z - S[i - 1].z;
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      S[i].tx = tx; S[i].tz = tz; S[i].nx = -tz; S[i].nz = tx;
    }
    const yS = S.map((p) => yDeck(p.s));
    const gS = S.map((p) => ground(p.x, p.z));
    const yOf = (i) => yS[i];
    const thick = isRoad ? 1.1 : 0.45;
    const historic = isRoad && L > 60;
    const parapetMat = historic ? 'stone' : 'concrete';
    const curbH = isRoad ? 0.18 : 0;
    const walkMat = isRoad ? 'walk' : (w.type === 'steps' ? 'concrete' : 'walk');

    // ---- deck surfaces
    const walkBuf = new GeoBuf();
    if (isRoad) {
      sweepSeg(buf.asphalt, S, yOf, [-width / 2, 0], [width / 2, 0], [0, 1]);
      sweepSeg(walkBuf, S, yOf, [-width / 2, 0], [width / 2, 0], [0, 1]);
      for (const sgn of [1, -1]) {
        const e = sgn > 0 ? right : -left, c = sgn * width / 2;
        sweepSeg(buf.walk, S, yOf, [c, 0], [c, curbH], [-sgn, 0]);
        sweepSeg(buf.walk, S, yOf, [c, curbH], [e, curbH], [0, 1]);
        sweepSeg(walkBuf, S, yOf, [c, curbH], [e, curbH], [0, 1]);
      }
    } else {
      sweepSeg(buf[walkMat], S, yOf, [-left, 0], [right, 0], [0, 1]);
      sweepSeg(walkBuf, S, yOf, [-left, 0], [right, 0], [0, 1]);
      if (w.type === 'steps') {
        // tread nosings as thin dark lines every 0.3 m of rise would need real steps; a ramped deck reads fine here
      }
    }
    // ---- parapets / fascia / underside
    const parH = isRoad ? 1.05 : 0.12, parT = isRoad ? 0.4 : 0.15;
    for (const sgn of [1, -1]) {
      const e = sgn > 0 ? right : -left, o = e + sgn * parT;
      sweepSeg(buf[parapetMat], S, yOf, [e, curbH], [e, curbH + parH], [-sgn, 0]);
      sweepSeg(buf[parapetMat], S, yOf, [e, curbH + parH], [o, curbH + parH], [0, 1]);
      sweepSeg(buf[parapetMat], S, yOf, [o, curbH + parH], [o, -thick], [sgn, 0]);
    }
    sweepSeg(buf.concrete, S, yOf, [right + parT, -thick], [-left - parT, -thick], [0, -1]);
    // end caps of the deck slab (visible when the bridge floats over a slope)
    for (const [i, dir] of [[0, -1], [S.length - 1, 1]]) {
      const p = S[i], y = yS[i];
      const P = (off, dy) => [p.x + p.nx * off, y + dy, p.z + p.nz * off];
      const ex = [p.tx * dir, 0, p.tz * dir];
      const r0 = right + parT, l0 = -left - parT;
      buf.concrete.quad(P(l0, -thick), P(r0, -thick), P(r0, curbH), P(l0, curbH), [l0, -thick], [r0, -thick], [r0, curbH], [l0, curbH], ex);
    }

    // ---- railings for footbridges (posts + rails) / lamp standards for road bridges
    if (!isRoad) {
      for (const sgn of [1, -1]) {
        const e = sgn > 0 ? right - 0.06 : -left + 0.06;
        const rail = offsetPolyline(S.map((p) => [p.x, p.z]), e);
        for (const h of [1.1, 0.6]) {
          sweepSeg(buf.rail, S, (i) => yS[i] + h, [e - 0.03, 0], [e + 0.03, 0], [0, 1]);
          sweepSeg(buf.rail, S, (i) => yS[i] + h, [e + sgn * 0.03, -0.05], [e + sgn * 0.03, 0], [sgn, 0]);
          sweepSeg(buf.rail, S, (i) => yS[i] + h, [e - sgn * 0.03, -0.05], [e - sgn * 0.03, 0], [-sgn, 0]);
        }
        for (let i = 0; i < S.length; i += 1) {
          const p = S[i];
          boxAt(buf.rail, rail[i][0], yS[i], rail[i][1], 0.07, 0.07, 1.12, p.tx, p.tz);
        }
      }
    } else {
      for (let s = 6; s < L - 3; s += 22) {
        const k = Math.min(S.length - 1, Math.round(s / (L / (S.length - 1))));
        const p = S[k];
        for (const sgn of [1, -1]) {
          const e = sgn > 0 ? right + parT / 2 : -left - parT / 2;
          lamps.push({ x: p.x + p.nx * e, y: yS[k] + curbH + parH, z: p.z + p.nz * e });
        }
      }
    }

    // ---- lane markings
    if (isRoad && ROAD_TYPES_WITH_MARKINGS.has(w.type) && width >= 6) {
      const strip = (b2, off, wd, dash = null) => {
        if (!dash) { sweepSeg(b2, S, (i) => yS[i] + 0.012, [off - wd / 2, 0], [off + wd / 2, 0], [0, 1]); return; }
        // dashed: emit per-sample pieces that fall on a dash
        for (let i = 0; i < S.length - 1; i++) {
          const mid = (S[i].s + S[i + 1].s) / 2;
          if (mid % (dash[0] + dash[1]) > dash[0]) continue;
          sweepSeg(b2, [S[i], S[i + 1]], (k) => yS[i + k] + 0.012, [off - wd / 2, 0], [off + wd / 2, 0], [0, 1]);
        }
      };
      if (!w.oneway) {
        strip(buf.yellow, -0.13, 0.12); strip(buf.yellow, 0.13, 0.12);
        const lanes = w.lanes || 2;
        const per = Math.max(1, Math.floor(lanes / 2));
        const lw = (width / 2 - 0.4) / per;
        for (let j = 1; j < per; j++) for (const sgn of [1, -1]) strip(buf.white, sgn * j * lw, 0.12, [3, 9]);
      }
      for (const sgn of [1, -1]) strip(buf.white, sgn * (width / 2 - 0.35), 0.12);
    }

    // ---- substructure
    let Dmax = 0;
    for (let i = 0; i < S.length; i++) Dmax = Math.max(Dmax, yS[i] - thick - gS[i]);
    const bottom = (i) => yS[i] - thick;
    const deckW = left + right + 2 * parT;
    const centreOff = (right - left) / 2;
    const known = isRoad ? chain.ways.map((x) => x.known).find(Boolean) : null;
    if (known?.truss && Dmax > 9) {
      deckTruss(ctx, buf, S, yS, gS, thick, deckW, centreOff, known.truss, colliderCount);
    } else if (isRoad && Dmax > 9 && L > 45) {
      // steel deck arch between springing points + stone approach arches
      let i0 = S.findIndex((_, i) => bottom(i) - gS[i] > 0.42 * Dmax);
      let i1 = S.length - 1 - [...S].reverse().findIndex((_, k) => bottom(S.length - 1 - k) - gS[S.length - 1 - k] > 0.42 * Dmax);
      if (i1 - i0 < 6) { i0 = Math.max(1, i0 - 3); i1 = Math.min(S.length - 2, i1 + 3); }
      const y0 = gS[i0] - 0.5, y1 = gS[i1] - 0.5;
      const sMid = (i0 + i1) / 2;
      const crown = bottom(Math.round(sMid)) - 0.25;
      // near-parabolic rib (three-hinged deck arch), springing points may sit at different heights
      const archY = (i) => {
        const u = (i - i0) / (i1 - i0);
        return y0 + (y1 - y0) * u + (crown - (y0 + y1) / 2) * (1 - Math.abs(2 * u - 1) ** 2.2);
      };
      const ribOffs = [-(deckW / 2 - 1.6), deckW / 2 - 1.6].map((o) => o + centreOff);
      const ribD = 1.5, ribW = 0.8;
      for (const ro of ribOffs) {
        // rib as a rectangular tube following the arch curve
        const C = [];
        for (let i = i0; i <= i1; i++) C.push({ i, x: S[i].x + S[i].nx * ro, y: archY(i), z: S[i].z + S[i].nz * ro, nx: S[i].nx, nz: S[i].nz, s: S[i].s });
        for (let k = 0; k < C.length - 1; k++) {
          const p = C[k], q = C[k + 1];
          const corner = (c, sw, sd) => [c.x + c.nx * sw * ribW / 2, c.y + sd * ribD / 2, c.z + c.nz * sw * ribW / 2];
          for (const [sw, e] of [[1, [p.nx, 0, p.nz]], [-1, [-p.nx, 0, -p.nz]]]) {
            buf.steel.quad(corner(p, sw, -1), corner(q, sw, -1), corner(q, sw, 1), corner(p, sw, 1), [p.s, p.y], [q.s, q.y], [q.s, q.y + 1], [p.s, p.y + 1], e);
          }
          buf.steel.quad(corner(p, -1, 1), corner(p, 1, 1), corner(q, 1, 1), corner(q, -1, 1), [p.s, 0], [p.s, 1], [q.s, 1], [q.s, 0], [0, 1, 0]);
          buf.steel.quad(corner(p, -1, -1), corner(p, 1, -1), corner(q, 1, -1), corner(q, -1, -1), [p.s, 0], [p.s, 1], [q.s, 1], [q.s, 0], [0, -1, 0]);
        }
        // spandrel posts
        for (let i = i0 + 2; i < i1 - 1; i += 2) {
          const top = bottom(i), base = archY(i) + ribD / 2;
          if (top - base < 0.4) continue;
          boxAt(buf.steel, S[i].x + S[i].nx * ro, base, S[i].z + S[i].nz * ro, 0.45, 0.55, top - base, S[i].tx, S[i].tz);
        }
        // skewback blocks (stone) where the ribs spring
        for (const i of [i0, i1]) {
          boxAt(buf.stone, S[i].x + S[i].nx * ro, gS[i] - 2, S[i].z + S[i].nz * ro, 3.2, 2.4, archY(i) - gS[i] + 2.6, S[i].tx, S[i].tz, 0.1);
        }
      }
      // cross bracing (lateral struts between ribs at intervals)
      for (let i = i0 + 3; i < i1 - 2; i += 4) {
        const y = archY(i);
        const cx = S[i].x + S[i].nx * centreOff, cz = S[i].z + S[i].nz * centreOff;
        boxAt(buf.steel, cx, y - 0.3, cz, 0.35, Math.abs(ribOffs[1] - ribOffs[0]), 0.6, S[i].tx, S[i].tz);
      }
      // floor beams under the deck
      for (let i = 0; i < S.length; i += 2) {
        const h = 0.7;
        boxAt(buf.steel, S[i].x + S[i].nx * centreOff, bottom(i) - h, S[i].z + S[i].nz * centreOff, 0.35, deckW - 0.6, h, S[i].tx, S[i].tz);
      }
      // stone approach piers + arches outside the steel span
      for (const [from, to, step] of [[1, i0 - 2, 5], [S.length - 2, i1 + 2, -5]]) {
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          const h = bottom(i) - gS[i];
          if (h < 1.5) continue;
          boxAt(buf.stone, S[i].x + S[i].nx * centreOff, gS[i] - 1.5, S[i].z + S[i].nz * centreOff, 2.2, deckW - 0.4, h + 1.5, S[i].tx, S[i].tz, 0.04);
          colliderAt(ctx, S[i].x + S[i].nx * centreOff, S[i].z + S[i].nz * centreOff, 1.1, (deckW - 0.4) / 2, S[i].tx, S[i].tz, gS[i] - 2, bottom(i), colliderCount);
        }
      }
      for (const i of [i0, i1]) colliderAt(ctx, S[i].x + S[i].nx * centreOff, S[i].z + S[i].nz * centreOff, 1.6, deckW / 2, S[i].tx, S[i].tz, gS[i] - 2, archY(i) + 0.5, colliderCount);
    } else if (Dmax > 2.2) {
      // piers every ~14–22 m
      const span = isRoad ? 20 : 15;
      const n = Math.max(1, Math.round(L / span));
      for (let k = 1; k < n; k++) {
        const i = Math.round((k / n) * (S.length - 1));
        const h = bottom(i) - gS[i];
        if (h < 1) continue;
        const cx = S[i].x + S[i].nx * centreOff, cz = S[i].z + S[i].nz * centreOff;
        if (isRoad) {
          boxAt(buf.concrete, cx, gS[i] - 1.5, cz, 1.4, deckW - 1, h + 1.5, S[i].tx, S[i].tz, 0.03);
          colliderAt(ctx, cx, cz, 0.7, (deckW - 1) / 2, S[i].tx, S[i].tz, gS[i] - 2, bottom(i), colliderCount);
        } else {
          boxAt(buf.steel, cx, gS[i] - 1, cz, 0.5, 0.5, h + 1, S[i].tx, S[i].tz);
          boxAt(buf.steel, cx, bottom(i) - 0.4, cz, 0.5, deckW, 0.4, S[i].tx, S[i].tz);
          ctx.colliders.addCircle(cx, cz, 0.35, gS[i] - 2, bottom(i), 'bridge-pier');
          colliderCount.n++;
        }
      }
      // girders under footbridges
      if (!isRoad) for (const sgn of [1, -1]) sweepSeg(buf.steel, S, (i) => bottom(i), [sgn * (deckW / 2 - 0.5), 0], [sgn * (deckW / 2 - 0.5), -0.6], [sgn, 0]);
    }
    // abutments at both ends (wall down to the terrain)
    for (const i of [0, S.length - 1]) {
      const h = bottom(i) - gS[i];
      if (h < 0.3) continue;
      const cx = S[i].x + S[i].nx * centreOff, cz = S[i].z + S[i].nz * centreOff;
      boxAt(buf[isRoad ? 'stone' : 'concrete'], cx, gS[i] - 1.5, cz, 2.5, deckW, h + 1.5, S[i].tx, S[i].tz);
    }

    // ---- colliders along the parapets / railings
    for (let i = 0; i < S.length - 1; i++) {
      const p = S[i], q = S[i + 1];
      const tx = q.x - p.x, tz = q.z - p.z, len = Math.hypot(tx, tz) || 1;
      const yMin = Math.min(yS[i], yS[i + 1]) - 0.3, yMax = Math.max(yS[i], yS[i + 1]) + 1.2;
      for (const sgn of [1, -1]) {
        const e = sgn > 0 ? right + parT / 2 : -left - parT / 2;
        const nx = (p.nx + q.nx) / 2, nz = (p.nz + q.nz) / 2;
        ctx.colliders.addBox((p.x + q.x) / 2 + nx * e, (p.z + q.z) / 2 + nz * e, len / 2 + 0.05, Math.max(0.12, parT / 2), -Math.atan2(tz, tx), yMin, yMax, 'bridge-rail');
        colliderCount.n++;
      }
    }

    // ---- bronze panthers on stone pedestals at the four corners (Panther Hollow Bridge)
    if (known?.panthers) {
      for (const [i, dir] of [[0, -1], [S.length - 1, 1]]) {
        // at the end of the span proper (the deck may have been carried a few metres onto the approach)
        const k = Math.max(0, Math.min(S.length - 1, i - dir * Math.round(((eA && i === 0) || (eB && i > 0) ? EXT : 0) / 2 + 1)));
        const p = S[k];
        for (const sgn of [1, -1]) {
          const e = sgn > 0 ? right + parT + 0.75 : -left - parT - 0.75;
          const x = p.x + p.nx * e, z = p.z + p.nz * e;
          const yD = yS[k] + curbH, yb = Math.min(yD, ground(x, z)) - 0.6, yt = yD + 1.75;
          // sandstone pedestal: plinth, shaft, cornice
          boxAt(buf.stone, x, yb, z, 1.9, 1.5, yD + 0.35 - yb, p.tx, p.tz);
          boxAt(buf.stone, x, yD + 0.35, z, 1.6, 1.2, yt - 0.22 - yD - 0.35, p.tx, p.tz, 0.03);
          boxAt(buf.stone, x, yt - 0.22, z, 1.85, 1.45, 0.22, p.tx, p.tz);
          ctx.colliders.addBox(x, z, 0.95, 0.75, -Math.atan2(p.tz, p.tx), yb, yt + 1.2, 'panther');
          colliderCount.n++;
          panthers.push({ x, z, y: yt, tx: p.tx * dir, tz: p.tz * dir, known, name: w.name });
        }
      }
    }

    // ---- walkable deck (invisible low-poly proxy per bridge, so raycasts cull by bounding sphere)
    const wg = walkBuf.geometry();
    wg.computeBoundingSphere();
    walkGeos.push(wg);
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (const p of S) { bx0 = Math.min(bx0, p.x); bx1 = Math.max(bx1, p.x); bz0 = Math.min(bz0, p.z); bz1 = Math.max(bz1, p.z); }
    const bm = Math.max(left, right) + parT + 0.5;
    decks.push({ S, yS, left: left + parT, right: right + parT, parT, bb: [bx0 - bm, bz0 - bm, bx1 + bm, bz1 + bm], name: w.name || null, id: w.id, length: L, depth: Dmax });
  };

  for (const c of roadChains) build(c, true);
  for (const c of pathChains) if (!c.attached) build(c, false);

  // ---- assemble meshes
  const group = new THREE.Group();
  group.name = 'bridges';
  for (const [k, b] of Object.entries(buf)) {
    if (b.empty) continue;
    const mesh = new THREE.Mesh(b.geometry(), mats[k]);
    mesh.name = `bridge-${k}`;
    mesh.castShadow = k !== 'white' && k !== 'yellow';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const walkMat = new THREE.MeshBasicMaterial({ visible: false });
  for (const g of walkGeos) {
    const m = new THREE.Mesh(g, walkMat);
    m.name = 'bridge-walkable';
    m.visible = false;
    group.add(m);
    ctx.walkables.add(m);
  }
  if (lamps.length) group.add(buildLamps(ctx, lamps));
  if (panthers.length) {
    try { group.add(buildPanthers(ctx, panthers)); } catch (e) { console.warn('[bridges] panthers failed', e); }
  }
  group.updateMatrixWorld(true);
  ctx.scene.add(group);

  // Deck height lookup (for barriers / props that sit on bridges): returns y of the deck at (x, z) or null.
  function deckHeightAt(x, z) {
    let best = null;
    for (const d of decks) {
      if (x < d.bb[0] || x > d.bb[2] || z < d.bb[1] || z > d.bb[3]) continue;
      for (let i = 0; i < d.S.length - 1; i++) {
        const p = d.S[i], q = d.S[i + 1];
        const ex = q.x - p.x, ez = q.z - p.z, l2 = ex * ex + ez * ez || 1e-9;
        const t = ((x - p.x) * ex + (z - p.z) * ez) / l2;
        if (t < -0.05 || t > 1.05) continue;
        const lat = (-(ez) * (x - p.x) + ex * (z - p.z)) / Math.sqrt(l2);
        if (lat > d.right + 0.3 || lat < -d.left - 0.3) continue;
        const y = d.yS[i] + (d.yS[i + 1] - d.yS[i]) * Math.max(0, Math.min(1, t));
        if (best === null || y > best) best = y;
      }
    }
    return best;
  }
  // Like deckHeightAt, but also accepts points up to `tol` m beyond a deck's outer edge (OSM often maps barriers /
  // sidewalks on a bridge a few metres too far out): { y, off (beyond the edge), x, z (moved just inside the
  // parapet when off) } of the highest such deck, or null.
  function deckSnap(x, z, tol = 0) {
    let best = null;
    for (const d of decks) {
      if (x < d.bb[0] - tol || x > d.bb[2] + tol || z < d.bb[1] - tol || z > d.bb[3] + tol) continue;
      for (let i = 0; i < d.S.length - 1; i++) {
        const p = d.S[i], q = d.S[i + 1];
        const ex = q.x - p.x, ez = q.z - p.z, l2 = ex * ex + ez * ez || 1e-9;
        const t = ((x - p.x) * ex + (z - p.z) * ez) / l2;
        if (t < -0.05 || t > 1.05) continue;
        const l = Math.sqrt(l2), lat = (-(ez) * (x - p.x) + ex * (z - p.z)) / l;
        if (lat > d.right + 0.3 + tol || lat < -d.left - 0.3 - tol) continue;
        const y = d.yS[i] + (d.yS[i + 1] - d.yS[i]) * Math.max(0, Math.min(1, t));
        if (best && y <= best.y) continue;
        const off = lat > d.right + 0.3 || lat < -d.left - 0.3;
        let sx = x, sz = z;
        if (off) {
          const lim = (sgn) => sgn * ((sgn > 0 ? d.right : d.left) - (d.parT || 0) - 0.45);
          const to = Math.max(lim(-1), Math.min(lim(1), lat)) - lat;
          sx = x - (ez / l) * to; sz = z + (ex / l) * to;
        }
        best = { y, off, x: sx, z: sz };
      }
    }
    return best;
  }

  return { group, decks, deckHeightAt, deckSnap, stats:{ bridges: decks.length, colliders: colliderCount.n, ms: Math.round(performance.now() - T0) } };
}

function colliderAt(ctx, x, z, hl, hw, tx, tz, yMin, yMax, counter) {
  ctx.colliders.addBox(x, z, hl, hw, -Math.atan2(tz, tx), yMin, yMax, 'bridge-pier');
  counter.n++;
}

// Straight member of square-ish section (w across, h deep) between two world points; `side` is the horizontal
// direction used for vertical members.
function beam(buf, a, b, w, h, side) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1;
  const fx = dx / L, fy = dy / L, fz = dz / L;
  let sx = -fz, sz = fx;
  const sl = Math.hypot(sx, sz);
  if (sl < 0.2) { sx = side[0]; sz = side[1]; } else { sx /= sl; sz /= sl; }
  // up = f × s (s horizontal)
  let ux = fy * sz, uy = fz * sx - fx * sz, uz = -fy * sx;
  const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  const c = (p, s, u) => [p[0] + sx * s * w / 2 + ux * u * h / 2, p[1] + uy * u * h / 2, p[2] + sz * s * w / 2 + uz * u * h / 2];
  for (const [s0, u0, s1, u1, e] of [[-1, 1, 1, 1, [ux, uy, uz]], [1, -1, -1, -1, [-ux, -uy, -uz]], [1, 1, 1, -1, [sx, 0, sz]], [-1, -1, -1, 1, [-sx, 0, -sz]]]) {
    buf.quad(c(a, s0, u0), c(a, s1, u1), c(b, s1, u1), c(b, s0, u0), [0, 0], [w, 0], [w, L], [0, L], e);
  }
}

// Steel deck truss (Wichert type, continuous over two river piers with deeper "kite" panels above them) under a
// deck sampled at S (every ~2 m): two vertical Warren trusses below the parapets, verticals at every panel point,
// lateral struts, and tapering concrete piers. spans = fractions of the length.
function deckTruss(ctx, buf, S, yS, gS, thick, deckW, centreOff, { spans }, counter) {
  const n = S.length - 1, L = S[n].s;
  const piers = [];
  let acc = 0;
  for (let k = 0; k < spans.length - 1; k++) { acc += spans[k]; piers.push(acc * L); }
  const at = (s) => { // interpolated sample at arc length s
    const f = Math.max(0, Math.min(n - 1e-6, (s / L) * n)), i = Math.floor(f), t = f - i;
    const p = S[i], q = S[i + 1];
    return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, y: yS[i] + (yS[i + 1] - yS[i]) * t - thick, g: gS[i] + (gS[i + 1] - gS[i]) * t, nx: p.nx, nz: p.nz, tx: p.tx, tz: p.tz };
  };
  const depth = (s) => {
    let d = 5.2;
    for (const sp of piers) d += 6.5 * Math.max(0, 1 - Math.abs(s - sp) / 34);
    return Math.min(d, 1.4 + 0.3 * Math.min(s, L - s)); // shallow bearings at the abutments
  };
  const panel = L / Math.max(4, Math.round(L / 8));
  const nodes = [];
  for (let s = 0; s <= L + 1e-6; s += panel) nodes.push(s);
  const offs = [-(deckW / 2 - 1.4), deckW / 2 - 1.4].map((o) => o + centreOff);
  const P = (s, o, low) => { const a = at(s); return [a.x + a.nx * o, a.y - (low ? depth(s) : 0), a.z + a.nz * o]; };
  for (const o of offs) {
    for (let k = 0; k < nodes.length; k++) {
      const s = nodes[k], a = at(s), side = [a.tx, a.tz];
      if (k < nodes.length - 1) {
        const s2 = nodes[k + 1];
        beam(buf.steel, P(s, o, false), P(s2, o, false), 0.55, 0.7, side);      // top chord
        beam(buf.steel, P(s, o, true), P(s2, o, true), 0.6, 0.8, side);         // bottom chord
        // Warren diagonals, mirrored about each pier / mid-span so they read symmetric
        beam(buf.steel, k % 2 ? P(s, o, true) : P(s, o, false), k % 2 ? P(s2, o, false) : P(s2, o, true), 0.4, 0.4, side);
      }
      beam(buf.steel, P(s, o, false), P(s, o, true), 0.35, 0.45, side);         // verticals
    }
  }
  // lateral struts between the trusses (bottom chord level) and sway frames every other panel point
  for (let k = 1; k < nodes.length - 1; k++) {
    const s = nodes[k], side = [at(s).tx, at(s).tz];
    beam(buf.steel, P(s, offs[0], true), P(s, offs[1], true), 0.3, 0.35, side);
    if (k % 2 === 0) beam(buf.steel, P(s, offs[0], true), P(s, offs[1], false), 0.22, 0.22, side);
  }
  // piers: a pair of tall tapering concrete columns under the trusses, tied by a strut and a cap beam that
  // carries the kite panels
  for (const sp of piers) {
    const a = at(sp), top = a.y - depth(sp);
    if (top - a.g < 1) continue;
    for (const o of offs) {
      const x = a.x + a.nx * o, z = a.z + a.nz * o, g = a.g; // (ground under the column itself)
      boxAt(buf.concrete, x, g - 2, z, 3.6, 3.2, top - g + 2, a.tx, a.tz, 0.18);
      colliderAt(ctx, x, z, 1.8, 1.6, a.tx, a.tz, g - 2, top, counter);
    }
    const cx = a.x + a.nx * centreOff, cz = a.z + a.nz * centreOff, span = Math.abs(offs[1] - offs[0]);
    boxAt(buf.concrete, cx, top - 1.6, cz, 3.2, span + 3.2, 1.6, a.tx, a.tz);                 // cap beam
    if (top - a.g > 16) boxAt(buf.concrete, cx, a.g + (top - a.g) * 0.45, cz, 2.2, span, 1.4, a.tx, a.tz); // strut
  }
}

// Moretti's crouching panthers (bronze, 1897) on the bridge corners: a low-poly panther ~2.4 m nose to rump,
// body low over the fore paws, head raised, tail curled round the base; one merged mesh + a pick entry.
let pantherGeo = null;
function pantherGeometry() {
  if (pantherGeo) return pantherGeo;
  const parts = [];
  const add = (g, m) => { g.applyMatrix4(m); g.deleteAttribute('uv'); parts.push(g.index ? g.toNonIndexed() : g); };
  const M = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  // local frame: +x = forward (the way it looks), y up, base (rock) top at y = 0
  add(new THREE.IcosahedronGeometry(1, 1), M(0, 0.12, 0, 1.25, 0.34, 0.3));             // rock / base slab
  add(new THREE.IcosahedronGeometry(1, 1), M(-0.05, 0.62, 0, 0.82, 0.3, 0.3, 0, 0, 0.1)); // torso (chest a bit higher)
  add(new THREE.IcosahedronGeometry(1, 1), M(-0.62, 0.6, 0, 0.36, 0.33, 0.32));           // haunches
  add(new THREE.IcosahedronGeometry(1, 1), M(0.62, 0.8, 0, 0.26, 0.26, 0.25));             // shoulders
  add(new THREE.IcosahedronGeometry(1, 1), M(0.86, 1.02, 0, 0.21, 0.17, 0.17, 0, 0, -0.2)); // head
  add(new THREE.IcosahedronGeometry(1, 0), M(1.05, 0.98, 0, 0.1, 0.08, 0.1));              // muzzle
  for (const s of [-1, 1]) {
    add(new THREE.ConeGeometry(0.06, 0.1, 4), M(0.8, 1.16, s * 0.1, 1, 1, 1));             // ears
    add(new THREE.BoxGeometry(0.44, 0.1, 0.12), M(0.9, 0.3, s * 0.17, 1, 1, 1, 0, 0, 0.35)); // fore legs, reaching forward
    add(new THREE.BoxGeometry(0.26, 0.09, 0.14), M(1.08, 0.24, s * 0.17, 1, 1, 1));         // fore paws
    add(new THREE.BoxGeometry(0.46, 0.14, 0.16), M(-0.52, 0.38, s * 0.24, 1, 1, 1, 0, 0, -0.4)); // folded hind legs
    add(new THREE.BoxGeometry(0.3, 0.09, 0.15), M(-0.3, 0.26, s * 0.24, 1, 1, 1));          // hind paws
  }
  // tail: hangs off the rump and curls forward along the base
  const tail = [[-0.9, 0.55, 0], [-1.12, 0.36, 0.08], [-1.15, 0.24, 0.24], [-0.9, 0.24, 0.36], [-0.58, 0.25, 0.38]];
  for (let k = 0; k < tail.length - 1; k++) {
    const a = new THREE.Vector3(...tail[k]), b = new THREE.Vector3(...tail[k + 1]), d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(0.045, 0.055, d.length() + 0.04, 5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    g.deleteAttribute('uv');
    parts.push(g.toNonIndexed());
  }
  pantherGeo = mergeGeometries(parts);
  pantherGeo.computeVertexNormals();
  return pantherGeo;
}

function buildPanthers(ctx, list) {
  const base = pantherGeometry();
  const geos = list.map((p) => {
    const g = base.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(p.tz, p.tx)), new THREE.Vector3(1, 1, 1)));
    return g;
  });
  const mat = new THREE.MeshStandardMaterial({ color: '#3b3a33', metalness: 0.6, roughness: 0.42 });
  mat.name = 'bronze-panther';
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  mesh.name = 'panther-hollow-panthers';
  mesh.castShadow = true; mesh.receiveShadow = true;
  const k = list[0].known || {};
  let cx = 0, cy = 0, cz = 0;
  for (const p of list) { cx += p.x / list.length; cy += p.y / list.length; cz += p.z / list.length; }
  ctx.pick?.add?.(mesh, { key: `area:${k.infoKey || list[0].name}`, kind: 'area', name: k.infoKey || list[0].name, nameZh: k.nameZh, infoKey: k.infoKey, position: [cx, cy + 2, cz], radius: 90 });
  return mesh;
}

// Ornamental lamp standards on the parapets of the road bridges (emissive lanterns at night).
function buildLamps(ctx, lamps) {
  const pole = [], lantern = [];
  for (const l of lamps) {
    const p = new THREE.CylinderGeometry(0.07, 0.11, 3.6, 8);
    p.translate(l.x, l.y + 1.8, l.z);
    pole.push(p);
    const base = new THREE.CylinderGeometry(0.2, 0.26, 0.5, 8);
    base.translate(l.x, l.y + 0.25, l.z);
    pole.push(base);
    const glass = new THREE.CylinderGeometry(0.22, 0.14, 0.55, 8);
    glass.translate(l.x, l.y + 3.85, l.z);
    lantern.push(glass);
    const cap = new THREE.ConeGeometry(0.3, 0.3, 8);
    cap.translate(l.x, l.y + 4.25, l.z);
    pole.push(cap);
  }
  const g = new THREE.Group();
  const poleMesh = new THREE.Mesh(mergeGeometries(pole.map((x) => x.toNonIndexed())), ctx.materials.get('darkMetal'));
  poleMesh.castShadow = true;
  const lampMat = new THREE.MeshStandardMaterial({ color: '#f3e7c8', emissive: '#ffd89a', emissiveIntensity: 0, roughness: 0.4 });
  lampMat.name = 'bridge-lantern';
  ctx.materials.registerNightMaterial(lampMat, 2.2);
  const lanternMesh = new THREE.Mesh(mergeGeometries(lantern.map((x) => x.toNonIndexed())), lampMat);
  g.add(poleMesh, lanternMesh);
  g.name = 'bridge-lamps';
  return g;
}

export { GeoBuf, sweepSeg, boxAt, mulberry };
