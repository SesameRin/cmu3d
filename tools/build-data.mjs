// Converts raw OpenStreetMap + Terrarium elevation tiles into data/campus.js
// Usage: node tools/build-data.mjs
// Output assigns globalThis.CAMPUS_DATA so the page works from file:// without fetch().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data', 'campus.js');
const CURATED = path.join(ROOT, 'data', 'curated', 'buildings.json');

// ---------------------------------------------------------------- projection
// Local tangent-plane approximation. x = metres east, z = metres south (three.js: north is -Z).
const ORIGIN = { lat: 40.4430, lon: -79.9430 };
const M_PER_DEG_LAT = 111132.954 - 559.822 * Math.cos(2 * ORIGIN.lat * Math.PI / 180);
const M_PER_DEG_LON = 111412.84 * Math.cos(ORIGIN.lat * Math.PI / 180);
const project = (lat, lon) => [
  +((lon - ORIGIN.lon) * M_PER_DEG_LON).toFixed(2),
  +(-(lat - ORIGIN.lat) * M_PER_DEG_LAT).toFixed(2),
];
const BBOX = { s: 40.4345, w: -79.9575, n: 40.4505, e: -79.9325 };
const [minX, maxZ] = project(BBOX.s, BBOX.w);
const [maxX, minZ] = project(BBOX.n, BBOX.e);

// ---------------------------------------------------------------- load OSM
const osm = JSON.parse(fs.readFileSync(path.join(RAW, 'osm.json'), 'utf8'));
const nodes = new Map();
const ways = new Map();
const relations = [];
for (const e of osm.elements) {
  if (e.type === 'node') {
    const prev = nodes.get(e.id);
    // "out skel" repeats nodes without tags; keep the tagged copy
    if (!prev || e.tags) nodes.set(e.id, e);
  } else if (e.type === 'way') {
    const prev = ways.get(e.id);
    if (!prev || e.tags) ways.set(e.id, e);
  } else if (e.type === 'relation') relations.push(e);
}
const wayPoints = (w) => w.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => project(n.lat, n.lon));

// ---------------------------------------------------------------- geometry helpers
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
function closeless(ring) {
  if (ring.length > 1 && dist(ring[0], ring[ring.length - 1]) < 1e-6) return ring.slice(0, -1);
  return ring;
}
// Drop duplicate and nearly-collinear vertices (keeps shape to ~tol metres)
function simplifyRing(ring, tol = 0.25) {
  let pts = closeless(ring).filter((p, i, arr) => i === 0 || dist(p, arr[i - 1]) > 0.05);
  if (pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < 0.05) pts.pop();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const ab = dist(a, c);
      const cross = Math.abs((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]));
      const h = ab > 1e-9 ? cross / ab : 0;
      if (h < tol) { pts.splice(i, 1); changed = true; i--; }
    }
  }
  return pts;
}
function simplifyLine(pts, tol = 0.2) {
  if (pts.length < 3) return pts;
  // Douglas-Peucker
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let best = -1, bi = -1;
    const a = pts[s], c = pts[e], len = dist(a, c);
    for (let i = s + 1; i < e; i++) {
      const b = pts[i];
      const d = len > 1e-9 ? Math.abs((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / len : dist(a, b);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([s, bi], [bi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function centroid(ring) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f; cx += (p[0] + q[0]) * f; cz += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [+(cx / (3 * a)).toFixed(2), +(cz / (3 * a)).toFixed(2)];
}
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// Canonical orientation: outer rings CCW in (x, z) math space; holes CW.
const orient = (ring, ccw) => ((signedArea(ring) > 0) === ccw ? ring : ring.slice().reverse());

// Join way fragments into closed rings (multipolygon assembly)
function assembleRings(wayList) {
  const segs = wayList.map((w) => w.nodes.slice()).filter((s) => s.length > 1);
  const rings = [];
  while (segs.length) {
    let cur = segs.shift();
    let guard = 0;
    while (cur[0] !== cur[cur.length - 1] && guard++ < 1000) {
      const end = cur[cur.length - 1];
      const idx = segs.findIndex((s) => s[0] === end || s[s.length - 1] === end);
      if (idx < 0) break;
      const s = segs.splice(idx, 1)[0];
      cur = cur.concat(s[0] === end ? s.slice(1) : s.slice().reverse().slice(1));
    }
    if (cur[0] === cur[cur.length - 1] && cur.length >= 4) rings.push(cur);
  }
  return rings.map((ids) => ids.map((id) => nodes.get(id)).filter(Boolean).map((n) => project(n.lat, n.lon)));
}

// ---------------------------------------------------------------- terrain
const TERRAIN_Z = 15;
function lonLatToTilePx(lat, lon, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x * 256, y * 256];
}
const tiles = new Map();
for (const f of fs.readdirSync(path.join(RAW, 'terrain'))) {
  const m = f.match(/^t15_(\d+)_(\d+)\.png$/);
  if (!m) continue;
  const png = PNG.sync.read(fs.readFileSync(path.join(RAW, 'terrain', f)));
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
    h[i] = r * 256 + g + b / 256 - 32768;
  }
  tiles.set(`${m[1]}_${m[2]}`, h);
}
function rawElevation(px, py) {
  const sample = (ix, iy) => {
    const tx = Math.floor(ix / 256), ty = Math.floor(iy / 256);
    const t = tiles.get(`${tx}_${ty}`);
    if (!t) throw new Error(`missing terrain tile ${tx}_${ty}`);
    return t[(iy - ty * 256) * 256 + (ix - tx * 256)];
  };
  // pixel centres are at +0.5
  const fx = px - 0.5, fy = py - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const dx = fx - x0, dy = fy - y0;
  const a = sample(x0, y0), b = sample(x0 + 1, y0), c = sample(x0, y0 + 1), d = sample(x0 + 1, y0 + 1);
  return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
}
const CELL = 4; // metres between terrain samples
const gridW = Math.floor((maxX - minX) / CELL) + 1;
const gridH = Math.floor((maxZ - minZ) / CELL) + 1;
const elev = new Float32Array(gridW * gridH);
let eMin = Infinity, eMax = -Infinity;
for (let j = 0; j < gridH; j++) {
  for (let i = 0; i < gridW; i++) {
    const x = minX + i * CELL, z = minZ + j * CELL;
    const lon = ORIGIN.lon + x / M_PER_DEG_LON;
    const lat = ORIGIN.lat - z / M_PER_DEG_LAT;
    const [px, py] = lonLatToTilePx(lat, lon, TERRAIN_Z);
    const e = rawElevation(px, py);
    elev[j * gridW + i] = e;
    eMin = Math.min(eMin, e); eMax = Math.max(eMax, e);
  }
}
// Light smoothing to remove DEM stair-stepping (3x3 box, 1 pass)
const smooth = new Float32Array(elev.length);
for (let j = 0; j < gridH; j++) for (let i = 0; i < gridW; i++) {
  let s = 0, c = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= gridW || jj >= gridH) continue;
    s += elev[jj * gridW + ii]; c++;
  }
  smooth[j * gridW + i] = s / c;
}
// World y = 0 is fixed at 240 m ASL so coordinates stay stable when the data area changes. Heights are stored with
// a +HEIGHT_OFFSET so terrain below 240 m (Panther Hollow) remains representable in uint16.
const BASE_ELEV = 240;
const HEIGHT_OFFSET = 30;
function heightAt(x, z) {
  const fx = Math.min(Math.max((x - minX) / CELL, 0), gridW - 1.001);
  const fz = Math.min(Math.max((z - minZ) / CELL, 0), gridH - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), dx = fx - i, dz = fz - j;
  const g = (a, b) => smooth[b * gridW + a];
  return (g(i, j) * (1 - dx) * (1 - dz) + g(i + 1, j) * dx * (1 - dz) + g(i, j + 1) * (1 - dx) * dz + g(i + 1, j + 1) * dx * dz) - BASE_ELEV;
}
// Encode heights as Uint16 centimetres above (BASE_ELEV - HEIGHT_OFFSET), little-endian base64
const hbuf = Buffer.alloc(gridW * gridH * 2);
for (let k = 0; k < smooth.length; k++) hbuf.writeUInt16LE(Math.max(0, Math.min(65535, Math.round((smooth[k] - BASE_ELEV + HEIGHT_OFFSET) * 100))), k * 2);

// ---------------------------------------------------------------- CMU campus boundary
const campusRings = [];
for (const r of relations) {
  if (r.tags && r.tags.amenity === 'university' && /Carnegie Mellon/.test(r.tags.name || '')) {
    const outers = r.members.filter((m) => m.type === 'way' && m.role === 'outer').map((m) => ways.get(m.ref)).filter(Boolean);
    campusRings.push(...assembleRings(outers));
  }
}
for (const w of ways.values()) {
  if (w.tags && w.tags.amenity === 'university' && /Carnegie Mellon/.test(w.tags.name || '')) campusRings.push(wayPoints(w));
}
const inCampus = (p) => campusRings.some((r) => pointInRing(p, r));

// ---------------------------------------------------------------- curated overrides
let curated = {};
if (fs.existsSync(CURATED)) {
  const arr = JSON.parse(fs.readFileSync(CURATED, 'utf8'));
  for (const c of arr.buildings || arr) curated[c.id] = c;
}

// ---------------------------------------------------------------- buildings
const DEFAULT_HEIGHT = {
  house: 8, detached: 8, residential: 11, apartments: 14, dormitory: 13, university: 15, school: 10,
  college: 14, church: 14, cathedral: 20, chapel: 12, synagogue: 12, commercial: 11, office: 16, retail: 6,
  garage: 3, garages: 3, shed: 3, roof: 5, parking: 11, public: 12, civic: 12, hotel: 18, glasshouse: 12,
  greenhouse: 8, library: 14, industrial: 9, service: 4, hut: 3, yes: 9,
};
const num = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) ? n : undefined; };
// OSM length tags may be imperial: 23'0", 8'8", 10 ft, 4', 30" → metres; plain numbers (or "12 m") are metres.
const len = (v) => {
  const t = String(v ?? '').trim();
  if (!t) return undefined;
  let m = t.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/);
  if (m) return +m[1] * 0.3048 + (+m[2] || 0) * 0.0254;
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)$/i);
  if (m) return +m[1] * 0.3048;
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/i);
  if (m) return +m[1] * 0.0254;
  return num(t);
};
const buildings = [];
const partOwners = new Set(); // outlines that have building:part children get skipped
const buildingSources = [];
for (const w of ways.values()) {
  if (!w.tags) continue;
  if (w.tags.building || w.tags['building:part']) buildingSources.push({ id: 'w' + w.id, tags: w.tags, rings: [wayPoints(w)], holes: [] });
}
for (const r of relations) {
  if (!r.tags || !(r.tags.building || r.tags['building:part'])) continue;
  const outers = r.members.filter((m) => m.type === 'way' && m.role === 'outer').map((m) => ways.get(m.ref)).filter(Boolean);
  const inners = r.members.filter((m) => m.type === 'way' && m.role === 'inner').map((m) => ways.get(m.ref)).filter(Boolean);
  const oRings = assembleRings(outers), iRings = assembleRings(inners);
  // a relation may carry the building tags; its member ways (untagged) are not buildings themselves
  buildingSources.push({ id: 'r' + r.id, tags: r.tags, rings: oRings, holes: iRings });
}
// Simple 3D Buildings: skip an outline only when its parts cover most of it and the outline isn't taller than its parts
const explicitHeight = (t) => len(t.height) ?? (num(t['building:levels']) !== undefined ? num(t['building:levels']) * 3.6 : undefined);
const partSrcs = buildingSources.filter((b) => b.tags['building:part'] && !b.tags.building && b.rings[0]?.length >= 3)
  .map((b) => ({ id: b.id, c: centroid(b.rings[0]), area: Math.abs(signedArea(b.rings[0])), h: explicitHeight(b.tags) ?? 0,
    minH: len(b.tags.min_height) ?? (num(b.tags['building:min_level']) ?? 0) * 3.6 }));
const partParent = new Map(); // part source id -> outline source id
for (const src of buildingSources) {
  if (src.tags.building && !src.tags['building:part'] && src.rings.length === 1 && src.rings[0].length >= 3) {
    const inside = partSrcs.filter((p) => pointInRing(p.c, src.rings[0]));
    if (!inside.length) continue;
    for (const p of inside) partParent.set(p.id, src.id);
    // only parts that reach the ground count as covering the outline (Hillman Library's parts start above its ground floor)
    const coverage = inside.filter((p) => p.minH <= 0.5).reduce((s, p) => s + p.area, 0) / Math.abs(signedArea(src.rings[0]));
    const oh = explicitHeight(src.tags);
    const maxPart = Math.max(...inside.map((p) => p.h));
    if (coverage >= 0.6 && !(oh !== undefined && oh > maxPart + 3)) partOwners.add(src.id);
  }
}
for (const src of buildingSources) {
  const t = src.tags;
  const coveredByParts = partOwners.has(src.id) && !curated[src.id]?.keepOutline; // drawn by its parts instead
  if (t.building === 'no' || t.building === 'construction' || t.building === 'demolished') continue;
  if (t.location === 'underground' || (num(t.layer) ?? 0) < 0) continue;
  src.rings.forEach((ringRaw, ri) => {
    const ring = orient(simplifyRing(ringRaw), true);
    if (ring.length < 3) return;
    const c = centroid(ring);
    if (c[0] < minX - 150 || c[0] > maxX + 150 || c[1] < minZ - 150 || c[1] > maxZ + 150) return; // keep near-edge landmarks (e.g. Cathedral of Learning)
    const holes = src.holes.map((h) => orient(simplifyRing(h), false)).filter((h) => h.length >= 3 && pointInRing(h[0], ring));
    const area = Math.abs(signedArea(ring)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
    if (area < 4) return;
    const levels = num(t['building:levels']);
    const minLevel = num(t['building:min_level']);
    const type = t.building && t.building !== 'yes' ? t.building : (t['building:part'] && t['building:part'] !== 'yes' ? t['building:part'] : (t.building || 'yes'));
    let height = len(t.height);
    let heightSource = 'tag';
    if (height === undefined && levels !== undefined) { height = levels * 3.6 + (t['roof:shape'] && t['roof:shape'] !== 'flat' ? 2 : 0.8); heightSource = 'levels'; }
    if (height === undefined) {
      height = DEFAULT_HEIGHT[type] ?? 9; heightSource = 'default';
      // untagged small footprints are kiosks, sheds and garages, not two-storey blocks
      if (area < 30) height = Math.min(height, 3.2);
      else if (area < 60 && type !== 'house') height = Math.min(height, 4.2);
      else if (area < 120 && ['yes', 'shed', 'garage', 'kiosk', 'retail', 'hut', 'roof'].includes(type)) height = Math.min(height, 6.5);
      else if (type === 'house' && area < 45) height = Math.min(height, 4.5);
    }
    let minHeight = len(t.min_height) ?? (minLevel !== undefined ? minLevel * 3.6 : 0);
    const id = src.rings.length > 1 ? `${src.id}_${ri}` : src.id;
    const cur = (src.rings.length > 1 && curated[id]) || curated[src.id];
    // terrain samples under footprint
    const samples = ring.map((p) => heightAt(p[0], p[1])).concat([heightAt(c[0], c[1])]);
    const gMin = Math.min(...samples), gMax = Math.max(...samples);
    const gAvg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const operator = t.operator || '';
    const b = {
      id,
      osmId: src.id,
      name: t.name || null,
      type,
      part: !!t['building:part'] && !t.building,
      parentId: partParent.get(src.id) || null, // outline this building:part belongs to
      hidden: coveredByParts || undefined,      // outline fully represented by its parts
      campus: /Carnegie Mellon|Carneige Mellon/.test(operator) || inCampus(c) || !!cur?.campus,
      height: +height.toFixed(1),
      minHeight: +minHeight.toFixed(1),
      heightSource,
      levels: levels ?? null,
      roofShape: t['roof:shape'] || null,
      roofColor: t['roof:colour'] || null,
      color: t['building:colour'] || null,
      material: t['building:material'] || null,
      operator: operator || null,
      address: t['addr:housenumber'] && t['addr:street'] ? `${t['addr:housenumber']} ${t['addr:street']}` : null,
      wikipedia: t.wikipedia || null,
      footprint: ring,
      holes,
      centroid: c,
      area: +area.toFixed(1),
      ground: { min: +gMin.toFixed(2), max: +gMax.toFixed(2), avg: +gAvg.toFixed(2) },
    };
    if (cur) {
      for (const k of ['name', 'height', 'minHeight', 'roofShape', 'roofColor', 'color', 'material', 'style', 'landmark', 'campus', 'nameZh', 'hidden', 'facade', 'roof', 'levels']) {
        if (cur[k] !== undefined) b[k] = cur[k];
      }
      if (cur.height !== undefined) b.heightSource = 'curated';
    }
    buildings.push(b);
  });
}

// Drop duplicates (e.g. a tagged way that is also the outer ring of a tagged relation)
{
  const keep = [];
  for (const b of buildings) {
    const dup = keep.find((k) => dist(k.centroid, b.centroid) < 1.0 && Math.abs(k.area - b.area) / Math.max(k.area, b.area) < 0.05);
    if (!dup) { keep.push(b); continue; }
    const score = (x) => (x.osmId.startsWith('r') ? 2 : 0) + (x.name ? 1 : 0) + (x.heightSource !== 'default' ? 1 : 0);
    if (score(b) > score(dup)) keep[keep.indexOf(dup)] = b;
  }
  buildings.length = 0;
  buildings.push(...keep);
}

// ---------------------------------------------------------------- linear features
const ROAD_WIDTH = {
  motorway: 16, trunk: 14, trunk_link: 7, primary: 13, primary_link: 7, secondary: 11, secondary_link: 6,
  tertiary: 9, tertiary_link: 6, residential: 7, unclassified: 6.5, living_street: 6, service: 4.5,
  pedestrian: 5, footway: 2.4, path: 1.6, cycleway: 2.4, steps: 2.6, track: 3, bridleway: 2, construction: 6,
};
const roads = [], paths = [], railways = [], barriers = [], cliffs = [];
for (const w of ways.values()) {
  const t = w.tags;
  if (!t) continue;
  const pts = simplifyLine(wayPoints(w));
  if (pts.length < 2) continue;
  if (t.highway && ROAD_WIDTH[t.highway] !== undefined) {
    if (t.area === 'yes') continue;
    let width = len(t.width) ?? ROAD_WIDTH[t.highway];
    const lanes = num(t.lanes);
    if (len(t.width) === undefined && lanes && ['primary', 'secondary', 'tertiary', 'trunk', 'residential'].includes(t.highway)) width = Math.max(width, lanes * 3.3);
    const isPath = ['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'track', 'bridleway'].includes(t.highway);
    const f = {
      id: 'w' + w.id,
      type: t.highway,
      name: t.name || null,
      width: +width.toFixed(1),
      bridge: !!t.bridge && t.bridge !== 'no',
      tunnel: !!t.tunnel && t.tunnel !== 'no',
      layer: num(t.layer) ?? 0,
      surface: t.surface || null,
      oneway: t.oneway === 'yes',
      lanes: lanes ?? null,
      footway: t.footway || null, // sidewalk / crossing
      covered: t.covered === 'yes',
      indoor: t.indoor === 'yes' || t.level !== undefined && t.highway === 'footway' && t.indoor !== 'no' && !!t.indoor,
      points: pts,
    };
    (isPath ? paths : roads).push(f);
  } else if (t.railway && ['rail', 'abandoned', 'disused'].includes(t.railway)) {
    railways.push({ id: 'w' + w.id, type: t.railway, name: t.name || null, bridge: !!t.bridge, tunnel: !!t.tunnel && t.tunnel !== 'no', points: pts });
  } else if (t.barrier && !t.building && !(w.nodes[0] === w.nodes[w.nodes.length - 1] && t.area === 'yes')) {
    barriers.push({ id: 'w' + w.id, type: t.barrier, name: t.name || null, height: len(t.height) ?? null, material: t.material || t.fence_type || null, points: pts });
  } else if (t.natural === 'cliff') {
    cliffs.push({ id: 'w' + w.id, points: pts });
  }
}

// ---------------------------------------------------------------- areas
function areaType(t) {
  if (t.natural === 'water' || t.water || t.amenity === 'fountain' && t.natural === 'water') return 'water';
  if (t.leisure === 'track' || t.leisure === 'stadium' && false) return 'track';
  if (t.leisure === 'pitch') return 'pitch';
  if (t.leisure === 'stadium') return 'stadium';
  if (t.leisure === 'golf_course') return 'golf';
  if (t.leisure === 'playground') return 'playground';
  if (t.leisure === 'garden') return 'garden';
  if (t.leisure === 'park') return 'park';
  if (t.leisure === 'outdoor_seating') return 'plaza';
  if (t.leisure === 'fitness_station') return 'plaza';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'wood';
  if (t.natural === 'scrub') return 'scrub';
  if (t.landuse === 'grass' || t.landuse === 'recreation_ground' || t.landuse === 'village_green' || t.landuse === 'meadow') return 'grass';
  if (t.landuse === 'flowerbed') return 'flowerbed';
  if (t.landuse === 'construction') return 'construction';
  // underground and multi-storey car parks are not surface lots (garages are drawn as buildings)
  if (t.amenity === 'parking') return (t.parking === 'underground' || t.parking === 'multi-storey' || t.location === 'underground' || (num(t.layer) ?? 0) < 0) ? null : 'parking';
  if (t.man_made === 'courtyard') return 'plaza';
  if (t.man_made === 'bridge') return 'bridgeArea';
  if (t['area:highway']) return 'pavement';
  if (t.highway === 'pedestrian' && t.area === 'yes') return 'plaza';
  if (t.highway && t.area === 'yes') return 'pavement';
  if (t.landuse === 'residential' || t.landuse === 'retail' || t.landuse === 'religious' || t.amenity === 'school' || t.amenity === 'university') return null; // too coarse
  if (t.amenity === 'fountain') return 'water';
  return null;
}
const areas = [];
for (const w of ways.values()) {
  const t = w.tags;
  if (!t || t.building || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  const type = areaType(t);
  if (!type) continue;
  const ring = orient(simplifyRing(wayPoints(w), 0.15), true);
  if (ring.length < 3) continue;
  areas.push({ id: 'w' + w.id, type, name: t.name || null, sport: t.sport || null, surface: t.surface || null, polygon: ring, holes: [] });
}
for (const r of relations) {
  const t = r.tags;
  if (!t || t.building) continue;
  const type = areaType(t);
  if (!type) continue;
  const outers = assembleRings(r.members.filter((m) => m.type === 'way' && m.role === 'outer').map((m) => ways.get(m.ref)).filter(Boolean));
  const inners = assembleRings(r.members.filter((m) => m.type === 'way' && m.role === 'inner').map((m) => ways.get(m.ref)).filter(Boolean));
  outers.forEach((o, k) => {
    const ring = orient(simplifyRing(o, 0.15), true);
    if (ring.length < 3) return;
    const holes = inners.map((h) => orient(simplifyRing(h, 0.15), false)).filter((h) => h.length >= 3 && pointInRing(h[0], ring));
    areas.push({ id: `r${r.id}_${k}`, type, name: t.name || null, sport: t.sport || null, surface: t.surface || null, polygon: ring, holes });
  });
}
// Areas ordered large-to-small so small features paint over big ones
areas.sort((a, b) => Math.abs(signedArea(b.polygon)) - Math.abs(signedArea(a.polygon)));

// ---------------------------------------------------------------- trees & POIs
const trees = [], treeRows = [], pois = [];
const POI_KEEP_AMENITY = new Set(['bench', 'waste_basket', 'bicycle_parking', 'fountain', 'drinking_water', 'restaurant', 'cafe', 'fast_food', 'library', 'bank', 'atm', 'bicycle_rental', 'shelter', 'post_box', 'toilets', 'bar', 'police', 'place_of_worship', 'school', 'social_centre', 'parking_entrance', 'vending_machine', 'recycling', 'charging_station']);
for (const n of nodes.values()) {
  const t = n.tags;
  if (!t) continue;
  const [x, z] = project(n.lat, n.lon);
  if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
  if (t.natural === 'tree') { trees.push([x, z]); continue; }
  let type = null;
  if (t.tourism === 'artwork') type = 'artwork';
  else if (t.historic) type = 'memorial';
  else if (t.tourism) type = t.tourism;
  else if (t.amenity && POI_KEEP_AMENITY.has(t.amenity)) type = t.amenity;
  if (!type) continue;
  const p = { type, name: t.name || null, x, z };
  if (t.artist_name) p.artist = t.artist_name;
  if (t.artwork_type) p.artworkType = t.artwork_type;
  if (t.cuisine) p.cuisine = t.cuisine;
  if (t.level) p.level = t.level;
  if (t.wikipedia) p.wikipedia = t.wikipedia;
  if (t.start_date) p.startDate = t.start_date;
  pois.push(p);
}
for (const w of ways.values()) {
  if (w.tags && w.tags.natural === 'tree_row') treeRows.push({ id: 'w' + w.id, points: simplifyLine(wayPoints(w)) });
  // way-tagged benches / fountains as POIs at their centroid
  if (w.tags && (w.tags.amenity === 'bench') && !w.tags.building) {
    const pts = wayPoints(w); const c = pts[Math.floor(pts.length / 2)];
    pois.push({ type: 'bench', name: null, x: c[0], z: c[1] });
  }
}

// ---------------------------------------------------------------- write
const data = {
  meta: {
    generated: new Date().toISOString(),
    origin: ORIGIN,
    metersPerDeg: { lat: M_PER_DEG_LAT, lon: M_PER_DEG_LON },
    bounds: { minX, maxX, minZ, maxZ },
    axes: 'x = metres east of origin, z = metres south of origin (north = -z), y = metres above baseElevation',
    attribution: 'Map data © OpenStreetMap contributors (ODbL). Elevation: Mapzen/AWS Terrain Tiles (USGS 3DEP et al).',
    campusBoundary: campusRings.map((r) => simplifyRing(r, 0.5)),
  },
  terrain: {
    cellSize: CELL, width: gridW, height: gridH, minX, minZ,
    baseElevation: BASE_ELEV, heightOffset: HEIGHT_OFFSET, maxHeight: +(eMax - BASE_ELEV).toFixed(2),
    encoding: 'uint16 little-endian centimetres above (baseElevation - heightOffset); y = value/100 - heightOffset; row-major (row = z index), base64',
    heights: hbuf.toString('base64'),
  },
  buildings, roads, paths, railways, barriers, cliffs, areas, trees, treeRows, pois,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const json = JSON.stringify(data);
fs.writeFileSync(OUT + '.tmp', `/* Generated by tools/build-data.mjs — do not edit. ${data.meta.attribution} */\n(typeof window !== 'undefined' ? window : globalThis).CAMPUS_DATA = ${json};\n`);
fs.renameSync(OUT + '.tmp', OUT); // atomic replace: other processes may be reading campus.js
console.log(`wrote ${OUT} (${(json.length / 1e6).toFixed(2)} MB)`);
console.log(`bounds x[${minX}, ${maxX}] z[${minZ}, ${maxZ}]  terrain ${gridW}x${gridH} @${CELL}m  elev ${eMin.toFixed(1)}..${eMax.toFixed(1)} (base ${BASE_ELEV})`);
console.log(`buildings ${buildings.length} (campus ${buildings.filter((b) => b.campus).length}, curated ${Object.keys(curated).length})  roads ${roads.length}  paths ${paths.length}  areas ${areas.length}  trees ${trees.length}  treeRows ${treeRows.length}  pois ${pois.length}  barriers ${barriers.length}  rail ${railways.length}  cliffs ${cliffs.length}`);
